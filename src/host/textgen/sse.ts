import type { ServerResponse } from 'node:http'

/**
 * A tiny Server-Sent Events writer used by the text-gen route to stream
 * incremental deltas to the browser. Emits `data:` lines and a terminal
 * `event: done` frame so the client knows the stream has finished.
 */

export function startSse(res: ServerResponse): (event: string, data: unknown) => void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  return (event, data) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    res.write(`event: ${event}\ndata: ${payload}\n\n`)
  }
}

export function endSse(send: (event: string, data: unknown) => void): void {
  send('done', '')
}

export function abortSse(res: ServerResponse): void {
  res.end()
}
