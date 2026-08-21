/*
  verify-panel-count.js — ตรวจว่า Total Sheet ที่หน้าจอจะแสดง ออกมาเป็นเลขกลมไหม

  จำลอง logic เดียวกับ fetchLatestMachineStates() ใน eap-server.js เป๊ะๆ:
    normalize PANEL_ID -> ตัด jig/dummy -> ตัด CEID 10117 -> นับ DISTINCT ต่อ LOT -> เลือก best_lot
  แล้วเทียบกับวิธีเดิม (นับทุกแถวใน 24 ชม.)

  ไม่แตะข้อมูล — SELECT อย่างเดียว
  ★ เขียนผลลง verify-output.txt เป็น UTF-8 เอง (ไม่ต้องใช้ > redirect ไม่งั้นเพี้ยนเป็น UTF-16)

  วิธีใช้ (ต้องอยู่บน wifi PAIPEI):
      node verify-panel-count.js               → ทุกเครื่อง
      node verify-panel-count.js SMK-SPR-01-L  → เจาะเครื่องเดียว + รายแผ่นที่ถูกตัด/รวม
*/
// ★ .env อยู่ที่ backend/ ไม่ใช่ tools/ — ระบุ path ตรงๆ จะได้รันจากที่ไหนก็ได้
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const oracledb = require('oracledb')
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
oracledb.fetchAsString = [oracledb.CLOB]

// ★ กฎเดียวกับ eap-server.js — แก้ที่นี่ต้องแก้ที่โน่นด้วย
const NORM = `UPPER(REGEXP_SUBSTR(DBMS_LOB.SUBSTR(PANEL_ID, 100, 1), '^[^,/]+'))`
const IS_UNREAD = `(PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%')`
const IS_JUNK = `(
       ${NORM} LIKE 'DUMMY%'
       OR REGEXP_LIKE(${NORM}, 'M[0-9]{7}[A-Z][0-9]{4}')
       OR REGEXP_LIKE(${NORM}, '[^0-9A-Z]')
       OR LENGTH(${NORM}) < 10
     )`
const IS_PANEL_EVENT = `(CEID IS NULL OR TO_CHAR(CEID) <> '10117')`

const machineArg = process.argv[2] || null
const machineFilter = machineArg ? `AND COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = :mid` : ``

const SUMMARY_SQL = `
  WITH panel_base AS (
    SELECT
      COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
      LOT_ID,
      DATE_TIME,
      ${NORM} AS NORM_PANEL,
      CASE WHEN ${IS_UNREAD} THEN 1 ELSE 0 END AS IS_UNREAD,
      CASE WHEN ${IS_UNREAD} THEN 0 WHEN ${IS_JUNK} THEN 0 ELSE 1 END AS IS_REAL
    FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
    WHERE DATE_TIME >= SYSDATE - 1
      AND ${IS_PANEL_EVENT}
      ${machineFilter}
  ),
  /*ทุกแถวที่อ่าน QR ได้ ใน 24 ชม */
  old_stats AS (
    SELECT MACHINE_ID, SUM(CASE WHEN IS_UNREAD = 0 THEN 1 ELSE 0 END) AS OLD_OK
    FROM panel_base GROUP BY MACHINE_ID
  ),
  lot_panel_stats AS (
    SELECT
      MACHINE_ID,
      NVL(LOT_ID, '(no lot)') AS LOT_ID,
      COUNT(DISTINCT CASE WHEN IS_REAL = 1 THEN NORM_PANEL END) AS LOT_OK,
      SUM(IS_UNREAD) AS LOT_ERR,
      MAX(DATE_TIME) AS LOT_LAST_EVENT
    FROM panel_base
    WHERE LOT_ID IS NOT NULL
    GROUP BY MACHINE_ID, NVL(LOT_ID, '(no lot)')
  ),
  best_lot AS (
    SELECT MACHINE_ID, LOT_ID, LOT_OK, LOT_ERR, LOT_LAST_EVENT FROM (
      SELECT lps.*, ROW_NUMBER() OVER (
               PARTITION BY MACHINE_ID
               ORDER BY CASE WHEN LOT_OK + LOT_ERR > 0 THEN 0 ELSE 1 END, LOT_LAST_EVENT DESC
             ) AS rn
      FROM lot_panel_stats lps
    ) WHERE rn = 1
  )
  SELECT
    o.MACHINE_ID,
    o.OLD_OK,
    b.LOT_ID,
    b.LOT_OK  AS NEW_OK,
    b.LOT_ERR AS NEW_ERR,
    TO_CHAR(b.LOT_LAST_EVENT, 'HH24:MI') AS LAST_EVT
  FROM old_stats o
  LEFT JOIN best_lot b ON b.MACHINE_ID = o.MACHINE_ID
  ORDER BY o.MACHINE_ID
`

// รายแผ่นของเครื่องเดียว — ดูว่าอะไรถูกตัด/รวม
const DETAIL_SQL = `
  SELECT NORM_PANEL, IS_REAL, CNT, RAW_FORMS
  FROM (
    SELECT
      NORM_PANEL,
      MAX(IS_REAL) AS IS_REAL,
      COUNT(*) AS CNT,
      /* เลี่ยง LISTAGG(DISTINCT) ที่ต้อง Oracle 19c+ — เคสจริงมีอย่างมาก 2 รูปแบบ (เช่น X กับ X/0) */
      MIN(RAW_PANEL) || CASE WHEN COUNT(DISTINCT RAW_PANEL) > 1
                             THEN ' | ' || MAX(RAW_PANEL) ELSE '' END AS RAW_FORMS
    FROM (
      SELECT
        DBMS_LOB.SUBSTR(PANEL_ID, 100, 1) AS RAW_PANEL,
        ${NORM} AS NORM_PANEL,
        CASE WHEN ${IS_JUNK} THEN 0 ELSE 1 END AS IS_REAL
      FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
      WHERE DATE_TIME >= SYSDATE - 1
        AND COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = :mid
        AND ${IS_PANEL_EVENT}
        AND NOT ${IS_UNREAD}
    )
    GROUP BY NORM_PANEL
  )
  WHERE CNT > 1 OR IS_REAL = 0
  ORDER BY IS_REAL, CNT DESC
`

const out = []
function w(s) { out.push(s === undefined ? '' : String(s)); console.log(s === undefined ? '' : s) }
function pad(s, n) { s = (s === null || s === undefined) ? '' : String(s); return s + ' '.repeat(Math.max(0, n - s.length)) }
function lpad(s, n) { s = (s === null || s === undefined) ? '' : String(s); return ' '.repeat(Math.max(0, n - s.length)) + s }

;(async () => {
  let pool, conn
  try {
    pool = await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
      poolMin: 1, poolMax: 1, poolIncrement: 0, poolTimeout: 15,
    })
    conn = await pool.getConnection()

    const binds = machineArg ? { mid: machineArg } : {}
    const rows = (await conn.execute(SUMMARY_SQL, binds)).rows || []

    w('')
    w('Total Sheet ที่หน้าจอจะแสดง (= LOT ที่กำลังรัน)' + (machineArg ? ('  |  ' + machineArg) : ''))
    w('='.repeat(96))
    w(pad('MACHINE', 28) + pad('LOT ปัจจุบัน', 17) + lpad('เดิม(24ชม)', 12) + lpad('ใหม่', 7) +
      lpad('ERR', 6) + lpad('ล่าสุด', 9) + '   กลม?')
    w('-'.repeat(96))

    let nRound = 0, nHaveLot = 0
    for (const r of rows) {
      const newOk = r.NEW_OK === null ? null : Number(r.NEW_OK)
      if (newOk !== null) nHaveLot++
      // "เลขกลม" = หารด้วย 20 ลงตัว (คาสเซ็ตต์ 40 / 80 แผ่น)
      const round = newOk !== null && newOk > 0 && newOk % 20 === 0
      if (round) nRound++
      w(pad(r.MACHINE_ID, 28) + pad(r.LOT_ID === null ? '(ไม่มี LOT)' : r.LOT_ID, 17) +
        lpad(r.OLD_OK, 12) + lpad(newOk === null ? '-' : newOk, 7) +
        lpad(r.NEW_ERR === null ? '-' : r.NEW_ERR, 6) + lpad(r.LAST_EVT, 9) +
        (round ? '   <== ✓' : ''))
    }
    w('-'.repeat(96))
    w('เครื่องที่มี LOT: ' + nHaveLot + '/' + rows.length + '   |   ลงตัว 20: ' + nRound + '/' + nHaveLot)
    w('(LOT ที่ยังเดินอยู่จะยังไม่กลม เป็นเรื่องปกติ — ดูเฉพาะตัวที่ "ล่าสุด" ห่างจากเวลาปัจจุบันหลายนาที)')

    if (machineArg) {
      const drows = (await conn.execute(DETAIL_SQL, { mid: machineArg })).rows || []
      w('')
      w('รายแผ่นที่ถูกตัด/รวมเข้าด้วยกัน (' + drows.length + ' รายการ)')
      w('-'.repeat(96))
      for (const r of drows) {
        w(pad(r.IS_REAL === 1 ? ('ซ้ำ x' + r.CNT) : 'dummy/jig', 14) + pad(r.NORM_PANEL, 24) + '  <- ' + r.RAW_FORMS)
      }
      if (!drows.length) w('(ไม่มี — เครื่องนี้ข้อมูลสะอาดอยู่แล้ว)')
    }
    w('')
  } catch (e) {
    w('FAILED: ' + e.message)
    process.exitCode = 1
  } finally {
    try { if (conn) await conn.close() } catch {}
    try { if (pool) await pool.close(5) } catch {}
    const f = path.join(__dirname, 'output', 'verify-output.txt')
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, out.join('\r\n'), 'utf8')
      console.log('\n>>> บันทึกแล้ว (UTF-8): ' + f)
    } catch (e) { console.log('เขียนไฟล์ไม่ได้: ' + e.message) }
  }
})()
