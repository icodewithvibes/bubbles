// Storage-free media: when Firebase Storage isn't set up (it needs the Blaze
// plan), files are split into <1 MB binary pieces stored as Firestore docs at
// chats/{chatId}/messages/{msgId}/chunks/{i}, and stitched back on view.
// The message itself only holds `url: "fschunks:<count>"`, so chat listeners
// (and the offline cache) never download the file unless someone opens it.
import { Bytes, collection, deleteDoc, doc, getDocs, orderBy, query, setDoc } from 'firebase/firestore'

import { get } from '@/store'
import { db } from './firebase'
import { useUploads } from './media'

/** Raw bytes per piece (Firestore docs cap at 1 MiB including field names). */
const PIECE = 900_000
export const CHUNK_PREFIX = 'fschunks:'
export const CHUNK_LIMITS = { image: 12 * 1024 * 1024, video: 25 * 1024 * 1024, audio: 12 * 1024 * 1024 }

export const isChunked = (url?: string) => !!url?.startsWith(CHUNK_PREFIX)
const chunksRef = (chatId: string, msgId: string) => collection(db, 'chats', chatId, 'messages', msgId, 'chunks')

export async function uploadChunked(chatId: string, msgId: string, blob: Blob, name: string, kind: 'image' | 'video' | 'audio') {
  // Binary pieces (not base64 text): 25% less to upload.
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const n = Math.ceil(bytes.length / PIECE)
  const uid = get().uid
  const setProgress = (p: number) =>
    useUploads.setState((s) => ({ uploads: [...s.uploads.filter((u) => u.id !== msgId), { id: msgId, name, kind, progress: p }] }))
  setProgress(0)
  try {
    // Several pieces in flight at once so the connection stays busy.
    let next = 0
    let done = 0
    const worker = async () => {
      while (next < n) {
        const i = next++
        const d = Bytes.fromUint8Array(bytes.subarray(i * PIECE, (i + 1) * PIECE))
        await setDoc(doc(chunksRef(chatId, msgId), String(i).padStart(4, '0')), { d, i, n, by: uid })
        setProgress(++done / n)
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, n) }, worker))
  } finally {
    useUploads.setState((s) => ({ uploads: s.uploads.filter((u) => u.id !== msgId) }))
  }
  return `${CHUNK_PREFIX}${n}`
}

function b64ToBytes(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Assembled files, kept for the session so scrolling back doesn't re-download.
const cache = new Map<string, Promise<string>>()

export function loadChunked(chatId: string, msgId: string, mime: string): Promise<string> {
  const key = `${chatId}/${msgId}`
  let p = cache.get(key)
  if (!p) {
    p = getDocs(query(chunksRef(chatId, msgId), orderBy('i'))).then((snap) => {
      // Pieces are Bytes now; files sent by the first version stored base64 text.
      const parts = snap.docs.map((d) => {
        const v = d.data().d as Bytes | string
        return typeof v === 'string' ? b64ToBytes(v) : v.toUint8Array()
      })
      return URL.createObjectURL(new Blob(parts as BlobPart[], { type: mime }))
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
