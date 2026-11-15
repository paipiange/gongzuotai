/**
 * Markdown 编辑器：textarea 编辑 + 工具栏快捷插入 + 实时预览切换。
 * 用于「手动创作画布」，替代原来的纯 textarea。
 */

import { TextB, TextItalic, TextH, Quotes, ListBullets, LinkSimple, Code, Eye } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { applyMarkdownAction, renderMarkdown } from './markdown'

interface ToolbarButton {
  key: 'bold' | 'italic' | 'heading' | 'quote' | 'bullet' | 'link' | 'code'
  label: string
  icon: React.ReactNode
}

const TOOLBAR: ToolbarButton[] = [
  { key: 'heading', label: '标题', icon: <TextH aria-hidden="true" size={15} /> },
  { key: 'bold', label: '加粗', icon: <TextB aria-hidden="true" size={15} /> },
  { key: 'italic', label: '斜体', icon: <TextItalic aria-hidden="true" size={15} /> },
  { key: 'quote', label: '引用', icon: <Quotes aria-hidden="true" size={15} /> },
  { key: 'bullet', label: '列表', icon: <ListBullets aria-hidden="true" size={15} /> },
  { key: 'link', label: '链接', icon: <LinkSimple aria-hidden="true" size={15} /> },
  { key: 'code', label: '代码', icon: <Code aria-hidden="true" size={15} /> },
]

export function MarkdownEditor({ value, onChange, placeholder }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const apply = (key: ToolbarButton['key']) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const result = applyMarkdownAction(value, start, end, key)
    onChange(result.value)
    // Restore focus + selection on the next tick.
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  return (
    <div className="pa-markdown-editor">
      <div className="pa-markdown-editor__toolbar" role="toolbar" aria-label="Markdown 工具栏">
        {TOOLBAR.map((btn) => (
          <button key={btn.key} type="button" className="pa-icon-button" title={btn.label} aria-label={btn.label} onClick={() => apply(btn.key)}>
            {btn.icon}
          </button>
        ))}
        <button
          type="button"
          className="pa-icon-button pa-markdown-editor__preview"
          data-active={mode === 'preview'}
          title={mode === 'preview' ? '返回编辑' : '预览'}
          aria-label={mode === 'preview' ? '返回编辑' : '预览'}
          onClick={() => setMode((m) => (m === 'edit' ? 'preview' : 'edit'))}
        >
          <Eye aria-hidden="true" size={15} />
        </button>
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          id="pa-manual-content"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <div className="pa-markdown-editor__preview-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || '<p class="pa-markdown-editor__empty">（暂无内容，切换到编辑模式开始写作）</p>' }} />
      )}
    </div>
  )
}
