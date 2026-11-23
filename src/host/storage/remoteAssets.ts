import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * 远程资源按需下载 + 本地缓存。
 *
 * 背景：插件 tarball 原本把字体、模板封面、参考图等约 30MB 的静态资源直接打包分发，
 * 导致安装体积大、下载慢。这些资源都是「运行时从磁盘读取、内容静态不变」的文件，
 * 因此改为：默认只随包分发一个轻量「资源清单」，运行时首次用到某资源时从远程拉取，
 * 落盘到本地缓存目录，之后永久复用，实现「瘦包 + 按需下载」。
 *
 * 托管源：GitHub 公开仓库（paipiange/gongzuotai）的 raw 地址，支持多镜像 fallback，
 * 并允许通过环境变量覆盖镜像（例如内网/自建 CDN）。
 */

/** 资源清单里单条资源的描述。 */
export interface RemoteAssetSpec {
  /** 远程 URL 相对路径（相对镜像 base，即 git 仓库内实际路径，如 `src/host/assets/...`）。 */
  urlPath: string
  /** 本地缓存相对路径（相对缓存根，如 `assets/template-covers/xhs_grass.jpg`）。 */
  cachePath: string
  /** 期望的 sha256，用于校验下载完整性；未提供则跳过校验。 */
  sha256?: string
}

/**
 * 下载镜像列表，按优先级从高到低。运行时若 `PAIPIANGE_CDN` 环境变量存在，则置顶。
 * 默认走 GitHub raw，附带 jsDelivr 作为备用（对国内/海外网络各有兜底）。
 */
function resolveMirrors(): string[] {
  const custom = process.env.PAIPIANGE_CDN
  const defaults = [
    'https://raw.githubusercontent.com/paipiange/gongzuotai/main',
    'https://cdn.jsdelivr.net/gh/paipiange/gongzuotai@main',
  ]
  if (custom) {
    const trimmed = custom.replace(/\/+$/, '')
    return [trimmed, ...defaults]
  }
  return defaults
}

const CACHE_DIR_NAME = 'assets-cache'

/** 返回远程资源本地缓存根目录（在 paipiange 数据目录下）。 */
export function remoteAssetCacheRoot(dataRoot: string): string {
  return join(dataRoot, CACHE_DIR_NAME)
}

/** 把相对 cachePath 安全地映射到缓存根目录内的绝对路径，防路径穿越。 */
function cachePathFor(root: string, cachePath: string): string {
  if (!cachePath || cachePath.startsWith('/') || cachePath.includes('..')) {
    throw new Error(`Invalid remote asset cache path: ${cachePath}`)
  }
  const target = join(root, ...cachePath.split('/'))
  if (!target.startsWith(root)) throw new Error(`Remote asset cache path escapes root: ${cachePath}`)
  return target
}

function sha256Of(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** 单文件下载（超时 30s），成功返回 Buffer，失败抛错。 */
async function fetchOnce(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    const buf = Buffer.from(await res.arrayBuffer())
    return buf
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 确保某个远程资源已就位：缓存命中直接返回本地路径；否则按镜像顺序下载，
 * 校验 sha256（若提供），原子落盘后返回路径。全部镜像失败则抛错。
 */
export async function ensureRemoteAsset(
  dataRoot: string,
  spec: RemoteAssetSpec,
): Promise<string> {
  const root = remoteAssetCacheRoot(dataRoot)
  const target = cachePathFor(root, spec.cachePath)

  if (existsSync(target)) {
    if (!spec.sha256) return target
    const existing = readFileSync(target)
    if (sha256Of(existing) === spec.sha256) return target
    // 校验不通过视为脏缓存，走重新下载
  }

  mkdirSync(dirname(target), { recursive: true })
  const mirrors = resolveMirrors()
  let lastErr: unknown = null

  for (const mirror of mirrors) {
    const url = `${mirror}/${spec.urlPath}`
    try {
      const buf = await fetchOnce(url)
      if (spec.sha256 && sha256Of(buf) !== spec.sha256) {
        lastErr = new Error(`sha256 mismatch for ${spec.cachePath} from ${mirror}`)
        continue
      }
      // 原子写：先写临时文件再 rename，避免并发/中断留下半截文件
      const tmp = `${target}.${process.pid}.tmp`
      const stream = createWriteStream(tmp)
      await new Promise<void>((resolve, reject) => {
        stream.on('error', reject)
        stream.on('finish', resolve)
        stream.end(buf)
      })
      // 简单原子替换（同盘 rename 原子性足够）
      const { renameSync } = require('node:fs')
      renameSync(tmp, target)
      return target
    } catch (err) {
      lastErr = err
    }
  }

  throw new Error(`Failed to fetch remote asset ${spec.cachePath}: ${String(lastErr)}`)
}

/**
 * 同步版就位检查：若缓存已命中返回路径，否则返回 null（调用方据此决定是否异步下载）。
 * 用于不便 await 的场景（如 seed 流程里希望失败时静默降级）。
 */
export function remoteAssetIfCached(dataRoot: string, spec: RemoteAssetSpec): string | null {
  const root = remoteAssetCacheRoot(dataRoot)
  const target = cachePathFor(root, spec.cachePath)
  if (!existsSync(target)) return null
  if (spec.sha256 && sha256Of(readFileSync(target)) !== spec.sha256) return null
  return target
}
