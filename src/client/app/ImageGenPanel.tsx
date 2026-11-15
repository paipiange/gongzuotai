import { ImageSquare, Sparkle, ArrowClockwise, DownloadSimple } from '@phosphor-icons/react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { generateImages, type GeneratedImageResult } from './hostClient'
import { loadSettings } from './imagegenStore'
import { buildImagePrompt, buildPromptSummary } from './promptBuilder'
import {
  stylePresets,
  layoutPresets,
  colorPresets,
  type StylePreset,
  type LayoutPreset,
  type ColorPreset,
} from './stylePresets'

type Provider = 'llm' | 'comfyui'

interface Toast {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

const styleGroups = Array.from(new Set(stylePresets.map((s) => s.group)))

/**
 * 生图工作台：输入主题 → 选风格/排版/主题色 → 调 Host 生图 API → 展示结果。
 * 风格预设来自 handraw-style（小红书社媒卡与公众号信息图排版置顶）。
 */
export function ImageGenPanel({ onToast }: { onToast: Toast }) {
  const [topic, setTopic] = useState('')
  const [styleId, setStyleId] = useState('')
  const [layoutId, setLayoutId] = useState('')
  const [colorId, setColorId] = useState('')
  const [size, setSize] = useState(1024)
  const [count, setCount] = useState(1)
  const [provider, setProvider] = useState<Provider>('llm')
  const [available, setAvailable] = useState<Provider[]>([])
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<GeneratedImageResult[]>([])
  const [lastPrompt, setLastPrompt] = useState('')

  useEffect(() => {
    let cancelled = false
    loadSettings().then(({ summary }) => {
      if (cancelled) return
      const providers: Provider[] = []
      if (summary.llm) providers.push('llm')
      if (summary.comfyui) providers.push('comfyui')
      setAvailable(providers)
      if (providers.length && !providers.includes(provider)) setProvider(providers[0])
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const style = useMemo(() => stylePresets.find((s) => s.id === styleId), [styleId])
  const layout = useMemo(() => layoutPresets.find((l) => l.id === layoutId), [layoutId])
  const color = useMemo(() => colorPresets.find((c) => c.id === colorId), [colorId])

  const canGenerate = topic.trim().length > 0 && available.includes(provider)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!topic.trim()) {
      onToast('请先填写画面主题', 'warning')
      return
    }
    if (!available.includes(provider)) {
      onToast('请先在「设置中心 → 图片 Provider」配置生图后端', 'warning')
      return
    }

    const prompt = buildImagePrompt({ topic, style, layout, color })
    setLastPrompt(prompt)
    setBusy(true)
    try {
      const images = await generateImages({
        provider,
        request: { prompt, count, size },
      })
      setResults(images)
      onToast(`已生成 ${images.length} 张图片`, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '生成失败', 'warning')
    } finally {
      setBusy(false)
    }
  }

  const clearAll = () => {
    setTopic('')
    setStyleId('')
    setLayoutId('')
    setColorId('')
    setResults([])
    setLastPrompt('')
  }

  return (
    <section className="pa-panel pa-imagegen-panel">
      <div className="pa-imagegen-panel__head">
        <div className="pa-setting-card__icon"><ImageSquare aria-hidden="true" size={23} /></div>
        <div>
          <h2>AI 生图</h2>
          <p>选择 handraw-style 风格（小红书 / 公众号排版置顶），一键生成配图。</p>
        </div>
        <button type="button" className="pa-icon-button" onClick={clearAll} title="清空"><ArrowClockwise aria-hidden="true" size={18} /></button>
      </div>

      <form onSubmit={handleSubmit} className="pa-imagegen-panel__form">
        <label className="pa-field pa-field--full">
          <span>画面主题 <b aria-hidden="true">*</b></span>
          <textarea value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={500} placeholder="例如：一只橘猫在窗台晒太阳的治愈插画" />
        </label>

        <label className="pa-field">
          <span>视觉风格</span>
          <select value={styleId} onChange={(event) => setStyleId(event.target.value)}>
            <option value="">不指定（自由发挥）</option>
            {styleGroups.map((group) => (
              <optgroup key={group} label={group}>
                {stylePresets.filter((s) => s.group === group).map((s) => (
                  <option key={s.id} value={s.id}>{s.id} · {s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="pa-field">
          <span>排版（小红书/公众号置顶）</span>
          <select value={layoutId} onChange={(event) => setLayoutId(event.target.value)}>
            <option value="">不指定</option>
            <optgroup label="小红书社媒卡">
              {layoutPresets.filter((l) => l.platform === 'xiaohongshu').map((l) => (
                <option key={l.id} value={l.id}>{l.id} · {l.name}</option>
              ))}
            </optgroup>
            <optgroup label="公众号信息图">
              {layoutPresets.filter((l) => l.platform === 'wechat').map((l) => (
                <option key={l.id} value={l.id}>{l.id} · {l.name}</option>
              ))}
            </optgroup>
            <optgroup label="其他排版（分镜 / 电商 / IP）">
              {layoutPresets.filter((l) => l.platform === 'general').map((l) => (
                <option key={l.id} value={l.id}>{l.id} · {l.name}</option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="pa-field">
          <span>主题色</span>
          <select value={colorId} onChange={(event) => setColorId(event.target.value)}>
            <option value="">不指定</option>
            {colorPresets.map((c) => (
              <option key={c.id} value={c.id}>{c.id} · {c.name}</option>
            ))}
          </select>
        </label>

        <label className="pa-field">
          <span>尺寸</span>
          <select value={size} onChange={(event) => setSize(Number(event.target.value))}>
            <option value={512}>512×512</option>
            <option value={768}>768×768</option>
            <option value={1024}>1024×1024</option>
          </select>
        </label>

        <label className="pa-field">
          <span>数量</span>
          <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
            <option value={1}>1 张</option>
            <option value={2}>2 张</option>
            <option value={3}>3 张</option>
            <option value={4}>4 张</option>
          </select>
        </label>

        <div className="pa-imagegen-panel__provider" role="group" aria-label="生图后端">
          <span>后端</span>
          <button type="button" data-active={provider === 'llm'} data-disabled={!available.includes('llm')} onClick={() => available.includes('llm') && setProvider('llm')}>大模型 API</button>
          <button type="button" data-active={provider === 'comfyui'} data-disabled={!available.includes('comfyui')} onClick={() => available.includes('comfyui') && setProvider('comfyui')}>本机 ComfyUI</button>
        </div>

        <div className="pa-imagegen-panel__actions">
          <button type="submit" className="pa-primary-button" disabled={busy || !canGenerate}>
            <Sparkle aria-hidden="true" size={18} weight="fill" />{busy ? '生成中…' : '开始生成'}
          </button>
          <span className="pa-imagegen-panel__hint">
            {available.length ? (style || layout || color ? `预设：${buildPromptSummary({ topic, style, layout, color })}` : '未选择风格预设') : '请先在设置中心配置生图后端'}
          </span>
        </div>
      </form>

      {lastPrompt && (
        <details className="pa-imagegen-panel__prompt">
          <summary>查看本次提示词</summary>
          <pre>{lastPrompt}</pre>
        </details>
      )}

      {results.length > 0 && (
        <div className="pa-imagegen-panel__results">
          {results.map((image) => (
            <figure key={image.id} className="pa-imagegen-panel__result">
              <img src={`/api/paipiange.asset?id=${encodeURIComponent(image.id)}`} alt={`生成图 ${image.id}`} loading="lazy" />
              <figcaption>
                <span>{formatBytes(image.sizeBytes)}</span>
                <a className="pa-link-button" href={`/api/paipiange.asset?id=${encodeURIComponent(image.id)}`} download target="_blank" rel="noreferrer"><DownloadSimple aria-hidden="true" size={14} />下载</a>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
