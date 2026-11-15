/**
 * Client-side image-gen settings store. Prefers the Host's secure
 * SettingsRepository (API key lives only in Host SQLite, never in the browser
 * bundle); falls back to localStorage when the Host is unavailable.
 */

import {
  getImageGenSummary,
  saveImageGenConfig,
  type ImageGenSummary,
} from './hostClient'

export interface LlmImageConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ComfyUiConfig {
  server: string
  checkpoint?: string
  unet?: string
  clip?: string
  vae?: string
}

export interface ImageGenSettings {
  llm?: LlmImageConfig
  comfyui?: ComfyUiConfig
}

const STORAGE_KEY = 'paipiange.imagegen.v1'

function loadLocal(): ImageGenSettings {
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

function saveLocal(settings: ImageGenSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

export type SettingsSource = 'host' | 'local'

export interface SettingsLoadResult {
  settings: ImageGenSettings
  summary: ImageGenSummary
  source: SettingsSource
}

/**
 * Load image-gen settings. When the Host is reachable, the returned `settings`
 * contains only non-secret fields (apiKey is blanked); the summary reflects
 * which backends are configured. When local, the full (locally stored) config
 * is returned.
 */
export async function loadSettings(): Promise<SettingsLoadResult> {
  try {
    const summary = await getImageGenSummary()
    return {
      summary,
      source: 'host',
      settings: {
        ...(summary.llm ? { llm: { baseUrl: summary.llm.baseUrl, model: summary.llm.model, apiKey: '' } } : {}),
        ...(summary.comfyui ? { comfyui: { ...summary.comfyui } } : {}),
      },
    }
  } catch {
    return { summary: {}, source: 'local', settings: loadLocal() }
  }
}

/** Persist settings to Host (preferred) or localStorage (fallback). */
export async function persistSettings(settings: ImageGenSettings): Promise<{ source: SettingsSource; summary: ImageGenSummary }> {
  try {
    const summary = await saveImageGenConfig({
      ...(settings.llm ? { llm: settings.llm } : {}),
      ...(settings.comfyui ? { comfyui: settings.comfyui } : {}),
    })
    return { source: 'host', summary }
  } catch {
    saveLocal(settings)
    return { source: 'local', summary: {} }
  }
}
