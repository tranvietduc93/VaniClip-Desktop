// Kich ban -> timeline: ham thuan (khong phu thuoc React) de gan media, cat clip dung so giay va chia loi thanh phu de.

const MIN_PIECE = 0.12

/** Gan media cho tung canh. assets: danh sach da gui cho Claude (chi so = scene.media). Canh chua co media -> lay lan luot, uu tien file chua dung. */
export function assignMedia(scenes, assets) {
  if (!assets?.length) return scenes.map((scene) => ({ ...scene, assetId: null }))
  const used = new Set(scenes.map((scene) => scene.media).filter((i) => Number.isInteger(i) && assets[i]))
  let cursor = 0
  const nextUnused = () => {
    for (let n = 0; n < assets.length; n++) { const i = (cursor + n) % assets.length; if (!used.has(i)) { cursor = i + 1; return i } }
    const i = cursor % assets.length; cursor++; return i
  }
  return scenes.map((scene) => {
    const index = Number.isInteger(scene.media) && assets[scene.media] ? scene.media : nextUnused()
    used.add(index)
    return { ...scene, media: index, assetId: assets[index].id }
  })
}

/** Cac doan clip lien tiep tong dung `duration` giay. Anh: 1 doan. Video du dai: cat dung `duration`; hoi ngan: lam cham toi 0.5x; qua ngan: lap lai. */
export function planSceneClips(media, duration, startHint = 0) {
  const d = Math.max(0.1, Number(duration) || 0.1)
  if (media?.kind === 'image') return [{ in: 0, out: d, speed: 1 }]
  const src = Number(media?.duration)
  if (!Number.isFinite(src) || src <= 0) return [{ in: 0, out: d, speed: 1 }]
  if (src >= d) {
    const inPoint = startHint + d <= src ? Math.max(0, startHint) : 0
    return [{ in: round(inPoint), out: round(inPoint + d), speed: 1 }]
  }
  if (src >= d * 0.5) return [{ in: 0, out: round(src), speed: round(Math.max(0.5, src / d), 4) }]
  const pieces = []
  let remaining = d
  while (remaining > MIN_PIECE) {
    const len = Math.min(src, remaining)
    pieces.push({ in: 0, out: round(len), speed: 1 })
    remaining -= len
  }
  const last = pieces[pieces.length - 1]
  if (remaining > 0 && last) last.out = round(Math.min(src, last.out + remaining))
  return pieces
}

/** Tong thoi luong tren timeline cua cac doan (co tinh toc do). */
export function piecesDuration(pieces) { return pieces.reduce((sum, p) => sum + (p.out - p.in) / (p.speed || 1), 0) }

/** Chia loi cua canh thanh cac phu de ngan, thoi gian chia theo do dai chu, bao toan start/end cua canh. */
export function splitSceneCaptions(scene, offset = 0, maxChars = 84) {
  const text = String(scene.text || '').replace(/\s+/g, ' ').trim()
  if (!text) return []
  const sentences = text.split(/(?<=[.!?…])\s+/)
  const parts = []
  for (const sentence of sentences) {
    if (sentence.length <= maxChars) { parts.push(sentence); continue }
    let buffer = ''
    for (const word of sentence.split(' ')) {
      if (buffer && (buffer + ' ' + word).length > maxChars) { parts.push(buffer); buffer = word }
      else buffer = buffer ? buffer + ' ' + word : word
    }
    if (buffer) parts.push(buffer)
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0) || 1
  const span = scene.end - scene.start
  let cursor = scene.start
  return parts.map((part, i) => {
    const end = i === parts.length - 1 ? scene.end : cursor + span * (part.length / total)
    const caption = { start: round(offset + cursor), end: round(offset + end), text: part }
    cursor = end
    return caption
  })
}

function round(value, digits = 3) { const k = 10 ** digits; return Math.round(value * k) / k }
