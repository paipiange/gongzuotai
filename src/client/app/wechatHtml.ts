import { renderMarkdown } from './markdown'

/**
 * 公众号排版 HTML 生成器。
 *
 * 公众号编辑器只保留内联 style（会剥离 <style>/<link>），所以这里把国风
 * 视觉全部内联到标签上，生成一份可直接粘贴到公众号编辑器的富文本 HTML。
 * 内容先经 renderMarkdown 做 XSS 防护与转义，再注入内联样式。
 */

/** 给 renderMarkdown 的确定性输出注入内联样式（标签均为本渲染器产出，安全）。 */
function styleContentHtml(html: string): string {
  return html
    .replace(/<h1(?=[\s>])/g, '<h1 style="font-size:22px;color:#8c5a2b;margin:28px 0 12px;line-height:1.4;"')
    .replace(/<h2(?=[\s>])/g, '<h2 style="font-size:20px;color:#8c5a2b;margin:24px 0 10px;line-height:1.4;"')
    .replace(/<h3(?=[\s>])/g, '<h3 style="font-size:18px;color:#6b4523;margin:20px 0 8px;line-height:1.4;"')
    .replace(/<h4(?=[\s>])/g, '<h4 style="font-size:17px;color:#6b4523;margin:18px 0 8px;"')
    .replace(/<h5(?=[\s>])/g, '<h5 style="font-size:16px;color:#6b4523;margin:16px 0 8px;"')
    .replace(/<h6(?=[\s>])/g, '<h6 style="font-size:15px;color:#6b4523;margin:14px 0 8px;"')
    .replace(/<p(?=[\s>])/g, '<p style="margin:0 0 14px;text-align:justify;"')
    .replace(/<strong(?=[\s>])/g, '<strong style="color:#8c5a2b;font-weight:bold;"')
    .replace(/<blockquote(?=[\s>])/g, '<blockquote style="margin:16px 0;padding:10px 16px;border-left:3px solid #c9a06a;background:#f7efe4;color:#6b4523;"')
    .replace(/<ul(?=[\s>])/g, '<ul style="margin:0 0 14px;padding-left:22px;"')
    .replace(/<ol(?=[\s>])/g, '<ol style="margin:0 0 14px;padding-left:22px;"')
    .replace(/<li(?=[\s>])/g, '<li style="margin:6px 0;"')
    .replace(/<hr(?=[\s/>])/g, '<hr style="border:none;border-top:1px solid #e0cba8;margin:24px 0;"')
    .replace(/<code(?=[\s>])/g, '<code style="background:#f3ead9;padding:2px 6px;border-radius:4px;font-size:14px;color:#8c5a2b;"')
}

export interface WechatArticleInput {
  title: string
  /** Markdown 正文。 */
  content: string
  /** 顶部眉题（可选），如栏目名。 */
  eyebrow?: string
  /** 底部署名（可选），默认“拍片哥工作台”。 */
  footer?: string
}

/** 生成一份国风内联排版的公众号文章 HTML 字符串。 */
export function buildWechatArticleHtml(input: WechatArticleInput): string {
  const title = (input.title || '未命名文章').trim()
  const body = renderMarkdown(input.content || '')
  const footer = input.footer ?? '拍片哥工作台 · 本地创作'

  const eyebrowHtml = input.eyebrow
    ? `<p style="text-align:center;letter-spacing:4px;color:#b9a07e;font-size:13px;margin:0 0 6px;">${escapeInline(input.eyebrow)}</p>`
    : ''

  return [
    '<section style="padding:24px 16px;font-family:\'Songti SC\',\'STSong\',\'SimSun\',serif;color:#3a2a1a;line-height:1.9;font-size:16px;word-break:break-word;">',
    eyebrowHtml,
    `<h1 style="text-align:center;font-size:24px;font-weight:bold;color:#8c5a2b;margin:0 0 10px;line-height:1.4;">${escapeInline(title)}</h1>`,
    '<div style="text-align:center;margin:0 0 22px;"><span style="display:inline-block;width:48px;height:2px;background:#c9a06a;"></span></div>',
    styleContentHtml(body),
    `<p style="text-align:center;color:#b9a07e;font-size:13px;margin-top:32px;padding-top:12px;border-top:1px solid #eee0ca;">—— ${escapeInline(footer)} ——</p>`,
    '</section>',
  ].join('\n')
}

function escapeInline(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 纯文本版（作为剪贴板的 text/plain 兜底）。 */
export function buildWechatArticlePlainText(input: WechatArticleInput): string {
  const lines: string[] = []
  if (input.eyebrow) lines.push(input.eyebrow)
  lines.push(input.title || '未命名文章')
  lines.push('')
  lines.push(input.content || '')
  return lines.join('\n')
}
