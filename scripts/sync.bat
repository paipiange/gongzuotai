@echo off
REM =============================================================================
REM dsh-paipiange 轻量一键同步脚本（Windows 批处理）
REM 作用：typecheck + build:plugin + 同步 lib 产物到实机 dsh
REM       适用于纯 JS/TSX 改动（前端界面、host 逻辑、路由等）。
REM       涉及 better-sqlite3 等 native 依赖或 Electron 升级时，
REM       请改用 scripts\deploy.sh（含 ABI 重编译 + 自校验）。
REM
REM 用法：双击运行，或在项目根目录执行  scripts\sync.bat
REM 前置：项目根目录，已安装 pnpm、node。
REM =============================================================================
setlocal enabledelayedexpansion

set "ROOT=%~dp0.."
set "TARGET=%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-paipiange"

echo.
echo [sync] 项目根目录: %ROOT%
echo [sync] 实机目标:   %TARGET%

if not exist "%TARGET%\lib" (
  echo [sync][FAIL] 未找到实机目标目录: %TARGET%\lib
  echo        请先完整跑一次 scripts\deploy.sh 完成首次部署。
  exit /b 1
)

echo.
echo [sync] 1/4 类型检查 pnpm typecheck ...
call pnpm typecheck
if errorlevel 1 (
  echo [sync][FAIL] 类型检查未通过，已中止。
  exit /b 1
)

echo.
echo [sync] 2/4 构建插件 pnpm build:plugin ...
call pnpm build:plugin
if errorlevel 1 (
  echo [sync][FAIL] 构建失败，已中止。
  exit /b 1
)

echo.
echo [sync] 3/4 同步 lib 产物 ...
xcopy /E /Y /Q "%ROOT%\lib\*" "%TARGET%\lib\" >nul
if errorlevel 1 (
  echo [sync][FAIL] 复制 lib 产物失败。
  exit /b 1
)

echo [sync] 4/4 同步 package.json ...
copy /Y "%ROOT%\package.json" "%TARGET%\package.json" >nul
if errorlevel 1 (
  echo [sync][FAIL] 复制 package.json 失败。
  exit /b 1
)

echo.
echo [sync][OK] 同步完成。
echo    现在重启 dsh 即可让改动生效。
pause
endlocal
