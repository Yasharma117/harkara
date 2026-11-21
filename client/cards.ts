// The generals as hand-painted playing cards (after Indian ganjifa: lacquered paper, a painted border in the suit's
// colour, corner indices, an arched window). The big cards are real 3D cards (holo3d.ts); the small ones show the
// painted general in their window. One look everywhere: title, roll-call, side panel, end card. CSS lives in index.html (.holo).
// The pointer tilts the card and slides a lacquer sheen across it.
type House = { id: string; name: string; line: string; model: string }
const UNIT: Record<string, string> = { inf: 'Foot', arch: 'Bows', cav: 'Horse', ele: 'Elephants' }

export function holoCard(h: House, o: { color: string; portrait?: string; emblem?: string; squads: { house: string; type: string }[]; size?: 'big' | 'mini' }) {
  const n: Record<string, number> = {}
  for (const s of o.squads) if (s.house === h.id) n[s.type] = (n[s.type] ?? 0) + 1
  const who = h.model === 'scripted' ? 'Rehearsal general' : h.model.split(' → ')[0].split('/').pop()
  const idx = `<b>${h.id[0].toUpperCase()}</b>${o.emblem ? '<i class="ho-pip"></i>' : ''}`
  const stats = `<div class="ho-stats">${Object.entries(UNIT).filter(([k]) => n[k]).map(([k, v]) => `<span>${'<i></i>'.repeat(n[k])}${v}</span>`).join('')}</div>`
  // the big cards are real 3D cards (holo3d.ts) with their particulars underneath; the flat thumbnail shows until the first frame
  if (o.size !== 'mini') return `<div class="holo big card3" data-h="${h.id}" tabindex="0" style="--c:${o.color};--thumb:url(art/cards/${h.id}-thumb.webp)">
  <div class="slot" role="img" aria-label="${h.name}, general of House ${h.id}"></div>
  <div class="ho-cap"><b class="ho-name">${h.name}</b><div class="ho-who">${who}</div>${stats}<q class="ho-line">${h.line}</q></div></div>`
  return `<div class="holo ${o.size === 'mini' ? 'mini house' : 'big'}" data-h="${h.id}" tabindex="0" style="--c:${o.color}${o.emblem ? `;--m:url(${o.emblem})` : ''}">
  <div class="ho-in">
    <span class="ho-idx tl" aria-hidden="true">${idx}</span><span class="ho-idx br" aria-hidden="true">${idx}</span>
    <div class="ho-art"><img class="fig" src="art/cards/${h.id}-figure.webp" alt=""></div>
    <div class="ho-top"><b class="ho-name">${h.name}</b></div>
    <div class="ho-who">${who}</div>
    ${stats}
    <q class="ho-line">${h.line}</q>
    <i class="ho-sheen"></i>
  </div></div>`
}

// one listener for every card on the page, present and future
let cur: HTMLElement | null = null
const reset = (el: HTMLElement) => { el.classList.remove('on'); const s = el.firstElementChild as HTMLElement; for (const p of ['--mx', '--my', '--rx', '--ry', '--o']) s.style.removeProperty(p) }
export function holoTilt() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  addEventListener('pointermove', e => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('.holo:not(.card3)') ?? null
    if (cur && cur !== el) reset(cur)
    cur = el
    if (!el) return
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    const k = el.classList.contains('mini') ? 0.3 : 0.7 // a card in the hand, not a hologram: a gentle lean
    const s = el.firstElementChild as HTMLElement
    el.classList.add('on')
    s.style.setProperty('--mx', `${x * 100}%`); s.style.setProperty('--my', `${y * 100}%`)
    s.style.setProperty('--rx', `${(0.5 - y) * 16 * k}deg`); s.style.setProperty('--ry', `${(x - 0.5) * 20 * k}deg`); s.style.setProperty('--o', '1')
  }, { passive: true })
  document.addEventListener('pointerleave', () => { if (cur) reset(cur); cur = null })
}
