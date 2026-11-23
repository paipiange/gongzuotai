/**
 * Remotion + Three.js 双引擎桥接模块。
 *
 * 复用 dsh-video-workbench（作者 Merziller，MIT）的本地渲染引擎：
 *   - Remotion 4.x + Three.js 3D / 动态 SVG / HUD 舞台
 *   - BGM 节拍卡点 + 48kHz 音效母带
 *   - 中文字幕引擎 + 多引擎 TTS（IndexTTS / GPT-SoVITS / Windows SAPI）
 *   - 低配保护 + 硬件体检
 *
 * 引擎代码位于 `src/host/videoEngine/`，构建时由 tsdown 的 copy 插件原样
 * 拷贝到 `lib/videoEngine/`，运行时通过 `import.meta.url` 相对定位后动态 import，
 * 避免把包含 `import.meta.url` / `createRequire` / 动态 import 的引擎打进 bundle
 * 导致路径解析失效。
 *
 * 版权声明：引擎主体代码版权归原作者 Merziller（MIT License），详见
 * `src/host/videoEngine/NOTICE` 与 `LICENSE`。
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { ensureRemoteAsset } from '../storage/remoteAssets'

/** 引擎入口（vendored dsh-tool-media 的 produceFullVideo）。 */
export interface ProduceFullVideoOptions {
  projectDir: string
  sources?: unknown[]
  title?: string
  topic?: string
  style?: string
  engine?: 'html' | 'remotion'
  aspectRatio?: string
  quality?: string
  width?: number
  height?: number
  aiBadge?: boolean
  bgmMode?: string
  voiceId?: string
  ttsEngine?: string
  allowPlaceholder?: boolean
  fps?: number
  renderWidth?: number
  renderHeight?: number
  onProgress?: (msg: string) => void
}

export interface ProduceFullVideoResult {
  ok: boolean
  projectDir: string
  engine: string
  script?: unknown
  render?: {
    outputPath?: string
    [k: string]: unknown
  }
}

/**
 * 定位 vendored 引擎的入口文件。
 *
 * 打包后 `remotionEngine` 会被并入 `lib/videoGenService-*.js`，其 `import.meta.url`
 * 指向 `lib/`；源码态（vitest / ts-node）则指向 `src/host/videogen/`。两种情况下
 * `videoEngine/` 目录都在当前文件所在目录树的上层（构建产物在 `lib/videoEngine`，
 * 源码态在 `src/host/videoEngine`），因此从当前文件目录逐级向上查找名为
 * `videoEngine` 的目录即可，不依赖固定的层级数。
 */
function resolveEngineEntry(): string {
  const marker = join('packages', 'dsh-tool-media', 'index.js')
  const start = dirname(fileURLToPath(import.meta.url))

  // 逐级向上查找 videoEngine 目录（最多 8 层，覆盖打包与源码两种布局）。
  let cur = start
  for (let i = 0; i < 8; i++) {
    const candidate = join(cur, 'videoEngine', marker)
    if (existsSync(candidate)) return candidate
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }

  throw new Error(
    '[remotionEngine] 未找到 vendored dsh-video 引擎，请确认 src/host/videoEngine 已被构建进 lib/videoEngine',
  )
}

/** 是否已成功加载引擎（惰性单例）。 */
let engineModule: { produceFullVideo: (opts: ProduceFullVideoOptions) => Promise<ProduceFullVideoResult> } | null = null

/**
 * 视频引擎渲染所需的 SIL OFL 字体（瘦包后不再打进 tarball）。
 * `urlPath` 为 GitHub 仓库内实际路径（含 src/host/ 前缀），
 * `cachePath` 为本地缓存相对路径（与 remoteAssets.ts 的缓存根对齐）。
 */
const REMOTE_FONTS = [
  { urlPath: 'src/host/videoEngine/packages/shared/fonts/NotoSansSC-VF.woff2', cachePath: 'videoEngine/packages/shared/fonts/NotoSansSC-VF.woff2', sha256: '0fe36c8e0cef92f1134a2e0b2453edf2074d5ded4ffe7c38500b4fa6814310e8' },
  { urlPath: 'src/host/videoEngine/packages/shared/fonts/SourceHanSerifSC-Heavy.woff2', cachePath: 'videoEngine/packages/shared/fonts/SourceHanSerifSC-Heavy.woff2', sha256: 'a8a5b285c7c21298fe1ecdd53bdc0a21571a3504e86159f97303936b32b16889' },
]

/**
 * 出片前确保字体就位：若本地包内已有字体目录则直接用；否则按需下载到缓存，
 * 并通过 PAIPIANGE_FONTS_DIR 注入给 vendored 引擎（compliance.js 读取该变量）。
 * 下载失败不抛错（引擎会降级，缺字体的渲染由引擎自行兜底/报错）。
 * dataRoot 缺省时按 StoragePaths 的默认规则（DSH_HOME / ~/.dsh）推断。
 */
export async function ensureEngineFonts(dataRoot?: string): Promise<void> {
  if (process.env.PAIPIANGE_FONTS_DIR) return // 已注入，无需重复处理

  // 包内字体（未瘦包/开发态）优先
  const bundledDir = join(dirname(fileURLToPath(import.meta.url)), 'videoEngine', 'packages', 'shared', 'fonts')
  if (existsSync(join(bundledDir, 'NotoSansSC-VF.woff2'))) return

  // 推断缓存根：与 storage/paths.ts 的默认逻辑一致
  let root = dataRoot
  if (!root) {
    const { resolveStoragePaths } = await import('../storage/paths')
    root = resolveStoragePaths().root
  }

  try {
    const { remoteAssetCacheRoot } = await import('../storage/remoteAssets')
    const cacheRoot = remoteAssetCacheRoot(root)
    for (const spec of REMOTE_FONTS) {
      await ensureRemoteAsset(root, spec)
    }
    process.env.PAIPIANGE_FONTS_DIR = join(cacheRoot, 'videoEngine', 'packages', 'shared', 'fonts')
  } catch {
    // 下载失败：不设置环境变量，引擎走包内缺字体的兜底路径
  }
}

/**
 * 加载引擎模块（惰性 + 缓存）。首次调用时动态 import vendored 引擎入口。
 */
export async function loadVideoEngine(): Promise<{ produceFullVideo: (opts: ProduceFullVideoOptions) => Promise<ProduceFullVideoResult> }> {
  if (engineModule) return engineModule
  const entry = resolveEngineEntry()
  // 用 file URL 动态 import，确保 Windows 路径与 ESM 解析正确。
  const { pathToFileURL } = await import('node:url')
  engineModule = (await import(pathToFileURL(entry).href)) as unknown as {
    produceFullVideo: (opts: ProduceFullVideoOptions) => Promise<ProduceFullVideoResult>
  }
  return engineModule
}

/**
 * 用 Remotion/HTML 双引擎一站式出片。
 * 返回 { ok, projectDir, engine, script, render }，其中 render.outputPath 为最终 MP4。
 */
export async function produceRemotionVideo(opts: ProduceFullVideoOptions): Promise<ProduceFullVideoResult> {
  const engine = await loadVideoEngine()
  return engine.produceFullVideo(opts)
}
