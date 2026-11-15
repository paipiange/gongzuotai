import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import Database from 'better-sqlite3'
import { getSchemaVersion, latestSchemaVersion, migrateDatabase } from './migrations'
import { ensureStorageDirectories, resolvePrivatePath, resolveStoragePaths, type StoragePaths } from './paths'

export interface StorageOptions {
  dataRoot?: string
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
    const db = new Database(paths.database)

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
      return new PaipiangeDatabase(db, paths)
    } catch (error) {
      db.close()
      throw error
    }
  }

  async createBackup() {
    const filename = `paipiange-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`
    const destination = resolvePrivatePath(this.paths.backups, filename)
    await this.db.backup(destination)
    return { filename: basename(destination), path: destination }
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
