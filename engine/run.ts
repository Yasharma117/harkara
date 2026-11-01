// node engine/run.ts [--seed 1] [--models] [--local] [--doctrines file.json] [--id name] [--out dir] [--watches 30]
// --local: every house on the one local model (ladder battles), so only the doctrine differs.
// --doctrines: {"rhino": "..."} — each house's doctrine reaches only its own general.
// With --models, every answer is recorded to answers.json in the battle folder. If a provider goes down
// the run exits 2; running the same command again replays the recorded answers (the engine is
// deterministic) and carries on from the watch that failed.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { HOUSES, type HouseId } from './map.ts'
import { runBattle, type Decision, type General } from './sim.ts'
import { scripted } from './scripted.ts'
import { modelGeneral, loadConfig, ProviderDown } from './model.ts'

const { values: a } = parseArgs({ options: { seed: { type: 'string', default: '1' }, models: { type: 'boolean' }, local: { type: 'boolean' }, doctrines: { type: 'string' }, id: { type: 'string' }, out: { type: 'string' }, watches: { type: 'string', default: '30' } } })
const seed = Number(a.seed)
const id = a.id ?? `${a.models ? 'model' : 'grey'}-${seed}`
const root = a.out ?? join(import.meta.dirname, '../client/public/replay')
const dir = join(root, id)
mkdirSync(dir, { recursive: true })

type Tape = { persona: Partial<Record<HouseId, { name: string; line: string }>>; watches: Record<number, Partial<Record<HouseId, Decision>>> }
const tapeFile = join(dir, 'answers.json')
const tape: Tape = existsSync(tapeFile) ? JSON.parse(readFileSync(tapeFile, 'utf8')) : { persona: {}, watches: {} }
const save = () => writeFileSync(tapeFile, JSON.stringify(tape))
const recorded = (h: HouseId, g: General): General => ({
  model: g.model,
  async persona(x, d) { return (tape.persona[h] ??= await g.persona(x, d).finally(save)) },
  async decide(v) {
    const w = (tape.watches[v.watch] ??= {})
    if (!w[h]) { w[h] = await g.decide(v); save() }
    return w[h]!
  },
})
const cfg = loadConfig()
if (a.local) for (const h of HOUSES) cfg.houses[h] = [{ provider: 'local', model: 'local' }]
const live = a.models || a.local
const generals = Object.fromEntries(HOUSES.map(h => [h, live ? recorded(h, modelGeneral(h, cfg)) : scripted(h)])) as Record<HouseId, General>
const doctrines: Partial<Record<HouseId, string>> = a.doctrines ? JSON.parse(readFileSync(a.doctrines, 'utf8')) : {}

let r: Awaited<ReturnType<typeof runBattle>>
try {
  r = await runBattle({ id, seed, generals, doctrines, watches: Number(a.watches) })
} catch (e) {
  if (!(e instanceof ProviderDown)) throw e
  save()
  console.error(`checkpointed ${id} at watch ${Object.keys(tape.watches).length}: ${e.message}. Rerun the same command to resume.`)
  process.exit(2)
}

const put = (f: string, d: unknown) => writeFileSync(join(dir, f), JSON.stringify(d))
put('manifest.json', r.manifest); put('init.json', r.init); put('end.json', r.end); put('stats.json', r.stats)
for (const w of r.watches) put(`watch${w.watch}.json`, w)
const idx = join(root, 'index.json')
const list: { id: string; winner: string }[] = existsSync(idx) ? JSON.parse(readFileSync(idx, 'utf8')) : []
writeFileSync(idx, JSON.stringify([...list.filter(b => b.id !== id), { id, winner: r.manifest.winner }]))
console.log(id, r.manifest.reason, JSON.stringify(r.stats))
