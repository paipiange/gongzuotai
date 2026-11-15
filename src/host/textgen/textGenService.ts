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
    case 'cinematic':
      return '文风偏电影感叙事、有画面与情绪。'
    default:
      // 未指定风格时，不附加任何文风约束。
      return ''
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
  const prepared = await llm.prepareCall(
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

/** Config for a direct OpenAI-compatible text call (third-party API). */
export interface DirectTextConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/**
 * Runs a text generation against a third-party OpenAI-compatible endpoint
 * (`POST {baseUrl}/chat/completions`) directly, bypassing the Harness `llm`
 * service. Streams incremental deltas via `onDelta` and folds them into a
 * complete result, mirroring `generateText` so the caller can switch backends
 * transparently.
 */
export async function generateTextDirect(
  config: DirectTextConfig,
  request: TextGenRequest,
  options: { signal?: AbortSignal; onDelta?: (delta: string) => void } = {},
): Promise<TextGenResult> {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  const url = `${base}/chat/completions`
  const started = Date.now()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPromptFor(request) },
          { role: 'user', content: userPromptFor(request) },
        ],
        stream: true,
      }),
      signal: options.signal,
    })
  } catch (cause) {
    if (options.signal?.aborted) throw new Error('已取消生成')
    throw new Error(`无法连接文字 API：${cause instanceof Error ? cause.message : String(cause)}`)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`文字 API 返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
  }
  if (!response.body) throw new Error('文字 API 未返回响应流')

  // Parse the SSE stream, folding `choices[].delta.content` into the result.
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage = { inputTokens: 0, outputTokens: 0 }
  let finishReason = 'stop'

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(payload) as Record<string, unknown>
    } catch {
      return
    }
    const choices = obj.choices as Array<Record<string, unknown>> | undefined
    if (Array.isArray(choices) && choices[0]) {
      const delta = choices[0].delta as Record<string, unknown> | undefined
      const content = delta?.content
      if (typeof content === 'string' && content) {
        text += content
        options.onDelta?.(content)
      }
      const finish = choices[0].finish_reason
      if (typeof finish === 'string' && finish) finishReason = finish
    }
    const u = obj.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    if (u) {
      usage = {
        inputTokens: u.prompt_tokens ?? usage.inputTokens,
        outputTokens: u.completion_tokens ?? usage.outputTokens,
      }
    }
  }

  while (true) {
    if (options.signal?.aborted) {
      finishReason = 'aborted'
      break
    }
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      handleLine(line)
      idx = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) handleLine(buffer)

  return { text, usage, finishReason }
}
