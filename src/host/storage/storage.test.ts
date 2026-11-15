import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { CreationRepository } from './creationRepository'
import { PaipiangeDatabase } from './database'
import { getSchemaVersion, latestSchemaVersion } from './migrations'
import { resolvePrivatePath } from './paths'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true })
  }
})

describe('Host SQLite storage', () => {
  it('creates the private directory structure and migrates the complete schema', async () => {
    const storage = await openTemporaryStorage()
    expect(getSchemaVersion(storage.db)).toBe(latestSchemaVersion)
    expect(existsSync(storage.paths.database)).toBe(true)
    expect(existsSync(storage.paths.images)).toBe(true)
    expect(existsSync(storage.paths.uploads)).toBe(true)
    expect(existsSync(storage.paths.backups)).toBe(true)

    const tables = storage.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map((row) => (row as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining([
      'app_settings',
      'assets',
      'creation_revisions',
      'creations',
      'inspirations',
      'publish_items',
      'tasks',
      'templates',
      'usage_records',
    ]))
    storage.close()
  })

  it('persists, searches, updates, versions, soft-deletes and restores creations', async () => {
    const storage = await openTemporaryStorage()
    const repository = new CreationRepository(storage.db)
    const created = repository.create({
      type: 'article',
      title: '匿名春日草稿',
      summary: '用于自动化测试的公开虚构内容',
      bodyMd: '江南春日的虚构品牌故事。',
      params: { style: 'poetic' },
    })

    expect(repository.getById(created.id)).toMatchObject({ title: '匿名春日草稿', status: 'draft' })
    expect(repository.list({ query: '春日' })).toHaveLength(1)
    expect(repository.list({ query: '%' })).toHaveLength(0)

    const updated = repository.update(created.id, { status: 'queued', bodyMd: '第二版虚构草稿。', isFavorite: true })
    expect(updated).toMatchObject({ status: 'queued', bodyMd: '第二版虚构草稿。', isFavorite: true })

    const firstRevision = repository.saveRevision(created.id, created.bodyMd)
    const secondRevision = repository.saveRevision(created.id, updated?.bodyMd ?? '')
    expect([firstRevision.revisionNo, secondRevision.revisionNo]).toEqual([1, 2])
    expect(repository.listRevisions(created.id).map((item) => item.revisionNo)).toEqual([2, 1])

    expect(repository.softDelete(created.id)).toBe(true)
    expect(repository.getById(created.id)).toBeNull()
    expect(repository.getById(created.id, true)?.deletedAt).toBeTruthy()
    expect(repository.restore(created.id)).toBe(true)
    expect(repository.getById(created.id)?.deletedAt).toBeNull()

    // Hard delete physically removes the row and its revision history.
    expect(repository.remove(created.id)).toBe(true)
    expect(repository.getById(created.id, true)).toBeNull()
    expect(repository.listRevisions(created.id)).toHaveLength(0)
    expect(repository.remove(created.id)).toBe(false)
    storage.close()
  })

  it('never creates a video generation record', async () => {
    const storage = await openTemporaryStorage()
    const repository = new CreationRepository(storage.db)
    expect(() => repository.create({ type: 'video-placeholder' as never, title: '不可保存的视频任务' })).toThrow('Unsupported creation type')
    expect(repository.list({ includeDeleted: true })).toHaveLength(0)
    storage.close()
  })

  it('creates a consistent SQLite backup without exposing it outside the backup root', async () => {
    const storage = await openTemporaryStorage()
    const repository = new CreationRepository(storage.db)
    repository.create({ type: 'article', title: '备份验收草稿' })

    const backup = await storage.createBackup()
    expect(existsSync(backup.path)).toBe(true)
    expect(backup.path.startsWith(storage.paths.backups)).toBe(true)

    const backupDb = new Database(backup.path, { readonly: true })
    const count = backupDb.prepare('SELECT COUNT(*) AS count FROM creations').get() as { count: number }
    expect(count.count).toBe(1)
    backupDb.close()
    storage.close()
  })

  it('rejects absolute paths and traversal outside the private data root', () => {
    const root = join(tmpdir(), 'paipiange-path-test')
    expect(() => resolvePrivatePath(root, '../outside.txt')).toThrow()
    expect(() => resolvePrivatePath(root, 'nested/../../outside.txt')).toThrow()
    expect(() => resolvePrivatePath(root, 'C:\\private.txt')).toThrow()
    expect(resolvePrivatePath(root, 'media/example.txt')).toBe(join(root, 'media', 'example.txt'))
  })
})

async function openTemporaryStorage() {
  const root = join(tmpdir(), `paipiange-test-${crypto.randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}
