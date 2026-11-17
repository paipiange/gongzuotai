import { describe, expect, it } from 'vitest'
import { computeCoverCrop } from './imageProcessing'

describe('computeCoverCrop', () => {
  it('源图更宽时裁掉左右', () => {
    const crop = computeCoverCrop(2000, 800, 900, 383)
    // 目标比例 ≈ 2.35；源图比例 2.5，裁后宽 = 800 * 2.35 ≈ 1880
    expect(crop.sy).toBe(0)
    expect(crop.sh).toBe(800)
    expect(crop.sw).toBeCloseTo(800 * (900 / 383), 0)
    expect(crop.sx).toBeCloseTo((2000 - crop.sw) / 2, 0)
  })

  it('源图更高时裁掉上下', () => {
    const crop = computeCoverCrop(800, 2000, 900, 383)
    expect(crop.sx).toBe(0)
    expect(crop.sw).toBe(800)
    expect(crop.sh).toBeCloseTo(800 / (900 / 383), 0)
    expect(crop.sy).toBeCloseTo((2000 - crop.sh) / 2, 0)
  })

  it('比例相同则整图使用', () => {
    const crop = computeCoverCrop(900, 383, 900, 383)
    expect(crop).toEqual({ sx: 0, sy: 0, sw: 900, sh: 383 })
  })

  it('非法尺寸返回原图区域', () => {
    expect(computeCoverCrop(0, 100, 900, 383)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 100 })
  })
})
