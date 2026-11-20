export type TaskOriginKind = 'studio' | 'template' | 'graphic'

export interface TaskOrigin {
  kind: TaskOriginKind
  id: string
  label?: string
  state?: Record<string, unknown>
}

const SENSITIVE_KEY = /(?:api.?key|token|cookie|password|secret|authorization)/i
const DATA_URL = /^data:/i

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === undefined) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    if (DATA_URL.test(value)) return undefined
    return value.slice(0, 10_000)
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined)
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      if (SENSITIVE_KEY.test(key)) continue
      const sanitized = sanitizeValue(item, depth + 1)
      if (sanitized !== undefined) out[key] = sanitized
    }
    return out
  }
  return undefined
}

/** Validate and redact the client-provided resume metadata before persisting it in task logs. */
export function normalizeTaskOrigin(value: unknown): TaskOrigin | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.kind !== 'studio' && raw.kind !== 'template' && raw.kind !== 'graphic') return undefined
  if (typeof raw.id !== 'string' || !raw.id.trim()) return undefined
  const state = sanitizeValue(raw.state)
  return {
    kind: raw.kind,
    id: raw.id.trim().slice(0, 120),
    ...(typeof raw.label === 'string' && raw.label.trim() ? { label: raw.label.trim().slice(0, 200) } : {}),
    ...(state && typeof state === 'object' && !Array.isArray(state) ? { state: state as Record<string, unknown> } : {}),
  }
}
