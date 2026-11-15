import { useEffect, useState } from 'react'
import { Sparkle } from '@phosphor-icons/react'
import { getTextGenConfig, saveTextGenConfig } from './hostClient'

/**
 * Text-gen model configuration. Reuses the Harness `llm` service, so only the
 * provider route and model id are stored — no API key is ever kept here (the
 * key lives in Harness's own adapter config).
 */
export function TextGenSettings({ onToast }: { onToast: (message: string, tone?: 'info' | 'success' | 'warning') => void }) {
  const [provider, setProvider] = useState('deepseek-official')
  const [model, setModel] = useState('deepseek-chat')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    getTextGenConfig()
      .then((config) => {
        if (cancelled) return
        setProvider(config.provider)
        setModel(config.model)
      })
      .catch(() => {
        // Host unreachable: keep the local defaults; the generate call will
        // surface a clear error instead of fabricating success.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    if (!provider.trim() || !model.trim()) {
      onToast('请填写 provider 与 model', 'warning')
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

  return (
    <section className="pa-panel pa-imagegen-settings">
      <div className="pa-imagegen-settings__head">
        <div className="pa-setting-card__icon"><Sparkle aria-hidden="true" size={23} /></div>
        <div>
          <h2>文本模型</h2>
          <p>复用 Harness 已配置的模型适配器，插件不保存任何 API 密钥。</p>
        </div>
      </div>
      <div className="pa-imagegen-settings__fields">
        <label className="pa-field">
          <span>Provider 路由</span>
          <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="deepseek-official" disabled={!loaded} />
        </label>
        <label className="pa-field">
          <span>模型</span>
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="deepseek-chat" disabled={!loaded} />
        </label>
      </div>
      <button type="button" className="pa-secondary-button" onClick={save} disabled={saving || !loaded}>
        {saving ? '保存中…' : '保存配置'}
      </button>
    </section>
  )
}
