// First-battle tour: coach marks, like a mobile app's onboarding. Each step waits for its moment in the battle, pauses
// it, spotlights one part of the screen and explains it in a line or two; "Got it" resumes. Runs once per browser
// (localStorage 'harkara-tour'), or again with ?tour. Skippable at any step.
type Ev = { t: number; type: string; [k: string]: any }
type Step = { sel: string; title: string; text: string; when: (t: number, events: Ev[], TPW: number) => boolean }

const KEY = 'harkara-tour'
const STEPS: Step[] = [
  { sel: '#houses', title: 'The four generals', text: 'Each is an AI. Its chip shows the score, what it’s doing right now, and how much of its army is left. <b>Click one to back it</b> to win, before watch 10.', when: t => t > 20 },
  { sel: '#fords', title: 'Three river crossings', text: 'A crossing belongs to whoever has the most soldiers on it. <b>Hold two when the last watch ends and you win</b>; otherwise points decide.', when: (t, _, TPW) => t > TPW * 1.2 },
  { sel: '#feed', title: 'A rider was caught', text: 'No general can see the field: every order rides out on horseback. That rider’s letter is now in enemy hands, and <b>they can read it</b>.', when: (t, ev) => ev.some(e => (e.type === 'caught' || e.type === 'killed') && e.t <= t) },
  { sel: '#beliefs', title: 'See what they believe', text: 'Each general only knows what its riders report, hours late. <b>Switch to a general’s view</b> to see the field the way it thinks it is.', when: (t, _, TPW) => t > TPW * 3 },
  { sel: '#marks', title: 'The big moments', text: 'Every mark on the timeline is a capture, a broken cipher, a truce or a rout. <b>Click one to jump there.</b> That’s the tour: enjoy the battle.', when: (t, _, TPW) => t > TPW * 4 },
]

export function tour(o: { pause: () => boolean; resume: () => void }) {
  const force = new URLSearchParams(location.search).has('tour')
  let done = (() => { try { return !force && localStorage.getItem(KEY) === 'done' } catch { return false } })()
  let at = 0, open = false
  const shade = document.createElement('div'); shade.className = 'tr-spot'; shade.hidden = true
  const tip = document.createElement('div'); tip.className = 'tr-tip'; tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-live', 'polite'); tip.hidden = true
  document.body.append(shade, tip)
  let wasPlaying = false, target: HTMLElement | null = null

  const place = () => {
    if (!target || !open) return
    const r = target.getBoundingClientRect(), pad = 8
    Object.assign(shade.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` })
    const tw = tip.offsetWidth, th = tip.offsetHeight, below = r.bottom + 16 + th < innerHeight
    const x = Math.max(12, Math.min(innerWidth - tw - 12, r.left + r.width / 2 - tw / 2))
    tip.style.left = `${x}px`; tip.style.top = `${below ? r.bottom + 16 : Math.max(12, r.top - th - 16)}px`
    tip.classList.toggle('up', !below)
    tip.style.setProperty('--ax', `${Math.max(18, Math.min(tw - 18, r.left + r.width / 2 - x))}px`)
  }
  addEventListener('resize', place)

  const finish = () => { done = true; try { localStorage.setItem(KEY, 'done') } catch {} ; close() }
  const close = () => {
    open = false; shade.classList.remove('on'); tip.classList.remove('on')
    setTimeout(() => { if (!open) { shade.hidden = true; tip.hidden = true } }, 260)
    if (wasPlaying) o.resume()
  }
  function show(i: number) {
    const s = STEPS[i], el = document.querySelector<HTMLElement>(s.sel)
    if (!el || !el.offsetParent) { at++; return } // not on screen (hidden panel): skip this one
    target = el; open = true
    el.scrollIntoView?.({ block: 'nearest', inline: 'center' })
    wasPlaying = o.pause()
    tip.innerHTML = `<small>${i + 1} / ${STEPS.length}</small><h4>${s.title}</h4><p>${s.text}</p><div class="tr-act"><button class="tr-skip">Skip tour</button><button class="tr-next">${i === STEPS.length - 1 ? 'Done' : 'Got it'}</button></div><span class="tr-dots">${STEPS.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'seen' : ''}"></i>`).join('')}</span>`
    shade.hidden = false; tip.hidden = false
    requestAnimationFrame(() => { place(); shade.classList.add('on'); tip.classList.add('on'); tip.querySelector<HTMLButtonElement>('.tr-next')!.focus({ preventScroll: true }) })
    tip.querySelector<HTMLButtonElement>('.tr-next')!.onclick = () => { at = i + 1; if (at >= STEPS.length) finish(); else close() }
    tip.querySelector<HTMLButtonElement>('.tr-skip')!.onclick = finish
  }
  addEventListener('keydown', e => { if (!open) return; if (e.key === 'Escape') finish(); else if (e.key === 'Enter') tip.querySelector<HTMLButtonElement>('.tr-next')?.click() })

  return {
    // called every frame while the battle runs (not during the title or matchup)
    tick(t: number, events: Ev[], TPW: number) {
      if (done || open || at >= STEPS.length) return
      if (STEPS[at].when(t, events, TPW)) show(at)
      if (at >= STEPS.length) finish()
    },
    place,
  }
}
