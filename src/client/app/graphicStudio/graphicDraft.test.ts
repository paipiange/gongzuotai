import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearGraphicDraft, loadGraphicDraft, parseDraft, saveGraphicDraft, serializeDraft, type DraftPage, type GraphicDraft } from './graphicDraft'

const samplePage = {
  page_no: 1,
  page_type: '封面',
  title: '秋天的第一杯奶茶',
  subtitle: '3 步搞定，暖到心里',
  layout_id: 'hero',
  facts_used: ['f1'],
  visual_brief: '少女手捧奶茶',
  disclaimer: '',
}

function makeDraft(overrides: Partial<GraphicDraft> = {}): GraphicDraft {
  return {
    version: 1,
    sourceText: '素材',
    topic: '主题',
    pageCount: 4,
    textPick: 'backend-2::grok-4.5',
    imagePick: 'backend-1::gpt-image-2.5-flare',
    storyboard: { topic: '主题', facts: [], pages: [samplePage], computed: { sum_yuan: null, target_yuan: null, difference_yuan: null }, warnings: [] },
    pages: [{ page: samplePage, assetId: 'asset-1' }],
    ...overrides,
  }
}

function makeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('serializeDraft / parseDraft', () => {
  it('round-trips a full draft', () => {
    const draft = makeDraft()
    const parsed = parseDraft(serializeDraft(draft))
    expect(parsed).toEqual(draft)
  })

  it('returns null for empty / corrupted JSON', () => {
    expect(parseDraft('')).toBeNull()
    expect(parseDraft('not json')).toBeNull()
    expect(parseDraft('{"version":')).toBeNull()
    expect(parseDraft('null')).toBeNull()
  })

  it('returns null when version mismatches', () => {
    expect(parseDraft(JSON.stringify({ ...makeDraft(), version: 2 }))).toBeNull()
  })

  it('defaults missing fields safely', () => {
    const parsed = parseDraft(JSON.stringify({ version: 1 }))
    expect(parsed).not.toBeNull()
    expect(parsed!.sourceText).toBe('')
    expect(parsed!.topic).toBe('')
    expect(parsed!.pageCount).toBe(4)
    expect(parsed!.textPick).toBe('')
    expect(parsed!.imagePick).toBe('')
    expect(parsed!.storyboard).toBeNull()
    expect(parsed!.pages).toEqual([])
  })

  it('coerces a non-array pages field to an empty array', () => {
    const parsed = parseDraft(JSON.stringify({ version: 1, pages: 'oops' }))
    expect(parsed!.pages).toEqual([])
  })

  it('filters out invalid page entries', () => {
    const good: DraftPage = { page: samplePage, assetId: 'a1' }
    const parsed = parseDraft(JSON.stringify({ version: 1, pages: [good, null, 42, { noPage: true }] }))
    expect(parsed!.pages).toHaveLength(1)
    expect(parsed!.pages[0].assetId).toBe('a1')
  })

  it('clamps a non-positive pageCount to the default', () => {
    const parsed = parseDraft(JSON.stringify({ version: 1, pageCount: 0 }))
    expect(parsed!.pageCount).toBe(4)
  })
})

describe('saveGraphicDraft / loadGraphicDraft / clearGraphicDraft', () => {
  it('persists and restores through localStorage', () => {
    vi.stubGlobal('localStorage', makeStorage())
    const draft = makeDraft()
    saveGraphicDraft(draft)
    expect(loadGraphicDraft()).toEqual(draft)
    clearGraphicDraft()
    expect(loadGraphicDraft()).toBeNull()
  })

  it('returns null when localStorage is absent', () => {
    // 不 stub localStorage，node 环境无此全局，loadGraphicDraft 应吞掉异常返回 null
    expect(loadGraphicDraft()).toBeNull()
  })
})
