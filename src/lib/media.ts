// Media pipeline: probe files, make thumbnails, upload to Firebase Storage with
// progress, and fall back to inline data when Storage isn't set up yet.
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { create } from 'zustand'

import { compressImage } from '@/kit/util.js'
import { storage } from './firebase'
import type { Media } from './types'

export const LIMITS = {
  image: 25 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  /** Firestore documents cap at 1 MiB, so inline data must stay well under it. */
  inline: 850_000,
}
export const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`

// ---------------------------------------------------------------------------
// Upload progress, shown above the composer
// ---------------------------------------------------------------------------
export interface Upload {
  id: string
  name: string
  kind: Media['kind']
  progress: number
}
export const useUploads = create<{ uploads: Upload[] }>(() => ({ uploads: [] }))
const setUpload = (u: Upload) => useUploads.setState((s) => ({ uploads: [...s.uploads.filter((x) => x.id !== u.id), u] }))
const dropUpload = (id: string) => useUploads.setState((s) => ({ uploads: s.uploads.filter((x) => x.id !== id) }))

// ---------------------------------------------------------------------------
// Is Storage available? (No bucket until the project is on Blaze and Storage
// has been created in the console.) Remember a failure for this session.
// ---------------------------------------------------------------------------
let storageOk: boolean | null = null
export class NoStorageError extends Error {
  constructor() {
    super('Firebase Storage is not set up yet')
  }
}

// A missing bucket doesn't make uploads fail: the SDK keeps retrying for
// ~10 minutes, so sends sat at 0%. Ask the bucket directly first (fast 404
// when it doesn't exist; 401/403 means it exists but needs auth).
let probe: Promise<boolean> | null = null
function storageAvailable(): Promise<boolean> {
  if (storageOk !== null) return Promise.resolve(storageOk)
  probe ??= fetch(`https://firebasestorage.googleapis.com/v0/b/${storage.app.options.storageBucket}/o?maxResults=1`)
    .then((r) => r.status !== 404)
    .catch(() => false)
    .then((ok) => {
      storageOk = ok
      return ok
    })
  return probe
}
// And never let a real upload hang that long either.
storage.maxUploadRetryTime = 20_000
storage.maxOperationRetryTime = 20_000
const isNoBucket = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? ''
  const msg = String((e as Error)?.message ?? '')
  return code === 'storage/unknown' || code === 'storage/bucket-not-found' || code === 'storage/project-not-found' || /404|bucket/i.test(msg)
}

export async function uploadFile(path: string, blob: Blob, uploadId: string, name: string, kind: Media['kind']): Promise<string> {
  if (!(await storageAvailable())) throw new NoStorageError()
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), blob, { contentType: blob.type, cacheControl: 'public,max-age=31536000,immutable' })
    setUpload({ id: uploadId, name, kind, progress: 0 })
    task.on(
      'state_changed',
      (snap) => setUpload({ id: uploadId, name, kind, progress: snap.bytesTransferred / Math.max(1, snap.totalBytes) }),
      (e) => {
        dropUpload(uploadId)
        if (isNoBucket(e)) {
          storageOk = false
          reject(new NoStorageError())
        } else reject(e)
      },
      async () => {
        storageOk = true
        dropUpload(uploadId)
        resolve(await getDownloadURL(task.snapshot.ref))
      },
    )
  })
}

export async function deleteMedia(m?: Media) {
  if (!m?.path) return
  await deleteObject(ref(storage, m.path)).catch(() => {})
}

// ---------------------------------------------------------------------------
// Probing & thumbnails
// ---------------------------------------------------------------------------
const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error("That file isn't an image we can read."))
    im.src = url
  })

function thumbFrom(src: CanvasImageSource, w: number, h: number) {
  const s = 24 / Math.max(w, h)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * s))
  c.height = Math.max(1, Math.round(h * s))
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.6)
}

export async function probeImage(file: Blob) {
  const url = URL.createObjectURL(file)
  try {
    const im = await loadImage(url)
    return { w: im.naturalWidth, h: im.naturalHeight, thumb: thumbFrom(im, im.naturalWidth, im.naturalHeight) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function probeVideo(file: Blob) {
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    v.src = url
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve()
      v.onerror = () => reject(new Error("That video can't be played in the browser."))
    })
    // MediaRecorder webm files report Infinity until you seek past the end.
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e9
      await new Promise((r) => (v.ontimeupdate = r))
      v.currentTime = 0
    }
    const w = v.videoWidth || 640
    const h = v.videoHeight || 360
    return { w, h, dur: Number.isFinite(v.duration) ? v.duration : undefined, thumb: thumbFrom(v, w, h) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Shrink huge photos (phone cameras make 10 MB+ files) without visible loss. */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.size < 4 * 1024 * 1024) return file
  const url = URL.createObjectURL(file)
  try {
    const im = await loadImage(url)
    const s = Math.min(1, 3200 / Math.max(im.naturalWidth, im.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(im.naturalWidth * s)
    c.height = Math.round(im.naturalHeight * s)
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
    return await new Promise<Blob>((r) => c.toBlob((b) => r(b ?? file), 'image/jpeg', 0.9))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error("Couldn't read that file."))
    r.readAsDataURL(b)
  })

/** v1-compatible inline photo for when Storage isn't available. */
export const inlineImage = (file: File) => (file.type === 'image/gif' ? blobToDataUrl(file) : compressImage(file))

export const extFor = (mime: string) =>
  ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' })[
    mime.split(';')[0]
  ] ?? 'bin'

/** Waveform bars (0–1) from an audio blob, for the voice message bubble. */
export async function audioPeaks(blob: Blob, bars = 40): Promise<{ peaks: number[]; dur: number }> {
  const ctx = new AudioContext()
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    const data = buf.getChannelData(0)
    const step = Math.floor(data.length / bars) || 1
    const peaks: number[] = []
    for (let i = 0; i < bars; i++) {
      let max = 0
      for (let j = i * step; j < (i + 1) * step && j < data.length; j += 16) max = Math.max(max, Math.abs(data[j]))
      peaks.push(max)
    }
    const top = Math.max(...peaks, 0.01)
    return { peaks: peaks.map((p) => Math.round((p / top) * 100) / 100), dur: buf.duration }
  } finally {
    void ctx.close()
  }
}
