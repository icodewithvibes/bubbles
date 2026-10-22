// Notifications, sounds and the app badge.
//
// Two delivery paths, deduplicated by tag (chat id) + message id:
//  1. In-page: the Firestore listener sees a new message and shows a system notification.
//     Works whenever the app is open, even minimized or in a background tab.
//  2. Push (FCM): a Cloud Function sends a web push; the service worker shows it.
//     Works even when the app is fully closed (needs a VAPID key + the function deployed).
import { app, db, doc, setDoc, deleteDoc, serverTimestamp } from './firebase.js';
import { sleep } from './util.js';

const MESSAGING = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js';
const ICON = new URL('../icons/icon-192.png', import.meta.url).href;
const BADGE = new URL('../icons/badge-72.png', import.meta.url).href;

let reg = null;
let messaging = null;
let token = null;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
  return reg;
}

export const supported = () => 'Notification' in window;
export const permission = () => (supported() ? Notification.permission : 'unsupported');
export const pushConfigured = () => !!self.FIREBASE_VAPID_KEY;
export const pushActive = () => !!token;

export async function requestPermission() {
  if (!supported()) return 'unsupported';
  return Notification.requestPermission();
}

// Registers this browser for background push and stores the token for the Cloud Function.
export async function enablePush(uid) {
  if (!pushConfigured() || permission() !== 'granted' || !reg) return false;
  try {
    const m = await import(MESSAGING);
    if (!(await m.isSupported())) return false;
    messaging ??= m.getMessaging(app);
    await navigator.serviceWorker.ready;
    token = await m.getToken(messaging, { vapidKey: self.FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return false;
    await setDoc(doc(db, 'users', uid, 'tokens', token), {
      token, ua: navigator.userAgent.slice(0, 200), updatedAt: serverTimestamp(),
    });
    // While a page is visible FCM hands pushes to the page instead of the worker; the
    // Firestore listener already covers that case, so there is nothing to do here.
    m.onMessage(messaging, () => {});
    return true;
  } catch (e) {
    console.warn('Push registration failed', e);
    token = null;
    return false;
  }
}

export async function disablePush(uid) {
  if (!token) return;
  const t = token;
  token = null;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tokens', t));
    const m = await import(MESSAGING);
    await m.deleteToken(messaging);
  } catch (e) {
    console.warn(e);
  }
}

export async function notify({ title, body, icon, chatId, messageId }) {
  if (permission() !== 'granted') return;
  const opts = {
    body, icon: icon || ICON, badge: BADGE, tag: chatId, renotify: true,
    data: { chatId, messageId },
  };
  try {
    if (reg) {
      if (pushActive()) {
        // Give the push a moment to land; skip if the worker already showed this message.
        await sleep(2500);
        const shown = await reg.getNotifications({ tag: chatId });
        if (shown.some((n) => n.data?.messageId === messageId)) return;
      }
      await reg.showNotification(title, opts);
    } else {
      const n = new Notification(title, opts);
      n.onclick = () => { window.focus(); location.hash = `#/chat/${chatId}`; n.close(); };
    }
  } catch (e) {
    console.warn('Notification failed', e);
  }
}

export async function clearChatNotifications(chatId) {
  if (!reg?.getNotifications) return;
  for (const n of await reg.getNotifications({ tag: chatId })) n.close();
}

// ---------- sounds (synthesized, no audio files) ----------
let ctx = null;
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no audio */ }
}

export const soundOn = () => localStorage.getItem('bubbles.sound') !== 'off';

export function playSound(kind = 'in') {
  if (!ctx || !soundOn()) return;
  const now = ctx.currentTime;
  const notes = kind === 'in' ? [[880, 0], [1318.5, 0.1]] : [[523.25, 0], [1046.5, 0.05]];
  const vol = kind === 'in' ? 0.16 : 0.07;
  for (const [freq, dt] of notes) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now + dt);
    g.gain.exponentialRampToValueAtTime(vol, now + dt + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dt + (kind === 'in' ? 0.4 : 0.18));
    o.connect(g).connect(ctx.destination);
    o.start(now + dt);
    o.stop(now + dt + 0.45);
  }
}

// Tab title + installed-app badge (shows on the Chromebook shelf icon).
export function setBadge(n) {
  document.title = (n ? `(${n}) ` : '') + 'Bubbles';
  if ('setAppBadge' in navigator) {
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }
}
