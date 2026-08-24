/**
 * SLR Harvester Web — Read Aloud (Text-to-Speech)
 *
 * Two engines behind one interface:
 *
 *   'system' — the device's own voices (Web Speech API). Instant, no
 *              download, works everywhere including iPhone. Quality depends
 *              entirely on what the device ships.
 *   'neural' — Piper, a neural TTS model running fully inside the browser
 *              (ONNX/WASM). Markedly more natural; costs a one-time ~63 MB
 *              download per language, then kept offline. No account, no
 *              server, nothing leaves the device.
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
  // actually sound better. The device engine gets much shorter ones: Chrome
  // stops speaking after roughly 15 seconds, and staying well under that is
  // what makes the workaround below unnecessary.
  const MAX_CHUNK = 180;
  const MAX_CHUNK_SYSTEM = 110;

  // ── Settings ──────────────────────────────────────────────────────
  const DEFAULTS = {
    engine: 'system',
    rate: 1,
    voices: { de: '', en: '' },                                  // system voice URIs
    piper: { de: 'de_DE-thorsten-medium', en: 'en_US-hfc_female-medium' },
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
  function splitIntoChunks(text, maxLen) {
    const limit = maxLen || MAX_CHUNK;
    const sentences = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?:;])\s+/);
    const chunks = [];
    let buf = '';
    for (const sentence of sentences) {
      let rest = sentence;
      while (rest.length > limit) {
        let cut = rest.lastIndexOf(',', limit);
        if (cut < 40) cut = rest.lastIndexOf(' ', limit);
        if (cut < 40) cut = limit;
        chunks.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1).trim();
      }
      if ((buf + ' ' + rest).trim().length > limit) {
        if (buf) chunks.push(buf.trim());
        buf = rest;
      } else {
        buf = (buf + ' ' + rest).trim();
      }
    }
    if (buf) chunks.push(buf.trim());
    return chunks.filter(Boolean);
  }

  // ── Engine 1: device voices ───────────────────────────────────────
  let availableVoices = [];

  function loadVoices() {
    if (window.speechSynthesis) availableVoices = window.speechSynthesis.getVoices() || [];
    return availableVoices;
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  // Not every system voice is equal: the neural online ones (Edge "Natural",
  // Google, Siri "Enhanced") are worlds apart from the legacy local engines
  // (SAPI "Desktop", eSpeak, "Compact"), which is exactly the difference
  // between "a voice" and "a robot".
  function voiceQualityScore(v) {
    const n = (v && v.name || '').toLowerCase();
    let score = 0;
    if (/natural|neural/.test(n))        score += 6;
    if (/siri|premium|enhanced/.test(n)) score += 5;
    if (/online/.test(n))                score += 4;
    if (/google/.test(n))                score += 4;
    if (v && v.localService === false)   score += 2;
    if (/compact/.test(n))               score -= 3;
    if (/desktop/.test(n))               score -= 4;
    if (/espeak|festival|pico/.test(n))  score -= 8;
    return score;
  }

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

  // One utterance at a time, chained on its own end event.
  //
  // The previous version queued every sentence at once and then pinged
  // pause()/resume() every nine seconds to defeat Chrome's ~15-second
  // cut-off. Both parts were wrong: Chrome drops entries from a queue that
  // is filled synchronously, and a pause() immediately followed by resume()
  // makes it abandon the utterance it is on and continue with the next —
  // which is exactly "every so often a whole sentence is missing", on any
  // voice. Speaking one short piece at a time removes the need for the
  // workaround entirely, because no single utterance gets near the cut-off.
  function speakSystem(chunks, lang, onDone, token) {
    const synth = window.speechSynthesis;
    if (!synth) { onDone(); return; }
    synth.cancel();
    clearTimeout(stallGuard);
    const voice = pickSystemVoice(lang);
    const rate = settings.rate || 1;
    let i = 0;

    const next = () => {
      if (token !== speakToken) return;            // stopped meanwhile
      if (i >= chunks.length) { onDone(); return; }
      const chunk = chunks[i++];
      const utt = new SpeechSynthesisUtterance(chunk);
      if (voice) { utt.voice = voice; utt.lang = voice.lang; }
      else utt.lang = lang === 'de' ? 'de-DE' : 'en-US';
      utt.rate = rate;

      let advanced = false;
      const advance = () => {
        if (advanced || token !== speakToken) return;
        advanced = true;
        clearTimeout(stallGuard);
        next();
      };

      utt.onend = advance;
      utt.onerror = e => {
        // A cancel/interrupt is our own doing (stop, or a new read) — the
        // chain must not continue in that case.
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        advance();
      };

      // Chrome occasionally swallows the end event outright. Without this the
      // reading would simply stop mid-abstract, so once the engine reports
      // itself idle we move on regardless.
      const expectedMs = Math.max(6000, (chunk.length / (13 * rate)) * 1000 + 4000);
      const armed = Date.now();
      const check = () => {
        if (advanced || token !== speakToken) return;
        if (synth.speaking || synth.pending) {
          // Still going — but if it has run far past any plausible duration,
          // the engine is wedged; cut it loose rather than hang forever.
          if (Date.now() - armed > expectedMs * 4) { synth.cancel(); advanced = false; advance(); return; }
          stallGuard = setTimeout(check, 1500);
          return;
        }
        advance();
      };
      stallGuard = setTimeout(check, expectedMs);

      synth.speak(utt);
    };

    next();
  }

  // ── Engine 2: Piper (neural, in-browser) ──────────────────────────
  const PIPER_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-tts-web.js';
  // The phonemizer is not under WASM_BASE (only .wasm/.data live there) — it
  // is a bundle chunk of the package, the same one the library imports.
  const PHONEMIZE_URL = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/dist/piper-o91UDS6e.js';

  // Only voices with the 256-symbol phoneme table. Piper widened that table
  // at some point and the bundled phonemizer emits ids from the new one, so
  // every older "low"/"x_low" voice aborts with "indices element out of data
  // bounds". Rule for additions: "medium" or "high" only, and speak once
  // before shipping it.
  //
  // The German female voices come from de_DE-mls-medium, a model trained on
  // 236 speakers; the voice is chosen by speaker id, not by a separate model,
  // so one download covers all of them. Ids come from the model's own
  // speaker map, gender and training volume from the MLS dataset metadata —
  // these four are the female speakers with the most material.
  const PIPER_VOICES = {
    de: [
      { id: 'de_DE-thorsten-medium',           label: 'Thorsten — male, clear (recommended)' },
      { id: 'de_DE-mls-medium', speaker: 2,    label: 'Marlene — female, most training data' },
      { id: 'de_DE-mls-medium', speaker: 4,    label: 'Ines — female' },
      { id: 'de_DE-mls-medium', speaker: 5,    label: 'Rieke — female' },
      { id: 'de_DE-mls-medium', speaker: 10,   label: 'Susanne — female' },
      { id: 'de_DE-thorsten_emotional-medium', label: 'Thorsten Expressive — male, livelier' },
      { id: 'de_DE-thorsten-high',             label: 'Thorsten HD — male, finest detail' },
    ],
    en: [
      { id: 'en_US-hfc_female-medium',            label: 'HFC — female, clear (recommended)' },
      { id: 'en_US-amy-medium',                   label: 'Amy — female' },
      { id: 'en_US-lessac-medium',                label: 'Lessac — female, neutral' },
      { id: 'en_GB-alba-medium',                  label: 'Alba — female, British' },
      { id: 'en_US-hfc_male-medium',              label: 'HFC — male' },
      { id: 'en_US-ryan-medium',                  label: 'Ryan — male' },
      { id: 'en_GB-northern_english_male-medium', label: 'Northern English — male, British' },
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

    if (settings.engine === 'neural') {
      speakPiper(chunks, lang, done, options.onProgress).catch(async err => {
        // Model could not be loaded (offline, CDN blocked, no WASM): read it
        // with a device voice rather than not at all.
        console.warn('Neural voice unavailable, falling back to a device voice:', err);
        await resetSession();
        if (options.onFallback) options.onFallback(err);
        speakSystem(splitIntoChunks(text, MAX_CHUNK_SYSTEM), lang, done, speakToken);
      });
    } else {
      speakSystem(splitIntoChunks(text, MAX_CHUNK_SYSTEM), lang, done, speakToken);
    }
  }

  function toggle(text, opts) {
    if (isSpeaking()) { stop(); return false; }
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
    detectLang, splitIntoChunks,
    loadVoices, voicesForLang, voiceQualityScore, pickSystemVoice,
    PIPER_VOICES, voiceKey, piperVoice, voiceLabel,
    speak, toggle, stop, isSpeaking, onStateChange, resetSession,
    storedVoices, downloadVoices, removeVoices,
  };

})();
