/**
 * Creation store. Prefers the Host SQLite backend; falls back to localStorage
 * when the Host half is unavailable (e.g. still loading or failed). The local
 * fallback keeps the UI usable and is transparently reconciled once the Host
 * is reachable.
 */

import type { StudioId } from './data'
import {
  createCreation as hostCreate,
  deleteCreation as hostDelete,
  listCreations as hostList,
  setCreationStatus as hostSetStatus,
  updateCreation as hostUpdate,
  type CreationRecord,
  type CreationStatus,
} from './hostClient'

export type { CreationRecord, CreationStatus }

export interface CreationDraft {
  id?: string
  studio: Exclude<StudioId, 'video'>
  title: string
  topic: string
  content: string
  style: string
  requirement: string
  status?: CreationStatus
  tags?: string[]
}

const STORAGE_KEY = 'paipiange.workspace.v1'
const EMPTY_SNAPSHOT: CreationRecord[] = []

function isCreationStatus(value: unknown): value is CreationStatus {
  return value === 'draft' || value === 'queued' || value === 'archived'
}

function isStudio(value: unknown): value is CreationRecord['studio'] {
  return value === 'article' || value === 'image' || value === 'headline' || value === 'marketing' || value === 'xiaohongshu'
}

function normalizeCreation(value: unknown): CreationRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<CreationRecord>
  if (
    typeof record.id !== 'string'
    || !isStudio(record.studio)
    || typeof record.title !== 'string'
    || typeof record.topic !== 'string'
    || typeof record.content !== 'string'
    || typeof record.style !== 'string'
    || typeof record.requirement !== 'string'
    || !isCreationStatus(record.status)
    || typeof record.createdAt !== 'string'
    || typeof record.updatedAt !== 'string'
  ) return null
  if (record.tags !== undefined && !Array.isArray(record.tags)) return null
  return { ...record, tags: Array.isArray(record.tags) ? record.tags : [] } as CreationRecord
}

function loadLocal(): CreationRecord[] {
  if (typeof window === 'undefined') return EMPTY_SNAPSHOT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_SNAPSHOT
    const parsed = JSON.parse(raw) as { version?: number; creations?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.creations)) return EMPTY_SNAPSHOT
    return parsed.creations.map(normalizeCreation).filter((item): item is CreationRecord => Boolean(item))
  } catch {
    return EMPTY_SNAPSHOT
  }
}

function saveLocal(creations: CreationRecord[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, creations }))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `pa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export type StoreSource = 'host' | 'local'

export interface LoadResult {
  creations: CreationRecord[]
  source: StoreSource
}

/** Load all creations, preferring the Host. */
export async function loadCreations(): Promise<LoadResult> {
  try {
    // Pull up to 500 records in one pass (the UI filters client-side); the
    // default backend page size of 50 would silently drop older drafts.
    const hostRecords = await hostList({ limit: 500 })
    // Reconcile any legacy local records into the Host before clearing the
    // local copy — otherwise drafts saved while offline would be silently
    // dropped once the Host comes back.
    const localRecords = loadLocal()
    if (localRecords.length) {
      await reconcileIntoHost(hostRecords, localRecords)
    }
    saveLocal([])
    return { creations: hostRecords, source: 'host' }
  } catch {
    return { creations: loadLocal(), source: 'local' }
  }
}

/**
 * Push local-only drafts into the Host when it becomes reachable, so offline
 * work is not lost. Local records whose ids already exist on the Host are
 * skipped (the Host copy is authoritative); brand-new local records are created.
 */
async function reconcileIntoHost(hostRecords: CreationRecord[], localRecords: CreationRecord[]): Promise<void> {
  const hostIds = new Set(hostRecords.map((r) => r.id))
  for (const local of localRecords) {
    if (hostIds.has(local.id)) continue
    try {
      // Local records are re-created on the Host (which assigns a fresh id);
      // the point is to preserve offline-authored content, not the local id.
      await hostCreate({
        studio: local.studio,
        title: local.title,
        topic: local.topic,
        content: local.content,
        style: local.style,
        requirement: local.requirement,
        status: local.status,
        tags: local.tags,
      })
    } catch {
      // A single failed upload must not abort the remaining reconciliation.
    }
  }
}

/** Create or update a creation. Returns the persisted record and its source. */
export async function saveCreation(draft: CreationDraft): Promise<{ record: CreationRecord; source: StoreSource }> {
  try {
    const record = draft.id ? await hostUpdate(draft.id, draft) : await hostCreate(draft)
    return { record, source: 'host' }
  } catch {
    // Local fallback: upsert in-memory and persist to localStorage.
    const record = upsertLocal(draft)
    return { record, source: 'local' }
  }
}

export async function setStatus(id: string, status: CreationStatus): Promise<{ record: CreationRecord | null; source: StoreSource }> {
  try {
    const record = await hostSetStatus(id, status)
    return { record, source: 'host' }
  } catch {
    const current = loadLocal()
    const record = current.find((item) => item.id === id) ?? null
    if (record) {
      const next = current.map((item) => (item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item))
      saveLocal(next)
      return { record: next.find((item) => item.id === id) ?? null, source: 'local' }
    }
    return { record, source: 'local' }
  }
}

export async function removeCreation(id: string): Promise<{ ok: boolean; source: StoreSource }> {
  try {
    await hostDelete(id)
    return { ok: true, source: 'host' }
  } catch {
    const next = loadLocal().filter((item) => item.id !== id)
    saveLocal(next)
    return { ok: true, source: 'local' }
  }
}

function upsertLocal(draft: CreationDraft): CreationRecord {
  const current = loadLocal()
  const now = new Date().toISOString()
  const existing = draft.id ? current.find((item) => item.id === draft.id) : undefined
  const record: CreationRecord = {
    id: existing?.id ?? draft.id ?? createId(),
    studio: draft.studio,
    title: draft.title.trim() || draft.topic.trim() || '未命名草稿',
    topic: draft.topic.trim(),
    content: draft.content,
    style: draft.style,
    requirement: draft.requirement,
    status: draft.status ?? existing?.status ?? 'draft',
    coverAssetId: existing?.coverAssetId ?? null,
    tags: draft.tags ?? existing?.tags ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  saveLocal([record, ...current.filter((item) => item.id !== record.id)])
  return record
}

// ---- Per-studio in-progress draft cache (survives page switches) ----

const STUDIO_DRAFT_PREFIX = 'paipiange.studio-draft.'

/** The subset of draft state we preserve across page switches. */
export interface StudioDraftCache {
  title: string
  topic: string
  content: string
  style: string
  requirement: string
  tags: string[]
  /** 视频专用：选中的影片风格 id（99 风格库）。 */
  videoStyleId?: string
  /** 视频专用：是否启用多幕叙事。 */
  videoMultiScene?: boolean
  /** 视频专用：多幕幕数（2~6）。 */
  videoSceneCount?: number
  /** 视频专用：旁白音色 id（edge-tts）。 */
  videoVoice?: string
  /** 视频专用：是否生成背景配乐。 */
  videoMusic?: boolean
}

/** Persist an in-progress studio form so switching pages never loses work. */
export function saveStudioDraft(studio: StudioId, draft: StudioDraftCache): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STUDIO_DRAFT_PREFIX + studio, JSON.stringify(draft))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

/** Restore the last in-progress studio form (or null if none). */
export function loadStudioDraft(studio: StudioId): StudioDraftCache | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STUDIO_DRAFT_PREFIX + studio)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StudioDraftCache>
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      topic: typeof parsed.topic === 'string' ? parsed.topic : '',
      content: typeof parsed.content === 'string' ? parsed.content : '',
      style: typeof parsed.style === 'string' ? parsed.style : 'cinematic',
      requirement: typeof parsed.requirement === 'string' ? parsed.requirement : '',
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : [],
      videoStyleId: typeof parsed.videoStyleId === 'string' ? parsed.videoStyleId : '',
      videoMultiScene: typeof parsed.videoMultiScene === 'boolean' ? parsed.videoMultiScene : false,
      videoSceneCount: Number.isFinite(Number(parsed.videoSceneCount)) ? Number(parsed.videoSceneCount) : 3,
      videoVoice: typeof parsed.videoVoice === 'string' ? parsed.videoVoice : 'zh-CN-XiaoxiaoNeural',
      videoMusic: typeof parsed.videoMusic === 'boolean' ? parsed.videoMusic : true,
    }
  } catch {
    return null
  }
}

/** Clear the cached in-progress form for a studio (after a successful save). */
export function clearStudioDraft(studio: StudioId): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STUDIO_DRAFT_PREFIX + studio)
  } catch {
    // ignore
  }
}
