/**
 * 小红书图文卡片渲染（纯前端 Canvas）。
 *
 * 把标题 + 摘要 + 话题标签排版成一张竖版（3:4）暖棕金国风卡片，供创作者
 * 一键导出为图片保存/发布。`splitCardLines` 是纯函数（可单测）；渲染部分
 * 依赖浏览器 Canvas，仅在浏览器环境调用。
 */

export interface XiaohongshuCardInput {
  title: string
  /** 正文/摘要，太长会被截断。 */
  body: string
  /** 话题标签（不带 # 前缀），最多展示 6 个。 */
  tags?: string[]
  /** 底部署名，可选。 */
  footer?: string
}

export const CARD_WIDTH = 900
export const CARD_HEIGHT = 1200

/** 把一段文字按字符宽度折行，返回最多 maxLines 行（超出加省略号）。纯函数。 */
export function splitCardLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  // 中文场景去掉所有空白（中文无需空格分词，保留会影响折行计数）。
  const cleaned = text.replace(/\s+/g, '').trim()
  const characters = Array.from(cleaned)
  const lines: string[] = []
  let current = ''
  for (const character of characters) {
    if (current && current.length + 1 > maxCharsPerLine) {
      lines.push(current)
      current = character
      if (lines.length === maxLines - 1) break
    } else {
      current += character
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  // 若被截断，最后一行加省略号。
  const consumed = lines.join('').length
  if (consumed < characters.length && lines.length) {
    let last = lines[lines.length - 1]
    while (last.length > 1 && last.length + 1 > maxCharsPerLine) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last}…`
  }
  return lines
}

/** 生成小红书竖版卡片，返回 PNG Blob。仅浏览器环境可用。 */
export async function renderXiaohongshuCard(input: XiaohongshuCardInput): Promise<Blob> {
  const width = CARD_WIDTH
  const height = CARD_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  // 暖棕金国风背景（顶部渐变 + 底纹）。
  const background = ctx.createLinearGradient(0, 0, 0, height)
  background.addColorStop(0, '#fdf6ec')
  background.addColorStop(0.45, '#f8ecdc')
  background.addColorStop(1, '#f3e3cd')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  // 顶部装饰条。
  ctx.fillStyle = '#8c5a2b'
  ctx.fillRect(0, 0, width, 10)

  // 标题。
  const title = input.title.trim() || '未命名'
  const titleLines = splitCardLines(title, 14, 3)
  ctx.fillStyle = '#4f2f1c'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 64px "PingFang SC", "Microsoft YaHei", sans-serif'
  const titleLineHeight = 88
  titleLines.forEach((line, index) => {
    ctx.fillText(line, width / 2, 130 + index * titleLineHeight)
  })

  // 分隔线。
  ctx.strokeStyle = 'rgba(140, 90, 43, 0.4)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(120, 130 + titleLines.length * titleLineHeight + 24)
  ctx.lineTo(width - 120, 130 + titleLines.length * titleLineHeight + 24)
  ctx.stroke()

  // 正文摘要。
  const body = input.body.trim()
  const bodyStartY = 130 + titleLines.length * titleLineHeight + 80
  if (body) {
    const bodyLines = splitCardLines(body, 20, 8)
    ctx.fillStyle = '#5f4533'
    ctx.font = '400 40px "PingFang SC", "Microsoft YaHei", sans-serif'
    const bodyLineHeight = 60
    bodyLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, bodyStartY + index * bodyLineHeight)
    })
  }

  // 话题标签（底部）。
  const tags = (input.tags ?? []).filter((t) => t.trim()).slice(0, 6)
  if (tags.length) {
    ctx.textAlign = 'center'
    ctx.font = '500 36px "PingFang SC", "Microsoft YaHei", sans-serif'
    const tagText = tags.map((t) => `#${t.trim()}`).join(' ')
    const tagLines = splitCardLines(tagText, 18, 2)
    ctx.fillStyle = '#a86a3a'
    tagLines.forEach((line, index) => {
      ctx.fillText(line, width / 2, height - 150 + index * 52)
    })
  }

  // 底部署名。
  const footer = input.footer?.trim()
  if (footer) {
    ctx.fillStyle = 'rgba(140, 90, 43, 0.7)'
    ctx.font = '400 28px "PingFang SC", "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`—— ${footer} ——`, width / 2, height - 64)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('卡片导出失败'))
    }, 'image/png')
  })
}
