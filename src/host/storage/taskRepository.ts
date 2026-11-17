import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

export type TaskKind = 'text' | 'image' | 'video'
export type TaskStatus = 'running' | 'success' | 'failed'

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
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

export interface CreateTaskInput {
  kind: TaskKind
  creationId?: string | null
  modelId?: string | null
  input?: Record<string, unknown>
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
      clientRequestId: null,
      kind: input.kind,
      status: 'running',
      creationId: input.creationId ?? null,
      modelId: input.modelId ?? null,
      errorCode: null,
      errorMessage: null,
      input: input.input ?? {},
      result: {},
      startedAt: now,
      finishedAt: null,
      createdAt: now,
    }
    this.db.prepare(`
      INSERT INTO tasks (
        id, client_request_id, kind, status, creation_id, model_id,
        error_code, error_message, input_json, result_json, started_at, finished_at, created_at
      ) VALUES (
        @id, @clientRequestId, @kind, @status, @creationId, @modelId,
        @errorCode, @errorMessage, @inputJson, @resultJson, @startedAt, @finishedAt, @createdAt
      )
    `).run({
      ...record,
      inputJson: JSON.stringify(record.input),
      resultJson: JSON.stringify(record.result),
    })
    return record
  }

  /** Mark a running task as successful, storing the returned result/log. */
  markSuccess(id: string, result: Record<string, unknown>, modelId?: string | null): boolean {
    const now = new Date().toISOString()
    const run = this.db.prepare(`
      UPDATE tasks SET
        status = 'success',
        result_json = @resultJson,
        model_id = COALESCE(@modelId, model_id),
        finished_at = @now
      WHERE id = @id
    `).run({ id, resultJson: JSON.stringify(result ?? {}), modelId: modelId ?? null, now })
    return run.changes === 1
  }

  /** Mark a running task as failed, storing the error message/log. */
  markFailed(id: string, errorCode: string, errorMessage: string): boolean {
    const now = new Date().toISOString()
    const run = this.db.prepare(`
      UPDATE tasks SET
        status = 'failed',
        error_code = @errorCode,
        error_message = @errorMessage,
        finished_at = @now
      WHERE id = @id
    `).run({ id, errorCode, errorMessage, now })
    return run.changes === 1
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
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }
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
