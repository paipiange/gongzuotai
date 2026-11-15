/**
 * 备份与恢复设置卡片：手动创建数据快照、查看已有备份、下载到本地。
 * 恢复需要重启插件以安全替换数据库文件，故此处只提供创建/列表/下载。
 */

import { Database, DownloadSimple, Plus } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { createBackup, downloadBackup, listBackups, type BackupRecord } from './hostClient'

interface ToastFn {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function BackupSettings({ onToast }: { onToast: ToastFn }) {
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      setBackups(await listBackups())
      setLoaded(true)
    } catch {
      setLoaded(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const onCreate = async () => {
    setBusy(true)
    try {
      const backup = await createBackup()
      onToast('已创建数据备份', 'success')
      await refresh()
      void backup
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '备份失败', 'warning')
    } finally {
      setBusy(false)
    }
  }

  const onDownload = async (backup: BackupRecord) => {
    try {
      const blob = await downloadBackup(backup.filename)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = backup.filename
      anchor.click()
      URL.revokeObjectURL(url)
      onToast(`已下载 ${backup.filename}`, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '下载失败', 'warning')
    }
  }

  return (
    <section className="pa-panel pa-setting-card">
      <div className="pa-setting-card__icon"><Database aria-hidden="true" size={23} /></div>
      <div className="pa-backup-settings">
        <div className="pa-backup-settings__head">
          <div><h2>备份与恢复</h2><p>手动创建本地数据快照，可下载到磁盘。恢复需重启插件后手动替换数据库文件。</p></div>
          <button type="button" className="pa-secondary-button" onClick={onCreate} disabled={busy}><Plus aria-hidden="true" size={16} />{busy ? '创建中…' : '创建备份'}</button>
        </div>
        {loaded ? (
          backups.length ? (
            <ul className="pa-backup-list">
              {backups.map((backup) => (
                <li key={backup.filename}>
                  <span className="pa-backup-list__name">{backup.filename}</span>
                  <span className="pa-backup-list__meta">{formatBytes(backup.sizeBytes)} · {formatTime(backup.createdAt)}</span>
                  <button type="button" className="pa-link-button" onClick={() => onDownload(backup)}><DownloadSimple aria-hidden="true" size={14} />下载</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pa-backup-settings__empty">尚未创建任何备份。点击「创建备份」生成第一份数据快照。</p>
          )
        ) : (
          <p className="pa-backup-settings__empty">Host 服务未连接，备份功能不可用。</p>
        )}
      </div>
    </section>
  )
}
