import type { GeneratedImage, ImageGenProvider, ImageGenRequest, LlmImageConfig } from './types'

/**
 * OpenAI-compatible images endpoint (e.g. OpenAI /dalle, or any gateway that
 * speaks the `/v1/images/generations` contract). Configured by the user with
 * baseUrl + apiKey + model.
 *
 * When a reference image is present it switches to the image-editing endpoint
 * (`/v1/images/edits`, img2img) so the configured gateway can repaint on top
 * of the pasted reference.
 */
export class OpenAICompatImageProvider implements ImageGenProvider {
  readonly id = 'llm'

  constructor(private readonly config: LlmImageConfig) {}

  async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<GeneratedImage[]> {
    const count = Math.max(1, Math.min(request.count ?? 1, 4))
    const base = this.config.baseUrl.replace(/\/+$/, '')
    const reference = request.image ?? request.images?.[0]

    const response = reference
      ? await this.generateEdit(base, reference, request, count, signal)
      : await this.generateFromPrompt(base, request, count, signal)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image API error ${response.status}: ${body.slice(0, 200)}`)
    }
    return this.parseImages(response, signal)
  }

  private async generateFromPrompt(base: string, request: ImageGenRequest, count: number, signal?: AbortSignal): Promise<Response> {
    return fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        prompt: request.prompt,
        n: count,
        size: request.size ? `${request.size}x${request.size}` : undefined,
        response_format: 'b64_json',
      }),
      ...(signal ? { signal } : {}),
    })
  }

  private async generateEdit(base: string, reference: string, request: ImageGenRequest, count: number, signal?: AbortSignal): Promise<Response> {
    const form = new FormData()
    form.append('image', dataUrlToBlob(reference), 'reference.png')
    form.append('prompt', request.prompt)
    form.append('model', this.config.model)
    form.append('n', String(count))
    if (request.size) form.append('size', `${request.size}x${request.size}`)
    return fetch(`${base}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      body: form,
      ...(signal ? { signal } : {}),
    })
  }

  private async parseImages(response: Response, signal?: AbortSignal): Promise<GeneratedImage[]> {
    const json = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>
    }
    const items = json.data ?? []
    const images: GeneratedImage[] = []
    for (const item of items) {
      if (item.b64_json) {
        images.push({ data: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png' })
      } else if (item.url) {
        const imgResp = await fetch(item.url, { ...(signal ? { signal } : {}) })
        if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`)
        const arrayBuffer = await imgResp.arrayBuffer()
        images.push({
          data: Buffer.from(arrayBuffer),
          mimeType: imgResp.headers.get('content-type') ?? 'image/png',
        })
      }
    }

    if (images.length === 0) throw new Error('Image API returned no images')
    return images
  }
}

/** 把 data URL 转成 Blob（图生图 multipart 需要二进制体）。 */
function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/.exec(dataUrl)
  if (!match) throw new Error('参考图格式无效（应为 data URL）')
  const mime = match[1] || 'image/png'
  const payload = match[2]
  const isBase64 = dataUrl.includes(';base64,')
  const bytes = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
  return new Blob([bytes], { type: mime })
}
