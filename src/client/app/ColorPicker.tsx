import { MagnifyingGlass, X, ImageSquare } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { colorPresets, type ColorPreset } from './stylePresets'

/**
 * 主题色预览图直链。handraw-style 仓库为每个主题色提供一张独立色卡，位于
 * images/colors/{id}.webp（C-01.webp 等）。懒加载，失败降级为纯色占位块。
 */
const COLOR_ROOT = 'https://raw.githubusercontent.com/yang0/handraw-style/master/images/colors'

function previewUrl(color: ColorPreset): string {
  return `${COLOR_ROOT}/${color.id}.webp`
}

interface ColorPickerProps {
  value: string
  onChange: (id: string) => void
  onClose: () => void
}

/**
 * 弹窗式主题色选择器：色卡网格 + 名称搜索。
 * 色卡缩略图懒加载，失败降级占位块。
 */
export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return colorPresets
    return colorPresets.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.prompt.toLowerCase().includes(q),
    )
  }, [query])

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
            <h3>选择主题色</h3>
            <p>点击色卡预览，选中后即可用于生成。</p>
          </div>
          <button type="button" className="pa-icon-button" aria-label="关闭" onClick={onClose}><X aria-hidden="true" size={18} /></button>
        </header>

        <div className="pa-style-picker__search">
          <MagnifyingGlass aria-hidden="true" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索编号或颜色名（如 C-01 / 克莱因蓝 / 薄荷绿）"
            autoFocus
          />
        </div>

        <div className="pa-style-picker__grid pa-color-picker__grid">
          {filtered.length === 0 ? (
            <div className="pa-style-picker__empty">没有匹配的主题色，换个关键词试试。</div>
          ) : (
            filtered.map((color) => (
              <ColorThumb key={color.id} color={color} selected={color.id === value} onSelect={() => { onChange(color.id); onClose() }} />
            ))
          )}
        </div>

        <footer className="pa-style-picker__foot">
          {query.trim() ? `匹配 ${filtered.length} 个主题色` : `${filtered.length} 个主题色`} · 色卡来自 handraw-style 开源画廊
        </footer>
      </div>
    </div>
  )
}

function ColorThumb({ color, selected, onSelect }: { color: ColorPreset; selected: boolean; onSelect: () => void }) {
  const [failed, setFailed] = useState(false)
  const url = previewUrl(color)

  return (
    <button type="button" className="pa-style-thumb pa-color-thumb" data-selected={selected} onClick={onSelect} title={`${color.id} · ${color.name}`}>
      <div className="pa-style-thumb__img">
        {url && !failed ? (
          <img src={url} alt={`${color.id} ${color.name}`} loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <div className="pa-style-thumb__fallback"><ImageSquare aria-hidden="true" size={24} /></div>
        )}
      </div>
      <div className="pa-style-thumb__meta">
        <span className="pa-style-thumb__id">{color.id}</span>
        <span className="pa-style-thumb__name">{color.name}</span>
      </div>
    </button>
  )
}
