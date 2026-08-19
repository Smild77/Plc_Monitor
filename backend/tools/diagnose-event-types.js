/*
  diagnose2.js — ยืนยัน 3 สมมติฐานจากผล diagnose รอบแรก

    D. CEID / DATAITEM01 คืออะไร      → กรอง event เดียวแทน dedup ได้ไหม
    E. PANELTYPE มีค่าอะไรบ้าง        → ใช้แทน regex เดา dummy ได้ไหม
    F. ต่อ LOT: OK + อ่านไม่ได้ = 40/80 ไหม  → คิดเฉพาะ LOT ที่จบแล้ว

  SELECT อย่างเดียว ไม่แก้ข้อมูล
  ★ เขียนผลลง diagnose2-output.txt เป็น UTF-8 เอง (ไม่ต้อง > redirect ไม่งั้นเพี้ยนเป็น UTF-16)

  วิธีใช้:  node diagnose2.js
*/
// ★ .env อยู่ที่ backend/ ไม่ใช่ tools/ — ระบุ path ตรงๆ จะได้รันจากที่ไหนก็ได้
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const oracledb = require('oracledb')
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
oracledb.fetchAsString = [oracledb.CLOB]

const NORM = `UPPER(REGEXP_SUBSTR(DBMS_LOB.SUBSTR(PANEL_ID, 100, 1), '^[^,/]+'))`
const IS_UNREAD = `(PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%')`
const IS_JUNK = `(
       ${NORM} LIKE 'DUMMY%'
       OR REGEXP_LIKE(${NORM}, 'M[0-9]{7}[A-Z][0-9]{4}')
       OR REGEXP_LIKE(${NORM}, '[^0-9A-Z]')
       OR LENGTH(${NORM}) < 10
     )`

// ── D. CEID x DATAITEM01 — event อะไรบ้าง แต่ละอันกี่แถว ──────
const SQL_D = `
  SELECT * FROM (
    SELECT
      CEID,
      DATAITEM01,
      ALIAS_NAME,
      COUNT(*) AS ROWS_CNT,
      COUNT(DISTINCT ${NORM}) AS PANELS,
      COUNT(DISTINCT COALESCE(SUB_EQP_ID, MAIN_EQP_ID)) AS MACHINES
    FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
    WHERE DATE_TIME >= SYSDATE - 1
    GROUP BY CEID, DATAITEM01, ALIAS_NAME
    ORDER BY COUNT(*) DESC
  ) WHERE ROWNUM <= 20
`

// ── E. PANELTYPE / SORTF — มี flag บอก dummy ไหม ──────────────
const SQL_E = `
  SELECT
    PANELTYPE,
    COUNT(*) AS ROWS_CNT,
    SUM(CASE WHEN ${IS_UNREAD} THEN 1 ELSE 0 END) AS UNREAD_CNT,
    SUM(CASE WHEN NOT ${IS_UNREAD} AND ${IS_JUNK} THEN 1 ELSE 0 END) AS JUNK_BY_REGEX,
    MIN(DBMS_LOB.SUBSTR(PANEL_ID, 60, 1)) AS SAMPLE_ID
  FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
  WHERE DATE_TIME >= SYSDATE - 1
  GROUP BY PANELTYPE
  ORDER BY COUNT(*) DESC
`

// ── F. ต่อ LOT (เฉพาะ LOT ที่จบแล้ว) — OK / อ่านไม่ได้ / รวม ──
const SQL_F = `
  SELECT * FROM (
    SELECT
      MACHINE_ID,
      LOT_ID,
      COUNT(DISTINCT CASE WHEN IS_OK = 1 THEN NORM_PANEL END) AS OK_PANELS,
      SUM(IS_UNREAD_F) AS ERR_PANELS,
      SUM(IS_JUNK_F)   AS JUNK_PANELS,
      TO_CHAR(MIN(DATE_TIME), 'HH24:MI') AS T_START,
      TO_CHAR(MAX(DATE_TIME), 'HH24:MI') AS T_END
    FROM (
      SELECT
        COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
        LOT_ID,
        DATE_TIME,
        ${NORM} AS NORM_PANEL,
        CASE WHEN ${IS_UNREAD} THEN 1 ELSE 0 END AS IS_UNREAD_F,
        CASE WHEN NOT ${IS_UNREAD} AND ${IS_JUNK} THEN 1 ELSE 0 END AS IS_JUNK_F,
        CASE WHEN NOT ${IS_UNREAD} AND NOT ${IS_JUNK} THEN 1 ELSE 0 END AS IS_OK
      FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
      WHERE DATE_TIME >= SYSDATE - 1
        AND LOT_ID IS NOT NULL
    )
    GROUP BY MACHINE_ID, LOT_ID
    /* เอาเฉพาะ LOT ที่จบไปแล้วอย่างน้อย 10 นาที — LOT ที่ยังเดินอยู่ตัวเลขยังไม่ครบ */
    HAVING MAX(DATE_TIME) < SYSDATE - 10/1440
    ORDER BY MAX(DATE_TIME) DESC
  ) WHERE ROWNUM <= 45
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

    /* ══ D ══ */
    w('')
    w('########## D. CEID / DATAITEM01 = event อะไร (24 ชม.) ##########')
    w('')
    w(lpad('CEID', 8) + lpad('ITEM01', 10) + '  ' + pad('ALIAS_NAME', 22) + lpad('แถว', 10) + lpad('แผ่น', 9) + lpad('เครื่อง', 9))
    w('-'.repeat(70))
    for (const r of (await conn.execute(SQL_D)).rows || []) {
      w(lpad(r.CEID, 8) + lpad(r.DATAITEM01, 10) + '  ' + pad(r.ALIAS_NAME, 22) +
        lpad(r.ROWS_CNT, 10) + lpad(r.PANELS, 9) + lpad(r.MACHINES, 9))
    }

    /* ══ E ══ */
    w('')
    w('')
    w('########## E. PANELTYPE มีค่าอะไรบ้าง ##########')
    w('')
    w(pad('PANELTYPE', 20) + lpad('แถว', 10) + lpad('อ่านไม่ได้', 12) + lpad('regexว่าขยะ', 13) + '  ตัวอย่าง ID')
    w('-'.repeat(80))
    for (const r of (await conn.execute(SQL_E)).rows || []) {
      w(pad(r.PANELTYPE === null ? '(null)' : r.PANELTYPE, 20) + lpad(r.ROWS_CNT, 10) +
        lpad(r.UNREAD_CNT, 12) + lpad(r.JUNK_BY_REGEX, 13) + '  ' + (r.SAMPLE_ID || ''))
    }

    /* ══ F ══ */
    w('')
    w('')
    w('########## F. LOT ที่จบแล้ว — OK + อ่านไม่ได้ = กลมไหม ##########')
    w('')
    w(pad('MACHINE', 26) + pad('LOT', 16) + lpad('OK', 6) + lpad('ERR', 6) + lpad('junk', 6) +
      lpad('รวม', 7) + lpad('เริ่ม', 8) + lpad('จบ', 7) + '  กลม?')
    w('-'.repeat(92))
    let nRound = 0, nTot = 0, nRoundOkOnly = 0
    for (const r of (await conn.execute(SQL_F)).rows || []) {
      const ok = Number(r.OK_PANELS) || 0
      const err = Number(r.ERR_PANELS) || 0
      const junk = Number(r.JUNK_PANELS) || 0
      const total = ok + err
      nTot++
      const isRound = total > 0 && total % 20 === 0
      if (isRound) nRound++
      if (ok > 0 && ok % 20 === 0) nRoundOkOnly++
      w(pad(r.MACHINE_ID, 26) + pad(r.LOT_ID, 16) + lpad(ok, 6) + lpad(err, 6) + lpad(junk, 6) +
        lpad(total, 7) + lpad(r.T_START, 8) + lpad(r.T_END, 7) + (isRound ? '  <== ✓' : ''))
    }
    w('-'.repeat(92))
    w('OK+ERR ลงตัว 20 : ' + nRound + '/' + nTot + ' LOT')
    w('OK อย่างเดียว    : ' + nRoundOkOnly + '/' + nTot + ' LOT   <-- ถ้าตัวบนสูงกว่าตัวล่าง = ต้องรวม ERR ด้วย')
    w('')
  } catch (e) {
    w('FAILED: ' + e.message)
    process.exitCode = 1
  } finally {
    try { if (conn) await conn.close() } catch {}
    try { if (pool) await pool.close(5) } catch {}
    const f = path.join(__dirname, 'output', 'diagnose-event-types-output.txt')
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, out.join('\r\n'), 'utf8')
      console.log('\n>>> บันทึกแล้ว (UTF-8): ' + f)
    } catch (e) { console.log('เขียนไฟล์ไม่ได้: ' + e.message) }
  }
})()
