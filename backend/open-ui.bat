@echo off
rem Waits until the server answers, then opens the dashboard in the default
rem browser. start-server.bat launches this in the background; it is not meant
rem to be run on its own.
rem
rem Keep this file pure ASCII - cmd.exe on this machine runs code page 950 and
rem mis-parses multi-byte UTF-8 text in .bat files.
setlocal
set "URL=http://localhost:3001/"
set "HEALTH=http://localhost:3001/health"

where curl >nul 2>&1
if %errorlevel% neq 0 goto no_curl

rem poll for up to ~60s, opening as soon as the server is ready
for /l %%i in (1,1,60) do (
  curl -s -o nul -m 2 "%HEALTH%"
  if not errorlevel 1 goto ready
  ping -n 2 127.0.0.1 >nul
)
exit /b 1

:no_curl
rem no curl available: fall back to a fixed wait
ping -n 6 127.0.0.1 >nul

:ready
start "" "%URL%"
exit /b 0
