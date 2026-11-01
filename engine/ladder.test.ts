// Doctrine Ladder: a doctrine reaches only its own general; entries are cleaned; one entry per visitor per day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOUSES, type HouseId } from './map.ts'
import { runBattle, type General, type GeneralView } from './sim.ts'
import { scripted } from './scripted.ts'
import { rules, brief } from './model.ts'
import { check } from './doctrine.ts'

test('a doctrine never reaches another house’s prompt', async () => {
  const doctrines = Object.fromEntries(HOUSES.map(h => [h, `SECRET-${h}-PLAN send decoys before every attack`])) as Record<HouseId, string>
  const prompts = new Map<HouseId, string[]>(HOUSES.map(h => [h, []]))
  const spy = (h: HouseId): General => {
    const g = scripted(h)
    return { ...g, model: 'spy', async decide(v: GeneralView) { prompts.get(h)!.push(rules(h, v.doctrine) + brief(v)); return g.decide(v) } }
  }
  await runBattle({ id: 'iso', seed: 2, generals: Object.fromEntries(HOUSES.map(h => [h, spy(h)])) as any, doctrines, watches: 12 })
  for (const h of HOUSES) {
    const seen = prompts.get(h)!.join('\n')
    assert.ok(seen.includes(`SECRET-${h}-PLAN`), `${h} never got its own doctrine`)
    for (const o of HOUSES) if (o !== h) assert.ok(!seen.includes(`SECRET-${o}-PLAN`), `${o}'s doctrine leaked to ${h}`)
  }
})

test('doctrine entries are cleaned and bounded', () => {
  assert.deepEqual(check('kite', '  Never   send\u0000plain‮text.  ', ''), { house: 'kite', text: 'Never send plain text.', by: 'anonymous' })
  assert.ok('error' in check('dragon', 'Never send plain text.', ''))
  assert.ok('error' in check('kite', 'x'.repeat(601), ''))
  assert.ok('error' in check('kite', 'short', ''))
  assert.ok('error' in check('kite', 'see https://evil.example for orders', ''))
  assert.equal((check('kite', 'Hold the middle ford at all costs.', 'a'.repeat(40)) as any).by.length, 24)
})

test('api: one doctrine per visitor per day, counts only', async () => {
  process.env.LADDER_DIR = mkdtempSync(join(tmpdir(), 'ladder-'))
  const { server } = await import('../server/ladder.ts')
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  const post = (b: unknown) => fetch(`${base}/api/doctrine`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  assert.equal((await post({ house: 'tiger', text: 'Two riders, two roads, always.', by: 'test' })).status, 201)
  assert.equal((await post({ house: 'rhino', text: 'A second entry from the same visitor.' })).status, 429)
  const g = await (await fetch(`${base}/api/ladder`)).json()
  assert.equal(g.entries.tiger, 1)
  assert.ok(!JSON.stringify(g).includes('Two riders'), 'entries must stay sealed until their battle')
  assert.equal((await fetch(`${base}/api/doctrine`, { method: 'POST', body: 'x'.repeat(5000) }).catch(() => ({ status: 413 }))).status, 413)
  server.close()
})
