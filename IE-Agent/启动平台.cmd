@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not defined LOCAL_PORT set LOCAL_PORT=3100
"runtime\node.exe" scripts\setup-local.mjs
if errorlevel 1 goto failed
echo.
echo 平台地址：http://127.0.0.1:%LOCAL_PORT%/
echo 首次账号密码请查看 var\initial-accounts.json，首次登录需要修改密码。
echo 关闭此窗口将停止平台服务。
echo.
"runtime\node.exe" scripts\start-local.mjs
:failed
pause
