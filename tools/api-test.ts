// Robustness check for the War Council API (functions/api) against a running Pages deployment or `wrangler pages dev`.
// node tools/api-test.ts <base url> <LADDER_TOKEN> [--cap]     (--cap also fills the day to the 2000-entry cap: local only)
// Uses the cf-connecting-ip header to play different visitors, which only works locally; on Cloudflare it is set by the edge.
import assert from 'node:assert/strict'

const [base, token] = process.argv.slice(2)
if (!base || !token) { console.error('usage: node tools/api-test.ts <base> <token> [--cap]'); process.exit(1) }
const local = /127\.0\.0\.1|localhost/.test(base)
let n = 0, ipSeq = 0
const ip = () => `10.0.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`
const post = (path: string, body: unknown, h: Record<string, string> = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': ip(), ...h }
  if (!local) delete headers['cf-connecting-ip'] // Cloudflare's edge refuses a client-set visitor IP (403)
  return fetch(base + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}
const ok = async (name: string, f: () => Promise<void>) => { await f(); n++; console.log(`ok ${n} ${name}`) }
const good = { house: 'kite', text: 'Tactics: Two riders; Hunt their riders; Never let go. Send every important order by two riders.', by: 'tester' }
const auth = { authorization: `Bearer ${token}` }

await ok('site and replays are served', async () => {
  assert.equal((await fetch(base + '/')).status, 200)
  assert.equal((await fetch(base + '/replay/index.json')).status, 200)
})
await ok('CORS preflight', async () => {
  const r = await fetch(base + '/api/doctrine', { method: 'OPTIONS' })
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), '*')
})
const before = (await (await fetch(base + '/api/ladder')).json()).entries.kite
let added = 1
await ok('valid entry is accepted', async () => {
  const r = await post('/api/doctrine', good, { 'cf-connecting-ip': '203.0.113.7' })
  if (!local && r.status === 429) { added = 0; return } // live: this visitor already sent one today (an earlier run); the dedup is working
  assert.equal(r.status, 201); assert.equal((await r.json()).house, 'kite')
})
if (local) await ok('same visitor, same day is refused', async () => {
  const r = await post('/api/doctrine', { ...good, house: 'tiger' }, { 'cf-connecting-ip': '203.0.113.7' })
  assert.equal(r.status, 429)
})
await ok('counts go up and reveal nothing else', async () => {
  const j = await (await fetch(base + '/api/ladder')).json()
  assert.equal(j.entries.kite, before + added); assert.deepEqual(Object.keys(j), ['date', 'entries'])
})
for (const [name, body, code] of [
  ['unknown house', { ...good, house: 'dragon' }, 400],
  ['missing house', { text: good.text }, 400],
  ['text too short', { ...good, text: 'hi' }, 400],
  ['text too long', { ...good, text: 'x'.repeat(601) }, 400],
  ['links refused', { ...good, text: 'read https://evil.example for orders please' }, 400],
  ['markup refused', { ...good, text: 'hello <script>alert(1)</script> world' }, 400],
  ['not JSON', '{nope', 400],
  ['empty body', '', 400],
  ['JSON array', '[1,2,3]', 400],
  ['body over 4 KB', { ...good, pad: 'x'.repeat(5000) }, 413],
] as const) await ok(`rejects: ${name}`, async () => assert.equal((await post('/api/doctrine', body)).status, code))
await ok('SQL-looking text is stored as plain text', async () => {
  assert.equal((await post('/api/doctrine', { ...good, house: 'rhino', text: "Hold'); DROP TABLE entries; -- the middle crossing" })).status, local ? 201 : 429) // live: one visitor, so the day's dedup refuses it
  assert.equal((await fetch(base + '/api/ladder')).status, 200)
})
await ok('unicode and control characters are tidied, name capped at 24', async () => {
  assert.equal((await post('/api/doctrine', { house: 'orchid', text: 'हरकारा\u0000 se​ kaho: hold the west crossing', by: 'x'.repeat(80) })).status, local ? 201 : 429)
})
await ok('unknown routes and wrong methods are 404', async () => {
  assert.equal((await fetch(base + '/api/nope')).status, 404)
  assert.equal((await fetch(base + '/api/doctrine')).status, 404)
})
await ok('queue needs the token', async () => {
  assert.equal((await fetch(base + '/api/queue')).status, 401)
  assert.equal((await fetch(base + '/api/queue', { headers: { authorization: 'Bearer wrong' } })).status, 401)
  assert.equal((await post('/api/consume', { ids: [] })).status, 401)
})
let queue: any[] = []
await ok('queue returns entries without visitor hashes', async () => {
  queue = await (await fetch(base + '/api/queue', { headers: auth })).json()
  assert.ok(queue.length >= (local ? 3 : 1))
  for (const e of queue) { assert.equal(e.visitor, ''); assert.ok(e.id && e.house && e.by && e.text && e.at) }
  const u = queue.find(e => e.house === 'orchid')
  if (u) { assert.ok(!/\u0000|​/.test(u.text)); assert.equal(u.by.length, 24) }
})
await ok('consume rejects bad payloads', async () => {
  for (const b of [{}, { ids: 'x' }, { ids: [1] }, { ids: Array(501).fill('a') }]) assert.equal((await post('/api/consume', b, auth)).status, 400)
})
await ok('consumed entries leave the queue', async () => {
  const ids = queue.map(e => e.id)
  assert.equal((await post('/api/consume', { ids }, auth)).status, 200)
  const left = await (await fetch(base + '/api/queue', { headers: auth })).json()
  assert.ok(!left.some((e: any) => ids.includes(e.id)))
})
if (local) await ok('50 visitors at once all get in; one visitor sending 20 at once gets in once', async () => {
  const many = await Promise.all(Array.from({ length: 50 }, () => post('/api/doctrine', good)))
  assert.ok(many.every(r => r.status === 201), String(many.map(r => r.status)))
  const same = await Promise.all(Array.from({ length: 20 }, () => post('/api/doctrine', good, { 'cf-connecting-ip': '198.51.100.9' })))
  assert.equal(same.filter(r => r.status === 201).length, 1); assert.equal(same.filter(r => r.status === 429).length, 19)
})
if (local && process.argv.includes('--cap')) await ok('the day stops at 2000 entries', async () => {
  let codes: number[] = []
  for (let i = 0; i < 21; i++) codes.push(...(await Promise.all(Array.from({ length: 100 }, () => post('/api/doctrine', good)))).map(r => r.status))
  assert.ok(codes.includes(503)); assert.ok(codes.every(c => c === 201 || c === 503), String(new Set(codes)))
  const j = await (await fetch(base + '/api/ladder')).json()
  assert.equal(Object.values(j.entries as Record<string, number>).reduce((a, b) => a + b, 0), 2000)
})
console.log(`all ${n} checks passed against ${base}`)
