import { describe, expect, it } from 'vitest'
import { buildPageTaskMap, extractAssetId } from './graphicRecover'
import type { TaskRecord } from '../hostClient'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    clientRequestId: null,
    kind: 'image',
    status: 'success',
    creationId: null,
    modelId: null,
    errorCode: null,
    errorMessage: null,
    input: {},
    result: {},
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-11-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildPageTaskMap', () => {
  it('只保留匹配 sessionId 的任务，忽略其它会话/无会话任务', () => {
    const sid = 's1'
    const mine = task({ id: 'a', input: { sessionId: sid, pageIndex: 0 } })
    const otherSid = task({ id: 'b', input: { sessionId: 'other', pageIndex: 0 } })
    const noSid = task({ id: 'c', input: { pageIndex: 1 } })
    const map = buildPageTaskMap([mine, otherSid, noSid], sid)
    expect(map.size).toBe(1)
    expect(map.get(0)?.id).toBe('a')
  })

  it('同一页多个任务时取 createdAt 最新的', () => {
    const sid = 's1'
    const old = task({ id: 'old', createdAt: '2026-11-16T00:00:00.000Z', input: { sessionId: sid, pageIndex: 2 } })
    const newer = task({ id: 'newer', createdAt: '2026-11-16T01:00:00.000Z', input: { sessionId: sid, pageIndex: 2 } })
    const map = buildPageTaskMap([old, newer], sid)
    expect(map.get(2)?.id).toBe('newer')
  })

  it('忽略 pageIndex 非数字或负数的任务', () => {
    const sid = 's1'
    const str = task({ id: 'a', input: { sessionId: sid, pageIndex: '0' } })
    const neg = task({ id: 'b', input: { sessionId: sid, pageIndex: -1 } })
    const map = buildPageTaskMap([str, neg], sid)
    expect(map.size).toBe(0)
  })
})

describe('extractAssetId', () => {
  it('从 result.images 取第一张图的 id', () => {
    const t = task({ result: { images: [{ id: 'asset-1' }, { id: 'asset-2' }] } })
    expect(extractAssetId(t)).toBe('asset-1')
  })

  it('images 非数组或缺 id 时返回 undefined', () => {
    expect(extractAssetId(task({ result: {} }))).toBeUndefined()
    expect(extractAssetId(task({ result: { images: 'nope' } }))).toBeUndefined()
    expect(extractAssetId(task({ result: { images: [{ noId: true }] } }))).toBeUndefined()
  })
})
