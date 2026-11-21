// The holo cards' painted layers → client/public/art/cards (webp, sized for the card), plus a flat thumbnail per house
// for the small cards, and the frame's window rectangle (printed; holo3d.ts uses it). The night-shrine set: dark bronze
// frame with blank name and motto plates, lamp-lit generals, night scenes.
//   node tools/holo-assets.ts [~/Downloads/harkara-holo-cards]
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const SRC = process.argv[2] ?? join(homedir(), 'Downloads/harkara-holo-cards')
const OUT = join(import.meta.dirname, '../client/public/art/cards')
mkdirSync(OUT, { recursive: true })
const W = 768, H = 1152 // every card layer, 2:3
const HOUSES = ['rhino', 'kite', 'orchid', 'tiger']
const webp = (f: string, o: { w: number; h: number; q?: number; grey?: boolean }) =>
  sharp(join(SRC, f)).resize(o.w, o.h, { fit: 'fill' }).toColourspace(o.grey ? 'b-w' : 'srgb').webp({ quality: o.q ?? 84, alphaQuality: 90, effort: 6 })

await webp('frame-dark.png', { w: W, h: H, q: 88 }).toFile(join(OUT, 'frame.webp'))
await webp('frame-dark-foil.png', { w: W / 2, h: H / 2, grey: true }).toFile(join(OUT, 'foil.webp'))
await webp('back.png', { w: W, h: H }).toFile(join(OUT, 'back.webp'))
await sharp(join(SRC, 'dust.png')).resize(512, 512).webp({ quality: 85, alphaQuality: 90 }).toFile(join(OUT, 'dust.webp'))
for (const h of HOUSES) {
  await webp(`${h}-bg-night.png`, { w: W, h: H, q: 80 }).toFile(join(OUT, `${h}-bg.webp`))
  await webp(`${h}-figure-lit.png`, { w: W, h: H, q: 86 }).toFile(join(OUT, `${h}-figure.webp`))
}

// the frame's see-through arch window, as fractions of the card (flood-filled from its middle)
const { data, info } = await sharp(join(SRC, 'frame-dark.png')).resize(W, H, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
const open = (x: number, y: number) => data[y * info.width + x] < 40
const fill = (sx: number, sy: number) => {
  const seen = new Uint8Array(W * H), st = [Math.round(sy * H) * W + Math.round(sx * W)]
  let x0 = W, x1 = 0, t = H, b = 0
  while (st.length) {
    const i = st.pop()!, x = i % W, y = (i / W) | 0
    if (seen[i] || !open(x, y)) continue
    seen[i] = 1; x0 = Math.min(x0, x); x1 = Math.max(x1, x); t = Math.min(t, y); b = Math.max(b, y)
    if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (y > 0) st.push(i - W); if (y < H - 1) st.push(i + W)
  }
  return [x0 / W, t / H, (x1 + 1) / W, (b + 1) / H].map(v => +v.toFixed(4))
}
const win = fill(0.5, 0.35)
console.log(JSON.stringify({ win }))

// thumbnails for the small cards: background, general and frame, flattened
const lay = async (f: string, x: number, y: number, w: number, h: number) => ({ input: await sharp(join(OUT, f)).resize(w, h, { fit: 'fill' }).toBuffer(), left: x, top: y })
for (const h of HOUSES) {
  const tw = 240, th = 360, [wx0, wy0, wx1, wy1] = win
  const fig = await lay(`${h}-figure.webp`, Math.round(wx0 * tw), Math.round(wy0 * th), Math.round((wx1 - wx0) * tw), Math.round((wy1 - wy0) * th))
  await sharp(join(OUT, `${h}-bg.webp`)).resize(tw, th).composite([fig, await lay('frame.webp', 0, 0, tw, th)]).webp({ quality: 82 }).toFile(join(OUT, `${h}-thumb.webp`))
}
console.log('wrote', OUT)
