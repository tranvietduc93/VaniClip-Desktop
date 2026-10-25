// ============================================================
//  Whisper local (transformers.js) - nhan dang giong noi -> phu de
//  Lan dau chay se tu tai model (~80MB ban q8) ve cache.
// ============================================================
const fs = require('fs')

let pipePromise = null
let loadedModel = null
let CACHE_DIR = null

// Dat thu muc cache model (goi tu main voi userData) - tranh ghi vao app.asar (ENOTDIR) khi dong goi
function configure(cacheDir) { CACHE_DIR = cacheDir }

// transformers.js la ESM -> dung dynamic import trong .cjs
async function getPipe(model, onStatus) {
  if (pipePromise && loadedModel === model) return pipePromise
  loadedModel = model
  const pending = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    if (CACHE_DIR) { try { fs.mkdirSync(CACHE_DIR, { recursive: true }) } catch {} env.cacheDir = CACHE_DIR }
    env.allowLocalModels = false // luon dung model tu Hugging Face hub
    const opts = { dtype: 'q8' }
    if (onStatus) opts.progress_callback = (p) => {
      if (p && p.status === 'progress' && p.file) {
        onStatus({ phase: 'download', file: p.file, progress: Math.round(p.progress || 0) })
      } else if (p && p.status) {
        onStatus({ phase: p.status, file: p.file || '' })
      }
    }
    return pipeline('automatic-speech-recognition', model, opts)
  })()
  pipePromise = pending
  try { return await pending } catch (error) {
    if (pipePromise === pending) { pipePromise = null; loadedModel = null }
    throw error
  }
}

// Doc WAV (PCM 16-bit mono) -> Float32Array [-1,1]
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('WAV khong hop le')
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const sz = buf.readUInt32LE(off + 4)
    if (id === 'data') {
      const data = buf.subarray(off + 8, off + 8 + sz)
      const n = Math.floor(data.length / 2)
      const f = new Float32Array(n)
      for (let i = 0; i < n; i++) f[i] = data.readInt16LE(i * 2) / 32768
      return f
    }
    off += 8 + sz + (sz % 2)
  }
  throw new Error('Khong tim thay data trong WAV')
}

// Nhan dang -> tra ve [{start,end,text}] (thoi gian theo nguon)
async function transcribe(wavPath, { language = 'vietnamese', model = 'Xenova/whisper-base', onStatus } = {}) {
  const pipe = await getPipe(model, onStatus)
  if (onStatus) onStatus({ phase: 'transcribe' })
  const audio = decodeWav(fs.readFileSync(wavPath))
  const res = await pipe(audio, {
    ...(language ? { language } : {}), task: 'transcribe', return_timestamps: true,
    chunk_length_s: 30, stride_length_s: 5
  })
  const chunks = res.chunks || []
  const audioDuration = audio.length / 16000
  return chunks
    .map((c) => {
      const start = Math.max(0, Math.min(audioDuration, Number(c.timestamp?.[0]) || 0))
      // chunk cuoi doi khi thieu end -> uoc luong, tranh cau cuoi bi loai (end=0)
      const rawEnd = Number(c.timestamp?.[1])
      const end = Math.max(0, Math.min(audioDuration, Number.isFinite(rawEnd) ? rawEnd : start + 3))
      return { start, end, text: (c.text || '').trim() }
    })
    .filter((c) => c.text && c.end > c.start)
}

module.exports = { transcribe, configure }
