import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

/**
 * better-sqlite3 native 绑定加载器。
 *
 * 背景：better-sqlite3 的官方 prebuild 只覆盖标准 Node.js ABI，从不发布 Electron 版。
 * dsh 桌面端是 Electron（本机主程序 Electron 44.7.0 / ABI 149），因此 `npm install`
 * 时 `prebuild-install` 找不到匹配的 Electron 二进制，会 fallback 到 `node-gyp` 源码
 * 编译——而用户机器通常没有 C++ 工具链（Windows 缺 VS Build Tools，macOS 缺 Xcode CLT），
 * 直接导致安装失败（`node-gyp ... not ok`）。
 *
 * 解法：把针对 dsh Electron ABI 编译好的 `.node` 二进制随插件包分发到
 * `lib/native/{platform}-{arch}/better_sqlite3.node`，运行时按当前平台选取，
 * 通过 better-sqlite3 的 `nativeBinding` 选项显式加载，彻底免除安装期编译。
 *
 * 平台不匹配或内置二进制加载失败时，回退到默认 `require('better-sqlite3')`
 * （用于本机开发态，此时 node_modules 里通常是 node-gyp 编译好的、ABI 匹配的版本）。
 */

const requireCjs = createRequire(import.meta.url)

/** 当前进程的平台 + 架构标识，如 `win32-x64`、`darwin-arm64`。 */
export function currentPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

/**
 * 包内内置二进制目录候选列表。
 * 编译态：本模块被打进 `lib/index.js`，二进制在 `lib/native/`；
 * 源码态（vitest/tsx）：本模块在 `src/host/storage/`，二进制在 `src/host/native/`。
 * 依次探测，命中即用。
 */
function bundledNativeDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  return [
    join(here, 'native'),                    // 编译态 lib/native
    join(here, '..', 'native'),              // 源码态 src/host/native（从 storage 上溯一级）
    join(here, '..', '..', 'native'),        // 兜底：再上溯一级
  ]
}

/** 返回当前平台在包内的内置 .node 路径（若存在），否则 null。 */
export function bundledNativePath(platformKey = currentPlatformKey()): string | null {
  for (const dir of bundledNativeDirs()) {
    const p = join(dir, platformKey, 'better_sqlite3.node')
    if (existsSync(p)) return p
  }
  return null
}

type DatabaseConstructor = new (filename: string, options?: Record<string, unknown>) => unknown

/**
 * 加载一个可用的 better-sqlite3 Database 构造函数。
 *
 * 优先级：
 *  1. 包内内置的 Electron ABI 二进制（`nativeBinding` 显式加载）——覆盖 dsh 桌面端；
 *  2. 默认 `require('better-sqlite3')`（依赖里编译好的版本）——本机开发/测试态；
 *
 * 两者都失败时抛出带排障指引的错误。
 */
export function loadBetterSqlite3(): DatabaseConstructor {
  const bundled = bundledNativePath()
  if (bundled) {
    try {
      // 用 nativeBinding 直接加载包内二进制，构造一个 Database 验证 ABI 匹配。
      const ctor = requireCjs('better-sqlite3') as DatabaseConstructor
      // 通过 new ctor(':memory:', { nativeBinding }) 做一次冒烟，确认 ABI 兼容。
      const probe = new ctor(':memory:', { nativeBinding: bundled }) as { close?: () => void }
      probe.close?.()
      // 冒烟通过：返回一个始终绑定内置二进制的构造包装。
      const Bound = function BoundDatabase(filename: string, options?: Record<string, unknown>) {
        return new ctor(filename, { ...options, nativeBinding: bundled })
      }
      // 保留静态成员（如 SqliteError），便于调用方引用。
      Object.setPrototypeOf(Bound, ctor)
      return Bound as unknown as DatabaseConstructor
    } catch (err) {
      // ABI 不匹配或加载失败 → 落到 fallback，不立即抛错。
      if (process.env.PAIPIANGE_DEBUG_NATIVE) {
        console.warn('[paipiange] bundled better-sqlite3 failed, fallback to dependency:', (err as Error).message)
      }
    }
  }

  // Fallback：依赖里的 better-sqlite3（开发态 node_modules 已按当前 ABI 编译）。
  try {
    const ctor = requireCjs('better-sqlite3') as DatabaseConstructor
    const probe = new ctor(':memory:')
    ;(probe as { close?: () => void }).close?.()
    return ctor
  } catch (err) {
    const detail = (err as Error).message
    throw new Error(
      'better-sqlite3 原生绑定加载失败。' +
        '本插件针对 dsh 桌面端（Electron）内置了预编译二进制，但当前环境无法使用，' +
        '且依赖里的 better-sqlite3 也未编译成功。' +
        '请检查：1) 是否用 dsh 桌面端加载本插件（而非普通 Node）；' +
        '2) 若为源码安装，请先安装编译工具链后重装依赖。原始错误：' +
        detail,
    )
  }
}

/** better-sqlite3 的 SqliteError 类型（供上层捕获/判断）。 */
export function loadSqliteError(): unknown {
  return (requireCjs('better-sqlite3') as { SqliteError?: unknown }).SqliteError
}
