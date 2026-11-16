// The title screen's sky: the live battlefield lies under drifting war-clouds, and the cursor parts them. Holes heal
// slowly. With no pointer (touch, or a still mouse) a slow wind opens the clouds by itself so the scene still shows.
export function clouds(host: HTMLElement) {
  const cv = document.createElement('canvas'); cv.className = 'clouds'; host.prepend(cv)
  const g = cv.getContext('2d')!, mask = document.createElement('canvas'), mg = mask.getContext('2d')!
  const RES = 0.5 // soft shapes: half resolution is plenty
  // a seamless tile of cloud puffs: dark umber bodies, warm light on their upper-left edges
  const tile = (size: number, puffs: number, seed: number) => {
    const c = document.createElement('canvas'); c.width = c.height = size
    const t = c.getContext('2d')!
    let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    t.fillStyle = '#17110b'; t.fillRect(0, 0, size, size)
    for (let i = 0; i < puffs; i++) {
      const x = rnd() * size, y = rnd() * size, r = size * (0.06 + rnd() * 0.14)
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { // wrap: the tile repeats without seams
        const px = x + dx, py = y + dy
        if (px < -r || px > size + r || py < -r || py > size + r) continue
        const body = t.createRadialGradient(px, py, 0, px, py, r)
        body.addColorStop(0, 'rgba(46,35,24,.9)'); body.addColorStop(1, 'rgba(23,17,11,0)')
        t.fillStyle = body; t.beginPath(); t.arc(px, py, r, 0, 7); t.fill()
        const lit = t.createRadialGradient(px - r * 0.3, py - r * 0.35, 0, px - r * 0.3, py - r * 0.35, r * 0.7)
        lit.addColorStop(0, `rgba(196,158,104,${0.26 + rnd() * 0.24})`); lit.addColorStop(1, 'rgba(196,158,104,0)')
        t.fillStyle = lit; t.beginPath(); t.arc(px - r * 0.3, py - r * 0.35, r * 0.7, 0, 7); t.fill()
      }
    }
    return g.createPattern(c, 'repeat')!
  }
  const far = tile(1024, 190, 7), near = tile(640, 70, 31)
  const size = () => { const r = host.getBoundingClientRect(); cv.width = mask.width = Math.max(1, r.width * RES); cv.height = mask.height = Math.max(1, r.height * RES) }
  size(); addEventListener('resize', size)

  let last: { x: number; y: number } | null = null, movedAt = -1e9
  const brush = (x: number, y: number, r: number, a: number) => {
    const b = mg.createRadialGradient(x, y, 0, x, y, r)
    b.addColorStop(0, `rgba(0,0,0,${a})`); b.addColorStop(0.55, `rgba(0,0,0,${a * 0.7})`); b.addColorStop(1, 'rgba(0,0,0,0)')
    mg.fillStyle = b; mg.beginPath(); mg.arc(x, y, r, 0, 7); mg.fill()
  }
  host.addEventListener('pointermove', e => {
    const r = host.getBoundingClientRect(), p = { x: (e.clientX - r.left) * RES, y: (e.clientY - r.top) * RES }
    const from = last ?? p, d = Math.hypot(p.x - from.x, p.y - from.y), steps = Math.max(1, Math.ceil(d / 8))
    mg.globalCompositeOperation = 'source-over'
    for (let i = 1; i <= steps; i++) brush(from.x + ((p.x - from.x) * i) / steps, from.y + ((p.y - from.y) * i) / steps, 95 * RES * 2, 0.5)
    last = p; movedAt = performance.now()
  })
  host.addEventListener('pointerleave', () => (last = null))

  const t0 = performance.now()
  const frame = (now: number) => {
    if (!cv.isConnected) { removeEventListener('resize', size); return }
    requestAnimationFrame(frame)
    const s = (now - t0) / 1000, W = cv.width, H = cv.height
    // holes heal
    mg.globalCompositeOperation = 'destination-out'; mg.fillStyle = 'rgba(0,0,0,0.018)'; mg.fillRect(0, 0, W, H)
    // the wind: when nobody is moving the pointer, a slow wandering gap
    if (now - movedAt > 2500) { mg.globalCompositeOperation = 'source-over'; brush(W * (0.5 + 0.38 * Math.sin(s * 0.23)), H * (0.5 + 0.34 * Math.sin(s * 0.31 + 1)), 150 * RES * 2, 0.08) }
    // two layers drifting at different speeds: depth
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1
    g.setTransform(RES * 1.6, 0, 0, RES * 1.6, -s * 9, -s * 2); g.fillStyle = far; g.fillRect(s * 9 / (RES * 1.6), s * 2 / (RES * 1.6), W / (RES * 1.6) + 2, H / (RES * 1.6) + 2)
    g.globalAlpha = 0.55; g.setTransform(RES * 2.2, 0, 0, RES * 2.2, -s * 22, s * 4); g.fillStyle = near; g.fillRect(s * 22 / (RES * 2.2), -s * 4 / (RES * 2.2), W / (RES * 2.2) + 2, H / (RES * 2.2) + 2)
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1
    // the parted sky
    g.globalCompositeOperation = 'destination-out'; g.drawImage(mask, 0, 0)
  }
  requestAnimationFrame(frame)
}
