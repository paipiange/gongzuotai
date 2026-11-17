import { Cpu, Lightning, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { deleteBackend, listBackends, testBackend, type Backend } from './hostClient'
import { CLOUD_PRESETS, EMPTY_FORM, KIND_META, summaryOf, toForm, type BackendForm, type Toast } from './backendMeta'
import { BackendFormModal } from './BackendFormModal'

/**
 * 统一后端管理：文字与图片生成后端在同一列表，可新增 / 编辑 / 删除 / 测试切换。
 * 新增/编辑的表单与校验逻辑下沉到 BackendFormModal，本组件只负责列表与状态编排。
 */
export function BackendManager({ onToast }: { onToast: Toast }) {
  const [backends, setBackends] = useState<Backend[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hostReachable, setHostReachable] = useState(true)
  const [editing, setEditing] = useState<BackendForm | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
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
    setEditing(toForm(backend))
  }

  const cancelEdit = () => {
    setEditing(null)
    setEditingId(null)
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

      {editing && <BackendFormModal initial={editing} editingId={editingId} onClose={cancelEdit} onSaved={reload} onToast={onToast} />}
    </section>
  )
}
