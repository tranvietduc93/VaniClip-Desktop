// AI Auto Edit -> timeline: ham thuan (khong phu thuoc React) de test duoc bang node.
// Plan do main tra ve: segments [{id, assetId, kind, in, out, score, reason, text, thumb}], transcripts {assetId: [{start,end,text}]}, loudness {voiceDb, musicDb}.
import { splitSceneCaptions } from './script-plan.js'

const round = (v, d = 3) => { const k = 10 ** d; return Math.round(v * k) / k }
export const AUTO_RATIOS = ['9:16', '16:9', '1:1']

export function planDuration(segments) { return round((segments || []).reduce((sum, s) => sum + Math.max(0, s.out - s.in), 0)) }

export function removeSegment(plan, id) { return { ...plan, segments: plan.segments.filter((s) => s.id !== id) } }

export function moveSegment(plan, id, delta) {
  const i = plan.segments.findIndex((s) => s.id === id), j = i + delta
  if (i < 0 || j < 0 || j >= plan.segments.length) return plan
  const segments = plan.segments.slice();[segments[i], segments[j]] = [segments[j], segments[i]]
  return { ...plan, segments }
}

/** Phu de tieng Viet: loi thoai (thoi gian nguon) -> thoi gian timeline sau khi cat/sap xep. Chi lay phan nam trong doan giu lai. */
export function mapCaptionsToTimeline(segments, transcripts, { maxChars = 60 } = {}) {
  const out = []
  let cursor = 0
  for (const seg of segments) {
    const len = Math.max(0, seg.out - seg.in)
    if (seg.kind !== 'image') {
      for (const c of transcripts?.[seg.assetId] || []) {
        const a = Math.max(c.start, seg.in), b = Math.min(c.end, seg.out)
        if (b - a < 0.15 || !String(c.text || '').trim()) continue
        const start = cursor + (a - seg.in), end = cursor + (b - seg.in)
        out.push(...splitSceneCaptions({ text: c.text, start, end }, 0, maxChars))
      }
    }
    cursor += len
  }
  return out.filter((c) => c.end > c.start).sort((x, y) => x.start - y.start)
}

/** Am luong nhac (he so 0.05..1) de nhac nam duoi giong ~voiceDelta dB; khong co giong -> nhac lam nen ~-18 dB. */
export function musicGain({ voiceDb, musicDb, hasVoice, voiceDelta = 18 } = {}) {
  if (!Number.isFinite(musicDb)) return hasVoice ? 0.2 : 0.4
  const targetDb = hasVoice && Number.isFinite(voiceDb) ? voiceDb - voiceDelta : -18
  const gain = 10 ** ((targetDb - musicDb) / 20)
  return round(Math.min(1, Math.max(0.05, gain)), 3)
}

/** Ket qua cuoi cung de App dua vao timeline. */
export function planToTimeline(plan, { captions = true, music = null } = {}) {
  const segments = plan.segments || []
  const duration = planDuration(segments)
  const hasVoice = segments.some((s) => s.kind !== 'image' && (plan.transcripts?.[s.assetId] || []).length > 0)
  return {
    ratio: AUTO_RATIOS.includes(plan.ratio) ? plan.ratio : '9:16',
    clips: segments.map((s) => ({ assetId: s.assetId, kind: s.kind, in: s.kind === 'image' ? 0 : round(s.in), out: s.kind === 'image' ? round(s.out - s.in) : round(s.out), speed: 1 })),
    captions: captions ? mapCaptionsToTimeline(segments, plan.transcripts) : [],
    duration, hasVoice,
    music: music ? { assetId: music.assetId, gain: musicGain({ voiceDb: plan.loudness?.voiceDb, musicDb: plan.loudness?.musicDb, hasVoice }), loop: true, ducking: hasVoice } : null
  }
}

/** Ket qua AI dan tu clipboard: chi nhan JSON co "selected" va it nhat 1 id thuoc luot nay; bo qua chinh cau lenh da chep. */
export function parseManualReply(text, prompt) {
  if (!text || !prompt || text === prompt || text.includes('USER INSTRUCTION')) return null
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0])
    if (!Array.isArray(obj.selected) || !obj.selected.some((x) => x && prompt.includes(`[${x.id}]`))) return null
    return text
  } catch { return null }
}
