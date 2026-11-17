import { describe, expect, it } from 'vitest'
import { buildWechatArticleHtml, buildWechatArticlePlainText } from './wechatHtml'

describe('buildWechatArticleHtml', () => {
  it('包含标题与正文，且标题用内联样式', () => {
    const html = buildWechatArticleHtml({ title: '春日故事', content: '第一段' })
    expect(html).toContain('春日故事')
    expect(html).toContain('第一段')
    expect(html).toContain('font-size:24px')
  })

  it('Markdown 语法被渲染为内联样式标签', () => {
    const html = buildWechatArticleHtml({ title: 'T', content: '## 小标题\n\n**加粗**文字' })
    expect(html).toContain('<h2 style="font-size:20px')
    expect(html).toContain('<strong style="color:#8c5a2b')
  })

  it('转义标题中的 HTML，防止注入', () => {
    const html = buildWechatArticleHtml({ title: '<script>alert(1)</script>', content: 'x' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('正文中的危险脚本被转义', () => {
    const html = buildWechatArticleHtml({ title: 'T', content: '<img src=x onerror=alert(1)>' })
    // < 与 > 已被转义为实体，因此不会产生可执行的标签。
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
  })

  it('可选眉题与底部署名生效', () => {
    const html = buildWechatArticleHtml({ title: 'T', content: 'x', eyebrow: '品牌故事', footer: '署名' })
    expect(html).toContain('品牌故事')
    expect(html).toContain('署名')
  })
})

describe('buildWechatArticlePlainText', () => {
  it('生成纯文本兜底', () => {
    const text = buildWechatArticlePlainText({ title: '标题', content: '正文' })
    expect(text).toContain('标题')
    expect(text).toContain('正文')
  })
})
