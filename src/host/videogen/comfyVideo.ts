/**
 * 视频生成 · ComfyUI 帧序列生成器
 *
 * 复用本机/远程 ComfyUI 的 Qwen-Image-Edit 模型，通过
 * `EmptyQwenImageLayeredLatentImage` 节点的 `layers` 参数产出多帧序列，
 * 再交给 FFmpeg 合成 MP4。与图片生成的 ComfyUIProvider 共享同一套连通协议
 * （/prompt 提交、/history 轮询、/view 取图），但目标是「帧序列」而非单图。
 *
 * 说明：Qwen-Image-Edit 本质是「图片编辑」模型，layers 多帧输出是它在
 * 视频/序列编辑上的能力入口。当前用「单图 t2i + 多帧」做最小连通验证，
 * 后续接入 wan2.1 等真视频模型时只需替换 buildWorkflow。
 */

import type { ComfyUiConfig } from '../imagegen/types'

export interface ComfyVideoRequest {
  prompt: string
  /** 帧数（视频帧序列长度），1~64 */
  frames?: number
  width?: number
  height?: number
  seed?: number
  steps?: number
  cfg?: number
  denoise?: number
}

export interface ComfyVideoResult {
  /** 帧图字节列表（PNG），顺序对应视频时间轴 */
  frames: Buffer[]
  width: number
  height: number
  seed: number
  promptId: string
}

/** 复用图片生成的推荐默认模型（Qwen-Image-Edit 分离式模型栈）。 */
const DEFAULT_MODELS = {
  unet: 'qwen_image_edit_2511_int8_convrot.safetensors',
  clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: 'qwen_image_vae.safetensors',
} as const

export class ComfyVideoGenerator {
  readonly id = 'comfyui-video'

  constructor(private readonly config: ComfyUiConfig) {}

  private get base() {
    return this.config.server.replace(/\/+$/, '')
  }

  /**
   * 生成一段帧序列。复用 ComfyUIProvider 的连通协议：
   * 提交 workflow → 轮询 /history → /view 逐个取帧。
   */
  async generate(request: ComfyVideoRequest, signal?: AbortSignal): Promise<ComfyVideoResult> {
    const timeoutSignal = this.withTimeout(signal)
    const seed = request.seed ?? Math.floor(Math.random() * 0xffffffff)
    const width = request.width ?? 1280
    const height = request.height ?? 720
    const frames = Math.min(Math.max(Math.floor(request.frames ?? 16), 1), 64)

    const workflow = buildFrameWorkflow(this.config, request, seed, width, height, frames)

    const promptId = await this.submit(workflow, timeoutSignal)
    const entry = await this.poll(promptId, timeoutSignal)
    const frameBuffers = await this.fetchFrames(entry, timeoutSignal)

    if (frameBuffers.length === 0) throw new Error('ComfyUI 未产出视频帧')
    return { frames: frameBuffers, width, height, seed, promptId }
  }

  private withTimeout(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(900_000) // 帧序列比单图更久，放宽到 15 分钟
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async submit(workflow: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
      ...(signal ? { signal } : {}),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`ComfyUI /prompt error ${response.status}: ${body.slice(0, 200)}`)
    }
    const json = (await response.json()) as { prompt_id?: string; error?: unknown }
    if (json.error) throw new Error(`ComfyUI rejected workflow: ${JSON.stringify(json.error).slice(0, 200)}`)
    if (!json.prompt_id) throw new Error('ComfyUI /prompt 未返回 prompt_id')
    return json.prompt_id
  }

  private async poll(promptId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 900_000
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('生成已取消')
      const response = await fetch(`${this.base}/history/${promptId}`, { ...(signal ? { signal } : {}) })
      if (!response.ok) throw new Error(`ComfyUI /history error ${response.status}`)
      const history = (await response.json()) as Record<string, unknown>
      const entry = history[promptId] as Record<string, unknown> | undefined
      if (entry) {
        const status = (entry.status ?? {}) as { status_str?: string; completed?: boolean }
        if (status.completed) return entry
        if (status.status_str === 'error') {
          const messages = (status as { messages?: Array<[string, { exception_message?: string }]> }).messages ?? []
          const err = messages.find((m) => m[0] === 'execution_error')
          const detail = err?.[1]?.exception_message ?? 'unknown error'
          throw new Error(`ComfyUI 生成失败: ${detail.slice(0, 300)}`)
        }
      }
      await sleep(2000)
    }
    throw new Error('ComfyUI 生成超时')
  }

  private async fetchFrames(entry: Record<string, unknown>, signal?: AbortSignal): Promise<Buffer[]> {
    const outputs = (entry as { outputs?: Record<string, { images?: Array<{ filename: string; type: string; subfolder: string }> }> }).outputs ?? {}
    const buffers: Buffer[] = []
    for (const node of Object.values(outputs)) {
      // 多帧序列会以一个 node 的 images 数组返回多张图（顺序即时间轴顺序）
      const images = node.images ?? []
      for (const image of images) {
        const query = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder ?? '',
          type: image.type ?? 'output',
        })
        const response = await fetch(`${this.base}/view?${query}`, { ...(signal ? { signal } : {}) })
        if (!response.ok) throw new Error(`ComfyUI /view error ${response.status}`)
        buffers.push(Buffer.from(await response.arrayBuffer()))
      }
    }
    return buffers
  }
}

/**
 * 构建 Qwen-Image-Edit 多帧序列 workflow。
 * `EmptyQwenImageLayeredLatentImage` 的 `layers = frames - 1` 产出 `frames` 帧。
 */
function buildFrameWorkflow(
  config: ComfyUiConfig,
  request: ComfyVideoRequest,
  seed: number,
  width: number,
  height: number,
  frames: number,
): Record<string, unknown> {
  const steps = request.steps ?? 8
  const cfg = request.cfg ?? 4.0
  const positive = request.prompt
  const negative = 'blurry, low quality, distorted, deformed, ugly'

  const unet = config.unet?.trim() || DEFAULT_MODELS.unet
  const clip = config.clip?.trim() || DEFAULT_MODELS.clip
  const vae = config.vae?.trim() || DEFAULT_MODELS.vae

  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: 'qwen_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: vae } },
    '4': { class_type: 'TextEncodeQwenImageEdit', inputs: { clip: ['2', 0], prompt: positive } },
    '4n': { class_type: 'TextEncodeQwenImageEdit', inputs: { clip: ['2', 0], prompt: negative } },
    '5': {
      class_type: 'EmptyQwenImageLayeredLatentImage',
      // layers = frames - 1 → 输出 frames 帧序列（batch_size 固定 1）
      inputs: { width, height, layers: frames - 1, batch_size: 1 },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['4', 0],
        negative: ['4n', 0],
        latent_image: ['5', 0],
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['3', 0] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'paipiange_video' } },
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
