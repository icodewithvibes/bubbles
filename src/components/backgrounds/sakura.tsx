import { useEffect, useRef } from 'react'

import { SakuraShader } from './sakura-shader'

// Original ASCII art: a blossom branch and a torii gate with 桜 (sakura).
const BRANCH = String.raw`
 \__      ,*.
    \__  ( @ )   ,*.
       \__\*'---( @ )
          \       '*'    ,*.
           '-._____.----( @ )
              \   ,*.    '*'
               \_( @ )
                  '*'`

const TORII = String.raw`
   ._______________________________.
   \_____________________________/
       ||  [__]         [__]  ||
   ____||_____________________||____
   \___||_________ 桜 _________||___/
       ||                     ||
       ||                     ||
       ||                     ||
  ~~~~~||~~~~~~~~~~~~~~~~~~~~~||~~~~~
 ~~~~ ~~~~~ ~~~~~ ~~~~~ ~~~~~ ~~~~ ~~`

interface Petal {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  rot: number
  vr: number
  sway: number
  phase: number
  hue: number
}

/** Soft five-ish petal shapes drifting down with a little wind. */
function Petals() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let petals: Petal[] = []
    const make = (top = false): Petal => ({
      x: Math.random() * w,
      y: top ? -20 - Math.random() * h * 0.3 : Math.random() * h,
      r: 4 + Math.random() * 6,
      vx: 0.2 + Math.random() * 0.5,
      vy: 0.5 + Math.random() * 0.9,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.04,
      sway: 0.6 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
      hue: 340 + Math.random() * 20,
    })
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round(Math.min(70, (w * h) / 22000))
      petals = Array.from({ length: count }, () => make())
    }
    const draw = (p: Petal) => {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.scale(1, 0.6 + 0.4 * Math.abs(Math.sin(p.rot * 2)))
      ctx.beginPath()
      ctx.moveTo(0, -p.r)
      ctx.bezierCurveTo(p.r, -p.r, p.r * 0.9, p.r * 0.6, 0, p.r)
      ctx.bezierCurveTo(-p.r * 0.9, p.r * 0.6, -p.r, -p.r, 0, -p.r)
      ctx.fillStyle = `hsla(${p.hue}, 85%, 82%, 0.85)`
      ctx.fill()
      ctx.restore()
    }
    let raf = 0
    let t = 0
    const tick = () => {
      t += 0.016
      ctx.clearRect(0, 0, w, h)
      for (const p of petals) {
        p.x += p.vx + Math.sin(t * p.sway + p.phase) * 0.6
        p.y += p.vy
        p.rot += p.vr
        if (p.y > h + 20 || p.x > w + 20) Object.assign(p, make(true), { x: Math.random() * w * 0.9 - w * 0.1 })
        draw(p)
      }
      raf = document.visibilityState === 'visible' ? requestAnimationFrame(tick) : 0
    }
    const onVis = () => !reduce && !raf && document.visibilityState === 'visible' && (raf = requestAnimationFrame(tick))
    resize()
    if (reduce) petals.forEach(draw)
    else raf = requestAnimationFrame(tick)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}

export function SakuraScene() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <SakuraShader className="absolute inset-0" />
      {/* Dusk veil: keeps the light text readable and makes the petals glow. */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(26,16,34,0.72), rgba(48,20,40,0.55) 55%, rgba(20,12,28,0.78))' }} />
      <pre className="sakura-ascii sakura-branch">{BRANCH}</pre>
      <pre className="sakura-ascii sakura-torii">{TORII}</pre>
      <Petals />
    </div>
  )
}
