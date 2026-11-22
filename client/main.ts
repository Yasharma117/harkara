// Cycle 0 grey-box viewer: flat shapes on a 2D canvas. three.js arrives with the art in cycle 2.
import type { Ev, WatchFile } from '../engine/sim.ts'
import { ladder } from './ladder.ts'
import { voice } from './voice.ts'
import { story } from './story.ts'
import { soundscape, type Scene } from './sound.ts'
import { holoCard, holoTilt } from './cards.ts'
import { holo3d, emote } from './holo3d.ts'
import { rules, leaderboard } from './sections.ts'
import { clouds } from './hero.ts'

const COLOR: Record<string, string> = { rhino: '#34418f', kite: '#b3242f', orchid: '#b13f9a', tiger: '#e3a812' }
const HOUSES = ['rhino', 'kite', 'orchid', 'tiger']
const $ = (id: string) => document.getElementById(id)!
const params = new URLSearchParams(location.search)
const index: { id: string; winner: string }[] = await (await fetch('replay/index.json')).json()
// #<battle>@<tick> is a link to one moment (artifact URLs keep only the hash)
const [hashId, hashT] = location.hash.slice(1).split('@')
const today = (index.filter(b => b.id.startsWith('daily-')).at(-1) ?? index[0]).id // the index runs oldest first: land on the newest daily battle
const id = index.find(b => b.id === hashId)?.id ?? today
const get = (f: string) => fetch(`replay/${id}/${f}`).then(r => r.json())
const [manifest, init] = await Promise.all([get('manifest.json'), get('init.json')])
const TPW: number = init.ticksPerWatch, FE: number = init.frameEvery, TOTAL = manifest.watches * TPW
// viewers read "crossing", not "ford": the engine, replays and letters keep the old word, so it is swapped where text meets the
// screen: node names here (canvas labels on both maps), and every text node the page renders (below)
const crossing = (s: string) => s.replace(/\b(FORD|Ford|ford)(S|s)?\b/g, (_, w: string, pl = '') => ({ FORD: 'CROSSING', Ford: 'Crossing', ford: 'crossing' } as Record<string, string>)[w] + pl)
for (const n of init.map.nodes) n.name = crossing(n.name)
new MutationObserver(ms => { for (const m of ms) for (const n of m.type === 'characterData' ? [m.target] : m.addedNodes) {
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t: Node | null = n.nodeType === 3 ? n : w.nextNode()
  for (; t; t = w.nextNode()) { const v = crossing(t.nodeValue ?? ''); if (v !== t.nodeValue) t.nodeValue = v }
} }).observe(document.body, { childList: true, subtree: true, characterData: true })
const nodes = new Map<string, any>(init.map.nodes.map((n: any) => [n.id, n]))
const squadInfo: any[] = init.squads
const watches: WatchFile[] = [], events: Ev[] = [], frames: WatchFile['frames'] = []
const couriers = new Map<string, Ev>(), letters = new Map<string, Ev>(), byLetter = new Map<string, Ev[]>() // fates + decodes per letter
const marks: number[] = []
const firstRead = new Map<string, number>() // house:letter → seq of the first readable decode
let end: any = null

// ---- controls
let t = Number(hashT ?? params.get('t') ?? 0), playing = !hashT, speed = 4, beliefOf: string | null = null
const battleName = (b: string) => { const g = b.match(/^grey-(\d+)$/), l = b.match(/^(daily|ladder)-\d{4}-(\d{2})-(\d{2})(?:-(\d+))?$/); return g ? `Rehearsal ${g[1]}` : l ? `${l[1] === 'ladder' ? 'Council' : 'Daily'} · ${Number(l[3])}/${Number(l[2])}${l[4] ? ` · ${l[4]}` : ''}` : b }
for (const b of index) $('battle').append(new Option(battleName(b.id), b.id, false, b.id === id)) // no winner here: it would spoil Predict
$('battle').onchange = e => { location.hash = (e.target as HTMLSelectElement).value; location.reload() }
const sfx = soundscape() // the score and the effects (starts on the first click)
const playBtn = $('play')
let busyIntro = false, autoBelief = false
let vo: Awaited<ReturnType<typeof voice>> | null = null, opened = false, tale: ReturnType<typeof story> | null = null
const setPlaying = (p: boolean) => {
  if (vo?.busy || busyIntro) return // the opening scene starts the battle when it ends
  if (p && vo && !opened && t < 30) { opened = true; playBtn.textContent = 'Pause'; (async () => { while (!tale) await new Promise(r => setTimeout(r, 50)); busyIntro = true; sfx.scene('eve'); await tale.premise(); busyIntro = false; await vo!.opening(); sfx.scene('battle'); document.body.classList.remove('intro'); dispatchEvent(new Event('resize')) /* the side panel is back: the picture re-centres in the space beside it */; setPlaying(true) })(); return } // the opening scene runs once, before the first watch
  playing = p; playBtn.textContent = p ? 'Pause' : 'Play'
}
setPlaying(playing)
playBtn.onclick = () => setPlaying(!playing)
const group = (el: string, opts: [string, string | number | null][], pick: (v: any) => void, init: any) => {
  for (const [label, v] of opts) {
    const b = document.createElement('button')
    b.textContent = label; b.dataset.v = String(v)
    b.setAttribute('aria-pressed', String(v === init))
    b.onclick = () => { $(el).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); pick(v) }
    $(el).append(b)
  }
}
let dio: Awaited<ReturnType<typeof import('./diorama.ts').createDiorama>> | null = null, view: 'map' | 'diorama' = 'diorama'
group('views', [['Map', 'map'], ['3D', 'diorama']], async v => {
  if (v === 'diorama' && !dio) dio = await (await import('./diorama.ts')).createDiorama($('stage'), init)
  view = v
  cv.style.display = v === 'map' ? '' : 'none'
  if (dio) dio.canvas.style.display = v === 'diorama' ? '' : 'none'
  if (v === 'map') resize()
}, view)
if (params.get('view') === 'map') ($('views').firstElementChild as HTMLButtonElement).click() // the 3D field is the show; ?view=map for the plain map
else { view = 'map'; ($('views').lastElementChild as HTMLButtonElement).click() }
group('speeds', [['2×', 2], ['4×', 4], ['8×', 8]], v => (speed = v), speed)
group('beliefs', [['Real', null], ...HOUSES.map(h => [h[0].toUpperCase() + h.slice(1), h] as [string, string])], v => { beliefOf = v }, null)
// "whose view": each general's button wears its colour and says what it does
$('beliefs').querySelectorAll('button').forEach((b, i) => { const h = HOUSES[i - 1]; b.title = h ? `See the field as ${h[0].toUpperCase() + h.slice(1)} believes it is. Faint ghosts mark where it thinks the armies are.` : 'See the field as it really is'; if (h) b.style.setProperty('--c', COLOR[h]) })
$('beliefs').addEventListener('click', e => { if (e.isTrusted) autoBelief = false }) // the viewer's own choice wins over the director's
const scrub = $('scrub') as HTMLInputElement
scrub.max = String(TOTAL) // the end event lands on tick TOTAL
scrub.oninput = () => { t = Number(scrub.value); setPlaying(false) }
const jump = (to: number) => { t = Math.max(0, to - 30); setPlaying(false) }
$('next').onclick = () => { const m = marks.filter(m => m - 30 > t + 1).sort((a, b) => a - b)[0]; if (m != null) jump(m) }
$('prev').onclick = () => { const m = marks.filter(m => m - 30 < t - 1).sort((a, b) => b - a)[0]; jump(m ?? 30) }
$('copy').onclick = async () => {
  const url = `${location.href.split('#')[0]}#${id}@${Math.floor(t)}`
  history.replaceState(null, '', url)
  const ok = await navigator.clipboard?.writeText(url).then(() => true, () => false)
  $('copy').textContent = ok ? 'Copied' : 'Link is in the address bar'
  setTimeout(() => ($('copy').textContent = 'Copy link to this moment'), 2000)
}
addEventListener('hashchange', () => {
  const [h, ht] = location.hash.slice(1).split('@')
  if (h !== id) location.reload(); else if (ht) { t = Number(ht); setPlaying(false) }
})
let tab = 'feed', sel: string | null = null, allFeed = false, feedTop = ''
group('tabs', [['Headlines', 'feed'], ['All dispatches', 'all'], ['Mailbag', 'mail']], v => { tab = v === 'all' ? 'feed' : v; allFeed = v === 'all'; $('feed').hidden = tab !== 'feed'; $('mail').hidden = tab !== 'mail'; shown = -1 }, tab)
document.onkeydown = e => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); setPlaying(!playing) } }
// batch-3 art when present (npm run assets); flat swatches otherwise
const art: Record<string, unknown> = await fetch('art/art.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}))
const A = (n: string) => (art[n] ? `art/${n}.webp` : '')
if (A('paper-grain')) document.body.style.backgroundImage = `linear-gradient(#f2e9d8b3, #f2e9d8b3), url(${A('paper-grain')})` // softened: the grain, not the tile
const card = (h: any, size: 'big' | 'mini') => holoCard(h, { color: COLOR[h.id], portrait: A(`portrait-${h.id}`), emblem: A(`emblem-${h.id}`), squads: init.squads, size })
const emblem = (h: string) => A(`emblem-${h}`) ? `<span class="emb" style="--c:${COLOR[h]};--m:url(${A(`emblem-${h}`)})"></span>` : `<span class="sw" style="background:${COLOR[h]}"></span>`
const lad = ladder(COLOR, Object.fromEntries(init.houses.map((h: any) => [h.id, h.name])), h => A(`portrait-${h}`) ?? '')
$('ladder-open').onclick = () => lad.open()
// the rules and leaderboard pages; "watch today's battle" from either starts it here, or loads it if this is another battle
const pages = {
  COLOR, names: Object.fromEntries(init.houses.map((h: any) => [h.id, h.name])), current: id, today, council: () => lad.open(),
  start: () => { if (id !== today) { location.hash = today; location.reload() } else document.querySelector<HTMLElement>('#title [data-a=start]')?.click() },
}
// ---- title screen: only on a fresh visit to the start of a battle (a shared moment link skips it)
if (!hashT && params.get('ladder') === null) {
  document.body.classList.add('intro') // title, premise and roll-call own the screen; the controls arrive with the battle
  const ts = document.createElement('div'); ts.id = 'title'
  ts.innerHTML = `<div class="tt-in"><h1>Harkara</h1>
    <p class="tt-def"><span lang="hi">हरकारा</span><em>noun</em> the king’s runner: the messenger who carried the court’s letters across the empire, through any danger.</p>
    <p>Four AI generals fight for three river crossings, and none of them can see the field. Every order is carried by a rider who can be caught, shot or lost, and every captured letter can be read.</p>
    <div class="tt-btns"><button data-a="rules">The rules</button><button data-a="start" class="tt-go">Watch today’s battle</button><button data-a="board">Leaderboard</button></div>
    ${init.houses.every((h: any) => h.model === 'scripted') ? '<p class="tt-note">A rehearsal battle fought by simple code generals. The daily AI battles start at launch.</p>' : ''}</div>
    <div class="shrine3" aria-hidden="true"><div class="slot"></div></div>
    <nav class="tt-corners"><button data-a="rules">[ About ]</button><button data-a="sound">[ Sound ]</button><a href="https://github.com/Yasharma117/harkara" target="_blank" rel="noopener">[ Source ]</a></nav>
`
  $('stage').append(ts); clouds(ts)
  ts.onclick = e => {
    const a = (e.target as HTMLElement).dataset.a
    if (a === 'rules') rules(pages)
    if (a === 'board') leaderboard(pages)
    if (a === 'sound') vo?.button.click()
    if (a === 'start') { ts.classList.add('out'); setTimeout(() => ts.remove(), 460); setPlaying(true) }
  }
}
vo = await voice(id, init.houses, COLOR, h => A(`portrait-${h}`), $('stage'), (h: any) => card(h, 'big'))
$('ladder-open').before(vo.button)
sfx.set(vo.on); vo.onToggle(v => sfx.set(v))
if (hashT || params.get('ladder') !== null) sfx.scene('battle') // a shared moment skips the title
// the War Council has its own theme; closing it returns to whatever was playing
{ const open = lad.open; let back: Scene = 'title'; lad.open = () => { if (sfx.current !== 'council') back = sfx.current; sfx.scene('council'); open() }; $('ladder').addEventListener('close', () => sfx.scene(back)) }
if (params.get('ladder') !== null || location.hash === '#ladder') lad.open()
// HUD: hide the panels and leave the picture (button or H)
const hud = (v = document.body.classList.contains('hud-off')) => { document.body.classList.toggle('hud-off', !v); $('hud').setAttribute('aria-pressed', String(v)); dispatchEvent(new Event('resize')) }
$('hud').onclick = () => hud()
addEventListener('keydown', e => { if ((e.key === 'h' || e.key === 'H') && !(e.target as Element).closest?.('input, textarea, select') && !e.metaKey && !e.ctrlKey) hud() })
// the watch card: a beat at each new watch while the battle plays
const watchCard = $('watchcard'); let cardWatch = 0
function watchBeat() {
  const w = Math.min(manifest.watches, Math.floor(t / TPW) + 1)
  if (w === cardWatch) return
  const show = playing && w > cardWatch && !document.body.classList.contains('intro'); cardWatch = w
  if (!show) return
  watchCard.innerHTML = `<b>WATCH ${w}</b><small>${w === manifest.watches ? 'the last watch' : w > manifest.watches - 3 ? `${manifest.watches - w + 1} watches left` : `of ${manifest.watches}`}</small>`
  watchCard.classList.remove('on'); void watchCard.offsetWidth; watchCard.classList.add('on')
}
holoTilt()
holo3d(Object.fromEntries(init.houses.map((h: any) => [h.id, h.name])), COLOR, Object.fromEntries(init.houses.map((h: any) => [h.id, h.line]))).catch(e => console.error('holo cards', e)) // the generals' cards: real 3D, reacting on cues
// the generals as four chips over the map: portrait, name, what they're doing, score, strength
$('houses').innerHTML = init.houses.map((h: any) => `<div class="house" data-h="${h.id}" tabindex="0" style="--c:${COLOR[h.id]}" title="${h.name}: ${h.model === 'scripted' ? 'rehearsal general' : h.model}"><i class="face" style="background-image:url(art/cards/${h.id}-figure.webp)"></i><b class="nm">${h.name}</b><span class="st">Waiting</span><b class="sc">0</b><i class="bar"><i></i></i></div>`).join('')
const chipEls = Object.fromEntries(HOUSES.map(h => [h, document.querySelector<HTMLElement>(`#houses [data-h="${h}"]`)!]))
const str0: Record<string, number> = {}, lastPos = new Map<number, { x: number; y: number }>()
function chips(pos: Pos[], held: { h: string | null; name: string }[], score: Record<string, number>) {
  const lead = HOUSES.reduce((a, b) => score[b] > score[a] ? b : a)
  for (const h of HOUSES) {
    const el = chipEls[h], mine = pos.map((p, i) => ({ p, i })).filter(({ i }) => squadInfo[i].house === h)
    const str = mine.reduce((a, { p }) => a + (p.flags & 2 ? 0 : p.str), 0); str0[h] = Math.max(str0[h] ?? 0, str)
    const moving = mine.some(({ p, i }) => { const q = lastPos.get(i); return q && !(p.flags & 2) && Math.hypot(p.x - q.x, p.y - q.y) > 0.4 })
    const fords = held.filter(f => f.h === h).map(f => f.name)
    const fighting = events.some(e => e.type === 'clash' && e.t <= t && e.t > t - 90 && `${e.a} ${e.b}`.includes(`${h}-`))
    const st = !str ? 'Broken' : fords.length ? `Holds ${fords.join(' & ')}` : fighting ? 'Fighting' : moving ? 'Marching' : 'Waiting'
    const set = (sel: string, v: string) => { const n = el.querySelector(sel)!; if (n.textContent !== v) n.textContent = v }
    set('.st', st); set('.sc', String(score[h]))
    el.querySelector<HTMLElement>('.bar i')!.style.width = `${str0[h] ? (100 * str) / str0[h] : 0}%`
    el.classList.toggle('lead', h === lead && score[h] > 0)
  }
  pos.forEach((p, i) => lastPos.set(i, { x: p.x, y: p.y }))
}

// ---- streaming load: playback starts after watch 1
;(async () => {
  for (let w = 1; w <= manifest.watches; w++) {
    const wf: WatchFile = await get(`watch${w}.json`)
    watches.push(wf); events.push(...wf.events); frames.push(...wf.frames)
    for (const e of wf.events) if (e.letter && e.type !== 'courier' && e.type !== 'intel') (byLetter.get(e.letter) ?? byLetter.set(e.letter, []).get(e.letter)!).push(e)
    for (const e of wf.events) if (e.type === 'decode' && e.readable && !firstRead.has(`${e.house}:${e.letter}`)) firstRead.set(`${e.house}:${e.letter}`, e.seq)
    for (const e of wf.events) if (e.type === 'courier') { couriers.set(e.id, e); if (letters.has(e.letter)) letters.get(e.letter)!.double = true; else letters.set(e.letter, e) }
    addMarks(wf.events)
  }
  end = await get('end.json')
  // smoke rises at the sender's camp and a truce letter lands at the receiver's: give those moments a place, so the camera can go there
  for (const e of events) if (e.type === 'smoke') { const n = nodes.get(`${e.house}-camp`); if (n) { e.x = n.x; e.y = n.y } } // (a truce is two letters: nothing to see at a camp, so the camera stays on the field)
  beats()
  tale = story(events, letters, COLOR, $('stage'), init.houses.every((h: any) => h.model === 'scripted'), h => {
    if (h && !beliefOf) { fordNote.innerHTML = `Now showing the field as <b style="color:${COLOR[h]}">${cap(h)}</b> believes it is. Ghosts mark where it thinks armies are.`; fordNote.classList.add('on'); clearTimeout(fordNoteT); fordNoteT = window.setTimeout(() => fordNote.classList.remove('on'), 5000); autoBelief = true; ($(`beliefs`).querySelector(`[data-v="${h}"]`) as HTMLElement | null)?.click(); setTimeout(() => { if (autoBelief) { autoBelief = false; ($(`beliefs`).firstElementChild as HTMLElement)?.click() } }, 5000) }
  }, (x, y) => { if (!(shot?.pin && t < shot.until)) shot = { x, y, from: t, until: t + 720, r: 430 } }) // the camera goes where the caption points
})()
while (!watches.length) await new Promise(r => setTimeout(r, 20))

function addMarks(evs: Ev[]) {
  const color: Record<string, string> = { caught: '#c0392b', killed: '#c0392b', truce: '#4e7a5a', rout: '#888', standard: '#000' }
  for (const e of evs) {
    const c = e.type === 'decode' ? (e.readable ? '#8fa6ff' : null) : color[e.type]
    if (!c) continue
    marks.push(e.t)
    const i = document.createElement('i')
    i.style.left = `${(e.t / TOTAL) * 100}%`; i.style.background = c
    i.title = `${e.type} · watch ${Math.floor(e.t / TPW) + 1}`
    i.onclick = () => jump(e.t)
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
  const pad = parseFloat(getComputedStyle($('stage')).getPropertyValue('--panel')) || 0 // the overlay panel covers the right edge
  S = (Math.min(r.width - pad, r.height) / 1040) * dpr; OX = ((r.width - pad) * dpr - 1000 * S) / 2; OY = (cv.height - 1000 * S) / 2
  drawMap(bg.getContext('2d')!)
}
const X = (x: number) => OX + x * S, Y = (y: number) => OY + y * S

// the painted map (batch 4) under the 2D view; the plan's lines stay faint on top so routes still read
const painted = new Image(); painted.src = 'art/map-painted.webp'
painted.onload = () => drawMap(bg.getContext('2d')!)
function drawMap(g: CanvasRenderingContext2D) {
  g.fillStyle = painted.complete && painted.naturalWidth ? '#1d1610' : '#f2e9d8'; g.fillRect(0, 0, bg.width, bg.height)
  if (painted.complete && painted.naturalWidth) {
    g.save(); g.shadowColor = '#0005'; g.shadowBlur = 24 * S; g.drawImage(painted, X(0), Y(0), 1000 * S, 1000 * S); g.restore()
    g.font = `600 ${13 * S}px 'Iowan Old Style', Palatino, Georgia, serif`; g.textAlign = 'center'; g.lineJoin = 'round'
    for (const n of nodes.values()) {
      if (!/^F\d$|^ferry$|village$|camp$|^gorge$/.test(n.id)) continue
      const yy = Y(n.y) + 26 * S
      g.lineWidth = 5 * S; g.strokeStyle = 'rgba(242,233,216,.9)'; g.strokeText(n.name, X(n.x), yy); g.fillStyle = '#2e2418'; g.fillText(n.name, X(n.x), yy)
    }
    return
  }
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
  fordStrip(pos)
  // belief ghosts: where the chosen general thinks every unit is
  const ghosts: { house: string; type: string; x: number; y: number; tx: number; ty: number; age: number }[] = []
  if (beliefOf) {
    const bel = watches.findLast(w => w.start <= t)!.beliefs[beliefOf]
    squadInfo.forEach((s, i) => { const bb = bel[s.id]; if (bb && !(pos[i].flags & 2)) ghosts.push({ house: s.house, type: s.type, x: bb[0], y: bb[1], tx: pos[i].x, ty: pos[i].y, age: bb[2] }) })
    $('belief-err').textContent = `${beliefOf[0].toUpperCase() + beliefOf.slice(1)}'s guesses are off by about ${Math.round(ghosts.reduce((a, g) => a + Math.hypot(g.x - g.tx, g.y - g.ty), 0) / ghosts.length)} paces`
  } else $('belief-err').textContent = ''
  if (view === 'diorama' && dio) {
    const cbm = new Map(b.c.map(c => [c[0], c]))
    const flashes: { type: string; x: number; y: number; age: number; house: string }[] = []
    // a stamp where a rider carrying an order or a letter was caught, shot or lost (a scouting report caught is routine): one per place
    for (let i = events.length - 1; i >= 0 && events[i].t > t - 200; i--) { const e = events[i]; if (e.t <= t && ['caught', 'killed', 'lost'].includes(e.type) && (e.type !== 'lost' || /mist/.test(e.why)) && (e.type === 'killed' || letters.get(e.letter)?.kind !== 'report') && !flashes.some(f => Math.hypot(f.x - e.x, f.y - e.y) < 90)) flashes.push({ type: e.type, x: e.x, y: e.y, age: (t - e.t) / 200, house: e.house }) }
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
        const to = squadInfo.findIndex(q => q.id === ev.to)
        return { id: cid, house: ev.house, kind: ev.kind, x, y, path: to >= 0 && !(pos[to].flags & 2) ? [...ps.slice(j + 1, -1), pos[to]] : ps.slice(j + 1) }
      }),
      flashes,
      smokes: events.filter(e => e.type === 'smoke' && e.t <= t && t - e.t < 300).map(e => ({ ...nodes.get(`${e.house}-camp`), age: (t - e.t) / 300 })),
      ghosts,
      shot: document.body.classList.contains('intro') ? hero() : aim(director(t, pos), pos),
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
  // the letter picked in the mailbag: each rider's track so far (riders chase moving squads, so the planned path can be one node)
  if (sel) for (const c of couriers.values()) if (c.letter === sel) {
    ctx.beginPath()
    let started = false
    for (const f of frames) { if (f.t > t) break; const p = f.c.find(q => q[0] === c.id); if (p) { started ? ctx.lineTo(X(p[1]), Y(p[2])) : ctx.moveTo(X(p[1]), Y(p[2])); started = true } }
    ctx.lineJoin = ctx.lineCap = 'round'
    ctx.strokeStyle = '#1e1c1a'; ctx.lineWidth = 8 * S; ctx.stroke() // ink outline so it stands off the roads
    ctx.strokeStyle = COLOR[c.house]; ctx.lineWidth = 4.5 * S; ctx.stroke()
  }
  // squads
  ctx.font = `bold ${12 * S}px ui-sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  squadInfo.forEach((s, i) => {
    const p = pos[i]
    if (p.flags & 2) return
    ctx.globalAlpha = p.flags & 1 ? 0.4 : 1
    ctx.fillStyle = COLOR[s.house]; ctx.strokeStyle = '#f2e9d8'; ctx.lineWidth = 2.5 * S // cream rim: reads on the painted ground
    ctx.shadowColor = '#0008'; ctx.shadowBlur = 4 * S; shape(s.type, X(p.x), Y(p.y), (9 + p.str / 14) * S); ctx.fill(); ctx.shadowBlur = 0; ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.fillText({ inf: 'I', arch: 'A', cav: 'C', ele: 'E' }[s.type as string]! + (s.id.endsWith('-2') ? '2' : ''), X(p.x), Y(p.y) + 0.5)
  })
  ctx.globalAlpha = 1
  for (const g of ghosts) {
    ctx.setLineDash([3 * S, 3 * S]); ctx.strokeStyle = COLOR[g.house]; ctx.globalAlpha = 0.6; ctx.lineWidth = 1 * S
    ctx.beginPath(); ctx.moveTo(X(g.x), Y(g.y)); ctx.lineTo(X(g.tx), Y(g.ty)); ctx.stroke(); ctx.setLineDash([])
    ctx.globalAlpha = 0.5; ctx.lineWidth = 2 * S; shape(g.type, X(g.x), Y(g.y), 7 * S); ctx.stroke()
    if (g.age >= TPW) { ctx.globalAlpha = 0.8; ctx.fillStyle = '#1e1c1a'; ctx.font = `${8 * S}px ui-sans-serif`; ctx.fillText(`${Math.round(g.age / TPW)}w`, X(g.x), Y(g.y) - 12 * S) }
    ctx.globalAlpha = 1
  }
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

// ---- camera director: look ahead ~9 game seconds, pick the best moment, hold it until just after it happens
const SCORE: Record<string, number> = { standard: 10, destroyed: 9, ford: 8, clash: 7, rout: 6, killed: 6, caught: 6 } // the fighting is the show now; riders next // decodes and truces happen in camp; their letter cards tell them, the camera stays on the field
let shot: { x: number; y: number; from: number; until: number; r?: number; pin?: boolean } | null = null
// how close the camera pushes in for each kind of moment: a capture or a broken cipher is personal, a clash is wide
const LENS: Record<string, number> = { destroyed: 400, rout: 430, ford: 470, standard: 380, caught: 420, killed: 430, decode: 420, truce: 480, clash: 440 } // close: the soldiers' animation is the show
// a shot needs context: two houses in frame, or one house at a named landmark (ford, ferry, camp, village)
const LANDMARK = [...nodes.values()].filter((n: any) => /^F\d|ferry|-camp|village/.test(n.id))
function context(at: { x: number; y: number }, pos: { x: number; y: number; flags: number }[]) {
  const houses = new Set(pos.flatMap((p, i) => (!(p.flags & 2) && Math.hypot(p.x - at.x, p.y - at.y) < 220 ? [squadInfo[i].house] : [])))
  return houses.size > 1 || (houses.size === 1 && LANDMARK.some((n: any) => Math.hypot(n.x - at.x, n.y - at.y) < 150))
}
// the title screen tours the four camps, each army standing by its tent, and lights that general's card
let heroAt = -1
function hero() {
  const i = Math.floor(performance.now() / 7000) % HOUSES.length, n = nodes.get(`${HOUSES[i]}-camp`)
  if (i !== heroAt) { heroAt = i; document.querySelectorAll<HTMLElement>('#title .holo').forEach(c => c.classList.toggle('lit', c.dataset.h === HOUSES[i])); emote(HOUSES[i], 'hello') }
  return { x: n.x, y: n.y + (n.y > 500 ? -40 : 40), from: 0, until: 1e9, r: 360, pin: true }
}
// never frame empty ground: a shot settles halfway onto the soldiers around its target; with nobody there and no landmark, stay wide
function aim(s: typeof shot, pos: { x: number; y: number; flags: number }[]) {
  if (!s || s.pin) return s
  const near = pos.filter(p => !(p.flags & 2) && Math.hypot(p.x - s.x, p.y - s.y) < 200)
  if (!near.length) return LANDMARK.some((n: any) => /camp/.test(n.id) && Math.hypot(n.x - s.x, n.y - s.y) < 150) ? s : null // a camp has its tent and its smoke; anywhere else with nobody is empty ground
  return { ...s, x: (s.x + near.reduce((a, p) => a + p.x, 0) / near.length) / 2, y: (s.y + near.reduce((a, p) => a + p.y, 0) / near.length) / 2 }
}
function director(tt: number, pos: { x: number; y: number; flags: number }[]) {
  // the turning point owns the camera: there before the soldiers leave, wide enough to watch them go, and nothing cuts away
  if (turning && tt > turning.t - 240 && tt < turning.t + 500) return (shot = { x: turning.x, y: turning.y, from: turning.t - 240, until: turning.t + 500, r: 620, pin: true })
  // hold every shot at least ~5 s of play, so the camera settles; only a bigger moment may cut in early
  // the battle opens wide, and the camera pulls back to the whole valley for a breath after every story
  if (tt < 2 * TPW || tt % TPW < 50 || (shot && tt >= Math.max(shot.until, shot.from + 720) && tt < Math.max(shot.until, shot.from + 720) + 260)) return null
  if (shot && tt >= shot.from && tt < Math.max(shot.until, shot.from + 720)) { // ~9 s at 8×: long enough to follow one army
    const urgent = events.find(e => e.t > tt && e.t < tt + 120 && (e.type === 'standard' || (e.type === 'ford' && (e.decisive || e.t > TOTAL - 3 * TPW)) && Math.hypot(e.x - shot!.x, e.y - shot!.y) > 60))
    if (!urgent) return shot
  }
  let best: { x: number; y: number; s: number; t: number; type: string } | null = null
  for (const e of events) {
    if (e.t <= tt) continue
    if (e.t > tt + 240) break
    let sc = SCORE[e.type]
    if (!sc || (e.type === 'decode' && !e.readable)) continue
    if (e.type === 'clash' && (e.a.includes('arch') || e.b.includes('arch'))) sc = 4 // archers skirmishing is not a battle line
    if (e.type === 'ford' && (e.decisive || e.t > TOTAL - 3 * TPW)) sc = e.decisive ? 12 : 9
    if ((e.type === 'caught' || e.type === 'killed') && letters.get(e.letter)?.kind === 'report') sc = 0
    const at = e.x != null ? e : nodes.get(`${e.type === 'truce' ? e.a : e.house}-camp`)
    if (at && (e.type === 'ford' || context(at, pos)) && (!best || sc > best.s)) best = { x: at.x, y: at.y, s: sc, t: e.t, type: e.type }
  }
  if (best) return (shot = { x: best.x, y: best.y, from: tt, until: best.t + (best.type === 'ford' ? (events.find(e => e.type === 'ford' && e.t === best!.t)?.now ? 420 : 60) : best.s >= 6 ? 110 : 40), r: LENS[best.type] }) // big moments hold a beat longer
  // nothing big coming: go back to where the latest action was (its ring may still be showing), if it was recent
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.t > tt) continue
    if (e.t < tt - 300) break
    if (SCORE[e.type] >= 3 && e.x != null && context(e as any, pos)) return (shot = { x: e.x, y: e.y, from: tt, until: tt + 150 })
  }
  // nothing big coming: hold on the place with the most soldiers (usually a ford) rather than the wide shot
  // (two houses meeting count double)
  let crowd = { x: 500, y: 500, n: 0 }
  for (const n of nodes.values()) {
    const here = pos.map((p, i) => ({ p, h: squadInfo[i].house })).filter(({ p }) => !(p.flags & 2) && Math.hypot(p.x - n.x, p.y - n.y) < 130)
    const k = here.length * (new Set(here.map(o => o.h)).size > 1 ? 2 : 1)
    if (k > crowd.n) crowd = { x: n.x, y: n.y, n: k }
  }
  return (shot = crowd.n >= 4 ? { x: crowd.x, y: crowd.y, from: tt, until: tt + 300 } : null) // n counts two houses double: only a real meeting, else the wide view
}

// ---- feed
const nice = (sid: string) => { const s = squadInfo.find(x => x.id === sid); return s ? `<b>${cap(s.house)}'s</b> ${String(s.name).toLowerCase()}` : sid }
const name = (sid: string) => { const s = squadInfo.find(x => x.id === sid); return s ? `${s.house} ${s.name}` : sid.replace('-camp', '') }
const W = (e: Ev) => `<small>w${Math.floor(e.t / TPW) + 1}</small>`
const HEADLINE = new Set(['caught', 'killed', 'decode', 'truce', 'truceend', 'ford', 'smoke', 'standard', 'destroyed', 'end'])
const hb = (h: string) => `<b style="color:${COLOR[h]}">${cap(h)}</b>`
const fordLine = (e: Ev) => e.now && e.was ? `${hb(e.now)} takes the <b>${e.name} ford</b> from ${hb(e.was)}: +100 to ${cap(e.now)}, −100 to ${cap(e.was)}.` : e.now ? `${hb(e.now)} holds the <b>${e.name} ford</b>: +100.` : `${hb(e.was)} loses the <b>${e.name} ford</b> (${e.fight ? 'an enemy matched its numbers there' : 'its soldiers marched away'}): −100.`
function line(e: Ev): string | null {
  if (!allFeed && e.type === 'decode' && e.readable && firstRead.get(`${e.house}:${e.letter}`) !== e.seq) return null // a letter is news once: when it first becomes readable
  if (!allFeed && (!HEADLINE.has(e.type) || (e.type === 'decode' && !e.readable) || ((e.type === 'caught' || e.type === 'killed') && letters.get(e.letter)?.kind === 'report'))) return null // headlines: only what changes the story
  const L = letters.get(e.letter)
  switch (e.type) {
    case 'thought': return `<div class="item" style="--c:${COLOR[e.house]}">${W(e)} <b>${e.house}</b> thinks: ${e.text.replace(/\b0 watches ago/g, 'just now').replace(/\b1 watches\b/g, '1 watch')}</div>`
    case 'courier': return e.kind === 'report' || L!.id !== e.id ? null : `<div class="item" style="--c:${COLOR[e.house]}">${W(e)} ${e.house} sends ${e.kind === 'decoy' ? 'a <b>decoy</b>' : `a ${e.cipher ? 'ciphered' : 'plain'} ${e.kind}`} to ${name(e.to)}${e.double ? ', two riders by two roads' : ''}${e.depart > e.t ? ' (leaves next watch, enciphering)' : ''}: <span class="mono">${e.plain}</span></div>`
    case 'caught': case 'killed': { const who = squadInfo.find(x => x.id === e.by), by = who ? `${cap(who.house)}'s ${String(who.name).toLowerCase()}` : name(e.by), what = L?.kind === 'letter' ? 'letter' : L?.kind === 'decoy' ? 'decoy' : 'order'
      return `<div class="item${L?.cipher ? '' : ' big'}" style="--c:#c0392b">${W(e)} ${by} ${e.type === 'caught' ? 'caught' : 'shot down'} <b>${cap(e.house)}'s</b> rider${L?.kind === 'report' ? '' : L?.cipher ? `, carrying a ciphered ${what}${e.type === 'caught' ? ' they cannot read yet' : ''}` : `, carrying a plain ${what}: <q>${String(L?.plain ?? '').toLowerCase().replace(/[.]$/, '')}</q>`}.</div>` }
    case 'lost': return L?.kind === 'report' || e.why === 'nobody left to receive it' ? null : `<div class="item" style="--c:#888">${W(e)} ${e.house} rider ${e.why}.</div>`
    case 'decode': return `<div class="item big" style="--c:${COLOR[e.house]}">${W(e)} <b>${e.house}</b> clerks ${e.readable ? '<b>can read</b>' : 'work on'} ${L?.house}'s letter:<br><span class="mono">${e.text}</span><br><small>truth: <span class="mono">${L?.plain}</span></small></div>`
    case 'intel': return e.plain ? null : `<div class="item" style="--c:${COLOR[e.house]}">${W(e)} captured ${e.from} letter reaches ${e.house} camp: <span class="mono">${e.text}</span></div>`
    case 'ford': return `<div class="item big" style="--c:${COLOR[e.house]}">${W(e)} ${e.decisive ? '<b>The turning point.</b> ' : ''}${fordLine(e)}${e.decisive ? ` ${cap(e.lead1)} takes the lead.${e.order ? ` ${cap(e.was)}'s general had ordered: <q>${e.order}</q>` : ''}` : ''}</div>`
    case 'truceend': return `<div class="item" style="--c:#4e7a5a">${W(e)} The truce between ${hb(e.a)} and ${hb(e.b)} has <b>run out</b>. They may attack each other again.</div>`
    case 'truce': return `<div class="item big" style="--c:#4e7a5a">${W(e)} <b>${cap(e.a)}</b> and <b>${cap(e.b)}</b> agree a <b>truce</b>: no attacks on each other until watch ${e.until}.</div>`
    case 'smoke': return `<div class="item big" style="--c:${COLOR[e.house]}">${W(e)} <b>${cap(e.house)}</b> lights a smoke signal at its camp: <b>${e.code}</b>. Its whole army obeys at once, but every enemy sees it too.</div>`
    case 'rout': return `<div class="item" style="--c:#888">${W(e)} ${nice(e.squad)} break and run for their camp.</div>`
    case 'destroyed': return `<div class="item" style="--c:#000">${W(e)} ${nice(e.squad)} are wiped out.</div>`
    case 'standard': return `<div class="item big" style="--c:#000">${W(e)} <b>${name(e.by)} takes the ${e.house} standard!</b></div>`
    case 'end': return `<div class="item big" style="--c:${COLOR[e.winner]}"><b>Battle over: ${cap(e.winner)} wins${/score/.test(e.reason) ? ' on points' : ''}.</b>${end ? `<br><small>${Object.entries(end.scores as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([h, s]) => `${cap(h)} ${s}`).join(' · ')}</small>` : ''}</div>`
  }
  return null
}
let shown = -1
function feed() {
  let n = events.findIndex(e => e.t > t); if (n < 0) n = events.length
  if (n === shown) return
  shown = n
  const out: string[] = []
  let prev = '', first = '', rep = 1
  const groups = new Map<string, { n: number; at: number; e: Ev; from: Set<string> }>()
  for (let i = n - 1; i >= 0 && out.length < 80; i--) {
    const e = events[i]
    // one general's orders sent in the same watch read as one dispatch, not a wall of near-identical lines
    if (allFeed && e.type === 'courier' && e.kind === 'order' && letters.get(e.letter)?.id === e.id) {
      const w = Math.floor(e.t / TPW), group: Ev[] = []
      while (i >= 0 && events[i].type === 'courier' && events[i].kind === 'order' && events[i].house === e.house && Math.floor(events[i].t / TPW) === w) { if (letters.get(events[i].letter)?.id === events[i].id) group.unshift(events[i]); i-- }
      i++
      if (group.length > 1) {
        const how = group.every(g => g.cipher) ? 'ciphered' : group.every(g => !g.cipher) ? 'plain' : 'mixed'
        out.push(`<div class="item" style="--c:${COLOR[e.house]}">${W(e)} <b>${e.house}</b> sends ${group.length} ${how} orders${group.some(g => g.double) ? ', each by two riders' : ''}:${group.map(g => `<br><span class="mono">${g.plain}</span>`).join('')}</div>`)
        prev = ''
        continue
      }
    }
    if (!allFeed && (e.type === 'caught' || e.type === 'killed') && line(e)) {
      // one captor taking one house's riders again and again reads as one headline per three watches
      const by = String(e.by).split('-')[0], key = `${by}:${Math.floor(e.t / TPW / 3)}`
      const g = groups.get(key)
      if (g) { g.n++; g.from.add(e.house); continue }
      groups.set(key, { n: 1, at: out.length, e, from: new Set([e.house]) })
      out.push('')
      continue
    }
    const l = line(e)
    if (!l) continue
    const key = l.replace(/<small>w\d+<\/small>/, '') // the same line in another watch still counts as a repeat
    if (key === prev) { rep++; out[out.length - 1] = first.replace(/<\/div>$/, ` <small>×${rep}</small></div>`); continue }
    prev = key; first = l; rep = 1; out.push(l)
  }
  for (const g of groups.values()) out[g.at] = g.n > 1 ? `<div class="item big" style="--c:#c0392b">${W(g.e)} ${hb(String(g.e.by).split('-')[0])} has caught <b>${g.n} riders</b> from ${[...g.from].map(hb).join(' and ')}. Those orders never arrived.</div>` : line(g.e)!
  if (!out.length && !allFeed) out.push('<p class="feed-empty">No big moments yet. Interceptions, broken ciphers, truces and smoke signals will appear here. <b>All dispatches</b> shows every order and every general’s thinking.</p>')
  if (tab === 'feed') { $('feed').innerHTML = out.join(''); const top = allFeed + (out[0] ?? ''); if (playing && feedTop[0] === top[0] && top !== feedTop) $('feed').firstElementChild?.classList.add('in'); feedTop = top } // only the newest line slides in, and only during play (not on scrub or tab switch)
  else mailbag()
  predict()
}

// ---- predict: pick a winner during watch 1; the streak lives in this browser only
type Pick = { pick: string; right?: boolean; at?: number }
const picks: Record<string, Pick> = JSON.parse(localStorage.getItem('harkara-picks') ?? '{}')
const savePicks = () => localStorage.setItem('harkara-picks', JSON.stringify(picks))
function predict() {
  const mine = picks[id], fin = events.find(e => e.type === 'end' && e.t <= t)
  if (mine && fin && mine.right === undefined) { mine.right = mine.pick === fin.winner; mine.at = Date.now(); savePicks() }
  const done = Object.values(picks).filter(p => p.at).sort((a, b) => b.at! - a.at!)
  let streak = 0
  for (const p of done) { if (!p.right) break; streak++ }
  const cap = (h: string) => h[0].toUpperCase() + h.slice(1)
  // backing a general is clicking their card: any card, anywhere, while picks are open
  const open = !mine && t < 10 * TPW
  document.body.classList.toggle('can-pick', open)
  document.querySelectorAll<HTMLElement>('.holo, #houses .house').forEach(c => c.classList.toggle('mine', c.dataset.h === mine?.pick))
  $('predict').innerHTML = open ? `<b>Who wins?</b> Click a general's card to back them. <small>Open until watch 10.</small>`
    : !mine ? '<small>Picks closed at watch 10.</small>'
    : mine.right === undefined ? `You backed <b>${cap(mine.pick)}</b>.`
    : `You backed <b>${cap(mine.pick)}</b>: ${mine.right ? 'right' : 'wrong'}. Streak <b>${streak}</b>`
}
if (!picks[id] && t === 0) setPlaying(false) // hold the start so there's time to pick; Play skips it
document.addEventListener('click', e => {
  const c = (e.target as Element).closest?.<HTMLElement>('.holo, #houses .house')
  if (!c?.dataset.h || !document.body.classList.contains('can-pick') || c.closest('#opening')) return // the matchup's cards are for reading, not backing
  picks[id] = { pick: c.dataset.h }; savePicks(); predict()
  if (c.closest('#title')) document.querySelector<HTMLElement>('#title [data-a=start]')?.click() // backing from the title starts the battle
  else if (t < 30) setPlaying(true)
})

// ---- mailbag: every letter sent so far, its fate as of now (no spoilers), what the captor has decoded
const FATE: Record<string, [string, string]> = { delivered: ['delivered', '#4e7a5a'], caught: ['caught', '#c0392b'], killed: ['rider shot', '#c0392b'], lost: ['lost', '#888'] }
function mailbag() {
  const out: string[] = []
  for (const L of [...letters.values()].reverse()) {
    if (L.t > t || L.kind === 'report') continue // ponytail: reports hidden; they outnumber orders 3:1
    const evs = (byLetter.get(L.letter) ?? []).filter(e => e.t <= t)
    const fates = evs.filter(e => FATE[e.type]).map(e => `<span class="fate" style="color:${FATE[e.type][1]}">${e.type === 'delivered' && e.t === L.depart ? 'handed over in camp' : FATE[e.type][0]}${e.by ? ` by ${name(e.by)}` : ''}${e.why ? `: ${e.why}` : ''}</span>`)
    const riders = L.double ? 2 : 1
    if (fates.length < riders) fates.push(`<span class="fate" style="color:var(--muted)">${L.depart > t ? 'enciphering' : 'in flight'}</span>`)
    const dec = new Map(evs.filter(e => e.type === 'decode').map(e => [e.house, e]))
    const last = [...dec.values()].pop()
    const seal = L.cipher && A('seal-intact') ? `<img class="seal" src="${A([...dec.values()].some(d => d.readable) ? 'seal-broken' : 'seal-intact')}" alt="${[...dec.values()].some(d => d.readable) ? 'cipher broken' : 'sealed'}">` : ''
    out.push(`<div class="item card" data-l="${L.letter}" aria-current="${sel === L.letter}" style="--c:${COLOR[L.house]}">${seal}${W(L)} <b>${L.house}</b> → ${name(L.to).replace(`${L.house} `, '')} · ${L.kind === 'decoy' ? 'decoy' : L.cipher ? 'ciphered' : 'plain'}${riders > 1 ? ' · two riders' : ''}<br>${fates.join(' · ')}<br><span class="mono">${L.plain}</span>${[...dec.values()].map(d => `<br><small>${d.house} reads${d.readable ? '' : ' so far'}:</small> <span class="mono">${d.text}</span>`).join('')}${last ? `<br><button class="dispatch" data-h="${last.house}">Save dispatch card</button>` : ''}</div>`)
  }
  $('mail').innerHTML = out.join('') || '<div class="item">No letters yet.</div>'
}
$('mail').onclick = e => {
  const c = (e.target as HTMLElement).closest<HTMLElement>('.card')
  if (!c) return
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.dispatch')
  if (btn) return dispatchCard(c.dataset.l!, btn.dataset.h!)
  sel = sel === c.dataset.l ? null : c.dataset.l!
  if (sel) { t = letters.get(sel)!.t; setPlaying(true) }
  dio?.follow(sel && view === 'diorama' ? letters.get(sel)!.id : null) // ride with the (first) rider
  shown = -1
}

const imgs: Record<string, HTMLImageElement> = {}
for (const [k, n] of [['paper', 'paper-letter'], ['intact', 'seal-intact'], ['broken', 'seal-broken'], ...HOUSES.map(h => [`emblem-${h}`, `emblem-${h}`])]) if (A(n)) { const i = new Image(); i.src = A(n); imgs[k] = i }
// ---- dispatch card: an intercepted letter as a share image, decoded as far as the captor has got by now
function dispatchCard(lid: string, captor: string) {
  const L = letters.get(lid)!, d = byLetter.get(lid)!.filter(e => e.type === 'decode' && e.house === captor && e.t <= t).pop()!
  const c = document.createElement('canvas'); c.width = 1200; c.height = 630
  const g = c.getContext('2d')!
  g.fillStyle = '#f2e9d8'; g.fillRect(0, 0, 1200, 630)
  if (imgs.paper) g.drawImage(imgs.paper, -50, -300, 1300, 1230) // the letter sheet, cropped to the card
  g.fillStyle = COLOR[L.house]; g.fillRect(0, 0, 1200, 14)
  const seal = d.readable ? imgs.broken : imgs.intact
  if (seal) g.drawImage(seal, 1000, 40, 150, 150 * seal.height / seal.width)
  const em = imgs[`emblem-${L.house}`]
  if (em) { // white silhouette → house colour
    const o = document.createElement('canvas'); o.width = em.width; o.height = em.height
    const og = o.getContext('2d')!; og.drawImage(em, 0, 0); og.globalCompositeOperation = 'source-in'; og.fillStyle = COLOR[L.house]; og.fillRect(0, 0, o.width, o.height)
    g.globalAlpha = 0.18; g.drawImage(o, 760, 300, 400, 400 * em.height / em.width); g.globalAlpha = 1
  }
  g.fillStyle = '#1e1c1a'; g.font = '600 28px ui-sans-serif, system-ui'
  g.fillText(`INTERCEPTED · WATCH ${Math.floor(d.t / TPW) + 1}`, 70, 90)
  g.fillStyle = '#6b6459'; g.font = '24px ui-sans-serif, system-ui'
  g.fillText(`${L.house} to ${name(L.to).replace(`${L.house} `, '')}, taken by ${captor}`, 70, 132)
  g.fillStyle = '#1e1c1a'; g.font = '44px ui-monospace, Menlo, monospace'
  const words = d.text.split(' '), lines: string[] = ['']
  for (const w of words) { const next = `${lines.at(-1)} ${w}`.trim(); if (g.measureText(next).width > 1060) lines.push(w); else lines[lines.length - 1] = next }
  lines.slice(0, 6).forEach((l, i) => g.fillText(l, 70, 240 + i * 62))
  g.fillStyle = '#6b6459'; g.font = '22px ui-sans-serif, system-ui'
  g.fillText(d.readable ? `${captor} clerks can read it.` : `${captor} clerks are still working on it.`, 70, 560)
  g.textAlign = 'right'; g.fillStyle = '#1e1c1a'; g.font = '600 24px ui-sans-serif, system-ui'; g.fillText(`HARKARA · ${id}`, 1130, 560)
  c.toBlob(b => {
    const file = new File([b!], `harkara-${id}-${lid}.png`, { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) navigator.share({ files: [file] }).catch(() => {})
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click() }
  })
}

// ---- who holds each ford right now, by the same rule that decides the battle: the house with the most soldiers at it
type Pos = { x: number; y: number; flags: number; str: number }
function fordAt(f: string, pos: Pos[]) {
  const n = nodes.get(f), by = HOUSES.map(h => [h, pos.reduce((a, p, i) => a + (squadInfo[i].house === h && !(p.flags & 3) && Math.hypot(p.x - n.x, p.y - n.y) < 50 ? p.str : 0), 0)] as [string, number]).sort((a, b) => b[1] - a[1])
  return { name: n.name.replace(' CROSSING', '').toLowerCase(), h: by[0][1] > 0 && by[0][1] > by[1][1] ? by[0][0] : null as string | null, fight: by[1][1] > 0 }
}
// the live score, counted as the end counts it: 100 per ford held, plus every surviving soldier
const scoreAt = (pos: Pos[], held: { h: string | null }[]) => Object.fromEntries(HOUSES.map(h => [h, held.filter(f => f.h === h).length * 100 + Math.round(pos.reduce((a, p, i) => a + (squadInfo[i].house === h && !(p.flags & 2) ? p.str : 0), 0))]))

// ---- story beats the simulation doesn't announce: fords changing hands (read off the frames by the rule above), truces
// running out, and the move that decided the battle. They join the event list so the feed, narrator and camera all use them.
let turning: Ev | null = null
function beats() {
  const extra: Ev[] = [], P = (f: any): Pos[] => squadInfo.map((_, i) => ({ x: f.s[i * 4], y: f.s[i * 4 + 1], str: f.s[i * 4 + 2], flags: f.s[i * 4 + 3] }))
  const lead = (f: any) => { const pos = P(f), sc = scoreAt(pos, init.map.fords.map((x: string) => fordAt(x, pos))); return HOUSES.slice().sort((a, b) => sc[b] - sc[a])[0] }
  const fords: string[] = init.map.fords, cur: (string | null)[] = fords.map(() => null), pend: (string | null)[] = fords.map(() => null), since = fords.map(() => -1)
  frames.forEach((f, k) => {
    const pos = P(f)
    fords.forEach((id, i) => {
      const now = fordAt(id, pos)
      if (now.h === cur[i]) { since[i] = -1; return }
      if (since[i] < 0 || pend[i] !== now.h) { since[i] = k; pend[i] = now.h; return }
      if (f.t - frames[since[i]].t < 150) return // a change must hold: men passing through a ford don't take it
      const n = nodes.get(id), at = frames[since[i]]
      extra.push({ type: 'ford', t: at.t, ford: id, name: now.name, was: cur[i], now: now.h, fight: now.fight, house: now.h ?? cur[i], x: n.x, y: n.y, lead0: lead(frames[Math.max(0, since[i] - 1)]), lead1: lead(f) } as any)
      cur[i] = now.h; since[i] = -1
    })
  })
  // a unit breaking or dying happens somewhere: give it its place, so the camera can be there
  for (const e of events) if ((e.type === 'destroyed' || e.type === 'rout') && e.x == null) { const i = squadInfo.findIndex(q => q.id === e.squad), f = frames[Math.max(0, Math.min(frames.length - 1, Math.floor(e.t / FE) - 1))]; if (i >= 0) { e.x = f.s[i * 4]; e.y = f.s[i * 4 + 1] } }
  const fin = events.find(e => e.type === 'end')
  // the turning point: the last ford to change hands in the closing watches that handed the lead to the winner
  if (fin) turning = extra.findLast(e => e.t >= TOTAL - 5 * TPW && e.lead1 === fin.winner && e.lead0 !== fin.winner) ?? null
  if (turning) {
    turning.decisive = true
    // why it happened: the last order the general (who cannot see the field) sent to the soldiers who were standing there
    const n = nodes.get(turning.ford), before = P(frames[Math.max(0, Math.floor(turning.t / FE) - 30)])
    const there = new Set(squadInfo.filter((q, i) => q.house === turning!.was && !(before[i].flags & 3) && Math.hypot(before[i].x - n.x, before[i].y - n.y) < 60).map(q => q.id))
    const o = events.findLast(e => e.type === 'courier' && e.kind === 'order' && e.house === turning!.was && there.has(e.to) && e.t <= turning!.t && e.t > turning!.t - 3 * TPW)
    if (o && !turning.now) turning.order = String(o.plain).toLowerCase().replace(/[.]$/, '')
  }
  const tr = events.filter(e => e.type === 'truce')
  for (const e of tr) {
    const key = [e.a, e.b].sort().join(), tEnd = e.until * TPW
    if (tEnd >= TOTAL || tr.some(o => o !== e && [o.a, o.b].sort().join() === key && o.t > e.t && o.t <= tEnd)) continue // renewed, or it outlasts the battle
    extra.push({ type: 'truceend', t: tEnd, a: e.a, b: e.b, house: e.a } as any)
  }
  events.push(...extra); events.sort((a, b) => a.t - b.t) // stable: the simulation's own order is kept
  events.forEach((e, i) => { if (e.seq == null) e.seq = (events[i - 1]?.seq ?? 0) + 0.001 })
  shown = -1
}
const strip = document.createElement('div'); strip.id = 'fords'; $('stage').append(strip)
let stripKey = '', pendKey = '', pendAt = 0, shownF = '', fordNoteT = 0
const fordNote = document.createElement('div'); fordNote.id = 'fordnote'; $('stage').append(fordNote)
function fordStrip(pos: { x: number; y: number; flags: number; str: number }[]) {
  const over = end && events.some(e => e.type === 'end' && e.t <= t)
  const held = init.map.fords.map((f: string) => {
    if (over) { const h = end.fords[f]; return { name: nodes.get(f).name.replace(' CROSSING', '').toLowerCase(), h, fight: false } }
    return fordAt(f, pos)
  })
  const two = HOUSES.find(h => held.filter((f: any) => f.h === h).length >= 2)
  const score = over ? end.scores : scoreAt(pos, held)
  const rank = HOUSES.slice().sort((a, b) => score[b] - score[a])
  chips(pos, held, score)
  const key = JSON.stringify(held) + two + (t >= TOTAL - 3 * TPW) + rank.map(h => h + Math.round(score[h] / 5)).join()
  if (key === stripKey) return
  const fkey = JSON.stringify(held) + two
  if (fkey !== pendKey) { pendKey = fkey; pendAt = performance.now() }
  if (!over && fkey !== shownF && performance.now() - pendAt < 2500) return // a ford changing hands must hold a moment before it shows: no flicker
  if (shownF && fkey !== shownF && !over) {
    const prev = JSON.parse(shownF.slice(0, shownF.lastIndexOf(']') + 1) || '[]'); const ch = held.findIndex((f: any, i: number) => prev[i] && prev[i].h !== f.h)
    if (ch >= 0) {
      // say why the score just moved: a ford is worth 100 to whoever has the most soldiers at it
      const was = prev[ch].h, now = held[ch].h, nm = `the ${held[ch].name} ford`
      fordNote.innerHTML = now ? `<b style="color:${COLOR[now]}">${cap(now)}</b> now has the most soldiers at ${nm}: <b>+100</b>${was ? ` · ${cap(was)} −100` : ''}` : `<b style="color:${COLOR[was]}">${cap(was)}</b> no longer holds ${nm} (${held[ch].fight ? 'matched by an enemy' : 'it has left'}): <b>−100</b>`
      fordNote.classList.add('on'); clearTimeout(fordNoteT); fordNoteT = window.setTimeout(() => fordNote.classList.remove('on'), 4500)
    }
  }
  shownF = fkey; stripKey = key
  strip.innerHTML = `${held.map((f: any) => `<span class="fd" style="--c:${f.h ? COLOR[f.h] : '#8a7d66'}"><i></i>${f.name} <b>${f.h ? f.h + (f.fight ? ' <em>contested</em>' : '') : f.fight ? 'tied' : 'empty'}</b></span>`).join('')}${two ? `<span class="fd-win" style="--c:${COLOR[two]}">${two} holds two</span>` : ''}<span class="fd-t fd-sc" title="100 for each ford held alone, plus every soldier still standing">Score <i class="fd-how">${!over && t >= TOTAL - 3 * TPW ? `<b style="color:#f2e9d8">If it ended now: ${two ? `${cap(two)} wins outright` : `${cap(rank[0])} wins on points`}</b>` : 'soldiers + 100 a ford'}</i></span>`
}

// ---- the ending: who won, why, and what each general's mail cost it
const cap = (h: string) => h[0].toUpperCase() + h.slice(1)
const endCard = document.createElement('div'); endCard.id = 'endcard'; endCard.hidden = true; $('stage').append(endCard)
endCard.onclick = e => { const a = (e.target as HTMLElement).dataset.a; if (!a) return; if (a === 'again') { t = 0; endShown = false; setPlaying(true) } if (a === 'next') { location.hash = index[(index.findIndex(b => b.id === id) + 1) % index.length].id; location.reload() } endCard.hidden = true }
let endShown = false
function ending() {
  const fin = events.find(e => e.type === 'end')
  if (!fin || !end) return
  if (t < fin.t) { endShown = false; endCard.hidden = true; return }
  if (endShown) return
  endShown = true
  sfx.scene(picks[id] && picks[id].pick !== fin.winner ? 'defeat' : 'victory') // you backed the loser: the lament
  const per = (h: string, type: string, key: string) => events.filter(e => e.type === type && (key === 'house' ? e.house === h : String(e.by ?? '').startsWith(h))).length
  const fordName = (f: string) => nodes.get(f).name.toLowerCase()
  const held = Object.entries(end.fords as Record<string, string | null>)
  const why = /two fords/.test(fin.reason) ? `${cap(fin.winner)} held two of the three fords at the last watch.`
    : /standard/i.test(fin.reason) ? fin.reason + '.'
    : `Nobody held two fords at the last watch, so the battle went to points: 100 for each ford held, plus every surviving soldier.`
  const rows = HOUSES.slice().sort((a, b) => end.scores[b] - end.scores[a])
  endCard.innerHTML = `<div class="ec-in"><div class="ec-card">${card(init.houses.find((h: any) => h.id === fin.winner), 'big').replace('class="holo big card3"', 'class="holo big card3 lit"')}</div><small>Watch ${manifest.watches} · the battle is over</small>
    <h2 style="color:${COLOR[fin.winner]}">${init.houses.find((h: any) => h.id === fin.winner)?.name ?? cap(fin.winner)} wins</h2>
    <p>${why}</p>${turning ? `<p class="ec-turn"><b>The turning point, watch ${Math.floor(turning.t / TPW) + 1}:</b> ${fordLine(turning)} That put ${cap(turning.lead1)} ahead of ${cap(turning.lead0)}.${turning.order ? ` ${cap(turning.was)}'s general, who could not see the field, had ordered: <q>${turning.order}</q>` : ''}</p>` : ''}
    <div class="ec-fords">${held.map(([f, h]) => `<span style="--c:${h ? COLOR[h] : '#8a7d66'}"><i></i>${fordName(f)}: <b>${h ? cap(h) : 'nobody'}</b></span>`).join('')}</div>
    <table><tr><th></th><th>Score</th><th>Riders lost</th><th>Letters taken</th><th>Ciphers broken</th></tr>
    ${rows.map(h => `<tr><td><b style="color:${COLOR[h]}">${cap(h)}</b></td><td>${end.scores[h]}</td><td>${per(h, 'caught', 'house') + per(h, 'killed', 'house')}</td><td>${per(h, 'caught', 'by')}</td><td>${new Set(events.filter(e => e.type === 'decode' && e.readable && e.house === h).map(e => e.letter)).size}</td></tr>`).join('')}</table>
    <p>${(() => { const w = fin.winner, lost = per(w, 'caught', 'house') + per(w, 'killed', 'house'), took = per(w, 'caught', 'by'), most = HOUSES.reduce((a, b) => (per(b, 'caught', 'by') > per(a, 'caught', 'by') ? b : a)); return `${cap(w)} kept ${end.scores[w] - Object.values(end.fords as Record<string, string | null>).filter(x => x === w).length * 100} soldiers' worth of strength alive${took ? ` and took ${took} enemy letters` : ''}, losing ${lost} riders of its own.${most !== w ? ` ${cap(most)} read the most enemy mail but could not turn it into ground.` : ''}` })()}</p>
    <p class="ec-btns"><button data-a="close">See the battlefield</button><button data-a="again">Watch again</button>${index.length > 1 ? '<button data-a="next">Next battle</button>' : ''}</p>
    <p class="ec-hint">Read every letter in the Mailbag, or drag the timeline back to any moment.</p></div>`
  endCard.hidden = false
  setTimeout(() => emote(fin.winner, 'win'), 500) // the winner cheers once the card has risen
}

// ---- general cards: a card pulses when its general acts (sends, catches, decodes, makes a truce)
const ACT = new Set(['caught', 'killed', 'decode', 'truce', 'smoke']) // real moments only: everyone sends orders all the time
let pulsed = -1
let pactKey = ''
function pacts() {
  const on = events.filter(e => e.type === 'truce' && e.t <= t && t < e.until * TPW), key = on.map(e => e.seq).join()
  if (key === pactKey) return
  pactKey = key
  for (const el of document.querySelectorAll<HTMLElement>('.house')) {
    const h = el.dataset.h!, mine = new Map(on.filter(e => e.a === h || e.b === h).map(e => [e.a === h ? e.b : e.a, e.until])) // a renewed pact shows once, with its latest end
    let p = el.querySelector<HTMLElement>('.pact'); if (!p) { p = document.createElement('span'); p.className = 'pact'; el.append(p) }
    p.innerHTML = [...mine].map(([o, u]) => `Truce with <b style="color:${COLOR[o]}">${cap(o)}</b> to watch ${u}`).join(' · '); p.hidden = !mine.size
  }
}
function pulseCards() {
  pacts()
  let i = events.length - 1
  while (i >= 0 && events[i].t > t) i--
  if (i < 0 || events[i].seq === pulsed) return
  const top = events[i].seq
  for (let k = i; k >= 0 && events[k].seq > pulsed; k--) {
    const e = events[k]
    if (!ACT.has(e.type) || t - e.t > 30) continue
    const who = e.type === 'caught' || e.type === 'killed' ? String(e.by ?? '').split('-')[0] : e.type === 'truce' ? e.a : e.house
    for (const h of e.type === 'truce' ? [e.a, e.b] : [who]) {
      const el = document.querySelector<HTMLElement>(`.house[data-h="${h}"]`)
      if (!el) continue
      emote(h, e.type); el.classList.remove('act'); void el.offsetWidth; el.classList.add('act', ...(e.type === 'caught' || e.type === 'decode' || e.type === 'truce' ? ['big'] : []))
      const why = { caught: 'caught a rider', killed: 'shot a rider', decode: 'broke a cipher', truce: 'signed a truce', smoke: 'lit a smoke signal' }[e.type as string]
      if (why && !(e.type === 'decode' && !e.readable)) { let w = el.querySelector<HTMLElement>('.why'); if (!w) { w = document.createElement('span'); w.className = 'why'; el.append(w) } w.textContent = why; w.classList.add('on'); clearTimeout((w as any)._t); (w as any)._t = setTimeout(() => w!.classList.remove('on'), 3500) }
      const big = el.classList.contains('big'); setTimeout(() => el.classList.remove('act', 'big'), big ? 1800 : 1400)
    }
  }
  pulsed = top
}

// ---- loop
let last = performance.now()
function loop(now: number) {
  requestAnimationFrame(loop) // first, so one bad frame can't stop playback
  const loaded = end ? TOTAL : watches.length * TPW - 1
  if (playing && t < loaded) t = Math.min(t + (Math.min(now - last, 100) / 1000) * 10 * speed, loaded) // capped: a stalled or background tab must not skip the battle // a linked moment may be ahead of the stream: wait
  last = now
  if (playing && t >= TOTAL) setPlaying(false)
  scrub.value = String(Math.floor(t))
  $('clock').textContent = `Watch ${Math.min(manifest.watches, Math.floor(t / TPW) + 1)}/${manifest.watches}`
  draw(); feed(); vo?.tick(events, t, playing, speed); tale?.tick(t); pulseCards(); ending(); watchBeat(); sfx.tick(events, t, playing)
  if (!document.body.classList.contains('intro') && !endShown) { const late = t >= TOTAL - 3 * TPW; if (late && sfx.current === 'battle') sfx.scene('last'); else if (!late && (sfx.current === 'last' || sfx.current === 'victory' || sfx.current === 'defeat')) sfx.scene('battle') }
}
addEventListener('resize', resize)
resize()
requestAnimationFrame(loop)
