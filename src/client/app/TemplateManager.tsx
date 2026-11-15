import { DownloadSimple, UploadSimple, Stack } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { exportTemplates, importTemplates, listTemplates, type TemplateExportPayload, type TemplateRecord } from './hostClient'

type Toast = (message: string, tone?: 'info' | 'success' | 'warning') => void

/** 设置页「模板管理」卡片：导出/导入模板包，方便团队复用。 */
export function TemplateManager({ onToast }: { onToast: Toast }) {
  const [count, setCount] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refreshCount = async () => {
    try {
      const rows = await listTemplates()
      setCount(rows.length)
    } catch {
      setCount(null)
    }
  }

  const handleExport = async () => {
    try {
      const payload = await exportTemplates()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `paipiange-templates-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      onToast(`已导出 ${payload.templates.length} 个模板`, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '导出失败', 'warning')
    }
  }

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as TemplateExportPayload
      const items = Array.isArray(parsed.templates) ? parsed.templates : (parsed as unknown as TemplateExportPayload['templates'])
      if (!Array.isArray(items) || !items.length) {
        onToast('文件不包含有效模板', 'warning')
        return
      }
      const imported = await importTemplates(items)
      onToast(`已导入 ${imported} 个模板`, 'success')
      void refreshCount()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '导入失败，请确认是有效的模板 JSON 文件', 'warning')
    }
  }

  return (
    <section className="pa-panel pa-setting-card pa-template-manager">
      <div className="pa-setting-card__icon"><Stack aria-hidden="true" size={23} /></div>
      <div>
        <h2>模板管理</h2>
        <p>{count === null ? '管理创作模板。' : `当前共有 ${count} 个模板。`}</p>
      </div>
      <div className="pa-template-manager__actions">
        <button type="button" className="pa-secondary-button" onClick={handleExport}>
          <DownloadSimple aria-hidden="true" size={16} />导出模板包
        </button>
        <button type="button" className="pa-secondary-button" onClick={() => fileInputRef.current?.click()}>
          <UploadSimple aria-hidden="true" size={16} />导入模板包
        </button>
        <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={onPick} />
      </div>
    </section>
  )
}
