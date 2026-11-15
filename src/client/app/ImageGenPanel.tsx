import { ImageSquare, Sparkle, ArrowClockwise, DownloadSimple, CheckCircle, UploadSimple, CaretRight, ArrowSquareOut } from '@phosphor-icons/react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { generateImages, listBackends, setCreationCover, assetUrl, type Backend, type GeneratedImageResult } from './hostClient'
import { buildImagePrompt, buildPromptSummary } from './promptBuilder'
import { StylePicker } from './StylePicker'
import { Lightbox, absoluteAssetUrl } from './Lightbox'
import {
  stylePresets,
  layoutPresets,
  colorPresets,
  type StylePreset,
  type LayoutPreset,
  type ColorPreset,
} from './stylePresets'

interface Toast {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

/**
 * 生图工作台：输入主题 → 选风格/排版/主题色 → 调 Host 生图 API → 展示结果。
 * 风格预设来自 handraw-style（小红书社媒卡与公众号信息图排版置顶）。
 *
 * 后端来自「后端管理」里配置的图片后端（图片 API / 本机 ComfyUI），
 * 生成时按所选后端 id 调用。
 */
export function ImageGenPanel({ onToast, creationId }: { onToast: Toast; creationId?: string }) {
  const [topic, setTopic] = useState('')
  const [styleId, setStyleId] = useState('')
  const [layoutId, setLayoutId] = useState('')
  const [colorId, setColorId] = useState('')
  const [size, setSize] = useState(1024)
  const [count, setCount] = useState(1)
  const [backends, setBackends] = useState<Backend[]>([])
  const [backendId, setBackendId] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<GeneratedImageResult[]>([])
  const [lastPrompt, setLastPrompt] = useState('')
  const [coverId, setCoverId] = useState<string | null>(null)
  const [coverBusy, setCoverBusy] = useState(false)
  const [referenceImage, setReferenceImage] = useState<string | null>(null)
  const [denoise, setDenoise] = useState(0.7)
  const [stylePickerOpen, setStylePickerOpen] = useState(false)
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    listBackends().then((list) => {
      if (cancelled) return
      const imageBackends = list.filter((b) => b.kind === 'llm-image' || b.kind === 'comfyui')
      setBackends(imageBackends)
      if (imageBackends.length) setBackendId((prev) => (imageBackends.some((b) => b.id === prev) ? prev : imageBackends[0].id))
    }).catch(() => {
      if (!cancelled) setBackends([])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const currentBackend = backends.find((b) => b.id === backendId)
  const isComfyui = currentBackend?.kind === 'comfyui'

  const style = useMemo(() => stylePresets.find((s) => s.id === styleId), [styleId])
  const layout = useMemo(() => layoutPresets.find((l) => l.id === layoutId), [layoutId])
  const color = useMemo(() => colorPresets.find((c) => c.id === colorId), [colorId])

  const canGenerate = topic.trim().length > 0 && backends.length > 0 && !!backendId

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!topic.trim()) {
      onToast('请先填写画面主题', 'warning')
      return
    }
    if (!backendId) {
      onToast('请先在「设置中心 → 后端管理」添加一个图片后端', 'warning')
      return
    }

    const prompt = buildImagePrompt({ topic, style, layout, color })
    setLastPrompt(prompt)
    setBusy(true)
    setCoverId(null)
    try {
      const images = await generateImages({
        backendId,
        request: {
          prompt,
          count,
          size,
          ...(referenceImage && isComfyui ? { image: referenceImage, denoise } : {}),
        },
        sourceCreationId: creationId,
      })
      setResults(images)
      onToast(`已生成 ${images.length} 张图片`, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '生成失败', 'warning')
    } finally {
      setBusy(false)
    }
  }

  const handleReferenceUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onToast('请选择图片文件', 'warning')
      return
    }
    if (file.size > 16 * 1024 * 1024) {
      onToast('参考图不能超过 16MB', 'warning')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setReferenceImage(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.readAsDataURL(file)
    // Allow re-selecting the same file.
    event.target.value = ''
  }

  const applyAsCover = async (imageId: string) => {
    if (!creationId) {
      onToast('请先保存草稿，才能设为封面', 'warning')
      return
    }
    setCoverBusy(true)
    try {
      await setCreationCover(creationId, imageId)
      setCoverId(imageId)
      onToast('已设为封面', 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '设为封面失败', 'warning')
    } finally {
      setCoverBusy(false)
    }
  }

  const clearAll = () => {
    setTopic('')
    setStyleId('')
    setLayoutId('')
    setColorId('')
    setResults([])
    setLastPrompt('')
    setCoverId(null)
    setReferenceImage(null)
    setDenoise(0.7)
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
          <button type="button" className="pa-style-trigger" onClick={() => setStylePickerOpen(true)}>
            {style ? (
              <>
                <StylePreviewThumb id={style.id} />
                <span className="pa-style-trigger__label">
                  <b>{style.id}</b>
                  <span>{style.name}</span>
                </span>
              </>
            ) : (
              <span className="pa-style-trigger__placeholder">不指定（自由发挥）</span>
            )}
            <CaretRight aria-hidden="true" size={16} className="pa-style-trigger__caret" />
          </button>
          {style && <small className="pa-style-trigger__clear" role="button" tabIndex={0} onClick={() => setStyleId('')} onKeyDown={(e) => e.key === 'Enter' && setStyleId('')}>清除选择</small>}
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

        {isComfyui && (
          <div className="pa-imagegen-panel__repaint">
            <label className="pa-field">
              <span>参考图（重绘底图，可选）</span>
              <div className="pa-imagegen-panel__upload">
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleReferenceUpload} className="pa-visually-hidden" />
                <button type="button" className="pa-secondary-button" onClick={() => fileInputRef.current?.click()}>
                  <UploadSimple aria-hidden="true" size={16} />{referenceImage ? '更换参考图' : '上传参考图'}
                </button>
                {referenceImage && (
                  <button type="button" className="pa-icon-button" aria-label="清除参考图" title="清除参考图" onClick={() => setReferenceImage(null)}><ArrowClockwise aria-hidden="true" size={16} /></button>
                )}
              </div>
              {referenceImage && <img src={referenceImage} alt="参考图预览" className="pa-imagegen-panel__ref-preview" />}
            </label>
            {referenceImage && (
              <label className="pa-field">
                <span>重绘强度 <b>{denoise.toFixed(1)}</b></span>
                <input type="range" min={0.1} max={1} step={0.05} value={denoise} onChange={(event) => setDenoise(Number(event.target.value))} />
                <small>越小越接近原图，越大改动越多</small>
              </label>
            )}
          </div>
        )}

        <label className="pa-field pa-field--full">
          <span>后端</span>
          <select value={backendId} onChange={(event) => setBackendId(event.target.value)}>
            {backends.length === 0 && <option value="">（无可用后端，请到设置中心添加）</option>}
            {backends.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.kind === 'comfyui' ? '（本机 ComfyUI）' : '（图片 API）'}</option>
            ))}
          </select>
        </label>

        <div className="pa-imagegen-panel__actions">
          <button type="submit" className="pa-primary-button" disabled={busy || !canGenerate}>
            <Sparkle aria-hidden="true" size={18} weight="fill" />{busy ? '生成中…' : '开始生成'}
          </button>
          <span className="pa-imagegen-panel__hint">
            {backends.length ? (style || layout || color ? `预设：${buildPromptSummary({ topic, style, layout, color })}` : '未选择风格预设') : '请先在「设置中心 → 后端管理」添加图片后端'}
          </span>
        </div>
      </form>

      {lastPrompt && (
        <details className="pa-imagegen-panel__prompt">
          <summary>查看本次提示词</summary>
          <pre>{lastPrompt}</pre>
        </details>
      )}

      {stylePickerOpen && (
        <StylePicker value={styleId} onChange={setStyleId} onClose={() => setStylePickerOpen(false)} />
      )}

      {results.length > 0 && (
        <div className="pa-imagegen-panel__results">
          {results.map((image) => (
            <figure key={image.id} className="pa-imagegen-panel__result">
              <button type="button" className="pa-imagegen-panel__result-img" onClick={() => setLightboxId(image.id)} title="点击查看大图">
                <img src={assetUrl(image.id)} alt={`生成图 ${image.id}`} loading="lazy" />
              </button>
              <figcaption>
                <span>{formatBytes(image.sizeBytes)}</span>
                <div className="pa-imagegen-panel__result-actions">
                  {creationId && (
                    <button
                      type="button"
                      className="pa-link-button"
                      disabled={coverBusy}
                      data-active={coverId === image.id}
                      onClick={() => applyAsCover(image.id)}
                    >
                      <CheckCircle aria-hidden="true" size={14} weight={coverId === image.id ? 'fill' : 'regular'} />
                      {coverId === image.id ? '已设为封面' : '设为封面'}
                    </button>
                  )}
                  <button type="button" className="pa-link-button" onClick={() => setLightboxId(image.id)} title="查看大图">查看大图</button>
                  <a className="pa-link-button" href={absoluteAssetUrl(image.id)} target="_blank" rel="noreferrer" title="在默认浏览器打开"><ArrowSquareOut aria-hidden="true" size={14} />浏览器打开</a>
                  <a className="pa-link-button" href={assetUrl(image.id)} download target="_blank" rel="noreferrer"><DownloadSimple aria-hidden="true" size={14} />下载</a>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {lightboxId && <Lightbox assetId={lightboxId} onClose={() => setLightboxId(null)} />}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const PREVIEW_GROUPS = new Set(['FA', 'FB', 'FC', 'FD', 'FE', 'FF', 'FG', 'FH', 'FI'])
const PREVIEW_ROOT = 'https://raw.githubusercontent.com/yang0/handraw-style/master/images/individual'

/** 触发器里展示当前选中风格的缩略图（仅 FA~FI 有预览图，其余显示占位）。 */
function StylePreviewThumb({ id }: { id: string }) {
  const [failed, setFailed] = useState(false)
  const group = id.split('-')[0]
  const hasPreview = PREVIEW_GROUPS.has(group)
  const url = hasPreview ? `${PREVIEW_ROOT}/${group}/${id}.webp` : null

  if (!url || failed) {
    return (
      <span className="pa-style-trigger__thumb pa-style-trigger__thumb--fallback">
        <ImageSquare aria-hidden="true" size={18} />
      </span>
    )
  }
  return <img className="pa-style-trigger__thumb" src={url} alt={id} onError={() => setFailed(true)} />
}
