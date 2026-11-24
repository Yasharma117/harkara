// The War Council (formerly the Doctrine Ladder): pick a general, pick three tactic cards, send. Tonight that house fights
// a ladder battle on the shared free model with your three tactics as its standing orders; results post next morning.
// The page sends only {house, cards, by}; the API turns the cards into the doctrine text (engine/tactics.ts).
// Results ship with the site as replay/ladder.json.
const API: string = (import.meta as any).env?.VITE_LADDER_API ?? ''
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

import { DECK, PICK } from '../engine/tactics.ts' // what the viewer sees and what the general is told

export function ladder(COLOR: Record<string, string>, names: Record<string, string>, portrait: (h: string) => string) {
  const d = document.createElement('dialog')
  d.id = 'ladder'
  d.innerHTML = `
    <form method="dialog" class="close"><button aria-label="Close">✕</button></form>
    <h2>War Council</h2>
    <p class="lede">Give one general your three best tactics. Every night the council deals each general three tactic cards at random and they fight on the same AI, so only the tactics differ. Send your own and they may be drawn in place of the deal. Results post the next morning.</p>
    <form id="ld-form">
      <h3><span>1</span> Choose a general</h3>
      <fieldset class="houses">${Object.keys(COLOR).map((h, i) => `<label style="--c:${COLOR[h]}"><input type="radio" name="house" value="${h}" ${i ? '' : 'checked'}><img src="${portrait(h)}" alt=""><span>${esc(names[h] ?? cap(h))}</span></label>`).join('')}</fieldset>
      <h3><span>2</span> Choose ${PICK} tactics <small id="ld-count">0 of ${PICK}</small></h3>
      <div class="deck">${DECK.map(c => `<button type="button" class="tac" data-id="${c.id}" aria-pressed="false"><i>${c.glyph}</i><b>${c.title}</b><small>${c.line}</small></button>`).join('')}</div>
      <h3><span>3</span> Send your orders</h3>
      <div class="row"><input name="by" maxlength="24" placeholder="Your name (optional)" autocomplete="nickname"><button type="submit" disabled>Send your orders</button></div>
      <p id="ld-msg" role="status"></p>
    </form>
    <h3>Tonight</h3><p id="ld-tonight" class="muted">…</p>
    <h3>Past nights</h3><div id="ld-results" class="muted">…</div>`
  document.body.append(d)
  const form = d.querySelector<HTMLFormElement>('#ld-form')!, msg = d.querySelector('#ld-msg')!, send = form.querySelector<HTMLButtonElement>('button[type=submit]')!
  const chosen: string[] = []
  const sync = () => {
    form.querySelectorAll<HTMLButtonElement>('.tac').forEach(b => { const on = chosen.includes(b.dataset.id!); b.setAttribute('aria-pressed', String(on)); b.disabled = !on && chosen.length >= PICK })
    d.querySelector('#ld-count')!.textContent = `${chosen.length} of ${PICK}`
    send.disabled = chosen.length < PICK || !API
  }
  form.querySelector('.deck')!.addEventListener('click', e => {
    const id = (e.target as Element).closest<HTMLElement>('.tac')?.dataset.id
    if (!id) return
    const c = DECK.find(x => x.id === id)!
    if (chosen.includes(id)) chosen.splice(chosen.indexOf(id), 1)
    else { if (c.group) for (const o of DECK) if (o.group === c.group && chosen.includes(o.id)) chosen.splice(chosen.indexOf(o.id), 1); if (chosen.length < PICK) chosen.push(id) } // one of each kind: picking west drops middle
    sync()
  })
  if (!API) { send.textContent = 'Opens at launch'; msg.textContent = 'You can try the cards now; sending opens at launch. Below are the rehearsal nights.' }
  form.onsubmit = async e => {
    e.preventDefault()
    const f = new FormData(form)
    send.disabled = true; msg.textContent = 'Sending your rider…'
    try {
      const r = await fetch(`${API}/api/doctrine`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ house: f.get('house'), cards: chosen, by: f.get('by') }) })
      const j = await r.json().catch(() => ({}))
      msg.textContent = r.ok ? `Sent. Your orders for ${cap(j.house)} are in tonight’s draw; results post tomorrow morning.` : (j.error ?? `The server said ${r.status}.`)
      if (r.ok) { chosen.length = 0; sync(); tonight() } else send.disabled = false
    } catch { msg.textContent = 'The council’s server didn’t answer. Try again in a minute.'; send.disabled = false }
  }
  const tonight = async () => {
    const el = d.querySelector('#ld-tonight')!
    if (!API) { el.textContent = 'The first council night starts at launch.'; return }
    try {
      const j = await (await fetch(`${API}/api/ladder`)).json()
      const n = Object.values(j.entries as Record<string, number>).reduce((a, b) => a + b, 0)
      el.innerHTML = n ? `${n} set${n > 1 ? 's' : ''} of orders in: ${Object.entries(j.entries).map(([h, c]) => `<b style="color:${COLOR[h]}">${cap(h)}</b> ${c}`).join(' · ')}. They stay sealed until the draw.` : 'No orders yet tonight. Be the first.'
    } catch { el.textContent = 'Couldn’t reach the council’s server.' }
  }
  // an entry made from cards shows its cards; an older free-text doctrine shows as a quote
  const tactics = (t: string | null) => {
    const m = t?.match(/^Tactics: ([^.]+)\./)
    return m ? `<span class="ld-tacs">${m[1].split('; ').map(x => `<i>${esc(x)}</i>`).join('')}</span>` : t ? `<q>${esc(t)}</q>` : ''
  }
  const results = async () => {
    const el = d.querySelector('#ld-results')!
    const days: { date: string; battles: { id: string; winner: string; reason: string; entries: { house: string; by: string | null; text: string | null; score: number }[] }[] }[] = await fetch('replay/ladder.json').then(r => r.ok ? r.json() : []).catch(() => [])
    if (!days.length) { el.textContent = 'No nights yet. The first results post the morning after launch.'; return }
    el.innerHTML = days.slice().reverse().slice(0, 7).map(day => `<section><h4>${day.date}</h4>${day.battles.map(b => `<div class="ld-battle"><div class="ld-head"><b style="color:${COLOR[b.winner]}">${cap(b.winner)}</b> won <a href="#${b.id}" data-id="${b.id}">Watch it</a></div><ol>${b.entries.map(e => `<li style="--c:${COLOR[e.house]}"><b>${cap(e.house)}</b> ${e.score} pts <small>${e.by ? (/\(test\)/.test(e.by) ? 'rehearsal' : `by ${esc(e.by)}`) : 'dealt by lot'}</small>${e.text ? `<br>${tactics(e.text)}` : ''}</li>`).join('')}</ol></div>`).join('')}</section>`).join('')
    el.querySelectorAll<HTMLAnchorElement>('a[data-id]').forEach(a => a.onclick = ev => { ev.preventDefault(); location.hash = a.dataset.id!; location.reload() })
  }
  sync()
  return { open() { d.showModal(); tonight(); results() } }
}
