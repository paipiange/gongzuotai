import type Database from 'better-sqlite3'
import type { ComfyUiConfig, LlmImageConfig } from '../imagegen/types'

const IMAGE_LLM_KEY = 'imagegen.llm'
const IMAGE_COMFYUI_KEY = 'imagegen.comfyui'

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
    return { server: value.server, checkpoint: value.checkpoint }
  }

  setComfyUiConfig(config: ComfyUiConfig): void {
    writeJson(this.db, IMAGE_COMFYUI_KEY, config)
  }

  clearComfyUiConfig(): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(IMAGE_COMFYUI_KEY)
  }

  /** Non-secret summary for the client to know what backends are configured. */
  getImageGenSummary(): { llm?: { baseUrl: string; model: string }; comfyui?: { server: string; checkpoint?: string } } {
    const llm = this.getLlmImageConfig()
    const comfyui = this.getComfyUiConfig()
    return {
      ...(llm ? { llm: { baseUrl: llm.baseUrl, model: llm.model } } : {}),
      ...(comfyui ? { comfyui: { server: comfyui.server, checkpoint: comfyui.checkpoint } } : {}),
    }
  }
}
