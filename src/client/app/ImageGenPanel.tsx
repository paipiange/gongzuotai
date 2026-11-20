import { ImageSquare, Sparkle, ArrowClockwise, DownloadSimple, CheckCircle, UploadSimple, CaretRight, ArrowSquareOut, X } from '@phosphor-icons/react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { cancelTask, enqueueImages, listBackends, setCreationCover, assetUrl, waitForTask, type Backend, type GeneratedImageResult, type TaskRecord } from './hostClient'
import { buildImagePrompt, buildPromptSummary } from './promptBuilder'
import { StylePicker } from './StylePicker'
import { LayoutPicker } from './LayoutPicker'
import { ColorPicker } from './ColorPicker'
import { Lightbox, absoluteAssetUrl } from './Lightbox'
import { extractImageFilesFromClipboard, readImageAsDataUrl } from './pasteImages'
import { GroupedModelPicker, backendToGroup, decodePick, type ModelGroup } from './GroupedModelPicker'
import {
  stylePresets,
  layoutPresets,
  colorPresets,
  type StylePreset,
  type ColorPreset,
} from './stylePresets'
import { storedTaskOrigin, taskResultImages } from './taskResume'

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
export function ImageGenPanel({ onToast, creationId, resumeTask = null, onResumeConsumed, onOpenSettings }: {
  onToast: Toast
  creationId?: string
  resumeTask?: TaskRecord | null
  onResumeConsumed?: () => void
  onOpenSettings?: () => void
}) {
  const [topic, setTopic] = useState('')
  const [styleId, setStyleId] = useState('')
  const [layoutId, setLayoutId] = useState('')
  const [colorId, setColorId] = useState('')
  const [size, setSize] = useState(1024)
  const [count, setCount] = useState(1)
  const [backends, setBackends] = useState<Backend[]>([])
  const [modelPick, setModelPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<GeneratedImageResult[]>([])
  const [lastPrompt, setLastPrompt] = useState('')
  const [coverId, setCoverId] = useState<string | null>(null)
  const [coverBusy, setCoverBusy] = useState(false)
  const [referenceImages, setReferenceImages] = useState<string[]>([])
  const [denoise, setDenoise] = useState(0.7)
  const [stylePickerOpen, setStylePickerOpen] = useState(false)
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handledResumeTaskRef = useRef<string | null>(null)
  const activeRequestRef = useRef<{ controller: AbortController; clientRequestId: string; taskId?: string } | null>(null)
  const [generationProgress, setGenerationProgress] = useState<{ completed: number; total: number; status: string } | null>(null)

  useEffect(() => {
    if (!resumeTask || handledResumeTaskRef.current === resumeTask.id) return
    handledResumeTaskRef.current = resumeTask.id
    const state = storedTaskOrigin(resumeTask)?.state ?? {}
    setTopic(String(state.topic ?? resumeTask.input.prompt ?? ''))
    if (typeof state.styleId === 'string') setStyleId(state.styleId)
    if (typeof state.layoutId === 'string') setLayoutId(state.layoutId)
    if (typeof state.colorId === 'string') setColorId(state.colorId)
    if (Number.isFinite(Number(state.size))) setSize(Number(state.size))
    if (Number.isFinite(Number(state.count))) setCount(Math.max(1, Math.min(4, Number(state.count))))
    if (typeof state.modelPick === 'string') setModelPick(state.modelPick)
    if (Number.isFinite(Number(state.denoise))) setDenoise(Number(state.denoise))
    setLastPrompt(String(resumeTask.input.prompt ?? ''))
    setResults(taskResultImages(resumeTask))
    onResumeConsumed?.()
  }, [onResumeConsumed, resumeTask])

  useEffect(() => {
    let cancelled = false
    listBackends().then((list) => {
      if (cancelled) return
      const imageBackends = list.filter((b) => b.kind === 'llm-image' || b.kind === 'comfyui')
      setBackends(imageBackends)
      if (imageBackends.length) setModelPick((prev) => {
        const gid = decodePick(prev)?.groupId
        if (imageBackends.some((b) => b.id === gid)) return prev
        const first = backendToGroup(imageBackends[0])
        return first.models[0] ? `${first.id}::${first.models[0]}` : ''
      })
    }).catch(() => {
      if (!cancelled) setBackends([])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const decoded = decodePick(modelPick)
  const currentBackend = backends.find((b) => b.id === decoded?.groupId)
  const modelId = decoded?.model ?? ''
  const isComfyui = currentBackend?.kind === 'comfyui'

  // 分组结构（每个后端一组，组内为该后端支持的模型）。
  const modelGroups = useMemo<ModelGroup[]>(() => backends.map(backendToGroup), [backends])

  const style = useMemo(() => stylePresets.find((s) => s.id === styleId), [styleId])
  const layout = useMemo(() => layoutPresets.find((l) => l.id === layoutId), [layoutId])
  const color = useMemo(() => colorPresets.find((c) => c.id === colorId), [colorId])

  const canGenerate = topic.trim().length > 0 && backends.length > 0 && !!currentBackend

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!topic.trim()) {
      onToast('请先填写画面主题', 'warning')
      return
    }
    if (!currentBackend) {
      onToast('请先在「设置中心 → 后端管理」添加一个图片后端', 'warning')
      return
    }

    const prompt = buildImagePrompt({ topic, style, layout, color })
    const controller = new AbortController()
    const clientRequestId = crypto.randomUUID()
    activeRequestRef.current = { controller, clientRequestId }
    setLastPrompt(prompt)
    setBusy(true)
    setGenerationProgress({ completed: 0, total: 1, status: '排队中' })
    setCoverId(null)
    try {
      const queued = await enqueueImages({
        backendId: currentBackend.id,
        origin: {
          kind: 'studio',
          id: 'image',
          label: 'AI 图片生成',
          state: { topic, styleId, layoutId, colorId, size, count, modelPick, denoise },
        },
        clientRequestId,
        request: {
          prompt,
          count,
          size,
          ...(modelId ? { model: modelId } : {}),
          ...(referenceImages.length ? { images: referenceImages, denoise } : {}),
        },
        sourceCreationId: creationId,
      })
      if (activeRequestRef.current?.clientRequestId === clientRequestId) activeRequestRef.current.taskId = queued.id
      const completed = await waitForTask(queued.id, (task) => {
        const progress = task.result.progress as { completed?: number; total?: number } | undefined
        setGenerationProgress({
          completed: Number(progress?.completed) || (task.status === 'success' ? 1 : 0),
          total: Number(progress?.total) || 1,
          status: task.status === 'queued' ? '排队中' : task.status === 'paused' ? '已暂停' : task.status === 'running' ? `生成中（第 ${task.attempt}/${task.maxAttempts} 次）` : '已完成',
        })
        const partial = taskResultImages(task)
        if (partial.length) setResults(partial)
      }, controller.signal)
      const images = taskResultImages(completed)
      setResults(images)
      onToast(`已生成 ${images.length} 张图片`, 'success')
    } catch (cause) {
      onToast(controller.signal.aborted ? '已取消生成' : cause instanceof Error ? cause.message : '生成失败', controller.signal.aborted ? 'info' : 'warning')
    } finally {
      if (activeRequestRef.current?.clientRequestId === clientRequestId) activeRequestRef.current = null
      setBusy(false)
      setGenerationProgress(null)
    }
  }

  const cancelGeneration = async () => {
    const active = activeRequestRef.current
    if (!active) return
    active.controller.abort()
    try {
      await cancelTask(active.taskId ? { id: active.taskId } : { clientRequestId: active.clientRequestId })
    } catch {
      // 请求可能在 Host 建立任务前被取消；AbortController 仍会终止客户端等待。
    }
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = extractImageFilesFromClipboard(event.clipboardData)
    if (files.length === 0) return
    const hasText = Array.from(event.clipboardData?.items ?? []).some((item) => item.kind === 'string')
    if (!hasText) event.preventDefault()
    for (const file of files) {
      try {
        const dataUrl = await readImageAsDataUrl(file)
        setReferenceImages((prev) => [...prev, dataUrl])
      } catch (cause) {
        onToast(cause instanceof Error ? cause.message : '图片读取失败', 'warning')
      }
    }
  }

  const handleReferenceUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    const next: string[] = []
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        onToast('请选择图片文件', 'warning')
        continue
      }
      if (file.size > 16 * 1024 * 1024) {
        onToast('参考图不能超过 16MB', 'warning')
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : null
        if (dataUrl) setReferenceImages((prev) => [...prev, dataUrl])
      }
      reader.readAsDataURL(file)
    }
    // Allow re-selecting the same files.
    event.target.value = ''
  }

  const removeReference = (index: number) => {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index))
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
    setReferenceImages([])
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
          <textarea value={topic} onChange={(event) => setTopic(event.target.value)} onPaste={handlePaste} maxLength={500} placeholder="例如：一只橘猫在窗台晒太阳的治愈插画，也可直接 Ctrl+V 粘贴参考图" />
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
          <button type="button" className="pa-style-trigger" onClick={() => setLayoutPickerOpen(true)}>
            {layout ? (
              <>
                <LayoutPreviewThumb layoutId={layout.id} category={layout.category} />
                <span className="pa-style-trigger__label">
                  <b>{layout.id}</b>
                  <span>{layout.name}</span>
                </span>
              </>
            ) : (
              <span className="pa-style-trigger__placeholder">不指定（自由发挥）</span>
            )}
            <CaretRight aria-hidden="true" size={16} className="pa-style-trigger__caret" />
          </button>
          {layout && <small className="pa-style-trigger__clear" role="button" tabIndex={0} onClick={() => setLayoutId('')} onKeyDown={(e) => e.key === 'Enter' && setLayoutId('')}>清除选择</small>}
        </label>

        <label className="pa-field">
          <span>主题色</span>
          <button type="button" className="pa-style-trigger" onClick={() => setColorPickerOpen(true)}>
            {color ? (
              <>
                <ColorPreviewThumb colorId={color.id} />
                <span className="pa-style-trigger__label">
                  <b>{color.id}</b>
                  <span>{color.name}</span>
                </span>
              </>
            ) : (
              <span className="pa-style-trigger__placeholder">不指定（自由发挥）</span>
            )}
            <CaretRight aria-hidden="true" size={16} className="pa-style-trigger__caret" />
          </button>
          {color && <small className="pa-style-trigger__clear" role="button" tabIndex={0} onClick={() => setColorId('')} onKeyDown={(e) => e.key === 'Enter' && setColorId('')}>清除选择</small>}
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

        <div className="pa-imagegen-panel__repaint">
          <label className="pa-field">
            <span>参考图（可选，可多张，支持 Ctrl+V 粘贴）</span>
            <div className="pa-imagegen-panel__upload">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handleReferenceUpload} className="pa-visually-hidden" />
              <button type="button" className="pa-secondary-button" onClick={() => fileInputRef.current?.click()}>
                <UploadSimple aria-hidden="true" size={16} />{referenceImages.length ? '继续添加参考图' : '上传参考图'}
              </button>
              {referenceImages.length > 0 && (
                <button type="button" className="pa-icon-button" aria-label="清除全部参考图" title="清除全部参考图" onClick={() => setReferenceImages([])}><ArrowClockwise aria-hidden="true" size={16} /></button>
              )}
            </div>
            {referenceImages.length > 0 && (
              <div className="pa-imagegen-panel__ref-list">
                {referenceImages.map((img, index) => (
                  <div key={index} className="pa-imagegen-panel__ref-item">
                    <img src={img} alt={`参考图 ${index + 1}`} className="pa-imagegen-panel__ref-preview" />
                    <button type="button" className="pa-icon-button pa-imagegen-panel__ref-remove" aria-label={`移除参考图 ${index + 1}`} title="移除" onClick={() => removeReference(index)}><X aria-hidden="true" size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </label>
          {isComfyui && referenceImages.length > 0 && (
            <label className="pa-field">
              <span>重绘强度 <b>{denoise.toFixed(1)}</b></span>
              <input type="range" min={0.1} max={1} step={0.05} value={denoise} onChange={(event) => setDenoise(Number(event.target.value))} />
              <small>越小越接近原图，越大改动越多</small>
            </label>
          )}
        </div>

        <label className="pa-field pa-field--full">
          <span>模型</span>
          <GroupedModelPicker
            groups={modelGroups}
            value={modelPick}
            onChange={setModelPick}
            placeholder="选择图片模型"
            emptyHint="暂无可用后端，请到设置中心添加"
            onAdd={onOpenSettings}
          />
        </label>

        <div className="pa-imagegen-panel__actions">
          <button type="submit" className="pa-primary-button" disabled={busy || !canGenerate}>
            <Sparkle aria-hidden="true" size={18} weight="fill" />{busy ? '生成中…' : '开始生成'}
          </button>
          {busy && <button type="button" className="pa-secondary-button" onClick={() => void cancelGeneration()}><X aria-hidden="true" size={16} />取消生成</button>}
          <span className="pa-imagegen-panel__hint">
            {backends.length ? (style || layout || color ? `预设：${buildPromptSummary({ topic, style, layout, color })}` : '未选择风格预设') : '请先在「设置中心 → 后端管理」添加图片后端'}
          </span>
        </div>
        {busy && generationProgress && (
          <div className="pa-generation-progress" role="status" aria-live="polite">
            <div><span>{generationProgress.status}</span><b>{generationProgress.completed}/{generationProgress.total}</b></div>
            <progress value={generationProgress.completed} max={generationProgress.total} />
          </div>
        )}
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

      {layoutPickerOpen && (
        <LayoutPicker value={layoutId} onChange={setLayoutId} onClose={() => setLayoutPickerOpen(false)} />
      )}

      {colorPickerOpen && (
        <ColorPicker value={colorId} onChange={setColorId} onClose={() => setColorPickerOpen(false)} />
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

const LAYOUT_ROOT = 'https://raw.githubusercontent.com/yang0/handraw-style/master/images/layouts'
const LAYOUT_DIR: Record<string, string> = {
  'social-card': 'social-cards',
  infographic: 'infographics',
  'comic-storyboard': 'comic-storyboards',
  ecommerce: 'ecommerce',
  'ip-character': 'ip-characters',
}

/** 触发器里展示当前选中排版的缩略图（失败时显示占位）。 */
function LayoutPreviewThumb({ layoutId, category }: { layoutId: string; category: string }) {
  const [failed, setFailed] = useState(false)
  const dir = LAYOUT_DIR[category]
  const url = dir ? `${LAYOUT_ROOT}/${dir}/${layoutId}.webp` : null

  if (!url || failed) {
    return (
      <span className="pa-style-trigger__thumb pa-style-trigger__thumb--fallback">
        <ImageSquare aria-hidden="true" size={18} />
      </span>
    )
  }
  return <img className="pa-style-trigger__thumb" src={url} alt={layoutId} onError={() => setFailed(true)} />
}

const COLOR_ROOT = 'https://raw.githubusercontent.com/yang0/handraw-style/master/images/colors'

/** 触发器里展示当前选中主题色的色卡缩略图（失败时显示占位）。 */
function ColorPreviewThumb({ colorId }: { colorId: string }) {
  const [failed, setFailed] = useState(false)
  const url = `${COLOR_ROOT}/${colorId}.webp`

  if (failed) {
    return (
      <span className="pa-style-trigger__thumb pa-style-trigger__thumb--fallback">
        <ImageSquare aria-hidden="true" size={18} />
      </span>
    )
  }
  return <img className="pa-style-trigger__thumb" src={url} alt={colorId} onError={() => setFailed(true)} />
}
