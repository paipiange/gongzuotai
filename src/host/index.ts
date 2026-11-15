import type { Context } from '@deepseek-ai/cordis'
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

export const name = 'paipiange'

/** Declare the Harness connection service for exposing Host routes to the client. */
export const inject = ['connection']

export interface Config {
  /** Base data directory. The plugin creates a private `paipiange` folder inside it. */
  dataRoot?: string
}

interface ConnectionService {
  fetch: {
    register: (route: {
      path: string
      methods: string[]
      requestBody?: 'buffered'
      fetch: (request: Request) => Promise<Response> | Response
    }) => void
  }
}

/**
 * Initializes private Host storage and registers the full API surface (health,
 * creations CRUD, image-gen config/generate, asset retrieval) through
 * Harness's connection service. No unauthenticated data is ever served.
 */
export async function apply(ctx: Context, config: Config = {}) {
  const storage = await PaipiangeDatabase.open({ dataRoot: config.dataRoot })
  const connection = (ctx as Context & { connection: ConnectionService }).connection

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

  try {
    connection.fetch.register({
      path: '/api/paipiange.health',
      methods: ['GET'],
      async fetch() {
        return Response.json(
          { ok: true, schema: 'v1', database: storage.paths.database },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      },
    })

    registerApiRoutes(
      { creations, settings, assets, templates, inspirations, publish, exports, buildImageGen },
      connection.fetch.register.bind(connection.fetch),
    )
  } catch (error) {
    storage.close()
    throw error
  }

  ctx.effect(() => () => storage.close(), 'paipiange.sqlite')
}
