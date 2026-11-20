import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { TaskRepository } from './taskRepository'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(root, { recursive: true, force: true })
        lastError = undefined
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) throw lastError
  }
})

async function openTemporaryStorage() {
  const root = join(tmpdir(), `paipiange-task-test-${randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}

describe('TaskRepository (generation attempts)', () => {
  it('records a successful task with input and result', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)

    const task = repo.start({
      kind: 'text',
      modelId: 'deepseek-chat',
      input: { topic: '春日', studio: 'article' },
    })
    expect(task.status).toBe('running')

    repo.markSuccess(task.id, { text: '一篇关于春日的文章', usage: { inputTokens: 5, outputTokens: 20 } }, 'deepseek-chat')

    const fetched = repo.getById(task.id)!
    expect(fetched.status).toBe('success')
    expect(fetched.input).toEqual({ topic: '春日', studio: 'article' })
    expect(fetched.result).toMatchObject({ text: '一篇关于春日的文章' })
    expect(fetched.finishedAt).toBeTruthy()
    storage.close()
  })

  it('records a failed task with error message', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)

    const task = repo.start({ kind: 'image', input: { prompt: 'cat' } })
    repo.markFailed(task.id, 'imagegen', 'Image API error 401', {
      elapsedMs: 1234,
      images: [{ id: 'partial-image' }],
    })

    const fetched = repo.getById(task.id)!
    expect(fetched.status).toBe('failed')
    expect(fetched.errorCode).toBe('imagegen')
    expect(fetched.errorMessage).toBe('Image API error 401')
    expect(fetched.result).toEqual({ elapsedMs: 1234, images: [{ id: 'partial-image' }] })
    storage.close()
  })

  it('lists tasks newest-first and filters by kind', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)

    const a = repo.start({ kind: 'text', input: { topic: 'a' } })
    const b = repo.start({ kind: 'image', input: { prompt: 'b' } })
    repo.markSuccess(a.id, { text: 'x' })
    repo.markFailed(b.id, 'e', 'boom')

    expect(repo.list()).toHaveLength(2)
    expect(repo.list()[0].id).toBe(b.id) // newest first
    expect(repo.list('text')).toHaveLength(1)
    expect(repo.list('text')[0].id).toBe(a.id)
    expect(repo.list(undefined, 'failed')).toHaveLength(1)
    expect(repo.list(undefined, 'failed')[0].id).toBe(b.id)
    storage.close()
  })

  it('searches tasks by free-text query across input, result and error', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)

    const a = repo.start({ kind: 'text', input: { topic: '春日穿搭' } })
    const b = repo.start({ kind: 'image', input: { prompt: '海边日落' } })
    repo.markSuccess(a.id, { text: '含关键词「爆款」的文章' })
    repo.markFailed(b.id, 'imagegen', 'Image API 超时')

    expect(repo.list(undefined, undefined, 100, 0, '穿搭')).toHaveLength(1)
    expect(repo.list(undefined, undefined, 100, 0, '穿搭')[0].id).toBe(a.id)
    expect(repo.list(undefined, undefined, 100, 0, '爆款')).toHaveLength(1)
    expect(repo.list(undefined, undefined, 100, 0, '爆款')[0].id).toBe(a.id)
    expect(repo.list(undefined, undefined, 100, 0, '超时')).toHaveLength(1)
    expect(repo.list(undefined, undefined, 100, 0, '超时')[0].id).toBe(b.id)
    expect(repo.list(undefined, undefined, 100, 0, '不存在')).toHaveLength(0)
    // Like special characters are escaped, not treated as wildcards.
    expect(repo.list(undefined, undefined, 100, 0, '%')).toHaveLength(0)
    storage.close()
  })

  it('tracks progress and prevents late success from overwriting cancellation', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)

    const task = repo.start({
      kind: 'image',
      clientRequestId: 'request-123',
      input: { prompt: '三张连续漫画' },
    })
    expect(repo.getByClientRequestId('request-123')?.id).toBe(task.id)
    expect(repo.updateProgress(task.id, {
      progress: { completed: 1, total: 3, paused: true },
      images: [{ id: 'partial-image' }],
    })).toBe(true)
    expect(repo.markCancelled(task.id)).toBe(true)
    expect(repo.markSuccess(task.id, { images: [{ id: 'late-image' }] })).toBe(false)

    const fetched = repo.getById(task.id)!
    expect(fetched.status).toBe('cancelled')
    expect(fetched.result).toMatchObject({
      progress: { completed: 1, total: 3, paused: true },
      images: [{ id: 'partial-image' }],
    })
    storage.close()
  })

  it('marks unfinished tasks as interrupted after process restart', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)

    const running = repo.start({ kind: 'video', input: { topic: '本地动画' } })
    const complete = repo.start({ kind: 'text', input: { topic: '已完成内容' } })
    repo.markSuccess(complete.id, { text: 'done' })

    expect(repo.interruptRunning()).toBe(1)
    expect(repo.getById(running.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' })
    expect(repo.getById(complete.id)?.status).toBe('success')
    storage.close()
  })

  it('persists queue metadata and claims ready tasks by priority', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)

    const low = repo.enqueue({
      kind: 'image',
      priority: 1,
      maxAttempts: 4,
      input: { prompt: '低优先级' },
      queuePayload: { prompt: 'low' },
    })
    const high = repo.enqueue({
      kind: 'text',
      priority: 10,
      input: { topic: '高优先级' },
      queuePayload: { topic: 'high' },
    })

    expect(repo.claimNext()?.id).toBe(high.id)
    expect(repo.getById(high.id)).toMatchObject({ status: 'running', attempt: 1, priority: 10 })
    expect(repo.claimNext()?.id).toBe(low.id)
    expect(repo.getById(low.id)).toMatchObject({ maxAttempts: 4, queuePayload: { prompt: 'low' } })
    storage.close()
  })

  it('deduplicates enqueue requests by client request id', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)
    const first = repo.enqueue({ kind: 'text', clientRequestId: 'same-request', queuePayload: { topic: '一次' } })
    const second = repo.enqueue({ kind: 'text', clientRequestId: 'same-request', queuePayload: { topic: '重复' } })
    expect(second.id).toBe(first.id)
    expect(repo.list()).toHaveLength(1)
    storage.close()
  })

  it('pauses, resumes and retries durable queue work', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)
    const task = repo.enqueue({ kind: 'video', maxAttempts: 2, queuePayload: { topic: '动画' } })

    expect(repo.pause(task.id)).toBe(true)
    expect(repo.claimNext()).toBeNull()
    expect(repo.resume(task.id)).toBe(true)
    expect(repo.claimNext()?.id).toBe(task.id)
    expect(repo.retryOrFail(task.id, 'temporary', '暂时失败', { progress: 20 }, 0)).toBe('queued')
    expect(repo.claimNext()).toMatchObject({ attempt: 2, retryCount: 1 })
    expect(repo.retryOrFail(task.id, 'temporary', '仍然失败')).toBe('failed')
    expect(repo.getById(task.id)).toMatchObject({ status: 'failed', attempt: 2, retryCount: 1, errorCode: 'temporary' })
    storage.close()
  })

  it('requeues durable running work while failing legacy synchronous work after restart', async () => {
    const storage = await openTemporaryStorage()
    const repo = new TaskRepository(storage.db)
    const durable = repo.enqueue({ kind: 'image', queuePayload: { prompt: '继续生成' } })
    repo.claimNext()
    const legacy = repo.start({ kind: 'text', input: { topic: '旧同步任务' } })

    expect(repo.recoverInterrupted()).toEqual({ requeued: 1, failed: 1 })
    expect(repo.getById(durable.id)).toMatchObject({ status: 'queued', errorCode: 'interrupted' })
    expect(repo.getById(legacy.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' })
    storage.close()
  })
})
