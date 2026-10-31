// Golden replays: any change that alters a battle shows up here. UPDATE_GOLDEN=1 npm test to accept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { HOUSES } from './map.ts'
import { runBattle } from './sim.ts'
import { scripted } from './scripted.ts'
import { encrypt, partial, reveal } from './cipher.ts'

const GOLDEN = new URL('./golden.json', import.meta.url)
const golden: Record<string, string> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {}
const battle = (seed: number) => runBattle({ id: `t${seed}`, seed, generals: Object.fromEntries(HOUSES.map(h => [h, scripted(h)])) as any })

test('cipher round trip and partial decode', () => {
  const c = encrypt('ADVANCE TO THE FORD', 'TALON')
  const known = new Map<string, string>()
  assert.equal(partial(c, known), '_______ __ ___ ____')
  reveal([c], known, 'TALON', 26)
  assert.equal(partial(c, known), 'ADVANCE TO THE FORD')
})

for (const seed of [1, 2, 3]) test(`battle ${seed}: deterministic, passes the courier gate`, async () => {
  const a = await battle(seed), b = await battle(seed)
  const hash = createHash('sha256').update(JSON.stringify(a)).digest('hex')
  assert.equal(hash, createHash('sha256').update(JSON.stringify(b)).digest('hex'), 'same seed, different replay')
  assert.ok(a.stats.interceptions >= 3, `interceptions ${a.stats.interceptions}`)
  assert.ok(a.stats.readableDecodes >= 1, `readable decodes ${a.stats.readableDecodes}`)
  if (process.env.UPDATE_GOLDEN || !golden[seed]) golden[seed] = hash
  else assert.equal(hash, golden[seed], 'replay changed; UPDATE_GOLDEN=1 if intended')
})

test.after(() => writeFileSync(GOLDEN, JSON.stringify(golden, null, 1)))
