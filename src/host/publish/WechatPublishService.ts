export interface WechatChannelConfig {
  appId: string
  appSecret: string
  defaultAuthor?: string
}

export interface WechatDraftImage {
  dataUrl: string
  caption?: string
}

export interface CreateWechatDraftInput {
  title: string
  author?: string
  digest?: string
  footer?: string
  images: WechatDraftImage[]
  coverDataUrl: string
}

export interface WechatDraftResult {
  mediaId: string
  imageCount: number
}

export interface WechatDraftStatus {
  exists: true
  title: string
  articleCount: number
}

export interface WechatPublishResult {
  publishId: string
  /** 0 成功，1 发布中，2 原创失败，3 常规失败，4 平台审核不通过 */
  status: number
  statusText: string
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  errcode?: number
  errmsg?: string
}

interface WechatErrorPayload {
  errcode?: number
  errmsg?: string
}

export interface DecodedImageDataUrl {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  data: Uint8Array
  extension: '.jpg' | '.png' | '.webp'
}

/** Decode only supported base64 image data URLs and enforce a per-image cap. */
export function decodeImageDataUrl(dataUrl: string, maxBytes = 10 * 1024 * 1024): DecodedImageDataUrl {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/.exec(dataUrl.trim())
  if (!match) throw new Error('图片数据格式无效，仅支持 JPEG、PNG 或 WebP')
  const mimeType = match[1] as DecodedImageDataUrl['mimeType']
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!buffer.length) throw new Error('图片数据为空')
  if (buffer.byteLength > maxBytes) throw new Error(`单张图片不能超过 ${Math.floor(maxBytes / 1024 / 1024)}MB`)
  return {
    mimeType,
    data: new Uint8Array(buffer),
    extension: mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/png' ? '.png' : '.webp',
  }
}

/** Build WeChat-safe inline HTML for a vertical comic image sequence. */
export function buildWechatComicHtml(input: {
  title: string
  imageUrls: string[]
  captions?: string[]
  footer?: string
}): string {
  const images = input.imageUrls.map((url, index) => {
    const caption = input.captions?.[index]?.trim()
    return [
      '<section style="margin:0 0 20px;padding:0;">',
      `<img src="${escapeHtml(url)}" alt="第 ${index + 1} 张漫画" style="display:block;width:100%;height:auto;margin:0 auto;border-radius:10px;" />`,
      caption ? `<p style="margin:10px 8px 0;text-align:center;color:#6b4523;font-size:15px;line-height:1.8;">${escapeHtml(caption)}</p>` : '',
      '</section>',
    ].join('')
  }).join('')

  const footer = input.footer?.trim() || '拍片哥工作台 · 本地创作'
  return [
    '<section style="padding:18px 10px;font-family:\'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#3a2a1a;line-height:1.8;word-break:break-word;">',
    `<h1 style="margin:0 0 18px;text-align:center;color:#8c5a2b;font-size:23px;line-height:1.45;">${escapeHtml(input.title)}</h1>`,
    images,
    `<p style="margin:28px 0 0;padding-top:12px;border-top:1px solid #eadbc5;text-align:center;color:#aa8b68;font-size:12px;">—— ${escapeHtml(footer)} ——</p>`,
    '</section>',
  ].join('')
}

class WechatApiError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
    this.name = 'WechatApiError'
  }
}

/** Official-account draft integration. Secrets stay in the Host process. */
export class WechatPublishService {
  private tokenCache: { appId: string; token: string; expiresAt: number } | null = null

  /**
   * 图片上传结果缓存：dataUrl 的短哈希 → 上传后的 URL / media_id。
   * 草稿创建失败重试时复用已上传的图片，避免重复消耗素材库上传额度。
   * 仅存内存（进程生命周期内有效），不落盘，隐私边界不变。
   */
  private readonly uploadCache = new Map<string, string>()

  constructor(
    private readonly getConfig: () => WechatChannelConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  invalidateToken(): void {
    this.tokenCache = null
  }

  /** 清空图片上传缓存（账号切换后调用，避免跨账号复用 media_id）。 */
  clearUploadCache(): void {
    this.uploadCache.clear()
  }

  async testConnection(): Promise<{ ok: true; message: string }> {
    await this.getAccessToken(true)
    return { ok: true, message: '公众号凭据有效，已成功获取 access_token' }
  }

  async createDraft(input: CreateWechatDraftInput): Promise<WechatDraftResult> {
    const title = input.title.trim()
    if (!title) throw new Error('公众号文章标题不能为空')
    if (!input.images.length) throw new Error('至少需要一张漫画图片')
    if (input.images.length > 8) throw new Error('单篇漫画最多同步 8 张图片')

    return this.withTokenRetry(async (token) => {
      const imageUrls: string[] = []
      for (let index = 0; index < input.images.length; index += 1) {
        imageUrls.push(await this.uploadInlineImage(token, input.images[index].dataUrl, index))
      }
      const thumbMediaId = await this.uploadCover(token, input.coverDataUrl)
      const content = buildWechatComicHtml({
        title,
        imageUrls,
        captions: input.images.map((image) => image.caption ?? ''),
        footer: input.footer,
      })
      const response = await this.fetchImpl(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          articles: [{
            title: title.slice(0, 64),
            author: input.author?.trim().slice(0, 16) || undefined,
            digest: input.digest?.trim().slice(0, 120) || undefined,
            content,
            thumb_media_id: thumbMediaId,
            need_open_comment: 0,
            only_fans_can_comment: 0,
          }],
        }),
      })
      const payload = await parseWechatJson(response)
      assertWechatOk(payload, response.status)
      const mediaId = typeof payload.media_id === 'string' ? payload.media_id : ''
      if (!mediaId) throw new Error('微信草稿接口未返回 media_id')
      return { mediaId, imageCount: imageUrls.length }
    })
  }

  /** Create a "贴图"(图片消息/newspic) draft whose readers swipe through images. */
  async createStickerDraft(input: CreateWechatDraftInput): Promise<WechatDraftResult> {
    const title = input.title.trim()
    if (!title) throw new Error('公众号贴图标题不能为空')
    if (!input.images.length) throw new Error('至少需要一张漫画图片')
    if (input.images.length > 20) throw new Error('单篇贴图最多同步 20 张图片')

    return this.withTokenRetry(async (token) => {
      const imageMediaIds: string[] = []
      for (let index = 0; index < input.images.length; index += 1) {
        imageMediaIds.push(await this.uploadPermanentImage(token, input.images[index].dataUrl, index))
      }
      // 贴图正文：用第一张图的对白做描述，为空则退回标题。
      const content = input.images[0]?.caption?.trim() || title
      const response = await this.fetchImpl(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          articles: [{
            article_type: 'newspic',
            title: truncateUtf8(title, 32),
            content: content.slice(0, 20000),
            need_open_comment: 0,
            only_fans_can_comment: 0,
            image_info: { image_list: imageMediaIds.map((image_media_id) => ({ image_media_id })) },
          }],
        }),
      })
      const payload = await parseWechatJson(response)
      assertWechatOk(payload, response.status)
      const mediaId = typeof payload.media_id === 'string' ? payload.media_id : ''
      if (!mediaId) throw new Error('微信草稿接口未返回 media_id')
      return { mediaId, imageCount: imageMediaIds.length }
    })
  }

  /** Submit a draft media_id for publication, then poll until the async publish task settles. */
  async submitDraft(mediaId: string, options?: { pollIntervalMs?: number; maxWaitMs?: number }): Promise<WechatPublishResult> {
    const id = mediaId.trim()
    if (!id) throw new Error('缺少微信草稿 media_id')
    const pollIntervalMs = options?.pollIntervalMs ?? 3000
    const maxWaitMs = options?.maxWaitMs ?? 60_000
    const publishId = await this.withTokenRetry(async (token) => {
      const response = await this.fetchImpl(`https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ media_id: id }),
      })
      const payload = await parseWechatJson(response)
      assertWechatOk(payload, response.status)
      const pid = typeof payload.publish_id === 'string' ? payload.publish_id : ''
      if (!pid) throw new Error('微信发布接口未返回 publish_id')
      return pid
    })
    return this.pollUntilSettled(publishId, pollIntervalMs, maxWaitMs)
  }

  /** Poll a publish task until it leaves the "发布中" state or the budget expires. */
  async pollUntilSettled(publishId: string, pollIntervalMs = 3000, maxWaitMs = 60_000): Promise<WechatPublishResult> {
    const deadline = Date.now() + maxWaitMs
    let result = await this.describePublishStatus(publishId)
    while (result.status === 1 && Date.now() < deadline) {
      await sleep(pollIntervalMs)
      result = await this.describePublishStatus(publishId)
    }
    return result
  }

  /** Query a publish task's status (0 成功 / 1 发布中 / 2 原创失败 / 3 常规失败 / 4 审核不通过). */
  async getPublishStatus(publishId: string): Promise<WechatPublishResult> {
    const id = publishId.trim()
    if (!id) throw new Error('缺少微信发布任务 publish_id')
    return this.describePublishStatus(id)
  }

  private async describePublishStatus(publishId: string): Promise<WechatPublishResult> {
    return this.withTokenRetry(async (token) => {
      const response = await this.fetchImpl(`https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ publish_id: publishId }),
      })
      const payload = await parseWechatJson(response)
      assertWechatOk(payload, response.status)
      const status = typeof payload.publish_status === 'number' ? payload.publish_status : 1
      const text = PUBLISH_STATUS_TEXT[status] ?? '未知状态'
      return { publishId, status, statusText: text }
    })
  }

  /** Verify that a previously returned draft media_id still exists in WeChat. */
  async refreshDraft(mediaId: string): Promise<WechatDraftStatus> {
    const id = mediaId.trim()
    if (!id) throw new Error('缺少微信草稿 media_id')
    return this.withTokenRetry(async (token) => {
      const response = await this.fetchImpl(`https://api.weixin.qq.com/cgi-bin/draft/get?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ media_id: id }),
      })
      const payload = await parseWechatJson(response)
      assertWechatOk(payload, response.status)
      const items = Array.isArray(payload.news_item) ? payload.news_item as Array<{ title?: unknown }> : []
      return {
        exists: true,
        title: typeof items[0]?.title === 'string' ? items[0].title : '',
        articleCount: items.length,
      }
    })
  }

  private async withTokenRetry<T>(operation: (token: string) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.getAccessToken())
    } catch (cause) {
      if (cause instanceof WechatApiError && [40014, 42001].includes(cause.code ?? -1)) {
        this.invalidateToken()
        return operation(await this.getAccessToken(true))
      }
      throw cause
    }
  }

  private async getAccessToken(force = false): Promise<string> {
    const config = this.requireConfig()
    const now = Date.now()
    if (!force && this.tokenCache?.appId === config.appId && this.tokenCache.expiresAt > now) {
      return this.tokenCache.token
    }
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token')
    url.searchParams.set('grant_type', 'client_credential')
    url.searchParams.set('appid', config.appId)
    url.searchParams.set('secret', config.appSecret)
    const response = await this.fetchImpl(url)
    const payload = await parseWechatJson(response) as TokenResponse
    assertWechatOk(payload, response.status)
    if (!payload.access_token) throw new Error('微信接口未返回 access_token')
    const safeLifetime = Math.max(60, (payload.expires_in ?? 7200) - 300) * 1000
    this.tokenCache = { appId: config.appId, token: payload.access_token, expiresAt: now + safeLifetime }
    return payload.access_token
  }

  private requireConfig(): WechatChannelConfig {
    const config = this.getConfig()
    if (!config?.appId || !config.appSecret) throw new Error('请先在「设置中心 → 微信公众号」配置 AppID 和 AppSecret')
    return config
  }

  private async uploadInlineImage(token: string, dataUrl: string, index: number): Promise<string> {
    const cacheKey = this.cacheKey(dataUrl)
    const cached = this.uploadCache.get(cacheKey)
    if (cached) return cached
    const image = decodeImageDataUrl(dataUrl, 2 * 1024 * 1024)
    const form = new FormData()
    form.append('media', new Blob([toArrayBuffer(image.data)], { type: image.mimeType }), `comic-${index + 1}${image.extension}`)
    const response = await this.fetchImpl(`https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: form,
    })
    const payload = await parseWechatJson(response)
    assertWechatOk(payload, response.status)
    const url = typeof payload.url === 'string' ? payload.url : ''
    if (!url) throw new Error(`第 ${index + 1} 张图片上传后未返回 URL`)
    this.uploadCache.set(cacheKey, url)
    return url
  }

  /** Upload an image as a permanent material (type=image), returning its media_id for newspic drafts. */
  private async uploadPermanentImage(token: string, dataUrl: string, index: number): Promise<string> {
    const cacheKey = `perm:${this.cacheKey(dataUrl)}`
    const cached = this.uploadCache.get(cacheKey)
    if (cached) return cached
    const image = decodeImageDataUrl(dataUrl, 2 * 1024 * 1024)
    const form = new FormData()
    form.append('media', new Blob([toArrayBuffer(image.data)], { type: image.mimeType }), `sticker-${index + 1}${image.extension}`)
    const response = await this.fetchImpl(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`, {
      method: 'POST',
      body: form,
    })
    const payload = await parseWechatJson(response)
    assertWechatOk(payload, response.status)
    const mediaId = typeof payload.media_id === 'string' ? payload.media_id : ''
    if (!mediaId) throw new Error(`第 ${index + 1} 张图片上传后未返回 media_id`)
    this.uploadCache.set(cacheKey, mediaId)
    return mediaId
  }

  private async uploadCover(token: string, dataUrl: string): Promise<string> {
    const cacheKey = `thumb:${this.cacheKey(dataUrl)}`
    const cached = this.uploadCache.get(cacheKey)
    if (cached) return cached
    const image = decodeImageDataUrl(dataUrl, 2 * 1024 * 1024)
    if (image.mimeType !== 'image/jpeg') throw new Error('公众号封面必须转换为 JPEG')
    const form = new FormData()
    form.append('media', new Blob([toArrayBuffer(image.data)], { type: image.mimeType }), 'cover.jpg')
    const response = await this.fetchImpl(`https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=thumb`, {
      method: 'POST',
      body: form,
    })
    const payload = await parseWechatJson(response)
    assertWechatOk(payload, response.status)
    const mediaId = typeof payload.media_id === 'string' ? payload.media_id : ''
    if (!mediaId) throw new Error('公众号封面上传后未返回 media_id')
    this.uploadCache.set(cacheKey, mediaId)
    return mediaId
  }

  /** 生成 dataUrl 的短哈希（缓存 key，非安全用途，无需 crypto）。 */
  private cacheKey(dataUrl: string): string {
    let hash = 0
    const sample = dataUrl.length > 4096 ? dataUrl.slice(0, 4096) : dataUrl
    for (let i = 0; i < sample.length; i += 1) {
      hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0
    }
    return `${dataUrl.length}:${(hash >>> 0).toString(36)}`
  }
}

async function parseWechatJson(response: Response): Promise<Record<string, unknown> & WechatErrorPayload> {
  const text = await response.text()
  try {
    return JSON.parse(text) as Record<string, unknown> & WechatErrorPayload
  } catch {
    throw new Error(`微信接口返回了无效响应 (HTTP ${response.status})`)
  }
}

function assertWechatOk(payload: WechatErrorPayload, httpStatus: number): void {
  if (!Number.isFinite(payload.errcode) || payload.errcode === 0) {
    if (httpStatus >= 200 && httpStatus < 300) return
  }
  const code = payload.errcode
  const detail = payload.errmsg?.trim() || `HTTP ${httpStatus}`
  throw new WechatApiError(`微信 API 错误${code === undefined ? '' : ` ${code}`}：${detail}`, code)
}

/** Truncate a string to a UTF-8 byte budget without splitting a character. */
function truncateUtf8(value: string, maxBytes: number): string {
  let out = ''
  let bytes = 0
  for (const ch of value) {
    const size = Buffer.byteLength(ch, 'utf8')
    if (bytes + size > maxBytes) break
    out += ch
    bytes += size
  }
  return out
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PUBLISH_STATUS_TEXT: Record<number, string> = {
  0: '发布成功',
  1: '发布中',
  2: '原创声明失败',
  3: '常规发布失败',
  4: '平台审核不通过',
}
