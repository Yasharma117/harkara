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

interface Fig { root: THREE.Object3D; mixer: THREE.AnimationMixer; acts: Map<string, THREE.AnimationAction>; cur: string; dead: boolean; x: number; y: number; yaw: number; diedAt: number; hitUntil: number }
type Mode = 'walk' | 'run' | 'fight' | 'shoot' | 'idle'
interface Unit { kind: Kind; house: string; figs: Fig[]; lx: number; ly: number; yaw: number; shotAt: number; seen: boolean; spd: number; mode: Mode; next: Mode; nextAt: number; fightAt: number }

export async function army3d(scene: THREE.Scene, W: (x: number, y: number, lift?: number) => THREE.Vector3, squads: { id: string; house: string; type: string }[], HOUSE: Record<string, THREE.Color>) {
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
  const [horse, bolt, foot, rogue, rider, ele] = await Promise.all(['Horse.glb', 'arrow.glb', 'Infantry.glb', 'Archer.glb', 'Rider.glb', 'Elephant.glb'].map(load))

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
    return { root: holder, mixer, acts, cur: '', dead: false, x: 0, y: 0, yaw: 0, diedAt: 0, hitUntil: 0 }
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
  const BOLTS = 60
  const bolts = Array.from({ length: BOLTS }, () => { const o = bolt.scene.clone(); o.scale.setScalar(fit(bolt.scene, 1).k * 3); o.visible = false; scene.add(o); return { o, from: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, dur: 0 } })
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
  const total = [...units.values()].reduce((a, u) => a + u.figs.length, 0)
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicNodeMaterial({ map: blobTex, transparent: true, depthWrite: false }), total)
  blobs.frustumCulled = false; scene.add(blobs)
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), S = new THREE.Vector3()
  let lastT = -1

  ;(globalThis as any).__army = units // test hook
  return {
    update(shown: Sq[], t: number, dt: number) {
      const live = t !== lastT; lastT = t // battle paused: everyone freezes mid-stride
      const adt = live ? dt : 0
      clock += adt
      let bn = 0
      for (const q of shown) {
        const u = units.get(q.id)
        if (!u) continue
        const alive = q.flags & 2 ? 0 : Math.max(1, Math.ceil((q.str / 100) * u.figs.length))
        const dx = Number.isNaN(u.lx) ? 0 : q.x - u.lx, dy = Number.isNaN(u.ly) ? 0 : q.y - u.ly
        u.lx = q.x; u.ly = q.y
        if (adt > 0) u.spd = u.spd * 0.85 + (Math.hypot(dx, dy) / adt) * 0.15 // smoothed: frame jitter must not flip march/halt
        const speed = u.spd, moving = speed > 6, routed = !!(q.flags & 1)
        // the nearest enemy as drawn: who they face, fight or shoot at
        let foe: Sq | null = null, fd = Infinity
        for (const e of shown) if (e.house !== q.house && !(e.flags & 2)) { const d = Math.hypot(e.x - q.x, e.y - q.y); if (d < fd) { fd = d; foe = e } }
        const fighting = !moving && !routed && u.kind !== 'arch' && fd < 150, shooting = !routed && u.kind === 'arch' && fd < 340 && !moving
        // a squad changes what it's doing only once the new state has held for a moment, so ranks never stutter between poses
        const raw: Mode = routed || speed > (u.kind === 'cav' ? 45 : 30) ? 'run' : moving ? 'walk' : fighting ? 'fight' : shooting ? 'shoot' : 'idle'
        if (raw !== u.next) { u.next = raw; u.nextAt = clock }
        if (u.next !== u.mode && (clock - u.nextAt > 0.4 || !u.seen)) { if (u.next === 'fight' && u.seen) u.fightAt = clock; u.mode = u.next }
        const charging = u.mode === 'fight' && clock - u.fightAt < 1.3 // the first moments of contact: the line runs in
        const mode = u.mode
        const want = moving ? Math.atan2(dx, dy) : foe && fd < 400 ? Math.atan2(foe.x - q.x, foe.y - q.y) : u.yaw
        let dyaw = ((want - u.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        u.yaw += dyaw * Math.min(1, adt * 4)
        const cos = Math.cos(u.yaw), sin = Math.sin(u.yaw), cols = COLS[u.kind], gap = GAP[u.kind] * (routed ? 1.8 : 1)
        u.figs.forEach((f, i) => {
          if (i >= alive) {
            if (!f.dead && u.seen) { f.dead = true; f.diedAt = clock; play(f, QUAD(u.kind) ? 'Death' : Math.random() < 0.5 ? 'Death_A' : 'Death_B', true, 0.1) } // the body stays where he fell
            if (!u.seen) f.root.visible = false
            // the fallen lie a few seconds, then sink into the grass, so fords don't fill with bodies
            const age = clock - f.diedAt
            if (f.dead && age > 12) { f.root.visible = age < 14.5; f.root.position.y = W(f.x, f.y, 0).y - (age - 12) * 6 }
          } else {
            if (f.dead) { f.dead = false; f.cur = '' } // rallied
            f.root.visible = true
            const gx = ((i % cols) - (cols - 1) / 2) * gap, gy = (Math.floor(i / cols) - (Math.ceil(PER[u.kind] / cols) - 1) / 2) * gap
            const jx = ((i * 37) % 7) - 3, jy = ((i * 53) % 5) - 2
            f.x = q.x + gx * cos + gy * sin + jx; f.y = q.y - gx * sin + gy * cos + jy; f.yaw = u.yaw
            // in a fight the block presses forward into contact, front ranks surging and falling back
            if (mode === 'fight' && foe) { const k = Math.min(45, Math.max(0, fd - 55) * 0.5) * (charging ? 0.4 + (clock - u.fightAt) / 2.2 : 1) + Math.sin(clock * 3 + i) * 4; f.x += Math.sin(u.yaw) * k; f.y += Math.cos(u.yaw) * k }
            if (mode === 'fight' && clock > f.hitUntil + 1.2 && Math.random() < adt * 0.5) f.hitUntil = clock + 0.6 // takes a blow now and then
            const ts = moving ? THREE.MathUtils.clamp(speed / (u.kind === 'cav' ? 60 : 22), 0.6, 2.6) : 1
            if (QUAD(u.kind)) play(f, mode === 'run' || charging ? 'Gallop' : mode === 'walk' ? 'Walk' : mode === 'fight' ? (i % 2 ? 'Attack_Kick' : 'Attack_Headbutt') : 'Idle')
            else play(f, mode === 'run' || (charging && u.kind === 'inf') ? 'Running_A' : mode === 'walk' ? 'Walking_A' : mode === 'fight' ? (clock < f.hitUntil ? (i % 2 ? 'Hit_A' : 'Block_Hit') : MELEE[i % MELEE.length]) : mode === 'shoot' ? '2H_Ranged_Shooting' : u.kind === 'arch' ? '2H_Ranged_Aiming' : 'Idle')
            f.mixer.timeScale = ts
          }
          if (!(f.dead && clock - f.diedAt > 12)) f.root.position.copy(W(f.x, f.y, 0))
          f.root.rotation.y = f.yaw
          f.mixer.update(adt)
          if (f.root.visible) { const r = u.kind === 'ele' ? 44 : u.kind === 'cav' ? 26 : 13; P.copy(W(f.x, f.y, 0.7)); S.set(r * (f.dead ? 1.5 : 1), r * 0.8, 1); M.compose(P, Q, S); blobs.setMatrixAt(bn++, M) }
        })
        u.seen = true
        if (mode === 'fight' && Math.random() < adt * 5) { const f = u.figs[Math.floor(Math.random() * alive)]; if (f && !f.dead) puff(f.x + (Math.random() - 0.5) * 20, f.y + (Math.random() - 0.5) * 14) }
        // archers loose bolts at the enemy they face
        if (mode === 'shoot' && foe && clock - u.shotAt > 0.22) {
          u.shotAt = clock
          const f = u.figs[Math.floor(Math.random() * alive)]
          if (f && !f.dead) fire(W(f.x, f.y, 20), W(foe.x + (Math.random() - 0.5) * 40, foe.y + (Math.random() - 0.5) * 30, 6))
        }
      }
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
