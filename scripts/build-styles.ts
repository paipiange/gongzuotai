/**
 * 拍片哥工作台 · 风格库构建脚本
 *
 * 三个命令：
 *   extract  从 vendor/lemo-opuscar 抽取客观元数据 -> styles.meta.json（中间产物）
 *   pack     合并精写定义 + 元数据兜底 -> dist/styles.json（发行产物）
 *
 * 合规说明：精写定义（definitions*.ts）是原创中文表达；兜底风格仅含客观元数据
 * （名称/分类/适用场景/一句话本质），不含上游 CC BY-NC 的受保护表达。
 *
 * 运行：pnpm tsx scripts/build-styles.ts [extract|pack]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StyleDefinition, StyleLibraryJson } from '../src/host/videogen/styles/types'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const stylesDir = join(root, 'vendor', 'lemo-opuscar', 'styles')
const metaPath = join(root, 'src', 'host', 'videogen', 'styles', 'styles.meta.json')

interface VendorStyle {
  slug: string
  en: string
  cn: string
  category_en: string
  category_cn: string
  uses: string[]
  line_cn: string
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function extract(): void {
  if (!existsSync(stylesDir)) {
    console.error('未找到 vendor/lemo-opuscar/styles，请先 git clone 仓库到 vendor/')
    process.exit(1)
  }
  const entries = []
  const categories = new Map<string, { id: string; en: string; cn: string }>()
  const dirs = readdirSync(stylesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_template')
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const dir of dirs) {
    const jsonPath = join(stylesDir, dir.name, 'style.json')
    if (!existsSync(jsonPath)) continue
    try {
      const v = JSON.parse(readFileSync(jsonPath, 'utf8')) as VendorStyle
      if (!v.slug) continue
      const catId = slugify(v.category_en)
      if (!categories.has(catId)) categories.set(catId, { id: catId, en: v.category_en, cn: v.category_cn })
      entries.push({
        id: v.slug,
        en: v.en,
        cn: v.cn,
        category_en: v.category_en,
        category_cn: v.category_cn,
        uses: v.uses ?? [],
        essence_ref: v.line_cn ?? '',
      })
    } catch (e) {
      console.warn(`跳过 ${dir.name}: ${(e as Error).message}`)
    }
  }

  const out = { categories: [...categories.values()].sort((a, b) => a.id.localeCompare(b.id)), styles: entries }
  writeFileSync(metaPath, JSON.stringify(out, null, 2), 'utf8')
  console.log(`已抽取 ${entries.length} 条元数据 -> ${metaPath}`)
}

async function loadDefinitions(): Promise<StyleDefinition[]> {
  const mod1 = await import('../src/host/videogen/styles/definitions1')
  const mod2 = await import('../src/host/videogen/styles/definitions2')
  const mod3 = await import('../src/host/videogen/styles/definitions3')
  return [...mod1.definitions1, ...mod2.definitions2, ...mod3.definitions3]
}

async function pack(): Promise<void> {
  if (!existsSync(metaPath)) {
    console.error('缺少 styles.meta.json，请先运行 extract')
    process.exit(1)
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    categories: Array<{ id: string; en: string; cn: string }>
    styles: Array<{ id: string; en: string; cn: string; category_en: string; category_cn: string; uses: string[]; essence_ref: string }>
  }

  const defs = await loadDefinitions()
  const defById = new Map(defs.map((d) => [d.id, d]))
  const catById = new Map(meta.categories.map((c) => [c.en, c.id]))

  const styles: StyleDefinition[] = []
  for (const m of meta.styles) {
    const def = defById.get(m.id)
    if (def) {
      styles.push(def)
      continue
    }
    styles.push({
      id: m.id,
      en: m.en,
      cn: m.cn,
      category: catById.get(m.category_en) ?? 'other',
      essence: m.essence_ref || m.cn,
      uses: (m.uses ?? []).map((u) => u.trim()).filter(Boolean),
      essenceTraits: [],
      notThese: [],
      materials: [],
      colorLogic: [],
      typeRules: [],
      motion: [],
      camera: [],
      sound: [],
      nativeMoves: [],
      pitfalls: [],
      variation: [],
    })
  }

  const out: StyleLibraryJson = { categories: meta.categories, styles }
  // 放进 src/host/assets，构建时由 copyAssetsPlugin 复制到 lib/assets/styles.json
  const outPath = join(root, 'src', 'host', 'assets', 'styles.json')
  mkdirSync(join(root, 'src', 'host', 'assets'), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8')

  const full = styles.filter((s) => s.essenceTraits.length > 0).length
  console.log(`已生成 ${styles.length} 条风格（精写 ${full}，轻量 ${styles.length - full}）-> ${outPath}`)
}

const cmd = process.argv[2] ?? 'pack'
if (cmd === 'extract') extract()
else if (cmd === 'pack') void pack()
else console.error('未知命令：' + cmd)
