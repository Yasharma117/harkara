// The title screen's sky: the live battlefield lies under war-clouds, and the cursor parts them. A WebGL shader paints
// two drifting layers of domain-warped noise, lit from the upper left; where the cursor tears a hole the edge goes
// wispy, the torn rim catches gilt sunlight, and the cloud still casts a shadow onto the field just inside the gap.
// The holes live in a small 2D mask (brushed by the pointer, healing slowly); with no pointer, a slow wind opens them.
const VS = `#version 300 es
in vec2 a; out vec2 v; void main() { v = a * .5 + .5; gl_Position = vec4(a, 0, 1); }`
const FS = `#version 300 es
precision highp float;
uniform sampler2D uMask; uniform vec2 uRes; uniform float uT;
in vec2 v; out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0., a = .5; mat2 r = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++) { s += a * noise(p); p = r * p; a *= .5; } return s; }
float cloud(vec2 p, float t) { vec2 q = vec2(fbm(p + vec2(0., t * .04)), fbm(p + vec2(5.2, 1.3) - t * .03)); return fbm(p + 1.7 * q); } // warped: billows, not blobs
void main() {
  vec2 p = v * vec2(uRes.x / uRes.y, 1.) * 2.4;
  float t = uT;
  float far = cloud(p + vec2(t * .018, t * .004), t), near = cloud(p * 1.6 + vec2(7. + t * .05, -t * .008), t * 1.3);
  float dens = far * .72 + near * .38;
  float m = texture(uMask, vec2(v.x, 1. - v.y)).r;
  // the tear: the mask eats density, and the near layer frays its edge so holes look ripped from cloud, not cut by a circle
  float hole = m * (1.25 + (near - .5) * .9);
  float cover = smoothstep(.34, .66, dens + .3 - hole);
  // relief from the density slope, sun from the upper left
  vec3 n = normalize(vec3(-dFdx(dens) * 90., dFdy(dens) * 90., 1.));
  float lit = clamp(dot(n, normalize(vec3(-.55, .6, .58))), 0., 1.);
  vec3 col = mix(vec3(.055, .04, .028), vec3(.2, .15, .1), smoothstep(.3, .85, dens));
  col += vec3(.85, .64, .4) * pow(lit, 3.) * .5 * smoothstep(.3, .8, dens);
  // gilt rim where the cloud thins into a hole
  float rim = smoothstep(.05, .45, cover) * smoothstep(.95, .5, cover) * smoothstep(.04, .3, m);
  col += vec3(1., .76, .42) * rim * .85;
  // the cloud's shadow on the field: what still covers the sky a little up and to the left darkens the ground in the gap
  float ms = texture(uMask, vec2(v.x - .014, 1. - v.y - .022)).r;
  float shade = (1. - cover) * (1. - smoothstep(.15, .85, ms)) * .5;
  o = vec4(col * cover, cover + shade); // premultiplied: the shadow is black
}`

export function clouds(host: HTMLElement) {
  const cv = document.createElement('canvas'); cv.className = 'clouds'; host.prepend(cv)
  const gl = cv.getContext('webgl2', { premultipliedAlpha: true, antialias: false })
  if (!gl) return // no clouds: the field simply shows
  const mask = document.createElement('canvas'), mg = mask.getContext('2d')!
  const RES = 0.5, MRES = 0.25 // soft shapes: the sky at half resolution, the hole mask at a quarter

  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s }
  const prog = gl.createProgram()!; gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const uRes = gl.getUniformLocation(prog, 'uRes'), uT = gl.getUniformLocation(prog, 'uT')

  const size = () => {
    const r = host.getBoundingClientRect()
    cv.width = Math.max(1, r.width * RES); cv.height = Math.max(1, r.height * RES)
    mask.width = Math.max(1, r.width * MRES); mask.height = Math.max(1, r.height * MRES)
    gl.viewport(0, 0, cv.width, cv.height)
  }
  size(); addEventListener('resize', size)

  let last: { x: number; y: number } | null = null, movedAt = -1e9
  const brush = (x: number, y: number, r: number, a: number) => {
    const b = mg.createRadialGradient(x, y, 0, x, y, r)
    b.addColorStop(0, `rgba(255,255,255,${a})`); b.addColorStop(0.55, `rgba(255,255,255,${a * 0.6})`); b.addColorStop(1, 'rgba(255,255,255,0)')
    mg.fillStyle = b; mg.beginPath(); mg.arc(x, y, r, 0, 7); mg.fill()
  }
  host.addEventListener('pointermove', e => {
    const r = host.getBoundingClientRect(), p = { x: (e.clientX - r.left) * MRES, y: (e.clientY - r.top) * MRES }
    const from = last ?? p, d = Math.hypot(p.x - from.x, p.y - from.y), steps = Math.max(1, Math.ceil(d / 4))
    // a fast sweep tears a wider, fainter gap than a slow one: the cloud is pushed, not erased
    const k = Math.min(1, d / 40), rad = (80 + 50 * k) * MRES * 2, a = 0.4 - 0.15 * k
    for (let i = 1; i <= steps; i++) brush(from.x + ((p.x - from.x) * i) / steps, from.y + ((p.y - from.y) * i) / steps, rad, a)
    last = p; movedAt = performance.now()
  })
  host.addEventListener('pointerleave', () => (last = null))

  const t0 = performance.now()
  const frame = (now: number) => {
    if (!cv.isConnected) { removeEventListener('resize', size); return }
    requestAnimationFrame(frame)
    const s = (now - t0) / 1000, W = mask.width, H = mask.height
    // holes heal: the sky closes over them
    mg.globalCompositeOperation = 'source-over'; mg.fillStyle = 'rgba(0,0,0,0.016)'; mg.fillRect(0, 0, W, H)
    // the wind: when nobody moves the pointer, a slow wandering gap
    if (now - movedAt > 2500) brush(W * (0.5 + 0.36 * Math.sin(s * 0.21)), H * (0.5 + 0.32 * Math.sin(s * 0.29 + 1)), 150 * MRES * 2, 0.06)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask)
    gl.uniform2f(uRes, cv.width, cv.height); gl.uniform1f(uT, s)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  mg.fillStyle = '#000'; mg.fillRect(0, 0, mask.width, mask.height)
  requestAnimationFrame(frame)
}
