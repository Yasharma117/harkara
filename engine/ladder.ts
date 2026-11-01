// Nightly Doctrine Ladder: take queued entries, run ladder battles on the one local model, post results.
// node engine/ladder.ts [--battles 2] [--date YYYY-MM-DD] [--watches 30]
// Each battle takes the oldest unused entry per house; a house without one plays the default doctrine ("hold").
// The plan is saved first, so a crash or a down model server resumes tomorrow with the same entries (exit 2).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { HOUSES, type HouseId } from './map.ts'
import type { Entry } from './doctrine.ts'

const { values: a } = parseArgs({ options: { battles: { type: 'string', default: process.env.LADDER_BATTLES ?? '2' }, date: { type: 'string' }, watches: { type: 'string', default: '30' } } })
const DIR = process.env.LADDER_DIR ?? join(import.meta.dirname, '../data/ladder')
const REPLAY = join(import.meta.dirname, '../client/public/replay')
const RESULTS = join(REPLAY, 'ladder.json')
const date = a.date ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
mkdirSync(DIR, { recursive: true })

const read = <T>(f: string, d: T): T => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d
const queue: Entry[] = existsSync(join(DIR, 'queue.jsonl')) ? readFileSync(join(DIR, 'queue.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
const used = new Set<string>(read(join(DIR, 'used.json'), []))

// plan: one per date, written before any battle runs
type Battle = { id: string; seed: number; entries: Partial<Record<HouseId, Entry>> }
const planFile = join(DIR, `plan-${date}.json`)
let plan: Battle[] = read(planFile, null as any)
if (!plan) {
  const left = queue.filter(e => !used.has(e.id) && e.at.slice(0, 10) <= date)
  plan = []
  for (let n = 1; n <= Number(a.battles); n++) {
    const entries: Battle['entries'] = {}
    for (const h of HOUSES) { const i = left.findIndex(e => e.house === h); if (i >= 0) entries[h] = left.splice(i, 1)[0] }
    if (!Object.keys(entries).length) break
    const id = `ladder-${date}-${n}`
    plan.push({ id, seed: [...id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7), entries })
  }
  writeFileSync(planFile, JSON.stringify(plan))
}
if (!plan.length) { console.log(`ladder ${date}: no entries`); process.exit(0) }

const results: { date: string; battles: any[] }[] = read(RESULTS, [])
for (const b of plan) {
  if (results.some(r => r.battles.some(x => x.id === b.id))) continue // already posted
  const docFile = join(DIR, `${b.id}.doctrines.json`)
  writeFileSync(docFile, JSON.stringify(Object.fromEntries(Object.entries(b.entries).map(([h, e]) => [h, e!.text]))))
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'run.ts'), '--local', '--doctrines', docFile, '--id', b.id, '--seed', String(b.seed), '--watches', a.watches!], { stdio: 'inherit', env: process.env })
  if (r.status === 2) { console.error(`ladder ${b.id}: model server down, resumes on the next run`); process.exit(2) }
  if (r.status !== 0) throw new Error(`ladder ${b.id}: battle runner exited ${r.status}`)
  const end = read<any>(join(REPLAY, b.id, 'end.json'), null)
  // results reveal each doctrine only now, after its battle; the visitor hash never leaves the box
  const row = { id: b.id, winner: end.winner, reason: end.reason, entries: HOUSES.map(h => ({ house: h, by: b.entries[h]?.by ?? null, text: b.entries[h]?.text ?? null, score: end.scores[h] })).sort((x, y) => y.score - x.score) }
  const day = results.find(r => r.date === date) ?? (results.push({ date, battles: [] }), results.at(-1)!)
  day.battles.push(row)
  for (const e of Object.values(b.entries)) used.add(e!.id)
  writeFileSync(join(DIR, 'used.json'), JSON.stringify([...used]))
  writeFileSync(RESULTS, JSON.stringify(results.slice(-30))) // a month of nights
  console.log(`ladder ${b.id}: ${end.winner} (${end.reason})`)
}
