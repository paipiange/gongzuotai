# 常见问题排查（Troubleshooting）

本文汇总拍片哥工作台在安装与使用中最常见的问题，按「现象 → 原因 → 解决」组织。若以下条目未覆盖你的问题，请到 [Issues](https://github.com/paipiange/gongzuotai/issues) 描述现象、环境（操作系统、dsh 版本）与复现步骤。

## 目录

1. [插件安装后不生效 / 侧栏没有「拍片哥工作台」](#1-插件不生效)
2. [数据接口报「本地服务未连接」/ 数据被清空](#2-本地服务未连接)
3. [路由报 `unauthorized`（纯文本 401）](#3-纯文本-401)
4. [路由报 `未授权`（JSON 401）](#4-json-401)
5. [better-sqlite3 报 `NODE_MODULE_VERSION mismatch`](#5-abi-不匹配)
6. [新路由报 HTML 错误（`Unexpected token '<'`）](#6-新路由报-html-错误)
7. [视频生成失败 / 出片为空](#7-视频生成失败)
8. [图片/文字模型调用报错](#8-模型调用报错)

---

<a id="1-插件不生效"></a>
## 1. 插件安装后不生效 / 侧栏没有「拍片哥工作台」

**现象**：安装后 dsh 界面没有任何变化，侧栏找不到工作台入口。

**原因**：
- 安装方式不对（直接复制 `node_modules` 而非用安装包 / `pnpm install` 该包）。
- dsh 没有重新解析依赖（新增依赖后光同步不够）。

**解决**：
1. 确认安装的是 `dsh-paipiange` 包（通过 `.tgz` 或 npm 安装），并已写入 profile 的依赖。
2. 若手动改了依赖，删除 dsh 侧 `pnpm-lock.yaml` 中该包的记录后重新 `pnpm install`。
3. 完全退出 dsh 再重新打开（注意：重启要走桌面快捷方式，直接双击 exe 可能静默退出）。

---

<a id="2-本地服务未连接"></a>
## 2. 数据接口报「本地服务未连接」/ 数据被清空

**现象**：界面顶部出现离线横幅，所有数据接口失效，或看起来数据被清空。

**原因**：绝大多数是插件 Host 启动失败（常见于 native 依赖 ABI 不匹配，见[第 5 节](#5-abi-不匹配)），导致所有 `/api/paipiange.*` 路由未注册。

**解决**：
1. 按[第 5 节](#5-abi-不匹配)修复 ABI。
2. 数据其实都在本机 SQLite 里（`~/.dsh/paipiange/paipiange.sqlite`），插件恢复后数据自动回来，并未丢失。

---

<a id="3-纯文本-401"></a>
## 3. 路由报 `unauthorized`（纯文本 401）

**现象**：`curl /api/paipiange.health` 返回纯文本 `unauthorized`。

**原因**：**插件没有加载成功**。请求落到了 Harness Connection 层的 `/api` 前缀路由，被统一鉴权拦截。

**解决**：
1. 优先排查 better-sqlite3 ABI（见[第 5 节](#5-abi-不匹配)）。
2. 查看 dsh 控制台日志，确认插件 `apply()` 是否抛异常。

---

<a id="4-json-401"></a>
## 4. 路由报 `未授权`（JSON 401）

**现象**：`curl /api/paipiange.health` 返回 `{"error":"未授权"}`（JSON）。

**原因**：**这是正常现象**。说明插件路由已成功注册，命中了你自己的 trust 鉴权检查；curl 未携带登录态 Cookie，所以被拒绝。

**解决**：无需处理。在 dsh 界面内正常操作即可（界面自带鉴权上下文）。

---

<a id="5-abi-不匹配"></a>
## 5. better-sqlite3 报 `NODE_MODULE_VERSION mismatch`

**现象**：启动时报 `Error: The module '...better_sqlite3.node' was compiled against a different Node.js version`，或 `new Database()` 抛 ABI 相关异常。

**原因**：`better-sqlite3` 是原生 addon，其 ABI 必须匹配 dsh 主程序**实际的 Electron 版本**，而不是你本机的 Node 版本，也不是 `~/.dsh/electron/electron.exe`（那是另一个 Electron 副本，版本可能不同）。

**解决**：
1. 查准 dsh 主程序的真实 ABI：
   ```bash
   ELECTRON_RUN_AS_NODE=1 "D:\software\dsh\DeepSeek Harness.exe" -e "console.log(process.versions.modules, process.versions.electron)"
   ```
2. 用 `scripts/deploy.sh` 一键重编译并部署（推荐，脚本会自动探测版本并处理）。
3. 手动重编译时，务必以 dsh 主程序 exe 的 Electron 版本为 `--target`，并同步 `.pnpm` 副本里的编译产物。

> ⚠️ 切勿在本机用普通 Node 跑 `pnpm install` / `npm rebuild` 触碰 dsh 侧的 `node_modules`，否则会把 native 依赖编译成错误 ABI。

---

<a id="6-新路由报-html-错误"></a>
## 6. 新路由报 HTML 错误（`Unexpected token '<'`）

**现象**：升级后新功能报 `Unexpected token '<', "<!doctype ..."`，前端拿到的是 HTML 而非 JSON。

**原因**：dsh 加载的是**旧版 `.pnpm` 副本**，新路由未注册，请求落到 webServer 的 SPA fallback 返回了 `index.html`。

**解决**：同步时同时覆盖**顶层**与 **`.pnpm` 副本**（dsh 实际加载位置是 `.pnpm/dsh-paipiange@*/node_modules/dsh-paipiange/`）。`scripts/sync.sh` 已处理两者。

---

<a id="7-视频生成失败"></a>
## 7. 视频生成失败 / 出片为空

**现象**：视频任务报错或产出空 MP4。

**原因 / 排查**：
- 未配置可用的视频后端（模型写动画需文字后端；ComfyUI 出帧需配置 ComfyUI 服务）。
- 无头浏览器 / FFmpeg 未就绪。
- Remotion 引擎的依赖未正确安装（`@remotion/*` 需在 dsh 侧重新解析依赖）。

**解决**：
1. 确认选对了生成引擎，并已配置对应后端。
2. 检查 `~/.dsh` 下视频工作区（`~/.dsh/video-workbench`）与 FFmpeg。
3. Remotion 相关：确认 dsh 侧已重装依赖（见[第 1 节](#1-插件不生效)的依赖重解析）。

---

<a id="8-模型调用报错"></a>
## 8. 图片/文字模型调用报错

**现象**：生成时报后端连接失败、401、超时等。

**原因**：后端 `baseUrl` / `apiKey` / `model` 配置有误，或服务不可达。

**解决**：
1. 在「设置中心 → 后端管理」用「测试连接」验证凭据与服务可达性。
2. 确认 `baseUrl` 去掉了末尾多余 `/`，`model` 名称与供应商一致。
3. 确认 API Key 已正确填入（设置页支持显示/隐藏切换核对）。

---

## 更多

- 安装与部署见 [install.md](./install.md)、[native-rebuild.md](./native-rebuild.md)。
- 架构与数据流见 [architecture.md](./architecture.md)。
- 隐私与提交规范见 [../AGENTS.md](../AGENTS.md)。
