// ============================================================
//  Phu de (captions): sinh file ASS kieu CapCut + anh xa thoi gian
//  theo cac doan giu lai (cat/auto-cut) va toc do.
// ============================================================

function fmtAssTime(t) {
  if (!t || t < 0) t = 0
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const cs = Math.round((t % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function escapeText(s) {
  // ASS override blocks use braces and backslashes. Escape these so user text
  // cannot become formatting; preserve literal braces in the rendered text.
  return String(s).replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N')
}

// Anh xa phu de tu thoi gian NGUON -> thoi gian OUTPUT (sau khi cat + tang toc)
// segments: cac doan giu lai (nguon), theo thu tu phat
function mapToOutput(captions, segments, speed = 1) {
  const out = []
  let acc = 0
  for (const seg of segments) {
    const segDur = (seg.end - seg.start) / speed
    for (const c of captions) {
      const a = Math.max(c.start, seg.start)
      const b = Math.min(c.end, seg.end)
      if (b - a > 0.05) {
        out.push({ start: acc + (a - seg.start) / speed, end: acc + (b - seg.start) / speed, text: c.text })
      }
    }
    acc += segDur
  }
  return out.sort((x, y) => x.start - y.start)
}

// Mau '#RRGGBB' -> ASS 'BBGGRR'
function rgbToAss(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 'FFFFFF'
  const h = m[1]
  return (h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)).toUpperCase()
}

// 1 dong Dialogue. event.pos (px) -> overlay co dinh vi; khong -> phu de duoi-giua
function eventLine(e) {
  const txt = escapeText(e.text)
  let ov = `{\\an${e.align === 'left' ? 4 : e.align === 'right' ? 6 : 5}`
  if (e.pos) {
    ov += `\\pos(${Math.round(e.pos.x)},${Math.round(e.pos.y)})`
  }
  if (e.fs) ov += `\\fs${e.fs}`
  if (e.color) ov += `\\1c&H${e.color}&`
  ov += '}'
  return `Dialogue: ${Math.max(0, Math.round(Number(e.layer) || 0))},${fmtAssTime(e.start)},${fmtAssTime(e.end)},Default,,0,0,0,,${ov}${txt}`
}

// Sinh ASS cho phu de + chu/sticker. events: [{start,end,text, pos?:{x,y}, fs?, color?}]
function toAss(events, opts = {}) {
  const { width = 1080, height = 1920, fontName = 'Arial', fontScale = 1, marginRatio = 0.12 } = opts
  const fs = Math.max(16, Math.round(height * 0.052 * fontScale))
  const outline = Math.max(2, Math.round(fs * 0.09))
  const marginV = Math.round(height * marginRatio)
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fs},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${outline},1,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const lines = events.filter((e) => e.text && String(e.text).trim()).slice().sort((a, b) => (a.layer || 0) - (b.layer || 0)).map(eventLine).join('\n')
  return header + lines + '\n'
}

// Sinh SRT (xuat file phu de roi - de import noi khac)
function toSrt(captions) {
  const ft = (t) => {
    const totalMs = Math.max(0, Math.round((Number(t) || 0) * 1000))
    const h = Math.floor(totalMs / 3600000), m = Math.floor(totalMs / 60000) % 60
    const s = Math.floor(totalMs / 1000) % 60, ms = totalMs % 1000
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
  }
  return captions.filter((c) => c.text && c.text.trim()).slice().sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${ft(c.start)} --> ${ft(c.end)}\n${c.text.trim()}\n`).join('\n')
}

function parseSrt(input) {
  const source = String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!source) return []
  const blocks = source.split(/\n\s*\n/)
  const parseTime = (value) => {
    const match = /^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim())
    if (!match) throw new Error(`Timestamp SRT không hợp lệ: ${value}`)
    const [, hh, mm, ss, fraction] = match
    if (+mm > 59 || +ss > 59) throw new Error(`Timestamp SRT ngoài phạm vi: ${value}`)
    const ms = Number(fraction.padEnd(3, '0').slice(0, 3))
    return +hh * 3600 + +mm * 60 + +ss + ms / 1000
  }
  return blocks.map((block, index) => {
    const lines = block.split('\n')
    if (/^\d+$/.test(lines[0].trim())) lines.shift()
    const timing = lines.shift()?.trim()
    const match = /^(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s+-->\s+(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})(?:\s+.*)?$/.exec(timing || '')
    if (!match) throw new Error(`Dòng thời gian SRT không hợp lệ ở mục ${index + 1}`)
    const start = parseTime(match[1]), end = parseTime(match[2])
    const text = lines.join('\n').trim()
    if (!text) throw new Error(`Mục SRT ${index + 1} không có nội dung`)
    if (end <= start) throw new Error(`Thời gian kết thúc phải sau thời gian bắt đầu ở mục ${index + 1}`)
    return { id: `srt-${index + 1}`, start, end, text }
  }).sort((a, b) => a.start - b.start)
}

module.exports = { mapToOutput, toAss, toSrt, parseSrt, fmtAssTime, rgbToAss }
