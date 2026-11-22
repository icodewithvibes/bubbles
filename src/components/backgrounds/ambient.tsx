// Original lightweight backgrounds: Lava Lamp, Midnight Rain, Winter, Retro CRT.
import { useEffect, useMemo, useRef } from 'react'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Runs `draw(dt)` every frame while the tab is visible; pauses otherwise. */
function useCanvasLoop(setup: (ctx: CanvasRenderingContext2D, size: () => { w: number; h: number }) => (dt: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let w = 0
    let h = 0
    let draw: (dt: number) => void = () => {}
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      w = canvas.clientWidth || innerWidth
      h = canvas.clientHeight || innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw = setup(ctx, () => ({ w, h }))
    }
    resize()
    const ro = new ResizeObserver(() => (canvas.clientWidth !== w || canvas.clientHeight !== h) && resize())
    ro.observe(canvas)
    if (reduced()) {
      draw(0)
      return () => ro.disconnect()
    }
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      draw(dt)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return ref
}

// ---------------------------------------------------------------------------
// Lava Lamp: CSS "gooey" metaballs (blur + contrast makes blobs merge).
// ---------------------------------------------------------------------------
export function LavaLamp() {
  const blobs = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        left: 8 + ((i * 37) % 84),
        size: 14 + ((i * 53) % 18),
        dur: 18 + ((i * 7) % 16),
        delay: -((i * 5.3) % 20),
        hue: i % 3,
      })),
    [],
  )
  return (
    <div className="absolute inset-0 overflow-hidden lava-bg">
      {/* Goo filter: blur then sharpen only the alpha channel, so blobs merge
          into each other but keep their own colors. */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <filter id="bubbles-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 28 -11" />
        </filter>
      </svg>
      <div className="lava-goo">
        {blobs.map((b, i) => (
          <span
            key={i}
            className={`lava-blob h${b.hue}`}
            style={{ left: `${b.left}%`, width: `${b.size}vmin`, height: `${b.size}vmin`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }}
          />
        ))}
        <span className="lava-pool top" />
        <span className="lava-pool bottom" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Midnight Rain: bokeh city lights + slanted rain streaks + drops on the glass.
// ---------------------------------------------------------------------------
export function RainFall() {
  const ref = useCanvasLoop((ctx, size) => {
    const { w, h } = size()
    const streaks = Array.from({ length: Math.round((w * h) / 9000) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      len: 10 + Math.random() * 22,
      v: 650 + Math.random() * 500,
      a: 0.12 + Math.random() * 0.3,
    }))
    const drops = Array.from({ length: Math.round((w * h) / 40000) }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 1.5 + Math.random() * 3.5,
      slide: Math.random() < 0.3 ? 20 + Math.random() * 60 : 0,
    }))
    return (dt) => {
      ctx.clearRect(0, 0, w, h)
      ctx.lineCap = 'round'
      for (const s of streaks) {
        s.y += s.v * dt
        s.x -= s.v * dt * 0.18
        if (s.y > h + 30) {
          s.y = -30
          s.x = Math.random() * (w + 200)
        }
        ctx.strokeStyle = `rgba(180,200,255,${s.a})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(s.x + s.len * 0.18, s.y - s.len)
        ctx.stroke()
      }
      for (const d of drops) {
        if (d.slide) {
          d.y += d.slide * dt
          if (d.y > h + 10) d.y = -10
        }
        const g = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.4, 0, d.x, d.y, d.r)
        g.addColorStop(0, 'rgba(255,255,255,0.55)')
        g.addColorStop(0.6, 'rgba(160,190,255,0.18)')
        g.addColorStop(1, 'rgba(120,150,220,0.05)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}

export function MidnightRain() {
  const bokeh = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        x: (i * 41) % 100,
        y: 40 + ((i * 29) % 55),
        s: 4 + ((i * 13) % 9),
        c: ['#ffb347', '#ff6b9d', '#6ec3ff', '#ffe08a', '#b388ff'][i % 5],
        d: 6 + (i % 7),
      })),
    [],
  )
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0f24 0%, #111a3a 50%, #1b1230 100%)' }}>
      {bokeh.map((b, i) => (
        <span key={i} className="rain-bokeh" style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.s}vmin`, height: `${b.s}vmin`, background: b.c, animationDuration: `${b.d}s` }} />
      ))}
      <RainFall />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Winter: aurora ribbons + layered snowfall with a little wind.
// ---------------------------------------------------------------------------
export function Snow() {
  const ref = useCanvasLoop((ctx, size) => {
    const { w, h } = size()
    const flakes = Array.from({ length: Math.round(Math.min(220, (w * h) / 7000)) }, () => {
      const z = Math.random()
      return { x: Math.random() * w, y: Math.random() * h, r: 0.8 + z * 2.6, v: 15 + z * 45, ph: Math.random() * 6.28, a: 0.35 + z * 0.6 }
    })
    let t = 0
    return (dt) => {
      t += dt
      ctx.clearRect(0, 0, w, h)
      const wind = Math.sin(t * 0.3) * 18
      for (const f of flakes) {
        f.y += f.v * dt
        f.x += (wind + Math.sin(t + f.ph) * 10) * dt * (f.r / 2)
        if (f.y > h + 5) {
          f.y = -5
          f.x = Math.random() * w
        }
        if (f.x > w + 5) f.x = -5
        if (f.x < -5) f.x = w + 5
        ctx.globalAlpha = f.a
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  })
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}

export function Winter() {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: 'linear-gradient(180deg, #050b1f 0%, #0b1a3a 55%, #16294f 100%)' }}>
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="aurora a3" />
      <div className="winter-hills" />
      <Snow />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Retro CRT: amber phosphor terminal, scanlines, rolling bar, slow boot log.
// ---------------------------------------------------------------------------
const BOOT = [
  'BUBBLES OS v2.2  (c) 1987',
  'MEMORY TEST ........ 640K OK',
  'LOADING FRIENDS.DAT ......... OK',
  'DIALING MODEM ... CONNECT 2400',
  'ESTABLISHING CHAT LINK ...... OK',
  'TYPE MESSAGE AND PRESS ENTER_',
]
export function RetroCRT() {
  return (
    <div className="absolute inset-0 overflow-hidden crt-bg">
      <pre className="crt-log">{BOOT.join('\n')}</pre>
      <div className="crt-scan" />
      <div className="crt-roll" />
      <div className="crt-vignette" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Motes: a light, generic particle layer (stars, sparks, embers, code glyphs)
// used on top of a chat's own background photo so the theme stays alive.
// ---------------------------------------------------------------------------
export function Motes({ colors, drift = 'up', glyphs, count = 60 }: { colors: string[]; drift?: 'up' | 'down' | 'still'; glyphs?: string; count?: number }) {
  const ref = useCanvasLoop((ctx, size) => {
    const { w, h } = size()
    const n = Math.round(Math.min(count, (w * h) / 9000))
    const make = (anywhere: boolean) => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : drift === 'down' ? -10 : h + 10,
      r: glyphs ? 11 + Math.random() * 6 : 0.6 + Math.random() ** 2 * 2.6,
      v: drift === 'still' ? 0 : glyphs ? 40 + Math.random() * 70 : 8 + Math.random() * 26,
      ph: Math.random() * 6.28,
      c: colors[Math.floor(Math.random() * colors.length)],
      g: glyphs ? glyphs[Math.floor(Math.random() * glyphs.length)] : '',
    })
    const ps = Array.from({ length: n }, () => make(true))
    let t = 0
    return (dt) => {
      t += dt
      ctx.clearRect(0, 0, w, h)
      for (const p of ps) {
        if (drift === 'up') p.y -= p.v * dt
        if (drift === 'down') p.y += p.v * dt
        p.x += Math.sin(t * 0.6 + p.ph) * 6 * dt
        if (p.y < -12 || p.y > h + 12) Object.assign(p, make(false))
        const tw = 0.55 + 0.45 * Math.sin(t * 1.7 + p.ph * 3)
        ctx.globalAlpha = tw * (glyphs ? 0.55 : 0.9)
        ctx.fillStyle = p.c
        ctx.shadowColor = p.c
        ctx.shadowBlur = glyphs ? 6 : 8
        if (glyphs) {
          ctx.font = `${p.r}px ui-monospace, monospace`
          if (Math.random() < 0.02) p.g = glyphs[Math.floor(Math.random() * glyphs.length)]
          ctx.fillText(p.g, p.x, p.y)
        } else {
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    }
  })
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}

export function Scanlines() {
  return (
    <>
      <div className="crt-scan" />
      <div className="crt-roll" />
      <div className="crt-vignette" />
    </>
  )
}
