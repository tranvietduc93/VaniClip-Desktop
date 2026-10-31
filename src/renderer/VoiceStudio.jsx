import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X, Eye, EyeOff, Trash2, Zap, Play, FolderOpen, Mic } from 'lucide-react'
import { fileUrl } from './utils.js'

const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const TAGS = ['laughs', 'giggles', 'whispers', 'sighs', 'excited', 'sad', 'angry', 'curious', 'sarcastic', 'gasps', 'short pause', 'long pause']
const EMOTIONS = [['natural', 'Tự nhiên'], ['storytelling', 'Kể chuyện ấm áp'], ['excited', 'Hào hứng'], ['cheerful', 'Vui vẻ'], ['sad', 'Buồn'], ['serious', 'Nghiêm túc / kịch tính'], ['whisper', 'Thì thầm'], ['angry', 'Giận dữ']]
const ENGINES = [['gemini', 'Gemini AI (giọng ElevenLabs)'], ['elevenlabs', 'ElevenLabs'], ['elevenweb', 'ElevenLabs (đăng nhập web)'], ['geminiweb', 'Gemini (đăng nhập web)'], ['edge', 'Miễn phí (Edge)']]
const QUOTES = {
  en: 'The best way to predict the future is to create it. Every great journey begins with a single step.\n( 0.8s )\nDo not wait for the perfect moment. Take the moment and make it perfect.',
  vi: 'Cách tốt nhất để dự đoán tương lai là tự tạo ra nó. Mọi hành trình vĩ đại đều bắt đầu từ một bước chân.\n( 0.8s )\nĐừng chờ khoảnh khắc hoàn hảo. Hãy nắm lấy khoảnh khắc và làm cho nó hoàn hảo.'
}
const SAMPLE = { en: 'This is a short sample of my voice reading your script.', vi: 'Đây là câu đọc mẫu để bạn nghe thử giọng này.' }
const LS = 'vaniclip.voice.'
const load = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v) } catch { return d } }

// Cua so "Tao giong doc AI": nhap loi doc -> tao tung dong (cache) -> ghep 1 file mp3 -> nap vao thu vien Media va lam giong cho kich ban.
export default function VoiceStudio({ onClose, onDone, subtitleText = '' }) {
  const [cat, setCat] = useState(null)
  const [keys, setKeys] = useState({ gemini: [], eleven: { configured: false, hint: '' } })
  const [engine, setEngine] = useState(() => load('engine', 'gemini'))
  const [lang, setLang] = useState(() => load('lang', 'en'))
  const [text, setText] = useState(() => load('text', ''))
  const [mode, setMode] = useState('line')
  const [emotion, setEmotion] = useState('natural')
  const [style, setStyle] = useState('')
  const [gVoice, setGVoice] = useState(() => load('gVoice', 'Kore'))
  const [gModel, setGModel] = useState('')
  const [eModel, setEModel] = useState('eleven_multilingual_v2')
  const [eVoices, setEVoices] = useState([])
  const [eVoice, setEVoice] = useState('')
  const [edgeVoice, setEdgeVoice] = useState('')
  const [edgeLocal, setEdgeLocal] = useState(false)
  const [gap, setGap] = useState(0.5)
  const [keyDraft, setKeyDraft] = useState('')
  const [elevenDraft, setElevenDraft] = useState('')
  const [showKeys, setShowKeys] = useState(false)
  const [level, setLevel] = useState('medium')
  const [aiBusy, setAiBusy] = useState('')
  const [claudeManual, setClaudeManual] = useState(null)
  const [pasted, setPasted] = useState('')
  const [channels, setChannels] = useState(() => load('channels', {}))
  const [channel, setChannel] = useState('')
  const [channelName, setChannelName] = useState('')
  const [autoPreview, setAutoPreview] = useState(true)
  const [webAcc, setWebAcc] = useState(1)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [caret, setCaret] = useState(0)
  const jobRef = useRef(''), taRef = useRef(null), audioRef = useRef(null), previewTimer = useRef(null)

  useEffect(() => {
    window.vaniclip.voiceCatalog().then((c) => { setCat(c); setEdgeVoice((v) => v || c.edgeVoices.find((x) => x.lang === (load('lang', 'en')))?.name || c.edgeVoices[0].name) }).catch((e) => setErr(clean(e)))
    window.vaniclip.voiceKeys().then(setKeys).catch(() => {})
    const off = window.vaniclip.onVoiceProgress((p) => { if (p.jobId === jobRef.current) setProgress(p) })
    return () => off?.()
  }, [])
  useEffect(() => { try { localStorage.setItem(LS + 'engine', JSON.stringify(engine)); localStorage.setItem(LS + 'lang', JSON.stringify(lang)); localStorage.setItem(LS + 'text', JSON.stringify(text)); localStorage.setItem(LS + 'gVoice', JSON.stringify(gVoice)) } catch {} }, [engine, lang, text, gVoice])
  useEffect(() => { try { localStorage.setItem(LS + 'channels', JSON.stringify(channels)) } catch {} }, [channels])
  useEffect(() => { if (cat) setEdgeVoice((v) => (cat.edgeVoices.find((x) => x.name === v && x.lang === lang) ? v : cat.edgeVoices.find((x) => x.lang === lang)?.name || v)) }, [lang, cat])

  const lineCount = useMemo(() => text.split(/\r?\n/).filter((l) => l.trim() && !/^\(\s*[\d.,]*\s*s?\s*(\|[^)]*)?\)$/.test(l.trim())).length, [text])
  const activeEngine = engine === 'edge' && edgeLocal ? 'local' : engine
  const isWeb = engine === 'elevenweb' || engine === 'geminiweb'
  const enabledKeys = keys.gemini.filter((k) => k.enabled).length

  const jobFor = (extra = {}) => ({ engine: activeEngine, lang, text, mode, emotion, style, gap: Number(gap) || 0, defaultPause: Number(gap) || 0.5,
    gemini: { voice: gVoice, model: gModel }, eleven: { voiceId: eVoice, model: eModel }, edge: { voice: edgeVoice }, ...extra })
  // Dong dang chon = dong co con tro (chi dem dong loi, bo qua dong khoang lang)
  const caretLine = () => {
    const before = text.slice(0, caret).split(/\r?\n/), idx = before.length - 1
    const all = text.split(/\r?\n/); let n = 0
    for (let i = 0; i < all.length; i++) { const l = all[i].trim(); if (!l || /^\(\s*[\d.,]*\s*s?\s*(\|[^)]*)?\)$/.test(l)) continue; if (i === idx) return n; n++ }
    return null
  }
  async function run(extra, { play = false, finish = true } = {}) {
    setBusy(true); setErr(''); setMsg(''); setProgress(null)
    const id = `v-${Date.now()}`; jobRef.current = id
    try {
      const r = await window.vaniclip.voiceGenerate(jobFor(extra), id)
      if (play) { setAudioUrl(fileUrl(r.path) + `?t=${Date.now()}`); setTimeout(() => audioRef.current?.play?.().catch(() => {}), 50) }
      setMsg(`Xong ${r.lines.length} dòng · ${r.duration.toFixed(1)}s${r.cached ? ` · dùng lại ${r.cached} dòng đã tạo` : ''}`)
      if (finish) await onDone({ path: r.path, duration: r.duration, lines: r.lines, text })
      return r
    } catch (e) { setErr(/Đã hủy/.test(String(e?.message)) ? '' : clean(e)); return null } finally { setBusy(false); setProgress(null) }
  }
  const cancel = () => window.vaniclip.voiceCancel(jobRef.current)
  // Che do web: app khong tu thao tac tren trang; chi mo cua so + chep loi doc (bo dong khoang lang) de ban dan vao
  async function openWebAndCopy() {
    setErr(''); setMsg('')
    const speech = text.split(/\r?\n/).filter((l) => l.trim() && !/^\(\s*[\d.,]*\s*s?\s*(\|[^)]*)?\)$/.test(l.trim())).join('\n')
    try {
      await window.vaniclip.autoEditCopy('text', speech)
      const r = engine === 'elevenweb' ? await window.vaniclip.openElevenLabsAccount(`acc${webAcc}`) : await window.vaniclip.voiceOpenGeminiWeb(webAcc)
      if (r && r.ok === false) throw new Error(r.reason || 'Không mở được cửa sổ web.')
      setMsg('Đã chép lời đọc vào clipboard. Dán vào trang web (Ctrl+V), tạo giọng, tải file về rồi bấm bước 3.')
    } catch (e) { setErr(clean(e)) }
  }

  // ---- Nghe thu mau / dong dau / dong dang chon ----
  const previewSample = () => run({ text: SAMPLE[lang], mode: 'line', gap: 0 }, { play: true, finish: false })
  const previewFirst = () => run({ onlyLine: 0 }, { play: true, finish: false })
  const generateSelected = () => { const i = caretLine(); if (i == null) { setErr('Đặt con trỏ vào một dòng lời đọc trước.'); return } return run({ onlyLine: i }, { play: true, finish: false }) }
  function pickGVoice(v) { setGVoice(v); if (autoPreview && engine === 'gemini' && enabledKeys && !busy) { clearTimeout(previewTimer.current); previewTimer.current = setTimeout(() => { run({ gemini: { voice: v, model: gModel }, text: SAMPLE[lang], mode: 'line', gap: 0 }, { play: true, finish: false }) }, 350) } }
  const voiceIdx = cat ? cat.geminiVoices.findIndex((v) => v.name === gVoice) : -1
  const stepVoice = (d) => { if (!cat) return; const n = cat.geminiVoices.length; pickGVoice(cat.geminiVoices[(Math.max(0, voiceIdx) + d + n) % n].name) }

  // ---- Khoa Gemini / ElevenLabs ----
  async function addKeys() { try { const r = await window.vaniclip.voiceAddGemini(keyDraft); setKeys({ gemini: r.gemini, eleven: r.eleven }); setKeyDraft(''); setMsg(`Đã thêm ${r.added} khóa${r.skipped ? `, bỏ ${r.skipped} khóa trùng/không hợp lệ` : ''}.`) } catch (e) { setErr(clean(e)) } }
  async function testKey(id) { try { const r = await window.vaniclip.voiceTestGemini(id); setMsg(r.ok ? 'Khóa hoạt động.' : ''); setErr(r.ok ? '' : `Khóa không dùng được (${r.status}): ${r.message}`) } catch (e) { setErr(clean(e)) } }
  async function saveEleven() { try { setKeys(await window.vaniclip.voiceSetEleven(elevenDraft)); setElevenDraft(''); await loadElevenVoices() } catch (e) { setErr(clean(e)) } }
  async function loadElevenVoices() { try { const v = await window.vaniclip.voiceElevenVoices(); setEVoices(v); setEVoice((cur) => cur || v[0]?.id || ''); setErr('') } catch (e) { setErr(clean(e)) } }
  useEffect(() => { if (engine === 'elevenlabs' && keys.eleven.configured && !eVoices.length) loadElevenVoices() }, [engine, keys.eleven.configured])

  // ---- Chen the cam xuc tai con tro ----
  function insertTag(tag) {
    const ta = taRef.current, pos = ta ? ta.selectionStart : text.length, t = `[${tag}] `
    setText(text.slice(0, pos) + t + text.slice(ta ? ta.selectionEnd : pos)); setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = pos + t.length } }, 0)
  }
  async function openFile() { try { const f = await window.vaniclip.voiceOpenTextFile(); if (f) setText(f.text) } catch (e) { setErr(clean(e)) } }

  // ---- Nho Claude (API hoac claude.ai dan tay) ----
  async function aiAssist(kind, mode) {
    setErr(''); setAiBusy(kind)
    try {
      const r = await window.vaniclip.voiceAiAssist(kind, { text, level, lang }, mode)
      if (mode === 'prompt') { await window.vaniclip.autoEditCopy('text', r.prompt); setClaudeManual({ kind }); setPasted(''); setMsg('Đã chép câu lệnh. Mở Claude Live, dán, rồi dán kết quả vào ô bên dưới.') } else { setText(r.text); setMsg('Đã cập nhật lời đọc (kiểm tra lại trước khi tạo).') }
    } catch (e) { setErr(clean(e)) } finally { setAiBusy('') }
  }
  // ---- Kenh: luu bo giong de lan sau chon la co ngay ----
  const snapshot = () => ({ engine, lang, gVoice, gModel, eModel, eVoice, edgeVoice, edgeLocal, emotion, style, gap, mode })
  function saveChannel() { const name = channelName.trim(); if (!name) return; setChannels((c) => ({ ...c, [name]: snapshot() })); setChannel(name); setChannelName('') }
  function pickChannel(name) {
    setChannel(name); const c = channels[name]; if (!c) return
    setEngine(c.engine); setLang(c.lang); setGVoice(c.gVoice); setGModel(c.gModel || ''); setEModel(c.eModel); setEVoice(c.eVoice || ''); setEdgeVoice(c.edgeVoice || ''); setEdgeLocal(!!c.edgeLocal)
    setEmotion(c.emotion); setStyle(c.style || ''); setGap(c.gap ?? 0.5); setMode(c.mode || 'line')
  }

  const pct = progress?.total ? Math.round(((progress.done || 0) / progress.total) * 100) : 0
  return (
    <div className="cc-modal vs-modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="vs-box" role="dialog" aria-label="Tạo giọng đọc AI">
        <div className="vs-head"><b><Mic size={15} /> Tạo giọng đọc AI <small>(không giới hạn văn bản, có cảm xúc)</small></b><button className="cap-del" onClick={onClose} disabled={busy} title="Đóng"><X size={16} /></button></div>

        <div className="vs-card vs-channel">
          <b>Giọng theo kênh:</b>
          <select value={channel} onChange={(e) => pickChannel(e.target.value)}><option value="">— Không chọn kênh —</option>{Object.keys(channels).map((n) => <option key={n}>{n}</option>)}</select>
          <input placeholder="Tên kênh mới (vd. Kênh Động vật)" value={channelName} onChange={(e) => setChannelName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveChannel()} />
          <button className="cc-auto" onClick={saveChannel} disabled={!channelName.trim()}>+ Tạo kênh</button>
          {channel && <button className="cc-auto" title="Cập nhật kênh theo cài đặt hiện tại" onClick={() => setChannels((c) => ({ ...c, [channel]: snapshot() }))}>Lưu vào kênh</button>}
          {channel && <button className="cap-del" title="Xóa kênh" onClick={() => { setChannels((c) => { const n = { ...c }; delete n[channel]; return n }); setChannel('') }}><Trash2 size={13} /></button>}
          <small>Chọn giọng ở dưới rồi đặt tên kênh → «Tạo kênh»; lần sau chọn kênh là có ngay đúng giọng.</small>
        </div>

        <div className="vs-tabs">{ENGINES.map(([k, label]) => <button key={k} className={engine === k ? 'on' : ''} onClick={() => setEngine(k)}>{label}</button>)}</div>

        {engine === 'gemini' && (
          <>
            <small className="vs-note">30 giọng, cảm xúc bằng thẻ [excited]…, dùng khóa Gemini sẵn có (có gói miễn phí).</small>
            <div className="vs-card">
              <div className="vs-row"><b>🔑 Khóa Gemini</b><span className={`vs-pill ${enabledKeys ? 'ok' : ''}`}>{enabledKeys}/{keys.gemini.length} khóa sẵn sàng</span>
                <span style={{ flex: 1 }} /><button className="cap-del" title={showKeys ? 'Ẩn' : 'Hiện'} onClick={() => setShowKeys((v) => !v)}>{showKeys ? <EyeOff size={14} /> : <Eye size={14} />}</button></div>
              {keys.gemini.map((k, i) => (
                <div key={k.id} className="vs-key"><span>{i + 1}</span>
                  <input type="checkbox" checked={k.enabled} onChange={async (e) => setKeys(await window.vaniclip.voiceToggleGemini(k.id, e.target.checked))} />
                  <b>Gemini</b><code>{showKeys ? k.hint : `${k.hint.slice(0, 4)}••••••••`}</code>
                  {!k.persistent && <small title="Máy không có mã hóa hệ thống: khóa chỉ giữ trong phiên này">(phiên)</small>}
                  <span style={{ flex: 1 }} /><button className="cc-mini" onClick={() => testKey(k.id)}><Zap size={11} /> Thử</button>
                  <button className="cap-del" onClick={async () => setKeys(await window.vaniclip.voiceRemoveGemini(k.id))}><Trash2 size={13} /></button></div>
              ))}
              <textarea rows={2} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} placeholder="Dán khóa Gemini — có thể dán NHIỀU khóa, mỗi dòng một khóa (không giới hạn số lượng)" />
              <div className="vs-row"><button className="cc-import" onClick={addKeys} disabled={!keyDraft.trim()}>+ Thêm khóa</button>
                <button className="vs-link" onClick={async () => setKeys(await window.vaniclip.voiceClearGemini())} disabled={!keys.gemini.length}>Xóa hết</button></div>
              <small>Lấy khóa miễn phí ở aistudio.google.com/apikey. Khóa sai sẽ được bỏ qua và dùng khóa kế; khi một khóa hết hạn mức, app dừng và báo (không tự xoay khóa để né giới hạn) — các dòng đã tạo được giữ lại, bạn chọn khóa khác rồi chạy tiếp. Danh sách này RIÊNG cho «Tạo giọng».</small>
            </div>
          </>
        )}
        {engine === 'elevenlabs' && (
          <div className="vs-card">
            <div className="vs-row"><b>🔑 ElevenLabs API key</b><span className={`vs-pill ${keys.eleven.configured ? 'ok' : ''}`}>{keys.eleven.configured ? `Đã lưu ${keys.eleven.hint}` : 'Chưa có khóa'}</span></div>
            <div className="vs-row"><input type="password" value={elevenDraft} onChange={(e) => setElevenDraft(e.target.value)} placeholder="Dán ElevenLabs API key" style={{ flex: 1 }} />
              <button className="cc-import" onClick={saveEleven} disabled={!elevenDraft.trim()}>Lưu & tải giọng</button>
              {keys.eleven.configured && <button className="vs-link" onClick={async () => { setKeys(await window.vaniclip.voiceSetEleven('')); setEVoices([]); setEVoice('') }}>Xóa khóa</button>}</div>
            {keys.eleven.configured && <div className="vs-row"><select value={eVoice} onChange={(e) => setEVoice(e.target.value)} style={{ flex: 1 }}>{!eVoices.length && <option value="">— Bấm “Tải giọng” —</option>}{eVoices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.category ? ` · ${v.category}` : ''}</option>)}</select>
              <button className="cc-auto" onClick={loadElevenVoices}>Tải giọng</button>
              <select value={eModel} onChange={(e) => setEModel(e.target.value)}>{(cat?.elevenModels || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>}
            <small>Thẻ cảm xúc chỉ có tác dụng với model Eleven v3; model khác sẽ tự bỏ thẻ để không bị đọc thành chữ. Mỗi dòng tính vào hạn mức ký tự của tài khoản.</small>
          </div>
        )}
        {isWeb && (
          <div className="vs-card">
            <b>{engine === 'elevenweb' ? 'ElevenLabs' : 'Gemini'} (đăng nhập web)</b>
            <small>App mở cửa sổ web có phiên đăng nhập riêng cho từng tài khoản. Bạn tự tạo giọng trên trang, tải file về rồi nạp vào đây — app không tự thao tác trên trang. (Google có thể chặn đăng nhập trong cửa sổ nhúng; khi đó hãy dùng khóa API.)</small>
            <div className="vs-row"><span className="vs-lbl">1. Tài khoản:</span>{[1, 2, 3].map((n) => <button key={n} className={`vs-chip ${webAcc === n ? 'on' : ''}`} onClick={() => setWebAcc(n)}>Tài khoản {n}</button>)}</div>
            <div className="vs-row"><span className="vs-lbl">2.</span>
              <button className="cc-import vs-main" onClick={openWebAndCopy} disabled={!lineCount}>▷ Tạo giọng đọc ({lineCount} dòng)</button>
              <small>Mở cửa sổ web của tài khoản {webAcc} và chép sẵn lời đọc — dán vào trang, tạo giọng rồi tải file về.</small></div>
            <div className="vs-row"><span className="vs-lbl">3.</span>
              <button className="cc-import" onClick={async () => { const p = await window.vaniclip.openAudio(); if (p) await onDone({ path: Array.isArray(p) ? p[0] : p, duration: 0, lines: [], text, imported: true }) }}><FolderOpen size={13} /> Nạp file giọng đã tải (mp3/wav)</button></div>
          </div>
        )}
        {engine === 'edge' && (
          <div className="vs-card">
            <div className="vs-row"><b>Giọng miễn phí</b>
              <select value={edgeVoice} onChange={(e) => setEdgeVoice(e.target.value)} disabled={edgeLocal}>{(cat?.edgeVoices || []).filter((v) => v.lang === lang).map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}</select>
              <label className="chk"><input type="checkbox" checked={edgeLocal} onChange={(e) => setEdgeLocal(e.target.checked)} disabled={lang !== 'vi'} /> Giọng cục bộ offline (chỉ tiếng Việt)</label></div>
            <small>Edge dùng dịch vụ đọc của Microsoft Edge qua gói msedge-tts (cần mạng, không cần khóa, không có thẻ cảm xúc). Giọng cục bộ chạy hoàn toàn trên máy, lần đầu tải model.</small>
          </div>
        )}

        <div className="vs-row"><span className="vs-lbl">Ngôn ngữ nạp:</span>
          <button className={`vs-chip ${lang === 'en' ? 'on' : ''}`} onClick={() => setLang('en')}>Tiếng Anh</button><button className={`vs-chip ${lang === 'vi' ? 'on' : ''}`} onClick={() => setLang('vi')}>Tiếng Việt</button>
          <span className="vs-sep">|</span><span className="vs-lbl">Điền nhanh:</span>
          <button className="vs-chip" onClick={() => setText(QUOTES.en)}>Quote EN</button><button className="vs-chip" onClick={() => setText(QUOTES.vi)}>Quote VI</button>
          <button className="vs-chip" onClick={() => setText(subtitleText)} disabled={!subtitleText.trim()}>Lời Sub hiện có</button>
          <button className="vs-chip" onClick={openFile}><FolderOpen size={12} /> Mở .txt / .srt</button></div>

        <textarea ref={taRef} className="vs-text" rows={9} value={text} onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart) }} onKeyUp={(e) => setCaret(e.target.selectionStart)} onClick={(e) => setCaret(e.target.selectionStart)}
          placeholder={'Dán lời đọc vào đây — mỗi dòng một câu (mỗi dòng sẽ ra một ảnh). Không giới hạn độ dài, có thể dán cả kịch bản.\nKéo thả file .txt / .srt vào đây cũng được. Thẻ cảm xúc: [laughs] [whispers] [short pause]…\nHoặc viết «bản đồ cắt voice»: khúc voice, rồi ( 1.2s | hình trám ) là khoảng lặng giữa hai khúc — mỗi khúc tạo riêng một lần.'}
          onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && /\.(txt|srt|md)$/i.test(f.name)) { const raw = await f.text(); setText(/\.srt$/i.test(f.name) ? raw.split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join('\n') : raw) } }} />
        <small>{lineCount} dòng · {text.length.toLocaleString('vi-VN')} ký tự</small>

        <div className="vs-row"><span className="vs-lbl">Tách lời đọc:</span>
          <button className={`vs-chip ${mode === 'line' ? 'on' : ''}`} onClick={() => setMode('line')}>Theo dòng</button><button className={`vs-chip ${mode === 'sentence' ? 'on' : ''}`} onClick={() => setMode('sentence')}>Theo câu</button>
          <small>Mỗi {mode === 'line' ? 'dòng' : 'câu'} một lần tạo giọng.</small></div>

        <div className="vs-row"><span className="vs-lbl">Thẻ cảm xúc:</span>{TAGS.map((t) => <button key={t} className="vs-tag" onClick={() => insertTag(t)}>[{t}]</button>)}</div>
        <div className="vs-row">
          <button className="vs-ai pink" onClick={() => aiAssist('emotion', 'api')} disabled={!!aiBusy || !text.trim()}>{aiBusy === 'emotion' ? '…' : '✨ AI gợi ý cảm xúc (thẻ ElevenLabs)'}</button>
          <select value={level} onChange={(e) => setLevel(e.target.value)}><option value="light">Nhẹ</option><option value="medium">Vừa</option><option value="strong">Mạnh</option></select>
        </div>
        <div className="vs-row">
          <button className="vs-ai violet" onClick={() => aiAssist('map', 'api')} disabled={!!aiBusy || !text.trim()}>{aiBusy === 'map' ? '…' : '✨ Nhờ Claude phân tích kịch bản → bản đồ cắt voice'}</button>
          <button className="vs-ai claude" onClick={() => aiAssist('map', 'prompt')} disabled={!!aiBusy || !text.trim()} title="Chép câu lệnh để dán vào Claude Live">Claude.ai</button>
          <button className="vs-ai plain" onClick={() => aiAssist('map', 'api')} disabled={!!aiBusy || !text.trim()} title="Dùng Anthropic API key đã đăng nhập">API</button>
          <small>Không bắt buộc — tự viết cũng được: khúc voice, rồi ( 1.2s | hình trám ) là khoảng lặng giữa khúc; ( ) = lặng mặc định.</small>
        </div>
        {claudeManual && (
          <div className="vs-card"><small>Dán câu lệnh vào Claude Live (đã chép sẵn), rồi dán câu trả lời vào đây:</small>
            <div className="vs-row">{[1, 2, 3, 4, 5].map((n) => <button key={n} className="cc-auto" onClick={() => window.vaniclip.liveOpen('claude', n)}>Mở Claude #{n}</button>)}</div>
            <textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Dán kết quả của Claude…" />
            <div className="vs-row"><button className="cc-import" disabled={!pasted.trim()} onClick={() => { setText(pasted.trim().replace(/^```[a-z]*\n?|\n?```$/g, '')); setClaudeManual(null); setPasted('') }}>Dùng kết quả</button><button className="cc-auto" onClick={() => setClaudeManual(null)}>Đóng</button></div></div>
        )}

        {engine === 'gemini' && (
          <div className="vs-row vs-grid">
            <label>Giọng<select value={gVoice} onChange={(e) => pickGVoice(e.target.value)}>{(cat?.geminiVoices || []).map((v) => <option key={v.name} value={v.name}>{v.name} · {v.label}</option>)}</select></label>
            <label>Model<select value={gModel} onChange={(e) => setGModel(e.target.value)}>{(cat?.geminiModels || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
            <label>Nghỉ giữa dòng<span><input type="number" min="0" max="10" step="0.1" value={gap} onChange={(e) => setGap(e.target.value)} style={{ width: 64 }} /> s</span></label>
          </div>
        )}
        {engine !== 'gemini' && !isWeb && <div className="vs-row"><label className="vs-lbl">Nghỉ giữa dòng <input type="number" min="0" max="10" step="0.1" value={gap} onChange={(e) => setGap(e.target.value)} style={{ width: 64 }} /> s</label></div>}

        {engine === 'gemini' && (
          <div className="vs-card vs-listen"><div className="vs-row"><span className="vs-lbl">Nghe giọng:</span>
            <button className="cc-auto" onClick={() => stepVoice(-1)} disabled={busy}>‹</button>
            <button className="cc-import" onClick={previewSample} disabled={busy || !enabledKeys}><Play size={12} /> Nghe giọng này</button>
            <button className="cc-auto" onClick={() => stepVoice(1)} disabled={busy}>›</button>
            <label className="chk"><input type="checkbox" checked={autoPreview} onChange={(e) => setAutoPreview(e.target.checked)} /> Tự nghe khi chọn giọng</label></div>
            <small>{SAMPLE[lang]}</small></div>
        )}

        <div className="vs-row"><span className="vs-lbl">Cảm xúc:</span>{EMOTIONS.map(([k, label]) => <button key={k} className={`vs-chip ${emotion === k ? 'on' : ''}`} onClick={() => setEmotion(k)}>{label}</button>)}</div>
        <small>Cảm xúc áp bằng thẻ (không thể) đặt trước từng dòng. Bạn cũng có thể tự gõ thẻ như [whispers], [sighs] ngay trong lời; dòng đã có thẻ sẽ được giữ nguyên.</small>
        <div className="vs-row"><span className="vs-lbl">Phong cách tự do (tiếng Anh, tuỳ chọn)</span><input style={{ flex: 1 }} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="vd: in a slow, mysterious documentary voice" /></div>

        {busy && <div className="vs-prog"><div className="ae-bar"><i style={{ width: `${pct}%` }} /></div><small>{progress?.phase === 'mix' ? 'Đang ghép các dòng…' : progress ? `Dòng ${(progress.done || 0) + 1}/${progress.total}: ${progress.text || ''}` : 'Đang chuẩn bị…'}</small></div>}
        {err && <div className="vs-err" role="alert">{err}</div>}
        {msg && !err && <small className="vs-ok">{msg}</small>}
        {audioUrl && <audio ref={audioRef} src={audioUrl} controls style={{ width: '100%' }} />}

        {isWeb && (
          <div className="vs-actions">
            <button className="cc-import vs-main" onClick={openWebAndCopy} disabled={!lineCount}>▷ Tạo giọng đọc ({lineCount} dòng)</button>
          </div>
        )}
        {!isWeb && (
          <div className="vs-actions">
            {busy ? <button className="cc-auto" onClick={cancel}>Hủy</button>
              : <button className="cc-import vs-main" onClick={() => run({})} disabled={!lineCount}>▷ Tạo giọng đọc ({lineCount} dòng)</button>}
            <button className="cc-auto" onClick={previewFirst} disabled={busy || !lineCount}>Nghe thử dòng đầu</button>
            <button className="cc-auto" onClick={generateSelected} disabled={busy || !lineCount}>▷ Tạo riêng dòng đang chọn</button>
          </div>
        )}
      </div>
    </div>
  )
}
