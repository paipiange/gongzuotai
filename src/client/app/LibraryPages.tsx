/**
 * Host-backed pages: assets (素材库), publish queue (发布管理) and inspiration
 * center (灵感中心). Each page loads its own data from the Host half and shows
 * a graceful empty/error state when the Host is unreachable.
 */

import {
  CloudArrowUp,
  CopySimple,
  DownloadSimple,
  FolderOpen,
  HardDrives,
  Lightbulb,
  PaperPlaneTilt,
  PencilSimple,
  TrashSimple,
  UploadSimple,
  X,
  Tag,
  Stack,
  CheckSquare,
  Sparkle,
  ArrowSquareOut,
  TrendUp,
  ArrowClockwise,
  MagnifyingGlass,
  ImageSquare,
  Eye,
  Clock,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { CreationRecord } from './workspaceStore'
import {
  assetUrl,
  batchDeleteAssets,
  batchRestoreAssets,
  deleteAsset,
  emptyTrashAssets,
  exportCreation,
  exportForPlatform,
  exportPlatformText,
  getAssetStorage,
  getPublishDetail,
  listAssets,
  listDeletedAssets,
  listInspirations,
  listPublishItems,
  listPublishAttempts,
  listTemplates,
  purgeOrphanAssets,
  refreshPublishStatus,
  retryPublish,
  schedulePublish,
  setAssetTags,
  setPublishStatus,
  suggestInspirations,
  fetchAihot,
  fetchTophubNodes,
  fetchTophubItems,
  uploadAsset,
  type AssetRecord,
  type AssetStorageStats,
  type AihotItem,
  type TophubNode,
  type TophubItem,
  type InspirationRecord,
  type PublishItem,
  type PublishDetail,
  type PublishAttempt,
  type PublishPlatform,
  type TemplateRecord,
} from './hostClient'
import { buildWechatArticleHtml, buildWechatArticlePlainText } from './wechatHtml'
import { processImage } from './imageProcessing'

type ToastTone = 'info' | 'success' | 'warning'

const PLATFORM_LABELS: Record<PublishPlatform, string> = {
  wechat: '公众号',
  xiaohongshu: '小红书',
  zhihu: '知乎',
  toutiao: '头条号',
  other: '其他',
}

/** 各平台的新建内容 / 发布页入口（跳转过去让用户粘贴发布，不代发）。 */
const PLATFORM_PUBLISH_URL: Partial<Record<PublishPlatform, string>> = {
  wechat: 'https://mp.weixin.qq.com/',
  xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish',
  zhihu: 'https://zhuanlan.zhihu.com/write',
  toutiao: 'https://mp.toutiao.com/profile_v4/graphic/publish',
}

function formatLocalTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function publishActionLabel(action: string): string {
  const labels: Record<string, string> = {
    export: '按平台导出',
    delivery_bundle: '导出交付包',
    comic_export: '导出漫画贴图包',
    wechat_draft: '同步微信公众号草稿',
    status_refresh: '刷新发布状态',
    manual_status: '手动更新状态',
  }
  return labels[action] ?? action
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

function PageIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="pa-page-intro">
      <div><span className="pa-overline">PAIPIANGE WORKSPACE</span><h1>{title}</h1><p>{description}</p></div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 素材库
// ---------------------------------------------------------------------------

export function AssetsPage({ onToast }: { onToast: (message: string, tone?: ToastTone) => void }) {
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [source, setSource] = useState<'host' | 'local' | 'loading'>('loading')
  const [kind, setKind] = useState<'all' | 'image' | 'file' | 'prompt' | 'document'>('all')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null)
  const [tagsDraft, setTagsDraft] = useState('')
  const [storageOpen, setStorageOpen] = useState(false)
  const [storageStats, setStorageStats] = useState<AssetStorageStats | null>(null)
  const [trashAssets, setTrashAssets] = useState<AssetRecord[]>([])
  const [storageBusy, setStorageBusy] = useState(false)
  const [processAsset, setProcessAsset] = useState<AssetRecord | null>(null)
  const [processMode, setProcessMode] = useState<'compress' | 'cover' | 'cover-watermark'>('compress')
  const [processWatermark, setProcessWatermark] = useState('')
  const [processPreview, setProcessPreview] = useState<{ url: string; blob: Blob } | null>(null)
  const [processBusy, setProcessBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const PAGE_SIZE = 50

  // Debounce the search box so we don't hit the backend on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  const refresh = async () => {
    try {
      const rows = await listAssets({
        kind: kind === 'all' ? undefined : kind,
        query: debouncedQuery || undefined,
        limit: PAGE_SIZE,
        offset: 0,
      })
      setAssets(rows)
      setOffset(rows.length)
      setHasMore(rows.length === PAGE_SIZE)
      setSource('host')
    } catch {
      setSource('local')
    }
  }

  const loadMore = async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const rows = await listAssets({
        kind: kind === 'all' ? undefined : kind,
        query: debouncedQuery || undefined,
        limit: PAGE_SIZE,
        offset,
      })
      setAssets((current) => [...current, ...rows])
      setOffset((current) => current + rows.length)
      setHasMore(rows.length === PAGE_SIZE)
    } catch {
      // Keep the already-loaded list on failure.
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [kind, debouncedQuery])

  const handleUpload = async (file: File) => {
    try {
      await uploadAsset(file)
      onToast(`已上传“${file.name}”`, 'success')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '上传失败', 'warning')
    }
  }

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void handleUpload(file)
    event.target.value = ''
  }

  const handleDownload = (asset: AssetRecord) => {
    const anchor = document.createElement('a')
    anchor.href = assetUrl(asset.id)
    anchor.download = asset.name
    anchor.click()
  }

  const handleDelete = async (asset: AssetRecord) => {
    if (!window.confirm(`确定将素材「${asset.name}」移入回收站吗？清空回收站前可以恢复。`)) return
    try {
      await deleteAsset(asset.id)
      onToast(`已删除「${asset.name}」`, 'success')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '删除失败', 'warning')
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelected((current) => (current.size === assets.length ? new Set() : new Set(assets.map((a) => a.id))))
  }

  const batchDelete = async () => {
    if (!selected.size) return
    if (!window.confirm(`确定将选中的 ${selected.size} 个素材移入回收站吗？清空前可以恢复。`)) return
    try {
      const { done } = await batchDeleteAssets([...selected])
      onToast(`已删除 ${done} 个素材`, 'success')
      setSelected(new Set())
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '批量删除失败', 'warning')
    }
  }

  const saveTags = async (asset: AssetRecord) => {
    const tags = tagsDraft.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean)
    try {
      await setAssetTags(asset.id, tags)
      onToast(`已更新「${asset.name}」的标签`, 'success')
      setEditingTagsId(null)
      setTagsDraft('')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '标签保存失败', 'warning')
    }
  }

  const openStorage = async () => {
    setStorageOpen(true)
    setStorageStats(null)
    try {
      const [stats, deleted] = await Promise.all([getAssetStorage(), listDeletedAssets()])
      setStorageStats(stats)
      setTrashAssets(deleted)
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '读取存储统计失败', 'warning')
    }
  }

  const emptyTrash = async () => {
    if (!storageStats?.deletedCount) return
    if (!window.confirm(`确定清空回收站吗？将永久删除 ${storageStats.deletedCount} 个已删除素材（${formatBytes(storageStats.deletedBytes)}），不可恢复。`)) return
    setStorageBusy(true)
    try {
      const result = await emptyTrashAssets()
      onToast(`已清空回收站，释放 ${formatBytes(result.freedBytes)}`, 'success')
      setStorageStats(await getAssetStorage())
      setTrashAssets([])
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '清空回收站失败', 'warning')
    } finally {
      setStorageBusy(false)
    }
  }

  const restoreTrash = async (ids: string[]) => {
    if (!ids.length) return
    setStorageBusy(true)
    try {
      const result = await batchRestoreAssets(ids)
      onToast(`已从回收站恢复 ${result.done} 个素材`, 'success')
      const [stats, deleted] = await Promise.all([getAssetStorage(), listDeletedAssets()])
      setStorageStats(stats)
      setTrashAssets(deleted)
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '恢复素材失败', 'warning')
    } finally {
      setStorageBusy(false)
    }
  }

  const purgeOrphans = async () => {
    if (!storageStats?.orphanCount) return
    if (!window.confirm(`确定清理 ${storageStats.orphanCount} 张孤儿图片（${formatBytes(storageStats.orphanBytes)}）吗？这些图片未被任何创作或公众号分镜引用，清理后不可恢复。`)) return
    setStorageBusy(true)
    try {
      const result = await purgeOrphanAssets()
      onToast(`已清理 ${result.count} 张孤儿图片，释放 ${formatBytes(result.freedBytes)}`, 'success')
      setStorageStats(await getAssetStorage())
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '清理孤儿图片失败', 'warning')
    } finally {
      setStorageBusy(false)
    }
  }

  const openProcess = (asset: AssetRecord) => {
    setProcessAsset(asset)
    setProcessMode('compress')
    setProcessWatermark('')
    setProcessPreview(null)
  }

  const closeProcess = () => {
    if (processPreview) URL.revokeObjectURL(processPreview.url)
    setProcessAsset(null)
    setProcessPreview(null)
  }

  const runProcess = async () => {
    if (!processAsset) return
    setProcessBusy(true)
    setProcessPreview(null)
    try {
      const opts = processMode === 'compress'
        ? { maxWidth: 1280, quality: 0.8 }
        : processMode === 'cover'
          ? { cover: { width: 900, height: 383 } }
          : { cover: { width: 900, height: 383 }, watermark: processWatermark.trim() || '拍片哥工作台' }
      const blob = await processImage(assetUrl(processAsset.id), opts)
      setProcessPreview({ url: URL.createObjectURL(blob), blob })
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '处理失败', 'warning')
    } finally {
      setProcessBusy(false)
    }
  }

  const saveProcessed = async () => {
    if (!processAsset || !processPreview) return
    setProcessBusy(true)
    try {
      const base = processAsset.name.replace(/\.[^.]+$/, '')
      const name = `${base}${processMode === 'compress' ? '_压缩.jpg' : '_公众号头图.jpg'}`
      const file = new File([processPreview.blob], name, { type: processPreview.blob.type || 'image/jpeg' })
      await uploadAsset(file)
      onToast(`已保存处理结果「${name}」`, 'success')
      closeProcess()
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '保存失败', 'warning')
    } finally {
      setProcessBusy(false)
    }
  }

  return (
    <div className="pa-page">
      <PageIntro title="素材库" description="统一管理图片、文字、提示词与文件。" />
      <div className="pa-record-toolbar">
        <label className="pa-record-search"><MagnifyingGlass aria-hidden="true" size={17} /><span className="pa-visually-hidden">搜索素材</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索素材名称或标签" /></label>
        <div className="pa-segmented" aria-label="素材类型筛选">
          {(['all', 'image', 'file', 'prompt', 'document'] as const).map((k) => (
            <button key={k} type="button" data-active={kind === k} onClick={() => setKind(k)}>
              {k === 'all' ? '全部' : k === 'image' ? '图片' : k === 'file' ? '文件' : k === 'prompt' ? '提示词' : '文稿'}
            </button>
          ))}
        </div>
        <button type="button" className="pa-secondary-button" onClick={() => fileInputRef.current?.click()}>
          <UploadSimple aria-hidden="true" size={17} />导入素材
        </button>
        <button type="button" className="pa-secondary-button" onClick={() => void openStorage()}>
          <HardDrives aria-hidden="true" size={17} />存储清理
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={onPick} />
      </div>

      {assets.length > 0 && (
        <div className="pa-batch-bar">
          <button type="button" className="pa-secondary-button" onClick={toggleSelectAll}>
            <CheckSquare aria-hidden="true" size={15} />{selected.size === assets.length ? '取消全选' : '全选'}
          </button>
          {selected.size > 0 && (
            <>
              <span className="pa-batch-bar__count">已选 {selected.size} 项</span>
              <button type="button" className="pa-secondary-button pa-danger-button" onClick={batchDelete}>
                <TrashSimple aria-hidden="true" size={15} />批量删除
              </button>
            </>
          )}
        </div>
      )}

      {source === 'loading' ? (
        <section className="pa-panel pa-large-empty"><p>正在读取素材库…</p></section>
      ) : assets.length ? (
        <div className="pa-publish-grid">
          {assets.map((asset) => (
            <article key={asset.id} className="pa-panel pa-publish-card" data-selected={selected.has(asset.id)}>
              <div className="pa-publish-card__top">
                <label className="pa-check">
                  <input type="checkbox" checked={selected.has(asset.id)} onChange={() => toggleSelect(asset.id)} aria-label={`选择 ${asset.name}`} />
                </label>
                <span className="pa-status-badge" data-status="draft">{asset.kind === 'image' ? '图片' : asset.kind}</span>
                <small>{formatLocalTime(asset.createdAt)}</small>
              </div>
              {asset.kind === 'image' ? (
                <img className="pa-asset-thumb" src={assetUrl(asset.id)} alt={asset.name} loading="lazy" />
              ) : (
                <div className="pa-asset-file-icon"><FolderOpen aria-hidden="true" size={32} /></div>
              )}
              <h2>{asset.name}</h2>
              <p>{asset.mimeType} · {Math.max(1, Math.round(asset.sizeBytes / 1024))} KB</p>
              {asset.tags.length > 0 && <p className="pa-inspiration-tags">{asset.tags.map((t) => `#${t}`).join(' ')}</p>}
              {editingTagsId === asset.id ? (
                <div className="pa-publish-url-editor">
                  <input type="text" placeholder="标签，用逗号或空格分隔" value={tagsDraft} onChange={(e) => setTagsDraft(e.target.value)} />
                  <button type="button" className="pa-secondary-button" onClick={() => saveTags(asset)}>保存</button>
                  <button type="button" className="pa-icon-button" onClick={() => { setEditingTagsId(null); setTagsDraft('') }}><X aria-hidden="true" size={16} /></button>
                </div>
              ) : (
                <div>
                  <button type="button" className="pa-secondary-button" onClick={() => handleDownload(asset)}>
                    <DownloadSimple aria-hidden="true" size={15} />下载
                  </button>
                  <button type="button" className="pa-secondary-button" onClick={() => { setEditingTagsId(asset.id); setTagsDraft(asset.tags.join(', ')) }}>
                    <Tag aria-hidden="true" size={15} />标签
                  </button>
                  {asset.kind === 'image' && (
                    <button type="button" className="pa-secondary-button" onClick={() => openProcess(asset)}>
                      <PencilSimple aria-hidden="true" size={15} />处理
                    </button>
                  )}
                  <button type="button" className="pa-icon-button" aria-label={`删除 ${asset.name}`} title="删除素材" onClick={() => handleDelete(asset)}>
                    <TrashSimple aria-hidden="true" size={16} />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <section className="pa-panel pa-large-empty">
          <div className="pa-large-empty__icon"><CloudArrowUp aria-hidden="true" size={27} weight="duotone" /></div>
          <h2>{query ? '没有匹配的素材' : '素材库还是空的'}</h2>
          <p>{source === 'host' ? (query ? '换个关键词试试。' : '点击“导入素材”上传图片、文稿或提示词，文件会保存到本地 Host 媒体目录。') : 'Host 服务未连接，暂无法读取素材库。'}</p>
          {!query && <button type="button" className="pa-secondary-button" onClick={() => fileInputRef.current?.click()}>导入素材</button>}
        </section>
      )}

      {assets.length > 0 && hasMore && (
        <div className="pa-load-more">
          <button type="button" className="pa-secondary-button" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? '加载中…' : `加载更多（已显示 ${assets.length} 个）`}
          </button>
        </div>
      )}

      {storageOpen && (
        <div className="pa-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setStorageOpen(false) }}>
          <div className="pa-modal">
            <div className="pa-modal__head">
              <h3>存储清理</h3>
              <button type="button" className="pa-icon-button" aria-label="关闭" onClick={() => setStorageOpen(false)}><X aria-hidden="true" size={17} /></button>
            </div>
            <div className="pa-modal__body">
              {!storageStats ? (
                <p className="pa-muted">正在读取存储统计…</p>
              ) : (
                <div className="pa-storage-stats">
                  <div className="pa-storage-stat">
                    <span className="pa-storage-stat__label">素材占用</span>
                    <span className="pa-storage-stat__value">{storageStats.activeCount} 项 · {formatBytes(storageStats.activeBytes)}</span>
                    <p className="pa-muted">
                      图片 {storageStats.byKind.image.count} 项 / {formatBytes(storageStats.byKind.image.bytes)}；
                      文件与文稿 {storageStats.byKind.file.count + storageStats.byKind.document.count} 项 / {formatBytes(storageStats.byKind.file.bytes + storageStats.byKind.document.bytes)}
                    </p>
                  </div>
                  <div className="pa-storage-stat">
                    <span className="pa-storage-stat__label">回收站（已删除素材）</span>
                    <span className="pa-storage-stat__value">{storageStats.deletedCount} 项 · {formatBytes(storageStats.deletedBytes)}</span>
                    <p className="pa-muted">删除的素材会先进回收站，清空后才会真正释放磁盘空间。</p>
                  </div>
                  <div className="pa-storage-stat">
                    <span className="pa-storage-stat__label">孤儿图片（未被引用）</span>
                    <span className="pa-storage-stat__value">{storageStats.orphanCount} 张 · {formatBytes(storageStats.orphanBytes)}</span>
                    <p className="pa-muted">生图过程中离开页面可能留下未被任何创作/分镜引用的图片。</p>
                  </div>
                  <div className="pa-storage-stat">
                    <span className="pa-storage-stat__label">重复文件检测</span>
                    <span className="pa-storage-stat__value">{storageStats.duplicateGroupCount} 组 · {storageStats.duplicateCount} 个副本</span>
                    <p className="pa-muted">按文件内容 SHA-256 校验，理论可节省 {formatBytes(storageStats.duplicateBytes)}。暂不自动删除，避免影响正在引用的素材。</p>
                  </div>
                  {trashAssets.length > 0 && (
                    <div className="pa-storage-stat pa-storage-trash">
                      <div className="pa-storage-trash__head">
                        <span className="pa-storage-stat__label">回收站内容</span>
                        <button type="button" className="pa-link-button" disabled={storageBusy} onClick={() => void restoreTrash(trashAssets.map((asset) => asset.id))}>恢复全部</button>
                      </div>
                      <ul className="pa-storage-trash__list">
                        {trashAssets.map((asset) => (
                          <li key={asset.id}>
                            <span>{asset.name}</span>
                            <small>{formatBytes(asset.sizeBytes)}</small>
                            <button type="button" className="pa-link-button" disabled={storageBusy} onClick={() => void restoreTrash([asset.id])}>恢复</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="pa-modal__footer">
              <button type="button" className="pa-secondary-button" disabled={!storageStats || storageBusy} onClick={() => setStorageOpen(false)}>关闭</button>
              <button type="button" className="pa-secondary-button pa-danger-button" disabled={!storageStats?.orphanCount || storageBusy} onClick={() => void purgeOrphans()}>清理孤儿图片</button>
              <button type="button" className="pa-secondary-button pa-danger-button" disabled={!storageStats?.deletedCount || storageBusy} onClick={() => void emptyTrash()}>清空回收站</button>
            </div>
          </div>
        </div>
      )}

      {processAsset && (
        <div className="pa-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeProcess() }}>
          <div className="pa-modal pa-process-modal">
            <div className="pa-modal__head">
              <h3>图片后处理</h3>
              <button type="button" className="pa-icon-button" aria-label="关闭" onClick={closeProcess}><X aria-hidden="true" size={17} /></button>
            </div>
            <div className="pa-modal__body">
              <div className="pa-process-row">
                <figure className="pa-process-preview">
                  <img src={assetUrl(processAsset.id)} alt={processAsset.name} />
                  <figcaption>原图</figcaption>
                </figure>
                {processPreview && (
                  <figure className="pa-process-preview">
                    <img src={processPreview.url} alt="处理结果预览" />
                    <figcaption>处理结果</figcaption>
                  </figure>
                )}
              </div>
              <div className="pa-segmented" role="radiogroup" aria-label="处理方式" style={{ marginTop: 14 }}>
                <button type="button" role="radio" aria-checked={processMode === 'compress'} data-active={processMode === 'compress'} onClick={() => { setProcessMode('compress'); setProcessPreview(null) }}>压缩</button>
                <button type="button" role="radio" aria-checked={processMode === 'cover'} data-active={processMode === 'cover'} onClick={() => { setProcessMode('cover'); setProcessPreview(null) }}>公众号头图 900×383</button>
                <button type="button" role="radio" aria-checked={processMode === 'cover-watermark'} data-active={processMode === 'cover-watermark'} onClick={() => { setProcessMode('cover-watermark'); setProcessPreview(null) }}>头图 + 水印</button>
              </div>
              {processMode === 'cover-watermark' && (
                <label className="pa-field" style={{ marginTop: 12 }}>
                  <span>水印文字</span>
                  <input type="text" value={processWatermark} onChange={(e) => setProcessWatermark(e.target.value)} placeholder="默认：拍片哥工作台" maxLength={30} />
                </label>
              )}
              <p className="pa-muted" style={{ marginTop: 12 }}>压缩：限宽 1280px、80% 质量；头图：裁切填充到公众号头图比例；结果将作为新素材保存，不影响原图。</p>
            </div>
            <div className="pa-modal__footer">
              <button type="button" className="pa-secondary-button" onClick={closeProcess}>关闭</button>
              <button type="button" className="pa-secondary-button" disabled={processBusy} onClick={() => void runProcess()}>{processBusy ? '处理中…' : '生成预览'}</button>
              <button type="button" className="pa-primary-button" disabled={!processPreview || processBusy} onClick={() => void saveProcessed()}><UploadSimple aria-hidden="true" size={16} />保存到素材库</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 发布管理
// ---------------------------------------------------------------------------

export function PublishQueuePage({ creations, onOpen, onToast }: {
  creations: CreationRecord[]
  onOpen: (creation: CreationRecord) => void
  onToast: (message: string, tone?: ToastTone) => void
}) {
  const [items, setItems] = useState<PublishItem[]>([])
  const [source, setSource] = useState<'host' | 'local' | 'loading'>('loading')
  const [filter, setFilter] = useState<'all' | 'draft' | 'ready' | 'exported' | 'published'>('all')
  const [editingUrlId, setEditingUrlId] = useState<string | null>(null)
  const [urlDraft, setUrlDraft] = useState('')
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [scheduleDraft, setScheduleDraft] = useState('')
  const [publishPreview, setPublishPreview] = useState<{ item: PublishItem; title: string; text: string; html: string | null } | null>(null)
  const [publishDetail, setPublishDetail] = useState<PublishDetail | null>(null)
  const [publishActionId, setPublishActionId] = useState<string | null>(null)
  const [recentAttempts, setRecentAttempts] = useState<PublishAttempt[]>([])

  const refresh = async () => {
    try {
      const [rows, attempts] = await Promise.all([listPublishItems(), listPublishAttempts(undefined, 12)])
      setItems(rows)
      setRecentAttempts(attempts)
      setSource('host')
    } catch {
      setSource('local')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // Map publish items back to their creation records for display.
  const creationById = new Map(creations.map((c) => [c.id, c]))

  const visibleItems = filter === 'all' ? items : items.filter((item) => item.status === filter)

  const markStatus = async (id: string, status: 'ready' | 'exported' | 'published') => {
    try {
      await setPublishStatus(id, status)
      onToast(status === 'published' ? '已标记为已发布' : status === 'exported' ? '已标记为已导出' : '已标记为待发布', 'success')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '状态更新失败', 'warning')
    }
  }

  const saveExternalUrl = async (item: PublishItem) => {
    const url = urlDraft.trim()
    if (!url) {
      onToast('请输入发布链接', 'warning')
      return
    }
    try {
      await setPublishStatus(item.id, 'published', url)
      onToast('已回写发布链接并标记为已发布', 'success')
      setEditingUrlId(null)
      setUrlDraft('')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '保存失败', 'warning')
    }
  }

  const saveSchedule = async (item: PublishItem) => {
    const value = scheduleDraft.trim()
    if (!value) {
      onToast('请选择计划发布时间', 'warning')
      return
    }
    const parsed = new Date(value)
    if (!Number.isFinite(parsed.getTime())) {
      onToast('计划时间格式无效', 'warning')
      return
    }
    try {
      await schedulePublish(item.id, parsed.toISOString())
      onToast(`已设置定时提醒：${formatLocalTime(parsed.toISOString())}`, 'success')
      setSchedulingId(null)
      setScheduleDraft('')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '设置定时失败', 'warning')
    }
  }

  const clearSchedule = async (item: PublishItem) => {
    try {
      await schedulePublish(item.id, null)
      onToast('已清除定时提醒', 'info')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '清除定时失败', 'warning')
    }
  }

  /** 判断计划时间是否已到期（提醒用户发布）。 */
  const isScheduleDue = (item: PublishItem): boolean => {
    if (!item.scheduledAt) return false
    return Date.parse(item.scheduledAt) <= Date.now() && item.status !== 'published'
  }

  const downloadPlatform = async (item: PublishItem) => {
    try {
      const blob = await exportForPlatform(item.creationId, item.platform, item.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `paipiange-${item.platform}.txt`
      anchor.click()
      URL.revokeObjectURL(url)
      onToast(`已导出「${PLATFORM_LABELS[item.platform]}」适配文本`, 'success')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '平台导出失败', 'warning')
    }
  }

  const copyPlatform = async (item: PublishItem) => {
    try {
      const text = await exportPlatformText(item.creationId, item.platform, item.id)
      await navigator.clipboard.writeText(text)
      await setPublishStatus(item.id, 'ready')
      onToast(`已复制「${PLATFORM_LABELS[item.platform]}」适配文案到剪贴板`, 'success')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '复制失败', 'warning')
    }
  }

  /** 复制公众号排版 HTML（国风内联样式），粘贴到公众号编辑器即保留格式。 */
  const copyWechatHtml = async (item: PublishItem) => {
    const creation = creationById.get(item.creationId)
    if (!creation) return
    const input = { title: creation.title, content: creation.content || creation.topic }
    const html = buildWechatArticleHtml(input)
    const plain = buildWechatArticlePlainText(input)
    try {
      const clipItem = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([clipItem])
      await setPublishStatus(item.id, 'ready')
      onToast('已复制公众号排版，到公众号编辑器直接粘贴即可', 'success')
      void refresh()
    } catch {
      try {
        await navigator.clipboard.writeText(plain)
        await setPublishStatus(item.id, 'ready')
        onToast('浏览器不支持富文本复制，已降级复制纯文本', 'warning')
        void refresh()
      } catch {
        onToast('复制失败，请手动选择内容', 'warning')
      }
    }
  }

  const previewPlatform = async (item: PublishItem) => {
    const creation = creationById.get(item.creationId)
    if (!creation) return
    try {
      const text = await exportPlatformText(item.creationId, item.platform)
      const html = item.platform === 'wechat'
        ? buildWechatArticleHtml({ title: creation.title, content: creation.content || creation.topic })
        : null
      setPublishPreview({ item, title: creation.title, text, html })
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '发布预览生成失败', 'warning')
    }
  }

  const downloadDeliveryBundle = async (item: PublishItem) => {
    try {
      const blob = await exportCreation(item.creationId, 'zip', item.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `paipiange-${item.platform}-delivery.zip`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      onToast('已导出交付包（Markdown、HTML 与发布素材）', 'success')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '交付包导出失败，请重试', 'warning')
    }
  }

  const openPlatform = (item: PublishItem) => {
    const url = PLATFORM_PUBLISH_URL[item.platform]
    if (!url) {
      onToast('该平台暂无发布页入口，可先复制文案手动发布', 'info')
      return
    }
    window.open(url, '_blank', 'noopener')
    void setPublishStatus(item.id, 'ready').then(() => refresh()).catch(() => undefined)
  }

  const openPublishHistory = async (item: PublishItem) => {
    setPublishActionId(item.id)
    try {
      setPublishDetail(await getPublishDetail(item.id))
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '发布历史读取失败', 'warning')
    } finally {
      setPublishActionId(null)
    }
  }

  const refreshOne = async (item: PublishItem) => {
    setPublishActionId(item.id)
    try {
      await refreshPublishStatus(item.id)
      onToast(item.platform === 'wechat' && item.externalId ? '微信草稿状态已刷新' : '发布状态已检查', 'success')
      await refresh()
      if (publishDetail?.item.id === item.id) setPublishDetail(await getPublishDetail(item.id))
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '状态刷新失败', 'warning')
      await refresh()
    } finally {
      setPublishActionId(null)
    }
  }

  const retryOne = async (item: PublishItem) => {
    setPublishActionId(item.id)
    try {
      await retryPublish(item.id)
      onToast('重试成功，发布记录已更新', 'success')
      await refresh()
      setPublishDetail(await getPublishDetail(item.id))
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '重试失败', 'warning')
      await refresh()
    } finally {
      setPublishActionId(null)
    }
  }

  if (source === 'loading') {
    return <div className="pa-page"><section className="pa-panel pa-large-empty"><p>正在读取待发布清单…</p></section></div>
  }

  return (
    <div className="pa-page">
      <PageIntro title="发布管理" description="管理本地待发布清单，不登录或自动发布到任何第三方平台。" />

      <div className="pa-record-toolbar">
        <div className="pa-segmented" aria-label="发布状态筛选">
          {(['all', 'draft', 'ready', 'exported', 'published'] as const).map((s) => (
            <button key={s} type="button" data-active={filter === s} onClick={() => setFilter(s)}>
              {s === 'all' ? '全部' : s === 'draft' ? '草稿' : s === 'ready' ? '待发布' : s === 'exported' ? '已导出' : '已发布'}
            </button>
          ))}
        </div>
      </div>

      {source === 'host' && recentAttempts.length > 0 && (
        <section className="pa-panel pa-publish-recent">
          <h2>最近发布操作</h2>
          <div className="pa-publish-history__list">
            {recentAttempts.slice(0, 6).map((attempt) => (
              <article key={attempt.id}>
                <span className="pa-status-badge" data-status={attempt.status === 'success' ? 'success' : attempt.status === 'failed' ? 'failed' : 'running'}>{attempt.status === 'success' ? '成功' : attempt.status === 'failed' ? '失败' : '进行中'}</span>
                <b>{PLATFORM_LABELS[attempt.platform]} · {publishActionLabel(attempt.action)}</b>
                <small>{formatLocalTime(attempt.createdAt)}</small>
                {attempt.mediaId && <code>media_id: {attempt.mediaId}</code>}
                {attempt.errorMessage && <p className="pa-task-row__error">{attempt.errorMessage}</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      {source === 'host' && visibleItems.length ? (
        <div className="pa-publish-grid">
          {visibleItems.map((item) => {
            const creation = creationById.get(item.creationId)
            return (
              <article key={item.id} className="pa-panel pa-publish-card">
                <div className="pa-publish-card__top">
                  <span className="pa-status-badge" data-status="queued">{PLATFORM_LABELS[item.platform]}</span>
                  <span className="pa-status-badge" data-status={item.status === 'published' ? 'draft' : 'queued'}>{item.status === 'draft' ? '草稿' : item.status === 'ready' ? '待发布' : item.status === 'exported' ? '已导出' : '已发布'}</span>
                  <small>{formatLocalTime(item.updatedAt)}</small>
                </div>
                {item.scheduledAt && (
                  <p className={isScheduleDue(item) ? 'pa-publish-schedule pa-publish-schedule--due' : 'pa-publish-schedule'}>
                    <Clock aria-hidden="true" size={14} />
                    {isScheduleDue(item) ? '⏰ 到点发布了，请前往平台手动群发' : `计划 ${formatLocalTime(item.scheduledAt)}`}
                  </p>
                )}
                <h2>{creation?.title ?? '（创作已删除）'}</h2>
                <p>{creation?.content.trim() || creation?.topic || ''}</p>
                {item.externalUrl && (
                  <p className="pa-publish-external"><a href={item.externalUrl} target="_blank" rel="noopener noreferrer">查看已发布内容 ↗</a></p>
                )}
                {item.externalId && <p className="pa-publish-external"><b>media_id：</b><code>{item.externalId}</code></p>}
                {item.lastError && <p className="pa-task-row__error">最近失败：{item.lastError}（累计 {item.retryCount} 次）</p>}
                {item.lastCheckedAt && <p className="pa-muted">最近刷新：{formatLocalTime(item.lastCheckedAt)}</p>}
                <div>
                  {creation && <button type="button" className="pa-secondary-button" onClick={() => onOpen(creation)}>查看与编辑</button>}
                  {creation && <button type="button" className="pa-secondary-button" onClick={() => void previewPlatform(item)}><Eye aria-hidden="true" size={15} />发布预览</button>}
                  {creation && (
                    <button type="button" className="pa-secondary-button" onClick={() => downloadPlatform(item)}>
                      <DownloadSimple aria-hidden="true" size={15} />按平台导出
                    </button>
                  )}
                  {creation && (
                    <button type="button" className="pa-secondary-button" onClick={() => copyPlatform(item)}>
                      <CopySimple aria-hidden="true" size={15} />复制文案
                    </button>
                  )}
                  {creation && (
                    <button type="button" className="pa-secondary-button" onClick={() => void downloadDeliveryBundle(item)}>
                      <Stack aria-hidden="true" size={15} />导出交付包
                    </button>
                  )}
                  {creation && item.platform === 'wechat' && (
                    <button type="button" className="pa-secondary-button" onClick={() => copyWechatHtml(item)}>
                      <Sparkle aria-hidden="true" size={15} />复制公众号排版
                    </button>
                  )}
                  <button type="button" className="pa-secondary-button" onClick={() => openPlatform(item)}>
                    <PaperPlaneTilt aria-hidden="true" size={15} />去平台发布
                  </button>
                  {schedulingId === item.id ? (
                    <span className="pa-publish-url-editor">
                      <input
                        type="datetime-local"
                        value={scheduleDraft}
                        onChange={(e) => setScheduleDraft(e.target.value)}
                      />
                      <button type="button" className="pa-secondary-button" onClick={() => saveSchedule(item)}>保存定时</button>
                      {item.scheduledAt && <button type="button" className="pa-link-button" onClick={() => void clearSchedule(item)}>清除</button>}
                      <button type="button" className="pa-icon-button" onClick={() => { setSchedulingId(null); setScheduleDraft('') }}><X aria-hidden="true" size={16} /></button>
                    </span>
                  ) : (
                    <button type="button" className="pa-secondary-button" onClick={() => { setSchedulingId(item.id); setScheduleDraft('') }}>
                      <Clock aria-hidden="true" size={15} />{item.scheduledAt ? '改定时' : '定时提醒'}
                    </button>
                  )}
                  <button type="button" className="pa-secondary-button" disabled={publishActionId === item.id} onClick={() => void refreshOne(item)}><ArrowClockwise aria-hidden="true" size={15} />刷新状态</button>
                  <button type="button" className="pa-secondary-button" disabled={publishActionId === item.id} onClick={() => void openPublishHistory(item)}><Eye aria-hidden="true" size={15} />历史与检查</button>
                  {(item.lastError || item.retryCount > 0) && <button type="button" className="pa-secondary-button" disabled={publishActionId === item.id} onClick={() => void retryOne(item)}>重试</button>}
                  {item.status === 'draft' && <button type="button" className="pa-link-button" onClick={() => void markStatus(item.id, 'ready')}>设为待发布</button>}
                  {editingUrlId === item.id ? (
                    <span className="pa-publish-url-editor">
                      <input type="url" placeholder="粘贴发布后的链接" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} />
                      <button type="button" className="pa-secondary-button" onClick={() => saveExternalUrl(item)}>保存</button>
                      <button type="button" className="pa-icon-button" onClick={() => { setEditingUrlId(null); setUrlDraft('') }}><X aria-hidden="true" size={16} /></button>
                    </span>
                  ) : (
                    <button type="button" className="pa-link-button" onClick={() => { setEditingUrlId(item.id); setUrlDraft(item.externalUrl ?? '') }}>
                      {item.status === 'published' ? '补录链接' : '标记已发布'}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <section className="pa-panel pa-large-empty">
          <div className="pa-large-empty__icon"><PaperPlaneTilt aria-hidden="true" size={27} weight="duotone" /></div>
          <h2>{filter === 'all' ? '暂无待发布内容' : '该状态下暂无内容'}</h2>
          <p>{source === 'host' ? '在创作工作台保存草稿时选择“加入待发布”，内容会出现在这里。' : 'Host 服务未连接，暂无法读取待发布清单。'}</p>
        </section>
      )}

      {publishPreview && (
        <div className="pa-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setPublishPreview(null) }}>
          <div className="pa-modal pa-publish-preview" role="dialog" aria-modal="true" aria-labelledby="pa-publish-preview-title">
            <div className="pa-modal__head">
              <div><h3 id="pa-publish-preview-title">{PLATFORM_LABELS[publishPreview.item.platform]}发布预览</h3><p>{publishPreview.title}</p></div>
              <button type="button" className="pa-icon-button" aria-label="关闭" onClick={() => setPublishPreview(null)}><X aria-hidden="true" size={17} /></button>
            </div>
            <div className="pa-modal__body">
              {publishPreview.html ? (
                <iframe title="公众号排版预览" className="pa-publish-preview__frame" srcDoc={publishPreview.html} sandbox="" />
              ) : (
                <pre className="pa-publish-preview__text">{publishPreview.text}</pre>
              )}
            </div>
            <div className="pa-modal__footer">
              <button type="button" className="pa-secondary-button" onClick={() => setPublishPreview(null)}>关闭</button>
              <button type="button" className="pa-secondary-button" onClick={() => void copyPlatform(publishPreview.item)}>复制发布文案</button>
              <button type="button" className="pa-primary-button" onClick={() => openPlatform(publishPreview.item)}>去平台发布</button>
            </div>
          </div>
        </div>
      )}

      {publishDetail && (
        <div className="pa-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setPublishDetail(null) }}>
          <div className="pa-modal pa-publish-history" role="dialog" aria-modal="true" aria-labelledby="pa-publish-history-title">
            <div className="pa-modal__head">
              <div><h3 id="pa-publish-history-title">发布历史与发布前检查</h3><p>{PLATFORM_LABELS[publishDetail.item.platform]} · {creationById.get(publishDetail.item.creationId)?.title ?? '创作已删除'}</p></div>
              <button type="button" className="pa-icon-button" aria-label="关闭" onClick={() => setPublishDetail(null)}><X aria-hidden="true" size={17} /></button>
            </div>
            <div className="pa-modal__body">
              <section className="pa-task-detail__section">
                <h4>发布前检查</h4>
                <ul className="pa-publish-checklist">
                  {publishDetail.checklist.map((check) => <li key={check.key} data-passed={check.passed}><span>{check.passed ? '✓' : '!'}</span><div><b>{check.label}</b>{check.message && <small>{check.message}</small>}</div></li>)}
                </ul>
              </section>
              <section className="pa-task-detail__section">
                <h4>操作历史（{publishDetail.attempts.length}）</h4>
                <div className="pa-publish-history__list">
                  {publishDetail.attempts.length ? publishDetail.attempts.map((attempt) => (
                    <article key={attempt.id}>
                      <span className="pa-status-badge" data-status={attempt.status === 'success' ? 'success' : attempt.status === 'failed' ? 'failed' : 'running'}>{attempt.status === 'success' ? '成功' : attempt.status === 'failed' ? '失败' : '进行中'}</span>
                      <b>{publishActionLabel(attempt.action)}</b>
                      <small>{formatLocalTime(attempt.createdAt)} · 重试序号 {attempt.retryNo}</small>
                      {attempt.mediaId && <code>{attempt.mediaId}</code>}
                      {attempt.errorMessage && <p className="pa-task-row__error">{attempt.errorMessage}</p>}
                    </article>
                  )) : <p className="pa-muted">暂无操作历史</p>}
                </div>
              </section>
              <section className="pa-task-detail__section">
                <h4>发布版本（{publishDetail.versions.length}）</h4>
                <div className="pa-publish-history__list">
                  {publishDetail.versions.length ? publishDetail.versions.map((version) => <article key={version.id}><b>版本 {version.versionNo} · {version.title || '未命名'}</b><small>{formatLocalTime(version.createdAt)}</small><p>{version.bodyMd.slice(0, 180) || '（无正文）'}</p></article>) : <p className="pa-muted">执行导出或发布操作后会自动保存版本快照</p>}
                </div>
              </section>
            </div>
            <div className="pa-modal__footer">
              <button type="button" className="pa-secondary-button" onClick={() => void refreshOne(publishDetail.item)}>刷新状态</button>
              {(publishDetail.item.lastError || publishDetail.item.retryCount > 0) && <button type="button" className="pa-primary-button" onClick={() => void retryOne(publishDetail.item)}>重试最近操作</button>}
              <button type="button" className="pa-secondary-button" onClick={() => setPublishDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 灵感中心
// ---------------------------------------------------------------------------

export function InspirationPage({ onOpenStudio, onToast, creations }: {
  onOpenStudio: (studio: 'article') => void
  onToast: (message: string, tone?: ToastTone) => void
  creations?: CreationRecord[]
}) {
  const [items, setItems] = useState<InspirationRecord[]>([])
  const [source, setSource] = useState<'host' | 'local' | 'loading'>('loading')
  const [suggesting, setSuggesting] = useState(false)

  // aihot 热榜状态
  const [tab, setTab] = useState<'pool' | 'aihot' | 'tophub'>('pool')
  const [aihotItems, setAihotItems] = useState<AihotItem[]>([])
  const [aihotLoading, setAihotLoading] = useState(false)
  const [aihotError, setAihotError] = useState('')
  const [aihotCategory, setAihotCategory] = useState<string>('')

  // tophub 热榜状态
  const [tophubNodes, setTophubNodes] = useState<TophubNode[]>([])
  const [tophubActive, setTophubActive] = useState<string>('')
  const [tophubItems, setTophubItems] = useState<TophubItem[]>([])
  const [tophubLoading, setTophubLoading] = useState(false)
  const [tophubError, setTophubError] = useState('')
  const [tophubNodesLoading, setTophubNodesLoading] = useState(false)

  const AIHOT_CATEGORIES: { value: string; label: string }[] = [
    { value: '', label: '全部' },
    { value: 'ai-models', label: 'AI 模型' },
    { value: 'ai-products', label: 'AI 产品' },
    { value: 'industry', label: '行业动态' },
    { value: 'paper', label: '论文' },
    { value: 'tip', label: '教程' },
    { value: 'opinion', label: '观点' },
  ]

  const refresh = async () => {
    try {
      const rows = await listInspirations()
      setItems(rows)
      setSource('host')
    } catch {
      setSource('local')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const handleSuggest = async () => {
    setSuggesting(true)
    try {
      const topics = (creations ?? []).filter((c) => c.topic.trim()).slice(0, 10).map((c) => c.topic.trim())
      const added = await suggestInspirations({ topics, count: 4 })
      onToast(added.length ? `已根据你的创作风格推荐 ${added.length} 个选题` : '模型暂未返回有效选题，请稍后再试', added.length ? 'success' : 'warning')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '推荐失败，请确认已配置文本模型', 'warning')
    } finally {
      setSuggesting(false)
    }
  }

  const loadAihot = async (category?: string) => {
    setAihotLoading(true)
    setAihotError('')
    try {
      const rows = await fetchAihot({ category: category || undefined, window: '24h', limit: 30 })
      setAihotItems(rows)
    } catch (cause) {
      setAihotError(cause instanceof Error ? cause.message : '拉取 aihot 失败')
    } finally {
      setAihotLoading(false)
    }
  }

  // 首次切到 aihot tab 时拉取
  useEffect(() => {
    if (tab === 'aihot' && aihotItems.length === 0 && !aihotLoading && !aihotError) {
      void loadAihot(aihotCategory)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const handleAihotCategory = (value: string) => {
    setAihotCategory(value)
    void loadAihot(value || undefined)
  }

  // 加载 tophub 节点列表
  const loadTophubNodes = async () => {
    setTophubNodesLoading(true)
    setTophubError('')
    try {
      const nodes = await fetchTophubNodes()
      setTophubNodes(nodes)
      if (nodes.length && !tophubActive) {
        setTophubActive(nodes[0].id)
        void loadTophubItems(nodes[0].id)
      }
    } catch (cause) {
      setTophubError(cause instanceof Error ? cause.message : '拉取 tophub 节点失败')
    } finally {
      setTophubNodesLoading(false)
    }
  }

  // 加载某个节点的热榜条目
  const loadTophubItems = async (nodeId: string) => {
    setTophubLoading(true)
    setTophubError('')
    try {
      const rows = await fetchTophubItems(nodeId)
      setTophubItems(rows)
    } catch (cause) {
      setTophubError(cause instanceof Error ? cause.message : '拉取 tophub 热榜失败')
    } finally {
      setTophubLoading(false)
    }
  }

  const handleTophubNode = (nodeId: string) => {
    setTophubActive(nodeId)
    setTophubItems([])
    void loadTophubItems(nodeId)
  }

  // 首次切到 tophub tab 时拉取节点列表
  useEffect(() => {
    if (tab === 'tophub' && tophubNodes.length === 0 && !tophubNodesLoading && !tophubError) {
      void loadTophubNodes()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  if (source === 'loading') {
    return <div className="pa-page"><section className="pa-panel pa-large-empty"><p>正在读取灵感中心…</p></section></div>
  }

  return (
    <div className="pa-page">
      <PageIntro title="灵感中心" description="从主题池与 AI 热榜快速进入创作。" />

      <div className="pa-record-toolbar">
        <div className="pa-inspiration-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'pool'} className="pa-inspiration-tab" data-active={tab === 'pool'} onClick={() => setTab('pool')}>我的灵感池</button>
          <button type="button" role="tab" aria-selected={tab === 'aihot'} className="pa-inspiration-tab" data-active={tab === 'aihot'} onClick={() => setTab('aihot')}>
            <TrendUp aria-hidden="true" size={15} />AI 热榜
          </button>
          <button type="button" role="tab" aria-selected={tab === 'tophub'} className="pa-inspiration-tab" data-active={tab === 'tophub'} onClick={() => setTab('tophub')}>
            <Stack aria-hidden="true" size={15} />全网热榜
          </button>
        </div>
        {tab === 'pool' && (
          <button type="button" className="pa-primary-button" onClick={handleSuggest} disabled={suggesting}>
            <Sparkle aria-hidden="true" size={16} />{suggesting ? '推荐中…' : 'AI 推荐选题'}
          </button>
        )}
        {tab === 'aihot' && (
          <button type="button" className="pa-secondary-button" onClick={() => loadAihot(aihotCategory || undefined)} disabled={aihotLoading}>
            <ArrowClockwise aria-hidden="true" size={16} />
            {aihotLoading ? '刷新中…' : '刷新'}
          </button>
        )}
        {tab === 'tophub' && (
          <button type="button" className="pa-secondary-button" onClick={() => tophubActive && loadTophubItems(tophubActive)} disabled={tophubLoading}>
            <ArrowClockwise aria-hidden="true" size={16} />
            {tophubLoading ? '刷新中…' : '刷新'}
          </button>
        )}
      </div>

      {tab === 'pool' ? (
        <>
          {items.length ? (
            <div className="pa-publish-grid">
              {items.map((item) => (
                <article key={item.id} className="pa-panel pa-publish-card">
                  <div className="pa-publish-card__top">
                    <span className="pa-status-badge" data-status="draft">{item.category}</span>
                    <small>{formatLocalTime(item.createdAt)}</small>
                  </div>
                  <h2>{item.title}</h2>
                  <p>{item.description}</p>
                  {item.tags.length ? <p className="pa-inspiration-tags">{item.tags.map((t) => `#${t}`).join(' ')}</p> : null}
                  <div>
                    <button type="button" className="pa-secondary-button" onClick={() => onOpenStudio('article')}>以此为灵感创作</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="pa-panel pa-large-empty">
              <div className="pa-large-empty__icon"><Lightbulb aria-hidden="true" size={27} weight="duotone" /></div>
              <h2>灵感中心暂无内容</h2>
              <p>{source === 'host' ? '点击上方“AI 推荐选题”，或灵感会随着你的创作积累而沉淀到这里。' : 'Host 服务未连接，暂无法读取灵感中心。'}</p>
            </section>
          )}
        </>
      ) : tab === 'aihot' ? (
        <AihotPanel
          items={aihotItems}
          loading={aihotLoading}
          error={aihotError}
          category={aihotCategory}
          categories={AIHOT_CATEGORIES}
          onCategory={handleAihotCategory}
          onOpenStudio={() => onOpenStudio('article')}
        />
      ) : (
        <TophubPanel
          nodes={tophubNodes}
          nodesLoading={tophubNodesLoading}
          active={tophubActive}
          items={tophubItems}
          loading={tophubLoading}
          error={tophubError}
          onNode={handleTophubNode}
          onOpenStudio={() => onOpenStudio('article')}
        />
      )}
    </div>
  )
}

function AihotPanel({ items, loading, error, category, categories, onCategory, onOpenStudio }: {
  items: AihotItem[]
  loading: boolean
  error: string
  category: string
  categories: { value: string; label: string }[]
  onCategory: (value: string) => void
  onOpenStudio: () => void
}) {
  return (
    <section className="pa-panel pa-aihot">
      <div className="pa-aihot__head">
        <p className="pa-aihot__desc">AI 领域实时热榜（来自 aihot.news，每 6 小时更新）。点击标题可查看原文，或以此为灵感直接进入创作。</p>
        <div className="pa-aihot__categories">
          {categories.map((c) => (
            <button key={c.value} type="button" className="pa-aihot__category" data-active={category === c.value} onClick={() => onCategory(c.value)}>{c.label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="pa-large-empty"><p>正在拉取 AI 热榜…</p></div>
      ) : error ? (
        <div className="pa-large-empty">
          <p className="pa-aihot__error">{error}</p>
          <p>请检查网络后点击「刷新」重试。</p>
        </div>
      ) : items.length === 0 ? (
        <div className="pa-large-empty">
          <div className="pa-large-empty__icon"><TrendUp aria-hidden="true" size={27} weight="duotone" /></div>
          <h2>暂无热榜内容</h2>
          <p>当前筛选条件下没有条目，试试切换分类或稍后刷新。</p>
        </div>
      ) : (
        <ul className="pa-aihot__list">
          {items.map((item, index) => (
            <li key={item.id} className="pa-aihot__item">
              <div className="pa-aihot__rank" data-top={index < 3}>{index + 1}</div>
              <div className="pa-aihot__body">
                <div className="pa-aihot__meta">
                  <span className="pa-status-badge" data-status="draft">{item.category}</span>
                  <span className="pa-aihot__source">{item.source}</span>
                  {item.score > 0 && <span className="pa-aihot__score">热度 {item.score}</span>}
                </div>
                <h3 className="pa-aihot__title">
                  <a href={item.link} target="_blank" rel="noreferrer">{item.title}</a>
                </h3>
                {item.summary && <p className="pa-aihot__summary">{item.summary}</p>}
                <div className="pa-aihot__actions">
                  <a className="pa-link-button" href={item.originalLink ?? item.link} target="_blank" rel="noreferrer"><ArrowSquareOut aria-hidden="true" size={14} />查看原文</a>
                  <button type="button" className="pa-secondary-button" onClick={onOpenStudio}>以此为灵感创作</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TophubPanel({ nodes, nodesLoading, active, items, loading, error, onNode, onOpenStudio }: {
  nodes: TophubNode[]
  nodesLoading: boolean
  active: string
  items: TophubItem[]
  loading: boolean
  error: string
  onNode: (nodeId: string) => void
  onOpenStudio: () => void
}) {
  return (
    <section className="pa-panel pa-aihot">
      <div className="pa-aihot__head">
        <p className="pa-aihot__desc">全网实时热榜聚合（来自 tophub.today，含微博、知乎、抖音、微信、百度、B站等）。选择平台查看榜单，点击标题跳转原文。</p>
        <div className="pa-aihot__categories">
          {nodesLoading ? (
            <span className="pa-aihot__source">正在加载平台列表…</span>
          ) : nodes.length === 0 ? (
            <span className="pa-aihot__source">暂无可用平台</span>
          ) : (
            nodes.map((n) => (
              <button
                key={n.id}
                type="button"
                className="pa-aihot__category"
                data-active={active === n.id}
                onClick={() => onNode(n.id)}
                title={n.board ? `${n.name} · ${n.board}` : n.name}
              >
                {n.name}
              </button>
            ))
          )}
        </div>
      </div>

      {loading ? (
        <div className="pa-large-empty"><p>正在拉取热榜…</p></div>
      ) : error ? (
        <div className="pa-large-empty">
          <p className="pa-aihot__error">{error}</p>
          <p>请检查网络后重试。</p>
        </div>
      ) : items.length === 0 ? (
        <div className="pa-large-empty">
          <div className="pa-large-empty__icon"><Stack aria-hidden="true" size={27} weight="duotone" /></div>
          <h2>暂无热榜内容</h2>
          <p>请选择一个平台查看榜单。</p>
        </div>
      ) : (
        <ul className="pa-aihot__list">
          {items.map((item) => (
            <li key={item.id} className="pa-aihot__item">
              <div className="pa-aihot__rank" data-top={item.rank <= 3}>{item.rank}</div>
              <div className="pa-aihot__body">
                <div className="pa-aihot__meta">
                  {item.heat && <span className="pa-aihot__score">热度 {item.heat}</span>}
                </div>
                <h3 className="pa-aihot__title">
                  <a href={item.link} target="_blank" rel="noreferrer">{item.title}</a>
                </h3>
                <div className="pa-aihot__actions">
                  <a className="pa-link-button" href={item.link} target="_blank" rel="noreferrer"><ArrowSquareOut aria-hidden="true" size={14} />查看原文</a>
                  <button type="button" className="pa-secondary-button" onClick={onOpenStudio}>以此为灵感创作</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 模板（供后续扩展使用，当前仅列出）
// ---------------------------------------------------------------------------

export function useTemplates() {
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])
  return templates
}

// Re-export types for convenience.
export type { AssetRecord, InspirationRecord, PublishItem, PublishPlatform, TemplateRecord }
