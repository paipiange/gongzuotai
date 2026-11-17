/**
 * 视频生成 · 主服务
 *
 * 串联四步：LLM 生成 HTML → （沙箱校验+修复）→ 无头浏览器逐帧截图 → FFmpeg 合成 MP4。
 * 借鉴 dsh-video-workbench 的 HTML5 引擎思路，本地渲染、不依赖视频供应商。
 */

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LlmService } from '../textgen/types'
import type { ComfyUiConfig } from '../imagegen/types'
import { authorVideoHtml } from './videoCoder'
import { renderHtmlToMjpeg, findBrowser } from './renderer'
import { encodeMjpegToMp4, encodeFramesToMp4, findFfmpeg } from './encoder'
import { generateFallbackHtml } from './fallbackTemplate'
import { ComfyVideoGenerator } from './comfyVideo'

/** 视频生成引擎：本地 LLM 写 HTML 动画，或 ComfyUI 出帧序列。 */
export type VideoEngine = 'llm' | 'comfyui'

export interface VideoGenRequest {
  /** 主题文案（标题） */
  topic: string
  /** 副标题 */
  subtitle?: string
  /** 视觉风格 */
  style?: string
  /** 画面比例，映射到固定分辨率 */
  aspectRatio?: '16:9' | '9:16' | '1:1'
  /** 时长（秒），1~30 */
  durationSec?: number
  /** 帧率 */
  fps?: number
  provider: string
  model: string
  /** 生成引擎：默认 llm（LLM 写 HTML 动画）。 */
  engine?: VideoEngine
  /** ComfyUI 后端配置（engine=comfyui 时必填）。 */
  comfyui?: ComfyUiConfig
}

export interface VideoGenResult {
  mp4: Buffer
  width: number
  height: number
  fps: number
  totalFrames: number
  usedFallback: boolean
  rounds: number
}

export type VideoProgress =
  | { stage: 'coding'; message: string }
  | { stage: 'repair'; round: number; message: string }
  | { stage: 'render'; frame: number; total: number }
  | { stage: 'comfy'; frame: number; total: number }
  | { stage: 'encode'; message: string }
  | { stage: 'done'; message: string }

function resolutionFor(aspect: VideoGenRequest['aspectRatio']): { width: number; height: number } {
  switch (aspect) {
    case '9:16':
      return { width: 720, height: 1280 }
    case '1:1':
      return { width: 720, height: 720 }
    default:
      return { width: 1280, height: 720 }
  }
}

/**
 * 执行一次完整的本地视频生成。
 * `onProgress` 用于把阶段进度回传给上层（例如 SSE）。
 */
export async function generateVideo(
  llm: LlmService | undefined,
  request: VideoGenRequest,
  options: { signal?: AbortSignal; onProgress?: (p: VideoProgress) => void } = {},
): Promise<VideoGenResult> {
  const { width, height } = resolutionFor(request.aspectRatio)
  const fps = Math.min(Math.max(Math.floor(request.fps ?? 24), 12), 30)
  const durationSec = Math.min(Math.max(request.durationSec ?? 5, 1), 30)
  const totalFrames = Math.round(durationSec * fps)

  // ComfyUI 引擎：出帧序列 → FFmpeg 合成（复用本机/远程图片模型，无需浏览器）。
  if (request.engine === 'comfyui') {
    return generateViaComfyUI(request, { width, height, fps, durationSec, totalFrames }, options)
  }

  if (!llm) throw new Error('Harness 文本模型服务未就绪，无法生成视频动画')

  const browser = findBrowser()
  if (!browser) throw new Error('未找到 Edge/Chrome，无法渲染视频')
  findFfmpeg() // 提前校验，避免渲染一半才发现缺 ffmpeg

  const workDir = join(tmpdir(), `paipiange-video-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(workDir, { recursive: true })

  try {
    // 1) LLM 生成 HTML（失败降级到内置模板）
    let html: string
    let usedFallback = false
    let rounds = 0

    options.onProgress?.({ stage: 'coding', message: '正在由模型编写视频动画…' })
    const coded = await authorVideoHtml(
      llm,
      { provider: request.provider, model: request.model, topic: request.topic, subtitle: request.subtitle, style: request.style, width, height, fps, durationSec },
      { signal: options.signal, onRound: (r) => options.onProgress?.({ stage: 'repair', round: r, message: `模型代码质检未通过，正在自动修复（第 ${r}/3 轮）…` }) },
    )

    if (coded && !options.signal?.aborted) {
      html = coded.html
      usedFallback = false
      rounds = coded.rounds
    } else {
      // 降级：内置确定性模板
      const fallback = generateFallbackHtml({
        title: request.topic,
        subtitle: request.subtitle || 'AI 视频工作台 · 本地逐帧出片',
        footer: '拍片哥工作台',
        durationSec,
        fps,
        width,
        height,
      })
      html = fallback.html
      usedFallback = true
      options.onProgress?.({ stage: 'coding', message: '已降级为内置动画模板（模型未产出可用代码）' })
    }

    // 2) 逐帧截图 → MJPEG 流
    await renderHtmlToMjpeg({
      html,
      totalFrames,
      width,
      height,
      fps,
      outDir: workDir,
      browser,
      onProgress: (frame, total) => options.onProgress?.({ stage: 'render', frame, total }),
    })

    // 3) FFmpeg 合成
    const outMp4 = join(workDir, 'output.mp4')
    options.onProgress?.({ stage: 'encode', message: '正在合成 MP4…' })
    await encodeMjpegToMp4({ mjpegPath: join(workDir, 'frames.mjpeg'), totalFrames, fps, outMp4Path: outMp4 })

    const { readFileSync } = await import('node:fs')
    const mp4 = readFileSync(outMp4)

    options.onProgress?.({ stage: 'done', message: '视频生成完成' })
    return { mp4, width, height, fps, totalFrames, usedFallback, rounds }
  } finally {
    // 清理临时工作目录
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * ComfyUI 引擎：用本机/远程 ComfyUI 的 Qwen-Image-Edit 模型产出多帧序列，
 * 再 FFmpeg 合成 MP4。复用现有图片模型，无需浏览器渲染，也无需 LLM。
 */
async function generateViaComfyUI(
  request: VideoGenRequest,
  dim: { width: number; height: number; fps: number; durationSec: number; totalFrames: number },
  options: { signal?: AbortSignal; onProgress?: (p: VideoProgress) => void },
): Promise<VideoGenResult> {
  const { width, height, fps, durationSec, totalFrames } = dim

  if (!request.comfyui?.server) {
    throw new Error('未配置 ComfyUI 服务地址，请先在设置中心添加 ComfyUI 后端')
  }
  findFfmpeg()

  const workDir = join(tmpdir(), `paipiange-video-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(workDir, { recursive: true })

  try {
    const generator = new ComfyVideoGenerator(request.comfyui)

    // 帧数 = 时长 × 帧率；Qwen-Image-Edit 的 layers 上限 63（64 帧），超长视频需分段或降低帧率。
    // 这里做保护：帧序列最多 64 帧，超出时按比例降帧率（保持时长不变）。
    const maxFrames = 64
    const frameCount = Math.min(totalFrames, maxFrames)
    const effectiveFps = totalFrames > maxFrames ? Number((frameCount / durationSec).toFixed(2)) : fps

    options.onProgress?.({ stage: 'coding', message: `正在由 ComfyUI 生成 ${frameCount} 帧序列…` })

    const prompt = [
      request.topic,
      request.subtitle ? `，${request.subtitle}` : '',
      request.style ? `，风格：${request.style}` : '',
    ].join('').trim()

    const gen = await generator.generate(
      {
        prompt,
        frames: frameCount,
        width,
        height,
        seed: Math.floor(Math.random() * 0xffffffff),
      },
      options.signal,
    )

    // 帧序列可能少于目标帧数（模型实际输出），以实际为准。
    const frames = gen.frames
    const actualFps = frames.length > 0 ? effectiveFps : fps

    // 合成 MP4
    const outMp4 = join(workDir, 'output.mp4')
    options.onProgress?.({ stage: 'encode', message: `正在把 ${frames.length} 帧合成为 MP4…` })
    await encodeFramesToMp4({
      frames,
      fps: Math.max(Math.round(actualFps), 1),
      outMp4Path: outMp4,
      frameExt: 'png',
    })

    const { readFileSync } = await import('node:fs')
    const mp4 = readFileSync(outMp4)

    options.onProgress?.({ stage: 'done', message: '视频生成完成' })
    return {
      mp4,
      width,
      height,
      fps: Math.round(actualFps),
      totalFrames: frames.length,
      usedFallback: false,
      rounds: 0,
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
