import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { remoteAssetCacheRoot, remoteAssetIfCached, ensureRemoteAsset, type RemoteAssetSpec } from './remoteAssets'

const temporaryRoots: string[] = []

function makeRoot(): string {
  const root = join(tmpdir(), `paipiange-remote-assets-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try {
      // 仅清理测试创建的文件，防御性 try/catch
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('node:fs').rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('remoteAssets', () => {
  it('缓存命中时 remoteAssetIfCached 返回路径', () => {
    const root = makeRoot()
    const cacheRoot = remoteAssetCacheRoot(root)
    const spec: RemoteAssetSpec = { urlPath: 'x/y.png', cachePath: 'assets/a/b.png' }
    const target = join(cacheRoot, 'assets', 'a', 'b.png')
    mkdirSync(join(cacheRoot, 'assets', 'a'), { recursive: true })
    writeFileSync(target, Buffer.from('data'))

    const hit = remoteAssetIfCached(root, spec)
    expect(hit).toBe(target)
    expect(existsSync(target)).toBe(true)
  })

  it('未缓存时 remoteAssetIfCached 返回 null', () => {
    const root = makeRoot()
    const spec: RemoteAssetSpec = { urlPath: 'x/y.png', cachePath: 'assets/missing.png' }
    expect(remoteAssetIfCached(root, spec)).toBeNull()
  })

  it('拒绝路径穿越的 cachePath', () => {
    const root = makeRoot()
    const spec: RemoteAssetSpec = { urlPath: 'x/y.png', cachePath: '../escape.png' }
    expect(() => remoteAssetIfCached(root, spec)).toThrow()
  })

  it('缓存命中但 sha256 不匹配时视为未命中', () => {
    const root = makeRoot()
    const cacheRoot = remoteAssetCacheRoot(root)
    const spec: RemoteAssetSpec = { urlPath: 'x/y.png', cachePath: 'assets/a/b.png', sha256: '0'.repeat(64) }
    const target = join(cacheRoot, 'assets', 'a', 'b.png')
    mkdirSync(join(cacheRoot, 'assets', 'a'), { recursive: true })
    writeFileSync(target, Buffer.from('wrong-content'))

    expect(remoteAssetIfCached(root, spec)).toBeNull()
  })

  it('下载失败时 ensureRemoteAsset 抛错且不污染缓存', async () => {
    const root = makeRoot()
    const spec: RemoteAssetSpec = {
      urlPath: 'definitely/not/exist-404.png',
      cachePath: 'assets/never.png',
      sha256: '0'.repeat(64),
    }
    await expect(ensureRemoteAsset(root, spec)).rejects.toThrow()
    const cacheRoot = remoteAssetCacheRoot(root)
    expect(existsSync(join(cacheRoot, 'assets', 'never.png'))).toBe(false)
  }, 15000)
})
