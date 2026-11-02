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
  const lines: { t: number; seq: number; html: string; c: string; hold: number }[] = []
  const firstDecode = new Set<string>()
  const RANK: Record<string, number> = { end: 9, standard: 8, decode: 7, truce: 6, caught: 5, killed: 4, smoke: 3, destroyed: 2, rout: 1 }
  const cand: { t: number; seq: number; html: string; c: string; hold: number; r: number }[] = []
  const say = (e: Ev, html: string, c: string, hold = 140) => cand.push({ t: e.t, seq: e.seq, html, c, hold, r: RANK[e.type] ?? 0 })
  const truces = new Set<string>()
  for (const e of events) {
    const L = e.letter ? letters.get(e.letter) : undefined
    const what = L ? (L.kind === 'report' ? 'a scouting report' : L.kind === 'letter' ? 'a letter' : L.kind === 'decoy' ? 'a decoy order' : 'an order') : 'a message'
    const text = L?.plain ? `“${lower(L.plain)}”` : ''
    switch (e.type) {
      case 'caught':
        if (L?.kind === 'report') break
        say(e, `<b style="color:${COLOR[e.house]}">${CAP(e.house)}'s</b> rider is <b>captured</b> by ${squadName(e.by)}. ${CAP(e.by.split('-')[0])} now holds ${what}${text ? `: ${text}` : ''}${L?.cipher ? ', but it is in cipher. Their clerks start decoding.' : ', written plain. They can read it at once.'}`, COLOR[e.by.split('-')[0]], 170)
        break
      case 'killed':
        if (L?.kind === 'report') break
        say(e, `${squadName(e.by)} <b>shoot down</b> <b style="color:${COLOR[e.house]}">${CAP(e.house)}'s</b> rider. ${what[0].toUpperCase() + what.slice(1)}${text ? `, ${text},` : ''} never arrives.`, '#c0392b')
        break
      case 'decode':
        if (!e.readable || firstDecode.has(e.letter)) break
        firstDecode.add(e.letter)
        say(e, `<b style="color:${COLOR[e.house]}">${CAP(e.house)}</b> has <b>broken the cipher</b> on a captured ${L?.house ? `${CAP(L.house)} ` : ''}letter: <span class="mono">${e.text}</span> They know the plan.`, COLOR[e.house], 190)
        break
      case 'truce':
        if (truces.has([e.a, e.b].sort().join())) break // the same pact renewed isn't news
        truces.add([e.a, e.b].sort().join())
        say(e, `A letter reaches its camp: <b style="color:${COLOR[e.a]}">${CAP(e.a)}</b> and <b style="color:${COLOR[e.b]}">${CAP(e.b)}</b> agree a <b>truce</b> until watch ${e.until}. Neither will attack the other, for now.`, '#4e7a5a', 170)
        break
      case 'smoke':
        say(e, `<b style="color:${COLOR[e.house]}">${CAP(e.house)}</b> lights a smoke signal: <b>${e.code}</b>. Faster than any rider, but every enemy sees it too.`, COLOR[e.house])
        break
      case 'standard':
        say(e, `<b>${squadName(e.by)} storm the ${CAP(e.house)} camp and take its standard.</b>`, '#000', 220)
        break
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
    const span: [number, number] = [l.t - 20, l.t + Math.max(l.hold, 120)]
    if (busy.some(([a, b]) => span[0] < b && a < span[1])) continue
    busy.push(span); lines.push(l)
  }
  lines.sort((a, b) => a.t - b.t)
  let shown = -1, until = -1
  return {
    premise,
    tick(t: number) {
      // newest line at or before t that is still within its hold; never jump back to an older one
      let pick = -1
      for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].t <= t) { if (t - lines[i].t < lines[i].hold) pick = i; break } }
      if (pick >= 0 && pick !== shown) {
        shown = pick; until = lines[pick].t + lines[pick].hold
        box.innerHTML = `<div class="nr-line" style="--c:${lines[pick].c}">${lines[pick].html}</div>`
        box.classList.add('on')
      } else if (pick < 0 && shown >= 0 && t > until) { box.classList.remove('on'); shown = -1 }
      else if (t < (lines[shown]?.t ?? 0)) { box.classList.remove('on'); shown = -1 } // scrubbed back
    },
  }
}
