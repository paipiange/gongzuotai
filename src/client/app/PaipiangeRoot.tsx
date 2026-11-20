import { CheckCircle, CloudArrowUp, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { inspirations, quickActions, templates, type PageId, type StudioId } from './data'
import {
  loadCreations,
  removeCreation,
  saveCreation as persistCreation,
  saveStudioDraft,
  setStatus,
  type CreationDraft,
  type CreationRecord,
  type CreationStatus,
} from './workspaceStore'
import { Sidebar, Topbar } from './chrome'
import { HomePage } from './HomePage'
import { StudioPage } from './StudioPage'
import { CreateHub, WorkspacePage } from './WorkspacePage'
import { GraphicStudioPage } from './graphicStudio/GraphicStudioPage'
import { ErrorBoundary } from './ErrorBoundary'
import type { TaskRecord } from './hostClient'
import type { ToastState } from './primitives'
import { resolveTaskResume, storedTaskOrigin } from './taskResume'
import { assetUrl, getHomeCarousel } from './hostClient'
import { HERO_BG } from './heroBackground'

export function PaipiangeRoot() {
  const [activePage, setActivePage] = useState<PageId>('home')
  const [studio, setStudio] = useState<StudioId | null>(null)
  const [selectedCreation, setSelectedCreation] = useState<CreationRecord | null>(null)
  const [creations, setCreations] = useState<CreationRecord[]>([])
  const [storageSource, setStorageSource] = useState<'host' | 'local' | 'loading'>('loading')
  const [activeCategory, setActiveCategory] = useState('热门推荐')
  const [inspirationIndex, setInspirationIndex] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [carouselImages, setCarouselImages] = useState<string[]>([])
  const [carouselIntervalMs, setCarouselIntervalMs] = useState<number | undefined>(undefined)
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window === 'undefined') return 'amber'
    return window.localStorage.getItem('paipiange.theme') ?? 'amber'
  })
  const [toast, setToast] = useState<ToastState | null>(null)
  const [templateResumeTask, setTemplateResumeTask] = useState<TaskRecord | null>(null)
  const [studioResumeTask, setStudioResumeTask] = useState<TaskRecord | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  const showToast = (message: string, tone: ToastState['tone'] = 'info') => setToast({ message, tone })

  const reloadWorkspace = async () => {
    setStorageSource('loading')
    const { creations: loaded, source } = await loadCreations()
    setCreations(loaded)
    setStorageSource(source)
    showToast(source === 'host' ? '已连接本地服务，数据已同步' : '仍未连接到本地服务', source === 'host' ? 'success' : 'warning')
  }

  /** Silent refresh (no toast) — used after batch operations. */
  const refreshCreations = async () => {
    const { creations: loaded, source } = await loadCreations()
    setCreations(loaded)
    setStorageSource(source)
  }

  // Initial load from Host (with local fallback).
  useEffect(() => {
    let cancelled = false
    loadCreations().then(({ creations: loaded, source }) => {
      if (cancelled) return
      setCreations(loaded)
      setStorageSource(source)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Load home carousel config (Host asset ids → image URLs). Falls back to default hero.
  useEffect(() => {
    let cancelled = false
    getHomeCarousel()
      .then((config) => {
        if (cancelled) return
        const custom = config.assetIds.map((id) => assetUrl(id))
        // 默认图是否纳入轮播：includeDefault 为 true 时默认图作为第一张；
        // 关闭且没有自定义图时，仍回退默认图，保证首页不空白。
        const images = config.includeDefault || custom.length === 0
          ? [HERO_BG, ...custom]
          : custom
        setCarouselImages(images)
        setCarouselIntervalMs(config.intervalMs)
      })
      .catch(() => {
        // 未连接 Host 时保留默认图，不做处理。
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true })
  }, [activePage, studio])

  const navigate = (page: PageId) => {
    if (page === 'graphic') {
      // 公众号创作是独立工作台，直接打开 graphic studio。
      setActivePage('create')
      setStudio('graphic')
      setSelectedCreation(null)
      setMobileOpen(false)
      return
    }
    setActivePage(page)
    setStudio(null)
    setSelectedCreation(null)
    setMobileOpen(false)
  }

  const openStudio = (id: StudioId) => {
    setActivePage('create')
    setStudio(id)
    setSelectedCreation(null)
    setStudioResumeTask(null)
    setTemplateResumeTask(null)
    setMobileOpen(false)
  }

  const openCreation = (creation: CreationRecord) => {
    setActivePage('create')
    setStudio(creation.studio)
    setSelectedCreation(creation)
    setStudioResumeTask(null)
    setTemplateResumeTask(null)
    setMobileOpen(false)
  }

  /** Resume a generation task: re-fill the matching studio form and open it. */
  const resumeTask = (task: TaskRecord) => {
    const destination = resolveTaskResume(task)
    const resumeState = storedTaskOrigin(task)?.state ?? {}
    if (destination.kind === 'template') {
      setSelectedCreation(null)
      setStudio(null)
      setStudioResumeTask(null)
      setTemplateResumeTask(task)
      setActivePage('templates')
      setMobileOpen(false)
      showToast('已回到原模板，可继续创作', 'success')
      return
    }
    if (destination.kind === 'graphic') {
      setSelectedCreation(null)
      setActivePage('create')
      setStudio('graphic')
      setStudioResumeTask(task)
      setMobileOpen(false)
      showToast('已回到公众号创作工作台', 'success')
      return
    }
    const studio = destination.studio
    saveStudioDraft(studio, {
      title: String(resumeState.title ?? ''),
      topic: String(resumeState.topic ?? task.input.topic ?? task.input.prompt ?? ''),
      content: String(resumeState.content ?? task.result.text ?? ''),
      style: String(resumeState.style ?? task.input.style ?? 'cinematic'),
      requirement: String(resumeState.requirement ?? task.input.requirement ?? ''),
      tags: Array.isArray(resumeState.tags) ? resumeState.tags.filter((item): item is string => typeof item === 'string') : [],
    })
    setSelectedCreation(null)
    setTemplateResumeTask(null)
    setStudioResumeTask(task)
    setActivePage('create')
    setStudio(studio)
    setMobileOpen(false)
    showToast('已回到原创作工作台，可继续修改', 'success')
  }

  const saveCreation = async (draft: CreationDraft): Promise<CreationRecord | null> => {
    try {
      const { record, source } = await persistCreation(draft)
      setCreations((current) => [record, ...current.filter((item) => item.id !== record.id)])
      setSelectedCreation(record)
      setStorageSource(source)
      showToast(draft.status === 'queued' ? '草稿已保存到待发布列表' : '草稿已保存', 'success')
      return record
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '保存失败', 'warning')
      return null
    }
  }

  const setCreationStatus = async (id: string, status: CreationStatus) => {
    const { record } = await setStatus(id, status)
    if (record) {
      setCreations((current) => current.map((item) => (item.id === id ? record : item)))
    }
    showToast(status === 'archived' ? '内容已归档' : status === 'queued' ? '已加入待发布列表' : '内容已恢复为草稿', 'success')
  }

  const deleteCreation = async (id: string) => {
    const target = creations.find((item) => item.id === id)
    if (!target || !window.confirm(`确定永久删除“${target.title}”吗？此操作无法撤销。`)) return
    await removeCreation(id)
    setCreations((current) => current.filter((item) => item.id !== id))
    if (selectedCreation?.id === id) {
      setSelectedCreation(null)
      setStudio(null)
    }
    showToast('创作记录已删除', 'success')
  }

  const shuffleInspiration = () => {
    setInspirationIndex((current) => (current + 1) % inspirations.length)
    showToast('已换一条创作灵感', 'success')
  }

  const search = (query: string) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      showToast('请输入搜索关键词', 'warning')
      return
    }
    const action = quickActions.find((item) => `${item.title}${item.description}${item.category}`.toLowerCase().includes(normalized))
    const template = templates.find((item) => `${item.title}${item.subtitle}`.toLowerCase().includes(normalized))
    const creation = creations.find((item) => `${item.title}${item.topic}${item.content}`.toLowerCase().includes(normalized))
    if (creation) {
      openCreation(creation)
      showToast(`已打开创作：${creation.title}`, 'success')
    } else if (action) {
      openStudio(action.id)
      showToast(`已找到：${action.title}`, 'success')
    } else if (template) {
      showToast(`已找到模板：${template.title}`, 'success')
    } else {
      showToast('暂未找到匹配内容', 'warning')
    }
  }

  const goBack = () => {
    if (studio) {
      setStudio(null)
      setSelectedCreation(null)
    }
    else navigate('home')
  }

  const changeTheme = (next: string) => {
    setTheme(next)
    try {
      window.localStorage.setItem('paipiange.theme', next)
    } catch {
      // ignore storage errors
    }
  }

  return (
    <div className="pa-root" data-theme={theme}>
      <a className="pa-skip-link" href="#pa-main-content">跳到主要内容</a>
      <Sidebar activePage={studio === 'graphic' ? 'graphic' : activePage} collapsed={collapsed} mobileOpen={mobileOpen} recentCreations={creations.filter((item) => item.status !== 'archived')} onNavigate={navigate} onOpenCreation={openCreation} onCollapse={() => setCollapsed((value) => !value)} onCloseMobile={() => setMobileOpen(false)} />
      <div className="pa-main-shell">
        <Topbar activePage={activePage} studio={studio} onBack={goBack} onHome={() => navigate('home')} onOpenMobile={() => setMobileOpen(true)} onSearch={search} onToast={showToast} />
        {storageSource === 'local' && (
          <div className="pa-offline-banner" role="status" aria-live="polite">
            <CloudArrowUp aria-hidden="true" size={17} />
            <span>本地服务未连接，当前为离线模式：草稿保存在浏览器本地，恢复连接后将自动合并。</span>
            <button type="button" className="pa-offline-banner__retry" onClick={() => void reloadWorkspace()}>重试连接</button>
          </div>
        )}
        <main id="pa-main-content" className="pa-content" ref={mainRef} tabIndex={-1}>
          <ErrorBoundary resetKey={`${activePage}:${studio ?? ''}`}>
            {activePage === 'home' && !studio && <HomePage inspirationIndex={inspirationIndex} activeCategory={activeCategory} creations={creations} carouselImages={carouselImages} carouselIntervalMs={carouselIntervalMs} onCategory={setActiveCategory} onShuffle={shuffleInspiration} onOpenStudio={openStudio} onOpenCreation={openCreation} onNavigate={navigate} onToast={showToast} />}
            {activePage === 'create' && !studio && <CreateHub onOpenStudio={openStudio} />}
            {studio === 'graphic' && <GraphicStudioPage onBack={() => { setStudio(null); setSelectedCreation(null); setStudioResumeTask(null) }} onToast={showToast} />}
            {studio && studio !== 'graphic' && <StudioPage studio={studio} initialCreation={selectedCreation} resumeTask={studioResumeTask} onResumeConsumed={() => setStudioResumeTask(null)} onBack={() => { setStudio(null); setSelectedCreation(null); setStudioResumeTask(null) }} onSave={saveCreation} onToast={showToast} />}
            {activePage !== 'home' && activePage !== 'create' && !studio && <WorkspacePage page={activePage} creations={creations} storageSource={storageSource} onNavigate={navigate} onOpenStudio={openStudio} onOpenCreation={openCreation} onStatus={setCreationStatus} onDelete={deleteCreation} onToast={showToast} onRefresh={refreshCreations} theme={theme} onThemeChange={changeTheme} onResumeTask={resumeTask} templateResumeTask={templateResumeTask} onTemplateResumeConsumed={() => setTemplateResumeTask(null)} />}
          </ErrorBoundary>
        </main>
      </div>
      {toast && <div className="pa-toast" data-tone={toast.tone} role="status" aria-live="polite"><CheckCircle aria-hidden="true" size={20} weight="fill" /><span>{toast.message}</span><button type="button" aria-label="关闭提示" onClick={() => setToast(null)}><X aria-hidden="true" size={16} /></button></div>}
    </div>
  )
}
