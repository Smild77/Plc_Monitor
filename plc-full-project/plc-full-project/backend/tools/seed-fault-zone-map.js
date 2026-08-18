/**
 * seed-fault-zone-map.js — สร้างชีทสำหรับกรอก FAULT_ZONE_MAP เอง
 *
 * ★ ตามที่ตรวจสอบด้วย list-alarm-codes.js แล้ว: EAP_EQP_ALM ไม่มีคอลัมน์ fault_code
 *   (แบบ 'E-601') จริง ๆ — ALARM_TEXT เป็น free text แต่ค่าเดิมซ้ำกันเป๊ะทุกครั้งที่เกิด
 *   fault ประเภทเดียวกัน จึงใช้ ALARM_TEXT (trim) เป็น "รหัส fault" แทน
 *
 * สคริปต์นี้:
 *   1. ดึงคู่ (MACHINE_ID, ALARM_TEXT, ALARM_CATEGORY) ที่เกิดขึ้นจริงในช่วงเวลาที่กำหนด
 *   2. Derive MACHINE_TYPE จาก MACHINE_ID (ตัดเลขไลน์ + role ท้ายออก เช่น
 *      'DRL-DEP-03-M1' → 'DRL-DEP' — เครื่องรุ่นเดียวกันหลายไลน์ใช้ schematic เดียวกันได้)
 *   3. Group ตาม (MACHINE_TYPE, ALARM_TEXT) รวมยอดจำนวนครั้ง
 *   4. Export เป็น CSV เรียงจากเกิดบ่อยสุดก่อน — เปิดใน Excel แล้วกรอก
 *      zone_id / zone_label / description / severity / typical_cause / causes เอง
 *
 * ใช้:
 *   node seed-fault-zone-map.js --days=30
 *   → เขียนไฟล์ fault-zone-map-seed.csv ในโฟลเดอร์นี้
 */
// ★ .env อยู่ที่ backend/ ไม่ใช่ tools/ — ระบุ path ตรงๆ จะได้รันจากที่ไหนก็ได้
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const fs = require('fs')
const path = require('path')
const oracledb = require('oracledb')
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT

const daysArg = process.argv.find(a => a.startsWith('--days='))
const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30
const OUT_PATH = path.join(__dirname, '..', 'data', 'fault-zone-map-seed.csv')

// เหมือน logic ที่ใช้ทั่วทั้งระบบ (MACHINES_DB): {FAMILY}-{เลขไลน์ 2 หลัก}-{role}
// role = L / UL / M1..M9 / มี suffix -1,-2 ได้ (เช่น M3-1, UL-2)
const ID_PATTERN = /^(.+)-(\d{2})-((?:L|UL)(?:-\d+)?|M\d+(?:-\d+)?)$/

function deriveMachineType(machineId) {
  var m = ID_PATTERN.exec(machineId)
  return m ? m[1] : machineId // ★ ถ้าไม่ตรง pattern → ใช้ทั้ง ID เป็น type ของตัวเอง (ไม่ทิ้งข้อมูล)
}

function csvEscape(v) {
  v = String(v == null ? '' : v)
  if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0) {
    return '"' + v.replace(/"/g, '""') + '"'
  }
  return v
}

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

    // ★ เอาแค่เครื่อง L (loading) / UL (unloading) — จุดที่วัด QR read-rate จริง
    //   เครื่อง M1/M2/M3... (สถานีกลางกระบวนการ) ไม่เกี่ยวกับ metric นี้ ตัดทิ้งตั้งแต่ SQL
    console.log(`Querying EAP_EQP_ALM — last ${days} day(s), L/UL machines only...`)
    const result = await conn.execute(
      `SELECT COALESCE(SUB_EQP_ID, MAIN_EQP_ID) AS MACHINE_ID, ALARM_TEXT, ALARM_CATEGORY, COUNT(*) AS CNT
       FROM PAEAPTRACE.EAP_EQP_ALM
       WHERE DATE_TIME >= SYSDATE - :days
         AND ALARM_TEXT IS NOT NULL
         AND REGEXP_LIKE(COALESCE(SUB_EQP_ID, MAIN_EQP_ID), '-(L|UL)(-[0-9]+)?$')
       GROUP BY COALESCE(SUB_EQP_ID, MAIN_EQP_ID), ALARM_TEXT, ALARM_CATEGORY`,
      { days }
    )
    await conn.close()
    await pool.close(5)

    const rows = result.rows || []
    console.log(`Got ${rows.length} raw (machine_id, alarm_text, category) rows — grouping by machine_type...`)

    // group by (machine_type, alarm_text)
    var grouped = new Map()
    rows.forEach(function(r) {
      var machineId = r.MACHINE_ID
      var alarmText = String(r.ALARM_TEXT || '').trim()
      if (!alarmText) return
      var machineType = deriveMachineType(machineId)
      var key = machineType + '' + alarmText
      if (!grouped.has(key)) {
        grouped.set(key, {
          machine_type: machineType,
          alarm_text: alarmText,
          categories: new Set(),
          machine_ids: new Set(),
          count: 0,
        })
      }
      var g = grouped.get(key)
      g.categories.add(String(r.ALARM_CATEGORY == null ? '(null)' : r.ALARM_CATEGORY))
      g.machine_ids.add(machineId)
      g.count += r.CNT
    })

    var list = Array.from(grouped.values()).sort(function(a, b) { return b.count - a.count })

    // CSV header ตรงกับคอลัมน์ FAULT_ZONE_MAP (+ column ช่วยตัดสินใจที่ไม่ insert ลง DB)
    var lines = [
      [
        'machine_type', 'alarm_text', 'zone_id', 'zone_label', 'zone_order', 'description',
        'severity', 'causes', 'typical_cause',
        'occurrence_count(ref)', 'raw_categories_seen(ref)', 'sample_machine_ids(ref)'
      ].join(',')
    ]
    list.forEach(function(g) {
      lines.push([
        csvEscape(g.machine_type),
        csvEscape(g.alarm_text),
        '', '', '', '',
        '', '', '',
        g.count,
        csvEscape(Array.from(g.categories).join('|')),
        csvEscape(Array.from(g.machine_ids).slice(0, 3).join('|')),
      ].join(','))
    })

    fs.writeFileSync(OUT_PATH, '﻿' + lines.join('\n') + '\n', 'utf8') // BOM กัน Excel เปิดภาษาจีนเพี้ยน
    console.log(`\nWrote ${list.length} (machine_type, alarm_text) rows → ${OUT_PATH}`)
    console.log('เปิดด้วย Excel แล้วกรอก zone_id/zone_label/description/severity/causes/typical_cause')
    console.log('คอลัมน์ท้าย 3 อัน (ref) ไว้ช่วยตัดสินใจเฉย ๆ ไม่ต้อง insert ลง DB')
    console.log(`\nจำนวนเครื่องรุ่นต่าง ๆ (machine_type) ที่เจอ: ${new Set(list.map(g => g.machine_type)).size}`)
  } catch (e) {
    console.error('FAILED:', e.message)
    if (pool) try { await pool.close(0) } catch {}
    process.exit(1)
  }
})()
