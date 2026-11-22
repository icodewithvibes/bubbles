// Background removal for "Make a Sticker", off the main thread.
// Model: onnx-community/ormbg-ONNX (int8, ~44 MB, Apache-2.0); downloaded once, then cached.
import { pipeline, type BackgroundRemovalPipeline, type RawImage } from '@huggingface/transformers'

let remover: Promise<BackgroundRemovalPipeline> | null = null

self.onmessage = async (e: MessageEvent<{ id: string; blob: Blob }>) => {
  const { id, blob } = e.data
  try {
    remover ??= pipeline('background-removal', 'onnx-community/ormbg-ONNX', {
      dtype: 'int8',
      progress_callback: (p: { status: string }) => {
        if (p.status === 'progress') self.postMessage({ type: 'progress' })
      },
    }) as Promise<BackgroundRemovalPipeline>
    const run = await remover
    const url = URL.createObjectURL(blob)
    try {
      const res = (await run(url)) as unknown as RawImage | RawImage[]
      const out = Array.isArray(res) ? res[0] : res
      self.postMessage({ type: 'done', id, png: await out.toBlob('image/png') })
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch (err) {
    remover = null
    self.postMessage({ type: 'error', id, error: String((err as Error)?.message ?? err) })
  }
}
