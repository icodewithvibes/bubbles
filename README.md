# Bubbles

Real-time chat for you and your friends. It looks like iMessage, with a few Discord pieces, and it's hosted free on GitHub Pages with Firebase behind it.

**Features**
- **Accounts with just a username and password.** No Google or email needed.
- **Friends.** Add people by @username and manage requests (Online / All / Pending / Add Friend, like Discord).
- **DMs and group chats.** Messages show up instantly, with typing indicators and presence (online / idle / Do Not Disturb / invisible).
- **Read receipts, always on.** Messages show "Delivered", then "Read 3:14 PM". In groups it's "Read by Alex, Sam".
- **iMessage-style chat.** Blue and gray bubbles with tails, tapbacks (double-click a message), replies, edits, unsend, photos (paste or drag in), emoji-only messages shown big, and timestamps.
- **Discord-style extras.** Server rail, hover toolbar on messages, profile cards, the Active Now panel, and markdown (`**bold**`, `*italic*`, `~~strike~~`, `||spoiler||`, `` `code` ``).
- **Do Not Disturb.** Silences your notifications for 1 hour, 8 hours, 24 hours or until you turn it off. Friends see a moon on your avatar and "*Name* has notifications silenced", plus a **Notify Anyway** button for something urgent.
- **Notifications.** System notifications on a Chromebook, a sound, unread count in the tab title, and a badge on the installed app icon. You can mute single conversations ("Hide Alerts").
- **Installable app (PWA)**, with light and dark mode and a bubble color picker.

---

## Setup (about 10 minutes, free)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com>, then **Add project**. Google Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
   (People never type an email. Bubbles turns `@alex` into a placeholder login behind the scenes.)
3. **Build → Firestore Database → Create database.** Pick a location near you and start in **production mode**.
4. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
5. Go to **Project settings** (gear icon) → **General** → **Your apps** → click **`</>`** (Web), register the app (skip Hosting), and copy the `firebaseConfig` values into [`firebase-config.js`](firebase-config.js).

### 2. Put it on GitHub Pages
1. Create a GitHub repo and push this folder to it.
2. In the repo, go to **Settings → Pages → Build and deployment**, set **Source: Deploy from a branch**, choose **Branch: `main` / root**, and save.
3. After a minute the site is live at `https://YOUR-NAME.github.io/REPO-NAME/`.
4. Back in Firebase, go to **Authentication → Settings → Authorized domains → Add domain** and enter `YOUR-NAME.github.io`.

### 3. Notifications on a Chromebook
1. Open the site in Chrome and click **Turn on** in the blue banner (or go to Settings → Notifications).
2. **Install it as an app.** Click the install icon at the right end of the address bar (or ⋮ → *Cast, save and share → Install page as app*). It then opens in its own window, gets a shelf icon with an unread badge, and its notifications look like a native app's.
3. Check that ChromeOS isn't blocking them: **Settings → Apps → Notifications** must allow Chrome and Bubbles. ChromeOS's own *Do Not Disturb* in Quick Settings also silences everything.

With only those steps, notifications arrive whenever Bubbles is open, including when it's minimized or in a background tab. If you also want them when the app is fully closed, see the optional step below.

### 4. (Optional) Push notifications when the app is closed
This needs a Cloud Function, which requires Firebase's **Blaze** (pay-as-you-go) plan. A friend group stays far inside the free allowance, but it does need a billing card on file.

1. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair.** Paste the key into `FIREBASE_VAPID_KEY` in `firebase-config.js`.
2. Upgrade the project to Blaze (bottom left of the console). Then run:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add            # pick your project
   cd functions && npm install && cd ..
   firebase deploy --only functions,firestore:rules
   ```
The function ([`functions/index.js`](functions/index.js)) skips people on Do Not Disturb and conversations someone has muted. Notify Anyway messages still get through.

---

## How it works

| Piece | What it uses |
|---|---|
| Real-time messages | Firestore `onSnapshot` listeners. Every change reaches everyone in milliseconds over a single WebSocket-style channel. |
| Accounts | Firebase Auth with email/password, where `alex` becomes `alex@bubbles.example.com`. Auth refuses duplicate logins, which keeps usernames unique. |
| Read receipts | Each chat stores `lastRead.{uid}`. It's updated whenever you're looking at the conversation (window focused and scrolled to the bottom). |
| Typing | `typing.{uid}` is set to a timestamp, refreshed every 3 s while you type, and expires after 6 s. |
| Presence | Heartbeat every 3 minutes, plus visibility changes. You count as offline 7 minutes after the last heartbeat. |
| Photos | Re-compressed to JPEG in the browser and stored inside the message (no Firebase Storage needed, so it stays on the free plan). |
| Security | [`firestore.rules`](firestore.rules): only members can read a conversation, DMs require being friends, only the recipient can accept a request, and you can only change your own reactions. |

**Data model:** `users/{uid}`, `usernames/{name}`, `friendRequests/{uidA_uidB}`, `chats/{id}`, `chats/{id}/messages/{id}`, `users/{uid}/tokens/{token}`.

**Free plan limits (Spark):** 50k document reads and 20k writes per day, which is plenty for a group of friends.

## Notes
- **Forgotten passwords:** there's no email, so there's no reset link. Users can change their password in Settings while signed in. If someone is locked out, delete their account under Firebase console → Authentication and they can sign up again.
- **Usernames are permanent.** Display names, photos and bio can be changed in Settings.
- **Shortcuts:** Enter sends, Shift+Enter adds a new line, ↑ edits your last message, Esc cancels a reply or edit, Ctrl+K searches, and double-clicking a message opens tapbacks. The Chromebook emoji picker is Search + Shift + Space.

## Local testing with the emulators
```bash
npm install -g firebase-tools
firebase emulators:start --only auth,firestore --project demo-bubbles
python3 -m http.server 5173      # in another terminal
```
Open <http://localhost:5173/?emulator>. Use a second browser profile or an incognito window to play the other person.
