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
