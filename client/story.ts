// The story layer: a premise card before the battle, and a narrator who tells the big moments as they happen, in plain
// words, over the battlefield. Every line comes from the replay's own events, so it is true of this battle.
type Ev = { seq: number; t: number; type: string; [k: string]: any }

const CAP = (h: string) => h[0].toUpperCase() + h.slice(1)
const PLACE: Record<string, string> = { F1: 'the west ford', F2: 'the middle ford', F3: 'the east ford' }
const lower = (s: string) => s.toLowerCase().replace(/\b(west|middle|east) ford\b/g, 'the $1 ford').replace(/\bthe the\b/g, 'the')
const SQUAD: Record<string, string> = { 'inf-1': 'first foot', 'inf-2': 'second foot', 'arch-1': 'bowmen', 'cav-1': 'horsemen', 'ele-1': 'elephants' }
const squadName = (id: string) => { const [h, ...r] = id.split('-'); return `${CAP(h)}'s ${SQUAD[r.join('-')] ?? r.join(' ')}` }

export function story(events: Ev[], letters: Map<string, Ev>, COLOR: Record<string, string>, stage: HTMLElement) {
  // ---- the premise, once, before the opening scene
  const intro = document.createElement('div')
  intro.id = 'premise'
  intro.innerHTML = `<div class="pm-in">
    <small>Harkara · the messenger</small>
    <h2>Four AI generals. One river. Three fords.</h2>
    <p>Each house is commanded by a different AI model. Hold two fords when the last watch ends and you win.</p>
    <p><b>No general can see the battlefield.</b> Every order rides out on horseback, and every report rides back hours late. Riders can be <b>caught</b>, <b>shot</b> or <b>lost in the mist</b>, and a captured letter can be decoded, letter by letter, until the enemy is reading your plans.</p>
    <p class="pm-hint">Watch the gap between what each general believes and what is really happening.</p>
  </div>`
  intro.hidden = true
  stage.append(intro)
  const premise = () => new Promise<void>(r => {
    intro.hidden = false
    const done = () => { intro.classList.add('out'); setTimeout(() => { intro.hidden = true; intro.classList.remove('out'); r() }, 450) }
    const tm = setTimeout(done, 9000)
    intro.onclick = () => { clearTimeout(tm); done() }
  })

  // ---- the narrator: one caption at a time, held long enough to read
  const box = document.createElement('div')
  box.id = 'narrator'
  stage.append(box)
  type Letter = { from: string; to: string; seal: 'intact' | 'broken'; head: string; cipher: string | null; plain: string; reveal: boolean }
  const lines: { t: number; seq: number; html: string; c: string; hold: number; letter?: Letter }[] = []
  const firstDecode = new Set<string>()
  const RANK: Record<string, number> = { end: 9, standard: 8, decode: 7, truce: 6, caught: 5, killed: 4, smoke: 3, clash: 3, open: 3, destroyed: 2, rout: 1 }
  const cand: { t: number; seq: number; html: string; c: string; hold: number; r: number; letter?: Letter }[] = []
  const say = (e: Ev, html: string, c: string, hold = 140, letter?: Letter) => cand.push({ t: e.t, seq: e.seq, html, c, hold, r: RANK[e.type] ?? 0, letter })
  const toName = (to: string) => to.includes('-') ? squadName(to) : `the ${CAP(to.replace('-camp', ''))} camp`
  const truces = new Set<string>()
  const PLACES: [string, number, number][] = [['the west ford', 200, 500], ['the middle ford', 500, 500], ['the east ford', 800, 500], ['the ferry', 660, 500], ['Nong village', 500, 220], ['Dhara village', 500, 780]]
  const placeAt = (x: number, y: number) => PLACES.find(([, px, py]) => Math.hypot(px - x, py - y) < 110)?.[0] ?? 'open ground'
  const met = new Set<string>()
  const first = events.find(e => e.type === 'courier' && e.kind === 'order')
  if (first) cand.push({ t: first.t, seq: first.seq, html: 'The generals send their first orders. Every rider you see leaving camp carries one, and every one can be caught.', c: '#8a6a3a', hold: 0, r: 3 })
  for (const e of events) {
    const L = e.letter ? letters.get(e.letter) : undefined
    const what = L ? (L.kind === 'report' ? 'a scouting report' : L.kind === 'letter' ? 'a letter' : L.kind === 'decoy' ? 'a decoy order' : 'an order') : 'a message'
    const text = L?.plain ? `“${lower(L.plain).replace(/[.!]+$/, '')}”` : ''
    switch (e.type) {
      case 'caught':
        if (L?.kind === 'report') break
        say(e, `<b style="color:${COLOR[e.house]}">${CAP(e.house)}'s</b> rider is <b>captured</b> by ${squadName(e.by)}. ${CAP(e.by.split('-')[0])} now holds ${what}${text ? `: ${text}` : ''}${L?.cipher ? ', but it is in cipher. Their clerks start decoding.' : ', written plain. They can read it at once.'}`, COLOR[e.by.split('-')[0]], 170,
          L ? { from: L.house, to: toName(L.to), seal: 'broken', head: `Taken by ${squadName(e.by)}`, cipher: L.cipher, plain: L.plain, reveal: !L.cipher } : undefined)
        break
      case 'killed':
        if (L?.kind === 'report') break
        say(e, `${squadName(e.by)} <b>shoot down</b> <b style="color:${COLOR[e.house]}">${CAP(e.house)}'s</b> rider. ${what[0].toUpperCase() + what.slice(1)}${text ? `, ${text},` : ''} never arrives.`, '#c0392b')
        break
      case 'decode':
        if (!e.readable || firstDecode.has(e.letter)) break
        firstDecode.add(e.letter)
        say(e, `<b style="color:${COLOR[e.house]}">${CAP(e.house)}</b> has <b>broken the cipher</b> on a captured ${L?.house ? `${CAP(L.house)} ` : ''}letter: <span class="mono">${e.text}</span> They know the plan.`, COLOR[e.house], 190,
          L ? { from: L.house, to: toName(L.to), seal: 'broken', head: `${CAP(e.house)}'s clerks break the cipher`, cipher: L.cipher, plain: e.text, reveal: true } : undefined)
        break
      case 'truce':
        if (truces.has([e.a, e.b].sort().join())) break // the same pact renewed isn't news
        truces.add([e.a, e.b].sort().join())
        say(e, `A letter reaches its camp: <b style="color:${COLOR[e.a]}">${CAP(e.a)}</b> and <b style="color:${COLOR[e.b]}">${CAP(e.b)}</b> agree a <b>truce</b> until watch ${e.until}. Neither will attack the other, for now.`, '#4e7a5a', 170, (() => {
          const tl = [...letters.values()].filter(l => l.kind === 'letter' && l.t <= e.t && [e.a, e.b].includes(l.house) && /TRUCE/.test(l.plain)).pop()
          return tl ? { from: tl.house, to: `the ${CAP(String(tl.to).replace('-camp', ''))} camp`, seal: 'intact', head: 'A truce letter arrives', cipher: null, plain: tl.plain, reveal: true } : undefined
        })())
        break
      case 'smoke':
        say(e, `<b style="color:${COLOR[e.house]}">${CAP(e.house)}</b> lights a smoke signal: <b>${e.code}</b>. Faster than any rider, but every enemy sees it too.`, COLOR[e.house])
        break
      case 'standard':
        say(e, `<b>${squadName(e.by)} storm the ${CAP(e.house)} camp and take its standard.</b>`, '#000', 220)
        break
      case 'clash': {
        const ha = e.a.split('-')[0], hb = e.b.split('-')[0], key = [ha, hb].sort().join()
        if (met.has(key)) break
        met.add(key)
        say(e, `<b style="color:${COLOR[ha]}">${CAP(ha)}</b> and <b style="color:${COLOR[hb]}">${CAP(hb)}</b> meet for the first time: ${squadName(e.a)} clash with ${squadName(e.b)} at ${placeAt(e.x, e.y)}.`, '#8a6a3a')
        break
      }
      case 'destroyed':
        say(e, `${squadName(e.squad)} are <b>destroyed</b>.`, '#555', 110)
        break
      case 'rout':
        if (/ele|cav/.test(e.squad)) say(e, `${squadName(e.squad)} <b>break and run</b> for their camp.`, '#777', 100)
        break
      case 'end': {
        say(e, `<b>The battle is over.</b> ${CAP(e.winner)} ${e.reason.split(' ').slice(1).join(' ').toLowerCase()}.`, COLOR[e.winner], 400)
        break
      }
    }
  }
  // the most important moments win: walk by rank, keep a line only if the narrator is free for its whole hold
  const busy: [number, number][] = []
  for (const l of [...cand].sort((a, b) => b.r - a.r || a.t - b.t)) {
    const span: [number, number] = [l.t - 40, l.t + 360] // ~4.5 s at 8×: one line at a time, each readable
    if (busy.some(([a, b]) => span[0] < b && a < span[1])) continue
    busy.push(span); lines.push(l)
  }
  lines.sort((a, b) => a.t - b.t)
  // ---- a letter opens on the battlefield: sender, seal, and the text, a cipher resolving into plain words
  const sheet = document.createElement('div'); sheet.id = 'letter'; stage.append(sheet)
  let sheetTimer = 0, scramble = 0
  function openLetter(l: Letter) {
    clearTimeout(sheetTimer); cancelAnimationFrame(scramble)
    const c = COLOR[l.from] ?? '#555'
    sheet.innerHTML = `<div class="lt-in" style="--c:${c}"><div class="lt-head">${l.head}</div><img class="lt-seal" src="art/seal-${l.seal}.webp" alt=""><div class="lt-from">From <b style="color:${c}">${CAP(l.from)}</b> to ${l.to}</div><p class="lt-body"></p></div>`
    sheet.classList.add('on')
    const body = sheet.querySelector('.lt-body')!, src = l.cipher ?? l.plain, dst = l.plain, t0 = performance.now()
    if (!l.cipher) { body.textContent = l.plain; sheetTimer = window.setTimeout(() => sheet.classList.remove('on'), 5200); return } // written plain: legible at once, no scramble
    // each letter settles at its own moment, so the plan surfaces word by word
    const order = [...dst].map((_, k) => 0.35 + ((k * 7919) % 97) / 97 * 1.6)
    const step = () => {
      const k = (performance.now() - t0) / 1000
      body.textContent = [...dst].map((ch, j) => !l.reveal ? (src[j] ?? ch) : k > order[j] ? ch : /[A-Z]/.test(ch) ? (k > 0.2 ? String.fromCharCode(65 + ((j * 13 + Math.floor(k * 18)) % 26)) : src[j] ?? ch) : ch).join('')
      if (k < 2.2) scramble = requestAnimationFrame(step)
    }
    step()
    sheetTimer = window.setTimeout(() => sheet.classList.remove('on'), 5200)
  }
  let shown = -1, until = 0, lastT = 0
  return {
    premise,
    tick(t: number) {
      if (t < lastT - 1) { shown = lines.findLastIndex(l => l.t <= t); box.classList.remove('on'); sheet.classList.remove('on'); until = 0 } // scrubbed back: don't replay old lines
      lastT = t
      let i = lines.findLastIndex(l => l.t <= t)
      if (i > shown && t - lines[i].t < 400) {
        shown = i; until = performance.now() + 4800 // held in real seconds, whatever the playback speed
        box.innerHTML = `<div class="nr-line" style="--c:${lines[i].c}">${lines[i].html}</div>`
        if (lines[i].letter) openLetter(lines[i].letter!)
        box.classList.add('on')
      } else if (i > shown) shown = i // stale (jumped past it): skip
      if (until && performance.now() > until) { box.classList.remove('on'); until = 0 }
    },
  }
}
