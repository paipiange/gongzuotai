import { readFileSync } from 'node:fs'
import type { ProviderId } from '../imagegen/ImageGenService'
import type { ImageGenRequest } from '../imagegen/types'
import type { AssetRepository } from '../storage/assetRepository'
import type { SettingsRepository } from '../storage/SettingsRepository'
import type { TaskRecord } from '../storage/taskRepository'
import { generateText, generateTextDirect, type TextGenRequest } from '../textgen/textGenService'
import type { LlmService } from '../textgen/types'
import { generateVideo, type VideoEngine, type VideoGenRequest } from '../videogen/videoGenService'
import type { GenerationQueue } from './GenerationQueue'

export interface QueuedImageRequest extends Omit<ImageGenRequest, 'image' | 'images'> {
  referenceAssetIds?: string[]
}

export interface ImageQueuePayload {
  provider?: ProviderId
  backendId?: string
  requests: QueuedImageRequest[]
  sourceCreationId?: string | null
}

export interface TextQueuePayload {
  request: TextGenRequest
  backendId?: string
  /** 参考图 asset id 列表（由路由层把 dataURL 转存为 asset）。 */
  referenceImages?: string[]
}

export interface VideoQueuePayload {
  request: Omit<VideoGenRequest, 'provider' | 'model' | 'comfyui'> & {
    provider?: string
    model?: string
    engine?: VideoEngine
  }
  backendId?: string
  sourceCreationId?: string | null
}

export interface GenerationHandlerDeps {
  assets: AssetRepository
  settings: SettingsRepository
  buildImageGen: () => {
    generate: (provider: ProviderId, request: ImageGenRequest, signal?: AbortSignal) => Promise<Array<{ data: Buffer; mimeType: string }>>
    generateByBackend: (backendId: string, request: ImageGenRequest, signal?: AbortSignal) => Promise<Array<{ data: Buffer; mimeType: string }>>
  }
  llm?: LlmService
}

export function registerGenerationHandlers(queue: GenerationQueue, deps: GenerationHandlerDeps): GenerationQueue {
  queue.register('image', async (task, context) => {
    const payload = task.queuePayload as unknown as ImageQueuePayload
    if (!payload || !Array.isArray(payload.requests) || payload.requests.length === 0) {
      throw new Error('图片队列任务缺少生成请求')
    }
    const startedAt = Date.now()
    const imageGen = deps.buildImageGen()
    const saved: Array<{ id: string; mimeType: string; sizeBytes: number }> = []
    for (let index = 0; index < payload.requests.length; index++) {
      if (context.signal.aborted) throw new Error('已取消生成')
      const queuedRequest = payload.requests[index]
      const referenceDataUrls = (queuedRequest.referenceAssetIds ?? [])
        .map((id) => assetToDataUrl(deps.assets, id))
        .filter((value): value is string => Boolean(value))
      const request: ImageGenRequest = {
        ...queuedRequest,
        referenceAssetIds: undefined,
        ...(referenceDataUrls.length === 1 ? { image: referenceDataUrls[0] } : {}),
        ...(referenceDataUrls.length > 0 ? { images: referenceDataUrls } : {}),
      } as ImageGenRequest
      const generated = payload.backendId
        ? await imageGen.generateByBackend(payload.backendId, request, context.signal)
        : await imageGen.generate(payload.provider ?? 'llm', request, context.signal)
      for (const image of generated) {
        const asset = deps.assets.save({
          kind: 'image',
          name: `generated-${payload.backendId ?? payload.provider ?? 'image'}.png`,
          mimeType: image.mimeType,
          data: image.data,
          sourceCreationId: payload.sourceCreationId ?? null,
        })
        saved.push({ id: asset.id, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes })
      }
      context.updateProgress({
        progress: { completed: index + 1, total: payload.requests.length, paused: false },
        count: saved.length,
        images: saved,
        elapsedMs: Date.now() - startedAt,
      })
    }
    return {
      count: saved.length,
      requestedCount: payload.requests.length,
      images: saved,
      elapsedMs: Date.now() - startedAt,
    }
  })

  queue.register('text', async (task, context) => {
    const payload = task.queuePayload as unknown as TextQueuePayload
    if (!payload?.request?.topic) throw new Error('文字队列任务缺少主题')
    const startedAt = Date.now()
    const request = { ...payload.request }
    let bufferedText = ''
    let lastProgressAt = 0
    const onDelta = (delta: string) => {
      bufferedText += delta
      const now = Date.now()
      if (now - lastProgressAt >= 200) {
        lastProgressAt = now
        context.updateProgress({ text: bufferedText, elapsedMs: now - startedAt })
      }
    }

    const backend = payload.backendId
      ? deps.settings.listBackendsWithSecrets().find((item) => item.id === payload.backendId && item.kind === 'llm-text')
      : undefined
    const direct = backend?.text?.baseUrl?.trim()
    const selectedModel = request.model?.trim() || backend?.text?.model?.trim() || ''
    // 参考图 asset id → data URL（仅直连多模态后端真正发送；Harness 服务忽略）。
    const imageDataUrls = (payload.referenceImages ?? [])
      .map((id) => assetToDataUrl(deps.assets, id))
      .filter((value): value is string => Boolean(value))
    if (imageDataUrls.length) request.images = imageDataUrls
    if (direct) {
      if (!selectedModel) throw new Error('直连文字后端缺少模型名')
      const result = await generateTextDirect(
        { baseUrl: direct, apiKey: backend?.text?.apiKey ?? '', model: selectedModel },
        { ...request, model: selectedModel },
        { signal: context.signal, onDelta },
      )
      return { ...result, elapsedMs: Date.now() - startedAt }
    }

    if (!deps.llm?.prepareCall) throw new Error('Harness 文本模型服务未就绪，请先在 Harness 中配置模型')
    const defaults = deps.settings.getTextGenConfig()
    let provider = request.provider?.trim() || backend?.text?.provider?.trim() || defaults.provider
    let model = selectedModel || defaults.model
    if (typeof deps.llm.listProviders === 'function') {
      const available = deps.llm.listProviders().map((item) => item.provider)
      if (!available.includes(provider)) {
        provider = available[0] ?? provider
        model = model || defaults.model
      }
    }
    if (!provider) throw new Error('Harness 尚未配置任何可用的文本模型 Provider')
    const result = await generateText(deps.llm, { ...request, provider, model }, { signal: context.signal, onDelta })
    return { ...result, elapsedMs: Date.now() - startedAt }
  })

  queue.register('video', async (task, context) => {
    const payload = task.queuePayload as unknown as VideoQueuePayload
    if (!payload?.request?.topic?.trim()) throw new Error('视频队列任务缺少主题')
    const startedAt = Date.now()
    const defaults = deps.settings.getTextGenConfig()
    const engine: VideoEngine = payload.request.engine === 'comfyui' ? 'comfyui' : 'llm'
    let provider = payload.request.provider?.trim() || defaults.provider
    let model = payload.request.model?.trim() || defaults.model
    if (engine === 'llm') {
      if (!deps.llm?.prepareCall) throw new Error('Harness 文本模型服务未就绪，请先在 Harness 中配置模型')
      if (typeof deps.llm.listProviders === 'function') {
        const available = deps.llm.listProviders().map((item) => item.provider)
        if (!available.includes(provider)) provider = available[0] ?? provider
      }
    }
    const comfyui = engine === 'comfyui'
      ? deps.settings.listBackendsWithSecrets().find((item) => item.kind === 'comfyui' && (!payload.backendId || item.id === payload.backendId))?.comfyui
        ?? deps.settings.getComfyUiConfig()
        ?? undefined
      : undefined
    if (engine === 'comfyui' && !comfyui?.server) throw new Error('未找到已配置的 ComfyUI 后端')

    const result = await generateVideo(
      deps.llm,
      { ...payload.request, provider, model, engine, comfyui },
      {
        signal: context.signal,
        onProgress: (progress) => context.updateProgress({ progress, elapsedMs: Date.now() - startedAt }),
      },
    )
    const asset = deps.assets.save({
      kind: 'file',
      name: `video-${Date.now()}.mp4`,
      mimeType: 'video/mp4',
      data: result.mp4,
      width: result.width,
      height: result.height,
      sourceCreationId: payload.sourceCreationId ?? null,
    })
    return {
      assetId: asset.id,
      width: result.width,
      height: result.height,
      fps: result.fps,
      totalFrames: result.totalFrames,
      usedFallback: result.usedFallback,
      rounds: result.rounds,
      elapsedMs: Date.now() - startedAt,
    }
  })

  return queue
}

function assetToDataUrl(assets: AssetRepository, id: string): string | null {
  const asset = assets.getById(id)
  if (!asset || asset.kind !== 'image' || asset.deletedAt) return null
  try {
    return `data:${asset.mimeType};base64,${readFileSync(assets.resolveAbsolutePath(asset)).toString('base64')}`
  } catch {
    return null
  }
}
