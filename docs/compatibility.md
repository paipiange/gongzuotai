# DeepSeek Harness 兼容性记录

记录日期：2026-11-15

## 当前核验

- npm `latest`：`@deepseek-ai/dsh@0.2.2-rc.1`。
- Cordis：`@deepseek-ai/cordis@4.1.0`。
- UI Slot 相关包：`@deepseek-ai/dsh-client-ui-slots@0.0.1-rc.1`、`@deepseek-ai/dsh-client-ui-sidebar@0.0.1-rc.1`。
- Node.js：项目要求 `>=20`；开发环境可执行 Node 与 pnpm。
- Client 入口按当前官方示例使用 `sidebar.panellist` 与 keyed `main` 注册。

## 仍需实机验证

- `lib/client.js` 是否满足目标 Harness 安装实例的 lazy-CJS loader 契约。
- Slot 注册的清理时机和插件热重载行为。
- Host `connection`、`webServer`、LLM 服务的目标版本真实类型与认证流程。
- tarball 安装、卸载、重启及 profile 组合行为。

在完成以上核验前，不开放任何私有 Host API，也不声明插件已通过 Harness 实机安装验收。
