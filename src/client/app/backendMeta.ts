import { ChatText, Cpu, ImageSquare } from '@phosphor-icons/react'
import type { Backend, BackendKind } from './hostClient'

export type Toast = (message: string, tone?: 'info' | 'success' | 'warning') => void

export const KIND_META: Record<BackendKind, { label: string; icon: typeof ChatText }> = {
  'llm-text': { label: '文字 API', icon: ChatText },
  'llm-image': { label: '图片 API', icon: ImageSquare },
  comfyui: { label: '本机 ComfyUI', icon: Cpu },
}

/** 国内主流云生图供应商预设（OpenAI 兼容 / 官方 SDK 网关）。 */
export const CLOUD_PRESETS: Array<{ name: string; kind: BackendKind; baseUrl: string; modelHint: string }> = [
  { name: '通义万相（阿里云 DashScope）', kind: 'llm-image', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', modelHint: 'wanx2.1-t2i-turbo' },
  { name: '智谱 CogView', kind: 'llm-image', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelHint: 'cogview-3-flash' },
  { name: '硅基流动 SiliconFlow', kind: 'llm-image', baseUrl: 'https://api.siliconflow.cn/v1', modelHint: 'black-forest-labs/FLUX.1-schnell' },
  { name: '即梦/豆包（火山方舟）', kind: 'llm-image', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', modelHint: 'doubao-seedream-3-0-t2i' },
]

/** Form state for a single backend being created or edited. */
export interface BackendForm {
  name: string
  kind: BackendKind
  // llm-image
  baseUrl: string
  apiKey: string
  model: string
  // llm-text
  provider: string
  textModel: string
  textBaseUrl: string
  textApiKey: string
  // comfyui
  server: string
  unet: string
  clip: string
  vae: string
  checkpoint: string
  // extra models stored under this backend (a "group" of models)
  llmModels: string[]
  textModels: string[]
}

export const EMPTY_FORM: BackendForm = {
  name: '',
  kind: 'llm-image',
  baseUrl: '',
  apiKey: '',
  model: '',
  provider: '',
  textModel: '',
  textBaseUrl: '',
  textApiKey: '',
  server: 'http://127.0.0.1:8188',
  unet: '',
  clip: '',
  vae: '',
  checkpoint: '',
  llmModels: [],
  textModels: [],
}

/** Build a connection-test input from the current (possibly unsaved) form state. */
export function buildTestInput(editing: BackendForm): { kind: 'comfyui' | 'llm-image' | 'llm-text'; llm?: { baseUrl: string; apiKey: string; model: string }; comfyui?: { server: string }; text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string } } | null {
  if (editing.kind === 'comfyui') {
    const server = editing.server.trim().replace(/\/+$/, '')
    if (!server) return null
    return { kind: 'comfyui', comfyui: { server } }
  }
  if (editing.kind === 'llm-image') {
    const baseUrl = editing.baseUrl.trim().replace(/\/+$/, '')
    const apiKey = editing.apiKey.trim()
    const model = editing.model.trim()
    if (!baseUrl) return null
    return { kind: 'llm-image', llm: { baseUrl, apiKey, model } }
  }
  if (editing.kind === 'llm-text') {
    const provider = editing.provider.trim()
    const model = editing.textModel.trim()
    const baseUrl = editing.textBaseUrl.trim().replace(/\/+$/, '')
    const apiKey = editing.textApiKey.trim()
    if (baseUrl) {
      if (!model) return null
      return { kind: 'llm-text', text: { baseUrl, apiKey, model } }
    }
    if (!provider || !model) return null
    return { kind: 'llm-text', text: { provider, model } }
  }
  return null
}

export function summaryOf(backend: Backend): string {
  if (backend.kind === 'llm-image' && backend.llm) return `${backend.llm.model} · ${backend.llm.baseUrl}`
  if (backend.kind === 'llm-text' && backend.text) {
    if (backend.text.baseUrl) return `${backend.text.model} · ${backend.text.baseUrl}`
    return `${backend.text.model} · ${backend.text.provider}`
  }
  if (backend.kind === 'comfyui' && backend.comfyui) {
    const parts = [backend.comfyui.server]
    if (backend.comfyui.unet) parts.push(backend.comfyui.unet)
    else if (backend.comfyui.checkpoint) parts.push(backend.comfyui.checkpoint)
    return parts.join(' · ')
  }
  return ''
}

/** Build the create/update payload from the form state. */
export function buildBackendPayload(editing: BackendForm) {
  const kind = editing.kind
  return {
    name: editing.name.trim(),
    kind,
    ...(kind === 'llm-image'
      ? { llm: { baseUrl: editing.baseUrl.trim().replace(/\/+$/, ''), apiKey: editing.apiKey.trim(), model: editing.model.trim(), ...(editing.llmModels.length ? { models: editing.llmModels } : {}) } }
      : {}),
    ...(kind === 'llm-text'
      ? {
          text: {
            provider: editing.provider.trim() || undefined,
            baseUrl: editing.textBaseUrl.trim().replace(/\/+$/, '') || undefined,
            apiKey: editing.textApiKey.trim() || undefined,
            model: editing.textModel.trim(),
            ...(editing.textModels.length ? { models: editing.textModels } : {}),
          },
        }
      : {}),
    ...(kind === 'comfyui'
      ? {
          comfyui: {
            server: editing.server.trim().replace(/\/+$/, ''),
            unet: editing.unet.trim() || undefined,
            clip: editing.clip.trim() || undefined,
            vae: editing.vae.trim() || undefined,
            checkpoint: editing.checkpoint.trim() || undefined,
          },
        }
      : {}),
  }
}

/** Convert a saved backend back into editable form state. */
export function toForm(backend: Backend): BackendForm {
  return {
    name: backend.name,
    kind: backend.kind,
    baseUrl: backend.llm?.baseUrl ?? '',
    apiKey: backend.llm?.apiKey ?? '',
    model: backend.llm?.model ?? '',
    provider: backend.text?.provider ?? '',
    textModel: backend.text?.model ?? '',
    textBaseUrl: backend.text?.baseUrl ?? '',
    textApiKey: backend.text?.apiKey ?? '',
    server: backend.comfyui?.server ?? 'http://127.0.0.1:8188',
    unet: backend.comfyui?.unet ?? '',
    clip: backend.comfyui?.clip ?? '',
    vae: backend.comfyui?.vae ?? '',
    checkpoint: backend.comfyui?.checkpoint ?? '',
    llmModels: backend.llm?.models ?? [],
    textModels: backend.text?.models ?? [],
  }
}
