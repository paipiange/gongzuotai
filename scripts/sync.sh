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
PROFILE_NM="${DSH_PROFILE_NM:-$HOME/.dsh/profiles/desktop/node_modules}"
TARGET="${DSH_TARGET:-$PROFILE_NM/dsh-paipiange}"

log()  { printf '\n\033[1;36m[sync]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[sync][FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m[sync][OK]\033[0m %s\n' "$*"; }

# 清理目标 lib/ 下已不在本地 lib/ 的旧构建产物（tsdown 每次换 hash 文件名会堆积）
clean_stale() {
  local dst="$1"
  local base
  for f in "$dst"/*; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in
      *.js|*.d.ts)
        if [ ! -e "$PROJECT_ROOT/lib/$base" ]; then
          rm -f "$f" && log "   清理旧产物: $base"
        fi
        ;;
    esac
  done
}

log "项目根目录: $PROJECT_ROOT"
log "实机目标:   $TARGET"

[ -d "$TARGET/lib" ] || fail "未找到实机目标目录 $TARGET/lib，请先完整跑一次 scripts/deploy.sh 完成首次部署。"

log "1/5 类型检查 pnpm typecheck ..."
( cd "$PROJECT_ROOT" && pnpm typecheck ) || fail "类型检查未通过，已中止"

log "2/5 构建插件 pnpm build:plugin ..."
( cd "$PROJECT_ROOT" && pnpm build:plugin ) || fail "构建失败，已中止"

log "3/5 同步 lib 产物到顶层 ..."
cp -f "$PROJECT_ROOT"/lib/* "$TARGET/lib/" || fail "复制 lib 产物失败"
clean_stale "$TARGET/lib"

log "4/5 同步 lib 产物到 .pnpm 副本（dsh 实际加载位置）..."
# dsh 通过 package.json 的 file:...tgz 依赖安装插件，真实加载位置在 .pnpm
# 的硬链接副本里。顶层 node_modules/dsh-paipiange 是 deploy.sh 解压的游离目录，
# 并非 dsh 的 require 解析目标。必须同时覆盖 .pnpm 副本，否则路由不生效。
PNPM_COPIES=$(find "$PROFILE_NM/.pnpm" -maxdepth 3 -type d -name "dsh-paipiange" 2>/dev/null)
if [ -n "$PNPM_COPIES" ]; then
  for pkg in $PNPM_COPIES; do
    cp -f "$PROJECT_ROOT"/lib/* "$pkg/lib/" || fail "复制 lib 到 $pkg 失败"
    cp -f "$PROJECT_ROOT/package.json" "$pkg/package.json" || fail "复制 package.json 到 $pkg 失败"
    clean_stale "$pkg/lib"
    ok "   已同步 .pnpm 副本: $pkg"
  done
else
  log "   未发现 .pnpm 副本（可能 pnpm 未安装该插件，跳过）"
fi

log "5/5 同步 package.json ..."
cp -f "$PROJECT_ROOT/package.json" "$TARGET/package.json" || fail "复制 package.json 失败"

log ""
ok "==================== 同步完成 ===================="
ok "现在重启 dsh 即可让改动生效。"
