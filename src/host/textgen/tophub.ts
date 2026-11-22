/**
 * tophub.today（今日热榜）聚合站点的 Host 端代理。
 *
 * tophub.today 聚合全网热榜（微博、知乎、抖音、微信、百度、B站、36氪等）。
 * Host 端代理是为了规避浏览器跨域限制，并在服务端解析 HTML 后统一返回
 * 结构化数据给前端消费。
 *
 * 重要：tophub 首页 https://tophub.today/ 体积达 ~1.3MB（内嵌了全部 80+ 节点
 * 的热榜预览），实测下载耗时 60~90 秒，远超合理超时。因此节点列表改为
 * **内置常量**（BUILTIN_NODES，定期人工同步），详情页按需抓取（~90KB，
 * 实测 2~3 秒，可接受）。
 *
 * 站点结构：
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

const TOPHUB_NODE = 'https://tophub.today/n/'
const TOPHUB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/**
 * 内置热榜节点列表（id / 名称 / 榜单名）。源自 tophub.today 首页解析，
 * hashid 相对稳定，此处内置以避免抓取体积巨大且极慢的首页。
 * 当 tophub 新增/调整节点时，人工更新此列表即可。
 */
const BUILTIN_NODES: Array<{ id: string; name: string; board?: string }> = [
  { id: 'KqndgxeLl9', name: '微博', board: '热搜榜' },
  { id: 'mproPpoq6O', name: '知乎', board: '热榜' },
  { id: 'WnBe01o371', name: '微信', board: '24h热文榜' },
  { id: 'Jb0vmloB1G', name: '百度', board: '实时热点' },
  { id: 'DpQvNABoNE', name: '抖音', board: '总榜' },
  { id: '74KvxwokxM', name: '哔哩哔哩', board: '全站日榜' },
  { id: 'Q1Vd5Ko85R', name: '36氪', board: '24小时热榜' },
  { id: 'MZd7PrPerO', name: '快手', board: '实时热榜' },
  { id: '12owgX0oNV', name: '腾讯新闻', board: '热问' },
  { id: 'G47o8weMmN', name: '虎扑社区', board: '步行街热帖' },
  { id: 'X12owXzvNV', name: '雪球', board: '今日话题' },
  { id: 'G2me3ndwjq', name: '华尔街见闻', board: '日排行' },
  { id: '0MdKam4ow1', name: '第一财经', board: '新闻排行周榜' },
  { id: 'rx9ozj7oXb', name: '新浪财经新闻', board: '点击量排行' },
  { id: 'Y2KeDGQdNP', name: '少数派', board: '热门文章' },
  { id: '5VaobgvAj1', name: '虎嗅网', board: '热文' },
  { id: '74Kvx59dkx', name: 'IT之家', board: '日榜' },
  { id: 'DOvnNz1vEB', name: '机器之心', board: '文章库' },
  { id: 'MZd7azPorO', name: '量子位', board: '每日最新' },
  { id: 'rYqoXz8dOD', name: '掘金', board: '人工智能本周最热' },
  { id: 'b0vmrPldB1', name: 'Readhub', board: 'AI' },
  { id: '20MdKx4ew1', name: '人人都是产品经理', board: '日榜' },
  { id: 'LBwdG0jePx', name: 'Product Hunt', board: '今日新产品' },
  { id: 'rYqoXQ8vOD', name: 'GitHub', board: 'Trending Today' },
  { id: 'DgeyrgMoZq', name: 'CSDN博客', board: '综合热榜' },
  { id: 'rYqoXZzdOD', name: '开源中国', board: '热门资讯' },
  { id: 'Om4ejxvxEN', name: '百度贴吧', board: '热议榜' },
  { id: 'qENeYpdY49', name: 'AcFun', board: '全站综合榜' },
  { id: 'NKGoRAzel6', name: '吾爱破解', board: '今日热帖' },
  { id: 'rDgeyqeZqJ', name: '水木社区', board: '十大热门话题' },
  { id: 'KMZd7VOvrO', name: '知乎日报', board: 'Today' },
  { id: 'KqndgDmeLl', name: '开眼视频', board: '日报' },
  { id: 'KMZd7X3erO', name: '历史上的今天', board: 'Today' },
  { id: 'mDOvnyBoEB', name: '豆瓣电影', board: '豆瓣新片榜' },
  { id: '9JndkpJe3V', name: '猫眼', board: '国内票房榜' },
  { id: 'VaobbkqoAj', name: 'IMDb', board: '热门电影榜' },
  { id: '4KvxEX0dkx', name: '微信读书', board: '总榜' },
  { id: 'QaqeEage9R', name: '当当', board: '畅销图书榜' },
  { id: '6ARe1k2v7n', name: 'TapTap', board: '排行榜' },
  { id: 'YqoXQR0vOD', name: '3DM游戏网', board: '最新新闻' },
  { id: 'wWmoOVYe4E', name: '机核网', board: '每日最新' },
  { id: 'qENeYQReY4', name: 'Apple Music', board: '歌曲排行' },
  { id: 'wkvlEXBdz1', name: 'QQ音乐', board: '热歌榜' },
  { id: 'wWmoOqYd4E', name: '新浪体育新闻', board: '点击量排行' },
  { id: '3adqqzadng', name: '抖音', board: '体育榜' },
  { id: 'n3moBE1eN5', name: '懂球帝', board: '今日头条' },
  { id: 'VaobJ88oAj', name: '站酷', board: '作品总榜' },
  { id: 'MZd7PAxerO', name: 'UI 中国', board: '推荐文章' },
  { id: 'Q0or4Wnd8B', name: '优设网', board: '每日热文榜单' },
  { id: 'b0vm7lAeB1', name: 'Behance', board: 'Featured Projects' },
  { id: '4anopWBelZ', name: 'App Store', board: '中国 iPhone 免费榜' },
  { id: 'Jndkp4ye3V', name: '爱范儿', board: 'AppSolution' },
  { id: 'YqoXQGXvOD', name: '汽车之家', board: '论坛精选日报' },
  { id: 'RrvW7XDv5z', name: '懂车帝', board: '文章排行榜' },
  { id: 'yjvQDpjobg', name: '淘宝 ‧ 天猫', board: '热销总榜' },
  { id: 'YqoXzV6dOD', name: '京东', board: '热销总榜' },
  { id: 'x9ozqX7eXb', name: '今日热卖', board: '全网线报聚合' },
  { id: 'n3moB3EvN5', name: '先知社区', board: '精华推荐' },
  { id: 'qYwv4MNdPa', name: '安全客', board: '最新' },
  { id: 'WYKd6pzoaP', name: 'FreeBuf', board: '最新' },
]

/** 返回内置热榜节点列表（同步、零网络请求）。 */
export function listTophubNodes(): TophubNode[] {
  return BUILTIN_NODES.map((n) => ({
    id: n.id,
    name: n.name,
    board: n.board,
    link: `${TOPHUB_NODE}${n.id}`,
  }))
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
  const timer = setTimeout(() => controller.abort(), 20_000)
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
