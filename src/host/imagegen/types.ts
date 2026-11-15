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
  /**
   * Reference image for editing/repainting (img2img). Encoded as a data URL
   * (`data:image/png;base64,...`). Only the ComfyUI backend (Qwen-Image-Edit)
   * consumes it today; LLM providers ignore it.
   */
  image?: string
  /**
   * Repaint strength (0–1) applied when `image` is present. Higher = more
   * deviation from the reference. Default 0.7 when an image is supplied.
   */
  denoise?: number
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
  /**
   * Legacy single-file checkpoint (SD1.5/SDXL). When set, uses the classic
   * CheckpointLoaderSimple workflow. Mutually exclusive with the split-model
   * fields below.
   */
  checkpoint?: string
  /** Split-model: diffusion UNet (e.g. Qwen-Image-Edit). */
  unet?: string
  /** Split-model: text encoder / CLIP (must match the UNet's hidden dim). */
  clip?: string
  /** Split-model: VAE. */
  vae?: string
}
