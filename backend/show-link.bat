@echo off
rem Shows the address other people should open in their browser.
rem
rem The server prints this when it starts, but it scrolls away and is gone
rem once the window is closed. Double-click this any time to get the answer
rem again - it reads the real port from .env and this PC's own network config.
rem
rem Keep this file pure ASCII: cmd.exe on this machine runs code page 950 and
rem mis-parses multi-byte UTF-8 text in .bat files.
setlocal
cd /d "%~dp0"

echo ==========================================
echo   EAP Monitor - Dashboard link
echo ==========================================

if not exist "%~dp0tools\show-link.ps1" goto no_script

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\show-link.ps1"
goto end

:no_script
echo [ERROR] tools\show-link.ps1 is missing.

:end
echo.
pause
