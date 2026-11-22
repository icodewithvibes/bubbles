import { useEffect, useRef, useState, type ReactNode } from 'react'

import { byName, friendIds, incoming, outgoing, presenceOf, presenceText, user } from '@/lib/select'
import { acceptRequest, deleteRel, openDM, sendFriendRequest } from '@/services/session'
import { set, toast, useStore } from '@/store'
import { confirmRemoveFriend, openProfile } from './Dialogs'
import { Ic, Logo, UserAvatar, openMenu } from './ui'

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fr-empty">
      <div className="fr-empty-art">
        <Logo />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

function FriendRow({ uid, actions, sub }: { uid: string; actions: ReactNode; sub?: string }) {
  const u = user(uid)
  return (
    <div className="fr-row" onClick={(e) => !(e.target as Element).closest('.fr-actions') && void openDM(uid)}>
      <UserAvatar uid={uid} size={36} withPresence />
      <div className="fr-info">
        <b>{u.displayName}</b> <span className="fr-handle">@{u.username}</span>
        <small>{sub ?? presenceText(uid)}</small>
      </div>
      <div className="fr-actions">{actions}</div>
    </div>
  )
}

function FriendsList() {
  const tab = useStore((s) => s.friendsTab)
  if (tab === 'pending') {
    const inc = incoming()
    const out = outgoing()
    if (!inc.length && !out.length) return <Empty title="No pending friend requests.">Requests you send and receive show up here.</Empty>
    return (
      <>
        {inc.length > 0 && <h3 className="fr-section">Incoming — {inc.length}</h3>}
        {inc.map((r) => (
          <FriendRow
            key={r.id}
            uid={r.from}
            sub="Incoming friend request"
            actions={
              <>
                <button className="round-btn ok" title="Accept" onClick={() => void acceptRequest(r.id).then(() => toast('Friend added!'))}>
                  <Ic name="check" />
                </button>
                <button className="round-btn bad" title="Ignore" onClick={() => void deleteRel(r.id)}>
                  <Ic name="x" />
                </button>
              </>
            }
          />
        ))}
        {out.length > 0 && <h3 className="fr-section">Outgoing — {out.length}</h3>}
        {out.map((r) => (
          <FriendRow
            key={r.id}
            uid={r.to}
            sub="Outgoing friend request"
            actions={
              <button className="round-btn bad" title="Cancel" onClick={() => void deleteRel(r.id)}>
                <Ic name="x" />
              </button>
            }
          />
        ))}
      </>
    )
  }
  let ids = friendIds().sort(byName)
  if (tab === 'online') ids = ids.filter((u) => presenceOf(u) !== 'offline')
  if (!ids.length)
    return tab === 'online' ? (
      <Empty title="No one's around right now.">Friends who are online show up here.</Empty>
    ) : (
      <Empty title="No friends yet.">
        Head to <b>Add Friend</b> and enter a username to get started.
      </Empty>
    )
  return (
    <>
      <h3 className="fr-section">
        {tab === 'online' ? 'Online' : 'All friends'} — {ids.length}
      </h3>
      {ids.map((uid) => (
        <FriendRow
          key={uid}
          uid={uid}
          actions={
            <>
              <button className="round-btn" title="Message" onClick={() => void openDM(uid)}>
                <Ic name="message" />
              </button>
              <button
                className="round-btn"
                title="More"
                onClick={(e) => {
                  const el = e.currentTarget
                  openMenu(
                    [
                      { id: 'profile', label: 'Profile', icon: <Ic name="info" />, run: () => openProfile(uid, el) },
                      { id: 'msg', label: 'Message', icon: <Ic name="message" />, run: () => void openDM(uid) },
                      '-',
                      { id: 'remove', label: 'Remove Friend', icon: <Ic name="userMinus" />, danger: true, run: () => confirmRemoveFriend(uid) },
                    ],
                    el,
                    { place: 'bottom' },
                  )
                }}
              >
                <Ic name="more" />
              </button>
            </>
          }
        />
      ))}
    </>
  )
}

function AddFriend() {
  const me = useStore((s) => s.me)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <div className="add-friend">
      <h2>Add Friend</h2>
      <p className="muted">You can add friends with their Bubbles username.</p>
      <form
        className={`add-form ${result ? (result.ok ? 'ok' : 'bad') : ''}`}
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            setResult({ text: await sendFriendRequest(value), ok: true })
            setValue('')
          } catch (ex) {
            setResult({ text: (ex as Error).message, ok: false })
          }
        }}
      >
        <span className="at">@</span>
        <input
          ref={input}
          value={value}
          onChange={(e) => {
            setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_@]/g, ''))
            setResult(null)
          }}
          placeholder="username"
          autoComplete="off"
          spellCheck={false}
          maxLength={21}
        />
        <button className="btn btn-primary btn-sm" disabled={!value.replace('@', '')}>
          Send Friend Request
        </button>
      </form>
      <p className="add-result">{result?.text}</p>
      <div className="my-username">
        Your username is <b>@{me?.username}</b>{' '}
        <button className="link" onClick={() => void navigator.clipboard.writeText(me?.username ?? '').then(() => toast('Username copied'))}>
          Copy
        </button>
      </div>
    </div>
  )
}

function ActiveNow() {
  const on = friendIds()
    .filter((u) => presenceOf(u) !== 'offline')
    .sort(byName)
  return (
    <aside className="active-now">
      <h2>Active Now</h2>
      {on.length ? (
        on.map((uid) => (
          <button key={uid} className="an-card" onClick={() => void openDM(uid)}>
            <UserAvatar uid={uid} size={32} withPresence />
            <span>
              <b>{user(uid).displayName}</b>
              <small>{presenceText(uid)}</small>
            </span>
          </button>
        ))
      ) : (
        <div className="an-empty">
          <b>It's quiet for now…</b>
          <p>When a friend is online, they'll show up here.</p>
        </div>
      )}
    </aside>
  )
}

export function FriendsView() {
  const tab = useStore((s) => s.friendsTab)
  useStore((s) => s.rels)
  useStore((s) => s.users)
  useStore((s) => s.tick)
  const pending = incoming().length
  return (
    <section className="friends">
      <header className="fr-head">
        <a className="icon-btn back" href="#/">
          <Ic name="back" />
        </a>
        <div className="fr-title">
          <Ic name="users" />
          <span>Friends</span>
        </div>
        <nav className="fr-tabs">
          {(
            [
              ['online', 'Online'],
              ['all', 'All'],
              ['pending', 'Pending'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} className={`fr-tab ${tab === t ? 'active' : ''}`} onClick={() => set({ friendsTab: t })}>
              {label}
              {t === 'pending' && pending > 0 && <span className="pill-badge">{pending}</span>}
            </button>
          ))}
          <button className={`fr-tab add ${tab === 'add' ? 'active' : ''}`} onClick={() => set({ friendsTab: 'add' })}>
            Add Friend
          </button>
        </nav>
      </header>
      <div className="fr-wrap">
        <div className="fr-body">{tab === 'add' ? <AddFriend /> : <FriendsList />}</div>
        <ActiveNow />
      </div>
    </section>
  )
}
