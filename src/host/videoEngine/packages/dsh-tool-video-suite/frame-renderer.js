/**
 * Real Frame-by-Frame Dual-Engine Video Renderer
 * 1. HTML/GSAP/Canvas Engine: Serves project over localhost HTTP (Range-enabled for <video>)
 *    + controls headless Chromium via Node 24 native WebSocket CDP to seek & capture EVERY frame.
 * 2. Remotion Engine: Bundles `src/index.ts` & renders via local `@remotion/bundler` + `@remotion/renderer`.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { cpus } from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  REPO_ROOT,
  createAbortError,
  ensureRemotionJunction,
  killProcessTree,
  readScriptJson,
  resolveBinaries,
  resolveBrowserExecutable,
  resolveLowSpecPolicy,
  resolveRemotionRuntime,
  runCommandRedirected,
} from '../shared/index.js'
import { renderHtmlSegmentsWithCache } from './segment-cache.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

function startStaticProjectServer(projectDir) {
  const absRoot = resolve(projectDir)
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = resolve(absRoot, rel)
    if (!file.startsWith(absRoot) || !existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    const st = statSync(file)
    const ext = extname(file).toLowerCase()
    const ctype = MIME[ext] || 'application/octet-stream'
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)
      if (m) {
        const start = Number(m[1])
        const end = m[2] ? Math.min(st.size - 1, Number(m[2])) : st.size - 1
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': ctype,
        })
        createReadStream(file, { start, end }).pipe(res)
        return
      }
    }
    res.writeHead(200, {
      'Content-Length': st.size,
      'Content-Type': ctype,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolvePromise({ server, port: addr.port })
    })
  })
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.nextId = 1
    this.pending = new Map()
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true })
      this.ws.addEventListener('error', (e) => rej(new Error(`CDP WebSocket error: ${e.message || 'failed'}`)), { once: true })
    })
    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data))
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: r, reject: j } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) j(new Error(msg.error.message || 'CDP error'))
          else r(msg.result)
        }
      } catch {}
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = this.nextId++
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() {
    try { this.ws.close() } catch {}
  }
}

async function openCdpSession(browserBin, width, height) {
  const tmpBase = join(REPO_ROOT, '.tmp')
  mkdirSync(tmpBase, { recursive: true })
  const userDataDir = join(tmpBase, `cdp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  mkdirSync(userDataDir, { recursive: true })

  const child = spawn(
    browserBin,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--disable-gpu-vsync',
      '--run-all-compositor-stages-before-draw',
      '--no-sandbox',
      '--hide-scrollbars',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  )

  const activePortFile = join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + 20_000
  let port = ''
  while (Date.now() < deadline) {
    if (existsSync(activePortFile)) {
      const lines = readFileSync(activePortFile, 'utf8').trim().split(/\r?\n/)
      if (lines[0] && /^\d+$/.test(lines[0])) {
        port = lines[0]
        break
      }
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  if (!port) {
    try { child.kill() } catch {}
    throw new Error('Chromium DevToolsActivePort timed out')
  }

  // Wait for page target
  let wsUrl = ''
  const targetDeadline = Date.now() + 10_000
  while (Date.now() < targetDeadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) {
        wsUrl = page.webSocketDebuggerUrl
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!wsUrl) {
    try { child.kill() } catch {}
    throw new Error('No Chromium page target found')
  }

  const cdp = new CdpClient(wsUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })

  return {
    cdp,
    cleanup() {
      cdp.close()
      killProcessTree(child)
      try { child.kill() } catch {}
      setTimeout(() => {
        try { rmSync(userDataDir, { recursive: true, force: true }) } catch {}
      }, 300)
    },
  }
}

async function waitForPageReady(cdp, url) {
  await cdp.send('Page.navigate', { url })
  for (let i = 0; i < 120; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    })
    if (r?.result?.value === 'complete') break
    await new Promise((res) => setTimeout(res, 100))
  }
  // Wait for fonts, images, and video metadata
  await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      try { await document.fonts.ready; } catch {}
      const imgs = Array.from(document.querySelectorAll('img'));
      await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 2000); })));
      const vids = Array.from(document.querySelectorAll('video'));
      await Promise.all(vids.map(v => v.readyState >= 1 ? null : new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 2500); })));
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
}

/**
 * Capture N specific frame numbers to PNG files in a single warm Chromium CDP session.
 */
export async function captureHtmlSnapshots({ projectDir, browserBin, frames, outDir, width = 1280, height = 720, signal }) {
  if (signal?.aborted) throw createAbortError()
  mkdirSync(outDir, { recursive: true })
  const { server, port } = await startStaticProjectServer(projectDir)
  const session = await openCdpSession(browserBin, width, height)
  const files = []
  const onAbort = () => {
    try { session.cleanup() } catch {}
    try { server.close() } catch {}
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await waitForPageReady(session.cdp, `http://127.0.0.1:${port}/index.html?render=1`)
    for (let i = 0; i < frames.length; i++) {
      if (signal?.aborted) throw createAbortError()
      const f = frames[i]
      await session.cdp.send('Runtime.evaluate', {
        expression: `Promise.resolve(window.__seekToFrame ? window.__seekToFrame(${f}) : ${f}).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`,
        awaitPromise: true,
      })
      const shot = await session.cdp.send('Page.captureScreenshot', { format: 'png' })
      const pngPath = join(outDir, `shot_${String(i).padStart(2, '0')}.png`)
      const fd = openSync(pngPath, 'w')
      writeSync(fd, Buffer.from(shot.data, 'base64'))
      closeSync(fd)
      files.push(pngPath)
    }
    return files
  } finally {
    signal?.removeEventListener('abort', onAbort)
    session.cleanup()
    try { server.close() } catch {}
  }
}

/**
 * Capture EVERY frame (0..totalFrames-1) of HTML5 animation via Chromium CDP
 * and encode directly with master audio into H.264 yuv420p MP4.
 */
export async function renderHtmlVideoToMp4({
  projectDir,
  browserBin,
  totalFrames,
  fps = 30,
  width = 1920,
  height = 1080,
  audioPath,
  outMp4Path,
  snapshotFrames = [],
  snapshotDir = '',
  useSegmentCache = true,
  signal,
  onProgress,
}) {
  if (signal?.aborted) throw createAbortError()
  const { ffmpeg } = resolveBinaries()
  const htmlTotalSec = Math.max(4, totalFrames / Math.max(1, fps))
  const htmlHwPolicy = resolveLowSpecPolicy({
    repoRoot: REPO_ROOT,
    requestedFps: fps,
    totalDurationSec: htmlTotalSec,
  })
  const htmlFfThreadsArgs = htmlHwPolicy.ffmpegThreads > 0 ? ['-threads', String(htmlHwPolicy.ffmpegThreads)] : []
  const snapMap = new Map()
  snapshotFrames.forEach((f, idx) => {
    if (!snapMap.has(f)) snapMap.set(f, [])
    snapMap.get(f).push(idx)
  })
  if (snapshotDir) mkdirSync(snapshotDir, { recursive: true })

  // Deterministic Per-Scene Segment Cache fast-path (when script.json has >=2 scenes)
  let scriptData = null
  if (useSegmentCache) {
    try {
      scriptData = readScriptJson(projectDir).data
    } catch {}
  }

  if (useSegmentCache && scriptData && Array.isArray(scriptData.scenes) && scriptData.scenes.length >= 2) {
    let serverObj = null
    let cdpSession = null
    const abortCleanup = () => {
      try { cdpSession?.cleanup() } catch {}
      try { serverObj?.server?.close() } catch {}
    }
    signal?.addEventListener('abort', abortCleanup, { once: true })
    const ensureBrowser = async () => {
      if (signal?.aborted) throw createAbortError()
      if (!serverObj) {
        serverObj = await startStaticProjectServer(projectDir)
      }
      if (!cdpSession) {
        cdpSession = await openCdpSession(browserBin, width, height)
        await waitForPageReady(cdpSession.cdp, `http://127.0.0.1:${serverObj.port}/index.html?render=1`)
      }
      return cdpSession
    }

    try {
      const segRes = await renderHtmlSegmentsWithCache({
        projectDir,
        script: scriptData,
        ffmpeg,
        outMp4: outMp4Path,
        audioWavPath: audioPath,
        fps,
        renderWidth: width,
        renderHeight: height,
        signal,
        onProgress,
        captureFrameRangeToSilentMp4: async ({ startFrame, endFrameExclusive, outSilentMp4 }) => {
          const sess = await ensureBrowser()
          const tmpBase = join(REPO_ROOT, '.tmp')
          mkdirSync(tmpBase, { recursive: true })
          const mjpegPath = join(tmpBase, `seg-${startFrame}-${Date.now()}.mjpeg`)
          const mjpegFd = openSync(mjpegPath, 'w')
          try {
            for (let f = startFrame; f < endFrameExclusive; f++) {
              if (signal?.aborted) throw createAbortError()
              await sess.cdp.send('Runtime.evaluate', {
                expression: `Promise.resolve(window.__seekToFrame ? window.__seekToFrame(${f}) : ${f}).then(() => new Promise(r => requestAnimationFrame(r)))`,
                awaitPromise: true,
              })
              const shot = await sess.cdp.send('Page.captureScreenshot', {
                format: 'jpeg',
                quality: 90,
                optimizeForSpeed: true,
              })
              writeSync(mjpegFd, Buffer.from(shot.data, 'base64'))
              if (onProgress && ((f - startFrame) % 15 === 0 || f === endFrameExclusive - 1)) {
                const denom = Math.max(1, Number(totalFrames) || endFrameExclusive)
                const pct = Math.min(94, Math.max(10, Math.round(((f + 1) / denom) * 90)))
                onProgress({
                  frame: f + 1,
                  totalFrames: denom,
                  pct,
                  progress: pct,
                  message: `正在逐帧合成高清画面 (${f + 1}/${denom} 帧 · ${pct}%)...`,
                })
              }
              if (snapshotDir && snapMap.has(f)) {
                const pShot = await sess.cdp.send('Page.captureScreenshot', { format: 'png' })
                const pngBuf = Buffer.from(pShot.data, 'base64')
                for (const idx of snapMap.get(f)) {
                  const sPath = join(snapshotDir, `shot_${String(idx).padStart(2, '0')}.png`)
                  const pFd = openSync(sPath, 'w')
                  writeSync(pFd, pngBuf)
                  closeSync(pFd)
                }
              }
            }
          } finally {
            try { closeSync(mjpegFd) } catch {}
          }

          const segSec = Number(((endFrameExclusive - startFrame) / fps).toFixed(3))
          try {
            const enc = await runCommandRedirected(
              ffmpeg,
              [
                '-y', '-f', 'mjpeg', '-framerate', String(fps), '-i', mjpegPath,
                '-vf', 'scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p',
                '-c:v', 'libx264', '-preset', htmlHwPolicy.ffmpegPreset || 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
                ...htmlFfThreadsArgs,
                '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                '-g', String(Math.max(15, fps)), '-sc_threshold', '0', '-video_track_timescale', '90000', '-an', '-t', String(segSec),
                outSilentMp4,
              ],
              { timeoutMs: Math.max(180_000, Math.round(segSec * 4500)), signal },
            )
            if (enc.code !== 0 || !existsSync(outSilentMp4)) {
              throw new Error(`Segment encode failed: ${enc.stderr}`)
            }
          } finally {
            try { unlinkSync(mjpegPath) } catch {}
          }
        },
      })

      // Extract any snapshot frames missing due to cache hits straight from final outMp4Path
      if (snapshotDir && snapshotFrames.length > 0) {
        for (let i = 0; i < snapshotFrames.length; i++) {
          const sPath = join(snapshotDir, `shot_${String(i).padStart(2, '0')}.png`)
          if (!existsSync(sPath)) {
            const atSec = (Number(snapshotFrames[i]) || 0) / fps
            await runCommandRedirected(
              ffmpeg,
              ['-y', '-ss', atSec.toFixed(3), '-i', outMp4Path, '-frames:v', '1', sPath],
              { timeoutMs: 15_000 },
            ).catch(() => {})
          }
        }
      }

      return { ok: true, framesRendered: totalFrames, outputPath: outMp4Path, segmentCache: segRes }
    } finally {
      signal?.removeEventListener('abort', abortCleanup)
      if (cdpSession) cdpSession.cleanup()
      if (serverObj) try { serverObj.server.close() } catch {}
    }
  }

  const tmpBase = join(REPO_ROOT, '.tmp')
  mkdirSync(tmpBase, { recursive: true })
  const mjpegPath = join(tmpBase, `frames-${Date.now()}.mjpeg`)
  const mjpegFd = openSync(mjpegPath, 'w')

  const { server, port } = await startStaticProjectServer(projectDir)
  const session = await openCdpSession(browserBin, width, height)

  try {
    await waitForPageReady(session.cdp, `http://127.0.0.1:${port}/index.html?render=1`)
    for (let f = 0; f < totalFrames; f++) {
      await session.cdp.send('Runtime.evaluate', {
        expression: `Promise.resolve(window.__seekToFrame ? window.__seekToFrame(${f}) : ${f}).then(() => new Promise(r => requestAnimationFrame(r)))`,
        awaitPromise: true,
      })
      const shot = await session.cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 90,
        optimizeForSpeed: true,
      })
      const jpg = Buffer.from(shot.data, 'base64')
      writeSync(mjpegFd, jpg)

      if (snapshotDir && snapMap.has(f)) {
        const pShot = await session.cdp.send('Page.captureScreenshot', { format: 'png' })
        const pngBuf = Buffer.from(pShot.data, 'base64')
        for (const idx of snapMap.get(f)) {
          const sPath = join(snapshotDir, `shot_${String(idx).padStart(2, '0')}.png`)
          const pFd = openSync(sPath, 'w')
          writeSync(pFd, pngBuf)
          closeSync(pFd)
        }
      }
      if (onProgress && (f % 15 === 0 || f === totalFrames - 1)) {
        const pct = Math.min(99, Math.round(((f + 1) / Math.max(1, totalFrames)) * 100))
        onProgress({ frame: f + 1, totalFrames, pct })
      }
    }
  } finally {
    try { closeSync(mjpegFd) } catch {}
    session.cleanup()
    try { server.close() } catch {}
  }

  const totalSec = Number((totalFrames / fps).toFixed(3))
  const ffArgs = ['-y', '-f', 'mjpeg', '-framerate', String(fps), '-i', mjpegPath]
  if (audioPath && existsSync(audioPath)) {
    ffArgs.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0')
  } else {
    ffArgs.push('-f', 'lavfi', '-t', String(totalSec), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0')
  }
  ffArgs.push(
    '-vf', 'scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', htmlHwPolicy.ffmpegPreset || 'medium',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    ...htmlFfThreadsArgs,
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
  try {
    const enc = await runCommandRedirected(ffmpeg, ffArgs, {
      timeoutMs: Math.max(300_000, Math.round(totalSec * 4500)),
      signal,
    })
    if (enc.code !== 0 || !existsSync(outMp4Path)) {
      throw new Error(`FFmpeg encode failed: ${enc.stderr}`)
    }
  } finally {
    try { unlinkSync(mjpegPath) } catch {}
  }

  return { ok: true, framesRendered: totalFrames, outputPath: outMp4Path }
}

function findRemotionBrowser(remotionRuntime) {
  const candidates = [
    remotionRuntime?.nodeModulesDir && join(remotionRuntime.nodeModulesDir, '.remotion', 'chrome-headless-shell'),
    remotionRuntime?.templateRoot && join(remotionRuntime.templateRoot, 'node_modules', '.remotion', 'chrome-headless-shell'),
  ].filter(Boolean)
  for (const remotionCache of candidates) {
    if (!existsSync(remotionCache)) continue
    const win64 = join(remotionCache, 'win64')
    if (existsSync(win64)) {
      for (const sub of readdirSync(win64)) {
        const exe = join(win64, sub, 'chrome-headless-shell.exe')
        if (existsSync(exe)) return exe
      }
    }
  }
  return null
}

export async function renderRemotionProject({ projectDir, outMp4Path, snapshotFrames = [], snapshotDir = '', onlySnapshots = false, signal }) {
  if (signal?.aborted) throw createAbortError()
  const runtime = resolveRemotionRuntime()
  if (!runtime || !existsSync(runtime.rendererEntry) || !existsSync(runtime.bundlerEntry)) {
    return {
      ok: false,
      reason: 'Remotion runtime not found (install plugin dependencies or configure REMOTION_TEMPLATE_ROOT)',
    }
  }

  const absProject = resolve(projectDir)
  ensureRemotionJunction(absProject)

  const bundlerMod = await import(pathToFileURL(runtime.bundlerEntry).href)
  const rendererMod = await import(pathToFileURL(runtime.rendererEntry).href)

  const entryPoint = existsSync(join(absProject, 'src', 'index.ts'))
    ? join(absProject, 'src', 'index.ts')
    : join(absProject, 'src', 'Root.tsx')
  const publicDir = join(absProject, 'public')
  const browserExecutable = findRemotionBrowser(runtime) || resolveBrowserExecutable() || undefined

  const serveUrl = await bundlerMod.bundle({
    entryPoint,
    publicDir: existsSync(publicDir) ? publicDir : undefined,
    onProgress: () => {},
  })

  const composition = await rendererMod.selectComposition({
    serveUrl,
    id: 'MainVideo',
    browserExecutable,
  })

  if (snapshotDir && snapshotFrames.length > 0) {
    mkdirSync(snapshotDir, { recursive: true })
    for (let i = 0; i < snapshotFrames.length; i++) {
      await rendererMod.renderStill({
        composition,
        serveUrl,
        frame: snapshotFrames[i],
        output: join(snapshotDir, `shot_${String(i).padStart(2, '0')}.png`),
        imageFormat: 'png',
        browserExecutable,
        offthreadVideoThreads: 1,
        offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024,
      })
    }
  }

  if (!onlySnapshots && outMp4Path) {
    const totalSec = Math.max(4, (composition.durationInFrames || 300) / (composition.fps || 30))
    const hwPolicy = resolveLowSpecPolicy({
      repoRoot: REPO_ROOT,
      requestedFps: composition.fps || 30,
      totalDurationSec: totalSec,
    })
    const attemptRender = async (concurrency, videoThreads, cacheBytes, delayTimeoutMs) => {
      const { cancelSignal, cancel } = typeof rendererMod.makeCancelSignal === 'function'
        ? rendererMod.makeCancelSignal()
        : { cancelSignal: undefined, cancel: () => {} }
      const onRemotionAbort = () => {
        try { cancel() } catch {}
      }
      signal?.addEventListener('abort', onRemotionAbort, { once: true })
      try {
        await rendererMod.renderMedia({
          composition,
          serveUrl,
          codec: 'h264',
          pixelFormat: 'yuv420p',
          audioCodec: 'aac',
          crf: 19,
          outputLocation: outMp4Path,
          browserExecutable,
          concurrency,
          offthreadVideoThreads: videoThreads,
          offthreadVideoCacheSizeInBytes: cacheBytes,
          delayRenderTimeoutInMilliseconds: delayTimeoutMs,
          chromiumOptions: {
            gl: hwPolicy.chromiumGl || undefined,
          },
          cancelSignal,
        })
      } finally {
        signal?.removeEventListener('abort', onRemotionAbort)
      }
    }

    try {
      await attemptRender(
        hwPolicy.remotionConcurrency,
        hwPolicy.offthreadVideoThreads,
        hwPolicy.offthreadVideoCacheSizeInBytes,
        hwPolicy.delayRenderTimeoutMs,
      )
    } catch (err) {
      const msg = String(err?.message || err || '')
      const canFallbackLowSpec =
        !signal?.aborted &&
        (hwPolicy.remotionConcurrency > 1 || /No frame found at position|Compositor error|timeout|out of memory|Target closed/i.test(msg))
      if (!canFallbackLowSpec) throw err
      await attemptRender(1, 1, 128 * 1024 * 1024, Math.max(180_000, hwPolicy.delayRenderTimeoutMs))
    }
  }

  return { ok: true, framesRendered: composition.durationInFrames, outputPath: outMp4Path }
}
