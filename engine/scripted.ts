// Code generals for cycle 0 and CI: same interface a model general will implement.
import { node, dist, FORDS, NODES, type HouseId } from './map.ts'
import { TICKS, type Decision, type General, type Method, type Order, type Sighting } from './sim.ts'

const PLAN: Record<HouseId, { a: string; b: string; screen: string; method: Method; persona: [string, string] }> = {
  rhino: { a: 'F1', b: 'F2', screen: 'n-ferry', method: 'cipher', persona: ['The Grey Rhino', 'Slow feet, sealed letters. Nobody reads what we write.'] },
  kite: { a: 'F3', b: 'F2', screen: 'north-village', method: 'plain', persona: ['Kite of the Gorge', 'Speed over secrecy. By the time they read it, we are there.'] },
  orchid: { a: 'F1', b: 'F2', screen: 's-ferry', method: 'cipher', persona: ['Lady of Orchids', 'Let them chase the riders I want them to catch.'] },
  tiger: { a: 'F3', b: 'F2', screen: 'south-village', method: 'double', persona: ['Old Stripe', 'Two riders, two roads. One always gets through.'] },
}
const ASSIGN: Record<string, 'a' | 'b' | 'screen'> = { 'inf-1': 'a', 'ele-1': 'a', 'inf-2': 'b', 'arch-1': 'b', 'cav-1': 'screen' }
const LETTERS: Partial<Record<HouseId, { watch: number; to: HouseId; text: string }>> = {
  rhino: { watch: 3, to: 'orchid', text: 'Truce until the ninth watch. Keep your horse off the west ford.' },
  tiger: { watch: 4, to: 'kite', text: 'Truce. We share the east ford and take the middle together.' },
}
const placeOf = (text: string) => NODES.find(n => FORDS.includes(n.id) && text.includes(n.name))?.id

export function scripted(h: HouseId): General {
  const p = PLAN[h], lastSent = new Map<string, number>(), override = new Map<string, string>(), readSeen = new Set<string>()
  let smoked = false
  return {
    model: 'scripted',
    persona: async () => ({ name: p.persona[0], line: p.persona[1] }),
    async decide(v): Promise<Decision> {
      const notes: string[] = [], orders: Order[] = []
      const age = (s: Sighting) => Math.round((v.tick - s.tick) / TICKS)
      const want = (id: string) => override.get(id) ?? p[ASSIGN[id.slice(h.length + 1)]]
      const order = (to: string, verb: Order['verb'], where: string) => {
        if (orders.length >= 3 || orders.some(o => o.to === to)) return // cap here, so unsent orders get retried next watch
        orders.push({ to, verb, where, method: p.method, route: v.watch % 2 ? 'road' : 'hill' })
        lastSent.set(to, v.watch)
      }
      // react to enemy mail we can now read
      for (const i of v.intel) {
        if (!i.readable || readSeen.has(i.letter)) continue
        readSeen.add(i.letter)
        const f = placeOf(i.text)
        if (f && (f === p.a || f === p.b)) {
          override.set(`${h}-cav-1`, f)
          order(`${h}-cav-1`, 'attack', f)
          notes.push(`${i.from} mail says they move on ${node(f).name}. Horse rides there.`)
        }
      }
      // reinforce a ford the reports say we are losing
      for (const f of [p.a, p.b]) {
        const near = (s: Sighting, r: number) => dist(s, node(f)) < r
        const ours = v.own.filter(s => near(s, 80)).reduce((a, s) => a + s.strength, 0)
        const theirs = v.enemies.filter(s => near(s, 120) && !v.truces.includes(s.house))
        const t = theirs.reduce((a, s) => a + s.strength, 0)
        if (t > ours * 1.2 && theirs.length) {
          const reserve = v.own.find(s => s.type === 'ele' || s.type === 'arch')
          if (reserve && want(reserve.id) !== f) {
            override.set(reserve.id, f)
            order(reserve.id, 'attack', f)
            notes.push(`${theirs[0].house} ${theirs[0].name} at ${node(f).name}, report ${age(theirs[0])} watches old. Sending ${reserve.name}.`)
          }
        }
      }
      // (re)send standing orders to squads not where they should be
      for (const s of v.own) {
        const w = want(s.id), sent = lastSent.get(s.id)
        if (age(s) > 6) continue // silent for six watches: presumed lost
        if (dist(s, node(w)) > 60 && (sent === undefined || v.watch - sent >= 5)) {
          order(s.id, s.type === 'cav' ? 'screen' : 'hold', w)
          if (sent !== undefined) notes.push(`No word that ${s.name} reached ${node(w).name}; last seen ${s.place}, ${age(s)} watches ago. Resending.`)
        }
      }
      // ---- aggression: generals that only hold fords make dull battles. Strike where reports say the enemy is weak,
      // hunt with horse, and go all in on the fords late. Acting on old reports is the point: sometimes the strike lands
      // on empty ground, sometimes on a stronger army that moved in since.
      const nearestNode = (x: number, y: number) => NODES.reduce((a, n) => (dist(n, { x, y }) < dist(a, { x, y }) ? n : a))
      const foes = v.enemies.filter(s => !v.truces.includes(s.house) && age(s) <= 4)
      const free = (types: string[]) => v.own.filter(s => types.includes(s.type) && !orders.some(o => o.to === s.id) && (lastSent.get(s.id) ?? -9) < v.watch - 2)
      if (v.watch >= 4 && v.watch % 3 === (['rhino', 'kite', 'orchid', 'tiger'].indexOf(h) % 3)) {
        // the weakest enemy reported near one of our fords: send our strongest free squad at it
        const near = foes.filter(s => [p.a, p.b, ...FORDS].some(f => dist(s, node(f)) < 160)).sort((x, y) => x.strength - y.strength)[0]
        const hammer = free(['ele', 'inf', 'cav']).sort((x, y) => y.strength - x.strength)[0]
        if (near && hammer) {
          const at = nearestNode(near.x, near.y).id
          override.set(hammer.id, at); order(hammer.id, 'attack', at)
          notes.push(`${near.house} ${near.name} looks weak at ${near.place} (report ${age(near)} watches old). ${hammer.name} attack.`)
        }
      }
      const horse = free(['cav'])[0], prey = foes.filter(s => s.type === 'arch' || s.type === 'inf').sort((x, y) => dist(x, horse ?? x) - dist(y, horse ?? y))[0]
      if (horse && prey && v.watch >= 6 && v.watch % 4 === 1) { const at = nearestNode(prey.x, prey.y).id; override.set(horse.id, at); order(horse.id, 'attack', at); notes.push(`Horse ride down ${prey.house} ${prey.name} at ${prey.place}.`) }
      if (v.watch >= 21 && v.watch % 3 === 0) {
        // the last push: everything onto the ford we don't hold that has the fewest enemies reported at it
        const target = FORDS.filter(f => !v.own.some(s => dist(s, node(f)) < 50)).sort((x, y) => foes.filter(s => dist(s, node(x)) < 120).length - foes.filter(s => dist(s, node(y)) < 120).length)[0]
        if (target) for (const s of free(['inf', 'ele', 'arch'])) { override.set(s.id, target); order(s.id, 'attack', target) }
        if (target) notes.push(`Last watches. Everything to ${node(target).name}.`)
      }
      const d: Decision = { thought: '', orders: orders.slice(0, 3) }
      if (h === 'orchid' && v.watch % 3 === 0) d.decoy = { to: `${h}-cav-1`, verb: 'attack', where: 'F3' }
      const l = LETTERS[h]
      if (l && l.watch === v.watch) { d.letter = { to: l.to, text: l.text, method: 'cipher' }; notes.push(`Proposing a truce to ${l.to}.`) }
      const held = [p.a, p.b].filter(f => v.own.some(s => dist(s, node(f)) < 50)).length
      if (!smoked && v.watch >= 14 && held === 0) { smoked = true; d.smoke = 'advance'; notes.push('No ford is ours. Light the smoke: advance.') }
      for (const m of v.inbox) notes.push(`Letter from ${m.from}: "${m.text}"`)
      d.thought = notes.join(' ').slice(0, 280)
      return d
    },
  }
}
