// ============================================================
//  Claude (Anthropic API): phan tich kich ban -> canh co thoi gian + goi y media.
//  Key luu ma hoa o settings.cjs; renderer khong bao gio doc duoc key.
// ============================================================
const API_URL = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const MODEL = 'claude-sonnet-5-5'
const TEST_MODEL = 'claude-haiku-5-5'
const MIN_SCENE = 0.8

async function callClaude({ key, model, system, user, maxTokens = 8000, timeoutMs = 180000 }) {
  if (!key) throw new Error('Chưa đăng nhập Claude. Hãy nhập Anthropic API key trong tab Kịch bản.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': API_VERSION },
      body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}),
        messages: [{ role: 'user', content: user }] })
    })
  } catch (error) {
    throw new Error(error.name === 'AbortError' ? 'Claude trả lời quá lâu (quá thời gian chờ).' : `Không kết nối được Claude: ${error.message}`)
  } finally { clearTimeout(timer) }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = body?.error?.message || res.statusText
    if (res.status === 401) throw new Error('API key không hợp lệ hoặc đã bị thu hồi. Hãy đăng nhập lại.')
    if (res.status === 403) throw new Error(`API key không có quyền dùng model này: ${detail}`)
    if (res.status === 429) throw new Error('Claude đang giới hạn tốc độ hoặc hết hạn mức. Thử lại sau ít phút.')
    if (res.status === 400 && /credit/i.test(detail)) throw new Error('Tài khoản API hết credit. Nạp thêm tại console.anthropic.com.')
    throw new Error(`Claude lỗi ${res.status}: ${detail}`)
  }
  return (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
}

async function testKey(key) {
  await callClaude({ key, model: TEST_MODEL, user: 'ping', maxTokens: 8, timeoutMs: 30000 })
  return true
}

function extractJson(text) {
  const s = String(text || '').replace(/```json|```/gi, '').trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('Claude không trả về JSON hợp lệ.')
  return JSON.parse(s.slice(a, b + 1))
}

// Ep canh lien tuc: canh dau bat dau 0, canh sau bat dau tai ket thuc canh truoc, tong = totalDuration (neu co)
function normalizeScenes(rawScenes, { totalDuration = null, mediaCount = 0 } = {}) {
  const list = (Array.isArray(rawScenes) ? rawScenes : []).map((s) => ({
    text: String(s?.text || '').trim(),
    visual: String(s?.visual || '').trim(),
    start: Number(s?.start), end: Number(s?.end),
    media: Number.isInteger(s?.media) && s.media >= 0 && s.media < mediaCount ? s.media : null
  })).filter((s) => s.text || s.visual)
  if (!list.length) throw new Error('Claude không tách được cảnh nào từ kịch bản.')
  list.sort((a, b) => (Number.isFinite(a.start) ? a.start : Infinity) - (Number.isFinite(b.start) ? b.start : Infinity))
  // dung "diem bat dau" lam ranh gioi; diem ket thuc cua canh = bat dau canh sau
  let cursor = 0
  const out = []
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    const nextStart = list[i + 1] && Number.isFinite(list[i + 1].start) ? list[i + 1].start : null
    let end = nextStart != null ? nextStart : (Number.isFinite(s.end) ? s.end : cursor + 3)
    if (i === list.length - 1 && totalDuration) end = totalDuration
    end = Math.max(cursor + MIN_SCENE, end)
    out.push({ ...s, start: Math.round(cursor * 100) / 100, end: Math.round(end * 100) / 100 })
    cursor = end
  }
  // neu tong vuot totalDuration (do ep MIN_SCENE) -> co lai ti le
  if (totalDuration && cursor > totalDuration + 0.05) {
    const k = totalDuration / cursor
    for (const s of out) { s.start = Math.round(s.start * k * 100) / 100; s.end = Math.round(s.end * k * 100) / 100 }
  }
  out.forEach((s, i) => { s.id = `scene-${i + 1}`; s.duration = Math.round((s.end - s.start) * 100) / 100 })
  return out
}

const SYSTEM = `You are a professional short-form video editor. Analyze the FULL SCRIPT together with the actual timed voice-over transcript and the available image/video library. Return ONLY one JSON object, no markdown or commentary:
{"scenes":[{"text":"exact narration words for this scene, copied verbatim and in order","start":0,"end":4.2,"visual":"specific visual matching the narration","media":3}]}
Rules:
- The supplied SCRIPT is the source of truth for wording. Every word must appear in exactly one scene, in the original order. Never rewrite, translate, omit, or summarize narration.
- If a timed voice-over transcript is provided, its timestamps are authoritative. Match each line to the actual speech, not an estimated reading speed. Place visual cuts at natural sentence/idea boundaries nearest to real speech boundaries.
- Examine timestamp gaps between transcript segments. Treat a gap as a real pause/silence: do not move the next spoken line earlier to fill it. Keep the current visual during the pause, and start the next visual at the next line's real start whenever possible. Use the given total voice duration for the final end.
- Scenes must cover the full video from 0 to totalDuration without overlaps or missing time. Keep scene boundaries aligned to the transcript's real timestamps; do not compress pauses or stretch speech to fit.
- If no timed transcript is provided, estimate natural narration duration from the script (Vietnamese: about 0.3-0.4 seconds per syllable-word, plus about 0.3 seconds for commas and 0.6 seconds for full stops).
- Each scene should usually last 2-8 seconds, but never cut a spoken sentence mid-word merely to satisfy this target. Prefer boundaries at the end of a sentence or complete thought.
- Describe the actual visual needed for that exact narration segment. Select the best matching media file using its name, kind, and duration. The media index is zero-based; use null if none fits. Avoid reusing the same file for consecutive scenes unless the library is small.
- Use precise, concrete visual descriptions that can guide editing. If the next narration changes subject, recommend a matching next image/video rather than a generic repeated shot.
- Return valid JSON only. `

function buildUserPrompt({ script, transcript, totalDuration, media }) {
  const parts = []
  parts.push(`SCRIPT:\n${String(script).trim()}`)
  if (Array.isArray(transcript) && transcript.length) {
    const timedLines = transcript.map((c, i) => {
      const next = transcript[i + 1]
      const gap = next ? Math.max(0, Number(next.start) - Number(c.end)) : 0
      const gapNote = gap >= 0.25 ? ` [PAUSE AFTER THIS LINE: ${gap.toFixed(2)} seconds; preserve this silence]` : ''
      return `[${Number(c.start).toFixed(2)}-${Number(c.end).toFixed(2)}] ${c.text}${gapNote}`
    })
    parts.push(`TIMED TRANSCRIPT OF THE ACTUAL VOICE-OVER (seconds; timestamps are authoritative):\n${timedLines.join('\n')}`)
    parts.push('TIMING REQUIREMENT: preserve the measured pauses shown above. Do not shift the next line earlier or use an estimated reading speed when actual timestamps exist.')
  }
  if (totalDuration) parts.push(`TOTAL DURATION OF THE VOICE-OVER: ${Number(totalDuration).toFixed(2)} seconds`)
  parts.push(media?.length
    ? `MEDIA LIBRARY (index | kind | file name | seconds):\n${media.map((m) => `${m.index} | ${m.kind} | ${m.name} | ${m.duration ? Number(m.duration).toFixed(1) : '-'}`).join('\n')}`
    : 'MEDIA LIBRARY: empty (use media: null for every scene)')
  return parts.join('\n\n')
}

async function analyzeScript({ key, script, transcript = null, totalDuration = null, media = [], model = MODEL }) {
  if (!String(script || '').trim()) throw new Error('Hãy dán kịch bản trước.')
  if (String(script).length > 60000) throw new Error('Kịch bản quá dài (tối đa khoảng 60.000 ký tự mỗi lần).')
  const text = await callClaude({ key, model, system: SYSTEM, user: buildUserPrompt({ script, transcript, totalDuration, media }) })
  const parsed = extractJson(text)
  return normalizeScenes(parsed.scenes, { totalDuration, mediaCount: media.length })
}

module.exports = { analyzeScript, testKey, normalizeScenes, extractJson, buildUserPrompt }
