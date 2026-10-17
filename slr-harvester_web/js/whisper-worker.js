/**
 * SLR Harvester Web - on-device speech recognition (Whisper) worker
 * Runs Whisper inside the browser with the vendored Transformers.js, so
 * dictations can be transcribed without a key and without sending audio
 * anywhere. Loaded as a module worker from js/notes.js.
 *
 * Fetched at run time, like the read-aloud voices (see js/vendor/README.md):
 *   - the ONNX Runtime WebAssembly binary from cdn.jsdelivr.net (~21 MB)
 *   - the Whisper model from huggingface.co (~40 / ~80 / ~250 MB), kept by the
 *     browser (Cache API), so later runs and offline use need no download.
 *
 * Messages in:  { type: 'load', model }  |  { type: 'run', audio: Float32Array (16 kHz mono), language }
 * Messages out: { type: 'progress', p } | { type: 'ready' } | { type: 'done', text } | { type: 'error', message }
 */
import { pipeline, env } from './vendor/transformers/transformers.min.js';

env.allowLocalModels = false;
// No cross-origin isolation on GitHub Pages, so no shared memory: one thread.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('./vendor/transformers/ort-wasm-simd-threaded.jsep.mjs', import.meta.url).href,
  wasm: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/ort-wasm-simd-threaded.jsep.wasm',
};

let asr = null;
let loaded = '';

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      if (!asr || loaded !== m.model) {
        asr = null;
        asr = await pipeline('automatic-speech-recognition', m.model, {
          progress_callback: p => self.postMessage({ type: 'progress', p }),
        });
        loaded = m.model;
      }
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'run') {
      const out = await asr(m.audio, { chunk_length_s: 30, stride_length_s: 5, language: m.language || null, task: 'transcribe' });
      self.postMessage({ type: 'done', text: (out.text || '').trim() });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
