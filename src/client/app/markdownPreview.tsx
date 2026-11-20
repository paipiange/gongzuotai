import { Fragment, type ReactNode } from 'react'

/**
 * 轻量 Markdown → React 渲染（用于模板文字结果预览）。
 *
 * 安全：所有原始文本先做 HTML 转义，再拼装标签，杜绝 XSS 注入。
 * 支持子集：标题(#)、粗体(**)、行内代码(`)、无序/有序列表、表格、段落、分隔线。
 */

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** 行内：粗体 **x** 与行内代码 `x`。 */
function inline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  return out
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  const inner = trimmed.slice(1, -1)
  return inner.split('|').map((c) => c.trim())
}

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))

export function renderMarkdown(md: string): ReactNode {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  const push = (node: ReactNode) => {
    blocks.push(<Fragment key={key++}>{node}</Fragment>)
  }

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trimEnd()

    // 空行
    if (line.trim() === '') {
      i++
      continue
    }

    // 表格
    const rowCells = splitTableRow(line)
    if (rowCells.length > 0) {
      // 找到表头（当前行）与紧随的分隔行
      if (i + 1 < lines.length) {
        const sepCells = splitTableRow(lines[i + 1])
        if (sepCells.length > 0 && isSeparatorRow(sepCells)) {
          const header = rowCells
          const bodyRows: string[][] = []
          i += 2
          while (i < lines.length) {
            const cells = splitTableRow(lines[i])
            if (cells.length === 0) break
            bodyRows.push(cells)
            i++
          }
          push(
            <div className="pa-md-table-wrap" key={key++}>
              <table className="pa-md-table">
                <thead>
                  <tr>
                    {header.map((h, idx) => (
                      <th key={idx} dangerouslySetInnerHTML={{ __html: inline(h) }} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((cells, ri) => (
                    <tr key={ri}>
                      {cells.map((c, ci) => (
                        <td key={ci} dangerouslySetInnerHTML={{ __html: inline(c) }} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          )
          continue
        }
      }
      // 单行管道文本，当作普通段落处理
    }

    // 标题
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 4)
      const text = headingMatch[2]
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
      push(<Tag className={`pa-md-heading pa-md-h${level}`} dangerouslySetInnerHTML={{ __html: inline(text) }} />)
      i++
      continue
    }

    // 分隔线
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      push(<hr className="pa-md-hr" />)
      i++
      continue
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      push(
        <ul className="pa-md-list">
          {items.map((it, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: inline(it) }} />
          ))}
        </ul>,
      )
      continue
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
        i++
      }
      push(
        <ol className="pa-md-list pa-md-list--ordered">
          {items.map((it, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: inline(it) }} />
          ))}
        </ol>,
      )
      continue
    }

    // 普通段落（合并连续非空行）
    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,4}\s+/.test(lines[i]) &&
      !/^(\s*[-*_]\s*){3,}$/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      splitTableRow(lines[i]).length === 0
    ) {
      para.push(lines[i].trimEnd())
      i++
    }
    push(<p className="pa-md-p" dangerouslySetInnerHTML={{ __html: inline(para.join('\n')) }} />)
  }

  return <div className="pa-md">{blocks}</div>
}
