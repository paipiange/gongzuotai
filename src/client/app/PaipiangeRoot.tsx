import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowCounterClockwise,
  Bell,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  CloudArrowUp,
  Copy,
  DownloadSimple,
  FileText,
  FilmSlate,
  FloppyDisk,
  FolderOpen,
  GearSix,
  ImageSquare,
  List,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Shuffle,
  SidebarSimple,
  Sparkle,
  Trash,
  X,
} from '@phosphor-icons/react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  categoryPills,
  inspirations,
  navigation,
  pageMeta,
  quickActions,
  templates,
  type PageId,
  type QuickAction,
  type StudioId,
} from './data'
import {
  loadCreations,
  removeCreation,
  saveCreation as persistCreation,
  setStatus,
  type CreationDraft,
  type CreationRecord,
  type CreationStatus,
} from './workspaceStore'
import { ImageGenSettings } from './ImageGenSettings'
import { TextGenSettings } from './TextGenSettings'
import { ImageGenPanel } from './ImageGenPanel'
import { AssetsPage, InspirationPage, PublishQueuePage } from './LibraryPages'
import { AnalyticsPage } from './AnalyticsPage'
import { exportCreation, generateTextStream } from './hostClient'

type ArtVariant = 'river' | 'court' | 'blossom' | 'night' | 'portrait' | 'hero'

interface ToastState {
  message: string
  tone: 'info' | 'success' | 'warning'
}

const studioLabels: Record<StudioId, string> = {
  article: 'AI 文章工作台',
  image: 'AI 图片工作台',
  video: 'AI 视频工作台',
  headline: '爆款标题工作台',
  marketing: '营销文案工作台',
  xiaohongshu: '小红书笔记工作台',
}

const statusLabels: Record<CreationStatus, string> = {
  draft: '草稿',
  queued: '待发布',
  archived: '已归档',
}

function formatLocalTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function ScenicArt({ variant, label }: { variant: ArtVariant; label: string }) {
  const palette = {
    river: ['#e4a866', '#70412e', '#24150f'],
    court: ['#d88a55', '#59311f', '#1c120e'],
    blossom: ['#e9a19d', '#7d493b', '#26140f'],
    night: ['#8c716c', '#42302d', '#17100e'],
    portrait: ['#efb49f', '#8d493a', '#2d1712'],
    hero: ['#efad96', '#7d3e2c', '#24130e'],
  }[variant]

  const suffix = variant.replace(/[^a-z]/g, '')

  return (
    <svg
      className={`pa-art pa-art--${variant}`}
      viewBox="0 0 600 320"
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={`sky-${suffix}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={palette[0]} />
          <stop offset="0.52" stopColor={palette[1]} />
          <stop offset="1" stopColor={palette[2]} />
        </linearGradient>
        <radialGradient id={`sun-${suffix}`} cx="68%" cy="28%" r="35%">
          <stop offset="0" stopColor="#ffe0af" stopOpacity=".9" />
          <stop offset=".42" stopColor="#f1a86f" stopOpacity=".34" />
          <stop offset="1" stopColor="#f1a86f" stopOpacity="0" />
        </radialGradient>
        <filter id={`soft-${suffix}`}>
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <rect width="600" height="320" fill={`url(#sky-${suffix})`} />
      <rect width="600" height="320" fill={`url(#sun-${suffix})`} />
      <path d="M0 205 C85 168 145 198 220 166 C310 125 390 158 465 126 C525 101 565 118 600 93 L600 320 L0 320Z" fill="#2d1d17" opacity=".75" />
      <path d="M0 232 C95 196 155 220 248 190 C334 162 392 194 488 159 C536 142 573 151 600 144 L600 320 L0 320Z" fill="#1a120f" opacity=".82" />
      <path d="M0 258 C122 225 188 248 290 220 C392 194 486 232 600 198 L600 320 L0 320Z" fill="#100c0a" opacity=".88" />
      <g opacity=".74" fill="#160e0b">
        <path d="M388 207h126v53H388z" />
        <path d="M372 205l78-37 83 37z" />
        <path d="M406 173h85v-15h-85z" />
        <path d="M423 158l26-22 31 22z" />
        <path d="M415 218h12v42h-12zm31 0h12v42h-12zm31 0h12v42h-12z" fill="#ba7a49" opacity=".55" />
      </g>
      <path d="M84 228 C74 157 96 104 151 61 C112 119 114 176 128 229Z" fill="#1a100c" opacity=".85" />
      <g fill="#f3b0a8" opacity=".88">
        <circle cx="126" cy="86" r="7" /><circle cx="151" cy="74" r="5" /><circle cx="177" cy="91" r="8" />
        <circle cx="112" cy="112" r="5" /><circle cx="163" cy="112" r="6" /><circle cx="196" cy="122" r="5" />
        <circle cx="79" cy="143" r="5" /><circle cx="139" cy="139" r="8" /><circle cx="184" cy="154" r="6" />
      </g>
      {(variant === 'portrait' || variant === 'hero') && (
        <g transform="translate(298 38)">
          <ellipse cx="86" cy="65" rx="37" ry="47" fill="#f1c0a2" />
          <path d="M50 63C45 10 125 5 128 68C116 51 96 38 58 42Z" fill="#21130f" />
          <path d="M51 68C37 102 40 139 20 166C58 145 67 116 67 82Z" fill="#241510" />
          <path d="M117 69C145 107 126 138 151 165C120 148 105 118 104 83Z" fill="#241510" />
          <path d="M62 108C24 132 8 193 2 256H174C166 191 148 132 109 108C96 127 76 127 62 108Z" fill="#d78c70" />
          <path d="M56 121C70 151 104 151 117 121L140 253H24Z" fill="#e9aa8e" opacity=".9" />
          <circle cx="53" cy="35" r="10" fill="#e8b065" /><circle cx="119" cy="29" r="8" fill="#e8b065" />
        </g>
      )}
      <g fill="#f9c4bb" opacity=".62" filter={`url(#soft-${suffix})`}>
        <circle cx="540" cy="51" r="14" /><circle cx="260" cy="38" r="10" /><circle cx="212" cy="124" r="7" />
      </g>
    </svg>
  )
}

function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pa-section-heading">
      <h2><Sparkle aria-hidden="true" size={18} weight="duotone" />{title}</h2>
      {action && (
        <button className="pa-link-button" type="button" onClick={onAction}>
          {action}<CaretRight aria-hidden="true" size={15} />
        </button>
      )}
    </div>
  )
}

function EmptyState({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pa-empty-state">
      <div className="pa-empty-state__icon"><FolderOpen aria-hidden="true" size={25} weight="duotone" /></div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action && <button type="button" className="pa-secondary-button" onClick={onAction}>{action}</button>}
    </div>
  )
}

function Sidebar({
  activePage,
  collapsed,
  mobileOpen,
  recentCreations,
  onNavigate,
  onOpenCreation,
  onCollapse,
  onCloseMobile,
}: {
  activePage: PageId
  collapsed: boolean
  mobileOpen: boolean
  recentCreations: CreationRecord[]
  onNavigate: (page: PageId) => void
  onOpenCreation: (creation: CreationRecord) => void
  onCollapse: () => void
  onCloseMobile: () => void
}) {
  return (
    <>
      {mobileOpen && <button className="pa-sidebar-scrim" type="button" aria-label="关闭菜单" onClick={onCloseMobile} />}
      <aside className="pa-sidebar" data-collapsed={collapsed} data-mobile-open={mobileOpen}>
        <div className="pa-brand">
          <div className="pa-brand__mark"><FilmSlate aria-hidden="true" size={24} weight="duotone" /></div>
          <div className="pa-brand__copy">
            <strong>拍片哥工作台</strong>
            <span>让创作更简单</span>
          </div>
          <button type="button" className="pa-icon-button pa-sidebar__mobile-close" aria-label="关闭菜单" onClick={onCloseMobile}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>

        <button type="button" className="pa-sidebar-search" aria-label="搜索工作区" onClick={() => onNavigate('home')}>
          <MagnifyingGlass aria-hidden="true" size={18} />
          <span>搜索工作区</span>
        </button>

        <nav className="pa-nav" aria-label="拍片哥工作台主导航">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className="pa-nav__item"
                data-active={activePage === item.id}
                aria-label={item.label}
                aria-current={activePage === item.id ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <Icon aria-hidden="true" size={20} weight={activePage === item.id ? 'duotone' : 'regular'} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="pa-sidebar__recent">
          <div className="pa-sidebar__label"><span>最近创作</span><Plus aria-hidden="true" size={15} /></div>
          {recentCreations.length ? (
            <div className="pa-sidebar__recent-list">
              {recentCreations.slice(0, 3).map((creation) => (
                <button key={creation.id} type="button" onClick={() => onOpenCreation(creation)}>
                  <FileText aria-hidden="true" size={15} />
                  <span><strong>{creation.title}</strong><small>{formatLocalTime(creation.updatedAt)}</small></span>
                </button>
              ))}
            </div>
          ) : <div className="pa-sidebar__empty">暂无真实创作记录</div>}
        </div>

        <div className="pa-sidebar__bottom">
          <button type="button" className="pa-model-card" aria-label="模型与设置" onClick={() => onNavigate('settings')}>
            <Sparkle aria-hidden="true" size={22} weight="duotone" />
            <span><strong>模型与设置</strong><small>连接 Harness 模型</small></span>
            <CaretRight aria-hidden="true" size={16} />
          </button>
          <button type="button" className="pa-settings-link" aria-label="设置中心" onClick={() => onNavigate('settings')}>
            <GearSix aria-hidden="true" size={19} /><span>设置中心</span>
          </button>
          <button type="button" className="pa-collapse-button" onClick={onCollapse} aria-label={collapsed ? '展开侧栏' : '收起侧栏'}>
            <SidebarSimple aria-hidden="true" size={19} /><span>{collapsed ? '展开' : '收起侧栏'}</span>
          </button>
        </div>
      </aside>
    </>
  )
}

function Topbar({
  activePage,
  studio,
  onBack,
  onHome,
  onOpenMobile,
  onSearch,
  onToast,
}: {
  activePage: PageId
  studio: StudioId | null
  onBack: () => void
  onHome: () => void
  onOpenMobile: () => void
  onSearch: (query: string) => void
  onToast: (message: string, tone?: ToastState['tone']) => void
}) {
  const [query, setQuery] = useState('')

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    onSearch(query)
  }

  return (
    <header className="pa-topbar">
      <div className="pa-topbar__nav">
        <button type="button" className="pa-icon-button pa-mobile-menu" aria-label="打开菜单" onClick={onOpenMobile}>
          <List aria-hidden="true" size={21} />
        </button>
        <button type="button" className="pa-icon-button" aria-label="返回" onClick={onBack} disabled={activePage === 'home' && !studio}>
          <ArrowLeft aria-hidden="true" size={19} />
        </button>
        <button type="button" className="pa-icon-button pa-forward-button" aria-label="前进" disabled>
          <ArrowRight aria-hidden="true" size={19} />
        </button>
        <button type="button" className="pa-breadcrumb" onClick={onHome}>
          <span className="pa-breadcrumb__home">首页</span>
          {(activePage !== 'home' || studio) && <span>{studio ? studioLabels[studio] : pageMeta[activePage].title}</span>}
        </button>
        <button type="button" className="pa-icon-button pa-add-button" aria-label="新建创作" onClick={() => onToast('请选择一种创作类型开始新任务')}>
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>
      <form className="pa-global-search" role="search" onSubmit={submitSearch}>
        <MagnifyingGlass aria-hidden="true" size={17} />
        <label className="pa-visually-hidden" htmlFor="pa-global-search">搜索模板、素材和记录</label>
        <input id="pa-global-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板、素材和记录" />
      </form>
      <div className="pa-topbar__actions">
        <button type="button" className="pa-icon-button" aria-label="通知" onClick={() => onToast('当前没有新通知')}>
          <Bell aria-hidden="true" size={19} />
        </button>
        <button type="button" className="pa-avatar" aria-label="打开本地工作区信息" onClick={() => onToast('拍片哥工作台 · 本地优先模式')}>拍</button>
      </div>
    </header>
  )
}

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="pa-hero">
      <ScenicArt variant="hero" label="原创春樱古风人物插画" />
      <div className="pa-hero__shade" />
      <div className="pa-hero__content">
        <span className="pa-overline">PAIPIANGE CREATIVE STUDIO</span>
        <h1>AI 赋能创作<br />让灵感，触手可及</h1>
        <p>文章生成 · 图片创作 · 视频策划 · 一站式内容工作台</p>
        <button type="button" className="pa-primary-button" onClick={onStart}>
          <Sparkle aria-hidden="true" size={18} weight="fill" />开始创作
        </button>
      </div>
    </section>
  )
}

function InspirationCard({ index, onShuffle, onCreate }: { index: number; onShuffle: () => void; onCreate: () => void }) {
  const item = inspirations[index]
  return (
    <section className="pa-inspiration-card">
      <div className="pa-inspiration-card__top">
        <span><Sparkle aria-hidden="true" size={16} weight="duotone" />创作灵感</span>
        <button type="button" onClick={onShuffle}><Shuffle aria-hidden="true" size={15} />换一换</button>
      </div>
      <div className="pa-inspiration-card__copy">
        <small>{item.eyebrow}</small>
        <h2>{item.title}</h2>
        <p>{item.description}</p>
      </div>
      <button type="button" className="pa-inspiration-card__visual" onClick={onCreate}>
        <ScenicArt variant={item.art} label={`${item.title}主题原创插画`} />
        <span>一键创作<ArrowRight aria-hidden="true" size={16} /></span>
      </button>
    </section>
  )
}

function QuickCard({ item, onOpen }: { item: QuickAction; onOpen: (id: StudioId) => void }) {
  const Icon = item.icon
  return (
    <button type="button" className="pa-quick-card" onClick={() => onOpen(item.id)}>
      <ScenicArt variant={item.art} label={`${item.title}原创背景插画`} />
      <span className="pa-quick-card__shade" />
      <span className="pa-quick-card__body">
        <span className="pa-quick-card__icon"><Icon aria-hidden="true" size={21} weight="duotone" /></span>
        <span className="pa-quick-card__copy"><strong>{item.title}</strong><small>{item.description}</small></span>
        <span className="pa-quick-card__arrow"><CaretRight aria-hidden="true" size={17} /></span>
      </span>
    </button>
  )
}

function RecentCreationList({ creations, onOpen }: { creations: CreationRecord[]; onOpen: (creation: CreationRecord) => void }) {
  return (
    <div className="pa-recent-list">
      {creations.slice(0, 4).map((creation) => (
        <button key={creation.id} type="button" className="pa-recent-item" onClick={() => onOpen(creation)}>
          <span className="pa-recent-item__icon"><FileText aria-hidden="true" size={19} weight="duotone" /></span>
          <span className="pa-recent-item__copy"><strong>{creation.title}</strong><small>{studioLabels[creation.studio]} · {formatLocalTime(creation.updatedAt)}</small></span>
          <span className="pa-status-badge" data-status={creation.status}>{statusLabels[creation.status]}</span>
          <CaretRight aria-hidden="true" size={16} />
        </button>
      ))}
    </div>
  )
}

function HomePage({
  inspirationIndex,
  activeCategory,
  creations,
  onCategory,
  onShuffle,
  onOpenStudio,
  onOpenCreation,
  onNavigate,
  onToast,
}: {
  inspirationIndex: number
  activeCategory: string
  creations: CreationRecord[]
  onCategory: (category: string) => void
  onShuffle: () => void
  onOpenStudio: (studio: StudioId) => void
  onOpenCreation: (creation: CreationRecord) => void
  onNavigate: (page: PageId) => void
  onToast: (message: string, tone?: ToastState['tone']) => void
}) {
  const visibleActions = useMemo(() => {
    if (activeCategory === '热门推荐') return quickActions.slice(0, 4)
    return quickActions.filter((item) => item.category === activeCategory)
  }, [activeCategory])

  return (
    <div className="pa-home">
      <div className="pa-home__hero-grid">
        <Hero onStart={() => onOpenStudio('article')} />
        <InspirationCard index={inspirationIndex} onShuffle={onShuffle} onCreate={() => onOpenStudio('article')} />
      </div>

      <div className="pa-category-pills" aria-label="创作类型筛选">
        {categoryPills.map((category) => (
          <button key={category} type="button" data-active={activeCategory === category} aria-pressed={activeCategory === category} onClick={() => onCategory(category)}>
            {category}
          </button>
        ))}
      </div>

      <div className="pa-quick-grid" data-count={visibleActions.length}>
        {visibleActions.map((item) => <QuickCard key={item.id} item={item} onOpen={onOpenStudio} />)}
      </div>

      <div className="pa-home__bottom-grid">
        <section className="pa-panel pa-templates-panel">
          <SectionHeading title="精选模板" action="查看更多" onAction={() => onNavigate('create')} />
          <div className="pa-template-grid">
            {templates.map((template) => (
              <button key={template.title} type="button" className="pa-template-card" onClick={() => onToast(`已选择模板：${template.title}`)}>
                <span className="pa-template-card__art"><ScenicArt variant={template.art} label={`${template.title}原创模板插画`} /></span>
                <span className="pa-template-card__copy"><strong>{template.title}</strong><small>{template.subtitle}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="pa-panel pa-recent-panel">
          <SectionHeading title="创作记录" action="查看更多" onAction={() => onNavigate('history')} />
          {creations.some((item) => item.status !== 'archived')
            ? <RecentCreationList creations={creations.filter((item) => item.status !== 'archived')} onOpen={onOpenCreation} />
            : <EmptyState title="还没有创作记录" description="完成并保存内容后，会在这里显示真实的本地记录。" action="开始创作" onAction={() => onOpenStudio('article')} />}
        </section>
      </div>
    </div>
  )
}

function PageIntro({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pa-page-intro">
      <div><span className="pa-overline">PAIPIANGE WORKSPACE</span><h1>{title}</h1><p>{description}</p></div>
      {action && <button type="button" className="pa-primary-button" onClick={onAction}><Plus aria-hidden="true" size={18} />{action}</button>}
    </div>
  )
}

function CreateHub({ onOpenStudio }: { onOpenStudio: (studio: StudioId) => void }) {
  return (
    <div className="pa-page">
      <PageIntro title="AI 创作" description="选择内容目标，进入对应工作台。未配置模型时仍可完成界面与表单体验。" />
      <div className="pa-create-grid">
        {quickActions.map((item) => <QuickCard key={item.id} item={item} onOpen={onOpenStudio} />)}
      </div>
      <section className="pa-panel pa-workflow-panel">
        <SectionHeading title="创作流程" />
        <div className="pa-workflow-steps">
          {['选择模板或创作类型', '填写主题与约束', '连接 Harness 模型生成', '编辑、保存与导出'].map((step, index) => (
            <div key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></div>
          ))}
        </div>
      </section>
    </div>
  )
}

function StudioPage({ studio, initialCreation, onBack, onSave, onToast }: {
  studio: StudioId
  initialCreation: CreationRecord | null
  onBack: () => void
  onSave: (draft: CreationDraft) => Promise<CreationRecord | null>
  onToast: (message: string, tone?: ToastState['tone']) => void
}) {
  const [creationId, setCreationId] = useState<string | undefined>(initialCreation?.id)
  const [title, setTitle] = useState(initialCreation?.title ?? '')
  const [topic, setTopic] = useState(initialCreation?.topic ?? '')
  const [content, setContent] = useState(initialCreation?.content ?? '')
  const [style, setStyle] = useState(initialCreation?.style ?? 'cinematic')
  const [requirement, setRequirement] = useState(initialCreation?.requirement ?? '')
  const [generating, setGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const isVideo = studio === 'video'
  const isImage = studio === 'image'
  const isText = !isVideo && !isImage

  useEffect(() => {
    setCreationId(initialCreation?.id)
    setTitle(initialCreation?.title ?? '')
    setTopic(initialCreation?.topic ?? '')
    setContent(initialCreation?.content ?? '')
    setStyle(initialCreation?.style ?? 'cinematic')
    setRequirement(initialCreation?.requirement ?? '')
  }, [initialCreation, studio])

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
      }).then((record) => {
        if (record) setCreationId(record.id)
      })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [creationId, title, topic, content, style, requirement, studio, isVideo])

  const save = async (status: CreationStatus = initialCreation?.status ?? 'draft') => {
    if (isVideo) {
      onToast('视频功能仅为未开放占位，不会创建记录或任务', 'warning')
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
    })
    if (saved) setCreationId(saved.id)
    return saved
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (isVideo) {
      onToast('视频生成暂未开放，不会创建真实任务', 'warning')
      return
    }
    if (!topic.trim()) {
      onToast('请先填写创作主题', 'warning')
      return
    }
    if (isImage) {
      onToast('请先在设置中心配置图片 Provider', 'warning')
      return
    }
    // Text studios: stream a real generation from the Harness llm service.
    if (generating) {
      abortRef.current?.abort()
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setGenerating(true)
    setContent('')
    let accumulated = ''
    try {
      await generateTextStream(
        {
          provider: '',
          model: '',
          studio: studio as 'article' | 'headline' | 'marketing' | 'xiaohongshu',
          topic: topic.trim(),
          style,
          requirement,
        },
        (event) => {
          if (event.delta) {
            accumulated += event.delta
            setContent(accumulated)
          } else if (event.error) {
            onToast(event.error, 'warning')
          }
        },
        controller.signal,
      )
      onToast('生成完成，内容已填入画布', 'success')
    } catch (cause) {
      if (controller.signal.aborted) {
        onToast('已取消生成', 'info')
      } else {
        onToast(cause instanceof Error ? cause.message : '生成失败，请确认 Harness 已配置文本模型', 'warning')
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
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

  return (
    <div className="pa-page pa-studio-page">
      <div className="pa-studio-heading">
        <button type="button" className="pa-icon-button" aria-label="返回 AI 创作" onClick={onBack}><ArrowLeft aria-hidden="true" size={19} /></button>
        <div><span className="pa-overline">CREATION STUDIO</span><h1>{studioLabels[studio]}</h1><p>{isVideo ? '完整界面占位，不调用模型、不扣费、不创建任务。' : isImage ? '输入主题并选择风格，一键生成配图（handraw-style 风格库）。' : '填写创作要求，一键调用 Harness 文本模型生成，逐字流式填入画布。'}</p></div>
      </div>
      {isImage ? (
        <div className="pa-studio-image">
          <form className="pa-panel pa-studio-form pa-studio-form--compact" onSubmit={(event) => { event.preventDefault(); void save('draft') }}>
            <SectionHeading title="图片创作" />
            <label className="pa-field"><span>草稿标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：春日猫片封面" /></label>
            <div className="pa-studio-save-row">
              <button type="submit" className="pa-secondary-button" disabled={isVideo}><FloppyDisk aria-hidden="true" size={17} />保存草稿</button>
              {creationId && <span className="pa-form-notice">已关联草稿，生成图可一键设为封面。</span>}
            </div>
          </form>
          <ImageGenPanel onToast={onToast} creationId={creationId} />
        </div>
      ) : (
      <div className="pa-studio-layout">
        <form className="pa-panel pa-studio-form" onSubmit={submit}>
          <SectionHeading title="创作参数" />
          <label className="pa-field"><span>创作类型</span><select defaultValue={studio}><option value={studio}>{studioLabels[studio]}</option></select></label>
          <label className="pa-field"><span>草稿标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：春日品牌故事初稿" /></label>
          <label className="pa-field"><span>主题 / 关键词 <b aria-hidden="true">*</b></span><textarea value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={300} placeholder="例如：以江南春日为主题，写一篇有画面感的品牌故事" /><small>{topic.length}/300</small></label>
          <label className="pa-field"><span>内容风格</span><select value={style} onChange={(event) => setStyle(event.target.value)}><option value="cinematic">电影感叙事</option><option value="poetic">东方诗意</option><option value="clear">清晰专业</option><option value="lively">轻松活泼</option></select></label>
          <label className="pa-field"><span>补充要求</span><input value={requirement} onChange={(event) => setRequirement(event.target.value)} placeholder="目标受众、篇幅、结构或画面比例" /></label>
          <button type="submit" className="pa-primary-button pa-studio-submit" disabled={isVideo} aria-describedby={isVideo ? 'video-disabled-hint' : undefined}>
            <Sparkle aria-hidden="true" size={18} weight="fill" />{isVideo ? '功能暂未开放' : generating ? '停止生成' : '开始生成'}
          </button>
          <div className="pa-studio-save-row">
            <button type="button" className="pa-secondary-button" disabled={isVideo} onClick={() => save('draft')}><FloppyDisk aria-hidden="true" size={17} />保存草稿</button>
            <button type="button" className="pa-secondary-button" disabled={isVideo} onClick={() => save('queued')}><PaperPlaneTilt aria-hidden="true" size={17} />加入待发布</button>
          </div>
          {isVideo && <p id="video-disabled-hint" className="pa-form-notice">视频功能仅展示界面，不会发送任何生成请求。</p>}
        </form>
        <section className="pa-panel pa-studio-canvas">
          <div className="pa-studio-canvas__toolbar">
            <span>{isImage ? '提示词备注' : '手动创作画布'}</span>
            <div><button type="button" className="pa-icon-button" aria-label="复制" onClick={copyContent}><Copy aria-hidden="true" size={18} /></button><button type="button" className="pa-icon-button" aria-label="导出" onClick={exportDraft}><DownloadSimple aria-hidden="true" size={18} /></button></div>
          </div>
          {isVideo ? (
            <div className="pa-studio-canvas__empty"><Sparkle aria-hidden="true" size={40} weight="duotone" /><strong>视频生成暂未开放</strong><p>后续版本将根据明确授权接入视频能力；当前不会保存任务或伪造结果。</p></div>
          ) : (
            <div className="pa-manual-editor">
              <div className="pa-manual-editor__notice"><PencilSimple aria-hidden="true" size={18} /><span>点击「开始生成」由 Harness 文本模型流式产出；也可直接在下方手动写作，内容会随草稿保存。</span></div>
              <label htmlFor="pa-manual-content">{isImage ? '图片构思、提示词补充或版权说明' : '正文草稿'}</label>
              <textarea id="pa-manual-content" value={content} onChange={(event) => setContent(event.target.value)} placeholder={isImage ? '记录画面主体、构图、光线和需要规避的元素…' : generating ? '正在生成…' : '从这里开始手动写作，或点击「开始生成」由模型产出…'} />
              <div className="pa-manual-editor__footer"><span>{content.length} 字</span><span>{creationId ? '已建立本地草稿' : '尚未保存'}</span></div>
            </div>
          )}
        </section>
      </div>
      )}
    </div>
  )
}

function CreationCard({ creation, onOpen, onStatus, onDelete }: {
  creation: CreationRecord
  onOpen: (creation: CreationRecord) => void
  onStatus: (id: string, status: CreationStatus) => void
  onDelete: (id: string) => void
}) {
  return (
    <article className="pa-panel pa-creation-card">
      {creation.coverAssetId ? (
        <div className="pa-creation-card__cover"><img src={`/api/paipiange.asset?id=${encodeURIComponent(creation.coverAssetId)}`} alt={`${creation.title} 封面`} loading="lazy" /></div>
      ) : (
        <div className="pa-creation-card__icon"><FileText aria-hidden="true" size={23} weight="duotone" /></div>
      )}
      <div className="pa-creation-card__body">
        <div className="pa-creation-card__meta"><span className="pa-status-badge" data-status={creation.status}>{statusLabels[creation.status]}</span><span>{studioLabels[creation.studio]}</span><span>{formatLocalTime(creation.updatedAt)}</span></div>
        <h2>{creation.title}</h2>
        <p>{creation.content.trim() || creation.topic || '尚未填写正文内容'}</p>
      </div>
      <div className="pa-creation-card__actions">
        <button type="button" className="pa-secondary-button" onClick={() => onOpen(creation)}><PencilSimple aria-hidden="true" size={16} />继续编辑</button>
        {creation.status === 'archived' ? (
          <button type="button" className="pa-icon-button" aria-label={`恢复 ${creation.title}`} title="恢复" onClick={() => onStatus(creation.id, 'draft')}><ArrowCounterClockwise aria-hidden="true" size={18} /></button>
        ) : (
          <button type="button" className="pa-icon-button" aria-label={`归档 ${creation.title}`} title="归档" onClick={() => onStatus(creation.id, 'archived')}><Archive aria-hidden="true" size={18} /></button>
        )}
        <button type="button" className="pa-icon-button pa-danger-button" aria-label={`删除 ${creation.title}`} title="删除" onClick={() => onDelete(creation.id)}><Trash aria-hidden="true" size={18} /></button>
      </div>
    </article>
  )
}

function HistoryPage({ creations, onOpen, onStatus, onDelete, onCreate }: {
  creations: CreationRecord[]
  onOpen: (creation: CreationRecord) => void
  onStatus: (id: string, status: CreationStatus) => void
  onDelete: (id: string) => void
  onCreate: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'active' | 'archived'>('active')
  const visible = creations.filter((creation) => {
    const matchesStatus = filter === 'archived' ? creation.status === 'archived' : creation.status !== 'archived'
    const haystack = `${creation.title}${creation.topic}${creation.content}${studioLabels[creation.studio]}`.toLowerCase()
    return matchesStatus && haystack.includes(query.trim().toLowerCase())
  })

  return (
    <div className="pa-page">
      <PageIntro title="创作记录" description="搜索、继续编辑、归档和管理保存在当前浏览器中的真实草稿。" action="新建创作" onAction={onCreate} />
      <div className="pa-record-toolbar">
        <label className="pa-record-search"><MagnifyingGlass aria-hidden="true" size={17} /><span className="pa-visually-hidden">搜索创作记录</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、主题或正文" /></label>
        <div className="pa-segmented" aria-label="记录状态筛选">
          <button type="button" data-active={filter === 'active'} onClick={() => setFilter('active')}>进行中</button>
          <button type="button" data-active={filter === 'archived'} onClick={() => setFilter('archived')}>已归档</button>
        </div>
      </div>
      {visible.length ? <div className="pa-creation-list">{visible.map((creation) => <CreationCard key={creation.id} creation={creation} onOpen={onOpen} onStatus={onStatus} onDelete={onDelete} />)}</div> : (
        <section className="pa-panel pa-large-empty"><div className="pa-large-empty__icon"><ClockCounterClockwise aria-hidden="true" size={27} weight="duotone" /></div><h2>{query ? '没有匹配的创作记录' : filter === 'archived' ? '暂时没有归档内容' : '暂无创作记录'}</h2><p>保存草稿后即可在这里继续编辑、加入待发布列表或归档。</p><button type="button" className="pa-secondary-button" onClick={onCreate}>开始创作</button></section>
      )}
    </div>
  )
}

function WorkspacePage({ page, creations, storageSource, onNavigate, onOpenStudio, onOpenCreation, onStatus, onDelete, onToast }: {
  page: Exclude<PageId, 'home' | 'create'>
  creations: CreationRecord[]
  storageSource: 'host' | 'local' | 'loading'
  onNavigate: (page: PageId) => void
  onOpenStudio: (studio: StudioId) => void
  onOpenCreation: (creation: CreationRecord) => void
  onStatus: (id: string, status: CreationStatus) => void
  onDelete: (id: string) => void
  onToast: (message: string, tone?: ToastState['tone']) => void
}) {
  const meta = pageMeta[page]

  if (page === 'history') return <HistoryPage creations={creations} onOpen={onOpenCreation} onStatus={onStatus} onDelete={onDelete} onCreate={() => onOpenStudio('article')} />
  if (page === 'publish') return <PublishQueuePage creations={creations} onOpen={onOpenCreation} onToast={onToast} />

  if (page === 'analytics') {
    return <AnalyticsPage creations={creations} storageSource={storageSource} studioLabels={studioLabels} />
  }

  if (page === 'inspiration') {
    return <InspirationPage onOpenStudio={() => onOpenStudio('article')} onToast={onToast} />
  }

  if (page === 'assets') {
    return <AssetsPage onToast={onToast} />
  }

  if (page === 'settings') {
    return (
      <div className="pa-page">
        <PageIntro title={meta.title} description={meta.description} />
        <div className="pa-settings-grid">
          <TextGenSettings onToast={onToast} />
          <ImageGenSettings onToast={onToast} />
          {[['本地草稿', storageSource === 'host' ? `已连接本地服务，当前共 ${creations.length} 条记录保存在 Host SQLite。` : `当前共 ${creations.length} 条记录，保存在浏览器本地（Host 未连接时降级）。`], ['主题与界面', '当前使用暖棕金国风深色主题。']].map(([title, description], index) => <section key={title} className="pa-panel pa-setting-card"><div className="pa-setting-card__icon">{index === 0 ? <FolderOpen aria-hidden="true" size={23} /> : <GearSix aria-hidden="true" size={23} />}</div><div><h2>{title}</h2><p>{description}</p></div><button type="button" className="pa-secondary-button" onClick={() => onToast(index === 0 ? (storageSource === 'host' ? '草稿保存在本地 Host SQLite 数据库' : '草稿仅保存在当前浏览器，不会上传或提交到仓库') : `主题切换将在后续功能阶段接入`)}>查看</button></section>)}
        </div>
      </div>
    )
  }

  // All known pages are handled above; fall back to a neutral empty state.
  return (
    <div className="pa-page">
      <PageIntro title={meta.title} description={meta.description} />
      <section className="pa-panel pa-large-empty"><div className="pa-large-empty__icon"><CloudArrowUp aria-hidden="true" size={27} weight="duotone" /></div><h2>{meta.title}</h2><p>{meta.description}</p></section>
    </div>
  )
}

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
  const [toast, setToast] = useState<ToastState | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  const showToast = (message: string, tone: ToastState['tone'] = 'info') => setToast({ message, tone })

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

  return (
    <div className="pa-root">
      <a className="pa-skip-link" href="#pa-main-content">跳到主要内容</a>
      <Sidebar activePage={activePage} collapsed={collapsed} mobileOpen={mobileOpen} recentCreations={creations.filter((item) => item.status !== 'archived')} onNavigate={navigate} onOpenCreation={openCreation} onCollapse={() => setCollapsed((value) => !value)} onCloseMobile={() => setMobileOpen(false)} />
      <div className="pa-main-shell">
        <Topbar activePage={activePage} studio={studio} onBack={goBack} onHome={() => navigate('home')} onOpenMobile={() => setMobileOpen(true)} onSearch={search} onToast={showToast} />
        <main id="pa-main-content" className="pa-content" ref={mainRef} tabIndex={-1}>
          {activePage === 'home' && !studio && <HomePage inspirationIndex={inspirationIndex} activeCategory={activeCategory} creations={creations} onCategory={setActiveCategory} onShuffle={shuffleInspiration} onOpenStudio={openStudio} onOpenCreation={openCreation} onNavigate={navigate} onToast={showToast} />}
          {activePage === 'create' && !studio && <CreateHub onOpenStudio={openStudio} />}
          {studio && <StudioPage studio={studio} initialCreation={selectedCreation} onBack={() => { setStudio(null); setSelectedCreation(null) }} onSave={saveCreation} onToast={showToast} />}
          {activePage !== 'home' && activePage !== 'create' && !studio && <WorkspacePage page={activePage} creations={creations} storageSource={storageSource} onNavigate={navigate} onOpenStudio={openStudio} onOpenCreation={openCreation} onStatus={setCreationStatus} onDelete={deleteCreation} onToast={showToast} />}
        </main>
      </div>
      {toast && <div className="pa-toast" data-tone={toast.tone} role="status" aria-live="polite"><CheckCircle aria-hidden="true" size={20} weight="fill" /><span>{toast.message}</span><button type="button" aria-label="关闭提示" onClick={() => setToast(null)}><X aria-hidden="true" size={16} /></button></div>}
    </div>
  )
}
