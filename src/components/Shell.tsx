import { fmtListTime, ms } from '@/kit/util.js'
import {
  chatTitle,
  incoming,
  isMuted,
  isUnread,
  myDnd,
  presenceOf,
  presenceText,
  previewText,
  sortedChats,
  typers,
} from '@/lib/select'
import type { Chat } from '@/lib/types'
import { N, enableNotifications, markRead, setStatus, toggleMute } from '@/services/session'
import { set, useStore } from '@/store'
import { openCompose, openSettings, pickAvatar } from './Dialogs'
import { Avatar, ChatAvatar, Ic, Logo, Moon, openMenu } from './ui'

const pref = (k: string, d: string) => {
  try {
    return localStorage.getItem(`bubbles.${k}`) ?? d
  } catch {
    return d
  }
}

function useNav() {
  // Any change to chats, users, rels or the clock redraws the navigation.
  useStore((s) => s.chats)
  useStore((s) => s.users)
  useStore((s) => s.rels)
  useStore((s) => s.tick)
  return useStore((s) => s.route)
}

export function Rail() {
  const route = useNav()
  const chats = sortedChats()
  const unreadDms = chats.filter((c) => c.type === 'dm' && isUnread(c))
  const groups = chats.filter((c) => c.type === 'group')
  const activeId = route.view === 'chat' ? route.id : null
  const home = route.view !== 'chat' || useStore.getState().chats[route.id]?.type === 'dm'
  const pending = incoming().length
  const item = (c: Chat) => {
    const unread = isUnread(c)
    return (
      <a key={c.id} className={`rail-item ${activeId === c.id ? 'active' : ''} ${unread ? 'unread' : ''}`} href={`#/chat/${c.id}`} data-tip={chatTitle(c)}>
        <span className="rail-pill" />
        <ChatAvatar c={c} size={48} withPresence={false} />
        {unread && c.type === 'dm' && <span className="rail-badge">1</span>}
      </a>
    )
  }
  return (
    <nav id="rail" className="rail" aria-label="Servers">
      <a className={`rail-item rail-home ${home ? 'active' : ''}`} href="#/friends" data-tip="Direct Messages">
        <span className="rail-pill" />
        <span className="rail-logo">
          <Logo />
        </span>
        {pending > 0 && <span className="rail-badge">{pending}</span>}
      </a>
      {unreadDms.map(item)}
      <span className="rail-sep" />
      {groups.map(item)}
      <button className="rail-item rail-add" data-tip="Create a Group" onClick={() => openCompose(true)}>
        <Ic name="plus" />
      </button>
    </nav>
  )
}

function ChatRow({ c, active }: { c: Chat; active: boolean }) {
  const typing = typers(c)
  const lm = c.lastMessage
  return (
    <a
      className={`chat-row ${active ? 'active' : ''} ${isUnread(c) ? 'unread' : ''}`}
      href={`#/chat/${c.id}`}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(
          [
            { id: 'read', label: 'Mark as Read', icon: <Ic name="check" />, run: () => void markRead(c) },
            { id: 'mute', label: isMuted(c) ? 'Show Alerts' : 'Hide Alerts', icon: <Ic name={isMuted(c) ? 'bell' : 'bellOff'} />, run: () => toggleMute(c) },
          ],
          e.currentTarget,
          { place: 'point', at: { x: e.clientX, y: e.clientY } },
        )
      }}
    >
      <span className="unread-dot" />
      <ChatAvatar c={c} size={44} />
      <span className="cr-body">
        <span className="cr-top">
          <span className="cr-name">{chatTitle(c)}</span>
          {isMuted(c) && (
            <span className="cr-muted" title="Alerts hidden">
              <Ic name="bellOff" />
            </span>
          )}
          <span className="cr-time">{lm ? fmtListTime(ms(lm.createdAt)) : ''}</span>
        </span>
        <span className="cr-preview">
          {typing.length ? (
            <>
              <i className="typing-mini">
                <b />
                <b />
                <b />
              </i>{' '}
              typing…
            </>
          ) : (
            previewText(c)
          )}
        </span>
      </span>
    </a>
  )
}

function ChatList() {
  const route = useNav()
  const search = useStore((s) => s.search)
  const q = search.trim().toLowerCase()
  const pending = incoming().length
  const activeId = route.view === 'chat' ? route.id : null
  let chats = sortedChats().filter((c) => c.lastMessage || c.type === 'group' || c.id === activeId)
  if (q) chats = chats.filter((c) => chatTitle(c).toLowerCase().includes(q) || (c.lastMessage?.text ?? '').toLowerCase().includes(q))
  const friendsActive = route.view === 'friends' || route.view === 'home'
  return (
    <div id="chatList" className="chat-list">
      <a className={`nav-row ${friendsActive ? 'active' : ''}`} href="#/friends">
        <Ic name="users" />
        <span>Friends</span>
        {pending > 0 && <span className="pill-badge">{pending}</span>}
      </a>
      {chats.length ? (
        chats.map((c) => <ChatRow key={c.id} c={c} active={activeId === c.id} />)
      ) : (
        <div className="list-empty">
          {q ? (
            'No matches.'
          ) : (
            <>
              No conversations yet.
              <br />
              Add a friend, then say hi!
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function openStatusMenu(anchor: Element) {
  const dot = (p: string) => <i className={`pres pres-${p} inline`} />
  openMenu(
    [
      { id: 'online', label: 'Online', icon: dot('online'), run: () => setStatus('online') },
      { id: 'idle', label: 'Idle', icon: dot('idle'), run: () => setStatus('idle') },
      {
        id: 'dnd',
        label: (
          <>
            Do Not Disturb<small>Silences notifications. Friends see it.</small>
          </>
        ),
        icon: dot('dnd'),
        run: () => setTimeout(() => openDndMenu(anchor), 0),
      },
      {
        id: 'invisible',
        label: (
          <>
            Invisible<small>Appear offline</small>
          </>
        ),
        icon: dot('offline'),
        run: () => setStatus('invisible'),
      },
      '-',
      { id: 'avatar', label: 'Change Profile Picture', icon: <Ic name="image" />, run: () => pickAvatar() },
      { id: 'profile', label: 'Edit Profile', icon: <Ic name="pencil" />, run: openSettings },
    ],
    anchor,
    { place: 'top', cls: 'status-menu' },
  )
}

export function openDndMenu(anchor: Element) {
  if (myDnd()) return setStatus('online')
  setTimeout(
    () =>
      openMenu(
        [
          { id: 'h1', label: 'For 1 hour', icon: <Moon />, run: () => setStatus('dnd', 60) },
          { id: 'h8', label: 'For 8 hours', icon: <Moon />, run: () => setStatus('dnd', 480) },
          { id: 'h24', label: 'For 24 hours', icon: <Moon />, run: () => setStatus('dnd', 1440) },
          { id: 'forever', label: 'Until I turn it off', icon: <Moon />, run: () => setStatus('dnd') },
        ],
        anchor,
        { place: 'top', cls: 'dnd-menu' },
      ),
    0,
  )
}

function UserPanel() {
  const me = useStore((s) => s.me)
  const uid = useStore((s) => s.uid)
  useStore((s) => s.tick)
  if (!me || !uid) return null
  const dnd = myDnd()
  return (
    <div id="userPanel" className="user-panel">
      <button className="up-me" title="Set status" onClick={(e) => openStatusMenu(e.currentTarget)}>
        <Avatar u={me} size={34} presence={presenceOf(uid)} />
        <span className="up-text">
          <b>{me.displayName}</b>
          <small>{dnd ? presenceText(uid) : `@${me.username}`}</small>
        </span>
      </button>
      <button className={`icon-btn ${dnd ? 'dnd-on' : ''}`} title={dnd ? 'Turn off Do Not Disturb' : 'Do Not Disturb'} onClick={(e) => openDndMenu(e.currentTarget)}>
        <Moon />
      </button>
      <button className="icon-btn" title="Settings" onClick={openSettings}>
        <Ic name="settings" />
      </button>
    </div>
  )
}

function NotifBanner() {
  useStore((s) => s.tick)
  const p = N.permission()
  const dismissed = pref('notifBannerDismissed', '') === '1'
  const dismiss = () => {
    try {
      localStorage.setItem('bubbles.notifBannerDismissed', '1')
    } catch {
      /* private mode */
    }
    set((s) => ({ tick: s.tick + 1 }))
  }
  if (dismissed) return <div id="notifBanner" />
  if (p === 'default')
    return (
      <div id="notifBanner">
        <div className="banner">
          <Ic name="bell" />
          <span>Get notified about new messages</span>
          <button className="btn btn-sm btn-primary" onClick={() => void enableNotifications()}>
            Turn on
          </button>
          <button className="icon-btn sm" title="Dismiss" onClick={dismiss}>
            <Ic name="x" />
          </button>
        </div>
      </div>
    )
  if (p === 'denied')
    return (
      <div id="notifBanner">
        <div className="banner warn">
          <Ic name="bellOff" />
          <span>Notifications are blocked. Click the lock icon in the address bar to allow them.</span>
          <button className="icon-btn sm" title="Dismiss" onClick={dismiss}>
            <Ic name="x" />
          </button>
        </div>
      </div>
    )
  return <div id="notifBanner" />
}

export function Sidebar() {
  const search = useStore((s) => s.search)
  return (
    <aside id="sidebar" className="sidebar">
      <header className="sb-head">
        <h1>Messages</h1>
        <button className="icon-btn" title="New message" onClick={() => openCompose(false)}>
          <Ic name="compose" />
        </button>
      </header>
      <div className="sb-search">
        <span className="sb-search-ic">
          <Ic name="search" />
        </span>
        <input id="search" type="search" placeholder="Search" autoComplete="off" value={search} onChange={(e) => set({ search: e.target.value })} />
      </div>
      <NotifBanner />
      <ChatList />
      <UserPanel />
    </aside>
  )
}
