import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 发布打包完整性测试：验证 package.json 的发布契约与构建产物结构，
// 确保 `pnpm pack` 产出的 tarball 能被 DeepSeek Harness 正确安装与加载。

const here = dirname(fileURLToPath(import.meta.url))
// src/host/package.test.ts -> src/host -> src -> project root
const projectRoot = resolve(here, '..', '..')

interface PackageJson {
  name: string
  version: string
  main: string
  exports: Record<string, string>
  files: string[]
  dsh: {
    bundle: { patch: string }
    client: { inject: string[]; platform: string }
  }
  dependencies: Record<string, string>
}

function readPackage(): PackageJson {
  return JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
}

describe('publish packaging contract', () => {
  it('exposes host entry and client entry through exports', () => {
    const pkg = readPackage()
    expect(pkg.main).toBe('./lib/index.js')
    expect(pkg.exports['.']).toBe('./lib/index.js')
    expect(pkg.exports['./client']).toBe('./lib/client.js')
  })

  it('declares a dsh bundle patch and web client inject', () => {
    const pkg = readPackage()
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client.platform).toBe('web')
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-sidebar')
  })

  it('ships only the lib, patch, readme and changelog in the tarball', () => {
    const pkg = readPackage()
    // 不把 src、测试、本地预览产物 dist 打进去，避免泄露源码与用户数据。
    expect(pkg.files).toEqual(['lib', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md'])
  })

  it('keeps better-sqlite3 as an external dependency so its native binding resolves', () => {
    const pkg = readPackage()
    expect(pkg.dependencies['better-sqlite3']).toBeTruthy()
    // better-sqlite3 是原生依赖，不能在打包时内联，必须留给安装器重建 ABI。
    expect(pkg.dependencies['@deepseek-ai/cordis']).toBeTruthy()
  })
})
