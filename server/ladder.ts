// The Doctrine Ladder API, the only part of Harkara that viewers write to. Runs on the A1 behind Caddy.
//   POST /api/doctrine {house, text, by}  → one entry per visitor per day, queued for tonight's ladder
//   GET  /api/ladder                      → tonight's entry counts per house (entries stay sealed until their battle)
// Results are not served here: engine/ladder.ts writes them to client/public/replay/ladder.json, which ships with the site.
// node server/ladder.ts   env: PORT (8787), LADDER_DIR (data/ladder), ALLOW_ORIGIN (*), LADDER_SALT (random per boot if unset)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { HOUSES } from '../engine/map.ts'
import { check, type Entry } from '../engine/doctrine.ts'

const DIR = process.env.LADDER_DIR ?? join(import.meta.dirname, '../data/ladder')
const QUEUE = join(DIR, 'queue.jsonl')
const SALT = process.env.LADDER_SALT ?? randomBytes(16).toString('hex')
const ORIGIN = process.env.ALLOW_ORIGIN ?? '*'
const DAILY_CAP = 2000 // whole-site entries per day, so a flood can't fill the disk
mkdirSync(DIR, { recursive: true })

export const day = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) // IST, matches the nightly
export const readQueue = (file = QUEUE): Entry[] => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []

// in memory: today's visitors and count, rebuilt from the queue at start. ponytail: one process, one box.
let today = day(), seen = new Set<string>(), count = 0
for (const e of readQueue()) if (e.at.slice(0, 10) === today) { seen.add(e.visitor); count++ }

const ip = (req: IncomingMessage) => {
  const sock = req.socket.remoteAddress ?? ''
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return (sock === '127.0.0.1' || sock === '::1' || sock === '::ffff:127.0.0.1') && fwd ? fwd : sock // trust the header only from Caddy
}
const send = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export const server = createServer((req, res) => {
  if (day() !== today) { today = day(); seen = new Set(); count = 0 }
  if (req.method === 'OPTIONS') return send(res, 204, null)
  if (req.method === 'GET' && req.url === '/api/ladder') {
    const per = Object.fromEntries(HOUSES.map(h => [h, 0]))
    for (const e of readQueue()) if (e.at.slice(0, 10) === today) per[e.house]++
    return send(res, 200, { date: today, entries: per })
  }
  if (req.method !== 'POST' || req.url !== '/api/doctrine') return send(res, 404, { error: 'not found' })
  let body = ''
  req.setEncoding('utf8')
  req.on('data', c => { body += c; if (body.length > 4096) { send(res, 413, { error: 'too long' }); req.destroy() } })
  req.on('end', () => {
    if (res.headersSent) return
    let j: any
    try { j = JSON.parse(body) } catch { return send(res, 400, { error: 'bad request' }) }
    const visitor = createHash('sha256').update(`${SALT}|${today}|${ip(req)}`).digest('hex').slice(0, 16) // the IP itself is never stored
    if (seen.has(visitor)) return send(res, 429, { error: 'one doctrine per visitor per day; come back tomorrow' })
    if (count >= DAILY_CAP) return send(res, 503, { error: 'tonight’s ladder is full' })
    const c = check(j?.house, j?.text, j?.by)
    if ('error' in c) return send(res, 400, c)
    const e: Entry = { id: randomUUID(), ...c, at: new Date(Date.now() + 5.5 * 3600_000).toISOString().replace('Z', '+05:30'), visitor }
    appendFileSync(QUEUE, JSON.stringify(e) + '\n')
    seen.add(visitor); count++
    send(res, 201, { ok: true, house: e.house, date: today })
  })
})

if (import.meta.main) server.listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => console.log(`ladder api on 127.0.0.1:${process.env.PORT ?? 8787}`))
