import type Database from 'better-sqlite3'

interface Migration {
  version: number
  name: string
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    sql: `
      CREATE TABLE IF NOT EXISTS creations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('article','image','title','marketing','xiaohongshu','video-placeholder')),
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        body_md TEXT NOT NULL DEFAULT '',
        body_html TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','archived')),
        template_id TEXT,
        model_id TEXT,
        prompt TEXT NOT NULL DEFAULT '',
        params_json TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('user','ai')),
        is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0, 1)),
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_creations_type_time ON creations(type, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_creations_status_time ON creations(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS creation_revisions (
        id TEXT PRIMARY KEY,
        creation_id TEXT NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
        revision_no INTEGER NOT NULL,
        body_md TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(creation_id, revision_no)
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('image','file','prompt','document')),
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        relative_path TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        width INTEGER,
        height INTEGER,
        tags_json TEXT NOT NULL DEFAULT '[]',
        source_creation_id TEXT REFERENCES creations(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_assets_kind_time ON assets(kind, created_at DESC);

      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cover_asset_id TEXT,
        prompt_template TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]',
        is_builtin INTEGER NOT NULL DEFAULT 0 CHECK(is_builtin IN (0, 1)),
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);

      CREATE TABLE IF NOT EXISTS inspirations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        prompt_template TEXT NOT NULL,
        category TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        cover_asset_id TEXT,
        is_builtin INTEGER NOT NULL DEFAULT 0 CHECK(is_builtin IN (0, 1)),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        client_request_id TEXT UNIQUE,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        creation_id TEXT REFERENCES creations(id) ON DELETE SET NULL,
        model_id TEXT,
        error_code TEXT,
        error_message TEXT,
        input_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);

      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        provider TEXT,
        model_id TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        reported_cost REAL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publish_items (
        id TEXT PRIMARY KEY,
        creation_id TEXT NOT NULL REFERENCES creations(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        export_path TEXT,
        external_url TEXT,
        exported_at TEXT,
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'creation-cover-asset',
    sql: `
      ALTER TABLE creations ADD COLUMN cover_asset_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_creations_cover_asset ON creations(cover_asset_id);
    `,
  },
  {
    version: 3,
    name: 'tags-on-creations',
    sql: `
      ALTER TABLE creations ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
]

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0

export function getSchemaVersion(db: Database.Database) {
  return db.pragma('user_version', { simple: true }) as number
}

export function migrateDatabase(db: Database.Database) {
  const currentVersion = getSchemaVersion(db)
  if (currentVersion > latestSchemaVersion) {
    throw new Error(`Database schema ${currentVersion} is newer than supported schema ${latestSchemaVersion}`)
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue
    db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    })()
  }
}
