import { describe, expect, it } from 'vitest'
import { normalizeTaskOrigin } from './taskOrigin'

describe('normalizeTaskOrigin', () => {
  it('keeps safe resume state and strips credentials or embedded image data', () => {
    expect(normalizeTaskOrigin({
      kind: 'template',
      id: 'comic-template',
      label: 'Q 版情侣漫画',
      state: {
        values: { theme: '开心' },
        apiKey: 'must-not-be-recorded',
        image: 'data:image/png;base64,abc',
      },
    })).toEqual({
      kind: 'template',
      id: 'comic-template',
      label: 'Q 版情侣漫画',
      state: { values: { theme: '开心' } },
    })
  })

  it('rejects unsupported origins', () => {
    expect(normalizeTaskOrigin({ kind: 'unknown', id: 'x' })).toBeUndefined()
    expect(normalizeTaskOrigin({ kind: 'studio', id: '' })).toBeUndefined()
  })
})
