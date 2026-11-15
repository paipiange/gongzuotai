# 拍片哥工作台（paipiange）

面向 DeepSeek Harness 的本地优先 AI 内容创作工作台。当前仓库已完成 UI 骨架和第一批本地内容闭环：原生插件入口、暖棕金国风整体布局、高保真首页、响应式导航、手动草稿、创作记录与待发布清单。

## 当前已实现

- Harness Host / Client 双端源码骨架与 `cordis.patch.yml`。
- 产品品牌统一为“拍片哥工作台”，内部标识统一为 `paipiange`。
- 参考图核心布局：内部侧栏、顶部工具条、Hero、灵感卡、分类筛选、快捷创作、精选模板与真实记录空态。
- AI 文章、图片、视频、标题、营销文案、小红书工作台界面。
- 素材、分析、发布、灵感、记录、设置页面。
- 页面导航、侧栏折叠、移动抽屉、搜索、灵感切换、Toast、表单校验反馈。
- 文章、标题、营销、小红书和图片工作台可保存用户手动输入的草稿；刷新后仍保留在当前浏览器。
- 首页最近创作、侧栏最近创作、记录搜索、继续编辑、归档、恢复与永久删除。
- 本地待发布清单和基于真实草稿状态的数据统计；不自动登录或发布到第三方平台。
- 手动草稿复制与 Markdown 导出；不会把固定样例冒充 AI 生成结果。
- Host 侧 SQLite v1 schema、跨平台私有数据目录、参数化创作仓库、版本快照、软删除/恢复与一致性备份。
- SQLite 使用真实临时数据库测试；视频类型在仓库层也会被拒绝，不会写入任务或创作记录。
- 视频页明确禁用真实生成；未配置模型时不伪造 AI 结果。
- 375px 至桌面宽度的响应式适配、键盘焦点与减少动画支持。

## 尚未实现

- Harness 实机安装、卸载与截图回归测试（见 [docs/harness-acceptance.md](./docs/harness-acceptance.md)）。
- Harness 文本模型调用和流式任务。
- 图片 Provider 的第三方云供应商（当前仅本机 ComfyUI 与可配置 OpenAI 兼容接口）。
- 富文本编辑器、完整备份与多平台自动发布。

## 本地开发

```bash
pnpm install
pnpm dev
```

本地预览页只用于 UI 开发，不替代 Harness 原生插件入口。

安装、升级与卸载见 [docs/install.md](./docs/install.md)。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

构建输出：

- `dist/`：本地 UI 预览产物，不发布为插件。
- `lib/index.js`：Host 模块。
- `lib/client.js`：Client 模块。

UI 验收同时覆盖 1280×774、390×844 和减少动画模式。开发预览中的草稿只写入浏览器 `localStorage`，不会进入仓库；正式数据仍需在验证 Harness 认证与运行时契约后迁移到 Host SQLite。

## 隐私与安全

请遵守 [AGENTS.md](./AGENTS.md)：不要提交密钥、个人信息、真实业务数据、数据库、上传素材、日志或本地敏感配置。模型凭证只能由后续 Host 适配层安全读取，不能进入浏览器代码或 Git 历史。

## 技术方案

完整范围与分阶段计划见 [拍片哥工作台技术方案](./拍片哥工作台-paipiange-DeepSeek-Harness-Plugin-技术方案.md)。
