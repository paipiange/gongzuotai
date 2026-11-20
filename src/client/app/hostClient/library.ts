/**
 * Library-domain APIs: templates, inspirations (+ aihot), publish queue,
 * assets (+ storage cleanup), backups, and generation-task logs.
 */

import { BASE, HostError, apiFetch } from './client'
import type {
  AnalyticsOverview,
  AssetRecord,
  AssetStorageStats,
  AihotItem,
  BackupRecord,
  BackupPolicy,
  HomeCarouselConfig,
  InspirationRecord,
  PublishItem,
  PublishDetail,
  PublishAttempt,
  PublishPlatform,
  PublishStatus,
  TaskKind,
  TaskRecord,
  TaskStatus,
  TemplateExportPayload,
  TemplateRecord,
} from './types'

// ---- Templates ----

export async function listTemplates(category?: string): Promise<TemplateRecord[]> {
  const path = category ? `.templates?category=${encodeURIComponent(category)}` : '.templates'
  const data = await apiFetch<{ templates: TemplateRecord[] }>(path)
  return data.templates
}

export async function createTemplate(input: { category: string; name: string; description?: string; promptTemplate: string; fields?: unknown[] }): Promise<TemplateRecord> {
  const data = await apiFetch<{ template: TemplateRecord }>('.templates', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.template
}

/** Export templates (all, or a subset by ids) as a shareable JSON object. */
export async function exportTemplates(ids?: string[]): Promise<TemplateExportPayload> {
  const query = ids?.length ? `?ids=${encodeURIComponent(ids.join(','))}` : ''
  const data = await apiFetch<TemplateExportPayload>(`.templates.export${query}`)
  return data
}

/** Import templates from a parsed export payload. Returns the imported count. */
export async function importTemplates(templates: TemplateExportPayload['templates']): Promise<number> {
  const data = await apiFetch<{ imported: number }>('.templates.import', {
    method: 'POST',
    body: JSON.stringify({ templates }),
  })
  return data.imported
}

// ---- Inspirations ----

export async function listInspirations(category?: string): Promise<InspirationRecord[]> {
  const path = category ? `.inspirations?category=${encodeURIComponent(category)}` : '.inspirations'
  const data = await apiFetch<{ inspirations: InspirationRecord[] }>(path)
  return data.inspirations
}

export async function createInspiration(input: { title: string; description?: string; promptTemplate?: string; category?: string; tags?: string[] }): Promise<InspirationRecord> {
  const data = await apiFetch<{ inspiration: InspirationRecord }>('.inspirations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.inspiration
}

/** 拉取 aihot.news 的热门 AI 资讯，作为灵感来源。 */
export async function fetchAihot(input?: { mode?: 'selected' | 'all'; category?: string; window?: string; limit?: number }): Promise<AihotItem[]> {
  const params = new URLSearchParams()
  if (input?.mode) params.set('mode', input.mode)
  if (input?.category) params.set('category', input.category)
  if (input?.window) params.set('window', input.window)
  if (input?.limit) params.set('limit', String(input.limit))
  const query = params.toString()
  const data = await apiFetch<{ items: AihotItem[] }>(`.inspiration.aihot${query ? `?${query}` : ''}`)
  return data.items
}

/** Ask the Host's text model for content-topic suggestions and save them to the pool. */
export async function suggestInspirations(input: { topics?: string[]; count?: number }): Promise<InspirationRecord[]> {
  const data = await apiFetch<{ inspirations: InspirationRecord[] }>('.inspiration.suggest', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.inspirations
}

// ---- Publish queue ----

export async function listPublishItems(status?: PublishStatus): Promise<PublishItem[]> {
  const path = status ? `.publish?status=${encodeURIComponent(status)}` : '.publish'
  const data = await apiFetch<{ items: PublishItem[] }>(path)
  return data.items
}

export async function createPublishItem(input: { creationId: string; platform: PublishPlatform }): Promise<PublishItem> {
  const data = await apiFetch<{ item: PublishItem }>('.publish', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.item
}

export async function setPublishStatus(id: string, status: PublishStatus, externalUrl?: string): Promise<PublishItem> {
  const data = await apiFetch<{ item: PublishItem }>(`.publish.status?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(externalUrl !== undefined ? { externalUrl } : {}) }),
  })
  return data.item
}

export async function getPublishDetail(id: string): Promise<PublishDetail> {
  return apiFetch<PublishDetail>(`.publish.detail?id=${encodeURIComponent(id)}`)
}

export async function refreshPublishStatus(id: string): Promise<PublishItem> {
  const data = await apiFetch<{ item: PublishItem }>('.publish.refresh', {
    method: 'POST', body: JSON.stringify({ id }),
  })
  return data.item
}

export async function retryPublish(id: string): Promise<PublishItem> {
  const data = await apiFetch<{ item: PublishItem }>('.publish.retry', {
    method: 'POST', body: JSON.stringify({ id }),
  })
  return data.item
}

export async function listPublishAttempts(id?: string, limit = 50): Promise<PublishAttempt[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (id) params.set('id', id)
  const data = await apiFetch<{ attempts: PublishAttempt[] }>(`.publish.attempts?${params.toString()}`)
  return data.attempts
}

// ---- Assets ----

export async function listAssets(input?: { kind?: 'image' | 'file' | 'prompt' | 'document'; creationId?: string; tags?: string[]; query?: string; limit?: number; offset?: number }): Promise<AssetRecord[]> {
  const params = new URLSearchParams()
  if (input?.kind) params.set('kind', input.kind)
  if (input?.creationId) params.set('creationId', input.creationId)
  if (input?.tags?.length) params.set('tags', input.tags.join(','))
  if (input?.query) params.set('query', input.query)
  if (input?.limit) params.set('limit', String(input.limit))
  if (input?.offset) params.set('offset', String(input.offset))
  const query = params.toString()
  const data = await apiFetch<{ assets: AssetRecord[] }>(`.assets${query ? `?${query}` : ''}`)
  return data.assets
}

export async function uploadAsset(file: File, creationId?: string): Promise<AssetRecord> {
  const query = creationId ? `?creationId=${encodeURIComponent(creationId)}` : ''
  const response = await fetch(`${BASE}.asset.upload${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': file.name,
    },
    body: file,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `上传失败 (HTTP ${response.status})`, response.status)
  }
  const data = await response.json() as { asset: AssetRecord }
  return data.asset
}

/** Build an <img> source URL for an asset id (same-origin binary route). */
export function assetUrl(id: string): string {
  return `${BASE}.asset?id=${encodeURIComponent(id)}`
}/** Soft-delete an asset by id. */
export async function deleteAsset(id: string): Promise<void> {
  await apiFetch(`.asset.delete?id=${encodeURIComponent(id)}`, { method: 'POST' })
}

/** Batch soft-delete assets. Returns processed count. */
export async function batchDeleteAssets(ids: string[]): Promise<{ done: number; total: number }> {
  const data = await apiFetch<{ done: number; total: number }>('.assets.batchdelete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
  return data
}

export async function listDeletedAssets(limit = 100): Promise<AssetRecord[]> {
  const data = await apiFetch<{ assets: AssetRecord[] }>(`.assets.trash?limit=${encodeURIComponent(String(limit))}`)
  return data.assets
}

export async function restoreAsset(id: string): Promise<void> {
  await apiFetch(`.asset.restore?id=${encodeURIComponent(id)}`, { method: 'POST' })
}

export async function batchRestoreAssets(ids: string[]): Promise<{ done: number; total: number }> {
  return apiFetch<{ done: number; total: number }>('.assets.batchrestore', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

export async function getAssetStorage(): Promise<AssetStorageStats> {
  return apiFetch<AssetStorageStats>('.assets.storage', { method: 'GET' })
}

/** Permanently delete every soft-deleted asset (file + row). */
export async function emptyTrashAssets(): Promise<{ count: number; freedBytes: number }> {
  return apiFetch<{ count: number; freedBytes: number }>('.assets.emptytrash', { method: 'POST' })
}

/** Permanently delete all orphan image assets. */
export async function purgeOrphanAssets(): Promise<{ count: number; freedBytes: number }> {
  return apiFetch<{ count: number; freedBytes: number }>('.assets.purgeorphans', { method: 'POST' })
}

/** Replace an asset's tag list. */
export async function setAssetTags(id: string, tags: string[]): Promise<void> {
  await apiFetch<{ ok: boolean }>(`.asset.tags?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ tags }),
  })
}

// ---- Home carousel ----

export async function getHomeCarousel(): Promise<HomeCarouselConfig> {
  const data = await apiFetch<{ carousel: HomeCarouselConfig }>('.home.carousel')
  return data.carousel
}

export async function setHomeCarousel(input: Partial<HomeCarouselConfig>): Promise<HomeCarouselConfig> {
  const data = await apiFetch<{ carousel: HomeCarouselConfig }>('.home.carousel', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return data.carousel
}

// ---- Backups ----

export async function createBackup(): Promise<BackupRecord> {
  const data = await apiFetch<{ backup: BackupRecord }>('.backup', { method: 'POST' })
  return data.backup
}

export async function listBackups(): Promise<BackupRecord[]> {
  const data = await apiFetch<{ backups: BackupRecord[] }>('.backups')
  return data.backups
}

export async function getBackupPolicy(): Promise<BackupPolicy> {
  const data = await apiFetch<{ policy: BackupPolicy }>('.backup.policy')
  return data.policy
}

export async function setBackupPolicy(input: Partial<BackupPolicy>): Promise<BackupPolicy> {
  const data = await apiFetch<{ policy: BackupPolicy }>('.backup.policy', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return data.policy
}

/** Download a backup snapshot by filename. Returns the raw bytes. */
export async function downloadBackup(filename: string): Promise<Blob> {
  const response = await fetch(`${BASE}.backup.download?filename=${encodeURIComponent(filename)}`)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `下载失败 (HTTP ${response.status})`, response.status)
  }
  return response.blob()
}

/** Restore a backup snapshot over the live database. Returns the pre-restore safety snapshot name. */
export async function restoreBackup(filename: string): Promise<{ filename: string; preRestore: string; restartRequired: boolean }> {
  const data = await apiFetch<{ filename: string; preRestore: string; restartRequired: boolean }>('.backup.restore', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  })
  return data
}

/** Ask the host to restart the dsh desktop app (e.g. after restoring a backup). */
export async function restartApp(): Promise<void> {
  await apiFetch<{ ok: boolean }>('.app.restart', { method: 'POST' })
}

// ---- Generation tasks (request params + result logs) ----

export async function listTasks(input?: { kind?: TaskKind; status?: TaskStatus; query?: string; limit?: number; offset?: number }): Promise<TaskRecord[]> {
  const params = new URLSearchParams()
  if (input?.kind) params.set('kind', input.kind)
  if (input?.status) params.set('status', input.status)
  if (input?.query) params.set('query', input.query)
  if (input?.limit) params.set('limit', String(input.limit))
  if (input?.offset) params.set('offset', String(input.offset))
  const query = params.toString()
  const data = await apiFetch<{ tasks: TaskRecord[] }>(`.tasks${query ? `?${query}` : ''}`)
  return data.tasks
}

export async function getTask(id: string): Promise<TaskRecord> {
  const data = await apiFetch<{ task: TaskRecord }>(`.task?id=${encodeURIComponent(id)}`)
  return data.task
}

export async function cancelTask(input: { id?: string; clientRequestId?: string }): Promise<TaskRecord> {
  const data = await apiFetch<{ task: TaskRecord }>('.task.cancel', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.task
}

export async function pauseTask(id: string): Promise<TaskRecord> {
  const data = await apiFetch<{ task: TaskRecord }>('.task.pause', { method: 'POST', body: JSON.stringify({ id }) })
  return data.task
}

export async function resumeTask(id: string): Promise<TaskRecord> {
  const data = await apiFetch<{ task: TaskRecord }>('.task.resume', { method: 'POST', body: JSON.stringify({ id }) })
  return data.task
}

export async function setTaskPriority(id: string, priority: number): Promise<TaskRecord> {
  const data = await apiFetch<{ task: TaskRecord }>('.task.priority', { method: 'PATCH', body: JSON.stringify({ id, priority }) })
  return data.task
}

export async function waitForTask(
  id: string,
  onUpdate?: (task: TaskRecord) => void,
  signal?: AbortSignal,
  intervalMs = 500,
): Promise<TaskRecord> {
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const task = await getTask(id)
    onUpdate?.(task)
    if (task.status === 'success') return task
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(task.errorMessage || (task.status === 'cancelled' ? '任务已取消' : '生成失败'))
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        window.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      const timer = window.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, intervalMs)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

// ---- Analytics dashboard ----

/** Fetch the read-only analytics overview aggregated from local SQLite. */
export async function fetchAnalytics(): Promise<AnalyticsOverview> {
  const data = await apiFetch<{ overview: AnalyticsOverview }>('.analytics')
  return data.overview
}
