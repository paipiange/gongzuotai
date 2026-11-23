# Native 依赖重建指南（better-sqlite3）

`dsh-paipiange` 使用 `better-sqlite3`（原生 addon）。其实机运行环境是
DeepSeek Harness 桌面端（**Electron 44.7.0 / Node v24.21.0 / ABI 149**），
因此 `.node` 编译产物必须针对该 ABI 编译，不能使用开发机标准 Node 的 ABI。

## ✅ 首选：插件已内置二进制，用户无需编译

从 0.2.3 起，插件把针对 dsh Electron ABI 编译好的 `better_sqlite3.node` 直接打包进
tarball（`lib/native/{platform}-{arch}/better_sqlite3.node`），运行时经
`nativeBinding` 选项显式加载（见 `src/host/storage/nativeBinding.ts`），**完全免除
用户安装期的 node-gyp 源码编译**。这是解决「别的机器安装报 `node-gyp ... not ok`」
的根本方案。

> **配套关键改动**：`better-sqlite3` 已从 `dependencies` 移到 `optionalDependencies`。
> 原因是——即便内置了二进制，只要它仍作为强依赖存在，pnpm 安装 `paipiange` 时仍会
> 强制执行 `better-sqlite3` 的 `install` 脚本（`prebuild-install || node-gyp rebuild`），
> 在缺少 Python / C++ 工具链的机器上直接让整个安装 `exit code 1`，内置二进制根本没机会被加载。
> 移到 `optionalDependencies` 后，安装期编译失败只会降级为 warning，不再阻断安装。

内置平台（与 dsh 官方桌面版发布矩阵对齐）：
- `win32-x64`（Windows x64）
- `darwin-arm64`（macOS Apple Silicon）

平台不匹配或二进制加载失败时，自动 fallback 到依赖里 node-gyp 编译的版本
（仅用于开发态）。

### 如何新增一个平台的二进制

1. 在对应平台用 `node-gyp` 编译出 ABI 149 的 `.node`（见下方「手工重建」）。
2. 放到 `src/host/native/{platform}-{arch}/better_sqlite3.node`。
3. 构建时 `copyNativePlugin` 会自动拷进 `lib/native/`。

### macOS（Apple Silicon / arm64）编译

```bash
# 确认工具链
xcode-select -p || xcode-select --install

# 确认 Mac 版 dsh 主程序 ABI（应与 Windows 版一致为 149）
"/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  -e "console.log(process.versions.electron, process.versions.modules)"

# 编译
mkdir -p /tmp/paipiange-native && cd /tmp/paipiange-native
npm init -y >/dev/null 2>&1
npm install better-sqlite3@12.11.1 --ignore-scripts
cd node_modules/better-sqlite3
npx node-gyp rebuild --release --target=44.7.0 --runtime=electron \
  --dist-url=https://electronjs.org/headers
# 产物：build/Release/better_sqlite3.node
```

> 若 `--target=44.7.0` 与 Mac 版 dsh 实际 Electron 版本不符，请替换成
> 第一步查到的实际版本号（ABI 需与 dsh 运行时一致）。

---

## 以下为历史方案（用户手动重建 / 本机开发调试）

## ⚠️ 最关键的教训：判断 Electron 版本要读「安装目录」，不是「残留目录」

机器上有**两个** Electron 相关位置，版本不同，极易搞错：

| 位置 | 版本 | ABI | 是否真正加载插件 |
|---|---|---|---|
| `D:/software/dsh/`（安装目录，主程序 `DeepSeek Harness.exe`） | **Electron 44.7.0** | **149** | ✅ **是** |
| `~/.dsh/electron/`（用户数据残留旧目录） | Electron 43.3.0 | 148 | ❌ 否 |

**正确判断方法**（任选其一）：
1. `cat /d/software/dsh/version` → `44.7.0`
2. 直接问主程序：`"/d/software/dsh/DeepSeek Harness.exe" /tmp/probe.cjs`
   （probe.cjs 里 `console.log(process.versions.electron, process.versions.modules)`）

**不要**读 `~/.dsh/electron/version`——那是残留旧目录，会误导成 Electron 43。

## 何时需要重建

- 实机启用插件报 `ERR_DLOPEN_FAILED` 或 `NODE_MODULE_VERSION mismatch`。
- 报 `Cannot find module 'bindings'`（`bindings`、`file-uri-to-path` 缺失）。
- 升级/降级了 dsh（Electron 版本变化）。

## 一键重建（推荐，在项目根目录执行）

```bash
bash scripts/deploy.sh
```

脚本会自动：探测正确的 Electron 版本（读主程序实际 `process.versions`）→
构建打包 → 针对该版本重编译 better-sqlite3 → 同步二进制 + 补齐依赖 →
更新插件产物 → 用实机主程序实测自校验。**这是唯一推荐入口。**

## 手工重建（兜底，仅当脚本不可用时）

```bash
# 1. 确认正确 Electron 版本（读安装目录，非 ~/.dsh/electron）
cat /d/software/dsh/version    # 44.7.0

# 2. 针对该版本重编译
npx electron-rebuild -v 44.7.0 -o better-sqlite3 -f --build-from-source
```

产物位置：
`node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/better_sqlite3.node`

## 同步到实机（两处都要覆盖）

```bash
SRC="<本地编译产物路径>"
NM="$HOME/.dsh/profiles/desktop/node_modules"
cp "$SRC" "$NM/better-sqlite3/build/Release/better_sqlite3.node"          # 顶层 hoisted
cp "$SRC" "$NM/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3/build/Release/better_sqlite3.node"  # .pnpm store
```

## 校验 ABI 是否正确

```bash
node -e "const b=require('fs').readFileSync(require('os').homedir() + '/.dsh/profiles/desktop/node_modules/better-sqlite3/build/Release/better_sqlite3.node').toString('latin1'); console.log((b.match(/node_register_module_v(\d+)/)||[])[1])"
# 期望输出：149（对应 Electron 44.7.0）
```

或用实机主程序（不是 ~/.dsh/electron/electron.exe）直接加载验证：

```bash
cat > /tmp/test.cjs <<'EOF'
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE t(a)');
db.prepare('INSERT INTO t VALUES (?)').run(42);
console.log('OK', db.prepare('SELECT a FROM t').get().a);
EOF
cd "$HOME/.dsh/profiles/desktop/node_modules"
NODE_PATH="$(pwd)" "/d/software/dsh/DeepSeek Harness.exe" /tmp/test.cjs
# 期望输出：OK 42
```

## 常见坑

1. **`bindings` / `file-uri-to-path` 缺失**：这两个是 `better-sqlite3` 的
   纯 JS 依赖，若手动 `cp` 同步（而非 `pnpm add`）会遗漏。补装方式：
   ```bash
   cd "$HOME/.dsh/profiles/desktop/node_modules"
   npm install bindings@1.5.0 file-uri-to-path@1.0.0 --no-save
   ```
   若 npm 网络超时，可手动放置（两者均为极小的纯 JS shim 包）。

2. **ABI 编号对照**：Electron 40/41/42/43/44 → 143/145/146/148/149；
   Node 22→127；Node 24 标准→137；Node 25→147。误用标准 Node 的 ABI 会
   `ERR_DLOPEN_FAILED`。

3. **不要**用开发机默认 `node`（如 Node 22 / ABI 127）直接 `npm rebuild`，
   那会编出 ABI 127 的产物，同样不匹配 Electron 44。

4. **不要**读 `~/.dsh/electron/version` 判断版本——它是残留旧目录
   （Electron 43 / ABI 148），会把编译目标带偏。真正的主程序在
   `D:/software/dsh/`（Electron 44 / ABI 149）。
