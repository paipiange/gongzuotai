import type { Context } from '@deepseek-ai/cordis'
import { PaipiangeDatabase } from './storage/database'

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
 * Initializes private Host storage and registers a health route so the client
 * (and the plugin manager) can confirm the host half is loaded. Storage and
 * image-gen routes are exposed only through Harness's connection service;
 * no unauthenticated data is ever served.
 */
export async function apply(ctx: Context, config: Config = {}) {
  const storage = await PaipiangeDatabase.open({ dataRoot: config.dataRoot })
  const connection = (ctx as Context & { connection: ConnectionService }).connection

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
  } catch (error) {
    storage.close()
    throw error
  }

  ctx.effect(() => () => storage.close(), 'paipiange.sqlite')
}
