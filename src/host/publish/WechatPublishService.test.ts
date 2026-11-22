import { describe, expect, it } from 'vitest'
import { buildWechatComicHtml, decodeImageDataUrl, WechatPublishService } from './WechatPublishService'

function jpegDataUrl(text: string): string {
  return ['data:', 'image/jpeg', ';base64,', Buffer.from(text).toString('base64')].join('')
}

describe('decodeImageDataUrl', () => {
  it('decodes supported images and preserves extension', () => {
    const decoded = decodeImageDataUrl(jpegDataUrl('hello'))
    expect(decoded.mimeType).toBe('image/jpeg')
    expect(decoded.extension).toBe('.jpg')
    expect(new TextDecoder().decode(decoded.data)).toBe('hello')
  })

  it('rejects unsupported and oversized data', () => {
    const unsupported = ['data:', 'text/plain', ';base64,', 'aA=='].join('')
    expect(() => decodeImageDataUrl(unsupported)).toThrow(/格式无效/)
    expect(() => decodeImageDataUrl(jpegDataUrl('hello'), 2)).toThrow(/不能超过/)
  })
})

describe('buildWechatComicHtml', () => {
  it('escapes user text and renders all images in order', () => {
    const html = buildWechatComicHtml({
      title: '<开心>',
      imageUrls: ['https://img/1', 'https://img/2'],
      captions: ['第一张 & 开心', '第二张'],
    })
    expect(html).toContain('&lt;开心&gt;')
    expect(html).toContain('第一张 &amp; 开心')
    expect(html.indexOf('https://img/1')).toBeLessThan(html.indexOf('https://img/2'))
    expect(html).not.toContain('<开心>')
  })
})

describe('WechatPublishService', () => {
  it('tests credentials through the official token endpoint', async () => {
    const calls: string[] = []
    const fakeFetch: typeof fetch = async (input) => {
      calls.push(String(input))
      return Response.json({ access_token: 'token-value', expires_in: 7200 })
    }
    const service = new WechatPublishService(() => ({ appId: 'wx-test', appSecret: 'private-secret' }), fakeFetch)
    await expect(service.testConnection()).resolves.toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('cgi-bin/token')
  })

  it('uploads images and cover before creating a draft', async () => {
    const calls: string[] = []
    let inlineIndex = 0
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('cgi-bin/token')) return Response.json({ access_token: 'token-value', expires_in: 7200 })
      if (url.includes('media/uploadimg')) {
        inlineIndex += 1
        return Response.json({ url: `https://mmbiz.qpic.cn/${inlineIndex}` })
      }
      if (url.includes('material/add_material')) return Response.json({ media_id: 'thumb-id' })
      if (url.includes('draft/add')) {
        const body = JSON.parse(String(init?.body)) as { articles: Array<{ content: string; thumb_media_id: string }> }
        expect(body.articles[0].content).toContain('https://mmbiz.qpic.cn/1')
        expect(body.articles[0].content).toContain('https://mmbiz.qpic.cn/2')
        expect(body.articles[0].thumb_media_id).toBe('thumb-id')
        return Response.json({ media_id: 'draft-id' })
      }
      throw new Error(`unexpected URL: ${url}`)
    }
    const service = new WechatPublishService(() => ({ appId: 'wx-test', appSecret: 'private-secret' }), fakeFetch)
    await expect(service.createDraft({
      title: '快乐漫画',
      images: [
        { dataUrl: jpegDataUrl('image-1'), caption: '第一张' },
        { dataUrl: jpegDataUrl('image-2'), caption: '第二张' },
      ],
      coverDataUrl: jpegDataUrl('cover'),
    })).resolves.toEqual({ mediaId: 'draft-id', imageCount: 2 })
    expect(calls.map((url) => url.match(/cgi-bin\/([^?]+)/)?.[1])).toEqual([
      'token',
      'media/uploadimg',
      'media/uploadimg',
      'material/add_material',
      'draft/add',
    ])
  })

  it('refreshes a persisted draft by media_id', async () => {
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('cgi-bin/token')) return Response.json({ access_token: 'token-value', expires_in: 7200 })
      if (url.includes('draft/get')) {
        expect(JSON.parse(String(init?.body))).toEqual({ media_id: 'draft-id' })
        return Response.json({ news_item: [{ title: '快乐漫画' }] })
      }
      throw new Error(`unexpected URL: ${url}`)
    }
    const service = new WechatPublishService(() => ({ appId: 'wx-test', appSecret: 'private-secret' }), fakeFetch)
    await expect(service.refreshDraft('draft-id')).resolves.toEqual({ exists: true, title: '快乐漫画', articleCount: 1 })
  })

  it('reuses cached image uploads on retry instead of re-uploading', async () => {
    let inlineUploads = 0
    let coverUploads = 0
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('cgi-bin/token')) return Response.json({ access_token: 'token-value', expires_in: 7200 })
      if (url.includes('media/uploadimg')) {
        inlineUploads += 1
        return Response.json({ url: `https://mmbiz.qpic.cn/${inlineUploads}` })
      }
      if (url.includes('material/add_material')) {
        coverUploads += 1
        return Response.json({ media_id: `thumb-${coverUploads}` })
      }
      if (url.includes('draft/add')) return Response.json({ media_id: 'draft-id' })
      throw new Error(`unexpected URL: ${url}`)
    }
    const service = new WechatPublishService(() => ({ appId: 'wx-test', appSecret: 'private-secret' }), fakeFetch)
    const input = {
      title: '快乐漫画',
      images: [{ dataUrl: jpegDataUrl('image-1'), caption: '第一张' }],
      coverDataUrl: jpegDataUrl('cover'),
    }
    await service.createDraft(input)
    // 第二次发布相同图片，应命中缓存，不再上传。
    await service.createDraft(input)
    expect(inlineUploads).toBe(1)
    expect(coverUploads).toBe(1)

    // 清空缓存后再次发布应重新上传。
    service.clearUploadCache()
    await service.createDraft(input)
    expect(inlineUploads).toBe(2)
    expect(coverUploads).toBe(2)
  })
})
