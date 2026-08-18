/**
 * check-evidence-setup.js — ตรวจว่า Vendor Evidence Pack พร้อมใช้งานหรือยัง
 *
 * เช็ค 3 อย่างที่ทำให้ "กดปุ่มแล้วไม่ขึ้น/ไม่เปลี่ยน":
 *   1. ฟอนต์ PDF มีจริงไหม (ถ้าไม่มี → ตัวอักษรจีนเพี้ยน)
 *   2. ตาราง FAULT_ZONE_MAP ถูกสร้างหรือยัง (ถ้ายัง → ไม่มี zone diagram)
 *   3. มีข้อมูลโซนกรอกไว้หรือยัง + machine_type ที่มีข้อมูลคืออะไรบ้าง
 *
 * ใช้:
 *   node check-evidence-setup.js
 *   node check-evidence-setup.js --machine=ELC-DEP-01-L    (เช็คเจาะจงเครื่อง)
 */
// ★ .env อยู่ที่ backend/ ไม่ใช่ tools/ — ระบุ path ตรงๆ จะได้รันจากที่ไหนก็ได้
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const oracledb = require('oracledb')
const evidencePack = require('../lib/evidence-pack')
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT

const machineArg = process.argv.find(a => a.startsWith('--machine='))
const machineId = machineArg ? machineArg.split('=')[1] : null

const DEFAULT_FONT = 'C:/Windows/Fonts/ARIALUNI.ttf'

;(async () => {
  var ok = true

  // ─── 1. ฟอนต์ ───
  console.log('\n=== 1. ฟอนต์สำหรับ PDF ===')
  const fontPath = process.env.PDF_FONT_PATH || DEFAULT_FONT
  if (fs.existsSync(fontPath)) {
    console.log('  OK - เจอฟอนต์ที่:', fontPath)
  } else {
    ok = false
    console.log('  FAILED - ไม่เจอฟอนต์ที่:', fontPath)
    console.log('  -> ตัวอักษรจีน/ไทยใน PDF จะเพี้ยน ตั้ง PDF_FONT_PATH ใน .env ให้ชี้ฟอนต์ที่มี')
  }

  // ─── 2 + 3. ตาราง FAULT_ZONE_MAP ───
  console.log('\n=== 2. ตาราง FAULT_ZONE_MAP ===')
  let pool
  try {
    pool = await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECTION_STRING,
      poolMin: 1, poolMax: 1, poolIncrement: 0, poolTimeout: 8,
    })
    const conn = await pool.getConnection()

    var tableExists = true
    try {
      await conn.execute('SELECT 1 FROM FAULT_ZONE_MAP WHERE ROWNUM <= 1')
      console.log('  OK - ตารางมีอยู่แล้ว')
    } catch (e) {
      tableExists = false
      ok = false
      console.log('  FAILED - ยังไม่มีตาราง (' + e.message.split('\n')[0] + ')')
      console.log('  -> ต้องรัน CREATE TABLE FAULT_ZONE_MAP ใน oracle_setup.sql ข้อ 6 ก่อน')
    }

    if (tableExists) {
      console.log('\n=== 3. ข้อมูลในตาราง ===')
      const cnt = await conn.execute('SELECT COUNT(*) AS C FROM FAULT_ZONE_MAP')
      const total = cnt.rows[0].C
      console.log('  จำนวนแถวทั้งหมด:', total)

      if (total === 0) {
        ok = false
        console.log('  -> ตารางว่าง ยังไม่มี zone diagram ต้อง INSERT ข้อมูลก่อน')
        console.log('     (ดู fault-zone-map-draft-example.csv เป็นตัวอย่าง)')
      } else {
        const zoneCnt = await conn.execute(
          'SELECT COUNT(*) AS C FROM FAULT_ZONE_MAP WHERE ZONE_ID IS NOT NULL'
        )
        console.log('  แถวที่กรอก ZONE_ID แล้ว:', zoneCnt.rows[0].C, '(ต้อง > 0 ถึงจะวาด diagram ได้)')

        const types = await conn.execute(
          `SELECT MACHINE_TYPE, COUNT(DISTINCT ZONE_ID) AS ZONES
           FROM FAULT_ZONE_MAP WHERE ZONE_ID IS NOT NULL
           GROUP BY MACHINE_TYPE ORDER BY MACHINE_TYPE`
        )
        console.log('\n  machine_type ที่มีโซนแล้ว:')
        if (!types.rows.length) {
          console.log('    (ไม่มีเลย - ยังไม่ได้กรอก ZONE_ID)')
        } else {
          types.rows.forEach(r => console.log('    ' + r.MACHINE_TYPE + '  (' + r.ZONES + ' โซน)'))
        }
      }

      // เช็คเจาะจงเครื่อง
      if (machineId) {
        const mt = evidencePack.deriveMachineType(machineId)
        console.log('\n=== เช็คเครื่อง ' + machineId + ' ===')
        console.log('  machine_type ที่ derive ได้:', mt)
        const zones = await conn.execute(
          `SELECT ZONE_ID, MIN(ZONE_LABEL) AS ZONE_LABEL, MIN(ZONE_ORDER) AS ZONE_ORDER
           FROM FAULT_ZONE_MAP WHERE MACHINE_TYPE = :mt AND ZONE_ID IS NOT NULL
           GROUP BY ZONE_ID ORDER BY MIN(ZONE_ORDER), ZONE_ID`,
          { mt: mt }
        )
        if (!zones.rows.length) {
          console.log('  -> ไม่มีโซนสำหรับ machine_type นี้ PDF จะขึ้น "No zones mapped"')
          console.log('     ต้อง INSERT แถวที่ MACHINE_TYPE = \'' + mt + '\' พร้อม ZONE_ID/ZONE_LABEL/ZONE_ORDER')
        } else {
          console.log('  โซนที่จะวาดใน diagram (เรียงซ้าย->ขวา):')
          zones.rows.forEach(r => console.log('    [' + r.ZONE_ORDER + '] ' + r.ZONE_ID + ' - ' + (r.ZONE_LABEL || '(ไม่มี label)')))
        }
      }
    }

    await conn.close()
    await pool.close(5)
  } catch (e) {
    ok = false
    console.log('  FAILED - ต่อ Oracle ไม่ได้:', e.message.split('\n')[0])
    console.log('  -> เช็ค VPN/เครือข่ายบริษัท')
    if (pool) try { await pool.close(0) } catch {}
  }

  console.log('\n' + (ok ? 'พร้อมใช้งาน' : 'ยังมีข้อที่ต้องแก้ตามด้านบน') + '\n')
})()
