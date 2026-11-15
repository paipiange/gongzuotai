import { readFile } from 'node:fs/promises'
import { defineConfig } from 'tsdown'

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

const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
]

const hostExternals = [
  'better-sqlite3',
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
