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

## LLM 服务契约（实机核验，2026-11-15）

核验自 `@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-llm-pi-ai` 官方文档与实机
profile（`~/.dsh/profiles/desktop/cordis.patch.yml`）：

- 服务名为 `LlmService`，上下文键 `ctx.llm`。
- **消费入口**（插件生成文本用）：`ctx.llm.prepareCall(config, signal?)` 是
  **异步**，返回 `Promise<PreparedLlmCall>`，其 `.stream()` 产出
  `AsyncIterable<StreamChunk>`（text-delta / reasoning-delta / usage / finish / …）。
  另有 `ctx.llm.stream(options)` 直接流式。
- **Provider route 命名**：`llm-pi-ai` 的 `providers` 配置 dict 的 **key 即 route 名**
  （实机为 `aaa42w`、`huatu717333`）。调用时 `options.provider` 传该 key，
  `options.model` 传该 route catalog 里的模型 id。
- **发现接口**：`ctx.llm.listProviders(): LlmProviderInfo[]`（已注册 route）、
  `ctx.llm.listModels(provider): Promise<LlmModelInfo[]>`（某 route 通告的模型）。
- **关键教训**：不要硬编码 `provider: 'deepseek-official'` —— 该 route 只在
  安装了 `dsh-llm-deepseek` 且配置了账号时才存在。实机只有 `llm-pi-ai` 的
  自定义 route。插件已改为：生成时若默认 provider 不在 `listProviders()` 结果
  里，自动回退到第一个可用 route，避免 `UNKNOWN_MODEL`/未注册 route 报错。

## Native 依赖 ABI（实机核验，2026-11-15）

`dsh-paipiange` 依赖 `better-sqlite3`（原生 addon），其编译产物 `.node`
必须与目标 Harness 的 Electron 运行时 ABI 严格一致，否则启用时抛
`ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION mismatch`。

实机 Harness 桌面端为 **Electron 43.3.0**（内置 **Node v24.18.1**，
**NODE_MODULE_VERSION = 148**）。

- ABI 对应关系：Electron 40/41/42/43 → 143/145/146/148；Node 22 → 127；
  Node 24 标准 → 137；Node 25 → 149。
- **踩坑记录**：曾误将 ABI 149（Electron 44 / Node 25）编译产物同步到实机，
  导致 `Cannot find module 'bindings'` + `was compiled against a different
  Node.js version (149 vs required)` 双重报错。根因是手动 `cp` 同步时未针对
  Electron 43 重编译，且 `bindings`、`file-uri-to-path` 两个纯 JS 依赖被遗漏。
- **正确重建流程**（见 [docs/native-rebuild.md](./docs/native-rebuild.md)）：
  在本地项目用 `@electron/rebuild` 针对 Electron 43.3.0 重编译，再同步产物。

## 仍需实机验证（需真实 Harness GUI 桌面会话）

- `lib/client.js` 在 Harness GUI 上的实际加载、文本生成流式渲染与截图回归。
- `ctx.connection.requestRejection(request)` 在目标 Host 版本的真实签名
  与认证流程（当前按官方文档形状接入，实机需确认）。
- tarball 安装、卸载、重启及 profile 组合行为。

