/**
 * 首页默认远程轮播图：复用已开源的模板封面图，托管在 GitHub 公开仓库
 * （paipiange/gongzuotai）的 raw 地址，通过 jsDelivr CDN 加速访问。
 *
 * 这些图片不进插件包（瘦包），首页 <img> 直接引用远程地址；加载失败时
 * Hero 会自动跳过该张（onError 隐藏），且第一张永远是内置 base64 兜底图
 * （HERO_BG），保证首页不空白。
 */

const CDN = 'https://cdn.jsdelivr.net/gh/paipiange/gongzuotai@main'
const DIR = 'src/host/assets/template-covers'

/** 生成仓库内相对路径的 jsDelivr 完整 URL。 */
export function remoteImageUrl(urlPath: string): string {
  return `${CDN}/${urlPath}`
}

/** 默认远程轮播图：复用内置模板封面（横版 banner 会以「封面裁剪」方式显示）。 */
export const DEFAULT_REMOTE_CAROUSEL: string[] = [
  `${DIR}/longform_writing.png`,
  `${DIR}/product_launch.png`,
  `${DIR}/video_script.png`,
  `${DIR}/wechat_comment.png`,
  `${DIR}/wechat_deep_read.png`,
  `${DIR}/xhs_grass.jpg`,
  `${DIR}/xhs_tips.png`,
  `${DIR}/zhihu_answer.png`,
].map(remoteImageUrl)
