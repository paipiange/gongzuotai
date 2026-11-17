import { deflateSync, inflateSync } from 'node:zlib'

/**
 * 纯 Node（零第三方依赖）的 PNG 工具：用于把两张参考图左右拼接成一张，
 * 交给 Qwen-Image-Edit 这类「单图编辑」模型，实现双角色（男主 + 女主）锁定。
 *
 * 仅支持非隔行（interlace=0）的 8-bit 真彩/灰阶 PNG（AI 出图均为该格式）。
 * 遇到不支持的类型时抛出明确错误，由调用方降级为「只用第一张参考图」。
 */

interface PngImage {
  width: number
  height: number
  /** 每像素通道数：1（灰阶）、2（灰阶+alpha）、3（RGB）、4（RGBA）。 */
  channels: number
  /** 已去滤波的原始像素（每行含 1 字节 filter 前缀已剥离）。 */
  data: Buffer
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** 解析 PNG 文件为 { width, height, channels, data }。data 为去滤波后的像素。 */
function decodePng(buf: Buffer): PngImage {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('不是有效的 PNG 文件')

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []

  let offset = 8
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }

  if (!width || !height) throw new Error('PNG 缺少 IHDR')
  if (interlace !== 0) throw new Error('不支持隔行扫描的 PNG')
  if (bitDepth !== 8) throw new Error('仅支持 8-bit PNG')

  const channelsByColorType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const channels = channelsByColorType[colorType]
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  const bpp = channels

  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos]
    pos += 1
    const rowStart = y * stride
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos + x]
      const a = x >= bpp ? out[rowStart + x - bpp] : 0
      const b = y > 0 ? out[rowStart - stride + x] : 0
      const c = (x >= bpp && y > 0) ? out[rowStart - stride + x - bpp] : 0
      let val: number
      switch (filter) {
        case 0: val = rawByte; break
        case 1: val = rawByte + a; break
        case 2: val = rawByte + b; break
        case 3: val = rawByte + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          val = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: throw new Error(`未知滤波类型 ${filter}`)
      }
      out[rowStart + x] = val & 0xff
    }
    pos += stride
  }

  return { width, height, channels, data: out }
}

function encodePng(img: PngImage): Buffer {
  const stride = img.width * img.channels
  const raw = Buffer.alloc((stride + 1) * img.height)
  let pos = 0
  for (let y = 0; y < img.height; y++) {
    raw[pos] = 0 // filter type 0 (None)
    pos += 1
    img.data.copy(raw, pos, y * stride, (y + 1) * stride)
    pos += stride
  }

  const idat = deflateSync(raw, { level: 6 })

  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'ascii')
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
    return Buffer.concat([len, typeBuf, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[img.channels]! // color type
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

/** 最近邻缩放（保持像素值，避免引入色彩漂移）。 */
function scale(img: PngImage, targetW: number, targetH: number): PngImage {
  if (img.width === targetW && img.height === targetH) return img
  const stride = targetW * img.channels
  const data = Buffer.alloc(stride * targetH)
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / targetH))
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / targetW))
      const srcOffset = sy * img.width * img.channels + sx * img.channels
      const dstOffset = y * stride + x * img.channels
      data.set(img.data.subarray(srcOffset, srcOffset + img.channels), dstOffset)
    }
  }
  return { width: targetW, height: targetH, channels: img.channels, data }
}

/**
 * 把两张 data-URL 参考图左右并排拼成一张 PNG，返回 data URL。
 * 统一通道数（都转成 RGBA）、按较高者等比缩放到等高，避免比例失真。
 */
export function composeSideBySide(left: string, right: string): string {
  const leftImg = decodePng(dataUrlToBuffer(left))
  const rightImg = decodePng(dataUrlToBuffer(right))

  const channels = 4
  const toRgba = (img: PngImage): PngImage => {
    if (img.channels === 4) return img
    const stride = img.width * 4
    const data = Buffer.alloc(stride * img.height)
    for (let i = 0; i < img.width * img.height; i++) {
      const s = i * img.channels
      const d = i * 4
      data[d] = img.data[s]
      data[d + 1] = img.channels >= 3 ? img.data[s + 1] : img.data[s]
      data[d + 2] = img.channels >= 3 ? img.data[s + 2] : img.data[s]
      data[d + 3] = img.channels === 2 || img.channels === 4 ? img.data[s + img.channels - 1] : 255
    }
    return { width: img.width, height: img.height, channels: 4, data }
  }

  const l = toRgba(leftImg)
  const r = toRgba(rightImg)

  const height = Math.max(l.height, r.height)
  const ls = scale(l, Math.max(1, Math.round((l.width * height) / l.height)), height)
  const rs = scale(r, Math.max(1, Math.round((r.width * height) / r.height)), height)

  const width = ls.width + rs.width
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    ls.data.copy(data, y * width * 4, y * ls.width * 4, (y + 1) * ls.width * 4)
    rs.data.copy(data, y * width * 4 + ls.width * 4, y * rs.width * 4, (y + 1) * rs.width * 4)
  }

  const out = encodePng({ width, height, channels: 4, data })
  return `data:image/png;base64,${out.toString('base64')}`
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/)
  if (!match) throw new Error('参考图必须是 base64 编码的 PNG/JPEG/WebP')
  if (match[1] !== 'png') throw new Error('双参考图拼接仅支持 PNG')
  return Buffer.from(match[2], 'base64')
}

/**
 * 若 PNG 参考图最长边超过 `maxDim`，则等比缩到 `maxDim` 以内再重新编码。
 * 大参考图（如 2.6MB 角色图）会让上游网关的图生图接口处理变慢、触发
 * Cloudflare 524 / 网关 504 超时，缩小后能显著降低超时概率。
 * 仅处理 PNG（角色参考图均为 PNG）；其它格式（JPEG/WebP）原样返回。
 */
export function downscaleDataUrlIfNeeded(dataUrl: string, maxDim = 1024): string {
  const match = dataUrl.match(/^data:image\/(png);base64,(.+)$/)
  if (!match) return dataUrl // 非 PNG 原样返回
  let img: PngImage
  try {
    img = decodePng(Buffer.from(match[2], 'base64'))
  } catch {
    return dataUrl // 解码失败原样返回，交给上游报错
  }
  const max = Math.max(img.width, img.height)
  if (max <= maxDim) return dataUrl
  const ratio = maxDim / max
  const targetW = Math.max(1, Math.round(img.width * ratio))
  const targetH = Math.max(1, Math.round(img.height * ratio))
  const scaled = scale(img, targetW, targetH)
  const out = encodePng(scaled)
  return `data:image/png;base64,${out.toString('base64')}`
}
