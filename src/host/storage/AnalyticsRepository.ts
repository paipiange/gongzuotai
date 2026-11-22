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

/** 模板使用归因：某个模板被用于生成了多少次、成功率如何。 */
export interface TemplateAttribution {
  name: string
  category: string | null
  used: number
  succeeded: number
  failed: number
  successRate: number
}

/** 创作节奏：按小时聚合的生成/发布活跃度，用于建议最佳创作与发布时段。 */
export interface PublishingInsights {
  /** 各模板的生成使用归因（按使用次数降序）。 */
  templateAttribution: TemplateAttribution[]
  /** 生成任务按小时（0-23）分布，索引即小时。 */
  generationByHour: number[]
  /** 已发布项按小时（0-23）分布，索引即小时。 */
  publishByHour: number[]
  /** 建议的发布时段（本地时区，基于历史发布最活跃的小时）。 */
  recommendedHour: number | null
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

  /**
   * 创作洞察：模板归因 + 生成/发布时段分布。所有数字均来自本地真实任务与
   * 发布记录，不使用虚构数据。用于帮助用户判断「哪种模板/哪个时段更有效」。
   */
  insights(): PublishingInsights {
    return {
      templateAttribution: this.templateAttribution(),
      generationByHour: this.hourDistribution('tasks'),
      publishByHour: this.hourDistribution('publish'),
      recommendedHour: this.recommendedHour(),
    }
  }

  /**
   * 从图片生成任务的 `input_json` 里提取 `templateName`，聚合每个模板的
   * 使用次数与成功/失败数。仅统计记录了模板来源的任务（source=template）。
   */
  private templateAttribution(): TemplateAttribution[] {
    const rows = this.db.prepare(`
      SELECT input_json AS j, status FROM tasks
      WHERE kind = 'image' AND input_json LIKE '%templateName%'
    `).all() as Array<{ j: string; status: string }>

    const map = new Map<string, { name: string; category: string | null; used: number; succeeded: number; failed: number }>()
    for (const row of rows) {
      const input = parseTaskInput(row.j)
      const name = typeof input.templateName === 'string' && input.templateName.trim() ? input.templateName.trim() : null
      if (!name) continue
      const entry = map.get(name) ?? { name, category: typeof input.templateCategory === 'string' ? input.templateCategory : null, used: 0, succeeded: 0, failed: 0 }
      entry.used += 1
      if (row.status === 'success') entry.succeeded += 1
      else if (row.status === 'failed') entry.failed += 1
      map.set(name, entry)
    }

    return [...map.values()]
      .map((e) => ({ ...e, successRate: e.succeeded + e.failed > 0 ? e.succeeded / (e.succeeded + e.failed) : 0 }))
      .sort((a, b) => b.used - a.used || a.name.localeCompare(b.name))
  }

  /** 按本地小时（0-23）聚合时间分布，返回长度为 24 的数组，索引即小时。 */
  private hourDistribution(source: 'tasks' | 'publish'): number[] {
    const out = new Array<number>(24).fill(0)
    const column = source === 'tasks' ? 'created_at' : 'published_at'
    const table = source === 'tasks' ? 'tasks' : 'publish_items'
    const rows = this.db.prepare(`SELECT ${column} AS t FROM ${table} WHERE ${column} IS NOT NULL`).all() as Array<{ t: string }>
    for (const row of rows) {
      const hour = new Date(row.t).getHours()
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) out[hour] += 1
    }
    return out
  }

  /** 基于历史已发布项最活跃的小时，返回建议发布时段（无数据时为 null）。 */
  private recommendedHour(): number | null {
    const publishByHour = this.hourDistribution('publish')
    const total = publishByHour.reduce((sum, n) => sum + n, 0)
    if (total === 0) return null
    let best = 0
    for (let hour = 1; hour < 24; hour += 1) {
      if (publishByHour[hour] > publishByHour[best]) best = hour
    }
    return best
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

/** 安全解析任务 input_json；损坏或非对象时返回空对象。 */
function parseTaskInput(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
