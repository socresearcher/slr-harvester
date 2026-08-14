/**
 * SLR Harvester Web — Supabase (cloud sync) data backend
 * Implements the same function surface as data-local.js, backed by a
 * Supabase project (Postgres + Auth) instead of the File System Access API.
 * See slr-harvester-web/supabase/schema.sql for the table/RLS definitions
 * this backend assumes.
 *
 * Global: window.SLRDataCloud
 */

window.SLRDataCloud = (() => {

  const URL_KEY = 'slr-supabase-url';
  const KEY_KEY = 'slr-supabase-anon-key';

  let _client = null;
  let _user   = null; // the signed-in Supabase auth user, once known

  /** Returns a Supabase client for the stored project URL/anon key, or null
   *  if either hasn't been configured yet in Settings. */
  function getClient() {
    if (_client) return _client;
    const url = localStorage.getItem(URL_KEY);
    const key = localStorage.getItem(KEY_KEY);
    if (!url || !key) return null;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase SDK failed to load.');
    }
    _client = window.supabase.createClient(url, key);
    return _client;
  }

  /** Store the Project URL + anon key (from Settings) and reset the client
   *  so the next call picks them up. */
  function configure(url, key) {
    localStorage.setItem(URL_KEY, (url || '').trim());
    localStorage.setItem(KEY_KEY, (key || '').trim());
    _client = null;
    _user = null;
  }

  function getCredentials() {
    return {
      url: localStorage.getItem(URL_KEY) || '',
      key: localStorage.getItem(KEY_KEY) || '',
    };
  }

  function isConfigured() {
    const { url, key } = getCredentials();
    return !!(url && key);
  }

  function requireClient() {
    const client = getClient();
    if (!client) throw new Error('Enter your Supabase Project URL and anon key in Settings first.');
    return client;
  }

  function requireAuth() {
    const client = requireClient();
    if (!_user) throw new Error('Not signed in.');
    return client;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async function signUp(email, password) {
    const client = requireClient();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    _user = data.user;
    return data.user;
  }

  async function signIn(email, password) {
    const client = requireClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    _user = data.user;
    return data.user;
  }

  async function signInWithMagicLink(email) {
    const client = requireClient();
    const { error } = await client.auth.signInWithOtp({ email });
    if (error) throw error;
  }

  async function signOut() {
    const client = getClient();
    if (client) await client.auth.signOut();
    _user = null;
  }

  /** Restore a previously signed-in session (the Supabase client persists its
   *  own token in localStorage, so this is just asking it what it already
   *  knows) — the cloud-backend analogue of restoreFolder(). */
  async function restoreSession() {
    const client = getClient();
    if (!client) return false;
    try {
      const { data, error } = await client.auth.getSession();
      if (error || !data || !data.session) return false;
      _user = data.session.user;
      return true;
    } catch (_) {
      return false;
    }
  }

  function currentUser() {
    return _user;
  }

  // ── Workspace-abstraction methods (mirror data-local.js) ────────────────────

  function hasWorkspace() {
    return !!_user;
  }

  async function ensureWriteAccess() {
    // RLS is the real access gate; being signed in is all "write access" means here.
    return !!_user;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function loadProjects() {
    const client = requireAuth();
    const { data, error } = await client
      .from('projects')
      .select('name, description, created, workspace_folder')
      .order('created', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function loadConfig() {
    const client = getClient();
    if (!client || !_user) return null;
    const { data, error } = await client
      .from('user_settings')
      .select('api_key, inst_token, openalex_key, openalex_email')
      .eq('user_id', _user.id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      APIKey: data.api_key || '',
      InstToken: data.inst_token || '',
      OpenAlexKey: data.openalex_key || '',
      OpenAlexEmail: data.openalex_email || '',
    };
  }

  async function saveConfig(patch) {
    if (!_user) return false;
    const client = requireAuth();
    const row = { user_id: _user.id };
    if (patch.APIKey !== undefined)      row.api_key = patch.APIKey;
    if (patch.InstToken !== undefined)   row.inst_token = patch.InstToken;
    if (patch.OpenAlexKey !== undefined) row.openalex_key = patch.OpenAlexKey;
    if (patch.OpenAlexEmail !== undefined) row.openalex_email = patch.OpenAlexEmail;
    const { error } = await client.from('user_settings').upsert(row, { onConflict: 'user_id' });
    return !error;
  }

  async function loadProjectData(folderName) {
    const client = requireAuth();
    const { data, error } = await client
      .from('projects')
      .select('search_log, global_tags, tags_config, tag_aliases, query_history')
      .eq('workspace_folder', folderName)
      .single();
    if (error) throw error;
    return {
      folderName,
      searchLog:    Array.isArray(data.search_log) ? data.search_log : [],
      globalTags:   data.global_tags   || {},
      tagsConfig:   data.tags_config   || {},
      tagAliases:   data.tag_aliases   || {},
      queryHistory: data.query_history || { terms: [] },
    };
  }

  /** Prepend a search run — done server-side in one statement (see
   *  append_search_log in schema.sql) so it never needs to read the
   *  existing log first, unlike every other write below. */
  async function appendSearchResult(folderName, entry) {
    const client = requireAuth();
    const { error } = await client.rpc('append_search_log', {
      p_workspace_folder: folderName,
      p_entry: entry,
    });
    if (error) throw error;
  }

  async function deleteSearchResult(folderName, index) {
    const client = requireAuth();
    const existing = (await loadSearchLog(client, folderName)) || [];
    if (index < 0 || index >= existing.length) throw new Error('Invalid query index');
    existing.splice(index, 1);
    await writeSearchLog(client, folderName, existing);
  }

  async function saveQueryTerms(folderName, newTerms) {
    try {
      const client = requireAuth();
      const { data, error } = await client
        .from('projects')
        .select('query_history')
        .eq('workspace_folder', folderName)
        .single();
      if (error) return;
      const existing = data.query_history || { terms: [] };
      const terms = Array.isArray(existing.terms) ? existing.terms : [];
      for (const t of newTerms) {
        if (!terms.includes(t)) terms.push(t);
      }
      terms.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      await client.from('projects').update({ query_history: { terms } }).eq('workspace_folder', folderName);
    } catch (_) { /* non-fatal, matches data-local.js */ }
  }

  async function deleteQueryTerm(folderName, termToDelete) {
    const client = requireAuth();
    const { data, error } = await client
      .from('projects')
      .select('query_history')
      .eq('workspace_folder', folderName)
      .single();
    if (error) throw error;
    const existing = data.query_history || { terms: [] };
    const terms = Array.isArray(existing.terms) ? existing.terms : [];
    const needle = String(termToDelete || '').trim().toLowerCase();
    if (!needle) return;
    const filtered = terms.filter(term => String(term || '').trim().toLowerCase() !== needle);
    const { error: updateError } = await client
      .from('projects')
      .update({ query_history: { terms: filtered } })
      .eq('workspace_folder', folderName);
    if (updateError) throw updateError;
  }

  /** Merge one article's annotation fields — done server-side via a shallow
   *  jsonb merge (see merge_global_tags in schema.sql) so two tabs editing
   *  different articles concurrently can't clobber each other; the full
   *  per-article object (existing + patch + timestamp) is still assembled
   *  here first, same shape data-local.js writes. */
  async function updateArticleAnnotation(folderName, eid, fields) {
    const client = requireAuth();
    const { data, error } = await client
      .from('projects')
      .select('global_tags')
      .eq('workspace_folder', folderName)
      .single();
    if (error) throw error;
    const globalTags = data.global_tags || {};
    const merged = {
      ...(globalTags[eid] || {}),
      ...fields,
      last_modified: new Date().toISOString(),
    };
    const { error: rpcError } = await client.rpc('merge_global_tags', {
      p_workspace_folder: folderName,
      p_updates: { [eid]: merged },
    });
    if (rpcError) throw rpcError;
    return merged;
  }

  async function bulkUpdateAnnotations(folderName, updates) {
    const client = requireAuth();
    const { data, error } = await client
      .from('projects')
      .select('global_tags')
      .eq('workspace_folder', folderName)
      .single();
    if (error) throw error;
    const globalTags = data.global_tags || {};
    const now = new Date().toISOString();
    const merged = {};
    for (const [eid, fields] of Object.entries(updates)) {
      merged[eid] = { ...(globalTags[eid] || {}), ...fields, last_modified: now };
    }
    const { error: rpcError } = await client.rpc('merge_global_tags', {
      p_workspace_folder: folderName,
      p_updates: merged,
    });
    if (rpcError) throw rpcError;
    return { ...globalTags, ...merged };
  }

  async function saveTagAliases(folderName, aliases) {
    const client = requireAuth();
    const { error } = await client.from('projects').update({ tag_aliases: aliases }).eq('workspace_folder', folderName);
    if (error) throw error;
  }

  async function saveTagsConfig(folderName, config) {
    const client = requireAuth();
    const { error } = await client.from('projects').update({ tags_config: config }).eq('workspace_folder', folderName);
    if (error) throw error;
  }

  async function createProject(name, description) {
    const client = requireAuth();
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const folderName = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
                     + `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const { error } = await client.from('projects').insert({
      user_id: _user.id,
      name,
      description: description || 'No description',
      created: today,
      workspace_folder: folderName,
      tags_config: DEFAULT_TAGS_CONFIG,
    });
    if (error) throw error;
    return folderName;
  }

  async function saveProjectMeta(folderName, name, description) {
    const client = requireAuth();
    const patch = {};
    if (name) patch.name = name.trim();
    if (description !== undefined) patch.description = description.trim();
    const { data, error } = await client
      .from('projects')
      .update(patch)
      .eq('workspace_folder', folderName)
      .select('name, description, workspace_folder')
      .single();
    if (error) throw error;
    return data;
  }

  // ── search_log read/write helpers (shared by the patch* functions below) ──

  async function loadSearchLog(client, folderName) {
    const { data, error } = await client
      .from('projects')
      .select('search_log')
      .eq('workspace_folder', folderName)
      .single();
    if (error) throw error;
    return Array.isArray(data.search_log) ? data.search_log : [];
  }

  async function writeSearchLog(client, folderName, log) {
    const { error } = await client.from('projects').update({ search_log: log }).eq('workspace_folder', folderName);
    if (error) throw error;
  }

  async function patchSearchLogAbstracts(folderName, abstractMap, options = {}) {
    const overwrite = !!options.overwrite;
    const client = requireAuth();
    const log = await loadSearchLog(client, folderName);
    for (const entry of log) {
      if (!Array.isArray(entry.results)) continue;
      for (const result of entry.results) {
        const eid = result.eid;
        if (eid && abstractMap[eid] && (overwrite || !result.abstract)) {
          result.abstract = abstractMap[eid];
        }
      }
    }
    await writeSearchLog(client, folderName, log);
  }

  async function patchSearchLogDocTypes(folderName, docTypeMap) {
    const client = requireAuth();
    const log = await loadSearchLog(client, folderName);
    for (const entry of log) {
      if (!Array.isArray(entry.results)) continue;
      for (const result of entry.results) {
        const eid = result.eid;
        if (eid && docTypeMap[eid]) result.docType = docTypeMap[eid];
      }
    }
    await writeSearchLog(client, folderName, log);
  }

  async function patchSearchLogAuthors(folderName, authorsMap) {
    const client = requireAuth();
    const log = await loadSearchLog(client, folderName);
    for (const entry of log) {
      if (!Array.isArray(entry.results)) continue;
      for (const result of entry.results) {
        const eid = result.eid;
        if (eid && authorsMap[eid]) result.authors = authorsMap[eid];
      }
    }
    await writeSearchLog(client, folderName, log);
  }

  async function patchSearchLogAffiliations(folderName, affiliationMap) {
    const client = requireAuth();
    const log = await loadSearchLog(client, folderName);
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
    await writeSearchLog(client, folderName, log);
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

  return {
    hasWorkspace,
    get workspaceLabel() { return _user ? _user.email : ''; },
    ensureWriteAccess,
    DEFAULT_TAGS_CONFIG,

    // Cloud-specific (used by the Settings/Welcome auth UI, not forwarded
    // through the generic dispatcher — called as SLRDataCloud.* directly)
    configure,
    getCredentials,
    isConfigured,
    signUp,
    signIn,
    signInWithMagicLink,
    signOut,
    restoreSession,
    currentUser,

    // Same surface as data-local.js
    loadProjects,
    saveProjectMeta,
    loadConfig,
    saveConfig,
    loadProjectData,
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
  };

})();
