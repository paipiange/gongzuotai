/**
 * Video generation (local: LLM → HTML → headless render → FFmpeg) over SSE.
 */

import { BASE, HostError, apiFetch } from './client'
import type { GenerationOrigin, TaskRecord } from './types'

/** 视频风格分类（与 host 端 styles/types.ts 的 StyleCategory 对应）。 */
export interface VideoStyleCategory {
  id: string
  en: string
  cn: string
}

/** 视频风格元信息（供风格选择器渲染，规则字段不外泄）。 */
export interface VideoStyleMeta {
  id: string
  en: string
  cn: string
  category: string
  essence: string
}

/** 风格库（分类 + 风格列表），由 /api/paipiange.video.styles 返回。 */
export interface VideoStyleLibrary {
  categories: VideoStyleCategory[]
  styles: VideoStyleMeta[]
}

/** 常用中文旁白音色（edge-tts），供前端音色下拉渲染。 */
export const VIDEO_VOICES: { id: string; label: string }[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女·温暖·讲解）' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（女·活泼）' },
  { id: 'zh-CN-YunxiNeural', label: '云希（男·阳光）' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（男·专业·新闻）' },
  { id: 'zh-CN-YunjianNeural', label: '云健（男·激情）' },
]

/** 拉取视频风格资产库（99 种原创风格），供前端风格选择器渲染。 */
export async function fetchVideoStyles(): Promise<VideoStyleLibrary> {
  return apiFetch<VideoStyleLibrary>('/.video.styles')
}

export interface VideoGenProgress {
  stage: 'coding' | 'repair' | 'render' | 'comfy' | 'encode' | 'done'
  message?: string
  round?: number
  frame?: number
  total?: number
}

export interface VideoGenResult {
  assetId: string
  width: number
  height: number
  fps: number
  usedFallback: boolean
}

export interface VideoGenInput {
  topic: string
  subtitle?: string
  style?: string
  /** 视频风格 id（99 种原创风格库，如 "ink-wash"），命中后注入风格约束。 */
  styleId?: string
  /** 是否启用多幕导演脚本（钩子→展开→转折→落点）。 */
  multiScene?: boolean
  /** 多幕幕数（multiScene=true 时生效，默认 3）。 */
  sceneCount?: number
  /** TTS 旁白音色 id（edge-tts）。仅多幕模式生效。 */
  voice?: string
  /** TTS 代理地址，为空时直连（默认走本机 Clash 7890）。 */
  ttsProxy?: string
  /** 是否生成程序化配乐（多幕模式默认 true）。 */
  music?: boolean
  aspectRatio?: '16:9' | '9:16' | '1:1'
  durationSec?: number
  fps?: number
  provider?: string
  model?: string
  engine?: 'llm' | 'comfyui' | 'remotion'
  /** Remotion 双引擎画面风格（如 "tech" / "ink-wash"）。 */
  remotionStyle?: string
  /** Remotion 双引擎配乐方案（auto / 纯音乐卡点等）。 */
  remotionBgmMode?: string
  /** Remotion 双引擎旁白音色 id。 */
  remotionVoiceId?: string
  /** Remotion 双引擎画质（720p / 1080p / 2K / 4K）。 */
  remotionQuality?: string
  backendId?: string
  sourceCreationId?: string
  origin?: GenerationOrigin
  clientRequestId?: string
}

/**
 * Streams a local video generation from the Host over SSE. Calls `onEvent` for
 * each progress / result / error frame and resolves with the final result (which
 * carries the assetId of the finished MP4, retrievable via `/api/paipiange.asset`).
 */
export async function generateVideoStream(
  input: VideoGenInput,
  onEvent: (event: VideoGenProgress & { error?: string; result?: VideoGenResult }) => void,
  signal?: AbortSignal,
): Promise<VideoGenResult> {
  let response: Response
  try {
    response = await fetch(`${BASE}.video.generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw new HostError('已取消生成', 0)
    throw new HostError(`无法连接到本地服务: ${cause instanceof Error ? cause.message : String(cause)}`, 0)
  }
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new HostError(body?.error ?? `生成失败 (HTTP ${response.status})`, response.status)
  }

  let finalResult: VideoGenResult | null = null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (rawEvent: string, data: string) => {
    if (rawEvent === 'progress') {
      try {
        onEvent(JSON.parse(data) as VideoGenProgress)
      } catch {
        // ignore malformed progress frame
      }
    } else if (rawEvent === 'result') {
      try {
        finalResult = JSON.parse(data) as VideoGenResult
        onEvent({ stage: 'done', result: finalResult })
      } catch {
        // ignore malformed result frame
      }
    } else if (rawEvent === 'error') {
      try {
        const parsed = JSON.parse(data) as { message?: string }
        onEvent({ stage: 'done', error: parsed.message ?? '生成失败' })
      } catch {
        onEvent({ stage: 'done', error: data || '生成失败' })
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let rawEvent = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) rawEvent = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      dispatch(rawEvent, dataLines.join('\n'))
      boundary = buffer.indexOf('\n\n')
    }
  }

  if (!finalResult) throw new HostError('生成未返回结果', 0)
  return finalResult
}

export async function enqueueVideoGeneration(input: Parameters<typeof generateVideoStream>[0] & {
  sourceCreationId?: string
  priority?: number
  maxAttempts?: number
}): Promise<TaskRecord> {
  const data = await apiFetch<{ task: TaskRecord }>('.video.enqueue', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.task
}
