// The rules and the leaderboard as full-screen pages (after napole0n.ai): the rules are a stepped walkthrough, chapters
// on the left and a live exhibit on the right; the leaderboard ranks the generals as a staircase and holds "Your call",
// where a visitor backs today's winner. Picks share localStorage 'harkara-picks' with the in-battle picking (main.ts).
import { DECK } from '../engine/tactics.ts'

type Ctx = { COLOR: Record<string, string>; names: Record<string, string>; current: string; today: string; council: () => void; start: () => void }
const HOUSES = ['rhino', 'kite', 'orchid', 'tiger']
const still = matchMedia('(prefers-reduced-motion: reduce)').matches
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
// a card thumbnail with this battle's general's name in its top plate (names change nightly, so it's live text, not baked)
const thumb = (ctx: Ctx, h: string, name = ctx.names[h] ?? cap(h)) => `<span class="th"><img src="art/cards/${h}-thumb.webp" alt=""><b aria-hidden="true">${esc(name)}</b></span>`
// the houses' own names: the board spans many battles, and each night's AI generals name themselves differently
const HOUSE_NAME: Record<string, string> = { rhino: 'The Grey Rhino', kite: 'Kite of the Gorge', orchid: 'Lady of Orchids', tiger: 'Old Stripe' }
const wait = (ms: number) => new Promise(r => setTimeout(r, still ? 0 : ms))

function page(cls: string, ctx: Ctx, body: string) {
  const el = document.createElement('section')
  el.className = `pg ${cls}`; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true')
  el.innerHTML = `<div class="pg-top"><button class="pg-brk pg-home" data-a="close">[ Harkara ]</button><button class="pg-brk" data-a="watch">[ Watch today’s battle ]</button></div>${body}`
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); removeEventListener('keydown', key) }
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  addEventListener('keydown', key)
  el.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLElement>('[data-a]')?.dataset.a
    if (a === 'close') close()
    if (a === 'watch') { close(); ctx.start() }
    if (a === 'council') ctx.council()
  })
  document.body.append(el)
  el.querySelector<HTMLElement>('.pg-home')!.focus({ preventScroll: true })
  return { el, close }
}

// ---- typing: a line appears letter by letter (instant with reduced motion); a newer call on the same element wins
const typing = new WeakMap<Element, number>()
async function type(el: Element, text: string, cps = 75) {
  const run = (typing.get(el) ?? 0) + 1; typing.set(el, run)
  if (still) { el.textContent = text; return }
  el.textContent = ''; el.classList.add('typing')
  for (let i = 1; i <= text.length; i++) {
    if (typing.get(el) !== run) return
    el.textContent = text.slice(0, i); await wait(1000 / cps)
  }
  el.classList.remove('typing')
}

// ================= the rules =================
type Step = { say: string; show: (box: HTMLElement, ctx: Ctx) => void | Promise<void> }
const fordDots = (lit: number[] = []) => [200, 500, 800].map((x, i) => `<i class="ex-ford${lit.includes(i) ? ' lit' : ''}" style="left:${x / 10}%;--d:${i * 140}ms"><b>${['West', 'Middle', 'East'][i]}</b></i>`).join('')
const map = (lit?: number[], extra = '') => `<div class="ex-map"><img src="art/map-painted.webp" alt="">${fordDots(lit)}${extra}</div>`
const letter = (body: string, cls = '') => `<div class="ex-letter ${cls}"><small>Order · sealed</small><p class="ex-ink"></p>${body}</div>`
const thumbs = (ctx: Ctx, sub: (h: string) => string) => `<div class="ex-thumbs">${HOUSES.map((h, i) => `<figure style="--c:${ctx.COLOR[h]};--d:${i * 90}ms">${thumb(ctx, h)}<figcaption>${esc(ctx.names[h] ?? cap(h))}<small>${sub(h)}</small></figcaption></figure>`).join('')}</div>`

const CHAPTERS: { title: string; steps: Step[] }[] = [
  { title: 'The river', steps: [
    { say: 'Four AI generals. One river. Three crossings.', show: b => { b.innerHTML = map() } },
    { say: 'Hold two of the crossings when the thirtieth watch ends, and the battle is yours.', show: b => { b.innerHTML = map([0, 2], '<span class="ex-tag">Two held: victory</span>') } },
  ] },
  { title: 'Blind generals', steps: [
    { say: 'No general can see the field. It knows only what its riders report, and every report is hours late.', show: b => { b.innerHTML = map([], '<span class="ex-fog"></span><span class="ex-tag">What the general sees</span>') } },
  ] },
  { title: 'Every order rides', steps: [
    { say: 'Each order leaves camp on horseback, in a sealed letter.', show: async b => { b.innerHTML = letter(''); await type(b.querySelector('.ex-ink')!, 'FIRST FOOT, HOLD AT WEST FORD.', 28) } },
    { say: 'Riders get caught, shot, or lost in the mist.', show: async b => {
      b.innerHTML = letter('<span class="ex-stamp"></span>'); b.querySelector('.ex-ink')!.textContent = 'FIRST FOOT, HOLD AT WEST FORD.'
      const s = b.querySelector('.ex-stamp')!
      for (const w of ['Caught', 'Shot', 'Lost in the mist']) { if (!s.isConnected) return; s.textContent = w; s.classList.remove('hit'); void (s as HTMLElement).offsetWidth; s.classList.add('hit'); await wait(1300) }
    } },
    { say: 'A caught letter gets read: plain letters at once, coded ones a few letters at a time.', show: async b => {
      b.innerHTML = letter('<small class="ex-dec">Decoding…</small>', 'enemy')
      const ink = b.querySelector('.ex-ink')!, plain = 'FIRST FOOT, HOLD AT WEST FORD.', cipher = 'BEQRT BKKT, DKHS MT WART BKQS.'
      const order = [...plain].map((_, i) => i).filter(i => /[A-Z]/.test(plain[i])).sort(() => Math.random() - 0.5)
      const now = [...cipher]; ink.textContent = cipher
      for (const i of order) { if (!ink.isConnected) return; now[i] = plain[i]; ink.innerHTML = now.map((c, j) => c === plain[j] && /[A-Z]/.test(c) && cipher[j] !== c ? `<b>${c}</b>` : c).join(''); await wait(90) }
      b.querySelector('.ex-dec')!.textContent = 'Read. They know.'
    } },
  ] },
  { title: 'Fight for points', steps: [
    { say: 'If nobody holds two crossings, points decide: 100 for each crossing held alone, and 1 for every soldier still standing.', show: async (b, ctx) => {
      const pts = { rhino: 338, kite: 180, orchid: 234, tiger: 117 } as Record<string, number>
      b.innerHTML = `<div class="ex-score">${HOUSES.map(h => `<div style="--c:${ctx.COLOR[h]}"><span>${cap(h)}</span><i style="--w:${pts[h] / 3.6}%"></i><b data-n="${pts[h]}">0</b></div>`).join('')}</div>`
      await countUp(b)
    } },
  ] },
  { title: 'The generals are AIs', steps: [
    { say: 'Every night each house is commanded by a different AI model, and each one writes its own orders.', show: (b, ctx) => { b.innerHTML = thumbs(ctx, () => 'an AI general') } },
  ] },
  { title: 'Your part', steps: [
    { say: 'Call the winner before the battle. Your calls and your streak live on the leaderboard.', show: (b, ctx) => { b.innerHTML = thumbs(ctx, h => h === 'orchid' ? '<em>Your call</em>' : '&nbsp;') } },
    { say: 'In the War Council, hand one general three tactics. If your orders are drawn, they fight with them that night.', show: b => {
      const pick = ['twin', 'hunt', 'hold'].map(i => DECK.find(c => c.id === i)!)
      b.innerHTML = `<div class="ex-tacs">${pick.map((c, i) => `<div style="--d:${i * 160}ms"><i>${c.glyph}</i><b>${c.title}</b><small>${c.line}</small></div>`).join('')}</div>`
    } },
  ] },
]
const STEPS = CHAPTERS.flatMap((c, ci) => c.steps.map((s, si) => ({ ...s, ci, si })))

export function rules(ctx: Ctx) {
  const { el } = page('pg-rules', ctx, `
    <div class="rl">
      <nav class="rl-side"><h2>The rules</h2><ol>${CHAPTERS.map((c, i) => `<li><button data-ch="${i}"><span>${String(i + 1).padStart(2, '0')}</span> ${c.title}</button><p class="rl-say"></p></li>`).join('')}</ol>
        <div class="rl-nav"><small class="rl-n"></small><button data-go="-1" aria-label="Previous">←</button><button data-go="0" aria-label="Replay">↻</button><button data-go="1" class="rl-next">next →</button><small class="rl-hint">or scroll</small></div></nav>
      <div class="rl-ex" aria-live="polite"><div class="rl-box"></div></div>
    </div>`)
  let at = -1
  const box = () => el.querySelector<HTMLElement>('.rl-box')!
  const go = async (i: number) => {
    i = Math.max(0, Math.min(STEPS.length - 1, i))
    const s = STEPS[i], first = at < 0
    at = i
    el.querySelectorAll('.rl-side li').forEach((li, ci) => li.classList.toggle('on', ci === s.ci))
    el.querySelector('.rl-n')!.textContent = `${String(i + 1).padStart(2, '0')} / ${STEPS.length}`
    el.querySelector<HTMLButtonElement>('[data-go="-1"]')!.disabled = i === 0
    el.querySelector('.rl-next')!.textContent = i === STEPS.length - 1 ? 'done ✓' : 'next →'
    type(el.querySelectorAll('.rl-say')[s.ci], s.say)
    // the exhibit swaps: the old one lifts away, the new one settles in
    const old = box(); old.classList.add('leave')
    if (!first) await wait(180)
    const nb = document.createElement('div'); nb.className = 'rl-box enter'
    old.replaceWith(nb); requestAnimationFrame(() => nb.classList.remove('enter'))
    await s.show(nb, ctx)
  }
  el.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-go],[data-ch]')
    if (!b) return
    if (b.dataset.ch) return void go(STEPS.findIndex(s => s.ci === +b.dataset.ch!))
    const d = +b.dataset.go!
    if (d > 0 && at === STEPS.length - 1) return void el.querySelector<HTMLElement>('.pg-home')!.click()
    go(d ? at + d : at)
  })
  // scroll and arrow keys step through; one step per gesture
  let lock = 0
  el.addEventListener('wheel', e => { e.preventDefault(); const n = performance.now(); if (n < lock || Math.abs(e.deltaY) < 8) return; lock = n + 650; go(at + Math.sign(e.deltaY)) }, { passive: false })
  const key = (e: KeyboardEvent) => { if (!el.isConnected) return removeEventListener('keydown', key); if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(at + 1); if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(at - 1) }
  addEventListener('keydown', key)
  go(0)
}

async function countUp(root: Element) {
  const els = [...root.querySelectorAll<HTMLElement>('[data-n]')]
  const t0 = performance.now(), dur = still ? 0 : 1100
  await new Promise<void>(r => {
    const f = (now: number) => {
      const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = 1 - (1 - k) ** 3
      for (const x of els) x.textContent = Math.round(+x.dataset.n! * e).toLocaleString('en-GB')
      k < 1 && root.isConnected ? requestAnimationFrame(f) : r()
    }
    requestAnimationFrame(f)
  })
}

// ================= the leaderboard =================
type Pick = { pick: string; right?: boolean; at?: number }
const loadPicks = (): Record<string, Pick> => { try { return JSON.parse(localStorage.getItem('harkara-picks') ?? '{}') } catch { return {} } }
const savePicks = (p: Record<string, Pick>) => { try { localStorage.setItem('harkara-picks', JSON.stringify(p)) } catch {} }
const dateOf = (id: string) => id.match(/\d{4}-\d{2}-\d{2}/)?.[0]
const label = (id: string) => { const d = dateOf(id); return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + (id.startsWith('ladder') ? ' · council' : '') : `Rehearsal ${id.split('-').pop()}` }

export async function leaderboard(ctx: Ctx) {
  const { el } = page('pg-board', ctx, `<div class="lb">
    <div class="lb-head"><h2>The leaderboard</h2><p class="lb-sub">…</p></div>
    <div class="lb-podium"></div><p class="lb-note"></p>
    <div class="lb-low">
      <section class="lb-call"><h3>Your call</h3><div class="lb-call-in"></div></section>
      <section class="lb-recs"><h3>Records</h3><ol class="lb-list"></ol><button class="pg-brk" data-a="council">[ War Council ]</button></section>
    </div></div>`)
  const index: { id: string; winner: string }[] = await fetch('replay/index.json').then(r => r.json()).catch(() => [])
  const daily = index.filter(b => b.id.startsWith('daily-'))
  const pool = daily.length ? daily : index // before launch: the rehearsal and council nights
  const today = ctx.today // the same battle "Watch today’s battle" opens
  const picks = loadPicks()
  // today's battle joins the board once it's over for this visitor, so the board never spoils it
  const counted = pool.filter(b => b.id !== today || picks[today]?.at)
  const ends = await Promise.all(counted.slice(-90).map(b => fetch(`replay/${b.id}/end.json`).then(r => r.json()).catch(() => null)))
  const tally = Object.fromEntries(HOUSES.map(h => [h, { wins: 0, pts: 0 }]))
  counted.slice(-90).forEach((b, i) => { tally[b.winner] && tally[b.winner].wins++; const s = ends[i]?.scores; if (s) for (const h of HOUSES) tally[h].pts += s[h] ?? 0 })
  const rank = [...HOUSES].sort((a, b) => tally[b].wins - tally[a].wins || tally[b].pts - tally[a].pts)
  const n = counted.length
  el.querySelector('.lb-sub')!.textContent = `${daily.length ? 'Daily AI battles' : 'Rehearsal battles'} · ${n} recorded`
  // a podium: first in the middle and tallest, second left, third right, fourth beside it
  el.querySelector('.lb-podium')!.innerHTML = [1, 0, 2, 3].map(i => { const h = rank[i]; return `<figure class="p${i + 1}" style="--c:${ctx.COLOR[h]};--i:${i}">
      ${thumb(ctx, h, HOUSE_NAME[h])}
      <figcaption><b>${HOUSE_NAME[h]}</b><span class="lb-w"><em data-n="${tally[h].wins}">0</em> ${tally[h].wins === 1 ? 'win' : 'wins'}</span><small><span data-n="${tally[h].pts}">0</span> pts</small><i class="lb-rate" title="won ${tally[h].wins} of ${n}"><i style="--r:${n ? tally[h].wins / n : 0}"></i></i></figcaption>
      <span class="lb-plinth">${String(i + 1).padStart(2, '0')}</span></figure>` }).join('')
  el.querySelector('.lb-note')!.textContent = `Ranked by wins, then total battle points.${today && !picks[today]?.at ? ' Today’s battle joins the board once you’ve watched it.' : ''}`
  countUp(el.querySelector('.lb-podium')!)
  const records = () => { el.querySelector('.lb-list')!.innerHTML = index.slice().reverse().map((x, i) => `<li style="--i:${Math.min(i, 12)}"><span>${label(x.id)}</span>${x.id === today && !loadPicks()[today]?.at ? '<b class="q">?</b>' : `<b style="--c:${ctx.COLOR[x.winner]}">${HOUSE_NAME[x.winner] ?? cap(x.winner)}</b>`}<a href="#${x.id}" data-id="${x.id}">Watch →</a></li>`).join('') }
  records()

  // ---- your call: back today's winner; your record and streak
  const call = () => {
    const p = loadPicks(), mine = today ? p[today] : undefined
    const done = Object.entries(p).filter(([, x]) => x.at).sort((a, b) => b[1].at! - a[1].at!)
    let streak = 0; for (const [, x] of done) { if (!x.right) break; streak++ }
    const right = done.filter(([, x]) => x.right).length
    const head = !today ? '<p>No battle to call yet.</p>'
      : mine?.at ? `<p>${label(today)}: you backed <b style="--c:${ctx.COLOR[mine.pick]}" class="hn">${HOUSE_NAME[mine.pick]}</b>, and you were <b>${mine.right ? 'right' : 'wrong'}</b>.</p>`
      : `<p>${mine ? 'Change your call any time before you watch.' : `Who wins <b>${label(today)}</b>? Back one general, then watch.`}</p><div class="lb-pick">${HOUSES.map(h => `<button data-pick="${h}" style="--c:${ctx.COLOR[h]}" aria-pressed="${mine?.pick === h}">${thumb(ctx, h, HOUSE_NAME[h])}<span>${HOUSE_NAME[h]}</span></button>`).join('')}</div>`
    el.querySelector('.lb-call-in')!.innerHTML = `${head}<div class="lb-rec"><span><b data-n="${right}">0</b> right of <b data-n="${done.length}">0</b></span><span>Streak <b data-n="${streak}">0</b></span></div>${done.length ? `<ol class="lb-hist">${done.slice(0, 5).map(([bid, x], i) => `<li style="--i:${i}"><span>${label(bid)}</span><b style="--c:${ctx.COLOR[x.pick]}">${HOUSE_NAME[x.pick]}</b><i>${x.right ? '✓' : '✗'}</i></li>`).join('')}</ol>` : ''}`
    countUp(el.querySelector('.lb-rec')!)
  }
  call()
  el.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-pick]')
    if (b?.dataset.pick && today) { const p = loadPicks(); p[today] = { pick: b.dataset.pick }; savePicks(p); call(); el.querySelector(`[data-pick=${b.dataset.pick}]`)?.classList.add('just') }
    const a = (e.target as Element).closest<HTMLAnchorElement>('.lb-list a[data-id]')
    if (!a) return
    e.preventDefault()
    if (a.dataset.id === ctx.current) return void el.querySelector<HTMLElement>('[data-a=watch]')!.click()
    location.hash = a.dataset.id!; location.reload()
  })
}
