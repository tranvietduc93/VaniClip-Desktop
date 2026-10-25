// ============================================================
//  Doi khuon mat local (ONNX, insightface):
//    det_10g (SCRFD, phat hien mat + 5 diem moc, 17MB)
//    w600k_r50 (ArcFace embedding nguon, 174MB)
//    inswapper_128 (swap 128x128, 554MB)
//  Ma tran 'emap' (512x512) nam TRONG file inswapper (protobuf) ->
//  tu trich bang parser protobuf toi gian, cache ra emap.bin.
//  Tach rieng de test doc lap - xem test-face.cjs
// ============================================================
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const ops = require('./ffmpeg-ops.cjs')

let FFMPEG_PATH = null
let MODEL_DIR = null

function configure(ffmpegPath, modelDir) {
  FFMPEG_PATH = ffmpegPath
  MODEL_DIR = modelDir
}

const MODELS = {
  det: { file: 'det_10g.onnx', urls: [
    'https://huggingface.co/deepghs/insightface/resolve/main/buffalo_l/det_10g.onnx',
    'https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/det_10g.onnx'
  ], min: 10e6 },
  rec: { file: 'w600k_r50.onnx', urls: [
    'https://huggingface.co/deepghs/insightface/resolve/main/buffalo_l/w600k_r50.onnx',
    'https://huggingface.co/public-data/insightface/resolve/main/models/buffalo_l/w600k_r50.onnx'
  ], min: 100e6 },
  swap: { file: 'inswapper_128.onnx', urls: [
    'https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx',
    'https://huggingface.co/hacksider/deep-live-cam/resolve/main/inswapper_128.onnx'
  ], min: 500e6 }
}

async function downloadFile(urls, dest, min, onStatus, label, signal) {
  if (fs.existsSync(dest) && fs.statSync(dest).size >= min) return dest
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  let lastErr = null
  for (const url of urls) {
    try {
      if (signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })
      const res = await fetch(url, { redirect: 'follow', signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const total = Number(res.headers.get('content-length')) || 0
      const tmp = dest + '.part'
      const out = fs.createWriteStream(tmp)
      let got = 0
      for await (const chunk of res.body) {
        if (signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })
        out.write(Buffer.from(chunk))
        got += chunk.length
        if (onStatus && total) onStatus({ phase: 'download', file: label, progress: Math.round((got / total) * 100) })
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
      if (fs.statSync(tmp).size < min) { fs.rmSync(tmp, { force: true }); throw new Error('file thieu') }
      fs.renameSync(tmp, dest)
      return dest
    } catch (e) { try { fs.rmSync(dest + '.part', { force: true }) } catch {}; if (signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }); lastErr = e }
  }
  throw new Error(`Tai model ${label} loi: ` + (lastErr && lastErr.message))
}

async function ensureModels(onStatus, signal) {
  const paths = {}
  for (const [k, m] of Object.entries(MODELS)) {
    paths[k] = await downloadFile(m.urls, path.join(MODEL_DIR, m.file), m.min, onStatus, m.file, signal)
  }
  return paths
}

// ---------- Trich 'emap' (512x512 float32) tu inswapper_128.onnx ----------
// Parser protobuf toi gian: ModelProto.graph(7) -> GraphProto.initializer(5)
// -> TensorProto { dims(1), name(8), raw_data(9) }
function readVarint(buf, p) {
  let r = 0, s = 1
  for (;;) {
    const b = buf[p++]
    r += (b & 0x7f) * s
    if (!(b & 0x80)) return [r, p]
    s *= 128
  }
}
function walkFields(buf, start, end, cb) {
  let p = start
  while (p < end) {
    let key; [key, p] = readVarint(buf, p)
    const field = Math.floor(key / 8), wire = key % 8
    if (wire === 0) { let v; [v, p] = readVarint(buf, p); cb(field, wire, v) }
    else if (wire === 2) { let len; [len, p] = readVarint(buf, p); cb(field, wire, { start: p, end: p + len }); p += len }
    else if (wire === 1) { cb(field, wire, null); p += 8 }
    else if (wire === 5) { cb(field, wire, null); p += 4 }
    else throw new Error('protobuf wire type la: ' + wire)
  }
}
function extractEmap(modelPath, cachePath) {
  if (cachePath && fs.existsSync(cachePath) && fs.statSync(cachePath).size === 512 * 512 * 4) {
    const b = fs.readFileSync(cachePath)
    return new Float32Array(b.buffer, b.byteOffset, 512 * 512)
  }
  const buf = fs.readFileSync(modelPath)
  // insightface lay graph.initializer[-1] (initializer CUOI CUNG, ten tuy y)
  // -> quet het, giu initializer 512x512 float32 cuoi cung
  let found = null
  walkFields(buf, 0, buf.length, (f, w, v) => {
    if (f !== 7 || w !== 2) return // ModelProto.graph
    walkFields(buf, v.start, v.end, (f2, w2, v2) => {
      if (f2 !== 5 || w2 !== 2) return // GraphProto.initializer
      let raw = null
      const dims = []
      walkFields(buf, v2.start, v2.end, (f3, w3, v3) => {
        if (f3 === 1 && w3 === 0) dims.push(v3)          // dims khong packed
        else if (f3 === 1 && w3 === 2) {                  // dims packed (varint lien tiep)
          let p = v3.start
          while (p < v3.end) { let d; [d, p] = readVarint(buf, p); dims.push(d) }
        } else if (f3 === 9 && w3 === 2) raw = v3         // raw_data (bytes)
        else if (f3 === 4 && w3 === 2) raw = v3           // float_data (packed float32 LE)
      })
      const is512 = dims.length === 2 && dims[0] === 512 && dims[1] === 512
      if (raw && raw.end - raw.start === 512 * 512 * 4 && (is512 || !dims.length)) found = raw
    })
  })
  if (!found) throw new Error('Khong tim thay emap (512x512) trong inswapper_128.onnx')
  const b = Buffer.alloc(found.end - found.start)
  buf.copy(b, 0, found.start, found.end)
  const emap = new Float32Array(b.buffer, b.byteOffset, 512 * 512)
  if (cachePath) { try { fs.writeFileSync(cachePath, Buffer.from(emap.buffer, emap.byteOffset, emap.length * 4)) } catch {} }
  return emap
}

// ---------- Similarity transform (5 diem moc -> template), giai least-squares ----------
// Tra ve [a, b, tx, ty]: x' = a*x - b*y + tx ; y' = b*x + a*y + ty
function similarityTransform(src, dst) {
  const n = src.length
  let Sx = 0, Sy = 0, Sxx = 0, Sx1 = 0, Sy1 = 0, Sxx1 = 0, Sxy1 = 0
  for (let i = 0; i < n; i++) {
    const [x, y] = src[i], [x1, y1] = dst[i]
    Sx += x; Sy += y; Sxx += x * x + y * y
    Sx1 += x1; Sy1 += y1
    Sxx1 += x * x1 + y * y1
    Sxy1 += x * y1 - y * x1
  }
  const d = n * Sxx - Sx * Sx - Sy * Sy
  if (Math.abs(d) < 1e-9) throw new Error('landmark suy bien')
  const a = (n * Sxx1 - Sx * Sx1 - Sy * Sy1) / d
  const b = (n * Sxy1 - Sx * Sy1 + Sy * Sx1) / d
  const tx = (Sx1 - a * Sx + b * Sy) / n
  const ty = (Sy1 - b * Sx - a * Sy) / n
  return [a, b, tx, ty]
}
function invertSimilarity([a, b, tx, ty]) {
  const s2 = a * a + b * b
  const ia = a / s2, ib = -b / s2
  return [ia, ib, -(ia * tx - ib * ty), -(ib * tx + ia * ty)]
}
const applyT = ([a, b, tx, ty], x, y) => [a * x - b * y + tx, b * x + a * y + ty]

// Template 5 diem ArcFace (112x112); crop 128 cua inswapper = template + [8,0] (ratio 1)
const ARC_DST = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]]
const dstFor = (size) => size === 112 ? ARC_DST : ARC_DST.map(([x, y]) => [x + 8, y])

// ---------- Lay mau bilinear tu frame RGB ----------
function sampleBilinear(frame, W, H, x, y, out, oi) {
  if (x < 0 || y < 0 || x > W - 1 || y > H - 1) { out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; return }
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1)
  const fx = x - x0, fy = y - y0
  const p00 = (y0 * W + x0) * 3, p01 = (y0 * W + x1) * 3, p10 = (y1 * W + x0) * 3, p11 = (y1 * W + x1) * 3
  for (let c = 0; c < 3; c++) {
    out[oi + c] = (frame[p00 + c] * (1 - fx) + frame[p01 + c] * fx) * (1 - fy) +
                  (frame[p10 + c] * (1 - fx) + frame[p11 + c] * fx) * fy
  }
}
// Warp mat tu frame -> crop size x size (theo M frame->crop; lay mau bang M^-1)
function warpCrop(frame, W, H, M, size) {
  const inv = invertSimilarity(M)
  const out = new Float32Array(size * size * 3)
  const px = new Float32Array(3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [sx, sy] = applyT(inv, x, y)
      sampleBilinear(frame, W, H, sx, sy, px, 0)
      const o = (y * size + x) * 3
      out[o] = px[0]; out[o + 1] = px[1]; out[o + 2] = px[2]
    }
  }
  return out // RGB 0..255 (float)
}

// ---------- SCRFD (det_10g): phat hien mat + 5 landmark ----------
function decodeDet(outputs, thr) {
  // Phan loai output theo shape: cot cuoi 1=score, 4=bbox, 10=kps; N -> stride (12800/3200/800)
  const byN = {}
  for (const t of outputs) {
    const last = t.dims[t.dims.length - 1]
    const N = t.data.length / last
    const stride = N === 12800 ? 8 : N === 3200 ? 16 : N === 800 ? 32 : 0
    if (!stride) continue
    byN[stride] = byN[stride] || {}
    if (last === 1) byN[stride].score = t.data
    else if (last === 4) byN[stride].bbox = t.data
    else if (last === 10) byN[stride].kps = t.data
  }
  const faces = []
  for (const [strideS, o] of Object.entries(byN)) {
    const stride = Number(strideS)
    if (!o.score || !o.bbox || !o.kps) continue
    const w = 640 / stride
    for (let i = 0; i < o.score.length; i++) {
      const sc = o.score[i]
      if (sc < thr) continue
      const cell = Math.floor(i / 2)
      const cx = (cell % w) * stride, cy = Math.floor(cell / w) * stride
      const b = o.bbox.subarray(i * 4, i * 4 + 4)
      const box = [cx - b[0] * stride, cy - b[1] * stride, cx + b[2] * stride, cy + b[3] * stride]
      const kps = []
      for (let k = 0; k < 5; k++) kps.push([cx + o.kps[i * 10 + k * 2] * stride, cy + o.kps[i * 10 + k * 2 + 1] * stride])
      faces.push({ score: sc, box, kps })
    }
  }
  // NMS
  faces.sort((x, y) => y.score - x.score)
  const keep = []
  const iou = (A, B) => {
    const ix = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0]))
    const iy = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1]))
    const inter = ix * iy
    const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1])
    return inter / (area(A) + area(B) - inter + 1e-9)
  }
  for (const f of faces) {
    if (keep.every((k) => iou(f.box, k.box) < 0.4)) keep.push(f)
  }
  return keep
}

async function detectFaces(ctx, frame, W, H, thr = 0.5) {
  // letterbox ve 640x640 (giu ti le, pad phai/duoi)
  const r = 640 / Math.max(W, H)
  const nw = Math.round(W * r), nh = Math.round(H * r)
  const inp = new Float32Array(3 * 640 * 640) // NCHW, (x-127.5)/128
  const px = new Float32Array(3)
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      sampleBilinear(frame, W, H, x / r, y / r, px, 0)
      const o = y * 640 + x
      inp[o] = (px[0] - 127.5) / 128
      inp[640 * 640 + o] = (px[1] - 127.5) / 128
      inp[2 * 640 * 640 + o] = (px[2] - 127.5) / 128
    }
  }
  const feeds = {}
  feeds[ctx.det.inputNames[0]] = new ctx.ort.Tensor('float32', inp, [1, 3, 640, 640])
  const res = await ctx.det.run(feeds)
  const faces = decodeDet(ctx.det.outputNames.map((n) => res[n]), thr)
  // map nguoc ve toa do goc
  for (const f of faces) {
    f.box = f.box.map((v) => v / r)
    f.kps = f.kps.map(([x, y]) => [x / r, y / r])
    f.area = Math.max(0, f.box[2] - f.box[0]) * Math.max(0, f.box[3] - f.box[1])
  }
  return faces
}

function requireOneFace(faces, code, context) {
  if (!faces.length) return null
  if (faces.length > 1) {
    const e = new Error(`${context} co nhieu khuon mat; vui long chi dinh dung mot nguoi.`)
    e.code = code
    throw e
  }
  return faces[0]
}

// ---------- ArcFace embedding (source) -> latent (nhan emap, chuan hoa) ----------
async function faceLatent(ctx, frame, W, H, face) {
  const M = similarityTransform(face.kps, dstFor(112))
  const crop = warpCrop(frame, W, H, M, 112)
  const inp = new Float32Array(3 * 112 * 112)
  const n = 112 * 112
  for (let i = 0; i < n; i++) {
    inp[i] = (crop[i * 3] - 127.5) / 127.5
    inp[n + i] = (crop[i * 3 + 1] - 127.5) / 127.5
    inp[2 * n + i] = (crop[i * 3 + 2] - 127.5) / 127.5
  }
  const feeds = {}
  feeds[ctx.rec.inputNames[0]] = new ctx.ort.Tensor('float32', inp, [1, 3, 112, 112])
  const res = await ctx.rec.run(feeds)
  const emb = res[ctx.rec.outputNames[0]].data // 512
  let nrm = 0
  for (let i = 0; i < 512; i++) nrm += emb[i] * emb[i]
  nrm = Math.sqrt(nrm) || 1
  // latent = (emb/|emb|) x emap ; roi chuan hoa
  const lat = new Float32Array(512)
  for (let j = 0; j < 512; j++) {
    let s = 0
    for (let i = 0; i < 512; i++) s += (emb[i] / nrm) * ctx.emap[i * 512 + j]
    lat[j] = s
  }
  let ln = 0
  for (let j = 0; j < 512; j++) ln += lat[j] * lat[j]
  ln = Math.sqrt(ln) || 1
  for (let j = 0; j < 512; j++) lat[j] /= ln
  return lat
}

// ---------- Swap 1 khuon mat trong frame (tai cho) ----------
async function swapFaceInFrame(ctx, frame, W, H, face, latent) {
  const M = similarityTransform(face.kps, dstFor(128))
  const crop = warpCrop(frame, W, H, M, 128)
  const n = 128 * 128
  const inp = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    inp[i] = crop[i * 3] / 255
    inp[n + i] = crop[i * 3 + 1] / 255
    inp[2 * n + i] = crop[i * 3 + 2] / 255
  }
  const feeds = {}
  // inswapper: input 4 chieu = target, 2 chieu = source (theo ten 'target'/'source')
  const tName = ctx.swap.inputNames.includes('target') ? 'target' : ctx.swap.inputNames[0]
  const sName = ctx.swap.inputNames.includes('source') ? 'source' : ctx.swap.inputNames[1]
  feeds[tName] = new ctx.ort.Tensor('float32', inp, [1, 3, 128, 128])
  feeds[sName] = new ctx.ort.Tensor('float32', latent, [1, 512])
  const res = await ctx.swap.run(feeds)
  const out = res[ctx.swap.outputNames[0]].data // 1x3x128x128, RGB 0..1
  // dan nguoc vao frame theo vung bbox cua crop, mask mem theo mep crop
  const inv = invertSimilarity(M)
  const corners = [[0, 0], [128, 0], [0, 128], [128, 128]].map(([x, y]) => applyT(inv, x, y))
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))))
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))))
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))))
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))))
  const FEATHER = 12
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [qx, qy] = applyT(M, x, y)
      if (qx < 0 || qy < 0 || qx > 127 || qy > 127) continue
      let m = Math.min(qx, 127 - qx, qy, 127 - qy) / FEATHER
      if (m <= 0) continue
      if (m > 1) m = 1
      m = m * m * (3 - 2 * m) // smoothstep
      // bilinear tren output swap (NCHW 0..1)
      const sx0 = Math.floor(qx), sy0 = Math.floor(qy)
      const sx1 = Math.min(sx0 + 1, 127), sy1 = Math.min(sy0 + 1, 127)
      const fx = qx - sx0, fy = qy - sy0
      const o = (y * W + x) * 3
      for (let c = 0; c < 3; c++) {
        const ch = c * 128 * 128
        const v = (out[ch + sy0 * 128 + sx0] * (1 - fx) + out[ch + sy0 * 128 + sx1] * fx) * (1 - fy) +
                  (out[ch + sy1 * 128 + sx0] * (1 - fx) + out[ch + sy1 * 128 + sx1] * fx) * fy
        const nv = frame[o + c] * (1 - m) + v * 255 * m
        frame[o + c] = nv < 0 ? 0 : nv > 255 ? 255 : nv
      }
    }
  }
}

// ---------- Doc 1 anh -> frame RGB (qua ffmpeg) ----------
function decodeImage(imgPath) {
  return ops.probe(imgPath).then((info) => new Promise((resolve, reject) => {
    const W = info.width, H = info.height
    if (!W || !H) return reject(new Error('Khong doc duoc anh'))
    const ps = spawn(FFMPEG_PATH, ['-v', 'error', '-i', path.resolve(imgPath), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    const chunks = []
    let err = ''
    ps.stdout.on('data', (d) => chunks.push(d))
    ps.stderr.on('data', (d) => (err += d))
    ps.on('error', reject)
    ps.on('close', (c) => {
      const buf = Buffer.concat(chunks)
      if (c !== 0 || buf.length < W * H * 3) return reject(new Error('doc anh loi: ' + err.slice(-200)))
      resolve({ frame: buf, W, H })
    })
  }))
}

let ctxPromise = null
async function getCtx(onStatus, signal) {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      const paths = await ensureModels(onStatus, signal)
      if (onStatus) onStatus({ phase: 'load' })
      const ort = require('onnxruntime-node')
      const emap = extractEmap(paths.swap, path.join(MODEL_DIR, 'emap.bin'))
      const [det, rec, swap] = await Promise.all([
        ort.InferenceSession.create(paths.det),
        ort.InferenceSession.create(paths.rec),
        ort.InferenceSession.create(paths.swap)
      ])
      return { ort, det, rec, swap, emap }
    })()
    ctxPromise.catch(() => { ctxPromise = null }) // loi (mang...) -> cho phep thu lai
  }
  return ctxPromise
}

// Embedding ArcFace THO (chuan hoa) cua 1 mat - de so sanh DANH TINH (khong nhan emap)
async function faceEmbedding(ctx, frame, W, H, face) {
  const M = similarityTransform(face.kps, dstFor(112))
  const crop = warpCrop(frame, W, H, M, 112)
  const inp = new Float32Array(3 * 112 * 112)
  const n = 112 * 112
  for (let i = 0; i < n; i++) {
    inp[i] = (crop[i * 3] - 127.5) / 127.5
    inp[n + i] = (crop[i * 3 + 1] - 127.5) / 127.5
    inp[2 * n + i] = (crop[i * 3 + 2] - 127.5) / 127.5
  }
  const feeds = {}
  feeds[ctx.rec.inputNames[0]] = new ctx.ort.Tensor('float32', inp, [1, 3, 112, 112])
  const res = await ctx.rec.run(feeds)
  const emb = Float32Array.from(res[ctx.rec.outputNames[0]].data)
  let nrm = 0; for (let i = 0; i < 512; i++) nrm += emb[i] * emb[i]
  nrm = Math.sqrt(nrm) || 1
  for (let i = 0; i < 512; i++) emb[i] /= nrm
  return emb
}
// Embedding khuon mat duy nhat trong anh. Khong tu chon mat lon nhat vi co the sai nguoi.
async function imageEmbedding(ctx, imagePath) {
  const { frame, W, H } = await decodeImage(imagePath)
  const faces = await detectFaces(ctx, frame, W, H)
  if (!faces.length) throw new Error('Khong tim thay mat trong anh')
  return faceEmbedding(ctx, frame, W, H, requireOneFace(faces, 'MULTIPLE_SOURCE_FACES', 'Anh nguon'))
}

// Lay latent tu anh nguon chi khi co dung mot khuon mat.
async function sourceLatent(ctx, imagePath) {
  const { frame, W, H } = await decodeImage(imagePath)
  const faces = await detectFaces(ctx, frame, W, H)
  if (!faces.length) { const e = new Error('Khong tim thay khuon mat trong anh nguon'); e.code = 'NO_SOURCE_FACE'; throw e }
  return faceLatent(ctx, frame, W, H, requireOneFace(faces, 'MULTIPLE_SOURCE_FACES', 'Anh nguon'))
}

// ---------- API chinh: doi mat 1 doan video ----------
// opts: { input, start, dur, sourceImage, output, fps?, onStatus?, onProgress? }
// Chi chap nhan video mot nguoi: nhieu mat tren mot frame la tinh huong mo ho, khong tu swap mat lon nhat.
async function swapFaceVideo({ input, start = 0, dur, sourceImage, output, fps = 30, onStatus, onProgress, signal }) {
  if (!FFMPEG_PATH || !MODEL_DIR) throw new Error('face-swap chua duoc configure')
  if (signal?.aborted) throw Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' })
  const ctx = await getCtx(onStatus, signal)
  if (onStatus) onStatus({ phase: 'source' })
  const latent = await sourceLatent(ctx, sourceImage)
  const info = await ops.probe(input)
  if (!info.width || !info.height) throw new Error('Khong doc duoc kich thuoc video')
  // Chan kich thuoc CHAN: yuv420p yeu cau chan; scale ep dung (le -> giam 1px)
  const W = info.width - (info.width % 2), H = info.height - (info.height % 2)
  if (!dur || dur <= 0) dur = Math.max(0.1, info.duration - start)

  return new Promise((resolve, reject) => {
    let done = false
    const dec = spawn(FFMPEG_PATH, ['-v', 'error', '-ss', String(start), '-t', String(dur), '-i', path.resolve(input),
      '-vf', `fps=${fps},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    const encArgs = ['-y', '-v', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0',
      '-ss', String(start), '-t', String(dur), '-i', path.resolve(input),
      '-map', '0:v', '-map', '1:a?', '-c:a', 'aac', '-b:a', '192k',
      ...ops.vencArgs(), '-r', String(fps), '-movflags', '+faststart', path.resolve(output)]
    const enc = spawn(FFMPEG_PATH, encArgs)
    let decErr = '', encErr = ''
    dec.stderr.on('data', (d) => (decErr += d))
    enc.stderr.on('data', (d) => (encErr += d))
    const fail = (e) => {
      if (done) return
      done = true
      try { dec.kill() } catch {}
      try { enc.kill() } catch {}
      const closed = (child) => child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once('close', resolve))
      Promise.all([closed(dec), closed(enc)]).then(() => reject(e))
    }
    const abort = () => { const e = Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }); fail(e) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    dec.on('error', fail); enc.on('error', fail)
    enc.stdin.on('error', () => {})

    const frameSize = W * H * 3
    const totalEst = Math.max(1, Math.ceil(dur * fps))
    let buf = Buffer.alloc(0)
    let frames = 0, swapped = 0, framesWithFace = 0, framesWithoutFace = 0, processing = false, decEnded = false

    async function pump() {
      if (processing || done) return
      processing = true
      try {
        while (buf.length >= frameSize) {
          const frame = Buffer.from(buf.subarray(0, frameSize)) // copy: se sua tai cho
          buf = buf.subarray(frameSize)
          const faces = await detectFaces(ctx, frame, W, H)
          const face = requireOneFace(faces, 'MULTIPLE_TARGET_FACES', `Video tai khoang ${((frames / fps) + start).toFixed(2)}s`)
          if (face) {
            await swapFaceInFrame(ctx, frame, W, H, face, latent)
            swapped++
            framesWithFace++
          } else framesWithoutFace++
          if (!enc.stdin.write(frame)) await new Promise((r) => enc.stdin.once('drain', r))
          frames++
          if (onProgress) onProgress(Math.min(99, Math.round((frames / totalEst) * 100)))
        }
      } catch (e) { processing = false; return fail(e) }
      processing = false
      dec.stdout.resume()
      if (decEnded && buf.length < frameSize) enc.stdin.end()
    }

    dec.stdout.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d
      if (buf.length >= frameSize * 3) dec.stdout.pause()
      pump()
    })
    dec.stdout.on('end', () => { decEnded = true; pump() })
    dec.on('close', (c) => { if (c !== 0) fail(new Error('decode loi: ' + decErr.slice(-300))) })
    enc.on('close', (c) => {
      signal?.removeEventListener('abort', abort)
      if (done) return
      if (c === 0 && frames > 0) { done = true; resolve({ ok: true, output, frames, swapped, framesWithFace, framesWithoutFace, fps }) }
      else fail(new Error('encode loi: ' + (encErr.slice(-300) || 'khong co frame nao')))
    })
  })
}

module.exports = { configure, ensureModels, extractEmap, similarityTransform, requireOneFace, swapFaceVideo, sourceLatent, getCtx, detectFaces, decodeImage, imageEmbedding, faceEmbedding }
