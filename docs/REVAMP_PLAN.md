# Bubbles v2 revamp

Branch: `revamp/v2`. The live site keeps running from `main` (old static app) until v2 is merged.
Old code lives in `legacy/` as the reference for every feature being ported.

## Decisions (made 2026-11-22)
| Topic | Choice | Why |
|---|---|---|
| Stack | React + TypeScript + Vite, Tailwind, shadcn/21st.dev components | Bundled + minified, npm packages, 21st.dev components drop in |
| Deploy | GitHub Actions → GitHub Pages (`.github/workflows/deploy.yml`) | Same URL `icodewithvibes.github.io/bubbles/` |
| Media | Firebase Storage (needs Blaze plan) | Videos, voice notes, big photos; keeps Firestore docs tiny |
| Dictation | Whisper in the browser (`@huggingface/transformers`, WebGPU → WASM fallback) | Free, private, accurate |
| Data | Same Firebase project `bubbles-a2d52` | Accounts, friends, chats and history carry over |

## The missing-messages bug
Root cause (v1): photos and wallpapers stored inline as base64 inside Firestore docs (up to ~900 KB each) plus an
unbounded persistent IndexedDB cache. When the cache hit the storage quota or got corrupted (multiple tabs, crash
mid-write), listeners stalled; errors only showed a toast, so only clearing site data recovered.
v2 fix (`src/lib/firebase.ts`): media moves to Storage, cache capped at 40 MB, cache failures detected →
cache wiped automatically → reload on memory cache. Plus listener auto-retry.

## Phases
1. **Foundation** — Vite/React/Tailwind scaffold, Firebase layer, deploy workflow. ✅ started
2. **Port core** — auth, profiles, friends, DMs/groups, messages, receipts, typing, presence, DND, notifications,
   settings, wallpapers, calls, polls/patch notes. Must reach parity before anything new ships.
3. **Media** — Storage upload pipeline with progress; photos up to 25 MB, videos up to 100 MB (compressed client-side
   when possible), thumbnails; `storage.rules` (members-only reads).
4. **Camera** — camera button → live self-view → photo or hold-to-record video → preview → send.
5. **Voice messages** — hold-to-record like iMessage, live waveform, playback with scrubbing, Whisper transcript under
   the bubble.
6. **Reactions** — iMessage-style: the six classic tapbacks plus any emoji (iOS 18+ behaviour), animated, "who reacted" sheet.
7. **GIFs** — searchable GIF API (needs a free API key) + trending + favorites, keeping the built-in library offline.
8. **App themes** — whole-app theme engine (Discord/Vencord style): Default, Glass, Matrix (code rain), Sakura (blossoms
   + ASCII art), more later; built with 21st.dev components.
9. **Speed & polish** — code-split routes, virtualized message list, image lazy-loading, PWA service worker via Workbox.

## Needs the owner
- Upgrade Firebase project to **Blaze** (console → Usage and billing). Free 5 GB Storage still applies.
- GitHub repo → Settings → Pages → Source: **GitHub Actions** (only when merging v2).
- A free GIF API key (GIPHY or KLIPY) for phase 7.
