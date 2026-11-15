import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Bridges Node's `IncomingMessage`/`ServerResponse` (the shape the official
 * Harness `webServer` service hands to route handlers) into the Web standard
 * `Request`/`Response` pair that the rest of the API layer already speaks.
 *
 * This keeps every route handler in `routes.ts` written against the Fetch API
 * while the registration itself targets the real `ctx.webServer.register`
 * contract (`kind: 'exact'`, `path`, `handler(req, res)`).
 */

/** Rebuild a fully-qualified absolute URL from a Node request. */
function requestUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? 'localhost'
  // In desktop the page is same-origin loopback; the path already carries the
  // query string, so `req.url` is enough to reconstruct a valid absolute URL.
  return new URL(req.url ?? '/', `http://${host}`)
}

/** Read the buffered request body into a Uint8Array (or null for GET/HEAD). */
function readBody(req: IncomingMessage): Promise<ArrayBuffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let oversized = false
    req.on('data', (chunk: Buffer) => {
      if (oversized) return
      chunks.push(chunk)
      size += chunk.length
      // Guard against unbounded bodies; reject (without destroying the socket)
      // so the handler can still answer a clean 413 instead of dropping the
      // connection mid-write.
      if (size > 64 * 1024 * 1024) {
        oversized = true
        reject(new Error('请求体过大'))
      }
    })
    req.on('end', () => {
      if (oversized) return
      if (!chunks.length) return resolve(null)
      const buffer = Buffer.concat(chunks)
      // Copy into a fresh ArrayBuffer so `new Request(...)` accepts the body.
      const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      resolve(ab)
    })
    req.on('error', reject)
  })
}

/** Convert an `IncomingMessage` into a Fetch `Request`. */
export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = requestUrl(req)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) headers.append(key, item)
    else headers.append(key, value)
  }
  const method = req.method ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? null : await readBody(req)
  return new Request(url, { method, headers, body })
}

/** Write a Fetch `Response` into a Node `ServerResponse`. */
export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, headers)
  const body = await response.arrayBuffer()
  res.end(body.byteLength ? Buffer.from(body) : undefined)
}
