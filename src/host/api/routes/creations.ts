import type { CreateCreationInput } from '../../storage/creationRepository'
import { error, json, normalizeTags, studioToType, toClientCreation, type ApiDeps, type ClientDraft, type RegisterRoute } from './shared'

/** Creation records: list/create/get/update/delete, status, cover, purge, batch. */
export function registerCreationRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { creations, publish, assets } = deps

  register('/api/paipiange.creations', ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as ClientDraft | null
        if (!body || !body.studio) return error('缺少 studio 字段')
        let type: CreateCreationInput['type']
        try {
          type = studioToType(body.studio)
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : '不支持的创作类型')
        }
        const input: CreateCreationInput = {
          type,
          title: body.title,
          summary: body.topic,
          bodyMd: body.content,
          params: { style: body.style ?? 'cinematic', requirement: body.requirement ?? '' },
          status: body.status === 'queued' || body.status === 'archived' ? body.status : 'draft',
          tags: normalizeTags(body.tags),
        }
        const record = creations.create(input)
        if (record.status === 'queued') publish.ensureForCreation(record.id)
        return json({ creation: toClientCreation(record) }, 201)
      }

      const url = new URL(request.url)
      const status = url.searchParams.get('status') ?? undefined
      const query = url.searchParams.get('query') ?? undefined
      const tagsParam = url.searchParams.get('tags') ?? undefined
      const limit = Number(url.searchParams.get('limit') ?? '50') || 50
      const offset = Number(url.searchParams.get('offset') ?? '0') || 0
      const records = creations.list({
        status: status === 'draft' || status === 'queued' || status === 'archived' ? status : undefined,
        query,
        tags: tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        limit,
        offset,
      })
      return json({ creations: records.map(toClientCreation) })
  })

  register('/api/paipiange.creation', ['GET', 'PATCH', 'DELETE'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const record = creations.getById(id)
      if (!record) return error('创作记录不存在', 404)

      if (request.method === 'GET') return json({ creation: toClientCreation(record) })

      if (request.method === 'DELETE') {
        const ok = creations.softDelete(id)
        return ok ? json({ ok: true }) : error('删除失败', 404)
      }
      const body = await request.json().catch(() => null) as ClientDraft | null
      if (!body) return error('请求体无效')
      const updated = creations.update(id, {
        title: body.title,
        summary: body.topic,
        bodyMd: body.content,
        status: body.status === 'queued' || body.status === 'archived' || body.status === 'draft' ? body.status : undefined,
        params: body.style !== undefined || body.requirement !== undefined
          ? { style: body.style, requirement: body.requirement }
          : undefined,
        tags: normalizeTags(body.tags),
      })
      if (updated && updated.status === 'queued') publish.ensureForCreation(updated.id)
      return updated ? json({ creation: toClientCreation(updated) }) : error('更新失败', 404)
  })

  register('/api/paipiange.creation.status', ['PATCH'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { status?: 'draft' | 'queued' | 'archived' } | null
      if (!body || !body.status) return error('缺少 status 字段')
      const updated = creations.update(id, { status: body.status })
      if (updated && updated.status === 'queued') publish.ensureForCreation(updated.id)
      return updated ? json({ creation: toClientCreation(updated) }) : error('记录不存在', 404)
  })

  register('/api/paipiange.creation.cover', ['PATCH'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { assetId?: string | null } | null
      if (!body || body.assetId === undefined) return error('缺少 assetId 字段')
      // Setting a cover references an existing asset; clearing (null) is always allowed.
      if (body.assetId !== null && !assets.getById(body.assetId)) return error('素材不存在', 404)
      const updated = creations.update(id, { coverAssetId: body.assetId })
      return updated ? json({ creation: toClientCreation(updated) }) : error('记录不存在', 404)
  })

  register('/api/paipiange.creation.purge', ['DELETE'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const ok = creations.remove(id)
      return ok ? json({ ok: true }) : error('记录不存在', 404)
  })

  register('/api/paipiange.creations.batch', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { ids?: string[]; action?: string; status?: string } | null
      if (!body || !Array.isArray(body.ids) || !body.ids.length) return error('缺少 ids')
      if (body.ids.length > 100) return error('单次批量最多 100 条')
      const action = body.action ?? ''
      const ids = body.ids.filter((id): id is string => typeof id === 'string')
      const done: string[] = []
      for (const id of ids) {
        if (action === 'archive') {
          if (creations.update(id, { status: 'archived' })) done.push(id)
        } else if (action === 'restore') {
          if (creations.getById(id, true)?.deletedAt) {
            if (creations.restore(id)) done.push(id)
          } else if (creations.update(id, { status: 'draft' })) {
            done.push(id)
          }
        } else if (action === 'delete') {
          if (creations.remove(id)) done.push(id)
        } else if (action === 'status') {
          if (body.status === 'draft' || body.status === 'queued' || body.status === 'archived') {
            const updated = creations.update(id, { status: body.status })
            if (updated && body.status === 'queued') publish.ensureForCreation(updated.id)
            if (updated) done.push(id)
          }
        }
      }
      return json({ done, total: ids.length })
  })
}
