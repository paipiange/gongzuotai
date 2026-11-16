/**
 * 图文分镜拆页：把用户素材用文本模型拆成「多页竖图」分镜。
 *
 * 复用 textGenService 的 `generateTextWithPrompt`（支持 Harness 与直连两种
 * 后端），固化 PROMPTS.md 中的 Prompt 1（事实提取）与 Prompt 2（分镜策划）。
 * 当前实现一步到位：让模型直接输出分镜 JSON（内含 facts 引用），减少往返。
 */

import type { LlmService } from './types'
import { generateTextWithPrompt } from './textGenService'

export interface StoryboardFact {
  id: string
  label: string
  raw_amount: string
  amount_yuan: number | null
  unit: string
  source_fragment: string
  needs_review: boolean
}

export interface StoryboardPage {
  page_no: number
  page_type: string
  title: string
  subtitle: string
  layout_id: string
  facts_used: string[]
  visual_brief: string
  disclaimer: string
}

export interface StoryboardResult {
  topic: string
  facts: StoryboardFact[]
  pages: StoryboardPage[]
  computed: { sum_yuan: number | null; target_yuan: number | null; difference_yuan: number | null }
  warnings: string[]
}

export interface StoryboardInput {
  sourceText: string
  extractedImageText: string
  topic: string
  pageCount: number
  platform: string
}

const SYSTEM_PROMPT = [
  '你是公众号图文工作台里的「事实提取 + 分镜策划」一体编辑器。',
  '任务：先从用户提供的素材里提取确实出现的项目、金额、单位与主张，再把确认的数据拆成可独立生成的多页竖图分镜。',
  '',
  '事实提取规则：',
  '1. 只能使用输入材料里的事实，不得补充现实中的价格、品牌型号、事件结局或推测。',
  '2. 金额尽可能标准化为人民币元，保留原始字符串；「万」乘 10000；「36万8」这类歧义表达必须标 needs_review=true，不得默默确认。',
  '3. 区分事实、算术结果、观点、夸张情节。',
  '4. 若原图有「合计」，先逐条计算并与原图声称的合计比对；出现差异时加入 warnings，不要改写原始数据。',
  '',
  '分镜策划规则：',
  '5. pages 数量必须等于指定页数；每页有 page_no、page_type、title、subtitle、layout_id、facts_used、visual_brief、disclaimer（可空）。',
  '6. 第 1 页是强钩子封面（page_type=cover）；最后一页做总结/思考（page_type=summary）；中间页按条目数量和可读性分组（page_type=content）。',
  '7. 不得编造新事实，不得篡改金额/单位/商品名；所有数字引用 facts 里的 id，不得新造 fact_id。',
  '8. 封面标题不超过 26 汉字；每页图内正文尽量少于 90 汉字；清单页每页 4-6 项。',
  '9. 内容口语化，避免机械营销套话，不写「本人亲测」等未经确认的表达。',
  '10. 遇到未经核实的争议或社会事件，用 disclaimer 标注「原图夸张说法/仅供讨论」，不当作事实。',
  '11. 只输出合法 JSON，不加 Markdown 代码块标记或任何解释文字。',
  '',
  '输出 JSON 结构：',
  '{',
  '  "topic": "",',
  '  "facts": [{"id":"f1","label":"","raw_amount":"","amount_yuan":null,"unit":"元","source_fragment":"","needs_review":false}],',
  '  "pages": [{"page_no":1,"page_type":"cover","title":"","subtitle":"","layout_id":"cover_big_number","facts_used":[],"visual_brief":"","disclaimer":""}],',
  '  "computed": {"sum_yuan":null,"target_yuan":null,"difference_yuan":null},',
  '  "warnings": []',
  '}',
].join('\n')

function buildUserPrompt(input: StoryboardInput): string {
  const lines: string[] = []
  lines.push(`主题：${input.topic || '（未提供，请从素材概括）'}`)
  lines.push(`平台：${input.platform || '公众号'}`)
  lines.push(`指定页数：${input.pageCount}`)
  if (input.sourceText.trim()) {
    lines.push('')
    lines.push('【原始文字】')
    lines.push(input.sourceText)
  }
  if (input.extractedImageText.trim()) {
    lines.push('')
    lines.push('【图像解析文本（可能有识别错误）】')
    lines.push(input.extractedImageText)
  }
  return lines.join('\n')
}

/** 调用文本模型拆页，返回结构化的分镜结果。 */
export async function generateStoryboard(
  llm: LlmService,
  input: StoryboardInput & { provider: string; model: string },
): Promise<StoryboardResult> {
  const result = await generateTextWithPrompt(
    llm,
    {
      provider: input.provider,
      model: input.model,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
    },
  )
  const parsed = parseStoryboard(result.text)
  if (!parsed) {
    throw new Error('模型未返回有效的分镜 JSON，请重试或更换文字模型')
  }
  return parsed
}

/** 导出拆页的 system / user 提示词，供直连模式复用。 */
export function storyboardPrompts(input: StoryboardInput): { system: string; user: string } {
  return { system: SYSTEM_PROMPT, user: buildUserPrompt(input) }
}

/** 容错解析模型返回的 JSON（容忍 Markdown 围栏与前后杂文）。 */
export function parseStoryboard(text: string): StoryboardResult | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    const facts = Array.isArray(obj.facts)
      ? (obj.facts as Array<Record<string, unknown>>)
          .map((f) => ({
            id: String(f.id ?? ''),
            label: String(f.label ?? ''),
            raw_amount: String(f.raw_amount ?? ''),
            amount_yuan: typeof f.amount_yuan === 'number' ? f.amount_yuan : null,
            unit: String(f.unit ?? '元'),
            source_fragment: String(f.source_fragment ?? ''),
            needs_review: Boolean(f.needs_review),
          }))
          .filter((f) => f.id)
      : []
    const pages = Array.isArray(obj.pages)
      ? (obj.pages as Array<Record<string, unknown>>)
          .map((p) => ({
            page_no: Number(p.page_no ?? 0),
            page_type: String(p.page_type ?? 'content'),
            title: String(p.title ?? ''),
            subtitle: String(p.subtitle ?? ''),
            layout_id: String(p.layout_id ?? ''),
            facts_used: Array.isArray(p.facts_used) ? p.facts_used.map(String) : [],
            visual_brief: String(p.visual_brief ?? ''),
            disclaimer: String(p.disclaimer ?? ''),
          }))
          .filter((p) => p.page_no > 0 && (p.title || p.visual_brief))
      : []
    const computedRaw = (obj.computed ?? {}) as Record<string, unknown>
    return {
      topic: String(obj.topic ?? ''),
      facts,
      pages,
      computed: {
        sum_yuan: typeof computedRaw.sum_yuan === 'number' ? computedRaw.sum_yuan : null,
        target_yuan: typeof computedRaw.target_yuan === 'number' ? computedRaw.target_yuan : null,
        difference_yuan: typeof computedRaw.difference_yuan === 'number' ? computedRaw.difference_yuan : null,
      },
      warnings: Array.isArray(obj.warnings) ? obj.warnings.map(String) : [],
    }
  } catch {
    return null
  }
}
