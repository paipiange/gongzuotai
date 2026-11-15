import { describe, expect, it, vi } from 'vitest'
import { generateText, generateTextDirect } from './textGenService'
import type { LlmService, StreamChunk } from './types'

// 用一个内存假 llm 服务验证：prepareCall 的入参形状、text-delta 折叠、
// usage/finish 提取，以及 abort 后提前收尾。

function fakeLlm(chunks: StreamChunk[], capture: { config?: unknown } = {}): LlmService {
  return {
    prepareCall(config) {
      capture.config = config
      return Promise.resolve({
        stream: async function* (): AsyncIterable<StreamChunk> {
          for (const chunk of chunks) yield chunk
        },
      })
    },
    listProviders() {
      return []
    },
  }
}

function delta(text: string): StreamChunk {
  return { type: 'text-delta', index: 0, text }
}

describe('textGenService (Harness llm consumer)', () => {
  it('folds text-delta into the full text and reports usage/finish', async () => {
    const capture: { config?: unknown } = {}
    const llm = fakeLlm(
      [
        { type: 'block-start', index: 0, blockType: 'text' },
        delta('春'),
        delta('日'),
        delta('花'),
        delta('影'),
        { type: 'block-end', index: 0, block: {} },
        { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } },
        { type: 'finish', reason: 'stop' },
      ],
      capture,
    )

    const result = await generateText(llm, {
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      studio: 'article',
      topic: '春日',
      style: 'poetic',
    })

    expect(result.text).toBe('春日花影')
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 4 })
    expect(result.finishReason).toBe('stop')
  })

  it('shapes the request with a studio-specific system prompt and user message', async () => {
    const capture: { config?: any } = {}
    const llm = fakeLlm([{ type: 'finish', reason: 'stop' }], capture)

    await generateText(llm, {
      provider: 'pi-ai',
      model: 'gpt-4o',
      studio: 'headline',
      topic: '新品上市',
      requirement: '8 个字以内',
    })

    const config = capture.config as any
    expect(config.provider).toBe('pi-ai')
    expect(config.model).toBe('gpt-4o')
    expect(config.system).toContain('标题')
    expect(config.messages).toEqual([{ role: 'user', content: '主题：新品上市\n补充要求：8 个字以内' }])
  })

  it('stops early on abort without emitting further text', async () => {
    const controller = new AbortController()
    const llm: LlmService = {
      prepareCall(_config, signal) {
        return Promise.resolve({
          async *stream(): AsyncIterable<StreamChunk> {
            yield delta('第一段')
            controller.abort()
            // This delta is emitted after abort; generateText should stop folding.
            yield delta('第二段')
          },
        })
      },
      listProviders() {
        return []
      },
    }

    const result = await generateText(
      llm,
      { provider: 'p', model: 'm', studio: 'marketing', topic: 't' },
      { signal: controller.signal },
    )

    expect(result.text).toBe('第一段')
    expect(result.finishReason).toBe('aborted')
  })
})

describe('generateTextDirect (OpenAI-compatible third-party API)', () => {
  function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder()
    const body = chunks.join('\n\n')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }

  it('folds choices[].delta.content and extracts usage/finish_reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{"content":"世界"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        'data: [DONE]',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateTextDirect(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' },
      { provider: '', model: 'gpt-4o-mini', studio: 'article', topic: '测试' },
    )

    expect(result.text).toBe('你好世界')
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 })
    expect(result.finishReason).toBe('stop')

    // 校验请求 URL 与鉴权头
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')

    vi.unstubAllGlobals()
  })

  it('throws with the HTTP status on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateTextDirect(
        { baseUrl: 'https://api.example.com/v1', apiKey: 'bad', model: 'm' },
        { provider: '', model: 'm', studio: 'article', topic: 't' },
      ),
    ).rejects.toThrow(/401/)

    vi.unstubAllGlobals()
  })
})
