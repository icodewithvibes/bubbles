import { useEffect, useRef } from 'react'

import { SakuraShader } from './sakura-shader'

const asset = (f: string) => `${import.meta.env.BASE_URL}ascii/${f}`

/**
 * ASCII art from the 21st.dev ASCII community (baked to looping video):
 * "ascii flower" by @daschinmoyy21 and "mtfuji" by @kushal.ict2022.
 */
function AsciiVideo({ name, className }: { name: string; className: string }) {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <video
      className={className}
      src={asset(`${name}.mp4`)}
      poster={asset(`${name}.webp`)}
      autoPlay={!reduce}
      loop
      muted
      playsInline
      aria-hidden
    />
  )
}

/** The dreamy background: shader + dusk veil + ASCII art. Sits behind the app. */
export function SakuraScene() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <SakuraShader className="absolute inset-0" />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(26,16,34,0.7), rgba(48,20,40,0.5) 55%, rgba(20,12,28,0.78))' }} />
      <AsciiVideo name="mtfuji" className="sakura-fuji" />
      <AsciiVideo name="sakura-branch" className="sakura-branch-video" />
    </div>
  )
}

interface Petal {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  rot: number
  vr: number
  flip: number
  vf: number
  sway: number
  phase: number
  hue: number
  light: number
}

/**
 * Falling petals, drawn in a layer ABOVE the app (clicks pass through), so
 * they drift over the chat instead of hiding behind the frosted panels.
 */
export function SakuraPetals() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let w = 0
    let h = 0
    let petals: Petal[] = []
    const make = (top = false): Petal => ({
      x: Math.random() * w * 1.1 - w * 0.1,
      y: top ? -30 - Math.random() * 120 : Math.random() * h,
      r: 7 + Math.random() * 7,
      vx: 0.35 + Math.random() * 0.6,
      vy: 0.6 + Math.random() * 0.9,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.035,
      flip: Math.random() * Math.PI * 2,
      vf: 0.02 + Math.random() * 0.04,
      sway: 0.5 + Math.random(),
      phase: Math.random() * Math.PI * 2,
      hue: 338 + Math.random() * 18,
      light: 80 + Math.random() * 10,
    })
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      w = innerWidth
      h = innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round(Math.max(18, Math.min(48, (w * h) / 32000)))
      petals = Array.from({ length: count }, () => make())
    }
    const draw = (p: Petal) => {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      // A tumbling petal: squash one axis as it "flips" in the air.
      ctx.scale(Math.cos(p.flip) * 0.75 + 0.25 * Math.sign(Math.cos(p.flip) || 1), 1)
      const r = p.r
      const g = ctx.createLinearGradient(0, -r, 0, r)
      g.addColorStop(0, `hsla(${p.hue}, 95%, ${p.light + 6}%, 0.95)`)
      g.addColorStop(1, `hsla(${p.hue}, 80%, ${p.light - 14}%, 0.95)`)
      ctx.beginPath()
      // Cherry petal: rounded with a little notch at the tip.
      ctx.moveTo(0, r)
      ctx.bezierCurveTo(r * 1.1, r * 0.4, r * 0.8, -r * 0.9, r * 0.18, -r)
      ctx.lineTo(0, -r * 0.72)
      ctx.lineTo(-r * 0.18, -r)
      ctx.bezierCurveTo(-r * 0.8, -r * 0.9, -r * 1.1, r * 0.4, 0, r)
      ctx.fillStyle = g
      ctx.shadowColor = 'rgba(255, 120, 170, 0.55)'
      ctx.shadowBlur = 6
      ctx.fill()
      ctx.restore()
    }
    let raf = 0
    let t = 0
    const tick = () => {
      t += 0.016
      ctx.clearRect(0, 0, w, h)
      for (const p of petals) {
        p.x += p.vx + Math.sin(t * p.sway + p.phase) * 0.7
        p.y += p.vy
        p.rot += p.vr
        p.flip += p.vf
        if (p.y > h + 30 || p.x > w + 30) Object.assign(p, make(true))
        draw(p)
      }
      raf = document.visibilityState === 'visible' ? requestAnimationFrame(tick) : 0
    }
    const onVis = () => !raf && document.visibilityState === 'visible' && (raf = requestAnimationFrame(tick))
    resize()
    raf = requestAnimationFrame(tick)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return <canvas ref={ref} className="h-full w-full" aria-hidden />
}
