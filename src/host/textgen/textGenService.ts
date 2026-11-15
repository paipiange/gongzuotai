import type { LlmService, StreamChunk } from './types'

/** Client-facing request body for the text-gen endpoint. */
export interface TextGenRequest {
  provider: string
  model: string
  studio: 'article' | 'headline' | 'marketing' | 'xiaohongshu'
  topic: string
  style?: string
  requirement?: string
}

/** Maps a studio id + style to a system prompt that shapes the output genre. */
function systemPromptFor(request: TextGenRequest): string {
  const styleNote = styleHint(request.style)
  switch (request.studio) {
    case 'headline':
      return `你是资深文案，擅长拟写传播力强的标题。${styleNote}请输出 5~8 个候选标题，每行一个，不加序号与解释。`
    case 'marketing':
      return `你是营销策划，擅长产出可落地的营销文案。${styleNote}请围绕主题输出结构清晰的营销文案，含卖点、受众与行动号召。`
    case 'xiaohongshu':
      return `你是小红书爆款博主，熟悉平台调性与话题标签。${styleNote}请输出一篇小红书笔记：开头钩子、分点正文、结尾互动引导，并附 3~5 个话题标签。`
    default:
      return `你是资深内容创作者，文笔细腻有画面感。${styleNote}请围绕主题写一篇完整的原创文章，结构清晰、分段自然。`
  }
}

function styleHint(style?: string): string {
  switch (style) {
    case 'poetic':
      return '文风偏东方诗意、含蓄隽永。'
    case 'clear':
      return '文风清晰专业、逻辑严谨。'
    case 'lively':
      return '文风轻松活泼、有网感。'
    default:
      return '文风偏电影感叙事、有画面与情绪。'
  }
}

function userPromptFor(request: TextGenRequest): string {
  const requirement = request.requirement?.trim()
  return requirement
    ? `主题：${request.topic}\n补充要求：${requirement}`
    : `主题：${request.topic}`
}

export interface TextGenResult {
  text: string
  usage: { inputTokens: number; outputTokens: number }
  finishReason: string
}

/**
 * Runs a single text generation against the Harness `llm` service, folding the
 * incremental `text-delta` stream into a complete result. `onDelta` lets the
 * caller forward progress (e.g. over SSE) without buffering everything here.
 */
export async function generateText(
  llm: LlmService,
  request: TextGenRequest,
  options: { signal?: AbortSignal; onDelta?: (delta: string) => void } = {},
): Promise<TextGenResult> {
  const prepared = llm.prepareCall(
    {
      provider: request.provider,
      model: request.model,
      system: systemPromptFor(request),
      messages: [{ role: 'user', content: userPromptFor(request) }],
    },
    options.signal,
  )

  let text = ''
  let usage = { inputTokens: 0, outputTokens: 0 }
  let finishReason = 'stop'

  for await (const chunk of prepared.stream()) {
    if (options.signal?.aborted) {
      finishReason = 'aborted'
      break
    }
    switch (chunk.type) {
      case 'text-delta':
        text += chunk.text
        options.onDelta?.(chunk.text)
        break
      case 'usage':
        usage = {
          inputTokens: chunk.usage.inputTokens,
          outputTokens: chunk.usage.outputTokens,
        }
        break
      case 'finish':
        finishReason = chunk.reason
        break
      // block-start / block-end / reasoning-delta 不影响最终正文，忽略
      default:
        break
    }
  }

  return { text, usage, finishReason }
}
