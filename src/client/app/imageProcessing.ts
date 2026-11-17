/**
 * 图片后处理（纯前端 Canvas，不依赖 Host）：
 * - 裁切填充到指定宽高比（如公众号头图 900×383）
 * - 等比压缩（限制最大宽度 + 输出质量）
 * - 可选文字水印
 *
 * `computeCoverCrop` 是不依赖 DOM 的纯函数（可单测）；`processImage` 依赖
 * 浏览器 Image/Canvas，仅在浏览器环境调用。
 */

export interface CoverCrop {
  /** 源图裁切起点 x */
  sx: number
  sy: number
  /** 源图裁切宽高 */
  sw: number
  sh: number
}

/**
 * 计算「cover 模式」裁切区域：从源图中心裁出一个与目标宽高比一致的矩形，
 * 避免拉伸变形。纯函数。
 */
export function computeCoverCrop(srcW: number, srcH: number, targetW: number, targetH: number): CoverCrop {
  if (srcW <= 0 || srcH <= 0 || targetW <= 0 || targetH <= 0) {
    return { sx: 0, sy: 0, sw: srcW, sh: srcH }
  }
  const targetRatio = targetW / targetH
  const srcRatio = srcW / srcH
  if (Math.abs(srcRatio - targetRatio) < 1e-9) {
    // 比例一致时无需裁切，避免浮点误差引入多余裁剪。
    return { sx: 0, sy: 0, sw: srcW, sh: srcH }
  }
  if (srcRatio > targetRatio) {
    // 源图更宽：裁掉左右
    const sw = srcH * targetRatio
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH }
  }
  // 源图更高：裁掉上下
  const sh = srcW / targetRatio
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh }
}

export interface ImageProcessOptions {
  /** 裁切填充到指定尺寸（cover 模式），如公众号头图 { width: 900, height: 383 }。 */
  cover?: { width: number; height: number }
  /** 等比压缩：限制最大宽度（与 cover 二选一，cover 优先）。 */
  maxWidth?: number
  /** 输出质量 0~1，默认 0.85（仅对 jpeg/webp 生效）。 */
  quality?: number
  /** 输出格式，默认 image/jpeg。 */
  format?: 'image/jpeg' | 'image/png' | 'image/webp'
  /** 可选文字水印，绘制在右下角。 */
  watermark?: string
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败，请确认素材可访问'))
    img.src = src
  })
}

/** 按选项处理一张图片，返回新的 Blob。 */
export async function processImage(src: string, options: ImageProcessOptions): Promise<Blob> {
  const img = await loadImage(src)
  const { cover, maxWidth, quality = 0.85, format = 'image/jpeg', watermark } = options

  const srcW = img.naturalWidth
  const srcH = img.naturalHeight
  let sx = 0
  let sy = 0
  let sw = srcW
  let sh = srcH
  let dw: number
  let dh: number

  if (cover) {
    const crop = computeCoverCrop(srcW, srcH, cover.width, cover.height)
    sx = crop.sx
    sy = crop.sy
    sw = crop.sw
    sh = crop.sh
    dw = cover.width
    dh = cover.height
  } else if (maxWidth && srcW > maxWidth) {
    dw = maxWidth
    dh = Math.round((srcH * maxWidth) / srcW)
  } else {
    dw = srcW
    dh = srcH
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(dw))
  canvas.height = Math.max(1, Math.round(dh))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)

  if (watermark) {
    ctx.fillStyle = 'rgba(255,255,255,0.72)'
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'
    ctx.lineWidth = 3
    ctx.font = `600 ${Math.max(14, Math.round(dw * 0.035))}px system-ui, sans-serif`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.strokeText(watermark, dw - 14, dh - 14)
    ctx.fillText(watermark, dw - 14, dh - 14)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('图片导出失败'))
    }, format, quality)
  })
}
