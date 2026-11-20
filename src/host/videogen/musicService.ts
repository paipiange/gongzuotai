/**
 * 程序化配乐服务（P2，第一版轻量）
 *
 * 用纯 Node 合成一段适合短视频的氛围配乐（WAV），不依赖外部采样库。
 * 生成逻辑：温暖的和弦 pad（多个正弦谐波叠加，缓慢呼吸）+ 轻柔的低频节奏脉冲，
 * 首尾做淡入淡出避免爆音。后续可替换为真实采样库（采样库体积大，暂不引入）。
 *
 * 与 TTS 旁白不同，配乐完全离线、无网络依赖，是「本地出片」路线的自然延伸。
 */

import { writeFileSync } from 'node:fs'

const SAMPLE_RATE = 44100

export interface MusicGenOptions {
  /** 时长（秒） */
  durationSec: number
  /** 目标音量（0~1，默认 0.5） */
  volume?: number
  /** BPM（默认 80，慢速氛围） */
  bpm?: number
  /** 根音频率（默认 A2 = 110Hz，温暖低音） */
  rootFreq?: number
}

/**
 * 生成一段氛围配乐，写入 WAV 文件。
 * @returns WAV 文件路径
 */
export function generateAmbientMusic(outPath: string, options: MusicGenOptions): string {
  const { durationSec, volume = 0.5, bpm = 80, rootFreq = 110 } = options
  const totalSamples = Math.max(1, Math.floor(durationSec * SAMPLE_RATE))
  const data = new Float32Array(totalSamples * 2) // 双声道交错

  // 和弦：根音 + 大三度 + 纯五度（频率比 1 : 1.25 : 1.5），构成温暖的大三和弦 pad
  const chord = [1, 1.25, 1.5, 2.0].map((r) => rootFreq * r)
  const beatSec = 60 / bpm

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE

    // 1) 和弦 pad：叠加谐波的正弦波，带缓慢的振幅呼吸（LFO）
    const breath = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.08 * t) // 8 秒一个呼吸周期
    let pad = 0
    for (const f of chord) {
      // 每个音叠加基频 + 少量二次谐波，让音色更温暖
      pad += Math.sin(2 * Math.PI * f * t) * 0.6
      pad += Math.sin(2 * Math.PI * f * 2 * t) * 0.15
    }
    pad = (pad / chord.length) * breath

    // 2) 节奏脉冲：低频 kick，每个节拍一个，快速衰减
    const beatPos = t % beatSec
    const beatEnv = Math.exp(-beatPos * 18) // 快速衰减
    const kick = Math.sin(2 * Math.PI * 55 * beatPos) * beatEnv * 0.5

    // 3) 柔和的高频「沙沙」底噪，模拟氛围感（极轻）
    //    用确定性伪随机（非 Math.random 以保证可复现）
    const noiseSeed = (i * 2654435761) >>> 0
    const noise = ((noiseSeed & 0xffff) / 0xffff - 0.5) * 0.015

    // 4) 全局淡入淡出（首尾各 0.5s）
    const fadeIn = Math.min(1, t / 0.5)
    const fadeOut = Math.min(1, (durationSec - t) / 0.5)
    const fade = Math.min(fadeIn, fadeOut)

    const sample = (pad + kick + noise) * volume * fade
    data[i * 2] = sample
    data[i * 2 + 1] = sample
  }

  writeWav(outPath, data)
  return outPath
}

/** 把 Float32Array（双声道交错）写入 16-bit PCM WAV。 */
function writeWav(outPath: string, data: Float32Array): void {
  const numSamples = data.length / 2
  const bytesPerSample = 2
  const blockAlign = 2 * bytesPerSample // 双声道
  const dataSize = data.length * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  // RIFF header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  // fmt chunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(2, 22) // 双声道
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * blockAlign, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34) // 16-bit
  // data chunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // 写入采样（16-bit PCM，限幅）
  for (let i = 0; i < data.length; i++) {
    const clamped = Math.max(-1, Math.min(1, data[i]))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }

  writeFileSync(outPath, buffer)
}
