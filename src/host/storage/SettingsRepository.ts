import type Database from 'better-sqlite3'
import type { Backend, ComfyUiConfig, LlmImageConfig } from '../imagegen/types'

const IMAGE_LLM_KEY = 'imagegen.llm'
const IMAGE_COMFYUI_KEY = 'imagegen.comfyui'
const TEXTGEN_KEY = 'textgen'

export interface TextGenConfig {
  provider: string
  model: string
}

interface SettingsRow {
  key: string
  value_json: string
}

function readJson(db: Database.Database, key: string): unknown {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as SettingsRow | undefined
  if (!row) return undefined
  try {
    return JSON.parse(row.value_json)
  } catch {
    return undefined
  }
}

function writeJson(db: Database.Database, key: string, value: unknown): void {
  const json = JSON.stringify(value)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(key, json, now)
}

/**
 * Stores image-gen backend configuration in the private `app_settings` table.
 * The API key lives only in the Host-side SQLite store, never in the client
 * bundle.
 */
export class SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  getLlmImageConfig(): LlmImageConfig | null {
    const value = readJson(this.db, IMAGE_LLM_KEY) as Partial<LlmImageConfig> | undefined
    if (!value || !value.baseUrl || !value.apiKey || !value.model) return null
    return { baseUrl: value.baseUrl, apiKey: value.apiKey, model: value.model }
  }

  setLlmImageConfig(config: LlmImageConfig): void {
    writeJson(this.db, IMAGE_LLM_KEY, config)
  }

  clearLlmImageConfig(): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(IMAGE_LLM_KEY)
  }

  getComfyUiConfig(): ComfyUiConfig | null {
    const value = readJson(this.db, IMAGE_COMFYUI_KEY) as Partial<ComfyUiConfig> | undefined
    if (!value || !value.server) return null
    return {
      server: value.server,
      checkpoint: value.checkpoint,
      unet: value.unet,
      clip: value.clip,
      vae: value.vae,
    }
  }

  setComfyUiConfig(config: ComfyUiConfig): void {
    writeJson(this.db, IMAGE_COMFYUI_KEY, config)
  }

  clearComfyUiConfig(): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(IMAGE_COMFYUI_KEY)
  }

  /** Text-gen route/model defaults; falls back to the DeepSeek official adapter. */
  getTextGenConfig(): TextGenConfig {
    const value = readJson(this.db, TEXTGEN_KEY) as Partial<TextGenConfig> | undefined
    return {
      provider: value?.provider?.trim() || 'deepseek-official',
      model: value?.model?.trim() || 'deepseek-chat',
    }
  }

  setTextGenConfig(config: TextGenConfig): void {
    writeJson(this.db, TEXTGEN_KEY, config)
  }

  /** Non-secret summary for the client to know what backends are configured. */
  getImageGenSummary(): { llm?: { baseUrl: string; model: string }; comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string } } {
    const llm = this.getLlmImageConfig()
    const comfyui = this.getComfyUiConfig()
    return {
      ...(llm ? { llm: { baseUrl: llm.baseUrl, model: llm.model } } : {}),
      ...(comfyui ? { comfyui: { server: comfyui.server, checkpoint: comfyui.checkpoint, unet: comfyui.unet, clip: comfyui.clip, vae: comfyui.vae } } : {}),
    }
  }

  // ---- Multi-backend management (text + image backends in one list) ----

  private readonly BACKENDS_KEY = 'backends'

  /** List all user-managed backends (non-secret projection; apiKey blanked). */
  listBackends(): Backend[] {
    const value = readJson(this.db, this.BACKENDS_KEY) as Backend[] | undefined
    if (!Array.isArray(value)) return []
    return value.map((b) => this.redactBackend(b))
  }

  /**
   * List all backends *including* secret apiKey values. Only the Host process
   * (buildImageGen) should call this; never expose it over the API.
   */
  listBackendsWithSecrets(): Backend[] {
    const value = readJson(this.db, this.BACKENDS_KEY) as Backend[] | undefined
    return Array.isArray(value) ? value : []
  }

  /** Get a single backend by id (non-secret projection; apiKey blanked). */
  getBackend(id: string): Backend | null {
    return this.listBackends().find((b) => b.id === id) ?? null
  }

  /** Create a new backend. Returns the stored (non-secret) record. */
  createBackend(input: Omit<Backend, 'id' | 'createdAt' | 'updatedAt'>): Backend {
    const all = this.readAllBackends()
    const now = new Date().toISOString()
    const backend: Backend = {
      ...input,
      id: this.newBackendId(),
      createdAt: now,
      updatedAt: now,
    }
    all.push(backend)
    this.writeAllBackends(all)
    return this.redactBackend(backend)
  }

  /** Update an existing backend by id. Returns the stored (non-secret) record. */
  updateBackend(id: string, patch: Partial<Omit<Backend, 'id' | 'createdAt'>>): Backend | null {
    const all = this.readAllBackends()
    const idx = all.findIndex((b) => b.id === id)
    if (idx < 0) return null
    const now = new Date().toISOString()
    const merged: Backend = {
      ...all[idx],
      ...patch,
      id: all[idx].id,
      createdAt: all[idx].createdAt,
      updatedAt: now,
    }
    all[idx] = merged
    this.writeAllBackends(all)
    return this.redactBackend(merged)
  }

  /** Remove a backend by id. Returns true if a record was removed. */
  removeBackend(id: string): boolean {
    const all = this.readAllBackends()
    const next = all.filter((b) => b.id !== id)
    if (next.length === all.length) return false
    this.writeAllBackends(next)
    return true
  }

  /** Internal: read the full (secret-bearing) backend list. */
  private readAllBackends(): Backend[] {
    const value = readJson(this.db, this.BACKENDS_KEY) as Backend[] | undefined
    return Array.isArray(value) ? value : []
  }

  private writeAllBackends(all: Backend[]): void {
    writeJson(this.db, this.BACKENDS_KEY, all)
  }

  private redactBackend(b: Backend): Backend {
    return { ...b, llm: b.llm ? { baseUrl: b.llm.baseUrl, model: b.llm.model, apiKey: '' } : undefined }
  }

  private newBackendId(): string {
    const all = this.readAllBackends()
    const existing = new Set(all.map((b) => b.id))
    let n = 1
    while (existing.has(`backend-${n}`)) n += 1
    return `backend-${n}`
  }
}
