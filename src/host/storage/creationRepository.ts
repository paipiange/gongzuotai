import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type CreationType = 'article' | 'image' | 'title' | 'marketing' | 'xiaohongshu'
export type CreationStatus = 'draft' | 'queued' | 'archived'
export type CreationSource = 'user' | 'ai'

export interface CreationRecord {
  id: string
  type: CreationType
  title: string
  summary: string
  bodyMd: string
  bodyHtml: string
  status: CreationStatus
  templateId: string | null
  modelId: string | null
  prompt: string
  params: Record<string, unknown>
  source: CreationSource
  isFavorite: boolean
  coverAssetId: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateCreationInput {
  type: CreationType
  title?: string
  summary?: string
  bodyMd?: string
  bodyHtml?: string
  status?: CreationStatus
  templateId?: string | null
  modelId?: string | null
  prompt?: string
  params?: Record<string, unknown>
  source?: CreationSource
  isFavorite?: boolean
  coverAssetId?: string | null
}

export interface UpdateCreationInput {
  title?: string
  summary?: string
  bodyMd?: string
  bodyHtml?: string
  status?: CreationStatus
  templateId?: string | null
  modelId?: string | null
  prompt?: string
  params?: Record<string, unknown>
  isFavorite?: boolean
  coverAssetId?: string | null
}

export interface ListCreationsInput {
  type?: CreationType
  status?: CreationStatus
  query?: string
  includeDeleted?: boolean
  limit?: number
  offset?: number
}

export interface CreationRevision {
  id: string
  creationId: string
  revisionNo: number
  bodyMd: string
  createdAt: string
}

interface CreationRow {
  id: string
  type: CreationType
  title: string
  summary: string
  body_md: string
  body_html: string
  status: CreationStatus
  template_id: string | null
  model_id: string | null
  prompt: string
  params_json: string
  source: CreationSource
  is_favorite: 0 | 1
  cover_asset_id: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

interface RevisionRow {
  id: string
  creation_id: string
  revision_no: number
  body_md: string
  created_at: string
}

export class CreationRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateCreationInput) {
    assertCreationType(input.type)
    const now = new Date().toISOString()
    const record: CreationRecord = {
      id: randomUUID(),
      type: input.type,
      title: input.title?.trim() ?? '',
      summary: input.summary?.trim() ?? '',
      bodyMd: input.bodyMd ?? '',
      bodyHtml: input.bodyHtml ?? '',
      status: input.status ?? 'draft',
      templateId: input.templateId ?? null,
      modelId: input.modelId ?? null,
      prompt: input.prompt ?? '',
      params: input.params ?? {},
      source: input.source ?? 'user',
      isFavorite: input.isFavorite ?? false,
      coverAssetId: input.coverAssetId ?? null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.db.prepare(`
      INSERT INTO creations (
        id, type, title, summary, body_md, body_html, status, template_id, model_id,
        prompt, params_json, source, is_favorite, cover_asset_id, deleted_at, created_at, updated_at
      ) VALUES (
        @id, @type, @title, @summary, @bodyMd, @bodyHtml, @status, @templateId, @modelId,
        @prompt, @paramsJson, @source, @isFavorite, @coverAssetId, NULL, @createdAt, @updatedAt
      )
    `).run({ ...record, paramsJson: JSON.stringify(record.params), isFavorite: record.isFavorite ? 1 : 0 })
    return record
  }

  getById(id: string, includeDeleted = false) {
    const row = this.db.prepare(`
      SELECT * FROM creations
      WHERE id = @id AND (@includeDeleted = 1 OR deleted_at IS NULL)
    `).get({ id, includeDeleted: includeDeleted ? 1 : 0 }) as CreationRow | undefined
    return row ? mapCreation(row) : null
  }

  list(input: ListCreationsInput = {}) {
    const query = input.query?.trim() ?? ''
    const rows = this.db.prepare(`
      SELECT * FROM creations
      WHERE (@includeDeleted = 1 OR deleted_at IS NULL)
        AND (@type IS NULL OR type = @type)
        AND (@status IS NULL OR status = @status)
        AND (
          @query = ''
          OR title LIKE @queryPattern ESCAPE '\\'
          OR summary LIKE @queryPattern ESCAPE '\\'
          OR body_md LIKE @queryPattern ESCAPE '\\'
        )
      ORDER BY updated_at DESC, id ASC
      LIMIT @limit OFFSET @offset
    `).all({
      includeDeleted: input.includeDeleted ? 1 : 0,
      type: input.type ?? null,
      status: input.status ?? null,
      query,
      queryPattern: query ? `%${escapeLike(query)}%` : '',
      limit: clampInteger(input.limit, 50, 1, 100),
      offset: clampInteger(input.offset, 0, 0, 100_000),
    }) as CreationRow[]
    return rows.map(mapCreation)
  }

  update(id: string, input: UpdateCreationInput) {
    const current = this.getById(id, true)
    if (!current) return null
    const next: CreationRecord = {
      ...current,
      title: input.title?.trim() ?? current.title,
      summary: input.summary?.trim() ?? current.summary,
      bodyMd: input.bodyMd ?? current.bodyMd,
      bodyHtml: input.bodyHtml ?? current.bodyHtml,
      status: input.status ?? current.status,
      templateId: input.templateId === undefined ? current.templateId : input.templateId,
      modelId: input.modelId === undefined ? current.modelId : input.modelId,
      prompt: input.prompt ?? current.prompt,
      params: input.params ?? current.params,
      isFavorite: input.isFavorite ?? current.isFavorite,
      coverAssetId: input.coverAssetId === undefined ? current.coverAssetId : input.coverAssetId,
      updatedAt: new Date().toISOString(),
    }
    this.db.prepare(`
      UPDATE creations SET
        title = @title,
        summary = @summary,
        body_md = @bodyMd,
        body_html = @bodyHtml,
        status = @status,
        template_id = @templateId,
        model_id = @modelId,
        prompt = @prompt,
        params_json = @paramsJson,
        is_favorite = @isFavorite,
        cover_asset_id = @coverAssetId,
        updated_at = @updatedAt
      WHERE id = @id
    `).run({ ...next, paramsJson: JSON.stringify(next.params), isFavorite: next.isFavorite ? 1 : 0 })
    return next
  }

  softDelete(id: string) {
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      UPDATE creations SET deleted_at = @now, updated_at = @now
      WHERE id = @id AND deleted_at IS NULL
    `).run({ id, now })
    return result.changes === 1
  }

  restore(id: string) {
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      UPDATE creations SET deleted_at = NULL, updated_at = @now
      WHERE id = @id AND deleted_at IS NOT NULL
    `).run({ id, now })
    return result.changes === 1
  }

  /**
   * Permanently delete a creation and its revision history. Unlike softDelete,
   * this physically removes the rows (used by the "empty trash" flow).
   */
  remove(id: string) {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM creation_revisions WHERE creation_id = ?').run(id)
      const result = this.db.prepare('DELETE FROM creations WHERE id = ?').run(id)
      return result.changes === 1
    })()
  }

  saveRevision(creationId: string, bodyMd: string) {
    return this.db.transaction(() => {
      if (!this.getById(creationId, true)) throw new Error('Creation not found')
      const row = this.db.prepare(`
        SELECT COALESCE(MAX(revision_no), 0) + 1 AS revision_no
        FROM creation_revisions WHERE creation_id = ?
      `).get(creationId) as { revision_no: number }
      const revision: CreationRevision = {
        id: randomUUID(),
        creationId,
        revisionNo: row.revision_no,
        bodyMd,
        createdAt: new Date().toISOString(),
      }
      this.db.prepare(`
        INSERT INTO creation_revisions (id, creation_id, revision_no, body_md, created_at)
        VALUES (@id, @creationId, @revisionNo, @bodyMd, @createdAt)
      `).run(revision)
      return revision
    })()
  }

  listRevisions(creationId: string) {
    const rows = this.db.prepare(`
      SELECT * FROM creation_revisions
      WHERE creation_id = ? ORDER BY revision_no DESC
    `).all(creationId) as RevisionRow[]
    return rows.map((row): CreationRevision => ({
      id: row.id,
      creationId: row.creation_id,
      revisionNo: row.revision_no,
      bodyMd: row.body_md,
      createdAt: row.created_at,
    }))
  }
}

function mapCreation(row: CreationRow): CreationRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    bodyMd: row.body_md,
    bodyHtml: row.body_html,
    status: row.status,
    templateId: row.template_id,
    modelId: row.model_id,
    prompt: row.prompt,
    params: parseObject(row.params_json),
    source: row.source,
    isFavorite: row.is_favorite === 1,
    coverAssetId: row.cover_asset_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function assertCreationType(type: string): asserts type is CreationType {
  if (!['article', 'image', 'title', 'marketing', 'xiaohongshu'].includes(type)) {
    throw new Error('Unsupported creation type')
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value as number))
}
