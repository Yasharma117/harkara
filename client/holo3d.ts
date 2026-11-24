// The generals' cards as real 3D cards, drawn by one full-screen WebGPU canvas over the page. Each card follows an
// empty slot in the page (<div class="slot"> inside .card3[data-h]), so CSS does the layout and a slot that grows,
// shrinks or moves animates its card in 3D. One card object per house; it draws at its first visible slot.
// What makes them deep rather than a sticker:
//   - the art sits at real depths behind the frame's window (per-pixel parallax along the true view ray), so the
//     scene and the general shift against the gilt like looking through a window;
//   - the gilt is lit: normals from the frame's own relief, a light that follows the pointer, specular that flashes on
//     the raised gold (foil mask), a holo sweep band, recesses aged to dark bronze, the window's inner shadow;
//   - a thick gilded edge, a spring tilt of up to ~30°, idle sway, a cast shadow and halo behind, embers around.
// Hover tilts; drag turns; double-click flips. Art: client/public/art/cards (tools/holo-assets.ts).
import * as THREE from 'three/webgpu'
import { texture, uniform, positionGeometry, normalGeometry, vec2, vec3, float, mix, pow, cos, select, smoothstep, max, dot, normalize, exp } from 'three/tsl'

const HOUSES = ['rhino', 'kite', 'orchid', 'tiger']
const ART = 'art/cards/'
const WIN = [0.1146, 1 - 0.6918, 0.8854, 1 - 0.158] // the frame's arch window, y up
const NAME = [0.19, 1 - 0.1, 0.81, 1 - 0.028], MOTTO = [0.12, 1 - 0.884, 0.88, 1 - 0.772] // its blank bronze plates
const CW = 2, CH = 3, T = 0.14 // card in its own units, and its thickness
const CAM_D = 32, FOV = 20 // a long lens: depth without distortion
const SHRINE_LAMP = { y: -0.07, z: 0.12 } // the lamp flames, in card units from the model's centre
const still = matchMedia('(prefers-reduced-motion: reduce)').matches

type Card = {
  h: string; group: THREE.Group; pivot: THREE.Group; edge: THREE.MeshStandardNodeMaterial
  shadow: THREE.Mesh; halo: THREE.Mesh; dust: { s: THREE.Sprite; v: number; ph: number }[]
  relic?: { root: THREE.Group; mats: THREE.Material[]; turn: number }
  u: { cam: any; light: any; flare: any; fade: any }
  rot: THREE.Vector2; vel: THREE.Vector2; spin: number; spinV: number; spinTo: number
  hover: number; flare: number; bump: number; seen: boolean
}
const cards = new Map<string, Card>()

export function emote(h: string, cue: string) {
  const c = cards.get(h)
  if (!c || still) return
  c.flare = cue === 'hello' ? Math.max(c.flare, 0.5) : 1
  c.bump = 1
}

const roundedRect = (w: number, h: number, r: number) => {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s
}
const radial = (inner: string, outer: string) => {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
}
// white letters on clear, sized to a plate; the shader cuts them into the bronze
function engraving(text: string, w: number, h: number, italic = false) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w)
  const g = c.getContext('2d')!, font = (px: number) => `${italic ? 'italic 500' : '600'} ${px}px "Cormorant Garamond", Georgia, serif`
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'
  // the motto wraps to two lines when it's long
  const words = text.split(' '), lines = italic && text.length > 34 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text]
  let px = Math.round(c.height * (lines.length > 1 ? 0.36 : 0.62))
  g.font = font(px)
  while (Math.max(...lines.map(l => g.measureText(l).width)) > 900 && px > 20) g.font = font(--px)
  lines.forEach((l, i) => g.fillText(l, 512, c.height / 2 + (i - (lines.length - 1) / 2) * px * 1.08))
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8
  return t
}

let started = false
export async function holo3d(names: Record<string, string>, colors: Record<string, string>, mottos: Record<string, string> = {}) {
  if (started) return
  started = true
  const canvas = document.createElement('canvas'); canvas.id = 'holo'; canvas.setAttribute('aria-hidden', 'true')
  document.body.append(canvas)
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true })
  await renderer.init()
  const dpr = () => Math.min(devicePixelRatio, 2)
  renderer.setPixelRatio(dpr()); renderer.setSize(innerWidth, innerHeight, false); renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.NoToneMapping
  const cam = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 1, 80)
  cam.position.set(0, 0, CAM_D)
  addEventListener('resize', () => { renderer.setPixelRatio(dpr()); renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix() })
  const worldPerPx = () => 2 * CAM_D * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / innerHeight

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#ffe3b8', '#1a1008', 1.1))
  const key = new THREE.DirectionalLight('#ffd9a0', 2.6); key.position.set(-6, 8, 10); scene.add(key)
  const lamp = new THREE.PointLight('#ff9a3c', 60, 40, 2); lamp.position.set(2, -4, 6); scene.add(lamp)

  const loader = new THREE.TextureLoader()
  const tex = async (f: string, srgb = true) => {
    const t = await loader.loadAsync(ART + f)
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true
    return t
  }
  await document.fonts?.load('600 40px "Cormorant Garamond"').catch(() => {})
  const [frame, foil, back, dustTex] = await Promise.all([tex('frame.webp'), tex('foil.webp', false), tex('back.webp'), tex('dust.webp')])
  const shadowTex = radial('#000000d0', '#00000000'), haloTex = radial('#ffb45a', '#ff8a2000')

  await Promise.all(HOUSES.map(async h => {
    const [bg, fig] = await Promise.all([tex(`${h}-bg.webp`), tex(`${h}-figure.webp`)])
    const plateW = (r: number[]) => (r[2] - r[0]) * CW, plateH = (r: number[]) => (r[3] - r[1]) * CH
    const name = engraving((names[h] ?? h).toUpperCase(), plateW(NAME), plateH(NAME)), motto = engraving(mottos[h] ?? '', plateW(MOTTO), plateH(MOTTO), true)
    const u = { cam: uniform(new THREE.Vector3(0, 0, CAM_D)), light: uniform(new THREE.Vector3(-0.3, 0.5, 0.8).normalize()), flare: uniform(0), fade: uniform(1) }

    // ---- the face: a window into layered depth, under lit gilt
    const P = vec3(positionGeometry.x, positionGeometry.y, float(T / 2))
    const V = normalize(u.cam.sub(P))
    const at = (d: number) => P.xy.sub(V.xy.mul(float(d).div(V.z))).div(vec2(CW, CH)).add(0.5) // card uv of the point d behind the surface, on this pixel's view ray
    const p = P.xy.div(vec2(CW, CH)).add(0.5)
    const L = normalize(u.light)
    const lum = (c: any) => dot(c, vec3(0.3, 0.59, 0.11))
    const inside = (q: any) => smoothstep(0, 0.002, q.x).mul(smoothstep(0, 0.002, float(1).sub(q.x))).mul(smoothstep(0, 0.002, q.y)).mul(smoothstep(0, 0.002, float(1).sub(q.y)))
    // the scene, far back (zoomed so its slide never shows an edge)
    const ub = at(1.15).sub(0.5).mul(0.8).add(0.5)
    let art: any = texture(bg, ub).rgb.mul(0.92)
    // the general, nearer, standing in the arch with his feet behind the lower band
    const wh = (WIN[3] - WIN[1]) * 1.1, ww = wh * (CH / CW) * (2 / 3), fx0 = 0.5 - ww / 2, fy0 = WIN[1] - (WIN[3] - WIN[1]) * 0.08
    const figUv = (q: any) => q.sub(vec2(fx0, fy0)).div(vec2(ww, wh))
    const fq = figUv(at(0.38))
    const fc = texture(fig, fq), fa = fc.a.mul(inside(fq))
    // his shadow on the scene behind him, cast away from the light
    const sq = figUv(at(1.15)).add(vec2(L.x.mul(-0.05), L.y.mul(0.05)))
    art = art.mul(float(1).sub(texture(fig, sq).a.mul(inside(sq)).mul(0.45)))
    // a warm lamp glow low down, cooler toward the top
    art = art.mul(mix(vec3(1.12, 0.95, 0.78), vec3(0.8, 0.85, 1.0), smoothstep(0.35, 0.95, p.y)))
    art = mix(art, fc.rgb.mul(1.04), fa)
    // the window's inner shadow: the painting sits back behind the gilt
    const ao = texture(frame, p, float(5)).a
    art = art.mul(mix(float(1), float(0.22), smoothstep(0.05, 0.75, ao)))
    // varnish over the art: a soft glare where the light reflects
    const H = normalize(L.add(V))
    art = art.add(vec3(1, 0.92, 0.8).mul(pow(max(H.z, 0), 60).mul(0.14)))

    // the gilt: relief normals from its own shading, aged bronze in the recesses, gold on the worn ridges
    const fr = texture(frame, p)
    const e = 1.6 / 768
    const hgt = (q: any) => { const c = texture(frame, q, float(1)); return lum(c.rgb).mul(c.a) }
    const nx = hgt(p.add(vec2(e, 0))).sub(hgt(p.sub(vec2(e, 0)))), ny = hgt(p.add(vec2(0, e))).sub(hgt(p.sub(vec2(0, e))))
    const N = normalize(vec3(nx.mul(-7), ny.mul(-7), 1))
    const gold = texture(foil, p).r
    const fl = lum(fr.rgb)
    const aged = mix(fr.rgb.mul(0.75), fr.rgb.mul(vec3(1.12, 1.0, 0.82)), smoothstep(0.3, 0.75, fl))
    const diff = max(dot(N, L), 0)
    const spec = pow(max(dot(N, H), 0), 90).mul(mix(float(0.25), float(2.6), gold))
    const fres = pow(float(1).sub(max(dot(N, V), 0)), 5)
    const lift = float(1).add(u.flare.mul(1.6))
    let gilt: any = aged.mul(float(0.3).add(diff.mul(0.95))).add(vec3(1, 0.82, 0.5).mul(spec.mul(lift))).add(vec3(1, 0.85, 0.6).mul(fres.mul(0.35)))
    // the name and motto cut into their plates: a dark floor, a gilt inlay, and the cut's wall catching the light
    const cut = (tx: any, r: number[]) => {
      const q = p.sub(vec2(r[0], r[1])).div(vec2(r[2] - r[0], r[3] - r[1])), m = texture(tx, q).a.mul(inside(q))
      const qs = q.add(vec2(L.x.mul(0.004), L.y.mul(0.02))), ms = texture(tx, qs).a.mul(inside(qs))
      return { m, wall: max(m.sub(ms), 0), shade: max(ms.sub(m), 0) }
    }
    for (const c of [cut(name, NAME), cut(motto, MOTTO)]) {
      const inlay = vec3(0.86, 0.64, 0.3).mul(float(0.32).add(diff.mul(0.75))).add(vec3(1, 0.85, 0.55).mul(spec.mul(0.5)))
      gilt = mix(gilt, inlay, c.m.mul(0.85)).mul(float(1).sub(c.shade.mul(0.55))).add(vec3(1, 0.86, 0.6).mul(c.wall.mul(diff).mul(0.6)))
    }
    // holo sweep: one band of colour that crosses the gold as the card turns
    const sx = dot(p.sub(0.5), vec2(0.85, -0.53)).sub(V.x.mul(1.35).sub(V.y.mul(0.9)).add(L.x.mul(0.45)))
    const band = exp(sx.mul(sx).div(-0.005)), hue = cos(vec3(0, 2.1, 4.2).add(sx.mul(26.4).add(0.6))).mul(0.5).add(0.5)
    gilt = gilt.add(hue.mul(0.6).add(0.4).mul(band).mul(gold).mul(0.16)) // a glint of colour, not a rainbow
    let col: any = mix(art, gilt, fr.a)
    col = col.add(hue.mul(band.mul(0.025))) // a faint laminate over everything
    col = col.mul(1.15).div(col.mul(0.22).add(1)) // roll the highlights instead of clipping them

    // the back: lacquer, its gold catching the same light from behind
    const bk = texture(back, vec2(float(1).sub(p.x), p.y)).rgb
    const bspec = pow(max(H.z.negate(), 0), 30)
    const backCol = bk.mul(float(0.45).add(max(L.z.negate(), 0).mul(0.6))).add(vec3(1, 0.84, 0.5).mul(bspec.mul(smoothstep(0.45, 0.85, lum(bk))).mul(1.4)))

    const face = new THREE.MeshBasicNodeMaterial({ transparent: true })
    face.colorNode = select(normalGeometry.z.greaterThan(0), col, backCol)
    face.opacityNode = u.fade
    const edge = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#8a6428'), metalness: 0.85, roughness: 0.36, transparent: true })

    const geo = new THREE.ExtrudeGeometry(roundedRect(CW, CH, 0.09), { depth: T, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 12 })
    geo.translate(0, 0, -T / 2)
    const pivot = new THREE.Group(); pivot.add(new THREE.Mesh(geo, [face, edge]))
    const group = new THREE.Group(); group.add(pivot); group.visible = false
    const house = new THREE.Color(colors[h] ?? '#a9802f')
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(CW * 1.5, CH * 1.35), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }))
    shadow.position.set(0.25, -0.35, -1.2); group.add(shadow)
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(CW * 2.4, CH * 1.9), new THREE.MeshBasicMaterial({ map: haloTex, color: house.clone().lerp(new THREE.Color('#ffb060'), 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.position.z = -1.4; group.add(halo)
    const dust: Card['dust'] = []
    for (let i = 0; i < 34; i++) {
      const t = dustTex.clone(); t.repeat.set(0.25, 0.25); t.offset.set((i % 4) * 0.25, Math.floor((i / 4) % 4) * 0.25)
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      s.position.set((Math.random() - 0.5) * 4.2, (Math.random() - 0.5) * 5, (Math.random() - 0.4) * 2.6); s.scale.setScalar(0.12 + Math.random() * 0.3)
      group.add(s); dust.push({ s, v: 0.15 + Math.random() * 0.35, ph: Math.random() * 6.28 })
    }
    scene.add(group)
    cards.set(h, { h, group, pivot, edge, shadow, halo, dust, u, rot: new THREE.Vector2(), vel: new THREE.Vector2(), spin: 0, spinV: 0, spinTo: 0, hover: 0, flare: 0, bump: 0, seen: false })
  }))

  // ---- the messenger's shrine on the title (.shrine3 > .slot): the model, its three lamp flames and the light they cast
  const shrine = await (async () => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const model = (await new GLTFLoader().loadAsync('models/shrine.glb')).scene
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3())
    model.scale.setScalar(CH / size.y); model.position.set(-(box.min.x + box.max.x) / 2 * CH / size.y, -CH / 2, -(box.min.z + box.max.z) / 2 * CH / size.y)
    const pivot = new THREE.Group(); pivot.add(model)
    const group = new THREE.Group(); group.add(pivot); group.visible = false
    const glow = radial('#fff2c0', '#ffb04000')
    // the lamp sits in the niche, a little above half height (SHRINE_LAMP, measured on the model)
    const flames = [-0.15, 0, 0.15].map(x => {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      f.position.set(x, SHRINE_LAMP.y, SHRINE_LAMP.z); pivot.add(f); return f
    })
    const light = new THREE.PointLight('#ffb060', 8, 6, 2); light.position.set(0, SHRINE_LAMP.y + 0.1, SHRINE_LAMP.z + 0.3); pivot.add(light)
    const embers: { s: THREE.Sprite; v: number; ph: number }[] = []
    for (let i = 0; i < 26; i++) {
      const t = dustTex.clone(); t.repeat.set(0.25, 0.25); t.offset.set((i % 4) * 0.25, Math.floor((i / 4) % 4) * 0.25)
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      sp.position.set((Math.random() - 0.5) * 1.2, SHRINE_LAMP.y + Math.random() * 2.4, SHRINE_LAMP.z + (Math.random() - 0.3) * 0.8); sp.scale.setScalar(0.06 + Math.random() * 0.14)
      group.add(sp); embers.push({ s: sp, v: 0.2 + Math.random() * 0.4, ph: Math.random() * 6.28 })
    }
    scene.add(group)
    return { group, pivot, flames, light, embers, mats: [] as THREE.Material[], seen: false, turn: 0 }
  })().catch(e => { console.error('shrine', e); return null })
  shrine?.group.traverse(o => { if ((o as THREE.Mesh).isMesh) { const m = (o as THREE.Mesh).material as THREE.Material; m.transparent = true; shrine.mats.push(m) } })

  // ---- each general's relic (client/public/models/relic-<house>.glb): it stands at the front corner of the big card,
  // upright while the card tilts, turning slowly, and hops when the general acts. Loaded after the cards; optional.
  {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    const gl = new GLTFLoader()
    await Promise.all([...cards.values()].map(async C => {
      try {
        const model = (await gl.loadAsync(`models/relic-${C.h}.glb`)).scene
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), k = (CH * 0.52) / size.y
        model.scale.setScalar(k); model.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k)
        const root = new THREE.Group(); root.add(model)
        root.position.set(CW / 2 + 0.18, -CH / 2 - 0.12, 0.7); root.visible = false
        const mats: THREE.Material[] = []
        model.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if ((o as THREE.Mesh).isMesh && m) { m.transparent = true; mats.push(m) } })
        C.group.add(root); C.relic = { root, mats, turn: 0 }
      } catch (e) { console.warn('relic', C.h, e) }
    }))
  }

  // ---- pointer
  const ptr = { x: -1e4, y: -1e4 }
  let drag: { h: string; x: number; y: number; spin: number; moved: boolean } | null = null, dragged = false
  const houseAt = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('.card3[data-h]')?.dataset.h
  addEventListener('pointermove', e => {
    ptr.x = e.clientX; ptr.y = e.clientY
    if (!drag) return
    const C = cards.get(drag.h)!, dx = e.clientX - drag.x
    if (Math.hypot(dx, e.clientY - drag.y) > 6) drag.moved = true
    C.spinTo = drag.spin + dx * 0.0085
  }, { passive: true })
  addEventListener('pointerdown', e => { const h = houseAt(e); if (h && cards.has(h)) drag = { h, x: e.clientX, y: e.clientY, spin: cards.get(h)!.spinTo, moved: false } })
  addEventListener('pointerup', () => {
    if (!drag) return
    const C = cards.get(drag.h)!
    C.spinTo = Math.round(C.spinTo / Math.PI) * Math.PI // let go: it settles on the nearer face
    dragged = drag.moved; drag = null
  })
  addEventListener('click', e => { if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault() } }, true) // a turn isn't a pick
  addEventListener('dblclick', e => { const h = houseAt(e), C = h && cards.get(h); if (C) C.spinTo = (Math.round(C.spinTo / Math.PI) + 1) * Math.PI })

  // how visible a slot really is: its own and its ancestors' opacity (overlays fade in and out)
  const opacityOf = (el: Element) => { let o = 1; for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o }

  const t0 = performance.now()
  let last = t0, drawn = false
  const tick = (now: number) => {
    requestAnimationFrame(tick)
    const real = Math.min(0.5, (now - last) / 1000), dt = Math.min(0.05, real); last = now // springs step at most 50 ms; glides use real time
    const t = (now - t0) / 1000, k = worldPerPx()
    const slot = new Map<string, { r: DOMRect; o: number }>()
    for (const el of document.querySelectorAll<HTMLElement>('.card3[data-h] > .slot')) {
      const h = el.parentElement!.dataset.h!
      if (slot.has(h) || !el.offsetParent) continue
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.bottom < -200 || r.top > innerHeight + 200) continue
      const o = opacityOf(el)
      if (o > 0.01) slot.set(h, { r, o })
    }
    let any = false
    for (const C of cards.values()) {
      const s = slot.get(C.h)
      if (!s) { C.group.visible = false; C.seen = false; continue }
      any = true; C.group.visible = true
      const { r, o } = s, big = r.height > 300
      const scale = (r.height * k) / CH
      const tx = (r.left + r.width / 2 - innerWidth / 2) * k, ty = -(r.top + r.height / 2 - innerHeight / 2) * k
      if (!C.seen) { C.group.position.set(tx, ty, 0); C.group.scale.setScalar(scale); C.seen = true }
      const f = 1 - Math.exp(-real * 9) // the slot moved or grew: the card glides there
      C.group.position.x += (tx - C.group.position.x) * f; C.group.position.y += (ty - C.group.position.y) * f
      C.group.scale.setScalar(C.group.scale.x + (scale - C.group.scale.x) * f)
      // the pointer in the card's terms (−1..1 across it); a big card follows it from a little way off
      const px = (ptr.x - (r.left + r.width / 2)) / (r.width * 0.45), py = -(ptr.y - (r.top + r.height / 2)) / (r.height * 0.5)
      const reach = big ? 2.4 : 1.15, near = Math.abs(px) < reach && Math.abs(py) < reach
      C.hover += ((near && !still ? 1 : 0) - C.hover) * (1 - Math.exp(-dt * 5))
      const cx = THREE.MathUtils.clamp(px, -1.3, 1.3), cy = THREE.MathUtils.clamp(py, -1.3, 1.3)
      const amp = big ? 1 : 0.7, i = HOUSES.indexOf(C.h) * 1.9
      const idleX = still ? 0 : 0.1 * Math.sin(0.53 * t + i), idleY = still ? 0 : (big ? 0.36 : 0.16) * Math.sin(0.37 * t + i)
      const gx = THREE.MathUtils.lerp(idleX, -cy * 0.36 * amp, C.hover), gy = THREE.MathUtils.lerp(idleY, cx * 0.52 * amp, C.hover)
      // a spring, slightly under-damped: the card settles with a little give
      const kS = 34, cS = 2 * Math.sqrt(kS) * 0.72
      C.vel.x += ((gx - C.rot.x) * kS - C.vel.x * cS) * dt; C.vel.y += ((gy - C.rot.y) * kS - C.vel.y * cS) * dt
      C.rot.addScaledVector(C.vel, dt)
      const kF = 20, cF = 2 * Math.sqrt(kF) * 0.8
      C.spinV += ((C.spinTo - C.spin) * kF - C.spinV * cF) * dt; C.spin += C.spinV * dt
      C.flare *= Math.exp(-dt * 1.5); C.bump *= Math.exp(-dt * 3)
      C.pivot.rotation.set(C.rot.x, C.rot.y + C.spin, still ? 0 : Math.sin(0.31 * t + i) * 0.012)
      C.pivot.position.set(0, (still ? 0 : Math.sin(0.8 * t + i) * 0.05) + C.bump * 0.08, C.bump * 0.25)
      // the light follows the pointer when it's near, otherwise wanders over the gold
      const lw = new THREE.Vector3(Math.sin(0.4 * t + i) * 0.8, 0.5 + Math.cos(0.3 * t + i) * 0.3, 0.9)
        .lerp(new THREE.Vector3(cx * 1.15, 0.48 + cy * 0.85, 0.9), C.hover).normalize()
      C.group.updateMatrixWorld(true)
      C.u.light.value.copy(lw).applyQuaternion(C.pivot.getWorldQuaternion(new THREE.Quaternion()).invert())
      C.u.cam.value.copy(C.pivot.worldToLocal(cam.position.clone()))
      C.u.flare.value = C.flare; C.u.fade.value = o; C.edge.opacity = o
      ;(C.shadow.material as THREE.MeshBasicMaterial).opacity = 0.75 * o
      C.shadow.position.set(0.25 - cx * 0.12 * C.hover, -0.35 - cy * 0.1 * C.hover, -1.2)
      ;(C.halo.material as THREE.MeshBasicMaterial).opacity = (0.16 + C.flare * 0.4 + C.hover * 0.06) * o
      if (C.relic) { // only beside a big card: a small one has no room for it
        const R = C.relic; R.root.visible = big
        R.turn += dt * (0.35 + C.flare * 6) // turns slowly, spins up when the general acts
        R.root.rotation.y = -0.55 + Math.sin(R.turn) * 0.45 + (still ? 0 : cx * 0.2 * C.hover)
        R.root.position.y = -CH / 2 - 0.12 + C.bump * 0.25
        for (const m of R.mats) m.opacity = o
      }
      for (const d of C.dust) {
        if (!still) { d.s.position.y += d.v * dt; d.s.position.x += Math.sin(t * 0.6 + d.ph) * 0.003 }
        if (d.s.position.y > 2.6) d.s.position.y = -2.6
        d.s.material.opacity = (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.7 + d.ph)) + C.flare * 0.4) * o * (big ? 1 : 0.5)
      }
    }
    const sEl = shrine && document.querySelector<HTMLElement>('.shrine3 > .slot')
    if (shrine) shrine.group.visible = false
    if (shrine && sEl?.offsetParent) {
      const r = sEl.getBoundingClientRect(), o = opacityOf(sEl)
      if (r.width > 4 && o > 0.01) {
        any = true; shrine.group.visible = true
        const scale = (r.height * k) / CH, tx = (r.left + r.width / 2 - innerWidth / 2) * k, ty = -(r.top + r.height / 2 - innerHeight / 2) * k
        if (!shrine.seen) { shrine.group.position.set(tx, ty, 0); shrine.group.scale.setScalar(scale); shrine.seen = true }
        const f = 1 - Math.exp(-real * 9)
        shrine.group.position.x += (tx - shrine.group.position.x) * f; shrine.group.position.y += (ty - shrine.group.position.y) * f
        shrine.group.scale.setScalar(shrine.group.scale.x + (scale - shrine.group.scale.x) * f)
        // it turns a little toward the pointer, and breathes when left alone
        const px = THREE.MathUtils.clamp((ptr.x - (r.left + r.width / 2)) / innerWidth * 2, -1, 1)
        const goal = still ? -0.35 : -0.35 + px * 0.45 + Math.sin(t * 0.21) * 0.08
        shrine.turn += (goal - shrine.turn) * (1 - Math.exp(-dt * 2.5)); shrine.pivot.rotation.set(0.06, shrine.turn, 0)
        const fl = still ? 1 : 0.85 + 0.1 * Math.sin(t * 13) + 0.07 * Math.sin(t * 7.3 + 1) + 0.05 * Math.sin(t * 23.1)
        shrine.flames.forEach((s, j) => { const w = fl * (1 + 0.08 * Math.sin(t * 17 + j * 2)); s.scale.set(0.09 * w, 0.17 * w, 1); (s.material as THREE.SpriteMaterial).opacity = o })
        shrine.light.intensity = 8 * fl * o
        for (const m of shrine.mats) m.opacity = o
        for (const e of shrine.embers) {
          if (!still) { e.s.position.y += e.v * dt; e.s.position.x += Math.sin(t * 0.8 + e.ph) * 0.002 }
          if (e.s.position.y > 1.7) e.s.position.y = SHRINE_LAMP.y
          e.s.material.opacity = (0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.1 + e.ph))) * o * Math.max(0, 1 - (e.s.position.y - SHRINE_LAMP.y) / 1.5)
        }
      }
    }
    if (any || drawn) renderer.render(scene, cam) // one more frame after the last card leaves, to clear it
    drawn = any
    if (any) document.body.classList.add('holo-live')
  }
  requestAnimationFrame(tick)
}
