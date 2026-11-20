import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type TaskKind = 'text' | 'image' | 'video'
export type TaskStatus = 'queued' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled'

export interface TaskRecord {
  id: string
  clientRequestId: string | null
  kind: TaskKind
  status: TaskStatus
  creationId: string | null
  modelId: string | null
  errorCode: string | null
  errorMessage: string | null
  input: Record<string, unknown>
  result: Record<string, unknown>
  priority: number
  attempt: number
  retryCount: number
  maxAttempts: number
  availableAt: string | null
  queuePayload: Record<string, unknown> | null
  heartbeatAt: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface CreateTaskInput {
  kind: TaskKind
  clientRequestId?: string | null
  creationId?: string | null
  modelId?: string | null
  input?: Record<string, unknown>
}

export interface EnqueueTaskInput extends CreateTaskInput {
  priority?: number
  maxAttempts?: number
  availableAt?: string | null
  queuePayload: Record<string, unknown>
}

interface TaskRow {
  id: string
  client_request_id: string | null
  kind: string
  status: string
  creation_id: string | null
  model_id: string | null
  error_code: string | null
  error_message: string | null
  input_json: string
  result_json: string
  priority: number
  attempt: number
  retry_count: number
  max_attempts: number
  available_at: string | null
  queue_payload_json: string | null
  heartbeat_at: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

/**
 * Records every generation attempt — text or image, success or failure — so the
 * user can inspect the exact request parameters and returned logs later, and
 * resume a failed/complete run. Reuses the `tasks` table from the v1 schema.
 */
export class TaskRepository {
  constructor(private readonly db: Database.Database) {}

  /** Start a task and return its id. The caller then marks it complete/failed. */
  start(input: CreateTaskInput): TaskRecord {
    const now = new Date().toISOString()
    const record: TaskRecord = {
      id: randomUUID(),
      clientRequestId: input.clientRequestId?.trim() || null,
      kind: input.kind,
      status: 'running',
      creationId: input.creationId ?? null,
      modelId: input.modelId ?? null,
      errorCode: null,
      errorMessage: null,
      input: input.input ?? {},
      result: {},
      priority: 0,
      attempt: 0,
      retryCount: 0,
      maxAttempts: 1,
      availableAt: null,
      queuePayload: null,
      heartbeatAt: now,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
    }
    this.db.prepare(`
      INSERT INTO tasks (
        id, client_request_id, kind, status, creation_id, model_id,
        error_code, error_message, input_json, result_json, priority, attempt, retry_count, max_attempts,
        available_at, queue_payload_json, heartbeat_at, started_at, finished_at, created_at
      ) VALUES (
        @id, @clientRequestId, @kind, @status, @creationId, @modelId,
        @errorCode, @errorMessage, @inputJson, @resultJson, @priority, @attempt, @retryCount, @maxAttempts,
        @availableAt, @queuePayloadJson, @heartbeatAt, @startedAt, @finishedAt, @createdAt
      )
    `).run({
      ...record,
      inputJson: JSON.stringify(record.input),
      resultJson: JSON.stringify(record.result),
      queuePayloadJson: null,
    })
    return record
  }

  /** Persist work before execution so it survives navigation and process restarts. */
  enqueue(input: EnqueueTaskInput): TaskRecord {
    const clientRequestId = input.clientRequestId?.trim() || null
    if (clientRequestId) {
      const existing = this.getByClientRequestId(clientRequestId)
      if (existing) return existing
    }
    const now = new Date().toISOString()
    const record: TaskRecord = {
      id: randomUUID(),
      clientRequestId,
      kind: input.kind,
      status: 'queued',
      creationId: input.creationId ?? null,
      modelId: input.modelId ?? null,
      errorCode: null,
      errorMessage: null,
      input: input.input ?? {},
      result: {},
      priority: clampInteger(input.priority ?? 0, -100, 100),
      attempt: 0,
      retryCount: 0,
      maxAttempts: clampInteger(input.maxAttempts ?? 3, 1, 10),
      availableAt: input.availableAt ?? now,
      queuePayload: input.queuePayload,
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
    }
    this.db.prepare(`
      INSERT INTO tasks (
        id, client_request_id, kind, status, creation_id, model_id,
        error_code, error_message, input_json, result_json, priority, attempt, retry_count, max_attempts,
        available_at, queue_payload_json, heartbeat_at, started_at, finished_at, created_at
      ) VALUES (
        @id, @clientRequestId, @kind, @status, @creationId, @modelId,
        @errorCode, @errorMessage, @inputJson, @resultJson, @priority, @attempt, @retryCount, @maxAttempts,
        @availableAt, @queuePayloadJson, @heartbeatAt, @startedAt, @finishedAt, @createdAt
      )
    `).run({
      ...record,
      inputJson: JSON.stringify(record.input),
      resultJson: JSON.stringify(record.result),
      queuePayloadJson: JSON.stringify(record.queuePayload),
    })
    return record
  }

  /** Atomically claim the highest-priority task that is ready to run. */
  claimNext(now = new Date()): TaskRecord | null {
    return this.db.transaction(() => {
      const nowIso = now.toISOString()
      const row = this.db.prepare(`
        SELECT * FROM tasks
        WHERE status = 'queued'
          AND queue_payload_json IS NOT NULL
          AND (available_at IS NULL OR available_at <= @now)
        ORDER BY priority DESC, created_at ASC, rowid ASC
        LIMIT 1
      `).get({ now: nowIso }) as TaskRow | undefined
      if (!row) return null
      const updated = this.db.prepare(`
        UPDATE tasks SET
          status = 'running',
          attempt = attempt + 1,
          started_at = @now,
          finished_at = NULL,
          heartbeat_at = @now,
          error_code = NULL,
          error_message = NULL
        WHERE id = @id AND status = 'queued'
      `).run({ id: row.id, now: nowIso })
      if (updated.changes !== 1) return null
      return this.getById(row.id)
    })()
  }

  /** Mark a running task as successful, storing the returned result/log. */
  markSuccess(id: string, result: Record<string, unknown>, modelId?: string | null): boolean {
    const now = new Date().toISOString()
    const run = this.db.prepare(`
      UPDATE tasks SET
        status = 'success',
        result_json = @resultJson,
        model_id = COALESCE(@modelId, model_id),
        heartbeat_at = @now,
        finished_at = @now
      WHERE id = @id AND status = 'running'
    `).run({ id, resultJson: JSON.stringify(result ?? {}), modelId: modelId ?? null, now })
    return run.changes === 1
  }

  /** Mark a running task as failed, optionally retaining partial output/logs. */
  markFailed(id: string, errorCode: string, errorMessage: string, result: Record<string, unknown> = {}): boolean {
    const now = new Date().toISOString()
    const run = this.db.prepare(`
      UPDATE tasks SET
        status = 'failed',
        error_code = @errorCode,
        error_message = @errorMessage,
        result_json = @resultJson,
        finished_at = @now
      WHERE id = @id AND status = 'running'
    `).run({ id, errorCode, errorMessage, resultJson: JSON.stringify(result ?? {}), now })
    return run.changes === 1
  }

  markCancelled(id: string, message = '用户取消生成'): boolean {
    const now = new Date().toISOString()
    const run = this.db.prepare(`
      UPDATE tasks SET
        status = 'cancelled',
        error_code = 'cancelled',
        error_message = @message,
        finished_at = @now
      WHERE id = @id AND status IN ('queued', 'running', 'paused')
    `).run({ id, message, now })
    return run.changes === 1
  }

  updateProgress(id: string, patch: Record<string, unknown>): boolean {
    const task = this.getById(id)
    if (!task || task.status !== 'running') return false
    const result = { ...task.result, ...patch }
    return this.db.prepare(`
      UPDATE tasks SET result_json = @resultJson, heartbeat_at = @now
      WHERE id = @id AND status = 'running'
    `).run({ id, resultJson: JSON.stringify(result), now: new Date().toISOString() }).changes === 1
  }

  pause(id: string): boolean {
    return this.db.prepare(`
      UPDATE tasks SET status = 'paused', heartbeat_at = @now
      WHERE id = @id AND status IN ('queued', 'running') AND queue_payload_json IS NOT NULL
    `).run({ id, now: new Date().toISOString() }).changes === 1
  }

  resume(id: string): boolean {
    const now = new Date().toISOString()
    return this.db.prepare(`
      UPDATE tasks SET
        status = 'queued', available_at = @now, started_at = NULL,
        finished_at = NULL, heartbeat_at = NULL, error_code = NULL, error_message = NULL
      WHERE id = @id AND status = 'paused' AND queue_payload_json IS NOT NULL
    `).run({ id, now }).changes === 1
  }

  setPriority(id: string, priority: number): boolean {
    return this.db.prepare(`
      UPDATE tasks SET priority = @priority
      WHERE id = @id AND status IN ('queued', 'paused') AND queue_payload_json IS NOT NULL
    `).run({ id, priority: clampInteger(priority, -100, 100) }).changes === 1
  }

  /** Requeue a failed attempt with backoff, or finish it after the retry budget is exhausted. */
  retryOrFail(
    id: string,
    errorCode: string,
    errorMessage: string,
    result: Record<string, unknown> = {},
    retryDelayMs = 0,
  ): 'queued' | 'failed' | null {
    return this.db.transaction(() => {
      const task = this.getById(id)
      if (!task || task.status !== 'running') return null
      const now = Date.now()
      if (task.retryCount < task.maxAttempts - 1) {
        this.db.prepare(`
          UPDATE tasks SET
            status = 'queued', error_code = @errorCode, error_message = @errorMessage,
            result_json = @resultJson, available_at = @availableAt, started_at = NULL,
            finished_at = NULL, heartbeat_at = NULL, retry_count = retry_count + 1
          WHERE id = @id AND status = 'running'
        `).run({
          id,
          errorCode,
          errorMessage,
          resultJson: JSON.stringify(result ?? {}),
          availableAt: new Date(now + Math.max(0, retryDelayMs)).toISOString(),
        })
        return 'queued'
      }
      this.markFailed(id, errorCode, errorMessage, result)
      return 'failed'
    })()
  }

  nextQueuedAvailableAt(): string | null {
    const row = this.db.prepare(`
      SELECT MIN(COALESCE(available_at, created_at)) AS available_at
      FROM tasks WHERE status = 'queued' AND queue_payload_json IS NOT NULL
    `).get() as { available_at: string | null }
    return row.available_at
  }

  getByClientRequestId(clientRequestId: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE client_request_id = ?').get(clientRequestId) as TaskRow | undefined
    return row ? mapTask(row) : null
  }

  /** Mark tasks left running by a previous process as interrupted, preserving partial result data. */
  interruptRunning(): number {
    const now = new Date().toISOString()
    return this.db.prepare(`
      UPDATE tasks SET
        status = 'failed',
        error_code = 'interrupted',
        error_message = '应用重启或生成进程中断，可返回原创作位置重试',
        finished_at = @now
      WHERE status = 'running'
    `).run({ now }).changes
  }

  /** Recover durable queue work after a crash; legacy synchronous work remains a failed interruption. */
  recoverInterrupted(): { requeued: number; failed: number } {
    const now = new Date().toISOString()
    const requeued = this.db.prepare(`
      UPDATE tasks SET
        status = 'queued', available_at = @now, started_at = NULL, finished_at = NULL,
        heartbeat_at = NULL, error_code = 'interrupted',
        error_message = '应用重启，任务已自动回到队列继续执行'
      WHERE status = 'running' AND queue_payload_json IS NOT NULL
    `).run({ now }).changes
    const failed = this.interruptRunning()
    return { requeued, failed }
  }

  requeueRunning(id: string, message = '工作器停止，任务已回到队列'): boolean {
    const now = new Date().toISOString()
    return this.db.prepare(`
      UPDATE tasks SET
        status = 'queued', available_at = @now, started_at = NULL, finished_at = NULL,
        heartbeat_at = NULL, error_code = 'interrupted', error_message = @message
      WHERE id = @id AND status = 'running' AND queue_payload_json IS NOT NULL
    `).run({ id, now, message }).changes === 1
  }

  /**
   * List tasks, newest first. Optionally filter by kind/status and search by a
   * free-text query (matched against the stored input/output JSON, error message
   * and model id). The query is a case-insensitive substring match.
   */
  list(kind?: TaskKind, status?: TaskStatus, limit = 100, offset = 0, query?: string): TaskRecord[] {
    const q = query?.trim() ?? ''
    const rows = this.db.prepare(`
      SELECT * FROM tasks
      WHERE (@kind IS NULL OR kind = @kind)
        AND (@status IS NULL OR status = @status)
        AND (
          @q = ''
          OR input_json LIKE @qPattern ESCAPE '\\'
          OR result_json LIKE @qPattern ESCAPE '\\'
          OR error_message LIKE @qPattern ESCAPE '\\'
          OR model_id LIKE @qPattern ESCAPE '\\'
        )
      ORDER BY created_at DESC, rowid DESC
      LIMIT @limit OFFSET @offset
    `).all({
      kind: kind ?? null,
      status: status ?? null,
      q,
      qPattern: q ? `%${escapeLike(q)}%` : '',
      limit: Math.min(Math.max(limit, 1), 500),
      offset: Math.max(offset, 0),
    }) as TaskRow[]
    return rows.map(mapTask)
  }

  getById(id: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row ? mapTask(row) : null
  }
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    clientRequestId: row.client_request_id,
    kind: row.kind as TaskKind,
    status: row.status as TaskStatus,
    creationId: row.creation_id,
    modelId: row.model_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    input: parseObject(row.input_json),
    result: parseObject(row.result_json),
    priority: row.priority ?? 0,
    attempt: row.attempt ?? 0,
    retryCount: row.retry_count ?? 0,
    maxAttempts: row.max_attempts ?? 1,
    availableAt: row.available_at,
    queuePayload: row.queue_payload_json ? parseObject(row.queue_payload_json) : null,
    heartbeatAt: row.heartbeat_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}
