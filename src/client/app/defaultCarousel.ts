/**
 * 首页默认远程轮播图：专属的首页轮播图（2508×627 横版，人物右侧 + 左侧留白），
 * 托管在 GitHub 公开仓库（paipiange/gongzuotai）的 raw 地址，经 jsDelivr CDN 加速。
 *
 * 这些图片不进插件包（瘦包），首页 <img> 直接引用远程地址；加载失败时 Hero 会
 * 自动跳过该张（onError 隐藏），且第一张永远是内置 base64 兜底图（HERO_BG）。
 *
 * 注意：首页轮播图 ≠ 模板封面图。模板封面图（src/host/assets/template-covers/）
 * 是各模板的缩略图，走 host 侧 remoteAssets 下载缓存；这里的 carousel 图是首页
 * 专属 banner，走前端 jsDelivr 直接引用。
 */

const CDN = 'https://cdn.jsdelivr.net/gh/paipiange/gongzuotai@main'
const DIR = 'src/host/assets/carousel'

/** 生成仓库内相对路径的 jsDelivr 完整 URL。 */
export function remoteImageUrl(urlPath: string): string {
  return `${CDN}/${urlPath}`
}

/** 默认远程轮播图：首页专属 banner（4:1 横版，随 includeDefault 开关一起纳入轮播）。 */
export const DEFAULT_REMOTE_CAROUSEL: string[] = [
  `${DIR}/01_hello_kitty.png`,
  `${DIR}/02_restaurant.png`,
  `${DIR}/03_fitness.png`,
  `${DIR}/04_taupe_outfit.png`,
  `${DIR}/05_cat_ears.png`,
].map(remoteImageUrl)
