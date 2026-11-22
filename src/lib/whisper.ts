// Main-thread side of Whisper: decode audio to 16 kHz mono and ask the worker.
import { toast } from '@/store'

let worker: Worker | null = null
let announced = false
const pending = new Map<string, { resolve: (t: string) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e) => {
    const m = e.data as { type: string; id?: string; text?: string; error?: string; progress?: number }
    if (m.type === 'progress' && !announced) {
      announced = true
      toast('Downloading the speech model (one time, about 80 MB)…', 'info', 6000)
    }
    if (m.type === 'done' && m.id) {
      pending.get(m.id)?.resolve(m.text ?? '')
      pending.delete(m.id)
    }
    if (m.type === 'error' && m.id) {
      pending.get(m.id)?.reject(new Error(m.error))
      pending.delete(m.id)
    }
  }
  return worker
}

async function toPcm16k(blob: Blob) {
  const ctx = new AudioContext({ sampleRate: 16000 })
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    return buf.getChannelData(0).slice()
  } finally {
    void ctx.close()
  }
}

export const transcribeEnabled = () => {
  try {
    return localStorage.getItem('bubbles.transcribe') !== 'off'
  } catch {
    return true
  }
}

export async function transcribe(blob: Blob): Promise<string> {
  const audio = await toPcm16k(blob)
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, audio }, [audio.buffer])
  })
}
