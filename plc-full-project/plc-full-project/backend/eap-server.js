/**
 * eap-server.js — Standalone EAP Server (No Redis needed)
 *
 * ใช้ connect Oracle → poll → WebSocket → Frontend ตรงๆ
 *
 * วิธีรัน:
 *   1. คัดลอก Oracle credentials จาก DBeaver ใส่ .env
 *   2. cd backend
 *   3. node eap-server.js
 *
 * จากนั้นเปิด index.html ใน browser → เลือก PA01 → 1F
 */
require('dotenv').config()

const http = require('http')
const oracledb = require('oracledb')
const { WebSocketServer } = require('ws')
const os = require('os')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

/* ★ Local date helper — ใช้ local timezone แทน UTC (ป้องกันวันที่ผิดช่วง 00:00-07:00 น.)
   ใช้ใน label ของ getDateRange + getDateRangeFromParams */
function localDateStr(d) {
  d = d || new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// ★ Local date+time helper (เหมือน localDateStr แต่รวมเวลาด้วย) — ใช้เขียน timestamp ลง QR log CSV
function localDateTimeStr(d) {
  d = d || new Date();
  var hh = String(d.getHours()).padStart(2, '0');
  var mi = String(d.getMinutes()).padStart(2, '0');
  var ss = String(d.getSeconds()).padStart(2, '0');
  var ms = String(d.getMilliseconds()).padStart(3, '0');
  return localDateStr(d) + ' ' + hh + ':' + mi + ':' + ss + '.' + ms;
}

// ★ ดึง LAN IP ทั้งหมดของเครื่อง (เพื่อแสดงให้ผู้ใช้รู้ว่าต้องแชร์ URL ไหน)
function getLanIPs() {
  var ifaces = os.networkInterfaces();
  var ips = [];
  for (var name in ifaces) {
    for (var i = 0; i < ifaces[name].length; i++) {
      var addr = ifaces[name][i];
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

// ─── QR Code Log File (auto-write every new panel) ───────────
const QR_LOG_DIR = path.join(__dirname, 'qr-logs')
const QR_LOG_RETENTION_DAYS = 30

// สร้างโฟลเดอร์ qr-logs ถ้ายังไม่มี
try { if (!fs.existsSync(QR_LOG_DIR)) fs.mkdirSync(QR_LOG_DIR, { recursive: true }) } catch (e) { console.warn('[QRLog] mkdir failed:', e.message) }

// เขียน QR entry ใหม่ลงไฟล์ CSV (append mode)
// Format: timestamp,machine_id,lot_id,panel_id,is_error
function appendQrLog(machineId, lotId, panelId, isError, eventTime) {
  try {
    var d = eventTime ? new Date(eventTime) : new Date()
    // ★ [FIX] เดิมใช้ toISOString() (UTC) → เหตุการณ์ช่วง 00:00-06:59 น. เวลาไทย
    //   ถูกเขียนลงไฟล์ของ "เมื่อวาน" ด้วย timestamp ที่เลื่อนถอยหลัง 7 ชม.
    //   เปลี่ยนเป็น local time เหมือน getDateRange/getDateRangeFromParams
    var dateStr = localDateStr(d) // YYYY-MM-DD (local)
    var fileName = 'qr-' + dateStr + '.csv'
    var filePath = path.join(QR_LOG_DIR, fileName)
    // ถ้าไฟล์ใหม่ → เขียน header
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, 'timestamp,machine_id,lot_id,panel_id,is_read\n', 'utf8')
    }
    // escape comma ใน field
    var esc = function(v) { v = String(v == null ? '' : v); return v.indexOf(',') >= 0 ? '"' + v + '"' : v }
    var ts = localDateTimeStr(d)
    var line = [ts, esc(machineId), esc(lotId), esc(panelId), isError ? 'FALSE' : 'TRUE'].join(',') + '\n'
    fs.appendFile(filePath, line, 'utf8', function(err) {
      if (err) console.warn('[QRLog] append failed:', err.message)
    })
  } catch (e) {
    console.warn('[QRLog] error:', e.message)
  }
}

// ลบไฟล์ log เก่ากว่า N วัน (รันตอน start)
function purgeOldQrLogs() {
  try {
    var files = fs.readdirSync(QR_LOG_DIR)
    var now = Date.now()
    var cutoff = now - QR_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
    files.forEach(function(f) {
      if (!/^qr-\d{4}-\d{2}-\d{2}\.csv$/.test(f)) return
      var stat = fs.statSync(path.join(QR_LOG_DIR, f))
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(path.join(QR_LOG_DIR, f))
        console.log('[QRLog] purged old file:', f)
      }
    })
  } catch (e) { /* silent */ }
}

// ─── Config ───────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001')
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000')
const POLL_MINUTES = parseInt(process.env.POLL_MINUTES || '2')
// ★ ระยะเวลาที่ถือว่าเครื่อง "ไม่มีข้อมูล" (NO_DATA) — ถ้าเครื่องไม่ active ในช่วงนี้ → สีเทาจาง
// STALE_MINUTES ควร >= POLL_MINUTES (เพราะ DB query ใช้ POLL_MINUTES เป็น lookback)
const STALE_MINUTES = parseInt(process.env.STALE_MINUTES || POLL_MINUTES)

// ★ เทส: จำกัดเครื่อง (null = ทุกเครื่อง)
const ALLOWED_MACHINES = process.env.ALLOWED_MACHINES
  ? process.env.ALLOWED_MACHINES.split(',').map(s => s.trim().toUpperCase())
  : null

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
oracledb.fetchAsString = [oracledb.CLOB]

// ─── Oracle Pool ──────────────────────────────────────
let pool = null

async function getPool() {
  if (pool) return pool

  const connectString = process.env.ORACLE_CONNECTION_STRING
    || `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT || 1521}/${process.env.ORACLE_SERVICE || process.env.ORACLE_SID}`

  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString,
    poolMin: 1,
    poolMax: 3,
    poolIncrement: 1,
    poolTimeout: 60,
    stmtCacheSize: 10,
  })
  console.log(`[DB] Oracle Pool created: ${connectString}`)
  return pool
}

// ─── Date range helper (สำหรับ QR history) ─────────────────
// range: 'today' | 'yesterday' | 'week' | 'month'
// returns: { start: Date, end: Date, label: string }
function getDateRange(range) {
  var now = new Date()
  var start = new Date(now)
  var end = new Date(now)
  var label = ''
  if (range === 'today') {
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    label = localDateStr(start)
  } else if (range === 'yesterday') {
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    end.setDate(end.getDate() - 1)
    end.setHours(23, 59, 59, 999)
    label = localDateStr(start)
  } else if (range === 'week') {
    // 7 วันล่าสุด รวมวันนี้
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    label = localDateStr(start) + ' to ' + localDateStr(end)
  } else if (range === 'month') {
    // 30 วันล่าสุด รวมวันนี้
    start.setDate(start.getDate() - 29)
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    label = localDateStr(start) + ' to ' + localDateStr(end)
  } else {
    // default = today
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    label = localDateStr(start)
  }
  return { start: start, end: end, label: label }
}

// ★ สร้าง date range จาก start_date + end_date (YYYY-MM-DD strings)
// ถ้าไม่มี → default = today
function getDateRangeFromParams(startStr, endStr) {
  var now = new Date()
  var start, end, label
  if (!startStr && !endStr) {
    // default = today
    start = new Date(now); start.setHours(0, 0, 0, 0)
    end = new Date(now); end.setHours(23, 59, 59, 999)
    label = localDateStr(start)
  } else {
    // parse YYYY-MM-DD
    start = startStr ? new Date(startStr + 'T00:00:00') : new Date(now)
    if (!startStr) start.setHours(0, 0, 0, 0)
    end = endStr ? new Date(endStr + 'T23:59:59.999') : new Date(now)
    if (!endStr) end.setHours(23, 59, 59, 999)
    label = localDateStr(start) + ' to ' + localDateStr(end)
  }
  return { start: start, end: end, label: label }
}

// ─── SQL Query: รายงานสรุปยอด Panel ต่อ LOT + Alarm (สำหรับสรุปรายวัน) ───
// ใช้ query เวอร์ชัน G (ไม่ต้องมี index) จาก lot_alarm_report_noindex.sql
async function fetchLotReport(days = 7) {
  let p = await getPool()
  let conn
  try {
    conn = await p.getConnection()
  } catch (e) {
    // ★ Pool พัง → สร้างใหม่
    console.warn('[DB] Pool broken, recreating...', e.message)
    pool = null
    p = await getPool()
    conn = await p.getConnection()
  }
  try {
    const sql = `
      WITH panel_read AS (
          SELECT
              MAIN_EQP_ID,
              SUB_EQP_NAME,
              SUB_EQP_ID,
              LOT_ID,
              PANEL_ID,
              DATE_TIME,
              ROW_NUMBER() OVER (
                  PARTITION BY LOT_ID, PANEL_ID
                  ORDER BY DATE_TIME
              ) AS rn
          FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
          WHERE (SUB_EQP_ID LIKE '%-L'  OR  SUB_EQP_ID LIKE '%-UL')
            AND (DBMS_LOB.SUBSTR(PANEL_ID, 5, 1) IS NULL OR DBMS_LOB.SUBSTR(PANEL_ID, 5, 1) <> 'Error')
            AND (PANEL_ID IS NULL OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) NOT LIKE '%NULL%')
            AND DATE_TIME >= SYSDATE - :1
      ),
      lot_summary AS (
          SELECT
              MAIN_EQP_ID,
              SUB_EQP_NAME,
              SUB_EQP_ID,
              LOT_ID,
              COUNT(*)       AS total_panel_qty,
              MIN(DATE_TIME) AS lot_start_time,
              MAX(DATE_TIME) AS lot_end_time
          FROM panel_read
          WHERE rn = 1
          GROUP BY MAIN_EQP_ID, SUB_EQP_NAME, SUB_EQP_ID, LOT_ID
      ),
      lot_bounds AS (
          SELECT MIN(lot_start_time) AS global_start, MAX(lot_end_time) AS global_end
          FROM lot_summary
      ),
      eqp_list AS (
          SELECT DISTINCT MAIN_EQP_ID, SUB_EQP_ID FROM lot_summary
      ),
      alm_pre AS (
          SELECT 
              a.MAIN_EQP_ID, a.SUB_EQP_ID, a.DATE_TIME,
              a.ALARM_TEXT, a.ALARM_CATEGORY, a.EQP_STATUS
          FROM PAEAPTRACE.EAP_EQP_ALM a
          CROSS JOIN lot_bounds b
          JOIN eqp_list e
              ON  e.MAIN_EQP_ID = a.MAIN_EQP_ID
              AND e.SUB_EQP_ID  = a.SUB_EQP_ID
          WHERE a.EQP_STATUS = 'DOWN'
            AND a.DATE_TIME >= b.global_start
            AND a.DATE_TIME <= b.global_end
      )
      SELECT
          ls.MAIN_EQP_ID, ls.SUB_EQP_NAME, ls.SUB_EQP_ID, ls.LOT_ID,
          ls.total_panel_qty, ls.lot_start_time, ls.lot_end_time,
          alm.ALARM_TEXT, alm.ALARM_CATEGORY,
          alm.EQP_STATUS AS alarm_status, alm.DATE_TIME AS alarm_time
      FROM lot_summary ls
      LEFT JOIN alm_pre alm
             ON  alm.MAIN_EQP_ID = ls.MAIN_EQP_ID
             AND alm.SUB_EQP_ID  = ls.SUB_EQP_ID
             AND alm.DATE_TIME BETWEEN ls.lot_start_time AND ls.lot_end_time
      ORDER BY ls.MAIN_EQP_ID, ls.LOT_ID, alm.DATE_TIME
    `
    const result = await conn.execute(sql, [days], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    })
    return result.rows
  } finally {
    await conn.close()
  }
}

// ─── SQL Query: ดึงรายชื่อเครื่องจักรทั้งหมดจาก DB ───
async function fetchAllMachines() {
  const p = await getPool()
  const conn = await p.getConnection()
  try {
    const sql = `
      SELECT DISTINCT
        COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
        SUB_EQP_NAME AS MACHINE_NAME,
        SUB_EQP_NAME
      FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
      WHERE DATE_TIME >= SYSDATE - 1/24
      ORDER BY MACHINE_ID
    `
    const result = await conn.execute(sql, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return result.rows
  } finally {
    await conn.close()
  }
}

 // ─── SQL Query (เดียวกับที่ใช้ใน DBeaver) ───────────
 // ★ แยกเป็น 2 ส่วน:
 //   1. latest_status: ดึง status ล่าสุดของแต่ละเครื่อง (ไม่จำกัดเวลา) — รู้ status จริง
 //   2. panel_stats: ดึง panel events 15 นาทีย้อนหลัง — สำหรับ Total Sheet / % QR
 async function fetchLatestMachineStates() {
  const p = await getPool()
  const conn = await p.getConnection()
  try {
    const sql = `
      WITH latest_status AS (
        SELECT
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
          SUB_EQP_NAME,
          DATE_TIME      AS EVENT_TIME,
          PRODUCTMODE    AS MACHINE_MODE,
          EQPSTATUS      AS MACHINE_STATUS,
          LOT_ID AS LOT_ID,
          PANEL_ID       AS LAST_PANEL_ID,
          DATE_TIME      AS PANEL_TIME,
          ROW_NUMBER() OVER (PARTITION BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID) ORDER BY DATE_TIME DESC) AS rn
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= SYSDATE - 1440/1440
      ),
panel_stats AS (
        -- ★ [BUG FIX] %QR รวมทุก LOT ใน 24 ชม. (GROUP BY MACHINE_ID เท่านั้น ไม่แยก LOT)
        SELECT
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
          SUM(CASE WHEN PANEL_ID IS NOT NULL AND DBMS_LOB.GETLENGTH(PANEL_ID) > 0 AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) <> 'ERROR' AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) NOT LIKE '%NULL%' THEN 1 ELSE 0 END) AS OK_PANELS,
          SUM(CASE WHEN PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%' THEN 1 ELSE 0 END) AS ERROR_COUNT,
          MIN(DATE_TIME) AS FIRST_EVENT_TIME,
          MAX(DATE_TIME) AS LAST_EVENT_TIME
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= SYSDATE - 1440/1440
        GROUP BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID)
      ),
      lot_panel_stats AS (
        -- ★ สำหรับ fallback: %QR + Total ของแต่ละ LOT
        SELECT
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
          NVL(LOT_ID, '(no lot)') AS LOT_ID,
          SUM(CASE WHEN PANEL_ID IS NOT NULL AND DBMS_LOB.GETLENGTH(PANEL_ID) > 0 AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) <> 'ERROR' AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) NOT LIKE '%NULL%' THEN 1 ELSE 0 END) AS LOT_OK_PANELS,
          SUM(CASE WHEN PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%' THEN 1 ELSE 0 END) AS LOT_ERROR_COUNT,
          MIN(DATE_TIME) AS LOT_START_TIME,
          MAX(DATE_TIME) AS LOT_END_TIME,
          -- ★ ล่าสุดของ LOT นี้ (ใช้เพื่อเรียงลำดั้ง fallback)
          MAX(DATE_TIME) AS LOT_LAST_EVENT
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= SYSDATE - 1440/1440
          AND LOT_ID IS NOT NULL
        GROUP BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID), NVL(LOT_ID, '(no lot)')
      ),
      best_lot AS (
        -- ★ เลือก LOT ที่ดีที่สุดสำหรับแสดงผล %QR
        -- กฏ: ถ้า LOT ปัจจุบันมี panel → ใช้ LOT ปัจจุบัน
        --      ถ้า LOT ปัจจุบันยังไม่มี panel → ใช้ LOT ล่าสุดที่มี panel
        SELECT MACHINE_ID, LOT_ID, LOT_OK_PANELS, LOT_ERROR_COUNT, LOT_START_TIME, LOT_END_TIME,
               CASE WHEN LOT_ID = MAX(LOT_ID) OVER (PARTITION BY MACHINE_ID) THEN 0 ELSE 1 END AS IS_FALLBACK_LOT
        FROM (
          SELECT MACHINE_ID, LOT_ID, LOT_OK_PANELS, LOT_ERROR_COUNT, LOT_START_TIME, LOT_END_TIME, LOT_LAST_EVENT,
                 ROW_NUMBER() OVER (
                   PARTITION BY MACHINE_ID
                   ORDER BY
                     CASE WHEN LOT_OK_PANELS + LOT_ERROR_COUNT > 0 THEN 0 ELSE 1 END,
                     LOT_LAST_EVENT DESC
                 ) AS rn
          FROM lot_panel_stats
        ) WHERE rn = 1
      )
      SELECT
        E.MACHINE_ID,
        E.SUB_EQP_NAME AS MACHINE_NAME,
        E.EVENT_TIME,
        E.MACHINE_MODE,
        E.MACHINE_STATUS,
        -- ★ แสดง LOT_ID ของ best_lot (อาจเป็น LOT ปัจจุบันหรือ LOT ก่อนหน้า)
        COALESCE(BL.LOT_ID, E.LOT_ID) AS LOT_ID,
        COALESCE(BL.IS_FALLBACK_LOT, 0) AS IS_FALLBACK_LOT,
        M.SPEC_NAME     AS JOB_NAME,
        -- ★ Total Sheet + %QR รวมทุก LOT ใน 24 ชม. (วิธีที่ 2)
        P.OK_PANELS     AS TOTAL_SHEET,
        P.ERROR_COUNT   AS ERROR_SHEET,
        -- ★ LOT_START/END_TIME จาก best_lot (ถ้ามี) หรือ fallback จาก panel_stats
        COALESCE(BL.LOT_START_TIME, P.FIRST_EVENT_TIME, E.EVENT_TIME) AS LOT_START_TIME,
        COALESCE(BL.LOT_END_TIME, P.LAST_EVENT_TIME, E.EVENT_TIME)   AS LOT_END_TIME,
        CASE
          WHEN (P.OK_PANELS + P.ERROR_COUNT) = 0 OR P.OK_PANELS IS NULL THEN 0
          ELSE ROUND(P.OK_PANELS * 100.0 / (P.OK_PANELS + P.ERROR_COUNT), 2)
        END              AS PCT_QR,
        E.LAST_PANEL_ID,
        E.PANEL_TIME,
        A.ALARM_TEXT     AS ALARM_TEXT,
        A.ALARM_CATEGORY AS ALARM_CATEGORY,
        A.ALARM_TIME     AS ALARM_TIME,
        T.PN             AS PRODUCT_ID
      FROM latest_status E
      LEFT JOIN panel_stats P
        ON P.MACHINE_ID = E.MACHINE_ID
      LEFT JOIN best_lot BL
        ON BL.MACHINE_ID = E.MACHINE_ID
      LEFT JOIN (
        SELECT COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID, ALARM_TEXT, ALARM_CATEGORY,
               DATE_TIME AS ALARM_TIME,
               ROW_NUMBER() OVER (PARTITION BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID) ORDER BY DATE_TIME DESC) AS rn
        FROM PAEAPTRACE.EAP_EQP_ALM
        WHERE DATE_TIME >= SYSDATE - 30/1440
      ) A ON A.MACHINE_ID = E.MACHINE_ID
         AND A.rn = 1
      LEFT JOIN (
        SELECT COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID, PN,
               ROW_NUMBER() OVER (PARTITION BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID) ORDER BY DATE_TIME DESC) AS rn
        FROM PAEAPTRACE.EAP_EQP_TRACE
        WHERE DATE_TIME >= SYSDATE - 30/1440
          AND PN IS NOT NULL
      ) T ON T.MACHINE_ID = E.MACHINE_ID
         AND T.rn = 1
      LEFT JOIN DWD_PA01_PRD.LOTINFO_MAIN M
        ON M.LOT_NAME = E.LOT_ID
      WHERE E.rn = 1
      ORDER BY E.EVENT_TIME DESC
    `
    const result = await conn.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    })
    return result.rows.map(normalizeRow)
  } finally {
    await conn.close()
  }
}

function normalizeRow(row) {
  return {
    machine_id: String(row.MACHINE_ID || ''),
    machine_name: String(row.MACHINE_NAME || row.MACHINE_ID || ''),
    event_time: row.EVENT_TIME || null,
    machine_mode: String(row.MACHINE_MODE || 'UNKNOWN'),
    status: String(row.MACHINE_STATUS || 'UNKNOWN').toUpperCase(),
    lot_id: row.LOT_ID || null,
    is_fallback_lot: parseInt(row.IS_FALLBACK_LOT) || 0,
    job_name: row.JOB_NAME || null,
    total_sheet: parseInt(row.TOTAL_SHEET) || 0,
    error_sheet: parseInt(row.ERROR_SHEET) || 0,
    pct_qr: parseFloat(row.PCT_QR) || 0,
    alarm_text: row.ALARM_TEXT || null,
    alarm_category: row.ALARM_CATEGORY || null,
    alarm_time: row.ALARM_TIME || null,
    product_id: row.PRODUCT_ID || null,
    // [QR History] map fields so broadcast sends real values (not undefined)
    last_panel_id: row.LAST_PANEL_ID || null,
    panel_time:    row.PANEL_TIME    || null,
    // [LOT times] เวลาเริ่ม-จบ LOT ปัจจุบัน
    lot_start_time: row.LOT_START_TIME || null,
    lot_end_time:   row.LOT_END_TIME   || null,
  }
}

// ─── SQL: QR history ของเครื่องเดียว (group by LOT) ────────
// ใช้สำหรับ popup เครื่อง — แสดง PANEL_ID ทั้งหมดในช่วงเวลาที่เลือก
// ★ Forward-fill + Back-fill LOT_ID:
//   - ถ้าแผ่นปัจจุบันไม่มี LOT_ID → ดูแผ่นก่อนหน้า + ถัดไป
//   - ถ้าแผ่นก่อนหน้ามี LOT_ID → forward-fill (ใช้ของก่อนหน้า)
//   - ถ้าแผ่นถัดไปมี LOT_ID ต่างจากเดิม → back-fill (LOT ใหม่)
function fillLotIds(rows) {
  // rows มาเรียง DESC (ล่าสุดก่อน) เราจะทำงานกับเวลาจริง (ASC)
  var sorted = rows.slice().sort(function(a, b) {
    return (a.DATE_TIME || 0) - (b.DATE_TIME || 0)
  })
  function hasLot(r) {
    var lot = r.LOT_ID
    return lot && lot !== '(no lot)' && String(lot).trim() !== ''
  }
  // Pass 1: Forward-fill (อดีต → ปัจจุบัน)
  var lastLot = null
  for (var i = 0; i < sorted.length; i++) {
    if (hasLot(sorted[i])) {
      lastLot = sorted[i].LOT_ID
    } else if (lastLot) {
      // ไม่มี LOT → เช็คแผ่นถัดไปก่อนว่าเป็น LOT ใหม่ไหม
      var nextLot = null
      if (i + 1 < sorted.length && hasLot(sorted[i + 1])) {
        nextLot = sorted[i + 1].LOT_ID
      }
      if (nextLot && nextLot !== lastLot) {
        // แผ่นถัดไปเป็น LOT ใหม่ → ใช้ LOT ใหม่ (back-fill)
        sorted[i].LOT_ID = nextLot
        lastLot = nextLot
      } else {
        // ใช้ LOT เดิม (forward-fill)
        sorted[i].LOT_ID = lastLot
      }
    }
  }
  // Pass 2: Back-fill (ปัจจุบัน → อดีต) สำหรับแผ่นแรกสุดที่ยังไม่มี LOT
  for (var j = sorted.length - 1; j >= 0; j--) {
    if (!hasLot(sorted[j])) {
      if (j + 1 < sorted.length && hasLot(sorted[j + 1])) {
        sorted[j].LOT_ID = sorted[j + 1].LOT_ID
      }
    }
  }
  return sorted
}

async function fetchQrHistory(machineId, range, limit, offset, startStr, endStr) {
  const p = await getPool()
  const conn = await p.getConnection()
  try {
    const r = startStr || endStr ? getDateRangeFromParams(startStr, endStr) : getDateRange(range)
    // ★ [FIX] เดิมใช้ positional array binds ([start,end,machineId]) กับ SQL ที่มี :3 ซ้ำ 2 จุด
    //   (SUB_EQP_ID = :3 OR MAIN_EQP_ID = :3) → จำนวน placeholder ในสเตทเมนต์ (4-5 ครั้ง นับซ้ำ)
    //   ไม่ตรงกับจำนวนค่าที่ส่ง (3-4 ค่า) → NJS-098 → HTTP 500 → QR History ไม่ขึ้นเลย
    //   เปลี่ยนเป็น named bind object และตั้งชื่อไม่ซ้ำกันทุกจุดที่ปรากฏ (ค่าเดียวกัน คนละชื่อ)
    var binds = { start_date: r.start, end_date: r.end, machine1: machineId, machine2: machineId }
    var limitClause = ''
    if (limit && limit > 0) {
      limitClause = ' AND ROWNUM <= :row_limit'
      binds.row_limit = parseInt(limit) + parseInt(offset || 0)
    }
    const sql = `
      SELECT * FROM (
        SELECT
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
          NVL(LOT_ID, '(no lot)') AS LOT_ID,
          PANEL_ID,
          DATE_TIME,
          CASE WHEN PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%' THEN 0 ELSE 1 END AS IS_READ
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= :start_date
          AND DATE_TIME <= :end_date
          /* ★ [FIX] ย้าย filter เครื่องเข้ามาใน subquery
             เดิมกรองอยู่ข้างนอก → inner query สแกน panel ของ "ทุกเครื่อง" ทั้งช่วงเวลา
             แล้วค่อย sort ทำให้วันย้อนหลัง (ข้อมูลเต็ม 24 ชม.) ช้าจนหมดเวลา */
          AND (SUB_EQP_ID = :machine1 OR (SUB_EQP_ID IS NULL AND MAIN_EQP_ID = :machine2))
        ORDER BY DATE_TIME DESC
      )
      WHERE 1 = 1
        ${limitClause}
    `
    const result = await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })
    var rows = result.rows || []
    // apply offset (manual since we use ROWNUM)
    if (offset && offset > 0) rows = rows.slice(offset)
    // ★ Fill LOT_ID (forward-fill + back-fill)
    rows = fillLotIds(rows)
    // group by LOT_ID
    var lotsMap = new Map()
    var totalOk = 0, totalErr = 0
    rows.forEach(function(r) {
      var lotId = r.LOT_ID || '(no lot)'
      if (!lotsMap.has(lotId)) {
        lotsMap.set(lotId, { lot_id: lotId, panels: [], ok_count: 0, err_count: 0 })
      }
      var lot = lotsMap.get(lotId)
      // ★ compute lot_start_time (oldest) and lot_end_time (newest)
      if (!lot.lot_start_time || r.DATE_TIME < lot.lot_start_time) lot.lot_start_time = r.DATE_TIME
      if (!lot.lot_end_time || r.DATE_TIME > lot.lot_end_time) lot.lot_end_time = r.DATE_TIME
      lot.panels.push({
        panel_id: r.PANEL_ID,
        time: r.DATE_TIME,
        is_error: r.IS_READ !== 1
      })
      if (r.IS_READ !== 1) { lot.err_count++; totalErr++ } else { lot.ok_count++; totalOk++ }
    })
    var lots = Array.from(lotsMap.values()).sort(function(a, b) {
      // sort by latest panel time desc
      var at = a.panels[0] ? a.panels[0].time : 0
      var bt = b.panels[0] ? b.panels[0].time : 0
      return bt - at
    })
    return {
      machine_id: machineId,
      range: range,
      label: r.label,
      lots: lots,
      summary: {
        total_panels: totalOk + totalErr,
        ok: totalOk,
        err: totalErr,
        pct_qr: (totalOk + totalErr) > 0 ? Math.round(totalOk * 1000 / (totalOk + totalErr)) / 10 : 0
      }
    }
  } finally {
    await conn.close()
  }
}

// ─── SQL: % QR หลายวันของเครื่องเดียว (ตารางใน popup) ───────
async function fetchQrDaily(machineId, range, startStr, endStr) {
  const p = await getPool()
  const conn = await p.getConnection()
  try {
    const r = startStr || endStr ? getDateRangeFromParams(startStr, endStr) : getDateRange(range)
    const sql = `
      SELECT * FROM (
        SELECT
          TRUNC(DATE_TIME) AS QR_DAY,
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MID,
          COUNT(*) AS TOTAL_CNT,
          SUM(CASE WHEN PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%' THEN 1 ELSE 0 END) AS ERR_CNT,
          SUM(CASE WHEN PANEL_ID IS NOT NULL AND DBMS_LOB.GETLENGTH(PANEL_ID) > 0 AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) <> 'ERROR' AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) NOT LIKE '%NULL%' THEN 1 ELSE 0 END) AS OK_CNT
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= :1
          AND DATE_TIME <= :2
        GROUP BY TRUNC(DATE_TIME), COALESCE(SUB_EQP_ID, MAIN_EQP_ID)
      )
      WHERE MID = :3
      ORDER BY QR_DAY DESC
    `
    const result = await conn.execute(sql, [r.start, r.end, machineId], { outFormat: oracledb.OUT_FORMAT_OBJECT })
    var days = (result.rows || []).map(function(r) {
      var total = r.TOTAL_CNT || 0
      var ok = r.OK_CNT || 0
      var err = r.ERR_CNT || 0
      return {
        /* ★ [FIX] เดิมใช้ toISOString() ซึ่งแปลงเป็น UTC → วันเลื่อนถอยหลัง 1 วัน
           (Oracle คืน 2026-08-09 00:00 local → toISOString ได้ 2026-08-08T17:00Z)
           ใช้ localDateStr() แทนเพื่อคง timezone เดิม */
        date: r.QR_DAY instanceof Date ? localDateStr(r.QR_DAY) : String(r.QR_DAY),
        total: total,
        ok: ok,
        err: err,
        pct_qr: total > 0 ? Math.round(ok * 1000 / total) / 10 : 0
      }
    })
    var grandTotal = days.reduce(function(s, d) { return s + d.total }, 0)
    var grandOk = days.reduce(function(s, d) { return s + d.ok }, 0)
    var grandErr = days.reduce(function(s, d) { return s + d.err }, 0)
    return {
      machine_id: machineId,
      range: range,
      label: r.label,
      days: days,
      grand_total: grandTotal,
      grand_ok: grandOk,
      grand_err: grandErr,
      grand_pct_qr: grandTotal > 0 ? Math.round(grandOk * 1000 / grandTotal) / 10 : 0
    }
  } finally {
    await conn.close()
  }
}

// ─── SQL: ประวัติสถานะเครื่องเดียว (EQPSTATUS) ทั้งวัน ───────
/* ★ [PERF] In-memory cache for status-history (alarm_text)
   - TTL 30s, max 100 entries (FIFO eviction)
*/
const STATUS_HIST_CACHE_TTL_MS = 30 * 1000
const STATUS_HIST_CACHE_MAX = 100
const statusHistoryCache = new Map()

function statusHistCacheKey(machineId, range, startStr, endStr, alarmCategory) {
  /* ★ [FIX] ต้องรวม alarmCategory ด้วย ไม่งั้น cache ของ category หนึ่งจะไปทับอีก category */
  return machineId + '|' + (range || 'today') + '|' + (startStr || '') + '|' + (endStr || '') + '|' + (alarmCategory || 'all')
}

function getStatusHistCache(key) {
  const entry = statusHistoryCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) { statusHistoryCache.delete(key); return null }
  return entry.data
}

function setStatusHistCache(key, data) {
  if (statusHistoryCache.size >= STATUS_HIST_CACHE_MAX) {
    const firstKey = statusHistoryCache.keys().next().value
    if (firstKey) statusHistoryCache.delete(firstKey)
  }
  statusHistoryCache.set(key, { data: data, expiresAt: Date.now() + STATUS_HIST_CACHE_TTL_MS })
}

async function fetchStatusHistory(machineId, range, startStr, endStr, limit, offset, alarmCategory) {
  const r = startStr || endStr ? getDateRangeFromParams(startStr, endStr) : getDateRange(range)
  // ★ [PERF v2] ดึง latest status จาก snapshot ใน memory (ไม่ต้อง query Oracle!)
  //   - snapshot ถูก update ทุก 5s โดย poller
  //   - เป็นข้อมูลเดียวกับที่เห็นบน marker แผนผัง
  //   - ประหยัด 2-3 วินาที Oracle query (CTE + 3 JOINs)
  // ★ [PERF] check cache first
  const almCat = alarmCategory || 'all'
  const cacheKey = statusHistCacheKey(machineId, range, startStr, endStr, almCat)
  const cached = getStatusHistCache(cacheKey)
  if (cached) {
    console.log('[StatusHist] ✓ CACHE HIT for ' + machineId)
    const lim = limit != null ? parseInt(limit, 10) : 50
    const off = offset != null ? parseInt(offset, 10) : 0
    return {
      ...cached,
      events: cached.events.slice(off, off + lim),
      total: cached.events.length,
      offset: off,
      limit: lim,
      cached: true
    }
  }
  const t0 = Date.now()
  /* ★ [FIX] snapshot = สถานะ "ปัจจุบัน" ใช้ได้เฉพาะตอน range ครอบคลุมวันนี้เท่านั้น
     เดิมใส่ลง events เสมอ → เลือกวันย้อนหลังก็ยังเห็น event ของวันนี้โผล่มา */
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const isLiveRange = r.end >= todayStart
  const snap = isLiveRange ? snapshot[machineId] : null
  var latestEvent = null
  if (snap) {
    latestEvent = {
      type: 'event',
      machine_id: snap.machine_id,
      machine_name: snap.machine_name,
      event_time: snap.event_time instanceof Date ? snap.event_time.toISOString() : (snap.event_time || new Date().toISOString()),
      status: snap.status,
      machine_mode: snap.machine_mode,
      lot_id: snap.lot_id || '(no lot)',
      total_sheet: snap.total_sheet,
      error_sheet: snap.error_sheet,
      pct_qr: snap.pct_qr,
      alarm_text: null,
      alarm_category: null,
      product_id: snap.product_id
    }
  }
  console.log('[StatusHist] ✓ Snapshot lookup for ' + machineId + ': ' + (latestEvent ? 'HIT' : 'MISS') + ' (live=' + isLiveRange + ', ' + (Date.now() - t0) + 'ms)')
  var events = latestEvent ? [latestEvent] : []

    /* ★ Query 2: ดึง alarm ทั้งหมดของเครื่อง (history ครบทุกอัน)
       - ใช้ UNION ALL รวม events + alarms ใน query เดียว (เร็วกว่า 2 queries แยก)
       - ลด connection round-trip */
  // ★ [PERF v2] ได้ Oracle connection เฉพาะ Query 2 (alarms) เท่านั้น
  const p = await getPool()
  const conn = await p.getConnection()
  try {
    /* ★ [FIX] โหมดย้อนหลัง (range ไม่ครอบวันนี้) → ต้อง query event จริงจาก DB
       เดิมไม่มี query นี้เลย ทำให้ Status History ของวันย้อนหลังว่างเปล่า */
    if (!isLiveRange) {
      const evLimit = limit != null ? parseInt(limit, 10) : 50
      const evSql = `
        SELECT * FROM (
          SELECT
            DATE_TIME    AS EVENT_TIME,
            EQPSTATUS    AS MACHINE_STATUS,
            PRODUCTMODE  AS MACHINE_MODE,
            LOT_ID       AS LOT_ID
          FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
          WHERE DATE_TIME >= :start_date
            AND DATE_TIME <= :end_date
            AND (SUB_EQP_ID = :machine_id1 OR (SUB_EQP_ID IS NULL AND MAIN_EQP_ID = :machine_id2))
          ORDER BY DATE_TIME DESC
        )
        WHERE ROWNUM <= :ev_limit
      `
      try {
        /* ★ [FIX] เดิม bind :machine_id ซ้ำ 2 จุด ด้วยชื่อเดียวกัน → NJS-098 (placeholder นับซ้ำ
           ไม่ตรงกับจำนวนค่า unique) → error ถูก catch เงียบๆ ด้านล่าง ทำให้ Status History
           ของวันย้อนหลังว่างเปล่าโดยไม่มี error ให้เห็น ต้องตั้งชื่อ bind ไม่ให้ซ้ำ */
        const evResult = await conn.execute(evSql, {
          start_date: r.start,
          end_date: r.end,
          machine_id1: machineId,
          machine_id2: machineId,
          ev_limit: evLimit
        }, { outFormat: oracledb.OUT_FORMAT_OBJECT })
        const evRows = (evResult.rows || []).map(function(row) {
          return {
            type: 'event',
            machine_id: machineId,
            machine_name: null,
            event_time: row.EVENT_TIME instanceof Date ? row.EVENT_TIME.toISOString() : String(row.EVENT_TIME),
            status: row.MACHINE_STATUS,
            machine_mode: row.MACHINE_MODE,
            lot_id: row.LOT_ID || '(no lot)',
            total_sheet: null,
            error_sheet: null,
            pct_qr: null,
            alarm_text: null,
            alarm_category: null,
            product_id: null
          }
        })
        events = events.concat(evRows)
        console.log('[StatusHist] historical events for ' + machineId + ' [' + r.label + ']: ' + evRows.length)
      } catch (evErr) {
        console.warn('[StatusHist] historical event query failed:', evErr.message)
      }
    }

    const almSql = `
      SELECT * FROM (
        SELECT
          'alarm' AS TYPE,
          NULL AS MACHINE_STATUS,
          NULL AS MACHINE_MODE,
          NULL AS LOT_ID,
          NULL AS TOTAL_SHEET,
          NULL AS ERROR_SHEET,
          NULL AS PCT_QR,
          NULL AS PRODUCT_ID,
          ALARM_TEXT,
          ALARM_CATEGORY,
          DATE_TIME AS EVENT_TIME
        FROM PAEAPTRACE.EAP_EQP_ALM
        WHERE DATE_TIME >= :start_date
          AND DATE_TIME <= :end_date
          AND (
            COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = :machine_id1
            OR MAIN_EQP_ID = :machine_id2
            OR SUB_EQP_ID = :machine_id3
          )
          /* ★ Filter by alarm category if specified (K/P/G) */
          AND (:alm_category1 = 'all' OR ALARM_CATEGORY = :alm_category2)
        ORDER BY DATE_TIME DESC
      )
      WHERE ROWNUM <= :alm_limit
    `
    var alarms = []
    try {
      const almLimit = limit != null ? parseInt(limit, 10) : 50
      /* ★ [FIX] เดิม bind :machine_id ซ้ำ 3 จุด และ :alm_category ซ้ำ 2 จุด ด้วยชื่อเดียวกัน
         → NJS-098 → error ถูก catch เงียบๆ ด้านล่าง ทำให้ alarm history ว่างเปล่าโดยไม่มี error
         ต้องตั้งชื่อ bind ไม่ให้ซ้ำกันทุกจุดที่ปรากฏ */
      const almBinds = {
        start_date: r.start,
        end_date: r.end,
        machine_id1: machineId,
        machine_id2: machineId,
        machine_id3: machineId,
        alm_category1: almCat,
        alm_category2: almCat,
        alm_limit: almLimit
      }
      const almResult = await conn.execute(almSql, almBinds, { outFormat: oracledb.OUT_FORMAT_OBJECT })
      alarms = (almResult.rows || []).map(function(r) {
        return {
          type: 'alarm',
          event_time: r.EVENT_TIME instanceof Date ? r.EVENT_TIME.toISOString() : String(r.EVENT_TIME),
          status: 'ALARM',
          alarm_text: r.ALARM_TEXT,
          alarm_category: r.ALARM_CATEGORY,
          lot_id: null,
          machine_mode: null,
          total_sheet: null,
          error_sheet: null,
          pct_qr: null,
          product_id: null
        }
      })
    } catch(almErr) {
      console.warn('[StatusHist] alarm query failed:', almErr.message)
    }

    /* ★ รวม events + alarms เป็น list เดียว เรียงตามเวลา DESC */
    var allItems = events.concat(alarms)
    allItems.sort(function(a, b) {
      var at = new Date(a.event_time).getTime()
      var bt = new Date(b.event_time).getTime()
      return bt - at
    })

    var alarmsTotal = alarms.length
    console.log('[StatusHist] ' + machineId + ' [' + r.label + ']: ' + events.length + ' events, ' + alarmsTotal + ' alarms, total=' + (Date.now() - t0) + 'ms')

    const fullResult = {
      machine_id: machineId,
      range: range,
      label: r.label,
      total: allItems.length,
      events_count: events.length,
      alarms_total: alarmsTotal,
      events: allItems
    }
    // ★ [PERF] store in cache
    setStatusHistCache(cacheKey, fullResult)
    // Apply pagination
    const off = offset != null ? parseInt(offset, 10) : 0
    const paged = allItems.slice(off, off + (limit != null ? parseInt(limit, 10) : 50))
    return { ...fullResult, events: paged, offset: off, cached: false }
  } finally {
    await conn.close()
  }
}


async function fetchQrSummary(range, startStr, endStr) {
  const p = await getPool()
  const conn = await p.getConnection()
  try {
    const r = startStr || endStr ? getDateRangeFromParams(startStr, endStr) : getDateRange(range)
    const sql = `
      SELECT
        COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
        MAX(SUB_EQP_NAME) AS MACHINE_NAME,
        COUNT(*) AS TOTAL_CNT,
        SUM(CASE WHEN PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%' THEN 1 ELSE 0 END) AS ERR_CNT,
        SUM(CASE WHEN PANEL_ID IS NOT NULL AND DBMS_LOB.GETLENGTH(PANEL_ID) > 0 AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) <> 'ERROR' AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) NOT LIKE '%NULL%' THEN 1 ELSE 0 END) AS OK_CNT
      FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
      WHERE DATE_TIME >= :1
        AND DATE_TIME <= :2
      GROUP BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID)
      ORDER BY TOTAL_CNT DESC
    `
    const result = await conn.execute(sql, [r.start, r.end], { outFormat: oracledb.OUT_FORMAT_OBJECT })
    var byMachine = (result.rows || []).map(function(r) {
      var total = r.TOTAL_CNT || 0
      var ok = r.OK_CNT || 0
      var err = r.ERR_CNT || 0
      return {
        machine_id: r.MACHINE_ID,
        machine_name: r.MACHINE_NAME || r.MACHINE_ID,
        total: total,
        ok: ok,
        err: err,
        pct_qr: total > 0 ? Math.round(ok * 1000 / total) / 10 : 0
      }
    })
    var grandTotal = byMachine.reduce(function(s, m) { return s + m.total }, 0)
    var grandOk = byMachine.reduce(function(s, m) { return s + m.ok }, 0)
    var grandErr = byMachine.reduce(function(s, m) { return s + m.err }, 0)
    return {
      range: range,
      label: r.label,
      overall: {
        total: grandTotal,
        ok: grandOk,
        err: grandErr,
        pct_qr: grandTotal > 0 ? Math.round(grandOk * 1000 / grandTotal) / 10 : 0,
        machine_count: byMachine.length
      },
      by_machine: byMachine
    }
  } finally {
    await conn.close()
  }
}

// ─── ดึงสถานะเครื่องย้อนหลังตามวันที่ ─────────────────────────
// ใช้สำหรับหน้าเครื่อง (Machine Info) เวลา user เลือกดูข้อมูลย้อนหลัง
// cache ฝั่ง server 5 นาที (ข้อมูลย้อนหลังไม่เปลี่ยน)
const MACHINE_HIST_CACHE_TTL_MS = 5 * 60 * 1000
const MACHINE_HIST_CACHE_MAX = 200
const machineHistoryCache = new Map()

function machineHistCacheKey(machineId, dateStr) {
  return machineId + '|' + (dateStr || '')
}

function getMachineHistCache(key) {
  const entry = machineHistoryCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    machineHistoryCache.delete(key)
    return null
  }
  return entry.data
}

function setMachineHistCache(key, data) {
  if (machineHistoryCache.size >= MACHINE_HIST_CACHE_MAX) {
    const firstKey = machineHistoryCache.keys().next().value
    if (firstKey) machineHistoryCache.delete(firstKey)
  }
  machineHistoryCache.set(key, { data: data, expiresAt: Date.now() + MACHINE_HIST_CACHE_TTL_MS })
}

async function fetchMachineHistory(machineId, dateStr) {
  // check cache ก่อน
  const cacheKey = machineHistCacheKey(machineId, dateStr)
  const cached = getMachineHistCache(cacheKey)
  if (cached) {
    console.log('[MachineHistory] cache hit:', cacheKey)
    return cached
  }

  const p = await getPool()
  const conn = await p.getConnection()
  try {
    const r = getDateRangeFromParams(dateStr, dateStr)
    // ★ ใช้รูปแบบเดียวกับ fetchLatestMachineStates แต่กรองเฉพาะเครื่อง + วันที่
    //   ไม่ aggregate PANEL_ID ด้วย MAX() เพราะเป็น CLOB → ใช้ ROW_NUMBER แทน
    const sql = `
      WITH latest_status AS (
        SELECT
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
          SUB_EQP_NAME,
          DATE_TIME      AS EVENT_TIME,
          PRODUCTMODE    AS MACHINE_MODE,
          EQPSTATUS      AS MACHINE_STATUS,
          LOT_ID         AS LOT_ID,
          PANEL_ID       AS LAST_PANEL_ID,
          DATE_TIME      AS PANEL_TIME,
          ROW_NUMBER() OVER (PARTITION BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID) ORDER BY DATE_TIME DESC) AS rn
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= :ls_start
          AND DATE_TIME <= :ls_end
          AND (SUB_EQP_ID = :ls_machine1 OR (SUB_EQP_ID IS NULL AND MAIN_EQP_ID = :ls_machine2))
      ),
      panel_stats AS (
        SELECT
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
          SUM(CASE WHEN PANEL_ID IS NOT NULL AND DBMS_LOB.GETLENGTH(PANEL_ID) > 0 AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) <> 'ERROR' AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) NOT LIKE '%NULL%' THEN 1 ELSE 0 END) AS OK_PANELS,
          SUM(CASE WHEN PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%' THEN 1 ELSE 0 END) AS ERROR_COUNT,
          MIN(DATE_TIME) AS FIRST_EVENT_TIME,
          MAX(DATE_TIME) AS LAST_EVENT_TIME
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= :ps_start
          AND DATE_TIME <= :ps_end
          AND (SUB_EQP_ID = :ps_machine1 OR (SUB_EQP_ID IS NULL AND MAIN_EQP_ID = :ps_machine2))
        GROUP BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID)
      ),
      lot_panel_stats AS (
        SELECT
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
          NVL(LOT_ID, '(no lot)') AS LOT_ID,
          SUM(CASE WHEN PANEL_ID IS NOT NULL AND DBMS_LOB.GETLENGTH(PANEL_ID) > 0 AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) <> 'ERROR' AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) NOT LIKE '%NULL%' THEN 1 ELSE 0 END) AS LOT_OK_PANELS,
          SUM(CASE WHEN PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%' THEN 1 ELSE 0 END) AS LOT_ERROR_COUNT,
          MIN(DATE_TIME) AS LOT_START_TIME,
          MAX(DATE_TIME) AS LOT_END_TIME,
          MAX(DATE_TIME) AS LOT_LAST_EVENT
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= :lps_start
          AND DATE_TIME <= :lps_end
          AND (SUB_EQP_ID = :lps_machine1 OR (SUB_EQP_ID IS NULL AND MAIN_EQP_ID = :lps_machine2))
          AND LOT_ID IS NOT NULL
        GROUP BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID), NVL(LOT_ID, '(no lot)')
      ),
      best_lot AS (
        SELECT MACHINE_ID, LOT_ID, LOT_OK_PANELS, LOT_ERROR_COUNT, LOT_START_TIME, LOT_END_TIME,
               CASE WHEN LOT_ID = MAX(LOT_ID) OVER (PARTITION BY MACHINE_ID) THEN 0 ELSE 1 END AS IS_FALLBACK_LOT
        FROM (
          SELECT MACHINE_ID, LOT_ID, LOT_OK_PANELS, LOT_ERROR_COUNT, LOT_START_TIME, LOT_END_TIME, LOT_LAST_EVENT,
                 ROW_NUMBER() OVER (
                   PARTITION BY MACHINE_ID
                   ORDER BY
                     CASE WHEN LOT_OK_PANELS + LOT_ERROR_COUNT > 0 THEN 0 ELSE 1 END,
                     LOT_LAST_EVENT DESC
                 ) AS rn
          FROM lot_panel_stats
        ) WHERE rn = 1
      )
      SELECT
        E.MACHINE_ID,
        E.SUB_EQP_NAME AS MACHINE_NAME,
        E.EVENT_TIME,
        E.MACHINE_MODE,
        E.MACHINE_STATUS,
        COALESCE(BL.LOT_ID, E.LOT_ID) AS LOT_ID,
        COALESCE(BL.IS_FALLBACK_LOT, 0) AS IS_FALLBACK_LOT,
        M.SPEC_NAME     AS JOB_NAME,
        P.OK_PANELS     AS TOTAL_SHEET,
        P.ERROR_COUNT   AS ERROR_SHEET,
        COALESCE(BL.LOT_START_TIME, P.FIRST_EVENT_TIME, E.EVENT_TIME) AS LOT_START_TIME,
        COALESCE(BL.LOT_END_TIME, P.LAST_EVENT_TIME, E.EVENT_TIME)   AS LOT_END_TIME,
        CASE
          WHEN (P.OK_PANELS + P.ERROR_COUNT) = 0 OR P.OK_PANELS IS NULL THEN 0
          ELSE ROUND(P.OK_PANELS * 100.0 / (P.OK_PANELS + P.ERROR_COUNT), 2)
        END              AS PCT_QR,
        E.LAST_PANEL_ID,
        E.PANEL_TIME,
        A.ALARM_TEXT     AS ALARM_TEXT,
        A.ALARM_CATEGORY AS ALARM_CATEGORY,
        A.ALARM_TIME     AS ALARM_TIME,
        T.PN             AS PRODUCT_ID
      FROM latest_status E
      LEFT JOIN panel_stats P
        ON P.MACHINE_ID = E.MACHINE_ID
      LEFT JOIN best_lot BL
        ON BL.MACHINE_ID = E.MACHINE_ID
      LEFT JOIN (
        SELECT COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID, ALARM_TEXT, ALARM_CATEGORY,
               DATE_TIME AS ALARM_TIME,
               ROW_NUMBER() OVER (PARTITION BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID) ORDER BY DATE_TIME DESC) AS rn
        FROM PAEAPTRACE.EAP_EQP_ALM
        WHERE DATE_TIME >= :alm_start
          AND DATE_TIME <= :alm_end
          AND (SUB_EQP_ID = :alm_machine1 OR (SUB_EQP_ID IS NULL AND MAIN_EQP_ID = :alm_machine2))
      ) A ON A.MACHINE_ID = E.MACHINE_ID
         AND A.rn = 1
      LEFT JOIN (
        SELECT COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID, PN,
               ROW_NUMBER() OVER (PARTITION BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID) ORDER BY DATE_TIME DESC) AS rn
        FROM PAEAPTRACE.EAP_EQP_TRACE
        WHERE DATE_TIME >= :trc_start
          AND DATE_TIME <= :trc_end
          AND (SUB_EQP_ID = :trc_machine1 OR (SUB_EQP_ID IS NULL AND MAIN_EQP_ID = :trc_machine2))
          AND PN IS NOT NULL
      ) T ON T.MACHINE_ID = E.MACHINE_ID
         AND T.rn = 1
      LEFT JOIN DWD_PA01_PRD.LOTINFO_MAIN M
        ON M.LOT_NAME = COALESCE(BL.LOT_ID, E.LOT_ID)
      WHERE E.rn = 1
    `
    /* ★ [FIX] เดิมใช้ positional bind แบบ array (:1-:15) → เปลี่ยนเป็น named bind แบบ object
       ★ [FIX 2] แต่ละเงื่อนไข (SUB_EQP_ID = :x OR MAIN_EQP_ID = :x) เดิมใช้ชื่อ bind เดียวกันซ้ำ 2 ครั้ง
       (เช่น :ls_machine ปรากฏ 2 ที่) ทำให้ node-oracledb นับจำนวน placeholder ในสเตทเมนต์ (20 ครั้ง
       รวมของซ้ำ) ไม่ตรงกับจำนวนค่าที่ส่งมา (15 ชื่อ unique) → NJS-098
       แก้โดยตั้งชื่อ bind ให้ไม่ซ้ำกันทุกจุดที่ปรากฏ (ค่าเดียวกัน คนละชื่อ) */
    const binds = {
      ls_start: r.start,  ls_end: r.end,  ls_machine1: machineId,  ls_machine2: machineId,   // latest_status
      ps_start: r.start,  ps_end: r.end,  ps_machine1: machineId,  ps_machine2: machineId,   // panel_stats
      lps_start: r.start, lps_end: r.end, lps_machine1: machineId, lps_machine2: machineId,  // lot_panel_stats
      alm_start: r.start, alm_end: r.end, alm_machine1: machineId, alm_machine2: machineId,  // alarm join
      trc_start: r.start, trc_end: r.end, trc_machine1: machineId, trc_machine2: machineId,  // product/trace join
    }
    const t0 = Date.now()
    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    })
    const elapsed = Date.now() - t0
    const rows = (result.rows || []).map(normalizeRow)
    console.log('[MachineHistory] query ' + machineId + ' @ ' + dateStr + ' took ' + elapsed + 'ms, rows=' + rows.length)

    const data = rows.length === 0
      ? { machine_id: machineId, date: dateStr, found: false, state: null, label: r.label }
      : { machine_id: machineId, date: dateStr, found: true, state: rows[0], label: r.label }

    // เก็บ cache (รวมผล not found — ไม่เปลี่ยนอยู่แล้ว)
    setMachineHistCache(cacheKey, data)
    return data
  } finally {
    await conn.close()
  }
}

// ─── Snapshot & Change Detection ──────────────────────
let snapshot = {}
let isPolling = false
let pollTimer = null

function hasChanged(prev, curr) {
  if (!prev) return true
  return (
    prev.status !== curr.status ||
    prev.alarm_text !== curr.alarm_text ||
    prev.error_detail !== curr.error_detail ||
    prev.machine_mode !== curr.machine_mode ||
    prev.lot_id !== curr.lot_id ||
    prev.last_panel_id !== curr.last_panel_id
  )
}

async function poll() {
  if (isPolling) return
  isPolling = true
  try {
    // Timeout 15 วินาที — ถ้า query ช้าเกิน ให้ unlock
    const timeout = setTimeout(() => { console.warn('[Poll] Timeout 15s — unlock') }, 15000)

    const rows = await fetchLatestMachineStates()
    clearTimeout(timeout)

    // Group by machine_id — เอา event ล่าสุด
    const latest = new Map()
    for (const r of rows) {
      // ★ Filter เฉพาะเครื่องที่กำหนด
      if (ALLOWED_MACHINES && !ALLOWED_MACHINES.includes((r.machine_id || '').toUpperCase())) continue
      if (/-M[12]$/.test(r.machine_id)) continue
      if (!latest.has(r.machine_id)) latest.set(r.machine_id, r)
    }

    const changed = []
    for (const [id, curr] of latest) {
      const prev = snapshot[id]
      if (hasChanged(prev, curr)) {
        changed.push({ ...curr, prev_status: prev?.status || null })
      }
      snapshot[id] = { ...curr }
    }

    // ★ เช็คเครื่องที่ "หายไป" จากผลลัพธ์ (ไม่ active ใน POLL_MINUTES) → ตั้ง NO_DATA
    // snapshot เป็น plain object {} ต้องใช้ Object.entries() ไม่ใช่ for...of ตรงๆ
    for (const [id, prev] of Object.entries(snapshot)) {
      if (latest.has(id)) continue            // ยัง active → ข้าม
      if (prev.status === 'NO_DATA') continue // อยู่ใน NO_DATA อยู่แล้ว → ข้าม
      // เครื่องนี้ไม่มี LOT_ID ล่าสุด → NO_DATA (clear ข้อมูลตัวเลข)
      const noData = {
        machine_id: id,
        machine_name: prev.machine_name || id,
        event_time: null,
        machine_mode: 'NO_DATA',
        status: 'NO_DATA',
        prev_status: prev.status,
        lot_id: null,
        is_fallback_lot: 0,
        job_name: null,
        total_sheet: 0,
        error_sheet: 0,
        pct_qr: 0,
        alarm_text: null,
        alarm_category: null,
        alarm_time: null,
        error_detail: null,
        product_id: null,
        last_panel_id: null,
        panel_time: null,
        lot_start_time: null,
        lot_end_time: null,
      }
      changed.push(noData)
      snapshot[id] = noData
    }

    if (changed.length > 0) {
      console.log(`[Poll] ${changed.length} machine(s) changed`)
      for (const m of changed) {
        broadcast({
          type: 'MACHINE_STATUS_CHANGE',
          severity: m.alarm_text ? 'critical' : m.status === 'DOWN' ? 'critical' : m.status === 'IDLE' ? 'info' : m.status === 'NO_DATA' ? 'no_data' : 'ok',
          timestamp: new Date().toISOString(),
          machine_id: m.machine_id,
          machine_name: m.machine_name,
          event_time: m.event_time,
          machine_mode: m.machine_mode,
          status: m.status,
          prev_status: m.prev_status,
          lot_id: m.lot_id,
        is_fallback_lot: m.is_fallback_lot,
          job_name: m.job_name,
          total_sheet: m.total_sheet,
          error_sheet: m.error_sheet,
          pct_qr: m.pct_qr,
          last_panel_id: m.last_panel_id,
          panel_time: m.panel_time,
          lot_start_time: m.lot_start_time,
          lot_end_time: m.lot_end_time,
          alarm_text: m.alarm_text,
          alarm_category: m.alarm_category,
          alarm_time: m.alarm_time,
          error_detail: m.error_detail,
          product_id: m.product_id,
        })
        // ★ Auto-log QR ลงไฟล์ CSV (บันทึกทุก panel รวม null/error/empty)
        // is_read = FALSE ถ้า panel_id ขึ้นต้นด้วย Error, เป็น null/empty, หรือมีคำว่า NULL อยู่ในค่า (เช่น "[NULL]")
        // is_read = TRUE ถ้า panel_id ปกติ (อ่านได้)
        var panelIdForLog = m.last_panel_id || '';
        var isErrorForLog = !panelIdForLog || String(panelIdForLog).indexOf('Error') === 0 || String(panelIdForLog).trim() === '' || /NULL/i.test(String(panelIdForLog));
        appendQrLog(m.machine_id, m.lot_id, panelIdForLog, isErrorForLog, m.panel_time || m.event_time)
      }
    }
  } catch (err) {
    console.error('[Poll] Error:', err.message)
  } finally {
    isPolling = false
  }
}

let pollingStarted = false
function startPolling() {
  if (pollingStarted) return
  pollingStarted = true
  if (ALLOWED_MACHINES) {
    console.log(`[Poll] ★ FILTER: ${ALLOWED_MACHINES.length} machine(s): ${ALLOWED_MACHINES.join(', ')}`)
  }
  console.log(`[Poll] Started — every ${POLL_INTERVAL_MS}ms, last ${POLL_MINUTES} min`)
  poll() // first poll immediately
  pollTimer = setInterval(poll, POLL_INTERVAL_MS)
}

// ─── WebSocket (no Redis) ─────────────────────────────
const clients = new Set()

function broadcast(data) {
  const msg = JSON.stringify(data)
  for (const ws of clients) {
    try {
      if (ws.readyState === ws.OPEN) ws.send(msg)
    } catch { clients.delete(ws) }
  }
}

// ─── HTTP + WS Server ─────────────────────────────────
const frontendDir = path.join(__dirname, '..', 'frontend')

/* ★ [PERF] gzip JSON responses — ลดขนาด ~70% */
function sendJson(res, data) {
  var json = JSON.stringify(data)
  var acceptEnc = (res.req && res.req.headers && res.req.headers['accept-encoding']) || ''
  if (acceptEnc.indexOf('gzip') >= 0 && json.length > 1024) {
    var buf = zlib.gzipSync(json)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': buf.length })
    res.end(buf)
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(json)
  }
}

const MIME = { '.html':'text/html; charset=utf-8', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.ico':'image/x-icon', '.js':'text/javascript', '.css':'text/css' }

const app = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  // ★ Serve frontend (เปิดผ่าน http://localhost:3001 แทน file://)
  const urlPath = req.url.split('?')[0]
  if (urlPath === '/' || urlPath === '/index.html') {
    try {
      const html = fs.readFileSync(path.join(frontendDir, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    } catch {}
  }
  // Static assets (.jpg, .png, .js, .css)
  const ext = path.extname(urlPath).toLowerCase()
  if (MIME[ext]) {
    const filePath = path.join(frontendDir, urlPath)
    if (filePath.startsWith(frontendDir) && fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath)
      res.writeHead(200, { 'Content-Type': MIME[ext] })
      res.end(data)
      return
    }
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), machines: Object.keys(snapshot).length }))
  } else if (req.url === '/api/snapshot') {
    sendJson(res, snapshot)
  } else if (req.url === '/api/machines') {
    // ★ ดึงรายชื่อเครื่องจักรทั้งหมดจาก DB
    try {
      const rows = await fetchAllMachines()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ count: rows.length, rows }))
    } catch (err) {
      console.error('[API] /api/machines error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else if (req.url.startsWith('/api/lot-report')) {
    try {
      const u = new URL(req.url, 'http://localhost')
      const days = Math.min(Math.max(parseInt(u.searchParams.get('days') || '7', 10), 1), 30)
      const rows = await fetchLotReport(days)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ days, count: rows.length, rows }))
    } catch (err) {
      console.error('[API] /api/lot-report error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else if (req.url.startsWith('/api/qr-history')) {
    // ★ QR history ของเครื่องเดียว (group by LOT)
    try {
      const u = new URL(req.url, 'http://localhost')
      const machineId = u.searchParams.get('machine_id') || ''
      const range = u.searchParams.get('range') || 'today'
      const startStr = u.searchParams.get('start_date')
      const endStr = u.searchParams.get('end_date')
      const limit = parseInt(u.searchParams.get('limit') || '100', 10) // 0 = all
      const offset = parseInt(u.searchParams.get('offset') || '0', 10)
      if (!machineId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'machine_id required' }))
        return
      }
      const data = await fetchQrHistory(machineId, range, limit, offset, startStr, endStr)
      sendJson(res, data)
    } catch (err) {
      console.error('[API] /api/qr-history error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else if (req.url.startsWith('/api/qr-daily')) {
    // ★ % QR หลายวันของเครื่องเดียว
    try {
      const u = new URL(req.url, 'http://localhost')
      const machineId = u.searchParams.get('machine_id') || ''
      const range = u.searchParams.get('range') || 'today'
      const startStr = u.searchParams.get('start_date')
      const endStr = u.searchParams.get('end_date')
      if (!machineId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'machine_id required' }))
        return
      }
      const data = await fetchQrDaily(machineId, range, startStr, endStr)
      sendJson(res, data)
    } catch (err) {
      console.error('[API] /api/qr-daily error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else if (req.url.startsWith('/api/status-history')) {
    // ★ ประวัติสถานะเครื่องเดียว (EQPSTATUS) ทั้งวัน
    try {
      const u = new URL(req.url, 'http://localhost')
      const machineId = u.searchParams.get('machine_id') || ''
      const range = u.searchParams.get('range') || 'today'
      const startStr = u.searchParams.get('start_date')
      const endStr = u.searchParams.get('end_date')
      if (!machineId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'machine_id required' }))
        return
      }
      const limit = u.searchParams.get('limit')    // ★ [PERF] default 50
      const offset = u.searchParams.get('offset')  // ★ [PERF] pagination
      const alarmCategory = u.searchParams.get('alarm_category') || 'all'  // ★ [FIX] เดิมไม่ได้อ่าน
      const data = await fetchStatusHistory(machineId, range, startStr, endStr, limit, offset, alarmCategory)
      sendJson(res, data)
    } catch (err) {
      console.error('[API] /api/status-history error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else if (req.url.startsWith('/api/machine-history')) {
    // ★ ดึงสถานะล่าสุดของเครื่องเดียวในวันที่กำหนด (สำหรับ "ดูข้อมูลย้อนหลัง" ในหน้าเครื่อง)
    try {
      const u = new URL(req.url, 'http://localhost')
      const machineId = u.searchParams.get('machine_id') || ''
      const dateStr = u.searchParams.get('date') || localDateStr()
      if (!machineId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'machine_id required' }))
        return
      }
      const data = await fetchMachineHistory(machineId, dateStr)
      sendJson(res, data)
    } catch (err) {
      /* ★ [FIX] log ให้ครบ จะได้เห็นเลข ORA- จริงเวลาดีบัก */
      console.error('[API] /api/machine-history error:', err.errorNum ? ('ORA-' + err.errorNum + ' ') : '', err.message)
      console.error(err.stack)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message, ora: err.errorNum || null }))
    }
  } else if (req.url.startsWith('/api/qr-summary')) {
    // ★ สรุป % QR รวมทุกเครื่อง (สำหรับ sidebar)
    try {
      const u = new URL(req.url, 'http://localhost')
      const range = u.searchParams.get('range') || 'today'
      const startStr = u.searchParams.get('start_date')
      const endStr = u.searchParams.get('end_date')
      const data = await fetchQrSummary(range, startStr, endStr)
      sendJson(res, data)
    } catch (err) {
      console.error('[API] /api/qr-summary error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else if (req.url.startsWith('/api/qr-export')) {
    // ★ Export QR history เป็น CSV (download)
    try {
      const u = new URL(req.url, 'http://localhost')
      const machineId = u.searchParams.get('machine_id') || ''
      const range = u.searchParams.get('range') || 'today'
      const startStr = u.searchParams.get('start_date')
      const endStr = u.searchParams.get('end_date')
      if (!machineId) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'machine_id required' }))
        return
      }
      const data = await fetchQrHistory(machineId, range, 0, 0, startStr, endStr) // limit=0 = all
      // Build CSV
      var esc = function(v) { v = String(v == null ? '' : v); return v.indexOf(',') >= 0 ? '"' + v + '"' : v }
      var csv = 'timestamp,machine_id,lot_id,panel_id,is_read\n'
      data.lots.forEach(function(lot) {
        lot.panels.forEach(function(p) {
          // ★ [FIX] เดิมใช้ toISOString() (UTC) → timestamp ใน export เพี้ยนไป 7 ชม. จากเวลาไทยที่แสดงในหน้าเว็บ
          var ts = p.time instanceof Date ? localDateTimeStr(p.time) : String(p.time)
          csv += [ts, esc(data.machine_id), esc(lot.lot_id), esc(p.panel_id), p.is_error ? 'FALSE' : 'TRUE'].join(',') + '\n'
        })
      })
      var dateLabel = data.label.replace(/ to /g, '_')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="qr_' + machineId + '_' + dateLabel + '.csv"')
      res.writeHead(200)
      res.end(csv)
    } catch (err) {
      console.error('[API] /api/qr-export error:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  } else if (req.url.startsWith('/api/qr-logs/')) {
    // ★ Serve QR log file ตรงจาก qr-logs/ folder
    try {
      const u = new URL(req.url, 'http://localhost')
      const fileName = path.basename(u.pathname)
      if (!/^qr-\d{4}-\d{2}-\d{2}\.csv$/.test(fileName)) {
        res.writeHead(400); res.end('Invalid file name'); return
      }
      const filePath = path.join(QR_LOG_DIR, fileName)
      if (!fs.existsSync(filePath)) {
        res.writeHead(404); res.end('File not found'); return
      }
      const data = fs.readFileSync(filePath)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"')
      res.writeHead(200)
      res.end(data)
    } catch (err) {
      console.error('[API] /api/qr-logs error:', err.message)
      res.writeHead(500); res.end('Server error')
    }
  } else {
    res.writeHead(404)
    res.end('Not Found')
  }
})

const wss = new WebSocketServer({ server: app, path: '/ws' })

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log(`[WS] Client connected — total: ${clients.size}`)

  // ส่ง snapshot ทันที
  ws.send(JSON.stringify({ type: 'SNAPSHOT', data: snapshot }))

  // ★ ถ้า snapshot ว่าง → รอ poll แรกเสร็จแล้วส่งใหม่ (แก้ race condition)
  if (Object.keys(snapshot).length === 0) {
    console.log('[WS] Snapshot empty — will re-send after first poll')
    ws._awaitingSnapshot = true
  }

  ws.on('close', () => {
    clients.delete(ws)
    console.log(`[WS] Client left — total: ${clients.size}`)
  })
  ws.on('error', () => clients.delete(ws))
})

// ─── Start ────────────────────────────────────────────
async function main() {
  console.log('=== EAP Monitor Server (Standalone) ===')
  console.log(`[Info] Poll: every ${POLL_INTERVAL_MS}ms | Lookback: ${POLL_MINUTES} min`)
  // ★ ลบ QR log เก่ากว่า 30 วัน ตอน start
  purgeOldQrLogs()
  console.log('[QRLog] Auto-cleanup done (retention: 30 days)')

  // ★ Start server ก่อนเลย (ไม่ exit ถ้า Oracle ไม่ติด)
  // ★ '0.0.0.0' = รับ connection จากทุก IP (ไม่ใช่แค่ localhost)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running on http://0.0.0.0:${PORT} (accepts all interfaces)`)
    console.log(`[Server] Frontend  : http://localhost:${PORT}/`)
    console.log(`[Server] Test page: http://localhost:${PORT}/test-data.html`)
    console.log(`[Server] WebSocket  : ws://localhost:${PORT}/ws`)
    console.log(`[Server] Health    : http://localhost:${PORT}/health`)
    // ★ แสดง LAN IP ทั้งหมดที่คนอื่นสามารถใช้เข้าได้
    var ips = getLanIPs();
    if (ips.length > 0) {
      console.log('\n========================================');
      console.log('  ★ LINK:');
      ips.forEach(function(ip) {
        console.log('    http://' + ip + ':' + PORT + '/');
      });
      console.log('========================================\n');
    } else {
      console.log('\n→ เปิด http://localhost:' + PORT + '/test-data.html ใน browser\n');
    }
  })

  // Test Oracle connection (retry ทุก 30 วินาที — ไม่ exit)
  async function tryConnectOracle(attempt) {
    try {
      const p = await getPool()
      const conn = await p.getConnection()
      const test = await conn.execute('SELECT 1 FROM DUAL')
      await conn.close()
      console.log('[DB] Oracle connection OK ✓ (attempt ' + attempt + ')')
      startPolling()
      return true
    } catch (err) {
      console.warn('[DB] Oracle connection failed (attempt ' + attempt + '): ' + err.message)
      console.warn('[DB] จะ retry ใน 30 วินาที... (สลับ wifi เข้าเครือข่ายบริษัทก่อน)')
      return false
    }
  }

  let attempt = 0
  async function retryLoop() {
    const ok = await tryConnectOracle(++attempt)
    if (!ok) {
      setInterval(async () => {
        const ok2 = await tryConnectOracle(++attempt)
        if (ok2) {
          console.log('[DB] ✓ Oracle reconnected! เริ่ม polling...')
        }
      }, 30000)
    }
  }
  retryLoop()
}

async function shutdown() {
  console.log('\n[Server] Shutting down...')
  if (pollTimer) clearInterval(pollTimer)
  for (const ws of clients) ws.close()
  if (pool) { await pool.close(10); pool = null }
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

main().catch(err => { console.error('[Fatal]', err); process.exit(1) })