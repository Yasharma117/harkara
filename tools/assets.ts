// npm run assets — ChatGPT PNGs in assets/raw/ → game-ready WebP in client/public/art/ + art.json.
// Keys out flat magenta, trims, forces unit sprites to greyscale, resizes, and warns about painted checkerboards.
import sharp from 'sharp'
import { readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const RAW = join(import.meta.dirname, '../assets/raw'), OUT = join(import.meta.dirname, '../client/public/art')
mkdirSync(OUT, { recursive: true })

// name prefix → [max width, max height, transparent?, greyscale?]
const RULES: [RegExp, number, number, boolean, boolean][] = [
  [/^unit-|^flag-/, 384, 384, true, true],
  [/^emblem-/, 256, 256, true, false],
  [/^prop-/, 512, 512, true, false],
  [/^tex-|^paper-grain/, 512, 512, false, false],
  [/^sky-|^key-art|^map-/, 2048, 2048, false, false],
  [/^hills-/, 2048, 1024, true, false],
  [/^portrait-|^frame-|^paper-letter/, 512, 768, false, false],
  [/./, 512, 512, true, false],
]

async function one(file: string) {
  const name = basename(file, '.png'), warn: string[] = []
  const [, mw, mh, transparent, grey] = RULES.find(r => r[0].test(name))!
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = (x: number, y: number) => (y * info.width + x) * 4
  const corners = [px(2, 2), px(info.width - 3, 2), px(2, info.height - 3), px(info.width - 3, info.height - 3)]
  const hasAlpha = corners.some(i => data[i + 3] < 250)
  const magenta = (i: number) => data[i] > 180 && data[i + 2] > 180 && data[i + 1] < 90
  if (transparent && !hasAlpha && corners.every(magenta)) {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const m = Math.min(r, b) - g // how magenta this pixel is
      if (m > 120) data[i + 3] = 0
      else if (m > 40) { data[i + 3] = Math.round(255 * (1 - (m - 40) / 80)); data[i] = data[i + 2] = Math.min(r, b, g + 40) } // soft edge + despill
    }
  } else if (transparent && !hasAlpha) {
    // a painted checkerboard: neighbouring corner blocks alternate light grey / white
    const lum = (i: number) => data[i] + data[i + 1] + data[i + 2]
    const a = lum(px(4, 4)), b = lum(px(20, 4)), c = lum(px(36, 4))
    if (Math.abs(a - b) > 20 && Math.abs(a - c) < 10) warn.push('looks like a painted checkerboard: regenerate on flat magenta #FF00FF')
    else warn.push('no transparency and no magenta background')
  }
  if (grey) {
    let sat = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) sat = Math.max(sat, Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]))
    if (sat > 60) warn.push(`colour found (saturation ${sat}); forced to greyscale`)
    for (let i = 0; i < data.length; i += 4) { const l = Math.round(0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]); data[i] = data[i + 1] = data[i + 2] = l }
  }
  let img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  if (transparent) img = sharp(await img.png().toBuffer()).trim({ threshold: 1 })
  const out = await img.resize(mw, mh, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 90 }).toBuffer({ resolveWithObject: true })
  writeFileSync(join(OUT, `${name}.webp`), out.data)
  return { name, w: out.info.width, h: out.info.height, kb: Math.round(out.data.length / 1024), warn }
}

if (!existsSync(RAW)) { mkdirSync(RAW, { recursive: true }); console.log(`put the PNGs in ${RAW} and run again`); process.exit(0) }
const files = readdirSync(RAW).filter(f => f.toLowerCase().endsWith('.png'))
const done = []
for (const f of files) {
  const r = await one(join(RAW, f))
  done.push(r)
  console.log(`${r.name.padEnd(18)} ${String(r.w).padStart(4)}×${String(r.h).padEnd(4)} ${String(r.kb).padStart(4)} KB  ${r.warn.join('; ')}`)
}
writeFileSync(join(OUT, 'art.json'), JSON.stringify(Object.fromEntries(done.map(d => [d.name, { w: d.w, h: d.h }]))))
console.log(`${done.length} images → client/public/art (${done.reduce((a, d) => a + d.kb, 0)} KB total)`)
