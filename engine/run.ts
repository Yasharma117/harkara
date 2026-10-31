// node engine/run.ts [seed] [outDir]  → writes a replay folder + updates the replay index
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HOUSES } from './map.ts'
import { runBattle } from './sim.ts'
import { scripted } from './scripted.ts'

const seed = Number(process.argv[2] ?? 1)
const root = process.argv[3] ?? join(import.meta.dirname, '../client/public/replay')
const id = `grey-${seed}`
const r = await runBattle({ id, seed, generals: Object.fromEntries(HOUSES.map(h => [h, scripted(h)])) as any })

const dir = join(root, id)
mkdirSync(dir, { recursive: true })
const put = (f: string, d: unknown) => writeFileSync(join(dir, f), JSON.stringify(d))
put('manifest.json', r.manifest); put('init.json', r.init); put('end.json', r.end); put('stats.json', r.stats)
for (const w of r.watches) put(`watch${w.watch}.json`, w)

const idx = join(root, 'index.json')
const list: { id: string; winner: string }[] = existsSync(idx) ? JSON.parse(readFileSync(idx, 'utf8')) : []
writeFileSync(idx, JSON.stringify([...list.filter(b => b.id !== id), { id, winner: r.manifest.winner }]))
console.log(id, r.manifest.reason, JSON.stringify(r.stats))
