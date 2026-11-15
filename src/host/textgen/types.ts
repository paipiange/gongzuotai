import type { Context } from '@deepseek-ai/cordis'

/**
 * Minimal typed surface for the Harness `llm` service, scoped to what the
 * paipiange plugin needs as a *consumer*: resolving a provider/model and
 * streaming a text completion back as incremental deltas.
 *
 * The full service also supports `registerAdapter` (for mounting new model
 * providers) — that is out of scope here; this plugin only consumes whatever
 * adapter the user has already configured in Harness.
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

export interface GenerateOptions {
  /** Registered provider route (e.g. `deepseek-official`), selects the adapter. */
  provider: string
  /** Provider-specific model id (e.g. `deepseek-chat`). */
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
  prepareCall: (config: GenerateOptions, signal?: AbortSignal, configure?: unknown) => PreparedCall
  /** Lists the configured provider routes/models the user can pick from. */
  listRoutes?: () => unknown
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
