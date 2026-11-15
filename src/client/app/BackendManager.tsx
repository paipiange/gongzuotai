import { ChatText, ImageSquare, Cpu, Plus, PencilSimple, Trash, FloppyDisk, X, Eye, EyeSlash, Lightning } from '@phosphor-icons/react'
import { FormEvent, useEffect, useState } from 'react'
import {
  createBackend,
  deleteBackend,
  listBackends,
  testBackend,
  updateBackend,
  type Backend,
  type BackendKind,
} from './hostClient'

type Toast = (message: string, tone?: 'info' | 'success' | 'warning') => void

const KIND_META: Record<BackendKind, { label: string; icon: typeof ChatText }> = {
  'llm-text': { label: '文字 API', icon: ChatText },
  'llm-image': { label: '图片 API', icon: ImageSquare },
  comfyui: { label: '本机 ComfyUI', icon: Cpu },
}

/** 国内主流云生图供应商预设（OpenAI 兼容 / 官方 SDK 网关）。 */
const CLOUD_PRESETS: Array<{ name: string; kind: BackendKind; baseUrl: string; modelHint: string }> = [
  { name: '通义万相（阿里云 DashScope）', kind: 'llm-image', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', modelHint: 'wanx2.1-t2i-turbo' },
  { name: '智谱 CogView', kind: 'llm-image', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelHint: 'cogview-3-flash' },
  { name: '硅基流动 SiliconFlow', kind: 'llm-image', baseUrl: 'https://api.siliconflow.cn/v1', modelHint: 'black-forest-labs/FLUX.1-schnell' },
  { name: '即梦/豆包（火山方舟）', kind: 'llm-image', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', modelHint: 'doubao-seedream-3-0-t2i' },
]

/** Form state for a single backend being created or edited. */
interface BackendForm {
  name: string
  kind: BackendKind
  // llm-image
  baseUrl: string
  apiKey: string
  model: string
  // llm-text
  provider: string
  textModel: string
  // comfyui
  server: string
  unet: string
  clip: string
  vae: string
  checkpoint: string
}

const EMPTY_FORM: BackendForm = {
  name: '',
  kind: 'llm-image',
  baseUrl: '',
  apiKey: '',
  model: '',
  provider: '',
  textModel: '',
  server: 'http://127.0.0.1:8188',
  unet: '',
  clip: '',
  vae: '',
  checkpoint: '',
}

function summaryOf(backend: Backend): string {
  if (backend.kind === 'llm-image' && backend.llm) return `${backend.llm.model} · ${backend.llm.baseUrl}`
  if (backend.kind === 'llm-text' && backend.text) return `${backend.text.model} · ${backend.text.provider}`
  if (backend.kind === 'comfyui' && backend.comfyui) {
    const parts = [backend.comfyui.server]
    if (backend.comfyui.unet) parts.push(backend.comfyui.unet)
    else if (backend.comfyui.checkpoint) parts.push(backend.comfyui.checkpoint)
    return parts.join(' · ')
  }
  return ''
}

/**
 * Unified backend manager: text and image generation backends live in one list,
 * each editable / removable / switchable. Replaces the old separate text-gen and
 * image-gen settings cards.
 */
export function BackendManager({ onToast }: { onToast: Toast }) {
  const [backends, setBackends] = useState<Backend[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hostReachable, setHostReachable] = useState(true)
  const [editing, setEditing] = useState<BackendForm | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null)

  const reload = async () => {
    try {
      const list = await listBackends()
      setBackends(list)
      setHostReachable(true)
    } catch {
      setHostReachable(false)
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const startCreate = () => {
    setEditingId(null)
    setEditing({ ...EMPTY_FORM })
  }

  const startEdit = (backend: Backend) => {
    setEditingId(backend.id)
    setEditing({
      name: backend.name,
      kind: backend.kind,
      baseUrl: backend.llm?.baseUrl ?? '',
      apiKey: backend.llm?.apiKey ?? '',
      model: backend.llm?.model ?? '',
      provider: backend.text?.provider ?? '',
      textModel: backend.text?.model ?? '',
      server: backend.comfyui?.server ?? 'http://127.0.0.1:8188',
      unet: backend.comfyui?.unet ?? '',
      clip: backend.comfyui?.clip ?? '',
      vae: backend.comfyui?.vae ?? '',
      checkpoint: backend.comfyui?.checkpoint ?? '',
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    setEditingId(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    if (!editing.name.trim()) {
      onToast('请填写后端名称', 'warning')
      return
    }
    const kind = editing.kind
    if (kind === 'llm-image') {
      if (!editing.baseUrl.trim() || !editing.apiKey.trim() || !editing.model.trim()) {
        onToast('请填写图片 API 的 Base URL、API Key 与模型名', 'warning')
        return
      }
    } else if (kind === 'llm-text') {
      if (!editing.provider.trim() || !editing.textModel.trim()) {
        onToast('请填写文字 API 的 Provider 与模型名', 'warning')
        return
      }
    } else {
      if (!editing.server.trim()) {
        onToast('请填写 ComfyUI 服务地址', 'warning')
        return
      }
      const hasSplit = editing.unet.trim() && editing.clip.trim() && editing.vae.trim()
      const hasCheckpoint = editing.checkpoint.trim()
      if (!hasSplit && !hasCheckpoint) {
        onToast('请填写 UNet/CLIP/VAE 或 checkpoint', 'warning')
        return
      }
    }

    setSaving(true)
    try {
      const common = {
        name: editing.name.trim(),
        kind,
        ...(kind === 'llm-image'
          ? { llm: { baseUrl: editing.baseUrl.trim().replace(/\/+$/, ''), apiKey: editing.apiKey.trim(), model: editing.model.trim() } }
          : {}),
        ...(kind === 'llm-text'
          ? { text: { provider: editing.provider.trim(), model: editing.textModel.trim() } }
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
      if (editingId) {
        await updateBackend(editingId, common)
        onToast('后端已更新', 'success')
      } else {
        await createBackend(common)
        onToast('后端已新增', 'success')
      }
      cancelEdit()
      await reload()
    } catch {
      onToast('保存失败，本地服务未连接', 'warning')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (backend: Backend) => {
    if (!window.confirm(`确定删除后端「${backend.name}」吗？此操作不可恢复。`)) return
    try {
      await deleteBackend(backend.id)
      onToast('后端已删除', 'success')
      await reload()
    } catch {
      onToast('删除失败，本地服务未连接', 'warning')
    }
  }

  /** Test whether a saved backend is currently reachable. */
  const handleTest = async (backend: Backend) => {
    setTesting(true)
    setTestResult(null)
    try {
      let result
      if (backend.kind === 'comfyui' && backend.comfyui) {
        result = await testBackend({ kind: 'comfyui', comfyui: { server: backend.comfyui.server } })
      } else if (backend.kind === 'llm-image' && backend.llm) {
        result = await testBackend({ kind: 'llm-image', llm: { baseUrl: backend.llm.baseUrl, apiKey: backend.llm.apiKey ?? '', model: backend.llm.model } })
      } else {
        onToast('文字后端无需连接测试（复用 Harness 服务）', 'info')
        return
      }
      setTestResult(result)
      onToast(result.ok ? '连接正常' : result.message, result.ok ? 'success' : 'warning')
    } catch (cause) {
      setTestResult({ ok: false, message: cause instanceof Error ? cause.message : '测试失败' })
      onToast(cause instanceof Error ? cause.message : '测试失败', 'warning')
    } finally {
      setTesting(false)
    }
  }

  /** Pre-fill the creation form from a cloud preset. */
  const applyPreset = (preset: (typeof CLOUD_PRESETS)[number]) => {
    setEditingId(null)
    setEditing({
      ...EMPTY_FORM,
      name: preset.name,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      model: preset.modelHint,
      apiKey: '',
    })
  }

  const textBackends = backends.filter((b) => b.kind === 'llm-text')
  const imageBackends = backends.filter((b) => b.kind !== 'llm-text')

  const renderBackendRow = (backend: Backend) => {
    const meta = KIND_META[backend.kind]
    const Icon = meta.icon
    const testable = backend.kind === 'comfyui' || backend.kind === 'llm-image'
    return (
      <li key={backend.id} className="pa-backend-row">
        <div className="pa-backend-row__icon"><Icon aria-hidden="true" size={20} /></div>
        <div className="pa-backend-row__body">
          <div className="pa-backend-row__title">
            <span className="pa-backend-row__name">{backend.name}</span>
            <span className="pa-backend-row__tag">{meta.label}</span>
          </div>
          <div className="pa-backend-row__summary">{summaryOf(backend)}</div>
        </div>
        <div className="pa-backend-row__actions">
          {testable && (
            <button type="button" className="pa-icon-button" title="测试连接" disabled={testing} onClick={() => handleTest(backend)}>
              <Lightning aria-hidden="true" size={17} />
            </button>
          )}
          <button type="button" className="pa-icon-button" title="编辑" onClick={() => startEdit(backend)}><PencilSimple aria-hidden="true" size={17} /></button>
          <button type="button" className="pa-icon-button pa-icon-button--danger" title="删除" onClick={() => handleDelete(backend)}><Trash aria-hidden="true" size={17} /></button>
        </div>
      </li>
    )
  }

  return (
    <section className="pa-panel pa-backend-manager">
      <div className="pa-imagegen-settings__head">
        <div className="pa-setting-card__icon"><Cpu aria-hidden="true" size={23} /></div>
        <div>
          <h2>后端管理</h2>
          <p>统一管理文字与图片生成后端，支持新增、编辑、删除与切换。</p>
        </div>
        <button type="button" className="pa-primary-button" onClick={startCreate}><Plus aria-hidden="true" size={17} /> 新增后端</button>
      </div>

      <div className="pa-cloud-presets">
        <h3 className="pa-backend-manager__group-title">快捷添加云生图供应商</h3>
        <div className="pa-cloud-presets__list">
          {CLOUD_PRESETS.map((preset) => (
            <button key={preset.name} type="button" className="pa-secondary-button" onClick={() => applyPreset(preset)}>
              <Lightning aria-hidden="true" size={14} />{preset.name}
            </button>
          ))}
        </div>
      </div>

      {testResult && (
        <div className="pa-backend-test-result" data-ok={testResult.ok}>
          <span>{testResult.ok ? '✓' : '✕'}</span>
          <span>{testResult.message}{testResult.latencyMs !== undefined ? `（${testResult.latencyMs}ms）` : ''}</span>
        </div>
      )}

      {!hostReachable && loaded && (
        <div className="pa-backend-manager__warn">本地服务未连接，无法读取/保存后端配置。请确认插件 Host 已启动。</div>
      )}

      <div className="pa-backend-manager__group">
        <h3 className="pa-backend-manager__group-title">文字后端（{textBackends.length}）</h3>
        {textBackends.length ? (
          <ul className="pa-backend-list">{textBackends.map(renderBackendRow)}</ul>
        ) : (
          <p className="pa-backend-manager__empty">还没有文字后端，点击右上角「新增后端」添加。</p>
        )}
      </div>

      <div className="pa-backend-manager__group">
        <h3 className="pa-backend-manager__group-title">图片后端（{imageBackends.length}）</h3>
        {imageBackends.length ? (
          <ul className="pa-backend-list">{imageBackends.map(renderBackendRow)}</ul>
        ) : (
          <p className="pa-backend-manager__empty">还没有图片后端，点击右上角「新增后端」添加。</p>
        )}
      </div>

      {editing && (
        <form className="pa-backend-form" onSubmit={handleSubmit}>
          <div className="pa-backend-form__head">
            <h3>{editingId ? '编辑后端' : '新增后端'}</h3>
            <button type="button" className="pa-icon-button" onClick={cancelEdit}><X aria-hidden="true" size={18} /></button>
          </div>

          <label className="pa-field pa-field--full">
            <span>名称 <b aria-hidden="true">*</b></span>
            <input type="text" placeholder="例如：本机 ComfyUI / GPT 图片" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>

          <label className="pa-field pa-field--full">
            <span>类型</span>
            <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as BackendKind })}>
              <option value="llm-text">文字 API（复用 Harness 模型服务）</option>
              <option value="llm-image">图片 API（OpenAI 兼容）</option>
              <option value="comfyui">本机 ComfyUI</option>
            </select>
          </label>

          {editing.kind === 'llm-image' && (
            <>
              <label className="pa-field pa-field--full">
                <span>Base URL <b aria-hidden="true">*</b></span>
                <input type="url" placeholder="https://api.example.com/v1" value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} />
              </label>
              <label className="pa-field pa-field--full">
                <span>API Key <b aria-hidden="true">*</b></span>
                <span className="pa-input-with-toggle">
                  <input type={showApiKey ? 'text' : 'password'} autoComplete="off" placeholder="sk-..." value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} />
                  <button type="button" className="pa-icon-button" title={showApiKey ? '隐藏' : '显示'} onClick={() => setShowApiKey((v) => !v)}>
                    {showApiKey ? <EyeSlash aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                  </button>
                </span>
              </label>
              <label className="pa-field pa-field--full">
                <span>模型 <b aria-hidden="true">*</b></span>
                <input type="text" placeholder="gpt-image-2.5 或兼容模型名" value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} />
              </label>
            </>
          )}

          {editing.kind === 'llm-text' && (
            <>
              <label className="pa-field pa-field--full">
                <span>Provider（Harness 模型 route）<b aria-hidden="true">*</b></span>
                <input type="text" placeholder="例如 huatu717333" value={editing.provider} onChange={(e) => setEditing({ ...editing, provider: e.target.value })} />
              </label>
              <label className="pa-field pa-field--full">
                <span>模型名 <b aria-hidden="true">*</b></span>
                <input type="text" placeholder="例如 deepseek-flash" value={editing.textModel} onChange={(e) => setEditing({ ...editing, textModel: e.target.value })} />
              </label>
            </>
          )}

          {editing.kind === 'comfyui' && (
            <>
              <label className="pa-field pa-field--full">
                <span>服务地址 <b aria-hidden="true">*</b></span>
                <input type="url" placeholder="http://127.0.0.1:8188" value={editing.server} onChange={(e) => setEditing({ ...editing, server: e.target.value })} />
              </label>
              <div className="pa-imagegen-settings__divider">分离式模型（推荐，如 Qwen-Image-Edit）</div>
              <label className="pa-field pa-field--full">
                <span>UNet（扩散模型）</span>
                <input type="text" placeholder="qwen_image_edit_2511_int8_convrot.safetensors" value={editing.unet} onChange={(e) => setEditing({ ...editing, unet: e.target.value })} />
              </label>
              <label className="pa-field pa-field--full">
                <span>CLIP（文本编码器）</span>
                <input type="text" placeholder="qwen_2.5_vl_7b_fp8_scaled.safetensors" value={editing.clip} onChange={(e) => setEditing({ ...editing, clip: e.target.value })} />
              </label>
              <label className="pa-field pa-field--full">
                <span>VAE</span>
                <input type="text" placeholder="qwen_image_vae.safetensors" value={editing.vae} onChange={(e) => setEditing({ ...editing, vae: e.target.value })} />
              </label>
              <div className="pa-imagegen-settings__divider">或单文件模型</div>
              <label className="pa-field pa-field--full">
                <span>Checkpoint（单文件，可选）</span>
                <input type="text" placeholder="sd.safetensors" value={editing.checkpoint} onChange={(e) => setEditing({ ...editing, checkpoint: e.target.value })} />
              </label>
            </>
          )}

          <div className="pa-imagegen-settings__actions">
            <button type="submit" className="pa-primary-button" disabled={saving}><FloppyDisk aria-hidden="true" size={17} /> {saving ? '保存中…' : '保存'}</button>
            <button type="button" className="pa-secondary-button" onClick={cancelEdit}>取消</button>
          </div>
        </form>
      )}
    </section>
  )
}
