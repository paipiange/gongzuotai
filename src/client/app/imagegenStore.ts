/**
 * Client-side image-gen settings store. Mirrors the Host-side
 * SettingsRepository field names so a later switch to Host persistence is a
 * drop-in. For now it stores in localStorage (same transitional approach as
 * workspace drafts); the API key is kept out of the repo and out of git.
 */

export interface LlmImageConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ComfyUiConfig {
  server: string
  checkpoint?: string
}

export interface ImageGenSettings {
  llm?: LlmImageConfig
  comfyui?: ComfyUiConfig
}

const STORAGE_KEY = 'paipiange.imagegen.v1'

export function loadImageGenSettings(): ImageGenSettings {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<ImageGenSettings>
    return {
      ...(parsed.llm ? { llm: parsed.llm } : {}),
      ...(parsed.comfyui ? { comfyui: parsed.comfyui } : {}),
    }
  } catch {
    return {}
  }
}

export function saveImageGenSettings(settings: ImageGenSettings): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}
