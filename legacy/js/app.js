import * as F from './firebase.js';
import * as N from './notify.js';
import {
  $, $$, esc, ms, avatar, formatText, isEmojiOnly, fmtListTime, fmtStamp, fmtClock, fmtAgo,
  compressImage, I, logo, PRESENCE_LABEL,
} from './util.js';
import { GIF_CATEGORIES } from './gifs.js';
import { initCalls, stopCalls, startCall, inCall } from './call.js';

const { auth, db } = F;

// ============================================================================
// State
// ============================================================================
const S = {
  uid: null,
  me: null,
  users: new Map(),        // uid → profile
  userUnsubs: new Map(),
  chats: new Map(),        // chatId → chat
  chatsLoaded: false,
  rels: new Map(),         // pairId → friend request / friendship
  unsubs: [],
  timers: [],
  route: { view: 'home' },
  friendsTab: 'online',
  search: '',
  // open conversation
  msgs: [],
  msgChatId: null,
  msgUnsub: null,
  msgLimit: 50,
  hasMore: false,
  loadingOlder: false,
  firstPaint: true,
  replyTo: null,
  editing: null,
  urgentNext: false,
  detailsOpen: false,
  typingSentAt: 0,
  marking: null,
  wall: null,              // open chat's background image (data URL)
  wallUnsub: null,
  // notifications
  sessionStart: Date.now(),
  lastNotified: {},
};

const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
const MORE_REACTIONS = ['🔥', '😮', '😢', '🎉', '💀', '🙏'];
const GROUP_GAP = 5 * 60e3;   // bubbles closer than this stack together
const STAMP_GAP = 15 * 60e3;  // gap that earns a centered timestamp
const TYPING_TTL = 6000;
const OFFLINE_AFTER = 7 * 60e3;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMOJI_PICKER_URL = 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1.29.1/index.js';

// Bump APP_VERSION and rewrite PATCH_NOTES to show everyone a "What's new" popup once.
const APP_VERSION = '1.4.1';
const PATCH_INTRO = 'Since Yuriel Is A GOAT he decided to add video calls with live captions';
// Optional poll shown in the popup. Votes live in polls/<id>/votes/<uid>; use a new id for a new poll.
const PATCH_POLL = {
  id: 'goat-1',
  question: 'How much is Yuriel a GOAT for this app?',
  options: ['🐐 A little GOAT', '🐐🐐 Pretty big GOAT', '🐐🐐🐐 Huge GOAT', '🐐🐐🐐🐐 Biggest GOAT ever'],
};
const PATCH_NOTES = [
  { icon: '📹', title: 'Video calls', text: 'Open a chat with a friend and tap the <b>camera</b> at the top right to call them. Just like FaceTime, your camera is on while it rings, and you can drag your own picture to any corner. They need Bubbles open to hear it ring.' },
  { icon: '💬', title: 'Live captions', text: 'What each person says shows up as words at the bottom of the call, so you can follow along even with your sound off. Tap <b>CC</b> to hide or show them. Works best in Chrome or Edge.' },
  { icon: '🎬', title: 'GIFs', text: 'Tap <b>GIF</b> next to the message box to pick from hundreds of GIFs.' },
];

const pairId = (a, b) => [a, b].sort().join('_');
const dmId = (a, b) => `dm_${pairId(a, b)}`;
const userRef = (uid) => F.doc(db, 'users', uid);
const chatRef = (id) => F.doc(db, 'chats', id);
const msgRef = (chatId, id) => F.doc(db, 'chats', chatId, 'messages', id);
// Kept out of the chat doc so typing/read-receipt updates don't resend the image.
const styleRef = (chatId) => F.doc(db, 'chats', chatId, 'meta', 'style');
const user = (uid) => S.users.get(uid) || { id: uid, displayName: '…' };
const nameOf = (uid) => (uid === S.uid ? 'You' : user(uid).displayName || 'Someone');
const firstName = (uid) => nameOf(uid).split(' ')[0];
const pref = (k, d) => { try { return localStorage.getItem(`bubbles.${k}`) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`bubbles.${k}`, v); } catch { /* private mode */ } };

// ============================================================================
// Boot & auth
// ============================================================================
function show(id) {
  for (const s of ['boot', 'setup', 'auth', 'onboard', 'app']) $(`#${s}`).hidden = s !== id;
}

function boot() {
  $$('.logo-big, .boot-logo').forEach((el) => { el.innerHTML = logo(); });
  $$('[data-icon]').forEach((el) => { el.innerHTML = I[el.dataset.icon]; });
  if (!F.configured) return show('setup');
  N.registerSW();
  bindAuthForms();
  bindGlobalEvents();
  F.onAuthStateChanged(auth, onAuth);
  watchForUpdates();
}

// ---------- auto-update ----------
// GitHub Pages re-stamps every file on each deploy, so index.html's Last-Modified changes with any push.
let deployedAt = null;
let updateFound = false;

function watchForUpdates() {
  checkForUpdate();
  setInterval(checkForUpdate, 60e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
}

async function checkForUpdate() {
  if (updateFound) return reloadWhenIdle();
  try {
    const res = await fetch('./index.html', { method: 'HEAD', cache: 'no-store' });
    const stamp = res.ok && (res.headers.get('last-modified') || res.headers.get('etag'));
    if (!stamp) return;
    if (deployedAt === null) deployedAt = stamp;
    else if (stamp !== deployedAt) {
      updateFound = true;
      // Give the deploy a moment to reach every CDN edge before loading the new files.
      setTimeout(reloadWhenIdle, 15e3);
    }
  } catch { /* offline: try again next time */ }
}

// Never throw away a half-typed message or a dialog/menu someone is using; the next check retries.
function reloadWhenIdle() {
  const typing = [...$$('input, textarea')].some((el) => el.offsetParent && el.type !== 'checkbox' && el.value.trim());
  if (typing || inCall() || $('#modalRoot').children.length || $('#menuRoot').children.length) return;
  location.reload();
}

let signupMode = false;
let pendingSignupName = null;

function setAuthMode(signup) {
  signupMode = signup;
  $('#authTitle').textContent = signup ? 'Create account' : 'Bubbles';
  $('#authSub').textContent = signup ? 'Just a username and password. No email needed.' : 'Sign in to chat with your friends.';
  $('#authNameRow').hidden = !signup;
  $('#authPass2Row').hidden = !signup;
  $('#authHint').hidden = !signup;
  $('#authSubmit').textContent = signup ? 'Create Account' : 'Sign In';
  $('#authAltText').textContent = signup ? 'Have an account?' : 'New here?';
  $('#authToggle').textContent = signup ? 'Sign in' : 'Create an account';
  $('#authPass').autocomplete = signup ? 'new-password' : 'current-password';
  $('#authErr').textContent = '';
}

const AUTH_ERRORS = {
  'auth/email-already-in-use': 'That username is taken. Try another one.',
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/invalid-login-credentials': 'Wrong username or password.',
  'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': "Can't reach the server. Check your connection.",
  'auth/operation-not-allowed': 'Turn on Email/Password sign-in in the Firebase console (see README).',
};
const authError = (e) => AUTH_ERRORS[e?.code] || e?.message || 'Something went wrong.';

function bindAuthForms() {
  $('#authToggle').onclick = () => setAuthMode(!signupMode);
  $('#authUser').addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  });
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#authErr');
    const username = $('#authUser').value.trim();
    const pass = $('#authPass').value;
    err.textContent = '';
    if (!USERNAME_RE.test(username)) return (err.textContent = 'Usernames are 3–20 characters: a–z, 0–9 and _.');
    if (pass.length < 6) return (err.textContent = 'Password needs at least 6 characters.');
    const btn = $('#authSubmit');
    btn.disabled = true;
    try {
      if (signupMode) {
        const name = $('#authName').value.trim() || username;
        if (pass !== $('#authPass2').value) throw { message: "Passwords don't match." };
        pendingSignupName = name;
        // Auth refuses a second account for the same login, which makes usernames unique.
        await F.createUserWithEmailAndPassword(auth, F.usernameToLogin(username), pass);
      } else {
        await F.signInWithEmailAndPassword(auth, F.usernameToLogin(username), pass);
      }
    } catch (ex) {
      pendingSignupName = null;
      err.textContent = authError(ex);
    } finally {
      btn.disabled = false;
    }
  };

  $('#onboardForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createProfile(auth.currentUser, $('#obName').value.trim());
      startApp();
    } catch (ex) {
      $('#obErr').textContent = ex.message || 'Could not save your profile.';
    }
  };
  $('#obSignOut').onclick = () => F.signOut(auth);
}

async function createProfile(u, displayName) {
  const username = F.loginToUsername(u.email);
  const b = F.writeBatch(db);
  b.set(F.doc(db, 'usernames', username), { uid: u.uid });
  b.set(userRef(u.uid), {
    uid: u.uid,
    username,
    displayName: (displayName || username).slice(0, 32),
    photoURL: '',
    bio: '',
    status: 'online',
    dndUntil: null,
    state: 'active',
    lastActive: F.serverTimestamp(),
    createdAt: F.serverTimestamp(),
    muted: [],
  });
  await b.commit();
}

async function onAuth(u) {
  teardown();
  if (!u) {
    S.uid = null;
    setAuthMode(signupMode);
    $('#authPass').value = '';
    $('#authPass2').value = '';
    return show('auth');
  }
  S.uid = u.uid;
  show('boot');
  let snap = null;
  try { snap = await F.getDoc(userRef(u.uid)); } catch (e) { console.warn(e); }
  if (snap?.exists()) return startApp();
  if (pendingSignupName) {
    try {
      await createProfile(u, pendingSignupName);
      pendingSignupName = null;
      return startApp();
    } catch (e) { console.warn(e); }
  }
  // Account exists but the profile write never landed (e.g. went offline mid-signup).
  $('#obUser').textContent = `@${F.loginToUsername(u.email)}`;
  $('#obName').value = pendingSignupName || F.loginToUsername(u.email);
  show('onboard');
}

// ============================================================================
// App lifecycle
// ============================================================================
function startApp() {
  if (S.started) return;
  S.started = true;
  S.sessionStart = Date.now();
  show('boot');
  watchUser(S.uid);
  S.unsubs.push(F.onSnapshot(
    F.query(F.collection(db, 'chats'), F.where('members', 'array-contains', S.uid)),
    onChats, onListenError,
  ));
  S.unsubs.push(F.onSnapshot(
    F.query(F.collection(db, 'friendRequests'), F.where('participants', 'array-contains', S.uid)),
    onRels, onListenError,
  ));
  startPresence();
  initCalls({
    uid: S.uid, user, toast,
    onLog: (chatId, text) => { const c = S.chats.get(chatId); if (c) postMessage(c, { system: true, text }); },
  });
  // Re-evaluate "online"/typing freshness and DND expiry without new data.
  S.timers.push(setInterval(() => { render('nav', 'header', 'friends'); renderTyping(); }, 30e3));
  S.timers.push(setInterval(renderTyping, 1000));
  if (N.permission() === 'granted' && N.pushConfigured()) N.enablePush(S.uid);
}

function teardown() {
  S.unsubs.forEach((u) => u());
  S.userUnsubs.forEach((u) => u());
  S.timers.forEach(clearInterval);
  S.msgUnsub?.();
  S.wallUnsub?.();
  stopPoll();
  stopCalls();
  Object.assign(S, {
    started: false, wall: null, wallUnsub: null, me: null, unsubs: [], timers: [], userUnsubs: new Map(), users: new Map(),
    chats: new Map(), rels: new Map(), chatsLoaded: false, msgUnsub: null, msgChatId: null, msgs: [],
    route: { view: 'home' }, builtChat: null, builtFriends: false,
  });
  $('#main') && ($('#main').innerHTML = '');
  stopPresence();
  N.setBadge(0);
}

function onListenError(e) {
  console.error(e);
  toast(e.code === 'permission-denied' ? 'Permission denied. Did you publish firestore.rules?' : 'Connection problem. Retrying…', 'error');
}

function watchUser(uid) {
  if (!uid || S.userUnsubs.has(uid)) return;
  S.userUnsubs.set(uid, F.onSnapshot(userRef(uid), (snap) => {
    if (!snap.exists()) return;
    S.users.set(uid, { id: uid, ...snap.data({ serverTimestamps: 'estimate' }) });
    if (uid === S.uid) {
      const first = !S.me;
      S.me = S.users.get(uid);
      applyMyDndExpiry();
      if (first) {
        show('app');
        route();
        setTimeout(maybeShowPatchNotes, 600);
      }
    }
    render('all');
  }, (e) => console.warn('user listener', uid, e)));
}

function onChats(snap) {
  for (const ch of snap.docChanges()) {
    const id = ch.doc.id;
    if (ch.type === 'removed') {
      S.chats.delete(id);
      continue;
    }
    const prev = S.chats.get(id);
    const c = { id, ...ch.doc.data({ serverTimestamps: 'estimate' }) };
    S.chats.set(id, c);
    c.members.forEach(watchUser);
    if (S.chatsLoaded) maybeNotify(c, prev);
  }
  S.chatsLoaded = true;
  render('nav', 'header', 'msgs');
  renderTyping();
  updateBadge();
  maybeMarkRead();
  if (S.route.view === 'chat' && !S.chats.has(S.route.id)) render('main');
}

function onRels(snap) {
  S.rels = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  for (const r of S.rels.values()) watchUser(otherOf(r));
  render('nav', 'friends');
}

// ============================================================================
// Friends
// ============================================================================
const otherOf = (r) => r.participants.find((p) => p !== S.uid);
const relWith = (uid) => S.rels.get(pairId(S.uid, uid));
const isFriend = (uid) => relWith(uid)?.status === 'accepted';
const friendIds = () => [...S.rels.values()].filter((r) => r.status === 'accepted').map(otherOf);
const incoming = () => [...S.rels.values()].filter((r) => r.status === 'pending' && r.to === S.uid);
const outgoing = () => [...S.rels.values()].filter((r) => r.status === 'pending' && r.from === S.uid);
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));

async function sendFriendRequest(raw) {
  const name = raw.trim().replace(/^@/, '').toLowerCase();
  if (!USERNAME_RE.test(name)) throw new Error("That doesn't look like a username.");
  const snap = await F.getDoc(F.doc(db, 'usernames', name));
  if (!snap.exists()) throw new Error("Hm, didn't work. Double check that the username is correct.");
  const to = snap.data().uid;
  if (to === S.uid) throw new Error("That's you!");
  const rel = relWith(to);
  if (rel?.status === 'accepted') throw new Error(`You're already friends with @${name}.`);
  if (rel?.from === S.uid) throw new Error(`You already sent @${name} a request.`);
  if (rel?.to === S.uid) {
    await acceptRequest(rel.id);
    return `You and @${name} are now friends!`;
  }
  await F.setDoc(F.doc(db, 'friendRequests', pairId(S.uid, to)), {
    from: S.uid, to, participants: [S.uid, to].sort(), status: 'pending', createdAt: F.serverTimestamp(),
  });
  return `Friend request sent to @${name}.`;
}

const acceptRequest = (id) => F.updateDoc(F.doc(db, 'friendRequests', id), { status: 'accepted', acceptedAt: F.serverTimestamp() });
const deleteRel = (id) => F.deleteDoc(F.doc(db, 'friendRequests', id));

// ============================================================================
// Presence & Do Not Disturb
// ============================================================================
// Firestore has no "on disconnect", so presence is a heartbeat: a user is offline once
// their lastActive goes stale.
let awayTimer = null;
let lastState = null;

function writePresence(state) {
  if (!S.uid) return;
  lastState = state;
  F.updateDoc(userRef(S.uid), { state, lastActive: F.serverTimestamp() }).catch(() => {});
}

function onVisibility() {
  if (!S.uid) return;
  clearTimeout(awayTimer);
  if (document.visibilityState === 'visible') {
    if (lastState !== 'active') writePresence('active');
    maybeMarkRead();
  } else {
    awayTimer = setTimeout(() => writePresence('away'), 60e3);
  }
}

function startPresence() {
  writePresence(document.visibilityState === 'visible' ? 'active' : 'away');
  S.timers.push(setInterval(() => writePresence(lastState || 'active'), 3 * 60e3));
}
function stopPresence() { clearTimeout(awayTimer); lastState = null; }

function dndActive(u) {
  if (u?.status !== 'dnd') return false;
  const until = ms(u.dndUntil);
  return !until || until > Date.now();
}

function presenceOf(uid) {
  const u = S.users.get(uid);
  if (!u) return 'offline';
  if (uid === S.uid) {
    if (dndActive(u)) return 'dnd';
    return u.status === 'invisible' ? 'offline' : u.status === 'idle' ? 'idle' : 'online';
  }
  if (u.status === 'invisible' || u.state === 'offline' || Date.now() - ms(u.lastActive) > OFFLINE_AFTER) return 'offline';
  if (dndActive(u)) return 'dnd';
  if (u.status === 'idle' || u.state === 'away') return 'idle';
  return 'online';
}

function presenceText(uid) {
  const p = presenceOf(uid);
  const u = user(uid);
  if (p === 'dnd') {
    const until = ms(u.dndUntil);
    return until ? `Do Not Disturb until ${fmtClock(until)}` : 'Do Not Disturb';
  }
  if (p === 'online') return 'Active now';
  if (p === 'idle') return 'Idle';
  return u.lastActive && u.status !== 'invisible' ? `Active ${fmtAgo(ms(u.lastActive))}` : 'Offline';
}

const myDnd = () => dndActive(S.me);

function setStatus(status, dndMinutes = null) {
  const data = { status, dndUntil: null };
  if (status === 'dnd' && dndMinutes) data.dndUntil = new Date(Date.now() + dndMinutes * 60e3);
  F.updateDoc(userRef(S.uid), data).catch(() => toast("Couldn't update your status", 'error'));
  if (status === 'dnd') toast('Do Not Disturb is on. Friends will see that your notifications are silenced.');
}

// Turn an expired timed DND back off so friends stop seeing it.
function applyMyDndExpiry() {
  const u = S.me;
  if (u?.status === 'dnd' && ms(u.dndUntil) && ms(u.dndUntil) <= Date.now()) {
    F.updateDoc(userRef(S.uid), { status: 'online', dndUntil: null }).catch(() => {});
  }
}

// ============================================================================
// Routing
// ============================================================================
function parseHash() {
  const m = location.hash.match(/^#\/chat\/([\w-]+)/);
  if (m) return { view: 'chat', id: m[1] };
  if (location.hash.startsWith('#/friends')) return { view: 'friends' };
  return { view: 'home' };
}

function route() {
  if (!S.me) return;
  const r = parseHash();
  const changed = r.view !== S.route.view || r.id !== S.route.id;
  if (changed) stopTyping();
  S.route = r;
  if (changed) {
    closeMenu();
    Object.assign(S, { replyTo: null, editing: null, urgentNext: false, detailsOpen: false, builtChat: null, builtFriends: false });
  }
  if (r.view === 'chat') {
    subscribeMessages(r.id);
    N.clearChatNotifications(r.id);
  } else {
    S.msgUnsub?.();
    S.wallUnsub?.();
    Object.assign(S, { msgUnsub: null, msgChatId: null, msgs: [], wall: null, wallUnsub: null });
  }
  $('#app').classList.toggle('show-main', r.view !== 'home');
  render('all');
}

// ============================================================================
// Rendering (batched per animation frame)
// ============================================================================
const dirty = new Set();
let raf = 0;
function render(...parts) {
  parts.forEach((p) => dirty.add(p));
  if (!raf) raf = requestAnimationFrame(flush);
}
function flush() {
  raf = 0;
  if (!S.me) return dirty.clear();
  const d = new Set(dirty);
  dirty.clear();
  const all = d.has('all');
  if (all || d.has('nav')) { renderRail(); renderChatList(); renderUserPanel(); renderNotifBanner(); }
  if (all || d.has('main')) renderMain();
  else {
    if (d.has('friends') && S.route.view !== 'chat') renderFriends();
    if (d.has('header') && S.route.view === 'chat') renderChatChrome();
    if (d.has('msgs') && S.route.view === 'chat') renderMessages();
  }
}

// ---------- chat helpers ----------
const sortedChats = () => [...S.chats.values()].sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
const otherMember = (c) => c.members.find((m) => m !== S.uid) || S.uid;
const isMuted = (c) => (S.me?.muted || []).includes(c.id);

function chatTitle(c) {
  if (c.type === 'dm') return user(otherMember(c)).displayName;
  if (c.name) return c.name;
  const others = c.members.filter((m) => m !== S.uid);
  const names = others.slice(0, 3).map(firstName);
  return others.length > 3 ? `${names.join(', ')} +${others.length - 3}` : names.join(', ') || 'Group';
}

function chatAvatar(c, size = 44, withPresence = true) {
  if (c.type === 'dm') {
    const o = otherMember(c);
    return avatar(user(o), size, withPresence ? presenceOf(o) : null);
  }
  if (c.photoURL) return avatar({ id: c.id, displayName: chatTitle(c), photoURL: c.photoURL }, size);
  const others = c.members.filter((m) => m !== S.uid).slice(0, 2);
  if (others.length < 2) return avatar({ id: c.id, displayName: chatTitle(c) }, size);
  const s = Math.round(size * 0.68);
  return `<span class="avatar-stack" style="--s:${size}px">${avatar(user(others[0]), s)}${avatar(user(others[1]), s)}</span>`;
}

function isUnread(c) {
  const lm = c.lastMessage;
  return !!lm && lm.senderId !== S.uid && ms(lm.createdAt) > ms(c.lastRead?.[S.uid]);
}

function typers(c) {
  const now = Date.now();
  return Object.entries(c.typing || {})
    .filter(([uid, t]) => uid !== S.uid && now - t < TYPING_TTL && c.members.includes(uid))
    .map(([uid]) => uid);
}

function previewText(c) {
  const lm = c.lastMessage;
  if (!lm) return c.type === 'group' ? 'Group created' : 'Say hi 👋';
  if (lm.system) return `${nameOf(lm.senderId)} ${lm.text}`;
  const body = lm.text || '📷 Photo';
  if (lm.senderId === S.uid) return `You: ${body}`;
  return c.type === 'group' ? `${firstName(lm.senderId)}: ${body}` : body;
}

// ---------- rail (Discord server column) ----------
function renderRail() {
  const unreadDms = sortedChats().filter((c) => c.type === 'dm' && isUnread(c));
  const groups = sortedChats().filter((c) => c.type === 'group');
  const item = (c) => {
    const active = S.route.view === 'chat' && S.route.id === c.id;
    const unread = isUnread(c);
    return `<a class="rail-item ${active ? 'active' : ''} ${unread ? 'unread' : ''}" href="#/chat/${c.id}" data-tip="${esc(chatTitle(c))}">
      <span class="rail-pill"></span>${chatAvatar(c, 48, false)}${unread && c.type === 'dm' ? '<span class="rail-badge">1</span>' : ''}</a>`;
  };
  const home = S.route.view !== 'chat' || S.chats.get(S.route.id)?.type === 'dm';
  const pending = incoming().length;
  $('#rail').innerHTML = `
    <a class="rail-item rail-home ${home ? 'active' : ''}" href="#/friends" data-tip="Direct Messages">
      <span class="rail-pill"></span><span class="rail-logo">${logo()}</span>${pending ? `<span class="rail-badge">${pending}</span>` : ''}</a>
    ${unreadDms.map(item).join('')}
    <span class="rail-sep"></span>
    ${groups.map(item).join('')}
    <button class="rail-item rail-add" data-act="compose" data-group="1" data-tip="Create a Group">${I.plus}</button>`;
}

// ---------- conversation list (iMessage sidebar) ----------
function renderChatList() {
  const q = S.search.trim().toLowerCase();
  const pending = incoming().length;
  let chats = sortedChats().filter((c) => c.lastMessage || c.type === 'group' || c.id === S.route.id);
  if (q) chats = chats.filter((c) => chatTitle(c).toLowerCase().includes(q) || (c.lastMessage?.text || '').toLowerCase().includes(q));
  const friendsActive = S.route.view === 'friends' || S.route.view === 'home';
  const rows = chats.map((c) => {
    const active = S.route.view === 'chat' && S.route.id === c.id;
    const typing = typers(c);
    const lm = c.lastMessage;
    return `<a class="chat-row ${active ? 'active' : ''} ${isUnread(c) ? 'unread' : ''}" href="#/chat/${c.id}" data-ctx="chat" data-id="${c.id}">
      <span class="unread-dot"></span>
      ${chatAvatar(c, 44)}
      <span class="cr-body">
        <span class="cr-top"><span class="cr-name">${esc(chatTitle(c))}</span>
          ${isMuted(c) ? `<span class="cr-muted" title="Alerts hidden">${I.bellOff}</span>` : ''}
          <span class="cr-time">${lm ? fmtListTime(ms(lm.createdAt)) : ''}</span></span>
        <span class="cr-preview">${typing.length ? '<i class="typing-mini"><b></b><b></b><b></b></i> typing…' : esc(previewText(c))}</span>
      </span></a>`;
  }).join('');
  $('#chatList').innerHTML = `
    <a class="nav-row ${friendsActive ? 'active' : ''}" href="#/friends">${I.users}<span>Friends</span>${pending ? `<span class="pill-badge">${pending}</span>` : ''}</a>
    ${rows || `<div class="list-empty">${q ? 'No matches.' : 'No conversations yet.<br>Add a friend, then say hi!'}</div>`}`;
}

function renderUserPanel() {
  const me = S.me;
  const dnd = myDnd();
  $('#userPanel').innerHTML = `
    <button class="up-me" data-act="status-menu" title="Set status">
      ${avatar(me, 34, presenceOf(S.uid))}
      <span class="up-text"><b>${esc(me.displayName)}</b><small>${dnd ? esc(presenceText(S.uid)) : `@${esc(me.username)}`}</small></span>
    </button>
    <button class="icon-btn ${dnd ? 'dnd-on' : ''}" data-act="dnd-toggle" title="${dnd ? 'Turn off Do Not Disturb' : 'Do Not Disturb'}">${MOON}</button>
    <button class="icon-btn" data-act="settings" title="Settings">${I.settings}</button>`;
}

const MOON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function renderNotifBanner() {
  const p = N.permission();
  const dismissed = pref('notifBannerDismissed', '') === '1';
  const el = $('#notifBanner');
  if (p === 'default' && !dismissed) {
    el.innerHTML = `<div class="banner">${I.bell}<span>Get notified about new messages</span>
      <button class="btn btn-sm btn-primary" data-act="enable-notifs">Turn on</button>
      <button class="icon-btn sm" data-act="dismiss-banner" title="Dismiss">${I.x}</button></div>`;
  } else if (p === 'denied' && !dismissed) {
    el.innerHTML = `<div class="banner warn">${I.bellOff}<span>Notifications are blocked. Click the lock icon in the address bar to allow them.</span>
      <button class="icon-btn sm" data-act="dismiss-banner" title="Dismiss">${I.x}</button></div>`;
  } else el.innerHTML = '';
}

function renderMain() {
  if (S.route.view === 'chat') {
    const c = S.chats.get(S.route.id);
    if (!c) {
      S.builtChat = null;
      $('#main').innerHTML = S.chatsLoaded
        ? `<div class="empty-main">${logo()}<h2>Conversation not found</h2><p>You may have left this conversation.</p><a class="btn btn-primary" href="#/friends">Back to Friends</a></div>`
        : '';
      return;
    }
    if (S.builtChat !== c.id) buildChat(c);
    renderChatChrome();
    renderMessages();
    renderTyping();
  } else {
    renderFriends();
  }
}

// ============================================================================
// Friends view (Discord-style)
// ============================================================================
function renderFriends() {
  const main = $('#main');
  if (!S.builtFriends) {
    S.builtFriends = true;
    S.builtChat = null;
    S.addTabBuilt = false;
    main.innerHTML = `
      <section class="friends">
        <header class="fr-head">
          <a class="icon-btn back" href="#/">${I.back}</a>
          <div class="fr-title">${I.users}<span>Friends</span></div>
          <nav class="fr-tabs" id="frTabs"></nav>
        </header>
        <div class="fr-wrap"><div class="fr-body" id="frBody"></div><aside class="active-now" id="activeNow"></aside></div>
      </section>`;
  }
  const pending = incoming().length;
  $('#frTabs').innerHTML = [['online', 'Online'], ['all', 'All'], ['pending', 'Pending']].map(([t, label]) => `
    <button class="fr-tab ${S.friendsTab === t ? 'active' : ''}" data-act="tab" data-tab="${t}">${label}${t === 'pending' && pending ? `<span class="pill-badge">${pending}</span>` : ''}</button>`).join('')
    + `<button class="fr-tab add ${S.friendsTab === 'add' ? 'active' : ''}" data-act="tab" data-tab="add">Add Friend</button>`;

  const body = $('#frBody');
  if (S.friendsTab === 'add') {
    if (!S.addTabBuilt) {
      S.addTabBuilt = true;
      body.innerHTML = `
        <div class="add-friend">
          <h2>Add Friend</h2>
          <p class="muted">You can add friends with their Bubbles username.</p>
          <form id="addFriendForm" class="add-form">
            <span class="at">@</span><input id="addFriendInput" placeholder="username" autocomplete="off" spellcheck="false" maxlength="21">
            <button class="btn btn-primary btn-sm" id="addFriendBtn" disabled>Send Friend Request</button>
          </form>
          <p class="add-result" id="addResult"></p>
          <div class="my-username">Your username is <b>@${esc(S.me.username)}</b>
            <button class="link" data-act="copy-username">Copy</button></div>
        </div>`;
      const input = $('#addFriendInput');
      input.oninput = () => {
        input.value = input.value.toLowerCase().replace(/[^a-z0-9_@]/g, '');
        $('#addFriendBtn').disabled = !input.value.replace('@', '');
        $('#addResult').textContent = '';
        $('#addFriendForm').classList.remove('ok', 'bad');
      };
      $('#addFriendForm').onsubmit = async (e) => {
        e.preventDefault();
        const res = $('#addResult');
        try {
          res.textContent = await sendFriendRequest(input.value);
          $('#addFriendForm').className = 'add-form ok';
          input.value = '';
          $('#addFriendBtn').disabled = true;
        } catch (ex) {
          res.textContent = ex.message;
          $('#addFriendForm').className = 'add-form bad';
        }
      };
      input.focus();
    }
  } else {
    S.addTabBuilt = false;
    body.innerHTML = friendsListHTML();
  }
  renderActiveNow();
}

function friendRow(uid, actions, sub) {
  return `<div class="fr-row" data-act="dm" data-uid="${uid}">
    ${avatar(user(uid), 36, presenceOf(uid))}
    <div class="fr-info"><b>${esc(user(uid).displayName)}</b> <span class="fr-handle">@${esc(user(uid).username || '')}</span>
      <small>${esc(sub ?? presenceText(uid))}</small></div>
    <div class="fr-actions">${actions}</div></div>`;
}

function friendsListHTML() {
  const tab = S.friendsTab;
  if (tab === 'pending') {
    const inc = incoming();
    const out = outgoing();
    if (!inc.length && !out.length) return emptyState('No pending friend requests.', 'Requests you send and receive show up here.');
    return (inc.length ? `<h3 class="fr-section">Incoming — ${inc.length}</h3>` : '')
      + inc.map((r) => friendRow(r.from, `
          <button class="round-btn ok" data-act="accept" data-id="${r.id}" title="Accept">${I.check}</button>
          <button class="round-btn bad" data-act="decline" data-id="${r.id}" title="Ignore">${I.x}</button>`, 'Incoming friend request')).join('')
      + (out.length ? `<h3 class="fr-section">Outgoing — ${out.length}</h3>` : '')
      + out.map((r) => friendRow(r.to, `
          <button class="round-btn bad" data-act="decline" data-id="${r.id}" title="Cancel">${I.x}</button>`, 'Outgoing friend request')).join('');
  }
  let ids = friendIds().sort(byName);
  if (tab === 'online') ids = ids.filter((u) => presenceOf(u) !== 'offline');
  if (!ids.length) {
    return tab === 'online'
      ? emptyState("No one's around right now.", 'Friends who are online show up here.')
      : emptyState('No friends yet.', 'Head to <b>Add Friend</b> and enter a username to get started.');
  }
  return `<h3 class="fr-section">${tab === 'online' ? 'Online' : 'All friends'} — ${ids.length}</h3>`
    + ids.map((uid) => friendRow(uid, `
        <button class="round-btn" data-act="dm" data-uid="${uid}" title="Message">${I.message}</button>
        <button class="round-btn" data-act="friend-menu" data-uid="${uid}" title="More">${I.more}</button>`)).join('');
}

const emptyState = (title, sub) => `<div class="fr-empty"><div class="fr-empty-art">${logo()}</div><h3>${title}</h3><p>${sub}</p></div>`;

function renderActiveNow() {
  const el = $('#activeNow');
  if (!el) return;
  const on = friendIds().filter((u) => presenceOf(u) !== 'offline').sort(byName);
  el.innerHTML = `<h2>Active Now</h2>${on.length
    ? on.map((uid) => `<button class="an-card" data-act="dm" data-uid="${uid}">${avatar(user(uid), 32, presenceOf(uid))}
        <span><b>${esc(user(uid).displayName)}</b><small>${esc(presenceText(uid))}</small></span></button>`).join('')
    : '<div class="an-empty"><b>It\'s quiet for now…</b><p>When a friend is online, they\'ll show up here.</p></div>'}`;
}

// ============================================================================
// Conversation view (iMessage-style)
// ============================================================================
function buildChat(c) {
  S.builtChat = c.id;
  S.builtFriends = false;
  S.firstPaint = true;
  $('#main').innerHTML = `
    <section class="chat">
      <div class="chat-col">
        <header class="chat-head" id="chatHead"></header>
        <div class="chat-body">
          <div id="msgs" class="msgs">
            <div id="msgsTop" class="msgs-top"></div>
            <div id="msgList" class="msg-list"></div>
            <div id="typing" class="typing-row"></div>
          </div>
          <button id="jump" class="jump" data-act="jump" hidden>${I.down} New messages</button>
        </div>
        <div id="dndNotice"></div>
        <footer class="composer" id="composer">
          <div class="comp-bar" id="compBar" hidden></div>
          <div class="comp-row">
            <button class="comp-plus" data-act="attach" title="Send a photo">${I.plus}</button>
            <button class="comp-plus comp-emoji" data-act="emoji" title="Emoji">${I.smile}</button>
            <button class="comp-plus comp-gif" data-act="gif" title="GIFs">GIF</button>
            <div class="comp-field">
              <textarea id="input" rows="1" maxlength="4000" placeholder="Message" aria-label="Message"></textarea>
              <button class="send-btn" id="sendBtn" data-act="send" title="Send" hidden>${I.up}</button>
            </div>
          </div>
          <input type="file" id="fileInput" accept="image/*" hidden>
        </footer>
      </div>
      <aside id="details" class="details" hidden></aside>
    </section>`;

  const input = $('#input');
  input.addEventListener('input', onComposerInput);
  input.addEventListener('keydown', onComposerKey);
  input.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); sendImage(file); }
  });
  input.addEventListener('blur', () => setTimeout(stopTyping, 200));
  $('#fileInput').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) sendImage(f); };
  const scroller = $('#msgs');
  scroller.addEventListener('scroll', onMsgsScroll, { passive: true });
  scroller.addEventListener('load', () => { if (S.stickBottom) scrollToBottom(); }, true);
  const body = $('.chat-body');
  body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('drop'); });
  body.addEventListener('dragleave', () => body.classList.remove('drop'));
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    body.classList.remove('drop');
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (f) return sendImage(f);
    // A GIF dragged straight from another web page arrives as a link, not a file.
    const url = (e.dataTransfer.getData('text/uri-list') || '').split('\n')[0].trim();
    if (/^https:\/\/\S+\.gif(\?\S*)?$/i.test(url)) sendGif(url);
  });
  applyWallpaper();
  if (matchMedia('(pointer: fine)').matches) input.focus();
}

function renderChatChrome() {
  const c = S.chats.get(S.route.id);
  if (!c || S.builtChat !== c.id) return;
  const dm = c.type === 'dm';
  const other = otherMember(c);
  const sub = dm ? presenceText(other) : `${c.members.length} people`;
  $('#chatHead').innerHTML = `
    <a class="icon-btn back" href="#/">${I.back}</a>
    <button class="ch-who" data-act="details">
      ${chatAvatar(c, 36)}
      <span class="ch-name">${esc(chatTitle(c))}<span class="ch-chev">${I.chevron}</span></span>
      <span class="ch-sub ${dm && presenceOf(other) === 'dnd' ? 'dnd' : ''}">${dm && presenceOf(other) === 'dnd' ? `${MOON} ` : ''}${esc(sub)}</span>
    </button>
    <span class="ch-actions">
      ${dm ? `<button class="icon-btn ch-call" data-act="call" title="Video call">${I.video}</button>` : ''}
      <button class="icon-btn ch-info ${S.detailsOpen ? 'on' : ''}" data-act="details" title="Details">${I.info}</button>
    </span>`;
  $('#input').placeholder = dm ? `Message ${user(other).displayName}` : `Message ${chatTitle(c)}`;
  renderDndNotice(c);
  renderComposerBar();
  renderDetails(c);
}

// iMessage: "Alex has notifications silenced" + Notify Anyway.
function renderDndNotice(c) {
  const silenced = c.members.filter((m) => m !== S.uid && dndActive(S.users.get(m)));
  const el = $('#dndNotice');
  if (!silenced.length) { el.innerHTML = ''; S.urgentNext = false; return; }
  const who = c.type === 'dm' ? user(silenced[0]).displayName
    : silenced.length === 1 ? user(silenced[0]).displayName : `${silenced.length} people`;
  el.innerHTML = `<div class="dnd-notice">${MOON}<span><b>${esc(who)}</b> ${silenced.length === 1 ? 'has' : 'have'} notifications silenced</span>
    ${S.urgentNext
      ? '<span class="urgent-on">Your next message will notify anyway</span><button class="link" data-act="urgent-off">Cancel</button>'
      : '<button class="link" data-act="notify-anyway">Notify Anyway</button>'}</div>`;
}

function renderComposerBar() {
  const bar = $('#compBar');
  if (!bar) return;
  if (S.editing) {
    bar.hidden = false;
    bar.innerHTML = `${I.pencil}<span>Editing message</span><small>Esc to cancel · Enter to save</small><button class="icon-btn sm" data-act="cancel-compose">${I.x}</button>`;
  } else if (S.replyTo) {
    const r = S.replyTo;
    bar.hidden = false;
    bar.innerHTML = `${I.reply}<span>Replying to <b>${esc(nameOf(r.senderId))}</b></span><small>${esc(r.text || '📷 Photo')}</small><button class="icon-btn sm" data-act="cancel-compose">${I.x}</button>`;
  } else {
    bar.hidden = true;
    bar.innerHTML = '';
  }
}

// ---------- messages ----------
function subscribeMessages(chatId) {
  if (S.msgChatId === chatId) return;
  S.msgUnsub?.();
  Object.assign(S, { msgChatId: chatId, msgs: [], msgLimit: 50, hasMore: false, loadingOlder: false });
  listenMessages();
  listenWallpaper(chatId);
}

// ---------- chat background (shared by everyone in the chat) ----------
function listenWallpaper(chatId) {
  S.wallUnsub?.();
  S.wall = null;
  S.wallUnsub = F.onSnapshot(styleRef(chatId), (snap) => {
    if (S.msgChatId !== chatId) return;
    S.wall = snap.data()?.wallpaper || null;
    applyWallpaper();
    render('header');
  }, (e) => console.warn('wallpaper', e));
}

function applyWallpaper() {
  const col = $('.chat-col');
  if (!col) return;
  col.classList.toggle('has-wall', !!S.wall);
  col.style.backgroundImage = S.wall ? `url("${S.wall}")` : '';
}

async function setWallpaper(c, file) {
  try {
    const wallpaper = file ? await compressImage(file, 1600, 700_000) : '';
    await F.setDoc(styleRef(c.id), { wallpaper, by: S.uid, updatedAt: F.serverTimestamp() });
    postMessage(c, { system: true, text: wallpaper ? 'changed the chat background' : 'removed the chat background' });
  } catch (e) {
    toast(e.code === 'permission-denied' ? "Couldn't change the background" : e.message, 'error');
  }
}

function listenMessages() {
  S.msgUnsub?.();
  const id = S.msgChatId;
  const q = F.query(F.collection(db, 'chats', id, 'messages'), F.orderBy('createdAt', 'desc'), F.limit(S.msgLimit));
  S.msgUnsub = F.onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    if (S.msgChatId !== id) return;
    S.msgs = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }), pending: d.metadata.hasPendingWrites })).reverse();
    S.hasMore = snap.size >= S.msgLimit;
    renderMessages();
    maybeMarkRead();
  }, onListenError);
}

function nearBottom(el = $('#msgs'), px = 120) {
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < px;
}
function scrollToBottom() {
  const el = $('#msgs');
  if (el) el.scrollTop = el.scrollHeight;
}

function onMsgsScroll() {
  const el = $('#msgs');
  S.stickBottom = nearBottom(el);
  if (S.stickBottom) $('#jump').hidden = true;
  if (el.scrollTop < 300 && S.hasMore && !S.loadingOlder) {
    S.loadingOlder = true;
    S.prevScroll = { h: el.scrollHeight, top: el.scrollTop };
    S.msgLimit += 50;
    listenMessages();
  }
  maybeMarkRead();
  closeMenu('.tapback-picker');
}

function renderMessages() {
  const c = S.chats.get(S.route.id);
  const list = $('#msgList');
  if (!c || !list || S.builtChat !== c.id) return;
  const scroller = $('#msgs');
  const wasNear = S.firstPaint || nearBottom(scroller);
  const lastKey = list.lastElementChild?.dataset.key;

  const rows = buildRows(c);
  // Keyed reconciliation: only touch rows whose markup changed (keeps images from reloading).
  const existing = new Map([...list.children].map((el) => [el.dataset.key, el]));
  rows.forEach((row, i) => {
    let el = existing.get(row.key);
    if (!el || el.dataset.html !== row.html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = row.html.trim();
      const fresh = tpl.content.firstElementChild;
      fresh.dataset.key = row.key;
      fresh.dataset.html = row.html;
      if (el) el.replaceWith(fresh);
      el = fresh;
    }
    existing.delete(row.key);
    const at = list.children[i];
    if (at !== el) list.insertBefore(el, at || null);
  });
  existing.forEach((el) => el.remove());

  $('#msgsTop').innerHTML = S.hasMore
    ? '<div class="loading-older">Loading earlier messages…</div>'
    : `<div class="convo-intro">${chatAvatar(c, 72, false)}<h2>${esc(chatTitle(c))}</h2><p>${c.type === 'dm'
      ? `This is the beginning of your conversation with <b>${esc(user(otherMember(c)).displayName)}</b>.`
      : `This is the start of the group. ${c.members.length} people are here.`}</p></div>`;

  if (S.loadingOlder && S.prevScroll) {
    scroller.scrollTop = scroller.scrollHeight - S.prevScroll.h + S.prevScroll.top;
    S.loadingOlder = false;
    S.prevScroll = null;
  } else {
    const newLast = list.lastElementChild?.dataset.key;
    const mineJustSent = S.msgs.at(-1)?.senderId === S.uid && newLast !== lastKey;
    if (wasNear || mineJustSent) scrollToBottom();
    else if (newLast !== lastKey && lastKey) $('#jump').hidden = false;
  }
  S.stickBottom = nearBottom(scroller);
  S.firstPaint = false;
}

function buildRows(c) {
  const rows = [];
  const msgs = S.msgs;
  const group = c.type === 'group';
  let lastMineIdx = -1;
  msgs.forEach((m, i) => { if (m.senderId === S.uid && !m.system && !m.deleted) lastMineIdx = i; });
  // Read receipts sit under your newest message, as long as nobody has replied since.
  const showReceiptAt = lastMineIdx !== -1 && msgs.slice(lastMineIdx + 1).every((m) => m.system || m.senderId === S.uid) ? lastMineIdx : -1;

  msgs.forEach((m, i) => {
    const t = ms(m.createdAt) || Date.now();
    const prev = msgs[i - 1];
    const next = msgs[i + 1];
    const pt = prev ? ms(prev.createdAt) : 0;
    const nt = next ? ms(next.createdAt) : 0;
    const stamp = !prev || t - pt > STAMP_GAP;
    if (stamp) rows.push({ key: `t-${m.id}`, html: `<div class="stamp">${fmtStamp(t)}</div>` });

    if (m.system || m.deleted) {
      const text = m.deleted ? 'unsent a message' : m.text;
      rows.push({ key: m.id, html: `<div class="sys-msg"><b>${esc(nameOf(m.senderId))}</b> ${esc(text)}</div>` });
      return;
    }
    const mine = m.senderId === S.uid;
    const joins = (a, b, dt) => a && !a.system && !a.deleted && a.senderId === b.senderId && dt < GROUP_GAP;
    const start = stamp || !joins(prev, m, t - pt);
    const end = !next || !joins(next, m, nt - t) || nt - t > STAMP_GAP;
    rows.push({ key: m.id, html: messageHTML(m, { mine, start, end, group }) });

    if (i === showReceiptAt) rows.push({ key: 'receipt', html: `<div class="receipt">${receiptText(c, m)}</div>` });
  });
  return rows;
}

function messageHTML(m, { mine, start, end, group }) {
  const jumbo = !m.image && isEmojiOnly(m.text);
  const reactions = Object.entries(m.reactions || {});
  const grouped = {};
  reactions.forEach(([uid, e]) => { (grouped[e] ||= []).push(uid); });
  const reactHTML = reactions.length ? `<div class="tapbacks">${Object.entries(grouped).map(([e, uids]) => `
    <button class="tb ${uids.includes(S.uid) ? 'mine' : ''}" data-act="react" data-id="${m.id}" data-emoji="${e}" title="${esc(uids.map(nameOf).join(', '))}">${e}${uids.length > 1 ? `<small>${uids.length}</small>` : ''}</button>`).join('')}</div>` : '';
  const reply = m.replyTo ? `<button class="reply-ref" data-act="jump-to" data-id="${esc(m.replyTo.id)}">
      <span class="reply-line"></span><b>${esc(nameOf(m.replyTo.senderId))}</b> ${esc(m.replyTo.text || '📷 Photo')}</button>` : '';
  const content = m.image
    ? `<img class="msg-img" src="${esc(m.image)}" alt="${isGif(m.image) ? 'GIF' : 'Photo'}" data-act="lightbox">${m.text ? `<div class="bubble">${formatText(m.text)}</div>` : ''}`
    : `<div class="bubble ${jumbo ? 'jumbo' : ''}">${jumbo ? esc(m.text) : formatText(m.text)}</div>`;
  const tools = `<div class="msg-tools">
      <button data-act="tapback" data-id="${m.id}" title="React">${I.smile}</button>
      <button data-act="reply" data-id="${m.id}" title="Reply">${I.reply}</button>
      ${mine && !m.image ? `<button data-act="edit" data-id="${m.id}" title="Edit">${I.pencil}</button>` : ''}
      <button data-act="msg-menu" data-id="${m.id}" title="More">${I.more}</button></div>`;
  const showAvatar = group && !mine;
  return `<div class="msg ${mine ? 'mine' : 'theirs'} ${start ? 'start' : ''} ${end ? 'end' : ''} ${m.pending ? 'pending' : ''} ${reactions.length ? 'has-tb' : ''}" id="m-${m.id}" data-id="${m.id}" data-ctx="msg">
    ${showAvatar ? `<div class="msg-av">${end ? `<button data-act="profile" data-uid="${m.senderId}">${avatar(user(m.senderId), 28)}</button>` : ''}</div>` : ''}
    <div class="msg-col">
      ${group && !mine && start ? `<div class="msg-name">${esc(nameOf(m.senderId))}</div>` : ''}
      ${reply}
      <div class="msg-content ${jumbo ? 'is-jumbo' : ''}" data-dbl="${m.id}">${content}${reactHTML}${tools}</div>
      ${m.edited ? '<div class="edited">Edited</div>' : ''}
      ${m.urgent ? `<div class="edited">${MOON} Notified anyway</div>` : ''}
    </div></div>`;
}

function receiptText(c, m) {
  if (m.pending) return 'Sending…';
  const t = ms(m.createdAt);
  const readers = c.members.filter((u) => u !== S.uid && ms(c.lastRead?.[u]) >= t);
  if (c.type === 'dm') {
    return readers.length ? `<b>Read</b> ${fmtListTime(ms(c.lastRead[readers[0]]))}` : '<b>Delivered</b>';
  }
  if (!readers.length) return '<b>Delivered</b>';
  if (readers.length === c.members.length - 1) return '<b>Read by everyone</b>';
  return `<b>Read by</b> ${esc(readers.map(firstName).join(', '))}`;
}

function renderTyping() {
  const el = $('#typing');
  const c = S.chats.get(S.route.id);
  if (!el || !c) return;
  const who = typers(c);
  const key = who.join(',');
  if (el.dataset.who === key) return;
  el.dataset.who = key;
  const near = nearBottom();
  el.innerHTML = who.length ? `
    ${c.type === 'group' ? `<div class="msg-av">${avatar(user(who[0]), 28)}</div>` : ''}
    <div class="typing-bubble"><b></b><b></b><b></b></div>
    ${c.type === 'group' ? `<span class="typing-who">${esc(who.map(firstName).join(', '))}</span>` : ''}` : '';
  if (near) scrollToBottom();
  render('nav');
}

// Read receipts are always on: viewing a conversation marks it read for everyone to see.
function maybeMarkRead() {
  if (S.route.view !== 'chat') return;
  const c = S.chats.get(S.route.id);
  if (!c || !isUnread(c) || S.marking === c.id) return;
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
  if (!nearBottom($('#msgs'), 250)) return;
  S.marking = c.id;
  F.updateDoc(chatRef(c.id), { [`lastRead.${S.uid}`]: F.serverTimestamp() })
    .catch(() => {})
    .finally(() => { S.marking = null; });
  N.clearChatNotifications(c.id);
}

// ---------- details panel ----------
function renderDetails(c) {
  const el = $('#details');
  if (!el) return;
  el.hidden = !S.detailsOpen;
  $('.chat')?.classList.toggle('details-open', S.detailsOpen);
  if (!S.detailsOpen || el.contains(document.activeElement)) return;
  const dm = c.type === 'dm';
  const other = otherMember(c);
  const members = [...c.members].sort((a, b) => (a === S.uid ? -1 : b === S.uid ? 1 : byName(a, b)));
  el.innerHTML = `
    <header class="det-head"><b>Details</b><button class="icon-btn sm" data-act="details">${I.x}</button></header>
    <div class="det-hero">
      ${chatAvatar(c, 84)}
      ${dm ? `<h2>${esc(user(other).displayName)}</h2><p class="muted">@${esc(user(other).username || '')}</p>
              <p class="det-pres pres-text-${presenceOf(other)}">${esc(presenceText(other))}</p>
              ${user(other).bio ? `<p class="det-bio">${esc(user(other).bio)}</p>` : ''}`
    : `<input class="det-name" id="groupName" value="${esc(c.name || '')}" placeholder="${esc(chatTitle(c))}" maxlength="50" title="Rename group">`}
    </div>
    <div class="det-group">
      <label class="det-row toggle">${I.bellOff}<span>Hide Alerts</span>
        <input type="checkbox" data-act="mute" ${isMuted(c) ? 'checked' : ''}><i class="switch"></i></label>
      <div class="det-row static">${I.check}<span>Read receipts</span><small>Always on</small></div>
    </div>
    <div class="det-group">
      <div class="det-label">Chat Background</div>
      ${S.wall ? `<div class="det-wall" style="background-image:url(&quot;${esc(S.wall)}&quot;)"></div>` : ''}
      <button class="det-row link-row" data-act="wall-pick">${I.image}<span>${S.wall ? 'Change Background' : 'Choose a Photo'}</span></button>
      ${S.wall ? `<button class="det-row danger" data-act="wall-remove">${I.trash}<span>Remove Background</span></button>` : ''}
      <input type="file" id="wallInput" accept="image/*" hidden>
    </div>
    ${dm ? '' : `
    <div class="det-group">
      <div class="det-label">${c.members.length} Members</div>
      ${members.map((uid) => `<button class="det-member" data-act="profile" data-uid="${uid}">
        ${avatar(user(uid), 32, presenceOf(uid))}<span><b>${esc(uid === S.uid ? `${S.me.displayName} (you)` : user(uid).displayName)}</b>
        <small>${esc(presenceText(uid))}</small></span></button>`).join('')}
      <button class="det-row link-row" data-act="add-people">${I.userPlus}<span>Add People</span></button>
    </div>
    <div class="det-group"><button class="det-row danger" data-act="leave">${I.logout}<span>Leave this Conversation</span></button></div>`}`;
  $('#wallInput', el).onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) setWallpaper(c, f); };
  const gn = $('#groupName');
  if (gn) {
    const commit = () => {
      const v = gn.value.trim();
      if (v !== (c.name || '')) renameGroup(c, v);
    };
    gn.onkeydown = (e) => { if (e.key === 'Enter') gn.blur(); if (e.key === 'Escape') { gn.value = c.name || ''; gn.blur(); } };
    gn.onblur = commit;
  }
}

// ============================================================================
// Composer & sending
// ============================================================================
function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
  $('#sendBtn').hidden = !t.value.trim();
}

function onComposerInput() {
  autosize();
  const has = !!$('#input').value.trim();
  if (has && !S.editing && Date.now() - S.typingSentAt > 3000) {
    S.typingSentAt = Date.now();
    F.updateDoc(chatRef(S.route.id), { [`typing.${S.uid}`]: Date.now() }).catch(() => {});
  } else if (!has) stopTyping();
}

function stopTyping() {
  if (!S.typingSentAt || !S.route.id) return;
  S.typingSentAt = 0;
  F.updateDoc(chatRef(S.route.id), { [`typing.${S.uid}`]: F.deleteField() }).catch(() => {});
}

function onComposerKey(e) {
  const t = e.target;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  } else if (e.key === 'Escape' && (S.replyTo || S.editing)) {
    e.preventDefault();
    cancelCompose();
  } else if (e.key === 'ArrowUp' && !t.value) {
    // Discord: ↑ in an empty box edits your last message.
    const last = [...S.msgs].reverse().find((m) => m.senderId === S.uid && !m.system && !m.deleted && !m.image);
    if (last) { e.preventDefault(); startEdit(last); }
  }
}

function cancelCompose() {
  if (S.editing) { $('#input').value = ''; autosize(); }
  S.editing = null;
  S.replyTo = null;
  renderComposerBar();
}

function startEdit(m) {
  S.editing = m;
  S.replyTo = null;
  const t = $('#input');
  t.value = m.text;
  autosize();
  t.focus();
  t.setSelectionRange(t.value.length, t.value.length);
  renderComposerBar();
}

function startReply(m) {
  S.replyTo = { id: m.id, senderId: m.senderId, text: (m.text || '').slice(0, 140) };
  S.editing = null;
  renderComposerBar();
  $('#input').focus();
}

async function send() {
  const c = S.chats.get(S.route.id);
  const input = $('#input');
  const text = input.value.trim();
  if (!c || !text) return;
  input.value = '';
  autosize();
  if (S.editing) {
    const m = S.editing;
    S.editing = null;
    renderComposerBar();
    if (text === m.text) return;
    const b = F.writeBatch(db);
    b.update(msgRef(c.id, m.id), { text, edited: true, editedAt: F.serverTimestamp() });
    if (c.lastMessage?.id === m.id) b.update(chatRef(c.id), { 'lastMessage.text': text.slice(0, 200) });
    b.commit().catch(() => toast("Couldn't edit that message", 'error'));
    return;
  }
  const replyTo = S.replyTo;
  S.replyTo = null;
  renderComposerBar();
  postMessage(c, { text, replyTo });
}

async function sendImage(file) {
  const c = S.chats.get(S.route.id);
  if (!c) return;
  try {
    // Re-encoding through a canvas keeps only the first frame, so GIFs go up untouched.
    const image = file.type === 'image/gif' ? await gifDataUrl(file) : await compressImage(file);
    const caption = $('#input').value.trim();
    $('#input').value = '';
    autosize();
    postMessage(c, { image, text: caption, replyTo: S.replyTo });
    S.replyTo = null;
    renderComposerBar();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function gifDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (r.result.length <= 850_000 ? resolve(r.result)
      : reject(new Error('That GIF is too big to send (max about 600 KB). Try the GIF button instead.')));
    r.onerror = () => reject(new Error("Couldn't read that GIF."));
    r.readAsDataURL(file);
  });
}

// GIFs from the library (or dragged in from the web) are sent as links, not uploaded.
function sendGif(url) {
  const c = S.chats.get(S.route.id);
  if (!c) return;
  postMessage(c, { image: url, replyTo: S.replyTo });
  S.replyTo = null;
  renderComposerBar();
}

const isGif = (src) => /^data:image\/gif|\.gif(\?|$)/i.test(src || '');

function postMessage(c, { text = '', image = null, replyTo = null, system = false }) {
  const ref = F.doc(F.collection(db, 'chats', c.id, 'messages'));
  const msg = { senderId: S.uid, createdAt: F.serverTimestamp(), text };
  if (image) msg.image = image;
  if (replyTo) msg.replyTo = replyTo;
  if (system) msg.system = true;
  if (S.urgentNext && !system) { msg.urgent = true; S.urgentNext = false; renderChatChrome(); }
  const b = F.writeBatch(db);
  b.set(ref, msg);
  b.update(chatRef(c.id), {
    lastMessage: {
      id: ref.id, senderId: S.uid, text: (text || '').slice(0, 200) || (image ? (isGif(image) ? 'GIF' : '📷 Photo') : ''),
      createdAt: F.serverTimestamp(), system, urgent: !!msg.urgent,
    },
    updatedAt: F.serverTimestamp(),
    [`lastRead.${S.uid}`]: F.serverTimestamp(),
    [`typing.${S.uid}`]: F.deleteField(),
  });
  S.typingSentAt = 0;
  if (!system) N.playSound('out');
  return b.commit().catch((e) => {
    console.error(e);
    toast('Message failed to send', 'error');
  });
}

function toggleReaction(m, emoji) {
  const mineNow = m.reactions?.[S.uid];
  F.updateDoc(msgRef(S.route.id, m.id), {
    [`reactions.${S.uid}`]: mineNow === emoji ? F.deleteField() : emoji,
  }).catch(() => toast("Couldn't react", 'error'));
}

function unsend(m) {
  const c = S.chats.get(S.route.id);
  const b = F.writeBatch(db);
  b.update(msgRef(c.id, m.id), { deleted: true, text: '', image: F.deleteField() });
  if (c.lastMessage?.id === m.id) b.update(chatRef(c.id), { 'lastMessage.text': 'unsent a message', 'lastMessage.system': true });
  b.commit().catch(() => toast("Couldn't unsend", 'error'));
}

// ============================================================================
// Conversations: open, create, manage
// ============================================================================
async function openDM(uid) {
  const id = dmId(S.uid, uid);
  if (!S.chats.has(id)) {
    try {
      const snap = await F.getDoc(chatRef(id));
      if (!snap.exists()) {
        await F.setDoc(chatRef(id), {
          type: 'dm', members: [S.uid, uid].sort(), createdBy: S.uid,
          createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp(), lastRead: {}, typing: {}, lastMessage: null,
        });
      }
    } catch (e) {
      console.error(e);
      return toast(isFriend(uid) ? "Couldn't open that conversation" : 'You can only message friends.', 'error');
    }
  }
  location.hash = `#/chat/${id}`;
}

async function createGroup(uids, name) {
  const ref = F.doc(F.collection(db, 'chats'));
  const msg = F.doc(F.collection(db, 'chats', ref.id, 'messages'));
  const b = F.writeBatch(db);
  b.set(ref, {
    type: 'group', name: name || '', members: [S.uid, ...uids], createdBy: S.uid,
    createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp(), lastRead: { [S.uid]: F.serverTimestamp() }, typing: {},
    lastMessage: { id: msg.id, senderId: S.uid, text: 'created the group', createdAt: F.serverTimestamp(), system: true },
  });
  b.set(msg, { senderId: S.uid, createdAt: F.serverTimestamp(), text: 'created the group', system: true });
  await b.commit();
  location.hash = `#/chat/${ref.id}`;
}

function renameGroup(c, name) {
  F.updateDoc(chatRef(c.id), { name }).catch(() => toast("Couldn't rename", 'error'));
  postMessage(c, { system: true, text: name ? `named the conversation “${name}”` : 'removed the conversation name' });
}

async function addPeople(c, uids) {
  await F.updateDoc(chatRef(c.id), { members: F.arrayUnion(...uids) });
  postMessage({ ...c, members: [...c.members, ...uids] }, { system: true, text: `added ${uids.map((u) => user(u).displayName).join(', ')}` });
}

async function leaveGroup(c) {
  await postMessage(c, { system: true, text: 'left the conversation' });
  await F.updateDoc(chatRef(c.id), { members: F.arrayRemove(S.uid) });
  location.hash = '#/';
}

function toggleMute(c) {
  F.updateDoc(userRef(S.uid), { muted: isMuted(c) ? F.arrayRemove(c.id) : F.arrayUnion(c.id) });
}

// ============================================================================
// Notifications
// ============================================================================
function maybeNotify(c, prev) {
  const lm = c.lastMessage;
  if (!lm || lm.senderId === S.uid || lm.system) return;
  const t = ms(lm.createdAt);
  if (t <= S.sessionStart || ms(prev?.lastMessage?.createdAt) >= t || (S.lastNotified[c.id] || 0) >= t) return;
  S.lastNotified[c.id] = t;
  // Do Not Disturb silences everything unless the sender chose "Notify Anyway".
  if ((myDnd() || isMuted(c)) && !lm.urgent) return;
  const viewing = S.route.view === 'chat' && S.route.id === c.id;
  const focused = document.visibilityState === 'visible' && document.hasFocus();
  if (viewing && focused) return;
  const sender = user(lm.senderId);
  const title = c.type === 'group' ? `${sender.displayName} in ${chatTitle(c)}` : sender.displayName;
  const body = (lm.urgent ? '🌙 ' : '') + (lm.text || '📷 Photo');
  N.playSound('in');
  if (focused) {
    toast(`<button class="toast-msg" data-act="open-chat" data-id="${c.id}">${avatar(sender, 36)}<span><b>${esc(title)}</b><small>${esc(body)}</small></span></button>`, 'banner', 5000);
  } else {
    N.notify({ title, body, icon: sender.photoURL || undefined, chatId: c.id, messageId: lm.id });
  }
}

function updateBadge() {
  N.setBadge(sortedChats().filter((c) => isUnread(c) && !isMuted(c)).length);
}

async function enableNotifications() {
  N.unlockAudio();
  const p = await N.requestPermission();
  render('nav');
  if (p === 'granted') {
    const push = await N.enablePush(S.uid);
    toast(push ? 'Notifications on, even when Bubbles is closed.' : 'Notifications on while Bubbles is open.');
  } else if (p === 'denied') {
    toast('Notifications are blocked. Allow them from the lock icon in the address bar.', 'error');
  }
}

// ============================================================================
// Menus, popovers, modals, toasts
// ============================================================================
function closeMenu(sel) {
  $$(sel ? `#menuRoot ${sel}` : '#menuRoot > *').forEach((el) => el.remove());
}

function popover(html, anchor, { place = 'top', cls = '', at = null } = {}) {
  closeMenu();
  const el = document.createElement('div');
  el.className = `popover ${cls}`;
  el.innerHTML = html;
  $('#menuRoot').append(el);
  const r = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y, width: 0, height: 0 } : anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x;
  let y;
  if (place === 'right') { x = r.right + 8; y = r.top; } else if (place === 'point') { x = r.left; y = r.top; } else {
    x = r.left + r.width / 2 - w / 2;
    y = place === 'bottom' ? r.bottom + 8 : r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
  }
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  return el;
}

function menu(items, anchor, opts) {
  return popover(items.filter(Boolean).map((it) => (it === '-' ? '<hr>'
    : `<button class="menu-item ${it.danger ? 'danger' : ''}" data-menu="${it.id}">${it.icon || ''}<span>${it.label}</span></button>`)).join(''), anchor, { cls: 'menu', ...opts });
}

let menuHandlers = {};
function openMenu(items, anchor, opts) {
  menuHandlers = Object.fromEntries(items.filter((i) => i && i !== '-').map((i) => [i.id, i.run]));
  return menu(items, anchor, opts);
}

function openMsgMenu(m, anchor, at) {
  const mine = m.senderId === S.uid;
  openMenu([
    { id: 'react', label: 'Add Reaction', icon: I.smile, run: () => openTapback(m, $(`#m-${m.id} .msg-content`)) },
    { id: 'reply', label: 'Reply', icon: I.reply, run: () => startReply(m) },
    mine && !m.image && { id: 'edit', label: 'Edit', icon: I.pencil, run: () => startEdit(m) },
    m.text && { id: 'copy', label: 'Copy Text', icon: I.copy, run: () => navigator.clipboard.writeText(m.text).then(() => toast('Copied')) },
    mine && '-',
    mine && { id: 'unsend', label: 'Unsend', icon: I.trash, danger: true, run: () => unsend(m) },
  ], anchor, at ? { place: 'point', at } : { place: 'bottom' });
}

function openTapback(m, anchor) {
  const current = m.reactions?.[S.uid];
  const el = popover(`${[...TAPBACKS, ...MORE_REACTIONS].map((e, i) => `
    <button class="tp ${current === e ? 'on' : ''} ${i >= TAPBACKS.length ? 'extra' : ''}" data-act="react" data-id="${m.id}" data-emoji="${e}">${e}</button>`).join('')}
    <button class="tp tp-more" data-act="react-more" data-id="${m.id}" title="More emoji">${I.plus}</button>`,
  anchor, { cls: 'tapback-picker' });
  el.addEventListener('click', () => setTimeout(() => el.remove(), 0));
}

function openStatusMenu(anchor) {
  const dot = (p) => `<i class="pres pres-${p} inline"></i>`;
  openMenu([
    { id: 'online', label: 'Online', icon: dot('online'), run: () => setStatus('online') },
    { id: 'idle', label: 'Idle', icon: dot('idle'), run: () => setStatus('idle') },
    { id: 'dnd', label: 'Do Not Disturb<small>Silences notifications. Friends see it.</small>', icon: dot('dnd'), run: () => openDndMenu(anchor) },
    { id: 'invisible', label: 'Invisible<small>Appear offline</small>', icon: dot('offline'), run: () => setStatus('invisible') },
    '-',
    { id: 'avatar', label: 'Change Profile Picture', icon: I.image, run: () => pickAvatar() },
    { id: 'profile', label: 'Edit Profile', icon: I.pencil, run: openSettings },
  ], anchor, { place: 'top', cls: 'menu status-menu' });
}

function openDndMenu(anchor) {
  if (myDnd()) return setStatus('online');
  setTimeout(() => openMenu([
    { id: 'h1', label: 'For 1 hour', icon: MOON, run: () => setStatus('dnd', 60) },
    { id: 'h8', label: 'For 8 hours', icon: MOON, run: () => setStatus('dnd', 480) },
    { id: 'h24', label: 'For 24 hours', icon: MOON, run: () => setStatus('dnd', 1440) },
    { id: 'forever', label: 'Until I turn it off', icon: MOON, run: () => setStatus('dnd') },
  ], anchor, { place: 'top', cls: 'menu dnd-menu' }), 0);
}

function openProfile(uid, anchor) {
  const u = user(uid);
  const rel = relWith(uid);
  const p = presenceOf(uid);
  let actions = '';
  if (uid === S.uid) actions = '<button class="btn btn-sm" data-act="pick-avatar">Change Picture</button><button class="btn btn-sm" data-act="settings">Edit Profile</button>';
  else if (rel?.status === 'accepted') actions = `<button class="btn btn-sm btn-primary" data-act="dm" data-uid="${uid}">Message</button>`;
  else if (rel?.to === S.uid) actions = `<button class="btn btn-sm btn-primary" data-act="accept" data-id="${rel.id}">Accept Friend Request</button>`;
  else if (rel) actions = '<button class="btn btn-sm" disabled>Friend Request Sent</button>';
  else actions = `<button class="btn btn-sm btn-primary" data-act="add-friend-direct" data-username="${esc(u.username || '')}">Add Friend</button>`;
  popover(`
    <div class="pc-banner" style="--g1:${'#5ac8fa'};--g2:${'#0a64ff'}"></div>
    <div class="pc-av">${avatar(u, 76, p)}</div>
    <div class="pc-body">
      <h3>${esc(u.displayName)}</h3><p class="muted">@${esc(u.username || '')}</p>
      <p class="pc-pres pres-text-${p}">${p === 'dnd' ? `${MOON} ` : ''}${esc(presenceText(uid))}</p>
      ${u.bio ? `<div class="pc-sec"><h4>About Me</h4><p>${esc(u.bio)}</p></div>` : ''}
      <div class="pc-actions">${actions}</div>
    </div>`, anchor, { place: 'right', cls: 'profile-card' });
}

function modal(html, cls = '') {
  closeMenu();
  $('#modalRoot').innerHTML = `<div class="modal-back"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  return $('#modalRoot .modal');
}
const closeModal = () => { stopPoll(); $('#modalRoot').innerHTML = ''; };

function toast(html, kind = 'info', ttl = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = kind === 'banner' ? html : esc(html);
  $('#toastRoot').append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ttl);
}

function openLightbox(src) {
  modal(`<img src="${esc(src)}" alt="Photo"><button class="icon-btn lb-close" data-act="close-modal">${I.x}</button>`, 'lightbox');
}

// ---------- compose (new message / group) ----------
function openCompose(groupMode = false) {
  const selected = new Set();
  const m = modal(`
    <header class="modal-head"><h2>${groupMode ? 'Create a Group' : 'New Message'}</h2><button class="icon-btn sm" data-act="close-modal">${I.x}</button></header>
    <div class="to-field"><span>To:</span><span id="toChips"></span><input id="toInput" placeholder="Find friends" autocomplete="off"></div>
    <div class="to-name" id="toNameRow" hidden><input id="groupNameInput" placeholder="Group name (optional)" maxlength="50"></div>
    <div class="pick-list" id="pickList"></div>
    <footer class="modal-foot"><button class="btn btn-primary" id="startBtn" disabled>Start Chat</button></footer>`, 'compose');
  const draw = () => {
    const q = $('#toInput', m).value.trim().toLowerCase();
    const ids = friendIds().sort(byName).filter((u) => !q || user(u).displayName.toLowerCase().includes(q) || (user(u).username || '').includes(q));
    $('#toChips', m).innerHTML = [...selected].map((u) => `<button class="chip" data-pick="${u}">${esc(user(u).displayName)} ${I.x}</button>`).join('');
    $('#pickList', m).innerHTML = ids.length ? ids.map((u) => `
      <button class="pick ${selected.has(u) ? 'on' : ''}" data-pick="${u}">${avatar(user(u), 36, presenceOf(u))}
        <span><b>${esc(user(u).displayName)}</b><small>@${esc(user(u).username || '')}</small></span><i class="check">${I.check}</i></button>`).join('')
      : `<div class="list-empty">${friendIds().length ? 'No matches.' : 'Add some friends first.'}</div>`;
    $('#toNameRow', m).hidden = selected.size < 2;
    const btn = $('#startBtn', m);
    btn.disabled = !selected.size;
    btn.textContent = selected.size > 1 ? `Create Group (${selected.size + 1})` : 'Start Chat';
  };
  m.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pick]');
    if (!p) return;
    const u = p.dataset.pick;
    if (selected.has(u)) selected.delete(u); else selected.add(u);
    $('#toInput', m).value = '';
    draw();
    $('#toInput', m).focus();
  });
  $('#toInput', m).oninput = draw;
  $('#toInput', m).onkeydown = (e) => {
    if (e.key === 'Backspace' && !e.target.value && selected.size) { selected.delete([...selected].at(-1)); draw(); }
    if (e.key === 'Enter') { const first = $('[data-pick]:not(.chip)', m); if (first) first.click(); }
  };
  $('#startBtn', m).onclick = async () => {
    const ids = [...selected];
    closeModal();
    if (ids.length === 1) openDM(ids[0]);
    else createGroup(ids, $('#groupNameInput', m).value.trim()).catch(() => toast("Couldn't create the group", 'error'));
  };
  draw();
  $('#toInput', m).focus();
}

function openAddPeople(c) {
  const selected = new Set();
  const candidates = friendIds().filter((u) => !c.members.includes(u)).sort(byName);
  const m = modal(`
    <header class="modal-head"><h2>Add People</h2><button class="icon-btn sm" data-act="close-modal">${I.x}</button></header>
    <div class="pick-list" id="pickList">${candidates.length ? candidates.map((u) => `
      <button class="pick" data-pick="${u}">${avatar(user(u), 36, presenceOf(u))}<span><b>${esc(user(u).displayName)}</b><small>@${esc(user(u).username || '')}</small></span><i class="check">${I.check}</i></button>`).join('')
    : '<div class="list-empty">All your friends are already here.</div>'}</div>
    <footer class="modal-foot"><button class="btn btn-primary" id="addBtn" disabled>Add</button></footer>`, 'compose');
  m.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pick]');
    if (!p) return;
    const u = p.dataset.pick;
    if (selected.has(u)) selected.delete(u); else selected.add(u);
    p.classList.toggle('on', selected.has(u));
    $('#addBtn', m).disabled = !selected.size;
  });
  $('#addBtn', m).onclick = () => { closeModal(); addPeople(c, [...selected]).catch(() => toast("Couldn't add people", 'error')); };
}

// ---------- settings ----------
function openSettings() {
  const me = S.me;
  const p = N.permission();
  const accents = ['#0a84ff', '#34c759', '#af52de', '#ff2d55', '#ff9500', '#5e5ce6'];
  const accent = pref('accent', '#0a84ff');
  const theme = pref('theme', 'system');
  const m = modal(`
    <header class="modal-head"><h2>Settings</h2><button class="icon-btn sm" data-act="close-modal">${I.x}</button></header>
    <div class="settings">
      <section>
        <h3>Profile</h3>
        <div class="set-profile">
          <button class="set-av" id="avBtn" title="Change photo">${avatar(me, 72)}<span>Edit</span></button>
          <input type="file" id="avInput" accept="image/*" hidden>
          <div class="stack grow">
            <label class="field">Display name<input id="setName" value="${esc(me.displayName)}" maxlength="32"></label>
            <label class="field">Username<input value="@${esc(me.username)}" disabled></label>
          </div>
        </div>
        <label class="field">About me<textarea id="setBio" maxlength="190" rows="2" placeholder="Tell your friends something about you">${esc(me.bio || '')}</textarea></label>
        ${me.photoURL ? '<button class="link" id="avRemove">Remove photo</button>' : ''}
      </section>
      <section>
        <h3>Status</h3>
        <div class="seg" id="statusSeg">
          ${[['online', 'Online'], ['idle', 'Idle'], ['dnd', 'Do Not Disturb'], ['invisible', 'Invisible']].map(([v, l]) => `
            <button data-status="${v}" class="${(v === 'dnd' ? myDnd() : me.status === v && !myDnd()) ? 'on' : ''}"><i class="pres pres-${v === 'invisible' ? 'offline' : v} inline"></i>${l}</button>`).join('')}
        </div>
        <p class="hint">Do Not Disturb silences all notifications and sounds. Friends see a moon on your avatar and a
          “notifications silenced” note in your chats. They can still tap <b>Notify Anyway</b> for something urgent.</p>
      </section>
      <section>
        <h3>Notifications</h3>
        <div class="set-row"><span>Desktop notifications<small>${p === 'granted' ? (N.pushActive() ? 'On, including when Bubbles is closed' : 'On while Bubbles is open') : p === 'denied' ? 'Blocked by the browser' : p === 'unsupported' ? 'Not supported here' : 'Off'}</small></span>
          ${p === 'default' ? '<button class="btn btn-sm btn-primary" data-act="enable-notifs">Turn on</button>' : ''}
          ${p === 'granted' ? '<button class="btn btn-sm" id="testNotif">Send test</button>' : ''}</div>
        <label class="set-row toggle"><span>Message sounds</span><input type="checkbox" id="setSound" ${N.soundOn() ? 'checked' : ''}><i class="switch"></i></label>
        <div class="set-row"><span>Read receipts<small>Always on. People can see when you've read their messages.</small></span></div>
      </section>
      <section>
        <h3>Appearance</h3>
        <div class="seg" id="themeSeg">${['system', 'light', 'dark'].map((t) => `<button data-theme="${t}" class="${theme === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
        <div class="accents" id="accents">${accents.map((a) => `<button style="--c:${a}" data-accent="${a}" class="${a === accent ? 'on' : ''}" title="Bubble color"></button>`).join('')}</div>
      </section>
      <section>
        <h3>Account</h3>
        <div class="stack">
          <input type="password" id="curPass" placeholder="Current password" autocomplete="current-password">
          <input type="password" id="newPass" placeholder="New password (6+ characters)" autocomplete="new-password">
          <button class="btn btn-sm" id="changePass">Change password</button>
          <p class="form-err" id="passErr"></p>
        </div>
        <button class="btn btn-danger" id="signOutBtn">${I.logout} Sign out</button>
      </section>
      <section>
        <button class="link" data-act="patch-notes">What's new in Bubbles ${APP_VERSION}</button>
      </section>
    </div>`, 'settings-modal');

  const saveProfile = () => {
    const displayName = $('#setName', m).value.trim();
    const bio = $('#setBio', m).value.trim();
    const patch = {};
    if (displayName && displayName !== me.displayName) patch.displayName = displayName;
    if (bio !== (me.bio || '')) patch.bio = bio;
    if (Object.keys(patch).length) F.updateDoc(userRef(S.uid), patch).then(() => toast('Profile saved'));
  };
  $('#setName', m).onchange = saveProfile;
  $('#setBio', m).onchange = saveProfile;
  $('#avBtn', m).onclick = () => $('#avInput', m).click();
  $('#avInput', m).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const photoURL = await saveAvatar(f);
    if (photoURL) $('#avBtn', m).innerHTML = `${avatar({ ...S.me, photoURL }, 72)}<span>Edit</span>`;
  };
  $('#avRemove', m)?.addEventListener('click', () => F.updateDoc(userRef(S.uid), { photoURL: '' }).then(closeModal));
  $('#statusSeg', m).onclick = (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    if (b.dataset.status === 'dnd') {
      if (!myDnd()) openDndMenu(b);
    } else setStatus(b.dataset.status);
    $$('#statusSeg button', m).forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#testNotif', m)?.addEventListener('click', () => {
    N.notify({ title: 'Bubbles', body: 'Notifications are working! 🎉', chatId: 'test', messageId: String(Date.now()) });
  });
  $('#setSound', m).onchange = (e) => { setPref('sound', e.target.checked ? 'on' : 'off'); if (e.target.checked) { N.unlockAudio(); N.playSound('in'); } };
  $('#themeSeg', m).onclick = (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    setPref('theme', b.dataset.theme);
    if (b.dataset.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = b.dataset.theme;
    $$('#themeSeg button', m).forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#accents', m).onclick = (e) => {
    const b = e.target.closest('[data-accent]');
    if (!b) return;
    setPref('accent', b.dataset.accent);
    document.documentElement.style.setProperty('--accent', b.dataset.accent);
    $$('#accents button', m).forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#changePass', m).onclick = async () => {
    const err = $('#passErr', m);
    err.textContent = '';
    try {
      const cur = $('#curPass', m).value;
      const next = $('#newPass', m).value;
      if (next.length < 6) throw { message: 'New password needs at least 6 characters.' };
      const u = auth.currentUser;
      await F.reauthenticateWithCredential(u, F.EmailAuthProvider.credential(u.email, cur));
      await F.updatePassword(u, next);
      $('#curPass', m).value = '';
      $('#newPass', m).value = '';
      toast('Password changed');
    } catch (ex) {
      err.textContent = authError(ex);
    }
  };
  $('#signOutBtn', m).onclick = async () => {
    closeModal();
    await F.updateDoc(userRef(S.uid), { state: 'offline' }).catch(() => {});
    await N.disablePush(S.uid);
    location.hash = '';
    F.signOut(auth);
  };
}

// ---------- profile picture ----------
async function saveAvatar(file) {
  try {
    const photoURL = await compressImage(file, 256, 90_000);
    await F.updateDoc(userRef(S.uid), { photoURL });
    toast('Profile picture updated');
    return photoURL;
  } catch (e) {
    toast(e.message, 'error');
    return null;
  }
}

function pickAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => { if (input.files[0]) saveAvatar(input.files[0]); };
  input.click();
}

// ---------- emoji (system emoji via emoji-picker-element, loaded on first use) ----------
let emojiLib = null;
async function openEmojiPicker(anchor, onPick) {
  emojiLib ||= import(EMOJI_PICKER_URL);
  try { await emojiLib; } catch {
    emojiLib = null;
    return toast("Couldn't load emoji. Check your connection.", 'error');
  }
  const theme = pref('theme', 'system');
  const el = popover(`<emoji-picker class="${theme === 'system' ? '' : theme}"></emoji-picker>`, anchor, { place: 'top', cls: 'emoji-pop' });
  $('emoji-picker', el).addEventListener('emoji-click', (e) => onPick(e.detail.unicode));
}

// ---------- GIFs (built-in library from js/gifs.js) ----------
const gifUrl = (entry) => `https://media.tenor.com/${entry}.gif`;
const gifTile = (entry) => `<button class="gif-item" data-gif="${esc(entry)}"><img src="${gifUrl(entry)}" alt="${esc(entry.split('/')[1].replace(/-/g, ' '))}" loading="lazy"></button>`;

function searchGifs(q) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const seen = new Set();
  const hits = [];
  for (const c of GIF_CATEGORIES) {
    for (const g of c.gifs) {
      const tags = `${c.name} ${g.split('/')[1]}`.toLowerCase().split(/[^a-z0-9]+/);
      if (seen.has(g) || !words.every((w) => tags.some((t) => t.startsWith(w)))) continue;
      seen.add(g);
      hits.push(g);
    }
  }
  return hits;
}

function openGifPicker(anchor) {
  const el = popover(`
    <div class="gif-head"><input type="search" class="gif-search" placeholder="Search GIFs" autocomplete="off"></div>
    <div class="gif-body"></div>`, anchor, { place: 'top', cls: 'gif-pop' });
  const body = $('.gif-body', el);
  const search = $('.gif-search', el);
  const show = (html) => { body.innerHTML = html; body.scrollTop = 0; };
  const home = () => show(`<div class="gif-cats">${GIF_CATEGORIES.map((c, i) => `
    <button class="gif-cat" data-cat="${i}"><img src="${gifUrl(c.gifs[0])}" alt="" loading="lazy"><span>${c.icon} ${esc(c.name)}</span></button>`).join('')}</div>`);
  const category = (c) => show(`<button class="gif-back" data-back>${I.back} ${c.icon} ${esc(c.name)}</button>
    <div class="gif-grid">${c.gifs.map(gifTile).join('')}</div>`);
  search.addEventListener('input', () => {
    const q = search.value.trim();
    if (!q) return home();
    const hits = searchGifs(q);
    show(hits.length ? `<div class="gif-grid">${hits.map(gifTile).join('')}</div>` : '<p class="gif-empty">No GIFs found. Try another word.</p>');
  });
  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-gif], [data-cat], [data-back]');
    if (!t) return;
    // Re-rendering detaches the clicked tile, which the document's click-outside check would read as
    // a click outside the picker and close it.
    e.stopPropagation();
    if (t.dataset.gif) { closeMenu(); sendGif(gifUrl(t.dataset.gif)); return; }
    if (t.dataset.cat) category(GIF_CATEGORIES[+t.dataset.cat]);
    else { search.value = ''; home(); }
  });
  home();
  if (matchMedia('(pointer: fine)').matches) search.focus();
}

function insertEmoji(emoji) {
  const input = $('#input');
  if (!input) return;
  const { selectionStart: a, selectionEnd: b, value } = input;
  input.value = value.slice(0, a) + emoji + value.slice(b);
  input.selectionStart = input.selectionEnd = a + emoji.length;
  onComposerInput();
}

// ---------- patch notes ----------
function maybeShowPatchNotes() {
  if (!S.me || pref('seenVersion', '') === APP_VERSION) return;
  setPref('seenVersion', APP_VERSION);
  if (!$('#modalRoot').children.length) openPatchNotes();
}

function openPatchNotes() {
  const m = modal(`
    <header class="modal-head"><h2>What's new in Bubbles ${APP_VERSION}</h2><button class="icon-btn sm" data-act="close-modal">${I.x}</button></header>
    <div class="notes">${PATCH_INTRO ? `<p class="notes-intro">${shineGoat(esc(PATCH_INTRO))}</p>` : ''}${PATCH_POLL ? `
      <div class="poll"><b class="poll-q">${shineGoat(esc(PATCH_POLL.question))}</b><div class="poll-opts" id="pollOpts"></div><small class="poll-foot" id="pollFoot">Loading votes…</small></div>` : ''}${PATCH_NOTES.map((n, i) => `
      <div class="note"><span class="note-icon">${n.icon}</span>
        <div><b>${esc(n.title)}</b><p>${n.text}</p>${n.btn ? `<button class="btn btn-sm" data-note="${i}">${esc(n.btn)}</button>` : ''}</div></div>`).join('')}
    </div>
    <footer class="modal-foot"><button class="btn btn-primary" data-act="close-modal">Got it</button></footer>`, 'patch-notes');
  m.addEventListener('click', (e) => {
    const v = e.target.closest('[data-vote]');
    if (v) return vote(+v.dataset.vote);
    const b = e.target.closest('[data-note]');
    if (!b) return;
    closeModal();
    PATCH_NOTES[b.dataset.note].run();
  });
  if (PATCH_POLL) watchPoll();
}

const shineGoat = (html) => html.replace('GOAT', '<span class="goat">GOAT</span>');

// ---------- poll ----------
// Everyone sees totals only; a vote can be changed by tapping another option.
let pollUnsub = null;
const votesRef = () => F.collection(db, 'polls', PATCH_POLL.id, 'votes');

function watchPoll() {
  stopPoll();
  pollUnsub = F.onSnapshot(votesRef(), (snap) => {
    if (!$('#pollOpts')) return stopPoll();
    const counts = PATCH_POLL.options.map(() => 0);
    let mine = null;
    snap.forEach((d) => {
      const { choice } = d.data();
      if (counts[choice] !== undefined) counts[choice]++;
      if (d.id === S.uid) mine = choice;
    });
    renderPoll(counts, mine);
  }, () => { if ($('#pollFoot')) $('#pollFoot').textContent = "Couldn't load the poll."; });
}

function stopPoll() { pollUnsub?.(); pollUnsub = null; }

function renderPoll(counts, mine) {
  const total = counts.reduce((a, b) => a + b, 0);
  const voted = mine !== null;
  $('#pollOpts').innerHTML = PATCH_POLL.options.map((o, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    return `<button class="poll-opt ${mine === i ? 'mine' : ''}" data-vote="${i}">
      ${voted ? `<span class="poll-bar" style="width:${pct}%"></span>` : ''}
      <span class="poll-label">${esc(o)}</span>${voted ? `<span class="poll-pct">${pct}%</span>` : ''}</button>`;
  }).join('');
  $('#pollFoot').textContent = voted
    ? `${total} ${total === 1 ? 'vote' : 'votes'} · tap another option to change yours`
    : 'Vote to see the results';
}

function vote(choice) {
  F.setDoc(F.doc(votesRef(), S.uid), { choice, at: F.serverTimestamp() })
    .catch(() => toast("Couldn't save your vote", 'error'));
}

// ============================================================================
// Global events
// ============================================================================
const ACTIONS = {
  compose: (el) => openCompose(!!el.dataset.group),
  settings: () => openSettings(),
  'status-menu': (el) => openStatusMenu(el),
  'dnd-toggle': (el) => openDndMenu(el),
  'enable-notifs': () => enableNotifications(),
  'dismiss-banner': () => { setPref('notifBannerDismissed', '1'); render('nav'); },
  tab: (el) => { S.friendsTab = el.dataset.tab; render('friends'); },
  dm: (el, e) => { if (!e.target.closest('[data-act="friend-menu"]')) openDM(el.dataset.uid); },
  accept: (el) => acceptRequest(el.dataset.id).then(() => toast('Friend added!')),
  decline: (el) => deleteRel(el.dataset.id),
  'friend-menu': (el) => {
    const uid = el.dataset.uid;
    openMenu([
      { id: 'profile', label: 'Profile', icon: I.info, run: () => openProfile(uid, el) },
      { id: 'msg', label: 'Message', icon: I.message, run: () => openDM(uid) },
      '-',
      { id: 'remove', label: 'Remove Friend', icon: I.userMinus, danger: true, run: () => confirmRemoveFriend(uid) },
    ], el, { place: 'bottom' });
  },
  'add-friend-direct': (el) => sendFriendRequest(el.dataset.username).then(toast, (e) => toast(e.message, 'error')).then(closeMenu),
  'copy-username': () => navigator.clipboard.writeText(S.me.username).then(() => toast('Username copied')),
  profile: (el) => openProfile(el.dataset.uid, el),
  details: () => { S.detailsOpen = !S.detailsOpen; renderChatChrome(); },
  mute: () => toggleMute(S.chats.get(S.route.id)),
  call: () => { const c = S.chats.get(S.route.id); if (c?.type === 'dm') startCall(c.id, otherMember(c)); },
  'add-people': () => openAddPeople(S.chats.get(S.route.id)),
  leave: () => {
    const m = modal(`<header class="modal-head"><h2>Leave conversation?</h2></header>
      <p class="modal-text">You'll stop getting messages from this group.</p>
      <footer class="modal-foot"><button class="btn" data-act="close-modal">Cancel</button><button class="btn btn-danger" id="okLeave">Leave</button></footer>`, 'small');
    $('#okLeave', m).onclick = () => { closeModal(); leaveGroup(S.chats.get(S.route.id)); };
  },
  'notify-anyway': () => { S.urgentNext = true; renderChatChrome(); $('#input').focus(); },
  'urgent-off': () => { S.urgentNext = false; renderChatChrome(); },
  attach: () => $('#fileInput').click(),
  emoji: (el) => {
    if ($('#menuRoot .emoji-pop')) return closeMenu();
    openEmojiPicker(el, insertEmoji);
  },
  gif: (el) => {
    if ($('#menuRoot .gif-pop')) return closeMenu();
    openGifPicker(el);
  },
  'react-more': (el) => {
    const m = findMsg(el.dataset.id);
    const anchor = $(`#m-${CSS.escape(el.dataset.id)} .msg-content`) || el;
    if (m) openEmojiPicker(anchor, (e) => { closeMenu(); toggleReaction(m, e); });
  },
  'wall-pick': () => $('#wallInput')?.click(),
  'wall-remove': () => setWallpaper(S.chats.get(S.route.id), null),
  'pick-avatar': () => { closeMenu(); pickAvatar(); },
  'patch-notes': () => openPatchNotes(),
  send: () => send(),
  'cancel-compose': () => cancelCompose(),
  jump: () => { scrollToBottom(); $('#jump').hidden = true; },
  'jump-to': (el) => {
    const t = $(`#m-${CSS.escape(el.dataset.id)}`);
    if (!t) return toast('That message is further back');
    t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    t.classList.add('flash');
    setTimeout(() => t.classList.remove('flash'), 1400);
  },
  tapback: (el) => { const m = findMsg(el.dataset.id); if (m) openTapback(m, el.closest('.msg-content')); },
  react: (el) => { const m = findMsg(el.dataset.id); if (m) toggleReaction(m, el.dataset.emoji); },
  reply: (el) => { const m = findMsg(el.dataset.id); if (m) startReply(m); },
  edit: (el) => { const m = findMsg(el.dataset.id); if (m) startEdit(m); },
  'msg-menu': (el) => { const m = findMsg(el.dataset.id); if (m) openMsgMenu(m, el); },
  lightbox: (el) => openLightbox(el.src),
  spoiler: (el) => el.classList.add('shown'),
  'open-chat': (el) => { location.hash = `#/chat/${el.dataset.id}`; },
  'close-modal': () => closeModal(),
};

const findMsg = (id) => S.msgs.find((m) => m.id === id);

function confirmRemoveFriend(uid) {
  const m = modal(`<header class="modal-head"><h2>Remove '${esc(user(uid).displayName)}'</h2></header>
    <p class="modal-text">Are you sure you want to remove <b>${esc(user(uid).displayName)}</b> from your friends?</p>
    <footer class="modal-foot"><button class="btn" data-act="close-modal">Cancel</button><button class="btn btn-danger" id="okRemove">Remove Friend</button></footer>`, 'small');
  $('#okRemove', m).onclick = () => { closeModal(); deleteRel(pairId(S.uid, uid)); };
}

function bindGlobalEvents() {
  document.addEventListener('pointerdown', N.unlockAudio, { once: true });
  document.addEventListener('keydown', N.unlockAudio, { once: true });

  document.addEventListener('click', (e) => {
    const menuItem = e.target.closest('[data-menu]');
    if (menuItem) {
      const run = menuHandlers[menuItem.dataset.menu];
      closeMenu();
      run?.();
      return;
    }
    if (e.target.classList.contains('modal-back')) return closeModal();
    const el = e.target.closest('[data-act]');
    if (!e.target.closest('#menuRoot') && !(el && ['tapback', 'msg-menu', 'friend-menu', 'status-menu', 'dnd-toggle', 'profile', 'emoji', 'gif'].includes(el.dataset.act))) closeMenu();
    if (!el || !ACTIONS[el.dataset.act]) return;
    if (el.tagName !== 'INPUT') e.preventDefault();
    const inMenu = el.closest('#menuRoot');
    ACTIONS[el.dataset.act](el, e);
    if (inMenu && el.dataset.act !== 'react') closeMenu();
  });

  // iMessage: double-click a bubble to tapback.
  document.addEventListener('dblclick', (e) => {
    const c = e.target.closest('[data-dbl]');
    if (!c || e.target.closest('a, button')) return;
    window.getSelection()?.removeAllRanges();
    const m = findMsg(c.dataset.dbl);
    if (m) openTapback(m, c);
  });

  document.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-ctx="msg"]');
    if (row && !e.target.closest('a')) {
      const m = findMsg(row.dataset.id);
      if (m) { e.preventDefault(); openMsgMenu(m, row, { x: e.clientX, y: e.clientY }); }
      return;
    }
    const chat = e.target.closest('[data-ctx="chat"]');
    if (chat) {
      e.preventDefault();
      const c = S.chats.get(chat.dataset.id);
      openMenu([
        { id: 'read', label: 'Mark as Read', icon: I.check, run: () => F.updateDoc(chatRef(c.id), { [`lastRead.${S.uid}`]: F.serverTimestamp() }) },
        { id: 'mute', label: isMuted(c) ? 'Show Alerts' : 'Hide Alerts', icon: isMuted(c) ? I.bell : I.bellOff, run: () => toggleMute(c) },
      ], chat, { place: 'point', at: { x: e.clientX, y: e.clientY } });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#menuRoot').children.length) return closeMenu();
      if ($('#modalRoot').children.length) return closeModal();
      if (S.detailsOpen) { S.detailsOpen = false; renderChatChrome(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#search')?.focus();
    }
  });

  $('#search').addEventListener('input', (e) => { S.search = e.target.value; render('nav'); });
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', () => { maybeMarkRead(); onVisibility(); });
  window.addEventListener('pagehide', () => { if (S.uid) F.updateDoc(userRef(S.uid), { state: 'offline' }).catch(() => {}); });
  // Only a width change moves anchors. Phones change height whenever the keyboard or address bar
  // slides in or out, which would close a menu the moment it is used.
  let lastWidth = innerWidth;
  window.addEventListener('resize', () => {
    if (innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    closeMenu();
  });
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'open-chat') location.hash = `#/chat/${e.data.chatId}`;
  });
}

boot();
