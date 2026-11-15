#!/usr/bin/env bash
# =============================================================================
# dsh-paipiange 轻量一键同步脚本（跨平台 bash）
# 作用：typecheck + build:plugin + 同步 lib 产物到实机 dsh
#       适用于纯 JS/TSX 改动（前端界面、host 逻辑、路由等）。
#       涉及 better-sqlite3 等 native 依赖或 Electron 升级时，
#       请改用 scripts/deploy.sh（含 ABI 重编译 + 自校验）。
#
# 用法：bash scripts/sync.sh
# 前置：项目根目录执行，已安装 pnpm、node。
# =============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${DSH_TARGET:-$HOME/.dsh/profiles/desktop/node_modules/dsh-paipiange}"

log()  { printf '\n\033[1;36m[sync]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[sync][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m[sync][OK]\033[0m %s\n' "$*"; }

log "项目根目录: $PROJECT_ROOT"
log "实机目标:   $TARGET"

[ -d "$TARGET/lib" ] || fail "未找到实机目标目录 $TARGET/lib，请先完整跑一次 scripts/deploy.sh 完成首次部署。"

log "1/4 类型检查 pnpm typecheck ..."
( cd "$PROJECT_ROOT" && pnpm typecheck ) || fail "类型检查未通过，已中止"

log "2/4 构建插件 pnpm build:plugin ..."
( cd "$PROJECT_ROOT" && pnpm build:plugin ) || fail "构建失败，已中止"

log "3/4 同步 lib 产物 ..."
cp -f "$PROJECT_ROOT"/lib/* "$TARGET/lib/" || fail "复制 lib 产物失败"

log "4/4 同步 package.json ..."
cp -f "$PROJECT_ROOT/package.json" "$TARGET/package.json" || fail "复制 package.json 失败"

log ""
ok "==================== 同步完成 ===================="
ok "现在重启 dsh 即可让改动生效。"
