# 拍片哥工作台（paipiange）待办清单

> 状态约定：`- [x]` 已完成（提交并 push）；`- [ ]` 未完成。
> 原则：**每次完成部分功能就提交并 push**，保持小步可验证。
> 生图功能支持两种后端：① 可配置大模型（baseUrl / key / model）② 本机 ComfyUI（默认 `http://127.0.0.1:8188`，已启动）。

## 已完成

- [x] Phase 0：原生插件最小闭环（Host/Client 双端骨架、cordis.patch.yml、侧栏注册）
- [x] Phase 1：参考图首页高保真（仅 UI，不接模型）
- [x] Phase 2：全页面 UI 与状态闭环（文章/图片/视频占位/标题/营销/小红书/素材/分析/发布/灵感/记录/设置）
- [x] Phase 3（部分）：Host 侧 SQLite 持久化层（迁移 9 表、CreationRepository CRUD/搜索/软删/恢复/版本快照、备份、路径穿越防护、卸载关闭）
- [x] 视频生成：接入本地渲染链路（LLM 写 HTML 动画 → 无头浏览器逐帧截图 → FFmpeg 合成，含沙箱校验 + 3 轮修复 + 内置模板降级），视频工作台页面真正出片（`src/host/videogen/`）
- [x] 视频生成接入本机/远程 ComfyUI：复用 Qwen-Image-Edit 图片模型 `layers` 多帧出序列 → FFmpeg 合成（`comfyVideo.ts` + 前端「生成引擎」选择），支持 llm/comfyui 双引擎
- [x] 安装全局 ponytail skill（`~/.workbuddy/skills/ponytail/`）
- [x] 建立本 todolist.md
- [x] **修复插件不显示在侧边栏**：client 端改为 `window.__ModuleLoader__.load({id, factory})` 副作用脚本格式（banner/footer 包装 + `var module/exports` shim）；`@phosphor-icons/react` 打进 bundle（不在 Harness seed 模块表，require 不到）；图标组件接收 owner `size`；slots 注册用 `ctx.effect` + disposer 收集（规范生命周期）

## 未完成

### A. SQLite 持久化收尾（Phase 3 剩余）

- [x] 定义 Host 侧 HTTP API（连接服务路由），把 CreationRepository 暴露给 Client（`src/host/api/routes.ts`，7 条精确 fetch 路由）
- [x] Client `workspaceStore` 从 localStorage 迁移到 Host SQLite（含离线降级/错误态，`hostClient.ts` + `loadCreations` 异步化）
- [x] 统一 Host `type`（article/title）与 Client `studio`（article/headline）命名差异（`STUDIO_TO_TYPE`/`TYPE_TO_STUDIO` 映射）
- [x] 生图配置持久化到 Host `app_settings`（`imagegenStore` 迁移 Host 优先 + localStorage 降级）
- [x] 生图结果落盘 media 目录 + 回写 assets 表（`AssetRepository` + `/api/paipiange.imagegen.generate` 落盘）
- [x] 草稿自动保存（debounce 800ms 静默保存）、上传素材落盘（`/api/paipiange.asset.upload` + 素材库接 Host）、模板/灵感池读写仓库（TemplateRepository/InspirationRepository + 路由）
- [x] 回收站与「永久删除」接真实 DB（`CreationRepository.remove()` 硬删除 + `/api/paipiange.creation.purge` 路由；softDelete/restore 已接线）

### C. 生图 Provider（Phase 5）—— 本次重点

- [x] 生图设置页：可配置「大模型」后端，字段 baseUrl / apiKey / model（ImageGenSettings 组件，localStorage 暂存）
- [x] 生图设置页：可配置「本机 ComfyUI」后端，字段 server 地址（默认 127.0.0.1:8188）+ 分离式模型（unet/clip/vae）或 checkpoint
- [x] 后端适配器抽象：统一的 text-to-image 接口，实现 OpenAI 兼容 / ComfyUI 两个 provider（ImageGenService 门面）
- [x] 大模型 provider：调用 OpenAI 兼容 images API（baseUrl + key + model）
- [x] ComfyUI provider：提交 workflow、轮询 /history、拉取结果图（/prompt /history /view）
- [x] ComfyUI provider 适配本机 Qwen-Image-Edit 分离式模型（UNETLoader+CLIPLoader+VAELoader，text encoder 用 qwen_2.5_vl_7b 3584 维，layers=0 单图），实机验证出图成功
- [x] 生图配置安全存储（SettingsRepository，API key 只存 Host 侧 app_settings，summary 不含 key）
- [x] 结果图下载并落盘到 assets 表 + media 目录，回写 source_creation_id
- [x] Client 端 Host 生图 API 封装（`hostClient.generateImages`，端到端契约已接通，待 Harness 实机验证）
- [x] 无凭证/未连接时的「需配置」状态与错误提示（HostError + localStorage 降级，不虚构完成）
- [x] 生图风格选择：接入 handraw-style 风格库（370 视觉风格 + 170 排版图型 + 36 主题色），小红书社媒卡 / 公众号信息图排版置顶；图片工作台加完整生图表单（prompt + 风格/排版/主题色 + 尺寸/数量 + 后端选择 + 结果展示下载）

### D. 导出 / 品质 / 发布（Phase 6）

- [x] 公众号 HTML / Markdown / ZIP 导出（`ExportService` + `/api/paipiange.export` 路由 + client 导出按钮走 Host）
- [x] 本地待发布清单接入 publish_items 表（`PublishRepository` + `/api/paipiange.publish` 路由 + 发布管理页接 Host，creation 标记 queued 时自动 upsert）
- [x] 全面测试 + CI + 依赖打包（25 项单测；`.github/workflows/ci.yml` Node 20/22 矩阵；`prepack`/`prepublishOnly` 发布校验）
- [x] Host API 迁移到官方 `webServer` 服务 + `connection` 信任校验（`webServerAdapter` Node↔Fetch 桥接）；实机验收清单见 `docs/harness-acceptance.md`（截图回归仍需真实 Harness GUI）
- [x] 最终 tgz 安装包（`dsh-paipiange-0.1.0.tgz`）+ 安装文档（`docs/install.md`）+ CHANGELOG + Release 0.1.0 说明（`docs/release-0.1.0.md`）

### E. 新 TOP10（产品可用性 / 打磨 / 分发）

- [x] 文本模型接入：文章/标题/营销/小红书接 Harness `ctx.llm`（`prepareCall` 异步 + `listProviders` 运行时发现），SSE 流式逐字渲染；设置页 provider/model 下拉
- [x] 生图端到端链路：生图结果落盘关联草稿（`sourceCreationId`）+ 一键设为封面（`creation.cover` 路由 + creations 表 `cover_asset_id` v2 迁移）+ 创作卡封面缩略图
- [x] 图片重绘/编辑：ComfyUI img2img（`LoadImage`→`VAEEncode`→`KSampler(denoise)`），参考图上传 + 重绘强度滑杆
- [x] 待发布多平台导出：小红书（标题 20 字 + 话题）/ 知乎 / 头条 / 公众号平台适配纯文本（`exportForPlatform` + `buildPlatformText`）
- [x] 数据分析页接真实数据：工作室分布 / 发布漏斗 / 素材统计（`AnalyticsPage`）
- [x] 错误与降级体验统一：全局离线横幅 + 重试连接；修复离线草稿在 Host 恢复后被丢弃的数据分裂 bug（`reconcileIntoHost`）
- [x] 富文本编辑器：Markdown 工具栏 + 实时预览（`markdown.ts` 内联渲染器 + `MarkdownEditor`）
- [x] 数据备份与恢复 UI：创建 / 列表 / 下载 SQLite 快照（`BackupSettings` + 3 条备份路由）
- [x] 自动化发布流水线：`.github/workflows/release.yml`（打 v* tag 自动出 tgz + GitHub Release）+ `pnpm release` 一键打包
- [ ] 实机 Harness GUI 截图回归（侧栏入口 / 文本流式渲染 / 生图落盘 / 草稿持久化 / 卸载清理）—— 仍需真实 Harness 桌面会话，见 `docs/harness-acceptance.md`

## 备注

- 关键环境：本机 better-sqlite3 等原生依赖需走 FlClash 代理 `http://127.0.0.1:7890`（见 `.workbuddy/memory/2026-11-15.md`）。
- 视频生成：本地渲染（LLM 写 HTML + 逐帧截图 + FFmpeg，或 ComfyUI 出帧序列 + FFmpeg），不调付费视频供应商、不建外部任务；ComfyUI 视频路径的「真实模型多帧输出」仍需实机验证（当前已用 mock 验证连通协议与合成链路）。
- 实机 provider route：本机 Harness 只有 `llm-pi-ai` 的 `huatu717333`/`aaa42w`，无 `deepseek-official`；文本生成 provider 须运行时 `listProviders()` 发现。
- push 依赖 FlClash 代理，代理 502 时本地 commit 已保存、待网络恢复补推。
