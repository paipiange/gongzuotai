/**
 * 分组模型选择器：整个工作台统一使用。
 *
 * 结构：分组（provider / 后端）→ 该分组下支持的模型列表。
 * 展开后按分组分层展示，点选某一模型即完成选择；触发按钮上显示「分组 / 模型」。
 *
 * 数据源通常是 listBackends() 的 Backend[]，调用方负责把后端映射成
 * GroupedModelPicker 的 groups 结构（见下方 `backendToGroups` 辅助）。
 */

import { CaretDown, Check } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface ModelGroup {
  /** 分组唯一标识（通常为后端 id）。 */
  id: string
  /** 分组显示名（通常为后端 name / provider）。 */
  label: string
  /** 该分组下可选的模型名。 */
  models: string[]
  /** 分组附加说明（可选，如「本机 ComfyUI」）。 */
  hint?: string
}

export interface GroupedModelPickerProps {
  groups: ModelGroup[]
  /** 当前选中值，格式 `group.id::model`，空串表示未选。 */
  value: string
  onChange: (value: string) => void
  /** 空态提示（无任何分组时）。 */
  placeholder?: string
  /** 无分组时触发的提示文字（可选）。 */
  emptyHint?: string
  disabled?: boolean
}

/** 编码选中值：`group.id::model`。 */
export function encodePick(groupId: string, model: string): string {
  return `${groupId}::${model}`
}

/** 解码选中值，返回 { groupId, model }；非法值返回 null。 */
export function decodePick(value: string): { groupId: string; model: string } | null {
  if (!value) return null
  const idx = value.indexOf('::')
  if (idx <= 0 || idx === value.length - 2) return null
  return { groupId: value.slice(0, idx), model: value.slice(idx + 2) }
}

/**
 * 把一个 Backend 映射成一个 ModelGroup（取默认模型 + models 分组去重）。
 * 用于 AI 生图（llm-image）与公众号创作（llm-text / llm-image）。
 */
export function backendToGroup(b: {
  id: string
  name: string
  kind: 'llm-text' | 'llm-image' | 'comfyui'
  llm?: { model: string; models?: string[] }
  text?: { model: string; models?: string[] }
}): ModelGroup {
  const models: string[] = []
  let hint: string | undefined
  if (b.kind === 'llm-image') {
    if (b.llm?.model) models.push(b.llm.model)
    for (const m of b.llm?.models ?? []) models.push(m)
    hint = '图片 API'
  } else if (b.kind === 'llm-text') {
    if (b.text?.model) models.push(b.text.model)
    for (const m of b.text?.models ?? []) models.push(m)
    hint = '文字 API'
  } else {
    hint = '本机 ComfyUI'
  }
  return { id: b.id, label: b.name, models: Array.from(new Set(models)), hint }
}

export function GroupedModelPicker({ groups, value, onChange, placeholder, emptyHint, disabled }: GroupedModelPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const current = decodePick(value)
  const currentGroup = current ? groups.find((g) => g.id === current.groupId) : undefined

  // 点击外部关闭。
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const totalModels = useMemo(() => groups.reduce((n, g) => n + g.models.length, 0), [groups])

  const displayLabel = current && currentGroup
    ? `${currentGroup.label} · ${current.model}`
    : placeholder ?? '选择模型'

  return (
    <div className="pa-gmp" ref={rootRef}>
      <button
        type="button"
        className="pa-gmp__trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="pa-gmp__trigger-label" data-empty={!current}>
          {displayLabel}
        </span>
        <CaretDown aria-hidden="true" size={15} className="pa-gmp__caret" data-open={open} />
      </button>

      {open && (
        <div className="pa-gmp__menu" role="listbox">
          {groups.length === 0 ? (
            <div className="pa-gmp__empty">{emptyHint ?? '暂无可用分组'}</div>
          ) : (
            groups.map((group) => (
              <div key={group.id} className="pa-gmp__group">
                <div className="pa-gmp__group-head">
                  <span className="pa-gmp__group-label">{group.label}</span>
                  {group.hint && <span className="pa-gmp__group-hint">{group.hint}</span>}
                </div>
                {group.models.length === 0 ? (
                  <div className="pa-gmp__group-empty">该分组暂无模型</div>
                ) : (
                  <ul className="pa-gmp__list">
                    {group.models.map((model) => {
                      const pick = encodePick(group.id, model)
                      const selected = pick === value
                      return (
                        <li key={pick}>
                          <button
                            type="button"
                            className="pa-gmp__item"
                            role="option"
                            aria-selected={selected}
                            data-selected={selected}
                            onClick={() => {
                              onChange(pick)
                              setOpen(false)
                            }}
                          >
                            <span className="pa-gmp__check" data-checked={selected}>
                              {selected ? <Check aria-hidden="true" size={12} weight="bold" /> : ''}
                            </span>
                            <span className="pa-gmp__name">{model}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ))
          )}
          <div className="pa-gmp__foot">{groups.length} 个分组 · {totalModels} 个模型</div>
        </div>
      )}
    </div>
  )
}
