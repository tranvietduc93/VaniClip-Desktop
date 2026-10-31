// Quyet dinh + tham so proxy xem truoc muot (ham thuan, test duoc khong can Electron/fluent-ffmpeg)
/** Video nao can ban xem truoc "muot" (proxy CFR, GOP ngan): VFR, ma hoa nang (HEVC/AV1/VP9/ProRes...), >1080p, 10-bit, bitrate cao, >60fps. */
function proxyAdvice(info) {
  if (!info || !info.hasVideo || info.kind === 'image') return { needed: false, reason: '' }
  const codec = String(info.vcodec || '').toLowerCase()
  if (info.vfr) return { needed: true, reason: 'vfr' }
  if (/hevc|h265|av1|vp9|prores|dnx|mpeg2|mjpeg|ffv1/.test(codec)) return { needed: true, reason: codec }
  if (Math.max(info.width || 0, info.height || 0) > 1920) return { needed: true, reason: 'resolution' }
  if (/10|12/.test(String(info.pixFmt || ''))) return { needed: true, reason: 'bitdepth' }
  if ((info.bitrate || 0) > 30e6) return { needed: true, reason: 'bitrate' }
  if ((info.fps || 0) > 60) return { needed: true, reason: 'fps' }
  return { needed: false, reason: '' }
}
/** Tham so proxy: CFR theo fps nguon (24-60), GOP = nua giay, khong B-frame -> tua/pha tung khung muot va dung khung hinh. */
function previewProxyArgs(info, input, output) {
  const fps = Math.min(60, Math.max(24, info.vfr ? Math.round(info.fps || 30) : Math.round((info.fps || 30) * 1000) / 1000))
  const gop = Math.max(6, Math.round(fps / 2))
  return ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a?', '-vf',
    `fps=${fps},scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'fastdecode', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-bf', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', output]
}

module.exports = { proxyAdvice, previewProxyArgs }
