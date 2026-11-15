import { ArrowClockwise, DownloadSimple } from '@phosphor-icons/react'
import { useState } from 'react'

type Toast = (message: string, tone?: 'info' | 'success' | 'warning') => void

const CURRENT_VERSION = '0.1.0'
const REPO = 'paipiange/gongzuotai'
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

interface CheckState {
  status: 'idle' | 'checking' | 'latest' | 'outdated' | 'error'
  latest?: string
  url?: string
  message?: string
}

/** 设置页「检查更新」卡片：对比 GitHub Release 最新版本并提示升级。 */
export function UpdateCheck({ onToast }: { onToast: Toast }) {
  const [state, setState] = useState<CheckState>({ status: 'idle' })

  const check = async () => {
    setState({ status: 'checking' })
    try {
      const response = await fetch(RELEASES_URL, { headers: { accept: 'application/vnd.github+json' } })
      if (!response.ok) {
        setState({ status: 'error', message: `查询失败（HTTP ${response.status}）` })
        return
      }
      const data = await response.json() as { tag_name?: string; html_url?: string; name?: string }
      const latest = (data.tag_name ?? '').replace(/^v/, '')
      if (!latest) {
        setState({ status: 'error', message: '未找到发布版本' })
        return
      }
      if (latest === CURRENT_VERSION) {
        setState({ status: 'latest', latest })
        onToast('已是最新版本', 'success')
      } else {
        setState({ status: 'outdated', latest, url: data.html_url ?? RELEASES_PAGE })
        onToast(`发现新版本 v${latest}`, 'info')
      }
    } catch (cause) {
      setState({ status: 'error', message: cause instanceof Error ? cause.message : '网络错误' })
    }
  }

  return (
    <section className="pa-panel pa-setting-card pa-update-check">
      <div className="pa-setting-card__icon"><ArrowClockwise aria-hidden="true" size={23} /></div>
      <div>
        <h2>检查更新</h2>
        <p>
          当前版本 v{CURRENT_VERSION}
          {state.status === 'latest' && ` · 已是最新`}
          {state.status === 'outdated' && ` · 最新版本 v${state.latest}`}
          {state.status === 'error' && state.message && ` · ${state.message}`}
        </p>
      </div>
      <div className="pa-update-check__actions">
        {state.status === 'outdated' && state.url && (
          <a className="pa-secondary-button" href={state.url} target="_blank" rel="noopener noreferrer">
            <DownloadSimple aria-hidden="true" size={16} />前往下载
          </a>
        )}
        <button type="button" className="pa-secondary-button" onClick={check} disabled={state.status === 'checking'}>
          <ArrowClockwise aria-hidden="true" size={16} />{state.status === 'checking' ? '检查中…' : '立即检查'}
        </button>
      </div>
    </section>
  )
}
