import { MagnifyingGlass, X, ImageSquare } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { layoutPresets, type LayoutPreset, type LayoutPlatform } from './stylePresets'

/**
 * 排版预览图直链。handraw-style 仓库为每个排版提供一张独立缩略图，位于
 * images/layouts/{目录}/{id}.webp。目录名由 category 映射（多数加复数 s）。
 * 懒加载，失败时降级为纯色占位块（不影响选择）。
 */
const LAYOUT_ROOT = 'https://raw.githubusercontent.com/yang0/handraw-style/master/images/layouts'

/** category → 仓库目录名。多数目录是复数形式。 */
const CATEGORY_DIR: Record<string, string> = {
  'social-card': 'social-cards',
  infographic: 'infographics',
  'comic-storyboard': 'comic-storyboards',
  ecommerce: 'ecommerce',
  'ip-character': 'ip-characters',
}

function previewUrl(layout: LayoutPreset): string | null {
  const dir = CATEGORY_DIR[layout.category]
  if (!dir) return null
  return `${LAYOUT_ROOT}/${dir}/${layout.id}.webp`
}

const PLATFORM_LABEL: Record<LayoutPlatform, string> = {
  xiaohongshu: '小红书社媒卡',
  wechat: '公众号信息图',
  general: '其他排版',
}

const platforms: LayoutPlatform[] = ['xiaohongshu', 'wechat', 'general']

interface LayoutPickerProps {
  value: string
  onChange: (id: string) => void
  onClose: () => void
}

/**
 * 弹窗式排版选择器：按平台分组 tab + 编号/名称搜索 + 缩略图网格。
 * 缩略图懒加载，失败降级占位块。
 */
export function LayoutPicker({ value, onChange, onClose }: LayoutPickerProps) {
  const [query, setQuery] = useState('')
  const [activePlatform, setActivePlatform] = useState<LayoutPlatform | ''>('')

  // 默认选中当前已选排版所在平台，否则第一个平台。
  const currentPlatform = value ? layoutPresets.find((l) => l.id === value)?.platform ?? '' : ''
  useEffect(() => {
    setActivePlatform((prev) => prev || currentPlatform || platforms[0] || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = layoutPresets
    if (activePlatform) list = list.filter((l) => l.platform === activePlatform)
    if (q) {
      list = list.filter(
        (l) =>
          l.id.toLowerCase().includes(q) ||
          l.name.toLowerCase().includes(q),
      )
    }
    return list
  }, [query, activePlatform])

  // Esc 关闭；点击遮罩关闭。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pa-style-picker__backdrop" onClick={onClose}>
      <div className="pa-style-picker" onClick={(event) => event.stopPropagation()}>
        <header className="pa-style-picker__head">
          <div>
            <h3>选择排版</h3>
            <p>点击缩略图预览排版，选中后即可用于生成。</p>
          </div>
          <button type="button" className="pa-icon-button" aria-label="关闭" onClick={onClose}><X aria-hidden="true" size={18} /></button>
        </header>

        <div className="pa-style-picker__search">
          <MagnifyingGlass aria-hidden="true" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索编号或排版名（如 SC-001 / 上文下图 / 时间轴）"
            autoFocus
          />
        </div>

        {!query.trim() && (
          <nav className="pa-style-picker__tabs">
            {platforms.map((platform) => (
              <button
                key={platform}
                type="button"
                data-active={activePlatform === platform}
                onClick={() => setActivePlatform(platform)}
              >
                {PLATFORM_LABEL[platform]}
              </button>
            ))}
          </nav>
        )}

        <div className="pa-style-picker__grid">
          {filtered.length === 0 ? (
            <div className="pa-style-picker__empty">没有匹配的排版，换个关键词试试。</div>
          ) : (
            filtered.map((layout) => (
              <LayoutThumb key={layout.id} layout={layout} selected={layout.id === value} onSelect={() => { onChange(layout.id); onClose() }} />
            ))
          )}
        </div>

        <footer className="pa-style-picker__foot">
          {query.trim() ? `匹配 ${filtered.length} 个排版` : `${filtered.length} 个排版`} · 预览图来自 handraw-style 开源画廊
        </footer>
      </div>
    </div>
  )
}

function LayoutThumb({ layout, selected, onSelect }: { layout: LayoutPreset; selected: boolean; onSelect: () => void }) {
  const [failed, setFailed] = useState(false)
  const url = previewUrl(layout)

  return (
    <button type="button" className="pa-style-thumb" data-selected={selected} onClick={onSelect} title={`${layout.id} · ${layout.name}`}>
      <div className="pa-style-thumb__img">
        {url && !failed ? (
          <img src={url} alt={`${layout.id} ${layout.name}`} loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <div className="pa-style-thumb__fallback"><ImageSquare aria-hidden="true" size={24} /></div>
        )}
      </div>
      <div className="pa-style-thumb__meta">
        <span className="pa-style-thumb__id">{layout.id}</span>
        <span className="pa-style-thumb__name">{layout.name}</span>
      </div>
    </button>
  )
}
