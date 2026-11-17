import { ClockCounterClockwise, ArrowClockwise, TextAa, ImageSquare, VideoCamera, CheckCircle, XCircle, CaretRight, Eye, ArrowSquareOut, MagnifyingGlass } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { getTask, listTasks, assetUrl, type TaskKind, type TaskRecord, type TaskStatus } from './hostClient'
import { Lightbox, absoluteAssetUrl } from './Lightbox'

type Toast = (message: string, tone?: 'info' | 'success' | 'warning') => void

const KIND_LABEL: Record<TaskKind, string> = { text: '文字', image: '图片', video: '视频' }
const STATUS_LABEL: Record<TaskStatus, string> = { running: '进行中', success: '成功', failed: '失败' }

function formatTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

/** 一段用于展示的 JSON，缩进 2 空格、截断超长字符串。 */
function prettyJson(value: unknown): string {
  if (value === undefined || value === null) return '（空）'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * 生成记录页：展示每一次生成（文字/图片，成功/失败）的请求参数与返回日志，
 * 支持查看详情，以及一键回填到创作画布继续修改。
 */
export function GenerationLogPage({ onResume, onToast }: { onResume: (task: TaskRecord) => void; onToast: Toast }) {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [kindFilter, setKindFilter] = useState<'all' | TaskKind>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detail, setDetail] = useState<TaskRecord | null>(null)
  const [lightbox, setLightbox] = useState<{ ids: string[]; index: number } | null>(null)

  const PAGE_SIZE = 50

  // Debounce the search box so we don't hit the backend on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  const load = async (reset: boolean) => {
    const nextOffset = reset ? 0 : offset
    if (reset) setLoaded(false)
    else setLoadingMore(true)
    try {
      const list = await listTasks({
        kind: kindFilter === 'all' ? undefined : kindFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        query: debouncedQuery || undefined,
        limit: PAGE_SIZE,
        offset: nextOffset,
      })
      setTasks((current) => (reset ? list : [...current, ...list]))
      setOffset(nextOffset + list.length)
      setHasMore(list.length === PAGE_SIZE)
    } catch {
      onToast('无法读取生成记录，本地服务未连接', 'warning')
    } finally {
      setLoaded(true)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void load(true)
  }, [kindFilter, statusFilter, debouncedQuery])

  const loadMore = () => {
    if (loadingMore || !hasMore) return
    void load(false)
  }

  const openDetail = async (task: TaskRecord) => {
    try {
      setDetail(await getTask(task.id))
    } catch {
      setDetail(task)
    }
  }

  const summaryOf = (task: TaskRecord): string => {
    if (task.kind === 'text') {
      return String(task.input.topic ?? task.input.studio ?? '')
    }
    if (task.kind === 'video') {
      return String(task.input.topic ?? '')
    }
    return String(task.input.prompt ?? '')
  }

  /** 从 input 提取请求参数摘要（图片：模型/尺寸/参考图数；文本：模型/风格）。 */
  const paramSummary = (task: TaskRecord): string[] => {
    const out: string[] = []
    if (task.kind === 'image') {
      const w = task.input.width
      const h = task.input.height
      const size = task.input.size
      if (w && h) out.push(`${w}×${h}`)
      else if (size) out.push(`${size}×${size}`)
      const refCount = Number(task.input.referenceImageCount ?? 0)
      if (refCount > 0) out.push(`参考图 ${refCount}`)
      const model = task.input.model
      if (model) out.push(`模型 ${String(model)}`)
    } else if (task.kind === 'text') {
      if (task.input.style) out.push(String(task.input.style))
    }
    return out
  }

  /** 从成功任务的 result 中提取文字正文。 */
  const resultText = (task: TaskRecord): string | null => {
    const result = task.result as { text?: unknown }
    return typeof result?.text === 'string' ? result.text : null
  }

  /** 从成功图片任务的 result 中提取图片 asset id 列表。 */
  const resultImageIds = (task: TaskRecord): string[] => {
    const result = task.result as { images?: Array<{ id?: unknown }> }
    if (!Array.isArray(result?.images)) return []
    return result.images.map((img) => img?.id).filter((id): id is string => typeof id === 'string')
  }

  /** 从成功视频任务的 result 中提取视频 asset id。 */
  const resultVideoId = (task: TaskRecord): string | null => {
    const result = task.result as { assetId?: unknown }
    return typeof result?.assetId === 'string' ? result.assetId : null
  }

  /** 请求参数里的参考图 asset id 列表（后端把 data URL 转存成了 asset）。 */
  const referenceImageIds = (task: TaskRecord): string[] => {
    const refs = task.input.referenceImages
    if (!Array.isArray(refs)) return []
    return refs.filter((id): id is string => typeof id === 'string')
  }

  /**
   * 把请求参数 input 拆成「可读字段」列表：跳过 referenceImages（单独渲染成图）
   * 和空值字段；超长字符串（如 prompt）截断展示，避免撑爆弹窗。
   */
  const inputFields = (task: TaskRecord): Array<{ key: string; value: string }> => {
    const skip = new Set(['referenceImages'])
    const out: Array<{ key: string; value: string }> = []
    for (const [key, raw] of Object.entries(task.input)) {
      if (skip.has(key)) continue
      if (raw === undefined || raw === null || raw === '') continue
      if (typeof raw === 'object') {
        out.push({ key, value: prettyJson(raw) })
        continue
      }
      let text = String(raw)
      if (text.length > 600) text = `${text.slice(0, 600)}…（共 ${text.length} 字）`
      out.push({ key, value: text })
    }
    return out
  }

  return (
    <div className="pa-page">
      <div className="pa-page-intro">
        <div>
          <span className="pa-overline">PAIPIANGE WORKSPACE</span>
          <h1>生成记录</h1>
          <p>每一次生成（无论成功或失败）都会留下记录，可查看请求参数与返回日志，并一键继续修改。</p>
        </div>
        <button type="button" className="pa-secondary-button" onClick={() => load(true)}><ArrowClockwise aria-hidden="true" size={16} />刷新</button>
      </div>

      <div className="pa-record-toolbar">
        <label className="pa-record-search"><MagnifyingGlass aria-hidden="true" size={17} /><span className="pa-visually-hidden">搜索生成记录</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词、结果或错误信息" /></label>
        <div className="pa-segmented" aria-label="类型筛选">
          <button type="button" data-active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>全部</button>
          <button type="button" data-active={kindFilter === 'text'} onClick={() => setKindFilter('text')}>文字</button>
          <button type="button" data-active={kindFilter === 'image'} onClick={() => setKindFilter('image')}>图片</button>
          <button type="button" data-active={kindFilter === 'video'} onClick={() => setKindFilter('video')}>视频</button>
        </div>
        <div className="pa-segmented" aria-label="状态筛选">
          <button type="button" data-active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>全部状态</button>
          <button type="button" data-active={statusFilter === 'success'} onClick={() => setStatusFilter('success')}>成功</button>
          <button type="button" data-active={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')}>失败</button>
        </div>
      </div>

      {!loaded ? (
        <section className="pa-panel pa-large-empty"><div className="pa-large-empty__icon"><ClockCounterClockwise aria-hidden="true" size={27} weight="duotone" /></div><h2>正在加载…</h2></section>
      ) : tasks.length === 0 ? (
        <section className="pa-panel pa-large-empty"><div className="pa-large-empty__icon"><ClockCounterClockwise aria-hidden="true" size={27} weight="duotone" /></div><h2>{query ? '没有匹配的生成记录' : '暂无生成记录'}</h2><p>去「AI 创作」生成文字或图片后，这里会记录每次请求与结果。</p></section>
      ) : (
        <>
        <ul className="pa-task-list">
          {tasks.map((task) => {
            const KindIcon = task.kind === 'text' ? TextAa : task.kind === 'image' ? ImageSquare : VideoCamera
            return (
              <li key={task.id} className="pa-task-row">
                <div className="pa-task-row__icon"><KindIcon aria-hidden="true" size={20} /></div>
                <div className="pa-task-row__body">
                  <div className="pa-task-row__title">
                    <span className="pa-status-badge" data-status={task.status}>{STATUS_LABEL[task.status]}</span>
                    <span className="pa-task-row__kind">{KIND_LABEL[task.kind]}</span>
                    <span className="pa-task-row__summary">{summaryOf(task)}</span>
                  </div>
                  <div className="pa-task-row__meta">
                    <span>{formatTime(task.createdAt)}</span>
                    {task.modelId && <span>{task.modelId}</span>}
                    {paramSummary(task).map((s) => <span key={s} className="pa-task-row__param">{s}</span>)}
                    {task.status === 'failed' && task.errorMessage && <span className="pa-task-row__error">{task.errorMessage}</span>}
                  </div>
                </div>
                <div className="pa-task-row__actions">
                  <button type="button" className="pa-icon-button" title="查看详情" onClick={() => openDetail(task)}><Eye aria-hidden="true" size={17} /></button>
                  <button type="button" className="pa-secondary-button" onClick={() => onResume(task)}><ArrowClockwise aria-hidden="true" size={14} />继续修改</button>
                </div>
              </li>
            )
          })}
        </ul>
        {hasMore && (
          <div className="pa-load-more">
            <button type="button" className="pa-secondary-button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? '加载中…' : `加载更多（已显示 ${tasks.length} 条）`}
            </button>
          </div>
        )}
        </>
      )}

      {detail && (
        <div className="pa-modal-backdrop" onClick={() => setDetail(null)}>
          <div className="pa-modal" onClick={(event) => event.stopPropagation()}>
            <div className="pa-modal__head">
              <h3>生成详情</h3>
              <button type="button" className="pa-icon-button" onClick={() => setDetail(null)} aria-label="关闭">✕</button>
            </div>
            <div className="pa-modal__body">
              <div className="pa-task-detail__meta">
                <span className="pa-status-badge" data-status={detail.status}>{STATUS_LABEL[detail.status]}</span>
                <span>{KIND_LABEL[detail.kind]}</span>
                <span>{formatTime(detail.createdAt)}</span>
                {detail.modelId && <span>模型：{detail.modelId}</span>}
              </div>

              <section className="pa-task-detail__section">
                <h4>请求参数</h4>
                {referenceImageIds(detail).length > 0 && (
                  <div className="pa-task-detail__refs">
                    <span className="pa-task-detail__refs-label">参考图（{referenceImageIds(detail).length}）</span>
                    <div className="pa-task-detail__refs-grid">
                      {referenceImageIds(detail).map((id, idx) => (
                        <figure key={id} className="pa-task-detail__ref">
                          <button
                            type="button"
                            className="pa-task-detail__ref-btn"
                            onClick={() => setLightbox({ ids: referenceImageIds(detail), index: idx })}
                            title="点击查看大图"
                          >
                            <img src={assetUrl(id)} alt={`参考图 ${idx + 1}`} loading="lazy" />
                          </button>
                        </figure>
                      ))}
                    </div>
                  </div>
                )}
                <dl className="pa-task-detail__params">
                  {inputFields(detail).map((field) => (
                    <div key={field.key} className="pa-task-detail__param">
                      <dt>{field.key}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {detail.status === 'failed' ? (
                <section className="pa-task-detail__section">
                  <h4>错误信息</h4>
                  <div className="pa-task-detail__error">
                    {detail.errorCode && <span className="pa-task-detail__error-code">{detail.errorCode}</span>}
                    <p>{detail.errorMessage ?? '（无详细信息）'}</p>
                  </div>
                </section>
              ) : detail.kind === 'text' && resultText(detail) !== null ? (
                <section className="pa-task-detail__section">
                  <h4>返回文字</h4>
                  <pre>{resultText(detail)}</pre>
                </section>
              ) : detail.kind === 'image' && resultImageIds(detail).length > 0 ? (
                <section className="pa-task-detail__section">
                  <h4>返回图片（{resultImageIds(detail).length}）</h4>
                  <div className="pa-task-detail__images">
                    {resultImageIds(detail).map((id, idx) => (
                      <figure key={id} className="pa-task-detail__image">
                        <button type="button" className="pa-task-detail__image-btn" onClick={() => setLightbox({ ids: resultImageIds(detail), index: idx })} title="点击查看大图">
                          <img src={assetUrl(id)} alt={`生成图 ${id}`} loading="lazy" />
                        </button>
                        <figcaption>
                          <button type="button" className="pa-link-button" onClick={() => setLightbox({ ids: resultImageIds(detail), index: idx })}>查看大图</button>
                          <a className="pa-link-button" href={absoluteAssetUrl(id)} target="_blank" rel="noreferrer"><ArrowSquareOut aria-hidden="true" size={13} />浏览器打开</a>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              ) : detail.kind === 'video' && resultVideoId(detail) ? (
                <section className="pa-task-detail__section">
                  <h4>生成视频</h4>
                  <video controls src={assetUrl(resultVideoId(detail)!)} style={{ width: '100%', borderRadius: 10, background: '#000' }} />
                  <div style={{ marginTop: 8 }}>
                    <a className="pa-link-button" href={absoluteAssetUrl(resultVideoId(detail)!)} target="_blank" rel="noreferrer"><ArrowSquareOut aria-hidden="true" size={13} />浏览器打开</a>
                  </div>
                </section>
              ) : (
                <section className="pa-task-detail__section">
                  <h4>返回结果（result）</h4>
                  <pre>{prettyJson(detail.result)}</pre>
                </section>
              )}
            </div>
            <div className="pa-modal__footer">
              <button type="button" className="pa-secondary-button" onClick={() => { const t = detail; setDetail(null); onResume(t) }}>继续修改</button>
              <button type="button" className="pa-secondary-button" onClick={() => setDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {lightbox && <Lightbox assetIds={lightbox.ids} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  )
}
