/*
  diagnose3.js — ทดสอบสมมติฐาน "แผ่นหายเพราะ LOT_ID ว่าง"

  ข้อสงสัย: lot_panel_stats กรอง WHERE LOT_ID IS NOT NULL
            → แผ่นที่ตอนสแกน LOT_ID ยังว่าง ถูกทิ้งทั้งใบ
            → LOT ที่ควรได้ 40 เลยเหลือ 39

  สคริปต์นี้เทียบ 3 แบบต่อ LOT:
      RAW      = นับแบบปัจจุบัน (ทิ้งแถวที่ LOT_ID ว่าง)
      FILLED   = เติม LOT_ID ที่ว่างด้วย LOT ล่าสุดก่อนหน้า (forward-fill) แล้วค่อยนับ
      +ERR     = FILLED + แผ่นที่อ่าน QR ไม่ออก

  ถ้า FILLED ทำให้ 39 -> 40 แปลว่าสมมติฐานถูก แก้ได้ที่ SQL

  SELECT อย่างเดียว ไม่แก้ข้อมูล — ผลลง diagnose3-output.txt (UTF-8)
  วิธีใช้:  node diagnose3.js
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
const IS_PANEL_EVENT = `(CEID IS NULL OR TO_CHAR(CEID) <> '10117')`

// ── G. มีแถวที่ LOT_ID ว่างเยอะแค่ไหน ──────────────────────
const SQL_G = `
  SELECT
    COUNT(*) AS ALL_ROWS,
    SUM(CASE WHEN LOT_ID IS NULL THEN 1 ELSE 0 END) AS NULL_LOT_ROWS,
    COUNT(DISTINCT CASE WHEN LOT_ID IS NULL AND NOT ${IS_UNREAD} AND NOT ${IS_JUNK}
                        THEN ${NORM} END) AS NULL_LOT_PANELS,
    COUNT(DISTINCT CASE WHEN LOT_ID IS NULL THEN COALESCE(SUB_EQP_ID, MAIN_EQP_ID) END) AS MACHINES
  FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
  WHERE DATE_TIME >= SYSDATE - 1
    AND ${IS_PANEL_EVENT}
`

// ── H. ต่อ LOT: RAW vs FILLED vs +ERR (เฉพาะ LOT ที่จบแล้ว) ──
const SQL_H = `
  SELECT * FROM (
    SELECT
      MACHINE_ID,
      LOT_FF AS LOT_ID,
      /* นับแบบปัจจุบัน: เฉพาะแถวที่ LOT_ID ไม่ว่าง */
      COUNT(DISTINCT CASE WHEN IS_REAL = 1 AND LOT_ID IS NOT NULL THEN NORM_PANEL END) AS OK_RAW,
      /* นับหลังเติม LOT_ID ที่ว่าง */
      COUNT(DISTINCT CASE WHEN IS_REAL = 1 THEN NORM_PANEL END) AS OK_FILLED,
      SUM(IS_UNREAD_F) AS ERR_CNT,
      SUM(CASE WHEN LOT_ID IS NULL THEN 1 ELSE 0 END) AS NULL_ROWS,
      TO_CHAR(MAX(DATE_TIME), 'HH24:MI') AS T_END
    FROM (
      SELECT
        b.*,
        /* forward-fill: ใช้ LOT_ID ล่าสุดก่อนหน้าของเครื่องเดียวกัน */
        LAST_VALUE(LOT_ID IGNORE NULLS) OVER (
          PARTITION BY MACHINE_ID ORDER BY DATE_TIME
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS LOT_FF
      FROM (
        SELECT
          COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
          LOT_ID,
          DATE_TIME,
          ${NORM} AS NORM_PANEL,
          CASE WHEN ${IS_UNREAD} THEN 1 ELSE 0 END AS IS_UNREAD_F,
          CASE WHEN ${IS_UNREAD} THEN 0 WHEN ${IS_JUNK} THEN 0 ELSE 1 END AS IS_REAL
        FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
        WHERE DATE_TIME >= SYSDATE - 1
          AND ${IS_PANEL_EVENT}
      ) b
    )
    WHERE LOT_FF IS NOT NULL
    GROUP BY MACHINE_ID, LOT_FF
    HAVING MAX(DATE_TIME) < SYSDATE - 10/1440
    ORDER BY MAX(DATE_TIME) DESC
  ) WHERE ROWNUM <= 50
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

    /* ══ G ══ */
    w('')
    w('########## G. แถวที่ LOT_ID ว่าง มีเท่าไร (24 ชม.) ##########')
    w('')
    const g = (await conn.execute(SQL_G)).rows[0]
    w('  แถวทั้งหมด          : ' + g.ALL_ROWS)
    w('  แถวที่ LOT_ID ว่าง   : ' + g.NULL_LOT_ROWS + '  (' + (100 * g.NULL_LOT_ROWS / Math.max(1, g.ALL_ROWS)).toFixed(1) + '%)')
    w('  = แผ่นงานจริง       : ' + g.NULL_LOT_PANELS + ' แผ่น  <-- แผ่นพวกนี้หายไปจากยอดต่อ LOT ทั้งหมด')
    w('  กระจายอยู่          : ' + g.MACHINES + ' เครื่อง')

    /* ══ H ══ */
    w('')
    w('')
    w('########## H. RAW (ปัจจุบัน) vs FILLED (เติม LOT ที่ว่าง) ##########')
    w('')
    w(pad('MACHINE', 26) + pad('LOT', 16) + lpad('RAW', 6) + lpad('FILLED', 8) + lpad('ERR', 5) +
      lpad('nullแถว', 9) + lpad('จบ', 7) + '   RAW / FILLED / FILLED+ERR')
    w('-'.repeat(104))
    let nRaw = 0, nFill = 0, nFillErr = 0, nTot = 0
    for (const r of (await conn.execute(SQL_H)).rows || []) {
      const raw = Number(r.OK_RAW) || 0
      const fill = Number(r.OK_FILLED) || 0
      const err = Number(r.ERR_CNT) || 0
      nTot++
      const rRaw = raw > 0 && raw % 20 === 0
      const rFill = fill > 0 && fill % 20 === 0
      const rFillErr = (fill + err) > 0 && (fill + err) % 20 === 0
      if (rRaw) nRaw++
      if (rFill) nFill++
      if (rFillErr) nFillErr++
      w(pad(r.MACHINE_ID, 26) + pad(r.LOT_ID, 16) + lpad(raw, 6) + lpad(fill, 8) + lpad(err, 5) +
        lpad(r.NULL_ROWS, 9) + lpad(r.T_END, 7) + '   ' +
        (rRaw ? '✓' : '·') + '  /  ' + (rFill ? '✓' : '·') + '  /  ' + (rFillErr ? '✓' : '·'))
    }
    w('-'.repeat(104))
    w('จาก ' + nTot + ' LOT ที่จบแล้ว — ลงตัว 20:')
    w('   RAW (ตอนนี้)   : ' + nRaw)
    w('   FILLED         : ' + nFill + '   <-- ถ้าสูงกว่า RAW ชัดเจน = ต้องเติม LOT_ID ที่ว่าง')
    w('   FILLED + ERR   : ' + nFillErr + '   <-- ถ้าสูงสุด = ต้องรวมแผ่นที่อ่านไม่ออกด้วย')
    w('')
  } catch (e) {
    w('FAILED: ' + e.message)
    process.exitCode = 1
  } finally {
    try { if (conn) await conn.close() } catch {}
    try { if (pool) await pool.close(5) } catch {}
    const f = path.join(__dirname, 'output', 'diagnose-lot-id-gaps-output.txt')
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, out.join('\r\n'), 'utf8')
      console.log('\n>>> บันทึกแล้ว (UTF-8): ' + f)
    } catch (e) { console.log('เขียนไฟล์ไม่ได้: ' + e.message) }
  }
})()
