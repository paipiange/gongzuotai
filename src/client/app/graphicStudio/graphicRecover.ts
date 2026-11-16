import type { TaskRecord } from '../hostClient'

/**
 * 公众号分镜「后端任务恢复」的匹配纯函数：把后台生图任务按 sessionId
 * 过滤、按 pageIndex 聚合，供挂载/轮询时回填各页结果。
 */

/** 按 pageIndex 聚合生图任务，每页取最新（createdAt 最大）的任务。 */
export function buildPageTaskMap(tasks: TaskRecord[], sessionId: string): Map<number, TaskRecord> {
  const byPage = new Map<number, TaskRecord>()
  for (const task of tasks) {
    if (task.input.sessionId !== sessionId) continue
    const index = typeof task.input.pageIndex === 'number' ? task.input.pageIndex : -1
    if (index < 0) continue
    const existing = byPage.get(index)
    if (!existing || task.createdAt > existing.createdAt) byPage.set(index, task)
  }
  return byPage
}

/** 从任务 result 里取第一张图的 asset id。 */
export function extractAssetId(task: TaskRecord): string | undefined {
  const images = Array.isArray(task.result.images) ? task.result.images : []
  for (const img of images) {
    if (img && typeof img === 'object' && typeof (img as { id?: unknown }).id === 'string') {
      return (img as { id: string }).id
    }
  }
  return undefined
}
