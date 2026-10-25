const EPHEMERAL_CLIP_FIELDS = new Set(['thumbs', 'wave', 'thumbLoading', 'thumbError', 'waveLoading', 'waveError'])
const HISTORY_UI_FIELDS = new Set(['selectedClipId', 'selectedOverlayId', 'activeClipId', 'activeClipIndex'])

export function historySnapshotsEqual(left, right, seen = new WeakMap(), depth = 0) {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  let paired = seen.get(left)
  if (paired?.has(right)) return true
  if (!paired) { paired = new WeakSet(); seen.set(left, paired) }
  paired.add(right)
  const ignored = depth === 0 ? HISTORY_UI_FIELDS : null
  const leftKeys = Object.keys(left).filter((key) => !ignored?.has(key))
  const rightKeys = Object.keys(right).filter((key) => !ignored?.has(key))
  if (leftKeys.length !== rightKeys.length) return false
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !historySnapshotsEqual(left[key], right[key], seen, depth + 1)) return false
  }
  return true
}

export function restoreHistorySelection(snapshot, clips, overlays, fallbackActiveIndex = 0) {
  const safeIndex = Math.max(0, Math.min(Math.max(0, clips.length - 1), Math.trunc(Number(fallbackActiveIndex) || 0)))
  const savedActiveIndex = Number.isInteger(snapshot?.activeClipIndex) ? snapshot.activeClipIndex : safeIndex
  const activeClipIndex = snapshot?.activeClipId
    ? Math.max(0, clips.findIndex((clip) => clip.id === snapshot.activeClipId))
    : Math.max(0, Math.min(Math.max(0, clips.length - 1), savedActiveIndex))
  return {
    activeClipIndex,
    selectedClipId: clips.some((clip) => clip.id === snapshot?.selectedClipId) ? snapshot.selectedClipId : null,
    selectedOverlayId: overlays.some((overlay) => overlay.id === snapshot?.selectedOverlayId) ? snapshot.selectedOverlayId : null
  }
}

// History stores edit data only. Thumbnails/waveforms are derived media caches,
// so retaining them in every snapshot wastes memory and can restore stale UI.
export function snapshotHistoryClips(clips) {
  return (clips || []).map((clip) => Object.fromEntries(
    Object.entries(clip).filter(([key]) => !EPHEMERAL_CLIP_FIELDS.has(key))
  ))
}

export function restoreHistoryClips(historyClips, currentClips) {
  const currentById = new Map((currentClips || []).map((clip) => [clip.id, clip]))
  return (historyClips || []).map((clip) => {
    const cache = currentById.get(clip.id)
    const sameSource = cache?.path === clip.path
    return {
      ...clip,
      thumbs: clip.kind === 'image' ? [clip.path] : (sameSource ? cache.thumbs || [] : []),
      wave: sameSource ? cache.wave || null : null,
      thumbLoading: false, thumbError: false, waveLoading: false, waveError: false
    }
  })
}
