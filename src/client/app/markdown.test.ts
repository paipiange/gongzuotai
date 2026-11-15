import { describe, expect, it } from 'vitest'
import { applyMarkdownAction, renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders headings, emphasis, links and escapes raw HTML', () => {
    const html = renderMarkdown('# 标题\n\n**加粗** 和 *斜体* 和 [链接](https://x.com)\n\n<script>alert(1)</script>')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<a href="https://x.com" target="_blank" rel="noreferrer">链接</a>')
    // Raw HTML is escaped, never injected.
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('renders blockquote, lists and horizontal rule', () => {
    const html = renderMarkdown('> 引用\n\n- 甲\n- 乙\n\n1. 一\n2. 二\n\n---')
    expect(html).toContain('<blockquote>引用</blockquote>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>甲</li>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>一</li>')
    expect(html).toContain('<hr />')
  })
})

describe('applyMarkdownAction', () => {
  it('wraps the selection for bold', () => {
    const result = applyMarkdownAction('hello world', 0, 5, 'bold')
    expect(result.value).toBe('**hello** world')
    expect(result.selectionStart).toBe(2)
    expect(result.selectionEnd).toBe(7)
  })

  it('uses fallback text when nothing is selected', () => {
    const result = applyMarkdownAction('', 0, 0, 'bold')
    expect(result.value).toBe('**加粗文字**')
  })

  it('builds a link around the selection', () => {
    const result = applyMarkdownAction('点击 这里 查看', 3, 5, 'link')
    expect(result.value).toBe('点击 [这里](https://) 查看')
  })
})
