// Voice every general's lines for one replay with Kokoro-82M (open weights, Apache-2.0), on the CPU.
// node tools/voice.ts <battle-id> [--only-persona]   → client/public/replay/<id>/audio/*.mp3 + audio.json
// Needs ffmpeg. Clips that already exist are kept, so a rerun only voices what's new.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { KokoroTTS } from 'kokoro-js'
import { env } from '@huggingface/transformers'

const id = process.argv[2]
if (!id) { console.error('usage: node tools/voice.ts <battle-id> [--only-persona]'); process.exit(1) }
const dir = join(import.meta.dirname, '../client/public/replay', id), out = join(dir, 'audio')
if (process.env.HF_CACHE) env.cacheDir = process.env.HF_CACHE
mkdirSync(out, { recursive: true })

// one voice per house, picked to sound unlike each other
const VOICE: Record<string, string> = { rhino: 'bm_george', kite: 'am_adam', orchid: 'bf_emma', tiger: 'bm_fable' }
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const lines: { key: string; house: string; text: string }[] = manifest.houses.filter((h: any) => h.line).map((h: any) => ({ key: `p-${h.id}`, house: h.id, text: `${h.name}. ${h.line}` }))
if (!process.argv.includes('--only-persona'))
  for (const f of readdirSync(dir).filter(f => /^watch\d+\.json$/.test(f)))
    for (const e of JSON.parse(readFileSync(join(dir, f), 'utf8')).events) if (e.type === 'thought' && e.text) lines.push({ key: String(e.seq), house: e.house, text: e.text })

// orders are written in capitals (EAST FORD, BOWMEN); read them as words, not letters
const speakable = (s: string) => s.replace(/\b0 watches ago/g, 'just now').replace(/\b1 watches\b/g, '1 watch').replace(/\b[A-Z]{2,}\b/g, w => w.toLowerCase()).replace(/\bF([123])\b/g, (_, n) => ['', 'west ford', 'middle ford', 'east ford'][n]).replace(/_+/g, ' ')

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' })
const index: Record<string, string> = {}
const tmp = join(tmpdir(), `voice-${process.pid}.wav`)
let made = 0
for (const l of lines) {
  const file = `${l.key}.mp3`
  index[l.key] = file
  if (existsSync(join(out, file))) continue
  const audio = await tts.generate(speakable(l.text), { voice: VOICE[l.house] as any })
  await audio.save(tmp)
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-ac', '1', '-b:a', '40k', join(out, file)])
  made++
  if (made % 10 === 0) console.log(`${id}: ${made} clips`)
}
rmSync(tmp, { force: true })
writeFileSync(join(dir, 'audio.json'), JSON.stringify(index))
console.log(`${id}: ${lines.length} lines, ${made} new clips`)
