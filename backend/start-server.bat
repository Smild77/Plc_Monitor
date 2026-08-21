@echo off
setlocal
title SENTRA - Server
cd /d "%~dp0"

rem Prefer a portable Node.js shipped next to the project. This is what lets
rem the app run on a PC where Node could not be installed: extract
rem node-vNN-win-x64.zip as <project>\node-portable and it is picked up here.
rem Falls back to a system-wide Node when that folder is absent.
set "PORTABLE_NODE=%~dp0..\node-portable"
if exist "%PORTABLE_NODE%\node.exe" set "PATH=%PORTABLE_NODE%;%PATH%"

echo ==========================================
echo   SENTRA - Start Server
echo ==========================================
echo.
echo  1. Check you are on the company network (wifi PAIPEI)
echo  2. Open browser at  http://localhost:3001/
echo.
echo ------------------------------------------
echo.

where node >nul 2>&1
if %errorlevel% neq 0 goto no_node
for /f "delims=" %%v in ('node -v') do echo Node %%v

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
echo The dashboard opens in your browser as soon as it is ready.
echo.
start "" /min "%~dp0open-ui.bat"
node eap-server.js
echo.
echo ------------------------------------------
echo Server stopped.
goto end

:no_node
echo [ERROR] Node.js not found.
echo         Either install it from https://nodejs.org, or extract the
echo         portable node-vNN-win-x64.zip into this folder:
echo           %PORTABLE_NODE%
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
