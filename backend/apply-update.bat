@echo off
rem Applies an update package ON THE MACHINE THAT RUNS THE SERVER.
rem
rem Replacing the files by hand does not work while the server is running:
rem node.exe holds the files it serves, Explorer refuses to overwrite them, and
rem the page keeps showing the old version. This stops the server first, puts
rem the new files in place, then starts it again.
rem
rem Just copy the update zip onto the Desktop and double-click this.
rem
rem Keep this file pure ASCII: cmd.exe on this machine runs code page 950 and
rem mis-parses multi-byte UTF-8 text in .bat files.
setlocal
cd /d "%~dp0"

echo ==========================================
echo   SENTRA - Apply update
echo ==========================================
echo.

if not exist "%~dp0tools\apply-update.ps1" goto no_script

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\apply-update.ps1"
if %errorlevel% neq 0 goto failed

echo.
echo ------------------------------------------
echo Starting the server again...
echo.
start "" "%~dp0start-server.bat"
goto end

:no_script
echo [ERROR] tools\apply-update.ps1 is missing.
echo         Copy it from the development PC first.
goto end

:failed
echo.
echo [ERROR] Update was not applied. The server was NOT restarted.
echo         Read the message above, fix it, then run this again.

:end
echo.
pause
