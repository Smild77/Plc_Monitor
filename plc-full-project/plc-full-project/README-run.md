# 📊 EAP Monitor — วิธีรัน

## ขั้นตอน (ทำตามลำดับ)

### 1. สลับ WiFi เข้าเครือข่ายบริษัท
(เครือข่ายเดียวกับที่ DBeaver ใช้ติด Oracle)

### 2. เริ่ม Server
วิธีที่ง่ายที่สุด — **ดับเบิ้ลคลิก** ไฟล์:
```
backend\start-server.bat
```

หรือพิมพ์ใน terminal:
```
cd backend
node eap-server.js
```

### 3. เปิดหน้าเว็บใน Browser
**หน้าทดสอบข้อมูล 2 เครื่อง (แนะนำเริ่มต้น):**
```
http://localhost:3001/test-data.html
```

**หน้าหลัก (แผนที่ + สรุปรายวัน):**
```
http://localhost:3001/
```

> ⚠️ **สำคัญ:** ต้องเปิดผ่าน `http://localhost:3001/` เท่านั้น
> ห้ามเปิดด้วยการดับเบิ้ลคลิกไฟล์ index.html ตรงๆ (จะเป็น `file://` แล้ว fetch ไม่ได้)

---

## ปัญหาที่พบและวิธีแก้

| อาการ | สาเหตุ | วิธีแก้ |
|------|------|------|
| หน้าเว็บเปิดไม่ได้ | ยังไม่รัน server | รัน `start-server.bat` |
| "Oracle connection FAILED" | ยังไม่สลับ wifi | สลับ wifi แล้ว server จะ retry ทุก 30 วิ |
| "โหลดไม่ได้" ในเว็บ | เปิดเป็น `file://` | เปิดผ่าน `http://localhost:3001/` |
| ข้อมูลไม่ขึ้น | Oracle ยังไม่ติด | รอ retry หรือเช็ค wifi |

## ทดสอบว่า Server ทำงาน
เปิดใน browser:
```
http://localhost:3001/health
```
ถ้าได้ `{"status":"ok",...}` แปลว่า server ทำงาน ✓

## ทดสอบว่า Oracle ติด
เปิดใน browser:
```
http://localhost:3001/api/lot-report?days=1
```
ถ้าได้ JSON มี `rows` แปลว่า Oracle ติดแล้ว ✓