import { ArrowLeft, ArrowUpRight, CheckCircle, ImageSquare, Plus, Sparkle, TextT, UploadSimple, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  assetUrl,
  generateImages,
  generateTextStream,
  listAssets,
  listBackends,
  listTemplates,
  type Backend,
  type GeneratedImageResult,
  type TemplateRecord,
} from './hostClient'
import { extractImageFilesFromClipboard, readImageAsDataUrl } from './pasteImages'
import { GroupedModelPicker, backendToGroup, decodePick, type ModelGroup } from './GroupedModelPicker'
import { Lightbox } from './Lightbox'

interface Toast {
  (message: string, tone?: 'info' | 'success' | 'warning'): void
}

/** 提取 promptTemplate 里所有 {{占位符}}（去重、保序）。 */
function extractPlaceholders(template: string): string[] {
  const out: string[] = []
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template))) {
    const key = m[1].trim()
    if (key && !out.includes(key)) out.push(key)
  }
  return out
}

/** 用字段值替换 promptTemplate 里的 {{占位符}}。 */
function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    const k = key.trim()
    return values[k] ?? `{{${k}}}`
  })
}

/** 图片类模板（按分类判断）：漫画 / 图片 走生图，其余走生文。 */
function isImageTemplate(category: string): boolean {
  return /漫画|图片|插画|绘图/.test(category)
}

/** 漫画模板（带固定男女主参考图 + 角色选择）。 */
function isComicTemplate(category: string, name: string): boolean {
  return /漫画/.test(category) || /漫画/.test(name)
}

type RoleChoice = 'female' | 'male' | 'both'

const ROLE_LABELS: Record<RoleChoice, string> = {
  female: '只有女主',
  male: '只有男主',
  both: '男女同框',
}

/**
 * 「模板中心」面板：
 * 1. 首页卡片宫格：封面图 + 名称 + 描述 + 分类标签，点击进入详情。
 * 2. 详情页左右双栏：左侧创作设置表单，右侧实时预览。
 */
export function TemplateUsePanel({ onToast }: { onToast: Toast }) {
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState('全部模板')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [imageBackends, setImageBackends] = useState<Backend[]>([])
  const [textBackends, setTextBackends] = useState<Backend[]>([])
  const [imagePick, setImagePick] = useState('')
  const [textPick, setTextPick] = useState('')
  const [results, setResults] = useState<GeneratedImageResult[]>([])
  const [textResult, setTextResult] = useState('')
  const [lastPrompt, setLastPrompt] = useState('')
  const [lightbox, setLightbox] = useState<{ ids: string[]; index: number } | null>(null)

  // 漫画模板专属状态
  const [roleChoice, setRoleChoice] = useState<RoleChoice>('female')
  const [sourceImages, setSourceImages] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadAll = async () => {
    const [tpls, backends] = await Promise.all([listTemplates(), listBackends()])
    setTemplates(tpls)
    const imgs = backends.filter((b) => b.kind === 'llm-image' || b.kind === 'comfyui')
    const texts = backends.filter((b) => b.kind === 'llm-text')
    setImageBackends(imgs)
    setTextBackends(texts)
    // 首次加载：默认选中第一个分组里的第一个模型。
    setImagePick((prev) => {
      const gid = decodePick(prev)?.groupId
      if (imgs.some((b) => b.id === gid)) return prev
      const first = backendToGroup(imgs[0])
      return first?.models[0] ? `${first.id}::${first.models[0]}` : ''
    })
    setTextPick((prev) => {
      const gid = decodePick(prev)?.groupId
      if (texts.some((b) => b.id === gid)) return prev
      const first = backendToGroup(texts[0])
      return first?.models[0] ? `${first.id}::${first.models[0]}` : ''
    })
  }

  const imageModelGroups = useMemo<ModelGroup[]>(() => imageBackends.map(backendToGroup), [imageBackends])
  const textModelGroups = useMemo<ModelGroup[]>(() => textBackends.map(backendToGroup), [textBackends])

  useEffect(() => {
    let cancelled = false
    loadAll()
      .then(() => { if (!cancelled) setLoaded(true) })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active = templates.find((t) => t.id === activeId) ?? null
  const placeholders = useMemo(() => (active ? extractPlaceholders(active.promptTemplate) : []), [active])

  // 分类标签（去重、保序，首项为「全部模板」）。
  const categories = useMemo(() => {
    const set: string[] = ['全部模板']
    for (const t of templates) {
      const cat = t.category || '未分类'
      if (!set.includes(cat)) set.push(cat)
    }
    return set
  }, [templates])

  const visibleTemplates = useMemo(() => {
    if (categoryFilter === '全部模板') return templates
    return templates.filter((t) => (t.category || '未分类') === categoryFilter)
  }, [templates, categoryFilter])

  const openTemplate = (tpl: TemplateRecord) => {
    setActiveId(tpl.id)
    setValues({})
    setResults([])
    setTextResult('')
    setLastPrompt('')
    setRoleChoice('female')
    setSourceImages([])
  }

  const closeDetail = () => {
    setActiveId(null)
    setValues({})
    setResults([])
    setTextResult('')
    setLastPrompt('')
    setSourceImages([])
  }

  const isImage = active ? isImageTemplate(active.category) : false
  const isComic = active ? isComicTemplate(active.category, active.name) : false
  const isImg = isImage
  const isComicTpl = isComic

  /** 从素材库拉取固定男女主参考图，转成 data URL（按角色选择）。 */
  const loadRoleReferenceImages = async (): Promise<string[]> => {
    const refs = await listAssets({ kind: 'image', tags: ['情侣漫画', '参考图'] })
    const female = refs.find((a) => /女主|female/i.test(a.name))
    const male = refs.find((a) => /男主|male/i.test(a.name))

    const toDataUrl = async (asset: NonNullable<typeof female>): Promise<string | null> => {
      try {
        const blob = await (await fetch(assetUrl(asset.id))).blob()
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
      } catch {
        return null
      }
    }

    const out: string[] = []
    if (roleChoice === 'female' && female) {
      const d = await toDataUrl(female)
      if (d) out.push(d)
    } else if (roleChoice === 'male' && male) {
      const d = await toDataUrl(male)
      if (d) out.push(d)
    } else if (roleChoice === 'both') {
      for (const a of [female, male]) {
        if (!a) continue
        const d = await toDataUrl(a)
        if (d) out.push(d)
      }
    }
    return out
  }

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = extractImageFilesFromClipboard(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    for (const file of files) {
      try {
        const dataUrl = await readImageAsDataUrl(file)
        setSourceImages((prev) => [...prev, dataUrl])
      } catch (cause) {
        onToast(cause instanceof Error ? cause.message : '图片读取失败', 'warning')
      }
    }
  }

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        onToast('请选择图片文件', 'warning')
        continue
      }
      if (file.size > 16 * 1024 * 1024) {
        onToast('参考图不能超过 16MB', 'warning')
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : null
        if (dataUrl) setSourceImages((prev) => [...prev, dataUrl])
      }
      reader.readAsDataURL(file)
    }
    event.target.value = ''
  }

  const removeSourceImage = (index: number) => {
    setSourceImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleGenerate = async () => {
    if (!active) return
    const missing = placeholders.filter((p) => !(values[p] ?? '').trim())
    if (missing.length) {
      onToast(`请填写：${missing.join('、')}`, 'warning')
      return
    }
    const prompt = fillTemplate(active.promptTemplate, values)
    setLastPrompt(prompt)
    setBusy(true)
    setResults([])
    setTextResult('')
    try {
      if (isImage) {
        const decodedImage = decodePick(imagePick)
        const backend = imageBackends.find((b) => b.id === decodedImage?.groupId) ?? imageBackends[0]
        if (!backend) {
          onToast('请先在「设置中心 → 后端管理」添加一个图片后端', 'warning')
          return
        }
        const model = decodedImage?.model ?? ''
        // 漫画模板：角色参考图（身份锚点）+ 用户原图（改编素材）
        const roleRefs = isComic ? await loadRoleReferenceImages() : []
        const images = [...roleRefs, ...sourceImages]
        // 竖版海报输出。优先 3:4 竖版，但 OpenAI 兼容网关对 1080×1440 处理极慢（实测 60~70s，
        // 贴着网关 ~60s 超时生死线，极易 504/524/挂死）；改用 1024×1536（同为 2:3 竖版），
        // 实测稳定 42~66s，大幅降低失败率。本机 ComfyUI 不受此限制。
        const isOpenAiBackend = backend.kind === 'llm-image'
        const outW = isOpenAiBackend ? 1024 : 1080
        const outH = isOpenAiBackend ? 1536 : 1440
        const generated = await generateImages({
          backendId: backend.id,
          request: {
            prompt,
            width: outW,
            height: outH,
            ...(model ? { model } : {}),
            ...(images.length ? { images, denoise: 0.7 } : {}),
          },
        })
        setResults(generated)
        onToast(`已生成 ${generated.length} 张图片`, 'success')
      } else {
        const decodedText = decodePick(textPick)
        const backend = textBackends.find((b) => b.id === decodedText?.groupId) ?? textBackends[0]
        if (!backend?.text) {
          onToast('请先在「设置中心 → 后端管理」添加一个文本后端', 'warning')
          return
        }
        const model = decodedText?.model ?? backend.text.model
        let streamed = ''
        await generateTextStream(
          { model, studio: 'article', topic: prompt, backendId: backend.id },
          (event) => {
            if (event.delta) {
              streamed += event.delta
              setTextResult(streamed)
            }
            if (event.error) onToast(event.error, 'warning')
          },
        )
        if (streamed) onToast('已生成文本', 'success')
      }
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '生成失败', 'warning')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded && templates.length === 0) {
    return <section className="pa-panel pa-template-center"><p className="pa-template-center__empty">加载模板中…</p></section>
  }

  // ===== 详情页：左右双栏 =====
  if (active) {
    return (
      <>
      <section className="pa-template-center">
        <button type="button" className="pa-template-center__back" onClick={closeDetail}>
          <ArrowLeft aria-hidden="true" size={16} />返回模板中心
        </button>

        <div className="pa-template-detail">
          {/* 左栏：创作设置表单 */}
          <form className="pa-template-detail__form" onSubmit={(event) => { event.preventDefault(); void handleGenerate() }}>
            <div className="pa-template-detail__title">
              <div>
                <h2>{active.name}</h2>
                <small>{active.category}{active.isBuiltin ? ' · 内置' : ''}</small>
              </div>
              <span className="pa-template-detail__ready"><CheckCircle aria-hidden="true" size={15} weight="fill" />已就绪</span>
            </div>

            <div className="pa-template-detail__section">
              <span className="pa-template-detail__label">创作设置</span>

              {isComicTpl ? (
                <div className="pa-template-detail__comic">
                  <label className="pa-field pa-field--full">
                    <span>文案 / 主题 <b aria-hidden="true">*</b></span>
                    <textarea
                      value={values['主题/文案'] ?? values['主题'] ?? ''}
                      placeholder="输入你的故事或主题…"
                      maxLength={2000}
                      onPaste={handlePaste}
                      onChange={(event) => setValues((prev) => ({ ...prev, '主题/文案': event.target.value, '主题': event.target.value }))}
                    />
                  </label>

                  <div className="pa-field pa-field--full">
                    <span>人物组合</span>
                    <div className="pa-template-center__roles" role="radiogroup" aria-label="角色选择">
                      {(Object.keys(ROLE_LABELS) as RoleChoice[]).map((role) => (
                        <button
                          key={role}
                          type="button"
                          role="radio"
                          aria-checked={roleChoice === role}
                          data-active={roleChoice === role}
                          onClick={() => setRoleChoice(role)}
                        >
                          {ROLE_LABELS[role]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pa-field pa-field--full">
                    <span>参考图片（可选，支持 Ctrl+V 粘贴）</span>
                    <div className="pa-template-detail__dropzone">
                      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handleUpload} className="pa-visually-hidden" />
                      <button type="button" className="pa-template-detail__dropzone-btn" onClick={() => fileInputRef.current?.click()}>
                        <ImageSquare aria-hidden="true" size={22} weight="duotone" />
                        <span>{sourceImages.length ? '继续添加图片' : '点击或拖拽上传'}</span>
                      </button>
                      {sourceImages.length > 0 && (
                        <button type="button" className="pa-icon-button" aria-label="清除全部原图" title="清除全部原图" onClick={() => setSourceImages([])}><X aria-hidden="true" size={16} /></button>
                      )}
                    </div>
                    {sourceImages.length > 0 && (
                      <div className="pa-template-center__ref-list">
                        {sourceImages.map((img, index) => (
                          <div key={index} className="pa-template-center__ref-item">
                            <img src={img} alt={`原图 ${index + 1}`} />
                            <button type="button" className="pa-icon-button pa-template-center__ref-remove" aria-label={`移除原图 ${index + 1}`} title="移除" onClick={() => removeSourceImage(index)}><X aria-hidden="true" size={14} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : placeholders.length === 0 ? (
                <p className="pa-template-center__hint">该模板无可填字段，将直接使用内置提示词生成。</p>
              ) : (
                <div className="pa-template-center__fields">
                  {placeholders.map((p) => (
                    <label key={p} className="pa-field">
                      <span>{p}</span>
                      <input type="text" value={values[p] ?? ''} placeholder={`请输入「${p}」`} onChange={(event) => setValues((prev) => ({ ...prev, [p]: event.target.value }))} />
                    </label>
                  ))}
                </div>
              )}

              {isImg && (
                <label className="pa-field">
                  <span>模型</span>
                  <GroupedModelPicker
                    groups={imageModelGroups}
                    value={imagePick}
                    onChange={setImagePick}
                    placeholder="选择图片模型"
                    emptyHint="暂无可用的图片后端"
                  />
                </label>
              )}
              {!isImg && (
                <label className="pa-field">
                  <span>模型</span>
                  <GroupedModelPicker
                    groups={textModelGroups}
                    value={textPick}
                    onChange={setTextPick}
                    placeholder="选择文字模型"
                    emptyHint="暂无可用的文字后端"
                  />
                </label>
              )}
            </div>

            <button type="submit" className="pa-primary-button pa-template-detail__submit" disabled={busy}>
              <Sparkle aria-hidden="true" size={18} weight="fill" />{busy ? '生成中…' : '开始创作'}
            </button>
          </form>

          {/* 右栏：实时预览 */}
          <div className="pa-template-detail__preview">
            <div className="pa-template-detail__preview-head">
              <span>效果预览</span>
              <span className="pa-template-detail__sample">示例</span>
            </div>

            <div className="pa-template-detail__preview-body">
              {results.length > 0 ? (
                <div className="pa-template-center__results">
                  {results.map((img, idx) => (
                    <figure key={img.id} className="pa-template-center__result">
                      <button
                        type="button"
                        className="pa-template-center__result-btn"
                        onClick={() => setLightbox({ ids: results.map((r) => r.id), index: idx })}
                        title="点击查看大图"
                      >
                        <img src={assetUrl(img.id)} alt={`结果图 ${idx + 1}`} loading="lazy" />
                      </button>
                      <figcaption>
                        {results.length > 1 && <span className="pa-template-center__result-idx">{idx + 1}/{results.length}</span>}
                        <a className="pa-link-button" href={assetUrl(img.id)} download target="_blank" rel="noreferrer">下载</a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : textResult ? (
                <pre className="pa-template-detail__text">{textResult}</pre>
              ) : active.coverAssetId ? (
                <div className="pa-template-detail__cover">
                  <img src={assetUrl(active.coverAssetId)} alt={active.name} />
                </div>
              ) : (
                <div className="pa-template-detail__placeholder">
                  {isImg ? <ImageSquare aria-hidden="true" size={40} weight="duotone" /> : <TextT aria-hidden="true" size={40} weight="duotone" />}
                  <strong>效果预览</strong>
                  <p>填写左侧参数后点击「开始创作」，结果将在这里展示。</p>
                </div>
              )}
            </div>

            <div className="pa-template-detail__preview-foot">
              <span>生成完毕后可查看、下载和重新生成</span>
              {isComicTpl && <span className="pa-template-center__hint">按所选角色锁定人物，参考原图改编成 Q 版情侣漫画。</span>}
            </div>

            {lastPrompt && (
              <details className="pa-template-center__prompt">
                <summary>查看最终提示词</summary>
                <pre>{lastPrompt}</pre>
              </details>
            )}
          </div>
        </div>
      </section>
      {lightbox && <Lightbox assetIds={lightbox.ids} index={lightbox.index} onClose={() => setLightbox(null)} />}
      </>
    )
  }

  // ===== 首页：卡片宫格 =====
  return (
    <section className="pa-template-center">
      <div className="pa-template-center__hero">
        <div>
          <h2>探索创作模板</h2>
          <p>选择一个模板，快速开始创作</p>
        </div>
        <button type="button" className="pa-template-center__new" onClick={() => onToast('新建模板请到「设置中心 → 模板管理」导入')}>
          <Plus aria-hidden="true" size={17} />新建模板
        </button>
      </div>

      {categories.length > 1 && (
        <div className="pa-template-center__pills" aria-label="模板分类筛选">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              data-active={categoryFilter === cat}
              aria-pressed={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {templates.length === 0 ? (
        <p className="pa-template-center__empty">暂无模板。可到「设置中心 → 模板管理」导入，或等待内置模板加载。</p>
      ) : visibleTemplates.length === 0 ? (
        <p className="pa-template-center__empty">该分类下暂无模板。</p>
      ) : (
        <div className="pa-template-center__grid" data-count={visibleTemplates.length}>
          {visibleTemplates.map((tpl) => {
            const isImg = isImageTemplate(tpl.category)
            const isComicTpl = isComicTemplate(tpl.category, tpl.name)
            return (
              <button key={tpl.id} type="button" className="pa-template-center__card" onClick={() => openTemplate(tpl)}>
                <span className="pa-template-center__card-cover">
                  {tpl.coverAssetId ? (
                    <img src={assetUrl(tpl.coverAssetId)} alt={tpl.name} loading="lazy" />
                  ) : (
                    <span className="pa-template-center__card-cover-fallback">
                      {isImg ? <ImageSquare aria-hidden="true" size={30} weight="duotone" /> : <TextT aria-hidden="true" size={30} weight="duotone" />}
                    </span>
                  )}
                </span>
                <span className="pa-template-center__card-body">
                  <strong>{tpl.name}</strong>
                  <small>{tpl.description || '按模板提示词快速生成内容'}</small>
                  <span className="pa-template-center__card-foot">
                    <span className="pa-template-center__card-tag">{isComicTpl ? '漫画' : isImg ? '图片' : '图文'}</span>
                    <ArrowUpRight aria-hidden="true" size={16} />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
