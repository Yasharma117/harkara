// The Doctrine Ladder page: write tonight's doctrine for a house; read last nights' results and watch the battles.
// Submits to the ladder API on the A1 (VITE_LADDER_API at build time); results ship with the site as replay/ladder.json.
const API: string = (import.meta as any).env?.VITE_LADDER_API ?? ''
const MAX = 600
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export function ladder(COLOR: Record<string, string>, names: Record<string, string>, portrait: (h: string) => string) {
  const d = document.createElement('dialog')
  d.id = 'ladder'
  d.innerHTML = `
    <form method="dialog" class="close"><button aria-label="Close">✕</button></form>
    <h2>The Doctrine Ladder</h2>
    <p class="lede">Write up to ${MAX} characters of standing guidance for one house. Tonight every house in a ladder battle runs the same free model, so only the doctrines differ. Your doctrine is shown only to your own general, never to its rivals. Results post the next morning.</p>
    <form id="ld-form">
      <fieldset class="houses">${Object.keys(COLOR).map((h, i) => `<label style="--c:${COLOR[h]}"><input type="radio" name="house" value="${h}" ${i ? '' : 'checked'}><img src="${portrait(h)}" alt=""><span>${esc(names[h] ?? cap(h))}</span></label>`).join('')}</fieldset>
      <textarea name="text" maxlength="${MAX}" rows="5" required minlength="10" placeholder="e.g. Never send plain text. Send a decoy before every attack. Hold the middle ford with foot; horse hunts riders on the north bank."></textarea>
      <div class="row"><input name="by" maxlength="24" placeholder="Your name (optional)" autocomplete="nickname"><span id="ld-count">0 / ${MAX}</span><button type="submit">Enter tonight’s ladder</button></div>
      <p id="ld-msg" role="status"></p>
    </form>
    <h3>Tonight</h3><p id="ld-tonight" class="muted">…</p>
    <h3>Results</h3><div id="ld-results" class="muted">…</div>`
  document.body.append(d)
  const form = d.querySelector<HTMLFormElement>('#ld-form')!, msg = d.querySelector('#ld-msg')!, ta = form.elements.namedItem('text') as HTMLTextAreaElement
  const count = () => { d.querySelector('#ld-count')!.textContent = `${ta.value.length} / ${MAX}` }
  ta.oninput = count
  if (!API) { form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = true; msg.textContent = 'Entries open when the ladder server goes live.' }
  form.onsubmit = async e => {
    e.preventDefault()
    const f = new FormData(form), btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!
    btn.disabled = true; msg.textContent = 'Sending your rider…'
    try {
      const r = await fetch(`${API}/api/doctrine`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ house: f.get('house'), text: f.get('text'), by: f.get('by') }) })
      const j = await r.json().catch(() => ({}))
      msg.textContent = r.ok ? `Entered for ${cap(j.house)}. Its battle runs tonight; results post tomorrow morning.` : (j.error ?? `The server said ${r.status}.`)
      if (r.ok) { form.reset(); count(); tonight() } else btn.disabled = false
    } catch { msg.textContent = 'The ladder server didn’t answer. Try again in a minute.'; btn.disabled = false }
  }
  const tonight = async () => {
    const el = d.querySelector('#ld-tonight')!
    if (!API) { el.textContent = 'The first ladder night starts at launch.'; return }
    try {
      const j = await (await fetch(`${API}/api/ladder`)).json()
      const n = Object.values(j.entries as Record<string, number>).reduce((a, b) => a + b, 0)
      el.innerHTML = n ? `${n} doctrine${n > 1 ? 's' : ''} entered: ${Object.entries(j.entries).map(([h, c]) => `<b style="color:${COLOR[h]}">${cap(h)}</b> ${c}`).join(' · ')}. Entries stay sealed until their battle.` : 'No entries yet tonight. Be the first.'
    } catch { el.textContent = 'Couldn’t reach the ladder server.' }
  }
  const results = async () => {
    const el = d.querySelector('#ld-results')!
    const days: { date: string; battles: { id: string; winner: string; reason: string; entries: { house: string; by: string | null; text: string | null; score: number }[] }[] }[] = await fetch('replay/ladder.json').then(r => r.ok ? r.json() : []).catch(() => [])
    if (!days.length) { el.textContent = 'No ladder nights yet. The first results post the morning after launch.'; return }
    el.innerHTML = days.slice().reverse().slice(0, 7).map(day => `<section><h4>${day.date}</h4>${day.battles.map(b => `<div class="ld-battle"><div class="ld-head"><b style="color:${COLOR[b.winner]}">${cap(b.winner)}</b> wins: ${esc(b.reason.toLowerCase())} <a href="#${b.id}" data-id="${b.id}">Watch the battle</a></div><ol>${b.entries.map(e => `<li style="--c:${COLOR[e.house]}"><b>${cap(e.house)}</b> ${e.score} <small>${e.by ? `by ${esc(e.by)}` : 'house default'}</small>${e.text ? `<br><q>${esc(e.text)}</q>` : ''}</li>`).join('')}</ol></div>`).join('')}</section>`).join('')
    el.querySelectorAll<HTMLAnchorElement>('a[data-id]').forEach(a => a.onclick = ev => { ev.preventDefault(); location.hash = a.dataset.id!; location.reload() })
  }
  return { open() { d.showModal(); tonight(); results() } }
}
