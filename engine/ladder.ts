// Nightly Doctrine Ladder: take queued entries, run ladder battles on the one local model, post results.
// node engine/ladder.ts [--battles 2] [--date YYYY-MM-DD] [--watches 30]
// Each battle draws one queued entry per house by lot (seeded by the date, so a rerun draws the same); a house without
// one plays the default doctrine ("hold"). Entries not drawn are retired (retire.json), so the queue never piles up.
// The plan is saved first, so a crash or a down model server resumes with the same entries (exit 2). A battle that
// fails for any other reason is logged and its entries retired, so one bad night can't block the queue (exit 1).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { HOUSES, type HouseId } from './map.ts'
import type { Entry } from './doctrine.ts'
import { DECK, compose } from './tactics.ts'

const { values: a } = parseArgs({ options: { battles: { type: 'string', default: process.env.LADDER_BATTLES ?? '2' }, date: { type: 'string' }, watches: { type: 'string', default: '30' } } })
const DIR = process.env.LADDER_DIR ?? join(import.meta.dirname, '../data/ladder')
const REPLAY = join(import.meta.dirname, '../client/public/replay')
const RESULTS = join(REPLAY, 'ladder.json')
const date = a.date ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
mkdirSync(DIR, { recursive: true })

const read = <T>(f: string, d: T): T => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d
const queue: Entry[] = existsSync(join(DIR, 'queue.jsonl')) ? readFileSync(join(DIR, 'queue.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
const used = new Set<string>(read(join(DIR, 'used.json'), []))
const results: { date: string; battles: any[] }[] = read(RESULTS, [])
// entries already in published results (marking them played failed last time): never fight them twice
const published = new Set<string>(results.flatMap(d => d.battles.flatMap((b: any) => b.entries.map((e: any) => e.entry).filter(Boolean))))
// three tactic cards dealt at random (one of each kind at most), as an entry "by the lot"; never sent to the API
const LOT = 'the lot'
function dealt(h: HouseId, key: string, r: () => number): Entry {
  for (;;) {
    const ids = [...DECK].sort(() => r() - 0.5).slice(0, 3).map(c => c.id), c = compose(ids)
    if ('text' in c) return { id: `lot-${key}-${h}`, house: h, by: LOT, text: c.text, at: '', visitor: '' }
  }
}
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

// plan: one per date, written before any battle runs
type Battle = { id: string; seed: number; entries: Partial<Record<HouseId, Entry>> }
const planFile = join(DIR, `plan-${date}.json`)
let plan: Battle[] = read(planFile, null as any)
if (!plan) {
  const left = queue.filter(e => !used.has(e.id) && !published.has(e.id) && e.at.slice(0, 10) <= date)
  const r = rng([...date].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 11))
  for (let i = left.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [left[i], left[j]] = [left[j], left[i]] } // the draw
  plan = []
  for (let n = 1; n <= Number(a.battles); n++) {
    const entries: Battle['entries'] = {}
    // a visitor's orders if one was drawn for this house; otherwise the lot deals the general three tactic cards
    for (const h of HOUSES) { const i = left.findIndex(e => e.house === h); entries[h] = i >= 0 ? left.splice(i, 1)[0] : dealt(h, `${date}-${n}`, r) }
    const id = `ladder-${date}-${n}`
    plan.push({ id, seed: [...id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7), entries })
  }
  writeFileSync(planFile, JSON.stringify(plan))
}
const retire = () => writeFileSync(join(DIR, 'retire.json'), JSON.stringify(queue.map(e => e.id).filter(id => !used.has(id))))

let failed = 0
for (const b of plan) {
  if (results.some(r => r.battles.some(x => x.id === b.id))) continue // already posted
  const docFile = join(DIR, `${b.id}.doctrines.json`)
  writeFileSync(docFile, JSON.stringify(Object.fromEntries(Object.entries(b.entries).map(([h, e]) => [h, e!.text]))))
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'run.ts'), '--local', '--doctrines', docFile, '--id', b.id, '--seed', String(b.seed), '--watches', a.watches!], { stdio: 'inherit', env: process.env })
  if (r.status === 2) { console.error(`ladder ${b.id}: model server down, resumes on the next run`); process.exit(2) }
  const end = r.status === 0 ? read<any>(join(REPLAY, b.id, 'end.json'), null) : null
  if (!end) { // not the model server: something in this battle itself. Retire its entries so it can't block every night
    console.error(`::error::ladder ${b.id}: battle runner exited ${r.status}; its entries are retired`)
    failed++; for (const e of Object.values(b.entries)) if (e!.by !== LOT) used.add(e!.id)
    writeFileSync(join(DIR, 'used.json'), JSON.stringify([...used])); continue
  }
  // results reveal each doctrine only now, after its battle; the visitor hash never leaves the box
  const row = { id: b.id, winner: end.winner, reason: end.reason, entries: HOUSES.map(h => ({ house: h, entry: b.entries[h]?.by === LOT ? null : b.entries[h]?.id ?? null, by: b.entries[h]?.by === LOT ? null : b.entries[h]?.by ?? null, text: b.entries[h]?.text ?? null, score: end.scores[h] })).sort((x, y) => y.score - x.score) }
  const day = results.find(r => r.date === date) ?? (results.push({ date, battles: [] }), results.at(-1)!)
  day.battles.push(row)
  for (const e of Object.values(b.entries)) if (e!.by !== LOT) used.add(e!.id)
  writeFileSync(join(DIR, 'used.json'), JSON.stringify([...used]))
  writeFileSync(RESULTS, JSON.stringify(results.slice(-30))) // a month of nights
  console.log(`ladder ${b.id}: ${end.winner} (${end.reason})`)
}
retire()
if (failed) process.exit(1)
