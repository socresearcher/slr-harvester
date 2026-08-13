/**
 * SLR Harvester Web — Data Layer
 * Handles File System Access API, IndexedDB persistence, and data loading.
 *
 * Global: window.SLRData
 */

window.SLRData = (() => {

  // ── IndexedDB helpers ─────────────────────────────────────────────────────

  const DB_NAME    = 'slr-harvester-web';
  const DB_VERSION = 1;
  const STORE_NAME = 'handles';
  const HANDLE_KEY = 'root';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  async function saveHandle(handle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function loadStoredHandle() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  // ── Internal state ────────────────────────────────────────────────────────

  let _rootHandle = null;

  // ── File system helpers ───────────────────────────────────────────────────

  /**
   * Read a JSON file from a directory handle.
   * @param {FileSystemDirectoryHandle} dir
   * @param {string} filename
   * @returns parsed JSON or null if file not found
   */
  async function readJSON(dir, filename) {
    try {
      const fh   = await dir.getFileHandle(filename);
      const file = await fh.getFile();
      // 10-second timeout in case OneDrive needs to download the file
      const text = await Promise.race([
        file.text(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Read timeout')), 10000))
      ]);
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  /**
   * Get a sub-directory handle, returns null if not found.
   */
  async function getSubdir(dir, name) {
    try {
      return await dir.getDirectoryHandle(name);
    } catch (_) {
      return null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Prompt user to pick the SLR Harvester root folder.
   * Stores handle in IndexedDB.
   * @returns {FileSystemDirectoryHandle}
   */
  async function openFolder() {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _rootHandle  = handle;
    await saveHandle(handle);
    return handle;
  }

  /**
   * Try to restore a previously selected folder from IndexedDB.
   * Asks for permission if needed.
   * @returns {FileSystemDirectoryHandle|null}
   */
  async function restoreFolder() {
    try {
      const stored = await loadStoredHandle();
      if (!stored) return null;

      // Try readwrite first (covers read too); fall back to read-only.
      let perm = await stored.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        // Silently check read — never call requestPermission here (needs user gesture).
        perm = await stored.queryPermission({ mode: 'read' });
        if (perm !== 'granted') return null;
      }

      _rootHandle = stored;
      return stored;
    } catch (_) {
      return null;
    }
  }

  /**
   * Load projects.json from the root folder.
   * A missing projects.json is not an error — it means this folder hasn't
   * been used as an SLR Harvester workspace yet (e.g. a first-time user
   * picked a fresh empty folder). Treat it as zero projects; createProject()
   * already writes projects.json + projects/ on first use.
   * @returns {Array} array of project objects
   */
  async function loadProjects() {
    if (!_rootHandle) throw new Error('No folder open');
    const data = await readJSON(_rootHandle, 'projects.json');
    if (data === null) return [];
    if (!Array.isArray(data.projects)) return [];
    return data.projects;
  }

  /**
   * Read slr_config.json from the root folder.
   * @returns {{ APIKey: string, InstToken: string }|null}
   */
  async function loadConfig() {
    if (!_rootHandle) return null;
    return await readJSON(_rootHandle, 'slr_config.json');
  }

  /**
   * Load all data for a specific project folder.
   * @param {string} folderName  e.g. "20260416_193649"
   * @returns {Object} { searchLog, globalTags, tagsConfig, queryHistory }
   */
  async function loadProjectData(folderName) {
    if (!_rootHandle) throw new Error('No folder open');

    const projectsDir = await getSubdir(_rootHandle, 'projects');
    if (!projectsDir) throw new Error('projects/ folder not found');

    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);

    const [searchLog, globalTags, tagsConfig, queryHistory, tagAliases] = await Promise.all([
      readJSON(projDir, 'search_log.json'),
      readJSON(projDir, 'slr_global_tags.json'),
      readJSON(projDir, 'tags_config.json'),
      readJSON(projDir, 'query_history.json'),
      readJSON(projDir, 'tag_aliases.json'),
    ]);

    return {
      folderName,
      searchLog:    Array.isArray(searchLog)  ? searchLog  : [],
      globalTags:   globalTags  || {},
      tagsConfig:   tagsConfig  || {},
      tagAliases:   tagAliases  || {},
      queryHistory: queryHistory || { terms: [] },
    };
  }

  /**
   * Deduplicate articles from all query runs and merge annotations.
   * Articles are keyed by EID (fallback: DOI).
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

  /**
   * Prepend a new search result entry to search_log.json (requires write access).
   */
  async function appendSearchResult(folderName, entry) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required. Please grant write permission to save results.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    if (!projectsDir) throw new Error('projects/ folder not found');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const existing = (await readJSON(projDir, 'search_log.json')) || [];
    existing.unshift(entry); // newest first
    await writeJSON(projDir, 'search_log.json', existing);
  }

  /**
   * Delete a search result entry from search_log.json by index (requires write access).
   * @param {string} folderName - project workspace folder
   * @param {number} index - index of the entry to delete (0 = newest)
   */
  async function deleteSearchResult(folderName, index) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required. Please grant write permission to delete queries.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    if (!projectsDir) throw new Error('projects/ folder not found');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const existing = (await readJSON(projDir, 'search_log.json')) || [];
    if (index < 0 || index >= existing.length) throw new Error('Invalid query index');
    existing.splice(index, 1);
    await writeJSON(projDir, 'search_log.json', existing);
  }

  /**
   * Merge new terms into query_history.json (sorted alphabetically).
   */
  async function saveQueryTerms(folderName, newTerms) {
    try {
      const hasWrite = await ensureWriteAccess();
      if (!hasWrite) return;
      const projectsDir = await getSubdir(_rootHandle, 'projects');
      if (!projectsDir) return;
      const projDir = await getSubdir(projectsDir, folderName);
      if (!projDir) return;
      const existing = (await readJSON(projDir, 'query_history.json')) || { terms: [] };
      const terms = Array.isArray(existing.terms) ? existing.terms : [];
      for (const t of newTerms) {
        if (!terms.includes(t)) terms.push(t);
      }
      terms.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      await writeJSON(projDir, 'query_history.json', { terms });
    } catch (_) { /* non-fatal */ }
  }

  /**
   * Delete a single search term from query_history.json.
   * @param {string} folderName
   * @param {string} termToDelete
   */
  async function deleteQueryTerm(folderName, termToDelete) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required. Please grant write permission to delete search terms.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    if (!projectsDir) throw new Error('projects/ folder not found');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);

    const existing = (await readJSON(projDir, 'query_history.json')) || { terms: [] };
    const terms = Array.isArray(existing.terms) ? existing.terms : [];
    const needle = String(termToDelete || '').trim().toLowerCase();
    if (!needle) return;

    const filtered = terms.filter(term => String(term || '').trim().toLowerCase() !== needle);
    await writeJSON(projDir, 'query_history.json', { terms: filtered });
  }

  /**
   * Update (or create) the annotation for one article in slr_global_tags.json.
   * fields: any subset of { selected, corpus, tag, color, comment }
   */
  async function updateArticleAnnotation(folderName, eid, fields) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required. Grant folder permission to save annotations.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    if (!projectsDir) throw new Error('projects/ folder not found');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const globalTags = (await readJSON(projDir, 'slr_global_tags.json')) || {};
    globalTags[eid] = {
      ...globalTags[eid] || {},
      ...fields,
      last_modified: new Date().toISOString(),
    };
    await writeJSON(projDir, 'slr_global_tags.json', globalTags);
    return globalTags[eid];
  }

  /**
   * Write multiple annotation updates at once (batch).
   * @param {string} folderName - project workspace folder
   * @param {Object} updates    - { [eid]: { color, tag, ... } }
   */
  async function bulkUpdateAnnotations(folderName, updates) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required. Grant folder permission to save annotations.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    if (!projectsDir) throw new Error('projects/ folder not found');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const globalTags = (await readJSON(projDir, 'slr_global_tags.json')) || {};
    const now = new Date().toISOString();
    for (const [eid, fields] of Object.entries(updates)) {
      globalTags[eid] = { ...globalTags[eid] || {}, ...fields, last_modified: now };
    }
    await writeJSON(projDir, 'slr_global_tags.json', globalTags);
    return globalTags;
  }

  /** Save tag_aliases.json for a project. */
  async function saveTagAliases(folderName, aliases) {    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    const projDir     = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    await writeJSON(projDir, 'tag_aliases.json', aliases);
  }

  /** Save tags_config.json for a project. */
  async function saveTagsConfig(folderName, config) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    const projDir     = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    await writeJSON(projDir, 'tags_config.json', config);
  }

  // ── Write helpers ─────────────────────────────────────────────────────────

  /**
   * Write a JSON file to a directory handle (requires readwrite permission).
   */
  async function writeJSON(dir, filename, data) {
    const fh       = await dir.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  /**
   * Ensure the root handle has readwrite permission. Prompts user if needed.
   * @returns {boolean} true if write access was granted
   */
  async function ensureWriteAccess() {
    if (!_rootHandle) return false;
    let perm = await _rootHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await _rootHandle.requestPermission({ mode: 'readwrite' });
    }
    return perm === 'granted';
  }

  const DEFAULT_TAGS_CONFIG = {
    "None": "",
    "Red":        "#ef4444",
    "Orange":     "#f97316",
    "Yellow":     "#eab308",
    "Green":      "#22c55e",
    "Turquoise":  "#06b6d4",
    "Blue":       "#3b82f6",
    "Violet":     "#8b5cf6",
    "Pink":       "#ec4899",
    "Magenta":    "#d946ef",
    "Brown":      "#a16207",
    "Gray":       "#64748b",
    "Olive":      "#84cc16",
    "Lavender":   "#818cf8",
    "Dark Red":   "#b91c1c",
    "Steel Blue": "#0ea5e9",
    "Coral":      "#f43f5e",
    "Gold":       "#d97706",
    "Teal":       "#14b8a6",
    "Indigo":     "#6366f1",
  };

  /**
   * Create a new SLR project in the root folder.
   * @param {string} name         Project display name
   * @param {string} description  Optional description
   * @returns {string} the new workspace_folder name
   */
  async function createProject(name, description) {
    if (!_rootHandle) throw new Error('No folder open');

    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write permission was denied. Cannot create project.');

    // Build timestamp folder name e.g. 20260528_143022
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const folderName = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
                     + `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    // Create projects/ dir and new project sub-dir
    const projectsDir = await _rootHandle.getDirectoryHandle('projects', { create: true });
    const projDir     = await projectsDir.getDirectoryHandle(folderName, { create: true });

    // Write initial skeleton files
    await writeJSON(projDir, 'search_log.json',    []);
    await writeJSON(projDir, 'slr_global_tags.json', {});
    await writeJSON(projDir, 'query_history.json', { terms: [] });
    await writeJSON(projDir, 'tags_config.json',   DEFAULT_TAGS_CONFIG);

    // Update projects.json
    const existing = (await readJSON(_rootHandle, 'projects.json')) || { projects: [] };
    if (!Array.isArray(existing.projects)) existing.projects = [];
    existing.projects.push({
      name,
      description: description || 'No description',
      created:     today,
      workspace_folder: folderName,
    });
    await writeJSON(_rootHandle, 'projects.json', existing);

    return folderName;
  }

  /**
   * Patch abstracts back into search_log.json.
   * @param {string} folderName - project workspace folder
   * @param {Object} abstractMap - { [eid]: abstractText }
   */
  async function patchSearchLogAbstracts(folderName, abstractMap, options = {}) {
    const overwrite = !!options.overwrite;
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const log = (await readJSON(projDir, 'search_log.json')) || [];
    for (const entry of log) {
      if (!Array.isArray(entry.results)) continue;
      for (const result of entry.results) {
        const eid = result.eid;
        if (eid && abstractMap[eid] && (overwrite || !result.abstract)) {
          result.abstract = abstractMap[eid];
        }
      }
    }
    await writeJSON(projDir, 'search_log.json', log);
  }

  async function patchSearchLogDocTypes(folderName, docTypeMap) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const log = (await readJSON(projDir, 'search_log.json')) || [];
    for (const entry of log) {
      if (!Array.isArray(entry.results)) continue;
      for (const result of entry.results) {
        const eid = result.eid;
        if (eid && docTypeMap[eid]) {
          result.docType = docTypeMap[eid];
        }
      }
    }
    await writeJSON(projDir, 'search_log.json', log);
  }

  async function patchSearchLogAuthors(folderName, authorsMap) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const log = (await readJSON(projDir, 'search_log.json')) || [];
    for (const entry of log) {
      if (!Array.isArray(entry.results)) continue;
      for (const result of entry.results) {
        const eid = result.eid;
        if (eid && authorsMap[eid]) {
          result.authors = authorsMap[eid];
        }
      }
    }
    await writeJSON(projDir, 'search_log.json', log);
  }

  async function patchSearchLogAffiliations(folderName, affiliationMap) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const log = (await readJSON(projDir, 'search_log.json')) || [];
    for (const entry of log) {
      if (!Array.isArray(entry.results)) continue;
      for (const result of entry.results) {
        const eid = result.eid;
        const update = eid && affiliationMap[eid];
        if (!update) continue;
        if (Array.isArray(update.affiliations)) result.affiliations = update.affiliations;
        if (Array.isArray(update.affiliationCountries)) result.affiliationCountries = update.affiliationCountries;
        if (Array.isArray(update.affiliationSources)) result.affiliationSources = update.affiliationSources;
      }
    }
    await writeJSON(projDir, 'search_log.json', log);
  }

  return {
    get rootHandle() { return _rootHandle; },
    openFolder,
    restoreFolder,
    loadProjects,
    saveProjectMeta,
    loadConfig,
    loadProjectData,
    getArticles,
    getStats,
    appendSearchResult,
    deleteSearchResult,
    patchSearchLogAbstracts,
    patchSearchLogDocTypes,
    patchSearchLogAuthors,
    patchSearchLogAffiliations,
    saveQueryTerms,
    deleteQueryTerm,
    updateArticleAnnotation,
    bulkUpdateAnnotations,
    saveTagAliases,
    saveTagsConfig,
    createProject,
    ensureWriteAccess,
    DEFAULT_TAGS_CONFIG,
  };

  /**
   * Update name and/or description of an existing project in projects.json.
   */
  async function saveProjectMeta(folderName, name, description) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required.');
    const existing = (await readJSON(_rootHandle, 'projects.json')) || { projects: [] };
    if (!Array.isArray(existing.projects)) existing.projects = [];
    const proj = existing.projects.find(p => p.workspace_folder === folderName);
    if (!proj) throw new Error('Project not found in projects.json');
    if (name)        proj.name        = name.trim();
    if (description !== undefined) proj.description = description.trim();
    await writeJSON(_rootHandle, 'projects.json', existing);
    return proj;
  }

})();
