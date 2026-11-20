import { DownloadSimple, Eye, PaperPlaneTilt, Sparkle, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import {
  assetUrl,
  createWechatDraft,
  createWechatSticker,
  exportComicPack,
  getWechatChannelConfig,
  type GeneratedImageResult,
  type WechatChannelSummary,
} from './hostClient'
import { processImage, type ImageProcessOptions } from './imageProcessing'

interface Toast {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

export function ComicPublishModal({
  results,
  initialTitle,
  initialCaptions,
  onClose,
  onToast,
}: {
  results: GeneratedImageResult[]
  initialTitle: string
  initialCaptions: string[]
  onClose: () => void
  onToast: Toast
}) {
  const [title, setTitle] = useState(initialTitle.trim().slice(0, 64) || 'Q版情侣漫画')
  const [stickerTitle, setStickerTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [digest, setDigest] = useState(initialTitle.trim().slice(0, 120))
  const [captions, setCaptions] = useState(() => results.map((_, index) => initialCaptions[index] ?? initialTitle))
  const [correctText, setCorrectText] = useState(true)
  const [channel, setChannel] = useState<WechatChannelSummary | null>(null)
  const [busy, setBusy] = useState<'preview' | 'export' | 'long' | 'wechat' | 'sticker' | null>(null)
  const [progress, setProgress] = useState('')
  const [previewImages, setPreviewImages] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    getWechatChannelConfig()
      .then((config) => {
        if (cancelled) return
        setChannel(config)
        setAuthor(config.defaultAuthor)
      })
      .catch(() => { if (!cancelled) setChannel(null) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const prepareImages = async () => {
    const imageDataUrls: string[] = []
    for (let index = 0; index < results.length; index += 1) {
      setProgress(`正在处理第 ${index + 1}/${results.length} 张图片`)
      const caption = captions[index]?.trim() || title
      const blob = await processJpegWithinLimit(assetUrl(results[index].id), {
        maxWidth: 900,
        format: 'image/jpeg',
        ...(correctText ? { titleOverlay: caption } : {}),
      }, 950 * 1024, [0.82, 0.72, 0.6, 0.48])
      imageDataUrls.push(await blobToDataUrl(blob))
    }
    setProgress('正在生成公众号封面')
    const coverBlob = await processJpegWithinLimit(assetUrl(results[0].id), {
      cover: { width: 900, height: 383 },
      format: 'image/jpeg',
      ...(correctText ? { titleOverlay: title } : {}),
    }, 63 * 1024, [0.78, 0.64, 0.5, 0.38, 0.28])
    return { imageDataUrls, coverDataUrl: await blobToDataUrl(coverBlob) }
  }

  const exportPack = async () => {
    setBusy('export')
    try {
      const prepared = await prepareImages()
      setProgress('正在打包图片和发布文案')
      const blob = await exportComicPack({ title, captions, ...prepared })
      downloadBlob(blob, `${safeDownloadName(title)}-贴图包.zip`)
      onToast(`已导出 ${results.length} 张漫画贴图包`, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '贴图包导出失败', 'warning')
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  const buildPreview = async () => {
    setBusy('preview')
    try {
      const prepared = await prepareImages()
      setPreviewImages(prepared.imageDataUrls)
      onToast('发布预览已更新', 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '发布预览生成失败', 'warning')
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  const exportLongImage = async () => {
    setBusy('long')
    try {
      const prepared = await prepareImages()
      setProgress('正在拼接竖版长图')
      const blob = await stitchVertical(prepared.imageDataUrls)
      downloadBlob(blob, `${safeDownloadName(title)}-长图.jpg`)
      onToast(`已导出 ${results.length} 张合成长图`, 'success')
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '长图导出失败', 'warning')
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  const syncWechat = async () => {
    if (!channel?.configured) {
      onToast('请先在「设置中心 → 微信公众号」配置并测试账号', 'warning')
      return
    }
    setBusy('wechat')
    try {
      const prepared = await prepareImages()
      setProgress('正在上传图片并创建公众号草稿')
      const result = await createWechatDraft({
        title,
        author,
        digest,
        images: prepared.imageDataUrls.map((dataUrl, index) => ({ dataUrl, caption: captions[index]?.trim() || title })),
        coverDataUrl: prepared.coverDataUrl,
      })
      onToast(`已同步 ${result.imageCount} 张图片到公众号草稿箱，请到后台发表`, 'success')
      onClose()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '同步公众号草稿失败', 'warning')
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  const syncSticker = async () => {
    if (!channel?.configured) {
      onToast('请先在「设置中心 → 微信公众号」配置并测试账号', 'warning')
      return
    }
    setBusy('sticker')
    try {
      const imageDataUrls: string[] = []
      for (let index = 0; index < results.length; index += 1) {
        setProgress(`正在准备第 ${index + 1}/${results.length} 张贴图`)
        const blob = await processJpegWithinLimit(assetUrl(results[index].id), {
          maxWidth: 1280,
          format: 'image/jpeg',
        }, 2 * 1024 * 1024, [0.9, 0.82, 0.72, 0.62])
        imageDataUrls.push(await blobToDataUrl(blob))
      }
      setProgress('正在上传图片并创建公众号贴图草稿')
      const result = await createWechatSticker({
        title: stickerTitle.trim() || title,
        images: imageDataUrls.map((dataUrl, index) => ({ dataUrl, caption: captions[index]?.trim() || title })),
      })
      onToast(`已同步 ${result.imageCount} 张贴图到公众号草稿箱，请到后台发表`, 'success')
      onClose()
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '同步公众号贴图失败', 'warning')
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  return (
    <div className="pa-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <form
        className="pa-modal pa-comic-publish"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pa-comic-publish-title"
        onSubmit={(event) => event.preventDefault()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pa-modal__head">
          <div>
            <h3 id="pa-comic-publish-title">发布 / 导出漫画</h3>
            <p>先校对发布文字，再导出贴图包，或把文章 / 贴图同步到公众号草稿箱。</p>
          </div>
          <button type="button" className="pa-icon-button" aria-label="关闭发布面板" disabled={Boolean(busy)} onClick={onClose}><X aria-hidden="true" size={18} /></button>
        </div>

        <div className="pa-modal__body">
          <div className="pa-comic-publish__meta">
            <label className="pa-field pa-field--full">
              <span>文章标题 <b aria-hidden="true">*</b></span>
              <input autoFocus type="text" maxLength={64} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="pa-field">
              <span>作者</span>
              <input type="text" maxLength={16} value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="可选" />
            </label>
            <label className="pa-field">
              <span>摘要</span>
              <input type="text" maxLength={120} value={digest} onChange={(event) => setDigest(event.target.value)} placeholder="可选" />
            </label>
            <label className="pa-field pa-field--full">
              <span>贴图标题</span>
              <input type="text" maxLength={10} value={stickerTitle} onChange={(event) => setStickerTitle(event.target.value)} placeholder="可选，默认用文章标题（约 10 个中文字）" />
            </label>
          </div>

          <label className="pa-comic-publish__toggle">
            <input type="checkbox" checked={correctText} onChange={(event) => setCorrectText(event.target.checked)} />
            <span><Sparkle aria-hidden="true" size={17} />重新排版准确中文</span>
            <small>用本地 Canvas 覆盖顶部文字区，避免 AI 错字或乱码；原始生成图片不会被修改。</small>
          </label>

          <div className="pa-comic-publish__captions">
            <h4>逐张校对</h4>
            {results.map((result, index) => (
              <div key={result.id} className="pa-comic-publish__caption-row">
                <img src={assetUrl(result.id)} alt={`第 ${index + 1} 张漫画缩略图`} />
                <label className="pa-field">
                  <span>第 {index + 1} 张图片文字</span>
                  <textarea
                    maxLength={200}
                    value={captions[index] ?? ''}
                    onChange={(event) => setCaptions((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}
                  />
                </label>
              </div>
            ))}
          </div>

          <div className="pa-comic-publish__channel" data-configured={channel?.configured === true}>
            <strong>微信公众号：{channel?.configured ? `已配置 ${channel.appId}` : '尚未配置'}</strong>
            <span>{channel?.configured ? '「文章」和「贴图」都只同步到草稿箱，需到公众号后台点「发表」（个人/订阅号无 API 直接发布权限）。' : '请先到设置中心填写 AppID、AppSecret 并测试连接。'}</span>
          </div>
          {previewImages.length > 0 && (
            <section className="pa-comic-publish__preview" aria-label="发布效果预览">
              <h4>发布效果预览</h4>
              <div>
                {previewImages.map((src, index) => <img key={index} src={src} alt={`发布预览第 ${index + 1} 张`} />)}
              </div>
            </section>
          )}
          {progress && <div className="pa-comic-publish__progress" role="status" aria-live="polite">{progress}</div>}
        </div>

        <div className="pa-modal__actions pa-comic-publish__actions">
          <button type="button" className="pa-secondary-button" disabled={Boolean(busy) || !results.length || !title.trim()} onClick={() => void buildPreview()}>
            <Eye aria-hidden="true" size={17} />{busy === 'preview' ? '预览生成中…' : '发布预览'}
          </button>
          <button type="button" className="pa-secondary-button" disabled={Boolean(busy) || !results.length || !title.trim()} onClick={() => void exportPack()}>
            <DownloadSimple aria-hidden="true" size={17} />{busy === 'export' ? '导出中…' : '导出贴图包'}
          </button>
          <button type="button" className="pa-secondary-button" disabled={Boolean(busy) || !results.length || !title.trim()} onClick={() => void exportLongImage()}>
            <DownloadSimple aria-hidden="true" size={17} />{busy === 'long' ? '拼接中…' : '导出长图'}
          </button>
          <button type="button" className="pa-primary-button" disabled={Boolean(busy) || !results.length || !title.trim() || !channel?.configured} onClick={() => void syncWechat()}>
            <PaperPlaneTilt aria-hidden="true" size={17} />{busy === 'wechat' ? '同步中…' : '同步公众号文章'}
          </button>
          <button type="button" className="pa-primary-button" disabled={Boolean(busy) || !results.length || !channel?.configured} onClick={() => void syncSticker()}>
            <PaperPlaneTilt aria-hidden="true" size={17} />{busy === 'sticker' ? '同步中…' : '同步公众号贴图'}
          </button>
        </div>
      </form>
    </div>
  )
}

async function stitchVertical(dataUrls: string[]): Promise<Blob> {
  const images = await Promise.all(dataUrls.map(loadImage))
  if (!images.length) throw new Error('没有可拼接的图片')
  const width = Math.max(...images.map((image) => image.naturalWidth))
  const gap = 24
  const padding = 24
  const scaledHeights = images.map((image) => Math.round(image.naturalHeight * (width / image.naturalWidth)))
  const height = scaledHeights.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, images.length - 1) + padding * 2
  const canvas = document.createElement('canvas')
  canvas.width = width + padding * 2
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持长图拼接')
  context.fillStyle = '#f7f0e5'
  context.fillRect(0, 0, canvas.width, canvas.height)
  let y = padding
  images.forEach((image, index) => {
    context.drawImage(image, padding, y, width, scaledHeights[index])
    y += scaledHeights[index] + gap
  })
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('长图编码失败')), 'image/jpeg', 0.9))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('长图素材读取失败'))
    image.src = src
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片转换失败'))
    reader.onerror = () => reject(new Error('图片转换失败'))
    reader.readAsDataURL(blob)
  })
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeDownloadName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'Q版情侣漫画'
}

async function processJpegWithinLimit(
  src: string,
  options: ImageProcessOptions,
  maxBytes: number,
  qualities: number[],
): Promise<Blob> {
  let last: Blob | null = null
  for (const quality of qualities) {
    last = await processImage(src, { ...options, format: 'image/jpeg', quality })
    if (last.size <= maxBytes) return last
  }
  if (!last) throw new Error('图片压缩失败')
  if (last.size > maxBytes) throw new Error(`图片压缩后仍超过 ${Math.ceil(maxBytes / 1024)}KB，请更换更简洁的图片`)
  return last
}
