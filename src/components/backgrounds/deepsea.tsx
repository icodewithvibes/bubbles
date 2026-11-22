// Deep Sea — 21st.dev "Water Caustic" (@chamaac) fragment shader ported from
// three.js/R3F to plain WebGL (no 600 KB dependency), over an ocean gradient
// with light rays and rising bubbles.
import { useEffect, useRef } from 'react'

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`
const FRAG = `precision mediump float;
uniform float iTime; uniform vec2 iResolution; uniform vec3 uColor;
vec2 hash2(vec2 p, float period) {
  p = mod(p, period);
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}
float causticPattern(vec2 p, float period, float t) {
  vec2 n = floor(p); vec2 f = fract(p);
  float F1 = 8.0; float F2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash2(n + g, period);
    o = 0.5 + 0.4 * sin(t + 6.2831853 * o);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) { F2 = d; }
  }
  return F2 - F1;
}
void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  uv.x *= iResolution.x / iResolution.y;
  float period = 4.0; vec2 p = uv * period; float t = iTime * 0.6;
  float c = (1.0 - causticPattern(p, period * 4.0, t)) * 0.6
          + (1.0 - causticPattern(p * 2.5, period * 10.0, t * 1.4)) * 0.3
          + (1.0 - causticPattern(p * 4.0, period * 16.0, t * 0.7)) * 0.1;
  c = pow(c, 3.0);
  c = smoothstep(0.3, 1.0, c) * 1.2;
  // Caustics are brightest near the surface (top of the screen).
  float depth = mix(0.25, 1.0, uv.y / max(iResolution.y / iResolution.x, 0.0001) * (iResolution.x / iResolution.y));
  vec3 col = uColor * c + uColor * 0.5 * pow(c, 2.0);
  gl_FragColor = vec4(col * clamp(gl_FragCoord.y / iResolution.y * 1.2, 0.15, 1.0), clamp(c * 0.9, 0.0, 1.0));
}`

function Caustics() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const gl = canvas?.getContext('webgl', { premultipliedAlpha: false, alpha: true })
    if (!canvas || !gl) return
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.uniform3f(gl.getUniformLocation(prog, 'uColor'), 0.38, 0.85, 1.0)
    const uTime = gl.getUniformLocation(prog, 'iTime')
    const uRes = gl.getUniformLocation(prog, 'iResolution')
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const t0 = performance.now()
    const frame = (now: number) => {
      raf = 0
      // Half resolution: caustics are soft, and it keeps laptops cool.
      const w = Math.max(1, Math.round(canvas.clientWidth * 0.5))
      const h = Math.max(1, Math.round(canvas.clientHeight * 0.5))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        gl.viewport(0, 0, w, h)
      }
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(uTime, (now - t0) / 1000)
      gl.uniform2f(uRes, w, h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!reduce && document.visibilityState === 'visible') raf = requestAnimationFrame(frame)
    }
    const onVis = () => !raf && document.visibilityState === 'visible' && (raf = requestAnimationFrame(frame))
    raf = requestAnimationFrame(frame)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" style={{ mixBlendMode: 'screen', opacity: 0.3, WebkitMaskImage: 'linear-gradient(180deg, #000 0%, transparent 65%)', maskImage: 'linear-gradient(180deg, #000 0%, transparent 65%)' }} aria-hidden />
}

/** Bubbles rising and wobbling, with a highlight like real ones. */
export function RisingBubbles() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let w = 0
    let h = 0
    type B = { x: number; y: number; r: number; v: number; ph: number; sw: number }
    let bubbles: B[] = []
    const make = (bottom = true): B => ({
      x: Math.random() * w,
      y: bottom ? h + 20 + Math.random() * 200 : Math.random() * h,
      r: 3 + Math.random() ** 2 * 16,
      v: 20 + Math.random() * 45,
      ph: Math.random() * Math.PI * 2,
      sw: 6 + Math.random() * 14,
    })
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      w = canvas.clientWidth || innerWidth
      h = canvas.clientHeight || innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      bubbles = Array.from({ length: Math.round(Math.min(90, (w * h) / 14000)) }, () => make(false))
    }
    resize()
    const ro = new ResizeObserver(() => (canvas.clientWidth !== w || canvas.clientHeight !== h) && resize())
    ro.observe(canvas)
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      ctx.clearRect(0, 0, w, h)
      for (const b of bubbles) {
        b.y -= b.v * dt * (0.6 + b.r / 14)
        b.ph += dt * 2
        if (b.y < -20) Object.assign(b, make())
        const x = b.x + Math.sin(b.ph) * b.sw * 0.4
        ctx.beginPath()
        ctx.arc(x, b.y, b.r, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(200,245,255,0.75)'
        ctx.lineWidth = 1.4
        ctx.lineWidth = 1
        ctx.fillStyle = 'rgba(160,230,255,0.14)'
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.fill()
      }
      raf = document.visibilityState === 'visible' ? requestAnimationFrame(frame) : 0
    }
    const onVis = () => {
      if (!raf && document.visibilityState === 'visible') {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }
    raf = requestAnimationFrame(frame)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}

export function DeepSea() {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'linear-gradient(180deg, #0b4f74 0%, #06324f 35%, #031c2e 70%, #010b14 100%)' }}>
      <div className="deepsea-rays" />
      <Caustics />
      <RisingBubbles />
    </div>
  )
}
