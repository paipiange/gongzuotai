import { ComfyUIProvider } from './ComfyUIProvider'
import { OpenAICompatImageProvider } from './OpenAICompatImageProvider'
import type { ComfyUiConfig, GeneratedImage, ImageGenProvider, ImageGenRequest, LlmImageConfig } from './types'

export interface ImageGenServiceConfig {
  /** LLM backend, when configured. */
  llm?: LlmImageConfig
  /** Local ComfyUI backend, when configured. */
  comfyui?: ComfyUiConfig
}

export type ProviderId = 'llm' | 'comfyui'

/**
 * Facade that owns the configured providers and dispatches image generation
 * to the requested backend. Pure Node logic; the Host wiring decides how the
 * config is loaded (from app_settings) and how results are persisted.
 */
export class ImageGenService {
  private readonly providers = new Map<ProviderId, ImageGenProvider>()

  constructor(config: ImageGenServiceConfig = {}) {
    if (config.llm) {
      this.providers.set('llm', new OpenAICompatImageProvider(config.llm))
    }
    if (config.comfyui) {
      this.providers.set('comfyui', new ComfyUIProvider(config.comfyui))
    }
  }

  available(): ProviderId[] {
    return [...this.providers.keys()]
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
}
