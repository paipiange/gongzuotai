import type { ProviderId } from '../../imagegen/ImageGenService'
import type { ImageGenRequest } from '../../imagegen/types'
import { error, json, type ApiDeps, type RegisterRoute } from './shared'

/** Image-gen config/generate, text-gen config, generation tasks, analytics, and backend management. */
export function registerGenerationRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { settings, tasks, buildImageGen, analytics, llm } = deps

  register('/api/paipiange.imagegen', ['GET', 'PUT'], async (request) => {
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null) as {
          llm?: { baseUrl: string; apiKey: string; model: string }
          comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
        } | null
        if (!body) return error('请求体无效')
        if (body.llm) {
          if (!body.llm.baseUrl || !body.llm.apiKey || !body.llm.model) return error('LLM 配置不完整')
          settings.setLlmImageConfig(body.llm)
        }
        if (body.comfyui) {
          if (!body.comfyui.server) return error('ComfyUI 配置不完整')
          settings.setComfyUiConfig(body.comfyui)
        }
        return json({ summary: settings.getImageGenSummary() })
      }
      return json({ summary: settings.getImageGenSummary() })
  })

  register('/api/paipiange.textgen.config', ['GET', 'PUT'], async (request) => {
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => null) as { provider?: string; model?: string } | null
        if (!body) return error('请求体无效')
        if (!body.provider?.trim() || !body.model?.trim()) return error('缺少 provider 或 model')
        settings.setTextGenConfig({ provider: body.provider.trim(), model: body.model.trim() })
        return json({ config: settings.getTextGenConfig() })
      }
      return json({ config: settings.getTextGenConfig() })
  })

  register('/api/paipiange.imagegen.generate', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        provider?: ProviderId
        backendId?: string
        request?: ImageGenRequest
        sourceCreationId?: string
        /** 公众号分镜：第几页（用于后台任务恢复时回填到对应页）。 */
        pageIndex?: number
        /** 公众号分镜：本次拆页的 run id（用于匹配进行中/已完成的生图任务）。 */
        sessionId?: string
      } | null
      if (!body || !body.request?.prompt) return error('缺少 prompt')
      const imageGen = buildImageGen()
      const task = tasks.start({
        kind: 'image',
        creationId: body.sourceCreationId ?? null,
        modelId: body.backendId ?? body.provider ?? null,
        input: {
          prompt: body.request.prompt,
          negativePrompt: body.request.negativePrompt,
          count: body.request.count,
          size: body.request.size,
          width: body.request.width,
          height: body.request.height,
          seed: body.request.seed,
          steps: body.request.steps,
          cfg: body.request.cfg,
          model: body.request.model,
          hasReferenceImage: !!(body.request.image || body.request.images?.length),
          referenceImageCount: body.request.images?.length ?? (body.request.image ? 1 : 0),
          denoise: body.request.denoise,
          backendId: body.backendId,
          provider: body.provider,
          sourceCreationId: body.sourceCreationId,
          pageIndex: body.pageIndex ?? null,
          sessionId: body.sessionId ?? null,
        },
      })
      try {
        const images = body.backendId
          ? await imageGen.generateByBackend(body.backendId, body.request)
          : await imageGen.generate(body.provider ?? 'llm', body.request)
        const saved = images.map((image) => {
          const asset = deps.assets.save({
            kind: 'image',
            name: `generated-${body.backendId ?? body.provider ?? 'image'}.png`,
            mimeType: image.mimeType,
            data: image.data,
            sourceCreationId: body.sourceCreationId ?? null,
          })
          return { id: asset.id, mimeType: asset.mimeType, relativePath: asset.relativePath, sizeBytes: asset.sizeBytes }
        })
        tasks.markSuccess(task.id, {
          count: saved.length,
          images: saved.map((s) => ({ id: s.id, mimeType: s.mimeType, sizeBytes: s.sizeBytes })),
        }, body.backendId ?? body.provider ?? null)
        return json({ images: saved }, 201)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        try {
          tasks.markFailed(task.id, 'imagegen', message)
        } catch {
          // recording must not mask the real error
        }
        return error(`生成失败: ${message}`, 502)
      }
  })

  register('/api/paipiange.tasks', ['GET'], async (request) => {
      const url = new URL(request.url)
      const kind = url.searchParams.get('kind')
      const status = url.searchParams.get('status')
      const query = url.searchParams.get('query') ?? undefined
      const limit = Number(url.searchParams.get('limit') ?? '100') || 100
      const offset = Number(url.searchParams.get('offset') ?? '0') || 0
      const rows = tasks.list(
        kind === 'text' || kind === 'image' || kind === 'video' ? kind : undefined,
        status === 'running' || status === 'success' || status === 'failed' ? status : undefined,
        limit,
        offset,
        query,
      )
      return json({ tasks: rows })
  })

  register('/api/paipiange.task', ['GET'], async (request) => {
      const id = new URL(request.url).searchParams.get('id') ?? ''
      if (!id) return error('缺少 id')
      const task = tasks.getById(id)
      if (!task) return error('任务不存在', 404)
      return json({ task })
  })

  register('/api/paipiange.analytics', ['GET'], async () => {
      return json({ overview: analytics.overview() })
  })

  register('/api/paipiange.backends', ['GET'], async () => {
      return json({ backends: settings.listBackends() })
  })

  register('/api/paipiange.backend', ['POST', 'PATCH', 'DELETE'], async (request) => {
      const url = new URL(request.url)
      const id = url.searchParams.get('id') ?? ''
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null) as {
          name?: string
          kind?: 'llm-text' | 'llm-image' | 'comfyui'
          llm?: { baseUrl: string; apiKey: string; model: string; models?: string[] }
          text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
          comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
        } | null
        if (!body || !body.name?.trim() || !body.kind) return error('缺少 name 或 kind')
        if (body.kind === 'comfyui') {
          if (!body.comfyui?.server) return error('ComfyUI 配置缺少 server')
        } else if (body.kind === 'llm-text') {
          if (!body.text?.model) return error('文本后端缺少 model')
          if (!body.text?.provider && !body.text?.baseUrl) return error('文本后端缺少 provider 或 baseUrl')
        } else {
          if (!body.llm?.baseUrl || !body.llm?.apiKey || !body.llm?.model) return error('LLM 配置缺少 baseUrl/apiKey/model')
        }
        const created = settings.createBackend({
          name: body.name.trim(),
          kind: body.kind,
          llm: body.llm,
          text: body.text,
          comfyui: body.comfyui,
        })
        return json({ backend: created }, 201)
      }
      if (!id) return error('缺少 id')
      if (request.method === 'DELETE') {
        const ok = settings.removeBackend(id)
        return ok ? json({ ok: true }) : error('后端不存在', 404)
      }
      // PATCH
      const body = await request.json().catch(() => null) as {
        name?: string
        llm?: { baseUrl: string; apiKey: string; model: string; models?: string[] }
        text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
        comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
      } | null
      if (!body) return error('请求体无效')
      // The client never holds secrets: on edit the apiKey arrives blank. When
      // blank, preserve the host-side key instead of overwriting it with ''.
      const existing = settings.listBackendsWithSecrets().find((b) => b.id === id)
      const patch: {
        name?: string
        llm?: { baseUrl: string; apiKey: string; model: string; models?: string[] }
        text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string; models?: string[] }
        comfyui?: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string }
      } = {}
      if (body.name?.trim()) patch.name = body.name.trim()
      if (body.llm) {
        patch.llm = {
          ...body.llm,
          apiKey: body.llm.apiKey?.trim() || existing?.llm?.apiKey || '',
        }
      }
      if (body.text) {
        const mergedApiKey = body.text.apiKey?.trim() || existing?.text?.apiKey || ''
        patch.text = { ...body.text, apiKey: mergedApiKey || undefined }
      }
      if (body.comfyui) patch.comfyui = body.comfyui
      const updated = settings.updateBackend(id, patch)
      return updated ? json({ backend: updated }) : error('后端不存在', 404)
  })

  register('/api/paipiange.backend.test', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { kind?: string; llm?: { baseUrl: string; apiKey: string; model: string }; comfyui?: { server: string }; text?: { provider: string; model: string } } | null
      if (!body) return error('请求体无效')
      const { default: testBackendConnection } = await import('../../imagegen/connectionTest')
      try {
        const result = await testBackendConnection(body as never, llm)
        return json(result)
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 502)
      }
  })

  register('/api/paipiange.models.fetch', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { kind?: string; provider?: string; baseUrl?: string; apiKey?: string; backendId?: string } | null
      if (!body || (body.kind !== 'llm-text' && body.kind !== 'llm-image')) return error('缺少 kind（llm-text / llm-image）')
      const { default: fetchBackendModels } = await import('../../imagegen/fetchModels')
      try {
        // When the client is editing a saved backend it only has the blanked
        // apiKey (secrets never leave the host), so resolve the real key by id.
        let apiKey = body.apiKey?.trim() || ''
        if (!apiKey && body.backendId) {
          const backend = settings.listBackendsWithSecrets().find((b) => b.id === body.backendId)
          if (backend?.kind === 'llm-image' && backend.llm) apiKey = backend.llm.apiKey ?? ''
          else if (backend?.kind === 'llm-text' && backend.text) apiKey = backend.text.apiKey ?? ''
        }
        const result = await fetchBackendModels(
          { kind: body.kind, provider: body.provider, baseUrl: body.baseUrl, apiKey: apiKey || undefined },
          llm,
        )
        return json(result)
      } catch (cause) {
        return error(cause instanceof Error ? cause.message : String(cause), 502)
      }
  })
}
