import { Palette } from '@phosphor-icons/react'

const THEMES: Array<{ id: string; label: string; swatch: [string, string, string] }> = [
  { id: 'amber', label: '暖棕金', swatch: ['#e5b77e', '#291a13', '#140e0a'] },
  { id: 'jade', label: '青玉绿', swatch: ['#8fd4b0', '#1b2b22', '#0c1410'] },
  { id: 'indigo', label: '靛蓝夜', swatch: ['#9aa4e8', '#1e2036', '#0e0f1a'] },
  { id: 'crimson', label: '绯红霞', swatch: ['#e89a9a', '#361c1c', '#1a0e0e'] },
]

/** 设置页「主题与界面」卡片：切换整体配色主题。 */
export function ThemeSettings({ theme, onThemeChange }: { theme: string; onThemeChange: (theme: string) => void }) {
  return (
    <section className="pa-panel pa-setting-card pa-theme-settings">
      <div className="pa-setting-card__icon"><Palette aria-hidden="true" size={23} /></div>
      <div>
        <h2>主题与界面</h2>
        <p>切换工作台整体配色，选择会保存在本地。</p>
      </div>
      <div className="pa-theme-swatches">
        {THEMES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="pa-theme-swatch"
            data-active={theme === item.id}
            onClick={() => onThemeChange(item.id)}
            aria-label={`切换到${item.label}主题`}
            title={item.label}
          >
            <span className="pa-theme-swatch__dot" style={{ background: item.swatch[0] }} />
            <span className="pa-theme-swatch__dot" style={{ background: item.swatch[1] }} />
            <span className="pa-theme-swatch__dot" style={{ background: item.swatch[2] }} />
            <span className="pa-theme-swatch__label">{item.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
