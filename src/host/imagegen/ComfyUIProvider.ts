import type { ComfyUiConfig, GeneratedImage, ImageGenProvider, ImageGenRequest } from './types'

/**
 * Local ComfyUI provider. Builds a minimal txt2img workflow, submits it to
 * `/prompt`, polls `/history/{id}` until completion, then fetches the result
 * image via `/view`.
 *
 * The workflow uses a configurable checkpoint; when the user has not set one,
 * the request fails fast with a clear message rather than guessing.
 */
export class ComfyUIProvider implements ImageGenProvider {
  readonly id = 'comfyui'

  constructor(private readonly config: ComfyUiConfig) {}

  private get base() {
    return this.config.server.replace(/\/+$/, '')
  }

  async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<GeneratedImage[]> {
    const seed = request.seed ?? Math.floor(Math.random() * 0xffffffff)

    // Split-model path (Qwen-Image-Edit etc.) takes precedence when configured.
    const workflow = buildWorkflow(this.config, request, seed)

    const promptId = await this.submit(workflow, signal)
    const outputs = await this.poll(promptId, signal)
    const images = await this.fetchOutputs(outputs, signal)

    if (images.length === 0) throw new Error('ComfyUI 未产出图片')
    return images.map((data) => ({ data, mimeType: 'image/png', meta: { seed, promptId } }))
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
    const deadline = Date.now() + 600_000
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

  private async fetchOutputs(entry: Record<string, unknown>, signal?: AbortSignal): Promise<Buffer[]> {
    const outputs = (entry as { outputs?: Record<string, { images?: Array<{ filename: string; type: string; subfolder: string }> }> }).outputs ?? {}
    const images: Buffer[] = []
    for (const node of Object.values(outputs)) {
      for (const image of node.images ?? []) {
        const query = new URLSearchParams({
          filename: image.filename,
          subfolder: image.subfolder ?? '',
          type: image.type ?? 'output',
        })
        const response = await fetch(`${this.base}/view?${query}`, { ...(signal ? { signal } : {}) })
        if (!response.ok) throw new Error(`ComfyUI /view error ${response.status}`)
        images.push(Buffer.from(await response.arrayBuffer()))
      }
    }
    return images
  }
}

function buildWorkflow(
  config: ComfyUiConfig,
  request: ImageGenRequest,
  seed: number,
): Record<string, unknown> {
  const steps = request.steps ?? 20
  const cfg = request.cfg ?? 4.0
  const size = request.size ?? 1024
  const positive = request.prompt
  const negative = request.negativePrompt ?? 'blurry, low quality, distorted, deformed, ugly'
  const count = request.count ?? 1

  // Split-model path (UNet + CLIP + VAE), e.g. Qwen-Image-Edit.
  if (config.unet && config.clip && config.vae) {
    return {
      '1': { class_type: 'UNETLoader', inputs: { unet_name: config.unet, weight_dtype: 'default' } },
      '2': { class_type: 'CLIPLoader', inputs: { clip_name: config.clip, type: 'qwen_image', device: 'default' } },
      '3': { class_type: 'VAELoader', inputs: { vae_name: config.vae } },
      '4': { class_type: 'TextEncodeQwenImageEdit', inputs: { clip: ['2', 0], prompt: positive } },
      '4n': { class_type: 'TextEncodeQwenImageEdit', inputs: { clip: ['2', 0], prompt: negative } },
      '5': {
        class_type: 'EmptyQwenImageLayeredLatentImage',
        // layers=0 yields a single-image latent; layers>0 produces a multi-frame
        // output (layers+1 images) which is intended for video/editing, not t2i.
        inputs: { width: size, height: size, layers: 0, batch_size: count },
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
      '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'paipiange' } },
    }
  }

  // Legacy single-checkpoint path (SD1.5/SDXL).
  const checkpoint = config.checkpoint?.trim()
  if (!checkpoint) {
    throw new Error('ComfyUI 未配置模型：请填写 UNet/CLIP/VAE（分离式）或 checkpoint（单文件）')
  }
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: size, height: size, batch_size: count },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'paipiange', images: ['6', 0] } },
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
