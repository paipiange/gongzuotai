/**
 * Graphic studio (公众号) APIs: storyboard 拆页 + backend-persisted session.
 */

import { apiFetch } from './client'
import type { GraphicSession, GraphicSessionPage, StoryboardResult } from './types'

/** 调用文本模型把素材拆成多页图文分镜。 */
export async function generateStoryboard(input: {
  sourceText?: string
  extractedImageText?: string
  topic?: string
  pageCount?: number
  platform?: string
  provider?: string
  model?: string
  baseUrl?: string
  apiKey?: string
  backendId?: string
}): Promise<StoryboardResult> {
  const data = await apiFetch<{ storyboard: StoryboardResult }>('.storyboard', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.storyboard
}

// ---- Graphic studio session persistence ----

interface RawGraphicSession {
  sourceText: string
  topic: string
  pageCount: number
  textPick: string
  imagePick: string
  storyboardJson: string | null
  pagesJson: string
  sessionId: string
}

function parseStoryboardJson(raw: string | null): StoryboardResult | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && Array.isArray((value as StoryboardResult).pages)
      ? (value as StoryboardResult)
      : null
  } catch {
    return null
  }
}

function parsePagesJson(raw: string): GraphicSessionPage[] {
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value.filter((p): p is GraphicSessionPage => !!p && typeof p === 'object' && !!(p as GraphicSessionPage).page)
  } catch {
    return []
  }
}

/** 读取当前公众号会话（无会话时返回 null）。 */
export async function getGraphicSession(): Promise<GraphicSession | null> {
  const data = await apiFetch<{ session: RawGraphicSession | null }>('.graphic.session')
  const raw = data.session
  if (!raw) return null
  return {
    sourceText: raw.sourceText,
    topic: raw.topic,
    pageCount: raw.pageCount,
    textPick: raw.textPick,
    imagePick: raw.imagePick,
    storyboard: parseStoryboardJson(raw.storyboardJson),
    pages: parsePagesJson(raw.pagesJson),
    sessionId: raw.sessionId,
  }
}

/** 保存公众号会话（UPSERT）。 */
export async function saveGraphicSession(session: GraphicSession): Promise<void> {
  await apiFetch<{ ok: boolean }>('.graphic.session', {
    method: 'PUT',
    body: JSON.stringify({
      sourceText: session.sourceText,
      topic: session.topic,
      pageCount: session.pageCount,
      textPick: session.textPick,
      imagePick: session.imagePick,
      storyboardJson: session.storyboard ? JSON.stringify(session.storyboard) : null,
      pagesJson: JSON.stringify(session.pages),
      sessionId: session.sessionId,
    }),
  })
}

/** 清除公众号会话。 */
export async function clearGraphicSession(): Promise<void> {
  await apiFetch<{ ok: boolean }>('.graphic.session', { method: 'DELETE' })
}
