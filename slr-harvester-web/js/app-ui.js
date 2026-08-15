/**
 * SLR Harvester Web - App UI Shell Helpers
 * Keeps topbar/sidebar/theme/fullscreen logic outside app.js.
 *
 * Global: window.SLRAppUI
 */

window.SLRAppUI = (() => {

  function applyTheme(state, $) {
    state.theme = state.theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('slr-theme', state.theme);

    const icon = $('theme-icon');
    if (icon) icon.innerHTML = state.theme === 'dark' ? SLRIcons.moon : SLRIcons.sun;

    const themeBtn = $('theme-toggle');
    if (themeBtn) themeBtn.classList.toggle('is-light', state.theme === 'light');

    // Keep the browser chrome (status bar / safe-area fill) in sync with the
    // app background so mobile browsers don't paint that area white.
    const meta = $('theme-color-meta');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }
  }

  function toggleTheme(state, $) {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state, $);
  }

  function setSidebarCollapsed(state, sidebarEl, $) {
    state.sidebarCollapsed = !!state.sidebarCollapsed;
    if (sidebarEl) sidebarEl.classList.toggle('collapsed', state.sidebarCollapsed);
    localStorage.setItem('slr-sidebar-collapsed', state.sidebarCollapsed ? '1' : '0');

    const icon = $('sidebar-toggle-icon');
    if (icon) icon.innerHTML = state.sidebarCollapsed ? SLRIcons.chevronRight : SLRIcons.chevronLeft;
  }

  function toggleSidebar(state, sidebarEl, $) {
    state.sidebarCollapsed = !state.sidebarCollapsed;
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
      settings: SLRIcons.settings,
      info: SLRIcons.info,
      user: SLRIcons.user,
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
      visualizations: 'Visualizations',
      tags: 'Tags',
      project: 'Project',
      settings: 'Settings',
      about: 'About',
      databases: 'Databases',
    };

    if (refs.viewTitle) refs.viewTitle.textContent = titles[state.view] || 'SLR Harvester Web';
    if (refs.projectBadge) refs.projectBadge.textContent = state.currentProject ? state.currentProject.name : '';

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === state.view);
    });

    updateAccountMenu();
  }

  // Shows/hides the topbar account icon based on live auth state — called
  // on every render so it can never go stale (e.g. after sign-in, sign-out,
  // or switching the active backend). Local-folder mode has no account
  // concept, so the icon only ever appears for a signed-in Cloud Sync user.
  function updateAccountMenu() {
    const wrap = document.getElementById('account-menu-wrap');
    if (!wrap) return;
    const user = window.SLRData?.getBackend() === 'cloud' ? window.SLRDataCloud?.currentUser() : null;
    wrap.hidden = !user;
    if (!user) {
      const menu = document.getElementById('account-menu');
      if (menu) menu.hidden = true;
      document.getElementById('account-menu-btn')?.setAttribute('aria-expanded', 'false');
      return;
    }
    const emailEl = document.getElementById('account-menu-email');
    if (emailEl) emailEl.textContent = user.email;
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

  return {
    applyTheme,
    toggleTheme,
    setSidebarCollapsed,
    toggleSidebar,
    injectIcons,
    updateTopbar,
    updateFullscreenButton,
    toggleFullscreen,
  };

})();
