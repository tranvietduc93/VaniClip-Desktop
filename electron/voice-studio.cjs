// ============================================================
//  Tao giong doc AI (Voice Studio)
//  Engine: Gemini TTS (nhieu khoa) | ElevenLabs API | Edge (mien phi, goi msedge-tts) | Local MMS (offline, tieng Viet)
//  Van ban khong gioi han: tach theo dong/cau, tao tung dong (cache theo noi dung -> chay lai khong ton phi), ghep + khoang nghi thanh 1 file mp3.
//  Cac ham thuan (parse, the cam xuc, WAV) export de test khong can Electron/mang.
// ============================================================
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

let FFMPEG = null
function configure(ffmpegPath) { FFMPEG = ffmpegPath }

const round = (v, d = 3) => { const k = 10 ** d; return Math.round(v * k) / k }
const cancelled = () => Object.assign(new Error('Đã hủy tạo giọng đọc.'), { cancelled: true })
const guard = (signal) => { if (signal?.aborted) throw cancelled() }

// ---------- Du lieu giong / model / cam xuc ----------
const GEMINI_VOICES = [['Zephyr', 'Sáng'], ['Puck', 'Sôi nổi'], ['Charon', 'Thông tin'], ['Kore', 'Chắc chắn'], ['Fenrir', 'Hào hứng'], ['Leda', 'Trẻ trung'],
  ['Orus', 'Chắc chắn'], ['Aoede', 'Nhẹ nhàng'], ['Callirrhoe', 'Dễ chịu'], ['Autonoe', 'Sáng'], ['Enceladus', 'Thì thầm'], ['Iapetus', 'Rõ ràng'],
  ['Umbriel', 'Dễ chịu'], ['Algieba', 'Mượt'], ['Despina', 'Mượt'], ['Erinome', 'Rõ ràng'], ['Algenib', 'Khàn'], ['Rasalgethi', 'Thông tin'],
  ['Laomedeia', 'Sôi nổi'], ['Achernar', 'Mềm'], ['Alnilam', 'Chắc chắn'], ['Schedar', 'Đều'], ['Gacrux', 'Trưởng thành'], ['Pulcherrima', 'Thẳng thắn'],
  ['Achird', 'Thân thiện'], ['Zubenelgenubi', 'Tự nhiên'], ['Vindemiatrix', 'Dịu dàng'], ['Sadachbia', 'Sống động'], ['Sadaltager', 'Am hiểu'], ['Sulafat', 'Ấm áp']]
  .map(([name, label]) => ({ name, label }))
// Model mac dinh: thu lan luot (404 = model chua mo cho khoa nay -> thu model ke)
const GEMINI_MODELS = [{ id: '', label: 'Mặc định (tự thử model mới nhất)' }, { id: 'gemini-3.1-flash-tts-preview', label: 'gemini-3.1-flash-tts-preview' },
  { id: 'gemini-2.5-flash-preview-tts', label: 'gemini-2.5-flash-preview-tts' }, { id: 'gemini-2.5-pro-preview-tts', label: 'gemini-2.5-pro-preview-tts' }]
const GEMINI_MODEL_CHAIN = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts']
const ELEVEN_MODELS = [{ id: 'eleven_multilingual_v2', label: 'Multilingual v2' }, { id: 'eleven_v3', label: 'Eleven v3 (hỗ trợ thẻ cảm xúc)' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5' }, { id: 'eleven_flash_v2_5', label: 'Flash v2.5' }]
const EDGE_VOICES = [{ name: 'vi-VN-HoaiMyNeural', label: 'Hoài My · nữ · Việt', lang: 'vi' }, { name: 'vi-VN-NamMinhNeural', label: 'Nam Minh · nam · Việt', lang: 'vi' },
  { name: 'en-US-AriaNeural', label: 'Aria · nữ · Mỹ', lang: 'en' }, { name: 'en-US-JennyNeural', label: 'Jenny · nữ · Mỹ', lang: 'en' }, { name: 'en-US-GuyNeural', label: 'Guy · nam · Mỹ', lang: 'en' },
  { name: 'en-US-AndrewNeural', label: 'Andrew · nam · Mỹ', lang: 'en' }, { name: 'en-GB-SoniaNeural', label: 'Sonia · nữ · Anh', lang: 'en' }, { name: 'en-GB-RyanNeural', label: 'Ryan · nam · Anh', lang: 'en' }]

const EMOTIONS = { natural: '', storytelling: 'in a warm, engaging storytelling tone', excited: 'in an enthusiastic, energetic voice', cheerful: 'in a cheerful, happy voice',
  sad: 'in a sad, subdued voice', serious: 'in a serious, dramatic voice', whisper: 'in a soft, intimate whisper', angry: 'in an angry, intense voice' }
const TAG_PHRASE = { laughs: 'while laughing', giggles: 'with a giggle', whispers: 'in a whisper', sighs: 'with a sigh', excited: 'excitedly', sad: 'sadly', angry: 'angrily',
  curious: 'curiously', sarcastic: 'sarcastically', gasps: 'with a gasp' }
const PAUSE_TAG = { 'short pause': 0.4, 'long pause': 1.0 }

// ---------- Phan tich kich ban ----------
const TAG_RE = /\[([a-z][a-z ]{1,22})\]/gi
function extractTags(text) {
  const tags = []
  const clean = String(text || '').replace(TAG_RE, (_m, name) => { tags.push(name.toLowerCase().trim()); return ' ' }).replace(/\s{2,}/g, ' ').trim()
  return { tags, clean }
}

/** Thanh khuc: dong thuong -> {type:'line'}; "( 1.2s | hinh tram )" hoac "( )" -> {type:'pause'}; [short pause]/[long pause] -> pause. */
function parseScript(text, { mode = 'line', defaultPause = 0.5 } = {}) {
  const items = []
  const pauseRe = /^\(\s*(?:(\d+(?:[.,]\d+)?)\s*s?)?\s*(?:\|[^)]*)?\)$/
  const sentences = (line) => {
    const lead = (line.match(/^(\s*\[[a-z ]{2,22}\]\s*)+/i) || [''])[0]
    const parts = line.split(/(?<=[.!?…。！？])\s+/).map((x) => x.trim()).filter(Boolean)
    return parts.map((x, i) => (i === 0 || !lead ? x : `${lead.trim()} ${x}`))
  }
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const pm = pauseRe.exec(line)
    if (pm) { items.push({ type: 'pause', seconds: pm[1] ? Number(pm[1].replace(',', '.')) : defaultPause }); continue }
    const pieces = line.split(/\[(short pause|long pause)\]/i)
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i].trim()
      if (i % 2 === 1) { items.push({ type: 'pause', seconds: PAUSE_TAG[piece.toLowerCase()] }); continue }
      if (!piece || !extractTags(piece).clean) continue
      for (const sentence of mode === 'sentence' ? sentences(piece) : [piece]) items.push({ type: 'line', text: sentence })
    }
  }
  let index = 0
  return items.map((it) => (it.type === 'line' ? { ...it, index: index++ } : it)).map((it) => (it.type === 'pause' ? { ...it, seconds: Math.max(0, Math.min(30, it.seconds)) } : it))
}

function srtToLines(content) {
  return String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).map((l) => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('\n')
}

function geminiPrompt(text, { emotion = 'natural', style = '' } = {}) {
  const { tags, clean } = extractTags(text)
  if (!clean) return ''
  const phrases = []
  if (EMOTIONS[emotion]) phrases.push(EMOTIONS[emotion])
  if (String(style).trim()) phrases.push(String(style).trim().replace(/^vd:\s*/i, ''))
  for (const tag of tags) if (TAG_PHRASE[tag] && !phrases.includes(TAG_PHRASE[tag])) phrases.push(TAG_PHRASE[tag])
  return phrases.length ? `Say ${phrases.join(', ')}: ${clean}` : clean
}
// ElevenLabs v3 doc duoc the [laughs]...; model khac se doc to ra -> bo the
function elevenText(text, model) { return /v3/.test(model || '') ? String(text).replace(/\[(short pause|long pause)\]/gi, ' ').replace(/\s{2,}/g, ' ').trim() : extractTags(text).clean }

// ---------- WAV ----------
function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
function silenceWav(seconds, rate = 24000) { return pcmToWav(Buffer.alloc(Math.round(seconds * rate) * 2), rate) }
function wavDuration(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return 0
  let rate = 24000, off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') rate = buf.readUInt32LE(off + 12) || rate
    if (id === 'data') { const bytes = Math.min(size, buf.length - off - 8); return bytes / (rate * 2) }
    off += 8 + size + (size % 2)
  }
  return 0
}

function runFfmpeg(args, signal) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('Voice Studio chưa được cấu hình FFmpeg.'))
    guard(signal)
    const ps = spawn(FFMPEG, args); let err = ''
    const abort = () => { try { ps.kill('SIGKILL') } catch {} }
    signal?.addEventListener('abort', abort, { once: true })
    ps.stderr.on('data', (d) => { err += d; if (err.length > 2e5) err = err.slice(-1e5) })
    ps.on('error', reject)
    ps.on('close', (code) => { signal?.removeEventListener('abort', abort); if (signal?.aborted) return reject(cancelled()); code === 0 ? resolve() : reject(new Error('ffmpeg lỗi: ' + err.slice(-300))) })
  })
}
async function toWav24k(input, output, signal) { await runFfmpeg(['-y', '-v', 'error', '-i', input, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', output], signal) }

// ---------- HTTP ----------
async function fetchTimeout(url, options, ms, signal) {
  const c = new AbortController(), timer = setTimeout(() => c.abort(), ms)
  const onAbort = () => c.abort(); signal?.addEventListener('abort', onAbort, { once: true })
  try { return await fetch(url, { ...options, signal: c.signal }) }
  catch (e) { if (signal?.aborted) throw cancelled(); throw new Error(e.name === 'AbortError' ? 'Hết thời gian chờ máy chủ giọng đọc.' : `Không kết nối được: ${e.message}`) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
}

// ---------- Gemini ----------
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
async function geminiSpeak({ key, model, voice, prompt, signal }) {
  const res = await fetchTimeout(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } })
  }, 120000, signal)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = body?.error || {}, reason = (d.details || []).find((x) => x.reason)?.reason || ''
    throw Object.assign(new Error(`Gemini ${res.status}: ${d.message || res.statusText}`), { status: res.status, reason })
  }
  const part = (body.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data)
  if (!part) throw Object.assign(new Error('Gemini không trả về audio (câu có thể bị bộ lọc an toàn chặn).'), { status: 0 })
  return { pcm: Buffer.from(part.inlineData.data, 'base64'), rate: Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000 }
}
const isBadKey = (e) => (e.status === 400 && /API_KEY_INVALID/.test(e.reason || '')) || e.status === 401 || e.status === 403

/** Chon khoa + model. Khoa SAI -> bo qua, thu khoa ke. HET HAN MUC (429) -> dung va bao: khong tu xoay khoa de ne gioi han. */
function makeGeminiCaller(keys, modelChoice, state = { bad: new Set(), cursor: 0, model: null }) {
  const usable = keys.filter((k) => k.enabled)
  return async function call(args) {
    if (!usable.length) throw new Error('Chưa có khóa Gemini nào được bật. Thêm hoặc tick chọn khóa ở khung "Khóa Gemini".')
    const models = modelChoice ? [modelChoice] : state.model ? [state.model] : GEMINI_MODEL_CHAIN
    let lastError = null
    for (const model of models) {
      for (let n = 0; n < usable.length; n++) {
        const k = usable[(state.cursor + n) % usable.length]
        if (state.bad.has(k.id)) continue
        try { const r = await geminiSpeak({ ...args, key: k.key, model }); state.cursor = usable.indexOf(k); state.model = model; return r } catch (e) {
          if (e.cancelled) throw e
          lastError = e
          if (isBadKey(e)) { state.bad.add(k.id); continue }
          if (e.status === 404) break // model nay chua co -> model ke
          if (e.status === 429) throw Object.assign(new Error(`Khóa Gemini ${k.hint} đã hết hạn mức (429). VaniClip không tự đổi sang khóa khác để né giới hạn — hãy chờ, hoặc tự bỏ tick khóa này và chọn khóa khác rồi chạy lại (các dòng đã tạo được giữ lại).`), { status: 429, quota: true })
          throw e
        }
      }
    }
    throw lastError || new Error('Mọi khóa Gemini đều không hợp lệ.')
  }
}

// ---------- ElevenLabs ----------
async function elevenSpeak({ key, voiceId, model, text, signal }) {
  const res = await fetchTimeout(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': key, accept: 'audio/mpeg' }, body: JSON.stringify({ text, model_id: model || 'eleven_multilingual_v2' })
  }, 120000, signal)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})), msg = body?.detail?.message || body?.detail || res.statusText
    throw Object.assign(new Error(res.status === 401 ? 'ElevenLabs API key không hợp lệ.' : res.status === 429 ? 'ElevenLabs đã hết hạn mức/quá tốc độ (429). Chờ rồi chạy lại; các dòng đã tạo được giữ lại.' : `ElevenLabs ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`), { status: res.status })
  }
  return Buffer.from(await res.arrayBuffer())
}
async function elevenVoices(key) {
  const res = await fetchTimeout('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } }, 30000)
  if (!res.ok) throw Object.assign(new Error(res.status === 401 ? 'ElevenLabs API key không hợp lệ.' : `ElevenLabs ${res.status}`), { status: res.status })
  const body = await res.json()
  return (body.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category || '' }))
}
async function testGeminiKey(key) {
  const res = await fetchTimeout(`${GEMINI_BASE}/models?pageSize=1`, { headers: { 'x-goog-api-key': key } }, 20000)
  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({}))
  return { ok: false, status: res.status, message: body?.error?.message || res.statusText }
}

// ---------- Edge (mien phi, goi msedge-tts) ----------
async function edgeSpeak({ voice, text, dir }) {
  let mod; try { mod = require('msedge-tts') } catch { throw new Error('Thiếu gói "msedge-tts". Chạy "npm install" trong thư mục dự án rồi mở lại app.') }
  const tts = new mod.MsEdgeTTS()
  await tts.setMetadata(voice, mod.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
  let result
  try { result = await tts.toFile(dir, text) } catch { result = await tts.toFile(path.join(dir, 'edge.mp3'), text) } // msedge-tts v1 nhan duong dan file
  const file = typeof result === 'string' ? result : result?.audioFilePath
  if (!file || !fs.existsSync(file)) throw new Error('Edge TTS không tạo được file audio.')
  return file
}

// ---------- Tao tung dong ----------
function lineKey(job, line) {
  return crypto.createHash('sha256').update(JSON.stringify({ e: job.engine, g: job.gemini?.voice, gm: job.gemini?.model, ev: job.eleven?.voiceId, em: job.eleven?.model, ed: job.edge?.voice,
    emo: job.emotion, st: job.style, lang: job.lang, line })).digest('hex')
}

function makeSynth(job, deps, signal) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vaniclip-voice-'))
  const gem = job.engine === 'gemini' ? makeGeminiCaller(deps.geminiKeys(), job.gemini?.model || '') : null
  const synth = async (line, wavOut) => {
    const eng = job.engine
    if (eng === 'gemini') {
      const prompt = geminiPrompt(line, { emotion: job.emotion, style: job.style })
      if (!prompt) throw new Error('Dòng trống sau khi bỏ thẻ cảm xúc.')
      const { pcm, rate } = await gem({ voice: job.gemini?.voice || 'Kore', prompt, signal })
      if (rate === 24000) fs.writeFileSync(wavOut, pcmToWav(pcm, rate))
      else { const raw = path.join(tmp, 'g.wav'); fs.writeFileSync(raw, pcmToWav(pcm, rate)); await toWav24k(raw, wavOut, signal) }
    } else if (eng === 'elevenlabs') {
      const key = deps.elevenKey(); if (!key) throw new Error('Chưa nhập ElevenLabs API key.')
      if (!job.eleven?.voiceId) throw new Error('Chưa chọn giọng ElevenLabs. Bấm "Tải giọng" sau khi nhập khóa.')
      const mp3 = await elevenSpeak({ key, voiceId: job.eleven.voiceId, model: job.eleven.model, text: elevenText(line, job.eleven.model), signal })
      const f = path.join(tmp, 'e.mp3'); fs.writeFileSync(f, mp3); await toWav24k(f, wavOut, signal)
    } else if (eng === 'edge') {
      const dir = fs.mkdtempSync(path.join(tmp, 'edge-'))
      const file = await edgeSpeak({ voice: job.edge?.voice || (job.lang === 'vi' ? 'vi-VN-HoaiMyNeural' : 'en-US-AriaNeural'), text: extractTags(line).clean, dir })
      await toWav24k(file, wavOut, signal)
    } else if (eng === 'local') {
      const local = require('./tts.cjs'); const f = path.join(tmp, 'l.wav')
      await local.synthesize(extractTags(line).clean, f, { modelCacheDir: deps.modelCacheDir })
      await toWav24k(f, wavOut, signal)
    } else throw new Error('Engine giọng đọc không hợp lệ.')
  }
  return { synth, cleanup: () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {} } }
}

/**
 * job: { engine, lang, text, mode, defaultPause, emotion, style, gemini:{voice,model}, eleven:{voiceId,model}, edge:{voice}, onlyLine?: number }
 * deps: { cacheDir, outDir, geminiKeys(), elevenKey(), modelCacheDir, onProgress, signal, synth? (test) }
 */
async function generate(job, deps) {
  const { signal, onProgress = () => {} } = deps
  const items = parseScript(job.text, { mode: job.mode, defaultPause: Number.isFinite(job.defaultPause) ? job.defaultPause : 0.5 })
  const lines = items.filter((i) => i.type === 'line')
  if (!lines.length) throw new Error('Chưa có lời đọc. Dán lời vào ô văn bản (mỗi dòng một khúc).')
  const only = Number.isInteger(job.onlyLine) ? job.onlyLine : null
  if (only != null && !lines[only]) throw new Error('Dòng được chọn không tồn tại.')
  fs.mkdirSync(deps.cacheDir, { recursive: true }); fs.mkdirSync(deps.outDir, { recursive: true })
  const helper = deps.synth ? { synth: deps.synth, cleanup() {} } : makeSynth(job, deps, signal)
  const parts = [], timeline = []
  let cursor = 0, done = 0, cached = 0
  const push = (file, dur) => { parts.push(file); cursor += dur }
  try {
    const todo = only != null ? [lines[only]] : lines
    for (const it of items) {
      guard(signal)
      if (it.type === 'pause') {
        if (only != null || !parts.length || it.seconds <= 0) continue
        const f = path.join(deps.cacheDir, `sil-${Math.round(it.seconds * 1000)}.wav`)
        if (!fs.existsSync(f)) fs.writeFileSync(f, silenceWav(it.seconds))
        push(f, it.seconds); continue
      }
      if (only != null && it.index !== only) continue
      onProgress({ phase: 'line', done, total: todo.length, text: it.text.slice(0, 60) })
      const wav = path.join(deps.cacheDir, `${lineKey(job, it.text)}.wav`)
      if (fs.existsSync(wav) && fs.statSync(wav).size > 100) cached++
      else { const stage = `${wav}.part`; await helper.synth(it.text, stage); fs.renameSync(stage, wav) }
      const dur = wavDuration(fs.readFileSync(wav))
      if (!(dur > 0)) throw new Error('Dòng được tạo ra không có âm thanh.')
      const start = cursor; push(wav, dur); timeline.push({ index: it.index, text: it.text, start: round(start), end: round(cursor) }); done++
      if (only == null && job.gap > 0 && it !== items[items.length - 1] && items[items.indexOf(it) + 1]?.type === 'line') {
        const f = path.join(deps.cacheDir, `sil-${Math.round(job.gap * 1000)}.wav`)
        if (!fs.existsSync(f)) fs.writeFileSync(f, silenceWav(job.gap)); push(f, job.gap)
      }
    }
  } finally { helper.cleanup() }
  onProgress({ phase: 'mix', done, total: done })
  const name = `voice-${Date.now()}.mp3`, out = path.join(deps.outDir, name)
  const list = path.join(deps.outDir, `.list-${Date.now()}.txt`)
  fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
  try { await runFfmpeg(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-q:a', '3', '-ar', '44100', out], signal) }
  finally { try { fs.rmSync(list, { force: true }) } catch {} }
  onProgress({ phase: 'done' })
  return { path: out, duration: round(cursor), lines: timeline, generated: done - cached, cached }
}

// ---------- Cau lenh nho Claude (API) ----------
function buildAiPrompt(kind, { text, level = 'medium', lang = 'en' }) {
  const language = lang === 'vi' ? 'Vietnamese' : 'English'
  if (kind === 'emotion') {
    const amount = { light: 'sparingly (about 1 tag per 4 lines)', medium: 'moderately (about 1 tag per 2 lines)', strong: 'generously (a tag on most lines)' }[level] || 'moderately'
    return { system: 'You are a voice director. Add emotion/audio tags to a voice-over script.',
      user: `Add square-bracket tags ${amount} to this ${language} script. Allowed tags only: [laughs] [giggles] [whispers] [sighs] [excited] [sad] [angry] [curious] [sarcastic] [gasps] [short pause] [long pause]. Place a tag at the start of a line or right before the words it affects. Do NOT change, translate, add or remove any spoken words, keep the same number of lines, and return ONLY the script, no commentary.\n\n${text}` }
  }
  return { system: 'You are a voice-over editor preparing a script for text-to-speech.',
    user: `Split this ${language} script into voice chunks: one chunk per line, each 1-2 natural sentences (max ~250 characters). Between chunks where a breath or scene change fits, add a pause line written exactly like "( 0.8s )" (seconds between 0.3 and 2.5). Do NOT change the wording. Return ONLY the resulting script, no commentary.\n\n${text}` }
}

module.exports = { configure, GEMINI_VOICES, GEMINI_MODELS, ELEVEN_MODELS, EDGE_VOICES, EMOTIONS, parseScript, extractTags, srtToLines, geminiPrompt, elevenText, pcmToWav, silenceWav, wavDuration,
  makeGeminiCaller, elevenVoices, testGeminiKey, generate, buildAiPrompt, lineKey }
