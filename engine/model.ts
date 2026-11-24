// Model generals: one OpenAI-compatible call per watch, one JSON answer, one retry.
import { PERSONA } from './scripted.ts'
import { readFileSync } from 'node:fs'
import { EDGES, HOUSES, NODES, type HouseId } from './map.ts'
import { SMOKES, TICKS, VERBS, type Decision, type General, type GeneralView } from './sim.ts'
import { fence } from './doctrine.ts'

export interface Provider { base: string; key: string; rpm: number; tpm: number; json: boolean }
export interface Link { provider: string; model: string }
export interface Config { providers: Record<string, Provider>; houses: Record<HouseId, Link[]> }
export function loadConfig(): Config {
  const c: Config = JSON.parse(readFileSync(new URL('./providers.json', import.meta.url), 'utf8'))
  if (process.env.LOCAL_LLM_URL) c.providers.local.base = process.env.LOCAL_LLM_URL
  return c
}

export class ProviderDown extends Error {}
type Fetch = typeof fetch
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Sliding one-minute window per provider. ponytail: in-process only; one battle at a time on the box.
const windows = new Map<string, { t: number; tokens: number }[]>()
async function take(name: string, p: Provider, tokens: number) {
  const w = windows.get(name) ?? windows.set(name, []).get(name)!
  while (true) {
    const now = Date.now()
    while (w.length && now - w[0].t > 60_000) w.shift()
    const used = w.reduce((a, x) => a + x.tokens, 0)
    if ((!p.rpm || w.length < p.rpm) && (!p.tpm || used + tokens <= p.tpm || !w.length)) { w.push({ t: now, tokens }); return }
    await sleep(Math.max(250, 60_000 - (now - w[0].t)))
  }
}

// ---- prompt
const PLACES = NODES.map(n => {
  const nb = EDGES.filter(e => e.a === n.id || e.b === n.id).map(e => `${e.a === n.id ? e.b : e.a}${e.kind === 'road' ? '' : `(${e.kind})`}`)
  return `${n.id} = ${n.name}${n.mist ? ' [mist]' : ''} → ${nb.join(', ')}`
}).join('\n')

export function rules(h: HouseId, doctrine: string) {
  return `You are the general of House ${h.toUpperCase()} in a river-valley war between four houses (${HOUSES.join(', ')}). Each turn is a "watch".
WIN: hold two of the three fords (F1, F2, F3) when the last watch ends, or take an enemy camp's standard.
FOG: you only know what couriers have brought you. Every position below has an age in watches; units have moved since.
COURIERS: every order is carried by a rider who can be caught by enemy foot or horse, shot by archers, or lost in [mist].
- method "plain": leaves now; whoever catches it reads it at once.
- method "cipher": leaves one watch later; captors decode it letter by letter over several watches.
- method "double": cipher, two riders by different roads.
- route "road" is fast; "hill" avoids the valley but is slower and misty.
- decoy: a fake order sent plain, meant to be caught. Your own squad ignores it.
- smoke: instant, seen by everyone, applies to ALL your squads: advance (to nearest ford), hold, fall back (to camp), regroup.
- letter: to another house's general, carried by a rider like any other. A letter containing the word TRUCE makes a six-watch truce when it arrives.
UNITS: inf holds fords and catches nearby riders; arch shoots riders and hurts foot; cav is fast, hunts riders, beats archers; ele is slow, breaks foot and horse.
VERBS: ${VERBS.join(', ')} (all mean: go to "where" and act there).
YOUR STANDING DOCTRINE: ${fence(doctrine === 'hold' ? '' : doctrine)}
PLACES (id = name → neighbours):
${PLACES}
ANSWER with one JSON object and nothing else:
{"thought": "<=280 chars, what you believe and why, citing report ages", "orders": [{"to": "<your squad id>", "verb": "hold", "where": "<place id>", "method": "cipher", "route": "road"}], "letter": {"to": "<house>", "text": "...", "method": "cipher"}, "decoy": {"to": "<your squad id>", "verb": "attack", "where": "<place id>"}, "smoke": "advance"}
At most 3 orders. letter, decoy and smoke are optional; leave them out unless you want them.`
}

export function brief(v: GeneralView) {
  const age = (t: number) => `${Math.round((v.tick - t) / TICKS)}w ago`
  const lines = [
    `WATCH ${v.watch} of ${v.watches}.`,
    `YOUR SQUADS (last reports): ${v.own.map(s => `${s.id} ${s.type} "${s.name}" at ${s.place}, strength ${s.strength}, ${age(s.tick)}`).join('; ')}`,
    `ENEMIES SEEN: ${v.enemies.filter(s => s.tick > 0).map(s => `${s.house} ${s.type} at ${s.place} str ${s.strength}, ${age(s.tick)}`).join('; ') || 'none since the start (all began in their camps)'}`,
    `CAPTURED ENEMY LETTERS (_ = not yet decoded): ${v.intel.slice(-8).map(i => `[${i.from}] ${i.text}`).join(' | ') || 'none'}`,
    `LETTERS TO YOU: ${v.inbox.map(m => `${m.from}: "${m.text}"`).join(' | ') || 'none'}`,
    `SMOKE SEEN: ${v.smoke.slice(-4).map(s => `${s.house} ${s.code} (watch ${s.watch})`).join(', ') || 'none'}`,
    `TRUCES IN FORCE: ${v.truces.join(', ') || 'none'}`,
  ]
  return lines.join('\n')
}

// ---- answer checking
const BAD = /\b(fuck|shit|rape|nazi|genocide|jihad|hindu|muslim|christian|sikh|nigg\w*|faggot)\b/i // ponytail: small list; daily battles are also human-reviewed
const clean = (s: unknown, n: number) => { const t = String(s ?? '').slice(0, n); return BAD.test(t) ? '[words withheld]' : t }
const placeId = (x: unknown) => {
  const s = String(x ?? '').trim()
  return NODES.find(n => n.id.toLowerCase() === s.toLowerCase() || n.name.toLowerCase() === s.toLowerCase())?.id
}

export function parseDecision(text: string, h: HouseId): { d?: Decision; error?: string } {
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  const a = body.indexOf('{'), b = body.lastIndexOf('}')
  if (a < 0 || b < a) return { error: 'no JSON object found' }
  let j: any
  try { j = JSON.parse(body.slice(a, b + 1)) } catch (e) { return { error: `invalid JSON: ${(e as Error).message}` } }
  const errs: string[] = []
  const own = (id: unknown) => typeof id === 'string' && id.startsWith(`${h}-`)
  const verb = (x: unknown) => VERBS.find(v => v === String(x ?? '').toLowerCase())
  const orders = (Array.isArray(j.orders) ? j.orders : []).slice(0, 3).flatMap((o: any, i: number) => {
    const where = placeId(o?.where), v = verb(o?.verb)
    if (!own(o?.to)) errs.push(`orders[${i}].to must be one of your squad ids`)
    if (!v) errs.push(`orders[${i}].verb must be one of ${VERBS.join('/')}`)
    if (!where) errs.push(`orders[${i}].where must be a place id`)
    const method = ['plain', 'cipher', 'double'].includes(o?.method) ? o.method : o?.method === 'courier' ? 'plain' : 'cipher'
    return own(o?.to) && v && where ? [{ to: o.to, verb: v, where, method, route: o?.route === 'hill' ? 'hill' : 'road' }] : []
  })
  if (errs.length) return { error: errs.join('; ') }
  const d: Decision = { thought: clean(j.thought, 280), orders }
  if (j.letter?.to && HOUSES.includes(String(j.letter.to).toLowerCase() as HouseId) && j.letter.text)
    d.letter = { to: String(j.letter.to).toLowerCase() as HouseId, text: clean(j.letter.text, 200), method: j.letter.method === 'plain' ? 'plain' : 'cipher' }
  if (own(j.decoy?.to) && placeId(j.decoy?.where)) d.decoy = { to: j.decoy.to, verb: verb(j.decoy.verb) ?? 'attack', where: placeId(j.decoy.where)! }
  if (SMOKES.includes(j.smoke)) d.smoke = j.smoke
  return { d }
}

// ---- the general
export function modelGeneral(h: HouseId, cfg: Config = loadConfig(), env: Record<string, string | undefined> = process.env, f: Fetch = fetch): General {
  const chain = cfg.houses[h]
  let at = 0 // index into the fallback chain; moves forward when a provider stays down
  const stats = { calls: 0, tokens: 0 }

  async function chat(messages: { role: string; content: string }[]) {
    for (; at < chain.length; at++) {
      const link = chain[at], p = cfg.providers[link.provider]
      if (p.key && !env[p.key]) continue
      const est = Math.ceil(messages.reduce((a, m) => a + m.content.length, 0) / 4) + 600
      for (let attempt = 0; attempt < 4; attempt++) {
        await take(link.provider, p, est)
        let r: Response
        try {
          r = await f(`${p.base}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(p.key ? { authorization: `Bearer ${env[p.key]}` } : {}) },
            body: JSON.stringify({ model: link.model, messages, temperature: 0.7, max_tokens: 700, ...(p.json ? { response_format: { type: 'json_object' } } : {}) }),
            signal: AbortSignal.timeout(120_000),
          })
        } catch { await sleep(5_000 * 2 ** attempt); continue }
        if (r.status === 429 || r.status >= 500) { await sleep((Number(r.headers.get('retry-after')) || 10 * 2 ** attempt) * 1000); continue }
        if (!r.ok) break // 4xx: wrong model id or key; try the next link
        const j: any = await r.json()
        stats.calls++
        stats.tokens += j.usage?.total_tokens ?? est
        return { text: String(j.choices?.[0]?.message?.content ?? ''), model: `${link.provider}:${link.model}`, tokens: j.usage?.total_tokens ?? est }
      }
    }
    throw new ProviderDown(`${h}: every provider in the chain failed`)
  }

  return {
    get model() { return chain.map(c => c.model).join(' → ') },
    async persona(_h, doctrine = '') {
      try {
        const r = await chat([{ role: 'system', content: rules(h, doctrine) }, { role: 'user', content: 'Before battle: answer only {"name": "<a title for yourself, max 4 words>", "line": "<one line to your army, max 120 chars>"}' }])
        const j = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1))
        return { name: clean(j.name, 40) || PERSONA[h][0], line: clean(j.line, 140) || PERSONA[h][1] } // a blank answer keeps the house's own
      } catch (e) {
        if (e instanceof ProviderDown) throw e
        return { name: PERSONA[h][0], line: PERSONA[h][1] }
      }
    },
    async decide(v) {
      const messages = [{ role: 'system', content: rules(h, v.doctrine) }, { role: 'user', content: brief(v) }]
      const first = await chat(messages)
      let res = parseDecision(first.text, h), retries = 0, tokens = first.tokens
      if (res.error) {
        retries = 1
        const again = await chat([...messages, { role: 'assistant', content: first.text.slice(0, 2000) }, { role: 'user', content: `That answer was rejected: ${res.error}. Reply with the corrected JSON object only.` }])
        tokens += again.tokens
        res = parseDecision(again.text, h)
      }
      const meta = { model: first.model, tokens, retries, error: res.error }
      return res.d ? { ...res.d, meta } : { thought: '', orders: [], meta } // bad twice: the rider never left camp
    },
  }
}

