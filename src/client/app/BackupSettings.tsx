/**
 * 备份与恢复设置卡片：手动创建数据快照、查看已有备份、下载到本地，
 * 以及一键恢复（覆盖当前数据后自动重启生效）。
 */

import { ArrowCounterClockwise, Database, DownloadSimple, Plus } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { createBackup, downloadBackup, listBackups, restartApp, restoreBackup, type BackupRecord } from './hostClient'

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
  const [confirmRestore, setConfirmRestore] = useState<BackupRecord | null>(null)
  const [restoring, setRestoring] = useState(false)

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

  const onConfirmRestore = async () => {
    if (!confirmRestore) return
    setRestoring(true)
    try {
      const result = await restoreBackup(confirmRestore.filename)
      setConfirmRestore(null)
      onToast('已恢复备份，正在重启应用…（已自动保存恢复前快照）', 'success')
      try {
        await restartApp()
      } catch {
        onToast('数据已恢复，但自动重启失败，请手动重启应用', 'warning')
      }
      void result
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '恢复失败', 'warning')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <section className="pa-panel pa-setting-card">
      <div className="pa-setting-card__icon"><Database aria-hidden="true" size={23} /></div>
      <div className="pa-backup-settings">
        <div className="pa-backup-settings__head">
          <div><h2>备份与恢复</h2><p>手动创建本地数据快照，可下载到磁盘；恢复会覆盖当前数据并自动重启生效。</p></div>
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
                  <button type="button" className="pa-link-button pa-danger-link" onClick={() => setConfirmRestore(backup)}><ArrowCounterClockwise aria-hidden="true" size={14} />恢复</button>
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

      {confirmRestore && (
        <div className="pa-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setConfirmRestore(null) }}>
          <div className="pa-modal">
            <div className="pa-modal__head">
              <h3>恢复备份</h3>
              <button type="button" className="pa-icon-button" aria-label="关闭" onClick={() => setConfirmRestore(null)}>✕</button>
            </div>
            <div className="pa-modal__body">
              <p className="pa-muted">即将用以下备份覆盖当前全部数据，恢复后应用会自动重启：</p>
              <p className="pa-backup-list__name">{confirmRestore.filename}</p>
              <p className="pa-muted" style={{ marginTop: 8 }}>
                恢复前会自动保存一份「恢复前快照」，如需回退可再次恢复该快照。
              </p>
            </div>
            <div className="pa-modal__footer">
              <button type="button" className="pa-secondary-button" disabled={restoring} onClick={() => setConfirmRestore(null)}>取消</button>
              <button type="button" className="pa-secondary-button pa-danger-button" disabled={restoring} onClick={() => void onConfirmRestore()}>
                {restoring ? '恢复中…' : '确认恢复并重启'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
