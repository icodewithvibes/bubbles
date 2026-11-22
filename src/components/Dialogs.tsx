import { useEffect, useRef, useState } from 'react'

import { compressImage } from '@/kit/util.js'
import { byName, friendIds, myDnd, presenceOf, presenceText, relWith, user } from '@/lib/select'
import type { Chat } from '@/lib/types'
import {
  N,
  acceptRequest,
  addPeople,
  authError,
  changePassword,
  createGroup,
  doSignOut,
  enableNotifications,
  openDM,
  removeFriend,
  sendFriendRequest,
  setStatus,
  updateProfile,
} from '@/services/session'
import { closeModal, get, openModal, toast, useStore } from '@/store'
import { openDndMenu } from './Shell'
import { APP_VERSION, openPatchNotes } from './WhatsNew'
import { THEMES, applyTheme } from '@/themes'
import { Avatar, Ic, Modal, Moon, UserAvatar, closePopover, openPopover } from './ui'

const pref = (k: string, d: string) => {
  try {
    return localStorage.getItem(`bubbles.${k}`) ?? d
  } catch {
    return d
  }
}
const setPref = (k: string, v: string) => {
  try {
    localStorage.setItem(`bubbles.${k}`, v)
  } catch {
    /* private mode */
  }
}

// ============================================================================
// Compose (new message / group) & add people
// ============================================================================
function PickList({ ids, selected, toggle, empty }: { ids: string[]; selected: Set<string>; toggle: (u: string) => void; empty: string }) {
  return (
    <div className="pick-list">
      {ids.length ? (
        ids.map((u) => (
          <button key={u} className={`pick ${selected.has(u) ? 'on' : ''}`} onClick={() => toggle(u)}>
            <UserAvatar uid={u} size={36} withPresence />
            <span>
              <b>{user(u).displayName}</b>
              <small>@{user(u).username}</small>
            </span>
            <i className="check">
              <Ic name="check" />
            </i>
          </button>
        ))
      ) : (
        <div className="list-empty">{empty}</div>
      )}
    </div>
  )
}

function Compose({ groupMode }: { groupMode: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const all = friendIds().sort(byName)
  const ql = q.trim().toLowerCase()
  const ids = all.filter((u) => !ql || user(u).displayName.toLowerCase().includes(ql) || user(u).username.includes(ql))
  const toggle = (u: string) => {
    const next = new Set(selected)
    if (next.has(u)) next.delete(u)
    else next.add(u)
    setSelected(next)
    setQ('')
    input.current?.focus()
  }
  const start = () => {
    const picked = [...selected]
    closeModal()
    if (picked.length === 1) void openDM(picked[0])
    else createGroup(picked, name.trim()).catch(() => toast("Couldn't create the group", 'error'))
  }
  return (
    <Modal
      cls="compose"
      title={groupMode ? 'Create a Group' : 'New Message'}
      foot={
        <button className="btn btn-primary" disabled={!selected.size} onClick={start}>
          {selected.size > 1 ? `Create Group (${selected.size + 1})` : 'Start Chat'}
        </button>
      }
    >
      <div className="to-field">
        <span>To:</span>
        <span>
          {[...selected].map((u) => (
            <button key={u} className="chip" onClick={() => toggle(u)}>
              {user(u).displayName} <Ic name="x" />
            </button>
          ))}
        </span>
        <input
          ref={input}
          value={q}
          placeholder="Find friends"
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !q && selected.size) toggle([...selected].at(-1)!)
            if (e.key === 'Enter' && ids[0]) toggle(ids[0])
          }}
        />
      </div>
      {selected.size >= 2 && (
        <div className="to-name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name (optional)" maxLength={50} />
        </div>
      )}
      <PickList ids={ids} selected={selected} toggle={toggle} empty={all.length ? 'No matches.' : 'Add some friends first.'} />
    </Modal>
  )
}
export const openCompose = (groupMode = false) => openModal(<Compose groupMode={groupMode} />)

function AddPeople({ c }: { c: Chat }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const candidates = friendIds()
    .filter((u) => !c.members.includes(u))
    .sort(byName)
  return (
    <Modal
      cls="compose"
      title="Add People"
      foot={
        <button
          className="btn btn-primary"
          disabled={!selected.size}
          onClick={() => {
            closeModal()
            addPeople(c, [...selected]).catch(() => toast("Couldn't add people", 'error'))
          }}
        >
          Add
        </button>
      }
    >
      <PickList
        ids={candidates}
        selected={selected}
        toggle={(u) => {
          const next = new Set(selected)
          if (next.has(u)) next.delete(u)
          else next.add(u)
          setSelected(next)
        }}
        empty="All your friends are already here."
      />
    </Modal>
  )
}
export const openAddPeople = (c: Chat) => openModal(<AddPeople c={c} />)

// ============================================================================
// Profile card, remove friend, lightbox
// ============================================================================
export function openProfile(uid: string, anchor: Element) {
  const u = user(uid)
  const rel = relWith(uid)
  const p = presenceOf(uid)
  const me = get().uid
  let actions
  if (uid === me)
    actions = (
      <>
        <button
          className="btn btn-sm"
          onClick={() => {
            closePopover()
            pickAvatar()
          }}
        >
          Change Picture
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            closePopover()
            openSettings()
          }}
        >
          Edit Profile
        </button>
      </>
    )
  else if (rel?.status === 'accepted')
    actions = (
      <button
        className="btn btn-sm btn-primary"
        onClick={() => {
          closePopover()
          void openDM(uid)
        }}
      >
        Message
      </button>
    )
  else if (rel?.to === me)
    actions = (
      <button
        className="btn btn-sm btn-primary"
        onClick={() => {
          closePopover()
          void acceptRequest(rel.id).then(() => toast('Friend added!'))
        }}
      >
        Accept Friend Request
      </button>
    )
  else if (rel)
    actions = (
      <button className="btn btn-sm" disabled>
        Friend Request Sent
      </button>
    )
  else
    actions = (
      <button
        className="btn btn-sm btn-primary"
        onClick={() => {
          closePopover()
          sendFriendRequest(u.username).then(
            (m) => toast(m),
            (e) => toast((e as Error).message, 'error'),
          )
        }}
      >
        Add Friend
      </button>
    )
  openPopover(
    <>
      <div className="pc-banner" style={{ ['--g1' as string]: '#5ac8fa', ['--g2' as string]: '#0a64ff' }} />
      <div className="pc-av">
        <Avatar u={u} size={76} presence={p} />
      </div>
      <div className="pc-body">
        <h3>{u.displayName}</h3>
        <p className="muted">@{u.username}</p>
        <p className={`pc-pres pres-text-${p}`}>
          {p === 'dnd' && (
            <>
              <Moon />{' '}
            </>
          )}
          {presenceText(uid)}
        </p>
        {u.bio && (
          <div className="pc-sec">
            <h4>About Me</h4>
            <p>{u.bio}</p>
          </div>
        )}
        <div className="pc-actions">{actions}</div>
      </div>
    </>,
    anchor,
    { place: 'right', cls: 'profile-card' },
  )
}

export function confirmRemoveFriend(uid: string) {
  const name = user(uid).displayName
  openModal(
    <Modal
      cls="small"
      title={`Remove '${name}'`}
      foot={
        <>
          <button className="btn" onClick={closeModal}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              closeModal()
              void removeFriend(uid)
            }}
          >
            Remove Friend
          </button>
        </>
      }
    >
      <p className="modal-text">
        Are you sure you want to remove <b>{name}</b> from your friends?
      </p>
    </Modal>,
  )
}

export function openLightbox(src: string) {
  openModal(
    <div className="modal lightbox" role="dialog" aria-modal="true">
      <img src={src} alt="Photo" />
      <button className="icon-btn lb-close" onClick={closeModal}>
        <Ic name="x" />
      </button>
    </div>,
  )
}

// ============================================================================
// Profile picture
// ============================================================================
async function saveAvatar(file: File) {
  try {
    const photoURL = await compressImage(file, 256, 90_000)
    await updateProfile({ photoURL })
    toast('Profile picture updated')
    return photoURL as string
  } catch (e) {
    toast((e as Error).message, 'error')
    return null
  }
}

export function pickAvatar() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    if (input.files?.[0]) void saveAvatar(input.files[0])
  }
  input.click()
}

// ============================================================================
// Settings
// ============================================================================
const ACCENTS = ['#0a84ff', '#34c759', '#af52de', '#ff2d55', '#ff9500', '#5e5ce6']

function Settings() {
  const me = useStore((s) => s.me)!
  useStore((s) => s.tick)
  const [name, setName] = useState(me.displayName)
  const [bio, setBio] = useState(me.bio ?? '')
  const [theme, setTheme] = useState(pref('theme', 'system'))
  const [accent, setAccent] = useState(pref('accent', '#0a84ff'))
  const appTheme = useStore((s) => s.appTheme)
  const [sound, setSound] = useState(N.soundOn())
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [passErr, setPassErr] = useState('')
  const avInput = useRef<HTMLInputElement>(null)
  const p = N.permission()
  const dnd = myDnd()

  const saveProfile = () => {
    const patch: Record<string, string> = {}
    if (name.trim() && name.trim() !== me.displayName) patch.displayName = name.trim()
    if (bio.trim() !== (me.bio ?? '')) patch.bio = bio.trim()
    if (Object.keys(patch).length) void updateProfile(patch).then(() => toast('Profile saved'))
  }

  return (
    <Modal cls="settings-modal" title="Settings">
      <div className="settings">
        <section>
          <h3>Profile</h3>
          <div className="set-profile">
            <button className="set-av" title="Change photo" onClick={() => avInput.current?.click()}>
              <Avatar u={me} size={72} />
              <span>Edit</span>
            </button>
            <input
              ref={avInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void saveAvatar(f)
              }}
            />
            <div className="stack grow">
              <label className="field">
                Display name
                <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveProfile} maxLength={32} />
              </label>
              <label className="field">
                Username
                <input value={`@${me.username}`} disabled />
              </label>
            </div>
          </div>
          <label className="field">
            About me
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} onBlur={saveProfile} maxLength={190} rows={2} placeholder="Tell your friends something about you" />
          </label>
          {me.photoURL && (
            <button
              className="link"
              onClick={() => {
                void updateProfile({ photoURL: '' })
                closeModal()
              }}
            >
              Remove photo
            </button>
          )}
        </section>
        <section>
          <h3>Status</h3>
          <div className="seg">
            {(
              [
                ['online', 'Online'],
                ['idle', 'Idle'],
                ['dnd', 'Do Not Disturb'],
                ['invisible', 'Invisible'],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                className={(v === 'dnd' ? dnd : me.status === v && !dnd) ? 'on' : ''}
                onClick={(e) => {
                  if (v === 'dnd') {
                    if (!dnd) openDndMenu(e.currentTarget)
                  } else setStatus(v)
                }}
              >
                <i className={`pres pres-${v === 'invisible' ? 'offline' : v} inline`} />
                {l}
              </button>
            ))}
          </div>
          <p className="hint">
            Do Not Disturb silences all notifications and sounds. Friends see a moon on your avatar and a “notifications silenced” note in your chats. They can still tap{' '}
            <b>Notify Anyway</b> for something urgent.
          </p>
        </section>
        <section>
          <h3>Notifications</h3>
          <div className="set-row">
            <span>
              Desktop notifications
              <small>
                {p === 'granted'
                  ? N.pushActive()
                    ? 'On, including when Bubbles is closed'
                    : 'On while Bubbles is open'
                  : p === 'denied'
                    ? 'Blocked by the browser'
                    : p === 'unsupported'
                      ? 'Not supported here'
                      : 'Off'}
              </small>
            </span>
            {p === 'default' && (
              <button className="btn btn-sm btn-primary" onClick={() => void enableNotifications()}>
                Turn on
              </button>
            )}
            {p === 'granted' && (
              <button className="btn btn-sm" onClick={() => void N.notify({ title: 'Bubbles', body: 'Notifications are working! 🎉', icon: undefined, chatId: 'test', messageId: String(Date.now()) })}>
                Send test
              </button>
            )}
          </div>
          <label className="set-row toggle">
            <span>Message sounds</span>
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => {
                setPref('sound', e.target.checked ? 'on' : 'off')
                setSound(e.target.checked)
                if (e.target.checked) {
                  N.unlockAudio()
                  N.playSound('in')
                }
              }}
            />
            <i className="switch" />
          </label>
          <div className="set-row">
            <span>
              Read receipts<small>Always on. People can see when you've read their messages.</small>
            </span>
          </div>
        </section>
        <section>
          <h3>Theme</h3>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} className={`theme-card ${appTheme === t.id ? 'on' : ''}`} onClick={() => applyTheme(t.id)}>
                <div className="theme-swatch" style={{ background: t.preview }} />
                <span className="theme-check">
                  <Ic name="check" />
                </span>
                <b>{t.name}</b>
                <small>{t.tagline}</small>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Appearance</h3>
          {appTheme !== 'default' && <p className="hint">Light/dark and bubble color apply to the Classic theme.</p>}
          <div className="seg">
            {['system', 'light', 'dark'].map((t) => (
              <button
                key={t}
                className={theme === t ? 'on' : ''}
                onClick={() => {
                  setPref('theme', t)
                  setTheme(t)
                  if (t === 'system') delete document.documentElement.dataset.theme
                  else document.documentElement.dataset.theme = t
                }}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="accents">
            {ACCENTS.map((a) => (
              <button
                key={a}
                style={{ ['--c' as string]: a }}
                className={a === accent ? 'on' : ''}
                title="Bubble color"
                onClick={() => {
                  setPref('accent', a)
                  setAccent(a)
                  document.documentElement.style.setProperty('--accent', a)
                }}
              />
            ))}
          </div>
        </section>
        <section>
          <h3>Account</h3>
          <div className="stack">
            <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" autoComplete="current-password" />
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (6+ characters)" autoComplete="new-password" />
            <button
              className="btn btn-sm"
              onClick={async () => {
                setPassErr('')
                try {
                  await changePassword(cur, next)
                  setCur('')
                  setNext('')
                  toast('Password changed')
                } catch (ex) {
                  setPassErr(authError(ex))
                }
              }}
            >
              Change password
            </button>
            <p className="form-err">{passErr}</p>
          </div>
          <button
            className="btn btn-danger"
            onClick={() => {
              closeModal()
              void doSignOut()
            }}
          >
            <Ic name="logout" /> Sign out
          </button>
        </section>
        <section>
          <button className="link" onClick={openPatchNotes}>
            What's new in Bubbles {APP_VERSION}
          </button>
        </section>
      </div>
    </Modal>
  )
}
export const openSettings = () => openModal(<Settings />)

