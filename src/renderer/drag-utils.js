export function attachDocumentMouseDrag(move, finish) {
  let ended = false
  const end = (event) => {
    if (ended) return
    ended = true
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', end)
    window.removeEventListener('blur', end)
    finish?.(event)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', end)
  window.addEventListener('blur', end, { once: true })
  return end
}
