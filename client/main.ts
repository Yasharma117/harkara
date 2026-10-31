// Cycle 0 grey-box viewer: flat shapes on a 2D canvas. three.js arrives with the art in cycle 2.
import type { Ev, WatchFile } from '../engine/sim.ts'

const COLOR: Record<string, string> = { rhino: '#34418f', kite: '#d2452b', orchid: '#8a4fb5', tiger: '#c98a1c' }
const HOUSES = ['rhino', 'kite', 'orchid', 'tiger']
const $ = (id: string) => document.getElementById(id)!
const params = new URLSearchParams(location.search)
const index: { id: string; winner: string }[] = await (await fetch('replay/index.json')).json()
const id = index.find(b => `#${b.id}` === location.hash)?.id ?? index[0].id
const get = (f: string) => fetch(`replay/${id}/${f}`).then(r => r.json())
const [manifest, init] = await Promise.all([get('manifest.json'), get('init.json')])
const TPW: number = init.ticksPerWatch, FE: number = init.frameEvery, TOTAL = manifest.watches * TPW
const nodes = new Map<string, any>(init.map.nodes.map((n: any) => [n.id, n]))
const squadInfo: any[] = init.squads
const watches: WatchFile[] = [], events: Ev[] = [], frames: WatchFile['frames'] = []
const couriers = new Map<string, Ev>(), letters = new Map<string, Ev>()
let end: any = null

// ---- controls
let t = Number(params.get('t') ?? 0), playing = true, speed = 8, beliefOf: string | null = null
for (const b of index) $('battle').append(new Option(`${b.id} (${b.winner} won)`, b.id, false, b.id === id))
$('battle').onchange = e => { location.hash = (e.target as HTMLSelectElement).value; location.reload() }
const playBtn = $('play')
const setPlaying = (p: boolean) => { playing = p; playBtn.textContent = p ? 'Pause' : 'Play' } // ponytail: link-to-moment lands in cycle 3 (timeline)
playBtn.onclick = () => setPlaying(!playing)
const group = (el: string, opts: [string, string | number | null][], pick: (v: any) => void, init: any) => {
  for (const [label, v] of opts) {
    const b = document.createElement('button')
    b.textContent = label
    b.setAttribute('aria-pressed', String(v === init))
    b.onclick = () => { $(el).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); pick(v) }
    $(el).append(b)
  }
}
let dio: Awaited<ReturnType<typeof import('./diorama.ts').createDiorama>> | null = null, view: 'map' | 'diorama' = 'map'
group('views', [['Map', 'map'], ['Diorama', 'diorama']], async v => {
  if (v === 'diorama' && !dio) dio = await (await import('./diorama.ts')).createDiorama($('stage'), init)
  view = v
  cv.style.display = v === 'map' ? '' : 'none'
  if (dio) dio.canvas.style.display = v === 'diorama' ? '' : 'none'
  if (v === 'map') resize()
}, view)
if (params.get('view') === 'diorama') ($('views').lastElementChild as HTMLButtonElement).click()
group('speeds', [['2×', 2], ['8×', 8], ['32×', 32]], v => (speed = v), speed)
group('beliefs', [['Truth', null], ...HOUSES.map(h => [h[0].toUpperCase() + h.slice(1), h] as [string, string])], v => (beliefOf = v), null)
const scrub = $('scrub') as HTMLInputElement
scrub.max = String(TOTAL - 1)
scrub.oninput = () => { t = Number(scrub.value); setPlaying(false) }
document.onkeydown = e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); setPlaying(!playing) } }
$('houses').innerHTML = init.houses.map((h: any) => `<div class="house"><span class="sw" style="background:${COLOR[h.id]}"></span><b>${h.name}</b><small>${h.id} · ${h.model}</small></div><div style="margin:0 0 6px 18px;color:#6b6459"><i>“${h.line}”</i></div>`).join('')

// ---- streaming load: playback starts after watch 1
;(async () => {
  for (let w = 1; w <= manifest.watches; w++) {
    const wf: WatchFile = await get(`watch${w}.json`)
    watches.push(wf); events.push(...wf.events); frames.push(...wf.frames)
    for (const e of wf.events) if (e.type === 'courier') { couriers.set(e.id, e); if (letters.has(e.letter)) letters.get(e.letter)!.double = true; else letters.set(e.letter, e) }
    addMarks(wf.events)
  }
  end = await get('end.json')
})()
while (!watches.length) await new Promise(r => setTimeout(r, 20))

function addMarks(evs: Ev[]) {
  const color: Record<string, string> = { caught: '#c0392b', killed: '#c0392b', truce: '#4e7a5a', rout: '#888', standard: '#000' }
  for (const e of evs) {
    const c = e.type === 'decode' ? (e.readable ? '#2e3550' : null) : color[e.type]
    if (!c) continue
    const i = document.createElement('i')
    i.style.left = `${(e.t / TOTAL) * 100}%`; i.style.background = c
    i.title = `${e.type} · watch ${Math.floor(e.t / TPW) + 1}`
    i.onclick = () => { t = Math.max(0, e.t - 30); setPlaying(false) }
    $('marks').append(i)
  }
}

// ---- canvas
const cv = $('c') as HTMLCanvasElement, ctx = cv.getContext('2d')!
let S = 1, OX = 0, OY = 0
const bg = document.createElement('canvas')
function resize() {
  const r = cv.getBoundingClientRect(), dpr = devicePixelRatio
  if (!r.width) return
  cv.width = bg.width = r.width * dpr; cv.height = bg.height = r.height * dpr
  S = (Math.min(r.width, r.height) / 1040) * dpr; OX = (cv.width - 1000 * S) / 2; OY = (cv.height - 1000 * S) / 2
  drawMap(bg.getContext('2d')!)
}
const X = (x: number) => OX + x * S, Y = (y: number) => OY + y * S

function drawMap(g: CanvasRenderingContext2D) {
  g.fillStyle = '#f2e9d8'; g.fillRect(0, 0, bg.width, bg.height)
  g.fillStyle = '#e6dcc4'; g.fillRect(X(0), Y(0), 1000 * S, 1000 * S)
  g.strokeStyle = '#c9d3cf'; g.lineWidth = 70 * S; g.beginPath(); g.moveTo(X(0), Y(500)); g.lineTo(X(1000), Y(500)); g.stroke()
  for (const n of nodes.values()) if (n.mist) {
    const r = g.createRadialGradient(X(n.x), Y(n.y), 0, X(n.x), Y(n.y), 90 * S)
    r.addColorStop(0, 'rgba(255,255,255,.85)'); r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r; g.beginPath(); g.arc(X(n.x), Y(n.y), 90 * S, 0, 7); g.fill()
  }
  for (const e of init.map.edges) {
    const a = nodes.get(e.a), b = nodes.get(e.b)
    g.setLineDash(e.kind === 'hill' ? [6 * S, 6 * S] : e.kind === 'ferry' ? [3 * S, 5 * S] : [])
    g.strokeStyle = { road: '#b5683f', hill: '#4e7a5a', ford: '#7e8c88', ferry: '#2e3550' }[e.kind as string]!
    g.lineWidth = (e.kind === 'road' ? 3 : 2) * S
    g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke()
  }
  g.setLineDash([])
  g.font = `${11 * S}px ui-sans-serif, system-ui`; g.textAlign = 'center'
  for (const n of nodes.values()) {
    const ford = init.map.fords.includes(n.id), campOf = n.id.endsWith('-camp') && n.id.slice(0, -5)
    g.fillStyle = campOf ? COLOR[campOf] : ford ? '#2e3550' : '#5a5348'
    if (campOf) g.fillRect(X(n.x) - 16 * S, Y(n.y) - 16 * S, 32 * S, 32 * S)
    else { g.beginPath(); g.arc(X(n.x), Y(n.y), (ford ? 7 : 4) * S, 0, 7); g.fill() }
    g.fillStyle = '#3a352d'; g.font = `${ford ? 'bold ' : ''}${(ford ? 12 : 10) * S}px ui-sans-serif, system-ui`
    g.fillText(ford ? `${n.name} (${n.id})` : n.name, X(n.x), Y(n.y) + (campOf ? 30 : 18) * S)
  }
}

function shape(type: string, x: number, y: number, r: number) {
  ctx.beginPath()
  if (type === 'inf') ctx.arc(x, y, r, 0, 7)
  else if (type === 'arch') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath() }
  else if (type === 'cav') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath() }
  else ctx.rect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4)
}

function frameAt(tt: number) {
  const i = Math.min(Math.floor(tt / FE), frames.length - 1), a = frames[i], b = frames[Math.min(i + 1, frames.length - 1)]
  return { a, b, k: Math.min(1, (tt - a.t) / FE) }
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

function draw() {
  ctx.drawImage(bg, 0, 0)
  const { a, b, k } = frameAt(t)
  const pos = squadInfo.map((_, i) => ({ x: lerp(a.s[i * 4], b.s[i * 4], k), y: lerp(a.s[i * 4 + 1], b.s[i * 4 + 1], k), str: a.s[i * 4 + 2], flags: a.s[i * 4 + 3] }))
  if (view === 'diorama' && dio) {
    const cbm = new Map(b.c.map(c => [c[0], c]))
    const flashes = []
    for (let i = events.length - 1; i >= 0 && events[i].t > t - 40; i--) { const e = events[i]; if (e.t <= t && ['caught', 'killed', 'lost', 'clash'].includes(e.type)) flashes.push({ type: e.type, x: e.x, y: e.y, age: (t - e.t) / 40 }) }
    dio.render({
      t,
      squads: squadInfo.map((s, i) => ({ ...s, ...pos[i] })),
      couriers: a.c.map(([cid, x0, y0]) => {
        const ev = couriers.get(cid)!, nb = cbm.get(cid), x = nb ? lerp(x0, nb[1], k) : x0, y = nb ? lerp(y0, nb[2], k) : y0
        const ps = ev.path.map((n: string) => nodes.get(n)), segD = (j: number) => { // distance from rider to segment j→j+1
          const p = ps[j], q = ps[j + 1], L = Math.hypot(q.x - p.x, q.y - p.y) || 1, u = Math.max(0, Math.min(1, ((x - p.x) * (q.x - p.x) + (y - p.y) * (q.y - p.y)) / L ** 2))
          return Math.hypot(p.x + u * (q.x - p.x) - x, p.y + u * (q.y - p.y) - y)
        }
        let j = 0
        for (let i = 1; i < ps.length - 1; i++) if (segD(i) < segD(j)) j = i
        return { id: cid, house: ev.house, kind: ev.kind, x, y, path: ps.slice(j + 1) }
      }),
      flashes,
    }, performance.now() / 1000)
    return
  }
  // courier routes + riders
  const cb = new Map(b.c.map(c => [c[0], c]))
  for (const [cid, x0, y0] of a.c) {
    const ev = couriers.get(cid)!, nb = cb.get(cid), x = nb ? lerp(x0, nb[1], k) : x0, y = nb ? lerp(y0, nb[2], k) : y0
    ctx.strokeStyle = COLOR[ev.house]; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5 * S; ctx.setLineDash(ev.kind === 'report' ? [2 * S, 4 * S] : [])
    ctx.beginPath(); ctx.moveTo(X(x), Y(y)); for (const n of ev.path.slice(1)) ctx.lineTo(X(nodes.get(n).x), Y(nodes.get(n).y)); ctx.stroke()
    ctx.setLineDash([]); ctx.globalAlpha = 1
    ctx.fillStyle = COLOR[ev.house]; ctx.strokeStyle = ev.cipher ? '#1e1c1a' : '#fff'; ctx.lineWidth = 2 * S
    ctx.beginPath(); ctx.arc(X(x), Y(y), (ev.kind === 'report' ? 3 : 4.5) * S, 0, 7); ctx.fill(); ctx.stroke()
  }
  // squads
  ctx.font = `bold ${8 * S}px ui-sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  squadInfo.forEach((s, i) => {
    const p = pos[i]
    if (p.flags & 2) return
    ctx.globalAlpha = p.flags & 1 ? 0.4 : 1
    ctx.fillStyle = COLOR[s.house]; ctx.strokeStyle = '#1e1c1a'; ctx.lineWidth = 1 * S
    shape(s.type, X(p.x), Y(p.y), (5 + p.str / 25) * S); ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.fillText({ inf: 'I', arch: 'A', cav: 'C', ele: 'E' }[s.type as string]! + (s.id.endsWith('-2') ? '2' : ''), X(p.x), Y(p.y) + 0.5)
  })
  ctx.globalAlpha = 1
  // belief ghosts: where the chosen general thinks every unit is
  if (beliefOf) {
    const w = watches.findLast(w => w.start <= t)!, bel = w.beliefs[beliefOf]
    let err = 0, n = 0
    squadInfo.forEach((s, i) => {
      const bb = bel[s.id]
      if (!bb || pos[i].flags & 2) return
      const [bx, by, age] = bb
      err += Math.hypot(bx - pos[i].x, by - pos[i].y); n++
      ctx.setLineDash([3 * S, 3 * S]); ctx.strokeStyle = COLOR[s.house]; ctx.globalAlpha = 0.6; ctx.lineWidth = 1 * S
      ctx.beginPath(); ctx.moveTo(X(bx), Y(by)); ctx.lineTo(X(pos[i].x), Y(pos[i].y)); ctx.stroke(); ctx.setLineDash([])
      ctx.globalAlpha = 0.5; ctx.lineWidth = 2 * S; shape(s.type, X(bx), Y(by), 7 * S); ctx.stroke()
      if (age >= TPW) { ctx.globalAlpha = 0.8; ctx.fillStyle = '#1e1c1a'; ctx.font = `${8 * S}px ui-sans-serif`; ctx.fillText(`${Math.round(age / TPW)}w`, X(bx), Y(by) - 12 * S) }
      ctx.globalAlpha = 1
    })
    $('belief-err').textContent = `${beliefOf} belief error: ${Math.round(err / n)} paces from the truth on average`
  } else $('belief-err').textContent = ''
  // flashes: interceptions, losses, clashes in the last ~4 game seconds
  for (let i = events.length - 1; i >= 0 && events[i].t > t - 40; i--) {
    const e = events[i]
    if (e.t > t || !['caught', 'killed', 'lost', 'clash'].includes(e.type)) continue
    const age = (t - e.t) / 40
    ctx.globalAlpha = 1 - age
    ctx.strokeStyle = e.type === 'clash' ? '#555' : e.type === 'lost' ? '#888' : '#c0392b'; ctx.lineWidth = 3 * S
    ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), (8 + age * 30) * S, 0, 7); ctx.stroke()
    if (e.type !== 'clash') { ctx.fillStyle = ctx.strokeStyle; ctx.font = `bold ${12 * S}px ui-sans-serif`; ctx.fillText(e.type === 'lost' ? 'LOST' : e.type === 'killed' ? 'SHOT' : 'CAUGHT', X(e.x), Y(e.y) - (18 + age * 30) * S) }
    ctx.globalAlpha = 1
  }
}

// ---- feed
const name = (sid: string) => { const s = squadInfo.find(x => x.id === sid); return s ? `${s.house} ${s.name}` : sid.replace('-camp', '') }
const W = (e: Ev) => `<small>w${Math.floor(e.t / TPW) + 1}</small>`
function line(e: Ev): string | null {
  const L = letters.get(e.letter)
  switch (e.type) {
    case 'thought': return `<div class="item" style="--c:${COLOR[e.house]}">${W(e)} <b>${e.house}</b> thinks: ${e.text}</div>`
    case 'courier': return e.kind === 'report' || L!.id !== e.id ? null : `<div class="item" style="--c:${COLOR[e.house]}">${W(e)} ${e.house} sends a ${e.kind === 'decoy' ? '<b>decoy</b>' : e.cipher ? 'ciphered' : 'plain'} ${e.kind} to ${name(e.to)}${e.double ? ', two riders by two roads' : ''}${e.depart > e.t ? ' (leaves next watch, enciphering)' : ''}: <span class="mono">${e.plain}</span></div>`
    case 'caught': case 'killed': return `<div class="item big" style="--c:#c0392b">${W(e)} <b>${e.type === 'caught' ? 'Intercepted' : 'Rider shot'}</b>: ${e.house}'s ${L?.kind ?? 'letter'} ${e.type === 'caught' ? 'taken' : 'destroyed'} by ${name(e.by)}${L && L.kind !== 'report' ? `<br><span class="mono">${L.cipher ?? L.plain}</span>` : ''}</div>`
    case 'lost': return L?.kind === 'report' ? null : `<div class="item" style="--c:#888">${W(e)} ${e.house} rider ${e.why}.</div>`
    case 'decode': return `<div class="item big" style="--c:${COLOR[e.house]}">${W(e)} <b>${e.house}</b> clerks ${e.readable ? '<b>can read</b>' : 'work on'} ${L?.house}'s letter:<br><span class="mono">${e.text}</span><br><small>truth: <span class="mono">${L?.plain}</span></small></div>`
    case 'intel': return e.plain ? null : `<div class="item" style="--c:${COLOR[e.house]}">${W(e)} captured ${e.from} letter reaches ${e.house} camp: <span class="mono">${e.text}</span></div>`
    case 'truce': return `<div class="item big" style="--c:#4e7a5a">${W(e)} <b>Truce</b> between ${e.a} and ${e.b} until watch ${e.until}.</div>`
    case 'smoke': return `<div class="item big" style="--c:${COLOR[e.house]}">${W(e)} ${e.house} lights smoke: <b>${e.code}</b>. Everyone sees it.</div>`
    case 'rout': return `<div class="item" style="--c:#888">${W(e)} ${name(e.squad)} routs.</div>`
    case 'destroyed': return `<div class="item" style="--c:#000">${W(e)} ${name(e.squad)} destroyed.</div>`
    case 'standard': return `<div class="item big" style="--c:#000">${W(e)} <b>${name(e.by)} takes the ${e.house} standard!</b></div>`
    case 'end': return `<div class="item big" style="--c:${COLOR[e.winner]}"><b>Battle over: ${e.reason}.</b>${end ? `<br><small>scores: ${Object.entries(end.scores).map(([h, s]) => `${h} ${s}`).join(' · ')}</small>` : ''}</div>`
  }
  return null
}
let shown = -1
function feed() {
  let n = events.findIndex(e => e.t > t); if (n < 0) n = events.length
  if (n === shown) return
  shown = n
  const out: string[] = []
  for (let i = n - 1; i >= 0 && out.length < 80; i--) { const l = line(events[i]); if (l) out.push(l) }
  $('feed').innerHTML = out.join('')
}

// ---- loop
let last = performance.now()
function loop(now: number) {
  requestAnimationFrame(loop) // first, so one bad frame can't stop playback
  const loaded = watches.length * TPW - 1
  if (playing) t = Math.min(t + ((now - last) / 1000) * 10 * speed, loaded)
  last = now
  if (playing && t >= TOTAL - 1) setPlaying(false)
  scrub.value = String(Math.floor(t))
  $('clock').textContent = `Watch ${Math.min(manifest.watches, Math.floor(t / TPW) + 1)}/${manifest.watches}`
  draw(); feed()
}
addEventListener('resize', resize)
resize()
requestAnimationFrame(loop)
