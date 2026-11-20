import { CloudArrowUp, FolderOpen, GearSix } from '@phosphor-icons/react'
import { pageMeta, quickActions, type PageId, type StudioId } from './data'
import type { CreationRecord, CreationStatus } from './workspaceStore'
import type { TaskRecord } from './hostClient'
import { PageIntro, SectionHeading, studioLabels, type ToastState } from './primitives'
import { QuickCard } from './HomePage'
import { HistoryPage } from './history'
import { AssetsPage, InspirationPage, PublishQueuePage } from './LibraryPages'
import { AnalyticsPage } from './AnalyticsPage'
import { BackendManager } from './BackendManager'
import { BackupSettings } from './BackupSettings'
import { ThemeSettings } from './ThemeSettings'
import { HomeCarouselSettings } from './HomeCarouselSettings'
import { TemplateManager } from './TemplateManager'
import { TemplateUsePanel } from './TemplateUsePanel'
import { UpdateCheck } from './UpdateCheck'
import { WechatSettings } from './WechatSettings'

export function CreateHub({ onOpenStudio }: { onOpenStudio: (studio: StudioId) => void }) {
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

export function WorkspacePage({ page, creations, storageSource, onNavigate, onOpenStudio, onOpenCreation, onStatus, onDelete, onToast, onRefresh, theme, onThemeChange, onResumeTask, templateResumeTask, onTemplateResumeConsumed }: {
  page: Exclude<PageId, 'home' | 'create'>
  creations: CreationRecord[]
  storageSource: 'host' | 'local' | 'loading'
  onNavigate: (page: PageId) => void
  onOpenStudio: (studio: StudioId) => void
  onOpenCreation: (creation: CreationRecord) => void
  onStatus: (id: string, status: CreationStatus) => void
  onDelete: (id: string) => void
  onToast: (message: string, tone?: ToastState['tone']) => void
  onRefresh: () => Promise<void>
  theme: string
  onThemeChange: (theme: string) => void
  onResumeTask: (task: TaskRecord) => void
  templateResumeTask: TaskRecord | null
  onTemplateResumeConsumed: () => void
}) {
  const meta = pageMeta[page]

  if (page === 'history') return <HistoryPage creations={creations} onOpen={onOpenCreation} onStatus={onStatus} onDelete={onDelete} onCreate={() => onOpenStudio('article')} onRefresh={onRefresh} onToast={onToast} onResumeTask={onResumeTask} />
  if (page === 'publish') return <PublishQueuePage creations={creations} onOpen={onOpenCreation} onToast={onToast} />

  if (page === 'analytics') {
    return <AnalyticsPage creations={creations} storageSource={storageSource} studioLabels={studioLabels} />
  }

  if (page === 'inspiration') {
    return <InspirationPage onOpenStudio={() => onOpenStudio('article')} onToast={onToast} creations={creations} />
  }

  if (page === 'assets') {
    return <AssetsPage onToast={onToast} />
  }

  if (page === 'templates') {
    return (
      <div className="pa-page">
        <PageIntro title={meta.title} description={meta.description} />
        <TemplateUsePanel onToast={onToast} resumeTask={templateResumeTask} onResumeConsumed={onTemplateResumeConsumed} />
      </div>
    )
  }

  if (page === 'settings') {
    return (
      <div className="pa-page">
        <PageIntro title={meta.title} description={meta.description} />
        <div className="pa-settings-grid">
          <BackendManager onToast={onToast} />
          <WechatSettings onToast={onToast} />
          <HomeCarouselSettings onToast={onToast} />
          <BackupSettings onToast={onToast} />
          <ThemeSettings theme={theme} onThemeChange={onThemeChange} />
          <TemplateManager onToast={onToast} />
          <UpdateCheck onToast={onToast} />
          {[['本地草稿', storageSource === 'host' ? `已连接本地服务，当前共 ${creations.length} 条记录保存在 Host SQLite。` : `当前共 ${creations.length} 条记录，保存在浏览器本地（离线模式，恢复连接后自动合并到本地服务）。`]].map(([title, description], index) => <section key={title} className="pa-panel pa-setting-card"><div className="pa-setting-card__icon">{index === 0 ? <FolderOpen aria-hidden="true" size={23} /> : <GearSix aria-hidden="true" size={23} />}</div><div><h2>{title}</h2><p>{description}</p></div><button type="button" className="pa-secondary-button" onClick={() => onToast(storageSource === 'host' ? '草稿保存在本地 Host SQLite 数据库' : '草稿暂存于浏览器本地，连接恢复后自动合并到本地服务，不会丢失')}>查看</button></section>)}
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
