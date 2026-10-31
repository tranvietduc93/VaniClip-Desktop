const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Cau noi an toan giua UI (React) va Node/FFmpeg (main process).
// UI chi goi duoc dung nhung ham duoc khai bao o day.
contextBridge.exposeInMainWorld('vaniclip', {
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  openElevenLabsAccount: (accountId) => ipcRenderer.invoke('elevenlabs:openAccount', accountId),
  onUpdateProgress: (cb) => { const handler = (_e, pct) => cb(pct); ipcRenderer.on('updater:progress', handler); return () => ipcRenderer.removeListener('updater:progress', handler) },
  onUpdateError: (cb) => { const handler = (_e, message) => cb(message); ipcRenderer.on('updater:error', handler); return () => ipcRenderer.removeListener('updater:error', handler) },
  platform: process.platform,
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  getEncoder: () => ipcRenderer.invoke('system:encoder'),
  openVideos: () => ipcRenderer.invoke('dialog:openVideos'),
  openImportMedia: () => ipcRenderer.invoke('dialog:openImportMedia'),
  openImages: () => ipcRenderer.invoke('dialog:openImages'),
  saveProject: (data, currentPath) => ipcRenderer.invoke('project:save', data, currentPath),
  writeProject: (filePath, data) => ipcRenderer.invoke('project:write', filePath, data),
  closeSaveProject: (data, currentPath) => ipcRenderer.invoke('app:close-save', data, currentPath),
  onCloseSaveRequest: (cb) => { const handler = () => cb(); ipcRenderer.on('app:close-save-request', handler); return () => ipcRenderer.removeListener('app:close-save-request', handler) },
  openProject: () => ipcRenderer.invoke('project:open'),
  collectProject: (data, currentPath) => ipcRenderer.invoke('project:collect', data, currentPath),
  writeRecovery: (project) => ipcRenderer.invoke('recovery:write', project),
  latestRecovery: () => ipcRenderer.invoke('recovery:latest'),
  dismissRecovery: (projectId, revision) => ipcRenderer.invoke('recovery:dismiss', projectId, revision),
  relinkMedia: (kind) => ipcRenderer.invoke('dialog:relinkMedia', kind),
  // Lay duong dan that cua file keo-tha (Electron 32+ da go File.path)
  getDroppedPath: (file) => webUtils.getPathForFile(file),
  probe: (filePath) => ipcRenderer.invoke('video:probe', filePath),
  logoPick: () => ipcRenderer.invoke('logos:pick'),
  logoList: () => ipcRenderer.invoke('logos:list'),
  logoSave: (payload) => ipcRenderer.invoke('logos:save', payload),
  logoRemove: (id) => ipcRenderer.invoke('logos:remove', id),
  logoUsePreset: (id) => ipcRenderer.invoke('logos:usePreset', id),
  inspectMedia: (filePath) => ipcRenderer.invoke('media:inspect', filePath),
  createPreviewProxy: (filePath) => ipcRenderer.invoke('video:createPreviewProxy', filePath),
  smoothProxy: (filePath) => ipcRenderer.invoke('video:smoothProxy', filePath),
  renderFilterPreview: (request) => ipcRenderer.invoke('video:filterPreview', request),
  thumbnails: (filePath, count) => ipcRenderer.invoke('video:thumbnails', filePath, count),
  prioritizeMediaCache: (filePath) => ipcRenderer.invoke('video:prioritizeCache', filePath),
  waveform: (filePath) => ipcRenderer.invoke('video:waveform', filePath),
  detectSilence: (filePath, opts) => ipcRenderer.invoke('video:detectSilence', filePath, opts),
  generateCaptions: (filePath, opts) => ipcRenderer.invoke('captions:generate', filePath, opts),
  saveSrt: (captions) => ipcRenderer.invoke('captions:saveSrt', captions),
  openSrt: () => ipcRenderer.invoke('captions:openSrt'),
  onCaptionProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('captions:progress', handler)
    return () => ipcRenderer.removeListener('captions:progress', handler)
  },
  openAudio: () => ipcRenderer.invoke('dialog:openAudio'),
  openAudioFiles: () => ipcRenderer.invoke('dialog:openAudioFiles'),
  generateTTS: (text, opts) => ipcRenderer.invoke('tts:generate', text, opts),
  getLocalTtsModelStatus: () => ipcRenderer.invoke('tts:modelStatus'),
  getVoices: (langCode) => ipcRenderer.invoke('tts:voices', langCode),
  setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
  hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
  getApiKeyStatus: () => ipcRenderer.invoke('settings:apiKeyStatus'),
  claudeStatus: () => ipcRenderer.invoke('claude:status'),
  claudeLogin: (key) => ipcRenderer.invoke('claude:login', key),
  claudeLogout: () => ipcRenderer.invoke('claude:logout'),
  claudeOpenKeyPage: () => ipcRenderer.invoke('claude:openKeyPage'),
  claudeOpenLivePage: (account = 1) => ipcRenderer.invoke('claude:openLivePage', account),
  analyzeScript: (request) => ipcRenderer.invoke('claude:analyzeScript', request),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authLogin: (provider, key, opts) => ipcRenderer.invoke('auth:login', provider, key, opts),
  authLogout: (provider) => ipcRenderer.invoke('auth:logout', provider),
  authVerify: (provider) => ipcRenderer.invoke('auth:verify', provider),
  authOpenKeyPage: (provider) => ipcRenderer.invoke('auth:openKeyPage', provider),
  onAuthChanged: (cb) => { const handler = (_e, snap) => cb(snap); ipcRenderer.on('auth:changed', handler); return () => ipcRenderer.removeListener('auth:changed', handler) },
  liveOpen: (kind, account) => ipcRenderer.invoke('live:open', kind, account),
  liveStatus: () => ipcRenderer.invoke('live:status'),
  liveSignOut: (kind, account) => ipcRenderer.invoke('live:signOut', kind, account),
  onLiveChanged: (cb) => { const handler = (_e, snap) => cb(snap); ipcRenderer.on('live:changed', handler); return () => ipcRenderer.removeListener('live:changed', handler) },
  autoEditCopy: (kind, value) => ipcRenderer.invoke('autoedit:copy', kind, value),
  autoEditReadClipboard: () => ipcRenderer.invoke('autoedit:readClipboard'),
  autoEditManualReply: (jobId, text) => ipcRenderer.invoke('autoedit:manualReply', jobId, text),
  onAutoEditManual: (cb) => { const handler = (_e, p) => cb(p); ipcRenderer.on('autoedit:manual', handler); return () => ipcRenderer.removeListener('autoedit:manual', handler) },
  voiceCatalog: () => ipcRenderer.invoke('voice:catalog'),
  voiceKeys: () => ipcRenderer.invoke('voice:keys'),
  voiceAddGemini: (text) => ipcRenderer.invoke('voice:addGemini', text),
  voiceRemoveGemini: (id) => ipcRenderer.invoke('voice:removeGemini', id),
  voiceClearGemini: () => ipcRenderer.invoke('voice:clearGemini'),
  voiceToggleGemini: (id, enabled) => ipcRenderer.invoke('voice:toggleGemini', id, enabled),
  voiceTestGemini: (id) => ipcRenderer.invoke('voice:testGemini', id),
  voiceSetEleven: (key) => ipcRenderer.invoke('voice:setEleven', key),
  voiceElevenVoices: () => ipcRenderer.invoke('voice:elevenVoices'),
  voiceGenerate: (job, jobId) => ipcRenderer.invoke('voice:generate', job, jobId),
  voiceCancel: (jobId) => ipcRenderer.invoke('voice:cancel', jobId),
  voiceOpenTextFile: () => ipcRenderer.invoke('voice:openTextFile'),
  voiceAiAssist: (kind, payload, mode) => ipcRenderer.invoke('voice:aiAssist', kind, payload, mode),
  voiceOpenGeminiWeb: (account) => ipcRenderer.invoke('voice:openGeminiWeb', account),
  onVoiceProgress: (cb) => { const handler = (_e, p) => cb(p); ipcRenderer.on('voice:progress', handler); return () => ipcRenderer.removeListener('voice:progress', handler) },
  autoEditAnalyze: (request) => ipcRenderer.invoke('autoedit:analyze', request),
  autoEditCancel: (jobId) => ipcRenderer.invoke('autoedit:cancel', jobId),
  onAutoEditProgress: (cb) => { const handler = (_e, p) => cb(p); ipcRenderer.on('autoedit:progress', handler); return () => ipcRenderer.removeListener('autoedit:progress', handler) },
  onTtsProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('tts:progress', handler)
    return () => ipcRenderer.removeListener('tts:progress', handler)
  },
  downloadVideo: (options) => ipcRenderer.invoke('dl:video', options),
  cancelDownload: () => ipcRenderer.invoke('dl:cancel'),
  chooseDownloadDirectory: () => ipcRenderer.invoke('dl:chooseDirectory'),
  onDlProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('dl:progress', handler)
    return () => ipcRenderer.removeListener('dl:progress', handler)
  },
  replaceBg: (opts) => ipcRenderer.invoke('ai:replaceBg', opts),
  previewBg: (opts) => ipcRenderer.invoke('ai:previewBg', opts),
  cancelAi: () => ipcRenderer.invoke('ai:cancel'),
  getAiModelStatus: () => ipcRenderer.invoke('ai:modelStatus'),
  ensureAiModel: () => ipcRenderer.invoke('ai:ensureModel'),
  faceSwap: (opts) => ipcRenderer.invoke('ai:faceSwap', opts),
  openFaceImage: () => ipcRenderer.invoke('dialog:openFaceImage'),
  onFaceProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('face:progress', handler)
    return () => ipcRenderer.removeListener('face:progress', handler)
  },
  onAiProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('ai:progress', handler)
    return () => ipcRenderer.removeListener('ai:progress', handler)
  },
  redub: (payload) => ipcRenderer.invoke('redub:generate', payload),
  onRedubProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('redub:progress', handler)
    return () => ipcRenderer.removeListener('redub:progress', handler)
  },
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  freezeFrame: (filePath, time) => ipcRenderer.invoke('video:freezeFrame', filePath, time),
  saveAudioAs: (request) => ipcRenderer.invoke('audio:saveAs', request),
  saveVideo: (defaultName) => ipcRenderer.invoke('dialog:saveVideo', defaultName),
  exportVideo: (opts) => ipcRenderer.invoke('video:export', opts),
  cancelExport: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  onExportProgress: (cb) => {
    const handler = (_e, pct) => cb(pct)
    ipcRenderer.on('video:export:progress', handler)
    return () => ipcRenderer.removeListener('video:export:progress', handler)
  },
  onExportStage: (cb) => {
    const handler = (_e, name) => cb(name)
    ipcRenderer.on('video:export:stage', handler)
    return () => ipcRenderer.removeListener('video:export:stage', handler)
  }
})
