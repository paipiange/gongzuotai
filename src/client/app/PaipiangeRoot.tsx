import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  CloudArrowUp,
  Copy,
  DownloadSimple,
  FilmSlate,
  FolderOpen,
  GearSix,
  ImageSquare,
  List,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
  Shuffle,
  SidebarSimple,
  Sparkle,
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
  onNavigate,
  onCollapse,
  onCloseMobile,
}: {
  activePage: PageId
  collapsed: boolean
  mobileOpen: boolean
  onNavigate: (page: PageId) => void
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

        <button type="button" className="pa-sidebar-search" onClick={() => onNavigate('home')}>
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
          <div className="pa-sidebar__empty">暂无真实创作记录</div>
        </div>

        <div className="pa-sidebar__bottom">
          <button type="button" className="pa-model-card" onClick={() => onNavigate('settings')}>
            <Sparkle aria-hidden="true" size={22} weight="duotone" />
            <span><strong>模型与设置</strong><small>连接 Harness 模型</small></span>
            <CaretRight aria-hidden="true" size={16} />
          </button>
          <button type="button" className="pa-settings-link" onClick={() => onNavigate('settings')}>
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

function HomePage({
  inspirationIndex,
  activeCategory,
  onCategory,
  onShuffle,
  onOpenStudio,
  onNavigate,
  onToast,
}: {
  inspirationIndex: number
  activeCategory: string
  onCategory: (category: string) => void
  onShuffle: () => void
  onOpenStudio: (studio: StudioId) => void
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
          <EmptyState title="还没有创作记录" description="完成并保存内容后，会在这里显示真实的本地记录。" action="开始创作" onAction={() => onOpenStudio('article')} />
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

function StudioPage({ studio, onBack, onToast }: { studio: StudioId; onBack: () => void; onToast: (message: string, tone?: ToastState['tone']) => void }) {
  const [topic, setTopic] = useState('')
  const isVideo = studio === 'video'
  const isImage = studio === 'image'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (isVideo) {
      onToast('视频生成暂未开放，不会创建真实任务', 'warning')
      return
    }
    if (!topic.trim()) {
      onToast('请先填写创作主题', 'warning')
      return
    }
    onToast(isImage ? '请先在设置中心配置图片 Provider' : '请先在设置中心选择可用的 Harness 文本模型', 'warning')
  }

  return (
    <div className="pa-page pa-studio-page">
      <div className="pa-studio-heading">
        <button type="button" className="pa-icon-button" aria-label="返回 AI 创作" onClick={onBack}><ArrowLeft aria-hidden="true" size={19} /></button>
        <div><span className="pa-overline">CREATION STUDIO</span><h1>{studioLabels[studio]}</h1><p>{isVideo ? '完整界面占位，不调用模型、不扣费、不创建任务。' : '填写创作要求，模型接入将在后续阶段启用。'}</p></div>
      </div>
      <div className="pa-studio-layout">
        <form className="pa-panel pa-studio-form" onSubmit={submit}>
          <SectionHeading title="创作参数" />
          <label className="pa-field"><span>创作类型</span><select defaultValue={studio}><option value={studio}>{studioLabels[studio]}</option></select></label>
          <label className="pa-field"><span>主题 / 关键词 <b aria-hidden="true">*</b></span><textarea value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={300} placeholder="例如：以江南春日为主题，写一篇有画面感的品牌故事" /><small>{topic.length}/300</small></label>
          <label className="pa-field"><span>内容风格</span><select defaultValue="cinematic"><option value="cinematic">电影感叙事</option><option value="poetic">东方诗意</option><option value="clear">清晰专业</option><option value="lively">轻松活泼</option></select></label>
          <label className="pa-field"><span>补充要求</span><input placeholder="目标受众、篇幅、结构或画面比例" /></label>
          <button type="submit" className="pa-primary-button pa-studio-submit" disabled={isVideo} aria-describedby={isVideo ? 'video-disabled-hint' : undefined}>
            <Sparkle aria-hidden="true" size={18} weight="fill" />{isVideo ? '功能暂未开放' : '开始生成'}
          </button>
          {isVideo && <p id="video-disabled-hint" className="pa-form-notice">视频功能仅展示界面，不会发送任何生成请求。</p>}
        </form>
        <section className="pa-panel pa-studio-canvas">
          <div className="pa-studio-canvas__toolbar">
            <span>创作画布</span>
            <div><button type="button" className="pa-icon-button" aria-label="复制" onClick={() => onToast('当前没有可复制的内容')}><Copy aria-hidden="true" size={18} /></button><button type="button" className="pa-icon-button" aria-label="导出" onClick={() => onToast('保存内容后即可导出')}><DownloadSimple aria-hidden="true" size={18} /></button></div>
          </div>
          <div className="pa-studio-canvas__empty">
            {isImage ? <ImageSquare aria-hidden="true" size={40} weight="duotone" /> : <Sparkle aria-hidden="true" size={40} weight="duotone" />}
            <strong>{isVideo ? '视频生成暂未开放' : '等待开始创作'}</strong>
            <p>{isVideo ? '后续版本将根据明确授权接入视频能力。' : '生成结果会显示在这里；无模型时绝不使用固定样例冒充结果。'}</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="pa-metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

function WorkspacePage({ page, onNavigate, onOpenStudio, onToast }: { page: Exclude<PageId, 'home' | 'create'>; onNavigate: (page: PageId) => void; onOpenStudio: (studio: StudioId) => void; onToast: (message: string, tone?: ToastState['tone']) => void }) {
  const meta = pageMeta[page]

  if (page === 'analytics') {
    return (
      <div className="pa-page">
        <PageIntro title={meta.title} description={meta.description} />
        <div className="pa-metrics-grid"><MetricCard label="创作总数" value="0" note="仅统计真实本地记录" /><MetricCard label="近 7 天" value="0" note="尚无生成任务" /><MetricCard label="已导出" value="0" note="本地导出记录" /><MetricCard label="模型用量" value="—" note="模型连接后显示" /></div>
        <section className="pa-panel pa-chart-panel"><SectionHeading title="近 7 天创作趋势" /><div className="pa-chart-empty"><ChartBars /><p>完成创作后，这里会显示真实趋势，不使用虚构数据。</p></div></section>
      </div>
    )
  }

  if (page === 'inspiration') {
    return (
      <div className="pa-page">
        <PageIntro title={meta.title} description={meta.description} action="随机灵感" onAction={() => onToast('已为你切换一组灵感', 'success')} />
        <div className="pa-inspiration-grid">
          {inspirations.map((item, index) => <button key={item.title} type="button" className="pa-inspiration-tile" onClick={() => onOpenStudio('article')}><ScenicArt variant={item.art} label={`${item.title}原创插画`} /><span><small>{item.eyebrow}</small><strong>{item.title}</strong><p>{item.description}</p></span><b>{String(index + 1).padStart(2, '0')}</b></button>)}
        </div>
      </div>
    )
  }

  if (page === 'settings') {
    return (
      <div className="pa-page">
        <PageIntro title={meta.title} description={meta.description} />
        <div className="pa-settings-grid">
          {[['文本模型', '复用 Harness 已配置的模型，不在浏览器保存密钥。'], ['图片 Provider', '未配置。后续通过 Host 安全读取凭证。'], ['本地存储', '数据目录将在持久化阶段启用。'], ['主题与界面', '当前使用暖棕金国风深色主题。']].map(([title, description], index) => <section key={title} className="pa-panel pa-setting-card"><div className="pa-setting-card__icon">{index === 0 ? <Sparkle aria-hidden="true" size={23} /> : index === 1 ? <ImageSquare aria-hidden="true" size={23} /> : index === 2 ? <FolderOpen aria-hidden="true" size={23} /> : <GearSix aria-hidden="true" size={23} />}</div><div><h2>{title}</h2><p>{description}</p></div><button type="button" className="pa-secondary-button" onClick={() => onToast(`${title}将在后续功能阶段接入`)}>配置</button></section>)}
        </div>
      </div>
    )
  }

  const content = {
    assets: { icon: <CloudArrowUp aria-hidden="true" size={27} weight="duotone" />, title: '素材库还是空的', description: '后续可导入图片、文稿、提示词与文件；当前阶段先完成界面结构。', action: '导入素材' },
    publish: { icon: <PaperPlaneTilt aria-hidden="true" size={27} weight="duotone" />, title: '暂无待发布内容', description: '第一版仅管理本地发布队列和导出，不会自动登录或发布到第三方平台。', action: '查看创作' },
    history: { icon: <ClockCounterClockwise aria-hidden="true" size={27} weight="duotone" />, title: '暂无创作记录', description: '保存真实草稿后可在这里搜索、恢复、导出与归档。', action: '开始创作' },
  }[page]

  return (
    <div className="pa-page">
      <PageIntro title={meta.title} description={meta.description} action={page === 'assets' ? '导入素材' : undefined} onAction={() => onToast('本地数据功能将在后续阶段启用')} />
      <section className="pa-panel pa-large-empty">
        <div className="pa-large-empty__icon">{content.icon}</div><h2>{content.title}</h2><p>{content.description}</p>
        <button type="button" className="pa-secondary-button" onClick={() => page === 'history' || page === 'publish' ? onNavigate('create') : onToast('素材导入将在本地存储阶段启用')}>{content.action}</button>
      </section>
    </div>
  )
}

function ChartBars() {
  return <div className="pa-chart-bars" aria-label="空数据趋势图"><i style={{ height: '18%' }} /><i style={{ height: '26%' }} /><i style={{ height: '22%' }} /><i style={{ height: '32%' }} /><i style={{ height: '25%' }} /><i style={{ height: '20%' }} /><i style={{ height: '28%' }} /></div>
}

export function PaipiangeRoot() {
  const [activePage, setActivePage] = useState<PageId>('home')
  const [studio, setStudio] = useState<StudioId | null>(null)
  const [activeCategory, setActiveCategory] = useState('热门推荐')
  const [inspirationIndex, setInspirationIndex] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  const showToast = (message: string, tone: ToastState['tone'] = 'info') => setToast({ message, tone })

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
    setMobileOpen(false)
  }

  const openStudio = (id: StudioId) => {
    setActivePage('create')
    setStudio(id)
    setMobileOpen(false)
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
    if (action) {
      openStudio(action.id)
      showToast(`已找到：${action.title}`, 'success')
    } else if (template) {
      showToast(`已找到模板：${template.title}`, 'success')
    } else {
      showToast('暂未找到匹配内容', 'warning')
    }
  }

  const goBack = () => {
    if (studio) setStudio(null)
    else navigate('home')
  }

  return (
    <div className="pa-root">
      <a className="pa-skip-link" href="#pa-main-content">跳到主要内容</a>
      <Sidebar activePage={activePage} collapsed={collapsed} mobileOpen={mobileOpen} onNavigate={navigate} onCollapse={() => setCollapsed((value) => !value)} onCloseMobile={() => setMobileOpen(false)} />
      <div className="pa-main-shell">
        <Topbar activePage={activePage} studio={studio} onBack={goBack} onHome={() => navigate('home')} onOpenMobile={() => setMobileOpen(true)} onSearch={search} onToast={showToast} />
        <main id="pa-main-content" className="pa-content" ref={mainRef} tabIndex={-1}>
          {activePage === 'home' && !studio && <HomePage inspirationIndex={inspirationIndex} activeCategory={activeCategory} onCategory={setActiveCategory} onShuffle={shuffleInspiration} onOpenStudio={openStudio} onNavigate={navigate} onToast={showToast} />}
          {activePage === 'create' && !studio && <CreateHub onOpenStudio={openStudio} />}
          {studio && <StudioPage studio={studio} onBack={() => setStudio(null)} onToast={showToast} />}
          {activePage !== 'home' && activePage !== 'create' && !studio && <WorkspacePage page={activePage} onNavigate={navigate} onOpenStudio={openStudio} onToast={showToast} />}
        </main>
      </div>
      {toast && <div className="pa-toast" data-tone={toast.tone} role="status" aria-live="polite"><CheckCircle aria-hidden="true" size={20} weight="fill" /><span>{toast.message}</span><button type="button" aria-label="关闭提示" onClick={() => setToast(null)}><X aria-hidden="true" size={16} /></button></div>}
    </div>
  )
}
