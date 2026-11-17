import { X, ArrowSquareOut, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { assetUrl } from './hostClient'

/** 打开一个资源的绝对 URL（供「在浏览器打开」使用）。 */
export function absoluteAssetUrl(id: string): string {
  return `${window.location.origin}${assetUrl(id)}`
}

export interface LightboxProps {
  /** 单个 asset id（旧用法，等价于单元素数组）。 */
  assetId?: string
  /** 多个 asset id，支持左右切换预览。 */
  assetIds?: string[]
  /** 打开时定位到的图片索引（默认 0）。 */
  index?: number
  onClose: () => void
}

/**
 * 全屏大图查看器：点击图片打开，点击遮罩或关闭按钮退出。
 * 顶部提供「在默认浏览器打开」按钮；传入多图时支持左右切换（含键盘方向键）。
 */
export function Lightbox({ assetId, assetIds, index = 0, onClose }: LightboxProps) {
  const ids = assetIds && assetIds.length > 0 ? assetIds : assetId ? [assetId] : []
  const [cursor, setCursor] = useState(() => Math.min(Math.max(index, 0), Math.max(ids.length - 1, 0)))

  const current = ids[cursor] ?? null

  const go = (delta: number) => {
    if (ids.length === 0) return
    setCursor((prev) => (prev + delta + ids.length) % ids.length)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') go(-1)
      else if (event.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.length, onClose])

  if (!current) return null

  return (
    <div className="pa-lightbox" onClick={onClose}>
      <div className="pa-lightbox__bar" onClick={(event) => event.stopPropagation()}>
        {ids.length > 1 && <span className="pa-lightbox__counter">{cursor + 1} / {ids.length}</span>}
        <a
          className="pa-lightbox__open"
          href={absoluteAssetUrl(current)}
          target="_blank"
          rel="noreferrer"
        >
          <ArrowSquareOut aria-hidden="true" size={16} /> 在浏览器打开
        </a>
        <button type="button" className="pa-icon-button" aria-label="关闭" title="关闭" onClick={onClose}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      {ids.length > 1 && (
        <>
          <button type="button" className="pa-lightbox__nav pa-lightbox__nav--prev" aria-label="上一张" onClick={(event) => { event.stopPropagation(); go(-1) }}>
            <CaretLeft aria-hidden="true" size={28} weight="bold" />
          </button>
          <button type="button" className="pa-lightbox__nav pa-lightbox__nav--next" aria-label="下一张" onClick={(event) => { event.stopPropagation(); go(1) }}>
            <CaretRight aria-hidden="true" size={28} weight="bold" />
          </button>
        </>
      )}
      <img className="pa-lightbox__image" src={assetUrl(current)} alt="大图预览" onClick={(event) => event.stopPropagation()} />
    </div>
  )
}
