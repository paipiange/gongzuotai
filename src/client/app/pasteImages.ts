/**
 * 剪贴板图片粘贴工具：从 paste 事件提取图片文件并转成 data URL，
 * 供生图（作为参考图参与图生图）与生文（作为参考留存）复用。
 */

/** 从粘贴事件的剪贴板数据里提取图片文件（忽略非图片项）。 */
export function extractImageFilesFromClipboard(data: DataTransfer | null): File[] {
  const files: File[] = []
  if (!data) return files

  const items = data.items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }

  // 某些来源（文件管理器复制、部分截图工具）图片只出现在 files 里。
  if (files.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith('image/')) files.push(file)
    }
  }
  return files
}

/** 读取图片文件为 data URL（校验图片类型与大小上限）。 */
export async function readImageAsDataUrl(file: File, maxBytes = 16 * 1024 * 1024): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('仅支持粘贴图片')
  if (file.size > maxBytes) throw new Error(`图片不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`)
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}
