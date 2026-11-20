import { describe, expect, it } from 'vitest'
import type { TaskRecord } from './hostClient'
import { comicResumeState, isComicTemplateTask, resolveTaskResume } from './taskResume'

function imageTask(input: Record<string, unknown>): TaskRecord {
  return {
    id: 'task-1',
    clientRequestId: null,
    kind: 'image',
    status: 'success',
    creationId: null,
    modelId: null,
    errorCode: null,
    errorMessage: null,
    input,
    result: {},
    priority: 0,
    attempt: 0,
    retryCount: 0,
    maxAttempts: 1,
    availableAt: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-11-19T00:00:00.000Z',
  }
}

describe('generation task resume routing', () => {
  it('routes an explicitly tagged comic task back to the template center', () => {
    expect(isComicTemplateTask(imageTask({ templateKind: 'comic', templateName: 'Q 版情侣漫画' }))).toBe(true)
  })

  it('recognizes legacy Q comic records from their stored prompts', () => {
    const task = imageTask({
      batch: true,
      prompt: '做人最重要的是开心',
      prompts: ['主题：做人最重要的是开心。只画女主一人。奶油粉暖棕精致软萌 Q 版。'],
      requestedCount: 3,
    })
    expect(isComicTemplateTask(task)).toBe(true)
    expect(comicResumeState(task)).toMatchObject({ theme: '做人最重要的是开心', imageCount: 3, roleChoice: 'female' })
  })

  it('does not treat a public-account storyboard task as a comic template task', () => {
    const task = imageTask({
      prompt: '公众号分镜插画',
      sessionId: 'graphic-session',
      pageIndex: 0,
    })
    expect(isComicTemplateTask(task)).toBe(false)
    expect(resolveTaskResume(task)).toEqual({ kind: 'graphic', sessionId: 'graphic-session' })
  })

  it('prefers the stable origin contract over task-kind guessing', () => {
    const task = imageTask({
      origin: { kind: 'template', id: 'tpl-1', label: '海报模板', state: { values: { 品牌: '示例' } } },
    })
    expect(resolveTaskResume(task)).toEqual({ kind: 'template', templateId: 'tpl-1' })
  })
})
