# 拍片哥工作台（paipiange）待办清单

> 状态约定：`- [x]` 已完成（提交并 push）；`- [ ]` 未完成。
> 原则：**每次完成部分功能就提交并 push**，保持小步可验证。
> 生图功能支持两种后端：① 可配置大模型（baseUrl / key / model）② 本机 ComfyUI（默认 `http://127.0.0.1:8188`，已启动）。

## 已完成

- [x] Phase 0：原生插件最小闭环（Host/Client 双端骨架、cordis.patch.yml、侧栏注册）
- [x] Phase 1：参考图首页高保真（仅 UI，不接模型）
- [x] Phase 2：全页面 UI 与状态闭环（文章/图片/视频占位/标题/营销/小红书/素材/分析/发布/灵感/记录/设置）
- [x] Phase 3（部分）：Host 侧 SQLite 持久化层（迁移 9 表、CreationRepository CRUD/搜索/软删/恢复/版本快照、备份、路径穿越防护、卸载关闭）
- [x] 安装全局 ponytail skill（`~/.workbuddy/skills/ponytail/`）
- [x] 建立本 todolist.md
- [x] **修复插件不显示在侧边栏**：client 端改为 `window.__ModuleLoader__.load({id, factory})` 副作用脚本格式（banner/footer 包装 + `var module/exports` shim）；`@phosphor-icons/react` 打进 bundle（不在 Harness seed 模块表，require 不到）；图标组件接收 owner `size`；slots 注册用 `ctx.effect` + disposer 收集（规范生命周期）

## 未完成

### A. SQLite 持久化收尾（Phase 3 剩余）

- [ ] 定义 Host 侧 HTTP API（认证后路由），把 CreationRepository 暴露给 Client
- [ ] Host 认证路由：安全校验会话，未认证不暴露数据（技术方案第 9 章）
- [ ] Client `workspaceStore` 从 localStorage 迁移到 Host SQLite（含离线降级/错误态）
- [ ] 统一 Host `type`（article/title）与 Client `studio`（article/headline）命名差异
- [ ] 草稿自动保存、上传素材落盘（media 目录）、模板/灵感池读写仓库
- [ ] 回收站与「永久删除」接真实 DB（当前 softDelete/restore/remove 已实现，待接线）

### B. Harness 文本模型对接（Phase 4）

- [ ] 检查 Harness LLM Service 真实类型与认证流程（docs/compatibility.md 待实机验证）
- [ ] 模型选择器 + PromptAssembler + 异步任务队列（tasks 表已建，待接）
- [ ] SSE 流式输出：文章/标题/营销/小红书生成
- [ ] 取消 / 重试 / token 统计（usage_records 表已建，待接）
- [ ] 错误处理与未配置模型时的明确降级提示（不伪造结果）

### C. 生图 Provider（Phase 5）—— 本次重点

- [x] 生图设置页：可配置「大模型」后端，字段 baseUrl / apiKey / model（ImageGenSettings 组件，localStorage 暂存）
- [x] 生图设置页：可配置「本机 ComfyUI」后端，字段 server 地址（默认 127.0.0.1:8188）+ 分离式模型（unet/clip/vae）或 checkpoint
- [x] 后端适配器抽象：统一的 text-to-image 接口，实现 OpenAI 兼容 / ComfyUI 两个 provider（ImageGenService 门面）
- [x] 大模型 provider：调用 OpenAI 兼容 images API（baseUrl + key + model）
- [x] ComfyUI provider：提交 workflow、轮询 /history、拉取结果图（/prompt /history /view）
- [x] ComfyUI provider 适配本机 Qwen-Image-Edit 分离式模型（UNETLoader+CLIPLoader+VAELoader，text encoder 用 qwen_2.5_vl_7b 3584 维，layers=0 单图），实机验证出图成功
- [x] 生图配置安全存储（SettingsRepository，API key 只存 Host 侧 app_settings，summary 不含 key）
- [ ] 结果图下载并落盘到 assets 表 + media 目录，回写 source_creation_id
- [ ] Client 端实际调用 Host 生图（端到端，依赖 Host↔Client 通信契约，待 Harness 实机验证）
- [ ] 无凭证/未连接时的「需配置」状态与错误提示（不虚构完成）

### D. 导出 / 品质 / 发布（Phase 6）

- [ ] 公众号 HTML / Markdown / ZIP 导出
- [ ] 本地待发布清单接入 publish_items 表
- [ ] 全面测试 + CI + 依赖打包
- [ ] 实机 Harness 安装 / 卸载 / 截图回归测试（docs/compatibility.md 遗留项）
- [ ] 最终 tgz 安装包 + 安装文档 + Release

## 备注

- 关键环境：本机 better-sqlite3 等原生依赖需走 FlClash 代理 `http://127.0.0.1:7890`（见 `.workbuddy/memory/2026-11-15.md`）。
- 视频生成：永久占位，不接模型、不建真实任务（AGENTS.md 强制）。
