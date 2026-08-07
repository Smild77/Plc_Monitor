# 🏭 PLC Monitor — EAP Factory Dashboard

ระบบ **Real-time Machine Status Monitor** สำหรับโรงงาน PA01
ดึงข้อมูลจาก Oracle DB → WebSocket → แสดงบน Dashboard แบบเรียลไทม์

## 📐 สถาปัตยกรรม

```
Oracle DB (PAEAPTRACE / DWD_PA01_PRD)
    ↓ poll ทุก 3 วินาที (configurable)
Node.js Server (eap-server.js)
    ↓ WebSocket push (เฉพาะที่เปลี่ยน)
Frontend Dashboard (index.html)
```

**ไม่ต้องใช้ Redis** — เป็น single-instance server ตัวเดียวจบ
ลดความซับซ้อนในการติดตั้งและดูแล

## ✨ ฟีเจอร์หลัก

**Realtime Dashboard**
- สถานะเครื่องจักรแบบสี: 🟢 RUN / 🟡 IDLE / 🔴 DOWN / ⚪ NO_DATA
- อัพเดตอัตโนมัติผ่าน WebSocket (ส่งเฉพาะเครื่องที่มีการเปลี่ยนแปลง)
- แสดง LOT ID, Total Sheet, % QR, Error Sheet, อัปเดตล่าสุด
- แผนผังชั้นโรงงาน (1F / 2F) พร้อมตำแหน่งเครื่องจักรบนแผนที่

**Sidebar**
- สรุปสถานะรวม (จำนวน RUN/IDLE/DOWN)
- % QR รวมของทุกเครื่อง (กดรีเฟรชได้)
- สรุปรายวัน (3 วัน) — Lots / Panels / Alarms

**เครื่องมือบนแผนที่**
- Zoom In / Out / Reset (+ / − / 0)
- ถ่ายภาพหน้าจอเป็น PNG (P)
- แสดง/ซ่อน Zone
- **Admin Mode** (กด `A` + รหัสผ่าน `admin`):
  - Zone Editor — วาด/แก้ไข/Export zone
  - Machine Drag — ย้ายตำแหน่งเครื่องจักรบนแผนที่
  - Export ตำแหน่งเครื่องจักร

**อื่น ๆ**
- ค้นหาเครื่องจักร (กด `/` แล้วพิมพ์)
- Alert Panel — แจ้งเตือนเครื่องที่มีปัญหา
- รองรับ 3 ภาษา: 🇹🇭 ไทย / 🇬🇧 English / 🇨🇳 中文
- ทำงานในเครือข่ายภายในได้ (ไม่ต้องอินเทอร์เน็ต, ใช้ฟอนต์ระบบ)

## 🚀 วิธีรัน

### 1. ติดตั้ง dependencies
```bash
cd plc-full-project/backend
npm install
```

### 2. ตั้งค่า Oracle credentials
สร้างไฟล์ `backend/.env`:
```env
ORACLE_CONNECTION_STRING=pafabdb01.eavarytech.com:1521/parpbn08
ORACLE_USER=INTELLIGENT_READ_PA01_PRD
ORACLE_PASSWORD=your_password_here
POLL_MINUTES=2
POLL_INTERVAL_MS=3000
PORT=3001
# (optional)
STALE_MINUTES=2
ALLOWED_MACHINES=MC001,MC002
```

> ⚠️ **ต้องเชื่อม VPN/เครือข่ายภายใน** เพื่อเข้าถึง Oracle server

### 3. รันเซิร์ฟเวอร์

**วิธีง่าย (Windows):** ดับเบิ้ลคลิก `backend\start-server.bat`

**หรือพิมพ์ใน terminal:**
```bash
npm start
# หรือ: node eap-server.js
```

โหมดพัฒนา (auto-reload):
```bash
npm run dev
```

เมื่อรันสำเร็จ server จะแสดง LAN IP ทั้งหมดที่คนในวงเครือข่ายเดียวกันสามารถเข้าได้ — ส่ง URL นั้นให้เพื่อนร่วมงานได้เลย

### 4. เปิด Dashboard
เปิด browser ไปที่:
```
http://localhost:3001/
```

> ⚠️ **สำคัญ:** ต้องเปิดผ่าน `http://localhost:3001/` เท่านั้น
> ห้ามดับเบิ้ลคลิกไฟล์ `index.html` ตรง ๆ (จะเป็น `file://` แล้ว fetch/WebSocket ไม่ได้)

เลือก **PA01** → เลือก **ชั้น (1F/2F)** → สถานะเครื่องจักรจะแสดงบนแผนที่

## 📊 API Endpoints

| Endpoint | คำอธิบาย |
|----------|----------|
| `GET /health` | สถานะเซิร์ฟเวอร์ + uptime + จำนวนเครื่องใน snapshot |
| `GET /api/snapshot` | Snapshot สถานะเครื่องจักรทั้งหมด (JSON) |
| `GET /api/machines` | รายชื่อเครื่องจักรทั้งหมดจาก DB |
| `GET /api/lot-report?days=7` | สรุป Lot ย้อนหลัง N วัน (1–30) |
| `GET /api/qr-history?machine_id=X&range=today` | ประวัติ QR ของเครื่อง (group by LOT) — รองรับ `limit`, `offset`, `start_date`, `end_date` |
| `GET /api/qr-daily?machine_id=X&range=week` | % QR รายวันของเครื่อง (หลายวัน) |
| `GET /api/status-history?machine_id=X&range=today` | ประวัติ EQPSTATUS ทั้งวัน — รองรับ `limit`, `offset`, `alarm_category` |
| `GET /api/qr-summary?range=today` | สรุป % QR รวมทุกเครื่อง (สำหรับ sidebar) |
| `GET /api/qr-export?machine_id=X&range=today` | Export ประวัติ QR เป็น CSV (download) |
| `GET /api/qr-logs/qr-YYYY-MM-DD.csv` | ดาวน์โหลดไฟล์ QR log รายวัน |
| `ws://localhost:3001/ws` | WebSocket สำหรับ real-time updates (push SNAPSHOT + CHANGES) |

**ค่า `range` ที่รองรับ:** `today` (default) / `yesterday` / `week` (7 วัน) / `month` (30 วัน) หรือกำหนด `start_date` + `end_date` (YYYY-MM-DD) เอง

## ⚙️ การปรับแต่ง Polling

| ค่า (`.env`) | คำแนะนำ | ผลกระทบ |
|--------------|---------|---------|
| `POLL_INTERVAL_MS=3000` | ⭐ ค่าเริ่มต้น — สมดุล | อัพเดตทุก 3 วิ โหลด Oracle ปานกลาง |
| `POLL_INTERVAL_MS=5000` | ประหยัดทรัพยากร | ดีเลย์ 5 วิ โหลด Oracle ลดลง ~40% |
| `POLL_INTERVAL_MS=10000` | ประหยัดมาก | ดีเลย์ 10 วิ |
| `POLL_MINUTES=2` | ⭐ ดึงแค่ 2 นาทีล่าสุด | เหมาะกับสถานะปัจจุบัน |
| `POLL_MINUTES=30` | ดึงล่าสุด 30 นาที | query ช้าลง ไม่จำเป็น |
| `STALE_MINUTES=2` | ค่าเริ่มต้น = `POLL_MINUTES` | ถ้าเครื่องไม่ active ในช่วงนี้ → สีเทาจาง (NO_DATA) |
| `ALLOWED_MACHINES=MC001,MC002` | จำกัดเฉพาะเครื่อง (สำหรับเทส) | `null` = ทุกเครื่อง |

## ⌨️ ปุ่มลัด (Keyboard Shortcuts)

| ปุ่ม | การทำงาน |
|-----|---------|
| `+` / `=` | Zoom In |
| `-` / `_` | Zoom Out |
| `0` / `Home` | Reset Zoom |
| `F` | เปิด/ปิด Sidebar |
| `P` | ถ่ายภาพหน้าจอ (PNG) |
| `A` | เข้า Admin Mode (ต้องใส่รหัสผ่าน) |
| `/` | โฟกัสช่องค้นหา |
| `?` | แสดงคำแนะนำปุ่มลัด |
| `Esc` | ปิด popup / alert / ออกจากช่องค้นหา |

## 🔧 เทคโนโลยี

- **Backend:** Node.js + `oracledb` 6 (thin mode, ไม่ต้อง Oracle Client) + `ws` (WebSocket)
- **Frontend:** HTML/CSS/JavaScript ล้วน (ไม่มี framework, ไม่มี build step)
- **Database:** Oracle (read-only จาก `PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL`, `EAP_EQP_ALM`, `EAP_GUI_ERR_MSG`, `DWD_PA01_PRD.LOTINFO_MAIN`)
- **Realtime:** WebSocket push + change detection (ส่งเฉพาะที่เปลี่ยน, ลด bandwidth)
- **Resilience:** Oracle disconnect → retry ทุก 30 วินาทีอัตโนมัติ (server ไม่ exit)
- **QR Log:** เขียนไฟล์ CSV รายวันที่ `backend/qr-logs/` อัตโนมัติ (เก็บ 30 วัน)

## 📁 โครงสร้างโปรเจกต์

```
plc-full-project/
├── backend/
│   ├── eap-server.js          ← 🎯 main entry point (HTTP + WS + Oracle poll)
│   ├── .env                    ← Oracle credentials + config
│   ├── oracle_setup.sql        ← SQL สร้างตาราง History + index + GRANT + purge job
│   ├── test-conn.js            ← สคริปต์ทดสอบ Oracle connection
│   ├── start-server.bat        ← ตัวเริ่มเซิร์ฟเวอร์บน Windows
│   ├── queries/
│   │   └── index_recommendations.sql  ← SQL อ้างอิงสำหรับดึงสถานะเครื่อง + QR %
│   ├── qr-logs/                ← (auto) CSV รายวัน — สร้างอัตโนมัติตอนรัน
│   └── src/                    ← ⚠️ Legacy modular version (ไม่ได้ใช้)
└── frontend/
    ├── index.html              ← 🎯 Dashboard (HTML + CSS + JS ในไฟล์เดียว)
    ├── th.js                   ← 🇹🇭 ภาษาไทย
    ├── en.js                   ← 🇬🇧 ภาษาอังกฤษ
    ├── ch.js                   ← 🇨🇳 ภาษาจีน
    ├── PA01_1F.jpg             ← แผนผังชั้น 1
    └── PA01_2F.jpg             ← แผนผังชั้น 2
```

## 🛠️ การแก้ปัญหา

| อาการ | สาเหตุ | วิธีแก้ |
|------|------|------|
| หน้าเว็บเปิดไม่ได้ | ยังไม่รัน server | รัน `start-server.bat` หรือ `node eap-server.js` |
| "Oracle connection FAILED" | ยังไม่สลับ wifi/VPN | สลับเข้าเครือข่ายบริษัท → server จะ retry ทุก 30 วิ อัตโนมัติ |
| โหลดไม่ได้ในเว็บ | เปิดเป็น `file://` | เปิดผ่าน `http://localhost:3001/` เท่านั้น |
| ข้อมูลไม่ขึ้น | Oracle ยังไม่ติด | ดู terminal — รอ retry หรือเช็ค wifi อีกครั้ง |
| Dashboard ไม่อัพเดต | WebSocket ตัด | เปิด console (F12) ดูสถานะ WS และ `#cdot` สีเขียวหรือไม่ |
| ปุ่ม PA02–PA07 กดไม่ได้ | ปกติ | ตอนนี้ใช้ได้แค่ PA01 (ดู `active:false` ใน `FACTORIES` ใน `index.html`) |
| ต้องการเข้า Admin Mode | ต้องใส่รหัส | กด `A` → รหัสผ่าน `admin` (เปลี่ยนได้ใน `index.html` ตรง `ADMIN_PASSWORD`) |

**ตรวจสอบเชื่อม Oracle ได้จริง:**
```bash
node test-conn.js
# หรือเปิด browser ไป http://localhost:3001/api/lot-report?days=1
# ถ้าได้ JSON มี rows แปลว่า Oracle ติด ✓
```

## 📝 Notes

- โฟลเดอร์ `backend/src/` เป็น modular version (poller / alertEngine / historyWriter / wsHub) ที่ยังไม่สมบูรณ์ ไม่ถูกใช้งานจริง — ทุกอย่างรวมอยู่ใน `eap-server.js` ไฟล์เดียว
- หากต้องการใช้ Redis pub/sub สำหรับ multi-instance ในอนาคต ดูโครงสร้างเดิมใน `src/` เป็นจุดเริ่มต้น
- Server ผูกกับ `0.0.0.0` — คนในวงเครือข่ายเดียวกันสามารถเข้าผ่าน LAN IP ของเครื่องที่รัน server ได้
- QR log CSV แบ่งตามวันที่ `qr-logs/qr-YYYY-MM-DD.csv` — ลบไฟล์เก่ากว่า 30 วันอัตโนมัติตอน server start
