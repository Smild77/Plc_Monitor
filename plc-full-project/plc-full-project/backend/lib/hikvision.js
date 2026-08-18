/**
 * hikvision.js — ISAPI client (Hikvision NVR / iVMS-4200 backend) — zero extra deps
 *
 * ทำ HTTP Digest auth เองด้วย Node builtin (http/https/crypto) ไม่ต้องเพิ่ม dependency
 * ใช้กับ NVR ที่ต่อผ่าน iVMS-4200 — รองรับ:
 *   - Live view (MJPEG httpPreview) — ต่อ browser ได้ตรง ไม่ต้องแปลง RTSP/HLS
 *   - Playback (ContentMgmt search + download) — ค้นหาคลิปบันทึกช่วงเวลาที่ต้องการ
 *
 * ★ ยังไม่ได้ทดสอบกับ NVR จริง (ไม่มี network access ตอนเขียน) — ต้องทดสอบกับ
 *   IP/credentials จริงก่อนใช้งาน ดู README ส่วน "กล้อง (Hikvision)"
 */
const http = require('http')
const https = require('https')
const crypto = require('crypto')

function md5(s) { return crypto.createHash('md5').update(s).digest('hex') }

// ─── Digest auth (RFC 2617) ───────────────────────────
function parseDigestChallenge(header) {
  // header เช่น: Digest realm="...", nonce="...", qop="auth", opaque="..."
  var out = {}
  var re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g
  var m
  while ((m = re.exec(header))) out[m[1]] = m[2] !== undefined ? m[2] : m[3]
  return out
}

function buildDigestHeader(challenge, opts) {
  var nc = '00000001'
  var cnonce = crypto.randomBytes(8).toString('hex')
  var ha1 = md5(opts.user + ':' + challenge.realm + ':' + opts.password)
  var ha2 = md5(opts.method + ':' + opts.uri)
  var response
  var qop = challenge.qop && challenge.qop.split(',')[0].trim()
  if (qop) {
    response = md5([ha1, challenge.nonce, nc, cnonce, qop, ha2].join(':'))
  } else {
    response = md5([ha1, challenge.nonce, ha2].join(':'))
  }
  var parts = [
    'username="' + opts.user + '"',
    'realm="' + challenge.realm + '"',
    'nonce="' + challenge.nonce + '"',
    'uri="' + opts.uri + '"',
    'response="' + response + '"',
  ]
  if (qop) parts.push('qop=' + qop, 'nc=' + nc, 'cnonce="' + cnonce + '"')
  if (challenge.opaque) parts.push('opaque="' + challenge.opaque + '"')
  if (challenge.algorithm) parts.push('algorithm=' + challenge.algorithm)
  return 'Digest ' + parts.join(', ')
}

/**
 * ยิง request ไป NVR — ถ้าเจอ 401 จะทำ digest handshake แล้ว retry ให้อัตโนมัติ
 * cfg = { host, port, user, password, useHttps }
 * ถ้า streaming=true จะ resolve เป็น response stream ดิบ (ไม่ buffer) — ใช้กับ live preview / download
 */
function isapiRequest(cfg, method, path, opts) {
  opts = opts || {}
  var lib = cfg.useHttps ? https : http
  var baseOpts = {
    host: cfg.host,
    port: cfg.port || (cfg.useHttps ? 443 : 80),
    method: method,
    path: path,
    headers: Object.assign({}, opts.headers || {}),
    timeout: opts.timeout || 15000,
  }

  return new Promise(function(resolve, reject) {
    function doRequest(authHeader) {
      var reqOpts = Object.assign({}, baseOpts)
      reqOpts.headers = Object.assign({}, baseOpts.headers)
      if (authHeader) reqOpts.headers['Authorization'] = authHeader
      if (opts.body) {
        reqOpts.headers['Content-Length'] = Buffer.byteLength(opts.body)
      }
      var req = lib.request(reqOpts, function(res) {
        if (res.statusCode === 401 && !authHeader) {
          var challengeHeader = res.headers['www-authenticate']
          res.resume() // discard body
          if (!challengeHeader) return reject(new Error('NVR ตอบ 401 แต่ไม่มี WWW-Authenticate header'))
          var challenge = parseDigestChallenge(challengeHeader)
          var digestHeader = buildDigestHeader(challenge, { user: cfg.user, password: cfg.password, method: method, uri: path })
          doRequest(digestHeader)
          return
        }
        if (res.statusCode >= 400) {
          if (opts.streaming) return resolve({ res: res, ok: false })
          var chunks = []
          res.on('data', function(c) { chunks.push(c) })
          res.on('end', function() {
            reject(new Error('ISAPI ' + path + ' → HTTP ' + res.statusCode + ': ' + Buffer.concat(chunks).toString('utf8').slice(0, 300)))
          })
          return
        }
        if (opts.streaming) return resolve({ res: res, ok: true })
        var chunks = []
        res.on('data', function(c) { chunks.push(c) })
        res.on('end', function() { resolve({ res: res, ok: true, body: Buffer.concat(chunks) }) })
      })
      req.on('error', reject)
      req.on('timeout', function() { req.destroy(new Error('NVR request timeout')) })
      if (opts.body) req.write(opts.body)
      req.end()
    }
    doRequest(null)
  })
}

// ─── Live preview (MJPEG over HTTP — เล่นได้ตรงใน <img>/browser) ──
// channel = เลข channel ใน NVR (1,2,3,...) — track main stream = channel*100+1
function livePreviewPath(channel) {
  return '/ISAPI/Streaming/channels/' + (channel * 100 + 1) + '/httpPreview'
}

async function proxyLivePreview(cfg, channel, res) {
  const result = await isapiRequest(cfg, 'GET', livePreviewPath(channel), { streaming: true, timeout: 0 })
  if (!result.ok) {
    res.writeHead(result.res.statusCode || 502, { 'Content-Type': 'text/plain' })
    result.res.pipe(res)
    return
  }
  res.writeHead(200, {
    'Content-Type': result.res.headers['content-type'] || 'multipart/x-mixed-replace',
    'Cache-Control': 'no-cache',
  })
  result.res.pipe(res)
  res.on('close', function() { result.res.destroy() })
}

// ─── Playback: ค้นหาคลิปบันทึกในช่วงเวลา แล้วส่งไฟล์ผ่าน HTTP download ──
// startTime/endTime: Date object → ISO ที่ ISAPI ต้องการ (ไม่มี ms, ต้องมี timezone offset)
function isapiTime(d) {
  var pad = function(n, w) { w = w || 2; return String(n).padStart(w, '0') }
  var tzMin = -d.getTimezoneOffset()
  var sign = tzMin >= 0 ? '+' : '-'
  var tz = sign + pad(Math.floor(Math.abs(tzMin) / 60)) + ':' + pad(Math.abs(tzMin) % 60)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + tz
}

async function searchRecordings(cfg, channel, startTime, endTime) {
  var trackId = channel * 100 + 1
  var searchId = crypto.randomUUID()
  var xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<CMSearchDescription>' +
    '<searchID>' + searchId + '</searchID>' +
    '<trackList><trackID>' + trackId + '</trackID></trackList>' +
    '<timeSpanList><timeSpan>' +
    '<startTime>' + isapiTime(startTime) + '</startTime>' +
    '<endTime>' + isapiTime(endTime) + '</endTime>' +
    '</timeSpan></timeSpanList>' +
    '<maxResults>20</maxResults>' +
    '<searchResultPostion>0</searchResultPostion>' +
    '</CMSearchDescription>'
  const result = await isapiRequest(cfg, 'POST', '/ISAPI/ContentMgmt/search', {
    body: xml,
    headers: { 'Content-Type': 'application/xml' },
  })
  var body = result.body.toString('utf8')
  var matches = []
  var re = /<searchMatchItem>[\s\S]*?<playbackURI>([\s\S]*?)<\/playbackURI>[\s\S]*?<startTime>([\s\S]*?)<\/startTime>[\s\S]*?<endTime>([\s\S]*?)<\/endTime>[\s\S]*?<\/searchMatchItem>/g
  var m
  while ((m = re.exec(body))) {
    matches.push({
      playbackUri: m[1].replace(/&amp;/g, '&'),
      start: m[2],
      end: m[3],
    })
  }
  return matches
}

// เลือกคลิปที่ครอบคลุมเวลาที่ต้องการดีที่สุด (ใกล้ตรงกลางที่สุด)
function pickBestMatch(matches, targetTime) {
  if (!matches.length) return null
  var t = targetTime.getTime()
  var best = null, bestDist = Infinity
  matches.forEach(function(m) {
    var s = new Date(m.start).getTime()
    var e = new Date(m.end).getTime()
    var dist = t < s ? s - t : (t > e ? t - e : 0)
    if (dist < bestDist) { bestDist = dist; best = m }
  })
  return best
}

async function proxyPlaybackDownload(cfg, playbackUri, res) {
  var path = '/ISAPI/ContentMgmt/download?playbackURI=' + encodeURIComponent(playbackUri)
  const result = await isapiRequest(cfg, 'GET', path, { streaming: true, timeout: 0 })
  if (!result.ok) {
    res.writeHead(result.res.statusCode || 502, { 'Content-Type': 'text/plain' })
    result.res.pipe(res)
    return
  }
  // ★ NVR อาจส่งเป็น PS (MPEG-2 Program Stream) ไม่ใช่ MP4 — เบราว์เซอร์เล่นตรงไม่ได้
  //   ต้องเช็คกับเครื่องจริงว่า content-type ที่ได้คืออะไร แล้วอาจต้อง remux ด้วย ffmpeg (ต้องคุยเรื่อง dependency ก่อน)
  res.writeHead(200, {
    'Content-Type': result.res.headers['content-type'] || 'video/mp2p',
    'Content-Disposition': 'inline; filename="playback.mp4"',
  })
  result.res.pipe(res)
  res.on('close', function() { result.res.destroy() })
}

module.exports = {
  isapiRequest,
  proxyLivePreview,
  searchRecordings,
  pickBestMatch,
  proxyPlaybackDownload,
  isapiTime,
}
