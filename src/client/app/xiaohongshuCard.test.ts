import { describe, expect, it } from 'vitest'
import { CARD_HEIGHT, CARD_WIDTH, splitCardLines } from './xiaohongshuCard'

describe('splitCardLines', () => {
  it('wraps long text into multiple lines', () => {
    const lines = splitCardLines('一二三四五六七八九十', 5, 3)
    expect(lines).toEqual(['一二三四五', '六七八九十'])
  })

  it('truncates overly long text with an ellipsis', () => {
    const lines = splitCardLines('一二三四五六七八九十', 3, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it('collapses whitespace', () => {
    expect(splitCardLines(' 一   二  三 ', 10, 2)).toEqual(['一二三'])
  })

  it('returns empty array for empty input', () => {
    expect(splitCardLines('', 10, 2)).toEqual([])
  })
})

describe('card constants', () => {
  it('uses a 3:4 portrait aspect ratio', () => {
    expect(CARD_WIDTH / CARD_HEIGHT).toBeCloseTo(0.75, 2)
  })
})
