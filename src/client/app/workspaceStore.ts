import type { StudioId } from './data'

export type CreationStatus = 'draft' | 'queued' | 'archived'

export interface CreationRecord {
  id: string
  studio: Exclude<StudioId, 'video'>
  title: string
  topic: string
  content: string
  style: string
  requirement: string
  status: CreationStatus
  createdAt: string
  updatedAt: string
}

export interface WorkspaceSnapshot {
  version: 1
  creations: CreationRecord[]
}

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
const EMPTY_SNAPSHOT: WorkspaceSnapshot = { version: 1, creations: [] }

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

export function loadWorkspace(): WorkspaceSnapshot {
  if (typeof window === 'undefined') return EMPTY_SNAPSHOT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_SNAPSHOT
    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>
    if (parsed.version !== 1 || !Array.isArray(parsed.creations)) return EMPTY_SNAPSHOT
    return { version: 1, creations: parsed.creations.map(normalizeCreation).filter((item): item is CreationRecord => Boolean(item)) }
  } catch {
    return EMPTY_SNAPSHOT
  }
}

export function persistWorkspace(snapshot: WorkspaceSnapshot): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    return true
  } catch {
    return false
  }
}

export function upsertCreation(creations: CreationRecord[], draft: CreationDraft): CreationRecord[] {
  const now = new Date().toISOString()
  const existing = draft.id ? creations.find((item) => item.id === draft.id) : undefined
  const record: CreationRecord = {
    id: existing?.id ?? createId(),
    studio: draft.studio,
    title: draft.title.trim() || draft.topic.trim() || '未命名草稿',
    topic: draft.topic.trim(),
    content: draft.content,
    style: draft.style,
    requirement: draft.requirement,
    status: draft.status ?? existing?.status ?? 'draft',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return [record, ...creations.filter((item) => item.id !== record.id)]
}

export function updateCreationStatus(creations: CreationRecord[], id: string, status: CreationStatus): CreationRecord[] {
  const now = new Date().toISOString()
  return creations.map((item) => item.id === id ? { ...item, status, updatedAt: now } : item)
}

export function removeCreation(creations: CreationRecord[], id: string): CreationRecord[] {
  return creations.filter((item) => item.id !== id)
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `pa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
