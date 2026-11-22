/**
 * 一键多平台改稿：把已生成的正文改写成目标平台的口吻与结构。
 * 纯提示词构造，不含网络/模型调用，便于复用与测试。
 */

export type RecastPlatform = 'xiaohongshu' | 'zhihu' | 'toutiao'

export interface RecastSpec {
  id: RecastPlatform
  label: string
  /** 改稿指令（插入到原文前，指导模型按目标平台重写）。 */
  instruction: string
}

export const RECAST_SPECS: RecastSpec[] = [
  {
    id: 'xiaohongshu',
    label: '转小红书',
    instruction: '请把下面的内容改写成一篇小红书笔记：口语化、第一人称、分段清晰、适当用 emoji，结尾附 3~5 个话题标签；不要照搬原结构，保留核心信息与观点即可。',
  },
  {
    id: 'zhihu',
    label: '转知乎',
    instruction: '请把下面的内容改写成一篇知乎回答：观点明确、逻辑严谨、有理有据，开头直接给结论，再分点展开；语气理性克制，避免口语化碎碎念。',
  },
  {
    id: 'toutiao',
    label: '转头条',
    instruction: '请把下面的内容改写成一篇今日头条文章：标题党但不失实、开头有钩子、段落短、信息密度高，适合碎片化阅读；保留核心信息与观点。',
  },
]

/** 构造「改稿」请求的主题字段：把原文整体作为待改写素材传给模型。 */
export function buildRecastPrompt(source: string, platform: RecastPlatform): string {
  const spec = RECAST_SPECS.find((item) => item.id === platform)
  if (!spec) return source
  return `${spec.instruction}\n\n【待改写原文】\n${source}`
}

export function recastSpecOf(platform: RecastPlatform): RecastSpec | undefined {
  return RECAST_SPECS.find((item) => item.id === platform)
}
