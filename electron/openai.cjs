// ============================================================
//  OpenAI (API key) - nhan anh + van ban, tra ve JSON ke hoach dung.
//  Dang nhap bang API key cua OpenAI Platform (khong dung phien chatgpt.com).
// ============================================================
const API_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o'

async function call({ key, model, messages, maxTokens = 4000, timeoutMs = 240000, json = true }) {
  if (!key) throw Object.assign(new Error('Chưa đăng nhập OpenAI. Hãy nhập OpenAI API key.'), { status: 401 })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(API_URL, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, messages, max_completion_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) })
    })
  } catch (error) {
    throw new Error(error.name === 'AbortError' ? 'OpenAI trả lời quá lâu (quá thời gian chờ).' : `Không kết nối được OpenAI: ${error.message}`)
  } finally { clearTimeout(timer) }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = body?.error?.message || res.statusText
    const fail = (message) => Object.assign(new Error(message), { status: res.status })
    if (res.status === 401) throw fail('OpenAI API key không hợp lệ hoặc đã bị thu hồi. Hãy đăng nhập lại.')
    if (res.status === 403) throw fail(`OpenAI API key không có quyền dùng model này: ${detail}`)
    if (res.status === 429) throw fail('OpenAI đang giới hạn tốc độ hoặc hết hạn mức. Thử lại sau ít phút.')
    throw fail(`OpenAI lỗi ${res.status}: ${detail}`)
  }
  return String(body.choices?.[0]?.message?.content || '')
}

function partsToContent(parts) {
  return parts.map((p) => p.type === 'image'
    ? { type: 'image_url', image_url: { url: `data:${p.mime || 'image/jpeg'};base64,${p.base64}`, detail: 'low' } }
    : { type: 'text', text: String(p.text || '') })
}

async function callWithParts({ key, model, parts, system }) {
  return call({ key, model, messages: [{ role: 'system', content: system }, { role: 'user', content: partsToContent(parts) }] })
}

async function testKey(key, model) {
  await call({ key, model, messages: [{ role: 'user', content: 'Reply with {"ok":true}' }], maxTokens: 16, timeoutMs: 30000 })
  return true
}

module.exports = { callWithParts, testKey, partsToContent, DEFAULT_MODEL }
