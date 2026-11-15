import type { Context } from '@deepseek-ai/cordis'

export const name = 'paipiange'

/**
 * Phase 1 host entry. UI mounting is implemented by the client bundle.
 * Authenticated storage and model routes will be added in later phases.
 */
export function apply(_ctx: Context) {
  // Intentionally empty: do not expose unauthenticated placeholder routes.
}
