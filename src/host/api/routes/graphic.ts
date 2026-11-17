import { error, json, type ApiDeps, type RegisterRoute } from './shared'

/** Graphic studio session persistence and storyboard ZIP export. */
export function registerGraphicRoutes(deps: ApiDeps, register: RegisterRoute) {
  const { graphicSessions, assets, exports } = deps

  register('/api/paipiange.graphic.session', ['GET', 'PUT', 'DELETE'], async (request) => {
      if (request.method === 'GET') {
        return json({ session: graphicSessions.get() })
      }
      if (request.method === 'DELETE') {
        graphicSessions.clear()
        return json({ ok: true })
      }
      const body = await request.json().catch(() => null) as {
        sourceText?: unknown
        topic?: unknown
        pageCount?: unknown
        textPick?: unknown
        imagePick?: unknown
        storyboardJson?: unknown
        pagesJson?: unknown
        sessionId?: unknown
      } | null
      if (!body) return error('请求体无效')
      graphicSessions.save({
        sourceText: typeof body.sourceText === 'string' ? body.sourceText : '',
        topic: typeof body.topic === 'string' ? body.topic : '',
        pageCount: typeof body.pageCount === 'number' && body.pageCount > 0 ? Math.floor(body.pageCount) : 4,
        textPick: typeof body.textPick === 'string' ? body.textPick : '',
        imagePick: typeof body.imagePick === 'string' ? body.imagePick : '',
        storyboardJson: typeof body.storyboardJson === 'string' ? body.storyboardJson : null,
        pagesJson: typeof body.pagesJson === 'string' ? body.pagesJson : '[]',
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
      })
      return json({ ok: true })
  })

  register('/api/paipiange.graphic.export', ['POST'], async (request) => {
      const body = await request.json().catch(() => null) as { assetIds?: unknown; title?: string } | null
      if (!body || !Array.isArray(body.assetIds) || !body.assetIds.length) return error('缺少 assetIds')
      const { readFileSync } = await import('node:fs')
      const entries: Array<{ name: string; data: Uint8Array }> = []
      for (let i = 0; i < body.assetIds.length; i++) {
        const asset = assets.getById(String(body.assetIds[i]))
        if (!asset) continue
        const buffer = readFileSync(assets.resolveAbsolutePath(asset))
        const mime = asset.mimeType?.toLowerCase() ?? ''
        const ext = mime.includes('png') ? '.png' : mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.bin'
        entries.push({ name: `page-${String(i + 1).padStart(2, '0')}${ext}`, data: new Uint8Array(buffer) })
      }
      if (!entries.length) return error('没有可导出的已生成图片')
      const result = exports.exportZip(String(body.title ?? '公众号分镜'), entries)
      const absolute = exports.resolveAbsolute(result.relativePath)
      const buffer = readFileSync(absolute)
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
          'Cache-Control': 'no-store',
        },
      })
  })
}
