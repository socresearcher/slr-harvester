# Vendored third-party code

Everything in this folder is third-party code served from the app's own
origin instead of a CDN. The files are **unmodified** copies of the published
npm packages; the hashes below were checked against the registry tarballs
(`registry.npmjs.org`) on 2026-09-16.

Why vendor at all: code loaded from a CDN runs with the same rights as the app
itself — including access to the Cloud Sync session. A tampered CDN copy could
read it. Same-origin copies also cannot be blocked by tracking prevention or
ad-blockers, which is what broke sign-in when the Supabase SDK still came from
`cdn.jsdelivr.net` (August 2026).

| File | Package | Version | License | SHA-256 |
|---|---|---|---|---|
| `supabase.js` | `@supabase/supabase-js` (dist/umd) | 2.112.3 | MIT | — |
| `piper/piper-tts-web.js` | `@mintplex-labs/piper-tts-web` (dist) | 1.0.5 | MIT (per package.json) | `531aa8a16605c07e5d791dfea540cadee1bd457b4a75c5303f01e843722f700f` |
| `piper/piper-o91UDS6e.js` | same package, phonemizer glue chunk | 1.0.5 | MIT | `b5ac96981729547606fd026b8e3829aad81e9e3c22308869d50473259c563283` |
| `piper/voices_static-D_OtJDHM.js` | same package, voice list chunk | 1.0.5 | MIT | `72cbd46fecaa067a09ed9455ca04b970d722810905d90bb2421e0911a5c4d758` |
| `onnxruntime/ort.wasm.min.js` | `onnxruntime-web` (dist/esm) | 1.18.0 | MIT, see `onnxruntime/LICENSE` | `d02079ae1c4143f3a555a1dff86ba523b92022d8fe519263a34cf88675738753` |

The three Piper files must stay together under their original names:
`piper-tts-web.js` imports the other two by relative path.
`onnxruntime-web/wasm` is resolved through the import map in `index.html`.

## What is deliberately *not* vendored

The neural read-aloud voices still need three remote hosts. These are large
binary or data files, not JavaScript running in the page:

| Host | What | Size |
|---|---|---|
| `cdnjs.cloudflare.com` | ONNX Runtime WebAssembly binary (`ort-wasm-simd.wasm` or a variant) | ~10 MB |
| `cdn.jsdelivr.net` | phonemizer WebAssembly and its speech-sound data (`@diffusionstudio/piper-wasm@1.0.0`) | ~0.6 MB + 18 MB |
| `huggingface.co` | the voice models (`diffusionstudio/piper-voices`) | ~63 MB per voice |

Keeping ~90 MB of binaries out of a GitHub Pages repository is the trade-off.
The consequence is intended and documented in the app: **natural voices need
an internet connection**; without one, or when a filter blocks these hosts,
the app reads aloud with a device voice instead.

## Updating

1. Download the new files from the npm tarball (not from a CDN page).
2. Compare the chunk file names — they change with every build.
3. Update `PIPER_MODULE_URL` / `PHONEMIZE_URL` in `js/tts.js` and the import
   map in `index.html` if paths change.
4. Update the table above with version and hash.
5. Speak once in German and once in English, online and offline, before
   deploying.
