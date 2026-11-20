import type { GeneratedImage, ImageGenProvider, ImageGenRequest, LlmImageConfig } from './types'
import { composeSideBySide, downscaleDataUrlIfNeeded } from './pngCompose'

/** 单次图生图请求（一次尝试）的上限。OpenAI 兼容网关实测 40~70s，设 90s 覆盖正常慢请求、又不会干等挂死。 */
const IMAGE_GEN_TIMEOUT_MS = 90_000

/** 图生图（edits）接口的重试次数（网关 524/504/连接失败/超时等瞬时错误）。 */
const EDIT_RETRY_COUNT = 2

/** 重试前的退避毫秒数（给网关喘息，避免立刻重打一个未恢复的上游）。 */
const EDIT_RETRY_DELAY_MS = 1500

/** 参考图最长边（超出则等比缩小，降低上游网关处理超时概率）。 */
const REFERENCE_MAX_DIM = 768

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
    // 参考图过大时先等比缩小，降低上游网关图生图接口的处理耗时与超时概率。
    let references = (request.images?.length ? request.images : request.image ? [request.image] : [])
      .map((ref) => downscaleDataUrlIfNeeded(ref, REFERENCE_MAX_DIM))

    // OpenAI-compatible edit endpoints standardize on one `image` field. Some
    // gateways accept `image2`, but two independent edit inputs make the
    // upstream render substantially slower and can cross Cloudflare's 504
    // deadline. The couple template already supplies two PNG identity anchors,
    // so merge that exact pair into one reference, matching the ComfyUI path.
    if (references.length === 2) {
      try {
        references = [composeSideBySide(references[0], references[1])]
      } catch {
        // Non-PNG or unsupported PNG variants retain the existing multi-part
        // behavior instead of dropping either user-provided reference.
      }
    }

    if (references.length) {
      return this.generateEditWithRetry(base, references, request, count, signal)
    }

    const timeoutSignal = this.withTimeout(signal)
    const response = await this.generateFromPrompt(base, request, count, timeoutSignal)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Image API error ${response.status}: ${body.slice(0, 200)}`)
    }
    return this.parseImages(response, timeoutSignal)
  }

  /**
   * 图生图（edits）调用，带瞬时错误重试：网关 524/504 超时、网络错误等重试。
   * 每次尝试都用「独立的 90s 超时」——一旦单次挂死，90s 即放弃并重试，
   * 而不是共用一个 180s 硬超时（那样挂死会干等 3 分钟才轮到重试）。
   * 只有「外部取消」信号（用户主动中止）才立即抛出、不再重试。
   */
  private async generateEditWithRetry(
    base: string,
    references: string[],
    request: ImageGenRequest,
    count: number,
    signal?: AbortSignal,
  ): Promise<GeneratedImage[]> {
    let lastError: unknown
    for (let attempt = 0; attempt <= EDIT_RETRY_COUNT; attempt++) {
      if (signal?.aborted) throw new Error('已取消')
      try {
        // 每次尝试独立超时；若外部有取消信号，则叠加它。
        const attemptSignal = this.withTimeout(signal)
        const response = await this.generateEdit(base, references, request, count, attemptSignal)
        if (response.ok) return this.parseImages(response, attemptSignal)
        // 5xx（尤其 524/504）视为可重试；4xx 立即抛出。
        if (response.status >= 500) {
          const body = await response.text().catch(() => '')
          lastError = new Error(`Image API error ${response.status}: ${body.slice(0, 200)}`)
        } else {
          const body = await response.text().catch(() => '')
          throw new Error(`Image API error ${response.status}: ${body.slice(0, 200)}`)
        }
      } catch (cause) {
        // 外部取消（用户主动中止）→ 立即抛出；超时/网络错误 → 记录后重试。
        if (signal?.aborted) throw cause
        lastError = cause
      }
      // 退避：给上游网关喘息时间，再重试。
      if (attempt < EDIT_RETRY_COUNT) await this.delay(EDIT_RETRY_DELAY_MS)
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** Combine the caller's abort signal with a hard timeout so a hung gateway cannot stall forever. */
  private withTimeout(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(IMAGE_GEN_TIMEOUT_MS)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
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
        size: this.sizeParam(request),
        response_format: 'b64_json',
      }),
      ...(signal ? { signal } : {}),
    })
  }

  private async generateEdit(base: string, references: string[], request: ImageGenRequest, count: number, signal?: AbortSignal): Promise<Response> {
    const form = new FormData()
    // 多图参考：第一张用标准 `image` 字段，后续用 `image2`/`image3`…（717333/cpa 网关均实测支持）
    references.forEach((ref, i) => {
      form.append(i === 0 ? 'image' : `image${i + 1}`, dataUrlToBlob(ref), `reference${i + 1}.png`)
    })
    form.append('prompt', request.prompt)
    form.append('model', this.config.model)
    form.append('n', String(count))
    const size = this.sizeParam(request)
    if (size) form.append('size', size)
    return fetch(`${base}/images/edits`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.apiKey}` },
      body: form,
      ...(signal ? { signal } : {}),
    })
  }

  /**
   * Resolve the OpenAI-compatible `size` string ("WxH"). Explicit width/height
   * wins for non-square output; otherwise fall back to the legacy square `size`.
   */
  private sizeParam(request: ImageGenRequest): string | undefined {
    if (request.width && request.height) return `${request.width}x${request.height}`
    if (request.size) return `${request.size}x${request.size}`
    return undefined
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
