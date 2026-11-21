// Voice and the opening scene. Clips are pre-generated per replay (tools/voice.ts → replay/<id>/audio.json);
// without them the opening still plays as captions and the battle stays silent.
import { emote } from './holo3d.ts'
const KEY = 'harkara-sound'
type House = { id: string; name: string; line: string }

export async function voice(id: string, houses: House[], COLOR: Record<string, string>, portrait: (h: string) => string, stage: HTMLElement, card: (h: House) => string) {
  const clips: Record<string, string> = {} // voiceover removed: the roll-call cards and captions carry the words
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
  const title = m ? `${new Date(m[2] + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${m[1] === 'ladder' ? ` · ladder battle ${m[3]}` : ''}` : /^grey-(\d+)$/.test(id) ? `Rehearsal battle ${id.split('-')[1]}` : id.replace(/-/g, ' ')
  ov.innerHTML = `<div class="op-title"><small>${m?.[1] === 'ladder' ? 'From the War Council' : 'Today on the river'}</small><b>${title}</b></div><div class="op-cards">${houses.map(card).join('<i class="op-vs" aria-hidden="true">vs</i>')}</div><p class="op-hint">Choose a general to meet them</p><button class="op-go">[ Enter the battle ]</button>`
  stage.append(ov)
  let go = () => {}
  ov.querySelector<HTMLButtonElement>('.op-go')!.onclick = () => go()
  let busy = false
  // the matchup: the four generals face off; picking one brings it forward with who commands it. Nothing starts until Enter.
  async function opening() {
    ov.hidden = false; busy = true
    const cards = [...ov.querySelectorAll<HTMLElement>('.holo')]
    const show = (h?: string) => {
      cards.forEach(f => { f.classList.toggle('now', f.dataset.h === h); f.setAttribute('aria-pressed', String(f.dataset.h === h)) })
      ov.classList.toggle('picked', !!h)
      if (h) emote(h, 'hello')
    }
    show()
    for (const f of cards) {
      f.setAttribute('role', 'button')
      f.onclick = () => show(f.classList.contains('now') ? undefined : f.dataset.h)
      f.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.click() } }
    }
    await new Promise<void>(r => (go = r))
    ov.classList.add('out')
    await new Promise(r => setTimeout(r, 340))
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
  let onToggle: (v: boolean) => void = () => {}
  btn.onclick = () => { on = !on; localStorage.setItem(KEY, on ? 'on' : 'off'); if (!on) speaking?.pause(); label(); onToggle(on) }
  label()
  btn.hidden = false // the soundscape plays even where a battle has no voice clips
  return { opening, tick, button: btn, get busy() { return busy }, get on() { return on }, onToggle(f: (v: boolean) => void) { onToggle = f } }
}
