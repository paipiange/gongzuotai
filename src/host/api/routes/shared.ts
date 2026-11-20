import type { CreationRepository, CreationType } from '../../storage/creationRepository'
import type { SettingsRepository } from '../../storage/SettingsRepository'
import type { AssetRepository } from '../../storage/assetRepository'
import type { TemplateRepository } from '../../storage/templateRepository'
import type { InspirationRepository } from '../../storage/inspirationRepository'
import type { PublishRepository } from '../../storage/publishRepository'
import type { TaskRepository } from '../../storage/taskRepository'
import type { GraphicSessionRepository } from '../../storage/graphicSessionRepository'
import type { AnalyticsRepository } from '../../storage/AnalyticsRepository'
import type { ExportService } from '../../storage/exportService'
import type { ImageGenService } from '../../imagegen/ImageGenService'
import type { LlmService } from '../../textgen/types'
import type { WechatPublishService } from '../../publish/WechatPublishService'
import type { GenerationQueue } from '../../queue/GenerationQueue'

/**
 * Shared types and helpers for the Host HTTP API route modules. Kept separate
 * from `routes.ts` so each domain module can import exactly what it needs.
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
  queue: GenerationQueue
  graphicSessions: GraphicSessionRepository
  analytics: AnalyticsRepository
  wechat: WechatPublishService
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

export function studioToType(studio: string): CreationType {
  const type = STUDIO_TO_TYPE[studio]
  if (!type) throw new Error(`Unsupported studio: ${studio}`)
  return type
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status)
}

/** Normalize a client tag array: trim, drop empties, de-duplicate. */
export function normalizeTags(tags: unknown): string[] | undefined {
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
export function toClientCreation(record: ReturnType<CreationRepository['create']>) {
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

export type ClientDraft = {
  studio?: string
  title?: string
  topic?: string
  content?: string
  style?: string
  requirement?: string
  status?: 'draft' | 'queued' | 'archived'
  tags?: string[]
}
