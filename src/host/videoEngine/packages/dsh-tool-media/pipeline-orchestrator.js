import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  buildSentenceSubtitles,
  cleanSubtitleChunk,
  createAbortError,
  formatDirectorBrief,
  loadEnv,
  normalizeContentOutline,
  normalizeNumeralsForDisplay,
  probeAudioDuration,
  probeHardwareProfile,
  readScriptJson,
  REPO_ROOT,
  resolveBinaries,
  resolveLowSpecPolicy,
  resolveTargetDurationPolicy,
  runCommandRedirected,
  sanitizeSpokenNarration,
  splitDirectorBrief,
  stripMetaInstructions,
  toTtsText,
  writeScriptJson,
} from '../shared/index.js'
import { castVoicesWithLlm, cloneRecordedVoice, executeGenerateSpeech, getActiveTtsEngineId, matchAllScenesInScript, resolveTtsEngineSpec } from '../dsh-tool-local-tts/index.js'
import { executeGenerateAvatar } from '../dsh-tool-avatar/index.js'
import {
  executeVideoLint,
  executeVideoRender,
  executeVideoSnapshot,
} from '../dsh-tool-video-suite/index.js'
import { importAssets, readAssets } from './asset-manager.js'
import { planVideoFromAssets, syncProjectCodeFromScript } from './ai-director.js'
import { buildRichHtmlVideo } from './html-generator.js'
import { authorBatchedRemotionScenes, runCodeAutoRepairLoop } from './ai-coder.js'
import { executeCurateAndEditAssets } from './media-editor.js'
import { buildGenreGuidance, detectGenre, resolveGenreSelection } from './genre-router.js'
import { generateAiCodedBgmTrack, generateAiCodedSfxCues, synthesizeTtsEngineAudioCue } from './audio-coder.js'
import {
  analyzeAudioBeatStructure,
  buildBeatGrid,
  choreographBeatSfxCues,
  ensureProjectAudioAssets,
  mixVideoAudio,
  quantizeScenesToBeatGrid,
} from './audio-synth.js'
import { buildHtmlCoderSkillsPrompt, buildRemotionCoderSkillsPrompt } from './shotcraft-lib.js'
import { callLlmChat, extractJsonFromLlmText, getSafeLlmConfigSummary } from './llm-client.js'
import { runSchemaDirectorWithDegradation } from './plan-schema.js'
import { writeRemotionProjectFiles } from './remotion-generator.js'
import { taskManager } from './task-manager.js'
import { buildMediaDimsMap, groundVisualAssets } from './vision-grounding.js'

/**
 * Normalize pipeline execution mode (`local-draft` / `draft` / `fast-draft` -> `fast-draft`).
 */
export function resolvePipelineMode(rawMode) {
  const cleaned = String(rawMode || '').trim()
  const isDraftMode = ['fast-draft', 'local-draft', 'draft'].includes(cleaned.toLowerCase())
  const effectiveMode = isDraftMode ? 'fast-draft' : 'ai-coded'
  return {
    isDraftMode,
    effectiveMode,
    mode: isDraftMode ? 'fast-draft' : cleaned || 'ai-coded',
    modeLabel: isDraftMode ? '极速本地出片' : 'AI 团队协同出片',
  }
}
import { masterVoiceTracks } from './voice-master.js'

function isDoneTask(run, taskId) {
  const t = run?.tasks?.find((x) => x.id === taskId)
  return Boolean(t && t.status === 'completed')
}

async function recomputeCumulativeTimeline(absDir) {
  const { data: script } = readScriptJson(absDir)
  const fps = Number(script.fps) || 30
  let cursorFrame = 0
  let totalSec = 0
  const allSubs = []

  for (let i = 0; i < (script.scenes || []).length; i++) {
    const sc = script.scenes[i]
    const minScDur = script.narrationMode === 'subtitle-mv' || sc.beatCutAligned ? 0.45 : 1.5
    const durSec = Math.max(minScDur, Number(sc.durationSec) || 4.0)
    const durFrames = Math.max(12, Number(sc.durationInFrames) || Math.ceil(durSec * fps))
    sc.startFrame = cursorFrame
    sc.durationInFrames = durFrames
    sc.durationSec = Number((durFrames / fps).toFixed(4))

    if (Array.isArray(sc.subtitles) && sc.subtitles.length > 0) {
      sc.subtitles = sc.subtitles.map((sub) => ({ ...sub, sceneId: sc.id }))
    } else if (sc.narration) {
      const startOffsetSec = Number.isFinite(Number(sc.voiceLeadSec)) ? Number(sc.voiceLeadSec) : 0.35
      const voiceDur = Math.max(0.8, Number(sc.voiceDurationSec) || sc.durationSec - startOffsetSec - 0.35)
      const subMaxW = Number(script.width) < Number(script.height) ? 11 : Number(script.width) === Number(script.height) ? 13 : 16
      sc.subtitles = buildSentenceSubtitles(sc.narration, voiceDur, fps, { maxLineWidth: subMaxW }).map((sub) => ({
        ...sub,
        startSec: Number((sub.startSec + startOffsetSec).toFixed(3)),
        endSec: Number((sub.endSec + startOffsetSec).toFixed(3)),
        startFrame: Math.floor((sub.startSec + startOffsetSec) * fps),
        endFrame: Math.ceil((sub.endSec + startOffsetSec) * fps),
        sceneId: sc.id,
      }))
    }
    for (const sub of sc.subtitles || []) {
      const gStartSec = Number((totalSec + Number(sub.startSec || 0)).toFixed(3))
      const gEndSec = Number((totalSec + Number(sub.endSec || 0)).toFixed(3))
      const gStartFrame = cursorFrame + Number(sub.startFrame || 0)
      const gEndFrame = cursorFrame + Number(sub.endFrame || 0)
      allSubs.push({
        ...sub,
        localStartSec: Number(sub.startSec || 0),
        localEndSec: Number(sub.endSec || 0),
        startSec: gStartSec,
        endSec: gEndSec,
        startFrame: gStartFrame,
        endFrame: gEndFrame,
        globalStartSec: gStartSec,
        globalEndSec: gEndSec,
        globalStartFrame: gStartFrame,
        globalEndFrame: gEndFrame,
      })
    }

    cursorFrame += durFrames
    totalSec += sc.durationSec
  }

  script.subtitles = allSubs
  script.totalDurationInFrames = cursorFrame
  script.totalDurationSec = Number(totalSec.toFixed(4))
  return writeScriptJson(absDir, script).data
}

async function buildCombinedDryVoiceWav(absDir, script, signal, onChild) {
  const { ffmpeg } = resolveBinaries()
  const wavs = (script?.scenes || [])
    .map((sc) => sc.masteredAudioFile || sc.audioFile)
    .filter(Boolean)
    .map((rel) => (isAbsolute(rel) ? rel : resolve(absDir, rel)))
    .filter((p) => existsSync(p))

  if (wavs.length === 0) return ''
  const outDir = join(absDir, 'output', 'avatar')
  mkdirSync(outDir, { recursive: true })
  const outWav = join(outDir, 'driving-vocal.wav')
  if (wavs.length === 1) return wavs[0]

  const concatTxt = join(outDir, 'vocal-concat.txt')
  writeFileSync(
    concatTxt,
    wavs.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n',
    'utf8',
  )
  const res = await runCommandRedirected(
    ffmpeg,
    ['-y', '-f', 'concat', '-safe', '0', '-i', concatTxt, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', outWav],
    { timeoutMs: 45_000, signal, onChild },
  )
  return res.code === 0 && existsSync(outWav) ? outWav : wavs[0]
}

async function executeMultiAgentRunner(run, helpers) {
  loadEnv()
  const { signal, onChild, waitIfPaused, updateTask, appendLog } = helpers
  const spec = run.spec || {}
  // Split any (AI-polished) brief into audience-safe title/topic + AI-only director notes
  {
    const brief = splitDirectorBrief(spec)
    spec.rawTopic = spec.rawTopic || spec.topic || ''
    spec.directorNotes = brief.directorNotes
    spec.contentOutline = Array.isArray(brief.contentOutline) && brief.contentOutline.length > 0
      ? brief.contentOutline
      : normalizeContentOutline(spec.contentOutline)
    spec.genre = brief.genre || spec.genre || ''
    spec.genreLabel = brief.genreLabel || spec.genreLabel || ''
    spec.displayTitle = brief.displayTitle
    spec.topic = brief.topic
    spec.title = brief.title
  }
  const absDir = resolve(spec.projectDir || run.projectDir)
  const { isDraftMode, effectiveMode: mode } = resolvePipelineMode(spec.mode)
  const engine = spec.engine === 'remotion' ? 'remotion' : 'html'
  const style = spec.style || 'tech'
  const aspectRatio = spec.aspectRatio || 'auto'

  // Optional initial source import BEFORE resolving BGM & duration policy
  if (spec.sources && (Array.isArray(spec.sources) ? spec.sources.length > 0 : true)) {
    await importAssets({ projectDir: absDir, sources: spec.sources })
  }

  let initialScriptSnap = {}
  if (existsSync(join(absDir, 'script.json'))) {
    try {
      initialScriptSnap = readScriptJson(absDir).data || {}
    } catch {}
  }
  const initialAssetsSnap = readAssets(absDir)
  const uploadedMusicSnap = (initialAssetsSnap.items || []).filter((it) => it.role === 'music')
  const intentFullText = `${spec.rawTopic || ''} ${spec.directorNotes || ''} ${spec.goal || ''} ${initialScriptSnap.goal || ''}`
  const wantsUploadedBgmByPrompt = /(?:上传|自带|导入|个人|我的|现有|本机).{0,10}(?:bgm|配乐|音乐|背景音|歌曲)|(?:bgm|配乐|背景音).{0,12}(?:节拍|卡点|踩拍|踩死|突降|高潮|同步)/i.test(intentFullText)
  const wantsBeatSyncByPrompt = /(?:踩死|踩准|踩拍|踩点|卡点|卡拍|高潮突降|主高潮|突降|重拍|切镜|同步节拍|节拍同步|beat[- ]?sync)/i.test(intentFullText)
  const wantsPureMusicByPrompt = /(?:纯音乐|免配音|无配音|无旁白|不要配音|不用配音|去掉配音|无需配音|纯卡点|卡点\s*MV|无解说|免\s*TTS)/i.test(intentFullText)
  const refStyleSnap = spec.referenceStyle || initialScriptSnap.referenceStyle || null
  const wantsRefSubtitleMv =
    refStyleSnap?.narrationMode === 'subtitle-mv' &&
    !/(?:需要配音|真人配音|口播解说|语音旁白|人声旁白)/.test(intentFullText)
  if (wantsBeatSyncByPrompt || wantsPureMusicByPrompt || refStyleSnap?.narrationMode === 'subtitle-mv' || refStyleSnap?.narrationMode === 'tts-beat-sync') {
    spec.beatSync = true
  }
  if ((wantsPureMusicByPrompt || wantsRefSubtitleMv) && (!spec.narrationMode || spec.narrationMode === 'tts')) {
    spec.narrationMode = 'subtitle-mv'
    appendLog('director', `检测到${wantsPureMusicByPrompt ? '指令要求纯音乐卡点/免配音' : '参考视频为纯音乐卡点 MV 模式'}，已自动切换为「🔥 纯音乐卡点 (subtitle-mv · 免 TTS)」并激活高密度重拍切镜与卡点音效！`)
  }

  let bgmMode = spec.bgmMode || initialScriptSnap.bgmMode || initialScriptSnap.audioSpec?.bgmMode || (uploadedMusicSnap.length > 0 ? 'uploaded' : 'llm-coded')
  const hasPreGeneratedLlmBgm = existsSync(join(absDir, 'audio', 'bgm-llm.wav'))
  if (
    uploadedMusicSnap.length > 0 &&
    (bgmMode === 'auto' || bgmMode === 'uploaded' || (bgmMode === 'llm-coded' && (!hasPreGeneratedLlmBgm || wantsUploadedBgmByPrompt)))
  ) {
    if (bgmMode !== 'uploaded') {
      appendLog('director', `检测到工程已上传背景音乐「${uploadedMusicSnap[0].name || uploadedMusicSnap[0].path}」，已自动优先挂载上传 BGM 音频与真实节拍！`)
    }
    bgmMode = 'uploaded'
  }

  const durationPolicy = resolveTargetDurationPolicy({
    durationMode: spec.durationMode || initialScriptSnap.durationMode || 'auto',
    targetDurationSec: Number(spec.targetDurationSec) || Number(initialScriptSnap.targetDurationSec) || 0,
    text: intentFullText,
    narrationMode: spec.narrationMode || initialScriptSnap.narrationMode || 'tts',
    hasVisualAssets: (initialAssetsSnap.items || []).some((it) => it.type === 'image' || it.type === 'video'),
    bgmDurationSec: Number(uploadedMusicSnap[0]?.durationSec || initialScriptSnap.bgm?.durationSec) || 0,
    referenceShotCount: Number(refStyleSnap?.pacingSignature?.targetShotCount || refStyleSnap?.shotCount || 0),
  })
  const effectiveDurationMode = durationPolicy.durationMode === 'custom' ? 'custom' : (spec.durationMode || initialScriptSnap.durationMode || 'auto')
  const effectiveTargetDurationSec = durationPolicy.enforced ? durationPolicy.targetSec : 0
  if (durationPolicy.enforced) {
    appendLog('director', `已锁定目标时长策略: ${durationPolicy.label}（规划目标 ${durationPolicy.targetSec}s，底线 ${durationPolicy.minSec}s）`)
  }

  const hwProfile = probeHardwareProfile({ targetDir: absDir })
  const hwPolicy = resolveLowSpecPolicy({
    repoRoot: REPO_ROOT,
    hardware: hwProfile,
    modePref: spec.lowSpecMode || '',
    requestedQuality: spec.quality || '1080p',
    requestedFps: Number(spec.fps) || 30,
    totalDurationSec: effectiveTargetDurationSec || 60,
  })
  const quality = hwPolicy.effectiveQuality || spec.quality || '1080p'
  const effectiveFps = hwPolicy.effectiveFps || Number(spec.fps) || 30
  const targetPlatform = spec.targetPlatform || 'universal'
  let voiceId = spec.voiceId || 'auto'
  const speechTempo = Number(spec.speechTempo) || 1.0
  const allowPlaceholder = Boolean(spec.allowPlaceholder)
  const llmSummary = getSafeLlmConfigSummary()
  appendLog(
    'director',
    `本机算力体检: ${hwProfile.cpu.threads}核 · ${hwProfile.memory.freeGB}/${hwProfile.memory.totalGB}GB 内存 · ${hwProfile.gpu.primaryName} | ${hwPolicy.reason}${hwPolicy.clampedFields.length ? ` [保护限幅: ${hwPolicy.clampedFields.join(' / ')}]` : ''}`,
  )

  // =========================================================================
  // AGENT 1: 策划导演 Agent (director)
  // =========================================================================
  if (!isDoneTask(run, 't-director')) {
    await waitIfPaused('t-director')
    updateTask('t-director', {
      status: 'running',
      progress: 12,
      message: `策划导演 Agent 启动：正在整合主题「${spec.topic || '智能短片'}」与 Step 1 素材库...`,
    })

    const preserveExisting = Boolean(spec.preserveExistingScript && existsSync(join(absDir, 'script.json')))
    if (preserveExisting) {
      // Allow re-running director preservation smoothly
    } else {
      let existingBeforePlan = {}
      if (existsSync(join(absDir, 'script.json'))) {
        try {
          existingBeforePlan = readScriptJson(absDir).data || {}
        } catch {}
      }
      const preservedGoal = formatDirectorBrief({
        goal:
          String(spec.userPrompt || spec.polishedTopic || spec.goal || '').trim() ||
          (String(spec.rawTopic || '').trim().length > 36 || /【/.test(String(spec.rawTopic || '')) ? String(spec.rawTopic).trim() : '') ||
          String(existingBeforePlan.goal || '').trim(),
        displayTitle: spec.displayTitle,
        genreLabel: spec.genreLabel,
        contentOutline: spec.contentOutline,
        directorNotes: spec.directorNotes,
        topic: spec.rawTopic || spec.topic,
      })
      await planVideoFromAssets({
        projectDir: absDir,
        topic: spec.topic || '',
        title: spec.title || spec.topic || '',
        displayTitle: spec.displayTitle,
        directorNotes: spec.directorNotes,
        contentOutline: spec.contentOutline,
        genre: spec.genre,
        genreLabel: spec.genreLabel,
        style,
        engine,
        aspectRatio,
        quality,
        width: spec.width,
        height: spec.height,
        aiBadge: spec.aiBadgeEnabled !== undefined ? Boolean(spec.aiBadgeEnabled) : spec.aiBadge !== false,
        aiBadgeEnabled: spec.aiBadgeEnabled !== undefined ? Boolean(spec.aiBadgeEnabled) : spec.aiBadge !== false,
        aiBadgePosition: spec.aiBadgePosition || 'top-right',
        aiBadgeText: spec.aiBadgeText || (typeof spec.aiBadge === 'string' ? spec.aiBadge : ''),
        pacingMode: spec.pacingMode || 'auto',
        visual3dMode: spec.visual3dMode || 'auto',
        fps: effectiveFps,
        voiceId,
        narrationMode: spec.narrationMode || '',
        durationMode: effectiveDurationMode,
        targetDurationSec: effectiveTargetDurationSec || undefined,
        bgmMode,
        userPrompt: preservedGoal,
        goal: preservedGoal,
      })
    }

    // Analyze uploaded BGM beats BEFORE AI director runs so scene rhythm aligns to measured BPM & drops
    let analyzedBgmMeta = null
    {
      const preScript = readScriptJson(absDir).data
      const preAssets = readAssets(absDir)
      const upMusic = (preAssets.items || []).filter((it) => it.role === 'music')
      const upPath = spec.uploadedBgmPath || upMusic[0]?.path || preScript?.bgm?.uploadedPath || ''
      if (bgmMode === 'uploaded' && upPath) {
        const absBgmSrc = isAbsolute(upPath) ? upPath : resolve(absDir, upPath)
        if (existsSync(absBgmSrc)) {
          try {
            updateTask('t-director', {
              status: 'running',
              progress: 34,
              message: '正在分析上传 BGM 真实 BPM、重拍相位与能量高潮区间...',
            })
            analyzedBgmMeta = await analyzeAudioBeatStructure(absBgmSrc, { signal })
            preScript.bgm = {
              ...(preScript.bgm || {}),
              ...analyzedBgmMeta,
              mode: 'uploaded',
              source: 'user-imported',
              path: upPath,
              uploadedPath: upPath,
            }
            preScript.audioSpec = { ...(preScript.audioSpec || {}), bgmMode: 'uploaded', bpm: analyzedBgmMeta.bpm }
            writeScriptJson(absDir, preScript)
            appendLog('director', `已测得上传 BGM 真实节拍: ${analyzedBgmMeta.bpm} BPM · 首拍 ${analyzedBgmMeta.phaseSec}s · ${analyzedBgmMeta.downbeats.length} 个重拍 · ${analyzedBgmMeta.drops.length} 个高潮突降点`)
          } catch (err) {
            appendLog('director', `上传 BGM 节拍解析略过 (${err.message})`, 'warn')
          }
        }
      }
    }

    if (signal.aborted) throw createAbortError()
    await waitIfPaused('t-director')

    if (mode === 'ai-coded' && llmSummary.configured && !spec.skipLlmDirector) {
      updateTask('t-director', {
        status: 'running',
        progress: 55,
        message: `策划导演 Agent 正在调用大模型 (${llmSummary.model}) 润色分镜口播文案与节奏曲线...`,
      })
      try {
        const curScript = readScriptJson(absDir).data
        curScript.durationMode = effectiveDurationMode
        if (effectiveTargetDurationSec > 0) {
          curScript.targetDurationSec = effectiveTargetDurationSec
          curScript.totalDurationSec = effectiveTargetDurationSec
        }
        // Ground visual assets with exact DOM sidecars (*.anchors.json) or multimodal Vision LLM coordinates
        try {
          const groundRes = await groundVisualAssets({
            projectDir: absDir,
            callLlmChatFn: (p) => callLlmChat({ ...p, signal }),
            enableVision: mode === 'ai-coded' && llmSummary.configured,
            signal,
            onProgress: (pct, msg) => {
              updateTask('t-director', {
                status: 'running',
                progress: Math.max(40, Math.min(54, Math.round(40 + pct * 0.14))),
                message: msg,
                log: false,
              })
            },
          })
          if (groundRes?.grounded > 0) {
            appendLog('director', `已完成界面视觉坐标锚点定位：精确 DOM 侧车 ${groundRes.sidecarCount} 份 · 视觉识别 ${groundRes.visionCount} 份`)
          }
        } catch {}
        const assetsManifest = readAssets(absDir)
        curScript.mediaDims = buildMediaDimsMap(assetsManifest, curScript)
        const schemaRes = await runSchemaDirectorWithDegradation({
          projectDir: absDir,
          topic: spec.topic || curScript.topic || curScript.title,
          directorNotes: spec.directorNotes || curScript.directorNotes || '',
          contentOutline: spec.contentOutline || curScript.contentOutline || '',
          genre: spec.genre || curScript.genre || '',
          genreLabel: spec.genreLabel || curScript.genreLabel || '',
          authoringMode: mode,
          style,
          targetPlatform,
          scriptData: curScript,
          assetsManifest,
          bgmMeta: analyzedBgmMeta,
          narrationMode: spec.narrationMode || curScript.narrationMode || '',
          pacingMode: spec.pacingMode || curScript.pacingMode || (spec.narrationMode === 'subtitle-mv' ? 'dynamic' : 'auto'),
          durationMode: effectiveDurationMode,
          targetDurationSec: effectiveTargetDurationSec,
          referenceStyle: refStyleSnap || curScript.referenceStyle || null,
          callLlmChatFn: (p) => callLlmChat({ ...p, signal }),
        })
        if (schemaRes?.resolved?.resolvedShots?.length >= 2) {
          const oldScenes = Array.isArray(curScript.scenes) ? curScript.scenes : []
          const visualPool = (assetsManifest?.items || []).filter((it) => it.type === 'image' || it.type === 'video')
          const updatedScenes = schemaRes.resolved.resolvedShots.map((shot, i) => {
            const oldSc = oldScenes[i] || oldScenes[i % Math.max(1, oldScenes.length)] || {}
            const fallbackAsset = visualPool.length > 0 ? visualPool[i % visualPool.length] : null
            const mediaList =
              Array.isArray(shot.media) && shot.media.length > 0
                ? shot.media.map((m) => {
                    const hit = visualPool.find((v) => v.path === m.path || v.editedPath === m.path)
                    return hit ? { ...m, width: Number(m.width || hit.editedWidth || hit.width || 0), height: Number(m.height || hit.editedHeight || hit.height || 0) } : m
                  })
                : shot.explicitZeroAsset
                  ? []
                  : Array.isArray(oldSc.media) && oldSc.media.length > 0
                    ? oldSc.media
                    : fallbackAsset
                      ? [{ assetId: fallbackAsset.id, path: fallbackAsset.path, webPath: fallbackAsset.webPath || '', type: fallbackAsset.type, width: Number(fallbackAsset.width || 0), height: Number(fallbackAsset.height || 0) }]
                      : []
            const nextNarration =
              normalizeNumeralsForDisplay(
                stripMetaInstructions(sanitizeSpokenNarration(shot.narration || oldSc.narration || shot.title || '')),
              ) ||
              normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(shot.title || ''))) ||
              `镜头 ${i + 1}`
            const narrationChanged = Boolean(
              oldSc.narration &&
                nextNarration &&
                nextNarration !== normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(oldSc.narration))),
            )
            const cleanTitle =
              normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(shot.title || oldSc.title || `镜头 ${i + 1}`))) ||
              `镜头 ${i + 1}`
            const cleanSubChunks =
              Array.isArray(shot.subChunks) && shot.subChunks.length > 0
                ? shot.subChunks
                    .map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(sanitizeSpokenNarration(c)))))
                    .filter(Boolean)
                : narrationChanged
                  ? undefined
                  : Array.isArray(oldSc.subChunks)
                    ? oldSc.subChunks
                        .map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(c))))
                        .filter(Boolean)
                    : undefined
            const resolvedEmotion = shot.voiceEmotion || shot.emotion || oldSc.voiceEmotion || oldSc.emotion || '自信明快'
            return {
              ...oldSc,
              id: shot.id || oldSc.id || `scene-${String(i + 1).padStart(2, '0')}`,
              index: i + 1,
              title: cleanTitle,
              narration: nextNarration,
              subtitleText: cleanSubChunks?.length ? cleanSubChunks.join(' ') : nextNarration,
              subChunks: cleanSubChunks,
              accentWords: Array.isArray(shot.accentWords) ? shot.accentWords : oldSc.accentWords,
              threePreset: shot.threePreset || shot?.stageSpec?.threePreset || oldSc.threePreset,
              stageSpec: shot.stageSpec || oldSc.stageSpec,
              beatCount: Number.isFinite(Number(shot.beatCount)) ? Number(shot.beatCount) : oldSc.beatCount,
              visualBlueprint: shot.visualBlueprint || oldSc.visualBlueprint,
              motionNotes: shot.motionNotes || shot.visualBlueprint || oldSc.motionNotes,
              emotion: resolvedEmotion,
              voiceEmotion: resolvedEmotion,
              role: shot.role || oldSc.role || 'narrator',
              speechRate: Number(shot.speechRate || oldSc.speechRate || 1.04),
              layout:
                shot.layout ||
                oldSc.layout ||
                (visualPool.length === 0
                  ? (/历史|霸王|项羽|霍去病|卫青|汉武|秦|汉|楚|三国|唐|宋|明|古风|武侠|战役|将军|帝王|演义/i.test(`${spec.topic || ''} ${curScript.title || ''}`)
                      ? 'narrative-diorama'
                      : '3d-stage-opener')
                  : 'app-focus-shot'),
              kenBurns: shot.kenBurns || oldSc.kenBurns || 'zoom-in',
              transition: shot.transition || oldSc.transition || (visualPool.length === 0 ? 'flash-cut' : 'iris-circle'),
              highlights: Array.isArray(shot.highlights) && shot.highlights.length > 0
                ? shot.highlights.map((h) => normalizeNumeralsForDisplay(stripMetaInstructions(h))).filter(Boolean)
                : oldSc.highlights || [],
              hudStep: Number.isFinite(Number(shot.hudStep)) ? Number(shot.hudStep) : oldSc.hudStep,
              cams: Array.isArray(shot.cams) && shot.cams.length > 0 ? shot.cams : oldSc.cams,
              marks: Array.isArray(shot.marks) && shot.marks.length > 0 ? shot.marks : oldSc.marks,
              cursors: Array.isArray(shot.cursors) && shot.cursors.length > 0 ? shot.cursors : oldSc.cursors,
              loupe: shot.loupe || oldSc.loupe,
              windowTheme: shot.windowTheme || oldSc.windowTheme || (schemaRes.plan?.genre === 'ui-tutorial' && mediaList.length > 0 ? 'light' : undefined),
              windowTitle: shot.windowTitle || oldSc.windowTitle,
              durationSec: Number(shot.durationSec) || oldSc.durationSec || 4.0,
              durationInFrames: undefined,
              media: mediaList,
              assetPaths: mediaList.map((m) => m.path),
            }
          })
          curScript.scenes = updatedScenes
          const genreAfterDir = resolveGenreSelection({
            genre: schemaRes.plan?.genre || curScript.genre || spec.genre || '',
            genreLabel: schemaRes.plan?.genreLabel || curScript.genreLabel || spec.genreLabel || '',
            text: { topic: spec.topic || curScript.title, goal: curScript.directorNotes || curScript.goal, style, hasMedia: visualPool.length > 0 },
            hasScreenshots: visualPool.length > 0,
          })
          curScript.genre = genreAfterDir.id
          curScript.genreLabel = genreAfterDir.label
          if (schemaRes.plan?.audioProfile && typeof schemaRes.plan.audioProfile === 'object') {
            curScript.audioProfile = schemaRes.plan.audioProfile
          }
          curScript.title =
            normalizeNumeralsForDisplay(stripMetaInstructions(schemaRes.plan?.title || curScript.displayTitle || curScript.title)) ||
            curScript.title
          curScript.targetPlatform = targetPlatform
          if (visualPool.length === 0 || spec.narrationMode === 'subtitle-mv') {
            curScript.subtitleStyle = 'cinematic'
          }
          if (spec.narrationMode) {
            curScript.narrationMode = spec.narrationMode
          }
          if (Number(schemaRes.degradationTier || 4) <= 3) {
            curScript.authoringMode = 'ai-coded'
          }
          curScript.directorMeta = {
            tier: schemaRes.degradationTier || 4,
            tierLabel: schemaRes.tierLabel || 'Schema Tier',
            model: llmSummary.model || '',
            llmUsed: Number(schemaRes.degradationTier || 4) <= 3,
          }
          writeScriptJson(absDir, curScript)
          appendLog('director', `大模型导演调度完成 (${schemaRes.tierLabel || 'Schema Tier'} · ${updatedScenes.length} 幕${schemaRes.degradationTier > 1 ? ` · Tier1详情: ${schemaRes.trace?.[0]?.reason || 'unknown'}` : ''})`)
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
        appendLog('director', `大模型导演增强已回退本地智能规划: ${err.message}`, 'warn')
      }
    }

    const sAfterDir = readScriptJson(absDir).data
    sAfterDir.targetPlatform = targetPlatform
    if (spec.aiBadgeEnabled !== undefined) {
      sAfterDir.aiBadgeEnabled = Boolean(spec.aiBadgeEnabled)
      sAfterDir.aiBadge = Boolean(spec.aiBadgeEnabled)
    } else if (spec.aiBadge !== undefined) {
      sAfterDir.aiBadgeEnabled = Boolean(spec.aiBadge)
      sAfterDir.aiBadge = spec.aiBadge
    }
    if (spec.aiBadgePosition) sAfterDir.aiBadgePosition = String(spec.aiBadgePosition)
    if (spec.aiBadgeText !== undefined) sAfterDir.aiBadgeText = String(spec.aiBadgeText)
    if (spec.pacingMode) sAfterDir.pacingMode = String(spec.pacingMode)
    if (spec.visual3dMode) sAfterDir.visual3dMode = String(spec.visual3dMode)
    sAfterDir.fps = effectiveFps
    sAfterDir.lowSpecSafe = hwPolicy.lowSpecSafe
    sAfterDir.hardwarePolicy = {
      profileMode: hwPolicy.profileMode,
      lowSpecSafe: hwPolicy.lowSpecSafe,
      clampedFields: hwPolicy.clampedFields,
      reason: hwPolicy.reason,
    }
    if (spec.avatarLayout) sAfterDir.avatarLayout = spec.avatarLayout
    writeScriptJson(absDir, sAfterDir)
    updateTask('t-director', {
      status: 'completed',
      progress: 100,
      message: `策划完成：${sAfterDir.scenes?.length || 0} 幕分镜已生成 (${sAfterDir.width}x${sAfterDir.height})`,
    })
  }

  // =========================================================================
  // AGENT 2: 素材剪辑 Agent (editor)
  // =========================================================================
  if (!isDoneTask(run, 't-editor')) {
    await waitIfPaused('t-editor')
    updateTask('t-editor', {
      status: 'running',
      progress: 10,
      message: '素材剪辑 Agent 启动：正在调用 FFmpeg 智能裁切构图、调色增强与镜头对齐...',
    })

    const curScript = readScriptJson(absDir).data
    const editRes = await executeCurateAndEditAssets({
      projectDir: absDir,
      aspectRatio: curScript.aspectRatio || aspectRatio,
      quality: curScript.quality || quality,
      width: curScript.width,
      height: curScript.height,
      style: curScript.style || style,
      trimSeconds: Number(spec.trimSeconds) || 0,
      clipSpeed: Number(spec.clipSpeed) || 1.0,
      chromaKeyColor: spec.mediaChromaKeyColor || '',
      enhanceColor: spec.enhanceColor !== false,
      signal,
      onChild,
      onProgress: (p) => {
        updateTask('t-editor', {
          status: 'running',
          progress: Math.max(10, Math.min(95, Number(p.progress) || 50)),
          message: p.message || '素材剪辑中...',
          log: false,
        })
      },
    })

    updateTask('t-editor', {
      status: 'completed',
      progress: 100,
      message: `素材精修完成：已裁切调色 ${editRes.editedCount || 0} 份视觉素材`,
    })
  }

  // =========================================================================
  // AGENT 3: 配音混音 Agent (audio) + 数字人生成 (avatar)
  // =========================================================================
  if (!isDoneTask(run, 't-audio')) {
    await waitIfPaused('t-audio')
    const activeTtsSpec = resolveTtsEngineSpec(spec.ttsEngine || getActiveTtsEngineId())
    updateTask('t-audio', {
      status: 'running',
      progress: 10,
      message: `配音混音 Agent 启动：正在使用 ${activeTtsSpec.shortName || activeTtsSpec.name} 生成旁白语音与音色匹配...`,
    })

    let scriptNow = readScriptJson(absDir).data
    const assetsNow = readAssets(absDir)
    const fps = Number(scriptNow.fps) || 30
    const hostVideoAsset = (assetsNow.items || []).find((it) => it.role === 'host_video' && it.type === 'video')
    const voiceCloneSample = (assetsNow.items || []).find((it) => it.role === 'voice_clone')

    if (spec.useHostVocal && hostVideoAsset && hostVideoAsset.hasAudio !== false) {
      updateTask('t-audio', {
        status: 'running',
        progress: 25,
        message: '检测到真人出镜原声视频，正在提取 48kHz 干声并按分镜口播智能分段对齐...',
      })
      const { ffmpeg } = resolveBinaries()
      const hostAbs = isAbsolute(hostVideoAsset.path) ? hostVideoAsset.path : resolve(absDir, hostVideoAsset.path)
      const scenesList = Array.isArray(scriptNow.scenes) ? scriptNow.scenes : []
      if (scenesList.length > 0 && existsSync(hostAbs)) {
        const hostFullAbs = join(absDir, 'audio', 'host-full.wav')
        mkdirSync(join(absDir, 'audio'), { recursive: true })
        const extRes = await runCommandRedirected(
          ffmpeg,
          ['-y', '-i', hostAbs, '-vn', '-af', 'highpass=f=75,aresample=48000', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', hostFullAbs],
          { timeoutMs: 45_000, signal, onChild },
        )
        if (extRes.code === 0 && existsSync(hostFullAbs)) {
          const probedHost = await probeAudioDuration(hostFullAbs, fps).catch(() => ({ durationSec: 0 }))
          const totalHostSec = Number(probedHost.durationSec) || 0
          // Split full recorded monologue proportionally across ALL scenes if long enough so speaker voice never switches mid-video
          if (totalHostSec >= 2.2 && scenesList.length > 1) {
            const weights = scenesList.map((sc) => Math.max(4, String(sc.narration || sc.title || '').length, Number(sc.durationSec || 3) * 4))
            const sumW = weights.reduce((a, b) => a + b, 0) || 1
            let cursorSec = 0
            let assigned = 0
            for (let si = 0; si < scenesList.length; si++) {
              const sc = scenesList[si]
              const segDur = si === scenesList.length - 1
                ? Math.max(0.8, totalHostSec - cursorSec)
                : Math.max(0.8, Number(((weights[si] / sumW) * totalHostSec).toFixed(3)))
              const segRel = `audio/${sc.id}-host.wav`
              const segAbs = join(absDir, segRel)
              const sliceRes = await runCommandRedirected(
                ffmpeg,
                ['-y', '-ss', cursorSec.toFixed(3), '-t', segDur.toFixed(3), '-i', hostFullAbs, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', segAbs],
                { timeoutMs: 30_000, signal, onChild },
              )
              cursorSec += segDur
              if (sliceRes.code === 0 && existsSync(segAbs)) {
                sc.audioFile = segRel
                sc.voiceDurationSec = segDur
                sc.durationSec = Math.max(1.8, Number((segDur + 0.35).toFixed(3)))
                sc.durationInFrames = Math.ceil(sc.durationSec * fps)
                assigned++
              }
            }
            writeScriptJson(absDir, scriptNow)
            appendLog('audio', `已抽取真人出镜原声 (${totalHostSec.toFixed(1)}s) 并按口播节奏切分至全部 ${assigned} 幕`)
          } else {
            const firstSc = scenesList[0]
            const hostWavRel = `audio/${firstSc.id}-host.wav`
            const hostWavAbs = join(absDir, hostWavRel)
            const copyRes = await runCommandRedirected(
              ffmpeg,
              ['-y', '-i', hostFullAbs, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', hostWavAbs],
              { timeoutMs: 25_000, signal, onChild },
            )
            if (copyRes.code === 0 && existsSync(hostWavAbs)) {
              firstSc.audioFile = hostWavRel
              writeScriptJson(absDir, scriptNow)
              appendLog('audio', `真人原声较短 (${totalHostSec.toFixed(1)}s)，已作为第 1 幕开场原声挂载`)
            }
          }
        }
      }
    }

    scriptNow = readScriptJson(absDir).data
    const visualItemsNow = (assetsNow.items || []).filter((it) => it.type === 'image' || it.type === 'video')
    let effectiveNarrationMode =
      spec.narrationMode ||
      scriptNow.narrationMode ||
      (visualItemsNow.length === 0 && bgmMode === 'uploaded' && !spec.useHostVocal ? 'subtitle-mv' : 'tts')
    if ((wantsPureMusicByPrompt || wantsRefSubtitleMv) && !spec.useHostVocal) {
      effectiveNarrationMode = 'subtitle-mv'
    } else if (wantsBeatSyncByPrompt && bgmMode === 'uploaded' && effectiveNarrationMode === 'tts') {
      effectiveNarrationMode = 'tts-beat-sync'
      appendLog('audio', '检测到指令要求分镜与动效全程踩死上传 BGM 节拍，已自动切换为「AI 配音 + 真实节拍踩点切镜」模式')
    }
    scriptNow.narrationMode = effectiveNarrationMode
    if (effectiveNarrationMode === 'subtitle-mv') {
      scriptNow.subtitleStyle = 'cinematic'
    }

    // Auto-adopt uploaded voice_clone sample when user didn't pick another voice explicitly
    if (effectiveNarrationMode !== 'subtitle-mv' && voiceCloneSample && (!voiceId || voiceId === 'auto')) {
      const sampleAbs = isAbsolute(voiceCloneSample.path) ? voiceCloneSample.path : resolve(absDir, voiceCloneSample.path)
      if (existsSync(sampleAbs)) {
        try {
          const cloned = await cloneRecordedVoice({
            audioPath: sampleAbs,
            voiceName: `项目声纹_${voiceCloneSample.name || '克隆人声'}`,
          })
          if (cloned?.voice?.id) {
            voiceId = cloned.voice.id
            scriptNow.defaultVoiceId = voiceId
            scriptNow.voiceMode = 'manual'
            writeScriptJson(absDir, scriptNow)
            appendLog('audio', `检测到已上传声音克隆样本「${voiceCloneSample.name}」，已自动注册并绑定为主讲声纹 (${voiceId})`)
          }
        } catch (vcErr) {
          appendLog('audio', `声音克隆样本自动注册略过: ${vcErr?.message || vcErr}`, 'warn')
        }
      }
    }

    if (effectiveNarrationMode === 'subtitle-mv') {
      updateTask('t-audio', {
        status: 'running',
        progress: 45,
        message: '纯音乐卡点动画模式：跳过 TTS 朗读，正在精确绑定镜头切入与字幕至音乐重拍...',
      })
      writeScriptJson(absDir, scriptNow)
    } else {
      let llmCastOk = false
      if (mode === 'ai-coded' && llmSummary.configured && (!voiceId || voiceId === 'auto')) {
        updateTask('t-audio', {
          status: 'running',
          progress: 14,
          message: `正在召唤大模型 (${llmSummary.model}) 根据主题与情绪语义挑选精品音色...`,
        })
        try {
          const curGenreInfo = resolveGenreSelection({
            genre: scriptNow.genre || spec.genre || '',
            genreLabel: scriptNow.genreLabel || spec.genreLabel || '',
            text: { topic: scriptNow.title || spec.topic, goal: scriptNow.directorNotes || scriptNow.goal, style, hasMedia: visualItemsNow.length > 0 },
            hasScreenshots: visualItemsNow.length > 0,
          })
          const castRes = await castVoicesWithLlm({
            projectDir: absDir,
            scriptData: scriptNow,
            genre: curGenreInfo.id,
            genreGuidance: buildGenreGuidance(curGenreInfo.id, curGenreInfo.label),
            callLlmChatFn: (p) => callLlmChat({ ...p, signal }),
          })
          if (castRes?.ok) {
            llmCastOk = true
            appendLog('audio', `AI 语义选音完成: 主讲 [${castRes.primaryVoiceName || castRes.primaryVoiceId}] · ${castRes.primaryReason || ''}`)
          }
        } catch (castErr) {
          appendLog('audio', `AI 语义选音回退规则匹配: ${castErr?.message || castErr}`, 'warn')
        }
      }
      if (!llmCastOk) {
        matchAllScenesInScript(absDir, { voiceId, forceAuto: false })
      }
      scriptNow = readScriptJson(absDir).data

      const scenesToTts = (scriptNow.scenes || []).filter((sc) => {
        const hasExisting = sc.audioFile && existsSync(isAbsolute(sc.audioFile) ? sc.audioFile : resolve(absDir, sc.audioFile))
        return !hasExisting || !spec.preserveExistingAudio
      })

      for (let i = 0; i < scenesToTts.length; i++) {
        if (signal.aborted) throw createAbortError()
        await waitIfPaused('t-audio')
        const sc = scenesToTts[i]
        if (spec.useHostVocal && sc.audioFile && sc.audioFile.includes('-host.wav')) continue
        updateTask('t-audio', {
          status: 'running',
          progress: Math.round(20 + ((i + 0.5) / Math.max(1, scenesToTts.length)) * 30),
          message: `正在合成第 ${i + 1}/${scenesToTts.length} 幕配音 (${sc.title || sc.id})...`,
          log: false,
        })
        const sceneSpeed = Number(((Number(sc.speechRate) || 1.04) * speechTempo).toFixed(2))
        const displayText = sc.narration || sc.title || '欢迎来到 AI 视频创作工坊'
        const spokenTtsText = sc.ttsText || toTtsText(displayText)
        await executeGenerateSpeech({
          text: displayText,
          ttsText: spokenTtsText,
          emotion: sc.voiceEmotion || sc.emotion || '自信明快',
          speed: sceneSpeed,
          outputPath: `audio/${sc.id}.wav`,
          fps,
          voiceId: sc.voiceId || voiceId || 'auto',
          engine: spec.ttsEngine || getActiveTtsEngineId(),
          scriptPath: absDir,
          sceneId: sc.id,
          allowPlaceholder,
        })
      }

      if (signal.aborted) throw createAbortError()
      await waitIfPaused('t-audio')
      updateTask('t-audio', {
        status: 'running',
        progress: 58,
        message: '正在执行 AI 修音去静音、响度标准化与人声母带均衡...',
      })
      try {
        await masterVoiceTracks({
          projectDir: absDir,
          useLlm: mode === 'ai-coded' && llmSummary.configured,
          speechTempo: 1.0,
          trimSilence: true,
          signal,
          onChild,
          onProgress: (msg) => appendLog('audio', msg),
        })
      } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
        appendLog('audio', `修音阶段跳过未完成音轨: ${err.message}`, 'warn')
      }

      scriptNow = await recomputeCumulativeTimeline(absDir)
    }

    if (signal.aborted) throw createAbortError()
    await waitIfPaused('t-audio')
    updateTask('t-audio', {
      status: 'running',
      progress: 75,
      message: '正在生成转场 SFX 音效与背景配乐，并执行节拍踩点混音...',
    })

    if (mode === 'ai-coded' && llmSummary.configured) {
      await generateAiCodedSfxCues({ projectDir: absDir, style, signal }).catch(() => {})
    }

    const totalSec = Math.max(4, Number(scriptNow.totalDurationSec) || 12)
    const uploadedMusic = (assetsNow.items || []).filter((it) => it.role === 'music')
    const uploadedSfx = (assetsNow.items || []).filter((it) => it.role === 'sfx')
    const chosenUploadPath = spec.uploadedBgmPath || uploadedMusic[0]?.path || scriptNow.bgm?.uploadedPath || ''
    const customSfxPick = (kind) => {
      if (uploadedSfx.length > 0) {
        const hit = uploadedSfx.find((x) => String(x.name || x.originalName || '').toLowerCase().includes(String(kind || '').toLowerCase()))
        if (hit?.path) return hit.path
      }
      return `audio/sfx/${kind}.wav`
    }
    scriptNow.bgmMode = bgmMode
    scriptNow.audioSpec = { ...(scriptNow.audioSpec || {}), bgmMode }

    if (bgmMode === 'uploaded' && chosenUploadPath) {
      const absBgmFile = isAbsolute(chosenUploadPath) ? chosenUploadPath : resolve(absDir, chosenUploadPath)
      let beatMeta = scriptNow.bgm?.analyzed ? scriptNow.bgm : null
      if (!beatMeta && existsSync(absBgmFile)) {
        try {
          beatMeta = await analyzeAudioBeatStructure(absBgmFile, { signal })
        } catch {}
      }
      scriptNow.bgm = {
        ...(scriptNow.bgm || {}),
        ...(beatMeta || {}),
        enabled: true,
        mode: 'uploaded',
        source: 'user-imported',
        path: chosenUploadPath,
        uploadedPath: chosenUploadPath,
      }
      if (beatMeta?.analyzed && (effectiveNarrationMode === 'subtitle-mv' || effectiveNarrationMode === 'tts-beat-sync' || spec.beatSync || true)) {
        const qMode = effectiveNarrationMode === 'subtitle-mv' ? 'subtitle-mv' : 'tts-beat-sync'
        const adaptiveOpts = {
          genre: scriptNow.genre || spec.genre,
          genreLabel: scriptNow.genreLabel || spec.genreLabel,
          title: scriptNow.title || spec.topic,
          style,
          narrationMode: effectiveNarrationMode,
          pacingMode: scriptNow.pacingMode || spec.pacingMode,
          audioProfile: scriptNow.audioProfile,
          referenceStyle: scriptNow.referenceStyle,
          sfxPick: customSfxPick,
        }
        scriptNow.scenes = quantizeScenesToBeatGrid(scriptNow.scenes || [], beatMeta, {
          ...adaptiveOpts,
          mode: qMode,
          fps,
          targetDurationSec: effectiveTargetDurationSec,
        })
        scriptNow.scenes = choreographBeatSfxCues(scriptNow.scenes, beatMeta, adaptiveOpts)
        scriptNow.subtitles = scriptNow.scenes.flatMap((sc) => sc.subtitles || [])
        const lastSc = scriptNow.scenes[scriptNow.scenes.length - 1]
        scriptNow.totalDurationInFrames = lastSc ? Number(lastSc.startFrame || 0) + Number(lastSc.durationInFrames || 0) : scriptNow.totalDurationInFrames
        scriptNow.totalDurationSec = Number(((scriptNow.totalDurationInFrames || 30) / fps).toFixed(4))
        appendLog('audio', `已完成全品类自适应上传 BGM 节拍踩点与音效编排：${scriptNow.scenes.length} 幕锁定 ${beatMeta.bpm} BPM (${scriptNow.totalDurationSec.toFixed(1)}s)`)
      }
      writeScriptJson(absDir, scriptNow)
    } else if (bgmMode === 'llm-coded' && mode === 'ai-coded' && llmSummary.configured) {
      try {
        const bgmScriptInput = {
          ...scriptNow,
          title: spec.topic || scriptNow.title || scriptNow.topic,
          style,
          totalDurationSec: totalSec + 1.0,
          audioSpec: { ...(scriptNow.audioSpec || {}), mood: style, bpm: scriptNow.bgm?.bpm || 118 },
        }
        const bgmRes = await generateAiCodedBgmTrack({
          projectDir: absDir,
          script: bgmScriptInput,
          callLlmChatFn: (p) => callLlmChat({ timeoutMs: 240_000, ...p, signal }),
        })
        scriptNow.bgm = { ...(scriptNow.bgm || {}), mode: 'llm-coded', source: 'llm-coded', path: bgmRes.relWavPath }
        writeScriptJson(absDir, scriptNow)
        appendLog('audio', `AI 大模型编写 BGM 合成代码完成: ${bgmRes.relWavPath}`)
      } catch (err) {
        appendLog('audio', `大模型编曲配乐回退本地合成引擎: ${err.message}`, 'warn')
      }
    } else if (bgmMode === 'tts-engine') {
      try {
        const ttsBgm = await synthesizeTtsEngineAudioCue({
          projectDir: absDir,
          promptText: spec.bgmTtsPrompt || `${spec.topic || '沉浸光影'} 氛围声场`,
          voiceId: voiceCloneSample?.id || voiceId || 'auto',
          durationSec: totalSec + 1.0,
        })
        scriptNow.bgm = { ...(scriptNow.bgm || {}), mode: 'tts-engine', source: 'tts-engine', path: ttsBgm.relWavPath }
        writeScriptJson(absDir, scriptNow)
      } catch (err) {
        appendLog('audio', `配音引擎氛围配乐回退本地合成: ${err.message}`, 'warn')
      }
    }

    const postBgmScript = readScriptJson(absDir).data
    const curGenreForBeat = String(postBgmScript.genre || spec.genre || '').toLowerCase()
    const adaptiveAudioMeta = {
      genre: postBgmScript.genre || spec.genre,
      genreLabel: postBgmScript.genreLabel || spec.genreLabel,
      title: postBgmScript.title || spec.topic,
      style,
      narrationMode: effectiveNarrationMode,
      pacingMode: postBgmScript.pacingMode || spec.pacingMode,
      audioProfile: postBgmScript.audioProfile,
      referenceStyle: postBgmScript.referenceStyle,
      sfxPick: customSfxPick,
    }
    const wantsBeatSync =
      effectiveNarrationMode === 'subtitle-mv' ||
      effectiveNarrationMode === 'tts-beat-sync' ||
      Boolean(spec.beatSync) ||
      bgmMode === 'uploaded' ||
      curGenreForBeat === 'history-theater' ||
      curGenreForBeat === 'mv-lyric' ||
      postBgmScript.audioProfile?.beatCutIntensity !== 'off'
    if (wantsBeatSync && !(postBgmScript.scenes || []).some((s) => s.beatCutAligned)) {
      const bgmWavRel = postBgmScript.bgm?.path || ''
      const bgmWavAbs = bgmWavRel ? (isAbsolute(bgmWavRel) ? bgmWavRel : resolve(absDir, bgmWavRel)) : ''
      let analyzedSynth = null
      if (bgmWavAbs && existsSync(bgmWavAbs)) {
        try {
          analyzedSynth = await analyzeAudioBeatStructure(bgmWavAbs, { signal })
        } catch {}
      }
      const grid = analyzedSynth?.analyzed
        ? analyzedSynth
        : buildBeatGrid((Number(postBgmScript.totalDurationSec) || totalSec) + 2, Number(postBgmScript.bgm?.bpm) || 120)
      postBgmScript.bgm = { ...(postBgmScript.bgm || {}), ...grid, beats: grid.beats }
      const qMode = effectiveNarrationMode === 'subtitle-mv' ? 'subtitle-mv' : 'tts-beat-sync'
      postBgmScript.scenes = quantizeScenesToBeatGrid(postBgmScript.scenes || [], grid, {
        ...adaptiveAudioMeta,
        mode: qMode,
        fps,
        targetDurationSec: effectiveTargetDurationSec,
      })
      postBgmScript.scenes = choreographBeatSfxCues(postBgmScript.scenes, grid, adaptiveAudioMeta)
      postBgmScript.subtitles = postBgmScript.scenes.flatMap((sc) => sc.subtitles || [])
      const lastSc = postBgmScript.scenes[postBgmScript.scenes.length - 1]
      postBgmScript.totalDurationInFrames = lastSc ? Number(lastSc.startFrame || 0) + Number(lastSc.durationInFrames || 0) : postBgmScript.totalDurationInFrames
      postBgmScript.totalDurationSec = Number(((postBgmScript.totalDurationInFrames || 30) / fps).toFixed(4))
      writeScriptJson(absDir, postBgmScript)
      appendLog('audio', `已对全品类声场执行自适应音画踩点与音效编排 (${qMode} · ${postBgmScript.bgm?.bpm || 120} BPM · ${postBgmScript.scenes.length} 幕)`)
    } else if (durationPolicy.enforced && effectiveTargetDurationSec > 10 && !wantsBeatSync) {
      // Non-beat-sync TTS mode: if user set a strict duration and spoken tracks fell slightly short, add smooth visual breathing cushion
      const curTot = Number(postBgmScript.totalDurationSec) || 0
      const scArr = Array.isArray(postBgmScript.scenes) ? postBgmScript.scenes : []
      if (scArr.length > 0 && curTot > 2 && curTot < durationPolicy.minSec * 0.96) {
        const extraEach = Math.min(3.6, (durationPolicy.targetSec - curTot) / scArr.length)
        for (const sc of scArr) {
          sc.durationSec = Number(((Number(sc.durationSec) || 3.5) + extraEach).toFixed(4))
          sc.durationInFrames = Math.max(15, Math.ceil(sc.durationSec * fps))
        }
        writeScriptJson(absDir, postBgmScript)
        await recomputeCumulativeTimeline(absDir)
      }
    }

    const scriptForMix = readScriptJson(absDir).data
    scriptForMix.bgmMode = bgmMode
    scriptForMix.audioSpec = { ...(scriptForMix.audioSpec || {}), bgmMode }
    if (bgmMode === 'uploaded' && chosenUploadPath) {
      scriptForMix.bgm = { ...(scriptForMix.bgm || {}), enabled: true, mode: 'uploaded', source: 'user-imported', path: chosenUploadPath, uploadedPath: chosenUploadPath }
    }
    let sfxInjected = false
    // Inject user-uploaded custom SFX files (role === 'sfx') onto scene transition/accent points if not already wired
    if (uploadedSfx.length > 0 && Array.isArray(scriptForMix.scenes) && scriptForMix.scenes.length > 0) {
      const alreadyUsed = new Set(
        scriptForMix.scenes.flatMap((s) => (s.sfxCues || []).map((q) => q.path)).filter(Boolean),
      )
      const unusedSfx = uploadedSfx.filter((u) => u.path && !alreadyUsed.has(u.path))
      if (unusedSfx.length > 0) {
        for (let ui = 0; ui < unusedSfx.length; ui++) {
          const targetSc = scriptForMix.scenes[Math.min(scriptForMix.scenes.length - 1, Math.floor(((ui + 0.5) * scriptForMix.scenes.length) / unusedSfx.length))]
          targetSc.sfxCues = Array.isArray(targetSc.sfxCues) ? [...targetSc.sfxCues] : []
          targetSc.sfxCues.push({ type: 'custom', path: unusedSfx[ui].path, offsetSec: 0.12, volume: 0.68, pan: 0 })
          sfxInjected = true
        }
        appendLog('audio', `已将用户上传的 ${unusedSfx.length} 份自定义音效挂入成片分镜混音轨`)
      }
    }
    for (const sc of scriptForMix.scenes || []) {
      const scDur = Math.max(1.0, Number(sc.durationSec) || 4.0)
      sc.sfxCues = Array.isArray(sc.sfxCues) ? [...sc.sfxCues] : []
      if (Array.isArray(sc.cursors) && sc.cursors.length > 0) {
        for (const c of sc.cursors) {
          const clickAtRaw = Number.isFinite(Number(c?.clickAt))
            ? Number(c.clickAt)
            : c?.click
              ? (Number(c?.t) > 1.01 ? Number(c.t) : (Number(c?.t) || 0.45) * scDur)
              : NaN
          if (!Number.isFinite(clickAtRaw) || clickAtRaw < 0) continue
          const clickAt = Number(Math.min(Math.max(0.15, clickAtRaw), Math.max(0.25, scDur - 0.14)).toFixed(2))
          const pan = Number.isFinite(Number(c?.fx)) ? Math.max(-0.4, Math.min(0.4, (Number(c.fx) - 0.5) * 0.7)) : 0
          if (!sc.sfxCues.some((q) => q.type === 'click' && Math.abs(Number(q.offsetSec || 0) - clickAt) < 0.25)) {
            sc.sfxCues.push({ type: 'click', path: 'audio/sfx/click.wav', offsetSec: clickAt, volume: 0.68, pan })
            sfxInjected = true
          }
          const lbl = `${c?.label || ''} ${sc.visualBlueprint || ''}`
          if (/抽屉|展开|打开|弹窗|新建|菜单|切换|滑出/.test(lbl)) {
            const wAt = Number(Math.min(scDur - 0.1, clickAt + 0.16).toFixed(2))
            if (!sc.sfxCues.some((q) => q.type === 'whoosh' && Math.abs(Number(q.offsetSec || 0) - wAt) < 0.35)) {
              sc.sfxCues.push({ type: 'whoosh', path: 'audio/sfx/whoosh.wav', offsetSec: wAt, volume: 0.46, pan: pan * 0.5 })
              sfxInjected = true
            }
          }
          if (/输入|打字|填写|润色|提示词/.test(lbl)) {
            const tAt = Number(Math.min(scDur - 0.35, clickAt + 0.26).toFixed(2))
            if (!sc.sfxCues.some((q) => q.type === 'typing' && Math.abs(Number(q.offsetSec || 0) - tAt) < 0.45)) {
              sc.sfxCues.push({ type: 'typing', path: 'audio/sfx/typing.wav', offsetSec: tAt, volume: 0.36, pan: 0, d: 0.6 })
              sfxInjected = true
            }
          }
        }
      } else if (scriptForMix.genre === 'ui-tutorial' && (Array.isArray(sc.media) && sc.media.length > 0)) {
        const bp = `${sc.title || ''} ${sc.visualBlueprint || ''} ${sc.narration || ''}`
        if (/点击|新建|打开|抽屉|按钮|切换|启动/.test(bp) && !sc.sfxCues.some((q) => q.type === 'click')) {
          sc.sfxCues.push({ type: 'click', path: 'audio/sfx/click.wav', offsetSec: Number(Math.min(scDur - 0.25, 1.05).toFixed(2)), volume: 0.64, pan: 0 })
          sfxInjected = true
        }
        if (/抽屉|展开|打开|滑出|弹窗|页面/.test(bp) && !sc.sfxCues.some((q) => q.type === 'whoosh')) {
          sc.sfxCues.push({ type: 'whoosh', path: 'audio/sfx/whoosh.wav', offsetSec: Number(Math.min(scDur - 0.2, 1.22).toFixed(2)), volume: 0.45, pan: 0 })
          sfxInjected = true
        }
        if (/输入|打字|填写|润色|提示词/.test(bp) && !sc.sfxCues.some((q) => q.type === 'typing')) {
          sc.sfxCues.push({ type: 'typing', path: 'audio/sfx/typing.wav', offsetSec: Number(Math.min(scDur - 0.4, 1.45).toFixed(2)), volume: 0.35, pan: 0, d: 0.6 })
          sfxInjected = true
        }
      }
    }
    if (sfxInjected) {
      writeScriptJson(absDir, scriptForMix)
    }

    await ensureProjectAudioAssets(absDir, scriptForMix, assetsNow)
    await mixVideoAudio({
      projectDir: absDir,
      script: scriptForMix,
      assetsManifest: assetsNow,
      outputPath: join(absDir, 'output', 'master-audio.wav'),
      signal,
      onChild,
    })

    updateTask('t-audio', {
      status: 'completed',
      progress: 100,
      message: '配音混音完成：人声母带 + SFX + 闪避 BGM 已混录为 output/master-audio.wav',
    })
  }

  // Optional Avatar Subtask (`t-avatar`)
  if (spec.avatarEnabled && !isDoneTask(run, 't-avatar')) {
    await waitIfPaused('t-avatar')
    updateTask('t-avatar', {
      status: 'running',
      progress: 12,
      message: '数字人引擎启动：正在准备口播人声与透明通道合成...',
    })
    const scriptForAvatar = readScriptJson(absDir).data
    const assetsAv = readAssets(absDir)
    const avatarBase =
      spec.avatarSourcePath ||
      (assetsAv.items || []).find((it) => it.role === 'avatar_base')?.path ||
      (assetsAv.items || []).find((it) => it.role === 'host_video')?.path ||
      ''
    const voiceCloneItem = (assetsAv.items || []).find((it) => it.role === 'voice_clone')
    const drivingWav = await buildCombinedDryVoiceWav(absDir, scriptForAvatar, signal, onChild)

    const isImgBase = avatarBase && /\.(jpg|jpeg|png|webp|bmp)$/i.test(avatarBase)
    const avResult = await executeGenerateAvatar({
      projectDir: absDir,
      avatarMode: spec.avatarMode || (avatarBase ? 'cloned-human' : 'ai-human'),
      sourceVideoPath: !isImgBase ? avatarBase : '',
      sourceImagePath: isImgBase ? avatarBase : '',
      voiceId,
      voiceSamplePath: spec.voiceSamplePath || voiceCloneItem?.path || '',
      voiceGender: spec.voiceGender || 'neutral',
      narrationText: (scriptForAvatar.scenes || []).map((s) => s.narration).filter(Boolean).join('。'),
      audioPath: drivingWav,
      avatarLayout: spec.avatarLayout || scriptForAvatar.avatarLayout || 'pip-br',
      presetId: spec.avatarPresetId || 'cyber-anchor',
      chromaKeyColor: spec.avatarChromaKeyColor || '',
      fps: Number(scriptForAvatar.fps) || 30,
      allowPlaceholder,
      signal,
      onProgress: (p) => {
        updateTask('t-avatar', {
          status: 'running',
          progress: Math.max(15, Math.min(96, Number(p.progress) || 50)),
          message: p.message || '数字人生成中...',
          log: false,
        })
      },
    })

    updateTask('t-avatar', {
      status: 'completed',
      progress: 100,
      message: avResult?.visualNotice || '透明通道数字人叠层 (yuva420p WebM) 已挂载到视频时间轴',
    })
  }

  // =========================================================================
  // AGENT 4a: 动效质检 Agent — 动效编码 + video_lint + video_snapshot (t-motion)
  // =========================================================================
  if (!isDoneTask(run, 't-motion')) {
    await waitIfPaused('t-motion')
    updateTask('t-motion', {
      status: 'running',
      progress: 15,
      message: `动效质检 Agent 启动：正在生成 ${engine.toUpperCase()} 动效工程与透明数字人叠层...`,
    })

    const curScript = readScriptJson(absDir).data
    curScript.mediaDims = buildMediaDimsMap(readAssets(absDir), curScript)
    const enableAiCode = spec.aiAuthorCode !== undefined ? Boolean(spec.aiAuthorCode) : mode === 'ai-coded'
    if (enableAiCode && llmSummary.configured) {
      curScript.authoringMode = 'ai-coded'
    }
    syncProjectCodeFromScript(absDir, curScript, { forceOverwrite: true })

    if (mode === 'ai-coded' && llmSummary.configured && enableAiCode) {
      try {
        updateTask('t-motion', {
          status: 'running',
          progress: 35,
          message: `动效质检 Agent 正在分批召唤大模型 (${llmSummary.model}) 手写定制 ${engine === 'remotion' ? 'Remotion TSX' : 'HyperFrames HTML'} 动效模块...`,
        })

        let repairRes = null
        if (engine === 'remotion') {
          const isHeavyNarrative =
            String(curScript.genre || '').toLowerCase() === 'history-theater' ||
            String(curScript.genre || '').toLowerCase() === 'mv-lyric' ||
            curScript.narrationMode === 'subtitle-mv'
          repairRes = await authorBatchedRemotionScenes({
            absDir,
            lockedScript: curScript,
            llmConfig: spec.llmOverride || {},
            batchSize: isHeavyNarrative ? 4 : (curScript.scenes || []).length >= 16 ? 5 : 4,
            concurrency: Math.max(2, hwPolicy.batchCoderConcurrency || 3),
            maxRepairRounds: Math.max(1, Math.min(3, Number(llmSummary.maxRepairRounds) || 2)),
            signal,
            onProgress: (_stage, pct, msg) => {
              updateTask('t-motion', {
                status: 'running',
                progress: Math.max(38, Math.min(68, Number(pct) || 55)),
                message: msg || '大模型正在逐镜手写并自检 TSX 代码...',
                log: false,
              })
            },
          })
        } else {
          const promptPkg = buildHtmlCoderSkillsPrompt({
            plan: curScript,
            timingContract: curScript,
            width: curScript.width,
            height: curScript.height,
            aspectRatio: curScript.aspectRatio,
          })
          const aiReply = await callLlmChat({
            system: promptPkg.system,
            messages: [{ role: 'user', content: promptPkg.user }],
            temperature: 0.3,
            maxTokens: 15000,
            signal,
          })
          const parsedFiles = extractJsonFromLlmText(aiReply.text)?.files
          if (parsedFiles && typeof parsedFiles === 'object') {
            repairRes = await runCodeAutoRepairLoop({
              absDir,
              engine,
              systemPrompt: promptPkg.system,
              initialFiles: parsedFiles,
              lockedScript: curScript,
              maxRepairRounds: Math.max(1, Math.min(3, Number(llmSummary.maxRepairRounds) || 2)),
              signal,
              onProgress: (_stage, pct, msg) => {
                updateTask('t-motion', {
                  status: 'running',
                  progress: Math.max(45, Math.min(68, Number(pct) || 55)),
                  message: msg || 'AI 代码自检与自动修复中...',
                  log: false,
                })
              },
            })
          }
        }

        const hasValidAiCode =
          engine === 'remotion'
            ? Number(repairRes?.authoredBatchCount || 0) > 0
            : Boolean(repairRes?.files?.['index.html'])

        if (repairRes?.ok && hasValidAiCode) {
          curScript.authoringMode = 'ai-coded'
          curScript.aiMeta = {
            ...(curScript.aiMeta || {}),
            model: llmSummary.model,
            protocol: llmSummary.protocol,
            authoredBatchCount: Number(repairRes.authoredBatchCount || 1),
            totalBatches: Number(repairRes.totalBatches || 1),
            isolatedBatches: repairRes.isolatedBatches || [],
            batchErrors: repairRes.batchErrors || [],
            generatedFiles: Object.keys(repairRes.files || {}),
            builtAt: new Date().toISOString(),
          }
          writeScriptJson(absDir, curScript)
          if (engine === 'remotion') {
            try {
              writeFileSync(join(absDir, 'index.html'), buildRichHtmlVideo(curScript), 'utf8')
            } catch {}
          }
          mkdirSync(join(absDir, 'output'), { recursive: true })
          writeFileSync(
            join(absDir, 'output', 'ai_build_log.json'),
            JSON.stringify(
              {
                ok: true,
                engine,
                model: llmSummary.model,
                protocol: llmSummary.protocol,
                authoredBatchCount: Number(repairRes.authoredBatchCount || 0),
                totalBatches: Number(repairRes.totalBatches || 1),
                isolatedBatches: repairRes.isolatedBatches || [],
                batchErrors: repairRes.batchErrors || [],
                repairHistory: repairRes.repairHistory || [],
                generatedFiles: Object.keys(repairRes.files || {}),
                builtAt: new Date().toISOString(),
              },
              null,
              2,
            ) + '\n',
            'utf8',
          )
          appendLog(
            'motion_qa',
            `大模型 (${llmSummary.model}) 定制 TSX 动效代码通过沙箱、Lint 与 tsc 编译质检（成功模块: ${Number(repairRes.authoredBatchCount || 0)}/${Number(repairRes.totalBatches || 1)} 批，修复轮次: ${Math.max(0, (repairRes.repairHistory?.length || 1) - 1)}${repairRes.batchErrors?.length ? `，异常批次: ${repairRes.batchErrors.join('; ')}` : ''}）`,
          )
        } else {
          curScript.authoringMode = 'schema-plan'
          writeScriptJson(absDir, curScript)
          appendLog(
            'motion_qa',
            `AI 动效代码自动修复后仍未通过质检，自动回退高稳内置模板: ${(repairRes?.errors || []).slice(0, 3).join('; ')}`,
            'warn',
          )
          syncProjectCodeFromScript(absDir, readScriptJson(absDir).data, { forceOverwrite: true })
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
        curScript.authoringMode = 'schema-plan'
        writeScriptJson(absDir, curScript)
        appendLog('motion_qa', `大模型动效定制已回退高稳内置模板: ${err.message}`, 'warn')
        syncProjectCodeFromScript(absDir, readScriptJson(absDir).data, { forceOverwrite: true })
      }
    }

    if (signal.aborted) throw createAbortError()
    await waitIfPaused('t-motion')
    updateTask('t-motion', {
      status: 'running',
      progress: 70,
      message: '正在执行 video_lint 合规检测与九宫格视觉快照预检...',
    })
    const lintRes = await executeVideoLint({ projectDir: absDir })
    let snapRes = null
    try {
      snapRes = await executeVideoSnapshot({ projectDir: absDir })
    } catch (err) {
      if (err?.name === 'AbortError' || signal.aborted) throw createAbortError()
      appendLog('motion_qa', `九宫格预检跳过: ${err.message}`, 'warn')
    }
    updateTask('t-motion', {
      status: 'completed',
      progress: 100,
      message: `动效质检完成：Lint ${lintRes.passed ? '通过' : '带警告'} · 九宫格快照${snapRes?.ok ? '已生成' : '略过'}`,
    })
  }

  // =========================================================================
  // AGENT 4b: 高清 MP4 渲染交付 (t-render)
  // =========================================================================
  let finalRender = null
  if (!isDoneTask(run, 't-render')) {
    await waitIfPaused('t-render')
    updateTask('t-render', {
      status: 'running',
      progress: 8,
      message: `正在启动 ${engine.toUpperCase()} 全帧率高清渲染与自动音画质检...`,
    })

    finalRender = await executeVideoRender({
      projectDir: absDir,
      engine,
      signal,
      onProgress: (p) => {
        const rawPct = p && typeof p === 'object' ? (p.progress ?? p.pct) : undefined
        updateTask('t-render', {
          status: 'running',
          progress: Math.max(8, Math.min(97, Number(rawPct) || 50)),
          message: p?.message || '全帧率编码渲染中...',
          log: false,
        })
      },
    })

    updateTask('t-render', {
      status: 'completed',
      progress: 100,
      message: `成品导出成功：${finalRender.resolution} · ${finalRender.durationSec}s (${Math.round((finalRender.fileSizeBytes || 0) / 1024)} KB)`,
    })
  }

  return {
    ok: true,
    projectDir: absDir,
    engine,
    mode,
    outputPath: finalRender?.outputPath || join(absDir, 'output', 'final.mp4'),
    snapshotPath: finalRender?.snapshotPath || join(absDir, 'output', 'snapshot-3x3.png'),
    qa: finalRender?.qaReport || finalRender?.qa || null,
  }
}

// Register default runner factory so historical persisted runs remain retryable across daemon restarts
taskManager.setDefaultRunnerFactory(() => executeMultiAgentRunner)

/**
 * Start a 4-Agent pipeline in the background (returns immediately with runId + initial status).
 */
function createNormalizedPipelineRun(spec = {}) {
  if (!spec.projectDir) throw new Error('projectDir is required')
  const { modeLabel, mode } = resolvePipelineMode(spec.mode)
  const briefView = splitDirectorBrief(spec)
  return taskManager.createRun({
    projectDir: spec.projectDir,
    title: `${modeLabel} · ${briefView.displayTitle || '视觉作品'}`,
    topic: briefView.topic || '',
    mode,
    spec,
  })
}

export async function startPipelineBackground(spec = {}) {
  const run = createNormalizedPipelineRun(spec)
  const started = await taskManager.startRun(run.id, executeMultiAgentRunner)
  started.promise.catch(() => {})
  return started.run
}

/**
 * Synchronous pipeline entrypoint for MCP/Cordis tool call `run_agent_pipeline`.
 */
export async function runMultiAgentPipeline(spec = {}) {
  const run = createNormalizedPipelineRun(spec)
  const started = await taskManager.startRun(run.id, executeMultiAgentRunner)
  const completed = await started.promise
  const summary = completed?.resultSummary || {}
  return {
    ...completed,
    ok: completed?.status === 'completed' && summary?.ok !== false,
    outputPath: summary?.outputPath || null,
    snapshotPath: summary?.snapshotPath || null,
    qa: summary?.qa || null,
  }
}
