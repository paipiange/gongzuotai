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

  it('switches to /images/edits (multipart) when a reference image is present', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body })
      return new Response(
        JSON.stringify({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const provider = new OpenAICompatImageProvider({ baseUrl: 'https://api.example.com/v1/', apiKey: 'secret', model: 'dall-e-3' })
    const dataUrl = `data:image/png;base64,${Buffer.from('ref-bytes').toString('base64')}`
    const images = await provider.generate({ prompt: 'make it sunny', image: dataUrl, size: 1024, count: 2 })

    expect(calls[0].url).toBe('https://api.example.com/v1/images/edits')
    const body = calls[0].body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('prompt')).toBe('make it sunny')
    expect(body.get('model')).toBe('dall-e-3')
    expect(body.get('n')).toBe('2')
    expect(body.get('size')).toBe('1024x1024')
    expect(body.get('image')).toBeInstanceOf(Blob)
    expect(images).toHaveLength(1)
    expect(images[0].data.toString()).toBe('edited')
  })

  it('appends all reference images (image + image2) when multiple are supplied', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body })
      return new Response(JSON.stringify({ data: [{ b64_json: 'YQ==' }] }), { status: 200 })
    }) as unknown as typeof fetch

    const provider = new OpenAICompatImageProvider({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' })
    const first = `data:image/png;base64,${Buffer.from('first').toString('base64')}`
    const second = `data:image/png;base64,${Buffer.from('second').toString('base64')}`
    await provider.generate({ prompt: 'p', images: [first, second] })

    expect(calls[0].url).toBe('https://x/v1/images/edits')
    const body = calls[0].body as FormData
    expect(body.get('image')).toBeInstanceOf(Blob)
    expect(body.get('image2')).toBeInstanceOf(Blob)
  })
})

describe('ComfyUIProvider', () => {
  it('falls back to the recommended split-model files when UNet/CLIP/VAE are blank', async () => {
    const png = Buffer.from('png-bytes')
    let submittedBody: Record<string, unknown> | undefined
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/prompt')) {
        submittedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 })
      }
      if (url.includes('/history/p1')) {
        return new Response(
          JSON.stringify({ p1: { status: { completed: true }, outputs: { '8': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }),
          { status: 200 },
        )
      }
      if (url.includes('/view')) {
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const provider = new ComfyUIProvider({ server: 'http://127.0.0.1:8188' })
    const images = await provider.generate({ prompt: 'p', seed: 7 })

    expect(images).toHaveLength(1)
    const prompt = (submittedBody?.prompt ?? {}) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    expect(prompt['1'].class_type).toBe('UNETLoader')
    expect(prompt['1'].inputs.unet_name).toBe('qwen_image_edit_2511_int8_convrot.safetensors')
    expect(prompt['2'].inputs.clip_name).toBe('qwen_2.5_vl_7b_fp8_scaled.safetensors')
    expect(prompt['3'].inputs.vae_name).toBe('qwen_image_vae.safetensors')
  })

  it('builds a split-model Qwen workflow and fetches the image', async () => {
    const png = Buffer.from('png-bytes')
    let submittedBody: Record<string, unknown> | undefined
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/prompt')) {
        submittedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 })
      }
      if (url.includes('/history/p1')) {
        return new Response(
          JSON.stringify({ p1: { status: { completed: true }, outputs: { '8': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }),
          { status: 200 },
        )
      }
      if (url.includes('/view')) {
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const provider = new ComfyUIProvider({
      server: 'http://127.0.0.1:8188',
      unet: 'qwen_image_edit_2511.safetensors',
      clip: 'qwen_2.5_vl_7b.safetensors',
      vae: 'qwen_image_vae.safetensors',
    })
    const images = await provider.generate({ prompt: 'a cat', seed: 42 })

    expect(images).toHaveLength(1)
    expect(images[0].data.toString()).toBe('png-bytes')
    expect(images[0].meta?.seed).toBe(42)

    const prompt = (submittedBody?.prompt ?? {}) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    expect(prompt['1'].class_type).toBe('UNETLoader')
    expect(prompt['2'].class_type).toBe('CLIPLoader')
    expect(prompt['3'].class_type).toBe('VAELoader')
    expect(prompt['4'].class_type).toBe('TextEncodeQwenImageEdit')
    expect(prompt['5'].class_type).toBe('EmptyQwenImageLayeredLatentImage')
    expect(prompt['1'].inputs.unet_name).toBe('qwen_image_edit_2511.safetensors')
  })

  it('uploads a reference image and builds an img2img workflow for repainting', async () => {
    const png = Buffer.from('png-bytes')
    const calls: Array<{ url: string; body?: unknown }> = []
    let submittedBody: Record<string, unknown> | undefined
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body })
      if (url.endsWith('/upload/image')) {
        return new Response(JSON.stringify({ name: 'ref.png' }), { status: 200 })
      }
      if (url.endsWith('/prompt')) {
        submittedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 })
      }
      if (url.includes('/history/p1')) {
        return new Response(
          JSON.stringify({ p1: { status: { completed: true }, outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }),
          { status: 200 },
        )
      }
      if (url.includes('/view')) {
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const provider = new ComfyUIProvider({
      server: 'http://127.0.0.1:8188',
      unet: 'qwen_image_edit_2511.safetensors',
      clip: 'qwen_2.5_vl_7b.safetensors',
      vae: 'qwen_image_vae.safetensors',
    })
    const dataUrl = `data:image/png;base64,${Buffer.from('ref-image-bytes').toString('base64')}`
    const images = await provider.generate({ prompt: 'make it sunny', image: dataUrl, denoise: 0.6 })

    expect(images).toHaveLength(1)
    // The reference image was uploaded first.
    expect(calls.some((c) => c.url.endsWith('/upload/image'))).toBe(true)
    // The img2img workflow uses LoadImage + VAEEncode + KSampler with denoise.
    const prompt = (submittedBody?.prompt ?? {}) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    expect(prompt['5'].class_type).toBe('LoadImage')
    expect(prompt['6'].class_type).toBe('VAEEncode')
    expect(prompt['7'].class_type).toBe('KSampler')
    expect(prompt['7'].inputs.denoise).toBe(0.6)
    expect(prompt['5'].inputs.image).toBe('ref.png')
  })

  it('propagates ComfyUI execution errors', async () => {
    globalThis.fetch = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/prompt')) {
        return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 })
      }
      if (url.includes('/history/p1')) {
        return new Response(
          JSON.stringify({ p1: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'dim mismatch' }]] } } }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch

    const provider = new ComfyUIProvider({ server: 'http://x', checkpoint: 'sd.safetensors' })
    await expect(provider.generate({ prompt: 'p' })).rejects.toThrow(/dim mismatch/)
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
