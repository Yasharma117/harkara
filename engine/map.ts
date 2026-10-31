// The valley: named places joined by roads. Models and generals only ever see names.
export type HouseId = 'rhino' | 'kite' | 'orchid' | 'tiger'
export const HOUSES: HouseId[] = ['rhino', 'kite', 'orchid', 'tiger']
export type EdgeKind = 'road' | 'hill' | 'ford' | 'ferry'
export interface MapNode { id: string; name: string; x: number; y: number; mist: boolean }
export interface MapEdge { a: string; b: string; kind: EdgeKind }

const N = (id: string, name: string, x: number, y: number, mist = false): MapNode => ({ id, name, x, y, mist })

// 1000x1000, river runs west→east along y=500.
export const NODES: MapNode[] = [
  N('rhino-camp', 'RHINO CAMP', 120, 120),
  N('kite-camp', 'KITE CAMP', 880, 120),
  N('orchid-camp', 'ORCHID CAMP', 120, 880),
  N('tiger-camp', 'TIGER CAMP', 880, 880),
  N('north-village', 'NONG VILLAGE', 500, 220),
  N('south-village', 'DHARA VILLAGE', 500, 780),
  N('north-ridge', 'NORTH RIDGE', 500, 60, true),
  N('south-ridge', 'SOUTH RIDGE', 500, 940, true),
  N('west-hill', 'WEST HILL', 60, 300, true),
  N('gorge', 'THE GORGE', 940, 300, true),
  N('sw-hill', 'SOUTHWEST HILL', 60, 700, true),
  N('se-hill', 'SOUTHEAST HILL', 940, 700, true),
  N('n-west', 'NORTH BANK WEST', 200, 400),
  N('n-mid', 'NORTH BANK MIDDLE', 500, 400),
  N('n-ferry', 'NORTH LANDING', 660, 400),
  N('n-east', 'NORTH BANK EAST', 800, 400),
  N('s-west', 'SOUTH BANK WEST', 200, 600),
  N('s-mid', 'SOUTH BANK MIDDLE', 500, 600),
  N('s-ferry', 'SOUTH LANDING', 660, 600),
  N('s-east', 'SOUTH BANK EAST', 800, 600),
  N('F1', 'WEST FORD', 200, 500),
  N('F2', 'MIDDLE FORD', 500, 500),
  N('F3', 'EAST FORD', 800, 500),
  N('ferry', 'FERRY', 660, 500),
]

const E = (a: string, b: string, kind: EdgeKind = 'road'): MapEdge => ({ a, b, kind })
export const EDGES: MapEdge[] = [
  E('rhino-camp', 'n-west'), E('rhino-camp', 'north-village'), E('kite-camp', 'north-village'), E('kite-camp', 'n-east'),
  E('north-village', 'n-mid'), E('orchid-camp', 's-west'), E('orchid-camp', 'south-village'), E('tiger-camp', 'south-village'),
  E('tiger-camp', 's-east'), E('south-village', 's-mid'),
  E('n-west', 'n-mid'), E('n-mid', 'n-ferry'), E('n-ferry', 'n-east'), E('s-west', 's-mid'), E('s-mid', 's-ferry'), E('s-ferry', 's-east'),
  E('n-west', 'F1', 'ford'), E('F1', 's-west', 'ford'), E('n-mid', 'F2', 'ford'), E('F2', 's-mid', 'ford'),
  E('n-east', 'F3', 'ford'), E('F3', 's-east', 'ford'), E('n-ferry', 'ferry', 'ferry'), E('ferry', 's-ferry', 'ferry'),
  E('rhino-camp', 'north-ridge', 'hill'), E('north-ridge', 'kite-camp', 'hill'),
  E('orchid-camp', 'south-ridge', 'hill'), E('south-ridge', 'tiger-camp', 'hill'),
  E('rhino-camp', 'west-hill', 'hill'), E('west-hill', 'n-west', 'hill'), E('kite-camp', 'gorge', 'hill'), E('gorge', 'n-east', 'hill'),
  E('orchid-camp', 'sw-hill', 'hill'), E('sw-hill', 's-west', 'hill'), E('tiger-camp', 'se-hill', 'hill'), E('se-hill', 's-east', 'hill'),
  E('west-hill', 'sw-hill', 'hill'), E('gorge', 'se-hill', 'hill'), // hill paths that skirt the river high up, misty
]

export const SPEED: Record<EdgeKind, number> = { road: 1, hill: 0.6, ford: 0.5, ferry: 0.35 }
export const FORDS = ['F1', 'F2', 'F3']
export const camp = (h: HouseId) => `${h}-camp`

const byId = new Map(NODES.map(n => [n.id, n]))
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const kindOf = new Map(EDGES.map(e => [key(e.a, e.b), e.kind]))
export const node = (id: string) => byId.get(id)!
export const edgeKind = (a: string, b: string) => kindOf.get(key(a, b))
export const edgeKey = key
export const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

// Dijkstra over ~24 nodes; O(n²) is fine. `prefer` triples the cost of the other kind of road.
export function route(from: string, to: string, prefer: 'road' | 'hill' | 'any' = 'any', avoid?: Set<string>): string[] {
  const cost = new Map<string, number>([[from, 0]]), prev = new Map<string, string>(), done = new Set<string>()
  while (true) {
    let cur: string | undefined, best = Infinity
    for (const [id, c] of cost) if (!done.has(id) && c < best) { best = c; cur = id }
    if (!cur || cur === to) break
    done.add(cur)
    for (const e of EDGES) {
      const nb = e.a === cur ? e.b : e.b === cur ? e.a : null
      if (!nb || done.has(nb)) continue
      let c = dist(node(cur), node(nb)) / SPEED[e.kind]
      if (prefer === 'hill' && e.kind === 'road') c *= 3
      if (prefer === 'road' && e.kind === 'hill') c *= 3
      if (avoid?.has(key(cur, nb))) c *= 5
      if (best + c < (cost.get(nb) ?? Infinity)) { cost.set(nb, best + c); prev.set(nb, cur) }
    }
  }
  const out: string[] = []
  for (let n: string | undefined = to; n && n !== from; n = prev.get(n)) out.unshift(n)
  return from === to || out.length ? out : []
}

export function nearestNode(p: { x: number; y: number }) {
  return NODES.reduce((a, b) => (dist(a, p) <= dist(b, p) ? a : b))
}
