/**
 * 生图 prompt 拼接：把用户主题 + handraw-style 风格/排版/主题色组合成一段
 * 可直接送入 LLM 或 ComfyUI 的中文提示词。纯函数，便于单测。
 */

import type { StylePreset, LayoutPreset, ColorPreset } from './stylePresets'

export interface PromptBuildInput {
  /** 用户输入的主题/画面描述。 */
  topic: string
  /** 选中的视觉风格。 */
  style?: StylePreset
  /** 选中的排版图型（小红书社媒卡 / 公众号信息图等）。 */
  layout?: LayoutPreset
  /** 选中的主题色。 */
  color?: ColorPreset
}

/**
 * 组合最终提示词。顺序：主题 → 风格特征 → 排版要求 → 主题色限定。
 * 采用 handraw-style 的中英双语思路：保留中文主题，风格/排版用中文特征描述，
 * 让 gpt-image / ComfyUI 等模型都能稳定激活画风。
 */
export function buildImagePrompt(input: PromptBuildInput): string {
  const parts: string[] = []

  const topic = input.topic.trim()
  if (topic) parts.push(topic)

  if (input.style) {
    parts.push(`画风：${input.style.name}（${input.style.group}，参考 ${input.style.ref}）。核心风格特征：${input.style.traits}`)
  }

  if (input.layout) {
    parts.push(`排版：${input.layout.name}。${input.layout.prompt}`)
  }

  if (input.color) {
    parts.push(input.color.prompt)
  }

  if (parts.length === 0) return ''

  // 末段附加生图引导：文字参与构图，图文一体。
  return `${parts.join('\n')}\n\n整体构图简洁，文字与画面一体化，主视觉突出。`
}

/** 简洁的 prompt 预览（用于结果区展示，去掉过长的 traits 换行）。 */
export function buildPromptSummary(input: PromptBuildInput): string {
  const tags: string[] = []
  if (input.style) tags.push(`风格 ${input.style.id}`)
  if (input.layout) tags.push(`排版 ${input.layout.id}`)
  if (input.color) tags.push(`色 ${input.color.id}`)
  return tags.length ? tags.join(' · ') : '无风格预设'
}
