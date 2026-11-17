/**
 * Shared client-facing types for the Host bridge. These mirror the Host's flat
 * projections and are grouped here so domain API modules stay small. Import them
 * from the barrel (`./hostClient`) as before — nothing changes for callers.
 */

export type StudioId = 'article' | 'image' | 'headline' | 'marketing' | 'xiaohongshu' | 'graphic'

export type CreationStatus = 'draft' | 'queued' | 'archived'

/** Client-facing creation record, mirroring the Host's flat projection. */
export interface CreationRecord {
  id: string
  studio: StudioId
  title: string
  topic: string
  content: string
  style: string
  requirement: string
  status: CreationStatus
  coverAssetId: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface CreationDraft {
  id?: string
  studio: StudioId
  title: string
  topic: string
  content: string
  style: string
  requirement: string
  status?: CreationStatus
  tags?: string[]
}

export interface ImageGenSummary {
  llm?: { baseUrl: string; model: string }
  comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
}

/** A user-managed generation backend (text or image). */
export type BackendKind = 'llm-text' | 'llm-image' | 'comfyui'

export interface Backend {
  id: string
  name: string
  kind: BackendKind
  llm?: { baseUrl: string; model: string; apiKey?: string; models?: string[] }
  text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
  comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
  createdAt: string
  updatedAt: string
}

export interface GeneratedImageResult {
  id: string
  mimeType: string
  relativePath: string
  sizeBytes: number
}

export interface TemplateRecord {
  id: string
  category: string
  name: string
  description: string
  promptTemplate: string
  fields: unknown[]
  isBuiltin: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export interface InspirationRecord {
  id: string
  title: string
  description: string
  promptTemplate: string
  category: string
  tags: string[]
  coverAssetId: string | null
  isBuiltin: boolean
  createdAt: string
}

export type PublishPlatform = 'wechat' | 'xiaohongshu' | 'zhihu' | 'toutiao' | 'other'
export type PublishStatus = 'draft' | 'ready' | 'exported' | 'published'

export interface PublishItem {
  id: string
  creationId: string
  platform: PublishPlatform
  status: PublishStatus
  exportPath: string | null
  externalUrl: string | null
  exportedAt: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AssetRecord {
  id: string
  kind: 'image' | 'file' | 'prompt' | 'document'
  name: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  tags: string[]
  sourceCreationId: string | null
  createdAt: string
}

export type TextStudio = 'article' | 'headline' | 'marketing' | 'xiaohongshu'

export interface TextGenProgress {
  /** Incremental text delta. */
  delta?: string
  /** Final token usage (present on the `usage` event). */
  usage?: { inputTokens: number; outputTokens: number }
  /** Terminal finish reason (present on the `finish` event). */
  finishReason?: string
  /** Non-recoverable error message (present on the `error` event). */
  error?: string
}

export interface TextGenConfig {
  provider: string
  model: string
}

export interface TextGenProviders {
  providers: string[]
  models: Record<string, string[]>
}

export interface BackendTestResult {
  ok: boolean
  kind: string
  message: string
  latencyMs?: number
}

export interface FetchModelsResult {
  ok: boolean
  models: string[]
  message?: string
}

export interface TemplateExportPayload {
  kind: string
  version: number
  exportedAt: string
  templates: Array<{ category: string; name: string; description: string; promptTemplate: string; fields: unknown[] }>
}

/** aihot 热门资讯条目。 */
export interface AihotItem {
  id: string
  title: string
  originalTitle?: string
  summary: string
  source: string
  category: string
  score: number
  publishedAt: string
  link: string
  originalLink?: string
  reason?: string
}

/** 图文分镜拆页输入（对应后端 storyboard 路由）。 */
export interface StoryboardFact {
  id: string
  label: string
  raw_amount: string
  amount_yuan: number | null
  unit: string
  source_fragment: string
  needs_review: boolean
}

export interface StoryboardPage {
  page_no: number
  page_type: string
  title: string
  subtitle: string
  layout_id: string
  facts_used: string[]
  visual_brief: string
  disclaimer: string
}

export interface StoryboardResult {
  topic: string
  facts: StoryboardFact[]
  pages: StoryboardPage[]
  computed: { sum_yuan: number | null; target_yuan: number | null; difference_yuan: number | null }
  warnings: string[]
}

/** 单页会话草稿（page + 已生成 assetId + 错误信息）。 */
export interface GraphicSessionPage {
  page: StoryboardPage
  assetId?: string
  error?: string
}

/** 公众号创作工作台的当前会话（后端 SQLite 持久化，跨会话/重启可恢复）。 */
export interface GraphicSession {
  sourceText: string
  topic: string
  pageCount: number
  textPick: string
  imagePick: string
  storyboard: StoryboardResult | null
  pages: GraphicSessionPage[]
  sessionId: string
}

export interface AssetStorageStats {
  deletedCount: number
  deletedBytes: number
  orphanCount: number
  orphanBytes: number
}

export interface BackupRecord {
  filename: string
  sizeBytes: number
  createdAt: string
}

export type TaskKind = 'text' | 'image' | 'video'
export type TaskStatus = 'running' | 'success' | 'failed'

export interface TaskRecord {
  id: string
  clientRequestId: string | null
  kind: TaskKind
  status: TaskStatus
  creationId: string | null
  modelId: string | null
  errorCode: string | null
  errorMessage: string | null
  input: Record<string, unknown>
  result: Record<string, unknown>
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

/** 数据分析看板总览（对应后端 AnalyticsRepository.overview）。 */
export interface AnalyticsOverview {
  generated: {
    total: number
    byKind: Record<string, number>
    byStatus: Record<string, number>
    successRate: number
  }
  creations: { total: number; byStatus: Record<string, number>; byType: Record<string, number> }
  assets: { total: number; byKind: Record<string, number> }
  publish: { total: number; byStatus: Record<string, number> }
  trend7d: Array<{ day: string; count: number }>
}
