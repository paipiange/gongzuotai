import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PACKAGE_ROOT } from '../packages/shared/index.js'

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
if (pkg.private === true) {
  throw new Error('Root package.json must not set "private": true for DSH Market distribution')
}
const depStr = JSON.stringify(pkg.dependencies || {})
if (depStr.includes('workspace:')) {
  throw new Error('Root package.json must not contain workspace:* dependencies')
}

const outDir = resolve(PACKAGE_ROOT, '.tmp', 'release-pack')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const packedNameRaw = execFileSync(
  npmCmd,
  ['pack', '--pack-destination', outDir],
  { cwd: PACKAGE_ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
).trim()
const packedName = packedNameRaw.split(/\r?\n/).filter(Boolean).pop()
const tgzPath = join(outDir, packedName)
if (!existsSync(tgzPath)) {
  throw new Error(`Expected tarball missing: ${tgzPath}`)
}

const entries = execFileSync('tar', ['-tf', tgzPath], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)

const requiredEntries = [
  'package/index.js',
  'package/package.json',
  'package/cordis.patch.yml',
  'package/bin/dsh-video-mcp.mjs',
  'package/bin/dsh-video-cli.mjs',
  'package/SKILL.md',
  'package/AGENTS.md',
  'package/.mcp.json',
  'package/.claude-plugin/plugin.json',
  'package/docs/install.md',
  'package/packages/web-video-workbench/lib/client.js'.replace('web-video-workbench', 'dsh-web-video-workbench'),
  'package/packages/shared/fonts/NotoSansSC-VF.woff2',
  'package/scripts/tts-bridge.py',
  'package/scripts/tts-server.py',
  'package/scripts/install-tts-engine.mjs',
  'package/scripts/install-tts-engine.ps1',
  'package/start-workbench.vbs',
  'package/start-workbench.cmd',
  'package/stop-workbench.cmd',
  'package/packages/dsh-tool-media/cloud-media.js',
  'package/packages/dsh-tool-media/template-plaza.js',
  'package/LICENSE',
  'package/NOTICE',
  'package/README.md',
]
for (const reqEntry of requiredEntries) {
  if (!entries.includes(reqEntry)) {
    throw new Error(`Missing required file in tarball: ${reqEntry}`)
  }
}

const forbiddenPatterns = [
  /^package\/\.env$/,
  /^package\/node_modules\//,
  /^package\/\.dsh-home\//,
  /^package\/\.tmp\//,
  /\.mp4$/i,
  /\.wav$/i,
]
for (const entry of entries) {
  for (const rx of forbiddenPatterns) {
    if (rx.test(entry)) {
      throw new Error(`Forbidden runtime/secret file included in tarball: ${entry}`)
    }
  }
}

const sizeMb = (statSync(tgzPath).size / 1024 / 1024).toFixed(2)
console.log(JSON.stringify({ ok: true, name: pkg.name, version: pkg.version, tgzPath, sizeMb: Number(sizeMb), fileCount: entries.length }, null, 2))
