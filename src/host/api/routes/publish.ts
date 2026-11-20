import { readFileSync } from 'node:fs'
import type { WechatChannelConfig } from '../../publish/WechatPublishService'
import { decodeImageDataUrl } from '../../publish/WechatPublishService'
import { error, json, type ApiDeps, type RegisterRoute } from './shared'

/** WeChat channel settings, connection test, comic pack export, and draft sync. */
export function registerPublishRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { settings, wechat, exports, publish, creations } = deps

  register('/api/paipiange.wechat.config', ['GET', 'PUT', 'DELETE'], async (request) => {
    if (request.method === 'GET') return json({ config: settings.getWechatChannelSummary() })
    if (request.method === 'DELETE') {
      settings.clearWechatChannelConfig()
      wechat.invalidateToken()
      return json({ config: settings.getWechatChannelSummary() })
    }

    const body = await request.json().catch(() => null) as Partial<WechatChannelConfig> | null
    if (!body) return error('请求体无效')
    const existing = settings.getWechatChannelConfig()
    const appId = body.appId?.trim() ?? ''
    const appSecret = body.appSecret?.trim() || existing?.appSecret || ''
    if (!appId || appId.length > 64) return error('请填写有效的公众号 AppID')
    if (!appSecret || appSecret.length > 256) return error('请填写有效的公众号 AppSecret')
    settings.setWechatChannelConfig({ appId, appSecret, defaultAuthor: body.defaultAuthor?.trim().slice(0, 32) || '' })
    wechat.invalidateToken()
    return json({ config: settings.getWechatChannelSummary() })
  })

  register('/api/paipiange.wechat.test', ['POST'], async () => {
    try {
      return json(await wechat.testConnection())
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : '公众号连接测试失败', 502)
    }
  })

  register('/api/paipiange.wechat.draft', ['POST'], async (request) => {
    const body = await request.json().catch(() => null) as {
      title?: unknown
      author?: unknown
      digest?: unknown
      footer?: unknown
      images?: unknown
      coverDataUrl?: unknown
      publishItemId?: unknown
    } | null
    if (!body || typeof body.title !== 'string' || typeof body.coverDataUrl !== 'string' || !Array.isArray(body.images)) {
      return error('公众号草稿参数不完整')
    }
    const images = body.images
      .slice(0, 8)
      .filter((item): item is { dataUrl: string; caption?: string } => Boolean(item && typeof item === 'object' && typeof (item as { dataUrl?: unknown }).dataUrl === 'string'))
      .map((item) => ({ dataUrl: item.dataUrl, caption: typeof item.caption === 'string' ? item.caption.slice(0, 200) : '' }))
    const publishItemId = typeof body.publishItemId === 'string' ? body.publishItemId : null
    const item = publishItemId ? publish.getById(publishItemId) : null
    if (publishItemId && (!item || item.platform !== 'wechat')) return error('微信公众号发布项不存在或平台不匹配', 409)
    if (item) {
      const creation = creations.getById(item.creationId)
      if (creation) publish.recordVersion(item.id, {
        title: creation.title, bodyMd: creation.bodyMd, bodyHtml: creation.bodyHtml,
        snapshot: { action: 'wechat_draft', summary: creation.summary, tags: creation.tags, updatedAt: creation.updatedAt },
      })
    }
    const attempt = publish.createAttempt({
      publishItemId: item?.id ?? null,
      platform: 'wechat',
      action: 'wechat_draft',
      retryNo: item?.retryCount ?? 0,
      request: { title: body.title.slice(0, 64), imageCount: images.length },
    })
    try {
      const result = await wechat.createDraft({
        title: body.title,
        author: typeof body.author === 'string' ? body.author : undefined,
        digest: typeof body.digest === 'string' ? body.digest : undefined,
        footer: typeof body.footer === 'string' ? body.footer : undefined,
        images,
        coverDataUrl: body.coverDataUrl,
      })
      publish.finishAttempt(attempt.id, {
        status: 'success', mediaId: result.mediaId, itemStatus: 'ready',
        result: { imageCount: result.imageCount },
      })
      return json({ result, attemptId: attempt.id })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '同步公众号草稿失败'
      publish.finishAttempt(attempt.id, { status: 'failed', errorMessage: message })
      return error(message, 502)
    }
  })

  register('/api/paipiange.wechat.sticker', ['POST'], async (request) => {
    const body = await request.json().catch(() => null) as {
      title?: unknown
      images?: unknown
      publishItemId?: unknown
    } | null
    if (!body || typeof body.title !== 'string' || !Array.isArray(body.images)) {
      return error('公众号贴图参数不完整')
    }
    const images = body.images
      .slice(0, 20)
      .filter((item): item is { dataUrl: string; caption?: string } => Boolean(item && typeof item === 'object' && typeof (item as { dataUrl?: unknown }).dataUrl === 'string'))
      .map((item) => ({ dataUrl: item.dataUrl, caption: typeof item.caption === 'string' ? item.caption.slice(0, 200) : '' }))
    if (!images.length) return error('至少需要一张漫画图片')

    const publishItemId = typeof body.publishItemId === 'string' ? body.publishItemId : null
    const item = publishItemId ? publish.getById(publishItemId) : null
    if (publishItemId && (!item || item.platform !== 'wechat')) return error('微信公众号发布项不存在或平台不匹配', 409)
    const attempt = publish.createAttempt({
      publishItemId: item?.id ?? null,
      platform: 'wechat',
      action: 'wechat_sticker',
      retryNo: item?.retryCount ?? 0,
      request: { title: body.title.slice(0, 32), imageCount: images.length },
    })
    try {
      const draft = await wechat.createStickerDraft({
        title: body.title,
        images,
        coverDataUrl: '',
      })
      publish.finishAttempt(attempt.id, {
        status: 'success', mediaId: draft.mediaId, itemStatus: 'ready',
        result: { imageCount: draft.imageCount },
      })
      return json({ result: { mediaId: draft.mediaId, imageCount: draft.imageCount }, attemptId: attempt.id })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '同步公众号贴图失败'
      publish.finishAttempt(attempt.id, { status: 'failed', errorMessage: message })
      return error(message, 502)
    }
  })

  register('/api/paipiange.comic.export', ['POST'], async (request) => {
    const body = await request.json().catch(() => null) as {
      title?: unknown
      captions?: unknown
      imageDataUrls?: unknown
      coverDataUrl?: unknown
      publishItemId?: unknown
    } | null
    if (!body || typeof body.title !== 'string' || !Array.isArray(body.imageDataUrls) || !body.imageDataUrls.length) {
      return error('贴图包参数不完整')
    }
    const publishItemId = typeof body.publishItemId === 'string' ? body.publishItemId : null
    const item = publishItemId ? publish.getById(publishItemId) : null
    if (publishItemId && !item) return error('发布项不存在', 404)
    const attempt = publish.createAttempt({
      publishItemId: item?.id ?? null,
      platform: item?.platform ?? 'other',
      action: 'comic_export',
      retryNo: item?.retryCount ?? 0,
      request: { title: body.title.slice(0, 64), imageCount: body.imageDataUrls.length },
    })
    try {
      const captions = Array.isArray(body.captions) ? body.captions.map((value) => typeof value === 'string' ? value.trim().slice(0, 200) : '') : []
      const entries: Array<{ name: string; data: Uint8Array }> = []
      for (let index = 0; index < Math.min(8, body.imageDataUrls.length); index += 1) {
        if (typeof body.imageDataUrls[index] !== 'string') continue
        const image = decodeImageDataUrl(body.imageDataUrls[index], 10 * 1024 * 1024)
        const caption = safeFilePart(captions[index] || `第-${index + 1}-张`)
        entries.push({ name: `${String(index + 1).padStart(2, '0')}-${caption}${image.extension}`, data: image.data })
      }
      if (typeof body.coverDataUrl === 'string' && body.coverDataUrl) {
        const cover = decodeImageDataUrl(body.coverDataUrl, 10 * 1024 * 1024)
        entries.unshift({ name: `cover${cover.extension}`, data: cover.data })
      }
      if (!entries.length) return error('没有可导出的漫画图片')

      const title = body.title.trim() || 'Q版情侣漫画'
      const encoder = new TextEncoder()
      entries.push({ name: 'publish-copy.txt', data: encoder.encode([title, ...captions.filter(Boolean)].join('\n\n')) })
      entries.push({
        name: 'manifest.json',
        data: encoder.encode(JSON.stringify({
          kind: 'paipiange-comic-pack',
          version: 1,
          title,
          captions,
          imageCount: body.imageDataUrls.length,
          exportedAt: new Date().toISOString(),
        }, null, 2)),
      })

      const result = exports.exportZip(title, entries)
      publish.finishAttempt(attempt.id, {
        status: 'success', itemStatus: item ? 'exported' : undefined, exportPath: result.relativePath,
        result: { fileName: result.fileName, imageCount: entries.length },
      })
      const buffer = readFileSync(exports.resolveAbsolute(result.relativePath))
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
          'Cache-Control': 'no-store',
        },
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '贴图包导出失败'
      publish.finishAttempt(attempt.id, { status: 'failed', errorMessage: message })
      return error(message)
    }
  })
}

function safeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image'
}
