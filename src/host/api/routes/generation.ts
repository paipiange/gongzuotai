import type { ProviderId } from '../../imagegen/ImageGenService'
import type { ImageGenRequest } from '../../imagegen/types'
import type { TextGenRequest } from '../../textgen/textGenService'
import type { ImageQueuePayload, QueuedImageRequest, TextQueuePayload, VideoQueuePayload } from '../../queue/generationHandlers'
import { normalizeTaskOrigin } from '../../taskOrigin'
import { error, json, type ApiDeps, type RegisterRoute } from './shared'

/** 解析 data URL 为 { buffer, mimeType, ext }；非法返回 null。 */
function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; ext: string } | null {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/.exec(dataUrl)
  if (!match) return null
  try {
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length === 0) return null
    const ext = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1]
    return { buffer, mimeType: match[1], ext }
  } catch {
    return null
  }
}

function normalizeElapsedMs(value: unknown): number {
  const elapsed = Number(value)
  if (!Number.isFinite(elapsed)) return 0
  return Math.max(0, Math.min(Math.round(elapsed), 24 * 60 * 60 * 1000))
}

function imageResultFromAsset(asset: ReturnType<ApiDeps['assets']['getById']>) {
  if (!asset || asset.kind !== 'image') return null
  return { id: asset.id, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes }
}

/** Image-gen config/generate, text-gen config, generation tasks, analytics, and backend management. */
export function registerGenerationRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { settings, tasks, queue, buildImageGen, analytics, llm } = deps

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
        /** false 时只执行生图并保存 asset，由外层批次任务统一记录。 */
        recordTask?: boolean
        /** recordTask=false 时必须绑定一个仍在运行的图片批次任务。 */
        batchTaskId?: string
        origin?: unknown
        clientRequestId?: string
        sourceCreationId?: string
        /** 公众号分镜：第几页（用于后台任务恢复时回填到对应页）。 */
        pageIndex?: number
        /** 公众号分镜：本次拆页的 run id（用于匹配进行中/已完成的生图任务）。 */
        sessionId?: string
      } | null
      if (!body || !body.request?.prompt) return error('缺少 prompt')
      const startedAt = Date.now()
      const shouldRecordTask = body.recordTask !== false
      if (!shouldRecordTask) {
        const batchTask = body.batchTaskId ? tasks.getById(body.batchTaskId) : null
        if (!batchTask || batchTask.kind !== 'image' || batchTask.status !== 'running') {
          return error('缺少有效的图片批次任务', 409)
        }
      }
      const imageGen = buildImageGen()
      // 解析后端名 + 模型名，用于生图记录的直观展示（而非 backend id）。
      const backend = body.backendId
        ? settings.listBackends().find((b) => b.id === body.backendId)
        : undefined
      const backendLabel = backend?.name ?? body.backendId ?? body.provider ?? null
      const effectiveModel = body.request.model ?? backend?.llm?.model ?? null
      const modelLabel = backendLabel && effectiveModel ? `${backendLabel} · ${effectiveModel}` : (backendLabel ?? effectiveModel ?? null)
      // 参考图（data URL）转成 asset 保存，task 里只记 asset id 引用，避免把巨大
      // 的 base64 塞进 task input（会拖慢列表加载）。这样生成记录能原样展示用户输入的图。
      const refDataUrls = shouldRecordTask
        ? (body.request.images?.length ? body.request.images : body.request.image ? [body.request.image] : [])
        : []
      const referenceImages: string[] = []
      for (const dataUrl of refDataUrls) {
        const parsed = parseDataUrl(dataUrl)
        if (!parsed) continue
        try {
          const asset = deps.assets.save({
            kind: 'image',
            name: `reference-${Date.now()}-${referenceImages.length}.${parsed.ext}`,
            mimeType: parsed.mimeType,
            data: parsed.buffer,
          })
          referenceImages.push(asset.id)
        } catch {
          // 参考图保存失败不阻断生图，仅不记录该图。
        }
      }
      const task = shouldRecordTask ? tasks.start({
        kind: 'image',
        clientRequestId: body.clientRequestId,
        creationId: body.sourceCreationId ?? null,
        modelId: modelLabel,
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
          backendName: backend?.name ?? null,
          hasReferenceImage: !!(body.request.image || body.request.images?.length),
          referenceImageCount: body.request.images?.length ?? (body.request.image ? 1 : 0),
          referenceImages,
          denoise: body.request.denoise,
          backendId: body.backendId,
          provider: body.provider,
          sourceCreationId: body.sourceCreationId,
          pageIndex: body.pageIndex ?? null,
          sessionId: body.sessionId ?? null,
          origin: normalizeTaskOrigin(body.origin),
        },
      }) : null
      try {
        const images = body.backendId
          ? await imageGen.generateByBackend(body.backendId, body.request, request.signal)
          : await imageGen.generate(body.provider ?? 'llm', body.request, request.signal)
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
        const elapsedMs = Date.now() - startedAt
        if (task) {
          const recorded = tasks.markSuccess(task.id, {
            count: saved.length,
            images: saved.map((s) => ({ id: s.id, mimeType: s.mimeType, sizeBytes: s.sizeBytes })),
            elapsedMs,
          }, modelLabel)
          if (!recorded && tasks.getById(task.id)?.status === 'cancelled') return error('生成已取消', 409)
        }
        return json({ images: saved, elapsedMs }, 201)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        if (task) {
          try {
            if (request.signal.aborted || /取消|aborted/i.test(message)) tasks.markCancelled(task.id, '用户取消生成')
            else tasks.markFailed(task.id, 'imagegen', message, { elapsedMs: Date.now() - startedAt })
          } catch {
            // recording must not mask the real error
          }
        }
        return error(`生成失败: ${message}`, 502)
      }
  })

  register('/api/paipiange.imagegen.enqueue', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        provider?: ProviderId
        backendId?: string
        request?: ImageGenRequest
        requests?: ImageGenRequest[]
        origin?: unknown
        clientRequestId?: string
        sourceCreationId?: string
        priority?: number
        maxAttempts?: number
        pageIndex?: number
        sessionId?: string
        source?: 'template'
        templateId?: string
        templateName?: string
        templateCategory?: string
        templateKind?: 'comic'
        theme?: string
        roleChoice?: 'female' | 'male' | 'both'
        overlayText?: string
      } | null
      const requests = (Array.isArray(body?.requests) && body.requests.length > 0 ? body.requests : body?.request ? [body.request] : [])
        .slice(0, 20)
      if (!body || requests.length === 0 || requests.some((item) => !item?.prompt?.trim())) return error('缺少 prompt')
      const backend = body.backendId ? settings.listBackends().find((item) => item.id === body.backendId) : undefined
      const effectiveModel = requests[0]?.model ?? backend?.llm?.model ?? null
      const backendLabel = backend?.name ?? body.backendId ?? body.provider ?? null
      const modelLabel = backendLabel && effectiveModel ? `${backendLabel} · ${effectiveModel}` : (backendLabel ?? effectiveModel ?? null)
      const queuedRequests: QueuedImageRequest[] = []
      const allReferenceImages: string[] = []
      for (const imageRequest of requests) {
        const { image, images, ...safeRequest } = imageRequest
        const referenceAssetIds: string[] = []
        const references = images?.length ? images : image ? [image] : []
        for (const dataUrl of references) {
          const parsed = parseDataUrl(dataUrl)
          if (!parsed) continue
          const asset = deps.assets.save({
            kind: 'image',
            name: `reference-${Date.now()}-${allReferenceImages.length}.${parsed.ext}`,
            mimeType: parsed.mimeType,
            data: parsed.buffer,
          })
          referenceAssetIds.push(asset.id)
          allReferenceImages.push(asset.id)
        }
        queuedRequests.push({ ...safeRequest, referenceAssetIds })
      }
      const payload: ImageQueuePayload = {
        provider: body.provider,
        backendId: body.backendId,
        requests: queuedRequests,
        sourceCreationId: body.sourceCreationId ?? null,
      }
      const task = tasks.enqueue({
        kind: 'image',
        clientRequestId: body.clientRequestId,
        creationId: body.sourceCreationId ?? null,
        modelId: modelLabel,
        priority: body.priority,
        maxAttempts: body.maxAttempts,
        input: {
          prompt: requests[0].prompt,
          prompts: requests.map((item) => item.prompt),
          count: requests.length,
          requestedCount: requests.length,
          batch: requests.length > 1,
          width: requests[0].width,
          height: requests[0].height,
          size: requests[0].size,
          model: requests[0].model,
          backendName: backend?.name ?? null,
          backendId: body.backendId,
          provider: body.provider,
          hasReferenceImage: allReferenceImages.length > 0,
          referenceImageCount: allReferenceImages.length,
          referenceImages: allReferenceImages,
          sourceCreationId: body.sourceCreationId,
          pageIndex: body.pageIndex ?? null,
          sessionId: body.sessionId ?? null,
          source: body.source,
          templateId: body.templateId,
          templateName: body.templateName,
          templateCategory: body.templateCategory,
          templateKind: body.templateKind,
          theme: body.theme,
          roleChoice: body.roleChoice,
          overlayText: body.overlayText,
          origin: normalizeTaskOrigin(body.origin),
        },
        queuePayload: payload as unknown as Record<string, unknown>,
      })
      queue.notify()
      return json({ task }, 202)
  })

  register('/api/paipiange.textgen.enqueue', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as (TextGenRequest & {
        backendId?: string
        baseUrl?: string
        apiKey?: string
        origin?: unknown
        clientRequestId?: string
        sourceCreationId?: string
        priority?: number
        maxAttempts?: number
      }) | null
      if (!body?.topic?.trim()) return error('缺少 topic')
      if (body.baseUrl?.trim() && !body.backendId) return error('后台队列不保存临时 API 凭证，请先把文字后端保存到设置中心')
      const defaults = settings.getTextGenConfig()
      const backend = body.backendId ? settings.getBackend(body.backendId) : null
      // 参考图（data URL）转成 asset 保存，避免把巨大的 base64 塞进 task input。
      const referenceImages: string[] = []
      for (const dataUrl of (Array.isArray(body.images) ? body.images : [])) {
        if (typeof dataUrl !== 'string') continue
        const parsed = parseDataUrl(dataUrl)
        if (!parsed) continue
        try {
          const asset = deps.assets.save({
            kind: 'image',
            name: `reference-${Date.now()}-${referenceImages.length}.${parsed.ext}`,
            mimeType: parsed.mimeType,
            data: parsed.buffer,
          })
          referenceImages.push(asset.id)
        } catch {
          // 参考图保存失败不阻断，仅不记录该图。
        }
      }
      const textRequest: TextGenRequest = {
        studio: body.studio,
        topic: body.topic.trim(),
        style: body.style,
        requirement: body.requirement,
        platform: body.platform,
        images: referenceImages.length ? referenceImages.map((id) => id) : undefined,
        provider: body.provider?.trim() || backend?.text?.provider?.trim() || defaults.provider,
        model: body.model?.trim() || backend?.text?.model?.trim() || defaults.model,
      }
      const payload: TextQueuePayload = {
        request: textRequest,
        backendId: body.backendId,
        referenceImages,
      }
      const task = tasks.enqueue({
        kind: 'text',
        clientRequestId: body.clientRequestId,
        creationId: body.sourceCreationId ?? null,
        modelId: textRequest.model || null,
        priority: body.priority,
        maxAttempts: body.maxAttempts,
        input: {
          studio: textRequest.studio,
          topic: textRequest.topic,
          style: textRequest.style,
          requirement: textRequest.requirement,
          platform: textRequest.platform,
          provider: textRequest.provider,
          model: textRequest.model,
          backendId: body.backendId,
          hasReferenceImage: referenceImages.length > 0,
          referenceImageCount: referenceImages.length,
          referenceImages,
          origin: normalizeTaskOrigin(body.origin),
        },
        queuePayload: payload as unknown as Record<string, unknown>,
      })
      queue.notify()
      return json({ task }, 202)
  })

  register('/api/paipiange.video.enqueue', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        topic?: string
        subtitle?: string
        style?: string
        styleId?: string
        multiScene?: boolean
        sceneCount?: number
        aspectRatio?: '16:9' | '9:16' | '1:1'
        durationSec?: number
        fps?: number
        provider?: string
        model?: string
        backendId?: string
        engine?: 'llm' | 'comfyui'
        sourceCreationId?: string
        origin?: unknown
        clientRequestId?: string
        priority?: number
        maxAttempts?: number
      } | null
      if (!body?.topic?.trim()) return error('缺少主题文案 topic')
      const defaults = settings.getTextGenConfig()
      const payload: VideoQueuePayload = {
        request: {
          topic: body.topic.trim(),
          subtitle: body.subtitle?.trim(),
          style: body.style?.trim(),
          styleId: body.styleId?.trim(),
          multiScene: body.multiScene === true,
          sceneCount: body.sceneCount,
          aspectRatio: body.aspectRatio,
          durationSec: body.durationSec,
          fps: body.fps,
          provider: body.provider?.trim() || defaults.provider,
          model: body.model?.trim() || defaults.model,
          engine: body.engine === 'comfyui' ? 'comfyui' : 'llm',
        },
        backendId: body.backendId,
        sourceCreationId: body.sourceCreationId ?? null,
      }
      const task = tasks.enqueue({
        kind: 'video',
        clientRequestId: body.clientRequestId,
        creationId: body.sourceCreationId ?? null,
        modelId: payload.request.model || null,
        priority: body.priority,
        maxAttempts: body.maxAttempts,
        input: {
          topic: payload.request.topic,
          subtitle: payload.request.subtitle ?? '',
          style: payload.request.style ?? '',
          aspectRatio: payload.request.aspectRatio ?? '16:9',
          durationSec: payload.request.durationSec ?? 5,
          fps: payload.request.fps ?? 24,
          provider: payload.request.provider ?? '',
          model: payload.request.model ?? '',
          backendId: body.backendId ?? '',
          engine: payload.request.engine,
          origin: normalizeTaskOrigin(body.origin),
        },
        queuePayload: payload as unknown as Record<string, unknown>,
      })
      queue.notify()
      return json({ task }, 202)
  })

  register('/api/paipiange.imagegen.batch.start', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        provider?: ProviderId
        backendId?: string
        prompt?: string
        prompts?: string[]
        requestedCount?: number
        width?: number
        height?: number
        size?: number
        model?: string
        referenceImageCount?: number
        sourceCreationId?: string
        source?: 'template'
        templateId?: string
        templateName?: string
        templateCategory?: string
        templateKind?: 'comic'
        theme?: string
        roleChoice?: 'female' | 'male' | 'both'
        overlayText?: string
        origin?: unknown
        clientRequestId?: string
      } | null
      if (!body?.prompt?.trim()) return error('缺少 prompt')
      const requestedCount = Math.max(1, Math.min(20, Math.round(Number(body.requestedCount) || 1)))
      const backend = body.backendId
        ? settings.listBackends().find((item) => item.id === body.backendId)
        : undefined
      const effectiveModel = body.model ?? backend?.llm?.model ?? null
      const backendLabel = backend?.name ?? body.backendId ?? body.provider ?? null
      const modelLabel = backendLabel && effectiveModel ? `${backendLabel} · ${effectiveModel}` : (backendLabel ?? effectiveModel ?? null)
      const task = tasks.start({
        kind: 'image',
        clientRequestId: body.clientRequestId,
        creationId: body.sourceCreationId ?? null,
        modelId: modelLabel,
        input: {
          prompt: body.prompt.trim(),
          prompts: Array.isArray(body.prompts) ? body.prompts.slice(0, requestedCount) : undefined,
          count: requestedCount,
          requestedCount,
          batch: true,
          width: body.width,
          height: body.height,
          size: body.size,
          model: body.model,
          backendName: backend?.name ?? null,
          backendId: body.backendId,
          provider: body.provider,
          hasReferenceImage: Number(body.referenceImageCount) > 0,
          referenceImageCount: Math.max(0, Math.round(Number(body.referenceImageCount) || 0)),
          sourceCreationId: body.sourceCreationId,
          source: body.source,
          templateId: body.templateId,
          templateName: body.templateName,
          templateCategory: body.templateCategory,
          templateKind: body.templateKind,
          theme: body.theme,
          roleChoice: body.roleChoice,
          overlayText: body.overlayText,
          origin: normalizeTaskOrigin(body.origin),
        },
      })
      return json({ taskId: task.id }, 201)
  })

  register('/api/paipiange.imagegen.batch.finish', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        taskId?: string
        imageIds?: string[]
        elapsedMs?: number
        paused?: boolean
        requestedCount?: number
      } | null
      if (!body?.taskId) return error('缺少 taskId')
      const task = tasks.getById(body.taskId)
      if (!task || task.kind !== 'image') return error('批次任务不存在', 404)
      if (task.status !== 'running') return error('批次任务已结束', 409)
      const images = (body.imageIds ?? [])
        .slice(0, 100)
        .map((id) => imageResultFromAsset(deps.assets.getById(id)))
        .filter((item): item is NonNullable<typeof item> => item !== null)
      if (images.length === 0) return error('批次任务没有可记录的图片')
      const requestedCount = Math.max(1, Math.round(Number(body.requestedCount) || images.length))
      const elapsedMs = normalizeElapsedMs(body.elapsedMs)
      tasks.markSuccess(body.taskId, {
        count: images.length,
        requestedCount,
        images,
        elapsedMs,
      })
      return json({ ok: true, count: images.length, elapsedMs })
  })

  register('/api/paipiange.imagegen.batch.fail', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        taskId?: string
        errorMessage?: string
        imageIds?: string[]
        elapsedMs?: number
        requestedCount?: number
      } | null
      if (!body?.taskId) return error('缺少 taskId')
      const task = tasks.getById(body.taskId)
      if (!task || task.kind !== 'image') return error('批次任务不存在', 404)
      if (task.status !== 'running') return json({ ok: true })
      const images = (body.imageIds ?? [])
        .slice(0, 100)
        .map((id) => imageResultFromAsset(deps.assets.getById(id)))
        .filter((item): item is NonNullable<typeof item> => item !== null)
      tasks.markFailed(body.taskId, 'imagegen', body.errorMessage?.trim() || '批量生图失败', {
        count: images.length,
        requestedCount: Math.max(1, Math.round(Number(body.requestedCount) || images.length || 1)),
        images,
        elapsedMs: normalizeElapsedMs(body.elapsedMs),
      })
      return json({ ok: true })
  })

  register('/api/paipiange.imagegen.batch.progress', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as {
        taskId?: string
        completed?: number
        total?: number
        imageIds?: string[]
        elapsedMs?: number
        paused?: boolean
      } | null
      if (!body?.taskId) return error('缺少 taskId')
      const images = (body.imageIds ?? [])
        .slice(0, 100)
        .map((id) => imageResultFromAsset(deps.assets.getById(id)))
        .filter((item): item is NonNullable<typeof item> => item !== null)
      const ok = tasks.updateProgress(body.taskId, {
        progress: {
          completed: Math.max(0, Math.round(Number(body.completed) || 0)),
          total: Math.max(1, Math.round(Number(body.total) || 1)),
          paused: body.paused === true,
        },
        count: images.length,
        images,
        elapsedMs: normalizeElapsedMs(body.elapsedMs),
      })
      return ok ? json({ ok: true }) : error('批次任务已结束', 409)
  })

  register('/api/paipiange.task.cancel', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { id?: string; clientRequestId?: string } | null
      const task = body?.id
        ? tasks.getById(body.id)
        : body?.clientRequestId
          ? tasks.getByClientRequestId(body.clientRequestId)
          : null
      if (!task) return error('任务不存在', 404)
      if (!['queued', 'running', 'paused'].includes(task.status)) return json({ task })
      if (task.queuePayload) queue.cancel(task.id)
      else tasks.markCancelled(task.id)
      return json({ task: tasks.getById(task.id) })
  })

  register('/api/paipiange.task.pause', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { id?: string } | null
      if (!body?.id) return error('缺少 id')
      return queue.pause(body.id) ? json({ task: tasks.getById(body.id) }) : error('任务不可暂停', 409)
  })

  register('/api/paipiange.task.resume', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { id?: string } | null
      if (!body?.id) return error('缺少 id')
      return queue.resume(body.id) ? json({ task: tasks.getById(body.id) }) : error('任务不可继续', 409)
  })

  register('/api/paipiange.task.priority', ['PATCH'], async (request) => {
      const body = await request.json().catch(() => null) as { id?: string; priority?: number } | null
      if (!body?.id || !Number.isFinite(body.priority)) return error('缺少 id 或 priority')
      return queue.setPriority(body.id, Number(body.priority)) ? json({ task: tasks.getById(body.id) }) : error('任务优先级不可修改', 409)
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
        status === 'queued' || status === 'running' || status === 'paused' || status === 'success' || status === 'failed' || status === 'cancelled' ? status : undefined,
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
      return json({ overview: analytics.overview(), insights: analytics.insights() })
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
