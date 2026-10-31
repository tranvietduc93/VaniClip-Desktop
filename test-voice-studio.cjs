// Kiem thu Voice Studio: phan tich kich ban, the cam xuc, WAV, chon khoa Gemini (fetch gia lap), ghep file bang ffmpeg that.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path')
const vs = require('./electron/voice-studio.cjs')
vs.configure(process.env.FFMPEG_PATH || 'ffmpeg')
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('  PASS ' + name) }

;(async () => {
  await t('parseScript: theo dòng, khoảng lặng ( 1.2s | mô tả ), ( ), [short pause]', () => {
    const items = vs.parseScript('Xin chào các bạn\n( 1.2s | hình trám )\n[excited] Đây là khúc hai [long pause] và khúc ba\n( )\n\nKhúc cuối', { defaultPause: 0.7 })
    assert.deepEqual(items.map((i) => i.type === 'line' ? i.text : `P${i.seconds}`), ['Xin chào các bạn', 'P1.2', '[excited] Đây là khúc hai', 'P1', 'và khúc ba', 'P0.7', 'Khúc cuối'])
    assert.deepEqual(items.filter((i) => i.type === 'line').map((i) => i.index), [0, 1, 2, 3])
    assert.equal(vs.parseScript('(abc) vẫn là lời').length, 1)                        // ngoặc thường không phải khoảng lặng
  })
  await t('parseScript: theo câu giữ thẻ đầu dòng', () => {
    const l = vs.parseScript('[whispers] Câu một. Câu hai! Câu ba?', { mode: 'sentence' }).filter((i) => i.type === 'line').map((i) => i.text)
    assert.deepEqual(l, ['[whispers] Câu một.', '[whispers] Câu hai!', '[whispers] Câu ba?'])
  })
  await t('thẻ cảm xúc -> lời nhắc Gemini / ElevenLabs', () => {
    assert.equal(vs.geminiPrompt('[whispers] Hello there', { emotion: 'natural' }), 'Say in a whisper: Hello there')
    assert.equal(vs.geminiPrompt('Hi', { emotion: 'sad', style: 'vd: in a slow voice' }), 'Say in a sad, subdued voice, in a slow voice: Hi')
    assert.equal(vs.geminiPrompt('Plain'), 'Plain'); assert.equal(vs.geminiPrompt('[sighs]'), '')
    assert.equal(vs.elevenText('[laughs] Hi [short pause] ok', 'eleven_v3'), '[laughs] Hi ok')
    assert.equal(vs.elevenText('[laughs] Hi', 'eleven_multilingual_v2'), 'Hi')
  })
  await t('srtToLines bỏ số thứ tự và mốc thời gian', () => {
    assert.equal(vs.srtToLines('1\n00:00:01,000 --> 00:00:02,000\nXin chào\n\n2\n00:00:03,000 --> 00:00:04,000\n<i>Tạm biệt</i>'), 'Xin chào\nTạm biệt')
  })
  await t('WAV: pcmToWav/silenceWav/wavDuration', () => {
    assert.ok(Math.abs(vs.wavDuration(vs.silenceWav(1.5)) - 1.5) < 0.001)
    assert.equal(vs.wavDuration(Buffer.from('junk')), 0)
  })
  await t('Gemini: khóa sai -> khóa kế; model 404 -> model kế; 429 -> dừng, không xoay khóa', async () => {
    const calls = []
    const realFetch = global.fetch
    const pcm = Buffer.alloc(4800).toString('base64')
    global.fetch = async (url, opt) => {
      const key = opt.headers['x-goog-api-key'], model = /models\/([^:]+):/.exec(url)[1]
      calls.push(`${key}@${model}`)
      const json = (status, body) => ({ ok: status < 300, status, statusText: 'x', json: async () => body })
      if (key === 'BAD') return json(400, { error: { message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } })
      if (key === 'QUOTA') return json(429, { error: { message: 'quota' } })
      if (model === 'gemini-3.1-flash-tts-preview') return json(404, { error: { message: 'not found' } })
      return json(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm } }] } }] })
    }
    try {
      const keys = [{ id: '1', key: 'BAD', hint: 'b', enabled: true }, { id: '2', key: 'GOOD', hint: 'g', enabled: true }, { id: '3', key: 'OFF', hint: 'o', enabled: false }]
      const call = vs.makeGeminiCaller(keys, '')
      const r = await call({ voice: 'Kore', prompt: 'hi' })
      assert.equal(r.pcm.length, 4800)
      assert.deepEqual(calls, ['BAD@gemini-3.1-flash-tts-preview', 'GOOD@gemini-3.1-flash-tts-preview', 'GOOD@gemini-2.5-flash-preview-tts'])
      calls.length = 0
      const quota = vs.makeGeminiCaller([{ id: 'q', key: 'QUOTA', hint: 'q', enabled: true }, { id: 'g', key: 'GOOD', hint: 'g', enabled: true }], 'gemini-2.5-flash-preview-tts')
      await assert.rejects(() => quota({ voice: 'Kore', prompt: 'hi' }), (e) => e.quota && /không tự đổi sang khóa khác/.test(e.message))
      assert.deepEqual(calls, ['QUOTA@gemini-2.5-flash-preview-tts'])                  // khong thu khoa GOOD
      await assert.rejects(() => vs.makeGeminiCaller([], '')({}), /Chưa có khóa Gemini/)
    } finally { global.fetch = realFetch }
  })
  await t('generate: nhiều dòng + khoảng lặng -> 1 mp3, mốc thời gian, cache chạy lại', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-test-'))
    let synthCalls = 0
    const synth = async (line, out) => { synthCalls++; fs.writeFileSync(out, vs.pcmToWav(Buffer.alloc(24000 * 2 * (line.length > 5 ? 2 : 1)), 24000)) } // 1s hoac 2s
    const deps = { cacheDir: path.join(dir, 'cache'), outDir: path.join(dir, 'out'), synth }
    const job = { engine: 'gemini', lang: 'vi', mode: 'line', text: 'Một\n( 1s )\nDòng thứ hai dài\nBa', gap: 0.5, emotion: 'natural' }
    const prog = []
    const r = await vs.generate(job, { ...deps, onProgress: (p) => prog.push(p.phase) })
    assert.deepEqual(r.lines.map((l) => [l.start, l.end]), [[0, 1], [2, 4], [4.5, 5.5]])
    assert.ok(Math.abs(r.duration - 5.5) < 0.01, 'tong ' + r.duration)
    assert.ok(fs.statSync(r.path).size > 1000 && r.path.endsWith('.mp3'))
    assert.equal(synthCalls, 3); assert.equal(r.generated, 3)
    const again = await vs.generate(job, { ...deps, synth: async () => { throw new Error('khong duoc goi lai') } })
    assert.equal(again.cached, 3)                                                       // chay lai: dung cache, khong goi engine
    const one = await vs.generate({ ...job, onlyLine: 1 }, { ...deps })
    assert.equal(one.lines.length, 1); assert.ok(Math.abs(one.duration - 2) < 0.01)
    await assert.rejects(() => vs.generate({ ...job, text: '   ' }, deps), /Chưa có lời đọc/)
    const ctl = new AbortController(); ctl.abort()
    await assert.rejects(() => vs.generate(job, { ...deps, signal: ctl.signal }), (e) => e.cancelled)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  console.log(`\n${n} test voice-studio đạt`)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
