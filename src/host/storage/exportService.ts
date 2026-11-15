import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StoragePaths } from './paths'
import { resolvePrivatePath } from './paths'

export type ExportFormat = 'markdown' | 'html' | 'zip'

export interface ExportResult {
  id: string
  format: ExportFormat
  fileName: string
  relativePath: string
  sizeBytes: number
}

export interface ExportableContent {
  title: string
  bodyMd: string
  bodyHtml: string
}

/** Minimal in-memory ZIP writer (no external dependency). */
function buildZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = []
  const encoder = new TextEncoder()
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)

    const localHeader = new Uint8Array(30)
    const dv = new DataView(localHeader.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true) // version needed
    dv.setUint16(6, 0x0800, true) // UTF-8 flag
    dv.setUint16(8, 0, true) // method stored
    dv.setUint16(10, dosTime, true)
    dv.setUint16(12, dosDate, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, entry.data.byteLength, true)
    dv.setUint32(22, entry.data.byteLength, true)
    dv.setUint16(26, nameBytes.byteLength, true)
    dv.setUint16(28, 0, true)

    chunks.push(localHeader, nameBytes, entry.data)

    const centralHeader = new Uint8Array(46)
    const cdv = new DataView(centralHeader.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0x0800, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, dosTime, true)
    cdv.setUint16(14, dosDate, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, entry.data.byteLength, true)
    cdv.setUint32(24, entry.data.byteLength, true)
    cdv.setUint16(28, nameBytes.byteLength, true)
    cdv.setUint32(42, offset, true)
    central.push(centralHeader, nameBytes)

    offset += 30 + nameBytes.byteLength + entry.data.byteLength
  }

  const centralStart = offset
  let centralSize = 0
  for (const c of central) centralSize += c.byteLength
  chunks.push(...central)

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralStart, true)
  chunks.push(eocd)

  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const result = new Uint8Array(total)
  let cursor = 0
  for (const c of chunks) {
    result.set(c, cursor)
    cursor += c.byteLength
  }
  return result
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.byteLength; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function sanitizeFileName(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'untitled'
}

/**
 * Exports a creation's content as Markdown, HTML, or a ZIP bundle containing
 * both. Files are written to the private `exports` directory.
 */
export class ExportService {
  constructor(private readonly paths: StoragePaths) {}

  /** Resolve an exported file's relative path to an absolute, sandboxed path. */
  resolveAbsolute(relativePath: string): string {
    return resolvePrivatePath(this.paths.root, relativePath)
  }

  export(content: ExportableContent, format: ExportFormat): ExportResult {
    const id = randomUUID()
    const baseName = sanitizeFileName(content.title)
    mkdirSync(this.paths.exports, { recursive: true })

    if (format === 'markdown') {
      const fileName = `${baseName}.md`
      const data = new TextEncoder().encode(content.bodyMd || content.bodyHtml || content.title)
      writeFileSync(join(this.paths.exports, fileName), data)
      return { id, format, fileName, relativePath: join('exports', fileName).replace(/\\/g, '/'), sizeBytes: data.byteLength }
    }

    if (format === 'html') {
      const fileName = `${baseName}.html`
      const data = new TextEncoder().encode(content.bodyHtml || escapeHtml(content.bodyMd || content.title))
      writeFileSync(join(this.paths.exports, fileName), data)
      return { id, format, fileName, relativePath: join('exports', fileName).replace(/\\/g, '/'), sizeBytes: data.byteLength }
    }

    // zip
    const mdName = `${baseName}.md`
    const htmlName = `${baseName}.html`
    const mdData = new TextEncoder().encode(content.bodyMd || content.bodyHtml || content.title)
    const htmlData = new TextEncoder().encode(content.bodyHtml || escapeHtml(content.bodyMd || content.title))
    const zipData = buildZip([
      { name: mdName, data: mdData },
      { name: htmlName, data: htmlData },
    ])
    const fileName = `${baseName}.zip`
    writeFileSync(join(this.paths.exports, fileName), zipData)
    return { id, format, fileName, relativePath: join('exports', fileName).replace(/\\/g, '/'), sizeBytes: zipData.byteLength }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
