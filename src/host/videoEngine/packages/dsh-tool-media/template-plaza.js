/**
 * @dsh-video/tool-media — 影核广场 · CinePulse Hub (Built-in & Community MOTION.md Template Plaza)
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 * Official Community Name: 影核广场 · CinePulse Hub
 *   - Built-in curated templates live in `<PACKAGE_ROOT>/templates/cinepulse-hub/<templateId>/`
 *   - User-published templates live in `<REPO_ROOT>/templates/cinepulse-hub-custom/<templateId>/`
 *   - Each template ships: `template.json` + `MOTION.md` + `script.json` (sanitized) + optional `cover.jpg` / `preview.png`
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { PACKAGE_ROOT, readScriptJson, REPO_ROOT, writeScriptJson } from '../shared/index.js'
import { resolveAdaptiveAudioProfile } from './beat-analyzer.js'
import { buildMotionMarkdown, exportProjectMotionMd } from './reference-analyzer.js'

export const PLAZA_BRAND = {
  id: 'cinepulse-hub',
  zhName: '影核广场',
  enName: 'CinePulse Hub',
  displayName: '影核广场 · CinePulse Hub',
  tagline: '双引擎动效 · 全品类节拍卡点 · 开放 MOTION.md 蓝图模板社区',
  author: 'Merziller',
  qq: '1411574209',
  wechat: 'Merziller',
  email: 'k26789228@gmail.com',
  repoUrl: 'https://github.com/Merziller/dsh-video-workbench/tree/main/templates/cinepulse-hub',
}

export const PLAZA_CATEGORIES = [
  { id: 'all', label: '全部模板' },
  { id: 'history-theater', label: '历史高燃卡点' },
  { id: 'product-promo', label: '科技产品发布会' },
  { id: 'ui-tutorial', label: 'SaaS / 软件教程' },
  { id: 'science-explainer', label: '深度科普拆解' },
  { id: 'data-story', label: '数据榜单洞察' },
  { id: 'custom', label: '社区 / 我的发布' },
]

function getBuiltinPlazaDir() {
  return join(PACKAGE_ROOT, 'templates', 'cinepulse-hub')
}

function getCustomPlazaDir() {
  return join(REPO_ROOT, 'templates', 'cinepulse-hub-custom')
}

function sanitizeTemplateScript(raw = {}) {
  const clone = JSON.parse(JSON.stringify(raw || {}))
  if (clone.bgm && typeof clone.bgm === 'object') {
    if (clone.bgm.audioPath && /^[a-zA-Z]:[\\/]|^\//.test(String(clone.bgm.audioPath))) {
      clone.bgm.audioPath = 'audio/bgm-generated.wav'
    }
    if (clone.bgm.path && /^[a-zA-Z]:[\\/]|^\//.test(String(clone.bgm.path))) {
      clone.bgm.path = 'audio/bgm-generated.wav'
    }
  }
  if (Array.isArray(clone.scenes)) {
    clone.scenes = clone.scenes.map((sc) => {
      const next = { ...sc }
      delete next.audioFile
      delete next.masteredAudioFile
      if (Array.isArray(next.media)) {
        next.media = next.media.map((m) => ({
          ...m,
          path: String(m.path || '').replace(/^[a-zA-Z]:[\\/].*?[\\/]assets[\\/]/i, 'assets/').replace(/\\/g, '/'),
        }))
      }
      return next
    })
  }
  return clone
}

function loadTemplateFromDir(dirPath, source = 'builtin') {
  const metaPath = join(dirPath, 'template.json')
  if (!existsSync(metaPath)) return null
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const id = String(meta.id || basename(dirPath))
    const motionMdPath = join(dirPath, 'MOTION.md')
    const scriptPath = join(dirPath, 'script.json')
    const coverCand = ['cover.jpg', 'cover.png', 'preview.jpg', 'preview.png'].find((f) => existsSync(join(dirPath, f))) || ''
    return {
      ...meta,
      id,
      source,
      dirPath,
      hasMotionMd: existsSync(motionMdPath),
      hasScript: existsSync(scriptPath),
      coverFile: coverCand,
      coverAbsPath: coverCand ? join(dirPath, coverCand) : '',
      coverUrl: coverCand ? `/api/video-workbench/plaza/cover?id=${encodeURIComponent(id)}` : '',
    }
  } catch {
    return null
  }
}

export function listPlazaTemplates(opts = {}) {
  const category = String(opts.category || 'all').trim().toLowerCase()
  const query = String(opts.query || '').trim().toLowerCase()
  const list = []
  const seen = new Set()

  const scan = (root, source) => {
    if (!existsSync(root)) return
    for (const entry of readdirSync(root)) {
      const full = join(root, entry)
      if (!statSync(full).isDirectory()) continue
      const tpl = loadTemplateFromDir(full, source)
      if (!tpl || seen.has(tpl.id)) continue
      seen.add(tpl.id)
      list.push(tpl)
    }
  }

  scan(getBuiltinPlazaDir(), 'builtin')
  scan(getCustomPlazaDir(), 'custom')

  list.sort((a, b) => Number(a.order || 99) - Number(b.order || 99) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))

  const filtered = list.filter((t) => {
    if (category && category !== 'all') {
      if (category === 'custom' && t.source !== 'custom') return false
      if (category !== 'custom' && String(t.category || t.genre || '').toLowerCase() !== category) return false
    }
    if (query) {
      const hay = `${t.id} ${t.name || ''} ${t.genreLabel || ''} ${t.description || ''} ${(t.tags || []).join(' ')}`.toLowerCase()
      if (!hay.includes(query)) return false
    }
    return true
  })

  return {
    ok: true,
    brand: PLAZA_BRAND,
    categories: PLAZA_CATEGORIES,
    totalCount: list.length,
    templates: filtered.map(({ dirPath, coverAbsPath, ...pub }) => pub),
  }
}

export function getPlazaTemplate(templateId) {
  const id = String(templateId || '').trim()
  if (!id) throw new Error('templateId is required')
  for (const [root, source] of [
    [getBuiltinPlazaDir(), 'builtin'],
    [getCustomPlazaDir(), 'custom'],
  ]) {
    const dir = join(root, id)
    if (existsSync(join(dir, 'template.json'))) {
      const tpl = loadTemplateFromDir(dir, source)
      if (!tpl) continue
      const motionMd = tpl.hasMotionMd ? readFileSync(join(dir, 'MOTION.md'), 'utf8') : ''
      const script = tpl.hasScript ? JSON.parse(readFileSync(join(dir, 'script.json'), 'utf8')) : null
      return { ok: true, template: tpl, motionMd, script }
    }
  }
  throw new Error(`未在「${PLAZA_BRAND.displayName}」找到模板: ${id}`)
}

export function applyPlazaTemplateToProject({ projectDir, templateId, newTopic = '', copyScenes = false } = {}) {
  if (!projectDir) throw new Error('projectDir is required')
  const absProject = resolve(projectDir)
  if (!existsSync(join(absProject, 'script.json'))) {
    throw new Error(`目标工程缺少 script.json: ${absProject}`)
  }

  const { template, motionMd, script: tplScript } = getPlazaTemplate(templateId)
  const { data: cur } = readScriptJson(absProject)

  const refBlueprint = template.referenceStyle || {
    sourceName: `${PLAZA_BRAND.zhName}:${template.name}`,
    title: template.name,
    genre: template.genre || 'product-promo',
    genreLabel: template.genreLabel || template.name,
    style: template.style || 'cinematic',
    narrationMode: template.narrationMode || 'tts-beat-sync',
    durationSec: Number(template.durationSec || tplScript?.totalDurationSec || 60),
    shotCount: Number(template.shotCount || tplScript?.scenes?.length || 16),
    avgShotSec: Number(template.avgShotSec || 3.5),
    bpm: Number(template.bpm || 110),
    visualStyle: template.visualStyle || template.description || '',
    colorPalette: template.colorPalette || { background: '#070B16', primary: '#F59E0B', accent: '#22D3EE', highlight: '#F8FAFC' },
    characterDesign: template.characterDesign || '',
    vfxSignature: template.vfxSignature || [],
    transitionSignature: template.transitionSignature || ['slash-wipe', 'zoom-punch', 'flash-cut'],
    subtitleStyle: template.subtitleStyle || 'cinematic',
    pacingSignature: {
      targetShotCount: Number(template.shotCount || tplScript?.scenes?.length || 16),
      avgShotSec: Number(template.avgShotSec || 3.5),
      bpm: Number(template.bpm || 110),
      recommendedPacingMode: template.pacingMode || 'balanced',
    },
    shotFormula: template.shotFormula || [],
    replicationPrompt: template.replicationPrompt || `复刻【${PLAZA_BRAND.zhName}】精选模板「${template.name}」：${template.description || ''}`,
    plazaTemplateId: template.id,
    appliedAt: new Date().toISOString(),
  }

  cur.genre = template.genre || cur.genre || 'product-promo'
  cur.genreLabel = template.genreLabel || template.name
  cur.style = template.style || cur.style || 'cinematic'
  cur.engine = template.engine || cur.engine || 'remotion'
  cur.narrationMode = template.narrationMode || cur.narrationMode || 'tts-beat-sync'
  cur.pacingMode = template.pacingMode || cur.pacingMode || 'balanced'
  cur.subtitleStyle = template.subtitleStyle || cur.subtitleStyle || 'cinematic'
  cur.referenceStyle = refBlueprint
  cur.audioProfile = template.audioProfile || resolveAdaptiveAudioProfile({
    genre: cur.genre,
    genreLabel: cur.genreLabel,
    style: cur.style,
    narrationMode: cur.narrationMode,
  })
  cur.appliedPlazaTemplate = {
    id: template.id,
    name: template.name,
    plaza: PLAZA_BRAND.displayName,
    appliedAt: new Date().toISOString(),
  }

  if (newTopic && String(newTopic).trim()) {
    cur.title = String(newTopic).trim().slice(0, 64)
    cur.goal = String(newTopic).trim()
    cur.directorNotes = `${String(newTopic).trim()}\n\n【影核广场模板复刻指导 · ${template.name}】\n${refBlueprint.replicationPrompt}`
  }

  if (copyScenes && Array.isArray(tplScript?.scenes) && tplScript.scenes.length > 0) {
    cur.scenes = JSON.parse(JSON.stringify(tplScript.scenes))
    cur.totalDurationSec = tplScript.totalDurationSec || cur.totalDurationSec
    cur.totalDurationInFrames = tplScript.totalDurationInFrames || cur.totalDurationInFrames
  }

  const saved = writeScriptJson(absProject, cur).data
  if (motionMd) {
    writeFileSync(join(absProject, 'MOTION.md'), motionMd, 'utf8')
  } else {
    exportProjectMotionMd(absProject)
  }

  return {
    ok: true,
    plaza: PLAZA_BRAND.displayName,
    templateId: template.id,
    templateName: template.name,
    script: saved,
    motionMdPath: join(absProject, 'MOTION.md'),
  }
}

export function publishProjectToPlaza(options = {}) {
  const {
    projectDir,
    templateId = '',
    name = '',
    category = '',
    description = '',
    tags = [],
    author = 'Merziller',
    targetRoot = '',
    order = 50,
  } = options
  if (!projectDir) throw new Error('projectDir is required')
  const absProject = resolve(projectDir)
  if (!existsSync(join(absProject, 'script.json'))) {
    throw new Error(`无法发布：工程缺少 script.json (${absProject})`)
  }

  const { data: rawScript } = readScriptJson(absProject)
  const cleanScript = sanitizeTemplateScript(rawScript)
  const slug = String(templateId || basename(absProject))
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `tpl-${Date.now().toString(36)}`

  const destBase = targetRoot ? resolve(targetRoot) : getCustomPlazaDir()
  const destDir = join(destBase, slug)
  mkdirSync(destDir, { recursive: true })

  const scenes = Array.isArray(cleanScript.scenes) ? cleanScript.scenes : []
  const totalSec = Number(cleanScript.totalDurationSec || scenes.reduce((a, s) => a + (Number(s.durationSec) || 3), 0) || 30)
  const avgShotSec = scenes.length > 0 ? Number((totalSec / scenes.length).toFixed(2)) : 3.5
  const audioProfile = cleanScript.audioProfile || resolveAdaptiveAudioProfile({
    genre: cleanScript.genre,
    genreLabel: cleanScript.genreLabel,
    title: cleanScript.title,
    style: cleanScript.style,
    narrationMode: cleanScript.narrationMode,
  })

  // Copy best available visual preview cover
  const coverCandidates = [
    join(absProject, 'output', 'snapshot-3x3.png'),
    join(absProject, 'reference', 'ref-sheet-3x3.jpg'),
    join(absProject, 'output', 'scene-thumbs', 'scene-01.jpg'),
    join(absProject, 'output', 'scene-thumbs', 'scene-02.jpg'),
  ]
  let coverFile = ''
  for (const cand of coverCandidates) {
    if (existsSync(cand)) {
      const ext = extname(cand).toLowerCase() === '.png' ? '.png' : '.jpg'
      coverFile = `cover${ext}`
      copyFileSync(cand, join(destDir, coverFile))
      break
    }
  }

  const motionContent = buildMotionMarkdown({
    script: cleanScript,
    referenceStyle: cleanScript.referenceStyle || null,
  })
  writeFileSync(join(destDir, 'MOTION.md'), motionContent, 'utf8')
  writeFileSync(join(destDir, 'script.json'), JSON.stringify(cleanScript, null, 2) + '\n', 'utf8')

  const templateMeta = {
    id: slug,
    order,
    name: String(name || cleanScript.title || slug).trim(),
    category: String(category || cleanScript.genre || 'product-promo').trim(),
    genre: String(cleanScript.genre || category || 'product-promo').trim(),
    genreLabel: String(cleanScript.genreLabel || name || '全品类动效模板').trim(),
    style: String(cleanScript.style || 'cinematic').trim(),
    engine: String(cleanScript.engine || 'remotion').trim(),
    narrationMode: String(cleanScript.narrationMode || 'tts-beat-sync').trim(),
    pacingMode: String(cleanScript.pacingMode || 'balanced').trim(),
    subtitleStyle: String(cleanScript.subtitleStyle || 'cinematic').trim(),
    aspectRatio: String(cleanScript.aspectRatio || '16:9').trim(),
    fps: Number(cleanScript.fps || 30),
    shotCount: scenes.length,
    durationSec: Number(totalSec.toFixed(1)),
    avgShotSec,
    bpm: Number(cleanScript.bgm?.bpm || cleanScript.referenceStyle?.bpm || 110),
    description: String(description || cleanScript.referenceStyle?.visualStyle || `${scenes.length} 镜 · ${Math.round(totalSec)}s · ${audioProfile.profileName}`).trim(),
    tags: Array.isArray(tags) && tags.length > 0 ? tags.slice(0, 8) : [cleanScript.genreLabel || '精选模板', cleanScript.engine === 'html' ? 'HTML5' : 'Remotion 3D', audioProfile.profileName],
    colorPalette: cleanScript.referenceStyle?.colorPalette || {
      background: cleanScript.genre === 'ui-tutorial' ? '#F8FAFC' : '#070B16',
      primary: cleanScript.genre === 'history-theater' ? '#C9462F' : '#2563EB',
      accent: '#F59E0B',
      highlight: '#FFF7DF',
    },
    vfxSignature: cleanScript.referenceStyle?.vfxSignature || [],
    transitionSignature: cleanScript.referenceStyle?.transitionSignature || Array.from(new Set(scenes.map((s) => s.transition).filter(Boolean))).slice(0, 5),
    replicationPrompt: cleanScript.referenceStyle?.replicationPrompt || '',
    audioProfile,
    author: String(author || PLAZA_BRAND.author),
    plaza: PLAZA_BRAND.displayName,
    coverFile,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(join(destDir, 'template.json'), JSON.stringify(templateMeta, null, 2) + '\n', 'utf8')

  return {
    ok: true,
    template: templateMeta,
    dirPath: destDir,
    motionMdPath: join(destDir, 'MOTION.md'),
  }
}
