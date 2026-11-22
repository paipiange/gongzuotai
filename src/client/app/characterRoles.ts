/**
 * 图片生成「人物/风格锁定」的角色库（纯前端 localStorage，符合本地优先隐私）。
 *
 * 把参考图保存为可复用的角色，后续生成时一键恢复该参考图，让 AI 配图保持
 * 同一人物形象/画风，避免「换脸」。数据仅存浏览器本地，不上传、不进 Host 库。
 */

export interface CharacterRole {
  id: string
  name: string
  /** 参考图 dataUrl（可能较大，仅存本地）。 */
  dataUrl: string
  savedAt: string
}

const STORAGE_KEY = 'paipiange.characterRoles'
const MAX_ROLES = 20
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** 读取全部角色（最旧在前）。纯函数，可注入 storage 便于测试。 */
export function listCharacterRoles(storage: Pick<Storage, 'getItem'> = localStorage): CharacterRole[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRole)
  } catch {
    return []
  }
}

/** 保存一个新角色，返回更新后的列表。超过上限时移除最旧的。 */
export function saveCharacterRole(input: { name: string; dataUrl: string }, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): CharacterRole[] {
  const name = input.name.trim() || '未命名角色'
  const dataUrl = input.dataUrl.trim()
  if (!dataUrl.startsWith('data:image/')) throw new Error('角色参考图必须是图片')
  if (dataUrl.length > MAX_IMAGE_BYTES) throw new Error('角色参考图不能超过 8MB')

  const role: CharacterRole = {
    id: `role-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    dataUrl,
    savedAt: new Date().toISOString(),
  }
  const next = [...listCharacterRoles(storage), role].slice(-MAX_ROLES)
  storage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

/** 删除一个角色，返回更新后的列表。 */
export function removeCharacterRole(id: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): CharacterRole[] {
  const next = listCharacterRoles(storage).filter((r) => r.id !== id)
  storage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

function isRole(value: unknown): value is CharacterRole {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<CharacterRole>
  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.dataUrl === 'string' && typeof r.savedAt === 'string'
}
