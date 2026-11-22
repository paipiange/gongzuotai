import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type PublishPlatform = 'wechat' | 'xiaohongshu' | 'zhihu' | 'toutiao' | 'other'
export type PublishStatus = 'draft' | 'ready' | 'exported' | 'published'
export type PublishAttemptStatus = 'running' | 'success' | 'failed'

export interface PublishItemRecord {
  id: string
  creationId: string
  platform: PublishPlatform
  status: PublishStatus
  exportPath: string | null
  externalUrl: string | null
  externalId: string | null
  lastError: string | null
  retryCount: number
  lastCheckedAt: string | null
  exportedAt: string | null
  publishedAt: string | null
  /** 计划发布时间（ISO 8601）；null 表示未设置定时。 */
  scheduledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PublishAttemptRecord {
  id: string
  publishItemId: string | null
  platform: PublishPlatform
  action: string
  status: PublishAttemptStatus
  mediaId: string | null
  errorMessage: string | null
  retryNo: number
  request: Record<string, unknown>
  result: Record<string, unknown>
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

export interface PublishVersionRecord {
  id: string
  publishItemId: string
  versionNo: number
  title: string
  bodyMd: string
  bodyHtml: string
  snapshot: Record<string, unknown>
  createdAt: string
}

export interface CreatePublishItemInput {
  creationId: string
  platform: PublishPlatform
  status?: PublishStatus
}

interface PublishItemRow {
  id: string; creation_id: string; platform: PublishPlatform; status: PublishStatus
  export_path: string | null; external_url: string | null; external_id: string | null
  last_error: string | null; retry_count: number; last_checked_at: string | null
  exported_at: string | null; published_at: string | null; scheduled_at: string | null
  created_at: string; updated_at: string
}

interface AttemptRow {
  id: string; publish_item_id: string | null; platform: PublishPlatform; action: string; status: PublishAttemptStatus
  media_id: string | null; error_message: string | null; retry_no: number; request_json: string; result_json: string
  started_at: string; finished_at: string | null; created_at: string
}

interface VersionRow {
  id: string; publish_item_id: string; version_no: number; title: string; body_md: string; body_html: string
  snapshot_json: string; created_at: string
}

const PLATFORMS: PublishPlatform[] = ['wechat', 'xiaohongshu', 'zhihu', 'toutiao', 'other']

/** Publish queue plus immutable attempt/version audit history. */
export class PublishRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreatePublishItemInput): PublishItemRecord {
    if (!PLATFORMS.includes(input.platform)) throw new Error(`不支持的发布平台: ${input.platform}`)
    const now = new Date().toISOString()
    const record: PublishItemRecord = {
      id: randomUUID(), creationId: input.creationId, platform: input.platform, status: input.status ?? 'draft',
      exportPath: null, externalUrl: null, externalId: null, lastError: null, retryCount: 0, lastCheckedAt: null,
      exportedAt: null, publishedAt: null, scheduledAt: null, createdAt: now, updatedAt: now,
    }
    this.db.prepare(`
      INSERT INTO publish_items (
        id, creation_id, platform, status, export_path, external_url, external_id, last_error,
        retry_count, last_checked_at, exported_at, published_at, scheduled_at, created_at, updated_at
      ) VALUES (
        @id, @creationId, @platform, @status, @exportPath, @externalUrl, @externalId, @lastError,
        @retryCount, @lastCheckedAt, @exportedAt, @publishedAt, @scheduledAt, @createdAt, @updatedAt
      )
    `).run(record)
    return record
  }

  list(input: { status?: PublishStatus; limit?: number; offset?: number } = {}) {
    const rows = this.db.prepare(`
      SELECT * FROM publish_items WHERE (@status IS NULL OR status = @status)
      ORDER BY updated_at DESC, id ASC LIMIT @limit OFFSET @offset
    `).all({ status: input.status ?? null, limit: clampInteger(input.limit, 50, 1, 200), offset: clampInteger(input.offset, 0, 0, 100_000) }) as PublishItemRow[]
    return rows.map(mapPublishItem)
  }

  getById(id: string) {
    const row = this.db.prepare('SELECT * FROM publish_items WHERE id = ?').get(id) as PublishItemRow | undefined
    return row ? mapPublishItem(row) : null
  }

  ensureForCreation(creationId: string, platform: PublishPlatform = 'other'): PublishItemRecord {
    const existing = this.db.prepare('SELECT * FROM publish_items WHERE creation_id = ?').get(creationId) as PublishItemRow | undefined
    return existing ? mapPublishItem(existing) : this.create({ creationId, platform })
  }

  update(id: string, input: {
    status?: PublishStatus; exportPath?: string | null; externalUrl?: string | null; externalId?: string | null
    lastError?: string | null; retryCount?: number; lastCheckedAt?: string | null
    exportedAt?: string | null; publishedAt?: string | null; scheduledAt?: string | null
  }) {
    const current = this.getById(id)
    if (!current) return null
    const now = new Date().toISOString()
    const nextStatus = input.status ?? current.status
    const next: PublishItemRecord = {
      ...current,
      status: nextStatus,
      exportPath: input.exportPath === undefined ? current.exportPath : input.exportPath,
      externalUrl: input.externalUrl === undefined ? current.externalUrl : input.externalUrl,
      externalId: input.externalId === undefined ? current.externalId : input.externalId,
      lastError: input.lastError === undefined ? current.lastError : input.lastError,
      retryCount: input.retryCount === undefined ? current.retryCount : Math.max(0, Math.trunc(input.retryCount)),
      lastCheckedAt: input.lastCheckedAt === undefined ? current.lastCheckedAt : input.lastCheckedAt,
      exportedAt: input.exportedAt === undefined
        ? (nextStatus === 'exported' || nextStatus === 'published' ? (current.exportedAt ?? now) : current.exportedAt)
        : input.exportedAt,
      publishedAt: input.publishedAt === undefined ? (nextStatus === 'published' ? (current.publishedAt ?? now) : current.publishedAt) : input.publishedAt,
      scheduledAt: input.scheduledAt === undefined ? current.scheduledAt : input.scheduledAt,
      updatedAt: now,
    }
    this.db.prepare(`
      UPDATE publish_items SET status=@status, export_path=@exportPath, external_url=@externalUrl,
        external_id=@externalId, last_error=@lastError, retry_count=@retryCount,
        last_checked_at=@lastCheckedAt, exported_at=@exportedAt, published_at=@publishedAt,
        scheduled_at=@scheduledAt, updated_at=@updatedAt
      WHERE id=@id
    `).run(next)
    return next
  }

  createAttempt(input: {
    publishItemId?: string | null; platform: PublishPlatform; action: string
    request?: Record<string, unknown>; retryNo?: number
  }): PublishAttemptRecord {
    const now = new Date().toISOString()
    const record: PublishAttemptRecord = {
      id: randomUUID(), publishItemId: input.publishItemId ?? null, platform: input.platform, action: input.action,
      status: 'running', mediaId: null, errorMessage: null, retryNo: Math.max(0, Math.trunc(input.retryNo ?? 0)),
      request: input.request ?? {}, result: {}, startedAt: now, finishedAt: null, createdAt: now,
    }
    this.db.prepare(`
      INSERT INTO publish_attempts (
        id, publish_item_id, platform, action, status, media_id, error_message, retry_no,
        request_json, result_json, started_at, finished_at, created_at
      ) VALUES (
        @id, @publishItemId, @platform, @action, @status, @mediaId, @errorMessage, @retryNo,
        @requestJson, @resultJson, @startedAt, @finishedAt, @createdAt
      )
    `).run({ ...record, requestJson: JSON.stringify(record.request), resultJson: '{}' })
    return record
  }

  finishAttempt(id: string, input: {
    status: 'success' | 'failed'; mediaId?: string | null; errorMessage?: string | null; result?: Record<string, unknown>
    itemStatus?: PublishStatus; exportPath?: string | null; checked?: boolean
  }): PublishAttemptRecord | null {
    return this.db.transaction(() => {
      const current = this.getAttempt(id)
      if (!current || current.status !== 'running') return current
      const now = new Date().toISOString()
      this.db.prepare(`
        UPDATE publish_attempts SET status=@status, media_id=@mediaId, error_message=@errorMessage,
          result_json=@resultJson, finished_at=@now WHERE id=@id AND status='running'
      `).run({
        id, status: input.status, mediaId: input.mediaId ?? null, errorMessage: input.errorMessage ?? null,
        resultJson: JSON.stringify(input.result ?? {}), now,
      })
      if (current.publishItemId) {
        const item = this.getById(current.publishItemId)
        if (item) {
          this.update(item.id, input.status === 'success' ? {
            ...(input.itemStatus ? { status: input.itemStatus } : {}),
            ...(input.exportPath !== undefined ? { exportPath: input.exportPath } : {}),
            ...(input.mediaId ? { externalId: input.mediaId } : {}),
            lastError: null,
            ...(input.checked ? { lastCheckedAt: now } : {}),
          } : {
            lastError: input.errorMessage ?? '发布操作失败',
            retryCount: item.retryCount + 1,
            ...(input.checked ? { lastCheckedAt: now } : {}),
          })
        }
      }
      return this.getAttempt(id)
    })()
  }

  getAttempt(id: string): PublishAttemptRecord | null {
    const row = this.db.prepare('SELECT * FROM publish_attempts WHERE id = ?').get(id) as AttemptRow | undefined
    return row ? mapAttempt(row) : null
  }

  listAttempts(publishItemId?: string | null, limit = 100): PublishAttemptRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM publish_attempts WHERE (@publishItemId IS NULL OR publish_item_id = @publishItemId)
      ORDER BY created_at DESC, rowid DESC LIMIT @limit
    `).all({ publishItemId: publishItemId ?? null, limit: clampInteger(limit, 100, 1, 500) }) as AttemptRow[]
    return rows.map(mapAttempt)
  }

  recordVersion(publishItemId: string, input: {
    title: string; bodyMd?: string; bodyHtml?: string; snapshot?: Record<string, unknown>
  }): PublishVersionRecord {
    const now = new Date().toISOString()
    return this.db.transaction(() => {
      const nextNo = Number((this.db.prepare('SELECT MAX(version_no) AS n FROM publish_versions WHERE publish_item_id = ?').get(publishItemId) as { n: number | null }).n ?? 0) + 1
      const record: PublishVersionRecord = {
        id: randomUUID(), publishItemId, versionNo: nextNo, title: input.title,
        bodyMd: input.bodyMd ?? '', bodyHtml: input.bodyHtml ?? '', snapshot: input.snapshot ?? {}, createdAt: now,
      }
      this.db.prepare(`
        INSERT INTO publish_versions (id, publish_item_id, version_no, title, body_md, body_html, snapshot_json, created_at)
        VALUES (@id, @publishItemId, @versionNo, @title, @bodyMd, @bodyHtml, @snapshotJson, @createdAt)
      `).run({ ...record, snapshotJson: JSON.stringify(record.snapshot) })
      return record
    })()
  }

  listVersions(publishItemId: string): PublishVersionRecord[] {
    const rows = this.db.prepare('SELECT * FROM publish_versions WHERE publish_item_id = ? ORDER BY version_no DESC').all(publishItemId) as VersionRow[]
    return rows.map(mapVersion)
  }

  remove(id: string) {
    return this.db.prepare('DELETE FROM publish_items WHERE id = ?').run(id).changes === 1
  }
}

function mapPublishItem(row: PublishItemRow): PublishItemRecord {
  return {
    id: row.id, creationId: row.creation_id, platform: row.platform, status: row.status,
    exportPath: row.export_path, externalUrl: row.external_url, externalId: row.external_id,
    lastError: row.last_error, retryCount: row.retry_count ?? 0, lastCheckedAt: row.last_checked_at,
    exportedAt: row.exported_at, publishedAt: row.published_at, scheduledAt: row.scheduled_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

function mapAttempt(row: AttemptRow): PublishAttemptRecord {
  return {
    id: row.id, publishItemId: row.publish_item_id, platform: row.platform, action: row.action, status: row.status,
    mediaId: row.media_id, errorMessage: row.error_message, retryNo: row.retry_no,
    request: parseObject(row.request_json), result: parseObject(row.result_json),
    startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at,
  }
}

function mapVersion(row: VersionRow): PublishVersionRecord {
  return {
    id: row.id, publishItemId: row.publish_item_id, versionNo: row.version_no, title: row.title,
    bodyMd: row.body_md, bodyHtml: row.body_html, snapshot: parseObject(row.snapshot_json), createdAt: row.created_at,
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value as number))
}
