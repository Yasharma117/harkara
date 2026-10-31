// npm run check — one tiny call to every model in providers.json, so wrong ids or keys show up before a battle.
import { loadConfig } from './model.ts'
const cfg = loadConfig()
for (const [house, chain] of Object.entries(cfg.houses)) for (const l of chain) {
  const p = cfg.providers[l.provider]
  if (p.key && !process.env[p.key]) { console.log(`${house}  ${l.provider}:${l.model}  SKIP (no ${p.key})`); continue }
  const t = Date.now()
  try {
    const r = await fetch(`${p.base}/chat/completions`, { method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { 'content-type': 'application/json', ...(p.key ? { authorization: `Bearer ${process.env[p.key]}` } : {}) },
      body: JSON.stringify({ model: l.model, messages: [{ role: 'user', content: 'Reply with {"ok": true} only.' }], max_tokens: 20 }) })
    console.log(`${house}  ${l.provider}:${l.model}  ${r.ok ? 'OK' : `FAIL ${r.status} ${(await r.text()).slice(0, 120)}`}  ${Date.now() - t}ms`)
  } catch (e) { console.log(`${house}  ${l.provider}:${l.model}  FAIL ${(e as Error).message}`) }
}
