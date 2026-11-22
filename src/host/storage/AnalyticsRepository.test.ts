import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AnalyticsRepository } from './AnalyticsRepository'
import { AssetRepository } from './assetRepository'
import { CreationRepository } from './creationRepository'
import { PaipiangeDatabase } from './database'
import { PublishRepository } from './publishRepository'
import { TaskRepository } from './taskRepository'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true })
  }
})

async function openStorage() {
  const root = join(tmpdir(), `paipiange-analytics-test-${randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root, seedBuiltin: false })
}

describe('AnalyticsRepository', () => {
  it('returns a zeroed overview on an empty database', async () => {
    const storage = await openStorage()
    const analytics = new AnalyticsRepository(storage.db)
    const overview = analytics.overview()

    expect(overview.generated.total).toBe(0)
    expect(overview.generated.successRate).toBe(0)
    expect(overview.creations.total).toBe(0)
    expect(overview.assets.total).toBe(0)
    expect(overview.publish.total).toBe(0)
    expect(overview.trend7d).toHaveLength(7)
    expect(overview.trend7d.every((t) => t.count === 0)).toBe(true)
    storage.close()
  })

  it('aggregates generation tasks by kind/status and builds a 7-day trend', async () => {
    const storage = await openStorage()
    const tasks = new TaskRepository(storage.db)

    const a = tasks.start({ kind: 'text', modelId: 'm', input: {} })
    tasks.markSuccess(a.id, { text: 'ok' }, 'm')
    const b = tasks.start({ kind: 'image', modelId: 'm', input: {} })
    tasks.markFailed(b.id, 'imagegen', 'boom')

    const overview = new AnalyticsRepository(storage.db).overview()
    expect(overview.generated.total).toBe(2)
    expect(overview.generated.byKind['text']).toBe(1)
    expect(overview.generated.byKind['image']).toBe(1)
    expect(overview.generated.byStatus['success']).toBe(1)
    expect(overview.generated.byStatus['failed']).toBe(1)
    expect(overview.generated.successRate).toBe(0.5)
    expect(overview.trend7d.at(-1)?.count).toBe(2)
    storage.close()
  })

  it('aggregates creations, assets and publish totals with status breakdowns', async () => {
    const storage = await openStorage()
    const creations = new CreationRepository(storage.db)
    const assets = new AssetRepository(storage.db, storage.paths)
    const publish = new PublishRepository(storage.db)

    const creation = creations.create({ type: 'article', title: '标题', bodyMd: '正文', status: 'draft' })
    assets.save({ kind: 'image', name: 'a.png', mimeType: 'image/png', data: Buffer.from('x') })
    publish.create({ creationId: creation.id, platform: 'wechat', status: 'ready' })

    const overview = new AnalyticsRepository(storage.db).overview()
    expect(overview.creations.total).toBe(1)
    expect(overview.creations.byStatus['draft']).toBe(1)
    expect(overview.creations.byType['article']).toBe(1)
    expect(overview.assets.total).toBe(1)
    expect(overview.assets.byKind['image']).toBe(1)
    expect(overview.publish.total).toBe(1)
    expect(overview.publish.byStatus['ready']).toBe(1)
    storage.close()
  })

  it('builds template attribution from image task input', async () => {
    const storage = await openStorage()
    const tasks = new TaskRepository(storage.db)

    const a = tasks.start({ kind: 'image', modelId: 'm', input: { templateName: '国风插画', templateCategory: '插画', source: 'template' } })
    tasks.markSuccess(a.id, {}, 'm')
    const b = tasks.start({ kind: 'image', modelId: 'm', input: { templateName: '国风插画', templateCategory: '插画', source: 'template' } })
    tasks.markFailed(b.id, 'imagegen', 'boom')
    // 非模板来源的图片任务不应进入归因。
    const c = tasks.start({ kind: 'image', modelId: 'm', input: { prompt: 'hello' } })
    tasks.markSuccess(c.id, {}, 'm')

    const insights = new AnalyticsRepository(storage.db).insights()
    expect(insights.templateAttribution).toHaveLength(1)
    expect(insights.templateAttribution[0].name).toBe('国风插画')
    expect(insights.templateAttribution[0].used).toBe(2)
    expect(insights.templateAttribution[0].succeeded).toBe(1)
    expect(insights.templateAttribution[0].successRate).toBe(0.5)
    storage.close()
  })

  it('returns null recommended hour when nothing is published', async () => {
    const storage = await openStorage()
    const insights = new AnalyticsRepository(storage.db).insights()
    expect(insights.recommendedHour).toBeNull()
    expect(insights.generationByHour).toHaveLength(24)
    expect(insights.publishByHour).toHaveLength(24)
    storage.close()
  })
})
