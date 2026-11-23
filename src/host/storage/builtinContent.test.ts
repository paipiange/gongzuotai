import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_INSPIRATIONS, BUILTIN_TEMPLATES, seedBuiltinContent } from './builtinContent'
import { PaipiangeDatabase } from './database'
import { InspirationRepository } from './inspirationRepository'
import { TemplateRepository } from './templateRepository'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true })
  }
})

function newRoot(): string {
  const root = join(tmpdir(), `paipiange-seed-test-${randomUUID()}`)
  temporaryRoots.push(root)
  return root
}

describe('内置模板与灵感 seed', () => {
  it('首次建库时写入全部内置模板与灵感，并标记 is_builtin', async () => {
    const storage = await PaipiangeDatabase.open({ dataRoot: newRoot() })

    const templates = storage.db.prepare('SELECT COUNT(*) AS c FROM templates WHERE is_builtin = 1').get() as { c: number }
    const inspirations = storage.db.prepare('SELECT COUNT(*) AS c FROM inspirations WHERE is_builtin = 1').get() as { c: number }

    expect(templates.c).toBe(BUILTIN_TEMPLATES.length)
    expect(inspirations.c).toBe(BUILTIN_INSPIRATIONS.length)
    storage.close()
  })

  it('seed 幂等：重复调用不重复插入', async () => {
    const storage = await PaipiangeDatabase.open({ dataRoot: newRoot() })
    const before = (storage.db.prepare('SELECT COUNT(*) AS c FROM templates').get() as { c: number }).c

    const result = seedBuiltinContent(storage.db)
    expect(result).toEqual({ templates: 0, inspirations: 0 })

    const after = (storage.db.prepare('SELECT COUNT(*) AS c FROM templates').get() as { c: number }).c
    expect(after).toBe(before)
    storage.close()
  })

  it('内置内容标记正确，且不影响用户自定义内容', async () => {
    const storage = await PaipiangeDatabase.open({ dataRoot: newRoot() })
    const templates = new TemplateRepository(storage.db)
    const inspirations = new InspirationRepository(storage.db)

    const userTemplate = templates.create({ category: '我的分类', name: '我的模板', promptTemplate: '自定义 prompt' })
    const userInspiration = inspirations.create({ title: '我的灵感', description: 'd', promptTemplate: 'p', category: '自定义' })
    expect(userTemplate.isBuiltin).toBe(false)
    expect(userInspiration.isBuiltin).toBe(false)

    const templateList = templates.list()
    expect(templateList[0].isBuiltin).toBe(true)
    expect(templateList.some((t) => t.id === userTemplate.id)).toBe(true)

    const inspirationList = inspirations.list()
    // 灵感按创建时间倒序；但用户灵感与内置灵感可能落在同一毫秒，排序不稳，
    // 这里不依赖「排最前」，只验证用户内容存在且未被误标为内置。
    const userInspirationRow = inspirationList.find((i) => i.id === userInspiration.id)
    expect(userInspirationRow).toBeDefined()
    expect(userInspirationRow!.isBuiltin).toBe(false)
    expect(inspirationList.some((i) => i.id === userInspiration.id)).toBe(true)
    storage.close()
  })

  it('重新打开同一库（模拟重启）不重复 seed，用户内容保留', async () => {
    const root = newRoot()

    const first = await PaipiangeDatabase.open({ dataRoot: root })
    const templates = new TemplateRepository(first.db)
    templates.create({ category: '我的分类', name: '我的模板', promptTemplate: '自定义 prompt' })
    first.close()

    const second = await PaipiangeDatabase.open({ dataRoot: root })
    const total = (second.db.prepare('SELECT COUNT(*) AS c FROM templates').get() as { c: number }).c
    expect(total).toBe(BUILTIN_TEMPLATES.length + 1) // 内置 + 1 个用户模板，无重复
    second.close()
  })
})
