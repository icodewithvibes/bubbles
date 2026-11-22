// App-wide themes (Discord/Vencord style). Each theme sets color tokens in
// styles/themes.css under :root[data-app-theme="<id>"] and can mount an animated
// background behind the whole app. Add a theme: one entry here + one CSS block.
import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import type * as React from 'react'

import { set, useStore } from './store'

export interface AppTheme {
  id: string
  name: string
  tagline: string
  /** Swatch shown in the picker. */
  preview: string
  /** Animated layer behind the app; absent for flat themes. */
  Background?: ComponentType
  /** Decorative layer above the app (clicks pass through), e.g. falling petals. */
  Overlay?: ComponentType
  /** Color washed over a chat's own background photo so it matches the theme. */
  tint?: string
  /** Light effects drawn over that photo (bubbles, snow…) so the theme isn't lost. */
  Particles?: ComponentType
}

// Crisp rain: small glow and a shorter trail so characters stay sharp instead of smearing.
const MatrixBg = lazy(() =>
  import('./components/backgrounds/matrix-rain').then((m) => ({
    default: () => <m.MatrixRain className="absolute inset-0" background="#010a04" fontSize={17} density={0.72} speed={0.75} glow={2.5} trail={0.78} />,
  })),
)
const AuroraBg = lazy(() => import('./components/backgrounds/aurora').then((m) => ({ default: () => <m.AuroraBackground /> })))
const SakuraBg = lazy(() => import('./components/backgrounds/sakura').then((m) => ({ default: m.SakuraScene })))
const SakuraFx = lazy(() => import('./components/backgrounds/sakura').then((m) => ({ default: m.SakuraPetals })))
const SynthwaveBg = lazy(() => import('./components/backgrounds/synthwave').then((m) => ({ default: () => <m.Synthwave /> })))
const GalaxyBg = lazy(() => import('./components/backgrounds/galaxy').then((m) => ({ default: m.Galaxy })))
const DeepSeaBg = lazy(() => import('./components/backgrounds/deepsea').then((m) => ({ default: m.DeepSea })))
const LavaBg = lazy(() => import('./components/backgrounds/ambient').then((m) => ({ default: m.LavaLamp })))
const RainBg = lazy(() => import('./components/backgrounds/ambient').then((m) => ({ default: m.MidnightRain })))
const WinterBg = lazy(() => import('./components/backgrounds/ambient').then((m) => ({ default: m.Winter })))
const CrtBg = lazy(() => import('./components/backgrounds/ambient').then((m) => ({ default: m.RetroCRT })))

// Particle layers for chats that have their own background photo.
const amb = () => import('./components/backgrounds/ambient')
const motes = (props: { colors: string[]; drift?: 'up' | 'down' | 'still'; glyphs?: string; count?: number }) =>
  lazy(() => amb().then((m) => ({ default: () => <m.Motes {...props} /> })))
const SnowFx = lazy(() => amb().then((m) => ({ default: m.Snow })))
const RainFx = lazy(() => amb().then((m) => ({ default: m.RainFall })))
const ScanFx = lazy(() => amb().then((m) => ({ default: m.Scanlines })))
const BubblesFx = lazy(() => import('./components/backgrounds/deepsea').then((m) => ({ default: m.RisingBubbles })))

export const THEMES: AppTheme[] = [
  { id: 'default', name: 'Classic', tagline: 'The original iMessage look', preview: 'linear-gradient(135deg,#5ac8fa,#0a64ff)' },
  {
    id: 'glass',
    tint: '#7c3aed',
    Particles: motes({ colors: ['#c4b5fd', '#a5b4fc', '#f0abfc'], drift: 'up', count: 40 }),
    name: 'Glass',
    tagline: 'Frosted panels over a drifting aurora',
    preview: 'radial-gradient(circle at 20% 30%,#a855f7,transparent 60%),radial-gradient(circle at 80% 70%,#4f46e5,transparent 60%),#0b0820',
    Background: AuroraBg,
  },
  {
    id: 'matrix',
    tint: '#00c853',
    Particles: motes({ colors: ['#39ff88', '#00e676'], drift: 'down', glyphs: 'ｱｲｳｴｵｶｷｸｹｺ01<>{}', count: 70 }),
    name: 'Matrix',
    tagline: 'Green code rain that reacts to your cursor',
    preview: 'repeating-linear-gradient(90deg,#03140a 0 6px,#0a3a1a 6px 7px),#010a04',
    Background: MatrixBg,
  },
  {
    id: 'sakura',
    tint: '#ff8fb1',
    name: 'Sakura',
    tagline: 'Falling petals, Mt. Fuji and blossoms in ASCII',
    preview: 'radial-gradient(circle at 30% 30%,#eacdc2,transparent 55%),radial-gradient(circle at 75% 70%,#b75d69,transparent 60%),#1a1423',
    Background: SakuraBg,
    Overlay: SakuraFx,
  },
  {
    id: 'synthwave',
    tint: '#ff2bd6',
    Particles: motes({ colors: ['#ff2bd6', '#22d3ee', '#ffb347'], drift: 'up', count: 50 }),
    name: 'Synthwave',
    tagline: 'Neon grid racing toward an 80s sunset',
    preview: 'linear-gradient(180deg,#0b0221 0%,#6a1265 45%,#ff8c42 52%,#1a0633 53%),repeating-linear-gradient(90deg,transparent 0 14px,#ff2bd6 14px 15px)',
    Background: SynthwaveBg,
  },
  {
    id: 'deepsea',
    tint: '#0284c7',
    Particles: BubblesFx,
    name: 'Deep Sea',
    tagline: 'Rising bubbles under shimmering light',
    preview: 'radial-gradient(circle at 30% 70%,#9fe8ff 0 3px,transparent 4px),radial-gradient(circle at 70% 40%,#9fe8ff 0 5px,transparent 6px),linear-gradient(180deg,#0b4f74,#031c2e)',
    Background: DeepSeaBg,
  },
  {
    id: 'galaxy',
    tint: '#5b21b6',
    Particles: motes({ colors: ['#ffffff', '#cdb4ff', '#bfdbfe'], drift: 'still', count: 90 }),
    name: 'Galaxy',
    tagline: 'Constellations that swirl around your cursor',
    preview: 'radial-gradient(circle at 20% 30%,#fff 0 1px,transparent 2px),radial-gradient(circle at 60% 60%,#fff 0 1px,transparent 2px),radial-gradient(circle at 80% 20%,#cdb4ff 0 1.5px,transparent 2.5px),radial-gradient(ellipse at 30% 40%,#2b1055,transparent 60%),#05040f',
    Background: GalaxyBg,
  },
  {
    id: 'lava',
    tint: '#ff5a1f',
    Particles: motes({ colors: ['#ffb347', '#ff7a18', '#ff2d75'], drift: 'up', count: 45 }),
    name: 'Lava Lamp',
    tagline: 'Gooey blobs melting into each other',
    preview: 'radial-gradient(circle at 35% 70%,#ff7a18 0 18%,transparent 19%),radial-gradient(circle at 65% 35%,#ff2d75 0 14%,transparent 15%),linear-gradient(180deg,#2a0a2e,#150016)',
    Background: LavaBg,
  },
  {
    id: 'rain',
    tint: '#3b4fa0',
    Particles: RainFx,
    name: 'Midnight Rain',
    tagline: 'Rain on the window, city lights behind',
    preview: 'radial-gradient(circle at 25% 70%,#ffb34766 0 10%,transparent 11%),radial-gradient(circle at 70% 60%,#6ec3ff55 0 12%,transparent 13%),repeating-linear-gradient(100deg,transparent 0 9px,#b4c8ff30 9px 10px),#0d1430',
    Background: RainBg,
  },
  {
    id: 'winter',
    tint: '#38bdf8',
    Particles: SnowFx,
    name: 'Winter',
    tagline: 'Snowfall under the northern lights',
    preview: 'radial-gradient(circle at 20% 60%,#fff 0 1.5px,transparent 2px),radial-gradient(circle at 70% 75%,#fff 0 2px,transparent 2.5px),linear-gradient(170deg,#0b1a3a 30%,#2de2a6 50%,#7b5cff 62%,#0b1a3a 80%)',
    Background: WinterBg,
  },
  {
    id: 'crt',
    tint: '#ffb000',
    Particles: ScanFx,
    name: 'Retro CRT',
    tagline: 'Amber phosphor terminal from 1987',
    preview: 'repeating-linear-gradient(0deg,#00000055 0 2px,transparent 2px 4px),radial-gradient(ellipse,#3a2400,#120a00)',
    Background: CrtBg,
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
  const theme = THEMES.find((t) => t.id === id)
  const Bg = theme?.Background
  const Fx = theme?.Overlay
  if (!Bg && !Fx) return null
  return (
    <>
      {Bg && (
        <div className="theme-bg" aria-hidden>
          <Suspense fallback={null}>
            <Bg />
          </Suspense>
        </div>
      )}
      {Fx && (
        <div className="theme-overlay" aria-hidden>
          <Suspense fallback={null}>
            <Fx />
          </Suspense>
        </div>
      )}
    </>
  )
}

/**
 * A chat's own background photo under a theme: the photo, a wash of the theme's
 * color, then the theme's light effects, all beneath the messages.
 */
export function WallLayers({ wall }: { wall: string }) {
  const id = useStore((s) => s.appTheme)
  const theme = THEMES.find((t) => t.id === id)
  const Fx = theme?.Particles
  return (
    <div className="wall-layers" style={{ '--tint': theme?.tint ?? 'transparent' } as React.CSSProperties} aria-hidden>
      <div className="wall-photo" style={{ backgroundImage: `url("${wall}")` }} />
      <div className="wall-tint" />
      <div className="wall-shade" />
      {Fx && (
        <div className="wall-fx">
          <Suspense fallback={null}>
            <Fx />
          </Suspense>
        </div>
      )}
    </div>
  )
}
