import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateAmbientMusic } from './musicService'

describe('musicService.generateAmbientMusic', () => {
  it('生成合法长度的 16-bit 立体声 WAV', () => {
    const out = join(tmpdir(), `paipiange-music-${Date.now()}.wav`)
    const durationSec = 3
    generateAmbientMusic(out, { durationSec, volume: 0.4, bpm: 90 })

    expect(existsSync(out)).toBe(true)
    const buf = readFileSync(out)
    // RIFF 头 + 数据大小
    expect(buf.subarray(0, 4).toString()).toBe('RIFF')
    expect(buf.subarray(8, 12).toString()).toBe('WAVE')
    // 双声道 + 44100 + 16bit
    expect(buf.readUInt16LE(22)).toBe(2)
    expect(buf.readUInt32LE(24)).toBe(44100)
    expect(buf.readUInt16LE(34)).toBe(16)
    // 数据大小 = 时长 * 采样率 * 2声道 * 2字节
    const expectedDataSize = durationSec * 44100 * 2 * 2
    expect(buf.readUInt32LE(40)).toBe(expectedDataSize)
    expect(buf.length).toBe(44 + expectedDataSize)
  })

  it('极短时长也能生成（不崩溃）', () => {
    const out = join(tmpdir(), `paipiange-music-short-${Date.now()}.wav`)
    generateAmbientMusic(out, { durationSec: 0.1 })
    expect(existsSync(out)).toBe(true)
    expect(statSync(out).size).toBeGreaterThan(44)
  })
})
