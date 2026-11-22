// Find a message in this chat, or jump anywhere in its history.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { fmtClock } from '@/kit/util.js'
import { nameOf } from '@/lib/select'
import { cachedIndex, searchEntries, syncIndex, timeline, type Entry } from '@/lib/searchIndex'
import type { Chat } from '@/lib/types'
import { jumpTo, jumpToFirst } from '@/services/session'
import { set, useStore } from '@/store'
import { Ic, UserAvatar } from './ui'

const DAY = 86_400_000
const fmtDay = (t: number) =>
  new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })

function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return <>{text}</>
  // Center the snippet on the first match so long messages still show why they matched.
  const lower = text.toLowerCase()
  const at = Math.max(0, lower.indexOf(words[0]))
  const start = Math.max(0, at - 40)
  const snippet = (start ? '…' : '') + text.slice(start, start + 160) + (text.length > start + 160 ? '…' : '')
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts: ReactNode[] = snippet.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))
  return <>{parts}</>
}

export function SearchPanel({ c }: { c: Chat }) {
  const mode = useStore((s) => s.searchMode)
  const [q, setQ] = useState('')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [indexing, setIndexing] = useState<{ count: number; done: boolean }>({ count: 0, done: false })
  const [openMonth, setOpenMonth] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (useStore.getState().searchMode === 'search') input.current?.focus()
    let alive = true
    // Show whatever is already indexed instantly, then bring it up to date.
    void cachedIndex(c.id).then((d) => alive && d && setEntries(d.entries))
    void syncIndex(c.id, (count, done) => {
      if (!alive) return
      setIndexing({ count, done })
      void cachedIndex(c.id).then((d) => alive && d && setEntries(d.entries))
    })
      .then((d) => {
        if (!alive) return
        setEntries(d.entries)
        setIndexing({ count: d.entries.length, done: true })
      })
      .catch(() => alive && setIndexing((s) => ({ ...s, done: true })))
    return () => {
      alive = false
    }
  }, [c.id])

  const results = useMemo(() => (entries && q.trim() ? searchEntries(entries, q) : null), [entries, q])
  const months = useMemo(() => (entries ? timeline(entries) : []), [entries])
  const first = entries?.[0]?.t
  const close = () => set({ searchOpen: false })
  const go = (t: number, id?: string) => void jumpTo(t, id)

  const quick = [
    { label: '1 week ago', at: Date.now() - 7 * DAY },
    { label: '1 month ago', at: Date.now() - 30 * DAY },
    { label: '3 months ago', at: Date.now() - 91 * DAY },
    { label: '6 months ago', at: Date.now() - 182 * DAY },
    { label: '1 year ago', at: Date.now() - 365 * DAY },
  ].filter((x) => !first || x.at > first)

  const busiest = Math.max(1, ...months.map((x) => x.count))
  const status = !indexing.done ? (
    <>
      <span className="mk-spinner sp-spin" /> Getting your messages ready… {indexing.count ? indexing.count.toLocaleString() : ''}
    </>
  ) : entries ? (
    `${entries.length.toLocaleString()} messages${first ? ` since ${fmtDay(first)}` : ''}`
  ) : null

  return (
    <aside className="details search-panel">
      <header className="det-head">
        <b>{mode === 'time' ? 'Go back in time' : 'Search messages'}</b>
        <button className="icon-btn sm" onClick={close} aria-label="Close">
          <Ic name="x" />
        </button>
      </header>

      {mode === 'search' ? (
        <>
          <div className="sp-search">
            <span className="sp-search-ic">
              <Ic name="search" />
            </span>
            <input
              ref={input}
              type="search"
              autoFocus
              placeholder="Type a word to find…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (q ? setQ('') : close())}
            />
          </div>
          <div className="sp-status">{status}</div>
          <div className="sp-results">
            {!results ? (
              <div className="sp-hint">
                <p>Find any message, photo caption or voice message by what was said. Tap a result to jump right to it.</p>
                <button className="sp-switch" onClick={() => set({ searchMode: 'time' })}>
                  <Ic name="history" />
                  <span>
                    <b>Looking for old messages?</b>
                    <small>Go back to the first messages, a date, or a week</small>
                  </span>
                  <Ic name="chevron" />
                </button>
              </div>
            ) : results.length === 0 ? (
              <p className="sp-empty">{indexing.done ? `No messages with “${q.trim()}”.` : 'Still looking through older messages…'}</p>
            ) : (
              <>
                <div className="det-label">
                  {results.length >= 200 ? '200+' : results.length} result{results.length === 1 ? '' : 's'} · tap to jump there
                </div>
                {results.map((e) => (
                  <button key={e.id} className="sp-hit" onClick={() => go(e.t, e.id)}>
                    <UserAvatar uid={e.s} size={30} />
                    <span className="sp-hit-body">
                      <span className="sp-hit-top">
                        <b>{nameOf(e.s)}</b>
                        <small>
                          {fmtDay(e.t)} · {fmtClock(e.t)}
                        </small>
                      </span>
                      <span className="sp-hit-text">
                        <Highlight text={e.x} q={q} />
                      </span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="sp-results">
          <div className="sp-status">{status}</div>
          <button className="sp-big" onClick={() => void jumpToFirst()}>
            <span className="sp-big-ic">⏮</span>
            <span>
              <b>Start of the conversation</b>
              <small>{first ? `The very first messages · ${fmtDay(first)}` : 'The very first messages'}</small>
            </span>
          </button>

          {quick.length > 0 && (
            <>
              <div className="det-label">Jump back</div>
              <div className="sp-quick">
                {quick.map((x) => (
                  <button key={x.label} className="sp-chip" onClick={() => go(x.at)}>
                    {x.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="det-label">Pick a day</div>
          <label className="sp-date">
            <Ic name="clock" />
            <input
              type="date"
              aria-label="Pick a day to jump to"
              min={first ? new Date(first).toISOString().slice(0, 10) : undefined}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => {
                if (!e.target.value) return
                const [y, m, d] = e.target.value.split('-').map(Number)
                go(new Date(y, m - 1, d).getTime())
              }}
            />
          </label>

          {months.length > 0 && <div className="det-label">Browse by week · tap a month</div>}
          {months.map((m) => (
            <div key={m.key} className={`sp-month ${openMonth === m.key ? 'open' : ''}`}>
              <button className="sp-month-row" onClick={() => setOpenMonth(openMonth === m.key ? null : m.key)}>
                <span className="sp-chev">
                  <Ic name="chevron" />
                </span>
                <b>{m.label}</b>
                <small>{m.count.toLocaleString()} messages</small>
                <span className="sp-bar" style={{ width: `${(m.count / busiest) * 100}%` }} />
              </button>
              {openMonth === m.key && (
                <div className="sp-weeks">
                  {m.weeks.map((w) => (
                    <button key={w.start} className="sp-week" onClick={() => go(w.start)}>
                      <span>Week of {new Date(w.start).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      <small>{w.count.toLocaleString()} messages</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          <button className="sp-switch sp-switch-bottom" onClick={() => set({ searchMode: 'search' })}>
            <Ic name="search" />
            <span>
              <b>Looking for something specific?</b>
              <small>Search by a word instead</small>
            </span>
            <Ic name="chevron" />
          </button>
        </div>
      )}
    </aside>
  )
}

// ============================================================================
// In-chat shortcuts: a "Go back in time" pill when you scroll up, and a month
// scrubber on the right edge (like scrolling dates in Photos).
// ============================================================================
export function TimeTravelOverlay({ c, show }: { c: Chat; show: boolean }) {
  const [months, setMonths] = useState<{ key: string; label: string; start: number }[]>([])
  const open = useStore((s) => s.searchOpen)
  useEffect(() => {
    if (!show) return
    let alive = true
    const apply = (entries: Entry[]) => {
      if (!alive) return
      const now = new Date()
      setMonths(
        timeline(entries)
          .reverse()
          .map((m) => {
            const d = new Date(m.start)
            const sameYear = d.getFullYear() === now.getFullYear()
            return { key: m.key, start: m.start, label: d.toLocaleDateString([], { month: 'short', year: sameYear ? undefined : '2-digit' }) }
          }),
      )
    }
    void cachedIndex(c.id).then((d) => d && apply(d.entries))
    void syncIndex(c.id).then((d) => apply(d.entries)).catch(() => {})
    return () => {
      alive = false
    }
  }, [c.id, show])

  if (!show || open) return null
  return (
    <>
      <button className="tt-pill" onClick={() => set({ searchOpen: true, searchMode: 'time', detailsOpen: false })}>
        <Ic name="history" />
        Go back in time
      </button>
      {months.length > 0 && (
        <nav className="tt-scrubber" aria-label="Jump to a month">
          <button className="tt-mark tt-start" onClick={() => void jumpToFirst()} title="Start of the conversation">
            Start
          </button>
          {months.map((m) => (
            <button key={m.key} className="tt-mark" onClick={() => void jumpTo(m.start)} title={`Jump to ${m.label}`}>
              {m.label}
            </button>
          ))}
        </nav>
      )}
    </>
  )
}
