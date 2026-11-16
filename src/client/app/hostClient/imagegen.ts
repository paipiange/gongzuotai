/**
 * Image-gen config, generation, and multi-backend management (CRUD + test +
 * model listing).
 */

import { apiFetch } from './client'
import type { Backend, BackendKind, BackendTestResult, FetchModelsResult, GeneratedImageResult, ImageGenSummary } from './types'

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
    /** 非方形输出宽（像素），优先于 size。 */
    width?: number
    /** 非方形输出高（像素），优先于 size。 */
    height?: number
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
  /** 公众号分镜：第几页（用于后台任务恢复时回填到对应页）。 */
  pageIndex?: number
  /** 公众号分镜：本次拆页的 run id（用于匹配进行中/已完成的生图任务）。 */
  sessionId?: string
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
