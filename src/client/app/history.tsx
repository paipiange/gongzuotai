import {
  Archive,
  ArrowCounterClockwise,
  CheckSquare,
  ClockCounterClockwise,
  FileText,
  MagnifyingGlass,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'
import { useState } from 'react'
import type { CreationRecord, CreationStatus } from './workspaceStore'
import { batchCreations, type TaskRecord } from './hostClient'
import { PageIntro, formatLocalTime, statusLabels, studioLabels, type ToastState } from './primitives'
import { GenerationLogPage } from './GenerationLog'

export function CreationCard({ creation, onOpen, onStatus, onDelete, selected, onToggleSelect }: {
  creation: CreationRecord
  onOpen: (creation: CreationRecord) => void
  onStatus: (id: string, status: CreationStatus) => void
  onDelete: (id: string) => void
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  return (
    <article className="pa-panel pa-creation-card">
      {creation.coverAssetId ? (
        <div className="pa-creation-card__cover"><img src={`/api/paipiange.asset?id=${encodeURIComponent(creation.coverAssetId)}`} alt={`${creation.title} 封面`} loading="lazy" /></div>
      ) : (
        <div className="pa-creation-card__icon"><FileText aria-hidden="true" size={23} weight="duotone" /></div>
      )}
      {onToggleSelect && (
        <label className="pa-check pa-creation-card__check">
          <input type="checkbox" checked={selected ?? false} onChange={() => onToggleSelect(creation.id)} aria-label={`选择 ${creation.title}`} />
        </label>
      )}
      <div className="pa-creation-card__body">
        <div className="pa-creation-card__meta"><span className="pa-status-badge" data-status={creation.status}>{statusLabels[creation.status]}</span><span>{studioLabels[creation.studio]}</span><span>{formatLocalTime(creation.updatedAt)}</span></div>
        <h2>{creation.title}</h2>
        <p>{creation.content.trim() || creation.topic || '尚未填写正文内容'}</p>
        {creation.tags.length > 0 && <p className="pa-inspiration-tags">{creation.tags.map((t) => `#${t}`).join(' ')}</p>}
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

export function HistoryPage({ creations, onOpen, onStatus, onDelete, onCreate, onRefresh, onToast, onResumeTask }: {
  creations: CreationRecord[]
  onOpen: (creation: CreationRecord) => void
  onStatus: (id: string, status: CreationStatus) => void
  onDelete: (id: string) => void
  onCreate: () => void
  onRefresh: () => Promise<void>
  onToast: (message: string, tone?: ToastState['tone']) => void
  onResumeTask: (task: TaskRecord) => void
}) {
  const [tab, setTab] = useState<'drafts' | 'logs'>('drafts')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'active' | 'archived'>('active')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const visible = creations.filter((creation) => {
    const matchesStatus = filter === 'archived' ? creation.status === 'archived' : creation.status !== 'archived'
    const haystack = `${creation.title}${creation.topic}${creation.content}${studioLabels[creation.studio]}${creation.tags.join(' ')}`.toLowerCase()
    return matchesStatus && haystack.includes(query.trim().toLowerCase())
  })

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((current) => (current.size === visible.length ? new Set() : new Set(visible.map((c) => c.id))))
  }

  const runBatch = async (action: 'archive' | 'restore' | 'delete' | 'status', status?: CreationStatus) => {
    if (!selected.size || busy) return
    if (action === 'delete' && !window.confirm(`确定永久删除选中的 ${selected.size} 条创作记录吗？此操作无法撤销。`)) return
    setBusy(true)
    try {
      await batchCreations([...selected], action, status)
      setSelected(new Set())
      await onRefresh()
      onToast(action === 'delete' ? '批量删除完成' : action === 'archive' ? '已批量归档' : action === 'restore' ? '已批量恢复' : '批量状态更新完成', 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '批量操作失败', 'warning')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pa-page">
      <PageIntro title="创作记录" description="草稿与生成记录都在这里：继续编辑草稿，或查看每次生成的请求参数与返回日志。" action="新建创作" onAction={onCreate} />
      <div className="pa-record-tabs">
        <button type="button" className="pa-record-tab" data-active={tab === 'drafts'} onClick={() => setTab('drafts')}>草稿记录</button>
        <button type="button" className="pa-record-tab" data-active={tab === 'logs'} onClick={() => setTab('logs')}>生成记录</button>
      </div>

      {tab === 'logs' ? (
        <GenerationLogPage onResume={onResumeTask} onToast={onToast} />
      ) : (
        <>
          <div className="pa-record-toolbar">
            <label className="pa-record-search"><MagnifyingGlass aria-hidden="true" size={17} /><span className="pa-visually-hidden">搜索创作记录</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、主题、正文或标签" /></label>
            <div className="pa-segmented" aria-label="记录状态筛选">
              <button type="button" data-active={filter === 'active'} onClick={() => setFilter('active')}>进行中</button>
              <button type="button" data-active={filter === 'archived'} onClick={() => setFilter('archived')}>已归档</button>
            </div>
          </div>
          {visible.length > 0 && (
            <div className="pa-batch-bar">
              <button type="button" className="pa-secondary-button" onClick={toggleSelectAll} disabled={busy}>
                <CheckSquare aria-hidden="true" size={15} />{selected.size === visible.length ? '取消全选' : '全选'}
              </button>
              {selected.size > 0 && (
                <>
                  <span className="pa-batch-bar__count">已选 {selected.size} 项</span>
                  {filter === 'archived' ? (
                    <>
                      <button type="button" className="pa-secondary-button" onClick={() => runBatch('restore')} disabled={busy}>批量恢复</button>
                      <button type="button" className="pa-secondary-button pa-danger-button" onClick={() => runBatch('delete')} disabled={busy}>批量删除</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="pa-secondary-button" onClick={() => runBatch('archive')} disabled={busy}>批量归档</button>
                      <button type="button" className="pa-secondary-button" onClick={() => runBatch('status', 'queued')} disabled={busy}>批量加入待发布</button>
                      <button type="button" className="pa-secondary-button pa-danger-button" onClick={() => runBatch('delete')} disabled={busy}>批量删除</button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {visible.length ? <div className="pa-creation-list">{visible.map((creation) => <CreationCard key={creation.id} creation={creation} onOpen={onOpen} onStatus={onStatus} onDelete={onDelete} selected={selected.has(creation.id)} onToggleSelect={toggleSelect} />)}</div> : (
            <section className="pa-panel pa-large-empty"><div className="pa-large-empty__icon"><ClockCounterClockwise aria-hidden="true" size={27} weight="duotone" /></div><h2>{query ? '没有匹配的创作记录' : filter === 'archived' ? '暂时没有归档内容' : '暂无创作记录'}</h2><p>保存草稿后即可在这里继续编辑、加入待发布列表或归档。</p><button type="button" className="pa-secondary-button" onClick={onCreate}>开始创作</button></section>
          )}
        </>
      )}
    </div>
  )
}
