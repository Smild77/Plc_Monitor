@echo off
rem Creates the "EAP Monitor Server" shortcut on the desktop.
rem
rem Double-click this after copying the project onto a new PC. The .lnk file
rem stores absolute paths, so it cannot be shipped inside the zip - it has to
rem be made on the machine that will run the server.
rem
rem Use this rather than right-click "Run with PowerShell" on the .ps1: that
rem closes its window the moment the script ends, so you never see whether it
rem worked or what went wrong.
rem
rem Keep this file pure ASCII: cmd.exe on this machine runs code page 950 and
rem mis-parses multi-byte UTF-8 text in .bat files.
setlocal
cd /d "%~dp0"

echo ==========================================
echo   EAP Monitor - Create desktop shortcut
echo ==========================================
echo.

if not exist "%~dp0tools\create-desktop-shortcut.ps1" goto no_script

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\create-desktop-shortcut.ps1"
if %errorlevel% neq 0 goto failed
goto end

:no_script
echo [ERROR] tools\create-desktop-shortcut.ps1 is missing.
echo         Unpack the project again - the folder is incomplete.
goto end

:failed
echo.
echo [ERROR] Could not create the shortcut. See the message above.

:end
echo.
pause
