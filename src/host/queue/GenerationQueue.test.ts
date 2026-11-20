import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from '../storage/database'
import { TaskRepository } from '../storage/taskRepository'
import { GenerationQueue, QueueTaskError } from './GenerationQueue'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup() {
  const root = join(tmpdir(), `paipiange-queue-test-${randomUUID()}`)
  temporaryRoots.push(root)
  const storage = await PaipiangeDatabase.open({ dataRoot: root, seedBuiltin: false })
  return { storage, tasks: new TaskRepository(storage.db) }
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for queue state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('GenerationQueue', () => {
  it('enforces concurrency and runs higher-priority work first', async () => {
    const { storage, tasks } = await setup()
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const queue = new GenerationQueue(tasks, { concurrency: 1, retryBaseDelayMs: 1 })
      .register('image', async (task) => {
        order.push(String(task.queuePayload?.name))
        if (order.length === 1) await firstGate
        return { name: task.queuePayload?.name }
      })

    tasks.enqueue({ kind: 'image', priority: 1, queuePayload: { name: 'low' } })
    tasks.enqueue({ kind: 'image', priority: 10, queuePayload: { name: 'high' } })
    queue.start()
    await waitFor(() => order.length === 1)
    expect(order).toEqual(['high'])
    releaseFirst()
    await waitFor(() => tasks.list('image', 'success').length === 2)
    expect(order).toEqual(['high', 'low'])
    queue.stop()
    storage.close()
  })

  it('retries transient failures and records the final attempt', async () => {
    const { storage, tasks } = await setup()
    let calls = 0
    const task = tasks.enqueue({ kind: 'text', maxAttempts: 3, queuePayload: { topic: '重试' } })
    const queue = new GenerationQueue(tasks, { retryBaseDelayMs: 1 })
      .register('text', async () => {
        calls += 1
        if (calls < 3) throw new QueueTaskError('临时超时', 'timeout')
        return { text: '完成' }
      })

    queue.start()
    await waitFor(() => tasks.getById(task.id)?.status === 'success')
    expect(tasks.getById(task.id)).toMatchObject({ attempt: 3, result: { text: '完成' } })
    queue.stop()
    storage.close()
  })

  it('supports pause and resume without consuming another retry on abort', async () => {
    const { storage, tasks } = await setup()
    let calls = 0
    const task = tasks.enqueue({ kind: 'video', queuePayload: { topic: '暂停' } })
    const queue = new GenerationQueue(tasks)
      .register('video', async (_task, context) => {
        calls += 1
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 500)
          context.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('aborted'))
          }, { once: true })
        })
        return { assetId: 'video' }
      })

    queue.start()
    await waitFor(() => tasks.getById(task.id)?.status === 'running')
    expect(queue.pause(task.id)).toBe(true)
    await waitFor(() => tasks.getById(task.id)?.status === 'paused')
    expect(queue.resume(task.id)).toBe(true)
    await waitFor(() => tasks.getById(task.id)?.status === 'success')
    expect(calls).toBe(2)
    expect(tasks.getById(task.id)?.attempt).toBe(2)
    queue.stop()
    storage.close()
  })
})
