const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function comparablePath(value) {
  const resolved = path.resolve(value)
  let canonical = resolved
  try { if (fs.existsSync(resolved)) canonical = fs.realpathSync(resolved) }
  catch { /* Path equality still protects regular resolved paths when a parent denies realpath access. */ }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function validateExportPaths(sourcePaths, targetPath) {
  if (typeof targetPath !== 'string' || !targetPath.trim()) throw new Error('Đường dẫn file xuất không hợp lệ.')
  if (!Array.isArray(sourcePaths) || !sourcePaths.length) throw new Error('Không có media nguồn để xuất.')
  const target = path.resolve(targetPath)
  const targetCanonical = comparablePath(target)
  let targetStat = null
  try {
    targetStat = fs.statSync(target)
    if (!targetStat.isFile()) throw new Error('Đường dẫn file xuất phải trỏ tới một file.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  for (const sourcePath of new Set(sourcePaths)) {
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new Error('Đường dẫn media nguồn không hợp lệ.')
    let sourceStat
    try { sourceStat = fs.statSync(sourcePath) }
    catch { throw new Error(`Không tìm thấy media nguồn: ${sourcePath}`) }
    if (!sourceStat.isFile()) throw new Error(`Media nguồn không phải file: ${sourcePath}`)
    const samePath = comparablePath(sourcePath) === targetCanonical
    const sameFile = targetStat && sourceStat.ino > 0 && targetStat.ino > 0 &&
      sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino
    if (samePath || sameFile) throw new Error(`File xuất không được ghi đè media nguồn: ${sourcePath}`)
  }
  return target
}

function createStagingPath(targetPath, jobId = '') {
  const target = path.resolve(targetPath)
  const ext = path.extname(target)
  const stem = path.basename(target, ext)
  const suffix = String(jobId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || crypto.randomUUID()
  return path.join(path.dirname(target), `.${stem}.${suffix}.${crypto.randomUUID()}.partial${ext}`)
}

function publishOutput(stagingPath, targetPath) {
  const staging = path.resolve(stagingPath)
  const target = path.resolve(targetPath)
  try {
    if (path.dirname(staging) !== path.dirname(target)) throw new Error('File tạm phải nằm cùng thư mục với file đích.')
    const stat = fs.statSync(staging)
    if (!stat.isFile() || stat.size <= 0) throw new Error('File xuất rỗng hoặc không hợp lệ.')
    const backup = `${target}.${crypto.randomUUID()}.bak`
    let movedOld = false
    try {
      if (fs.existsSync(target)) { fs.renameSync(target, backup); movedOld = true }
      fs.renameSync(staging, target)
      if (movedOld) { try { fs.rmSync(backup, { force: true }) } catch {} }
      return target
    } catch (error) {
      if (movedOld && !fs.existsSync(target) && fs.existsSync(backup)) {
        try { fs.renameSync(backup, target) } catch {}
      }
      throw error
    }
  } finally {
    try { fs.rmSync(staging, { force: true }) } catch {}
  }
}

function discardOutput(stagingPath) {
  try { fs.rmSync(path.resolve(stagingPath), { force: true }) } catch {}
}

module.exports = { createStagingPath, validateExportPaths, publishOutput, discardOutput }
