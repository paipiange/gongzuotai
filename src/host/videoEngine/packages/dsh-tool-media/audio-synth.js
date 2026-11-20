/**
 * Audio Synthesizer & Multi-Track Mixer
 * - Delegates 48kHz stereo synthesis & Schroeder stereo reverb to `./audio-dsp.js`
 * - Supports 24+ kinetic SFX types (`hit`, `whoosh`, `swoosh`, `glitch`, `pop`, `thud`, `card`, `sparkle`, `chime`, `riser`, `sub_drop`, `crash_cym`, `suck`, `counter`, `typing`, `stamp`, etc.)
 * - Generates beat-locked multi-instrument BGM (drums, analog bass, stereo pad, FM e-piano, arp pluck)
 * - Mixes Voice Narration + Procedural Reverb SFX Bus + User Custom SFX + Sidechain-Ducked BGM via FFmpeg into `output/master-audio.wav`
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { probeAudioDuration, resolveBinaries, runCommandRedirected } from '../shared/index.js'
import {
  buildBeatGrid,
  DSP_SR,
  encodeStereoWav,
  renderBgmWavBuffer,
  renderSfxMasterBuffer,
  synthSfxStereo,
} from './audio-dsp.js'

import {
  analyzeAudioBeatStructure,
  choreographBeatSfxCues,
  GENRE_AUDIO_PROFILES,
  quantizeScenesToBeatGrid,
  resolveAdaptiveAudioProfile,
  snapTimeToBeatGrid,
} from './beat-analyzer.js'

const SR = DSP_SR

const amixNormalizeCache = new Map()
function supportsAmixNormalize(ffmpegBin) {
  if (amixNormalizeCache.has(ffmpegBin)) return amixNormalizeCache.get(ffmpegBin)
  let ok = true
  try {
    const out = execFileSync(ffmpegBin, ['-hide_banner', '-h', 'filter=amix'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 5000,
    })
    ok = /\bnormalize\b/i.test(out || '')
  } catch {
    ok = false
  }
  amixNormalizeCache.set(ffmpegBin, ok)
  return ok
}

function formatAmixChain(inputs, durationMode, ffmpegBin) {
  return supportsAmixNormalize(ffmpegBin)
    ? `amix=inputs=${inputs}:normalize=0:duration=${durationMode}`
    : `amix=inputs=${inputs}:duration=${durationMode},volume=${inputs}`
}

export {
  analyzeAudioBeatStructure,
  buildBeatGrid,
  choreographBeatSfxCues,
  GENRE_AUDIO_PROFILES,
  quantizeScenesToBeatGrid,
  resolveAdaptiveAudioProfile,
  snapTimeToBeatGrid,
}

export function generateSfxWav(type, outPath, opts = {}) {
  mkdirSync(dirname(outPath), { recursive: true })
  const { L, R } = synthSfxStereo(type, opts)
  writeFileSync(outPath, encodeStereoWav(L, R, SR))
  return outPath
}

export function generateBgmWav({ durationSec = 20, mood = 'tech', bpm, audioSpec = null, outPath }) {
  mkdirSync(dirname(outPath), { recursive: true })
  const buf = renderBgmWavBuffer({ durationSec, mood, bpm, audioSpec })
  writeFileSync(outPath, buf)
  return outPath
}

const CORE_SFX_KINDS = [
  'hit',
  'whoosh',
  'swoosh',
  'glitch',
  'pop',
  'pop_soft',
  'thud',
  'card',
  'slash',
  'sparkle',
  'chime',
  'shine',
  'shimmer_swell',
  'counter',
  'typing',
  'click',
  'flip',
  'boing',
  'shutter',
  'radar',
  'bell_warm',
  'riser',
  'suck',
  'sub_drop',
  'crash_cym',
  'stamp',
  'tick',
]

/**
 * Ensure SFX & BGM assets exist for a project (preferring user's imported files,
 * falling back to beat-matched 48kHz stereo DSP synthesis).
 */
export async function ensureProjectAudioAssets(projectDir, script, assetsManifest) {
  const absDir = resolve(projectDir)
  const sfxDir = join(absDir, 'audio', 'sfx')
  mkdirSync(sfxDir, { recursive: true })

  const builtinSfx = {}
  for (const kind of CORE_SFX_KINDS) {
    const aiRel = `audio/sfx/${kind}-ai.wav`
    const aiAbs = join(absDir, aiRel)
    if (existsSync(aiAbs)) {
      builtinSfx[kind] = aiRel
      continue
    }
    const p = join(sfxDir, `${kind}.wav`)
    if (!existsSync(p)) generateSfxWav(kind, p)
    builtinSfx[kind] = `audio/sfx/${kind}.wav`
  }

  const importedMusic = (assetsManifest?.items || []).filter((it) => it.role === 'music')
  const totalSec = Math.max(2, Number(script?.totalDurationSec) || 12)
  const bgmMode = script?.audioSpec?.bgmMode || script?.bgmMode || script?.bgm?.mode || 'auto'
  let bgmPath = ''
  let bgmSource = 'generated'

  const candidateExists = (p) => Boolean(p && existsSync(isAbsolute(p) ? p : join(absDir, p)))

  if (bgmMode === 'uploaded') {
    const selected = script?.bgm?.uploadedPath || importedMusic[0]?.path || script?.bgm?.path || ''
    if (candidateExists(selected)) {
      bgmPath = selected
      bgmSource = 'user-imported'
    } else if (importedMusic.length > 0 && candidateExists(importedMusic[0].path)) {
      bgmPath = importedMusic[0].path
      bgmSource = 'user-imported'
    }
  } else if (bgmMode === 'llm-coded') {
    if (candidateExists('audio/bgm-llm.wav')) {
      bgmPath = 'audio/bgm-llm.wav'
      bgmSource = 'llm-coded'
    } else if (importedMusic.length > 0 && candidateExists(importedMusic[0].path)) {
      bgmPath = importedMusic[0].path
      bgmSource = 'user-imported'
    } else if (candidateExists(script?.bgm?.path)) {
      bgmPath = script.bgm.path
      bgmSource = script?.bgm?.source || 'llm-coded'
    }
  } else if (bgmMode === 'tts-engine') {
    if (candidateExists('audio/bgm-tts.wav')) {
      bgmPath = 'audio/bgm-tts.wav'
      bgmSource = 'tts-engine'
    } else if (candidateExists(script?.bgm?.path)) {
      bgmPath = script.bgm.path
      bgmSource = 'tts-engine'
    }
  } else if (importedMusic.length > 0 && candidateExists(importedMusic[0].path)) {
    bgmPath = importedMusic[0].path
    bgmSource = 'user-imported'
  }

  if (!bgmPath && candidateExists(script?.bgm?.path)) {
    bgmPath = script.bgm.path
    bgmSource = script?.bgm?.source || 'generated'
  }

  if (!bgmPath) {
    if (importedMusic.length > 0) {
      bgmPath = importedMusic[0].path
      bgmSource = 'user-imported'
    } else {
      const mood = script?.audioSpec?.mood || script?.bgm?.mood || script?.style || 'tech'
      const bpm = script?.audioSpec?.bpm || script?.bgm?.bpm
      const genPath = join(absDir, 'audio', 'bgm-generated.wav')
      generateBgmWav({ durationSec: totalSec + 1.2, mood, bpm, audioSpec: script?.audioSpec || null, outPath: genPath })
      bgmPath = 'audio/bgm-generated.wav'
      bgmSource = script?.audioSpec ? 'ai-audio-spec' : 'generated'
    }
  }

  return { builtinSfx, bgmPath, bgmSource, bgmMode }
}

/**
 * Mix Voice Narration + Procedural Reverb SFX Bus + User Custom SFX + Sidechain-Ducked BGM into `output/master-audio.wav`.
 */
export async function mixVideoAudio({ projectDir, script, assetsManifest, outputPath, signal, onChild }) {
  if (signal?.aborted) throw new Error('Audio mix aborted')
  const absDir = resolve(projectDir)
  const outWav = outputPath ? resolve(absDir, outputPath) : join(absDir, 'output', 'master-audio.wav')
  mkdirSync(dirname(outWav), { recursive: true })

  const totalSec = Math.max(1, Number(script.totalDurationSec) || 10)
  const { builtinSfx, bgmPath, bgmSource } = await ensureProjectAudioAssets(absDir, script, assetsManifest)
  const { ffmpeg } = resolveBinaries()

  const voiceEvents = []
  const proceduralCues = []
  const customSfxEvents = []

  for (const scene of script.scenes || []) {
    const startSec = Number(scene.startSec || 0)
    const leadSec = Number.isFinite(Number(scene.voiceLeadSec)) ? Number(scene.voiceLeadSec) : 0.3
    const chosenRelVoice =
      scene.masteredAudioFile &&
      existsSync(isAbsolute(scene.masteredAudioFile) ? scene.masteredAudioFile : resolve(absDir, scene.masteredAudioFile))
        ? scene.masteredAudioFile
        : scene.audioFile
    if (chosenRelVoice) {
      const absAudio = isAbsolute(chosenRelVoice) ? chosenRelVoice : resolve(absDir, chosenRelVoice)
      if (existsSync(absAudio)) {
        voiceEvents.push({ path: absAudio, delayMs: Math.max(0, Math.round((startSec + leadSec) * 1000)) })
      }
    }

    const cues = Array.isArray(scene.sfxCues) ? scene.sfxCues : []
    for (const cue of cues) {
      const atSec = startSec + Math.max(0, Number(cue.offsetSec || 0))
      if (atSec >= totalSec) continue
      const volume = Number.isFinite(Number(cue.volume)) ? Number(cue.volume) : 0.55
      const pan = Number.isFinite(Number(cue.pan)) ? Number(cue.pan) : 0
      const type = cue.type || 'whoosh'

      // If user supplied a custom non-builtin file path, schedule via FFmpeg; otherwise render through shared DSP stereo reverb bus
      const isCustomPath =
        cue.path &&
        !String(cue.path).replace(/\\/g, '/').startsWith('audio/sfx/')
      const absCustom = isCustomPath ? (isAbsolute(cue.path) ? cue.path : resolve(absDir, cue.path)) : ''

      if (absCustom && existsSync(absCustom)) {
        customSfxEvents.push({
          path: absCustom,
          delayMs: Math.round(atSec * 1000),
          volume,
        })
      } else {
        proceduralCues.push({
          type,
          atSec,
          volume,
          pan,
          d: cue.d,
          freqStart: cue.freqStart,
          freqEnd: cue.freqEnd,
          durationMs: cue.durationMs,
          q: cue.q,
          wave: cue.wave,
          noiseMix: cue.noiseMix,
        })
      }
    }
  }

  let procSfxWav = ''
  if (proceduralCues.length > 0) {
    procSfxWav = join(absDir, 'audio', 'sfx-master.wav')
    mkdirSync(dirname(procSfxWav), { recursive: true })
    writeFileSync(procSfxWav, renderSfxMasterBuffer({ durationSec: totalSec, cues: proceduralCues }))
  }

  const absBgm = bgmPath ? (isAbsolute(bgmPath) ? bgmPath : resolve(absDir, bgmPath)) : ''
  const hasBgm = Boolean(absBgm && existsSync(absBgm)) && script?.bgm?.enabled !== false
  const isPureMvNoVoice = voiceEvents.length === 0 || script?.narrationMode === 'subtitle-mv'
  const isBeatSyncVoice = !isPureMvNoVoice && (script?.narrationMode === 'tts-beat-sync' || bgmSource === 'user-imported')
  const audioProf = resolveAdaptiveAudioProfile({
    genre: script?.genre,
    genreLabel: script?.genreLabel,
    title: script?.title,
    style: script?.style,
    narrationMode: script?.narrationMode,
    pacingMode: script?.pacingMode,
    audioProfile: script?.audioProfile,
    referenceStyle: script?.referenceStyle,
  })
  const rawBgmVol = Number(script?.bgm?.volume)
  const bgmVol = isPureMvNoVoice
    ? (Number.isFinite(rawBgmVol) && rawBgmVol >= 0.45 && rawBgmVol <= 1.0 ? rawBgmVol : audioProf.bgmVolMv)
    : (Number.isFinite(rawBgmVol) && rawBgmVol >= 0.20 && rawBgmVol <= 0.85 ? rawBgmVol : isBeatSyncVoice ? Math.max(audioProf.bgmVolVoice, 0.44) : audioProf.bgmVolVoice)
  const bgmFadeInSec = isPureMvNoVoice ? 0.16 : 0.40
  const masterLufs = audioProf.targetLufs || -14.5
  const bgmDuckRatio = audioProf.bgmDuckRatio || 2.6
  const sfxBusBoost = isPureMvNoVoice ? (audioProf.sfxBoostMv || 1.55) : (audioProf.sfxBoostVoice || 1.12)

  const args = ['-y']
  const filters = []
  let idx = 0

  args.push('-f', 'lavfi', '-t', String(totalSec), '-i', `anullsrc=channel_layout=stereo:sample_rate=${SR}`)
  const baseIdx = idx++

  const voiceLabels = []
  for (const v of voiceEvents) {
    args.push('-i', v.path)
    const lbl = `v${idx}`
    filters.push(
      `[${idx}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${v.delayMs}|${v.delayMs},volume=1.06[${lbl}]`,
    )
    voiceLabels.push(`[${lbl}]`)
    idx++
  }

  const sfxLabels = []
  if (procSfxWav && existsSync(procSfxWav)) {
    args.push('-i', procSfxWav)
    const lbl = `sxproc`
    filters.push(`[${idx}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${isPureMvNoVoice ? '1.15' : '0.88'}[${lbl}]`)
    sfxLabels.push(`[${lbl}]`)
    idx++
  }
  for (const s of customSfxEvents) {
    args.push('-i', s.path)
    const lbl = `sx${idx}`
    filters.push(
      `[${idx}:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${s.delayMs}|${s.delayMs},volume=${s.volume}[${lbl}]`,
    )
    sfxLabels.push(`[${lbl}]`)
    idx++
  }

  let bgmIdx = -1
  if (hasBgm) {
    args.push('-stream_loop', '-1', '-t', String(totalSec), '-i', absBgm)
    bgmIdx = idx++
    const fadeOutStart = Math.max(0, Number((totalSec - 1.5).toFixed(2)))
    if (isPureMvNoVoice) {
      filters.push(
        `[${bgmIdx}:a:0]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-14.5:TP=-2.0:LRA=6,volume=${bgmVol},afade=t=in:st=0:d=${bgmFadeInSec},afade=t=out:st=${fadeOutStart}:d=1.5[bgm_raw]`,
      )
    } else {
      filters.push(
        `[${bgmIdx}:a:0]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-16.5:TP=-2.0:LRA=9,volume=${bgmVol},afade=t=in:st=0:d=${bgmFadeInSec},afade=t=out:st=${fadeOutStart}:d=1.5[bgm_raw]`,
      )
    }
  }

  const mixInputs = [`[${baseIdx}:a]`]
  let bgmStreamForMix = hasBgm ? '[bgm_raw]' : ''

  if (voiceLabels.length > 0) {
    if (voiceLabels.length === 1) {
      filters.push(`${voiceLabels[0]}apad,atrim=0:${totalSec}[voices]`)
    } else {
      filters.push(`${voiceLabels.join('')}${formatAmixChain(voiceLabels.length, 'longest', ffmpeg)},apad,atrim=0:${totalSec}[voices]`)
    }
    if (hasBgm) {
      filters.push('[voices]asplit=2[v_out][v_sc]')
      mixInputs.push('[v_out]')
      filters.push(`[bgm_raw][v_sc]sidechaincompress=threshold=0.062:ratio=${bgmDuckRatio.toFixed(2)}:attack=18:release=240:knee=4[bgm_vduck]`)
      bgmStreamForMix = '[bgm_vduck]'
    } else {
      mixInputs.push('[voices]')
    }
  }

  if (sfxLabels.length > 0) {
    const sfxBoost = String(sfxBusBoost.toFixed(2))
    if (sfxLabels.length === 1) {
      filters.push(`${sfxLabels[0]}apad,atrim=0:${totalSec},volume=${sfxBoost},alimiter=limit=0.78:level=disabled:attack=2:release=50[sfx_bus]`)
    } else {
      filters.push(`${sfxLabels.join('')}${formatAmixChain(sfxLabels.length, 'longest', ffmpeg)},apad,atrim=0:${totalSec},volume=${sfxBoost},alimiter=limit=0.78:level=disabled:attack=2:release=50[sfx_bus]`)
    }
    if (hasBgm && bgmStreamForMix) {
      // Transient micro-duck BGM ~2-4dB on impact/transition SFX bursts so cuts punch crisply across any music genre
      filters.push('[sfx_bus]asplit=2[sfx_out][sfx_sc]')
      filters.push(`${bgmStreamForMix}[sfx_sc]sidechaincompress=threshold=0.055:ratio=2.5:attack=3:release=115[bgm_final]`)
      mixInputs.push('[bgm_final]')
      mixInputs.push('[sfx_out]')
    } else {
      if (hasBgm && bgmStreamForMix) mixInputs.push(bgmStreamForMix)
      mixInputs.push('[sfx_bus]')
    }
  } else if (hasBgm && bgmStreamForMix) {
    mixInputs.push(bgmStreamForMix)
  }

  filters.push(
    `${mixInputs.join('')}${formatAmixChain(mixInputs.length, 'first', ffmpeg)},loudnorm=I=${masterLufs.toFixed(1)}:TP=-2.0:LRA=9,alimiter=limit=0.78:level=disabled:attack=0.5:release=50[master]`,
  )
  args.push('-filter_complex', filters.join(';'), '-map', '[master]', '-c:a', 'pcm_s16le', '-ar', String(SR), '-t', String(totalSec), outWav)

  const res = await runCommandRedirected(ffmpeg, args, {
    timeoutMs: Math.max(180_000, Math.round(totalSec * 2500)),
    signal,
    onChild,
  })
  if (res.code !== 0 || !existsSync(outWav)) {
    throw new Error(`Multi-track audio mix failed: ${res.stderr}`)
  }

  const probe = await probeAudioDuration(outWav, Number(script.fps) || 30)
  return {
    ok: true,
    outputPath: outWav,
    durationSec: probe.durationSec,
    voiceCount: voiceEvents.length,
    sfxCount: proceduralCues.length + customSfxEvents.length,
    bgmUsed: hasBgm ? bgmPath : '',
    bgmSource: hasBgm ? bgmSource : 'none',
    builtinSfxCount: Object.keys(builtinSfx).length,
  }
}
