/*
  diagnose-panel-ids.js — หาคำตอบ 3 ข้อ ก่อนจะ fine-tune กฎนับแผ่น

    A. ID แบบไหนบ้างที่โดนกฎ "dummy" ตัดทิ้ง  → กฎตัดเกินตรงไหน
    B. แผ่นที่ซ้ำ 2 เท่า มันต่างกันที่คอลัมน์ไหน → ซ้ำเพราะอะไร
    C. ถ้านับ "ต่อ LOT" ตัวเลขกลม (40/80) ไหม   → ควรเปลี่ยนขอบเขตหรือเปล่า

  ★ หมายเหตุ: SQL_A ตั้งใจใช้กฎ "whitelist" แบบเก่า (REAL_RE) ไม่ใช่กฎ blacklist ที่ใช้จริงใน
    eap-server.js — เพราะจุดประสงค์คืออยากเห็นว่ามี ID แบบไหนบ้างที่ whitelist ตัดทิ้ง
    ถ้าเปลี่ยนไปใช้กฎปัจจุบันจะไม่เหลืออะไรให้ดู

  SELECT อย่างเดียว ไม่แก้ข้อมูล — ผลลง output/diagnose-panel-ids-output.txt (UTF-8)
  วิธีใช้:  node tools/diagnose-panel-ids.js
*/
// ★ .env อยู่ที่ backend/ ไม่ใช่ tools/ — ระบุ path ตรงๆ จะได้รันจากที่ไหนก็ได้
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const oracledb = require('oracledb')
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT
oracledb.fetchAsString = [oracledb.CLOB]

const NORM = `UPPER(REGEXP_SUBSTR(DBMS_LOB.SUBSTR(PANEL_ID, 100, 1), '^[^,/]+'))`
const REAL_RE = `'^[0-9]{14}[0-9A-Z][0-9]{3,5}$'`
const IS_UNREAD = `(PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%')`
// แปลง ID เป็น "รูปทรง": ตัวเลข -> #, ตัวอักษร -> A  (ดูฟอร์แมตโดยไม่ต้องเห็นทุก ID)
const SHAPE = `TRANSLATE(${NORM}, '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', '##########AAAAAAAAAAAAAAAAAAAAAAAAAA')`

// ── A. ID ที่ถูกตัดเป็น dummy — จัดกลุ่มตามรูปทรง ────────────
const SQL_A = `
  SELECT * FROM (
    SELECT
      ${SHAPE} AS SHAPE,
      COUNT(*) AS CNT,
      COUNT(DISTINCT ${NORM}) AS DISTINCT_IDS,
      COUNT(DISTINCT COALESCE(SUB_EQP_ID, MAIN_EQP_ID)) AS N_MACHINES,
      MIN(DBMS_LOB.SUBSTR(PANEL_ID, 100, 1)) AS SAMPLE_1,
      MAX(DBMS_LOB.SUBSTR(PANEL_ID, 100, 1)) AS SAMPLE_2,
      MIN(COALESCE(SUB_EQP_ID, MAIN_EQP_ID)) AS SAMPLE_MACHINE
    FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
    WHERE DATE_TIME >= SYSDATE - 1
      AND NOT ${IS_UNREAD}
      AND NOT REGEXP_LIKE(${NORM}, ${REAL_RE})
    GROUP BY ${SHAPE}
    ORDER BY COUNT(*) DESC
  ) WHERE ROWNUM <= 25
`

// ── B. แผ่นที่ซ้ำ — ดูว่าต่างกันตรงไหน ─────────────────────
const SQL_B_COLS = `
  SELECT COLUMN_NAME, DATA_TYPE
  FROM ALL_TAB_COLUMNS
  WHERE OWNER = 'PAEAPTRACE' AND TABLE_NAME = 'EAP_EQP_EVENT_PNL_PNL'
  ORDER BY COLUMN_ID
`

// ── C. นับต่อ LOT — กลมไหม ────────────────────────────────
const SQL_C = `
  SELECT * FROM (
    SELECT
      MACHINE_ID,
      LOT_ID,
      COUNT(DISTINCT NORM_PANEL) AS PANELS,
      COUNT(*) AS RAW_ROWS,
      TO_CHAR(MIN(DATE_TIME), 'HH24:MI') AS T_START,
      TO_CHAR(MAX(DATE_TIME), 'HH24:MI') AS T_END
    FROM (
      SELECT
        COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID,
        LOT_ID,
        DATE_TIME,
        ${NORM} AS NORM_PANEL
      FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
      WHERE DATE_TIME >= SYSDATE - 1
        AND NOT ${IS_UNREAD}
        AND LOT_ID IS NOT NULL
    )
    GROUP BY MACHINE_ID, LOT_ID
    ORDER BY MIN(DATE_TIME) DESC
  ) WHERE ROWNUM <= 40
`

const out = []
function w(s) { out.push(s === undefined ? '' : String(s)); console.log(s === undefined ? '' : s) }
function pad(s, n) { s = (s === null || s === undefined) ? '' : String(s); return s + ' '.repeat(Math.max(0, n - s.length)) }
function lpad(s, n) { s = (s === null || s === undefined) ? '' : String(s); return ' '.repeat(Math.max(0, n - s.length)) + s }
function line(n) { w('─'.repeat(n || 100)) }

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

    /* ══ A ══════════════════════════════════════════ */
    w('\n\n########## A. ID ที่ถูกตัดทิ้งเป็น dummy (24 ชม.) ##########\n')
    const a = await conn.execute(SQL_A)
    line(118)
    w(pad('SHAPE (# = เลข, A = อักษร)', 26) + lpad('แถว', 8) + lpad('ID', 7) + lpad('เครื่อง', 8) + '  ' + pad('ตัวอย่าง', 46) + 'เครื่องตัวอย่าง')
    line(118)
    for (const r of a.rows || []) {
      const s2 = r.SAMPLE_2 !== r.SAMPLE_1 ? ('  /  ' + r.SAMPLE_2) : ''
      w(
        pad(r.SHAPE, 26) + lpad(r.CNT, 8) + lpad(r.DISTINCT_IDS, 7) + lpad(r.N_MACHINES, 8) +
        '  ' + pad(String(r.SAMPLE_1) + s2, 46) + r.SAMPLE_MACHINE
      )
    }
    if (!(a.rows || []).length) w('(ไม่มี — ไม่มี ID ไหนถูกตัดเลย)')

    /* ══ B ══════════════════════════════════════════ */
    w('\n\n########## B. ทำไมแผ่นถึงซ้ำ 2 เท่า ##########\n')
    const cols = (await conn.execute(SQL_B_COLS)).rows || []
    w('คอลัมน์ในตาราง: ' + cols.map(c => c.COLUMN_NAME).join(', ') + '\n')

    // เลือกคอลัมน์ที่ compare ได้ (ข้าม LOB) มาดูว่าแถวซ้ำต่างกันตรงไหน
    const cmp = cols.filter(c => !['CLOB', 'BLOB', 'NCLOB'].includes(c.DATA_TYPE)).map(c => c.COLUMN_NAME)
    const sqlB = `
      SELECT ${cmp.join(', ')}
      FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
      WHERE DATE_TIME >= SYSDATE - 1
        AND COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = 'LIN-INNLDI-01-L'
        AND ${NORM} = (
          SELECT NP FROM (
            SELECT ${NORM} AS NP, COUNT(*) C
            FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
            WHERE DATE_TIME >= SYSDATE - 1
              AND COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = 'LIN-INNLDI-01-L'
              AND NOT ${IS_UNREAD}
            GROUP BY ${NORM} HAVING COUNT(*) > 1
            ORDER BY C DESC
          ) WHERE ROWNUM = 1
        )
      ORDER BY DATE_TIME
    `
    const b = await conn.execute(sqlB)
    const brows = b.rows || []
    w('แผ่นตัวอย่างจาก LIN-INNLDI-01-L ที่มี ' + brows.length + ' แถว — เทียบทีละคอลัมน์:\n')
    if (brows.length > 1) {
      for (const c of cmp) {
        const vals = brows.map(r => (r[c] instanceof Date ? r[c].toISOString() : String(r[c])))
        const same = vals.every(v => v === vals[0])
        w((same ? '  [เหมือน] ' : '  [ต่าง!!] ') + pad(c, 22) + vals.join('  |  '))
      }
    } else {
      w('(หาแถวซ้ำไม่เจอ)')
    }

    /* ══ C ══════════════════════════════════════════ */
    w('\n\n########## C. ถ้านับต่อ LOT จะกลมไหม (40 LOT ล่าสุด) ##########\n')
    const c = await conn.execute(SQL_C)
    line(88)
    w(pad('MACHINE', 28) + pad('LOT', 17) + lpad('แผ่น', 7) + lpad('แถวดิบ', 9) + lpad('เริ่ม', 8) + lpad('จบ', 7) + '   กลม?')
    line(88)
    let round = 0, tot = 0
    for (const r of c.rows || []) {
      const n = Number(r.PANELS) || 0
      tot++
      const isRound = n > 0 && n % 20 === 0
      if (isRound) round++
      w(
        pad(r.MACHINE_ID, 28) + pad(r.LOT_ID, 17) + lpad(n, 7) + lpad(r.RAW_ROWS, 9) +
        lpad(r.T_START, 8) + lpad(r.T_END, 7) + (isRound ? '   ✓' : '')
      )
    }
    line(88)
    w('ลงตัว 20: ' + round + '/' + tot + ' LOT\n')
  } catch (e) {
    w('FAILED: ' + e.message)
    process.exitCode = 1
  } finally {
    try { if (conn) await conn.close() } catch {}
    try { if (pool) await pool.close(5) } catch {}
    const outFile = path.join(__dirname, 'output', 'diagnose-panel-ids-output.txt')
    try {
      fs.mkdirSync(path.dirname(outFile), { recursive: true })
      fs.writeFileSync(outFile, out.join('\r\n'), 'utf8')
      console.log('\n>>> บันทึกแล้ว (UTF-8): ' + outFile)
    } catch (e) { console.log('เขียนไฟล์ไม่ได้: ' + e.message) }
  }
})()
