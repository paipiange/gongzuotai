# DeepSeek Harness 兼容性记录

记录日期：2026-11-15

## 当前核验

- npm `latest`：`@deepseek-ai/dsh@0.2.2-rc.1`。
- Cordis：`@deepseek-ai/cordis@4.1.0`。
- UI Slot 相关包：`@deepseek-ai/dsh-client-ui-slots@0.0.1-rc.1`、`@deepseek-ai/dsh-client-ui-sidebar@0.0.1-rc.1`。
- Node.js：项目要求 `>=20`；开发环境可执行 Node 与 pnpm。
- Client 入口按当前官方示例使用 `sidebar.panellist` 与 keyed `main` 注册。

## 已核验通过（静态契约 + 单测）

- **Client lazy-CJS loader 契约**：`lib/client.js` 由 banner/footer 包装为
  `window.__ModuleLoader__.load({ id, factory })` 副作用脚本；footer 直接
  `return { name, inject, apply }`，不触发 `__esModule`/`default` 的
  unwrapExports interop（侧边栏不显示的根因已修复）。产物为单一 chunk，
  无动态 `import(` 拆分；`@phosphor-icons/react` 内联，`react`/`react/jsx-runtime`
  走 Harness seed 模块表。
- **Slot 生命周期**：`ctx.slots.inject` 包裹 `ctx.slots.register`，disposer
  统一收集并在 `ctx.effect` 清理回调中 `reverse()` 逆序释放，符合 Cordis
  effect 生命周期。
- **Host `webServer` 服务**：`src/host/index.ts` 已从假设的
  `connection.fetch.register` 迁移到官方 `ctx.webServer.register({ kind: 'exact',
  path, handler(req, res) })`，`inject: ['webServer', 'connection']`。
  官方 handler 为 Node `IncomingMessage`/`ServerResponse`，通过
  `src/host/api/webServerAdapter.ts` 桥接为 Web `Request`/`Response`，
  单测覆盖 JSON、二进制与 64 MiB 体积上限。

## 仍需实机验证（需真实 Harness 运行实例）

- `lib/client.js` 在目标 Harness 安装实例上的实际加载与热重载行为。
- `ctx.connection.requestRejection(request)` 在目标 Host 版本的真实签名
  与认证流程（当前按官方文档形状接入，实机需确认）。
- tarball 安装、卸载、重启及 profile 组合行为。

在完成以上核验前，不开放任何私有 Host API 到公网，也不声明插件已通过
Harness 实机安装验收。

