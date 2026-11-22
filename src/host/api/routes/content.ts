import type { TemplateRepository } from '../../storage/templateRepository'
import type { PublishPlatform, PublishStatus } from '../../storage/publishRepository'
import type { ExportFormat } from '../../storage/exportService'
import { providerRouteOf } from '../../textgen/types'
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
      const { suggestInspirations, suggestInspirationsDirect } = await import('../../textgen/inspirationSuggest')
      try {
        // 选题推荐优先复用用户已配置的「文字后端」（llm-text 且带 baseUrl）走 OpenAI 兼容直连，
        // 彻底绕开 Harness llm 服务的 provider/model 装配（历史默认 deepseek-official 无 adapter/凭证时，
        // dsh 内部会抛 `Cannot read properties of undefined (reading 'provider')`）。只有没有直连后端时，
        // 才回退到 Harness llm 服务。
        const textBackends = settings
          .listBackendsWithSecrets()
          .filter((b) => b.kind === 'llm-text' && b.text?.baseUrl?.trim())
        for (const backend of textBackends) {
          const baseUrl = backend.text!.baseUrl!.trim()
          const model = backend.text!.model?.trim()
          if (!model) continue
          try {
            const suggestions = await suggestInspirationsDirect(
              { baseUrl, apiKey: backend.text!.apiKey ?? '', model },
              { topics, count },
            )
            const saved = suggestions.map((s) => inspirations.create({ title: s.title, description: s.description, promptTemplate: s.promptTemplate, category: s.category ?? 'AI 推荐', tags: s.tags }))
            return json({ inspirations: saved }, 201)
          } catch {
            // 该后端调用失败，尝试下一个。
          }
        }

        // 回退：Harness llm 服务。仅当服务存在时尝试；不再调用 listProviders/listModels
        // 做「探测」，因为 dsh 的 pi-ai adapter 在无凭证/无匹配 provider 时会在
        // `model.provider` 等处抛 `Cannot read properties of undefined (reading 'provider')`，
        // 直接吞掉用户看到的是一堆内部报错。清空后端后这里应返回友好提示，引导用户去添加文字后端。
        if (!llm || typeof llm.prepareCall !== 'function') {
          return error('未配置任何可用的文本模型（请先在「后端管理」添加文字后端，或在 Harness 配置模型）', 503)
        }
        return error('未配置可用的文字后端，请先在「设置中心 → 后端管理」添加一个文字模型后再推荐选题', 503)
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

        if (!llm || typeof llm.prepareCall !== 'function') return error('未配置可用的文字后端，请先在「设置中心 → 后端管理」添加一个文字模型后再拆页', 503)
        const defaults = settings.getTextGenConfig()
        let provider = body.provider?.trim() || defaults.provider
        const model = directModel || defaults.model
        if (typeof llm.listProviders === 'function') {
          const available = llm.listProviders().map((item) => providerRouteOf(item)).filter(Boolean)
          if (!available.includes(provider)) provider = available[0] ?? provider
        }
        if (!provider) return error('未配置可用的文字后端，请先在「设置中心 → 后端管理」添加一个文字模型后再拆页', 503)
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
      const current = publish.getById(id)
      if (!current) return error('发布项不存在', 404)
      const creation = creations.getById(current.creationId)
      if (creation) recordPublishVersion(publish, current.id, creation, 'manual_status')
      const attempt = publish.createAttempt({
        publishItemId: current.id,
        platform: current.platform,
        action: 'manual_status',
        retryNo: current.retryCount,
        request: { status: body.status },
      })
      const updated = publish.update(id, {
        status: body.status as PublishStatus,
        ...(body.externalUrl !== undefined ? { externalUrl: body.externalUrl } : {}),
      })
      publish.finishAttempt(attempt.id, { status: 'success', itemStatus: body.status as PublishStatus, result: { externalUrl: body.externalUrl ?? null } })
      return updated ? json({ item: updated }) : error('发布项不存在', 404)
  })

  register('/api/paipiange.publish.detail', ['GET'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const item = publish.getById(id)
      if (!item) return error('发布项不存在', 404)
      const creation = creations.getById(item.creationId)
      return json({
        item,
        attempts: publish.listAttempts(id),
        versions: publish.listVersions(id),
        checklist: buildPublishChecklist(item, creation, settings.getWechatChannelSummary().configured),
      })
  })

  register('/api/paipiange.publish.schedule', ['PATCH'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const body = await request.json().catch(() => null) as { scheduledAt?: string | null } | null
      if (!body) return error('请求体无效')
      const item = publish.getById(id)
      if (!item) return error('发布项不存在', 404)
      const scheduledAt = body.scheduledAt === null || body.scheduledAt === undefined ? null : body.scheduledAt
      if (scheduledAt !== null) {
        const parsed = Date.parse(scheduledAt)
        if (!Number.isFinite(parsed)) return error('无效的计划时间')
        if (parsed <= Date.now()) return error('计划时间必须晚于当前时间')
      }
      const updated = publish.update(id, { scheduledAt: scheduledAt === null ? null : new Date(scheduledAt).toISOString() })
      return updated ? json({ item: updated }) : error('发布项不存在', 404)
  })

  register('/api/paipiange.publish.attempts', ['GET'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id')
      const limit = Number(url.searchParams.get('limit') ?? '100') || 100
      return json({ attempts: publish.listAttempts(id, limit) })
  })

  register('/api/paipiange.publish.refresh', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { id?: string } | null
      if (!body?.id) return error('缺少 id')
      const item = publish.getById(body.id)
      if (!item) return error('发布项不存在', 404)
      const attempt = publish.createAttempt({ publishItemId: item.id, platform: item.platform, action: 'status_refresh', retryNo: item.retryCount })
      try {
        let result: Record<string, unknown> = { localStatus: item.status }
        if (item.platform === 'wechat' && item.externalId) result = { ...await deps.wechat.refreshDraft(item.externalId) }
        publish.finishAttempt(attempt.id, { status: 'success', checked: true, result })
        return json({ item: publish.getById(item.id), result })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '状态刷新失败'
        publish.finishAttempt(attempt.id, { status: 'failed', errorMessage: message, checked: true })
        return error(message, 502)
      }
  })

  register('/api/paipiange.publish.retry', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { id?: string } | null
      if (!body?.id) return error('缺少 id')
      const item = publish.getById(body.id)
      if (!item) return error('发布项不存在', 404)
      if (item.platform === 'wechat' && item.externalId) {
        const attempt = publish.createAttempt({ publishItemId: item.id, platform: item.platform, action: 'status_refresh', retryNo: item.retryCount + 1 })
        try {
          const result = await deps.wechat.refreshDraft(item.externalId)
          publish.finishAttempt(attempt.id, { status: 'success', checked: true, result: { ...result } })
          return json({ item: publish.getById(item.id), attempt: publish.getAttempt(attempt.id) })
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : '重试失败'
          publish.finishAttempt(attempt.id, { status: 'failed', errorMessage: message, checked: true })
          return error(message, 502)
        }
      }
      if (item.platform === 'wechat') {
        return error('为保护隐私，系统不会保存公众号上传所需的图片二进制；请回到原发布面板重新同步草稿', 409)
      }
      const creation = creations.getById(item.creationId)
      if (!creation) return error('创作记录不存在', 404)
      recordPublishVersion(publish, item.id, creation, 'retry_export')
      const attempt = publish.createAttempt({ publishItemId: item.id, platform: item.platform, action: 'export', retryNo: item.retryCount + 1 })
      try {
        const result = exports.exportForPlatform({
          title: creation.title, bodyMd: creation.bodyMd, bodyHtml: creation.bodyHtml,
          topic: creation.summary, tags: creation.tags,
        }, item.platform)
        publish.finishAttempt(attempt.id, { status: 'success', itemStatus: 'exported', exportPath: result.relativePath, result: { fileName: result.fileName } })
        return json({ item: publish.getById(item.id), attempt: publish.getAttempt(attempt.id) })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '重试导出失败'
        publish.finishAttempt(attempt.id, { status: 'failed', errorMessage: message })
        return error(message, 500)
      }
  })

  register('/api/paipiange.export', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { creationId?: string; format?: string; platform?: string; publishItemId?: string } | null
      if (!body || !body.creationId) return error('缺少 creationId')
      const format = body.format ?? 'markdown'
      if (!['markdown', 'html', 'zip', 'text'].includes(format)) return error('不支持的导出格式')
      const creation = creations.getById(body.creationId)
      if (!creation) return error('创作记录不存在', 404)
      const { readFileSync } = await import('node:fs')
      const publishItem = body.publishItemId ? publish.getById(body.publishItemId) : null
      if (body.publishItemId && (!publishItem || publishItem.creationId !== creation.id)) return error('发布项与创作记录不匹配', 409)
      if (publishItem) recordPublishVersion(publish, publishItem.id, creation, 'export')
      const attempt = publishItem ? publish.createAttempt({
        publishItemId: publishItem.id,
        platform: publishItem.platform,
        action: format === 'zip' ? 'delivery_bundle' : 'export',
        retryNo: publishItem.retryCount,
        request: { format, platform: body.platform ?? publishItem.platform },
      }) : null

      try {
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
        if (attempt) publish.finishAttempt(attempt.id, { status: 'success', itemStatus: 'exported', exportPath: result.relativePath, result: { fileName: result.fileName } })
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
        if (attempt) publish.finishAttempt(attempt.id, { status: 'success', itemStatus: 'exported', exportPath: result.relativePath, result: { fileName: result.fileName } })
        const absolute = exports.resolveAbsolute(result.relativePath)
        const buffer = readFileSync(absolute)
        return new Response(new Uint8Array(buffer), {
          headers: {
            'Content-Type': format === 'markdown' ? 'text/markdown' : format === 'html' ? 'text/html' : 'application/zip',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
            'Cache-Control': 'no-store',
          },
        })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '导出失败'
        if (attempt) publish.finishAttempt(attempt.id, { status: 'failed', errorMessage: message })
        return error(message, 500)
      }
  })
}

function recordPublishVersion(
  publish: ApiDeps['publish'],
  publishItemId: string,
  creation: NonNullable<ReturnType<ApiDeps['creations']['getById']>>,
  action: string,
) {
  return publish.recordVersion(publishItemId, {
    title: creation.title,
    bodyMd: creation.bodyMd,
    bodyHtml: creation.bodyHtml,
    snapshot: { action, summary: creation.summary, tags: creation.tags, updatedAt: creation.updatedAt },
  })
}

function buildPublishChecklist(
  item: ReturnType<ApiDeps['publish']['getById']> extends infer T ? NonNullable<T> : never,
  creation: ReturnType<ApiDeps['creations']['getById']>,
  wechatConfigured: boolean,
) {
  if (!creation) return [{ key: 'creation', label: '创作记录仍然存在', passed: false, message: '原始创作已删除' }]
  const content = creation.bodyMd.trim() || creation.summary.trim()
  const checks = [
    { key: 'title', label: '标题已填写', passed: Boolean(creation.title.trim()), message: creation.title.trim() ? '' : '请补充标题' },
    { key: 'content', label: '正文已填写', passed: Boolean(content), message: content ? '' : '请补充正文或主题' },
    { key: 'platform', label: '发布平台已选择', passed: item.platform !== 'other', message: item.platform === 'other' ? '建议选择明确平台' : '' },
  ]
  if (item.platform === 'wechat') {
    checks.push(
      { key: 'wechat-title', label: '公众号标题不超过 64 字', passed: creation.title.trim().length <= 64, message: creation.title.trim().length <= 64 ? '' : '请缩短标题' },
      { key: 'cover', label: '公众号封面已设置', passed: Boolean(creation.coverAssetId), message: creation.coverAssetId ? '' : '请先设置封面' },
      { key: 'channel', label: '公众号凭据已配置', passed: wechatConfigured, message: wechatConfigured ? '' : '请在设置中心配置公众号' },
    )
  }
  if (item.platform === 'xiaohongshu') {
    checks.push({ key: 'xiaohongshu-title', label: '小红书标题建议不超过 20 字', passed: creation.title.trim().length <= 20, message: creation.title.trim().length <= 20 ? '' : '建议缩短标题' })
  }
  return checks
}
