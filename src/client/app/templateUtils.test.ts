import { describe, expect, it } from 'vitest'
import { extractPlaceholders, fillTemplate, isComicTemplate, isImageTemplate } from './templateUtils'

describe('extractPlaceholders', () => {
  it('提取所有 {{占位符}}，去重并保序', () => {
    const tpl = '为 {{品牌}} 写一篇关于 {{主题}} 的文章，突出 {{品牌}} 的卖点'
    expect(extractPlaceholders(tpl)).toEqual(['品牌', '主题'])
  })

  it('忽略占位符内多余空格', () => {
    expect(extractPlaceholders('{{ 品牌 }} 与 {{主题}}')).toEqual(['品牌', '主题'])
  })

  it('无占位符返回空数组', () => {
    expect(extractPlaceholders('这是一段普通文本')).toEqual([])
  })

  it('空字符串返回空数组', () => {
    expect(extractPlaceholders('')).toEqual([])
  })
})

describe('fillTemplate', () => {
  it('用字段值替换占位符', () => {
    expect(fillTemplate('{{品牌}}的{{主题}}', { 品牌: '春日茶铺', 主题: '新品故事' })).toBe('春日茶铺的新品故事')
  })

  it('缺失字段保留原占位符', () => {
    expect(fillTemplate('{{品牌}}的{{主题}}', { 品牌: '春日茶铺' })).toBe('春日茶铺的{{主题}}')
  })

  it('忽略占位符内多余空格并正确替换', () => {
    expect(fillTemplate('{{ 品牌 }}', { 品牌: 'A' })).toBe('A')
  })
})

describe('isImageTemplate', () => {
  it('漫画/图片/插画/绘图归为图片类', () => {
    expect(isImageTemplate('漫画')).toBe(true)
    expect(isImageTemplate('图片生成')).toBe(true)
    expect(isImageTemplate('插画')).toBe(true)
    expect(isImageTemplate('绘图')).toBe(true)
  })

  it('其余分类归为文本类', () => {
    expect(isImageTemplate('文章创作')).toBe(false)
    expect(isImageTemplate('营销文案')).toBe(false)
  })
})

describe('isComicTemplate', () => {
  it('分类或名称含「漫画」即视为漫画模板', () => {
    expect(isComicTemplate('漫画', '')).toBe(true)
    expect(isComicTemplate('图片', 'Q版情侣漫画')).toBe(true)
  })

  it('非漫画返回 false', () => {
    expect(isComicTemplate('图片生成', '春日海报')).toBe(false)
  })
})
