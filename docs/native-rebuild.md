# Native 依赖重建指南（better-sqlite3）

`dsh-paipiange` 使用 `better-sqlite3`（原生 addon）。其实机运行环境是
DeepSeek Harness 桌面端（**Electron 43.3.0 / Node v24.18.1 / ABI 148**），
因此 `.node` 编译产物必须针对该 ABI 编译，不能使用开发机标准 Node 的 ABI。

## 何时需要重建

- 实机启用插件报 `ERR_DLOPEN_FAILED` 或 `NODE_MODULE_VERSION mismatch`。
- 报 `Cannot find module 'bindings'`（`bindings`、`file-uri-to-path` 缺失）。
- 升级/降级了 Electron 或 Node 版本。

## 一键重建（在项目根目录执行）

```bash
# 1. 安装重建工具（已列入 devDependencies）
pnpm install

# 2. 针对目标 Electron 版本重编译 better-sqlite3
npx electron-rebuild -v 43.3.0 -o better-sqlite3 -f --build-from-source
```

`-v` 必须与实机 `~/.dsh/electron/version` 文件内容一致（当前 `43.3.0`）。
`--build-from-source` 强制本地编译，避免下载到错误 ABI 的预编译二进制。

编译完成后，产物位于：
`node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/better_sqlite3.node`

## 同步到实机

```bash
SRC="node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
DST="$HOME/.dsh/profiles/desktop/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
cp "$DST" "$DST.bak"          # 先备份旧产物
cp "$SRC" "$DST"              # 覆盖新产物
```

## 校验 ABI 是否正确

```bash
# 查看 .node 内注册的 ABI 版本号
node -e "const b=require('fs').readFileSync('$DST').toString('latin1'); console.log((b.match(/node_register_module_v(\d+)/)||[])[1])"
# 期望输出：148
```

或用实机 Electron 运行时直接加载验证：

```bash
cat > /tmp/test.cjs <<'EOF'
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec('CREATE TABLE t(a)');
db.prepare('INSERT INTO t VALUES (?)').run(42);
console.log('OK', db.prepare('SELECT a FROM t').get().a);
EOF
cd "$HOME/.dsh/profiles/desktop/node_modules"
NODE_PATH="$(pwd)" "$HOME/.dsh/electron/electron.exe" /tmp/test.cjs
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

2. **ABI 编号对照**：Electron 40/41/42/43 → 143/145/146/148；Node 22→127；
   Node 24 标准→137；Node 25→149。误用标准 Node 的 ABI 会 `ERR_DLOPEN_FAILED`。

3. **不要**用开发机默认 `node`（如 Node 22 / ABI 127）直接 `npm rebuild`，
   那会编出 ABI 127 的产物，同样不匹配 Electron 43。
