/**
 * 视频原型 · CLI 入口
 *
 * 三步串联：生成 HTML 动画 → 无头浏览器逐帧截图 → FFmpeg 合成 MP4。
 *
 * 用法：
 *   node scripts/video-prototype/main.mjs --title "标题" --subtitle "副标题" --footer "落款"
 *
 * 说明：这是独立于插件的「本地轻量视频渲染」技术原型，用于验证
 * dsh-video-workbench 的 HTML5 引擎思路。不接入供应商、不创建插件内任务。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateHtmlTemplate } from './template.ts'
import { renderHtmlToMjpeg, findBrowser } from './renderer.ts'
import { encodeMjpegToMp4, findFfmpeg } from './encoder.ts'

interface CliArgs {
  title: string
  subtitle: string
  footer: string
  durationSec: number
  fps: number
  width: number
  height: number
  outDir: string
}

function parseArgs(argv: string[]): CliArgs {
  const get = (name: string, fallback: string) => {
    const idx = argv.indexOf(`--${name}`)
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback
  }
  return {
    title: get('title', '拍片哥工作台'),
    subtitle: get('subtitle', '本地轻量视频渲染原型 · AI 写代码，逐帧出片'),
    footer: get('footer', 'PAIPIANGE · CREATIVE STUDIO'),
    durationSec: Number(get('duration', '5')),
    fps: Number(get('fps', '30')),
    width: Number(get('width', '1280')),
    height: Number(get('height', '720')),
    outDir: get('out', join(process.cwd(), '.artifacts', 'video-prototype')),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const browser = findBrowser()
  if (!browser) {
    console.error('[video-prototype] 未找到 Edge/Chrome，无法渲染。')
    process.exit(1)
  }
  const { ffmpeg } = findFfmpeg()

  console.log(`[video-prototype] 浏览器: ${browser.path}`)
  console.log(`[video-prototype] ffmpeg: ${ffmpeg}`)
  console.log(`[video-prototype] ${args.width}x${args.height} @ ${args.fps}fps, ${args.durationSec}s`)

  // 1) 生成 HTML 动画
  const spec = {
    title: args.title,
    subtitle: args.subtitle,
    footer: args.footer,
    durationSec: args.durationSec,
    fps: args.fps,
    width: args.width,
    height: args.height,
  }
  const tpl = generateHtmlTemplate(spec)
  mkdirSync(args.outDir, { recursive: true })
  const htmlPath = join(args.outDir, 'index.html')
  writeFileSync(htmlPath, tpl.html, 'utf8')
  console.log(`[1/3] 已生成动画 HTML → ${htmlPath} (${tpl.totalFrames} 帧)`)

  // 2) 逐帧截图 → MJPEG 流
  const render = await renderHtmlToMjpeg({
    html: tpl.html,
    totalFrames: tpl.totalFrames,
    width: tpl.width,
    height: tpl.height,
    fps: tpl.fps,
    outDir: args.outDir,
    browser,
    onProgress: (f, total) => {
      if (f % Math.max(1, Math.floor(total / 10)) === 0 || f === total) {
        process.stdout.write(`\r[2/3] 逐帧截图 ${f}/${total}`)
      }
    },
  })
  process.stdout.write('\n')
  console.log(`[2/3] MJPEG 流 → ${render.mjpegPath}`)

  // 3) FFmpeg 合成
  const outMp4 = join(args.outDir, 'output.mp4')
  await encodeMjpegToMp4({
    mjpegPath: render.mjpegPath,
    totalFrames: render.totalFrames,
    fps: render.fps,
    outMp4Path: outMp4,
  })
  console.log(`[3/3] 合成完成 → ${outMp4}`)
  console.log('[video-prototype] 完成 ✔')
}

main().catch((err) => {
  console.error('[video-prototype] 失败:', err)
  process.exit(1)
})
