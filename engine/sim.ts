// Deterministic battle engine. Same seed + same general answers = same replay.
import { HOUSES, FORDS, NODES, EDGES, camp, dist, edgeKey, edgeKind, nearestNode, node, route, SPEED, type HouseId } from './map.ts'
import { encrypt, partial, reveal, share } from './cipher.ts'

export type UnitType = 'inf' | 'arch' | 'cav' | 'ele'
export type Verb = 'hold' | 'move' | 'attack' | 'screen' | 'escort' | 'scout'
export const VERBS: Verb[] = ['hold', 'move', 'attack', 'screen', 'escort', 'scout']
export type Method = 'plain' | 'cipher' | 'double'
export type Smoke = 'advance' | 'hold' | 'fall back' | 'regroup'
export const SMOKES: Smoke[] = ['advance', 'hold', 'fall back', 'regroup']

export interface Order { to: string; verb: Verb; where: string; method: Method; route?: 'road' | 'hill' }
export interface Decision {
  thought: string
  orders: Order[]
  letter?: { to: HouseId; text: string; method: Method }
  decoy?: { to: string; verb: Verb; where: string }
  smoke?: Smoke
}
export interface Sighting { id: string; house: HouseId; type: UnitType; name: string; place: string; x: number; y: number; strength: number; tick: number }
export interface Intel { letter: string; from: HouseId; text: string; readable: boolean }
export interface GeneralView {
  house: HouseId; watch: number; watches: number; tick: number; doctrine: string
  own: Sighting[]; enemies: Sighting[]
  inbox: { from: HouseId; text: string }[]
  intel: Intel[]
  smoke: { house: HouseId; code: Smoke; watch: number }[]
  truces: HouseId[]
}
export interface General {
  model: string
  persona(h: HouseId): Promise<{ name: string; line: string }>
  decide(v: GeneralView): Promise<Decision>
}
export type Ev = { seq: number; t: number; type: string; [k: string]: any }
export interface Frame { t: number; s: number[]; c: [string, number, number][] }
export interface WatchFile { watch: number; start: number; events: Ev[]; frames: Frame[]; beliefs: Record<string, Record<string, [number, number, number]>> }

export const TICKS = 300 // ticks per watch (10/s game time)
const FRAME = 5 // two frames per game second
const COURIER_SPEED = 2.5
const UNIT: Record<UnitType, { speed: number; catchR: number; catchP: number; range: number }> = {
  inf: { speed: 0.7, catchR: 30, catchP: 0.03, range: 25 },
  arch: { speed: 0.7, catchR: 70, catchP: 0.01, range: 60 }, // shoots couriers: letter destroyed
  cav: { speed: 1.4, catchR: 45, catchP: 0.08, range: 25 },
  ele: { speed: 0.45, catchR: 0, catchP: 0, range: 25 },
}
const MOD: Record<string, number> = { 'cav>arch': 1.5, 'ele>cav': 1.8, 'ele>inf': 1.3, 'arch>inf': 1.2, 'inf>cav': 1.2 }
const ROSTER: [UnitType, number, string][] = [['inf', 1, 'FIRST FOOT'], ['inf', 2, 'SECOND FOOT'], ['arch', 1, 'BOWMEN'], ['cav', 1, 'HORSE'], ['ele', 1, 'ELEPHANTS']]
export const KEYWORD: Record<HouseId, string> = { rhino: 'MONSOON', kite: 'TALON', orchid: 'BLOSSOM', tiger: 'STRIPE' }
const VERB_TEXT: Record<Verb, string> = { hold: 'HOLD AT', move: 'MARCH TO', attack: 'ATTACK AT', screen: 'WATCH THE ROADS AT', escort: 'ESCORT TO', scout: 'SCOUT' }

interface Squad { id: string; house: HouseId; type: UnitType; name: string; x: number; y: number; node: string; path: string[]; strength: number; routed: boolean; dead: boolean; engaged: boolean; satchel: Letter[] }
interface Letter { id: string; from: HouseId; to: string; kind: 'order' | 'report' | 'letter' | 'decoy'; plain: string; cipher: string | null; where?: string; sightings?: Sighting[]; carried?: Letter[]; truce?: number; delivered: boolean }
interface Courier { id: string; house: HouseId; letter: Letter; x: number; y: number; node: string; path: string[]; target: string; depart: number; expire: number; live: boolean }

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function step(e: { x: number; y: number; node: string; path: string[] }, speed: number) {
  let budget = speed
  while (budget > 0 && e.path.length) {
    const nx = node(e.path[0]), mult = SPEED[edgeKind(e.node, e.path[0]) ?? 'road'], d = dist(e, nx), can = budget * mult
    if (can >= d) { e.x = nx.x; e.y = nx.y; e.node = e.path.shift()!; budget -= d / mult }
    else { e.x += ((nx.x - e.x) / d) * can; e.y += ((nx.y - e.y) / d) * can; budget = 0 }
  }
}

export async function runBattle(o: { id: string; seed: number; generals: Record<HouseId, General>; doctrines?: Partial<Record<HouseId, string>>; watches?: number }) {
  const W = o.watches ?? 30, rnd = rng(o.seed)
  let seq = 0, tick = 0, watch = 0, letterN = 0, courierN = 0
  let ev: Ev[] = []
  const all: Ev[] = []
  const emit = (type: string, data: object = {}) => { const e = { seq: seq++, t: tick, type, ...data }; ev.push(e); all.push(e) }

  const squads: Squad[] = HOUSES.flatMap(h => ROSTER.map(([type, n, name], i) => {
    const c = node(camp(h))
    return { id: `${h}-${type}-${n}`, house: h, type, name, x: c.x + (i - 2) * 14, y: c.y + (c.y < 500 ? -1 : 1) * 10, node: c.id, path: [], strength: 100, routed: false, dead: false, engaged: false, satchel: [] }
  }))
  const sq = (id: string) => squads.find(s => s.id === id)
  const couriers: Courier[] = []
  const per = <T>(f: () => T) => Object.fromEntries(HOUSES.map(h => [h, f()])) as Record<HouseId, T>
  const known = per(() => per(() => new Map<string, string>()))
  const captured = per(() => [] as Letter[])
  const shown = new Map<string, string>()
  const inbox = per(() => [] as { from: HouseId; text: string }[])
  const smokes: { house: HouseId; code: Smoke; watch: number }[] = []
  const truce = new Map<string, number>()
  const fate = new Map<string, string>()
  const engaged = new Set<string>()
  const sight = (s: Squad): Sighting => ({ id: s.id, house: s.house, type: s.type, name: s.name, place: nearestNode(s).name, x: Math.round(s.x), y: Math.round(s.y), strength: Math.round(s.strength), tick })
  const belief = per(() => new Map(squads.map(s => [s.id, sight(s)])))
  const atTruce = (a: HouseId, b: HouseId) => (truce.get(edgeKey(a, b)) ?? 0) >= watch
  const enemies = (a: HouseId, b: HouseId) => a !== b && !atTruce(a, b)
  let readableDecodes = 0, ended: { winner: HouseId; reason: string } | null = null

  const letter = (from: HouseId, to: string, kind: Letter['kind'], plain: string, method: Method): Letter =>
    ({ id: `L${letterN++}`, from, to, kind, plain, cipher: method === 'plain' ? null : encrypt(plain, KEYWORD[from]), delivered: false })

  function dispatch(house: HouseId, L: Letter, from: { x: number; y: number; node: string }, target: string, prefer: 'road' | 'hill' | 'any', depart: number, avoid?: Set<string>) {
    const path = route(from.node, target.endsWith('-camp') ? target : sq(target)!.node, prefer, avoid)
    const c: Courier = { id: `c${courierN++}`, house, letter: L, x: from.x, y: from.y, node: from.node, path, target, depart, expire: depart + 3 * TICKS, live: true }
    couriers.push(c)
    fate.set(L.id, 'in flight')
    emit('courier', { id: c.id, house, letter: L.id, kind: L.kind, to: target, path: [from.node, ...path], depart, plain: L.plain, cipher: L.cipher })
    return path
  }

  // A letter reaching `house`'s camp: own reports update belief, captured mail goes to the clerks.
  function absorb(house: HouseId, L: Letter) {
    for (const s of L.sightings ?? []) if ((belief[house].get(s.id)?.tick ?? -1) < s.tick) belief[house].set(s.id, s)
    for (const c of L.carried ?? []) absorb(house, c)
    if (L.from === house || captured[house].includes(L)) return
    captured[house].push(L)
    emit('intel', { house, letter: L.id, from: L.from, text: L.cipher ? partial(L.cipher, known[house][L.from]) : L.plain, plain: !L.cipher })
  }

  function deliver(c: Courier) {
    const L = c.letter
    c.live = false
    if (L.delivered) return // the slower of a two-courier pair
    L.delivered = true
    fate.set(L.id, 'delivered')
    emit('delivered', { courier: c.id, letter: L.id, house: c.house })
    const s = sq(L.to)
    if (L.kind === 'order' && s && !s.routed && !s.dead) s.path = route(s.node, L.where!)
    if (L.kind === 'report') absorb(c.house, L)
    if (L.kind === 'letter') {
      const to = L.to.replace('-camp', '') as HouseId
      inbox[to].push({ from: L.from, text: L.plain })
      if (L.truce) { truce.set(edgeKey(L.from, to), L.truce); emit('truce', { a: L.from, b: to, until: L.truce }) }
    }
  }

  function apply(h: HouseId, d: Decision) {
    const c = node(camp(h)), from = { x: c.x, y: c.y, node: c.id }
    if (d.thought) emit('thought', { house: h, text: String(d.thought).slice(0, 280) })
    const mine = (id: string) => sq(id)?.house === h // dead squads included: the general doesn't know
    for (const ord of (d.orders ?? []).slice(0, 3)) {
      if (!mine(ord.to) || !VERBS.includes(ord.verb) || !NODES.some(n => n.id === ord.where)) { emit('invalid', { house: h, order: ord }); continue }
      const L = letter(h, ord.to, 'order', `${sq(ord.to)!.name}, ${VERB_TEXT[ord.verb]} ${node(ord.where).name}.`, ord.method)
      L.where = ord.where
      const depart = tick + (ord.method === 'plain' ? 0 : TICKS) // enciphering costs a watch
      const p = dispatch(h, L, from, ord.to, ord.route ?? 'any', depart)
      if (ord.method === 'double') {
        const used = new Set(p.map((n, i) => edgeKey(i ? p[i - 1] : c.id, n)))
        dispatch(h, L, from, ord.to, ord.route ?? 'any', depart, used)
      }
    }
    if (d.letter && HOUSES.includes(d.letter.to) && d.letter.to !== h) {
      const L = letter(h, camp(d.letter.to), 'letter', String(d.letter.text).toUpperCase().slice(0, 200), d.letter.method)
      const m = L.plain.match(/TRUCE/) // ponytail: keyword match; let the recipient accept/refuse once models write letters
      if (m) L.truce = watch + 6
      dispatch(h, L, from, camp(d.letter.to), 'any', tick + (d.letter.method === 'plain' ? 0 : TICKS))
    }
    if (d.decoy && mine(d.decoy.to) && NODES.some(n => n.id === d.decoy!.where)) {
      const L = letter(h, d.decoy.to, 'decoy', `${sq(d.decoy.to)!.name}, ${VERB_TEXT[d.decoy.verb] ?? 'MARCH TO'} ${node(d.decoy.where).name}.`, 'plain')
      dispatch(h, L, from, d.decoy.to, 'road', tick)
    }
    if (d.smoke && SMOKES.includes(d.smoke)) {
      smokes.push({ house: h, code: d.smoke, watch })
      emit('smoke', { house: h, code: d.smoke })
      const own = squads.filter(s => s.house === h && !s.dead && !s.routed)
      const lead = own.reduce((a, b) => (a.strength >= b.strength ? a : b), own[0])
      for (const s of own) {
        const nearestFord = FORDS.reduce((a, b) => (dist(node(a), s) <= dist(node(b), s) ? a : b))
        const to = { advance: nearestFord, hold: s.node, 'fall back': camp(h), regroup: lead?.node ?? s.node }[d.smoke]
        s.path = route(s.node, to)
      }
    }
  }

  function tickOnce() {
    for (const s of squads) {
      if (s.dead || s.engaged) continue
      step(s, UNIT[s.type].speed)
      if (s.routed && !s.path.length && s.node === camp(s.house) && (s.strength += 0.05) >= 60) { s.routed = false; emit('rally', { squad: s.id }) }
    }
    for (const c of couriers) {
      if (!c.live || tick < c.depart) continue
      step(c, COURIER_SPEED)
      const target = sq(c.letter.to)
      if (!c.path.length) {
        if (!target) deliver(c)
        else if (target.dead) { c.live = false; fate.set(c.letter.id, 'lost'); emit('lost', { courier: c.id, letter: c.letter.id, house: c.house, why: 'nobody left to receive it', x: Math.round(c.x), y: Math.round(c.y) }) }
        else if (dist(c, target) <= 40) deliver(c)
        else { c.path = route(c.node, target.path[0] ?? target.node); if (!c.path.length) deliver(c) }
        if (!c.live) continue
      }
      const misty = node(c.node).mist || (c.path[0] && node(c.path[0]).mist)
      if ((misty && rnd() < 0.002) || tick > c.expire) {
        c.live = false
        if (!c.letter.delivered) fate.set(c.letter.id, 'lost')
        emit('lost', { courier: c.id, letter: c.letter.id, house: c.house, why: misty ? 'lost in the mist' : 'never found its squad', x: Math.round(c.x), y: Math.round(c.y) })
        continue
      }
      for (const s of squads) {
        if (s.dead || s.routed || !enemies(s.house, c.house) || c.letter.to === camp(s.house)) continue // envoys pass their hosts
        const u = UNIT[s.type]
        if (dist(s, c) > u.catchR || rnd() >= u.catchP) continue
        c.live = false
        if (!c.letter.delivered) fate.set(c.letter.id, s.type === 'arch' ? 'killed' : 'caught')
        if (s.type !== 'arch') s.satchel.push(c.letter)
        emit(s.type === 'arch' ? 'killed' : 'caught', { courier: c.id, letter: c.letter.id, house: c.house, by: s.id, x: Math.round(c.x), y: Math.round(c.y) })
        break
      }
    }
    const now = new Set<string>()
    for (const s of squads) {
      s.engaged = false
      if (s.dead || s.routed) continue
      let foe: Squad | undefined, best = UNIT[s.type].range
      for (const e of squads) if (!e.dead && enemies(s.house, e.house) && dist(s, e) <= best) { best = dist(s, e); foe = e }
      if (!foe) continue
      s.engaged = true
      const k = [s.id, foe.id].sort().join('~')
      now.add(k)
      if (!engaged.has(k)) emit('clash', { a: s.id, b: foe.id, x: Math.round(foe.x), y: Math.round(foe.y) })
      const atFord = FORDS.some(f => dist(node(f), foe!) < 40)
      foe.strength -= 0.12 * (MOD[`${s.type}>${foe.type}`] ?? 1) * (s.strength / 100) * (foe.type === 'inf' && atFord ? 0.7 : 1)
    }
    engaged.clear(); now.forEach(k => engaged.add(k))
    for (const s of squads) {
      if (s.dead) continue
      if (s.strength <= 0) { s.dead = true; s.strength = 0; emit('destroyed', { squad: s.id }); continue }
      if (!s.routed && s.strength < 35) { s.routed = true; s.engaged = false; s.path = route(s.node, camp(s.house)); emit('rout', { squad: s.id }) }
    }
    for (const h of HOUSES) {
      const c = node(camp(h))
      const raider = squads.find(s => !s.dead && !s.routed && enemies(s.house, h) && dist(s, c) < 25)
      if (raider && !squads.some(s => s.house === h && !s.dead && !s.routed && dist(s, c) < 80)) {
        ended = { winner: raider.house, reason: `${raider.name} of ${raider.house.toUpperCase()} took the ${h.toUpperCase()} standard` }
        emit('standard', { house: h, by: raider.id })
        return
      }
    }
  }

  const generals = o.generals
  const personas = Object.fromEntries(await Promise.all(HOUSES.map(async h => [h, await generals[h].persona(h)])))
  const init = {
    id: o.id, seed: o.seed, watches: W, ticksPerWatch: TICKS, frameEvery: FRAME,
    map: { nodes: NODES, edges: EDGES, fords: FORDS },
    houses: HOUSES.map(h => ({ id: h, model: generals[h].model, ...personas[h] })),
    squads: squads.map(({ id, house, type, name }) => ({ id, house, type, name })),
  }
  const watches: WatchFile[] = []

  for (watch = 1; watch <= W && !ended; watch++) {
    ev = []
    const frames: Frame[] = []
    emit('watch', { watch })
    // clerks work on captured mail
    for (const g of HOUSES) for (const h of HOUSES) {
      const mail = captured[g].filter(L => L.from === h && L.cipher)
      if (!mail.length) continue
      reveal(mail.map(L => L.cipher!), known[g][h], KEYWORD[h], 1 + mail.length)
      for (const L of mail) {
        const text = partial(L.cipher!, known[g][h]), k = `${g}:${L.id}`
        if (shown.get(k) === text) continue
        const readable = share(L.cipher!, known[g][h]) >= 0.8
        if (readable && !shown.has(`${k}:r`)) { shown.set(`${k}:r`, '1'); readableDecodes++ }
        shown.set(k, text)
        emit('decode', { house: g, letter: L.id, text, readable })
      }
    }
    // reports home every second watch
    if (watch % 2 === 0) for (const s of squads) {
      if (s.dead) continue
      const seen = squads.filter(e => !e.dead && e.house !== s.house && dist(e, s) < 160)
      const L = letter(s.house, camp(s.house), 'report', `${s.name} AT ${nearestNode(s).name}, STRENGTH ${Math.round(s.strength)}.${seen.length ? ' SEEN: ' + seen.map(e => `${e.house.toUpperCase()} ${e.name}`).join(', ') + '.' : ''}`, 'plain')
      L.sightings = [sight(s), ...seen.map(sight)]
      L.carried = s.satchel.splice(0)
      if (dist(s, node(camp(s.house))) < 60) { absorb(s.house, L); continue }
      dispatch(s.house, L, { x: s.x, y: s.y, node: s.node }, camp(s.house), 'any', tick)
    }
    const beliefs = Object.fromEntries(HOUSES.map(h => [h, Object.fromEntries([...belief[h]].map(([id, b]) => [id, [b.x, b.y, tick - b.tick] as [number, number, number]]))]))
    const views = HOUSES.map((h): GeneralView => {
      const b = [...belief[h].values()]
      return {
        house: h, watch, watches: W, tick, doctrine: o.doctrines?.[h] ?? 'hold',
        own: b.filter(s => s.house === h), enemies: b.filter(s => s.house !== h),
        inbox: inbox[h].splice(0),
        intel: captured[h].map(L => ({ letter: L.id, from: L.from, text: L.cipher ? partial(L.cipher, known[h][L.from]) : L.plain, readable: !L.cipher || share(L.cipher, known[h][L.from]) >= 0.8 })),
        smoke: smokes.slice(), truces: HOUSES.filter(x => x !== h && atTruce(h, x)),
      }
    })
    const decisions = await Promise.all(HOUSES.map((h, i) => generals[h].decide(views[i])))
    HOUSES.forEach((h, i) => apply(h, decisions[i]))
    for (let t = 0; t < TICKS && !ended; t++) {
      if (tick % FRAME === 0) frames.push({
        t: tick,
        s: squads.flatMap(s => [Math.round(s.x), Math.round(s.y), Math.round(s.strength), (s.routed ? 1 : 0) | (s.dead ? 2 : 0)]),
        c: couriers.filter(c => c.live && tick >= c.depart).map(c => [c.id, Math.round(c.x), Math.round(c.y)]),
      })
      tickOnce()
      tick++
    }
    watches.push({ watch, start: (watch - 1) * TICKS, events: ev, frames, beliefs })
  }

  // final standing
  const holders = Object.fromEntries(FORDS.map(f => {
    const hs = [...new Set(squads.filter(s => !s.dead && !s.routed && dist(s, node(f)) < 50).map(s => s.house))]
    return [f, hs.length === 1 ? hs[0] : null]
  }))
  const scores = Object.fromEntries(HOUSES.map(h => [h, Object.values(holders).filter(x => x === h).length * 100 + Math.round(squads.filter(s => s.house === h && !s.dead).reduce((a, s) => a + s.strength, 0))]))
  const twoFords = HOUSES.find(h => Object.values(holders).filter(x => x === h).length >= 2)
  const fin = ended as { winner: HouseId; reason: string } | null // set inside tickOnce; TS can't see it
  const winner = fin?.winner ?? twoFords ?? HOUSES.reduce((a, b) => (scores[a] >= scores[b] ? a : b))
  const reason = fin?.reason ?? (twoFords ? `${twoFords.toUpperCase()} holds two fords` : `${winner.toUpperCase()} leads on score`)
  ev = watches.at(-1)!.events
  emit('end', { winner, reason })

  const count = (t: string) => all.filter(e => e.type === t).length
  const beliefError = Object.fromEntries(HOUSES.map(h => {
    const errs = watches.map(w => {
      const b = Object.entries(w.beliefs[h]), f = w.frames[0]
      return b.reduce((a, [id, [x, y]]) => { const i = squads.findIndex(s => s.id === id) * 4; return a + Math.hypot(f.s[i] - x, f.s[i + 1] - y) }, 0) / b.length
    })
    return [h, Math.round(errs.reduce((a, b) => a + b, 0) / errs.length)]
  }))
  const letters = all.filter(e => e.type === 'courier' && e.kind !== 'report').map(e => ({ id: e.letter, house: e.house, kind: e.kind, to: e.to, plain: e.plain, cipher: e.cipher, fate: fate.get(e.letter) }))
  const end = { winner, reason, fords: holders, scores, letters: [...new Map(letters.map(l => [l.id, l])).values()] }
  const stats = {
    interceptions: count('caught') + count('killed'), caught: count('caught'), killed: count('killed'), lost: count('lost'), delivered: count('delivered'),
    readableDecodes, clashes: count('clash'), routs: count('rout'), beliefError, invalidOrders: count('invalid'),
  }
  const manifest = { id: o.id, seed: o.seed, houses: init.houses, winner, reason, watches: watches.length, files: ['init.json', ...watches.map(w => `watch${w.watch}.json`), 'end.json', 'stats.json'] }
  return { manifest, init, watches, end, stats }
}
