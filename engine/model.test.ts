// The model path end to end, against a fake provider: bad JSON → retry, bad twice → orders lost, down → ProviderDown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOUSES, type HouseId } from './map.ts'
import { runBattle } from './sim.ts'
import { modelGeneral, parseDecision, ProviderDown, loadConfig } from './model.ts'

const good = (h: string) => JSON.stringify({ thought: `Report 1w old says F2 is open.`, orders: [{ to: `${h}-inf-1`, verb: 'hold', where: 'MIDDLE FORD', method: 'cipher' }], letter: { to: 'kite', text: 'Truce until dawn.' } })
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1000 } }))
const cfg = loadConfig()
const env = { GROQ_API_KEY: 'x', NVIDIA_API_KEY: 'x', OPENROUTER_API_KEY: 'x' }
for (const p of Object.values(cfg.providers)) { p.rpm = 0; p.tpm = 0 }

test('parseDecision accepts place names, fences and think blocks; rejects foreign squads', () => {
  const r = parseDecision('<think>hmm</think>```json\n' + good('rhino') + '\n```', 'rhino')
  assert.equal(r.d?.orders[0].where, 'F2')
  assert.match(parseDecision(good('kite'), 'rhino').error!, /squad ids/)
  assert.match(parseDecision('no idea', 'rhino').error!, /no JSON/)
})

test('model battle: retry, lost orders and stats', async () => {
  const seen: Record<string, number> = {}
  const fake = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body), sys: string = body.messages[0].content
    const h = HOUSES.find(x => sys.includes(`House ${x.toUpperCase()}`))!
    const n = (seen[h] = (seen[h] ?? 0) + 1)
    if (body.messages[1].content.startsWith('Before battle')) return reply(`{"name":"General ${h}","line":"Forward."}`)
    if (h === 'tiger') return reply('I refuse to answer in JSON.')
    if (h === 'kite' && n === 2) return reply('{"thought": broken')
    return reply(good(h))
  }) as typeof fetch
  const generals = Object.fromEntries(HOUSES.map(h => [h, modelGeneral(h, cfg, env, fake)])) as Record<HouseId, any>
  const r = await runBattle({ id: 'fake', seed: 1, generals, watches: 4 })
  assert.equal(r.stats.ordersLost, 4) // tiger, every watch
  assert.equal(r.stats.retries, 5) // tiger ×4 + kite once
  assert.equal(r.stats.calls, 16)
  assert.equal(r.init.houses[0].name, 'General rhino')
})

test('provider down → ProviderDown so the runner can checkpoint', async () => {
  const down = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
  await assert.rejects(modelGeneral('rhino', cfg, env, down).decide({ house: 'rhino', watch: 1, watches: 30, tick: 0, doctrine: '', own: [], enemies: [], inbox: [], intel: [], smoke: [], truces: [] }), ProviderDown)
})
