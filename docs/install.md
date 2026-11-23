# 安装与分发

拍片哥工作台（`dsh-paipiange`）以 DeepSeek Harness 原生插件形式分发。发布产物是一个 npm tarball（`.tgz`），内含 Host 模块、Client 模块与 `cordis.patch.yml`，不含源码、本地预览产物或任何用户数据。

## 前置条件

- DeepSeek Harness：`@deepseek-ai/dsh@>=0.2.2-rc.1`
- Node.js：`>=20`
- 包管理器：`pnpm`（推荐）或 `npm`

## 构建发布包

```bash
pnpm install
pnpm build          # typecheck + 预览构建 + 插件构建
pnpm test           # 全部单元测试（应全绿）
pnpm pack           # 生成 dsh-paipiange-0.2.0.tgz
```

`prepack` 会自动重跑 `build:plugin`，保证 tarball 内的 `lib/` 是最新产物。
`prepublishOnly` 会在发布前执行 typecheck + 全量测试 + 构建三重校验。

## 安装

### 方式一：从 npm 安装（推荐）

发布到 npm 后可直接按包名安装，**务必钉版本号**：

```bash
pnpm add dsh-paipiange@0.2.4
```

> ⚠️ **为什么要钉版本号（`@0.2.4`）而不是裸包名或 `^0.2.0`？**
>
> pnpm 的 `minimumReleaseAge`（默认 1440 分钟 = 24 小时）会过滤「发布不足 24 小时」的
> 版本：裸包名 / `^0.2.0` 范围会**静默回退**到发布满 24 小时的最新版。对于当天刚发的
> 版本，回退到的是更早的旧版——而旧版的 `better-sqlite3` 仍是强依赖，会在缺
> Python / C++ 工具链的机器上触发 `node-gyp` 源码编译失败（`gyp ERR! find Python`）。
>
> 钉版本号 `@0.2.4` 会绕过 minimumReleaseAge 过滤，直接拿到修复后的版本
> （`better-sqlite3` 已移到 `optionalDependencies` + 内置 Electron ABI 二进制）。
>
> 参考：这是 dsh 插件生态的已知坑，见
> [deepseek-harness discussion #9178](https://github.com/deepseek-ai/deepseek-harness/discussions/9178)。

### 方式二：从本地 tarball 安装

```bash
# 1. 安装到 Harness 的插件依赖
pnpm add ./dsh-paipiange-0.2.4.tgz

# 2. 在 Harness 的 profile 中声明 bundle（patch 注入）
#    cordis.patch.yml 已声明：
#      - insert:
#          - id: paipiange
#            name: dsh-paipiange
```

> ✅ 插件依赖 `better-sqlite3`（原生 addon）。为彻底免除安装期 node-gyp 源码编译
> （需本机 C++ 工具链，常导致「别的机器安装报 `node-gyp ... not ok`」），插件做了两层处理：
>
> 1. **`better-sqlite3` 声明为 `optionalDependencies`**——即使某台机器编译/下载失败，
>    也不会让整个 `pnpm add` 安装失败（只是降级为 warning）。
> 2. **内置针对 dsh 桌面端 Electron ABI 预编译的二进制**（`lib/native/{platform}-{arch}/`），
>    运行时经 `nativeBinding` 直接加载，完全不依赖依赖树里那份 `better-sqlite3`。
>
> 当前内置 `win32-x64` 与 `darwin-arm64`（dsh 官方桌面版支持的两个平台）。
> 若你的平台未内置（或 dsh Electron 升级导致 ABI 变化），可参考
> [docs/native-rebuild.md](./docs/native-rebuild.md) 手动重编译。

安装后重启 Harness，侧边栏应出现「拍片哥工作台」入口。

## 升级

1. 停用 / 卸载旧版本插件。
2. 用新 tarball 覆盖安装（`pnpm add` 新路径）。
3. 重启 Harness，确认版本号与功能生效。

数据目录不变（默认 `~/.dsh/paipiange/`），升级不会丢失草稿、素材或发布清单。

## 卸载

1. 从 Harness 侧栏移除插件入口（profile 中删除 `paipiange` 条目）。
2. 从依赖中移除 `dsh-paipiange`。
3. 如需清空本地数据，删除数据目录 `~/.dsh/paipiange/`（含 SQLite、素材与导出文件）。**此操作不可逆，请先备份。**

## 安全说明

- Host 仅在官方 `webServer` 服务上注册 `/api/paipiange.*` 私有路由，并接受 `ctx.connection.requestRejection` 信任校验；不会对公网开放。
- 模型 API key 只存 Host 侧 `app_settings`，响应 summary 永不回传 key。
- 详细验收与兼容性记录见 [docs/compatibility.md](./docs/compatibility.md) 与 [docs/harness-acceptance.md](./docs/harness-acceptance.md)。
