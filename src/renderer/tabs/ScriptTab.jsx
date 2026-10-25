import React, { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n.jsx'
import { fmt } from '../utils.js'
import { assignMedia } from '../script-plan.js'

// Tab Kich ban: gui ca kich ban va (neu chon) giong doc da can moc thoi gian cho Claude -> chia canh -> dung vao timeline
export default function ScriptTab({ libraryAssets, capLang, hasClips, pickVoice, applyScenes, busyExternal }) {
  const { t } = useI18n()
  const [auth, setAuth] = useState({ configured: false, hint: '' })
  const [keyInput, setKeyInput] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [script, setScript] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [scenes, setScenes] = useState([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [limitNotice, setLimitNotice] = useState('')
  const [opts, setOpts] = useState({ replace: true, captions: true, muteVideo: true })

  const visuals = useMemo(() => libraryAssets.filter((a) => (a.kind === 'video' || a.kind === 'image') && !a.missing), [libraryAssets])
  const voices = useMemo(() => libraryAssets.filter((a) => a.kind === 'audio' && !a.missing), [libraryAssets])
  const voice = voices.find((a) => a.id === voiceId) || null

  // Tu dong dang nhap: key da luu ma hoa -> chi can hoi trang thai
  useEffect(() => { window.vaniclip.claudeStatus().then(setAuth).catch(() => {}) }, [])

  async function login() {
    setAuthBusy(true); setAuthError('')
    try { setAuth(await window.vaniclip.claudeLogin(keyInput)); setKeyInput('') } catch (e) { setAuthError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } finally { setAuthBusy(false) }
  }
  async function logout() { setAuth(await window.vaniclip.claudeLogout()); setScenes([]) }

  async function analyze() {
    setBusy(true); setScenes([]); setLimitNotice(''); setStatus(t('scr_analyzing'))
    try {
      let transcript = null, totalDuration = null
      if (voice) {
        const media = voice.metadata?.duration ? voice.metadata : await window.vaniclip.inspectMedia(voice.path)
        totalDuration = media.duration
        setStatus(t('scr_transcribing'))
        transcript = await window.vaniclip.generateCaptions(voice.path, { language: capLang })
        setStatus(t('scr_analyzing'))
      }
      const media = visuals.map((a, index) => ({ index, name: a.name, kind: a.kind, duration: a.metadata?.duration || 0 }))
      const result = await window.vaniclip.analyzeScript({ script, transcript, totalDuration, media })
      setScenes(assignMedia(result, visuals))
      setStatus(t('scr_done', { n: result.length, s: result[result.length - 1].end.toFixed(1) }))
    } catch (e) {
      const message = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      setStatus(t('st_err', { e: message }))
      if (/hết hạn mức|giới hạn tốc độ|hết credit|rate.?limit|usage limit|quota|429/i.test(message)) {
        setLimitNotice('API key đang dùng đã chạm giới hạn. VaniClip không tự đổi sang tài khoản khác để né giới hạn; bạn có thể mở phiên Claude Live riêng bên dưới, kiểm tra tài khoản đó còn quyền sử dụng, rồi tiếp tục thủ công. Phiên Live không tự thay thế API key cho chức năng phân tích hiện tại.')
      }
    } finally { setBusy(false) }
  }

  function setSceneAsset(i, assetId) { setScenes((list) => list.map((s, idx) => idx === i ? { ...s, assetId } : s)) }
  function setSceneText(i, text) { setScenes((list) => list.map((s, idx) => idx === i ? { ...s, text } : s)) }

  async function build() {
    setBusy(true); setStatus(t('scr_building'))
    try { const r = await applyScenes(scenes, { voice, ...opts }); setStatus(r?.message || t('scr_built')) } catch (e) { setStatus(t('st_err', { e: e.message || e })) } finally { setBusy(false) }
  }

  const disabled = busy || busyExternal
  return (
    <div className="cc-cap cc-script">
      <div className="scr-auth">
        {auth.configured ? (
          <div className="scr-row"><span>{t('scr_logged_in', { k: auth.hint })}</span><button className="cc-auto" onClick={logout}>{t('scr_logout')}</button></div>
        ) : (
          <>
            <small className="cap-hint">{t('scr_login_hint')}</small>
            <input type="password" placeholder="sk-ant-…" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && keyInput && login()} />
            <div className="scr-row">
              <button className="cc-import" onClick={login} disabled={!keyInput.trim() || authBusy}>{authBusy ? '...' : t('scr_login')}</button>
              <button className="cc-auto" onClick={() => window.vaniclip.claudeOpenKeyPage()}>{t('scr_get_key')}</button>
              {authError && <small className="cap-warn">{authError}</small>}
            </div>
          </>
        )}
      </div>
      <div className="scr-auth" style={{ marginTop: 8 }}>
        <small className="cap-hint">Tài khoản Claude Live phụ — mỗi nút mở một cửa sổ có phiên đăng nhập riêng:</small>
        <div className="scr-row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
          {[1, 2, 3, 4, 5].map((account) => <button key={account} className="cc-auto" onClick={async () => { try { await window.vaniclip.claudeOpenLivePage(account); setAuthError(`Đã mở Claude Live #${account}. Đăng nhập tài khoản tương ứng trong cửa sổ riêng.`) } catch (e) { setAuthError(String(e.message || e)) } }}>Mở acc #{account}</button>)}
        </div>
        <small className="cap-hint">Chuyển tài khoản thủ công khi cần. Phân tích kịch bản trong VaniClip vẫn dùng Anthropic API key; phiên Claude Live không thay thế API key và không tự động né giới hạn sử dụng.</small>
        {authError && <small className="cap-warn">{authError}</small>}
      </div>

      <label className="scr-label">{t('scr_script')}</label>
      <textarea className="scr-text" rows={9} value={script} onChange={(e) => setScript(e.target.value)} placeholder={t('scr_script_ph')} />

      <label className="scr-label">{t('scr_voice')}</label>
      <div className="scr-row">
        <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} style={{ flex: 1 }}>
          <option value="">{t('scr_voice_none')}</option>
          {voices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="cc-auto" onClick={async () => { const a = await pickVoice(); if (a) setVoiceId(a.id) }}>{t('scr_voice_pick')}</button>
      </div>
      <small className="cap-hint">{voice ? t('scr_voice_hint') : t('scr_estimate_hint')}</small>
      <small className="cap-hint">{t('scr_media_count', { n: visuals.length })}</small>

      <button className="cc-import" onClick={analyze} disabled={disabled || !auth.configured || !script.trim() || !visuals.length}>{busy && !scenes.length ? status || '...' : t('scr_analyze')}</button>
      {limitNotice && <div className="scr-auth" role="alert" style={{ marginTop: 8 }}>
        <small className="cap-warn">{limitNotice}</small>
        <div className="scr-row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
          {[1, 2, 3, 4, 5].map((account) => <button key={account} className="cc-auto" onClick={async () => { try { await window.vaniclip.claudeOpenLivePage(account); setAuthError(`Đã mở Claude Live #${account}. Xác nhận trạng thái tài khoản trong cửa sổ đó trước khi tiếp tục.`) } catch (e) { setAuthError(String(e.message || e)) } }}>Mở tài khoản #{account}</button>)}
        </div>
      </div>}
      {!auth.configured && <small className="cap-warn">{t('scr_need_login')}</small>}
      {!visuals.length && <small className="cap-warn">{t('scr_need_media')}</small>}

      {scenes.length > 0 && (
        <>
          <label className="chk"><input type="checkbox" checked={opts.replace} onChange={(e) => setOpts({ ...opts, replace: e.target.checked })} /> {t('scr_opt_replace')}</label>
          <label className="chk"><input type="checkbox" checked={opts.captions} onChange={(e) => setOpts({ ...opts, captions: e.target.checked })} /> {t('scr_opt_captions')}</label>
          <label className="chk"><input type="checkbox" checked={opts.muteVideo} onChange={(e) => setOpts({ ...opts, muteVideo: e.target.checked })} /> {t('scr_opt_mute')}</label>
          <button className="cc-import" onClick={build} disabled={disabled}>{t('scr_build')}</button>
          <div className="cap-list">
            {scenes.map((s, i) => (
              <div key={s.id} className="cap-row scr-scene">
                <span className="cap-t">{fmt(s.start).slice(0, 5)} → {fmt(s.end).slice(0, 5)} · {s.duration.toFixed(1)}s</span>
                <textarea rows={2} value={s.text} onChange={(e) => setSceneText(i, e.target.value)} />
                <select value={s.assetId || ''} onChange={(e) => setSceneAsset(i, e.target.value)}>
                  {visuals.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {s.visual && <small className="cap-hint">{s.visual}</small>}
              </div>
            ))}
          </div>
        </>
      )}
      {status && (scenes.length > 0 || !busy) && <small className="cap-hint">{status}</small>}
    </div>
  )
}
