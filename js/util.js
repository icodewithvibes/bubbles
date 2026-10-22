export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Firestore Timestamp | Date | number → epoch ms
export function ms(t) {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (t.toMillis) return t.toMillis();
  if (t instanceof Date) return t.getTime();
  return 0;
}

export function hash(str) {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.codePointAt(0)) | 0;
  return Math.abs(h);
}

// ---------- avatars ----------
const GRADIENTS = [
  ['#ff8a8a', '#ff375f'], ['#ffb86b', '#ff7a00'], ['#ffd76b', '#f5a700'], ['#7be495', '#2fb35a'],
  ['#6be4e0', '#11a8b8'], ['#7ab8ff', '#2f6bff'], ['#a98bff', '#6c3cff'], ['#ff8bd8', '#d63aa8'],
  ['#a7b1bf', '#6b7686'],
];

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return s.toUpperCase();
}

export function avatar(user, size = 40, presence = null) {
  const name = user?.displayName || '?';
  const [a, b] = GRADIENTS[hash(user?.id || user?.uid || name) % GRADIENTS.length];
  const inner = user?.photoURL
    ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
    : `<span style="font-size:${Math.round(size * 0.4)}px">${esc(initials(name))}</span>`;
  const dot = presence ? `<i class="pres pres-${presence}" title="${PRESENCE_LABEL[presence]}"></i>` : '';
  return `<span class="avatar" style="--s:${size}px;--g1:${a};--g2:${b}">${inner}${dot}</span>`;
}

export const PRESENCE_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' };

// ---------- text formatting (Discord-flavoured markdown) ----------
const URL_RE = /\bhttps?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/g;

export function formatText(raw) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = esc(raw);
  s = s.replace(/```(?:[a-z0-9]+\n)?([\s\S]+?)```/gi, (_, code) => keep(`<pre><code>${code.replace(/^\n|\n$/g, '')}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  s = s.replace(URL_RE, (url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" data-act="spoiler">$1</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[i]);
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|‍|️|[\u{1F3FB}-\u{1F3FF}]|\s)+$/u;
export function isEmojiOnly(text) {
  const t = String(text || '').trim();
  if (!t || !EMOJI_ONLY.test(t)) return false;
  const count = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t.replace(/\s/g, ''))].length;
  return count <= 3;
}

// ---------- time ----------
const DAY = 86400000;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function fmtListTime(t) {
  if (!t) return '';
  const today = startOfDay(Date.now());
  if (t >= today) return fmtClock(t);
  if (t >= today - DAY) return 'Yesterday';
  if (t >= today - 6 * DAY) return new Date(t).toLocaleDateString([], { weekday: 'long' });
  return new Date(t).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// iMessage-style centered stamp: "Today 3:14 PM", "Monday 9:02 AM", "Sat, Oct 3 at 3:14 PM"
export function fmtStamp(t) {
  const today = startOfDay(Date.now());
  let day;
  if (t >= today) day = 'Today';
  else if (t >= today - DAY) day = 'Yesterday';
  else if (t >= today - 6 * DAY) day = new Date(t).toLocaleDateString([], { weekday: 'long' });
  else return `<b>${new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</b> at ${fmtClock(t)}`;
  return `<b>${day}</b> ${fmtClock(t)}`;
}

export function fmtAgo(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------- images ----------
// Re-encode to JPEG small enough to live inside a Firestore document (1 MiB limit).
export async function compressImage(file, maxDim = 1280, maxChars = 850_000) {
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image we can read.")); };
    im.src = url;
  });
  let scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  let q = 0.85;
  const canvas = document.createElement('canvas');
  for (let i = 0; i < 8; i++) {
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', q);
    if (data.length <= maxChars) return data;
    q -= 0.15;
    if (q < 0.5) { scale *= 0.7; q = 0.8; }
  }
  throw new Error('That image is too large to send.');
}

// ---------- icons (Lucide-style, stroke = currentColor) ----------
const svg = (p, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${p}</svg>`;
export const I = {
  compose: svg('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  settings: svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  bellOff: svg('<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 'stroke-width="2.6"'),
  reply: svg('<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
  smile: svg('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>'),
  pencil: svg('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>'),
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>', 'stroke-width="2.5"'),
  chevron: svg('<path d="m9 18 6-6-6-6"/>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>'),
  message: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  more: svg('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'),
  userPlus: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
  userMinus: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  down: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
};

// Each copy needs its own gradient id: a shared id breaks when the first copy is hidden.
let logoN = 0;
export const logo = () => {
  const id = `lg${++logoN}`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#0a64ff"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#${id})"/><path d="M32 14c-11.6 0-21 7.6-21 17 0 5.4 3.1 10.2 8 13.3-.4 2.6-1.7 5-3.6 6.9 4.1-.2 7.7-1.6 10.4-3.8 2 .4 4 .6 6.2.6 11.6 0 21-7.6 21-17S43.6 14 32 14z" fill="#fff"/></svg>`;
};
