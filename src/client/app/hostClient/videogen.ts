/**
 * Video generation (local: LLM → HTML → headless render → FFmpeg) over SSE.
 */

import { BASE, HostError } from './client'

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
  aspectRatio?: '16:9' | '9:16' | '1:1'
  durationSec?: number
  fps?: number
  provider?: string
  model?: string
  engine?: 'llm' | 'comfyui'
  backendId?: string
  sourceCreationId?: string
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
