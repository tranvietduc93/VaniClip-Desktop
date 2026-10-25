const EPSILON = 1e-6

function positive(value, label) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} phải lớn hơn 0.`)
  return n
}

export function snapToFrameTime(time, fps = 30) {
  const rate = positive(fps, 'FPS')
  const value = Number(time)
  if (!Number.isFinite(value)) throw new Error('Thời gian cần snap không hợp lệ.')
  return Math.round(value * rate) / rate
}

/** Build the shared, source-addressable output timeline for primary clips. */
export function buildTimelinePlan(clips, { transition = 'none', transitionDuration = 0.5, keepByClip = {} } = {}) {
  if (!Array.isArray(clips)) throw new Error('Danh sách clip không hợp lệ.')
  const pieces = []
  for (const clip of clips) {
    if (!clip || typeof clip.id !== 'string') throw new Error('Mỗi clip cần có ID ổn định.')
    const speed = clip.kind === 'image' ? 1 : positive(clip.speed ?? 1, `Tốc độ clip ${clip.id}`)
    const start = clip.kind === 'image' ? 0 : Number(clip.in ?? 0)
    const end = Number(clip.out)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`Khoảng nguồn clip ${clip.id} không hợp lệ.`)
    }
    const kept = keepByClip[clip.id]
    const hasKeepPlan = Object.prototype.hasOwnProperty.call(keepByClip, clip.id) && Array.isArray(kept)
    const ranges = hasKeepPlan && clip.kind !== 'image'
      ? kept.map((range) => ({ start: Math.max(start, Number(range.start)), end: Math.min(end, Number(range.end)) }))
        .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end - range.start > EPSILON)
      : [{ start, end }]
    for (const range of ranges) pieces.push({ clipId: clip.id, kind: clip.kind || 'video', sourceStart: range.start,
      sourceEnd: range.end, speed, duration: (range.end - range.start) / speed })
  }

  const entries = []
  let cursor = 0
  for (const piece of pieces) {
    const prior = entries[entries.length - 1]
    const appliesTransition = prior && prior.clipId !== piece.clipId
    const overlap = appliesTransition && transition === 'cross'
      ? Math.min(positive(transitionDuration, 'Thời lượng chuyển cảnh'), prior.duration / 2, piece.duration / 2)
      : 0
    const timelineStart = Math.max(0, cursor - overlap)
    const entry = { ...piece, start: timelineStart, end: timelineStart + piece.duration,
      transitionIn: appliesTransition ? transition : 'none', overlapIn: overlap }
    entries.push(entry)
    cursor = entry.end
  }
  const duration = entries.length ? Math.max(...entries.map((entry) => entry.end)) : 0
  return { entries, duration, transition, transitionDuration: Number(transitionDuration) || 0 }
}

/** Find a shared still-image duration that fits a target music duration around V1 and transitions. */
export function fitImageDurationToTarget(clips, targetDuration, options = {}) {
  const images = clips.filter((clip) => clip.kind === 'image')
  const target = Number(targetDuration)
  if (!images.length || !Number.isFinite(target) || target <= 0) return null
  const timelineAt = (imageDuration) => buildTimelinePlan(clips.map((clip) => clip.kind === 'image'
    ? { ...clip, in: 0, out: imageDuration, speed: 1 } : clip), options).duration
  let low = 0.5, high = 30
  if (timelineAt(low) <= target && timelineAt(high) >= target) {
    for (let i = 0; i < 32; i++) {
      const mid = (low + high) / 2
      if (timelineAt(mid) < target) low = mid; else high = mid
    }
  } else if (timelineAt(low) > target) high = low
  else low = high
  const imageDuration = Math.max(0.5, Math.min(30, (low + high) / 2))
  return { imageDuration, timelineDuration: timelineAt(imageDuration) }
}

/** Map a source range to every corresponding output range (clip may be reused). */
export function mapSourceRange(plan, clipId, sourceStart, sourceEnd) {
  const a0 = Number(sourceStart), b0 = Number(sourceEnd)
  if (!Number.isFinite(a0) || !Number.isFinite(b0) || b0 <= a0) return []
  return plan.entries.filter((entry) => entry.clipId === clipId).flatMap((entry) => {
    const a = Math.max(a0, entry.sourceStart), b = Math.min(b0, entry.sourceEnd)
    if (b - a <= EPSILON) return []
    const start = entry.start + (a - entry.sourceStart) / entry.speed
    const end = entry.start + (b - entry.sourceStart) / entry.speed
    return [{ start, end, clipId, sourceStart: a, sourceEnd: b }]
  })
}

/** Map timeline time to the active source time; crossfades can return two sources. */
export function mapTimelineTime(plan, time) {
  const t = Number(time)
  if (!Number.isFinite(t) || t < 0) return []
  return plan.entries.flatMap((entry, entryIndex) => t >= entry.start && t < entry.end ? [{
    clipId: entry.clipId,
    sourceTime: entry.sourceStart + (t - entry.start) * entry.speed,
    kind: entry.kind,
    entryIndex
  }] : [])
}

/** Pick a single-source preview at the transition midpoint; export still blends both entries. */
export function resolvePreviewSource(plan, time) {
  const active = mapTimelineTime(plan, time)
  if (active.length < 2) return active[0] || null
  const entries = plan.entries.filter((entry) => time >= entry.start && time < entry.end)
  const incomingIndex = entries.findIndex((entry) => entry.overlapIn > 0)
  if (incomingIndex < 0) return active[active.length - 1]
  const incoming = entries[incomingIndex]
  const midpoint = incoming.start + incoming.overlapIn / 2
  return active[time >= midpoint ? incomingIndex : Math.max(0, incomingIndex - 1)]
}

/** Split a timeline interval at clip/transition boundaries and anchor each piece to its preview source. */
export function mapTimelineRangeToSources(plan, start, end) {
  const a = Number(start), b = Number(end)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return []
  const cuts = new Set([a, b])
  for (const entry of plan.entries) {
    if (entry.start > a && entry.start < b) cuts.add(entry.start)
    if (entry.end > a && entry.end < b) cuts.add(entry.end)
    if (entry.overlapIn > 0) {
      const middle = entry.start + entry.overlapIn / 2
      if (middle > a && middle < b) cuts.add(middle)
    }
  }
  const points = [...cuts].sort((x, y) => x - y)
  const result = []
  for (let i = 0; i < points.length - 1; i++) {
    const timelineStart = points[i], timelineEnd = points[i + 1]
    const source = resolvePreviewSource(plan, (timelineStart + timelineEnd) / 2)
    if (!source) continue
    const entry = plan.entries.find((item) => item.clipId === source.clipId &&
      (timelineStart + timelineEnd) / 2 >= item.start && (timelineStart + timelineEnd) / 2 < item.end)
    if (!entry) continue
    result.push({ clipId: entry.clipId, start: timelineStart, end: timelineEnd,
      sourceStart: entry.sourceStart + (timelineStart - entry.start) * entry.speed,
      sourceEnd: entry.sourceStart + (timelineEnd - entry.start) * entry.speed })
  }
  return result.reduce((merged, range) => {
    const prior = merged[merged.length - 1]
    if (prior && prior.clipId === range.clipId && Math.abs(prior.end - range.start) < EPSILON &&
        Math.abs(prior.sourceEnd - range.sourceStart) < EPSILON) {
      prior.end = range.end
      prior.sourceEnd = range.sourceEnd
    } else merged.push({ ...range })
    return merged
  }, [])
}

export function toExportSegments(plan) {
  return plan.entries.map((entry) => ({ clipId: entry.clipId, start: entry.start, end: entry.end,
    sourceStart: entry.sourceStart, sourceEnd: entry.sourceEnd, speed: entry.speed,
    overlapIn: entry.overlapIn, transitionIn: entry.transitionIn }))
}
