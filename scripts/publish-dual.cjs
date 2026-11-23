#!/usr/bin/env node
/**
 * 双包发布辅助：把 dsh-paipiange 的产物复制一份为 paipiange 包，供 npm trusted publishing 发布。
 *
 * 背景：npm 上 `dsh-paipiange` 与 `paipiange` 是两份独立包，代码完全相同，仅 name 不同。
 * 本地 package.json 的 name 固定为 `dsh-paipiange`（发布 dsh-paipiange 用），
 * 发 `paipiange` 时把 name 改成 paipiange 即可。
 *
 * 用法（CI 内）：
 *   node scripts/publish-dual.cjs            # 就地改 name 为 paipiange（改 package.json + cordis.patch.yml + README）
 *   node scripts/publish-dual.cjs --restore  # 还原为 dsh-paipiange
 *
 * 注意：本脚本只改「文本文件」的包名引用，不改 lib/ 产物（产物里不含包名硬编码，运行时用 import.meta.url 定位）。
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const restore = process.argv.includes('--restore')

const FROM = 'dsh-paipiange'
const TO = 'paipiange'
const [src, dst] = restore ? [TO, FROM] : [FROM, TO]

function replaceInFile(rel) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) return
  let s = fs.readFileSync(p, 'utf8')
  const before = s
  // 只替换作为「包名」出现的 dsh-paipiange，不动 lib/ 里的产物（产物用相对路径，无包名字面量）
  s = s.split(src).join(dst)
  if (s !== before) {
    fs.writeFileSync(p, s, 'utf8')
    console.log(`[publish-dual] ${rel}: ${src} -> ${dst}`)
  }
}

replaceInFile('package.json')
replaceInFile('cordis.patch.yml')
replaceInFile('README.md')
replaceInFile('CHANGELOG.md')
replaceInFile('THIRD_PARTY_NOTICES.md')

console.log(`[publish-dual] done (${restore ? 'restored to' : 'switched to'} ${dst})`)
