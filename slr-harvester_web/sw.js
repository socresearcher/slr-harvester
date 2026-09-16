/**
 * SLR Harvester Web — Service Worker
 *
 * Zwei Aufgaben, bewusst getrennt:
 *
 *  1. App-Dateien (eigener Ursprung): NETZ ZUERST, Zwischenspeicher nur als
 *     Rueckfall. Online bekommt man also immer den aktuellen Stand — die
 *     ?v=-Kennungen in index.html bleiben der einzige Mechanismus fuer
 *     Aktualisierungen, und niemand bleibt auf einem alten Stand haengen.
 *     Offline startet die Anwendung aus dem Zwischenspeicher.
 *
 *  2. Engine-Dateien der natuerlichen Vorlesestimmen (WebAssembly und
 *     Lautdaten von cdnjs und jsdelivr): SPEICHER ZUERST. Die Adressen
 *     enthalten die Paketversion und aendern sich nie; nach dem ersten
 *     Abruf laufen die Stimmen damit auch offline. Die Stimmmodelle selbst
 *     legt die Engine ohnehin im OPFS ab.
 *
 * Nicht angefasst werden alle uebrigen fremden Anfragen: Datenbank-APIs,
 * Supabase, Hugging Face. Sie gehen unveraendert ins Netz; eine Suche aus
 * dem Zwischenspeicher waere eine falsche Suche.
 *
 * Laeuft nur ueber http(s) — bei file:// registriert app.js ihn gar nicht.
 */

const SHELL_CACHE  = 'slr-shell-v1';
const ENGINE_CACHE = 'slr-voice-engine-v1';

// Beim Installieren vorab geholt, damit der zweite Besuch auch offline
// startet: Der erste Seitenaufruf laeuft, bevor der Worker aktiv ist, und
// wuerde sonst nichts in den Speicher legen.
const SHELL = [
  './',
  'index.html',
  'favicon.svg',
  'manifest.webmanifest',
  'css/style.css',
  'js/icons.js',
  'js/vendor/supabase.js',
  'js/data-local.js',
  'js/data-supabase.js',
  'js/data.js',
  'js/world-map-data.js',
  'js/world-map-outline-data.js',
  'js/world-map-paths-data.js',
  'js/world-map.js',
  'js/tts.js',
  'js/views.js',
  'js/app-ui.js',
  'js/app.js',
  'js/vendor/piper/piper-tts-web.js',
  'js/vendor/piper/piper-o91UDS6e.js',
  'js/vendor/piper/voices_static-D_OtJDHM.js',
  'js/vendor/onnxruntime/ort.wasm.min.js',
];

const ENGINE_HOSTS = [
  { host: 'cdnjs.cloudflare.com', path: '/ajax/libs/onnxruntime-web/' },
  { host: 'cdn.jsdelivr.net',     path: '/npm/@diffusionstudio/piper-wasm@' },
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL))
      // Ein fehlender Eintrag darf die Installation nicht verhindern — dann
      // gibt es eben nur den Rueckfall aus spaeteren Abrufen.
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const behalten = new Set([SHELL_CACHE, ENGINE_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(namen => Promise.all(namen.filter(n => !behalten.has(n)).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function istEngineDatei(url) {
  return ENGINE_HOSTS.some(e => url.host === e.host && url.pathname.startsWith(e.path));
}

async function speicherZuerst(request) {
  const cache = await caches.open(ENGINE_CACHE);
  const treffer = await cache.match(request);
  if (treffer) return treffer;
  const antwort = await fetch(request);
  if (antwort && antwort.ok) cache.put(request, antwort.clone());
  return antwort;
}

async function netzZuerst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const antwort = await fetch(request);
    if (antwort && antwort.ok && antwort.type === 'basic') {
      // Ohne ?v= ablegen, damit der Rueckfall jede Versionskennung trifft.
      const url = new URL(request.url);
      url.search = '';
      cache.put(url.toString(), antwort.clone());
    }
    return antwort;
  } catch (err) {
    const treffer = await cache.match(request, { ignoreSearch: true });
    if (treffer) return treffer;
    if (request.mode === 'navigate') {
      const start = await cache.match('index.html', { ignoreSearch: true });
      if (start) return start;
    }
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (istEngineDatei(url)) {
    event.respondWith(speicherZuerst(request));
    return;
  }
  if (url.origin === self.location.origin) {
    // Der Entwicklungsserver leitet /proxy/ an fremde APIs weiter — das sind
    // Suchanfragen und gehoeren nicht in den Speicher.
    if (url.pathname.includes('/proxy/')) return;
    event.respondWith(netzZuerst(request));
  }
});
