import { describe, expect, it } from 'vitest'
import { inspectContent } from './contentInspection'

describe('inspectContent', () => {
  it('空内容给出空态且不评分', () => {
    const report = inspectContent('')
    expect(report.charCount).toBe(0)
    expect(report.suggestions.some((s) => s.includes('还没有正文'))).toBe(true)
  })

  it('统计字数、段落数与阅读时长', () => {
    const report = inspectContent('# 标题\n\n这是第一段内容，用来测试字数统计。\n\n这是第二段内容。')
    expect(report.hasHeading).toBe(true)
    expect(report.paragraphCount).toBe(3)
    expect(report.charCount).toBeGreaterThan(0)
    expect(report.readingMinutes).toBeGreaterThanOrEqual(1)
  })

  it('识别常见 AI 腔套话', () => {
    const report = inspectContent('首先，我们要了解一下。综上所述，这个方案是可行的。')
    expect(report.clicheHits).toContain('首先')
    expect(report.clicheHits).toContain('综上所述')
    expect(report.suggestions.some((s) => s.includes('AI 腔'))).toBe(true)
  })

  it('长段落触发拆段建议', () => {
    const longParagraph = '字'.repeat(400)
    const report = inspectContent(longParagraph)
    expect(report.avgParagraphChars).toBeGreaterThan(300)
    expect(report.suggestions.some((s) => s.includes('段落偏长'))).toBe(true)
  })

  it('长文无标题触发小标题建议', () => {
    const body = '内容'.repeat(120)
    const report = inspectContent(body)
    expect(report.hasHeading).toBe(false)
    expect(report.suggestions.some((s) => s.includes('小标题'))).toBe(true)
  })

  it('综合评分落在 0-100 区间', () => {
    const report = inspectContent('# 好文章\n\n这是一段结构清晰、内容充实、没有任何套话的文章，' + '内容'.repeat(150))
    expect(report.score).toBeGreaterThanOrEqual(0)
    expect(report.score).toBeLessThanOrEqual(100)
  })
})
