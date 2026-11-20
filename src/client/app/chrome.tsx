import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CaretLeft,
  CaretRight,
  FileText,
  FilmSlate,
  GearSix,
  List,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
  Sparkle,
  X,
} from '@phosphor-icons/react'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { navigation, pageMeta, type PageId, type StudioId } from './data'
import type { CreationRecord } from './workspaceStore'
import { formatLocalTime, studioLabels, type ToastState } from './primitives'
import { HERO_BG } from './heroBackground'

export function Sidebar({
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

export function Topbar({
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

export function Hero({ onStart, images, intervalMs }: { onStart: () => void; images?: string[]; intervalMs?: number }) {
  const slides = useMemo(() => {
    if (!images || images.length === 0) return [HERO_BG]
    return images
  }, [images])

  const [active, setActive] = useState(0)
  const multi = slides.length > 1

  // 拖拽/触摸滑动切换
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)

  const goNext = () => setActive((current) => (current + 1) % slides.length)
  const goPrev = () => setActive((current) => (current - 1 + slides.length) % slides.length)

  // 自动轮播：用户交互后短暂暂停由「交互时重置定时器」实现。
  const [interactKey, setInteractKey] = useState(0)
  const interact = () => setInteractKey((k) => k + 1)

  useEffect(() => {
    if (!multi) return
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length)
    }, intervalMs && intervalMs > 0 ? intervalMs : 5000)
    return () => window.clearInterval(timer)
    // 用户交互会重置定时器（interactKey 变化触发重建），避免刚切完又被自动切走。
  }, [multi, slides.length, intervalMs, interactKey])

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!multi) return
    dragRef.current = { startX: event.clientX, startY: event.clientY, moved: false }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || !drag.moved) return
    const dx = event.clientX - drag.startX
    if (Math.abs(dx) < 40) return
    interact()
    if (dx < 0) goNext()
    else goPrev()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.moved = true
    // 水平滑动为主时阻止图片默认拖拽
    if (Math.abs(dx) > Math.abs(dy) && drag.moved) {
      event.preventDefault()
    }
  }

  return (
    <section
      className="pa-hero"
      aria-label="首页轮播图"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { dragRef.current = null }}
    >
      {slides.map((src, index) => (
        <img
          key={`${index}-${src.slice(0, 48)}`}
          src={src}
          alt={index === 0 ? '首页背景图' : `首页轮播图 ${index + 1}`}
          className="pa-hero__slide"
          data-active={index === active}
          aria-hidden={index !== active}
          draggable={false}
        />
      ))}
      {multi && (
        <>
          <button
            type="button"
            className="pa-hero__arrow pa-hero__arrow--prev"
            aria-label="上一张"
            onClick={() => { interact(); goPrev() }}
          >
            <CaretLeft aria-hidden="true" size={20} />
          </button>
          <button
            type="button"
            className="pa-hero__arrow pa-hero__arrow--next"
            aria-label="下一张"
            onClick={() => { interact(); goNext() }}
          >
            <CaretRight aria-hidden="true" size={20} />
          </button>
          <div className="pa-hero__dots" role="tablist" aria-label="轮播图切换">
            {slides.map((src, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={index === active}
                aria-label={`切换到第 ${index + 1} 张`}
                data-active={index === active}
                onClick={() => { interact(); setActive(index) }}
              />
            ))}
          </div>
        </>
      )}
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
