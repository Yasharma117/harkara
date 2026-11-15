// 3D armies: animated low-poly soldiers (KayKit Adventurers, CC0) and horses (Quaternius, CC0) in ranks, tinted per house.
// Foot march, fight and fall; archers loose crossbow bolts that fly; horsemen gallop. Elephants stay painted cut-outs
// (diorama.ts) until a 3D elephant arrives. Models: client/public/models (licences in LICENSES.txt).
import * as THREE from 'three/webgpu'
import { texture, uv, vec3, mix, smoothstep, max, min, vertexColor, positionGeometry } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'

type Sq = { id: string; house: string; type: string; x: number; y: number; str: number; flags: number }
type Kind = 'inf' | 'arch' | 'cav' | 'ele'
const QUAD = (k: Kind) => k === 'cav' || k === 'ele' // four-legged: both ride the horse skeleton's clips
const PER: Record<Kind, number> = { inf: 24, arch: 16, cav: 8, ele: 4 }
const COLS: Record<Kind, number> = { inf: 8, arch: 8, cav: 4, ele: 2 } // battle lines, not huddles: two ranks of foot, archers and horse abreast
const GAP: Record<Kind, number> = { inf: 13, arch: 13, cav: 22, ele: 40 }
const HEIGHT = { foot: 26, horse: 28, rider: 21, ele: 52 }
const MELEE = ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Horizontal', 'Block_Attack']

interface Fig { root: THREE.Object3D; mixer: THREE.AnimationMixer; acts: Map<string, THREE.AnimationAction>; cur: string; dead: boolean; x: number; y: number; yaw: number; diedAt: number; row: number; placed: boolean }
type Mode = 'walk' | 'run' | 'fight' | 'shoot' | 'idle'
interface Unit { kind: Kind; house: string; figs: Fig[]; lx: number; ly: number; yaw: number; shotAt: number; seen: boolean; spd: number; mode: Mode; next: Mode; nextAt: number; fightAt: number }

export async function army3d(scene: THREE.Scene, W: (x: number, y: number, lift?: number) => THREE.Vector3, squads: { id: string; house: string; type: string }[], HOUSE: Record<string, THREE.Color>, camps: Record<string, { x: number; y: number }> = {}) {
  const loader = new GLTFLoader()
  // models/*.glb normally; hosts that won't serve .glb get models/pack.json (base64), made by tools/pack-models.ts
  let pack: Promise<Record<string, string>> | null = null
  const load = async (f: string) => {
    const r = await fetch(`models/${f}`).catch(() => null)
    if (r?.ok) return loader.parseAsync(await r.arrayBuffer(), 'models/')
    pack ??= fetch('models/pack.json').then(r => r.json())
    const b = Uint8Array.from(atob((await pack)[f]), c => c.charCodeAt(0))
    return loader.parseAsync(b.buffer, 'models/')
  }
  const [horse, bolt, foot, rogue, rider, ele, courier, tent] = await Promise.all(['Horse.glb', 'arrow.glb', 'Infantry.glb', 'Archer.glb', 'Rider.glb', 'Elephant.glb', 'Courier.glb', 'Tent.glb'].map(load))

  // house colour goes on the neutral, light parts of the paint (armour, cloth); skin, wood and leather keep their colours
  const mats = new Map<string, THREE.Material>()
  const houseMat = (m: THREE.MeshStandardMaterial, house: string, vc = 0, band?: THREE.Box3) => { // vc: 0 = textured model; else the linear brightness above which neutral paint counts as cloth
    const key = `${m.uuid}|${house}|${vc}|${!!band}`
    if (mats.has(key)) return mats.get(key)!
    const nm = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.05 })
    if (m.map) {
      const c = texture(m.map, uv()).rgb, hi = max(c.r, max(c.g, c.b)), sat = hi.sub(min(c.r, min(c.g, c.b)))
      const neutral = smoothstep(0.08, 0.26, sat).oneMinus().mul(smoothstep(0.12, 0.5, hi)) // edges low→high: reversed smoothstep is undefined on the GPU
      const cloth = max(smoothstep(0.25, 0.45, c.r.sub(max(c.g, c.b))), smoothstep(0.06, 0.16, c.g.sub(max(c.r, c.b)))) // the models' red tunics and green hoods are team colour: make them the house's
      const hc = vec3(HOUSE[house].r, HOUSE[house].g, HOUSE[house].b)
      nm.colorNode = mix(mix(c, hc.mul(hi.mul(1.25).add(0.18)), neutral.mul(0.85)), hc.mul(hi.mul(1.2).add(0.05)), cloth)
    } else if (vc) {
      // generated models (batch 5) carry vertex colours: the off-white quilted cloth takes the house colour; skin, steel and leather stay
      const c = vertexColor().rgb, hi = max(c.r, max(c.g, c.b)), sat = hi.sub(min(c.r, min(c.g, c.b)))
      const cloth = smoothstep(0.07, 0.15, sat).oneMinus().mul(smoothstep(vc, vc + 0.18, hi)) // measured in linear: quilting sits at 0.2–0.5
      const hc = vec3(HOUSE[house].r, HOUSE[house].g, HOUSE[house].b)
      // elephants: hide and cloth are the same grey, so colour only the caparison's place on the body — the middle band of
      // its height, behind the head (the model faces +Z)
      const ny = band ? positionGeometry.y.sub(band.min.y).div(band.max.y - band.min.y) : null, nz = band ? positionGeometry.z.sub(band.min.z).div(band.max.z - band.min.z) : null
      const where = band ? smoothstep(0.36, 0.42, ny!).mul(smoothstep(0.7, 0.76, ny!).oneMinus()).mul(smoothstep(0.7, 0.76, nz!).oneMinus()) : 1
      nm.colorNode = mix(c, hc.mul(hi.mul(1.6).add(0.06)), cloth.mul(0.9).mul(where))
    } else nm.color.copy(m.color)
    mats.set(key, nm)
    return nm
  }
  // normalise each model to a target height in map units, feet on the ground
  const fit = (g: THREE.Object3D, h: number) => {
    g.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(g), k = h / (b.max.y - b.min.y || 1)
    return { k, foot: -b.min.y * k }
  }
  const footFit = fit(foot.scene, HEIGHT.foot), rogueFit = fit(rogue.scene, HEIGHT.foot), horseFit = fit(horse.scene, HEIGHT.horse), riderFit = fit(rider.scene, HEIGHT.rider), eleFit = fit(ele.scene, HEIGHT.ele)

  const make = (src: typeof horse, f: { k: number; foot: number }, house: string, prefix = '', cloth = 0.14, band = false): Fig => {
    const root = SkeletonUtils.clone(src.scene)
    root.scale.setScalar(f.k)
    root.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) { m.frustumCulled = false; if (band && !m.geometry.boundingBox) m.geometry.computeBoundingBox(); m.material = houseMat(m.material as THREE.MeshStandardMaterial, house, m.geometry.attributes.color ? cloth : 0, band ? m.geometry.boundingBox! : undefined) }
    })
    const holder = new THREE.Group(); holder.add(root); root.position.y = f.foot
    const mixer = new THREE.AnimationMixer(root), acts = new Map<string, THREE.AnimationAction>()
    for (const clip of src.animations) acts.set(clip.name.replace(prefix, ''), mixer.clipAction(clip))
    scene.add(holder)
    return { root: holder, mixer, acts, cur: '', dead: false, x: 0, y: 0, yaw: 0, diedAt: 0, row: 0, placed: false }
  }

  // each general's command tent stands at its camp, in the house colour: where orders leave from and reports come home to
  for (const [h, c] of Object.entries(camps)) {
    const t = tent.scene.clone(), tf = fit(tent.scene, 46)
    t.scale.setScalar(tf.k); t.position.copy(W(c.x, c.y - 26, 0)); t.position.y += tf.foot
    t.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = houseMat(m.material as THREE.MeshStandardMaterial, h, 0.3) })
    scene.add(t)
  }
  const units = new Map<string, Unit>()
  for (const s of squads) {
    const kind = s.type as Kind, figs: Fig[] = []
    for (let i = 0; i < PER[kind]; i++) {
      if (kind === 'cav') {
        const h = make(horse, horseFit, s.house, 'AnimalArmature|')
        // the rider is one seated piece, pinned to the horse's back so he rides its gallop and falls with it
        const r = rider.scene.clone(); r.scale.setScalar(riderFit.k); r.position.set(0, HEIGHT.horse * 0.68 + HEIGHT.rider * 0.42, 0) // the mesh's origin is its middle: seat it on the saddle
        r.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.frustumCulled = false; m.material = houseMat(m.material as THREE.MeshStandardMaterial, s.house, 0.14) } })
        h.root.add(r); h.root.updateMatrixWorld(true); h.root.getObjectByName('Torso2')?.attach(r)
        figs.push(h)
      } else {
        const f = kind === 'ele' ? make(ele, eleFit, s.house, 'AnimalArmature|', 0.1, true) : kind === 'arch' ? make(rogue, rogueFit, s.house) : make(foot, footFit, s.house)
        // the generated archer carries his own bow; no crossbow to attach
        figs.push(f)
      }
    }
    units.set(s.id, { kind, house: s.house, figs, lx: NaN, ly: NaN, yaw: 0, shotAt: 0, seen: false, spd: 0, mode: 'idle', next: 'idle', nextAt: 0, fightAt: -9 })
  }

  function play(f: Fig, name: string, once = false, fade = 0.25) {
    if (f.cur === name) return
    const a = f.acts.get(name)
    if (!a) return
    a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once
    a.time = once ? 0 : Math.random() * a.getClip().duration // ranks don't move in lockstep
    a.play()
    const old = f.acts.get(f.cur)
    if (old) a.crossFadeFrom(old, fade, false)
    f.cur = name
  }

  // crossbow bolts in flight
  const BOLTS = 160
  const bolts = Array.from({ length: BOLTS }, () => { const o = bolt.scene.clone(); o.scale.setScalar(fit(bolt.scene, 1).k * 11); o.visible = false; scene.add(o); return { o, from: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, dur: 0 } })
  let boltN = 0, clock = 0
  const fire = (from: THREE.Vector3, to: THREE.Vector3) => {
    const b = bolts[boltN++ % BOLTS]
    b.from.copy(from); b.to.copy(to); b.t0 = clock; b.dur = 0.55 + Math.random() * 0.25; b.o.visible = true
  }

  // dust kicked up where men fight: painted puffs that rise and fade
  const dustTex = await new THREE.TextureLoader().loadAsync('art/dust-puff.webp').catch(() => null)
  if (dustTex) dustTex.colorSpace = THREE.SRGBColorSpace
  const puffs = Array.from({ length: 70 }, () => { const sp = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; scene.add(sp); return { sp, t0: 0, x: 0, y: 0, s: 0 } })
  let puffN = 0
  const puff = (x: number, y: number) => { const p = puffs[puffN++ % puffs.length]; Object.assign(p, { t0: clock, x, y, s: 26 + Math.random() * 22 }); p.sp.visible = !!dustTex }
  // soft blob shadows under every figure
  const blobTex = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!; const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(20,18,12,.5)'); r.addColorStop(1, 'rgba(20,18,12,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return c })())
  const total = [...units.values()].reduce((a, u) => a + u.figs.length, 0) + 40 // + the runners
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({ map: blobTex, transparent: true, depthWrite: false }), total)
  blobs.frustumCulled = false; scene.add(blobs)
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), S = new THREE.Vector3()
  // the messengers: a pool of runners, re-dressed in the sender's colour as riders come and go
  const RUNNERS = 40, courierFit = fit(courier.scene, HEIGHT.foot * 0.95)
  let courierMat: THREE.MeshStandardMaterial | null = null
  courier.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) courierMat ??= m.material as THREE.MeshStandardMaterial })
  const runners = Array.from({ length: RUNNERS }, () => { const f = make(courier, courierFit, 'rhino'); f.root.visible = false; play(f, 'Running_A'); return { f, house: 'rhino' } })
  const dress = (r: typeof runners[0], house: string) => { if (r.house !== house) { r.house = house; r.f.root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.material = houseMat(courierMat!, house, 0.14) }) } }
  // a sealed letter floats over every rider carrying an order or a letter, edged in the sender's colour: the thing everyone is hunting
  const sealTex = (house: string) => { const c = document.createElement('canvas'); c.width = 96; c.height = 72; const g = c.getContext('2d')!
    g.lineJoin = 'round'; g.fillStyle = '#f6ecd6'; g.strokeStyle = '#' + HOUSE[house].getHexString(THREE.SRGBColorSpace); g.lineWidth = 9
    g.beginPath(); g.roundRect(6, 8, 84, 56, 6); g.fill(); g.stroke()
    g.strokeStyle = '#2a2016'; g.lineWidth = 3; g.beginPath(); g.moveTo(10, 12); g.lineTo(48, 40); g.lineTo(86, 12); g.stroke()
    g.fillStyle = '#b3242f'; g.beginPath(); g.arc(48, 42, 9, 0, 7); g.fill()
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.SpriteNodeMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }) }
  const sealMat: Record<string, THREE.SpriteNodeMaterial> = Object.fromEntries(Object.keys(HOUSE).map(h => [h, sealTex(h)]))
  const seals = runners.map(() => { const sp = new THREE.Sprite(); sp.visible = false; sp.renderOrder = 8; sp.scale.set(20, 15, 1); scene.add(sp); return sp })
  let lastT = -1

  ;(globalThis as any).__army = units // test hook
  return {
    runners: RUNNERS,
    // where a squad's standing men are (in a fight they leave the squad's spot for the battle line): its standard follows them
    centre(id: string) { const m = units.get(id)?.figs.filter(f => !f.dead && f.placed); return m?.length ? { x: m.reduce((a, f) => a + f.x, 0) / m.length, y: m.reduce((a, f) => a + f.y, 0) / m.length } : null },
    update(shown: Sq[], t: number, dt: number, couriers: { house: string; kind: string; x: number; y: number; path: { x: number; y: number }[] }[] = [], stops: { type: string; x: number; y: number; house?: string }[] = []) {
      const live = t !== lastT; lastT = t // battle paused: everyone freezes mid-stride
      const adt = live ? dt : 0
      clock += adt
      let bn = 0
      // each squad's nearest enemy as drawn: who it faces, fights or shoots at
      const near = new Map<string, { foe: Sq; fd: number }>()
      for (const q of shown) { if (q.flags & 2) continue; let foe: Sq | null = null, fd = Infinity; for (const e of shown) if (e.house !== q.house && !(e.flags & 2)) { const d = Math.hypot(e.x - q.x, e.y - q.y); if (d < fd) { fd = d; foe = e } } if (foe) near.set(q.id, { foe, fd }) }
      for (const q of shown) {
        const u = units.get(q.id)
        if (!u) continue
        const alive = q.flags & 2 ? 0 : Math.max(1, Math.ceil((q.str / 100) * u.figs.length))
        const dx = Number.isNaN(u.lx) ? 0 : q.x - u.lx, dy = Number.isNaN(u.ly) ? 0 : q.y - u.ly
        u.lx = q.x; u.ly = q.y
        if (adt > 0) u.spd = u.spd * 0.85 + (Math.hypot(dx, dy) / adt) * 0.15 // smoothed: frame jitter must not flip march/halt
        const speed = u.spd, moving = speed > 6, routed = !!(q.flags & 1)
        // the nearest enemy as drawn: who they face, fight or shoot at
        const foe = near.get(q.id)?.foe ?? null, fd = near.get(q.id)?.fd ?? Infinity
        const fighting = !moving && !routed && u.kind !== 'arch' && fd < 150, shooting = !routed && u.kind === 'arch' && fd < 340 && !moving
        // a squad changes what it's doing only once the new state has held for a moment, so ranks never stutter between poses
        const raw: Mode = routed || speed > (u.kind === 'cav' ? 45 : 30) ? 'run' : moving ? 'walk' : fighting ? 'fight' : shooting ? 'shoot' : 'idle'
        if (raw !== u.next) { u.next = raw; u.nextAt = clock }
        if (u.next !== u.mode && (clock - u.nextAt > 0.4 || !u.seen)) { if (u.next === 'fight' && u.seen) u.fightAt = clock; u.mode = u.next }
        const mode = u.mode
        const want = moving ? Math.atan2(dx, dy) : foe && fd < 400 ? Math.atan2(foe.x - q.x, foe.y - q.y) : u.yaw
        let dyaw = ((want - u.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        u.yaw += dyaw * Math.min(1, adt * 4)
        const cos = Math.cos(u.yaw), sin = Math.sin(u.yaw), cols = COLS[u.kind], gap = GAP[u.kind] * (routed ? 1.8 : 1)
        // ---- who is standing. Men fall where the fighting is: the front rank dies first, and the rank behind steps up.
        const standing = u.figs.filter(f => !f.dead)
        if (!u.seen) { u.figs.forEach((f, k) => { if (k >= alive) { f.dead = true; f.diedAt = -99; f.root.visible = false } }) }
        else if (standing.length > alive) {
          const order = mode === 'fight' ? [...standing].sort((a, b) => a.row - b.row) : [...standing].reverse()
          for (const f of order.slice(0, standing.length - alive)) { f.dead = true; f.diedAt = clock; play(f, QUAD(u.kind) ? 'Death' : Math.random() < 0.5 ? 'Death_A' : 'Death_B', true, 0.1) }
        } else if (standing.length < alive) {
          for (const f of u.figs.filter(f => f.dead).slice(0, alive - standing.length)) { f.dead = false; f.cur = ''; f.placed = false } // rallied
        }
        // ---- the battle line: two squads in a fight meet halfway, front ranks a sword's reach apart, each man facing his opposite
        let line: { mx: number; my: number; dx: number; dy: number; side: boolean; flank: number } | null = null
        if (mode === 'fight' && foe) {
          const fu = units.get(foe.id), mutual = near.get(foe.id)?.foe.id === q.id && fu?.mode === 'fight'
          if (mutual) line = { mx: (q.x + foe.x) / 2, my: (q.y + foe.y) / 2, dx: (foe.x - q.x) / (fd || 1), dy: (foe.y - q.y) / (fd || 1), side: q.id < foe.id, flank: 0 }
          else {
            // the enemy is busy with someone else (or only shooting): fall on him where his men actually stand
            const men = fu?.figs.filter(f => !f.dead && f.placed) ?? [], cx = men.length ? men.reduce((a, f) => a + f.x, 0) / men.length : foe.x, cy = men.length ? men.reduce((a, f) => a + f.y, 0) / men.length : foe.y
            const d = Math.hypot(cx - q.x, cy - q.y) || 1
            line = { mx: cx, my: cy, dx: (cx - q.x) / d, dy: (cy - q.y) / d, side: true, flank: 16 }
          }
        }
        const reach = u.kind === 'ele' ? 34 : u.kind === 'cav' ? 20 : 8.5
        let slot = 0
        for (const f of u.figs) {
          if (f.dead) {
            // the fallen lie a while where they fell, then sink into the grass, so fords don't fill with bodies
            const age = clock - f.diedAt
            if (age > 12) { f.root.visible = age < 14.5; f.root.position.y = W(f.x, f.y, 0).y - (age - 12) * 6 } else if (f.root.visible) f.root.position.copy(W(f.x, f.y, 0))
            f.mixer.update(adt)
            if (f.root.visible) { const r = u.kind === 'ele' ? 44 : u.kind === 'cav' ? 26 : 13; P.copy(W(f.x, f.y, 0.7)); S.set(r * 1.5, r * 0.8, 1); M.compose(P, Q, S); blobs.setMatrixAt(bn++, M) }
            continue
          }
          const k = slot++, col = k % cols, row = Math.floor(k / cols), lat = (col - (cols - 1) / 2) * gap
          f.row = row; f.root.visible = true
          let tx: number, ty: number, face = u.yaw
          if (line) {
            const back = line.flank + reach / 2 + row * gap * 0.85 + (row ? 3 : Math.sin(clock * 2.3 + k) * 1.2)
            tx = line.mx - line.dx * back - line.dy * lat; ty = line.my - line.dy * back + line.dx * lat; face = Math.atan2(line.dx, line.dy)
          } else {
            const gy = (row - (Math.ceil(PER[u.kind] / cols) - 1) / 2) * gap, jx = ((k * 37) % 7) - 3 + (routed ? ((k * 71) % 23) - 11 : 0), jy = ((k * 53) % 5) - 2 + (routed ? ((k * 43) % 19) - 9 : 0)
            tx = q.x + lat * cos + gy * sin + jx; ty = q.y - lat * sin + gy * cos + jy
          }
          // each man walks or runs to his place; he is never teleported, so a charge is men crossing ground
          const ddx = tx - f.x, ddy = ty - f.y, dist = Math.hypot(ddx, ddy), step = (speed + (QUAD(u.kind) ? 90 : 60)) * adt
          let running = false
          if (!f.placed || dist > 400) { f.x = tx; f.y = ty; f.placed = true }
          else if (dist <= step || dist < 0.5) { f.x = tx; f.y = ty }
          else { f.x += (ddx / dist) * step; f.y += (ddy / dist) * step; running = dist > 4; if (running) face = Math.atan2(ddx, ddy) }
          f.yaw = face
          let anim: string
          if (running && !moving) anim = QUAD(u.kind) ? 'Gallop' : 'Running_A' // closing with the enemy, or stepping up into a gap
          else if (mode === 'run') anim = QUAD(u.kind) ? 'Gallop' : 'Running_A'
          else if (mode === 'walk') anim = QUAD(u.kind) ? 'Walk' : 'Walking_A'
          else if (line) {
            // front rank: strike and answer in turn with the man opposite; ranks behind wait their turn
            const pair = line.side ? col : cols - 1 - col, mine = (Math.floor(clock / 1.15) + pair) % 2 === (line.side ? 0 : 1)
            if (row > 0) anim = QUAD(u.kind) ? 'Idle' : row === 1 ? 'Blocking' : 'Idle'
            else if (QUAD(u.kind)) anim = mine ? (col % 2 ? 'Attack_Kick' : 'Attack_Headbutt') : 'Idle_HitReact_Left'
            else anim = mine ? MELEE[(k + Math.floor(clock / 1.15)) % MELEE.length] : (pair % 2 ? 'Block_Hit' : 'Hit_A')
          } else anim = mode === 'shoot' ? '2H_Ranged_Shooting' : u.kind === 'arch' ? '2H_Ranged_Aiming' : 'Idle'
          play(f, anim)
          f.mixer.timeScale = moving ? THREE.MathUtils.clamp(speed / (u.kind === 'cav' ? 60 : 22), 0.6, 2.6) : 1
          f.root.position.copy(W(f.x, f.y, 0)); f.root.rotation.y = f.yaw
          f.mixer.update(adt)
          { const r = u.kind === 'ele' ? 44 : u.kind === 'cav' ? 26 : 13; P.copy(W(f.x, f.y, 0.7)); S.set(r, r * 0.8, 1); M.compose(P, Q, S); blobs.setMatrixAt(bn++, M) }
          if (line && row === 0 && Math.random() < adt * 0.6) puff(f.x + line.dx * 5, f.y + line.dy * 5)
        }
        u.seen = true
        // archers loose bolts at the enemy they face
        if (mode === 'shoot' && foe && clock - u.shotAt > 1.7) { // a volley: the whole line looses together
          u.shotAt = clock
          for (const f of u.figs) if (!f.dead && Math.random() < 0.8) fire(W(f.x, f.y, 20), W(foe.x + (Math.random() - 0.5) * 60, foe.y + (Math.random() - 0.5) * 40, 6))
        }
      }
      runners.forEach((r, i) => {
        const c = couriers[i]
        // the pool's tail end plays the riders who were just stopped: a caught rider stands held where he was taken, a shot one falls there
        const st = c ? undefined : stops.filter(x => x.type !== 'lost' && x.house)[RUNNERS - 1 - i]
        r.f.root.visible = !!(c || st); seals[i].visible = false
        if (st) {
          dress(r, st.house!); play(r.f, st.type === 'killed' ? 'Death_A' : 'Idle', st.type === 'killed', 0.1)
          r.f.root.position.copy(W(st.x, st.y, 0)); r.f.root.scale.setScalar(1.5); r.f.mixer.timeScale = 1; r.f.mixer.update(adt)
          seals[i].visible = true; seals[i].material = sealMat[st.house!]; seals[i].position.copy(W(st.x, st.y, st.type === 'killed' ? 22 : 52))
          return
        }
        if (!c) return
        dress(r, c.house); play(r.f, 'Running_A')
        const to = c.path[0], order = c.kind !== 'report'
        if (to && Math.hypot(to.x - c.x, to.y - c.y) > 1) r.f.root.rotation.y = Math.atan2(to.x - c.x, to.y - c.y)
        r.f.root.position.copy(W(c.x, c.y, 0)); r.f.root.scale.setScalar(order ? 1.5 : 0.8) // the riders carrying orders are the show: bigger than a soldier
        if (order) { seals[i].visible = true; seals[i].material = sealMat[c.house]; seals[i].position.copy(W(c.x, c.y, 52 + Math.sin(clock * 5 + i) * 2)) }
        r.f.mixer.timeScale = 1.6; r.f.mixer.update(adt)
        P.copy(W(c.x, c.y, 0.7)); S.set(12, 10, 1); M.compose(P, Q, S); blobs.setMatrixAt(bn++, M)
      })
      blobs.count = bn; blobs.instanceMatrix.needsUpdate = true
      for (const p of puffs) {
        if (!p.sp.visible) continue
        const k = (clock - p.t0) / 1.6
        if (k >= 1) { p.sp.visible = false; continue }
        p.sp.position.copy(W(p.x, p.y, 6 + k * 22)); p.sp.scale.setScalar(p.s * (0.6 + k * 0.9)); (p.sp.material as THREE.SpriteNodeMaterial).opacity = 0.55 * Math.sin(Math.PI * k)
      }
      for (const b of bolts) {
        if (!b.o.visible) continue
        const k = (clock - b.t0) / b.dur
        if (k >= 1) { b.o.visible = false; continue }
        const p = new THREE.Vector3().lerpVectors(b.from, b.to, k); p.y += Math.sin(Math.PI * k) * 55
        const n = new THREE.Vector3().lerpVectors(b.from, b.to, Math.min(1, k + 0.02)); n.y += Math.sin(Math.PI * Math.min(1, k + 0.02)) * 55
        b.o.position.copy(p); b.o.lookAt(n)
      }
    },
  }
}
const P = new THREE.Vector3()
