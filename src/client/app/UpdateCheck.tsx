import { ArrowClockwise, DownloadSimple } from '@phosphor-icons/react'
import { useState } from 'react'

type Toast = (message: string, tone?: 'info' | 'success' | 'warning') => void

// 版本号在构建时从 package.json 注入（见 tsdown.config.ts 的 define），
// 避免与 package.json 中的 version 字段漂移。
declare const __APP_VERSION__: string

// ===== 更新源 =====
// 从 GitHub 公开仓库的 package.json 读版本号（而非 api.github.com/releases）。
// api.github.com 未认证请求限流严格（共享代理 IP 极易 403），而 raw / jsDelivr
// 走内容 CDN 不受该限流影响，且带 CORS 头，前端可直接 fetch。
const GITHUB_REPO = 'paipiange/gongzuotai'
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

// 镜像列表：jsDelivr（CDN 加速，优先）→ raw.githubusercontent（兜底）。
const VERSION_SOURCES = [
  `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/package.json`,
  `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`,
]

const CURRENT_VERSION = __APP_VERSION__

interface CheckState {
  status: 'idle' | 'checking' | 'latest' | 'outdated' | 'error'
  latest?: string
  url?: string
  message?: string
}

/** 设置页「检查更新」卡片：对比 GitHub 仓库最新版本并提示升级。 */
export function UpdateCheck({ onToast }: { onToast: Toast }) {
  const [state, setState] = useState<CheckState>({ status: 'idle' })

  const settle = (latest: string) => {
    if (latest === CURRENT_VERSION) {
      setState({ status: 'latest', latest })
      onToast('已是最新版本', 'success')
    } else {
      setState({ status: 'outdated', latest, url: RELEASES_URL })
      onToast(`发现新版本 v${latest}`, 'info')
    }
  }

  const check = async () => {
    setState({ status: 'checking' })
    let lastError: unknown = null
    for (const source of VERSION_SOURCES) {
      try {
        const response = await fetch(source, {
          headers: { accept: 'application/vnd.github+json' },
          cache: 'no-store',
        })
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`)
          continue
        }
        const data = await response.json() as { version?: string }
        const latest = (data.version ?? '').replace(/^v/, '').trim()
        if (!latest) {
          lastError = new Error('版本号缺失')
          continue
        }
        settle(latest)
        return
      } catch (cause) {
        lastError = cause
      }
    }
    setState({
      status: 'error',
      message: lastError instanceof Error ? lastError.message : '查询失败',
    })
    onToast('查询更新失败，请稍后重试', 'warning')
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
