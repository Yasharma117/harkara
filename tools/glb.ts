// Pack a .gltf with external .bin and images into one .glb (fewer files, one request): node tools/glb.ts in.gltf out.glb
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const [src, out] = process.argv.slice(2)
const j = JSON.parse(readFileSync(src, 'utf8')), dir = dirname(src)
const parts: Buffer[] = []
let off = 0
const add = (b: Buffer) => { const at = off; parts.push(b); off += b.length; const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad } return at }
const base = j.buffers.map((b: any) => add(readFileSync(join(dir, b.uri))))
for (const v of j.bufferViews) v.byteOffset = (v.byteOffset ?? 0) + base[v.buffer ?? 0], v.buffer = 0
for (const img of j.images ?? []) if (img.uri) {
  const data = readFileSync(join(dir, img.uri)), at = add(data)
  img.bufferView = j.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: data.length }) - 1
  img.mimeType = img.uri.endsWith('.png') ? 'image/png' : 'image/jpeg'; delete img.uri
}
const bin = Buffer.concat(parts)
j.buffers = [{ byteLength: bin.length }]
let json = Buffer.from(JSON.stringify(j)); json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
const ch = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b }
writeFileSync(out, Buffer.concat([head, ch(json.length, 0x4e4f534a), json, ch(bin.length, 0x004e4942), bin]))
console.log(out, 12 + 8 + json.length + 8 + bin.length, 'bytes')
