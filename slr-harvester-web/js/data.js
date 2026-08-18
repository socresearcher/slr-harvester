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
    'patchSearchLogAuthors', 'patchSearchLogAffiliations', 'saveQueryTerms',
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
  function getArticles(projectData) {
    const { searchLog, globalTags } = projectData;

    const seen   = new Map();   // id → article
    const order  = [];          // insertion order of ids

    for (const run of searchLog) {
      if (!Array.isArray(run.results)) continue;
      for (const r of run.results) {
        const id = r.eid || r.doi || null;
        if (!id) continue;
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
          }));
          order.push(id);
        } else {
          // Merge: prefer non-empty abstract; keep higher cited count
          const existing = seen.get(id);
          if (!existing.abstract && r.abstract) existing.abstract = r.abstract;
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
        }
      }
    }

    // Attach annotations; prefer canonical alias label for display
    const tagAliases = projectData.tagAliases || {};
    for (const id of order) {
      const art  = seen.get(id);
      const ann  = globalTags[id] || {};
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
  };

  for (const name of FORWARDED_METHODS) {
    dispatcher[name] = (...args) => backendModule()[name](...args);
  }

  return dispatcher;

})();
