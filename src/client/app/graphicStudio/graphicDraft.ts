/**
 * 公众号创作工作台的本地草稿持久化。
 *
 * 目的：生图/拆页前后，用户离开页面（组件卸载）再返回时，自动恢复上次的
 * 素材、主题、拆页结果和每页已生成的 asset id，避免「白干 + 生成孤儿图片」。
 *
 * 只存引用（assetId），不存图片二进制——图片本身已由 Host 落盘到 assets 表，
 * 恢复后通过 assetUrl(id) 即可重新加载。
 *
 * 持久化字段里刻意不含 `busy`（进行中的瞬态），避免恢复后所有页卡在
 * 「生成中」的假状态。进行中的任务结果仍可能丢失（见组件注释）。
 */

import type { StoryboardPage, StoryboardResult } from '../hostClient'

/** 单页草稿（与组件 PageRecord 相比，剥离了 busy 瞬态）。 */
export interface DraftPage {
  page: StoryboardPage
  assetId?: string
  error?: string
}

export interface GraphicDraft {
  version: 1
  sourceText: string
  topic: string
  pageCount: number
  textPick: string
  imagePick: string
  storyboard: StoryboardResult | null
  pages: DraftPage[]
}

const STORAGE_KEY = 'paipiange.graphic.draft.v1'

/** 序列化为 JSON（供 localStorage 存储）。 */
export function serializeDraft(draft: GraphicDraft): string {
  return JSON.stringify(draft)
}

function isValidPage(value: unknown): value is DraftPage {
  return !!value && typeof value === 'object' && !!(value as DraftPage).page && typeof (value as DraftPage).page === 'object'
}

/**
 * 解析草稿 JSON，容忍任何损坏/结构不符：解析失败、version 不匹配、字段缺失
 * 一律回退为默认值或 null，绝不抛异常。
 */
export function parseDraft(raw: string): GraphicDraft | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<GraphicDraft> & { pages?: unknown; storyboard?: unknown }
    if (!data || typeof data !== 'object' || data.version !== 1) return null
    const pages = Array.isArray(data.pages) ? data.pages.filter(isValidPage) : []
    const storyboard =
      data.storyboard && typeof data.storyboard === 'object' && Array.isArray((data.storyboard as StoryboardResult).pages)
        ? (data.storyboard as StoryboardResult)
        : null
    return {
      version: 1,
      sourceText: typeof data.sourceText === 'string' ? data.sourceText : '',
      topic: typeof data.topic === 'string' ? data.topic : '',
      pageCount: typeof data.pageCount === 'number' && data.pageCount > 0 ? Math.floor(data.pageCount) : 4,
      textPick: typeof data.textPick === 'string' ? data.textPick : '',
      imagePick: typeof data.imagePick === 'string' ? data.imagePick : '',
      storyboard,
      pages,
    }
  } catch {
    return null
  }
}

/** 保存草稿（隐私模式 / 配额满等失败时静默忽略）。 */
export function saveGraphicDraft(draft: GraphicDraft): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeDraft(draft))
  } catch {
    // 忽略存储失败，不打断用户操作
  }
}

/** 读取草稿；不存在或损坏时返回 null。 */
export function loadGraphicDraft(): GraphicDraft | null {
  try {
    return parseDraft(localStorage.getItem(STORAGE_KEY) ?? '')
  } catch {
    return null
  }
}

/** 清除草稿。 */
export function clearGraphicDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
