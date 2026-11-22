import { describe, expect, it } from 'vitest'
import { RECAST_SPECS, buildRecastPrompt, recastSpecOf } from './recast'

describe('recast', () => {
  it('提供三种目标平台', () => {
    expect(RECAST_SPECS.map((s) => s.id)).toEqual(['xiaohongshu', 'zhihu', 'toutiao'])
  })

  it('构造改稿提示词时包含原文与平台指令', () => {
    const prompt = buildRecastPrompt('这是一段原文内容。', 'zhihu')
    expect(prompt).toContain('这是一段原文内容。')
    expect(prompt).toContain('知乎回答')
  })

  it('未知平台回退为原文', () => {
    expect(buildRecastPrompt('原文', 'unknown' as never)).toBe('原文')
  })

  it('recastSpecOf 能取到对应规格', () => {
    expect(recastSpecOf('xiaohongshu')?.label).toBe('转小红书')
    expect(recastSpecOf('toutiao')?.instruction).toContain('今日头条')
  })
})
