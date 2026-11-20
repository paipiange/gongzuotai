/**
 * 视频生成 · FFmpeg 合成 MP4
 *
 * 借鉴 dsh-video-workbench 的编码参数：MJPEG 流 → H.264 (libx264) yuv420p，
 * bt709 色彩、crf 19、AAC 音轨，`+faststart` 便于流式播放。无音频时合成静音轨。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FfmpegBin {
  ffmpeg: string
  ffprobe: string
}

/** 定位本机 ffmpeg（优先 PATH，其次常见安装目录）。 */
export function findFfmpeg(): FfmpegBin {
  const candidates: string[] = [
    'C:/ffmpeg/bin',
    'C:/Program Files/ffmpeg/bin',
  ]
  const ffmpegExe = 'ffmpeg.exe'
  const ffprobeExe = 'ffprobe.exe'
  const pathDirs = (process.env.PATH ?? '').split(';')
  for (const dir of [...pathDirs, ...candidates]) {
    if (!dir) continue
    if (existsSync(join(dir, ffmpegExe))) {
      return { ffmpeg: join(dir, ffmpegExe), ffprobe: join(dir, ffprobeExe) }
    }
  }
  throw new Error('未找到 ffmpeg，请安装并加入 PATH')
}

export interface EncodeOptions {
  mjpegPath: string
  totalFrames: number
  fps: number
  outMp4Path: string
  audioPath?: string
  ffmpegPath?: string
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(args[0], args.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += String(d)
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 退出码 ${code}: ${stderr.slice(-1500)}`))
    })
  })
}

/**
 * 把多段已编码的 MP4 按顺序 concat 拼接成一段。
 * 使用 concat demuxer（-f concat -safe 0），要求各段编码参数一致（同 fps/分辨率/编码）。
 * 供多幕分段渲染路径复用：每幕独立出片后拼成完整视频。
 */
export async function concatMp4s(options: {
  mp4Paths: string[]
  outMp4Path: string
  ffmpegPath?: string
}): Promise<void> {
  const { mp4Paths, outMp4Path } = options
  if (mp4Paths.length === 0) throw new Error('没有可拼接的视频片段')
  if (mp4Paths.length === 1) {
    // 单段直接拷贝
    const { copyFileSync } = await import('node:fs')
    copyFileSync(mp4Paths[0], outMp4Path)
    return
  }
  const ffmpeg = options.ffmpegPath ?? findFfmpeg().ffmpeg
  const listPath = join(outMp4Path + '.concat.txt')
  const listContent = mp4Paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  writeFileSync(listPath, listContent, 'utf8')

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    outMp4Path,
  ]

  try {
    await runFfmpeg([ffmpeg, ...args])
  } finally {
    try {
      const { rmSync } = await import('node:fs')
      rmSync(listPath, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/** 把 MJPEG 流编码为 H.264 MP4。 */
export async function encodeMjpegToMp4(options: EncodeOptions): Promise<void> {
  const { mjpegPath, totalFrames, fps, outMp4Path, audioPath } = options
  const ffmpeg = options.ffmpegPath ?? findFfmpeg().ffmpeg
  const totalSec = Number((totalFrames / fps).toFixed(3))

  const args = ['-y', '-f', 'mjpeg', '-framerate', String(fps), '-i', mjpegPath]

  if (audioPath && existsSync(audioPath)) {
    args.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0')
  } else {
    args.push(
      '-f', 'lavfi', '-t', String(totalSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-map', '0:v:0', '-map', '1:a:0',
    )
  }

  args.push(
    '-vf', 'scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', String(totalSec),
    '-movflags', '+faststart',
    outMp4Path,
  )

  await runFfmpeg([ffmpeg, ...args])
}

/**
 * 把「图片帧序列」（PNG/JPEG Buffer 数组）合成 H.264 MP4。
 * 供 ComfyUI 视频帧序列路径复用：帧按时间轴顺序传入，写入临时目录后
 * 用 FFmpeg image2 序列合成。编码参数与 encodeMjpegToMp4 保持一致。
 */
export async function encodeFramesToMp4(options: {
  frames: Buffer[]
  fps: number
  outMp4Path: string
  frameExt?: 'png' | 'jpg'
  ffmpegPath?: string
}): Promise<void> {
  const { frames, fps, outMp4Path, frameExt = 'png' } = options
  if (frames.length === 0) throw new Error('没有可合成的视频帧')

  const ffmpeg = options.ffmpegPath ?? findFfmpeg().ffmpeg
  const totalSec = Number((frames.length / fps).toFixed(3))

  // 帧序列写盘到临时目录，再用 image2 通配读入（比管道更稳，且可复用）。
  const frameDir = join(outMp4Path + '.frames', '')
  mkdirSync(frameDir, { recursive: true })
  const pad = String(frames.length).length
  frames.forEach((buf, i) => {
    writeFileSync(join(frameDir, `frame_${String(i).padStart(pad, '0')}.${frameExt}`), buf)
  })

  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', join(frameDir, `frame_%0${pad}d.${frameExt}`),
    '-f', 'lavfi', '-t', String(totalSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', 'scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-color_range', 'tv',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', String(totalSec),
    '-movflags', '+faststart',
    outMp4Path,
  ]

  try {
    await runFfmpeg([ffmpeg, ...args])
  } finally {
    // 清理临时帧目录
    try {
      const { rmSync } = await import('node:fs')
      rmSync(frameDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * 把一条外部音频轨（如 TTS 旁白）混入已有的 MP4。
 * 视频流直接 copy，音频流重编码为 AAC。用于「多幕视频拼接完成后再配音」的路径。
 *
 * @returns 生成的新 MP4 路径（与 outMp4Path 相同）
 */
export async function muxAudioTrack(options: {
  videoPath: string
  audioPath: string
  outMp4Path: string
  ffmpegPath?: string
}): Promise<void> {
  const { videoPath, audioPath, outMp4Path } = options
  const ffmpeg = options.ffmpegPath ?? findFfmpeg().ffmpeg

  const args = [
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    outMp4Path,
  ]

  await runFfmpeg([ffmpeg, ...args])
}

/**
 * 多轨混音：视频 + 旁白 + 配乐合成带完整音轨的 MP4（P2）。
 *
 * 处理链：
 * - 旁白为主音轨（清晰、不被压缩）
 * - 配乐做侧链闪避（sidechaincompress）：旁白出声时配乐自动压低，旁白停时配乐回升
 * - 两轨 amix 后 loudnorm 归一化到 -14 LUFS（短视频平台通用响度）
 *
 * 配乐/旁白任一条缺失时降级：有旁白无配乐走 muxAudioTrack；有配乐无旁白直接混配乐；
 * 都没有则直接 copy 视频（保持原静音轨）。
 *
 * @returns 生成的新 MP4 路径（与 outMp4Path 相同）
 */
export async function mixVideoWithNarrationAndMusic(options: {
  videoPath: string
  narrationPath?: string | null
  musicPath?: string | null
  outMp4Path: string
  ffmpegPath?: string
}): Promise<void> {
  const { videoPath, narrationPath, musicPath, outMp4Path } = options
  const ffmpeg = options.ffmpegPath ?? findFfmpeg().ffmpeg
  const hasNarration = !!narrationPath && existsSync(narrationPath)
  const hasMusic = !!musicPath && existsSync(musicPath)

  // 都没有 → 直接 copy 视频
  if (!hasNarration && !hasMusic) {
    await runFfmpeg([ffmpeg, '-y', '-i', videoPath, '-c', 'copy', '-movflags', '+faststart', outMp4Path])
    return
  }

  // 只有旁白 → 走简单混入
  if (hasNarration && !hasMusic) {
    await muxAudioTrack({ videoPath, audioPath: narrationPath!, outMp4Path, ffmpegPath: ffmpeg })
    return
  }

  // 只有配乐 → 简单混入配乐
  if (!hasNarration && hasMusic) {
    await muxAudioTrack({ videoPath, audioPath: musicPath!, outMp4Path, ffmpegPath: ffmpeg })
    return
  }

  // 旁白 + 配乐 → 侧链闪避 + 混音 + loudnorm
  const args = [
    '-y',
    '-i', videoPath,
    '-i', narrationPath!,
    '-i', musicPath!,
    '-filter_complex',
    // [1:a] 旁白为侧链信号，[2:a] 配乐被闪避，然后两轨混音 + 响度归一化
    '[2:a][1:a]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck];'
      + '[1:a][duck]amix=inputs=2:duration=first:dropout_transition=3,loudnorm=I=-14:TP=-1.5:LRA=11[aout]',
    '-map', '0:v:0',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outMp4Path,
  ]

  await runFfmpeg([ffmpeg, ...args])
}
