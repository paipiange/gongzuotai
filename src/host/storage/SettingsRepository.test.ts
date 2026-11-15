import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PaipiangeDatabase } from './database'
import { SettingsRepository } from './SettingsRepository'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true })
  }
})

async function openTemporaryStorage() {
  const root = join(tmpdir(), `paipiange-settings-test-${crypto.randomUUID()}`)
  temporaryRoots.push(root)
  return PaipiangeDatabase.open({ dataRoot: root })
}

describe('SettingsRepository', () => {
  it('persists and clears image-gen configs', async () => {
    const storage = await openTemporaryStorage()
    const repo = new SettingsRepository(storage.db)

    repo.setLlmImageConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'secret-key', model: 'dall-e-3' })
    repo.setComfyUiConfig({ server: 'http://127.0.0.1:8188', checkpoint: 'sd.safetensors' })

    expect(repo.getLlmImageConfig()).toMatchObject({ model: 'dall-e-3', apiKey: 'secret-key' })
    expect(repo.getComfyUiConfig()).toMatchObject({ checkpoint: 'sd.safetensors' })

    repo.clearLlmImageConfig()
    expect(repo.getLlmImageConfig()).toBeNull()
    expect(repo.getComfyUiConfig()).not.toBeNull()
    storage.close()
  })

  it('never exposes the API key in the summary', async () => {
    const storage = await openTemporaryStorage()
    const repo = new SettingsRepository(storage.db)

    repo.setLlmImageConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'top-secret', model: 'm' })
    const summary = repo.getImageGenSummary()

    expect(summary.llm).toMatchObject({ baseUrl: 'https://api.example.com/v1', model: 'm' })
    expect(JSON.stringify(summary)).not.toContain('top-secret')
    storage.close()
  })

  it('returns null for incomplete configs', async () => {
    const storage = await openTemporaryStorage()
    const repo = new SettingsRepository(storage.db)
    expect(repo.getLlmImageConfig()).toBeNull()
    expect(repo.getComfyUiConfig()).toBeNull()
    expect(repo.getImageGenSummary()).toEqual({})
    storage.close()
  })

  it('defaults text-gen to deepseek-official and persists overrides', async () => {
    const storage = await openTemporaryStorage()
    const repo = new SettingsRepository(storage.db)

    // 未配置时回退到官方适配器默认值
    expect(repo.getTextGenConfig()).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })

    repo.setTextGenConfig({ provider: 'pi-ai', model: 'gpt-4o' })
    expect(repo.getTextGenConfig()).toEqual({ provider: 'pi-ai', model: 'gpt-4o' })

    // 空白字段回退默认，避免空 provider 打到 llm 服务报错
    repo.setTextGenConfig({ provider: '  ', model: '' })
    expect(repo.getTextGenConfig()).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    storage.close()
  })
})
