/**
 * Text generation (streaming over SSE) + text-gen config + providers.
 */

import { BASE, HostError, apiFetch } from './client'
import type { GenerationOrigin, TaskRecord, TextGenConfig, TextGenProgress, TextGenProviders, TextStudio } from './types'

/**
 * Streams a text generation from the Host's Harness `llm` service over SSE.
 * Calls `onEvent` for each delta / usage / finish / error frame, then resolves
 * with the assembled full text. Throws a `HostError` on transport failure.
 */
export async function generateTextStream(
  input: {
    provider?: string
    model: string
    studio: TextStudio
    topic: string
    style?: string
    requirement?: string
    platform?: string
    images?: string[]
    baseUrl?: string
    apiKey?: string
    backendId?: string
    origin?: GenerationOrigin
    clientRequestId?: string
  },
  onEvent: (event: TextGenProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${BASE}.textgen.generate`, {
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

  let text = ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (rawEvent: string, data: string) => {
    if (rawEvent === 'delta') {
      text += data
      onEvent({ delta: data })
    } else if (rawEvent === 'usage') {
      try {
        onEvent({ usage: JSON.parse(data) as TextGenProgress['usage'] })
      } catch {
        // ignore malformed usage frame
      }
    } else if (rawEvent === 'finish') {
      try {
        onEvent({ finishReason: (JSON.parse(data) as { reason?: string }).reason })
      } catch {
        // ignore malformed finish frame
      }
    } else if (rawEvent === 'error') {
      try {
        const parsed = JSON.parse(data) as { message?: string }
        onEvent({ error: parsed.message ?? '生成失败' })
      } catch {
        onEvent({ error: data || '生成失败' })
      }
    }
  }

  // Minimal SSE parser: frames are separated by a blank line, each frame may
  // carry multiple `event:` / `data:` lines.
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let rawEvent = 'message'
      let dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) rawEvent = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      dispatch(rawEvent, dataLines.join('\n'))
      boundary = buffer.indexOf('\n\n')
    }
  }

  return text
}

export async function enqueueTextGeneration(input: Parameters<typeof generateTextStream>[0] & {
  sourceCreationId?: string
  priority?: number
  maxAttempts?: number
}): Promise<TaskRecord> {
  const data = await apiFetch<{ task: TaskRecord }>('.textgen.enqueue', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.task
}

// ---- Text-gen config ----

export async function getTextGenConfig(): Promise<TextGenConfig> {
  const data = await apiFetch<{ config: TextGenConfig }>('.textgen.config')
  return data.config
}

export async function saveTextGenConfig(config: TextGenConfig): Promise<TextGenConfig> {
  const data = await apiFetch<{ config: TextGenConfig }>('.textgen.config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
  return data.config
}

export async function listTextGenProviders(): Promise<TextGenProviders> {
  const data = await apiFetch<TextGenProviders>('.textgen.providers')
  return data
}
