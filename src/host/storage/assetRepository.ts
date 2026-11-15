import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
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
    const directory = input.kind === 'image' ? 'images' : 'uploads'
    const relativePath = join(directory, `${id}${extension}`)
    const absolutePath = resolvePrivatePath(this.paths.root, relativePath)
    mkdirSync(this.paths[dimeDirectory(directory)], { recursive: true })
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

  list(kind?: AssetKind, limit = 100, offset = 0, tags?: string[]) {
    const requiredTags = tags?.map((t) => t.trim()).filter(Boolean) ?? []
    const rows = this.db.prepare(`
      SELECT * FROM assets
      WHERE (@kind IS NULL OR kind = @kind) AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `).all({ kind: kind ?? null, limit, offset }) as AssetRow[]
    const mapped = rows.map(mapAsset)
    if (!requiredTags.length) return mapped
    return mapped.filter((record) => requiredTags.every((tag) => record.tags.includes(tag)))
  }

  listByCreation(creationId: string) {
    const rows = this.db.prepare(`
      SELECT * FROM assets
      WHERE source_creation_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `).all(creationId) as AssetRow[]
    return rows.map(mapAsset)
  }

  /** Soft-delete an asset (marks deleted_at, keeps the row and file on disk). */
  softDelete(id: string): boolean {
    const result = this.db.prepare(
      'UPDATE assets SET deleted_at = @now WHERE id = @id AND deleted_at IS NULL',
    ).run({ id, now: new Date().toISOString() })
    return result.changes === 1
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

function dimeDirectory(directory: string): 'images' | 'uploads' {
  return directory === 'images' ? 'images' : 'uploads'
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
