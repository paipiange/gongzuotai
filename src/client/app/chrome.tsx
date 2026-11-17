import {
  ArrowLeft,
  ArrowRight,
  Bell,
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
import { FormEvent, useState } from 'react'
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

export function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section className="pa-hero" style={{ backgroundImage: `url(${HERO_BG})` }}>
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
