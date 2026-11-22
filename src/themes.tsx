// App-wide themes (Discord/Vencord style). Each theme sets color tokens in
// styles/themes.css under :root[data-app-theme="<id>"] and can mount an animated
// background behind the whole app. Add a theme: one entry here + one CSS block.
import { lazy, Suspense, useEffect, type ComponentType } from 'react'

import { set, useStore } from './store'

export interface AppTheme {
  id: string
  name: string
  tagline: string
  /** Swatch shown in the picker. */
  preview: string
  /** Animated layer behind the app; absent for flat themes. */
  Background?: ComponentType
}

const MatrixBg = lazy(() =>
  import('./components/backgrounds/matrix-rain').then((m) => ({
    default: () => <m.MatrixRain className="absolute inset-0" background="#010a04" fontSize={18} density={0.85} speed={0.8} glow={6} />,
  })),
)
const AuroraBg = lazy(() => import('./components/backgrounds/aurora').then((m) => ({ default: () => <m.AuroraBackground /> })))
const SakuraBg = lazy(() => import('./components/backgrounds/sakura').then((m) => ({ default: m.SakuraScene })))

export const THEMES: AppTheme[] = [
  { id: 'default', name: 'Classic', tagline: 'The original iMessage look', preview: 'linear-gradient(135deg,#5ac8fa,#0a64ff)' },
  {
    id: 'glass',
    name: 'Glass',
    tagline: 'Frosted panels over a drifting aurora',
    preview: 'radial-gradient(circle at 20% 30%,#a855f7,transparent 60%),radial-gradient(circle at 80% 70%,#4f46e5,transparent 60%),#0b0820',
    Background: AuroraBg,
  },
  {
    id: 'matrix',
    name: 'Matrix',
    tagline: 'Green code rain that reacts to your cursor',
    preview: 'repeating-linear-gradient(90deg,#03140a 0 6px,#0a3a1a 6px 7px),#010a04',
    Background: MatrixBg,
  },
  {
    id: 'sakura',
    name: 'Sakura',
    tagline: 'Falling blossoms, a torii gate in ASCII',
    preview: 'radial-gradient(circle at 30% 30%,#eacdc2,transparent 55%),radial-gradient(circle at 75% 70%,#b75d69,transparent 60%),#1a1423',
    Background: SakuraBg,
  },
]

const KEY = 'bubbles.appTheme'
export const savedTheme = () => {
  try {
    return localStorage.getItem(KEY) ?? 'default'
  } catch {
    return 'default'
  }
}

export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]
  const root = document.documentElement
  try {
    localStorage.setItem(KEY, t.id)
  } catch {
    /* private mode */
  }
  if (t.id === 'default') {
    delete root.dataset.appTheme
    // Classic keeps the bubble color picked in Settings.
    let accent: string | null = null
    try {
      accent = localStorage.getItem('bubbles.accent')
    } catch {
      /* private mode */
    }
    if (accent) root.style.setProperty('--accent', accent)
  } else {
    root.dataset.appTheme = t.id
    // Each theme brings its own accent.
    root.style.removeProperty('--accent')
  }
  set({ appTheme: t.id })
}

export const themeHasBackdrop = (id: string) => !!THEMES.find((t) => t.id === id)?.Background

/** The animated layer behind the whole app. */
export function ThemeBackground() {
  const id = useStore((s) => s.appTheme)
  useEffect(() => {
    if (document.documentElement.dataset.appTheme !== (id === 'default' ? undefined : id)) applyTheme(id)
  }, [id])
  const Bg = THEMES.find((t) => t.id === id)?.Background
  if (!Bg) return null
  return (
    <div className="theme-bg" aria-hidden>
      <Suspense fallback={null}>
        <Bg />
      </Suspense>
    </div>
  )
}
