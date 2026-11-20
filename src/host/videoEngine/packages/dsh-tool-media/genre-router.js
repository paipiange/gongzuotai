/**
 * Genre router — universal creation-category routing.
 *
 * NOT a template library. Each profile only describes the *visual language, pacing and voice casting*
 * that fits a category, and lists which free-coding techniques the AI coder may combine. The LLM is
 * always free to invent new visuals (genre `other` / custom) — profiles are guidance, never a cage.
 */

export const GENRE_PROFILES = [
  {
    id: 'code-animation',
    label: '代码动画 / Vibecoding 科技演示',
    detect: /代码|编程|vibe|算法|架构|开源|api|框架|前端|后端|AI 工具|大模型|agent|智能体|数据结构|程序员|终端|命令行|技术原理/i,
    visualLanguage: '深色或高对比科技底，Three.js 三维几何/粒子空间 + 动态 SVG 架构拓扑 + HUD 代码流/遥测面板；镜头做 3D 透视推拉。',
    techniques: ['FreeformThreeStage 自由 3D 造景', '动态 SVG 架构图/数据包沿路径流动', 'HUD 实时代码流与仪表盘', '节拍同步弹簧物理 spring/interpolate'],
    pacing: '3~6 秒/镜，信息密度高，关键词弹出',
    voice: '清亮、节奏明快、自信的科技解说男声/女声',
    style: 'tech',
  },
  {
    id: 'ui-tutorial',
    label: '软件实操教程 / 产品使用演示',
    detect: /教程|实操|使用说明|怎么用|如何使用|操作步骤|上手|入门|演示软件|功能介绍|界面|点击|工作台/i,
    visualLanguage: '亮色高对比真实界面截图（2x 高清）为主角：镜头推近到当前操作的按钮/抽屉，鼠标光标移动 + 点击波纹 + 面板滑出 + 输入逐字打出；步骤编号与要点标注。',
    techniques: ['UiWalkthrough 局部特写推拉运镜', '高拟真光标轨迹与点击涟漪', '抽屉/弹窗滑出过渡', '输入框逐字打字', '步骤角标与高亮框'],
    pacing: '每个操作一个镜头，先讲目的再演示，节奏清晰不拖沓',
    voice: '清亮亲切、抑扬顿挫、略带笑意的真人讲解音色，语速 1.05~1.12',
    style: 'tech',
  },
  {
    id: 'stickman-story',
    label: '火柴人 / 角色故事动画',
    detect: /火柴人|简笔画|角色|卡通|漫画|小人|故事动画|剧情|搞笑|段子|寓言|童话/i,
    visualLanguage: '干净的手绘/简笔画风：用 SVG 或 Canvas 绘制火柴人骨骼（关节层级 + 弹簧/IK 关键帧），场景用简笔背景、拟声字、对话气泡、速度线。',
    techniques: ['SVG/Canvas 骨骼关键帧动画', '关节层级 + spring 回弹', '对话气泡与拟声字', '场景推拉与速度线', '表情/道具切换'],
    pacing: '随剧情起伏，动作镜头短（1.5~3s），对白镜头 3~5s',
    voice: '生动有戏、情绪起伏明显的故事讲述音色，可按角色切换',
    style: 'warm',
  },
  {
    id: 'history-theater',
    label: '历史剧场 / 史诗卡点动画',
    detect: /历史|古代|朝代|战役|将军|帝王|楚汉|三国|汉|唐|宋|秦|霍去病|卫青|项羽|秦始皇|人物传|演义|文物|古风|武侠|冠军侯|封狼居胥/i,
    visualLanguage: '高燃逆光剪影动画 + 血金红黑史诗对比：每幕必须有动态动画人物主体（逆光铠甲英雄/披风帝王/冲锋铁骑战马/城墙大军与飘扬战旗），配合高燃斩击月牙刀光与冲击波环（SlashBurstOverlay）、红黑发光疆域攻占地图（StrategicMapStage）、立体竹简与朱砂印章（Bamboo Slips / CalligraphyColumnPanel）、火星烟尘与鼓点震屏；严禁退化成只有几条空山脉线条的静态宣纸 PPT！',
    techniques: ['HeroWarriorFigure 逆光披风人物与武器挥砍', '冲锋骑兵群/战车与飘扬战旗阵', 'SlashBurstOverlay 月牙斩击+冲击波环+竖向光柱', 'StrategicMapStage 红黑攻占路线地图+印章落锤', '立体竹简/功绩牌匾与纵排书法大字', '鼓点镜头震动+闪白/斜劈转场'],
    pacing: '纯音乐高燃卡点 34~52 镜（常规 2~4 拍约 1.5~3s，高潮突降点 0.5~1 拍连切）；配音解说则张弛有度',
    voice: '纯音乐卡点优先免 TTS；需解说时选用富有张力、史诗浑厚的中年男声',
    style: 'cinematic',
  },
  {
    id: 'talking-head',
    label: '真人口播 / 访谈包装',
    detect: /口播|真人出镜|出镜|主播|vlog|采访|访谈|自拍|讲课|知识分享|带货/i,
    visualLanguage: '真人画面为主，包装 B-Roll 画中画、关键词卡片、下三分之一字幕条、数据弹窗与动态强调字幕。',
    techniques: ['动态 B-Roll 画中画', '关键词弹出卡片', '下三分之一信息条', '重点字幕强调', '段落转场与章节标'],
    pacing: '口播为主线，每 6~10 秒一次视觉强调',
    voice: '使用真人原声；无真人时选自然亲切的主播音色',
    style: 'energetic',
  },
  {
    id: 'digital-human',
    label: '数字人口播 / 虚拟主播',
    detect: /数字人|虚拟主播|虚拟人|数字分身|ai 主播|克隆/i,
    visualLanguage: '数字人透明通道叠加在信息画面上，配合图文包装、数据面板、品牌色背景，口型与重音同步。',
    techniques: ['透明数字人叠层', '信息图表与卡片包装', '品牌色背景粒子', '重音动效'],
    pacing: '稳健解说 4~6s/镜',
    voice: '与数字人形象匹配的清晰克隆/主播音色',
    style: 'tech',
  },
  {
    id: 'product-promo',
    label: '产品宣发 / 发布会短片',
    detect: /产品|发布|宣传片|宣发|新品|品牌|上线|更新日志|release|对比|参数|卖点/i,
    visualLanguage: '设备/界面样机、卖点特写、指标计数器、对比滑动、品牌主色光效。',
    techniques: ['设备样机与界面特写', '指标数字滚动', '前后对比擦除', '品牌色光效与粒子', '3D 产品旋转'],
    pacing: '开场钩子 3 秒内，卖点 3~5s/镜，收尾号召',
    voice: '自信、有感染力的商业解说音色',
    style: 'energetic',
  },
  {
    id: 'science-explainer',
    label: '科普讲解 / 概念可视化',
    detect: /科普|原理|为什么|是什么|物理|化学|生物|天文|宇宙|数学|公式|实验|地理|医学/i,
    visualLanguage: '用图解说话：SVG 示意图逐步生长、3D 模型旋转拆解、公式推导动画、坐标系与曲线、类比小动画。',
    techniques: ['SVG 图解逐步生长', 'Three.js 3D 模型/分子/星球', '公式推导 KaTeX 式排版动画', '数据曲线与坐标系'],
    pacing: '一镜一概念，4~7s，先问题后结论',
    voice: '温和清晰、有启发感的讲解音色',
    style: 'documentary',
  },
  {
    id: 'data-story',
    label: '数据故事 / 信息图',
    detect: /数据|图表|统计|报告|趋势|排行|增长|财报|榜单|可视化/i,
    visualLanguage: '动态图表（柱/折线/环形/地图）逐帧生长，计数器与高亮注释，关键数字放大。',
    techniques: ['SVG 动态图表', '计数器滚动', '高亮注释与指向线', '地图/网络图'],
    pacing: '一镜一结论，4~6s',
    voice: '冷静可信的解说音色',
    style: 'documentary',
  },
  {
    id: 'brand-story',
    label: '品牌故事 / 情感短片',
    detect: /品牌故事|情感|温情|回忆|治愈|故事短片|致敬|纪念|公益/i,
    visualLanguage: '温暖留白，摄影/插画图片慢推镜，细腻文字排版与柔光，节奏舒缓。',
    techniques: ['图片 Ken Burns', '文字排版动画', '柔光与颗粒质感', '音乐驱动淡入淡出'],
    pacing: '4~7s/镜，从容留白',
    voice: '温柔、娓娓道来的叙事音色',
    style: 'warm',
  },
  {
    id: 'mv-lyric',
    label: '音乐卡点 / 歌词 MV',
    detect: /卡点|歌词|mv|混剪|节奏视频|踩点|律动|音乐视频/i,
    visualLanguage: '节拍驱动的动态字幕与粒子，鼓点瞬间切镜与冲击波。',
    techniques: ['节拍驱动 Kinetic Typography', '粒子冲击波', '0.5/1/2/4 拍切镜', '频谱可视化'],
    pacing: '随 BPM 半拍/一拍切镜',
    voice: '可无旁白，纯音乐',
    style: 'energetic',
  },
  {
    id: 'other',
    label: '自由创作（任意其他题材）',
    detect: /$^/,
    visualLanguage: '根据题材自行发明最贴切的视觉语言：自由组合 Three.js / SVG / Canvas / 图片 / 视频 / 文字排版，不套用任何固定版式。',
    techniques: ['FreeformThreeStage', '动态 SVG', 'Canvas 2D 绘制', '图片视频包装', '弹簧物理'],
    pacing: '依内容自行设计',
    voice: '依题材由 AI 从音色库选择最贴切的一款',
    style: 'cinematic',
  },
]

const OPEN_GENRE_PROFILE = GENRE_PROFILES[GENRE_PROFILES.length - 1]

export function getGenreProfile(id) {
  const key = String(id || '').trim()
  return GENRE_PROFILES.find((g) => g.id === key || g.label === key) || OPEN_GENRE_PROFILE
}

/**
 * Resolve normalized genre id + custom human-readable label (`genreLabel`) across any creative category.
 * Known profiles act only as starter routing hints; custom/unlisted genres always map cleanly to `'other'`
 * while preserving the exact AI-invented or user-specified `label` end-to-end.
 */
export function resolveGenreSelection({ genre = '', genreLabel = '', text = '', hasScreenshots = false } = {}) {
  const rawGenre = String(genre || '').trim()
  const rawLabel = String(genreLabel || '').trim()
  const isGenericOtherLabel = !rawLabel || rawLabel === OPEN_GENRE_PROFILE.label

  const matchBuiltin = (q) =>
    q && q.toLowerCase() !== 'auto' ? GENRE_PROFILES.find((g) => g.id === q || g.label === q) || null : null

  const byGenre = matchBuiltin(rawGenre)
  if (byGenre && byGenre.id !== 'other') {
    return {
      id: byGenre.id,
      label: isGenericOtherLabel ? byGenre.label : rawLabel,
      isCustom: false,
      profile: byGenre,
    }
  }

  if (rawGenre && rawGenre.toLowerCase() !== 'auto') {
    const byLabelFromGenre = rawGenre === 'other' ? matchBuiltin(rawLabel) : null
    if (byLabelFromGenre && byLabelFromGenre.id !== 'other') {
      return {
        id: byLabelFromGenre.id,
        label: rawLabel,
        isCustom: false,
        profile: byLabelFromGenre,
      }
    }
    const preservedLabel = !isGenericOtherLabel
      ? rawLabel
      : rawGenre !== 'other'
        ? rawGenre
        : OPEN_GENRE_PROFILE.label
    return {
      id: 'other',
      label: preservedLabel,
      isCustom: true,
      profile: OPEN_GENRE_PROFILE,
    }
  }

  if (rawLabel) {
    const byLabel = matchBuiltin(rawLabel)
    if (byLabel && byLabel.id !== 'other') {
      return {
        id: byLabel.id,
        label: rawLabel,
        isCustom: false,
        profile: byLabel,
      }
    }
    return {
      id: 'other',
      label: rawLabel,
      isCustom: true,
      profile: OPEN_GENRE_PROFILE,
    }
  }

  const detectedId = detectGenre(text, hasScreenshots)
  const detectedProfile = getGenreProfile(detectedId)
  return {
    id: detectedId,
    label: detectedProfile.label,
    isCustom: detectedId === 'other',
    profile: detectedProfile,
  }
}

/** Detect the most likely genre id from free text or options object; returns 'other' when nothing matches. */
export function detectGenre(textOrOpts = '', hasScreenshots = false) {
  let s = ''
  let hasMedia = Boolean(hasScreenshots)
  if (textOrOpts && typeof textOrOpts === 'object') {
    s = `${textOrOpts.topic || ''} ${textOrOpts.title || ''} ${textOrOpts.goal || ''} ${textOrOpts.style || ''}`.trim()
    hasMedia = Boolean(textOrOpts.hasMedia ?? textOrOpts.hasScreenshots ?? hasScreenshots)
  } else {
    s = String(textOrOpts || '')
  }
  let best = { id: 'other', score: 0 }
  for (const g of GENRE_PROFILES) {
    if (g.id === 'other') continue
    const m = s.match(new RegExp(g.detect.source, 'gi'))
    const score = m ? m.length : 0
    if (score > best.score) best = { id: g.id, score }
  }
  if (hasMedia && /教程|实操|使用|演示|操作步骤|界面|功能/.test(s)) {
    return 'ui-tutorial'
  }
  if (/使用教程|操作教程|全量教程|全功能教程|新手教程|怎么用|如何使用/.test(s)) {
    return 'ui-tutorial'
  }
  return best.id
}

/** Compact catalogue for prompts (starter reference only — the LLM is always free to invent any genre). */
export function listGenresForPrompt() {
  return GENRE_PROFILES.filter((g) => g.id !== 'other')
    .map((g) => `- ${g.id}（${g.label}）：${g.visualLanguage}｜配音：${g.voice}`)
    .join('\n')
}

/** Genre-specific direction block for director / coder prompts (preserves arbitrary custom `genreLabel`). */
export function buildGenreGuidance(idOrOpts, customLabel = '') {
  const opts =
    idOrOpts && typeof idOrOpts === 'object'
      ? { genre: idOrOpts.genre || idOrOpts.id || '', genreLabel: idOrOpts.genreLabel || customLabel || '' }
      : { genre: String(idOrOpts || ''), genreLabel: String(customLabel || '') }
  const { label, isCustom, profile: g } = resolveGenreSelection(opts)
  return [
    `【体裁定位：${label}${isCustom ? '（自定义开放体裁 · 100% 自由创作）' : '（常见题材参考起点 · 不设任何上限）'}】`,
    `视觉语言建议：${g.visualLanguage}`,
    `可自由组合或全新发明的写码技法：${g.techniques.join('、')}（仅作启发起点 —— 请严格围绕「${label}」自行发明专属视觉语法与 React / Three.js 3D / SVG / Canvas 舞台，严禁生搬硬套其它题材的固定版式或卡片模板）`,
    `节奏参考：${g.pacing}`,
    `配音取向：${g.voice}`,
  ].join('\n')
}
