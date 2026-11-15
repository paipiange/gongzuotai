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
  Lightbulb,
  PaperPlaneTilt,
  TrashSimple,
  UploadSimple,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { CreationRecord } from './workspaceStore'
import {
  assetUrl,
  deleteAsset,
  exportForPlatform,
  exportPlatformText,
  listAssets,
  listInspirations,
  listPublishItems,
  listTemplates,
  setPublishStatus,
  uploadAsset,
  type AssetRecord,
  type InspirationRecord,
  type PublishItem,
  type PublishPlatform,
  type TemplateRecord,
} from './hostClient'

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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    try {
      const rows = await listAssets(kind === 'all' ? undefined : { kind })
      setAssets(rows)
      setSource('host')
    } catch {
      setSource('local')
    }
  }

  useEffect(() => {
    void refresh()
  }, [kind])

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
    if (!window.confirm(`确定删除素材「${asset.name}」吗？此操作不可撤销。`)) return
    try {
      await deleteAsset(asset.id)
      onToast(`已删除「${asset.name}」`, 'success')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '删除失败', 'warning')
    }
  }

  return (
    <div className="pa-page">
      <PageIntro title="素材库" description="统一管理图片、文字、提示词与文件。" />
      <div className="pa-record-toolbar">
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
        <input ref={fileInputRef} type="file" hidden onChange={onPick} />
      </div>

      {source === 'loading' ? (
        <section className="pa-panel pa-large-empty"><p>正在读取素材库…</p></section>
      ) : assets.length ? (
        <div className="pa-publish-grid">
          {assets.map((asset) => (
            <article key={asset.id} className="pa-panel pa-publish-card">
              <div className="pa-publish-card__top">
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
              <div>
                <button type="button" className="pa-secondary-button" onClick={() => handleDownload(asset)}>
                  <DownloadSimple aria-hidden="true" size={15} />下载
                </button>
                <button type="button" className="pa-icon-button" aria-label={`删除 ${asset.name}`} title="删除素材" onClick={() => handleDelete(asset)}>
                  <TrashSimple aria-hidden="true" size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="pa-panel pa-large-empty">
          <div className="pa-large-empty__icon"><CloudArrowUp aria-hidden="true" size={27} weight="duotone" /></div>
          <h2>素材库还是空的</h2>
          <p>{source === 'host' ? '点击“导入素材”上传图片、文稿或提示词，文件会保存到本地 Host 媒体目录。' : 'Host 服务未连接，暂无法读取素材库。'}</p>
          <button type="button" className="pa-secondary-button" onClick={() => fileInputRef.current?.click()}>导入素材</button>
        </section>
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

  const refresh = async () => {
    try {
      const rows = await listPublishItems()
      setItems(rows)
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

  const markStatus = async (id: string, status: 'ready' | 'exported' | 'published') => {
    try {
      await setPublishStatus(id, status)
      onToast(status === 'published' ? '已标记为已发布' : status === 'exported' ? '已标记为已导出' : '已标记为待发布', 'success')
      void refresh()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '状态更新失败', 'warning')
    }
  }

  const downloadPlatform = async (item: PublishItem) => {
    try {
      const blob = await exportForPlatform(item.creationId, item.platform)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `paipiange-${item.platform}.txt`
      anchor.click()
      URL.revokeObjectURL(url)
      onToast(`已导出「${PLATFORM_LABELS[item.platform]}」适配文本`, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '平台导出失败', 'warning')
    }
  }

  const copyPlatform = async (item: PublishItem) => {
    try {
      const text = await exportPlatformText(item.creationId, item.platform)
      await navigator.clipboard.writeText(text)
      onToast(`已复制「${PLATFORM_LABELS[item.platform]}」适配文案到剪贴板`, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '复制失败', 'warning')
    }
  }

  const openPlatform = (item: PublishItem) => {
    const url = PLATFORM_PUBLISH_URL[item.platform]
    if (!url) {
      onToast('该平台暂无发布页入口，可先复制文案手动发布', 'info')
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  if (source === 'loading') {
    return <div className="pa-page"><section className="pa-panel pa-large-empty"><p>正在读取待发布清单…</p></section></div>
  }

  return (
    <div className="pa-page">
      <PageIntro title="发布管理" description="管理本地待发布清单，不登录或自动发布到任何第三方平台。" />

      {source === 'host' && items.length ? (
        <div className="pa-publish-grid">
          {items.map((item) => {
            const creation = creationById.get(item.creationId)
            return (
              <article key={item.id} className="pa-panel pa-publish-card">
                <div className="pa-publish-card__top">
                  <span className="pa-status-badge" data-status="queued">{PLATFORM_LABELS[item.platform]}</span>
                  <small>{formatLocalTime(item.updatedAt)}</small>
                </div>
                <h2>{creation?.title ?? '（创作已删除）'}</h2>
                <p>{creation?.content.trim() || creation?.topic || ''}</p>
                <div>
                  {creation && <button type="button" className="pa-secondary-button" onClick={() => onOpen(creation)}>查看与编辑</button>}
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
                  <button type="button" className="pa-secondary-button" onClick={() => openPlatform(item)}>
                    <PaperPlaneTilt aria-hidden="true" size={15} />去平台发布
                  </button>
                  <button type="button" className="pa-link-button" onClick={() => markStatus(item.id, 'published')} disabled={item.status === 'published'}>
                    {item.status === 'published' ? '已发布' : '标记已发布'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <section className="pa-panel pa-large-empty">
          <div className="pa-large-empty__icon"><PaperPlaneTilt aria-hidden="true" size={27} weight="duotone" /></div>
          <h2>暂无待发布内容</h2>
          <p>{source === 'host' ? '在创作工作台保存草稿时选择“加入待发布”，内容会出现在这里。' : 'Host 服务未连接，暂无法读取待发布清单。'}</p>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 灵感中心
// ---------------------------------------------------------------------------

export function InspirationPage({ onOpenStudio, onToast }: {
  onOpenStudio: (studio: 'article') => void
  onToast: (message: string, tone?: ToastTone) => void
}) {
  const [items, setItems] = useState<InspirationRecord[]>([])
  const [source, setSource] = useState<'host' | 'local' | 'loading'>('loading')

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

  if (source === 'loading') {
    return <div className="pa-page"><section className="pa-panel pa-large-empty"><p>正在读取灵感中心…</p></section></div>
  }

  return (
    <div className="pa-page">
      <PageIntro title="灵感中心" description="从主题池快速进入创作。" />

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
          <p>{source === 'host' ? '灵感会随着你的创作积累而沉淀到这里。' : 'Host 服务未连接，暂无法读取灵感中心。'}</p>
        </section>
      )}
    </div>
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
