import type { GeneratedImage, ImageGenProvider, ImageGenRequest, LlmImageConfig } from './types'

/**
 * OpenAI-compatible images endpoint (e.g. OpenAI /dalle, or any gateway that
 * speaks the `/v1/images/generations` contract). Configured by the user with
 * baseUrl + apiKey + model.
 */
export class OpenAICompatImageProvider implements ImageGenProvider {
  readonly id = 'llm'

  constructor(private readonly config: LlmImageConfig) {}

  async generate(request: ImageGenRequest, signal?: AbortSignal): Promise<GeneratedImage[]> {
    const count = Math.max(1, Math.min(request.count ?? 1, 4))
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/images/generations`

    const response = await fetch(url, {
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

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image API error ${response.status}: ${body.slice(0, 200)}`)
    }

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
