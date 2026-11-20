import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { CreationRepository } from './creationRepository'
import { PublishRepository } from './publishRepository'

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
  const root = join(tmpdir(), `paipiange-publish-test-${randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}

/** publish_items.creation_id references creations(id), so seed a real creation first. */
async function setup() {
  const storage = await openTemporaryStorage()
  const creation = new CreationRepository(storage.db).create({ type: 'article', title: '测试创作' })
  return { storage, repo: new PublishRepository(storage.db), creationId: creation.id }
}

describe('PublishRepository', () => {
  it('creates a draft item with null lifecycle fields', async () => {
    const { storage, repo, creationId } = await setup()

    const item = repo.create({ creationId, platform: 'wechat' })
    const fetched = repo.getById(item.id)

    expect(fetched).not.toBeNull()
    expect(fetched!.status).toBe('draft')
    expect(fetched!.exportPath).toBeNull()
    expect(fetched!.externalId).toBeNull()
    expect(fetched!.retryCount).toBe(0)
    expect(fetched!.exportedAt).toBeNull()
    expect(fetched!.publishedAt).toBeNull()
    storage.close()
  })

  it('rejects an unsupported platform', async () => {
    const { storage, repo, creationId } = await setup()

    expect(() => repo.create({ creationId, platform: 'blog' as never })).toThrow('不支持的发布平台')
    storage.close()
  })

  it('ensureForCreation is idempotent for the same creation', async () => {
    const { storage, repo, creationId } = await setup()

    const first = repo.ensureForCreation(creationId, 'wechat')
    const second = repo.ensureForCreation(creationId, 'xiaohongshu')

    expect(second.id).toBe(first.id)
    expect(second.platform).toBe('wechat') // untouched, not overwritten
    expect(repo.list()).toHaveLength(1)
    storage.close()
  })

  it('stamps lifecycle timestamps when status transitions', async () => {
    const { storage, repo, creationId } = await setup()

    const item = repo.create({ creationId, platform: 'wechat' })

    const exported = repo.update(item.id, { status: 'exported' })
    expect(exported!.status).toBe('exported')
    expect(exported!.exportedAt).not.toBeNull()
    expect(exported!.publishedAt).toBeNull()

    const published = repo.update(item.id, { status: 'published' })
    expect(published!.status).toBe('published')
    expect(published!.publishedAt).not.toBeNull()
    expect(published!.exportedAt).toBe(exported!.exportedAt) // not re-stamped
    storage.close()
  })

  it('filters list by status', async () => {
    const { storage, repo, creationId } = await setup()

    repo.create({ creationId, platform: 'wechat', status: 'draft' })
    repo.create({ creationId, platform: 'zhihu', status: 'ready' })

    expect(repo.list({ status: 'draft' })).toHaveLength(1)
    expect(repo.list()).toHaveLength(2)
    storage.close()
  })

  it('remove deletes the item and getById returns null afterwards', async () => {
    const { storage, repo, creationId } = await setup()

    const item = repo.create({ creationId, platform: 'wechat' })
    expect(repo.remove(item.id)).toBe(true)
    expect(repo.getById(item.id)).toBeNull()
    storage.close()
  })

  it('records immutable versions and successful attempts with media_id', async () => {
    const { storage, repo, creationId } = await setup()
    const item = repo.create({ creationId, platform: 'wechat' })

    expect(repo.recordVersion(item.id, { title: '第一版', bodyMd: '正文一' }).versionNo).toBe(1)
    expect(repo.recordVersion(item.id, { title: '第二版', bodyMd: '正文二' }).versionNo).toBe(2)
    const attempt = repo.createAttempt({ publishItemId: item.id, platform: 'wechat', action: 'wechat_draft' })
    repo.finishAttempt(attempt.id, { status: 'success', mediaId: 'draft-media-id', itemStatus: 'ready', result: { imageCount: 3 } })

    expect(repo.listVersions(item.id).map((version) => version.versionNo)).toEqual([2, 1])
    expect(repo.listAttempts(item.id)[0]).toMatchObject({ status: 'success', mediaId: 'draft-media-id', result: { imageCount: 3 } })
    expect(repo.getById(item.id)).toMatchObject({ status: 'ready', externalId: 'draft-media-id', lastError: null })
    storage.close()
  })

  it('persists failure reasons and increments retry count', async () => {
    const { storage, repo, creationId } = await setup()
    const item = repo.create({ creationId, platform: 'xiaohongshu' })
    const first = repo.createAttempt({ publishItemId: item.id, platform: item.platform, action: 'export' })
    repo.finishAttempt(first.id, { status: 'failed', errorMessage: '磁盘空间不足' })
    const second = repo.createAttempt({ publishItemId: item.id, platform: item.platform, action: 'export', retryNo: 1 })
    repo.finishAttempt(second.id, { status: 'failed', errorMessage: '文件被占用' })

    expect(repo.getById(item.id)).toMatchObject({ retryCount: 2, lastError: '文件被占用' })
    expect(repo.listAttempts(item.id)).toHaveLength(2)
    storage.close()
  })
})
