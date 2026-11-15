import type { LlmService } from './types'
import { generateText } from './textGenService'

export interface SuggestionInput {
  /** Optional seed topics (recent creation titles) to ground the suggestions. */
  topics?: string[]
  count?: number
  provider: string
  model: string
}

export interface Suggestion {
  title: string
  description: string
  promptTemplate: string
  category: string
  tags: string[]
}

const CATEGORIES = ['文章创作', '营销文案', '小红书笔记', '图片生成']

/**
 * Ask the Harness text model for a batch of content-topic suggestions, then
 * parse them into structured inspiration records. The model is prompted to
 * return strict JSON so the result can be consumed programmatically.
 */
export async function suggestInspirations(
  llm: LlmService,
  input: SuggestionInput,
): Promise<Suggestion[]> {
  const count = Math.min(Math.max(input.count ?? 3, 1), 6)
  const historyNote = input.topics?.length
    ? `\n参考用户近期创作主题（用于延续风格）：\n${input.topics.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : ''

  const prompt = [
    `你是内容策划，请为用户推荐 ${count} 个可执行的创作选题。${historyNote}`,
    '严格按以下 JSON 数组格式返回，不要输出任何多余文字、解释或 Markdown 代码块标记：',
    '[',
    '  {"title":"选题标题","description":"一句话说明选题价值与受众","promptTemplate":"可直接用于生成该内容的提示词","category":"文章创作|营销文案|小红书笔记|图片生成","tags":["标签1","标签2"]}',
    ']',
  ].join('\n')

  const result = await generateText(llm, {
    provider: input.provider,
    model: input.model,
    studio: 'article',
    topic: '内容选题推荐',
    requirement: prompt,
  })

  return parseSuggestions(result.text)
}

/** Parse the model's JSON array, tolerating fenced code blocks and stray text. */
function parseSuggestions(text: string): Suggestion[] {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return []

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown
    if (!Array.isArray(parsed)) return []
    const out: Suggestion[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const title = typeof obj.title === 'string' ? obj.title.trim() : ''
      if (!title) continue
      const category = typeof obj.category === 'string' && CATEGORIES.includes(obj.category) ? obj.category : '文章创作'
      const tags = Array.isArray(obj.tags)
        ? obj.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, 5)
        : []
      out.push({
        title,
        description: typeof obj.description === 'string' ? obj.description.trim() : '',
        promptTemplate: typeof obj.promptTemplate === 'string' ? obj.promptTemplate.trim() : title,
        category,
        tags,
      })
    }
    return out
  } catch {
    return []
  }
}
