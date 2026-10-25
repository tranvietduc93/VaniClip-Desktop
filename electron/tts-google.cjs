// ============================================================
//  Long tieng Google Cloud Text-to-Speech (REST API, xac thuc bang API key)
//  Khong them dependency: dung global fetch cua Node 18+ (may user Node 24).
//  Doc: https://cloud.google.com/text-to-speech/docs/reference/rest
// ============================================================
const fs = require('fs')
const { splitGoogleText } = require('./tts-text.cjs')

const BASE = 'https://texttospeech.googleapis.com/v1'

// Phan loai giong theo ten (de UI gom nhom)
function voiceType(name) {
  if (/(?:^|-)Chirp3-HD(?:-|$)/i.test(name)) return 'Chirp3-HD'
  if (/Neural2/i.test(name)) return 'Neural2'
  if (/Studio/i.test(name)) return 'Studio'
  if (/Wavenet/i.test(name)) return 'WaveNet'
  if (/Polyglot/i.test(name)) return 'Polyglot'
  if (/Standard/i.test(name)) return 'Standard'
  return 'Khac'
}

// The official Voices resource has no per-voice feature fields. Google documents
// Chirp 3 HD as not supporting speakingRate or pitch; other published tiers use
// the AudioConfig capabilities. Keep this mapping in one place for UI and API.
function voiceCapabilities(name) {
  const type = voiceType(name)
  return type === 'Chirp3-HD' ? { speakingRate: false, pitch: false, source: 'google-voice-family' }
    : { speakingRate: true, pitch: true, source: 'google-audio-config' }
}

async function errMsg(res) {
  const body = await res.text().catch(() => '')
  let detail = body
  try { const json = JSON.parse(body); detail = (json.error && json.error.message) || body } catch {}
  return `Google TTS ${res.status}: ${detail || res.statusText}`
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  try { return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }) }
  catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('Google TTS hết thời gian chờ. Hãy kiểm tra mạng rồi thử lại.')
    throw new Error(`Không kết nối được Google TTS: ${error.message}`)
  }
}

// Liet ke giong doc. langCode rong => tra ve tat ca ngon ngu.
async function listVoices(apiKey, langCode = 'vi-VN') {
  if (!apiKey) throw new Error('Chua co Google API key')
  let url = `${BASE}/voices?key=${encodeURIComponent(apiKey)}`
  if (langCode) url += `&languageCode=${encodeURIComponent(langCode)}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(await errMsg(res))
  const data = await res.json()
  const voices = (data.voices || []).map((v) => ({
    name: v.name,
    lang: (v.languageCodes && v.languageCodes[0]) || langCode,
    gender: v.ssmlGender || 'NEUTRAL',
    type: voiceType(v.name), capabilities: voiceCapabilities(v.name)
  }))
  // Sap xep: theo loai (chat luong cao truoc) roi theo ten
  const order = { 'Chirp3-HD': 0, Neural2: 1, Studio: 2, WaveNet: 3, Polyglot: 4, Standard: 5, Khac: 6 }
  voices.sort((a, b) => (order[a.type] - order[b.type]) || a.name.localeCompare(b.name))
  return voices
}

// Chuyen text (hoac SSML) thanh file audio. Tra ve { path }.
// opts: { apiKey, voiceName, langCode, rate, pitch, encoding, ssml }
async function synthesize(text, outFile, opts = {}) {
  const {
    apiKey, voiceName, langCode = 'vi-VN',
    rate = 1.0, pitch = 0.0, encoding = 'MP3', ssml = false
  } = opts
  if (!apiKey) throw new Error('Chua co Google API key')
  if (!voiceName) throw new Error('Chua chon giong doc')

  const caps = voiceCapabilities(voiceName)
  if (Buffer.byteLength(String(text), 'utf8') > 5000) throw new Error('Google TTS giới hạn 5.000 byte cho mỗi yêu cầu.')
  if (rate < 0.25 || rate > 2) throw new Error('Tốc độ Google TTS phải từ 0,25× đến 2×.')
  if (pitch < -20 || pitch > 20) throw new Error('Cao độ Google TTS phải từ -20 đến 20.')
  const audioConfig = { audioEncoding: encoding }
  if (caps.speakingRate) audioConfig.speakingRate = rate
  if (caps.pitch) audioConfig.pitch = pitch

  const body = {
    input: ssml ? { ssml: String(text) } : { text: String(text) },
    voice: { languageCode: langCode, name: voiceName },
    audioConfig
  }
  const res = await fetchWithTimeout(`${BASE}/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(await errMsg(res))
  const data = await res.json()
  if (!data.audioContent) throw new Error('Google TTS: khong nhan duoc audio')
  fs.writeFileSync(outFile, Buffer.from(data.audioContent, 'base64'))
  return { path: outFile }
}

module.exports = { listVoices, synthesize, voiceType, voiceCapabilities, splitGoogleText }
