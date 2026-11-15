# Native 依赖重建指南（better-sqlite3）

`dsh-paipiange` 使用 `better-sqlite3`（原生 addon）。其实机运行环境是
DeepSeek Harness 桌面端（**Electron 44.7.0 / Node v24.21.0 / ABI 149**），
因此 `.node` 编译产物必须针对该 ABI 编译，不能使用开发机标准 Node 的 ABI。

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
node -e "const b=require('fs').readFileSync('C:/Users/Administrator/.dsh/profiles/desktop/node_modules/better-sqlite3/build/Release/better_sqlite3.node').toString('latin1'); console.log((b.match(/node_register_module_v(\d+)/)||[])[1])"
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
