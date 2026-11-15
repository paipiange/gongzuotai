import type { Context } from '@deepseek-ai/cordis'
import { PaipiangeDatabase } from './storage/database'

export const name = 'paipiange'

export interface Config {
  /** Base data directory. The plugin creates a private `paipiange` folder inside it. */
  dataRoot?: string
}

/**
 * Initializes private Host storage without exposing any unauthenticated routes.
 * HTTP and model adapters remain disabled until the Harness connection contract is verified.
 */
export async function apply(ctx: Context, config: Config = {}) {
  const storage = await PaipiangeDatabase.open({ dataRoot: config.dataRoot })
  try {
    ctx.effect(() => () => storage.close(), 'paipiange.sqlite')
  } catch (error) {
    storage.close()
    throw error
  }
}
