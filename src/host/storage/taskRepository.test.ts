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
    repo.markFailed(task.id, 'imagegen', 'Image API error 401')

    const fetched = repo.getById(task.id)!
    expect(fetched.status).toBe('failed')
    expect(fetched.errorCode).toBe('imagegen')
    expect(fetched.errorMessage).toBe('Image API error 401')
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
})
