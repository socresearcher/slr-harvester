/**
 * SLR Harvester Web — Data Layer Dispatcher
 * Routes every data call to the active backend (local File System Access API,
 * or Supabase cloud sync). Both backends implement the same function surface;
 * this module also owns the two pure, I/O-free functions (getArticles,
 * getStats) so they exist exactly once and are shared by both.
 *
 * Global: window.SLRData
 */

window.SLRData = (() => {

  const BACKEND_KEY = 'slr-backend';

  /** Which backend is active: 'local' or 'cloud'. Defaults to 'local' so
   *  existing users see zero change in behavior. */
  function getBackend() {
    return localStorage.getItem(BACKEND_KEY) === 'cloud' ? 'cloud' : 'local';
  }

  function setBackend(name) {
    localStorage.setItem(BACKEND_KEY, name === 'cloud' ? 'cloud' : 'local');
  }

  /** Whether a given backend can actually be used in this browser. */
  function isBackendSupported(name) {
    if (name === 'local') return typeof window.showDirectoryPicker === 'function';
    if (name === 'cloud') return true; // Supabase's client works in any modern browser
    return false;
  }

  function backendModule() {
    const name = getBackend();
    const mod = name === 'cloud' ? window.SLRDataCloud : window.SLRDataLocal;
    if (!mod) throw new Error(`Data backend "${name}" is not available (its script didn't load).`);
    return mod;
  }

  // Every function below has an identical signature on both backends —
  // just forward the call to whichever one is currently active.
  const FORWARDED_METHODS = [
    'hasWorkspace', 'openFolder', 'restoreFolder', 'restoreSession', 'loadProjects', 'saveProjectMeta',
    'saveProjectIcon',
    'loadConfig', 'saveConfig', 'loadProjectData', 'appendSearchResult',
    'deleteSearchResult', 'setSearchResultStatus', 'patchSearchLogAbstracts', 'patchSearchLogDocTypes',
    'patchSearchLogAuthors', 'patchSearchLogAffiliations', 'patchSearchLogReferencedWorks', 'rewriteSearchLog', 'saveQueryTerms',
    'deleteQueryTerm', 'updateArticleAnnotation', 'bulkUpdateAnnotations',
    'saveTagAliases', 'saveTagsConfig', 'createProject', 'ensureWriteAccess',
  ];

  /**
   * Deduplicate articles from all query runs and merge annotations.
   * Articles are keyed by EID (fallback: DOI). Pure function of already-loaded
   * project data — identical regardless of which backend produced it.
   *
   * @param {Object} projectData  result of loadProjectData()
   * @returns {Array} deduplicated, annotated article objects
   */
  // Normalform einer DOI fuer den Abgleich: klein, ohne Aufloeser-Praefix.
  function normDoi(doi) {
    return String(doi || '')
      .trim()
      .toLowerCase()
      .replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/, '');
  }

  // Annotationen einer zusammengefuehrten Arbeit.
  //
  //   selected, corpus  verodert ueber alle Kennungen. Eine positive
  //                     Screening-Entscheidung darf durch das Zusammenfuehren
  //                     nicht verschwinden. Am echten Projekt 20260702_085449
  //                     nachgewiesen: Hauptkennung selected:false/corpus:false,
  //                     Nebenkennung true/true — ohne Veroderung waere der
  //                     Artikel stillschweigend aus Auswahl und Korpus
  //                     gefallen. Abwaehlen bleibt moeglich, weil app.js jede
  //                     Aenderung auf Haupt- UND Nebenkennungen schreibt
  //                     (mitAliasen).
  //   alle anderen      feldweise die Hauptkennung; die Nebenkennung nur, wo
  //                     die Hauptkennung das Feld nicht kennt oder auf 'None'
  //                     steht (ein nicht gesetzter Tag).
  const ODER_FELDER = ['selected', 'corpus'];
  function mergedAnnotation(globalTags, id, aliases) {
    const haupt = globalTags[id] || {};
    if (!aliases || !aliases.length) return haupt;
    const out = Object.assign({}, haupt);
    for (const alias of aliases) {
      const neben = globalTags[alias];
      if (!neben) continue;
      for (const feld of Object.keys(neben)) {
        if (ODER_FELDER.includes(feld)) {
          out[feld] = !!(out[feld] || neben[feld]);
        } else if (!(feld in out) || ((feld === 'color' || feld === 'tag') && out[feld] === 'None')) {
          out[feld] = neben[feld];
        }
      }
    }
    return out;
  }

  function getArticles(projectData) {
    const { searchLog, globalTags } = projectData;

    const seen   = new Map();   // id → article
    const order  = [];          // insertion order of ids
    // Dieselbe Arbeit kann unter zwei Kennungen auftauchen: als Scopus-EID
    // und als OpenAlex-, Crossref- oder DOAJ-Kennung. Ohne Abgleich stand sie
    // dann zweimal in der Liste. Abgeglichen wird ueber die DOI — aber OHNE
    // die Kennung einer schon bekannten Arbeit zu wechseln: Die spaetere
    // Zeile wird der zuerst gesehenen zugeschlagen, deren Kennung bleibt
    // Hauptkennung. So bleiben Tags, Auswahl und Korpus, die in
    // slr_global_tags.json unter dieser Kennung stehen, erhalten; was unter
    // der Nebenkennung stand, wird feldweise mit angezeigt
    // (mergedAnnotation). Gespeichert wird weiterhin unter der Hauptkennung.
    const doiToId = new Map();  // normalisierte DOI → Hauptkennung

    // Index-based rather than for-of: the position in the raw searchLog array
    // is the same handle the History view and every backend mutation use, so
    // recording it here means "show only this query's articles" needs no second
    // lookup table and no id of its own.
    for (let runIndex = 0; runIndex < searchLog.length; runIndex++) {
      const run = searchLog[runIndex];
      if (!run || !Array.isArray(run.results)) continue;
      for (const r of run.results) {
        let id = r.eid || r.doi || null;
        if (!id) continue;
        const doiKey = normDoi(r.doi);
        if (!seen.has(id) && doiKey && doiToId.has(doiKey) && doiToId.get(doiKey) !== id) {
          const haupt = seen.get(doiToId.get(doiKey));
          if (!Array.isArray(haupt._aliases)) haupt._aliases = [];
          if (!haupt._aliases.includes(id)) haupt._aliases.push(id);
          id = haupt._id;
        }
        const countryCodes = Array.isArray(r.affiliationCountries)
          ? [...new Set(r.affiliationCountries.filter(Boolean).map(code => String(code).trim().toUpperCase()))]
          : [];
        const affiliations = Array.isArray(r.affiliations)
          ? [...new Set(r.affiliations.filter(Boolean).map(value => String(value).trim()).filter(Boolean))]
          : [];
        const openAlexFields = Array.isArray(r.openAlexFields)
          ? [...new Set(r.openAlexFields.filter(Boolean).map(value => String(value).trim()).filter(Boolean))]
          : [];
        const openAlexSubfields = Array.isArray(r.openAlexSubfields)
          ? [...new Set(r.openAlexSubfields.filter(Boolean).map(value => String(value).trim()).filter(Boolean))]
          : [];

        if (!seen.has(id)) {
          seen.set(id, Object.assign({}, r, {
            _id:       id,
            citedby:   parseInt(r.citedby, 10) || 0,
            yearNum:   r.date ? parseInt(r.date.slice(0, 4), 10) : 0,
            affiliationCountries: countryCodes,
            affiliations,
            openAlexFields,
            openAlexSubfields,
            // Every run this article was returned by. An article found twice
            // belongs to both queries, so this is a list and not a single
            // value — filtering by one query must not hide it from the other.
            _runs: [runIndex],
          }));
          order.push(id);
          if (doiKey && !doiToId.has(doiKey)) doiToId.set(doiKey, id);
        } else {
          // Merge: prefer non-empty abstract; keep higher cited count
          const existing = seen.get(id);
          if (!Array.isArray(existing._runs)) existing._runs = [];
          if (!existing._runs.includes(runIndex)) existing._runs.push(runIndex);
          if (!existing.abstract && r.abstract) existing.abstract = r.abstract;
          if (!existing.doi && r.doi) {
            existing.doi = r.doi;
            if (doiKey && !doiToId.has(doiKey)) doiToId.set(doiKey, id);
          }
          const nc = parseInt(r.citedby, 10) || 0;
          if (nc > existing.citedby) existing.citedby = nc;
          if (countryCodes.length) {
            const mergedCountries = new Set(Array.isArray(existing.affiliationCountries) ? existing.affiliationCountries : []);
            for (const code of countryCodes) mergedCountries.add(code);
            existing.affiliationCountries = [...mergedCountries];
          }
          if (affiliations.length) {
            const mergedAffiliations = new Set(Array.isArray(existing.affiliations) ? existing.affiliations : []);
            for (const value of affiliations) mergedAffiliations.add(value);
            existing.affiliations = [...mergedAffiliations];
          }
          if (openAlexFields.length) {
            const mergedFields = new Set(Array.isArray(existing.openAlexFields) ? existing.openAlexFields : []);
            for (const value of openAlexFields) mergedFields.add(value);
            existing.openAlexFields = [...mergedFields];
          }
          if (openAlexSubfields.length) {
            const mergedSubfields = new Set(Array.isArray(existing.openAlexSubfields) ? existing.openAlexSubfields : []);
            for (const value of openAlexSubfields) mergedSubfields.add(value);
            existing.openAlexSubfields = [...mergedSubfields];
          }
          if (!Array.isArray(existing.referencedWorks) || !existing.referencedWorks.length) {
            if (Array.isArray(r.referencedWorks) && r.referencedWorks.length) existing.referencedWorks = r.referencedWorks;
          }
        }
      }
    }

    // Attach annotations; prefer canonical alias label for display
    const tagAliases = projectData.tagAliases || {};
    for (const id of order) {
      const art  = seen.get(id);
      const ann  = mergedAnnotation(globalTags, id, art._aliases);
      art.color    = ann.color    || 'None';
      // Use canonical alias from tag_aliases.json if available; fallback to stored tag
      art.tag      = tagAliases[art.color] || ann.tag || art.color || 'None';
      if (art.tag === 'None' && art.color === 'None') art.tag = 'None';
      art.comment  = ann.comment  || '';
      art.selected = ann.selected || false;
      art.corpus   = ann.corpus   || false;
    }

    return order.map(id => seen.get(id));
  }

  /**
   * Compute summary statistics for a set of articles.
   * @param {Array} articles
   * @returns {Object} { total, selected, corpus, byTag }
   */
  function getStats(articles) {
    const byTag = {};
    let selected = 0, corpus = 0;

    for (const a of articles) {
      if (a.selected) selected++;
      if (a.corpus)   corpus++;
      const t = a.tag || 'None';
      byTag[t] = (byTag[t] || 0) + 1;
    }

    return { total: articles.length, selected, corpus, byTag };
  }

  // ── Ablageform 2: jede Arbeit einmal ───────────────────────────────────────
  //
  // Bis zum 18.09.2026 hielt `search_log.json` je Suchlauf dessen vollstaendige
  // Trefferliste. Eine Arbeit, die vier Suchen zurueckgaben, stand viermal in
  // der Datei — an zehn realen Projekten gemessen 58 % des Inhalts, in einem
  // Projekt der Faktor 10,2. Die Zusammenfuehrung lief immer nur beim Lesen.
  //
  // Ablageform 2 dreht das um:
  //
  //   { "format": 2,
  //     "works": { "<kennung>": { …ein Datensatz… }, … },
  //     "runs":  [ { "timestamp", "query", "view", "results": ["<kennung>", …] } ] }
  //
  // Wichtig, und der Grund, warum das keine Auswirkung auf den Rest der
  // Anwendung hat: Welcher Lauf welchen Treffer zurueckgab, bleibt vollstaendig
  // erhalten — nur als Kennung statt als Kopie. `expandSearchLog` stellt beim
  // Lesen genau die Form wieder her, die es immer gab, weshalb getArticles,
  // die Ansichten, das Abfrageprotokoll und das PRISMA-Diagramm unveraendert
  // weiterarbeiten. PRISMA zaehlt `run.results.length`; eine Liste von
  // Kennungen ist genauso lang wie eine Liste von Datensaetzen. Der
  // Deduplikationsschritt des Diagramms zaehlt weiterhin dieselben Treffer,
  // weil er dieselbe Mehrfachnennung sieht.
  //
  // Ablageform 1 — das blanke Array von Laeufen — bleibt lesbar, fuer immer.
  // Umgestellt wird nur, was ohnehin geschrieben wird.

  const ABLAGEFORM = 2;

  /** Ist das die alte Form (ein Array von Laeufen)? */
  function istAlteForm(gespeichert) {
    return Array.isArray(gespeichert);
  }

  /**
   * Zwei Fassungen derselben Arbeit zu einer zusammenfuehren — dieselbe Regel,
   * die getArticles beim Lesen anwendet, damit das Zusammenlegen in der Datei
   * nichts anderes ergibt als das Zusammenlegen im Speicher: der vorhandene
   * Abstract schlaegt den fehlenden, die hoehere Zitationszahl gewinnt, Listen
   * werden vereinigt.
   */
  function mergeWork(vorhanden, neu) {
    if (!vorhanden) return Object.assign({}, neu);
    const out = Object.assign({}, vorhanden);
    for (const feld of Object.keys(neu)) {
      const wert = neu[feld];
      if (wert === undefined || wert === null || wert === '') continue;
      if (Array.isArray(wert)) {
        const zusammen = new Set(Array.isArray(out[feld]) ? out[feld] : []);
        for (const v of wert) if (v !== undefined && v !== null && v !== '') zusammen.add(v);
        out[feld] = [...zusammen];
      } else if (feld === 'citedby') {
        const alt = parseInt(out[feld], 10) || 0;
        const neuZahl = parseInt(wert, 10) || 0;
        if (neuZahl > alt) out[feld] = wert;
      } else if (out[feld] === undefined || out[feld] === null || out[feld] === '') {
        out[feld] = wert;
      }
    }
    return out;
  }

  /**
   * Was tatsaechlich abgelegt ist — Form und Groesse, gemessen am rohen
   * Dokument, bevor es entpackt wird.
   *
   * Ohne diese Angabe misst die Anzeige im Arbeitsbereich die entpackte Form
   * im Arbeitsspeicher und damit etwas, das so nirgends liegt: Nach einem
   * Verdichten stuende dort unveraendert dieselbe Mehrfachablage, obwohl die
   * Datei sie nicht mehr enthaelt — und das Angebot, noch einmal zu
   * verdichten, kaeme immer wieder. Beide Backends rufen das beim Lesen auf
   * und legen das Ergebnis als `searchLogStored` in die Projektdaten.
   */
  function describeStoredLog(roh) {
    if (roh === null || roh === undefined) return { format: 1, bytes: 0 };
    return {
      format: istAlteForm(roh) ? 1 : 2,
      bytes:  jsonBytes(roh),
    };
  }

  /**
   * Gespeicherte Form → die Form, die die Anwendung kennt: ein Array von
   * Laeufen, jeder mit vollstaendigen Datensaetzen in `results`.
   *
   * Beide Ablageformen gehen hinein, immer dasselbe kommt heraus. Eine Kennung
   * ohne Eintrag in `works` — theoretisch moeglich, wenn jemand die Datei von
   * Hand bearbeitet hat — wird zu einem Datensatz, der nur aus seiner Kennung
   * besteht, statt den ganzen Lauf zu verlieren.
   */
  function expandSearchLog(gespeichert) {
    if (istAlteForm(gespeichert)) return gespeichert;
    if (!gespeichert || typeof gespeichert !== 'object') return [];
    const works = gespeichert.works || {};
    const runs  = Array.isArray(gespeichert.runs) ? gespeichert.runs : [];
    return runs.map(run => {
      const ids = Array.isArray(run.results) ? run.results : [];
      const results = ids.map(id => {
        if (id && typeof id === 'object') return id;    // schon ein Datensatz
        const w = works[id];
        if (!w) return { eid: String(id) };
        const out = Object.assign({}, w);
        // Die Kennung ist der Schluessel; im Datensatz steht sie nur, wenn sie
        // dort etwas anderes bedeutet (siehe compactSearchLog).
        if (out.eid === undefined && out.doi !== id) out.eid = id;
        return out;
      });
      return Object.assign({}, run, { results });
    });
  }

  /**
   * Die Form, die die Anwendung kennt → die gespeicherte Form 2.
   *
   * Verlustfrei in dem Sinn, der zaehlt: `expandSearchLog(compactSearchLog(x))`
   * liefert fuer jeden Lauf dieselbe Anzahl Treffer in derselben Reihenfolge,
   * und jeder Treffer traegt die zusammengefuehrten Angaben aller seiner
   * Fassungen. Das ist genau das, was getArticles ohnehin daraus gemacht
   * haette. Ein Treffer ohne jede Kennung kann nicht referenziert werden und
   * bleibt deshalb als ganzer Datensatz im Lauf stehen.
   */
  function compactSearchLog(runs) {
    const liste = Array.isArray(runs) ? runs : expandSearchLog(runs);
    const works = {};
    const neueRuns = liste.map(run => {
      const results = Array.isArray(run.results) ? run.results : [];
      const ids = results.map(r => {
        if (!r || typeof r !== 'object') return r;
        const id = r.eid || r.doi;
        if (!id) return r;                               // ohne Kennung: unveraendert
        // `eid` gleich dem Schluessel waere dieselbe Zeichenkette zweimal in
        // derselben Datei. Sie entfaellt — ausser wenn sie mit der DOI
        // zusammenfaellt, denn dann koennte das Lesen die beiden nicht mehr
        // auseinanderhalten und wuerde eine Kennung erfinden, die es nicht gab.
        const koerper = (r.eid === id && r.doi !== id)
          ? (() => { const o = Object.assign({}, r); delete o.eid; return o; })()
          : r;
        works[id] = mergeWork(works[id], koerper);
        return id;
      });
      return Object.assign({}, run, { results: ids });
    });
    return { format: ABLAGEFORM, works, runs: neueRuns };
  }

  // ── Aufbewahrung: nachladbare Felder abtragen ──────────────────────────────
  //
  // Was hier verschwindet, steht bei Crossref, OpenAlex oder PubMed weiterhin
  // und wird ueber dieselben Abrufe zurueckgeholt, die die Anwendung fuer die
  // Anreicherung ohnehin hat (Fetch). Was bleibt, ist alles, wovon das nicht
  // gilt: Kennungen, Datum, Titel, Zeitschrift, Typ, Zitationszahl — und jede
  // Angabe, die die Nutzerin selbst gemacht hat.
  const NACHLADBARE_FELDER = [
    'abstract', 'authors', 'affiliations', 'affiliationCountries',
    'affiliationSources', 'openAlexFields', 'openAlexSubfields', 'referencedWorks',
  ];

  /** Wurde diese Arbeit abgetragen? Dann steht das Datum im Datensatz. */
  function istAbgetragen(work) {
    return !!(work && work._pruned);
  }

  /**
   * Darf diese Arbeit abgetragen werden? Vier Bedingungen, alle notwendig.
   *
   *   1. Sie ist wiederbeschaffbar. Ohne DOI und ohne aufloesbare Kennung
   *      koennte niemand sie zurueckholen; dann bleibt sie vollstaendig.
   *   2. Sie ist nicht ausgewaehlt und nicht im Korpus. Ein Korpus, der durch
   *      eine Aufraeumung unbrauchbar wird, waere ein Fehler und keine
   *      Sparsamkeit — das ist die Bedingung, an der alles andere haengt.
   *   3. Der juengste Lauf, der sie zurueckgab, liegt hinter der Frist.
   *   4. Es ist ueberhaupt etwas abzutragen da.
   */
  function pruefeAbtragbar(work, id, letzterLauf, grenzeMs, globalTags, aliasVon) {
    if (!work || istAbgetragen(work)) return false;
    const wiederbeschaffbar = !!(work.doi || /^(openalex:|pmid:|doi:|crossref:|doaj:)/i.test(String(work.eid || id)));
    if (!wiederbeschaffbar) return false;
    const kennungen = [id, ...(aliasVon.get(id) || [])];
    for (const k of kennungen) {
      const ann = (globalTags || {})[k];
      if (ann && (ann.selected || ann.corpus)) return false;
    }
    if (grenzeMs !== Infinity && (!(letzterLauf > 0) || letzterLauf > grenzeMs)) return false;
    return NACHLADBARE_FELDER.some(f => {
      const v = work[f];
      return Array.isArray(v) ? v.length > 0 : (v !== undefined && v !== null && v !== '');
    });
  }

  /** Zeitstempel eines Laufs ("YYYY-MM-DD HH:MM:SS") als Millisekunden. */
  function laufZeit(run) {
    const roh = run && run.timestamp ? String(run.timestamp).trim() : '';
    if (!roh) return 0;
    const t = Date.parse(roh.replace(' ', 'T'));
    return Number.isFinite(t) ? t : Date.parse(roh) || 0;
  }

  /**
   * Was ein Abtragen mit dieser Frist bewirken wuerde — und, wenn `anwenden`
   * gesetzt ist, das Ergebnis gleich mit.
   *
   * Ohne `anwenden` veraendert diese Funktion nichts. Das ist der Probelauf:
   * Erst zeigen, was verschwaende, dann fragen, dann tun.
   *
   * @param {Object} projectData   geladenes Projekt
   * @param {Object} optionen      { tage, jetzt, anwenden }
   * @returns {Object} { arbeiten, bytes, geschuetzt, ohneKennung, zuJung, searchLog? }
   */
  function planPruning(projectData, optionen = {}) {
    const tage    = Number(optionen.tage) > 0 ? Number(optionen.tage) : 60;
    const jetzt   = optionen.jetzt !== undefined ? optionen.jetzt : Date.now();
    // `ohneFrist` laesst die Altersbedingung weg — dann zaehlt nur noch, ob
    // eine Arbeit wiederzubeschaffen und nicht ausgewaehlt ist. Die drei
    // anderen Bedingungen gelten unveraendert; Korpus und Auswahl bleiben
    // auch hier unberuehrt, denn sie sind der Grund, warum es die Pruefung
    // ueberhaupt gibt, und nicht eine Voreinstellung.
    const ohneFrist = !!optionen.ohneFrist;
    const grenze  = ohneFrist ? Infinity : jetzt - tage * 86400000;
    const runs    = (projectData && Array.isArray(projectData.searchLog)) ? projectData.searchLog : [];
    const globalTags = (projectData && projectData.globalTags) || {};

    // Nebenkennungen ueber die DOI, damit eine Auswahl, die unter der
    // Zweitkennung steht, die Hauptkennung ebenso schuetzt — dieselbe
    // Zusammenfuehrung, die getArticles vornimmt.
    const doiZuId  = new Map();
    const aliasVon = new Map();
    for (const run of runs) {
      for (const r of (Array.isArray(run.results) ? run.results : [])) {
        if (!r || typeof r !== 'object') continue;
        const id = r.eid || r.doi;
        if (!id) continue;
        const dk = normDoi(r.doi);
        if (!dk) continue;
        if (!doiZuId.has(dk)) { doiZuId.set(dk, id); continue; }
        const haupt = doiZuId.get(dk);
        if (haupt === id) continue;
        if (!aliasVon.has(haupt)) aliasVon.set(haupt, []);
        if (!aliasVon.get(haupt).includes(id)) aliasVon.get(haupt).push(id);
        if (!aliasVon.has(id)) aliasVon.set(id, []);
        if (!aliasVon.get(id).includes(haupt)) aliasVon.get(id).push(haupt);
      }
    }

    // Juengster Lauf je Arbeit, und die zusammengefuehrte Fassung.
    const juengster = new Map();
    const zusammen  = new Map();
    for (const run of runs) {
      const t = laufZeit(run);
      for (const r of (Array.isArray(run.results) ? run.results : [])) {
        if (!r || typeof r !== 'object') continue;
        const id = r.eid || r.doi;
        if (!id) continue;
        if (!juengster.has(id) || t > juengster.get(id)) juengster.set(id, t);
        zusammen.set(id, mergeWork(zusammen.get(id), r));
      }
    }

    let arbeiten = 0, bytes = 0, geschuetzt = 0, ohneKennung = 0, zuJung = 0, ohneZeit = 0;
    const abzutragen = new Set();
    for (const [id, work] of zusammen.entries()) {
      if (istAbgetragen(work)) continue;
      const wiederbeschaffbar = !!(work.doi || /^(openalex:|pmid:|doi:|crossref:|doaj:)/i.test(String(work.eid || id)));
      const kennungen = [id, ...(aliasVon.get(id) || [])];
      const gehalten = kennungen.some(k => {
        const ann = globalTags[k];
        return ann && (ann.selected || ann.corpus);
      });
      if (!wiederbeschaffbar) { ohneKennung++; continue; }
      if (gehalten) { geschuetzt++; continue; }
      // Ein Lauf ohne lesbaren Zeitstempel hat kein Alter; er wird gehalten,
      // aber nicht als "zu jung" gezaehlt — das waere eine Behauptung, die
      // die Daten nicht hergeben.
      if (!ohneFrist && !(juengster.get(id) > 0)) { ohneZeit++; continue; }
      if (!ohneFrist && juengster.get(id) > grenze) { zuJung++; continue; }
      if (!pruefeAbtragbar(work, id, juengster.get(id), grenze, globalTags, aliasVon)) continue;
      arbeiten++;
      for (const f of NACHLADBARE_FELDER) {
        if (work[f] !== undefined) bytes += jsonBytes(work[f]) + f.length + 4;
      }
      abzutragen.add(id);
    }

    const plan = { tage, ohneFrist, arbeiten, bytes, geschuetzt, ohneKennung, zuJung, ohneZeit,
                   gesamt: zusammen.size };
    if (!optionen.anwenden || !abzutragen.size) return plan;

    // Anwenden heisst: dieselbe Struktur noch einmal, mit den betroffenen
    // Feldern entfernt und einem Datum, das sagt, wann und wonach.
    const datum = new Date(jetzt).toISOString().slice(0, 10);
    plan.searchLog = runs.map(run => Object.assign({}, run, {
      results: (Array.isArray(run.results) ? run.results : []).map(r => {
        if (!r || typeof r !== 'object') return r;
        const id = r.eid || r.doi;
        if (!id || !abzutragen.has(id)) return r;
        const out = Object.assign({}, r);
        for (const f of NACHLADBARE_FELDER) delete out[f];
        out._pruned = datum;
        return out;
      }),
    }));
    return plan;
  }

  // ── Storage accounting ────────────────────────────────────────────────────
  //
  // What a project actually costs to keep, measured rather than estimated.
  // Pure and backend-agnostic like getArticles/getStats above: it reads an
  // already-loaded projectData and returns byte counts, nothing else. It
  // deletes nothing and proposes nothing — the Workspace view turns these
  // numbers into a picture, and any future thinning would be a separate,
  // explicit step.
  //
  // The unit is the byte length of the JSON as it is written. That is exactly
  // what the local backend puts on disk and exactly what crosses the wire to
  // Supabase on every save. What Postgres then occupies is smaller, because a
  // jsonb column past two kilobytes is compressed out of line — so the cloud
  // figure is an upper bound on stored size and an accurate one on transfer.

  // Identity and provenance. Without these a record cannot be found again in
  // the database it came from, so nothing may ever remove them.
  const FELD_KENNUNG = ['eid', 'doi', 'source', 'date'];

  // Small enough to be worth keeping for a readable list, and not worth a
  // network round trip to recover.
  const FELD_ANZEIGE = ['title', 'publicationName', 'citedby', 'docType'];

  // Written by the user, or derived from their decisions. No external source
  // can give these back. Most live in slr_global_tags.json; a few sit inside
  // old search logs written by the desktop application.
  const FELD_EIGEN = ['comment', 'custom_abstract', 'tag', 'color', 'selected', 'corpus', 'favorite', 'must_cite'];

  function jsonBytes(value) {
    if (value === undefined) return 0;
    // TextEncoder counts UTF-8 bytes; abstracts carry enough dashes, quotes
    // and diacritics that counting characters instead would understate them.
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  /**
   * Byte accounting for one already-loaded project.
   *
   * @param {Object} projectData  result of loadProjectData()
   * @returns {Object} counts in bytes, plus the row/work tallies behind them
   */
  function measureProject(projectData) {
    const searchLog = (projectData && Array.isArray(projectData.searchLog)) ? projectData.searchLog : [];

    // Die Groesse der gespeicherten Form, nicht der entpackten im
    // Arbeitsspeicher. `searchLogStored` liefert beide Backends beim Lesen mit;
    // fehlt es (etwa in einem Test mit untergeschobenen Daten), wird die
    // entpackte Form gemessen wie frueher.
    const abgelegt = projectData && projectData.searchLogStored;
    const bytes = {
      searchLog:  abgelegt ? abgelegt.bytes : jsonBytes(searchLog),
      globalTags: jsonBytes((projectData && projectData.globalTags) || {}),
      rest:       jsonBytes((projectData && projectData.tagsConfig) || {})
                + jsonBytes((projectData && projectData.tagAliases) || {})
                + jsonBytes((projectData && projectData.queryHistory) || {}),
    };
    bytes.total = bytes.searchLog + bytes.globalTags + bytes.rest;

    let rows = 0;
    let kennung = 0, anzeige = 0, nachladbar = 0, eigen = 0;
    // Exact size of the result records themselves. The per-field tally below
    // measures shares, not totals — it adds a few bytes of punctuation per
    // field that the real JSON writes only once — so the two are kept apart
    // and the shares are scaled onto this figure at the end.
    let satzBytesGenau = 0;
    const jeFeld = {};
    // Largest copy seen per work — the yardstick for what one copy would
    // cost, since the read-side merge already prefers the fuller record.
    const groesste = new Map();

    for (const run of searchLog) {
      if (!run || !Array.isArray(run.results)) continue;
      for (const r of run.results) {
        rows++;
        satzBytesGenau += jsonBytes(r);
        let satz = 0;
        for (const feld of Object.keys(r)) {
          const b = jsonBytes(r[feld]) + feld.length + 4;   // + "key":
          satz += b;
          jeFeld[feld] = (jeFeld[feld] || 0) + b;
          if (FELD_KENNUNG.includes(feld))      kennung    += b;
          else if (FELD_ANZEIGE.includes(feld)) anzeige    += b;
          else if (FELD_EIGEN.includes(feld))   eigen      += b;
          else                                  nachladbar += b;
        }
        const id = r.eid || r.doi;
        if (!id) continue;
        const bisher = groesste.get(id);
        if (bisher === undefined || satz > bisher) groesste.set(id, satz);
      }
    }

    // One copy per work, at its largest observed size. The difference to the
    // sum of all rows is what repeated runs cost — aber nur in Ablageform 1.
    // Ist die Datei schon verdichtet, steht jede Arbeit dort bereits einmal;
    // die Mehrfachnennung existiert dann nur noch als Verweisliste je Lauf und
    // kostet nichts mehr. Sie hier trotzdem zu melden, war der Fehler, der die
    // Anzeige nach dem Verdichten unveraendert liess.
    let einfach = 0;
    for (const b of groesste.values()) einfach += b;
    const alle = Object.values(jeFeld).reduce((a, b) => a + b, 0);
    const schonVerdichtet = !!(abgelegt && abgelegt.format >= 2);

    // Four bands that cover the whole project, not just its result records.
    // The annotation index and the saved query terms are the user's own work
    // as much as a comment written into an old desktop-era result row is, so
    // they belong in the same band; without them a project written by this
    // application would show no user data at all, which is the opposite of
    // true. Invariant: the four bands sum to bytes.total.
    // Die vier Baender decken das ganze Projekt ab. Verteilt wird die
    // tatsaechlich abgelegte Groesse des Abfrageprotokolls nach den Anteilen,
    // die die Feldzaehlung ergibt — so stimmt die Summe unabhaengig davon, in
    // welcher Ablageform die Datei liegt. Der Annotationsindex und die
    // gemerkten Suchbegriffe kommen als bekannte Groessen hinzu; sie sind die
    // Arbeit der Nutzerin und stehen im selben Band.
    const anteil = alle > 0 ? bytes.searchLog / alle : 0;
    const bands = {
      kennung:    Math.round(kennung * anteil),
      anzeige:    Math.round(anzeige * anteil),
      nachladbar: Math.round(nachladbar * anteil),
      eigen:      Math.round(eigen * anteil) + bytes.globalTags + bytes.rest,
    };
    // Rounding four shares can lose or gain a byte or two; the largest band
    // absorbs it so the four always add up to the figure shown above them.
    const rest = bytes.total - (bands.kennung + bands.anzeige + bands.nachladbar + bands.eigen);
    if (rest !== 0) {
      const groesstesBand = Object.keys(bands).reduce((a, b) => (bands[b] > bands[a] ? b : a));
      bands[groesstesBand] += rest;
    }

    return {
      rows,
      works: groesste.size,
      bytes,
      ergebnisse: alle,          // alle Trefferzeilen, entpackt gezaehlt
      einfach,                   // dieselben Arbeiten, je einmal
      // Was die Mehrfachablage in der DATEI kostet. In Ablageform 2: nichts.
      mehrfach: schonVerdichtet ? 0 : Math.max(0, alle - einfach),
      format: abgelegt ? abgelegt.format : 1,
      kennung, anzeige, nachladbar, eigen,
      bands,
      jeFeld,
    };
  }

  /** Sums measureProject over a { folder: projectData } map, skipping nulls. */
  function measureWorkspace(allProjectData) {
    const summe = {
      projects: 0, rows: 0, works: 0,
      bytes: { searchLog: 0, globalTags: 0, rest: 0, total: 0 },
      ergebnisse: 0, einfach: 0, mehrfach: 0,
      kennung: 0, anzeige: 0, nachladbar: 0, eigen: 0,
      bands: { kennung: 0, anzeige: 0, nachladbar: 0, eigen: 0 },
      altformat: 0,              // wie viele Projekte noch in Ablageform 1 liegen
      jeProjekt: {},
    };
    for (const [folder, pd] of Object.entries(allProjectData || {})) {
      if (!pd) continue;
      const m = measureProject(pd);
      summe.projects++;
      summe.rows       += m.rows;
      summe.works      += m.works;
      summe.ergebnisse += m.ergebnisse;
      summe.einfach    += m.einfach;
      summe.mehrfach   += m.mehrfach;
      summe.kennung    += m.kennung;
      summe.anzeige    += m.anzeige;
      summe.nachladbar += m.nachladbar;
      summe.eigen      += m.eigen;
      if (m.format < 2) summe.altformat++;
      for (const k of Object.keys(summe.bands)) summe.bands[k] += m.bands[k];
      summe.bytes.searchLog  += m.bytes.searchLog;
      summe.bytes.globalTags += m.bytes.globalTags;
      summe.bytes.rest       += m.bytes.rest;
      summe.bytes.total      += m.bytes.total;
      summe.jeProjekt[folder] = m;
    }
    return summe;
  }

  const dispatcher = {
    getBackend,
    setBackend,
    isBackendSupported,
    get workspaceLabel() { return backendModule().workspaceLabel; },
    get DEFAULT_TAGS_CONFIG() { return backendModule().DEFAULT_TAGS_CONFIG; },
    getArticles,
    getStats,
    expandSearchLog,
    describeStoredLog,
    compactSearchLog,
    planPruning,
    NACHLADBARE_FELDER,
    measureProject,
    measureWorkspace,
    normDoi,
  };

  for (const name of FORWARDED_METHODS) {
    dispatcher[name] = (...args) => backendModule()[name](...args);
  }

  return dispatcher;

})();
