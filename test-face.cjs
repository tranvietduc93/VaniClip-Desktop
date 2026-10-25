// ============================================================
//  Test doi khuon mat (insightface ONNX) - can mang
//    node test-face.cjs
//  Lan dau tai 3 model ~745MB ve ./models (dung lai cho cac lan sau)
//  + anh test co mat that tu repo insightface (t1.jpg).
// ============================================================
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const ops = require('./electron/ffmpeg-ops.cjs')
const fsw = require('./electron/face-swap.cjs')

const ffmpegPath = require('ffmpeg-static')
ops.configure(ffmpegPath, require('ffprobe-static').path)
fsw.configure(ffmpegPath, path.join(__dirname, 'models'))

const dir = path.join(__dirname, '.testout')
fs.mkdirSync(dir, { recursive: true })
const p = (f) => path.join(dir, f)

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  ' + extra : '')) }
}

async function fetchTo(url, dest) {
  if (fs.existsSync(dest)) return dest
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  return dest
}

async function run() {
  console.log('0) Self-test similarity transform')
  // Bien doi biet truoc: scale 2, xoay 30 do, tinh tien (10,-5)
  const th = Math.PI / 6, s = 2
  const T = [s * Math.cos(th), s * Math.sin(th), 10, -5]
  const src = [[10, 20], [80, 25], [45, 60], [30, 90], [70, 88]]
  const dst = src.map(([x, y]) => [T[0] * x - T[1] * y + T[2], T[1] * x + T[0] * y + T[3]])
  const E = fsw.similarityTransform(src, dst)
  check('khoi phuc dung tham so', E.every((v, i) => Math.abs(v - T[i]) < 1e-6), `(${E.map((v) => v.toFixed(3)).join(', ')})`)

  console.log('\n1) Tai 3 model (~745MB, lan dau mat vai phut)...')
  const t0 = Date.now()
  const printed = new Set()
  const paths = await fsw.ensureModels((st) => {
    const key = st.file + ':' + Math.floor((st.progress || 0) / 20)
    if (st.phase === 'download' && !printed.has(key)) { printed.add(key); console.log(`  ${st.file} ${st.progress}%`) }
  })
  check('3 model ton tai', ['det', 'rec', 'swap'].every((k) => fs.existsSync(paths[k])),
    `(${((Date.now() - t0) / 1000).toFixed(0)}s)`)

  console.log('\n2) Trich emap tu inswapper (protobuf)')
  const t1 = Date.now()
  const emap = fsw.extractEmap(paths.swap, path.join(__dirname, 'models', 'emap.bin'))
  check('emap 512x512', emap.length === 512 * 512, `(${((Date.now() - t1) / 1000).toFixed(1)}s)`)
  const finite = emap.every ? true : false
  let bad = 0; for (let i = 0; i < emap.length; i += 1000) if (!Number.isFinite(emap[i])) bad++
  check('emap so hop le', bad === 0)
  check('emap.bin da cache', fs.existsSync(path.join(__dirname, 'models', 'emap.bin')))

  console.log('\n3) Phat hien mat tren anh that (t1.jpg cua insightface)')
  const face1 = await fetchTo('https://raw.githubusercontent.com/deepinsight/insightface/master/python-package/insightface/data/images/t1.jpg', p('t1.jpg'))
  const ctx = await fsw.getCtx()
  const img = await fsw.decodeImage(face1)
  const faces = await fsw.detectFaces(ctx, img.frame, img.W, img.H)
  check('phat hien >= 4 mat (anh nhom)', faces.length >= 4, `(${faces.length} mat, anh ${img.W}x${img.H})`)
  check('moi mat co 5 landmark trong anh', faces.every((f) => f.kps.length === 5 &&
    f.kps.every(([x, y]) => x >= -10 && y >= -10 && x <= img.W + 10 && y <= img.H + 10)))

  console.log('\n4) Latent tu anh nguon')
  const lat = await fsw.sourceLatent(ctx, face1)
  let n = 0; for (let i = 0; i < 512; i++) n += lat[i] * lat[i]
  check('latent 512 chieu, chuan hoa ||v||=1', lat.length === 512 && Math.abs(Math.sqrt(n) - 1) < 1e-3, `(|v|=${Math.sqrt(n).toFixed(4)})`)

  console.log('\n5) Swap mat trong VIDEO (1s tu t1.jpg)')
  const r0 = spawnSync(ffmpegPath, ['-y', '-loop', '1', '-t', '1', '-i', face1, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p('facevid.mp4')], { encoding: 'utf8' })
  if (r0.status !== 0) throw new Error('gen facevid: ' + r0.stderr)
  const t2 = Date.now()
  const res = await fsw.swapFaceVideo({
    input: p('facevid.mp4'), start: 0, dur: 1, sourceImage: face1,
    output: p('faceswap.mp4'), onProgress: () => {}
  })
  const oi = await ops.probe(p('faceswap.mp4'))
  check('video ra dung kich thuoc + thoi luong', oi.width === img.W - (img.W % 2) && Math.abs(oi.duration - 1) < 0.3,
    `(${oi.width}x${oi.height}, ${oi.duration.toFixed(2)}s, ${((Date.now() - t2) / 1000).toFixed(1)}s xu ly)`)
  check('co frame duoc swap', res.swapped > 0, `(${res.swapped}/${res.frames} frame)`)

  // Pixel vung mat phai THAY DOI so voi goc (swap co tac dung)
  const f1 = await fsw.decodeImage(p('facevid.mp4'))
  const f2 = await fsw.decodeImage(p('faceswap.mp4'))
  const big = faces.sort((a, b) => b.area - a.area)[0]
  const cx = Math.round((big.box[0] + big.box[2]) / 2), cy = Math.round((big.box[1] + big.box[3]) / 2)
  let diff = 0, cnt = 0
  for (let y = cy - 20; y <= cy + 20; y += 4) for (let x = cx - 20; x <= cx + 20; x += 4) {
    const o = (y * f1.W + x) * 3
    diff += Math.abs(f1.frame[o] - f2.frame[o]); cnt++
  }
  check('pixel vung mat da thay doi', diff / cnt > 2, `(chenh lech TB ${(diff / cnt).toFixed(1)})`)

  console.log(`\n================  ${pass} PASS / ${fail} FAIL  ================`)
  if (fail) process.exit(1)
}

run().catch((e) => { console.error('\x1b[31mLOI TEST:\x1b[0m', e.message || e); console.error(e.stack); process.exit(1) })
