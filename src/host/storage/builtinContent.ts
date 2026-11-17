import type Database from 'better-sqlite3'
import { InspirationRepository, type CreateInspirationInput } from './inspirationRepository'
import { TemplateRepository, type CreateTemplateInput } from './templateRepository'

/**
 * 预置内容（内置模板 + 内置灵感）。
 *
 * 这些是虚构、可公开的示例内容，用于「开箱即用」：新用户首次启动即可在
 * 灵感中心看到选题、在模板管理中看到跨平台创作模板，而不必从空库开始。
 *
 * 幂等策略：用 `app_settings` 表里的 `builtin_content_version` 标记已 seed 的
 * 版本号。只有当前版本小于 `BUILTIN_CONTENT_VERSION` 时才写入，因此重复启动
 * 不会重复插入；将来要追加第二批内置内容时，把 `BUILTIN_CONTENT_VERSION` 递增
 * 并在 seed 里按版本号做增量即可。
 */

export const BUILTIN_CONTENT_VERSION = 1

const SEED_VERSION_KEY = 'builtin_content_version'

/** 内置创作模板。promptTemplate 里的 `{{占位符}}` 表示使用时可替换的动态字段。 */
export const BUILTIN_TEMPLATES: CreateTemplateInput[] = [
  {
    category: '小红书',
    name: '小红书种草笔记',
    description: '第一人称真实体验 + 痛点共鸣 + 行动号召，适合带货与好物分享。',
    promptTemplate: `你是一位小红书爆款种草笔记写手。请围绕「{{产品/主题}}」，面向「{{目标人群}}」创作一篇种草笔记。

要求：
1. 标题不超过 20 字，含 1 个 emoji，制造好奇或痛点共鸣。
2. 开头用第一人称真实体验切入，点出「用了/试了之后」的直观改变。
3. 正文分 3~4 个小点，每个小点用一句口语化结论加简短展开，多用「我」「真的」「姐妹们」等口语。
4. 结尾给出行动号召（点赞/收藏/评论区交流），并附 3~5 个相关话题标签。
5. 全文口语化、无 AI 味，避免「首先/其次/综上所述」等书面连接词。

请直接输出笔记正文。`,
  },
  {
    category: '小红书',
    name: '小红书干货合集',
    description: '结构化清单 + 可收藏排版，适合教程、攻略、清单类内容。',
    promptTemplate: `你是一位擅长做「干货合集」的小红书博主。请围绕「{{主题}}」整理一篇收藏向的干货笔记。

要求：
1. 标题用「数字 + 结果导向」，例如「3 步搞懂 X」「5 个 Y 的避坑清单」。
2. 开头一句点明「谁适合看、看完能解决什么」。
3. 正文按 3~6 个要点分条列出，每条配一句 emoji 小标题 + 2~3 句展开说明。
4. 结尾附一个「收藏提醒」和 3~5 个话题标签。
5. 语言轻松、条目清晰，方便读者截图收藏。

请直接输出笔记正文。`,
  },
  {
    category: '公众号',
    name: '公众号深度推文',
    description: '观点 + 论据 + 案例的深度长文结构，适合行业观察与知识输出。',
    promptTemplate: `你是一位公众号深度内容写作者。请围绕「{{主题}}」撰写一篇深度推文。

要求：
1. 标题有观点或悬念，副标题一句话概括核心价值。
2. 开头用现象、故事或反常识问题切入，快速建立读者共鸣。
3. 主体分 3~4 个小节，每节「观点 → 论据/数据 → 案例 → 小结」推进，用小标题分隔。
4. 文末总结核心观点，并抛出 1 个开放问题引导读者留言互动。
5. 语言克制、有信息密度，避免空洞口号和车轱辘话。

请直接输出推文正文。`,
  },
  {
    category: '公众号',
    name: '公众号观点评论',
    description: '就热点事件表达立场，结构紧凑、观点鲜明。',
    promptTemplate: `你是一位观点鲜明的公众号评论员。请就「{{事件/话题}}」撰写一篇评论文章。

要求：
1. 标题直接亮明态度，不模棱两可。
2. 开头用一两句概述事件，然后立即抛出你的核心判断。
3. 主体围绕 2~3 个分论点展开，每个论点先结论后论证，必要时引用事实或常识逻辑。
4. 立场清晰但论述克制，不煽动、不人身攻击。
5. 结尾给出建设性建议或呼吁。

请直接输出评论正文。`,
  },
  {
    category: '知乎',
    name: '知乎高赞回答',
    description: '先给结论再给依据，逻辑链完整，适合问答与经验分享。',
    promptTemplate: `你是一位知乎高赞答主。请回答「{{问题}}」。

要求：
1. 开头第一句直接给出结论或鲜明态度，抓住读者。
2. 接着用「先说结论 → 分层论证 → 补充细节 → 总结」的结构展开。
3. 论证中穿插具体例子或可操作建议，避免空谈。
4. 分点清晰，每点有小标题或序号。
5. 结尾简短总结，并欢迎评论区进一步交流。

请直接输出回答正文。`,
  },
  {
    category: '短视频',
    name: '短视频口播脚本',
    description: '黄金 3 秒开头 + 信息节奏 + 结尾钩子，适合口播类视频。',
    promptTemplate: `你是一位短视频口播脚本写手。请围绕「{{主题}}」写一段 60 秒左右的口播脚本。

要求：
1. 前 3 秒用反问、反常识或痛点直击，留住观众。
2. 主体按「抛出问题 → 给出 3 个要点 → 每个要点一句金句」的节奏推进。
3. 每句话短促有力，适合念出来，避免长句和书面语。
4. 结尾留一个钩子（关注/追问/下集预告）。
5. 脚本按「画面提示」与「口播词」两栏分段输出。

请直接输出脚本。`,
  },
  {
    category: '营销',
    name: '产品上新营销文案',
    description: '卖点提炼 + 场景化表达 + 转化引导，适合电商与活动推广。',
    promptTemplate: `你是一位资深营销文案。请为「{{产品}}」写一段上新营销文案。

要求：
1. 先提炼 3 个核心卖点，每个卖点用一句用户能感知的收益表达。
2. 文案开头制造场景感或紧迫感，让目标用户对号入座。
3. 中间用短句分点呈现卖点，配合具体细节增强可信度。
4. 结尾给出明确的行动号召（限时、优惠、试用等）。
5. 语言有感染力但不夸张，避免虚假承诺。

请直接输出文案。`,
  },
  {
    category: '通用',
    name: '通用长文写作框架',
    description: '适用于报告、总结、行业分析等长文的通用骨架。',
    promptTemplate: `你是一位专业写作者。请围绕「{{主题}}」撰写一篇结构完整的长文。

要求：
1. 开篇交代背景与写作目的，一句话说明本文要解决的问题。
2. 主体采用「是什么 → 为什么 → 怎么做 → 常见误区」或「现状 → 问题 → 原因 → 对策」的逻辑推进。
3. 每个章节设小标题，段落首句点明要点，论据与结论呼应。
4. 数据或例子用假设性示例即可，不编造真实数据。
5. 结尾总结全文，并给出可执行的下一步建议。

请直接输出正文。`,
  },
]

/** 内置灵感选题。标题与描述是用户直接看到的选题，可立即「以此为灵感创作」。 */
export const BUILTIN_INSPIRATIONS: CreateInspirationInput[] = [
  {
    title: '这 5 个 AI 工具，正在悄悄替代日常琐事',
    description: '盘点几类把重复劳动交给 AI 的实用工具，给出上手建议与适用场景。',
    category: '科技',
    tags: ['AI 工具', '效率', '办公'],
    promptTemplate: '围绕「AI 工具提效」写一篇实用盘点，含工具分类、上手难度与适用场景。',
  },
  {
    title: '每天通勤 1 小时，如何变成自我提升的黄金时间',
    description: '把碎片化的通勤时间系统利用起来，给出可执行的时间安排方案。',
    category: '职场',
    tags: ['通勤', '时间管理', '自我提升'],
    promptTemplate: '围绕「通勤时间管理」写一篇干货，给出可执行的碎片时间利用方案。',
  },
  {
    title: '久坐党自救指南：办公室里的 10 个微习惯',
    description: '不用离开工位也能缓解久坐疲劳的小动作与习惯，附提醒节奏。',
    category: '健康',
    tags: ['久坐', '健康', '微习惯'],
    promptTemplate: '围绕「办公室久坐健康」写一篇清单式指南，含 10 个可立即上手的微习惯。',
  },
  {
    title: '下班后 2 小时，从零开始一份靠谱副业',
    description: '评估几类低门槛副业方向，给出起步路径与避坑要点。',
    category: '职场',
    tags: ['副业', '下班', '成长'],
    promptTemplate: '围绕「下班后副业」写一篇入门指南，含方向评估、起步路径与常见坑。',
  },
  {
    title: '断舍离第一步：先扔掉这三类「舍不得但没用」的东西',
    description: '从最容易下手的三类物品切入，降低断舍离的心理门槛。',
    category: '生活',
    tags: ['断舍离', '整理', '极简'],
    promptTemplate: '围绕「断舍离入门」写一篇清单文章，聚焦最容易下手的三类物品。',
  },
  {
    title: '读过的书总记不住？试试这套三色笔记法',
    description: '介绍一种简单易上手的读书笔记方法，让阅读留下痕迹。',
    category: '成长',
    tags: ['读书', '笔记', '方法论'],
    promptTemplate: '围绕「读书笔记方法」写一篇方法教程，介绍三色笔记法的具体操作。',
  },
  {
    title: '城市漫步指南：一条老街串起的 6 个惊喜角落',
    description: '用 city walk 的方式重新认识所在城市，附路线规划小技巧。',
    category: '生活',
    tags: ['城市漫步', '旅行', '周末'],
    promptTemplate: '围绕「城市漫步」写一篇游记式攻略，含路线规划与惊喜发现。',
  },
  {
    title: '零基础学编程，第一个月该做什么',
    description: '为完全零基础的人规划入门路径，避开常见劝退点。',
    category: '科技',
    tags: ['编程', '零基础', '学习'],
    promptTemplate: '围绕「零基础学编程」写一篇入门路线，聚焦第一个月的具体安排。',
  },
  {
    title: '情绪上头时，试试「10 分钟暂停法」',
    description: '介绍一种即时可用的情绪管理小技巧，避免冲动决策。',
    category: '成长',
    tags: ['情绪管理', '心理', '自我调节'],
    promptTemplate: '围绕「情绪管理」写一篇实用短文，介绍 10 分钟暂停法的操作步骤。',
  },
  {
    title: '小户型的收纳魔法：让每个角落都物尽其用',
    description: '针对小空间的高效收纳思路，从门后、床底到墙面逐一拆解。',
    category: '生活',
    tags: ['收纳', '小户型', '家居'],
    promptTemplate: '围绕「小户型收纳」写一篇实用清单，按空间分区给出收纳思路。',
  },
]

/** 读取已 seed 的内置内容版本号。 */
function getSeedVersion(db: Database.Database): number {
  const row = db
    .prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get(SEED_VERSION_KEY) as { value_json: string } | undefined
  if (!row) return 0
  try {
    const parsed = JSON.parse(row.value_json) as unknown
    return typeof parsed === 'number' ? parsed : 0
  } catch {
    return 0
  }
}

/** 记录已 seed 的内置内容版本号。 */
function setSeedVersion(db: Database.Database, version: number): void {
  db.prepare(
    'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
  ).run(SEED_VERSION_KEY, JSON.stringify(version), new Date().toISOString())
}

/**
 * 幂等地把内置模板与灵感写入数据库。返回本次实际插入的数量。
 * 仅在 `builtin_content_version` 小于当前版本号时写入。
 */
export function seedBuiltinContent(db: Database.Database): { templates: number; inspirations: number } {
  if (getSeedVersion(db) >= BUILTIN_CONTENT_VERSION) return { templates: 0, inspirations: 0 }

  const templates = new TemplateRepository(db)
  const inspirations = new InspirationRepository(db)
  let templateCount = 0
  let inspirationCount = 0

  db.transaction(() => {
    for (const input of BUILTIN_TEMPLATES) {
      templates.create({ ...input, isBuiltin: true })
      templateCount += 1
    }
    for (const input of BUILTIN_INSPIRATIONS) {
      inspirations.create({ ...input, isBuiltin: true })
      inspirationCount += 1
    }
    setSeedVersion(db, BUILTIN_CONTENT_VERSION)
  })()

  return { templates: templateCount, inspirations: inspirationCount }
}
