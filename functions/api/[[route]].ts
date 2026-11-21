// The War Council API on Cloudflare Pages Functions + D1 (free tier, no card). Replaces server/ladder.ts on the Oracle box.
//   POST /api/doctrine {house, text, by}   one entry per visitor per day, queued for tonight's battles
//   GET  /api/ladder                       tonight's entry counts per house (entries stay sealed until their battle)
//   GET  /api/queue      (Bearer token)    unplayed entries, for the nightly GitHub workflow
//   POST /api/consume    (Bearer token)    {ids} mark entries as played
// Env: DB (D1 binding), LADDER_TOKEN (secret shared with the workflow), LADDER_SALT (secret; hashes visitor IPs, never stored raw).
import { check } from '../../engine/doctrine.ts'
import { HOUSES } from '../../engine/map.ts'

interface D1Result { results: any[]; meta: { changes: number } }
interface D1Stmt { bind(...v: unknown[]): D1Stmt; all(): Promise<D1Result>; run(): Promise<D1Result>; first(): Promise<any> }
interface Env { DB: { prepare(q: string): D1Stmt; batch(s: D1Stmt[]): Promise<D1Result[]> }; LADDER_TOKEN?: string; LADDER_SALT?: string }

const DAILY_CAP = 2000 // whole-site entries per day
const day = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) // IST, matches the nightly
const json = (code: number, body: unknown) => new Response(code === 204 ? null : JSON.stringify(body), {
  status: code,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' },
})
const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
const authed = (req: Request, env: Env) => !!env.LADDER_TOKEN && env.LADDER_TOKEN.length >= 32 && req.headers.get('authorization') === `Bearer ${env.LADDER_TOKEN}`

export const onRequest = async ({ request: req, env }: { request: Request; env: Env }): Promise<Response> => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '')
  if (req.method === 'OPTIONS') return json(204, null)
  try {
    if (req.method === 'GET' && path === '/api/ladder') {
      const { results } = await env.DB.prepare('SELECT house, COUNT(*) AS n FROM entries WHERE day = ? GROUP BY house').bind(day()).all()
      const entries = Object.fromEntries(HOUSES.map(h => [h, results.find(r => r.house === h)?.n ?? 0]))
      return json(200, { date: day(), entries })
    }
    if (req.method === 'POST' && path === '/api/doctrine') {
      const raw = await req.text()
      if (raw.length > 4096) return json(413, { error: 'too long' })
      let j: any
      try { j = JSON.parse(raw) } catch { return json(400, { error: 'bad request' }) }
      const c = check(j?.house, j?.text, j?.by)
      if ('error' in c) return json(400, c)
      const today = day()
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
      const visitor = (await hex(`${env.LADDER_SALT ?? ''}|${today}|${ip}`)).slice(0, 16)
      const at = new Date(Date.now() + 5.5 * 3600_000).toISOString().replace('Z', '+05:30')
      // one statement, so the cap and the one-per-visitor rule hold even when hundreds arrive at once (D1 runs writes one at a time)
      const r = await env.DB.prepare('INSERT INTO entries (id, day, house, author, text, at, visitor) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM entries WHERE day = ?) < ? ON CONFLICT (day, visitor) DO NOTHING')
        .bind(crypto.randomUUID(), today, c.house, c.by, c.text, at, visitor, today, DAILY_CAP).run()
      if (!r.meta.changes) {
        const again = await env.DB.prepare('SELECT 1 FROM entries WHERE day = ? AND visitor = ?').bind(today, visitor).first()
        return again ? json(429, { error: 'one set of orders per visitor per day; come back tomorrow' }) : json(503, { error: 'tonight’s council is full' })
      }
      return json(201, { ok: true, house: c.house, date: today })
    }
    if (path === '/api/queue' || path === '/api/consume') {
      if (!authed(req, env)) return json(401, { error: 'unauthorized' })
      if (req.method === 'GET' && path === '/api/queue') {
        const { results } = await env.DB.prepare('SELECT id, house, author AS by, text, at FROM entries WHERE used = 0 ORDER BY at LIMIT 500').all()
        return json(200, results.map(e => ({ ...e, visitor: '' })))
      }
      if (req.method === 'POST' && path === '/api/consume') {
        const ids: unknown = (await req.json().catch(() => null) as any)?.ids
        if (!Array.isArray(ids) || ids.length > 500 || !ids.every(i => typeof i === 'string')) return json(400, { error: 'ids must be a list of strings' })
        if (ids.length) await env.DB.batch(ids.map(i => env.DB.prepare('UPDATE entries SET used = 1 WHERE id = ?').bind(i)))
        return json(200, { ok: true, consumed: ids.length })
      }
    }
    return json(404, { error: 'not found' })
  } catch (e) {
    console.error(e)
    return json(500, { error: 'the council’s server stumbled; try again in a minute' })
  }
}
