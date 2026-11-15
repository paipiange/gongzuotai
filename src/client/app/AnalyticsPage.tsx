/**
 * 数据分析页：基于 Host 真实数据（创作记录 + 素材 + 发布清单）做统计。
 * 不使用虚构数据；Host 未连接时只展示本地创作统计并明确标注来源。
 */

import { ChartBar, Images, PaperPlaneTilt, PencilSimpleLine } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { listAssets, listPublishItems, type AssetRecord, type PublishItem, type StudioId } from './hostClient'
import type { CreationRecord } from './workspaceStore'

type StudioLabelMap = Record<StudioId, string>

interface ToastFn {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

const STUDIOS: StudioId[] = ['article', 'headline', 'image', 'marketing', 'xiaohongshu']

/** 发布漏斗状态（按生命周期推进顺序）。 */
const FUNNEL_STEPS = ['draft', 'queued', 'exported', 'published'] as const

export function AnalyticsPage({ creations, storageSource, studioLabels }: {
  creations: CreationRecord[]
  storageSource: 'host' | 'local' | 'loading'
  studioLabels: StudioLabelMap
}) {
  const [assets, setAssets] = useState<AssetRecord[] | null>(null)
  const [publishItems, setPublishItems] = useState<PublishItem[] | null>(null)
  const [assetsSource, setAssetsSource] = useState<'host' | 'local'>('host')
  const [publishSource, setPublishSource] = useState<'host' | 'local'>('host')

  useEffect(() => {
    let cancelled = false
    listAssets()
      .then((rows) => { if (!cancelled) { setAssets(rows); setAssetsSource('host') } })
      .catch(() => { if (!cancelled) { setAssets([]); setAssetsSource('local') } })
    listPublishItems()
      .then((rows) => { if (!cancelled) { setPublishItems(rows); setPublishSource('host') } })
      .catch(() => { if (!cancelled) { setPublishItems([]); setPublishSource('local') } })
    return () => { cancelled = true }
  }, [])

  const draftCount = creations.filter((c) => c.status === 'draft').length
  const queuedCount = creations.filter((c) => c.status === 'queued').length
  const archivedCount = creations.filter((c) => c.status === 'archived').length
  const imageAssetCount = (assets ?? []).filter((a) => a.kind === 'image').length
  const fileAssetCount = (assets ?? []).filter((a) => a.kind !== 'image').length

  // 发布漏斗：从待发布清单（publish_items）统计状态分布。
  const funnel = FUNNEL_STEPS.map((step) => ({
    step,
    count: (publishItems ?? []).filter((item) => item.status === step).length,
  }))

  // 各工作室分布（按创作记录）。
  const studioDistribution = STUDIOS.map((id) => ({
    id,
    label: studioLabels[id],
    count: creations.filter((c) => c.studio === id).length,
  })).filter((item) => item.count > 0)

  const publishedCount = funnel.find((f) => f.step === 'published')?.count ?? 0
  const hostConnected = storageSource === 'host'

  return (
    <div className="pa-page">
      <div className="pa-page-intro">
        <div><span className="pa-overline">PAIPIANGE WORKSPACE</span><h1>数据分析</h1><p>统计保存在本地的真实创作、素材与发布数据，不使用虚构数字。</p></div>
      </div>

      <div className="pa-metrics-grid">
        <MetricCard label="创作总数" value={String(creations.length)} note="真实本地记录" />
        <MetricCard label="进行中" value={String(draftCount)} note="当前草稿" />
        <MetricCard label="待发布" value={String(queuedCount)} note="本地发布清单" />
        <MetricCard label="已发布" value={String(publishedCount)} note="已标记发布" />
      </div>

      <div className="pa-analytics-grid">
        <section className="pa-panel pa-chart-panel">
          <div className="pa-panel__title"><ChartBar aria-hidden="true" size={18} /><SectionTitle>创作状态分布</SectionTitle></div>
          <Bars values={[draftCount, queuedCount, archivedCount]} labels={['草稿', '待发布', '已归档']} />
          <p className="pa-chart-caption">{creations.length ? '来自本地保存的真实创作记录。' : '完成创作后，这里会显示真实分布。'}</p>
        </section>

        <section className="pa-panel pa-chart-panel">
          <div className="pa-panel__title"><PencilSimpleLine aria-hidden="true" size={18} /><SectionTitle>各工作室分布</SectionTitle></div>
          {studioDistribution.length ? (
            <StudioBars data={studioDistribution} />
          ) : (
            <p className="pa-chart-caption">暂无创作记录，各工作室分布待数据积累。</p>
          )}
        </section>

        <section className="pa-panel pa-chart-panel">
          <div className="pa-panel__title"><PaperPlaneTilt aria-hidden="true" size={18} /><SectionTitle>发布漏斗</SectionTitle></div>
          <Bars values={funnel.map((f) => f.count)} labels={['草稿', '待发布', '已导出', '已发布']} />
          <p className="pa-chart-caption">{publishSource === 'host' ? '来自待发布清单的真实状态。' : 'Host 未连接，发布漏斗暂不可用。'}</p>
        </section>

        <section className="pa-panel pa-chart-panel">
          <div className="pa-panel__title"><Images aria-hidden="true" size={18} /><SectionTitle>素材统计</SectionTitle></div>
          <div className="pa-analytics-inline">
            <div><strong>{imageAssetCount}</strong><span>图片素材</span></div>
            <div><strong>{fileAssetCount}</strong><span>其他文件</span></div>
          </div>
          <p className="pa-chart-caption">{assetsSource === 'host' ? '来自本地素材库的真实统计。' : 'Host 未连接，素材统计暂不可用。'}</p>
        </section>
      </div>

      {!hostConnected && (
        <section className="pa-panel pa-analytics-notice">
          <p>当前为离线模式：仅展示浏览器本地草稿统计；素材与发布漏斗需要连接本地服务后刷新。</p>
        </section>
      )}
    </div>
  )
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="pa-metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="pa-panel__title-text">{children}</h2>
}

function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1)
  return (
    <div className="pa-analytics-bars" aria-label="分布图">
      {values.map((value, index) => (
        <div key={index} className="pa-analytics-bar">
          <div className="pa-analytics-bar__track"><i style={{ height: `${Math.max(8, (value / max) * 100)}%` }} title={String(value)} /></div>
          <span className="pa-analytics-bar__label">{labels[index]}</span>
          <span className="pa-analytics-bar__value">{value}</span>
        </div>
      ))}
    </div>
  )
}

function StudioBars({ data }: { data: Array<{ label: string; count: number }> }) {
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="pa-analytics-studio">
      {data.map((item) => (
        <div key={item.label} className="pa-analytics-studio__row">
          <span className="pa-analytics-studio__label">{item.label}</span>
          <div className="pa-analytics-studio__track"><i style={{ width: `${(item.count / max) * 100}%` }} title={String(item.count)} /></div>
          <span className="pa-analytics-studio__value">{item.count}</span>
        </div>
      ))}
    </div>
  )
}
