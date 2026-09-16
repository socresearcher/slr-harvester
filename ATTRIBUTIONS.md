# Icons Attribution

All icons in this repository are sourced from Flaticon providers and used under their licensing terms.

- Source: https://www.flaticon.com/

General provider mapping
- Arrow/navigation icons: Smashicons
- Sidebar toggles: SeyfDesigner
- Other icons: Freepik (unless otherwise noted)

Per-icon attributions
- Detailed, file-specific attributions are listed in `src/assets/icons/README.md`.

Icon files (exact names)
- api.png
- boolean.png
- corpus.png
- developer.png
- display.png
- history.png
- key.png
- next.png
- previous.png
- project.png
- relaunch.png
- search.png
- shutdown.png
- sidebar-b.png
- sidebar-b-act.png
- sidebar-l.png
- sidebar-l-act.png
- sidebar-r.png
- sidebar-r-act.png
- sidebar-t.png
- sidebar-t-act.png
- tag.png

License
- Please refer to Flaticon’s licensing terms for usage rights: https://www.flaticon.com/free-icons

# Third-party code (web app)

Vendored under `slr-harvester_web/js/vendor/`, unmodified; versions and
SHA-256 hashes in `slr-harvester_web/js/vendor/README.md`.

- Supabase JS SDK 2.112.3 — MIT
- piper-tts-web 1.0.5 (Mintplex Labs) — MIT, as declared in its package.json
- ONNX Runtime Web 1.18.0 (Microsoft) — MIT, licence text in `js/vendor/onnxruntime/LICENSE`

Loaded at run time, not stored in this repository:

- ONNX Runtime Web WebAssembly binaries 1.18.0 — MIT (cdnjs.cloudflare.com)
- piper-wasm 1.0.0 (diffusion studio), phonemizer WebAssembly and espeak-ng
  data — MIT (cdn.jsdelivr.net)

# Read-aloud voices (natural voices)

Piper voice models from `diffusionstudio/piper-voices` on Hugging Face, a
mirror of `rhasspy/piper-voices`. The app does not redistribute them; the
user's browser downloads them. Terms follow each model's training dataset as
stated in its MODEL_CARD (checked 2026-09-16):

| Voice | Model | Dataset | Training | Licence |
|---|---|---|---|---|
| Konrad, Lukas, Marlene, Ines, Rieke, Susanne | de_DE-mls-medium (speakers 0, 1, 2, 4, 5, 10) | Multilingual LibriSpeech, OpenSLR 94 | from scratch | CC BY 4.0 |
| LJ | en_US-ljspeech-medium | LJ Speech (LibriVox) | from scratch | public domain |
| Kristin | en_US-kristin-medium | LibriVox | from scratch | public domain |
| Cori | en_GB-cori-medium | LibriVox | from scratch | public domain |
| Norman | en_US-norman-medium | LibriVox | from scratch | public domain |
| John | en_US-john-medium | LibriVox | fine-tuned from Kristin | public domain |

Rule: a voice is offered only if its whole lineage is openly licensed — its
own dataset and the dataset of every model it was fine-tuned from.

Most Piper voices are fine-tuned from `en_US-lessac`, whose dataset
(Blizzard 2013, Lessac Technologies / Voice Factory) is licensed for research
purposes only, to a named licensee, non-transferable and not for use by third
parties. Voices derived from it were removed on 2026-09-16: lessac, amy,
hfc_female, hfc_male, ryan (medium), alba, northern_english_male and the
Thorsten voices (medium, high, emotional).

