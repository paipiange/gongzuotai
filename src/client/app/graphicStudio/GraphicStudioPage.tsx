/**
 * 公众号图文创作工作台（多页分镜）。
 *
 * 流程：粘贴素材 → 文本模型拆页（事实提取 + 分镜）→ 分镜页卡 → 逐页生底图
 * （图片模型只画插画，不写文字）→ 文字图层叠加预览。
 *
 * 复用现有能力：generateStoryboard（文本拆页）、generateImages（生底图）、
 * listBackends（文字/图片后端）、风格预设（stylePresets 里「奶油粉」等）。
 */

import { ArrowLeft, Sparkle, ImageSquare, TrashSimple, ArrowSquareOut, DownloadSimple } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import {
  generateStoryboard,
  generateImages,
  listBackends,
  assetUrl,
  type Backend,
  type StoryboardResult,
  type StoryboardPage,
} from '../hostClient'
import { absoluteAssetUrl } from '../Lightbox'
import { GroupedModelPicker, backendToGroup, decodePick, type ModelGroup } from '../GroupedModelPicker'

interface Toast {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

/** 固定 IP 角色 prompt（对应 PROMPTS.md Prompt 3）。 */
const CHARACTER_PROMPT = [
  'Recurring character reference: an ADULT youthful chibi woman with long, voluminous wavy chestnut-brown hair, a medium pink satin bow near her temple, large shining warm-brown eyes, soft rosy cheeks, delicate gold rectangular drop earrings, a small heart necklace, a pink dress or top with an oversized cozy cream cardigan.',
  'Cute round facial proportions and expressive eyebrows. Soft watercolor-pencil linework, warm cream and blush palette, gentle texture, refined small details and balanced highlights.',
  'This is the EXACT SAME recurring mascot across all images. Preserve recognizable face structure, eye color, hair length and chestnut color, pink hair bow, earrings and outfit palette. Vary only expression, hand pose, props and composition to match the page story.',
].join(' ')

/** 固定画风 prompt（对应 PROMPTS.md Prompt 4）。 */
const STYLE_PROMPT = [
  'Brand visual style: high-quality pastel XiaoHongShu editorial chibi illustration.',
  'Cream-white background, soft blush-pink paper textures, chestnut-brown pencil outlines, tiny gold starbursts, minimal heart doodles, gentle peach highlights, cozy hand-drawn scrapbook aesthetic.',
  'Sweet and warm, polished and readable, clean negative space, confident visual hierarchy, consistent color palette across the series. Cute but not childish.',
  'No watermarks, no unrelated text, no logos. Avoid photorealism, neon gradients, heavily saturated harsh colors, cluttered backgrounds.',
  'Primary palette: #FFF6F1 (cream), #F6A4B5 (pink), #7A4D39 (chestnut), #F4C46E (soft gold), #F3DDCE (warm beige).',
].join(' ')

/** 图片模型只画插画，不写任何文字（对应 Prompt 5 的 CRITICAL 约束）。 */
function buildPagePrompt(page: StoryboardPage, total: number): string {
  return [
    `Create exactly ONE standalone, full-resolution vertical illustration for a social post page. Never compose a multi-page collage, 2x2, 4-panel, grid, or contact sheet.`,
    `Page ${page.page_no} of ${total}.`,
    `Page purpose: ${page.page_type}.`,
    `Narrative subject: ${page.visual_brief || page.title}.`,
    `Main character: ${CHARACTER_PROMPT}.`,
    `Visual style: ${STYLE_PROMPT}.`,
    `Canvas aspect ratio: 4:5.`,
    `CRITICAL: Do NOT render ANY Chinese or English headings, product labels, prices, digits, or paragraphs. Those will be composed later as native editable text layers. Leave blank cream-colored safe zones for the text. Keep the character face unobstructed. This is one picture only.`,
  ].join('\n')
}

/** 为一批后端生成默认选中值（第一个后端 + 其默认模型）。 */
function pickDefault(backends: Backend[]): string {
  const first = backends[0]
  if (!first) return ''
  const group = backendToGroup(first)
  const model = group.models[0] ?? ''
  return model ? `${group.id}::${model}` : ''
}

interface PageRecord {
  page: StoryboardPage
  /** 该页底图 asset id（生图成功后填充）。 */
  assetId?: string
  busy?: boolean
  error?: string
}

export function GraphicStudioPage({ onBack, onToast }: { onBack: () => void; onToast: Toast }) {
  const [sourceText, setSourceText] = useState('')
  const [topic, setTopic] = useState('')
  const [pageCount, setPageCount] = useState(4)
  const [textBackends, setTextBackends] = useState<Backend[]>([])
  const [textPick, setTextPick] = useState('')
  const [imageBackends, setImageBackends] = useState<Backend[]>([])
  const [imagePick, setImagePick] = useState('')
  const [breaking, setBreaking] = useState(false)
  const [storyboard, setStoryboard] = useState<StoryboardResult | null>(null)
  const [pages, setPages] = useState<PageRecord[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    listBackends().then((list) => {
      if (cancelled) return
      const text = list.filter((b) => b.kind === 'llm-text')
      const image = list.filter((b) => b.kind === 'llm-image' || b.kind === 'comfyui')
      setTextBackends(text)
      setImageBackends(image)
      if (text.length) setTextPick((prev) => (text.some((b) => b.id === decodePick(prev)?.groupId) ? prev : pickDefault(text)))
      if (image.length) setImagePick((prev) => (image.some((b) => b.id === decodePick(prev)?.groupId) ? prev : pickDefault(image)))
    }).catch(() => {
      if (!cancelled) {
        setTextBackends([])
        setImageBackends([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const textGroups = useMemo<ModelGroup[]>(() => textBackends.map(backendToGroup), [textBackends])
  const imageGroups = useMemo<ModelGroup[]>(() => imageBackends.map(backendToGroup), [imageBackends])

  // 由选中值解析出当前后端与模型。
  const textPickDecoded = decodePick(textPick)
  const imagePickDecoded = decodePick(imagePick)
  const textBackend = textBackends.find((b) => b.id === textPickDecoded?.groupId)
  const imageBackend = imageBackends.find((b) => b.id === imagePickDecoded?.groupId)
  const textModelId = textPickDecoded?.model ?? ''
  const imageModelId = imagePickDecoded?.model ?? ''

  const handleBreakdown = async () => {
    if (!sourceText.trim()) {
      onToast('请先粘贴素材文本', 'warning')
      return
    }
    setBreaking(true)
    setStoryboard(null)
    setPages([])
    setWarnings([])
    try {
      const result = await generateStoryboard({
        sourceText,
        topic,
        pageCount,
        platform: '公众号',
        backendId: textBackend?.id,
        provider: textBackend?.text?.provider,
        model: textModelId || textBackend?.text?.model,
        baseUrl: textBackend?.text?.baseUrl,
        apiKey: textBackend?.text?.apiKey,
      })
      setStoryboard(result)
      setPages(result.pages.map((p) => ({ page: p })))
      setWarnings(result.warnings ?? [])
      setActiveIndex(0)
      if (result.pages.length) onToast(`已拆成 ${result.pages.length} 页分镜`, 'success')
      else onToast('未拆出有效分镜，请调整素材或页数后重试', 'warning')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '拆页失败', 'warning')
    } finally {
      setBreaking(false)
    }
  }

  const generatePage = async (index: number) => {
    if (!imageBackend?.id) {
      onToast('请先在「设置中心 → 后端管理」添加一个图片后端', 'warning')
      return
    }
    const record = pages[index]
    if (!record) return
    const prompt = buildPagePrompt(record.page, pages.length)
    setPages((prev) => prev.map((p, i) => (i === index ? { ...p, busy: true, error: undefined } : p)))
    try {
      const images = await generateImages({
        backendId: imageBackend.id,
        request: { prompt, count: 1, size: 1024, ...(imageModelId ? { model: imageModelId } : {}) },
      })
      const assetId = images[0]?.id
      setPages((prev) => prev.map((p, i) => (i === index ? { ...p, busy: false, assetId } : p)))
      if (assetId) onToast(`第 ${index + 1} 页底图已生成`, 'success')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '生图失败'
      setPages((prev) => prev.map((p, i) => (i === index ? { ...p, busy: false, error: message } : p)))
      onToast(message, 'warning')
    }
  }

  const generateAll = async () => {
    if (!imageBackend?.id) {
      onToast('请先在「设置中心 → 后端管理」添加一个图片后端', 'warning')
      return
    }
    for (let i = 0; i < pages.length; i++) {
      if (!pages[i].assetId) await generatePage(i)
    }
  }

  const removePage = (index: number) => {
    setPages((prev) => prev.filter((_, i) => i !== index))
    setActiveIndex((cur) => (cur >= index ? Math.max(0, cur - 1) : cur))
  }

  const active = pages[activeIndex]
  const doneCount = pages.filter((p) => p.assetId).length

  return (
    <div className="pa-page pa-studio-page">
      <div className="pa-studio-heading">
        <button type="button" className="pa-icon-button" aria-label="返回" onClick={onBack}><ArrowLeft aria-hidden="true" size={19} /></button>
        <div><span className="pa-overline">GRAPHIC STUDIO</span><h1>公众号创作</h1><p>粘贴素材 → 文本模型拆页 → 逐页生成插画底图（文字由程序叠加，图片模型不写数字）。</p></div>
      </div>

      <div className="pa-graphic-layout">
        {/* 左栏：素材与参数 */}
        <section className="pa-panel pa-graphic-params">
          <SectionHeading title="素材与参数" />
          <label className="pa-field">
            <span>主题</span>
            <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} placeholder="例如：38.8万彩礼能买什么" />
          </label>
          <label className="pa-field">
            <span>素材文本（粘贴清单/原文）</span>
            <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="粘贴要拆解的内容，例如消费清单、商品列表、原文段落…" />
          </label>
          <label className="pa-field">
            <span>页数</span>
            <select value={pageCount} onChange={(e) => setPageCount(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n} 页</option>)}
            </select>
          </label>
          <label className="pa-field">
            <span>文字模型（拆页用）</span>
            <GroupedModelPicker
              groups={textGroups}
              value={textPick}
              onChange={setTextPick}
              placeholder="选择文字模型"
              emptyHint="暂无文字后端，去设置中心添加"
            />
          </label>
          <label className="pa-field">
            <span>图片模型（生底图用）</span>
            <GroupedModelPicker
              groups={imageGroups}
              value={imagePick}
              onChange={setImagePick}
              placeholder="选择图片模型"
              emptyHint="暂无图片后端，去设置中心添加"
            />
          </label>
          <button type="button" className="pa-primary-button" onClick={handleBreakdown} disabled={breaking || !sourceText.trim()}>
            <Sparkle aria-hidden="true" size={17} weight="fill" />{breaking ? '拆页中…' : 'AI 拆页'}
          </button>
        </section>

        {/* 中栏：分镜页卡 */}
        <section className="pa-panel pa-graphic-pages">
          <SectionHeading title={`分镜页卡（${pages.length}）`} right={<span className="pa-graphic-done">{doneCount}/{pages.length} 已生图</span>} />
          {pages.length === 0 ? (
            <div className="pa-graphic-empty">粘贴素材后点击「AI 拆页」，这里会列出可独立生成的多页竖图分镜。</div>
          ) : (
            <div className="pa-graphic-page-list">
              {pages.map((rec, i) => (
                <button
                  key={i}
                  type="button"
                  className="pa-graphic-page-card"
                  data-active={i === activeIndex}
                  onClick={() => setActiveIndex(i)}
                >
                  <span className="pa-graphic-page-card__no">P{String(i + 1).padStart(2, '0')}</span>
                  <span className="pa-graphic-page-card__body">
                    <strong>{rec.page.title || '（无标题）'}</strong>
                    <small>{rec.page.page_type}{rec.assetId ? ' · 已生图' : rec.busy ? ' · 生成中…' : ''}</small>
                  </span>
                  {rec.assetId && <span className="pa-graphic-page-card__ok">✓</span>}
                  <span className="pa-graphic-page-card__del" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); removePage(i) }} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), removePage(i))} title="删除此页"><TrashSimple aria-hidden="true" size={14} /></span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 右栏：当前页预览 */}
        <section className="pa-panel pa-graphic-canvas">
          <SectionHeading title="当前页预览" />
          {!active ? (
            <div className="pa-graphic-empty">选择或生成分镜后，这里预览当前页的插画底图与文字层。</div>
          ) : (
            <div className="pa-graphic-preview">
              <div className="pa-graphic-preview__stage">
                {active.assetId ? (
                  <img src={assetUrl(active.assetId)} alt={`第 ${activeIndex + 1} 页底图`} className="pa-graphic-preview__img" />
                ) : (
                  <div className="pa-graphic-preview__placeholder"><ImageSquare aria-hidden="true" size={40} weight="duotone" /><span>{active.busy ? '生成中…' : '尚未生成底图'}</span></div>
                )}
                {/* 文字层叠加（程序排字，MVP 直接覆盖标题/副标题） */}
                {active.assetId && (
                  <div className="pa-graphic-preview__text">
                    {active.page.title && <div className="pa-graphic-preview__title">{active.page.title}</div>}
                    {active.page.subtitle && <div className="pa-graphic-preview__subtitle">{active.page.subtitle}</div>}
                  </div>
                )}
              </div>
              {active.error && <p className="pa-graphic-error">{active.error}</p>}
              <div className="pa-graphic-preview__meta">
                <span className="pa-status-badge" data-status="draft">{active.page.page_type}</span>
                {active.page.disclaimer && <small>{active.page.disclaimer}</small>}
              </div>
              <p className="pa-graphic-preview__brief">{active.page.visual_brief || active.page.title}</p>
              <div className="pa-graphic-preview__actions">
                <button type="button" className="pa-primary-button" onClick={() => generatePage(activeIndex)} disabled={active.busy}>
                  <Sparkle aria-hidden="true" size={16} weight="fill" />{active.busy ? '生成中…' : active.assetId ? '重新生成底图' : '生成此页底图'}
                </button>
                {active.assetId && (
                  <>
                    <a className="pa-secondary-button" href={absoluteAssetUrl(active.assetId)} target="_blank" rel="noreferrer"><ArrowSquareOut aria-hidden="true" size={16} />打开</a>
                    <a className="pa-secondary-button" href={assetUrl(active.assetId)} download target="_blank" rel="noreferrer"><DownloadSimple aria-hidden="true" size={16} />下载</a>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 底部批量操作栏 */}
      {pages.length > 0 && (
        <div className="pa-graphic-toolbar">
          <button type="button" className="pa-primary-button" onClick={generateAll} disabled={pages.some((p) => p.busy)}>
            <Sparkle aria-hidden="true" size={16} weight="fill" />批量生图（跳过已生成）
          </button>
          {warnings.length > 0 && (
            <div className="pa-graphic-warnings">
              {warnings.map((w, i) => <span key={i}>⚠ {w}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SectionHeading({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="pa-graphic-section-head">
      <h2>{title}</h2>
      {right}
    </div>
  )
}
