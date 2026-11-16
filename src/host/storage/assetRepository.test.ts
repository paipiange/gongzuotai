import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetRepository } from './assetRepository'
import { CreationRepository } from './creationRepository'
import { PaipiangeDatabase } from './database'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true })
  }
})

async function openTemporaryStorage() {
  const root = join(tmpdir(), `paipiange-asset-test-${crypto.randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}

describe('AssetRepository disk cleanup', () => {
  it('hardDelete removes the file from disk and the row', async () => {
    const storage = await openTemporaryStorage()
    const repo = new AssetRepository(storage.db, storage.paths)
    const saved = repo.save({ kind: 'image', name: 'x.png', mimeType: 'image/png', data: Buffer.from('png-bytes') })
    const absolute = repo.resolveAbsolutePath(saved)
    expect(existsSync(absolute)).toBe(true)

    expect(repo.hardDelete(saved.id)).toBe(true)
    expect(existsSync(absolute)).toBe(false)
    expect(repo.getById(saved.id)).toBeNull()
    expect(repo.hardDelete(saved.id)).toBe(false)
    storage.close()
  })

  it('purgeDeleted empties the trash and frees bytes', async () => {
    const storage = await openTemporaryStorage()
    const repo = new AssetRepository(storage.db, storage.paths)
    const a = repo.save({ kind: 'image', name: 'a.png', mimeType: 'image/png', data: Buffer.alloc(1000) })
    const b = repo.save({ kind: 'image', name: 'b.png', mimeType: 'image/png', data: Buffer.alloc(2000) })
    repo.softDelete(a.id)
    repo.softDelete(b.id)
    expect(repo.countDeleted()).toEqual({ count: 2, freedBytes: 3000 })

    const result = repo.purgeDeleted()
    expect(result.count).toBe(2)
    expect(result.freedBytes).toBe(3000)
    expect(repo.countDeleted()).toEqual({ count: 0, freedBytes: 0 })
    expect(existsSync(repo.resolveAbsolutePath(a))).toBe(false)
    expect(existsSync(repo.resolveAbsolutePath(b))).toBe(false)
    storage.close()
  })

  it('listOrphans excludes images referenced by a creation cover or a graphic session', async () => {
    const storage = await openTemporaryStorage()
    const repo = new AssetRepository(storage.db, storage.paths)
    const creations = new CreationRepository(storage.db)

    const orphan = repo.save({ kind: 'image', name: 'orphan.png', mimeType: 'image/png', data: Buffer.alloc(10) })
    const covered = repo.save({ kind: 'image', name: 'covered.png', mimeType: 'image/png', data: Buffer.alloc(20) })
    const inSession = repo.save({ kind: 'image', name: 'session.png', mimeType: 'image/png', data: Buffer.alloc(30) })

    creations.create({ type: 'image', title: '带封面', coverAssetId: covered.id })
    storage.db.prepare(`
      INSERT INTO graphic_sessions (id, source_text, topic, page_count, text_pick, image_pick, storyboard_json, pages_json, session_id, updated_at)
      VALUES ('current', '', '', 1, '', '', NULL, ?, '', ?)
    `).run(JSON.stringify([{ page: {}, assetId: inSession.id }]), new Date().toISOString())

    const orphans = repo.listOrphans()
    expect(orphans.ids).toEqual([orphan.id])
    expect(orphans.freedBytes).toBe(10)
    storage.close()
  })
})
