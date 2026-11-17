import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { ComfyVideoGenerator } from './comfyVideo'
import { encodeFramesToMp4 } from './encoder'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 用最小 PNG 字节模拟帧图（ComfyUI 返回内容我们只看字节数）。
// 连通测试（fetchFrames）只验证字节数，用任意二进制即可；
// encodeFramesToMp4 需要真实可解码且宽高为偶数的图片才能过 libx264，
// 故合成测试单独用一张 64x64 有效 PNG。
const FAKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const REAL_PNG_64 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAb0lEQVR4nO3PAQkAAAyEwO8feiyGCMIF0G0nxxc0IMcXNCDHFzQgxxc0IMcXNCDHFzQgxxc0IMcXNCDHFzQgxxc0IMcXNCDHFzQgxxc0IMcXNCDHFzQgxxc0IMcXNCDHFzQgxxc0IMcXNCDHFzSg9sFe4OIMD8UiAAAAAElFTkSuQmCC',
  'base64',
)

describe('ComfyVideoGenerator', () => {
  let server: Server
  let base = ''

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? ''
      if (url === '/prompt' && req.method === 'POST') {
        let body = ''
        req.on('data', (d) => (body += d))
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ prompt_id: 'test-prompt-123' }))
        })
        return
      }
      if (url.startsWith('/history/')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            'test-prompt-123': {
              status: { completed: true, status_str: 'success' },
              outputs: {
                '8': {
                  images: [
                    { filename: 'frame_0.png', type: 'output', subfolder: '' },
                    { filename: 'frame_1.png', type: 'output', subfolder: '' },
                    { filename: 'frame_2.png', type: 'output', subfolder: '' },
                  ],
                },
              },
            },
          }),
        )
        return
      }
      if (url.startsWith('/view')) {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(FAKE_PNG)
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('产出多帧序列（frames=3）', async () => {
    const gen = new ComfyVideoGenerator({
      server: base,
      unet: 'qwen_image_edit_2511_int8_convrot.safetensors',
      clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
      vae: 'qwen_image_vae.safetensors',
    })
    const result = await gen.generate({ prompt: '测试帧序列', frames: 3, width: 1280, height: 720 })
    expect(result.frames).toHaveLength(3)
    expect(result.width).toBe(1280)
    expect(result.height).toBe(720)
    expect(result.promptId).toBe('test-prompt-123')
  })
})

describe('encodeFramesToMp4', () => {
  it('把 PNG 帧序列合成有效 MP4（ftyp 魔数）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paipiange-test-'))
    const out = join(dir, 'out.mp4')
    try {
      await encodeFramesToMp4({ frames: [REAL_PNG_64, REAL_PNG_64, REAL_PNG_64], fps: 3, outMp4Path: out, frameExt: 'png' })
      expect(existsSync(out)).toBe(true)
      const { readFileSync } = await import('node:fs')
      const buf = readFileSync(out)
      // ftyp box 魔数
      expect(buf.subarray(4, 8).toString('ascii')).toBe('ftyp')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})
