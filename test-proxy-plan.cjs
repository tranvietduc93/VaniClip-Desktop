// Proxy xem truoc muot: quyet dinh khi nao can + chay ffmpeg THAT tren video VFR de kiem tra CFR, GOP ngan, dung do dai.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path')
const { execFileSync } = require('child_process')
const { proxyAdvice, previewProxyArgs } = require('./electron/proxy-plan.cjs')
const ff = process.env.FFMPEG_PATH || 'ffmpeg', fp = process.env.FFPROBE_PATH || 'ffprobe'
const base = { hasVideo: true, kind: 'video', vcodec: 'h264', width: 1920, height: 1080, fps: 30, pixFmt: 'yuv420p', bitrate: 8e6, vfr: false }
const adv = (o) => proxyAdvice({ ...base, ...o })
assert.equal(adv({}).needed, false)                              // 1080p h264 binh thuong: khong can
assert.equal(adv({ vfr: true }).reason, 'vfr')
assert.equal(adv({ vcodec: 'hevc' }).needed, true)
assert.equal(adv({ width: 3840, height: 2160 }).reason, 'resolution')
assert.equal(adv({ pixFmt: 'yuv420p10le' }).reason, 'bitdepth')
assert.equal(adv({ bitrate: 80e6 }).reason, 'bitrate')
assert.equal(adv({ fps: 120 }).reason, 'fps')
assert.equal(proxyAdvice({ hasVideo: false }).needed, false); assert.equal(adv({ kind: 'image' }).needed, false)
console.log('  PASS proxyAdvice')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'))
const src = path.join(dir, 'vfr.mp4'), out = path.join(dir, 'proxy.mp4')
// Video VFR that: 3s, nguon 30fps nhung bo ngau nhien ~1/3 khung -> avg khac r_frame_rate
execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-vf', "select='not(eq(mod(n\\,3)\\,1))'", '-fps_mode', 'passthrough', '-c:v', 'libx264', '-g', '240', '-c:a', 'aac', '-shortest', src])
const probe = (f) => JSON.parse(execFileSync(fp, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]).toString())
const sv = probe(src).streams.find((s) => s.codec_type === 'video')
const num = (r) => { const [a, b] = String(r).split('/').map(Number); return a / (b || 1) }
const info = { hasVideo: true, kind: 'video', width: 1920, height: 1080, fps: num(sv.avg_frame_rate), vfr: Math.abs(num(sv.r_frame_rate) - num(sv.avg_frame_rate)) / num(sv.r_frame_rate) > 0.02 }
const args = previewProxyArgs(info, src, out)
execFileSync(ff, args, { stdio: 'pipe' })
const pv = probe(out).streams.find((s) => s.codec_type === 'video')
assert.equal(pv.avg_frame_rate, pv.r_frame_rate, 'CFR: avg == r')
assert.ok(pv.height <= 720 && pv.width % 2 === 0)
const dur = Number(probe(out).format.duration), sdur = Number(probe(src).format.duration)
assert.ok(Math.abs(dur - sdur) < 0.15, `do dai ${dur} vs ${sdur}`)
const keys = execFileSync(fp, ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', out]).toString().trim().split('\n').map((l) => Number(l.split(',')[0]))
const fps = num(pv.r_frame_rate), maxGap = Math.max(...keys.slice(1).map((k, i) => k - keys[i]))
assert.ok(maxGap <= (Math.round(fps / 2) + 1) / fps + 0.01, `GOP ngan: khoang cach khung khoa toi da ${maxGap}s`)
const bf = execFileSync(fp, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=has_b_frames', '-of', 'csv=p=0', out]).toString().trim()
assert.equal(bf, '0', 'khong B-frame')
console.log(`  PASS proxy VFR -> CFR ${pv.r_frame_rate}, khung khoa moi <= ${maxGap.toFixed(2)}s, ${dur.toFixed(2)}s`)
fs.rmSync(dir, { recursive: true, force: true })
