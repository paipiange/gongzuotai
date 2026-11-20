/**
 * @dsh-video/tool-media — Optional BYOK Cloud AI Media Generation Hub (Image · Video · Music/Audio + Open Custom HTTP Protocol)
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * 100% Optional BYOK connectors:
 *   - Image : Volcengine 即梦 Seedream · OpenAI/Flux Compatible · BFL Flux Pro · Fal.ai Flux · Kling Image · Custom HTTP Protocol
 *   - Video : Volcengine 方舟 Seedance/即梦 · Kling 可灵 (JWT/Bearer) · MiniMax 海螺 Hailuo · OpenAI/Runway/Luma · Custom HTTP Protocol
 *   - Audio : Suno Music API (v4/v4.5/v5) · MiniMax Music (music-2.0/1.5) · MiniMax Speech (speech-02-hd) · ElevenLabs SFX · Custom HTTP Protocol
 */
import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { loadEnv, readScriptJson, REPO_ROOT, writeScriptJson } from '../shared/index.js'
import { readAssets, writeAssets } from './asset-manager.js'
import { analyzeAudioBeatStructure } from './beat-analyzer.js'

const CONFIG_FILENAME = '.dsh-video-cloud-media.json'

export const CLOUD_MEDIA_PRESETS = {
  image: [
    {
      id: 'volcengine-seedream',
      name: '火山方舟 · 即梦 Seedream（生图）',
      protocol: 'openai-image',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      endpoint: '/images/generations',
      defaultModel: 'doubao-seedream-3-0-t2i-250415',
      authType: 'bearer',
      docsHint: '填写火山方舟 ARK_API_KEY 与模型/接入点 ID',
    },
    {
      id: 'openai-image',
      name: 'OpenAI / Flux / 硅基流动 / OneAPI 兼容生图',
      protocol: 'openai-image',
      baseUrl: 'https://api.openai.com/v1',
      endpoint: '/images/generations',
      defaultModel: 'gpt-image-1',
      authType: 'bearer',
      docsHint: '兼容所有 /v1/images/generations 协议（GPT Image 1、Flux.1、SiliconFlow、NewAPI 等）',
    },
    {
      id: 'bfl-flux',
      name: 'Black Forest Labs · Flux Pro（生图）',
      protocol: 'bfl-flux',
      baseUrl: 'https://api.bfl.ai',
      endpoint: '/v1/flux-pro-1.1',
      defaultModel: 'flux-pro-1.1',
      authType: 'x-key',
      docsHint: '使用官方 x-key 异步提交与轮询 /v1/get_result',
    },
    {
      id: 'fal-flux',
      name: 'Fal.ai · Flux Schnell / Pro（极速生图）',
      protocol: 'fal-image',
      baseUrl: 'https://fal.run',
      endpoint: '/fal-ai/flux/schnell',
      defaultModel: 'fal-ai/flux/schnell',
      authType: 'fal-key',
      docsHint: 'Header 自动携带 Authorization: Key <FAL_KEY>',
    },
    {
      id: 'kling-image',
      name: '可灵 Kling AI（生图）',
      protocol: 'kling-image',
      baseUrl: 'https://api.klingai.com',
      endpoint: '/v1/images/generations',
      defaultModel: 'kling-v2',
      authType: 'kling-jwt-or-bearer',
      docsHint: '支持直接填 Bearer Token，或填 "AK:SK" 自动生成 HS256 JWT',
    },
    {
      id: 'custom-image',
      name: '自定义云端生图接口（Custom HTTP JSON 协议）',
      protocol: 'custom',
      baseUrl: '',
      endpoint: '',
      defaultModel: 'custom-image-model',
      authType: 'custom',
      docsHint: '自由填写提交 URL、Headers、JSON 请求模板（支持 {{prompt}} / {{model}} / {{aspectRatio}}）与响应/轮询路径',
    },
  ],
  video: [
    {
      id: 'volcengine-seedance',
      name: '火山方舟 · Seedance 2.5 / 即梦视频',
      protocol: 'volcengine-seedance',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      endpoint: '/contents/generations/tasks',
      defaultModel: 'doubao-seedance-2-5-260628',
      authType: 'bearer',
      docsHint: '标准火山方舟异步任务 /contents/generations/tasks + 轮询提取 content.video_url',
    },
    {
      id: 'kling-video',
      name: '可灵 Kling AI（文生/图生视频）',
      protocol: 'kling-video',
      baseUrl: 'https://api.klingai.com',
      endpoint: '/v1/videos/text2video',
      defaultModel: 'kling-v2-6',
      authType: 'kling-jwt-or-bearer',
      docsHint: '支持 Bearer Token 或 "AccessKey:SecretKey" 自动 HS256 JWT 签发',
    },
    {
      id: 'minimax-hailuo',
      name: 'MiniMax · 海螺视频 Hailuo',
      protocol: 'minimax-hailuo',
      baseUrl: 'https://api.minimaxi.com',
      endpoint: '/v1/video_generation',
      defaultModel: 'MiniMax-Hailuo-02',
      authType: 'bearer',
      docsHint: '国内填 https://api.minimaxi.com，海外填 https://api.minimax.io',
    },
    {
      id: 'openai-video',
      name: 'OpenAI Sora / Runway / 兼容视频接口',
      protocol: 'openai-video',
      baseUrl: 'https://api.openai.com/v1',
      endpoint: '/videos/generations',
      defaultModel: 'sora-2',
      authType: 'bearer',
      docsHint: '兼容中转站 /v1/videos/generations 同步或异步任务接口',
    },
    {
      id: 'custom-video',
      name: '自定义云端生视频接口（Custom HTTP JSON 协议）',
      protocol: 'custom',
      baseUrl: '',
      endpoint: '',
      defaultModel: 'custom-video-model',
      authType: 'custom',
      docsHint: '自由配置提交 URL、轮询 URL ({{taskId}})、状态路径与视频 URL 提取路径，兼容任意新模型',
    },
  ],
  audio: [
    {
      id: 'suno-music',
      name: 'Suno Music API（AI 完整编曲/人声歌曲）',
      protocol: 'suno-music',
      baseUrl: 'https://api.sunoapi.org',
      endpoint: '/suno/submit/music',
      defaultModel: 'chirp-v4-5',
      authType: 'bearer',
      docsHint: '兼容主流 Suno API / NewAPI / GoAPI（支持纯音乐 instrumental、歌词 lyrics、风格标签 tags）',
    },
    {
      id: 'minimax-music',
      name: 'MiniMax 音乐模型（Music-2.0 / 1.5 完整歌曲）',
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimaxi.com',
      endpoint: '/v1/music_generation',
      defaultModel: 'music-2.0',
      authType: 'bearer',
      docsHint: '国内 https://api.minimaxi.com · 海外 https://api.minimax.io，支持同步返回 Hex MP3 或直链 URL',
    },
    {
      id: 'minimax-speech',
      name: 'MiniMax 语音音频（Speech-02-HD / T2A v2）',
      protocol: 'minimax-speech',
      baseUrl: 'https://api.minimaxi.com',
      endpoint: '/v1/t2a_v2',
      defaultModel: 'speech-02-hd',
      authType: 'bearer',
      docsHint: 'MiniMax 高表现力云端语音/旁白/音效生成，支持情绪与多音色',
    },
    {
      id: 'elevenlabs-sfx',
      name: 'ElevenLabs · AI 音效与配音（Sound Generation）',
      protocol: 'elevenlabs-sfx',
      baseUrl: 'https://api.elevenlabs.io',
      endpoint: '/v1/sound-generation',
      defaultModel: 'eleven_sound_v2',
      authType: 'xi-api-key',
      docsHint: 'Header 自动使用 xi-api-key，直接返回高质量 MP3 音效',
    },
    {
      id: 'custom-audio',
      name: '自定义云端音频/音乐接口（Custom HTTP JSON 协议）',
      protocol: 'custom',
      baseUrl: '',
      endpoint: '',
      defaultModel: 'custom-audio-model',
      authType: 'custom',
      docsHint: '自由接入 Udio / Mureka / 豆包音乐 / 任意自建音频 API（支持 url/base64/hex/binary 与异步轮询）',
    },
  ],
}

function getConfigPath() {
  return join(REPO_ROOT, CONFIG_FILENAME)
}

function createDefaultCategoryConfig(category) {
  const first = CLOUD_MEDIA_PRESETS[category][0]
  return {
    enabled: false,
    providerId: first.id,
    protocol: first.protocol,
    baseUrl: first.baseUrl,
    endpoint: first.endpoint,
    model: first.defaultModel,
    apiKey: '',
    extraParams: {},
    custom: {
      submitUrl: '',
      method: 'POST',
      headersJson: '{\n  "Content-Type": "application/json",\n  "Authorization": "Bearer {{apiKey}}"\n}',
      bodyTemplateJson:
        category === 'audio'
          ? '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "lyrics": "{{lyrics}}",\n  "instrumental": {{instrumental}}\n}'
          : category === 'video'
            ? '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "duration": {{duration}},\n  "aspect_ratio": "{{aspectRatio}}"\n}'
            : '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "size": "1536x1024"\n}',
      mode: category === 'image' ? 'sync' : 'async-poll',
      taskIdPath: 'data.task_id',
      pollUrlTemplate: '',
      pollMethod: 'GET',
      statusPath: 'data.status',
      successValues: 'succeeded,completed,done,SUCCESS,2',
      failValues: 'failed,error,FAILED,cancelled',
      resultUrlPath: category === 'audio' ? 'data.audio' : category === 'video' ? 'data.video_url' : 'data.0.url',
      resultFormat: 'url',
    },
  }
}

export function loadCloudMediaConfig() {
  loadEnv()
  const defaults = {
    image: createDefaultCategoryConfig('image'),
    video: createDefaultCategoryConfig('video'),
    audio: createDefaultCategoryConfig('audio'),
    autoUseCloudBroll: false,
    updatedAt: '',
  }
  const p = getConfigPath()
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      for (const cat of ['image', 'video', 'audio']) {
        if (parsed?.[cat] && typeof parsed[cat] === 'object') {
          defaults[cat] = {
            ...defaults[cat],
            ...parsed[cat],
            custom: { ...defaults[cat].custom, ...(parsed[cat].custom || {}) },
          }
        }
      }
      if (typeof parsed?.autoUseCloudBroll === 'boolean') defaults.autoUseCloudBroll = parsed.autoUseCloudBroll
      if (parsed?.updatedAt) defaults.updatedAt = parsed.updatedAt
    } catch {}
  }
  return defaults
}

function maskKey(k = '') {
  const s = String(k || '').trim()
  if (!s) return ''
  if (s.length <= 8) return '***'
  return `${s.slice(0, 4)}***${s.slice(-4)}`
}

export function getCloudMediaConfigSummary() {
  const cfg = loadCloudMediaConfig()
  const masked = {
    autoUseCloudBroll: cfg.autoUseCloudBroll,
    updatedAt: cfg.updatedAt,
    presets: CLOUD_MEDIA_PRESETS,
  }
  for (const cat of ['image', 'video', 'audio']) {
    const item = cfg[cat]
    masked[cat] = {
      ...item,
      apiKey: '',
      hasApiKey: Boolean(String(item.apiKey || '').trim()),
      apiKeyMasked: maskKey(item.apiKey),
    }
  }
  return masked
}

export function saveCloudMediaConfig(patch = {}) {
  const cur = loadCloudMediaConfig()
  for (const cat of ['image', 'video', 'audio']) {
    const incoming = patch?.[cat]
    if (!incoming || typeof incoming !== 'object') continue
    const preset = CLOUD_MEDIA_PRESETS[cat].find((p) => p.id === incoming.providerId) || null
    const nextKey =
      incoming.clearApiKey === true
        ? ''
        : typeof incoming.apiKey === 'string' && incoming.apiKey.trim() && !incoming.apiKey.includes('***')
          ? incoming.apiKey.trim()
          : cur[cat].apiKey
    cur[cat] = {
      ...cur[cat],
      ...incoming,
      protocol: String(incoming.protocol || preset?.protocol || cur[cat].protocol || 'custom'),
      apiKey: nextKey,
      custom: {
        ...cur[cat].custom,
        ...(incoming.custom && typeof incoming.custom === 'object' ? incoming.custom : {}),
      },
    }
    delete cur[cat].clearApiKey
    delete cur[cat].hasApiKey
    delete cur[cat].apiKeyMasked
  }
  if (typeof patch?.autoUseCloudBroll === 'boolean') {
    cur.autoUseCloudBroll = patch.autoUseCloudBroll
  }
  cur.updatedAt = new Date().toISOString()
  writeFileSync(getConfigPath(), JSON.stringify(cur, null, 2) + '\n', 'utf8')
  return getCloudMediaConfigSummary()
}

/**
 * Resolve dotted / bracketed JSON path (e.g. "data.task_result.videos.0.url" or "data[0].url").
 */
export function getByDotPath(obj, pathStr = '') {
  if (!obj || !pathStr) return undefined
  const tokens = String(pathStr)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
  let cur = obj
  for (const tok of tokens) {
    if (cur == null) return undefined
    cur = cur[tok]
  }
  return cur
}

/**
 * Pure Node.js HS256 JWT signer for Kling AI official `AccessKey:SecretKey` authentication.
 */
export function createKlingJwt(ak, sk) {
  const b64u = (v) => Buffer.from(v).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64u(JSON.stringify({ iss: String(ak), exp: now + 1800, nbf: now - 5 }))
  const sig = createHmac('sha256', String(sk)).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

function buildKlingAuthHeader(rawKey = '') {
  const s = String(rawKey || '').trim()
  if (!s) return ''
  if (s.includes(':') && !s.startsWith('eyJ')) {
    const [ak, ...rest] = s.split(':')
    const sk = rest.join(':')
    if (ak && sk) return `Bearer ${createKlingJwt(ak.trim(), sk.trim())}`
  }
  return s.startsWith('Bearer ') ? s : `Bearer ${s}`
}

function renderTemplateValue(templateStr = '', vars = {}, escapeForJson = false) {
  return String(templateStr || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
    const raw = vars[k] !== undefined ? vars[k] : ''
    if (typeof raw === 'boolean' || typeof raw === 'number') return String(raw)
    const str = String(raw)
    if (!escapeForJson) return str
    return JSON.stringify(str).slice(1, -1)
  })
}

function joinUrl(base = '', endpoint = '') {
  const b = String(base || '').trim().replace(/\/+$/, '')
  const e = String(endpoint || '').trim()
  if (!e) return b
  if (/^https?:\/\//i.test(e)) return e
  return `${b}/${e.replace(/^\/+/, '')}`
}

async function sleepMs(ms, signal) {
  if (signal?.aborted) throw new Error('Cloud media generation aborted')
  await new Promise((resolveWait, rejectWait) => {
    const t = setTimeout(resolveWait, ms)
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        rejectWait(new Error('Cloud media generation aborted'))
      }, { once: true })
    }
  })
}

async function fetchJsonChecked(fetchFn, url, init, label = 'Cloud API') {
  const resp = await fetchFn(url, init)
  const ct = String(resp.headers?.get?.('content-type') || '').toLowerCase()
  if (ct.startsWith('audio/') || ct.startsWith('image/') || ct.startsWith('video/') || ct === 'application/octet-stream') {
    const buf = Buffer.from(await resp.arrayBuffer())
    if (!resp.ok) throw new Error(`${label} HTTP ${resp.status}`)
    return { binary: buf, contentType: ct, status: resp.status }
  }
  const text = await resp.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  if (!resp.ok) {
    const msg = json?.error?.message || json?.message || json?.base_resp?.status_msg || text.slice(0, 260)
    throw new Error(`${label} HTTP ${resp.status}: ${msg}`)
  }
  return { json: json ?? { rawText: text }, contentType: ct, status: resp.status }
}

async function materializeOutputAsset({ fetchFn, resultVal, resultFormat = 'url', outDir, baseName, defaultExt, signal }) {
  mkdirSync(outDir, { recursive: true })
  if (Buffer.isBuffer(resultVal)) {
    const outPath = join(outDir, `${baseName}${defaultExt}`)
    writeFileSync(outPath, resultVal)
    return outPath
  }
  const str = String(resultVal || '').trim()
  if (!str) throw new Error('云端接口返回成功，但未提取到有效的资源 URL 或二进制数据')

  if (resultFormat === 'hex' || (/^[0-9a-fA-F]{64,}$/.test(str) && str.length % 2 === 0)) {
    const outPath = join(outDir, `${baseName}${defaultExt}`)
    writeFileSync(outPath, Buffer.from(str, 'hex'))
    return outPath
  }
  if (resultFormat === 'base64' || str.startsWith('data:')) {
    const cleanB64 = str.replace(/^data:[^;]+;base64,/, '')
    const outPath = join(outDir, `${baseName}${defaultExt}`)
    writeFileSync(outPath, Buffer.from(cleanB64, 'base64'))
    return outPath
  }
  if (/^https?:\/\//i.test(str)) {
    const dl = await fetchFn(str, { method: 'GET', signal })
    if (!dl.ok) throw new Error(`下载云端生成文件失败 (HTTP ${dl.status}): ${str.slice(0, 120)}`)
    const buf = Buffer.from(await dl.arrayBuffer())
    const urlExt = extname(new URL(str).pathname || '').toLowerCase()
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.ogg', '.flac'].includes(urlExt)
      ? urlExt
      : defaultExt
    const outPath = join(outDir, `${baseName}${safeExt}`)
    writeFileSync(outPath, buf)
    return outPath
  }
  throw new Error(`无法识别的云端资源返回格式 (${resultFormat}): ${str.slice(0, 120)}`)
}

/**
 * Execute a custom user-defined HTTP/JSON cloud media protocol (sync or async polling).
 */
async function invokeCustomCloudProtocol({ catCfg, vars, fetchFn, signal, onProgress, pollIntervalMs = 2500, maxPolls = 60 }) {
  const c = catCfg.custom || {}
  const submitUrl = renderTemplateValue(c.submitUrl || joinUrl(catCfg.baseUrl, catCfg.endpoint), vars, false)
  if (!submitUrl || !/^https?:\/\//i.test(submitUrl)) {
    throw new Error('自定义云端接口缺少合法的 Submit URL (https://...)')
  }
  let headers = { 'Content-Type': 'application/json' }
  if (c.headersJson && String(c.headersJson).trim()) {
    try {
      headers = JSON.parse(renderTemplateValue(c.headersJson, vars, true))
    } catch (e) {
      throw new Error(`自定义 Headers JSON 格式错误: ${e.message}`)
    }
  }
  const method = String(c.method || 'POST').toUpperCase()
  let bodyStr = undefined
  if (method !== 'GET' && method !== 'HEAD') {
    bodyStr = renderTemplateValue(c.bodyTemplateJson || '{}', vars, true)
  }

  onProgress?.({ stage: 'cloud-submit', progress: 20, message: `正在调用自定义云端接口: ${submitUrl}` })
  const firstRes = await fetchJsonChecked(fetchFn, submitUrl, { method, headers, body: bodyStr, signal }, 'Custom Cloud API')
  if (firstRes.binary) {
    return { resultVal: firstRes.binary, resultFormat: 'binary', raw: { binaryBytes: firstRes.binary.length } }
  }
  const submitData = firstRes.json

  if (c.mode !== 'async-poll' || !c.pollUrlTemplate) {
    const val = getByDotPath(submitData, c.resultUrlPath || 'data.0.url')
    return { resultVal: val, resultFormat: c.resultFormat || 'url', raw: submitData }
  }

  const taskId = getByDotPath(submitData, c.taskIdPath || 'data.task_id') || submitData?.id || submitData?.task_id
  if (!taskId) {
    // Fallback if API returned sync result directly
    const directVal = getByDotPath(submitData, c.resultUrlPath || '')
    if (directVal) return { resultVal: directVal, resultFormat: c.resultFormat || 'url', raw: submitData }
    throw new Error(`自定义异步接口未在路径 "${c.taskIdPath}" 找到 taskId`)
  }

  const successSet = new Set(String(c.successValues || 'succeeded,completed,done,SUCCESS,2').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  const failSet = new Set(String(c.failValues || 'failed,error,FAILED,cancelled').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  const pollUrl = renderTemplateValue(c.pollUrlTemplate, { ...vars, taskId }, false)
  const pollMethod = String(c.pollMethod || 'GET').toUpperCase()

  for (let i = 0; i < maxPolls; i++) {
    onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 28 + Math.round((i / maxPolls) * 60)), message: `自定义异步任务轮询中 (${taskId} · 第 ${i + 1} 次)...` })
    const pollRes = await fetchJsonChecked(fetchFn, pollUrl, { method: pollMethod, headers, signal }, 'Custom Cloud Poll')
    if (pollRes.binary) return { resultVal: pollRes.binary, resultFormat: 'binary', raw: { binaryBytes: pollRes.binary.length } }
    const pJson = pollRes.json
    const st = String(getByDotPath(pJson, c.statusPath || 'data.status') ?? '').trim().toLowerCase()
    if (failSet.has(st)) {
      throw new Error(`自定义云端任务失败 (status=${st}): ${JSON.stringify(pJson).slice(0, 220)}`)
    }
    const maybeOut = getByDotPath(pJson, c.resultUrlPath || '')
    if (successSet.has(st) || (!st && maybeOut)) {
      return { resultVal: maybeOut, resultFormat: c.resultFormat || 'url', raw: pJson }
    }
    await sleepMs(pollIntervalMs, signal)
  }
  throw new Error(`自定义云端异步任务超时 (${taskId})`)
}

/**
 * Generate an Image, Video B-roll, or Music/Audio asset via optional BYOK Cloud Providers or Custom Protocol,
 * download into `<projectDir>/assets/cloud-<category>/`, register in `assets.json`, and optionally bind to `script.json`.
 */
export async function generateCloudMediaAsset(options = {}) {
  loadEnv()
  const {
    projectDir = '',
    category = 'image',
    prompt = '',
    lyrics = '',
    tags = '',
    title = '',
    durationSec = 5,
    aspectRatio = '16:9',
    imageUrl = '',
    instrumental = false,
    sceneId = '',
    autoBindToScript = true,
    providerOverride = null,
    fetchImpl = null,
    pollIntervalMs = 2500,
    maxPolls = 60,
    signal,
    onProgress,
  } = options

  if (!['image', 'video', 'audio'].includes(category)) {
    throw new Error(`Unsupported cloud media category: ${category}`)
  }
  const cleanPrompt = String(prompt || '').trim()
  if (!cleanPrompt && !String(lyrics || '').trim()) {
    throw new Error('请填写生成提示词 prompt（或音乐歌词 lyrics）')
  }

  const cfg = loadCloudMediaConfig()
  const catCfg = providerOverride
    ? {
        ...cfg[category],
        ...providerOverride,
        custom: { ...cfg[category].custom, ...(providerOverride.custom || {}) },
      }
    : cfg[category]

  const protocol = String(catCfg.protocol || 'custom')
  const apiKey = String(catCfg.apiKey || '').trim()
  if (protocol !== 'custom' && !apiKey) {
    throw new Error(`尚未配置云端 ${category} 模型的 API Key，请先在「☁️ 云端生图/视频/音乐 (BYOK)」中填写并保存。`)
  }

  const fetchFn = fetchImpl || globalThis.fetch
  const vars = {
    prompt: cleanPrompt,
    lyrics: String(lyrics || '').trim() || `[Instrumental]\n${cleanPrompt}`,
    tags: String(tags || '').trim() || cleanPrompt.slice(0, 60),
    title: String(title || '').trim() || cleanPrompt.slice(0, 28),
    model: String(catCfg.model || '').trim(),
    duration: Number(durationSec) || 5,
    aspectRatio: String(aspectRatio || '16:9'),
    imageUrl: String(imageUrl || '').trim(),
    instrumental: Boolean(instrumental),
    apiKey,
  }

  let extracted = null
  const defaultExt = category === 'video' ? '.mp4' : category === 'audio' ? '.mp3' : '.png'

  if (protocol === 'custom') {
    extracted = await invokeCustomCloudProtocol({ catCfg, vars, fetchFn, signal, onProgress, pollIntervalMs, maxPolls })
  } else if (protocol === 'openai-image') {
    const url = joinUrl(catCfg.baseUrl || 'https://api.openai.com/v1', catCfg.endpoint || '/images/generations')
    const size = aspectRatio === '9:16' ? '1024x1792' : aspectRatio === '1:1' ? '1024x1024' : '1536x1024'
    onProgress?.({ stage: 'cloud-submit', progress: 35, message: `正在调用云端生图模型 (${vars.model})...` })
    const res = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: vars.model, prompt: cleanPrompt, n: 1, size }),
        signal,
      },
      'Cloud Image API',
    )
    const item = res.json?.data?.[0] || {}
    extracted = {
      resultVal: item.url || item.b64_json || '',
      resultFormat: item.url ? 'url' : 'base64',
      raw: res.json,
    }
  } else if (protocol === 'bfl-flux') {
    const submitUrl = joinUrl(catCfg.baseUrl || 'https://api.bfl.ai', catCfg.endpoint || '/v1/flux-pro-1.1')
    const width = aspectRatio === '9:16' ? 768 : aspectRatio === '1:1' ? 1024 : 1344
    const height = aspectRatio === '9:16' ? 1344 : aspectRatio === '1:1' ? 1024 : 768
    const sub = await fetchJsonChecked(
      fetchFn,
      submitUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-key': apiKey },
        body: JSON.stringify({ prompt: cleanPrompt, width, height }),
        signal,
      },
      'BFL Flux',
    )
    const taskId = sub.json?.id
    if (!taskId) throw new Error('BFL Flux 未返回任务 id')
    const pollBase = joinUrl(catCfg.baseUrl || 'https://api.bfl.ai', `/v1/get_result?id=${encodeURIComponent(taskId)}`)
    for (let i = 0; i < maxPolls; i++) {
      const pr = await fetchJsonChecked(fetchFn, pollBase, { method: 'GET', headers: { 'x-key': apiKey }, signal }, 'BFL Flux Poll')
      if (pr.json?.status === 'Ready' && pr.json?.result?.sample) {
        extracted = { resultVal: pr.json.result.sample, resultFormat: 'url', raw: pr.json }
        break
      }
      if (['Error', 'Request Moderated', 'Content Moderated'].includes(pr.json?.status)) {
        throw new Error(`BFL Flux 生成失败: ${pr.json.status}`)
      }
      await sleepMs(pollIntervalMs, signal)
    }
  } else if (protocol === 'fal-image') {
    const url = joinUrl(catCfg.baseUrl || 'https://fal.run', catCfg.endpoint || `/${vars.model || 'fal-ai/flux/schnell'}`)
    const imageSize = aspectRatio === '9:16' ? 'portrait_16_9' : aspectRatio === '1:1' ? 'square_hd' : 'landscape_16_9'
    const res = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` },
        body: JSON.stringify({ prompt: cleanPrompt, image_size: imageSize, num_images: 1 }),
        signal,
      },
      'Fal.ai Flux',
    )
    extracted = { resultVal: res.json?.images?.[0]?.url || '', resultFormat: 'url', raw: res.json }
  } else if (protocol === 'kling-image') {
    const url = joinUrl(catCfg.baseUrl || 'https://api.klingai.com', catCfg.endpoint || '/v1/images/generations')
    const auth = buildKlingAuthHeader(apiKey)
    const sub = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ model_name: vars.model || 'kling-v2', prompt: cleanPrompt, aspect_ratio: aspectRatio, n: 1 }),
        signal,
      },
      'Kling Image',
    )
    const taskId = sub.json?.data?.task_id
    if (!taskId) throw new Error(`Kling Image 未返回 task_id: ${JSON.stringify(sub.json).slice(0, 200)}`)
    const pollUrl = `${url}/${encodeURIComponent(taskId)}`
    for (let i = 0; i < maxPolls; i++) {
      const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: auth }, signal }, 'Kling Image Poll')
      const st = pr.json?.data?.task_status
      if (st === 'succeeded') {
        extracted = { resultVal: pr.json?.data?.task_result?.images?.[0]?.url || '', resultFormat: 'url', raw: pr.json }
        break
      }
      if (st === 'failed') throw new Error(`Kling Image 任务失败: ${pr.json?.data?.task_status_msg || 'failed'}`)
      await sleepMs(pollIntervalMs, signal)
    }
  } else if (protocol === 'volcengine-seedance') {
    const url = joinUrl(catCfg.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3', catCfg.endpoint || '/contents/generations/tasks')
    const contentArr = [{ type: 'text', text: `${cleanPrompt} --ratio ${aspectRatio} --duration ${Math.max(4, Math.min(12, Math.round(Number(durationSec) || 5)))}` }]
    if (imageUrl) contentArr.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'first_frame' })
    onProgress?.({ stage: 'cloud-submit', progress: 20, message: `正在提交火山方舟 Seedance 视频任务 (${vars.model})...` })
    const sub = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: vars.model || 'doubao-seedance-2-5-260628', content: contentArr }),
        signal,
      },
      'Volcengine Seedance',
    )
    const taskId = sub.json?.id
    if (!taskId) throw new Error(`Volcengine Seedance 未返回任务 id: ${JSON.stringify(sub.json).slice(0, 200)}`)
    const pollUrl = `${url}/${encodeURIComponent(taskId)}`
    for (let i = 0; i < maxPolls; i++) {
      onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 26 + i * 2), message: `火山方舟 Seedance 渲染中 (${taskId} · 第 ${i + 1} 次查询)...` })
      const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'Seedance Poll')
      if (pr.json?.status === 'succeeded') {
        extracted = { resultVal: pr.json?.content?.video_url || pr.json?.video_url || '', resultFormat: 'url', raw: pr.json }
        break
      }
      if (['failed', 'cancelled', 'expired'].includes(pr.json?.status)) {
        throw new Error(`Seedance 视频任务失败: ${pr.json?.error?.message || pr.json?.status}`)
      }
      await sleepMs(pollIntervalMs, signal)
    }
  } else if (protocol === 'kling-video') {
    const ep = imageUrl ? '/v1/videos/image2video' : (catCfg.endpoint || '/v1/videos/text2video')
    const url = joinUrl(catCfg.baseUrl || 'https://api.klingai.com', ep)
    const auth = buildKlingAuthHeader(apiKey)
    const payload = {
      model_name: vars.model || 'kling-v2-6',
      prompt: cleanPrompt,
      duration: String(Number(durationSec) >= 8 ? 10 : 5),
      aspect_ratio: aspectRatio,
      mode: 'std',
      ...(imageUrl ? { image: imageUrl } : {}),
    }
    onProgress?.({ stage: 'cloud-submit', progress: 20, message: `正在提交可灵 Kling 视频任务 (${payload.model_name})...` })
    const sub = await fetchJsonChecked(
      fetchFn,
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(payload), signal },
      'Kling Video',
    )
    const taskId = sub.json?.data?.task_id
    if (!taskId) throw new Error(`Kling Video 未返回 task_id: ${JSON.stringify(sub.json).slice(0, 200)}`)
    const pollUrl = `${url}/${encodeURIComponent(taskId)}`
    for (let i = 0; i < maxPolls; i++) {
      onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 26 + i * 2), message: `可灵 Kling 生成中 (${taskId} · 第 ${i + 1} 次查询)...` })
      const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: auth }, signal }, 'Kling Poll')
      const st = pr.json?.data?.task_status
      if (st === 'succeeded') {
        extracted = { resultVal: pr.json?.data?.task_result?.videos?.[0]?.url || '', resultFormat: 'url', raw: pr.json }
        break
      }
      if (st === 'failed') throw new Error(`Kling 视频任务失败: ${pr.json?.data?.task_status_msg || 'failed'}`)
      await sleepMs(pollIntervalMs, signal)
    }
  } else if (protocol === 'minimax-hailuo') {
    const base = catCfg.baseUrl || 'https://api.minimaxi.com'
    const url = joinUrl(base, catCfg.endpoint || '/v1/video_generation')
    const sub = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: vars.model || 'MiniMax-Hailuo-02', prompt: cleanPrompt, ...(imageUrl ? { first_frame_image: imageUrl } : {}) }),
        signal,
      },
      'MiniMax Hailuo',
    )
    const taskId = sub.json?.task_id
    if (!taskId) throw new Error(`MiniMax 海螺未返回 task_id: ${JSON.stringify(sub.json).slice(0, 200)}`)
    const pollUrl = joinUrl(base, `/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`)
    for (let i = 0; i < maxPolls; i++) {
      const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'MiniMax Hailuo Poll')
      if (pr.json?.status === 'Success' && pr.json?.file_id) {
        const retUrl = joinUrl(base, `/v1/files/retrieve?file_id=${encodeURIComponent(pr.json.file_id)}`)
        const fr = await fetchJsonChecked(fetchFn, retUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'MiniMax File Retrieve')
        extracted = { resultVal: fr.json?.file?.download_url || '', resultFormat: 'url', raw: fr.json }
        break
      }
      if (pr.json?.status === 'Fail') throw new Error(`MiniMax 海螺任务失败: ${pr.json?.base_resp?.status_msg || 'Fail'}`)
      await sleepMs(pollIntervalMs, signal)
    }
  } else if (protocol === 'openai-video') {
    const url = joinUrl(catCfg.baseUrl || 'https://api.openai.com/v1', catCfg.endpoint || '/videos/generations')
    const res = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: vars.model || 'sora-2', prompt: cleanPrompt, duration: Number(durationSec) || 5, aspect_ratio: aspectRatio }),
        signal,
      },
      'OpenAI Video',
    )
    const directUrl = res.json?.data?.[0]?.url || res.json?.video_url || res.json?.url
    if (directUrl) {
      extracted = { resultVal: directUrl, resultFormat: 'url', raw: res.json }
    } else if (res.json?.id) {
      const pollUrl = `${url}/${encodeURIComponent(res.json.id)}`
      for (let i = 0; i < maxPolls; i++) {
        const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'OpenAI Video Poll')
        const u = pr.json?.data?.[0]?.url || pr.json?.video_url || pr.json?.output?.url
        if (u) {
          extracted = { resultVal: u, resultFormat: 'url', raw: pr.json }
          break
        }
        if (['failed', 'error'].includes(String(pr.json?.status || '').toLowerCase())) {
          throw new Error(`云端视频生成失败: ${pr.json?.error?.message || pr.json?.status}`)
        }
        await sleepMs(pollIntervalMs, signal)
      }
    }
  } else if (protocol === 'suno-music') {
    const base = catCfg.baseUrl || 'https://api.sunoapi.org'
    const submitUrl = joinUrl(base, catCfg.endpoint || '/suno/submit/music')
    const payload = {
      prompt: String(lyrics || '').trim() || cleanPrompt,
      gpt_description_prompt: cleanPrompt,
      tags: vars.tags,
      title: vars.title,
      mv: vars.model || 'chirp-v4-5',
      make_instrumental: Boolean(instrumental),
    }
    onProgress?.({ stage: 'cloud-submit', progress: 22, message: `正在提交 Suno AI 音乐生成任务 (${payload.mv})...` })
    const sub = await fetchJsonChecked(
      fetchFn,
      submitUrl,
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload), signal },
      'Suno Music API',
    )
    const directAudio = sub.json?.audio_url || sub.json?.data?.[0]?.audio_url
    if (directAudio) {
      extracted = { resultVal: directAudio, resultFormat: 'url', raw: sub.json }
    } else {
      const taskId = sub.json?.data?.task_id || sub.json?.data || sub.json?.id || sub.json?.task_id
      if (!taskId || typeof taskId !== 'string') {
        throw new Error(`Suno API 未返回任务 ID: ${JSON.stringify(sub.json).slice(0, 220)}`)
      }
      const pollUrl = joinUrl(base, `/suno/fetch/${encodeURIComponent(taskId)}`)
      for (let i = 0; i < maxPolls; i++) {
        onProgress?.({ stage: 'cloud-poll', progress: Math.min(88, 28 + i * 2), message: `Suno AI 编曲渲染中 (${taskId} · 第 ${i + 1} 次查询)...` })
        const pr = await fetchJsonChecked(fetchFn, pollUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }, 'Suno Poll')
        const clips = Array.isArray(pr.json?.data?.data) ? pr.json.data.data : Array.isArray(pr.json?.data) ? pr.json.data : [pr.json?.data || pr.json]
        const readyClip = clips.find((c) => c?.audio_url && (!c?.status || ['complete', 'completed', 'SUCCESS', 'succeeded'].includes(String(c.status))))
        if (readyClip?.audio_url) {
          extracted = { resultVal: readyClip.audio_url, resultFormat: 'url', raw: pr.json }
          break
        }
        const st = String(pr.json?.data?.status || pr.json?.status || '').toUpperCase()
        if (['FAILURE', 'FAILED', 'ERROR'].includes(st)) {
          throw new Error(`Suno 音乐生成失败: ${pr.json?.data?.fail_reason || st}`)
        }
        await sleepMs(pollIntervalMs, signal)
      }
    }
  } else if (protocol === 'minimax-music') {
    const url = joinUrl(catCfg.baseUrl || 'https://api.minimaxi.com', catCfg.endpoint || '/v1/music_generation')
    onProgress?.({ stage: 'cloud-submit', progress: 35, message: `正在调用 MiniMax 音乐大模型 (${vars.model || 'music-2.0'})...` })
    const res = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: vars.model || 'music-2.0',
          prompt: cleanPrompt,
          lyrics: vars.lyrics,
          audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
        }),
        signal,
      },
      'MiniMax Music',
    )
    if (res.json?.base_resp?.status_code && res.json.base_resp.status_code !== 0) {
      throw new Error(`MiniMax Music 失败: ${res.json.base_resp.status_msg || res.json.base_resp.status_code}`)
    }
    const audioVal = res.json?.data?.audio || res.json?.data?.audio_url || res.json?.audio_url || ''
    extracted = {
      resultVal: audioVal,
      resultFormat: /^https?:\/\//i.test(String(audioVal)) ? 'url' : 'hex',
      raw: res.json,
    }
  } else if (protocol === 'minimax-speech') {
    const url = joinUrl(catCfg.baseUrl || 'https://api.minimaxi.com', catCfg.endpoint || '/v1/t2a_v2')
    const res = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: vars.model || 'speech-02-hd',
          text: cleanPrompt,
          stream: false,
          voice_setting: { voice_id: 'male-qn-qingse', speed: 1.0, vol: 1.0, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
        }),
        signal,
      },
      'MiniMax Speech',
    )
    if (res.json?.base_resp?.status_code && res.json.base_resp.status_code !== 0) {
      throw new Error(`MiniMax Speech 失败: ${res.json.base_resp.status_msg || res.json.base_resp.status_code}`)
    }
    const audioVal = res.json?.data?.audio || ''
    extracted = {
      resultVal: audioVal,
      resultFormat: /^https?:\/\//i.test(String(audioVal)) ? 'url' : 'hex',
      raw: res.json,
    }
  } else if (protocol === 'elevenlabs-sfx') {
    const url = joinUrl(catCfg.baseUrl || 'https://api.elevenlabs.io', catCfg.endpoint || '/v1/sound-generation')
    const res = await fetchJsonChecked(
      fetchFn,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify({ text: cleanPrompt, duration_seconds: Math.max(0.5, Math.min(22, Number(durationSec) || 5)) }),
        signal,
      },
      'ElevenLabs SFX',
    )
    extracted = { resultVal: res.binary || res.json?.audio_url || '', resultFormat: res.binary ? 'binary' : 'url', raw: res.json || {} }
  } else {
    throw new Error(`不支持的云端协议类型: ${protocol}`)
  }

  if (!extracted || !extracted.resultVal) {
    throw new Error(`云端 ${category} 生成任务未返回有效结果`)
  }

  const targetRoot = projectDir ? resolve(projectDir) : join(REPO_ROOT, '.tmp', 'cloud-media-sandbox')
  const outSubdir = category === 'audio' ? join('assets', 'audio') : category === 'video' ? join('assets', 'videos') : join('assets', 'images')
  const outDir = join(targetRoot, outSubdir)
  const baseName = `cloud-${catCfg.providerId || category}-${Date.now()}`

  onProgress?.({ stage: 'cloud-save', progress: 92, message: '正在下载并保存云端生成素材到本地工程...' })
  const savedAbs = await materializeOutputAsset({
    fetchFn,
    resultVal: extracted.resultVal,
    resultFormat: extracted.resultFormat,
    outDir,
    baseName,
    defaultExt,
    signal,
  })
  const savedRel = savedAbs.slice(targetRoot.length + 1).replace(/\\/g, '/')

  let registeredAsset = null
  let beatMeta = null
  if (projectDir && existsSync(join(targetRoot, 'script.json'))) {
    const manifest = readAssets(targetRoot)
    const assetId = `cloud-${category}-${Date.now().toString(36)}`
    registeredAsset = {
      id: assetId,
      name: `${vars.title || catCfg.providerId} (云端AI生成)`,
      originalName: `${baseName}${extname(savedAbs)}`,
      path: savedRel,
      type: category === 'audio' ? 'audio' : category === 'video' ? 'video' : 'image',
      role: category === 'audio' ? 'music' : 'visual',
      source: `cloud:${catCfg.providerId}`,
      prompt: cleanPrompt,
      importedAt: new Date().toISOString(),
    }
    manifest.items = [...(manifest.items || []), registeredAsset]
    writeAssets(targetRoot, manifest)

    if (autoBindToScript) {
      const { data } = readScriptJson(targetRoot)
      if (category === 'audio') {
        try {
          beatMeta = await analyzeAudioBeatStructure(savedAbs, { signal })
        } catch {}
        data.bgmMode = 'uploaded'
        data.bgm = {
          ...(data.bgm || {}),
          ...(beatMeta || {}),
          enabled: true,
          mode: 'uploaded',
          source: `cloud:${catCfg.providerId}`,
          path: savedRel,
          uploadedPath: savedRel,
        }
        writeScriptJson(targetRoot, data)
      } else if (sceneId && Array.isArray(data.scenes)) {
        const sc = data.scenes.find((s) => s.id === sceneId)
        if (sc) {
          sc.media = [{ assetId, path: savedRel, type: category, source: `cloud:${catCfg.providerId}` }]
          sc.mediaPath = savedRel
          sc.mediaType = category
          writeScriptJson(targetRoot, data)
        }
      }
    }
  }

  onProgress?.({ stage: 'done', progress: 100, message: `✅ 云端 ${category} 素材生成并入库完成：${savedRel}` })
  return {
    ok: true,
    category,
    providerId: catCfg.providerId,
    protocol,
    path: savedRel,
    absolutePath: savedAbs,
    asset: registeredAsset,
    beatMeta,
  }
}
