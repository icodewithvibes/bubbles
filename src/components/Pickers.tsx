import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import { GIF_CATEGORIES } from '@/kit/gifs.js'
import { Ic, closePopover, openPopover } from './ui'

// emoji-picker-react is ~250 KB, so it loads the first time someone opens it.
const EmojiPicker = lazy(() => import('emoji-picker-react'))

const themeNow = () => {
  const t = document.documentElement.dataset.theme
  if (t === 'dark' || t === 'light') return t
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function openEmojiPicker(anchor: Element, onPick: (emoji: string) => void) {
  openPopover(
    <Suspense fallback={<div style={{ width: 340, height: 420, display: 'grid', placeItems: 'center' }}>Loading emoji…</div>}>
      <EmojiPicker
        onEmojiClick={(d) => onPick(d.emoji)}
        theme={themeNow() as never}
        lazyLoadEmojis
        previewConfig={{ showPreview: false }}
        width={340}
        height={420}
      />
    </Suspense>,
    anchor,
    { place: 'top', cls: 'emoji-pop' },
  )
}

// ---------- GIFs (built-in library from kit/gifs.js) ----------
type Cat = { icon: string; name: string; gifs: string[] }
const CATS = GIF_CATEGORIES as Cat[]
const gifUrl = (entry: string) => `https://media.tenor.com/${entry}.gif`

function searchGifs(q: string) {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (!words.length) return []
  const seen = new Set<string>()
  const hits: string[] = []
  for (const c of CATS) {
    for (const g of c.gifs) {
      const tags = `${c.name} ${g.split('/')[1]}`.toLowerCase().split(/[^a-z0-9]+/)
      if (seen.has(g) || !words.every((w) => tags.some((t) => t.startsWith(w)))) continue
      seen.add(g)
      hits.push(g)
    }
  }
  return hits
}

function GifPicker({ onSend }: { onSend: (url: string) => void }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Cat | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) search.current?.focus()
  }, [])
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0
  }, [q, cat])
  const tile = (entry: string) => (
    <button
      key={entry}
      className="gif-item"
      onClick={() => {
        closePopover()
        onSend(gifUrl(entry))
      }}
    >
      <img src={gifUrl(entry)} alt={entry.split('/')[1].replace(/-/g, ' ')} loading="lazy" />
    </button>
  )
  const hits = q.trim() ? searchGifs(q) : null
  return (
    <>
      <div className="gif-head">
        <input ref={search} type="search" className="gif-search" placeholder="Search GIFs" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="gif-body" ref={body}>
        {hits ? (
          hits.length ? (
            <div className="gif-grid">{hits.map(tile)}</div>
          ) : (
            <p className="gif-empty">No GIFs found. Try another word.</p>
          )
        ) : cat ? (
          <>
            <button className="gif-back" onClick={() => setCat(null)}>
              <Ic name="back" /> {cat.icon} {cat.name}
            </button>
            <div className="gif-grid">{cat.gifs.map(tile)}</div>
          </>
        ) : (
          <div className="gif-cats">
            {CATS.map((c) => (
              <button key={c.name} className="gif-cat" onClick={() => setCat(c)}>
                <img src={gifUrl(c.gifs[0])} alt="" loading="lazy" />
                <span>
                  {c.icon} {c.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

export function openGifPicker(anchor: Element, onSend: (url: string) => void) {
  openPopover(<GifPicker onSend={onSend} />, anchor, { place: 'top', cls: 'gif-pop' })
}
