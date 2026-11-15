import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComfyUIProvider } from './ComfyUIProvider'
import { ImageGenService } from './ImageGenService'
import { OpenAICompatImageProvider } from './OpenAICompatImageProvider'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('OpenAICompatImageProvider', () => {
  it('calls the images endpoint with baseUrl+model and decodes b64_json', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('fake-image').toString('base64') }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const provider = new OpenAICompatImageProvider({
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'secret',
      model: 'dall-e-3',
    })
    const images = await provider.generate({ prompt: 'a cat', count: 2 })

    expect(calls[0].url).toBe('https://api.example.com/v1/images/generations')
    expect(calls[0].body).toMatchObject({ model: 'dall-e-3', prompt: 'a cat', n: 2 })
    expect(images).toHaveLength(1)
    expect(images[0].data.toString()).toBe('fake-image')
    expect(images[0].mimeType).toBe('image/png')
  })

  it('throws on non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch
    const provider = new OpenAICompatImageProvider({ baseUrl: 'https://x', apiKey: 'k', model: 'm' })
    await expect(provider.generate({ prompt: 'p' })).rejects.toThrow(/401/)
  })
})

describe('ComfyUIProvider', () => {
  it('rejects when no checkpoint is configured', async () => {
    const provider = new ComfyUIProvider({ server: 'http://127.0.0.1:8188' })
    await expect(provider.generate({ prompt: 'p' })).rejects.toThrow(/checkpoint/)
  })

  it('submits a workflow, polls history, and fetches the image', async () => {
    const png = Buffer.from('png-bytes')
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 })
      }
      if (url.includes('/history/p1')) {
        return new Response(
          JSON.stringify({ p1: { outputs: { '7': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }),
          { status: 200 },
        )
      }
      if (url.includes('/view')) {
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const provider = new ComfyUIProvider({ server: 'http://127.0.0.1:8188', checkpoint: 'sd.safetensors' })
    const images = await provider.generate({ prompt: 'a cat', seed: 42 })

    expect(images).toHaveLength(1)
    expect(images[0].data.toString()).toBe('png-bytes')
    expect(images[0].meta?.seed).toBe(42)
  })
})

describe('ImageGenService', () => {
  it('lists configured providers and dispatches to the right one', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'YQ==' }] }), { status: 200 })) as unknown as typeof fetch

    const service = new ImageGenService({
      llm: { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' },
    })
    expect(service.available()).toEqual(['llm'])

    const images = await service.generate('llm', { prompt: 'p' })
    expect(images).toHaveLength(1)

    await expect(service.generate('comfyui', { prompt: 'p' })).rejects.toThrow(/未配置/)
  })
})
