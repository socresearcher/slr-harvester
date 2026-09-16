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
    'patchSearchLogAuthors', 'patchSearchLogAffiliations', 'patchSearchLogReferencedWorks', 'saveQueryTerms',
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

  const dispatcher = {
    getBackend,
    setBackend,
    isBackendSupported,
    get workspaceLabel() { return backendModule().workspaceLabel; },
    get DEFAULT_TAGS_CONFIG() { return backendModule().DEFAULT_TAGS_CONFIG; },
    getArticles,
    getStats,
    normDoi,
  };

  for (const name of FORWARDED_METHODS) {
    dispatcher[name] = (...args) => backendModule()[name](...args);
  }

  return dispatcher;

})();
