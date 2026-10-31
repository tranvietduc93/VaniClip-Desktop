// Settings store. Persist API keys only with Electron safeStorage; when it is
// unavailable, keep the key in memory for this app session and report that fact.
const fs = require('fs')
const path = require('path')

function createSettingsStore({ app, safeStorage, fsImpl = fs }) {
  let sessionApiKey = ''
  let sessionClaudeKey = ''
  let sessionOpenAiKey = ''
  const file = () => path.join(app.getPath('userData'), 'vaniclip-settings.json')
  const readRaw = () => {
    try { return JSON.parse(fsImpl.readFileSync(file(), 'utf8')) } catch { return {} }
  }
  const writeRaw = (value) => {
    const target = file(), temp = `${target}.${process.pid}.tmp`
    const backup = `${target}.${process.pid}.bak`
    let movedOld = false
    fsImpl.mkdirSync(path.dirname(target), { recursive: true })
    try {
      fsImpl.writeFileSync(temp, JSON.stringify(value), 'utf8')
      if (fsImpl.existsSync(target)) { fsImpl.renameSync(target, backup); movedOld = true }
      fsImpl.renameSync(temp, target)
      if (movedOld) fsImpl.rmSync(backup, { force: true })
    } catch (error) {
      try { fsImpl.rmSync(temp, { force: true }) } catch {}
      if (movedOld && !fsImpl.existsSync(target)) { try { fsImpl.renameSync(backup, target) } catch {} }
      throw new Error(`Không ghi được cài đặt VaniClip: ${error.message}`)
    }
  }
  const encryptedAvailable = () => !!safeStorage?.isEncryptionAvailable?.()

  function setApiKey(key) {
    const obj = readRaw()
    const value = String(key || '').trim()
    if (!value) {
      sessionApiKey = ''
      delete obj.googleTtsKey; delete obj.googleTtsKeyEnc
      writeRaw(obj)
      return { saved: true, persistent: true, encrypted: true }
    }
    if (!encryptedAvailable()) {
      sessionApiKey = value
      delete obj.googleTtsKey; delete obj.googleTtsKeyEnc
      writeRaw(obj)
      return { saved: true, persistent: false, encrypted: false }
    }
    const encrypted = safeStorage.encryptString(value).toString('base64')
    obj.googleTtsKey = encrypted; obj.googleTtsKeyEnc = true
    writeRaw(obj)
    sessionApiKey = ''
    return { saved: true, persistent: true, encrypted: true }
  }
  function getApiKey() {
    if (sessionApiKey) return sessionApiKey
    const obj = readRaw()
    if (!obj.googleTtsKey || obj.googleTtsKeyEnc !== true || !encryptedAvailable()) return ''
    try { return safeStorage.decryptString(Buffer.from(obj.googleTtsKey, 'base64')) } catch { return '' }
  }
  function hasApiKey() { return !!getApiKey() }
  function getStatus() {
    if (sessionApiKey) return { configured: true, persistent: false, encrypted: false }
    const obj = readRaw()
    const available = encryptedAvailable()
    const encryptedStored = !!obj.googleTtsKey && obj.googleTtsKeyEnc === true
    return { configured: !!(encryptedStored && available && getApiKey()), persistent: encryptedStored, encrypted: encryptedStored,
      needsReentry: !!obj.googleTtsKey && obj.googleTtsKeyEnc !== true }
  }

  // ---- Claude (Anthropic) API key: luu ma hoa bang safeStorage de tu dong dang nhap lan sau ----
  function setClaudeKey(key) {
    const obj = readRaw()
    const value = String(key || '').trim()
    delete obj.claudeKey; delete obj.claudeKeyEnc
    sessionClaudeKey = ''
    if (!value) { writeRaw(obj); return { saved: true, persistent: true, encrypted: true } }
    if (!encryptedAvailable()) { sessionClaudeKey = value; writeRaw(obj); return { saved: true, persistent: false, encrypted: false } }
    obj.claudeKey = safeStorage.encryptString(value).toString('base64'); obj.claudeKeyEnc = true
    writeRaw(obj)
    return { saved: true, persistent: true, encrypted: true }
  }
  function getClaudeKey() {
    if (sessionClaudeKey) return sessionClaudeKey
    const obj = readRaw()
    if (!obj.claudeKey || obj.claudeKeyEnc !== true || !encryptedAvailable()) return ''
    try { return safeStorage.decryptString(Buffer.from(obj.claudeKey, 'base64')) } catch { return '' }
  }
  function getClaudeStatus() {
    const key = getClaudeKey()
    const obj = readRaw()
    return { configured: !!key, persistent: !!obj.claudeKey && obj.claudeKeyEnc === true,
      hint: key ? `${key.slice(0, 7)}…${key.slice(-4)}` : '' }
  }

  // ---- OpenAI API key (cung co che: ma hoa bang safeStorage) ----
  function setOpenAiKey(key) {
    const obj = readRaw()
    const value = String(key || '').trim()
    delete obj.openaiKey; delete obj.openaiKeyEnc
    sessionOpenAiKey = ''
    if (!value) { writeRaw(obj); return { saved: true, persistent: true, encrypted: true } }
    if (!encryptedAvailable()) { sessionOpenAiKey = value; writeRaw(obj); return { saved: true, persistent: false, encrypted: false } }
    obj.openaiKey = safeStorage.encryptString(value).toString('base64'); obj.openaiKeyEnc = true
    writeRaw(obj)
    return { saved: true, persistent: true, encrypted: true }
  }
  function getOpenAiKey() {
    if (sessionOpenAiKey) return sessionOpenAiKey
    const obj = readRaw()
    if (!obj.openaiKey || obj.openaiKeyEnc !== true || !encryptedAvailable()) return ''
    try { return safeStorage.decryptString(Buffer.from(obj.openaiKey, 'base64')) } catch { return '' }
  }
  function getOpenAiStatus() {
    const key = getOpenAiKey()
    const obj = readRaw()
    return { configured: !!key, persistent: !!obj.openaiKey && obj.openaiKeyEnc === true, model: obj.openaiModel || '',
      hint: key ? `${key.slice(0, 5)}…${key.slice(-4)}` : '' }
  }
  function setOpenAiModel(model) { const obj = readRaw(); const v = String(model || '').trim().slice(0, 80); if (v) obj.openaiModel = v; else delete obj.openaiModel; writeRaw(obj) }

  // ---- Trang thai xac thuc (khong chua bi mat): signed_out | signed_in | invalid | rate_limited ----
  function getAuthMeta() { const m = readRaw().authMeta; return m && typeof m === 'object' ? m : {} }
  function setAuthMeta(provider, meta) {
    const obj = readRaw(); obj.authMeta = { ...(obj.authMeta || {}), [provider]: { ...meta, updatedAt: Date.now() } }; writeRaw(obj)
    return obj.authMeta[provider]
  }

  // ---- Khoa giong doc: Gemini (nhieu khoa, bat/tat tung khoa) + ElevenLabs (1 khoa). Ma hoa bang safeStorage; khong co thi chi giu trong phien ----
  let sessionVoice = { gemini: [], eleven: '' }
  const maskKey = (k) => (k.length > 10 ? `${k.slice(0, 4)}••••${k.slice(-4)}` : '••••')
  const encKey = (v) => safeStorage.encryptString(v).toString('base64')
  const decKey = (v) => { try { return safeStorage.decryptString(Buffer.from(v, 'base64')) } catch { return '' } }
  function voiceStore() { const o = readRaw(); return { obj: o, vk: o.voiceKeys && typeof o.voiceKeys === 'object' ? o.voiceKeys : { gemini: [], eleven: null } } }
  function saveVoice(obj, vk) { obj.voiceKeys = vk; writeRaw(obj) }
  function geminiKeys() { // [{id,key,hint,enabled,persistent}] - chi dung o main
    const { vk } = voiceStore(), out = []
    for (const e of vk.gemini || []) { const key = encryptedAvailable() ? decKey(e.enc) : ''; if (key) out.push({ id: e.id, key, hint: e.hint, enabled: e.enabled !== false, persistent: true }) }
    for (const e of sessionVoice.gemini) out.push({ ...e, persistent: false })
    return out
  }
  function listGeminiKeys() { return geminiKeys().map(({ id, hint, enabled, persistent }) => ({ id, hint, enabled, persistent })) }
  function addGeminiKeys(keys) {
    const existing = new Set(geminiKeys().map((k) => k.key)), fresh = []
    for (const raw of keys) { const k = String(raw || '').trim(); if (k.length >= 20 && !/\s/.test(k) && !existing.has(k)) { existing.add(k); fresh.push(k) } }
    const { obj, vk } = voiceStore(); vk.gemini = vk.gemini || []
    for (const key of fresh) {
      const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      if (encryptedAvailable()) vk.gemini.push({ id, enc: encKey(key), hint: maskKey(key), enabled: true })
      else sessionVoice.gemini.push({ id, key, hint: maskKey(key), enabled: true })
    }
    saveVoice(obj, vk)
    return { added: fresh.length, skipped: keys.length - fresh.length }
  }
  function removeGeminiKey(id) { const { obj, vk } = voiceStore(); vk.gemini = (vk.gemini || []).filter((e) => e.id !== id); sessionVoice.gemini = sessionVoice.gemini.filter((e) => e.id !== id); saveVoice(obj, vk) }
  function clearGeminiKeys() { const { obj, vk } = voiceStore(); vk.gemini = []; sessionVoice.gemini = []; saveVoice(obj, vk) }
  function setGeminiKeyEnabled(id, enabled) {
    const { obj, vk } = voiceStore()
    for (const e of vk.gemini || []) if (e.id === id) e.enabled = !!enabled
    for (const e of sessionVoice.gemini) if (e.id === id) e.enabled = !!enabled
    saveVoice(obj, vk)
  }
  function setElevenKey(key) {
    const value = String(key || '').trim(), { obj, vk } = voiceStore()
    sessionVoice.eleven = ''; vk.eleven = null
    if (value) { if (encryptedAvailable()) vk.eleven = { enc: encKey(value), hint: maskKey(value) }; else sessionVoice.eleven = value }
    saveVoice(obj, vk)
  }
  function getElevenKey() { if (sessionVoice.eleven) return sessionVoice.eleven; const { vk } = voiceStore(); return vk.eleven && encryptedAvailable() ? decKey(vk.eleven.enc) : '' }
  function getElevenStatus() { const key = getElevenKey(); return { configured: !!key, hint: key ? maskKey(key) : '' } }
  return { geminiKeys, listGeminiKeys, addGeminiKeys, removeGeminiKey, clearGeminiKeys, setGeminiKeyEnabled, setElevenKey, getElevenKey, getElevenStatus,
    setApiKey, getApiKey, hasApiKey, getStatus, setClaudeKey, getClaudeKey, getClaudeStatus,
    setOpenAiKey, getOpenAiKey, getOpenAiStatus, setOpenAiModel, getAuthMeta, setAuthMeta }
}

let store = null
function configure(dependencies) { store = createSettingsStore(dependencies); return store }
function current() { if (!store) throw new Error('Settings store chưa được cấu hình.') ; return store }

module.exports = {
  createSettingsStore, configure,
  setApiKey: (...args) => current().setApiKey(...args),
  getApiKey: (...args) => current().getApiKey(...args),
  hasApiKey: (...args) => current().hasApiKey(...args),
  getStatus: (...args) => current().getStatus(...args),
  setClaudeKey: (...args) => current().setClaudeKey(...args),
  getClaudeKey: (...args) => current().getClaudeKey(...args),
  getClaudeStatus: (...args) => current().getClaudeStatus(...args),
  geminiKeys: (...args) => current().geminiKeys(...args),
  listGeminiKeys: (...args) => current().listGeminiKeys(...args),
  addGeminiKeys: (...args) => current().addGeminiKeys(...args),
  removeGeminiKey: (...args) => current().removeGeminiKey(...args),
  clearGeminiKeys: (...args) => current().clearGeminiKeys(...args),
  setGeminiKeyEnabled: (...args) => current().setGeminiKeyEnabled(...args),
  setElevenKey: (...args) => current().setElevenKey(...args),
  getElevenKey: (...args) => current().getElevenKey(...args),
  getElevenStatus: (...args) => current().getElevenStatus(...args),
  setOpenAiKey: (...args) => current().setOpenAiKey(...args),
  getOpenAiKey: (...args) => current().getOpenAiKey(...args),
  getOpenAiStatus: (...args) => current().getOpenAiStatus(...args),
  setOpenAiModel: (...args) => current().setOpenAiModel(...args),
  getAuthMeta: (...args) => current().getAuthMeta(...args),
  setAuthMeta: (...args) => current().setAuthMeta(...args)
}
