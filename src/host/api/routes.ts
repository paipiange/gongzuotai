import type { CreationRepository, CreateCreationInput, CreationType } from '../storage/creationRepository'
import type { SettingsRepository } from '../storage/SettingsRepository'
import type { AssetRepository } from '../storage/assetRepository'
import type { TemplateRepository } from '../storage/templateRepository'
import type { InspirationRepository } from '../storage/inspirationRepository'
import type { PublishRepository, PublishPlatform, PublishStatus } from '../storage/publishRepository'
import type { TaskRepository } from '../storage/taskRepository'
import type { ExportService, ExportFormat } from '../storage/exportService'
import type { ImageGenService, ProviderId } from '../imagegen/ImageGenService'
import type { ImageGenRequest } from '../imagegen/types'
import type { LlmService } from '../textgen/types'

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
  tasks: TaskRepository
  /** Builds a fresh image-gen service so a newly saved backend takes effect without a restart. */
  buildImageGen: () => ImageGenService
  /** Harness `llm` service (for AI inspiration suggestion). Optional. */
  llm?: LlmService
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

/** Normalize a client tag array: trim, drop empties, de-duplicate. */
function normalizeTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of tags) {
    if (typeof item !== 'string') continue
    const tag = item.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
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
    coverAssetId: record.coverAssetId,
    tags: record.tags,
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
  tags?: string[]
}

export function registerApiRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { creations, settings, assets, templates, inspirations, publish, exports, tasks, buildImageGen, llm } = deps

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
          tags: normalizeTags(body.tags),
        }
        const record = creations.create(input)
        if (record.status === 'queued') publish.ensureForCreation(record.id)
        return json({ creation: toClientCreation(record) }, 201)
      }

      const url = new URL(request.url)
      const status = url.searchParams.get('status') ?? undefined
      const query = url.searchParams.get('query') ?? undefined
      const tagsParam = url.searchParams.get('tags') ?? undefined
      const records = creations.list({
        status: status === 'draft' || status === 'queued' || status === 'archived' ? status : undefined,
        query,
        tags: tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
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
        tags: normalizeTags(body.tags),
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

  // ---- Creation cover asset ----

  register('/api/paipiange.creation.cover', ['PATCH'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { assetId?: string | null } | null
      if (!body || body.assetId === undefined) return error('缺少 assetId 字段')
      // Setting a cover references an existing asset; clearing (null) is always allowed.
      if (body.assetId !== null && !assets.getById(body.assetId)) return error('素材不存在', 404)
      const updated = creations.update(id, { coverAssetId: body.assetId })
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
        backendId?: string
        request?: ImageGenRequest
        sourceCreationId?: string
      } | null
      if (!body || !body.request?.prompt) return error('缺少 prompt')
      const imageGen = buildImageGen()
      const task = tasks.start({
        kind: 'image',
        creationId: body.sourceCreationId ?? null,
        modelId: body.backendId ?? body.provider ?? null,
        input: {
          prompt: body.request.prompt,
          negativePrompt: body.request.negativePrompt,
          count: body.request.count,
          size: body.request.size,
          seed: body.request.seed,
          steps: body.request.steps,
          cfg: body.request.cfg,
          model: body.request.model,
          hasReferenceImage: !!(body.request.image || body.request.images?.length),
          referenceImageCount: body.request.images?.length ?? (body.request.image ? 1 : 0),
          denoise: body.request.denoise,
          backendId: body.backendId,
          provider: body.provider,
          sourceCreationId: body.sourceCreationId,
        },
      })
      try {
        const images = body.backendId
          ? await imageGen.generateByBackend(body.backendId, body.request)
          : await imageGen.generate(body.provider ?? 'llm', body.request)
        const saved = images.map((image) => {
          const asset = assets.save({
            kind: 'image',
            name: `generated-${body.backendId ?? body.provider ?? 'image'}.png`,
            mimeType: image.mimeType,
            data: image.data,
            sourceCreationId: body.sourceCreationId ?? null,
          })
          return { id: asset.id, mimeType: asset.mimeType, relativePath: asset.relativePath, sizeBytes: asset.sizeBytes }
        })
        tasks.markSuccess(task.id, {
          count: saved.length,
          images: saved.map((s) => ({ id: s.id, mimeType: s.mimeType, sizeBytes: s.sizeBytes })),
        }, body.backendId ?? body.provider ?? null)
        return json({ images: saved }, 201)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        try {
          tasks.markFailed(task.id, 'imagegen', message)
        } catch {
          // recording must not mask the real error
        }
        return error(`生成失败: ${message}`, 502)
      }
  })

  // ---- Generation tasks (request params + result logs, success & failure) ----

  register('/api/paipiange.tasks', ['GET'], async (request) => {
      const url = new URL(request.url)
      const kind = url.searchParams.get('kind')
      const status = url.searchParams.get('status')
      const limit = Number(url.searchParams.get('limit') ?? '100') || 100
      const offset = Number(url.searchParams.get('offset') ?? '0') || 0
      const rows = tasks.list(
        kind === 'text' || kind === 'image' ? kind : undefined,
        status === 'running' || status === 'success' || status === 'failed' ? status : undefined,
        limit,
        offset,
      )
      return json({ tasks: rows })
  })

  register('/api/paipiange.task', ['GET'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const task = tasks.getById(id)
      if (!task) return error('任务不存在', 404)
      return json({ task })
  })

  // ---- Multi-backend management (CRUD) ----

  register('/api/paipiange.backends', ['GET'], async () => {
      return json({ backends: settings.listBackends() })
  })

  register('/api/paipiange.backend', ['POST', 'PATCH', 'DELETE'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as {
          name?: string
          kind?: 'llm-text' | 'llm-image' | 'comfyui'
          llm?: { baseUrl: string; apiKey: string; model: string; models?: string[] }
          text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
          comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
        } | null
        if (!body || !body.name?.trim() || !body.kind) return error('缺少 name 或 kind')
        if (body.kind === 'comfyui') {
          if (!body.comfyui?.server) return error('ComfyUI 配置缺少 server')
        } else if (body.kind === 'llm-text') {
          if (!body.text?.model) return error('文本后端缺少 model')
          if (!body.text?.provider && !body.text?.baseUrl) return error('文本后端缺少 provider 或 baseUrl')
        } else {
          if (!body.llm?.baseUrl || !body.llm?.apiKey || !body.llm?.model) return error('LLM 配置缺少 baseUrl/apiKey/model')
        }
        const created = settings.createBackend({
          name: body.name.trim(),
          kind: body.kind,
          llm: body.llm,
          text: body.text,
          comfyui: body.comfyui,
        })
        return json({ backend: created }, 201)
      }
      if (!id) return error('缺少 id')
      if (request.method === 'DELETE') {
        const ok = settings.removeBackend(id)
        return ok ? json({ ok: true }) : error('后端不存在', 404)
      }
      // PATCH
      const body = await request.json().catch(() => null) as {
        name?: string
        llm?: { baseUrl: string; apiKey: string; model: string; models?: string[] }
        text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
        comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
      } | null
      if (!body) return error('请求体无效')
      // The client never holds secrets: on edit the apiKey arrives blank. When
      // blank, preserve the host-side key instead of overwriting it with ''.
      const existing = settings.listBackendsWithSecrets().find((b) => b.id === id)
      const patch: {
        name?: string
        llm?: { baseUrl: string; apiKey: string; model: string; models?: string[] }
        text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
        comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
      } = {}
      if (body.name?.trim()) patch.name = body.name.trim()
      if (body.llm) {
        patch.llm = {
          ...body.llm,
          apiKey: body.llm.apiKey?.trim() || existing?.llm?.apiKey || '',
        }
      }
      if (body.text) {
        const mergedApiKey = body.text.apiKey?.trim() || existing?.text?.apiKey || ''
        patch.text = { ...body.text, apiKey: mergedApiKey || undefined }
      }
      if (body.comfyui) patch.comfyui = body.comfyui
      const updated = settings.updateBackend(id, patch)
      return updated ? json({ backend: updated }) : error('后端不存在', 404)
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

  // ---- Asset delete (soft) ----
  // NOTE: must be a distinct path — dsh's webserver treats the exact route
  // string as a unique key and does not distinguish by HTTP method, so a
  // second "/api/paipiange.asset" collides with the binary GET route above.

  register('/api/paipiange.asset.delete', ['POST'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const ok = assets.softDelete(id)
      return ok ? json({ ok: true }) : error('素材不存在', 404)
  })

  // ---- Asset tags update ----

  register('/api/paipiange.asset.tags', ['PATCH'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { tags?: unknown } | null
      if (!body || !Array.isArray(body.tags)) return error('缺少 tags 字段')
      const ok = assets.updateTags(id, normalizeTags(body.tags) ?? [])
      return ok ? json({ ok: true }) : error('素材不存在', 404)
  })

  // ---- Batch creations (archive / restore / delete / export) ----

  register('/api/paipiange.creations.batch', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { ids?: string[]; action?: string; status?: string } | null
      if (!body || !Array.isArray(body.ids) || !body.ids.length) return error('缺少 ids')
      if (body.ids.length > 100) return error('单次批量最多 100 条')
      const action = body.action ?? ''
      const ids = body.ids.filter((id): id is string => typeof id === 'string')
      const done: string[] = []
      for (const id of ids) {
        if (action === 'archive') {
          if (creations.update(id, { status: 'archived' })) done.push(id)
        } else if (action === 'restore') {
          if (creations.getById(id, true)?.deletedAt) {
            if (creations.restore(id)) done.push(id)
          } else if (creations.update(id, { status: 'draft' })) {
            done.push(id)
          }
        } else if (action === 'delete') {
          if (creations.remove(id)) done.push(id)
        } else if (action === 'status') {
          if (body.status === 'draft' || body.status === 'queued' || body.status === 'archived') {
            const updated = creations.update(id, { status: body.status })
            if (updated && body.status === 'queued') publish.ensureForCreation(updated.id)
            if (updated) done.push(id)
          }
        }
      }
      return json({ done, total: ids.length })
  })

  // ---- Batch assets delete ----

  register('/api/paipiange.assets.batchdelete', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { ids?: string[] } | null
      if (!body || !Array.isArray(body.ids) || !body.ids.length) return error('缺少 ids')
      if (body.ids.length > 100) return error('单次批量最多 100 条')
      let done = 0
      for (const id of body.ids) {
        if (typeof id === 'string' && assets.softDelete(id)) done += 1
      }
      return json({ done, total: body.ids.length })
  })

  // ---- Backend connection test ----

  register('/api/paipiange.backend.test', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { kind?: string; llm?: { baseUrl: string; apiKey: string; model: string }; comfyui?: { server: string }; text?: { provider: string; model: string } } | null
      if (!body) return error('请求体无效')
      const { default: testBackendConnection } = await import('../imagegen/connectionTest')
      try {
        const result = await testBackendConnection(body as never, llm)
        return json(result)
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 502)
      }
  })

  // ---- Fetch supported models for a backend (form picker) ----

  register('/api/paipiange.models.fetch', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { kind?: string; provider?: string; baseUrl?: string; apiKey?: string; backendId?: string } | null
      if (!body || (body.kind !== 'llm-text' && body.kind !== 'llm-image')) return error('缺少 kind（llm-text / llm-image）')
      const { default: fetchBackendModels } = await import('../imagegen/fetchModels')
      try {
        // When the client is editing a saved backend it only has the blanked
        // apiKey (secrets never leave the host), so resolve the real key by id.
        let apiKey = body.apiKey?.trim() || ''
        if (!apiKey && body.backendId) {
          const backend = settings.listBackendsWithSecrets().find((b) => b.id === body.backendId)
          if (backend?.kind === 'llm-image' && backend.llm) apiKey = backend.llm.apiKey ?? ''
          else if (backend?.kind === 'llm-text' && backend.text) apiKey = backend.text.apiKey ?? ''
        }
        const result = await fetchBackendModels(
          { kind: body.kind, provider: body.provider, baseUrl: body.baseUrl, apiKey: apiKey || undefined },
          llm,
        )
        return json(result)
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 502)
      }
  })

  // ---- Asset list (metadata only) ----

  register('/api/paipiange.assets', ['GET'], async (request) => {
      const url = new URL(request.url)
      const kind = url.searchParams.get('kind')
      const creationId = url.searchParams.get('creationId')
      const tagsParam = url.searchParams.get('tags')
      const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined
      const rows = creationId
        ? assets.listByCreation(creationId)
        : assets.list(kind === 'image' || kind === 'file' || kind === 'prompt' || kind === 'document' ? kind : undefined, 100, 0, tags)
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

  // ---- Template import / export (shareable JSON) ----

  register('/api/paipiange.templates.export', ['GET'], async (request) => {
      const url = new URL(request.url)
      const idsParam = url.searchParams.get('ids')
      const ids = idsParam ? idsParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined
      const all = templates.list({})
      const selected = ids && ids.length ? all.filter((t) => ids.includes(t.id)) : all
      const payload = {
        kind: 'paipiange-templates',
        version: 1,
        exportedAt: new Date().toISOString(),
        templates: selected.map((t) => ({
          category: t.category,
          name: t.name,
          description: t.description,
          promptTemplate: t.promptTemplate,
          fields: t.fields,
        })),
      }
      return json(payload)
  })

  register('/api/paipiange.templates.import', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { templates?: Array<{ category?: string; name?: string; description?: string; promptTemplate?: string; fields?: unknown[] }> } | null
      if (!body || !Array.isArray(body.templates) || !body.templates.length) return error('缺少 templates 数组')
      const imported: Array<ReturnType<TemplateRepository['create']>> = []
      for (const item of body.templates) {
        if (!item?.name || !item?.promptTemplate) continue
        try {
          imported.push(templates.create({
            category: item.category ?? '通用',
            name: item.name,
            description: item.description,
            promptTemplate: item.promptTemplate,
            fields: item.fields ?? [],
          }))
        } catch {
          // skip malformed entries
        }
      }
      return json({ imported: imported.length }, 201)
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

  // ---- Inspiration AI suggestion ----

  register('/api/paipiange.inspiration.suggest', ['POST'], async (request) => {
      if (!llm || typeof llm.prepareCall !== 'function') return error('Harness 文本模型服务未就绪', 503)
      const body = await request.json().catch(() => null) as { topics?: string[]; count?: number } | null
      if (!body) return error('请求体无效')
      const topics = Array.isArray(body.topics) ? body.topics.filter((t): t is string => typeof t === 'string').slice(0, 20) : []
      const count = Math.min(Math.max(body.count ?? 3, 1), 6)
      const { suggestInspirations } = await import('../textgen/inspirationSuggest')
      try {
        const defaults = settings.getTextGenConfig()
        const suggestions = await suggestInspirations(llm, { topics, count, provider: defaults.provider, model: defaults.model })
        const saved = suggestions.map((s) => inspirations.create({ title: s.title, description: s.description, promptTemplate: s.promptTemplate, category: s.category ?? 'AI 推荐', tags: s.tags }))
        return json({ inspirations: saved }, 201)
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 502)
      }
  })

  // ---- Storyboard breakdown (multi-page graphic) ----

  register('/api/paipiange.storyboard', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        sourceText?: string
        extractedImageText?: string
        topic?: string
        pageCount?: number
        platform?: string
        provider?: string
        model?: string
        baseUrl?: string
        apiKey?: string
        backendId?: string
      } | null
      if (!body) return error('请求体无效')
      const pageCount = Math.min(Math.max(Math.floor(body.pageCount ?? 4), 1), 12)
      const input = {
        sourceText: body.sourceText ?? '',
        extractedImageText: body.extractedImageText ?? '',
        topic: body.topic ?? '',
        pageCount,
        platform: body.platform ?? '公众号',
      }
      const { generateStoryboard, parseStoryboard, storyboardPrompts } = await import('../textgen/storyboardService')
      const { generateTextWithPromptDirect } = await import('../textgen/textGenService')

      // Resolve backend config (secrets) when a saved text backend is referenced.
      let directBaseUrl = body.baseUrl?.trim().replace(/\/+$/, '') || ''
      let directApiKey = body.apiKey?.trim() ?? ''
      let directModel = body.model?.trim() ?? ''
      if (body.backendId) {
        const backend = settings.listBackendsWithSecrets().find((b) => b.id === body.backendId)
        if (backend?.kind === 'llm-text' && backend.text) {
          directBaseUrl = backend.text.baseUrl?.trim().replace(/\/+$/, '') || ''
          directApiKey = backend.text.apiKey ?? ''
          if (!directModel) directModel = backend.text.model
        }
      }

      try {
        if (directBaseUrl) {
          if (!directModel) return error('直连文字后端缺少模型名')
          const { system, user } = storyboardPrompts(input)
          const result = await generateTextWithPromptDirect(
            { baseUrl: directBaseUrl, apiKey: directApiKey, model: directModel },
            { system, user },
          )
          const parsed = parseStoryboard(result.text)
          if (!parsed) return error('模型未返回有效的分镜 JSON，请重试或更换文字模型', 502)
          return json({ storyboard: parsed })
        }

        if (!llm || typeof llm.prepareCall !== 'function') return error('Harness 文本模型服务未就绪', 503)
        const defaults = settings.getTextGenConfig()
        const provider = body.provider?.trim() || defaults.provider
        const model = directModel || defaults.model
        if (!provider) return error('尚未配置任何可用的文本模型 Provider')
        const storyboard = await generateStoryboard(llm, { ...input, provider, model })
        return json({ storyboard })
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 502)
      }
  })

  // ---- aihot news proxy ----

  register('/api/paipiange.inspiration.aihot', ['GET'], async (request) => {
      const params = new URL(request.url).searchParams
      const { fetchAihotItems } = await import('../textgen/aihot')
      const mode = params.get('mode') === 'all' ? 'all' : 'selected'
      const category = params.get('category')?.trim() || undefined
      const window = params.get('window')?.trim() || '24h'
      const limitRaw = Number(params.get('limit') ?? '')
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 50) : 20
      try {
        const items = await fetchAihotItems({ mode, category, window, limit })
        return json({ items })
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : '拉取 aihot 失败', 502)
      }
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
      const body = await request.json().catch(() => null) as { creationId?: string; format?: string; platform?: string } | null
      if (!body || !body.creationId) return error('缺少 creationId')
      const format = body.format ?? 'markdown'
      if (!['markdown', 'html', 'zip', 'text'].includes(format)) return error('不支持的导出格式')
      const creation = creations.getById(body.creationId)
      if (!creation) return error('创作记录不存在', 404)
      const { readFileSync } = await import('node:fs')

      // Platform-adapted plain-text export.
      if (format === 'text') {
        const platform = ['wechat', 'xiaohongshu', 'zhihu', 'toutiao', 'other'].includes(body.platform ?? '') ? body.platform as 'wechat' | 'xiaohongshu' | 'zhihu' | 'toutiao' | 'other' : 'other'
        const result = exports.exportForPlatform(
          {
            title: creation.title,
            bodyMd: creation.bodyMd,
            bodyHtml: creation.bodyHtml,
            topic: creation.summary,
            tags: Array.isArray(creation.params.tags) ? creation.params.tags as string[] : [],
          },
          platform,
        )
        const absolute = exports.resolveAbsolute(result.relativePath)
        const buffer = readFileSync(absolute)
        return new Response(new Uint8Array(buffer), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
            'Cache-Control': 'no-store',
          },
        })
      }

      const result = exports.export(
        { title: creation.title, bodyMd: creation.bodyMd, bodyHtml: creation.bodyHtml },
        format as ExportFormat,
      )
      const absolute = exports.resolveAbsolute(result.relativePath)
      const buffer = readFileSync(absolute)
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': format === 'markdown' ? 'text/markdown' : format === 'html' ? 'text/html' : 'application/zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
          'Cache-Control': 'no-store',
        },
      })
  })
}
