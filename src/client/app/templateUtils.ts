/** 模板占位符与分类判断的纯函数（从 TemplateUsePanel 抽出，便于单测与复用）。 */

/** 提取 promptTemplate 里所有 {{占位符}}（去重、保序）。 */
export function extractPlaceholders(template: string): string[] {
  const out: string[] = []
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template))) {
    const key = m[1].trim()
    if (key && !out.includes(key)) out.push(key)
  }
  return out
}

/** 用字段值替换 promptTemplate 里的 {{占位符}}；缺失的字段保留原占位符。 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    const k = key.trim()
    return values[k] ?? `{{${k}}}`
  })
}

/** 图片类模板（按分类判断）：漫画 / 图片 走生图，其余走生文。 */
export function isImageTemplate(category: string): boolean {
  return /漫画|图片|插画|绘图/.test(category)
}

/** 漫画模板（带固定男女主参考图 + 角色选择）。 */
export function isComicTemplate(category: string, name: string): boolean {
  return /漫画/.test(category) || /漫画/.test(name)
}

export type ComicRoleChoice = 'female' | 'male' | 'both'

export interface ComicImagePromptOptions {
  overlayText?: string
  imageIndex?: number
  imageCount?: number
}

/**
 * 解析漫画图片内文字：
 * - 留空时使用主题；
 * - 只写一行时，每张图复用该行；
 * - 写多行时，第 N 行对应第 N 张，空行或缺失行回退到主题。
 */
export function resolveComicOverlayText(text: string, theme: string, imageIndex: number): string {
  const fallback = theme.trim() || '做人最重要的是开心'
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const nonEmptyLines = lines.filter(Boolean)
  if (nonEmptyLines.length === 0) return fallback
  if (nonEmptyLines.length === 1) return nonEmptyLines[0]
  return lines[Math.max(0, imageIndex - 1)] || fallback
}

/**
 * 漫画模板直接交给生图模型的提示词。
 *
 * 内置模板正文是给文本模型产出“多页分镜方案”的，不能原样塞进
 * `/images/edits`；否则一次单图请求会携带上千字规划指令，网关容易超时。
 */
export function buildComicImagePrompt(
  theme: string,
  role: ComicRoleChoice,
  options: ComicImagePromptOptions = {},
): string {
  const cleanTheme = theme.trim().slice(0, 600) || '温暖治愈的日常快乐'
  const overlayText = options.overlayText?.trim().slice(0, 120) ?? ''
  const imageCount = Math.max(1, Math.min(6, Math.trunc(options.imageCount ?? 1)))
  const imageIndex = Math.max(1, Math.min(imageCount, Math.trunc(options.imageIndex ?? 1)))
  const character = role === 'female'
    ? '只画女主一人：年轻成人 Q 版女孩，超长蓬松栗棕波浪卷发，头发左侧粉色缎面蝴蝶结，超大暖棕眼睛，粉色腮红，金色矩形耳饰和爱心项链，粉色连衣裙搭配奶油白宽松针织开衫。'
    : role === 'male'
      ? '只画男主一人：年轻成人 Q 版男孩，蓬松栗棕短发，暖棕大眼，温和脸颊和略粗眉毛，巧克力棕宽松针织开衫搭配奶油白针织衫。'
      : '只画固定男女主两人同框：女主为栗棕长卷发、左侧粉色蝴蝶结、粉色连衣裙与奶油白针织开衫；男主为栗棕短发、巧克力棕针织开衫与奶油白针织衫。'

  const sequence = imageCount > 1
    ? `这是同系列第 ${imageIndex}/${imageCount} 张，保持人物外形、服装和画风一致，同时使用独立且有区别的动作与场景。`
    : ''
  const textInstruction = overlayText
    ? `画面必须直接包含清晰可读的中文文字：「${overlayText}」。必须逐字准确，不得改写、漏字或出现乱码；使用深巧克力棕手写标题或对话气泡，放在奶油白留白区，不遮挡人物。`
    : '画面不要出现任何文字、字母或乱码。'

  return `主题：${cleanTheme}。${sequence}${character}围绕主题设计一个明确、温暖、有情绪感染力的单幅场景。奶油粉、巧克力暖棕、彩铅水彩手绘、精致软萌 Q 版、小红书插画，干净奶油白背景，完整构图。${textInstruction}只生成一张独立图片，不要分镜方案，不要解释。`
}
