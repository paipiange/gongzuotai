/**
 * 首页轮播图设置卡片：上传本地图片作为首页 Hero 轮播。
 * 未配置任何图片时，首页回退显示内置默认图（HERO_BG）。
 * 图片复用素材库上传能力，仅保存 asset id 列表。
 */

import { ArrowDown, ArrowUp, ImageSquare, Plus, Trash, UploadSimple } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { assetUrl, getHomeCarousel, setHomeCarousel, uploadAsset } from './hostClient'
import type { AssetRecord, HomeCarouselConfig } from './hostClient'
import { HERO_BG } from './heroBackground'
import { DEFAULT_REMOTE_CAROUSEL } from './defaultCarousel'

interface ToastFn {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'

export function HomeCarouselSettings({ onToast }: { onToast: ToastFn }) {
  const [assetIds, setAssetIds] = useState<string[]>([])
  const [includeDefault, setIncludeDefault] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = async () => {
    try {
      const config = await getHomeCarousel()
      setAssetIds(config.assetIds)
      setIncludeDefault(config.includeDefault)
      setLoaded(true)
    } catch {
      setLoaded(false)
    }
  }

  const persist = async (patch: Partial<HomeCarouselConfig>) => {
    setBusy(true)
    try {
      await setHomeCarousel(patch)
      if (patch.assetIds !== undefined) setAssetIds(patch.assetIds)
      if (patch.includeDefault !== undefined) setIncludeDefault(patch.includeDefault)
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '轮播图保存失败', 'warning')
    } finally {
      setBusy(false)
    }
  }

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!images.length) {
      onToast('请选择图片文件（jpg / png / webp / gif）', 'warning')
      return
    }
    setBusy(true)
    const next = [...assetIds]
    for (const file of images) {
      try {
        const asset: AssetRecord = await uploadAsset(file)
        next.push(asset.id)
      } catch (cause) {
        onToast(cause instanceof Error ? cause.message : `上传「${file.name}」失败`, 'warning')
      }
    }
    setBusy(false)
    if (next.length !== assetIds.length) {
      await persist({ assetIds: next })
      onToast(`已添加 ${next.length - assetIds.length} 张轮播图`, 'success')
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= assetIds.length) return
    const next = [...assetIds]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    void persist({ assetIds: next })
  }

  const remove = (index: number) => {
    const next = assetIds.filter((_, i) => i !== index)
    void persist({ assetIds: next })
    onToast('已移除该轮播图', 'success')
  }

  const toggleDefault = (checked: boolean) => {
    setIncludeDefault(checked)
    void persist({ includeDefault: checked })
    onToast(checked ? '默认图已加入轮播' : '默认图已从轮播移除', 'success')
  }

  const reset = () => {
    void persist({ assetIds: [], includeDefault: true })
    onToast('已恢复为默认首页图', 'success')
  }

  return (
    <section className="pa-panel pa-setting-card">
      <div className="pa-setting-card__icon"><ImageSquare aria-hidden="true" size={23} /></div>
      <div className="pa-carousel-settings">
        <div className="pa-carousel-settings__head">
          <div>
            <h2>首页轮播图</h2>
            <p>默认内置图 + {DEFAULT_REMOTE_CAROUSEL.length} 张远程轮播图（GitHub 托管）自动轮播；可勾选是否纳入，也可上传本地图片追加。</p>
          </div>
          <div className="pa-carousel-settings__actions">
            <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(event) => void onPickFiles(event.target.files)} />
            <button type="button" className="pa-secondary-button" disabled={busy} onClick={() => inputRef.current?.click()}>
              <UploadSimple aria-hidden="true" size={16} />{busy ? '上传中…' : '上传图片'}
            </button>
            {(assetIds.length > 0 || !includeDefault) && (
              <button type="button" className="pa-link-button pa-danger-link" onClick={reset}><Trash aria-hidden="true" size={14} />恢复默认</button>
            )}
          </div>
        </div>

        <div className="pa-carousel-settings__tip">
          <strong>尺寸建议</strong> 推荐横版 <strong>4:1</strong>（如 1600×400、1920×480），图片会以「封面裁剪」方式居中显示，超出部分自动裁切。首页左侧约 57% 会叠加标题与按钮，请把主体内容放在图片右侧。
        </div>

        {!loaded ? (
          <p className="pa-carousel-settings__empty">Host 服务未连接，轮播图设置不可用。</p>
        ) : (
          <>
            {/* 默认图：内置 base64 + 远程轮播图，固定排最前，带纳入轮播开关 */}
            <div className="pa-carousel-default">
              <img src={HERO_BG} alt="默认首页图" loading="lazy" />
              <span className="pa-carousel-list__index">默认</span>
              <label className="pa-carousel-default__toggle">
                <input type="checkbox" checked={includeDefault} disabled={busy} onChange={(event) => toggleDefault(event.target.checked)} />
                <span>纳入轮播</span>
              </label>
            </div>

            {/* 默认远程轮播图：首页专属 banner，GitHub 托管，随 includeDefault 开关一起纳入 */}
            <ul className="pa-carousel-list">
              {DEFAULT_REMOTE_CAROUSEL.map((src, index) => (
                <li key={src} className="pa-carousel-list__item">
                  <img src={src} alt={`默认远程轮播图 ${index + 1}`} loading="lazy" />
                  <span className="pa-carousel-list__index">默认 {index + 1}</span>
                  <span className="pa-carousel-list__tag">远程</span>
                </li>
              ))}
            </ul>

            {assetIds.length === 0 ? (
              <p className="pa-carousel-settings__empty">
                {includeDefault
                  ? '当前显示内置默认图 + 远程轮播图。点击「上传图片」追加自定义轮播图。'
                  : '默认图已关闭且无自定义图，首页仍回退显示内置默认图。'}
              </p>
            ) : (
              <ul className="pa-carousel-list">
                {assetIds.map((id, index) => (
                  <li key={id} className="pa-carousel-list__item">
                    <img src={assetUrl(id)} alt={`轮播图 ${index + 1}`} loading="lazy" />
                    <span className="pa-carousel-list__index">{index + 1}</span>
                    <span className="pa-carousel-list__actions">
                      <button type="button" className="pa-icon-button" disabled={busy || index === 0} aria-label="前移" onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" size={16} /></button>
                      <button type="button" className="pa-icon-button" disabled={busy || index === assetIds.length - 1} aria-label="后移" onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" size={16} /></button>
                      <button type="button" className="pa-icon-button" disabled={busy} aria-label="移除" onClick={() => remove(index)}><Trash aria-hidden="true" size={16} /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {(assetIds.length > 0 || includeDefault) && (
              <p className="pa-carousel-settings__hint">
                <Plus aria-hidden="true" size={12} />
                首页轮播顺序：{includeDefault ? `内置默认图 → 远程轮播图 ${DEFAULT_REMOTE_CAROUSEL.length} 张 → ` : ''}{assetIds.length > 0 ? `自定义图 ${assetIds.length} 张` : '无自定义图'}。
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
