@echo off
chcp 65001 >nul
cd /d "%~dp0"
:menu
cls
echo ==========================================
echo   เครื่องมือตรวจการนับจำนวนแผ่น
echo ==========================================
echo.
echo   ต้องอยู่บนเครือข่ายบริษัท (wifi PAIPEI) ก่อน
echo.
echo   -- นับจำนวนแผ่น --
echo   [1] verify-panel-count    - ตัวหลัก เทียบวิธีนับเดิม vs ปัจจุบัน
echo   [2] diagnose-panel-ids    - ฟอร์แมต PANEL_ID / ทำไมแผ่นซ้ำ
echo   [3] diagnose-event-types  - CEID / PANELTYPE มีค่าอะไรบ้าง
echo   [4] diagnose-lot-id-gaps  - ผลกระทบของแถวที่ LOT_ID ว่าง
echo.
echo   -- การเชื่อมต่อ / ตั้งค่า --
echo   [5] test-conn             - ต่อ Oracle ได้ไหม
echo   [6] test-camera-conn      - ต่อ NVR ได้ไหม
echo   [7] check-evidence-setup  - Evidence Pack พร้อมใช้หรือยัง
echo.
echo   -- ข้อมูล --
echo   [8] seed-fault-zone-map   - สร้าง data/fault-zone-map-seed.csv
echo   [9] list-alarm-codes      - สำรวจรูปแบบ ALARM_TEXT
echo.
echo   [0] ออก
echo.
set "choice="
set /p choice=เลือก:
if "%choice%"=="1" (set "script=verify-panel-count.js") else ^
if "%choice%"=="2" (set "script=diagnose-panel-ids.js") else ^
if "%choice%"=="3" (set "script=diagnose-event-types.js") else ^
if "%choice%"=="4" (set "script=diagnose-lot-id-gaps.js") else ^
if "%choice%"=="5" (set "script=test-conn.js") else ^
if "%choice%"=="6" (set "script=test-camera-conn.js") else ^
if "%choice%"=="7" (set "script=check-evidence-setup.js") else ^
if "%choice%"=="8" (set "script=seed-fault-zone-map.js") else ^
if "%choice%"=="9" (set "script=list-alarm-codes.js") else ^
if "%choice%"=="0" (goto :eof) else (goto menu)

echo.
echo ------------------------------------------
node "%script%"
echo ------------------------------------------
echo.
pause
goto menu
