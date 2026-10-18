/**
 * SLR Harvester Web - Dictations & Notes
 * Voice dictations (recorded in the browser, transcribed with Whisper) and plain
 * notes: a place to keep spoken or written thoughts about a project, a kind of
 * research diary. Whisper runs ON THE DEVICE by default (vendored Transformers.js
 * in a worker, no key, audio never leaves the browser); OpenAI's Whisper API is
 * an optional second engine for users who bring their own key.
 *
 * Storage follows the active workspace, like projects do:
 *   - local folder: notes.json + notes-audio/<id>.<ext> in the workspace root
 *   - Cloud Sync:   table public.dictations + private bucket "dictations"
 *                   (one-time SQL, see the project owner's setup notes)
 *
 * Engine, model and the optional OpenAI key stay in this browser's localStorage
 * (slr-stt-*, slr-openai-key), never in the workspace or in Supabase. With the
 * OpenAI engine, audio leaves the device only when it is transcribed, and then
 * goes to api.openai.com only. Settings > Dictations edits these values.
 *
 * Global: window.SLRNotes
 */

window.SLRNotes = (() => {

  const KEY_OPENAI = 'slr-openai-key';
  const MAX_AUDIO = 24 * 1024 * 1024;           // OpenAI accepts 25 MB per file
  const MAX_S = 900;                            // longest recording: 15 minutes
  const LANGS = [['auto', 'Automatic'], ['de', 'Deutsch'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['hr', 'Hrvatski']];
  const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const toast = (m, err) => { try { SLRApp.showToast(m, !!err); } catch (_) { /* no toast available */ } };
  const getKey = () => { try { return localStorage.getItem(KEY_OPENAI) || ''; } catch (_) { return ''; } };
  // ── Transcription settings ────────────────────────────────────────────────
  const MODELS = [
    ['tiny', 'Xenova/whisper-tiny', 'Tiny', '≈ 40 MB', 'fastest, rough on difficult audio'],
    ['base', 'Xenova/whisper-base', 'Base', '≈ 80 MB', 'good balance (default)'],
    ['small', 'Xenova/whisper-small', 'Small', '≈ 250 MB', 'most accurate, slowest'],
  ];
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* blocked */ } };
  function config() {
    const m = lsGet('slr-stt-model');
    return {
      engine: lsGet('slr-stt-engine') === 'openai' ? 'openai' : 'device',
      model: MODELS.some(x => x[0] === m) ? m : 'base',
      auto: lsGet('slr-stt-auto') !== '0',
      key: getKey(),
    };
  }
  function setConfig(p) {
    if ('engine' in p) lsSet('slr-stt-engine', p.engine === 'openai' ? 'openai' : null);
    if ('model' in p) lsSet('slr-stt-model', p.model === 'base' ? null : p.model);
    if ('auto' in p) lsSet('slr-stt-auto', p.auto ? null : '0');
    if ('key' in p) lsSet(KEY_OPENAI, p.key ? p.key : null);
  }
  const deviceOK = () => !!(window.Worker && (window.AudioContext || window.webkitAudioContext));
  const canTranscribe = () => { const c = config(); return c.engine === 'openai' ? !!c.key : deviceOK(); };
  const engineLabel = () => { const c = config(); return c.engine === 'openai' ? 'OpenAI Whisper' : 'Whisper ' + (MODELS.find(m => m[0] === c.model) || MODELS[1])[2] + ' on this device'; };

  const fmtDur = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const extOf = m => /mp4|m4a|aac/.test(m || '') ? 'm4a' : /ogg/.test(m || '') ? 'ogg' : /mpeg|mp3/.test(m || '') ? 'mp3' : /wav/.test(m || '') ? 'wav' : 'webm';
  const normS = t => String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // ── Storage: local folder ─────────────────────────────────────────────────
  const isCloud = () => SLRData.getBackend() === 'cloud';
  const ready = () => isCloud() ? !!SLRDataCloud.currentUser() : !!(window.SLRDataLocal && SLRDataLocal.hasWorkspace());

  async function localRead() {
    const root = SLRDataLocal.rootHandle;
    try {
      const fh = await root.getFileHandle('notes.json');
      const j = JSON.parse(await (await fh.getFile()).text());
      return (Array.isArray(j.notes) ? j.notes : []).map(n => Object.assign({ tags: [], deleted: '' }, n));
    } catch (_) { return []; }
  }
  async function localWrite(list) {
    if (!(await SLRDataLocal.ensureWriteAccess())) throw new Error('No write access to the workspace folder.');
    const fh = await SLRDataLocal.rootHandle.getFileHandle('notes.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 2, notes: list }, null, 2));
    await w.close();
  }
  async function localAudioDir(create) {
    return SLRDataLocal.rootHandle.getDirectoryHandle('notes-audio', { create: !!create });
  }

  // ── Storage: cloud ────────────────────────────────────────────────────────
  const cloudSession = () => SLRDataCloud.session();
  const toNote = r => ({
    id: r.id, title: r.title || '', text: r.body || '', lang: r.lang || 'auto', dur: r.duration_s || 0,
    folder: r.folder || '', tags: Array.isArray(r.tags) ? r.tags : [], fav: !!r.favorite,
    audio: !!r.audio_path, audioPath: r.audio_path || '', audioType: r.audio_type || '',
    deleted: r.deleted_at || '', created: r.created, modified: r.modified,
  });
  const toRow = (n, userId) => ({
    id: n.id, user_id: userId, title: n.title, body: n.text, lang: n.lang, duration_s: Math.round(n.dur || 0),
    folder: n.folder || '', tags: n.tags || [], favorite: !!n.fav, audio_path: n.audioPath || null, audio_type: n.audioType || null,
    deleted_at: n.deleted || null, created: n.created, modified: n.modified,
  });

  // ── Storage: one surface for both ─────────────────────────────────────────
  async function loadAll() {
    if (isCloud()) {
      const { client } = cloudSession();
      const { data, error } = await client.from('dictations').select('*').order('created', { ascending: false });
      if (error) throw error;
      return (data || []).map(toNote);
    }
    const list = await localRead();
    return list.sort((a, b) => String(b.created).localeCompare(String(a.created)));
  }

  async function putNote(n) {
    n.modified = new Date().toISOString();
    if (isCloud()) {
      const { client, user } = cloudSession();
      const { error } = await client.from('dictations').upsert(toRow(n, user.id), { onConflict: 'id' });
      if (error) throw error;
      return;
    }
    const list = await localRead();
    const i = list.findIndex(x => x.id === n.id);
    const plain = { ...n }; delete plain.audioPath;
    if (i >= 0) list[i] = plain; else list.push(plain);
    await localWrite(list);
  }

  async function putAudio(n, blob) {
    if (isCloud()) {
      const { client, user } = cloudSession();
      const path = `${user.id}/${n.id}.${extOf(blob.type)}`;
      const { error } = await client.storage.from('dictations').upload(path, blob, { contentType: blob.type || 'audio/webm', upsert: true });
      if (error) throw error;
      n.audioPath = path; n.audioType = blob.type; n.audio = true;
      return;
    }
    const dir = await localAudioDir(true);
    const name = `${n.id}.${extOf(blob.type)}`;
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob); await w.close();
    n.audioPath = name; n.audioType = blob.type; n.audio = true;
  }

  async function getAudio(n) {
    if (isCloud()) {
      const { client } = cloudSession();
      const { data, error } = await client.storage.from('dictations').download(n.audioPath);
      if (error) throw error;
      return data;
    }
    const dir = await localAudioDir(false);
    const fh = await dir.getFileHandle(n.audioPath || `${n.id}.${extOf(n.audioType)}`);
    return fh.getFile();
  }

  async function dropAudio(n) {
    try {
      if (isCloud()) { if (n.audioPath) await cloudSession().client.storage.from('dictations').remove([n.audioPath]); }
      else { const dir = await localAudioDir(false); await dir.removeEntry(n.audioPath || `${n.id}.${extOf(n.audioType)}`); }
    } catch (_) { /* file already gone */ }
    n.audio = false; n.audioPath = ''; n.audioType = '';
  }

  async function dropNote(n) {
    if (n.audio) await dropAudio(n);
    if (isCloud()) {
      const { client } = cloudSession();
      const { error } = await client.from('dictations').delete().eq('id', n.id);
      if (error) throw error;
      return;
    }
    await localWrite((await localRead()).filter(x => x.id !== n.id));
  }

  // ── Whisper: OpenAI (own key) ─────────────────────────────────────────────
  async function openaiTranscribe(blob, lang) {
    const key = getKey();
    if (!key) throw new Error('No OpenAI key set. Add it in Settings > Dictations, or switch to transcription on this device.');
    if (blob.size > MAX_AUDIO) throw new Error('This recording is larger than 24 MB, the limit of the transcription service.');
    const fd = new FormData();
    fd.append('file', blob, 'dictation.' + extOf(blob.type));
    fd.append('model', 'whisper-1');
    if (lang && lang !== 'auto') fd.append('language', lang);
    fd.append('response_format', 'json');
    let r;
    try { r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd }); }
    catch (e) { throw new Error('Could not reach the transcription service (offline or blocked).'); }
    if (!r.ok) {
      let m = ''; try { m = (await r.json()).error.message; } catch (_) { /* no body */ }
      throw new Error(`Transcription failed (${r.status})${m ? ': ' + m : ''}`);
    }
    return ((await r.json()).text || '').trim();
  }

  // ── Whisper: on this device (js/whisper-worker.js) ────────────────────────
  let worker = null, loadedModel = '';

  async function decode16k(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ac = new Ctx();
    let buf;
    try { buf = await ac.decodeAudioData(await blob.arrayBuffer()); }
    catch (_) { throw new Error('This recording could not be decoded by the browser.'); }
    finally { try { ac.close(); } catch (_) { /* ignore */ } }
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    return (await off.startRendering()).getChannelData(0);
  }

  function workerCall(msg, onMessage) {
    return new Promise((resolve, reject) => {
      if (!worker) {
        try { worker = new Worker('js/whisper-worker.js', { type: 'module' }); }
        catch (e) { reject(new Error('This browser cannot run the on-device speech engine.')); return; }
      }
      const w = worker;
      w.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress') { if (onMessage) onMessage(m.p); return; }
        if (m.type === 'error') { reject(new Error(m.message)); return; }
        resolve(m);
      };
      w.onerror = e => { worker = null; loadedModel = ''; reject(new Error('The on-device speech engine failed to start' + (e && e.message ? ': ' + e.message : '') + '.')); };
      w.postMessage(msg);
    });
  }

  async function ensureModel(setStatus) {
    const c = config();
    const m = MODELS.find(x => x[0] === c.model) || MODELS[1];
    if (worker && loadedModel === m[1]) return;
    const files = {};
    setStatus('Preparing the speech engine …');
    await workerCall({ type: 'load', model: m[1] }, p => {
      if (p.status === 'progress' && p.file && p.total) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total };
        const all = Object.values(files);
        const tot = all.reduce((x, f) => x + f.total, 0), got = all.reduce((x, f) => x + f.loaded, 0);
        setStatus(`Downloading the speech model (${m[2]}, ${m[3]}) … ${tot ? Math.round(100 * got / tot) : 0} %`);
      } else if (p.status === 'ready') setStatus('Loading the speech model …');
    });
    loadedModel = m[1];
    lsSet('slr-stt-ok-' + m[0], '1');
  }

  async function deviceTranscribe(blob, lang, setStatus) {
    setStatus('Reading the recording …');
    const audio = await decode16k(blob);
    await ensureModel(setStatus);
    setStatus('Transcribing … (runs on this device; long recordings take a while)');
    const lc = lang && lang !== 'auto' ? ({ de: 'german', en: 'english', es: 'spanish', fr: 'french', it: 'italian', hr: 'croatian' })[lang] || null : null;
    const r = await workerCall({ type: 'run', audio, language: lc }, null);
    return r.text || '';
  }

  // One entry for both engines. The first run of a model on this device asks
  // before it downloads anything.
  async function transcribe(blob, lang, setStatus) {
    const c = config();
    if (c.engine === 'openai') { setStatus('Sending the audio to OpenAI …'); return openaiTranscribe(blob, lang); }
    const m = MODELS.find(x => x[0] === c.model) || MODELS[1];
    if (!lsGet('slr-stt-ok-' + m[0]) && !(worker && loadedModel === m[1])) {
      const ok = await SLRViews.confirmDialog({
        title: 'Download the speech model?',
        message: `Transcription runs on this device. The first time, the speech engine (about 21 MB) and the ${m[2]} model (${m[3]}) are downloaded and kept in this browser; after that it works offline. Nothing you record is uploaded. You can change the model or switch to OpenAI in Settings.`,
        confirmLabel: 'Download and transcribe',
      });
      if (!ok) throw new Error('Cancelled. Press Transcribe when you want to download the model.');
    }
    return deviceTranscribe(blob, lang, setStatus);
  }


  // ══ The Dictations page ══════════════════════════════════════════════════════
  // Record (or upload) -> check the text -> save; list with search, sort, cards or
  // list view, type / folder / tag filters, favourites, trash, continue dictating,
  // read aloud, plain-text export. D keeps everything, so a running recording or an
  // unsaved result survives a change of view.
  const D = {
    list: null, loading: false, error: '',
    q: '', folder: '*', tag: '', kind: '*',
    view: lsGet('slr-dik-view') === 'list' ? 'list' : 'cards',
    sort: lsGet('slr-dik-sort') || 'new',
    lang: lsGet('slr-dik-lang') || 'auto',
    rec: null, res: null, cont: null, edit: null, draft: null,
    open: new Set(), playing: null, trash: false,
    urls: {}, status: '', container: null, owner: undefined,
  };
  const LANG_OK = new Set(LANGS.map(l => l[0]));
  const langName = k => (LANGS.find(l => l[0] === k) || [0, k || ''])[1];

  // "Recently used": when an entry was last played, opened, copied, exported or edited.
  // Kept on this device only (not in the workspace).
  let usedMap = {};
  try { usedMap = JSON.parse(lsGet('slr-dik-used') || '{}') || {}; } catch (_) { usedMap = {}; }
  function markUsed(id) {
    usedMap[id] = Date.now();
    if (D.list) { const ids = new Set(D.list.map(d => d.id)); Object.keys(usedMap).forEach(k => { if (!ids.has(k)) delete usedMap[k]; }); }
    lsSet('slr-dik-used', JSON.stringify(usedMap));
  }
  const lastUsed = d => usedMap[d.id] || Date.parse(d.created) || 0;

  const active = () => (D.list || []).filter(d => !d.deleted);
  const inTrash = () => (D.list || []).filter(d => d.deleted);
  const busy = () => !!(D.rec || D.res || D.cont || (D.edit && D.draft));
  window.addEventListener('beforeunload', e => { if (busy()) { e.preventDefault(); e.returnValue = ''; } });

  // ── Markdown characters in notes (###, **bold**, --, `code`, links) ────────
  const MD_HAS = /^[ \t]*#{1,6}(\s|$)|\*\*|__|~~|^[ \t]*(?:[-*_=][ \t]*){2,}$|`|!?\[[^\]]+\]\([^)]*\)|^[ \t]*>|^[ \t]*[-*+•][ \t]+\S|(^|[\s(])\*\S[^*\n]*\S\*($|[\s).,;:!?])/m;
  const mdHas = s => MD_HAS.test(String(s || ''));
  function mdPlain(t) {
    return String(t || '').replace(/\r\n?/g, '\n')
      .replace(/^[ \t]*(?:[-*_=][ \t]*){2,}$/gm, '')
      .replace(/^[ \t]*#{1,6}[ \t]*(.*)$/gm, (m, x) => x.trim() ? '\n' + x + '\n' : '')
      .replace(/^[ \t]*>+[ \t]?/gm, '')
      .replace(/^[ \t]*[-*+•][ \t]+/gm, '')
      .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1')
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?])/gm, '$1$2')
      .replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,;:!?])/gm, '$1$2')
      .replace(/~~([^~]+)~~/g, '$1').replace(/`+([^`]*)`+/g, '$1')
      .replace(/\*\*|__/g, '')
      .replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  function mdHTML(t) {
    const inl = s => esc(s).replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1').replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<b>$2</b>').replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?])/g, '$1<i>$2</i>').replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,;:!?])/g, '$1<i>$2</i>').replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/`+([^`]*)`+/g, '<code>$1</code>');
    const out = []; let m;
    for (const z of String(t || '').replace(/\r\n?/g, '\n').split('\n')) {
      if (/^[ \t]*(?:[-*_=][ \t]*){2,}$/.test(z)) out.push({ s: '<span class="mdhr"></span>', b: 1 });
      else if ((m = /^[ \t]*(#{1,6})[ \t]*(.*)$/.exec(z))) { if (m[2].trim()) out.push({ s: `<span class="mdh mdh${Math.min(m[1].length, 3)}">${inl(m[2])}</span>`, b: 1 }); }
      else if ((m = /^[ \t]*[-*+•][ \t]+(.*)$/.exec(z))) out.push({ s: '• ' + inl(m[1]) });
      else if ((m = /^[ \t]*>+[ \t]?(.*)$/.exec(z))) out.push({ s: '<i>' + inl(m[1]) + '</i>' });
      else out.push({ s: inl(z) });
    }
    return out.map((o, i) => o.s + (o.b || i === out.length - 1 ? '' : '\n')).join('');
  }

  const autoTitle = (text, kind) => {
    const w = String(text || '').trim().split(/\s+/).filter(Boolean);
    return w.length ? w.slice(0, 7).join(' ').slice(0, 60) + (w.length > 7 ? ' …' : '') : kind + ' ' + new Date().toLocaleDateString('en-GB');
  };
  const splitTags = s => String(s || '').split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);
  const setStatus = t => { D.status = t; const el = document.getElementById('dikStatus'); if (el) el.textContent = t; };

  // ── Recording ─────────────────────────────────────────────────────────────
  async function recStart(target) {
    if (D.rec || D.res || D.cont) return;
    if (!window.MediaRecorder || !navigator.mediaDevices) { toast('This browser cannot record audio.', true); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { toast(e.name === 'NotAllowedError' ? 'No access to the microphone: please allow it in the address bar.' : 'Microphone unavailable: ' + (e.message || e.name), true); return; }
    const mime = MIMES.find(m => MediaRecorder.isTypeSupported(m));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : {});
    const r = D.rec = { stream, mr, chunks: [], t0: Date.now(), mime: mr.mimeType || mime || 'audio/webm', discard: false, ctx: null, an: null, data: null, target: target || null, timer: 0 };
    mr.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data); };
    mr.onstop = () => recEnd(r);
    try { const AC = window.AudioContext || window.webkitAudioContext; r.ctx = new AC(); r.an = r.ctx.createAnalyser(); r.an.fftSize = 512; r.ctx.createMediaStreamSource(stream).connect(r.an); r.data = new Uint8Array(r.an.fftSize); } catch (_) { r.an = null; }
    mr.start(1000); r.timer = setInterval(recTick, 150);
    drawRec(); if (r.target) drawList();
  }
  function recTick() {
    const r = D.rec; if (!r) return;
    const s = (Date.now() - r.t0) / 1000, z = document.getElementById('dikTime'); if (z) z.textContent = fmtDur(s);
    const p = document.getElementById('dikLevel');
    if (p && r.an) { r.an.getByteTimeDomainData(r.data); let m = 0; for (const v of r.data) m = Math.max(m, Math.abs(v - 128)); p.style.width = Math.min(100, Math.round(m / 128 * 160)) + '%'; }
    if (s >= MAX_S) recStop();
  }
  function recStop(discard) {
    const r = D.rec; if (!r) return;
    r.discard = !!discard; clearInterval(r.timer);
    if (r.mr.state !== 'inactive') r.mr.stop();
    r.stream.getTracks().forEach(t => t.stop());
    if (r.ctx) r.ctx.close().catch(() => { });
  }
  function recEnd(r) {
    D.rec = null;
    if (r.discard || !r.chunks.length) { drawRec(); if (r.target) drawList(); return; }
    const blob = new Blob(r.chunks, { type: r.mime });
    if (r.target) { continueRecognise(blob, r.target); return; }
    openResult(blob, Math.round((Date.now() - r.t0) / 1000));
  }
  function loadFile(f) {
    if (!f) return;
    if (D.rec || D.res || D.cont) { toast('Finish or discard the current recording first.', true); return; }
    const a = new Audio(), url = URL.createObjectURL(f); a.preload = 'metadata';
    const go = d => { URL.revokeObjectURL(url); openResult(f, Math.round(d || 0)); };
    a.onloadedmetadata = () => go(a.duration); a.onerror = () => go(0);
  }

  // ── Result of a recording ─────────────────────────────────────────────────
  function openResult(blob, dur, lang) {
    const old = D.res; if (old && old.url) URL.revokeObjectURL(old.url);
    D.res = {
      blob, type: (blob.type || 'audio/webm').split(';')[0].toLowerCase(), url: URL.createObjectURL(blob), dur,
      status: 'ready', lang: lang || D.lang, text: old ? old.text : '', title: old ? old.title : '', folder: old ? old.folder : '', tags: old ? old.tags : '',
      keep: old ? old.keep : true, error: '', saving: false,
    };
    drawRec(); drawResult();
    const c = config();
    if (c.auto && canTranscribe() && (c.engine === 'openai' || lsGet('slr-stt-ok-' + c.model))) recognise();
  }
  async function recognise(lang) {
    const g = D.res; if (!g || g.status === 'busy') return;
    if (lang) g.lang = lang;
    readResultFields();
    g.status = 'busy'; g.error = ''; setStatus('Starting …'); drawRec(); drawResult();
    try {
      if (g.blob.size > 60 * 1024 * 1024) throw new Error('This file is too large (more than about 60 MB).');
      const text = await transcribe(g.blob, g.lang, setStatus);
      if (D.res !== g) return;
      g.text = text; g.status = 'ready';
      if (!g.title) g.title = autoTitle(text, 'Dictation');
      if (!text) g.error = 'No speech was recognised. You can pick the language and transcribe again, or type the text yourself.';
    } catch (e) { if (D.res !== g) return; g.status = 'ready'; g.error = e.message || String(e); }
    drawRec(); drawResult();
  }
  function readResultFields() {
    const g = D.res; if (!g) return;
    const v = id => { const e = document.getElementById(id); return e ? e.value : null; };
    const t = v('dikTitle'), x = v('dikText'), f = v('dikFolder'), tg = v('dikTags'), k = document.getElementById('dikKeep');
    if (t !== null) g.title = t; if (x !== null) g.text = x; if (f !== null) g.folder = f; if (tg !== null) g.tags = tg; if (k) g.keep = k.checked;
  }
  async function saveResult() {
    const g = D.res; if (!g || g.status === 'busy' || g.saving) return;
    readResultFields();
    g.saving = true; drawResult();
    const now = new Date().toISOString();
    const n = { id: uid(), title: g.title.trim() || autoTitle(g.text, 'Dictation'), text: g.text, lang: LANG_OK.has(g.lang) ? g.lang : 'auto', dur: g.dur, folder: (g.folder || '').trim(), tags: splitTags(g.tags), fav: false, audio: false, audioPath: '', audioType: '', deleted: '', created: now, modified: now };
    try {
      if (g.keep) await putAudio(n, g.blob);
      await putNote(n);
      D.list.unshift(n); URL.revokeObjectURL(g.url); D.res = null;
      markUsed(n.id); toast('Dictation saved.');
      drawRec(); drawResult(); drawList();
    } catch (e) { g.saving = false; toast('Could not save: ' + (e.message || e), true); drawResult(); }
  }
  function discardResult() {
    const g = D.res; if (!g) return;
    readResultFields();
    if ((g.text || g.error) && !confirm('Discard the recording and its text?')) return;
    URL.revokeObjectURL(g.url); D.res = null; drawRec(); drawResult();
  }

  // ── Continue dictating: new recording inserted at the cursor of an entry ──
  function captureDraft() {
    const f = document.querySelector('.dik.bearb'), t = document.getElementById('dEdText');
    if (!f || !t || String(D.edit) !== f.dataset.id) return;
    const v = id => (document.getElementById(id) || {}).value || '';
    D.draft = { id: f.dataset.id, title: v('dEdTitle'), text: t.value, folder: v('dEdFolder'), tags: v('dEdTags'), s: t.selectionStart, e: t.selectionEnd, focus: document.activeElement === t };
  }
  async function contStart(id) {
    if (D.rec || D.res || D.cont) { toast('Finish or discard the current recording first.', true); return; }
    if (D.edit !== id) { D.edit = id; D.draft = null; drawList(); const t = document.getElementById('dEdText'); if (t) t.setSelectionRange(t.value.length, t.value.length); }
    captureDraft();
    const e = D.draft && D.draft.id === id ? D.draft : null;
    await recStart({ id, s: e ? e.s : 0, e: e ? e.e : 0 });
  }
  async function continueRecognise(blob, target) {
    D.cont = { id: target.id }; setStatus('Starting …'); drawRec(); drawList();
    let text = '', err = '';
    try { text = await transcribe(blob, D.lang, setStatus); } catch (e) { err = e.message || String(e); }
    D.cont = null;
    if (err || !text) { toast(err || 'No speech was recognised.', true); drawRec(); drawList(); return; }
    if (D.edit !== target.id || !D.draft || D.draft.id !== target.id) {
      const d = D.list.find(x => x.id === target.id);
      D.edit = target.id; D.draft = { id: target.id, title: d ? d.title : '', text: d ? d.text : '', folder: d ? d.folder : '', tags: d ? d.tags.join(', ') : '', s: target.s, e: target.e };
    }
    const en = D.draft, a = Math.min(target.s, en.text.length), b = Math.min(Math.max(target.e, a), en.text.length);
    const before = en.text.slice(0, a), after = en.text.slice(b), add = text.trim();
    const ins = (before && !/\s$/.test(before) ? ' ' : '') + add + (after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '');
    en.text = before + ins + after; en.s = en.e = before.length + ins.length; en.focus = true;
    skipCapture = true; drawRec(); drawList(); toast('Text inserted. Press Save to keep it.');
  }
  let skipCapture = false;

  // ── Drawing ───────────────────────────────────────────────────────────────
  const I = () => window.SLRIcons;
  const ib = (ic, text, attrs, cls) => `<button type="button" class="ibtn${cls ? ' ' + cls : ''}" title="${esc(text)}" aria-label="${esc(text)}" ${attrs || ''}>${I()[ic] || ''}</button>`;
  const langPick = (cur, attr, label) => `<label class="dik-sprw" title="${esc(label || 'Language of the recording')}">${I().globe}<select class="sel" ${attr} aria-label="${esc(label || 'Language of the recording')}">${LANGS.map(([k, t]) => `<option value="${k}"${cur === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const folders = () => [...new Set(active().map(d => d.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  function recHTML() {
    const r = D.rec, g = D.res;
    if (r) return `<div class="dik-recbox aktiv"><button type="button" class="dik-mic rec" data-dik="stop" aria-label="Stop recording">${I().mic}</button><div class="dik-info"><b id="dikTime">0:00</b><span class="muted">${r.target ? 'Continue-dictation is running: the text is inserted at the cursor. ' : 'Recording – '}tap to finish (at most ${MAX_S / 60} minutes)</span><div class="dik-pegel"><i id="dikLevel"></i></div></div><button type="button" class="btn" data-dik="discardrec">Discard</button></div>`;
    if (D.cont) return `<div class="dik-recbox"><button type="button" class="dik-mic" disabled aria-label="Record">${I().mic}</button><div class="dik-info"><b>Transcribing …</b><span class="muted" id="dikStatus">${esc(D.status)}</span></div></div>`;
    if (g) return `<div class="dik-recbox"><button type="button" class="dik-mic" disabled aria-label="Record">${I().mic}</button><div class="dik-info"><b>${g.status === 'busy' ? 'Transcribing …' : 'Recording ready'}</b><span class="muted">${fmtDur(g.dur || 0)} · check the result below and save it</span></div></div>`;
    return `<div class="dik-recbox"><button type="button" class="dik-mic" data-dik="start" aria-label="Start recording" title="Start recording">${I().mic}</button><div class="dik-info"><b>Record a dictation</b>${langPick(D.lang, 'data-dlang')}<span class="muted dik-eng">${esc(canTranscribe() ? engineLabel() : 'Transcription is off')} · <button type="button" class="link-btn" data-dik="settings">settings</button></span></div><div class="dik-rbtn"><label class="btn" title="Transcribe an existing recording (mp3, m4a, wav, webm …)">${I().upload}Audio file<input type="file" id="dikFile" accept="audio/*" hidden></label><button type="button" class="btn" data-dik="newnote" title="Write a note without a recording">${I().plus}Note</button></div></div>`;
  }
  function drawRec() { const e = document.getElementById('dikRec'); if (e) e.innerHTML = recHTML(); }

  function resultHTML() {
    const g = D.res; if (!g) return '';
    const head = `<h3>Result<span class="hint">${fmtDur(g.dur || 0)} · ${esc(langName(g.lang))}</span></h3><audio controls src="${esc(g.url)}" class="dik-audio"></audio>`;
    if (g.status === 'busy') return `<section class="settings-card dik-panel dik-erg">${head}<p class="dik-spinner"><span class="spin"></span><span id="dikStatus">${esc(D.status || 'Working …')}</span></p><div class="dik-edakt">${ib('close', 'Discard', 'data-dik="discardres"', 'cancel')}</div></section>`;
    const fl = folders();
    return `<section class="settings-card dik-panel dik-erg">${head}${g.error ? `<p class="err">${esc(g.error)}</p>` : ''}
      <label class="dik-f">Title<input id="dikTitle" type="text" maxlength="140" value="${esc(g.title)}"></label>
      <label class="dik-f">Text<textarea id="dikText" rows="9" spellcheck="true">${esc(g.text)}</textarea></label>
      <div class="dik-zeile"><label class="dik-f">Folder<input id="dikFolder" type="text" list="dikFolderList" maxlength="60" placeholder="no folder" value="${esc(g.folder)}"><datalist id="dikFolderList">${fl.map(o => `<option value="${esc(o)}">`).join('')}</datalist></label>
        <label class="dik-f">Keywords (comma separated)<input id="dikTags" type="text" maxlength="200" placeholder="e.g. idea, methods" value="${esc(g.tags)}"></label></div>
      <label class="dik-chk"><input id="dikKeep" type="checkbox"${g.keep ? ' checked' : ''}> Keep the audio file too</label>
      <div class="dik-edakt">${g.saving ? '<span class="muted">Saving …</span>' : `${ib('check', 'Save', 'data-dik="saveres"', 'save')}${ib('close', 'Discard', 'data-dik="discardres"', 'cancel')}${ib('eraser', 'Remove formatting characters from the text (#, **, --, …)', 'data-dik="mdclean"', 'md')}${canTranscribe() ? ib('refresh', g.text ? 'Transcribe again' : 'Transcribe', 'data-dik="transcribe"', 'weiter') : ''}<span class="grow"></span>${langPick(g.lang, 'data-drelang', 'Transcribe again as …')}`}</div></section>`;
  }
  function drawResult() { const e = document.getElementById('dikErg'); if (e) { e.innerHTML = resultHTML(); e.hidden = !D.res; } }

  function visible() {
    const q = normS(D.q || '');
    const hit = d => !q || normS([d.title, d.text, d.folder, d.tags.join(' ')].join(' ')).includes(q);
    if (D.trash) return inTrash().filter(hit).sort((a, b) => String(b.deleted).localeCompare(String(a.deleted)));
    const l = active().filter(d => (D.kind === '*' || (D.kind === 'note') === !d.audio) && (D.folder === '*' || (D.folder === '' ? !d.folder : d.folder === D.folder)) && (!D.tag || d.tags.includes(D.tag)) && hit(d));
    const f = {
      new: (a, b) => String(b.created).localeCompare(String(a.created)),
      old: (a, b) => String(a.created).localeCompare(String(b.created)),
      title: (a, b) => a.title.localeCompare(b.title),
      long: (a, b) => b.dur - a.dur,
      used: (a, b) => lastUsed(b) - lastUsed(a),
    }[D.sort] || (() => 0);
    return l.sort((a, b) => (b.fav - a.fav) || f(a, b));
  }

  function chipsHTML() {
    const nTrash = inTrash().length;
    const trashBtn = `<button type="button" class="${D.trash ? 'btn sm' : 'ibtn dik-ai'} dik-pk" data-dik="trash" aria-pressed="${D.trash}" title="${D.trash ? 'Back to dictations and notes' : 'Trash: deleted dictations and notes'}" aria-label="${D.trash ? 'Back to dictations and notes' : 'Trash'}">${D.trash ? I().restore : I().trash}${D.trash ? 'Back to dictations &amp; notes' : `<span class="num">${nTrash}</span>`}</button>`;
    if (D.trash) return `<div class="dik-crow">${trashBtn}${nTrash ? ib('trash', 'Empty the trash', 'data-dik="emptytrash"', 'danger') : ''}</div>`;
    const act = active(), fl = folders(), tags = [...new Set(act.flatMap(d => d.tags))].sort((a, b) => a.localeCompare(b));
    const n = o => act.filter(d => o === '*' ? true : o === '' ? !d.folder : d.folder === o).length;
    const chip = (o, t, ic) => `<button type="button" class="dik-ord" data-dfolder="${esc(o)}" aria-pressed="${D.folder === o}">${ic ? I()[ic] : ''}${esc(t)} <span class="num">${n(o)}</span></button>`;
    const nk = k => act.filter(d => k === '*' ? true : (k === 'note') === !d.audio).length;
    const kind = (k, t, ic) => `<button type="button" class="ibtn dik-ai" data-dkind="${k}" aria-pressed="${D.kind === k}" title="${t}" aria-label="${t}">${I()[ic]}<span class="num">${nk(k)}</span></button>`;
    return `<div class="dik-crow"><div class="dik-arts" role="group" aria-label="Type">${kind('*', 'All', 'layers')}${kind('dictation', 'Dictations', 'mic')}${kind('note', 'Notes', 'docOther')}</div>${trashBtn}</div>
      <div class="dik-crow dik-ordnerzeile" role="group" aria-label="Folders">${chip('*', 'All folders', '')}${chip('', 'No folder', '')}${fl.map(o => chip(o, o, 'folder')).join('')}${D.folder && D.folder !== '*' ? ib('pencil', 'Rename this folder', 'data-dik="renamefolder"') : ''}</div>
      ${tags.length ? `<div class="dik-crow dik-tagzeile" role="group" aria-label="Keywords">${tags.map(tg => `<button type="button" class="dik-tag" data-dtag="${esc(tg)}" aria-pressed="${D.tag === tg}">#${esc(tg)}</button>`).join('')}</div>` : ''}`;
  }

  function editHTML(d, isNew) {
    const id = isNew ? 'new' : d.id;
    const e = D.draft && D.draft.id === id ? D.draft : { title: d.title, text: d.text, folder: d.folder, tags: (d.tags || []).join(', ') };
    const rec = D.rec && D.rec.target && D.rec.target.id === id, recognising = D.cont && D.cont.id === id;
    const cont = rec ? ib('stop', 'Stop recording and insert the text', 'data-dik="stop"', 'danger')
      : recognising ? `<span class="dik-spinner"><span class="spin"></span>Transcribing …</span>`
      : (canTranscribe() ? ib('micplus', 'Continue dictating: the text is inserted at the cursor (also mid-sentence; selected text is replaced)', `data-dik="cont" data-id="${id}"${D.rec || D.res || D.cont ? ' disabled' : ''}`, 'weiter') : '');
    return `<article class="dik bearb" data-id="${id}"><div class="dik-edit"><label class="dik-f">Title<input id="dEdTitle" type="text" maxlength="140" value="${esc(e.title)}" placeholder="${isNew ? 'Title of the note' : ''}"></label><label class="dik-f">Text<textarea id="dEdText" rows="${isNew ? 8 : 10}" spellcheck="true">${esc(e.text)}</textarea></label>
      <div class="dik-zeile"><label class="dik-f">Folder<input id="dEdFolder" type="text" list="dikFolderList2" maxlength="60" placeholder="no folder" value="${esc(e.folder)}"><datalist id="dikFolderList2">${folders().map(x => `<option value="${esc(x)}">`).join('')}</datalist></label><label class="dik-f">Keywords (comma separated)<input id="dEdTags" type="text" maxlength="200" placeholder="e.g. idea, methods" value="${esc(e.tags)}"></label></div>
      <div class="dik-edakt">${ib('check', 'Save', `data-dik="savedit" data-id="${id}"`, 'save')}${ib('close', 'Cancel', 'data-dik="canceledit"', 'cancel')}${ib('eraser', 'Remove formatting characters from the text (#, **, --, …)', 'data-dik="mdclean"', 'md')}${cont}</div></div></article>`;
  }

  function cardHTML(d) {
    if (D.edit === d.id) return editHTML(d, false);
    const open = D.open.has(d.id), note = !d.audio;
    const lg = d.lang && d.lang !== 'auto' ? d.lang.toUpperCase() : '';
    const meta = [d.deleted ? 'Deleted ' + fmtDate(d.deleted) : '', fmtDate(d.created), d.audio ? '🎙 ' + fmtDur(d.dur) : '', d.audio ? lg : '', d.folder ? '📁 ' + d.folder : '', ...d.tags.map(t => '#' + t)].filter(Boolean).map(esc).join(' · ');
    const IC = { more: open ? 'chevronUp' : 'chevronDown', play: D.playing === d.id ? 'stop' : 'play', copy: 'copy', txt: 'download', read: 'speaker', edit: 'pencil', cont: 'micplus', rmaudio: 'micoff', del: 'trash', restore: 'restore', mdweg: 'eraser' };
    const b = (a, t, cls) => ib(IC[a], t, `data-dik="${a}" data-id="${d.id}"`, cls);
    return `<article class="dik${note ? ' notiz' : ''}" data-id="${d.id}"><header><button type="button" class="dik-fav" data-dik="fav" data-id="${d.id}" aria-pressed="${d.fav}" title="Mark as important" aria-label="Important">★</button><div class="dik-kopf"><b>${esc(d.title || (note ? 'Note' : 'Dictation'))}${note ? ' <span class="dik-art">Note</span>' : ''}</b><small>${meta}</small></div></header>
      <p class="dik-text${open ? ' offen' : ''}">${d.text ? `<span class="mdw">${mdHTML(d.text)}</span>` : '<span class="muted">(no text)</span>'}</p>
      ${D.playing === d.id && D.urls[d.id] ? `<audio controls autoplay src="${esc(D.urls[d.id])}" class="dik-audio"></audio>` : D.playing === d.id ? '<p class="muted">Loading audio …</p>' : ''}
      <div class="row dik-akt">${d.text.length > 240 || d.text.includes('\n') ? b('more', open ? 'Less' : 'More') : ''}${d.audio ? b('play', D.playing === d.id ? 'Stop' : 'Play') : ''}${d.deleted
        ? `${b('copy', 'Copy')}${b('restore', 'Restore', 'ok')}${b('del', 'Delete for good', 'danger')}`
        : `${b('copy', 'Copy')}${b('txt', 'Save as .txt')}${d.text.trim() ? b('read', 'Read aloud') : ''}${b('edit', 'Edit')}${mdHas(d.text) ? b('mdweg', 'Remove formatting characters (#, **, --, …)', 'md') : ''}${canTranscribe() ? b('cont', 'Continue dictating (at the cursor)') : ''}${d.audio ? b('rmaudio', 'Delete the audio (the text stays)', 'danger') : ''}${b('del', 'Delete', 'danger')}`}</div></article>`;
  }

  function drawList() {
    const c = document.getElementById('dikChips'), l = document.getElementById('dikList'), t = document.getElementById('dikCount'); if (!l) return;
    if (skipCapture) skipCapture = false; else captureDraft();
    if (c) c.innerHTML = chipsHTML();
    const s = visible(), total = D.trash ? inTrash().length : active().length;
    if (t) t.textContent = `${s.length} of ${total}`;
    l.className = 'dik-listebox ' + D.view;
    const neu = D.edit === 'new' ? editHTML({ title: '', text: '', folder: D.folder && D.folder !== '*' ? D.folder : '', tags: D.tag ? [D.tag] : [] }, true) : '';
    l.innerHTML = neu + (D.error ? `<p class="err">${esc(D.error)}</p>` : D.list === null ? '<p class="muted">Loading …</p>' : s.length ? s.map(cardHTML).join('') : `<p class="empty">${D.trash ? (total ? 'Nothing found.' : 'The trash is empty.') : total ? 'Nothing found.' : 'No dictations or notes yet. Use the microphone above to record the first one, or write a note.'}</p>`);
    const en = D.draft && D.draft.id === D.edit ? D.draft : null;
    if (en && en.focus) { const ta = document.getElementById('dEdText'); if (ta) { ta.focus(); ta.setSelectionRange(en.s, en.e); } }
    else if (D.edit === 'new' && !en) { const ta = document.getElementById('dEdTitle'); if (ta && !ta.dataset.focus) { ta.dataset.focus = '1'; ta.focus(); } }
  }

  function pageHTML() {
    const sorts = [['new', 'Newest first'], ['old', 'Oldest first'], ['used', 'Recently used'], ['title', 'Title A–Z'], ['long', 'Longest first']];
    return `<div class="dik-view">
      <section class="settings-card dik-panel dik-rec" id="dikRec">${recHTML()}</section>
      <div id="dikErg"${D.res ? '' : ' hidden'}>${resultHTML()}</div>
      <section class="settings-card dik-panel dik-liste"><div class="toolbar"><input id="dikSearch" type="search" class="dik-suche" placeholder="Search dictations and notes …" aria-label="Search dictations and notes" value="${esc(D.q)}"><div class="dik-ctl"><span class="muted" id="dikCount"></span><select id="dikSort" class="sel" aria-label="Sort">${sorts.map(([k, t]) => `<option value="${k}"${D.sort === k ? ' selected' : ''}>${t}</option>`).join('')}</select><span class="segc" role="group" aria-label="View"><button type="button" data-dview="cards" aria-pressed="${D.view === 'cards'}" title="Show as cards" aria-label="Cards">${I().grid}<span class="dik-vt">Cards</span></button><button type="button" data-dview="list" aria-pressed="${D.view === 'list'}" title="Show as list" aria-label="List">${I().rows}<span class="dik-vt">List</span></button></span></div></div>
      <div class="dik-chips" id="dikChips"></div><div id="dikList" class="dik-listebox ${D.view}"></div></section>
    </div>`;
  }

  async function refresh() {
    if (D.loading) return;
    D.loading = true; D.error = '';
    try { D.list = await loadAll(); }
    catch (e) {
      D.list = []; const m = (e && e.message) || String(e);
      D.error = isCloud() && /dictations|relation|schema cache|does not exist|column/i.test(m)
        ? 'The Dictations & Notes table has not been created (or updated) in your Supabase project yet. Run the one-time SQL for it, then reload this page.'
        : 'Could not load: ' + m;
    }
    D.loading = false; drawList();
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async function act(b) {
    const a = b.dataset.dik, id = b.dataset.id, d = id && (D.list || []).find(x => x.id === id);
    const upd = async (fn, ok) => { try { fn(); await putNote(d); if (ok) toast(ok); } catch (e) { toast(e.message || String(e), true); } drawList(); };
    switch (a) {
      case 'start': return recStart();
      case 'stop': return recStop(false);
      case 'discardrec': return recStop(true);
      case 'saveres': return saveResult();
      case 'discardres': return discardResult();
      case 'transcribe': return recognise();
      case 'settings': return SLRApp.navigate('settings');
      case 'fav': if (!d) return; d.fav = !d.fav; drawList(); try { await putNote(d); } catch (e) { d.fav = !d.fav; drawList(); toast(e.message || String(e), true); } return;
      case 'more': if (!d) return; D.open.has(id) ? D.open.delete(id) : D.open.add(id); markUsed(id); return drawList();
      case 'play': {
        if (!d) return;
        if (D.playing === id) { D.playing = null; return drawList(); }
        D.playing = id; markUsed(id); drawList();
        if (!D.urls[id]) { try { D.urls[id] = URL.createObjectURL(await getAudio(d)); } catch (e) { D.playing = null; toast('Audio not available: ' + (e.message || e), true); } drawList(); }
        return;
      }
      case 'copy': if (!d) return; try { await navigator.clipboard.writeText(d.text); markUsed(id); toast('Text copied.'); } catch (_) { toast('Copying is blocked in this browser.', true); } return;
      case 'newnote': if (D.rec || D.res || D.cont) { toast('Finish or discard the current recording first.', true); return; } D.trash = false; D.edit = 'new'; D.draft = null; return drawList();
      case 'rmaudio': {
        if (!d || !(await SLRViews.confirmDialog({ title: 'Delete the audio?', message: `The recording of “${d.title || 'Dictation'}” is deleted. The text stays as a note.`, confirmLabel: 'Delete audio', danger: true }))) return;
        try { await dropAudio(d); await putNote(d); if (D.urls[id]) { URL.revokeObjectURL(D.urls[id]); delete D.urls[id]; } if (D.playing === id) D.playing = null; toast('Audio deleted, the text is now a note.'); } catch (e) { toast(e.message || String(e), true); }
        return drawList();
      }
      case 'txt': {
        if (!d) return; markUsed(id);
        const name = (d.title || 'Dictation').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Dictation';
        const u = URL.createObjectURL(new Blob([`${d.title}\n${fmtDate(d.created)}\n\n${d.text}\n`], { type: 'text/plain;charset=utf-8' }));
        const x = Object.assign(document.createElement('a'), { href: u, download: name + '.txt' }); document.body.append(x); x.click(); x.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000);
        return;
      }
      case 'read': { if (!d) return; markUsed(id); try { SLRTts.toggle(mdPlain(d.text), { onFallback: info => toast(SLRTts.fallbackMessage(info)) }); } catch (_) { toast('Reading aloud is not available here.', true); } return; }
      case 'edit': if (!d) return; D.edit = id; D.draft = null; markUsed(id); return drawList();
      case 'canceledit': if (D.rec && D.rec.target) { toast('Finish the recording first.', true); return; } D.edit = null; D.draft = null; return drawList();
      case 'savedit': {
        const v = i => (document.getElementById(i) || {}).value || '';
        const title = v('dEdTitle'), text = v('dEdText'), folder = v('dEdFolder').trim(), tags = splitTags(v('dEdTags'));
        try {
          if (id === 'new') {
            if (!text.trim() && !title.trim()) { toast('Please enter a title or some text.', true); return; }
            const now = new Date().toISOString();
            const n = { id: uid(), title: title.trim() || autoTitle(text, 'Note'), text, lang: 'auto', dur: 0, folder, tags, fav: false, audio: false, audioPath: '', audioType: '', deleted: '', created: now, modified: now };
            await putNote(n); D.list.unshift(n); markUsed(n.id); toast('Note saved.');
          } else if (d) {
            d.title = title.trim() || autoTitle(text, d.audio ? 'Dictation' : 'Note'); d.text = text; d.folder = folder; d.tags = tags;
            await putNote(d); markUsed(id); toast('Saved.');
          }
          D.edit = null; D.draft = null;
        } catch (e) { toast('Could not save: ' + (e.message || e), true); }
        return drawList();
      }
      case 'del': {
        if (!d) return;
        if (!d.deleted) { return upd(() => { d.deleted = new Date().toISOString(); if (D.playing === id) D.playing = null; if (D.edit === id) { D.edit = null; D.draft = null; } }, `“${d.title || (d.audio ? 'Dictation' : 'Note')}” is in the trash.`); }
        if (!(await SLRViews.confirmDialog({ title: 'Delete for good?', message: `“${d.title || (d.audio ? 'Dictation' : 'Note')}”${d.audio ? ' with its audio' : ''} is removed permanently. This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
        try { await dropNote(d); D.list = D.list.filter(x => x.id !== id); if (D.urls[id]) { URL.revokeObjectURL(D.urls[id]); delete D.urls[id]; } if (D.playing === id) D.playing = null; toast('Deleted for good.'); } catch (e) { toast(e.message || String(e), true); }
        return drawList();
      }
      case 'restore': if (!d) return; return upd(() => { d.deleted = ''; }, 'Restored.');
      case 'trash': if (D.edit && D.draft && !confirm('The changes in the open form will be lost. Switch anyway?')) return; D.trash = !D.trash; D.edit = null; D.draft = null; return drawList();
      case 'emptytrash': {
        const t = inTrash(); if (!t.length) return;
        if (!(await SLRViews.confirmDialog({ title: 'Empty the trash?', message: `${t.length} ${t.length === 1 ? 'entry' : 'entries'} with their audio files will be removed permanently.`, confirmLabel: 'Empty trash', danger: true }))) return;
        try { for (const n of t) await dropNote(n); D.list = active(); D.playing = null; toast('Trash emptied.'); } catch (e) { toast(e.message || String(e), true); }
        return drawList();
      }
      case 'cont': if (id) return contStart(id); return;
      case 'mdclean': { const ta = document.getElementById('dEdText') || document.getElementById('dikText'); if (!ta) return; const neu = mdPlain(ta.value); if (neu === ta.value.trim()) { toast('No formatting characters found.'); return; } ta.value = neu; toast('Characters removed – save to keep the change.'); return; }
      case 'mdweg': { if (!d) return; const neu = mdPlain(d.text); if (neu === d.text) { toast('No formatting characters found.'); return; } return upd(() => { d.text = neu; markUsed(id); }, 'Formatting characters removed.'); }
      case 'renamefolder': {
        const old = D.folder, neu = prompt(`New name for the folder “${old}” (empty = dissolve the folder):`, old);
        if (neu === null) return;
        try { for (const n of D.list) if (n.folder === old) { n.folder = neu.trim(); await putNote(n); } D.folder = neu.trim() || '*'; } catch (e) { toast(e.message || String(e), true); }
        return drawList();
      }
      default:
    }
  }

  // ── Entry point ───────────────────────────────────────────────────────────
  const ownerKey = () => isCloud()
    ? 'cloud:' + ((window.SLRDataCloud && SLRDataCloud.currentUser() || {}).id || '')
    : 'local:' + ((window.SLRDataLocal && SLRDataLocal.rootHandle && SLRDataLocal.rootHandle.name) || '');

  function render(container) {
    D.container = container;
    const owner = ownerKey();
    if (D.owner !== undefined && D.owner !== owner) reset();
    D.owner = owner;
    if (!ready()) {
      container.innerHTML = `<div class="settings-view"><div class="settings-card"><p class="field-hint" style="margin-top:0">${isCloud()
        ? 'Dictations and notes are stored in your Cloud Sync account. Sign in on the <strong>Home</strong> screen first.'
        : 'Dictations and notes are stored in your workspace folder. Open a folder on the <strong>Home</strong> screen first.'}</p>
        <div class="settings-save-row"><button class="btn-secondary" data-dik="home">Go to Home</button></div></div></div>`;
      container.onclick = e => { if (e.target.closest('[data-dik="home"]')) SLRApp.navigate('welcome'); };
      container.oninput = container.onchange = null;
      return;
    }
    container.innerHTML = pageHTML();
    container.onclick = e => {
      const b = e.target.closest('[data-dik]');
      if (b && container.contains(b)) { e.preventDefault(); act(b); return; }
      const v = e.target.closest('[data-dview]');
      if (v) { D.view = v.dataset.dview === 'list' ? 'list' : 'cards'; lsSet('slr-dik-view', D.view); container.querySelectorAll('[data-dview]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.dview === D.view))); drawList(); return; }
      const k = e.target.closest('[data-dkind]'); if (k) { D.kind = k.dataset.dkind; drawList(); return; }
      const f = e.target.closest('[data-dfolder]'); if (f) { D.folder = f.dataset.dfolder; drawList(); return; }
      const t = e.target.closest('[data-dtag]'); if (t) { D.tag = D.tag === t.dataset.dtag ? '' : t.dataset.dtag; drawList(); }
    };
    container.oninput = e => { if (e.target.id === 'dikSearch') { D.q = e.target.value; drawList(); } };
    container.onchange = e => {
      const t = e.target;
      if (t.id === 'dikSort') { D.sort = t.value; lsSet('slr-dik-sort', D.sort); drawList(); }
      else if (t.id === 'dikFile') { loadFile(t.files && t.files[0]); t.value = ''; }
      else if (t.matches && t.matches('[data-dlang]')) { D.lang = t.value; lsSet('slr-dik-lang', D.lang); }
      else if (t.matches && t.matches('[data-drelang]') && D.res && D.res.status !== 'busy') { recognise(t.value); }
    };
    drawList();
    if (D.list === null) refresh();
  }

  // The list belongs to one workspace; switching workspace or account drops it.
  function reset() {
    D.list = null; D.error = ''; D.edit = null; D.draft = null; D.open.clear(); D.playing = null; D.trash = false;
    Object.values(D.urls).forEach(u => URL.revokeObjectURL(u)); D.urls = {};
  }

  return { render, reset, config, setConfig, MODELS, deviceOK };

})();
