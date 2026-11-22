import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

import { I, avatar as avatarHtml, formatText, logo } from '@/kit/util.js'
import { chatTitle, otherMember, presenceOf, user } from '@/lib/select'
import type { Chat, Presence, UserProfile } from '@/lib/types'
import { closeModal, get, useStore } from '@/store'

/** v1's Lucide icon strings, rendered as-is so the look matches exactly. */
export function Ic({ name, className }: { name: keyof typeof I | string; className?: string }) {
  return <span className={className ?? 'ic'} style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: (I as Record<string, string>)[name] ?? '' }} />
}

export const MOON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
export const Moon = () => <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: MOON_SVG }} />

export function Logo() {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: logo() }} />
}

export function Avatar({ u, size = 40, presence }: { u: Partial<UserProfile> & { id?: string }; size?: number; presence?: Presence | null }) {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: avatarHtml(u, size, (presence ?? null) as never) }} />
}

export function UserAvatar({ uid, size = 40, withPresence = false }: { uid: string; size?: number; withPresence?: boolean }) {
  useStore((s) => s.users[uid])
  useStore((s) => (withPresence ? s.tick : 0))
  return <Avatar u={user(uid)} size={size} presence={withPresence ? presenceOf(uid) : null} />
}

export function ChatAvatar({ c, size = 44, withPresence = true }: { c: Chat; size?: number; withPresence?: boolean }) {
  useStore((s) => s.users)
  if (c.type === 'dm') return <UserAvatar uid={otherMember(c)} size={size} withPresence={withPresence} />
  if (c.photoURL) return <Avatar u={{ id: c.id, displayName: chatTitle(c), photoURL: c.photoURL }} size={size} />
  const others = c.members.filter((m) => m !== get().uid).slice(0, 2)
  if (others.length < 2) return <Avatar u={{ id: c.id, displayName: chatTitle(c) }} size={size} />
  const s = Math.round(size * 0.68)
  return (
    <span className="avatar-stack" style={{ ['--s' as string]: `${size}px` }}>
      <Avatar u={user(others[0])} size={s} />
      <Avatar u={user(others[1])} size={s} />
    </span>
  )
}

/** Discord-flavoured markdown from v1 (escapes first, then formats). */
export function Rich({ text }: { text: string }) {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: formatText(text) }} />
}

// ============================================================================
// Popovers & menus (one open at a time, positioned like v1)
// ============================================================================
type Place = 'top' | 'bottom' | 'right' | 'point'
interface PopState {
  node: ReactNode | null
  anchor: DOMRect | null
  at: { x: number; y: number } | null
  place: Place
  cls: string
}
export const usePop = create<PopState>(() => ({ node: null, anchor: null, at: null, place: 'top', cls: '' }))

export function openPopover(node: ReactNode, anchor: Element | null, opts: { place?: Place; cls?: string; at?: { x: number; y: number } } = {}) {
  usePop.setState({
    node,
    anchor: anchor?.getBoundingClientRect() ?? null,
    at: opts.at ?? null,
    place: opts.place ?? 'top',
    cls: opts.cls ?? '',
  })
}
export const closePopover = () => usePop.setState({ node: null })
export const isPopoverOpen = (cls: string) => !!usePop.getState().node && usePop.getState().cls.includes(cls)

export interface MenuItem {
  id: string
  label: ReactNode
  icon?: ReactNode
  danger?: boolean
  run: () => void
}
export function openMenu(items: (MenuItem | '-' | false | null | undefined)[], anchor: Element | null, opts: { place?: Place; cls?: string; at?: { x: number; y: number } } = {}) {
  openPopover(
    <>
      {items.filter(Boolean).map((it, i) =>
        it === '-' ? (
          <hr key={`hr${i}`} />
        ) : (
          <button
            key={(it as MenuItem).id}
            className={`menu-item ${(it as MenuItem).danger ? 'danger' : ''}`}
            onClick={() => {
              closePopover()
              ;(it as MenuItem).run()
            }}
          >
            {(it as MenuItem).icon}
            <span>{(it as MenuItem).label}</span>
          </button>
        ),
      )}
    </>,
    anchor,
    { cls: `menu ${opts.cls ?? ''}`, place: opts.place, at: opts.at },
  )
}

export function PopoverHost() {
  const { node, anchor, at, place, cls } = usePop()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !node) return setPos(null)
    const r = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y, width: 0, height: 0 } : anchor
    if (!r) return setPos({ left: innerWidth / 2 - el.offsetWidth / 2, top: innerHeight / 2 - el.offsetHeight / 2 })
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x: number
    let y: number
    if (place === 'right') {
      x = r.right + 8
      y = r.top
    } else if (place === 'point') {
      x = r.left
      y = r.top
    } else {
      x = r.left + r.width / 2 - w / 2
      y = place === 'bottom' ? r.bottom + 8 : r.top - h - 8
      if (y < 8) y = r.bottom + 8
    }
    setPos({ left: Math.max(8, Math.min(x, innerWidth - w - 8)), top: Math.max(8, Math.min(y, innerHeight - h - 8)) })
  }, [node, anchor, at, place])

  useEffect(() => {
    if (!node) return
    const down = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      if ((e.target as Element).closest?.('[data-keep-pop]')) return
      closePopover()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closePopover()
    let lastWidth = innerWidth
    const resize = () => {
      if (innerWidth !== lastWidth) closePopover()
      lastWidth = innerWidth
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', resize)
    }
  }, [node])

  if (!node) return null
  return createPortal(
    <div id="menuRoot">
      <div ref={ref} className={`popover ${cls}`} style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}>
        {node}
      </div>
    </div>,
    document.body,
  )
}

// ============================================================================
// Modal & toasts
// ============================================================================
export function ModalHost() {
  const modal = useStore((s) => s.modal)
  useEffect(() => {
    if (!modal) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !usePop.getState().node && closeModal()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [modal])
  if (!modal) return null
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      {modal}
    </div>,
    document.body,
  )
}

export function Modal({ cls = '', title, children, foot }: { cls?: string; title?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className={`modal ${cls}`} role="dialog" aria-modal="true">
      {title !== undefined && (
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn sm" onClick={closeModal}>
            <Ic name="x" />
          </button>
        </header>
      )}
      {children}
      {foot && <footer className="modal-foot">{foot}</footer>}
    </div>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return createPortal(
    <div className="toast-root" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </div>,
    document.body,
  )
}

function ToastItem({ text, kind, chatId, title, senderId }: ReturnType<typeof useStore.getState>['toasts'][number]) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(r)
  }, [])
  return (
    <div className={`toast ${kind} ${shown ? 'in' : ''}`}>
      {kind === 'banner' && chatId ? (
        <button className="toast-msg" style={{ pointerEvents: 'auto' }} onClick={() => (location.hash = `#/chat/${chatId}`)}>
          {senderId && <UserAvatar uid={senderId} size={36} />}
          <span>
            <b>{title}</b>
            <small>{text}</small>
          </span>
        </button>
      ) : (
        text
      )}
    </div>
  )
}
