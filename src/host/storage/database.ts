import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'
import { seedBuiltinContent } from './builtinContent'
import { getSchemaVersion, latestSchemaVersion, migrateDatabase } from './migrations'
import { ensureStorageDirectories, resolvePrivatePath, resolveStoragePaths, type StoragePaths } from './paths'

// better-sqlite3 is a CJS module with native bindings. Loading it through a
// CJS `require` (via createRequire) is the most robust path: it bypasses any
// ESM↔CJS default-import interop quirks in the bundler or the host's module
// loader (which can otherwise surface as `Database is not a constructor`).
const requireCjs = createRequire(import.meta.url)
const DatabaseCtor = requireCjs('better-sqlite3') as typeof Database

export interface StorageOptions {
  dataRoot?: string
  /** 首次建库时是否写入内置模板与灵感（默认 true，幂等）。单元测试可传 false 隔离。 */
  seedBuiltin?: boolean
}

export class PaipiangeDatabase {
  readonly db: Database.Database
  readonly paths: StoragePaths

  private constructor(db: Database.Database, paths: StoragePaths) {
    this.db = db
    this.paths = paths
  }

  static async open(options: StorageOptions = {}) {
    const paths = resolveStoragePaths(options.dataRoot)
    ensureStorageDirectories(paths)
    const existed = existsSync(paths.database)
    const db = new DatabaseCtor(paths.database)

    try {
      db.pragma('foreign_keys = ON')
      db.pragma('journal_mode = WAL')
      db.pragma('busy_timeout = 5000')
      const currentVersion = getSchemaVersion(db)
      if (existed && currentVersion < latestSchemaVersion) {
        const preMigrationName = `pre-migration-v${currentVersion}-${Date.now()}.sqlite`
        await db.backup(resolvePrivatePath(paths.backups, preMigrationName))
      }
      migrateDatabase(db)
      if (options.seedBuiltin !== false) seedBuiltinContent(db)
      return new PaipiangeDatabase(db, paths)
    } catch (error) {
      db.close()
      throw error
    }
  }

  async createBackup(prefix = 'paipiange-backup') {
    const safePrefix = prefix.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'paipiange-backup'
    const filename = `${safePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`
    const destination = resolvePrivatePath(this.paths.backups, filename)
    await this.db.backup(destination)
    return { filename: basename(destination), path: destination }
  }

  /**
   * Restore a backup snapshot over the live database, replacing current data.
   * Creates a "pre-restore" safety snapshot first (so the overwrite can be
   * undone), closes the active connection, copies the snapshot over the
   * database file and clears WAL/SHM sidecars. Returns metadata; the caller
   * MUST restart the plugin for the change to take effect, because the
   * in-memory repository handles still reference the now-closed connection.
   */
  async restoreBackup(filename: string) {
    if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('\0') || !filename.endsWith('.sqlite')) {
      throw new Error('无效的备份文件名')
    }
    const source = resolvePrivatePath(this.paths.backups, filename)
    if (!existsSync(source)) throw new Error('备份不存在')

    // Safety net: snapshot the current DB before overwriting it.
    const preRestoreName = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`
    const preRestorePath = resolvePrivatePath(this.paths.backups, preRestoreName)
    await this.db.backup(preRestorePath)

    // Close the live connection so the file can be replaced cleanly.
    this.close()

    // Replace the database file and clear WAL/SHM sidecars.
    copyFileSync(source, this.paths.database)
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${this.paths.database}${suffix}`
      if (existsSync(sidecar)) rmSync(sidecar, { force: true })
    }

    return { filename, preRestore: preRestoreName, restartRequired: true }
  }

  close() {
    if (this.db.open) {
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
      } catch {
        // checkpoint may fail if the database is read-only or already closing
      }
      this.db.close()
    }
  }
}
