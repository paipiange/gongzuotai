/**
 * 轻量内联 Markdown 渲染器（无外部依赖，客户端单 chunk 内联）。
 * 覆盖写作常用语法：标题、加粗、斜体、行内代码、引用、无序/有序列表、
 * 链接、分隔线、段落。用于「手动创作画布」的实时预览。
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

/**
 * Render a Markdown string to sanitized HTML. Pure function, no dangerouslySetInnerHTML
 * of raw input — all output is escaped first, then re-tagged.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inList: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (inList) {
      html.push(`</${inList}>`)
      inList = null
    }
  }

  for (const raw of lines) {
    const line = raw

    // Blank line closes lists and starts a new paragraph boundary.
    if (!line.trim()) {
      closeList()
      continue
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList()
      html.push('<hr />')
      continue
    }

    // Headings
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      closeList()
      html.push(`<blockquote>${renderInline(line.replace(/^\s*>\s?/, ''))}</blockquote>`)
      continue
    }

    // Unordered list
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      if (inList !== 'ul') { closeList(); html.push('<ul>'); inList = 'ul' }
      html.push(`<li>${renderInline(ul[1])}</li>`)
      continue
    }

    // Ordered list
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ol) {
      if (inList !== 'ol') { closeList(); html.push('<ol>'); inList = 'ol' }
      html.push(`<li>${renderInline(ol[1])}</li>`)
      continue
    }

    // Regular paragraph
    closeList()
    html.push(`<p>${renderInline(line)}</p>`)
  }

  closeList()
  return html.join('\n')
}

/**
 * Insert a Markdown snippet around the current selection in a textarea.
 * Returns the new value and the selection range to restore.
 */
export function applyMarkdownAction(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: 'bold' | 'italic' | 'heading' | 'quote' | 'bullet' | 'link' | 'code',
): { value: string; selectionStart: number; selectionEnd: number } {
  const selected = value.slice(selectionStart, selectionEnd)

  const wrap = (prefix: string, suffix: string, fallback: string) => {
    const inner = selected || fallback
    const next = value.slice(0, selectionStart) + prefix + inner + suffix + value.slice(selectionEnd)
    return { value: next, selectionStart: selectionStart + prefix.length, selectionEnd: selectionStart + prefix.length + inner.length }
  }

  switch (action) {
    case 'bold': return wrap('**', '**', '加粗文字')
    case 'italic': return wrap('*', '*', '斜体文字')
    case 'heading': return wrap('\n## ', '', '小标题')
    case 'quote': return wrap('\n> ', '', '引用内容')
    case 'bullet': return wrap('\n- ', '', '列表项')
    case 'code': return wrap('`', '`', '代码')
    case 'link': {
      const inner = selected || '链接文字'
      const next = value.slice(0, selectionStart) + `[${inner}](https://)` + value.slice(selectionEnd)
      return { value: next, selectionStart: selectionStart + 1, selectionEnd: selectionStart + 1 + inner.length }
    }
  }
}
