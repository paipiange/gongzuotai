import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStoragePaths } from './paths'
import { ExportService, buildPlatformText, type ExportableContent } from './exportService'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true })
  }
})

function newService(): ExportService {
  const root = join(tmpdir(), `paipiange-export-${Math.random().toString(36).slice(2)}`)
  temporaryRoots.push(root)
  return new ExportService(resolveStoragePaths(root))
}

describe('buildPlatformText', () => {
  it('caps a long xiaohongshu title at 20 chars with an ellipsis', () => {
    const title = 'A'.repeat(30)
    const text = buildPlatformText({ title, bodyMd: '正文' }, 'xiaohongshu')
    expect(text.startsWith(`${'A'.repeat(20)}…`)).toBe(true)
    expect(text).not.toContain(title)
    expect(text).toContain('正文')
  })

  it('keeps a short xiaohongshu title intact and dedupes hashtags', () => {
    const text = buildPlatformText(
      { title: '短标题', bodyMd: '正文', tags: ['教程', '#教程', 'AI', ''] },
      'xiaohongshu',
    )
    expect(text.startsWith('短标题')).toBe(true)
    // tags 去重（去 # 前缀），空串被忽略
    expect(text).toContain('#教程')
    expect(text).toContain('#AI')
    expect(text.match(/#教程/g)).toHaveLength(1)
  })

  it('synthesizes topic keywords as hashtags when no explicit tags are given', () => {
    const text = buildPlatformText({ title: '标题', bodyMd: '正文', topic: '春季穿搭, 通勤 风格' }, 'xiaohongshu')
    expect(text).toContain('#春季穿搭')
    expect(text).toContain('#通勤')
  })

  it('zhihu keeps title then body then hashtags', () => {
    const text = buildPlatformText({ title: '标题', bodyMd: '正文', tags: ['干货'] }, 'zhihu')
    expect(text.startsWith('标题\n\n正文')).toBe(true)
    expect(text).toContain('#干货')
  })

  it('toutiao separates title and body with a divider and no hashtags', () => {
    const text = buildPlatformText({ title: '标题', bodyMd: '正文', tags: ['干货'] }, 'toutiao')
    expect(text).toContain('——————')
    expect(text).not.toContain('#干货')
  })

  it('wechat and default join title and body with a blank line', () => {
    const wechat = buildPlatformText({ title: '标题', bodyMd: '正文' }, 'wechat')
    expect(wechat).toBe('标题\n\n正文')
    const other = buildPlatformText({ title: '标题', bodyMd: '正文' }, 'other')
    expect(other).toBe('标题\n\n正文')
  })
})

describe('buildPlatformText markdown stripping', () => {
  it('strips headings, emphasis, links, images, lists, quotes and inline code', () => {
    const md = [
      '# 大标题',
      '',
      '**加粗** 和 *斜体* 和 [链接](https://x.com) 和 ![配图](img.png)',
      '',
      '- 列表项',
      '1. 有序项',
      '',
      '> 引用句',
      '',
      '`内联代码`',
    ].join('\n')
    const text = buildPlatformText({ title: 'T', bodyMd: md }, 'wechat')

    expect(text).toContain('大标题')
    expect(text).not.toContain('# 大标题')
    expect(text).toContain('加粗')
    expect(text).not.toContain('**')
    expect(text).toContain('斜体')
    expect(text).toContain('链接')
    expect(text).not.toContain('https://x.com')
    expect(text).toContain('配图')
    expect(text).not.toContain('img.png')
    expect(text).toContain('· 列表项')
    expect(text).toContain('有序项')
    expect(text).toContain('引用句')
    expect(text).toContain('内联代码')
    expect(text).not.toContain('`')
  })
})

describe('ExportService', () => {
  const content: ExportableContent = { title: '测试标题', bodyMd: '# 正文', topic: '话题', tags: ['标签'] }

  it('exports markdown to the private exports directory', () => {
    const service = newService()
    const result = service.export(content, 'markdown')
    expect(result.format).toBe('markdown')
    expect(result.fileName.endsWith('.md')).toBe(true)
    const absolute = service.resolveAbsolute(result.relativePath)
    expect(existsSync(absolute)).toBe(true)
    expect(readFileSync(absolute, 'utf8')).toBe('# 正文')
  })

  it('exports html using bodyHtml when present', () => {
    const service = newService()
    const result = service.export({ ...content, bodyHtml: '<p>hi</p>' }, 'html')
    expect(result.format).toBe('html')
    expect(result.fileName.endsWith('.html')).toBe(true)
    expect(readFileSync(service.resolveAbsolute(result.relativePath), 'utf8')).toBe('<p>hi</p>')
  })

  it('exports a zip bundle containing both markdown and html', () => {
    const service = newService()
    const result = service.export(content, 'zip')
    expect(result.format).toBe('zip')
    expect(result.fileName.endsWith('.zip')).toBe(true)
    const bytes = readFileSync(service.resolveAbsolute(result.relativePath))
    // PK\x03\x04 local file header signature
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes[2]).toBe(0x03)
    expect(bytes[3]).toBe(0x04)
    const text = bytes.toString('utf8')
    expect(text).toContain('测试标题.md')
    expect(text).toContain('测试标题.html')
  })

  it('exports platform-adapted plain text', () => {
    const service = newService()
    const result = service.exportForPlatform(content, 'xiaohongshu')
    expect(result.format).toBe('text')
    expect(result.fileName.endsWith('.txt')).toBe(true)
    const text = readFileSync(service.resolveAbsolute(result.relativePath), 'utf8')
    expect(text).toContain('#标签')
  })

  it('sanitizes illegal characters out of the file name', () => {
    const service = newService()
    const result = service.export({ ...content, title: 'a/b:c*d?' }, 'markdown')
    expect(result.fileName).toBe('a-b-c-d.md')
  })
})
