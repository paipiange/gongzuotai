/**
 * 内容质检（本地规则，不调用任何模型）。
 *
 * 对已生成的文字做轻量可读性/结构分析，产出面向创作者的反馈卡片数据。
 * 纯函数、零依赖，便于单元测试与复用（文字工作台、标题工作台等）。
 */

export interface ContentInspection {
  /** 正文字数（去除空白后）。 */
  charCount: number
  /** 段落数（按空行/换行拆分，忽略空段）。 */
  paragraphCount: number
  /** 估算阅读时长（分钟），按中文 400 字/分钟。 */
  readingMinutes: number
  /** 平均每段字数。 */
  avgParagraphChars: number
  /** 检测到的「AI 腔」套话命中数。 */
  clicheHits: string[]
  /** 是否包含一级标题（Markdown `# `）。 */
  hasHeading: boolean
  /** 使用 emoji 的数量。 */
  emojiCount: number
  /** 结构化建议列表（用于 UI 展示）。 */
  suggestions: string[]
  /** 综合评分（0–100，仅供粗略参考）。 */
  score: number
}

/** 常见 AI 腔 / 空泛套话（匹配到即提示，不修改原文）。 */
const CLICHES = [
  '总的来说', '综上所述', '总而言之', '首先', '其次', '再次', '最后',
  '值得注意的是', '需要强调的是', '不难发现', '由此可见', '众所周知',
  '希望本文', '希望对你有', '相信通过', '让我们一起', '快速提升',
  '闭眼入', '宝藏', '绝绝子', '赋能', '闭环', '抓手', '底层逻辑',
  '认知升级', '破圈', '干货满满', '赶快收藏', '一键三连',
]

export function inspectContent(raw: string): ContentInspection {
  const text = raw ?? ''
  // 去掉 Markdown 语法符号后统计「有效正文」，但保留标题判定所需的原始行。
  const paragraphs = text
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[-*_#>]{1,6}\s*$/.test(line))

  const plain = text.replace(/[#>*_`\-~]/g, '')
  const charCount = plain.replace(/\s/g, '').length
  const readingMinutes = Math.max(1, Math.round(charCount / 400))

  const nonEmptyLens = paragraphs.map((p) => p.replace(/\s/g, '').length).filter((n) => n > 0)
  const avgParagraphChars = nonEmptyLens.length ? Math.round(nonEmptyLens.reduce((a, b) => a + b, 0) / nonEmptyLens.length) : 0

  const clicheHits: string[] = []
  for (const cliche of CLICHES) {
    if (text.includes(cliche)) clicheHits.push(cliche)
  }

  const hasHeading = /^#{1,3}\s+\S/m.test(text)
  const emojiCount = (text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu) ?? []).length

  const suggestions: string[] = []
  if (charCount === 0) suggestions.push('还没有正文内容，先写点东西再质检')
  else if (charCount < 100) suggestions.push('正文偏短，建议补充论据或案例让内容更完整')
  if (avgParagraphChars > 300 && nonEmptyLens.length > 0) suggestions.push(`平均每段 ${avgParagraphChars} 字，段落偏长，建议拆短（移动端阅读更友好）`)
  if (!hasHeading && charCount > 200) suggestions.push('未检测到小标题，长文建议用「# 标题」分段，提升可读性')
  if (clicheHits.length > 0) suggestions.push(`检测到 ${clicheHits.length} 处常见「AI 腔」套话：${clicheHits.slice(0, 5).join('、')}${clicheHits.length > 5 ? ' 等' : ''}，建议替换为更具体的表达`)
  if (emojiCount === 0 && charCount > 0) suggestions.push('可考虑加少量 emoji 增强情绪与节奏（小红书/公众号风格适用）')

  // 粗略评分：基础分 + 长度/结构/表达加减分，仅作参考。
  let score = 60
  if (charCount >= 300) score += 10
  else if (charCount >= 100) score += 5
  if (hasHeading) score += 10
  if (avgParagraphChars > 0 && avgParagraphChars <= 200) score += 10
  if (clicheHits.length === 0) score += 10
  else score -= Math.min(15, clicheHits.length * 3)
  score = Math.max(0, Math.min(100, score))

  return {
    charCount,
    paragraphCount: paragraphs.length,
    readingMinutes,
    avgParagraphChars,
    clicheHits,
    hasHeading,
    emojiCount,
    suggestions,
    score,
  }
}
