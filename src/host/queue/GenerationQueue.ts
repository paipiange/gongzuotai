import type { TaskKind, TaskRecord, TaskRepository } from '../storage/taskRepository'

export interface QueueExecutionContext {
  signal: AbortSignal
  updateProgress: (patch: Record<string, unknown>) => boolean
}

export type QueueTaskHandler = (
  task: TaskRecord,
  context: QueueExecutionContext,
) => Promise<Record<string, unknown>>

export class QueueTaskError extends Error {
  constructor(
    message: string,
    readonly code = 'generation',
    readonly retryable = true,
    readonly result: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'QueueTaskError'
  }
}

export interface GenerationQueueOptions {
  concurrency?: number
  retryBaseDelayMs?: number
}

/** Persistent background dispatcher backed by TaskRepository's SQLite queue. */
export class GenerationQueue {
  private readonly handlers = new Map<TaskKind, QueueTaskHandler>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly concurrency: number
  private readonly retryBaseDelayMs: number
  private active = 0
  private started = false
  private draining = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly tasks: TaskRepository,
    options: GenerationQueueOptions = {},
  ) {
    this.concurrency = clamp(options.concurrency ?? 2, 1, 8)
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? 2_000)
  }

  register(kind: TaskKind, handler: QueueTaskHandler): this {
    this.handlers.set(kind, handler)
    return this
  }

  start(): { requeued: number; failed: number } {
    if (this.started) return { requeued: 0, failed: 0 }
    const recovered = this.tasks.recoverInterrupted()
    this.started = true
    this.notify()
    return recovered
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const [taskId, controller] of this.controllers) {
      this.tasks.requeueRunning(taskId)
      controller.abort()
    }
    this.controllers.clear()
  }

  notify(): void {
    if (!this.started) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    queueMicrotask(() => void this.drain())
  }

  pause(taskId: string): boolean {
    const changed = this.tasks.pause(taskId)
    if (changed) this.controllers.get(taskId)?.abort()
    return changed
  }

  resume(taskId: string): boolean {
    const changed = this.tasks.resume(taskId)
    if (changed) this.notify()
    return changed
  }

  cancel(taskId: string): boolean {
    const changed = this.tasks.markCancelled(taskId)
    if (changed) this.controllers.get(taskId)?.abort()
    return changed
  }

  setPriority(taskId: string, priority: number): boolean {
    const changed = this.tasks.setPriority(taskId, priority)
    if (changed) this.notify()
    return changed
  }

  private async drain(): Promise<void> {
    if (!this.started || this.draining) return
    this.draining = true
    try {
      while (this.started && this.active < this.concurrency) {
        const task = this.tasks.claimNext()
        if (!task) break
        const handler = this.handlers.get(task.kind)
        if (!handler) {
          this.tasks.markFailed(task.id, 'queue_handler_missing', `未注册 ${task.kind} 任务处理器`)
          continue
        }
        this.active += 1
        void this.execute(task, handler)
      }
      this.scheduleNext()
    } finally {
      this.draining = false
    }
  }

  private async execute(task: TaskRecord, handler: QueueTaskHandler): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(task.id, controller)
    try {
      const result = await handler(task, {
        signal: controller.signal,
        updateProgress: (patch) => this.tasks.updateProgress(task.id, patch),
      })
      const current = this.started ? this.tasks.getById(task.id) : null
      if (current?.status === 'running' && current.attempt === task.attempt) this.tasks.markSuccess(task.id, result)
    } catch (error) {
      if (!this.started) return
      const current = this.tasks.getById(task.id)
      if (!current || current.attempt !== task.attempt || current.status === 'paused' || current.status === 'cancelled') return
      const queueError = error instanceof QueueTaskError
        ? error
        : new QueueTaskError(error instanceof Error ? error.message : String(error))
      if (!queueError.retryable) {
        this.tasks.markFailed(task.id, queueError.code, queueError.message, queueError.result)
      } else {
        const delay = this.retryBaseDelayMs * (2 ** Math.max(0, current.retryCount))
        this.tasks.retryOrFail(task.id, queueError.code, queueError.message, queueError.result, delay)
      }
    } finally {
      this.controllers.delete(task.id)
      this.active = Math.max(0, this.active - 1)
      this.notify()
    }
  }

  private scheduleNext(): void {
    if (!this.started || this.active >= this.concurrency || this.timer) return
    const availableAt = this.tasks.nextQueuedAvailableAt()
    if (!availableAt) return
    const delay = Math.max(0, Date.parse(availableAt) - Date.now())
    this.timer = setTimeout(() => {
      this.timer = null
      void this.drain()
    }, Math.min(delay, 2_147_483_647))
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
