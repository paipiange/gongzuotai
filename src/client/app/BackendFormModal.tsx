import { Eye, EyeSlash, FloppyDisk, Lightning, ListMagnifyingGlass, X } from '@phosphor-icons/react'
import { FormEvent, useState } from 'react'
import { createBackend, fetchBackendModels, testBackend, updateBackend, type BackendKind } from './hostClient'
import { buildBackendPayload, buildTestInput, type BackendForm, type Toast } from './backendMeta'
import { ModelSuggestions } from './ModelSuggestions'

/**
 * 新增 / 编辑后端的弹窗表单。自身持有表单状态与校验、连接测试、模型拉取逻辑，
 * 保存成功后通过 onSaved 通知父级刷新列表。
 */
export function BackendFormModal({ initial, editingId, onClose, onSaved, onToast }: {
  initial: BackendForm
  editingId: string | null
  onClose: () => void
  onSaved: () => Promise<void>
  onToast: Toast
}) {
  const [editing, setEditing] = useState<BackendForm>(initial)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testingForm, setTestingForm] = useState(false)
  const [formTestResult, setFormTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelFilter, setModelFilter] = useState('')

  const handleFormTest = async () => {
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

  const toggleModel = (target: 'llm-image' | 'llm-text', model: string) => {
    const list = target === 'llm-image' ? editing.llmModels : editing.textModels
    const has = list.includes(model)
    const next = has ? list.filter((m) => m !== model) : [...list, model]
    if (target === 'llm-image') {
      setEditing({ ...editing, llmModels: next, model: editing.model.trim() || model })
    } else {
      setEditing({ ...editing, textModels: next, textModel: editing.textModel.trim() || model })
    }
  }

  const selectAllModels = (target: 'llm-image' | 'llm-text') => {
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
      const payload = buildBackendPayload(editing)
      if (editingId) {
        await updateBackend(editingId, payload)
        onToast('后端已更新', 'success')
      } else {
        await createBackend(payload)
        onToast('后端已新增', 'success')
      }
      onClose()
      await onSaved()
    } catch {
      onToast('保存失败，本地服务未连接', 'warning')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pa-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="pa-modal pa-backend-form" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
        <div className="pa-modal__head">
          <h3>{editingId ? '编辑后端' : '新增后端'}</h3>
          <button type="button" className="pa-icon-button" onClick={onClose}><X aria-hidden="true" size={18} /></button>
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
          <button type="button" className="pa-secondary-button" onClick={onClose}>取消</button>
        </div>
      </form>
    </div>
  )
}
