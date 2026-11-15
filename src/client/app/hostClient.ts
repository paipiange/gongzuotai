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
