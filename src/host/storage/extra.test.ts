import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { CreationRepository } from './creationRepository'
import { TemplateRepository } from './templateRepository'
import { InspirationRepository } from './inspirationRepository'
import { PublishRepository } from './publishRepository'
import { ExportService } from './exportService'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (!root.startsWith(tmpdir())) continue
    // better-sqlite3 in WAL mode may briefly hold a handle on Windows; retry
    // the cleanup so a transient EBUSY does not fail an otherwise-green test.
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

describe('templates, inspirations, publish and export', () => {
  it('persists and lists templates', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TemplateRepository(storage.db)
    const created = repo.create({ category: '小红书', name: '爆款封面', promptTemplate: '生成 {topic} 的封面', fields: [{ key: 'topic' }] })
    expect(created.name).toBe('爆款封面')
    expect(repo.list()).toHaveLength(1)
    expect(repo.list({ category: '小红书' })).toHaveLength(1)
    expect(repo.list({ category: '公众号' })).toHaveLength(0)
    expect(repo.getById(created.id)?.promptTemplate).toContain('{topic}')
    expect(repo.remove(created.id)).toBe(true)
    expect(repo.getById(created.id)).toBeNull()
    storage.close()
  })

  it('persists and lists inspirations', async () => {
    const storage = await openTemporaryStorage()
    const repo = new InspirationRepository(storage.db)
    const created = repo.create({ title: '春日灵感', description: '测试灵感', promptTemplate: '写一段春日散文', category: '文章', tags: ['春天', '散文'] })
    expect(created.tags).toEqual(['春天', '散文'])
    expect(repo.list()).toHaveLength(1)
    expect(repo.getById(created.id)?.title).toBe('春日灵感')
    storage.close()
  })

  it('persists and transitions publish items', async () => {
    const storage = await openTemporaryStorage()
    const creations = new CreationRepository(storage.db)
    const creation = creations.create({ type: 'article', title: '发布验收草稿' })
    const repo = new PublishRepository(storage.db)
    const created = repo.create({ creationId: creation.id, platform: 'wechat' })
    expect(created.status).toBe('draft')
    const updated = repo.update(created.id, { status: 'published', externalUrl: 'https://example.com/a' })
    expect(updated?.status).toBe('published')
    expect(updated?.publishedAt).toBeTruthy()
    expect(repo.list({ status: 'published' })).toHaveLength(1)
    expect(repo.list({ status: 'draft' })).toHaveLength(0)
    expect(repo.remove(created.id)).toBe(true)
    storage.close()
  })

  it('exports markdown, html and zip bundles to the exports directory', async () => {
    const storage = await openTemporaryStorage()
    const service = new ExportService(storage.paths)
    const content = { title: '测试 文章/标题', bodyMd: '# 标题\n正文', bodyHtml: '<h1>标题</h1><p>正文</p>' }

    const md = service.export(content, 'markdown')
    expect(md.fileName).toBe('测试-文章-标题.md')
    expect(existsSync(service.resolveAbsolute(md.relativePath))).toBe(true)

    const html = service.export(content, 'html')
    expect(html.fileName.endsWith('.html')).toBe(true)

    const zip = service.export(content, 'zip')
    expect(zip.fileName.endsWith('.zip')).toBe(true)
    // ZIP magic bytes "PK"
    const bytes = readFileSync(service.resolveAbsolute(zip.relativePath))
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)

    storage.close()
  })
})

async function openTemporaryStorage() {
  const root = join(tmpdir(), `paipiange-extra-test-${crypto.randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}
