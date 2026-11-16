/**
 * Client-side bridge to the Host half's REST API. The Host exposes exact fetch
 * routes under `/api/paipiange.*`; the browser page is same-origin with the
 * Host (loopback in desktop), so a relative `fetch()` reaches them directly.
 *
 * Every call is defensive: on network failure or a non-2xx response it throws
 * a typed `HostError` so callers can decide whether to fall back to local
 * storage or surface a clear message — never fabricate a success.
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

export class HostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'HostError'
  }
}

const BASE = '/api/paipiange'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (cause) {
    throw new HostError(`无法连接到本地服务: ${cause instanceof Error ? cause.message : String(cause)}`, 0)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `请求失败 (HTTP ${response.status})`, response.status)
  }
  return response.json() as Promise<T>
}

// ---- Creations ----

export async function listCreations(input?: { status?: CreationStatus; query?: string; tags?: string[] }): Promise<CreationRecord[]> {
  const params = new URLSearchParams()
  if (input?.status) params.set('status', input.status)
  if (input?.query) params.set('query', input.query)
  if (input?.tags?.length) params.set('tags', input.tags.join(','))
  const query = params.toString()
  const data = await apiFetch<{ creations: CreationRecord[] }>(`.creations${query ? `?${query}` : ''}`)
  return data.creations
}

export async function createCreation(draft: CreationDraft): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>('.creations', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
  return data.creation
}

export async function getCreation(id: string): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>(`.creation?id=${encodeURIComponent(id)}`)
  return data.creation
}

export async function updateCreation(id: string, patch: Partial<CreationDraft>): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>(`.creation?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.creation
}

export async function setCreationStatus(id: string, status: CreationStatus): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>(`.creation.status?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  return data.creation
}

export async function deleteCreation(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`.creation?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Permanently delete a creation (hard delete, bypasses soft-delete). */
export async function purgeCreation(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`.creation.purge?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Set or clear a creation's cover asset. Pass `null` to clear. */
export async function setCreationCover(id: string, assetId: string | null): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>(`.creation.cover?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ assetId }),
  })
  return data.creation
}

/** Batch archive/restore/delete/status-change creations. Returns processed ids. */
export async function batchCreations(ids: string[], action: 'archive' | 'restore' | 'delete' | 'status', status?: CreationStatus): Promise<{ done: string[]; total: number }> {
  const data = await apiFetch<{ done: string[]; total: number }>('.creations.batch', {
    method: 'POST',
    body: JSON.stringify({ ids, action, ...(status ? { status } : {}) }),
  })
  return data
}

// ---- Image-gen config ----

export async function getImageGenSummary(): Promise<ImageGenSummary> {
  const data = await apiFetch<{ summary: ImageGenSummary }>('.imagegen')
  return data.summary
}

export async function saveImageGenConfig(config: {
  llm?: { baseUrl: string; apiKey: string; model: string }
  comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
}): Promise<ImageGenSummary> {
  const data = await apiFetch<{ summary: ImageGenSummary }>('.imagegen', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
  return data.summary
}

// ---- Image generation ----

export async function generateImages(input: {
  provider?: 'llm' | 'comfyui'
  backendId?: string
  request: {
    prompt: string
    negativePrompt?: string
    count?: number
    size?: number
    seed?: number
    steps?: number
    cfg?: number
    /** Model override (backend group). */
    model?: string
    /** Reference image for repainting (data URL), ComfyUI only. */
    image?: string
    /** Multiple reference images (data URLs). ComfyUI uses the first as base. */
    images?: string[]
    /** Repaint strength 0–1 when image is present. */
    denoise?: number
  }
  sourceCreationId?: string
}): Promise<GeneratedImageResult[]> {
  const data = await apiFetch<{ images: GeneratedImageResult[] }>('.imagegen.generate', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.images
}

// ---- Multi-backend management (CRUD) ----

export async function listBackends(): Promise<Backend[]> {
  const data = await apiFetch<{ backends: Backend[] }>('.backends')
  return data.backends
}

export async function createBackend(input: {
  name: string
  kind: BackendKind
  llm?: { baseUrl: string; apiKey: string; model: string; models?: string[] }
  text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
  comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
}): Promise<Backend> {
  const data = await apiFetch<{ backend: Backend }>('.backend', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.backend
}

export async function updateBackend(
  id: string,
  patch: {
    name?: string
    llm?: { baseUrl: string; apiKey: string; model: string; models?: string[] }
    text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
    comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
  },
): Promise<Backend> {
  const data = await apiFetch<{ backend: Backend }>(`.backend?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.backend
}

export async function deleteBackend(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`.backend?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export interface BackendTestResult {
  ok: boolean
  kind: string
  message: string
  latencyMs?: number
}

/** Test whether a backend (comfyui / llm-image / llm-text) is reachable. */
export async function testBackend(input: {
  kind: 'comfyui' | 'llm-image' | 'llm-text'
  llm?: { baseUrl: string; apiKey: string; model: string }
  comfyui?: { server: string }
  text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string }
}): Promise<BackendTestResult> {
  const data = await apiFetch<BackendTestResult>('.backend.test', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data
}

export interface FetchModelsResult {
  ok: boolean
  models: string[]
  message?: string
}

/** Fetch the list of models a backend supports (Harness provider or OpenAI-compatible /models). */
export async function fetchBackendModels(input: {
  kind: 'llm-text' | 'llm-image'
  provider?: string
  baseUrl?: string
  apiKey?: string
  backendId?: string
}): Promise<FetchModelsResult> {
  const data = await apiFetch<FetchModelsResult>('.models.fetch', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data
}

// ---- Text generation (streaming) ----

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

/**
 * Streams a text generation from the Host's Harness `llm` service over SSE.
 * Calls `onEvent` for each delta / usage / finish / error frame, then resolves
 * with the assembled full text. Throws a `HostError` on transport failure.
 */
export async function generateTextStream(
  input: {
    provider?: string
    model: string
    studio: TextStudio
    topic: string
    style?: string
    requirement?: string
    baseUrl?: string
    apiKey?: string
    backendId?: string
  },
  onEvent: (event: TextGenProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${BASE}.textgen.generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw new HostError('已取消生成', 0)
    throw new HostError(`无法连接到本地服务: ${cause instanceof Error ? cause.message : String(cause)}`, 0)
  }
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `生成失败 (HTTP ${response.status})`, response.status)
  }

  let text = ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (rawEvent: string, data: string) => {
    if (rawEvent === 'delta') {
      text += data
      onEvent({ delta: data })
    } else if (rawEvent === 'usage') {
      try {
        onEvent({ usage: JSON.parse(data) as TextGenProgress['usage'] })
      } catch {
        // ignore malformed usage frame
      }
    } else if (rawEvent === 'finish') {
      try {
        onEvent({ finishReason: (JSON.parse(data) as { reason?: string }).reason })
      } catch {
        // ignore malformed finish frame
      }
    } else if (rawEvent === 'error') {
      try {
        const parsed = JSON.parse(data) as { message?: string }
        onEvent({ error: parsed.message ?? '生成失败' })
      } catch {
        onEvent({ error: data || '生成失败' })
      }
    }
  }

  // Minimal SSE parser: frames are separated by a blank line, each frame may
  // carry multiple `event:` / `data:` lines.
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let rawEvent = 'message'
      let dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) rawEvent = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      dispatch(rawEvent, dataLines.join('\n'))
      boundary = buffer.indexOf('\n\n')
    }
  }

  return text
}

// ---- Text-gen config ----

export interface TextGenConfig {
  provider: string
  model: string
}

export interface TextGenProviders {
  providers: string[]
  models: Record<string, string[]>
}

export async function getTextGenConfig(): Promise<TextGenConfig> {
  const data = await apiFetch<{ config: TextGenConfig }>('.textgen.config')
  return data.config
}

export async function saveTextGenConfig(config: TextGenConfig): Promise<TextGenConfig> {
  const data = await apiFetch<{ config: TextGenConfig }>('.textgen.config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
  return data.config
}

export async function listTextGenProviders(): Promise<TextGenProviders> {
  const data = await apiFetch<TextGenProviders>('.textgen.providers')
  return data
}

// ---- Templates ----

export async function listTemplates(category?: string): Promise<TemplateRecord[]> {
  const path = category ? `.templates?category=${encodeURIComponent(category)}` : '.templates'
  const data = await apiFetch<{ templates: TemplateRecord[] }>(path)
  return data.templates
}

export async function createTemplate(input: { category: string; name: string; description?: string; promptTemplate: string; fields?: unknown[] }): Promise<TemplateRecord> {
  const data = await apiFetch<{ template: TemplateRecord }>('.templates', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.template
}

export interface TemplateExportPayload {
  kind: string
  version: number
  exportedAt: string
  templates: Array<{ category: string; name: string; description: string; promptTemplate: string; fields: unknown[] }>
}

/** Export templates (all, or a subset by ids) as a shareable JSON object. */
export async function exportTemplates(ids?: string[]): Promise<TemplateExportPayload> {
  const query = ids?.length ? `?ids=${encodeURIComponent(ids.join(','))}` : ''
  const data = await apiFetch<TemplateExportPayload>(`.templates.export${query}`)
  return data
}

/** Import templates from a parsed export payload. Returns the imported count. */
export async function importTemplates(templates: TemplateExportPayload['templates']): Promise<number> {
  const data = await apiFetch<{ imported: number }>('.templates.import', {
    method: 'POST',
    body: JSON.stringify({ templates }),
  })
  return data.imported
}

// ---- Inspirations ----

export async function listInspirations(category?: string): Promise<InspirationRecord[]> {
  const path = category ? `.inspirations?category=${encodeURIComponent(category)}` : '.inspirations'
  const data = await apiFetch<{ inspirations: InspirationRecord[] }>(path)
  return data.inspirations
}

export async function createInspiration(input: { title: string; description?: string; promptTemplate?: string; category?: string; tags?: string[] }): Promise<InspirationRecord> {
  const data = await apiFetch<{ inspiration: InspirationRecord }>('.inspirations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.inspiration
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

/** 拉取 aihot.news 的热门 AI 资讯，作为灵感来源。 */
export async function fetchAihot(input?: { mode?: 'selected' | 'all'; category?: string; window?: string; limit?: number }): Promise<AihotItem[]> {
  const params = new URLSearchParams()
  if (input?.mode) params.set('mode', input.mode)
  if (input?.category) params.set('category', input.category)
  if (input?.window) params.set('window', input.window)
  if (input?.limit) params.set('limit', String(input.limit))
  const query = params.toString()
  const data = await apiFetch<{ items: AihotItem[] }>(`.inspiration.aihot${query ? `?${query}` : ''}`)
  return data.items
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

/** 调用文本模型把素材拆成多页图文分镜。 */
export async function generateStoryboard(input: {
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
}): Promise<StoryboardResult> {
  const data = await apiFetch<{ storyboard: StoryboardResult }>('.storyboard', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.storyboard
}

/** Ask the Host's text model for content-topic suggestions and save them to the pool. */
export async function suggestInspirations(input: { topics?: string[]; count?: number }): Promise<InspirationRecord[]> {
  const data = await apiFetch<{ inspirations: InspirationRecord[] }>('.inspiration.suggest', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.inspirations
}

// ---- Publish queue ----

export async function listPublishItems(status?: PublishStatus): Promise<PublishItem[]> {
  const path = status ? `.publish?status=${encodeURIComponent(status)}` : '.publish'
  const data = await apiFetch<{ items: PublishItem[] }>(path)
  return data.items
}

export async function createPublishItem(input: { creationId: string; platform: PublishPlatform }): Promise<PublishItem> {
  const data = await apiFetch<{ item: PublishItem }>('.publish', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.item
}

export async function setPublishStatus(id: string, status: PublishStatus, externalUrl?: string): Promise<PublishItem> {
  const data = await apiFetch<{ item: PublishItem }>(`.publish.status?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(externalUrl !== undefined ? { externalUrl } : {}) }),
  })
  return data.item
}

// ---- Export ----

export async function exportCreation(creationId: string, format: 'markdown' | 'html' | 'zip'): Promise<Blob> {
  const response = await fetch(`${BASE}.export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creationId, format }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `导出失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}

/** Export copy-paste-ready plain text adapted to a target platform. */
export async function exportForPlatform(creationId: string, platform: PublishPlatform): Promise<Blob> {
  const response = await fetch(`${BASE}.export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creationId, format: 'text', platform }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `导出失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}

/** Same as exportForPlatform but returns the adapted text as a string (for clipboard). */
export async function exportPlatformText(creationId: string, platform: PublishPlatform): Promise<string> {
  const blob = await exportForPlatform(creationId, platform)
  return blob.text()
}

/** Export generated graphic storyboard page images as a single ZIP bundle. */
export async function exportGraphicZip(input: { assetIds: string[]; title?: string }): Promise<Blob> {
  const response = await fetch(`${BASE}.graphic.export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `导出失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}

// ---- Assets ----

export async function listAssets(input?: { kind?: 'image' | 'file' | 'prompt' | 'document'; creationId?: string; tags?: string[] }): Promise<AssetRecord[]> {
  const params = new URLSearchParams()
  if (input?.kind) params.set('kind', input.kind)
  if (input?.creationId) params.set('creationId', input.creationId)
  if (input?.tags?.length) params.set('tags', input.tags.join(','))
  const query = params.toString()
  const data = await apiFetch<{ assets: AssetRecord[] }>(`.assets${query ? `?${query}` : ''}`)
  return data.assets
}

export async function uploadAsset(file: File, creationId?: string): Promise<AssetRecord> {
  const query = creationId ? `?creationId=${encodeURIComponent(creationId)}` : ''
  const response = await fetch(`${BASE}.asset.upload${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': file.name,
    },
    body: file,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `上传失败 (HTTP ${response.status})`, response.status)
  }
  const data = await response.json() as { asset: AssetRecord }
  return data.asset
}

/** Build an <img> source URL for an asset id (same-origin binary route). */
export function assetUrl(id: string): string {
  return `${BASE}.asset?id=${encodeURIComponent(id)}`
}

/** Soft-delete an asset by id. */
export async function deleteAsset(id: string): Promise<void> {
  await apiFetch(`.asset.delete?id=${encodeURIComponent(id)}`, { method: 'POST' })
}

/** Batch soft-delete assets. Returns processed count. */
export async function batchDeleteAssets(ids: string[]): Promise<{ done: number; total: number }> {
  const data = await apiFetch<{ done: number; total: number }>('.assets.batchdelete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
  return data
}

/** Replace an asset's tag list. */
export async function setAssetTags(id: string, tags: string[]): Promise<void> {
  await apiFetch<{ ok: boolean }>(`.asset.tags?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ tags }),
  })
}

// ---- Backups ----

export interface BackupRecord {
  filename: string
  sizeBytes: number
  createdAt: string
}

export async function createBackup(): Promise<BackupRecord> {
  const data = await apiFetch<{ backup: BackupRecord }>('.backup', { method: 'POST' })
  return data.backup
}

export async function listBackups(): Promise<BackupRecord[]> {
  const data = await apiFetch<{ backups: BackupRecord[] }>('.backups')
  return data.backups
}

/** Download a backup snapshot by filename. Returns the raw bytes. */
export async function downloadBackup(filename: string): Promise<Blob> {
  const response = await fetch(`${BASE}.backup.download?filename=${encodeURIComponent(filename)}`)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `下载失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}

// ---- Generation tasks (request params + result logs) ----

export type TaskKind = 'text' | 'image'
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

export async function listTasks(input?: { kind?: TaskKind; status?: TaskStatus }): Promise<TaskRecord[]> {
  const params = new URLSearchParams()
  if (input?.kind) params.set('kind', input.kind)
  if (input?.status) params.set('status', input.status)
  const query = params.toString()
  const data = await apiFetch<{ tasks: TaskRecord[] }>(`.tasks${query ? `?${query}` : ''}`)
  return data.tasks
}

export async function getTask(id: string): Promise<TaskRecord> {
  const data = await apiFetch<{ task: TaskRecord }>(`.task?id=${encodeURIComponent(id)}`)
  return data.task
}
