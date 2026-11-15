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
