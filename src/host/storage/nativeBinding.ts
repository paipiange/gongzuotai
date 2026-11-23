import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

/**
 * better-sqlite3 native 绑定加载器（彻底免安装期编译版）。
 *
 * 背景：better-sqlite3 的官方 prebuild 只覆盖标准 Node.js ABI，从不发布 Electron 版。
 * dsh 桌面端是 Electron（本机主程序 Electron 44.7.0 / ABI 149），因此安装时
 * `prebuild-install` 找不到匹配二进制、fallback 到 `node-gyp` 源码编译——而用户机器
 * 通常没有 C++ 工具链（Windows 缺 VS Build Tools，macOS 缺 Xcode CLT），导致安装失败。
 *
 * 根治方案：把 better-sqlite3 的**纯 JS wrapper**（lib/*.js，仅 52KB）vendor 进插件
 * `src/host/vendor/better-sqlite3/`，连同针对 dsh Electron ABI 编译好的 `.node` 二进制
 * （`lib/native/{platform}-{arch}/better_sqlite3.node`）一起分发。运行时**完全不依赖
 * npm 上的 better-sqlite3**，从 package.json 中彻底移除该依赖，安装期不会触发任何
 * native 编译或 prebuild 下载，根治「别的机器装报 node-gyp not ok」。
 *
 * wrapper 通过 `options.nativeBinding` 显式加载内置二进制；vendor 时已移除它对
 * `bindings` 包的外部依赖（见 vendor/better-sqlite3/lib/database.js 顶部注释）。
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

/**
 * 定位 vendor 的 better-sqlite3 JS wrapper 入口（lib/index.cjs）。
 * 编译态：`lib/vendor/better-sqlite3/lib/index.cjs`；
 * 源码态：`src/host/vendor/better-sqlite3/lib/index.cjs`。
 */
function vendorWrapperEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'vendor', 'better-sqlite3', 'lib', 'index.cjs'),              // 编译态 lib/vendor（本模块打进 lib/index.js，here 即 lib/）
    join(here, '..', 'vendor', 'better-sqlite3', 'lib', 'index.cjs'),        // 源码态 src/host/storage -> src/host/vendor
    join(here, '..', '..', 'vendor', 'better-sqlite3', 'lib', 'index.cjs'),  // 兜底：再上溯一级
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error('better-sqlite3 vendor wrapper not found')
}

type DatabaseConstructor = new (filename: string, options?: Record<string, unknown>) => unknown

/**
 * 加载 better-sqlite3 Database 构造函数。
 *
 * 策略（两层）：
 *  1. **生产态（dsh 桌面端 / Electron ABI 149）**：用 vendor 的 JS wrapper + 内置的
 *     Electron ABI 二进制（nativeBinding），完全不依赖 npm 依赖树。
 *  2. **测试/开发态（标准 Node）**：内置二进制是 Electron ABI，在标准 Node 下会
 *     `NODE_MODULE_VERSION mismatch`。此时 fallback 到 devDependencies 里的
 *     better-sqlite3（标准 Node ABI，本机测试环境已编译好）。
 *
 * 这样终端用户安装时 package.json 的 dependencies 里没有 better-sqlite3，安装期零编译；
 * 本机开发/测试又不受影响。
 */
export function loadBetterSqlite3(): DatabaseConstructor {
  // 1. 生产态：内置 Electron ABI 二进制 + vendor wrapper。
  const bundled = bundledNativePath()
  if (bundled) {
    try {
      const wrapper = requireCjs(vendorWrapperEntry()) as DatabaseConstructor
      // 冒烟：用内置 nativeBinding 构造 :memory:，确认 wrapper 与二进制 ABI 匹配。
      const probe = new wrapper(':memory:', { nativeBinding: bundled }) as { close?: () => void }
      probe.close?.()
      // 返回始终绑定内置二进制的构造包装。
      const Bound = function BoundDatabase(filename: string, options?: Record<string, unknown>) {
        return new wrapper(filename, { ...options, nativeBinding: bundled })
      }
      Object.setPrototypeOf(Bound, wrapper)
      return Bound as unknown as DatabaseConstructor
    } catch (err) {
      // ABI 不匹配（标准 Node 测试态）→ 落到 fallback。
      if (process.env.PAIPIANGE_DEBUG_NATIVE) {
        console.warn('[paipiange] bundled native binding failed, fallback to dev dependency:', (err as Error).message)
      }
    }
  }

  // 2. 测试/开发态：devDependencies 里的 better-sqlite3（标准 Node ABI）。
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
        '且开发依赖里的 better-sqlite3 也未编译成功。' +
        '请检查：1) 是否用 dsh 桌面端加载本插件（而非普通 Node）；' +
        '2) 若为源码安装，请先安装编译工具链后重装依赖。原始错误：' +
        detail,
    )
  }
}

/** better-sqlite3 的 SqliteError 类型（供上层捕获/判断）。 */
export function loadSqliteError(): unknown {
  // 优先从 vendor wrapper 取；失败则回退 dev 依赖。
  try {
    return (requireCjs(vendorWrapperEntry()) as { SqliteError?: unknown }).SqliteError
  } catch {
    return (requireCjs('better-sqlite3') as { SqliteError?: unknown }).SqliteError
  }
}
