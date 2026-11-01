// The 2.5D painted diorama: terrain you can orbit, painted backdrops, one grey sprite per unit type tinted per house
// in a TSL shader. Uses art/*.webp when present (npm run assets), code-drawn placeholders otherwise.
import * as THREE from 'three/webgpu'
import { texture, uv, vec3, dot, mix, smoothstep, instancedBufferAttribute, float, attribute } from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mapSvg, RIVER } from './mapsvg.ts'

export interface Snap {
  t: number
  squads: { id: string; house: string; type: string; x: number; y: number; str: number; flags: number }[]
  couriers: { id: string; house: string; kind: string; x: number; y: number; path: { x: number; y: number }[] }[]
  flashes: { type: string; x: number; y: number; age: number }[]
  smokes: { x: number; y: number; age: number }[] // smoke signals lit at a camp, age 0→1
  ghosts: { house: string; type: string; x: number; y: number; tx: number; ty: number }[] // belief view: where a general thinks units are
  shot: { x: number; y: number } | null // the camera director's pick, used when nobody is driving
}

const HOUSE: Record<string, THREE.Color> = { rhino: new THREE.Color('#34418f'), kite: new THREE.Color('#b3242f'), orchid: new THREE.Color('#b13f9a'), tiger: new THREE.Color('#e3a812') }
const SIZE: Record<string, number> = { inf: 40, arch: 40, cav: 50, ele: 76, harkara: 30 }
// full-strength formation per unit type: soldiers, columns, spacing (paces)
const FORM: Record<string, [number, number, number]> = { inf: [25, 5, 12], arch: [25, 5, 12], cav: [12, 4, 19], ele: [4, 2, 38] }
const PER_SQUAD = 25

export async function createDiorama(host: HTMLElement, init: any) {
  const art: Record<string, { w: number; h: number }> = await fetch('art/art.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}))
  const loader = new THREE.TextureLoader()
  const tex = async (name: string, fallback: () => HTMLCanvasElement | Promise<HTMLCanvasElement | HTMLImageElement>) => {
    const t = art[name] ? await loader.loadAsync(`art/${name}.webp`) : new THREE.Texture(await fallback())
    t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.anisotropy = 4
    return t
  }

  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()
  // ---- height field: river channel, hills at the misty places, camps flat
  const hills = init.map.nodes.filter((n: any) => n.mist)
  const height = (x: number, y: number) => {
    let h = 0
    for (const n of hills) h += 50 * Math.exp(-((x - n.x) ** 2 + (y - n.y) ** 2) / (2 * 115 ** 2))
    const river = Math.abs(y - 500)
    if (river < 60) h = h * (river / 60) - 8 * (1 - river / 60)
    return h
  }
  // beyond the map the valley walls rise into ridges, low where the river runs out east and west
  const outer = (x: number, y: number) => {
    const cx = Math.min(1000, Math.max(0, x)), cy = Math.min(1000, Math.max(0, y)), d = Math.hypot(x - cx, y - cy)
    if (!d) return height(x, y) - 4 // under the board
    const r = Math.abs(y - 500), open = THREE.MathUtils.smoothstep(r, 70, 340)
    const wall = Math.min(420, d * 0.55) * (0.25 + 0.75 * open) + 30 * Math.sin(x * 0.013) * Math.cos(y * 0.011) * Math.min(1, d / 90)
    // the river keeps going: its channel is carved in gradually with distance, so the map's edge meets the valley without a step
    const bank = THREE.MathUtils.smoothstep(r, 30, 150 + d * 0.3), carve = (1 - bank) * THREE.MathUtils.smoothstep(d, 0, 140)
    return THREE.MathUtils.lerp(height(cx, cy), -8, carve) + wall * bank
  }
  const W = (x: number, y: number, lift = 0) => new THREE.Vector3(x - 500, height(x, y) + lift, y - 500)

  const renderer = new THREE.WebGPURenderer({ antialias: true })
  await renderer.init()
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog('#e6e8df', 1500, 3600)
  const camera = new THREE.PerspectiveCamera(34, 1, 5, 6000)
  camera.position.set(0, 1050, 1250)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 40)
  Object.assign(controls, { enableDamping: true, minPolarAngle: 0.35, maxPolarAngle: 1.05, minAzimuthAngle: -0.7, maxAzimuthAngle: 0.7, minDistance: 150, maxDistance: 1700 })

  scene.add(new THREE.HemisphereLight('#f4efe2', '#2e3550', 1.6))
  const sun = new THREE.DirectionalLight('#fff6e0', 2.2); sun.position.set(-600, 900, -300); scene.add(sun)

  // sky + painted hill backdrops (north side; the camera stays south so they always read)
  scene.background = art['sky-dawn'] ? await tex('sky-dawn', () => document.createElement('canvas')) : new THREE.Color('#dfe5df')
  for (const [name, z, w, y] of [['hills-far', -2500, 7600, 300], ['hills-mid', -2000, 5600, 260]] as const) {
    if (!art[name]) continue
    const t = await tex(name, () => document.createElement('canvas'))
    const bm = new THREE.MeshBasicNodeMaterial({ transparent: true, fog: false })
    bm.colorNode = texture(t, uv()).rgb
    bm.opacityNode = texture(t, uv()).a.mul(smoothstep(0, 0.18, uv().y)) // feather the cut-off bottom edge into the field
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * art[name].h) / art[name].w), bm)
    m.position.set(0, (w * art[name].h) / art[name].w / 2 - 30 + y, z); scene.add(m) // stand on the field
  }

  // terrain
  const svgImg = () => new Promise<HTMLImageElement>(res => { const i = new Image(); i.onload = () => res(i); i.src = URL.createObjectURL(new Blob([mapSvg('paint', 2048)], { type: 'image/svg+xml' })) })
  const ground = new THREE.PlaneGeometry(1000, 1000, 160, 160)
  ground.rotateX(-Math.PI / 2)
  const gp = ground.attributes.position
  for (let i = 0; i < gp.count; i++) gp.setY(i, height(gp.getX(i) + 500, gp.getZ(i) + 500))
  ground.computeVertexNormals()
  // until batch 4's painted map exists, paint the plan with the batch-1 tiles
  const tiled = async () => {
    const [grass, path, sand, water] = await Promise.all(['tex-grass', 'tex-path', 'tex-sand', 'tex-water'].map(n => loader.loadAsync(`art/${n}.webp`).then(t => t.image)))
    const c = document.createElement('canvas'); c.width = c.height = 2048
    const g = c.getContext('2d')!; g.scale(2.048, 2.048)
    const pat = (im: any, k: number) => { const p = g.createPattern(im, 'repeat')!; p.setTransform(new DOMMatrix().scale(k)); return p }
    g.fillStyle = pat(grass, 0.3); g.fillRect(0, 0, 1000, 1000)
    for (const n of hills) { const r = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, 170); r.addColorStop(0, 'rgba(28,58,40,.5)'); r.addColorStop(1, 'rgba(28,58,40,0)'); g.fillStyle = r; g.fillRect(n.x - 170, n.y - 170, 340, 340) }
    const river = new Path2D(RIVER)
    // sand banks stop short of the map edge so the river meets the valley's water without a square corner
    // sand banks fade out toward the map's east and west edges (drawn on a layer, then masked by a horizontal gradient)
    const sc = document.createElement('canvas'); sc.width = sc.height = 2048
    const sg = sc.getContext('2d')!; sg.scale(2.048, 2.048)
    const sp = sg.createPattern(sand, 'repeat')!; sp.setTransform(new DOMMatrix().scale(0.25)); sg.lineWidth = 34; sg.strokeStyle = sp; sg.stroke(river)
    const fade = sg.createLinearGradient(0, 0, 1000, 0); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.12, '#000'); fade.addColorStop(0.88, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)')
    sg.globalCompositeOperation = 'destination-in'; sg.fillStyle = fade; sg.fillRect(0, 0, 1000, 1000)
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(sc, 0, 0); g.restore()
    g.fillStyle = pat(water, 0.3); g.fill(river)
    const at = new Map(init.map.nodes.map((n: any) => [n.id, n]))
    // painted light: big soft warm and cool patches so the grass isn't one even noise
    for (let i = 0; i < 26; i++) { const x = rnd() * 1000, y = rnd() * 1000, r = 90 + rnd() * 160, r2 = g.createRadialGradient(x, y, 0, x, y, r), warm = i % 2; r2.addColorStop(0, warm ? 'rgba(232,206,120,.22)' : 'rgba(20,48,40,.25)'); r2.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r2; g.fillRect(x - r, y - r, 2 * r, 2 * r) }
    // ochre dirt roads: a wide faint pass then a narrower one, so edges feather into the grass
    g.filter = 'saturate(40%) brightness(1.08)'; g.lineCap = 'round'; g.strokeStyle = pat(path, 0.2)
    for (const [w, a] of [[2.2, 0.3], [1, 0.75]]) {
      g.globalAlpha = a
      for (const e of init.map.edges) if (e.kind === 'road' || e.kind === 'hill') { const p: any = at.get(e.a), q: any = at.get(e.b); g.lineWidth = (e.kind === 'road' ? 9 : 5) * w; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke() }
    }
    // camps and villages: trodden ground with ragged edges, not disks
    g.fillStyle = pat(path, 0.2)
    for (const n of init.map.nodes) if (n.id.endsWith('-camp') || n.id.endsWith('village')) for (let i = 0; i < 22; i++) { const R0 = n.id.endsWith('-camp') ? 44 : 28, a = rnd() * 6.28, d = rnd() * R0 * 0.7; g.globalAlpha = 0.25; g.beginPath(); g.arc(n.x + Math.cos(a) * d, n.y + Math.sin(a) * d, R0 * (0.35 + rnd() * 0.4), 0, 7); g.fill() }
    g.globalAlpha = 1; g.filter = 'none'
    return c
  }
  const gtex = await tex('map-painted', art['tex-grass'] ? tiled : svgImg)
  const guv = ground.attributes.uv
  for (let i = 0; i < guv.count; i++) { guv.setX(i, (gp.getX(i) + 500) / 1000); guv.setY(i, 1 - (gp.getZ(i) + 500) / 1000) }
  gtex.wrapS = gtex.wrapT = THREE.MirroredRepeatWrapping // the valley just outside continues the map's painting, mirrored
  scene.add(new THREE.Mesh(ground, new THREE.MeshStandardNodeMaterial({ map: gtex, roughness: 1 })))
  // the valley around the map: ridges shaded darker and cooler with height, the river running out between them
  if (art['tex-grass']) {
    const gt = await tex('tex-grass', () => document.createElement('canvas')); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(26, 26)
    const vg = new THREE.PlaneGeometry(5200, 5200, 200, 200); vg.rotateX(-Math.PI / 2)
    const vp = vg.attributes.position, vuv = vg.attributes.uv, col = new Float32Array(vp.count * 3), blend = new Float32Array(vp.count)
    const low = new THREE.Color('#d9dcc0'), high = new THREE.Color('#5d7a6a'), cc = new THREE.Color()
    for (let i = 0; i < vp.count; i++) {
      const x = vp.getX(i) + 500, y = vp.getZ(i) + 500, h = outer(x, y), d = Math.hypot(x - Math.min(1000, Math.max(0, x)), y - Math.min(1000, Math.max(0, y)))
      vp.setY(i, h); vuv.setXY(i, x / 1000, 1 - y / 1000)
      cc.copy(low).lerp(high, Math.min(1, Math.max(0, h / 380))).toArray(col, i * 3)
      blend[i] = THREE.MathUtils.smoothstep(d, 30, 230) // 0 at the map edge (its own painting), 1 out on the ridges (grass tiles)
    }
    vg.setAttribute('color', new THREE.BufferAttribute(col, 3)); vg.setAttribute('blend', new THREE.BufferAttribute(blend, 1)); vg.computeVertexNormals()
    const vm = new THREE.MeshStandardNodeMaterial({ roughness: 1 })
    vm.colorNode = mix(texture(gtex, uv()).rgb, texture(gt, uv().mul(5)).rgb.mul(attribute('color', 'vec3')), attribute('blend', 'float'))
    scene.add(new THREE.Mesh(vg, vm))
  }

  // ---- sprite batches: one InstancedMesh per sprite, tinted per instance, billboarded on the CPU each frame
  const placeholder = (draw: (g: CanvasRenderingContext2D) => void) => () => { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')!); return c }
  const figure = (extra?: (g: CanvasRenderingContext2D) => void) => placeholder(g => {
    g.fillStyle = '#555'; g.beginPath(); g.arc(64, 26, 13, 0, 7); g.fill()
    g.fillStyle = '#eee'; g.strokeStyle = '#222'; g.lineWidth = 4; g.beginPath(); g.moveTo(44, 44); g.lineTo(84, 44); g.lineTo(90, 110); g.lineTo(38, 110); g.closePath(); g.fill(); g.stroke()
    g.fillStyle = '#444'; g.fillRect(46, 110, 10, 16); g.fillRect(72, 110, 10, 16); extra?.(g)
  })
  const SPRITES: Record<string, [string, () => HTMLCanvasElement]> = {
    inf: ['unit-infantry', figure(g => { g.fillStyle = '#6b5a45'; g.fillRect(88, 6, 5, 118); g.fillStyle = '#bbb'; g.fillRect(24, 50, 22, 50) })],
    arch: ['unit-archer', figure(g => { g.strokeStyle = '#6b5a45'; g.lineWidth = 5; g.beginPath(); g.arc(70, 70, 46, -1.2, 1.2); g.stroke() })],
    cav: ['unit-cavalry', placeholder(g => { g.fillStyle = '#666'; g.beginPath(); g.ellipse(64, 84, 46, 20, 0, 0, 7); g.fill(); g.fillRect(28, 96, 8, 30); g.fillRect(92, 96, 8, 30); g.fillRect(100, 56, 14, 32); g.fillStyle = '#eee'; g.strokeStyle = '#222'; g.lineWidth = 3; g.fillRect(50, 34, 26, 40); g.strokeRect(50, 34, 26, 40); g.fillStyle = '#555'; g.beginPath(); g.arc(63, 24, 10, 0, 7); g.fill() })],
    ele: ['unit-elephant', placeholder(g => { g.fillStyle = '#777'; g.beginPath(); g.ellipse(60, 70, 50, 34, 0, 0, 7); g.fill(); g.fillRect(18, 88, 16, 38); g.fillRect(80, 88, 16, 38); g.beginPath(); g.ellipse(106, 62, 18, 22, 0, 0, 7); g.fill(); g.fillRect(112, 70, 9, 46); g.fillStyle = '#eee'; g.fillRect(30, 30, 56, 18) })],
    harkara: ['unit-harkara', figure(g => { g.strokeStyle = '#6b5a45'; g.lineWidth = 6; g.beginPath(); g.moveTo(40, 50); g.lineTo(88, 100); g.stroke() })],
  }
  const tintAttr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)
  async function batch(name: string, fallback: () => HTMLCanvasElement, count: number, opts: { tinted: boolean; opacity?: number; solid?: boolean }, t?: THREE.Texture) {
    t ??= await tex(name, fallback)
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0)
    const tint = tintAttr(count)
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: !opts.opacity })
    const s = texture(t, uv())
    if (opts.solid) mat.colorNode = vec3(1, 1, 1).mul(instancedBufferAttribute(tint)) // a flat house-colour silhouette (emblems)
    else if (opts.tinted) {
      // near-white cloth takes the house colour; skin, wood and metal stay as painted
      // the whole figure takes the house colour, keeping the painted light and line (reads at broadcast distance)
      // tint the cloth and mid-tones, keep the painted darks (line work, shading) as they are
      const lum = dot(s.rgb, vec3(0.3, 0.59, 0.11))
      mat.colorNode = mix(s.rgb, lum.mul(1.5).add(0.12).mul(instancedBufferAttribute(tint)), smoothstep(0.06, 0.4, lum).mul(0.82))
    } else mat.colorNode = s.rgb
    mat.opacityNode = s.a.mul(float(opts.opacity ?? 1))
    mat.alphaTest = opts.opacity ? 0.05 : 0.35
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    mesh.count = 0; mesh.frustumCulled = false
    scene.add(mesh)
    const aspect = art[name] ? art[name].w / art[name].h : 1
    return { mesh, tint, aspect, t }
  }

  const units: Record<string, Awaited<ReturnType<typeof batch>>> = {}
  for (const [k, [name, fb]] of Object.entries(SPRITES)) units[k] = await batch(name, fb, k === 'harkara' ? 80 : init.squads.length * PER_SQUAD, { tinted: true })
  // a house pennant over each squad, dust behind riders, smoke columns for signals (art only; no placeholders)
  const none = placeholder(() => {})
  const banners: Record<string, Awaited<ReturnType<typeof batch>>> = {}
  const outlines: Record<string, Awaited<ReturnType<typeof batch>>> = {}
  for (const hh of Object.keys(HOUSE)) if (art[`emblem-${hh}`]) {
    outlines[hh] = await batch(`emblem-${hh}`, none, init.squads.length, { tinted: true }) // drawn first, larger and near-black: the outline
    banners[hh] = await batch(`emblem-${hh}`, none, init.squads.length, { tinted: true, solid: true }, outlines[hh].t)
    banners[hh].aspect = outlines[hh].aspect
    outlines[hh].mesh.renderOrder = 1; banners[hh].mesh.renderOrder = 2 // outline under the emblem at the same spot
    ;(outlines[hh].mesh.material as THREE.Material).depthWrite = false
  }
  // soft contact shadows, flat on the ground, one per soldier
  const shTex = new THREE.CanvasTexture(placeholder(g => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(20,24,16,.55)'); r.addColorStop(1, 'rgba(20,24,16,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128) })())
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({ map: shTex, transparent: true, depthWrite: false }), init.squads.length * PER_SQUAD)
  shadows.frustumCulled = false; scene.add(shadows)
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
  const flag = art['flag-pennant'] ? await batch('flag-pennant', none, init.squads.length, { tinted: true }) : null
  const dust = art['dust-puff'] ? await batch('dust-puff', none, 80, { tinted: false, opacity: 0.55 }) : null
  const smoke = art['smoke-column'] ? await batch('smoke-column', none, 4, { tinted: false, opacity: 0.85 }) : null
  // ghosts: the same sprites, faded and greyed, one per squad, with a dotted ink line to the truth
  const ghostB: Record<string, Awaited<ReturnType<typeof batch>>> = {}
  for (const k of ['inf', 'arch', 'cav', 'ele']) ghostB[k] = await batch('', SPRITES[k][1], init.squads.length, { tinted: true, opacity: 0.45 }, units[k].t)
  for (const k in ghostB) ghostB[k].aspect = units[k].aspect
  const dots = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicNodeMaterial({ color: '#1e1c1a', transparent: true, opacity: 0.55 }))
  dots.frustumCulled = false; scene.add(dots)

  // props: trees on the hills, huts at the villages, a ferry, rocks
  const propPlaces: Record<string, { x: number; y: number; s: number }[]> = { pine: [], bamboo: [], hut: [], ferry: [], rock: [], areca: [], ford: [], rootbridge: [] }
  for (const n of hills) for (let i = 0; i < 16; i++) { const a = rnd() * 6.28, r = 40 + rnd() * 120; propPlaces[i % 3 ? 'pine' : 'bamboo'].push({ x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r, s: 26 + rnd() * 18 }) }
  for (const n of init.map.nodes.filter((n: any) => n.id.endsWith('village'))) for (const [dx, dy] of [[-20, -10], [15, -14], [0, 12], [24, 10]]) propPlaces.hut.push({ x: n.x + dx, y: n.y + dy, s: 22 })
  const fer = init.map.nodes.find((n: any) => n.id === 'ferry'); propPlaces.ferry.push({ x: fer.x, y: fer.y, s: 24 })
  for (const n of init.map.nodes.filter((n: any) => n.id.endsWith('village'))) for (let i = 0; i < 4; i++) { const a = rnd() * 6.28; propPlaces.areca.push({ x: n.x + Math.cos(a) * (55 + rnd() * 30), y: n.y + Math.sin(a) * (40 + rnd() * 20), s: 44 + rnd() * 14 }) }
  for (let i = 0; i < 14; i++) propPlaces.areca.push({ x: 80 + rnd() * 840, y: rnd() < 0.5 ? 250 + rnd() * 110 : 640 + rnd() * 110, s: 40 + rnd() * 14 })
  for (const f of init.map.fords) { const n = init.map.nodes.find((m: any) => m.id === f); propPlaces.ford.push({ x: n.x, y: n.y, s: 26 }) }
  for (const id of ['gorge', 'sw-hill']) { const n = init.map.nodes.find((m: any) => m.id === id); propPlaces.rootbridge.push({ x: n.x + 20, y: n.y + 60, s: 60 }) }
  // rocks and bamboo where the river leaves the map, so the painted edge never shows as a line
  for (const ex of [6, 994]) for (const ey of [452, 470, 530, 548]) { propPlaces.rock.push({ x: ex + (rnd() - 0.5) * 20, y: ey, s: 14 + rnd() * 10 }); propPlaces.bamboo.push({ x: ex + (rnd() - 0.5) * 30, y: ey + (ey < 500 ? -18 : 18), s: 40 + rnd() * 16 }) }
  for (let i = 0; i < 18; i++) propPlaces.rock.push({ x: 60 + rnd() * 880, y: rnd() < 0.5 ? 380 - rnd() * 300 : 620 + rnd() * 300, s: 8 + rnd() * 8 })
  if (art['map-painted']) for (const k of ['hut', 'ford', 'ferry']) propPlaces[k] = [] // the painting already has these
  const PROP_FB: Record<string, () => HTMLCanvasElement> = {
    pine: placeholder(g => { g.fillStyle = '#4e7a5a'; g.beginPath(); g.moveTo(64, 4); g.lineTo(104, 112); g.lineTo(24, 112); g.closePath(); g.fill(); g.fillStyle = '#5a4630'; g.fillRect(58, 110, 12, 18) }),
    bamboo: placeholder(g => { g.strokeStyle = '#8daa6b'; g.lineWidth = 7; for (const x of [44, 58, 72, 86]) { g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x - 10, 60, x + 8, 6); g.stroke() } }),
    hut: placeholder(g => { g.fillStyle = '#8a6a4a'; g.fillRect(30, 60, 68, 40); g.fillStyle = '#c8a86a'; g.beginPath(); g.moveTo(18, 64); g.lineTo(64, 20); g.lineTo(110, 64); g.fill(); g.fillStyle = '#5a4630'; for (const x of [34, 60, 88]) g.fillRect(x, 100, 6, 28) }),
    ferry: placeholder(g => { g.fillStyle = '#7a5a3a'; g.fillRect(10, 84, 108, 22); g.strokeStyle = '#5a4630'; g.lineWidth = 4; g.beginPath(); g.moveTo(14, 80); g.lineTo(120, 60); g.stroke() }),
    rock: placeholder(g => { g.fillStyle = '#7e8c78'; g.beginPath(); g.ellipse(64, 96, 50, 30, 0, 0, 7); g.fill() }),
  }
  const props: { b: Awaited<ReturnType<typeof batch>>; at: { x: number; y: number; s: number }[] }[] = []
  for (const [k, at] of Object.entries(propPlaces)) { if (!at.length || (!PROP_FB[k] && !art[`prop-${k}`])) continue; const b = await batch(`prop-${k}`, PROP_FB[k] ?? placeholder(() => {}), at.length, { tinted: false }); b.mesh.count = at.length; props.push({ b, at }) }

  // mist: soft cards drifting over the misty places
  const mistTex = new THREE.CanvasTexture(placeholder(g => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,.75)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128) })())
  const mistMat = new THREE.MeshBasicNodeMaterial({ map: mistTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0.06 }) // no depth test: cards cut hard rims where they cross the hills
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mistMat, hills.length * 4)
  mist.frustumCulled = false; scene.add(mist)
  const mistAt = hills.flatMap((n: any) => [0, 1, 2, 3].map(i => ({ x: n.x + (i - 1.5) * 50, y: n.y + ((i * 37) % 60) - 30, s: 220 + i * 30, ph: i * 1.7 })))

  // couriers' ink routes + flash rings
  const routes = new Map<string, THREE.Line>()
  const ringGeo = new THREE.RingGeometry(0.7, 1, 48); ringGeo.rotateX(-Math.PI / 2)
  const rings = Array.from({ length: 24 }, () => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false, color: '#c0392b' })); m.visible = false; scene.add(m); return m })

  const labels: { sp: THREE.Sprite; x: number; y: number; at: THREE.Vector3; aside: THREE.Vector3 }[] = []
  // place names on the ground, so the feed's EAST FORD etc. can be found on the map
  for (const n of init.map.nodes.filter((n: any) => /^F\d$|^ferry$|village$|camp$|^gorge$/.test(n.id))) {
    const c = document.createElement('canvas'), g = c.getContext('2d')!, f = '600 30px "Iowan Old Style", Palatino, Georgia, serif'
    g.font = f; c.width = Math.ceil(g.measureText(n.name).width) + 24; c.height = 44
    g.font = f; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'
    g.lineWidth = 7; g.strokeStyle = 'rgba(242,233,216,.92)'; g.strokeText(n.name, c.width / 2, 22); g.fillStyle = '#2e2418'; g.fillText(n.name, c.width / 2, 22)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    const sp = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }))
    const ford = /^F|ferry/.test(n.id); sp.position.copy(W(n.x, n.y + (ford ? 52 : 34), 6)); sp.scale.set(c.width * 0.36, 44 * 0.36, 1); sp.renderOrder = 3
    scene.add(sp); labels.push({ sp, x: n.x, y: n.y + (ford ? 52 : 34), at: sp.position.clone(), aside: W(n.x, n.y + (ford ? 52 : 34) + 70, 6) })
  }

  // ---- per frame
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  const lastX = new Map<string, number>(), facing = new Map<string, number>()
  let lastTime = 0
  const camps: Record<string, { x: number; y: number }> = Object.fromEntries(Object.keys(HOUSE).map(h => [h, init.map.nodes.find((n: any) => n.id === `${h}-camp`)]))
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, w: number, h: number, yaw: number, lean = 0, lift = 0) => {
    P.copy(W(x, y, lift)); Q.setFromAxisAngle(up, yaw)
    if (lean) Q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean))
    S.set(w, h, 1); M.compose(P, Q, S); mesh.setMatrixAt(i, M)
  }

  // ---- camera: the director drives unless the viewer has touched it in the last 20 s; following a rider overrides both
  const OVER = { t: new THREE.Vector3(0, 0, -20), r: 1500, polar: 1.0, az: 0 } // low enough to see the painted horizon
  const want = { t: OVER.t.clone(), r: OVER.r, polar: OVER.polar, az: OVER.az }
  const sph = new THREE.Spherical()
  let userAt = -1e9, follow: { id: string; seen: boolean; goneAt: number } | null = null, riderIds: string[] = []
  const status = document.createElement('div')
  status.style.cssText = 'position:absolute;left:12px;bottom:12px;background:#fff8ecd9;border-radius:6px;padding:4px 10px;font-size:12px;pointer-events:none'
  host.append(status)
  controls.addEventListener('start', () => { userAt = performance.now(); follow = null })
  // click a rider to ride with it (a click, not a drag)
  const ray = new THREE.Raycaster(), down = { x: 0, y: 0 }
  renderer.domElement.addEventListener('pointerdown', e => Object.assign(down, { x: e.clientX, y: e.clientY }))
  renderer.domElement.addEventListener('pointerup', e => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
    const r = renderer.domElement.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
    const hit = ray.intersectObject(units.harkara.mesh)[0]
    if (hit?.instanceId != null && riderIds[hit.instanceId]) follow = { id: riderIds[hit.instanceId], seen: true, goneAt: 0 }
  })
  function steer(s: Snap, dt: number) {
    const now = performance.now(), idle = now - userAt > 20000
    let label = idle ? 'Camera: director' : `Camera: yours (director back in ${Math.ceil((20000 - (now - userAt)) / 1000)} s)`
    const c = follow && s.couriers.find(c => c.id === follow!.id)
    if (follow) {
      if (c) { follow.seen = true; follow.goneAt = 0 } else if (follow.seen && !follow.goneAt) follow.goneAt = now
      if (follow.goneAt && now - follow.goneAt > 2500) follow = null
    }
    let k = 2
    if (follow && c) {
      // ride behind the courier, low, staying on the south side so the backdrops still read
      const ahead = c.path[0] ?? c, dx = ahead.x - c.x, dy = ahead.y - c.y
      want.t.copy(W(c.x, c.y, 10)); want.r = 170; want.polar = 1.02
      if (Math.hypot(dx, dy) > 1) want.az = THREE.MathUtils.clamp(Math.atan2(-dx, -dy), -0.7, 0.7)
      k = 4; label = 'Following a rider · drag to let go'
    } else if (follow) label = follow.seen ? 'The ride is over' : 'Waiting for the rider to leave camp'
    else if (!idle) return label
    else if (s.shot) { want.t.copy(W(s.shot.x, s.shot.y)); want.r = 720; want.polar = 0.86 }
    else Object.assign(want, { t: want.t.copy(OVER.t), r: OVER.r, polar: OVER.polar, az: OVER.az })
    const e = 1 - Math.exp(-dt * k)
    sph.setFromVector3(P.copy(camera.position).sub(controls.target))
    controls.target.lerp(want.t, e)
    sph.radius += (want.r - sph.radius) * e; sph.phi += (want.polar - sph.phi) * e; sph.theta += (want.az - sph.theta) * e
    camera.position.setFromSpherical(sph).add(controls.target)
    return label
  }

  let panelPx = 0
  function resize() {
    const r = host.getBoundingClientRect(), pad = Number(getComputedStyle(host).getPropertyValue('--panel').replace('px', '')) || 0
    panelPx = pad; renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height
    camera.setViewOffset(r.width, r.height, pad * 0.8, 0, r.width, r.height) // centre the picture in the space left of the overlay panel
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize); resize()

  return {
    canvas: renderer.domElement,
    follow(id: string | null) { follow = id ? { id, seen: false, goneAt: 0 } : null },
    render(s: Snap, time: number) {
      const dt = Math.min(0.1, time - (lastTime || time)); lastTime = time
      status.textContent = steer(s, dt) ?? ''
      controls.update()
      const yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z)
      // soldiers in loose 3×3 blocks, fewer as the squad loses strength
      const n: Record<string, number> = { inf: 0, arch: 0, cav: 0, ele: 0 }
      let fl = 0, sh = 0
      const standards: { x: number; y: number; house: string }[] = []
      const bn: Record<string, number> = { rhino: 0, kite: 0, orchid: 0, tiger: 0 }
      // squads in contact are drawn a little apart so the front line between two houses stays visible
      const shown = s.squads.map(q => ({ ...q }))
      for (const a of shown) for (const b of s.squads) {
        if (a.house === b.house || (a.flags & 2) || (b.flags & 2)) continue
        let dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy)
        if (d < 1) { const home = camps[a.house]; dx = home.x - a.x; dy = home.y - a.y; d = 0; const k = Math.hypot(dx, dy) || 1; dx /= k; dy /= k } // same spot: each steps back toward its own camp
        else { dx /= d; dy /= d }
        if (d < 130) { a.x += dx * (130 - d) * 0.5; a.y += dy * (130 - d) * 0.5 } // about half a block of open ground between fronts
      }
      for (const q of shown) {
        if (q.flags & 2) continue
        const b = units[q.type], prev = lastX.get(q.id) ?? q.x, moving = Math.abs(q.x - prev) > 0.01
        if (moving) facing.set(q.id, q.x > prev ? 1 : -1)
        lastX.set(q.id, q.x)
        const [full, cols, sp] = FORM[q.type], flip = facing.get(q.id) ?? 1, count = Math.max(1, Math.ceil((q.str / 100) * full)), rows = Math.ceil(full / cols)
        const c = HOUSE[q.house], routed = q.flags & 1, spread = routed ? 1.9 : 1 // rout reads as a broken formation, never as a paler house
        for (let k = 0; k < count; k++) {
          const gx = ((k % cols) - (cols - 1) / 2) * spread, gy = (Math.floor(k / cols) - (rows - 1) / 2) * spread
          const jx = ((k * 37) % 7) - 3, jy = ((k * 53) % 5) - 2 // fixed jitter so blocks don't look gridded
          const bob = moving ? Math.abs(Math.sin(time * 9 + k * 1.3)) * 1.6 : 0
          const hgt = SIZE[q.type] * (0.94 + ((k * 29) % 7) / 50), x = q.x + gx * sp + (gy % 2) * sp * 0.4 + jx, y = q.y + gy * sp * 0.75 + jy
          place(b.mesh, n[q.type], x, y, hgt * b.aspect * flip, hgt, yaw, moving ? -0.08 * flip : 0, bob)
          P.copy(W(x, y, 0.8)); S.set(hgt * 0.9, hgt * 0.45, 1); M.compose(P, flat, S); shadows.setMatrixAt(sh++, M)
          b.tint.setXYZ(n[q.type]++, c.r, c.g, c.b)
        }
        // the squad's standard: a pennant pole carrying the house emblem on top, outlined in ink
        const fh = (q.type === 'ele' ? 96 : 72) * (routed ? 0.6 : 1), fx = q.x - 6, fy = q.y - rows * sp * 0.35
        if (flag) { place(flag.mesh, fl, fx, fy, fh * flag.aspect * flip, fh, yaw); flag.tint.setXYZ(fl++, c.r, c.g, c.b) }
        const bb = banners[q.house], ob = outlines[q.house]
        // one emblem per house per spot; other houses' emblems at the same spot step aside
        const near = standards.filter(o => Math.hypot(o.x - q.x, o.y - q.y) < 40)
        if (bb && !near.some(o => o.house === q.house)) {
          standards.push({ x: q.x, y: q.y, house: q.house })
          const bh = 22, px = fx - 0.42 * fh * (flag?.aspect ?? 0) * flip + near.length * 46, lift = fh - 4 + Math.sin(time * 1.5 + fl) * 1.5
          place(ob.mesh, bn[q.house], px, fy, bh * 1.12 * bb.aspect, bh * 1.12, yaw, 0, lift - bh * 0.06); ob.tint.setXYZ(bn[q.house], 0.02, 0.02, 0.02)
          place(bb.mesh, bn[q.house], px, fy, bh * bb.aspect, bh, yaw, 0, lift); const bc = c; bb.tint.setXYZ(bn[q.house]++, bc.r, bc.g, bc.b)
        }
      }
      shadows.count = sh; shadows.instanceMatrix.needsUpdate = true
      for (const [hh, bb] of Object.entries(banners)) for (const m of [bb, outlines[hh]]) { m.mesh.count = bn[hh]; m.mesh.instanceMatrix.needsUpdate = true; m.tint.needsUpdate = true }
      if (flag) { flag.mesh.count = fl; flag.mesh.instanceMatrix.needsUpdate = true; flag.tint.needsUpdate = true }
      for (const [k, b] of Object.entries(units)) if (k !== 'harkara') { b.mesh.count = n[k]; b.mesh.instanceMatrix.needsUpdate = true; b.tint.needsUpdate = true }
      // couriers: a runner and a line of ink ahead of it
      const h = units.harkara, live = new Set<string>()
      s.couriers.slice(0, 80).forEach((c, i) => {
        const prev = lastX.get(c.id) ?? c.x; lastX.set(c.id, c.x)
        const flip = c.x >= prev ? 1 : -1
        place(h.mesh, i, c.x, c.y, SIZE.harkara * h.aspect * flip * (c.kind === 'report' ? 0.8 : 1), SIZE.harkara * (c.kind === 'report' ? 0.8 : 1), yaw, -0.15 * flip, Math.abs(Math.sin(time * 14 + i)) * 2)
        const col = HOUSE[c.house]; h.tint.setXYZ(i, col.r, col.g, col.b)
        if (dust) place(dust.mesh, i, c.x - flip * 10, c.y + 1, 16 * dust.aspect * flip * (0.8 + 0.3 * Math.abs(Math.sin(time * 5 + i))), 16, yaw)
        if (c.kind === 'report') return
        live.add(c.id)
        let line = routes.get(c.id)
        if (!line) { line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicNodeMaterial({ color: col, transparent: true, opacity: 0.8 })); routes.set(c.id, line); scene.add(line) }
        const pts: THREE.Vector3[] = []
        let ax = c.x, ay = c.y
        for (const p of c.path) { const d = Math.hypot(p.x - ax, p.y - ay), steps = Math.max(1, Math.ceil(d / 15)); for (let j = 0; j <= steps; j++) pts.push(W(ax + ((p.x - ax) * j) / steps, ay + ((p.y - ay) * j) / steps, 1.5)); ax = p.x; ay = p.y }
        line.geometry.setFromPoints(pts.length > 1 ? pts : [W(c.x, c.y, 1.5), W(c.x, c.y, 1.5)])
      })
      riderIds = s.couriers.slice(0, 80).map(c => c.id)
      if (dust) { dust.mesh.count = Math.min(80, s.couriers.length); dust.mesh.instanceMatrix.needsUpdate = true }
      if (smoke) { s.smokes.slice(0, 4).forEach((m, i) => { const sh = 90 + m.age * 70; place(smoke.mesh, i, m.x + 30, m.y - 30, sh * smoke.aspect, sh, yaw) }); smoke.mesh.count = Math.min(4, s.smokes.length); smoke.mesh.instanceMatrix.needsUpdate = true }
      h.mesh.count = Math.min(80, s.couriers.length); h.mesh.instanceMatrix.needsUpdate = true; h.tint.needsUpdate = true
      for (const [id, l] of routes) if (!live.has(id)) { scene.remove(l); l.geometry.dispose(); routes.delete(id) }
      // belief ghosts + dotted lines to where the unit really is
      const gn: Record<string, number> = { inf: 0, arch: 0, cav: 0, ele: 0 }, seg: THREE.Vector3[] = []
      const grey = new THREE.Color('#9a958c')
      for (const g of s.ghosts) {
        const b = ghostB[g.type], c = HOUSE[g.house].clone().lerp(grey, 0.5), hgt = SIZE[g.type] * 1.1
        place(b.mesh, gn[g.type], g.x, g.y, hgt * b.aspect, hgt, yaw, 0, 4)
        b.tint.setXYZ(gn[g.type]++, c.r, c.g, c.b)
        const d = Math.hypot(g.tx - g.x, g.ty - g.y), n = Math.floor(d / 14)
        for (let j = 0; j < n; j++) { const a = j / n, z = (j + 0.5) / n; seg.push(W(g.x + (g.tx - g.x) * a, g.y + (g.ty - g.y) * a, 3), W(g.x + (g.tx - g.x) * z, g.y + (g.ty - g.y) * z, 3)) }
      }
      for (const [k, b] of Object.entries(ghostB)) { b.mesh.count = gn[k]; b.mesh.instanceMatrix.needsUpdate = true; b.tint.needsUpdate = true }
      dots.geometry.dispose(); dots.geometry = new THREE.BufferGeometry().setFromPoints(seg)
      // props and mist face the camera
      for (const { b, at } of props) { at.forEach((p, i) => place(b.mesh, i, p.x, p.y, p.s * b.aspect, p.s, yaw)); b.mesh.instanceMatrix.needsUpdate = true }
      mistAt.forEach((m: any, i: number) => {
        P.copy(W(m.x + Math.sin(time * 0.1 + m.ph) * 25, m.y, 30)); Q.setFromEuler(new THREE.Euler(-1.2, 0, 0)); S.set(m.s, m.s * 0.6, 1)
        M.compose(P, Q, S); mist.setMatrixAt(i, M)
      })
      mist.instanceMatrix.needsUpdate = true
      // rings where riders are caught, shot or lost
      rings.forEach((r, i) => {
        const f = s.flashes[i]; r.visible = !!f
        if (!f) return
        r.position.copy(W(f.x, f.y, 2)); r.scale.setScalar(16 + f.age * 50)
        const m = r.material as THREE.MeshBasicNodeMaterial
        m.color.set(f.type === 'clash' ? '#efe3c4' : f.type === 'lost' ? '#ffffff' : '#ff3b24'); m.opacity = 0.9 * (1 - f.age)
      })
      // labels: hide any that would be cut by the view edge or the panel, or that sit on a unit
      const cw = renderer.domElement.clientWidth, ch = renderer.domElement.clientHeight
      for (const l of labels) {
        // a unit standing on the name pushes the name down-map, toward the camera, rather than hiding it
        l.sp.position.copy(s.squads.some(q => !(q.flags & 2) && Math.abs(q.x - l.x) < 70 && Math.abs(q.y - l.y) < 60) ? l.aside : l.at)
        P.copy(l.sp.position).project(camera)
        const px = (P.x + 1) / 2 * cw, py = (1 - P.y) / 2 * ch, hw = l.sp.scale.x / 2 * ch / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.distanceTo(l.sp.position))
        l.sp.visible = P.z < 1 && px - hw > 8 && px + hw < cw - panelPx - 8 && py > 24 && py < ch - 24
      }
      renderer.render(scene, camera)
    },
    dispose() { renderer.setAnimationLoop(null); renderer.dispose(); renderer.domElement.remove(); status.remove(); removeEventListener('resize', resize) },
  }
}
