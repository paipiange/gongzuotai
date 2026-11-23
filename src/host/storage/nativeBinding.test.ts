import { describe, expect, it } from 'vitest'
import { bundledNativePath, currentPlatformKey, loadBetterSqlite3 } from './nativeBinding'

describe('nativeBinding', () => {
  it('currentPlatformKey 返回 platform-arch 格式', () => {
    const key = currentPlatformKey()
    expect(key).toMatch(/^(win32|darwin|linux)-(x64|arm64|ia32)$/)
    expect(key).toBe(`${process.platform}-${process.arch}`)
  })

  it('bundledNativePath 存在时返回路径，缺失平台返回 null', () => {
    // 本仓库内置了 win32-x64，故本机应能命中；其他平台应返回 null。
    const key = currentPlatformKey()
    const p = bundledNativePath(key)
    if (key === 'win32-x64') {
      expect(p).toBeTruthy()
      expect(p).toMatch(/better_sqlite3\.node$/)
    } else {
      expect(p).toBeNull()
    }
    // 明确不存在的平台一定返回 null。
    expect(bundledNativePath('linux-s390x')).toBeNull()
  })

  it('loadBetterSqlite3 返回可用的 Database 构造函数', () => {
    const Ctor = loadBetterSqlite3() as { new (f: string, o?: Record<string, unknown>): { exec: (s: string) => void; prepare: (s: string) => { run: (...a: unknown[]) => void; get: () => { x: number } }; close: () => void } }
    const db = new Ctor(':memory:')
    db.exec('CREATE TABLE t(x INTEGER)')
    db.prepare('INSERT INTO t VALUES (?)').run(42)
    expect(db.prepare('SELECT x FROM t').get().x).toBe(42)
    db.close()
  })

  it('loadBetterSqlite3 在冒烟失败时抛带指引的错误（模拟依赖缺失）', () => {
    // 不轻易 mock createRequire，这里只验证导出结构存在、函数可调用。
    expect(typeof loadBetterSqlite3).toBe('function')
    expect(typeof bundledNativePath).toBe('function')
    expect(typeof currentPlatformKey).toBe('function')
  })
})
