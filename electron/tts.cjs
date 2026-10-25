// ============================================================
//  Lồng tiếng AI (TTS) tiếng Việt - transformers.js MMS-TTS, chạy local
//  Model: Xenova/mms-tts-vie (lần đầu tự tải về cache)
// ============================================================
const fs = require('fs')
const { splitText } = require('./tts-text.cjs')

let ttsPromise = null
let cacheRoot = null
const MODEL_ID = 'Xenova/mms-tts-vie'
const MAX_LOCAL_CHARS = 1200
const MAX_TEXT_CHARS = 50000
const GAP_SECONDS = 0.16

async function getTts(onStatus, modelCacheDir) {
  if (ttsPromise) return ttsPromise
  const pending = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    cacheRoot = modelCacheDir || cacheRoot
    if (cacheRoot) { fs.mkdirSync(cacheRoot, { recursive: true }); env.cacheDir = cacheRoot }
    env.useFSCache = true
    env.allowLocalModels = false
    const opts = {}
    if (onStatus) opts.progress_callback = (p) => {
      if (p && p.status === 'progress' && p.file) onStatus({ phase: 'download', file: p.file, progress: Math.round(p.progress || 0) })
      else if (p && p.status) onStatus({ phase: p.status })
    }
    return pipeline('text-to-speech', MODEL_ID, opts)
  })()
  ttsPromise = pending
  try { return await pending } catch (error) {
    if (ttsPromise === pending) ttsPromise = null
    throw error
  }
}

async function getModelStatus(modelCacheDir) {
  try {
    const { ModelRegistry } = await import('@huggingface/transformers')
    const cached = await ModelRegistry.is_pipeline_cached('text-to-speech', MODEL_ID, { cache_dir: modelCacheDir })
    return { model: MODEL_ID, cached, state: cached ? 'ready' : 'not-cached' }
  } catch (error) { return { model: MODEL_ID, cached: false, state: 'check-failed', error: error.message } }
}

// Float32 [-1,1] -> WAV PCM 16-bit mono
function encodeWav(float32, sr) {
  const n = float32.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  return buf
}

async function synthesize(text, outWav, { onStatus, modelCacheDir } = {}) {
  const clean = String(text || '').trim()
  if (!clean) throw new Error('Nhập nội dung cần đọc.')
  if (clean.length > MAX_TEXT_CHARS) throw new Error(`TTS local giới hạn ${MAX_TEXT_CHARS.toLocaleString('vi-VN')} ký tự mỗi lượt.`)
  const chunks = splitText(clean, MAX_LOCAL_CHARS)
  const tts = await getTts(onStatus, modelCacheDir)
  const outputs = []
  let sampleRate = 0
  for (let index = 0; index < chunks.length; index++) {
    if (onStatus) onStatus({ phase: 'chunk', index: index + 1, total: chunks.length })
    const out = await tts(chunks[index].trim())
    if (!sampleRate) sampleRate = out.sampling_rate
    if (out.sampling_rate !== sampleRate) throw new Error('Model TTS trả sample rate không đồng nhất giữa các đoạn.')
    outputs.push(out.audio)
  }
  const gapSamples = Math.round(sampleRate * GAP_SECONDS)
  const sampleCount = outputs.reduce((sum, audio) => sum + audio.length, 0) + Math.max(0, outputs.length - 1) * gapSamples
  const combined = new Float32Array(sampleCount)
  let offset = 0
  outputs.forEach((audio, index) => { combined.set(audio, offset); offset += audio.length + (index < outputs.length - 1 ? gapSamples : 0) })
  fs.mkdirSync(require('path').dirname(outWav), { recursive: true })
  fs.writeFileSync(outWav, encodeWav(combined, sampleRate))
  return { path: outWav, duration: combined.length / sampleRate, chunks: chunks.length }
}

module.exports = { synthesize, getModelStatus, splitText, MODEL_ID, MAX_LOCAL_CHARS, MAX_TEXT_CHARS }
