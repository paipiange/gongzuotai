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
    const checkpoint = this.config.checkpoint?.trim()
    if (!checkpoint) {
      throw new Error('ComfyUI 未配置 checkpoint，请在生图设置中选择模型')
    }

    const seed = request.seed ?? Math.floor(Math.random() * 0xffffffff)
    const workflow = buildTxt2ImgWorkflow(checkpoint, request.prompt, request.negativePrompt, {
      seed,
      steps: request.steps ?? 20,
      cfg: request.cfg ?? 7.5,
      size: request.size ?? 512,
    })

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
    const deadline = Date.now() + 300_000
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('生成已取消')
      const response = await fetch(`${this.base}/history/${promptId}`, { ...(signal ? { signal } : {}) })
      if (!response.ok) throw new Error(`ComfyUI /history error ${response.status}`)
      const history = (await response.json()) as Record<string, unknown>
      const entry = history[promptId]
      if (entry) return entry as Record<string, unknown>
      await sleep(1000)
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

function buildTxt2ImgWorkflow(
  checkpoint: string,
  positive: string,
  negative: string | undefined,
  options: { seed: number; steps: number; cfg: number; size: number },
): Record<string, unknown> {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: negative ?? '', clip: ['1', 1] } },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: options.size, height: options.size, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: options.seed,
        steps: options.steps,
        cfg: options.cfg,
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
