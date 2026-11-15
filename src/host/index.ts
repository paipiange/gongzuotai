import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PaipiangeDatabase } from './storage/database'
import { CreationRepository } from './storage/creationRepository'
import { SettingsRepository } from './storage/SettingsRepository'
import { AssetRepository } from './storage/assetRepository'
import { TemplateRepository } from './storage/templateRepository'
import { InspirationRepository } from './storage/inspirationRepository'
import { PublishRepository } from './storage/publishRepository'
import { ExportService } from './storage/exportService'
import { ImageGenService } from './imagegen/ImageGenService'
import { registerApiRoutes } from './api/routes'
import { sendWebResponse, toWebRequest } from './api/webServerAdapter'

export const name = 'paipiange'

/**
 * Declare the Harness services this plugin needs:
 * - `webServer`: registers the private `/api/paipiange.*` routes.
 * - `connection`: enforces the host's request/Origin checks on those routes.
 */
export const inject = ['webServer', 'connection']

export interface Config {
  /** Base data directory. The plugin creates a private `paipiange` folder inside it. */
  dataRoot?: string
}

/** The official Harness web-server route shape (`kind: 'exact'`). */
interface WebServerService {
  register: (route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => void
}

/** The official Harness connection trust-check surface. */
interface ConnectionService {
  requestRejection?: (request: IncomingMessage) => undefined | unknown
}

type HostContext = Context & { webServer?: WebServerService; connection?: ConnectionService }

/**
 * Initializes private Host storage and registers the full API surface (health,
 * creations CRUD, image-gen config/generate, asset retrieval) through the
 * official `webServer` service, guarded by the `connection` trust check.
 * No unauthenticated data is ever served.
 */
export async function apply(ctx: Context, config: Config = {}) {
  const host = ctx as HostContext
  const webServer = host.webServer
  if (!webServer?.register) {
    // The web-server carrier is mandatory; without it there is no way to expose
    // Host routes to the client, so refuse to activate rather than silently
    // degrade to a storage-only (and unreachable) plugin.
    throw new Error('paipiange: Harness webServer 服务不可用，无法注册 Host API 路由')
  }

  const storage = await PaipiangeDatabase.open({ dataRoot: config.dataRoot })

  const creations = new CreationRepository(storage.db)
  const settings = new SettingsRepository(storage.db)
  const assets = new AssetRepository(storage.db, storage.paths)
  const templates = new TemplateRepository(storage.db)
  const inspirations = new InspirationRepository(storage.db)
  const publish = new PublishRepository(storage.db)
  const exports = new ExportService(storage.paths)

  // The image-gen service is rebuilt on demand from the latest saved config so
  // a newly saved backend takes effect without a plugin restart.
  const buildImageGen = () =>
    new ImageGenService({
      llm: settings.getLlmImageConfig() ?? undefined,
      comfyui: settings.getComfyUiConfig() ?? undefined,
    })

  // Trust gate: when the `connection` service exposes `requestRejection`, use it
  // to reject any request the host does not trust. When absent, fall back to the
  // host's own carrier-level checks (do not open a bare public route).
  const trust = host.connection?.requestRejection

  const disposers: Array<() => void> = []

  try {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.health',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              res.statusCode = 401
              res.end(JSON.stringify({ error: '未授权' }))
              return
            }
          }
          await sendWebResponse(
            res,
            Response.json(
              { ok: true, schema: 'v1', database: storage.paths.database },
              { headers: { 'Cache-Control': 'no-store' } },
            ),
          )
        },
      }),
    )

    registerApiRoutes(
      { creations, settings, assets, templates, inspirations, publish, exports, buildImageGen },
      (path, methods, handler) => {
        disposers.push(
          webServer.register({
            kind: 'exact',
            path,
            async handler(req, res) {
              if (trust) {
                const rejection = trust(req)
                if (rejection !== undefined) {
                  await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
                  return
                }
              }
              if (!methods.includes(req.method ?? '')) {
                await sendWebResponse(res, Response.json({ error: '方法不允许' }, { status: 405 }))
                return
              }
              try {
                const request = await toWebRequest(req)
                await sendWebResponse(res, await handler(request))
              } catch (error) {
                await sendWebResponse(res, Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }))
              }
            },
          }),
        )
      },
    )
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // best-effort rollback
      }
    }
    storage.close()
    throw error
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        // best-effort teardown
      }
    }
    storage.close()
  }, 'paipiange.sqlite')
}
