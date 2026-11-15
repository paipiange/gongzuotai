import type { CreationRepository, CreateCreationInput, CreationType } from '../storage/creationRepository'
import type { SettingsRepository } from '../storage/SettingsRepository'
import type { AssetRepository } from '../storage/assetRepository'
import type { TemplateRepository } from '../storage/templateRepository'
import type { InspirationRepository } from '../storage/inspirationRepository'
import type { PublishRepository, PublishPlatform, PublishStatus } from '../storage/publishRepository'
import type { ExportService, ExportFormat } from '../storage/exportService'
import type { ImageGenService, ProviderId } from '../imagegen/ImageGenService'
import type { ImageGenRequest } from '../imagegen/types'

/**
 * Host-side HTTP API. Every route is registered as an *exact* route on the
 * official Harness `webServer` service (path parameters are NOT supported —
 * ids travel as query parameters). Handlers are written against the Web
 * Fetch API (`Request`/`Response`); the caller supplies a bridge that adapts
 * them to the host's Node request/response pair. This module also owns the
 * type<->studio naming bridge:
 *
 *   Host `type`      Client `studio`
 *   article          article
 *   title            headline
 *   image            image
 *   marketing        marketing
 *   xiaohongshu      xiaohongshu
 */

export type ApiDeps = {
  creations: CreationRepository
  settings: SettingsRepository
  assets: AssetRepository
  templates: TemplateRepository
  inspirations: InspirationRepository
  publish: PublishRepository
  exports: ExportService
  /** Builds a fresh image-gen service so a newly saved backend takes effect without a restart. */
  buildImageGen: () => ImageGenService
}

type FetchHandler = (request: Request) => Promise<Response> | Response

/** The bridge shape the host supplies to adapt Fetch handlers onto its web server. */
export type RegisterRoute = (path: string, methods: string[], handler: FetchHandler) => void

/** Client-side studio id -> Host-side creation type. */
const STUDIO_TO_TYPE: Record<string, CreationType> = {
  article: 'article',
  headline: 'title',
  image: 'image',
  marketing: 'marketing',
  xiaohongshu: 'xiaohongshu',
}

/** Host-side creation type -> client-side studio id. */
const TYPE_TO_STUDIO: Record<CreationType, string> = {
  article: 'article',
  title: 'headline',
  image: 'image',
  marketing: 'marketing',
  xiaohongshu: 'xiaohongshu',
}

function studioToType(studio: string): CreationType {
  const type = STUDIO_TO_TYPE[studio]
  if (!type) throw new Error(`Unsupported studio: ${studio}`)
  return type
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

/** Maps a Host CreationRecord onto the client's flat CreationRecord shape. */
function toClientCreation(record: ReturnType<CreationRepository['create']>) {
  return {
    id: record.id,
    studio: TYPE_TO_STUDIO[record.type],
    title: record.title,
    topic: record.summary,
    content: record.bodyMd,
    style: String(record.params.style ?? 'cinematic'),
    requirement: String(record.params.requirement ?? ''),
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

type ClientDraft = {
  studio?: string
  title?: string
  topic?: string
  content?: string
  style?: string
  requirement?: string
  status?: 'draft' | 'queued' | 'archived'
}

export function registerApiRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { creations, settings, assets, templates, inspirations, publish, exports, buildImageGen } = deps

  // ---- Creations list + create ----

  register('/api/paipiange.creations', ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as ClientDraft | null
        if (!body || !body.studio) return error('缺少 studio 字段')
        let type: CreationType
        try {
          type = studioToType(body.studio)
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : '不支持的创作类型')
        }
        const input: CreateCreationInput = {
          type,
          title: body.title,
          summary: body.topic,
          bodyMd: body.content,
          params: { style: body.style ?? 'cinematic', requirement: body.requirement ?? '' },
          status: body.status === 'queued' || body.status === 'archived' ? body.status : 'draft',
        }
        const record = creations.create(input)
        if (record.status === 'queued') publish.ensureForCreation(record.id)
        return json({ creation: toClientCreation(record) }, 201)
      }

      const url = new URL(request.url)
      const status = url.searchParams.get('status') ?? undefined
      const query = url.searchParams.get('query') ?? undefined
      const records = creations.list({
        status: status === 'draft' || status === 'queued' || status === 'archived' ? status : undefined,
        query,
      })
      return json({ creations: records.map(toClientCreation) })
  })

  // ---- Single creation: get / update / soft-delete (id via query) ----

  register('/api/paipiange.creation', ['GET', 'PATCH', 'DELETE'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const record = creations.getById(id)
      if (!record) return error('创作记录不存在', 404)

      if (request.method === 'GET') return json({ creation: toClientCreation(record) })

      if (request.method === 'DELETE') {
        const ok = creations.softDelete(id)
        return ok ? json({ ok: true }) : error('删除失败', 404)
      }
      const body = await request.json().catch(() => null) as ClientDraft | null
      if (!body) return error('请求体无效')
      const updated = creations.update(id, {
        title: body.title,
        summary: body.topic,
        bodyMd: body.content,
        status: body.status === 'queued' || body.status === 'archived' || body.status === 'draft' ? body.status : undefined,
        params: body.style !== undefined || body.requirement !== undefined
          ? { style: body.style, requirement: body.requirement }
          : undefined,
      })
      if (updated && updated.status === 'queued') publish.ensureForCreation(updated.id)
      return updated ? json({ creation: toClientCreation(updated) }) : error('更新失败', 404)
  })

  // ---- Creation status change ----

  register('/api/paipiange.creation.status', ['PATCH'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { status?: 'draft' | 'queued' | 'archived' } | null
      if (!body || !body.status) return error('缺少 status 字段')
      const updated = creations.update(id, { status: body.status })
      if (updated && updated.status === 'queued') publish.ensureForCreation(updated.id)
      return updated ? json({ creation: toClientCreation(updated) }) : error('记录不存在', 404)
  })

  // ---- Creation hard delete (permanent, bypasses soft delete) ----

  register('/api/paipiange.creation.purge', ['DELETE'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const ok = creations.remove(id)
      return ok ? json({ ok: true }) : error('记录不存在', 404)
  })

  // ---- Image-gen config (no secrets in responses) ----

  register('/api/paipiange.imagegen', ['GET', 'PUT'], async (request) => {
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null) as {
          llm?: { baseUrl: string; apiKey: string; model: string }
          comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
        } | null
        if (!body) return error('请求体无效')
        if (body.llm) {
          if (!body.llm.baseUrl || !body.llm.apiKey || !body.llm.model) return error('LLM 配置不完整')
          settings.setLlmImageConfig(body.llm)
        }
        if (body.comfyui) {
          if (!body.comfyui.server) return error('ComfyUI 配置不完整')
          settings.setComfyUiConfig(body.comfyui)
        }
        return json({ summary: settings.getImageGenSummary() })
      }
      return json({ summary: settings.getImageGenSummary() })
  })

  // ---- Text-gen config (provider + model, no secrets) ----

  register('/api/paipiange.textgen.config', ['GET', 'PUT'], async (request) => {
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null) as { provider?: string; model?: string } | null
        if (!body) return error('请求体无效')
        if (!body.provider?.trim() || !body.model?.trim()) return error('缺少 provider 或 model')
        settings.setTextGenConfig({ provider: body.provider.trim(), model: body.model.trim() })
        return json({ config: settings.getTextGenConfig() })
      }
      return json({ config: settings.getTextGenConfig() })
  })

  // ---- Image generation ----

  register('/api/paipiange.imagegen.generate', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        provider?: ProviderId
        request?: ImageGenRequest
        sourceCreationId?: string
      } | null
      if (!body || !body.provider || !body.request?.prompt) return error('缺少 provider 或 prompt')
      const imageGen = buildImageGen()
      const available = imageGen.available()
      if (!available.includes(body.provider)) return error(`生图后端未配置: ${body.provider}`, 409)
      try {
        const images = await imageGen.generate(body.provider, body.request)
        const saved = images.map((image) => {
          const asset = assets.save({
            kind: 'image',
            name: `generated-${body.provider}.png`,
            mimeType: image.mimeType,
            data: image.data,
            sourceCreationId: body.sourceCreationId ?? null,
          })
          return { id: asset.id, mimeType: asset.mimeType, relativePath: asset.relativePath, sizeBytes: asset.sizeBytes }
        })
        return json({ images: saved }, 201)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        return error(`生成失败: ${message}`, 502)
      }
  })

  // ---- Asset retrieval (binary) ----

  register('/api/paipiange.asset', ['GET'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const asset = assets.getById(id)
      if (!asset) return error('素材不存在', 404)
      const { readFileSync } = await import('node:fs')
      const buffer = readFileSync(assets.resolveAbsolutePath(asset))
      return new Response(new Uint8Array(buffer), {
        headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-store' },
      })
  })

  // ---- Asset list (metadata only) ----

  register('/api/paipiange.assets', ['GET'], async (request) => {
      const url = new URL(request.url)
      const kind = url.searchParams.get('kind')
      const creationId = url.searchParams.get('creationId')
      const rows = creationId
        ? assets.listByCreation(creationId)
        : assets.list(kind === 'image' || kind === 'file' || kind === 'prompt' || kind === 'document' ? kind : undefined)
      return json({
        assets: rows.map((a) => ({
          id: a.id,
          kind: a.kind,
          name: a.name,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          width: a.width,
          height: a.height,
          tags: a.tags,
          sourceCreationId: a.sourceCreationId,
          createdAt: a.createdAt,
        })),
      })
  })

  // ---- Asset upload (binary) ----

  register('/api/paipiange.asset.upload', ['POST'], async (request) => {
      const sourceCreationId = new URL(request.url).searchParams.get('creationId') ?? undefined
      const mimeType = request.headers.get('Content-Type') ?? 'application/octet-stream'
      const kind: 'image' | 'file' = mimeType.startsWith('image/') ? 'image' : 'file'
      const name = request.headers.get('X-File-Name') ?? `upload-${Date.now()}`
      const buffer = Buffer.from(await request.arrayBuffer())
      if (buffer.byteLength === 0) return error('上传内容为空')
      const record = assets.save({ kind, name, mimeType, data: buffer, sourceCreationId: sourceCreationId ?? null })
      return json({ asset: { id: record.id, kind: record.kind, name: record.name, mimeType: record.mimeType, sizeBytes: record.sizeBytes } }, 201)
  })

  // ---- Templates ----

  register('/api/paipiange.templates', ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as {
          category?: string
          name?: string
          description?: string
          promptTemplate?: string
          fields?: unknown[]
        } | null
        if (!body || !body.name || !body.promptTemplate) return error('缺少 name 或 promptTemplate')
        try {
          const record = templates.create({ category: body.category ?? '通用', name: body.name, description: body.description, promptTemplate: body.promptTemplate, fields: body.fields })
          return json({ template: record }, 201)
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : '创建模板失败')
        }
      }
      const category = new URL(request.url).searchParams.get('category') ?? undefined
      return json({ templates: templates.list({ category }) })
  })

  // ---- Inspirations ----

  register('/api/paipiange.inspirations', ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as {
          title?: string
          description?: string
          promptTemplate?: string
          category?: string
          tags?: string[]
        } | null
        if (!body || !body.title) return error('缺少 title')
        try {
          const record = inspirations.create({ title: body.title, description: body.description ?? '', promptTemplate: body.promptTemplate ?? '', category: body.category ?? '通用', tags: body.tags })
          return json({ inspiration: record }, 201)
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : '创建灵感失败')
        }
      }
      const category = new URL(request.url).searchParams.get('category') ?? undefined
      return json({ inspirations: inspirations.list({ category }) })
  })

  // ---- Publish queue ----

  register('/api/paipiange.publish', ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as { creationId?: string; platform?: string; status?: string } | null
        if (!body || !body.creationId || !body.platform) return error('缺少 creationId 或 platform')
        if (!['wechat', 'xiaohongshu', 'zhihu', 'toutiao', 'other'].includes(body.platform)) return error('不支持的发布平台')
        try {
          const record = publish.create({ creationId: body.creationId, platform: body.platform as PublishPlatform, status: body.status === 'ready' || body.status === 'exported' || body.status === 'published' ? body.status as PublishStatus : 'draft' })
          return json({ item: record }, 201)
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : '创建发布项失败')
        }
      }
      const status = new URL(request.url).searchParams.get('status')
      return json({ items: publish.list({ status: status === 'draft' || status === 'ready' || status === 'exported' || status === 'published' ? status as PublishStatus : undefined }) })
  })

  // ---- Publish item status ----

  register('/api/paipiange.publish.status', ['PATCH'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { status?: string; externalUrl?: string } | null
      if (!body || !body.status) return error('缺少 status')
      if (!['draft', 'ready', 'exported', 'published'].includes(body.status)) return error('无效状态')
      const updated = publish.update(id, {
        status: body.status as PublishStatus,
        ...(body.externalUrl !== undefined ? { externalUrl: body.externalUrl } : {}),
      })
      return updated ? json({ item: updated }) : error('发布项不存在', 404)
  })

  // ---- Export ----

  register('/api/paipiange.export', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { creationId?: string; format?: string } | null
      if (!body || !body.creationId) return error('缺少 creationId')
      if (!['markdown', 'html', 'zip'].includes(body.format ?? '')) return error('不支持的导出格式')
      const creation = creations.getById(body.creationId)
      if (!creation) return error('创作记录不存在', 404)
      const { readFileSync, statSync } = await import('node:fs')
      const result = exports.export(
        { title: creation.title, bodyMd: creation.bodyMd, bodyHtml: creation.bodyHtml },
        body.format as ExportFormat,
      )
      const absolute = exports.resolveAbsolute(result.relativePath)
      const buffer = readFileSync(absolute)
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': body.format === 'markdown' ? 'text/markdown' : body.format === 'html' ? 'text/html' : 'application/zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
          'Cache-Control': 'no-store',
        },
      })
  })
}
