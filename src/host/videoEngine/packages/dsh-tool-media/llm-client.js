import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadEnv, resolveEnvPath } from '../shared/index.js'

/**
 * Node built-in http/https POST helper used when `timeoutMs > 240_000` so long-running
 * reasoning LLM calls (up to 10 minutes) bypass Node undici's default 300s `headersTimeout`.
 */
function postJsonLongTimeout(endpoint, headers, bodyStr, timeoutMs, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    const parsedUrl = new URL(endpoint)
    const mod = parsedUrl.protocol === 'http:' ? http : https
    const bodyBuf = Buffer.from(bodyStr, 'utf8')
    let settled = false
    const done = (fn, val) => {
      if (settled) return
      settled = true
      try { signal?.removeEventListener('abort', onAbort) } catch {}
      fn(val)
    }
    const req = mod.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(bodyBuf.byteLength),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode || 0
          done(resolvePromise, {
            ok: status >= 200 && status < 300,
            status,
            text: async () => text,
          })
        })
        res.on('error', (err) => done(rejectPromise, err))
      },
    )
    const onAbort = () => {
      try { req.destroy(signal?.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' })) } catch {}
      done(rejectPromise, signal?.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
    }
    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    req.setTimeout(timeoutMs, () => {
      const err = new Error(`LLM 请求超时 (${Math.round(timeoutMs / 1000)}s)`)
      try { req.destroy(err) } catch {}
      done(rejectPromise, err)
    })
    req.on('error', (err) => done(rejectPromise, err))
    req.end(bodyBuf)
  })
}

export const WIRE_PROTOCOLS = [
  {
    id: 'openai-completions',
    label: 'OpenAI 兼容 Chat · /v1/chat/completions',
    shortLabel: 'OpenAI Chat (/v1/chat/completions)',
  },
  {
    id: 'anthropic-messages',
    label: 'Anthropic Messages · /v1/messages',
    shortLabel: 'Anthropic Messages (/v1/messages)',
  },
  {
    id: 'openai-responses',
    label: 'OpenAI Responses · /v1/responses',
    shortLabel: 'OpenAI Responses (/v1/responses)',
  },
  {
    id: 'gemini-native',
    label: 'Gemini 原生 · /v1beta/models',
    shortLabel: 'Gemini 原生 (/v1beta/models)',
  },
]

export const LLM_PROVIDER_TEMPLATES = {
  custom: {
    id: 'custom',
    label: '自由定制接口 (支持全部 4 种协议)',
    defaultFormat: 'auto',
    defaultBaseUrl: '',
    suggestedModels: [],
    requiresKey: true,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude (Messages 原生)',
    defaultFormat: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    suggestedModels: ['claude-opus-5-5', 'claude-opus-4-6', 'claude-sonnet-4-6'],
    requiresKey: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI GPT (Chat / Responses)',
    defaultFormat: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    suggestedModels: ['gpt-6.1-sol', 'gpt-5', 'gpt-4o'],
    requiresKey: true,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini (原生 /v1beta/models)',
    defaultFormat: 'gemini-native',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    requiresKey: true,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek 官方接口',
    defaultFormat: 'openai-completions',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    requiresKey: true,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter 多模型聚合网关',
    defaultFormat: 'openai-completions',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    suggestedModels: ['anthropic/claude-opus-4', 'openai/gpt-5', 'google/gemini-2.5-pro'],
    requiresKey: true,
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama / 本地大模型服务',
    defaultFormat: 'openai-completions',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    suggestedModels: ['qwen2.5-coder:32b', 'deepseek-r1:32b'],
    requiresKey: false,
  },
}

const VALID_FORMATS = new Set([
  'auto',
  'openai-completions',
  'anthropic-messages',
  'openai-responses',
  'gemini-native',
  'openai',
  'anthropic',
  'gemini',
])

export function normalizeProtocolFormat(rawFormat) {
  const f = String(rawFormat || 'auto').trim().toLowerCase()
  if (f === 'openai') return 'openai-completions'
  if (f === 'anthropic') return 'anthropic-messages'
  if (f === 'gemini') return 'gemini-native'
  if (
    f === 'openai-completions' ||
    f === 'anthropic-messages' ||
    f === 'openai-responses' ||
    f === 'gemini-native'
  ) {
    return f
  }
  return 'auto'
}

export function getLlmConfigPath() {
  loadEnv()
  const homeDir = resolveEnvPath('DSH_VIDEO_HOME', './.dsh-home')
  return join(homeDir, 'llm-config.json')
}

export function maskSecretKey(rawKey) {
  const key = String(rawKey || '').trim()
  if (!key) return ''
  if (key.length <= 8) return '*'.repeat(key.length)
  return `${key.slice(0, 6)}${'*'.repeat(Math.min(12, key.length - 10))}${key.slice(-4)}`
}

function stripYamlScalar(raw) {
  let s = String(raw || '').trim()
  if (!s) return ''
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  const commentIdx = s.indexOf(' #')
  if (commentIdx > 0) s = s.slice(0, commentIdx).trim()
  return s
}

function parseCredentialsRefs(credPath) {
  const refs = {}
  if (!existsSync(credPath)) return refs
  try {
    const lines = readFileSync(credPath, 'utf8').split(/\r?\n/)
    let inRefs = false
    for (const line of lines) {
      if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue
      if (/^refs:\s*$/.test(line)) {
        inRefs = true
        continue
      }
      if (/^[^\s]/.test(line)) {
        inRefs = false
        continue
      }
      if (inRefs) {
        const m = /^  ([A-Za-z0-9_.:-]+):\s*(.+?)\s*$/.exec(line)
        if (m) {
          const val = stripYamlScalar(m[2])
          if (val && !val.startsWith('!')) refs[m[1]] = val
        }
      }
    }
  } catch {}
  return refs
}

function parseProvidersFromCordisPatch(patchPath) {
  const providers = []
  if (!existsSync(patchPath)) return providers
  try {
    const lines = readFileSync(patchPath, 'utf8').split(/\r?\n/)
    let topId = ''
    let inPiProviders = false
    let curProvider = null
    let inProviderModels = false
    let deepseekProvider = null
    let inDeepseekModels = false

    const flushCur = () => {
      if (curProvider && curProvider.id) {
        providers.push(curProvider)
      }
      curProvider = null
      inProviderModels = false
    }

    for (const rawLine of lines) {
      if (/^\s*$/.test(rawLine) || /^\s*#/.test(rawLine)) continue

      // Top-level list entry `- id: xxx` or `- insert:`
      const topMatch = /^- (id:\s*(.+)|insert:\s*)$/.exec(rawLine)
      if (topMatch) {
        flushCur()
        if (deepseekProvider) {
          providers.push(deepseekProvider)
          deepseekProvider = null
        }
        inPiProviders = false
        inDeepseekModels = false
        topId = topMatch[2] ? stripYamlScalar(topMatch[2]) : ''
        continue
      }

      if (topId === 'llm-pi-ai') {
        if (/^    providers:\s*$/.test(rawLine)) {
          inPiProviders = true
          continue
        }
        if (inPiProviders && /^  [a-zA-Z]/.test(rawLine)) {
          flushCur()
          inPiProviders = false
          continue
        }
        if (inPiProviders) {
          const provMatch = /^      ([a-zA-Z0-9_-]+):\s*$/.exec(rawLine)
          if (provMatch) {
            flushCur()
            curProvider = {
              id: provMatch[1],
              displayName: provMatch[1],
              apiKeyEnv: '',
              api: 'openai-completions',
              baseURL: '',
              models: [],
            }
            continue
          }
          if (curProvider) {
            if (/^        models:\s*$/.test(rawLine)) {
              inProviderModels = true
              continue
            }
            const kv = /^        ([a-zA-Z0-9_]+):\s*(.+?)\s*$/.exec(rawLine)
            if (kv) {
              inProviderModels = false
              const [, k, vRaw] = kv
              const v = stripYamlScalar(vRaw)
              if (k === 'displayName') curProvider.displayName = v
              else if (k === 'apiKeyEnv') curProvider.apiKeyEnv = v
              else if (k === 'api') curProvider.api = normalizeProtocolFormat(v)
              else if (k === 'baseURL') curProvider.baseURL = v.replace(/\/+$/, '')
              continue
            }
            if (inProviderModels) {
              const idMatch = /^          - id:\s*(.+?)\s*$/.exec(rawLine)
              if (idMatch) {
                curProvider.models.push({ id: stripYamlScalar(idMatch[1]), name: stripYamlScalar(idMatch[1]) })
                continue
              }
              const lastModel = curProvider.models[curProvider.models.length - 1]
              if (lastModel) {
                const nameMatch = /^            name:\s*(.+?)\s*$/.exec(rawLine)
                if (nameMatch) lastModel.name = stripYamlScalar(nameMatch[1])
                const tokMatch = /^            maxTokens:\s*(\d+)\s*$/.exec(rawLine)
                if (tokMatch) lastModel.maxTokens = Number(tokMatch[1])
              }
            }
          }
        }
      } else if (topId === 'llm-deepseek') {
        if (!deepseekProvider) {
          deepseekProvider = {
            id: 'llm-deepseek',
            displayName: 'DSH DeepSeek 默认',
            apiKeyEnv: 'DEEPSEEK_API_KEY',
            api: 'openai-completions',
            baseURL: 'https://api.deepseek.com/v1',
            models: [],
          }
        }
        if (/^    models:\s*$/.test(rawLine)) {
          inDeepseekModels = true
          continue
        }
        const dsBase = /^    baseURL:\s*(.+?)\s*$/.exec(rawLine)
        if (dsBase) {
          inDeepseekModels = false
          deepseekProvider.baseURL = stripYamlScalar(dsBase[1]).replace(/\/+$/, '')
          continue
        }
        if (inDeepseekModels) {
          const dm = /^      - id:\s*(.+?)\s*$/.exec(rawLine)
          if (dm) {
            deepseekProvider.models.push({ id: stripYamlScalar(dm[1]), name: stripYamlScalar(dm[1]) })
            continue
          }
          const lastM = deepseekProvider.models[deepseekProvider.models.length - 1]
          if (lastM) {
            const nm = /^        name:\s*(.+?)\s*$/.exec(rawLine)
            if (nm) lastM.name = stripYamlScalar(nm[1])
          }
        }
      }
    }
    flushCur()
    if (deepseekProvider) providers.push(deepseekProvider)
  } catch {}
  return providers
}

function readLatestDshActiveSelection(dshHome) {
  const sessDir = join(dshHome, 'storages', 'session_projcache', 'sessions')
  if (!existsSync(sessDir)) return { provider: '', model: '' }
  try {
    const latest = readdirSync(sessDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, mt: statSync(join(sessDir, f)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt)
    for (const item of latest.slice(0, 6)) {
      const parsed = JSON.parse(readFileSync(join(sessDir, item.f), 'utf8'))
      const sel = parsed?.record?.rows?.modelSelection?.val
      const picked = sel?.pending || sel?.lastUsed
      if (picked && (picked.provider || picked.model)) {
        return {
          provider: String(picked.provider || '').trim(),
          model: String(picked.model || '').trim(),
        }
      }
    }
  } catch {}
  return { provider: '', model: '' }
}

function loadDshClientDiscoveryInternal(dshHomeOverride = '') {
  loadEnv()
  const dshHome =
    dshHomeOverride ||
    process.env.DSH_CLIENT_HOME ||
    process.env.DSH_HOME ||
    join(homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE || 'desktop'
  const patchPath = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
  const credPath = join(dshHome, '.credentials.yaml')

  const refs = parseCredentialsRefs(credPath)
  const rawProviders = parseProvidersFromCordisPatch(patchPath)
  const activeSelection = readLatestDshActiveSelection(dshHome)

  const providers = rawProviders.map((p) => {
    const resolvedKey =
      (p.apiKeyEnv && (process.env[p.apiKeyEnv] || refs[p.apiKeyEnv])) || ''
    return {
      ...p,
      hasApiKey: Boolean(resolvedKey),
      maskedApiKey: maskSecretKey(resolvedKey),
      _secretKey: resolvedKey,
    }
  })

  // Match active DSH client selection -> specific provider, else fallback to first keyed provider
  let defaultProvider =
    providers.find((p) => p.id === activeSelection.provider && p.hasApiKey) ||
    providers.find((p) => p.id === activeSelection.provider) ||
    providers.find((p) => p.hasApiKey && p.models.length > 0) ||
    providers[0] ||
    null

  let defaultModel = ''
  if (defaultProvider) {
    if (
      activeSelection.model &&
      activeSelection.provider === defaultProvider.id
    ) {
      defaultModel = activeSelection.model
    } else if (defaultProvider.models.length > 0) {
      defaultModel = defaultProvider.models[0].id
    }
  }

  return {
    available: providers.length > 0,
    dshHome,
    profile,
    activeSelection,
    defaultProvider,
    defaultModel,
    providers,
  }
}

/**
 * Public safe view of discovered DSH client providers & active model (ALL API keys stripped).
 */
export function discoverDshClientConfig(dshHomeOverride = '') {
  const d = loadDshClientDiscoveryInternal(dshHomeOverride)
  return {
    available: d.available,
    profile: d.profile,
    activeSelection: d.activeSelection,
    defaultProviderId: d.defaultProvider?.id || '',
    defaultProviderName: d.defaultProvider?.displayName || '',
    defaultModelId: d.defaultModel || '',
    defaultProtocol: d.defaultProvider?.api || 'openai-completions',
    providers: d.providers.map(({ _secretKey, ...rest }) => rest),
  }
}

function readStoredConfigFile() {
  const cfgPath = getLlmConfigPath()
  if (!existsSync(cfgPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(cfgPath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Resolve effective LLM configuration:
 * - Defaults to `mode: 'follow-dsh'` (automatically tracking active DSH client model/gateway/protocol/key)
 * - Supports switching to any DSH provider/model OR configuring an independent custom provider/model/protocol
 * - Allows per-call explicit overrides (e.g. from test suites or one-off calls)
 */
export function resolveLlmConfig(override = {}) {
  loadEnv()
  const fileCfg = readStoredConfigFile()
  const hasExplicitUrlOrKeyOverride =
    override.baseUrl !== undefined || override.apiKey !== undefined
  const envForcesCustom = Boolean(process.env.LLM_BASE_URL || process.env.LLM_MODEL)

  let mode = String(
    override.mode ??
      (hasExplicitUrlOrKeyOverride ? 'custom' : undefined) ??
      fileCfg.mode ??
      process.env.LLM_MODE ??
      (envForcesCustom ? 'custom' : 'follow-dsh'),
  )
    .trim()
    .toLowerCase()

  if (mode !== 'custom' && mode !== 'follow-dsh') {
    mode = 'follow-dsh'
  }

  const maxRepairRounds = Math.max(
    1,
    Math.min(
      5,
      Number(override.maxRepairRounds ?? fileCfg.maxRepairRounds ?? process.env.LLM_MAX_REPAIR_ROUNDS ?? 3) || 3,
    ),
  )
  const temperature = Number.isFinite(Number(override.temperature ?? fileCfg.temperature))
    ? Number(override.temperature ?? fileCfg.temperature)
    : 0.45
  const maxTokens = Math.max(
    1024,
    Number(override.maxTokens ?? fileCfg.maxTokens ?? 16000) || 16000,
  )

  if (mode === 'follow-dsh') {
    const dsh = loadDshClientDiscoveryInternal(override.dshHomeDir || '')
    const requestedDshProvId = String(
      override.dshProviderId ?? fileCfg.dshProviderId ?? '',
    ).trim()

    let pickedProv =
      (requestedDshProvId && requestedDshProvId !== 'active'
        ? dsh.providers.find((p) => p.id === requestedDshProvId)
        : null) || dsh.defaultProvider

    if (pickedProv) {
      const requestedModel = String(override.model ?? fileCfg.model ?? '').trim()
      const useModel =
        requestedModel ||
        (pickedProv.id === dsh.defaultProvider?.id ? dsh.defaultModel : '') ||
        pickedProv.models?.[0]?.id ||
        ''

      const formatOverride = String(override.format ?? fileCfg.format ?? '').trim()
      const effFormat =
        formatOverride && formatOverride !== 'auto'
          ? normalizeProtocolFormat(formatOverride)
          : pickedProv.api || 'openai-completions'

      return {
        mode: 'follow-dsh',
        sourceLabel:
          !requestedDshProvId || requestedDshProvId === 'active'
            ? `跟随 DSH 默认 (${pickedProv.displayName})`
            : `DSH 通道 (${pickedProv.displayName})`,
        dshProviderId: pickedProv.id,
        provider: pickedProv.id,
        format: effFormat,
        baseUrl: pickedProv.baseURL,
        apiKey: pickedProv._secretKey || '',
        model: useModel,
        maxRepairRounds,
        temperature,
        maxTokens,
      }
    }
    // If DSH directory is absent on this machine, fall cleanly to custom fields below
  }

  const provider =
    String(override.provider ?? fileCfg.provider ?? process.env.LLM_PROVIDER ?? 'custom').trim() ||
    'custom'
  const template = LLM_PROVIDER_TEMPLATES[provider] || LLM_PROVIDER_TEMPLATES.custom

  const formatRaw = String(
    override.format ?? fileCfg.format ?? process.env.LLM_FORMAT ?? template.defaultFormat ?? 'auto',
  ).toLowerCase()
  const format = VALID_FORMATS.has(formatRaw) ? normalizeProtocolFormat(formatRaw) : 'auto'

  const baseUrl = String(
    override.baseUrl ?? fileCfg.baseUrl ?? process.env.LLM_BASE_URL ?? template.defaultBaseUrl ?? '',
  )
    .trim()
    .replace(/\/+$/, '')

  const rawOverrideKey = override.apiKey !== undefined ? String(override.apiKey).trim() : undefined
  const apiKey =
    rawOverrideKey && rawOverrideKey !== 'KEEP_EXISTING' && !rawOverrideKey.includes('****')
      ? rawOverrideKey
      : String(fileCfg.apiKey ?? process.env.LLM_API_KEY ?? '').trim()

  const model = String(
    override.model ?? fileCfg.model ?? process.env.LLM_MODEL ?? '',
  ).trim()

  return {
    mode: 'custom',
    sourceLabel: template.label || '插件自定义模型',
    dshProviderId: '',
    provider,
    format,
    baseUrl,
    apiKey,
    model,
    maxRepairRounds,
    temperature,
    maxTokens,
  }
}

export function getSafeLlmConfigSummary(dshHomeOverride = '') {
  const cfg = resolveLlmConfig(dshHomeOverride ? { dshHomeDir: dshHomeOverride } : {})
  const fileCfg = readStoredConfigFile()
  const dsh = discoverDshClientConfig(dshHomeOverride)
  const template = LLM_PROVIDER_TEMPLATES[cfg.provider] || LLM_PROVIDER_TEMPLATES.custom
  const requiresKey =
    cfg.provider !== 'ollama' && !/^http:\/\/127\.0\.0\.1|^http:\/\/localhost/i.test(cfg.baseUrl)
  const configured = Boolean(cfg.baseUrl && cfg.model && (!requiresKey || cfg.apiKey))
  return {
    configured,
    mode: cfg.mode,
    sourceLabel: cfg.sourceLabel,
    dshProviderId: fileCfg.dshProviderId || (cfg.mode === 'follow-dsh' ? 'active' : ''),
    provider: cfg.provider,
    format: cfg.format,
    detectedProtocol: detectWireProtocol(cfg),
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    maxRepairRounds: cfg.maxRepairRounds,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    hasApiKey: Boolean(cfg.apiKey),
    maskedApiKey: maskSecretKey(cfg.apiKey),
    requiresKey: template.requiresKey,
    templates: Object.values(LLM_PROVIDER_TEMPLATES),
    protocols: WIRE_PROTOCOLS,
    dshClient: dsh,
    configFile: getLlmConfigPath(),
  }
}

export function saveLlmConfig(patch = {}) {
  const cfgPath = getLlmConfigPath()
  mkdirSync(dirname(cfgPath), { recursive: true })
  const existing = readStoredConfigFile()
  const nextMode =
    patch.mode === 'custom' || patch.mode === 'follow-dsh'
      ? patch.mode
      : existing.mode || 'follow-dsh'

  let nextApiKey = existing.apiKey || ''
  if (patch.clearApiKey === true) {
    nextApiKey = ''
  } else if (patch.apiKey !== undefined) {
    const incomingKey = String(patch.apiKey).trim()
    if (incomingKey && incomingKey !== 'KEEP_EXISTING' && !incomingKey.includes('****')) {
      nextApiKey = incomingKey
    }
  }

  const fmtIn = String(patch.format ?? existing.format ?? 'auto').toLowerCase()
  const nextFormat = VALID_FORMATS.has(fmtIn) ? normalizeProtocolFormat(fmtIn) : 'auto'

  const next = {
    mode: nextMode,
    dshProviderId:
      nextMode === 'follow-dsh'
        ? String(patch.dshProviderId ?? existing.dshProviderId ?? 'active').trim() || 'active'
        : '',
    provider: String(patch.provider ?? existing.provider ?? 'custom').trim() || 'custom',
    format: nextFormat,
    baseUrl:
      nextMode === 'follow-dsh'
        ? existing.baseUrl || ''
        : String(patch.baseUrl ?? existing.baseUrl ?? '').trim().replace(/\/+$/, ''),
    // Never write DSH client keys into plugin config when following DSH
    apiKey: nextMode === 'follow-dsh' ? existing.apiKey || '' : nextApiKey,
    model:
      patch.model !== undefined
        ? String(patch.model).trim()
        : existing.model || '',
    maxRepairRounds: Math.max(
      1,
      Math.min(5, Number(patch.maxRepairRounds ?? existing.maxRepairRounds ?? 3) || 3),
    ),
    temperature: Number.isFinite(Number(patch.temperature ?? existing.temperature))
      ? Number(patch.temperature ?? existing.temperature)
      : 0.45,
    maxTokens: Math.max(1024, Number(patch.maxTokens ?? existing.maxTokens ?? 16000) || 16000),
    updatedAt: new Date().toISOString(),
  }

  writeFileSync(cfgPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return getSafeLlmConfigSummary()
}

export function detectWireProtocol(cfg) {
  const fmt = normalizeProtocolFormat(cfg.format)
  if (
    fmt === 'anthropic-messages' ||
    fmt === 'openai-completions' ||
    fmt === 'openai-responses' ||
    fmt === 'gemini-native'
  ) {
    return fmt
  }
  const url = String(cfg.baseUrl || '').toLowerCase()
  const model = String(cfg.model || '').toLowerCase()
  if (url.includes('generativelanguage.googleapis.com') && !url.includes('/openai')) {
    return 'gemini-native'
  }
  if (/\/responses$/.test(url)) return 'openai-responses'
  if (url.includes('anthropic.com') || /\/v\d+\/messages$/.test(url)) return 'anthropic-messages'
  if (/\/chat\/completions$/.test(url)) return 'openai-completions'
  if (cfg.provider === 'gemini') return 'gemini-native'
  if (cfg.provider === 'anthropic' && !url.includes('openrouter')) return 'anthropic-messages'
  if (model.includes('codex')) return 'openai-responses'
  return 'openai-completions'
}

export function buildChatEndpoint(baseUrl, protocol, model = '') {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!clean) throw new Error('未填写 LLM Base URL，请先在「模型设置」选择 DSH 通道或自定义填入 API 地址。')

  if (protocol === 'anthropic-messages' || protocol === 'anthropic') {
    if (/\/v\d+\/messages$/i.test(clean)) return clean
    if (/\/v\d+$/i.test(clean)) return `${clean}/messages`
    return `${clean}/v1/messages`
  }

  if (protocol === 'openai-responses') {
    if (/\/responses$/i.test(clean)) return clean
    if (/\/chat\/completions$/i.test(clean)) return clean.replace(/\/chat\/completions$/i, '/responses')
    if (/\/v\d+(\/.*)?$/i.test(clean)) return `${clean}/responses`
    return `${clean}/v1/responses`
  }

  if (protocol === 'gemini-native') {
    if (/\/models\/[^/]+:(generateContent|streamGenerateContent)$/i.test(clean)) return clean
    const cleanRoot = clean.replace(/\/(models|openai)$/i, '')
    const mName = encodeURIComponent(String(model || 'gemini-2.5-flash').replace(/^models\//, ''))
    if (/\/v1beta$|\/v1$/i.test(cleanRoot)) {
      return `${cleanRoot}/models/${mName}:generateContent`
    }
    return `${cleanRoot}/v1beta/models/${mName}:generateContent`
  }

  // Default: openai-completions
  if (/\/chat\/completions$/i.test(clean)) return clean
  if (/\/responses$/i.test(clean)) return clean.replace(/\/responses$/i, '/chat/completions')
  if (/\/v\d+(\/.*)?$/i.test(clean)) return `${clean}/chat/completions`
  return `${clean}/v1/chat/completions`
}

function buildModelsEndpoint(baseUrl, protocol) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!clean) return ''
  if (protocol === 'gemini-native') {
    const cleanRoot = clean
      .replace(/\/models\/[^/]+:(generateContent|streamGenerateContent)$/i, '')
      .replace(/\/(models|openai)$/i, '')
    if (/\/v1beta$|\/v1$/i.test(cleanRoot)) return `${cleanRoot}/models`
    return `${cleanRoot}/v1beta/models`
  }
  const root = clean.replace(/\/(chat\/completions|responses|messages)$/i, '')
  if (/\/v\d+(\/openai)?$/i.test(root)) return `${root}/models`
  return `${root}/v1/models`
}

function extractFirstJsonObject(rawText) {
  const s = String(rawText || '').trimStart()
  if (!s.startsWith('{')) return null
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(0, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function parseRawLlmResponse(rawText, protocol) {
  const trimmed = String(rawText || '').trim()
  if (!trimmed) return { data: null, text: '', streamError: '' }

  // 1. Standard pure JSON response
  try {
    const data = JSON.parse(trimmed)
    return {
      data,
      text: extractTextFromReply(data, protocol),
      streamError: data?.error?.message || '',
    }
  } catch {}

  // 2. Leading JSON object before trailing proxy SSE lines (e.g. `{...}event: response.failed`)
  const leadingObj = extractFirstJsonObject(trimmed)
  if (leadingObj) {
    const leadingText = extractTextFromReply(leadingObj, protocol)
    if (leadingText.trim()) {
      return {
        data: leadingObj,
        text: leadingText,
        streamError: '',
      }
    }
  }

  // 3. Server-Sent Events (SSE: `data: {...}`) across all 4 wire protocols
  const deltas = []
  let completedData = leadingObj
  let streamError = ''
  let geminiLastText = ''

  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const payloadStr = line.slice(5).trim()
    if (!payloadStr || payloadStr === '[DONE]') continue
    let ev = null
    try {
      ev = JSON.parse(payloadStr)
    } catch {
      continue
    }
    if (!ev || typeof ev !== 'object') continue

    if (protocol === 'openai-responses') {
      if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') {
        deltas.push(ev.delta)
      } else if (ev.type === 'response.output_text.done' && typeof ev.text === 'string' && deltas.length === 0) {
        deltas.push(ev.text)
      } else if ((ev.type === 'response.completed' || ev.type === 'response.incomplete') && ev.response) {
        completedData = ev.response
      } else if (ev.type === 'response.failed' || ev.type === 'error') {
        streamError = ev?.response?.error?.message || ev?.error?.message || ev?.message || streamError
      } else if (ev.object === 'response' && Array.isArray(ev.output)) {
        completedData = ev
      }
    } else if (protocol === 'anthropic-messages') {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
        deltas.push(ev.delta.text)
      } else if (ev.type === 'message' && Array.isArray(ev.content)) {
        completedData = ev
      } else if (ev.type === 'error') {
        streamError = ev?.error?.message || ev?.message || streamError
      }
    } else if (protocol === 'gemini-native') {
      const partText = extractTextFromReply(ev, 'gemini-native')
      if (partText) {
        geminiLastText += partText
        completedData = ev
      }
      if (ev.error?.message) streamError = ev.error.message
    } else {
      if (Array.isArray(ev.choices)) {
        const d = ev.choices[0]?.delta?.content
        if (typeof d === 'string') deltas.push(d)
        else if (typeof ev.choices[0]?.message?.content === 'string') completedData = ev
      }
      if (ev.usage || ev.model) completedData = { ...(completedData || {}), ...ev }
      if (ev.error?.message) streamError = ev.error.message
    }
  }

  const completedText = completedData ? extractTextFromReply(completedData, protocol) : ''
  const finalText = completedText.trim()
    ? completedText
    : deltas.length > 0
      ? deltas.join('')
      : geminiLastText

  return {
    data: completedData,
    text: finalText,
    streamError,
  }
}

function extractTextFromReply(data, protocol) {
  if (!data || typeof data !== 'object') return ''

  if (protocol === 'anthropic-messages' || protocol === 'anthropic') {
    if (Array.isArray(data.content)) {
      return data.content
        .filter((b) => b?.type === 'text' && b.text)
        .map((b) => b.text)
        .join('\n')
    }
    if (typeof data.completion === 'string') return data.completion
    return ''
  }

  if (protocol === 'openai-responses') {
    if (typeof data.output_text === 'string' && data.output_text.trim()) {
      return data.output_text
    }
    if (Array.isArray(data.output)) {
      const chunks = []
      for (const item of data.output) {
        if (!item) continue
        if (typeof item.text === 'string') chunks.push(item.text)
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part?.text && (!part.type || part.type === 'output_text' || part.type === 'text')) {
              chunks.push(part.text)
            }
          }
        }
      }
      if (chunks.length > 0) return chunks.join('\n')
    }
    // Some relays echo choices even on responses
    if (typeof data?.choices?.[0]?.message?.content === 'string') {
      return data.choices[0].message.content
    }
    return ''
  }

  if (protocol === 'gemini-native') {
    const parts = data?.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      return parts
        .filter((p) => !p?.thought && typeof p?.text === 'string')
        .map((p) => p.text)
        .join('\n')
    }
    return ''
  }

  // openai-completions
  const choice = data?.choices?.[0]
  if (typeof choice?.message?.content === 'string') return choice.message.content
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content.map((c) => c?.text || '').join('\n')
  }
  if (typeof data?.output_text === 'string') return data.output_text
  return ''
}

async function readResponseTextSafe(res) {
  if (res?.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const chunks = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(decoder.decode(value, { stream: true }))
    }
    const tail = decoder.decode()
    if (tail) chunks.push(tail)
    return chunks.join('')
  }
  return await res.text()
}

function isTransientLlmError(err, status = 0, timeoutMs = 0) {
  if ([429, 502, 503, 504, 524].includes(status)) return true
  const msg = String(err?.message || err || '').toLowerCase()
  const code = String(err?.code || err?.cause?.code || '').toLowerCase()
  // Do not amplify long (>2m) client request timeouts with 3x inner retries
  const allowTimeoutRetry = msg.includes('超时') && Number(timeoutMs) > 0 && Number(timeoutMs) <= 120_000
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket') ||
    msg.includes('other side closed') ||
    msg.includes('terminated') ||
    allowTimeoutRetry ||
    code.includes('econnreset') ||
    code.includes('etimedout') ||
    code.includes('und_err')
  )
}

/**
 * Call any configured LLM across all 4 wire protocols:
 * - openai-completions (/v1/chat/completions)
 * - anthropic-messages (/v1/messages)
 * - openai-responses (/v1/responses)
 * - gemini-native (/v1beta/models)
 * Includes incremental stream reading + transient relay/network retries.
 */
export async function callLlmChat({
  messages = [],
  system = '',
  temperature,
  maxTokens,
  timeoutMs = 180000,
  overrideConfig = {},
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const cfg = resolveLlmConfig(overrideConfig)
  if (!cfg.baseUrl) {
    throw new Error('尚未配置大模型接口地址 (Base URL)。点击右上角「模型设置」可一键跟随 DSH 客户端或填写自定义网关。')
  }
  if (!cfg.model) {
    throw new Error('尚未指定模型名称 (例如 claude-opus-5-5 / gpt-6.1-sol / deepseek-chat / gemini-2.5-pro)。')
  }
  const requiresKey = cfg.provider !== 'ollama' && !/^http:\/\/127\.0\.0\.1|^http:\/\/localhost/i.test(cfg.baseUrl)
  if (requiresKey && !cfg.apiKey) {
    throw new Error('尚未找到可用 API Key：请在「模型设置」开启跟随 DSH 客户端或填入插件专属密钥。')
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前 Node 运行时缺少 fetch API。')
  }

  const protocol = detectWireProtocol(cfg)
  const endpoint = buildChatEndpoint(cfg.baseUrl, protocol, cfg.model)
  const temp = Number.isFinite(Number(temperature)) ? Number(temperature) : cfg.temperature
  const maxOut = Number(maxTokens) > 0 ? Number(maxTokens) : cfg.maxTokens

  let headers
  let payload
  const sysParts = [system, ...messages.filter((m) => m?.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : ''))]
    .filter(Boolean)
    .join('\n\n')
  const normalizeMsgParts = (rawContent) => {
    if (Array.isArray(rawContent)) {
      const parts = []
      for (const item of rawContent) {
        if (!item) continue
        if (typeof item === 'string') {
          if (item) parts.push({ type: 'text', text: item })
        } else if (item.type === 'text' && item.text) {
          parts.push({ type: 'text', text: String(item.text) })
        } else if (item.type === 'image' && item.base64) {
          parts.push({
            type: 'image',
            mimeType: String(item.mimeType || 'image/jpeg'),
            base64: String(item.base64).replace(/^data:[^;]+;base64,/, ''),
          })
        } else if (item.type === 'image_url' && item.image_url?.url) {
          const urlStr = String(item.image_url.url)
          const dm = /^data:([^;]+);base64,(.+)$/i.exec(urlStr)
          if (dm) {
            parts.push({ type: 'image', mimeType: dm[1], base64: dm[2] })
          } else {
            parts.push({ type: 'image_url', url: urlStr })
          }
        }
      }
      return parts
    }
    const text = String(rawContent || '')
    return text ? [{ type: 'text', text }] : []
  }

  const chatMsgs = messages
    .filter((m) => m && m.role !== 'system' && m.content)
    .map((m) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user'
      const parts = normalizeMsgParts(m.content)
      const isPlainText = parts.every((p) => p.type === 'text')
      return {
        role,
        parts,
        textOnly: isPlainText ? parts.map((p) => p.text).join('\n') : null,
      }
    })
    .filter((m) => m.parts.length > 0)

  if (protocol === 'anthropic-messages') {
    headers = {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    }
    payload = {
      model: cfg.model,
      max_tokens: maxOut,
      temperature: temp,
      ...(sysParts ? { system: sysParts } : {}),
      messages: chatMsgs.map((m) => ({
        role: m.role,
        content:
          m.textOnly !== null
            ? m.textOnly
            : m.parts.map((p) =>
                p.type === 'image'
                  ? { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.base64 } }
                  : { type: 'text', text: p.text || '' },
              ),
      })),
    }
  } else if (protocol === 'openai-responses') {
    headers = {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    }
    payload = {
      model: cfg.model,
      stream: true,
      ...(sysParts ? { instructions: sysParts } : {}),
      input: chatMsgs.map((m) => ({
        type: 'message',
        role: m.role,
        content: m.parts.map((p) =>
          p.type === 'image'
            ? { type: 'input_image', image_url: `data:${p.mimeType};base64,${p.base64}` }
            : p.type === 'image_url'
              ? { type: 'input_image', image_url: p.url }
              : { type: m.role === 'assistant' ? 'output_text' : 'input_text', text: p.text || '' },
        ),
      })),
      max_output_tokens: maxOut,
    }
  } else if (protocol === 'gemini-native') {
    headers = {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {}),
    }
    payload = {
      ...(sysParts ? { systemInstruction: { parts: [{ text: sysParts }] } } : {}),
      contents: chatMsgs.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: m.parts.map((p) =>
          p.type === 'image'
            ? { inlineData: { mimeType: p.mimeType, data: p.base64 } }
            : { text: p.text || '' },
        ),
      })),
      generationConfig: {
        temperature: temp,
        maxOutputTokens: maxOut,
      },
    }
  } else {
    headers = {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    }
    const normMsgs = []
    if (sysParts) normMsgs.push({ role: 'system', content: sysParts })
    for (const m of chatMsgs) {
      normMsgs.push({
        role: m.role,
        content:
          m.textOnly !== null
            ? m.textOnly
            : m.parts.map((p) =>
                p.type === 'image'
                  ? { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.base64}` } }
                  : p.type === 'image_url'
                    ? { type: 'image_url', image_url: { url: p.url } }
                    : { type: 'text', text: p.text || '' },
              ),
      })
    }
    payload = {
      model: cfg.model,
      messages: normMsgs,
      temperature: temp,
      max_tokens: maxOut,
    }
  }

  const maxAttempts = fetchImpl === globalThis.fetch ? 3 : 2
  const baseBackoffMs = fetchImpl === globalThis.fetch ? 1500 : 30
  let lastErr = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw signal.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' })
    }
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort(signal?.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
    if (signal) {
      if (signal.aborted) onExternalAbort()
      else signal.addEventListener('abort', onExternalAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(new Error(`LLM 请求超时 (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs)
    let resStatus = 0

    try {
      const bodyStr = JSON.stringify(payload)
      const res =
        fetchImpl === globalThis.fetch && timeoutMs > 240_000
          ? await postJsonLongTimeout(endpoint, headers, bodyStr, timeoutMs, controller.signal)
          : await fetchImpl(endpoint, {
              method: 'POST',
              headers,
              body: bodyStr,
              signal: controller.signal,
            })
      resStatus = res.status || 0
      const rawText = await readResponseTextSafe(res)
      const parsed = parseRawLlmResponse(rawText, protocol)
      const data = parsed.data

      if (!res.ok) {
        const msg =
          data?.error?.message ||
          parsed.streamError ||
          data?.message ||
          rawText.slice(0, 300) ||
          `HTTP ${res.status}`
        const httpErr = new Error(`大模型接口 (${protocol}) 返回错误 (${res.status}): ${msg}`)
        if (attempt < maxAttempts && isTransientLlmError(httpErr, resStatus)) {
          lastErr = httpErr
          await new Promise((r) => setTimeout(r, baseBackoffMs * attempt))
          continue
        }
        throw httpErr
      }

      const text = parsed.text || ''
      if (!text.trim()) {
        const emptyErr = parsed.streamError
          ? new Error(`大模型接口 (${protocol}) 返回错误: ${parsed.streamError}`)
          : new Error('大模型返回内容为空，请检查模型 ID、协议类型或额度限制。')
        if (attempt < maxAttempts && parsed.streamError && isTransientLlmError(emptyErr, resStatus)) {
          lastErr = emptyErr
          await new Promise((r) => setTimeout(r, baseBackoffMs * attempt))
          continue
        }
        throw emptyErr
      }

      return {
        ok: true,
        protocol,
        endpoint,
        model: data?.model || cfg.model,
        text,
        usage: data?.usage || data?.usageMetadata || null,
      }
    } catch (err) {
      lastErr = err
      if (err?.name === 'AbortError' || signal?.aborted) throw err
      if (attempt < maxAttempts && isTransientLlmError(err, resStatus, timeoutMs)) {
        await new Promise((r) => setTimeout(r, baseBackoffMs * attempt))
        continue
      }
      throw err
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
  }
  throw lastErr || new Error('LLM 请求失败')
}

export async function fetchAvailableModels(overrideConfig = {}, fetchImpl = globalThis.fetch) {
  const cfg = resolveLlmConfig(overrideConfig)
  const protocol = detectWireProtocol(cfg)
  const endpoint = buildModelsEndpoint(cfg.baseUrl, protocol)
  if (!endpoint || typeof fetchImpl !== 'function') return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    let headers = {}
    if (protocol === 'anthropic-messages') {
      headers = {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      }
    } else if (protocol === 'gemini-native') {
      headers = cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {}
    } else {
      headers = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}
    }

    const res = await fetchImpl(endpoint, { method: 'GET', headers, signal: controller.signal })
    if (!res.ok) return []
    const json = await res.json()
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : []
    return list
      .map((item) => String(item?.id || item?.name || '').replace(/^models\//, '').trim())
      .filter(Boolean)
      .slice(0, 80)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export async function testLlmConnection(overrideConfig = {}, fetchImpl = globalThis.fetch) {
  const started = Date.now()
  const cfg = resolveLlmConfig(overrideConfig)
  const models = await fetchAvailableModels(cfg, fetchImpl)
  const res = await callLlmChat({
    overrideConfig: cfg,
    fetchImpl,
    system: 'Reply strictly with OK.',
    messages: [{ role: 'user', content: 'Connection health check. Reply with OK.' }],
    temperature: 0,
    maxTokens: 32,
    timeoutMs: 25000,
  })
  return {
    ok: true,
    latencyMs: Date.now() - started,
    mode: cfg.mode,
    protocol: res.protocol,
    model: res.model,
    endpoint: res.endpoint,
    replyPreview: res.text.trim().slice(0, 80),
    availableModels: models,
  }
}

/**
 * Robustly extract a JSON object or array from an LLM reply (handling markdown fences & commentary).
 */
export function extractJsonFromLlmText(rawText) {
  const text = String(rawText || '').trim()
  if (!text) throw new Error('Empty LLM response')

  // 1. Direct JSON
  try {
    return JSON.parse(text)
  } catch {}

  // 2. ```json ... ``` fenced block
  const fenceMatches = [...text.matchAll(/```(?:json|JSON)?\s*\n([\s\S]*?)\n```/g)]
  for (const m of fenceMatches) {
    try {
      return JSON.parse(m[1].trim())
    } catch {}
  }

  // 3. Balanced top-level {...} scanner
  const firstBrace = text.indexOf('{')
  if (firstBrace >= 0) {
    let depth = 0
    let inStr = false
    let escape = false
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i]
      if (inStr) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') {
        inStr = true
        continue
      }
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          const candidate = text.slice(firstBrace, i + 1)
          try {
            return JSON.parse(candidate)
          } catch {}
          break
        }
      }
    }
  }

  throw new Error(`无法从模型回复中解析 JSON，请重试或换用指令遵循更强的模型。片段: ${text.slice(0, 180)}`)
}
