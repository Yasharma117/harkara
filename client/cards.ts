// Holo trading cards for the generals: one look everywhere (title, roll-call, side panel, end card).
// Pointer position drives tilt, a rainbow foil band, glitter and a glare spot through CSS custom properties; the
// look lives in index.html (.holo). The technique follows the well-known CSS holo-card demos (simeydotme's
// pokemon-cards-css and others); this is our own minimal version.
type House = { id: string; name: string; line: string; model: string }
const UNIT: Record<string, string> = { inf: 'Foot', arch: 'Bows', cav: 'Horse', ele: 'Elephants' }

export function holoCard(h: House, o: { color: string; portrait?: string; emblem?: string; squads: { house: string; type: string }[]; size?: 'big' | 'mini' }) {
  const n: Record<string, number> = {}
  for (const s of o.squads) if (s.house === h.id) n[s.type] = (n[s.type] ?? 0) + 1
  const who = h.model === 'scripted' ? 'Rehearsal general' : h.model.split(' → ')[0].split('/').pop()
  return `<div class="holo ${o.size === 'mini' ? 'mini house' : 'big'}" data-h="${h.id}" tabindex="0" style="--c:${o.color}${o.emblem ? `;--m:url(${o.emblem})` : ''}">
  <div class="ho-in">
    <div class="ho-top"><b class="ho-name">${h.name}</b>${o.emblem ? '<span class="ho-emb"></span>' : ''}</div>
    <div class="ho-art">${o.portrait ? `<img src="${o.portrait}" alt="">` : ''}</div>
    <div class="ho-who">${who}</div>
    <div class="ho-stats">${Object.entries(UNIT).filter(([k]) => n[k]).map(([k, v]) => `<span><b>${n[k]}</b>${v}</span>`).join('')}</div>
    <q class="ho-line">${h.line}</q>
    <i class="ho-foil"></i><i class="ho-glit"></i><i class="ho-glare"></i>
  </div></div>`
}

// one listener for every card on the page, present and future
let cur: HTMLElement | null = null
const reset = (el: HTMLElement) => { el.classList.remove('on'); const s = el.firstElementChild as HTMLElement; for (const p of ['--mx', '--my', '--rx', '--ry', '--o']) s.style.removeProperty(p) }
export function holoTilt() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  addEventListener('pointermove', e => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('.holo') ?? null
    if (cur && cur !== el) reset(cur)
    cur = el
    if (!el) return
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    const k = el.classList.contains('mini') ? 0.35 : 1 // panel cards lean less: they sit in a column of text
    const s = el.firstElementChild as HTMLElement
    el.classList.add('on')
    s.style.setProperty('--mx', `${x * 100}%`); s.style.setProperty('--my', `${y * 100}%`)
    s.style.setProperty('--rx', `${(0.5 - y) * 22 * k}deg`); s.style.setProperty('--ry', `${(x - 0.5) * 26 * k}deg`); s.style.setProperty('--o', '1')
  }, { passive: true })
  document.addEventListener('pointerleave', () => { if (cur) reset(cur); cur = null })
}
