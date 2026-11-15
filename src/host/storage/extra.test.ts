import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { AssetRepository } from './assetRepository'
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

  it('exports platform-adapted plain text (title cap + hashtags + markdown strip)', async () => {
    const storage = await openTemporaryStorage()
    const service = new ExportService(storage.paths)
    const content = {
      title: '一个非常长的标题超过了二十个字的限制测试用例',
      bodyMd: '# 副标题\n**加粗**正文 [链接](https://x) 和 `代码`',
      topic: '春日 野餐 露营',
    }

    // 小红书：标题截断到 20 字 + 话题标签。
    const xhs = service.exportForPlatform(content, 'xiaohongshu')
    const xhsText = readFileSync(service.resolveAbsolute(xhs.relativePath), 'utf-8')
    expect(xhsText).toContain('…')
    expect(xhsText).toContain('#春日')
    expect(xhsText).not.toContain('**')
    expect(xhsText).not.toContain('[链接](https://x)')

    // 头条：标题 + 分隔线，无话题。
    const tt = service.exportForPlatform(content, 'toutiao')
    const ttText = readFileSync(service.resolveAbsolute(tt.relativePath), 'utf-8')
    expect(ttText).toContain('——————')
    expect(ttText).not.toContain('#')

    storage.close()
  })

  it('soft-deletes assets so they leave the list but the row persists', async () => {
    const storage = await openTemporaryStorage()
    const repo = new AssetRepository(storage.db, storage.paths)
    // Insert a row directly to avoid the file-system write of `save`, which on
    // Windows can leave the SQLite WAL file briefly locked during teardown.
    const id = crypto.randomUUID()
    storage.db.prepare(`
      INSERT INTO assets (id, kind, name, mime_type, relative_path, size_bytes, width, height, tags_json, source_creation_id, created_at)
      VALUES (?, 'image', 'test.png', 'image/png', 'images/test.png', 4, null, null, '[]', null, ?)
    `).run(id, new Date().toISOString())
    expect(repo.list()).toHaveLength(1)

    expect(repo.softDelete(id)).toBe(true)
    expect(repo.list()).toHaveLength(0)
    // Soft-deleting an already-deleted asset is a no-op (returns false).
    expect(repo.softDelete(id)).toBe(false)

    storage.close()
  })

  it('stores and filters creation tags', async () => {
    const storage = await openTemporaryStorage()
    const repo = new CreationRepository(storage.db)
    const a = repo.create({ type: 'article', title: '带标签 A', tags: ['品牌', '春日'] })
    repo.create({ type: 'article', title: '带标签 B', tags: ['营销'] })

    expect(repo.getById(a.id)?.tags).toEqual(['品牌', '春日'])

    // AND semantics: both tags must match.
    expect(repo.list({ tags: ['品牌'] })).toHaveLength(1)
    expect(repo.list({ tags: ['品牌', '春日'] })).toHaveLength(1)
    expect(repo.list({ tags: ['品牌', '营销'] })).toHaveLength(0)

    // Updating tags replaces the list.
    repo.update(a.id, { tags: ['新品'] })
    expect(repo.getById(a.id)?.tags).toEqual(['新品'])
    expect(repo.list({ tags: ['春日'] })).toHaveLength(0)

    storage.close()
  })

  it('updates asset tags in place', async () => {
    const storage = await openTemporaryStorage()
    const repo = new AssetRepository(storage.db, storage.paths)
    const id = crypto.randomUUID()
    storage.db.prepare(`
      INSERT INTO assets (id, kind, name, mime_type, relative_path, size_bytes, width, height, tags_json, source_creation_id, created_at)
      VALUES (?, 'image', 'test.png', 'image/png', 'images/test.png', 4, null, null, '["旧标签"]', null, ?)
    `).run(id, new Date().toISOString())

    expect(repo.updateTags(id, ['新标签', '春日'])).toBe(true)
    expect(repo.list()[0].tags).toEqual(['新标签', '春日'])
    expect(repo.list(undefined, 100, 0, ['春日'])).toHaveLength(1)
    expect(repo.list(undefined, 100, 0, ['不存在'])).toHaveLength(0)

    storage.close()
  })

  it('writes saved images under media/images with a matching relative path', async () => {
    const storage = await openTemporaryStorage()
    const repo = new AssetRepository(storage.db, storage.paths)

    const saved = repo.save({ kind: 'image', name: 'pic.png', mimeType: 'image/png', data: Buffer.from('fake-png-bytes') })

    // relativePath 必须带 media/ 前缀，与 StoragePaths.images 对齐，
    // 否则写入目录与读取目录错位会触发 ENOENT（回归 bug）。
    expect(saved.relativePath.startsWith('media/images/')).toBe(true)

    const absolute = repo.resolveAbsolutePath(saved)
    expect(existsSync(absolute)).toBe(true)
    expect(readFileSync(absolute, 'utf-8')).toBe('fake-png-bytes')

    // 读回记录也应指向同一路径。
    expect(repo.getById(saved.id)?.relativePath).toBe(saved.relativePath)

    storage.close()
  })
})

async function openTemporaryStorage() {
  const root = join(tmpdir(), `paipiange-extra-test-${crypto.randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}
