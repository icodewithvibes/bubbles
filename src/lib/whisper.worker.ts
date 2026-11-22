// Runs OpenAI Whisper in the browser (transformers.js). WebGPU when available,
// WebAssembly otherwise. The model downloads once and is cached by the browser.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

const MODEL = 'onnx-community/whisper-base'

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null

async function load(post: (m: unknown) => void) {
  const gpu = 'gpu' in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter().catch(() => null))
  return (await pipeline('automatic-speech-recognition', MODEL, {
    device: gpu ? 'webgpu' : 'wasm',
    dtype: gpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: (p: { status: string; progress?: number; file?: string }) => {
      if (p.status === 'progress') post({ type: 'progress', file: p.file, progress: p.progress })
    },
  })) as AutomaticSpeechRecognitionPipeline
}

self.onmessage = async (e: MessageEvent<{ id: string; audio: Float32Array }>) => {
  const { id, audio } = e.data
  const post = (m: unknown) => self.postMessage(m)
  try {
    asr ??= load(post)
    const run = await asr
    const out = (await run(audio, { chunk_length_s: 30, stride_length_s: 5 })) as { text: string }
    post({ type: 'done', id, text: out.text.trim() })
  } catch (err) {
    asr = null
    post({ type: 'error', id, error: String((err as Error)?.message ?? err) })
  }
}
