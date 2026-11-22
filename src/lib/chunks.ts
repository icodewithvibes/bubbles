// Storage-free media: when Firebase Storage isn't set up (it needs the Blaze
// plan), files are split into <1 MB base64 pieces stored as Firestore docs at
// chats/{chatId}/messages/{msgId}/chunks/{i}, and stitched back on view.
// The message itself only holds `url: "fschunks:<count>"`, so chat listeners
// (and the offline cache) never download the file unless someone opens it.
import { collection, deleteDoc, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore'

import { get } from '@/store'
import { db } from './firebase'
import { useUploads } from './media'

const PIECE = 700_000 // base64 chars per doc (Firestore docs cap at 1 MiB)
export const CHUNK_PREFIX = 'fschunks:'
export const CHUNK_LIMITS = { image: 12 * 1024 * 1024, video: 25 * 1024 * 1024, audio: 12 * 1024 * 1024 }

export const isChunked = (url?: string) => !!url?.startsWith(CHUNK_PREFIX)
const chunksRef = (chatId: string, msgId: string) => collection(db, 'chats', chatId, 'messages', msgId, 'chunks')

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function uploadChunked(chatId: string, msgId: string, blob: Blob, name: string, kind: 'image' | 'video' | 'audio') {
  const b64 = toBase64(await blob.arrayBuffer())
  const n = Math.ceil(b64.length / PIECE)
  const uid = get().uid
  const setProgress = (p: number) =>
    useUploads.setState((s) => ({ uploads: [...s.uploads.filter((u) => u.id !== msgId), { id: msgId, name, kind, progress: p }] }))
  setProgress(0)
  try {
    for (let i = 0; i < n; i++) {
      await setDoc(doc(chunksRef(chatId, msgId), String(i).padStart(4, '0')), { d: b64.slice(i * PIECE, (i + 1) * PIECE), i, n, by: uid })
      setProgress((i + 1) / n)
    }
  } finally {
    useUploads.setState((s) => ({ uploads: s.uploads.filter((u) => u.id !== msgId) }))
  }
  return `${CHUNK_PREFIX}${n}`
}

// Assembled files, kept for the session so scrolling back doesn't re-download.
const cache = new Map<string, Promise<string>>()

export function loadChunked(chatId: string, msgId: string, mime: string): Promise<string> {
  const key = `${chatId}/${msgId}`
  let p = cache.get(key)
  if (!p) {
    p = getDocs(query(chunksRef(chatId, msgId), orderBy('i'))).then((snap) => {
      const b64 = snap.docs.map((d) => d.data().d as string).join('')
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return URL.createObjectURL(new Blob([bytes], { type: mime }))
    })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

export async function deleteChunks(chatId: string, msgId: string) {
  const snap = await getDocs(chunksRef(chatId, msgId)).catch(() => null)
  await Promise.all(snap?.docs.map((d) => deleteDoc(d.ref).catch(() => {})) ?? [])
}
