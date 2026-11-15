import type { Context } from '@deepseek-ai/cordis'

/**
 * Minimal typed surface for the Harness `llm` service, scoped to what the
 * paipiange plugin needs as a *consumer*: discovering configured providers and
 * streaming a text completion back as incremental deltas.
 *
 * `registerAdapter` (mounting new model providers) is out of scope — this
 * plugin only consumes whatever adapter the user has configured in Harness.
 */

export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: string }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'block-end'; index: number; block: unknown }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: string; replayState?: unknown }

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** One registered provider route, as returned by `listProviders()`. */
export interface LlmProviderInfo {
  provider: string
  [key: string]: unknown
}

/** One advertised model for a provider, as returned by `listModels()`. */
export interface LlmModelInfo {
  id: string
  [key: string]: unknown
}

export interface GenerateOptions {
  /** Registered provider route (e.g. `huatu717333`), selects the adapter. */
  provider: string
  /** Provider-specific model id (e.g. `deepseek-flash`). */
  model: string
  /** Optional system prompt text. */
  system?: string
  /** Messages in the exact order the provider sees them. */
  messages: Array<{ role: string; content: string }>
  /** Optional max output tokens. */
  maxTokens?: number
  /** Optional sampling temperature. */
  temperature?: number
  /** Optional stop sequences. */
  stop?: string[]
  /** Optional abort signal. */
  signal?: AbortSignal
}

export interface PreparedCall {
  stream: () => AsyncIterable<StreamChunk>
}

export interface LlmService {
  /** Resolve a single call (async) into an executable, cancellable call. */
  prepareCall: (config: GenerateOptions, signal?: AbortSignal, configure?: unknown) => Promise<PreparedCall>
  /** List currently registered provider routes. */
  listProviders: () => LlmProviderInfo[]
  /** List models advertised by a registered provider (async). */
  listModels?: (provider: string) => Promise<LlmModelInfo[]>
}

export type LlmContext = Context & { llm: LlmService }

/** Throw when the `llm` service is unavailable in this host. */
export class LlmUnavailableError extends Error {
  constructor() {
    super('paipiange: Harness llm 服务不可用，无法生成文本')
    this.name = 'LlmUnavailableError'
  }
}

export function resolveLlm(ctx: Context): LlmService {
  const service = (ctx as LlmContext).llm
  if (!service || typeof service.prepareCall !== 'function') {
    throw new LlmUnavailableError()
  }
  return service
}
