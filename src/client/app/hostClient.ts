/**
 * Client-side bridge to the Host half's REST API. The Host exposes exact fetch
 * routes under `/api/paipiange.*`; the browser page is same-origin with the
 * Host (loopback in desktop), so a relative `fetch()` reaches them directly.
 *
 * Every call is defensive: on network failure or a non-2xx response it throws
 * a typed `HostError` so callers can decide whether to fall back to local
 * storage or surface a clear message — never fabricate a success.
 */

export type StudioId = 'article' | 'image' | 'headline' | 'marketing' | 'xiaohongshu'

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
}

export interface ImageGenSummary {
  llm?: { baseUrl: string; model: string }
  comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
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

export async function listCreations(): Promise<CreationRecord[]> {
  const data = await apiFetch<{ creations: CreationRecord[] }>('.creations')
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
  provider: 'llm' | 'comfyui'
  request: {
    prompt: string
    negativePrompt?: string
    count?: number
    size?: number
    seed?: number
    steps?: number
    cfg?: number
  }
  sourceCreationId?: string
}): Promise<GeneratedImageResult[]> {
  const data = await apiFetch<{ images: GeneratedImageResult[] }>('.imagegen.generate', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.images
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
    provider: string
    model: string
    studio: TextStudio
    topic: string
    style?: string
    requirement?: string
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

// ---- Assets ----

export async function listAssets(input?: { kind?: 'image' | 'file' | 'prompt' | 'document'; creationId?: string }): Promise<AssetRecord[]> {
  const params = new URLSearchParams()
  if (input?.kind) params.set('kind', input.kind)
  if (input?.creationId) params.set('creationId', input.creationId)
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
