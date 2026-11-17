import { ComfyUIProvider } from './ComfyUIProvider'
import { OpenAICompatImageProvider } from './OpenAICompatImageProvider'
import type {
  Backend,
  ComfyUiConfig,
  GeneratedImage,
  ImageGenProvider,
  ImageGenRequest,
  LlmImageConfig,
} from './types'

export interface ImageGenServiceConfig {
  /** LLM backend, when configured (legacy single-slot). */
  llm?: LlmImageConfig
  /** Local ComfyUI backend, when configured (legacy single-slot). */
  comfyui?: ComfyUiConfig
  /** Multi-backend list (new). When present, it takes precedence. */
  backends?: Backend[]
}

export type ProviderId = 'llm' | 'comfyui'

/**
 * Facade that owns the configured providers and dispatches image generation
 * to the requested backend. Pure Node logic; the Host wiring decides how the
 * config is loaded (from app_settings) and how results are persisted.
 *
 * Supports two addressing modes:
 *  - legacy: `generate('llm' | 'comfyui', ...)` against the single slots
 *  - multi-backend: `generateByBackend(backendId, ...)` against the managed list
 */
export class ImageGenService {
  private readonly providers = new Map<ProviderId, ImageGenProvider>()
  private readonly backends = new Map<string, ImageGenProvider>()
  private readonly backendConfigs = new Map<string, Backend>()

  constructor(config: ImageGenServiceConfig = {}) {
    if (config.llm) {
      this.providers.set('llm', new OpenAICompatImageProvider(config.llm))
    }
    if (config.comfyui) {
      this.providers.set('comfyui', new ComfyUIProvider(config.comfyui))
    }
    for (const backend of config.backends ?? []) {
      this.backendConfigs.set(backend.id, backend)
      const impl = this.buildProvider(backend)
      if (impl) this.backends.set(backend.id, impl)
    }
  }

  private buildProvider(backend: Backend): ImageGenProvider | null {
    if (backend.kind === 'comfyui' && backend.comfyui) {
      return new ComfyUIProvider(backend.comfyui)
    }
    if (backend.kind === 'llm-image' && backend.llm?.baseUrl && backend.llm?.apiKey && backend.llm?.model) {
      return new OpenAICompatImageProvider({ baseUrl: backend.llm.baseUrl, apiKey: backend.llm.apiKey, model: backend.llm.model })
    }
    return null
  }

  available(): ProviderId[] {
    return [...this.providers.keys()]
  }

  /** List backend ids that are usable for image generation. */
  availableBackends(): string[] {
    return [...this.backends.keys()]
  }

  async generate(
    provider: ProviderId,
    request: ImageGenRequest,
    signal?: AbortSignal,
  ): Promise<GeneratedImage[]> {
    const impl = this.providers.get(provider)
    if (!impl) throw new Error(`生图后端未配置: ${provider}`)
    return impl.generate(request, signal)
  }

  /** Generate using a managed multi-backend entry by id. */
  async generateByBackend(
    backendId: string,
    request: ImageGenRequest,
    signal?: AbortSignal,
  ): Promise<GeneratedImage[]> {
    let impl: ImageGenProvider | null = this.backends.get(backendId) ?? null
    if (!impl) throw new Error(`生图后端未配置: ${backendId}`)
    // A model override (from the request) rebuilds the LLM provider with the
    // chosen model, letting a backend expose a group of models. ComfyUI ignores
    // the override since its model is fixed by its config — so only llm-image
    // backends go through the override path (otherwise buildProviderWithModel
    // returns null and we'd wrongly report "未配置").
    const backend = this.backendConfigs.get(backendId)
    if (backend?.kind === 'llm-image' && request.model && request.model !== backend.llm?.model) {
      impl = this.buildProviderWithModel(backendId, request.model)
    }
    if (!impl) throw new Error(`生图后端未配置: ${backendId}`)
    return impl.generate(request, signal)
  }

  /** Rebuild an llm-image provider with a different model (same baseUrl/apiKey). */
  private buildProviderWithModel(backendId: string, model: string): ImageGenProvider | null {
    const backend = this.backendConfigs.get(backendId)
    if (backend?.kind !== 'llm-image' || !backend.llm?.baseUrl || !backend.llm?.apiKey) return null
    return new OpenAICompatImageProvider({ baseUrl: backend.llm.baseUrl, apiKey: backend.llm.apiKey, model })
  }
}
