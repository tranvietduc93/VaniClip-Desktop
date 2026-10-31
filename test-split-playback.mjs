// Tach clip cung file nguon: video co the vuot diem cat giua 2 lan timeupdate -> phai chuyen sang clip ke tiep.
import assert from 'node:assert/strict'
import { buildTimelinePlan, resolvePreviewSource } from './src/renderer/timeline-plan.js'
const clips = [
  { id: 'a', path: 'v.mp4', kind: 'video', in: 0, out: 9.9, speed: 1 },
  { id: 'b', path: 'v.mp4', kind: 'video', in: 9.9, out: 20, speed: 1 }
]
const plan = buildTimelinePlan(clips)
const layout = plan.entries.map((e, entryIndex) => ({ ...e, entryIndex }))
// mo phong dung phan "da di qua doan cuoi" cua onTimeUpdate
function resolveAfterOvershoot(activeId, currentTime) {
  const passed = layout.filter((e) => e.clipId === activeId && currentTime >= e.sourceEnd - 0.02).sort((x, y) => y.sourceEnd - x.sourceEnd)[0]
  if (!passed) return null
  const gt = passed.start + (passed.sourceEnd - passed.sourceStart) / (passed.speed || 1) + 0.001
  return resolvePreviewSource(plan, gt)
}
for (const t of [9.9, 10.0, 10.15, 10.24]) {            // video vuot diem cat 0 .. 0.34s giua hai timeupdate
  const r = resolveAfterOvershoot('a', t)
  assert.equal(r?.clipId, 'b', `t=${t}`); assert.ok(Math.abs(r.sourceTime - 9.9) < 0.01, 'bat dau clip 2 tai diem cat')
}
assert.equal(resolveAfterOvershoot('a', 5), null)       // chua toi diem cat -> khong chuyen
console.log('PASS qua diem cat khi video vuot: chuyen dung sang clip 2')
