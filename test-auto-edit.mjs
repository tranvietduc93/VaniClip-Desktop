import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parseManualReply, mapCaptionsToTimeline, musicGain, planToTimeline, planDuration, removeSegment, moveSegment } from './src/renderer/auto-edit-plan.js'
const require = createRequire(import.meta.url)
const ae = require('./electron/auto-edit.cjs')
let n = 0
const t = (name, fn) => { fn(); n++; console.log('  PASS ' + name) }

t('parseDurationFromPrompt', () => {
  assert.equal(ae.parseDurationFromPrompt('Dựng video 30 giây review'), 30)
  assert.equal(ae.parseDurationFromPrompt('khoảng 2 phút thôi'), 120)
  assert.equal(ae.parseDurationFromPrompt('1 phút 30 giây'), 90)
  assert.equal(ae.parseDurationFromPrompt('cắt gọn, không giới hạn'), 0)
})
t('detectRatioFromPrompt', () => {
  assert.equal(ae.detectRatioFromPrompt('làm video dọc cho TikTok'), '9:16')
  assert.equal(ae.detectRatioFromPrompt('video ngang đăng YouTube'), '16:9')
  assert.equal(ae.detectRatioFromPrompt('khung vuông 1:1'), '1:1')
  assert.equal(ae.detectRatioFromPrompt('dựng đẹp'), null)
})
t('parseSceneTimes lọc sát mép và trùng', () => {
  const err = 'pts_time:0.1\npts_time:4.2\npts_time:4.5\npts_time:9.9\npts_time:29.8'
  assert.deepEqual(ae.parseSceneTimes(err, 30), [4.2, 9.9])
})
t('parseMeanVolume', () => {
  assert.deepEqual(ae.parseMeanVolume('mean_volume: -21.3 dB\n max_volume: -3.0 dB'), { meanDb: -21.3, maxDb: -3 })
  assert.equal(ae.parseMeanVolume('mean_volume: -inf dB').meanDb, null)
})
t('buildCandidates: cắt theo cảnh, giao khoảng nói, tách đoạn dài', () => {
  const asset = { id: 'a', name: 'x.mp4', kind: 'video', duration: 40 }
  const tr = [{ start: 1, end: 5, text: 'xin chào các bạn' }, { start: 25, end: 30, text: 'cảm ơn' }]
  const c = ae.buildCandidates(asset, 0, { cuts: [20], speech: [{ start: 0.5, end: 6 }, { start: 24, end: 31 }], transcript: tr })
  assert.equal(c.length, 2)
  assert.deepEqual([c[0].start, c[0].end], [0.5, 6]); assert.equal(c[0].text, 'xin chào các bạn')
  const long = ae.buildCandidates(asset, 1, { cuts: [], transcript: [], maxLen: 10 })
  assert.ok(long.length >= 4 && long.every((x) => x.end - x.start <= 10.01), JSON.stringify(long.map((x) => [x.start, x.end])))
  assert.ok(Math.abs(long.reduce((s, x) => s + x.end - x.start, 0) - 40) < 0.01)
  assert.equal(ae.buildCandidates({ id: 'i', name: 'p.png', kind: 'image' }, 2)[0].end, 3)
})
t('normalizeSelection bỏ id lạ/trùng, giữ thứ tự AI', () => {
  const cands = [{ id: 'a0-0', start: 0, end: 3 }, { id: 'a0-1', start: 3, end: 6 }]
  const r = ae.normalizeSelection([{ id: 'a0-1', score: 99 }, { id: 'zzz' }, { id: 'a0-1' }, { id: 'a0-0', score: 'x' }], cands)
  assert.deepEqual(r.map((x) => x.id), ['a0-1', 'a0-0']); assert.equal(r[0].score, 10); assert.equal(r[1].score, 5)
})
t('fitToTarget: bỏ đoạn điểm thấp, không kéo dài', () => {
  const s = [{ id: 'a', start: 0, end: 10, score: 9 }, { id: 'b', start: 0, end: 10, score: 2 }, { id: 'c', start: 0, end: 10, score: 7 }]
  assert.deepEqual(ae.fitToTarget(s, 20).map((x) => x.id), ['a', 'c'])
  assert.equal(ae.fitToTarget(s, 0).length, 3)
  assert.equal(ae.fitToTarget(s, 100).length, 3)
  const one = ae.fitToTarget([{ id: 'a', start: 0, end: 10, score: 5 }], 6)
  assert.equal(one[0].end, 6)
})
t('resourceBudget thích ứng RAM/độ dài', () => {
  const low = ae.resourceBudget({ cores: 4, freeMem: 2 * 2 ** 30, totalSeconds: 100 })
  const hi = ae.resourceBudget({ cores: 16, freeMem: 16 * 2 ** 30, totalSeconds: 100 })
  assert.ok(low.maxFramesPerRequest <= 20 && hi.maxFramesPerRequest === 40)
  assert.equal(low.whisperModel, 'Xenova/whisper-tiny'); assert.equal(hi.whisperModel, 'Xenova/whisper-base')
  assert.equal(ae.resourceBudget({ cores: 16, freeMem: 16 * 2 ** 30, totalSeconds: 4 * 3600 }).whisperModel, 'Xenova/whisper-tiny')
})
t('buildPlanParts xen kẽ chữ + ảnh', () => {
  const parts = ae.buildPlanParts({ instruction: 'dựng gọn', ratio: '9:16', targetSeconds: 30,
    candidates: [{ id: 'a0-0', assetName: 'f.mp4', kind: 'video', start: 0, end: 4, text: 'hi' }], thumbs: { 'a0-0': 'QUJD' } })
  assert.equal(parts[0].type, 'text'); assert.match(parts[0].text, /30 seconds/); assert.equal(parts[2].type, 'image')
})
t('mapCaptionsToTimeline: ánh xạ qua cắt/sắp xếp', () => {
  const segs = [{ assetId: 'v', kind: 'video', in: 10, out: 14 }, { assetId: 'v', kind: 'video', in: 2, out: 6 }]
  const caps = mapCaptionsToTimeline(segs, { v: [{ start: 3, end: 5, text: 'sau' }, { start: 11, end: 13, text: 'trước' }, { start: 7, end: 9, text: 'bỏ' }] })
  assert.deepEqual(caps.map((c) => [c.text, c.start, c.end]), [['trước', 1, 3], ['sau', 5, 7]])
})
t('musicGain: nhạc thấp hơn giọng, có chặn', () => {
  assert.equal(musicGain({ voiceDb: -20, musicDb: -20, hasVoice: true }), 0.126)
  assert.equal(musicGain({ voiceDb: -20, musicDb: -50, hasVoice: true }), 1)
  assert.equal(musicGain({ musicDb: null, hasVoice: true }), 0.2)
  assert.equal(musicGain({ musicDb: -18, hasVoice: false }), 1)
})
t('planToTimeline + sửa bản xem trước', () => {
  let plan = { ratio: '16:9', loudness: { voiceDb: -20, musicDb: -20 }, transcripts: { v: [{ start: 1, end: 3, text: 'xin chào' }] },
    segments: [{ id: 's1', assetId: 'v', kind: 'video', in: 0, out: 5 }, { id: 's2', assetId: 'p', kind: 'image', in: 0, out: 3 }] }
  const r = planToTimeline(plan, { captions: true, music: { assetId: 'm' } })
  assert.equal(r.ratio, '16:9'); assert.equal(r.duration, 8); assert.equal(r.music.ducking, true); assert.equal(r.captions.length, 1)
  assert.deepEqual(r.clips[1], { assetId: 'p', kind: 'image', in: 0, out: 3, speed: 1 })
  plan = moveSegment(plan, 's2', -1); assert.equal(plan.segments[0].id, 's2')
  plan = removeSegment(plan, 's1'); assert.equal(planDuration(plan.segments), 3)
  assert.equal(planToTimeline({ ...plan, ratio: 'weird' }).ratio, '9:16')
})
t('mergeEnsemble: bỏ phiếu, điểm trung bình, thứ tự', () => {
  const a = { title: 'A', selected: [{ id: 'x', score: 9 }, { id: 'y', score: 6 }, { id: 'z', score: 3 }] }
  const b = { selected: [{ id: 'y', score: 8 }, { id: 'x', score: 7 }] }
  const c = { selected: [{ id: 'x', score: 8 }, { id: 'w', score: 9 }] }
  const m = ae.mergeEnsemble([a, b, c])
  assert.deepEqual(m.selected.map((e) => e.id), ['x', 'y'])               // z, w chi 1/3 phieu -> bi loai
  assert.equal(m.selected[0].score, 8); assert.equal(m.title, 'A')
  assert.deepEqual(ae.mergeEnsemble([a]).selected.map((e) => e.id), ['x', 'y', 'z'])   // 1 bo nao: giu nguyen
  assert.deepEqual(ae.mergeEnsemble([null, {}]).selected, [])
})
t('parseManualReply: chỉ nhận JSON hợp lệ của lượt này, bỏ qua câu lệnh đã chép', () => {
  const prompt = 'USER INSTRUCTION ...\nCANDIDATES:\n[a0-1] file=x\n[a0-2] file=y\nReply with {"selected":[{"id":"a0-3"}]}'
  assert.equal(parseManualReply(prompt, prompt), null)
  assert.equal(parseManualReply('xin chào', prompt), null)
  assert.equal(parseManualReply('{"selected":[{"id":"zzz"}]}', prompt), null)           // id khong thuoc luot nay
  assert.equal(parseManualReply('{"title":"x"}', prompt), null)
  const ok = '```json\n{"title":"T","selected":[{"id":"a0-2","score":8}]}\n```'
  assert.equal(parseManualReply(ok, prompt), ok)
})
console.log(`\n${n} test auto-edit đạt`)
