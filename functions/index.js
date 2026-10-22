// Optional: sends a push notification for every new message, so people get notified
// even when Bubbles is closed. Needs the Firebase Blaze plan (it stays within the free
// allowance for a friend group). Deploy with: firebase deploy --only functions
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();

const STALE_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const dndActive = (u) => u.status === 'dnd' && (!u.dndUntil || u.dndUntil.toMillis() > Date.now());

exports.notifyNewMessage = onDocumentCreated('chats/{chatId}/messages/{messageId}', async (event) => {
  const msg = event.data?.data();
  if (!msg || msg.system) return;
  const { chatId, messageId } = event.params;
  const db = getFirestore();

  const [chatSnap, senderSnap] = await Promise.all([
    db.doc(`chats/${chatId}`).get(),
    db.doc(`users/${msg.senderId}`).get(),
  ]);
  const chat = chatSnap.data();
  if (!chat) return;
  const sender = senderSnap.data() || {};
  const senderName = sender.displayName || 'Someone';

  const title = chat.type === 'group' ? `${senderName} in ${chat.name || 'your group'}` : senderName;
  const body = (msg.urgent ? '🌙 ' : '') + (msg.image ? (msg.text || '📷 Photo') : msg.text || '').slice(0, 180);
  const icon = /^https?:/.test(sender.photoURL || '') ? sender.photoURL : '';

  await Promise.all(chat.members.filter((uid) => uid !== msg.senderId).map(async (uid) => {
    const user = (await db.doc(`users/${uid}`).get()).data() || {};
    // Do Not Disturb and "Hide Alerts" both silence pushes, unless the sender used Notify Anyway.
    if (!msg.urgent && (dndActive(user) || (user.muted || []).includes(chatId))) return;
    const tokens = await db.collection(`users/${uid}/tokens`).get();
    if (tokens.empty) return;
    const res = await getMessaging().sendEachForMulticast({
      tokens: tokens.docs.map((d) => d.id),
      data: { title, body, icon, chatId, messageId },
      webpush: { headers: { Urgency: 'high', TTL: '86400' } },
    });
    await Promise.all(res.responses.map((r, i) => (
      !r.success && STALE_TOKEN.has(r.error?.code) ? tokens.docs[i].ref.delete() : null
    )));
  }));
});
