// Matrix Rain — from 21st.dev (@johnmamanao/matrix-rain), adapted for Bubbles:
// CSS module replaced with inline styles; otherwise the original renderer.
import * as React from 'react'

import { cn } from '@/lib/utils'

const defaultCharacters =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'

type Column = { head: number; seed: number; velocity: number }

export type MatrixRainProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  background?: string
  characters?: string
  color?: string
  density?: number
  fontSize?: number
  glow?: number
  highlight?: string
  pointerResponse?: boolean
  speed?: number
  trail?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
function randomFrom(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}
function createColumn(index: number): Column {
  const seed = index * 47.17 + 11.3
  const entryPhase = randomFrom(seed + 2.4)
  return { head: 1.5 - entryPhase * 10.5, seed, velocity: 9 + randomFrom(seed + 5.7) * 11 }
}

export function MatrixRain({
  background = '#020604',
  characters = defaultCharacters,
  className,
  color = '#39ff68',
  density = 0.9,
  fontSize = 28,
  glow = 8,
  highlight = '#eaffed',
  pointerResponse = true,
  speed = 1,
  style,
  trail = 0.9,
  ...props
}: MatrixRainProps) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const safeFontSize = clamp(fontSize, 10, 32)
    const safeDensity = clamp(density, 0.45, 1.4)
    const safeSpeed = clamp(speed, 0.2, 2.5)
    const safeTrail = clamp(trail, 0.72, 0.97)
    const glyphs = Array.from(characters || defaultCharacters)
    const pointer = { active: false, x: 0, y: 0 }
    let columns: Column[] = []
    let columnWidth = safeFontSize / safeDensity
    let frame: number | undefined
    let lastTime = performance.now()
    let elapsed = 0
    let acc = 0
    let visible = true
    const motionPref = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reduceMotion = motionPref.matches

    function resize() {
      const b = root!.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(b.width * ratio))
      const h = Math.max(1, Math.round(b.height * ratio))
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w
        canvas!.height = h
      }
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0)
      columnWidth = safeFontSize / safeDensity
      columns = Array.from({ length: Math.ceil(b.width / columnWidth) + 1 }, (_, i) => createColumn(i))
      ctx!.fillStyle = background
      ctx!.fillRect(0, 0, b.width, b.height)
    }
    const characterAt = (seed: number) => glyphs[Math.floor(randomFrom(seed) * glyphs.length)] ?? glyphs[0] ?? '0'
    const font = `500 ${safeFontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

    function drawStatic() {
      const b = root!.getBoundingClientRect()
      ctx!.globalAlpha = 1
      ctx!.fillStyle = background
      ctx!.fillRect(0, 0, b.width, b.height)
      ctx!.font = font
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'middle'
      columns.forEach((column, ci) => {
        const x = ci * columnWidth + columnWidth * 0.5
        const len = 10 + Math.floor(randomFrom(column.seed + 8) * 16)
        for (let o = 0; o < len; o++) {
          const row = Math.floor(column.head) - o
          const y = row * safeFontSize
          if (y < -safeFontSize || y > b.height + safeFontSize) continue
          const p = o / Math.max(len - 1, 1)
          ctx!.globalAlpha = Math.pow(1 - p, 2.2)
          ctx!.fillStyle = o === 0 ? highlight : color
          ctx!.shadowColor = color
          ctx!.shadowBlur = clamp(glow, 0, 18) * (1 - p)
          ctx!.fillText(characterAt(column.seed + row * 2.73), x, y)
        }
      })
      ctx!.globalAlpha = 1
      ctx!.shadowBlur = 0
    }

    function drawRainTick(dt: number) {
      const b = root!.getBoundingClientRect()
      const rows = Math.ceil(b.height / safeFontSize)
      const radius = Math.max(84, safeFontSize * 7.5)
      ctx!.globalAlpha = (1 - safeTrail) * 0.5
      ctx!.fillStyle = background
      ctx!.fillRect(0, 0, b.width, b.height)
      ctx!.font = font
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'middle'
      columns.forEach((column, ci) => {
        column.head += column.velocity * safeSpeed * dt
        if (column.head > rows + 4) {
          const reset = createColumn(ci + Math.floor(elapsed * 0.01))
          column.head = -4 - randomFrom(reset.seed + 9) * rows * 0.5
          column.seed = reset.seed
          column.velocity = reset.velocity
        }
        const x = ci * columnWidth + columnWidth * 0.5
        const y = Math.floor(column.head) * safeFontSize
        const dx = x - pointer.x
        const dy = y - pointer.y
        const dist = Math.hypot(dx, dy)
        const influence = pointerResponse && pointer.active ? Math.max(0, 1 - dist / radius) : 0
        const disp = dist > 0 ? (dx / dist) * influence * 7 : 0
        const glyph = characterAt(column.seed + Math.floor(column.head) * 2.73 + elapsed * 0.0041)
        ctx!.globalAlpha = 0.82 + influence * 0.18
        ctx!.fillStyle = color
        ctx!.shadowColor = color
        ctx!.shadowBlur = clamp(glow, 0, 18) * (0.7 + influence * 0.5)
        ctx!.fillText(glyph, x + disp, y)
        ctx!.globalAlpha = 0.62 + influence * 0.38
        ctx!.fillStyle = highlight
        ctx!.shadowBlur = clamp(glow, 0, 18) * 0.45
        ctx!.fillText(glyph, x + disp, y)
      })
      ctx!.globalAlpha = 1
      ctx!.shadowBlur = 0
    }

    function tick(time: number) {
      const dt = Math.min((time - lastTime) / 1000, 0.05)
      lastTime = time
      elapsed += dt * 1000
      acc += dt
      if (acc >= 0.05) {
        drawRainTick(acc)
        acc = 0
      }
      frame = visible && !reduceMotion && document.visibilityState === 'visible' ? requestAnimationFrame(tick) : undefined
    }
    const start = () => {
      if (frame !== undefined || !visible || reduceMotion) return
      lastTime = performance.now()
      frame = requestAnimationFrame(tick)
    }
    const stop = () => {
      if (frame === undefined) return
      cancelAnimationFrame(frame)
      frame = undefined
    }
    // The background sits under the app, so follow the pointer over the whole window.
    const onMove = (e: PointerEvent) => {
      const b = root!.getBoundingClientRect()
      pointer.active = true
      pointer.x = e.clientX - b.left
      pointer.y = e.clientY - b.top
    }
    const onLeave = () => (pointer.active = false)
    const onMotion = () => {
      reduceMotion = motionPref.matches
      if (reduceMotion) {
        stop()
        drawStatic()
      } else start()
    }
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop())

    const ro = new ResizeObserver(() => {
      resize()
      if (reduceMotion) drawStatic()
      else drawRainTick(0)
    })
    resize()
    if (reduceMotion) drawStatic()
    else drawRainTick(0)
    start()
    ro.observe(root)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    motionPref.addEventListener('change', onMotion)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      motionPref.removeEventListener('change', onMotion)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [background, characters, color, density, fontSize, glow, highlight, pointerResponse, speed, trail])

  return (
    <div ref={rootRef} aria-hidden className={cn('relative overflow-hidden', className)} style={{ background, ...style }} {...props}>
      <canvas ref={canvasRef} aria-hidden style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}

export default MatrixRain
