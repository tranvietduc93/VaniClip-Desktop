const { Buffer } = require('node:buffer')

// Split at sentence/word boundaries while preserving all source characters.
function splitText(text, maxSize, measure = (value) => [...value].length) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim()
  if (!source) return []
  if (!Number.isInteger(maxSize) || maxSize < 1) throw new Error('Giới hạn đoạn TTS không hợp lệ.')
  const chunks = []
  let remaining = source
  while (measure(remaining) > maxSize) {
    const points = [...remaining]
    let limit = 0
    while (limit < points.length && measure(points.slice(0, limit + 1).join('')) <= maxSize) limit++
    if (!limit) throw new Error('Không thể chia văn bản tại giới hạn TTS.')
    const lowerBound = Math.max(1, Math.floor(limit * 0.7))
    let cut = -1
    for (let i = limit - 1; i >= lowerBound; i--) {
      if (/[.!?。！？;；]\s*$/.test(points.slice(0, i + 1).join(''))) { cut = i + 1; break }
    }
    if (cut < 0) {
      for (let i = limit - 1; i >= lowerBound; i--) {
        if (/\s/.test(points[i])) { cut = i + 1; break }
      }
    }
    if (cut < 1) cut = limit
    chunks.push(points.slice(0, cut).join(''))
    remaining = points.slice(cut).join('')
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function splitGoogleText(text, maxBytes = 4500) {
  return splitText(text, maxBytes, (value) => Buffer.byteLength(value, 'utf8'))
}

module.exports = { splitText, splitGoogleText }
