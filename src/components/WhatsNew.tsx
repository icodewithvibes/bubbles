// "What's new" popup. Patterns adapted from 21st.dev: a staggered bento grid
// (kokonutd/bento-grid), a mouse-tracking glow border card
// (themeocean/3d-animated-tilt-dynamic-glow-card) and a shimmer headline.
import { motion } from 'motion/react'
import { useRef, type ReactNode } from 'react'

import { closeModal, get, openModal } from '@/store'
import { Ic } from './ui'

export const APP_VERSION = '2.0.0'

interface Note {
  icon: string
  title: string
  text: ReactNode
  wide?: boolean
  hue: number
}

const NOTES: Note[] = [
  {
    icon: '🎨',
    title: 'Themes for the whole app',
    text: (
      <>
        Make Bubbles yours: <b>Glass</b>, <b>Matrix</b>, <b>Sakura</b> and more. Open <b>Settings → Theme</b>.
      </>
    ),
    wide: true,
    hue: 280,
  },
  {
    icon: '✨',
    title: 'Send with effects',
    text: (
      <>
        Hold or right-click <b>send</b> for Slam, Invisible Ink, Echo, Confetti, Fireworks and more.
      </>
    ),
    hue: 320,
  },
  {
    icon: '🎤',
    title: 'Voice messages',
    text: (
      <>
        Tap the <b>mic</b> to record. Bubbles writes a transcript for you.
      </>
    ),
    hue: 190,
  },
  {
    icon: '📸',
    title: 'Camera & videos',
    text: (
      <>
        Snap photos or record videos right in the chat with the <b>camera</b> button.
      </>
    ),
    hue: 40,
  },
  { icon: '⚡', title: 'Rebuilt & faster', text: 'A brand-new engine. Opens quicker, scrolls smoother.', hue: 210 },
  { icon: '🛟', title: 'Messages never vanish', text: "If your browser's saved data breaks, Bubbles fixes itself. No more clearing cookies.", wide: true, hue: 150 },
]

function GlowCard({ note, i }: { note: Note; i: number }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <motion.div
      ref={ref}
      className={`wn-card ${note.wide ? 'wide' : ''}`}
      style={{ ['--h' as string]: note.hue }}
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.12 + i * 0.07, type: 'spring', stiffness: 260, damping: 24 }}
      onPointerMove={(e) => {
        const el = ref.current
        if (!el) return
        const r = el.getBoundingClientRect()
        el.style.setProperty('--mx', `${e.clientX - r.left}px`)
        el.style.setProperty('--my', `${e.clientY - r.top}px`)
      }}
    >
      <span className="wn-icon">{note.icon}</span>
      <b>{note.title}</b>
      <p>{note.text}</p>
    </motion.div>
  )
}

function WhatsNew() {
  return (
    <motion.div
      className="modal wn"
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
    >
      <div className="wn-hero">
        <div className="wn-aurora" aria-hidden />
        <button className="icon-btn sm wn-close" onClick={closeModal} aria-label="Close">
          <Ic name="x" />
        </button>
        <span className="wn-badge">v{APP_VERSION}</span>
        <h2 className="wn-title">What's new in Bubbles</h2>
        <p className="wn-sub">The biggest update yet, rebuilt from the ground up.</p>
      </div>
      <div className="wn-grid">
        {NOTES.map((n, i) => (
          <GlowCard key={n.title} note={n} i={i} />
        ))}
      </div>
      <div className="wn-foot">
        <button className="btn btn-primary wn-go" onClick={closeModal}>
          Let's go
        </button>
      </div>
    </motion.div>
  )
}

export const openPatchNotes = () => openModal(<WhatsNew />)

const SEEN_KEY = 'bubbles.seenVersion'
export function maybeShowPatchNotes() {
  let seen = ''
  try {
    seen = localStorage.getItem(SEEN_KEY) ?? ''
    localStorage.setItem(SEEN_KEY, APP_VERSION)
  } catch {
    /* private mode */
  }
  if (!get().me || seen === APP_VERSION) return
  if (!get().modal) openPatchNotes()
}
