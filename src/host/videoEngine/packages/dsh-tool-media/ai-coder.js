import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import {
  cleanSubtitleChunk,
  createAbortError,
  formatDirectorBrief,
  normalizeNumeralsForDisplay,
  probeAudioDuration,
  probeHardwareProfile,
  readScriptJson,
  REPO_ROOT,
  resolveLowSpecPolicy,
  resolveTargetDurationPolicy,
  resolveVideoDimensions,
  splitDirectorBrief,
  stripMetaInstructions,
  toTtsText,
  writeScriptJson,
} from '../shared/index.js'
import { castVoicesWithLlm, executeGenerateSpeech, getActiveTtsEngineId, matchAllScenesInScript } from '../dsh-tool-local-tts/index.js'
import { executeVideoLint, executeVideoRender, runTypecheckOnProject, scanAiGeneratedCodeSandbox } from '../dsh-tool-video-suite/index.js'
import { importAssets, readAssets } from './asset-manager.js'
import { buildGenreGuidance, detectGenre, resolveGenreSelection } from './genre-router.js'
import {
  analyzeAudioBeatStructure,
  buildBeatGrid,
  choreographBeatSfxCues,
  mixVideoAudio,
  quantizeScenesToBeatGrid,
} from './audio-synth.js'
import { generateAiCodedBgmTrack, synthesizeTtsEngineAudioCue } from './audio-coder.js'
import { normalizeTransitionKind, runSchemaDirectorWithDegradation } from './plan-schema.js'
import { masterVoiceTracks } from './voice-master.js'
import { buildRichHtmlVideo, resolvePalette } from './html-generator.js'
import { callLlmChat, extractJsonFromLlmText, resolveLlmConfig } from './llm-client.js'
import { writeNarrativeDioramaRemotionLib } from './narrative-diorama.js'
import { syncRemotionPublicAssets, writeRemotionProjectFiles } from './remotion-generator.js'
import { buildMediaDimsMap, groundVisualAssets } from './vision-grounding.js'
import {
  buildBatchedRemotionScenesPrompt,
  buildDirectorPromptPackage,
  buildHtmlCoderSkillsPrompt,
  buildRemotionCoderSkillsPrompt,
  writeShotcraftRemotionLib,
} from './shotcraft-lib.js'

function safeRelCodePath(rawPath, engine) {
  const clean = normalize(String(rawPath || '').replace(/\\/g, '/'))
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!clean || clean.includes('..') || /^[A-Za-z]:/.test(clean)) return ''
  if (engine === 'remotion') {
    if (
      clean === 'src/index.ts' ||
      clean === 'src/Root.tsx' ||
      clean === 'src/lib/shotcraft.tsx' ||
      clean === 'src/lib/narrative-diorama.tsx'
    ) {
      return ''
    }
    if (!clean.startsWith('src/') || !/\.(tsx|ts|jsx|js)$/.test(clean)) return ''
    return clean
  }
  if (clean === 'index.html') return 'index.html'
  return ''
}

export function snapshotProjectVersion(projectDir, label = 'auto') {
  const absDir = resolve(projectDir)
  const histRoot = join(absDir, 'history')
  mkdirSync(histRoot, { recursive: true })
  const stamp = `${Date.now()}-${label.replace(/[^a-z0-9_-]/gi, '')}`
  const snapDir = join(histRoot, `v-${stamp}`)
  mkdirSync(snapDir, { recursive: true })

  for (const item of ['script.json', 'index.html', 'src', 'output/ai_build_log.json']) {
    const src = join(absDir, item)
    const dst = join(snapDir, item)
    if (existsSync(src)) {
      mkdirSync(dirname(dst), { recursive: true })
      cpSync(src, dst, { recursive: true })
    }
  }
  return snapDir
}

export function getAiCodingHistory(projectDir) {
  const absDir = resolve(projectDir)
  const histRoot = join(absDir, 'history')
  if (!existsSync(histRoot)) return []
  return readdirSync(histRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('v-') && !d.name.endsWith('-restored'))
    .map((d) => d.name)
    .sort()
    .reverse()
}

export function rollbackAiVersion(projectDir) {
  const absDir = resolve(projectDir)
  const list = getAiCodingHistory(absDir)
  if (list.length === 0) {
    return { ok: false, message: '暂无可供撤回的历史版本快照。' }
  }
  const latest = list[0]
  const snapDir = join(absDir, 'history', latest)
  for (const item of ['script.json', 'index.html', 'output/ai_build_log.json']) {
    const src = join(snapDir, item)
    if (existsSync(src)) {
      const dst = join(absDir, item)
      mkdirSync(dirname(dst), { recursive: true })
      cpSync(src, dst, { force: true })
    }
  }
  const snapSrc = join(snapDir, 'src')
  if (existsSync(snapSrc)) {
    const dstSrc = join(absDir, 'src')
    if (existsSync(dstSrc)) rmSync(dstSrc, { recursive: true, force: true })
    cpSync(snapSrc, dstSrc, { recursive: true, force: true })
  }
  try {
    rmSync(snapDir, { recursive: true, force: true })
  } catch {}

  const reloaded = existsSync(join(absDir, 'script.json')) ? readScriptJson(absDir).data : null
  if (reloaded) {
    syncRemotionPublicAssets(absDir, reloaded)
    writeShotcraftRemotionLib(absDir)
  }
  return {
    ok: true,
    restoredSnapshot: latest,
    remainingSnapshots: Math.max(0, list.length - 1),
    script: reloaded,
  }
}

function injectScriptDataIntoHtml(html, scriptData) {
  const serialized = JSON.stringify(scriptData, null, 2)
  const pattern = /(<script\s+id=["']dsh-script-data["']\s+type=["']application\/json["']>)([\s\S]*?)(<\/script>)/i
  if (pattern.test(html)) {
    return html.replace(pattern, `$1\n${serialized}\n$3`)
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `<script id="dsh-script-data" type="application/json">\n${serialized}\n</script>\n</head>`)
  }
  return `${html}\n<script id="dsh-script-data" type="application/json">\n${serialized}\n</script>`
}

function writeRemotionBootstrap(projectDir) {
  const absDir = resolve(projectDir)
  const srcDir = join(absDir, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeShotcraftRemotionLib(absDir)
  writeNarrativeDioramaRemotionLib(absDir)
  writeFileSync(
    join(srcDir, 'index.ts'),
    `import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\n\nregisterRoot(RemotionRoot);\n`,
    'utf8',
  )
  writeFileSync(
    join(srcDir, 'Root.tsx'),
    `import React from 'react';
import { Composition } from 'remotion';
import scriptData from '../script.json';
import { VideoComposition } from './VideoComposition';

export const RemotionRoot: React.FC = () => {
  const sData: any = scriptData;
  return (
    <Composition
      id="MainVideo"
      component={VideoComposition}
      durationInFrames={Math.max(30, Number(sData.totalDurationInFrames) || 300)}
      fps={Number(sData.fps) || 30}
      width={Number(sData.width) || 1920}
      height={Number(sData.height) || 1080}
    />
  );
};
`,
    'utf8',
  )
}

function normalizeThemeFromPlan(planTheme, style) {
  const base = resolvePalette({ style: style || 'tech' })
  if (!planTheme || typeof planTheme !== 'object') return base
  return {
    ...base,
    background: planTheme.bgPrimary || planTheme.background || base.background,
    surface: planTheme.bgSecondary || planTheme.surface || base.surface,
    textPrimary: planTheme.textPrimary || base.textPrimary,
    textSecondary: planTheme.textMuted || planTheme.textSecondary || base.textSecondary,
    accent: planTheme.accentPrimary || planTheme.accent || base.accent,
    accent2: planTheme.accentSecondary || planTheme.accent2 || base.accent2,
    gold: planTheme.accentSecondary || planTheme.gold || base.gold,
  }
}

export async function runCodeAutoRepairLoop({
  absDir,
  engine,
  systemPrompt,
  initialFiles,
  lockedScript,
  maxRepairRounds,
  llmConfig,
  fetchImpl,
  signal,
  onProgress,
}) {
  let filesMap = { ...initialFiles }
  const repairHistory = []
  const hasMasterAudio =
    existsSync(join(absDir, 'public', 'master-audio.wav')) ||
    existsSync(join(absDir, 'output', 'master-audio.wav'))

  for (let round = 0; round <= maxRepairRounds; round++) {
    if (signal?.aborted) throw createAbortError()
    // Filter allowed paths cleanly
    const cleanMap = {}
    for (const [k, v] of Object.entries(filesMap)) {
      const safe = safeRelCodePath(k, engine)
      if (safe) cleanMap[safe] = String(v || '')
    }

    const sandbox = scanAiGeneratedCodeSandbox(cleanMap, { engine, hasMasterAudio })

    // Persist candidate files to disk so lint + tsc run against the exact workspace
    for (const [relPath, code] of Object.entries(cleanMap)) {
      const outPath = join(absDir, relPath)
      mkdirSync(dirname(outPath), { recursive: true })
      const finalCode = relPath === 'index.html' ? injectScriptDataIntoHtml(code, lockedScript) : code
      writeFileSync(outPath, finalCode, 'utf8')
      cleanMap[relPath] = finalCode
    }

    if (engine === 'remotion') {
      writeRemotionBootstrap(absDir)
    }

    const lint = await executeVideoLint({ projectDir: absDir, engine })
    const tsc = engine === 'remotion' ? await runTypecheckOnProject(absDir) : { ok: true, errors: [] }

    const allErrors = [
      ...(sandbox.errors || []),
      ...(lint.errors || []),
      ...(tsc.errors || []),
    ]

    repairHistory.push({
      round,
      ok: allErrors.length === 0,
      errorCount: allErrors.length,
      errors: allErrors,
      filesChecked: Object.keys(cleanMap),
    })

    if (allErrors.length === 0) {
      return { ok: true, files: cleanMap, repairHistory, lint, tsc }
    }

    if (round >= maxRepairRounds) {
      return {
        ok: false,
        files: cleanMap,
        repairHistory,
        errors: allErrors,
      }
    }

    onProgress?.(
      'repair',
      Math.min(76, 58 + (round + 1) * 6),
      `代码质检发现 ${allErrors.length} 处问题，大模型自动修复中（第 ${round + 1}/${maxRepairRounds} 轮）...`,
    )

    const repairPrompt = JSON.stringify(
      {
        task: `请修复以下 ${engine === 'remotion' ? 'Remotion TSX' : 'HyperFrames HTML'} 代码编译与规范错误`,
        errors: allErrors,
        currentFiles: cleanMap,
        strictReminder:
          engine === 'remotion'
            ? '必须返回严格 JSON { "files": { ... } }。严禁出现 CSS transition: / @keyframes / Math.random，确保 export const VideoComposition 存在且 tsc --noEmit 零错误。'
            : '必须返回严格 JSON { "files": { "index.html": "..." } }。保留 <script id="dsh-script-data"> 与 window.__seekToFrame / window.__totalFrames。',
      },
      null,
      2,
    )

    const fixReply = await callLlmChat({
      overrideConfig: llmConfig,
      fetchImpl,
      system: systemPrompt,
      messages: [{ role: 'user', content: repairPrompt }],
      temperature: 0.25,
      signal,
    })
    const parsedFix = extractJsonFromLlmText(fixReply.text)
    if (parsedFix?.files && typeof parsedFix.files === 'object') {
      filesMap = { ...cleanMap, ...parsedFix.files }
    }
  }
}

function extractTsxFromReply(rawText, preferredPath, exportName) {
  const parsed = extractJsonFromLlmText(rawText)
  if (parsed?.files && typeof parsed.files === 'object') {
    if (typeof parsed.files[preferredPath] === 'string' && parsed.files[preferredPath].trim()) {
      return parsed.files[preferredPath]
    }
    for (const [k, v] of Object.entries(parsed.files)) {
      if (/\.tsx?$/i.test(k) && typeof v === 'string' && v.includes(exportName)) {
        return v
      }
    }
    const firstVal = Object.values(parsed.files).find((v) => typeof v === 'string' && v.includes('useCurrentFrame'))
    if (firstVal) return firstVal
  }
  const fenced = String(rawText || '').match(/```(?:tsx|ts|typescript|jsx)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1] && (fenced[1].includes(exportName) || fenced[1].includes('useCurrentFrame'))) {
    return fenced[1].trim()
  }
  return ''
}

function writeBatchRegistryIndex(absDir, batchInfos = []) {
  const scenesDir = join(absDir, 'src', 'scenes')
  mkdirSync(scenesDir, { recursive: true })
  const validIds = new Set(batchInfos.map((b) => `Batch${b.pad}.tsx`))
  validIds.add('index.ts')
  for (const ent of readdirSync(scenesDir)) {
    if (/^Batch\d+\.tsx$/.test(ent) && !validIds.has(ent)) {
      try {
        unlinkSync(join(scenesDir, ent))
      } catch {}
    }
  }
  const imports = batchInfos
    .map((b) => `import { ${b.exportName} } from './Batch${b.pad}';`)
    .join('\n')
  const spreads = batchInfos
    .map((b) => `  ...${b.exportName},`)
    .join('\n')
  const indexCode = `import React from 'react';
${imports}

export type CustomSceneComp = React.FC<{ scene: any; idx: number; total: number; beats: any[] }>;

export const CUSTOM_SCENE_MAP: Record<string, CustomSceneComp> = {
${spreads}
};
`
  writeFileSync(join(scenesDir, 'index.ts'), indexCode, 'utf8')
}

/**
 * Genre-Agnostic Modular Batched AI Remotion Scene Coder:
 * Splits scenes into batches (`src/scenes/Batch01.tsx` .. `BatchNN.tsx`), invokes LLM coding
 * per batch, wires `src/scenes/index.ts` + compliant `src/VideoComposition.tsx`, and runs
 * targeted batch auto-repair on sandbox/lint/`tsc --noEmit` errors.
 */
export async function authorBatchedRemotionScenes({
  absDir,
  lockedScript,
  llmConfig = {},
  fetchImpl,
  callLlmChatFn,
  batchSize = 3,
  concurrency = 1,
  maxRepairRounds = 2,
  signal,
  onProgress,
}) {
  const resolvedCfg = resolveLlmConfig(llmConfig)
  const invokeLlm = callLlmChatFn || ((args) => callLlmChat({ overrideConfig: resolvedCfg, fetchImpl, ...args }))
  const scenes = Array.isArray(lockedScript?.scenes) ? lockedScript.scenes : []
  if (scenes.length === 0) {
    return { ok: false, errors: ['scenes 为空，无法生成定制场景代码'], files: {}, repairHistory: [] }
  }

  const size = Math.max(2, Math.min(8, Number(batchSize) || 3))
  const chunks = []
  for (let i = 0; i < scenes.length; i += size) {
    chunks.push(scenes.slice(i, i + size))
  }

  const batchInfos = chunks.map((batchScenes, bi) => {
    const pad = String(bi + 1).padStart(2, '0')
    return {
      bi,
      pad,
      batchScenes,
      filePath: `src/scenes/Batch${pad}.tsx`,
      exportName: `BATCH_${pad}_SCENES`,
      systemPrompt: '',
      code: '',
      error: '',
    }
  })

  const scenesDir = join(absDir, 'src', 'scenes')
  mkdirSync(scenesDir, { recursive: true })
  const batchAssetsManifest = readAssets(absDir)
  lockedScript.mediaDims = buildMediaDimsMap(batchAssetsManifest, lockedScript)
  syncRemotionPublicAssets(absDir, lockedScript)
  writeShotcraftRemotionLib(absDir)
  writeNarrativeDioramaRemotionLib(absDir)

  const manifestItems = Array.isArray(batchAssetsManifest?.items) ? batchAssetsManifest.items : []
  const buildBatchAssetCatalog = (bScenes) => {
    const usedPaths = new Set()
    for (const sc of bScenes || []) {
      for (const m of sc.media || []) {
        if (m?.path) usedPaths.add(String(m.path).replace(/^\/+/, '').replace(/\\/g, '/'))
        if (m?.originalPath) usedPaths.add(String(m.originalPath).replace(/^\/+/, '').replace(/\\/g, '/'))
      }
      for (const p of sc.assetPaths || []) {
        if (p) usedPaths.add(String(p).replace(/^\/+/, '').replace(/\\/g, '/'))
      }
    }
    const matched = manifestItems.filter((it) => {
      if (it.type !== 'image' && it.type !== 'video') return false
      const p1 = String(it.path || '').replace(/^\/+/, '').replace(/\\/g, '/')
      const p2 = String(it.editedPath || '').replace(/^\/+/, '').replace(/\\/g, '/')
      return usedPaths.size === 0 || usedPaths.has(p1) || (p2 && usedPaths.has(p2))
    })
    return matched.map((it) => ({
      path: String(it.editedPath || it.path || '').replace(/^\/+/, '').replace(/\\/g, '/'),
      originalPath: String(it.path || '').replace(/^\/+/, '').replace(/\\/g, '/'),
      name: it.originalName || it.name,
      type: it.type,
      width: Number(it.editedWidth || it.width || 0),
      height: Number(it.editedHeight || it.height || 0),
      ...(Number(it.durationSec) > 0 ? { durationSec: it.durationSec } : {}),
      ...(it.visualSummary ? { visualSummary: it.visualSummary } : {}),
      ...(Array.isArray(it.uiAnchors) && it.uiAnchors.length > 0 ? { uiAnchors: it.uiAnchors.slice(0, 18) } : {}),
    }))
  }

  let completedCount = 0
  const hwBatchPolicy = resolveLowSpecPolicy({ repoRoot: REPO_ROOT })
  const maxConc = Math.max(1, Math.min(hwBatchPolicy.batchCoderConcurrency || 3, Number(concurrency) || 3))
  let nextIdx = 0

  const worker = async () => {
    while (nextIdx < batchInfos.length) {
      if (signal?.aborted) throw createAbortError()
      const item = batchInfos[nextIdx++]
      const pkg = buildBatchedRemotionScenesPrompt({
        batchIndex: item.bi,
        totalBatches: batchInfos.length,
        batchScenes: item.batchScenes,
        totalScenes: scenes.length,
        width: lockedScript.width || 1920,
        height: lockedScript.height || 1080,
        fps: lockedScript.fps || 30,
        aspectRatio: lockedScript.aspectRatio || '16:9',
        theme: resolvePalette(lockedScript),
        topic: lockedScript.displayTitle || lockedScript.topic || lockedScript.title || '',
        style: lockedScript.style || 'cinematic',
        genre: lockedScript.genre || '',
        genreLabel: lockedScript.genreLabel || '',
        directorNotes: lockedScript.directorNotes || '',
        contentOutline: Array.isArray(lockedScript.contentOutline) ? lockedScript.contentOutline : [],
        bgmMeta: lockedScript.bgm,
        assetCatalog: buildBatchAssetCatalog(item.batchScenes),
        narrationMode: lockedScript.narrationMode || 'tts',
        referenceStyle: lockedScript.referenceStyle || null,
      })
      item.systemPrompt = pkg.system
      onProgress?.(
        'coder',
        Math.min(62, 42 + Math.round((completedCount / batchInfos.length) * 18)),
        `AI 主程正在逐镜手写定制 TSX 动效模块 (${completedCount + 1}/${batchInfos.length} · ${item.filePath})...`,
      )
      let extracted = ''
      let lastBatchErr = ''
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (signal?.aborted) throw createAbortError()
        try {
          const res = await invokeLlm({
            system: pkg.system,
            messages: [{ role: 'user', content: pkg.user }],
            temperature: attempt === 1 ? 0.35 : 0.25,
            maxTokens: item.batchScenes.length >= 5 ? 16000 : 14000,
            timeoutMs: 600_000,
            signal,
          })
          extracted = extractTsxFromReply(res?.text, item.filePath, item.exportName)
          if (extracted) {
            lastBatchErr = ''
            break
          }
          lastBatchErr = `回复未提取到有效 TSX (${String(res?.text || '').length} chars)`
        } catch (err) {
          if (err?.name === 'AbortError' || signal?.aborted) throw err
          lastBatchErr = err?.message || 'LLM 调用异常'
          if (lastBatchErr.includes('超时')) break
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500))
        }
      }
      // Auto-split recovery: if a 4+ scene batch failed or timed out, retry in two lighter half-chunks
      if (!extracted && item.batchScenes.length >= 4 && !signal?.aborted) {
        try {
          const mid = Math.ceil(item.batchScenes.length / 2)
          const halves = [item.batchScenes.slice(0, mid), item.batchScenes.slice(mid)]
          const subParts = []
          for (let hi = 0; hi < halves.length; hi++) {
            const subExport = `${item.exportName}_PART_${hi + 1}`
            const subFile = `src/scenes/Batch${item.pad}_p${hi + 1}.tsx`
            const subPkg = buildBatchedRemotionScenesPrompt({
              batchIndex: item.bi,
              totalBatches: batchInfos.length,
              batchScenes: halves[hi],
              totalScenes: scenes.length,
              width: lockedScript.width || 1920,
              height: lockedScript.height || 1080,
              fps: lockedScript.fps || 30,
              aspectRatio: lockedScript.aspectRatio || '16:9',
              theme: resolvePalette(lockedScript),
              topic: lockedScript.displayTitle || lockedScript.topic || lockedScript.title || '',
              style: lockedScript.style || 'cinematic',
              genre: lockedScript.genre || '',
              genreLabel: lockedScript.genreLabel || '',
              directorNotes: lockedScript.directorNotes || '',
              contentOutline: Array.isArray(lockedScript.contentOutline) ? lockedScript.contentOutline : [],
              bgmMeta: lockedScript.bgm,
              assetCatalog: buildBatchAssetCatalog(halves[hi]),
              narrationMode: lockedScript.narrationMode || 'tts',
              referenceStyle: lockedScript.referenceStyle || null,
            })
            const subRes = await invokeLlm({
              system: subPkg.system.replaceAll(item.exportName, subExport).replaceAll(item.filePath, subFile),
              messages: [{ role: 'user', content: subPkg.user.replaceAll(item.filePath, subFile) }],
              temperature: 0.28,
              maxTokens: 10000,
              timeoutMs: 360_000,
              signal,
            })
            const subCode = extractTsxFromReply(subRes?.text, subFile, subExport)
            if (subCode) {
              const cleanSub = subCode.replace(/staticFile\(\s*(['"`])(?:\.?[\\/]+)*public\//gi, 'staticFile($1')
              writeFileSync(join(absDir, subFile), cleanSub, 'utf8')
              subParts.push({ subExport, relImport: `./Batch${item.pad}_p${hi + 1}` })
            }
          }
          if (subParts.length > 0) {
            extracted = `import React from 'react';\n${subParts.map((p) => `import { ${p.subExport} } from '${p.relImport}';`).join('\n')}\nexport const ${item.exportName}: Record<string, React.FC<any>> = {\n${subParts.map((p) => `  ...${p.subExport},`).join('\n')}\n};\n`
            lastBatchErr = ''
          }
        } catch {}
      }
      if (extracted) {
        item.code = extracted
      } else {
        item.error = lastBatchErr || '未知解析失败'
        item.code = `import React from 'react';\nexport const ${item.exportName}: Record<string, React.FC<any>> = {};\n`
      }
      try {
        writeFileSync(join(absDir, item.filePath), item.code, 'utf8')
      } catch {}
      completedCount++
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConc, batchInfos.length) }, () => worker()))

  const persistAllAndBuildComp = () => {
    const filesMap = {}
    for (const info of batchInfos) {
      info.code = String(info.code || '').replace(/staticFile\(\s*(['"`])(?:\.?[\\/]+)*public\//gi, 'staticFile($1')
      writeFileSync(join(absDir, info.filePath), info.code, 'utf8')
      filesMap[info.filePath] = info.code
    }
    writeBatchRegistryIndex(absDir, batchInfos)
    filesMap['src/scenes/index.ts'] = readFileSync(join(absDir, 'src', 'scenes', 'index.ts'), 'utf8')
    writeRemotionProjectFiles(absDir, lockedScript, { rebuildTemplate: true, useCustomSceneRegistry: true })
    filesMap['src/VideoComposition.tsx'] = readFileSync(join(absDir, 'src', 'VideoComposition.tsx'), 'utf8')
    return filesMap
  }

  const hasMasterAudio =
    existsSync(join(absDir, 'public', 'master-audio.wav')) ||
    existsSync(join(absDir, 'output', 'master-audio.wav'))

  const repairHistory = []
  const isolatedBatches = []

  for (let round = 0; round <= maxRepairRounds; round++) {
    if (signal?.aborted) throw createAbortError()
    const currentFiles = persistAllAndBuildComp()
    const sandbox = scanAiGeneratedCodeSandbox(currentFiles, { engine: 'remotion', hasMasterAudio })
    const lint = await executeVideoLint({ projectDir: absDir, engine: 'remotion' })
    const tsc = await runTypecheckOnProject(absDir)

    const allErrors = [
      ...(sandbox.errors || []),
      ...(lint.errors || []),
      ...(tsc.errors || []),
    ]

    repairHistory.push({
      round,
      ok: allErrors.length === 0,
      errorCount: allErrors.length,
      errors: allErrors,
      batchesCount: batchInfos.length,
    })

    const batchErrors = batchInfos.filter((b) => b.error).map((b) => `${b.filePath}: ${b.error}`)
    if (allErrors.length === 0) {
      const authoredCount = batchInfos.filter((b) => b.code.includes('useCurrentFrame')).length
      if (authoredCount === 0) {
        return {
          ok: false,
          errors: batchErrors.length ? batchErrors : ['所有分批 TSX 生成均未返回有效动画组件 (authoredBatchCount=0)'],
          batchErrors,
          files: currentFiles,
          repairHistory,
          isolatedBatches,
          authoredBatchCount: 0,
          totalBatches: batchInfos.length,
          lint,
          tsc,
        }
      }
      return {
        ok: true,
        files: currentFiles,
        repairHistory,
        isolatedBatches,
        batchErrors,
        authoredBatchCount: authoredCount,
        totalBatches: batchInfos.length,
        lint,
        tsc,
      }
    }

    // Group errors per BatchXX file so only failing modules undergo targeted LLM repair
    const failingInfos = batchInfos.filter((info) => {
      const base = `Batch${info.pad}.tsx`
      return allErrors.some((e) => e.includes(info.filePath) || e.includes(base))
    })

    if (round >= maxRepairRounds) {
      // Isolate any single persistently broken batch back to empty export so valid batches still ship cleanly!
      if (failingInfos.length > 0 && failingInfos.length < batchInfos.length) {
        for (const bad of failingInfos) {
          bad.code = `import React from 'react';\nexport const ${bad.exportName}: Record<string, React.FC<any>> = {};\n`
          isolatedBatches.push(bad.filePath)
        }
        const cleanedFiles = persistAllAndBuildComp()
        const cleanLint = await executeVideoLint({ projectDir: absDir, engine: 'remotion' })
        const cleanTsc = await runTypecheckOnProject(absDir)
        if ((cleanTsc.errors || []).length === 0 && (cleanLint.errors || []).length === 0) {
          const authoredCount = batchInfos.filter((b) => b.code.includes('useCurrentFrame')).length
          return {
            ok: authoredCount > 0,
            files: cleanedFiles,
            repairHistory,
            isolatedBatches,
            batchErrors,
            authoredBatchCount: authoredCount,
            totalBatches: batchInfos.length,
            lint: cleanLint,
            tsc: cleanTsc,
          }
        }
      }
      return {
        ok: false,
        files: currentFiles,
        repairHistory,
        isolatedBatches,
        batchErrors,
        authoredBatchCount: 0,
        errors: [...allErrors, ...batchErrors],
      }
    }

    onProgress?.(
      'repair',
      Math.min(75, 62 + (round + 1) * 6),
      `TSX 模块质检发现 ${allErrors.length} 处问题，正在精准修复异常分镜批次（第 ${round + 1}/${maxRepairRounds} 轮）...`,
    )

    const targets = failingInfos.length > 0 ? failingInfos : batchInfos
    for (const info of targets) {
      const fileErrs = allErrors.filter((e) => e.includes(`Batch${info.pad}.tsx`) || !/Batch\d+\.tsx/.test(e))
      const repairPrompt = JSON.stringify(
        {
          task: `请修复 ${info.filePath} 中的编译与沙箱违规错误`,
          errors: fileErrs.length ? fileErrs : allErrors.slice(0, 8),
          currentCode: info.code,
          requiredExportName: info.exportName,
          requiredSceneIds: info.batchScenes.map((s) => s.id),
          strictReminder: `仅输出严格 JSON { "files": { "${info.filePath}": "<完整修复代码>" } }，禁止使用 Math.random()、@keyframes 或 transition 冒号写法，确保 tsc --noEmit 零错误。`,
        },
        null,
        2,
      )
      try {
        const fixRes = await invokeLlm({
          system: info.systemPrompt,
          messages: [{ role: 'user', content: repairPrompt }],
          temperature: 0.2,
          maxTokens: 10000,
          timeoutMs: 360_000,
          signal,
        })
        const fixedCode = extractTsxFromReply(fixRes?.text, info.filePath, info.exportName)
        if (fixedCode) {
          info.code = fixedCode
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err
      }
    }
  }
}

/**
 * Full AI Model-Agnostic Coding Video Studio Pipeline:
 * Draft Ref (optional) -> LLM Director & Audio Composer -> Local IndexTTS-2 -> Lock Timing ->
 * LLM Code Writer -> Sandbox + Lint + `tsc --noEmit` (up to N auto-repair rounds) -> Render + FFmpeg QA.
 */
export async function runAiStudioPipeline(options = {}) {
  const {
    projectDir,
    topic = '',
    userPrompt = '',
    sources,
    engine = 'remotion',
    creationMode = 'ai-coded',
    bgmMode = 'llm-coded',
    bgmTtsPrompt = '',
    uploadedBgmPath = '',
    narrationMode = '',
    beatSync,
    durationMode = '',
    targetDurationSec = 0,
    targetPlatform = 'universal',
    aspectRatio = 'auto',
    quality = '1080p',
    width,
    height,
    voiceId = 'auto',
    ttsEngine,
    allowPlaceholder = false,
    fps: requestedFps = 30,
    aiBadge = true,
    aiBadgeEnabled,
    aiBadgePosition = 'top-right',
    aiBadgeText = '',
    pacingMode = 'auto',
    visual3dMode = 'auto',
    useDraftReference = true,
    render = true,
    llmOverride = {},
    fetchImpl,
    onProgress,
  } = options

  if (!projectDir) throw new Error('projectDir is required')
  const absDir = resolve(projectDir)
  mkdirSync(absDir, { recursive: true })

  const llmCfg = resolveLlmConfig(llmOverride)
  const repairRounds = Number(options.maxRepairRounds) || llmCfg.maxRepairRounds || 3
  const emit = (stage, progress, message) => {
    onProgress?.({ stage, progress, message })
  }

  emit('init', 5, '1/7 正在准备工程目录与素材清单...')
  if (sources && (Array.isArray(sources) ? sources.length > 0 : true)) {
    await importAssets({ projectDir: absDir, sources })
  }

  let existingScript = null
  if (existsSync(join(absDir, 'script.json'))) {
    try {
      existingScript = readScriptJson(absDir).data
    } catch {}
  }

  // Backup prior version so user can always roll back
  if (existingScript) {
    snapshotProjectVersion(absDir, 'pre-ai')
  }

  const assetsManifest = readAssets(absDir)
  const visuals = (assetsManifest.items || []).filter((i) => i.type === 'image' || i.type === 'video')
  const importedMusic = (assetsManifest.items || []).filter((i) => i.role === 'music')
  const rawBriefSplit = splitDirectorBrief({
    topic: topic || existingScript?.topic || existingScript?.title || '',
    title: existingScript?.title || '',
    displayTitle: options.displayTitle || existingScript?.displayTitle,
    directorNotes: options.directorNotes || existingScript?.directorNotes || userPrompt || '',
    contentOutline: options.contentOutline || existingScript?.contentOutline || [],
    genre: options.genre || existingScript?.genre || '',
    genreLabel: options.genreLabel || existingScript?.genreLabel || '',
  })
  const coreTopic = rawBriefSplit.topic || rawBriefSplit.title || 'AI 视觉大片'
  const directorNotes = rawBriefSplit.directorNotes || ''
  const contentOutline = rawBriefSplit.contentOutline || []
  const resolvedGenreInfo = resolveGenreSelection({
    genre: rawBriefSplit.genre || existingScript?.genre || '',
    genreLabel: rawBriefSplit.genreLabel || existingScript?.genreLabel || '',
    text: { topic: coreTopic, goal: `${directorNotes} ${userPrompt || ''}`, style: existingScript?.style || 'tech', hasMedia: visuals.length > 0 },
    hasScreenshots: visuals.length > 0,
  })
  const resolvedGenre = resolvedGenreInfo.id
  const resolvedGenreLabel = resolvedGenreInfo.label
  const resolvedPlatform = targetPlatform || existingScript?.targetPlatform || 'universal'
  const intentForBgm = `${coreTopic} ${directorNotes || ''} ${userPrompt || ''}`
  const wantsUploadedBgmCoder = /(?:上传|自带|导入|个人|我的|现有|本机).{0,10}(?:bgm|配乐|音乐|背景音|歌曲)|(?:bgm|配乐|背景音).{0,12}(?:节拍|卡点|踩拍|踩死|突降|高潮|同步)/i.test(intentForBgm)
  const wantsBeatSyncCoder = /(?:踩死|踩准|踩拍|踩点|卡点|卡拍|高潮突降|主高潮|突降|重拍|切镜|同步节拍|节拍同步|beat[- ]?sync)/i.test(intentForBgm)
  const wantsPureMusicCoder = /(?:纯音乐|免配音|无配音|无旁白|不要配音|不用配音|去掉配音|无需配音|纯卡点|卡点\s*MV|无解说|免\s*TTS)/i.test(intentForBgm)
  const refStyleCoder = options.referenceStyle || existingScript?.referenceStyle || null
  let resolvedBgmMode = bgmMode || existingScript?.audioSpec?.bgmMode || (importedMusic.length > 0 ? 'uploaded' : 'llm-coded')
  if (
    importedMusic.length > 0 &&
    (resolvedBgmMode === 'auto' || resolvedBgmMode === 'uploaded' || (resolvedBgmMode === 'llm-coded' && (!existsSync(join(absDir, 'audio', 'bgm-llm.wav')) || wantsUploadedBgmCoder)))
  ) {
    resolvedBgmMode = 'uploaded'
  }
  const resolvedCreationMode = creationMode === 'schema-plan' ? 'schema-plan' : 'ai-coded'
  let resolvedNarrationMode =
    narrationMode || existingScript?.narrationMode || (visuals.length === 0 && resolvedBgmMode === 'uploaded' ? 'subtitle-mv' : 'tts')
  if (wantsPureMusicCoder || (refStyleCoder?.narrationMode === 'subtitle-mv' && !/(?:需要配音|真人配音|口播解说)/.test(intentForBgm))) {
    resolvedNarrationMode = 'subtitle-mv'
  } else if (wantsBeatSyncCoder && resolvedBgmMode === 'uploaded' && resolvedNarrationMode === 'tts') {
    resolvedNarrationMode = 'tts-beat-sync'
  }
  const enableBeatSync =
    beatSync !== undefined
      ? Boolean(beatSync)
      : (wantsBeatSyncCoder || wantsPureMusicCoder || resolvedBgmMode === 'uploaded' || resolvedNarrationMode !== 'tts' || resolvedGenre === 'history-theater' || resolvedGenre === 'mv-lyric')

  let analyzedBgmMeta = existingScript?.bgm?.analyzed ? existingScript.bgm : null
  const pickedUploadBgm = uploadedBgmPath || existingScript?.bgm?.uploadedPath || importedMusic[0]?.path || ''
  if (resolvedBgmMode === 'uploaded' && pickedUploadBgm) {
    const absBgmSrc = pickedUploadBgm.match(/^[A-Za-z]:[\\/]/) || pickedUploadBgm.startsWith('/') ? pickedUploadBgm : join(absDir, pickedUploadBgm)
    if (existsSync(absBgmSrc)) {
      emit('init', 9, '1.5/7 正在通过 FFmpeg 波形能量分析测定上传 BGM 真实节拍、重拍与高潮段落...')
      try {
        analyzedBgmMeta = await analyzeAudioBeatStructure(absBgmSrc)
      } catch {}
    }
  }

  const coderDurationPolicy = resolveTargetDurationPolicy({
    durationMode: durationMode || existingScript?.durationMode || 'auto',
    targetDurationSec: Number(targetDurationSec) || Number(existingScript?.targetDurationSec) || 0,
    text: `${coreTopic} ${directorNotes || ''} ${userPrompt || ''} ${existingScript?.goal || ''}`,
    narrationMode: resolvedNarrationMode,
    hasVisualAssets: visuals.length > 0,
    bgmDurationSec: Number(analyzedBgmMeta?.durationSec || importedMusic[0]?.durationSec) || 0,
  })
  const effectiveCoderTargetSec = coderDurationPolicy.enforced ? coderDurationPolicy.targetSec : 0

  const baseHwProfile = probeHardwareProfile({ targetDir: absDir })
  const baseHwPolicy = resolveLowSpecPolicy({
    repoRoot: REPO_ROOT,
    hardware: baseHwProfile,
    requestedQuality: quality,
    requestedFps: Number(options.fps) || 30,
    totalDurationSec: effectiveCoderTargetSec || 60,
  })
  const baseDims = resolveVideoDimensions({
    aspectRatio,
    quality: baseHwPolicy.effectiveQuality || quality,
    width,
    height,
    topic: `${coreTopic} ${directorNotes || ''}`,
    assets: visuals,
  })

  let archRes = { model: llmCfg.model || 'rule-engine', protocol: llmCfg.protocol || 'rule' }
  let plan = null
  let schemaMeta = null

  if (visuals.length > 0) {
    try {
      await groundVisualAssets({
        projectDir: absDir,
        callLlmChatFn: llmCfg?.apiKey ? (p) => callLlmChat({ overrideConfig: llmCfg, fetchImpl, ...p }) : null,
        enableVision: Boolean(llmCfg?.apiKey) && resolvedCreationMode !== 'schema-plan',
      })
    } catch {}
  }
  const groundedManifest = readAssets(absDir)

  if (resolvedCreationMode === 'schema-plan') {
    emit('architect', 14, '2/7 正在执行 Schema 分镜调度 (含 4 档强弱模型容错降级)...')
    const schemaRes = await runSchemaDirectorWithDegradation({
      projectDir: absDir,
      topic: coreTopic,
      genre: resolvedGenre,
      genreLabel: resolvedGenreLabel,
      authoringMode: resolvedCreationMode,
      directorNotes,
      contentOutline,
      style: existingScript?.style || 'tech',
      targetPlatform: resolvedPlatform,
      scriptData: existingScript || {},
      assetsManifest: groundedManifest,
      bgmMeta: analyzedBgmMeta,
      narrationMode: resolvedNarrationMode,
      pacingMode: pacingMode || existingScript?.pacingMode || 'auto',
      durationMode: durationMode || existingScript?.durationMode || 'auto',
      targetDurationSec: effectiveCoderTargetSec,
      callLlmChatFn: async (p) =>
        callLlmChat({
          overrideConfig: llmCfg,
          fetchImpl,
          ...p,
        }),
    })
    schemaMeta = {
      version: schemaRes.plan.version,
      degradationTier: schemaRes.degradationTier,
      tierLabel: schemaRes.tierLabel,
      trace: schemaRes.trace,
    }
    plan = {
      title: schemaRes.plan.title,
      genre: schemaRes.plan.genre || resolvedGenre,
      genreLabel: schemaRes.plan.genreLabel || resolvedGenreLabel,
      style: schemaRes.plan.style,
      audioSpec: { mood: schemaRes.plan.style, bpm: analyzedBgmMeta?.bpm || schemaRes.plan.bpm, bgmMode: resolvedBgmMode },
      scenes: schemaRes.resolved.resolvedShots.map((s) => ({
        id: s.id,
        title: s.title,
        narration: s.narration,
        subChunks: s.subChunks,
        accentWords: s.accentWords,
        stageSpec: s.stageSpec,
        beatCount: s.beatCount,
        emotion: s.voiceEmotion || s.emotion,
        speechRate: s.speechRate,
        visualBlueprint: s.visualBlueprint,
        motionNotes: s.motionNotes,
        cams: s.cams,
        marks: s.marks,
        cursors: s.cursors,
        loupe: s.loupe,
        windowTheme: s.windowTheme,
        windowTitle: s.windowTitle,
        layout: s.layout,
        kenBurns: s.kenBurns,
        transition: s.transition,
        highlights: s.highlights,
        durationSec: s.durationSec,
        assetPaths: (s.media || []).map((m) => m.path),
      })),
    }
  } else {
    emit('architect', 14, `2/7 正在调用大模型 (${llmCfg.model || '未指定模型'}) 构思分镜、文案与定制配乐...`)
    const directorPkg = buildDirectorPromptPackage({
      topic: coreTopic,
      genre: resolvedGenre,
      genreLabel: resolvedGenreLabel,
      directorNotes,
      contentOutline,
      userPrompt: userPrompt || existingScript?.goal || coreTopic,
      aspectRatio: baseDims.aspectRatio,
      quality: baseDims.quality,
      width: baseDims.width,
      height: baseDims.height,
      targetEngine: engine,
      assets: visuals,
      draftScript: useDraftReference ? existingScript : null,
      bgmMeta: analyzedBgmMeta,
      narrationMode: resolvedNarrationMode,
      pacingMode: pacingMode || existingScript?.pacingMode || 'auto',
    })

    archRes = await callLlmChat({
      overrideConfig: llmCfg,
      fetchImpl,
      system: directorPkg.system,
      messages: [{ role: 'user', content: directorPkg.user }],
      temperature: 0.5,
    })
    plan = extractJsonFromLlmText(archRes.text)
    if (!Array.isArray(plan?.scenes) || plan.scenes.length === 0) {
      throw new Error('大模型未返回有效的分镜列表 (scenes)，请检查模型配置或重试。')
    }
  }

  // Allow LLM to refine ratio if user chose 'auto'
  const finalDims =
    aspectRatio === 'auto' && plan.recommendedAspectRatio
      ? resolveVideoDimensions({
          aspectRatio: plan.recommendedAspectRatio,
          quality,
          topic: coreTopic,
          assets: visuals,
        })
      : baseDims

  const theme = normalizeThemeFromPlan(plan.theme, plan.style || existingScript?.style || 'tech')
  const bpm = Number(analyzedBgmMeta?.bpm || plan?.audioSpec?.bpm) || 118
  const fps = Number(requestedFps) || existingScript?.fps || 30

  // Map planned scenes preserving matching Draft WAVs when narration matches
  const existingById = new Map((existingScript?.scenes || []).map((s) => [s.id, s]))
  const plannedScenes = plan.scenes.map((sc, idx) => {
    const id = sc.id || `scene-${String(idx + 1).padStart(2, '0')}`
    const prev = existingById.get(id)
    const narration =
      normalizeNumeralsForDisplay(stripMetaInstructions(String(sc.narration || '').trim())) ||
      normalizeNumeralsForDisplay(stripMetaInstructions(String(sc.title || '').trim())) ||
      `第 ${idx + 1} 幕`
    const chosenVoice = voiceId && voiceId !== 'auto' ? voiceId : prev?.voiceId || 'auto'
    const canReuseWav =
      prev &&
      prev.narration === narration &&
      (voiceId === 'auto' || prev.voiceId === voiceId) &&
      prev.audioFile &&
      existsSync(join(absDir, prev.audioFile))

    const assetPaths = Array.isArray(sc.assetPaths) ? sc.assetPaths : prev?.assetPaths || []
    const matchedMedia = assetPaths
      .map((p) => {
        const hit = visuals.find((v) => v.path === p || v.name === p)
        return hit ? { assetId: hit.id, path: hit.path, webPath: hit.webPath || '', type: hit.type } : { path: String(p), type: 'image' }
      })
      .filter((m) => m.path)
    if (matchedMedia.length === 0 && visuals.length > 0) {
      const pick = visuals[idx % visuals.length]
      matchedMedia.push({ assetId: pick.id, path: pick.path, webPath: pick.webPath || '', type: pick.type })
    }

    const estDur = Number(sc.durationSec) > 0.25 ? Number(sc.durationSec) : Math.max(3.8, Number((narration.length / 4.2 + 1.2).toFixed(2)))

    const shotLayoutMap = {
      'card-fan-opener': 'card-fan-opener',
      'workflow-steps': 'workflow-steps',
      'app-focus-shot': 'app-focus-shot',
      'split-wipe-compare': 'split-wipe-compare',
      'metric-dashboard': 'metric-dashboard',
      'multi-window-trio': 'multi-window-trio',
      'narrative-diorama': 'narrative-diorama',
      'svg-architecture-flow': 'svg-architecture-flow',
      'hud-telemetry-dashboard': 'hud-telemetry-dashboard',
      'vibecoding-spring-stage': 'vibecoding-spring-stage',
      'hero-title': '3d-stage-opener',
      'metric-counter': 'metric-dashboard',
      'bento-grid': 'mosaic-pulse-wall',
      'split-showcase': 'app-focus-shot',
      'media-spotlight': 'app-focus-shot',
      'closing-cta': 'radial-climax',
    }
    const isHistoricalTopic = /历史|霸王|项羽|秦|汉|楚|三国|唐|宋|明|古风|武侠|战役|将军|帝王|演义/i.test(`${coreTopic || ''} ${userPrompt || ''}`)
    const vibecodingFallbackCycle = ['3d-stage-opener', 'svg-architecture-flow', 'hud-telemetry-dashboard', 'vibecoding-spring-stage', 'metric-dashboard', 'radial-climax']
    const zeroAssetFallbackLayout =
      visuals.length === 0
        ? isHistoricalTopic
          ? 'narrative-diorama'
          : idx === 0
            ? '3d-stage-opener'
            : idx === plan.scenes.length - 1
              ? 'radial-climax'
              : vibecodingFallbackCycle[idx % vibecodingFallbackCycle.length]
        : idx === 0
          ? 'card-fan-opener'
          : 'app-focus-shot'
    const mappedLayout =
      sc.layout && (sc.layout !== 'narrative-diorama' || isHistoricalTopic)
        ? sc.layout
        : (visuals.length === 0 && sc.stageSpec && isHistoricalTopic ? 'narrative-diorama' : prev?.layout) ||
          shotLayoutMap[sc.shotType] ||
          zeroAssetFallbackLayout

    const cleanTitle =
      normalizeNumeralsForDisplay(stripMetaInstructions(String(sc.title || `分镜 ${idx + 1}`))) || `分镜 ${idx + 1}`
    const cleanSubChunks = Array.isArray(sc.subChunks)
      ? sc.subChunks.map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(c)))).filter(Boolean)
      : Array.isArray(prev?.subChunks)
        ? prev.subChunks.map((c) => cleanSubtitleChunk(normalizeNumeralsForDisplay(stripMetaInstructions(c)))).filter(Boolean)
        : undefined
    const cleanEmotion = String(sc.voiceEmotion || sc.emotion || prev?.voiceEmotion || prev?.emotion || '自信明快').trim()

    return {
      id,
      index: idx + 1,
      title: cleanTitle,
      layout: mappedLayout,
      threePreset: sc.threePreset || sc?.stageSpec?.threePreset || prev?.threePreset || ['orbital-core', 'cyber-terrain', 'particle-vortex', 'floating-monoliths', 'chrono-helix', 'matrix-cubes'][idx % 6],
      shotType: sc.shotType || (visuals.length === 0 ? 'narrative-diorama' : 'app-focus-shot'),
      transition: normalizeTransitionKind(sc.transition || prev?.transition || (visuals.length === 0 ? 'flash-cut' : 'iris-circle'), idx, visuals.length === 0 || resolvedNarrationMode === 'subtitle-mv'),
      stageSpec: sc.stageSpec || prev?.stageSpec || undefined,
      beatCount: Number.isFinite(Number(sc.beatCount)) ? Number(sc.beatCount) : prev?.beatCount,
      visualBlueprint: sc.visualBlueprint || prev?.visualBlueprint || undefined,
      accentWords: Array.isArray(sc.accentWords) ? sc.accentWords : prev?.accentWords || undefined,
      headline: normalizeNumeralsForDisplay(stripMetaInstructions(sc.headline || cleanTitle)) || cleanTitle,
      kicker: sc.kicker || `SCENE 0${idx + 1}`,
      highlights: Array.isArray(sc.highlights)
        ? sc.highlights.map((h) => normalizeNumeralsForDisplay(stripMetaInstructions(h))).filter(Boolean)
        : prev?.highlights || [],
      subtitleText: cleanSubChunks?.length ? cleanSubChunks.join(' ') : normalizeNumeralsForDisplay(stripMetaInstructions(sc.subtitleText || prev?.subtitleText || '')),
      subChunks: cleanSubChunks,
      hudStep: Number.isFinite(Number(sc.hudStep)) ? Number(sc.hudStep) : prev?.hudStep,
      cams: Array.isArray(sc.cams) ? sc.cams : prev?.cams || undefined,
      marks: Array.isArray(sc.marks) ? sc.marks : prev?.marks || undefined,
      cursors: Array.isArray(sc.cursors) ? sc.cursors : prev?.cursors || undefined,
      loupe: sc.loupe || prev?.loupe || undefined,
      steps: Array.isArray(sc.steps) ? sc.steps : prev?.steps || undefined,
      fanMedia: Array.isArray(sc.fanMedia) ? sc.fanMedia : prev?.fanMedia || undefined,
      trioLabels: Array.isArray(sc.trioLabels) ? sc.trioLabels : prev?.trioLabels || undefined,
      windowLayout: sc.windowLayout || prev?.windowLayout || undefined,
      windowTitle: sc.windowTitle || prev?.windowTitle || undefined,
      windowTheme: sc.windowTheme || prev?.windowTheme || (resolvedGenre === 'ui-tutorial' && matchedMedia.length > 0 ? 'light' : undefined),
      compareLeft: sc.compareLeft || prev?.compareLeft || undefined,
      compareRight: sc.compareRight || prev?.compareRight || undefined,
      metrics: Array.isArray(sc.metrics) ? sc.metrics : [],
      motionNotes: sc.motionNotes || '',
      narration,
      emotion: cleanEmotion,
      voiceEmotion: cleanEmotion,
      role: sc.role || 'narrator',
      speechRate: Number(sc.speechRate || prev?.speechRate || (resolvedGenre === 'ui-tutorial' ? 1.06 : 1.02)),
      voiceId: chosenVoice,
      media: matchedMedia,
      assetPaths: matchedMedia.map((m) => m.path),
      sfxCues: Array.isArray(sc.sfxCues) ? sc.sfxCues : [],
      visualPrompt: sc.motionNotes || cleanTitle || '',
      audioFile: canReuseWav ? prev.audioFile : '',
      durationSec: canReuseWav ? prev.durationSec : estDur,
    }
  })

  const preTtsScript = {
    ...(existingScript || {}),
    authoringMode: resolvedCreationMode === 'schema-plan' ? 'schema-plan' : 'ai-coded',
    creationMode: resolvedCreationMode,
    targetPlatform: resolvedPlatform,
    title: normalizeNumeralsForDisplay(stripMetaInstructions(plan.title || existingScript?.title || coreTopic)) || coreTopic,
    topic: coreTopic,
    displayTitle: rawBriefSplit.displayTitle,
    directorNotes,
    contentOutline,
    goal:
      formatDirectorBrief({
        goal: userPrompt || options.goal || (String(topic || '').trim().length > 36 || /【/.test(String(topic || '')) ? String(topic).trim() : '') || existingScript?.goal || '',
        displayTitle: rawBriefSplit.displayTitle,
        genreLabel: plan.genreLabel || resolvedGenreLabel,
        contentOutline,
        directorNotes,
        topic: coreTopic,
      }) || existingScript?.goal || '',
    genre: plan.genre || resolvedGenre,
    genreLabel: plan.genreLabel || resolvedGenreLabel,
    style: plan.style || existingScript?.style || 'tech',
    workflowSteps: Array.isArray(plan.workflowSteps) ? plan.workflowSteps : existingScript?.workflowSteps || [],
    brandMark: plan.brandMark || existingScript?.brandMark || '',
    engine: engine === 'remotion' ? 'remotion' : 'html',
    fps,
    width: finalDims.width,
    height: finalDims.height,
    aspectRatio: finalDims.aspectRatio,
    requestedAspectRatio: finalDims.requestedAspectRatio,
    quality: finalDims.quality,
    dimensionReason: finalDims.reason,
    aiBadge: aiBadgeEnabled !== undefined ? Boolean(aiBadgeEnabled) : aiBadge !== false,
    aiBadgeEnabled: aiBadgeEnabled !== undefined ? Boolean(aiBadgeEnabled) : aiBadge !== false,
    aiBadgePosition: ['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(aiBadgePosition) ? aiBadgePosition : (existingScript?.aiBadgePosition || 'top-right'),
    aiBadgeText: String(aiBadgeText || existingScript?.aiBadgeText || 'AI 辅助创作').trim(),
    pacingMode: String(pacingMode || existingScript?.pacingMode || 'auto').trim(),
    visual3dMode: String(visual3dMode || existingScript?.visual3dMode || 'auto').trim(),
    durationMode: coderDurationPolicy.durationMode === 'custom' ? 'custom' : String(durationMode || existingScript?.durationMode || 'auto'),
    targetDurationSec: effectiveCoderTargetSec,
    voiceMode: voiceId && voiceId !== 'auto' ? 'manual' : 'auto',
    defaultVoiceId: voiceId || 'auto',
    narrationMode: resolvedNarrationMode,
    subtitleStyle: visuals.length === 0 || resolvedNarrationMode === 'subtitle-mv' ? 'cinematic' : (existingScript?.subtitleStyle || 'pill'),
    theme,
    audioSpec: { ...(plan.audioSpec || {}), bgmMode: resolvedBgmMode },
    bgmMode: resolvedBgmMode,
    bgm: {
      ...(analyzedBgmMeta || {}),
      enabled: true,
      mode: resolvedBgmMode,
      mood: plan?.audioSpec?.mood || 'tech',
      bpm,
      volume: Number(plan?.audioSpec?.volume) || (resolvedNarrationMode === 'subtitle-mv' ? 0.85 : 0.28),
      uploadedPath: pickedUploadBgm || '',
      path: resolvedBgmMode === 'uploaded' ? pickedUploadBgm : '',
      source: resolvedBgmMode === 'uploaded' && (pickedUploadBgm || importedMusic.length > 0) ? 'user-imported' : resolvedBgmMode,
    },
    scenes: plannedScenes,
  }

  writeScriptJson(absDir, preTtsScript)
  let masteringReport = null
  if (resolvedNarrationMode === 'subtitle-mv') {
    emit('tts', 36, '3-4/7 纯音乐卡点 MV 模式：跳过 TTS 朗读，正在对齐分镜与字幕至音乐真实节拍...')
  } else {
    let castOk = false
    if ((!voiceId || voiceId === 'auto') && llmCfg?.apiKey) {
      try {
        emit('tts', 24, `3/7 正在召唤大模型 (${llmCfg.model}) 为全片挑选贴合气质的配音音色与情感节奏...`)
        const castRes = await castVoicesWithLlm({
          projectDir: absDir,
          genre: resolvedGenre,
          genreGuidance: buildGenreGuidance(resolvedGenre, preTtsScript.genreLabel),
          callLlmChatFn: async (p) => callLlmChat({ overrideConfig: llmCfg, fetchImpl, ...p }),
        })
        castOk = Boolean(castRes?.ok)
      } catch {}
    }
    if (!castOk) {
      matchAllScenesInScript(absDir, { voiceId: voiceId || 'auto', forceAuto: voiceId === 'auto' })
    }
    let midScript = readScriptJson(absDir).data

    emit('tts', 28, '3/7 正在通过本地 IndexTTS-2.5 音色库合成真人情感配音...')
    for (let i = 0; i < (midScript.scenes || []).length; i++) {
      const s = midScript.scenes[i]
      const reused = plannedScenes[i]?.audioFile && existsSync(join(absDir, plannedScenes[i].audioFile))
      if (reused) {
        const measured = await probeAudioDuration(join(absDir, s.audioFile), fps)
        s.durationSec = Math.max(2.0, Number((measured.durationSec + 0.55).toFixed(4)))
        s.durationInFrames = Math.max(1, Math.ceil(s.durationSec * fps))
        continue
      }
      const spokenTtsText = s.ttsText || toTtsText(s.narration || s.title || '')
      await executeGenerateSpeech({
        text: s.narration,
        ttsText: spokenTtsText,
        emotion: s.voiceEmotion || s.emotion || '自信明快',
        speed: Number(s.speechRate) || 1.04,
        voiceId: s.voiceId || voiceId || 'auto',
        engine: ttsEngine || getActiveTtsEngineId(),
        fps,
        outputPath: join(absDir, 'audio', `${s.id}.wav`),
        scriptPath: absDir,
        sceneId: s.id,
        allowPlaceholder,
      })
    }

    emit('master', 38, `4/7 正在调用大模型 (${llmCfg.model}) 执行人声母带修音与 LUFS 均衡...`)
    masteringReport = await masterVoiceTracks({
      projectDir: absDir,
      useLlm: true,
      llmOverride: llmCfg,
      fetchImpl,
    })
  }

  // Re-lock beat grid + full timing contract (preserving measured beats for uploaded BGM)
  let lockedScript = readScriptJson(absDir).data
  const activeBeatMeta = analyzedBgmMeta?.analyzed
    ? analyzedBgmMeta
    : buildBeatGrid(lockedScript.totalDurationSec || 12, bpm)
  lockedScript.bgm = {
    ...(lockedScript.bgm || {}),
    ...activeBeatMeta,
    beats: analyzedBgmMeta?.analyzed ? activeBeatMeta.beats : activeBeatMeta.beats.map((b) => b.time),
    bpm: activeBeatMeta.bpm || bpm,
    mode: resolvedBgmMode,
  }

  if (enableBeatSync || resolvedNarrationMode === 'subtitle-mv' || resolvedNarrationMode === 'tts-beat-sync') {
    const qMode = resolvedNarrationMode === 'subtitle-mv' ? 'subtitle-mv' : 'tts-beat-sync'
    lockedScript.scenes = quantizeScenesToBeatGrid(lockedScript.scenes || [], activeBeatMeta, {
      mode: qMode,
      fps,
      targetDurationSec: effectiveCoderTargetSec,
    })
    lockedScript.scenes = choreographBeatSfxCues(lockedScript.scenes, activeBeatMeta)
    lockedScript.subtitles = lockedScript.scenes.flatMap((sc) => sc.subtitles || [])
    const lastSc = lockedScript.scenes[lockedScript.scenes.length - 1]
    lockedScript.totalDurationInFrames = lastSc ? Number(lastSc.startFrame || 0) + Number(lastSc.durationInFrames || 0) : lockedScript.totalDurationInFrames
    lockedScript.totalDurationSec = Number(((lockedScript.totalDurationInFrames || 30) / fps).toFixed(4))
  }

  let bgmCoderInfo = { mode: resolvedBgmMode, status: 'ok' }
  if (resolvedBgmMode === 'llm-coded') {
    emit('audio', 44, `5/7 正在让大模型 (${llmCfg.model || 'LLM'}) 编写纯数学 DSP 配乐代码...`)
    try {
      const coderAudioRes = await generateAiCodedBgmTrack({
        projectDir: absDir,
        script: lockedScript,
        callLlmChatFn: async (p) =>
          callLlmChat({
            overrideConfig: llmCfg,
            fetchImpl,
            ...p,
          }),
      })
      lockedScript.bgm.path = coderAudioRes.relWavPath
      lockedScript.bgm.source = 'llm-coded'
      lockedScript.bgm.codeScriptPath = coderAudioRes.relScriptPath
      bgmCoderInfo = { mode: 'llm-coded', status: 'ok', summary: coderAudioRes.summary, scriptPath: coderAudioRes.relScriptPath }
    } catch (err) {
      bgmCoderInfo = { mode: 'llm-coded', status: 'fallback-dsp', error: err?.message || String(err) }
    }
  } else if (resolvedBgmMode === 'tts-engine') {
    emit('audio', 44, '5/7 正在通过 IndexTTS-2.5 配音引擎声学塑形生成氛围 BGM...')
    try {
      const ttsBgmRes = await synthesizeTtsEngineAudioCue({
        projectDir: absDir,
        promptText: bgmTtsPrompt || `${coreTopic} 科技光影沉浸声景`,
        voiceId,
        mode: 'bgm-pad',
        durationSec: lockedScript.totalDurationSec || 12,
      })
      lockedScript.bgm.path = ttsBgmRes.relWavPath
      lockedScript.bgm.source = 'tts-engine'
      bgmCoderInfo = { mode: 'tts-engine', status: 'ok', voiceName: ttsBgmRes.voiceName }
    } catch (err) {
      bgmCoderInfo = { mode: 'tts-engine', status: 'fallback-dsp', error: err?.message || String(err) }
    }
  } else if (resolvedBgmMode === 'uploaded') {
    const pickUp = uploadedBgmPath || lockedScript?.bgm?.uploadedPath || importedMusic[0]?.path || ''
    if (pickUp) {
      lockedScript.bgm.uploadedPath = pickUp
      lockedScript.bgm.path = pickUp
      lockedScript.bgm.source = 'user-imported'
      bgmCoderInfo = { mode: 'uploaded', status: 'ok', path: pickUp }
    }
  }

  lockedScript = writeScriptJson(absDir, lockedScript).data

  // Force re-synthesis of bespoke DSP BGM when neither uploaded nor custom WAV overrides
  const genBgmPath = join(absDir, 'audio', 'bgm-generated.wav')
  if (lockedScript.bgm.source !== 'user-imported' && lockedScript.bgm.source !== 'llm-coded' && lockedScript.bgm.source !== 'tts-engine' && existsSync(genBgmPath)) {
    try {
      unlinkSync(genBgmPath)
    } catch {}
  }

  emit('audio', 48, '5/7 正在混音配乐与音效母带 (output/master-audio.wav)...')
  await mixVideoAudio({
    projectDir: absDir,
    script: lockedScript,
    assetsManifest,
    outputPath: join(absDir, 'output', 'master-audio.wav'),
  })
  syncRemotionPublicAssets(absDir, lockedScript)

  const timingContract = {
    fps: lockedScript.fps,
    width: lockedScript.width,
    height: lockedScript.height,
    aspectRatio: lockedScript.aspectRatio,
    genre: lockedScript.genre || resolvedGenre,
    genreLabel: lockedScript.genreLabel || resolvedGenreLabel,
    directorNotes: lockedScript.directorNotes || directorNotes || '',
    totalDurationSec: lockedScript.totalDurationSec,
    totalDurationInFrames: lockedScript.totalDurationInFrames,
    aiBadge: Boolean(lockedScript.aiBadgeEnabled ?? lockedScript.aiBadge),
    aiBadgeEnabled: Boolean(lockedScript.aiBadgeEnabled ?? lockedScript.aiBadge),
    aiBadgePosition: lockedScript.aiBadgePosition || 'top-right',
    aiBadgeText: lockedScript.aiBadgeText || 'AI 辅助创作',
    pacingMode: lockedScript.pacingMode || 'auto',
    narrationMode: lockedScript.narrationMode || resolvedNarrationMode,
    subtitleStyle: lockedScript.subtitleStyle || 'pill',
    bgmBeats: lockedScript.bgm?.beats || [],
    scenes: (lockedScript.scenes || []).map((s) => ({
      id: s.id,
      index: s.index,
      title: s.title,
      layout: s.layout,
      threePreset: s.threePreset || s?.stageSpec?.threePreset || undefined,
      highlights: Array.isArray(s.highlights) ? s.highlights : [],
      visualBlueprint: s.visualBlueprint || s.motionNotes || s.visualPrompt || s.title,
      stageSpec: s.stageSpec || undefined,
      accentWords: s.accentWords || undefined,
      windowTheme: s.windowTheme || undefined,
      windowTitle: s.windowTitle || undefined,
      cams: s.cams || undefined,
      marks: s.marks || undefined,
      cursors: s.cursors || undefined,
      loupe: s.loupe || undefined,
      startFrame: s.startFrame,
      durationInFrames: s.durationInFrames,
      durationSec: s.durationSec,
      assetPaths: s.assetPaths || [],
      publicAssetFiles: (s.media || []).map((m) => String(m.path || '').replace(/^\/+/, '').replace(/\\/g, '/')),
      subtitles: s.subtitles || [],
    })),
  }
  mkdirSync(join(absDir, 'output'), { recursive: true })
  writeFileSync(join(absDir, 'output', 'timing-contract.json'), JSON.stringify(timingContract, null, 2) + '\n', 'utf8')

  let checkResult = null
  if (resolvedCreationMode === 'schema-plan') {
    emit('coder', 58, '6/7 正在将 promo-plan/1 编译为确定性帧级安全工程...')
    if (engine === 'remotion') {
      writeRemotionProjectFiles(absDir, lockedScript, { rebuildTemplate: true })
    } else {
      writeFileSync(join(absDir, 'index.html'), buildRichHtmlVideo(lockedScript), 'utf8')
      writeScriptJson(absDir, lockedScript)
    }
    const lintCheck = await executeVideoLint({ projectDir: absDir, mode: engine })
    checkResult = {
      ok: lintCheck.ok,
      files: { [engine === 'remotion' ? 'src/VideoComposition.tsx' : 'index.html']: 'compiled-from-promo-plan' },
      lintResult: lintCheck,
      repairHistory: [{ round: 0, lintOk: lintCheck.ok, source: 'schema-plan' }],
      errors: lintCheck.errors || [],
    }
  } else if (engine === 'remotion') {
    emit('coder', 42, `6/7 正在分批召唤大模型 (${llmCfg.model}) 为全片每镜编排定制 Remotion TSX 动效代码...`)
    checkResult = await authorBatchedRemotionScenes({
      absDir,
      lockedScript,
      llmConfig: llmCfg,
      fetchImpl,
      maxRepairRounds: repairRounds,
      onProgress: emit,
    })
    if (checkResult?.ok) {
      try {
        lockedScript = readScriptJson(absDir).data || lockedScript
        writeFileSync(join(absDir, 'index.html'), buildRichHtmlVideo(lockedScript), 'utf8')
      } catch {}
    }
  } else {
    emit('coder', 56, `6/7 正在让大模型 (${llmCfg.model}) 编写定制 HyperFrames HTML 视频源码...`)
    const coderPkg = buildHtmlCoderSkillsPrompt({
      plan,
      timingContract,
      width: lockedScript.width,
      height: lockedScript.height,
      aspectRatio: lockedScript.aspectRatio,
    })

    const codeRes = await callLlmChat({
      overrideConfig: llmCfg,
      fetchImpl,
      system: coderPkg.system,
      messages: [{ role: 'user', content: coderPkg.user }],
      maxTokens: 15000,
      temperature: 0.35,
    })
    const parsedCode = extractJsonFromLlmText(codeRes.text)
    const initialFiles = parsedCode?.files && typeof parsedCode.files === 'object' ? parsedCode.files : {}

    checkResult = await runCodeAutoRepairLoop({
      absDir,
      engine,
      systemPrompt: coderPkg.system,
      initialFiles,
      lockedScript,
      maxRepairRounds: repairRounds,
      llmConfig: llmCfg,
      fetchImpl,
      onProgress: emit,
    })
  }

  if (!checkResult.ok) {
    const buildLog = {
      ok: false,
      engine,
      creationMode: resolvedCreationMode,
      model: archRes.model,
      repairHistory: checkResult.repairHistory,
      errors: checkResult.errors,
      builtAt: new Date().toISOString(),
    }
    writeFileSync(join(absDir, 'output', 'ai_build_log.json'), JSON.stringify(buildLog, null, 2) + '\n', 'utf8')
    throw new Error(`AI 代码生成经 ${repairRounds} 轮自动修复后仍未通过质检: ${(checkResult.errors || []).slice(0, 3).join(' | ')}`)
  }

  // Stamp AI authoring metadata onto script.json
  lockedScript.authoringMode = resolvedCreationMode === 'schema-plan' ? 'schema-plan' : 'ai-coded'
  lockedScript.aiMeta = {
    model: archRes.model,
    protocol: archRes.protocol,
    creationMode: resolvedCreationMode,
    bgmMode: resolvedBgmMode,
    bgmCoderInfo,
    schemaMeta,
    repairRoundsUsed: Math.max(0, checkResult.repairHistory.length - 1),
    generatedFiles: Object.keys(checkResult.files),
    builtAt: new Date().toISOString(),
  }
  writeScriptJson(absDir, lockedScript)

  const buildLog = {
    ok: true,
    engine,
    creationMode: resolvedCreationMode,
    bgmMode: resolvedBgmMode,
    bgmCoderInfo,
    schemaMeta,
    model: archRes.model,
    protocol: archRes.protocol,
    aspectRatio: lockedScript.aspectRatio,
    resolution: `${lockedScript.width}x${lockedScript.height}`,
    dimensionReason: lockedScript.dimensionReason,
    repairRoundsUsed: Math.max(0, checkResult.repairHistory.length - 1),
    repairHistory: checkResult.repairHistory,
    generatedFiles: Object.keys(checkResult.files),
    audioSpec: lockedScript.audioSpec || null,
    voiceMastering: masteringReport
      ? {
          mode: masteringReport.mode,
          model: masteringReport.model,
          engineerSummary: masteringReport.engineerSummary,
          scenesCount: masteringReport.scenesCount,
        }
      : null,
    builtAt: new Date().toISOString(),
  }
  writeFileSync(join(absDir, 'output', 'ai_build_log.json'), JSON.stringify(buildLog, null, 2) + '\n', 'utf8')

  let renderResult = null
  if (render !== false) {
    emit('render', 78, '7/7 正在渲染成片并执行 FFmpeg 自动黑屏/响度质检...')
    renderResult = await executeVideoRender({
      projectDir: absDir,
      engine,
      onProgress: ({ frame, totalFrames, pct }) =>
        emit('render', Math.min(97, 78 + Math.round(pct * 0.19)), `7/7 正在逐帧合成视频 (${frame}/${totalFrames} · ${pct}%)...`),
    })
  }

  emit('done', 100, 'AI 编程创作完成，已完成代码编译、逐帧渲染与音画质检！')
  return {
    ok: true,
    projectDir: absDir,
    engine,
    script: readScriptJson(absDir).data,
    buildLog,
    render: renderResult,
  }
}

/**
 * Natural-language surgical refinement on a scene or whole project, with history backup and auto-repair.
 */
export async function refineAiScene({
  projectDir,
  sceneId = '',
  instruction,
  llmOverride = {},
  fetchImpl,
  render = true,
  onProgress,
} = {}) {
  if (!projectDir) throw new Error('projectDir is required')
  if (!instruction || !String(instruction).trim()) throw new Error('请填写对 AI 的修改意见')

  const absDir = resolve(projectDir)
  const script = readScriptJson(absDir).data
  const engine = script.engine === 'remotion' ? 'remotion' : 'html'
  const llmCfg = resolveLlmConfig(llmOverride)
  const emit = (stage, progress, message) => onProgress?.({ stage, progress, message })

  emit('backup', 10, '正在保存当前版本快照以支持一键撤回...')
  snapshotProjectVersion(absDir, 'pre-refine')
  if (engine === 'remotion') {
    writeShotcraftRemotionLib(absDir)
    writeNarrativeDioramaRemotionLib(absDir)
  }

  // Gather current workspace source files
  const currentFiles = {}
  if (engine === 'remotion') {
    const srcDir = join(absDir, 'src')
    const walk = (dir, prefix = 'src') => {
      if (!existsSync(dir)) return
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const rel = `${prefix}/${ent.name}`
        if (ent.isDirectory() && ent.name !== 'lib') walk(join(dir, ent.name), rel)
        else if (!ent.isDirectory() && /\.(tsx|ts|jsx|js)$/.test(ent.name) && rel !== 'src/index.ts' && rel !== 'src/Root.tsx') {
          currentFiles[rel] = readFileSync(join(dir, ent.name), 'utf8')
        }
      }
    }
    walk(srcDir)
  } else if (existsSync(join(absDir, 'index.html'))) {
    currentFiles['index.html'] = readFileSync(join(absDir, 'index.html'), 'utf8')
  }

  emit('coder', 35, `大模型正在按您的要求精修 (${sceneId || '全局'})...`)
  const system = `你是资深 ${engine === 'remotion' ? 'Remotion TSX + 原生 Three.js 3D + 动态 SVG' : 'HyperFrames HTML'} 视频创意工程师。
用户正在微调一个已有视频工程。请完全根据用户的自然语言需求自由编写/修改对应的 3D 场景与 2D 动态 SVG 视觉（不受任何固定预设限制！在 Remotion 中可从 './lib/shotcraft' 或 '../lib/shotcraft' 导入 FreeformThreeStage, FreeformThreeApi, buildSmoothSvgPath, describeSvgArc, ThreeCyberStage, SvgArchitectureDiagram, HudDataDashboard, computeBeatSpring, BeatSpringPhysicsRig 等自由造景原语），输出严格 JSON：
{
  "files": { "相对路径": "完整更新后的源码" },
  "narrationUpdate": { "sceneId": "若需改口播词可填，否则省略" }
}
必须严格遵守原工程技术铁律（${engine === 'remotion' ? '禁止 CSS transition: / @keyframes / Math.random，导出 VideoComposition 且保留 <Audio src={staticFile("master-audio.wav")} />' : '保留 window.__seekToFrame / window.__totalFrames / <script id="dsh-script-data">'}）。`

  const user = JSON.stringify(
    {
      targetSceneId: sceneId || 'ALL',
      userInstruction: instruction,
      canvas: { width: script.width, height: script.height, fps: script.fps, totalDurationInFrames: script.totalDurationInFrames },
      scenesSummary: (script.scenes || []).map((s) => ({
        id: s.id,
        title: s.title,
        narration: s.narration,
        startFrame: s.startFrame,
        durationInFrames: s.durationInFrames,
      })),
      currentFiles,
    },
    null,
    2,
  )

  const res = await callLlmChat({
    overrideConfig: llmCfg,
    fetchImpl,
    system,
    messages: [{ role: 'user', content: user }],
    temperature: 0.3,
  })
  const parsed = extractJsonFromLlmText(res.text)
  const patchFiles = parsed?.files && typeof parsed.files === 'object' ? parsed.files : {}
  if (Object.keys(patchFiles).length === 0) {
    throw new Error('大模型未返回任何代码修改文件。')
  }

  // Optional narration update -> re-synthesize changed scene voice
  let updatedScript = script
  if (parsed?.narrationUpdate && typeof parsed.narrationUpdate === 'object') {
    for (const [sid, newNar] of Object.entries(parsed.narrationUpdate)) {
      const target = (updatedScript.scenes || []).find((s) => s.id === sid)
      if (target && newNar && String(newNar).trim() && String(newNar).trim() !== target.narration) {
        target.narration = String(newNar).trim()
        writeScriptJson(absDir, updatedScript)
        await executeGenerateSpeech({
          text: target.narration,
          emotion: target.emotion || '平静',
          voiceId: target.voiceId || 'auto',
          fps: updatedScript.fps || 30,
          outputPath: join(absDir, 'audio', `${target.id}.wav`),
          scriptPath: absDir,
          sceneId: target.id,
        })
      }
    }
    updatedScript = readScriptJson(absDir).data
  }

  const mergedFiles = { ...currentFiles, ...patchFiles }
  const checkRes = await runCodeAutoRepairLoop({
    absDir,
    engine,
    systemPrompt: system,
    initialFiles: mergedFiles,
    lockedScript: updatedScript,
    maxRepairRounds: llmCfg.maxRepairRounds || 3,
    llmConfig: llmCfg,
    fetchImpl,
    onProgress: emit,
  })

  if (!checkRes.ok) {
    throw new Error(`局部修改自动修复未通过质检: ${(checkRes.errors || []).slice(0, 3).join(' | ')}`)
  }

  updatedScript.authoringMode = 'ai-coded'
  updatedScript.scenes = (updatedScript.scenes || []).map((sc) => {
    if (!sceneId || sceneId === 'ALL' || sc.id === sceneId) {
      const next = { ...sc }
      delete next.useBuiltinLayout
      return next
    }
    return sc
  })
  updatedScript.aiMeta = {
    ...(updatedScript.aiMeta || {}),
    lastRefineInstruction: instruction,
    lastRefineAt: new Date().toISOString(),
  }
  writeScriptJson(absDir, updatedScript)

  let renderResult = null
  if (render !== false) {
    emit('render', 76, '正在重新渲染成片与质检...')
    renderResult = await executeVideoRender({
      projectDir: absDir,
      engine,
      onProgress: ({ frame, totalFrames, pct }) =>
        emit('render', Math.min(97, 76 + Math.round(pct * 0.2)), `重新渲染中 (${frame}/${totalFrames} · ${pct}%)...`),
    })
  }

  emit('done', 100, '精修完成！可随时对比或撤回上一版。')
  return {
    ok: true,
    projectDir: absDir,
    updatedFiles: Object.keys(patchFiles),
    repairHistory: checkRes.repairHistory,
    script: readScriptJson(absDir).data,
    render: renderResult,
  }
}
