#!/usr/bin/env node
/**
 * 双包发布辅助：把 dsh-paipiange 的产物复制一份为 paipiange 包，供 npm trusted publishing 发布。
 *
 * 背景：npm 上 `dsh-paipiange` 与 `paipiange` 是两份独立包，代码完全相同，仅 name 不同。
 * 本地 package.json 的 name 固定为 `dsh-paipiange`（发布 dsh-paipiange 用），
 * 发 `paipiange` 时把 name 改成 paipiange 即可。
 *
 * 用法（CI 内，独立 checkout、切名后直接 publish、从不还原）：
 *   node scripts/publish-dual.cjs            # 就地切 name 为 paipiange（package.json + cordis.patch.yml + README 等）
 *   node scripts/publish-dual.cjs --restore  # 还原为 dsh-paipiange（用 git checkout，保证精确还原、不累积前缀）
 *
 * 关键约束（血的教训）：
 * 1. 本脚本只改「文本文件」的**完整包名 token**，不动 lib/ 产物。
 *    但 tsdown.config.ts 的 client banner 会把 package name 烧进 lib/client.js 的
 *    `__ModuleLoader__.load({ id: ... })`，所以**切名必须在 `pnpm build:plugin` 之前**
 *    （否则 paipiange 包的 client.js id 仍是 dsh-paipiange，dsh 按 entry 名「paipiange」
 *    对账时 id 错配，侧边栏 tab 不显示、插件无描述）。见 .github/workflows/publish-npm.yml。
 * 2. 切名方向（dsh-paipiange → paipiange）用 `split('dsh-paipiange')` 是安全的：只会命中
 *    带 dsh- 前缀的完整包名，不会误伤独立的 `paipiange`（如 author、github org）。
 * 3. 还原方向**绝不能**用 `split('paipiange').join('dsh-paipiange')`——那会把所有独立的
 *    `paipiange`（author/github org/品牌名）也加上 dsh- 前缀，且 `dsh-paipiange` 本身含
 *    `paipiange` 子串，来回替换会累积成 `dsh-dsh-paipiange`。还原一律走 `git checkout`。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const restore = process.argv.includes('--restore')

// 需要切换包名的文本文件（不含 lib/ 产物；lib/client.js 的 id 由 tsdown 在 build 时按 pkg.name 注入）。
const TEXT_FILES = ['package.json', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md']

const FROM = 'dsh-paipiange'
const TO = 'paipiange'

if (restore) {
  // 还原：直接用 git 恢复，保证精确、幂等，绝不累积前缀。
  const files = TEXT_FILES.map(f => `"${path.join(root, f)}"`).join(' ')
  try {
    execSync(`git checkout -- ${files}`, { cwd: root, stdio: 'inherit' })
    console.log(`[publish-dual] restored via git checkout (${TEXT_FILES.join(', ')})`)
  } catch (err) {
    console.error('[publish-dual] git checkout failed; fall back to precise replace')
    for (const rel of TEXT_FILES) {
      const p = path.join(root, rel)
      if (!fs.existsSync(p)) continue
      let s = fs.readFileSync(p, 'utf8')
      // 精确还原：只把「独立的 paipiange」（前面不是 dsh-、后面不是包名字符）改回 dsh-paipiange。
      // 但这是兜底，正常走上面的 git checkout，不会到这里。
      s = s.replace(/(?<!dsh-)paipiange/g, TO)
      fs.writeFileSync(p, s, 'utf8')
    }
  }
  console.log('[publish-dual] done (restored to dsh-paipiange)')
  process.exit(0)
}

// 切名：dsh-paipiange → paipiange（安全，只命中带 dsh- 前缀的完整包名）。
function replaceInFile(rel) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) return
  let s = fs.readFileSync(p, 'utf8')
  const before = s
  s = s.split(FROM).join(TO)
  if (s !== before) {
    fs.writeFileSync(p, s, 'utf8')
    console.log(`[publish-dual] ${rel}: ${FROM} -> ${TO}`)
  }
}

for (const rel of TEXT_FILES) replaceInFile(rel)

console.log(`[publish-dual] done (switched to ${TO})`)
