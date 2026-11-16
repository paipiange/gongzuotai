import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { TemplateRepository } from './templateRepository'

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
  const root = join(tmpdir(), `paipiange-template-test-${randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}

describe('TemplateRepository', () => {
  it('creates a template with defaults (category fallback, version 1, non-builtin)', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TemplateRepository(storage.db)

    const created = repo.create({ category: '', name: '  模板  ', promptTemplate: '你是一个助手' })
    const fetched = repo.getById(created.id)

    expect(fetched).not.toBeNull()
    expect(fetched!.name).toBe('模板') // trimmed
    expect(fetched!.category).toBe('通用') // fallback
    expect(fetched!.version).toBe(1)
    expect(fetched!.isBuiltin).toBe(false)
    expect(fetched!.fields).toEqual([])
    storage.close()
  })

  it('rejects an empty name', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TemplateRepository(storage.db)

    expect(() => repo.create({ category: '文章', name: '   ', promptTemplate: 'p' })).toThrow('模板名称不能为空')
    storage.close()
  })

  it('rejects an empty prompt template', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TemplateRepository(storage.db)

    expect(() => repo.create({ category: '文章', name: 'n', promptTemplate: '' })).toThrow('模板提示词不能为空')
    storage.close()
  })

  it('filters list by category and orders builtin templates first', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TemplateRepository(storage.db)

    repo.create({ category: '文章', name: '普通模板', promptTemplate: 'p' })
    repo.create({ category: '文章', name: '内置模板', promptTemplate: 'p', isBuiltin: true })
    repo.create({ category: '标题', name: '别的分类', promptTemplate: 'p' })

    expect(repo.list({ category: '文章' })).toHaveLength(2)
    expect(repo.list({ category: '文章' })[0].name).toBe('内置模板')
    expect(repo.list()).toHaveLength(3)
    storage.close()
  })

  it('getById returns null for an unknown id', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TemplateRepository(storage.db)

    expect(repo.getById('missing')).toBeNull()
    storage.close()
  })

  it('remove deletes the template', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TemplateRepository(storage.db)

    const created = repo.create({ category: '文章', name: '模板', promptTemplate: 'p' })
    expect(repo.remove(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeNull()
    storage.close()
  })
})
