import type Database from 'better-sqlite3'

/**
 * Single-row persistence for the 公众号图文创作工作台's current session.
 *
 * Unlike `creations` (one row per saved draft), the graphic studio has ONE
 * "current working session" at a time. We keep a single row (id = 'current')
 * that is UPSERTed on every state change, so leaving the page and returning
 * (or restarting dsh) restores the source text, topic, breakdown result and
 * each page's generated asset id from the database instead of the client's
 * in-memory state.
 *
 * `storyboard` and `pages` are stored as opaque JSON strings so this layer
 * stays decoupled from the client's exact shape — the client owns serializing
 * and parsing them. `sessionId` is a run id minted by the client on each
 * breakdown; image tasks carry it in `task.input` so a restore can match
 * in-flight/succeeded generation results back to their pages.
 */

export interface GraphicSessionRecord {
  sourceText: string
  topic: string
  pageCount: number
  textPick: string
  imagePick: string
  /** JSON-serialized storyboard result (opaque to this repository). */
  storyboardJson: string | null
  /** JSON-serialized pages array (opaque to this repository). */
  pagesJson: string
  /** Run id linking image tasks to this breakdown session. */
  sessionId: string
  updatedAt: string
}

const ROW_ID = 'current'

interface GraphicSessionRow {
  id: string
  source_text: string
  topic: string
  page_count: number
  text_pick: string
  image_pick: string
  storyboard_json: string | null
  pages_json: string
  session_id: string
  updated_at: string
}

export class GraphicSessionRepository {
  constructor(private readonly db: Database.Database) {}

  get(): GraphicSessionRecord | null {
    const row = this.db.prepare('SELECT * FROM graphic_sessions WHERE id = ?').get(ROW_ID) as GraphicSessionRow | undefined
    return row ? mapRow(row) : null
  }

  save(record: Omit<GraphicSessionRecord, 'updatedAt'>): void {
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO graphic_sessions (
        id, source_text, topic, page_count, text_pick, image_pick,
        storyboard_json, pages_json, session_id, updated_at
      ) VALUES (
        @id, @sourceText, @topic, @pageCount, @textPick, @imagePick,
        @storyboardJson, @pagesJson, @sessionId, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        source_text = @sourceText,
        topic = @topic,
        page_count = @pageCount,
        text_pick = @textPick,
        image_pick = @imagePick,
        storyboard_json = @storyboardJson,
        pages_json = @pagesJson,
        session_id = @sessionId,
        updated_at = @updatedAt
    `).run({
      id: ROW_ID,
      sourceText: record.sourceText,
      topic: record.topic,
      pageCount: record.pageCount,
      textPick: record.textPick,
      imagePick: record.imagePick,
      storyboardJson: record.storyboardJson,
      pagesJson: record.pagesJson,
      sessionId: record.sessionId,
      updatedAt: now,
    })
  }

  clear(): void {
    this.db.prepare('DELETE FROM graphic_sessions WHERE id = ?').run(ROW_ID)
  }
}

function mapRow(row: GraphicSessionRow): GraphicSessionRecord {
  return {
    sourceText: row.source_text,
    topic: row.topic,
    pageCount: row.page_count,
    textPick: row.text_pick,
    imagePick: row.image_pick,
    storyboardJson: row.storyboard_json,
    pagesJson: row.pages_json,
    sessionId: row.session_id,
    updatedAt: row.updated_at,
  }
}
