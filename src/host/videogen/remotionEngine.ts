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
