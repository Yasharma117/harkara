// npm run mask → assets/map-mask.png, the plan to attach in ChatGPT for batch 4.
import sharp from 'sharp'
import { mapSvg } from '../client/mapsvg.ts'
await sharp(Buffer.from(mapSvg('mask', 1024))).png().toFile(new URL('../assets/map-mask.png', import.meta.url).pathname)
await sharp(Buffer.from(mapSvg('paint', 1024))).png().toFile(new URL('../assets/map-placeholder.png', import.meta.url).pathname)
console.log('wrote assets/map-mask.png and assets/map-placeholder.png')
