import React from 'react'
import { useI18n } from '../i18n.jsx'
import { FILTERS } from '../utils.js'

// Tab Bo loc mau: preview bang CSS filter, xuat bang FFmpeg
export default function FilterTab({ filterKey, setFilterKey, intensity = 100, setIntensity = () => {}, beginEdit, endEdit, renderExactPreview, exactPreview, previewBusy }) {
  const { t } = useI18n()
  return (
    <div className="cc-cap">
      <label className="grp-lbl">{t('filter_title')}</label>
      <div className="filter-grid">
        {FILTERS.map((f) => (
          <button key={f.k} className={`filter-item ${filterKey === f.k ? 'on' : ''}`} onClick={() => setFilterKey(f.k)}>
            <div className="fi-prev" style={{ filter: f.css === 'none' ? undefined : f.css }} />
            <span>{t('f_' + f.k)}</span>
          </button>
        ))}
      </div>
      <div className="grp">
        <label className="num-field"><span>{t('filter_intensity')}</span><b>{intensity}%</b>
          <input type="range" min="0" max="100" step="1" value={intensity} onPointerDown={beginEdit} onFocus={beginEdit} onBlur={endEdit} onChange={(event) => setIntensity(Number(event.target.value))} />
        </label>
        <small className="cap-hint">{t('filter_preview_explain')}</small>
        <button className="cc-auto" onClick={renderExactPreview} disabled={previewBusy}>{previewBusy ? t('filter_rendering') : t('filter_render')}</button>
        {exactPreview && <img className="filter-exact-preview" src={exactPreview} alt={t('filter_preview_alt')} />}
      </div>
    </div>
  )
}
