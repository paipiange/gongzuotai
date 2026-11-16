import { ChatText, ImageSquare, Cpu, Plus, PencilSimple, Trash, FloppyDisk, X, Eye, EyeSlash, Lightning, ListMagnifyingGlass } from '@phosphor-icons/react'
import { FormEvent, useEffect, useState } from 'react'
import {
  createBackend,
  deleteBackend,
  listBackends,
  testBackend,
  updateBackend,
  fetchBackendModels,
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

const EMPTY_FORM: BackendForm = {
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
function buildTestInput(editing: BackendForm): { kind: 'comfyui' | 'llm-image' | 'llm-text'; llm?: { baseUrl: string; apiKey: string; model: string }; comfyui?: { server: string }; text?: { provider?: string; baseUrl?: string; apiKey?: string; model: string } } | null {
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

function summaryOf(backend: Backend): string {
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
  // Form-scoped test state (test a config before/while editing, not just a saved backend).
  const [testingForm, setTestingForm] = useState(false)
  const [formTestResult, setFormTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null)
  // Model-list fetching (a picker for the model fields).
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelFilter, setModelFilter] = useState('')

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

  /** Reset the transient, form-scoped state shared across create/edit sessions. */
  const resetFormScopedState = () => {
    setModelOptions([])
    setModelFilter('')
    setFormTestResult(null)
    setShowApiKey(false)
  }

  const startCreate = () => {
    resetFormScopedState()
    setEditingId(null)
    setEditing({ ...EMPTY_FORM })
  }

  const startEdit = (backend: Backend) => {
    resetFormScopedState()
    setEditingId(backend.id)
    setEditing({
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
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    setEditingId(null)
    setFormTestResult(null)
    setModelOptions([])
    setModelFilter('')
  }

  /** Test the connection using the values currently entered in the form. */
  const handleFormTest = async () => {
    if (!editing) return
    const input = buildTestInput(editing)
    if (!input) {
      setFormTestResult({ ok: false, message: '请先填写完整后再测试：图片 API 需要 Base URL；文字 API 需要 Provider/模型名 或 第三方 Base URL；ComfyUI 需要服务地址。' })
      return
    }
    if (editing.kind === 'llm-image' && !editing.apiKey.trim()) {
      setFormTestResult({ ok: false, message: '请先填写 API Key（部分网关无 Key 会直接拒绝访问）。' })
      return
    }
    setTestingForm(true)
    setFormTestResult(null)
    try {
      const result = await testBackend(input)
      setFormTestResult(result)
    } catch (cause) {
      setFormTestResult({ ok: false, message: cause instanceof Error ? cause.message : '测试失败，本地服务未连接' })
    } finally {
      setTestingForm(false)
    }
  }

  const handleFetchModels = async (target: 'llm-image' | 'llm-text') => {
    if (!editing) return
    setFetchingModels(true)
    setModelOptions([])
    setModelFilter('')
    try {
      if (target === 'llm-image') {
        const baseUrl = editing.baseUrl.trim().replace(/\/+$/, '')
        if (!baseUrl) {
          onToast('请先填写 Base URL，才能拉取模型列表', 'warning')
          return
        }
        const result = await fetchBackendModels({ kind: 'llm-image', baseUrl, apiKey: editing.apiKey.trim() || undefined, backendId: editingId ?? undefined })
        if (result.ok) setModelOptions(result.models)
        else onToast(result.message ?? '拉取失败', 'warning')
      } else {
        const baseUrl = editing.textBaseUrl.trim().replace(/\/+$/, '')
        if (baseUrl) {
          const result = await fetchBackendModels({ kind: 'llm-text', baseUrl, apiKey: editing.textApiKey.trim() || undefined, backendId: editingId ?? undefined })
          if (result.ok) setModelOptions(result.models)
          else onToast(result.message ?? '拉取失败', 'warning')
        } else {
          const provider = editing.provider.trim()
          if (!provider) {
            onToast('请先填写 Provider（或第三方 Base URL），才能拉取模型列表', 'warning')
            return
          }
          const result = await fetchBackendModels({ kind: 'llm-text', provider })
          if (result.ok) setModelOptions(result.models)
          else onToast(result.message ?? '拉取失败', 'warning')
        }
      }
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '拉取失败', 'warning')
    } finally {
      setFetchingModels(false)
    }
  }

  const filteredModelOptions = modelFilter.trim()
    ? modelOptions.filter((m) => m.toLowerCase().includes(modelFilter.trim().toLowerCase()))
    : modelOptions

  /** Toggle a model in the backend's stored model group (and default it as the primary model). */
  const toggleModel = (target: 'llm-image' | 'llm-text', model: string) => {
    if (!editing) return
    const list = target === 'llm-image' ? editing.llmModels : editing.textModels
    const has = list.includes(model)
    const next = has ? list.filter((m) => m !== model) : [...list, model]
    if (target === 'llm-image') {
      setEditing({ ...editing, llmModels: next, model: editing.model.trim() || model })
    } else {
      setEditing({ ...editing, textModels: next, textModel: editing.textModel.trim() || model })
    }
  }

  /** Select all currently filtered model options into the backend's model group. */
  const selectAllModels = (target: 'llm-image' | 'llm-text') => {
    if (!editing) return
    const candidates = filteredModelOptions
    if (candidates.length === 0) return
    const existing = target === 'llm-image' ? editing.llmModels : editing.textModels
    const merged = Array.from(new Set([...existing, ...candidates]))
    const firstModel = merged[0] ?? ''
    if (target === 'llm-image') {
      setEditing({ ...editing, llmModels: merged, model: editing.model.trim() || firstModel })
    } else {
      setEditing({ ...editing, textModels: merged, textModel: editing.textModel.trim() || firstModel })
    }
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
      if (!editing.baseUrl.trim() || !editing.model.trim()) {
        onToast('请填写图片 API 的 Base URL 与模型名', 'warning')
        return
      }
      // On edit the apiKey arrives blank (host redacts it); only require it when
      // creating a brand-new backend. The host keeps the real key and re-fills it.
      if (!editingId && !editing.apiKey.trim()) {
        onToast('请填写图片 API 的 API Key', 'warning')
        return
      }
    } else if (kind === 'llm-text') {
      const hasDirect = editing.textBaseUrl.trim()
      if (hasDirect) {
        if (!editing.textModel.trim()) {
          onToast('请填写文字 API 的模型名', 'warning')
          return
        }
      } else if (!editing.provider.trim() || !editing.textModel.trim()) {
        onToast('请填写文字 API 的 Provider 与模型名（或改用第三方 Base URL）', 'warning')
        return
      }
    } else {
      if (!editing.server.trim()) {
        onToast('请填写 ComfyUI 服务地址', 'warning')
        return
      }
      // Model fields are optional: when left blank, generation falls back to
      // the recommended Qwen-Image-Edit defaults (mirrored in the placeholders).
    }

    setSaving(true)
    try {
      const common = {
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
      } else if (backend.kind === 'llm-text' && backend.text) {
        result = await testBackend({ kind: 'llm-text', text: { provider: backend.text.provider, baseUrl: backend.text.baseUrl, apiKey: backend.text.apiKey ?? '', model: backend.text.model } })
      } else {
        onToast('后端配置不完整，无法测试', 'info')
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
    const testable = backend.kind === 'comfyui' || backend.kind === 'llm-image' || backend.kind === 'llm-text'
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
        <div className="pa-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) cancelEdit() }}>
          <form className="pa-modal pa-backend-form" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
          <div className="pa-modal__head">
            <h3>{editingId ? '编辑后端' : '新增后端'}</h3>
            <button type="button" className="pa-icon-button" onClick={cancelEdit}><X aria-hidden="true" size={18} /></button>
          </div>

          <div className="pa-modal__body">
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
                <span className="pa-input-with-toggle">
                  <input type="text" placeholder="gpt-image-2.5 或兼容模型名" value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} />
                  <button type="button" className="pa-icon-button" title="拉取支持的模型" disabled={fetchingModels} onClick={() => handleFetchModels('llm-image')}>
                    <ListMagnifyingGlass aria-hidden="true" size={17} />
                  </button>
                </span>
                <ModelSuggestions
                  options={filteredModelOptions}
                  filter={modelFilter}
                  onFilterChange={setModelFilter}
                  selected={editing.llmModels}
                  onToggle={(m) => toggleModel('llm-image', m)}
                  onPickPrimary={(m) => setEditing({ ...editing, model: m })}
                  onSelectAll={() => selectAllModels('llm-image')}
                  loading={fetchingModels}
                />
              </label>
            </>
          )}

          {editing.kind === 'llm-text' && (
            <>
              <div className="pa-imagegen-settings__divider">方式一：复用 Harness 模型服务（填 Provider + 模型名）</div>
              <label className="pa-field pa-field--full">
                <span>Provider（Harness 模型 route）</span>
                <input type="text" placeholder="例如 huatu717333" value={editing.provider} onChange={(e) => setEditing({ ...editing, provider: e.target.value })} />
              </label>
              <div className="pa-imagegen-settings__divider">方式二：第三方 API 直连（填 Base URL + API Key + 模型名）</div>
              <label className="pa-field pa-field--full">
                <span>Base URL</span>
                <input type="url" placeholder="https://api.example.com/v1（OpenAI 兼容 /chat/completions）" value={editing.textBaseUrl} onChange={(e) => setEditing({ ...editing, textBaseUrl: e.target.value })} />
              </label>
              <label className="pa-field pa-field--full">
                <span>API Key</span>
                <span className="pa-input-with-toggle">
                  <input type={showApiKey ? 'text' : 'password'} autoComplete="off" placeholder="sk-..." value={editing.textApiKey} onChange={(e) => setEditing({ ...editing, textApiKey: e.target.value })} />
                  <button type="button" className="pa-icon-button" title={showApiKey ? '隐藏' : '显示'} onClick={() => setShowApiKey((v) => !v)}>
                    {showApiKey ? <EyeSlash aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                  </button>
                </span>
              </label>
              <label className="pa-field pa-field--full">
                <span>模型名 <b aria-hidden="true">*</b></span>
                <span className="pa-input-with-toggle">
                  <input type="text" placeholder="例如 deepseek-chat / gpt-4o-mini" value={editing.textModel} onChange={(e) => setEditing({ ...editing, textModel: e.target.value })} />
                  <button type="button" className="pa-icon-button" title="拉取支持的模型" disabled={fetchingModels} onClick={() => handleFetchModels('llm-text')}>
                    <ListMagnifyingGlass aria-hidden="true" size={17} />
                  </button>
                </span>
                <ModelSuggestions
                  options={filteredModelOptions}
                  filter={modelFilter}
                  onFilterChange={setModelFilter}
                  selected={editing.textModels}
                  onToggle={(m) => toggleModel('llm-text', m)}
                  onPickPrimary={(m) => setEditing({ ...editing, textModel: m })}
                  onSelectAll={() => selectAllModels('llm-text')}
                  loading={fetchingModels}
                />
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
                <span>UNet（扩散模型，留空用推荐）</span>
                <input type="text" placeholder="qwen_image_edit_2511_int8_convrot.safetensors" value={editing.unet} onChange={(e) => setEditing({ ...editing, unet: e.target.value })} />
              </label>
              <label className="pa-field pa-field--full">
                <span>CLIP（文本编码器，留空用推荐）</span>
                <input type="text" placeholder="qwen_2.5_vl_7b_fp8_scaled.safetensors" value={editing.clip} onChange={(e) => setEditing({ ...editing, clip: e.target.value })} />
              </label>
              <label className="pa-field pa-field--full">
                <span>VAE（留空用推荐）</span>
                <input type="text" placeholder="qwen_image_vae.safetensors" value={editing.vae} onChange={(e) => setEditing({ ...editing, vae: e.target.value })} />
              </label>
              <div className="pa-imagegen-settings__divider">或单文件模型</div>
              <label className="pa-field pa-field--full">
                <span>Checkpoint（单文件，可选）</span>
                <input type="text" placeholder="sd.safetensors" value={editing.checkpoint} onChange={(e) => setEditing({ ...editing, checkpoint: e.target.value })} />
              </label>
            </>
          )}

          <div className="pa-backend-form__test">
            <button
              type="button"
              className="pa-secondary-button"
              disabled={testingForm}
              onClick={handleFormTest}
            >
              <Lightning aria-hidden="true" size={16} /> {testingForm ? '测试中…' : '测试连接'}
            </button>
            {formTestResult && (
              <div className="pa-backend-test-result" data-ok={formTestResult.ok}>
                <span>{formTestResult.ok ? '✓' : '✕'}</span>
                <span>
                  {formTestResult.message}
                  {formTestResult.latencyMs !== undefined ? `（${formTestResult.latencyMs}ms）` : ''}
                </span>
              </div>
            )}
          </div>
          </div>

          <div className="pa-modal__footer">
            <button type="submit" className="pa-primary-button" disabled={saving}><FloppyDisk aria-hidden="true" size={17} /> {saving ? '保存中…' : '保存'}</button>
            <button type="button" className="pa-secondary-button" onClick={cancelEdit}>取消</button>
          </div>
        </form>
        </div>
      )}
    </section>
  )
}

/** 模型候选列表：拉取后展示，可勾选多个存入后端分组，支持关键字过滤与全选。 */
function ModelSuggestions(props: {
  options: string[]
  filter: string
  onFilterChange: (value: string) => void
  selected: string[]
  onToggle: (model: string) => void
  onPickPrimary: (model: string) => void
  onSelectAll: () => void
  loading: boolean
}) {
  const { options, filter, onFilterChange, selected, onToggle, onPickPrimary, onSelectAll, loading } = props
  if (loading) {
    return <div className="pa-model-suggest__loading">正在拉取模型列表…</div>
  }
  if (options.length === 0 && selected.length === 0) return null
  const allSelected = options.length > 0 && options.every((m) => selected.includes(m))
  return (
    <div className="pa-model-suggest">
      {selected.length > 0 && (
        <div className="pa-model-suggest__selected">
          <span className="pa-model-suggest__selected-label">已选模型（{selected.length}）：</span>
          {selected.map((model) => (
            <button key={model} type="button" className="pa-model-chip" onClick={() => onToggle(model)} title={`移除 ${model}`}>
              {model} <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      )}
      {options.length > 0 && (
        <>
          <div className="pa-model-suggest__toolbar">
            <input
              type="text"
              className="pa-model-suggest__filter"
              placeholder="搜索模型名…"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
            />
            <button type="button" className="pa-model-suggest__select-all" onClick={onSelectAll}>
              {allSelected ? '全选 ✓' : '全选'}
            </button>
          </div>
          <ul className="pa-model-suggest__list">
            {options.slice(0, 100).map((model) => {
              const checked = selected.includes(model)
              return (
                <li key={model}>
                  <button type="button" className="pa-model-suggest__item" onClick={() => onToggle(model)}>
                    <span className="pa-model-suggest__check" data-checked={checked}>{checked ? '✓' : ''}</span>
                    <span className="pa-model-suggest__name">{model}</span>
                    <span className="pa-model-suggest__set" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onPickPrimary(model) }} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), onPickPrimary(model))}>设为主模型</span>
                  </button>
                </li>
              )
            })}
            {options.length === 0 && <li className="pa-model-suggest__empty">无匹配模型</li>}
          </ul>
        </>
      )}
    </div>
  )
}
