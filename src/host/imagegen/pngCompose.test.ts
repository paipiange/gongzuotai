import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { composeSideBySide } from './pngCompose'

/** 生成一张纯色 8-bit RGB PNG（无隔行），用于拼接测试。 */
function makePng(width: number, height: number, rgb: [number, number, number]): string {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const crc32 = (buf: Buffer) => {
    let c = ~0
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const t = Buffer.from(type, 'ascii')
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // truecolor
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < width; x++) {
      const off = y * (stride + 1) + 1 + x * 3
      raw[off] = rgb[0]
      raw[off + 1] = rgb[1]
      raw[off + 2] = rgb[2]
    }
  }
  const idat = deflateSync(raw)
  const buf = Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
  return `data:image/png;base64,${buf.toString('base64')}`
}

describe('composeSideBySide', () => {
  it('stiches two same-size PNGs side by side into a 2x-width RGBA PNG', () => {
    const left = makePng(10, 10, [255, 0, 0])
    const right = makePng(10, 10, [0, 0, 255])
    const out = composeSideBySide(left, right)

    expect(out.startsWith('data:image/png;base64,')).toBe(true)
    const buf = Buffer.from(out.split(',')[1], 'base64')
    // IHDR 宽高在字节 16/20 处
    expect(buf.readUInt32BE(16)).toBe(20)
    expect(buf.readUInt32BE(20)).toBe(10)
  })

  it('normalizes differing heights to the taller image', () => {
    const left = makePng(10, 20, [255, 0, 0])
    const right = makePng(10, 10, [0, 0, 255])
    const out = composeSideBySide(left, right)
    const buf = Buffer.from(out.split(',')[1], 'base64')
    expect(buf.readUInt32BE(20)).toBe(20)
  })

  it('throws on a non-PNG data URL', () => {
    expect(() => composeSideBySide('data:image/jpeg;base64,AAAA', 'data:image/png;base64,AAAA')).toThrow()
  })
})
