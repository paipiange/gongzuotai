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
  /** Explicit output width in pixels (overrides `size` for non-square output). */
  width?: number
  /** Explicit output height in pixels (overrides `size` for non-square output). */
  height?: number
  /** ComfyUI: seed override. LLM providers generally ignore this. */
  seed?: number
  /** ComfyUI: sampling steps. */
  steps?: number
  /** ComfyUI: classifier-free guidance scale. */
  cfg?: number
  /**
   * Model override for LLM backends. When set, uses this model instead of the
   * backend's default `model` (lets a backend expose a group of models).
   */
  model?: string
  /**
   * Reference image for editing/repainting (img2img). Encoded as a data URL
   * (`data:image/png;base64,...`). Only the ComfyUI backend (Qwen-Image-Edit)
   * consumes it today; LLM providers ignore it.
   */
  image?: string
  /**
   * Multiple reference images (img2img). Encoded as data URLs. ComfyUI's
   * Qwen-Image-Edit is a single-image editor, so the first image is used as the
   * base while the rest are ignored for now (kept for future multi-ref support).
   */
  images?: string[]
  /**
   * Repaint strength (0–1) applied when a reference image is present. Higher =
   * more deviation from the reference. Default 0.7 when an image is supplied.
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

/**
 * Recommended default split-model files for ComfyUI (Qwen-Image-Edit stack).
 * Used as the fallback when the user leaves UNet/CLIP/VAE empty, and mirrored
 * by the settings form placeholders so "blank = use the recommended model".
 */
export const COMFYUI_DEFAULT_MODELS = {
  unet: 'qwen_image_edit_2511_int8_convrot.safetensors',
  clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: 'qwen_image_vae.safetensors',
} as const

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

/**
 * A user-managed generation backend. Text and image backends are both stored
 * in the same list so the user can add/edit/remove/switch them freely.
 */
export type BackendKind = 'llm-text' | 'llm-image' | 'comfyui'

/** LLM image backend config (OpenAI-compatible images endpoint). */
export interface LlmBackendConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Optional extra models under this backend (a "group" of models). */
  models?: string[]
}

/**
 * LLM text backend config. Two modes:
 * - Harness mode: `provider` + `model` reuse the host `llm` service route.
 * - Direct mode: `baseUrl` + `apiKey` + `model` call an OpenAI-compatible
 *   `/chat/completions` endpoint directly (third-party API).
 */
export interface LlmTextBackendConfig {
  /** Harness provider route (only used when `baseUrl` is empty). */
  provider?: string
  /** OpenAI-compatible base URL; when set, enables direct third-party calls. */
  baseUrl?: string
  /** API key for direct mode (secret, host-only). */
  apiKey?: string
  model: string
  /** Optional extra models under this backend (a "group" of models). */
  models?: string[]
}

export interface Backend {
  /** Stable unique id. */
  id: string
  /** Human-readable name shown in pickers. */
  name: string
  kind: BackendKind
  /** `llm-image` backends carry baseUrl/apiKey/model. */
  llm?: LlmBackendConfig
  /** `llm-text` backends carry provider/model (reuses Harness llm service). */
  text?: LlmTextBackendConfig
  /** `comfyui` backend carries its server + model references. */
  comfyui?: ComfyUiConfig
  createdAt: string
  updatedAt: string
}
