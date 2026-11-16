import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { GraphicSessionRepository } from './graphicSessionRepository'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

async function openTemporaryStorage() {
  const root = join(tmpdir(), `paipiange-graphic-session-test-${randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}

describe('GraphicSessionRepository (single-row session)', () => {
  it('returns null when no session exists', async () => {
    const storage = await openTemporaryStorage()
    const repo = new GraphicSessionRepository(storage.db)
    expect(repo.get()).toBeNull()
    storage.close()
  })

  it('saves and reads back a full session', async () => {
    const storage = await openTemporaryStorage()
    const repo = new GraphicSessionRepository(storage.db)
    repo.save({
      sourceText: '素材',
      topic: '主题',
      pageCount: 4,
      textPick: 'b::m',
      imagePick: 'b2::m2',
      storyboardJson: '{"topic":"主题","pages":[]}',
      pagesJson: '[{"page":{},"assetId":"a1"}]',
      sessionId: 'sid-1',
    })
    const got = repo.get()
    expect(got).not.toBeNull()
    expect(got!.sourceText).toBe('素材')
    expect(got!.topic).toBe('主题')
    expect(got!.pageCount).toBe(4)
    expect(got!.textPick).toBe('b::m')
    expect(got!.imagePick).toBe('b2::m2')
    expect(got!.storyboardJson).toBe('{"topic":"主题","pages":[]}')
    expect(got!.pagesJson).toBe('[{"page":{},"assetId":"a1"}]')
    expect(got!.sessionId).toBe('sid-1')
    expect(got!.updatedAt).toBeTruthy()
    storage.close()
  })

  it('upserts: second save overwrites the single row', async () => {
    const storage = await openTemporaryStorage()
    const repo = new GraphicSessionRepository(storage.db)
    repo.save({ sourceText: 'a', topic: '', pageCount: 4, textPick: '', imagePick: '', storyboardJson: null, pagesJson: '[]', sessionId: 's1' })
    repo.save({ sourceText: 'b', topic: 't2', pageCount: 6, textPick: 'x', imagePick: 'y', storyboardJson: '{}', pagesJson: '[{"page":{}}]', sessionId: 's2' })
    const got = repo.get()
    expect(got!.sourceText).toBe('b')
    expect(got!.topic).toBe('t2')
    expect(got!.pageCount).toBe(6)
    expect(got!.sessionId).toBe('s2')
    storage.close()
  })

  it('clear removes the session', async () => {
    const storage = await openTemporaryStorage()
    const repo = new GraphicSessionRepository(storage.db)
    repo.save({ sourceText: 'x', topic: '', pageCount: 4, textPick: '', imagePick: '', storyboardJson: null, pagesJson: '[]', sessionId: '' })
    expect(repo.get()).not.toBeNull()
    repo.clear()
    expect(repo.get()).toBeNull()
    storage.close()
  })
})
