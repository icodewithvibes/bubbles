/* Service worker: makes Bubbles installable, keeps the app shell available offline,
   and shows push notifications while the app is closed. */
const CACHE = 'bubbles-v9';
const SHELL = [
  './', './index.html', './css/style.css', './firebase-config.js', './manifest.webmanifest',
  './js/app.js', './js/call.js', './js/firebase.js', './js/gifs.js', './js/notify.js', './js/util.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/badge-72.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network first so a fresh `git push` shows up immediately; cache is the offline fallback.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      // GitHub Pages lets browsers reuse files for 10 minutes; revalidate so a push shows up on reopen.
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    } catch {
      return (await caches.match(req, { ignoreSearch: true })) || caches.match('./index.html');
    }
  })());
});

// ---------- background push (Firebase Cloud Messaging) ----------
try {
  importScripts('./firebase-config.js');
  if (self.FIREBASE_CONFIG?.apiKey && self.FIREBASE_VAPID_KEY) {
    importScripts(
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js',
    );
    firebase.initializeApp(self.FIREBASE_CONFIG);
    firebase.messaging().onBackgroundMessage((payload) => {
      const d = payload.data || {};
      return self.registration.showNotification(d.title || 'New message', {
        body: d.body || '',
        icon: d.icon || './icons/icon-192.png',
        badge: './icons/badge-72.png',
        tag: d.chatId,
        renotify: true,
        data: { chatId: d.chatId, messageId: d.messageId },
      });
    });
  }
} catch (err) {
  console.warn('Push disabled in service worker', err);
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const chatId = e.notification.data?.chatId;
  const url = new URL(chatId && chatId !== 'test' ? `./#/chat/${chatId}` : './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      if (chatId) win.postMessage({ type: 'open-chat', chatId });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
