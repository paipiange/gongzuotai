/**
 * aihot.news 资讯接口的 Host 端代理。
 *
 * aihot 提供匿名 GET API（无需 token），路径 /api/v1/items，返回 AI 领域的
 * 热门资讯/产品/论文等条目。Host 端代理是为了规避浏览器跨域限制，并统一
 * 返回结构给前端消费。
 *
 * 文档：https://aihot.news/agent?tab=api
 */

/** 单个 aihot 资讯条目（裁剪后的前端消费结构）。 */
export interface AihotItem {
  id: string
  title: string
  originalTitle?: string
  summary: string
  source: string
  category: string
  score: number
  publishedAt: string
  link: string
  originalLink?: string
  reason?: string
}

export interface AihotQuery {
  mode?: 'selected' | 'all'
  category?: string
  window?: string
  limit?: number
}

const AIHOT_ENDPOINT = 'https://aihot.news/api/v1/items'
// aihot 官方文档建议携带的 User-Agent。
const AIHOT_USER_AGENT = 'aihot-api/2.0.0 aihot-actor/c0e6810b-0ddd-423e-8549-3a92e358ea61'

interface AihotRawItem {
  id?: string
  title?: string
  originalTitle?: string
  summary?: string
  source?: { name?: string }
  links?: { aihot?: string; original?: string }
  publishedAt?: string
  category?: string
  score?: number
  reason?: string
}

/** 拉取 aihot 资讯列表，返回裁剪后的条目数组。失败抛错。 */
export async function fetchAihotItems(query: AihotQuery = {}): Promise<AihotItem[]> {
  const params = new URLSearchParams()
  params.set('mode', query.mode ?? 'selected')
  params.set('window', query.window ?? '24h')
  if (query.category) params.set('category', query.category)
  if (query.limit) params.set('limit', String(query.limit))

  const url = `${AIHOT_ENDPOINT}?${params.toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': AIHOT_USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`aihot 返回 HTTP ${response.status}`)
    }
    const data = (await response.json()) as { items?: AihotRawItem[] }
    return (data.items ?? []).map(normalize).filter((item): item is AihotItem => item !== null)
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new Error('拉取 aihot 超时，请稍后重试')
    }
    throw cause instanceof Error ? cause : new Error(String(cause))
  } finally {
    clearTimeout(timer)
  }
}

function normalize(raw: AihotRawItem): AihotItem | null {
  if (!raw?.id || !raw?.title) return null
  return {
    id: raw.id,
    title: raw.title,
    originalTitle: raw.originalTitle,
    summary: raw.summary ?? '',
    source: raw.source?.name ?? 'AIHOT',
    category: raw.category ?? 'industry',
    score: raw.score ?? 0,
    publishedAt: raw.publishedAt ?? '',
    link: raw.links?.aihot ?? `https://aihot.news/items/${raw.id}`,
    originalLink: raw.links?.original,
    reason: raw.reason,
  }
}
