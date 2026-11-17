/**
 * Host-side HTTP API — orchestration entry point.
 *
 * Every route is registered as an *exact* route on the official Harness
 * `webServer` service (path parameters are NOT supported — ids travel as query
 * parameters). Handlers are written against the Web Fetch API (`Request`/
 * `Response`); the caller supplies a bridge that adapts them to the host's
 * Node request/response pair.
 *
 * Route handlers are grouped by domain in `routes/`:
 *   creations.ts   — creation records CRUD / status / cover / batch
 *   generation.ts  — image-gen, text-gen config, tasks, analytics, backends
 *   assets.ts      — asset binary/metadata, upload, delete, storage cleanup
 *   content.ts     — templates, inspirations, storyboard, publish, export
 *   graphic.ts     — graphic studio session persistence + ZIP export
 *   shared.ts      — ApiDeps / RegisterRoute types and shared helpers
 */

import { registerAssetRoutes } from './routes/assets'
import { registerContentRoutes } from './routes/content'
import { registerCreationRoutes } from './routes/creations'
import { registerGenerationRoutes } from './routes/generation'
import { registerGraphicRoutes } from './routes/graphic'
import type { ApiDeps, RegisterRoute } from './routes/shared'

export type { ApiDeps, RegisterRoute } from './routes/shared'

export function registerApiRoutes(deps: ApiDeps, register: RegisterRoute) {
  registerCreationRoutes(deps, register)
  registerGenerationRoutes(deps, register)
  registerAssetRoutes(deps, register)
  registerContentRoutes(deps, register)
  registerGraphicRoutes(deps, register)
}
