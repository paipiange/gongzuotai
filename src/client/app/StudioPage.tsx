import {
  ArrowLeft,
  Copy,
  DownloadSimple,
  Fire,
  FloppyDisk,
  PaperPlaneTilt,
  PencilSimple,
  Sparkle,
  VideoCamera,
  X,
} from '@phosphor-icons/react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { StudioId } from './data'
import { loadStudioDraft, saveStudioDraft, type CreationDraft, type CreationRecord, type CreationStatus } from './workspaceStore'
import { ImageGenPanel } from './ImageGenPanel'
import { MarkdownEditor } from './MarkdownEditor'
import { assetUrl, cancelTask, enqueueTextGeneration, enqueueVideoGeneration, exportCreation, fetchVideoStyles, listBackends, waitForTask, VIDEO_VOICES, type Backend, type TaskRecord, type VideoStyleLibrary } from './hostClient'
import { GroupedModelPicker, backendToGroup, decodePick, type ModelGroup } from './GroupedModelPicker'
import { extractImageFilesFromClipboard, readImageAsDataUrl } from './pasteImages'
import { SectionHeading, studioLabels, type ToastState } from './primitives'
import { storedTaskOrigin } from './taskResume'

export function StudioPage({ studio, initialCreation, resumeTask = null, onResumeConsumed, onBack, onSave, onToast }: {
  studio: StudioId
  initialCreation: CreationRecord | null
  resumeTask?: TaskRecord | null
  onResumeConsumed?: () => void
  onBack: () => void
  onSave: (draft: CreationDraft) => Promise<CreationRecord | null>
  onToast: (message: string, tone?: ToastState['tone']) => void
}) {
  const [creationId, setCreationId] = useState<string | undefined>(initialCreation?.id)
  const [title, setTitle] = useState(initialCreation?.title ?? '')
  const [topic, setTopic] = useState(initialCreation?.topic ?? '')
  const [content, setContent] = useState(initialCreation?.content ?? '')
  const [style, setStyle] = useState(initialCreation?.style ?? '')
  const [requirement, setRequirement] = useState(initialCreation?.requirement ?? '')
  const [platform, setPlatform] = useState('微信公众号')
  const [tags, setTags] = useState(initialCreation?.tags ?? [])
  const [referenceImages, setReferenceImages] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [textBackends, setTextBackends] = useState<Backend[]>([])
  const [textPick, setTextPick] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const clientRequestIdRef = useRef<string | null>(null)
  const handledResumeTaskRef = useRef<string | null>(null)
  const isVideo = studio === 'video'
  const isImage = studio === 'image'
  const isText = !isVideo && !isImage
  const isHeadline = studio === 'headline'

  // ---- Video studio state ----
  const [videoAspect, setVideoAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9')
  const [videoDuration, setVideoDuration] = useState(5)
  const [videoFps, setVideoFps] = useState(24)
  const [videoEngine, setVideoEngine] = useState<'llm' | 'comfyui' | 'remotion'>('llm')
  const [videoBackendId, setVideoBackendId] = useState('')
  const [videoStyleId, setVideoStyleId] = useState('')
  const [videoMultiScene, setVideoMultiScene] = useState(false)
  const [videoSceneCount, setVideoSceneCount] = useState(3)
  const [videoVoice, setVideoVoice] = useState('zh-CN-XiaoxiaoNeural')
  const [videoMusic, setVideoMusic] = useState(true)
  const [videoStyleLibrary, setVideoStyleLibrary] = useState<VideoStyleLibrary>({ categories: [], styles: [] })
  const [comfyBackends, setComfyBackends] = useState<Backend[]>([])
  const [videoProgress, setVideoProgress] = useState<{ stage: string; text: string }>({ stage: 'idle', text: '' })
  const [videoResultId, setVideoResultId] = useState<string | null>(null)
  const [videoUsedFallback, setVideoUsedFallback] = useState(false)

  useEffect(() => {
    if (!resumeTask || isImage || handledResumeTaskRef.current === resumeTask.id) return
    handledResumeTaskRef.current = resumeTask.id
    const state = storedTaskOrigin(resumeTask)?.state ?? {}
    setTitle(String(state.title ?? ''))
    setTopic(String(state.topic ?? resumeTask.input.topic ?? ''))
    setContent(String(state.content ?? resumeTask.result.text ?? resumeTask.input.subtitle ?? ''))
    setStyle(String(state.style ?? resumeTask.input.style ?? ''))
    setRequirement(String(state.requirement ?? resumeTask.input.requirement ?? ''))
    setTags(Array.isArray(state.tags) ? state.tags.filter((item): item is string => typeof item === 'string') : [])
    if (typeof state.textPick === 'string') setTextPick(state.textPick)
    if (typeof state.platform === 'string' && state.platform) setPlatform(state.platform)
    if (studio === 'video') {
      if (state.videoAspect === '16:9' || state.videoAspect === '9:16' || state.videoAspect === '1:1') setVideoAspect(state.videoAspect)
      if (Number.isFinite(Number(state.videoDuration))) setVideoDuration(Number(state.videoDuration))
      if (Number.isFinite(Number(state.videoFps))) setVideoFps(Number(state.videoFps))
      if (state.videoEngine === 'llm' || state.videoEngine === 'comfyui' || state.videoEngine === 'remotion') setVideoEngine(state.videoEngine)
      if (typeof state.videoBackendId === 'string') setVideoBackendId(state.videoBackendId)
      if (typeof state.videoStyleId === 'string') setVideoStyleId(state.videoStyleId)
      if (typeof state.videoMultiScene === 'boolean') setVideoMultiScene(state.videoMultiScene)
      if (Number.isFinite(Number(state.videoSceneCount))) setVideoSceneCount(Number(state.videoSceneCount))
      if (typeof resumeTask.result.assetId === 'string') {
        setVideoResultId(resumeTask.result.assetId)
        setVideoProgress({ stage: 'done', text: '已恢复上次生成的视频' })
      }
    }
    onResumeConsumed?.()
  }, [isImage, onResumeConsumed, resumeTask, studio])

  const handlePasteReference = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
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

  useEffect(() => {
    setCreationId(initialCreation?.id)
    if (initialCreation) {
      setTitle(initialCreation.title)
      setTopic(initialCreation.topic)
      setContent(initialCreation.content)
      setStyle(initialCreation.style ?? '')
      setRequirement(initialCreation.requirement ?? '')
      setTags(initialCreation.tags ?? [])
    } else if (isText || isImage || isVideo) {
      // No saved creation: restore any in-progress form cached from a previous
      // visit so switching pages never loses the user's input.
      const cached = loadStudioDraft(studio)
      if (cached) {
        setTitle(cached.title)
        setTopic(cached.topic)
        setContent(cached.content)
        setStyle(cached.style)
        setRequirement(cached.requirement)
        setTags(cached.tags)
        if (cached.videoStyleId) setVideoStyleId(cached.videoStyleId)
        setVideoMultiScene(cached.videoMultiScene === true)
        if (Number.isFinite(cached.videoSceneCount)) setVideoSceneCount(cached.videoSceneCount as number)
        if (cached.videoVoice) setVideoVoice(cached.videoVoice)
        setVideoMusic(cached.videoMusic !== false)
      }
    }
  }, [initialCreation, studio])

  // Load text backends (llm-text) for the model picker.
  useEffect(() => {
    let cancelled = false
    listBackends().then((list) => {
      if (cancelled) return
      const text = list.filter((b) => b.kind === 'llm-text')
      setTextBackends(text)
      if (text.length) setTextPick((prev) => {
        const gid = decodePick(prev)?.groupId
        if (text.some((b) => b.id === gid)) return prev
        const first = backendToGroup(text[0])
        return first.models[0] ? `${first.id}::${first.models[0]}` : ''
      })
      const comfy = list.filter((b) => b.kind === 'comfyui')
      setComfyBackends(comfy)
      if (comfy.length) setVideoBackendId((prev) => (comfy.some((b) => b.id === prev) ? prev : comfy[0].id))
    }).catch(() => {
      if (!cancelled) setTextBackends([])
    })
    // 拉取视频风格资产库（99 种原创风格），供风格选择器渲染。
    fetchVideoStyles().then((lib) => {
      if (!cancelled) setVideoStyleLibrary(lib)
    }).catch(() => {
      /* 风格库拉取失败时静默降级：选择器为空，多幕/风格注入不生效。 */
    })
    return () => {
      cancelled = true
    }
  }, [])

  const decodedTextPick = decodePick(textPick)
  const currentTextBackend = textBackends.find((b) => b.id === decodedTextPick?.groupId)
  const textModelId = decodedTextPick?.model ?? ''

  // 分组结构（每个文字后端一组，组内为该后端支持的模型）。
  const textModelGroups = useMemo<ModelGroup[]>(() => textBackends.map(backendToGroup), [textBackends])

  // Debounced auto-save: once a draft has an id, persist edits silently so the
  // user never loses work. Skips video (never persisted) and avoids the toast
  // used by the explicit "save" buttons.
  useEffect(() => {
    if (isVideo || !creationId) return
    if (!title.trim() && !topic.trim()) return
    const timer = window.setTimeout(() => {
      void onSave({
        id: creationId,
        studio,
        title,
        topic,
        content,
        style,
        requirement,
        tags,
      }).then((record) => {
        if (record) setCreationId(record.id)
      })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [creationId, title, topic, content, style, requirement, tags, studio, isVideo])

  // Persist the in-progress form to localStorage so switching pages (which
  // unmounts StudioPage) never loses the user's input — even before a draft
  // has been saved and given an id.
  useEffect(() => {
    if (!title.trim() && !topic.trim() && !content.trim()) return
    saveStudioDraft(studio, { title, topic, content, style, requirement, tags, videoStyleId, videoMultiScene, videoSceneCount, videoVoice, videoMusic })
  }, [title, topic, content, style, requirement, tags, studio, videoStyleId, videoMultiScene, videoSceneCount, videoVoice, videoMusic])

  const save = async (status: CreationStatus = initialCreation?.status ?? 'draft') => {
    if (isVideo) {
      onToast('视频成品可直接在画布播放与下载，暂不支持存为草稿', 'info')
      return null
    }
    if (!topic.trim() && !title.trim()) {
      onToast('请至少填写标题或创作主题', 'warning')
      return null
    }
    const saved = await onSave({
      id: creationId,
      studio,
      title,
      topic,
      content,
      style,
      requirement,
      status,
      tags,
    })
    if (saved) setCreationId(saved.id)
    return saved
  }

  const runGenerate = async () => {
    if (!topic.trim()) {
      onToast('请先填写创作主题', 'warning')
      return
    }
    if (isVideo) {
      await submitVideo()
      return
    }
    if (isImage) {
      onToast('请先在设置中心配置图片 Provider', 'warning')
      return
    }
    // Text studios: stream a real generation from the Harness llm service.
    if (generating) {
      abortRef.current?.abort()
      if (clientRequestIdRef.current) void cancelTask({ clientRequestId: clientRequestIdRef.current }).catch(() => undefined)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const clientRequestId = crypto.randomUUID()
    clientRequestIdRef.current = clientRequestId
    setGenerating(true)
    setContent('')
    try {
      const queued = await enqueueTextGeneration({
          provider: currentTextBackend?.text?.provider ?? '',
          model: textModelId || (currentTextBackend?.text?.model ?? ''),
          baseUrl: currentTextBackend?.text?.baseUrl ?? '',
          apiKey: currentTextBackend?.text?.apiKey ?? '',
          backendId: currentTextBackend?.id ?? '',
          studio: studio as 'article' | 'headline' | 'marketing' | 'xiaohongshu',
          topic: topic.trim(),
          style,
          requirement,
          platform: isHeadline ? platform : undefined,
          images: isHeadline && referenceImages.length > 0 ? referenceImages : undefined,
          origin: {
            kind: 'studio',
            id: studio,
            label: studioLabels[studio],
            state: { title, topic, content, style, requirement, tags, textPick, platform },
          },
          clientRequestId,
          sourceCreationId: creationId,
      })
      const completed = await waitForTask(queued.id, (task) => {
        if (typeof task.result.text === 'string') setContent(task.result.text)
      }, controller.signal)
      if (typeof completed.result.text === 'string') setContent(completed.result.text)
      onToast('生成完成，内容已填入画布', 'success')
    } catch (cause) {
      if (controller.signal.aborted) {
        onToast('已取消生成', 'info')
      } else {
        onToast(cause instanceof Error ? cause.message : '生成失败，请确认 Harness 已配置文本模型', 'warning')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (clientRequestIdRef.current === clientRequestId) clientRequestIdRef.current = null
      setGenerating(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void runGenerate()
  }

  // 快捷键：Ctrl/Cmd+Enter 触发生成，Ctrl/Cmd+S 保存草稿（图片工作室的
  // 生成/保存走独立面板，不响应快捷键）。用 ref 引用最新函数避免重复绑定。
  const isImageRef = useRef(isImage)
  isImageRef.current = isImage
  const runGenerateRef = useRef(runGenerate)
  runGenerateRef.current = runGenerate
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImageRef.current) return
      if (!event.metaKey && !event.ctrlKey) return
      if (event.key === 'Enter') {
        event.preventDefault()
        void runGenerateRef.current()
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveRef.current('draft')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /** Video studio: run the local pipeline (LLM → HTML → render, or ComfyUI frames → FFmpeg). */
  const submitVideo = async () => {
    if (generating) {
      abortRef.current?.abort()
      if (clientRequestIdRef.current) void cancelTask({ clientRequestId: clientRequestIdRef.current }).catch(() => undefined)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const clientRequestId = crypto.randomUUID()
    clientRequestIdRef.current = clientRequestId
    setGenerating(true)
    setVideoResultId(null)
    setVideoUsedFallback(false)
    const isComfy = videoEngine === 'comfyui'
    const isRemotion = videoEngine === 'remotion'
    setVideoProgress({ stage: 'coding', text: isComfy ? '正在由 ComfyUI 生成视频帧序列…' : isRemotion ? '正在由 Remotion 双引擎生成视频…' : '正在由模型编写视频动画…' })
    try {
      const queued = await enqueueVideoGeneration({
          topic: topic.trim(),
          subtitle: content.trim() || undefined,
          style,
          styleId: videoStyleId || undefined,
          multiScene: videoMultiScene,
          sceneCount: videoMultiScene ? videoSceneCount : undefined,
          voice: videoMultiScene ? videoVoice : undefined,
          music: videoMultiScene ? videoMusic : undefined,
          aspectRatio: videoAspect,
          durationSec: videoDuration,
          fps: videoFps,
          provider: currentTextBackend?.text?.provider ?? '',
          model: textModelId || (currentTextBackend?.text?.model ?? ''),
          engine: videoEngine,
          backendId: isComfy ? (videoBackendId || undefined) : undefined,
          remotionStyle: isRemotion ? (videoStyleId || style || 'tech') : undefined,
          remotionQuality: isRemotion ? '1080p' : undefined,
          origin: {
            kind: 'studio',
            id: 'video',
            label: studioLabels.video,
            state: {
              title,
              topic,
              content,
              style,
              requirement,
              tags,
              textPick,
              videoAspect,
              videoDuration,
              videoFps,
              videoEngine,
              videoBackendId,
              videoStyleId,
              videoMultiScene,
              videoSceneCount,
              videoVoice,
              videoMusic,
            },
          },
          clientRequestId,
          sourceCreationId: creationId,
      })
      const completed = await waitForTask(queued.id, (task) => {
          const event = task.result.progress as { stage?: string; message?: string; round?: number; frame?: number; total?: number } | undefined
          switch (event?.stage) {
            case 'coding':
              setVideoProgress({ stage: 'coding', text: event.message ?? (isComfy ? '正在生成帧序列…' : '正在编写动画…') })
              break
            case 'repair':
              setVideoProgress({ stage: 'repair', text: event.message ?? `正在修复代码（第 ${event.round}/3 轮）…` })
              break
            case 'render':
              setVideoProgress({ stage: 'render', text: `逐帧渲染 ${event.frame ?? 0}/${event.total ?? 0}` })
              break
            case 'comfy':
              setVideoProgress({ stage: 'comfy', text: `ComfyUI 出帧 ${event.frame ?? 0}/${event.total ?? 0}` })
              break
            case 'encode':
              setVideoProgress({ stage: 'encode', text: event.message ?? '正在合成 MP4…' })
              break
            default:
              if (task.status === 'queued') setVideoProgress({ stage: 'coding', text: '任务已进入后台队列，等待执行…' })
              break
          }
      }, controller.signal)
      if (typeof completed.result.assetId === 'string') setVideoResultId(completed.result.assetId)
      setVideoUsedFallback(completed.result.usedFallback === true)
      setVideoProgress({ stage: 'done', text: '视频生成完成' })
      onToast('视频生成完成', 'success')
    } catch (cause) {
      if (controller.signal.aborted) {
        onToast('已取消生成', 'info')
      } else {
        onToast(cause instanceof Error ? cause.message : '视频生成失败', 'warning')
        setVideoProgress({ stage: 'error', text: cause instanceof Error ? cause.message : '生成失败' })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (clientRequestIdRef.current === clientRequestId) clientRequestIdRef.current = null
      setGenerating(false)
    }
  }

  const copyContent = async () => {
    const value = content.trim() || topic.trim()
    if (!value) {
      onToast('当前没有可复制的内容', 'warning')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      onToast('内容已复制到剪贴板', 'success')
    } catch {
      onToast('复制失败，请手动选择内容', 'warning')
    }
  }

  const exportDraft = async () => {
    if (!content.trim() && !topic.trim()) {
      onToast('请先填写并保存内容', 'warning')
      return
    }
    // Prefer the Host-side export (Markdown/HTML/ZIP written to the exports
    // directory); fall back to a client-side Markdown blob when not saved.
    if (creationId) {
      try {
        const blob = await exportCreation(creationId, 'zip')
        triggerDownload(blob, `${(title.trim() || topic.trim() || '草稿').slice(0, 40)}.zip`)
        onToast('已导出为 ZIP（含 Markdown 与 HTML）', 'success')
        return
      } catch (cause) {
        onToast(cause instanceof Error ? cause.message : '导出失败，已降级为本地导出', 'warning')
      }
    }
    const body = `# ${title.trim() || topic.trim() || '未命名草稿'}\n\n主题：${topic.trim() || '未填写'}\n\n${content.trim()}`
    triggerDownload(new Blob([body], { type: 'text/markdown;charset=utf-8' }), 'paipiange-draft.md')
    onToast('草稿已导出为 Markdown', 'success')
  }

  const triggerDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  if (isHeadline) {
    return (
      <div className="pa-page pa-studio-page">
        <div className="pa-studio-heading">
          <button type="button" className="pa-icon-button" aria-label="返回 AI 创作" onClick={onBack}><ArrowLeft aria-hidden="true" size={19} /></button>
          <div><span className="pa-overline">CREATION STUDIO</span><h1>{studioLabels[studio]}</h1><p>粘贴文字或图文，选择平台与模型，一键生成 10 个高点击爆款标题。</p></div>
        </div>
        <div className="pa-studio-layout">
          <form className="pa-panel pa-studio-form pa-headline-form" onSubmit={submit}>
            <SectionHeading title="创作参数" />
            <label className="pa-field">
              <span>模型</span>
              <GroupedModelPicker
                groups={textModelGroups}
                value={textPick}
                onChange={setTextPick}
                placeholder="选择文字模型"
                emptyHint="暂无可用的文字后端"
              />
              {textBackends.length === 0 && <small>未配置文字后端，将使用 Harness 默认模型。可在「设置中心 → 后端管理」添加。</small>}
            </label>
            <label className="pa-field">
              <span>发布平台</span>
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                <option value="微信公众号">微信公众号</option>
                <option value="小红书">小红书</option>
                <option value="抖音">抖音</option>
                <option value="今日头条">今日头条</option>
              </select>
            </label>
            <label className="pa-field">
              <span>图文内容 <b aria-hidden="true">*</b></span>
              <textarea value={topic} onChange={(event) => setTopic(event.target.value)} onPaste={handlePasteReference} rows={9} placeholder={'粘贴或输入你想写标题的图文内容…\n\n支持直接粘贴图片（Ctrl+V），图片会与文字一起发给多模态模型理解。'} />
              <small>{topic.length} 字{referenceImages.length > 0 ? ` · ${referenceImages.length} 张参考图` : ''}</small>
            </label>
            {referenceImages.length > 0 && (
              <div className="pa-imagegen-panel__ref-list">
                {referenceImages.map((img, index) => (
                  <div key={index} className="pa-imagegen-panel__ref-item">
                    <img src={img} alt={`参考图 ${index + 1}`} className="pa-imagegen-panel__ref-preview" />
                    <button type="button" className="pa-icon-button pa-imagegen-panel__ref-remove" aria-label={`移除参考图 ${index + 1}`} title="移除" onClick={() => setReferenceImages((prev) => prev.filter((_, i) => i !== index))}><X aria-hidden="true" size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            {referenceImages.length > 0 && <small>图片将作为多模态内容发给模型（需选用支持视觉的文字后端）。</small>}
            <button type="submit" className="pa-primary-button pa-studio-submit" disabled={generating}>
              <Sparkle aria-hidden="true" size={18} weight="fill" />{generating ? '停止生成' : '生成爆款标题'}
            </button>
            <p className="pa-form-notice">默认按所选平台风格生成，模型会从 15 个候选里筛选出 10 个可直接发布的标题。</p>
          </form>
          <section className="pa-panel pa-studio-canvas">
            <div className="pa-studio-canvas__toolbar">
              <span>标题生成结果</span>
              <div><button type="button" className="pa-icon-button" aria-label="复制" onClick={copyContent}><Copy aria-hidden="true" size={18} /></button></div>
            </div>
            {generating ? (
              <div className="pa-studio-canvas__empty"><Sparkle aria-hidden="true" size={40} weight="duotone" /><strong>正在生成爆款标题…</strong><p>模型正在深度理解图文，挖掘传播切入点。</p></div>
            ) : content.trim() ? (
              <div className="pa-headline-result">{content}</div>
            ) : (
              <div className="pa-studio-canvas__empty"><Fire aria-hidden="true" size={40} weight="duotone" /><strong>还没有生成结果</strong><p>在左侧粘贴图文、选择平台与模型，点击「生成爆款标题」。</p></div>
            )}
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="pa-page pa-studio-page">
      <div className="pa-studio-heading">
        <button type="button" className="pa-icon-button" aria-label="返回 AI 创作" onClick={onBack}><ArrowLeft aria-hidden="true" size={19} /></button>
        <div><span className="pa-overline">CREATION STUDIO</span><h1>{studioLabels[studio]}</h1><p>{isVideo ? '输入主题，由模型编写动画并在本机逐帧渲染成片（本地出片，不依赖视频供应商）。' : isImage ? '输入主题并选择风格，一键生成配图（handraw-style 风格库）。' : '填写创作要求，一键调用 Harness 文本模型生成，逐字流式填入画布。'}</p></div>
      </div>
      {isImage ? (
        <div className="pa-studio-image">
          {/* 图片创作（草稿标题 + 保存草稿）已暂时注释，仅保留 AI 生图部分 */}
          {/* <form className="pa-panel pa-studio-form pa-studio-form--compact" onSubmit={(event) => { event.preventDefault(); void save('draft') }}>
            <SectionHeading title="图片创作" />
            <label className="pa-field"><span>草稿标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：春日猫片封面" /></label>
            <div className="pa-studio-save-row">
              <button type="submit" className="pa-secondary-button" disabled={isVideo}><FloppyDisk aria-hidden="true" size={17} />保存草稿</button>
              {creationId && <span className="pa-form-notice">已关联草稿，生成图可一键设为封面。</span>}
            </div>
          </form> */}
          <ImageGenPanel onToast={onToast} creationId={creationId} resumeTask={resumeTask} onResumeConsumed={onResumeConsumed} />
        </div>
      ) : (
      <div className="pa-studio-layout">
        <form className="pa-panel pa-studio-form" onSubmit={submit}>
          <SectionHeading title="创作参数" />
          <label className="pa-field"><span>创作类型</span><select defaultValue={studio}><option value={studio}>{studioLabels[studio]}</option></select></label>
          <label className="pa-field">
            <span>模型</span>
            <GroupedModelPicker
              groups={textModelGroups}
              value={textPick}
              onChange={setTextPick}
              placeholder="选择文字模型"
              emptyHint="暂无可用的文字后端"
            />
            {textBackends.length === 0 && <small>未配置文字后端，将使用 Harness 默认模型。可在「设置中心 → 后端管理」添加。</small>}
          </label>
          <label className="pa-field"><span>草稿标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：春日品牌故事初稿" /></label>
          <label className="pa-field"><span>主题 / 关键词 <b aria-hidden="true">*</b></span><textarea value={topic} onChange={(event) => setTopic(event.target.value)} onPaste={handlePasteReference} maxLength={300} placeholder="例如：以江南春日为主题，写一篇有画面感的品牌故事，也可 Ctrl+V 粘贴参考图" /><small>{topic.length}/300</small></label>
          {referenceImages.length > 0 && (
            <div className="pa-imagegen-panel__ref-list">
              {referenceImages.map((img, index) => (
                <div key={index} className="pa-imagegen-panel__ref-item">
                  <img src={img} alt={`参考图 ${index + 1}`} className="pa-imagegen-panel__ref-preview" />
                  <button type="button" className="pa-icon-button pa-imagegen-panel__ref-remove" aria-label={`移除参考图 ${index + 1}`} title="移除" onClick={() => setReferenceImages((prev) => prev.filter((_, i) => i !== index))}><X aria-hidden="true" size={14} /></button>
                </div>
              ))}
            </div>
          )}
          {referenceImages.length > 0 && <small>参考图仅作留存，不会发送给文字模型。</small>}
          <label className="pa-field"><span>内容风格</span><select value={style} onChange={(event) => setStyle(event.target.value)}><option value="">不指定（自由发挥）</option><option value="cinematic">电影感叙事</option><option value="poetic">东方诗意</option><option value="clear">清晰专业</option><option value="lively">轻松活泼</option></select></label>
          {isVideo && (
            <>
              <label className="pa-field"><span>生成引擎</span><select value={videoEngine} onChange={(event) => setVideoEngine(event.target.value as 'llm' | 'comfyui' | 'remotion')}><option value="llm">模型写动画（LLM → 逐帧渲染）</option><option value="comfyui">ComfyUI 出帧（本机/远程模型）</option><option value="remotion">Remotion 双引擎（3D + 节拍卡点）</option></select></label>
              {videoEngine === 'comfyui' && (
                <label className="pa-field"><span>ComfyUI 后端</span><select value={videoBackendId} onChange={(event) => setVideoBackendId(event.target.value)}>
                  {comfyBackends.length === 0 && <option value="">（未配置，去「设置中心 → 后端管理」添加 ComfyUI）</option>}
                  {comfyBackends.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{b.comfyui?.server ? ` · ${b.comfyui.server}` : ''}</option>
                  ))}
                </select></label>
              )}
              {videoEngine !== 'comfyui' && videoStyleLibrary.styles.length > 0 && (
                <label className="pa-field"><span>影片风格</span><select value={videoStyleId} onChange={(event) => setVideoStyleId(event.target.value)}>
                  <option value="">不指定（自由发挥）</option>
                  {videoStyleLibrary.categories.map((cat) => {
                    const members = videoStyleLibrary.styles.filter((s) => s.category === cat.id)
                    if (members.length === 0) return null
                    return (
                      <optgroup key={cat.id} label={cat.cn}>
                        {members.map((s) => (
                          <option key={s.id} value={s.id}>{s.cn} · {s.en}</option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select></label>
              )}
              {videoEngine === 'llm' && (
                <div className="pa-studio-form-row">
                  <label className="pa-toggle-row">
                    <input type="checkbox" checked={videoMultiScene} onChange={(event) => setVideoMultiScene(event.target.checked)} />
                    <span><strong>多幕叙事</strong><small>导演脚本分段渲染（钩子→展开→转折→落点）</small></span>
                  </label>
                  {videoMultiScene && (
                    <label className="pa-field"><span>幕数</span><input type="number" min={2} max={6} value={videoSceneCount} onChange={(event) => setVideoSceneCount(Math.min(6, Math.max(2, Number(event.target.value) || 3)))} /></label>
                  )}
                </div>
              )}
              {videoEngine === 'llm' && videoMultiScene && (
                <>
                  <label className="pa-field"><span>旁白音色</span><select value={videoVoice} onChange={(event) => setVideoVoice(event.target.value)}>
                    {VIDEO_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select><small>由导演脚本的旁白文案合成语音（edge-tts，需联网）</small></label>
                  <label className="pa-toggle-row">
                    <input type="checkbox" checked={videoMusic} onChange={(event) => setVideoMusic(event.target.checked)} />
                    <span><strong>背景配乐</strong><small>程序化合成氛围配乐，旁白出现时自动压低（本机离线）</small></span>
                  </label>
                </>
              )}
              <label className="pa-field"><span>画面比例</span><select value={videoAspect} onChange={(event) => setVideoAspect(event.target.value as '16:9' | '9:16' | '1:1')}><option value="16:9">横屏 16:9（1280×720）</option><option value="9:16">竖屏 9:16（720×1280）</option><option value="1:1">方屏 1:1（720×720）</option></select></label>
              <div className="pa-studio-form-row">
                <label className="pa-field"><span>时长（秒）</span><input type="number" min={1} max={30} value={videoDuration} onChange={(event) => setVideoDuration(Math.min(30, Math.max(1, Number(event.target.value) || 5)))} /></label>
                <label className="pa-field"><span>帧率</span><select value={videoFps} onChange={(event) => setVideoFps(Number(event.target.value))}><option value={24}>24 fps</option><option value={30}>30 fps</option></select></label>
              </div>
            </>
          )}
          <label className="pa-field"><span>补充要求</span><input value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder={isVideo ? '画面内容、镜头风格等（可选）' : '目标受众、篇幅、结构或画面比例'} /></label>
          <label className="pa-field"><span>标签</span><input value={tags.join(', ')} onChange={(event) => setTags(event.target.value.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean))} placeholder="用逗号或空格分隔，如：品牌故事, 春日" /></label>
          <button type="submit" className="pa-primary-button pa-studio-submit" disabled={generating}>
            <Sparkle aria-hidden="true" size={18} weight="fill" />{generating ? '停止生成' : isVideo ? '开始生成视频' : '开始生成'}
          </button>
          <div className="pa-studio-save-row">
            <button type="button" className="pa-secondary-button" disabled={isVideo} onClick={() => save('draft')}><FloppyDisk aria-hidden="true" size={17} />保存草稿</button>
            <button type="button" className="pa-secondary-button" disabled={isVideo} onClick={() => save('queued')}><PaperPlaneTilt aria-hidden="true" size={17} />加入待发布</button>
          </div>
          {isVideo && <p className="pa-form-notice">视频由本机 Edge/Chrome 逐帧渲染 + FFmpeg 合成，全程本地、不上传内容；生成需要数秒到数十秒。</p>}
        </form>
        <section className="pa-panel pa-studio-canvas">
          <div className="pa-studio-canvas__toolbar">
            <span>{isImage ? '提示词备注' : '手动创作画布'}</span>
            <div><button type="button" className="pa-icon-button" aria-label="复制" onClick={copyContent}><Copy aria-hidden="true" size={18} /></button><button type="button" className="pa-icon-button" aria-label="导出" onClick={exportDraft}><DownloadSimple aria-hidden="true" size={18} /></button></div>
          </div>
          {isVideo ? (
            videoResultId ? (
              <div className="pa-video-result">
                <video controls autoPlay src={assetUrl(videoResultId)} style={{ width: '100%', maxHeight: 420, borderRadius: 12, background: '#000' }} />
                <div className="pa-video-result__meta">
                  <span>{videoUsedFallback ? '已使用内置动画模板（模型未产出可用代码）' : '由模型编写动画生成'}</span>
                  <a className="pa-link-button" href={assetUrl(videoResultId)} download="paipiange-video.mp4">下载 MP4</a>
                </div>
              </div>
            ) : generating ? (
              <div className="pa-studio-canvas__empty"><Sparkle aria-hidden="true" size={40} weight="duotone" /><strong>{videoProgress.text || '正在生成视频…'}</strong><p>{videoEngine === 'comfyui' ? 'ComfyUI 出帧序列 → FFmpeg 合成，请稍候。' : videoEngine === 'remotion' ? 'Remotion 双引擎（3D / 节拍卡点 / 多 TTS）本地出片，请稍候。' : '模型编写动画 → 本机逐帧渲染 → FFmpeg 合成，请稍候。'}</p></div>
            ) : (
              <div className="pa-studio-canvas__empty"><VideoCamera aria-hidden="true" size={40} weight="duotone" /><strong>本地视频生成已就绪</strong><p>在左侧填写主题，选择生成引擎（模型写动画 / ComfyUI 出帧 / Remotion 双引擎），点击「开始生成视频」。</p></div>
            )
          ) : (
            <div className="pa-manual-editor">
              <div className="pa-manual-editor__notice"><PencilSimple aria-hidden="true" size={18} /><span>点击「开始生成」由 Harness 文本模型流式产出；也可用下方 Markdown 编辑器手动写作，内容会随草稿保存。</span></div>
              <label htmlFor="pa-manual-content">{isImage ? '图片构思、提示词补充或版权说明' : '正文草稿'}</label>
              <MarkdownEditor value={content} onChange={setContent} placeholder={isImage ? '记录画面主体、构图、光线和需要规避的元素…' : generating ? '正在生成…' : '从这里开始手动写作，支持 Markdown 语法，或点击「开始生成」由模型产出…'} />
              <div className="pa-manual-editor__footer"><span>{content.length} 字</span><span>{creationId ? '已建立本地草稿' : '尚未保存'}</span></div>
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  )
}
