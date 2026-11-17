import type Database from 'better-sqlite3'

/**
 * 数据分析看板的只读聚合查询。所有统计都来自本地 SQLite 真实数据
 * （生成任务、创作记录、素材、发布清单），不使用任何虚构数字。
 */

export interface AnalyticsOverview {
  generated: {
    total: number
    byKind: Record<string, number>
    byStatus: Record<string, number>
    /** 成功率（success / (success + failed)），忽略进行中的任务。 */
    successRate: number
  }
  creations: { total: number; byStatus: Record<string, number>; byType: Record<string, number> }
  assets: { total: number; byKind: Record<string, number> }
  publish: { total: number; byStatus: Record<string, number> }
  /** 最近 7 天生成任务数（按创建日期升序，已补零）。 */
  trend7d: Array<{ day: string; count: number }>
}

export class AnalyticsRepository {
  constructor(private readonly db: Database.Database) {}

  overview(): AnalyticsOverview {
    const generatedByKind = this.group('SELECT kind AS k, COUNT(*) AS c FROM tasks GROUP BY kind')
    const generatedByStatus = this.group('SELECT status AS k, COUNT(*) AS c FROM tasks GROUP BY status')
    const successCount = generatedByStatus['success'] ?? 0
    const failedCount = generatedByStatus['failed'] ?? 0
    const finished = successCount + failedCount

    return {
      generated: {
        total: this.count('SELECT COUNT(*) AS c FROM tasks'),
        byKind: generatedByKind,
        byStatus: generatedByStatus,
        successRate: finished > 0 ? successCount / finished : 0,
      },
      creations: {
        total: this.count('SELECT COUNT(*) AS c FROM creations WHERE deleted_at IS NULL'),
        byStatus: this.group('SELECT status AS k, COUNT(*) AS c FROM creations WHERE deleted_at IS NULL GROUP BY status'),
        byType: this.group('SELECT type AS k, COUNT(*) AS c FROM creations WHERE deleted_at IS NULL GROUP BY type'),
      },
      assets: {
        total: this.count('SELECT COUNT(*) AS c FROM assets WHERE deleted_at IS NULL'),
        byKind: this.group('SELECT kind AS k, COUNT(*) AS c FROM assets WHERE deleted_at IS NULL GROUP BY kind'),
      },
      publish: {
        total: this.count('SELECT COUNT(*) AS c FROM publish_items'),
        byStatus: this.group('SELECT status AS k, COUNT(*) AS c FROM publish_items GROUP BY status'),
      },
      trend7d: this.trend7d(),
    }
  }

  private count(sql: string): number {
    return (this.db.prepare(sql).get() as { c: number }).c
  }

  private group(sql: string): Record<string, number> {
    const rows = this.db.prepare(sql).all() as Array<{ k: string; c: number }>
    const out: Record<string, number> = {}
    for (const row of rows) out[row.k] = row.c
    return out
  }

  /**
   * 最近 7 天的生成任务数，按 `created_at` 的 UTC 日期（ISO 8601 的 YYYY-MM-DD）
   * 分组。范围是「6 天前此刻 → 现在」，返回升序且缺失日期补 0。
   */
  private trend7d(): Array<{ day: string; count: number }> {
    const now = Date.now()
    const since = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString()
    const rows = this.db
      .prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM tasks WHERE created_at >= ? GROUP BY day')
      .all(since) as Array<{ day: string; c: number }>
    const byDay = new Map(rows.map((r) => [r.day, r.c]))

    const out: Array<{ day: string; count: number }> = []
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      out.push({ day, count: byDay.get(day) ?? 0 })
    }
    return out
  }
}
