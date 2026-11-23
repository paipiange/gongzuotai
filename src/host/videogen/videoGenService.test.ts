import { describe, it, expect } from 'vitest'
import { generateVideo } from './videoGenService'
import { findBrowser } from './renderer'
import { findFfmpeg } from './encoder'
import type { LlmService } from '../textgen/types'

// 本测试走「浏览器渲染 + ffmpeg 合成」链路，依赖本机 Edge/Chrome 与 ffmpeg。
// CI（ubuntu）无这些依赖，跳过即可，不阻塞其余单元测试。
function hasVideoToolchain(): boolean {
  try {
    return findBrowser() !== null && (() => { findFfmpeg(); return true })()
  } catch {
    return false
  }
}

// Mock LLM 返回不可用文本，触发内置模板降级路径，验证「渲染 + 合成」链路。
const mockLlm: LlmService = {
  prepareCall: async () => ({
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text: '抱歉，无法生成 HTML。' }
      yield { type: 'finish', index: 0, reason: 'stop' }
    },
  }),
  listProviders: () => [],
}

describe.skipIf(!hasVideoToolchain())('generateVideo', () => {
  it('降级到内置模板并产出非空 MP4', async () => {
    const result = await generateVideo(
      mockLlm,
      { topic: '拍片哥工作台', subtitle: '验证', aspectRatio: '16:9', durationSec: 2, fps: 24, provider: 'mock', model: 'mock' },
      {},
    )
    expect(result.usedFallback).toBe(true)
    expect(result.mp4.byteLength).toBeGreaterThan(1000)
    expect(result.width).toBe(1280)
    expect(result.height).toBe(720)
    expect(result.totalFrames).toBe(48)
    // MP4 魔数检查（ftyp box）
    expect(result.mp4.subarray(4, 8).toString('ascii')).toBe('ftyp')
  }, 120000)
})
