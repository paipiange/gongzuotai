import type Database from 'better-sqlite3'
import type { Backend, ComfyUiConfig, LlmImageConfig } from '../imagegen/types'
import type { WechatChannelConfig } from '../publish/WechatPublishService'

const IMAGE_LLM_KEY = 'imagegen.llm'
const IMAGE_COMFYUI_KEY = 'imagegen.comfyui'
const TEXTGEN_KEY = 'textgen'
const WECHAT_CHANNEL_KEY = 'channel.wechat'
const BACKUP_POLICY_KEY = 'backup.policy'
const HOME_CAROUSEL_KEY = 'home.carousel'

export interface BackupPolicy {
  enabled: boolean
  intervalDays: number
  retention: number
  lastRunAt: string | null
}

export interface TextGenConfig {
  provider: string
  model: string
}

/** 首页轮播图配置：一组素材库图片 asset id，可勾选是否把内置默认图也纳入轮播。 */
export interface HomeCarouselConfig {
  assetIds: string[]
  /** 单张停留时长（毫秒）。 */
  intervalMs: number
  /** 是否把内置默认图作为轮播第一张（默认 true）。 */
  includeDefault: boolean
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

  /** Full secret-bearing config. Host-only: never return this object to the client. */
  getWechatChannelConfig(): WechatChannelConfig | null {
    const value = readJson(this.db, WECHAT_CHANNEL_KEY) as Partial<WechatChannelConfig> | undefined
    if (!value?.appId?.trim() || !value.appSecret?.trim()) return null
    return {
      appId: value.appId.trim(),
      appSecret: value.appSecret.trim(),
      defaultAuthor: value.defaultAuthor?.trim() || '',
    }
  }

  setWechatChannelConfig(config: WechatChannelConfig): void {
    writeJson(this.db, WECHAT_CHANNEL_KEY, {
      appId: config.appId.trim(),
      appSecret: config.appSecret.trim(),
      defaultAuthor: config.defaultAuthor?.trim() || '',
    })
  }

  clearWechatChannelConfig(): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(WECHAT_CHANNEL_KEY)
  }

  /** Safe projection for settings UI; AppSecret is never exposed. */
  getWechatChannelSummary(): { configured: boolean; appId: string; defaultAuthor: string; hasAppSecret: boolean } {
    const config = this.getWechatChannelConfig()
    return {
      configured: Boolean(config),
      appId: config?.appId ?? '',
      defaultAuthor: config?.defaultAuthor ?? '',
      hasAppSecret: Boolean(config?.appSecret),
    }
  }

  getBackupPolicy(): BackupPolicy {
    const value = readJson(this.db, BACKUP_POLICY_KEY) as Partial<BackupPolicy> | undefined
    return {
      enabled: value?.enabled !== false,
      intervalDays: Math.min(30, Math.max(1, Math.round(Number(value?.intervalDays) || 7))),
      retention: Math.min(20, Math.max(1, Math.round(Number(value?.retention) || 5))),
      lastRunAt: typeof value?.lastRunAt === 'string' ? value.lastRunAt : null,
    }
  }

  setBackupPolicy(input: Partial<BackupPolicy>): BackupPolicy {
    const current = this.getBackupPolicy()
    const intervalInput = Number(input.intervalDays ?? current.intervalDays)
    const retentionInput = Number(input.retention ?? current.retention)
    const next: BackupPolicy = {
      enabled: input.enabled ?? current.enabled,
      intervalDays: Math.min(30, Math.max(1, Math.round(Number.isFinite(intervalInput) ? intervalInput : 7))),
      retention: Math.min(20, Math.max(1, Math.round(Number.isFinite(retentionInput) ? retentionInput : 5))),
      lastRunAt: input.lastRunAt === undefined ? current.lastRunAt : input.lastRunAt,
    }
    writeJson(this.db, BACKUP_POLICY_KEY, next)
    return next
  }

  /** 首页轮播图配置；未配置时返回空数组，客户端据此回退默认图。 */
  getHomeCarousel(): HomeCarouselConfig {
    const value = readJson(this.db, HOME_CAROUSEL_KEY) as Partial<HomeCarouselConfig> | undefined
    const assetIds = Array.isArray(value?.assetIds)
      ? value.assetIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []
    const interval = Math.round(Number(value?.intervalMs) || 0)
    return {
      assetIds,
      intervalMs: interval > 0 ? Math.min(30000, Math.max(2000, interval)) : 5000,
      includeDefault: value?.includeDefault !== false,
    }
  }

  setHomeCarousel(input: Partial<HomeCarouselConfig>): HomeCarouselConfig {
    const current = this.getHomeCarousel()
    const next: HomeCarouselConfig = {
      assetIds: Array.isArray(input.assetIds)
        ? input.assetIds.filter((item): item is string => typeof item === 'string' && item.length > 0)
        : current.assetIds,
      intervalMs: current.intervalMs,
      includeDefault: input.includeDefault ?? current.includeDefault,
    }
    if (input.intervalMs !== undefined) {
      const iv = Math.round(Number(input.intervalMs) || 0)
      next.intervalMs = iv > 0 ? Math.min(30000, Math.max(2000, iv)) : 5000
    }
    writeJson(this.db, HOME_CAROUSEL_KEY, next)
    return next
  }

  clearHomeCarousel(): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(HOME_CAROUSEL_KEY)
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
    return {
      ...b,
      llm: b.llm ? { baseUrl: b.llm.baseUrl, model: b.llm.model, apiKey: '', ...(b.llm.models ? { models: b.llm.models } : {}) } : undefined,
      text: b.text ? { ...b.text, apiKey: '' } : undefined,
    }
  }

  private newBackendId(): string {
    const all = this.readAllBackends()
    const existing = new Set(all.map((b) => b.id))
    let n = 1
    while (existing.has(`backend-${n}`)) n += 1
    return `backend-${n}`
  }
}
