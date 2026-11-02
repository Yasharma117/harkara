// 3D armies: animated low-poly soldiers (KayKit Adventurers, CC0) and horses (Quaternius, CC0) in ranks, tinted per house.
// Foot march, fight and fall; archers loose crossbow bolts that fly; horsemen gallop. Elephants stay painted cut-outs
// (diorama.ts) until a 3D elephant arrives. Models: client/public/models (licences in LICENSES.txt).
import * as THREE from 'three/webgpu'
import { texture, uv, vec3, mix, smoothstep, max, min } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'

type Sq = { id: string; house: string; type: string; x: number; y: number; str: number; flags: number }
type Kind = 'inf' | 'arch' | 'cav'
const PER: Record<Kind, number> = { inf: 12, arch: 8, cav: 5 }
const COLS: Record<Kind, number> = { inf: 4, arch: 4, cav: 3 }
const GAP: Record<Kind, number> = { inf: 15, arch: 16, cav: 30 }
const HEIGHT = { foot: 34, horse: 34, rider: 27 }
const MELEE = ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Horizontal', 'Block_Attack']

interface Fig { root: THREE.Object3D; mixer: THREE.AnimationMixer; acts: Map<string, THREE.AnimationAction>; cur: string; dead: boolean; rider?: Fig; x: number; y: number; yaw: number }
type Mode = 'walk' | 'run' | 'fight' | 'shoot' | 'idle'
interface Unit { kind: Kind; house: string; figs: Fig[]; lx: number; ly: number; yaw: number; shotAt: number; seen: boolean; spd: number; mode: Mode; next: Mode; nextAt: number }

export async function army3d(scene: THREE.Scene, W: (x: number, y: number, lift?: number) => THREE.Vector3, squads: { id: string; house: string; type: string }[], HOUSE: Record<string, THREE.Color>) {
  const loader = new GLTFLoader()
  const load = (f: string) => loader.loadAsync(`models/${f}`)
  const [knight, rogue, horse, bow, bolt] = await Promise.all(['Knight.glb', 'Rogue_Hooded.glb', 'Horse.glb', 'crossbow_2handed.gltf', 'arrow.gltf'].map(load))

  // house colour goes on the neutral, light parts of the paint (armour, cloth); skin, wood and leather keep their colours
  const mats = new Map<string, THREE.Material>()
  const houseMat = (m: THREE.MeshStandardMaterial, house: string) => {
    const key = `${m.uuid}|${house}`
    if (mats.has(key)) return mats.get(key)!
    const nm = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.05 })
    if (m.map) {
      const c = texture(m.map, uv()).rgb, hi = max(c.r, max(c.g, c.b)), sat = hi.sub(min(c.r, min(c.g, c.b)))
      const neutral = smoothstep(0.08, 0.26, sat).oneMinus().mul(smoothstep(0.12, 0.5, hi)) // edges low→high: reversed smoothstep is undefined on the GPU
      const cloth = max(smoothstep(0.25, 0.45, c.r.sub(max(c.g, c.b))), smoothstep(0.06, 0.16, c.g.sub(max(c.r, c.b)))) // the models' red tunics and green hoods are team colour: make them the house's
      const hc = vec3(HOUSE[house].r, HOUSE[house].g, HOUSE[house].b)
      nm.colorNode = mix(mix(c, hc.mul(hi.mul(1.25).add(0.18)), neutral.mul(0.85)), hc.mul(hi.mul(1.2).add(0.05)), cloth)
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
  const footFit = fit(knight.scene, HEIGHT.foot), rogueFit = fit(rogue.scene, HEIGHT.foot), horseFit = fit(horse.scene, HEIGHT.horse), riderFit = fit(knight.scene, HEIGHT.rider)

  const make = (src: typeof knight, f: { k: number; foot: number }, house: string, prefix = ''): Fig => {
    const root = SkeletonUtils.clone(src.scene)
    root.scale.setScalar(f.k)
    root.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) { m.frustumCulled = false; m.material = houseMat(m.material as THREE.MeshStandardMaterial, house) }
    })
    const holder = new THREE.Group(); holder.add(root); root.position.y = f.foot
    const mixer = new THREE.AnimationMixer(root), acts = new Map<string, THREE.AnimationAction>()
    for (const clip of src.animations) acts.set(clip.name.replace(prefix, ''), mixer.clipAction(clip))
    scene.add(holder)
    return { root: holder, mixer, acts, cur: '', dead: false, x: 0, y: 0, yaw: 0 }
  }
  // hide the weapons a model carries that don't fit its role, keep one: knights keep sword and shield, archers get a crossbow
  const strip = (fig: Fig, keep: RegExp) => fig.root.traverse(o => { if ((o as THREE.Mesh).isMesh && o.parent?.name.startsWith('handslot') && !keep.test(o.name)) o.visible = false })
  const hand = (fig: Fig, side: 'r' | 'l') => { let b: THREE.Object3D | undefined; fig.root.traverse(o => { if (o.name === `handslot.${side}`) b = o }); return b }

  const units = new Map<string, Unit>()
  for (const s of squads) {
    if (s.type === 'ele') continue
    const kind = s.type as Kind, figs: Fig[] = []
    for (let i = 0; i < PER[kind]; i++) {
      if (kind === 'cav') {
        const h = make(horse, horseFit, s.house, 'AnimalArmature|')
        const r = make(knight, riderFit, s.house); h.root.add(r.root); scene.remove(r.root)
        r.root.position.set(0, HEIGHT.horse * 0.55, -1); h.rider = r
        play(r, 'Sit_Chair_Idle')
        figs.push(h)
      } else {
        const f = kind === 'arch' ? make(rogue, rogueFit, s.house) : make(knight, footFit, s.house)
        if (kind === 'arch') { strip(f, /^$/); const b = bow.scene.clone(); hand(f, 'r')?.add(b) }
        figs.push(f)
      }
    }
    units.set(s.id, { kind, house: s.house, figs, lx: NaN, ly: NaN, yaw: 0, shotAt: 0, seen: false, spd: 0, mode: 'idle', next: 'idle', nextAt: 0 })
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
        if (u.next !== u.mode && (clock - u.nextAt > 0.4 || !u.seen)) u.mode = u.next
        const mode = u.mode
        const want = moving ? Math.atan2(dx, dy) : foe && fd < 400 ? Math.atan2(foe.x - q.x, foe.y - q.y) : u.yaw
        let dyaw = ((want - u.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        u.yaw += dyaw * Math.min(1, adt * 4)
        const cos = Math.cos(u.yaw), sin = Math.sin(u.yaw), cols = COLS[u.kind], gap = GAP[u.kind] * (routed ? 1.8 : 1)
        u.figs.forEach((f, i) => {
          if (i >= alive) {
            if (!f.dead && u.seen) { f.dead = true; play(f, u.kind === 'cav' ? 'Death' : Math.random() < 0.5 ? 'Death_A' : 'Death_B', true, 0.1); if (f.rider) play(f.rider, 'Death_A', true, 0.1) } // the body stays where he fell
            if (!u.seen) f.root.visible = false
          } else {
            if (f.dead) { f.dead = false; f.cur = '' } // rallied
            f.root.visible = true
            const gx = ((i % cols) - (cols - 1) / 2) * gap, gy = (Math.floor(i / cols) - (Math.ceil(PER[u.kind] / cols) - 1) / 2) * gap
            const jx = ((i * 37) % 7) - 3, jy = ((i * 53) % 5) - 2
            f.x = q.x + gx * cos + gy * sin + jx; f.y = q.y - gx * sin + gy * cos + jy; f.yaw = u.yaw
            const ts = moving ? THREE.MathUtils.clamp(speed / (u.kind === 'cav' ? 60 : 22), 0.6, 2.6) : 1
            if (u.kind === 'cav') play(f, mode === 'run' ? 'Gallop' : mode === 'walk' ? 'Walk' : mode === 'fight' ? (i % 2 ? 'Attack_Kick' : 'Attack_Headbutt') : 'Idle')
            else play(f, mode === 'run' ? 'Running_A' : mode === 'walk' ? 'Walking_A' : mode === 'fight' ? MELEE[i % MELEE.length] : mode === 'shoot' ? '2H_Ranged_Shooting' : u.kind === 'arch' ? '2H_Ranged_Aiming' : 'Idle')
            f.mixer.timeScale = ts
          }
          f.root.position.copy(W(f.x, f.y, 0)); f.root.rotation.y = f.yaw
          f.mixer.update(adt); f.rider?.mixer.update(adt)
          if (f.root.visible) { const r = u.kind === 'cav' ? 26 : 13; P.copy(W(f.x, f.y, 0.7)); S.set(r * (f.dead ? 1.5 : 1), r * 0.8, 1); M.compose(P, Q, S); blobs.setMatrixAt(bn++, M) }
        })
        u.seen = true
        // archers loose bolts at the enemy they face
        if (mode === 'shoot' && foe && clock - u.shotAt > 0.22) {
          u.shotAt = clock
          const f = u.figs[Math.floor(Math.random() * alive)]
          if (f && !f.dead) fire(W(f.x, f.y, 20), W(foe.x + (Math.random() - 0.5) * 40, foe.y + (Math.random() - 0.5) * 30, 6))
        }
      }
      blobs.count = bn; blobs.instanceMatrix.needsUpdate = true
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
