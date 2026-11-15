import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type PublishPlatform = 'wechat' | 'xiaohongshu' | 'zhihu' | 'toutiao' | 'other'
export type PublishStatus = 'draft' | 'ready' | 'exported' | 'published'

export interface PublishItemRecord {
  id: string
  creationId: string
  platform: PublishPlatform
  status: PublishStatus
  exportPath: string | null
  externalUrl: string | null
  exportedAt: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatePublishItemInput {
  creationId: string
  platform: PublishPlatform
  status?: PublishStatus
}

interface PublishItemRow {
  id: string
  creation_id: string
  platform: PublishPlatform
  status: PublishStatus
  export_path: string | null
  external_url: string | null
  exported_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

const PLATFORMS: PublishPlatform[] = ['wechat', 'xiaohongshu', 'zhihu', 'toutiao', 'other']

/** Reads and writes the `publish_items` table (待发布清单). */
export class PublishRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreatePublishItemInput): PublishItemRecord {
    if (!PLATFORMS.includes(input.platform)) throw new Error(`不支持的发布平台: ${input.platform}`)
    const now = new Date().toISOString()
    const record: PublishItemRecord = {
      id: randomUUID(),
      creationId: input.creationId,
      platform: input.platform,
      status: input.status ?? 'draft',
      exportPath: null,
      externalUrl: null,
      exportedAt: null,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.db.prepare(`
      INSERT INTO publish_items (id, creation_id, platform, status, export_path, external_url, exported_at, published_at, created_at, updated_at)
      VALUES (@id, @creationId, @platform, @status, @exportPath, @externalUrl, @exportedAt, @publishedAt, @createdAt, @updatedAt)
    `).run(record)
    return record
  }

  list(input: { status?: PublishStatus; limit?: number; offset?: number } = {}) {
    const rows = this.db.prepare(`
      SELECT * FROM publish_items
      WHERE (@status IS NULL OR status = @status)
      ORDER BY updated_at DESC, id ASC
      LIMIT @limit OFFSET @offset
    `).all({
      status: input.status ?? null,
      limit: clampInteger(input.limit, 50, 1, 200),
      offset: clampInteger(input.offset, 0, 0, 100_000),
    }) as PublishItemRow[]
    return rows.map(mapPublishItem)
  }

  getById(id: string) {
    const row = this.db.prepare('SELECT * FROM publish_items WHERE id = ?').get(id) as PublishItemRow | undefined
    return row ? mapPublishItem(row) : null
  }

  /**
   * Ensure a creation has a publish item (idempotent). When a creation is
   * marked "queued" we upsert a matching publish item; if one already exists it
   * is left untouched.
   */
  ensureForCreation(creationId: string, platform: PublishPlatform = 'other'): PublishItemRecord {
    const existing = this.db.prepare('SELECT * FROM publish_items WHERE creation_id = ?').get(creationId) as PublishItemRow | undefined
    if (existing) return mapPublishItem(existing)
    return this.create({ creationId, platform })
  }

  update(id: string, input: {
    status?: PublishStatus
    exportPath?: string | null
    externalUrl?: string | null
    exportedAt?: string | null
    publishedAt?: string | null
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
      // Auto-stamp lifecycle transitions when the status changes.
      exportedAt: input.exportedAt === undefined
        ? (nextStatus === 'exported' || nextStatus === 'published' ? (current.exportedAt ?? now) : current.exportedAt)
        : input.exportedAt,
      publishedAt: input.publishedAt === undefined
        ? (nextStatus === 'published' ? (current.publishedAt ?? now) : current.publishedAt)
        : input.publishedAt,
      updatedAt: now,
    }
    this.db.prepare(`
      UPDATE publish_items SET
        status = @status,
        export_path = @exportPath,
        external_url = @externalUrl,
        exported_at = @exportedAt,
        published_at = @publishedAt,
        updated_at = @updatedAt
      WHERE id = @id
    `).run(next)
    return next
  }

  remove(id: string) {
    const result = this.db.prepare('DELETE FROM publish_items WHERE id = ?').run(id)
    return result.changes === 1
  }
}

function mapPublishItem(row: PublishItemRow): PublishItemRecord {
  return {
    id: row.id,
    creationId: row.creation_id,
    platform: row.platform,
    status: row.status,
    exportPath: row.export_path,
    externalUrl: row.external_url,
    exportedAt: row.exported_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value as number))
}
