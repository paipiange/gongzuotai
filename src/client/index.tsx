import type { Context } from '@deepseek-ai/cordis'
import { FilmSlate } from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import { PaipiangeRoot } from './app/PaipiangeRoot'
import styles from './styles.css?raw'

function PaipiangeSidebarIcon() {
  return <FilmSlate aria-hidden="true" size={22} weight="duotone" />
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
      register: (options: Record<string, unknown>, component: ComponentType) => void
    }
  }).slots

  slots.inject('sidebar.panellist', () => {
    slots.register(
      {
        name: 'sidebar.panellist',
        id: 'paipiange',
        order: 70,
        label: () => '拍片哥工作台',
      },
      PaipiangeSidebarIcon,
    )
  })

  slots.inject('main', () => {
    slots.register({ name: 'main', key: 'paipiange' }, PaipiangePanel)
  })
}

export default apply
