import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n.jsx'
import { fileUrl } from '../utils.js'
import { planDuration, removeSegment, moveSegment, parseManualReply } from '../auto-edit-plan.js'

const clean = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
// Tab AI Tu dung: cau lenh tieng Viet -> AI nhin anh/doc loi thoai -> ban xem truoc chinh sua duoc -> ap dung vao timeline
export default function AutoEditTab({ libraryAssets, pickMusic, onImport, applyPlan, busyExternal, onOpenExport }) {
  const { t } = useI18n()
  const [auth, setAuth] = useState(null)
  const [instruction, setInstruction] = useState('')
  const [ratio, setRatio] = useState('auto')
  const [durMode, setDurMode] = useState('auto')
  const [target, setTarget] = useState(60)
  const [opts, setOpts] = useState({ captions: true, removeSilence: true, music: false, replace: true })
  const [captionLanguage, setCaptionLanguage] = useState('vietnamese')
  const [music, setMusic] = useState(null)
  const [brains, setBrains] = useState(() => { try { return JSON.parse(localStorage.getItem('vaniclip.autoedit.brains') || '[]') } catch { return [] } })
  const [brainMode, setBrainMode] = useState(() => localStorage.getItem('vaniclip.autoedit.brainMode') || 'fallback')
  const [live, setLive] = useState(null)
  const [manual, setManual] = useState(null)
  const [manualText, setManualText] = useState('')
  const touchedRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState(null)
  const jobRef = useRef('')

  const visuals = useMemo(() => libraryAssets.filter((a) => (a.kind === 'video' || a.kind === 'image') && !a.missing), [libraryAssets])

  useEffect(() => {
    window.vaniclip.authStatus().then(setAuth).catch(() => {})
    const offAuth = window.vaniclip.onAuthChanged(setAuth)
    const offProgress = window.vaniclip.onAutoEditProgress((p) => { if (p.jobId === jobRef.current) setProgress(p) })
    window.vaniclip.liveStatus().then(setLive).catch(() => {})
    const offLive = window.vaniclip.onLiveChanged(setLive)
    const offManual = window.vaniclip.onAutoEditManual((m) => { if (m.jobId === jobRef.current) { setManual(m); setManualText('') } })
    return () => { offAuth?.(); offProgress?.(); offLive?.(); offManual?.() }
  }, [])

  // Cac "bo nao" dung duoc: API da dang nhap + tai khoan Live phu da dang nhap (quan ly o tab Kich ban)
  const brainOptions = useMemo(() => {
    const list = []
    if (auth?.claude?.configured) list.push({ id: 'claude-api', label: 'Claude API', note: auth.claude.state !== 'signed_in' ? ` (${t('auth_state_' + auth.claude.state)})` : '' })
    if (auth?.openai?.configured) list.push({ id: 'openai-api', label: 'OpenAI API', note: auth.openai.state !== 'signed_in' ? ` (${t('auth_state_' + auth.openai.state)})` : '' })
    for (const [kind, label] of [['claude', 'Claude Live'], ['chatgpt', 'ChatGPT Live']]) {
      for (let n = 1; n <= 5; n++) if (live?.[kind]?.[n]?.signedIn) list.push({ id: `${kind}-live:${n}`, label: `${label} #${n}`, note: ' — dán tay' })
    }
    return list
  }, [auth, live, t])
  useEffect(() => {
    if (!auth || !live) return
    const ok = new Set(brainOptions.map((o) => o.id))
    setBrains((cur) => {
      const kept = cur.filter((id) => ok.has(id))
      if (!kept.length && !touchedRef.current && brainOptions.length) return [brainOptions[0].id] // lan dau: chon san bo nao dau tien
      return kept.length === cur.length ? cur : kept
    })
  }, [brainOptions, auth, live])
  useEffect(() => { try { localStorage.setItem('vaniclip.autoedit.brains', JSON.stringify(brains)); localStorage.setItem('vaniclip.autoedit.brainMode', brainMode) } catch {} }, [brains, brainMode])
  const toggleBrain = (id) => { touchedRef.current = true; setBrains((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])) }

  async function run() {
    setBusy(true); setError(''); setPlan(null); setStatus(t('ae_running')); setProgress(null)
    const jobId = `ae-${Date.now()}`; jobRef.current = jobId
    try {
      const result = await window.vaniclip.autoEditAnalyze({
        jobId, instruction, ratio: ratio === 'auto' ? undefined : ratio, targetSeconds: durMode === 'target' ? Number(target) || 0 : 0, brains, brainMode,
        assets: visuals.map((a) => ({ id: a.id, name: a.name, path: a.path, kind: a.kind })),
        music: opts.music && music ? { id: music.id, path: music.path } : null,
        options: { captions: opts.captions, removeSilence: opts.removeSilence, language: captionLanguage === 'translate-en' ? 'vietnamese' : captionLanguage, captionTask: captionLanguage === 'translate-en' ? 'translate' : 'transcribe' }
      })
      setPlan({ ...result, musicAssetId: opts.music && music ? music.id : null })
      setStatus('')
    } catch (e) { setError(e?.cancelled || /Đã hủy/.test(String(e?.message)) ? '' : clean(e)); setStatus('') } finally { setBusy(false); setProgress(null); setManual(null) }
  }
  const cancel = () => window.vaniclip.autoEditCancel(jobRef.current)
  const submitManual = async (value) => { const text = typeof value === 'string' ? value : manualText; setManual(null); await window.vaniclip.autoEditManualReply(jobRef.current, text) }
  // Khung dan tay dang mo: moi ~0.8s xem clipboard; khi nguoi dung bam Copy o cau tra loi cua AI va do la JSON hop le -> tu dung ket qua
  useEffect(() => {
    if (!manual) return undefined
    let stopped = false
    const timer = setInterval(async () => {
      try {
        const text = await window.vaniclip.autoEditReadClipboard()
        if (stopped) return
        const ok = parseManualReply(text, manual.prompt)
        if (ok) { stopped = true; clearInterval(timer); setManual(null); await window.vaniclip.autoEditManualReply(jobRef.current, ok) }
      } catch {}
    }, 800)
    return () => { stopped = true; clearInterval(timer) }
  }, [manual])

  async function apply(thenExport) {
    if (!plan?.segments.length) { setError(t('ae_empty_plan')); return }
    setBusy(true); setError('')
    try {
      const r = await applyPlan(plan, { captions: opts.captions, captionLanguage, replace: opts.replace, musicAsset: plan.musicAssetId ? libraryAssets.find((a) => a.id === plan.musicAssetId) : null })
      setStatus(r?.message || '')
      if (thenExport) onOpenExport?.()
    } catch (e) { setError(clean(e)) } finally { setBusy(false) }
  }

  const phase = progress?.phase && progress.phase !== 'done' ? progress.phase : null
  const pct = progress?.total ? Math.min(100, Math.round(((progress.done || 0) / progress.total) * 100)) : 0
  const disabled = busy || busyExternal
  const chips = [['ae_chip_review', 'Dựng video review 30 giây, giữ cảnh nói chính, bỏ đoạn thừa, mở đầu bằng cảnh ấn tượng nhất.'],
    ['ae_chip_highlight', 'Cắt các khoảnh khắc nổi bật nhất, nhịp nhanh, bỏ cảnh mờ hoặc lặp.'],
    ['ae_chip_vlog', 'Dựng vlog tự nhiên, giữ lời nói chính, thêm nhạc nền nhẹ.'],
    ['ae_chip_talk', 'Bỏ khoảng lặng và đoạn nói thừa, giữ nguyên ý chính của lời nói.']]
  return (
    <div className="cc-cap cc-ae">
      <div className="ae-sec">
        <label className="ae-label">{t('ae_prompt')}</label>
        <textarea rows={5} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('ae_prompt_ph')} />
        <div className="ae-row ae-chips">{chips.map(([k, text]) => <button key={k} className="cc-auto" onClick={() => setInstruction(text)}>{t(k)}</button>)}</div>
      </div>

      <div className="ae-sec">
        {visuals.length ? <small className="cap-hint">{t('ae_source', { n: visuals.length })}</small>
          : <><small className="cap-warn">{t('ae_source_none')}</small><button className="cc-import" onClick={onImport}>{t('ae_import')}</button></>}
        <label className="ae-label">{t('ae_ratio')}</label>
        <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
          <option value="auto">{t('ae_ratio_auto')}</option><option value="16:9">{t('ae_r169')}</option><option value="9:16">{t('ae_r916')}</option><option value="1:1">{t('ae_r11')}</option>
        </select>
        <label className="ae-label">{t('ae_duration')}</label>
        <div className="ae-row">
          <select value={durMode} onChange={(e) => setDurMode(e.target.value)} style={{ flex: 1 }}>
            <option value="auto">{t('ae_dur_auto')}</option><option value="target">{t('ae_dur_target')}</option>
          </select>
          {durMode === 'target' && <><input type="number" min={3} max={36000} value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 80 }} /><small>{t('ae_dur_sec')}</small></>}
        </div>
        <small className="cap-hint">{t('ae_dur_hint')}</small>
      </div>

      <div className="ae-sec">
        <label className="chk"><input type="checkbox" checked={opts.removeSilence} onChange={(e) => setOpts({ ...opts, removeSilence: e.target.checked })} /> {t('ae_opt_silence')}</label>
        <label className="chk"><input type="checkbox" checked={opts.captions} onChange={(e) => setOpts({ ...opts, captions: e.target.checked })} /> {t('ae_opt_captions')}</label>
        {opts.captions && <label className="ae-label">Ngôn ngữ phụ đề
          <select value={captionLanguage} onChange={(e) => setCaptionLanguage(e.target.value)}>
            <option value="vietnamese">Tiếng Việt</option>
            <option value="english">English (giọng nói là tiếng Anh)</option>
            <option value="translate-en">Dịch sang English (từ giọng tiếng Việt)</option>
          </select>
        </label>}
        <label className="chk"><input type="checkbox" checked={opts.music} onChange={(e) => setOpts({ ...opts, music: e.target.checked })} /> {t('ae_opt_music')}</label>
        {opts.music && (
          <div className="ae-row">
            <button className="cc-auto" onClick={async () => { const a = await pickMusic(); if (a) setMusic(a) }}>{t('ae_music_pick')}</button>
            <small className="cap-hint">{music ? music.name : t('ae_music_none')}</small>
            <small className="cap-hint" style={{ flexBasis: '100%' }}>{t('ae_music_hint')}</small>
          </div>
        )}
        <label className="ae-label">{t('ae_engine')} — chọn được nhiều</label>
        {brainOptions.length ? brainOptions.map((o) => (
          <label className="chk" key={o.id}><input type="checkbox" checked={brains.includes(o.id)} onChange={() => toggleBrain(o.id)} /> {o.label}{o.note}</label>
        )) : <small className="cap-hint">Chưa có bộ não nào. Đăng nhập Claude API hoặc các tài khoản Claude/ChatGPT Live phụ ở tab Kịch bản.</small>}
        {!brains.length && <small className="cap-hint">{t('ae_engine_local')}</small>}
        {brains.length > 1 && (
          <>
            <select value={brainMode} onChange={(e) => setBrainMode(e.target.value)}>
              <option value="fallback">Dự phòng: thử lần lượt theo thứ tự đã tick</option>
              <option value="ensemble">Hội ý: các bộ não cùng chấm, lấy phần đa số</option>
            </select>
            <small className="cap-hint">{brainMode === 'ensemble' ? 'Mỗi lượt phân tích gọi tất cả bộ não đã chọn (Live phải dán tay từng bộ não). Chạy cả hai Claude API và Claude Live sẽ tính vào hạn mức mỗi tài khoản.' : 'Lỗi thì chuyển bộ não kế. Khi một nhà cung cấp báo hết hạn mức, VaniClip không chuyển sang tài khoản khác cùng nhà đó để né giới hạn.'}</small>
          </>
        )}
      </div>

      {manual && (
        <div className="ae-sec">
          <b>{manual.label} — lượt {manual.index + 1}/{manual.total}: dán vào cửa sổ web</b>
          <small className="cap-hint">Cửa sổ {manual.label} đã mở và ảnh ghép đã nằm trong clipboard. Làm theo: (1) Ctrl+V vào khung chat, (2) bấm “Chép câu lệnh” rồi Ctrl+V, Enter để gửi, (3) khi AI trả lời xong, bấm nút Copy dưới câu trả lời — app tự nhận kết quả. App không tự dán hay bấm gửi thay bạn.</small>
          {manual.sheetPath && <img src={fileUrl(manual.sheetPath)} alt="" style={{ width: '100%', borderRadius: 6 }} />}
          <div className="ae-row">
            <button className="cc-auto" onClick={() => window.vaniclip.liveOpen(manual.kind, manual.slot)}>Mở lại {manual.label}</button>
            {manual.sheetPath && <button className="cc-auto" onClick={() => window.vaniclip.autoEditCopy('image', manual.sheetPath)}>Chép lại ảnh ghép</button>}
            <button className="cc-import" onClick={() => window.vaniclip.autoEditCopy('text', manual.prompt)}>Chép câu lệnh</button>
          </div>
          <small className="cap-hint">Đang chờ kết quả từ clipboard… (hoặc dán tay vào ô dưới)</small>
          <textarea rows={3} value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="Dán câu trả lời JSON của AI vào đây nếu không muốn dùng Copy…" />
          <div className="ae-row">
            <button className="cc-import" disabled={!manualText.trim()} onClick={() => submitManual()}>Dùng kết quả này</button>
            <button className="cc-auto" onClick={cancel}>{t('ae_cancel')}</button>
          </div>
        </div>
      )}
      {busy && !plan && !manual ? (
        <>
          <div className="ae-bar"><i style={{ width: `${pct}%` }} /></div>
          <small className="cap-hint">{phase ? t('ae_ph_' + phase) : t('ae_running')}{progress?.brain ? ` · ${progress.brain}` : ''}{progress?.label ? ` — ${progress.label}` : ''}{progress?.status?.progress != null ? ` ${progress.status.progress}%` : ''}</small>
          <button className="cc-auto" onClick={cancel}>{t('ae_cancel')}</button>
        </>
      ) : (
        !manual && <button className="cc-import ae-run" onClick={run} disabled={disabled || !visuals.length}>{t('ae_run')}</button>
      )}
      {error && <small className="cap-warn" role="alert">{error}</small>}
      {!visuals.length && <small className="cap-warn">{t('ae_need_media')}</small>}

      {plan && (
        <div className="ae-sec" style={{ borderBottom: 0 }}>
          <label className="ae-label">{t('ae_preview')}</label>
          <b>{plan.title}</b>
          {plan.summary && <small className="cap-hint">{plan.summary}</small>}
          <small className="cap-hint">{t('ae_summary', { n: plan.segments.length, s: planDuration(plan.segments).toFixed(1), e: `${plan.ratio} · ${plan.engine}` })}</small>
          <small className="cap-hint">{t('ae_stats', { c: plan.stats.candidates, a: plan.stats.assets, b: plan.stats.batches })}</small>
          {plan.warnings?.length > 0 && <small className="cap-warn">{t('ae_warnings')}: {plan.warnings.join(' · ')}</small>}
          <div className="ae-scenes">
            {plan.segments.map((s, i) => (
              <div key={s.id} className="ae-scene">
                {s.thumb ? <img src={fileUrl(s.thumb)} alt="" /> : <span />}
                <div>
                  <b>{i + 1}. {s.assetName}</b>
                  <small>{s.kind === 'image' ? `${(s.out - s.in).toFixed(1)}s` : `${s.in.toFixed(1)}–${s.out.toFixed(1)}s (${(s.out - s.in).toFixed(1)}s)`} · ★{Number(s.score).toFixed(0)}</small>
                  {s.text && <div className="ae-txt">{s.text}</div>}
                  {s.reason && <small>{s.reason}</small>}
                </div>
                <div className="ae-btns">
                  <button className="cc-auto" title={t('ae_up')} disabled={i === 0} onClick={() => setPlan((p) => moveSegment(p, s.id, -1))}>↑</button>
                  <button className="cc-auto" title={t('ae_down')} disabled={i === plan.segments.length - 1} onClick={() => setPlan((p) => moveSegment(p, s.id, 1))}>↓</button>
                  <button className="cc-auto" title={t('ae_remove')} onClick={() => setPlan((p) => removeSegment(p, s.id))}>✕</button>
                </div>
              </div>
            ))}
          </div>
          <label className="chk"><input type="checkbox" checked={opts.replace} onChange={(e) => setOpts({ ...opts, replace: e.target.checked })} /> {t('ae_replace')}</label>
          <div className="ae-row">
            <button className="cc-import" onClick={() => apply(false)} disabled={disabled || !plan.segments.length}>Nạp vào timeline</button>
            <button className="cc-auto" onClick={() => apply(true)} disabled={disabled || !plan.segments.length}>{t('ae_apply_export')}</button>
          </div>
        </div>
      )}
      {status && !busy && <small className="cap-hint">{status}</small>}
    </div>
  )
}
