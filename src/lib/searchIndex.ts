// Per-chat search index, stored on this device (IndexedDB). Firestore can't
// search text, so the first search in a chat pages through its history once
// and keeps only {id, time, sender, text}; afterwards only newer messages are
// fetched. Powers both message search and the week-by-week timeline.
import { collection, getDocs, limit, orderBy, query, startAfter, where, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore'

import { ms } from '@/kit/util.js'
import { db } from './firebase'

export interface Entry {
  id: string
  t: number
  s: string
  x: string
}
interface IndexDoc {
  chatId: string
  entries: Entry[]
  /** createdAt (ms) of the newest indexed message */
  newest: number
  /** paging cursor (ms) while the backfill is unfinished; null when complete */
  backfillBefore: number | null
}

// ---------- tiny IndexedDB wrapper ----------
let dbp: Promise<IDBDatabase> | null = null
function idb() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('bubbles-search', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('chats', { keyPath: 'chatId' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  return dbp
}
async function load(chatId: string): Promise<IndexDoc | null> {
  const d = await idb()
  return new Promise((resolve) => {
    const r = d.transaction('chats').objectStore('chats').get(chatId)
    r.onsuccess = () => resolve((r.result as IndexDoc) ?? null)
    r.onerror = () => resolve(null)
  })
}
async function save(doc: IndexDoc) {
  const d = await idb()
  await new Promise<void>((resolve) => {
    const tx = d.transaction('chats', 'readwrite')
    tx.objectStore('chats').put(doc)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

const LABELS: Record<string, string> = { image: '📷 Photo', video: '🎬 Video', audio: '🎤 Voice message' }
function toEntry(d: QueryDocumentSnapshot): Entry | null {
  const m = d.data()
  if (m.deleted) return null
  const media = m.media as { kind?: string } | undefined
  let x = String(m.text ?? '')
  if (m.transcript) x = `${x} ${m.transcript}`.trim()
  if (!x) x = m.sticker ? '🩷 Sticker' : media?.kind ? LABELS[media.kind] : m.image ? '📷 Photo' : ''
  return { id: d.id, t: ms(m.createdAt), s: String(m.senderId ?? ''), x: m.system ? `· ${x}` : x }
}

// ---------- building ----------
const building = new Map<string, Promise<IndexDoc>>()

/**
 * Brings the index up to date: new messages first (fast), then continues the
 * one-time backfill of older history. `onProgress` reports entries so far.
 */
export function syncIndex(chatId: string, onProgress?: (count: number, done: boolean) => void): Promise<IndexDoc> {
  let p = building.get(chatId)
  if (p) return p
  p = (async () => {
    const col = collection(db, 'chats', chatId, 'messages')
    const doc: IndexDoc = (await load(chatId)) ?? { chatId, entries: [], newest: 0, backfillBefore: Date.now() + 60_000 }
    const byId = new Map(doc.entries.map((e) => [e.id, e]))

    // 1) Newer than what we have.
    if (doc.newest) {
      let cursor: QueryDocumentSnapshot | null = null
      for (;;) {
        const base = query(col, where('createdAt', '>', new Date(doc.newest)), orderBy('createdAt', 'asc'), limit(300))
        const snap: QuerySnapshot = await getDocs(cursor ? query(base, startAfter(cursor)) : base)
        snap.docs.forEach((d: QueryDocumentSnapshot) => {
          const e = toEntry(d)
          if (e) byId.set(e.id, e)
        })
        if (snap.size < 300) break
        cursor = snap.docs[snap.docs.length - 1]
      }
    }

    // 2) Backfill older history, saving as we go so progress survives a reload.
    while (doc.backfillBefore !== null) {
      const snap = await getDocs(query(col, where('createdAt', '<', new Date(doc.backfillBefore)), orderBy('createdAt', 'desc'), limit(300)))
      snap.docs.forEach((d) => {
        const e = toEntry(d)
        if (e) byId.set(e.id, e)
      })
      doc.backfillBefore = snap.size < 300 ? null : ms(snap.docs[snap.docs.length - 1].data().createdAt)
      doc.entries = [...byId.values()].sort((a, b) => a.t - b.t)
      doc.newest = doc.entries.at(-1)?.t ?? 0
      await save(doc)
      onProgress?.(doc.entries.length, doc.backfillBefore === null)
    }

    doc.entries = [...byId.values()].sort((a, b) => a.t - b.t)
    doc.newest = doc.entries.at(-1)?.t ?? doc.newest
    await save(doc)
    onProgress?.(doc.entries.length, true)
    return doc
  })().finally(() => building.delete(chatId))
  building.set(chatId, p)
  return p
}

export async function cachedIndex(chatId: string) {
  return load(chatId)
}

// ---------- querying ----------
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Newest-first matches; every word must appear. */
export function searchEntries(entries: Entry[], q: string, max = 200): Entry[] {
  const words = norm(q).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out: Entry[] = []
  for (let i = entries.length - 1; i >= 0 && out.length < max; i--) {
    const x = norm(entries[i].x)
    if (words.every((w) => x.includes(w))) out.push(entries[i])
  }
  return out
}

export interface WeekBucket {
  start: number
  count: number
}
export interface MonthBucket {
  key: string
  label: string
  start: number
  count: number
  weeks: WeekBucket[]
}

/** Month → week buckets with message counts, newest month first. */
export function timeline(entries: Entry[]): MonthBucket[] {
  const months = new Map<string, MonthBucket>()
  for (const e of entries) {
    const d = new Date(e.t)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    let m = months.get(key)
    if (!m) {
      const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
      m = { key, start, count: 0, weeks: [], label: d.toLocaleDateString([], { month: 'long', year: 'numeric' }) }
      months.set(key, m)
    }
    m.count++
    const wk = new Date(d)
    wk.setHours(0, 0, 0, 0)
    wk.setDate(wk.getDate() - wk.getDay()) // week starts Sunday
    const ws = Math.max(wk.getTime(), m.start)
    const last = m.weeks.at(-1)
    if (last && last.start === ws) last.count++
    else m.weeks.push({ start: ws, count: 1 })
  }
  return [...months.values()].sort((a, b) => b.start - a.start)
}
