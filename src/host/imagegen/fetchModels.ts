/**
 * Model-list discovery for backend configuration. Lets the settings form offer
 * a "fetch supported models" button so the user can pick a model instead of
 * typing it by hand.
 *
 * Two modes:
 * - Harness mode (text backend with a `provider` and no `baseUrl`): reuse the
 *   host `llm` service's `listModels`.
 * - Direct mode (any backend with a `baseUrl`): call the OpenAI-compatible
 *   `GET {baseUrl}/models` endpoint and return the model ids.
 */

import type { LlmService } from '../textgen/types'

export interface FetchModelsInput {
  kind: 'llm-text' | 'llm-image'
  /** Harness provider route (used only when `baseUrl` is empty). */
  provider?: string
  /** OpenAI-compatible base URL; when set, the `/models` endpoint is queried. */
  baseUrl?: string
  /** API key for direct mode. */
  apiKey?: string
}

export interface FetchModelsResult {
  ok: boolean
  models: string[]
  message?: string
}

/** Query an OpenAI-compatible `/models` endpoint. */
async function fetchOpenAiModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const response = await fetch(`${base}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    throw new Error(`模型列表接口返回 HTTP ${response.status}`)
  }
  const json = (await response.json().catch(() => null)) as { data?: Array<{ id?: string }> } | null
  const ids = (json?.data ?? [])
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  return ids
}

export default async function fetchBackendModels(
  input: FetchModelsInput,
  llmService?: LlmService,
): Promise<FetchModelsResult> {
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, '')
  const provider = input.provider?.trim()

  // Direct mode: query the third-party endpoint's /models.
  if (baseUrl) {
    try {
      const models = await fetchOpenAiModels(baseUrl, input.apiKey?.trim() || undefined)
      if (!models.length) return { ok: false, models: [], message: '接口未返回任何模型' }
      return { ok: true, models }
    } catch (cause) {
      return { ok: false, models: [], message: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  // Harness mode: reuse the llm service's listModels.
  if (!provider) {
    return { ok: false, models: [], message: '请先填写 Provider（或第三方 Base URL）' }
  }
  if (!llmService) {
    return { ok: false, models: [], message: 'Harness llm 服务不可用，无法拉取模型列表' }
  }
  if (typeof llmService.listModels !== 'function') {
    return { ok: false, models: [], message: '当前 Provider 不支持列出模型' }
  }
  try {
    const models = (await llmService.listModels(provider)).map((m) => m.id)
    if (!models.length) return { ok: false, models: [], message: `Provider「${provider}」未返回模型列表` }
    return { ok: true, models }
  } catch (cause) {
    return { ok: false, models: [], message: cause instanceof Error ? cause.message : String(cause) }
  }
}
