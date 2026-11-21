// The War Council (formerly the Doctrine Ladder): pick a general, pick three tactic cards, send. Tonight that house fights
// a ladder battle on the shared free model with your three tactics as its standing orders; results post next morning.
// The cards become the doctrine text the API and engine already take ({house, text, by} → engine/ladder.ts), so nothing
// server-side changed. Results ship with the site as replay/ladder.json.
const API: string = (import.meta as any).env?.VITE_LADDER_API ?? ''
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

// what the viewer sees (title, line) and what the general is told (order). Orders say "ford": that is the word on the
// generals' own map. Cards in the same group exclude each other.
const DECK: { id: string; glyph: string; title: string; line: string; order: string; group?: string }[] = [
  { id: 'code', glyph: '✉', title: 'Code every letter', line: 'Slow to send, slow to read', order: 'Send every order in cipher, never plain.', group: 'cipher' },
  { id: 'plain', glyph: '➶', title: 'Speed over secrecy', line: 'Plain letters leave at once', order: 'Send orders plain so they leave at once.', group: 'cipher' },
  { id: 'decoy', glyph: '◇', title: 'Send decoys', line: 'A false letter, meant to be caught', order: 'Before each real attack, send a decoy letter naming a false target, meant to be caught.' },
  { id: 'twin', glyph: '⇉', title: 'Two riders', line: 'Big orders go by two roads', order: 'Send every important order by two riders on two different roads.' },
  { id: 'hunt', glyph: '⚔', title: 'Hunt their riders', line: 'Horse patrols the roads', order: 'Use your horse to catch enemy riders on the roads rather than to fight.' },
  { id: 'read', glyph: '◉', title: 'Act on their mail', line: 'Meet them where they said', order: 'Act on every enemy letter you capture: be where it says they are going, first.' },
  { id: 'west', glyph: '◀', title: 'Take the west crossing', line: 'Early, with everything', order: 'Take the west ford in the first five watches and hold it.', group: 'aim' },
  { id: 'middle', glyph: '◆', title: 'Take the middle crossing', line: 'Early, with everything', order: 'Take the middle ford in the first five watches and hold it.', group: 'aim' },
  { id: 'east', glyph: '▶', title: 'Take the east crossing', line: 'Early, with everything', order: 'Take the east ford in the first five watches and hold it.', group: 'aim' },
  { id: 'hold', glyph: '▣', title: 'Never let go', line: 'What you hold, you keep', order: 'Once you hold a ford, never leave it; defend it with foot and elephants.' },
  { id: 'truce', glyph: '☍', title: 'Make a friend', line: 'A truce, then turn on the rest', order: 'Offer a truce to one rival early, and fight the others.' },
  { id: 'smoke', glyph: '♨', title: 'Last-watch charge', line: 'Smoke, then everything moves', order: 'Save smoke signals for an all-out move in the last three watches.' },
]
const PICK = 3

export function ladder(COLOR: Record<string, string>, names: Record<string, string>, portrait: (h: string) => string) {
  const d = document.createElement('dialog')
  d.id = 'ladder'
  d.innerHTML = `
    <form method="dialog" class="close"><button aria-label="Close">✕</button></form>
    <h2>War Council</h2>
    <p class="lede">Give one general your three best tactics. Tonight it fights with them against three rivals on the same AI, so only the tactics differ. Results post tomorrow morning.</p>
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
    const f = new FormData(form), cards = chosen.map(i => DECK.find(c => c.id === i)!)
    const text = `Tactics: ${cards.map(c => c.title).join('; ')}. ${cards.map(c => c.order).join(' ')}` // the "Tactics:" line lets results show the cards again
    send.disabled = true; msg.textContent = 'Sending your rider…'
    try {
      const r = await fetch(`${API}/api/doctrine`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ house: f.get('house'), text, by: f.get('by') }) })
      const j = await r.json().catch(() => ({}))
      msg.textContent = r.ok ? `Sent. ${cap(j.house)} fights with your tactics tonight; results post tomorrow morning.` : (j.error ?? `The server said ${r.status}.`)
      if (r.ok) { chosen.length = 0; sync(); tonight() } else send.disabled = false
    } catch { msg.textContent = 'The council’s server didn’t answer. Try again in a minute.'; send.disabled = false }
  }
  const tonight = async () => {
    const el = d.querySelector('#ld-tonight')!
    if (!API) { el.textContent = 'The first council night starts at launch.'; return }
    try {
      const j = await (await fetch(`${API}/api/ladder`)).json()
      const n = Object.values(j.entries as Record<string, number>).reduce((a, b) => a + b, 0)
      el.innerHTML = n ? `${n} set${n > 1 ? 's' : ''} of orders in: ${Object.entries(j.entries).map(([h, c]) => `<b style="color:${COLOR[h]}">${cap(h)}</b> ${c}`).join(' · ')}. They stay sealed until the battle.` : 'No orders yet tonight. Be the first.'
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
    el.innerHTML = days.slice().reverse().slice(0, 7).map(day => `<section><h4>${day.date}</h4>${day.battles.map(b => `<div class="ld-battle"><div class="ld-head"><b style="color:${COLOR[b.winner]}">${cap(b.winner)}</b> won <a href="#${b.id}" data-id="${b.id}">Watch it</a></div><ol>${b.entries.map(e => `<li style="--c:${COLOR[e.house]}"><b>${cap(e.house)}</b> ${e.score} pts <small>${e.by ? (/\(test\)/.test(e.by) ? 'rehearsal' : `by ${esc(e.by)}`) : 'house default'}</small>${e.text ? `<br>${tactics(e.text)}` : ''}</li>`).join('')}</ol></div>`).join('')}</section>`).join('')
    el.querySelectorAll<HTMLAnchorElement>('a[data-id]').forEach(a => a.onclick = ev => { ev.preventDefault(); location.hash = a.dataset.id!; location.reload() })
  }
  sync()
  return { open() { d.showModal(); tonight(); results() } }
}
