/**
 * Audio Beat, Downbeat & Energy-Drop Analyzer + Beat-Locked Scene/SFX Quantizer.
 * Uses FFmpeg 8kHz mono PCM decoding + onset energy-flux autocorrelation to detect
 * actual tempo (BPM), phase offset, bar downbeats, and musical energy drops on any
 * user-supplied BGM track (`.mp3`, `.wav`, `.m4a`, `.flac`, `.ogg`).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { REPO_ROOT, resolveBinaries, runCommandRedirected } from '../shared/index.js'

/**
 * Analyze actual BPM, beat phase, bar downbeats, and structural drops from an audio file.
 */
export async function analyzeAudioBeatStructure(audioPath, opts = {}) {
  const absAudio = resolve(audioPath)
  if (!existsSync(absAudio)) {
    throw new Error(`BGM audio file not found for beat analysis: ${absAudio}`)
  }

  const minBpm = Math.max(60, Number(opts.minBpm) || 76)
  const maxBpm = Math.min(180, Number(opts.maxBpm) || 156)
  const { ffmpeg } = resolveBinaries()
  const tmpDir = join(REPO_ROOT, '.tmp')
  mkdirSync(tmpDir, { recursive: true })
  const rawPcm = join(tmpDir, `beat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.f32`)

  let samples
  const sr = 8000
  try {
    const res = await runCommandRedirected(
      ffmpeg,
      ['-y', '-v', 'error', '-i', absAudio, '-ac', '1', '-ar', String(sr), '-f', 'f32le', rawPcm],
      { timeoutMs: 45_000, signal: opts.signal },
    )
    if (res.code !== 0 || !existsSync(rawPcm)) {
      throw new Error(`FFmpeg beat decode failed: ${res.stderr || `code ${res.code}`}`)
    }
    const buf = readFileSync(rawPcm)
    samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  } finally {
    try {
      if (existsSync(rawPcm)) unlinkSync(rawPcm)
    } catch {}
  }

  const totalDurSec = Number((samples.length / sr).toFixed(4))
  if (samples.length < sr) {
    return {
      ok: true,
      analyzed: true,
      audioPath: absAudio,
      durationSec: totalDurSec,
      bpm: 112,
      beatSec: Number((60 / 112).toFixed(4)),
      phaseSec: 0,
      barOffset: 0,
      beats: [{ time: 0, strong: true, index: 0, barIndex: 0, beatInBar: 0, energy: 1 }],
      downbeats: [0],
      drops: [],
      energyCurve: [],
    }
  }

  // 20ms hop -> 50Hz RMS envelope
  const hop = 160
  const envSr = sr / hop
  const envLen = Math.floor(samples.length / hop)
  const env = new Float32Array(envLen)
  const flux = new Float32Array(envLen)

  let globalSum = 0
  for (let i = 0; i < envLen; i++) {
    let e = 0
    const off = i * hop
    for (let j = 0; j < hop; j++) {
      const s = samples[off + j]
      e += s * s
    }
    const rms = Math.sqrt(e / hop)
    env[i] = rms
    globalSum += rms
    flux[i] = i > 0 ? Math.max(0, rms - env[i - 1]) : 0
  }
  const meanEnv = envLen > 0 ? globalSum / envLen : 0.1

  // Comb autocorrelation over 1x, 2x, 4x beat lags to locate fundamental tempo
  let bestBpm = 100
  let bestScore = -1
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const lag = (60 / bpm) * envSr
    let score = 0
    const limit = Math.min(envLen, Math.round(envSr * 120))
    for (let i = 0; i < limit; i++) {
      const j1 = Math.round(i + lag)
      const j2 = Math.round(i + lag * 2)
      const j4 = Math.round(i + lag * 4)
      if (j4 >= limit) break
      score += flux[i] * (flux[j1] * 0.52 + flux[j2] * 0.34 + flux[j4] * 0.24)
    }
    // Slight perceptual weighting toward modern editorial pulse center [86..132] BPM
    const centerBias = bpm >= 84 && bpm <= 134 ? 1.06 : 0.96
    const weighted = score * centerBias
    if (weighted > bestScore) {
      bestScore = weighted
      bestBpm = bpm
    }
  }

  // Fine phase offset search [0, beatSec) at 10ms resolution anchored to transient peaks
  const beatSec = 60 / bestBpm
  let phaseSec = 0
  let bestPhaseScore = -1
  for (let ph = 0; ph < beatSec; ph += 0.01) {
    let pScore = 0
    for (let t = ph; t < totalDurSec; t += beatSec) {
      const idx = Math.round(t * envSr)
      if (idx < flux.length) {
        const peak = Math.max(flux[Math.max(0, idx - 1)] || 0, flux[idx], flux[Math.min(flux.length - 1, idx + 1)] || 0)
        pScore += peak
      }
    }
    if (pScore > bestPhaseScore) {
      bestPhaseScore = pScore
      phaseSec = Number(ph.toFixed(3))
    }
  }

  // Raw beats starting from aligned phaseSec
  const rawBeats = []
  let idx = 0
  for (let t = phaseSec; t <= totalDurSec + 0.05; t += beatSec) {
    const frame = Math.min(envLen - 1, Math.max(0, Math.round(t * envSr)))
    const localFlux = Math.max(flux[Math.max(0, frame - 1)] || 0, flux[frame] || 0, flux[Math.min(envLen - 1, frame + 1)] || 0)
    const energy = Number(((env[frame] || 0) / Math.max(1e-4, meanEnv)).toFixed(3))
    rawBeats.push({
      time: Number(t.toFixed(4)),
      index: idx,
      energy,
      onset: localFlux,
    })
    idx++
  }

  // Determine strongest bar phase (0..3) so bar downbeats align to true bar-1 hits
  const modScores = [0, 0, 0, 0]
  for (const b of rawBeats) {
    modScores[b.index % 4] += b.onset * 0.7 + b.energy * 0.3
  }
  let barOffset = 0
  for (let m = 1; m < 4; m++) {
    if (modScores[m] > modScores[barOffset]) barOffset = m
  }

  // Per-2s energy bins + structural drops detection
  const energyCurve = []
  for (let sec = 0; sec + 1 < totalDurSec; sec += 2) {
    const i0 = Math.round(sec * envSr)
    const i1 = Math.min(envLen, Math.round((sec + 2) * envSr))
    if (i1 <= i0) continue
    let s = 0
    for (let k = i0; k < i1; k++) s += env[k]
    energyCurve.push({ sec, rms: Number((s / (i1 - i0)).toFixed(4)) })
  }

  const dropSet = new Set()
  const drops = []
  for (let bi = 1; bi < energyCurve.length; bi++) {
    const prev = energyCurve[bi - 1]
    const cur = energyCurve[bi]
    const jump = cur.rms / Math.max(1e-4, prev.rms)
    if (jump >= 1.24 && cur.rms >= meanEnv * 0.85) {
      // Snap drop timestamp to nearest downbeat or beat
      const target = cur.sec
      let bestBeat = rawBeats[0]
      let bestDist = Infinity
      for (const b of rawBeats) {
        const d = Math.abs(b.time - target)
        if (d < bestDist) {
          bestDist = d
          bestBeat = b
        }
      }
      if (bestBeat && !dropSet.has(bestBeat.index)) {
        dropSet.add(bestBeat.index)
        drops.push(bestBeat.time)
      }
    }
  }

  const beats = rawBeats.map((b) => {
    const beatInBar = (b.index - barOffset + 4000) % 4
    const barIndex = Math.floor((b.index - barOffset + 4) / 4)
    const strong = beatInBar === 0 || dropSet.has(b.index)
    return {
      time: b.time,
      strong,
      isDrop: dropSet.has(b.index),
      index: b.index,
      barIndex: Math.max(0, barIndex),
      beatInBar,
      energy: b.energy,
    }
  })

  const downbeats = beats.filter((b) => b.strong).map((b) => b.time)

  return {
    ok: true,
    analyzed: true,
    audioPath: absAudio,
    durationSec: totalDurSec,
    bpm: Number(bestBpm.toFixed(1)),
    beatSec: Number(beatSec.toFixed(4)),
    phaseSec,
    barOffset,
    beats,
    downbeats,
    drops,
    energyCurve,
  }
}

/**
 * Find the best matching beat/downbeat timestamp near or at/after a target time.
 */
export function snapTimeToBeatGrid(targetSec, beatMeta, { preferDownbeat = true, direction = 'forward', maxShiftSec = 1.8 } = {}) {
  const beats = Array.isArray(beatMeta?.beats) ? beatMeta.beats : []
  if (beats.length === 0) return Number(targetSec.toFixed(4))

  const pool = preferDownbeat ? beats.filter((b) => b.strong) : beats
  const searchList = pool.length > 0 ? pool : beats

  if (direction === 'nearest') {
    let best = targetSec
    let bestDiff = Infinity
    for (const b of searchList) {
      const t = typeof b === 'number' ? b : Number(b.time)
      const diff = Math.abs(t - targetSec)
      if (diff <= maxShiftSec && diff < bestDiff) {
        bestDiff = diff
        best = t
      }
    }
    return Number(best.toFixed(4))
  }

  for (const b of searchList) {
    const t = typeof b === 'number' ? b : Number(b.time)
    if (t >= targetSec - 0.04 && t - targetSec <= maxShiftSec) {
      return Number(t.toFixed(4))
    }
  }
  if (preferDownbeat) {
    return snapTimeToBeatGrid(targetSec, beatMeta, { preferDownbeat: false, direction, maxShiftSec })
  }
  return Number(targetSec.toFixed(4))
}

/**
 * Quantize scenes & subtitles cleanly to measured BGM beat timestamps.
 * - `subtitle-mv`: scene cut points align cleanly to beat/downbeat boundaries matching total duration / beatCounts.
 * - `tts-beat-sync`: preserves spoken speech duration and pads trailing silence cleanly to the next musical beat/downbeat.
 */
export function quantizeScenesToBeatGrid(scenes = [], beatMeta = {}, opts = {}) {
  const { mode = 'tts-beat-sync', fps = 30, targetDurationSec = 0 } = opts || {}
  if (!Array.isArray(scenes) || scenes.length === 0) return []
  const beats = Array.isArray(beatMeta?.beats) && beatMeta.beats.length > 0 ? beatMeta.beats : []
  const beatStep = Number(beatMeta?.beatSec) || (60 / (Number(beatMeta?.bpm) || 112))
  const safeFps = Number(fps) > 0 ? Number(fps) : 30

  if (beats.length === 0) return scenes

  const normBeats = beats
    .map((b, i) => (typeof b === 'number' ? { time: b, strong: i % 4 === 0, index: i } : b))
    .filter((b) => Number.isFinite(Number(b?.time)))
    .sort((a, b) => a.time - b.time)

  const maxBgmDur = Number(beatMeta?.durationSec) || normBeats[normBeats.length - 1]?.time || 60
  // NEVER clamp user's targetDurationSec down to a shorter BGM file!
  // BGM loops seamlessly in FFmpeg (`-stream_loop -1`), so extend the beat grid to cover targetDurationSec.
  const capDur = targetDurationSec > 4 ? targetDurationSec : maxBgmDur
  if (normBeats.length > 0 && normBeats[normBeats.length - 1].time < capDur + 4) {
    const barOffset = Number(beatMeta?.barOffset) || 0
    let lastT = normBeats[normBeats.length - 1].time
    let nextIdx = (Number(normBeats[normBeats.length - 1].index) || normBeats.length - 1) + 1
    while (lastT < capDur + 4) {
      lastT = Number((lastT + beatStep).toFixed(4))
      normBeats.push({
        time: lastT,
        strong: (nextIdx - barOffset + 4000) % 4 === 0,
        index: nextIdx,
      })
      nextIdx++
    }
  }

  const updated = scenes.map((s) => ({ ...s }))
  const audioProf = resolveAdaptiveAudioProfile(opts)
  const allowBlitzCut = audioProf.blitzAllowed !== false
  const minBeatSpan = Math.max(0.5, Number(audioProf.minBeatMultiple) || (allowBlitzCut ? 0.5 : 1.0))

  if (mode === 'subtitle-mv') {
    const usableBeats = normBeats.filter((b) => b.time <= capDur + 0.1)
    const fallbackBeats = usableBeats.length >= scenes.length + 1 ? usableBeats : normBeats
    const totalAvailableBeats = Math.max(scenes.length, Math.round(capDur / beatStep))

    // Allocate beat counts honoring explicit `beatCount` hints (0.5-beat blitzes when allowed by genre/AI audioProfile)
    const rawCounts = updated.map((sc, idx) => {
      const explicit = Number(sc.beatCount)
      if (Number.isFinite(explicit) && explicit >= 0.45) return allowBlitzCut ? explicit : Math.max(minBeatSpan, explicit)
      const hintDur = Number(sc.durationSec)
      if (Number.isFinite(hintDur) && hintDur >= 0.26 && targetDurationSec <= 0) {
        return Math.max(minBeatSpan, Number((hintDur / beatStep).toFixed(2)))
      }
      if (sc.stageSpec?.archetype === 'slash-climax' || sc.transition === 'flash-cut') return allowBlitzCut ? 1 : Math.max(1, minBeatSpan)
      if (idx === 0 || idx === updated.length - 1) return 4
      return Math.max(minBeatSpan, 3)
    })

    const rawSum = rawCounts.reduce((a, b) => a + b, 0) || scenes.length
    const scale = targetDurationSec > 0 || rawSum > totalAvailableBeats ? totalAvailableBeats / rawSum : 1

    let beatCursor = 0
    let subBeatAcc = 0
    // Start scene 0 at frame 0 while syncing scene 1+ cuts strictly onto real beat or half-beat hits
    let curStartSec = 0
    for (let i = 0; i < updated.length; i++) {
      const sc = updated[i]
      const isLast = i === updated.length - 1
      const scaledRaw = rawCounts[i] * scale
      const spanBeats = allowBlitzCut && scaledRaw <= 0.72 ? 0.5 : Math.max(minBeatSpan >= 2 ? 2 : 1, Math.round(scaledRaw))

      if (spanBeats < 1) {
        subBeatAcc += spanBeats
        if (subBeatAcc >= 0.99) {
          beatCursor += Math.floor(subBeatAcc + 0.01)
          subBeatAcc = subBeatAcc - Math.floor(subBeatAcc + 0.01)
        }
      } else {
        if (i === 0 && beatMeta.phaseSec > 0.25 && beatMeta.phaseSec < beatStep * 1.2) {
          beatCursor = Math.max(1, Math.round(spanBeats) - 1)
        } else {
          beatCursor += Math.round(spanBeats)
        }
      }

      let nextBoundarySec
      if (isLast) {
        nextBoundarySec = targetDurationSec > 0
          ? Math.max(curStartSec + 1.2, Math.min(capDur, curStartSec + spanBeats * beatStep))
          : Math.min(maxBgmDur, Math.max(curStartSec + 1.5, curStartSec + spanBeats * beatStep))
      } else if (spanBeats < 1) {
        const halfSec = Math.max(0.27, spanBeats * beatStep)
        nextBoundarySec = curStartSec + halfSec
      } else {
        // Snap cut to nearest strong downbeat when span >= 4 beats to feel ultra-locked
        const candBeat = beatCursor < fallbackBeats.length ? fallbackBeats[beatCursor] : null
        let cutSec = candBeat && candBeat.time > curStartSec + 0.3 ? candBeat.time : curStartSec + spanBeats * beatStep
        if (spanBeats >= 4 && candBeat && !candBeat.strong) {
          const nearbyStrong = fallbackBeats.find((b) => b.strong && Math.abs(b.time - cutSec) <= beatStep * 1.1 && b.time > curStartSec + 0.5)
          if (nearbyStrong) {
            cutSec = nearbyStrong.time
            beatCursor = fallbackBeats.indexOf(nearbyStrong)
            subBeatAcc = 0
          }
        }
        nextBoundarySec = Math.max(curStartSec + 0.27, cutSec)
      }

      const startFrame = Math.round(curStartSec * safeFps)
      const endFrame = Math.max(startFrame + 8, Math.round(nextBoundarySec * safeFps))
      const durFrames = endFrame - startFrame
      const durSec = Number((durFrames / safeFps).toFixed(4))

      sc.startSec = Number((startFrame / safeFps).toFixed(4))
      sc.endSec = Number((endFrame / safeFps).toFixed(4))
      sc.durationSec = durSec
      sc.startFrame = startFrame
      sc.endFrame = endFrame
      sc.durationInFrames = durFrames
      sc.beatCutAligned = true

      // Align scene subtitle lines proportionally inside beat-locked scene
      const chunks = Array.isArray(sc.subChunks) && sc.subChunks.length > 0
        ? sc.subChunks
        : Array.isArray(sc.subtitles) && sc.subtitles.length > 0
          ? sc.subtitles.map((u) => u.text).filter(Boolean)
          : sc.subtitleText
            ? [sc.subtitleText]
            : sc.narration
              ? [sc.narration]
              : []

      if (chunks.length > 0) {
        const totalW = chunks.reduce((acc, c) => acc + Math.max(1, String(c).length), 0)
        let subCur = 0
        sc.subtitles = chunks.map((text, ci) => {
          const w = Math.max(1, String(text).length)
          const isLastSub = ci === chunks.length - 1
          const localEnd = isLastSub ? durSec : Math.min(durSec, Number((subCur + (durSec * w) / totalW).toFixed(3)))
          const item = {
            index: ci + 1,
            text: String(text).trim(),
            startSec: Number(subCur.toFixed(3)),
            endSec: Number(localEnd.toFixed(3)),
            startFrame: Math.floor(subCur * safeFps),
            endFrame: Math.ceil(localEnd * safeFps),
            sceneId: sc.id,
            localStartSec: Number(subCur.toFixed(3)),
            localEndSec: Number(localEnd.toFixed(3)),
            globalStartSec: Number((sc.startSec + subCur).toFixed(3)),
            globalEndSec: Number((sc.startSec + localEnd).toFixed(3)),
            globalStartFrame: startFrame + Math.floor(subCur * safeFps),
            globalEndFrame: startFrame + Math.ceil(localEnd * safeFps),
          }
          subCur = localEnd
          return item
        })
      }

      curStartSec = sc.endSec
    }
    return updated
  }

  // Mode 2: tts-beat-sync — honor TTS voice duration + pause, snap trailing boundary to next beat/downbeat
  // If user requested a specific targetDurationSec longer than raw speech, distribute musical breathing evenly
  const rawMinTotal = updated.reduce(
    (acc, sc) => acc + Math.max(Number(sc.durationSec) || 2.5, (Number(sc.voiceDurationSec) || 0) + (Number(sc.voiceLeadSec) ?? 0.28) + 0.2),
    0,
  )
  const extraPadPerScene =
    targetDurationSec > 4 && rawMinTotal > 2 && rawMinTotal < targetDurationSec * 0.96
      ? Math.min(4.2, (targetDurationSec - rawMinTotal) / Math.max(1, updated.length))
      : 0

  let cursorSec = 0
  let cursorFrame = 0
  for (let i = 0; i < updated.length; i++) {
    const sc = updated[i]
    const baseMinDur = Math.max(Number(sc.durationSec) || 2.5, (Number(sc.voiceDurationSec) || 0) + (Number(sc.voiceLeadSec) ?? 0.28) + 0.2)
    const minDur = baseMinDur + extraPadPerScene
    const minEnd = cursorSec + minDur
    const snappedEnd = i === updated.length - 1
      ? Math.max(minEnd, targetDurationSec > 4 && rawMinTotal < targetDurationSec ? Math.min(targetDurationSec, minEnd + 2.0) : minEnd)
      : snapTimeToBeatGrid(minEnd, { beats: normBeats }, { preferDownbeat: extraPadPerScene >= beatStep, direction: 'forward', maxShiftSec: beatStep * 1.45 })

    const endFrame = Math.max(cursorFrame + 18, Math.round(snappedEnd * safeFps))
    const durFrames = endFrame - cursorFrame
    const durSec = Number((durFrames / safeFps).toFixed(4))

    sc.startFrame = cursorFrame
    sc.durationInFrames = durFrames
    sc.endFrame = endFrame
    sc.startSec = Number((cursorFrame / safeFps).toFixed(4))
    sc.endSec = Number((endFrame / safeFps).toFixed(4))
    sc.durationSec = durSec
    sc.beatCutAligned = true

    if (Array.isArray(sc.subtitles)) {
      sc.subtitles = sc.subtitles.map((sub) => {
        const l0 = Number(sub.localStartSec ?? sub.startSec ?? 0)
        const l1 = Math.min(durSec, Number(sub.localEndSec ?? sub.endSec ?? durSec))
        return {
          ...sub,
          sceneId: sc.id,
          localStartSec: l0,
          localEndSec: l1,
          globalStartSec: Number((sc.startSec + l0).toFixed(3)),
          globalEndSec: Number((sc.startSec + l1).toFixed(3)),
          globalStartFrame: cursorFrame + Math.round(l0 * safeFps),
          globalEndFrame: cursorFrame + Math.round(l1 * safeFps),
        }
      })
    }

    cursorFrame = endFrame
    cursorSec = sc.endSec
  }

  return updated
}

/**
 * Universal Cross-Genre Adaptive Audio-Visual Rhythm Profiles.
 * Ensures FFmpeg beat-grid quantization, 48kHz procedural SFX choreography, camera beat pulse,
 * BGM sidechain ducking, and EBU R128 loudness mastering automatically adapt to EVERY video genre
 * (and honor any AI Director `script.audioProfile` custom override for open/custom genres!).
 */
export const GENRE_AUDIO_PROFILES = {
  'history-theater': {
    profileName: '史诗高燃卡点声场',
    beatCutIntensity: 'high',
    blitzAllowed: true,
    minBeatMultiple: 0.5,
    cameraBeatIntensity: 1.0,
    targetLufs: -14.0,
    bgmDuckRatio: 2.2,
    sfxBoostVoice: 1.28,
    sfxBoostMv: 1.65,
    bgmVolVoice: 0.48,
    bgmVolMv: 0.84,
    sfxPalette: {
      opener: ['hit', 'shimmer_swell'],
      drop: ['sub_drop', 'crash_cym'],
      action: ['slash', 'hit'],
      data: ['stamp', 'flip'],
      neutral: ['whoosh', 'hit'],
      internal: ['slash', 'hit', 'stamp'],
      preCut: ['riser', 'suck'],
    },
  },
  'mv-lyric': {
    profileName: '高燃节奏卡点 MV 声场',
    beatCutIntensity: 'high',
    blitzAllowed: true,
    minBeatMultiple: 0.5,
    cameraBeatIntensity: 0.92,
    targetLufs: -14.0,
    bgmDuckRatio: 2.1,
    sfxBoostVoice: 1.25,
    sfxBoostMv: 1.55,
    bgmVolVoice: 0.50,
    bgmVolMv: 0.86,
    sfxPalette: {
      opener: ['riser', 'hit'],
      drop: ['sub_drop', 'crash_cym'],
      action: ['slash', 'shutter'],
      data: ['sparkle', 'chime'],
      neutral: ['whoosh', 'pop_soft'],
      internal: ['hit', 'shutter', 'sparkle'],
      preCut: ['riser', 'suck'],
    },
  },
  'product-promo': {
    profileName: '科技旗舰商业发布会声场',
    beatCutIntensity: 'medium',
    blitzAllowed: true,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.48,
    targetLufs: -14.0,
    bgmDuckRatio: 2.6,
    sfxBoostVoice: 1.15,
    sfxBoostMv: 1.38,
    bgmVolVoice: 0.42,
    bgmVolMv: 0.80,
    sfxPalette: {
      opener: ['riser', 'shine'],
      drop: ['sub_drop', 'shine'],
      action: ['swoosh', 'shutter'],
      data: ['counter', 'radar'],
      neutral: ['whoosh', 'pop_soft'],
      internal: ['sparkle', 'shutter', 'chime'],
      preCut: ['riser', 'swoosh'],
    },
  },
  'ui-tutorial': {
    profileName: '软件实操清晰键鼠声场',
    beatCutIntensity: 'gentle',
    blitzAllowed: false,
    minBeatMultiple: 2.0,
    cameraBeatIntensity: 0.0,
    targetLufs: -15.0,
    bgmDuckRatio: 3.4,
    sfxBoostVoice: 0.84,
    sfxBoostMv: 1.05,
    bgmVolVoice: 0.30,
    bgmVolMv: 0.68,
    sfxPalette: {
      opener: ['chime', 'pop_soft'],
      drop: ['card', 'chime'],
      action: ['click', 'pop_soft'],
      data: ['typing', 'tick'],
      neutral: ['click', 'card'],
      internal: ['click', 'typing', 'pop_soft'],
      preCut: ['swoosh', 'flip'],
    },
  },
  'code-animation': {
    profileName: '代码与架构演进精密声场',
    beatCutIntensity: 'gentle',
    blitzAllowed: false,
    minBeatMultiple: 2.0,
    cameraBeatIntensity: 0.12,
    targetLufs: -14.8,
    bgmDuckRatio: 3.2,
    sfxBoostVoice: 0.92,
    sfxBoostMv: 1.18,
    bgmVolVoice: 0.34,
    bgmVolMv: 0.72,
    sfxPalette: {
      opener: ['radar', 'chime'],
      drop: ['glitch', 'shine'],
      action: ['typing', 'radar'],
      data: ['counter', 'tick'],
      neutral: ['click', 'swoosh'],
      internal: ['typing', 'radar', 'lock'],
      preCut: ['swoosh', 'riser'],
    },
  },
  'science-explainer': {
    profileName: '深度科普动态拆解声场',
    beatCutIntensity: 'medium',
    blitzAllowed: false,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.24,
    targetLufs: -14.5,
    bgmDuckRatio: 3.0,
    sfxBoostVoice: 1.02,
    sfxBoostMv: 1.24,
    bgmVolVoice: 0.36,
    bgmVolMv: 0.74,
    sfxPalette: {
      opener: ['shimmer_swell', 'radar'],
      drop: ['sub_drop', 'sparkle'],
      action: ['whoosh', 'radar'],
      data: ['counter', 'tick'],
      neutral: ['card', 'pop_soft'],
      internal: ['radar', 'counter', 'sparkle'],
      preCut: ['riser', 'swoosh'],
    },
  },
  'data-story': {
    profileName: '数据榜单与商业洞察声场',
    beatCutIntensity: 'medium',
    blitzAllowed: true,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.30,
    targetLufs: -14.3,
    bgmDuckRatio: 2.9,
    sfxBoostVoice: 1.08,
    sfxBoostMv: 1.32,
    bgmVolVoice: 0.38,
    bgmVolMv: 0.76,
    sfxPalette: {
      opener: ['counter', 'shine'],
      drop: ['sub_drop', 'stamp'],
      action: ['counter', 'whoosh'],
      data: ['counter', 'tick'],
      neutral: ['card', 'tick'],
      internal: ['counter', 'tick', 'chime'],
      preCut: ['riser', 'swoosh'],
    },
  },
  'stickman-story': {
    profileName: '趣味故事/轻喜剧节奏声场',
    beatCutIntensity: 'medium',
    blitzAllowed: false,
    minBeatMultiple: 1.0,
    cameraBeatIntensity: 0.32,
    targetLufs: -14.5,
    bgmDuckRatio: 3.0,
    sfxBoostVoice: 1.06,
    sfxBoostMv: 1.25,
    bgmVolVoice: 0.36,
    bgmVolMv: 0.74,
    sfxPalette: {
      opener: ['pop', 'chime'],
      drop: ['boing', 'sparkle'],
      action: ['pop', 'whoosh'],
      data: ['flip', 'tick'],
      neutral: ['pop_soft', 'flip'],
      internal: ['pop', 'boing', 'chime'],
      preCut: ['swoosh', 'pop_soft'],
    },
  },
  'brand-story': {
    profileName: '品牌人文与治愈叙事声场',
    beatCutIntensity: 'gentle',
    blitzAllowed: false,
    minBeatMultiple: 2.0,
    cameraBeatIntensity: 0.16,
    targetLufs: -14.8,
    bgmDuckRatio: 2.8,
    sfxBoostVoice: 0.90,
    sfxBoostMv: 1.12,
    bgmVolVoice: 0.42,
    bgmVolMv: 0.78,
    sfxPalette: {
      opener: ['shimmer_swell', 'bell_warm'],
      drop: ['shimmer_swell', 'shine'],
      action: ['swoosh', 'shutter'],
      data: ['flip', 'bell_warm'],
      neutral: ['swoosh', 'pop_soft'],
      internal: ['bell_warm', 'sparkle'],
      preCut: ['shimmer_swell', 'swoosh'],
    },
  },
  'talking-head': {
    profileName: '口播干货清晰人声声场',
    beatCutIntensity: 'gentle',
    blitzAllowed: false,
    minBeatMultiple: 2.0,
    cameraBeatIntensity: 0.08,
    targetLufs: -15.0,
    bgmDuckRatio: 3.4,
    sfxBoostVoice: 0.85,
    sfxBoostMv: 1.05,
    bgmVolVoice: 0.30,
    bgmVolMv: 0.68,
    sfxPalette: {
      opener: ['pop_soft', 'chime'],
      drop: ['pop', 'chime'],
      action: ['swoosh', 'pop'],
      data: ['tick', 'card'],
      neutral: ['pop_soft', 'card'],
      internal: ['pop_soft', 'chime'],
      preCut: ['swoosh', 'flip'],
    },
  },
}

/**
 * Resolve the adaptive audio/rhythm profile for ANY video genre or custom AI Director override.
 */
export function resolveAdaptiveAudioProfile(opts = {}) {
  const genreRaw = String(opts.genre || opts.referenceStyle?.genre || '').trim().toLowerCase()
  const labelRaw = `${opts.genreLabel || ''} ${opts.title || ''} ${opts.topic || ''} ${opts.style || ''}`.toLowerCase()

  let baseKey = GENRE_AUDIO_PROFILES[genreRaw] ? genreRaw : ''
  if (!baseKey) {
    if (/历史|史诗|战国|秦|汉|楚|三国|武侠|高燃|燃剪|卡点|mv|节奏/.test(labelRaw)) baseKey = 'history-theater'
    else if (/教程|实操|指南|教学|软件|界面|操作|演示|ui/.test(labelRaw)) baseKey = 'ui-tutorial'
    else if (/代码|架构|编程|开源|源码|api|算法/.test(labelRaw)) baseKey = 'code-animation'
    else if (/发布|产品|宣传|旗舰|科技|商业|广告|promo/.test(labelRaw)) baseKey = 'product-promo'
    else if (/数据|榜单|排行|财报|对比|趋势|统计|洞察/.test(labelRaw)) baseKey = 'data-story'
    else if (/科普|原理|解剖|科学|物理|生物|天文|拆解/.test(labelRaw)) baseKey = 'science-explainer'
    else if (/火柴人|搞笑|段子|吐槽|漫剧|趣味|故事/.test(labelRaw)) baseKey = 'stickman-story'
    else if (/治愈|旅行|vlog|纪录|温暖|品牌|情感|人文|美食/.test(labelRaw)) baseKey = 'brand-story'
    else if (/口播|访谈|干货|解说/.test(labelRaw)) baseKey = 'talking-head'
    else if (opts.style === 'energetic') baseKey = 'product-promo'
    else if (opts.style === 'warm' || opts.style === 'documentary') baseKey = 'brand-story'
    else if (opts.style === 'cinematic') baseKey = 'history-theater'
    else baseKey = 'product-promo'
  }

  const base = GENRE_AUDIO_PROFILES[baseKey] || GENRE_AUDIO_PROFILES['product-promo']
  const aiOv = opts.audioProfile && typeof opts.audioProfile === 'object' ? opts.audioProfile : {}
  const mergedPalette = {
    ...base.sfxPalette,
    ...(aiOv.sfxPalette && typeof aiOv.sfxPalette === 'object' ? aiOv.sfxPalette : {}),
  }

  const intensity = String(aiOv.beatCutIntensity || base.beatCutIntensity).toLowerCase()
  const clampNum = (v, min, max, fallback) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }

  return {
    genreKey: baseKey,
    profileName: String(aiOv.profileName || base.profileName),
    beatCutIntensity: ['high', 'medium', 'gentle', 'off'].includes(intensity) ? intensity : base.beatCutIntensity,
    blitzAllowed: typeof aiOv.blitzAllowed === 'boolean' ? aiOv.blitzAllowed : (intensity === 'high' ? true : base.blitzAllowed),
    minBeatMultiple: clampNum(aiOv.minBeatMultiple, 0.5, 4, intensity === 'high' ? 0.5 : intensity === 'gentle' ? 2.0 : base.minBeatMultiple),
    cameraBeatIntensity: clampNum(aiOv.cameraBeatIntensity, 0, 1.2, base.cameraBeatIntensity),
    targetLufs: clampNum(aiOv.targetLufs, -18.0, -12.0, base.targetLufs),
    bgmDuckRatio: clampNum(aiOv.bgmDuckRatio, 1.4, 5.0, base.bgmDuckRatio),
    sfxBoostVoice: clampNum(aiOv.sfxBoostVoice ?? aiOv.sfxBoost, 0.4, 1.8, base.sfxBoostVoice),
    sfxBoostMv: clampNum(aiOv.sfxBoostMv ?? aiOv.sfxBoost, 0.6, 2.0, base.sfxBoostMv),
    bgmVolVoice: clampNum(aiOv.bgmVolVoice, 0.18, 0.65, base.bgmVolVoice),
    bgmVolMv: clampNum(aiOv.bgmVolMv, 0.5, 0.95, base.bgmVolMv),
    sfxPalette: mergedPalette,
  }
}

/**
 * Align transition & impact SFX cues onto real beat timestamps inside every scene,
 * automatically adapting SFX palette & density to ANY video genre or AI Director `audioProfile`!
 */
export function choreographBeatSfxCues(scenes = [], beatMeta = {}, opts = {}) {
  const beats = Array.isArray(beatMeta?.beats) ? beatMeta.beats : []
  const drops = Array.isArray(beatMeta?.drops) ? beatMeta.drops : []
  const total = scenes.length
  const sfxPick = opts.sfxPick || ((kind) => `audio/sfx/${kind}.wav`)
  const profile = resolveAdaptiveAudioProfile(opts)
  const pal = profile.sfxPalette || GENRE_AUDIO_PROFILES['product-promo'].sfxPalette
  const pickFrom = (arr, fallback, idx = 0) => {
    const list = Array.isArray(arr) && arr.length > 0 ? arr : [fallback]
    return String(list[idx % list.length] || fallback)
  }
  const volScale = profile.beatCutIntensity === 'gentle' ? 0.76 : profile.beatCutIntensity === 'medium' ? 0.90 : 1.0

  return scenes.map((sc, idx) => {
    const startSec = Number(sc.startSec || 0)
    const dur = Math.max(0.5, Number(sc.durationSec) || 4)
    const endSec = startSec + dur
    const cues = []

    const nearDrop = drops.some((dt) => Math.abs(dt - startSec) <= 0.35)
    const arch = sc.stageSpec?.archetype || ''
    const layoutStr = String(sc.layout || '')
    const blueStr = `${sc.visualBlueprint || ''} ${sc.motionNotes || ''} ${sc.title || ''}`
    const isAction =
      /slash|clash|oath|cavalry|duel/i.test(arch) ||
      sc.transition === 'flash-cut' ||
      sc.transition === 'slash-wipe' ||
      /冲击|爆发|劈|闪切|撞击|跃迁|点击|高光|切换/i.test(blueStr)
    const isMapOrData =
      /strategic-map|scroll-calligraphy|bamboo-slips|metric-dashboard|workflow-steps|chart|ranking|code/i.test(
        `${arch} ${layoutStr} ${blueStr}`,
      )

    // 1. Cut-in SFX right on beat boundary (adapted to genre palette!)
    if (idx === 0) {
      const a = pickFrom(pal.opener, 'hit', 0)
      const b = pickFrom(pal.opener, 'shimmer_swell', 1)
      cues.push({ type: a, path: sfxPick(a), offsetSec: 0, volume: Number((0.88 * volScale).toFixed(2)), pan: 0 })
      if (b && b !== a) {
        cues.push({ type: b, path: sfxPick(b), offsetSec: 0.02, volume: Number((0.70 * volScale).toFixed(2)), pan: 0 })
      }
    } else if (nearDrop || sc.transition === 'zoom-punch' || arch === 'plaque-summary' || sc.transition === 'glitch-cut') {
      const a = sc.transition === 'glitch-cut' ? 'glitch' : pickFrom(pal.drop, 'sub_drop', idx)
      const b = pickFrom(pal.drop, 'shine', idx + 1)
      cues.push({ type: a, path: sfxPick(a), offsetSec: 0, volume: Number((0.92 * volScale).toFixed(2)), pan: 0 })
      if (b && b !== a) {
        cues.push({ type: b, path: sfxPick(b), offsetSec: 0.015, volume: Number((0.64 * volScale).toFixed(2)), pan: 0.12 })
      }
    } else if (isAction) {
      const a = pickFrom(pal.action, 'whoosh', idx)
      const b = pickFrom(pal.action, 'hit', idx + 1)
      cues.push({ type: a, path: sfxPick(a), offsetSec: 0, volume: Number((0.86 * volScale).toFixed(2)), pan: idx % 2 === 0 ? -0.16 : 0.16 })
      if (b && b !== a && profile.beatCutIntensity !== 'gentle') {
        cues.push({ type: b, path: sfxPick(b), offsetSec: 0.012, volume: Number((0.76 * volScale).toFixed(2)), pan: 0 })
      }
    } else if (isMapOrData) {
      const a = pickFrom(pal.data, 'counter', idx)
      const b = pickFrom(pal.data, 'flip', idx + 1)
      cues.push({ type: a, path: sfxPick(a), offsetSec: 0, volume: Number((0.80 * volScale).toFixed(2)), pan: 0 })
      if (b && b !== a) {
        cues.push({ type: b, path: sfxPick(b), offsetSec: 0.02, volume: Number((0.58 * volScale).toFixed(2)), pan: -0.1 })
      }
    } else {
      const a = pickFrom(pal.neutral, 'whoosh', idx)
      cues.push({ type: a, path: sfxPick(a), offsetSec: 0, volume: Number((0.76 * volScale).toFixed(2)), pan: idx % 2 === 0 ? -0.1 : 0.1 })
      if (idx % 3 === 0 && profile.beatCutIntensity === 'high') {
        const b = pickFrom(pal.neutral, 'hit', 1)
        if (b && b !== a) cues.push({ type: b, path: sfxPick(b), offsetSec: 0.01, volume: Number((0.65 * volScale).toFixed(2)), pan: 0 })
      }
    }

    // 2. Snap mid-scene SFX accents directly to internal BGM beats (respecting gentle vs high intensity)
    const internalBeats = beats
      .map((b) => (typeof b === 'number' ? { time: b, strong: true } : b))
      .filter((b) => b.time > startSec + 0.32 && b.time < endSec - 0.38)

    const preferredBeats = internalBeats.filter((b) => b.strong)
    const maxInternalHits = profile.beatCutIntensity === 'gentle' ? (dur >= 4.5 ? 1 : 0) : dur >= 2.8 ? 2 : 1
    const chosenHits = (preferredBeats.length > 0 ? preferredBeats : internalBeats).slice(0, maxInternalHits)
    for (let hi = 0; hi < chosenHits.length; hi++) {
      const targetBeat = chosenHits[hi]
      const relSec = Number((targetBeat.time - startSec).toFixed(3))
      const beatType =
        arch === 'strategic-map'
          ? 'stamp'
          : arch === 'scroll-calligraphy' || arch === 'bamboo-slips'
            ? 'flip'
            : pickFrom(pal.internal, isMapOrData ? 'counter' : 'pop_soft', idx + hi)
      cues.push({
        type: beatType,
        path: sfxPick(beatType),
        offsetSec: relSec,
        volume: Number((0.74 * volScale).toFixed(2)),
        pan: (idx + hi) % 2 === 0 ? 0.2 : -0.2,
      })
    }

    // 3. Pre-cut riser/swoosh leading tightly INTO the next scene's downbeat cut
    if (idx < total - 1 && dur >= (profile.beatCutIntensity === 'gentle' ? 2.4 : 0.95)) {
      const riseDur = Math.min(0.42, dur * 0.35)
      const preOff = Number(Math.max(0.22, dur - riseDur).toFixed(3))
      const preType = pickFrom(pal.preCut, idx % 2 === 0 ? 'riser' : 'swoosh', idx)
      cues.push({
        type: preType,
        path: sfxPick(preType),
        offsetSec: preOff,
        volume: Number((0.62 * volScale).toFixed(2)),
        pan: 0,
        d: riseDur,
      })
    }

    return {
      ...sc,
      sfxCues: cues,
    }
  })
}
