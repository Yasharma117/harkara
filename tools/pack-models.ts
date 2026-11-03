// For hosts that only serve web files (the claude.ai preview): pack client/dist/models/*.glb into one base64 JSON.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
const dir = new URL('../client/dist/models/', import.meta.url)
const out = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.glb')).map(f => [f, readFileSync(new URL(f, dir)).toString('base64')]))
writeFileSync(new URL('pack.json', dir), JSON.stringify(out))
console.log('pack.json', Object.keys(out).length, 'models')
