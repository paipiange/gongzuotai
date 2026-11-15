import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { sendWebResponse, toWebRequest } from './webServerAdapter'

// 验证 Node HTTP 与 Fetch 之间的桥接层：确保 `webServer` 的 handler 能拿到
// 正确的 Web Request，并把它写回 Node Response，二进制与 JSON 都能无损往返。

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  const server = createServer(handler)
  servers.push(server)
  return new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve(`http://127.0.0.1:${port}`)
    })
  })
}

describe('webServerAdapter (Node <-> Fetch bridge)', () => {
  it('round-trips a JSON POST request into a Fetch Request', async () => {
    const base = await startServer(async (req, res) => {
      const request = await toWebRequest(req)
      const body = await request.json()
      expect(request.method).toBe('POST')
      expect(request.url).toContain('/api/paipiange.creations')
      expect(body).toEqual({ studio: 'article' })
      await sendWebResponse(res, Response.json({ ok: true }))
    })

    const response = await fetch(`${base}/api/paipiange.creations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studio: 'article' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('preserves query string and binary bytes', async () => {
    const base = await startServer(async (req, res) => {
      const request = await toWebRequest(req)
      const id = new URL(request.url).searchParams.get('id')
      const bytes = new Uint8Array(await request.arrayBuffer())
      await sendWebResponse(res, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'X-Id': id ?? '' } }))
    })

    const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]) // "PK.." zip magic
    const response = await fetch(`${base}/asset?id=abc123`, { method: 'POST', body: payload })
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Id')).toBe('abc123')
    const received = new Uint8Array(await response.arrayBuffer())
    expect([...received]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('rejects oversized bodies above the 64 MiB ceiling', async () => {
    const base = await startServer(async (req, res) => {
      try {
        await toWebRequest(req)
        await sendWebResponse(res, Response.json({ ok: true }))
      } catch (error) {
        await sendWebResponse(res, Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 413 }))
      }
    })

    const big = new Uint8Array(65 * 1024 * 1024 + 1)
    const response = await fetch(`${base}/upload`, { method: 'POST', body: big })
    expect(response.status).toBe(413)
  }, 20000)
})
