@echo off
chcp 65001 >nul
echo ==========================================
echo   EAP Monitor - Start Server
echo ==========================================
echo.
echo 1. ตรวจสอบว่าอยู่ในเครือข่ายบริษัท (wifi PAIPEI)
echo 2. เปิด browser ไปที่ http://localhost:3001/
echo.
echo ------------------------------------------
cd /d "%~dp0"
echo Starting server...
node eap-server.js
pause
