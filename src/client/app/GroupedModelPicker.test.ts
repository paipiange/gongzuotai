import { describe, expect, it } from 'vitest'
import { backendToGroup, decodePick, encodePick } from './GroupedModelPicker'

describe('encodePick / decodePick', () => {
  it('编码并解码选中值', () => {
    expect(encodePick('backend-1', 'gpt-4o')).toBe('backend-1::gpt-4o')
    expect(decodePick('backend-1::gpt-4o')).toEqual({ groupId: 'backend-1', model: 'gpt-4o' })
  })

  it('模型名本身含 :: 时按首个分隔符切分', () => {
    expect(decodePick('b::model::with::colons')).toEqual({ groupId: 'b', model: 'model::with::colons' })
  })

  it('非法值返回 null', () => {
    expect(decodePick('')).toBeNull()
    expect(decodePick('no-separator')).toBeNull()
    expect(decodePick('::model')).toBeNull()
    expect(decodePick('b::')).toBeNull()
  })
})

describe('backendToGroup', () => {
  it('llm-image 后端：默认模型 + models 分组去重', () => {
    const group = backendToGroup({
      id: 'img-1',
      name: '通义万相',
      kind: 'llm-image',
      llm: { model: 'wanx2.1', models: ['wanx2.1', 'wanx-t2i'] },
    })
    expect(group.id).toBe('img-1')
    expect(group.label).toBe('通义万相')
    expect(group.hint).toBe('图片 API')
    expect(group.models).toEqual(['wanx2.1', 'wanx-t2i'])
  })

  it('llm-text 后端：默认模型 + models 去重', () => {
    const group = backendToGroup({
      id: 'txt-1',
      name: 'DeepSeek',
      kind: 'llm-text',
      text: { model: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
    })
    expect(group.models).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(group.hint).toBe('文字 API')
  })

  it('comfyui 后端：用 checkpoint 作为唯一模型标识，缺省回退 server', () => {
    const withCheckpoint = backendToGroup({
      id: 'c1',
      name: '本机',
      kind: 'comfyui',
      comfyui: { server: 'http://127.0.0.1:8188', checkpoint: 'qwen_edit.safetensors' },
    })
    expect(withCheckpoint.models).toEqual(['qwen_edit.safetensors'])
    expect(withCheckpoint.hint).toBe('本机 ComfyUI')

    const noCheckpoint = backendToGroup({
      id: 'c2',
      name: '本机2',
      kind: 'comfyui',
      comfyui: { server: 'http://127.0.0.1:8188' },
    })
    expect(noCheckpoint.models).toEqual(['http://127.0.0.1:8188'])

    const empty = backendToGroup({ id: 'c3', name: '本机3', kind: 'comfyui' })
    expect(empty.models).toEqual(['默认工作流'])
  })

  it('无默认模型且无 models 时返回空模型列表', () => {
    const group = backendToGroup({ id: 'x', name: '空', kind: 'llm-image' })
    expect(group.models).toEqual([])
  })
})
