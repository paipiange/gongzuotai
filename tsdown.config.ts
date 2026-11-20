import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

// 注入版本号：让 client 端「检查更新」读 package.json 版本，避免两处硬编码漂移。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

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
 * 把 `src/host/assets/` 下的内置资源（如情侣漫画参考图 PNG）原样拷到 `lib/assets/`，
 * 随插件包分发，供 Host 在 seed 时从磁盘读取写入素材库。
 * tsdown 无内置 copy 能力，这里用 writeBundle 钩子在产物落地后补一次拷贝。
 */
function copyAssetsPlugin() {
  const projectRoot = dirname(fileURLToPath(import.meta.url))
  const sourceDir = join(projectRoot, 'src/host/assets')
  const targetDir = 'assets'
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
 * 把 vendored 的 dsh-video 双引擎（Remotion + Three.js）原样拷到 `lib/videoEngine/`。
 * 引擎是纯 ESM JS（含 `import.meta.url`、`createRequire`、动态 import、.py 脚本、
 * 字体与影核广场模板），必须按目录结构落盘，由 remotionEngine.ts 在运行时动态 import，
 * 不能打进 bundle（否则 `import.meta.url` 指向 lib/index.js，路径解析全部失效）。
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
  'better-sqlite3',
  // vendored dsh-video 引擎：运行时由 remotionEngine.ts 动态 import（copy 到 lib/videoEngine），
  // 不能打进 bundle。这里把整个目录路径 external，避免 tsdown 尝试编译其 ESM 源码。
  /videoEngine[\\/]/,
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
    plugins: [copyAssetsPlugin(), copyVideoEnginePlugin()],
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
      js: `window.__ModuleLoader__.load({ id: 'dsh-paipiange', factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: {
      // 直接返回干净的 { name, inject, apply } 对象，避免 rolldown 的
      // __esModule / default 导出触发 cordis loader 的 unwrapExports interop，
      // 导致 name/inject 字段被剥离（侧边栏不显示的根因）。
      js: `\nreturn { name, inject, apply };\n} });`,
    },
  },
])
