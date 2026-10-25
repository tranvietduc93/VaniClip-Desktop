// ============================================================
//  Test tai video tu link (yt-dlp) - can mang
//    node test-dl.cjs [url]
//  Lan dau tai yt-dlp.exe ~17MB ve ./bin (dung lai cho cac lan sau).
// ============================================================
const path = require('path')
const fs = require('fs')
const ops = require('./electron/ffmpeg-ops.cjs')
const dl = require('./electron/downloader.cjs')

const ffmpegPath = require('ffmpeg-static')
ops.configure(ffmpegPath, require('ffprobe-static').path)
dl.configure(path.join(__dirname, 'bin'), ffmpegPath)

const dir = path.join(__dirname, '.testout')
fs.mkdirSync(dir, { recursive: true })

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  ' + extra : '')) }
}

async function run() {
  console.log('1) Tai yt-dlp (neu chua co)...')
  const t0 = Date.now()
  const bin = await dl.ensureYtDlp((s) => { if (s.progress % 25 === 0) process.stdout.write(`  tai ${s.progress}%\r`) })
  check('yt-dlp.exe ton tai', fs.statSync(bin).size > 1e6, `(${(fs.statSync(bin).size / 1e6).toFixed(1)}MB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)

  console.log('\n2) Kiem tra link xau bi chan')
  let blocked = false
  try { await dl.download('file:///C:/windows/system32', dir) } catch (e) { blocked = true }
  check('chan link khong phai http(s)', blocked)

  console.log('\n3) Tai video YouTube ngan (Me at the zoo, 19s, 240p)')
  const url = process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  const t1 = Date.now()
  let lastP = 0
  const r = await dl.download(url, dir, { maxRes: 240, onProgress: (p) => { lastP = p } })
  console.log('  file:', r.path)
  const info = await ops.probe(r.path)
  check('file mp4 ton tai + probe duoc', fs.existsSync(r.path) && info.duration > 5,
    `(${info.width}x${info.height}, ${info.duration.toFixed(1)}s, ${((Date.now() - t1) / 1000).toFixed(1)}s tai)`)
  check('co bao tien do', lastP > 0, `(cuoi ${lastP}%)`)

  console.log(`\n================  ${pass} PASS / ${fail} FAIL  ================`)
  if (fail) process.exit(1)
}

run().catch((e) => { console.error('\x1b[31mLOI TEST:\x1b[0m', e.message || e); process.exit(1) })
