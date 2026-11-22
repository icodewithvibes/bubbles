// "Make a Sticker": cut the subject out of a photo, add a white die-cut outline
// like iMessage stickers, crop tight and shrink to a small WebP.
import { toast } from '@/store'

let worker: Worker | null = null
let announced = false
const pending = new Map<string, { resolve: (b: Blob) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data as { type: string; id?: string; png?: Blob; error?: string }
    if (m.type === 'progress' && !announced) {
      announced = true
      toast('Downloading the sticker maker (one time, about 45 MB)…', 'info', 6000)
    }
    if (m.type === 'done' && m.id && m.png) pending.get(m.id)?.resolve(m.png)
    if (m.type === 'error' && m.id) pending.get(m.id)?.reject(new Error(m.error))
    if (m.id && m.type !== 'progress') pending.delete(m.id)
  }
  return worker
}

export function removeBackground(blob: Blob): Promise<Blob> {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, blob })
  })
}

const loadBitmap = (b: Blob) => createImageBitmap(b)

/** Die-cut outline + tight crop + resize to `max` px, as a WebP data URL. */
export async function finishSticker(cutout: Blob, { outline = 8, max = 420 } = {}): Promise<string> {
  const img = await loadBitmap(cutout)
  // Downscale first so the outline width is consistent regardless of photo size.
  const s = Math.min(1, (max - outline * 2) / Math.max(img.width, img.height))
  const w = Math.round(img.width * s)
  const h = Math.round(img.height * s)
  const pad = outline + 2

  const base = new OffscreenCanvas(w + pad * 2, h + pad * 2)
  const bctx = base.getContext('2d')!
  bctx.drawImage(img, pad, pad, w, h)

  // White silhouette of the subject.
  const sil = new OffscreenCanvas(base.width, base.height)
  const sctx = sil.getContext('2d')!
  sctx.drawImage(base, 0, 0)
  sctx.globalCompositeOperation = 'source-in'
  sctx.fillStyle = '#fff'
  sctx.fillRect(0, 0, sil.width, sil.height)

  // Stamp the silhouette in a ring to grow it into an outline, then the subject on top.
  const out = new OffscreenCanvas(base.width, base.height)
  const octx = out.getContext('2d')!
  octx.shadowColor = 'rgba(0,0,0,0.25)'
  octx.shadowBlur = 3
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2
    octx.drawImage(sil, Math.cos(t) * outline, Math.sin(t) * outline)
  }
  octx.shadowBlur = 0
  octx.drawImage(base, 0, 0)

  // Tight crop to visible pixels.
  const data = octx.getImageData(0, 0, out.width, out.height).data
  let x0 = out.width
  let y0 = out.height
  let x1 = 0
  let y1 = 0
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++)
      if (data[(y * out.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 <= x0 || y1 <= y0) throw new Error("Couldn't find anything to cut out in that photo.")
  const crop = new OffscreenCanvas(x1 - x0 + 1, y1 - y0 + 1)
  crop.getContext('2d')!.drawImage(out, -x0, -y0)

  for (const q of [0.9, 0.8, 0.65]) {
    const blob = await crop.convertToBlob({ type: 'image/webp', quality: q })
    const url = await new Promise<string>((r) => {
      const fr = new FileReader()
      fr.onload = () => r(fr.result as string)
      fr.readAsDataURL(blob)
    })
    if (url.length < 380_000) return url
  }
  throw new Error('That sticker came out too big. Try a simpler photo.')
}
