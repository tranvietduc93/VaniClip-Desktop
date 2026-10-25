// Tao icon tam (chu "TC") bang sharp -> build/icon.png 512x512
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'build')
fs.mkdirSync(dir, { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff4d6d"/>
      <stop offset="1" stop-color="#3a7afe"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, sans-serif" font-size="240" font-weight="800" fill="#ffffff">TC</text>
</svg>`

sharp(Buffer.from(svg)).png().toFile(path.join(dir, 'icon.png'))
  .then(() => console.log('Da tao build/icon.png 512x512'))
  .catch((e) => { console.error('Loi tao icon:', e.message); process.exit(1) })
