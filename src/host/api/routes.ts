import type { CreationRepository, CreateCreationInput, CreationType } from '../storage/creationRepository'
import type { SettingsRepository } from '../storage/SettingsRepository'
import type { AssetRepository } from '../storage/assetRepository'
import type { ImageGenService, ProviderId } from '../imagegen/ImageGenService'
import type { ImageGenRequest } from '../imagegen/types'

/**
 * Host-side HTTP API. Every route is registered through Harness's connection
 * service as an *exact* fetch route (path parameters are NOT supported — ids
 * travel as query parameters). This module also owns the type<->studio naming
 * bridge:
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
  /** Builds a fresh image-gen service so a newly saved backend takes effect without a restart. */
  buildImageGen: () => ImageGenService
}

type FetchRoute = {
  path: string
  methods: string[]
  requestBody?: 'buffered'
  fetch: (request: Request) => Promise<Response> | Response
}

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

export function registerApiRoutes(deps: ApiDeps, register: (route: FetchRoute) => void) {
  const { creations, settings, assets, buildImageGen } = deps

  // ---- Creations list + create ----

  register({
    path: '/api/paipiange.creations',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
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
    },
  })

  // ---- Single creation: get / update / soft-delete (id via query) ----

  register({
    path: '/api/paipiange.creation',
    methods: ['GET', 'PATCH', 'DELETE'],
    requestBody: 'buffered',
    async fetch(request) {
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
      return updated ? json({ creation: toClientCreation(updated) }) : error('更新失败', 404)
    },
  })

  // ---- Creation status change ----

  register({
    path: '/api/paipiange.creation.status',
    methods: ['PATCH'],
    requestBody: 'buffered',
    async fetch(request) {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { status?: 'draft' | 'queued' | 'archived' } | null
      if (!body || !body.status) return error('缺少 status 字段')
      const updated = creations.update(id, { status: body.status })
      return updated ? json({ creation: toClientCreation(updated) }) : error('记录不存在', 404)
    },
  })

  // ---- Creation hard delete (permanent, bypasses soft delete) ----

  register({
    path: '/api/paipiange.creation.purge',
    methods: ['DELETE'],
    async fetch(request) {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const ok = creations.remove(id)
      return ok ? json({ ok: true }) : error('记录不存在', 404)
    },
  })

  // ---- Image-gen config (no secrets in responses) ----

  register({
    path: '/api/paipiange.imagegen',
    methods: ['GET', 'PUT'],
    requestBody: 'buffered',
    async fetch(request) {
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
    },
  })

  // ---- Image generation ----

  register({
    path: '/api/paipiange.imagegen.generate',
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
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
    },
  })

  // ---- Asset retrieval (binary) ----

  register({
    path: '/api/paipiange.asset',
    methods: ['GET'],
    async fetch(request) {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const asset = assets.getById(id)
      if (!asset) return error('素材不存在', 404)
      const { readFileSync } = await import('node:fs')
      const buffer = readFileSync(assets.resolveAbsolutePath(asset))
      return new Response(new Uint8Array(buffer), {
        headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-store' },
      })
    },
  })
}
