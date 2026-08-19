@echo off
rem Builds a small update package (app code only) for a machine that already
rem runs EAP Monitor, instead of shipping the full ~50 MB deploy zip again.
rem
rem Run this on the development PC after making changes. It writes a zip to
rem your Desktop and leaves .env and qr-logs on the target machine alone.
rem
rem Keep this file pure ASCII: cmd.exe on this machine runs code page 950 and
rem mis-parses multi-byte UTF-8 text in .bat files.
setlocal
cd /d "%~dp0"

echo ==========================================
echo   EAP Monitor - Build update package
echo ==========================================

if not exist "%~dp0tools\make-update-package.ps1" goto no_script

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-update-package.ps1"
if %errorlevel% neq 0 goto failed
goto end

:no_script
echo [ERROR] tools\make-update-package.ps1 is missing.
goto end

:failed
echo.
echo [ERROR] Could not build the package. See the message above.

:end
echo.
pause
