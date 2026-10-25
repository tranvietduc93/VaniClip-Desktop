import assert from 'node:assert/strict'
import { assignMedia, planSceneClips, piecesDuration, splitSceneCaptions } from './src/renderer/script-plan.js'
import { createRequire } from 'node:module'
const { normalizeScenes } = createRequire(import.meta.url)('./electron/claude.cjs')

// normalizeScenes: lien tuc, bat dau tai 0, ket thuc dung tong
const raw = [{ text: 'a', start: 0.4, end: 3 }, { text: 'b', start: 3.2, end: 6 }, { text: 'c', start: 6, end: 9 }]
const n = normalizeScenes(raw, { totalDuration: 10, mediaCount: 0 })
assert.equal(n[0].start, 0); assert.equal(n[1].start, n[0].end); assert.equal(n[2].start, n[1].end); assert.equal(n[2].end, 10)
assert.throws(() => normalizeScenes([], {}))

// assignMedia: giu goi y cua Claude, dien canh trong bang file chua dung
const assets = [{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }]
const as = assignMedia([{ media: 2 }, { media: null }, { media: null }, { media: null }], assets)
assert.equal(as[0].assetId, 'a2'); assert.deepEqual(as.slice(1, 3).map((s) => s.assetId).sort(), ['a0', 'a1']); assert.ok(as[3].assetId)
assert.equal(assignMedia([{ media: null }], [])[0].assetId, null)

// planSceneClips: tong thoi luong = so giay canh
for (const [media, d] of [[{ kind: 'image' }, 4.2], [{ kind: 'video', duration: 10 }, 3.7], [{ kind: 'video', duration: 3 }, 4.5], [{ kind: 'video', duration: 2 }, 9]]) {
  const p = planSceneClips(media, d)
  assert.ok(Math.abs(piecesDuration(p) - d) < 0.02, `${JSON.stringify(media)} d=${d} got ${piecesDuration(p)}`)
}
assert.equal(planSceneClips({ kind: 'video', duration: 20 }, 4, 6)[0].in, 6)
assert.equal(planSceneClips({ kind: 'video', duration: 8 }, 4, 6)[0].in, 0)

// splitSceneCaptions: bao toan khoang canh + offset
const caps = splitSceneCaptions({ text: 'Xin chào các bạn. Đây là câu thứ hai khá dài để thử chia nhỏ phụ đề cho hợp lý, nhé bạn ơi, cảm ơn nhiều.', start: 2, end: 10 }, 5)
assert.equal(caps[0].start, 7); assert.equal(caps.at(-1).end, 15)
for (let i = 1; i < caps.length; i++) assert.ok(Math.abs(caps[i].start - caps[i - 1].end) < 0.002)
console.log('test-script-plan: OK')
