// ============================================================
//  AI Auto Edit (main process)
//  Pipeline: probe -> phat hien canh (ffmpeg scene) -> khoang lang -> loi thoai (Whisper, cat cua so theo RAM)
//            -> tao "doan ung vien" -> lay khung hinh -> Claude/OpenAI nhin anh + doc loi thoai de chon & sap xep
//            -> (khong co khoa AI) bo lap ke hoach cuc bo -> vua thoi luong -> do am luong giong/nhac.
//  Cac ham thuan (parse, ung vien, prompt, chuan hoa, vua thoi luong) duoc export de test khong can Electron.
// ============================================================
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { extractJson } = require('./claude.cjs')

let FFMPEG = null
function configure(ffmpegPath) { FFMPEG = ffmpegPath }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const round = (v, d = 3) => { const k = 10 ** d; return Math.round(v * k) / k }
const cancelled = () => Object.assign(new Error('Đã hủy AI Auto Edit.'), { cancelled: true })
function guard(signal) { if (signal?.aborted) throw cancelled() }

// ---------- Tai nguyen may: quyet dinh mat do lay mau / model / cua so am thanh ----------
function resourceBudget({ cores = os.cpus().length, freeMem = os.freemem(), totalSeconds = 0 } = {}) {
  const gb = freeMem / 2 ** 30
  return {
    maxFramesPerRequest: clamp(Math.round(cores * 4), 12, gb < 4 ? 20 : 40),
    frameWidth: gb < 4 ? 336 : 448,
    sceneFps: cores >= 8 ? 6 : 3,
    audioWindowSec: gb < 4 ? 300 : 600,
    whisperModel: gb < 3 || totalSeconds > 2 * 3600 ? 'Xenova/whisper-tiny' : 'Xenova/whisper-base',
    maxSegmentSec: 10
  }
}

// ---------- Doc y dinh tu cau lenh tieng Viet ----------
function removeDiacritics(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase() }

/** "dung video 30 giay", "2 phut", "90s" -> so giay; khong thay -> 0 */
function parseDurationFromPrompt(text) {
  const s = removeDiacritics(text)
  let m = /(\d+(?:[.,]\d+)?)\s*(?:phut|min|m\b)\s*(?:(\d{1,2})\s*(?:giay|s|sec)?)?/.exec(s)
  if (m && /phut|min/.test(m[0])) return Math.round(Number(m[1].replace(',', '.')) * 60 + (m[2] ? Number(m[2]) : 0))
  m = /(\d+(?:[.,]\d+)?)\s*(?:giay|sec|s)\b/.exec(s)
  if (m) return Math.round(Number(m[1].replace(',', '.')))
  return 0
}

/** Doan ty le khung tu cau lenh; khong thay -> null */
function detectRatioFromPrompt(text) {
  const s = removeDiacritics(text)
  if (/\b9\s*[:/x]\s*16\b|doc\b|tiktok|reels?|shorts?|story/.test(s)) return '9:16'
  if (/\b16\s*[:/x]\s*9\b|ngang|youtube|man hinh rong/.test(s)) return '16:9'
  if (/\b1\s*[:/x]\s*1\b|vuong|instagram post/.test(s)) return '1:1'
  return null
}

// ---------- ffmpeg helpers ----------
function runFfmpeg(args, { signal, collect = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('AI Auto Edit chưa được cấu hình FFmpeg.'))
    guard(signal)
    const ps = spawn(FFMPEG, args)
    let err = ''
    const abort = () => { try { ps.kill('SIGKILL') } catch {} }
    signal?.addEventListener('abort', abort, { once: true })
    ps.stderr.on('data', (d) => { if (collect) err += d; if (err.length > 4e6) err = err.slice(-2e6) })
    ps.on('error', (e) => { signal?.removeEventListener('abort', abort); reject(e) })
    ps.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return reject(cancelled())
      code === 0 ? resolve(err) : reject(new Error('ffmpeg lỗi: ' + err.slice(-400)))
    })
  })
}

function parseSceneTimes(stderr, duration = Infinity, { minGap = 0.8, edge = 0.4 } = {}) {
  const times = [...String(stderr).matchAll(/pts_time:\s*(-?[\d.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite).sort((a, b) => a - b)
  const out = []
  for (const t of times) {
    if (t < edge || t > duration - edge) continue
    if (out.length && t - out[out.length - 1] < minGap) continue
    out.push(round(t))
  }
  return out
}

async function detectScenes(input, { duration, fps = 3, threshold = 0.3, signal } = {}) {
  const vf = `fps=${fps},scale=320:-2,select=gt(scene\\,${threshold}),showinfo`
  const err = await runFfmpeg(['-hide_banner', '-nostats', '-i', path.resolve(input), '-an', '-vf', vf, '-f', 'null', '-'], { signal })
  return parseSceneTimes(err, duration)
}

function parseMeanVolume(stderr) {
  const mean = /mean_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr), max = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(stderr)
  const num = (m) => (m && m[1] !== '-inf' ? Number(m[1]) : null)
  return { meanDb: num(mean), maxDb: num(max) }
}
async function measureVolume(input, { start = 0, seconds = 120, signal } = {}) {
  const err = await runFfmpeg(['-hide_banner', '-nostats', '-ss', String(Math.max(0, start)), '-t', String(seconds), '-i', path.resolve(input), '-vn',
    '-af', 'volumedetect', '-f', 'null', '-'], { signal })
  return parseMeanVolume(err)
}

async function extractFrameJpeg(input, time, output, width, { image = false, signal } = {}) {
  const args = ['-y', '-v', 'error']
  if (!image) args.push('-ss', String(Math.max(0, time)))
  args.push('-i', path.resolve(input), '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '6', output)
  await runFfmpeg(args, { signal })
  return output
}

async function extractWavWindow(input, start, seconds, output, signal) {
  await runFfmpeg(['-y', '-v', 'error', '-ss', String(Math.max(0, start)), '-t', String(seconds), '-i', path.resolve(input), '-vn', '-ar', '16000', '-ac', '1',
    '-c:a', 'pcm_s16le', '-f', 'wav', output], { signal })
  return output
}

/** Whisper theo cua so (video dai khong nap het am thanh vao RAM). */
async function transcribeAsset(input, { duration, windowSec, language, model, task, whisper, tmpDir, onStatus, signal }) {
  const out = []
  for (let offset = 0, n = 0; offset < duration - 0.2; offset += windowSec, n++) {
    guard(signal)
    const wav = path.join(tmpDir, `w${n}.wav`)
    await extractWavWindow(input, offset, Math.min(windowSec, duration - offset), wav, signal)
    try {
      const segs = await whisper.transcribe(wav, { language, model, task, onStatus })
      for (const s of segs) out.push({ start: round(s.start + offset), end: round(s.end + offset), text: s.text })
    } finally { try { fs.rmSync(wav, { force: true }) } catch {} }
  }
  return out
}

// ---------- Doan ung vien ----------
function overlapText(transcript, start, end) {
  return (transcript || []).filter((s) => { const mid = (s.start + s.end) / 2; return mid >= start && mid <= end }).map((s) => s.text).join(' ').trim()
}
function wordCount(text) { return String(text || '').split(/\s+/).filter(Boolean).length }

function intersect(range, speech) {
  if (!speech?.length) return [range]
  const out = []
  for (const s of speech) {
    const a = Math.max(range.start, s.start), b = Math.min(range.end, s.end)
    if (b - a > 0.05) out.push({ start: a, end: b })
  }
  return out
}

function splitLong(range, transcript, { minLen, maxLen }) {
  const out = []
  let cursor = range.start
  while (range.end - cursor > maxLen + minLen) {
    const ends = (transcript || []).map((s) => s.end).filter((t) => t > cursor + minLen * 2 && t <= cursor + maxLen)
    const cut = ends.length ? ends[ends.length - 1] : cursor + maxLen
    out.push({ start: cursor, end: cut }); cursor = cut
  }
  out.push({ start: cursor, end: range.end })
  return out
}

/** asset: {id, name, kind, duration}; cuts: moc doi canh; speech: cac doan co tieng (hoac null); transcript: [{start,end,text}] */
function buildCandidates(asset, assetIndex, { cuts = [], speech = null, transcript = [], minLen = 0.8, maxLen = 10, imageSeconds = 3 } = {}) {
  const base = { assetId: asset.id, assetIndex, assetName: asset.name, kind: asset.kind === 'image' ? 'image' : 'video' }
  if (asset.kind === 'image') return [{ ...base, id: `a${assetIndex}-0`, start: 0, end: imageSeconds, text: '', words: 0 }]
  const duration = Number(asset.duration) || 0
  if (duration <= 0) return []
  const edges = [0, ...cuts.filter((t) => t > 0 && t < duration), duration]
  const pieces = []
  for (let i = 0; i < edges.length - 1; i++) {
    for (const part of intersect({ start: edges[i], end: edges[i + 1] }, speech)) {
      if (part.end - part.start < minLen) continue
      pieces.push(...splitLong(part, transcript, { minLen, maxLen }))
    }
  }
  return pieces.filter((p) => p.end - p.start >= Math.min(minLen, 0.5)).map((p, n) => {
    const text = overlapText(transcript, p.start, p.end)
    return { ...base, id: `a${assetIndex}-${n}`, start: round(p.start), end: round(p.end), text, words: wordCount(text) }
  })
}

// ---------- Prompt ----------
const SYSTEM = `You are a senior short-form and long-form video editor. You receive candidate clips taken from the user's footage. Each candidate has an id, its source file, its time range, the transcript of the speech inside it and one representative frame (the image that follows its text line).
Return ONLY one JSON object, no markdown, no commentary:
{"title":"short Vietnamese title","summary":"one or two Vietnamese sentences describing the edit","selected":[{"id":"a0-3","score":8,"reason":"short Vietnamese reason","caption":""}]}
Rules:
- Follow the user's instruction (written in Vietnamese). It decides the goal, mood, pacing and what to keep or drop.
- "selected" lists ONLY candidate ids that should be in the final video, in FINAL PLAYBACK ORDER. You may reorder candidates (e.g. strongest hook first) but never invent ids.
- score is 1-10 (importance/visual quality). Drop candidates that are blurry, black, duplicated, off-topic, filler speech, accidental camera movement, or silence without value.
- Prefer complete sentences and complete actions. Do not choose a candidate whose speech is cut off unless it is the only option.
- If a target duration is given, choose candidates so the total is at or slightly below it. If no target is given, keep everything that is useful; do not pad.
- "caption" is an optional short on-screen headline (Vietnamese, max 8 words) for hook/chapter moments, otherwise "".
- Valid JSON only.`

function buildPlanParts({ instruction, ratio, targetSeconds, candidates, thumbs = {}, batchInfo = null }) {
  const parts = []
  const head = [`USER INSTRUCTION (Vietnamese): ${String(instruction || '').trim() || '(none — make the best natural edit)'}`,
    `OUTPUT RATIO: ${ratio}`,
    targetSeconds > 0 ? `TARGET DURATION: about ${Math.round(targetSeconds)} seconds${batchInfo ? ' for the WHOLE video; this batch is one part, so keep proportionally ' + (batchInfo.share * 100).toFixed(0) + '%' : ''}` : 'TARGET DURATION: none (not limited)',
    batchInfo ? `BATCH ${batchInfo.index + 1}/${batchInfo.total} of a longer footage set (chronological).` : '', 'CANDIDATES:'].filter(Boolean).join('\n')
  parts.push({ type: 'text', text: head })
  for (const c of candidates) {
    const dur = (c.end - c.start).toFixed(1)
    parts.push({ type: 'text', text: `[${c.id}] file="${c.assetName}" ${c.kind} t=${c.start.toFixed(1)}-${c.end.toFixed(1)}s (${dur}s) speech: ${c.text ? JSON.stringify(c.text.slice(0, 400)) : '(none)'}` })
    const img = thumbs[c.id]
    if (img) parts.push({ type: 'image', mime: 'image/jpeg', base64: img })
  }
  return parts
}

// ---------- Chuan hoa + vua thoi luong ----------
function normalizeSelection(raw, candidates) {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const seen = new Set(), out = []
  for (const item of Array.isArray(raw) ? raw : []) {
    const c = byId.get(String(item?.id || ''))
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    const score = Number(item.score)
    out.push({ ...c, score: Number.isFinite(score) ? clamp(score, 1, 10) : 5, reason: String(item.reason || '').slice(0, 240), caption: String(item.caption || '').slice(0, 80) })
  }
  return out
}

const segLen = (s) => s.end - s.start
function totalLen(segments) { return segments.reduce((sum, s) => sum + segLen(s), 0) }

/** Neu tong > target: bo doan diem thap nhat (ngang diem: doan ngan hon / ve sau), roi cat nhe doan cuoi. Khong bao gio keo dai. */
function fitToTarget(segments, targetSeconds, { minSegment = 0.8 } = {}) {
  const target = Number(targetSeconds)
  let list = segments.slice()
  if (!(target > 0) || !list.length) return list
  while (list.length > 1 && totalLen(list) > target + 0.05) {
    let worst = 0
    for (let i = 1; i < list.length; i++) {
      const a = list[i], b = list[worst]
      if (a.score < b.score || (a.score === b.score && (segLen(a) < segLen(b) || (segLen(a) === segLen(b) && i > worst)))) worst = i
    }
    list.splice(worst, 1)
  }
  const over = totalLen(list) - target
  if (over > 0.05 && list.length) {
    const last = list[list.length - 1]
    const newLen = Math.max(minSegment, segLen(last) - over)
    list[list.length - 1] = { ...last, end: round(last.start + newLen) }
  }
  return list
}

function heuristicSelect(candidates) {
  return candidates.map((c) => {
    const dur = Math.max(0.1, c.end - c.start)
    const wps = c.words / dur
    const score = c.kind === 'image' ? 6 : clamp(3 + wps * 2, 3, 9)
    return { ...c, score: round(score, 2), reason: c.words ? 'Có lời thoại' : 'Cảnh hình ảnh', caption: '' }
  })
}

function chunk(list, size) { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out }

function cleanOldCache(dir, maxAgeMs = 24 * 3600e3) {
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      try { if (Date.now() - fs.statSync(full).mtimeMs > maxAgeMs) fs.rmSync(full, { recursive: true, force: true }) } catch {}
    }
  } catch {}
}


// ---------- Che do web (dan tay): goi cau lenh + anh ghep de nguoi dung dan vao claude.ai / chatgpt.com ----------
/** Gop cac khung hinh cua lo thanh MOT anh ghep (4 cot) va dung cau lenh co danh so o: o #n = ung vien thu n. */
async function buildManualPackage(parts, system, { dir, signal, cols = 4, cell = [320, 180] } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const lines = [], frames = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.type !== 'text') continue
    if (parts[i + 1]?.type === 'image') { frames.push(parts[i + 1].base64); lines.push(`${p.text}  <- tile #${frames.length}`) } else lines.push(p.text)
  }
  let sheetPath = null
  if (frames.length) {
    const tag = `sheet-${Date.now()}`
    frames.forEach((b64, n) => fs.writeFileSync(path.join(dir, `${tag}-${String(n + 1).padStart(3, '0')}.jpg`), Buffer.from(b64, 'base64')))
    const rows = Math.ceil(frames.length / cols)
    sheetPath = path.join(dir, `${tag}.jpg`)
    await runFfmpeg(['-y', '-v', 'error', '-framerate', '1', '-i', path.join(dir, `${tag}-%03d.jpg`), '-frames:v', '1',
      '-vf', `scale=${cell[0]}:${cell[1]}:force_original_aspect_ratio=decrease,pad=${cell[0]}:${cell[1]}:(ow-iw)/2:(oh-ih)/2,tile=${cols}x${rows}`, '-q:v', '4', sheetPath], { signal })
    frames.forEach((_, n) => { try { fs.rmSync(path.join(dir, `${tag}-${String(n + 1).padStart(3, '0')}.jpg`), { force: true }) } catch {} })
  }
  const note = frames.length ? `The attached image is a contact sheet with ${cols} columns, read left-to-right then top-to-bottom. Tile #n is the representative frame of the n-th candidate that says "<- tile #n". Use the tiles together with the transcript.\n\n` : ''
  return { prompt: `${system}\n\n${note}${lines.join('\n')}\n\nReply with the JSON object only.`, sheetPath }
}

/** Hoi y nhieu bo nao: moi bo nao tra {title,summary,selected:[{id,score,reason,caption}]}. Giu id duoc >= nua so bo nao chon,
 *  diem = trung binh, thu tu theo bo nao dau tien. */
function mergeEnsemble(results) {
  const list = results.filter((r) => r && Array.isArray(r.selected))
  if (!list.length) return { title: '', summary: '', selected: [] }
  const need = Math.ceil(list.length / 2)
  const stat = new Map()
  list.forEach((r, bi) => r.selected.forEach((item, pos) => {
    const id = String(item?.id || ''); if (!id) return
    const e = stat.get(id) || { id, votes: 0, score: 0, pos: 0, first: bi * 1e4 + pos, reason: '', best: -1, caption: '' }
    const sc = Number.isFinite(Number(item.score)) ? Number(item.score) : 5
    e.votes++; e.score += sc; e.pos += pos / Math.max(1, r.selected.length - 1 || 1)
    if (sc > e.best) { e.best = sc; e.reason = String(item.reason || e.reason || ''); }
    if (!e.caption && item.caption) e.caption = String(item.caption)
    stat.set(id, e)
  }))
  const kept = [...stat.values()].filter((e) => e.votes >= need)
    .sort((a, b) => a.first - b.first) // giu mach ke cua bo nao dau tien; id chi bo nao sau chon xep tiep theo
  return { title: list.find((r) => r.title)?.title || '', summary: list.find((r) => r.summary)?.summary || '',
    selected: kept.map((e) => ({ id: e.id, score: Math.round((e.score / e.votes) * 10) / 10, reason: e.reason, caption: e.caption })) }
}

// ---------- Orchestrator ----------
/**
 * req: { instruction, ratio, targetSeconds, assets:[{id,name,path,kind,duration,hasAudio}], music:{id,path}|null,
 *        options:{ captions, removeSilence, language, detailed }, planner:{ engine:'claude'|'openai'|null } }
 * deps: { callPlanner(parts, system) -> text | null, whisper, cacheDir, probe(path), detectSilence, computeKeep, onProgress, signal }
 */
async function runAutoEdit(req, deps) {
  const { signal, onProgress = () => {} } = deps
  const instruction = String(req.instruction || '')
  const ratio = ['16:9', '9:16', '1:1'].includes(req.ratio) ? req.ratio : (detectRatioFromPrompt(instruction) || '9:16')
  const targetSeconds = Number(req.targetSeconds) > 0 ? Number(req.targetSeconds) : parseDurationFromPrompt(instruction)
  const options = { captions: true, removeSilence: true, language: 'vietnamese', ...(req.options || {}) }
  const assets = (req.assets || []).filter((a) => a && a.path).slice(0, 200)
  if (!assets.length) throw new Error('Chưa có video hoặc ảnh nào trong thư viện Media để AI dựng.')

  const jobDir = path.join(deps.cacheDir, `job-${Date.now()}`)
  const tmpDir = path.join(jobDir, 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  cleanOldCache(deps.cacheDir)

  const warnings = []
  // 1) Thong tin that cua tung file + ngan sach tai nguyen theo tong thoi luong
  const infos = []
  for (const [i, a] of assets.entries()) {
    guard(signal); onProgress({ phase: 'probe', label: a.name, done: i, total: assets.length })
    const info = await deps.probe(a.path)
    infos.push({ ...a, kind: a.kind === 'image' || info.kind === 'image' ? 'image' : 'video', duration: Number(info.duration) || Number(a.duration) || 0, hasAudio: !!info.hasAudio })
  }
  const totalSeconds = infos.reduce((s, a) => s + (a.kind === 'video' ? a.duration : 0), 0)
  const budget = resourceBudget({ totalSeconds })

  // 2) Phan tich tung file: canh, khoang lang, loi thoai
  const candidates = [], transcripts = {}
  for (const [i, a] of infos.entries()) {
    guard(signal)
    if (a.kind === 'image') { candidates.push(...buildCandidates(a, i)); continue }
    onProgress({ phase: 'scenes', label: a.name, done: i, total: infos.length })
    let cuts = []
    try { cuts = await detectScenes(a.path, { duration: a.duration, fps: budget.sceneFps, signal }) } catch (e) { if (e.cancelled) throw e; warnings.push(`Không dò được cảnh của "${a.name}": ${e.message}`) }
    let speech = null
    if (a.hasAudio && options.removeSilence) {
      onProgress({ phase: 'silence', label: a.name, done: i, total: infos.length })
      try {
        const sil = (await deps.detectSilence(a.path, { noise: '-30dB', minSilence: 0.5 })).map((s) => ({ ...s, end: s.end == null ? a.duration : s.end }))
        const keep = deps.computeKeep(a.duration, sil, 0.08)
        // video gan nhu khong co tieng noi (toan khoang lang) van giu theo canh: chi loc khi co it nhat 1 doan tieng
        if (keep.length) speech = keep
      } catch (e) { warnings.push(`Không phân tích khoảng lặng của "${a.name}": ${e.message}`) }
    }
    let transcript = []
    if (a.hasAudio && (options.captions || speech)) {
      onProgress({ phase: 'transcribe', label: a.name, done: i, total: infos.length })
      try {
        transcript = await transcribeAsset(a.path, { duration: a.duration, windowSec: budget.audioWindowSec, language: options.language || 'vietnamese',
          model: budget.whisperModel, task: options.captionTask === 'translate' ? 'translate' : 'transcribe', whisper: deps.whisper, tmpDir, signal,
          onStatus: (s) => onProgress({ phase: 'model', label: a.name, status: s, done: i, total: infos.length }) })
      } catch (e) { if (e.cancelled) throw e; warnings.push(`Không nhận dạng được lời thoại của "${a.name}": ${e.message}`) }
    }
    transcripts[a.id] = transcript
    // Tieng noi that su (co chu) quyet dinh doan nao la "co noi dung": bo doan chi la tieng on khi co ban ghi chu
    const useSpeech = speech && transcript.length ? speech : (speech && !options.captions ? speech : null)
    candidates.push(...buildCandidates(a, i, { cuts, speech: useSpeech, transcript, maxLen: budget.maxSegmentSec }))
  }
  if (!candidates.length) throw new Error('Không tìm được đoạn nào đủ dài để dựng. Hãy thử tắt "Cắt đoạn im lặng" hoặc dùng file khác.')

  // 3) Khung hinh dai dien (dung cho AI nhin va cho ban xem truoc)
  const framesDir = path.join(jobDir, 'frames'); fs.mkdirSync(framesDir, { recursive: true })
  const thumbPath = {}
  const infoById = new Map(infos.map((a) => [a.id, a]))
  for (const [i, c] of candidates.entries()) {
    guard(signal)
    if (i % 4 === 0) onProgress({ phase: 'frames', done: i, total: candidates.length })
    const a = infoById.get(c.assetId)
    const out = path.join(framesDir, `${c.id}.jpg`)
    try { await extractFrameJpeg(a.path, (c.start + c.end) / 2, out, budget.frameWidth, { image: a.kind === 'image', signal }); thumbPath[c.id] = out }
    catch (e) { if (e.cancelled) throw e }
  }

  // 4) Chon + sap xep: AI nhin anh theo lo, hoac bo lap ke hoach cuc bo
  let selected = [], engine = 'heuristic', title = '', summary = ''
  const batches = chunk(candidates, budget.maxFramesPerRequest)
  if (deps.callPlanner) {
    engine = 'ai'
    const totalAll = totalLen(candidates) || 1
    for (const [bi, batch] of batches.entries()) {
      guard(signal); onProgress({ phase: 'plan', done: bi, total: batches.length })
      const thumbs = {}
      for (const c of batch) if (thumbPath[c.id]) { try { thumbs[c.id] = fs.readFileSync(thumbPath[c.id]).toString('base64') } catch {} }
      const parts = buildPlanParts({ instruction, ratio, targetSeconds, candidates: batch, thumbs,
        batchInfo: batches.length > 1 ? { index: bi, total: batches.length, share: totalLen(batch) / totalAll } : null })
      const text = await deps.callPlanner(parts, SYSTEM, { index: bi, total: batches.length, jobDir })
      const parsed = extractJson(text)
      if (!title && parsed.title) title = String(parsed.title).slice(0, 120)
      if (parsed.summary) summary = summary ? `${summary} ${String(parsed.summary).slice(0, 300)}` : String(parsed.summary).slice(0, 300)
      selected.push(...normalizeSelection(parsed.selected, batch))
    }
    if (!selected.length) warnings.push('AI không chọn đoạn nào; dùng bộ lập kế hoạch cục bộ thay thế.')
  }
  if (!selected.length) { engine = 'heuristic'; selected = heuristicSelect(candidates); if (!summary) summary = 'Kế hoạch cục bộ (chưa đăng nhập AI): giữ các đoạn có lời thoại và cảnh rõ theo thứ tự quay.' }
  const fitted = fitToTarget(selected, targetSeconds)
  if (targetSeconds > 0 && totalLen(fitted) < targetSeconds * 0.6) warnings.push(`Tổng thời lượng ${Math.round(totalLen(fitted))}s ngắn hơn mục tiêu ${targetSeconds}s vì không đủ cảnh tốt; AI không kéo dài bằng cảnh thừa.`)

  // 5) Do am luong de can chinh nhac
  const loudness = { voiceDb: null, musicDb: null }
  const voiceAsset = infos.find((a) => a.kind === 'video' && a.hasAudio)
  try {
    if (voiceAsset) loudness.voiceDb = (await measureVolume(voiceAsset.path, { seconds: 120, signal })).meanDb
    if (req.music?.path) loudness.musicDb = (await measureVolume(req.music.path, { seconds: 120, signal })).meanDb
  } catch (e) { if (e.cancelled) throw e; warnings.push('Không đo được âm lượng; dùng mức nhạc mặc định.') }

  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  onProgress({ phase: 'done' })
  return {
    title: title || 'Bản dựng AI', summary, ratio, targetSeconds, engine,
    segments: fitted.map((s, i) => ({ id: `seg-${i + 1}`, candidateId: s.id, assetId: s.assetId, assetName: s.assetName, kind: s.kind, in: s.start, out: s.end,
      score: s.score, reason: s.reason, caption: s.caption, text: s.text, thumb: thumbPath[s.id] || null })),
    transcripts, loudness, warnings,
    stats: { assets: infos.length, candidates: candidates.length, batches: batches.length, sourceSeconds: round(totalSeconds, 1), cores: os.cpus().length, whisperModel: budget.whisperModel }
  }
}

module.exports = {
  configure, resourceBudget, parseDurationFromPrompt, detectRatioFromPrompt, parseSceneTimes, parseMeanVolume, buildCandidates, buildPlanParts,
  normalizeSelection, fitToTarget, heuristicSelect, chunk, runAutoEdit, buildManualPackage, mergeEnsemble, SYSTEM
}
