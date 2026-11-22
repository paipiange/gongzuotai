/**
 * tophub.today（今日热榜）聚合站点的 Host 端代理。
 *
 * tophub.today 聚合全网热榜（微博、知乎、抖音、微信、百度、B站、36氪等）。
 * Host 端代理是为了规避浏览器跨域限制，并在服务端解析 HTML 后统一返回
 * 结构化数据给前端消费。
 *
 * 站点结构：
 * - 首页 https://tophub.today/ ：每个热榜节点是一个 div.cc-cd，包含平台名
 *   （.cc-cd-lb span）、榜单名（.cc-cd-sb-st），详情链接 /n/{hashid}。
 * - 详情页 https://tophub.today/n/{hashid} ：一个 <table class="table">，每行
 *   <tr> 含排名（td[1]）、标题链接（td[2] > a，带 itemid）、热度（td.ws）。
 */

/** 单个热榜节点（平台/榜单，用于前端下拉选择）。 */
export interface TophubNode {
  id: string
  name: string
  /** 榜单名（如「热搜榜」「总榜」「24小时热文榜」），可能为空。 */
  board?: string
  link: string
}

/** 单个热榜条目（裁剪后的前端消费结构）。 */
export interface TophubItem {
  id: string
  title: string
  rank: number
  /** 热度原始文本，如「188万」「1.2亿」，可能为空。 */
  heat: string
  link: string
  /** 来源节点名称。 */
  node: string
}

const TOPHUB_HOME = 'https://tophub.today/'
const TOPHUB_NODE = 'https://tophub.today/n/'
const TOPHUB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/** 拉取首页，解析所有热榜节点。失败抛错。 */
export async function fetchTophubNodes(): Promise<TophubNode[]> {
  const html = await fetchText(TOPHUB_HOME)
  return parseNodes(html)
}

/** 拉取某个热榜节点的条目列表。失败抛错。 */
export async function fetchTophubItems(nodeId: string): Promise<TophubItem[]> {
  const url = `${TOPHUB_NODE}${encodeURIComponent(nodeId)}`
  const html = await fetchText(url)
  const items = parseItems(html, nodeId)
  if (items.length === 0) {
    throw new Error('未能解析到热榜内容，节点可能已失效')
  }
  return items
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': TOPHUB_USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`tophub 返回 HTTP ${response.status}`)
    }
    return await response.text()
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new Error('拉取 tophub 超时，请稍后重试')
    }
    throw cause instanceof Error ? cause : new Error(String(cause))
  } finally {
    clearTimeout(timer)
  }
}

/** 从首页 HTML 解析热榜节点列表。 */
export function parseNodes(html: string): TophubNode[] {
  const nodes: TophubNode[] = []
  const seen = new Set<string>()
  // 每个节点块：<div class="cc-cd" id="node-XXX">…</div>，其中包含详情链接 /n/{hashid}
  const blockRe = /<div class="cc-cd" id="node-[\d]+">([\s\S]*?)(?=<div class="cc-cd" id="node-|\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/g
  for (const match of html.matchAll(blockRe)) {
    const block = match[1]
    const linkMatch = block.match(/<a href="\/n\/([A-Za-z0-9]+)"/)
    if (!linkMatch) continue
    const id = linkMatch[1]
    if (seen.has(id)) continue
    // 平台名：<div class="cc-cd-lb">…<span>平台名</span>…</div>
    const nameMatch = block.match(/<div class="cc-cd-lb">[\s\S]*?<span>([\s\S]*?)<\/span>/)
    if (!nameMatch) continue
    const name = decodeHtml(nameMatch[1]).trim()
    if (!name) continue
    // 榜单名：<span class="cc-cd-sb-st">榜单名</span>
    const boardMatch = block.match(/<span class="cc-cd-sb-st">([\s\S]*?)<\/span>/)
    const board = boardMatch ? decodeHtml(boardMatch[1]).trim() : undefined
    seen.add(id)
    nodes.push({ id, name, board, link: `https://tophub.today/n/${id}` })
  }
  return nodes
}

/** 从详情页 HTML 解析条目列表。 */
export function parseItems(html: string, nodeId: string): TophubItem[] {
  const items: TophubItem[] = []
  // 每条：<tr><td align="center">1.</td><td><a href="…" itemid="…">标题</a></td><td class="ws">热度</td>…
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g
  for (const match of html.matchAll(rowRe)) {
    const row = match[1]
    const rankMatch = row.match(/<td[^>]*>([\d]+)\.<\/td>/)
    if (!rankMatch) continue
    const titleMatch = row.match(/<td><a [^>]*itemid="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/td>/)
    if (!titleMatch) continue
    const rank = Number(rankMatch[1])
    const title = decodeHtml(titleMatch[2]).trim()
    if (!title) continue
    const href = titleMatch[0].match(/href="([^"]+)"/)
    const heatMatch = row.match(/<td class="ws">([\s\S]*?)<\/td>/)
    const heat = heatMatch ? decodeHtml(heatMatch[1]).trim() : ''
    items.push({
      id: `${nodeId}-${rank}`,
      title,
      rank,
      heat,
      link: href ? href[1] : `https://tophub.today/n/${nodeId}`,
      node: nodeId,
    })
  }
  return items
}

/** 解码常见 HTML 实体。 */
function decodeHtml(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}
