import { ArrowClockwise, DownloadSimple } from '@phosphor-icons/react'
import { useState } from 'react'

type Toast = (message: string, tone?: 'info' | 'success' | 'warning') => void

// 版本号在构建时从 package.json 注入（见 tsdown.config.ts 的 define），
// 避免与 package.json 中的 version 字段漂移。
declare const __APP_VERSION__: string

// ===== 更新源 =====
// 优先读 npm registry 的 dist-tags.latest（权威、即时、无 CDN 缓存延迟），
// 兜底读 GitHub 公开仓库的 package.json（raw / jsDelivr，带 CORS 头）。
// api.github.com/releases 因未认证限流严格（共享代理 IP 极易 403）已弃用。
const GITHUB_REPO = 'paipiange/gongzuotai'
const NPM_PACKAGE = 'dsh-paipiange' // 双包（dsh-paipiange / paipiange）同步发布，latest 一致
const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`

// 每个源给出「请求 URL」和「从响应体提取版本号的函数」。
interface VersionSource {
  url: string
  extract: (data: unknown) => string
}

const VERSION_SOURCES: VersionSource[] = [
  {
    url: `https://registry.npmjs.org/${NPM_PACKAGE}`,
    extract: (data) => {
      const distTags = (data as { 'dist-tags'?: { latest?: string } })['dist-tags']
      return distTags?.latest ?? ''
    },
  },
  {
    url: `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/package.json`,
    extract: (data) => (data as { version?: string }).version ?? '',
  },
  {
    url: `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`,
    extract: (data) => (data as { version?: string }).version ?? '',
  },
]

const CURRENT_VERSION = __APP_VERSION__

interface CheckState {
  status: 'idle' | 'checking' | 'latest' | 'outdated' | 'error'
  latest?: string
  url?: string
  message?: string
}

/**
 * 语义化版本号比较：返回 a 相对 b 的大小关系（-1 表示 a<b，0 相等，1 表示 a>b）。
 * 只比较 `major.minor.patch` 三段数字，忽略前缀 `v` 与预发布/构建后缀。
 * 解析失败时回退为字符串比较，避免异常导致误判。
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().replace(/^v/, '').split('-')[0].split('.')
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const na = Number.parseInt(pa[i] ?? '0', 10)
    const nb = Number.parseInt(pb[i] ?? '0', 10)
    if (Number.isNaN(na) || Number.isNaN(nb)) return a === b ? 0 : a < b ? -1 : 1
    if (na !== nb) return na < nb ? -1 : 1
  }
  return 0
}

/** 设置页「检查更新」卡片：对比 GitHub 仓库最新版本并提示升级。 */
export function UpdateCheck({ onToast }: { onToast: Toast }) {
  const [state, setState] = useState<CheckState>({ status: 'idle' })

  const settle = (latest: string) => {
    // 用语义化版本比较，而不是简单的字符串不等判断：只有远程版本严格高于当前版本
    // 才提示「发现新版本」。否则（含远程版本更低，例如 CDN 缓存命中旧版）都视为「已是最新」。
    if (compareVersions(latest, CURRENT_VERSION) > 0) {
      setState({ status: 'outdated', latest, url: RELEASES_URL })
      onToast(`发现新版本 v${latest}`, 'info')
    } else {
      setState({ status: 'latest', latest: CURRENT_VERSION })
      onToast('已是最新版本', 'success')
    }
  }

  const check = async () => {
    setState({ status: 'checking' })
    let lastError: unknown = null
    for (const source of VERSION_SOURCES) {
      try {
        const response = await fetch(source.url, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`)
          continue
        }
        const data = (await response.json()) as unknown
        const latest = source.extract(data).replace(/^v/, '').trim()
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
