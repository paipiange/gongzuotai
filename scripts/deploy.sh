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
ELECTRON_VERSION_FILE="$DSH_HOME/electron/version"
PROFILE_NM="$PROFILE_DIR/node_modules"

log()  { printf '\n\033[1;36m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[deploy][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m[deploy][OK]\033[0m %s\n' "$*"; }

# ---- 0. 探测实机 Electron 版本 ----
log "0/6 探测实机 Electron 版本..."
if [ ! -f "$ELECTRON_VERSION_FILE" ]; then
  fail "找不到 $ELECTRON_VERSION_FILE，无法确定目标 Electron 版本。"
fi
ELECTRON_VER="$(cat "$ELECTRON_VERSION_FILE" | tr -d '\r\n ')"
ok "实机 Electron 版本 = $ELECTRON_VER"

# ---- 1. 构建 + 打包 ----
log "1/6 构建插件并打包 tarball..."
cd "$PROJECT_ROOT"
pnpm build >/dev/null 2>&1 || fail "pnpm build 失败"
pnpm pack --pack-destination "$ARTIFACTS_DIR" >/dev/null 2>&1 \
  || fail "pnpm pack 失败"
ok "tarball 已生成: $TARBALL"

# ---- 2. 本地针对实机 Electron 重编译 better-sqlite3 ----
log "2/6 在本地针对 Electron $ELECTRON_VER 重编译 better-sqlite3（关键步骤）..."
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
log "3/6 同步 native 二进制到实机..."
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
log "4/6 校验并补齐纯 JS 依赖（bindings / file-uri-to-path）..."
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
log "5/6 同步插件产物到实机..."
TARGET_PKG="$PROFILE_NM/dsh-paipiange"
if [ -d "$TARGET_PKG" ]; then
  tar -xzf "$TARBALL" -C "$PROFILE_NM" --strip-components=1 \
    package/lib package/package.json package/cordis.patch.yml 2>/dev/null \
    || fail "解压 tarball 到实机失败"
  ok "产物已覆盖到 $TARGET_PKG"
else
  fail "实机缺少 $TARGET_PKG 目录"
fi

# ---- 6. 自校验：用实机 Electron 实测加载 ----
log "6/6 用实机 Electron 实测加载 better-sqlite3 与插件..."
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

ELECTRON_BIN="$DSH_HOME/electron/electron.exe"
if [ ! -f "$ELECTRON_BIN" ]; then
  fail "找不到 $ELECTRON_BIN"
fi
DSH_NM="$PROFILE_NM" "$ELECTRON_BIN" /tmp/dsh-paipiange-verify.cjs \
  | grep -E "\[verify\]" || fail "实机 Electron 加载校验失败"

log ""
ok "==================== 部署完成 ===================="
ok "better-sqlite3 已针对 Electron $ELECTRON_VER 重编译并同步，"
ok "bindings / file-uri-to-path 已就位，插件产物已更新。"
ok "现在重启 dsh，插件应正常启用，不会再报 ABI / bindings 错误。"
