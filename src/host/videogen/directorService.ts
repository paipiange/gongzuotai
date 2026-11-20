/**
 * 视频生成 · 多幕导演脚本服务
 *
 * 把 DIRECTOR 方法论压缩成 system prompt，让 LLM 从「主题 + 风格」产出一份
 * 结构化多幕脚本（scene.json）：钩子 → 展开 → 转折 → 落点，每幕含分镜、旁白、
 * 字幕、时长与节奏点。这是「完整视频工作流」的叙事大脑，向下驱动分段画面渲染、
 * TTS 旁白与配乐（TTS/配乐为后续 P2/P3，此处只产出文本结构）。
 *
 * 方法论来源（原创改写，不含上游受保护表达）：
 *  - 一个主体、一个目标、一次转折，开头 3 秒钩子，结尾与开头呼应
 *  - 每个镜头有理由，至少四种不同运镜，一次招牌镜头
 *  - 声音是半个电影：每个可见动作有声音，至少两次真实静默
 *  - 节奏：先写 cue map，画面锁定节拍，一张一弛
 */

import type { LlmService } from '../textgen/types'
import { generateTextWithPrompt } from '../textgen/textGenService'
import { styleToPrompt, getStyle } from './styles'

/** 一幕分镜。 */
export interface Scene {
  /** 幕序号，从 1 开始 */
  no: number
  /** 幕类型：hook 钩子 / develop 展开 / turn 转折 / resolve 落点 */
  type: 'hook' | 'develop' | 'turn' | 'resolve'
  /** 幕标题（画面大字） */
  title: string
  /** 幕副标题/正文 */
  subtitle: string
  /** 视觉描述（给视频 LLM 的画面 brief） */
  visual: string
  /** 运镜（push/pull/pan/track/crane/zoom 等） */
  camera: string
  /** 时长（秒） */
  durationSec: number
  /** 旁白文案（可空，TTS 用） */
  narration: string
}

/** 完整多幕脚本。 */
export interface DirectorScript {
  topic: string
  styleId: string
  /** 一句话梗概（logline） */
  logline: string
  /** 幕结构 */
  scenes: Scene[]
  /** 总时长（秒） */
  totalDurationSec: number
}

export interface DirectorInput {
  topic: string
  /** 主题补充（副标题/要求） */
  subtitle?: string
  /** 风格 id */
  styleId?: string
  /** 目标总时长（秒） */
  durationSec: number
  /** 幕数（默认 4） */
  sceneCount?: number
  provider: string
  model: string
}

const MAX_SCENES = 8
const MIN_SCENES = 2

/** 构建导演 system prompt（方法论原文原创改写）。 */
function buildDirectorSystem(stylePrompt: string): string {
  return [
    '你是一位电影导演，负责把一个主题编排成一段结构完整、有电影感的短视频脚本。',
    '',
    '创作原则：',
    '1. 一个主体、一个目标、一次转折：开头与结尾不同，结尾呼应开头。',
    '2. 前 3 秒必须有钩子，不要先放 logo 或慢悠悠的标题。',
    '3. 每幕有明确的作用：hook（抓眼球）→ develop（展开）→ turn（转折/高潮）→ resolve（落点/收尾）。',
    '4. 每个镜头要有理由，运镜要多样（推/拉/摇/移/升降/变焦），至少一个招牌镜头。',
    '5. 节奏一张一弛：快慢交替，给观众一次喘息（一个长镜头或停顿）。',
    '6. 旁白口语化、精炼，与画面互补而不重复；字幕简短（每幕一行大字）。',
    '7. 只返回合法 JSON，不加 Markdown 代码块或解释。',
    '',
    stylePrompt ? `\n【本片视觉风格】\n${stylePrompt}\n` : '',
    '',
    '输出 JSON 结构：',
    '{',
    '  "logline": "一句话梗概",',
    '  "scenes": [',
    '    {"no":1,"type":"hook","title":"","subtitle":"","visual":"","camera":"","durationSec":3,"narration":""}',
    '  ]',
    '}',
  ].filter(Boolean).join('\n')
}

/** 构建 user prompt。 */
function buildDirectorUser(input: DirectorInput): string {
  const sceneCount = Math.min(Math.max(input.sceneCount ?? 4, MIN_SCENES), MAX_SCENES)
  return [
    `主题：${input.topic}`,
    input.subtitle ? `补充：${input.subtitle}` : '',
    `目标总时长：${input.durationSec} 秒`,
    `幕数：${sceneCount} 幕（每幕时长合计约等于目标总时长，允许 ±1 秒）`,
    '',
    '请把主题编排成这个结构的多幕脚本，直接返回严格 JSON。',
  ].filter(Boolean).join('\n')
}

/** 容错解析脚本 JSON。 */
export function parseDirectorScript(text: string, fallback: { topic: string; styleId?: string; durationSec: number }): DirectorScript | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
      logline?: unknown
      scenes?: Array<Record<string, unknown>>
    }
    const scenes = Array.isArray(obj.scenes)
      ? obj.scenes
          .map((s, i) => ({
            no: Number(s.no ?? i + 1),
            type: (['hook', 'develop', 'turn', 'resolve'].includes(String(s.type)) ? String(s.type) : 'develop') as Scene['type'],
            title: String(s.title ?? ''),
            subtitle: String(s.subtitle ?? ''),
            visual: String(s.visual ?? ''),
            camera: String(s.camera ?? ''),
            durationSec: Math.max(0.5, Number(s.durationSec ?? 3)),
            narration: String(s.narration ?? ''),
          }))
          .filter((s) => s.title || s.visual)
      : []
    if (scenes.length === 0) return null
    return {
      topic: fallback.topic,
      styleId: fallback.styleId ?? '',
      logline: String(obj.logline ?? fallback.topic),
      scenes,
      totalDurationSec: scenes.reduce((a, s) => a + s.durationSec, 0),
    }
  } catch {
    return null
  }
}

/** 生成多幕脚本；失败返回 null（由调用方降级为单幕）。 */
export async function generateDirectorScript(
  llm: LlmService,
  input: DirectorInput,
  options: { signal?: AbortSignal } = {},
): Promise<DirectorScript | null> {
  const style = input.styleId ? getStyle(input.styleId) : undefined
  const stylePrompt = style ? styleToPrompt(style) : ''
  const system = buildDirectorSystem(stylePrompt)
  const user = buildDirectorUser(input)

  try {
    const result = await generateTextWithPrompt(
      llm,
      { provider: input.provider, model: input.model, system, user },
      { signal: options.signal },
    )
    return parseDirectorScript(result.text, {
      topic: input.topic,
      styleId: input.styleId,
      durationSec: input.durationSec,
    })
  } catch {
    return null
  }
}
