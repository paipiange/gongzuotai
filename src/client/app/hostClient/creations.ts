/**
 * Creation CRUD + batch operations.
 */

import { apiFetch } from './client'
import type { CreationDraft, CreationRecord, CreationStatus } from './types'

export async function listCreations(input?: { status?: CreationStatus; query?: string; tags?: string[] }): Promise<CreationRecord[]> {
  const params = new URLSearchParams()
  if (input?.status) params.set('status', input.status)
  if (input?.query) params.set('query', input.query)
  if (input?.tags?.length) params.set('tags', input.tags.join(','))
  const query = params.toString()
  const data = await apiFetch<{ creations: CreationRecord[] }>(`.creations${query ? `?${query}` : ''}`)
  return data.creations
}

export async function createCreation(draft: CreationDraft): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>('.creations', {
    method: 'POST',
    body: JSON.stringify(draft),
  })
  return data.creation
}

export async function getCreation(id: string): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>(`.creation?id=${encodeURIComponent(id)}`)
  return data.creation
}

export async function updateCreation(id: string, patch: Partial<CreationDraft>): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>(`.creation?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.creation
}

export async function setCreationStatus(id: string, status: CreationStatus): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>(`.creation.status?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  return data.creation
}

export async function deleteCreation(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`.creation?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Permanently delete a creation (hard delete, bypasses soft-delete). */
export async function purgeCreation(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`.creation.purge?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Set or clear a creation's cover asset. Pass `null` to clear. */
export async function setCreationCover(id: string, assetId: string | null): Promise<CreationRecord> {
  const data = await apiFetch<{ creation: CreationRecord }>(`.creation.cover?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ assetId }),
  })
  return data.creation
}

/** Batch archive/restore/delete/status-change creations. Returns processed ids. */
export async function batchCreations(ids: string[], action: 'archive' | 'restore' | 'delete' | 'status', status?: CreationStatus): Promise<{ done: string[]; total: number }> {
  const data = await apiFetch<{ done: string[]; total: number }>('.creations.batch', {
    method: 'POST',
    body: JSON.stringify({ ids, action, ...(status ? { status } : {}) }),
  })
  return data
}
