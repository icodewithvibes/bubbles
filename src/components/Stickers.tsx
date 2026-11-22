// iMessage-style stickers: a preloaded meme library (Tenor stickers, curated in
// src/kit/stickers.json), Recents, and "My Stickers" made from your own photos.
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'

import LIBRARY from '@/kit/stickers.json'
import { finishSticker, removeBackground } from '@/lib/cutout'
import { db } from '@/lib/firebase'
import { closeModal, get, openModal, toast } from '@/store'
import { Ic, Modal, closePopover, openPopover } from './ui'

type Cat = { icon: string; name: string; stickers: string[] }
const CATS = LIBRARY as Cat[]
export const stickerUrl = (entry: string) => (entry.startsWith('data:') || entry.startsWith('http') ? entry : `https://media.tenor.com/${entry}.webp`)
const label = (entry: string) => (entry.includes('/') && !entry.startsWith('data:') ? entry.split('/')[1].replace(/-/g, ' ') : 'Sticker')

// ---------- Recents (per device) ----------
const RECENT_KEY = 'bubbles.recentStickers'
const recents = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function pushRecent(url: string) {
  if (url.startsWith('data:')) return // custom stickers live in My Stickers
  const next = [url, ...recents().filter((u) => u !== url)].slice(0, 24)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
}

// ---------- My Stickers (Firestore, private to you) ----------
interface MySticker {
  id: string
  url: string
}
const myRef = () => collection(db, 'users', get().uid!, 'stickers')

function useMyStickers() {
  const [items, setItems] = useState<MySticker[] | null>(null)
  useEffect(
    () =>
      onSnapshot(
        query(myRef(), orderBy('at', 'desc')),
        (snap) => setItems(snap.docs.map((d) => ({ id: d.id, url: d.data().url as string }))),
        () => setItems([]),
      ),
    [],
  )
  return items
}

// ============================================================================
// Picker
// ============================================================================
function StickerPicker({ onSend }: { onSend: (url: string) => void }) {
  const [tab, setTab] = useState<string>(() => (recents().length ? 'recent' : CATS[0].name))
  const [q, setQ] = useState('')
  const mine = useMyStickers()
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0
  }, [tab, q])

  const send = (url: string) => {
    pushRecent(url)
    closePopover()
    onSend(url)
  }

  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    if (!words.length) return null
    const seen = new Set<string>()
    const out: string[] = []
    for (const c of CATS)
      for (const s of c.stickers) {
        const tags = `${c.name} ${s.split('/')[1]}`.toLowerCase().split(/[^a-z0-9]+/)
        if (!seen.has(s) && words.every((w) => tags.some((t) => t.startsWith(w)))) {
          seen.add(s)
          out.push(s)
        }
      }
    return out
  }, [q])

  const Tile = ({ entry, onDelete }: { entry: string; onDelete?: () => void }) => (
    <div className="stk-tile">
      <button className="stk-btn" title={label(entry)} onClick={() => send(stickerUrl(entry))}>
        <img src={stickerUrl(entry)} alt={label(entry)} loading="lazy" draggable={false} />
      </button>
      {onDelete && (
        <button className="stk-del" title="Delete sticker" onClick={onDelete}>
          <Ic name="x" />
        </button>
      )}
    </div>
  )

  let grid: React.ReactNode
  if (hits) grid = hits.length ? hits.map((s) => <Tile key={s} entry={s} />) : <p className="stk-empty">No stickers match “{q}”.</p>
  else if (tab === 'recent') {
    const r = recents()
    grid = r.length ? r.map((s) => <Tile key={s} entry={s} />) : <p className="stk-empty">Stickers you send show up here.</p>
  } else if (tab === 'mine')
    grid = (
      <>
        <button
          className="stk-make"
          onClick={() => {
            closePopover()
            openMakeSticker(onSend)
          }}
        >
          <span>
            <Ic name="plus" />
          </span>
          Make a Sticker
        </button>
        {mine === null ? (
          <p className="stk-empty">Loading…</p>
        ) : (
          mine.map((s) => <Tile key={s.id} entry={s.url} onDelete={() => void deleteDoc(doc(myRef(), s.id))} />)
        )}
      </>
    )
  else grid = (CATS.find((c) => c.name === tab)?.stickers ?? []).map((s) => <Tile key={s} entry={s} />)

  const title = hits ? 'Search' : tab === 'recent' ? 'Recents' : tab === 'mine' ? 'My Stickers' : tab
  return (
    <>
      <div className="stk-head">
        <input className="stk-search" type="search" placeholder="Search stickers" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      <div className="stk-title">{title}</div>
      <div className="stk-body" ref={body}>
        <div className="stk-grid">{grid}</div>
      </div>
      <nav className="stk-tabs" aria-label="Sticker categories">
        <button className={tab === 'recent' && !hits ? 'on' : ''} title="Recents" onClick={() => (setQ(''), setTab('recent'))}>
          🕘
        </button>
        <button className={tab === 'mine' && !hits ? 'on' : ''} title="My Stickers" onClick={() => (setQ(''), setTab('mine'))}>
          ✂️
        </button>
        {CATS.map((c) => (
          <button key={c.name} className={tab === c.name && !hits ? 'on' : ''} title={c.name} onClick={() => (setQ(''), setTab(c.name))}>
            {c.icon}
          </button>
        ))}
      </nav>
    </>
  )
}

export function openStickerPicker(anchor: Element, onSend: (url: string) => void) {
  openPopover(<StickerPicker onSend={onSend} />, anchor, { place: 'top', cls: 'sticker-pop' })
}

// ============================================================================
// Make a Sticker (photo → cutout → die-cut outline)
// ============================================================================
function MakeSticker({ onSend }: { onSend: (url: string) => void }) {
  const [stage, setStage] = useState<'pick' | 'working' | 'done'>('pick')
  const [result, setResult] = useState<string | null>(null)
  const [outline, setOutline] = useState(true)
  const cutout = useRef<Blob | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const build = async (withOutline: boolean) => {
    if (!cutout.current) return
    setResult(await finishSticker(cutout.current, { outline: withOutline ? 8 : 0 }))
  }

  const pick = async (f: File) => {
    setStage('working')
    try {
      cutout.current = await removeBackground(f)
      await build(outline)
      setStage('done')
    } catch (e) {
      toast((e as Error).message || "Couldn't make that sticker", 'error')
      setStage('pick')
    }
  }

  const save = async (andSend: boolean) => {
    if (!result) return
    try {
      await addDoc(myRef(), { url: result, at: serverTimestamp() })
      closeModal()
      if (andSend) onSend(result)
      else toast('Saved to My Stickers')
    } catch {
      toast("Couldn't save that sticker", 'error')
    }
  }

  return (
    <Modal
      cls="make-sticker"
      title="Make a Sticker"
      foot={
        stage === 'done' ? (
          <>
            <button className="btn" onClick={() => setStage('pick')}>
              Try another
            </button>
            <button className="btn" onClick={() => void save(false)}>
              Save
            </button>
            <button className="btn btn-primary" onClick={() => void save(true)}>
              Save &amp; Send
            </button>
          </>
        ) : undefined
      }
    >
      <div className="mk-stage">
        {stage === 'pick' && (
          <button className="mk-pick" onClick={() => file.current?.click()}>
            <Ic name="image" />
            <b>Choose a photo</b>
            <small>Bubbles cuts out the person, pet or thing and turns it into a sticker.</small>
          </button>
        )}
        {stage === 'working' && (
          <div className="mk-working">
            <span className="mk-spinner" />
            <b>Cutting it out…</b>
            <small>The first one takes a little longer.</small>
          </div>
        )}
        {stage === 'done' && result && (
          <>
            <div className="mk-preview">
              <img src={result} alt="Your sticker" />
            </div>
            <label className="set-row toggle mk-outline">
              <span>White outline</span>
              <input
                type="checkbox"
                checked={outline}
                onChange={(e) => {
                  setOutline(e.target.checked)
                  void build(e.target.checked)
                }}
              />
              <i className="switch" />
            </label>
          </>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void pick(f)
        }}
      />
    </Modal>
  )
}

export const openMakeSticker = (onSend: (url: string) => void) => openModal(<MakeSticker onSend={onSend} />)
