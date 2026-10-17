/**
 * SLR Harvester Web - Dictations & Notes
 * Voice dictations (recorded in the browser, transcribed with Whisper) and plain
 * notes. Whisper runs ON THE DEVICE by default (vendored Transformers.js in a
 * worker, no key, audio never leaves the browser); OpenAI's Whisper API is an
 * optional second engine for users who bring their own key. Ported in spirit
 * from the Dashboard's "Diktate" page; same behaviour where it makes sense
 * (record, transcribe, edit, favourite, folder, search, filter, audio playback).
 *
 * Storage follows the active workspace, like projects do:
 *   - local folder: notes.json + notes-audio/<id>.<ext> in the workspace root
 *   - Cloud Sync:   table public.dictations + private bucket "dictations"
 *                   (one-time SQL, see the project owner's setup notes)
 *
 * Engine, model and the optional OpenAI key stay in this browser's localStorage
 * (slr-stt-*, slr-openai-key), never in the workspace or in Supabase. With the
 * OpenAI engine, audio leaves the device only when "Transcribe" runs, and then
 * goes to api.openai.com only. Settings > Dictations edits these values.
 *
 * Global: window.SLRNotes
 */

window.SLRNotes = (() => {

  const KEY_OPENAI = 'slr-openai-key';
  const MAX_AUDIO = 24 * 1024 * 1024;           // OpenAI accepts 25 MB per file
  const LANGS = [['auto', 'Auto-detect'], ['de', 'Deutsch'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['hr', 'Hrvatski']];
  const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

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
  const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const extOf = m => /mp4|m4a/.test(m || '') ? 'm4a' : /ogg/.test(m || '') ? 'ogg' : 'webm';

  // ── State (survives view changes, so a running recording is not lost) ─────
  const S = {
    list: null, loading: false, error: '',
    kind: '*', folder: '*', fav: false, q: '', sort: 'new',
    open: new Set(), edit: null, draft: null, busyId: null,
    rec: null, result: null, lang: 'auto', sttStatus: '',
    urls: {}, container: null,
  };

  // ── Storage: local folder ─────────────────────────────────────────────────
  const isCloud = () => SLRData.getBackend() === 'cloud';
  const ready = () => isCloud() ? !!SLRDataCloud.currentUser() : !!(window.SLRDataLocal && SLRDataLocal.hasWorkspace());

  async function localRead() {
    const root = SLRDataLocal.rootHandle;
    try {
      const fh = await root.getFileHandle('notes.json');
      const j = JSON.parse(await (await fh.getFile()).text());
      return Array.isArray(j.notes) ? j.notes : [];
    } catch (_) { return []; }
  }
  async function localWrite(list) {
    if (!(await SLRDataLocal.ensureWriteAccess())) throw new Error('No write access to the workspace folder.');
    const fh = await SLRDataLocal.rootHandle.getFileHandle('notes.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 1, notes: list }, null, 2));
    await w.close();
  }
  async function localAudioDir(create) {
    return SLRDataLocal.rootHandle.getDirectoryHandle('notes-audio', { create: !!create });
  }

  // ── Storage: cloud ────────────────────────────────────────────────────────
  const cloudSession = () => SLRDataCloud.session();
  const toNote = r => ({
    id: r.id, title: r.title || '', text: r.body || '', lang: r.lang || 'auto', dur: r.duration_s || 0,
    folder: r.folder || '', fav: !!r.favorite, audio: !!r.audio_path, audioPath: r.audio_path || '', audioType: r.audio_type || '',
    created: r.created, modified: r.modified,
  });
  const toRow = (n, userId) => ({
    id: n.id, user_id: userId, title: n.title, body: n.text, lang: n.lang, duration_s: Math.round(n.dur || 0),
    folder: n.folder || '', favorite: !!n.fav, audio_path: n.audioPath || null, audio_type: n.audioType || null,
    created: n.created, modified: n.modified,
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

  const setStatusFn = () => { return t => { S.sttStatus = t; const el = document.getElementById('nt-status'); if (el) el.textContent = t; }; };

  // ── Recording ─────────────────────────────────────────────────────────────
  async function recStart() {
    if (S.rec || S.result) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast('This browser cannot record audio.', true); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast('Microphone unavailable or blocked: ' + (e && e.message || e), true); return; }
    const mime = MIMES.find(m => MediaRecorder.isTypeSupported(m)) || '';
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    const rec = { mr, stream, chunks: [], start: Date.now(), cancel: false, timer: 0, mime: mr.mimeType || mime };
    mr.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    mr.onstop = () => {
      clearInterval(rec.timer);
      stream.getTracks().forEach(t => t.stop());
      S.rec = null;
      if (rec.cancel || !rec.chunks.length) { draw(); return; }
      const blob = new Blob(rec.chunks, { type: rec.mime || 'audio/webm' });
      S.result = { blob, url: URL.createObjectURL(blob), dur: (Date.now() - rec.start) / 1000, title: '', text: '', lang: S.lang, busy: false, err: '' };
      draw();
      if (config().auto && canTranscribe() && (config().engine === 'openai' || lsGet('slr-stt-ok-' + config().model))) transcribeResult();
    };
    S.rec = rec;
    mr.start(1000);
    rec.timer = setInterval(() => { const t = document.getElementById('nt-time'); if (t) t.textContent = fmtDur((Date.now() - rec.start) / 1000); }, 250);
    draw();
  }

  function recStop(cancel) {
    if (!S.rec) return;
    S.rec.cancel = !!cancel;
    try { S.rec.mr.stop(); } catch (_) { /* already stopped */ }
  }

  async function transcribeResult() {
    const r = S.result; if (!r || r.busy) return;
    syncFields(); r.busy = true; r.err = ''; S.sttStatus = 'Starting …'; draw();
    try { r.text = await transcribe(r.blob, r.lang, setStatusFn()); if (!r.title) r.title = autoTitle(r.text, 'Dictation'); if (!r.text) r.err = 'No speech was recognised.'; }
    catch (e) { r.err = e.message || String(e); }
    r.busy = false; S.sttStatus = ''; draw();
  }

  function discardResult() {
    if (S.result && S.result.url) URL.revokeObjectURL(S.result.url);
    S.result = null; draw();
  }

  function autoTitle(text, kind) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t) return t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, '') + '…' : t;
    return kind + ' ' + fmtDate(new Date().toISOString());
  }

  async function saveResult() {
    const r = S.result; if (!r || r.busy) return;
    syncFields();
    const now = new Date().toISOString();
    const n = { id: uid(), title: r.title.trim() || autoTitle(r.text, 'Dictation'), text: r.text, lang: r.lang, dur: r.dur, folder: (r.folder || '').trim(), fav: false, audio: false, audioPath: '', audioType: '', created: now, modified: now };
    r.busy = true; r.err = ''; draw();
    try {
      await putAudio(n, r.blob);
      await putNote(n);
      S.list.unshift(n);
      URL.revokeObjectURL(r.url); S.result = null;
      toast('Dictation saved.');
    } catch (e) { r.err = 'Could not save: ' + (e.message || e); r.busy = false; }
    draw();
  }

  // ── Notes: new / edit ─────────────────────────────────────────────────────
  function startEdit(id) {
    syncFields();
    if (id === '__new') S.draft = { title: '', text: '', folder: '', lang: 'auto' };
    else { const n = S.list.find(x => x.id === id); if (!n) return; S.draft = { title: n.title, text: n.text, folder: n.folder, lang: n.lang }; }
    S.edit = id; draw();
    const t = document.getElementById('nt-ed-text'); if (t) t.focus();
  }

  async function saveEdit() {
    syncFields();
    const d = S.draft; if (!d) return;
    const id = S.edit;
    try {
      if (id === '__new') {
        if (!d.text.trim() && !d.title.trim()) { toast('Write something first.', true); return; }
        const now = new Date().toISOString();
        const n = { id: uid(), title: d.title.trim() || autoTitle(d.text, 'Note'), text: d.text, lang: 'auto', dur: 0, folder: d.folder.trim(), fav: false, audio: false, audioPath: '', audioType: '', created: now, modified: now };
        await putNote(n); S.list.unshift(n); toast('Note saved.');
      } else {
        const n = S.list.find(x => x.id === id); if (!n) return;
        n.title = d.title.trim() || autoTitle(d.text, n.audio ? 'Dictation' : 'Note'); n.text = d.text; n.folder = d.folder.trim();
        await putNote(n); toast('Saved.');
      }
      S.edit = null; S.draft = null;
    } catch (e) { toast('Could not save: ' + (e.message || e), true); }
    draw();
  }

  // ── Reading the form fields back into state (before any redraw) ──────────
  function syncFields() {
    const v = id => { const el = document.getElementById(id); return el ? el.value : null; };
    if (S.result) {
      const t = v('nt-r-title'), x = v('nt-r-text'), l = v('nt-r-lang'), f = v('nt-r-folder');
      if (t !== null) S.result.title = t; if (x !== null) S.result.text = x; if (l !== null) S.result.lang = l; if (f !== null) S.result.folder = f;
    }
    if (S.draft) {
      const t = v('nt-ed-title'), x = v('nt-ed-text'), f = v('nt-ed-folder');
      if (t !== null) S.draft.title = t; if (x !== null) S.draft.text = x; if (f !== null) S.draft.folder = f;
    }
  }

  // ── List helpers ──────────────────────────────────────────────────────────
  function visible() {
    const q = S.q.trim().toLowerCase();
    let l = (S.list || []).filter(n =>
      (S.kind === '*' || (S.kind === 'dictation') === !!n.audio) &&
      (S.folder === '*' || (S.folder === '' ? !n.folder : n.folder === S.folder)) &&
      (!S.fav || n.fav) &&
      (!q || (n.title + ' ' + n.text + ' ' + n.folder).toLowerCase().includes(q)));
    l = l.slice().sort((a, b) => S.sort === 'old' ? String(a.created).localeCompare(String(b.created)) : S.sort === 'title' ? a.title.localeCompare(b.title) : String(b.created).localeCompare(String(a.created)));
    return l;
  }
  const folders = () => [...new Set((S.list || []).map(n => n.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // ── Markup ────────────────────────────────────────────────────────────────
  const I = () => window.SLRIcons;
  const langSelect = (id, cur) => `<select class="form-input nt-lang" id="${id}" aria-label="Language">${LANGS.map(([k, t]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${t}</option>`).join('')}</select>`;

  function recorderHtml() {
    if (S.rec) {
      return `<div class="nt-recbox">
        <button type="button" class="nt-mic rec" data-nt="rec-stop" aria-label="Stop recording" title="Stop recording">${I().stop}</button>
        <div class="nt-info"><b id="nt-time">${fmtDur((Date.now() - S.rec.start) / 1000)}</b><span class="nt-hint">Recording … press stop when you are done.</span></div>
        <button type="button" class="btn-secondary" data-nt="rec-cancel">Cancel</button>
      </div>`;
    }
    if (S.result) {
      const r = S.result;
      return `<div class="nt-result">
        <audio class="nt-audio" controls preload="metadata" src="${esc(r.url)}"></audio>
        <div class="nt-fields">
          <label class="nt-f">Title<input class="form-input" id="nt-r-title" type="text" maxlength="140" value="${esc(r.title)}" placeholder="Optional"></label>
          <label class="nt-f">Folder<input class="form-input" id="nt-r-folder" type="text" maxlength="60" list="nt-folders" value="${esc(r.folder || '')}" placeholder="No folder"></label>
          <label class="nt-f">Language<span>${langSelect('nt-r-lang', r.lang)}</span></label>
        </div>
        <label class="nt-f">Text${r.busy ? ' <span class="nt-busy"><span class="nt-spin"></span> <span id="nt-status">' + esc(S.sttStatus || 'working …') + '</span></span>' : ''}
          <textarea class="form-input" id="nt-r-text" rows="6" placeholder="${canTranscribe() ? 'The transcript appears here. Press Transcribe if it does not start by itself.' : 'Transcription is not available with the current settings (Settings > Dictations): type the text yourself.'}">${esc(r.text)}</textarea></label>
        ${r.err ? `<p class="nt-err" role="alert">${esc(r.err)}</p>` : ''}
        <div class="nt-btnrow">
          <button type="button" class="btn-primary" data-nt="res-save"${r.busy ? ' disabled' : ''}>Save dictation</button>
          <button type="button" class="btn-secondary" data-nt="res-transcribe"${r.busy || !canTranscribe() ? ' disabled' : ''}>${r.text ? 'Transcribe again' : 'Transcribe'}</button>
          <button type="button" class="btn-secondary" data-nt="res-discard"${r.busy ? ' disabled' : ''}>Discard</button>
          <span class="nt-hint">${fmtDur(r.dur)} · ${(r.blob.size / 1024).toFixed(0)} KB</span>
        </div>
      </div>`;
    }
    return `<div class="nt-recbox">
      <button type="button" class="nt-mic" data-nt="rec-start" aria-label="Start recording" title="Start recording">${I().mic}</button>
      <div class="nt-info"><b>Dictate</b><span class="nt-hint">${canTranscribe() ? 'Recorded here, transcribed with ' + esc(engineLabel()) + '.' : 'Recorded here. Transcription is off with the current settings.'}</span></div>
      <label class="nt-f nt-f-inline">Language${langSelect('nt-lang', S.lang)}</label>
      <button type="button" class="btn-secondary" data-nt="new">${I().plus} New note</button>
    </div>`;
  }

  function statusHtml() {
    const c = config();
    return `<div class="settings-card nt-key">
      <div class="nt-key-head">
        <span>Transcription</span>
        <span class="nt-hint">${esc(engineLabel())}${c.engine === 'device' ? ' · free, private, no key' : ''}${c.auto ? ' · automatic' : ' · manual'}</span>
        <button type="button" class="btn-secondary btn-sm" data-nt="settings">Change in Settings</button>
      </div>
    </div>`;
  }

  function editHtml(d, isNew, n) {
    return `<article class="nt-item nt-editing">
      <label class="nt-f">Title<input class="form-input" id="nt-ed-title" type="text" maxlength="140" value="${esc(d.title)}" placeholder="${isNew ? 'Optional' : ''}"></label>
      <label class="nt-f">Text<textarea class="form-input" id="nt-ed-text" rows="8">${esc(d.text)}</textarea></label>
      <label class="nt-f">Folder<input class="form-input" id="nt-ed-folder" type="text" maxlength="60" list="nt-folders" value="${esc(d.folder)}" placeholder="No folder"></label>
      <div class="nt-btnrow">
        <button type="button" class="btn-primary" data-nt="edit-save">${isNew ? 'Save note' : 'Save'}</button>
        <button type="button" class="btn-secondary" data-nt="edit-cancel">Cancel</button>
        ${!isNew && n && n.audio && canTranscribe() ? `<button type="button" class="btn-secondary" data-nt="retr" data-id="${esc(n.id)}">Transcribe audio again</button>` : ''}
      </div></article>`;
  }

  function itemHtml(n) {
    if (S.edit === n.id) return editHtml(S.draft, false, n);
    const open = S.open.has(n.id), busy = S.busyId === n.id;
    const meta = [fmtDate(n.created), n.audio ? 'Dictation · ' + fmtDur(n.dur) : 'Note', n.lang && n.lang !== 'auto' ? n.lang.toUpperCase() : '', n.folder].filter(Boolean).map(esc).join(' · ');
    const url = S.urls[n.id];
    return `<article class="nt-item${n.audio ? '' : ' note'}" data-id="${esc(n.id)}">
      <header>
        <button type="button" class="nt-fav" data-nt="fav" data-id="${esc(n.id)}" aria-pressed="${n.fav}" aria-label="${n.fav ? 'Remove favourite' : 'Mark as favourite'}" title="Favourite">${I().star}</button>
        <div class="nt-head"><b>${esc(n.title || (n.audio ? 'Dictation' : 'Note'))}</b><small>${meta}</small></div>
        <div class="nt-acts">
          ${n.audio ? `<button type="button" class="nt-ib" data-nt="open" data-id="${esc(n.id)}" aria-expanded="${open}" aria-label="Play audio" title="Play audio">${I().speaker}</button>` : ''}
          <button type="button" class="nt-ib" data-nt="copy" data-id="${esc(n.id)}" aria-label="Copy text" title="Copy text">${I().copy}</button>
          <button type="button" class="nt-ib" data-nt="edit" data-id="${esc(n.id)}" aria-label="Edit" title="Edit">${I().pencil}</button>
          <button type="button" class="nt-ib danger" data-nt="del" data-id="${esc(n.id)}" aria-label="Delete" title="Delete">${I().trash}</button>
        </div>
      </header>
      ${busy ? '<p class="nt-busy"><span class="nt-spin"></span> <span id="nt-status">' + esc(S.sttStatus || 'transcribing …') + '</span></p>' : ''}
      ${n.text ? `<p class="nt-text${open ? ' open' : ''}" data-nt="open-text" data-id="${esc(n.id)}">${esc(n.text)}</p>` : '<p class="nt-text empty">No text.</p>'}
      ${open && n.audio ? (url ? `<audio class="nt-audio" controls autoplay preload="metadata" src="${esc(url)}"></audio><div class="nt-btnrow">${canTranscribe() ? `<button type="button" class="btn-secondary btn-sm" data-nt="retr" data-id="${esc(n.id)}">Transcribe again</button>` : ''}<button type="button" class="btn-secondary btn-sm" data-nt="delaudio" data-id="${esc(n.id)}">Delete audio, keep text</button></div>` : '<p class="nt-busy"><span class="nt-spin"></span> loading audio …</p>') : ''}
    </article>`;
  }

  function listInnerHtml() {
    if (S.error) return `<p class="nt-err">${esc(S.error)}</p>`;
    if (S.list === null) return '<p class="nt-hint">Loading …</p>';
    const l = visible();
    if (!l.length) return `<p class="nt-empty">${S.list.length ? 'Nothing matches the filter.' : 'Nothing here yet. Record a dictation or write a note.'}</p>`;
    return l.map(itemHtml).join('');
  }

  function listCardHtml() {
    const seg = (k, t) => `<button type="button" data-nt="kind" data-k="${k}" aria-pressed="${S.kind === k}">${t}</button>`;
    const fs = folders();
    return `<section class="settings-card nt-list">
      <div class="nt-toolbar">
        <input class="form-input nt-search" id="nt-q" type="search" placeholder="Search dictations and notes …" value="${esc(S.q)}" aria-label="Search dictations and notes">
        <div class="segc" role="group" aria-label="Type">${seg('*', 'All')}${seg('dictation', 'Dictations')}${seg('note', 'Notes')}</div>
        <select class="form-input nt-sel" id="nt-folder" aria-label="Folder"><option value="*"${S.folder === '*' ? ' selected' : ''}>All folders</option><option value=""${S.folder === '' ? ' selected' : ''}>No folder</option>${fs.map(f => `<option value="${esc(f)}"${S.folder === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <select class="form-input nt-sel" id="nt-sort" aria-label="Sort"><option value="new"${S.sort === 'new' ? ' selected' : ''}>Newest first</option><option value="old"${S.sort === 'old' ? ' selected' : ''}>Oldest first</option><option value="title"${S.sort === 'title' ? ' selected' : ''}>Title A–Z</option></select>
        <button type="button" class="nt-ib nt-favf" data-nt="favfilter" aria-pressed="${S.fav}" aria-label="Only favourites" title="Only favourites">${I().star}</button>
      </div>
      <div class="nt-items" id="nt-items">${listInnerHtml()}</div>
    </section>`;
  }

  // ── Draw ──────────────────────────────────────────────────────────────────
  function draw() {
    const c = S.container; if (!c || !c.isConnected) return;
    const keep = c.scrollTop;
    c.innerHTML = `<div class="settings-view nt-view">
      <datalist id="nt-folders">${folders().map(f => `<option value="${esc(f)}">`).join('')}</datalist>
      <section class="settings-card nt-rec">${recorderHtml()}</section>
      ${S.edit === '__new' ? `<section class="settings-card">${editHtml(S.draft, true)}</section>` : ''}
      ${statusHtml()}
      ${listCardHtml()}
    </div>`;
    c.scrollTop = keep;
  }

  function drawList() {
    const el = document.getElementById('nt-items'); if (el) el.innerHTML = listInnerHtml();
  }

  async function refresh() {
    if (S.loading) return;
    S.loading = true; S.error = '';
    try { S.list = await loadAll(); }
    catch (e) {
      S.list = []; const m = (e && e.message) || String(e);
      S.error = isCloud() && /dictations|relation|schema cache|does not exist/i.test(m)
        ? 'The Dictations & Notes table has not been created in your Supabase project yet. Run the one-time SQL for it, then reload this page.'
        : 'Could not load: ' + m;
    }
    S.loading = false; draw();
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  async function act(a, id, el) {
    const n = id ? (S.list || []).find(x => x.id === id) : null;
    switch (a) {
      case 'rec-start': return recStart();
      case 'rec-stop': return recStop(false);
      case 'rec-cancel': return recStop(true);
      case 'res-save': return saveResult();
      case 'res-transcribe': return transcribeResult();
      case 'res-discard': {
        if (S.result && (S.result.text || S.result.title) && !(await SLRViews.confirmDialog({ title: 'Discard this dictation?', message: 'The recording and its text will be thrown away.', confirmLabel: 'Discard', danger: true }))) return;
        return discardResult();
      }
      case 'new': return startEdit('__new');
      case 'edit': return startEdit(id);
      case 'edit-save': return saveEdit();
      case 'edit-cancel': syncFields(); S.edit = null; S.draft = null; return draw();
      case 'kind': S.kind = el.dataset.k; return draw();
      case 'favfilter': S.fav = !S.fav; return draw();
      case 'settings': return SLRApp.navigate('settings');
      case 'fav': if (!n) return; n.fav = !n.fav; try { await putNote(n); } catch (e) { n.fav = !n.fav; toast('Could not save: ' + (e.message || e), true); } return drawList();
      case 'copy': if (!n) return; try { await navigator.clipboard.writeText(n.text || ''); toast('Text copied.'); } catch (_) { toast('Copying is blocked in this browser.', true); } return;
      case 'open-text': if (!n) return; if (S.open.has(id)) S.open.delete(id); else S.open.add(id); return drawList();
      case 'open': {
        if (!n) return;
        if (S.open.has(id) && S.urls[id]) { S.open.delete(id); return drawList(); }
        S.open.add(id); drawList();
        if (!S.urls[id]) {
          try { S.urls[id] = URL.createObjectURL(await getAudio(n)); }
          catch (e) { S.open.delete(id); toast('Audio not available: ' + (e.message || e), true); }
          drawList();
        }
        return;
      }
      case 'delaudio': {
        if (!n || !(await SLRViews.confirmDialog({ title: 'Delete the audio?', message: 'The recording is removed; the text stays as a note.', confirmLabel: 'Delete audio', danger: true }))) return;
        try { await dropAudio(n); await putNote(n); if (S.urls[id]) { URL.revokeObjectURL(S.urls[id]); delete S.urls[id]; } S.open.delete(id); toast('Audio deleted.'); }
        catch (e) { toast('Could not delete: ' + (e.message || e), true); }
        return draw();
      }
      case 'del': {
        if (!n || !(await SLRViews.confirmDialog({ title: `Delete “${n.title || (n.audio ? 'Dictation' : 'Note')}”?`, message: n.audio ? 'The dictation and its audio are deleted for good.' : 'The note is deleted for good.', confirmLabel: 'Delete', danger: true }))) return;
        try { await dropNote(n); S.list = S.list.filter(x => x.id !== id); if (S.urls[id]) { URL.revokeObjectURL(S.urls[id]); delete S.urls[id]; } toast('Deleted.'); }
        catch (e) { toast('Could not delete: ' + (e.message || e), true); }
        return draw();
      }
      case 'retr': {
        if (!n || !n.audio) return;
        if (n.text && !(await SLRViews.confirmDialog({ title: 'Replace the text?', message: 'The audio is transcribed again and the current text is overwritten.', confirmLabel: 'Transcribe', danger: true }))) return;
        syncFields(); S.busyId = id; S.sttStatus = 'Starting …'; draw();
        try { const text = await transcribe(await getAudio(n), n.lang, setStatusFn()); n.text = text; if (S.edit === id && S.draft) S.draft.text = text; await putNote(n); toast('Transcribed.'); }
        catch (e) { toast(e.message || String(e), true); }
        S.busyId = null; return draw();
      }
      default:
    }
  }

  // ── Entry point ───────────────────────────────────────────────────────────
  // Which workspace the loaded list belongs to (backend + folder name or account id).
  const ownerKey = () => isCloud()
    ? 'cloud:' + ((window.SLRDataCloud && SLRDataCloud.currentUser() || {}).id || '')
    : 'local:' + ((window.SLRDataLocal && SLRDataLocal.rootHandle && SLRDataLocal.rootHandle.name) || '');

  function render(container) {
    S.container = container;
    const owner = ownerKey();
    if (S.owner !== undefined && S.owner !== owner) reset();
    S.owner = owner;
    if (!ready()) {
      container.innerHTML = `<div class="settings-view"><div class="settings-card"><p class="field-hint" style="margin-top:0">${isCloud()
        ? 'Dictations and notes are stored in your Cloud Sync account. Sign in on the <strong>Home</strong> screen first.'
        : 'Dictations and notes are stored in your workspace folder. Open a folder on the <strong>Home</strong> screen first.'}</p>
        <div class="settings-save-row"><button class="btn-secondary" data-nt="home">Go to Home</button></div></div></div>`;
      container.onclick = e => { if (e.target.closest('[data-nt="home"]')) SLRApp.navigate('welcome'); };
      return;
    }
    // One set of handlers, assigned as properties so a redraw never stacks them.
    container.onclick = e => {
      const b = e.target.closest('[data-nt]');
      if (b && container.contains(b)) { e.preventDefault(); act(b.dataset.nt, b.dataset.id, b); }
    };
    container.oninput = e => {
      if (e.target.id === 'nt-q') { S.q = e.target.value; drawList(); }
    };
    container.onchange = e => {
      const t = e.target;
      if (t.id === 'nt-folder') { S.folder = t.value; drawList(); }
      else if (t.id === 'nt-sort') { S.sort = t.value; drawList(); }
      else if (t.id === 'nt-lang') S.lang = t.value;
    };
    if (S.list === null) { draw(); refresh(); }
    else draw();
  }

  // The list belongs to one workspace; switching workspace or account drops it.
  function reset() {
    S.list = null; S.error = ''; S.edit = null; S.draft = null; S.open.clear();
    Object.values(S.urls).forEach(u => URL.revokeObjectURL(u)); S.urls = {};
  }

  return { render, reset, config, setConfig, MODELS, deviceOK };

})();
