import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { StoragePaths } from './paths'
import { resolvePrivatePath } from './paths'

export type AssetKind = 'image' | 'file' | 'prompt' | 'document'

export interface AssetRecord {
  id: string
  kind: AssetKind
  name: string
  mimeType: string
  relativePath: string
  sizeBytes: number
  width: number | null
  height: number | null
  tags: string[]
  sourceCreationId: string | null
  createdAt: string
  deletedAt: string | null
}

export interface SaveAssetInput {
  kind: AssetKind
  name: string
  mimeType: string
  data: Buffer
  width?: number | null
  height?: number | null
  tags?: string[]
  sourceCreationId?: string | null
}

interface AssetRow {
  id: string
  kind: AssetKind
  name: string
  mime_type: string
  relative_path: string
  size_bytes: number
  width: number | null
  height: number | null
  tags_json: string
  source_creation_id: string | null
  created_at: string
  deleted_at: string | null
}

/**
 * Persists binary assets (generated images, uploads) to the private media
 * directory and records metadata in the `assets` table.
 */
export class AssetRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly paths: StoragePaths,
  ) {}

  save(input: SaveAssetInput): AssetRecord {
    const now = new Date().toISOString()
    const id = randomUUID()
    const extension = extensionFor(input.mimeType, input.name)
    // relativePath 必须与 StoragePaths.images/uploads 对齐（含 media/ 前缀），
    // 否则写入目录与读取目录会错位导致 ENOENT。
    const directory = input.kind === 'image' ? 'media/images' : 'media/uploads'
    const relativePath = join(directory, `${id}${extension}`)
    const absolutePath = resolvePrivatePath(this.paths.root, relativePath)
    mkdirSync(resolvePrivatePath(this.paths.root, directory), { recursive: true })
    writeFileSync(absolutePath, input.data)

    const record: AssetRecord = {
      id,
      kind: input.kind,
      name: input.name,
      mimeType: input.mimeType,
      relativePath: relativePath.replace(/\\/g, '/'),
      sizeBytes: input.data.byteLength,
      width: input.width ?? null,
      height: input.height ?? null,
      tags: input.tags ?? [],
      sourceCreationId: input.sourceCreationId ?? null,
      createdAt: now,
      deletedAt: null,
    }

    this.db.prepare(`
      INSERT INTO assets (
        id, kind, name, mime_type, relative_path, size_bytes, width, height,
        tags_json, source_creation_id, created_at
      ) VALUES (
        @id, @kind, @name, @mimeType, @relativePath, @sizeBytes, @width, @height,
        @tagsJson, @sourceCreationId, @createdAt
      )
    `).run({ ...record, tagsJson: JSON.stringify(record.tags) })
    return record
  }

  getById(id: string) {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined
    return row ? mapAsset(row) : null
  }

  /**
   * List non-deleted assets, newest first. Optionally filter by kind, require
   * all of the given tags (AND semantics, matched against the tags JSON), and
   * search by a free-text query (name or tag substring). Tags and query are
   * applied in SQL so `limit`/`offset` paginate the filtered result correctly.
   */
  list(kind?: AssetKind, limit = 100, offset = 0, tags?: string[], query?: string) {
    const requiredTags = tags?.map((t) => t.trim()).filter(Boolean) ?? []
    const q = query?.trim() ?? ''
    let sql = `
      SELECT * FROM assets
      WHERE (@kind IS NULL OR kind = @kind) AND deleted_at IS NULL
        AND (
          @q = ''
          OR name LIKE @qPattern ESCAPE '\\'
          OR tags_json LIKE @qPattern ESCAPE '\\'
        )
    `
    const params: Record<string, unknown> = {
      kind: kind ?? null,
      q,
      qPattern: q ? `%${escapeLike(q)}%` : '',
      limit: Math.min(Math.max(limit, 1), 500),
      offset: Math.max(offset, 0),
    }
    requiredTags.forEach((tag, index) => {
      sql += ` AND tags_json LIKE @tagPattern${index} ESCAPE '\\'`
      params[`tagPattern${index}`] = `%"${escapeLike(tag)}"%`
    })
    sql += ' ORDER BY created_at DESC LIMIT @limit OFFSET @offset'
    const rows = this.db.prepare(sql).all(params) as AssetRow[]
    return rows.map(mapAsset)
  }

  listByCreation(creationId: string) {
    const rows = this.db.prepare(`
      SELECT * FROM assets
      WHERE source_creation_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `).all(creationId) as AssetRow[]
    return rows.map(mapAsset)
  }

  listDeleted(limit = 100) {
    const rows = this.db.prepare(`
      SELECT * FROM assets
      WHERE deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT ?
    `).all(Math.min(Math.max(limit, 1), 500)) as AssetRow[]
    return rows.map(mapAsset)
  }

  /** Soft-delete an asset (marks deleted_at, keeps the row and file on disk). */
  softDelete(id: string): boolean {
    const result = this.db.prepare(
      'UPDATE assets SET deleted_at = @now WHERE id = @id AND deleted_at IS NULL',
    ).run({ id, now: new Date().toISOString() })
    return result.changes === 1
  }

  restore(id: string): boolean {
    return this.db.prepare(
      'UPDATE assets SET deleted_at = NULL WHERE id = @id AND deleted_at IS NOT NULL',
    ).run({ id }).changes === 1
  }

  /**
   * Permanently delete an asset: removes the binary file from disk and the row
   * from the `assets` table (regardless of soft-delete state). Returns false if
   * the asset does not exist.
   */
  hardDelete(id: string): boolean {
    const asset = this.getById(id)
    if (!asset) return false
    const absolute = resolvePrivatePath(this.paths.root, asset.relativePath)
    try {
      if (existsSync(absolute)) unlinkSync(absolute)
    } catch {
      // File may be missing or momentarily locked; the DB row is still removed.
    }
    return this.db.prepare('DELETE FROM assets WHERE id = ?').run(id).changes === 1
  }

  /**
   * Empty the trash: permanently delete every soft-deleted asset (file + row).
   * Returns the number of rows removed and the bytes freed.
   */
  purgeDeleted(): { count: number; freedBytes: number } {
    const rows = this.db.prepare(
      'SELECT id, size_bytes FROM assets WHERE deleted_at IS NOT NULL',
    ).all() as Array<{ id: string; size_bytes: number }>
    let count = 0
    let freedBytes = 0
    for (const row of rows) {
      if (this.hardDelete(row.id)) {
        count += 1
        freedBytes += row.size_bytes
      }
    }
    return { count, freedBytes }
  }

  /** Count soft-deleted assets and their total bytes (does not delete). */
  countDeleted(): { count: number; freedBytes: number } {
    const rows = this.db.prepare(
      'SELECT size_bytes FROM assets WHERE deleted_at IS NOT NULL',
    ).all() as Array<{ size_bytes: number }>
    return {
      count: rows.length,
      freedBytes: rows.reduce((sum, row) => sum + row.size_bytes, 0),
    }
  }

  getStorageUsage(): { activeCount: number; activeBytes: number; byKind: Record<AssetKind, { count: number; bytes: number }> } {
    const rows = this.db.prepare(`
      SELECT kind, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
      FROM assets
      WHERE deleted_at IS NULL
      GROUP BY kind
    `).all() as Array<{ kind: AssetKind; count: number; bytes: number }>
    const byKind: Record<AssetKind, { count: number; bytes: number }> = {
      image: { count: 0, bytes: 0 },
      file: { count: 0, bytes: 0 },
      prompt: { count: 0, bytes: 0 },
      document: { count: 0, bytes: 0 },
    }
    for (const row of rows) byKind[row.kind] = { count: row.count, bytes: row.bytes }
    return {
      activeCount: rows.reduce((sum, row) => sum + row.count, 0),
      activeBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
      byKind,
    }
  }

  findDuplicateStats(): { groupCount: number; duplicateCount: number; duplicateBytes: number } {
    const candidates = this.db.prepare(`
      SELECT * FROM assets
      WHERE deleted_at IS NULL AND size_bytes > 0
        AND size_bytes IN (
          SELECT size_bytes FROM assets
          WHERE deleted_at IS NULL AND size_bytes > 0
          GROUP BY size_bytes HAVING COUNT(*) > 1
        )
      ORDER BY size_bytes, created_at
    `).all() as AssetRow[]
    const groups = new Map<string, AssetRow[]>()
    for (const row of candidates) {
      try {
        const digest = createHash('sha256').update(readFileSync(resolvePrivatePath(this.paths.root, row.relative_path))).digest('hex')
        const key = `${row.size_bytes}:${digest}`
        const group = groups.get(key) ?? []
        group.push(row)
        groups.set(key, group)
      } catch {
        // Missing or locked files are reported by other cleanup checks, not as duplicates.
      }
    }
    const duplicates = [...groups.values()].filter((group) => group.length > 1)
    return {
      groupCount: duplicates.length,
      duplicateCount: duplicates.reduce((sum, group) => sum + group.length - 1, 0),
      duplicateBytes: duplicates.reduce((sum, group) => sum + group[0].size_bytes * (group.length - 1), 0),
    }
  }

  /**
   * Find orphan image assets: non-deleted images that are not referenced by any
   * creation cover nor by the graphic studio session pages. These are typically
   * left behind when a generation finishes after the user navigated away.
   */
  listOrphans(): { ids: string[]; freedBytes: number } {
    const referenced = new Set<string>()
    const coverRows = this.db.prepare(
      'SELECT cover_asset_id FROM creations WHERE cover_asset_id IS NOT NULL',
    ).all() as Array<{ cover_asset_id: string }>
    for (const row of coverRows) referenced.add(row.cover_asset_id)

    for (const table of ['templates', 'inspirations']) {
      const rows = this.db.prepare(`SELECT cover_asset_id FROM ${table} WHERE cover_asset_id IS NOT NULL`).all() as Array<{ cover_asset_id: string }>
      for (const row of rows) referenced.add(row.cover_asset_id)
    }

    const taskRows = this.db.prepare('SELECT input_json, result_json FROM tasks').all() as Array<{ input_json: string; result_json: string }>
    for (const row of taskRows) {
      for (const json of [row.input_json, row.result_json]) {
        for (const match of json.matchAll(/"([0-9a-f-]{36})"/g)) {
          if (match[1]) referenced.add(match[1])
        }
      }
    }

    const sessionRows = this.db.prepare(
      'SELECT pages_json FROM graphic_sessions WHERE pages_json IS NOT NULL',
    ).all() as Array<{ pages_json: string }>
    for (const row of sessionRows) {
      for (const match of row.pages_json.matchAll(/"assetId"\s*:\s*"([0-9a-f-]{36})"/g)) {
        if (match[1]) referenced.add(match[1])
      }
    }

    const imageRows = this.db.prepare(
      "SELECT id, size_bytes FROM assets WHERE kind = 'image' AND deleted_at IS NULL AND source_creation_id IS NULL",
    ).all() as Array<{ id: string; size_bytes: number }>
    const ids: string[] = []
    let freedBytes = 0
    for (const row of imageRows) {
      if (!referenced.has(row.id)) {
        ids.push(row.id)
        freedBytes += row.size_bytes
      }
    }
    return { ids, freedBytes }
  }

  /** Replace an asset's tag list. Returns true if the asset exists. */
  updateTags(id: string, tags: string[]): boolean {
    const result = this.db.prepare(
      'UPDATE assets SET tags_json = @tagsJson WHERE id = @id AND deleted_at IS NULL',
    ).run({ id, tagsJson: JSON.stringify(tags ?? []) })
    return result.changes === 1
  }

  resolveAbsolutePath(asset: AssetRecord): string {
    return resolvePrivatePath(this.paths.root, asset.relativePath)
  }
}

function mapAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    relativePath: row.relative_path,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    tags: parseArray(row.tags_json),
    sourceCreationId: row.source_creation_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
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

function extensionFor(mimeType: string, name: string): string {
  const known = mimeType.split('/')[1]?.toLowerCase()
  if (known === 'png') return '.png'
  if (known === 'jpeg' || known === 'jpg') return '.jpg'
  if (known === 'webp') return '.webp'
  const match = name.match(/\.[a-zA-Z0-9]+$/)
  return match ? match[0].toLowerCase() : '.bin'
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}
