import type { GeneratedImageResult, TaskRecord } from './hostClient'
import type { ComicRoleChoice } from './templateUtils'

type StudioDestination = 'article' | 'image' | 'video' | 'headline' | 'marketing' | 'xiaohongshu'

export type TaskResumeDestination =
  | { kind: 'studio'; studio: StudioDestination }
  | { kind: 'template'; templateId: string | null }
  | { kind: 'graphic'; sessionId: string | null }

export interface StoredTaskOrigin {
  kind: 'studio' | 'template' | 'graphic'
  id: string
  label?: string
  state: Record<string, unknown>
}

export interface ComicResumeState {
  templateId: string | null
  templateName: string
  theme: string
  roleChoice: ComicRoleChoice
  imageCount: number
  overlayText: string
  prompts: string[]
  results: GeneratedImageResult[]
  elapsedMs: number | null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function comicFingerprint(task: TaskRecord): string {
  return [
    task.input.templateName,
    task.input.templateCategory,
    task.input.prompt,
    ...strings(task.input.prompts),
  ].filter((item): item is string => typeof item === 'string').join('\n')
}

export function storedTaskOrigin(task: TaskRecord): StoredTaskOrigin | null {
  const value = task.input.origin
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.kind !== 'studio' && raw.kind !== 'template' && raw.kind !== 'graphic') return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  return {
    kind: raw.kind,
    id: raw.id,
    ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
    state: raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state)
      ? raw.state as Record<string, unknown>
      : {},
  }
}

/** Resolve the exact workspace a task should reopen, with legacy-record fallbacks. */
export function resolveTaskResume(task: TaskRecord): TaskResumeDestination {
  const origin = storedTaskOrigin(task)
  if (origin?.kind === 'template') return { kind: 'template', templateId: origin.id }
  if (origin?.kind === 'graphic') return { kind: 'graphic', sessionId: origin.id }
  if (origin?.kind === 'studio') {
    const studio = origin.id
    if (studio === 'article' || studio === 'image' || studio === 'video' || studio === 'headline' || studio === 'marketing' || studio === 'xiaohongshu') {
      return { kind: 'studio', studio }
    }
  }
  if (isComicTemplateTask(task)) {
    return { kind: 'template', templateId: typeof task.input.templateId === 'string' ? task.input.templateId : null }
  }
  if (task.kind === 'video') return { kind: 'studio', studio: 'video' }
  if (task.kind === 'text') {
    const studio = task.input.studio
    return {
      kind: 'studio',
      studio: studio === 'headline' || studio === 'marketing' || studio === 'xiaohongshu' ? studio : 'article',
    }
  }
  if (typeof task.input.sessionId === 'string' && task.input.sessionId) {
    return { kind: 'graphic', sessionId: task.input.sessionId }
  }
  return { kind: 'studio', studio: 'image' }
}

/** Whether an image task originated from the Q comic template rather than a generic/graphic image studio. */
export function isComicTemplateTask(task: TaskRecord): boolean {
  if (task.kind !== 'image') return false
  const origin = storedTaskOrigin(task)
  if (origin?.kind === 'template' && /Q\s*版|情侣漫画/i.test(origin.label ?? '')) return true
  if (task.input.templateKind === 'comic') return true
  if (typeof task.input.sessionId === 'string' && task.input.sessionId) return false
  const fingerprint = comicFingerprint(task)
  return /Q\s*版/i.test(fingerprint) && /(漫画|情侣|栗棕|奶油粉|只画女主|只画男主)/.test(fingerprint)
}

function inferTheme(task: TaskRecord, prompts: string[]): string {
  if (typeof task.input.theme === 'string' && task.input.theme.trim()) return task.input.theme.trim()
  const prompt = typeof task.input.prompt === 'string' ? task.input.prompt.trim() : ''
  if (task.input.batch === true && prompt) return prompt
  const source = prompt || prompts[0] || ''
  return /主题[：:]([^。\n]+)/.exec(source)?.[1]?.trim() || source.slice(0, 600)
}

function inferRole(task: TaskRecord, prompts: string[]): ComicRoleChoice {
  const explicit = task.input.roleChoice
  if (explicit === 'female' || explicit === 'male' || explicit === 'both') return explicit
  const source = prompts.join('\n') || String(task.input.prompt ?? '')
  if (source.includes('只画女主')) return 'female'
  if (source.includes('只画男主')) return 'male'
  return 'both'
}

export function taskResultImages(task: TaskRecord): GeneratedImageResult[] {
  const images = Array.isArray(task.result.images) ? task.result.images : []
  return images.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const image = item as Record<string, unknown>
    if (typeof image.id !== 'string') return []
    return [{
      id: image.id,
      mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/png',
      relativePath: typeof image.relativePath === 'string' ? image.relativePath : '',
      sizeBytes: Number.isFinite(Number(image.sizeBytes)) ? Number(image.sizeBytes) : 0,
    }]
  })
}

export function comicResumeState(task: TaskRecord): ComicResumeState {
  const originState = storedTaskOrigin(task)?.state ?? {}
  const prompts = strings(task.input.prompts)
  const source = prompts.join('\n') || String(task.input.prompt ?? '')
  const overlayText = typeof task.input.overlayText === 'string'
    ? task.input.overlayText
    : /中文文字[：:]「([^」]+)」/.exec(source)?.[1] ?? ''
  const count = Math.max(1, Math.min(6, Math.round(Number(task.input.requestedCount ?? task.input.count) || 1)))
  const elapsed = Number(task.result.elapsedMs)
  return {
    templateId: typeof task.input.templateId === 'string' ? task.input.templateId : null,
    templateName: typeof task.input.templateName === 'string' ? task.input.templateName : 'Q 版情侣漫画',
    theme: typeof originState.values === 'object' && originState.values && !Array.isArray(originState.values)
      ? String((originState.values as Record<string, unknown>)['主题/文案'] ?? (originState.values as Record<string, unknown>)['主题'] ?? inferTheme(task, prompts))
      : inferTheme(task, prompts),
    roleChoice: originState.roleChoice === 'female' || originState.roleChoice === 'male' || originState.roleChoice === 'both'
      ? originState.roleChoice
      : inferRole(task, prompts),
    imageCount: Math.max(1, Math.min(6, Math.round(Number(originState.comicImageCount) || count))),
    overlayText: typeof originState.comicImageText === 'string' ? originState.comicImageText : overlayText,
    prompts,
    results: taskResultImages(task),
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
  }
}
