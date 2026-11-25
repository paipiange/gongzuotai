import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

// 注入包名 + 版本号：client 端 __ModuleLoader__.load 的 id 必须等于 package name，
// 否则市场安装「paipiange」裸名包时，dsh 按 entry 名「paipiange」对账、却收到 id「dsh-paipiange」，
// 两边对不上 → client 模块无法物化 → 侧边栏 tab 不显示。版本号同理，避免多处硬编码漂移。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string; version: string }

function rawPlugin() {
  return {
    name: 'paipiange-raw-loader',
    async load(id: string) {
      if (!id.endsWith('?raw')) return null
      const source = await readFile(id.slice(0, -4), 'utf8')
      return { code: `export default ${JSON.stringify(source)}`, moduleType: 'js' as const }
    },
  }
}

/**
 * 把 `src/host/assets/` 下的内置资源拷到 `lib/assets/`，随插件包分发。
 *
 * 体积优化：`couple-comic/` 与 `template-covers/` 两个大图目录（约 22MB）已改为
 * 运行时按需下载（见 src/host/storage/remoteAssets.ts），不再打进 tarball；
 * 这里只拷贝轻量的 `styles.json`（供 videogen 样式库读取）。
 *
 * tsdown 无内置 copy 能力，这里用 writeBundle 钩子在产物落地后补一次拷贝。
 */
function copyAssetsPlugin() {
  const projectRoot = dirname(fileURLToPath(import.meta.url))
  const sourceDir = join(projectRoot, 'src/host/assets')
  const targetDir = 'assets'
  // 排除改为远程下载/远程引用的图片目录（保持打包瘦身）
  // couple-comic / template-covers：host 侧 remoteAssets 按需下载缓存
  // carousel：首页轮播图，前端 jsDelivr 直接引用（defaultCarousel.ts），不打进 tarball
  const EXCLUDE_DIRS = new Set(['couple-comic', 'template-covers', 'carousel'])
  return {
    name: 'paipiange-copy-assets',
    writeBundle() {
      const outDir = join(projectRoot, 'lib')
      if (!existsSync(sourceDir)) return
      const copy = (src: string, dst: string) => {
        if (!existsSync(src)) return
        const files = readdirSync(src)
        for (const f of files) {
          const s = join(src, f)
          const d = join(dst, f)
          if (statSync(s).isDirectory()) {
            if (EXCLUDE_DIRS.has(f)) continue
            mkdirSync(d, { recursive: true })
            copy(s, d)
          } else {
            mkdirSync(dirname(d), { recursive: true })
            copyFileSync(s, d)
          }
        }
      }
      copy(sourceDir, join(outDir, targetDir))
    },
  }
}

/**
 * 把 `src/host/native/` 下的预编译原生二进制（better-sqlite3 的 Electron ABI .node）
 * 拷到 `lib/native/`，随插件包分发。dsh 桌面端是 Electron，其 ABI 与标准 Node 不同，
 * better-sqlite3 官方 prebuild 从不覆盖 Electron，导致用户机器 npm 安装时 node-gyp
 * 源码编译失败；内置二进制可在运行时经 `nativeBinding` 直接加载，免除安装期编译。
 */
function copyNativePlugin() {
  const projectRoot = dirname(fileURLToPath(import.meta.url))
  const sourceDir = join(projectRoot, 'src/host/native')
  const targetDir = 'native'
  return {
    name: 'paipiange-copy-native',
    writeBundle() {
      const outDir = join(projectRoot, 'lib')
      if (!existsSync(sourceDir)) return
      const copy = (src: string, dst: string) => {
        if (!existsSync(src)) return
        const files = readdirSync(src)
        for (const f of files) {
          const s = join(src, f)
          const d = join(dst, f)
          if (statSync(s).isDirectory()) {
            mkdirSync(d, { recursive: true })
            copy(s, d)
          } else {
            mkdirSync(dirname(d), { recursive: true })
            copyFileSync(s, d)
          }
        }
      }
      copy(sourceDir, join(outDir, targetDir))
    },
  }
}

/**
 * 把 vendored 的 better-sqlite3 纯 JS wrapper 拷到 `lib/vendor/better-sqlite3/`，随插件包分发。
 * wrapper 是 CJS（`module.exports = require('./database')`），运行时由 nativeBinding.ts 经
 * `createRequire` 动态加载，配合内置的 Electron ABI 二进制（lib/native）使用，完全免除
 * 安装期对 npm better-sqlite3 的依赖（避免其 install 脚本触发 node-gyp 编译失败）。
 */
function copyVendorPlugin() {
  const projectRoot = dirname(fileURLToPath(import.meta.url))
  const sourceDir = join(projectRoot, 'src/host/vendor/better-sqlite3')
  return {
    name: 'paipiange-copy-vendor',
    writeBundle() {
      const outDir = join(projectRoot, 'lib')
      if (!existsSync(sourceDir)) return
      const copy = (src: string, dst: string) => {
        if (!existsSync(src)) return
        const files = readdirSync(src)
        for (const f of files) {
          const s = join(src, f)
          const d = join(dst, f)
          if (statSync(s).isDirectory()) {
            mkdirSync(d, { recursive: true })
            copy(s, d)
          } else {
            mkdirSync(dirname(d), { recursive: true })
            copyFileSync(s, d)
          }
        }
      }
      copy(sourceDir, join(outDir, 'vendor', 'better-sqlite3'))
    },
  }
}

/**
 * 把 vendored 的 dsh-video 双引擎（Remotion + Three.js）原样拷到 `lib/videoEngine/`。
 * 引擎是纯 ESM JS（含 `import.meta.url`、`createRequire`、动态 import、.py 脚本、
 * 字体与影核广场模板），必须按目录结构落盘，由 remotionEngine.ts 在运行时动态 import，
 * 不能打进 bundle（否则 `import.meta.url` 指向 lib/index.js，路径解析全部失效）。
 *
 * 体积优化：`packages/shared/fonts/` 里的两个 WOFF2 字体（约 9MB）改为运行时按需
 * 下载（remotionEngine.ts 预下载后经 PAIPIANGE_FONTS_DIR 注入），此处排除不拷贝。
 */
function copyVideoEnginePlugin() {
  const projectRoot = dirname(fileURLToPath(import.meta.url))
  const sourceDir = join(projectRoot, 'src/host/videoEngine')
  return {
    name: 'paipiange-copy-video-engine',
    writeBundle() {
      const outDir = join(projectRoot, 'lib')
      if (!existsSync(sourceDir)) return
      const copy = (src: string, dst: string) => {
        if (!existsSync(src)) return
        const files = readdirSync(src)
        for (const f of files) {
          const s = join(src, f)
          const d = join(dst, f)
          if (statSync(s).isDirectory()) {
            mkdirSync(d, { recursive: true })
            copy(s, d)
          } else {
            // 排除字体文件（运行时按需下载），但保留 LICENSES.md 等轻量文件
            if (f.endsWith('.woff2') && src.endsWith(join('packages', 'shared', 'fonts'))) continue
            mkdirSync(dirname(d), { recursive: true })
            copyFileSync(s, d)
          }
        }
      }
      copy(sourceDir, join(outDir, 'videoEngine'))
    },
  }
}

const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
]

const hostExternals = [
  // vendored dsh-video 引擎：运行时由 remotionEngine.ts 动态 import（copy 到 lib/videoEngine），
  // 不能打进 bundle。这里把整个目录路径 external，避免 tsdown 尝试编译其 ESM 源码。
  /videoEngine[\\/]/,
  // vendored better-sqlite3 JS wrapper：运行时由 nativeBinding.ts 经 createRequire 动态
  // 加载（copy 到 lib/vendor），不能打进 bundle。
  /vendor[\\/]better-sqlite3[\\/]/,
]

export default defineConfig([
  {
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    clean: true,
    dts: true,
    external: hostExternals,
    plugins: [copyAssetsPlugin(), copyNativePlugin(), copyVendorPlugin(), copyVideoEnginePlugin()],
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    clean: false,
    dts: false,
    outExtensions: () => ({ js: '.js' }),
    plugins: [rawPlugin()],
    external: clientExternals,
    // 把 @phosphor-icons/react 打进 bundle（不在 Harness seed 模块表，运行时 require 不到）
    noExternal: ['@phosphor-icons/react'],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    banner: {
      // id 必须等于 package name（构建 dsh-paipiange 时是 dsh-paipiange，构建 paipiange 时是 paipiange），
      // 否则双包发布（publish-dual.cjs 只改文本文件、不改 lib 产物）会导致裸名包 client 模块 id 错配。
      js: `window.__ModuleLoader__.load({ id: '${pkg.name}', factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: {
      // 直接返回干净的 { name, inject, apply } 对象，避免 rolldown 的
      // __esModule / default 导出触发 cordis loader 的 unwrapExports interop，
      // 导致 name/inject 字段被剥离（侧边栏不显示的根因）。
      js: `\nreturn { name, inject, apply };\n} });`,
    },
  },
])
