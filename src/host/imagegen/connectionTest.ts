/**
 * Backend connection probe. Verifies a ComfyUI or LLM image backend is
 * reachable without actually generating an image, so the settings page can
 * offer a "test connection" button.
 */

export interface ConnectionTestInput {
  kind?: string
  llm?: { baseUrl: string; apiKey: string; model: string }
  comfyui?: { server: string }
}

export interface ConnectionTestResult {
  ok: boolean
  kind: string
  message: string
  latencyMs?: number
}

/** Probe a ComfyUI server via `/system_stats` (cheap, no GPU work). */
async function testComfyUI(server: string): Promise<ConnectionTestResult> {
  const base = server.trim().replace(/\/+$/, '')
  if (!base) return { ok: false, kind: 'comfyui', message: '未填写 ComfyUI 服务地址' }
  const started = Date.now()
  try {
    const response = await fetch(`${base}/system_stats`, {
      signal: AbortSignal.timeout(8000),
    })
    const latencyMs = Date.now() - started
    if (!response.ok) {
      return { ok: false, kind: 'comfyui', message: `ComfyUI 返回 ${response.status}，请确认服务已启动`, latencyMs }
    }
    const body = (await response.json().catch(() => null)) as { system?: unknown } | null
    if (!body || body.system === undefined) {
      return { ok: false, kind: 'comfyui', message: '已连接但响应格式异常（非标准 ComfyUI）', latencyMs }
    }
    return { ok: true, kind: 'comfyui', message: 'ComfyUI 连接正常', latencyMs }
  } catch (cause) {
    const latencyMs = Date.now() - started
    const message = cause instanceof Error && cause.name === 'TimeoutError'
      ? '连接超时'
      : `无法连接：${cause instanceof Error ? cause.message : String(cause)}`
    return { ok: false, kind: 'comfyui', message, latencyMs }
  }
}

/** Probe an OpenAI-compatible images API with a minimal models/endpoint ping. */
async function testLlmImage(config: { baseUrl: string; apiKey: string; model: string }): Promise<ConnectionTestResult> {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  if (!base) return { ok: false, kind: 'llm-image', message: '未填写 Base URL' }
  const started = Date.now()
  try {
    // A bare GET on the base URL is enough to confirm the endpoint is reachable
    // and credentialed (many gateways return 401 without a key, 404/200 with).
    const response = await fetch(base, {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(8000),
    })
    const latencyMs = Date.now() - started
    if (response.status === 401 || response.status === 403) {
      return { ok: false, kind: 'llm-image', message: `认证失败（HTTP ${response.status}），请检查 API Key`, latencyMs }
    }
    // 2xx or 404 both mean the host is reachable and routed correctly.
    return { ok: true, kind: 'llm-image', message: `图片 API 可达（HTTP ${response.status}）`, latencyMs }
  } catch (cause) {
    const latencyMs = Date.now() - started
    const message = cause instanceof Error && cause.name === 'TimeoutError'
      ? '连接超时'
      : `无法连接：${cause instanceof Error ? cause.message : String(cause)}`
    return { ok: false, kind: 'llm-image', message, latencyMs }
  }
}

/**
 * Entry point for the `/api/paipiange.backend.test` route. Dispatches on the
 * `kind` field (comfyui vs llm) and returns a structured result.
 */
export default async function testBackendConnection(input: ConnectionTestInput): Promise<ConnectionTestResult> {
  if (input.kind === 'comfyui' && input.comfyui) {
    return testComfyUI(input.comfyui.server)
  }
  if (input.kind === 'llm-image' && input.llm) {
    return testLlmImage(input.llm)
  }
  return { ok: false, kind: input.kind ?? 'unknown', message: '不支持的连接测试类型' }
}
