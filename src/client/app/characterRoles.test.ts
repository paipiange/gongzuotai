import { describe, expect, it } from 'vitest'
import { listCharacterRoles, removeCharacterRole, saveCharacterRole, type CharacterRole } from './characterRoles'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

const IMG = 'data:image/png;base64,AAAA'

describe('characterRoles', () => {
  it('saves, lists and removes roles', () => {
    const storage = new MemoryStorage()
    expect(listCharacterRoles(storage)).toEqual([])

    const saved = saveCharacterRole({ name: '小明', dataUrl: IMG }, storage)
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('小明')
    expect(saved[0].dataUrl).toBe(IMG)

    const removed = removeCharacterRole(saved[0].id, storage)
    expect(removed).toEqual([])
  })

  it('rejects non-image data URLs', () => {
    const storage = new MemoryStorage()
    expect(() => saveCharacterRole({ name: 'x', dataUrl: 'not-an-image' }, storage)).toThrow(/必须是图片/)
  })

  it('caps the number of roles to 20', () => {
    const storage = new MemoryStorage()
    for (let i = 0; i < 25; i += 1) {
      saveCharacterRole({ name: `角色${i}`, dataUrl: IMG }, storage)
    }
    expect(listCharacterRoles(storage)).toHaveLength(20)
  })

  it('survives corrupted storage gracefully', () => {
    const storage = new MemoryStorage()
    storage.setItem('paipiange.characterRoles', '{bad json')
    expect(listCharacterRoles(storage)).toEqual([])
  })
})
