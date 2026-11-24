// Hold a conversation in the list to peek at it without opening it, so no read
// receipt is sent (like iMessage). Deliberately undocumented.
import { useCallback, useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'

import { chatTitle, nameOf } from '@/lib/select'
import type { Chat, Message } from '@/lib/types'
import { peekMessages } from '@/services/session'
import { get } from '@/store'
import { ChatAvatar } from './ui'

const HOLD_MS = 450

function line(m: Message) {
  if (m.deleted) return 'Unsent a message'
  if (m.text) return m.text
  if (m.sticker) return 'Sticker'
  const k = m.media?.kind
  if (k === 'audio') return m.transcript ? `🎤 ${m.transcript}` : '🎤 Voice message'
  if (k === 'video') return '🎬 Video'
  if (k === 'image' || m.image) return '📷 Photo'
  return '…'
}

function PeekCard({ c, onClose }: { c: Chat; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Message[] | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const me = get().uid
  useEffect(() => {
    peekMessages(c.id).then(setMsgs, () => setMsgs([]))
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [c.id, onClose])
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight
  }, [msgs])
  return createPortal(
    <div className="peek-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="peek-card" role="dialog" aria-label={`Preview of ${chatTitle(c)}`}>
        <a
          className="peek-head"
          href={`#/chat/${c.id}`}
          onClick={onClose}
        >
          <ChatAvatar c={c} size={30} withPresence={false} />
          <b>{chatTitle(c)}</b>
        </a>
        <div className="peek-body" ref={body}>
          {msgs === null ? (
            <span className="mk-spinner peek-spin" />
          ) : msgs.length === 0 ? (
            <p className="peek-empty">No messages yet</p>
          ) : (
            msgs.map((m) =>
              m.system ? (
                <p key={m.id} className="peek-sys">
                  {nameOf(m.senderId)} {m.text}
                </p>
              ) : (
                <div key={m.id} className={`peek-msg ${m.senderId === me ? 'mine' : 'theirs'}`}>
                  {c.type === 'group' && m.senderId !== me && <small>{nameOf(m.senderId)}</small>}
                  <span>{line(m)}</span>
                </div>
              ),
            )
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Props to spread on a chat row: a press held for HOLD_MS opens the peek and
 * swallows the click that follows, so the chat isn't opened.
 */
export function usePeek(c: Chat) {
  const [open, setOpen] = useState(false)
  const t = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const cancel = () => {
    clearTimeout(t.current)
    start.current = null
  }
  const bind = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      t.current = window.setTimeout(() => {
        fired.current = true
        navigator.vibrate?.(12)
        setOpen(true)
      }, HOLD_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
        fired.current = false
      }
    },
    // Stop the phone's own long-press menu from covering the peek.
    onContextMenuCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.preventDefault()
        e.stopPropagation()
      }
    },
  }
  const close = useCallback(() => setOpen(false), [])
  const card = open ? <PeekCard c={c} onClose={close} /> : null
  return { bind, card }
}
