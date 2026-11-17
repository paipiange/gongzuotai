import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { PaipiangeDatabase } from './storage/database'
import { seedCoupleComicAssets } from './storage/builtinContent'
import { CreationRepository } from './storage/creationRepository'
import { SettingsRepository } from './storage/SettingsRepository'
import { AssetRepository } from './storage/assetRepository'
import { TemplateRepository } from './storage/templateRepository'
import { InspirationRepository } from './storage/inspirationRepository'
import { PublishRepository } from './storage/publishRepository'
import { TaskRepository } from './storage/taskRepository'
import { GraphicSessionRepository } from './storage/graphicSessionRepository'
import { AnalyticsRepository } from './storage/AnalyticsRepository'
import { ExportService } from './storage/exportService'
import { ImageGenService } from './imagegen/ImageGenService'
import { registerApiRoutes } from './api/routes'
import { sendWebResponse, toWebRequest } from './api/webServerAdapter'
import { generateText, generateTextDirect } from './textgen/textGenService'
import type { TextGenRequest } from './textgen/textGenService'
import type { LlmService } from './textgen/types'
import { startSse } from './textgen/sse'

export const name = 'paipiange'

/**
 * Declare the Harness services this plugin needs:
 * - `webServer`: registers the private `/api/paipiange.*` routes.
 * - `connection`: enforces the host's request/Origin checks on those routes.
 * - `llm`: consumes the user's configured text model for studio generation.
 */
export const inject = ['webServer', 'connection', 'llm']

export interface Config {
  /** Base data directory. The plugin creates a private `paipiange` folder inside it. */
  dataRoot?: string
  /** Absolute path to a PowerShell script that restarts the dsh desktop app. */
  restartScript?: string
}

/**
 * Default restart script path (developer machine). Used by the "restore backup"
 * flow to relaunch dsh so the restored database takes effect. Override via
 * `config.restartScript` when deploying to another machine.
 */
const DEFAULT_RESTART_SCRIPT = 'D:/code/zmt/工作台/scripts/restart-dsh.ps1'

/** The official Harness web-server route shape (`kind: 'exact'`). */
interface WebServerService {
  register: (route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => void
}

/** The official Harness connection trust-check surface. */
interface ConnectionService {
  requestRejection?: (request: IncomingMessage) => undefined | unknown
}

type HostContext = Context & { webServer?: WebServerService; connection?: ConnectionService; llm?: LlmService }

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

  // 幂等地把内置情侣漫画参考图写入素材库，并回填模板封面。
  // 失败不阻断插件启动（仅缺失内置参考图，不影响其他功能）。
  try {
    seedCoupleComicAssets(storage.db, assets)
  } catch {
    // 内置参考图 seed 失败属于非致命问题，忽略并继续启动。
  }

  const inspirations = new InspirationRepository(storage.db)
  const publish = new PublishRepository(storage.db)
  const exports = new ExportService(storage.paths)
  const tasks = new TaskRepository(storage.db)
  const graphicSessions = new GraphicSessionRepository(storage.db)
  const analytics = new AnalyticsRepository(storage.db)

  // The image-gen service is rebuilt on demand from the latest saved config so
  // a newly saved backend takes effect without a plugin restart.
  const buildImageGen = () =>
    new ImageGenService({
      llm: settings.getLlmImageConfig() ?? undefined,
      comfyui: settings.getComfyUiConfig() ?? undefined,
      backends: settings.listBackendsWithSecrets(),
    })

  // Trust gate: when the `connection` service exposes `requestRejection`, use it
  // to reject any request the host does not trust. When absent, fall back to the
  // host's own carrier-level checks (do not open a bare public route).
  //
  // NOTE: `requestRejection` is an instance method on the `HostConnectionService`
  // and reads `this.trustedHosts` / `this.browserAuth`. It MUST stay bound to the
  // service instance — detaching it (`const trust = host.connection.requestRejection`)
  // makes `this` undefined in strict ESM and throws a TypeError on every request,
  // which the webserver surfaces as an empty 400. Bind it here once.
  const trust = host.connection?.requestRejection?.bind(host.connection)

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

    // ---- Backups: create / list / download (private data safety net) ----

    // Create a consistent SQLite backup snapshot.
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.backup',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
              return
            }
          }
          if (req.method !== 'POST') {
            await sendWebResponse(res, Response.json({ error: '方法不允许' }, { status: 405 }))
            return
          }
          try {
            const backup = await storage.createBackup()
            const sizeBytes = statSync(backup.path).size
            await sendWebResponse(res, Response.json({ backup: { filename: backup.filename, sizeBytes } }))
          } catch (error) {
            await sendWebResponse(res, Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }))
          }
        },
      }),
    )

    // List existing backup snapshots (newest first).
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.backups',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
              return
            }
          }
          try {
            const files = readdirSync(storage.paths.backups)
              .filter((name) => name.endsWith('.sqlite'))
              .map((name) => {
                const full = join(storage.paths.backups, name)
                const stat = statSync(full)
                return { filename: name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() }
              })
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            await sendWebResponse(res, Response.json({ backups: files }))
          } catch (error) {
            await sendWebResponse(res, Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }))
          }
        },
      }),
    )

    // Download a backup snapshot by filename (sandboxed to the backups dir).
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.backup.download',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
              return
            }
          }
          const request = await toWebRequest(req)
          const filename = new URL(request.url).searchParams.get('filename') ?? ''
          // Guard against path traversal; only a bare basename is allowed.
          if (!filename || filename.includes('/') || filename.includes('\\') || !filename.endsWith('.sqlite')) {
            await sendWebResponse(res, Response.json({ error: '无效的文件名' }, { status: 400 }))
            return
          }
          try {
            const full = join(storage.paths.backups, filename)
            const buffer = readFileSync(full)
            await sendWebResponse(
              res,
              new Response(new Uint8Array(buffer), {
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
                  'Cache-Control': 'no-store',
                },
              }),
            )
          } catch {
            await sendWebResponse(res, Response.json({ error: '备份不存在' }, { status: 404 }))
          }
        },
      }),
    )

    // Restore a backup snapshot over the live database (replaces current data).
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.backup.restore',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
              return
            }
          }
          if (req.method !== 'POST') {
            await sendWebResponse(res, Response.json({ error: '方法不允许' }, { status: 405 }))
            return
          }
          try {
            const request = await toWebRequest(req)
            const body = await request.json().catch(() => null) as { filename?: string } | null
            const result = await storage.restoreBackup(body?.filename?.trim() ?? '')
            await sendWebResponse(res, Response.json({ ok: true, ...result }))
          } catch (error) {
            await sendWebResponse(res, Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }))
          }
        },
      }),
    )

    // Restart the dsh desktop app (used after a backup restore so the restored
    // database takes effect). Spawns a detached PowerShell that tears down the
    // browser process and relaunches via the desktop shortcut.
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.app.restart',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
              return
            }
          }
          if (req.method !== 'POST') {
            await sendWebResponse(res, Response.json({ error: '方法不允许' }, { status: 405 }))
            return
          }
          const script = config.restartScript ?? DEFAULT_RESTART_SCRIPT
          if (!existsSync(script)) {
            await sendWebResponse(res, Response.json({ error: `重启脚本不存在：${script}` }, { status: 500 }))
            return
          }
          await sendWebResponse(res, Response.json({ ok: true }))
          // Defer so the response flushes before the process is torn down.
          setTimeout(() => {
            const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            })
            child.unref()
          }, 300)
        },
      }),
    )

    // Text-gen provider discovery: list the routes the Harness `llm` service has
    // registered so the client can offer a picker instead of a free-text field.
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.textgen.providers',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
              return
            }
          }
          const llm = host.llm
          if (!llm || typeof llm.listProviders !== 'function') {
            await sendWebResponse(res, Response.json({ providers: [], models: {} }))
            return
          }
          const providers = llm.listProviders().map((p) => p.provider)
          // Best-effort model discovery per provider; ignore failures so a
          // provider with a slow catalog does not block the picker.
          const models: Record<string, string[]> = {}
          if (typeof llm.listModels === 'function') {
            await Promise.all(
              providers.map(async (provider) => {
                try {
                  models[provider] = (await llm.listModels!(provider)).map((m) => m.id)
                } catch {
                  models[provider] = []
                }
              }),
            )
          }
          await sendWebResponse(res, Response.json({ providers, models }))
        },
      }),
    )

    // Text generation: consume the Harness `llm` service and stream deltas back
    // over SSE. This route is registered separately because it does not return a
    // single buffered Response — it owns the response for the stream's lifetime.
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.textgen.generate',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
              return
            }
          }
          if (req.method !== 'POST') {
            await sendWebResponse(res, Response.json({ error: '方法不允许' }, { status: 405 }))
            return
          }
          const send = startSse(res)
          let task: ReturnType<TaskRepository['start']> | null = null
          try {
            const request = await toWebRequest(req)
            const body = await request.json().catch(() => null) as (TextGenRequest & { baseUrl?: string; apiKey?: string; backendId?: string }) | null
            if (!body || !body.topic) {
              send('error', { message: '缺少 topic' })
              send('done', '')
              return
            }

            // Record this generation attempt (success or failure) for later review.
            task = tasks.start({
              kind: 'text',
              modelId: body.model?.trim() || null,
              input: {
                studio: body.studio,
                topic: body.topic,
                style: body.style,
                requirement: body.requirement,
                provider: body.provider,
                model: body.model,
                backendId: body.backendId,
                direct: !!(body.baseUrl?.trim()),
              },
            })

            // Resolve the full backend config (with secrets) when the client
            // references a saved text backend by id. This keeps apiKey host-side.
            let directBaseUrl = body.baseUrl?.trim().replace(/\/+$/, '') || ''
            let directApiKey = body.apiKey?.trim() ?? ''
            let directModel = body.model?.trim() ?? ''
            if (body.backendId) {
              const backend = settings.listBackendsWithSecrets().find((b) => b.id === body.backendId)
              if (backend?.kind === 'llm-text' && backend.text) {
                directBaseUrl = backend.text.baseUrl?.trim().replace(/\/+$/, '') || ''
                directApiKey = backend.text.apiKey ?? ''
                // Prefer the client-chosen model; fall back to the backend default.
                if (!directModel) directModel = backend.text.model
              }
            }

            // Direct mode: a third-party OpenAI-compatible endpoint was supplied
            // (via a custom text backend). Bypass the Harness `llm` service.
            if (directBaseUrl) {
              if (!directModel) {
                send('error', { message: '直连文字后端缺少模型名' })
                send('done', '')
                return
              }
              const result = await generateTextDirect(
                { baseUrl: directBaseUrl, apiKey: directApiKey, model: directModel },
                body,
                {
                  signal: request.signal,
                  onDelta: (delta) => send('delta', delta),
                },
              )
              tasks.markSuccess(task!.id, {
                text: result.text,
                usage: result.usage,
                finishReason: result.finishReason,
              }, directModel)
              send('usage', result.usage)
              send('finish', { reason: result.finishReason })
              send('done', '')
              return
            }

            const llm = host.llm
            if (!llm || typeof llm.prepareCall !== 'function') {
              send('error', { message: 'Harness 文本模型服务未就绪，请先在 Harness 中配置模型' })
              send('done', '')
              return
            }
            // Fall back to the saved text-gen config when the client omits them.
            const defaults = settings.getTextGenConfig()
            let provider = body.provider?.trim() || ''
            let model = directModel
            // If no explicit provider, prefer a saved one that still exists; if the
            // saved default is stale (e.g. `deepseek-official` with no such route),
            // fall back to the first registered route so generation can still run.
            if (!provider) provider = defaults.provider
            if (typeof llm.listProviders === 'function') {
              const available = llm.listProviders().map((p) => p.provider)
              if (!available.includes(provider)) {
                provider = available[0] ?? provider
                model = ''
              }
            }
            if (!model) model = defaults.model
            if (!provider) {
              send('error', { message: 'Harness 尚未配置任何可用的文本模型 Provider' })
              send('done', '')
              return
            }
            const resolved: TextGenRequest = {
              ...body,
              provider,
              model,
            }
            const result = await generateText(llm, resolved, {
              signal: request.signal,
              onDelta: (delta) => send('delta', delta),
            })
            tasks.markSuccess(task!.id, {
              text: result.text,
              usage: result.usage,
              finishReason: result.finishReason,
            }, model)
            send('usage', result.usage)
            send('finish', { reason: result.finishReason })
            send('done', '')
          } catch (error) {
            // Record the failure, then forward the message to the client.
            const message = error instanceof Error ? error.message : String(error)
            if (task) {
              try {
                tasks.markFailed(task.id, 'textgen', message)
              } catch {
                // task recording must never break the stream
              }
            }
            // Some errors arrive after headers are already flushed; guard the
            // write and fall back to closing the stream.
            try {
              send('error', { message })
              send('done', '')
            } catch {
              res.end()
            }
          }
        },
      }),
    )

    // ---- Video generation (local: LLM → HTML → headless render → FFmpeg) ----
    // Streams progress over SSE and saves the finished MP4 as a host asset.
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: '/api/paipiange.video.generate',
        async handler(req, res) {
          if (trust) {
            const rejection = trust(req)
            if (rejection !== undefined) {
              await sendWebResponse(res, Response.json({ error: '未授权' }, { status: 401 }))
              return
            }
          }
          if (req.method !== 'POST') {
            await sendWebResponse(res, Response.json({ error: '方法不允许' }, { status: 405 }))
            return
          }
          const send = startSse(res)
          const request = await toWebRequest(req)
          const body = await request.json().catch(() => null) as {
            topic?: string
            subtitle?: string
            style?: string
            aspectRatio?: '16:9' | '9:16' | '1:1'
            durationSec?: number
            fps?: number
            provider?: string
            model?: string
            backendId?: string
            engine?: 'llm' | 'comfyui'
            baseUrl?: string
            apiKey?: string
            sourceCreationId?: string
          } | null
          if (!body || !body.topic?.trim()) {
            send('error', { message: '缺少主题文案 topic' })
            send('done', '')
            return
          }

          let task: ReturnType<TaskRepository['start']> | null = null
          try {
            const engine: 'llm' | 'comfyui' = body.engine === 'comfyui' ? 'comfyui' : 'llm'

            // Resolve the ComfyUI backend config when engine=comfyui.
            let comfyuiConfig: { server: string; checkpoint?: string; unet?: string; clip?: string; vae?: string } | undefined
            if (engine === 'comfyui') {
              const backend = settings.listBackendsWithSecrets().find((b) => b.kind === 'comfyui' && (!body.backendId || b.id === body.backendId))
              if (backend?.comfyui?.server) {
                comfyuiConfig = backend.comfyui
              } else if (settings.getComfyUiConfig()) {
                comfyuiConfig = settings.getComfyUiConfig() ?? undefined
              }
              if (!comfyuiConfig?.server) {
                send('error', { message: '未找到已配置的 ComfyUI 后端，请先在设置中心添加 ComfyUI' })
                send('done', '')
                return
              }
            }

            const llm = host.llm
            if (engine === 'llm' && (!llm || typeof llm.prepareCall !== 'function')) {
              send('error', { message: 'Harness 文本模型服务未就绪，请先在 Harness 中配置模型' })
              send('done', '')
              return
            }

            task = tasks.start({
              kind: 'video',
              creationId: body.sourceCreationId ?? null,
              modelId: body.model?.trim() || null,
              input: {
                topic: body.topic.trim(),
                subtitle: body.subtitle?.trim() ?? '',
                style: body.style?.trim() ?? '',
                aspectRatio: body.aspectRatio ?? '16:9',
                durationSec: body.durationSec ?? 5,
                fps: body.fps ?? 24,
                provider: body.provider ?? '',
                model: body.model ?? '',
              },
            })

            // Resolve provider/model: prefer saved text-gen config when omitted.
            const defaults = settings.getTextGenConfig()
            let provider = body.provider?.trim() || defaults.provider
            let model = body.model?.trim() || defaults.model
            if (engine === 'llm' && llm && typeof llm.listProviders === 'function') {
              const available = llm.listProviders().map((p) => p.provider)
              if (!available.includes(provider)) {
                provider = available[0] ?? provider
                model = ''
              }
            }
            if (engine === 'llm' && !provider) {
              send('error', { message: 'Harness 尚未配置任何可用的文本模型 Provider' })
              send('done', '')
              return
            }

            const { generateVideo } = await import('./videogen/videoGenService')
            const result = await generateVideo(
              llm,
              {
                topic: body.topic.trim(),
                subtitle: body.subtitle?.trim(),
                style: body.style?.trim(),
                aspectRatio: body.aspectRatio,
                durationSec: body.durationSec,
                fps: body.fps,
                provider,
                model,
                engine,
                comfyui: comfyuiConfig,
              },
              {
                signal: request.signal,
                onProgress: (p) => {
                  switch (p.stage) {
                    case 'coding':
                      send('progress', { stage: 'coding', message: p.message })
                      break
                    case 'repair':
                      send('progress', { stage: 'repair', round: p.round, message: p.message })
                      break
                    case 'render':
                      send('progress', { stage: 'render', frame: p.frame, total: p.total })
                      break
                    case 'comfy':
                      send('progress', { stage: 'comfy', frame: p.frame, total: p.total })
                      break
                    case 'encode':
                      send('progress', { stage: 'encode', message: p.message })
                      break
                    case 'done':
                      send('progress', { stage: 'done', message: p.message })
                      break
                  }
                },
              },
            )

            // Persist the MP4 as a host asset so the client can reference/download it.
            const asset = assets.save({
              kind: 'file',
              name: `video-${Date.now()}.mp4`,
              mimeType: 'video/mp4',
              data: result.mp4,
              width: result.width,
              height: result.height,
              sourceCreationId: body.sourceCreationId ?? null,
            })

            tasks.markSuccess(
              task.id,
              {
                assetId: asset.id,
                width: result.width,
                height: result.height,
                fps: result.fps,
                totalFrames: result.totalFrames,
                usedFallback: result.usedFallback,
                rounds: result.rounds,
              },
              model,
            )
            send('result', { assetId: asset.id, width: result.width, height: result.height, fps: result.fps, usedFallback: result.usedFallback })
            send('done', '')
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (task) {
              try {
                tasks.markFailed(task.id, 'videogen', message)
              } catch {
                // recording must not mask the real error
              }
            }
            send('error', { message })
            send('done', '')
          }
        },
      }),
    )

    registerApiRoutes(
      { creations, settings, assets, templates, inspirations, publish, exports, tasks, graphicSessions, analytics, buildImageGen, llm: host.llm },
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
