// Dev tool: drive headless Chrome on the GPU and screencast a battle (or take stills). Needs the dev server (npm run dev -- --port 5199).
//   node tools/record.mjs video <url> <framesDir> <maxSeconds>   → frames + times.json + clips.json (voice clips that played)
//   node tools/record.mjs shot  <url> <outPrefix> <js-steps...>    → evaluates each step, screenshots after it (<outPrefix>-N.png)
// The Chrome profile lives in a temp folder that is removed on exit (leftover profiles once filled the disk).
import { spawn, execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [mode, url, out, ...rest] = process.argv.slice(2)
const prof = mkdtempSync(join(tmpdir(), 'harkara-chrome-'))
const PORT = 9400 + Math.floor(Math.random() * 500) // a fresh port each run: never attach to a leftover browser
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--window-size=1400,900', '--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' })
const done = async code => { const gone = new Promise(r => chrome.once('exit', r)); chrome.kill(); await gone; try { execSync(`pkill -f ${prof}`) } catch {} await new Promise(r => setTimeout(r, 500)); rmSync(prof, { recursive: true, force: true }); process.exit(code) }
let tabs
for (let i = 0; i < 20 && !tabs; i++) { await new Promise(r => setTimeout(r, 500)); tabs = await fetch(`http://127.0.0.1:${PORT}/json`).then(r => r.json()).catch(() => null) }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => (ws.onopen = r))
let n = 0, frames = 0; const wait = new Map(), times = [], clips = []
const cmd = (method, params = {}) => new Promise(r => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
ws.onmessage = m => {
  const d = JSON.parse(m.data)
  if (d.id) { wait.get(d.id)?.(d.result ?? d); wait.delete(d.id); return }
  if (d.method === 'Runtime.exceptionThrown') console.log('EXC', JSON.stringify(d.params.exceptionDetails).slice(0, 300))
  if (d.method === 'Network.requestWillBeSent' && /\.mp3$/.test(d.params.request.url)) clips.push({ url: d.params.request.url, t: d.params.wallTime })
  if (d.method === 'Page.screencastFrame') {
    writeFileSync(`${out}/f${String(frames).padStart(6, '0')}.jpg`, Buffer.from(d.params.data, 'base64'))
    times.push(d.params.metadata.timestamp); frames++
    ws.send(JSON.stringify({ id: ++n, method: 'Page.screencastFrameAck', params: { sessionId: d.params.sessionId } }))
  }
}
await cmd('Runtime.enable'); await cmd('Network.enable')
await cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
await cmd('Page.navigate', { url })
await new Promise(r => setTimeout(r, 4000))
const ev = e => cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }).then(r => r.result?.value)

if (mode === 'shot') {
  for (const [i, s] of ['0', ...rest].entries()) {
    const v = await ev(s)
    if (i && v !== undefined) console.log(`step ${i}:`, JSON.stringify(v).slice(0, 300))
    await new Promise(r => setTimeout(r, 800))
    writeFileSync(`${out}-${i}.png`, Buffer.from((await cmd('Page.captureScreenshot')).data, 'base64'))
  }
  await done(0)
}

mkdirSync(out, { recursive: true })
await cmd('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1400, maxHeight: 900, everyNthFrame: 1 })
await new Promise(r => setTimeout(r, 3500)) // the title screen, as a visitor sees it
await ev(`(document.querySelector('#title .tt-go') ?? document.getElementById('play')).click()`)
const t0 = Date.now(); let endedAt = 0, ladder = false
while (Date.now() - t0 < Number(rest[0] ?? 300) * 1000) {
  await new Promise(r => setTimeout(r, 1000))
  const over = await ev(`document.getElementById('endcard')?.hidden === false`)
  if (over && !endedAt) { endedAt = Date.now(); console.log('ended at', (endedAt - t0) / 1000, 's') }
  if (endedAt && !ladder && Date.now() - endedAt > 5000) { ladder = true; await ev(`document.getElementById('ladder-open').click()`) }
  if (endedAt && Date.now() - endedAt > 12000) break
}
await cmd('Page.stopScreencast')
writeFileSync(`${out}/times.json`, JSON.stringify(times)); writeFileSync(`${out}/clips.json`, JSON.stringify(clips))
console.log('frames', frames, 'span', ((times.at(-1) - times[0]) || 0).toFixed(1), 's, clips', clips.length)
await done(0)
