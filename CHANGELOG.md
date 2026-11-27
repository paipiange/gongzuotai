# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.8] - 2026-11-27

### 变更

- **下线内置 AI 视频生成**：内置视频生成（模型写动画 / ComfyUI 出帧 / Remotion 双引擎）效果不达预期，点击「使用 Merziller 视频工具」时改为弹窗，引导用户使用原作者的开源项目 [dsh-video-workbench](https://github.com/Merziller/dsh-video-workbench)，并提供「打开」「复制链接」两个按钮。

## [0.3.7] - 2026-11-26

### 新增

- **AI 生图支持自定义图片尺寸**：「尺寸」下拉新增「自定义宽高」选项，可自由输入宽 × 高（256–4096 像素）生成非方形图片，如横版 1280×720、竖版 720×1280。填了自定义宽高时优先按宽高出图，否则回退方形预设（512/768/1024）。

## [0.3.6] - 2026-11-26

### 新增

- **「挡脸拍照」图片模板**：模板中心新增「挡脸拍照」模板，上传一张人物照片即可图生图生成「手机对镜自拍、用手机挡住脸」的照片，保留人物发型/服装/身形。为非漫画图片模板补上了参考图上传区（上传或 Ctrl+V 粘贴人物照片），未上传参考图时提示。

### 修复

- **追加内置模板时旧模板重复插入**：`seedBuiltinContent` 此前在递增 `BUILTIN_CONTENT_VERSION` 追加内置内容时会全量重插旧模板，导致模板中心出现重复项。现改为按 name/title 去重，追加新模板不再重复插入旧模板。
- **追加模板封面时新封面永不 seed**：`seedTemplateCovers` 原先用「版本号全量门控 + 素材库已有『模板封面』资产即跳过」的兜底，老用户升级后新增封面（如「挡脸拍照」封面）永远不会回填。现改为按模板名逐项判断 `cover_asset_id` 是否为空，老用户升级可补 seed 新封面而不重复旧封面。

## [0.3.5] - 2026-11-26

### 修复

- **「检查更新」误报「发现新版本」**：原版本比较用 `latest !== 当前版本` 的字符串不等判断，只要远程版本号与本地不同（含远程更低，如 CDN 缓存命中旧版）就误判为「有新版本」。现改为语义化版本号比较（`major.minor.patch`），仅当远程版本**严格高于**当前版本才提示升级。
- **更新源改为优先读 npm registry**：`dist-tags.latest` 是最权威、即时、无 CDN 缓存延迟的「已发布最新版本」，优于 `@main` 分支 package.json（可能被 jsDelivr CDN 缓存旧版）。npm registry 作主源，GitHub raw / jsDelivr package.json 作兜底。

## [0.3.4] - 2026-11-26

### 修复

- **「已安装插件」列表里 paipiange 描述为空**：dsh 的插件标题/描述并非读 `package.json` 的 `description`，而是读 `locale/*.json` 里的 `meta.title` / `meta.description`（`en.json` 为发现入口）。此前插件没有 locale 目录，导致列表无描述。现新增 `locale/en.json` + `locale/zh.json`，并在 `exports` 补 `"./locale/*.json"`、`files` 补 `locale`。（0.3.2 曾误判为 exports 缺 `./package.json`，实际根因是缺 locale 文件。）
- **模板封面图 / 情侣漫画参考图在新装机器上可能永久缺失**：`seedTemplateCovers` / `seedCoupleComicAssets` 在「瘦包首次启动、包内无图、远程缓存未下载」时会先 `setSeedVersion` 把幂等版本号写死，导致后续 `downloadMissingBuiltinAssets` 下载完成后重新 seed 时因版本号已写而永远跳过。现改为「只有实际入库 ≥1 张图才写版本号」，并升级版本 key（`*_v2`）+ 增加「素材库已有对应 tag 资产则跳过」的兜底，覆盖新装与已中招升级两种场景。

## [0.3.3] - 2026-11-26

### 修正

- **首页默认轮播图改用专属图**：0.3.2 误把「模板封面图」当作首页轮播图，现改为 5 张专属首页 banner（`src/host/assets/carousel/01~05_*.png`，2508×627 横版，人物右侧 + 左侧留白），托管在 GitHub 公开仓库经 jsDelivr 加速。首页轮播顺序变为「内置 base64 兜底图 → 5 张远程轮播图 → 用户自定义上传图」，加载失败自动跳过、首图永不缺失。
- **轮播图不再打进插件包**：`carousel` 目录加入 tsdown 的 copy 排除列表（与 couple-comic / template-covers 一致），5 张图走前端 jsDelivr 直接引用，保持瘦包。

## [0.3.2] - 2026-11-26

### 新增

- **首页默认多张远程轮播图**：托管在 GitHub 公开仓库（`paipiange/gongzuotai`），经 jsDelivr CDN 加速访问。首页轮播顺序变为「内置 base64 兜底图 → 远程轮播图 → 用户自定义上传图」，加载失败的远程图自动跳过、首图永不缺失。

### 修复

- **裸包名 `paipiange` 安装后「最左边 tab 不显示」**：tsdown 的 client banner 硬编码 `id: 'dsh-paipiange'`，裸包名发布时 client 模块 id 与 dsh 按包名对账的 id 不匹配，导致 client 模块无法物化。现改为动态读取 `package.json` 的 `name`，双包发布各自生成正确 id。
- **插件列表「没有描述」**：`package.json` 的 `exports` 缺 `"./package.json"`，导致 dsh 的 `readPluginMeta` 读取 description 时抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。已补上该导出。
- **CI 双包发布顺序**：`publish-dual.cjs` 切名步骤移到 build 之前，保证裸包名产物 name 正确；并重写 `--restore` 为 `git checkout`，修复原先字符串替换不可逆导致 name 累积成 `dsh-dsh-paipiange` 的污染。

## [0.2.6] - 2026-11-23

### 修复

- **正式发布 vendor 根治方案**：把 better-sqlite3 的纯 JS wrapper vendor 进插件、连同内置 Electron ABI 二进制一起分发、从 package.json 彻底移除 better-sqlite3 依赖（不在 dependencies、也不在 optionalDependencies）。此版本为根治「别的机器安装报 `node-gyp ... not ok`」的实际发布版；0.2.4 在 npm 上仍残留 optionalDependencies 旧方案，0.2.5 因发布事务被代理缓存干扰导致版本号占位，均不可用。

## [0.2.4] - 2026-11-23

### 修复

- 彻底根治「别的机器安装报 `node-gyp ... not ok`」：把 better-sqlite3 的**纯 JS wrapper**（lib/*.cjs，仅 52KB）vendor 进插件（`src/host/vendor/better-sqlite3/`），连同内置的 Electron ABI 二进制（`lib/native/{platform}-{arch}/better_sqlite3.node`）一起分发。运行时经 `nativeBinding` 用 vendor wrapper + 内置二进制建库，**从 package.json 中彻底移除 better-sqlite3 依赖**（不在 dependencies、也不在 optionalDependencies），安装期不再触发任何 native 编译或 prebuild 下载——无论 pnpm 还是 npm、无论是否缺 Python / C++ 工具链，安装都不会再失败。

### 已知坑：pnpm `minimumReleaseAge` 导致裸包名装到旧版

- **现象**：用户用裸包名 `paipiange` 或 `^0.2.0` 范围安装，装到的却是旧版（0.2.0），旧版 better-sqlite3 仍是强依赖，照样报编译错误——看起来「修复没生效」，实则是**根本没装到 0.2.4**。
- **根因**：pnpm 的 `minimumReleaseAge`（默认 1440 分钟 = 24 小时）会过滤「发布不足 24 小时」的版本。当天发布的版本全部被过滤，pnpm 静默回退到发布满 24 小时的最新版（本例是当天最早的 0.2.0）。这是 dsh 插件生态已知坑（deepseek-harness discussion #9178）。
- **解法**：安装命令**钉版本号**（`paipiange@0.2.4` / `dsh-paipiange@0.2.4`），或在 profile 的 `pnpm-workspace.yaml` 加 `minimumReleaseAgeExclude: [paipiange]` 豁免。README 与 docs/install.md 已同步说明。

## [0.2.3] - 2026-11-23

### 修复

- 安装期不再触发 better-sqlite3 源码编译：better-sqlite3 官方 prebuild 只覆盖标准 Node ABI，从不发布 Electron 版，而 dsh 桌面端是 Electron（ABI 149），导致用户机器 `npm install` 时 `prebuild-install` 找不到匹配二进制、fallback 到 `node-gyp` 源码编译，缺 C++ 工具链就报 `node-gyp ... not ok` 安装失败。现改为把针对 Electron ABI 149 编译好的 `.node` 直接打包进插件（`lib/native/{platform}-{arch}/`），运行时经 `nativeBinding` 显式加载（`src/host/storage/nativeBinding.ts`），彻底免除安装期编译。

### 测试

- 新增 nativeBinding 单测 4 个，全量测试增至 248 个。

## [0.2.2] - 2026-11-23

### 修复

- 远程资源下载超时从 30s 提高到 120s，避免慢网络下 2.5MB 封面图下载超时失败。
- 镜像优先级调整：jsDelivr（CDN 加速，实测快 3-4 倍）优先于 raw.githubusercontent，显著提升按需下载速度。

## [0.2.1] - 2026-11-23

### 优化

- 安装体积瘦身：内置模板封面、情侣漫画参考图（约 22.6MB）与视频渲染字体（约 9MB）不再打进 tarball，改为首次使用时从 GitHub 公开仓库按需下载到本地缓存（`src/host/storage/remoteAssets.ts`），支持多镜像 fallback 与 sha256 校验。tarball 体积从约 37MB 降至约 6.5MB（减少约 82%），显著缩短安装与下载时间。

### 测试

- 新增远程资源缓存单测 5 个，全量测试增至 244 个。

## [0.2.0] - 2026-11-20

### 新增

- 视频双引擎：整合 [dsh-video-workbench](https://github.com/Merziller/dsh-video-workbench)（MIT）的 Remotion + Three.js 本地渲染引擎（vendor 至 `src/host/videoEngine/`），支持一站式 `produceFullVideo` 出片，含字幕、音乐、数字人、TTS 多引擎。
- 持久化后台生成队列：图片、文字、本地视频与漫画批次先落库，支持跨页面/重启恢复、并发限制、优先级、暂停/继续/取消与自动重试。
- Harness 端到端回归：通过真实插件 `apply()` 路径验证信任鉴权、路由注册、SQLite、队列恢复和发布导出。
- 发布审计闭环：操作历史、微信 `media_id`、失败原因、重试次数、状态刷新、版本快照和发布前检查。
- 生成记录页新增排队/暂停状态、执行与重试计数、优先级调整和后台任务控制。

- 标签体系：创作与素材均支持自定义标签（migration v3），记录/素材卡展示标签，按标签筛选。
- 批量操作：创作记录多选批量归档/恢复/删除/加入待发布；素材多选批量删除。
- 发布看板：发布管理页按状态筛选，标记已发布时可回写外部链接（externalUrl + publishedAt）。
- 第三方云生图供应商：通义万相 / 智谱 CogView / 硅基流动 / 即梦·豆包一键预填（复用多后端框架）。
- 连接测试：图片后端与 ComfyUI 支持一键「测试连接」（`/api/paipiange.backend.test`）。
- 设置页增强：API Key 显示/隐藏切换；主题色切换（暖棕金/青玉绿/靛蓝夜/绯红霞）。
- 模板导入导出：模板包打包为 JSON 分享/导入（`/api/paipiange.templates.export` / `.import`）。
- 灵感 AI 推荐：基于历史创作风格调用文本模型推荐选题并落盘（`/api/paipiange.inspiration.suggest`）。
- 检查更新：设置页「立即检查」对比 GitHub Release 最新版本并提示升级。

### 测试

- 全量测试增至 211 个，覆盖存储迁移、生成队列并发/重试/恢复、真实 Harness 插件链路、微信草稿与发布审计。

## [0.1.0] - 2026-11-15

首个可分发版本。原生插件入口、双端架构、本地数据闭环与生图能力全部打通。

### 新增

- Harness Host / Client 双端骨架与 `cordis.patch.yml`，侧边栏「拍片哥工作台」入口。
- 暖棕金国风全页面 UI：文章 / 图片 / 视频（0.1.0 时为入口占位，0.2.0 起接入 Remotion 双引擎）/ 标题 / 营销 / 小红书 / 素材 / 分析 / 发布 / 灵感 / 记录 / 设置。
- Host 侧 SQLite 持久化（9 表迁移 + 封面列 v2），创作 CRUD / 搜索 / 软删除 / 恢复 / 版本快照 / 一致性备份。
- Host HTTP API（`/api/paipiange.*`），经官方 `webServer` 服务注册，`connection` 信任校验，Node↔Fetch 桥接层。
- 文本生成：文章/标题/营销/小红书接 Harness `ctx.llm`（`prepareCall` 异步 + `listProviders` 运行时发现），SSE 流式逐字渲染。
- 生图双后端：可配置 OpenAI 兼容接口 + 本机 ComfyUI（含 Qwen-Image-Edit 分离式模型实机验证 + img2img 参考图重绘）。
- handraw-style 风格库（370 视觉风格 + 170 排版图型 + 36 主题色），小红书 / 公众号排版置顶。
- 模板 / 灵感 / 发布清单读写，公众号 HTML / Markdown / ZIP 导出 + 小红书/知乎/头条平台适配文本导出，素材上传与落盘。
- 封面缩略图 + 一键设为封面（生图端到端关联）、Markdown 编辑器（工具栏 + 实时预览）、数据分析看板（工作室分布 / 发布漏斗 / 素材统计）、备份/下载快照。
- 草稿 800ms debounce 自动保存到 Host SQLite；离线模式全局横幅 + 数据合并防丢失。

### 修复

- 侧边栏不显示：client bundle footer 改为返回干净的 `{ name, inject, apply }`，规避 `__esModule`/`default` 的 unwrapExports interop。
- 动态 import 触发的 code splitting 导致 chunk 加载失败：改为静态导入，client 产物保持单一 chunk。
- SQLite 关闭前 `wal_checkpoint(TRUNCATE)`，避免 WAL 文件锁导致的 EBUSY。
- `ctx.llm.prepareCall` 实际为异步（此前误写同步）；硬编码 `deepseek-official` 在实机缺失（仅 pi-ai 自定义 route），改为运行时发现。
- 离线草稿在 Host 恢复后被丢弃的数据分裂问题：改为先 reconcile 回 Host 再清空本地。

### 测试

- 37 个单元测试：存储、生图（含 img2img）、发布打包契约、Node↔Fetch 桥接、文本生成、Markdown 渲染。
- GitHub Actions CI（Node 20/22 矩阵）+ Release 流水线（打 `v*` tag 自动出 tgz + GitHub Release）。
