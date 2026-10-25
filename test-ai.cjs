// ============================================================
//  Test AI doi nen (RVM ONNX) - chay bang Node, khong can mo app
//    node test-ai.cjs
//  Lan dau tai model ~15MB ve ./models (dung lai cho cac lan sau).
// ============================================================
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const ops = require('./electron/ffmpeg-ops.cjs')
const aiv = require('./electron/ai-video.cjs')

const ffmpegPath = require('ffmpeg-static')
ops.configure(ffmpegPath, require('ffprobe-static').path)
aiv.configure(ffmpegPath, path.join(__dirname, 'models'))

const dir = path.join(__dirname, '.testout')
fs.mkdirSync(dir, { recursive: true })
const p = (f) => path.join(dir, f)

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  ' + extra : '')) }
}
const near = (a, b, tol = 0.6) => Math.abs(a - b) < tol

function gen(file, args) {
  const r = spawnSync(ffmpegPath, ['-y', ...args, p(file)], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('gen ' + file + ': ' + r.stderr)
}

async function run() {
  const initialModelStatus = aiv.getModelStatus()
  check('model status reports bundled/cache availability', initialModelStatus.available && initialModelStatus.bytes > 10e6,
    `(${initialModelStatus.state}, ${(initialModelStatus.bytes / 1e6).toFixed(1)}MB)`)
  console.log('1) Tai model RVM (neu chua co)...')
  const t0 = Date.now()
  const mp = await aiv.ensureModel((s) => {
    if (s.phase === 'download' && s.progress % 25 === 0) process.stdout.write(`  tai ${s.progress}%\r`)
  })
  check('model ton tai >10MB', fs.statSync(mp).size > 10e6, `(${(fs.statSync(mp).size / 1e6).toFixed(1)}MB, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)

  // Kiem tra ten input/output cua model dung nhu ai-video.cjs mong doi
  const ort = require('onnxruntime-node')
  const ses = await ort.InferenceSession.create(mp)
  const needIn = ['src', 'r1i', 'r2i', 'r3i', 'r4i', 'downsample_ratio']
  const needOut = ['fgr', 'pha', 'r1o', 'r2o', 'r3o', 'r4o']
  check('input names', needIn.every((k) => ses.inputNames.includes(k)), `(${ses.inputNames.join(',')})`)
  check('output names', needOut.every((k) => ses.outputNames.includes(k)), `(${ses.outputNames.join(',')})`)

  console.log('\n2) Tao video test (nguoi gia lap = testsrc)...')
  gen('aisrc.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x480:rate=30', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'])
  gen('bg.png', ['-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=0.1', '-frames:v', '1'])

  console.log('\n3) Doi nen: mau don')
  const t1 = Date.now()
  await aiv.replaceBackground({
    input: p('aisrc.mp4'), start: 0, dur: 2, bg: { type: 'color', color: '#00c853' },
    output: p('ai_color.mp4'), onProgress: () => {}
  })
  const c1 = await ops.probe(p('ai_color.mp4'))
  check('mau don: dung kich thuoc + thoi luong + audio', c1.width === 640 && c1.height === 480 && near(c1.duration, 2) && c1.hasAudio,
    `(${c1.width}x${c1.height}, ${c1.duration.toFixed(2)}s, ${((Date.now() - t1) / 1000).toFixed(1)}s xu ly)`)

  console.log('\n4) Doi nen: anh')
  await aiv.replaceBackground({
    input: p('aisrc.mp4'), start: 0.5, dur: 1, bg: { type: 'image', path: p('bg.png') },
    output: p('ai_img.mp4'), onProgress: () => {}
  })
  const c2 = await ops.probe(p('ai_img.mp4'))
  check('anh nen: trim 1s giua clip', c2.width === 640 && near(c2.duration, 1, 0.3), `(${c2.duration.toFixed(2)}s)`)

  console.log('\n5) Xoa phong (blur nen)')
  await aiv.replaceBackground({
    input: p('aisrc.mp4'), start: 0, dur: 2, bg: { type: 'blur' },
    output: p('ai_blur.mp4'), onProgress: () => {}
  })
  const c3 = await ops.probe(p('ai_blur.mp4'))
  check('blur: dung thoi luong', near(c3.duration, 2), `(${c3.duration.toFixed(2)}s)`)

  const cancelController = new AbortController()
  let cancelRejected = false
  try { fs.rmSync(p('ai_cancel.mp4'), { force: true }); fs.rmSync(p('ai_cancel.mp4.alpha.mkv'), { force: true }) } catch {}
  try {
    await aiv.replaceBackground({ input: p('aisrc.mp4'), start: 0, dur: 2, bg: { type: 'blur' }, output: p('ai_cancel.mp4'),
      signal: cancelController.signal, onProgress: () => cancelController.abort() })
  } catch (error) { cancelRejected = !!error.cancelled }
  check('background job cancellation rejects, cleans matte temp, and preserves source/output target', cancelRejected &&
    !fs.existsSync(p('ai_cancel.mp4')) && !fs.existsSync(p('ai_cancel.mp4.alpha.mkv')) && fs.existsSync(p('aisrc.mp4')))

  console.log(`\n================  ${pass} PASS / ${fail} FAIL  ================`)
  if (fail) process.exit(1)
}

run().catch((e) => { console.error('\x1b[31mLOI TEST:\x1b[0m', e.message || e); process.exit(1) })
