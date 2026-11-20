import { describe, expect, it } from 'vitest'
import {
  buildComicImagePrompt,
  extractPlaceholders,
  fillTemplate,
  isComicTemplate,
  isImageTemplate,
  resolveComicOverlayText,
} from './templateUtils'

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

describe('buildComicImagePrompt', () => {
  it('女主模式生成精简的单图提示词，不再要求输出分镜方案', () => {
    const prompt = buildComicImagePrompt('做人最重要的是开心', 'female')
    expect(prompt).toContain('做人最重要的是开心')
    expect(prompt).toContain('只画女主一人')
    expect(prompt).toContain('只生成一张独立图片')
    expect(prompt).not.toContain('男主一人')
    expect(prompt).not.toContain('请先输出逐页分镜方案')
    expect(prompt.length).toBeLessThan(600)
  })

  it('男女同框模式明确只画两位固定角色', () => {
    const prompt = buildComicImagePrompt('周末散步', 'both')
    expect(prompt).toContain('固定男女主两人同框')
  })

  it('要求把指定中文逐字画进系列图片', () => {
    const prompt = buildComicImagePrompt('开心生活', 'female', {
      overlayText: '做人最重要的是开心',
      imageIndex: 2,
      imageCount: 4,
    })
    expect(prompt).toContain('第 2/4 张')
    expect(prompt).toContain('中文文字：「做人最重要的是开心」')
    expect(prompt).toContain('逐字准确')
    expect(prompt).not.toContain('画面不要出现任何文字')
  })
})

describe('resolveComicOverlayText', () => {
  it('留空时使用主题作为图片标题', () => {
    expect(resolveComicOverlayText('', '做人最重要的是开心', 1)).toBe('做人最重要的是开心')
  })

  it('单行文字复用于每张图片', () => {
    expect(resolveComicOverlayText('今天也要开心', '主题', 3)).toBe('今天也要开心')
  })

  it('多行文字按图片序号匹配，缺失时回退主题', () => {
    const text = '第一张\n第二张'
    expect(resolveComicOverlayText(text, '默认主题', 2)).toBe('第二张')
    expect(resolveComicOverlayText(text, '默认主题', 3)).toBe('默认主题')
  })
})
