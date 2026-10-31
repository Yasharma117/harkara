// The 2.5D painted diorama: terrain you can orbit, painted backdrops, one grey sprite per unit type tinted per house
// in a TSL shader. Uses art/*.webp when present (npm run assets), code-drawn placeholders otherwise.
import * as THREE from 'three/webgpu'
import { texture, uv, vec3, dot, mix, smoothstep, instancedBufferAttribute, float } from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mapSvg } from './mapsvg.ts'

export interface Snap {
  t: number
  squads: { id: string; house: string; type: string; x: number; y: number; str: number; flags: number }[]
  couriers: { id: string; house: string; kind: string; x: number; y: number; path: { x: number; y: number }[] }[]
  flashes: { type: string; x: number; y: number; age: number }[]
}

const HOUSE: Record<string, THREE.Color> = { rhino: new THREE.Color('#34418f'), kite: new THREE.Color('#d2452b'), orchid: new THREE.Color('#8a4fb5'), tiger: new THREE.Color('#c98a1c') }
const SIZE: Record<string, number> = { inf: 22, arch: 22, cav: 28, ele: 42, harkara: 20 }
const PER_SQUAD = 9

export async function createDiorama(host: HTMLElement, init: any) {
  const art: Record<string, { w: number; h: number }> = await fetch('art/art.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}))
  const loader = new THREE.TextureLoader()
  const tex = async (name: string, fallback: () => HTMLCanvasElement | Promise<HTMLCanvasElement | HTMLImageElement>) => {
    const t = art[name] ? await loader.loadAsync(`art/${name}.webp`) : new THREE.Texture(await fallback())
    t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.anisotropy = 4
    return t
  }

  // ---- height field: river channel, hills at the misty places, camps flat
  const hills = init.map.nodes.filter((n: any) => n.mist)
  const height = (x: number, y: number) => {
    let h = 0
    for (const n of hills) h += 70 * Math.exp(-((x - n.x) ** 2 + (y - n.y) ** 2) / (2 * 110 ** 2))
    const edge = Math.min(x, 1000 - x, y, 1000 - y)
    h += Math.max(0, 30 - edge) * 0.6
    const river = Math.abs(y - 500)
    if (river < 60) h = h * (river / 60) - 8 * (1 - river / 60)
    return h
  }
  const W = (x: number, y: number, lift = 0) => new THREE.Vector3(x - 500, height(x, y) + lift, y - 500)

  const renderer = new THREE.WebGPURenderer({ antialias: true })
  await renderer.init()
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog('#e6e8df', 1900, 4200)
  const camera = new THREE.PerspectiveCamera(34, 1, 5, 6000)
  camera.position.set(0, 1050, 1250)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 0, 40)
  Object.assign(controls, { enableDamping: true, minPolarAngle: 0.35, maxPolarAngle: 1.05, minAzimuthAngle: -0.7, maxAzimuthAngle: 0.7, minDistance: 150, maxDistance: 1700 })

  scene.add(new THREE.HemisphereLight('#f4efe2', '#2e3550', 1.6))
  const sun = new THREE.DirectionalLight('#fff6e0', 2.2); sun.position.set(-600, 900, -300); scene.add(sun)

  // sky + painted hill backdrops (north side; the camera stays south so they always read)
  scene.background = art['sky-dawn'] ? await tex('sky-dawn', () => document.createElement('canvas')) : new THREE.Color('#dfe5df')
  for (const [name, z, w, y] of [['hills-far', -1500, 4200, 250], ['hills-mid', -1050, 3000, 120]] as const) {
    if (!art[name]) continue
    const t = await tex(name, () => document.createElement('canvas'))
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * art[name].h) / art[name].w), new THREE.MeshBasicNodeMaterial({ map: t, transparent: true, fog: false }))
    m.position.set(0, y, z); scene.add(m)
  }

  // terrain
  const svgImg = () => new Promise<HTMLImageElement>(res => { const i = new Image(); i.onload = () => res(i); i.src = URL.createObjectURL(new Blob([mapSvg('paint', 2048)], { type: 'image/svg+xml' })) })
  const ground = new THREE.PlaneGeometry(1100, 1100, 160, 160)
  ground.rotateX(-Math.PI / 2)
  const gp = ground.attributes.position
  for (let i = 0; i < gp.count; i++) gp.setY(i, height(gp.getX(i) + 500, gp.getZ(i) + 500))
  ground.computeVertexNormals()
  const gtex = await tex('map-painted', svgImg)
  // UVs: the 1000×1000 map sits inside the 1100 plane
  const guv = ground.attributes.uv
  for (let i = 0; i < guv.count; i++) { guv.setX(i, (gp.getX(i) + 500) / 1000); guv.setY(i, 1 - (gp.getZ(i) + 500) / 1000) }
  gtex.wrapS = gtex.wrapT = THREE.ClampToEdgeWrapping
  scene.add(new THREE.Mesh(ground, new THREE.MeshStandardNodeMaterial({ map: gtex, roughness: 1 })))

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
  async function batch(name: string, fallback: () => HTMLCanvasElement, count: number, opts: { tinted: boolean; opacity?: number }) {
    const t = await tex(name, fallback)
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0)
    const tint = tintAttr(count)
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: true })
    const s = texture(t, uv())
    if (opts.tinted) {
      // near-white cloth takes the house colour; skin, wood and metal stay as painted
      const cloth = smoothstep(0.62, 0.9, dot(s.rgb, vec3(0.3, 0.59, 0.11)))
      mat.colorNode = mix(s.rgb, s.rgb.mul(instancedBufferAttribute(tint)).mul(1.25), cloth)
    } else mat.colorNode = s.rgb
    mat.opacityNode = s.a.mul(float(opts.opacity ?? 1))
    mat.alphaTest = 0.35
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    mesh.count = 0; mesh.frustumCulled = false
    scene.add(mesh)
    const aspect = art[name] ? art[name].w / art[name].h : 1
    return { mesh, tint, aspect }
  }

  const units: Record<string, Awaited<ReturnType<typeof batch>>> = {}
  for (const [k, [name, fb]] of Object.entries(SPRITES)) units[k] = await batch(name, fb, k === 'harkara' ? 80 : init.squads.length * PER_SQUAD, { tinted: true })

  // props: trees on the hills, huts at the villages, a ferry, rocks
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()
  const propPlaces: Record<string, { x: number; y: number; s: number }[]> = { pine: [], bamboo: [], hut: [], ferry: [], rock: [] }
  for (const n of hills) for (let i = 0; i < 16; i++) { const a = rnd() * 6.28, r = 40 + rnd() * 120; propPlaces[i % 3 ? 'pine' : 'bamboo'].push({ x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r, s: 26 + rnd() * 18 }) }
  for (const n of init.map.nodes.filter((n: any) => n.id.endsWith('village'))) for (const [dx, dy] of [[-20, -10], [15, -14], [0, 12], [24, 10]]) propPlaces.hut.push({ x: n.x + dx, y: n.y + dy, s: 22 })
  const fer = init.map.nodes.find((n: any) => n.id === 'ferry'); propPlaces.ferry.push({ x: fer.x, y: fer.y, s: 24 })
  for (let i = 0; i < 18; i++) propPlaces.rock.push({ x: 60 + rnd() * 880, y: rnd() < 0.5 ? 380 - rnd() * 300 : 620 + rnd() * 300, s: 8 + rnd() * 8 })
  const PROP_FB: Record<string, () => HTMLCanvasElement> = {
    pine: placeholder(g => { g.fillStyle = '#4e7a5a'; g.beginPath(); g.moveTo(64, 4); g.lineTo(104, 112); g.lineTo(24, 112); g.closePath(); g.fill(); g.fillStyle = '#5a4630'; g.fillRect(58, 110, 12, 18) }),
    bamboo: placeholder(g => { g.strokeStyle = '#8daa6b'; g.lineWidth = 7; for (const x of [44, 58, 72, 86]) { g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x - 10, 60, x + 8, 6); g.stroke() } }),
    hut: placeholder(g => { g.fillStyle = '#8a6a4a'; g.fillRect(30, 60, 68, 40); g.fillStyle = '#c8a86a'; g.beginPath(); g.moveTo(18, 64); g.lineTo(64, 20); g.lineTo(110, 64); g.fill(); g.fillStyle = '#5a4630'; for (const x of [34, 60, 88]) g.fillRect(x, 100, 6, 28) }),
    ferry: placeholder(g => { g.fillStyle = '#7a5a3a'; g.fillRect(10, 84, 108, 22); g.strokeStyle = '#5a4630'; g.lineWidth = 4; g.beginPath(); g.moveTo(14, 80); g.lineTo(120, 60); g.stroke() }),
    rock: placeholder(g => { g.fillStyle = '#7e8c78'; g.beginPath(); g.ellipse(64, 96, 50, 30, 0, 0, 7); g.fill() }),
  }
  const props: { b: Awaited<ReturnType<typeof batch>>; at: { x: number; y: number; s: number }[] }[] = []
  for (const [k, at] of Object.entries(propPlaces)) { const b = await batch(`prop-${k}`, PROP_FB[k], at.length, { tinted: false }); b.mesh.count = at.length; props.push({ b, at }) }

  // mist: soft cards drifting over the misty places
  const mistTex = new THREE.CanvasTexture(placeholder(g => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,.75)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128) })())
  const mistMat = new THREE.MeshBasicNodeMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.42 })
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mistMat, hills.length * 4)
  mist.frustumCulled = false; scene.add(mist)
  const mistAt = hills.flatMap((n: any) => [0, 1, 2, 3].map(i => ({ x: n.x + (i - 1.5) * 50, y: n.y + ((i * 37) % 60) - 30, s: 220 + i * 30, ph: i * 1.7 })))

  // couriers' ink routes + flash rings
  const routes = new Map<string, THREE.Line>()
  const ringGeo = new THREE.RingGeometry(0.8, 1, 48); ringGeo.rotateX(-Math.PI / 2)
  const rings = Array.from({ length: 24 }, () => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, color: '#c0392b' })); m.visible = false; scene.add(m); return m })

  // ---- per frame
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
  const lastX = new Map<string, number>(), facing = new Map<string, number>()
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, w: number, h: number, yaw: number, lean = 0, lift = 0) => {
    P.copy(W(x, y, lift)); Q.setFromAxisAngle(up, yaw)
    if (lean) Q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean))
    S.set(w, h, 1); M.compose(P, Q, S); mesh.setMatrixAt(i, M)
  }

  function resize() { const r = host.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix() }
  addEventListener('resize', resize); resize()

  return {
    canvas: renderer.domElement,
    render(s: Snap, time: number) {
      controls.update()
      const yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z)
      // soldiers in loose 3×3 blocks, fewer as the squad loses strength
      const n: Record<string, number> = { inf: 0, arch: 0, cav: 0, ele: 0 }
      for (const q of s.squads) {
        if (q.flags & 2) continue
        const b = units[q.type], prev = lastX.get(q.id) ?? q.x, moving = Math.abs(q.x - prev) > 0.01
        if (moving) facing.set(q.id, q.x > prev ? 1 : -1)
        lastX.set(q.id, q.x)
        const flip = facing.get(q.id) ?? 1, count = Math.max(1, Math.ceil((q.str / 100) * (q.type === 'ele' ? 3 : PER_SQUAD)))
        const c = q.flags & 1 ? HOUSE[q.house].clone().lerp(new THREE.Color('#999'), 0.6) : HOUSE[q.house]
        for (let k = 0; k < count; k++) {
          const gx = (k % 3) - 1, gy = Math.floor(k / 3) - 1, sp = q.type === 'ele' ? 24 : 11
          const bob = moving ? Math.abs(Math.sin(time * 9 + k * 1.3)) * 1.6 : 0
          const hgt = SIZE[q.type]
          place(b.mesh, n[q.type], q.x + gx * sp + (gy % 2) * 3, q.y + gy * sp * 0.8, hgt * b.aspect * flip, hgt, yaw, moving ? -0.08 * flip : 0, bob)
          b.tint.setXYZ(n[q.type]++, c.r, c.g, c.b)
        }
      }
      for (const [k, b] of Object.entries(units)) if (k !== 'harkara') { b.mesh.count = n[k]; b.mesh.instanceMatrix.needsUpdate = true; b.tint.needsUpdate = true }
      // couriers: a runner and a line of ink ahead of it
      const h = units.harkara, live = new Set<string>()
      s.couriers.slice(0, 80).forEach((c, i) => {
        const prev = lastX.get(c.id) ?? c.x; lastX.set(c.id, c.x)
        const flip = c.x >= prev ? 1 : -1
        place(h.mesh, i, c.x, c.y, SIZE.harkara * h.aspect * flip * (c.kind === 'report' ? 0.8 : 1), SIZE.harkara * (c.kind === 'report' ? 0.8 : 1), yaw, -0.15 * flip, Math.abs(Math.sin(time * 14 + i)) * 2)
        const col = HOUSE[c.house]; h.tint.setXYZ(i, col.r, col.g, col.b)
        if (c.kind === 'report') return
        live.add(c.id)
        let line = routes.get(c.id)
        if (!line) { line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicNodeMaterial({ color: col, transparent: true, opacity: 0.8 })); routes.set(c.id, line); scene.add(line) }
        const pts: THREE.Vector3[] = []
        let ax = c.x, ay = c.y
        for (const p of c.path) { const d = Math.hypot(p.x - ax, p.y - ay), steps = Math.max(1, Math.ceil(d / 15)); for (let j = 0; j <= steps; j++) pts.push(W(ax + ((p.x - ax) * j) / steps, ay + ((p.y - ay) * j) / steps, 1.5)); ax = p.x; ay = p.y }
        line.geometry.setFromPoints(pts.length > 1 ? pts : [W(c.x, c.y, 1.5), W(c.x, c.y, 1.5)])
      })
      h.mesh.count = Math.min(80, s.couriers.length); h.mesh.instanceMatrix.needsUpdate = true; h.tint.needsUpdate = true
      for (const [id, l] of routes) if (!live.has(id)) { scene.remove(l); l.geometry.dispose(); routes.delete(id) }
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
        r.position.copy(W(f.x, f.y, 2)); r.scale.setScalar(8 + f.age * 40)
        const m = r.material as THREE.MeshBasicNodeMaterial
        m.color.set(f.type === 'clash' ? '#555' : f.type === 'lost' ? '#ffffff' : '#c0392b'); m.opacity = 1 - f.age
      })
      renderer.render(scene, camera)
    },
    dispose() { renderer.setAnimationLoop(null); renderer.dispose(); renderer.domElement.remove(); removeEventListener('resize', resize) },
  }
}
