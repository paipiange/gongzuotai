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
import type { TaskRecord } from './hostClient'
import type { ToastState } from './primitives'

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
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window === 'undefined') return 'amber'
    return window.localStorage.getItem('paipiange.theme') ?? 'amber'
  })
  const [toast, setToast] = useState<ToastState | null>(null)
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
    setMobileOpen(false)
  }

  const openCreation = (creation: CreationRecord) => {
    setActivePage('create')
    setStudio(creation.studio)
    setSelectedCreation(creation)
    setMobileOpen(false)
  }

  /** Resume a generation task: re-fill the matching studio form and open it. */
  const resumeTask = (task: TaskRecord) => {
    if (task.kind === 'text') {
      const studio = (typeof task.input.studio === 'string' && ['article', 'headline', 'marketing', 'xiaohongshu'].includes(task.input.studio))
        ? task.input.studio as 'article' | 'headline' | 'marketing' | 'xiaohongshu'
        : 'article'
      saveStudioDraft(studio, {
        title: '',
        topic: String(task.input.topic ?? ''),
        content: String(task.result.text ?? ''),
        style: String(task.input.style ?? 'cinematic'),
        requirement: String(task.input.requirement ?? ''),
        tags: [],
      })
      setSelectedCreation(null)
      setActivePage('create')
      setStudio(studio)
      setMobileOpen(false)
      showToast('已回填到创作画布，可继续修改', 'success')
    } else if (task.kind === 'video') {
      // Video task: restore the topic as the video topic and reopen the studio.
      saveStudioDraft('video', {
        title: '',
        topic: String(task.input.topic ?? ''),
        content: '',
        style: String(task.input.style ?? 'cinematic'),
        requirement: String(task.input.requirement ?? ''),
        tags: [],
      })
      setSelectedCreation(null)
      setActivePage('create')
      setStudio('video')
      setMobileOpen(false)
      showToast('已回填到视频工作台，可继续修改', 'success')
    } else {
      // Image task: restore the prompt as the image topic.
      saveStudioDraft('image', {
        title: '',
        topic: String(task.input.prompt ?? ''),
        content: '',
        style: 'cinematic',
        requirement: '',
        tags: [],
      })
      setSelectedCreation(null)
      setActivePage('create')
      setStudio('image')
      setMobileOpen(false)
      showToast('已回填到图片创作画布，可继续修改', 'success')
    }
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
          {activePage === 'home' && !studio && <HomePage inspirationIndex={inspirationIndex} activeCategory={activeCategory} creations={creations} onCategory={setActiveCategory} onShuffle={shuffleInspiration} onOpenStudio={openStudio} onOpenCreation={openCreation} onNavigate={navigate} onToast={showToast} />}
          {activePage === 'create' && !studio && <CreateHub onOpenStudio={openStudio} />}
          {studio === 'graphic' && <GraphicStudioPage onBack={() => { setStudio(null); setSelectedCreation(null) }} onToast={showToast} />}
          {studio && studio !== 'graphic' && <StudioPage studio={studio} initialCreation={selectedCreation} onBack={() => { setStudio(null); setSelectedCreation(null) }} onSave={saveCreation} onToast={showToast} />}
          {activePage !== 'home' && activePage !== 'create' && !studio && <WorkspacePage page={activePage} creations={creations} storageSource={storageSource} onNavigate={navigate} onOpenStudio={openStudio} onOpenCreation={openCreation} onStatus={setCreationStatus} onDelete={deleteCreation} onToast={showToast} onRefresh={refreshCreations} theme={theme} onThemeChange={changeTheme} onResumeTask={resumeTask} />}
        </main>
      </div>
      {toast && <div className="pa-toast" data-tone={toast.tone} role="status" aria-live="polite"><CheckCircle aria-hidden="true" size={20} weight="fill" /><span>{toast.message}</span><button type="button" aria-label="关闭提示" onClick={() => setToast(null)}><X aria-hidden="true" size={16} /></button></div>}
    </div>
  )
}
