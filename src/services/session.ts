// Everything that talks to Firebase: auth, live listeners, presence and writes.
// Ported from v1 app.js with the same data model, so v1 and v2 users share chats.
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth'
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore'

import { initCalls, stopCalls } from '@/kit/call.js'
import { deleteChunks, isChunked } from '@/lib/chunks'
import { deleteMedia } from '@/lib/media'
import * as N from '@/kit/notify.js'
import { ms } from '@/kit/util.js'
import { auth, db, isCacheFailure, loginToUsername, recoverCache, usernameToLogin } from '@/lib/firebase'
import {
  USERNAME_RE,
  chatTitle,
  dmId,
  isFriend,
  isGif,
  isMuted,
  isUnread,
  myDnd,
  pairId,
  relWith,
  sortedChats,
  user,
} from '@/lib/select'
import type { Chat, Message, Rel, Route, UserProfile } from '@/lib/types'
import { get, initialState, set, toast } from '@/store'

const userRef = (uid: string) => doc(db, 'users', uid)
const chatRef = (id: string) => doc(db, 'chats', id)
const msgRef = (chatId: string, id: string) => doc(db, 'chats', chatId, 'messages', id)
const styleRef = (chatId: string) => doc(db, 'chats', chatId, 'meta', 'style')

const live = {
  unsubs: [] as Unsubscribe[],
  userUnsubs: new Map<string, Unsubscribe>(),
  timers: [] as ReturnType<typeof setInterval>[],
  msgUnsub: null as Unsubscribe | null,
  wallUnsub: null as Unsubscribe | null,
  msgLimit: 50,
  sessionStart: Date.now(),
  lastNotified: {} as Record<string, number>,
  pendingSignupName: null as string | null,
  started: false,
  typingSentAt: 0,
  marking: null as string | null,
}

// ============================================================================
// Errors: the v1 "messages vanish until you clear site data" bug lived here.
// ============================================================================
function onListenError(e: FirestoreError, retry?: () => void) {
  console.error(e)
  if (isCacheFailure(e)) {
    toast('Repairing offline storage…', 'error')
    void recoverCache()
    return
  }
  if (e.code === 'permission-denied') return toast('Permission denied. Did you publish firestore.rules?', 'error')
  toast('Connection problem. Retrying…', 'error')
  // v1 gave up after an error; v2 re-subscribes with backoff.
  if (retry) setTimeout(retry, 3000)
}

// ============================================================================
// Auth
// ============================================================================
const AUTH_ERRORS: Record<string, string> = {
  'auth/email-already-in-use': 'That username is taken. Try another one.',
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/invalid-login-credentials': 'Wrong username or password.',
  'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': "Can't reach the server. Check your connection.",
  'auth/operation-not-allowed': 'Email/Password sign-in is turned off in the Firebase console.',
}
export const authError = (e: unknown) =>
  AUTH_ERRORS[(e as { code?: string })?.code ?? ''] ?? (e as Error)?.message ?? 'Something went wrong.'

export async function signIn(username: string, pass: string) {
  if (!USERNAME_RE.test(username)) throw new Error('Usernames are 3–20 characters: a–z, 0–9 and _.')
  if (pass.length < 6) throw new Error('Password needs at least 6 characters.')
  await signInWithEmailAndPassword(auth, usernameToLogin(username), pass)
}

export async function signUp(username: string, pass: string, pass2: string, name: string) {
  if (!USERNAME_RE.test(username)) throw new Error('Usernames are 3–20 characters: a–z, 0–9 and _.')
  if (pass.length < 6) throw new Error('Password needs at least 6 characters.')
  if (pass !== pass2) throw new Error("Passwords don't match.")
  live.pendingSignupName = name || username
  try {
    // Auth refuses a second account for the same login, which keeps usernames unique.
    await createUserWithEmailAndPassword(auth, usernameToLogin(username), pass)
  } catch (e) {
    live.pendingSignupName = null
    throw e
  }
}

export async function createProfile(u: User, displayName: string) {
  const username = loginToUsername(u.email)
  const b = writeBatch(db)
  b.set(doc(db, 'usernames', username), { uid: u.uid })
  b.set(userRef(u.uid), {
    uid: u.uid,
    username,
    displayName: (displayName || username).slice(0, 32),
    photoURL: '',
    bio: '',
    status: 'online',
    dndUntil: null,
    state: 'active',
    lastActive: serverTimestamp(),
    createdAt: serverTimestamp(),
    muted: [],
  })
  await b.commit()
}

export async function finishOnboarding(name: string) {
  const u = auth.currentUser
  if (!u) return
  await createProfile(u, name)
  startApp()
}

export const onboardDefaults = () => ({
  username: loginToUsername(auth.currentUser?.email),
  name: live.pendingSignupName ?? loginToUsername(auth.currentUser?.email),
})

export async function doSignOut() {
  const uid = get().uid
  if (uid) await updateDoc(userRef(uid), { state: 'offline' }).catch(() => {})
  if (uid) await N.disablePush(uid)
  location.hash = ''
  await signOut(auth)
}

export async function changePassword(cur: string, next: string) {
  if (next.length < 6) throw new Error('New password needs at least 6 characters.')
  const u = auth.currentUser
  if (!u?.email) throw new Error('Not signed in.')
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, cur))
  await updatePassword(u, next)
}

async function onAuth(u: User | null) {
  teardown()
  if (!u) {
    set({ uid: null, screen: 'auth' })
    return
  }
  set({ uid: u.uid, screen: 'boot' })
  let exists = false
  try {
    exists = (await getDoc(userRef(u.uid))).exists()
  } catch (e) {
    console.warn(e)
    if (isCacheFailure(e)) return void recoverCache()
  }
  if (exists) return startApp()
  if (live.pendingSignupName) {
    try {
      await createProfile(u, live.pendingSignupName)
      live.pendingSignupName = null
      return startApp()
    } catch (e) {
      console.warn(e)
    }
  }
  // Account exists but the profile write never landed (e.g. went offline mid-signup).
  set({ screen: 'onboard' })
}

export function boot() {
  N.registerSW()
  onAuthStateChanged(auth, onAuth)
  window.addEventListener('hashchange', route)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', () => {
    maybeMarkRead()
    onVisibility()
  })
  window.addEventListener('pagehide', () => {
    const uid = get().uid
    if (uid) updateDoc(userRef(uid), { state: 'offline' }).catch(() => {})
  })
  document.addEventListener('pointerdown', N.unlockAudio, { once: true })
  document.addEventListener('keydown', N.unlockAudio, { once: true })
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open-chat') location.hash = `#/chat/${e.data.chatId}`
  })
}

// ============================================================================
// Lifecycle
// ============================================================================
function startApp() {
  if (live.started) return
  live.started = true
  live.sessionStart = Date.now()
  const uid = get().uid!
  set({ screen: 'boot' })
  watchUser(uid)
  const listenChats = () =>
    live.unsubs.push(
      onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', uid)), onChats, (e) =>
        onListenError(e, listenChats),
      ),
    )
  const listenRels = () =>
    live.unsubs.push(
      onSnapshot(query(collection(db, 'friendRequests'), where('participants', 'array-contains', uid)), onRels, (e) =>
        onListenError(e, listenRels),
      ),
    )
  listenChats()
  listenRels()
  startPresence()
  initCalls({
    uid,
    user,
    toast,
    onLog: (chatId: string, text: string) => {
      const c = get().chats[chatId]
      if (c) void postMessage(c, { system: true, text })
    },
  })
  // Re-evaluate "online"/typing freshness and DND expiry without new data.
  live.timers.push(setInterval(() => set((s) => ({ tick: s.tick + 1 })), 1000))
  if (N.permission() === 'granted' && N.pushConfigured()) void N.enablePush(uid)
}

function teardown() {
  live.unsubs.forEach((u) => u())
  live.userUnsubs.forEach((u) => u())
  live.timers.forEach(clearInterval)
  live.msgUnsub?.()
  live.wallUnsub?.()
  stopCalls()
  Object.assign(live, {
    unsubs: [],
    userUnsubs: new Map(),
    timers: [],
    msgUnsub: null,
    wallUnsub: null,
    started: false,
    lastState: null,
  })
  clearTimeout(awayTimer)
  lastState = null
  const { toasts } = get()
  set({ ...initialState, toasts, appTheme: get().appTheme })
  N.setBadge(0)
}

function watchUser(uid: string) {
  if (!uid || live.userUnsubs.has(uid)) return
  live.userUnsubs.set(
    uid,
    onSnapshot(
      userRef(uid),
      (snap) => {
        if (!snap.exists()) return
        const profile = { id: uid, ...snap.data({ serverTimestamps: 'estimate' }) } as UserProfile
        set((s) => ({ users: { ...s.users, [uid]: profile } }))
        if (uid === get().uid) {
          const first = !get().me
          set({ me: profile })
          applyMyDndExpiry()
          if (first) {
            set({ screen: 'app' })
            route()
          }
        }
      },
      (e) => {
        console.warn('user listener', uid, e)
        if (isCacheFailure(e)) void recoverCache()
      },
    ),
  )
}

function onChats(snap: import('firebase/firestore').QuerySnapshot) {
  const chats = { ...get().chats }
  const loaded = get().chatsLoaded
  for (const ch of snap.docChanges()) {
    const id = ch.doc.id
    if (ch.type === 'removed') {
      delete chats[id]
      continue
    }
    const prev = chats[id]
    const c = { id, ...ch.doc.data({ serverTimestamps: 'estimate' }) } as Chat
    chats[id] = c
    c.members.forEach(watchUser)
    if (loaded) setTimeout(() => maybeNotify(c, prev), 0)
  }
  set({ chats, chatsLoaded: true })
  updateBadge()
  maybeMarkRead()
}

function onRels(snap: import('firebase/firestore').QuerySnapshot) {
  const rels: Record<string, Rel> = {}
  for (const d of snap.docs) rels[d.id] = { id: d.id, ...d.data() } as Rel
  set({ rels })
  const uid = get().uid
  for (const r of Object.values(rels)) watchUser(r.participants.find((p) => p !== uid) ?? r.to)
}

// ============================================================================
// Routing (hash based, same URLs as v1)
// ============================================================================
function parseHash(): Route {
  const m = location.hash.match(/^#\/chat\/([\w-]+)/)
  if (m) return { view: 'chat', id: m[1] }
  if (location.hash.startsWith('#/friends')) return { view: 'friends' }
  return { view: 'home' }
}

export function route() {
  if (!get().me) return
  const r = parseHash()
  const prev = get().route
  const changed = r.view !== prev.view || (r.view === 'chat' && prev.view === 'chat' ? r.id !== prev.id : r.view === 'chat')
  if (changed) {
    stopTyping()
    set({ replyTo: null, editing: null, urgentNext: false, detailsOpen: false })
  }
  set({ route: r })
  if (r.view === 'chat') {
    subscribeMessages(r.id)
    void N.clearChatNotifications(r.id)
  } else {
    live.msgUnsub?.()
    live.wallUnsub?.()
    live.msgUnsub = null
    live.wallUnsub = null
    set({ msgChatId: null, msgs: [], wall: null })
  }
}

// ============================================================================
// Messages
// ============================================================================
function subscribeMessages(chatId: string) {
  if (get().msgChatId === chatId) return
  live.msgUnsub?.()
  live.msgLimit = 50
  set({ msgChatId: chatId, msgs: [], hasMore: false })
  listenMessages()
  listenWallpaper(chatId)
}

function listenMessages() {
  live.msgUnsub?.()
  const id = get().msgChatId
  if (!id) return
  const q = query(collection(db, 'chats', id, 'messages'), orderBy('createdAt', 'desc'), limit(live.msgLimit))
  live.msgUnsub = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      if (get().msgChatId !== id) return
      const msgs = snap.docs
        .map(
          (d) =>
            ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pending: d.metadata.hasPendingWrites }) as Message,
        )
        .reverse()
      set({ msgs, hasMore: snap.size >= live.msgLimit })
      maybeMarkRead()
    },
    (e) => onListenError(e, () => get().msgChatId === id && listenMessages()),
  )
}

export function loadOlder() {
  if (!get().hasMore) return
  live.msgLimit += 50
  listenMessages()
}

function listenWallpaper(chatId: string) {
  live.wallUnsub?.()
  set({ wall: null })
  live.wallUnsub = onSnapshot(
    styleRef(chatId),
    (snap) => {
      if (get().msgChatId !== chatId) return
      set({ wall: (snap.data()?.wallpaper as string) || null })
    },
    (e) => console.warn('wallpaper', e),
  )
}

export async function setWallpaper(c: Chat, dataUrl: string) {
  try {
    await setDoc(styleRef(c.id), { wallpaper: dataUrl, by: get().uid, updatedAt: serverTimestamp() })
    void postMessage(c, { system: true, text: dataUrl ? 'changed the chat background' : 'removed the chat background' })
  } catch (e) {
    toast((e as { code?: string }).code === 'permission-denied' ? "Couldn't change the background" : String((e as Error).message), 'error')
  }
}

const MEDIA_LABEL = { image: '📷 Photo', video: '🎬 Video', audio: '🎤 Voice message' } as const

export function newMessageId(chatId: string) {
  return doc(collection(db, 'chats', chatId, 'messages')).id
}

export function postMessage(
  c: Chat,
  {
    text = '',
    image = null,
    replyTo = null,
    system = false,
    effect,
    media,
    id,
  }: {
    text?: string
    image?: string | null
    replyTo?: Message['replyTo'] | null
    system?: boolean
    effect?: string
    media?: Message['media']
    /** Pre-allocated id (media uploads use it as their Storage folder). */
    id?: string
  },
) {
  const uid = get().uid!
  const ref = id ? doc(db, 'chats', c.id, 'messages', id) : doc(collection(db, 'chats', c.id, 'messages'))
  const msg: Record<string, unknown> = { senderId: uid, createdAt: serverTimestamp(), text }
  if (image) msg.image = image
  if (replyTo) msg.replyTo = replyTo
  if (system) msg.system = true
  if (effect) msg.effect = effect
  if (media) msg.media = media
  const label = media ? MEDIA_LABEL[media.kind] : image ? (isGif(image) ? 'GIF' : '📷 Photo') : ''
  if (get().urgentNext && !system) {
    msg.urgent = true
    set({ urgentNext: false })
  }
  const b = writeBatch(db)
  b.set(ref, msg)
  b.update(chatRef(c.id), {
    lastMessage: {
      id: ref.id,
      senderId: uid,
      text: (text || '').slice(0, 200) || label,
      createdAt: serverTimestamp(),
      system,
      urgent: !!msg.urgent,
    },
    updatedAt: serverTimestamp(),
    [`lastRead.${uid}`]: serverTimestamp(),
    [`typing.${uid}`]: deleteField(),
  })
  live.typingSentAt = 0
  if (!system) N.playSound('out')
  return b.commit().catch((e) => {
    console.error(e)
    toast('Message failed to send', 'error')
  })
}

export async function editMessage(c: Chat, m: Message, text: string) {
  if (text === m.text) return
  const b = writeBatch(db)
  b.update(msgRef(c.id, m.id), { text, edited: true, editedAt: serverTimestamp() })
  if (c.lastMessage?.id === m.id) b.update(chatRef(c.id), { 'lastMessage.text': text.slice(0, 200) })
  await b.commit().catch(() => toast("Couldn't edit that message", 'error'))
}

export function toggleReaction(m: Message, emoji: string) {
  const { uid, msgChatId } = get()
  if (!uid || !msgChatId) return
  const mineNow = m.reactions?.[uid]
  updateDoc(msgRef(msgChatId, m.id), { [`reactions.${uid}`]: mineNow === emoji ? deleteField() : emoji }).catch(() =>
    toast("Couldn't react", 'error'),
  )
}

export function unsend(m: Message) {
  const c = get().chats[get().msgChatId ?? '']
  if (!c) return
  const b = writeBatch(db)
  b.update(msgRef(c.id, m.id), { deleted: true, text: '', image: deleteField(), media: deleteField(), effect: deleteField(), transcript: deleteField() })
  void deleteMedia(m.media)
  if (m.media && isChunked(m.media.url)) void deleteChunks(c.id, m.id)
  if (c.lastMessage?.id === m.id) b.update(chatRef(c.id), { 'lastMessage.text': 'unsent a message', 'lastMessage.system': true })
  b.commit().catch(() => toast("Couldn't unsend", 'error'))
}

// ---------- typing ----------
export function noteTyping(has: boolean) {
  const { uid, route: r, editing } = get()
  if (!uid || r.view !== 'chat') return
  if (has && !editing && Date.now() - live.typingSentAt > 3000) {
    live.typingSentAt = Date.now()
    updateDoc(chatRef(r.id), { [`typing.${uid}`]: Date.now() }).catch(() => {})
  } else if (!has) stopTyping()
}

export function stopTyping() {
  const { uid, route: r } = get()
  if (!live.typingSentAt || !uid || r.view !== 'chat') return
  live.typingSentAt = 0
  updateDoc(chatRef(r.id), { [`typing.${uid}`]: deleteField() }).catch(() => {})
}

// ---------- read receipts (always on) ----------
let nearBottomFn: () => boolean = () => true
export const setNearBottomProbe = (fn: () => boolean) => {
  nearBottomFn = fn
}

export function maybeMarkRead() {
  const { route: r, chats, uid } = get()
  if (r.view !== 'chat' || !uid) return
  const c = chats[r.id]
  if (!c || !isUnread(c) || live.marking === c.id) return
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return
  if (!nearBottomFn()) return
  live.marking = c.id
  updateDoc(chatRef(c.id), { [`lastRead.${uid}`]: serverTimestamp() })
    .catch(() => {})
    .finally(() => {
      live.marking = null
    })
  void N.clearChatNotifications(c.id)
}

export const markRead = (c: Chat) => updateDoc(chatRef(c.id), { [`lastRead.${get().uid}`]: serverTimestamp() })

// ============================================================================
// Conversations
// ============================================================================
export async function openDM(uid: string) {
  const me = get().uid!
  const id = dmId(me, uid)
  if (!get().chats[id]) {
    try {
      const snap = await getDoc(chatRef(id))
      if (!snap.exists()) {
        await setDoc(chatRef(id), {
          type: 'dm',
          members: [me, uid].sort(),
          createdBy: me,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastRead: {},
          typing: {},
          lastMessage: null,
        })
      }
    } catch (e) {
      console.error(e)
      return toast(isFriend(uid) ? "Couldn't open that conversation" : 'You can only message friends.', 'error')
    }
  }
  location.hash = `#/chat/${id}`
}

export async function createGroup(uids: string[], name: string) {
  const me = get().uid!
  const ref = doc(collection(db, 'chats'))
  const msg = doc(collection(db, 'chats', ref.id, 'messages'))
  const b = writeBatch(db)
  b.set(ref, {
    type: 'group',
    name: name || '',
    members: [me, ...uids],
    createdBy: me,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastRead: { [me]: serverTimestamp() },
    typing: {},
    lastMessage: { id: msg.id, senderId: me, text: 'created the group', createdAt: serverTimestamp(), system: true },
  })
  b.set(msg, { senderId: me, createdAt: serverTimestamp(), text: 'created the group', system: true })
  await b.commit()
  location.hash = `#/chat/${ref.id}`
}

export function renameGroup(c: Chat, name: string) {
  updateDoc(chatRef(c.id), { name }).catch(() => toast("Couldn't rename", 'error'))
  void postMessage(c, { system: true, text: name ? `named the conversation “${name}”` : 'removed the conversation name' })
}

export async function addPeople(c: Chat, uids: string[]) {
  await updateDoc(chatRef(c.id), { members: arrayUnion(...uids) })
  void postMessage({ ...c, members: [...c.members, ...uids] }, { system: true, text: `added ${uids.map((u) => user(u).displayName).join(', ')}` })
}

export async function leaveGroup(c: Chat) {
  await postMessage(c, { system: true, text: 'left the conversation' })
  await updateDoc(chatRef(c.id), { members: arrayRemove(get().uid) })
  location.hash = '#/'
}

export function toggleMute(c: Chat) {
  void updateDoc(userRef(get().uid!), { muted: isMuted(c) ? arrayRemove(c.id) : arrayUnion(c.id) })
}

// ============================================================================
// Friends
// ============================================================================
export async function sendFriendRequest(raw: string) {
  const me = get().uid!
  const name = raw.trim().replace(/^@/, '').toLowerCase()
  if (!USERNAME_RE.test(name)) throw new Error("That doesn't look like a username.")
  const snap = await getDoc(doc(db, 'usernames', name))
  if (!snap.exists()) throw new Error("Hm, didn't work. Double check that the username is correct.")
  const to = snap.data().uid as string
  if (to === me) throw new Error("That's you!")
  const rel = relWith(to)
  if (rel?.status === 'accepted') throw new Error(`You're already friends with @${name}.`)
  if (rel?.from === me) throw new Error(`You already sent @${name} a request.`)
  if (rel?.to === me) {
    await acceptRequest(rel.id)
    return `You and @${name} are now friends!`
  }
  await setDoc(doc(db, 'friendRequests', pairId(me, to)), {
    from: me,
    to,
    participants: [me, to].sort(),
    status: 'pending',
    createdAt: serverTimestamp(),
  })
  return `Friend request sent to @${name}.`
}

export const acceptRequest = (id: string) =>
  updateDoc(doc(db, 'friendRequests', id), { status: 'accepted', acceptedAt: serverTimestamp() })
export const deleteRel = (id: string) => deleteDoc(doc(db, 'friendRequests', id))
export const removeFriend = (uid: string) => deleteRel(pairId(get().uid!, uid))

// ============================================================================
// Presence & Do Not Disturb (heartbeat: offline once lastActive goes stale)
// ============================================================================
let awayTimer: ReturnType<typeof setTimeout> | undefined
let lastState: string | null = null

function writePresence(state: string) {
  const uid = get().uid
  if (!uid) return
  lastState = state
  updateDoc(userRef(uid), { state, lastActive: serverTimestamp() }).catch(() => {})
}

function onVisibility() {
  if (!get().uid) return
  clearTimeout(awayTimer)
  if (document.visibilityState === 'visible') {
    if (lastState !== 'active') writePresence('active')
    maybeMarkRead()
  } else {
    awayTimer = setTimeout(() => writePresence('away'), 60e3)
  }
}

function startPresence() {
  writePresence(document.visibilityState === 'visible' ? 'active' : 'away')
  live.timers.push(setInterval(() => writePresence(lastState || 'active'), 3 * 60e3))
}

export function setStatus(status: string, dndMinutes: number | null = null) {
  const data: Record<string, unknown> = { status, dndUntil: null }
  if (status === 'dnd' && dndMinutes) data.dndUntil = new Date(Date.now() + dndMinutes * 60e3)
  updateDoc(userRef(get().uid!), data).catch(() => toast("Couldn't update your status", 'error'))
  if (status === 'dnd') toast('Do Not Disturb is on. Friends will see that your notifications are silenced.')
}

function applyMyDndExpiry() {
  const u = get().me
  if (u?.status === 'dnd' && ms(u.dndUntil) && ms(u.dndUntil) <= Date.now()) {
    updateDoc(userRef(get().uid!), { status: 'online', dndUntil: null }).catch(() => {})
  }
}

export const updateProfile = (patch: Partial<UserProfile>) => updateDoc(userRef(get().uid!), patch)

// ============================================================================
// Notifications
// ============================================================================
function maybeNotify(c: Chat, prev?: Chat) {
  const lm = c.lastMessage
  const uid = get().uid
  if (!lm || lm.senderId === uid || lm.system) return
  const t = ms(lm.createdAt)
  if (t <= live.sessionStart || ms(prev?.lastMessage?.createdAt) >= t || (live.lastNotified[c.id] ?? 0) >= t) return
  live.lastNotified[c.id] = t
  // Do Not Disturb silences everything unless the sender chose "Notify Anyway".
  if ((myDnd() || isMuted(c)) && !lm.urgent) return
  const r = get().route
  const viewing = r.view === 'chat' && r.id === c.id
  const focused = document.visibilityState === 'visible' && document.hasFocus()
  if (viewing && focused) return
  const sender = user(lm.senderId)
  const title = c.type === 'group' ? `${sender.displayName} in ${chatTitle(c)}` : sender.displayName
  const body = (lm.urgent ? '🌙 ' : '') + (lm.text || '📷 Photo')
  N.playSound('in')
  if (focused) toast(body, 'banner', 5000, { chatId: c.id, title, senderId: lm.senderId })
  else void N.notify({ title, body, icon: sender.photoURL || undefined, chatId: c.id, messageId: lm.id })
}

function updateBadge() {
  N.setBadge(sortedChats().filter((c) => isUnread(c) && !isMuted(c)).length)
}

export async function enableNotifications() {
  N.unlockAudio()
  const p = await N.requestPermission()
  set((s) => ({ tick: s.tick + 1 }))
  if (p === 'granted') {
    const push = await N.enablePush(get().uid)
    toast(push ? 'Notifications on, even when Bubbles is closed.' : 'Notifications on while Bubbles is open.')
  } else if (p === 'denied') {
    toast('Notifications are blocked. Allow them from the lock icon in the address bar.', 'error')
  }
}

export { N }

/** Sender adds the Whisper transcript after a voice message is sent. */
export const setTranscript = (chatId: string, msgId: string, transcript: string) =>
  updateDoc(msgRef(chatId, msgId), { transcript: transcript.slice(0, 4000) }).catch((e) => console.warn('transcript', e))
