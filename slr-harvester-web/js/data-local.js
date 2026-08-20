/**
 * SLR Harvester Web — Local (File System Access API) data backend
 * Handles File System Access API, IndexedDB persistence, and data loading.
 *
 * Global: window.SLRDataLocal
 */

window.SLRDataLocal = (() => {

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
   * Merge-write fields into slr_config.json in the currently open root folder,
   * creating the file if it doesn't exist yet. This is what makes API
   * credentials entered in Settings persist per-folder (matching the desktop
   * app's slr_config.json) instead of only living in this browser's
   * localStorage — critical so a key never silently follows the user from one
   * folder into an unrelated one.
   * @param {Object} patch  Fields to merge into the existing config, e.g. { APIKey, InstToken }
   * @returns {boolean} true if the write succeeded
   */
  async function saveConfig(patch) {
    if (!_rootHandle) return false;
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) return false;
    const existing = (await readJSON(_rootHandle, 'slr_config.json')) || {};
    await writeJSON(_rootHandle, 'slr_config.json', { ...existing, ...patch });
    return true;
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
   * Set (or clear) the archive/trash status of a search_log.json entry by
   * index (requires write access). status: 'active' | 'archived' | 'trashed'
   * — 'active' removes the field entirely so old projects stay clean.
   */
  async function setSearchResultStatus(folderName, index, status) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required. Please grant write permission to update queries.');
    const projectsDir = await getSubdir(_rootHandle, 'projects');
    if (!projectsDir) throw new Error('projects/ folder not found');
    const projDir = await getSubdir(projectsDir, folderName);
    if (!projDir) throw new Error(`Project folder "${folderName}" not found`);
    const existing = (await readJSON(projDir, 'search_log.json')) || [];
    if (index < 0 || index >= existing.length) throw new Error('Invalid query index');
    if (status === 'active') delete existing[index].status;
    else existing[index].status = status;
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

  // Curated reference palette — NOT written into a new project's own
  // tags_config.json anymore (see createProject below). A tag only ever
  // gets created when the user adds one manually or auto-tag assigns a
  // category for the first time; this map is only consulted then, as the
  // starting hex for whichever color key is needed (auto-tag's built-in
  // categories use these exact keys — see JOURNAL_TAG_RULES in app.js).
  // Pre-seeding all 19 into every project used to leave most of them sitting
  // unused with a color no "Colour Scheme" apply could ever restore once a
  // scheme redistributed hues across however many tags actually existed.
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
    // A new project starts with no tags at all — one only ever appears once
    // the user adds it manually or auto-tag assigns it for the first time.
    await writeJSON(projDir, 'tags_config.json',   { "None": "" });

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

  /**
   * Set (or clear, passing null) a project's card icon: { type: 'emoji'|
   * 'svg'|'text', value: string }. Local-only counterpart to the
   * localStorage fallback used on the cloud backend, where the `projects`
   * table has no icon column to write to.
   */
  async function saveProjectIcon(folderName, icon) {
    const hasWrite = await ensureWriteAccess();
    if (!hasWrite) throw new Error('Write access required.');
    const existing = (await readJSON(_rootHandle, 'projects.json')) || { projects: [] };
    if (!Array.isArray(existing.projects)) existing.projects = [];
    const proj = existing.projects.find(p => p.workspace_folder === folderName);
    if (!proj) throw new Error('Project not found in projects.json');
    if (icon) proj.icon = icon; else delete proj.icon;
    await writeJSON(_rootHandle, 'projects.json', existing);
    return proj;
  }

  return {
    get rootHandle() { return _rootHandle; },
    hasWorkspace: () => !!_rootHandle,
    get workspaceLabel() { return _rootHandle ? _rootHandle.name : ''; },
    openFolder,
    restoreFolder,
    loadProjects,
    saveProjectMeta,
    saveProjectIcon,
    loadConfig,
    saveConfig,
    loadProjectData,
    appendSearchResult,
    deleteSearchResult,
    setSearchResultStatus,
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

})();
