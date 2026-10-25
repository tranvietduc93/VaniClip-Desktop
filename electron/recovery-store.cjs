const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const KEEP_REVISIONS = 5
const safeId = (id) => crypto.createHash('sha256').update(String(id || 'default')).digest('hex').slice(0, 24)

function listFiles(dir) {
  try { return fs.readdirSync(dir).filter((name) => /^rev-\d+\.json$/.test(name)) }
  catch { return [] }
}

function writeRecovery(root, project) {
  if (!project || !Number.isInteger(project.version) || project.version < 1) throw new Error('Dữ liệu recovery không hợp lệ.')
  const dir = path.join(path.resolve(root), safeId(project.projectId))
  fs.mkdirSync(dir, { recursive: true })
  const names = listFiles(dir)
  const revisions = names.map((name) => Number(name.match(/\d+/)[0])).filter(Number.isFinite)
  const revision = (revisions.length ? Math.max(...revisions) : 0) + 1
  const record = { revision, timestamp: new Date().toISOString(), name: project.name || '', project }
  const file = path.join(dir, `rev-${revision}.json`)
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  try {
    const fd = fs.openSync(temp, 'wx')
    try { fs.writeFileSync(fd, JSON.stringify(record), 'utf8'); fs.fsyncSync(fd) }
    finally { fs.closeSync(fd) }
    fs.renameSync(temp, file)
  } finally { try { fs.rmSync(temp, { force: true }) } catch {} }
  const sorted = [...revisions, revision].sort((a, b) => b - a)
  for (const old of sorted.slice(KEEP_REVISIONS)) { try { fs.rmSync(path.join(dir, `rev-${old}.json`), { force: true }) } catch {} }
  return record
}

function getRecovery(root, projectId) {
  const dir = path.join(path.resolve(root), safeId(projectId))
  const files = listFiles(dir).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))
  let corrupt = false
  for (const file of files) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (value.project && Number.isInteger(value.revision)) return { ...value, corruptPrevious: corrupt }
      corrupt = true
    } catch { corrupt = true }
  }
  return corrupt ? { corruptPrevious: true } : null
}

function dismissRecovery(root, projectId, revision) {
  const dir = path.join(path.resolve(root), safeId(projectId))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'dismissed.json')
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify({ revision: Number(revision) }), 'utf8')
    fs.renameSync(temp, file)
  } finally { try { fs.rmSync(temp, { force: true }) } catch {} }
}

function getPendingRecovery(root, projectId) {
  const recovery = getRecovery(root, projectId)
  if (!recovery?.project) return recovery
  try {
    const dismissed = JSON.parse(fs.readFileSync(path.join(path.resolve(root), safeId(projectId), 'dismissed.json'), 'utf8'))
    if (dismissed.revision >= recovery.revision) return recovery.corruptPrevious ? { corruptPrevious: true } : null
  } catch {}
  return recovery
}

function getLatestPendingRecovery(root) {
  const base = path.resolve(root)
  let dirs = []
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(base, entry.name)) } catch {}
  const records = []
  for (const dir of dirs) {
    const latest = getRecoveryFromDir(dir)
    if (!latest?.project) continue
    try {
      const dismissed = JSON.parse(fs.readFileSync(path.join(dir, 'dismissed.json'), 'utf8'))
      if (dismissed.revision >= latest.revision) continue
    } catch {}
    records.push(latest)
  }
  records.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
  return records[0] || null
}

function getRecoveryFromDir(dir) {
  const files = listFiles(dir).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))
  let corrupt = false
  for (const file of files) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (value.project && Number.isInteger(value.revision)) return { ...value, corruptPrevious: corrupt }
      corrupt = true
    } catch { corrupt = true }
  }
  return corrupt ? { corruptPrevious: true } : null
}

module.exports = { KEEP_REVISIONS, writeRecovery, getRecovery, getPendingRecovery, getLatestPendingRecovery, dismissRecovery }
