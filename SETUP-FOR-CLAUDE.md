# Instructions for Claude: deploy Bubbles to GitHub Pages

You're on the user's computer. This folder is a finished static web app (a real-time chat) that needs:
1. a Firebase project for the backend, and
2. a GitHub repo with GitHub Pages turned on.

**There is no build step.** Upload the files exactly as they are. The only file to edit is `firebase-config.js`.

The user may not be technical. Explain each step in plain words. Pause when they need to click something or sign in.
Never commit or print secrets, but note that the Firebase web config is **not** secret (it is meant to be public; `firestore.rules` protects the data).

---

## 0. Check tools

```bash
git --version
gh --version          # GitHub CLI
node --version        # needed for firebase-tools
```
- If `gh` is missing, install it (macOS: `brew install gh`, Windows: `winget install GitHub.cli`, ChromeOS Linux / Debian: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md).
- If `node` is missing, install Node.js LTS from https://nodejs.org.
- Then run `npm install -g firebase-tools`.

If installing tools isn't possible, every step below also works by hand in the web consoles. Walk the user through those instead.

## 1. Firebase project (free Spark plan)

```bash
firebase login                       # opens a browser; the user signs in with their Google account
firebase projects:create bubbles-chat-<random 4-6 chars> --display-name "Bubbles"
firebase use <that-project-id>
firebase apps:create web "Bubbles Web"
firebase apps:sdkconfig web          # prints the firebaseConfig object
```
Copy the printed values (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) into `self.FIREBASE_CONFIG` in `firebase-config.js`. Leave `FIREBASE_VAPID_KEY` as `""` for now.

Create the database and publish the security rules:
```bash
firebase firestore:databases:create "(default)" --location=nam5    # pick a location near the user, e.g. eur3 for Europe
firebase deploy --only firestore:rules
```

### Turn on sign-in: a console step the user must click through
The CLI can't enable sign-in methods, so open the link and guide the user:
`https://console.firebase.google.com/project/<project-id>/authentication/providers`
→ **Get started** (if shown) → **Email/Password** → enable the first toggle only → **Save**.

(The app has username + password accounts only. It turns `alex` into `alex@bubbles.example.com` behind the scenes, so no real emails are involved.)

## 2. GitHub repo + Pages

```bash
gh auth status || gh auth login      # user signs in to GitHub in the browser
cd <this folder>
git init -b main                     # skip if .git already exists
git add -A
git commit -m "Bubbles chat app"
gh repo create bubbles --public --source=. --push
```
Pages needs a **public** repo on a free GitHub account. If the name `bubbles` is taken, choose another and use it below.

Enable Pages from the `main` branch root:
```bash
OWNER=$(gh api user --jq .login)
gh api -X POST "repos/$OWNER/bubbles/pages" -f "source[branch]=main" -f "source[path]=/"
gh api "repos/$OWNER/bubbles/pages" --jq .html_url
```
The site will be at `https://<owner>.github.io/bubbles/` and usually takes 1–2 minutes to go live. To check:
`gh api "repos/$OWNER/bubbles/pages/builds/latest" --jq .status` (wait for `built`).

## 3. Allow the GitHub domain to sign in (console step)
`https://console.firebase.google.com/project/<project-id>/authentication/settings`
→ **Authorized domains** → **Add domain** → `<owner>.github.io` (domain only, no `https://` or path).

## 4. Verify
Open `https://<owner>.github.io/bubbles/` and check that:
- the sign-in page shows (not the "Almost there" setup page; if it shows, `firebase-config.js` wasn't filled in or isn't pushed);
- **Create an account** works. If you see *"Turn on Email/Password sign-in"*, step 1's console toggle was missed. *"Permission denied"* means the rules weren't deployed;
- a second account (incognito window) can be added as a friend and messages arrive instantly.

## 5. Hand-off to the user
Tell them:
- Their link: `https://<owner>.github.io/bubbles/`. Friends make their own accounts there, then add each other by @username.
- **On the Chromebook:**
  - Click **Turn on** in the blue notifications banner.
  - Install it as an app (install icon at the right of the address bar, or ⋮ → *Cast, save and share → Install page as app*).
  - Check that ChromeOS Settings → Apps → Notifications allows Chrome and Bubbles.
- Notifications work while the app is open (even minimized).
- To change the site later: edit the files, then run `git add -A && git commit -m "..." && git push`. Pages redeploys automatically.

## Optional (only if the user asks): notifications when the app is fully closed
This needs the Firebase **Blaze** plan (a card on file, though a friend group stays inside the free allowance). Get the user's OK first, because it involves billing.
1. Console → Project settings → Cloud Messaging → Web Push certificates → **Generate key pair**. Put the key in `FIREBASE_VAPID_KEY` in `firebase-config.js`, then commit and push.
2. Upgrade the project to Blaze in the console.
3. Run `cd functions && npm install && cd .. && firebase deploy --only functions`.

## Troubleshooting
- **Blank page or old version:** hard refresh (Ctrl+Shift+R). A service worker caches the app, but it fetches the network first.
- **`auth/unauthorized-domain` / sign-in popup errors:** step 3 was missed.
- **Firestore "index" errors:** none should happen. The app needs no composite indexes.
- **`firebase projects:create` fails:** the user may need to accept the Firebase terms once at https://console.firebase.google.com first, or the project ID is taken (pick another).
