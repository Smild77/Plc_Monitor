-- 1. สร้างตาราง History
CREATE TABLE PLC_STATUS_HISTORY (
  ID            NUMBER         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  MACHINE_ID    VARCHAR2(64)   NOT NULL,
  MACHINE_NAME  VARCHAR2(128),
  MACHINE_MODE  VARCHAR2(32),
  STATUS        VARCHAR2(32)   NOT NULL,
  PREV_STATUS   VARCHAR2(32),
  LOT_ID        VARCHAR2(64),
  JOB_NAME      VARCHAR2(128),
  ALARM_TEXT    VARCHAR2(512),
  ERROR_DETAIL  VARCHAR2(2000),
  OCCURRED_AT   TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL
);

-- 2. Index
CREATE INDEX IDX_PLC_HISTORY_MACHINE ON PLC_STATUS_HISTORY(MACHINE_ID, OCCURRED_AT DESC);
CREATE INDEX IDX_PLC_HISTORY_TIME    ON PLC_STATUS_HISTORY(OCCURRED_AT DESC);

-- 3. GRANT SELECT 4 EAP tables (รันด้วย DBA / schema owner)
-- แก้ 'INTELLIGENT_READ_PA01_PRD' เป็น user ที่ backend ใช้
GRANT SELECT ON PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL TO INTELLIGENT_READ_PA01_PRD;
GRANT SELECT ON PAEAPTRACE.EAP_EQP_ALM          TO INTELLIGENT_READ_PA01_PRD;
GRANT SELECT ON PAEAPTRACE.EAP_GUI_ERR_MSG      TO INTELLIGENT_READ_PA01_PRD;
GRANT SELECT ON DWD_PA01_PRD.LOTINFO_MAIN       TO INTELLIGENT_READ_PA01_PRD;

-- 4. GRANT INSERT ลงตาราง History (ใช้ user เดียวกันที่สร้าง table)
-- ถ้าสร้าง table ด้วย user อื่น รัน:
-- GRANT INSERT ON PLC_STATUS_HISTORY TO INTELLIGENT_READ_PA01_PRD;

-- 5. Retention — ลบข้อมูลเก่า 90 วัน (รันด้วย DBA หรือ user ที่มีสิทธิ์)
BEGIN
  DBMS_SCHEDULER.CREATE_JOB(
    job_name        => 'PLC_HISTORY_PURGE',
    job_type        => 'PLSQL_BLOCK',
    job_action      => 'BEGIN DELETE FROM PLC_STATUS_HISTORY WHERE OCCURRED_AT < SYSTIMESTAMP - 90; COMMIT; END;',
    start_date      => SYSTIMESTAMP,
    repeat_interval => 'FREQ=DAILY; BYHOUR=02; BYMINUTE=00; BYSECOND=00',
    enabled         => TRUE,
    comments        => 'Purge PLC_STATUS_HISTORY older than 90 days'
  );
END;
/

-- 6. FAULT_ZONE_MAP — สำหรับ Vendor Evidence Pack
-- ★ [สำคัญ] EAP_EQP_ALM ไม่มีคอลัมน์ fault_code (แบบ 'E-601') จริงๆ ในระบบนี้
--   ตรวจสอบด้วย list-alarm-codes.js แล้วพบว่า ALARM_TEXT เป็น free text (ส่วนใหญ่ภาษาจีน)
--   และค่าเดิมซ้ำกันเป๊ะทุกครั้งที่เกิด fault ประเภทเดียวกัน (เช่น '空載安全光柵' ขึ้นซ้ำ 2294 ครั้ง)
--   → ใช้ ALARM_TEXT (ตัดช่องว่างหัวท้าย) เป็น "รหัส fault" แทน ไม่ใช่รหัสสั้นแบบสเปกเดิม
-- MACHINE_TYPE = ชื่อรุ่นเครื่อง derive จาก MACHINE_ID ตัดเลขไลน์ + role ท้ายออก
--   เช่น 'DRL-DEP-03-M1' → machine_type 'DRL-DEP' (เครื่อง DRL-DEP-01..10 ใช้ schematic เดียวกันได้)
--   ดูสคริปต์ seed-fault-zone-map.js สำหรับวิธี derive ตัวนี้แบบเดียวกัน
CREATE TABLE FAULT_ZONE_MAP (
  MACHINE_TYPE    VARCHAR2(64)   NOT NULL,
  ALARM_TEXT      VARCHAR2(512)  NOT NULL,
  ZONE_ID         VARCHAR2(32),                 -- e.g. 'Z6' — NULL = ยังไม่ map, UI จะแสดง report โดยไม่มี schematic highlight
  ZONE_LABEL      VARCHAR2(128),                -- e.g. 'Transfer arm gripper'
  ZONE_ORDER      NUMBER         DEFAULT 0,     -- ★ ลำดับโซนตามตำแหน่งจริงบนเครื่อง (ซ้าย→ขวา ตามทิศทางที่แผ่นวิ่ง)
                                                 --   ใช้เรียงกล่องใน flow diagram ของ PDF — เลข้อยอยู่ซ้าย เช่น 10=infeed, 20=กลาง, 30=outfeed
                                                 --   เว้นเป็น 0 ได้ (จะเรียงตาม ZONE_ID แทน) แต่ diagram จะไม่สื่อทิศทางการไหลจริง
  DESCRIPTION     VARCHAR2(256),                -- คำอธิบายสั้นสำหรับโชว์ใน report (ภาษาที่ vendor อ่านได้)
  SEVERITY        VARCHAR2(16)   DEFAULT 'unknown', -- 'info' | 'warning' | 'critical' | 'unknown'
                                                 -- ★ ไม่ใช้ ALARM_CATEGORY ดิบ (มีทั้งตัวอักษรเดี่ยว/เลข/คำจีน/อังกฤษปนกัน ไม่สม่ำเสมอ)
  CAUSES          CLOB,                         -- JSON array ของ ALARM_TEXT ที่ fault นี้ "ทำให้เกิด" ตามมา เช่น ["空載安全光柵"]
  TYPICAL_CAUSE   VARCHAR2(1000),                -- สมมติฐานสาเหตุทางกายภาพ (คุณกรอกเอง)
  UPDATED_AT      TIMESTAMP      DEFAULT SYSTIMESTAMP,
  CONSTRAINT PK_FAULT_ZONE_MAP PRIMARY KEY (MACHINE_TYPE, ALARM_TEXT)
);

-- GRANT (ใช้ user เดียวกับที่สร้างตาราง — ถ้าคนละ user ต้อง GRANT INSERT/UPDATE ให้ backend user ด้วย)
-- GRANT SELECT, INSERT, UPDATE ON FAULT_ZONE_MAP TO INTELLIGENT_READ_PA01_PRD;
