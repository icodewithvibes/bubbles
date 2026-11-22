import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { startCall } from '@/kit/call.js'
import { compressImage, fmtListTime, fmtStamp, isEmojiOnly, ms } from '@/kit/util.js'
import {
  byName,
  chatTitle,
  dndActive,
  firstName,
  isGif,
  isMuted,
  nameOf,
  otherMember,
  presenceOf,
  presenceText,
  typers,
  user,
} from '@/lib/select'
import type { Chat, Message } from '@/lib/types'
import {
  editMessage,
  leaveGroup,
  backToLatest,
  loadNewer,
  loadOlder,
  maybeMarkRead,
  noteTyping,
  postMessage,
  renameGroup,
  setNearBottomProbe,
  setWallpaper,
  stopTyping,
  toggleMute,
  toggleReaction,
  unsend,
} from '@/services/session'
import { get, openModal, closeModal, set, toast, useStore } from '@/store'
import { openAddPeople, openLightbox, openProfile } from './Dialogs'
import { themeHasBackdrop, WallLayers } from '@/themes'
import { EffectPicker, effectLabel, fxSeen, isBubbleEffect, isScreenEffect, markFxSeen, playScreenEffect, type EffectId } from './Effects'
import { CameraButton, MediaContent, MicButton, UploadBar, sendFiles } from './Media'
import { openEmojiPicker, openGifPicker } from './Pickers'
import { SearchPanel, TimeTravelOverlay } from './Search'
import { openStickerPicker, stickerUrl } from './Stickers'
import { ChatAvatar, Ic, Logo, Modal, Moon, Rich, UserAvatar, closePopover, isPopoverOpen, openMenu, openPopover } from './ui'

const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓']
const MORE_REACTIONS = ['🔥', '😮', '😢', '🎉', '💀', '🙏']
const GROUP_GAP = 5 * 60e3
const STAMP_GAP = 15 * 60e3

const Html = ({ html }: { html: string }) => <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />

// ============================================================================
// Sending helpers
// ============================================================================
export function sendGif(url: string) {
  const c = get().chats[get().msgChatId ?? '']
  if (!c) return
  void postMessage(c, { image: url, replyTo: get().replyTo })
  set({ replyTo: null })
}

export function sendSticker(url: string) {
  const c = get().chats[get().msgChatId ?? '']
  if (!c) return
  void postMessage(c, { sticker: url, replyTo: get().replyTo })
  set({ replyTo: null })
}

function startEdit(m: Message) {
  set({ editing: m, replyTo: null })
  composerApi.setText(m.text)
}
function startReply(m: Message) {
  set({ replyTo: { id: m.id, senderId: m.senderId, text: (m.text || '').slice(0, 140) }, editing: null })
  composerApi.focus()
}

// The composer exposes a tiny imperative API so menus can fill it.
const composerApi = {
  setText: (_t: string) => {},
  focus: () => {},
  insert: (_t: string) => {},
}

function replayEffect(m: Message) {
  if (isScreenEffect(m.effect)) playScreenEffect(m.effect!, m.text || effectLabel(m.effect), m.id)
  else window.dispatchEvent(new CustomEvent('bubbles:replay', { detail: m.id }))
}

// ============================================================================
// Tapbacks & message menu
// ============================================================================
function openTapback(m: Message, anchor: Element) {
  const current = m.reactions?.[get().uid ?? '']
  openPopover(
    <>
      {[...TAPBACKS, ...MORE_REACTIONS].map((e, i) => (
        <button
          key={e}
          className={`tp ${current === e ? 'on' : ''} ${i >= TAPBACKS.length ? 'extra' : ''}`}
          onClick={() => {
            closePopover()
            toggleReaction(m, e)
          }}
        >
          {e}
        </button>
      ))}
      <button
        className="tp tp-more"
        title="More emoji"
        onClick={() =>
          openEmojiPicker(anchor, (e) => {
            closePopover()
            toggleReaction(m, e)
          })
        }
      >
        <Ic name="plus" />
      </button>
    </>,
    anchor,
    { cls: 'tapback-picker' },
  )
}

function openMsgMenu(m: Message, anchor: Element, at?: { x: number; y: number }) {
  const mine = m.senderId === get().uid
  const content = document.querySelector(`#m-${CSS.escape(m.id)} .msg-content`) ?? anchor
  openMenu(
    [
      { id: 'react', label: 'Add Reaction', icon: <Ic name="smile" />, run: () => setTimeout(() => openTapback(m, content), 0) },
      { id: 'reply', label: 'Reply', icon: <Ic name="reply" />, run: () => startReply(m) },
      mine && !m.image && !m.media && !m.sticker && { id: 'edit', label: 'Edit', icon: <Ic name="pencil" />, run: () => startEdit(m) },
      !!m.effect && m.effect !== 'invisible' && { id: 'replay', label: `Replay ${effectLabel(m.effect)}`, icon: <span>✨</span>, run: () => replayEffect(m) },
      !!m.text && { id: 'copy', label: 'Copy Text', icon: <Ic name="copy" />, run: () => void navigator.clipboard.writeText(m.text).then(() => toast('Copied')) },
      mine && '-',
      mine && { id: 'unsend', label: 'Unsend', icon: <Ic name="trash" />, danger: true, run: () => unsend(m) },
    ],
    anchor,
    at ? { place: 'point', at } : { place: 'bottom' },
  )
}

// ============================================================================
// Rows
// ============================================================================
const MessageRow = memo(function MessageRow({ m, mine, start, end, group, uid }: { m: Message; mine: boolean; start: boolean; end: boolean; group: boolean; uid: string }) {
  const bubbleFx = isBubbleEffect(m.effect) ? m.effect : undefined
  // Bubble effects play once per device, the first time the message shows up.
  const [play, setPlay] = useState(() => !!bubbleFx && bubbleFx !== 'invisible' && !fxSeen(m.id))
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (!m.effect || m.pending) return
    if (!isScreenEffect(m.effect)) {
      const t = setTimeout(() => {
        markFxSeen(m.id)
        setPlay(false)
      }, 2600)
      return () => clearTimeout(t)
    }
  }, [m.effect, m.id, m.pending])
  useEffect(() => {
    const replay = (e: Event) => {
      if ((e as CustomEvent).detail !== m.id) return
      setPlay(false)
      requestAnimationFrame(() => setPlay(true))
      setTimeout(() => setPlay(false), 2600)
    }
    window.addEventListener('bubbles:replay', replay)
    return () => window.removeEventListener('bubbles:replay', replay)
  }, [m.id])
  const fxClass = bubbleFx ? `fx-${bubbleFx} ${play ? 'fx-play' : ''} ${revealed ? 'revealed' : ''}` : ''
  const jumbo = !m.image && !m.media && !m.sticker && isEmojiOnly(m.text)
  const reactions = Object.entries(m.reactions ?? {})
  const grouped: Record<string, string[]> = {}
  reactions.forEach(([u, e]) => (grouped[e] ||= []).push(u))
  const showAvatar = group && !mine
  return (
    <div
      className={`msg ${mine ? 'mine' : 'theirs'} ${start ? 'start' : ''} ${end ? 'end' : ''} ${m.pending ? 'pending' : ''} ${reactions.length ? 'has-tb' : ''}`}
      id={`m-${m.id}`}
      onContextMenu={(e) => {
        if ((e.target as Element).closest('a')) return
        e.preventDefault()
        openMsgMenu(m, e.currentTarget, { x: e.clientX, y: e.clientY })
      }}
    >
      {showAvatar && (
        <div className="msg-av">
          {end && (
            <button onClick={(e) => openProfile(m.senderId, e.currentTarget)}>
              <UserAvatar uid={m.senderId} size={28} />
            </button>
          )}
        </div>
      )}
      <div className="msg-col">
        {group && !mine && start && <div className="msg-name">{nameOf(m.senderId)}</div>}
        {m.replyTo && (
          <button
            className="reply-ref"
            onClick={() => {
              const t = document.getElementById(`m-${m.replyTo!.id}`)
              if (!t) return toast('That message is further back')
              t.scrollIntoView({ block: 'center', behavior: 'smooth' })
              t.classList.add('flash')
              setTimeout(() => t.classList.remove('flash'), 1400)
            }}
          >
            <span className="reply-line" />
            <b>{nameOf(m.replyTo.senderId)}</b> {m.replyTo.text || '📷 Photo'}
          </button>
        )}
        <div
          className={`msg-content ${jumbo ? 'is-jumbo' : ''}`}
          onDoubleClick={(e) => {
            if ((e.target as Element).closest('a, button')) return
            window.getSelection()?.removeAllRanges()
            openTapback(m, e.currentTarget)
          }}
          onClick={(e) => {
            const sp = (e.target as Element).closest('.spoiler')
            if (sp) sp.classList.add('shown')
          }}
        >
          {m.sticker ? (
            <img className={`sticker-img ${fxClass}`} src={stickerUrl(m.sticker)} alt="Sticker" draggable={false} />
          ) : m.image ? (
            <>
              <img className="msg-img" src={m.image} alt={isGif(m.image) ? 'GIF' : 'Photo'} onClick={() => openLightbox(m.image!)} />
              {m.text && (
                <div className="bubble">
                  <Rich text={m.text} />
                </div>
              )}
            </>
          ) : m.media ? (
            <MediaContent m={m} fxClass={fxClass} />
          ) : (
            <div
              className={`bubble ${jumbo ? 'jumbo' : ''} ${fxClass}`}
              onMouseEnter={() => bubbleFx === 'invisible' && setRevealed(true)}
              onMouseLeave={() => bubbleFx === 'invisible' && setRevealed(false)}
              onClick={() => bubbleFx === 'invisible' && setRevealed((r) => !r)}
            >
              {jumbo ? m.text : <Rich text={m.text} />}
            </div>
          )}
          {reactions.length > 0 && (
            <div className="tapbacks">
              {Object.entries(grouped).map(([e, uids]) => (
                <button key={e} className={`tb ${uids.includes(uid) ? 'mine' : ''}`} title={uids.map(nameOf).join(', ')} onClick={() => toggleReaction(m, e)}>
                  {e}
                  {uids.length > 1 && <small>{uids.length}</small>}
                </button>
              ))}
            </div>
          )}
          <div className="msg-tools">
            <button data-keep-pop title="React" onClick={(e) => openTapback(m, e.currentTarget.closest('.msg-content')!)}>
              <Ic name="smile" />
            </button>
            <button title="Reply" onClick={() => startReply(m)}>
              <Ic name="reply" />
            </button>
            {mine && !m.image && !m.media && !m.sticker && (
              <button title="Edit" onClick={() => startEdit(m)}>
                <Ic name="pencil" />
              </button>
            )}
            <button data-keep-pop title="More" onClick={(e) => openMsgMenu(m, e.currentTarget)}>
              <Ic name="more" />
            </button>
          </div>
        </div>
        {m.effect && (
          <div className="fx-tag">
            <span>Sent with {effectLabel(m.effect)}</span>
            {m.effect !== 'invisible' && (
              <button onClick={() => replayEffect(m)} title="Replay">
                Replay
              </button>
            )}
          </div>
        )}
        {m.edited && <div className="edited">Edited</div>}
        {m.urgent && (
          <div className="edited">
            <Moon /> Notified anyway
          </div>
        )}
      </div>
    </div>
  )
})

function receiptText(c: Chat, m: Message): ReactNode {
  if (m.pending) return 'Sending…'
  const uid = get().uid
  const t = ms(m.createdAt)
  const readers = c.members.filter((u) => u !== uid && ms(c.lastRead?.[u]) >= t)
  if (c.type === 'dm')
    return readers.length ? (
      <>
        <b>Read</b> {fmtListTime(ms(c.lastRead![readers[0]]))}
      </>
    ) : (
      <b>Delivered</b>
    )
  if (!readers.length) return <b>Delivered</b>
  if (readers.length === c.members.length - 1) return <b>Read by everyone</b>
  return (
    <>
      <b>Read by</b> {readers.map(firstName).join(', ')}
    </>
  )
}

function Rows({ c }: { c: Chat }) {
  const msgs = useStore((s) => s.msgs)
  const uid = useStore((s) => s.uid)!
  useStore((s) => s.users)
  const group = c.type === 'group'
  let lastMineIdx = -1
  msgs.forEach((m, i) => {
    if (m.senderId === uid && !m.system && !m.deleted) lastMineIdx = i
  })
  // Read receipts sit under your newest message, as long as nobody has replied since.
  const showReceiptAt = lastMineIdx !== -1 && msgs.slice(lastMineIdx + 1).every((m) => m.system || m.senderId === uid) ? lastMineIdx : -1
  const out: ReactNode[] = []
  msgs.forEach((m, i) => {
    const t = ms(m.createdAt) || Date.now()
    const prev = msgs[i - 1]
    const next = msgs[i + 1]
    const pt = prev ? ms(prev.createdAt) : 0
    const nt = next ? ms(next.createdAt) : 0
    const stamp = !prev || t - pt > STAMP_GAP
    if (stamp)
      out.push(
        <div key={`t-${m.id}`} className="stamp">
          <Html html={fmtStamp(t)} />
        </div>,
      )
    if (m.system || m.deleted) {
      out.push(
        <div key={m.id} className="sys-msg" id={`m-${m.id}`}>
          <b>{nameOf(m.senderId)}</b> {m.deleted ? 'unsent a message' : m.text}
        </div>,
      )
      return
    }
    const joins = (a: Message | undefined, b: Message, dt: number) => !!a && !a.system && !a.deleted && a.senderId === b.senderId && dt < GROUP_GAP
    const start = stamp || !joins(prev, m, t - pt)
    const end = !next || !joins(next, m, nt - t) || nt - t > STAMP_GAP
    out.push(<MessageRow key={m.id} m={m} mine={m.senderId === uid} start={start} end={end} group={group} uid={uid} />)
    if (i === showReceiptAt)
      out.push(
        <div key="receipt" className="receipt">
          {receiptText(c, m)}
        </div>,
      )
  })
  return <>{out}</>
}

function Typing({ c }: { c: Chat }) {
  useStore((s) => s.tick)
  const who = typers(c)
  if (!who.length) return <div className="typing-row" />
  return (
    <div className="typing-row">
      {c.type === 'group' && (
        <div className="msg-av">
          <UserAvatar uid={who[0]} size={28} />
        </div>
      )}
      <div className="typing-bubble">
        <b />
        <b />
        <b />
      </div>
      {c.type === 'group' && <span className="typing-who">{who.map(firstName).join(', ')}</span>}
    </div>
  )
}

// ============================================================================
// Message scroller: stick to bottom, load older, jump button
// ============================================================================
function Messages({ c }: { c: Chat }) {
  const msgs = useStore((s) => s.msgs)
  const hasMore = useStore((s) => s.hasMore)
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const first = useRef(true)
  const older = useRef<{ h: number; top: number } | null>(null)
  const lastKey = useRef<string | undefined>(undefined)
  const [jump, setJump] = useState(false)
  const history = useStore((s) => s.history)
  const jumpTarget = useStore((s) => s.jumpTarget)
  // Scrolled a screen or more up from the newest message: offer time travel.
  const [scrolledUp, setScrolledUp] = useState(false)

  const near = useCallback((px = 120) => {
    const el = ref.current
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < px
  }, [])
  const toBottom = () => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Screen effects play once per device, for the newest unseen one (like iMessage
  // when you open the conversation or it arrives while you're in it).
  useEffect(() => {
    const m = [...msgs].reverse().find((x) => isScreenEffect(x.effect) && !x.deleted)
    if (!m || fxSeen(m.id) || document.visibilityState !== 'visible') return
    markFxSeen(m.id)
    const t = setTimeout(() => playScreenEffect(m.effect!, m.text || effectLabel(m.effect), m.id), 150)
    return () => clearTimeout(t)
  }, [msgs])

  useEffect(() => {
    setNearBottomProbe(() => near(250))
    first.current = true
    lastKey.current = undefined
  }, [c.id, near])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const newLast = msgs.at(-1)?.id
    const target = jumpTarget && document.getElementById(`m-${jumpTarget}`)
    if (target) {
      // Search result / date jump: center it and flash it, like iMessage.
      target.scrollIntoView({ block: 'center' })
      target.classList.remove('flash')
      void target.offsetWidth
      target.classList.add('flash')
      setTimeout(() => target.classList.remove('flash'), 1800)
      set({ jumpTarget: null })
      older.current = null
      setJump(false)
    } else if (older.current) {
      el.scrollTop = el.scrollHeight - older.current.h + older.current.top
      older.current = null
    } else {
      const mineJustSent = msgs.at(-1)?.senderId === get().uid && newLast !== lastKey.current
      // In history mode new pages append below; never yank the view to the bottom.
      if (!history && (first.current || stick.current || mineJustSent)) toBottom()
      else if (!history && newLast !== lastKey.current && lastKey.current) setJump(true)
    }
    if (msgs.length) first.current = false
    lastKey.current = newLast
    stick.current = near()
  }, [msgs, near, jumpTarget, history])

  return (
    <div className="chat-body">
      <div
        id="msgs"
        className="msgs"
        ref={ref}
        onScroll={() => {
          const el = ref.current!
          stick.current = near()
          if (stick.current) setJump(false)
          if (el.scrollTop < 300 && hasMore && !older.current) {
            older.current = { h: el.scrollHeight, top: el.scrollTop }
            loadOlder()
          }
          // Viewing older messages: keep loading newer ones as you scroll down.
          if (history && near(500)) void loadNewer()
          const up = el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight * 1.1
          if (up !== scrolledUp) setScrolledUp(up)
          maybeMarkRead()
          if (isPopoverOpen('tapback-picker')) closePopover()
        }}
        onLoadCapture={() => stick.current && toBottom()}
      >
        <div className="msgs-top">
          {hasMore ? (
            <div className="loading-older">Loading earlier messages…</div>
          ) : (
            <div className="convo-intro">
              <ChatAvatar c={c} size={72} withPresence={false} />
              <h2>{chatTitle(c)}</h2>
              <p>
                {c.type === 'dm' ? (
                  <>
                    This is the beginning of your conversation with <b>{user(otherMember(c)).displayName}</b>.
                  </>
                ) : (
                  `This is the start of the group. ${c.members.length} people are here.`
                )}
              </p>
            </div>
          )}
        </div>
        <div className="msg-list">
          <Rows c={c} />
        </div>
        <Typing c={c} />
      </div>
      <TimeTravelOverlay c={c} show={scrolledUp || history} />
      {history ? (
        <button className="jump history-jump" onClick={() => backToLatest()}>
          <Ic name="down" /> Jump to latest
        </button>
      ) : (
        jump && (
          <button
            className="jump"
            onClick={() => {
              toBottom()
              setJump(false)
            }}
          >
            <Ic name="down" /> New messages
          </button>
        )
      )}
    </div>
  )
}

// ============================================================================
// Header, DND notice, composer
// ============================================================================
function ChatHead({ c }: { c: Chat }) {
  const detailsOpen = useStore((s) => s.detailsOpen)
  const searchOpen = useStore((s) => s.searchOpen)
  const searchMode = useStore((s) => s.searchMode)
  useStore((s) => s.tick)
  useStore((s) => s.users)
  const dm = c.type === 'dm'
  const other = otherMember(c)
  const dnd = dm && presenceOf(other) === 'dnd'
  return (
    <header className="chat-head">
      <a className="icon-btn back" href="#/">
        <Ic name="back" />
      </a>
      <button className="ch-who" onClick={() => set({ detailsOpen: !detailsOpen })}>
        <ChatAvatar c={c} size={36} />
        <span className="ch-name">
          {chatTitle(c)}
          <span className="ch-chev">
            <Ic name="chevron" />
          </span>
        </span>
        <span className={`ch-sub ${dnd ? 'dnd' : ''}`}>
          {dnd && (
            <>
              <Moon />{' '}
            </>
          )}
          {dm ? presenceText(other) : `${c.members.length} people`}
        </span>
      </button>
      <span className="ch-actions">
        {dm && (
          <button className="icon-btn ch-call" title="Video call" onClick={() => startCall(c.id, other)}>
            <Ic name="video" />
          </button>
        )}
        <button
          className={`icon-btn ch-search ${searchOpen && searchMode === 'time' ? 'on' : ''}`}
          title="Go back in time: first messages, a date, or a week"
          aria-label="Go back in time"
          onClick={() => set({ searchOpen: !(searchOpen && searchMode === 'time'), searchMode: 'time', detailsOpen: false })}
        >
          <Ic name="history" />
        </button>
        <button
          className={`icon-btn ch-search ${searchOpen && searchMode === 'search' ? 'on' : ''}`}
          title="Search messages (Ctrl+F)"
          aria-label="Search messages"
          onClick={() => set({ searchOpen: !(searchOpen && searchMode === 'search'), searchMode: 'search', detailsOpen: false })}
        >
          <Ic name="search" />
        </button>
        <button className={`icon-btn ch-info ${detailsOpen ? 'on' : ''}`} title="Details" onClick={() => set({ detailsOpen: !detailsOpen, searchOpen: false })}>
          <Ic name="info" />
        </button>
      </span>
    </header>
  )
}

function DndNotice({ c }: { c: Chat }) {
  const urgentNext = useStore((s) => s.urgentNext)
  useStore((s) => s.users)
  const uid = get().uid
  const silenced = c.members.filter((m) => m !== uid && dndActive(get().users[m]))
  useEffect(() => {
    if (!silenced.length && get().urgentNext) set({ urgentNext: false })
  })
  if (!silenced.length) return null
  const who = c.type === 'dm' ? user(silenced[0]).displayName : silenced.length === 1 ? user(silenced[0]).displayName : `${silenced.length} people`
  return (
    <div className="dnd-notice">
      <Moon />
      <span>
        <b>{who}</b> {silenced.length === 1 ? 'has' : 'have'} notifications silenced
      </span>
      {urgentNext ? (
        <>
          <span className="urgent-on">Your next message will notify anyway</span>
          <button className="link" onClick={() => set({ urgentNext: false })}>
            Cancel
          </button>
        </>
      ) : (
        <button
          className="link"
          onClick={() => {
            set({ urgentNext: true })
            composerApi.focus()
          }}
        >
          Notify Anyway
        </button>
      )}
    </div>
  )
}

function Composer({ c }: { c: Chat }) {
  const editing = useStore((s) => s.editing)
  const replyTo = useStore((s) => s.replyTo)
  const [text, setText] = useState('')
  const ta = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const dm = c.type === 'dm'

  useEffect(() => {
    composerApi.setText = (t) => {
      setText(t)
      requestAnimationFrame(() => {
        const el = ta.current
        if (!el) return
        el.focus()
        el.setSelectionRange(t.length, t.length)
      })
    }
    composerApi.focus = () => ta.current?.focus()
    composerApi.insert = (emoji) => {
      const el = ta.current
      if (!el) return
      const { selectionStart: a, selectionEnd: b, value } = el
      const next = value.slice(0, a) + emoji + value.slice(b)
      setText(next)
      noteTyping(!!next.trim())
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = a + emoji.length
        el.focus()
      })
    }
    if (matchMedia('(pointer: fine)').matches) ta.current?.focus()
  }, [c.id])

  useLayoutEffect(() => {
    const t = ta.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight, 180)}px`
  }, [text])

  const [fxOpen, setFxOpen] = useState(false)
  const press = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = (effect?: EffectId) => {
    const body = text.trim()
    if (!body) return
    setText('')
    setFxOpen(false)
    if (editing) {
      set({ editing: null })
      void editMessage(c, editing, body)
      return
    }
    const r = get().replyTo
    set({ replyTo: null })
    void postMessage(c, { text: body, replyTo: r, effect })
  }

  const cancel = () => {
    if (editing) setText('')
    set({ editing: null, replyTo: null })
  }

  const attachFiles = async (files: File[]) => {
    const caption = text.trim()
    if (await sendFiles(c, files, caption)) setText('')
  }

  // iMessage: press and hold send (or right-click) to pick an effect.
  const holdStart = (e: React.PointerEvent) => {
    // Only a primary press/touch can send; a right-click must only open the picker.
    if (editing || e.button !== 0) return
    press.current = setTimeout(() => {
      press.current = null
      setFxOpen(true)
    }, 450)
  }
  const holdEnd = () => {
    if (press.current) {
      clearTimeout(press.current)
      press.current = null
      send()
    }
  }

  return (
    <footer className="composer">
      <UploadBar />
      {editing ? (
        <div className="comp-bar">
          <Ic name="pencil" />
          <span>Editing message</span>
          <small>Esc to cancel · Enter to save</small>
          <button className="icon-btn sm" onClick={cancel}>
            <Ic name="x" />
          </button>
        </div>
      ) : replyTo ? (
        <div className="comp-bar">
          <Ic name="reply" />
          <span>
            Replying to <b>{nameOf(replyTo.senderId)}</b>
          </span>
          <small>{replyTo.text || '📷 Photo'}</small>
          <button className="icon-btn sm" onClick={cancel}>
            <Ic name="x" />
          </button>
        </div>
      ) : null}
      <div className="comp-row">
        <button className="comp-plus" title="Send photos or videos" onClick={() => file.current?.click()}>
          <Ic name="plus" />
        </button>
        <CameraButton c={c} />
        <button
          className="comp-plus comp-emoji"
          title="Emoji"
          data-keep-pop
          onClick={(e) => (isPopoverOpen('emoji-pop') ? closePopover() : openEmojiPicker(e.currentTarget, composerApi.insert))}
        >
          <Ic name="smile" />
        </button>
        <button
          className="comp-plus comp-sticker"
          title="Stickers"
          data-keep-pop
          onClick={(e) => (isPopoverOpen('sticker-pop') ? closePopover() : openStickerPicker(e.currentTarget, sendSticker))}
        >
          <Ic name="sticker" />
        </button>
        <button className="comp-plus comp-gif" title="GIFs" data-keep-pop onClick={(e) => (isPopoverOpen('gif-pop') ? closePopover() : openGifPicker(e.currentTarget, sendGif))}>
          GIF
        </button>
        <div className="comp-field">
          <textarea
            ref={ta}
            rows={1}
            maxLength={4000}
            placeholder={dm ? `Message ${user(otherMember(c)).displayName}` : `Message ${chatTitle(c)}`}
            aria-label="Message"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              noteTyping(!!e.target.value.trim())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              } else if (e.key === 'Escape' && (get().replyTo || get().editing)) {
                e.preventDefault()
                cancel()
              } else if (e.key === 'ArrowUp' && !text) {
                // Discord: ↑ in an empty box edits your last message.
                const last = [...get().msgs].reverse().find((m) => m.senderId === get().uid && !m.system && !m.deleted && !m.image)
                if (last) {
                  e.preventDefault()
                  startEdit(last)
                }
              }
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((x) => /^(image|video)\//.test(x.type))
              if (files.length) {
                e.preventDefault()
                void attachFiles(files)
              }
            }}
            onBlur={() => setTimeout(stopTyping, 200)}
          />
          {text.trim() ? (
            <button
              className="send-btn"
              title="Send (hold or right-click for effects)"
              onPointerDown={holdStart}
              onPointerUp={holdEnd}
              onPointerLeave={() => press.current && (clearTimeout(press.current), (press.current = null))}
              onContextMenu={(e) => {
                e.preventDefault()
                if (!editing) setFxOpen(true)
              }}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), send())}
            >
              <Ic name="up" />
            </button>
          ) : (
            !editing && <MicButton c={c} />
          )}
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void attachFiles(files)
        }}
      />
      {fxOpen && <EffectPicker text={text.trim()} onSend={(fx) => send(fx)} onClose={() => setFxOpen(false)} />}
    </footer>
  )
}

// ============================================================================
// Details panel
// ============================================================================
function Details({ c }: { c: Chat }) {
  const wall = useStore((s) => s.wall)
  const me = useStore((s) => s.me)!
  useStore((s) => s.users)
  useStore((s) => s.tick)
  const uid = get().uid!
  const dm = c.type === 'dm'
  const other = otherMember(c)
  const [name, setName] = useState(c.name ?? '')
  useEffect(() => setName(c.name ?? ''), [c.name])
  const wallInput = useRef<HTMLInputElement>(null)
  const members = [...c.members].sort((a, b) => (a === uid ? -1 : b === uid ? 1 : byName(a, b)))
  return (
    <aside className="details">
      <header className="det-head">
        <b>Details</b>
        <button className="icon-btn sm" onClick={() => set({ detailsOpen: false })}>
          <Ic name="x" />
        </button>
      </header>
      <div className="det-hero">
        <ChatAvatar c={c} size={84} />
        {dm ? (
          <>
            <h2>{user(other).displayName}</h2>
            <p className="muted">@{user(other).username}</p>
            <p className={`det-pres pres-text-${presenceOf(other)}`}>{presenceText(other)}</p>
            {user(other).bio && <p className="det-bio">{user(other).bio}</p>}
          </>
        ) : (
          <input
            className="det-name"
            value={name}
            placeholder={chatTitle(c)}
            maxLength={50}
            title="Rename group"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setName(c.name ?? '')
                e.currentTarget.blur()
              }
            }}
            onBlur={() => name.trim() !== (c.name ?? '') && renameGroup(c, name.trim())}
          />
        )}
      </div>
      <div className="det-group">
        <label className="det-row toggle">
          <Ic name="bellOff" />
          <span>Hide Alerts</span>
          <input type="checkbox" checked={isMuted(c)} onChange={() => toggleMute(c)} />
          <i className="switch" />
        </label>
        <div className="det-row static">
          <Ic name="check" />
          <span>Read receipts</span>
          <small>Always on</small>
        </div>
      </div>
      <div className="det-group">
        <div className="det-label">Chat Background</div>
        {wall && <div className="det-wall" style={{ backgroundImage: `url("${wall}")` }} />}
        <button className="det-row link-row" onClick={() => wallInput.current?.click()}>
          <Ic name="image" />
          <span>{wall ? 'Change Background' : 'Choose a Photo'}</span>
        </button>
        {wall && (
          <button className="det-row danger" onClick={() => void setWallpaper(c, '')}>
            <Ic name="trash" />
            <span>Remove Background</span>
          </button>
        )}
        <input
          ref={wallInput}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              await setWallpaper(c, await compressImage(f, 1600, 700_000))
            } catch (ex) {
              toast((ex as Error).message, 'error')
            }
          }}
        />
      </div>
      {!dm && (
        <>
          <div className="det-group">
            <div className="det-label">{c.members.length} Members</div>
            {members.map((u) => (
              <button key={u} className="det-member" onClick={(e) => openProfile(u, e.currentTarget)}>
                <UserAvatar uid={u} size={32} withPresence />
                <span>
                  <b>{u === uid ? `${me.displayName} (you)` : user(u).displayName}</b>
                  <small>{presenceText(u)}</small>
                </span>
              </button>
            ))}
            <button className="det-row link-row" onClick={() => openAddPeople(c)}>
              <Ic name="userPlus" />
              <span>Add People</span>
            </button>
          </div>
          <div className="det-group">
            <button
              className="det-row danger"
              onClick={() =>
                openModal(
                  <Modal
                    cls="small"
                    title="Leave conversation?"
                    foot={
                      <>
                        <button className="btn" onClick={closeModal}>
                          Cancel
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => {
                            closeModal()
                            void leaveGroup(c)
                          }}
                        >
                          Leave
                        </button>
                      </>
                    }
                  >
                    <p className="modal-text">You'll stop getting messages from this group.</p>
                  </Modal>,
                )
              }
            >
              <Ic name="logout" />
              <span>Leave this Conversation</span>
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

// ============================================================================
// The view
// ============================================================================
export function ChatView({ id }: { id: string }) {
  const c = useStore((s) => s.chats[id])
  const loaded = useStore((s) => s.chatsLoaded)
  const wall = useStore((s) => s.wall)
  const detailsOpen = useStore((s) => s.detailsOpen)
  const searchOpen = useStore((s) => s.searchOpen)
  // Ctrl/Cmd+F opens search inside a conversation, like iMessage.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        set({ searchOpen: true, searchMode: 'search', detailsOpen: false })
      }
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [])
  // Over an animated theme, bubbles use the same tail-less readable style as a photo background.
  const themed = useStore((s) => themeHasBackdrop(s.appTheme))
  const [drop, setDrop] = useState(false)

  if (!c)
    return loaded ? (
      <div className="empty-main">
        <Logo />
        <h2>Conversation not found</h2>
        <p>You may have left this conversation.</p>
        <a className="btn btn-primary" href="#/friends">
          Back to Friends
        </a>
      </div>
    ) : null

  return (
    <section className={`chat ${detailsOpen || searchOpen ? 'details-open' : ''}`}>
      <div
        className={`chat-col ${wall || themed ? 'has-wall' : ''} ${wall ? 'own-wall' : ''} ${wall && themed ? 'layered-wall' : ''} ${drop ? 'drop' : ''}`}
        style={wall && !themed ? { backgroundImage: `url("${wall}")` } : undefined}
        onDragOver={(e) => {
          e.preventDefault()
          setDrop(true)
        }}
        onDragLeave={() => setDrop(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrop(false)
          const files = [...e.dataTransfer.files].filter((x) => /^(image|video)\//.test(x.type))
          if (files.length) return void sendFiles(c, files, '')
          // A GIF dragged straight from another web page arrives as a link, not a file.
          const url = (e.dataTransfer.getData('text/uri-list') || '').split('\n')[0].trim()
          if (/^https:\/\/\S+\.gif(\?\S*)?$/i.test(url)) sendGif(url)
        }}
      >
        {wall && themed && <WallLayers wall={wall} />}
        <ChatHead c={c} />
        <Messages c={c} />
        <DndNotice c={c} />
        <Composer c={c} />
      </div>
      {detailsOpen && <Details c={c} />}
      {searchOpen && <SearchPanel c={c} />}
    </section>
  )
}
