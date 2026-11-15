import type { Context } from '@deepseek-ai/cordis'
import { FilmSlate } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import { PaipiangeRoot } from './app/PaipiangeRoot'
import styles from './styles.css?raw'

function PaipiangeSidebarIcon({ size = 16 }: { size?: number }) {
  return <FilmSlate aria-hidden="true" size={size} weight="duotone" />
}

function PaipiangePanel() {
  return (
    <>
      <style>{styles}</style>
      <PaipiangeRoot />
    </>
  )
}

export const name = 'paipiange-client'
export const inject = ['slots']

export function apply(ctx: Context) {
  const slots = (ctx as Context & {
    slots: {
      inject: (name: string, setup: () => void) => void
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
