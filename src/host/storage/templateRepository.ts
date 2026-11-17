import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export interface TemplateRecord {
  id: string
  category: string
  name: string
  description: string
  coverAssetId: string | null
  promptTemplate: string
  fields: unknown[]
  isBuiltin: boolean
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateTemplateInput {
  category?: string
  name: string
  description?: string
  coverAssetId?: string | null
  promptTemplate: string
  fields?: unknown[]
  isBuiltin?: boolean
}

interface TemplateRow {
  id: string
  category: string
  name: string
  description: string
  cover_asset_id: string | null
  prompt_template: string
  fields_json: string
  is_builtin: 0 | 1
  version: number
  created_at: string
  updated_at: string
}

/** Reads and writes the `templates` table (创作模板). */
export class TemplateRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateTemplateInput): TemplateRecord {
    const now = new Date().toISOString()
    const record: TemplateRecord = {
      id: randomUUID(),
      category: input.category?.trim() || '通用',
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      coverAssetId: input.coverAssetId ?? null,
      promptTemplate: input.promptTemplate,
      fields: input.fields ?? [],
      isBuiltin: input.isBuiltin ?? false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    if (!record.name) throw new Error('模板名称不能为空')
    if (!record.promptTemplate) throw new Error('模板提示词不能为空')
    this.db.prepare(`
      INSERT INTO templates (id, category, name, description, cover_asset_id, prompt_template, fields_json, is_builtin, version, created_at, updated_at)
      VALUES (@id, @category, @name, @description, @coverAssetId, @promptTemplate, @fieldsJson, @isBuiltin, @version, @createdAt, @updatedAt)
    `).run({ ...record, fieldsJson: JSON.stringify(record.fields), isBuiltin: record.isBuiltin ? 1 : 0 })
    return record
  }

  list(input: { category?: string; limit?: number; offset?: number } = {}) {
    const rows = this.db.prepare(`
      SELECT * FROM templates
      WHERE (@category IS NULL OR category = @category)
      ORDER BY is_builtin DESC, updated_at DESC, id ASC
      LIMIT @limit OFFSET @offset
    `).all({
      category: input.category ?? null,
      limit: clampInteger(input.limit, 50, 1, 200),
      offset: clampInteger(input.offset, 0, 0, 100_000),
    }) as TemplateRow[]
    return rows.map(mapTemplate)
  }

  getById(id: string) {
    const row = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined
    return row ? mapTemplate(row) : null
  }

  remove(id: string) {
    const result = this.db.prepare('DELETE FROM templates WHERE id = ?').run(id)
    return result.changes === 1
  }

  /** 回填模板封面素材 id（内置模板 seed 参考图后调用）。 */
  setCoverAssetId(id: string, coverAssetId: string | null) {
    const result = this.db
      .prepare('UPDATE templates SET cover_asset_id = @coverAssetId, updated_at = @updatedAt WHERE id = @id')
      .run({ id, coverAssetId, updatedAt: new Date().toISOString() })
    return result.changes === 1
  }
}

function mapTemplate(row: TemplateRow): TemplateRecord {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    coverAssetId: row.cover_asset_id,
    promptTemplate: row.prompt_template,
    fields: parseArray(row.fields_json),
    isBuiltin: row.is_builtin === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value)) return fallback
  return Math.min(maximum, Math.max(minimum, value as number))
}
