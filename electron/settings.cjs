// Settings store. Persist API keys only with Electron safeStorage; when it is
// unavailable, keep the key in memory for this app session and report that fact.
const fs = require('fs')
const path = require('path')

function createSettingsStore({ app, safeStorage, fsImpl = fs }) {
  let sessionApiKey = ''
  let sessionClaudeKey = ''
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
  return { setApiKey, getApiKey, hasApiKey, getStatus, setClaudeKey, getClaudeKey, getClaudeStatus }
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
  getClaudeStatus: (...args) => current().getClaudeStatus(...args)
}
