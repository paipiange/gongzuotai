/**
 * Client-side bridge to the Host half's REST API. The Host exposes exact fetch
 * routes under `/api/paipiange.*`; the browser page is same-origin with the
 * Host (loopback in desktop), so a relative `fetch()` reaches them directly.
 *
 * Every call is defensive: on network failure or a non-2xx response it throws
 * a typed `HostError` so callers can decide whether to fall back to local
 * storage or surface a clear message — never fabricate a success.
 *
 * This file is a barrel: the actual implementations live in ./hostClient/*,
 * grouped by domain. Re-exporting here keeps every existing `./hostClient`
 * import path working unchanged.
 */

export * from './hostClient/types'
export * from './hostClient/creations'
export * from './hostClient/imagegen'
export * from './hostClient/textgen'
export * from './hostClient/library'
export * from './hostClient/graphic'
export * from './hostClient/export'
export { HostError } from './hostClient/client'
