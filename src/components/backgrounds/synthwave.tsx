// Synthwave — the 21st.dev "Retro Grid" (@waleedkibhen) perspective grid, adapted:
// HiDPI-aware, pauses when hidden, plus an 80s striped sun and horizon glow.
import { useEffect, useRef } from 'react'

export function Synthwave({ gridColor = '#ff2bd6' }: { gridColor?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5)
      w = innerWidth
      h = innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const cellW = 120
    const cellD = 80
    const cols = 18
    const rows = 22
    const camY = 60
    const camZ = 400
    const focal = 500
    const horizon = () => h * 0.52
    const project = (x: number, y: number, z: number) => {
      const rz = z - camZ
      if (rz <= 10) return null
      const s = focal / rz
      return { x: w / 2 + x * s, y: horizon() - (y - camY) * s }
    }

    let offset = 0
    let raf = 0
    let t = 0
    const frame = () => {
      t += 0.016
      ctx.clearRect(0, 0, w, h)
      const hz = horizon()

      // Sky: deep purple fading to hot magenta at the horizon.
      const sky = ctx.createLinearGradient(0, 0, 0, hz)
      sky.addColorStop(0, '#0b0221')
      sky.addColorStop(0.55, '#2a0845')
      sky.addColorStop(0.85, '#6a1265')
      sky.addColorStop(1, '#c2185b')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, hz)

      // Striped sun sinking into the grid.
      const r = Math.min(w, h) * 0.2
      const cx = w / 2
      const cy = hz - r * 0.35
      const sun = ctx.createLinearGradient(0, cy - r, 0, cy + r)
      sun.addColorStop(0, '#ffe66d')
      sun.addColorStop(0.5, '#ff8c42')
      sun.addColorStop(1, '#ff2bd6')
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = sun
      ctx.shadowColor = '#ff6ec7'
      ctx.shadowBlur = 40
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
      ctx.shadowBlur = 0
      // Gaps get wider toward the bottom, drifting down slowly.
      ctx.globalCompositeOperation = 'destination-out'
      for (let i = 0; i < 7; i++) {
        const k = (i + ((t * 0.15) % 1)) / 7
        const y = cy + k * r
        const gap = 2 + k * r * 0.09
        ctx.fillRect(cx - r, y, r * 2, gap)
      }
      ctx.restore()

      // Ground.
      const ground = ctx.createLinearGradient(0, hz, 0, h)
      ground.addColorStop(0, '#1a0633')
      ground.addColorStop(1, '#05010d')
      ctx.fillStyle = ground
      ctx.fillRect(0, hz, w, h - hz)

      // Grid (from Retro Grid): cells scroll toward the viewer.
      offset = (offset + (reduce ? 0 : 1.2)) % cellD
      ctx.strokeStyle = gridColor
      for (let row = -3; row < rows; row++) {
        const z = row * cellD - offset
        if (z < 0) continue
        const fade = Math.min(1, z / (rows * cellD))
        ctx.globalAlpha = Math.max(0.15, 1 - fade * 0.85)
        ctx.lineWidth = Math.max(1, 2.2 * (1 - fade * 0.6))
        ctx.shadowColor = gridColor
        ctx.shadowBlur = 8 * (1 - fade)
        ctx.beginPath()
        for (let col = -cols / 2; col <= cols / 2; col++) {
          const x = col * cellW
          const a = project(x - cellW / 2, 0, z)
          const b = project(x + cellW / 2, 0, z)
          const c = project(x + cellW / 2, 0, z + cellD)
          const d = project(x - cellW / 2, 0, z + cellD)
          if (!a || !b || !c || !d) continue
          ctx.moveTo(d.x, d.y)
          ctx.lineTo(c.x, c.y)
          ctx.lineTo(b.x, b.y)
          ctx.lineTo(a.x, a.y)
          ctx.closePath()
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

      // Horizon glow line + soft scanlines.
      const glow = ctx.createLinearGradient(0, hz - 6, 0, hz + 6)
      glow.addColorStop(0, 'rgba(255,43,214,0)')
      glow.addColorStop(0.5, 'rgba(255,110,199,0.9)')
      glow.addColorStop(1, 'rgba(255,43,214,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, hz - 6, w, 12)
      ctx.fillStyle = 'rgba(0,0,0,0.12)'
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1)

      raf = !reduce && document.visibilityState === 'visible' ? requestAnimationFrame(frame) : 0
    }
    const onVis = () => !raf && document.visibilityState === 'visible' && !reduce && (raf = requestAnimationFrame(frame))
    frame()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [gridColor])
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}
