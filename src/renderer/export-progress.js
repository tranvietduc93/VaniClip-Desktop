export function aggregateBatchProgress(index, count, jobProgress) {
  const total = Math.trunc(Number(count))
  if (!Number.isFinite(total) || total <= 0) return 0
  const current = Math.max(0, Math.min(total - 1, Math.trunc(Number(index) || 0)))
  const progress = Math.max(0, Math.min(100, Number(jobProgress) || 0))
  return Math.round(((current + progress / 100) / total) * 100)
}
