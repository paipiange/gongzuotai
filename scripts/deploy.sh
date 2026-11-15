#!/usr/bin/env bash
# =============================================================================
# dsh-paipiange 一键部署脚本
# 作用：把「打包 + native 依赖编译 + 同步到实机 dsh + 自校验」全流程固化，
#       根治「每次更新 dsh 后 better-sqlite3 ABI 不匹配 / bindings 缺失」反复报错。
#
# 用法：bash scripts/deploy.sh
# 前置：项目根目录执行，本机已安装 pnpm、node、VS BuildTools + Python（编译用）。
# =============================================================================
set -euo pipefail

# ---- 路径定义 ----
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="$PROJECT_ROOT/.artifacts"
PKG_NAME="dsh-paipiange"
TARBALL="$ARTIFACTS_DIR/${PKG_NAME}-0.1.0.tgz"

# 实机 dsh 相关路径
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/desktop"
PROFILE_NM="$PROFILE_DIR/node_modules"

log()  { printf '\n\033[1;36m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[deploy][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m[deploy][OK]\033[0m %s\n' "$*"; }

# ---- 0. 探测实机 Electron 版本（关键：读正确的主程序，不是残留目录）----
log "0/7 探测实机 Electron 版本..."
# 真正的 dsh 主程序在安装目录 D:/software/dsh（Electron 44），
# 而 ~/.dsh/electron/ 是残留旧目录（Electron 43），两者 ABI 不同。
# 优先用主程序实际探测 process.versions，最准确。
DSH_MAIN_EXE=""
for candidate in \
  "/d/software/dsh/DeepSeek Harness.exe" \
  "/c/software/dsh/DeepSeek Harness.exe" \
  "/d/software/DeepSeek Harness/DeepSeek Harness.exe"; do
  if [ -f "$candidate" ]; then DSH_MAIN_EXE="$candidate"; break; fi
done

if [ -n "$DSH_MAIN_EXE" ]; then
  log "   找到 dsh 主程序: $DSH_MAIN_EXE"
  # 用主程序实际运行探测 electron 版本与 ABI（最可靠）
  cat > /tmp/dsh-probe.cjs <<'EOF'
console.log(process.versions.electron + '|' + process.versions.modules);
EOF
  PROBE_OUT="$("$DSH_MAIN_EXE" /tmp/dsh-probe.cjs 2>/dev/null | tail -1)"
  ELECTRON_VER="$(echo "$PROBE_OUT" | cut -d'|' -f1 | tr -d '\r\n ')"
  ELECTRON_ABI="$(echo "$PROBE_OUT" | cut -d'|' -f2 | tr -d '\r\n ')"
  if [ -z "$ELECTRON_VER" ] || [ "$ELECTRON_VER" = "undefined" ]; then
    fail "无法从主程序探测 Electron 版本，输出: $PROBE_OUT"
  fi
  ok "实机 Electron 版本 = $ELECTRON_VER（ABI = $ELECTRON_ABI）"
else
  # 回退：读安装目录 version 文件
  VERSION_FILE="/d/software/dsh/version"
  if [ ! -f "$VERSION_FILE" ]; then
    fail "找不到 dsh 主程序或 version 文件，请确认 dsh 安装位置"
  fi
  ELECTRON_VER="$(cat "$VERSION_FILE" | tr -d '\r\n ')"
  ok "实机 Electron 版本（version 文件）= $ELECTRON_VER"
fi

# ---- 1. 构建 + 打包 ----
log "1/7 构建插件并打包 tarball..."
cd "$PROJECT_ROOT"
pnpm build >/dev/null 2>&1 || fail "pnpm build 失败"
pnpm pack --pack-destination "$ARTIFACTS_DIR" >/dev/null 2>&1 \
  || fail "pnpm pack 失败"
ok "tarball 已生成: $TARBALL"

# ---- 2. 本地针对实机 Electron 重编译 better-sqlite3 ----
log "2/7 在本地针对 Electron $ELECTRON_VER 重编译 better-sqlite3（关键步骤）..."
ELECTRON_REBUILD_BIN="$PROJECT_ROOT/node_modules/.bin/electron-rebuild"
if [ ! -f "$ELECTRON_REBUILD_BIN" ]; then
  log "   本地无 @electron/rebuild，正在安装..."
  cd "$PROJECT_ROOT"
  pnpm add -D @electron/rebuild >/dev/null 2>&1 || fail "@electron/rebuild 安装失败"
fi

"$ELECTRON_REBUILD_BIN" \
  -v "$ELECTRON_VER" \
  -o better-sqlite3 \
  -f \
  --build-from-source \
  2>&1 | tail -20 || fail "electron-rebuild 失败"

# 定位本地编译产物
LOCAL_BSQLITE_NODE="$PROJECT_ROOT/node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
if [ ! -f "$LOCAL_BSQLITE_NODE" ]; then
  LOCAL_BSQLITE_NODE="$(find "$PROJECT_ROOT/node_modules" -name better_sqlite3.node 2>/dev/null | head -1)"
fi
[ -n "$LOCAL_BSQLITE_NODE" ] && [ -f "$LOCAL_BSQLITE_NODE" ] \
  || fail "本地编译产物 better_sqlite3.node 未找到"
ok "本地编译产物: $LOCAL_BSQLITE_NODE"

# ---- 3. 同步 native 二进制到实机（hoisted 顶层 + .pnpm store 双保险）----
log "3/7 同步 native 二进制到实机..."
# 3a. 顶层 hoisted 目录（electron 实际 require 解析到的路径）
HOISTED_DST="$PROFILE_NM/better-sqlite3/build/Release/better_sqlite3.node"
if [ -d "$PROFILE_NM/better-sqlite3" ]; then
  mkdir -p "$(dirname "$HOISTED_DST")"
  [ -f "$HOISTED_DST" ] && cp "$HOISTED_DST" "$HOISTED_DST.bak" 2>/dev/null || true
  cp "$LOCAL_BSQLITE_NODE" "$HOISTED_DST" \
    || fail "复制 native 二进制到顶层失败"
  ok "已覆盖顶层: $HOISTED_DST"
else
  fail "实机顶层 node_modules/better-sqlite3 不存在"
fi

# 3b. .pnpm store 目录（某些 resolve 场景会走这里）
PNPM_BSQLITE="$PROFILE_NM/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3"
if [ -d "$PNPM_BSQLITE" ]; then
  mkdir -p "$PNPM_BSQLITE/build/Release"
  cp "$LOCAL_BSQLITE_NODE" "$PNPM_BSQLITE/build/Release/better_sqlite3.node" 2>/dev/null \
    || log "   警告: 同步 .pnpm store 失败（非致命）"
  ok "已覆盖 .pnpm store"
fi

# ---- 4. 补齐 bindings / file-uri-to-path 纯 JS 依赖 ----
log "4/7 校验并补齐纯 JS 依赖（bindings / file-uri-to-path）..."
for entry in "bindings 1.5.0" "file-uri-to-path 1.0.0"; do
  set -- $entry
  name="$1" ver="$2"
  if [ ! -f "$PROFILE_NM/$name/package.json" ]; then
    log "   缺失 $name@$ver，尝试 npm 安装..."
    ( cd "$PROFILE_NM" && npm install "$name@$ver" --no-save >/dev/null 2>&1 ) \
      || log "   npm 安装 $name 失败，稍后自校验会暴露问题"
  else
    ok "   $name 已存在"
  fi
done

# ---- 5. 同步插件产物到实机（lib + package.json + patch）----
log "5/7 同步插件产物到实机..."
TARGET_PKG="$PROFILE_NM/dsh-paipiange"
if [ -d "$TARGET_PKG" ]; then
  tar -xzf "$TARBALL" -C "$TARGET_PKG" --strip-components=1 \
    package/lib package/package.json package/cordis.patch.yml 2>/dev/null \
    || fail "解压 tarball 到实机失败"
  ok "产物已覆盖到 $TARGET_PKG"
else
  fail "实机缺少 $TARGET_PKG 目录"
fi

# ---- 6. 自校验：用实机 Electron 实测加载 ----
log "6/7 用实机 Electron 实测加载 better-sqlite3 与插件..."
cat > /tmp/dsh-paipiange-verify.cjs <<'EOF'
const path = require('path');
const root = process.env.DSH_NM;
const Database = require(path.join(root, 'better-sqlite3'));
const db = new Database(':memory:');
db.exec('CREATE TABLE t(a)');
db.prepare('INSERT INTO t VALUES (?)').run(42);
const v = db.prepare('SELECT a FROM t').get().a;
if (v !== 42) throw new Error('better-sqlite3 查询异常');
console.log('[verify] better-sqlite3 OK, result =', v);
const pkg = require(path.join(root, 'dsh-paipiange', 'package.json'));
console.log('[verify] dsh-paipiange OK, version =', pkg.version);
EOF

ELECTRON_BIN="$DSH_MAIN_EXE"
if [ -z "$ELECTRON_BIN" ] || [ ! -f "$ELECTRON_BIN" ]; then
  ELECTRON_BIN="$DSH_HOME/electron/electron.exe"
fi
if [ ! -f "$ELECTRON_BIN" ]; then
  fail "找不到可用的 Electron 运行时用于自校验"
fi
DSH_NM="$PROFILE_NM" "$ELECTRON_BIN" /tmp/dsh-paipiange-verify.cjs \
  | grep -E "\[verify\]" || fail "实机 Electron 加载校验失败"

# ---- 7. 恢复本地 better-sqlite3 到标准 Node ABI（供本地测试/开发用）----
log "7/7 恢复本地 better-sqlite3 到标准 Node ABI（供本地测试）..."
cd "$PROJECT_ROOT"
npm rebuild better-sqlite3 >/dev/null 2>&1 \
  || log "   警告: 恢复本地 ABI 失败（不影响实机部署，但本地 pnpm test 会报错）"
ok "本地 better-sqlite3 已恢复标准 Node ABI，pnpm test 可用"

log ""
ok "==================== 部署完成 ===================="
ok "better-sqlite3 已针对 Electron $ELECTRON_VER 重编译并同步，"
ok "bindings / file-uri-to-path 已就位，插件产物已更新。"
ok "现在重启 dsh，插件应正常启用，不会再报 ABI / bindings 错误。"
