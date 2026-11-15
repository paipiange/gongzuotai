import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export interface InspirationRecord {
  id: string
  title: string
  description: string
  promptTemplate: string
  category: string
  tags: string[]
  coverAssetId: string | null
  isBuiltin: boolean
  createdAt: string
}

export interface CreateInspirationInput {
  title: string
  description: string
  promptTemplate: string
  category: string
  tags?: string[]
  coverAssetId?: string | null
  isBuiltin?: boolean
}

interface InspirationRow {
  id: string
  title: string
  description: string
  prompt_template: string
  category: string
  tags_json: string
  cover_asset_id: string | null
  is_builtin: 0 | 1
  created_at: string
}

/** Reads and writes the `inspirations` table (灵感池). */
export class InspirationRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateInspirationInput): InspirationRecord {
    const now = new Date().toISOString()
    const record: InspirationRecord = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description.trim(),
      promptTemplate: input.promptTemplate,
      category: input.category.trim() || '通用',
      tags: input.tags ?? [],
      coverAssetId: input.coverAssetId ?? null,
      isBuiltin: input.isBuiltin ?? false,
      createdAt: now,
    }
    if (!record.title) throw new Error('灵感标题不能为空')
    this.db.prepare(`
      INSERT INTO inspirations (id, title, description, prompt_template, category, tags_json, cover_asset_id, is_builtin, created_at)
      VALUES (@id, @title, @description, @promptTemplate, @category, @tagsJson, @coverAssetId, @isBuiltin, @createdAt)
    `).run({ ...record, tagsJson: JSON.stringify(record.tags), isBuiltin: record.isBuiltin ? 1 : 0 })
    return record
  }

  list(input: { category?: string; limit?: number; offset?: number } = {}) {
    const rows = this.db.prepare(`
      SELECT * FROM inspirations
      WHERE (@category IS NULL OR category = @category)
      ORDER BY is_builtin DESC, created_at DESC, id ASC
      LIMIT @limit OFFSET @offset
    `).all({
      category: input.category ?? null,
      limit: clampInteger(input.limit, 50, 1, 200),
      offset: clampInteger(input.offset, 0, 0, 100_000),
    }) as InspirationRow[]
    return rows.map(mapInspiration)
  }

  getById(id: string) {
    const row = this.db.prepare('SELECT * FROM inspirations WHERE id = ?').get(id) as InspirationRow | undefined
    return row ? mapInspiration(row) : null
  }

  remove(id: string) {
    const result = this.db.prepare('DELETE FROM inspirations WHERE id = ?').run(id)
    return result.changes === 1
  }
}

function mapInspiration(row: InspirationRow): InspirationRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    promptTemplate: row.prompt_template,
    category: row.category,
    tags: parseArray(row.tags_json),
    coverAssetId: row.cover_asset_id,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
  }
}

function parseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value as number))
}
