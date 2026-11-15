import { useEffect, useState } from 'react'
import { Sparkle } from '@phosphor-icons/react'
import { getTextGenConfig, listTextGenProviders, saveTextGenConfig } from './hostClient'

/**
 * Text-gen model configuration. Reuses the Harness `llm` service, so only the
 * provider route and model id are stored — no API key is ever kept here (the
 * key lives in Harness's own adapter config).
 *
 * Providers/models are discovered from `ctx.llm.listProviders()` / `listModels()`
 * and offered as dropdowns; manual entry remains available as a fallback.
 */
export function TextGenSettings({ onToast }: { onToast: (message: string, tone?: 'info' | 'success' | 'warning') => void }) {
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [providers, setProviders] = useState<string[]>([])
  const [models, setModels] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [hostReachable, setHostReachable] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([getTextGenConfig(), listTextGenProviders()])
      .then(([config, discovered]) => {
        if (cancelled) return
        setProviders(discovered.providers)
        setModels(discovered.models)
        // Prefer the saved provider if it still exists; otherwise fall back to
        // the first discovered route (the Host does the same at generate time).
        const savedProvider = discovered.providers.includes(config.provider) ? config.provider : (discovered.providers[0] ?? '')
        setProvider(savedProvider)
        const savedModel = config.model
        const catalog = discovered.models[savedProvider] ?? []
        setModel(catalog.includes(savedModel) ? savedModel : (catalog[0] ?? ''))
      })
      .catch(() => {
        if (cancelled) return
        setHostReachable(false)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onProviderChange = (next: string) => {
    setProvider(next)
    setModel((models[next] ?? [])[0] ?? '')
  }

  const save = async () => {
    if (!provider.trim() || !model.trim()) {
      onToast('请选择 Provider 与模型', 'warning')
      return
    }
    setSaving(true)
    try {
      const config = await saveTextGenConfig({ provider: provider.trim(), model: model.trim() })
      setProvider(config.provider)
      setModel(config.model)
      onToast('文本模型配置已保存', 'success')
    } catch {
      onToast('保存失败，Host 未连接', 'warning')
    } finally {
      setSaving(false)
    }
  }

  const catalog = models[provider] ?? []

  return (
    <section className="pa-panel pa-imagegen-settings">
      <div className="pa-imagegen-settings__head">
        <div className="pa-setting-card__icon"><Sparkle aria-hidden="true" size={23} /></div>
        <div>
          <h2>文本模型</h2>
          <p>复用 Harness 已配置的模型适配器，插件不保存任何 API 密钥。</p>
        </div>
      </div>

      {!hostReachable && (
        <p className="pa-form-notice">无法连接本地服务，文本生成暂不可用。</p>
      )}

      <div className="pa-imagegen-settings__fields">
        <label className="pa-field">
          <span>Provider 路由</span>
          {providers.length > 0 ? (
            <select value={provider} onChange={(event) => onProviderChange(event.target.value)} disabled={!loaded}>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="deepseek-official" disabled={!loaded} />
          )}
        </label>
        <label className="pa-field">
          <span>模型</span>
          {catalog.length > 0 ? (
            <select value={model} onChange={(event) => setModel(event.target.value)} disabled={!loaded}>
              {catalog.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-chat" disabled={!loaded} />
          )}
        </label>
      </div>
      <button type="button" className="pa-secondary-button" onClick={save} disabled={saving || !loaded}>
        {saving ? '保存中…' : '保存配置'}
      </button>
    </section>
  )
}
