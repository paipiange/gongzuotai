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

export type GenerationOriginKind = 'studio' | 'template' | 'graphic'

/** Stable resume contract persisted with every generation task. Never contains credentials or image data URLs. */
export interface GenerationOrigin {
  kind: GenerationOriginKind
  id: string
  label?: string
  state?: Record<string, unknown>
}

export interface TemplateRecord {
  id: string
  category: string
  name: string
  description: string
  coverAssetId: string | null
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
  externalId: string | null
  lastError: string | null
  retryCount: number
  lastCheckedAt: string | null
  exportedAt: string | null
  publishedAt: string | null
  scheduledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PublishAttempt {
  id: string
  publishItemId: string | null
  platform: PublishPlatform
  action: string
  status: 'running' | 'success' | 'failed'
  mediaId: string | null
  errorMessage: string | null
  retryNo: number
  request: Record<string, unknown>
  result: Record<string, unknown>
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

export interface PublishVersion {
  id: string
  publishItemId: string
  versionNo: number
  title: string
  bodyMd: string
  bodyHtml: string
  snapshot: Record<string, unknown>
  createdAt: string
}

export interface PublishChecklistItem {
  key: string
  label: string
  passed: boolean
  message: string
}

export interface PublishDetail {
  item: PublishItem
  attempts: PublishAttempt[]
  versions: PublishVersion[]
  checklist: PublishChecklistItem[]
}

export interface WechatChannelSummary {
  configured: boolean
  appId: string
  defaultAuthor: string
  hasAppSecret: boolean
  accounts: WechatAccountSummary[]
  activeId: string | null
}

export interface WechatAccountSummary {
  id: string
  name: string
  appId: string
  defaultAuthor: string
}

export interface ComicPublishImage {
  dataUrl: string
  caption: string
}

export interface WechatDraftInput {
  title: string
  author?: string
  digest?: string
  footer?: string
  images: ComicPublishImage[]
  coverDataUrl: string
  publishItemId?: string
}

export interface WechatStickerInput {
  title: string
  images: ComicPublishImage[]
  publishItemId?: string
}

export interface WechatDraftResult {
  mediaId: string
  imageCount: number
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
  deletedAt?: string | null
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
  activeCount: number
  activeBytes: number
  byKind: Record<'image' | 'file' | 'prompt' | 'document', { count: number; bytes: number }>
  deletedCount: number
  deletedBytes: number
  orphanCount: number
  orphanBytes: number
  duplicateGroupCount: number
  duplicateCount: number
  duplicateBytes: number
}

export interface BackupRecord {
  filename: string
  sizeBytes: number
  createdAt: string
}

export interface BackupPolicy {
  enabled: boolean
  intervalDays: number
  retention: number
  lastRunAt: string | null
}

/** 首页轮播图配置（客户端投影）。assetIds 为空表示未配置，回退默认图。 */
export interface HomeCarouselConfig {
  assetIds: string[]
  intervalMs: number
  /** 是否把内置默认图纳入轮播（默认 true）。 */
  includeDefault: boolean
}

export type TaskKind = 'text' | 'image' | 'video'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled'

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
  priority: number
  attempt: number
  retryCount: number
  maxAttempts: number
  availableAt: string | null
  heartbeatAt: string | null
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

/** 模板使用归因（对应后端 AnalyticsRepository.TemplateAttribution）。 */
export interface TemplateAttribution {
  name: string
  category: string | null
  used: number
  succeeded: number
  failed: number
  successRate: number
}

/** 创作节奏洞察（对应后端 AnalyticsRepository.PublishingInsights）。 */
export interface PublishingInsights {
  templateAttribution: TemplateAttribution[]
  generationByHour: number[]
  publishByHour: number[]
  recommendedHour: number | null
}
