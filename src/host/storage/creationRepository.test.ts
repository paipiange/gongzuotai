import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { CreationRepository } from './creationRepository'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(root, { recursive: true, force: true })
        lastError = undefined
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) throw lastError
  }
})

async function openTemporaryStorage() {
  const root = join(tmpdir(), `paipiange-creation-test-${randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}

describe('CreationRepository', () => {
  it('creates a draft with defaults and round-trips via getById', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)

    const created = repo.create({ type: 'article', title: '  标题  ', bodyMd: '正文', tags: ['a'] })
    const fetched = repo.getById(created.id)

    expect(fetched).not.toBeNull()
    expect(fetched!.title).toBe('标题') // trimmed
    expect(fetched!.status).toBe('draft')
    expect(fetched!.source).toBe('user')
    expect(fetched!.isFavorite).toBe(false)
    expect(fetched!.deletedAt).toBeNull()
    expect(fetched!.tags).toEqual(['a'])
    expect(fetched!.bodyMd).toBe('正文')
    storage.close()
  })

  it('softDelete hides the record from default reads but includeDeleted retrieves it', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)

    const created = repo.create({ type: 'article', title: 'A' })
    expect(repo.softDelete(created.id)).toBe(true)

    expect(repo.getById(created.id)).toBeNull()
    expect(repo.getById(created.id, true)!.deletedAt).not.toBeNull()
    expect(repo.list()).toHaveLength(0)
    expect(repo.list({ includeDeleted: true })).toHaveLength(1)
    storage.close()
  })

  it('restore clears deletedAt and returns the record to the default list', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)

    const created = repo.create({ type: 'article', title: 'A' })
    repo.softDelete(created.id)
    expect(repo.restore(created.id)).toBe(true)

    expect(repo.getById(created.id)!.deletedAt).toBeNull()
    expect(repo.list()).toHaveLength(1)
    storage.close()
  })

  it('update only changes provided fields and can null out a cover asset', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)

    const created = repo.create({ type: 'article', title: 'A', bodyMd: 'old', coverAssetId: 'cov' })
    const updated = repo.update(created.id, { title: 'B', coverAssetId: null })

    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('B')
    expect(updated!.bodyMd).toBe('old') // untouched
    expect(updated!.coverAssetId).toBeNull() // explicitly cleared
    storage.close()
  })

  it('filters list by status, type, query and tags (AND semantics)', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)

    repo.create({ type: 'article', title: '文章甲', status: 'draft', tags: ['a', 'b'] })
    repo.create({ type: 'title', title: '标题乙', status: 'queued', tags: ['a'] })

    expect(repo.list({ status: 'draft' })).toHaveLength(1)
    expect(repo.list({ type: 'title' })).toHaveLength(1)
    expect(repo.list({ query: '文章' })).toHaveLength(1)
    expect(repo.list({ tags: ['a', 'b'] })).toHaveLength(1) // only 文章甲 has both
    storage.close()
  })

  it('remove physically deletes the creation and its revision history', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)

    const created = repo.create({ type: 'article', title: 'A' })
    repo.saveRevision(created.id, 'v1')
    expect(repo.remove(created.id)).toBe(true)

    expect(repo.getById(created.id, true)).toBeNull()
    expect(repo.listRevisions(created.id)).toHaveLength(0)
    storage.close()
  })

  it('saveRevision increments revision numbers and listRevisions returns newest first', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)

    const created = repo.create({ type: 'article', title: 'A' })
    const r1 = repo.saveRevision(created.id, 'v1')
    const r2 = repo.saveRevision(created.id, 'v2')

    expect(r1.revisionNo).toBe(1)
    expect(r2.revisionNo).toBe(2)
    expect(repo.listRevisions(created.id).map((r) => r.revisionNo)).toEqual([2, 1])
    storage.close()
  })

  it('rejects an unsupported creation type', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)

    expect(() => repo.create({ type: 'bogus' as never })).toThrow('Unsupported creation type')
    storage.close()
  })
})
