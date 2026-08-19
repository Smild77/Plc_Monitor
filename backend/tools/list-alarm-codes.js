// ★ .env อยู่ที่ backend/ ไม่ใช่ tools/ — ระบุ path ตรงๆ จะได้รันจากที่ไหนก็ได้
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const oracledb = require('oracledb')
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT

const daysArg = process.argv.find(a => a.startsWith('--days='))
const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 7

// A fault "code" would look like a short alphanumeric token at the start of
// the text, e.g. "E-601", "ALM0203", "P12". This regex is just a heuristic
// to see whether such a pattern shows up — it does not assume the answer.
const CODE_LIKE = /^[A-Za-z]{1,4}[-_]?\d{2,5}\b/

;(async () => {
  let pool
  try {
    pool = await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
      poolMin: 1, poolMax: 1, poolIncrement: 0, poolTimeout: 8,
    })
    const conn = await pool.getConnection()

    console.log(`\n=== EAP_EQP_ALM sample — last ${days} day(s) ===\n`)

    // 1. ALARM_CATEGORY breakdown
    const catRes = await conn.execute(
      `SELECT ALARM_CATEGORY, COUNT(*) AS CNT
       FROM PAEAPTRACE.EAP_EQP_ALM
       WHERE DATE_TIME >= SYSDATE - :days
       GROUP BY ALARM_CATEGORY
       ORDER BY CNT DESC`,
      { days }
    )
    console.log('-- ALARM_CATEGORY values --')
    console.table(catRes.rows)

    // 2. Distinct ALARM_TEXT values (this is the closest thing to a "fault code" today)
    const textRes = await conn.execute(
      `SELECT * FROM (
         SELECT ALARM_TEXT, ALARM_CATEGORY, COUNT(*) AS CNT
         FROM PAEAPTRACE.EAP_EQP_ALM
         WHERE DATE_TIME >= SYSDATE - :days
         GROUP BY ALARM_TEXT, ALARM_CATEGORY
         ORDER BY CNT DESC
       ) WHERE ROWNUM <= 200`,
      { days }
    )
    const rows = textRes.rows || []
    console.log(`\n-- Distinct ALARM_TEXT values (top 200 by frequency, ${rows.length} shown) --`)
    console.table(rows)

    // 3. How many of those look like they start with a discrete code?
    const codeLike = rows.filter(r => CODE_LIKE.test(String(r.ALARM_TEXT || '').trim()))
    console.log(`\n-- Rows whose ALARM_TEXT starts with a code-like token: ${codeLike.length} / ${rows.length} --`)
    if (codeLike.length) console.table(codeLike.slice(0, 30))

    // 4. DATE_TIME precision check — pull a few raw rows and inspect
    const tsRes = await conn.execute(
      `SELECT * FROM (
         SELECT DATE_TIME, ALARM_TEXT
         FROM PAEAPTRACE.EAP_EQP_ALM
         WHERE DATE_TIME >= SYSDATE - :days
         ORDER BY DATE_TIME DESC
       ) WHERE ROWNUM <= 10`,
      { days }
    )
    console.log('\n-- Raw DATE_TIME values (check for sub-second precision) --')
    ;(tsRes.rows || []).forEach(r => {
      const d = r.DATE_TIME
      console.log(
        d instanceof Date ? d.toISOString() : String(d),
        '  ms=' + (d instanceof Date ? d.getMilliseconds() : 'n/a'),
        ' |', r.ALARM_TEXT
      )
    })

    // 5. Same three checks for MAIN_EQP_ID / SUB_EQP_ID naming, to see if a
    //    machine "model/type" is derivable (e.g. shared prefix) vs one-off IDs
    const eqpRes = await conn.execute(
      `SELECT DISTINCT COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID
       FROM PAEAPTRACE.EAP_EQP_ALM
       WHERE DATE_TIME >= SYSDATE - :days
       ORDER BY 1`,
      { days }
    )
    console.log(`\n-- Distinct machine IDs seen in alarms (${(eqpRes.rows||[]).length}) --`)
    console.table(eqpRes.rows)

    await conn.close()
    await pool.close(5)
    console.log('\nDone.')                          
  } catch (e) {
    console.error('FAILED:', e.message)
    if (pool) try { await pool.close(0) } catch {}
    process.exit(1)
  }
})()
