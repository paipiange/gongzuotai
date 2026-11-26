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

## 发布到 npm（OIDC trusted publishing）

`dsh-paipiange` 与 `paipiange` 是两份独立 npm 包，代码完全相同，仅 name 不同，需各自发布。

发布走 **GitHub Actions OIDC trusted publishing**（免长期 token，规避「绕过 2FA 的 token 无法
direct publish」的 npm 政策限制）。

### 一次性配置（npm 网页端，两个包各做一次）

对 `dsh-paipiange` 和 `paipiange` 分别操作：

1. 打开包的 **Settings → Trusted Publishing**，点 **Add trusted publisher**，选 **GitHub Actions**。
2. 填写：
   - Organization/user：`paipiange`
   - Repository：`gongzuotai`
   - Workflow filename：`publish-npm.yml`（只填文件名，带 `.yml`）
3. **Allowed actions 勾选「Allow npm publish」**（否则只允许 staged publish，版本不会自动落地）。
4. 保存。

### 触发发布

```bash
git tag v0.2.8 && git push origin v0.2.8
```

推送 `v*` 标签后，`.github/workflows/publish-npm.yml` 自动：
typecheck + build → 用 `scripts/publish-dual.cjs` 切换包名 → `npm publish --provenance --access public`
发布双包。发布前需确保 `package.json` 的 `version` 已 bump 到目标版本。

> 注意：trusted publishing 要求 npm CLI ≥ 11.5.1、Node ≥ 22.14.0，workflow 已固定 Node 22。

## 安装

### 方式一：dsh 插件命令（推荐，新机器首选）

在已装好 DeepSeek Harness 的机器上，用 dsh 的插件安装命令，**务必钉版本号**：

```bash
dsh plugin add dsh-paipiange@0.3.7
```

### 方式二：dsh 插件市场界面

打开 Harness 的插件市场（Plugin Market / dshmarket），搜索 `dsh-paipiange`（或「拍片哥」），
点击安装。**务必搜 `dsh-paipiange`，不要搜裸名 `paipiange`**（裸名包 client bundle 的 id 与
包名错配，会导致侧边栏 tab 不显示、插件无描述）。若市场里版本滞后，请改用方式一钉版本。

### 方式三：手动改 profile 的 package.json（兜底，100% 有效）

在 Harness profile（默认 `~/.dsh/profiles/desktop/package.json`）里声明依赖与 bundle：

```json
{
  "dependencies": {
    "dsh-paipiange": "0.3.7"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-paipiange"]
    }
  }
}
```

保存后重启 Harness（或触发其自动安装）。

> ### ⚠️ 四个必踩的坑，务必规避
>
> **坑 1：一定要钉版本号 `@0.3.7`，不要裸包名或 `^0.2.0`。**
>
> pnpm 的 `minimumReleaseAge`（默认 1440 分钟 = 24 小时）会过滤「发布不足 24 小时」的
> 版本：裸包名 / `^0.2.0` 范围会**静默回退**到发布满 24 小时的最新版。对于当天刚发的
> 版本，回退到的是更早的旧版——0.2.0~0.2.3 的 `better-sqlite3` 是**强依赖**，0.2.4 是
> `optionalDependencies`，都会在缺 Python / C++ 工具链的机器上触发 `node-gyp` 源码编译
> 失败（`gyp ERR! find Python`）。**只有 0.2.6+ 彻底移除了 better-sqlite3 依赖**
> （vendor 纯 JS wrapper + 内置 Electron ABI 二进制），安装期零编译。
>
> **坑 2：走 npm registry 安装，绝不用本地 `file:` tarball（尤其路径含中文）。**
>
> 用 `"dsh-paipiange": "file:D:/某路径/工作台/xxx.tgz"` 这类本地文件引用安装时，pnpm
> 会把 `file:` 路径 URL 编码进符号链接目录名（含中文「工作台」和 `+` 号），dsh 主程序
> 动态 import 插件时无法解析该符号链接，报
> `ERR_MODULE_NOT_FOUND: Cannot find package 'dsh-paipiange'`，插件「只有名字、没有
> 描述」，功能失效。**必须用 npm 版本号 `"dsh-paipiange": "0.3.7"`（走 registry，符号
> 链接为纯 ASCII 路径）。**
>
> **坑 3：市场搜索务必用 `dsh-paipiange`，不要搜裸名 `paipiange`。**
>
> npm 上 `dsh-paipiange` 与 `paipiange` 是两份独立包、代码相同，仅 name 不同。但双包发布
> 时裸名 `paipiange` 的 client bundle 里 `__ModuleLoader__.load` 的 id 仍烧着 `dsh-paipiange`
> （历史构建 bug），与 dsh 按 entry 名「paipiange」对账时 id 错配，导致 client 模块无法
> 物化——**侧边栏不显示入口、插件详情页无描述**。请优先安装 `dsh-paipiange`（id 与包名
> 一致，正常显示）。
>
> **坑 4：旧版本已 deprecate，但 deprecate 挡不住 minimumReleaseAge 门控。**
>
> npm 上 0.2.0~0.2.5 已全部标记 deprecated（broken），0.3.7 是唯一推荐版本。但 pnpm 的
> 时间门控优先级高于 deprecated 标记，所以即便旧版已 deprecate，裸包名/范围仍可能回退
> 到旧版——**还是得钉 `@0.3.7`**。
>
> **若希望裸包名也能始终装到最新版**（一劳永逸），可在 Harness profile 的
> `pnpm-workspace.yaml` 中关闭发布年龄门控：
>
> ```yaml
> minimumReleaseAge: 0            # 永久关闭门控，裸包名/范围都能追到 latest
> ```
>
> 参考：这是 dsh 插件生态的已知坑，见
> [deepseek-harness discussion #9178](https://github.com/deepseek-ai/deepseek-harness/discussions/9178)。

> ✅ 插件**不再依赖 `better-sqlite3`**（原生 addon）。为彻底免除安装期 node-gyp 源码
> 编译（需本机 C++ 工具链，常导致「别的机器安装报 `node-gyp ... not ok`」），插件把
> better-sqlite3 的纯 JS wrapper vendor 进包内，并内置针对 dsh 桌面端 Electron ABI
> 预编译的二进制（`lib/native/{platform}-{arch}/`），运行时经 `nativeBinding` 直接加载，
> **package.json 的 dependencies / optionalDependencies 里都没有 better-sqlite3**，
> 安装期零编译、零 prebuild 下载。

安装后重启 Harness，侧边栏应出现「拍片哥工作台」入口（带描述与功能，而非只有名字）。

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
