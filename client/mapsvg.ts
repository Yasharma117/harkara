// One drawing of the valley, two uses: 'mask' is the flat plan ChatGPT paints over (batch 4);
// 'paint' is the placeholder ground texture until map-painted.webp exists.
import { NODES, EDGES, FORDS } from '../engine/map.ts'

export const RIVER = 'M0 462 C 250 452, 420 474, 600 462 S 850 452, 1000 466 L1000 538 C 800 548, 620 528, 420 540 S 150 546, 0 536 Z'

export function mapSvg(style: 'mask' | 'paint', size = 1024) {
  const m = style === 'mask'
  const c = m
    ? { ground: '#ffffff', hill: '#7a7a7a', river: '#2a6fdb', sand: '#2a6fdb', road: '#8b5a2b', stone: '#ffffff', village: '#000000', camp: '#ffffff' }
    : { ground: '#a7b884', hill: '#4e7a5a', river: '#c9d3cf', sand: '#e6dcc2', road: '#b5683f', stone: '#efe9dc', village: '#8a6a4a', camp: '#c9b38a' }
  const byId = new Map(NODES.map(n => [n.id, n]))
  const hills = NODES.filter(n => n.mist).map((n, i) => `<radialGradient id="h${i}"><stop offset="0" stop-color="${c.hill}" stop-opacity="${m ? 1 : 0.85}"/><stop offset="1" stop-color="${c.hill}" stop-opacity="0"/></radialGradient><circle cx="${n.x}" cy="${n.y}" r="170" fill="url(#h${i})"/>`)
  const roads = EDGES.filter(e => e.kind === 'road' || e.kind === 'hill').map(e => {
    const a = byId.get(e.a)!, b = byId.get(e.b)!
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${c.road}" stroke-width="${e.kind === 'road' ? 8 : 5}" stroke-linecap="round"${e.kind === 'hill' && !m ? ' stroke-dasharray="14 8"' : ''}/>`
  })
  const fords = FORDS.map(f => { const n = byId.get(f)!; return [-26, -13, 0, 13, 26].map(d => `<ellipse cx="${n.x + (d % 2 ? 4 : -4)}" cy="${n.y + d}" rx="11" ry="6" fill="${c.stone}"/>`).join('') })
  const ferry = byId.get('ferry')!
  const sand = m ? '' : [[120, 488, 60, 10], [350, 512, 80, 9], [600, 486, 50, 8], [920, 510, 70, 10]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c.sand}"/>`).join('')
  const villages = NODES.filter(n => n.id.endsWith('village')).map(n => [[-20, -10], [15, -14], [0, 12], [24, 10]].map(([dx, dy]) => `<circle cx="${n.x + dx}" cy="${n.y + dy}" r="7" fill="${c.village}"/>`).join(''))
  const camps = NODES.filter(n => n.id.endsWith('-camp')).map(n => `<circle cx="${n.x}" cy="${n.y}" r="55" fill="${c.camp}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1000 1000">
<rect width="1000" height="1000" fill="${c.ground}"/>${hills.join('')}${camps.join('')}
<path d="${RIVER}" fill="${c.river}"/>${sand}
${roads.join('')}${fords.join('')}<line x1="${ferry.x}" y1="420" x2="${ferry.x}" y2="580" stroke="${c.road}" stroke-width="4" stroke-dasharray="8 6"/>${villages.join('')}</svg>`
}
