/**
 * 风格库运行时加载器
 *
 * 从打包进插件包的 `styles.json`（由 scripts/build-styles.ts 生成）加载 99 种
 * 原创风格定义，提供按 id / 中文名 / 英文名 / 分类查询的接口，供视频 LLM
 * 注入风格约束（videoCoder）与前端风格选择器消费。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StyleDefinition, StyleId, StyleLibrary, StyleLibraryJson } from './types'

let cache: StyleLibrary | null = null

/** 同步读取风格库（缓存）。找不到文件时返回空库，不抛错（降级为空风格）。 */
export function loadStyleLibrary(): StyleLibrary {
  if (cache) return cache
  cache = buildEmpty()
  // 候选路径：lib/assets/styles.json（发行，chunk 在 lib/ 下）/
  // src/host/assets/styles.json（源码）/ dist、assets（开发预览）
  const here = fileURLToPath(import.meta.url)
  const paths = [
    join(here, '..', 'assets', 'styles.json'), // lib/videogen-chunk.js -> lib/assets
    join(here, '..', '..', 'assets', 'styles.json'),
    join(process.cwd(), 'lib', 'assets', 'styles.json'),
    join(process.cwd(), 'src', 'host', 'assets', 'styles.json'),
    join(process.cwd(), 'dist', 'styles.json'),
    join(process.cwd(), 'assets', 'styles.json'),
  ]
  for (const p of paths) {
    try {
      const raw = readFileSync(p, 'utf8')
      const json = JSON.parse(raw) as StyleLibraryJson
      if (json && Array.isArray(json.styles)) {
        const styles: Record<StyleId, StyleDefinition> = {}
        for (const s of json.styles) {
          if (s && s.id) styles[s.id] = s
        }
        cache = { categories: json.categories ?? [], styles }
        break
      }
    } catch {
      /* try next path */
    }
  }
  return cache
}

function buildEmpty(): StyleLibrary {
  return { categories: [], styles: {} }
}

/** 按 id 精确查询。 */
export function getStyle(id: string): StyleDefinition | undefined {
  return loadStyleLibrary().styles[id]
}

/** 按中文名 / 英文名 / id 模糊匹配（用于自然语言解析，如 "霓虹灯管" 或 "Neon Tubes"）。 */
export function findStyle(query: string): StyleDefinition | undefined {
  const lib = loadStyleLibrary()
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  if (lib.styles[q]) return lib.styles[q]
  for (const s of Object.values(lib.styles)) {
    if (s.id.toLowerCase() === q) return s
    if (s.en.toLowerCase() === q) return s
    if (s.cn === query.trim()) return s
    if (s.en.toLowerCase().includes(q) || s.cn.includes(query.trim())) return s
  }
  return undefined
}

/** 列出全部风格（按 id 排序），供前端风格选择器渲染。 */
export function listStyles(): StyleDefinition[] {
  return Object.values(loadStyleLibrary().styles).sort((a, b) => a.id.localeCompare(b.id))
}

/** 列出全部分类。 */
export function listCategories() {
  return loadStyleLibrary().categories
}

/** 按分类 id 列出风格。 */
export function listStylesByCategory(categoryId: string): StyleDefinition[] {
  return listStyles().filter((s) => s.category === categoryId)
}

/**
 * 把一份风格定义压缩成「注入给视频 LLM 的风格约束文本」。
 * 这是 videoCoder 的 style 注入源：把结构化的规则转成自然语言段落，
 * 让 LLM 产出的 HTML 动画严格遵循该风格。
 */
export function styleToPrompt(s: StyleDefinition): string {
  const sec = (title: string, items: string[]): string => {
    if (!items || items.length === 0) return ''
    return `\n【${title}】\n` + items.map((i) => `- ${i}`).join('\n')
  }
  return [
    `你正在用「${s.cn}（${s.en}）」这一影片风格制作动画。`,
    `媒介本质：${s.essence}`,
    sec('一眼认出（决定性特征）', s.essenceTraits),
    sec('明确不是', s.notThese),
    sec('材质与渲染', s.materials),
    sec('色彩逻辑', s.colorLogic),
    sec('字体与字幕', s.typeRules),
    sec('动效质量', s.motion),
    sec('镜头语法', s.camera),
    sec('音色板', s.sound),
    sec('原生动作', s.nativeMoves),
    sec('易错点（务必避免）', s.pitfalls),
    sec('可自定义维度', s.variation),
  ]
    .filter(Boolean)
    .join('\n')
}
