import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from './index'
import type { LlmService, StreamChunk } from './textgen/types'

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []
const cleanups: Array<() => void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function createHarness(options: { holdRestartTask: boolean }, routes = new Map<string, RouteHandler>()) {
  let pluginCleanup: (() => void) | null = null
  const llm: LlmService = {
    listProviders: () => [{ provider: 'harness-test' }],
    listModels: async () => [{ id: 'test-model' }],
    prepareCall: async (config, signal) => ({
      stream: async function* (): AsyncIterable<StreamChunk> {
        const prompt = config.messages.map((item) => item.content).join('\n')
        if (options.holdRestartTask && prompt.includes('等待重启')) {
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve()
            else signal?.addEventListener('abort', () => resolve(), { once: true })
          })
          return
        }
        yield { type: 'text-delta', index: 0, text: 'Harness ' }
        yield { type: 'text-delta', index: 0, text: '生成完成' }
        yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 6 } }
        yield { type: 'finish', reason: 'stop' }
      },
    }),
  }
  const context = {
    webServer: {
      register: ({ path, handler }: { path: string; handler: RouteHandler }) => {
        routes.set(path, handler)
        return () => { routes.delete(path) }
      },
    },
    connection: {
      requestRejection(request: IncomingMessage) {
        return request.headers['x-harness-auth'] === 'ok' ? undefined : { reason: 'untrusted' }
      },
    },
    llm,
    effect(setup: () => (() => void)) {
      pluginCleanup = setup()
    },
  } as unknown as Context
  return {
    context,
    routes,
    cleanup: () => {
      pluginCleanup?.()
      pluginCleanup = null
    },
  }
}

async function startHarnessServer(routes: Map<string, RouteHandler>): Promise<string> {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const handler = routes.get(path)
    if (!handler) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    await handler(req, res)
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function api<T>(base: string, path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const response = await fetch(`${base}/api/paipiange${path}`, {
    ...init,
    headers: { 'x-harness-auth': 'ok', 'Content-Type': 'application/json', ...init.headers },
  })
  return { status: response.status, data: await response.json() as T }
}

async function waitForTask(base: string, id: string, status: string, timeoutMs = 3_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await api<{ task: Record<string, unknown> }>(base, `.task?id=${encodeURIComponent(id)}`)
    if (response.data.task.status === status) return response.data.task
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`task ${id} did not reach ${status}`)
}

describe('DeepSeek Harness plugin end-to-end', () => {
  it('registers trusted routes, persists generation, and resumes queue work after plugin restart', async () => {
    const dataRoot = join(tmpdir(), `paipiange-harness-e2e-${randomUUID()}`)
    roots.push(dataRoot)
    const first = createHarness({ holdRestartTask: true })
    await apply(first.context, { dataRoot, queueConcurrency: 1 })
    const base = await startHarnessServer(first.routes)

    const unauthorized = await fetch(`${base}/api/paipiange.health`)
    expect(unauthorized.status).toBe(401)
    const health = await api<{ ok: boolean }> (base, '.health')
    expect(health).toMatchObject({ status: 200, data: { ok: true } })

    const creation = await api<{ creation: { id: string } }>(base, '.creations', {
      method: 'POST',
      body: JSON.stringify({ studio: 'article', title: '回归测试', topic: '真实 Harness 流程', content: '这是发布回归正文。' }),
    })
    expect(creation.status).toBe(201)

    const completedRequest = await api<{ task: { id: string } }>(base, '.textgen.enqueue', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'harness-test', model: 'test-model', studio: 'article', topic: '立即完成',
        sourceCreationId: creation.data.creation.id, clientRequestId: 'e2e-complete',
      }),
    })
    expect(completedRequest.status).toBe(202)
    const completed = await waitForTask(base, completedRequest.data.task.id, 'success')
    expect(completed.result).toMatchObject({ text: 'Harness 生成完成' })

    const publishItem = await api<{ item: { id: string } }>(base, '.publish', {
      method: 'POST', body: JSON.stringify({ creationId: creation.data.creation.id, platform: 'xiaohongshu' }),
    })
    const exportResponse = await fetch(`${base}/api/paipiange.export`, {
      method: 'POST',
      headers: { 'x-harness-auth': 'ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ creationId: creation.data.creation.id, format: 'text', platform: 'xiaohongshu', publishItemId: publishItem.data.item.id }),
    })
    expect(exportResponse.status).toBe(200)
    expect(await exportResponse.text()).toContain('回归测试')
    const publishDetail = await api<{ attempts: unknown[]; versions: unknown[]; checklist: Array<{ passed: boolean }> }>(base, `.publish.detail?id=${publishItem.data.item.id}`)
    expect(publishDetail.data.attempts).toHaveLength(1)
    expect(publishDetail.data.versions).toHaveLength(1)
    expect(publishDetail.data.checklist.every((item) => item.passed)).toBe(true)

    const restartRequest = await api<{ task: { id: string } }>(base, '.textgen.enqueue', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'harness-test', model: 'test-model', studio: 'article', topic: '等待重启',
        clientRequestId: 'e2e-restart', priority: 20, maxAttempts: 3,
      }),
    })
    const restartId = restartRequest.data.task.id
    await waitForTask(base, restartId, 'running')

    const paused = await api<{ task: { status: string } }>(base, '.task.pause', {
      method: 'POST', body: JSON.stringify({ id: restartId }),
    })
    expect(paused.data.task.status).toBe('paused')
    const priority = await api<{ task: { priority: number } }>(base, '.task.priority', {
      method: 'PATCH', body: JSON.stringify({ id: restartId, priority: 40 }),
    })
    expect(priority.data.task.priority).toBe(40)
    await api(base, '.task.resume', { method: 'POST', body: JSON.stringify({ id: restartId }) })
    await waitForTask(base, restartId, 'running')

    first.cleanup()
    const second = createHarness({ holdRestartTask: false }, first.routes)
    cleanups.push(second.cleanup)
    await apply(second.context, { dataRoot, queueConcurrency: 1 })
    const resumed = await waitForTask(base, restartId, 'success')
    expect(resumed).toMatchObject({ priority: 40, attempt: 3, retryCount: 0, result: { text: 'Harness 生成完成' } })

    const tasks = await api<{ tasks: Array<{ id: string }> }>(base, '.tasks')
    expect(tasks.data.tasks.map((task) => task.id)).toEqual(expect.arrayContaining([completedRequest.data.task.id, restartId]))
  })
})
