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

export default defineConfig([
  {
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    clean: true,
    dts: true,
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
  },
])
