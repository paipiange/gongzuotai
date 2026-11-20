/**
 * 拍片哥工作台 · 视频风格资产库类型定义
 *
 * 风格定义是本工作台的原创资产：从 lemo-opuscar 的 99 种影片风格中提炼
 * 「风格事实」（媒介本质、色彩逻辑、动效、镜头语法、音色、原生动作、易错点），
 * 按统一模板重写，脱离上游文档的 CC BY-NC 约束，可随插件发行包商用。
 *
 * 风格本身不受版权保护（版权保护的是具体表达，而非风格/技法），此处仅保留
 * 可复用的「风格规则」，不含上游 demo 的片名、剧情、分镜、配色示例值等表达。
 */

/** 风格的稳定唯一标识（英文 slug，如 "neon-tubes"）。 */
export type StyleId = string

/** 15 大风格类别（中文名）。 */
export interface StyleCategory {
  id: string
  en: string
  cn: string
}

/** 一个风格的核心元信息。 */
export interface StyleMeta {
  id: StyleId
  /** 英文名，如 "Neon Tubes" */
  en: string
  /** 中文名，如 "霓虹灯管" */
  cn: string
  /** 分类 id */
  category: string
  /** 一句话说明这个媒介在画面上做什么（不含 demo 剧情）。 */
  essence: string
  /** 适用场景（1~3 条，中文）。 */
  uses: string[]
}

/**
 * 风格的完整「规则定义」——即喂给视频 LLM 的风格约束源。
 * 字段对应上游 STYLE.md 的固定章节，但内容已重写为拍片哥工作台语境。
 */
export interface StyleDefinition extends StyleMeta {
  /** 1. 本质：一眼认出这个风格的决定性特征，以及它「不是」什么（易混淆边界）。 */
  essenceTraits: string[]
  /** 1. 排除项：容易被混同、但明确不是本风格的东西。 */
  notThese: string[]
  /** 2. 材质与渲染：物理媒介 + 代码如何模拟（表面、笔触、层、边缘、纹理、光）。 */
  materials: string[]
  /** 3. 色彩逻辑：规则而非调色板（多少色相、中性底、强调色留给谁、明度排序、什么不可着色）。 */
  colorLogic: string[]
  /** 4. 字体与字幕：字的材质、大小、可读性、字幕呈现方式。 */
  typeRules: string[]
  /** 5. 动效质量：节奏、步进、确定性、动画风格。 */
  motion: string[]
  /** 6. 镜头语法：常用运镜及其表达意图。 */
  camera: string[]
  /** 7. 音色板：这个媒介自己的声音（用于后续配乐/音效）。 */
  sound: string[]
  /** 8. 原生动作：只有这个媒介能做到的招牌时刻。 */
  nativeMoves: string[]
  /** 9. 易错点：这个媒介的常见翻车。 */
  pitfalls: string[]
  /** 10. 变化空间：每部片子可自定义的维度。 */
  variation: string[]
}

/** 完整风格库：按分类分组 + 按 id 索引。 */
export interface StyleLibrary {
  categories: StyleCategory[]
  /** id -> 定义 */
  styles: Record<StyleId, StyleDefinition>
}

/** 风格库的静态 JSON 结构（由 scripts/build-styles.ts 生成，打进 dist）。 */
export interface StyleLibraryJson {
  categories: StyleCategory[]
  styles: StyleDefinition[]
}
