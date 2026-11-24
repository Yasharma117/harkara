// Music and sound (client/public/audio, our own Suno / ElevenLabs takes): a score that follows the scene, effects on the
// battle's events, quiet clicks on the controls. Web Audio throughout (iOS ignores <audio>.volume). Nothing loads until
// the first click or key (browsers block audio before that); follows the Sound on/off button.
type Ev = { seq: number; t: number; type: string; [k: string]: any }
export type Scene = 'title' | 'council' | 'eve' | 'battle' | 'last' | 'victory' | 'defeat'
const MUSIC: Record<Scene, string> = { title: 'title-overture', council: 'war-council', eve: 'eve-of-battle', battle: 'march-to-battle', last: 'last-stand', victory: 'victory', defeat: 'defeat' }
const ONCE = new Set<Scene>(['victory', 'defeat']) // stingers play once; the rest loop
const AMB: Partial<Record<Scene, string>> = { battle: 'battle-ambience', last: 'battle-ambience' }

export function soundscape() {
  let ctx: AudioContext | null = null, master: GainNode, musicBus: GainNode, sfxBus: GainNode, on = true
  const bufs = new Map<string, Promise<AudioBuffer | null>>()
  const load = (n: string) => {
    if (!bufs.has(n)) bufs.set(n, fetch(`audio/${n}.mp3`).then(r => r.arrayBuffer()).then(a => ctx!.decodeAudioData(a)).catch(() => null))
    return bufs.get(n)!
  }
  let scene: Scene = 'title', playing: { src: AudioBufferSourceNode; g: GainNode; scene: Scene } | null = null
  let ambience: { src: AudioBufferSourceNode; g: GainNode; n: string } | null = null, wantAmbience = ''
  const start = () => {
    if (ctx) return
    ctx = new AudioContext(); ctx.resume().catch(() => {})
    master = ctx.createGain(); master.gain.value = on ? 0.8 : 0; master.connect(ctx.destination)
    musicBus = ctx.createGain(); musicBus.gain.value = 0.42; musicBus.connect(master)
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.7; sfxBus.connect(master)
    music(scene, true); setAmbience(AMB[scene] ?? '')
  }
  addEventListener('pointerdown', start, { once: true })
  addEventListener('keydown', start, { once: true })

  // ---- music: one track at a time, crossfaded
  async function music(s: Scene, force = false) {
    if (s === scene && !force && playing?.scene === s) return
    scene = s
    if (!ctx) return
    const b = await load(MUSIC[s])
    if (!b || scene !== s) return
    const now = ctx.currentTime
    if (playing) { const p = playing; p.g.gain.cancelScheduledValues(now); p.g.gain.setTargetAtTime(0, now, 0.6); p.src.stop(now + 4) }
    const src = ctx.createBufferSource(), g = ctx.createGain()
    src.buffer = b; src.loop = !ONCE.has(s)
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + (ONCE.has(s) ? 0.2 : 2.5))
    src.connect(g).connect(musicBus); src.start(now)
    playing = { src, g, scene: s }
  }
  // ---- a bed under the music: the battlefield while a battle plays
  async function setAmbience(n: string) {
    wantAmbience = n
    if (!ctx || ambience?.n === n) return
    if (ambience) { const a = ambience; ambience = null; a.g.gain.setTargetAtTime(0, ctx.currentTime, 0.5); a.src.stop(ctx.currentTime + 3) }
    if (!n) return
    const b = await load(`sfx-${n}`)
    if (!b || wantAmbience !== n || ambience) return
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = b; src.loop = true
    g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(n === 'ember-crackle' ? 0.14 : 0.32, ctx.currentTime + 2)
    src.connect(g).connect(sfxBus); src.start(); ambience = { src, g, n }
  }
  // ---- one-shot effects; a little pitch and level variation so repeats don't sound copied
  const last = new Map<string, number>()
  async function fx(n: string, vol = 1, gap = 0) {
    if (!ctx || !on) return
    const now = performance.now()
    if (gap && now - (last.get(n) ?? -1e9) < gap) return
    last.set(n, now)
    const b = await load(`sfx-${n}`)
    if (!b) return
    const src = ctx.createBufferSource(), g = ctx.createGain()
    src.buffer = b; src.playbackRate.value = 0.94 + Math.random() * 0.12; g.gain.value = vol * (0.85 + Math.random() * 0.15)
    src.connect(g).connect(sfxBus); src.start()
  }

  // ---- the controls: a soft tick on hover (mouse only), a click on press
  let hoverEl: Element | null = null
  addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return
    const b = (e.target as Element).closest?.('button, a, [role=button], .holo')
    if (b && b !== hoverEl) fx('ui-hover', 0.25, 70)
    hoverEl = b
  }, { passive: true })
  addEventListener('click', e => {
    const el = e.target as Element
    if (el.closest?.('#opening .op-go')) { fx('ui-confirm', 0.6); fx('battle-start', 0.8) }
    else if (el.closest?.('.pg [data-a=close], [data-a=back], form.close button')) fx('ui-cancel', 0.4)
    else if (el.closest?.('[data-a=rules], [data-a=board], [data-a=start], .rl-next, [data-go]')) fx('ui-transition', 0.4, 200)
    else if (el.closest?.('#opening .holo, [data-pick], .tac')) fx('card-whoosh', 0.5, 120)
    else if (el.closest?.('#ld-form button[type=submit]')) fx('ui-confirm', 0.6)
    else if (el.closest?.('button, a, [role=button]')) fx('ui-click', 0.35, 60)
  }, true)

  let heard = -1, lastT = 0
  return {
    set(v: boolean) { on = v; if (ctx) master.gain.setTargetAtTime(v ? 0.8 : 0, ctx.currentTime, 0.1) },
    scene(s: Scene) { music(s); setAmbience(AMB[s] ?? '') },
    get current() { return scene },
    tick(events: Ev[], t: number, isPlaying: boolean) {
      if (t < lastT - 1) heard = events.findLastIndex(e => e.t <= t) // scrubbed back: don't replay a pile of sounds
      lastT = t
      if (!ctx || !on || !isPlaying) return
      for (let i = heard + 1; i < events.length && events[i].t <= t; i++) {
        heard = i
        const e = events[i]
        if (t - e.t > 30) continue // jumped past it
        const arch = /arch/.test(`${e.a ?? ''} ${e.b ?? ''}`), cav = /cav/.test(`${e.a ?? ''} ${e.b ?? ''}`), ele = /ele/.test(`${e.a ?? ''} ${e.b ?? ''}`)
        if (e.type === 'watch') fx('turn-start', 0.5)
        else if (e.type === 'courier') fx('messenger', 0.3, 1800)
        else if (e.type === 'clash') fx(arch ? 'arrow-volley' : cav ? 'cavalry-charge' : ele ? 'critical-hit' : 'melee-hit', 0.55, 700)
        else if (e.type === 'killed') fx('arrow-volley', 0.45, 500)
        else if (e.type === 'caught' || e.type === 'destroyed' || e.type === 'rout') fx('critical-hit', 0.5, 600)
        else if (e.type === 'truce' || e.type === 'smoke' || (e.type === 'decode' && e.readable)) fx('turn-start', 0.7, 400)
      }
    },
  }
}
