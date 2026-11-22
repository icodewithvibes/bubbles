// Galaxy — condensed port of 21st.dev "Gravity Stars" (@educalvolpz): depth-shaded
// glowing star sprites, twinkle, faint constellation links, and a gravity well
// that swirls stars around your cursor. Drawn over a slow nebula.
import { useEffect, useRef } from 'react'

const COUNT = 230
const LINK = 120
const TAU = Math.PI * 2

function sprite(rgb: [number, number, number]) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const [r, gg, b] = rgb
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, `rgba(${r},${gg},${b},1)`)
  grad.addColorStop(0.08, `rgba(${r},${gg},${b},0.9)`)
  grad.addColorStop(0.2, `rgba(${r},${gg},${b},0.35)`)
  grad.addColorStop(0.5, `rgba(${r},${gg},${b},0.06)`)
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

export function Galaxy() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const sprites = [sprite([205, 220, 255]), sprite([236, 236, 245]), sprite([255, 226, 190]), sprite([200, 170, 255])]
    let w = 0
    let h = 0
    const xs = new Float32Array(COUNT)
    const ys = new Float32Array(COUNT)
    const vx = new Float32Array(COUNT)
    const vy = new Float32Array(COUNT)
    const dx = new Float32Array(COUNT)
    const dy = new Float32Array(COUNT)
    const z = new Float32Array(COUNT)
    const ph = new Float32Array(COUNT)
    const tint = new Uint8Array(COUNT)
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      const pw = w
      const pH = h
      w = innerWidth
      h = innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (let i = 0; i < COUNT; i++) {
        if (pw) {
          xs[i] *= w / pw
          ys[i] *= h / pH
        } else {
          xs[i] = Math.random() * w
          ys[i] = Math.random() * h
          z[i] = Math.random() ** 1.7
          ph[i] = Math.random() * TAU
          tint[i] = Math.floor(((Math.random() + Math.random()) / 2) * sprites.length)
          const a = Math.random() * TAU
          const m = 10 * (0.15 + z[i])
          dx[i] = Math.cos(a) * m
          dy[i] = Math.sin(a) * m
        }
      }
    }
    resize()
    window.addEventListener('resize', resize)

    const ptr = { x: 0, y: 0, on: false }
    const move = (e: PointerEvent) => Object.assign(ptr, { x: e.clientX, y: e.clientY, on: true })
    const leave = () => (ptr.on = false)
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)

    let raf = 0
    let last = performance.now()
    const t0 = last
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const el = (now - t0) / 1000
      ctx.clearRect(0, 0, w, h)
      for (let i = 0; i < COUNT; i++) {
        let ax = 0
        let ay = 0
        if (ptr.on) {
          // Softened inverse-square pull with a swirl (from Gravity Stars).
          const ex = ptr.x - xs[i]
          const ey = ptr.y - ys[i]
          const d2 = ex * ex + ey * ey
          const reach = 240 * (0.6 + z[i] * 0.8)
          if (d2 < reach * reach) {
            const soft = Math.sqrt(d2 + 676)
            const fade = 1 - Math.sqrt(d2) / reach
            const s = Math.min((3_200_000 * (0.35 + z[i])) / (soft * soft), 4500) * fade * fade
            const nx = ex / soft
            const ny = ey / soft
            ax = nx * s - ny * s * 0.85
            ay = ny * s + nx * s * 0.85
          }
        }
        const damp = 0.97 ** (dt * 60)
        vx[i] = (vx[i] + ax * dt) * damp
        vy[i] = (vy[i] + ay * dt) * damp
        xs[i] = (xs[i] + (vx[i] + dx[i]) * dt + w) % w
        ys[i] = (ys[i] + (vy[i] + dy[i]) * dt + h) % h
      }
      // Constellation links (cheap O(n²) on 230 stars, only near pairs drawn).
      ctx.lineWidth = 0.5
      for (let i = 0; i < COUNT; i++) {
        for (let j = i + 1; j < COUNT; j++) {
          const ex = xs[i] - xs[j]
          const ey = ys[i] - ys[j]
          const d2 = ex * ex + ey * ey
          if (d2 > LINK * LINK) continue
          const a = (1 - Math.sqrt(d2) / LINK) ** 1.5 * (0.25 + ((z[i] + z[j]) / 2) * 0.6) * 0.35
          ctx.strokeStyle = `rgba(190,200,255,${a})`
          ctx.beginPath()
          ctx.moveTo(xs[i], ys[i])
          ctx.lineTo(xs[j], ys[j])
          ctx.stroke()
        }
      }
      for (let i = 0; i < COUNT; i++) {
        const wave = Math.sin(el * 1.15 + ph[i])
        ctx.globalAlpha = Math.min(1, (0.18 + z[i] * 0.82) * (1 - 0.28 * (1 - wave)))
        const halo = 1.5 * (0.42 + z[i] * 1.9) * 5 * (0.6 + z[i] * 0.7)
        ctx.drawImage(sprites[tint[i]], xs[i] - halo, ys[i] - halo, halo * 2, halo * 2)
      }
      ctx.globalAlpha = 1
      raf = !reduce && document.visibilityState === 'visible' ? requestAnimationFrame(frame) : 0
    }
    const onVis = () => {
      if (!raf && !reduce && document.visibilityState === 'visible') {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }
    raf = requestAnimationFrame(frame)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return (
    <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 25% 30%, #2b1055 0%, transparent 55%), radial-gradient(ellipse at 80% 75%, #0f3460 0%, transparent 55%), #05040f' }}>
      <div className="galaxy-nebula" />
      <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
    </div>
  )
}
