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
  return record as CreationRecord
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

/** Merge host records over any legacy local records, then clear the local copy. */
function reconcile(hostRecords: CreationRecord[], localRecords: CreationRecord[]): CreationRecord[] {
  const byId = new Map<string, CreationRecord>()
  for (const record of localRecords) byId.set(record.id, record)
  for (const record of hostRecords) byId.set(record.id, record)
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export type StoreSource = 'host' | 'local'

export interface LoadResult {
  creations: CreationRecord[]
  source: StoreSource
}

/** Load all creations, preferring the Host. */
export async function loadCreations(): Promise<LoadResult> {
  try {
    const creations = await hostList()
    saveLocal([])
    return { creations, source: 'host' }
  } catch {
    return { creations: loadLocal(), source: 'local' }
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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  saveLocal([record, ...current.filter((item) => item.id !== record.id)])
  return record
}

// Re-export for consumers that still use the pure helper (compat shim).
export { reconcile }
