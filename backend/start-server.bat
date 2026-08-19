@echo off
setlocal
title EAP Monitor - Server
cd /d "%~dp0"

echo ==========================================
echo   EAP Monitor - Start Server
echo ==========================================
echo.
echo  1. Check you are on the company network (wifi PAIPEI)
echo  2. Open browser at  http://localhost:3001/
echo.
echo ------------------------------------------
echo.

where node >nul 2>&1
if %errorlevel% neq 0 goto no_node

if not exist "node_modules" goto do_install
goto check_env

:do_install
echo [SETUP] node_modules not found - installing, please wait...
call npm install
if %errorlevel% neq 0 goto install_failed
echo.

:check_env
if not exist ".env" goto no_env

echo Starting server...
echo.
node eap-server.js
echo.
echo ------------------------------------------
echo Server stopped.
goto end

:no_node
echo [ERROR] Node.js not found on this machine.
echo         Install from https://nodejs.org then run this file again.
goto end

:install_failed
echo.
echo [ERROR] npm install failed.
goto end

:no_env
echo [ERROR] File .env not found (Oracle user/password).
echo         You must create  backend\.env  before the server can start.
goto end

:end
echo.
pause
