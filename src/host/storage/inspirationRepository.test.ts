import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { InspirationRepository } from './inspirationRepository'

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
  const root = join(tmpdir(), `paipiange-inspiration-test-${randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root, seedBuiltin: false })
}

describe('InspirationRepository', () => {
  it('creates an inspiration with defaults (category fallback, non-builtin)', async () => {
    const storage = await openTemporaryStorage()
    const repo = new InspirationRepository(storage.db)

    const created = repo.create({ title: '  灵感  ', description: '描述', promptTemplate: 'p', category: '', tags: ['a'] })
    const fetched = repo.getById(created.id)

    expect(fetched).not.toBeNull()
    expect(fetched!.title).toBe('灵感') // trimmed
    expect(fetched!.category).toBe('通用')
    expect(fetched!.isBuiltin).toBe(false)
    expect(fetched!.tags).toEqual(['a'])
    expect(fetched!.coverAssetId).toBeNull()
    storage.close()
  })

  it('tolerates a missing category (undefined) and falls back to 通用', async () => {
    const storage = await openTemporaryStorage()
    const repo = new InspirationRepository(storage.db)

    const created = repo.create({ title: '无分类灵感', description: 'd', promptTemplate: 'p' })
    expect(created.category).toBe('通用')
    expect(repo.getById(created.id)!.category).toBe('通用')
    storage.close()
  })

  it('rejects an empty title', async () => {
    const storage = await openTemporaryStorage()
    const repo = new InspirationRepository(storage.db)

    expect(() => repo.create({ title: '   ', description: 'd', promptTemplate: 'p', category: '文章' })).toThrow('灵感标题不能为空')
    storage.close()
  })

  it('filters list by category', async () => {
    const storage = await openTemporaryStorage()
    const repo = new InspirationRepository(storage.db)

    repo.create({ title: '甲', description: 'd', promptTemplate: 'p', category: '文章' })
    repo.create({ title: '乙', description: 'd', promptTemplate: 'p', category: '标题' })

    expect(repo.list({ category: '文章' })).toHaveLength(1)
    expect(repo.list()).toHaveLength(2)
    storage.close()
  })

  it('getById returns null for an unknown id', async () => {
    const storage = await openTemporaryStorage()
    const repo = new InspirationRepository(storage.db)

    expect(repo.getById('missing')).toBeNull()
    storage.close()
  })

  it('remove deletes the inspiration', async () => {
    const storage = await openTemporaryStorage()
    const repo = new InspirationRepository(storage.db)

    const created = repo.create({ title: '灵感', description: 'd', promptTemplate: 'p', category: '文章' })
    expect(repo.remove(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeNull()
    storage.close()
  })
})
