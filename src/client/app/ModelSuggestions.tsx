/** 模型候选列表：拉取后展示，可勾选多个存入后端分组，支持关键字过滤与全选。 */
export function ModelSuggestions(props: {
  options: string[]
  filter: string
  onFilterChange: (value: string) => void
  selected: string[]
  onToggle: (model: string) => void
  onPickPrimary: (model: string) => void
  onSelectAll: () => void
  loading: boolean
}) {
  const { options, filter, onFilterChange, selected, onToggle, onPickPrimary, onSelectAll, loading } = props
  if (loading) {
    return <div className="pa-model-suggest__loading">正在拉取模型列表…</div>
  }
  if (options.length === 0 && selected.length === 0) return null
  const allSelected = options.length > 0 && options.every((m) => selected.includes(m))
  return (
    <div className="pa-model-suggest">
      {selected.length > 0 && (
        <div className="pa-model-suggest__selected">
          <span className="pa-model-suggest__selected-label">已选模型（{selected.length}）：</span>
          {selected.map((model) => (
            <button key={model} type="button" className="pa-model-chip" onClick={() => onToggle(model)} title={`移除 ${model}`}>
              {model} <span aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      )}
      {options.length > 0 && (
        <>
          <div className="pa-model-suggest__toolbar">
            <input
              type="text"
              className="pa-model-suggest__filter"
              placeholder="搜索模型名…"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
            />
            <button type="button" className="pa-model-suggest__select-all" onClick={onSelectAll}>
              {allSelected ? '全选 ✓' : '全选'}
            </button>
          </div>
          <ul className="pa-model-suggest__list">
            {options.slice(0, 100).map((model) => {
              const checked = selected.includes(model)
              return (
                <li key={model}>
                  <button type="button" className="pa-model-suggest__item" onClick={() => onToggle(model)}>
                    <span className="pa-model-suggest__check" data-checked={checked}>{checked ? '✓' : ''}</span>
                    <span className="pa-model-suggest__name">{model}</span>
                    <span className="pa-model-suggest__set" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onPickPrimary(model) }} onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), onPickPrimary(model))}>设为主模型</span>
                  </button>
                </li>
              )
            })}
            {options.length === 0 && <li className="pa-model-suggest__empty">无匹配模型</li>}
          </ul>
        </>
      )}
    </div>
  )
}
