@echo off
chcp 65001 >nul
title EAP Monitor - Server
cd /d "%~dp0"

echo ==========================================
echo   EAP Monitor - Start Server
echo ==========================================
echo.
echo 1. ตรวจสอบว่าอยู่ในเครือข่ายบริษัท (wifi PAIPEI)
echo 2. เปิด browser ไปที่ http://localhost:3001/
echo.
echo ------------------------------------------

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] ไม่พบ Node.js บนเครื่องนี้
  echo         ติดตั้งจาก https://nodejs.org แล้วเปิดไฟล์นี้ใหม่อีกครั้ง
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [SETUP] ยังไม่มี node_modules — กำลังติดตั้ง ใช้เวลาสักครู่...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install ไม่สำเร็จ
    pause
    exit /b 1
  )
  echo.
)

if not exist ".env" (
  echo [ERROR] ไม่พบไฟล์ .env ^(เก็บ user/password ของ Oracle^)
  echo         ต้องสร้าง backend\.env ก่อนถึงจะเริ่มเซิร์ฟเวอร์ได้
  echo.
  pause
  exit /b 1
)

echo Starting server...
echo.
node eap-server.js

echo.
echo ------------------------------------------
echo เซิร์ฟเวอร์หยุดทำงานแล้ว
pause
