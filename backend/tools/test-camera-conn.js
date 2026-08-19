/**
 * test-camera-conn.js — ทดสอบต่อ NVR (Hikvision ISAPI) ได้ไหม โดยไม่ต้องรัน server เต็ม
 *
 * ใช้:
 *   node test-camera-conn.js            → เช็ค auth + ดึงรายชื่อ channel
 *   node test-camera-conn.js --channel=3 --search   → ทดสอบค้นหาคลิปย้อนหลัง 10 นาทีของ channel 3
 */
// ★ .env อยู่ที่ backend/ ไม่ใช่ tools/ — ระบุ path ตรงๆ จะได้รันจากที่ไหนก็ได้
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const hikvision = require('../lib/hikvision')

const cfg = {
  host: process.env.NVR_HOST,
  port: parseInt(process.env.NVR_PORT || '80'),
  user: process.env.NVR_USER,
  password: process.env.NVR_PASSWORD,
}

const channelArg = process.argv.find(a => a.startsWith('--channel='))
const channel = channelArg ? parseInt(channelArg.split('=')[1], 10) : 1
const doSearch = process.argv.includes('--search')

;(async () => {
  if (!cfg.host || !cfg.user || !cfg.password) {
    console.log('FAILED: NVR_HOST/NVR_USER/NVR_PASSWORD ยังไม่ได้ตั้งใน .env')
    process.exit(1)
  }
  console.log('Testing ISAPI auth to', cfg.host + ':' + cfg.port, '...')
  try {
    const result = await hikvision.isapiRequest(cfg, 'GET', '/ISAPI/System/deviceInfo')
    console.log('Auth OK ✓ — HTTP', result.res.statusCode)
    console.log(result.body.toString('utf8').slice(0, 500))

    if (doSearch) {
      console.log('\nSearching last 10 min on channel', channel, '...')
      const end = new Date()
      const start = new Date(end.getTime() - 10 * 60 * 1000)
      const matches = await hikvision.searchRecordings(cfg, channel, start, end)
      console.log('Found', matches.length, 'recording(s):')
      matches.forEach(m => console.log(' -', m.start, '→', m.end))
    }
  } catch (e) {
    console.log('FAILED:', e.message)
    process.exit(1)
  }
})()
