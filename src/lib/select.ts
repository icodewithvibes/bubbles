// Pure lookups over the store, ported 1:1 from v1's helpers.
import { fmtAgo, fmtClock, ms } from '@/kit/util.js'
import { get } from '@/store'
import type { Chat, Presence, Rel, UserProfile } from './types'

export const TYPING_TTL = 6000
export const OFFLINE_AFTER = 7 * 60e3
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export const pairId = (a: string, b: string) => [a, b].sort().join('_')
export const dmId = (a: string, b: string) => `dm_${pairId(a, b)}`

export const user = (uid: string): UserProfile =>
  get().users[uid] ?? ({ id: uid, uid, username: '', displayName: '…' } as UserProfile)
export const nameOf = (uid: string) => (uid === get().uid ? 'You' : user(uid).displayName || 'Someone')
export const firstName = (uid: string) => nameOf(uid).split(' ')[0]

export function dndActive(u?: UserProfile | null) {
  if (u?.status !== 'dnd') return false
  const until = ms(u.dndUntil)
  return !until || until > Date.now()
}
export const myDnd = () => dndActive(get().me)

export function presenceOf(uid: string): Presence {
  const u = get().users[uid]
  if (!u) return 'offline'
  if (uid === get().uid) {
    if (dndActive(u)) return 'dnd'
    return u.status === 'invisible' ? 'offline' : u.status === 'idle' ? 'idle' : 'online'
  }
  if (u.status === 'invisible' || u.state === 'offline' || Date.now() - ms(u.lastActive) > OFFLINE_AFTER) return 'offline'
  if (dndActive(u)) return 'dnd'
  if (u.status === 'idle' || u.state === 'away') return 'idle'
  return 'online'
}

export function presenceText(uid: string) {
  const p = presenceOf(uid)
  const u = user(uid)
  if (p === 'dnd') {
    const until = ms(u.dndUntil)
    return until ? `Do Not Disturb until ${fmtClock(until)}` : 'Do Not Disturb'
  }
  if (p === 'online') return 'Active now'
  if (p === 'idle') return 'Idle'
  return u.lastActive && u.status !== 'invisible' ? `Active ${fmtAgo(ms(u.lastActive))}` : 'Offline'
}

// ---------- friends ----------
export const otherOf = (r: Rel) => r.participants.find((p) => p !== get().uid) ?? r.to
export const relWith = (uid: string) => get().rels[pairId(get().uid ?? '', uid)]
export const isFriend = (uid: string) => relWith(uid)?.status === 'accepted'
export const friendIds = () => Object.values(get().rels).filter((r) => r.status === 'accepted').map(otherOf)
export const incoming = () => Object.values(get().rels).filter((r) => r.status === 'pending' && r.to === get().uid)
export const outgoing = () => Object.values(get().rels).filter((r) => r.status === 'pending' && r.from === get().uid)
export const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b))

// ---------- chats ----------
export const sortedChats = () => Object.values(get().chats).sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt))
export const otherMember = (c: Chat) => c.members.find((m) => m !== get().uid) ?? get().uid ?? ''
export const isMuted = (c: Chat) => (get().me?.muted ?? []).includes(c.id)

export function chatTitle(c: Chat) {
  if (c.type === 'dm') return user(otherMember(c)).displayName
  if (c.name) return c.name
  const others = c.members.filter((m) => m !== get().uid)
  const names = others.slice(0, 3).map(firstName)
  return others.length > 3 ? `${names.join(', ')} +${others.length - 3}` : names.join(', ') || 'Group'
}

export function isUnread(c: Chat) {
  const lm = c.lastMessage
  const uid = get().uid ?? ''
  return !!lm && lm.senderId !== uid && ms(lm.createdAt) > ms(c.lastRead?.[uid])
}

export function typers(c: Chat) {
  const now = Date.now()
  const uid = get().uid
  return Object.entries(c.typing ?? {})
    .filter(([u, t]) => u !== uid && now - t < TYPING_TTL && c.members.includes(u))
    .map(([u]) => u)
}

export function previewText(c: Chat) {
  const lm = c.lastMessage
  if (!lm) return c.type === 'group' ? 'Group created' : 'Say hi 👋'
  if (lm.system) return `${nameOf(lm.senderId)} ${lm.text}`
  const body = lm.text || '📷 Photo'
  if (lm.senderId === get().uid) return `You: ${body}`
  return c.type === 'group' ? `${firstName(lm.senderId)}: ${body}` : body
}

export const isGif = (src?: string) => /^data:image\/gif|\.gif(\?|$)/i.test(src ?? '')
