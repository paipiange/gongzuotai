import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { InspirationRepository, type CreateInspirationInput } from './inspirationRepository'
import { TemplateRepository, type CreateTemplateInput } from './templateRepository'
import { AssetRepository } from './assetRepository'
import { ensureRemoteAsset, remoteAssetIfCached, remoteAssetCacheRoot } from './remoteAssets'

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

export const BUILTIN_CONTENT_VERSION = 2

const SEED_VERSION_KEY = 'builtin_content_version'

/** 内置创作模板。promptTemplate 里的 `{{占位符}}` 表示使用时可替换的动态字段。 */
export const BUILTIN_TEMPLATES: CreateTemplateInput[] = [
  {
    category: '小红书',
    name: '小红书种草笔记',
    description: '第一人称真实体验 + 痛点共鸣 + 行动号召，适合带货与好物分享。',
    promptTemplate: `你是一位小红书爆款种草笔记写手。请围绕「{{主题}}」，面向「{{目标人群}}」创作一篇种草笔记。

要求：
1. 标题不超过 20 字，含 1 个 emoji，制造好奇或痛点共鸣。
2. 开头用第一人称真实体验切入，点出「用了/试了之后」的直观改变，不要泛泛而谈。
3. 正文分 3~4 个小点，每个小点一句口语化结论 + 2~3 句展开，多用「我」「真的」「姐妹们」等口语。
4. 结尾给出行动号召（点赞/收藏/评论交流），并附 3~5 个相关话题标签。
5. 语气自然克制，避免「首先/其次/综上所述」「相信/期待」等书面连接词和 AI 腔；不夸大功效、不做医疗或功效类承诺。

输出要求：只输出笔记正文，不要输出标题前的「标题：」等提示、不要开头寒暄、不要结尾总结词、不要 Markdown 代码块。`,
  },
  {
    category: '小红书',
    name: '小红书干货合集',
    description: '结构化清单 + 可收藏排版，适合教程、攻略、清单类内容。',
    promptTemplate: `你是一位擅长做「干货合集」的小红书博主。请围绕「{{主题}}」整理一篇收藏向的干货笔记。

要求：
1. 标题用「数字 + 结果导向」，例如「3 步搞懂 X」「5 个 Y 的避坑清单」。
2. 开头一句点明「谁适合看、看完能解决什么」，让读者立刻判断是否值得看。
3. 正文按 3~6 个要点分条列出，每条一句 emoji 小标题 + 2~3 句展开说明，信息具体可落地。
4. 结尾附一个「收藏提醒」和 3~5 个话题标签。
5. 语言轻松、条目清晰，方便截图收藏；不堆砌套话，避免「相信」「快速提升」「闭眼入」等空泛话术。

输出要求：只输出笔记正文，不要开头寒暄、不要结尾总结词、不要 Markdown 代码块。`,
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
5. 语言克制、有信息密度，避免空洞口号和车轱辘话；引用数据时标注为示例或说明来源，不编造具体数字。

输出要求：标题与正文一起输出，不要开头寒暄、不要结尾「希望本文对你有帮助」等套话、不要 Markdown 代码块。`,
  },
  {
    category: '公众号',
    name: '公众号观点评论',
    description: '就热点事件表达立场，结构紧凑、观点鲜明。',
    promptTemplate: `你是一位观点鲜明的公众号评论员。请就「{{话题}}」撰写一篇评论文章。

要求：
1. 标题直接亮明态度，不模棱两可。
2. 开头用一两句概述话题，然后立即抛出你的核心判断。
3. 主体围绕 2~3 个分论点展开，每个论点先结论后论证，必要时引用事实或常识逻辑。
4. 立场清晰但论述克制，不煽动、不人身攻击、不编造事实或数据。
5. 结尾给出建设性建议或呼吁。

输出要求：标题与正文一起输出，不要开头寒暄、不要 Markdown 代码块。`,
  },
  {
    category: '知乎',
    name: '知乎高赞回答',
    description: '先给结论再给依据，逻辑链完整，适合问答与经验分享。',
    promptTemplate: `你是一位知乎高赞答主。请回答「{{问题}}」。

要求：
1. 开头第一句直接给出结论或鲜明态度，抓住读者。
2. 接着用「先说结论 → 分层论证 → 补充细节 → 总结」的结构展开。
3. 论证中穿插具体例子或可操作建议，避免空谈；涉及专业内容时确保准确，不确定处如实说明。
4. 分点清晰，每点有小标题或序号。
5. 结尾简短总结，并欢迎评论区进一步交流。

输出要求：直接输出回答正文，不要以「回答：」开头、不要开头寒暄、不要 Markdown 代码块。`,
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
5. 脚本按「画面提示」与「口播词」两栏分段输出，画面提示简洁描述镜头，口播词口语化。

输出要求：直接输出脚本，不要开头寒暄、不要结尾总结、不要 Markdown 代码块。`,
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
5. 语言有感染力但不夸张，避免虚假承诺、绝对化用语（如「最好」「第一」）和虚假功效。

输出要求：直接输出文案，不要开头寒暄、不要结尾总结词、不要 Markdown 代码块。`,
  },
  {
    category: '漫画',
    name: 'Q 版情侣漫画',
    description: '把婚恋/情侣/家庭文案或参考图制作成小红书·公众号 Q 版情侣漫画，固定男女主、奶油粉暖棕手绘画风，支持文案拆页、双分镜排版、逐页出图并打包交付。',
    promptTemplate: `你是一位专门为中国公众号与小红书制作连续 Q 版漫画的视觉总监。请围绕「{{主题/文案}}」创作一套 Q 版情侣漫画分镜。

【固定人物（不可漂移，必须始终一致）】
- 女主 Girl A：年轻成人 Q 版，超长蓬松栗棕波浪卷发（头发偏画面左侧别粉色缎面蝴蝶结，不可消失）、超大暖棕眼睛、粉色腮红、金色矩形垂坠耳饰、小巧金色爱心项链；穿搭粉色吊带连衣裙/粉色内搭 + 奶油白宽松落肩针织开衫。
- 男主 Boy B：年轻成人 Q 版，蓬松栗棕短发（前额自然分束）、暖棕大眼、饱满温和脸颊、略粗眉毛；穿搭巧克力棕宽松针织开衫 + 奶油白高领/圆领针织衫。
- 两者都是 2.5–3.5 头身 Q 版，男生略高、女生头发更长；任何情况不得把主角换成青蛙/小鸡/其他情侣，不得随机换发型换衣服。

【画风与设计】
- 一句话：温暖奶油粉 × 巧克力暖棕 × 彩铅水彩手绘 × 软萌 Q 版 × 小红书故事漫画。
- 配色 token：背景奶油白 #FFF8F3、主粉 #F5B6BF、浅杏粉 #FBE4DF、深巧克力棕 #6A3C2C、栗棕发色 #89523D、珊瑚红 #E96F70、暖金黄 #F6C46A、浅绿 #B5C99F、强对比黑 #211713；整体避免赛博霓虹、冷紫、强蓝绿或写实摄影风。
- 页面：优先 3:4 竖版 1080×1440，上下各 1 格双分镜，圆角深棕边框；单页信息多可 1080×1350。

【分镜与拆页】
- 若用户给了原文/参考图，优先逐页保留原句、原顺序、原分镜结构，只替换人物与画风，不擅自改写。
- 若用户给了一段文案拆成新系列，默认 4–6 张：第 1 张强钩子（最抓眼的数字/矛盾/一句话 + 主角夸张反应）→ 第 2 张对话推进解释矛盾 → 第 3 张补充现实细节 → 第 4 张升级/反转 → 第 5 张（可选）认真解释底线与现实 → 第 6 张（可选）留一个自然的问题引导评论。

【文字原则】
- 首选生成「无字插画背景」+ 后期程序排版中文，每格顶部预留约 15% 高度的纯奶油白标题区，不放乱码/模糊假字。
- 若模型带字，只接受完全可读、与原稿逐字一致的结果；数字、金额、标点必须人工复核（例如 0.388 万 = 3880 元，不等于 38.8 万）。
- 不虚构真实采访、收入、医疗等事实；对敏感剧情可标注「虚构漫画情节」。

【交付】
- 一页一图：每页输出一张独立 PNG，不拼接九宫格后裁切；N 张输入对应 N 张输出。
- 同系列统一尺寸；最后把所有独立图片打包成 ZIP 交付。

请先输出逐页分镜方案（每页：序号、标题、上格场景、下格场景、出场人物、表情、关键道具、重点字、是否双分镜），供确认后再逐页出图。`,
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
4. 数据或例子用假设性示例即可，不编造真实数据；确需引用时标注来源或说明为示例。
5. 结尾总结全文，并给出可执行的下一步建议。

输出要求：直接输出正文，不要开头寒暄、不要结尾套话、不要 Markdown 代码块。`,
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
function getSeedVersion(db: Database.Database, key: string = SEED_VERSION_KEY): number {
  const row = db
    .prepare('SELECT value_json FROM app_settings WHERE key = ?')
    .get(key) as { value_json: string } | undefined
  if (!row) return 0
  try {
    const parsed = JSON.parse(row.value_json) as unknown
    return typeof parsed === 'number' ? parsed : 0
  } catch {
    return 0
  }
}

/** 记录已 seed 的内置内容版本号。 */
function setSeedVersion(db: Database.Database, version: number, key: string = SEED_VERSION_KEY): void {
  db.prepare(
    'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
  ).run(key, JSON.stringify(version), new Date().toISOString())
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

/**
 * 内置素材的远程资源清单。为减小 tarball 体积，这些大图不再打进插件包，
 * 改为首次 seed 时从远程按需下载到本地缓存（`remoteAssets.ts`），之后永久复用。
 * `urlPath` 为 GitHub 仓库内实际路径（含 src/host/ 前缀），`cachePath` 为本地缓存相对路径。
 */
const REMOTE_BUILTIN_ASSETS: Array<{ urlPath: string; cachePath: string; sha256: string }> = [
  // 模板封面
  { urlPath: 'src/host/assets/template-covers/longform_writing.png', cachePath: 'assets/template-covers/longform_writing.png', sha256: '9cfab43cdaf830098a097363739d33f19fe4ee52917535f415a527a3a879794f' },
  { urlPath: 'src/host/assets/template-covers/product_launch.png', cachePath: 'assets/template-covers/product_launch.png', sha256: 'e6c6bf62bbacba97aee8f2e22765271c7b79931056a95292028814f9574f9c06' },
  { urlPath: 'src/host/assets/template-covers/video_script.png', cachePath: 'assets/template-covers/video_script.png', sha256: '6b7da8911859be07eb8f03de6eeda88396621a5283b02a97fcf3de0d61b7dd14' },
  { urlPath: 'src/host/assets/template-covers/wechat_comment.png', cachePath: 'assets/template-covers/wechat_comment.png', sha256: '2d8f52579ddf8aae34425eb4804a048f9c5bfa906071591537f094dd857f22ea' },
  { urlPath: 'src/host/assets/template-covers/wechat_deep_read.png', cachePath: 'assets/template-covers/wechat_deep_read.png', sha256: '44c303536b1a64e4ed1fd64943113a9f4e7bf5b2dafbccad51c2bda3b54c92f4' },
  { urlPath: 'src/host/assets/template-covers/xhs_grass.jpg', cachePath: 'assets/template-covers/xhs_grass.jpg', sha256: '9ceabdf9c18c40c16a5c0380c7127d08153c92b1396e7d7f37a443e299d244cc' },
  { urlPath: 'src/host/assets/template-covers/xhs_tips.png', cachePath: 'assets/template-covers/xhs_tips.png', sha256: '43dac6ab682f6f41022b8009d4752d9bde521c9d04ca1830d60805c2b43ad0c6' },
  { urlPath: 'src/host/assets/template-covers/zhihu_answer.png', cachePath: 'assets/template-covers/zhihu_answer.png', sha256: '605d9574894b54706dec0629da3fa2f0a42b34f050bec1657003d21217f47a6b' },
  // 情侣漫画参考图
  { urlPath: 'src/host/assets/couple-comic/female_reference.png', cachePath: 'assets/couple-comic/female_reference.png', sha256: '30b76260edea9d439b53bd0e2d9fee5dd5ed792b2da38c1882959224191ae52e' },
  { urlPath: 'src/host/assets/couple-comic/male_reference.png', cachePath: 'assets/couple-comic/male_reference.png', sha256: 'c510cfcf2f2f5fc89f745278f08faa5d55ee78de34772fe7932b333ba713c903' },
  { urlPath: 'src/host/assets/couple-comic/two_panel_style_reference.png', cachePath: 'assets/couple-comic/two_panel_style_reference.png', sha256: 'ef4f80431c05a9e9ade444dcb1036b4d9aaf08cd1e356310d1e008f5f862b59f' },
]

/** 情侣漫画内置参考图（随插件包分发到 lib/assets/couple-comic/）。 */
const COUPLE_COMIC_REFERENCE_IMAGES = [
  { file: 'female_reference.png', name: '情侣漫画·女主参考图', tags: ['情侣漫画', '参考图', '女主', '内置'] },
  { file: 'male_reference.png', name: '情侣漫画·男主参考图', tags: ['情侣漫画', '参考图', '男主', '内置'] },
  { file: 'two_panel_style_reference.png', name: '情侣漫画·双分镜画风参考图', tags: ['情侣漫画', '参考图', '画风', '内置'] },
] as const

const COUPLE_COMIC_TEMPLATE_NAME = 'Q 版情侣漫画'

/**
 * 把情侣漫画的三张固定参考图写入素材库，并把「Q 版情侣漫画」模板的封面指向画风参考图。
 *
 * 幂等：以 app_settings 里的 `couple_comic_assets_version` 标记；参考图入库后版本号写回，
 * 重复启动不会重复插入。返回入库的素材数量。
 *
 * 注意：本函数需要 `AssetRepository`（依赖 StoragePaths 写磁盘），无法在
 * `seedBuiltinContent`（数据库 open 内部、尚无 paths）中调用；由 Host 在
 * `assets` 实例创建后单独调用一次。
 */

export function seedCoupleComicAssets(
  db: Database.Database,
  assets: AssetRepository,
  resourceDir?: string,
  dataRoot?: string,
): number {
  if (getSeedVersion(db, 'couple_comic_assets_version') >= 1) return 0

  // 编译产物里本模块位于 lib/index.js，资源被拷贝到 lib/assets/couple-comic/。
  // 因此相对 import.meta.url 直接取 ./assets/couple-comic。
  const base = resourceDir ?? join(dirname(fileURLToPath(import.meta.url)), 'assets', 'couple-comic')
  const cacheBase = dataRoot ? join(remoteAssetCacheRoot(dataRoot), 'assets', 'couple-comic') : null
  const templates = new TemplateRepository(db)
  let count = 0

  db.transaction(() => {
    for (const ref of COUPLE_COMIC_REFERENCE_IMAGES) {
      const filePath = resolveAssetFile(join(base, ref.file), cacheBase ? join(cacheBase, ref.file) : join(base, ref.file))
      if (!filePath) continue
      const data = readFileSync(filePath)
      const width = data.length > 24 ? data.readUInt32BE(16) : null
      const height = data.length > 24 ? data.readUInt32BE(20) : null
      const saved = assets.save({
        kind: 'image',
        name: ref.name,
        mimeType: 'image/png',
        data,
        width,
        height,
        tags: [...ref.tags],
      })
      // 用画风参考图作为模板封面
      if (ref.file === 'two_panel_style_reference.png') {
        const template = templates.list().find((t) => t.name === COUPLE_COMIC_TEMPLATE_NAME)
        if (template) templates.setCoverAssetId(template.id, saved.id)
      }
      count += 1
    }
    setSeedVersion(db, 1, 'couple_comic_assets_version')
  })()

  return count
}

/** 内置模板封面图（随插件包分发到 lib/assets/template-covers/）。 */
const TEMPLATE_COVER_IMAGES = [
  { file: 'xhs_grass.jpg', mimeType: 'image/jpeg', template: '小红书种草笔记', name: '模板封面·小红书种草笔记', tags: ['模板封面', '内置', '小红书种草笔记'] },
  { file: 'xhs_tips.png', mimeType: 'image/png', template: '小红书干货合集', name: '模板封面·小红书干货合集', tags: ['模板封面', '内置', '小红书干货合集'] },
  { file: 'wechat_deep_read.png', mimeType: 'image/png', template: '公众号深度推文', name: '模板封面·公众号深度推文', tags: ['模板封面', '内置', '公众号深度推文'] },
  { file: 'wechat_comment.png', mimeType: 'image/png', template: '公众号观点评论', name: '模板封面·公众号观点评论', tags: ['模板封面', '内置', '公众号观点评论'] },
  { file: 'zhihu_answer.png', mimeType: 'image/png', template: '知乎高赞回答', name: '模板封面·知乎高赞回答', tags: ['模板封面', '内置', '知乎高赞回答'] },
  { file: 'video_script.png', mimeType: 'image/png', template: '短视频口播脚本', name: '模板封面·短视频口播脚本', tags: ['模板封面', '内置', '短视频口播脚本'] },
  { file: 'product_launch.png', mimeType: 'image/png', template: '产品上新营销文案', name: '模板封面·产品上新营销文案', tags: ['模板封面', '内置', '产品上新营销文案'] },
  { file: 'longform_writing.png', mimeType: 'image/png', template: '通用长文写作框架', name: '模板封面·通用长文写作框架', tags: ['模板封面', '内置', '通用长文写作框架'] },
] as const

const TEMPLATE_COVER_VERSION_KEY = 'template_cover_version'

/**
 * 把内置模板的封面图写入素材库，并回填到对应模板的 `cover_asset_id`。
 *
 * 幂等：以 app_settings 里的 `template_cover_version` 标记；入库后版本号写回，
 * 重复启动不会重复插入。返回入库的封面数量。
 *
 * 与 `seedCoupleComicAssets` 一样，本函数需要 `AssetRepository`（写磁盘），
 * 由 Host 在 `assets` 实例创建后单独调用。
 */
export function seedTemplateCovers(
  db: Database.Database,
  assets: AssetRepository,
  resourceDir?: string,
  dataRoot?: string,
): number {
  if (getSeedVersion(db, TEMPLATE_COVER_VERSION_KEY) >= 1) return 0

  const base = resourceDir ?? join(dirname(fileURLToPath(import.meta.url)), 'assets', 'template-covers')
  const cacheBase = dataRoot ? join(remoteAssetCacheRoot(dataRoot), 'assets', 'template-covers') : null
  const templates = new TemplateRepository(db)
  let count = 0

  db.transaction(() => {
    for (const cover of TEMPLATE_COVER_IMAGES) {
      const filePath = resolveAssetFile(join(base, cover.file), cacheBase ? join(cacheBase, cover.file) : join(base, cover.file))
      if (!filePath) continue
      const data = readFileSync(filePath)
      const width = cover.mimeType === 'image/png' && data.length > 24 ? data.readUInt32BE(16) : null
      const height = cover.mimeType === 'image/png' && data.length > 24 ? data.readUInt32BE(20) : null
      const saved = assets.save({
        kind: 'image',
        name: cover.name,
        mimeType: cover.mimeType,
        data,
        width,
        height,
        tags: [...cover.tags],
      })
      const template = templates.list().find((t) => t.name === cover.template)
      if (template) templates.setCoverAssetId(template.id, saved.id)
      count += 1
    }
    setSeedVersion(db, 1, TEMPLATE_COVER_VERSION_KEY)
  })()

  return count
}

/**
 * 解析内置素材文件路径：优先用「插件包内」资源（开发态/旧版打包仍可用），
 * 若包内不存在则退回「远程下载缓存」目录。两者都不存在返回 null（调用方跳过）。
 */
function resolveAssetFile(pkgPath: string, cachePath: string): string | null {
  if (existsSync(pkgPath)) return pkgPath
  if (existsSync(cachePath)) return cachePath
  return null
}

/**
 * 后台下载所有缺失的内置素材资源到本地缓存，并在下载完成后重新执行 seed，
 * 把内置模板封面 / 情侣漫画参考图补写进素材库。
 *
 * 用于「瘦包」场景：资源不再打进 tarball，首次启动时本地包内无这些文件，
 * seed 会跳过；本函数异步拉取后再次 seed，让内置素材在下载完成后自动出现。
 * 失败静默（不影响其他功能，下次启动重试）。
 */
export async function downloadMissingBuiltinAssets(
  db: Database.Database,
  assets: AssetRepository,
  dataRoot: string,
): Promise<number> {
  const root = dataRoot
  let downloaded = 0

  for (const spec of REMOTE_BUILTIN_ASSETS) {
    // 已缓存则跳过下载
    if (remoteAssetIfCached(root, spec)) continue
    try {
      await ensureRemoteAsset(root, spec)
      downloaded += 1
    } catch {
      // 单个资源下载失败不阻断其余资源
    }
  }

  // 下载完成后重新 seed（幂等：若某类资源已因「包内存在」而 seed 过，版本号已写，不会重复）。
  if (downloaded > 0) {
    try {
      seedCoupleComicAssets(db, assets, undefined, root)
    } catch {
      // 忽略 seed 失败
    }
    try {
      seedTemplateCovers(db, assets, undefined, root)
    } catch {
      // 忽略 seed 失败
    }
  }

  return downloaded
}

