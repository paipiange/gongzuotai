/**
 * Image generation provider types. Pure domain definitions shared by the
 * Host image-gen service. No Harness dependency.
 */

export interface ImageGenRequest {
  prompt: string
  /** Optional negative prompt, supported by ComfyUI. */
  negativePrompt?: string
  /** Number of images to generate. Providers may cap this. */
  count?: number
  /** Square size in pixels (width = height). Default provider-specific. */
  size?: number
  /** ComfyUI: seed override. LLM providers generally ignore this. */
  seed?: number
  /** ComfyUI: sampling steps. */
  steps?: number
  /** ComfyUI: classifier-free guidance scale. */
  cfg?: number
}

export interface GeneratedImage {
  /** Binary image bytes. */
  data: Buffer
  /** MIME type, e.g. image/png. */
  mimeType: string
  /** Provider-specific revision/seed if known. */
  meta?: Record<string, unknown>
}

export interface ImageGenProvider {
  readonly id: string
  generate(request: ImageGenRequest, signal?: AbortSignal): Promise<GeneratedImage[]>
}

/** LLM backend config (OpenAI-compatible images endpoint). */
export interface LlmImageConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** Local ComfyUI backend config. */
export interface ComfyUiConfig {
  server: string
  /** Default checkpoint / model to use in the generated workflow. */
  checkpoint?: string
}
