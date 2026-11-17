/**
 * 视频生成 · 无头浏览器逐帧截图渲染器
 *
 * 借鉴 dsh-video-workbench 的 HTML5 引擎：启动无头 Edge/Chrome，通过 Chrome
 * DevTools Protocol (CDP) 打开动画页面，逐帧调用 `window.__seekToFrame(n)` 定位，
 * 再用 `Page.captureScreenshot` 抓 JPEG，所有帧顺序写入一个 MJPEG 流文件，交给
 * FFmpeg 合成。仅依赖 Node 内置能力（node:http、node:child_process、原生 WebSocket）。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'

/** CDP 请求/响应封装，用 Node 原生 WebSocket。 */
class CdpClient {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  private ready: Promise<void>

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl)
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', (e) => reject(e))
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'))
        else p.resolve(msg.result)
      }
    })
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    await this.ready
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

export interface BrowserBin {
  path: string
  label: string
}

/** 定位本机可用的无头浏览器（优先 Edge，其次 Chrome）。 */
export function findBrowser(): BrowserBin | null {
  const candidates: BrowserBin[] = [
    { path: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', label: 'Edge' },
    { path: 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', label: 'Edge' },
    { path: 'C:/Program Files/Google/Chrome/Application/chrome.exe', label: 'Chrome' },
    { path: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', label: 'Chrome' },
  ]
  for (const c of candidates) {
    if (existsSync(c.path)) return c
  }
  return null
}

export interface RenderResult {
  mjpegPath: string
  totalFrames: number
  width: number
  height: number
  fps: number
}

export interface RenderHtmlOptions {
  html: string
  totalFrames: number
  width: number
  height: number
  fps: number
  outDir: string
  browser?: BrowserBin
  onProgress?: (frame: number, total: number) => void
}

/** 启动一个极简静态服务器，用内存提供页面（单文件）。 */
function startServer(html: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(html),
        })
        res.end(html)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, port: addr.port })
    })
  })
}

/** 启动无头浏览器并等待 DevTools 端口就绪。 */
async function launchBrowser(browser: BrowserBin, width: number, height: number): Promise<{ proc: ChildProcess; wsUrl: string }> {
  const userDataDir = join(tmpdir(), `paipiange-cdp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(userDataDir, { recursive: true })

  const proc = spawn(
    browser.path,
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

  // 读取 DevToolsActivePort 文件获取调试端口
  const portFile = join(userDataDir, 'DevToolsActivePort')
  let port = -1
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const content = readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
      if (content[0]) {
        port = Number(content[0])
        break
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  if (port < 0) throw new Error('无头浏览器启动超时，未获取 DevTools 端口')

  // 通过 /json/list 获取页面目标 wsUrl
  let wsUrl = ''
  const wsDeadline = Date.now() + 10000
  while (Date.now() < wsDeadline && !wsUrl) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = (await res.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl
    } catch {
      /* retry */
    }
    if (!wsUrl) await new Promise((r) => setTimeout(r, 100))
  }
  if (!wsUrl) throw new Error('未获取到页面 WebSocket 调试地址')

  return { proc, wsUrl }
}

/**
 * 逐帧截图，把 JPEG 顺序写入 MJPEG 流文件。
 */
export async function renderHtmlToMjpeg(options: RenderHtmlOptions): Promise<RenderResult> {
  const { html, totalFrames, width, height, fps, outDir, onProgress } = options
  const browser = options.browser ?? findBrowser()
  if (!browser) throw new Error('未找到可用的无头浏览器（Edge/Chrome）')

  mkdirSync(outDir, { recursive: true })
  const mjpegPath = join(outDir, 'frames.mjpeg')
  const fd = openSync(mjpegPath, 'w')

  const { server, port } = await startServer(html)
  const { proc, wsUrl } = await launchBrowser(browser, width, height)

  const cdp = new CdpClient(wsUrl)
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await cdp.send('Page.enable')
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` })

    // 等待页面就绪（document complete + 字体）
    await new Promise((r) => setTimeout(r, 600))
    await cdp.send('Runtime.evaluate', {
      expression: '(async()=>{try{await document.fonts.ready}catch{};return true})()',
      awaitPromise: true,
    })

    for (let f = 0; f < totalFrames; f++) {
      await cdp.send('Runtime.evaluate', {
        expression: `Promise.resolve(window.__seekToFrame ? window.__seekToFrame(${f}) : null).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`,
        awaitPromise: true,
      })
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 90,
        optimizeForSpeed: true,
      })
      const jpg = Buffer.from(shot.data, 'base64')
      writeSync(fd, jpg)
      onProgress?.(f + 1, totalFrames)
    }
  } finally {
    cdp.close()
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
    server.close()
  }
  closeSync(fd)

  return { mjpegPath, totalFrames, width, height, fps }
}
