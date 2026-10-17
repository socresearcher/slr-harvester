/**
 * SLR Harvester Web - App UI Shell Helpers
 * Keeps topbar/sidebar/theme/fullscreen logic outside app.js.
 *
 * Global: window.SLRAppUI
 */

window.SLRAppUI = (() => {

  // Visual themes (ported from the Dashboard). The keys are what goes into
  // html[data-style] and localStorage 'slr-style'; css/themes.css and
  // js/theme-early.js use the same list. 'standard' = no attribute.
  const STYLES = [
    ['standard', 'Default'], ['glass', 'Glass'], ['aurora', 'Aurora'], ['sunset', 'Sunset'], ['gloss', 'Gloss'],
    ['soft', 'Soft'], ['paper', 'Paper'], ['neon', 'Neon'], ['mono', 'Mono'], ['contour', 'Contour'],
  ];
  const THEME_MODES = [['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];

  const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  // state.theme is the CHOICE (auto | light | dark); the attribute on <html>
  // always carries the RESULT (light | dark), so every [data-theme] rule works
  // unchanged.
  function resolvedTheme(state) {
    return state.theme === 'light' ? 'light' : state.theme === 'auto' ? (prefersDark() ? 'dark' : 'light') : 'dark';
  }

  function applyTheme(state, $) {
    if (state.theme !== 'light' && state.theme !== 'auto') state.theme = 'dark';
    const resolved = resolvedTheme(state);
    document.documentElement.setAttribute('data-theme', resolved);
    try { localStorage.setItem('slr-theme', state.theme); } catch (e) { /* storage blocked */ }

    const icon = $('theme-icon');
    if (icon) icon.innerHTML = resolved === 'dark' ? SLRIcons.moon : SLRIcons.sun;

    const themeBtn = $('theme-toggle');
    if (themeBtn) themeBtn.classList.toggle('is-light', resolved === 'light');

    // Keep the browser chrome (status bar / safe-area fill) in sync with the
    // app background so mobile browsers don't paint that area white.
    const meta = $('theme-color-meta');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }
    syncAppearanceControls();
  }

  // The header switch flips between the two RESULTS and makes the choice
  // explicit (an 'auto' user who flips it gets a fixed light/dark afterwards).
  function toggleTheme(state, $) {
    state.theme = resolvedTheme(state) === 'dark' ? 'light' : 'dark';
    applyTheme(state, $);
  }

  function setThemeMode(state, $, mode) {
    state.theme = mode === 'light' || mode === 'auto' ? mode : 'dark';
    applyTheme(state, $);
  }

  function currentStyle() {
    const v = document.documentElement.getAttribute('data-style');
    return STYLES.some(x => x[0] === v && v !== 'standard') ? v : 'standard';
  }

  function applyStyle(style, $) {
    const valid = STYLES.some(x => x[0] === style) && style !== 'standard' ? style : 'standard';
    if (valid === 'standard') document.documentElement.removeAttribute('data-style');
    else document.documentElement.setAttribute('data-style', valid);
    try {
      if (valid === 'standard') localStorage.removeItem('slr-style');
      else localStorage.setItem('slr-style', valid);
    } catch (e) { /* storage blocked */ }
    // Some themes redefine --bg: refresh the browser-chrome colour.
    const meta = $ ? $('theme-color-meta') : null;
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }
    syncAppearanceControls();
  }

  // Settings > Appearance controls (rendered by views.js) reflect the state.
  function syncAppearanceControls() {
    const style = currentStyle();
    document.querySelectorAll('[data-style-key]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.styleKey === style)));
    const mode = (function () { try { return localStorage.getItem('slr-theme') || 'dark'; } catch (e) { return 'dark'; } })();
    document.querySelectorAll('[data-theme-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeMode === mode)));
  }

  function setSidebarCollapsed(state, sidebarEl, $) {
    state.sidebarCollapsed = !!state.sidebarCollapsed;
    if (sidebarEl) sidebarEl.classList.toggle('collapsed', state.sidebarCollapsed);
    localStorage.setItem('slr-sidebar-collapsed', state.sidebarCollapsed ? '1' : '0');

    const icon = $('sidebar-toggle-icon');
    if (icon) icon.innerHTML = state.sidebarCollapsed ? SLRIcons.chevronRight : SLRIcons.chevronLeft;

    // Der Schalter sagt, was ein Klick TUT, nicht was er war: Der Titel stand
    // fest auf "Collapse sidebar", auch bei eingeklappter Seitenleiste, und
    // Bildschirmleser erfuhren nie, ob sie offen ist.
    const btn = $('sidebar-toggle');
    if (btn) {
      const was = state.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
      btn.title = was;
      btn.setAttribute('aria-label', was);
      btn.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    }
    const menu = $('menu-btn');
    if (menu) menu.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
  }

  function toggleSidebar(state, sidebarEl, $) {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    setSidebarCollapsed(state, sidebarEl, $);
  }

  // Closes the sidebar if it is open. Expanded, it is an overlay sitting on
  // top of dimmed content, so it should get out of the way the moment the
  // user goes back to that content: clicking the dimmed area, switching
  // views, or pressing Escape.
  function collapseSidebar(state, sidebarEl, $) {
    if (state.sidebarCollapsed) return;
    state.sidebarCollapsed = true;
    setSidebarCollapsed(state, sidebarEl, $);
  }

  function injectIcons(state, $) {
    const logoEl = $('logo-icon');
    if (logoEl) logoEl.innerHTML = SLRIcons.logo;

    const map = {
      home: SLRIcons.home,
      databases: SLRIcons.databases,
      projects: SLRIcons.projects,
      search: SLRIcons.search,
      history: SLRIcons.history,
      articles: SLRIcons.articles,
      tags: SLRIcons.tag,
      selected: SLRIcons.selected,
      corpus: SLRIcons.corpus,
      chart: SLRIcons.chart,
      project: SLRIcons.project,
      autotag: SLRIcons.wand,
      settings: SLRIcons.settings,
      workspace: SLRIcons.folder,
      account: SLRIcons.user,
      info: SLRIcons.info,
    };

    document.querySelectorAll('[data-icon]').forEach(el => {
      const key = el.dataset.icon;
      if (map[key]) el.innerHTML = map[key];
    });

    const toggleIcon = $('sidebar-toggle-icon');
    if (toggleIcon) toggleIcon.innerHTML = state.sidebarCollapsed ? SLRIcons.chevronRight : SLRIcons.chevronLeft;
  }

  function updateTopbar(state, refs) {
    const titles = {
      welcome: 'Welcome',
      projects: 'Projects',
      search: 'Search',
      history: 'History',
      articles: 'Articles',
      selected: 'Selected',
      corpus: 'Corpus',
      visualizations: 'Visualisations',
      tags: 'Tags',
      'autotag-rules': 'Auto-Tag Rules',
      settings: 'Settings',
      workspace: 'Workspace',
      account: 'Account',
      about: 'About',
      databases: 'Databases',
      privacy: 'Privacy',
    };

    if (refs.viewTitle) refs.viewTitle.textContent = titles[state.view] || 'SLR Harvester Web';
    if (refs.projectBadge) refs.projectBadge.textContent = state.currentProject ? state.currentProject.name : '';

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === state.view);
    });
  }

  // Only Safari (desktop + iOS) still needs the -webkit- prefix for the
  // Fullscreen API; every other current browser (including Edge) supports
  // the unprefixed one. Checked in this order so unprefixed always wins
  // where both happen to exist.
  function fullscreenEnabled() {
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function requestFullscreen(el) {
    if (el.requestFullscreen) return el.requestFullscreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    return Promise.reject(new Error('Fullscreen API not available.'));
  }

  function exitFullscreen() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
    return Promise.reject(new Error('Fullscreen API not available.'));
  }

  function updateFullscreenButton($) {
    const icon = $('fullscreen-icon');
    const btn = $('fullscreen-toggle');
    if (!icon || !btn) return;

    const active = isFullscreen();
    icon.innerHTML = active ? SLRIcons.fullscreenExit : SLRIcons.fullscreen;
    btn.classList.toggle('is-active', active);
    btn.title = active ? 'Exit fullscreen' : 'Toggle fullscreen';
    btn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Toggle fullscreen');
  }

  async function toggleFullscreen(showToast, $) {
    // Genuinely unsupported (no Fullscreen API at all) is different from
    // blocked-in-this-context (e.g. loaded inside an iframe without an
    // `allow="fullscreen"` attribute, or disabled by an OS/enterprise
    // policy) — both report fullscreenEnabled:false, and no client-side
    // code can work around either, so this stays a plain notice either way.
    if (!fullscreenEnabled()) {
      showToast('Fullscreen is not supported (or is blocked) in this browser context.', true);
      return;
    }

    try {
      if (isFullscreen()) {
        await exitFullscreen();
      } else {
        await requestFullscreen(document.documentElement);
      }
    } catch (err) {
      showToast(`Unable to toggle fullscreen: ${err?.message || err}`, true);
    }

    updateFullscreenButton($);
  }

  // ── Header search (layout and behaviour ported from the Dashboard) ───────
  // One box for the whole app: views, a few settings, the projects of the
  // workspace and — when a project is open — its articles by title. Nothing
  // is fetched; it only reads what the app already holds.
  const SEARCH_GROUPS = ['Views', 'Settings', 'Projects', 'Articles'];
  const SEARCH_VIEWS = [
    ['welcome', 'Home', 'start welcome'],
    ['databases', 'Databases', 'scopus pubmed openalex arxiv semantic scholar sources'],
    ['projects', 'Projects', 'project folder cards'],
    ['search', 'Search', 'query boolean harvest databases run'],
    ['history', 'History', 'query history runs past searches'],
    ['articles', 'Articles', 'papers results screening list'],
    ['selected', 'Selected', 'shortlist chosen screening'],
    ['corpus', 'Corpus', 'final included set'],
    ['visualizations', 'Visualisations', 'charts prisma world map network years'],
    ['tags', 'Tags', 'labels colours schemes categories'],
    ['autotag-rules', 'Auto-Tag Rules', 'keywords disciplines automatic'],
    ['workspace', 'Workspace', 'folder local cloud storage'],
    ['account', 'Account', 'sign in login cloud'],
    ['settings', 'Settings', 'preferences options'],
    ['about', 'About', 'beta version license credits'],
    ['privacy', 'Privacy', 'data stored localstorage cookies'],
  ];
  const SEARCH_SETTINGS = [
    ['Appearance', 'Colour scheme and theme', 'theme dark light glass aurora neon mono paper soft contour sunset gloss style'],
    ['Scopus API', 'API key and institutional token', 'elsevier key token'],
    ['OpenAlex API', 'Key and e-mail', 'polite pool email key'],
    ['Fetch & auto-tag', 'Automation', 'auto fetch tag automation'],
    ['Guided mode', 'Short guides in each view', 'guide help tour'],
    ['Reading', 'Read-aloud voices', 'read aloud voice speech tts'],
  ];

  const norm = t => String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const escHtml = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function highlight(text, terms) {
    if (!terms.length) return escHtml(text);
    const re = new RegExp('(' + terms.map(escRe).join('|') + ')', 'gi');
    return String(text).split(re).map((p, i) => (i % 2 ? '<mark>' + escHtml(p) + '</mark>' : escHtml(p))).join('');
  }

  function initSearch({ state, navigate, openProjectDetail, collapseSidebar }) {
    const q = document.getElementById('q');
    const box = document.getElementById('sres');
    if (!q || !box) return;
    const open = new Set();
    let selected = 0;

    function entries() {
      const list = [];
      const add = (g, t, s, k, act) => list.push({ g, t: String(t), s: s ? String(s) : '', tw: norm(t), h: norm([t, s, k].join(' ')), act });
      SEARCH_VIEWS.forEach(([view, title, kw]) => add('Views', title, '', kw, { view }));
      SEARCH_SETTINGS.forEach(([title, sub, kw]) => add('Settings', title, sub, kw, { view: 'settings' }));
      (state.projects || []).forEach(p => {
        if (p && p.workspace_folder) add('Projects', p.name || p.workspace_folder, 'Project', 'project ' + (p.description || ''), { project: p.workspace_folder });
      });
      (state.articles || []).forEach(a => {
        if (a && a.title) add('Articles', a.title, [a.year, a.journal].filter(Boolean).join(' · '), (a.authors || '') + '', { article: a.title });
      });
      return list;
    }

    function matches(text) {
      const terms = norm(text).split(/\s+/).filter(Boolean);
      if (!terms.length) return { terms, list: [] };
      const list = [];
      for (const e of entries()) {
        const wt = e.tw.split(/[^a-z0-9]+/), wh = e.h.split(/[^a-z0-9]+/);
        let score = 0, ok = true;
        for (const t of terms) {
          if (wt.some(w => w.startsWith(t))) score += 5;
          else if (wh.some(w => w.startsWith(t))) score += 3;
          else if (e.h.includes(t)) score += 1;
          else { ok = false; break; }
        }
        if (ok) {
          if (e.tw.startsWith(terms[0])) score += 4;
          if (e.g === 'Views') score += 2;
          list.push({ e, score });
        }
      }
      list.sort((a, b) => b.score - a.score || a.e.t.localeCompare(b.e.t));
      return { terms, list };
    }

    function render() {
      const v = q.value.trim();
      if (!v) { box.hidden = true; box.innerHTML = ''; box._hits = []; q.setAttribute('aria-expanded', 'false'); return; }
      const { terms, list } = matches(v);
      q.setAttribute('aria-expanded', 'true');
      if (!list.length) { box.innerHTML = '<p class="sleer">Nothing found for “' + escHtml(v) + '”.</p>'; box._hits = []; box.hidden = false; return; }
      let html = '', n = 0;
      const hits = [];
      for (const g of SEARCH_GROUPS) {
        const all = list.filter(x => x.e.g === g);
        if (!all.length) continue;
        const shown = open.has(g) ? all.slice(0, 200) : all.slice(0, 6);
        html += '<div class="sgh">' + g + '<span>' + all.length + '</span></div>' + shown.map(({ e }) => {
          const i = n++;
          hits.push(e);
          return '<button type="button" class="sr' + (i === selected ? ' on' : '') + '" role="option" data-n="' + i + '">' +
            '<span class="srt">' + highlight(e.t, terms) + '</span>' +
            (e.s ? '<span class="srs">' + highlight(e.s, terms) + '</span>' : '') + '</button>';
        }).join('') + (all.length > shown.length && !open.has(g) ? '<button type="button" class="smehr" data-more="' + g + '">+ ' + (all.length - shown.length) + ' more in “' + g + '”</button>' : '');
      }
      box.innerHTML = html;
      box._hits = hits;
      box.hidden = false;
    }

    function close(clear) {
      box.hidden = true;
      q.setAttribute('aria-expanded', 'false');
      if (clear) { q.value = ''; box.innerHTML = ''; box._hits = []; }
    }

    function go(e) {
      if (!e) return;
      const a = e.act;
      close(true);
      q.blur();
      collapseSidebar();
      if (a.view) navigate(a.view);
      else if (a.project) openProjectDetail(a.project);
      else if (a.article) {
        // Show exactly this article in the list: filters reset, title search on.
        Object.assign(state.filter, { mode: 'all', tags: [], runIndex: null, yearFrom: '', yearTo: '', search: a.article, searchFields: ['title'], renderLimit: 200 });
        navigate('articles');
      }
    }

    q.addEventListener('input', () => { selected = 0; render(); });
    q.addEventListener('focus', () => { if (q.value.trim()) render(); });
    q.addEventListener('keydown', ev => {
      const items = [...box.querySelectorAll('.sr')];
      if (ev.key === 'Escape') {
        if (!box.hidden || q.value) { close(true); ev.stopPropagation(); } else q.blur();
        return;
      }
      if (!items.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        selected = (selected + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items.forEach((x, i) => x.classList.toggle('on', i === selected));
        items[selected].scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const el = items[selected] || items[0];
        if (el) go((box._hits || [])[+el.dataset.n]);
      }
    });
    box.addEventListener('click', ev => {
      const more = ev.target.closest('[data-more]');
      if (more) { open.add(more.dataset.more); render(); return; }
      const sr = ev.target.closest('.sr');
      if (sr) go((box._hits || [])[+sr.dataset.n]);
    });
    box.addEventListener('mouseover', ev => {
      const sr = ev.target.closest('.sr');
      if (!sr) return;
      selected = +sr.dataset.n;
      box.querySelectorAll('.sr').forEach(x => x.classList.toggle('on', x === sr));
    });
    document.addEventListener('click', ev => { if (!ev.target.closest('.find')) { box.hidden = true; q.setAttribute('aria-expanded', 'false'); } });
    // "/" jumps to the search box, like in the Dashboard
    document.addEventListener('keydown', ev => {
      if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
        ev.preventDefault();
        q.focus();
      }
    });
  }

  return {
    applyTheme,
    toggleTheme,
    setSidebarCollapsed,
    toggleSidebar,
    collapseSidebar,
    injectIcons,
    updateTopbar,
    updateFullscreenButton,
    toggleFullscreen,
    resolvedTheme,
    setThemeMode,
    applyStyle,
    currentStyle,
    syncAppearanceControls,
    initSearch,
    STYLES,
    THEME_MODES,
  };

})();
