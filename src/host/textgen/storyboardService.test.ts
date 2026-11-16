import { describe, expect, it } from 'vitest'
import { parseStoryboard } from './storyboardService'

const validResult = {
  topic: '38.8万彩礼能买什么',
  facts: [
    { id: 'f1', label: '彩礼', raw_amount: '38.8万', amount_yuan: 388000, unit: '元', source_fragment: '原文片段', needs_review: false },
  ],
  pages: [
    { page_no: 1, page_type: 'cover', title: '封面', subtitle: '副标题', layout_id: 'cover_big_number', facts_used: ['f1'], visual_brief: '插画描述', disclaimer: '' },
  ],
  computed: { sum_yuan: 388000, target_yuan: null, difference_yuan: null },
  warnings: [],
}

describe('parseStoryboard', () => {
  it('parses a clean JSON result', () => {
    const result = parseStoryboard(JSON.stringify(validResult))
    expect(result).not.toBeNull()
    expect(result!.topic).toBe('38.8万彩礼能买什么')
    expect(result!.facts).toHaveLength(1)
    expect(result!.facts[0].amount_yuan).toBe(388000)
    expect(result!.pages).toHaveLength(1)
    expect(result!.pages[0].title).toBe('封面')
  })

  it('tolerates Markdown code fences and surrounding prose', () => {
    const text = '好的，以下是分镜：\n```json\n' + JSON.stringify(validResult) + '\n```\n希望有帮助'
    const result = parseStoryboard(text)
    expect(result).not.toBeNull()
    expect(result!.pages).toHaveLength(1)
    expect(result!.facts[0].id).toBe('f1')
  })

  it('returns null on non-JSON text', () => {
    expect(parseStoryboard('这不是 JSON')).toBeNull()
    expect(parseStoryboard('')).toBeNull()
  })

  it('tolerates missing/partial fields with safe defaults', () => {
    const result = parseStoryboard(JSON.stringify({
      facts: [{ id: 'f1' }],
      pages: [{ page_no: 2, title: '内容页' }],
    }))
    expect(result).not.toBeNull()
    expect(result!.facts[0].label).toBe('')
    expect(result!.facts[0].amount_yuan).toBeNull()
    expect(result!.facts[0].unit).toBe('元')
    expect(result!.pages[0].subtitle).toBe('')
    expect(result!.pages[0].facts_used).toEqual([])
    expect(result!.computed).toEqual({ sum_yuan: null, target_yuan: null, difference_yuan: null })
    expect(result!.warnings).toEqual([])
  })

  it('filters pages without page_no or any content', () => {
    const result = parseStoryboard(JSON.stringify({
      pages: [
        { page_no: 0, title: '无效页号' },
        { page_no: 1, title: '' },
        { page_no: 2, title: '有效页' },
      ],
    }))
    expect(result).not.toBeNull()
    expect(result!.pages).toHaveLength(1)
    expect(result!.pages[0].page_no).toBe(2)
  })

  it('coerces amount_yuan to number or null', () => {
    const result = parseStoryboard(JSON.stringify({
      facts: [{ id: 'f1', amount_yuan: 100 }, { id: 'f2', amount_yuan: 'not-a-number' }],
      pages: [{ page_no: 1, title: 't' }],
    }))
    expect(result).not.toBeNull()
    expect(result!.facts[0].amount_yuan).toBe(100)
    expect(result!.facts[1].amount_yuan).toBeNull()
  })

  it('normalizes facts_used to string array and needs_review to boolean', () => {
    const result = parseStoryboard(JSON.stringify({
      facts: [{ id: 'f1', needs_review: 'yes' }],
      pages: [{ page_no: 1, title: 't', facts_used: [1, 'f1', 2] }],
    }))
    expect(result).not.toBeNull()
    expect(result!.facts[0].needs_review).toBe(true)
    expect(result!.pages[0].facts_used).toEqual(['1', 'f1', '2'])
  })
})
