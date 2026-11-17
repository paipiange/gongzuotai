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
