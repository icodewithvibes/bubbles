import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'

import { CHUNK_LIMITS, isChunked, loadChunked, uploadChunked } from '@/lib/chunks'
import {
  LIMITS,
  NoStorageError,
  audioPeaks,
  blobToDataUrl,
  extFor,
  mb,
  prepareImage,
  probeImage,
  probeVideo,
  PENDING,
  FAILED,
  storageReady,
  uploadFile,
  useUploads,
} from '@/lib/media'
import type { Chat, Media, Message } from '@/lib/types'
import { transcribe, transcribeEnabled } from '@/lib/whisper'
import { newMessageId, postMessage, setMedia, setTranscript } from '@/services/session'
import { closeModal, get, openModal, set, toast } from '@/store'
import { openLightbox } from './Dialogs'
import { Ic } from './ui'

// ============================================================================
// Sending
// ============================================================================
/**
 * Upload a file for message `id`: Storage when it exists, Firestore pieces otherwise.
 * Returns the final url/path.
 */
async function uploadAny(c: Chat, id: string, blob: Blob, name: string, kind: Media['kind']) {
  const path = `chats/${c.id}/${id}/${kind}.${extFor(blob.type)}`
  try {
    return { url: await uploadFile(path, blob, id, name, kind), path }
  } catch (e) {
    if (!(e instanceof NoStorageError)) throw e
    // No Storage yet (needs Blaze): store the file in Firestore pieces instead.
    if (blob.size > CHUNK_LIMITS[kind])
      throw new Error(`Until Storage is turned on, ${kind === 'video' ? 'videos' : kind === 'audio' ? 'voice messages' : 'photos'} can be up to ${mb(CHUNK_LIMITS[kind])}.`)
    return { url: await uploadChunked(c.id, id, blob, name, kind), path: '' }
  }
}

/**
 * iMessage-style instant send: the message (with a sharp preview) is posted
 * right away so it shows up for everyone immediately, then the full file
 * uploads in the background and the message is updated to point at it.
 */
async function sendMediaNow(c: Chat, blob: Blob, name: string, base: Omit<Media, 'url' | 'path'>, extra: { text?: string; replyTo?: Message['replyTo'] | null } = {}) {
  const id = newMessageId(c.id)
  const pending: Media = { ...base, url: PENDING, path: '' }
  await postMessage(c, { id, text: extra.text ?? '', media: pending, replyTo: extra.replyTo ?? null })
  try {
    const { url, path } = await uploadAny(c, id, blob, name, base.kind)
    await setMedia(c.id, id, { ...pending, url, path })
  } catch (e) {
    await setMedia(c.id, id, { ...pending, url: FAILED }).catch(() => {})
    throw e
  }
  return id
}

async function sendOne(c: Chat, file: File, caption: string, replyTo: Message['replyTo'] | null) {
  const isVideo = file.type.startsWith('video/')
  const kind: Media['kind'] = isVideo ? 'video' : 'image'
  if (file.size > LIMITS[kind]) throw new Error(`That ${kind === 'video' ? 'video' : 'photo'} is over ${mb(LIMITS[kind])}.`)
  if (file.size > CHUNK_LIMITS[kind] && !(await storageReady()))
    throw new Error(`Until Storage is turned on, ${isVideo ? 'videos' : 'photos'} can be up to ${mb(CHUNK_LIMITS[kind])}.`)
  const blob = isVideo ? file : await prepareImage(file)
  const info = isVideo ? await probeVideo(blob) : await probeImage(blob)
  await sendMediaNow(c, blob, file.name, { kind, mime: blob.type, size: blob.size, ...info }, { text: caption, replyTo })
}

/** Send photos and videos (picked, pasted, dropped or from the camera). */
export async function sendFiles(c: Chat, files: File[], caption = '') {
  const replyTo = get().replyTo
  set({ replyTo: null })
  let ok = true
  for (const [i, f] of files.entries()) {
    try {
      await sendOne(c, f, i === files.length - 1 ? caption : '', i === 0 ? replyTo : null)
    } catch (e) {
      ok = false
      toast((e as Error).message || "Couldn't send that file", 'error')
    }
  }
  return ok
}

export function UploadBar() {
  const uploads = useUploads((s) => s.uploads)
  if (!uploads.length) return null
  return (
    <div className="upload-bar">
      {uploads.map((u) => (
        <div key={u.id} className="upload-row">
          <span>{u.kind === 'video' ? '🎬' : u.kind === 'audio' ? '🎤' : '📷'}</span>
          <span className="upload-name">Sending {u.name}</span>
          <span className="upload-track">
            <i style={{ width: `${Math.round(u.progress * 100)}%` }} />
          </span>
          <small>{Math.round(u.progress * 100)}%</small>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// Rendering media in a message
// ============================================================================
const fmtDur = (s = 0) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * The playable URL for a message's media. Storage/inline files are ready as-is;
 * Firestore-piece files are stitched on demand (`eager` loads them right away).
 */
function useMediaUrl(m: Message, eager: boolean) {
  const media = m.media!
  const pending = media.url === PENDING
  const failed = media.url === FAILED
  const chunked = isChunked(media.url)
  const ready = !pending && !failed && !chunked ? media.url : null
  const [stitched, setStitched] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const url = ready ?? stitched
  const load = async () => {
    if (url) return url
    if (!chunked) return null
    setLoading(true)
    try {
      const u = await loadChunked(get().msgChatId ?? '', m.id, media.mime)
      setStitched(u)
      return u
    } catch {
      toast("Couldn't load that file", 'error')
      return null
    } finally {
      setLoading(false)
    }
  }
  // Prefetch as soon as the upload finishes (media.url flips from "pending").
  useEffect(() => {
    if (eager && chunked && !stitched) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eager, chunked, media.url])
  return { url, load, loading, pending, failed }
}

function Sending() {
  return (
    <span className="media-sending" title="Sending…">
      <span className="mk-spinner" />
    </span>
  )
}

/** Calls onTick every animation frame while mounted (timeupdate only fires ~4×/s). */
function Ticker({ onTick }: { onTick: () => void }) {
  const cb = useRef(onTick)
  cb.current = onTick
  useEffect(() => {
    let raf = 0
    const loop = () => {
      cb.current()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return null
}

/** Resample to `n` bars, then soften with a neighbor blur so the shape reads like speech. */
function shapePeaks(src: number[], n: number) {
  const out = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * src.length
    const b = ((i + 1) / n) * src.length
    let m = 0
    for (let j = Math.floor(a); j < Math.max(Math.floor(a) + 1, Math.ceil(b)); j++) m = Math.max(m, src[Math.min(j, src.length - 1)] ?? 0)
    return m
  })
  return out.map((v, i) => {
    const l = out[i - 1] ?? v
    const r = out[i + 1] ?? v
    // sqrt lifts quiet syllables so the wave isn't mostly flat.
    return Math.max(0.08, Math.sqrt(v * 0.6 + l * 0.2 + r * 0.2))
  })
}

/**
 * Fine, mirrored waveform: thin rounded bars, a dim base layer and a bright
 * copy clipped to the play position, plus a glowing playhead. Drag or tap to seek.
 */
function Waveform({ peaks, progress, playing, onSeek }: { peaks: number[]; progress: number; playing: boolean; onSeek: (f: number) => void }) {
  const bars = shapePeaks(peaks, 54)
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
  }
  const row = (cls: string) => (
    <div className={cls} aria-hidden>
      {bars.map((p, i) => (
        <i key={i} style={{ height: `${p * 100}%`, animationDelay: `${(i % 9) * -0.11}s` }} />
      ))}
    </div>
  )
  return (
    <div
      className={`audio-wave ${playing ? 'playing' : ''}`}
      style={{ '--p': progress } as React.CSSProperties}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        seek(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && seek(e)}
    >
      {row('wave-base')}
      {row('wave-fill')}
      {progress > 0 && <span className="wave-head" />}
    </div>
  )
}

function AudioBubble({ m, fxClass }: { m: Message; fxClass: string }) {
  const media = m.media!
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [rate, setRate] = useState(1)
  const [localText, setLocalText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dur = media.dur ?? 0
  const peaks = media.peaks?.length ? media.peaks : Array.from({ length: 40 }, () => 0.3)
  const transcript = m.transcript ?? localText
  // Voice notes are small: fetch right away so play is instant.
  const src = useMediaUrl(m, true)
  return (
    <div className={`bubble audio-bubble ${fxClass}`}>
      <div className="audio-row">
        <button
          className="audio-play"
          aria-label={src.pending ? 'Sending' : playing ? 'Pause' : 'Play'}
          disabled={src.loading || src.pending || src.failed}
          onClick={async () => {
            const a = audio.current!
            if (!src.url) {
              const u = await src.load()
              if (!u) return
              a.src = u
            }
            if (a.paused) void a.play()
            else a.pause()
          }}
        >
          {src.failed ? '!' : src.pending || src.loading ? <span className="mk-spinner audio-spin" /> : playing ? '❚❚' : '▶'}
        </button>
        <Waveform
          peaks={peaks}
          progress={dur ? Math.min(1, t / dur) : 0}
          playing={playing}
          onSeek={(f) => {
            const a = audio.current
            if (!a || !dur) return
            a.currentTime = f * dur
            setT(f * dur)
          }}
        />
        <small className="audio-time">{fmtDur(playing || t ? t : dur)}</small>
        <button
          className="audio-rate"
          onClick={() => {
            const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1
            setRate(next)
            if (audio.current) audio.current.playbackRate = next
          }}
        >
          {rate}×
        </button>
      </div>
      <audio
        ref={audio}
        src={src.url ?? undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setT(0)
        }}
        onTimeUpdate={(e) => !playing && setT(e.currentTarget.currentTime)}
      />
      {playing && <Ticker onTick={() => audio.current && setT(audio.current.currentTime)} />}
      {transcript ? (
        <p className="audio-transcript">{transcript}</p>
      ) : (
        <button
          className="audio-transcribe"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const u = await src.load()
              if (!u) return
              const blob = await (await fetch(u)).blob()
              setLocalText((await transcribe(blob)) || '(no speech detected)')
            } catch {
              toast("Couldn't transcribe that one", 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Transcribing…' : 'Transcribe'}
        </button>
      )}
    </div>
  )
}

export function MediaContent({ m, fxClass }: { m: Message; fxClass: string }) {
  const media = m.media!
  const [loaded, setLoaded] = useState(false)
  // Photos and short videos prefetch the moment they're ready; long videos wait for a tap.
  const src = useMediaUrl(m, media.kind === 'image' || media.size < 8 * 1024 * 1024)
  const [autoPlay, setAutoPlay] = useState(false)
  const ratio = media.w && media.h ? `${media.w} / ${media.h}` : undefined
  if (media.kind === 'audio') return <AudioBubble m={m} fxClass={fxClass} />
  return (
    <>
      <div className={`media-frame ${fxClass}`} style={{ aspectRatio: ratio, backgroundImage: !loaded && media.thumb ? `url("${media.thumb}")` : undefined }}>
        {(src.pending || src.failed) && (
          <>
            {media.thumb && <img className="msg-img media-preview" src={media.thumb} alt={media.kind === 'image' ? 'Photo' : 'Video'} />}
            {src.failed ? <span className="media-failed">Couldn't send</span> : <Sending />}
          </>
        )}
        {src.pending || src.failed ? null : media.kind === 'image' ? (
          src.url && <img className="msg-img" src={src.url} alt="Photo" onLoad={() => setLoaded(true)} onClick={() => openLightbox(src.url!)} />
        ) : src.url ? (
          <video className="msg-video" src={src.url} poster={media.thumb} controls autoPlay={autoPlay} playsInline preload="metadata" onLoadedData={() => setLoaded(true)} />
        ) : (
          <button
            className="video-cover"
            onClick={() => {
              setAutoPlay(true)
              void src.load()
            }}
            aria-label="Play video"
          >
            <span className="video-play">{src.loading ? '…' : '▶'}</span>
            {media.dur ? <small>{fmtDur(media.dur)}</small> : null}
          </button>
        )}
      </div>
      {m.text && (
        <div className="bubble">
          <span>{m.text}</span>
        </div>
      )}
    </>
  )
}

// ============================================================================
// Voice messages
// ============================================================================
const pickAudioMime = () => ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''

async function sendVoice(c: Chat, blob: Blob) {
  const { peaks, dur } = await audioPeaks(blob)
  const mime = blob.type || 'audio/webm'
  const replyTo = get().replyTo
  set({ replyTo: null })
  const base = { kind: 'audio' as const, mime, size: blob.size, dur, peaks }
  let id: string
  // Fastest path: Opus voice is ~30 KB per 10 s, so most clips ride inside the
  // message itself — one write, and the other person can play it instantly.
  const inline = (await storageReady()) ? null : await blobToDataUrl(blob)
  if (inline && inline.length <= LIMITS.inline) {
    id = newMessageId(c.id)
    await postMessage(c, { id, media: { ...base, url: inline, path: '' }, replyTo })
  } else {
    id = await sendMediaNow(c, blob, 'voice message', base, { replyTo })
  }
  // Whisper runs in the background, then the transcript appears for everyone.
  if (transcribeEnabled()) {
    transcribe(blob)
      .then((text) => {
        if (text) void setTranscript(c.id, id, text)
      })
      .catch((err) => console.warn('transcribe', err))
  }
}

export function MicButton({ c }: { c: Chat }) {
  const [rec, setRec] = useState<{ start: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const canvas = useRef<HTMLCanvasElement>(null)
  const stopAll = useRef<() => void>(() => {})
  const keep = useRef(true)

  useEffect(() => () => stopAll.current(), [])

  const start = async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch {
      return toast('Allow microphone access to send voice messages', 'error')
    }
    const mime = pickAudioMime()
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined)
    chunks.current = []
    keep.current = true
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' })
      if (keep.current && blob.size > 1500) sendVoice(c, blob).catch((e) => toast((e as Error).message || "Couldn't send voice message", 'error'))
    }
    r.start(250)
    recorder.current = r

    // Live waveform: thin capsules that scroll smoothly left, fading out with
    // age, with a gradient in the theme accent and a glowing "live" tip.
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 1024
    an.smoothingTimeConstant = 0.6
    ctx.createMediaStreamSource(stream).connect(an)
    const data = new Float32Array(an.fftSize)
    const STEP = 4 // px per bar (CSS px): 2px capsule + 2px gap
    const EVERY = 55 // ms per new bar
    const levels: number[] = []
    let level = 0
    let lastPush = performance.now()
    let raf = 0
    let lastTick = 0
    const draw = (now: number) => {
      an.getFloatTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += v * v
      // RMS → perceptual curve; fast attack, slower release, like a VU meter.
      const target = Math.min(1, Math.pow(Math.sqrt(sum / data.length) * 4.2, 0.7))
      level += (target - level) * (target > level ? 0.55 : 0.18)
      while (now - lastPush >= EVERY) {
        levels.push(level)
        lastPush += EVERY
        if (levels.length > 400) levels.shift()
      }
      const cv = canvas.current
      if (cv) {
        const dpr = Math.min(devicePixelRatio || 1, 2)
        const cw = cv.clientWidth
        const ch = cv.clientHeight
        if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
          cv.width = Math.round(cw * dpr)
          cv.height = Math.round(ch * dpr)
        }
        const g = cv.getContext('2d')!
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
        g.clearRect(0, 0, cw, ch)
        const color = getComputedStyle(cv).color
        const grad = g.createLinearGradient(0, 0, cw, 0)
        grad.addColorStop(0, 'transparent')
        grad.addColorStop(0.35, color)
        grad.addColorStop(1, color)
        g.strokeStyle = grad
        g.lineCap = 'round'
        g.lineWidth = 2
        const mid = ch / 2
        const tipX = cw - 8
        // Sub-bar scroll offset so motion is continuous, not steppy.
        const shift = ((now - lastPush) / EVERY) * STEP
        g.beginPath()
        for (let i = levels.length - 1, k = 0; i >= 0; i--, k++) {
          const x = tipX - k * STEP - shift
          if (x < -2) break
          const amp = Math.max(1, levels[i] * (mid - 2))
          g.moveTo(x, mid - amp)
          g.lineTo(x, mid + amp)
        }
        g.stroke()
        // Live tip: a soft glowing dot that swells with your voice.
        const r = 2.5 + level * 3
        g.shadowColor = color
        g.shadowBlur = 8 + level * 10
        g.fillStyle = color
        g.beginPath()
        g.arc(tipX + 4, mid, r, 0, Math.PI * 2)
        g.fill()
        g.shadowBlur = 0
      }
      if (now - lastTick > 250) {
        lastTick = now
        setNow(Date.now())
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    stopAll.current = () => {
      cancelAnimationFrame(raf)
      void ctx.close()
      if (recorder.current?.state === 'recording') recorder.current.stop()
      recorder.current = null
      setRec(null)
    }
    setRec({ start: Date.now() })
  }

  const finish = (send: boolean) => {
    keep.current = send
    stopAll.current()
  }

  // Auto-stop at 5 minutes.
  useEffect(() => {
    if (rec && now - rec.start > 5 * 60e3) finish(true)
  })

  if (!rec)
    return (
      <button className="mic-btn" title="Record a voice message" onClick={() => void start()}>
        <Ic name="mic" />
      </button>
    )
  return (
    <div className="rec-bar">
      <button className="rec-cancel" title="Cancel" onClick={() => finish(false)}>
        <Ic name="trash" />
      </button>
      <span className="rec-dot" />
      <span className="rec-time">{fmtDur((now - rec.start) / 1000)}</span>
      <canvas ref={canvas} className="rec-wave" />
      <button className="send-btn rec-send" title="Send voice message" onClick={() => finish(true)}>
        <Ic name="up" />
      </button>
    </div>
  )
}

// ============================================================================
// Camera
// ============================================================================
const pickVideoMime = () =>
  ['video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''

/** Review a recorded clip with sound before sending: play/pause, scrub, mute, replay. */
function ClipPreview({ url, fallbackDur }: { url: string; fallbackDur: number }) {
  const v = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(fallbackDur)
  const [muted, setMuted] = useState(false)
  const [ended, setEnded] = useState(false)

  const play = () => {
    const el = v.current
    if (!el) return
    if (ended || el.currentTime >= (dur || el.duration) - 0.05) el.currentTime = 0
    setEnded(false)
    el.play().catch(() => {
      // Autoplay with sound refused: start muted and let them unmute.
      el.muted = true
      setMuted(true)
      void el.play().catch(() => {})
    })
  }

  return (
    <div className="clip-preview">
      <video
        ref={v}
        src={url}
        playsInline
        preload="auto"
        className="cam-view fit"
        onClick={() => (playing ? v.current?.pause() : play())}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget
          // MediaRecorder webm reports duration = Infinity until it has been
          // seeked to the end once; seek far, read the real length, rewind.
          if (Number.isFinite(el.duration) && el.duration > 0) {
            setDur(el.duration)
            play()
          } else {
            const fix = () => {
              el.removeEventListener('durationchange', fix)
              if (Number.isFinite(el.duration) && el.duration > 0) setDur(el.duration)
              el.currentTime = 0
              play()
            }
            el.addEventListener('durationchange', fix)
            el.currentTime = 1e9
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setEnded(true)
        }}
        onTimeUpdate={(e) => !playing && setT(e.currentTarget.currentTime)}
      />
      {playing && <Ticker onTick={() => v.current && setT(v.current.currentTime)} />}
      {!playing && (
        <button className="clip-big-play" onClick={play} aria-label={ended ? 'Replay' : 'Play'}>
          {ended ? '↻' : '▶'}
        </button>
      )}
      <div className="clip-bar">
        <button className="clip-btn" onClick={() => (playing ? v.current?.pause() : play())} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="clip-time">{fmtDur(Math.min(t, dur || t))}</span>
        <input
          className="clip-scrub"
          type="range"
          min={0}
          max={dur || 1}
          step={0.01}
          value={Math.min(t, dur || 1)}
          style={{ '--p': dur ? Math.min(1, t / dur) : 0 } as React.CSSProperties}
          onChange={(e) => {
            const nt = Number(e.target.value)
            if (v.current) v.current.currentTime = nt
            setT(nt)
            setEnded(false)
          }}
          aria-label="Seek"
        />
        <span className="clip-time">{fmtDur(dur)}</span>
        <button
          className="clip-btn"
          onClick={() => {
            if (!v.current) return
            v.current.muted = !muted
            setMuted(!muted)
          }}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  )
}

function CameraModal({ c }: { c: Chat }) {
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [cams, setCams] = useState(0)
  const [mode, setMode] = useState<'photo' | 'video'>('photo')
  const [shot, setShot] = useState<{ file: File; url: string; dur?: number } | null>(null)
  const [recStart, setRecStart] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [err, setErr] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    let s: MediaStream | null = null
    let alive = true
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } }, audio: true })
      .then(async (st) => {
        if (!alive) return st.getTracks().forEach((t) => t.stop())
        s = st
        setStream(st)
        setCams((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length)
      })
      .catch(() => setErr('Allow camera access to take photos and videos.'))
    return () => {
      alive = false
      s?.getTracks().forEach((t) => t.stop())
    }
  }, [facing])

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream
  }, [stream, shot])

  useEffect(() => {
    if (!recStart) return
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.now() - recStart > 120e3) recorder.current?.stop()
    }, 200)
    return () => clearInterval(id)
  }, [recStart])

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url)
    },
    [shot],
  )

  const mirrored = facing === 'user'

  const takePhoto = () => {
    const v = video.current
    if (!v) return
    const cv = document.createElement('canvas')
    cv.width = v.videoWidth
    cv.height = v.videoHeight
    const g = cv.getContext('2d')!
    if (mirrored) {
      g.translate(cv.width, 0)
      g.scale(-1, 1)
    }
    g.drawImage(v, 0, 0)
    cv.toBlob(
      (b) => {
        if (!b) return
        const file = new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        setShot({ file, url: URL.createObjectURL(b) })
      },
      'image/jpeg',
      0.92,
    )
  }

  const toggleRecord = () => {
    if (recorder.current) return recorder.current.stop()
    if (!stream) return
    const mime = pickVideoMime()
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined)
    const parts: Blob[] = []
    r.ondataavailable = (e) => e.data.size && parts.push(e.data)
    const began = Date.now()
    r.onstop = () => {
      recorder.current = null
      setRecStart(null)
      const type = (r.mimeType || 'video/webm').split(';')[0]
      const blob = new Blob(parts, { type })
      const file = new File([blob], `video-${Date.now()}.${extFor(type)}`, { type })
      setShot({ file, url: URL.createObjectURL(blob), dur: (Date.now() - began) / 1000 })
    }
    r.start(500)
    recorder.current = r
    setRecStart(began)
  }

  return (
    <div className="modal camera-modal" role="dialog" aria-modal="true">
      <div className="cam-stage">
        {err ? (
          <p className="cam-err">{err}</p>
        ) : shot ? (
          shot.file.type.startsWith('video/') ? (
            <ClipPreview key={shot.url} url={shot.url} fallbackDur={shot.dur ?? 0} />
          ) : (
            <img key={shot.url} src={shot.url} alt="Your photo" className="cam-view fit" />
          )
        ) : (
          // Keyed so React never reuses this element for the preview: a leftover
          // srcObject (the live camera) would override the recording's src.
          <video key="live" ref={video} autoPlay playsInline muted className={`cam-view ${mirrored ? 'mirror' : ''}`} />
        )}
        <button className="icon-btn cam-close" onClick={closeModal} aria-label="Close camera">
          <Ic name="x" />
        </button>
        {recStart && <span className="cam-rec">● {fmtDur((now - recStart) / 1000)}</span>}
      </div>
      <div className="cam-controls">
        {shot ? (
          <>
            <button className="btn" onClick={() => setShot(null)}>
              Retake
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const f = shot.file
                closeModal()
                void sendFiles(c, [f])
              }}
            >
              Send {shot.file.type.startsWith('video/') ? 'video' : 'photo'}
            </button>
          </>
        ) : (
          <>
            <div className="seg cam-mode">
              <button className={mode === 'photo' ? 'on' : ''} disabled={!!recStart} onClick={() => setMode('photo')}>
                Photo
              </button>
              <button className={mode === 'video' ? 'on' : ''} disabled={!!recStart} onClick={() => setMode('video')}>
                Video
              </button>
            </div>
            <button
              className={`cam-shutter ${mode} ${recStart ? 'recording' : ''}`}
              aria-label={mode === 'photo' ? 'Take photo' : recStart ? 'Stop recording' : 'Start recording'}
              disabled={!stream}
              onClick={mode === 'photo' ? takePhoto : toggleRecord}
            />
            <button className="icon-btn cam-flip" title="Switch camera" disabled={cams < 2 || !!recStart} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}>
              ⟲
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function CameraButton({ c }: { c: Chat }) {
  return (
    <button className="comp-plus comp-camera" title="Camera" onClick={() => openModal(<CameraModal c={c} />)}>
      <Ic name="camera" />
    </button>
  )
}
