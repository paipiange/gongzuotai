import { Warning } from '@phosphor-icons/react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 变化时自动清除错误状态（用于路由/页面切换后自动恢复）。 */
  resetKey?: string | number
  /** 自定义错误视图；不传则用默认视图。 */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** 点击「重试」前的额外回调（如回首页）。 */
  onReset?: () => void
}

interface State {
  error: Error | null
}

/**
 * 通用错误边界：把渲染崩溃限制在局部，避免单个页面抛异常导致整个插件白屏。
 * 记录错误仅输出到控制台（本地优先，不联网上报，避免用户内容外泄）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[paipiange] 渲染错误:', error, info.componentStack)
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
      return <DefaultErrorView error={this.state.error} onReset={this.reset} />
    }
    return this.props.children
  }
}

/** 默认错误视图（需位于 .pa-root 容器内以复用主题样式变量）。 */
export function DefaultErrorView({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <section className="pa-panel pa-large-empty">
      <div className="pa-large-empty__icon"><Warning aria-hidden="true" size={26} weight="duotone" /></div>
      <h2>页面遇到问题</h2>
      <p>{error.message || '渲染过程中出现意外错误，请重试。'}</p>
      <button type="button" className="pa-secondary-button" onClick={onReset}>重试</button>
    </section>
  )
}
