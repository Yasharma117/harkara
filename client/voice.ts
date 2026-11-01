// Voice and the opening scene. Clips are pre-generated per replay (tools/voice.ts → replay/<id>/audio.json);
// without them the opening still plays as captions and the battle stays silent.
const KEY = 'harkara-sound'
type House = { id: string; name: string; line: string }

export async function voice(id: string, houses: House[], COLOR: Record<string, string>, portrait: (h: string) => string, stage: HTMLElement) {
  const clips: Record<string, string> = await fetch(`replay/${id}/audio.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
  let on = localStorage.getItem(KEY) !== 'off'
  let speaking: HTMLAudioElement | null = null
  const play = (key: string) => {
    if (!on || !clips[key]) return null
    speaking?.pause()
    const a = new Audio(`replay/${id}/audio/${clips[key]}`)
    a.play().catch(() => {}) // blocked before the first click: stays silent, captions still show
    a.onended = () => { if (speaking === a) speaking = null }
    return (speaking = a)
  }

  // ---- opening: each general names itself and speaks one line to its army
  const ov = document.createElement('div')
  ov.id = 'opening'
  ov.hidden = true
  const m = id.match(/^(daily|ladder)-(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/)
  const title = m ? `${new Date(m[2] + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${m[1] === 'ladder' ? ` · ladder battle ${m[3]}` : ''}` : id.replace(/-/g, ' ')
  ov.innerHTML = `<div class="op-title"><small>${m?.[1] === 'ladder' ? 'The Doctrine Ladder' : 'Today on the river'}</small><b>${title}</b></div><div class="op-cards">${houses.map(h => `<figure data-h="${h.id}" style="--c:${COLOR[h.id]}">${portrait(h.id) ? `<img src="${portrait(h.id)}" alt="">` : ''}<figcaption><b>${h.name}</b><q>${h.line}</q></figcaption></figure>`).join('')}</div><button class="op-skip">Skip</button>`
  stage.append(ov)
  let skip = () => {}
  ov.querySelector<HTMLButtonElement>('.op-skip')!.onclick = () => skip()
  let busy = false
  async function opening() {
    ov.hidden = false; busy = true
    let skipped = false
    const skipped$ = new Promise<void>(r => (skip = () => { skipped = true; speaking?.pause(); r() }))
    for (const h of houses) {
      if (skipped) break
      ov.querySelectorAll('figure').forEach(f => f.classList.toggle('now', f.dataset.h === h.id))
      const a = play(`p-${h.id}`)
      const done = a ? new Promise<void>(r => { a.onended = () => r(); a.onerror = () => r(); a.onloadedmetadata = () => setTimeout(r, (a.duration || 6) * 1000 + 1000); setTimeout(r, 9000) }) : new Promise<void>(r => setTimeout(r, 2600))
      await Promise.race([done, skipped$])
    }
    ov.classList.add('out')
    await new Promise(r => setTimeout(r, 400))
    ov.hidden = true; ov.classList.remove('out'); busy = false
  }

  // ---- during the battle: voice the newest general's thought, never a backlog
  let heard = -1, lastT = 0
  function tick(events: { seq: number; t: number; type: string }[], t: number, playing: boolean, speed: number) {
    if (t < lastT - 1) { heard = -1; speaking?.pause() } // scrubbed back: don't replay a pile of lines
    lastT = t
    if (!playing) { for (let i = events.length - 1; i >= 0; i--) if (events[i].t <= t) { heard = Math.max(heard, events[i].seq); break } return } // paused: what's on screen counts as heard
    let newest = -1, top = heard
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.t > t) continue // loaded ahead of the playhead
      if (e.seq <= heard) break
      top = Math.max(top, e.seq)
      if (newest < 0 && e.type === 'thought' && e.t > t - 60) newest = e.seq
    }
    heard = top
    if (newest >= 0 && speed <= 8 && !(speaking && !speaking.paused)) play(String(newest))
  }

  const btn = document.createElement('button')
  const label = () => { btn.textContent = on ? 'Sound on' : 'Sound off'; btn.setAttribute('aria-pressed', String(on)) }
  btn.onclick = () => { on = !on; localStorage.setItem(KEY, on ? 'on' : 'off'); if (!on) speaking?.pause(); label() }
  label()
  btn.hidden = !Object.keys(clips).length
  return { opening, tick, button: btn, get busy() { return busy } }
}
