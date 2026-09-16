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

| Voice | Model | Dataset | Licence |
|---|---|---|---|
| Thorsten, Thorsten Expressive, Thorsten HD | de_DE-thorsten-medium, -thorsten_emotional-medium, -thorsten-high | Thorsten-Voice | CC0 |
| Marlene, Ines, Rieke, Susanne | de_DE-mls-medium (speakers 2, 4, 5, 10) | Multilingual LibriSpeech, OpenSLR 94 | CC BY 4.0 |
| HFC female, HFC male | en_US-hfc_female-medium, en_US-hfc_male-medium | Hi-Fi CAPTAIN (NICT) | CC BY-NC-SA 4.0 |
| Amy | en_US-amy-medium | Mycroft mimic3 voices | not stated in the model card |
| Alba | en_GB-alba-medium | Edinburgh DataShare 10283/3270 | CC BY 4.0 |
| Ryan | en_US-ryan-medium | RyanSpeech | CC BY-NC-SA 4.0 |
| Northern English male | en_GB-northern_english_male-medium | OpenSLR 83 | CC BY-SA 4.0 |

NC voices are for non-commercial use only. `en_US-lessac-medium` was removed
on 2026-09-16: its dataset (Blizzard 2013) is licensed for research to named
licensees only.

