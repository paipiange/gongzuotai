import { X, ArrowSquareOut } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { assetUrl } from './hostClient'

/** 打开一个资源的绝对 URL（供「在浏览器打开」使用）。 */
export function absoluteAssetUrl(id: string): string {
  return `${window.location.origin}${assetUrl(id)}`
}

/**
 * 全屏大图查看器：点击图片打开，点击遮罩或关闭按钮退出。
 * 顶部提供「在默认浏览器打开」按钮。
 */
export function Lightbox({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pa-lightbox" onClick={onClose}>
      <div className="pa-lightbox__bar" onClick={(event) => event.stopPropagation()}>
        <a
          className="pa-lightbox__open"
          href={absoluteAssetUrl(assetId)}
          target="_blank"
          rel="noreferrer"
        >
          <ArrowSquareOut aria-hidden="true" size={16} /> 在浏览器打开
        </a>
        <button type="button" className="pa-icon-button" aria-label="关闭" title="关闭" onClick={onClose}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <img className="pa-lightbox__image" src={assetUrl(assetId)} alt="大图预览" onClick={(event) => event.stopPropagation()} />
    </div>
  )
}
