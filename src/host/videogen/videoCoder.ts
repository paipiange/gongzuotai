/**
 * 视频生成 · AI 编码器（LLM 生成 HTML + 沙箱校验 + 最多 3 轮自动修复）
 *
 * 借鉴 dsh-video-workbench 的 ai-coder.js 设计：
 *  - LLM 只返回严格 JSON：{ "html": "..." }
 *  - 静态安全沙箱校验（拦截脚本越权、危险调用）
 *  - 校验失败时把错误回传 LLM，温度降到 0.25，最多 3 轮修复
 */

import type { LlmService } from '../textgen/types'
import { generateTextWithPrompt } from '../textgen/textGenService'

export interface VideoCoderInput {
  provider: string
  model: string
  /** 主题文案 */
  topic: string
  /** 副标题（可选） */
  subtitle?: string
  /** 视觉风格（自由文本） */
  style?: string
  /** 风格 id（可选，命中风格库时注入结构化风格约束） */
  styleId?: string
  /** 注入的额外风格约束文本（由风格库 styleToPrompt 生成） */
  stylePrompt?: string
  width: number
  height: number
  fps: number
  durationSec: number
}

export interface VideoCoderResult {
  html: string
  usedFallback: boolean
  rounds: number
}

const MAX_REPAIR_ROUNDS = 3

/** 从 LLM 原始回复里稳健地提取 HTML（多级降级）。 */
function extractHtmlFromReply(rawText: string): string {
  // 1) 严格 JSON { "html": "..." }
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { html?: unknown }
      if (typeof parsed.html === 'string' && parsed.html.trim()) return parsed.html
    } catch {
      /* fall through */
    }
  }
  // 2) markdown 代码围栏
  const fenced = rawText.match(/```(?:html)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1] && /<html|<body|<!doctype/i.test(fenced[1])) return fenced[1].trim()
  // 3) 直接以 <!doctype / <html 开头的整段
  const direct = rawText.match(/<!doctype[\s\S]*|<\s*html[\s\S]*/i)
  if (direct && direct[0].includes('<')) return direct[0].trim()
  return ''
}

/** 静态沙箱校验：返回错误列表（空数组表示通过）。 */
export function scanHtmlSandbox(html: string): string[] {
  const errors: string[] = []
  if (!/<!doctype html>/i.test(html) && !/<html/i.test(html)) {
    errors.push('缺少 <html> 根元素')
  }
  // 必须暴露逐帧驱动契约，否则渲染器无法定位帧
  if (!/__seekToFrame/.test(html)) {
    errors.push('缺少 window.__seekToFrame(frame) 逐帧驱动接口')
  }
  if (!/__totalFrames/.test(html)) {
    errors.push('缺少 window.__totalFrames 总帧数声明')
  }
  // 拦截会破坏逐帧确定性的 API
  if (/Math\.random\s*\(/.test(html)) {
    errors.push('禁止使用 Math.random（会破坏逐帧可复现性）')
  }
  if (/Date\.now\s*\(|new\s+Date\s*\(/.test(html)) {
    errors.push('禁止使用 Date（会破坏逐帧可复现性）')
  }
  // 拦截外部网络请求（视频应自包含）
  if (/fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(html)) {
    errors.push('禁止发起网络请求（视频应自包含）')
  }
  // 拦截本地文件访问
  if (/require\s*\(|process\.|child_process|fs\.read/.test(html)) {
    errors.push('禁止访问 Node 环境')
  }
  return errors
}

/** 构建引导 LLM 生成视频 HTML 的 system prompt。 */
function buildSystemPrompt(stylePrompt?: string): string {
  const base = [
    '你是一个前端动画工程师，负责把一段中文主题文案编译成一个自包含的 HTML 动画页面，用于逐帧渲染成短视频。',
    '',
    '严格要求：',
    '1. 只返回严格 JSON，格式：{"html": "完整HTML源码"}，不要输出任何解释文字或代码围栏。',
    '2. HTML 必须是完整文档（含 <!doctype html> 与 <html>），所有 CSS/JS 内联，不引用任何外部资源。',
    '3. 页面必须声明 window.__totalFrames（总帧数）并实现 window.__seekToFrame(n)（把动画定位到第 n 帧），动画用 requestAnimationFrame 或纯 CSS 时间轴驱动，且完全确定性。',
    '4. 禁止使用 Math.random、Date、fetch、XMLHttpRequest、WebSocket、require、process 等任何会破坏确定性或访问环境的能力。',
    '5. 动画要围绕「标题 → 副标题 → 落款」三幕叙事，画面美观、有电影感，背景用深色暖棕金色调（契合品牌国风）。',
    '6. HTML 字符串内的双引号必须转义为 \\"，换行可用 \\n，确保 JSON 可解析。',
  ]
  if (stylePrompt) {
    base.push('', '【本片视觉风格约束（必须严格遵循）】', stylePrompt)
  }
  return base.join('\n')
}

/** 构建 user prompt。 */
function buildUserPrompt(input: VideoCoderInput): string {
  const styleNote = input.style ? `\n视觉风格：${input.style}` : ''
  return [
    `请把下面这段主题制作成一段 ${input.durationSec} 秒、${input.width}x${input.height}、${input.fps}fps 的视频动画 HTML。`,
    `总帧数 = ${input.durationSec} * ${input.fps} = ${Math.round(input.durationSec * input.fps)}。`,
    '',
    `标题：${input.topic}`,
    input.subtitle ? `副标题：${input.subtitle}` : '',
    `落款：拍片哥工作台`,
    styleNote,
    '',
    '请直接返回严格 JSON。',
  ].filter(Boolean).join('\n')
}

/**
 * 生成视频 HTML：先让 LLM 产出，再做沙箱校验 + 最多 3 轮自动修复。
 * 全部失败时返回 null（由调用方降级到内置模板）。
 */
export async function authorVideoHtml(
  llm: LlmService,
  input: VideoCoderInput,
  options: { signal?: AbortSignal; onRound?: (round: number) => void } = {},
): Promise<VideoCoderResult | null> {
  const system = buildSystemPrompt(input.stylePrompt)
  let user = buildUserPrompt(input)
  let html = ''

  // 第 0 轮：初次生成
  try {
    const first = await generateTextWithPrompt(
      llm,
      { provider: input.provider, model: input.model, system, user },
      { signal: options.signal },
    )
    html = extractHtmlFromReply(first.text)
  } catch {
    return null
  }

  let rounds = 0
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    rounds = round
    const errors = scanHtmlSandbox(html)
    if (errors.length === 0 && html.trim()) {
      return { html, usedFallback: false, rounds }
    }
    if (round >= MAX_REPAIR_ROUNDS) break

    options.onRound?.(round + 1)
    // 把错误回传 LLM 修复，温度降到 0.25（提高确定性）
    const repairPrompt = JSON.stringify({
      task: '请修复以下视频 HTML 动画代码的规范错误，仍只返回严格 JSON {"html": "..."}。',
      errors,
      currentHtml: html,
      reminder: '保持 window.__seekToFrame / window.__totalFrames 契约，禁止 Math.random / Date / fetch 等。',
    })
    try {
      const fixed = await generateTextWithPrompt(
        llm,
        { provider: input.provider, model: input.model, system, user: repairPrompt },
        { signal: options.signal },
      )
      const next = extractHtmlFromReply(fixed.text)
      if (next) html = next
    } catch {
      break
    }
  }

  return null
}
