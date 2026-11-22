import { useEffect, useRef, useState } from 'react'

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
  uploadFile,
  useUploads,
} from '@/lib/media'
import type { Chat, Media, Message } from '@/lib/types'
import { transcribe, transcribeEnabled } from '@/lib/whisper'
import { newMessageId, postMessage, setTranscript } from '@/services/session'
import { closeModal, get, openModal, set, toast } from '@/store'
import { openLightbox } from './Dialogs'
import { Ic } from './ui'

// ============================================================================
// Sending
// ============================================================================
async function sendOne(c: Chat, file: File, caption: string, replyTo: Message['replyTo'] | null) {
  const isVideo = file.type.startsWith('video/')
  const kind: Media['kind'] = isVideo ? 'video' : 'image'
  if (file.size > LIMITS[kind]) throw new Error(`That ${kind === 'video' ? 'video' : 'photo'} is over ${mb(LIMITS[kind])}.`)
  const id = newMessageId(c.id)
  const blob = isVideo ? file : await prepareImage(file)
  const info = isVideo ? await probeVideo(blob) : await probeImage(blob)
  const path = `chats/${c.id}/${id}/${kind}.${extFor(blob.type)}`
  let media: Media
  try {
    const url = await uploadFile(path, blob, id, file.name, kind)
    media = { kind, url, path, mime: blob.type, size: blob.size, ...info }
  } catch (e) {
    if (!(e instanceof NoStorageError)) throw e
    // No Storage yet (needs Blaze): store the file in Firestore pieces instead.
    if (blob.size > CHUNK_LIMITS[kind])
      throw new Error(`Until Storage is turned on, ${kind === 'video' ? 'videos' : 'photos'} can be up to ${mb(CHUNK_LIMITS[kind])}.`)
    const url = await uploadChunked(c.id, id, blob, file.name, kind)
    media = { kind, url, path: '', mime: blob.type, size: blob.size, ...info }
  }
  await postMessage(c, { id, text: caption, media, replyTo })
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
  const chunked = isChunked(media.url)
  const [url, setUrl] = useState<string | null>(chunked ? null : media.url)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    if (url) return url
    setLoading(true)
    try {
      const u = await loadChunked(get().msgChatId ?? '', m.id, media.mime)
      setUrl(u)
      return u
    } catch {
      toast("Couldn't load that file", 'error')
      return null
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (eager && chunked && !url) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eager, chunked])
  return { url, load, loading }
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
  const src = useMediaUrl(m, false)
  return (
    <div className={`bubble audio-bubble ${fxClass}`}>
      <div className="audio-row">
        <button
          className="audio-play"
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={src.loading}
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
          {src.loading ? '…' : playing ? '❚❚' : '▶'}
        </button>
        <div
          className="audio-wave"
          onClick={(e) => {
            const a = audio.current
            if (!a || !dur) return
            const r = e.currentTarget.getBoundingClientRect()
            a.currentTime = ((e.clientX - r.left) / r.width) * dur
          }}
        >
          {peaks.map((p, i) => (
            <i key={i} className={dur && i / peaks.length < t / dur ? 'on' : ''} style={{ height: `${Math.max(12, p * 100)}%` }} />
          ))}
        </div>
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
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
      />
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
  // Photos load right away; videos only when someone taps play (they're big).
  const src = useMediaUrl(m, media.kind === 'image')
  const [autoPlay, setAutoPlay] = useState(false)
  const ratio = media.w && media.h ? `${media.w} / ${media.h}` : undefined
  if (media.kind === 'audio') return <AudioBubble m={m} fxClass={fxClass} />
  return (
    <>
      <div className={`media-frame ${fxClass}`} style={{ aspectRatio: ratio, backgroundImage: !loaded && media.thumb ? `url("${media.thumb}")` : undefined }}>
        {media.kind === 'image' ? (
          src.url && <img className="msg-img" src={src.url} alt="Photo" loading="lazy" onLoad={() => setLoaded(true)} onClick={() => openLightbox(src.url!)} />
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
  const id = newMessageId(c.id)
  const { peaks, dur } = await audioPeaks(blob)
  const mime = blob.type || 'audio/webm'
  const path = `chats/${c.id}/${id}/voice.${extFor(mime)}`
  let media: Media
  try {
    const url = await uploadFile(path, blob, id, 'voice message', 'audio')
    media = { kind: 'audio', url, path, mime, size: blob.size, dur, peaks }
  } catch (e) {
    if (!(e instanceof NoStorageError)) throw e
    // Opus voice is tiny (~30 KB per 10 s), so it fits inline until Storage is on.
    // Short clips (~30 KB per 10 s) fit inline; longer ones go into Firestore pieces.
    let url = await blobToDataUrl(blob)
    if (url.length > LIMITS.inline) url = await uploadChunked(c.id, id, blob, 'voice message', 'audio')
    media = { kind: 'audio', url, path: '', mime, size: blob.size, dur, peaks }
  }
  await postMessage(c, { id, media, replyTo: get().replyTo })
  set({ replyTo: null })
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

    // Live waveform
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 256
    ctx.createMediaStreamSource(stream).connect(an)
    const data = new Uint8Array(an.frequencyBinCount)
    const history: number[] = []
    let raf = 0
    const draw = () => {
      an.getByteTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128)
      history.push(peak)
      if (history.length > 60) history.shift()
      const cv = canvas.current
      if (cv) {
        const g = cv.getContext('2d')!
        const w = (cv.width = cv.clientWidth * 2)
        const h = (cv.height = cv.clientHeight * 2)
        g.clearRect(0, 0, w, h)
        g.fillStyle = getComputedStyle(cv).color
        const bw = w / 60
        history.forEach((p, i) => {
          const bh = Math.max(4, Math.min(1, p * 2.2) * h)
          g.fillRect(i * bw + bw * 0.2, (h - bh) / 2, bw * 0.6, bh)
        })
      }
      setNow(Date.now())
      raf = requestAnimationFrame(draw)
    }
    draw()
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

function CameraModal({ c }: { c: Chat }) {
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [cams, setCams] = useState(0)
  const [mode, setMode] = useState<'photo' | 'video'>('photo')
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null)
  const [recStart, setRecStart] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [err, setErr] = useState('')
  const recorder = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    let s: MediaStream | null = null
    let alive = true
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true })
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
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 3_500_000 } : undefined)
    const parts: Blob[] = []
    r.ondataavailable = (e) => e.data.size && parts.push(e.data)
    r.onstop = () => {
      recorder.current = null
      setRecStart(null)
      const type = (r.mimeType || 'video/webm').split(';')[0]
      const blob = new Blob(parts, { type })
      const file = new File([blob], `video-${Date.now()}.${extFor(type)}`, { type })
      setShot({ file, url: URL.createObjectURL(blob) })
    }
    r.start(500)
    recorder.current = r
    setRecStart(Date.now())
  }

  return (
    <div className="modal camera-modal" role="dialog" aria-modal="true">
      <div className="cam-stage">
        {err ? (
          <p className="cam-err">{err}</p>
        ) : shot ? (
          shot.file.type.startsWith('video/') ? (
            <video src={shot.url} controls autoPlay playsInline className="cam-view" />
          ) : (
            <img src={shot.url} alt="Your photo" className="cam-view" />
          )
        ) : (
          <video ref={video} autoPlay playsInline muted className={`cam-view ${mirrored ? 'mirror' : ''}`} />
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
