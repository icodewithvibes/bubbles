// Find a message in this chat, or jump anywhere in its history.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { fmtClock } from '@/kit/util.js'
import { nameOf } from '@/lib/select'
import { cachedIndex, searchEntries, syncIndex, timeline, type Entry } from '@/lib/searchIndex'
import type { Chat } from '@/lib/types'
import { jumpTo, jumpToFirst } from '@/services/session'
import { set } from '@/store'
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
  const [q, setQ] = useState('')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [indexing, setIndexing] = useState<{ count: number; done: boolean }>({ count: 0, done: false })
  const [openMonth, setOpenMonth] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
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

  return (
    <aside className="details search-panel">
      <header className="det-head">
        <b>Search</b>
        <button className="icon-btn sm" onClick={close} aria-label="Close search">
          <Ic name="x" />
        </button>
      </header>
      <div className="sp-search">
        <span className="sp-search-ic">
          <Ic name="search" />
        </span>
        <input
          ref={input}
          type="search"
          placeholder="Search this conversation"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (q ? setQ('') : close())}
        />
      </div>
      <div className="sp-status">
        {!indexing.done ? (
          <>
            <span className="mk-spinner sp-spin" /> Getting messages ready to search… {indexing.count ? indexing.count.toLocaleString() : ''}
          </>
        ) : entries ? (
          `${entries.length.toLocaleString()} messages${first ? ` since ${fmtDay(first)}` : ''}`
        ) : null}
      </div>

      {results ? (
        <div className="sp-results">
          {results.length === 0 ? (
            <p className="sp-empty">{indexing.done ? `No messages with “${q.trim()}”.` : 'Still looking through older messages…'}</p>
          ) : (
            <>
              <div className="det-label">
                {results.length >= 200 ? '200+' : results.length} result{results.length === 1 ? '' : 's'}
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
      ) : (
        <div className="sp-results">
          <div className="det-label">Jump to</div>
          <div className="sp-quick">
            <button className="sp-chip primary" onClick={() => void jumpToFirst()}>
              ⏮ First messages
            </button>
            {quick.map((x) => (
              <button key={x.label} className="sp-chip" onClick={() => go(x.at)}>
                {x.label}
              </button>
            ))}
          </div>
          <label className="sp-date">
            <span>Go to a date</span>
            <input
              type="date"
              min={first ? new Date(first).toISOString().slice(0, 10) : undefined}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => {
                if (!e.target.value) return
                const [y, m, d] = e.target.value.split('-').map(Number)
                go(new Date(y, m - 1, d).getTime())
              }}
            />
          </label>

          {months.length > 0 && <div className="det-label">Timeline</div>}
          {months.map((m) => (
            <div key={m.key} className={`sp-month ${openMonth === m.key ? 'open' : ''}`}>
              <button className="sp-month-row" onClick={() => setOpenMonth(openMonth === m.key ? null : m.key)}>
                <span className="sp-chev">
                  <Ic name="chevron" />
                </span>
                <b>{m.label}</b>
                <small>{m.count.toLocaleString()}</small>
                <span className="sp-bar" style={{ width: `${Math.min(100, (m.count / Math.max(...months.map((x) => x.count))) * 100)}%` }} />
              </button>
              {openMonth === m.key && (
                <div className="sp-weeks">
                  <button className="sp-week" onClick={() => go(m.start)}>
                    <span>Start of {m.label.split(' ')[0]}</span>
                  </button>
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
        </div>
      )}
    </aside>
  )
}
