@echo off
:: 设置字符编码为 UTF-8，防止中文显示乱码
chcp 65001 >nul
title Apple Music Web Player 极简启动器

:menu
cls
color 0b
echo =======================================================
echo.
echo      🎵  Apple Music Web Player 极简本地启动器  🎵
echo.
echo =======================================================
echo.
echo    [1] 🚀 启动服务 + 自动打开播放器网页 (推荐)
echo    [2] ⚡ 仅启动服务 (不打开网页)
echo    [3] 🔍 检查本地 Node.js 运行环境
echo    [4] ❌ 退出
echo.
echo =======================================================
set /p choice="👉 请输入选项序号 (1-4) 并按回车: "

if "%choice%"=="1" goto start_all
if "%choice%"=="2" goto start_only
if "%choice%"=="3" goto check_node
if "%choice%"=="4" goto exit_cmd
goto menu

:check_node
echo.
echo -------------------------------------------------------
echo 🔍 正在检查本地环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ❌ [未检测到 Node.js]
    echo 建议您前往 Node.js 官网下载并安装: https://nodejs.org/
    echo 注意: 服务运行需要 Node.js v18.0.0 或以上版本。
    echo.
) else (
    echo.
    echo.  ✅ [Node.js 运行环境正常]
    echo.  当前检测到版本: 
    node -v
    echo.
)
echo -------------------------------------------------------
pause
goto menu

:start_all
echo.
echo -------------------------------------------------------
echo 正在验证环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未检测到 Node.js，无法启动服务器，请先安装 Node.js!
    echo.
    pause
    goto menu
)
echo.
echo 🚀 正在拉起浏览器打开播放器界面...
start http://localhost:3000
echo ⚡ 正在启动 Node 服务 (端口 3000)，请勿关闭此窗口...
echo -------------------------------------------------------
node server.js
pause
goto menu

:start_only
echo.
echo -------------------------------------------------------
echo 正在验证环境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未检测到 Node.js，无法启动服务器，请先安装 Node.js!
    echo.
    pause
    goto menu
)
echo.
echo ⚡ 正在启动 Node 服务 (端口 3000)，请勿关闭此窗口...
echo -------------------------------------------------------
node server.js
pause
goto menu

:exit_cmd
exit
