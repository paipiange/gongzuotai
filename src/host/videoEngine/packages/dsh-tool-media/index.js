/**
 * @dsh-video/tool-media
 * Cordis plugin registering user asset management, procedural SFX/BGM synthesis,
 * multi-track audio mixing, AI storyboard planning, and one-click full video production.
 */
import { join, resolve } from 'node:path'
import { readScriptJson, writeScriptJson } from '../shared/index.js'
import { executeGenerateSpeech, getActiveTtsEngineId } from '../dsh-tool-local-tts/index.js'
import {
  importAssets,
  readAssets,
  removeAsset,
  saveUploadedAsset,
  summarizeAssets,
  updateAsset,
} from './asset-manager.js'
import {
  analyzeAudioBeatStructure,
  choreographBeatSfxCues,
  ensureProjectAudioAssets,
  generateBgmWav,
  generateSfxWav,
  mixVideoAudio,
  quantizeScenesToBeatGrid,
} from './audio-synth.js'
import {
  planVideoFromAssets,
  syncProjectCodeFromScript,
} from './ai-director.js'
import { buildRichHtmlVideo } from './html-generator.js'
import { syncRemotionPublicAssets, writeRemotionProjectFiles } from './remotion-generator.js'
import {
  WIRE_PROTOCOLS,
  discoverDshClientConfig,
  getSafeLlmConfigSummary,
  saveLlmConfig,
  testLlmConnection,
  fetchAvailableModels,
  callLlmChat,
} from './llm-client.js'
import {
  masterVoiceTracks,
  probeVoiceAcousticTelemetry,
} from './voice-master.js'
import {
  authorBatchedRemotionScenes,
  getAiCodingHistory,
  refineAiScene,
  rollbackAiVersion,
  runAiStudioPipeline,
} from './ai-coder.js'
import { executeCurateAndEditAssets } from './media-editor.js'
import { generateAiCodedSfxCues } from './audio-coder.js'
import { runMultiAgentPipeline, startPipelineBackground } from './pipeline-orchestrator.js'
import { taskManager } from './task-manager.js'
import {
  generateAiCodedBgmTrack,
  synthesizeTtsEngineAudioCue,
} from './audio-coder.js'
import {
  normalizeTransitionKind,
  PROMO_SHOT_RECIPES,
  runSchemaDirectorWithDegradation,
  VALID_TRANSITIONS,
} from './plan-schema.js'
import { buildMediaDimsMap, groundVisualAssets, loadSidecarAnchors } from './vision-grounding.js'
import { exportPublishPack } from './publish-pack.js'
import { registerVendorClip, renderVendorClipIsolated } from './vendor-clip.js'
import {
  analyzeReferenceVideo,
  buildMotionMarkdown,
  exportProjectMotionMd,
  loadBrandKit,
  saveBrandKit,
} from './reference-analyzer.js'
import {
  CLOUD_MEDIA_PRESETS,
  generateCloudMediaAsset,
  getCloudMediaConfigSummary,
  loadCloudMediaConfig,
  saveCloudMediaConfig,
} from './cloud-media.js'
import {
  applyPlazaTemplateToProject,
  getPlazaTemplate,
  listPlazaTemplates,
  PLAZA_BRAND,
  PLAZA_CATEGORIES,
  publishProjectToPlaza,
} from './template-plaza.js'

export {
  analyzeAudioBeatStructure,
  analyzeReferenceVideo,
  buildMotionMarkdown,
  exportProjectMotionMd,
  loadBrandKit,
  saveBrandKit,
  choreographBeatSfxCues,
  quantizeScenesToBeatGrid,
  importAssets,
  readAssets,
  removeAsset,
  saveUploadedAsset,
  summarizeAssets,
  updateAsset,
  ensureProjectAudioAssets,
  generateBgmWav,
  generateSfxWav,
  mixVideoAudio,
  generateAiCodedBgmTrack,
  synthesizeTtsEngineAudioCue,
  PROMO_SHOT_RECIPES,
  VALID_TRANSITIONS,
  normalizeTransitionKind,
  runSchemaDirectorWithDegradation,
  groundVisualAssets,
  loadSidecarAnchors,
  buildMediaDimsMap,
  exportPublishPack,
  registerVendorClip,
  renderVendorClipIsolated,
  masterVoiceTracks,
  probeVoiceAcousticTelemetry,
  planVideoFromAssets,
  syncProjectCodeFromScript,
  buildRichHtmlVideo,
  syncRemotionPublicAssets,
  writeRemotionProjectFiles,
  WIRE_PROTOCOLS,
  discoverDshClientConfig,
  getSafeLlmConfigSummary,
  saveLlmConfig,
  testLlmConnection,
  fetchAvailableModels,
  callLlmChat,
  authorBatchedRemotionScenes,
  runAiStudioPipeline,
  refineAiScene,
  rollbackAiVersion,
  getAiCodingHistory,
}

/**
 * One-click full production pipeline:
 * 1. Import user sources (images/videos/music/sfx/notes)
 * 2. AI plan storyboard, copy, VFX, camera motion, SFX cues & BGM
 * 3. Synthesize REAL human voice narration per scene (IndexTTS-2) + ffprobe duration backfill
 * 4. Generate HTML5 & Remotion code + lint
 * 5. Multi-track audio mix + full-FPS dual-engine MP4 render + 3x3 snapshot
 */
export async function produceFullVideo(options = {}) {
  const {
    projectDir,
    sources,
    title,
    topic,
    style = 'tech',
    engine = 'html',
    aspectRatio = 'auto',
    quality = '1080p',
    width,
    height,
    aiBadge = true,
    targetPlatform = 'universal',
    bgmMode = 'auto',
    voiceId = 'auto',
    ttsEngine,
    allowPlaceholder = false,
    fps,
    renderWidth,
    renderHeight,
    scenesSpec,
    workflowSteps,
    brandMark,
    curateAssets = false,
    masterVoice = true,
    useLlmMastering = false,
    onProgress,
  } = options

  if (!projectDir) throw new Error('projectDir is required')
  const absDir = resolve(projectDir)

  if (curateAssets) {
    onProgress?.('0/5 正在智能筛选与无损分辨率适配素材...')
    if (sources && (Array.isArray(sources) ? sources.length > 0 : true)) {
      await importAssets({ projectDir: absDir, sources })
    }
    await executeCurateAndEditAssets({ projectDir: absDir, style, quality, aspectRatio })
  }

  onProgress?.('1/5 正在导入并分析素材（本地草稿快速生成）...')
  const planned = await planVideoFromAssets({
    projectDir: absDir,
    sources: curateAssets ? undefined : sources,
    title,
    topic,
    style,
    engine,
    aspectRatio,
    quality,
    width,
    height,
    aiBadge,
    voiceId,
    scenesSpec,
    workflowSteps,
    brandMark,
    ...(fps ? { fps: Number(fps) } : {}),
  })

  onProgress?.('2/5 正在启动本地配音引擎并逐幕生成真人配音...')
  let curScript = planned.script
  for (let i = 0; i < (curScript.scenes || []).length; i++) {
    const s = curScript.scenes[i]
    onProgress?.(`2/5 正在配音 (${i + 1}/${curScript.scenes.length}): ${s.title}`)
    await executeGenerateSpeech({
      text: s.narration,
      emotion: s.emotion || '平静',
      voiceId: s.voiceId || voiceId || 'auto',
      engine: ttsEngine || getActiveTtsEngineId(),
      speed: Number(s.speechRate) || 1.0,
      fps: curScript.fps || 30,
      outputPath: join(absDir, 'audio', `${s.id}.wav`),
      scriptPath: absDir,
      sceneId: s.id,
      allowPlaceholder,
    })
  }

  if (masterVoice && !allowPlaceholder) {
    try {
      onProgress?.('2.5/5 正在进行 AI 人声声学探测与广播级修音...')
      await masterVoiceTracks({
        projectDir: absDir,
        useLlm: Boolean(useLlmMastering),
        remixMasterAudio: false,
      })
    } catch {}
  }

  curScript = readScriptJson(absDir).data
  curScript.targetPlatform = targetPlatform || curScript.targetPlatform || 'universal'
  if (bgmMode && bgmMode !== 'auto') {
    curScript.bgmMode = bgmMode
    curScript.audioSpec = { ...(curScript.audioSpec || {}), bgmMode }
  }
  curScript = writeScriptJson(absDir, curScript).data
  onProgress?.('3/5 正在生成双引擎画面工程（商用字体/安全区/动效/字幕）...')
  syncProjectCodeFromScript(absDir, curScript)

  const { executeVideoLint, executeVideoRender } = await import('../dsh-tool-video-suite/index.js')
  const lint = await executeVideoLint({ projectDir: absDir, engine })
  if (!lint.ok) {
    throw new Error(`video_lint failed before render: ${lint.errors.join('; ')}`)
  }

  onProgress?.('4/5 正在混音（人声 + 音效 + 自动闪避配乐）并逐帧渲染 MP4...')
  const rendered = await executeVideoRender({
    projectDir: absDir,
    engine,
    renderWidth,
    renderHeight,
    onProgress: ({ frame, totalFrames, pct }) =>
      onProgress?.(`4/5 正在逐帧合成高清视频 (${frame}/${totalFrames} 帧 · ${pct}%)...`),
  })

  onProgress?.('5/5 制作完成！')
  return {
    ok: true,
    projectDir: absDir,
    engine,
    script: readScriptJson(absDir).data,
    assetsSummary: summarizeAssets(readAssets(absDir)),
    lint,
    render: rendered,
  }
}

export const name = 'dsh-tool-media'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'import_assets',
    description:
      'Import user media files or folders (images, videos, background music, sound effects, and text notes) into a video project and measure each file via ffprobe.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of local file or folder paths containing user assets.',
        },
      },
      required: ['projectDir', 'sources'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await importAssets(args)
    },
  })

  ctx.tools.register({
    name: 'list_assets',
    description: 'List all imported images, videos, music, sound effects, and notes in a video project.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const m = readAssets(args.projectDir)
      return { ok: true, summary: summarizeAssets(m), ...m }
    },
  })

  ctx.tools.register({
    name: 'generate_sfx_bgm',
    description:
      'Generate studio-grade sound effects (whoosh, impact, pop, chime, riser) and mood-matched background music WAVs, and mix them with voice narration into master-audio.wav.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        mood: {
          type: 'string',
          enum: ['tech', 'cinematic', 'warm', 'energetic', 'emerald'],
          description: 'Music mood when generating BGM.',
        },
        mixMaster: { type: 'boolean', description: 'If true, mix voice + SFX + BGM into output/master-audio.wav.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const { data: script } = readScriptJson(args.projectDir)
      if (args.mood) {
        script.bgm = { ...(script.bgm || {}), mood: args.mood }
      }
      const assets = readAssets(args.projectDir)
      const audioAssets = await ensureProjectAudioAssets(args.projectDir, script, assets)
      if (args.mixMaster) {
        const mix = await mixVideoAudio({ projectDir: args.projectDir, script, assetsManifest: assets })
        return { ok: true, ...audioAssets, mix }
      }
      return { ok: true, ...audioAssets }
    },
  })

  ctx.tools.register({
    name: 'plan_video_from_assets',
    description:
      'Analyze imported project assets and user topic/style to generate a complete storyboard (script.json) with copy, camera motion, VFX, SFX cues, BGM, and HTML/Remotion scene code.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Optional paths to import first.' },
        title: { type: 'string', description: 'Video title.' },
        topic: { type: 'string', description: 'Creative brief or topic.' },
        style: {
          type: 'string',
          enum: ['tech', 'cinematic', 'documentary', 'energetic', 'warm', 'emerald'],
          description: 'Visual and musical style.',
        },
        engine: { type: 'string', enum: ['html', 'remotion'], description: 'Target render engine.' },
        aspectRatio: { type: 'string', enum: ['auto', '16:9', '9:16', '3:4', '1:1', 'custom'], description: 'Aspect ratio preset or auto AI selection.' },
        quality: { type: 'string', enum: ['720p', '1080p', '2k', '4k', 'custom'], description: 'Output resolution tier.' },
        width: { type: 'number', description: 'Optional custom width (even integer >= 320).' },
        height: { type: 'number', description: 'Optional custom height (even integer >= 320).' },
        aiBadge: { type: 'boolean', description: 'Whether to show an optional AI badge corner watermark.' },
        fps: { type: 'number', description: 'Target frame rate (e.g. 30 or 60).' },
        voiceId: { type: 'string', description: 'Voice ID or "auto" for AI voice matching.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await planVideoFromAssets(args)
    },
  })

  ctx.tools.register({
    name: 'produce_video',
    description:
      'Local Draft one-click production: import assets -> storyboard -> local IndexTTS-2 narration -> HTML/Remotion code -> SFX/BGM ducked mix -> MP4.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Optional local media folders or files to import.' },
        title: { type: 'string', description: 'Video title.' },
        topic: { type: 'string', description: 'Topic / prompt.' },
        style: { type: 'string', enum: ['tech', 'cinematic', 'documentary', 'energetic', 'warm', 'emerald'] },
        engine: { type: 'string', enum: ['html', 'remotion'] },
        aspectRatio: { type: 'string', enum: ['auto', '16:9', '9:16', '3:4', '1:1', 'custom'] },
        quality: { type: 'string', enum: ['720p', '1080p', '2k', '4k', 'custom'] },
        width: { type: 'number', description: 'Optional custom width.' },
        height: { type: 'number', description: 'Optional custom height.' },
        aiBadge: { type: 'boolean', description: 'Optional corner AI badge.' },
        fps: { type: 'number', description: 'Target frame rate (e.g. 30 or 60).' },
        voiceId: { type: 'string', description: 'Voice ID or "auto".' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await produceFullVideo(args)
    },
  })

  ctx.tools.register({
    name: 'get_llm_config',
    description: 'Inspect current external LLM configuration (masked key status, baseUrl, model, protocol).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 10_000,
    isConcurrencySafe: () => true,
    async execute() {
      return getSafeLlmConfigSummary()
    },
  })

  ctx.tools.register({
    name: 'configure_llm_model',
    description:
      'Configure model settings: default follows live DSH client configuration (`mode: "follow-dsh"`), or customize any endpoint across all 4 wire protocols (`openai-completions`, `anthropic-messages`, `openai-responses`, `gemini-native`).',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['follow-dsh', 'custom'], description: 'follow-dsh inherits DSH client active provider/model/key; custom uses plugin fields.' },
        dshProviderId: { type: 'string', description: 'Optional specific DSH provider ID from cordis.patch.yml (or "active" to track DSH active selection).' },
        provider: { type: 'string', description: 'Preset template ID (custom, anthropic, openai, gemini, deepseek, openrouter, ollama).' },
        format: {
          type: 'string',
          enum: ['auto', 'openai-completions', 'anthropic-messages', 'openai-responses', 'gemini-native', 'openai', 'anthropic'],
          description: 'API wire protocol format.',
        },
        baseUrl: { type: 'string', description: 'LLM API Base URL.' },
        apiKey: { type: 'string', description: 'API Key (never logged or returned).' },
        model: { type: 'string', description: 'Target model ID string (e.g. claude-opus-5-5, gpt-6.1-sol, gemini-2.5-pro).' },
        maxRepairRounds: { type: 'number', description: 'Max compiler/lint self-repair attempts (1-5).' },
        runTest: { type: 'boolean', description: 'If true, also test endpoint connectivity.' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const saved = saveLlmConfig(args)
      if (args.runTest) {
        const test = await testLlmConnection(args)
        return { ...saved, test }
      }
      return saved
    },
  })

  ctx.tools.register({
    name: 'ai_master_voice',
    description:
      'Probe acoustic telemetry (LUFS loudness, true peak, crest, silence) on post-TTS scene vocals and use the configured AI LLM (or adaptive studio fallback) + FFmpeg DSP to master every voice track into `audio/mastered/<scene>.wav` and re-mix `output/master-audio.wav`.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sceneIds: { type: 'array', items: { type: 'string' }, description: 'Optional subset of scene IDs to master (defaults to all scenes with WAVs).' },
        useLlm: { type: 'boolean', description: 'Consult configured AI LLM for acoustic mastering EQ/compression/reverb specs (default true).' },
        remixMasterAudio: { type: 'boolean', description: 'Re-mix mastered vocals + SFX + ducked BGM into output/master-audio.wav (default true).' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 180_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const report = await masterVoiceTracks({
        projectDir: args.projectDir,
        sceneIds: args.sceneIds,
        useLlm: args.useLlm !== false,
      })
      if (args.remixMasterAudio !== false) {
        const assets = readAssets(args.projectDir)
        await mixVideoAudio({ projectDir: args.projectDir, script: report.script, assetsManifest: assets })
        syncRemotionPublicAssets(args.projectDir, report.script)
      }
      return report
    },
  })

  ctx.tools.register({
    name: 'ai_create_video',
    description:
      'Use the configured LLM coding model + local IndexTTS-2.5 voices + AI post-TTS voice mastering to author bespoke Remotion TSX or HyperFrames HTML code, custom DSP BGM/SFX, run TypeScript & lint auto-repair (up to 3 rounds), and render + QA the final MP4.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Optional local asset folders or files.' },
        topic: { type: 'string', description: 'Creative brief or video topic.' },
        userPrompt: { type: 'string', description: 'Detailed visual, pacing, or aesthetic instructions for the AI director/coder.' },
        engine: { type: 'string', enum: ['remotion', 'html'], description: 'Output engine (remotion strongly recommended for AI coding).' },
        creationMode: { type: 'string', enum: ['ai-coded', 'schema-plan'], description: 'ai-coded for max creative ceiling or schema-plan for 4-tier degradation reliability.' },
        bgmMode: { type: 'string', enum: ['llm-coded', 'uploaded', 'tts-engine'], description: 'BGM synthesis mode: llm-coded (LLM writes JS DSP synth code), uploaded (user track), or tts-engine (IndexTTS-2.5 atmospheric).' },
        narrationMode: { type: 'string', enum: ['tts', 'tts-beat-sync', 'subtitle-mv'], description: 'Narration rhythm mode: tts (standard spoken narration), tts-beat-sync (spoken TTS + cut snapped to BGM downbeats), or subtitle-mv (pure beat-locked music/animation with bold subtitles & SFX, no voiceover).' },
        targetDurationSec: { type: 'number', description: 'Optional target total duration in seconds when generating a beat-synced MV.' },
        targetPlatform: { type: 'string', enum: ['universal', 'douyin', 'kuaishou', 'xiaohongshu', 'bilibili'], description: 'Target publishing platform safe zone preset.' },
        aspectRatio: { type: 'string', enum: ['auto', '16:9', '9:16', '3:4', '1:1', 'custom'], description: 'auto lets AI select from topic/assets; or specify exact ratio.' },
        quality: { type: 'string', enum: ['720p', '1080p', '2k', '4k', 'custom'], description: 'Output quality preset.' },
        width: { type: 'number', description: 'Custom pixel width.' },
        height: { type: 'number', description: 'Custom pixel height.' },
        voiceId: { type: 'string', description: 'Voice ID or "auto".' },
        aiBadge: { type: 'boolean', description: 'Show optional AI corner attribution badge.' },
        aiBadgeEnabled: { type: 'boolean', description: 'Explicit toggle to enable/disable AI attribution corner badge.' },
        aiBadgePosition: { type: 'string', enum: ['top-right', 'top-left', 'bottom-right', 'bottom-left'], description: 'Corner placement for the AI attribution badge.' },
        aiBadgeText: { type: 'string', description: 'Custom text inside the AI attribution badge.' },
        pacingMode: { type: 'string', enum: ['auto', 'calm', 'balanced', 'dynamic'], description: 'Narrative pacing preset: auto (smart topic fit), calm, balanced, or dynamic.' },
        useDraftReference: { type: 'boolean', description: 'Read existing local draft script/WAVs as pacing baseline.' },
        render: { type: 'boolean', description: 'Whether to immediately render MP4 and run FFmpeg QA.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await runAiStudioPipeline(args)
    },
  })

  ctx.tools.register({
    name: 'ai_refine_scene',
    description:
      'Apply a natural-language modification request to an AI-coded scene or rollback to the previous snapshot.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sceneId: { type: 'string', description: 'Target scene ID (or omit for global polish).' },
        instruction: { type: 'string', description: 'Natural language editing request.' },
        rollback: { type: 'boolean', description: 'If true, restore the previous saved snapshot instead of editing.' },
        render: { type: 'boolean', description: 'Re-render MP4 after passing code validation.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (args.rollback) return rollbackAiVersion(args.projectDir)
      return await refineAiScene(args)
    },
  })

  ctx.tools.register({
    name: 'video_qa',
    description: 'Run FFmpeg automated post-render quality check (blackdetect + EBU R128 loudness + stream/duration match) on an MP4.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        mp4Path: { type: 'string', description: 'Optional MP4 file path (defaults to output/final.mp4).' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 90_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const { runPostRenderQa } = await import('../dsh-tool-video-suite/index.js')
      const script = readScriptJson(args.projectDir).data
      return await runPostRenderQa({ projectDir: args.projectDir, mp4Path: args.mp4Path, script })
    },
  })

  ctx.tools.register({
    name: 'export_publish_pack',
    description: 'Export a ready-to-publish platform bundle (MP4, cover PNG, 3x3 grid, QA report, and meta.md titles/tags/AI compliance statement).',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        platform: { type: 'string', enum: ['universal', 'douyin', 'kuaishou', 'xiaohongshu', 'bilibili'], description: 'Target platform preset.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return await exportPublishPack(args)
    },
  })

  ctx.tools.register({
    name: 'import_vendor_motion',
    description: 'Render an external third-party HTML/.motion directory in isolated headless Chromium, strip audio (-an), and import as a project video asset.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        sourceDir: { type: 'string', description: 'External .motion template folder path.' },
        name: { type: 'string', description: 'Short bundle name.' },
        durationSec: { type: 'number', description: 'Clip duration seconds (default 4).' },
      },
      required: ['projectDir', 'sourceDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 120_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await renderVendorClipIsolated(args)
    },
  })

  ctx.tools.register({
    name: 'curate_and_edit_assets',
    description:
      'Use FFmpeg to smart-crop, color-grade, speed-scale, trim, and optionally chroma-key matte Step 1 imported images and video clips into assets/edited/, updating script.json references.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        aspectRatio: { type: 'string', description: 'Target aspect ratio (auto, 16:9, 9:16, 3:4, 1:1).' },
        quality: { type: 'string', description: 'Quality preset (720p, 1080p, 2k, 4k).' },
        style: { type: 'string', description: 'Color grading style preset (tech, cinema, documentary, energetic, warm).' },
        trimSeconds: { type: 'number', description: 'Optional max duration cap per video clip in seconds.' },
        clipSpeed: { type: 'number', description: 'Optional video playback speed multiplier (0.5 to 2.5).' },
        chromaKeyColor: { type: 'string', description: 'Optional hex color (e.g. #00FF00) for green-screen alpha matting to yuva420p WebM.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 180_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await executeCurateAndEditAssets(args)
    },
  })

  ctx.tools.register({
    name: 'run_agent_pipeline',
    description:
      'Launch the coordinated 4-Agent Video Production Pipeline (策划导演 Agent -> 素材剪辑 Agent -> 配音混音 Agent [+ Digital Human] -> 动效质检 Agent & MP4 render), tracked via Task Center with Pause/Stop/Retry controls.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        topic: { type: 'string', description: 'Video creative theme or brief.' },
        mode: { type: 'string', enum: ['ai-coded', 'fast-draft'], description: 'Pipeline mode: ai-coded or fast-draft.' },
        engine: { type: 'string', enum: ['html', 'remotion'], description: 'Target rendering engine.' },
        aspectRatio: { type: 'string', description: '16:9, 9:16, 3:4, 1:1, or auto.' },
        quality: { type: 'string', description: '720p, 1080p, 2k, 4k.' },
        bgmMode: { type: 'string', enum: ['uploaded', 'llm-coded', 'tts-engine'], description: 'BGM source mode.' },
        narrationMode: { type: 'string', enum: ['tts', 'tts-beat-sync', 'subtitle-mv'], description: 'Voice vs beat-locked subtitle MV mode.' },
        aiAuthorCode: { type: 'boolean', description: 'When true (default in ai-coded mode), LLM authors per-scene bespoke Remotion TSX batch files with tsc verification.' },
        durationMode: { type: 'string', enum: ['auto', 'custom'], description: 'Duration mode: auto (AI free matching) or custom (strictly target targetDurationSec).' },
        targetDurationSec: { type: 'number', description: 'Optional target video duration in seconds (15..600).' },
        avatarEnabled: { type: 'boolean', description: 'Include transparent digital human presenter overlay.' },
        avatarMode: { type: 'string', enum: ['ai-human', 'cloned-human'], description: 'Avatar generation mode.' },
        avatarLayout: { type: 'string', enum: ['pip-br', 'pip-bl', 'fullscreen'], description: 'Avatar compositing layout.' },
        background: { type: 'boolean', description: 'If true, start asynchronously and return Task Center runId immediately.' },
      },
      required: ['projectDir'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 600_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      if (args.background) return await startPipelineBackground(args)
      return await runMultiAgentPipeline(args)
    },
  })

  ctx.tools.register({
    name: 'analyze_reference_video',
    description:
      'Reverse-engineer an uploaded reference video using FFprobe + FFmpeg shot-cut detection + audio BPM/drop analysis + 9-frame contact sheet + 4-protocol Multimodal Vision LLM to extract replicable visual/character/VFX/transition/pacing DNA, write MOTION.md, and attach referenceStyle to script.json for same-style video recreation.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Video project directory.' },
        videoPath: { type: 'string', description: 'Path to the reference video file (absolute or relative to projectDir).' },
        extractAudioAsBgm: { type: 'boolean', description: 'If true, also extract the reference video audio track as uploaded BGM.' },
        applyToScript: { type: 'boolean', description: 'If true (default), bind extracted referenceStyle, genre, pacing, and narrationMode directly onto script.json.' },
        useVision: { type: 'boolean', description: 'If true (default), call configured multimodal Vision LLM on the 3x3 keyframe contact sheet.' },
      },
      required: ['projectDir', 'videoPath'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 300_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await analyzeReferenceVideo(args)
    },
  })

  ctx.tools.register({
    name: 'manage_brand_kit',
    description:
      'Read or save a reusable Brand Kit (brandName, tagline, primaryColor, accentColor, backgroundColor, logoPath, watermarkText, defaultStyle, defaultPlatform) and/or export a project MOTION.md shot blueprint.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'save', 'export_motion_md'], description: 'Operation to perform.' },
        projectDir: { type: 'string', description: 'Optional project directory (required for export_motion_md).' },
        brandKit: { type: 'object', description: 'Brand kit object when action is save.', additionalProperties: true },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.action === 'save') {
        return { ok: true, brandKit: saveBrandKit(args.brandKit || {}, args.projectDir || '') }
      }
      if (args.action === 'export_motion_md') {
        if (!args.projectDir) throw new Error('projectDir is required for export_motion_md')
        return exportProjectMotionMd(args.projectDir)
      }
      return { ok: true, brandKit: loadBrandKit(args.projectDir || '') }
    },
  })

  ctx.tools.register({
    name: 'configure_cloud_media',
    description:
      'Read or save optional BYOK Cloud AI Media Generation connectors for Image (Seedream/OpenAI/Flux/Kling/Custom), Video (Seedance/Kling/MiniMax Hailuo/Sora/Custom), and Audio/Music (Suno/MiniMax Music & Speech/ElevenLabs/Custom HTTP JSON protocol).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'save'], description: 'Use get to inspect masked config + presets, or save to update.' },
        config: { type: 'object', description: 'Partial config patch { image?, video?, audio?, autoUseCloudBroll? }.', additionalProperties: true },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.action === 'save') {
        return { ok: true, config: saveCloudMediaConfig(args.config || {}) }
      }
      return { ok: true, config: getCloudMediaConfigSummary() }
    },
  })

  ctx.tools.register({
    name: 'generate_cloud_media',
    description:
      'Generate an Image, Live-Action Video B-roll, or AI Song/BGM/Audio track using configured optional BYOK Cloud AI providers (Seedream, Seedance, Kling, Flux, Suno, MiniMax Music/Speech/Hailuo, ElevenLabs, or Custom HTTP JSON protocol) and auto-import into the project.',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Target video project directory.' },
        category: { type: 'string', enum: ['image', 'video', 'audio'], description: 'Media type to generate.' },
        prompt: { type: 'string', description: 'Visual or musical description prompt.' },
        lyrics: { type: 'string', description: 'Optional lyrics for Suno / MiniMax Music.' },
        tags: { type: 'string', description: 'Optional musical style tags.' },
        title: { type: 'string', description: 'Optional asset/song title.' },
        durationSec: { type: 'number', description: 'Optional target duration in seconds (e.g. 5 or 10 for video).' },
        aspectRatio: { type: 'string', description: 'Aspect ratio (16:9, 9:16, 1:1).' },
        imageUrl: { type: 'string', description: 'Optional first-frame reference image URL for image-to-video.' },
        instrumental: { type: 'boolean', description: 'Pure instrumental music without vocals (Suno/Custom).' },
        sceneId: { type: 'string', description: 'Optional scene ID to auto-bind generated image/video into.' },
        autoBindToScript: { type: 'boolean', description: 'Automatically bind generated BGM/visual into script.json (default true).' },
      },
      required: ['category', 'prompt'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 300_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      return await generateCloudMediaAsset(args)
    },
  })

  ctx.tools.register({
    name: 'manage_template_plaza',
    description:
      'Browse, inspect, apply, or publish reusable MOTION.md video blueprints in the built-in & community Template Plaza (影核广场 · CinePulse Hub).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'apply', 'publish'], description: 'Plaza operation.' },
        category: { type: 'string', description: 'Optional category filter when listing.' },
        query: { type: 'string', description: 'Optional search keyword when listing.' },
        templateId: { type: 'string', description: 'Template ID for get/apply/publish.' },
        projectDir: { type: 'string', description: 'Project directory for apply/publish.' },
        newTopic: { type: 'string', description: 'Optional new topic when applying a template.' },
        copyScenes: { type: 'boolean', description: 'If true, also copy starter scenes from template.' },
        name: { type: 'string', description: 'Display name when publishing.' },
        description: { type: 'string', description: 'Template description when publishing.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags when publishing.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true } },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.action === 'get') return getPlazaTemplate(args.templateId)
      if (args.action === 'apply') return applyPlazaTemplateToProject(args)
      if (args.action === 'publish') return publishProjectToPlaza(args)
      return listPlazaTemplates({ category: args.category, query: args.query })
    },
  })
}

export {
  applyPlazaTemplateToProject,
  CLOUD_MEDIA_PRESETS,
  executeCurateAndEditAssets,
  generateAiCodedSfxCues,
  generateCloudMediaAsset,
  getCloudMediaConfigSummary,
  getPlazaTemplate,
  listPlazaTemplates,
  loadCloudMediaConfig,
  PLAZA_BRAND,
  PLAZA_CATEGORIES,
  publishProjectToPlaza,
  runMultiAgentPipeline,
  saveCloudMediaConfig,
  startPipelineBackground,
  taskManager,
}

export default { name, inject, apply }
export * from './genre-router.js'
export { extractJsonFromLlmText } from './llm-client.js'
