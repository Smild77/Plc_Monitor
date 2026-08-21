/**
 * evidence-pack.js — Vendor Evidence Pack: ข้อมูล + PDF export
 *
 * ★ ยังไม่ได้ทดสอบกับ Oracle จริง (ไม่มี VPN ตอนเขียน) — ต้องทดสอบก่อนใช้งานจริง
 * ★ ต้องรัน CREATE TABLE FAULT_ZONE_MAP (ใน oracle_setup.sql ข้อ 6) ก่อน ไม่งั้น zone/causes
 *   จะว่างเปล่าเสมอ (โค้ด catch error ไว้ให้ degrade แบบไม่ crash แต่ก็จะไม่มีข้อมูล zone)
 * ★ Schematic ยังเป็น placeholder กล่องเปล่า — รอ SVG จริงต่อ machine_type จากคุณ
 */
const crypto = require('crypto')
const fs = require('fs')
const PDFDocument = require('pdfkit')

// ★ [FIX] pdfkit ใช้ฟอนต์ default (Helvetica) ซึ่งไม่มี glyph ภาษาจีน/ไทย เลย
//   ALARM_TEXT ส่วนใหญ่เป็นภาษาจีน → เรนเดอร์ออกมาเป็นตัวอักษรมั่ว (mojibake)
//   ต้อง register ฟอนต์ที่ครอบคลุม Unicode กว้าง ๆ ก่อนเขียนข้อความใด ๆ ลง PDF
//   ใช้ Arial Unicode MS ที่มากับ Windows (ครอบคลุมจีน/ไทย/ละตินครบ) — ตั้ง path ผ่าน .env ได้
const DEFAULT_PDF_FONT_PATH = 'C:/Windows/Fonts/ARIALUNI.ttf'

// เหมือน logic ใน seed-fault-zone-map.js — derive machine_type จาก machine_id
// {FAMILY}-{เลขไลน์ 2 หลัก}-{role} → ตัด เลขไลน์+role ออก เหลือ FAMILY
const ID_PATTERN = /^(.+)-(\d{2})-((?:L|UL)(?:-\d+)?|M\d+(?:-\d+)?)$/
function deriveMachineType(machineId) {
  var m = ID_PATTERN.exec(machineId)
  return m ? m[1] : machineId
}

// 2-shift factory: day shift = [dayStartHour, dayStartHour+12), ที่เหลือ = night
function shiftOf(date, dayStartHour) {
  var h = date.getHours()
  var start = dayStartHour
  var end = (dayStartHour + 12) % 24
  var inDay = start < end ? (h >= start && h < end) : (h >= start || h < end)
  return inDay ? 'Day' : 'Night'
}

async function fetchEvidencePackData(pool, opts) {
  // opts: { machineId, alarmText(optional), start, end, label, targetPct, dayShiftStartHour }
  const conn = await pool.getConnection()
  try {
    const machineType = deriveMachineType(opts.machineId)

    // 1. ถ้าไม่ระบุ alarm_text → เลือกตัวที่เกิดบ่อยสุดในช่วงเวลาที่เลือก
    var alarmText = opts.alarmText
    if (!alarmText) {
      const topResult = await conn.execute(
        `SELECT * FROM (
           SELECT ALARM_TEXT, COUNT(*) AS CNT
           FROM PAEAPTRACE.EAP_EQP_ALM
           WHERE DATE_TIME >= :start_date AND DATE_TIME <= :end_date
             AND COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = :machine_id
             AND ALARM_TEXT IS NOT NULL
           GROUP BY ALARM_TEXT
           ORDER BY CNT DESC
         ) WHERE ROWNUM <= 1`,
        { start_date: opts.start, end_date: opts.end, machine_id: opts.machineId }
      )
      if (!topResult.rows || !topResult.rows.length) {
        return { noAlarms: true, machineId: opts.machineId, machineType: machineType, label: opts.label }
      }
      alarmText = topResult.rows[0].ALARM_TEXT
    }

    // 2. occurrence ทั้งหมดของ fault นี้ในช่วงเวลา
    const occResult = await conn.execute(
      `SELECT DATE_TIME, ALARM_CATEGORY FROM PAEAPTRACE.EAP_EQP_ALM
       WHERE DATE_TIME >= :start_date AND DATE_TIME <= :end_date
         AND COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = :machine_id
         AND ALARM_TEXT = :alarm_text
       ORDER BY DATE_TIME`,
      { start_date: opts.start, end_date: opts.end, machine_id: opts.machineId, alarm_text: alarmText }
    )
    const occurrences = occResult.rows || []

    // 3. read rate (OK/ERROR panel) ของเครื่องในช่วงเวลาเดียวกัน — สูตรเดียวกับ fetchQrSummary
    const rateResult = await conn.execute(
      `SELECT
         SUM(CASE WHEN PANEL_ID IS NULL OR DBMS_LOB.GETLENGTH(PANEL_ID) = 0 OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) = 'ERROR' OR UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) LIKE '%NULL%' THEN 1 ELSE 0 END) AS ERR_CNT,
         SUM(CASE WHEN PANEL_ID IS NOT NULL AND DBMS_LOB.GETLENGTH(PANEL_ID) > 0 AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 5, 1)) <> 'ERROR' AND UPPER(DBMS_LOB.SUBSTR(PANEL_ID, 20, 1)) NOT LIKE '%NULL%' THEN 1 ELSE 0 END) AS OK_CNT
       FROM PAEAPTRACE.EAP_EQP_EVENT_PNL_PNL
       WHERE DATE_TIME >= :start_date AND DATE_TIME <= :end_date
         AND COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = :machine_id`,
      { start_date: opts.start, end_date: opts.end, machine_id: opts.machineId }
    )
    const rateRow = (rateResult.rows && rateResult.rows[0]) || {}
    const okCnt = rateRow.OK_CNT || 0
    const errCnt = rateRow.ERR_CNT || 0
    const totalPanels = okCnt + errCnt
    const readRatePct = totalPanels > 0 ? Math.round((okCnt / totalPanels) * 10000) / 100 : null

    // 4. zone mapping — LEFT JOIN แบบ manual (query แยก) ถ้าตารางยังไม่มี/ไม่เจอแถว → degrade แบบไม่มี zone
    var zoneRow = null
    var allZones = []
    try {
      const zoneResult = await conn.execute(
        `SELECT ZONE_ID, ZONE_LABEL, DESCRIPTION, SEVERITY, CAUSES, TYPICAL_CAUSE
         FROM FAULT_ZONE_MAP WHERE MACHINE_TYPE = :machine_type AND ALARM_TEXT = :alarm_text`,
        { machine_type: machineType, alarm_text: alarmText }
      )
      zoneRow = (zoneResult.rows && zoneResult.rows[0]) || null

      // ★ ดึงโซนทั้งหมดของเครื่องรุ่นนี้ (distinct) เพื่อวาด flow diagram — เรียงตาม ZONE_ORDER
      const allZonesResult = await conn.execute(
        `SELECT ZONE_ID, MIN(ZONE_LABEL) AS ZONE_LABEL, MIN(ZONE_ORDER) AS ZONE_ORDER
         FROM FAULT_ZONE_MAP
         WHERE MACHINE_TYPE = :machine_type AND ZONE_ID IS NOT NULL
         GROUP BY ZONE_ID
         ORDER BY MIN(ZONE_ORDER), ZONE_ID`,
        { machine_type: machineType }
      )
      allZones = (allZonesResult.rows || []).map(function(r) {
        return { zoneId: r.ZONE_ID, zoneLabel: r.ZONE_LABEL, zoneOrder: r.ZONE_ORDER }
      })
    } catch (e) {
      console.warn('[EvidencePack] FAULT_ZONE_MAP query failed (ตารางอาจยังไม่ถูกสร้าง — ดู oracle_setup.sql ข้อ 6):', e.message)
    }

    // 5. หา occurrence ที่มี event sequence รอบข้างสมบูรณ์ที่สุด (นับ alarm รอบข้าง ±60 วิ)
    const contextResult = await conn.execute(
      `SELECT * FROM (
         SELECT DATE_TIME, ALARM_TEXT, ALARM_CATEGORY
         FROM PAEAPTRACE.EAP_EQP_ALM
         WHERE DATE_TIME >= :start_date AND DATE_TIME <= :end_date
           AND COALESCE(SUB_EQP_ID, MAIN_EQP_ID) = :machine_id
         ORDER BY DATE_TIME
       ) WHERE ROWNUM <= 5000`,
      { start_date: opts.start, end_date: opts.end, machine_id: opts.machineId }
    )
    const contextRows = contextResult.rows || []

    const WINDOW_MS = 60 * 1000
    var best = null, bestScore = -1
    occurrences.forEach(function(occ) {
      var t = occ.DATE_TIME.getTime()
      var nearby = contextRows.filter(function(r) {
        return Math.abs(r.DATE_TIME.getTime() - t) <= WINDOW_MS
      })
      if (nearby.length > bestScore) {
        bestScore = nearby.length
        best = { time: occ.DATE_TIME, nearby: nearby }
      }
    })
    const eventSequence = best
      ? best.nearby.slice().sort(function(a, b) { return a.DATE_TIME - b.DATE_TIME })
      : []

    // 6. occurrence pattern แยกตามวัน + shift
    var patternMap = new Map()
    occurrences.forEach(function(occ) {
      var d = occ.DATE_TIME
      var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      var shift = shiftOf(d, opts.dayShiftStartHour)
      var key = dateStr + '|' + shift
      patternMap.set(key, (patternMap.get(key) || 0) + 1)
    })
    var occurrencePattern = Array.from(patternMap.entries()).map(function(entry) {
      var parts = entry[0].split('|')
      return { date: parts[0], shift: parts[1], count: entry[1] }
    }).sort(function(a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return a.shift < b.shift ? -1 : 1
    })

    var causes = []
    if (zoneRow && zoneRow.CAUSES) {
      try { causes = JSON.parse(zoneRow.CAUSES) } catch (e) { causes = [] }
    }

    return {
      machineId: opts.machineId,
      machineType: machineType,
      alarmText: alarmText,
      label: opts.label,
      occurrenceCount: occurrences.length,
      readRatePct: readRatePct,
      targetPct: opts.targetPct,
      totalPanels: totalPanels,
      okCnt: okCnt,
      errCnt: errCnt,
      zone: zoneRow ? {
        zoneId: zoneRow.ZONE_ID,
        zoneLabel: zoneRow.ZONE_LABEL,
        description: zoneRow.DESCRIPTION,
        severity: zoneRow.SEVERITY,
        typicalCause: zoneRow.TYPICAL_CAUSE,
      } : null,
      allZones: allZones,
      causes: causes,
      representativeTime: best ? best.time : null,
      eventSequence: eventSequence,
      occurrencePattern: occurrencePattern,
    }
  } finally {
    await conn.close()
  }
}

function fmtTime(d) {
  var pad = function(n, w) { w = w || 2; return String(n).padStart(w, '0') }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3)
}

const ZONE_DIAGRAM_HEIGHT = 150

/**
 * วาด zone flow diagram — กล่องโซนเรียงซ้าย→ขวาตาม ZONE_ORDER พร้อมลูกศรเชื่อม
 * โซนที่เกิด fault จะถูก highlight (กรอบหนา + พื้นสี + leader line ชี้ลงมาที่คำอธิบาย)
 * ★ ไม่ใช่รูปเครื่องจริง — เป็น diagram เชิงกระบวนการที่สร้างจาก FAULT_ZONE_MAP
 */
function drawZoneFlow(doc, data, x, y, width) {
  const zones = data.allZones || []
  const activeZoneId = data.zone && data.zone.zoneId

  // ไม่มีข้อมูลโซนเลย → บอกตรง ๆ ว่ายังไม่ได้ map (ไม่วาดกล่องปลอม)
  if (!zones.length) {
    doc.rect(x, y, width, ZONE_DIAGRAM_HEIGHT).dash(3, { space: 3 }).stroke('#bbb').undash()
    doc.fontSize(10).fillColor('#888')
    doc.text('No zones mapped for machine type "' + data.machineType + '" yet.', x + 15, y + 60, { width: width - 30 })
    doc.fontSize(8).text('Populate FAULT_ZONE_MAP (ZONE_ID / ZONE_LABEL / ZONE_ORDER) to render this diagram.', x + 15, y + 78, { width: width - 30 })
    doc.fillColor('#000')
    return
  }

  const n = zones.length
  const gap = 14
  const arrowW = 10
  const boxW = Math.max(48, (width - (n - 1) * (gap + arrowW)) / n)
  const boxH = 54
  const boxY = y + 18

  var cursorX = x
  var activeBox = null

  zones.forEach(function(z, i) {
    const isActive = activeZoneId && z.zoneId === activeZoneId

    if (isActive) {
      doc.rect(cursorX, boxY, boxW, boxH).fillAndStroke('#ffe8e8', '#b00000')
      doc.lineWidth(2).rect(cursorX, boxY, boxW, boxH).stroke('#b00000').lineWidth(1)
      activeBox = { x: cursorX, w: boxW }
    } else {
      doc.rect(cursorX, boxY, boxW, boxH).fillAndStroke('#f7f7f7', '#cccccc')
    }

    doc.fillColor(isActive ? '#b00000' : '#555')
    doc.fontSize(8).text(z.zoneId, cursorX + 3, boxY + 7, { width: boxW - 6, align: 'center' })
    doc.fillColor(isActive ? '#000' : '#777')
    doc.fontSize(7).text(z.zoneLabel || '', cursorX + 3, boxY + 20, {
      width: boxW - 6, align: 'center', height: boxH - 24, ellipsis: true,
    })
    doc.fillColor('#000')

    // ลูกศรเชื่อมไปกล่องถัดไป
    if (i < n - 1) {
      const ax = cursorX + boxW + gap / 2
      const ay = boxY + boxH / 2
      doc.moveTo(ax, ay).lineTo(ax + arrowW, ay).stroke('#999')
      doc.moveTo(ax + arrowW, ay).lineTo(ax + arrowW - 4, ay - 3)
        .lineTo(ax + arrowW - 4, ay + 3).fill('#999')
      doc.fillColor('#000')
    }
    cursorX += boxW + gap + arrowW
  })

  // leader line + คำอธิบาย fault ใต้กล่องที่ highlight
  const textY = boxY + boxH + 22
  if (activeBox) {
    const lx = activeBox.x + activeBox.w / 2
    doc.moveTo(lx, boxY + boxH).lineTo(lx, textY - 6).stroke('#b00000')
    doc.moveTo(lx, textY - 6).lineTo(lx - 3, textY - 11).lineTo(lx + 3, textY - 11).fill('#b00000')
    doc.fillColor('#000')

    doc.fontSize(9).fillColor('#b00000').text(data.alarmText, x, textY, { width: width })
    if (data.zone.description) {
      doc.fontSize(8).fillColor('#555').text(data.zone.description, x, textY + 12, { width: width })
    }
    doc.fillColor('#000')
  } else {
    doc.fontSize(8).fillColor('#888')
    doc.text('This fault has no zone assigned yet — no zone highlighted above.', x, textY, { width: width })
    doc.fillColor('#000')
  }
}

// สร้าง PDF และ stream ตรงเข้า res — คืนค่า reportId
function generatePdf(data, res, reportConfig) {
  reportConfig = reportConfig || {}
  const reportId = 'VEP-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + Date.now().toString(36).toUpperCase()
  const doc = new PDFDocument({ margin: 50, size: 'A4' })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', 'inline; filename="evidence-pack-' + data.machineId + '.pdf"')
  doc.pipe(res)

  var fontPath = reportConfig.fontPath || DEFAULT_PDF_FONT_PATH
  try {
    if (fs.existsSync(fontPath)) {
      doc.registerFont('body', fontPath)
      doc.font('body')
    } else {
      console.warn('[EvidencePack] ไม่พบไฟล์ฟอนต์ที่ ' + fontPath + ' — ข้อความจีน/ไทยใน PDF จะเพี้ยน (mojibake). ตั้งค่า PDF_FONT_PATH ใน .env ให้ชี้ไปยังฟอนต์ที่ครอบคลุม Unicode')
    }
  } catch (e) {
    console.warn('[EvidencePack] โหลดฟอนต์ไม่สำเร็จ:', e.message)
  }

  doc.fontSize(18).text('Vendor Evidence Pack')
  doc.moveDown(0.3)
  doc.fontSize(10).fillColor('#555')
  doc.text('Machine: ' + data.machineId + (reportConfig.plant ? '   |   Plant: ' + reportConfig.plant : ''))

  if (data.noAlarms) {
    doc.moveDown(1)
    doc.fillColor('#000').fontSize(12).text('No alarms recorded for this machine in the selected period (' + data.label + ').')
    doc.moveDown(2)
    doc.fontSize(8).fillColor('#888')
    doc.text('Report ID: ' + reportId + '   |   Generated: ' + new Date().toISOString() + '   |   Source: SENTRA — EAP Factory Dashboard')
    doc.end()
    return reportId
  }

  doc.text('Fault: ' + data.alarmText)
  doc.text('Period: ' + data.label)
  doc.text('Occurrences: ' + data.occurrenceCount)
  doc.text('Read rate: ' + (data.readRatePct != null ? data.readRatePct + '%' : 'N/A') + '  (target ' + data.targetPct + '%)')
  doc.fillColor('#000')
  doc.moveDown(1)

  // Schematic — zone flow diagram สร้างจากข้อมูลใน FAULT_ZONE_MAP (ไม่ใช่รูปเครื่องจริง)
  doc.fontSize(13).text('Machine Zone Diagram', { underline: true })
  doc.moveDown(0.3)
  const boxTop = doc.y
  drawZoneFlow(doc, data, 50, boxTop, 495)
  doc.y = boxTop + ZONE_DIAGRAM_HEIGHT + 15

  // Symptom vs cause
  doc.fontSize(13).text('Symptom vs. Cause', { underline: true })
  doc.moveDown(0.3)
  doc.fontSize(10)
  if (data.causes && data.causes.length) {
    doc.text('"' + data.alarmText + '" is a downstream symptom. Upstream cause(s) observed in the same event chain: ' + data.causes.join(', ') + '.')
  } else {
    doc.text('No upstream cause chain mapped yet for this fault.')
  }
  if (data.zone && data.zone.typicalCause) {
    doc.moveDown(0.2)
    doc.text('Hypothesized root cause: ' + data.zone.typicalCause)
  }
  doc.moveDown(1)

  // Event sequence
  doc.fontSize(13).text('Event Sequence (representative occurrence)', { underline: true })
  doc.moveDown(0.3)
  doc.fontSize(9)
  if (data.eventSequence.length) {
    data.eventSequence.forEach(function(ev) {
      doc.text(fmtTime(ev.DATE_TIME) + '  [' + (ev.ALARM_CATEGORY || '-') + ']  ' + ev.ALARM_TEXT)
    })
  } else {
    doc.text('No event sequence found around the representative occurrence.')
  }
  doc.moveDown(1)

  // Occurrence pattern
  doc.fontSize(13).text('Occurrence Pattern', { underline: true })
  doc.moveDown(0.3)
  doc.fontSize(9)
  if (data.occurrencePattern.length) {
    data.occurrencePattern.forEach(function(p) {
      doc.text(p.date + '  ' + p.shift + ' shift  —  ' + p.count + ' occurrence(s)')
    })
  } else {
    doc.text('No occurrences in this period.')
  }
  doc.moveDown(1)

  // Requested corrective action
  doc.fontSize(13).text('Requested Corrective Action', { underline: true })
  doc.moveDown(0.3)
  doc.fontSize(10)
  doc.list([
    'Identify the root cause of "' + data.alarmText + '"' +
      (data.zone && data.zone.zoneId
        ? ' at zone ' + data.zone.zoneId + (data.zone.zoneLabel ? ' (' + data.zone.zoneLabel + ')' : '') + '.'
        : '.'),
    'Provide a permanent corrective action (part replacement, calibration, software fix) — not a reset.',
    'Confirm the fix by monitoring the read rate for this machine over the following 7 days.',
  ])
  doc.moveDown(0.5)
  doc.fontSize(10).fillColor('#b00000').text('A reset without a documented root-cause explanation will not close this report.')
  doc.fillColor('#000')

  // Footer
  doc.moveDown(2)
  doc.fontSize(8).fillColor('#888')
  doc.text('Report ID: ' + reportId + '   |   Generated: ' + new Date().toISOString() + '   |   Source: SENTRA — EAP Factory Dashboard')
  if (reportConfig.contact) doc.text('Contact: ' + reportConfig.contact)
  doc.fillColor('#000')

  doc.end()
  return reportId
}

module.exports = { deriveMachineType, fetchEvidencePackData, generatePdf }
