import { MagnifyingGlass, X, ImageSquare } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { stylePresets, type StylePreset } from './stylePresets'

/**
 * 风格预览图直链。handraw-style 仓库为每个画风（FA-001 等）提供一张独立
 * 缩略图，位于 images/individual/{组}/{id}.webp。此处懒加载，失败时降级为
 * 纯色占位块（不影响选择）。
 */
const PREVIEW_ROOT = 'https://raw.githubusercontent.com/yang0/handraw-style/master/images/individual'

/** 仅 FA~FI 这九个字母组在仓库里有独立预览图目录。 */
const PREVIEW_GROUPS = new Set(['FA', 'FB', 'FC', 'FD', 'FE', 'FF', 'FG', 'FH', 'FI'])

function previewUrl(style: StylePreset): string | null {
  const group = style.id.split('-')[0]
  if (!PREVIEW_GROUPS.has(group)) return null
  return `${PREVIEW_ROOT}/${group}/${style.id}.webp`
}

/** 从风格 id 解析出所属组前缀（FA-001 → FA）。 */
function groupKeyOf(style: StylePreset): string {
  return style.id.split('-')[0]
}

const groups = Array.from(new Set(stylePresets.map((s) => s.group)))

interface StylePickerProps {
  value: string
  onChange: (id: string) => void
  onClose: () => void
}

/**
 * 弹窗式风格选择器：按分组 tab 浏览 + 编号/名称搜索 + 缩略图网格。
 * 540 个画风全部展示，缩略图懒加载，避免一次性拉满造成卡顿。
 */
export function StylePicker({ value, onChange, onClose }: StylePickerProps) {
  const [query, setQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // 默认选中当前已选风格所在组，否则第一组。
  const currentGroup = value ? stylePresets.find((s) => s.id === value)?.group ?? '' : ''
  useEffect(() => {
    setActiveGroup((prev) => prev || currentGroup || groups[0] || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = stylePresets
    if (activeGroup) list = list.filter((s) => s.group === activeGroup)
    if (q) {
      list = list.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.ref.toLowerCase().includes(q),
      )
    }
    return list
  }, [query, activeGroup])

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
      <div className="pa-style-picker" ref={panelRef} onClick={(event) => event.stopPropagation()}>
        <header className="pa-style-picker__head">
          <div>
            <h3>选择视觉风格</h3>
            <p>点击缩略图预览画风，选中后即可用于生成。</p>
          </div>
          <button type="button" className="pa-icon-button" aria-label="关闭" onClick={onClose}><X aria-hidden="true" size={18} /></button>
        </header>

        <div className="pa-style-picker__search">
          <MagnifyingGlass aria-hidden="true" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索编号、风格名或参考艺术家（如 FA-001 / Sempé / 水墨）"
            autoFocus
          />
        </div>

        {!query.trim() && (
          <nav className="pa-style-picker__tabs">
            {groups.map((group) => (
              <button
                key={group}
                type="button"
                data-active={activeGroup === group}
                onClick={() => setActiveGroup(group)}
              >
                {group}
              </button>
            ))}
          </nav>
        )}

        <div className="pa-style-picker__grid">
          {filtered.length === 0 ? (
            <div className="pa-style-picker__empty">没有匹配的风格，换个关键词试试。</div>
          ) : (
            filtered.map((style) => (
              <StyleThumb key={style.id} style={style} selected={style.id === value} onSelect={() => { onChange(style.id); onClose() }} />
            ))
          )}
        </div>

        <footer className="pa-style-picker__foot">
          {query.trim() ? `匹配 ${filtered.length} 个风格` : `${filtered.length} 个风格`} · 预览图来自 handraw-style 开源画廊
        </footer>
      </div>
    </div>
  )
}

function StyleThumb({ style, selected, onSelect }: { style: StylePreset; selected: boolean; onSelect: () => void }) {
  const [failed, setFailed] = useState(false)
  const url = previewUrl(style)

  return (
    <button type="button" className="pa-style-thumb" data-selected={selected} onClick={onSelect} title={`${style.id} · ${style.name}\n${style.ref}`}>
      <div className="pa-style-thumb__img">
        {url && !failed ? (
          <img src={url} alt={`${style.id} ${style.name}`} loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <div className="pa-style-thumb__fallback"><ImageSquare aria-hidden="true" size={24} /></div>
        )}
      </div>
      <div className="pa-style-thumb__meta">
        <span className="pa-style-thumb__id">{style.id}</span>
        <span className="pa-style-thumb__name">{style.name}</span>
      </div>
    </button>
  )
}
