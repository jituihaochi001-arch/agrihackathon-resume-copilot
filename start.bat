@echo off
chcp 65001 >nul
title 简历精修 · 本地服务
cd /d "%~dp0"

rem 已在运行就直接打开页面，避免起第二个实例
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8765/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
if %errorlevel%==0 (
  echo 服务已在运行，正在打开页面……
  start "" "http://127.0.0.1:8765/"
  exit /b
)

echo 正在启动本地服务（代理 + 页面托管）……
node server\server.mjs

echo.
echo 服务已停止。
pause