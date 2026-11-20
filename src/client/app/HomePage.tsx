import { ArrowRight, CaretRight, FileText, Shuffle, Sparkle } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { categoryPills, inspirations, quickActions, templates, type PageId, type QuickAction, type StudioId } from './data'
import type { CreationRecord } from './workspaceStore'
import { EmptyState, ScenicArt, SectionHeading, formatLocalTime, statusLabels, studioLabels, type ToastState } from './primitives'
import { Hero } from './chrome'

export function InspirationCard({ index, onShuffle, onCreate }: { index: number; onShuffle: () => void; onCreate: () => void }) {
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

export function QuickCard({ item, onOpen }: { item: QuickAction; onOpen: (id: StudioId) => void }) {
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

export function RecentCreationList({ creations, onOpen }: { creations: CreationRecord[]; onOpen: (creation: CreationRecord) => void }) {
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

export function HomePage({
  inspirationIndex,
  activeCategory,
  creations,
  carouselImages,
  carouselIntervalMs,
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
  carouselImages?: string[]
  carouselIntervalMs?: number
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
        <Hero onStart={() => onOpenStudio('article')} images={carouselImages} intervalMs={carouselIntervalMs} />
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
