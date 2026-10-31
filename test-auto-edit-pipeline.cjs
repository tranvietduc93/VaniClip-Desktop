// Kiem thu pipeline AI Auto Edit voi ffmpeg THAT (can ffmpeg trong PATH hoac FFMPEG_PATH); Whisper va AI duoc gia lap.
const { execFileSync, spawnSync } = require('child_process')
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert')
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', ffprobe = process.env.FFPROBE_PATH || 'ffprobe'
const ae = require('./electron/auto-edit.cjs'); ae.configure(ffmpeg)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-test-'))
const vid = path.join(dir, 'clip.mp4'), img = path.join(dir, 'pic.png'), mus = path.join(dir, 'music.wav')
// 3 canh mau (8s moi canh) + tieng bip 0-6s, im lang 6-10s, bip 10-24s
execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=15:d=8', '-f', 'lavfi', '-i', 'color=c=green:s=320x240:r=15:d=8', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=15:d=8',
  '-f', 'lavfi', '-i', 'sine=f=440:d=24', '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v];[3]volume=enable=\'between(t,6,10)\':volume=0[a]', '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', vid])
execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:s=200x200:d=1', '-frames:v', '1', img])
execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=10', mus])
const probe = async (p) => {
  const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', p]).toString())
  const a = j.streams.some((s) => s.codec_type === 'audio'), isImg = /\.png$/.test(p)
  return { duration: Number(j.format.duration) || 0, hasAudio: a, kind: isImg ? 'image' : 'video' }
}
const detectSilence = async (p, { noise, minSilence }) => {
  const r = spawnSync(ffmpeg, ['-i', p, '-af', `silencedetect=noise=${noise}:d=${minSilence}`, '-f', 'null', '-'], { encoding: 'utf8' })
  const st = [...r.stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => +m[1]), en = [...r.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => +m[1])
  return st.map((s, i) => ({ start: Math.max(0, s), end: en[i] ?? null }))
}
;(async () => {
  let ops; try { ops = require('./electron/ffmpeg-ops.cjs') } catch { ops = null }
  const keepFn = ops ? ops.computeKeep : (d, sil, pad) => { const k = []; let c = 0; for (const s of sil) { if (s.start - c > .12) k.push({ start: c, end: s.start + pad }); c = s.end - pad } if (d - c > .12) k.push({ start: c, end: d }); return k }
  const whisper = { transcribe: async () => [{ start: 1, end: 4, text: 'Xin chào các bạn' }, { start: 12, end: 15, text: 'Đây là cảnh xanh lá' }] }
  const progress = []
  const base = { instruction: 'Dựng video dọc 12 giây gọn gàng', assets: [{ id: 'v', name: 'clip.mp4', path: vid, kind: 'video' }, { id: 'p', name: 'pic.png', path: img, kind: 'image' }], music: { path: mus } }
  const deps = { whisper, cacheDir: path.join(dir, 'cache'), probe, detectSilence, computeKeep: keepFn, onProgress: (p) => progress.push(p.phase) }

  // 1) Khong co AI -> bo lap ke hoach cuc bo, vua 12s, ty le doc tu cau lenh
  const local = await ae.runAutoEdit(base, { ...deps, callPlanner: null })
  assert.equal(local.ratio, '9:16'); assert.equal(local.engine, 'heuristic'); assert.equal(local.targetSeconds, 12)
  const len = local.segments.reduce((s, x) => s + x.out - x.in, 0)
  assert.ok(len <= 12.06 && len > 3, 'tong ' + len)
  assert.ok(local.segments.every((s) => s.thumb && fs.existsSync(s.thumb)), 'co khung hinh xem truoc')
  assert.ok(!local.segments.some((s) => s.kind === 'video' && s.in >= 6.3 && s.out <= 9.7), 'da cat doan im lang')
  assert.ok(Number.isFinite(local.loudness.voiceDb) && Number.isFinite(local.loudness.musicDb), 'do am luong')
  assert.ok(local.transcripts.v.length === 2)
  console.log('  PASS cục bộ:', local.segments.map((s) => `${s.assetName}[${s.in}-${s.out}]`).join(' '))

  // 2) AI gia lap: nhan anh + doan, tra ve thu tu dao nguoc, chi lay 2 doan
  let seen = null
  const callPlanner = async (parts, system) => {
    seen = parts; assert.ok(system.includes('JSON'))
    const ids = parts.filter((p) => p.type === 'text').map((p) => /^\[(a\d+-\d+)\]/.exec(p.text)?.[1]).filter(Boolean)
    return '```json\n' + JSON.stringify({ title: 'Test', summary: 'ok', selected: ids.slice().reverse().slice(0, 2).map((id, i) => ({ id, score: 9 - i, reason: 'r' })) }) + '\n```'
  }
  const ai = await ae.runAutoEdit({ ...base, instruction: 'bất kỳ', targetSeconds: 0, ratio: '16:9' }, { ...deps, callPlanner })
  assert.equal(ai.engine, 'ai'); assert.equal(ai.ratio, '16:9'); assert.equal(ai.segments.length, 2)
  assert.ok(seen.some((p) => p.type === 'image' && p.base64.length > 100), 'AI nhan duoc anh that')
  assert.equal(ai.segments[0].candidateId.startsWith('a1') || ai.segments[0].candidateId.startsWith('a0'), true)
  console.log('  PASS AI giả lập: thứ tự', ai.segments.map((s) => s.candidateId).join(','))

  // 2b) Che do web (dan tay): goi cau lenh + anh ghep, "nguoi dung" dan lai JSON co rao markdown
  let pkg = null
  const manual = async (parts, system, batch) => {
    pkg = await ae.buildManualPackage(parts, system, { dir: path.join(batch.jobDir, 'manual') })
    const ids = [...pkg.prompt.matchAll(/^\[(a\d+-\d+)\].*<- tile #\d+/gm)].map((m) => m[1])
    return 'Đây là kết quả:\n```json\n' + JSON.stringify({ title: 'Web', selected: ids.slice(0, 1).map((id) => ({ id, score: 8 })) }) + '\n```'
  }
  const web = await ae.runAutoEdit(base, { ...deps, callPlanner: manual })
  assert.equal(web.segments.length, 1); assert.ok(pkg.sheetPath && fs.statSync(pkg.sheetPath).size > 500); assert.ok(/contact sheet/.test(pkg.prompt))
  console.log('  PASS chế độ web dán tay: ảnh ghép + prompt, parse JSON có rào markdown')

  // 3) Huy giua chung
  const ctl = new AbortController(); ctl.abort()
  await assert.rejects(() => ae.runAutoEdit(base, { ...deps, callPlanner: null, signal: ctl.signal }), (e) => e.cancelled)
  console.log('  PASS hủy tác vụ'); console.log('phases:', [...new Set(progress)].join(','))
  fs.rmSync(dir, { recursive: true, force: true })
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
