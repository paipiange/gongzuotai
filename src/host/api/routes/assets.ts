import { error, json, normalizeTags, type ApiDeps, type RegisterRoute } from './shared'

/** Asset metadata/binary retrieval, upload, delete, tags, storage cleanup. */
export function registerAssetRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { assets } = deps

  register('/api/paipiange.asset', ['GET'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const asset = assets.getById(id)
      if (!asset) return error('素材不存在', 404)
      const { readFileSync } = await import('node:fs')
      const buffer = readFileSync(assets.resolveAbsolutePath(asset))
      return new Response(new Uint8Array(buffer), {
        headers: { 'Content-Type': asset.mimeType, 'Cache-Control': 'no-store' },
      })
  })

  // NOTE: distinct path — dsh's webserver treats the exact route string as a
  // unique key and does not distinguish by HTTP method.
  register('/api/paipiange.asset.delete', ['POST'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const ok = assets.softDelete(id)
      return ok ? json({ ok: true }) : error('素材不存在', 404)
  })

  register('/api/paipiange.asset.restore', ['POST'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const ok = assets.restore(id)
      return ok ? json({ ok: true }) : error('回收站中不存在该素材', 404)
  })

  register('/api/paipiange.asset.tags', ['PATCH'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { tags?: unknown } | null
      if (!body || !Array.isArray(body.tags)) return error('缺少 tags 字段')
      const ok = assets.updateTags(id, normalizeTags(body.tags) ?? [])
      return ok ? json({ ok: true }) : error('素材不存在', 404)
  })

  register('/api/paipiange.assets.batchdelete', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { ids?: string[] } | null
      if (!body || !Array.isArray(body.ids) || !body.ids.length) return error('缺少 ids')
      if (body.ids.length > 100) return error('单次批量最多 100 条')
      let done = 0
      for (const id of body.ids) {
        if (typeof id === 'string' && assets.softDelete(id)) done += 1
      }
      return json({ done, total: body.ids.length })
  })

  register('/api/paipiange.assets.batchrestore', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { ids?: string[] } | null
      if (!body || !Array.isArray(body.ids) || !body.ids.length) return error('缺少 ids')
      if (body.ids.length > 100) return error('单次批量最多 100 条')
      let done = 0
      for (const id of body.ids) {
        if (typeof id === 'string' && assets.restore(id)) done += 1
      }
      return json({ done, total: body.ids.length })
  })

  register('/api/paipiange.asset.purge', ['POST'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const ok = assets.hardDelete(id)
      return ok ? json({ ok: true }) : error('素材不存在', 404)
  })

  register('/api/paipiange.assets.storage', ['GET'], async () => {
      const deleted = assets.countDeleted()
      const orphans = assets.listOrphans()
      const usage = assets.getStorageUsage()
      const duplicates = assets.findDuplicateStats()
      return json({
        ...usage,
        deletedCount: deleted.count,
        deletedBytes: deleted.freedBytes,
        orphanCount: orphans.ids.length,
        orphanBytes: orphans.freedBytes,
        duplicateGroupCount: duplicates.groupCount,
        duplicateCount: duplicates.duplicateCount,
        duplicateBytes: duplicates.duplicateBytes,
      })
  })

  register('/api/paipiange.assets.trash', ['GET'], async (request) => {
      const limit = Number(new URL(request.url).searchParams.get('limit') ?? '100') || 100
      return json({ assets: assets.listDeleted(limit).map(projectAsset) })
  })

  register('/api/paipiange.assets.emptytrash', ['POST'], async () => {
      const result = assets.purgeDeleted()
      return json({ ok: true, count: result.count, freedBytes: result.freedBytes })
  })

  register('/api/paipiange.assets.purgeorphans', ['POST'], async () => {
      const orphans = assets.listOrphans()
      let count = 0
      for (const id of orphans.ids) {
        if (assets.hardDelete(id)) count += 1
      }
      return json({ ok: true, count, freedBytes: orphans.freedBytes })
  })

  register('/api/paipiange.assets', ['GET'], async (request) => {
      const url = new URL(request.url)
      const kind = url.searchParams.get('kind')
      const creationId = url.searchParams.get('creationId')
      const tagsParam = url.searchParams.get('tags')
      const query = url.searchParams.get('query') ?? undefined
      const limit = Number(url.searchParams.get('limit') ?? '100') || 100
      const offset = Number(url.searchParams.get('offset') ?? '0') || 0
      const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined
      const rows = creationId
        ? assets.listByCreation(creationId)
        : assets.list(kind === 'image' || kind === 'file' || kind === 'prompt' || kind === 'document' ? kind : undefined, limit, offset, tags, query)
      return json({
        assets: rows.map(projectAsset),
      })
  })

  register('/api/paipiange.asset.upload', ['POST'], async (request) => {
      const sourceCreationId = new URL(request.url).searchParams.get('creationId') ?? undefined
      const mimeType = request.headers.get('Content-Type') ?? 'application/octet-stream'
      const kind: 'image' | 'file' = mimeType.startsWith('image/') ? 'image' : 'file'
      const name = request.headers.get('X-File-Name') ?? `upload-${Date.now()}`
      const buffer = Buffer.from(await request.arrayBuffer())
      if (buffer.byteLength === 0) return error('上传内容为空')
      const record = assets.save({ kind, name, mimeType, data: buffer, sourceCreationId: sourceCreationId ?? null })
      return json({ asset: { id: record.id, kind: record.kind, name: record.name, mimeType: record.mimeType, sizeBytes: record.sizeBytes } }, 201)
  })
}

function projectAsset(a: ReturnType<ApiDeps['assets']['getById']> extends infer T ? NonNullable<T> : never) {
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    tags: a.tags,
    sourceCreationId: a.sourceCreationId,
    createdAt: a.createdAt,
    deletedAt: a.deletedAt,
  }
}
