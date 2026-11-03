// A procedural soundscape (Web Audio, no files): the river, a war drum each watch, steel when fights start, a horn for
// big moments. Starts on the first click (browsers block audio before that); follows the Sound on/off button.
type Ev = { seq: number; t: number; type: string; [k: string]: any }

export function soundscape() {
  let ctx: AudioContext | null = null, master: GainNode, on = true, heard = -1, lastT = 0
  const start = () => {
    if (ctx) return
    ctx = new AudioContext(); ctx.resume().catch(() => {})
    master = ctx.createGain(); master.gain.value = on ? 0.5 : 0; master.connect(ctx.destination)
    // the river: filtered noise, slowly breathing
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0)
    let b = 0; for (let i = 0; i < len; i++) { b = 0.985 * b + 0.015 * (Math.random() * 2 - 1); d[i] = b * 6 }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700
    const g = ctx.createGain(); g.gain.value = 0.16
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.05; lfo.connect(lg).connect(g.gain); lfo.start()
    src.connect(lp).connect(g).connect(master); src.start()
  }
  addEventListener('pointerdown', start, { once: true })
  addEventListener('keydown', start, { once: true })

  const env = (node: AudioNode, at: number, peak: number, decay: number) => {
    const g = ctx!.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    node.connect(g).connect(master); return g
  }
  const drum = (deep = 1) => {
    const t = ctx!.currentTime, o = ctx!.createOscillator()
    o.frequency.setValueAtTime(95 * deep, t); o.frequency.exponentialRampToValueAtTime(42 * deep, t + 0.35)
    env(o, t, 0.9, 0.7); o.start(t); o.stop(t + 0.8)
  }
  const noise = (dur: number) => {
    const n = ctx!.createBufferSource(), len = Math.ceil(ctx!.sampleRate * dur), bf = ctx!.createBuffer(1, len, ctx!.sampleRate), dd = bf.getChannelData(0)
    for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1
    n.buffer = bf; return n
  }
  const steel = () => {
    const t = ctx!.currentTime
    for (let k = 0; k < 3; k++) {
      const at = t + k * 0.09 + Math.random() * 0.04, n = noise(0.2), bp = ctx!.createBiquadFilter()
      bp.type = 'bandpass'; bp.frequency.value = 2600 + Math.random() * 1800; bp.Q.value = 9
      n.connect(bp); env(bp, at, 0.35, 0.16); n.start(at)
    }
  }
  const horn = () => {
    const t = ctx!.currentTime
    for (const [f, dt] of [[220, 0], [277, 0.03], [330, 0.06]]) {
      const o = ctx!.createOscillator(), lp = ctx!.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 900
      o.connect(lp); const g = env(lp, t + dt, 0.12, 1.6); g.gain.cancelScheduledValues(t + dt); g.gain.setValueAtTime(0, t + dt); g.gain.linearRampToValueAtTime(0.12, t + dt + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 1.6)
      o.start(t + dt); o.stop(t + dt + 1.7)
    }
  }
  const whistle = () => {
    const t = ctx!.currentTime, n = noise(0.35), bp = ctx!.createBiquadFilter()
    bp.type = 'bandpass'; bp.Q.value = 14; bp.frequency.setValueAtTime(5200, t); bp.frequency.exponentialRampToValueAtTime(1800, t + 0.32)
    n.connect(bp); env(bp, t, 0.12, 0.3); n.start(t)
  }

  let lastSteel = 0, lastWhistle = 0
  return {
    set(v: boolean) { on = v; if (ctx) master.gain.setTargetAtTime(v ? 0.5 : 0, ctx.currentTime, 0.1) },
    tick(events: Ev[], t: number, playing: boolean, TPW: number) {
      if (t < lastT - 1) heard = events.findLastIndex(e => e.t <= t) // scrubbed back
      lastT = t
      if (!ctx || !on || !playing) return
      const now = ctx.currentTime
      for (let i = heard + 1; i < events.length && events[i].t <= t; i++) {
        heard = i
        const e = events[i]
        if (t - e.t > 30) continue // jumped past it
        if (e.type === 'watch') drum(e.watch % 5 === 0 ? 0.8 : 1)
        else if (e.type === 'clash' && now - lastSteel > 0.6) { lastSteel = now; steel() }
        else if (e.type === 'killed' && now - lastWhistle > 0.4) { lastWhistle = now; whistle() }
        else if (e.type === 'truce' || e.type === 'standard' || e.type === 'end' || (e.type === 'decode' && e.readable)) horn()
      }
    },
  }
}
