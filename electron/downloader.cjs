// ============================================================
//  Tai video tu link (YouTube / TikTok / ...) bang yt-dlp
//  - yt-dlp.exe (~17MB) tai ve lan dau vao binDir, tu lam moi sau 30 ngay
//    (YouTube doi API lien tuc, ban cu de hong)
//  - Uu tien H.264/MP4 <=1080p de smart-cut + preview chay tot
//  Tach rieng de test doc lap (khong can Electron) - xem test-dl.cjs
// ============================================================
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { pipeline } = require('stream/promises')
const { Readable } = require('stream')

let BIN_DIR = null
let FFMPEG_PATH = null

function configure(binDir, ffmpegPath) {
  BIN_DIR = binDir
  FFMPEG_PATH = ffmpegPath
}

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const MAX_AGE_DAYS = 30

// Tai yt-dlp.exe neu chua co / da cu. Neu tai moi that bai nhung con ban cu -> dung ban cu.
async function ensureYtDlp(onStatus, { signal, timeoutMs = 120000 } = {}) {
  const dest = path.join(BIN_DIR, 'yt-dlp.exe')
  const exists = fs.existsSync(dest) && fs.statSync(dest).size > 1e6
  const fresh = exists && (Date.now() - fs.statSync(dest).mtimeMs) < MAX_AGE_DAYS * 86400e3
  if (fresh) return dest
  if (!exists && fs.existsSync(dest)) { try { fs.rmSync(dest, { force: true }) } catch {} }
  fs.mkdirSync(BIN_DIR, { recursive: true })
  try {
    if (onStatus) onStatus({ phase: 'tool', progress: 0 })
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason || new Error('Đã hủy tải yt-dlp.'))
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('Quá thời gian tải yt-dlp.')), timeoutMs)
    const tmp = dest + '.part'
    const backup = dest + '.bak'
    try {
    if (signal?.aborted) abort()
    const res = await fetch(YTDLP_URL, { redirect: 'follow', signal: controller.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    if (!res.body) throw new Error('Máy chủ không gửi dữ liệu yt-dlp.')
    const total = Number(res.headers.get('content-length')) || 0
    const out = fs.createWriteStream(tmp, { flags: 'w' })
    let got = 0
    const meter = new (require('stream').Transform)({ transform(chunk, _encoding, callback) {
      got += chunk.length
      if (onStatus && total) onStatus({ phase: 'tool', progress: Math.round((got / total) * 100) })
      callback(null, chunk)
    } })
    await pipeline(Readable.fromWeb(res.body), meter, out, { signal: controller.signal })
    if (fs.statSync(tmp).size < 1e6) throw new Error('Tệp yt-dlp tải về không đầy đủ.')
    if (exists) { try { fs.rmSync(backup, { force: true }); fs.renameSync(dest, backup) } catch (e) { throw new Error('Không thể giữ bản yt-dlp hiện tại: ' + e.message) } }
    fs.renameSync(tmp, dest)
    try { fs.rmSync(backup, { force: true }) } catch {}
    return dest
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      try { fs.rmSync(tmp, { force: true }) } catch {}
      if (!fs.existsSync(dest) && fs.existsSync(backup)) { try { fs.renameSync(backup, dest) } catch {} }
    }
  } catch (e) {
    if (e.name === 'AbortError' || signal?.aborted) throw new Error('Đã hủy tải yt-dlp.')
    if (exists) return dest // mang loi nhung con ban cu -> van dung duoc
    throw new Error('Không thể tải yt-dlp: ' + e.message)
  }
}

function checkUrl(url) {
  let u
  try { u = new URL(String(url).trim()) } catch { throw new Error('Link khong hop le') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Chi ho tro link http/https')
  return u.toString()
}

// Tai video ve outDir. Tra ve { path }. onProgress: 0-100.
// opts.maxRes: gioi han chieu cao (mac dinh 1080)
async function download(url, outDir, { maxRes = 1080, onStatus, onProgress, signal, timeoutMs = 30 * 60 * 1000 } = {}) {
  url = checkUrl(url)
  maxRes = [240, 360, 480, 720, 1080, 1440, 2160].includes(Number(maxRes)) ? Number(maxRes) : 1080
  const ytdlp = await ensureYtDlp(onStatus, { signal })
  fs.mkdirSync(outDir, { recursive: true })
  if (onStatus) onStatus({ phase: 'start' })
  return new Promise((resolve, reject) => {
    const args = [
      // height filter is a hard cap; sorter only controls preference.
      '-f', buildFormatSelector(maxRes), '-S', 'vcodec:h264,acodec:aac,ext:mp4',
      '--no-playlist', '--merge-output-format', 'mp4', '--windows-filenames',
      '--ffmpeg-location', FFMPEG_PATH,
      '-o', path.join(path.resolve(outDir), '%(title).60s [%(id)s].%(ext)s'),
      '--print', 'after_move:filepath', '--no-simulate', '--newline', '--progress',
      '--', url // '--' chan URL bat dau bang '-' bi hieu thanh flag
    ]
    if (signal?.aborted) return reject(new Error('Đã hủy tải video.'))
    const ps = spawn(ytdlp, args)
    let err = '', filePath = null
    let settled = false
    const timer = setTimeout(() => { ps.kill(); finish(new Error('Tải video quá thời gian cho phép.')) }, timeoutMs)
    const abort = () => { ps.kill(); finish(new Error('Đã hủy tải video.')) }
    const finish = (error, result) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (error) { cleanupParts(outDir); reject(error) } else resolve(result)
    }
    signal?.addEventListener('abort', abort, { once: true })
    const onLine = (line) => {
      line = line.trim()
      if (!line) return
      const m = /\[download\]\s+([\d.]+)%/.exec(line)
      if (m) { if (onProgress) onProgress(Math.min(100, Math.round(parseFloat(m[1])))); return }
      // dong khong phai log [xxx] -> co the la duong dan file cuoi (tu --print)
      if (!line.startsWith('[') && /^[a-z]:\\/i.test(line)) filePath = line
    }
    let bufOut = '', bufErr = ''
    ps.stdout.on('data', (d) => { bufOut += d; const ls = bufOut.split(/\r?\n/); bufOut = ls.pop(); ls.forEach(onLine) })
    ps.stderr.on('data', (d) => { bufErr += d; err += d; const ls = bufErr.split(/\r?\n/); bufErr = ls.pop(); ls.forEach(onLine) })
    ps.on('error', (error) => finish(new Error('Không khởi chạy được yt-dlp: ' + error.message)))
    ps.on('close', (c) => {
      if (bufOut) onLine(bufOut)
      if (c !== 0) {
        const msg = (err.match(/ERROR:?\s*(.+)/) || [])[1] || err.slice(-300) || ('yt-dlp thoat ma ' + c)
        const detail = msg.trim()
        const lower = detail.toLowerCase()
        const classified = /private|members-only|sign in|login|unavailable|not available|not found/.test(lower)
          ? 'Video riêng tư hoặc không còn khả dụng: ' + detail
          : /unsupported url|no suitable extractor/.test(lower) ? 'Website hoặc đường dẫn chưa được hỗ trợ: ' + detail
            : /network|timed out|timeout|connection|unable to download|http error/.test(lower) ? 'Lỗi mạng khi tải video: ' + detail : detail
        return finish(new Error(classified))
      }
      if (filePath && fs.existsSync(filePath)) return finish(null, { path: filePath })
      finish(new Error('Tải xong nhưng không tìm thấy file đầu ra.'))
    })
  })
}

function buildFormatSelector(maxRes) {
  const height = [240, 360, 480, 720, 1080, 1440, 2160].includes(Number(maxRes)) ? Number(maxRes) : 1080
  return `bv*[height<=?${height}]+ba/b[height<=?${height}]`
}

function cleanupParts(dir) {
  try { for (const name of fs.readdirSync(dir)) if (/\.part(-Frag\d+)?$/i.test(name)) fs.rmSync(path.join(dir, name), { force: true }) } catch {}
}

module.exports = { configure, ensureYtDlp, download, checkUrl, buildFormatSelector }
