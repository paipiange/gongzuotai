# 拍片哥工作台（paipiange）

面向 DeepSeek Harness 的本地优先 AI 内容创作工作台。当前仓库已完成第一阶段 UI 骨架：原生插件入口、暖棕金国风整体布局、高保真首页、响应式导航、创作工作台占位及全部一级页面的可交互空态。

## 当前已实现

- Harness Host / Client 双端源码骨架与 `cordis.patch.yml`。
- 产品品牌统一为“拍片哥工作台”，内部标识统一为 `paipiange`。
- 参考图核心布局：内部侧栏、顶部工具条、Hero、灵感卡、分类筛选、快捷创作、精选模板与真实记录空态。
- AI 文章、图片、视频、标题、营销文案、小红书工作台界面。
- 素材、分析、发布、灵感、记录、设置页面。
- 页面导航、侧栏折叠、移动抽屉、搜索、灵感切换、Toast、表单校验反馈。
- 视频页明确禁用真实生成；未配置模型时不伪造 AI 结果。
- 375px 至桌面宽度的响应式适配、键盘焦点与减少动画支持。

## 尚未实现

- Harness Host 认证路由、SQLite 与本地文件持久化。
- Harness 文本模型调用和流式任务。
- 图片 Provider、编辑器、导出和真实发布队列。
- Harness 实机安装、卸载与截图回归测试。

## 本地开发

```bash
pnpm install
pnpm dev
```

本地预览页只用于 UI 开发，不替代 Harness 原生插件入口。

## 验证

```bash
pnpm typecheck
pnpm build
```

构建输出：

- `dist/`：本地 UI 预览产物，不发布为插件。
- `lib/index.js`：Host 模块。
- `lib/client.js`：Client 模块。

## 隐私与安全

请遵守 [AGENTS.md](./AGENTS.md)：不要提交密钥、个人信息、真实业务数据、数据库、上传素材、日志或本地敏感配置。模型凭证只能由后续 Host 适配层安全读取，不能进入浏览器代码或 Git 历史。

## 技术方案

完整范围与分阶段计划见 [拍片哥工作台技术方案](./拍片哥工作台-paipiange-DeepSeek-Harness-Plugin-技术方案.md)。
