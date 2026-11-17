import type { Context } from '@deepseek-ai/cordis'
import { FilmSlate, Warning } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import { PaipiangeRoot } from './app/PaipiangeRoot'
import { ErrorBoundary } from './app/ErrorBoundary'
import styles from './styles.css?raw'

function PaipiangeSidebarIcon({ size = 16 }: { size?: number }) {
  return <FilmSlate aria-hidden="true" size={size} weight="duotone" />
}

/** 顶层崩溃兜底：PaipiangeRoot 自身抛异常时，用最小可用界面替代白屏。 */
function RootErrorFallback(error: Error, reset: () => void) {
  return (
    <div className="pa-root" data-theme="amber" style={{ padding: 24 }}>
      <section className="pa-panel pa-large-empty">
        <div className="pa-large-empty__icon"><Warning aria-hidden="true" size={26} weight="duotone" /></div>
        <h2>拍片哥工作台遇到问题</h2>
        <p>{error.message || '插件渲染出错，请重试或重新打开面板。'}</p>
        <button type="button" className="pa-secondary-button" onClick={reset}>重试</button>
      </section>
    </div>
  )
}

function PaipiangePanel() {
  return (
    <>
      <style>{styles}</style>
      <ErrorBoundary fallback={RootErrorFallback}>
        <PaipiangeRoot />
      </ErrorBoundary>
    </>
  )
}

export const name = 'paipiange-client'
export const inject = ['slots']

export function apply(ctx: Context) {
  const slots = (ctx as Context & {
    slots: {
      inject: (name: string, setup: () => void) => () => void
      register: (options: Record<string, unknown>, component: ComponentType) => () => void
    }
  }).slots

  const register = () => {
    if (!slots?.inject || !slots?.register) return () => {}
    const disposers: Array<() => void> = []
    disposers.push(
      slots.inject('sidebar.panellist', () => {
        const off = slots.register(
          {
            name: 'sidebar.panellist',
            id: 'paipiange',
            order: 70,
            label: () => '拍片哥工作台',
          },
          PaipiangeSidebarIcon,
        )
        if (typeof off === 'function') disposers.push(off)
      }),
    )
    disposers.push(
      slots.inject('main', () => {
        const off = slots.register({ name: 'main', key: 'paipiange' }, PaipiangePanel)
        if (typeof off === 'function') disposers.push(off)
      }),
    )
    return () => {
      for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose()
    }
  }

  if (typeof ctx.effect === 'function') ctx.effect(register, 'paipiange: panel registrations')
  else register()
}

export default apply
