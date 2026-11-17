import type { TemplateRepository } from '../../storage/templateRepository'
import type { PublishPlatform, PublishStatus } from '../../storage/publishRepository'
import type { ExportFormat } from '../../storage/exportService'
import { error, json, type ApiDeps, type RegisterRoute } from './shared'

/** Templates, inspirations, storyboard, publish queue, and export. */
export function registerContentRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { templates, inspirations, publish, exports, creations, settings, llm } = deps

  register('/api/paipiange.templates', ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as {
          category?: string
          name?: string
          description?: string
          promptTemplate?: string
          fields?: unknown[]
        } | null
        if (!body || !body.name || !body.promptTemplate) return error('缺少 name 或 promptTemplate')
        try {
          const record = templates.create({ category: body.category ?? '通用', name: body.name, description: body.description, promptTemplate: body.promptTemplate, fields: body.fields })
          return json({ template: record }, 201)
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : '创建模板失败')
        }
      }
      const category = new URL(request.url).searchParams.get('category') ?? undefined
      return json({ templates: templates.list({ category }) })
  })

  register('/api/paipiange.templates.export', ['GET'], async (request) => {
      const url = new URL(request.url)
      const idsParam = url.searchParams.get('ids')
      const ids = idsParam ? idsParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined
      const all = templates.list({})
      const selected = ids && ids.length ? all.filter((t) => ids.includes(t.id)) : all
      const payload = {
        kind: 'paipiange-templates',
        version: 1,
        exportedAt: new Date().toISOString(),
        templates: selected.map((t) => ({
          category: t.category,
          name: t.name,
          description: t.description,
          promptTemplate: t.promptTemplate,
          fields: t.fields,
        })),
      }
      return json(payload)
  })

  register('/api/paipiange.templates.import', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { templates?: Array<{ category?: string; name?: string; description?: string; promptTemplate?: string; fields?: unknown[] }> } | null
      if (!body || !Array.isArray(body.templates) || !body.templates.length) return error('缺少 templates 数组')
      const imported: Array<ReturnType<TemplateRepository['create']>> = []
      for (const item of body.templates) {
        if (!item?.name || !item?.promptTemplate) continue
        try {
          imported.push(templates.create({
            category: item.category ?? '通用',
            name: item.name,
            description: item.description,
            promptTemplate: item.promptTemplate,
            fields: item.fields ?? [],
          }))
        } catch {
          // skip malformed entries
        }
      }
      return json({ imported: imported.length }, 201)
  })

  register('/api/paipiange.inspirations', ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as {
          title?: string
          description?: string
          promptTemplate?: string
          category?: string
          tags?: string[]
        } | null
        if (!body || !body.title) return error('缺少 title')
        try {
          const record = inspirations.create({ title: body.title, description: body.description ?? '', promptTemplate: body.promptTemplate ?? '', category: body.category ?? '通用', tags: body.tags })
          return json({ inspiration: record }, 201)
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : '创建灵感失败')
        }
      }
      const category = new URL(request.url).searchParams.get('category') ?? undefined
      return json({ inspirations: inspirations.list({ category }) })
  })

  register('/api/paipiange.inspiration.suggest', ['POST'], async (request) => {
      if (!llm || typeof llm.prepareCall !== 'function') return error('Harness 文本模型服务未就绪', 503)
      const body = await request.json().catch(() => null) as { topics?: string[]; count?: number } | null
      if (!body) return error('请求体无效')
      const topics = Array.isArray(body.topics) ? body.topics.filter((t): t is string => typeof t === 'string').slice(0, 20) : []
      const count = Math.min(Math.max(body.count ?? 3, 1), 6)
      const { suggestInspirations } = await import('../../textgen/inspirationSuggest')
      try {
        const defaults = settings.getTextGenConfig()
        const suggestions = await suggestInspirations(llm, { topics, count, provider: defaults.provider, model: defaults.model })
        const saved = suggestions.map((s) => inspirations.create({ title: s.title, description: s.description, promptTemplate: s.promptTemplate, category: s.category ?? 'AI 推荐', tags: s.tags }))
        return json({ inspirations: saved }, 201)
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 502)
      }
  })

  register('/api/paipiange.storyboard', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        sourceText?: string
        extractedImageText?: string
        topic?: string
        pageCount?: number
        platform?: string
        provider?: string
        model?: string
        baseUrl?: string
        apiKey?: string
        backendId?: string
      } | null
      if (!body) return error('请求体无效')
      const pageCount = Math.min(Math.max(Math.floor(body.pageCount ?? 4), 1), 12)
      const input = {
        sourceText: body.sourceText ?? '',
        extractedImageText: body.extractedImageText ?? '',
        topic: body.topic ?? '',
        pageCount,
        platform: body.platform ?? '公众号',
      }
      const { generateStoryboard, parseStoryboard, storyboardPrompts } = await import('../../textgen/storyboardService')
      const { generateTextWithPromptDirect } = await import('../../textgen/textGenService')

      // Resolve backend config (secrets) when a saved text backend is referenced.
      let directBaseUrl = body.baseUrl?.trim().replace(/\/+$/, '') || ''
      let directApiKey = body.apiKey?.trim() ?? ''
      let directModel = body.model?.trim() ?? ''
      if (body.backendId) {
        const backend = settings.listBackendsWithSecrets().find((b) => b.id === body.backendId)
        if (backend?.kind === 'llm-text' && backend.text) {
          directBaseUrl = backend.text.baseUrl?.trim().replace(/\/+$/, '') || ''
          directApiKey = backend.text.apiKey ?? ''
          if (!directModel) directModel = backend.text.model
        }
      }

      try {
        if (directBaseUrl) {
          if (!directModel) return error('直连文字后端缺少模型名')
          const { system, user } = storyboardPrompts(input)
          const result = await generateTextWithPromptDirect(
            { baseUrl: directBaseUrl, apiKey: directApiKey, model: directModel },
            { system, user },
          )
          const parsed = parseStoryboard(result.text)
          if (!parsed) return error('模型未返回有效的分镜 JSON，请重试或更换文字模型', 502)
          return json({ storyboard: parsed })
        }

        if (!llm || typeof llm.prepareCall !== 'function') return error('Harness 文本模型服务未就绪', 503)
        const defaults = settings.getTextGenConfig()
        const provider = body.provider?.trim() || defaults.provider
        const model = directModel || defaults.model
        if (!provider) return error('尚未配置任何可用的文本模型 Provider')
        const storyboard = await generateStoryboard(llm, { ...input, provider, model })
        return json({ storyboard })
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 502)
      }
  })

  register('/api/paipiange.inspiration.aihot', ['GET'], async (request) => {
      const params = new URL(request.url).searchParams
      const { fetchAihotItems } = await import('../../textgen/aihot')
      const mode = params.get('mode') === 'all' ? 'all' : 'selected'
      const category = params.get('category')?.trim() || undefined
      const window = params.get('window')?.trim() || '24h'
      const limitRaw = Number(params.get('limit') ?? '')
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 50) : 20
      try {
        const items = await fetchAihotItems({ mode, category, window, limit })
        return json({ items })
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : '拉取 aihot 失败', 502)
      }
  })

  register('/api/paipiange.publish', ['GET', 'POST'], async (request) => {
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as { creationId?: string; platform?: string; status?: string } | null
        if (!body || !body.creationId || !body.platform) return error('缺少 creationId 或 platform')
        if (!['wechat', 'xiaohongshu', 'zhihu', 'toutiao', 'other'].includes(body.platform)) return error('不支持的发布平台')
        try {
          const record = publish.create({ creationId: body.creationId, platform: body.platform as PublishPlatform, status: body.status === 'ready' || body.status === 'exported' || body.status === 'published' ? body.status as PublishStatus : 'draft' })
          return json({ item: record }, 201)
        } catch (cause) {
          return error(cause instanceof Error ? cause.message : '创建发布项失败')
        }
      }
      const status = new URL(request.url).searchParams.get('status')
      return json({ items: publish.list({ status: status === 'draft' || status === 'ready' || status === 'exported' || status === 'published' ? status as PublishStatus : undefined }) })
  })

  register('/api/paipiange.publish.status', ['PATCH'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { status?: string; externalUrl?: string } | null
      if (!body || !body.status) return error('缺少 status')
      if (!['draft', 'ready', 'exported', 'published'].includes(body.status)) return error('无效状态')
      const updated = publish.update(id, {
        status: body.status as PublishStatus,
        ...(body.externalUrl !== undefined ? { externalUrl: body.externalUrl } : {}),
      })
      return updated ? json({ item: updated }) : error('发布项不存在', 404)
  })

  register('/api/paipiange.export', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { creationId?: string; format?: string; platform?: string } | null
      if (!body || !body.creationId) return error('缺少 creationId')
      const format = body.format ?? 'markdown'
      if (!['markdown', 'html', 'zip', 'text'].includes(format)) return error('不支持的导出格式')
      const creation = creations.getById(body.creationId)
      if (!creation) return error('创作记录不存在', 404)
      const { readFileSync } = await import('node:fs')

      // Platform-adapted plain-text export.
      if (format === 'text') {
        const platform = ['wechat', 'xiaohongshu', 'zhihu', 'toutiao', 'other'].includes(body.platform ?? '') ? body.platform as 'wechat' | 'xiaohongshu' | 'zhihu' | 'toutiao' | 'other' : 'other'
        const result = exports.exportForPlatform(
          {
            title: creation.title,
            bodyMd: creation.bodyMd,
            bodyHtml: creation.bodyHtml,
            topic: creation.summary,
            tags: Array.isArray(creation.params.tags) ? creation.params.tags as string[] : [],
          },
          platform,
        )
        const absolute = exports.resolveAbsolute(result.relativePath)
        const buffer = readFileSync(absolute)
        return new Response(new Uint8Array(buffer), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
            'Cache-Control': 'no-store',
          },
        })
      }

      const result = exports.export(
        { title: creation.title, bodyMd: creation.bodyMd, bodyHtml: creation.bodyHtml },
        format as ExportFormat,
      )
      const absolute = exports.resolveAbsolute(result.relativePath)
      const buffer = readFileSync(absolute)
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': format === 'markdown' ? 'text/markdown' : format === 'html' ? 'text/html' : 'application/zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
          'Cache-Control': 'no-store',
        },
      })
  })
}
