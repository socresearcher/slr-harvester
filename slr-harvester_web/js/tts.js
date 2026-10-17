/**
 * SLR Harvester Web — Read Aloud (Text-to-Speech)
 *
 * Two engines behind one interface:
 *
 *   'system' — the device's own voices (Web Speech API). Instant, no
 *              download, works everywhere including iPhone. Quality depends
 *              entirely on what the device ships.
 *   'neural' — Piper, a neural TTS model running fully inside the browser
 *              (ONNX/WASM). Markedly more natural. The text being read never
 *              leaves the device, but the engine's WebAssembly and speech
 *              data and the voice models (~63 MB per language, then stored
 *              in OPFS) come from remote hosts — so the first use needs a
 *              connection. After that the service worker (sw.js) keeps the
 *              engine files, and the voice works offline too. Otherwise, or
 *              when a host is blocked, speak() falls back to engine 1.
 *              The engine's JavaScript is vendored (js/vendor/piper/).
 *
 * Two things matter more than the engine choice and are handled here:
 *
 *  1. Language. Abstracts are mostly English, but not all of them. Reading
 *     English with a German voice (or the reverse) is what makes a voice
 *     sound robotic, so the language is detected per text and each language
 *     keeps its own voice.
 *  2. Length. Chrome truncates or stalls on long utterances, and an abstract
 *     runs well past any safe limit — so text is spoken sentence by sentence.
 *
 * Global: window.SLRTts
 */

window.SLRTts = (() => {

  const STORE_KEY = 'slr-tts';
  // Piper synthesises a whole chunk in one go, so longer pieces are fine and
  // actually sound better.
  //
  // The device engine used to get 110 characters for EVERY voice, because
  // Chrome cuts a single utterance off after roughly fifteen seconds. That
  // limit belongs to Google's *network* voices in Chrome, not to voices in
  // general. Edge's "Online (Natural)" voices, Apple's and the local Windows
  // ones read long sentences without it — and for them 110 characters meant
  // a break every second clause: on a German abstract read with an Edge
  // natural voice, ten audible pauses (median 190 ms) and a label such as
  // "Methode:" spoken as an utterance of its own. The KI & Erwerbsarbeit
  // site, which took this code from here, found the same and settled on 260
  // for everything that is not a Google network voice (measured there
  // 04.10.2026, re-measured here 11.10.2026 with Edge natural voices).
  const MAX_CHUNK = 180;
  const MAX_CHUNK_SYSTEM = 260;
  const MAX_CHUNK_GOOGLE_NETWORK = 110;

  // ── Settings ──────────────────────────────────────────────────────
  const DEFAULTS = {
    engine: 'system',
    rate: 1,
    voices: { de: '', en: '' },                                  // system voice URIs
    piper: { de: 'de_DE-mls-medium#0', en: 'en_US-ljspeech-medium' },
  };

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
      return {
        ...DEFAULTS, ...raw,
        voices: { ...DEFAULTS.voices, ...(raw.voices || {}) },
        piper: { ...DEFAULTS.piper, ...(raw.piper || {}) },
      };
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  let settings = loadSettings();

  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
  }

  function getSettings() { return settings; }

  function set(patch) {
    settings = { ...settings, ...patch };
    saveSettings();
  }

  // ── Language detection ────────────────────────────────────────────
  // Only words that do not exist in the other vocabulary. "in", "was", "so",
  // "war", "die" (English verb) and "man" occur in both and are in neither
  // list — they would only add noise.
  const DE_WORDS = /\s(der|das|und|nicht|ist|sind|laut|welche|welcher|welches|welchem|welchen|wird|werden|wurde|wurden|eine|einen|einem|einer|von|mit|für|auf|bei|beim|durch|zwischen|über|nach|aus|dem|den|des|sich|kann|können|zur|zum|hat|hatte|haben|sein|seine|ihre|wie|wo|wer|warum|weshalb|gilt|im|um|als|auch|oder|aber|dass|wenn|weil|gegen|ohne|nur|schon|noch|soll|sollen|muss|müssen|gibt|geht|steht|liegt|folgende|folgenden|unter|vor|seit|während|sowie|diese|dieser|dieses|wurde|bereits|damit)\s/g;
  const EN_WORDS = /\s(the|of|and|is|are|which|following|what|to|for|with|that|by|from|on|as|it|its|not|be|this|these|does|do|how|why|when|an|or|can|has|have|between|about|their|there|would|should|used|using|each|other|we|our|study|results|research|paper)\s/g;

  function detectLang(text) {
    const raw = String(text || '');
    // Umlauts and ß settle it on their own — English text essentially never
    // contains them.
    if (/[äöüßÄÖÜ]/.test(raw)) return 'de';
    const t = ' ' + raw.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ') + ' ';
    const de = (t.match(DE_WORDS) || []).length;
    const en = (t.match(EN_WORDS) || []).length;
    if (de !== en) return de > en ? 'de' : 'en';
    // Tie — German capitalises nouns mid-sentence, English only proper nouns.
    const words = raw.split(/\s+/).slice(1);
    const caps = words.filter(w => /^[A-ZÄÖÜ][a-zäöüß]{2,}/.test(w)).length;
    return caps >= Math.max(2, words.length * 0.2) ? 'de' : 'en';
  }

  // ── Chunking ──────────────────────────────────────────────────────
  //
  // Every chunk is spoken in the order it is returned, so this function has
  // exactly one hard requirement: joining the result back together must give
  // the input again, in the same order. It did not.
  //
  // The oversized-sentence branch pushed its pieces straight onto `chunks`
  // while `buf` still held an earlier sentence that had not been flushed
  // yet. That earlier sentence was then appended *after* them. A text like
  // "Kurzer Satz. Ein zweiter, sehr langer Satz …" came out as the long
  // sentence first and "Kurzer Satz." second — which is heard as the reading
  // starting in the middle, and as sentences turning up where they do not
  // belong. `flush()` before any push is the whole fix; the property is
  // asserted in the tests below.
  // Where a sentence may end. Not after:
  //   - a one-character label: "A: Text" and "1: Text" would be torn apart
  //     and the label spoken on its own;
  //   - a single letter and a full stop ("z. B.", "d. h.", "J. R. Kitchin"):
  //     the reading would stop after "z." and carry on with "B. ...";
  //   - the usual abbreviations of scientific German and English ("et al.",
  //     "vgl.", "Abb.", "Fig.", "Dr.", "ca.", "bzw." ...).
  // Neither the KI & Erwerbsarbeit site nor this code handled that before; in
  // abstracts it is common. Only *where* a cut may fall changes, never the
  // order — the splitting test asserts that on thousands of random texts.
  const ABBREVIATIONS = 'al|vgl|bzw|ca|Nr|Abb|Tab|Kap|Dr|Prof|Fig|Eq|vs|etc|resp|inkl|ggf|evtl|usw|sog|bspw|ebd|Hrsg|Jg|Bd|approx|cf|incl';
  const SENTENCE_BREAK = new RegExp(
    '(?<=[.!?:;])(?<!\\b[A-Za-z0-9]:)(?<!\\b[A-Za-z\\u00C0-\\u017F]\\.)(?<!\\b(?:' + ABBREVIATIONS + ')\\.)\\s+');
  // A buffered lead-in this short (a label such as "Methode:") is carried into
  // an oversized sentence that follows instead of being flushed alone.
  const SHORT_LEAD = 40;
  // A last piece this short is joined to its predecessor when that fits.
  const SHORT_TAIL = 25;

  function splitIntoChunks(text, maxLen) {
    const limit = maxLen || MAX_CHUNK;
    const sentences = String(text || '').replace(/\s+/g, ' ').trim().split(SENTENCE_BREAK);
    const chunks = [];
    let buf = '';

    const flush = () => {
      const t = buf.trim();
      if (t) chunks.push(t);
      buf = '';
    };

    for (const sentence of sentences) {
      let rest = sentence.trim();
      if (!rest) continue;

      // Carried, not flushed: "Methode:" before a long sentence used to be
      // spoken alone, with a pause either side. buf comes first, so the
      // order is untouched.
      if (rest.length > limit && buf && buf.length < SHORT_LEAD) {
        rest = buf + ' ' + rest;
        buf = '';
      }

      // A single sentence longer than the limit gets broken at a comma or
      // semicolon, or failing that at a space, or failing that mid-word. The
      // search starts at limit - 1 so a piece never exceeds the limit.
      while (rest.length > limit) {
        flush();
        let cut = Math.max(rest.lastIndexOf(',', limit - 1), rest.lastIndexOf(';', limit - 1));
        if (cut < limit * 0.4) cut = rest.lastIndexOf(' ', limit - 1);
        if (cut < limit * 0.4) cut = limit - 1;
        const piece = rest.slice(0, cut + 1).trim();
        if (piece) chunks.push(piece);
        rest = rest.slice(cut + 1).trim();
      }
      if (!rest) continue;

      if ((buf ? buf + ' ' + rest : rest).length > limit) flush();
      buf = buf ? buf + ' ' + rest : rest;
    }
    flush();

    // A one- or two-word tail ("steht aus.") is not worth a pause of its own.
    if (chunks.length > 1) {
      const last = chunks[chunks.length - 1], prev = chunks[chunks.length - 2];
      if (last.length < SHORT_TAIL && prev.length + 1 + last.length <= limit) {
        chunks.splice(chunks.length - 2, 2, prev + ' ' + last);
      }
    }
    return chunks.filter(Boolean);
  }

  // Google's network voices in Chrome cut a single utterance off at roughly
  // fifteen seconds, silently. 110 characters is about eight seconds at normal
  // speed — but the rate slider goes down to 0.7, which stretches the same
  // chunk towards twelve, and a slow reader would start losing the tail of
  // every chunk. Scaling the limit with the rate keeps every piece the same
  // length in *time*. Every other device voice gets the long limit.
  //
  // localService === false is what marks a network voice. A Google voice that
  // is installed locally (Android language packs) has it true and is not
  // subject to the limit.
  function isGoogleNetworkVoice(v) {
    return !!v && v.localService === false && /google/i.test(v.name || '');
  }

  function systemChunkLimit(voice) {
    if (!isGoogleNetworkVoice(voice)) return MAX_CHUNK_SYSTEM;
    const rate = settings.rate || 1;
    return Math.max(60, Math.round(MAX_CHUNK_GOOGLE_NETWORK * Math.min(1, rate)));
  }

  // ── Engine 1: device voices ───────────────────────────────────────
  // iPhone/iPad (Safari, also as a Home-Screen app) start speaking only when
  // speak() is called inside the tap that asked for it. A timer in between
  // (the pause that Chrome needs after cancel()) silently swallows the
  // utterance there, which is why reading aloud did nothing on iOS.
  const UA = navigator.userAgent || '';
  const IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const SAFARI = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(UA);
  const SYNC_START = IOS || SAFARI;

  let availableVoices = [];
  const voiceListeners = new Set();
  const notifyVoices = () => voiceListeners.forEach(fn => { try { fn(availableVoices); } catch (e) { /* listener's problem */ } });

  function loadVoices() {
    if (window.speechSynthesis) availableVoices = window.speechSynthesis.getVoices() || [];
    return availableVoices;
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = () => { loadVoices(); notifyVoices(); };
  }

  // Browsers cannot download voices themselves, and iOS often reports its list
  // only after several asks (or after the app was restarted). Ask again over a
  // few seconds; whoever shows the list hears about every change.
  function onVoicesChanged(fn) { voiceListeners.add(fn); return () => voiceListeners.delete(fn); }
  function refreshVoices(quiet) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    let last = -1;
    const look = () => {
      const n = loadVoices().length;
      if (n !== last) { last = n; notifyVoices(); }
    };
    if (!quiet) { try { synth.cancel(); } catch (e) { /* ignore */ } }
    look();
    [250, 900, 2200, 4500, 8000].forEach(ms => setTimeout(look, ms));
  }
  if (IOS) refreshVoices(true);

  // Not every system voice is equal: the neural online ones (Edge "Natural",
  // Google, Siri "Enhanced") are worlds apart from the legacy local engines
  // (SAPI "Desktop", eSpeak, "Compact"), which is exactly the difference
  // between "a voice" and "a robot".
  // Quality can sit in the name or, on iOS, only in the voiceURI
  // (com.apple.voice.premium.de-DE.Anna). Apple's novelty voices (Zarvox,
  // Bells ...) are marked down so "Automatic" never lands on them.
  const NOVELTY_VOICE = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Ralph|Kathy)\b/i;
  function voiceQualityScore(v) {
    const n = ((v && v.name) || '') + ' ' + ((v && v.voiceURI) || '');
    let score = 0;
    if (/\.premium\./i.test(n))                       score += 90;
    if (/\.enhanced\./i.test(n))                      score += 70;
    if (/ttsbundle\.siri|\.siri[._]/i.test(n))        score += 80;
    if (/\.compact\./i.test(n))                       score -= 10;
    if (/natural|neural|online/i.test(n))             score += 100;
    if (/premium/i.test(n))                           score += 90;
    if (/siri/i.test(n))                              score += 80;
    if (/enhanced|erweitert|verbessert|hochwertig/i.test(n)) score += 70;
    if (/google/i.test(n))                            score += 40;
    if (v && v.localService === false)                score += 25;
    if (/compact/i.test(n))                           score -= 3;
    if (/desktop/i.test(n))                           score -= 4;
    if (/espeak|festival|pico/i.test(n))              score -= 8;
    if (NOVELTY_VOICE.test(n))                        score -= 200;
    return score;
  }
  // "Natural-sounding" for the sparkle in the voice lists.
  const isNatural = v => voiceQualityScore(v) >= 70;

  function voicesForLang(lang) {
    return loadVoices()
      .filter(v => (v.lang || '').toLowerCase().startsWith(lang))
      .sort((a, b) => voiceQualityScore(b) - voiceQualityScore(a) || a.name.localeCompare(b.name));
  }

  function pickSystemVoice(lang) {
    const uri = (settings.voices || {})[lang];
    if (uri) {
      const exact = loadVoices().find(v => v.voiceURI === uri);
      if (exact) return exact;
    }
    return voicesForLang(lang)[0] || null;
  }

  let stallGuard = null;

  // Chrome collects an utterance that nothing references any more — before
  // its end event has fired, so the chain never continues and only the
  // watchdog below gets it moving again, a moment late. Holding the
  // utterances here until they are done costs nothing and removes the cause.
  const heldUtterances = new Set();

  // One utterance at a time, chained on its own end event.
  //
  // The previous version queued every sentence at once and then pinged
  // pause()/resume() every nine seconds to defeat Chrome's ~15-second
  // cut-off. Both parts were wrong: Chrome drops entries from a queue that
  // is filled synchronously, and a pause() immediately followed by resume()
  // makes it abandon the utterance it is on and continue with the next —
  // which is exactly "every so often a whole sentence is missing", on any
  // voice. Speaking one piece at a time removes the need for the workaround
  // entirely, and for Google's network voices (the only ones with the cut-off)
  // the pieces stay short enough never to get near it. The KI & Erwerbsarbeit
  // site re-added the nudge for those voices; it is deliberately not taken
  // over, for the reason just given.
  function speakSystem(chunks, lang, onDone, token, voice) {
    const synth = window.speechSynthesis;
    if (!synth) { onDone(); return; }
    clearTimeout(stallGuard);
    if (voice === undefined) voice = pickSystemVoice(lang);
    const rate = settings.rate || 1;
    let i = 0;

    const startChunk = (attempt) => {
      if (token !== speakToken) return;            // stopped meanwhile
      if (i >= chunks.length) { onDone(); return; }
      const chunk = chunks[i];

      const utt = new SpeechSynthesisUtterance(chunk);
      heldUtterances.add(utt);
      if (voice) { utt.voice = voice; utt.lang = voice.lang; }
      else utt.lang = lang === 'de' ? 'de-DE' : 'en-US';
      utt.rate = rate;

      let started = false;    // onstart fired
      let sawBusy = false;    // the engine reported itself busy (speaking/pending) at least once
      let settled = false;
      let idle = 0;           // consecutive looks at an engine that is doing nothing

      const release = () => { heldUtterances.delete(utt); };

      const advance = () => {
        if (settled || token !== speakToken) return;
        settled = true;
        clearTimeout(stallGuard);
        release();
        i += 1;
        startChunk(0);
      };

      // Say this same chunk again. Only ever for a chunk that never began.
      const repeat = () => {
        settled = true;
        clearTimeout(stallGuard);
        release();
        // Drop the stale utterance first, or it may still surface later
        // and speak the chunk a second time.
        synth.cancel();
        setTimeout(() => startChunk(attempt + 1), 200);
      };

      utt.onstart = () => { started = true; };
      utt.onend = advance;
      utt.onerror = e => {
        if (settled || token !== speakToken) return;
        // A cancel/interrupt is our own doing (stop, or a new read) — the
        // chain must not continue in that case.
        if (e.error === 'interrupted' || e.error === 'canceled') { settled = true; release(); return; }
        // An error before anything was spoken loses the chunk if we move on;
        // saying it again does not. (It used to just move on.)
        if (!started && attempt < 2) { repeat(); return; }
        advance();
      };

      // Two failures need two different answers.
      //
      //   never started    the engine dropped the utterance — or an online
      //                    voice is still fetching its audio. Nothing was
      //                    spoken, so say this same chunk again. How long to
      //                    wait first depends on what the engine showed:
      //                    never busy at all means it dropped the utterance
      //                    (about two seconds), busy at some point means it
      //                    was working on it, and online voices can need
      //                    several seconds before the first sound (about six).
      //                    Measured in Edge, 11.10.2026: speaking is true from
      //                    speak() until the end, for natural and local voices
      //                    alike (first sound after 590 ms cold, 140-170 ms
      //                    warm) — so "idle and never started" there really
      //                    is a drop, and waiting six seconds for it would
      //                    only be a long silence.
      //   started, no end  it was spoken and the end event went missing.
      //                    Move on; repeating it would say it twice.
      //
      // The previous watchdog counted "the engine was busy at some point" as
      // "this was spoken". For an online voice that is busy fetching and then
      // goes quiet without ever starting, that skipped the chunk — text
      // missing in the middle of a reading. Only an actual start now counts.
      //
      // And it must never cancel() an utterance that is still speaking
      // because it has outrun an estimated duration: that truncates a
      // sentence mid-word and jumps to the next one. Only the engine's own
      // idea of "am I still busy" decides.
      const watch = () => {
        if (settled || token !== speakToken) return;
        if (synth.speaking || synth.pending) { sawBusy = true; idle = 0; stallGuard = setTimeout(watch, 500); return; }
        idle += 1;
        if (started) {
          // Spoken, and the engine has been idle for two looks in a row.
          if (idle >= 2) advance(); else stallGuard = setTimeout(watch, 400);
          return;
        }
        if (idle < (sawBusy ? 12 : 4)) { stallGuard = setTimeout(watch, 500); return; }   // about six / two seconds
        if (attempt < 2) { repeat(); return; }
        advance();  // three tries is enough; better one gap than a dead stop
      };
      // Generous first look: on the very first use the engine can take a
      // moment to get going, and treating that as a drop would make it
      // stutter.
      stallGuard = setTimeout(watch, 800);

      synth.speak(utt);
    };

    // Chrome drops an utterance handed to it in the same tick as cancel(),
    // which is why the first sentence of an abstract regularly went missing.
    // A paused engine (it can get stuck that way) never starts at all.
    synth.cancel();
    if (synth.paused || SYNC_START) synth.resume();
    // iOS and Safari: start inside the tap (see SYNC_START above).
    if (SYNC_START) startChunk(0); else setTimeout(() => startChunk(0), 160);
  }

  // ── Engine 2: Piper (neural, in-browser) ──────────────────────────
  // Split by kind, deliberately (see js/vendor/README.md):
  //   JavaScript  — served from this origin (js/vendor/piper/). Code from a
  //                 CDN would run with the app's own rights, next to the
  //                 Cloud Sync session; same-origin also cannot be blocked
  //                 by tracking prevention.
  //   Binaries    — ONNX runtime WASM (cdnjs), phonemizer WASM + speech
  //   and models    data (jsdelivr), voice models (huggingface) stay remote:
  //                 ~90 MB that do not belong in a Pages repository. Hence
  //                 natural voices need a connection; without one, speak()
  //                 falls back to a device voice.
  // Resolved against this script's own URL, so the app works from any
  // sub-path (GitHub Pages serves it under /slr-harvester/).
  const VENDOR_BASE = new URL('vendor/piper/',
    (document.currentScript && document.currentScript.src) || location.href).href;
  const PIPER_MODULE_URL = VENDOR_BASE + 'piper-tts-web.js';
  // The phonemizer is not under WASM_BASE (only .wasm/.data live there) — it
  // is a bundle chunk of the package, the same one the library imports.
  const PHONEMIZE_URL = VENDOR_BASE + 'piper-o91UDS6e.js';

  // Hosts the neural engine still needs. Listed once so the settings panel
  // and the privacy view can name them from the same source.
  const NEURAL_REMOTE_HOSTS = [
    { host: 'huggingface.co',        what: 'voice model files' },
    { host: 'cdn.jsdelivr.net',      what: 'speech-sound data and phonemizer (WebAssembly)' },
    { host: 'cdnjs.cloudflare.com',  what: 'speech-engine runtime (WebAssembly)' },
  ];

  // Only voices with the 256-symbol phoneme table. Piper widened that table
  // at some point and the bundled phonemizer emits ids from the new one, so
  // every older "low"/"x_low" voice aborts with "indices element out of data
  // bounds". Rule for additions: "medium" or "high" only, and speak once
  // before shipping it.
  //
  // All German voices come from de_DE-mls-medium, a model trained on 236
  // speakers; the voice is chosen by speaker id, not by a separate model, so
  // one download covers all of them. Ids come from the model's own speaker
  // map, gender and training volume from the MLS metainfo.txt
  // (facebook/multilingual_librispeech) — the speakers with the most
  // material of each gender.
  //
  // Licence rule (2026-09-16): a voice ships only if its WHOLE lineage is
  // openly licensed — the dataset it was trained on and, for a fine-tuned
  // voice, the dataset of every model it was fine-tuned from. Source: the
  // voice's MODEL_CARD at rhasspy/piper-voices.
  //
  // Most Piper voices fail that rule. They are fine-tuned from en_US-lessac,
  // whose dataset (Blizzard 2013, Lessac/Voice Factory) is licensed for
  // research only, to a named person or lab, non-transferable, and not for
  // use by third parties. A model derived from it inherits that problem, so
  // offering it to every visitor is not covered. Removed for this reason:
  // lessac, amy, hfc_female, hfc_male, ryan-medium, alba,
  // northern_english_male, thorsten-medium, thorsten-high and
  // thorsten_emotional (fine-tuned from thorsten-medium).
  //
  // What remains is trained from scratch on public-domain LibriVox or
  // LJ Speech recordings, or fine-tuned only from such a voice (john from
  // kristin), plus the MLS model (CC BY 4.0, trained from scratch). A stored
  // choice of a removed voice falls back to the first voice of its list.
  const PIPER_VOICES = {
    de: [
      { id: 'de_DE-mls-medium', speaker: 0,  label: 'Konrad — male, most training data (recommended)', licence: 'CC BY 4.0', dataset: 'Multilingual LibriSpeech (OpenSLR 94)' },
      { id: 'de_DE-mls-medium', speaker: 2,  label: 'Marlene — female, clear',          licence: 'CC BY 4.0', dataset: 'Multilingual LibriSpeech (OpenSLR 94)' },
      { id: 'de_DE-mls-medium', speaker: 1,  label: 'Lukas — male',                     licence: 'CC BY 4.0', dataset: 'Multilingual LibriSpeech (OpenSLR 94)' },
      { id: 'de_DE-mls-medium', speaker: 4,  label: 'Ines — female',                    licence: 'CC BY 4.0', dataset: 'Multilingual LibriSpeech (OpenSLR 94)' },
      { id: 'de_DE-mls-medium', speaker: 5,  label: 'Rieke — female',                   licence: 'CC BY 4.0', dataset: 'Multilingual LibriSpeech (OpenSLR 94)' },
      { id: 'de_DE-mls-medium', speaker: 10, label: 'Susanne — female',                 licence: 'CC BY 4.0', dataset: 'Multilingual LibriSpeech (OpenSLR 94)' },
    ],
    en: [
      { id: 'en_US-ljspeech-medium', label: 'LJ — female, clear (recommended)', licence: 'public domain', dataset: 'LJ Speech (LibriVox), trained from scratch' },
      { id: 'en_US-kristin-medium',  label: 'Kristin — female',                 licence: 'public domain', dataset: 'LibriVox, trained from scratch' },
      { id: 'en_GB-cori-medium',     label: 'Cori — female, British',           licence: 'public domain', dataset: 'LibriVox, trained from scratch' },
      { id: 'en_US-norman-medium',   label: 'Norman — male',                    licence: 'public domain', dataset: 'LibriVox, trained from scratch' },
      { id: 'en_US-john-medium',     label: 'John — male',                      licence: 'public domain', dataset: 'LibriVox, fine-tuned from Kristin' },
    ],
  };

  function voiceKey(v) { return v.speaker == null ? v.id : v.id + '#' + v.speaker; }

  function piperVoice(lang) {
    const chosen = (settings.piper || {})[lang];
    const list = PIPER_VOICES[lang] || [];
    return list.find(v => voiceKey(v) === chosen) || list[0];
  }

  function voiceLabel(modelId) {
    for (const lang of Object.keys(PIPER_VOICES)) {
      const hit = PIPER_VOICES[lang].find(v => v.id === modelId);
      if (hit) return hit.label.split(' — ')[0];
    }
    return modelId;
  }

  let piperModulePromise = null;
  function piperModule() {
    if (!piperModulePromise) piperModulePromise = import(PIPER_MODULE_URL);
    return piperModulePromise;
  }

  // The library keeps its TtsSession as a singleton and loads the model only
  // in init(); assigning a new voiceId afterwards does not reload it. So the
  // singleton has to be dropped whenever the voice changes.
  let session = null;
  let sessionVoice = null;

  async function resetSession() {
    session = null;
    sessionVoice = null;
    try { (await piperModule()).TtsSession._instance = null; } catch (e) { /* never loaded */ }
  }

  async function getSession(voiceId, onProgress) {
    const mod = await piperModule();
    if (session && sessionVoice === voiceId) return session;
    mod.TtsSession._instance = null;
    session = await mod.TtsSession.create({ voiceId, progress: onProgress });
    sessionVoice = voiceId;
    return session;
  }

  // ── Multi-speaker models ──────────────────────────────────────────
  // The library hard-codes speaker id 0 in its inference call. For a model
  // with 236 speakers that means always the same (male) one, so these run
  // through our own call — same steps, with a selectable "sid" input.
  const assets = { ort: null, phonemize: null, models: new Map() };

  async function opfsBlob(name) {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('piper', { create: true });
      return await (await dir.getFileHandle(name)).getFile();
    } catch (e) { return null; }
  }

  async function opfsWrite(name, blob) {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('piper', { create: true });
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    } catch (e) { console.warn('Could not cache voice:', e); }
  }

  // Same file names in the same OPFS folder the library uses, so both paths
  // share one download.
  async function fetchAsset(url, onProgress) {
    const name = url.split('/').pop();
    const cached = await opfsBlob(name);
    if (cached) return cached;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Download failed: ' + res.status + ' ' + name);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!onProgress || !total || !res.body) {
      const blob = await res.blob();
      await opfsWrite(name, blob);
      return blob;
    }
    const reader = res.body.getReader();
    const parts = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      onProgress({ loaded, total, url });
    }
    const blob = new Blob(parts);
    await opfsWrite(name, blob);
    return blob;
  }

  async function multiSpeakerModel(voiceId, onProgress) {
    if (assets.models.has(voiceId)) return assets.models.get(voiceId);
    const mod = await piperModule();
    const path = mod.PATH_MAP[voiceId];
    if (!path) throw new Error('Unknown voice: ' + voiceId);

    if (!assets.ort) {
      const ortModule = await import('onnxruntime-web/wasm');
      const ort = ortModule.default || ortModule;
      if (ort.env) {
        if ('allowLocalModels' in ort.env) ort.env.allowLocalModels = false;
        if (ort.env.wasm) {
          ort.env.wasm.numThreads = navigator.hardwareConcurrency;
          ort.env.wasm.wasmPaths = mod.ONNX_BASE;
        }
      }
      assets.ort = ort;
    }
    const ort = assets.ort;
    const config = JSON.parse(await (await fetchAsset(`${mod.HF_BASE}/${path}.json`)).text());
    const modelBlob = await fetchAsset(`${mod.HF_BASE}/${path}`, onProgress);
    const ortSession = await ort.InferenceSession.create(
      await modelBlob.arrayBuffer(), { executionProviders: ['wasm'] });
    const entry = { config, ortSession, ort };
    assets.models.set(voiceId, entry);
    return entry;
  }

  async function phonemeIds(text, espeakVoice, wasmBase) {
    if (!assets.phonemize) {
      assets.phonemize = (await import(PHONEMIZE_URL)).createPiperPhonemize;
    }
    return new Promise((resolve, reject) => {
      assets.phonemize({
        print: data => { try { resolve(JSON.parse(data).phoneme_ids); } catch (e) { reject(e); } },
        printErr: message => reject(new Error(message)),
        locateFile: url => {
          if (url.endsWith('.wasm')) return `${wasmBase}.wasm`;
          if (url.endsWith('.data')) return `${wasmBase}.data`;
          return url;
        },
      }).then(module => {
        module.callMain(['-l', espeakVoice, '--input',
          JSON.stringify([{ text: text.trim() }]), '--espeak_data', '/espeak-ng-data']);
      }).catch(reject);
    });
  }

  // Wraps float PCM in a WAV container. Note the endianness: RIFF/WAVE/"fmt "
  // are written big-endian, "data" little-endian — get that one wrong and
  // decodeAudioData rejects the whole file.
  function pcmToWavBlob(pcm, sampleRate) {
    const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    view.setUint32(0, 1380533830, false);   // RIFF
    view.setUint32(4, 36 + pcm.length * 2, true);
    view.setUint32(8, 1463899717, false);   // WAVE
    view.setUint32(12, 1718449184, false);  // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 1635017060, true);   // data
    view.setUint32(40, pcm.length * 2, true);
    let p = 44;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i];
      view.setInt16(p, v >= 1 ? 32767 : v <= -1 ? -32768 : (v * 32768) | 0, true);
      p += 2;
    }
    return new Blob([view.buffer], { type: 'audio/x-wav' });
  }

  async function predictWithSpeaker(text, voiceId, speakerId, onProgress) {
    const mod = await piperModule();
    const { config, ortSession, ort } = await multiSpeakerModel(voiceId, onProgress);
    const ids = await phonemeIds(text, config.espeak.voice, mod.WASM_BASE);
    const inf = config.inference;
    const feeds = {
      input: new ort.Tensor('int64', ids, [1, ids.length]),
      input_lengths: new ort.Tensor('int64', [ids.length]),
      scales: new ort.Tensor('float32', [inf.noise_scale, inf.length_scale, inf.noise_w]),
    };
    if (Object.keys(config.speaker_id_map || {}).length) {
      feeds.sid = new ort.Tensor('int64', [speakerId || 0]);
    }
    const out = await ortSession.run(feeds);
    return pcmToWavBlob(out.output.data, config.audio.sample_rate);
  }

  // ── Playback ──────────────────────────────────────────────────────
  // Web Audio rather than an <audio> element. Browsers only let sound start
  // from a user gesture, and an <audio> element "unlocked" with a silent clip
  // does not hold long enough: between the tap and the finished audio sits
  // the model download (~63 MB, many seconds), after which play() is refused
  // and nothing happens at all. An AudioContext resumed once inside a gesture
  // stays usable indefinitely.
  let audioCtxInstance = null;
  let audioSource = null;

  function audioCtx() {
    if (!audioCtxInstance) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) audioCtxInstance = new Ctor();
    }
    return audioCtxInstance;
  }

  function unlockAudio() {
    const ctx = audioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function stopAudioSource() {
    if (audioSource) {
      try { audioSource.onended = null; audioSource.stop(); } catch (e) { /* already ended */ }
      audioSource = null;
    }
  }

  async function playWavBlob(blob, rate) {
    const ctx = audioCtx();
    if (!ctx) throw new Error('Web Audio is not available in this browser');
    if (ctx.state === 'suspended') await ctx.resume();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return new Promise(resolve => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate || 1;
      src.connect(ctx.destination);
      src.onended = () => { if (audioSource === src) audioSource = null; resolve(); };
      audioSource = src;
      src.start();
    });
  }

  let speakToken = 0;
  let speaking = false;
  const listeners = new Set();

  function onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function setSpeaking(on) {
    speaking = !!on;
    listeners.forEach(fn => { try { fn(speaking); } catch (e) { /* listener's problem */ } });
  }
  function isSpeaking() {
    if (speaking) return true;
    return !!(window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending));
  }

  async function speakPiper(chunks, lang, onDone, onProgress) {
    const voice = piperVoice(lang);
    const token = speakToken;
    const multi = voice.speaker != null;
    let sess = null;
    if (multi) await multiSpeakerModel(voice.id, onProgress);
    else sess = await getSession(voice.id, onProgress);

    for (const chunk of chunks) {
      if (token !== speakToken) break;
      const blob = multi
        ? await predictWithSpeaker(chunk, voice.id, voice.speaker, onProgress)
        : await sess.predict(chunk);
      if (token !== speakToken) break;
      await playWavBlob(blob, settings.rate || 1);
    }
    if (token === speakToken) onDone();
  }

  function stop() {
    speakToken++;
    clearTimeout(stallGuard);
    heldUtterances.clear();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    stopAudioSource();
    setSpeaking(false);
  }

  // Entry point. Must be called from a user gesture (browser audio policy).
  function speak(text, opts) {
    const options = opts || {};
    if (!text) return;
    unlockAudio();
    const lang = options.lang || detectLang(text);
    const chunks = splitIntoChunks(text);
    if (!chunks.length) return;
    // A fresh read invalidates whatever was running before.
    speakToken++;
    setSpeaking(true);
    const done = () => setSpeaking(false);

    // The voice comes first: how long a piece may be depends on which voice
    // has to read it (see systemChunkLimit).
    const readWithDeviceVoice = () => {
      const voice = pickSystemVoice(lang);
      speakSystem(splitIntoChunks(text, systemChunkLimit(voice)), lang, done, speakToken, voice);
    };

    const tryNeural = () =>
      speakPiper(chunks, lang, done, options.onProgress).catch(async err => {
        // Engine or model could not be loaded (connection dropped, a host
        // blocked by a filter, no WebAssembly): read it with a device voice
        // rather than not at all.
        console.warn('Neural voice unavailable, falling back to a device voice:', err);
        await resetSession();
        if (options.onFallback) options.onFallback({ reason: 'unavailable', error: err });
        readWithDeviceVoice();
      });

    if (settings.engine !== 'neural') {
      readWithDeviceVoice();
    } else if (navigator.onLine !== false) {
      tryNeural();
    } else {
      // No connection. Natural voices still work if everything they need is
      // already on this device: the voice model (OPFS) and the engine files
      // (service-worker cache, see sw.js). Otherwise trying would only end in
      // a timeout — say so and use a device voice straight away.
      const token = speakToken;
      neuralReadyOffline(piperVoice(lang).id).then(ready => {
        if (token !== speakToken) return;
        if (ready) { tryNeural(); return; }
        if (options.onFallback) options.onFallback({ reason: 'offline' });
        readWithDeviceVoice();
      });
    }
  }

  // Must match ENGINE_CACHE in sw.js.
  const ENGINE_CACHE = 'slr-voice-engine-v1';

  async function neuralReadyOffline(voiceId) {
    try {
      if (!window.caches) return false;
      const stored = await storedVoices();
      if (!stored.includes(voiceId)) return false;
      const keys = await (await caches.open(ENGINE_CACHE)).keys();
      const urls = keys.map(k => k.url);
      return urls.some(u => /ort-wasm[^/]*\.wasm$/.test(u))
        && urls.some(u => /piper_phonemize\.wasm$/.test(u))
        && urls.some(u => /piper_phonemize\.data$/.test(u));
    } catch (e) {
      return false;
    }
  }

  // Toast text for a fallback, shared by every caller.
  function fallbackMessage(info) {
    return info && info.reason === 'offline'
      ? 'Offline — this natural voice has not been used online yet. Reading with a device voice.'
      : 'Natural voice could not be loaded — reading with a device voice.';
  }

  function toggle(text, opts) {
    // Own flag only: on iOS the engine can report speaking/pending for a while
    // after a read that never started, and the next tap must then read, not stop.
    if (speaking) { stop(); return false; }
    speak(text, opts);
    return true;
  }

  // ── Stored neural voices ──────────────────────────────────────────
  async function storedVoices() {
    try { return await (await piperModule()).stored(); } catch (e) { return []; }
  }

  async function downloadVoices(onStatus) {
    const mod = await piperModule();
    for (const lang of ['de', 'en']) {
      const id = piperVoice(lang).id;
      if ((await storedVoices()).includes(id)) continue;
      if (onStatus) onStatus(`Downloading ${voiceLabel(id)}…`);
      await mod.download(id, p => {
        if (onStatus && p && p.total) {
          onStatus(`Downloading ${voiceLabel(id)}… ${Math.round((p.loaded / p.total) * 100)}%`);
        }
      });
    }
  }

  // The library deletes via FileSystemHandle.remove(), which is not
  // standardised, fails in several browsers and is only console-logged when
  // it does. removeEntry() on the parent directory is the standard way — and
  // afterwards we look, rather than claim.
  async function removeVoices() {
    stop();
    await resetSession();
    assets.models.clear();
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('piper', { recursive: true });
    } catch (e) {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('piper');
        const names = [];
        for await (const name of dir.keys()) names.push(name);
        for (const name of names) await dir.removeEntry(name).catch(() => {});
        await root.removeEntry('piper', { recursive: true }).catch(() => {});
      } catch (e2) { console.warn('Could not remove stored voices:', e2); }
    }
    return await storedVoices();
  }

  return {
    getSettings, set,
    detectLang, splitIntoChunks, systemChunkLimit, isGoogleNetworkVoice,
    loadVoices, voicesForLang, voiceQualityScore, isNatural, pickSystemVoice, refreshVoices, onVoicesChanged, IOS,
    PIPER_VOICES, voiceKey, piperVoice, voiceLabel,
    NEURAL_REMOTE_HOSTS, fallbackMessage,
    speak, toggle, stop, isSpeaking, onStateChange, resetSession,
    storedVoices, downloadVoices, removeVoices,
  };

})();
