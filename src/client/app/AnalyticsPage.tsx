/**
 * 数据分析页：基于 Host 真实数据（生成任务 + 创作 + 素材 + 发布）做统计。
 * Host 连接时走统一后端聚合接口（AnalyticsRepository.overview）；未连接时
 * 仅展示浏览器本地草稿统计并明确标注来源，不使用虚构数字。
 */

import { ChartBar, Images, Lightning, PaperPlaneTilt, PencilSimpleLine } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { fetchAnalytics, type AnalyticsOverview, type StudioId } from './hostClient'
import type { CreationRecord } from './workspaceStore'

type StudioLabelMap = Record<StudioId, string>

const STUDIOS: StudioId[] = ['article', 'headline', 'image', 'marketing', 'xiaohongshu']

/** 后端 creation type -> 前端 studio id（graphic 属公众号工作台，不走 creation 记录）。 */
const STUDIO_TO_TYPE: Partial<Record<StudioId, string>> = {
  article: 'article',
  headline: 'title',
  image: 'image',
  marketing: 'marketing',
  xiaohongshu: 'xiaohongshu',
}

/** 发布漏斗状态（后端真实状态为 draft/ready/exported/published）。 */
const FUNNEL_STEPS = ['draft', 'ready', 'exported', 'published'] as const
const FUNNEL_LABELS = ['草稿', '待发布', '已导出', '已发布']
const KIND_LABELS = ['文字', '图片', '视频']
const KIND_KEYS = ['text', 'image', 'video'] as const

export function AnalyticsPage({ creations, storageSource, studioLabels }: {
  creations: CreationRecord[]
  storageSource: 'host' | 'local' | 'loading'
  studioLabels: StudioLabelMap
}) {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [hostConnected, setHostConnected] = useState(storageSource === 'host')

  useEffect(() => {
    let cancelled = false
    fetchAnalytics()
      .then((o) => { if (!cancelled) { setOverview(o); setHostConnected(true) } })
      .catch(() => { if (!cancelled) setHostConnected(false) })
    return () => { cancelled = true }
  }, [])

  const generated = overview?.generated
  const successRatePct = generated ? Math.round(generated.successRate * 100) : null

  // 创作状态分布：优先后端聚合，离线回退到内存 creations。
  const draftCount = overview?.creations.byStatus['draft'] ?? creations.filter((c) => c.status === 'draft').length
  const queuedCount = overview?.creations.byStatus['queued'] ?? creations.filter((c) => c.status === 'queued').length
  const archivedCount = overview?.creations.byStatus['archived'] ?? creations.filter((c) => c.status === 'archived').length
  const creationTotal = overview?.creations.total ?? creations.length

  // 各工作室分布。
  const studioDistribution = STUDIOS.map((id) => {
    const typeKey = STUDIO_TO_TYPE[id]
    const count = overview
      ? (typeKey ? (overview.creations.byType[typeKey] ?? 0) : 0)
      : creations.filter((c) => c.studio === id).length
    return { id, label: studioLabels[id], count }
  }).filter((item) => item.count > 0)

  const imageAssetCount = overview?.assets.byKind['image'] ?? null
  const assetTotal = overview?.assets.total ?? null
  const fileAssetCount = assetTotal !== null && imageAssetCount !== null ? assetTotal - imageAssetCount : null

  const funnel = FUNNEL_STEPS.map((step, index) => ({
    step,
    count: overview?.publish.byStatus[step] ?? 0,
    label: FUNNEL_LABELS[index],
  }))
  const publishedCount = funnel.find((f) => f.step === 'published')?.count ?? 0

  const trend = overview?.trend7d ?? []
  const kindCounts = KIND_KEYS.map((k) => generated?.byKind[k] ?? 0)

  return (
    <div className="pa-page">
      <div className="pa-page-intro">
        <div><span className="pa-overline">PAIPIANGE WORKSPACE</span><h1>数据分析</h1><p>统计保存在本地的真实创作、生成与发布数据，不使用虚构数字。</p></div>
      </div>

      <div className="pa-metrics-grid">
        <MetricCard label="生成总数" value={String(generated?.total ?? 0)} note={successRatePct !== null ? `成功率 ${successRatePct}%` : '生成任务统计'} />
        <MetricCard label="创作总数" value={String(creationTotal)} note="真实本地记录" />
        <MetricCard label="素材总数" value={String(assetTotal ?? '—')} note={assetTotal !== null ? `${imageAssetCount ?? 0} 张图片` : '待连接本地服务'} />
        <MetricCard label="已发布" value={String(publishedCount)} note="已标记发布" />
      </div>

      <div className="pa-analytics-grid">
        <section className="pa-panel pa-chart-panel">
          <div className="pa-panel__title"><ChartBar aria-hidden="true" size={18} /><SectionTitle>近 7 天生成趋势</SectionTitle></div>
          {trend.some((t) => t.count > 0) ? (
            <Bars values={trend.map((t) => t.count)} labels={trend.map((t) => t.day.slice(5))} />
          ) : (
            <p className="pa-chart-caption">暂无生成记录，开始创作后这里会展示最近 7 天趋势。</p>
          )}
          {trend.some((t) => t.count > 0) && <p className="pa-chart-caption">按本地生成任务创建日期统计。</p>}
        </section>

        <section className="pa-panel pa-chart-panel">
          <div className="pa-panel__title"><Lightning aria-hidden="true" size={18} /><SectionTitle>生成类型分布</SectionTitle></div>
          {generated && generated.total > 0 ? (
            <Bars values={kindCounts} labels={[...KIND_LABELS]} />
          ) : (
            <p className="pa-chart-caption">暂无生成任务，类型分布待数据积累。</p>
          )}
        </section>

        <section className="pa-panel pa-chart-panel">
          <div className="pa-panel__title"><ChartBar aria-hidden="true" size={18} /><SectionTitle>创作状态分布</SectionTitle></div>
          <Bars values={[draftCount, queuedCount, archivedCount]} labels={['草稿', '待发布', '已归档']} />
          <p className="pa-chart-caption">{creationTotal ? '来自本地保存的真实创作记录。' : '完成创作后，这里会显示真实分布。'}</p>
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
          <Bars values={funnel.map((f) => f.count)} labels={funnel.map((f) => f.label)} />
          <p className="pa-chart-caption">{hostConnected ? '来自待发布清单的真实状态。' : 'Host 未连接，发布漏斗暂不可用。'}</p>
        </section>

        <section className="pa-panel pa-chart-panel">
          <div className="pa-panel__title"><Images aria-hidden="true" size={18} /><SectionTitle>素材统计</SectionTitle></div>
          <div className="pa-analytics-inline">
            <div><strong>{imageAssetCount ?? '—'}</strong><span>图片素材</span></div>
            <div><strong>{fileAssetCount ?? '—'}</strong><span>其他文件</span></div>
          </div>
          <p className="pa-chart-caption">{hostConnected ? '来自本地素材库的真实统计。' : 'Host 未连接，素材统计暂不可用。'}</p>
        </section>
      </div>

      {!hostConnected && (
        <section className="pa-panel pa-analytics-notice">
          <p>当前为离线模式：仅展示浏览器本地草稿统计；生成、素材与发布漏斗需要连接本地服务后刷新。</p>
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
