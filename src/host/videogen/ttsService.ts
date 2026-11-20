/**
 * TTS 旁白服务（P1）
 *
 * 用微软 Edge 在线神经语音（edge-tts）把导演脚本的 narration 文案合成旁白。
 * 通过 Node `spawn` 调用 edge-tts 命令行（Python 包），输出 mp3 + 字幕 srt。
 *
 * 关键约束：
 * - edge-tts 是 Python 包，需在运行时定位可执行文件（edge-tts.exe 或 python -m edge_tts）。
 *   找不到时静默降级（返回 null），绝不阻塞视频主流程。
 * - 需联网（走用户 Clash 代理 7890）。合成失败同样降级，不影响出片。
 * - 第一版不做 ASR 回验与逐字时间戳对齐，只保证「第 N 幕旁白落在第 N 幕画面时段」。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 支持的旁白音色（默认中文女声，讲解向）。 */
export const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural'

/** 常用中文音色速查（供 UI 下拉，后续扩展）。 */
export const ZH_VOICES: { id: string; label: string }[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女·温暖·讲解）' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（女·活泼）' },
  { id: 'zh-CN-YunxiNeural', label: '云希（男·阳光）' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（男·专业·新闻）' },
  { id: 'zh-CN-YunjianNeural', label: '云健（男·激情）' },
]

/** 合成结果：音频路径 + 时长（秒） + 字幕 srt 路径（可空）。 */
export interface TtsClip {
  audioPath: string
  durationSec: number
  srtPath?: string
}

interface EdgeTtsBin {
  kind: 'exe' | 'module'
  cmd: string
  args: string[]
}

/**
 * 定位 edge-tts 可执行入口，返回可 spawn 的命令前缀。
 * 找不到时返回 null（调用方降级为无旁白）。
 */
function locateEdgeTts(): EdgeTtsBin | null {
  // 1) 优先找独立的 edge-tts.exe（Windows Scripts 目录）
  const exeCandidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python312', 'Scripts', 'edge-tts.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python311', 'Scripts', 'edge-tts.exe'),
    join(process.env.APPDATA ?? '', 'Python', 'Python312', 'Scripts', 'edge-tts.exe'),
    'C:/Python312/Scripts/edge-tts.exe',
    'C:/Python311/Scripts/edge-tts.exe',
  ]
  for (const p of exeCandidates) {
    if (existsSync(p)) return { kind: 'exe', cmd: p, args: [] }
  }

  // 2) 回退到 python -m edge_tts（更通用，跨平台）
  const pythonCandidates = [
    'python',
    'python3',
    'py',
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python312', 'python.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python311', 'python.exe'),
    'C:/Python312/python.exe',
    'C:/Python311/python.exe',
  ]
  for (const py of pythonCandidates) {
    try {
      // 只返回第一个候选，能否真正 import edge_tts 在合成时才知道（失败会降级）。
      return { kind: 'module', cmd: py, args: ['-m', 'edge_tts'] }
    } catch {
      /* continue */
    }
  }
  return null
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stderr = ''
    let settled = false
    const proc = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], shell: false })
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try { proc.kill() } catch { /* ignore */ }
        reject(new Error(`TTS 合成超时（${timeoutMs}ms）`))
      }
    }, timeoutMs)
    proc.stderr.on('data', (d) => {
      stderr += String(d)
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    proc.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })
    proc.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ code: code ?? -1, stderr })
      }
    })
  })
}

/**
 * 合成一条旁白文案为 mp3 + srt。
 * @param text 旁白文案（空则返回 null）
 * @param outBase 输出文件基名（不含扩展名），会生成 <outBase>.mp3 与 <outBase>.srt
 * @param voice 音色 id
 * @param proxy 代理地址（如 http://127.0.0.1:7890），为空则直连
 * @returns 合成结果；失败返回 null（调用方降级）
 */
async function synthesizeOne(
  text: string,
  outBase: string,
  voice: string,
  proxy?: string,
): Promise<TtsClip | null> {
  const bin = locateEdgeTts()
  if (!bin) return null
  const trimmed = text.trim()
  if (!trimmed) return null

  const mediaPath = outBase + '.mp3'
  const srtPath = outBase + '.srt'
  const args = [
    ...bin.args,
    '--text', trimmed,
    '--voice', voice,
    '--write-media', mediaPath,
    '--write-subtitles', srtPath,
    '--no-progress',
  ]
  if (proxy) args.push('--proxy', proxy)

  try {
    const { code, stderr } = await runCommand(bin.cmd, args, 60000)
    if (code !== 0 || !existsSync(mediaPath)) {
      console.warn(`[tts] 合成失败(code=${code}): ${stderr.slice(-300)}`)
      return null
    }
    const durationSec = await probeDurationSec(mediaPath)
    return { audioPath: mediaPath, durationSec, srtPath: existsSync(srtPath) ? srtPath : undefined }
  } catch (cause) {
    console.warn(`[tts] 合成异常: ${(cause as Error).message}`)
    return null
  }
}

/** 用 ffprobe 读取音频时长（秒）。失败返回 0（不阻塞）。 */
async function probeDurationSec(mediaPath: string): Promise<number> {
  try {
    const { findFfmpeg } = await import('./encoder')
    const ffprobe = findFfmpeg().ffprobe
    const out = await new Promise<string>((resolve, reject) => {
      const proc = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mediaPath], { stdio: ['ignore', 'pipe', 'ignore'] })
      let buf = ''
      proc.stdout.on('data', (d) => { buf += String(d) })
      proc.on('error', reject)
      proc.on('close', (code) => (code === 0 ? resolve(buf) : reject(new Error(`ffprobe code ${code}`))))
    })
    const sec = Number(out.trim())
    return Number.isFinite(sec) ? sec : 0
  } catch {
    return 0
  }
}

/**
 * 把多条旁白音频按「每幕画面时长」对齐后，concat 成一条完整旁白音轨。
 *
 * 对齐策略（第一版）：
 * - 每条旁白音频 pad/trim 到对应幕的画面时长（sceneDur），使「第 N 幕旁白落在第 N 幕时段」。
 * - 旁白时长不足 → 补静音；旁白过长 → 截断（或轻微降速，暂不实现）。
 * - 全部对齐后 concat 成一条 mp3，返回其路径。
 *
 * @returns 完整音轨路径；任一幕失败则整条降级为 null。
 */
export async function buildNarrationTrack(options: {
  clips: { audioPath: string; durationSec: number }[]
  sceneDurs: number[]
  outDir: string
  proxy?: string
  voice?: string
  ffmpegPath?: string
}): Promise<string | null> {
  const { clips, sceneDurs, outDir } = options
  if (clips.length === 0 || clips.length !== sceneDurs.length) return null

  const { findFfmpeg } = await import('./encoder')
  const ffmpeg = options.ffmpegPath ?? findFfmpeg().ffmpeg
  const aligned: string[] = []

  for (let i = 0; i < clips.length; i++) {
    const targetDur = Math.max(0.1, sceneDurs[i])
    const alignedPath = join(outDir, `nar_${String(i).padStart(2, '0')}.mp3`)
    // apad 补静音 + atrim 截断到目标时长；aac 重编码保证 concat 参数一致。
    const args = [
      '-y', '-i', clips[i].audioPath,
      '-af', `apad=pad_dur=${targetDur.toFixed(3)},atrim=0:${targetDur.toFixed(3)}`,
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      alignedPath,
    ]
    try {
      await runCommand(ffmpeg, args, 30000)
      aligned.push(alignedPath)
    } catch (cause) {
      console.warn(`[tts] 第 ${i + 1} 幕音频对齐失败: ${(cause as Error).message}`)
      return null
    }
  }

  // concat 对齐后的音轨
  const concatPath = join(outDir, 'narration_full.mp3')
  const listPath = concatPath + '.txt'
  writeFileSync(listPath, aligned.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
  try {
    const { code, stderr } = await runCommand(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatPath], 30000)
    if (code !== 0 || !existsSync(concatPath)) {
      console.warn(`[tts] 音轨 concat 失败(code=${code}): ${stderr.slice(-300)}`)
      return null
    }
    return concatPath
  } catch (cause) {
    console.warn(`[tts] 音轨 concat 异常: ${(cause as Error).message}`)
    return null
  }
}

/**
 * 为多幕脚本合成旁白音轨（完整流程）。
 *
 * @param narrations 每幕的旁白文案（与 scenes 一一对应，可为空串）
 * @param sceneDurs 每幕画面时长（秒）
 * @param voice 音色 id
 * @param proxy 代理地址
 * @returns 完整旁白音轨路径；无旁白/失败返回 null
 */
export async function synthesizeNarrationTrack(options: {
  narrations: string[]
  sceneDurs: number[]
  voice?: string
  proxy?: string
}): Promise<{ trackPath: string; srtPaths: string[] } | null> {
  const { narrations, sceneDurs, voice = DEFAULT_VOICE, proxy } = options
  if (narrations.length === 0 || narrations.every((n) => !n.trim())) return null

  const workDir = join(tmpdir(), `paipiange-tts-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(workDir, { recursive: true })

  const clips: { audioPath: string; durationSec: number }[] = []
  const srtPaths: string[] = []
  for (let i = 0; i < narrations.length; i++) {
    const clip = await synthesizeOne(narrations[i], join(workDir, `scene_${String(i).padStart(2, '0')}`), voice, proxy)
    if (!clip) {
      // 某一幕 TTS 失败 → 整条旁白降级（不做半截旁白，避免画面有音无字错位）。
      return null
    }
    clips.push({ audioPath: clip.audioPath, durationSec: clip.durationSec })
    if (clip.srtPath) srtPaths.push(clip.srtPath)
  }

  const trackPath = await buildNarrationTrack({ clips, sceneDurs, outDir: workDir })
  if (!trackPath) return null
  return { trackPath, srtPaths }
}

/** 读取字幕 srt 文件内容（供导出）。 */
export function readSrt(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
