// iMessage "Send with Effect": bubble effects play on the message itself,
// screen effects take over the whole window for a few seconds.
import confetti from 'canvas-confetti'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

export const BUBBLE_EFFECTS = [
  { id: 'slam', label: 'Slam' },
  { id: 'loud', label: 'Loud' },
  { id: 'gentle', label: 'Gentle' },
  { id: 'invisible', label: 'Invisible Ink' },
] as const

export const SCREEN_EFFECTS = [
  { id: 'echo', label: 'Echo', icon: '🔁' },
  { id: 'spotlight', label: 'Spotlight', icon: '🔦' },
  { id: 'balloons', label: 'Balloons', icon: '🎈' },
  { id: 'confetti', label: 'Confetti', icon: '🎊' },
  { id: 'love', label: 'Love', icon: '❤️' },
  { id: 'lasers', label: 'Lasers', icon: '🪩' },
  { id: 'fireworks', label: 'Fireworks', icon: '🎆' },
  { id: 'celebration', label: 'Celebration', icon: '✨' },
] as const

export type EffectId = (typeof BUBBLE_EFFECTS)[number]['id'] | (typeof SCREEN_EFFECTS)[number]['id']
export const isScreenEffect = (e?: string) => SCREEN_EFFECTS.some((x) => x.id === e)
export const isBubbleEffect = (e?: string) => BUBBLE_EFFECTS.some((x) => x.id === e)
export const effectLabel = (e?: string) => [...BUBBLE_EFFECTS, ...SCREEN_EFFECTS].find((x) => x.id === e)?.label ?? ''

// ---------------------------------------------------------------------------
// Which effect messages already played on this device (so reopening a chat
// doesn't replay everything, but a message you haven't seen yet still plays).
// ---------------------------------------------------------------------------
const SEEN_KEY = 'bubbles.fxSeen'
function seenSet(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
export function markFxSeen(id: string) {
  const s = seenSet().filter((x) => x !== id)
  s.push(id)
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-300)))
  } catch {
    /* private mode */
  }
}
export const fxSeen = (id: string) => seenSet().includes(id)

// ---------------------------------------------------------------------------
// Screen effect player
// ---------------------------------------------------------------------------
interface Playing {
  key: number
  effect: string
  text: string
  msgId: string
}
const useFx = create<{ playing: Playing | null }>(() => ({ playing: null }))
let fxKey = 0
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function playScreenEffect(effect: string, text: string, msgId: string) {
  // Never play into a hidden tab: timers/animations are throttled there.
  if (reduceMotion() || !isScreenEffect(effect) || document.visibilityState !== 'visible') return
  const key = ++fxKey
  useFx.setState({ playing: { key, effect, text, msgId } })
  const done = () => useFx.setState((s) => (s.playing?.key === key ? { playing: null } : s))
  // Canvas-confetti effects are fire-and-forget; the others render below.
  if (effect === 'confetti') runConfetti()
  if (effect === 'fireworks') runFireworks()
  if (effect === 'celebration') runCelebration()
  setTimeout(done, effect === 'echo' ? 3600 : effect === 'fireworks' ? 4200 : 3400)
}

function runConfetti() {
  const end = Date.now() + 1800
  const colors = ['#ff375f', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ff9f0a']
  ;(function frame() {
    confetti({ particleCount: 7, angle: 270, spread: 140, startVelocity: 12, gravity: 0.7, ticks: 320, origin: { x: Math.random(), y: -0.05 }, colors, zIndex: 900 })
    if (Date.now() < end) requestAnimationFrame(frame)
  })()
}
function runFireworks() {
  const end = Date.now() + 3200
  const id = setInterval(() => {
    if (Date.now() > end) return clearInterval(id)
    confetti({
      particleCount: 60,
      startVelocity: 28,
      spread: 360,
      ticks: 70,
      gravity: 0.9,
      scalar: 0.9,
      shapes: ['circle'],
      origin: { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.4 },
      colors: [['#ff375f', '#ffd60a'], ['#30d158', '#64d2ff'], ['#bf5af2', '#ff9f0a']][Math.floor(Math.random() * 3)],
      zIndex: 900,
    })
  }, 380)
}
function runCelebration() {
  const end = Date.now() + 2400
  ;(function frame() {
    confetti({ particleCount: 4, angle: 225, spread: 50, startVelocity: 38, origin: { x: 1, y: 0 }, colors: ['#ffd60a', '#ffe680', '#fff3bf', '#ffffff'], shapes: ['star', 'circle'], scalar: 0.8, zIndex: 900 })
    if (Date.now() < end) requestAnimationFrame(frame)
  })()
}

function Echo({ text }: { text: string }) {
  const copies = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        x: Math.random() * 90,
        y: Math.random() * 90,
        s: 0.6 + Math.random() * 0.9,
        d: (i / 42) * 1.4,
      })),
    [],
  )
  return (
    <>
      {copies.map((c, i) => (
        <motion.div
          key={i}
          className="fx-echo"
          style={{ left: `${c.x}%`, top: `${c.y}%` }}
          initial={{ opacity: 0, scale: c.s * 0.4 }}
          animate={{ opacity: [0, 1, 1, 0], scale: [c.s * 0.4, c.s, c.s, c.s * 1.05] }}
          transition={{ duration: 2.1, delay: c.d, times: [0, 0.12, 0.8, 1] }}
        >
          {text.slice(0, 60) || '…'}
        </motion.div>
      ))}
    </>
  )
}

function Spotlight({ msgId }: { msgId: string }) {
  const [pos, setPos] = useState({ x: 50, y: 50 })
  useEffect(() => {
    const el = document.getElementById(`m-${msgId}`)?.querySelector('.msg-content')
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: ((r.left + r.width / 2) / innerWidth) * 100, y: ((r.top + r.height / 2) / innerHeight) * 100 })
  }, [msgId])
  return (
    <div className="fx-dim fx-spot" style={{ background: `radial-gradient(circle 150px at ${pos.x}% ${pos.y}%, transparent 0 60%, rgba(0,0,0,.82) 100%)` }}>
      <motion.div
        className="fx-beam"
        style={{ left: `${pos.x}%` }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      />
    </div>
  )
}

const BALLOON_COLORS = ['#ff375f', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ff9f0a', '#64d2ff']
function Balloons() {
  const balloons = useMemo(
    () => Array.from({ length: 18 }, () => ({ x: Math.random() * 95, d: Math.random() * 1.2, s: 0.7 + Math.random() * 0.6, c: BALLOON_COLORS[Math.floor(Math.random() * BALLOON_COLORS.length)], sway: (Math.random() - 0.5) * 60 })),
    [],
  )
  return (
    <>
      {balloons.map((b, i) => (
        <motion.svg
          key={i}
          viewBox="0 0 40 70"
          className="fx-balloon"
          style={{ left: `${b.x}%`, width: 56 * b.s }}
          initial={{ y: '110vh' }}
          animate={{ y: '-30vh', x: [0, b.sway, -b.sway / 2, b.sway / 3] }}
          transition={{ duration: 3, delay: b.d * 0.6, ease: 'easeIn' }}
        >
          <ellipse cx="20" cy="20" rx="17" ry="20" fill={b.c} />
          <ellipse cx="13" cy="12" rx="4" ry="6" fill="#fff" opacity=".35" />
          <path d="M18 40 l2 4 l2 -4 z" fill={b.c} />
          <path d="M20 44 q-4 8 0 13 q4 6 0 13" stroke="#ffffffaa" fill="none" strokeWidth="0.8" />
        </motion.svg>
      ))}
    </>
  )
}

function Love({ msgId }: { msgId: string }) {
  const [pos, setPos] = useState({ x: innerWidth / 2, y: innerHeight / 2 })
  useEffect(() => {
    const el = document.getElementById(`m-${msgId}`)?.querySelector('.msg-content')
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top })
  }, [msgId])
  return (
    <>
      <motion.div
        className="fx-heart"
        style={{ left: pos.x, top: pos.y }}
        initial={{ scale: 0, opacity: 0, x: '-50%', y: '-60%' }}
        animate={{ scale: [0, 1.3, 1.1, 1.2, 4], opacity: [0, 1, 1, 1, 0], y: ['-60%', '-80%', '-80%', '-90%', '-140%'] }}
        transition={{ duration: 3, times: [0, 0.2, 0.45, 0.65, 1] }}
      >
        ❤️
      </motion.div>
      {Array.from({ length: 14 }, (_, i) => (
        <motion.div
          key={i}
          className="fx-mini-heart"
          style={{ left: pos.x, top: pos.y }}
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{ opacity: [0, 1, 0], x: (Math.random() - 0.5) * 360, y: -120 - Math.random() * 260 }}
          transition={{ duration: 2.2, delay: 0.5 + Math.random() * 0.6 }}
        >
          {['❤️', '💕', '💖', '💗'][i % 4]}
        </motion.div>
      ))}
    </>
  )
}

function Lasers() {
  return (
    <div className="fx-dim fx-lasers">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="fx-laser" style={{ ['--i' as string]: i }} />
      ))}
    </div>
  )
}

export function ScreenEffects() {
  const playing = useFx((s) => s.playing)
  return createPortal(
    playing && (
        <div key={playing.key} className="fx-layer" aria-hidden>
          {playing.effect === 'echo' && <Echo text={playing.text} />}
          {playing.effect === 'spotlight' && <Spotlight msgId={playing.msgId} />}
          {playing.effect === 'balloons' && <Balloons />}
          {playing.effect === 'love' && <Love msgId={playing.msgId} />}
          {playing.effect === 'lasers' && <Lasers />}
          {playing.effect === 'fireworks' && <div className="fx-dim fx-night" />}
        </div>
      ),
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Effect picker ("Send with effect"), opened by long-press / right-click on send
// ---------------------------------------------------------------------------
export function EffectPicker({ text, onSend, onClose }: { text: string; onSend: (effect: EffectId) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'bubble' | 'screen'>('bubble')
  const [preview, setPreview] = useState<string>('slam')
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <motion.div className="fx-picker-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="fx-picker" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}>
        <h3>Send with effect</h3>
        <div className="seg fx-tabs">
          <button className={tab === 'bubble' ? 'on' : ''} onClick={() => (setTab('bubble'), setPreview('slam'))}>
            Bubble
          </button>
          <button className={tab === 'screen' ? 'on' : ''} onClick={() => (setTab('screen'), setPreview('echo'))}>
            Screen
          </button>
        </div>
        {tab === 'bubble' ? (
          <div className="fx-bubble-list">
            {BUBBLE_EFFECTS.map((b) => (
              <div key={b.id} className={`fx-row ${preview === b.id ? 'on' : ''}`} onMouseEnter={() => setPreview(b.id)} onClick={() => setPreview(b.id)}>
                <span className="fx-row-label">{b.label}</span>
                {preview === b.id && (
                  <div className="fx-row-preview">
                    <div key={b.id + text} className={`fx-demo bubble fx-${b.id} fx-play`}>
                      {text.slice(0, 80)}
                    </div>
                    <button className="send-btn fx-send" title={`Send with ${b.label}`} onClick={() => onSend(b.id)}>
                      ↑
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="fx-screen-grid">
              {SCREEN_EFFECTS.map((s) => (
                <button
                  key={s.id}
                  className={`fx-screen-card ${preview === s.id ? 'on' : ''}`}
                  title={`Preview ${s.label}`}
                  onClick={() => {
                    setPreview(s.id)
                    playScreenEffect(s.id, text, '')
                  }}
                >
                  <span>{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
            <button className="btn btn-primary fx-send-screen" onClick={() => onSend(preview as EffectId)}>
              Send with {effectLabel(preview)}
            </button>
          </>
        )}
        <button className="link fx-cancel" onClick={onClose}>
          Cancel
        </button>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
