import type { LlmService, StreamChunk } from './types'

/** Upper bound for a single text-generation round-trip before giving up. */
const TEXT_GEN_TIMEOUT_MS = 180_000

/** Combine the caller's abort signal with a hard timeout. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** Client-facing request body for the text-gen endpoint. */
export interface TextGenRequest {
  provider: string
  model: string
  studio: 'article' | 'headline' | 'marketing' | 'xiaohongshu'
  topic: string
  style?: string
  requirement?: string
  /** 发布平台（爆款标题工作台用：公众号 / 小红书 / 抖音 / 今日头条）。 */
  platform?: string
  /** 参考图（data URL）。仅直连多模态后端真正发送给模型；Harness llm 服务不支持图片时降级跳过。 */
  images?: string[]
}

/** 爆款标题策划师 system prompt（含平台占位符，运行时替换）。 */
export const HEADLINE_SYSTEM_PROMPT = `# 角色定位
你是一名拥有丰富实战经验的中文新媒体爆款标题策划师，擅长微信公众号、小红书、抖音、今日头条等平台的标题创作。
你的任务是：根据用户输入的文字、上传的图片及图文组合内容，深度理解其核心信息、情绪、故事冲突与读者兴趣点，生成让人想点击的高吸引力中文标题。
你的目标不是简单概括内容，而是从真实内容中挖掘最有传播潜力的切入点。

## 一、输入内容理解
用户可能输入：一段普通文字、一篇完整文章、一张或多张图片、图片加文字、漫画截图或连续故事、视频字幕、口播文案、产品介绍、软件功能截图。
请先在内部完成以下分析：
1. 内容主题：讲的是什么？
2. 核心看点：最值得关注的是什么？
3. 情绪方向：搞笑、委屈、惊讶、温暖、愤怒、反转、好奇还是共鸣？
4. 目标用户：谁最可能对内容感兴趣？
5. 传播亮点：冲突、悬念、反差、结果、痛点、利益、实用价值。
6. 具体细节：哪些数字、人物关系、行为、对话、画面细节可以用在标题中？
如果上传多张图片，必须结合全部图片，理解前后顺序和完整故事，不要只依据第一张图片。
如果图片存在文字，要结合画面和可识别文字共同理解。

## 二、爆款标题创作原则
### 1. 强化好奇心
让读者看到标题后，产生想知道原因、过程或者结果的心理。
### 2. 突出冲突和反差
优先提炼内容中真实存在的矛盾、反转、身份差异、行为反差。
### 3. 强化情绪共鸣
尤其适用于婚姻、爱情、家庭、男女关系、生活故事等题材。
### 4. 突出真实利益
对于软件、工具、教程、数码和知识类内容，优先强调用户能获得的具体好处。
### 5. 语言要像真人
用中国网民熟悉的表达方式，口语化、自然、直接；可以适度使用"！""？""……"增强情绪；不要为了吸引点击而堆砌感叹号；不使用生硬的营销话术；不使用空洞的"震惊全网""颠覆认知"等套话；避免"揭秘""深度解析""一文看懂""背后的真相"等模板化表达，除非与实际内容高度匹配。

## 三、标题生成策略
必须从以下 6 种角度分别思考：好奇悬念型、情绪共鸣型、冲突反转型、直击痛点型、利益价值型、口语传播型。根据内容实际特点选择最合适的方向，不要强行制造冲突或情绪。

## 四、平台适配
如果用户指定平台，优先匹配该平台风格。
【微信公众号】优先考虑打开率、好奇心、情绪和价值，推荐 12～28 个汉字左右，必要时可更长，可使用适度悬念、感叹号、反差，不要标题党到与正文不符。
【小红书】语言更轻松、有分享感和生活感，推荐 10～22 个汉字左右，可适量使用感叹号和表情，强调感受、真实体验或实用价值。
【抖音】更短、更直接、更有冲突，优先突出具体事件、人物、结果或反转，推荐 8～22 个汉字左右，适合口语化、剧情感和悬念。
【今日头条】事件明确，信息具体，优先人物关系、真实数字、行为和结果，适合故事型和信息型标题。
如果用户没有指定平台，默认以微信公众号风格生成。

## 五、真实性要求
1. 不得编造原文或图片中不存在的事实。
2. 不得凭空添加金额、年龄、身份、人物关系、事件结果。
3. 不得把猜测写成事实。
4. 不得恶意制造性别对立、家庭矛盾或人身攻击。
5. 不得使用与内容无关的夸张标题骗取点击。
6. 可以重新组织信息、突出细节和制造合理悬念，但不能改变原意。
7. 用户提供的内容不完整时，标题不能暗示已经知道未知结局。
8. 不得虚构亲身体验、用户反馈、下载量或产品效果。

## 六、标题评分与筛选
首先在内部生成至少 15 个候选标题，从不同角度筛选。然后按以下维度打分：点击吸引力 30 分、内容相关性 25 分、情绪或好奇心 20 分、语言自然程度 15 分、平台匹配程度 10 分，总分 100 分。评分要有区分度，不能所有标题都给高分。优先选择同时具备吸引力、自然表达和真实性的标题。评分仅用于内部候选排序，不代表真实点击率预测。

## 七、最终输出格式
只输出以下内容，不展示完整的内部分析过程。

【内容核心】
一句话总结用户提供的内容。

【最推荐标题】
标题：xxx
评分：xx/100
推荐理由：一句话说明这个标题为什么值得使用。

【其他9个备选标题】
1. xxx
2. xxx
...
9. xxx

【最佳推荐】
从10个标题中确定一个最适合发布的版本。

要求：所有标题必须有明显差异，不能只是替换几个词；优先提供可以直接复制发布的标题；不要解释标题创作理论；不要输出无关客套话；标题必须与用户图文实际内容相符。`

/** Maps a studio id + style to a system prompt that shapes the output genre. */
function systemPromptFor(request: TextGenRequest): string {
  const styleNote = styleHint(request.style)
  switch (request.studio) {
    case 'headline':
      return HEADLINE_SYSTEM_PROMPT
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
  if (request.studio === 'headline') {
    const platform = request.platform?.trim() || '微信公众号'
    const requirement = request.requirement?.trim()
    const lines = [
      `发布平台：${platform}`,
      `图文文字：${request.topic}`,
      request.images?.length ? `上传图片：${request.images.length} 张（见上方图片消息）` : '',
      requirement ? `其他要求：${requirement}` : '',
    ].filter(Boolean)
    lines.push('请充分理解全部图文，生成10个具有传播潜力的中文标题。')
    return lines.join('\n')
  }
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
  // Harness llm 服务的消息 content 仅支持纯文本，无法附带图片。
  // 有参考图时降级：仅基于文字生成，并在 user prompt 中注明图片未参与。
  const hasImages = Array.isArray(request.images) && request.images.length > 0
  const userContent = hasImages
    ? `${userPromptFor(request)}\n\n（注：当前后端不支持图片输入，请仅基于上述文字内容生成。）`
    : userPromptFor(request)
  const prepared = await llm.prepareCall(
    {
      provider: request.provider,
      model: request.model,
      system: systemPromptFor(request),
      messages: [{ role: 'user', content: userContent }],
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

/**
 * Run a text completion with an explicit system + user prompt (bypassing the
 * studio-based `systemPromptFor` mapping). Used by structured tasks such as
 * storyboard breakdown that need a custom instruction, not an article prompt.
 */
export async function generateTextWithPrompt(
  llm: LlmService,
  input: { provider: string; model: string; system: string; user: string },
  options: { signal?: AbortSignal } = {},
): Promise<TextGenResult> {
  const prepared = await llm.prepareCall(
    {
      provider: input.provider,
      model: input.model,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
    },
    options.signal,
  )
  return foldStream(prepared.stream(), options.signal)
}

/** Fold a stream of chunks into a complete TextGenResult (shared by all paths). */
async function foldStream(stream: AsyncIterable<StreamChunk>, signal?: AbortSignal): Promise<TextGenResult> {
  let text = ''
  let usage = { inputTokens: 0, outputTokens: 0 }
  let finishReason = 'stop'
  for await (const chunk of stream) {
    if (signal?.aborted) {
      finishReason = 'aborted'
      break
    }
    switch (chunk.type) {
      case 'text-delta':
        text += chunk.text
        break
      case 'usage':
        usage = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens }
        break
      case 'finish':
        finishReason = chunk.reason
        break
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

/** Build an OpenAI-compatible user message content: text only, or text + images for multimodal. */
export function buildUserContent(text: string, images?: string[]): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  const list = images?.filter((url) => typeof url === 'string' && url.trim())
  if (!list || list.length === 0) return text
  return [
    { type: 'text', text },
    ...list.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ]
}

/** Direct-mode variant of `generateTextWithPrompt` for third-party endpoints. */
export async function generateTextWithPromptDirect(
  config: DirectTextConfig,
  input: { system: string; user: string; images?: string[] },
  options: { signal?: AbortSignal } = {},
): Promise<TextGenResult> {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  const url = `${base}/chat/completions`
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
          { role: 'system', content: input.system },
          { role: 'user', content: buildUserContent(input.user, input.images) },
        ],
        stream: false,
      }),
      signal: withTimeout(options.signal, TEXT_GEN_TIMEOUT_MS),
    })
  } catch (cause) {
    if (options.signal?.aborted) throw new Error('已取消')
    throw new Error(`无法连接文字 API：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`文字 API 返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
  }
  // 有些网关在 baseUrl 配错时返回 200 + HTML 页面而非 JSON；这里捕获
  // JSON 解析失败并给出可读的错误，避免把底层的 "Unexpected token '<'" 透传。
  let data: {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  try {
    data = (await response.json()) as typeof data
  } catch {
    const ct = response.headers.get('content-type') ?? ''
    throw new Error(`文字 API 未返回 JSON（Content-Type: ${ct || '未知'}）。请检查 Base URL 是否指向 OpenAI 兼容的 /v1 端点，而非网关首页。`)
  }
  const message = data.choices?.[0]?.message
  const text = typeof message?.content === 'string' ? message.content : ''
  return {
    text,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
  }
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
          { role: 'user', content: buildUserContent(userPromptFor(request), request.images) },
        ],
        stream: true,
      }),
      signal: withTimeout(options.signal, TEXT_GEN_TIMEOUT_MS),
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
