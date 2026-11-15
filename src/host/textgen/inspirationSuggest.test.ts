import { describe, expect, it } from 'vitest'
import { suggestInspirations } from './inspirationSuggest'
import type { LlmService, StreamChunk } from './types'

function fakeLlm(text: string): LlmService {
  return {
    prepareCall() {
      return Promise.resolve({
        stream: async function* (): AsyncIterable<StreamChunk> {
          yield { type: 'text-delta', index: 0, text }
          yield { type: 'finish', reason: 'stop' }
        },
      })
    },
    listProviders() {
      return []
    },
  }
}

describe('inspirationSuggest', () => {
  it('parses a JSON array from the model and returns structured suggestions', async () => {
    const llm = fakeLlm('```json\n[{"title":"春日选题","description":"适合春季","promptTemplate":"写一篇春日文章","category":"文章创作","tags":["春天","散文"]}]\n```')
    const result = await suggestInspirations(llm, { provider: 'p', model: 'm', count: 3 })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('春日选题')
    expect(result[0].category).toBe('文章创作')
    expect(result[0].tags).toEqual(['春天', '散文'])
  })

  it('tolerates stray text around the JSON array', async () => {
    const llm = fakeLlm('好的，以下是推荐：[\n  {"title":"选题一","description":"d","promptTemplate":"p","category":"营销文案","tags":[]},\n  {"title":"选题二","description":"d2","promptTemplate":"p2","category":"图片生成","tags":["x"]}\n] 希望有帮助。')
    const result = await suggestInspirations(llm, { provider: 'p', model: 'm' })
    expect(result).toHaveLength(2)
    expect(result[1].title).toBe('选题二')
    expect(result[1].category).toBe('图片生成')
  })

  it('returns an empty list when the model output is not parseable JSON', async () => {
    const llm = fakeLlm('抱歉，我无法提供。')
    const result = await suggestInspirations(llm, { provider: 'p', model: 'm' })
    expect(result).toEqual([])
  })

  it('filters out invalid categories and entries without titles', async () => {
    const llm = fakeLlm('[{"title":"有效","category":"不存在的分类"},{"description":"无标题"},{"title":"有效二","category":"文章创作","tags":[1,2,"ok"]}]')
    const result = await suggestInspirations(llm, { provider: 'p', model: 'm' })
    expect(result).toHaveLength(2)
    // Invalid category falls back to 文章创作; non-string tags are dropped.
    expect(result[0].category).toBe('文章创作')
    expect(result[1].tags).toEqual(['ok'])
  })
})
