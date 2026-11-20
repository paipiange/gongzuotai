import { describe, it, expect } from 'vitest'
import { parseDirectorScript } from './directorService'
import { loadStyleLibrary, getStyle, findStyle, styleToPrompt, listStyles } from './styles'

describe('directorService.parseDirectorScript', () => {
  it('解析合法的多幕脚本 JSON', () => {
    const json = JSON.stringify({
      logline: '一句话梗概',
      scenes: [
        { no: 1, type: 'hook', title: '开头钩子', subtitle: '', visual: '视觉', camera: 'push', durationSec: 3, narration: '旁白' },
        { no: 2, type: 'turn', title: '转折', subtitle: '', visual: '视觉', camera: 'pan', durationSec: 4, narration: '' },
      ],
    })
    const r = parseDirectorScript(json, { topic: 't', durationSec: 7 })
    expect(r).not.toBeNull()
    expect(r!.scenes).toHaveLength(2)
    expect(r!.totalDurationSec).toBe(7)
    expect(r!.scenes[0].type).toBe('hook')
  })

  it('容忍 Markdown 围栏与前后杂文', () => {
    const json = '```json\n' + JSON.stringify({ scenes: [{ no: 1, title: 'x', durationSec: 2 }] }) + '\n```'
    const r = parseDirectorScript(json, { topic: 't', durationSec: 2 })
    expect(r).not.toBeNull()
    expect(r!.scenes).toHaveLength(1)
  })

  it('无效文本返回 null', () => {
    expect(parseDirectorScript('不是 JSON', { topic: 't', durationSec: 2 })).toBeNull()
  })
})

describe('styles 风格库', () => {
  it('加载 99 种风格', () => {
    const lib = loadStyleLibrary()
    expect(Object.keys(lib.styles).length).toBeGreaterThanOrEqual(99)
    expect(lib.categories.length).toBeGreaterThanOrEqual(15)
  })

  it('按 id 与中文名查询', () => {
    expect(getStyle('ink-wash')?.cn).toBe('中国水墨')
    expect(findStyle('霓虹灯管')?.id).toBe('neon-tubes')
    expect(findStyle('Neon Tubes')?.id).toBe('neon-tubes')
  })

  it('精写风格有完整规则，轻量风格有 essence', () => {
    const ink = getStyle('ink-wash')!
    expect(ink.essenceTraits.length).toBeGreaterThan(0)
    expect(ink.colorLogic.length).toBeGreaterThan(0)
    // 轻量风格（如 art-deco）至少有 essence 和 uses
    const deco = getStyle('art-deco')!
    expect(deco.essence.length).toBeGreaterThan(0)
    expect(deco.uses.length).toBeGreaterThan(0)
  })

  it('styleToPrompt 生成可注入的约束文本', () => {
    const ink = getStyle('ink-wash')!
    const p = styleToPrompt(ink)
    expect(p).toContain('中国水墨')
    expect(p).toContain('色彩逻辑')
  })

  it('listStyles 返回全部风格', () => {
    expect(listStyles().length).toBeGreaterThanOrEqual(99)
  })
})
