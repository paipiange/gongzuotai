# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

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

- 测试从 40 增至 46：新增创作/素材标签过滤、素材标签更新、灵感建议解析等覆盖。

## [0.1.0] - 2026-11-15

首个可分发版本。原生插件入口、双端架构、本地数据闭环与生图能力全部打通。

### 新增

- Harness Host / Client 双端骨架与 `cordis.patch.yml`，侧边栏「拍片哥工作台」入口。
- 暖棕金国风全页面 UI：文章 / 图片 / 视频（占位）/ 标题 / 营销 / 小红书 / 素材 / 分析 / 发布 / 灵感 / 记录 / 设置。
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
