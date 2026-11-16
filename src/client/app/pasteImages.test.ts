import { describe, expect, it } from 'vitest'
import { extractImageFilesFromClipboard } from './pasteImages'

function mockFile(type: string, name: string): File {
  return new File(['x'], name, { type })
}

describe('extractImageFilesFromClipboard', () => {
  it('从 items 提取图片文件，忽略非图片项', () => {
    const png = mockFile('image/png', 'a.png')
    const txt = mockFile('text/plain', 'a.txt')
    const data = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => png },
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'text/plain', getAsFile: () => txt },
      ],
      files: [],
    } as unknown as DataTransfer
    expect(extractImageFilesFromClipboard(data)).toEqual([png])
  })

  it('items 无图片时回退到 files', () => {
    const png = mockFile('image/jpeg', 'b.jpg')
    const data = {
      items: [],
      files: [png, mockFile('text/plain', 'x.txt')],
    } as unknown as DataTransfer
    expect(extractImageFilesFromClipboard(data)).toEqual([png])
  })

  it('null 剪贴板返回空数组', () => {
    expect(extractImageFilesFromClipboard(null)).toEqual([])
  })
})
