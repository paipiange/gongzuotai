/**
 * 视频生成 · 主服务
 *
 * 串联四步：LLM 生成 HTML → （沙箱校验+修复）→ 无头浏览器逐帧截图 → FFmpeg 合成 MP4。
 * 借鉴 dsh-video-workbench 的 HTML5 引擎思路，本地渲染、不依赖视频供应商。
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { LlmService } from '../textgen/types'
import type { ComfyUiConfig } from '../imagegen/types'
import { authorVideoHtml } from './videoCoder'
import { renderHtmlToMjpeg, findBrowser } from './renderer'
import { encodeMjpegToMp4, encodeFramesToMp4, concatMp4s, mixVideoWithNarrationAndMusic, findFfmpeg } from './encoder'
import { generateFallbackHtml } from './fallbackTemplate'
import { ComfyVideoGenerator } from './comfyVideo'
import { generateDirectorScript, type DirectorScript } from './directorService'
import { getStyle, styleToPrompt } from './styles'
import { produceRemotionVideo } from './remotionEngine'

/** 视频生成引擎：本地 LLM 写 HTML 动画，ComfyUI 出帧序列，或 Remotion+Three.js 双引擎。 */
export type VideoEngine = 'llm' | 'comfyui' | 'remotion'

export interface VideoGenRequest {
  /** 主题文案（标题） */
  topic: string
  /** 副标题 */
  subtitle?: string
  /** 视觉风格（自由文本） */
  style?: string
  /** 风格 id（可选，命中风格库时注入结构化风格约束） */
  styleId?: string
  /** 是否启用多幕导演脚本（默认 false=单幕；true=生成多幕脚本分段渲染再拼接） */
  multiScene?: boolean
  /** 多幕时的幕数（默认 4） */
  sceneCount?: number
  /** TTS 旁白音色 id（edge-tts，默认 zh-CN-XiaoxiaoNeural）。仅多幕模式生效。 */
  voice?: string
  /** TTS 代理地址（如 http://127.0.0.1:7890），为空时直连。 */
  ttsProxy?: string
  /** 是否生成程序化配乐（多幕模式默认 true）。 */
  music?: boolean
  /** 画面比例，映射到固定分辨率 */
  aspectRatio?: '16:9' | '9:16' | '1:1'
  /** 时长（秒），1~30 */
  durationSec?: number
  /** 帧率 */
  fps?: number
  provider: string
  model: string
  /** 生成引擎：默认 llm（LLM 写 HTML 动画）。 */
  engine?: VideoEngine
  /** ComfyUI 后端配置（engine=comfyui 时必填）。 */
  comfyui?: ComfyUiConfig
  /** Remotion 引擎的画面风格（如 "tech" / "ink-wash"），透传给 dsh-video 引擎。 */
  remotionStyle?: string
  /** Remotion 引擎的配乐方案（auto / 纯音乐卡点等），透传给 bgmMode。 */
  remotionBgmMode?: string
  /** Remotion 引擎的旁白音色 id，透传给 voiceId。 */
  remotionVoiceId?: string
  /** Remotion 引擎画质（720p / 1080p / 2K / 4K）。 */
  remotionQuality?: string
}

export interface VideoGenResult {
  mp4: Buffer
  width: number
  height: number
  fps: number
  totalFrames: number
  usedFallback: boolean
  rounds: number
  /** 多幕脚本（multiScene=true 时返回，供上层展示叙事结构） */
  script?: DirectorScript
}

export type VideoProgress =
  | { stage: 'coding'; message: string }
  | { stage: 'repair'; round: number; message: string }
  | { stage: 'render'; frame: number; total: number }
  | { stage: 'comfy'; frame: number; total: number }
  | { stage: 'scene'; scene: number; total: number; message: string }
  | { stage: 'encode'; message: string }
  | { stage: 'done'; message: string }

function resolutionFor(aspect: VideoGenRequest['aspectRatio']): { width: number; height: number } {
  switch (aspect) {
    case '9:16':
      return { width: 720, height: 1280 }
    case '1:1':
      return { width: 720, height: 720 }
    default:
      return { width: 1280, height: 720 }
  }
}

/**
 * 执行一次完整的本地视频生成。
 * `onProgress` 用于把阶段进度回传给上层（例如 SSE）。
 */
export async function generateVideo(
  llm: LlmService | undefined,
  request: VideoGenRequest,
  options: { signal?: AbortSignal; onProgress?: (p: VideoProgress) => void } = {},
): Promise<VideoGenResult> {
  const { width, height } = resolutionFor(request.aspectRatio)
  const fps = Math.min(Math.max(Math.floor(request.fps ?? 24), 12), 30)
  const durationSec = Math.min(Math.max(request.durationSec ?? 5, 1), 30)
  const totalFrames = Math.round(durationSec * fps)

  // ComfyUI 引擎：出帧序列 → FFmpeg 合成（复用本机/远程图片模型，无需浏览器）。
  if (request.engine === 'comfyui') {
    return generateViaComfyUI(request, { width, height, fps, durationSec, totalFrames }, options)
  }

  // Remotion 双引擎：复用 vendored dsh-video 引擎（Remotion + Three.js / HTML5 + 节拍卡点 + 多 TTS）。
  if (request.engine === 'remotion') {
    return generateViaRemotion(request, options)
  }

  if (!llm) throw new Error('Harness 文本模型服务未就绪，无法生成视频动画')

  // 多幕导演脚本：生成多幕脚本，逐幕出片后拼接（P0 核心能力）。
  if (request.multiScene) {
    return generateMultiScene(llm, request, { width, height, fps, durationSec }, options)
  }

  const browser = findBrowser()
  if (!browser) throw new Error('未找到 Edge/Chrome，无法渲染视频')
  findFfmpeg() // 提前校验，避免渲染一半才发现缺 ffmpeg

  const workDir = join(tmpdir(), `paipiange-video-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(workDir, { recursive: true })

  try {
    // 1) LLM 生成 HTML（失败降级到内置模板）
    let html: string
    let usedFallback = false
    let rounds = 0

    options.onProgress?.({ stage: 'coding', message: '正在由模型编写视频动画…' })
    const coded = await authorVideoHtml(
      llm,
      { provider: request.provider, model: request.model, topic: request.topic, subtitle: request.subtitle, style: request.style, width, height, fps, durationSec },
      { signal: options.signal, onRound: (r) => options.onProgress?.({ stage: 'repair', round: r, message: `模型代码质检未通过，正在自动修复（第 ${r}/3 轮）…` }) },
    )

    if (coded && !options.signal?.aborted) {
      html = coded.html
      usedFallback = false
      rounds = coded.rounds
    } else {
      // 降级：内置确定性模板
      const fallback = generateFallbackHtml({
        title: request.topic,
        subtitle: request.subtitle || 'AI 视频工作台 · 本地逐帧出片',
        footer: '拍片哥工作台',
        durationSec,
        fps,
        width,
        height,
      })
      html = fallback.html
      usedFallback = true
      options.onProgress?.({ stage: 'coding', message: '已降级为内置动画模板（模型未产出可用代码）' })
    }

    // 2) 逐帧截图 → MJPEG 流
    await renderHtmlToMjpeg({
      html,
      totalFrames,
      width,
      height,
      fps,
      outDir: workDir,
      browser,
      onProgress: (frame, total) => options.onProgress?.({ stage: 'render', frame, total }),
    })

    // 3) FFmpeg 合成
    const outMp4 = join(workDir, 'output.mp4')
    options.onProgress?.({ stage: 'encode', message: '正在合成 MP4…' })
    await encodeMjpegToMp4({ mjpegPath: join(workDir, 'frames.mjpeg'), totalFrames, fps, outMp4Path: outMp4 })

    const { readFileSync } = await import('node:fs')
    const mp4 = readFileSync(outMp4)

    options.onProgress?.({ stage: 'done', message: '视频生成完成' })
    return { mp4, width, height, fps, totalFrames, usedFallback, rounds }
  } finally {
    // 清理临时工作目录
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * 多幕导演工作流（P0 核心）：
 *   1) 导演脚本：LLM 产出多幕 script.json（钩子→展开→转折→落点）
 *   2) 逐幕渲染：每幕用「风格约束 + 幕标题/视觉」让 LLM 写 HTML 动画，
 *      复用 renderHtmlToMjpeg + encodeMjpegToMp4 出片
 *   3) 拼接：concat 所有幕为完整 MP4
 * 失败时逐幕降级到内置模板，最终仍保证出片。
 */
async function generateMultiScene(
  llm: LlmService,
  request: VideoGenRequest,
  dim: { width: number; height: number; fps: number; durationSec: number },
  options: { signal?: AbortSignal; onProgress?: (p: VideoProgress) => void },
): Promise<VideoGenResult> {
  const { width, height, fps, durationSec } = dim
  const browser = findBrowser()
  if (!browser) throw new Error('未找到 Edge/Chrome，无法渲染视频')
  findFfmpeg()

  // 风格约束（贯穿所有幕）
  const styleDef = request.styleId ? getStyle(request.styleId) : undefined
  const stylePrompt = styleDef ? styleToPrompt(styleDef) : ''

  // 1) 导演脚本
  options.onProgress?.({ stage: 'coding', message: '正在生成多幕导演脚本…' })
  const script = await generateDirectorScript(
    llm,
    {
      topic: request.topic,
      subtitle: request.subtitle,
      styleId: request.styleId,
      durationSec,
      sceneCount: request.sceneCount,
      provider: request.provider,
      model: request.model,
    },
    { signal: options.signal },
  )

  const scenes = script?.scenes ?? []
  const hasScript = scenes.length >= 2
  if (!hasScript) {
    // 降级为单幕：把整段当一幕
    options.onProgress?.({ stage: 'coding', message: '导演脚本未产出，降级为单幕' })
  }

  const workDir = join(tmpdir(), `paipiange-video-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(workDir, { recursive: true })

  const mp4Paths: string[] = []
  const successNarrations: string[] = []
  const successSceneDurs: number[] = []
  let totalFrames = 0
  let usedFallback = false
  let rounds = 0

  // 幕列表：有脚本则按幕，无脚本则合成一幕
  const sceneList = hasScript
    ? scenes
    : [{ no: 1, type: 'hook' as const, title: request.topic, subtitle: request.subtitle ?? '', visual: '', camera: '', durationSec, narration: '' }]

  try {
    for (let i = 0; i < sceneList.length; i++) {
      if (options.signal?.aborted) throw new Error('已取消')
      const sc = sceneList[i]
      options.onProgress?.({ stage: 'scene', scene: i + 1, total: sceneList.length, message: `正在生成第 ${i + 1}/${sceneList.length} 幕：${sc.title || '未命名'}` })

      const sceneDur = Math.min(Math.max(sc.durationSec, 1), 30)
      const sceneFrames = Math.round(sceneDur * fps)

      // 2) 每幕生成 HTML（注入风格约束 + 幕内容）
      const coded = await authorVideoHtml(
        llm,
        {
          provider: request.provider,
          model: request.model,
          topic: sc.title || request.topic,
          subtitle: sc.subtitle,
          style: request.style,
          stylePrompt,
          width,
          height,
          fps,
          durationSec: sceneDur,
        },
        { signal: options.signal, onRound: (r) => options.onProgress?.({ stage: 'repair', round: r, message: `第 ${i + 1} 幕质检未通过，自动修复（第 ${r}/3 轮）…` }) },
      )

      let html: string
      if (coded) {
        html = coded.html
        rounds += coded.rounds
      } else {
        usedFallback = true
        html = buildSceneFallbackHtml(sc, request, sceneDur, fps, width, height)
      }

      // 3) 逐帧截图 + 4) 合成单幕 MP4。单幕失败时降级到内置模板重试一次，
      //    避免「某幕渲染崩溃 → 前面已成功的幕全部白跑」。
      const sceneOut = join(workDir, `scene_${String(i).padStart(2, '0')}`)
      let sceneMp4 = ''
      try {
        await renderHtmlToMjpeg({
          html,
          totalFrames: sceneFrames,
          width,
          height,
          fps,
          outDir: sceneOut,
          browser,
          onProgress: (frame, total) => options.onProgress?.({ stage: 'render', frame, total }),
        })
        sceneMp4 = join(sceneOut, 'scene.mp4')
        await encodeMjpegToMp4({ mjpegPath: join(sceneOut, 'frames.mjpeg'), totalFrames: sceneFrames, fps, outMp4Path: sceneMp4 })
      } catch (cause) {
        if (options.signal?.aborted) throw cause
        // 首轮渲染/合成失败：改用内置模板兜底重试一次。
        options.onProgress?.({ stage: 'repair', round: 1, message: `第 ${i + 1} 幕渲染失败，改用内置模板兜底…` })
        usedFallback = true
        const fallbackHtml = buildSceneFallbackHtml(sc, request, sceneDur, fps, width, height)
        try {
          const fallbackDir = join(sceneOut, 'fallback')
          await renderHtmlToMjpeg({
            html: fallbackHtml,
            totalFrames: sceneFrames,
            width,
            height,
            fps,
            outDir: fallbackDir,
            browser,
            onProgress: (frame, total) => options.onProgress?.({ stage: 'render', frame, total }),
          })
          sceneMp4 = join(sceneOut, 'scene.mp4')
          await encodeMjpegToMp4({ mjpegPath: join(fallbackDir, 'frames.mjpeg'), totalFrames: sceneFrames, fps, outMp4Path: sceneMp4 })
        } catch (fallbackCause) {
          if (options.signal?.aborted) throw fallbackCause
          // 兜底也失败（如 FFmpeg 不可用）：跳过该幕，用已成功的幕继续，至少交付部分成果。
          options.onProgress?.({ stage: 'repair', round: 2, message: `第 ${i + 1} 幕兜底仍失败，跳过该幕继续` })
          continue
        }
      }
      mp4Paths.push(sceneMp4)
      totalFrames += sceneFrames
      // 记录成功幕的旁白与时长（供后续 TTS 音轨对齐）。
      successNarrations.push(sc.narration ?? '')
      successSceneDurs.push(sceneDur)
    }

    // 5) 拼接所有成功的幕。若一幕都没成，抛出明确错误。
    if (mp4Paths.length === 0) {
      throw new Error('所有幕均渲染失败，无法生成视频（请检查 Edge/Chrome 与 FFmpeg 是否可用）')
    }
    options.onProgress?.({ stage: 'encode', message: `正在拼接 ${mp4Paths.length} 幕为完整视频…` })
    const outMp4 = join(workDir, 'output.mp4')
    await concatMp4s({ mp4Paths, outMp4Path: outMp4 })

    // 6) 旁白 + 配乐（多幕模式）：
    //    - 旁白：edge-tts 合成 → 对齐各幕时长（有 narration 时）
    //    - 配乐：程序化合成氛围音（music !== false 时）
    //    - 混音：旁白为主、配乐侧链闪避，loudnorm 到 -14 LUFS
    //    任一环节失败静默降级，绝不影响出片。
    let finalMp4 = outMp4
    let narrationTrackPath: string | null = null
    let musicTrackPath: string | null = null
    let totalSec = successSceneDurs.reduce((a, b) => a + b, 0)

    // 6a) 旁白
    if (successNarrations.some((n) => n.trim())) {
      options.onProgress?.({ stage: 'encode', message: '正在合成旁白语音…' })
      try {
        const { synthesizeNarrationTrack } = await import('./ttsService')
        const proxy = request.ttsProxy || process.env.TTS_PROXY || 'http://127.0.0.1:7890'
        const result = await synthesizeNarrationTrack({
          narrations: successNarrations,
          sceneDurs: successSceneDurs,
          voice: request.voice,
          proxy,
        })
        if (result) narrationTrackPath = result.trackPath
      } catch (cause) {
        console.warn(`[videogen] 旁白合成失败，降级为无旁白: ${(cause as Error).message}`)
        narrationTrackPath = null
      }
    }

    // 6b) 配乐
    if (request.music !== false) {
      options.onProgress?.({ stage: 'encode', message: '正在合成背景配乐…' })
      try {
        const { generateAmbientMusic } = await import('./musicService')
        const musicPath = join(workDir, 'music.wav')
        generateAmbientMusic(musicPath, { durationSec: totalSec, volume: 0.35 })
        musicTrackPath = musicPath
      } catch (cause) {
        console.warn(`[videogen] 配乐合成失败，降级为无配乐: ${(cause as Error).message}`)
        musicTrackPath = null
      }
    }

    // 6c) 混音（旁白 + 配乐）
    if (narrationTrackPath || musicTrackPath) {
      options.onProgress?.({ stage: 'encode', message: '正在混音合成完整音轨…' })
      try {
        const dubbed = join(workDir, 'output_mixed.mp4')
        await mixVideoWithNarrationAndMusic({
          videoPath: outMp4,
          narrationPath: narrationTrackPath,
          musicPath: musicTrackPath,
          outMp4Path: dubbed,
        })
        finalMp4 = dubbed
      } catch (cause) {
        console.warn(`[videogen] 混音失败，降级为无声视频: ${(cause as Error).message}`)
        finalMp4 = outMp4
      }
    }

    const { readFileSync } = await import('node:fs')
    const mp4 = readFileSync(finalMp4)

    options.onProgress?.({ stage: 'done', message: (narrationTrackPath || musicTrackPath) ? '多幕视频 + 音轨生成完成' : '多幕视频生成完成' })
    return {
      mp4,
      width,
      height,
      fps,
      totalFrames,
      usedFallback,
      rounds,
      script: hasScript ? script ?? undefined : undefined,
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * 构建某一幕的内置兜底 HTML（当 LLM 未产出可用代码，或渲染/合成失败时使用）。
 * 抽成独立函数，供多幕渲染的「首轮兜底」与「失败重试兜底」复用。
 */
function buildSceneFallbackHtml(
  sc: { title?: string; subtitle?: string },
  request: VideoGenRequest,
  sceneDur: number,
  fps: number,
  width: number,
  height: number,
): string {
  return generateFallbackHtml({
    title: sc.title || request.topic,
    subtitle: sc.subtitle || '拍片哥工作台 · 多幕本地出片',
    footer: '拍片哥工作台',
    durationSec: sceneDur,
    fps,
    width,
    height,
  }).html
}

/**
 * ComfyUI 引擎：用本机/远程 ComfyUI 的 Qwen-Image-Edit 模型产出多帧序列，
 * 再 FFmpeg 合成 MP4。复用现有图片模型，无需浏览器渲染，也无需 LLM。
 */
async function generateViaComfyUI(
  request: VideoGenRequest,
  dim: { width: number; height: number; fps: number; durationSec: number; totalFrames: number },
  options: { signal?: AbortSignal; onProgress?: (p: VideoProgress) => void },
): Promise<VideoGenResult> {
  const { width, height, fps, durationSec, totalFrames } = dim

  if (!request.comfyui?.server) {
    throw new Error('未配置 ComfyUI 服务地址，请先在设置中心添加 ComfyUI 后端')
  }
  findFfmpeg()

  const workDir = join(tmpdir(), `paipiange-video-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(workDir, { recursive: true })

  try {
    const generator = new ComfyVideoGenerator(request.comfyui)

    // 帧数 = 时长 × 帧率；Qwen-Image-Edit 的 layers 上限 63（64 帧），超长视频需分段或降低帧率。
    // 这里做保护：帧序列最多 64 帧，超出时按比例降帧率（保持时长不变）。
    const maxFrames = 64
    const frameCount = Math.min(totalFrames, maxFrames)
    const effectiveFps = totalFrames > maxFrames ? Number((frameCount / durationSec).toFixed(2)) : fps

    options.onProgress?.({ stage: 'coding', message: `正在由 ComfyUI 生成 ${frameCount} 帧序列…` })

    const prompt = [
      request.topic,
      request.subtitle ? `，${request.subtitle}` : '',
      request.style ? `，风格：${request.style}` : '',
    ].join('').trim()

    const gen = await generator.generate(
      {
        prompt,
        frames: frameCount,
        width,
        height,
        seed: Math.floor(Math.random() * 0xffffffff),
      },
      options.signal,
    )

    // 帧序列可能少于目标帧数（模型实际输出），以实际为准。
    const frames = gen.frames
    const actualFps = frames.length > 0 ? effectiveFps : fps

    // 合成 MP4
    const outMp4 = join(workDir, 'output.mp4')
    options.onProgress?.({ stage: 'encode', message: `正在把 ${frames.length} 帧合成为 MP4…` })
    await encodeFramesToMp4({
      frames,
      fps: Math.max(Math.round(actualFps), 1),
      outMp4Path: outMp4,
      frameExt: 'png',
    })

    const { readFileSync } = await import('node:fs')
    const mp4 = readFileSync(outMp4)

    options.onProgress?.({ stage: 'done', message: '视频生成完成' })
    return {
      mp4,
      width,
      height,
      fps: Math.round(actualFps),
      totalFrames: frames.length,
      usedFallback: false,
      rounds: 0,
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * Remotion 双引擎：复用 vendored dsh-video-workbench 引擎一站式出片。
 * 引擎内部自行完成：策划 → 逐幕 TTS 配音 → 双引擎画面工程 → 混音 → 逐帧渲染 MP4。
 * 输出为 final.mp4，读回 Buffer 后清理临时工程目录。
 */
async function generateViaRemotion(
  request: VideoGenRequest,
  options: { signal?: AbortSignal; onProgress?: (p: VideoProgress) => void },
): Promise<VideoGenResult> {
  const { width, height } = resolutionFor(request.aspectRatio)
  const fps = Math.min(Math.max(Math.floor(request.fps ?? 24), 12), 60)
  const durationSec = Math.min(Math.max(request.durationSec ?? 8, 1), 600)

  const workDir = join(tmpdir(), `paipiange-remotion-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(workDir, { recursive: true })

  try {
    if (options.signal?.aborted) throw new Error('已取消')

    options.onProgress?.({ stage: 'coding', message: '正在由 Remotion 双引擎策划并生成视频…' })

    // 把引擎的进度文案（"1/5 ..."）透传为 stage 进度。
    const onProgress = (msg: string) => {
      options.onProgress?.({ stage: 'encode', message: msg })
    }

    const result = await produceRemotionVideo({
      projectDir: workDir,
      topic: request.topic,
      title: request.topic,
      style: request.remotionStyle || request.style || 'tech',
      engine: 'remotion',
      aspectRatio: request.aspectRatio ?? '16:9',
      quality: request.remotionQuality ?? '1080p',
      width,
      height,
      fps,
      bgmMode: request.remotionBgmMode,
      voiceId: request.remotionVoiceId,
      onProgress,
    })

    if (!result.ok) {
      throw new Error('Remotion 引擎出片失败')
    }

    // 引擎返回的最终 MP4 路径（默认 output/final.mp4）。
    const outPath = result.render?.outputPath || join(workDir, 'output', 'final.mp4')
    const { readFileSync } = await import('node:fs')
    if (!existsSync(outPath)) {
      throw new Error(`Remotion 引擎未产出 MP4（预期 ${outPath}）`)
    }
    const mp4 = readFileSync(outPath)

    options.onProgress?.({ stage: 'done', message: 'Remotion 双引擎视频生成完成' })
    return {
      mp4,
      width,
      height,
      fps,
      totalFrames: Math.round(durationSec * fps),
      usedFallback: false,
      rounds: 0,
    }
  } catch (cause) {
    if (options.signal?.aborted) throw new Error('已取消')
    throw cause
  } finally {
    // 清理临时工程目录（引擎生成的中间产物较大，务必回收）。
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
