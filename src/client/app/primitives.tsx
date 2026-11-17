import { CaretRight, FolderOpen, Plus, Sparkle } from '@phosphor-icons/react'
import type { StudioId } from './data'
import type { CreationStatus } from './workspaceStore'

export type ArtVariant = 'river' | 'court' | 'blossom' | 'night' | 'portrait' | 'hero'

export interface ToastState {
  message: string
  tone: 'info' | 'success' | 'warning'
}

export const studioLabels: Record<StudioId, string> = {
  article: 'AI 文章工作台',
  image: 'AI 图片工作台',
  video: 'AI 视频工作台',
  headline: '爆款标题工作台',
  marketing: '营销文案工作台',
  xiaohongshu: '小红书笔记工作台',
  graphic: '公众号创作',
}

export const statusLabels: Record<CreationStatus, string> = {
  draft: '草稿',
  queued: '待发布',
  archived: '已归档',
}

export function formatLocalTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function ScenicArt({ variant, label }: { variant: ArtVariant; label: string }) {
  const palette = {
    river: ['#e4a866', '#70412e', '#24150f'],
    court: ['#d88a55', '#59311f', '#1c120e'],
    blossom: ['#e9a19d', '#7d493b', '#26140f'],
    night: ['#8c716c', '#42302d', '#17100e'],
    portrait: ['#efb49f', '#8d493a', '#2d1712'],
    hero: ['#efad96', '#7d3e2c', '#24130e'],
  }[variant]

  const suffix = variant.replace(/[^a-z]/g, '')

  return (
    <svg
      className={`pa-art pa-art--${variant}`}
      viewBox="0 0 600 320"
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={`sky-${suffix}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={palette[0]} />
          <stop offset="0.52" stopColor={palette[1]} />
          <stop offset="1" stopColor={palette[2]} />
        </linearGradient>
        <radialGradient id={`sun-${suffix}`} cx="68%" cy="28%" r="35%">
          <stop offset="0" stopColor="#ffe0af" stopOpacity=".9" />
          <stop offset=".42" stopColor="#f1a86f" stopOpacity=".34" />
          <stop offset="1" stopColor="#f1a86f" stopOpacity="0" />
        </radialGradient>
        <filter id={`soft-${suffix}`}>
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <rect width="600" height="320" fill={`url(#sky-${suffix})`} />
      <rect width="600" height="320" fill={`url(#sun-${suffix})`} />
      <path d="M0 205 C85 168 145 198 220 166 C310 125 390 158 465 126 C525 101 565 118 600 93 L600 320 L0 320Z" fill="#2d1d17" opacity=".75" />
      <path d="M0 232 C95 196 155 220 248 190 C334 162 392 194 488 159 C536 142 573 151 600 144 L600 320 L0 320Z" fill="#1a120f" opacity=".82" />
      <path d="M0 258 C122 225 188 248 290 220 C392 194 486 232 600 198 L600 320 L0 320Z" fill="#100c0a" opacity=".88" />
      <g opacity=".74" fill="#160e0b">
        <path d="M388 207h126v53H388z" />
        <path d="M372 205l78-37 83 37z" />
        <path d="M406 173h85v-15h-85z" />
        <path d="M423 158l26-22 31 22z" />
        <path d="M415 218h12v42h-12zm31 0h12v42h-12zm31 0h12v42h-12z" fill="#ba7a49" opacity=".55" />
      </g>
      <path d="M84 228 C74 157 96 104 151 61 C112 119 114 176 128 229Z" fill="#1a100c" opacity=".85" />
      <g fill="#f3b0a8" opacity=".88">
        <circle cx="126" cy="86" r="7" /><circle cx="151" cy="74" r="5" /><circle cx="177" cy="91" r="8" />
        <circle cx="112" cy="112" r="5" /><circle cx="163" cy="112" r="6" /><circle cx="196" cy="122" r="5" />
        <circle cx="79" cy="143" r="5" /><circle cx="139" cy="139" r="8" /><circle cx="184" cy="154" r="6" />
      </g>
      {(variant === 'portrait' || variant === 'hero') && (
        <g transform="translate(298 38)">
          <ellipse cx="86" cy="65" rx="37" ry="47" fill="#f1c0a2" />
          <path d="M50 63C45 10 125 5 128 68C116 51 96 38 58 42Z" fill="#21130f" />
          <path d="M51 68C37 102 40 139 20 166C58 145 67 116 67 82Z" fill="#241510" />
          <path d="M117 69C145 107 126 138 151 165C120 148 105 118 104 83Z" fill="#241510" />
          <path d="M62 108C24 132 8 193 2 256H174C166 191 148 132 109 108C96 127 76 127 62 108Z" fill="#d78c70" />
          <path d="M56 121C70 151 104 151 117 121L140 253H24Z" fill="#e9aa8e" opacity=".9" />
          <circle cx="53" cy="35" r="10" fill="#e8b065" /><circle cx="119" cy="29" r="8" fill="#e8b065" />
        </g>
      )}
      <g fill="#f9c4bb" opacity=".62" filter={`url(#soft-${suffix})`}>
        <circle cx="540" cy="51" r="14" /><circle cx="260" cy="38" r="10" /><circle cx="212" cy="124" r="7" />
      </g>
    </svg>
  )
}

export function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pa-section-heading">
      <h2><Sparkle aria-hidden="true" size={18} weight="duotone" />{title}</h2>
      {action && (
        <button className="pa-link-button" type="button" onClick={onAction}>
          {action}<CaretRight aria-hidden="true" size={15} />
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pa-empty-state">
      <div className="pa-empty-state__icon"><FolderOpen aria-hidden="true" size={25} weight="duotone" /></div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action && <button type="button" className="pa-secondary-button" onClick={onAction}>{action}</button>}
    </div>
  )
}

export function PageIntro({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pa-page-intro">
      <div><span className="pa-overline">PAIPIANGE WORKSPACE</span><h1>{title}</h1><p>{description}</p></div>
      {action && <button type="button" className="pa-primary-button" onClick={onAction}><Plus aria-hidden="true" size={18} />{action}</button>}
    </div>
  )
}
