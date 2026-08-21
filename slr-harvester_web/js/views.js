/**
 * SLR Harvester Web  View Renderers
 * All functions that build HTML and attach events for each view.
 * Reads from SLRApp.state, SLRData, SLRIcons.
 *
 * Global: window.SLRViews
 */

window.SLRViews = (() => {

  const TAG_FILTER_NONE = '__none__';

  // Which article fields the shared list-toolbar search box matches against
  // (Articles/Selected/Corpus) — see the "Fields" multi-select next to the
  // search input, openSearchFieldsPopup, and applyFilter's search block.
  const SEARCH_FIELD_OPTIONS = [
    { key: 'title',    label: 'Title',    prop: a => a.title },
    { key: 'abstract', label: 'Abstract', prop: a => a.abstract },
    { key: 'journal',  label: 'Journal',  prop: a => a.publicationName },
    { key: 'authors',  label: 'Authors',  prop: a => a.authors },
    { key: 'tag',      label: 'Tag',      prop: a => a.tag },
  ];
  const DEFAULT_SEARCH_FIELDS = ['title', 'abstract', 'journal'];

  // Which Auto-Tag Rules category cards are currently expanded (by color
  // key) — a plain UI-only concern kept at module scope so it survives the
  // full re-render every add/rename/recolor/delete triggers; collapsed by
  // default so a dozen-plus categories don't turn the view into a wall of
  // keyword chips.
  const expandedAutoTagCards = new Set();

  //  Welcome view's account menu — document-level listeners bound once

  function closeWelcomeAccountMenu() {
    const menu = document.getElementById('welcome-account-menu');
    const btn  = document.getElementById('welcome-account-btn');
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  // renderWelcome() runs on every Home visit, but a document-level listener
  // added there would never be removed (the render only replaces the view
  // container's own children) — re-visiting Home repeatedly would silently
  // stack up duplicate listeners forever. Bound exactly once instead, and
  // resolves the menu/button fresh by id on every event so it always acts
  // on whichever Welcome render is currently in the DOM.
  let _welcomeAccountMenuBound = false;
  function ensureWelcomeAccountMenuGlobalListeners() {
    if (_welcomeAccountMenuBound) return;
    _welcomeAccountMenuBound = true;
    document.addEventListener('click', e => {
      const menu = document.getElementById('welcome-account-menu');
      if (menu && !menu.hidden && !e.target.closest('#welcome-account-wrap')) closeWelcomeAccountMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeWelcomeAccountMenu();
    });
  }

  //  Utility 

  /** Escape text for safe insertion as textContent isn't always available */
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(str) {
    if (!str) return '-';
    return str.slice(0, 10);
  }

  function tagColor(projectData, colorName) {
    if (!colorName || colorName === 'None') return '';
    if (!projectData || !projectData.tagsConfig) return '';
    return projectData.tagsConfig[colorName] || '';
  }

  /** Same text, same top-left placement, same "go to Projects" button —
   *  used by every view's empty state for "no project is open yet" instead
   *  of each view inventing its own wording/position. The button's click is
   *  wired once, generically, in app.js (bindEvents), not per view. */
  function renderNoProjectNotice() {
    return `
      <div class="no-project-notice">
        <p>No project selected. Open a project from the Projects view.</p>
        <button class="btn-secondary" data-action="goto-projects">
          ${SLRIcons.projects} Go to Projects
        </button>
      </div>`;
  }

  function normalizeDocTypeKey(docType, source) {
    const raw = String(docType || '').trim().toLowerCase();
    if (!raw) return source === 'arxiv' ? 'preprint' : null;
    if (raw === 'journal-article' || raw === 'proceedings-article' || raw === 'article') return 'article';
    if (raw === 'journal-issue') return 'journal-issue';
    if (raw === 'book-chapter' || raw === 'chapter') return 'chapter';
    if (raw === 'book' || raw === 'edited-book' || raw === 'monograph') return 'book';
    if (raw === 'dataset') return 'dataset';
    if (raw === 'dissertation' || raw === 'thesis') return 'dissertation';
    if (raw === 'report') return 'report';
    if (raw === 'posted-content' || raw === 'preprint') return 'preprint';
    if (raw === 'review') return 'review';
    return raw;
  }

  function formatDocTypeLabel(docTypeKey) {
    const labels = {
      article: 'Article',
      'journal-issue': 'Journal Issue',
      preprint: 'Preprint',
      book: 'Book',
      chapter: 'Chapter',
      dataset: 'Dataset',
      review: 'Review',
      dissertation: 'Thesis',
      report: 'Report',
    };
    if (!docTypeKey) return '';
    if (labels[docTypeKey]) return labels[docTypeKey];
    return String(docTypeKey)
      .split('-')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  function docTypeClassKey(docTypeKey) {
    if (!docTypeKey) return 'other';
    const normalized = String(docTypeKey)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || 'other';
  }

  // Source database labels/keys, shared by the Query History view and the
  // PRISMA Identification breakdown so both agree on the same names.
  const DB_LABELS = {
    scopus: 'Scopus', standard: 'Scopus', complete: 'Scopus', refexpanded: 'Scopus',
    pubmed: 'PubMed', arxiv: 'arXiv', s2: 'Semantic Scholar', openalex: 'OpenAlex',
    SCOPUS: 'Scopus', PUBMED: 'PubMed', ARXIV: 'arXiv', S2: 'Semantic Scholar', OPENALEX: 'OpenAlex',
  };
  const DB_SOURCE_KEY = {
    scopus: 'scopus', standard: 'scopus', complete: 'scopus', refexpanded: 'scopus',
    pubmed: 'pubmed', arxiv: 'arxiv', s2: 's2', openalex: 'openalex',
    SCOPUS: 'scopus', PUBMED: 'pubmed', ARXIV: 'arxiv', S2: 's2', OPENALEX: 'openalex',
  };
  // Same per-source colors as the .badge-source-* CSS, reused for the PRISMA
  // Identification source boxes so a database reads as the same color everywhere.
  const DB_COLORS = {
    scopus: '#e07020', arxiv: '#e05555', pubmed: '#6faad4', s2: '#7aaee8', openalex: '#3ab09e',
  };

  // Deterministic string -> color, for grouping dimensions (document type,
  // country) that have no user-configured color the way tags do via
  // tagsConfig. Same string always yields the same hue, so a given country
  // or doc type keeps a stable color across renders/chart types.
  function hueColor(str) {
    let hash = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return `hsl(${hash % 360}, 62%, 52%)`;
  }

  // Walks every raw search-log record (not the deduplicated `articles` list)
  // and reports every record beyond a given id's (EID/DOI) first occurrence
  // as a duplicate — mirrors SLRData.getArticles' own dedup rule (first
  // occurrence wins, iterating searchLog in its stored newest-first order)
  // so "kept" here always matches what getArticles actually kept.
  function computeDuplicates(searchLog) {
    const seen = new Map();
    const dups = [];
    for (const run of (searchLog || [])) {
      if (!Array.isArray(run.results)) continue;
      for (const r of run.results) {
        const id = r.eid || r.doi || null;
        if (!id) continue;
        if (seen.has(id)) {
          dups.push({ title: r.title, id, view: run.view, timestamp: run.timestamp });
        } else {
          seen.set(id, true);
        }
      }
    }
    return dups;
  }

  const getWorldCountryName = (() => {
    let countryMap = null;
    return (code) => {
      if (!code) return '';
      if (!countryMap && Array.isArray(window.SLRWorldMapData)) {
        countryMap = new Map();
        for (const entry of window.SLRWorldMapData) {
          if (entry && entry.iso2 && entry.name) {
            countryMap.set(String(entry.iso2).trim().toUpperCase(), String(entry.name).trim());
          }
        }
      }
      const normalized = String(code).trim().toUpperCase();
      return countryMap?.get(normalized) || normalized;
    };
  })();

  function getAffiliationCountryNames(article) {
    const codes = Array.isArray(article?.affiliationCountries) ? article.affiliationCountries : [];
    const seen = new Set();
    const names = [];
    for (const code of codes) {
      const name = getWorldCountryName(code);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }

  function getCountryFlagEmoji(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) return '';
    const base = 0x1F1E6;
    return String.fromCodePoint(...normalized.split('').map(char => base + (char.charCodeAt(0) - 65)));
  }

  function getAffiliationCountries(article) {
    const codes = Array.isArray(article?.affiliationCountries) ? article.affiliationCountries : [];
    const seen = new Set();
    const countries = [];
    for (const code of codes) {
      const normalized = String(code || '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(normalized) || seen.has(normalized)) continue;
      const name = getWorldCountryName(normalized);
      seen.add(normalized);
      countries.push({ code: normalized, name, flag: getCountryFlagEmoji(normalized) });
    }
    return countries;
  }

  function getAffiliationBadgeState(article) {
    const hasAffiliationCountries = Array.isArray(article.affiliationCountries) && article.affiliationCountries.length > 0;
    const hasAffiliations = Array.isArray(article.affiliations) && article.affiliations.length > 0;
    if (hasAffiliationCountries || hasAffiliations) {
      const countryNames = getAffiliationCountryNames(article);
      return {
        state: 'available',
        title: countryNames.length
          ? `Affiliation countries: ${countryNames.join(', ')}`
          : 'Affiliation data available',
        countryNames,
      };
    }

    const sourceId = String(article.eid || article._id || '').toLowerCase();
    const fetchable = Boolean(
      (article.doi && String(article.doi).trim()) ||
      sourceId.startsWith('openalex:') ||
      sourceId.startsWith('pmid:')
    );

    if (fetchable) {
      return {
        state: 'fetchable',
        title: 'Affiliation country data can likely be fetched from DOI, OpenAlex, or PMID metadata',
      };
    }

    return {
      state: 'unavailable',
      title: 'No affiliation country data available yet',
    };
  }

  //  Citation network (intra-project)
  //
  //  Built entirely from data already sitting in each OpenAlex-sourced
  //  article's `referencedWorks` (captured for free from the normal search
  //  response, see mapOpenAlexResult in app.js — no extra API calls). Two
  //  articles in the SAME project link up when one's referencedWorks
  //  contains the other's bare OpenAlex ID. Articles from Scopus/PubMed/etc.
  //  simply never carry referencedWorks, so they can't participate — that's
  //  an accepted scope limit, not a bug.

  // Cache keyed by array identity: renderArticles/renderCorpus/renderSelected
  // all build this from the same full `articles` array on every re-render
  // (once per keystroke while typing in search, etc.), and it's an O(n)
  // scan — not something to redo 3x for nothing when the list hasn't changed.
  let _networkIndexCache = { articlesRef: null, index: null };

  function buildCitationNetworkIndex(articles) {
    if (_networkIndexCache.articlesRef === articles) return _networkIndexCache.index;

    const byOAId = new Map(); // bare OpenAlex work ID -> article
    for (const a of articles) {
      if (a.source === 'openalex' && a.eid && a.eid.startsWith('openalex:')) {
        byOAId.set(a.eid.slice(9), a);
      }
    }

    const citesMap = new Map();    // eid -> [article it cites, in-project]
    const citedByMap = new Map();  // eid -> [article that cites it, in-project]
    const hasNetwork = new Set();

    for (const a of articles) {
      if (!Array.isArray(a.referencedWorks) || !a.referencedWorks.length) continue;
      for (const refId of a.referencedWorks) {
        const target = byOAId.get(refId);
        if (!target || target === a) continue;
        if (!citesMap.has(a.eid)) citesMap.set(a.eid, []);
        citesMap.get(a.eid).push(target);
        if (!citedByMap.has(target.eid)) citedByMap.set(target.eid, []);
        citedByMap.get(target.eid).push(a);
        hasNetwork.add(a.eid);
        hasNetwork.add(target.eid);
      }
    }

    const index = { citesMap, citedByMap, hasNetwork };
    _networkIndexCache = { articlesRef: articles, index };
    return index;
  }

  function getNetworkBadgeState(article, networkIndex) {
    if (!networkIndex) return { state: 'unavailable', title: 'No citation network data available for this article yet' };
    if (networkIndex.hasNetwork.has(article.eid)) {
      const citing  = (networkIndex.citesMap.get(article.eid) || []).length;
      const citedBy = (networkIndex.citedByMap.get(article.eid) || []).length;
      const parts = [];
      if (citing)  parts.push(`cites ${citing} article${citing !== 1 ? 's' : ''} in this project`);
      if (citedBy) parts.push(`cited by ${citedBy} article${citedBy !== 1 ? 's' : ''} in this project`);
      return { state: 'available', title: 'Citation network: ' + parts.join(', ') };
    }
    return { state: 'unavailable', title: 'No citation network data available for this article yet' };
  }

  //  Welcome view

  function renderWelcome(container) {
    const supported = typeof window.showDirectoryPicker === 'function';
    // Reachable by clicking "Home" in the sidebar even while already signed
    // in (that nav item always renders this view, regardless of connection
    // state) — without this check it re-showed Sign Up/Log In as if nothing
    // had happened, which reads as broken/forgotten login rather than what
    // it actually is: a nav shortcut that doesn't know you're already in.
    const cloudUser = SLRData.getBackend() === 'cloud' ? SLRDataCloud.currentUser() : null;

    // Same message everywhere the File System Access API is missing — mobile
    // browsers included, since none of them implement it either. Local
    // Folder specifically; Cloud Sync works regardless.
    const compatMessage = `<strong>Local Folder isn't supported in this browser.</strong>
         It requires <strong>Chrome 86+ or Edge 86+ on desktop</strong> for the File
         System Access API — Firefox and Safari (desktop) don't support it, and
         neither does any mobile browser. Use <strong>Sign Up</strong> or
         <strong>Log In</strong> above instead.`;

    // The onboarding walkthrough (mobile/Firefox/Safari, first time with
    // Local Folder, already have local data) used to live here as static
    // text — now it's a dedicated section in About so it's one tap away
    // instead of permanently taking up Home's layout. This hint is the
    // pointer left in its place; dismissing it is remembered for good.
    const firsttimeDismissed = localStorage.getItem('slr-firsttime-hint-dismissed') === '1';

    container.innerHTML = `
      <div class="welcome-view" id="home">
        <canvas id="heroParticles" class="hero-particles-canvas" aria-hidden="true"></canvas>

        ${cloudUser ? `
          <!-- Account entry point lives only here on Home, not in the global
               header — see index.html/app.js history for why. -->
          <div class="welcome-account-wrap" id="welcome-account-wrap">
            <button id="welcome-account-btn" class="welcome-account-btn" aria-haspopup="true" aria-expanded="false" title="Account" aria-label="Account menu">
              ${SLRIcons.user}
            </button>
            <div class="welcome-account-menu" id="welcome-account-menu" hidden role="menu">
              <div class="account-menu-email">${esc(cloudUser.email)}</div>
              <button class="account-menu-item" id="welcome-account-settings-btn" role="menuitem">Settings</button>
              <button class="account-menu-item account-menu-item--danger" id="welcome-account-signout-btn" role="menuitem">Sign Out</button>
            </div>
          </div>
        ` : ''}

        <div class="welcome-hero">
          <div class="welcome-logo">${SLRIcons.logo}</div>
          <h1>SLR Harvester <span class="title-web">Web</span></h1>
          <p>A browser tool for managing
             <span style="white-space:nowrap">Systematic Literature Reviews</span>.<br>
             Connect a workspace below to get started.</p>
        </div>

        <div class="welcome-actions">
          ${cloudUser ? `
            <div class="welcome-auth-row">
              <button id="welcome-goto-projects-btn" class="btn-primary">Go to Projects</button>
            </div>
          ` : `
            <div class="welcome-auth-row">
              <button id="welcome-signup-btn" class="btn-primary">Sign Up</button>
              <button id="welcome-login-btn" class="btn-secondary">Log In</button>
            </div>
          `}
          <button id="welcome-open-btn" class="btn-secondary">
            ${SLRIcons.folderOpen}
            Continue with Local Folder
          </button>
        </div>

        <div class="welcome-compat-notice" id="welcome-compat-notice" hidden>
          ${SLRIcons.warning}
          <span>${compatMessage}</span>
        </div>

        <div class="welcome-copyright">
          <span class="welcome-copyright-icon">&copy;</span>
          <span>2026 Gregor Hobersdorfer</span>
        </div>

        ${firsttimeDismissed ? '' : `
          <div class="welcome-firsttime-hint" id="welcome-firsttime-hint">
            <button type="button" class="welcome-firsttime-btn" id="welcome-firsttime-btn"
                    title="Go to the &quot;First time here?&quot; section in About">
              ${SLRIcons.chevronLeft}
              <span>First time here?</span>
            </button>
            <button type="button" class="welcome-firsttime-close" id="welcome-firsttime-close"
                    title="Dismiss" aria-label="Dismiss">${SLRIcons.close}</button>
          </div>
        `}
      </div>`;

    container.querySelector('#welcome-open-btn').addEventListener('click', () => {
      if (supported) {
        SLRApp.openFolder();
      } else {
        const notice = container.querySelector('#welcome-compat-notice');
        if (notice) notice.hidden = false;
      }
    });

    if (!firsttimeDismissed) {
      const hintEl = container.querySelector('#welcome-firsttime-hint');
      const welcomeEl = container.querySelector('.welcome-view');
      const positionFirsttimeHint = () => {
        if (!hintEl.isConnected) { window.removeEventListener('resize', positionFirsttimeHint); return; }
        const aboutBtn = document.querySelector('.sidebar .nav-item[data-view="about"]');
        if (!aboutBtn) return;
        const aboutRect   = aboutBtn.getBoundingClientRect();
        const welcomeRect = welcomeEl.getBoundingClientRect();
        const top = (aboutRect.top - welcomeRect.top) + aboutRect.height / 2 - hintEl.offsetHeight / 2;
        hintEl.style.top = `${Math.max(8, top)}px`;
      };
      positionFirsttimeHint();
      window.addEventListener('resize', positionFirsttimeHint);

      container.querySelector('#welcome-firsttime-btn').addEventListener('click', () => {
        SLRApp.gotoAboutFirstTime();
      });
      container.querySelector('#welcome-firsttime-close').addEventListener('click', () => {
        localStorage.setItem('slr-firsttime-hint-dismissed', '1');
        hintEl.remove();
      });
    }

    if (cloudUser) {
      container.querySelector('#welcome-goto-projects-btn').addEventListener('click', () => {
        SLRApp.navigate('projects');
      });

      const acctBtn  = container.querySelector('#welcome-account-btn');
      const acctMenu = container.querySelector('#welcome-account-menu');
      ensureWelcomeAccountMenuGlobalListeners();
      acctBtn.addEventListener('click', e => {
        e.stopPropagation();
        const willOpen = acctMenu.hidden;
        acctMenu.hidden = !willOpen;
        acctBtn.setAttribute('aria-expanded', String(willOpen));
      });
      container.querySelector('#welcome-account-settings-btn').addEventListener('click', () => {
        closeWelcomeAccountMenu();
        SLRApp.navigate('settings');
      });
      container.querySelector('#welcome-account-signout-btn').addEventListener('click', () => {
        closeWelcomeAccountMenu();
        SLRApp.cloudSignOut();
      });
    } else {
      container.querySelector('#welcome-signup-btn').addEventListener('click', () => {
        SLRApp.showSupabaseAuthModal('signup');
      });
      container.querySelector('#welcome-login-btn').addEventListener('click', () => {
        SLRApp.showSupabaseAuthModal('signin');
      });
    }

    initHeroParticles();
  }

  // Particle network background (Home)
  function initHeroParticles() {
    const canvas = document.getElementById('heroParticles');
    const hero = document.getElementById('home');
    if (!canvas || !hero) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    const COUNT       = 55;    // Anzahl Punkte
    const SPEED       = 0.45;  // max. Pixel/Frame
    const CONNECT     = 140;   // max. Verbindungsdistanz (px)
    const R           = 2.2;   // Grund-Punktradius
    const MAX_GROWTH  = 4;     // ab so vielen Verbindungen ist das Wachstum gedeckelt
    const GROWTH_STEP = R * 0.32; // Radiuszuwachs pro Verbindung
    const EASE        = 0.06;  // wie schnell der Radius dem Ziel folgt
    const DISSOLVE_CHANCE = 0.0009; // Wahrscheinlichkeit pro Punkt & Frame, sich aufzulösen
    const FADE_STEP    = 0.02; // Alpha-Änderung pro Frame beim Auflösen/Erscheinen

    let W, H, particles = [];

    function isDark() {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    }
    function turquoiseColor(alpha) {
      return isDark() ? `rgba(51, 230, 212, ${alpha})` : `rgba(23, 169, 156, ${alpha})`;
    }

    // Sized to the viewport, not to #home's own box — the canvas is
    // position:fixed (see .hero-particles-canvas) specifically so toggling
    // the sidebar (which changes #home's width, not the viewport's) can
    // never stretch/reflow the already-placed particles.
    function resize() {
      W = canvas.width  = document.documentElement.clientWidth;
      H = canvas.height = document.documentElement.clientHeight;
    }

    // state: 'alive' (normal), 'dissolving' (löst sich auf), 'spawning' (kommt neu hinzu)
    function makeParticle(spawning) {
      const baseR = R * (0.75 + Math.random() * 0.5);
      return {
        x:  Math.random() * W,
        y:  Math.random() * H,
        vx: (Math.random() - 0.5) * SPEED * 2,
        vy: (Math.random() - 0.5) * SPEED * 2,
        baseR,
        r: spawning ? 0 : baseR,
        targetR: baseR,
        alpha: spawning ? 0 : 1,
        state: spawning ? 'spawning' : 'alive',
      };
    }

    function createParticles() {
      particles = [];
      for (let i = 0; i < COUNT; i++) particles.push(makeParticle(false));
    }

    function updateLifecycle(p) {
      if (p.state === 'alive') {
        if (Math.random() < DISSOLVE_CHANCE) p.state = 'dissolving';
      } else if (p.state === 'dissolving') {
        p.alpha = Math.max(0, p.alpha - FADE_STEP);
        p.r += (0 - p.r) * 0.1;
        if (p.alpha <= 0) Object.assign(p, makeParticle(true));
      } else if (p.state === 'spawning') {
        p.alpha = Math.min(1, p.alpha + FADE_STEP);
        if (p.alpha >= 1) p.state = 'alive';
      }
    }

    function step() {
      // View was re-rendered (canvas detached) — stop this loop.
      if (!canvas.isConnected) return;

      ctx.clearRect(0, 0, W, H);

      for (const p of particles) {
        updateLifecycle(p);
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }

      // Verbindungen ermitteln + je Punkt zählen, wie viele er gerade hat
      const links = [];
      const connCount = new Array(particles.length).fill(0);
      for (let i = 0; i < particles.length; i++) {
        if (particles[i].alpha <= 0) continue;
        for (let j = i + 1; j < particles.length; j++) {
          if (particles[j].alpha <= 0) continue;
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT) {
            links.push(i, j, dist);
            connCount[i]++;
            connCount[j]++;
          }
        }
      }

      // Radius wächst/schrumpft mit der Anzahl aktueller Verbindungen
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.state === 'dissolving') continue;
        p.targetR = p.baseR + Math.min(connCount[i], MAX_GROWTH) * GROWTH_STEP;
        p.r += (p.targetR - p.r) * EASE;
      }

      for (let k = 0; k < links.length; k += 3) {
        const i = links[k], j = links[k + 1], dist = links[k + 2];
        const alpha = (1 - dist / CONNECT) * (isDark() ? 0.28 : 0.18) * particles[i].alpha * particles[j].alpha;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = turquoiseColor(alpha);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      for (const p of particles) {
        if (p.alpha <= 0) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(p.r, 0.3), 0, Math.PI * 2);
        ctx.fillStyle = turquoiseColor((isDark() ? 0.55 : 0.38) * p.alpha);
        ctx.fill();
      }

      requestAnimationFrame(step);
    }

    function onResize() {
      // View was re-rendered (canvas detached) — drop this listener.
      if (!canvas.isConnected) {
        window.removeEventListener('resize', onResize);
        return;
      }
      resize();
    }

    let resizeTicking = false;
    window.addEventListener('resize', () => {
      if (resizeTicking) return;
      resizeTicking = true;
      requestAnimationFrame(() => {
        onResize();
        resizeTicking = false;
      });
    });

    resize();
    createParticles();
    step();
  }

  //  Projects view

  function sortProjectsList(projects, sort) {
    const list = projects.slice();
    switch (sort) {
      case 'oldest': return list.sort((a, b) => String(a.created).localeCompare(String(b.created)));
      case 'az':     return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      case 'za':     return list.sort((a, b) => String(b.name).localeCompare(String(a.name)));
      case 'recent': {
        const lastOpened = SLRApp.state.projectLastOpened || {};
        return list.sort((a, b) => {
          const ta = lastOpened[a.workspace_folder] || '';
          const tb = lastOpened[b.workspace_folder] || '';
          if (ta !== tb) return tb.localeCompare(ta); // most recently opened first
          return String(b.created).localeCompare(String(a.created)); // never-opened: fall back to newest
        });
      }
      case 'newest':
      default:       return list.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    }
  }

  // Default palette offered by the project-icon picker (see
  // openProjectIconPicker) — SVG choices reuse the app's existing icon set
  // rather than shipping a second one just for this.
  const PROJECT_ICON_EMOJI_CHOICES = [
    '📚', '🔬', '🧠', '💡', '📊', '🌍', '🧪', '🩺', '🧬', '📈', '🖥️', '🎓',
    '📝', '🔍', '🌱', '🏛️', '💻', '🔭', '📖', '⚖️', '🗂️', '🧾', '🌐', '🩻',
  ];
  const PROJECT_ICON_SVG_CHOICES = [
    'folder', 'articles', 'search', 'chart', 'tag', 'globe', 'star', 'layers',
    'databases', 'calendar', 'palette', 'user', 'corpus', 'selected', 'history', 'settings',
  ];

  function deriveProjectInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  // Resolves a project's card icon to renderable HTML — an explicit emoji/
  // svg/letters choice if one's been set, otherwise auto-derived initials
  // (still overridable any time via the picker) so the frame is never empty.
  function projectIconDisplay(project) {
    const icon = project && project.icon;
    if (icon && icon.type === 'emoji' && icon.value) {
      return { html: esc(icon.value), isText: false };
    }
    if (icon && icon.type === 'svg' && icon.value && SLRIcons[icon.value]) {
      return { html: SLRIcons[icon.value], isText: false };
    }
    if (icon && icon.type === 'text' && icon.value) {
      return { html: esc(icon.value.slice(0, 2).toUpperCase()), isText: true };
    }
    return { html: esc(deriveProjectInitials(project && project.name)), isText: true, isDefault: true };
  }

  // Floating picker for a project card's icon — emoji grid, SVG-symbol grid,
  // and a free-text 1-2 letter abbreviation, plus a reset-to-initials
  // option. Mirrors openToolbarPopupMenu's positioning/click-outside-close,
  // just with a richer body than a plain item list.
  function openProjectIconPicker(triggerEl, folder, currentIcon) {
    document.querySelector('.project-icon-picker')?.remove();
    const popup = document.createElement('div');
    popup.className = 'project-icon-picker';

    const emojiHTML = PROJECT_ICON_EMOJI_CHOICES.map(e =>
      `<button type="button" class="project-icon-picker-item" data-icon-type="emoji" data-icon-value="${esc(e)}" title="${esc(e)}">${esc(e)}</button>`
    ).join('');
    const svgHTML = PROJECT_ICON_SVG_CHOICES.map(key =>
      `<button type="button" class="project-icon-picker-item" data-icon-type="svg" data-icon-value="${esc(key)}" title="${esc(key)}">${SLRIcons[key] || ''}</button>`
    ).join('');
    const currentLetters = (currentIcon && currentIcon.type === 'text') ? currentIcon.value : '';

    popup.innerHTML = `
      <div class="project-icon-picker-section">
        <div class="project-icon-picker-label">Emoji</div>
        <div class="project-icon-picker-grid">${emojiHTML}</div>
      </div>
      <div class="project-icon-picker-section">
        <div class="project-icon-picker-label">Symbol</div>
        <div class="project-icon-picker-grid">${svgHTML}</div>
      </div>
      <div class="project-icon-picker-section">
        <div class="project-icon-picker-label">Letters</div>
        <div class="project-icon-picker-letters">
          <input type="text" class="project-icon-picker-input" id="project-icon-letters-input" maxlength="2" placeholder="e.g. KI" value="${esc(currentLetters)}">
          <button type="button" class="project-icon-picker-set" id="project-icon-letters-set">Set</button>
        </div>
      </div>
      <button type="button" class="project-icon-picker-reset" id="project-icon-reset">Use default (initials)</button>`;
    document.body.appendChild(popup);

    const rect = triggerEl.getBoundingClientRect();
    const estimatedH = 340;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < estimatedH && rect.top > estimatedH) {
      popup.style.top = Math.max(8, rect.top - estimatedH - 4) + 'px';
    } else {
      popup.style.top = (rect.bottom + 4) + 'px';
    }
    popup.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';

    const choose = (icon) => {
      SLRApp.setProjectIcon(folder, icon);
      popup.remove();
      document.removeEventListener('click', closeHandler, true);
    };

    popup.querySelectorAll('.project-icon-picker-item').forEach(btn => {
      btn.addEventListener('click', () => choose({ type: btn.dataset.iconType, value: btn.dataset.iconValue }));
    });

    const letterInput = popup.querySelector('#project-icon-letters-input');
    letterInput.addEventListener('input', () => {
      letterInput.value = letterInput.value.toUpperCase().slice(0, 2);
    });
    letterInput.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      popup.querySelector('#project-icon-letters-set').click();
    });
    popup.querySelector('#project-icon-letters-set').addEventListener('click', () => {
      const val = (letterInput.value || '').trim().toUpperCase().slice(0, 2);
      if (val) choose({ type: 'text', value: val });
    });

    popup.querySelector('#project-icon-reset').addEventListener('click', () => choose(null));

    const closeHandler = ev => {
      if (!popup.contains(ev.target) && ev.target !== triggerEl && !triggerEl.contains(ev.target)) {
        popup.remove();
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
  }

  // Content shared by the inline Projects-tab detail panel — extracted from
  // what used to be the standalone "Project Info" view/nav-item.
  function buildProjectInfoDetailHTML(project, projectData) {
    const articles = projectData ? SLRData.getArticles(projectData) : [];
    const stats    = SLRData.getStats(articles);

    const colorCountMap = {};
    for (const a of articles) {
      if (a.color && a.color !== 'None') colorCountMap[a.color] = (colorCountMap[a.color] || 0) + 1;
    }
    const legendAliases = projectData.tagAliases || {};

    const tagLegend = Object.entries(projectData.tagsConfig || {})
      .filter(([name, hex]) => name !== 'None' && hex)
      .map(([name, hex]) => {
        const count = colorCountMap[name] || 0;
        const displayName = legendAliases[name] || name;
        return `
          <div class="tag-legend-item">
            <span class="tag-legend-dot" style="background:${esc(hex)}"></span>
            ${esc(displayName)}
            <span style="color:var(--text-faint);font-size:11px">(${count})</span>
          </div>`;
      }).join('');

    return `
      <div class="project-meta-edit">
        <input class="project-name-input" id="proj-name-input" type="text" value="${esc(project.name)}" maxlength="120" aria-label="Project name">
        <textarea class="project-desc-input" id="proj-desc-input" rows="2" maxlength="500" aria-label="Project description">${esc(project.description || '')}</textarea>
        <button class="btn-primary" id="save-meta-btn" style="align-self:flex-start;padding:6px 18px;font-size:13px">${SLRIcons.check} Save</button>
      </div>

      <div class="project-info-cols">
        <div class="info-section">
          <h3>Details</h3>
          <div class="info-grid">
            <div class="info-field">
              <label>Created</label>
              <span>${esc(project.created)}</span>
            </div>
            <div class="info-field">
              <label>Folder</label>
              <span>${esc(project.workspace_folder)}</span>
            </div>
            <div class="info-field">
              <label>Total articles</label>
              <span>${stats.total}</span>
            </div>
            <div class="info-field">
              <label>Queries run</label>
              <span>${projectData.searchLog.length}</span>
            </div>
            <div class="info-field">
              <label>Selected</label>
              <span>${stats.selected}</span>
            </div>
            <div class="info-field">
              <label>In corpus</label>
              <span>${stats.corpus}</span>
            </div>
          </div>
        </div>

        ${tagLegend ? `
        <div class="info-section">
          <h3>Tag Legend</h3>
          <div class="tag-legend">${tagLegend}</div>
        </div>` : ''}
      </div>`;
  }

  function renderProjects(container, projectsIn, currentFolder, allProjectData, sort, detailFolder) {
    if (detailFolder) {
      const project     = (projectsIn || []).find(p => p.workspace_folder === detailFolder);
      const projectData = allProjectData[detailFolder];
      if (project && projectData) {
        container.innerHTML = `
          <div class="projects-view">
            <button type="button" class="project-detail-back" id="project-detail-back">
              ${SLRIcons.chevronLeft} Back to Projects
            </button>
            ${buildProjectInfoDetailHTML(project, projectData)}
          </div>`;

        container.querySelector('#project-detail-back').addEventListener('click', () => SLRApp.closeProjectDetail());

        const saveBtn   = container.querySelector('#save-meta-btn');
        const nameInput = container.querySelector('#proj-name-input');
        const descInput = container.querySelector('#proj-desc-input');
        if (saveBtn) {
          saveBtn.addEventListener('click', () =>
            SLRApp.updateProjectMeta(detailFolder, nameInput.value, descInput.value));
        }
        return;
      }
      // Stale/missing reference (e.g. project deleted elsewhere) — fall
      // through to the normal grid instead of showing a dead end.
    }

    if (!projectsIn || projectsIn.length === 0) {
      container.innerHTML = `
        <div class="projects-view" style="padding:0">
          <div class="no-project-notice">
            <p>No projects yet in this folder. Click
            <strong>New Project</strong> to create your first one - this also sets up
            <code>projects.json</code> and the <code>projects/</code> folder here automatically.</p>
            <button class="btn-primary projects-add-btn projects-add-btn--emphasize" id="new-project-btn">
              ${SLRIcons.plus} New Project
            </button>
          </div>
        </div>`;
      container.querySelector('#new-project-btn').addEventListener('click', () => SLRApp.showNewProjectModal());
      return;
    }

    const projects = sortProjectsList(projectsIn, sort || 'newest');
    const pinned = SLRApp.state.pinnedProjects;

    const cards = projects.map(p => {
      const data    = allProjectData[p.workspace_folder];
      const stats   = data ? SLRData.getStats(SLRData.getArticles(data)) : null;
      const nTags   = data ? new Set(
        Object.values(data.globalTags || {}).map(v => v.tag).filter(t => t && t !== 'None')
      ).size : 0;
      const nQueries = data ? (data.searchLog || []).length : 0;
      const nTerms   = data ? new Set((data.queryHistory && data.queryHistory.terms || [])).size : 0;
      const active = p.workspace_folder === currentFolder;
      const isPinned = pinned.has(p.workspace_folder);
      const iconInfo = projectIconDisplay(p);

      return `
        <div class="project-card ${active ? 'active' : ''}"
             data-folder="${esc(p.workspace_folder)}">
          <div class="project-card-header">
            <div class="project-card-header-main">
              <button type="button" class="project-icon-frame${iconInfo.isText ? ' is-text' : ''}"
                      data-icon-folder="${esc(p.workspace_folder)}" title="Change project icon" aria-label="Change project icon">
                ${iconInfo.html}
              </button>
              <div class="project-card-titles">
                <div class="project-card-name">${esc(p.name)}</div>
                <div class="project-card-date">Created ${esc(p.created)}</div>
              </div>
            </div>
            <button class="project-pin-dot ${isPinned ? 'pinned' : ''}"
                    data-pin-folder="${esc(p.workspace_folder)}"
                    title="${isPinned ? 'Marked as in progress — click to unmark' : 'Mark as currently in progress'}"
                    aria-label="Toggle in-progress marker" aria-pressed="${isPinned ? 'true' : 'false'}"></button>
          </div>

          ${p.description && p.description !== 'No description' ? `
            <div class="project-card-desc">${esc(p.description)}</div>` : ''}

          ${stats ? `
            <div class="project-card-stats-grid">
              <span class="stat-chip">
                ${SLRIcons.history}
                <span><strong>${nQueries}</strong> quer${nQueries !== 1 ? 'ies' : 'y'}</span>
              </span>
              <span class="stat-chip">
                ${SLRIcons.search}
                <span><strong>${nTerms}</strong> term${nTerms !== 1 ? 's' : ''}</span>
              </span>
              <span class="stat-chip">
                ${SLRIcons.articles}
                <span><strong>${stats.total}</strong> articles</span>
              </span>
              <span class="stat-chip">
                ${SLRIcons.tag}
                <span><strong>${nTags}</strong> tag${nTags !== 1 ? 's' : ''} in use</span>
              </span>
              <span class="stat-chip selected">
                ${SLRIcons.selected}
                <span><strong>${stats.selected}</strong> selected</span>
              </span>
              <span class="stat-chip corpus">
                ${SLRIcons.corpus}
                <span><strong>${stats.corpus}</strong> corpus</span>
              </span>
            </div>` : `
            <div class="project-card-stats">
              <span class="stat-chip">${SLRIcons.refresh} <span>Loading...</span></span>
            </div>`}

          <div class="project-card-actions">
            <button class="open-project-btn" data-folder="${esc(p.workspace_folder)}">
              ${SLRIcons.chevronRight}
              ${active ? 'Current project' : 'Open project'}
            </button>
            ${data ? `
              <button class="project-info-btn" data-info-folder="${esc(p.workspace_folder)}" title="View project info">
                ${SLRIcons.info} Info
              </button>` : ''}
          </div>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="projects-view">
        <div class="projects-header">
          <div>
            <p class="projects-subtitle">${projects.length} project${projects.length !== 1 ? 's' : ''} found</p>
          </div>
          <div class="projects-header-actions">
            <select class="filter-select" id="projects-sort" title="Sort projects">
              <option value="newest" ${sort==='newest'?'selected':''}>Newest first</option>
              <option value="oldest" ${sort==='oldest'?'selected':''}>Oldest first</option>
              <option value="recent" ${sort==='recent'?'selected':''}>Recently used</option>
              <option value="az"     ${sort==='az'    ?'selected':''}>Name A-Z</option>
              <option value="za"     ${sort==='za'    ?'selected':''}>Name Z-A</option>
            </select>
            <button class="btn-primary projects-add-btn" id="new-project-btn">${SLRIcons.plus} New Project</button>
          </div>
        </div>
        <div class="projects-grid">${cards}</div>
      </div>`;

    container.querySelector('#new-project-btn').addEventListener('click', () => SLRApp.showNewProjectModal());

    container.querySelector('#projects-sort').addEventListener('change', e => {
      SLRApp.setProjectsSort(e.target.value);
    });

    container.querySelectorAll('.project-pin-dot').forEach(dot => {
      dot.addEventListener('click', e => {
        e.stopPropagation();
        SLRApp.toggleProjectPin(dot.dataset.pinFolder);
      });
    });

    container.querySelectorAll('.project-info-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        SLRApp.openProjectDetail(btn.dataset.infoFolder);
      });
    });

    container.querySelectorAll('.project-icon-frame').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const folder = btn.dataset.iconFolder;
        const proj = projects.find(p => p.workspace_folder === folder);
        openProjectIconPicker(btn, folder, proj && proj.icon);
      });
    });

    container.querySelectorAll('[data-folder]').forEach(el => {
      el.addEventListener('click', (e) => {
        const folder = el.closest('[data-folder]').dataset.folder ||
                       el.dataset.folder;
        SLRApp.openProject(folder);
      });
    });
  }

  //  Articles view 

  function renderArticles(container, articles, filter, projectData) {
    // Apply filters (Articles always operates on the full list — the old
    // All/Selected/Corpus mode switch was removed in favor of separate tabs)
    let filtered = applyFilter(articles, Object.assign({}, filter, { mode: 'all' }), projectData);
    const totalAll      = articles.length;
    const totalSelected = articles.filter(a => a.selected).length;
    const totalCorpus   = articles.filter(a => a.corpus).length;
    const totalTagged   = new Set(articles.filter(a => a.color && a.color !== 'None').map(a => a.color)).size;

    // Only the first page's worth of matches become real DOM — with
    // thousands of articles, mounting every one of them at once (each with
    // its own swipe wrapper and half a dozen badges) was the app's biggest
    // source of render/scroll jank. More of `filtered` loads in as the user
    // scrolls near the bottom (wireInfiniteScroll below); the "Showing N of
    // M" stats further down still describe the full filtered set, not just
    // what's currently mounted.
    const renderLimit = filter.renderLimit || 200;
    const visible = filtered.slice(0, renderLimit);
    const hasMore = visible.length < filtered.length;

    // Build article HTML
    const listHTML = !projectData
      ? renderNoProjectNotice()
      : filtered.length === 0
      ? `<div class="article-list-empty">
           ${SLRIcons.articles}
           <p>No articles match the current filters.</p>
         </div>`
      : visible.map(a => articleItemHTML(a, projectData, buildCitationNetworkIndex(articles))).join('');

    container.innerHTML = `
      <div class="articles-view">

        <div class="list-header-collapsible"><div class="list-header-collapsible-inner">
        <div class="corpus-banner">
          <span class="corpus-banner-stat">
            ${SLRIcons.articles}
            <span><strong>${totalAll}</strong> article${totalAll !== 1 ? 's' : ''} total</span>
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.selected}
            <span><strong>${totalSelected}</strong> selected</span>
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.corpus}
            <span><strong>${totalCorpus}</strong> in corpus</span>
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.tag}
            <span><strong>${totalTagged}</strong> tag${totalTagged !== 1 ? 's' : ''} used</span>
          </span>
        </div>

        ${buildListToolbarHTML({
          list: articles, projectData, activeTags: filter.tags,
          filterVisible: !!SLRApp.state.tagBreakdownVisible,
          searchId: 'list-search', searchValue: filter.search, searchFields: filter.searchFields,
          sortId: 'list-sort', sortValue: filter.sort,
          yearFromId: 'list-year-from', yearFromValue: filter.yearFrom,
          yearToId: 'list-year-to', yearToValue: filter.yearTo,
          exportTitle: 'Download current list as .bib, .ris, or .csv',
        })}

        ${buildListStatsHTML(filtered.length, totalAll, '', filter)}
        </div></div>

        <div class="article-list" id="article-list">
          ${listHTML}
        </div>
      </div>`;

    wireListToolbar(container, {
      onFilter: patch => SLRApp.setFilter(patch),
      onTagsChange: tags => SLRApp.setFilter({ tags }),
      onExport: () => {
        const exportBtn = container.querySelector('#export-list-btn');
        openExportMenu(exportBtn, filtered, 'articles');
      },
      activeTags: filter.tags,
    });

    // Expand/collapse articles
    container.querySelector('#article-list').addEventListener('click', e => {
      const item = e.target.closest('.article-item');
      if (!item) return;
      if (e.target.tagName === 'A') return;
      if (e.target.closest('[data-action]')) return;
      if (e.target.closest('.article-id-copy')) return;
      const swipeEl = item.closest('.article-item-swipe');
      if (swipeEl && swipeEl.dataset.suppressClick === '1') { delete swipeEl.dataset.suppressClick; return; }
      item.classList.toggle('expanded');
    });
    wireArticleActions(container.querySelector('#article-list'), projectData);
    wireArticleSwipeGestures(container.querySelector('#article-list'), projectData, 'all');
    wireListHeaderCollapse(container, container.querySelector('#article-list'));
    wireInfiniteScroll(container.querySelector('#article-list'), hasMore, () => SLRApp.bumpArticlesRenderLimit());
  }

  function articleItemHTML(a, projectData, networkIndex) {
    const hex = tagColor(projectData, a.color);
    const styleAttr = hex ? `style="--tag-color:${esc(hex)}"` : '';
    const tagName = (a.tag && a.tag !== 'None') ? a.tag : '';
    const year = a.date ? a.date.slice(0, 4) : '';

    const doiLink = a.doi
      ? `<a href="https://doi.org/${esc(a.doi)}" target="_blank" rel="noopener">${esc(a.doi)}</a>`
      : null;

    // Build EID link pointing to the right platform based on source
    const eidId  = a.eid || a._id || '';
    let eidHref  = null;
    let eidLabel = eidId;
    if (eidId) {
      if (eidId.startsWith('arxiv:')) {
        eidHref  = `https://arxiv.org/abs/${eidId.slice(6)}`;
        eidLabel = eidId;
      } else if (eidId.startsWith('pmid:')) {
        eidHref  = `https://pubmed.ncbi.nlm.nih.gov/${eidId.slice(5)}/`;
        eidLabel = eidId;
      } else if (eidId.startsWith('s2:')) {
        eidHref  = `https://www.semanticscholar.org/paper/${eidId.slice(3)}`;
        eidLabel = eidId;
      } else if (eidId.startsWith('openalex:')) {
        const oaId = eidId.slice(9);
        eidHref  = `https://openalex.org/${oaId}`;
        eidLabel = eidId;
      } else {
        eidHref = `https://www.scopus.com/record/display.uri?eid=${esc(eidId)}&origin=resultslist`;
      }
    }
    const eidLink = eidHref
      ? `<a href="${esc(eidHref)}" target="_blank" rel="noopener">${esc(eidLabel)}</a>`
      : null;

    // Source badge and optional doc-type badge
    const SOURCE_LABELS = { scopus: 'Scopus', arxiv: 'arXiv', pubmed: 'PubMed', s2: 'S2', openalex: 'OpenAlex' };
    // Infer source from EID prefix for legacy entries that predate the source field
    const _eid = a._id || a.eid || '';
    const source = a.source
      || (_eid.startsWith('arxiv:')    ? 'arxiv'    : null)
      || (_eid.startsWith('openalex:') ? 'openalex' : null)
      || (_eid.startsWith('pubmed:')   ? 'pubmed'   : null)
      || (_eid.startsWith('s2:')       ? 's2'       : null)
      || 'scopus';
    const sourceBadge = `<span class="badge badge-source badge-source-${esc(source)}" title="Source: ${esc(SOURCE_LABELS[source] || source)}">${esc(SOURCE_LABELS[source] || source)}</span>`;
    const docType = normalizeDocTypeKey(a.docType, source);
    const docTypeLabel = formatDocTypeLabel(docType);
    const docTypeBadge = docType ? `<span class="badge badge-doctype badge-doctype-${esc(docTypeClassKey(docType))}">${esc(docTypeLabel)}</span>` : '';
    const affiliationBadge = (() => {
      const badge = getAffiliationBadgeState(a);
      return `<span class="affiliation-indicator ${esc(badge.state)}" title="${esc(badge.title)}" aria-label="${esc(badge.title)}">${SLRIcons.globe}</span>`;
    })();

    const networkBadge = (() => {
      const badge = getNetworkBadgeState(a, networkIndex);
      if (badge.state === 'available') {
        return `<button type="button" class="network-indicator available" data-action="show-network" title="${esc(badge.title)}" aria-label="${esc(badge.title)}">${SLRIcons.network}</button>`;
      }
      return `<span class="network-indicator unavailable" title="${esc(badge.title)}" aria-label="${esc(badge.title)}">${SLRIcons.network}</span>`;
    })();

    const affiliationCountries = getAffiliationCountries(a);
    const affiliationCountryDetail = affiliationCountries.length
      ? `<div class="article-detail-meta article-affiliation-countries"><span class="article-detail-label">Affiliation countries:</span><span class="article-detail-value">${affiliationCountries.map(country => `<span class="article-country-item"><span class="article-country-flag" aria-hidden="true">${esc(country.flag)}</span><span>${esc(country.name)}</span></span>`).join('<span class="article-country-sep">,</span> ')}</span></div>`
      : '';

    // Raw institution names (as fetched via Fetch Affiliations) — a full
    // list can be long, so it's collapsed behind a toggle rather than
    // always shown inline like the country summary above it.
    const affiliations = Array.isArray(a.affiliations) ? a.affiliations.filter(Boolean) : [];
    const affiliationsDetail = affiliations.length
      ? `<div class="article-detail-meta article-affiliations-meta">
           <span class="article-detail-label">Affiliations:</span>
           <button type="button" class="article-affiliations-toggle" data-action="toggle-affiliations" aria-expanded="false">
             ${SLRIcons.chevronRight}<span>Show ${affiliations.length} affiliation${affiliations.length !== 1 ? 's' : ''}</span>
           </button>
         </div>
         <ul class="article-affiliations-list" hidden>${affiliations.map(name => `<li>${esc(name)}</li>`).join('')}</ul>`
      : '';

    const idRow = (doiLink || eidLink) ? `
      <div class="article-id-row">
        ${doiLink ? `
          <span class="article-id-item">
            <span class="article-id-label">${SLRIcons.link}DOI</span>
            ${doiLink}
            <button class="article-id-copy" data-copy="${esc(a.doi)}" title="Copy DOI">${SLRIcons.copy}</button>
          </span>` : ''}
        ${eidLink ? `
          <span class="article-id-item">
            <span class="article-id-label">${SLRIcons.externalLink}EID</span>
            ${eidLink}
            <button class="article-id-copy" data-copy="${esc(a.eid || a._id)}" title="Copy EID">${SLRIcons.copy}</button>
          </span>` : ''}
      </div>` : '';

    const abstract = a.abstract
      ? `<div class="article-abstract">${esc(a.abstract)}</div>`
      : `<div class="article-abstract no-abstract">No abstract available.</div>`;

    const comment = a.comment
      ? `<div class="article-comment">${esc(a.comment)}</div>` : '';

    // Swipe right moves an article forward (select, then add to corpus);
    // swipe left undoes in reverse (remove from corpus first, then
    // deselect) — whichever step applies next is derived from the
    // article's current selected/corpus flags, so there's no separate
    // undo-stack to track: state itself is the source of truth.
    const swipeRight = (a.selected && a.corpus) ? null
      : !a.selected ? { action: 'select',      icon: SLRIcons.selected, label: 'Select',         cls: 'accent', title: 'Mark as Selected' }
      :                { action: 'add-corpus',  icon: SLRIcons.corpus,  label: 'Add to Corpus',   cls: 'accent', title: 'Add to Corpus' };
    const swipeLeft = a.corpus ? { action: 'remove-corpus', icon: SLRIcons.close, label: 'Remove Corpus', cls: 'danger', title: 'Remove from Corpus' }
      : a.selected              ? { action: 'deselect',      icon: SLRIcons.close, label: 'Deselect',      cls: 'danger', title: 'Remove from Selected' }
      : null;
    const eidAttr = esc(eidId);
    const swipeLeftHTML = swipeLeft ? `
          <div class="article-swipe-action article-swipe-reveal-left article-swipe-${swipeLeft.cls}" data-swipe-action="${swipeLeft.action}" data-eid="${eidAttr}" title="${esc(swipeLeft.title)}">
            ${swipeLeft.icon}<span>${esc(swipeLeft.label)}</span>
          </div>` : '';
    const swipeRightHTML = swipeRight ? `
          <div class="article-swipe-action article-swipe-reveal-right article-swipe-${swipeRight.cls}" data-swipe-action="${swipeRight.action}" data-eid="${eidAttr}" title="${esc(swipeRight.title)}">
            ${swipeRight.icon}<span>${esc(swipeRight.label)}</span>
          </div>` : '';

    return `
      <div class="article-item-swipe">
        ${swipeLeftHTML}
        ${swipeRightHTML}
        <div class="article-item" ${styleAttr}
             data-eid="${esc(a.eid || a._id || '')}"
             data-selected="${a.selected ? 'true' : 'false'}"
             data-corpus="${a.corpus ? 'true' : 'false'}">
          <div class="article-item-header">
            <div class="article-badges">
              <div class="article-badges-row">
                ${sourceBadge}
                ${docTypeBadge}
              </div>
              <div class="article-badges-row">
                <button class="article-tag-pill ${tagName ? 'tag-pill-set' : 'tag-pill-unset'}"
                        data-action="open-tag-picker"
                        title="${tagName ? 'Change tag: ' + tagName : 'Set tag'}">
                  ${tagName ? `<span class="tag-dot" ${hex ? `style="background:${esc(hex)}"` : ''}></span>${esc(tagName)}` : `<span class="tag-dot tag-dot-empty"></span>No tag`}
                </button>
              </div>
            </div>
            <div class="article-main">
              <div class="article-title">${esc(a.title)}</div>
              <div class="article-meta">
                ${a.authors ? `<span>${esc(a.authors)}</span><span class="meta-sep">&middot;</span>` : ''}
                ${a.publicationName ? `<span>${esc(a.publicationName)}</span><span class="meta-sep">&middot;</span>` : ''}
                ${year ? `<span>${esc(year)}</span><span class="meta-sep">&middot;</span>` : ''}
                <span>${a.citedby || 0} cited</span>
              </div>
            </div>
          </div>

          <div class="article-tag-row">
            <span class="article-tag-row-indicators">
              <span class="abstract-indicator ${a.abstract ? 'has-abstract' : 'no-abstract'}"
                    title="${a.abstract ? 'Abstract available' : 'No abstract'}">
                ${a.abstract ? SLRIcons.eye : SLRIcons.eyeOff}
              </span>
              ${affiliationBadge}
              ${networkBadge}
            </span>
            <span class="article-tag-row-actions">
              <button class="badge badge-toggle ${a.selected ? 'badge-selected' : 'badge-dim'}"
                      data-action="toggle-selected"
                      title="${a.selected ? 'Remove from Selected' : 'Mark as Selected'}"
                      aria-label="${a.selected ? 'Remove from Selected' : 'Mark as Selected'}">${SLRIcons.selected}</button>
              <button class="badge badge-toggle ${a.corpus ? 'badge-corpus' : 'badge-dim'}"
                      data-action="toggle-corpus"
                      title="${a.corpus ? 'Remove from Corpus' : 'Add to Corpus'}"
                      aria-label="${a.corpus ? 'Remove from Corpus' : 'Add to Corpus'}">${SLRIcons.corpus}</button>
            </span>
          </div>

          <div class="article-detail">
            ${abstract}
            ${affiliationCountryDetail}
            ${affiliationsDetail}
            ${idRow}
            ${comment}
          </div>
        </div>
      </div>`;
  }

  //  Article action helpers 

  function wireArticleActions(listEl, projectData) {
    if (!listEl || !projectData) return;
    listEl.addEventListener('click', ev => {
      // Copy buttons
      const copyBtn = ev.target.closest('.article-id-copy');
      if (copyBtn) {
        ev.stopPropagation();
        navigator.clipboard.writeText(copyBtn.dataset.copy || '').then(() => {
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 1200);
        }).catch(() => {});
        return;
      }

      const btn = ev.target.closest('[data-action]');
      if (!btn) return;
      ev.stopPropagation();
      const action = btn.dataset.action;

      // Pure UI state, no article identity needed — handled before the eid
      // lookup below so it still works even on the rare article with none.
      if (action === 'toggle-affiliations') {
        const meta = btn.closest('.article-detail-meta');
        const list = meta ? meta.nextElementSibling : null;
        if (list && list.classList.contains('article-affiliations-list')) {
          const willShow = list.hidden;
          list.hidden = !willShow;
          btn.setAttribute('aria-expanded', String(willShow));
          const label = btn.querySelector('span');
          const n = list.children.length;
          if (label) label.textContent = willShow ? 'Hide affiliations' : `Show ${n} affiliation${n !== 1 ? 's' : ''}`;
        }
        return;
      }

      const item = btn.closest('.article-item');
      const eid  = item ? item.dataset.eid : null;
      if (!eid) return;
      if (action === 'toggle-selected') {
        SLRApp.updateAnnotation(eid, { selected: item.dataset.selected !== 'true' });
      } else if (action === 'toggle-corpus') {
        SLRApp.updateAnnotation(eid, { corpus: item.dataset.corpus !== 'true' });
      } else if (action === 'open-tag-picker') {
        openTagPickerPopup(btn, eid, projectData);
      } else if (action === 'show-network') {
        SLRApp.showArticleNetwork(eid);
      }
    });
  }

  // Swipe right selects, then adds to corpus; swipe left undoes the same
  // steps in reverse (see the swipeLeft/swipeRight computation in
  // articleItemHTML). Mirrors the touch-only swipe used by the History view
  // (mouse/pen still use the tap-visible badge buttons instead — dragging
  // the header with a mouse would fight with click-to-expand).
  //
  // listMode identifies which filtered list this is wired into ('all' |
  // 'selected' | 'corpus') — a left-swipe that would remove the article
  // from the list currently being viewed (deselecting in the Selected list,
  // removing from corpus in the Corpus list) asks for confirmation first,
  // since that swipe makes the card disappear immediately; the same actions
  // performed from the main Articles list never need confirmation because
  // the article stays visible there regardless of its selected/corpus state.
  function wireArticleSwipeGestures(listEl, projectData, listMode) {
    if (!listEl || !projectData) return;
    const REVEAL = 96, THRESHOLD = 56;

    const runSwipeAction = (action, eid) => {
      if (!eid) return false;
      if (action === 'select') {
        SLRApp.updateAnnotation(eid, { selected: true });
        return true;
      }
      if (action === 'add-corpus') {
        SLRApp.updateAnnotation(eid, { corpus: true });
        return true;
      }
      if (action === 'deselect') {
        if (listMode === 'selected' && !confirm('Remove this article from Selected?')) return false;
        SLRApp.updateAnnotation(eid, { selected: false });
        return true;
      }
      if (action === 'remove-corpus') {
        if (listMode === 'corpus' && !confirm('Remove this article from the Corpus?')) return false;
        SLRApp.updateAnnotation(eid, { corpus: false });
        return true;
      }
      return false;
    };

    listEl.addEventListener('click', ev => {
      const swipeAction = ev.target.closest('.article-swipe-action');
      if (!swipeAction) return;
      ev.stopPropagation();
      const swipeEl = swipeAction.closest('.article-item-swipe');
      const card = swipeEl ? swipeEl.querySelector('.article-item') : null;
      if (!card) return;
      if (!runSwipeAction(swipeAction.dataset.swipeAction, swipeAction.dataset.eid)) {
        card.style.transition = 'transform .2s ease';
        card.style.transform = '';
      }
    });

    // Delegated to listEl itself instead of one set of listeners per
    // article card — at large list sizes (thousands of articles), binding
    // 4 listeners per card on every render was the single biggest render
    // cost in the app. Only one touch gesture can ever be in progress at
    // once, so a single "active drag" record here does the same job every
    // one of those per-item closures used to. Each card's open/closed
    // state (needed so a second swipe starting from an already-revealed
    // position computes the right baseX) persists across separate gestures
    // via a data attribute on the card instead of a closure variable.
    const setX = (card, x, animate) => {
      card.style.transition = animate ? 'transform .2s ease' : 'none';
      card.style.transform = x ? `translateX(${x}px)` : '';
    };

    let active = null;

    listEl.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      const header = e.target.closest('.article-item-header');
      if (!header) return;
      const swipeEl = header.closest('.article-item-swipe');
      const card = swipeEl ? swipeEl.querySelector('.article-item') : null;
      if (!swipeEl || !card) return;
      const hasLeft  = !!swipeEl.querySelector('.article-swipe-reveal-left');
      const hasRight = !!swipeEl.querySelector('.article-swipe-reveal-right');
      if (!hasLeft && !hasRight) return;
      const openDir = Number(swipeEl.dataset.openDir) || 0;
      active = {
        swipeEl, card, header, hasLeft, hasRight, openDir,
        pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        baseX: openDir === -1 ? -REVEAL : openDir === 1 ? REVEAL : 0,
        dx: 0, dragging: false,
      };
    });

    listEl.addEventListener('pointermove', e => {
      if (!active || e.pointerType !== 'touch' || e.pointerId !== active.pointerId) return;
      const rawDx = e.clientX - active.startX;
      if (!active.dragging) {
        if (Math.abs(rawDx) < 8 || Math.abs(rawDx) < Math.abs(e.clientY - active.startY)) return;
        active.dragging = true;
        try { active.header.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      }
      const minX = active.hasLeft ? -REVEAL : 0;
      const maxX = active.hasRight ? REVEAL : 0;
      active.dx = Math.max(minX, Math.min(maxX, active.baseX + rawDx));
      setX(active.card, active.dx, false);
      e.preventDefault();
    });

    const finishSwipe = e => {
      if (!active || (e && e.pointerId !== active.pointerId)) return;
      const { swipeEl, card, hasLeft, hasRight, dx, dragging, openDir } = active;
      if (dragging) {
        let newDir = 0;
        if (dx <= -THRESHOLD && hasLeft) { setX(card, -REVEAL, true); newDir = -1; }
        else if (dx >= THRESHOLD && hasRight) { setX(card, REVEAL, true); newDir = 1; }
        else { setX(card, 0, true); newDir = 0; }
        swipeEl.dataset.openDir = String(newDir);
        swipeEl.dataset.suppressClick = '1';
      } else if (openDir !== 0) {
        setX(card, 0, true);
        swipeEl.dataset.openDir = '0';
        swipeEl.dataset.suppressClick = '1';
      }
      active = null;
    };
    listEl.addEventListener('pointerup', finishSwipe);
    listEl.addEventListener('pointercancel', finishSwipe);
  }

  // Hides the stats banner / toolbar / search row above an article list
  // while the user scrolls the list down, and brings it back on scroll-up
  // or once back near the top — there's only enough vertical room on a
  // phone/tablet to show the header stack OR a useful number of article
  // cards, not both. The collapse itself is pure CSS (a grid-template-rows
  // 1fr/0fr transition on .list-header-collapsible, scoped to the existing
  // max-width:900px breakpoint in style.css) so this listener has no visual
  // effect at desktop widths even though it still runs there.
  function wireListHeaderCollapse(container, listEl) {
    const wrap = container.querySelector('.list-header-collapsible');
    if (!wrap || !listEl) return;
    let lastTop = listEl.scrollTop;
    listEl.addEventListener('scroll', () => {
      const top = listEl.scrollTop;
      const delta = top - lastTop;
      if (top <= 8) wrap.classList.remove('is-collapsed');
      else if (delta > 6) wrap.classList.add('is-collapsed');
      else if (delta < -6) wrap.classList.remove('is-collapsed');
      lastTop = top;
    }, { passive: true });
  }

  // Grows a paginated article list's render limit (see ARTICLE_PAGE_SIZE /
  // filter.renderLimit in app.js) once the user scrolls within one
  // viewport-height of the bottom, so a huge filtered list still feels
  // like an ordinary scroll instead of hitting a hard wall at page 1.
  // `onBumpLimit` triggers a full re-render with a larger slice; the fresh
  // #list element that produces gets its own fresh listener/flag next
  // time this runs, so there's nothing to reset here after firing once.
  function wireInfiniteScroll(listEl, hasMore, onBumpLimit) {
    if (!listEl || !hasMore) return;
    let firedAlready = false;
    listEl.addEventListener('scroll', () => {
      if (firedAlready) return;
      const distanceToBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
      if (distanceToBottom > listEl.clientHeight) return;
      firedAlready = true;
      onBumpLimit();
    }, { passive: true });
  }

  function openTagPickerPopup(triggerEl, eid, projectData) {
    document.querySelector('.tag-picker-popup')?.remove();
    const aliases = projectData.tagAliases || {};
    const tags = Object.entries(projectData.tagsConfig || {});
    const popup = document.createElement('div');
    popup.className = 'tag-picker-popup';
    popup.innerHTML = tags.map(([colorKey, hex]) => {
      const label = aliases[colorKey] || colorKey;
      return `<button class="tag-picker-item" data-color-key="${esc(colorKey)}" data-label="${esc(label)}" data-color="${esc(hex || '')}">
         <span class="tag-picker-dot" ${hex ? `style="background:${esc(hex)}"` : ''}></span>
         <span>${esc(label)}</span>
       </button>`;
    }).join('');
    document.body.appendChild(popup);
    const rect = triggerEl.getBoundingClientRect();
    const estimatedH = Math.min(tags.length * 34 + 8, 280);
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < estimatedH && rect.top > estimatedH) {
      popup.style.top = (rect.top - estimatedH - 4) + 'px';
    } else {
      popup.style.top = (rect.bottom + 4) + 'px';
    }
    popup.style.left = Math.min(rect.left, window.innerWidth - 196) + 'px';
    popup.addEventListener('click', ev => {
      const item = ev.target.closest('.tag-picker-item');
      if (!item) return;
      // color = color key ("Red"), tag = display alias label
      SLRApp.updateAnnotation(eid, { tag: item.dataset.label, color: item.dataset.colorKey });
      popup.remove();
    });
    const closeHandler = ev => {
      if (!popup.contains(ev.target)) {
        popup.remove();
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
  }

  // Generic floating choice menu, shared by the Filter row's Fetch/Tag/Export
  // buttons — each just supplies its own list of {icon, label, title, warn,
  // onClick} items instead of reimplementing positioning/click-outside-close
  // three times over.
  function openToolbarPopupMenu(triggerEl, items) {
    document.querySelector('.toolbar-popup-menu')?.remove();
    const popup = document.createElement('div');
    popup.className = 'toolbar-popup-menu';
    popup.innerHTML = items.map((it, i) => `
      <button class="toolbar-popup-item${it.warn ? ' toolbar-popup-item--warn' : ''}"
              data-idx="${i}" title="${esc(it.title || '')}">
        ${it.icon}<span>${esc(it.label)}</span>
      </button>`).join('');
    document.body.appendChild(popup);

    const rect = triggerEl.getBoundingClientRect();
    const estimatedH = 34 * items.length + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < estimatedH && rect.top > estimatedH) {
      popup.style.top = (rect.top - estimatedH - 4) + 'px';
    } else {
      popup.style.top = (rect.bottom + 4) + 'px';
    }
    popup.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';

    popup.addEventListener('click', ev => {
      const item = ev.target.closest('.toolbar-popup-item');
      if (!item) return;
      popup.remove();
      items[Number(item.dataset.idx)].onClick();
    });

    const closeHandler = ev => {
      if (!popup.contains(ev.target) && ev.target !== triggerEl && !triggerEl.contains(ev.target)) {
        popup.remove();
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
  }

  function openExportMenu(triggerEl, articles, scopeLabel) {
    openToolbarPopupMenu(triggerEl, [
      { icon: SLRIcons.download, label: 'Download .bib', onClick: () => exportArticleList(articles, 'bib', scopeLabel) },
      { icon: SLRIcons.download, label: 'Download .ris', onClick: () => exportArticleList(articles, 'ris', scopeLabel) },
      { icon: SLRIcons.download, label: 'Download .csv', onClick: () => exportArticleList(articles, 'csv', scopeLabel) },
    ]);
  }

  function openFetchMenu(triggerEl) {
    const onErr = label => err => SLRApp.showToast(`${label} failed: ` + (err?.message || String(err)), true);
    openToolbarPopupMenu(triggerEl, [
      { icon: SLRIcons.eye, label: 'Fetch Abstracts',
        title: 'Fetch missing abstracts via DOI (Crossref)',
        onClick: () => void SLRApp.fetchAbstractsViaDOI().catch(onErr('Fetch abstracts')) },
      { icon: SLRIcons.user, label: 'Fetch Authors',
        title: 'Fetch full author lists via DOI (Crossref) - Scopus only delivers the first author by default',
        onClick: () => void SLRApp.fetchAuthorsViaDOI().catch(onErr('Fetch authors')) },
      { icon: SLRIcons.tag, label: 'Fetch Document Types',
        title: 'Fetch missing document types via DOI (Crossref) - e.g. Article, Chapter, Dataset, Preprint',
        onClick: () => void SLRApp.fetchTypesViaDOI().catch(onErr('Fetch types')) },
      { icon: SLRIcons.globe, label: 'Fetch Affiliations',
        title: 'Fetch affiliation names and country data via DOI / OpenAlex / PMID',
        onClick: () => void SLRApp.fetchAffiliationsViaIdentifier().catch(onErr('Fetch affiliations')) },
      { icon: SLRIcons.refresh, label: 'Fetch Everything',
        title: 'Fetch abstracts, authors, document types, affiliations, and citation network data in one run',
        onClick: () => void SLRApp.fetchAllMetadata({ mode: SLRApp.state.fetchMode }).catch(onErr('Fetch all metadata')) },
    ]);
  }

  function openTagMenu(triggerEl) {
    const onErr = err => SLRApp.showToast('Auto-tag failed: ' + (err?.message || String(err)), true);
    openToolbarPopupMenu(triggerEl, [
      { icon: SLRIcons.tag, label: 'Tag Untagged Articles',
        title: "Automatically tag articles that don't have a tag yet, based on journal name",
        onClick: () => void SLRApp.autoTagByJournal(false).catch(onErr) },
      { icon: SLRIcons.tag, label: 'Re-tag All Articles', warn: true,
        title: 'Reset every tag and re-run automatic tagging on all articles, including ones already tagged',
        onClick: () => void SLRApp.autoTagByJournal(true).catch(onErr) },
    ]);
  }

  function exportArticleList(articles, format, scopeLabel) {
    const rows = Array.isArray(articles) ? articles : [];
    if (rows.length === 0) {
      SLRApp.showToast('No articles available for export in the current list.', true);
      return;
    }

    const normalizedFormat = String(format || '').toLowerCase();
    let content = '';
    let mime = 'text/plain;charset=utf-8';

    if (normalizedFormat === 'bib') {
      content = toBib(rows);
    } else if (normalizedFormat === 'ris') {
      content = toRis(rows);
    } else if (normalizedFormat === 'csv') {
      content = toCsv(rows);
      mime = 'text/csv;charset=utf-8';
    } else {
      SLRApp.showToast('Unsupported export format.', true);
      return;
    }

    const filename = buildExportFilename(scopeLabel, normalizedFormat);
    downloadText(content, filename, mime);
    SLRApp.showToast(`Exported ${rows.length} article${rows.length !== 1 ? 's' : ''} as .${normalizedFormat}`);
  }

  function buildExportFilename(scopeLabel, ext) {
    const safeScope = String(scopeLabel || 'articles')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'articles';
    const date = new Date().toISOString().slice(0, 10);
    return `slr-${safeScope}-${date}.${ext}`;
  }

  function downloadText(text, filename, mimeType) {
    const blob = new Blob([text], { type: mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function getArticleYear(article) {
    if (article && article.yearNum) return String(article.yearNum);
    const date = String(article?.date || '');
    const match = date.match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : '';
  }

  function toBib(articles) {
    return articles.map((article, index) => {
      const key = makeBibKey(article, index);
      const year = getArticleYear(article);
      const fields = [];

      const title = escBib(article.title);
      if (title) fields.push(`  title = {${title}}`);

      const authors = escBib(formatBibAuthors(article.authors));
      if (authors) fields.push(`  author = {${authors}}`);

      const journal = escBib(article.publicationName);
      if (journal) fields.push(`  journal = {${journal}}`);

      if (year) fields.push(`  year = {${year}}`);

      const doi = escBib(article.doi);
      if (doi) fields.push(`  doi = {${doi}}`);

      const abstractText = escBib(article.abstract);
      if (abstractText) fields.push(`  abstract = {${abstractText}}`);

      const eid = escBib(article.eid || article._id);
      if (eid) fields.push(`  note = {EID: ${eid}}`);

      return `@article{${key},\n${fields.join(',\n')}\n}`;
    }).join('\n\n');
  }

  function makeBibKey(article, index) {
    const raw = String(article?.eid || article?._id || article?.doi || article?.title || `item${index + 1}`);
    const base = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 24) || `item${index + 1}`;
    return `${base}${index + 1}`;
  }

  function formatBibAuthors(authors) {
    const raw = String(authors || '').trim();
    if (!raw) return '';
    // Author lists are joined with ';' (legacy) or ',' (Scopus/PubMed/OpenAlex/
    // Crossref mappers all use ', ') — only fall back to ' and ' splitting for
    // an already-prose-joined single pair with neither delimiter present.
    const parts = raw.includes(';')
      ? raw.split(/\s*;\s*/)
      : raw.includes(',')
        ? raw.split(/\s*,\s*/)
        : raw.split(/\s+and\s+/i);
    const cleaned = parts.map(part => part.trim()).filter(Boolean);
    if (cleaned.length <= 1) return raw;
    return cleaned.join(' and ');
  }

  function escBib(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/[{}]/g, '\\$&')
      .replace(/\r?\n+/g, ' ')
      .trim();
  }

  function toRis(articles) {
    return articles.map(article => {
      const lines = ['TY  - JOUR'];
      const title = risSafe(article.title);
      if (title) lines.push(`TI  - ${title}`);

      const authorLines = splitAuthorsForRis(article.authors);
      authorLines.forEach(author => lines.push(`AU  - ${risSafe(author)}`));

      const journal = risSafe(article.publicationName);
      if (journal) lines.push(`JO  - ${journal}`);

      const year = getArticleYear(article);
      if (year) lines.push(`PY  - ${year}`);

      const date = risSafe(article.date);
      if (date) lines.push(`DA  - ${date}`);

      const doi = risSafe(article.doi);
      if (doi) {
        lines.push(`DO  - ${doi}`);
        lines.push(`UR  - https://doi.org/${doi}`);
      }

      const abstractText = risSafe(article.abstract);
      if (abstractText) lines.push(`AB  - ${abstractText}`);

      const eid = risSafe(article.eid || article._id);
      if (eid) lines.push(`ID  - ${eid}`);

      lines.push('ER  -');
      return lines.join('\n');
    }).join('\n\n');
  }

  function splitAuthorsForRis(authors) {
    const raw = String(authors || '').trim();
    if (!raw) return [];
    if (raw.includes(';')) {
      return raw.split(/\s*;\s*/).map(part => part.trim()).filter(Boolean);
    }
    // Scopus/PubMed/OpenAlex/Crossref mappers all join multi-author lists with
    // ', ' (see mapPubmedResult, mapOpenAlexResult, mapCrossrefSearchResult,
    // fetchAuthorsViaDOI in app.js) — without this, every multi-author RIS
    // export collapsed into a single garbled AU line.
    if (raw.includes(',')) {
      return raw.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
    }
    if (/\sand\s/i.test(raw)) {
      return raw.split(/\s+and\s+/i).map(part => part.trim()).filter(Boolean);
    }
    return [raw];
  }

  function risSafe(value) {
    return String(value || '').replace(/\r?\n+/g, ' ').trim();
  }

  function toCsv(articles) {
    const headers = [
      'eid', 'title', 'authors', 'journal', 'date', 'year', 'citedby', 'doi',
      'abstract', 'tag', 'color', 'selected', 'corpus', 'source', 'docType'
    ];
    const rows = articles.map(article => ([
      article.eid || article._id || '',
      article.title || '',
      article.authors || '',
      article.publicationName || '',
      article.date || '',
      getArticleYear(article),
      article.citedby || 0,
      article.doi || '',
      article.abstract || '',
      article.tag || '',
      article.color || '',
      article.selected ? 'true' : 'false',
      article.corpus ? 'true' : 'false',
      article.source || '',
      article.docType || ''
    ]));
    return [headers, ...rows]
      .map(line => line.map(csvEscape).join(','))
      .join('\n');
  }

  function csvEscape(value) {
    const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function applyFilter(articles, filter, projectData) {
    let list = articles;

    // Mode
    if (filter.mode === 'selected') list = list.filter(a => a.selected);
    if (filter.mode === 'corpus')   list = list.filter(a => a.corpus);

    // Tag (multi-select — an article matches if its tag is any one of the
    // selected tags; empty selection means no tag filtering at all)
    if (Array.isArray(filter.tags) && filter.tags.length > 0) {
      const tagSet = new Set(filter.tags);
      list = list.filter(a => {
        const effective = (a.tag && a.tag !== 'None') ? a.tag : TAG_FILTER_NONE;
        return tagSet.has(effective);
      });
    }

    // Year
    const yFrom = parseInt(filter.yearFrom, 10) || 0;
    const yTo   = parseInt(filter.yearTo,   10) || 9999;
    if (yFrom > 0 || yTo < 9999) {
      list = list.filter(a => {
        const y = a.yearNum || 0;
        return y >= yFrom && y <= yTo;
      });
    }

    // Search — scoped to whichever fields are checked in the toolbar's
    // "Fields" multi-select (title/abstract/journal by default, same as the
    // fixed 3-field search this replaced).
    if (filter.search) {
      const terms = String(filter.search)
        .split(';')
        .map(term => term.trim().toLowerCase())
        .filter(Boolean);
      const fieldKeys = (Array.isArray(filter.searchFields) && filter.searchFields.length)
        ? filter.searchFields : DEFAULT_SEARCH_FIELDS;
      const fieldGetters = SEARCH_FIELD_OPTIONS.filter(f => fieldKeys.includes(f.key)).map(f => f.prop);
      if (terms.length > 0 && fieldGetters.length > 0) {
        list = list.filter(a => {
          const searchableText = fieldGetters.map(getProp => getProp(a) || '').join(' ').toLowerCase();
          return terms.every(term => searchableText.includes(term));
        });
      }
    }

    // Sort
    const s = filter.sort;
    list = list.slice().sort((a, b) => {
      if (s === 'newest') return (b.yearNum || 0) - (a.yearNum || 0);
      if (s === 'oldest') return (a.yearNum || 0) - (b.yearNum || 0);
      if (s === 'cited')  return (b.citedby  || 0) - (a.citedby  || 0);
      if (s === 'title')  return (a.title || '').localeCompare(b.title || '');
      return 0;
    });

    return list;
  }

  // Tag chips-with-counts row, shared by Articles / Selected / Corpus.
  // `activeTags` is an array — multiple chips can be active/pinned at once.
  function buildTagBreakdownHTML(list, projectData, activeTags) {
    const activeSet = new Set(activeTags || []);
    const tagMap = new Map();
    for (const a of list) {
      const label = (a.tag && a.tag !== 'None') ? a.tag : null;
      if (!label) continue;
      if (!tagMap.has(label)) tagMap.set(label, { count: 0, hex: tagColor(projectData, a.color) || '' });
      tagMap.get(label).count++;
    }
    const chips = [...tagMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([t, { count: n, hex: hexVal }]) => {
        const active = activeSet.has(t) ? 'active' : '';
        return `<button class="corpus-tag-chip ${active}" data-tag="${esc(t)}"
                        ${hexVal ? `style="--tag-color:${esc(hexVal)}"` : ''}>
                  <span class="tag-dot" ${hexVal ? `style="background:${esc(hexVal)}"` : ''}></span>
                  ${esc(t)}
                  <span class="chip-count">${n}</span>
                </button>`;
      }).join('');

    const untaggedCount = list.filter(a => !a.tag || a.tag === 'None').length;
    const noneChip = untaggedCount > 0
      ? `<button class="corpus-tag-chip ${activeSet.has(TAG_FILTER_NONE) ? 'active' : ''}" data-tag="${TAG_FILTER_NONE}">
           <span class="tag-dot tag-dot-empty"></span>
           None
           <span class="chip-count">${untaggedCount}</span>
         </button>`
      : '';

    return [noneChip, chips].filter(Boolean).join('');
  }

  // "Tag: X" / "Tags: X, Y" summary label shared by the stats row below.
  function formatActiveTagsLabel(tags) {
    if (!tags || !tags.length) return '';
    const names = tags.map(t => t === TAG_FILTER_NONE ? 'None' : t);
    return `<span class="stats-sep">|</span><span>${tags.length > 1 ? 'Tags' : 'Tag'}: ${esc(names.join(', '))}</span>`;
  }

  // The small "Showing N of M" line under the toolbar — identical shape in
  // Articles/Selected/Corpus (no per-view selected/corpus breakdown here;
  // that's already in the green banner above the toolbar).
  function buildListStatsHTML(shownCount, totalCount, totalLabel, filter) {
    return `
      <div class="articles-stats">
        <span>Showing <strong>${shownCount}</strong> of <strong>${totalCount}</strong>${totalLabel ? ' ' + esc(totalLabel) : ''}</span>
        ${formatActiveTagsLabel(filter.tags)}
        ${filter.search ? `<span class="stats-sep">|</span><span>Search: "${esc(filter.search)}"</span>` : ''}
      </div>`;
  }

  // Toolbar markup shared by Articles / Selected / Corpus — same layout in
  // all three:
  //   Row 1 — Filter toggle, then Fetch / Tag / Export (each opens a choice
  //           popup rather than being 7+ separate buttons).
  //   (only while the Filter toggle is on: tag chips)
  //   Row 2 — search box + the "Fields" multi-select (which fields the
  //           search box matches against).
  //   Row 3 — year range + sort, always visible (used to hide behind the
  //           Filter toggle along with the tag chips; now it's its own
  //           permanent row since it's core filtering, not a rarely-needed
  //           extra like the tag breakdown).
  function buildListToolbarHTML(opts) {
    const {
      list, projectData, activeTags, filterVisible,
      searchId, searchValue, searchFields,
      sortId, sortValue,
      yearFromId, yearFromValue, yearToId, yearToValue,
      exportTitle,
    } = opts;

    const breakdown = buildTagBreakdownHTML(list, projectData, activeTags);
    const activeCount = (activeTags || []).length;
    const fields = (Array.isArray(searchFields) && searchFields.length) ? searchFields : DEFAULT_SEARCH_FIELDS;

    return `
      <div class="list-toolbar">
        <div class="list-toolbar-row">
          <button type="button" class="list-filter-toggle${filterVisible ? ' active' : ''}" id="list-filter-toggle"
                  title="${filterVisible ? 'Hide' : 'Show'} tag filters" aria-label="Toggle tag filters" aria-expanded="${filterVisible ? 'true' : 'false'}">
            ${SLRIcons.filter}
            <span>Filter${activeCount ? ` (${activeCount})` : ''}</span>
          </button>
          <button class="articles-action-btn" id="fetch-menu-btn"
                  title="Fetch missing abstracts, authors, document types, or affiliations">
            ${SLRIcons.refresh} Fetch
          </button>
          <button class="articles-action-btn" id="tag-menu-btn"
                  title="Automatically tag articles by journal name">
            ${SLRIcons.tag} Tag
          </button>
          <button class="articles-action-btn" id="export-list-btn"
              title="${esc(exportTitle || 'Download current list as .bib, .ris, or .csv')}">
            ${SLRIcons.download} Export
          </button>
        </div>

        ${filterVisible && breakdown ? `<div class="corpus-tag-breakdown">${breakdown}</div>` : ''}

        <div class="list-toolbar-row">
          <div class="search-input-wrap">
            ${SLRIcons.search}
            <input class="search-input" id="${searchId}"
                   type="text" placeholder="Search selected fields (use ; for AND)"
                   value="${esc(searchValue)}" autocomplete="off">
          </div>
          <button type="button" class="articles-action-btn search-fields-toggle" id="search-fields-toggle"
                  data-fields="${esc(fields.join(','))}" title="Choose which fields the search box matches against">
            ${SLRIcons.filter} Fields (${fields.length})
          </button>
        </div>

        <div class="list-toolbar-row">
          <div class="filter-year-wrap">
            <input class="year-input" id="${yearFromId}" type="number"
                   placeholder="From" min="1900" max="2100" value="${esc(yearFromValue)}">
                 <span>-</span>
            <input class="year-input" id="${yearToId}" type="number"
                   placeholder="To" min="1900" max="2100" value="${esc(yearToValue)}">
          </div>
          <select class="filter-select" id="${sortId}" title="Sort order">
            <option value="newest" ${sortValue==='newest'?'selected':''}>Newest first</option>
            <option value="oldest" ${sortValue==='oldest'?'selected':''}>Oldest first</option>
            <option value="cited"  ${sortValue==='cited' ?'selected':''}>Most cited</option>
            <option value="title"  ${sortValue==='title' ?'selected':''}>Title A-Z</option>
          </select>
        </div>
      </div>`;
  }

  // Multi-select popup for the "Fields" button — unlike openToolbarPopupMenu
  // (Fetch/Tag/Export), it stays open while the user toggles several
  // checkboxes instead of closing after the first click, and applies each
  // change live via onChange.
  function openSearchFieldsPopup(triggerEl, currentFields, onChange) {
    document.querySelector('.search-fields-popup')?.remove();
    const selected = new Set((currentFields && currentFields.length) ? currentFields : DEFAULT_SEARCH_FIELDS);
    const popup = document.createElement('div');
    popup.className = 'toolbar-popup-menu search-fields-popup';
    popup.innerHTML = SEARCH_FIELD_OPTIONS.map(opt => `
      <label class="settings-category-item search-fields-item">
        <input type="checkbox" value="${esc(opt.key)}" ${selected.has(opt.key) ? 'checked' : ''}>
        <span>${esc(opt.label)}</span>
      </label>`).join('');
    document.body.appendChild(popup);

    const rect = triggerEl.getBoundingClientRect();
    const estimatedH = SEARCH_FIELD_OPTIONS.length * 30 + 10;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < estimatedH && rect.top > estimatedH) {
      popup.style.top = (rect.top - estimatedH - 4) + 'px';
    } else {
      popup.style.top = (rect.bottom + 4) + 'px';
    }
    popup.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';

    popup.addEventListener('change', ev => {
      const cb = ev.target.closest('input[type="checkbox"]');
      if (!cb) return;
      if (cb.checked) {
        selected.add(cb.value);
      } else {
        // Never let every field end up unchecked — that would silently
        // match nothing rather than "search nothing in particular".
        if (selected.size <= 1) { cb.checked = true; return; }
        selected.delete(cb.value);
      }
      onChange([...selected]);
    });

    const closeHandler = ev => {
      if (!popup.contains(ev.target) && ev.target !== triggerEl && !triggerEl.contains(ev.target)) {
        popup.remove();
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
  }

  // Wires the shared toolbar's controls. `onFilter` receives a state patch
  // for the view's own setXFilter; `onExport` receives no args (the caller
  // closes over the current filtered list); `onTagsChange` receives the full
  // new tags array when a chip is clicked (add/remove one tag).
  function wireListToolbar(container, { onFilter, onExport, onTagsChange, activeTags }) {
    const filterToggle = container.querySelector('#list-filter-toggle');
    if (filterToggle) filterToggle.addEventListener('click', () => SLRApp.toggleTagBreakdown());

    container.querySelectorAll('.corpus-tag-breakdown .corpus-tag-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tag;
        const current = activeTags || [];
        const next = current.includes(t) ? current.filter(x => x !== t) : [...current, t];
        onTagsChange(next);
      });
    });

    const searchInput = container.querySelector('#list-search');
    if (searchInput) {
      let searchTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => onFilter({ search: searchInput.value }), 220);
      });
    }

    const fieldsToggle = container.querySelector('#search-fields-toggle');
    if (fieldsToggle) {
      fieldsToggle.addEventListener('click', ev => {
        ev.stopPropagation();
        const current = (fieldsToggle.dataset.fields || '').split(',').filter(Boolean);
        openSearchFieldsPopup(fieldsToggle, current, fields => onFilter({ searchFields: fields }));
      });
    }

    const sortSelect = container.querySelector('#list-sort');
    if (sortSelect) sortSelect.addEventListener('change', e => onFilter({ sort: e.target.value }));

    const yearFrom = container.querySelector('#list-year-from');
    const yearTo   = container.querySelector('#list-year-to');
    if (yearFrom && yearTo) {
      let yearTimer;
      const onYearChange = () => {
        clearTimeout(yearTimer);
        yearTimer = setTimeout(() => onFilter({ yearFrom: yearFrom.value, yearTo: yearTo.value }), 400);
      };
      yearFrom.addEventListener('input', onYearChange);
      yearTo.addEventListener('input', onYearChange);
    }

    const bind = (id, handler) => {
      const el = container.querySelector('#' + id);
      if (el) el.addEventListener('click', handler);
    };
    bind('fetch-menu-btn', ev => { ev.stopPropagation(); openFetchMenu(ev.currentTarget); });
    bind('tag-menu-btn', ev => { ev.stopPropagation(); openTagMenu(ev.currentTarget); });
    bind('export-list-btn', ev => {
      ev.stopPropagation();
      onExport(ev);
    });
  }

  //  History view

  function renderHistory(container, searchLog, projectData, historyState) {
    if (!projectData) {
      container.innerHTML = `<div class="history-view" style="padding:0">${renderNoProjectNotice()}</div>`;
      return;
    }

    const statusFilter = (historyState && historyState.statusFilter) || 'active';
    const sortDir      = (historyState && historyState.sortDir) || 'desc';

    // Every entry is tagged with its true position in the raw (unreversed,
    // newest-first) searchLog array BEFORE any filtering/sorting for display
    // \u2014 that raw index is what every backend mutation (trash/archive/restore/
    // delete) addresses, so it must travel with the entry regardless of the
    // order it ends up rendered in. Mixing this up (using a post-sort
    // display position instead) is exactly what caused queries to delete
    // the wrong entry.
    const tagged = (searchLog || []).map((run, rawIndex) => ({ run, rawIndex }));

    const counts = { active: 0, archived: 0, trashed: 0 };
    for (const { run } of tagged) {
      const s = run.status || 'active';
      if (counts[s] !== undefined) counts[s]++;
    }

    // Raw array is already newest-first (new entries are unshifted in), so
    // "newest first" is just ascending rawIndex order and "oldest first" is
    // descending rawIndex order \u2014 no timestamp parsing needed.
    const filtered = tagged
      .filter(({ run }) => (run.status || 'active') === statusFilter)
      .sort((a, b) => sortDir === 'asc' ? b.rawIndex - a.rawIndex : a.rawIndex - b.rawIndex);

    const tabsHTML = `
      <div class="history-toolbar">
        <div class="hist-tabs" role="tablist">
          <button class="hist-tab${statusFilter === 'active' ? ' active' : ''}" data-tab="active" role="tab" aria-selected="${statusFilter === 'active'}">Active<span class="hist-tab-count">${counts.active}</span></button>
          <button class="hist-tab${statusFilter === 'archived' ? ' active' : ''}" data-tab="archived" role="tab" aria-selected="${statusFilter === 'archived'}">${SLRIcons.archive}Archived<span class="hist-tab-count">${counts.archived}</span></button>
          <button class="hist-tab${statusFilter === 'trashed' ? ' active' : ''}" data-tab="trashed" role="tab" aria-selected="${statusFilter === 'trashed'}">${SLRIcons.trash}Trash<span class="hist-tab-count">${counts.trashed}</span></button>
        </div>
        <select class="filter-select" id="history-sort" title="Sort by date">
          <option value="desc"${sortDir === 'desc' ? ' selected' : ''}>Newest first</option>
          <option value="asc"${sortDir === 'asc' ? ' selected' : ''}>Oldest first</option>
        </select>
      </div>`;

    // Per-tab swipe/action mapping \u2014 left swipe (or the left action button)
    // is always the "more destructive" action, right is always "less
    // destructive / undo", so the gesture stays consistent across tabs.
    let leftAction, rightAction;
    if (statusFilter === 'trashed') {
      leftAction  = { action: 'delete-forever', icon: SLRIcons.trash,   label: 'Delete',  cls: 'danger', title: 'Delete permanently' };
      rightAction = { action: 'restore',        icon: SLRIcons.restore, label: 'Restore', cls: 'accent', title: 'Restore to active' };
    } else if (statusFilter === 'archived') {
      leftAction  = { action: 'trash',   icon: SLRIcons.trash,   label: 'Trash',   cls: 'danger', title: 'Move to trash' };
      rightAction = { action: 'restore', icon: SLRIcons.restore, label: 'Restore', cls: 'accent', title: 'Restore to active' };
    } else {
      leftAction  = { action: 'trash',   icon: SLRIcons.trash,   label: 'Trash',   cls: 'danger', title: 'Move to trash' };
      rightAction = { action: 'archive', icon: SLRIcons.archive, label: 'Archive', cls: 'accent', title: 'Archive this query' };
    }

    let bodyHTML;
    if (filtered.length === 0) {
      const emptyMsg = statusFilter === 'active' ? 'No query history found for this project.'
        : statusFilter === 'archived' ? 'No archived queries.'
        : 'Trash is empty.';
      bodyHTML = `<p style="color:var(--text-faint)">${esc(emptyMsg)}</p>`;
    } else {
      const items = filtered.map(({ run, rawIndex }) => {
        const queryPreview = (run.query || '').replace(/\s+/g, ' ').slice(0, 120);
        const count = run.count || (run.results ? run.results.length : 0);

        // Resolve DB badge from run.view
        const viewKey = (run.view || 'scopus').toLowerCase();
        const dbSourceKey = DB_SOURCE_KEY[viewKey] || 'scopus';
        const dbLabel     = DB_LABELS[viewKey]     || run.view || 'Scopus';
        const dbBadge = `<span class="badge badge-source badge-source-${esc(dbSourceKey)}">${esc(dbLabel)}</span>`;

        const results = Array.isArray(run.results) ? run.results : [];
        const resultsHTML = results.slice(0, 30).map(r => {
          const ann  = projectData.globalTags[r.eid] || {};
          const hex  = tagColor(projectData, ann.color);
          const year = r.date ? r.date.slice(0, 4) : '';
          return `
            <div class="history-result-item">
              <div class="history-result-dot"
                   ${hex ? `style="background:${esc(hex)}"` : ''}></div>
              <div class="history-result-title">${esc(r.title)}</div>
              <div class="history-result-year">${esc(year)}</div>
            </div>`;
        }).join('');

        const moreCount = results.length > 30 ? results.length - 30 : 0;

        // Tag distribution bar
        const tagBar = (() => {
          if (!results.length) return '';
          const colorCounts = {};
          let untagged = 0;
          for (const r of results) {
            const ann = (projectData.globalTags || {})[r.eid] || {};
            if (ann.color && ann.color !== 'None') {
              colorCounts[ann.color] = (colorCounts[ann.color] || 0) + 1;
            } else {
              untagged++;
            }
          }
          const aliases = projectData.tagAliases || {};
          const segs = Object.entries(colorCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([colorKey, n]) => {
              const hex   = tagColor(projectData, colorKey) || '#888';
              const label = aliases[colorKey] || colorKey;
              return `<span class="hist-tag-seg" style="flex:${n};background:${esc(hex)}" title="${esc(label)}: ${n}"></span>`;
            });
          if (untagged > 0) segs.push(`<span class="hist-tag-seg hist-tag-seg-none" style="flex:${untagged}" title="Untagged: ${untagged}"></span>`);
          if (segs.length === 0) return '';
          return `<div class="hist-tag-bar">${segs.join('')}</div>`;
        })();

        // Desktop hover-reveal action buttons (touch has no hover \u2014 those
        // users get the swipe gesture below instead).
        const actionButtons = statusFilter === 'trashed'
          ? `<button class="hist-action-btn" data-action="restore" data-index="${rawIndex}" title="Restore to active">${SLRIcons.restore}</button>
             <button class="hist-action-btn hist-action-danger" data-action="delete-forever" data-index="${rawIndex}" title="Delete permanently">${SLRIcons.trash}</button>`
          : statusFilter === 'archived'
          ? `<button class="hist-action-btn" data-action="restore" data-index="${rawIndex}" title="Restore to active">${SLRIcons.restore}</button>
             <button class="hist-action-btn hist-action-danger" data-action="trash" data-index="${rawIndex}" title="Move to trash">${SLRIcons.trash}</button>`
          : `<button class="hist-action-btn" data-action="archive" data-index="${rawIndex}" title="Archive this query">${SLRIcons.archive}</button>
             <button class="hist-action-btn hist-action-danger" data-action="trash" data-index="${rawIndex}" title="Move to trash">${SLRIcons.trash}</button>`;

        return `
          <div class="history-item-swipe">
            <div class="hist-swipe-action hist-swipe-reveal-left hist-swipe-${leftAction.cls}" data-action="${leftAction.action}" data-index="${rawIndex}" title="${esc(leftAction.title)}">
              ${leftAction.icon}<span>${esc(leftAction.label)}</span>
            </div>
            <div class="hist-swipe-action hist-swipe-reveal-right hist-swipe-${rightAction.cls}" data-action="${rightAction.action}" data-index="${rawIndex}" title="${esc(rightAction.title)}">
              ${rightAction.icon}<span>${esc(rightAction.label)}</span>
            </div>
            <div class="history-item" id="hist-${rawIndex}">
              <div class="history-item-header" data-hist="${rawIndex}">
                <span class="history-chevron">${SLRIcons.chevronRight}</span>
                <div class="history-meta">
                  <div class="history-timestamp">${esc(run.timestamp)}</div>
                  <div class="history-query-preview">${esc(queryPreview)}${run.query && run.query.length > 120 ? '\u2026' : ''}</div>
                  ${tagBar}
                </div>
                <div class="history-badges">
                  <div class="history-badges-row">
                    ${dbBadge}
                    <span class="history-count">${count} result${count !== 1 ? 's' : ''}</span>
                  </div>
                  <div class="history-badges-row">
                    ${actionButtons}
                    <button class="hist-copy-btn" data-query="${esc(run.query || '')}" title="Copy query to clipboard">${SLRIcons.copy}</button>
                  </div>
                </div>
              </div>
              <div class="history-query-full">
                <pre>${esc(run.query)}</pre>
              </div>
              <div class="history-results-list">
                ${resultsHTML}
                ${moreCount > 0 ? `<div style="padding:8px 16px;font-size:12px;color:var(--text-faint)"> and ${moreCount} more</div>` : ''}
              </div>
            </div>
          </div>`;
      }).join('');
      bodyHTML = `<div class="history-list">${items}</div>`;
    }

    container.innerHTML = `<div class="history-view">${tabsHTML}${bodyHTML}</div>`;

    container.querySelectorAll('.hist-tab').forEach(btn => {
      btn.addEventListener('click', () => SLRApp.setHistoryStatusFilter(btn.dataset.tab));
    });
    const sortSel = container.querySelector('#history-sort');
    if (sortSel) sortSel.addEventListener('change', e => SLRApp.setHistorySortDir(e.target.value));

    if (filtered.length === 0) return;

    const runHistoryAction = (action, idx) => {
      if (action === 'trash' && confirm('Move this query to Trash? You can restore it later.')) SLRApp.trashHistoryQuery(idx);
      else if (action === 'archive' && confirm('Archive this query? You can find it later in the Archived tab.')) SLRApp.archiveHistoryQuery(idx);
      else if (action === 'restore' && confirm('Restore this query to Active?')) SLRApp.restoreHistoryQuery(idx);
      else if (action === 'delete-forever' && confirm('Permanently delete this query? This cannot be undone.')) SLRApp.permanentlyDeleteHistoryQuery(idx);
      else return false;
      return true;
    };

    container.querySelector('.history-list').addEventListener('click', e => {
      const swipeAction = e.target.closest('.hist-swipe-action');
      if (swipeAction) {
        e.stopPropagation();
        const idx = parseInt(swipeAction.dataset.index, 10);
        const card = swipeAction.closest('.history-item-swipe').querySelector('.history-item');
        if (!runHistoryAction(swipeAction.dataset.action, idx)) {
          card.style.transition = 'transform .2s ease';
          card.style.transform = '';
        }
        return;
      }

      const actionBtn = e.target.closest('.hist-action-btn');
      if (actionBtn) {
        e.stopPropagation();
        runHistoryAction(actionBtn.dataset.action, parseInt(actionBtn.dataset.index, 10));
        return;
      }

      const copyBtn = e.target.closest('.hist-copy-btn');
      if (copyBtn) {
        e.stopPropagation();
        const q = copyBtn.dataset.query;
        if (navigator.clipboard) navigator.clipboard.writeText(q);
        const prev = copyBtn.innerHTML;
        copyBtn.innerHTML = SLRIcons.check;
        setTimeout(() => { copyBtn.innerHTML = prev; }, 1200);
        return;
      }

      const header = e.target.closest('.history-item-header');
      if (!header) return;
      const swipeEl = header.closest('.history-item-swipe');
      if (swipeEl && swipeEl.dataset.suppressClick === '1') {
        delete swipeEl.dataset.suppressClick;
        return;
      }
      const item = header.closest('.history-item');
      item.classList.toggle('expanded');
    });

    // Touch swipe: left reveals leftAction, right reveals rightAction.
    // Mouse/pen keep the desktop hover-reveal buttons above instead \u2014
    // dragging the header with a mouse would fight with click-to-expand.
    const REVEAL = 96, THRESHOLD = 56;
    container.querySelectorAll('.history-item-swipe').forEach(swipeEl => {
      const card = swipeEl.querySelector('.history-item');
      const header = swipeEl.querySelector('.history-item-header');
      let startX = null, startY = 0, baseX = 0, dx = 0, dragging = false, openDir = 0;

      const setX = (x, animate) => {
        card.style.transition = animate ? 'transform .2s ease' : 'none';
        card.style.transform = x ? `translateX(${x}px)` : '';
      };

      header.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'touch') return;
        startX = e.clientX;
        startY = e.clientY;
        dragging = false;
        baseX = openDir === -1 ? -REVEAL : openDir === 1 ? REVEAL : 0;
      });

      header.addEventListener('pointermove', e => {
        if (e.pointerType !== 'touch' || startX === null) return;
        const rawDx = e.clientX - startX;
        if (!dragging) {
          if (Math.abs(rawDx) < 8 || Math.abs(rawDx) < Math.abs(e.clientY - startY)) return;
          dragging = true;
          try { header.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        }
        dx = Math.max(-REVEAL, Math.min(REVEAL, baseX + rawDx));
        setX(dx, false);
        e.preventDefault();
      });

      const finish = () => {
        if (dragging) {
          if (dx <= -THRESHOLD) { setX(-REVEAL, true); openDir = -1; }
          else if (dx >= THRESHOLD) { setX(REVEAL, true); openDir = 1; }
          else { setX(0, true); openDir = 0; }
          swipeEl.dataset.suppressClick = '1';
        } else if (openDir !== 0 && startX !== null) {
          setX(0, true);
          openDir = 0;
          swipeEl.dataset.suppressClick = '1';
        }
        startX = null;
        dragging = false;
      };

      header.addEventListener('pointerup', finish);
      header.addEventListener('pointercancel', finish);
    });
  }

  //  Loading state

  function renderLoading(container, message) {
    container.innerHTML = `
      <div class="loading-spinner">
        <svg class="spinner-ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle class="spinner-ring-track" cx="22" cy="22" r="18"></circle>
          <circle class="spinner-ring-arc" cx="22" cy="22" r="18"></circle>
        </svg>
        <span>${esc(message || 'Loading...')}</span>
      </div>`;
  }

  function renderError(container, message) {
    container.innerHTML = `
      <div class="error-notice">
        ${SLRIcons.warning}
        <span>${esc(message)}</span>
      </div>`;
  }

  //  Corpus view 

  /**
   * Dedicated Corpus view  shows only corpus=true articles.
   * Has its own search/sort/tag filter but no mode tabs.
   */
  function renderCorpus(container, articles, filter, projectData) {
    const corpusArticles = articles.filter(a => a.corpus);
    const stats          = SLRData.getStats(corpusArticles);

    const filtered = applyFilter(corpusArticles, Object.assign({}, filter, { mode: 'corpus' }), projectData);
    const renderLimit = filter.renderLimit || 200;
    const visible = filtered.slice(0, renderLimit);
    const hasMore = visible.length < filtered.length;
    const listHTML = !projectData
      ? renderNoProjectNotice()
      : filtered.length === 0
      ? `<div class="article-list-empty">${SLRIcons.corpus}<p>No corpus articles match the current filters.</p></div>`
      : visible.map(a => articleItemHTML(a, projectData, buildCitationNetworkIndex(articles))).join('');

    container.innerHTML = `
      <div class="articles-view">

        <div class="list-header-collapsible"><div class="list-header-collapsible-inner">
        <div class="corpus-banner">
          <span class="corpus-banner-stat">
            ${SLRIcons.corpus}
            <span><strong>${stats.corpus}</strong> article${stats.corpus !== 1 ? 's' : ''} in corpus</span>
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.articles}
            <span>from ${articles.length} total</span>
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.tag}
            <span><strong>${Object.keys(stats.byTag).filter(t => t !== 'None').length}</strong> tag${Object.keys(stats.byTag).filter(t => t !== 'None').length !== 1 ? 's' : ''} used</span>
          </span>
        </div>

        ${buildListToolbarHTML({
          list: corpusArticles, projectData, activeTags: filter.tags,
          filterVisible: !!SLRApp.state.tagBreakdownVisible,
          searchId: 'list-search', searchValue: filter.search, searchFields: filter.searchFields,
          sortId: 'list-sort', sortValue: filter.sort,
          yearFromId: 'list-year-from', yearFromValue: filter.yearFrom,
          yearToId: 'list-year-to', yearToValue: filter.yearTo,
          exportTitle: 'Download current list as .bib, .ris, or .csv',
        })}

        ${buildListStatsHTML(filtered.length, stats.corpus, 'corpus articles', filter)}
        </div></div>

        <div class="article-list" id="corpus-list">
          ${listHTML}
        </div>
      </div>`;

    wireListToolbar(container, {
      onFilter: patch => SLRApp.setCorpusFilter(patch),
      onTagsChange: tags => SLRApp.setCorpusFilter({ tags }),
      onExport: () => {
        const exportBtn = container.querySelector('#export-list-btn');
        openExportMenu(exportBtn, filtered, 'corpus');
      },
      activeTags: filter.tags,
    });

    container.querySelector('#corpus-list').addEventListener('click', e => {
      const item = e.target.closest('.article-item');
      if (!item || e.target.tagName === 'A') return;
      if (e.target.closest('[data-action]')) return;
      if (e.target.closest('.article-id-copy')) return;
      const swipeEl = item.closest('.article-item-swipe');
      if (swipeEl && swipeEl.dataset.suppressClick === '1') { delete swipeEl.dataset.suppressClick; return; }
      item.classList.toggle('expanded');
    });
    wireArticleActions(container.querySelector('#corpus-list'), projectData);
    wireArticleSwipeGestures(container.querySelector('#corpus-list'), projectData, 'corpus');
    wireListHeaderCollapse(container, container.querySelector('#corpus-list'));
    wireInfiniteScroll(container.querySelector('#corpus-list'), hasMore, () => SLRApp.bumpCorpusRenderLimit());
  }

  //  Selected view 

  function renderSelected(container, articles, filter, projectData) {
    const selectedArticles = articles.filter(a => a.selected);
    const stats = SLRData.getStats(selectedArticles);

    const filtered = applyFilter(selectedArticles, Object.assign({}, filter, { mode: 'selected' }), projectData);
    const renderLimit = filter.renderLimit || 200;
    const visible = filtered.slice(0, renderLimit);
    const hasMore = visible.length < filtered.length;
    const listHTML = !projectData
      ? renderNoProjectNotice()
      : filtered.length === 0
      ? `<div class="article-list-empty">${SLRIcons.selected}<p>No selected articles match the current filters.</p></div>`
      : visible.map(a => articleItemHTML(a, projectData, buildCitationNetworkIndex(articles))).join('');

    container.innerHTML = `
      <div class="articles-view">
        <div class="list-header-collapsible"><div class="list-header-collapsible-inner">
        <div class="corpus-banner" style="border-left-color:var(--accent)">
          <span class="corpus-banner-stat">
            ${SLRIcons.selected}
            <span><strong>${selectedArticles.length}</strong> article${selectedArticles.length !== 1 ? 's' : ''} selected</span>
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.articles}
            <span>from ${articles.length} total</span>
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.corpus}
            <span><strong>${stats.corpus}</strong> in corpus</span>
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.tag}
            <span><strong>${Object.keys(stats.byTag).filter(t => t !== 'None').length}</strong> tag${Object.keys(stats.byTag).filter(t => t !== 'None').length !== 1 ? 's' : ''} used</span>
          </span>
        </div>

        ${buildListToolbarHTML({
          list: selectedArticles, projectData, activeTags: filter.tags,
          filterVisible: !!SLRApp.state.tagBreakdownVisible,
          searchId: 'list-search', searchValue: filter.search, searchFields: filter.searchFields,
          sortId: 'list-sort', sortValue: filter.sort,
          yearFromId: 'list-year-from', yearFromValue: filter.yearFrom,
          yearToId: 'list-year-to', yearToValue: filter.yearTo,
          exportTitle: 'Download current list as .bib, .ris, or .csv',
        })}

        ${buildListStatsHTML(filtered.length, selectedArticles.length, 'selected articles', filter)}
        </div></div>

        <div class="article-list" id="selected-list">${listHTML}</div>
      </div>`;

    wireListToolbar(container, {
      onFilter: patch => SLRApp.setSelectedFilter(patch),
      onTagsChange: tags => SLRApp.setSelectedFilter({ tags }),
      onExport: () => {
        const exportBtn = container.querySelector('#export-list-btn');
        openExportMenu(exportBtn, filtered, 'selected');
      },
      activeTags: filter.tags,
    });

    container.querySelector('#selected-list').addEventListener('click', e => {
      const item = e.target.closest('.article-item');
      if (!item || e.target.tagName === 'A') return;
      if (e.target.closest('[data-action]')) return;
      if (e.target.closest('.article-id-copy')) return;
      const swipeEl = item.closest('.article-item-swipe');
      if (swipeEl && swipeEl.dataset.suppressClick === '1') { delete swipeEl.dataset.suppressClick; return; }
      item.classList.toggle('expanded');
    });
    wireArticleActions(container.querySelector('#selected-list'), projectData);
    wireArticleSwipeGestures(container.querySelector('#selected-list'), projectData, 'selected');
    wireListHeaderCollapse(container, container.querySelector('#selected-list'));
    wireInfiniteScroll(container.querySelector('#selected-list'), hasMore, () => SLRApp.bumpSelectedRenderLimit());
  }

  //  Visualizations view 

  // ── PNG export (foreignObject → Canvas → download) ─────────────────────────
  // ── PNG export: native Canvas 2D — no foreignObject, no tainted-canvas ──────
  async function exportVizAsPNG(chartEl, title, chartType) {
    const gv  = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const bgC = gv('--bg') || '#0d1117', txtC = gv('--text') || '#e6edf3',
          mutC = gv('--text-muted') || '#8b949e', sfC = gv('--surface-2') || '#21262d',
          bdC  = gv('--border') || '#30363d';
    const FONT = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    const SCALE = 2, PAD = 44, HDR = 52;
    const cr = chartEl.getBoundingClientRect();
    const cW = Math.max(cr.width, 820), cH = Math.max(cr.height, 420);
    const W = cW + PAD * 2, H = cH + HDR + PAD * 2;
    const canvas = document.createElement('canvas');
    canvas.width  = Math.ceil(W * SCALE);
    canvas.height = Math.ceil(H * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    if (!ctx.roundRect) ctx.roundRect = function(x, y, w, h) { this.rect(x, y, w, h); };
    ctx.fillStyle = bgC; ctx.fillRect(0, 0, W, H);
    ctx.font = `600 15px ${FONT}`; ctx.fillStyle = txtC;
    ctx.fillText(title, PAD, PAD);
    ctx.font = `400 11px ${FONT}`; ctx.fillStyle = mutC;
    ctx.fillText(`SLR Harvester Web \u00b7 ${new Date().toLocaleDateString()}`, PAD, PAD + 20);
    const ox = PAD, oy = PAD + HDR;
    const resolveVarStr = s => s.replace(/var\(\s*([^,)]+)(?:,\s*([^)]*))?\s*\)/g,
      (_, k, fb) => gv(k.trim()) || fb || '#888');

    if (chartType === 'doughnut') {
      const svgEl = chartEl.querySelector('svg.viz-doughnut-svg');
      if (svgEl) {
        const sr = svgEl.getBoundingClientRect();
        const sw = Math.ceil(sr.width || 340), sh = Math.ceil(sr.height || 340);
        const origEls   = [svgEl, ...svgEl.querySelectorAll('*')];
        const compFills = origEls.map(el => getComputedStyle(el).fill);
        const clone     = svgEl.cloneNode(true);
        clone.setAttribute('width', sw); clone.setAttribute('height', sh);
        const cloneEls  = [clone, ...clone.querySelectorAll('*')];
        origEls.forEach((orig, i) => {
          const cl = cloneEls[i]; if (!cl) return;
          cl.removeAttribute('class');
          ['fill', 'stroke'].forEach(attr => {
            const v = orig.getAttribute(attr);
            if (v !== null) cl.setAttribute(attr, v.includes('var(') ? resolveVarStr(v) : v);
          });
          if (!orig.getAttribute('fill') && (orig.tagName === 'text' || orig.tagName === 'tspan')) {
            const cf = compFills[i];
            cl.setAttribute('fill', (cf && cf !== 'rgb(0, 0, 0)') ? cf : txtC);
          }
        });
        const xml = new XMLSerializer().serializeToString(clone);
        const uri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
        await new Promise((res, rej) => {
          const img = new Image();
          img.onload  = () => { ctx.drawImage(img, ox, oy, sw, sh); res(); };
          img.onerror = () => rej(new Error('SVG render failed'));
          img.src = uri;
        });
        let ly = oy + 8; const lx = ox + sw + 24;
        chartEl.querySelectorAll('.viz-legend-item').forEach(item => {
          const dot = item.querySelector('.viz-legend-dot');
          const lbl = item.querySelector('.viz-legend-label');
          const cnt = item.querySelector('.viz-legend-count');
          if (!dot || !lbl) return;
          ctx.fillStyle = getComputedStyle(dot).backgroundColor;
          ctx.beginPath(); ctx.roundRect(lx, ly, 10, 10, 2); ctx.fill();
          ctx.font = `400 12px ${FONT}`; ctx.fillStyle = txtC;
          ctx.fillText((lbl.textContent || '').trim(), lx + 14, ly + 10);
          if (cnt) { ctx.font = `600 12px ${FONT}`; ctx.fillText((cnt.textContent || '').trim(), lx + 200, ly + 10); }
          ly += 20;
        });
      }
    } else if (chartType === 'world') {
      const svgEl = chartEl.querySelector('svg.viz-world-svg');
      if (svgEl) {
        const sr = svgEl.getBoundingClientRect();
        const sw = Math.ceil(sr.width || 1000), sh = Math.ceil(sr.height || 520);
        const clone = svgEl.cloneNode(true);
        clone.setAttribute('width', sw);
        clone.setAttribute('height', sh);
        const xml = new XMLSerializer().serializeToString(clone);
        const uri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
        await new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => { ctx.drawImage(img, ox, oy, sw, sh); res(); };
          img.onerror = () => rej(new Error('SVG render failed'));
          img.src = uri;
        });
        let ly = oy + 8;
        const lx = ox + sw + 24;
        chartEl.querySelectorAll('.viz-world-legend-item').forEach(item => {
          const dot = item.querySelector('.viz-legend-dot');
          const lbl = item.querySelector('.viz-legend-label');
          const cnt = item.querySelector('.viz-legend-count');
          if (!dot || !lbl) return;
          ctx.fillStyle = getComputedStyle(dot).backgroundColor;
          ctx.beginPath(); ctx.roundRect(lx, ly, 10, 10, 2); ctx.fill();
          ctx.font = `400 12px ${FONT}`; ctx.fillStyle = txtC;
          ctx.fillText((lbl.textContent || '').trim(), lx + 14, ly + 10);
          if (cnt) { ctx.font = `600 12px ${FONT}`; ctx.fillText((cnt.textContent || '').trim(), lx + 200, ly + 10); }
          ly += 20;
        });
      }
    } else if (chartType === 'bars') {
      const lblW = Math.floor(cW * 0.28), barW = cW - lblW - 72;
      let y = oy;
      chartEl.querySelectorAll('.viz-bar-row').forEach(row => {
        const lE = row.querySelector('.viz-bar-label'), fE = row.querySelector('.viz-bar-fill'),
              cE = row.querySelector('.viz-bar-count');
        if (!lE || !fE) return;
        ctx.font = `400 12px ${FONT}`; ctx.fillStyle = txtC;
        ctx.fillText((lE.textContent || '').trim(), ox, y + 16, lblW - 6);
        ctx.fillStyle = sfC; ctx.beginPath(); ctx.roundRect(ox + lblW, y + 6, barW, 18, 3); ctx.fill();
        const pct = parseFloat(fE.style.width) || 0;
        if (pct > 0) {
          ctx.fillStyle = getComputedStyle(fE).backgroundColor;
          ctx.beginPath(); ctx.roundRect(ox + lblW, y + 6, barW * pct / 100, 18, 3); ctx.fill();
        }
        if (cE) { ctx.font = `600 11px ${FONT}`; ctx.fillStyle = mutC; ctx.fillText((cE.textContent || '').trim(), ox + lblW + barW + 6, y + 16); }
        y += 36;
      });
    } else if (chartType === 'year') {
      // The chart is now three parallel rows (counts / bars-area / year
      // labels) instead of one .viz-col-item per column, so the per-column
      // elements are gathered by matching index across each row rather than
      // queried from within a single grouping element.
      const barWraps = [...chartEl.querySelectorAll('.viz-col-bar-wrap')];
      const labelEls = [...chartEl.querySelectorAll('.viz-col-label')];
      const countEls = [...chartEl.querySelectorAll('.viz-col-count')];
      const chartH = cH - 56, cw2 = barWraps.length ? Math.min(50, Math.floor((cW - 8) / barWraps.length)) : 40;

      const gridLines = [...chartEl.querySelectorAll('.viz-year-grid-line')];
      if (gridLines.length) {
        ctx.save();
        ctx.strokeStyle = bdC;
        ctx.setLineDash([3, 3]);
        gridLines.forEach(line => {
          const bottomPct = parseFloat(line.style.bottom) || 0;
          const y = oy + chartH - (chartH * bottomPct / 100);
          ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + cW, y); ctx.stroke();
        });
        ctx.restore();
      }

      let x = ox; ctx.textAlign = 'center';
      barWraps.forEach((wrap, i) => {
        const bEl = wrap.querySelector('.viz-col-bar');
        const lEl = labelEls[i], kEl = countEls[i];
        if (!bEl || !lEl) return;
        const barH = chartH * (parseFloat(bEl.style.height) || 0) / 100;
        const barTop = oy + (chartH - barH);
        const segs  = [...bEl.querySelectorAll('.viz-col-seg')];
        const total = segs.reduce((s, sg) => s + (parseFloat(sg.style.flex) || 1), 0) || 1;
        let segY = barTop;
        segs.forEach(sg => {
          const flex = parseFloat(sg.style.flex) || 1;
          ctx.fillStyle = getComputedStyle(sg).backgroundColor;
          ctx.fillRect(x + 2, segY, cw2 - 4, barH * flex / total);
          segY += barH * flex / total;
        });
        ctx.font = `400 9px ${FONT}`; ctx.fillStyle = mutC;
        ctx.fillText((lEl.textContent || '').trim(), x + cw2 / 2, oy + chartH + 14);
        if (kEl && barH > 0) { ctx.font = `600 9px ${FONT}`; ctx.fillStyle = txtC; ctx.fillText((kEl.textContent || '').trim(), x + cw2 / 2, barTop - 3); }
        x += cw2;
      });
      let lx2 = ox, ly2 = oy + chartH + 28; ctx.textAlign = 'left';
      chartEl.querySelectorAll('.viz-year-legend-item').forEach(item => {
        const d2 = item.querySelector('.viz-legend-dot'), l2 = item.querySelector('.viz-legend-label');
        if (!d2 || !l2) return;
        ctx.fillStyle = getComputedStyle(d2).backgroundColor;
        ctx.beginPath(); ctx.roundRect(lx2, ly2, 8, 8, 2); ctx.fill();
        ctx.font = `400 10px ${FONT}`; ctx.fillStyle = txtC;
        const t2 = (l2.textContent || '').trim();
        ctx.fillText(t2, lx2 + 11, ly2 + 8);
        lx2 += ctx.measureText(t2).width + 24;
        if (lx2 > ox + cW - 80) { lx2 = ox; ly2 += 15; }
      });
    } else if (chartType === 'prisma') {
      const steps = chartEl.querySelector('.prisma-steps'), boxW = Math.min(480, cW - 160);
      let y = oy + 4;
      if (steps) {
        [...steps.children].forEach(child => {
          if (child.classList.contains('prisma-box')) {
            const bc2  = child.style.borderLeftColor || '#64A8FF';
            const pct2 = parseFloat(child.querySelector('.prisma-pbar-fill')?.style.width || '100');
            ctx.fillStyle = sfC; ctx.strokeStyle = bdC; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(ox, y, boxW, 62, 4); ctx.fill(); ctx.stroke();
            ctx.fillStyle = bc2; ctx.fillRect(ox, y, 4, 62);
            ctx.font = `700 9px ${FONT}`; ctx.fillStyle = mutC;
            ctx.fillText((child.querySelector('.prisma-box-stage')?.textContent || '').toUpperCase(), ox + 12, y + 12);
            const nE = child.querySelector('.prisma-box-n'), dE = child.querySelector('.prisma-box-desc'),
                  mE = child.querySelector('.prisma-box-meta');
            if (nE) { ctx.font = `700 22px ${FONT}`; ctx.fillStyle = txtC; ctx.fillText(nE.textContent || '', ox + 12, y + 42); }
            if (dE) { ctx.font = `400 11px ${FONT}`; ctx.fillStyle = txtC; ctx.fillText((dE.textContent || '').trim(), ox + 85, y + 28); }
            if (mE) { ctx.font = `400 10px ${FONT}`; ctx.fillStyle = mutC; ctx.fillText((mE.textContent || '').trim(), ox + 85, y + 46); }
            ctx.fillStyle = bdC; ctx.fillRect(ox, y + 58, boxW, 4);
            ctx.fillStyle = bc2; ctx.fillRect(ox, y + 58, boxW * pct2 / 100, 4);
            y += 70;
          } else if (child.classList.contains('prisma-step-connector')) {
            ctx.strokeStyle = bdC; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(ox + boxW / 2, y); ctx.lineTo(ox + boxW / 2, y + 24); ctx.stroke();
            ctx.fillStyle = bdC;
            ctx.beginPath(); ctx.moveTo(ox + boxW / 2 - 5, y + 20); ctx.lineTo(ox + boxW / 2 + 5, y + 20); ctx.lineTo(ox + boxW / 2, y + 28); ctx.fill();
            const nX = child.querySelector('.prisma-excl-n'), lX = child.querySelector('.prisma-excl-label');
            if (nX) {
              const exX = ox + boxW + 18, exY = y + 4, exW = Math.min(190, cW - boxW - 30);
              ctx.fillStyle = sfC; ctx.strokeStyle = bdC; ctx.lineWidth = 1;
              ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.roundRect(exX, exY, exW, 36, 4); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
              ctx.beginPath(); ctx.moveTo(ox + boxW, y + 16); ctx.lineTo(exX, exY + 18); ctx.stroke();
              ctx.font = `700 14px ${FONT}`; ctx.fillStyle = mutC; ctx.fillText(nX.textContent || '', exX + 8, exY + 18);
              if (lX) { ctx.font = `400 9px ${FONT}`; ctx.fillText((lX.textContent || '').trim(), exX + 8, exY + 30); }
            }
            y += 38;
          }
        });
      }
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Canvas export failed')); return; }
        const a = document.createElement('a'), u = URL.createObjectURL(blob);
        a.href = u;
        a.download = `slr-viz-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.png`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(u); }, 1000);
        resolve();
      }, 'image/png');
    });
  }

  function renderVisualizations(container, articles, projectData) {
    if (!projectData) {
      container.innerHTML = `<div class="viz-view" style="padding:0">${renderNoProjectNotice()}</div>`;
      return;
    }
    if (!articles || articles.length === 0) {
      container.innerHTML = `<div class="viz-view"><p style="color:var(--text-faint);padding:20px">No articles in this project yet.</p></div>`;
      return;
    }
    const stats = SLRData.getStats(articles);

    // Which category (or categories — an article can carry several
    // affiliation countries) an article belongs to under a given grouping
    // dimension. Shared by every chart type below and by the year chart's
    // per-year stacking, so "group by X" means the same thing everywhere.
    const NONE_LABELS = { tag: 'None', doctype: 'Unknown Type', country: 'No Country Data' };
    const getArticleCategories = (a, groupBy) => {
      if (groupBy === 'doctype') {
        const key = normalizeDocTypeKey(a.docType, a.source);
        return key ? [{ key, label: formatDocTypeLabel(key), hex: hueColor(key) }] : [];
      }
      if (groupBy === 'country') {
        return getAffiliationCountries(a).map(c => ({ key: c.code, label: c.name, hex: hueColor(c.code) }));
      }
      const hasNamedTag = a.tag && a.tag !== 'None';
      return hasNamedTag ? [{ key: a.tag, label: a.tag, hex: tagColor(projectData, a.color) || '#888' }] : [];
    };

    // Build category data from articles (label -> { count, hex }) for the
    // doughnut/bars charts. An article missing the chosen dimension (no
    // tag, no doc type, no country data) falls into a "None"/"Unknown"
    // bucket, same as the old tag-only behavior.
    const computeGroupedData = (subset, groupBy, includeNone = true) => {
      const labelMap = new Map();
      for (const a of subset) {
        const cats = getArticleCategories(a, groupBy);
        if (cats.length === 0) {
          if (!includeNone) continue;
          if (!labelMap.has(TAG_FILTER_NONE)) labelMap.set(TAG_FILTER_NONE, { label: NONE_LABELS[groupBy] || 'None', hex: 'var(--surface-3)', count: 0 });
          labelMap.get(TAG_FILTER_NONE).count++;
          continue;
        }
        for (const c of cats) {
          if (!labelMap.has(c.key)) labelMap.set(c.key, { label: c.label, hex: c.hex, count: 0 });
          labelMap.get(c.key).count++;
        }
      }
      const bars = [...labelMap.entries()]
        .map(([key, { label, hex, count }]) => ({ name: label, key, hex, count }))
        .sort((a, b) => b.count - a.count);
      return { total: subset.length, bars };
    };

    const getSubset = (mode) =>
      mode === 'selected' ? articles.filter(a => a.selected)
    : mode === 'corpus'   ? articles.filter(a => a.corpus)
    : articles;

    // Height is user-resizable (drag handle below each chart) and persisted
    // per chart type — but the *first-paint* default (before a user has ever
    // dragged that particular chart) is shared across bars/doughnut/year and
    // depends on the viewport's current orientation, so a fresh project shows
    // a taller chart in portrait (more vertical room) than in landscape,
    // without ever locking the chart to a viewport-height clamp() (that used
    // to make charts towering in portrait and squashed in landscape).
    const CHART_HEIGHT_MIN = 160, CHART_HEIGHT_MAX = 700;
    const getDefaultChartHeight = () => {
      const portrait = typeof window.matchMedia === 'function' && window.matchMedia('(orientation: portrait)').matches;
      return portrait ? 440 : 320;
    };
    const getChartHeight = (storageKey) => {
      const saved = parseInt(localStorage.getItem(storageKey), 10);
      return (Number.isFinite(saved) && saved >= CHART_HEIGHT_MIN && saved <= CHART_HEIGHT_MAX) ? saved : getDefaultChartHeight();
    };

    // Unlike the other charts, dragging the bars chart's handle doesn't
    // resize a container to clip/scroll within — there's no graphic to
    // clip, "resize" here means each row's own track thickness, and the
    // list just takes up however much total height that produces. Own
    // (much smaller) range and storage key since the value means something
    // completely different from a container height.
    const BAR_TRACK_MIN = 14, BAR_TRACK_MAX = 44;
    const getBarTrackHeight = () => {
      const saved = parseInt(localStorage.getItem('slr-bars-row-height'), 10);
      return (Number.isFinite(saved) && saved >= BAR_TRACK_MIN && saved <= BAR_TRACK_MAX) ? saved : 20;
    };

      const renderBars = (mode, groupBy, includeNone) => {
      const { total, bars } = computeGroupedData(getSubset(mode), groupBy, includeNone);
      if (bars.length === 0) return `<div class="viz-empty-bars">No data in this selection.</div>`;
      const maxCount = bars[0].count;
      const rowsHTML = bars.map(d => {
        const pct    = total > 0 ? (d.count / total * 100).toFixed(1) : '0.0';
        const barPct = maxCount > 0 ? (d.count / maxCount * 100).toFixed(1) : '0';
        return `
          <div class="viz-bar-row">
            <div class="viz-bar-label" title="${esc(d.name)}">${esc(d.name)}</div>
            <div class="viz-bar-track">
              <div class="viz-bar-fill" style="width:${barPct}%;background:${esc(d.hex)}"></div>
            </div>
            <div class="viz-bar-count"><strong>${d.count}</strong> <span class="viz-bar-pct">${pct}%</span></div>
          </div>`;
      }).join('');
      // The label column is only ever as wide as the longest label actually
      // showing (capped for pathological cases) — it used to be a flat
      // 260px regardless of content, which on a chart of short labels wasted
      // several cm of width that the bars themselves could have used.
      const maxLabelLen = bars.reduce((m, d) => Math.max(m, d.name.length), 4);
      const labelWidthCh = Math.min(maxLabelLen, 40);
      const trackH = getBarTrackHeight();
      return `
        <div class="viz-resizable-chart-block">
          <div class="viz-bars-scroll" id="viz-bars-area" style="--bar-label-w:${labelWidthCh}ch;--bar-track-h:${trackH}px">${rowsHTML}</div>
          <div class="viz-col-resize-handle" id="viz-bars-resize-handle"
               title="Drag to resize bar thickness" role="separator" aria-orientation="horizontal">
            <span class="viz-col-resize-grip"></span>
          </div>
        </div>`;
    };

      const renderDoughnut = (mode, groupBy, showLegend, includeNone) => {
      const { bars: rawBars } = computeGroupedData(getSubset(mode), groupBy, includeNone);
      if (rawBars.length === 0) return `<div class="viz-empty-bars">No data in this selection.</div>`;
      // Sort by hue so visually similar colours are adjacent in the ring
      const hexHue = hex => {
        const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
        const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
        if (d === 0) return 0;
        let h = max===r ? ((g-b)/d+6)%6 : max===g ? (b-r)/d+2 : (r-g)/d+4;
        return h * 60;
      };
      const bars = [...rawBars].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count; // largest first
        // tiebreaker: group similar hues together
        const ha = a.hex.length === 7 ? hexHue(a.hex) : 0;
        const hb = b.hex.length === 7 ? hexHue(b.hex) : 0;
        return ha - hb;
      });
      const sum  = bars.reduce((s, d) => s + d.count, 0);
      const r = 130, cx = 170, cy = 170;
      const circ = 2 * Math.PI * r;
      let cumulative = 0;
      const segments = bars.map((d, i) => {
        const arc = (d.count / sum) * circ;
        const dashOffset = -cumulative;
        cumulative += arc;
        return `<circle class="viz-seg" data-idx="${i}" cx="${cx}" cy="${cy}" r="${r}"
          fill="none" stroke="${esc(d.hex)}" stroke-width="58"
          stroke-dasharray="${arc.toFixed(3)} ${circ.toFixed(3)}"
          stroke-dashoffset="${dashOffset.toFixed(3)}"
          pointer-events="all" style="cursor:pointer"
          transform="rotate(-90 ${cx} ${cy})"/>`;
      }).join('');
      const legend = bars.map((d, i) => {
        const pct = sum > 0 ? (d.count / sum * 100).toFixed(1) : '0';
        return `<div class="viz-legend-item" data-idx="${i}" style="cursor:pointer">
          <span class="viz-legend-dot" style="background:${esc(d.hex)}"></span>
          <span class="viz-legend-label" title="${esc(d.name)}">${esc(d.name)}</span>
          <span class="viz-legend-count">${d.count}</span>
          <span class="viz-bar-pct">${pct}%</span>
        </div>`;
      }).join('');
        const centerSub = groupBy === 'doctype' ? 'typed' : groupBy === 'country' ? 'assignments' : 'tagged';
        const chartHeight = getChartHeight('slr-doughnut-chart-height');
        // The legend lives outside the resizable area (like the year
        // chart's .viz-year-legend below its own resize block) — the
        // height handle only ever resizes the graphic itself, never the
        // legend, which is only ever toggled by the Hide Legend button.
        // The svg itself scales to fill the resized height (see
        // .viz-doughnut-svg's height:100% in style.css) instead of staying
        // a fixed size and getting clipped/scrolled within a shorter box.
        return `
        <div class="viz-resizable-chart-block">
          <div class="viz-doughnut-scroll" id="viz-doughnut-area" style="height:${chartHeight}px">
            <svg class="viz-doughnut-svg" viewBox="0 0 340 340" aria-hidden="true">
              <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
                      stroke="var(--surface-2)" stroke-width="58"/>
              ${segments}
              <text x="${cx}" y="${cy - 12}" text-anchor="middle"
                    class="viz-doughnut-num">${sum}</text>
              <text x="${cx}" y="${cy + 20}" text-anchor="middle"
                    class="viz-doughnut-sub">${esc(centerSub)}</text>
            </svg>
          </div>
          <div class="viz-col-resize-handle" id="viz-doughnut-resize-handle"
               title="Drag to resize chart" role="separator" aria-orientation="horizontal">
            <span class="viz-col-resize-grip"></span>
          </div>
        </div>
        ${showLegend ? `<div class="viz-legend viz-doughnut-legend">${legend}</div>` : ''}`;
    };

    //  Year distribution (stacked by the selected grouping dimension)
    const computeYearData = (subset, groupBy, includeNone = true) => {
      const yearMap = new Map(); // year -> Map<key, {count, hex, label}>
      for (const a of subset) {
        const yr = a.yearNum;
        if (!yr || yr < 1900 || yr > 2100) continue;
        if (!yearMap.has(yr)) yearMap.set(yr, new Map());
        const tm = yearMap.get(yr);
        const cats = getArticleCategories(a, groupBy);
        if (cats.length === 0) {
          if (!includeNone) continue;
          if (!tm.has(TAG_FILTER_NONE)) tm.set(TAG_FILTER_NONE, { count: 0, hex: 'var(--surface-3)', label: NONE_LABELS[groupBy] || 'None' });
          tm.get(TAG_FILTER_NONE).count++;
          continue;
        }
        for (const c of cats) {
          if (!tm.has(c.key)) tm.set(c.key, { count: 0, hex: c.hex, label: c.label });
          tm.get(c.key).count++;
        }
      }
      const years = [...yearMap.entries()].sort((a, b) => a[0] - b[0]);
      const maxTotal = years.reduce((m, [, tm]) => {
        const t = [...tm.values()].reduce((s, v) => s + v.count, 0);
        return Math.max(m, t);
      }, 0);
      return { years, maxTotal };
    };

      // Nice round tick values for the year chart's count-axis grid (e.g.
      // 0/10/20/30/40/50 for a max around 47) — same "nice numbers" approach
      // any charting library uses, so the grid always lands on round marks
      // instead of splitting the raw max into awkward fractions. The top
      // tick must never land below `max` (that used to happen — e.g. max=47
      // stopped at 40, not 50 — which let the tallest bar's height% exceed
      // 100 and poke up over the count label above it); rounding the top
      // tick up to the next whole step guarantees it's always >= max.
      const niceTicks = (maxValue, targetCount = 5) => {
        const max = Math.max(1, maxValue);
        const rawStep = max / targetCount;
        const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const norm = rawStep / mag;
        const niceNorm = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
        const step = Math.max(1, Math.round(niceNorm * mag));
        const top = Math.ceil(max / step) * step;
        const ticks = [];
        for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(v);
        return ticks;
      };

      const renderYearBars = (mode, groupBy, showLegend, includeNone) => {
      const { years, maxTotal } = computeYearData(getSubset(mode), groupBy, includeNone);
      if (years.length === 0) return `<div class="viz-empty-bars">No year data available.</div>`;

      // Build unique tag list ordered by total count (for legend)
      const tagTotals = new Map();
      for (const [, tagMap] of years) {
        for (const [key, v] of tagMap.entries()) {
          if (!tagTotals.has(key)) tagTotals.set(key, { label: v.label, hex: v.hex, total: 0 });
          tagTotals.get(key).total += v.count;
        }
      }
      const namedTags    = [...tagTotals.entries()].filter(([k]) => k !== '__none__').sort((a, b) => b[1].total - a[1].total);
      const noneMeta = tagTotals.get('__none__');
      const allTagEntries = noneMeta ? [...namedTags, ['__none__', noneMeta]] : namedTags;

      const ticks    = niceTicks(maxTotal);
      const topValue = ticks[ticks.length - 1];
      const gridHTML = ticks.map(t => `
        <div class="viz-year-grid-line" style="bottom:${(t / topValue * 100).toFixed(2)}%">
          <span class="viz-year-grid-label">${t}</span>
        </div>`).join('');

      const counts = years.map(([, tagMap]) => {
        const total = [...tagMap.values()].reduce((s, v) => s + v.count, 0);
        return `<div class="viz-col-count">${total}</div>`;
      }).join('');

      const bars = years.map(([, tagMap]) => {
        const total = [...tagMap.values()].reduce((s, v) => s + v.count, 0);
        // Clamped defensively — niceTicks already guarantees topValue >= max,
        // but the tallest bar must never be able to poke up past the top
        // grid line/over the count label above it regardless.
        const heightPct = topValue > 0 ? Math.min(100, total / topValue * 100).toFixed(1) : '0';
        const tagged   = [...tagMap.entries()].filter(([k]) => k !== '__none__').sort((a, b) => b[1].count - a[1].count);
        const none     = tagMap.get('__none__');
        const allSegs  = none ? [...tagged, ['__none__', none]] : tagged;
        const segs = allSegs.map(([key, v]) => {
          return `<div class="viz-col-seg" data-tag-key="${esc(key)}" style="flex:${v.count};background:${v.hex}" title="${esc(v.label)}: ${v.count}"></div>`;
        }).join('');
        return `<div class="viz-col-bar-wrap"><div class="viz-col-bar" style="height:${heightPct}%">${segs}</div></div>`;
      }).join('');

      const labels = years.map(([yr]) => `<div class="viz-col-label">${yr}</div>`).join('');

      const legendHTML = allTagEntries.map(([key, { label, hex }]) =>
        `<div class="viz-year-legend-item viz-legend-item" data-tag-key="${esc(key)}">
          <span class="viz-legend-dot" style="background:${esc(hex)}"></span>
          <span class="viz-legend-label">${esc(label)}</span>
        </div>`
      ).join('');

      const chartHeight = getChartHeight('slr-year-chart-height');

      return `
        <div class="viz-resizable-chart-block">
          <div class="viz-col-chart-wrap${showLegend ? '' : ' legend-hidden'}">
            <div class="viz-col-chart">
              <div class="viz-col-counts">${counts}</div>
              <div class="viz-col-bars-area" id="viz-year-bars-area" style="height:${chartHeight}px">
                <div class="viz-year-grid">${gridHTML}</div>
                ${bars}
              </div>
              <div class="viz-col-years">${labels}</div>
            </div>
          </div>
          <div class="viz-col-resize-handle" id="viz-year-resize-handle"
               title="Drag to resize chart height" role="separator" aria-orientation="horizontal">
            <span class="viz-col-resize-grip"></span>
          </div>
        </div>
        ${showLegend && legendHTML ? `<div class="viz-year-legend">${legendHTML}</div>` : ''}`;
    };

    const renderPrisma = () => {
      const history    = projectData.searchLog || [];
      const nQueries   = history.length;
      const nRaw       = history.reduce((s, e) => s + (Array.isArray(e.results) ? e.results.length : (e.count || 0)), 0);
      if (nQueries === 0 || nRaw === 0) {
        return `<div class="viz-empty-bars">No search history yet. Run queries first to see the PRISMA screening flow.</div>`;
      }
      const nDedup  = articles.length;
      const nDups   = Math.max(0, nRaw - nDedup);
      const nExcl   = Math.max(0, nDedup - stats.selected);
      const nDrop   = Math.max(0, stats.selected - stats.corpus);
      // relative: each step's percentage and bar width vs its direct predecessor
      const relPct  = (n, of) => of > 0 ? (n / of * 100).toFixed(1) : '0.0';

      const mkBox = (stageKey, stage, n, desc, meta, color, bw) => `
        <div class="prisma-box prisma-box-clickable" data-prisma-stage="${esc(stageKey)}" style="border-left-color:${color}" tabindex="0" role="button" aria-label="View ${esc(stage)} records">
          <div class="prisma-box-stage">${esc(stage)}</div>
          <div class="prisma-box-body">
            <span class="prisma-box-n">${n.toLocaleString()}</span>
            <div class="prisma-box-text">
              <span class="prisma-box-desc">${esc(desc)}</span>
              <span class="prisma-box-meta">${esc(meta)}</span>
            </div>
          </div>
          <div class="prisma-pbar"><div class="prisma-pbar-fill" style="width:${bw}%;background:${color}"></div></div>
        </div>`;

      const mkConn = (exclKey, n, label, reason) => `
        <div class="prisma-step-connector prisma-step-connector-clickable" data-prisma-excl="${esc(exclKey)}" tabindex="0" role="button" aria-label="View ${esc(label)}">
          <div class="prisma-sc-vline"></div>
          <div class="prisma-sc-right">
            <div class="prisma-sc-excl">
              <span class="prisma-excl-n">${n.toLocaleString()}</span>
              <div class="prisma-excl-text">
                <span class="prisma-excl-label">${esc(label)}</span>
                <span class="prisma-excl-reason">${esc(reason)}</span>
              </div>
            </div>
          </div>
        </div>`;

      // Per-source breakdown for the Identification stage \u2014 e.g. "1 query on
      // Scopus, 2 on OpenAlex" \u2014 computed from the same searchLog runs that
      // feed nRaw/nQueries above, so it always agrees with those numbers.
      const sourceStats = new Map();
      for (const run of history) {
        const viewKey = (run.view || 'scopus').toLowerCase();
        const key   = DB_SOURCE_KEY[viewKey] || 'scopus';
        const label = DB_LABELS[viewKey] || run.view || 'Scopus';
        const records = Array.isArray(run.results) ? run.results.length : (run.count || 0);
        if (!sourceStats.has(key)) sourceStats.set(key, { label, queries: 0, records: 0 });
        const s = sourceStats.get(key);
        s.queries++;
        s.records += records;
      }
      // Rendered as its own row of small cards feeding into the Identification
      // box below \u2014 same .prisma-box look as the main stages, just narrower \u2014
      // instead of the old badge-chip row that used to sit under that box.
      const sourceBoxesHTML = [...sourceStats.entries()].map(([key, s]) => {
        const color = DB_COLORS[key] || '#888';
        return `
        <div class="prisma-box prisma-box-source prisma-box-clickable prisma-source-chip" data-source-key="${esc(key)}" style="border-left-color:${color}" tabindex="0" role="button" aria-label="View ${esc(s.label)} queries">
          <div class="prisma-box-stage">${esc(s.label)}</div>
          <div class="prisma-box-body">
            <span class="prisma-box-n">${s.records.toLocaleString()}</span>
            <div class="prisma-box-text">
              <span class="prisma-box-desc">Record${s.records === 1 ? '' : 's'} identified</span>
              <span class="prisma-box-meta">${s.queries} quer${s.queries === 1 ? 'y' : 'ies'}</span>
            </div>
          </div>
          <div class="prisma-pbar"><div class="prisma-pbar-fill" style="width:${relPct(s.records, nRaw)}%;background:${color}"></div></div>
        </div>`;
      }).join('');

      return `
        <div class="prisma-wrap">
          <div class="prisma-steps">
            ${sourceBoxesHTML ? `<div class="prisma-sources-row">${sourceBoxesHTML}</div><div class="prisma-sources-connector"></div>` : ''}
            ${mkBox('identification', 'Identification', nRaw,
              'Records identified from database searches',
              `${nQueries} search quer${nQueries===1?'y':'ies'} \u00b7 starting point`,
              '#64A8FF', 100)}
            ${mkConn('duplicates', nDups,  'Records removed before screening', 'Duplicates removed (same EID or DOI across queries)')}
            ${mkBox('screening', 'Screening', nDedup,
              'Records screened after deduplication',
              `${relPct(nDedup, nRaw)}% of identified \u00b7 ${nDedup.toLocaleString()} unique articles`,
              '#7BD3D3', +relPct(nDedup, nRaw))}
            ${mkConn('screening-excluded', nExcl, 'Records excluded', 'Not marked as selected in title / abstract screening')}
            ${mkBox('eligibility', 'Eligibility', stats.selected,
              'Records assessed for eligibility',
              `${relPct(stats.selected, nDedup)}% of screening \u00b7 selected for full-text review`,
              '#81C995', +relPct(stats.selected, nDedup))}
            ${mkConn('eligibility-excluded', nDrop, 'Records excluded', 'Selected but not included in corpus after full-text review')}
            ${mkBox('included', 'Included', stats.corpus,
              'Studies included in review corpus',
              `${relPct(stats.corpus, stats.selected)}% of eligibility \u00b7 final corpus`,
              '#00aa55', +relPct(stats.corpus, stats.selected))}
          </div>
          <p class="prisma-hint">Click a stage to jump to its records, or an exclusion step to see what was removed. Drag the handle below to show less/more detail.</p>
        </div>
        <div class="viz-col-resize-handle" id="viz-prisma-resize-handle"
             title="Drag to show more or less detail" role="separator" aria-orientation="horizontal">
          <span class="viz-col-resize-grip"></span>
        </div>`;
    };

    const nQueries  = (projectData.searchLog || []).length;

    container.innerHTML = `
      <div class="viz-view">

        <div class="viz-section">
          <div class="viz-section-controls">
            <div class="viz-controls-row viz-controls-row--top">
              <div class="viz-controls-left">
                <select class="filter-select viz-chart-select" id="viz-chart-select" title="Chart type">
                  <option value="doughnut">Tag Distribution — Doughnut</option>
                  <option value="bars">Tag Distribution — Bars</option>
                  <option value="year">Year Distribution</option>
                  <option value="world">World Map</option>
                  <option value="prisma">Screening Flow (PRISMA)</option>
                </select>
                <select class="filter-select viz-groupby-select" id="viz-groupby-select" title="Group by">
                  <option value="tag">Group by Tag</option>
                  <option value="doctype">Group by Document Type</option>
                  <option value="country">Group by Country</option>
                </select>
              </div>
              <div class="viz-controls-right">
                <div class="viz-mode-tabs">
                  <button class="viz-mode-tab active" data-mode="all">All&nbsp;(${stats.total})</button>
                  <button class="viz-mode-tab" data-mode="selected">Selected&nbsp;(${stats.selected})</button>
                  <button class="viz-mode-tab" data-mode="corpus">Corpus&nbsp;(${stats.corpus})</button>
                </div>
                <button class="viz-legend-toggle" id="viz-none-toggle">Hide None</button>
                <button class="viz-legend-toggle" id="viz-legend-toggle">Hide Legend</button>
                <button class="viz-legend-toggle viz-export-btn" id="viz-export-btn" title="Export current chart as PNG">${SLRIcons.download}&nbsp;Export&nbsp;PNG</button>
              </div>
            </div>
          </div>
          <h3 id="viz-chart-title" class="viz-chart-heading">Tag Distribution</h3>
          <div id="viz-chart" class="viz-bars"></div>
        </div>

      </div>`;

    // State
      let currentMode    = 'all';
      let currentChart   = 'doughnut';
      let currentGroupBy = 'tag';
      let showLegend     = true;
      let showNone       = true;

    // Lets a chart's height be dragged instead of being locked to a fixed or
    // viewport-derived value (the old source of portrait being towering and
    // landscape being squashed). Shared by every resizable chart (bars,
    // doughnut, year) — each just passes its own handle/area ids and
    // localStorage key so their heights persist independently.
    const wireChartResize = (el, { handleId, areaId, storageKey }) => {
      const handle = el.querySelector('#' + handleId);
      const area   = el.querySelector('#' + areaId);
      if (!handle || !area) return;
      let dragging = false, startY = 0, startH = 0;
      handle.addEventListener('pointerdown', ev => {
        dragging = true;
        startY = ev.clientY;
        startH = area.getBoundingClientRect().height;
        handle.classList.add('is-dragging');
        try { handle.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
      });
      handle.addEventListener('pointermove', ev => {
        if (!dragging) return;
        const newH = Math.max(CHART_HEIGHT_MIN, Math.min(CHART_HEIGHT_MAX, startH + (ev.clientY - startY)));
        area.style.height = newH + 'px';
      });
      const endDrag = ev => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('is-dragging');
        localStorage.setItem(storageKey, String(Math.round(area.getBoundingClientRect().height)));
        if (ev && handle.releasePointerCapture && ev.pointerId != null) {
          try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        }
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    };

    // Bars chart: dragging controls each row's track thickness (a CSS
    // custom property), not a container height to clip within — read the
    // starting value from storage instead of measuring the container's own
    // rendered height (which no longer equals the dragged quantity at all).
    // A damping factor keeps the small 14-44px range from swinging end to
    // end within the first few pixels of an actual mouse drag.
    const wireBarsResize = (el) => {
      const handle = el.querySelector('#viz-bars-resize-handle');
      const area   = el.querySelector('#viz-bars-area');
      if (!handle || !area) return;
      let dragging = false, startY = 0, startVal = 0, currentVal = getBarTrackHeight();
      handle.addEventListener('pointerdown', ev => {
        dragging = true;
        startY = ev.clientY;
        startVal = currentVal;
        handle.classList.add('is-dragging');
        try { handle.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
      });
      handle.addEventListener('pointermove', ev => {
        if (!dragging) return;
        currentVal = Math.max(BAR_TRACK_MIN, Math.min(BAR_TRACK_MAX, startVal + (ev.clientY - startY) * 0.3));
        area.style.setProperty('--bar-track-h', currentVal + 'px');
      });
      const endDrag = ev => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('is-dragging');
        localStorage.setItem('slr-bars-row-height', String(Math.round(currentVal)));
        if (ev && handle.releasePointerCapture && ev.pointerId != null) {
          try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        }
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    };

    // PRISMA has no single graphic to scale/clip — it's a stack of boxes
    // and connectors — so dragging its handle means something different:
    // smaller progressively hides secondary detail (first the exclusion
    // connectors, then the per-source boxes), bigger brings it all back.
    // No CSS height/overflow involved, which is exactly what avoids the
    // clipping the other charts used to have before they could scale.
    const PRISMA_DETAIL_MIN = 160, PRISMA_DETAIL_MAX = 700;
    const PRISMA_HIDE_CONNECTORS_BELOW = 460;
    const PRISMA_HIDE_SOURCES_BELOW = 300;
    const getPrismaDetailLevel = () => {
      const saved = parseInt(localStorage.getItem('slr-prisma-chart-height'), 10);
      return (Number.isFinite(saved) && saved >= PRISMA_DETAIL_MIN && saved <= PRISMA_DETAIL_MAX) ? saved : PRISMA_DETAIL_MAX;
    };
    const applyPrismaDetailLevel = (wrap, level) => {
      wrap.classList.toggle('prisma-hide-connectors', level < PRISMA_HIDE_CONNECTORS_BELOW);
      wrap.classList.toggle('prisma-hide-sources', level < PRISMA_HIDE_SOURCES_BELOW);
    };
    const wirePrismaResize = (el) => {
      const handle = el.querySelector('#viz-prisma-resize-handle');
      const wrap   = el.querySelector('.prisma-wrap');
      if (!handle || !wrap) return;
      let dragging = false, startY = 0, startLevel = 0, currentLevel = getPrismaDetailLevel();
      applyPrismaDetailLevel(wrap, currentLevel);
      handle.addEventListener('pointerdown', ev => {
        dragging = true;
        startY = ev.clientY;
        startLevel = currentLevel;
        handle.classList.add('is-dragging');
        try { handle.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
      });
      handle.addEventListener('pointermove', ev => {
        if (!dragging) return;
        currentLevel = Math.max(PRISMA_DETAIL_MIN, Math.min(PRISMA_DETAIL_MAX, startLevel + (ev.clientY - startY)));
        applyPrismaDetailLevel(wrap, currentLevel);
      });
      const endDrag = ev => {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('is-dragging');
        localStorage.setItem('slr-prisma-chart-height', String(Math.round(currentLevel)));
        if (ev && handle.releasePointerCapture && ev.pointerId != null) {
          try { handle.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
        }
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    };

    const wireChartInteractivity = (el, chartType) => {
      if (chartType === 'doughnut') {
        const segs  = [...el.querySelectorAll('.viz-seg')];
        const items = [...el.querySelectorAll('.viz-legend-item[data-idx]')];
        const activate = (i) => {
          segs.forEach((s, j)  => s.classList.toggle('viz-seg-dim', j !== i));
          items.forEach((li, j) => li.classList.toggle('viz-legend-active', j === i));
        };
        const reset = () => {
          segs.forEach(s   => s.classList.remove('viz-seg-dim'));
          items.forEach(li => li.classList.remove('viz-legend-active'));
        };
        segs.forEach((s, i)  => { s.addEventListener('mouseenter', () => activate(i)); s.addEventListener('mouseleave', reset); });
        items.forEach((li, i) => { li.addEventListener('mouseenter', () => activate(i)); li.addEventListener('mouseleave', reset); });
        wireChartResize(el, { handleId: 'viz-doughnut-resize-handle', areaId: 'viz-doughnut-area', storageKey: 'slr-doughnut-chart-height' });
      }
      if (chartType === 'year') {
        const segs  = [...el.querySelectorAll('.viz-col-seg[data-tag-key]')];
        const items = [...el.querySelectorAll('.viz-year-legend-item[data-tag-key]')];
        const activate = (key) => {
          segs.forEach(s   => s.classList.toggle('viz-seg-dim', s.dataset.tagKey !== key));
          items.forEach(li => li.classList.toggle('viz-legend-active', li.dataset.tagKey === key));
        };
        const reset = () => {
          segs.forEach(s   => s.classList.remove('viz-seg-dim'));
          items.forEach(li => li.classList.remove('viz-legend-active'));
        };
        segs.forEach(s   => { s.addEventListener('mouseenter', () => activate(s.dataset.tagKey)); s.addEventListener('mouseleave', reset); });
        items.forEach(li => { li.addEventListener('mouseenter', () => activate(li.dataset.tagKey)); li.addEventListener('mouseleave', reset); });
        wireChartResize(el, { handleId: 'viz-year-resize-handle', areaId: 'viz-year-bars-area', storageKey: 'slr-year-chart-height' });
      }
      if (chartType === 'world') {
        const countries = [...el.querySelectorAll('.viz-world-country-has-data[data-country-key]')];
        const items = [...el.querySelectorAll('.viz-world-legend-item[data-country-key]')];
        let lockedKey = null;

        const setActive = (key) => {
          countries.forEach(c => {
            c.classList.toggle('viz-world-country-active', c.dataset.countryKey === key);
          });
          items.forEach(item => {
            const isActive = item.dataset.countryKey === key;
            item.classList.toggle('viz-seg-dim', !isActive);
            item.classList.toggle('viz-legend-active', isActive);
          });
        };

        const reset = () => {
          countries.forEach(c => c.classList.remove('viz-world-country-active'));
          items.forEach(item => {
            item.classList.remove('viz-seg-dim');
            item.classList.remove('viz-legend-active');
          });
        };

        const activate = (key) => {
          if (!key) return;
          setActive(key);
        };

        const deactivate = () => {
          if (lockedKey) {
            setActive(lockedKey);
            return;
          }
          reset();
        };

        const toggleLock = (key) => {
          if (!key) return;
          lockedKey = lockedKey === key ? null : key;
          if (lockedKey) {
            setActive(lockedKey);
          } else {
            reset();
          }
        };

        const bindInteractive = (node) => {
          const key = node.dataset.countryKey;
          node.addEventListener('mouseenter', () => activate(key));
          node.addEventListener('mouseleave', deactivate);
          node.addEventListener('focus', () => activate(key));
          node.addEventListener('blur', deactivate);
          node.addEventListener('click', () => toggleLock(key));
          node.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              toggleLock(key);
            }
          });
        };

        countries.forEach(bindInteractive);
        items.forEach(bindInteractive);

        const stage = el.querySelector('.viz-world-stage');
        if (stage && window.SLRWorldMap && typeof SLRWorldMap.wireZoomPan === 'function') {
          SLRWorldMap.wireZoomPan(stage);
        }
      }
      if (chartType === 'bars') {
        const rows = [...el.querySelectorAll('.viz-bar-row')];
        const activate = (i) => rows.forEach((r, j) => r.classList.toggle('viz-row-dim', j !== i));
        const reset = () => rows.forEach(r => r.classList.remove('viz-row-dim'));
        rows.forEach((r, i) => { r.addEventListener('mouseenter', () => activate(i)); r.addEventListener('mouseleave', reset); });
        wireBarsResize(el);
      }
      if (chartType === 'prisma') {
        wirePrismaResize(el);
        const overlay = document.getElementById('modal-overlay');
        const history = projectData.searchLog || [];

        const rowsOrEmpty = (rows, emptyMsg) => rows.length
          ? rows.join('')
          : `<p style="color:var(--text-faint);padding:8px 0">${esc(emptyMsg)}</p>`;

        const openArticleListModal = (title, subsetArticles) => {
          if (!overlay) return;
          const rows = subsetArticles.map(a => {
            const hex  = tagColor(projectData, a.color);
            const year = a.yearNum || '';
            return `<div class="history-result-item">
              <div class="history-result-dot" ${hex ? `style="background:${esc(hex)}"` : ''}></div>
              <div class="history-result-title">${esc(a.title)}</div>
              <div class="history-result-year">${esc(String(year))}</div>
            </div>`;
          });
          renderPrismaDetailModal(overlay, {
            title,
            subtitle: `${subsetArticles.length.toLocaleString()} record${subsetArticles.length !== 1 ? 's' : ''}`,
            bodyHTML: rowsOrEmpty(rows, 'No records in this group.'),
          });
        };

        const openQueryListModal = (title, runs) => {
          if (!overlay) return;
          const rows = runs.map(run => {
            const viewKey = (run.view || 'scopus').toLowerCase();
            const dbLabel = DB_LABELS[viewKey] || run.view || 'Scopus';
            const count   = run.count || (run.results ? run.results.length : 0);
            const preview = (run.query || '').replace(/\s+/g, ' ').slice(0, 140);
            return `<div class="prisma-modal-row">
              <div class="prisma-modal-row-title">${esc(dbLabel)} · ${count.toLocaleString()} record${count !== 1 ? 's' : ''}</div>
              <div class="prisma-modal-row-meta">${esc(run.timestamp || '')} — ${esc(preview)}${run.query && run.query.length > 140 ? '…' : ''}</div>
            </div>`;
          });
          renderPrismaDetailModal(overlay, {
            title,
            subtitle: `${runs.length.toLocaleString()} search quer${runs.length !== 1 ? 'ies' : 'y'}`,
            bodyHTML: rowsOrEmpty(rows, 'No queries in this group.'),
          });
        };

        const openDuplicatesModal = () => {
          if (!overlay) return;
          const dups = computeDuplicates(history);
          const rows = dups.map(d => {
            const viewKey = (d.view || 'scopus').toLowerCase();
            const dbLabel = DB_LABELS[viewKey] || d.view || 'Scopus';
            return `<div class="prisma-modal-row">
              <div class="prisma-modal-row-title">${esc(d.title || 'Untitled')}</div>
              <div class="prisma-modal-row-meta">Duplicate found in ${esc(dbLabel)} · ${esc(d.timestamp || '')}</div>
            </div>`;
          });
          renderPrismaDetailModal(overlay, {
            title: 'Removed Duplicates',
            subtitle: `${dups.length.toLocaleString()} record${dups.length !== 1 ? 's' : ''} removed as duplicates`,
            bodyHTML: rowsOrEmpty(rows, 'No duplicates found.'),
          });
        };

        el.querySelectorAll('[data-prisma-stage]').forEach(box => {
          const activate = () => {
            const stage = box.dataset.prismaStage;
            if (stage === 'identification') openQueryListModal('Identification — All Searches', history);
            else if (stage === 'screening') SLRApp.navigate('articles');
            else if (stage === 'eligibility') SLRApp.navigate('selected');
            else if (stage === 'included') SLRApp.navigate('corpus');
          };
          box.addEventListener('click', activate);
          box.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); }
          });
        });

        el.querySelectorAll('[data-prisma-excl]').forEach(conn => {
          const activate = () => {
            const excl = conn.dataset.prismaExcl;
            if (excl === 'duplicates') openDuplicatesModal();
            else if (excl === 'screening-excluded') openArticleListModal('Excluded in Screening', articles.filter(a => !a.selected));
            else if (excl === 'eligibility-excluded') openArticleListModal('Excluded after Eligibility', articles.filter(a => a.selected && !a.corpus));
          };
          conn.addEventListener('click', activate);
          conn.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); }
          });
        });

        el.querySelectorAll('.prisma-source-chip[data-source-key]').forEach(chip => {
          const activate = () => {
            const key = chip.dataset.sourceKey;
            const runs = history.filter(run => (DB_SOURCE_KEY[(run.view || 'scopus').toLowerCase()] || 'scopus') === key);
            openQueryListModal(`Identification — ${DB_LABELS[key] || key}`, runs);
          };
          chip.addEventListener('click', ev => { ev.stopPropagation(); activate(); });
          chip.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); activate(); }
          });
        });
      }
    };

    const CHART_TITLES = {
      bars:    'Tag Distribution',
      doughnut:'Tag Distribution',
      year:    'Year Distribution',
      world:   'World Map',
      prisma:  'PRISMA 2020',
    };

    const updateChart = () => {
      const el          = container.querySelector('#viz-chart');
      const titleEl     = container.querySelector('#viz-chart-title');
        const modeTabs    = container.querySelector('.viz-mode-tabs');
        const legendBtn   = container.querySelector('#viz-legend-toggle');
        const noneBtn     = container.querySelector('#viz-none-toggle');
        const groupBySel  = container.querySelector('#viz-groupby-select');
      const legendSupported  = currentChart === 'doughnut' || currentChart === 'year' || currentChart === 'world';
      const noneSupported    = currentChart === 'doughnut' || currentChart === 'year' || currentChart === 'bars';
      const groupBySupported = currentChart === 'doughnut' || currentChart === 'year' || currentChart === 'bars';
      // Update heading to reflect active chart
      if (titleEl) titleEl.textContent = CHART_TITLES[currentChart] || 'Visualisations';
      // Mode tabs are always visible; dim them when irrelevant (PRISMA doesn't use mode)
      if (modeTabs) modeTabs.style.opacity = currentChart === 'prisma' ? '0.35' : '';
      if (modeTabs) modeTabs.style.pointerEvents = currentChart === 'prisma' ? 'none' : '';
        if (legendBtn) {
          legendBtn.textContent = showLegend ? 'Hide Legend' : 'Show Legend';
          legendBtn.classList.toggle('is-active', !showLegend);
          legendBtn.disabled = !legendSupported;
          legendBtn.style.opacity = legendSupported ? '1' : '0.45';
        }
        if (noneBtn) {
          noneBtn.textContent = showNone ? 'Hide None' : 'Show None';
          noneBtn.classList.toggle('is-active', !showNone);
          noneBtn.disabled = !noneSupported;
          noneBtn.style.opacity = noneSupported ? '1' : '0.45';
        }
        if (groupBySel) {
          groupBySel.disabled = !groupBySupported;
          groupBySel.style.opacity = groupBySupported ? '1' : '0.45';
          groupBySel.title = groupBySupported ? 'Group by' : 'Not applicable to this chart';
        }
      el.className = currentChart === 'bars' ? 'viz-bars' : currentChart === 'world' ? 'viz-world' : '';
        el.innerHTML = currentChart === 'doughnut'
          ? renderDoughnut(currentMode, currentGroupBy, showLegend, showNone)
        : currentChart === 'year'
            ? renderYearBars(currentMode, currentGroupBy, showLegend, showNone)
          : currentChart === 'world'
            ? SLRWorldMap.renderWorldMap(getSubset(currentMode), showLegend)
          : currentChart === 'prisma'
            ? renderPrisma()
            : renderBars(currentMode, currentGroupBy, showNone);
      wireChartInteractivity(el, currentChart);
      if (currentChart === 'year') {
        const chartWrap = el.querySelector('.viz-col-chart-wrap');
        if (chartWrap) chartWrap.scrollLeft = chartWrap.scrollWidth;
      }
    };
    updateChart();

    container.querySelector('#viz-chart-select')?.addEventListener('change', e => {
      currentChart = e.target.value;
      updateChart();
    });

    container.querySelector('#viz-groupby-select')?.addEventListener('change', e => {
      currentGroupBy = e.target.value;
      updateChart();
    });

    container.querySelector('#viz-legend-toggle')?.addEventListener('click', () => {
      if (currentChart !== 'doughnut' && currentChart !== 'year' && currentChart !== 'world') return;
      showLegend = !showLegend;
      updateChart();
    });

    container.querySelector('#viz-none-toggle')?.addEventListener('click', () => {
      if (currentChart === 'prisma') return;
      showNone = !showNone;
      updateChart();
    });

    container.querySelector('#viz-export-btn')?.addEventListener('click', async () => {
      const el  = container.querySelector('#viz-chart');
      if (!el) return;
      const btn = container.querySelector('#viz-export-btn');
      if (btn) btn.disabled = true;
      try {
        await exportVizAsPNG(el, CHART_TITLES[currentChart] || 'visualisation', currentChart);
      } catch (err) {
        if (typeof SLRApp !== 'undefined' && SLRApp.showToast) {
          SLRApp.showToast('Export failed: ' + (err.message || String(err)), true);
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    container.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentMode = btn.dataset.mode;
        container.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
        updateChart();
      });
    });
  }

  //  Databases view 

  const DB_GROUPS = [
    {
      heading: 'Integrated \u2014 search directly in this app',
      note: 'These databases can be queried from the Search view. Results are saved to your project automatically.',
      items: [
        { label: 'Scopus',           abbr: 'Sc', color: '#E47025', url: 'https://www.scopus.com',               desc: 'Elsevier citation and abstract index (API key required)', integrated: true },
        { label: 'PubMed',           abbr: 'PM', color: '#326599', url: 'https://pubmed.ncbi.nlm.nih.gov',      desc: 'MEDLINE biomedical literature database',                   integrated: true },
        { label: 'OpenAlex',         abbr: 'OA', color: '#3ab09e', url: 'https://openalex.org',                 desc: 'Open index of scholarly works',                            integrated: true },
      ],
    },
    {
      heading: 'Not available \u2014 API restrictions',
      note: 'These databases were tested but cannot be used from a browser due to CORS restrictions or API errors. Use them externally via their websites.',
      items: [
        { label: 'arXiv',            abbr: 'aX', color: '#B31B1B', url: 'https://arxiv.org',                    desc: 'Open-access preprint server' },
        { label: 'Semantic Scholar', abbr: 'SS', color: '#1857A4', url: 'https://www.semanticscholar.org',      desc: 'AI-assisted academic search engine' },
      ],
    },
    {
      heading: 'Major citation indexes',
      note: 'Subscription-based or access-restricted databases \u2014 open externally.',
      items: [
        { label: 'Web of Science',   abbr: 'WS', color: '#1C5FAD', url: 'https://www.webofscience.com',         desc: 'Clarivate multidisciplinary citation index' },
        { label: 'Google Scholar',   abbr: 'GS', color: '#4285F4', url: 'https://scholar.google.com',           desc: 'Free scholarly search across sources' },
        { label: 'JSTOR',            abbr: 'JS', color: '#9B2020', url: 'https://www.jstor.org',                desc: 'Journal and primary-source archive' },
        { label: 'ProQuest',         abbr: 'PQ', color: '#4E2587', url: 'https://www.proquest.com',             desc: 'Databases for dissertations and news' },
      ],
    },
    {
      heading: 'Discovery & AI tools',
      note: 'Literature discovery, citation mapping, and AI-assisted research tools.',
      items: [
        { label: 'Elicit',           abbr: 'El', color: '#7C4DFF', url: 'https://elicit.com',                   desc: 'AI assistant for research workflows' },
        { label: 'Litmaps',          abbr: 'Lm', color: '#00897B', url: 'https://www.litmaps.com',              desc: 'Citation-network visualisation tool' },
        { label: 'Connected Papers', abbr: 'CP', color: '#2D7DD2', url: 'https://www.connectedpapers.com',      desc: 'Graph view of related papers' },
      ],
    },
    {
      heading: 'Research community & identifiers',
      note: 'Researcher profiles, paper sharing, and persistent identifiers.',
      items: [
        { label: 'ResearchGate',     abbr: 'RG', color: '#00CCBB', url: 'https://www.researchgate.net',         desc: 'Research network and profile platform' },
        { label: 'Academia.edu',     abbr: 'Ac', color: '#41A85F', url: 'https://www.academia.edu',             desc: 'Academic paper sharing community' },
        { label: 'ORCID',            abbr: 'OR', color: '#A6CE39', url: 'https://orcid.org',                    desc: 'Persistent researcher identifier registry' },
      ],
    },
  ];

  function renderDatabases(container) {
    const renderDbLogo = (db) => `<span class="db-card-badge-fallback">${esc(db.abbr)}</span>`;

    function makeCard(db) {
      return `
      <a class="db-card${db.integrated ? ' db-card--integrated' : ''}" href="${esc(db.url)}" target="_blank" rel="noopener"
         style="--db-color:${esc(db.color)}">
        <div class="db-card-badge" title="${esc(db.label)}" aria-label="${esc(db.label)}">${renderDbLogo(db)}</div>
        <div class="db-card-body">
          <div class="db-card-name">${esc(db.label)}${db.integrated ? ' <span class="db-integrated-pill">In-app</span>' : ''}</div>
          <div class="db-card-desc">${esc(db.desc)}</div>
        </div>
        <div class="db-card-arrow">${SLRIcons.externalLink}</div>
      </a>`;
    }

    const groupSections = DB_GROUPS.map(g => `
      <div class="databases-section">
        <h3 class="databases-section-heading">${esc(g.heading)}</h3>
        ${g.note ? `<p class="databases-section-note">${esc(g.note)}</p>` : ''}
        <div class="databases-grid">${g.items.map(makeCard).join('')}</div>
      </div>`).join('');

    container.innerHTML = `
      <div class="databases-view">

        ${groupSections}

        <div class="databases-section">
          <h3 class="databases-section-heading">Reference Managers</h3>
          <p class="databases-section-note">Use your preferred reference manager to import the final corpus and manage citations for your research paper.</p>
          <div class="databases-grid">
            <button class="db-card" id="db-zotero-btn" style="--db-color:#CC2936">
              <div class="db-card-badge" title="Zotero" aria-label="Zotero">${renderDbLogo({ label: 'Zotero', abbr: 'Zo' })}</div>
              <div class="db-card-body">
                <div class="db-card-name">Zotero</div>
                <div class="db-card-desc">Open Zotero desktop app</div>
              </div>
              <div class="db-card-arrow">${SLRIcons.externalLink}</div>
            </button>
            <button class="db-card" id="db-citavi-btn" style="--db-color:#005A9E">
              <div class="db-card-badge" title="Citavi" aria-label="Citavi">${renderDbLogo({ label: 'Citavi', abbr: 'Ci' })}</div>
              <div class="db-card-body">
                <div class="db-card-name">Citavi</div>
                <div class="db-card-desc">Open Citavi desktop app</div>
              </div>
              <div class="db-card-arrow">${SLRIcons.externalLink}</div>
            </button>
          </div>
        </div>
      </div>`;

    container.querySelector('#db-zotero-btn').addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = 'zotero://select/library';
      document.body.appendChild(frame);
      setTimeout(() => document.body.removeChild(frame), 2000);
    });
    container.querySelector('#db-citavi-btn').addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = 'citavi://';
      document.body.appendChild(frame);
      setTimeout(() => document.body.removeChild(frame), 2000);
    });
  }


  //  Search view 

  // Field codes for Scopus query syntax
  //  Field codes per database 
  // mode: 'wrap'    inserts CODE() with cursor inside parens  (Scopus functions)
  // mode: 'append'  inserts CODE after cursor (PubMed field tags, e.g. term[TIAB])
  // mode: 'insert'  inserts CODE + space at cursor (operators, wildcards, OA filters)
  const FIELD_CODES_BY_DB = {

    //  Scopus 
    scopus: [
      { group: 'Operators', mode: 'insert', fields: [
        { code: 'AND',   desc: 'Boolean AND  both terms required' },
        { code: 'OR',    desc: 'Boolean OR  either term' },
        { code: 'NOT',   desc: 'Boolean NOT  exclude term' },
        { code: '(',     desc: 'Open grouping parenthesis' },
        { code: ')',     desc: 'Close grouping parenthesis' },
        { code: 'W/n',   desc: 'Within n words (e.g. W/3)' },
        { code: 'PRE/n', desc: 'Precedes by n words (e.g. PRE/3)' },
      ]},
      { group: 'Wildcards', mode: 'insert', fields: [
        { code: '*',  desc: 'Zero or more characters (e.g. comput*)' },
        { code: '?',  desc: 'Exactly one character (e.g. wom?n)' },
        { code: '#',  desc: 'Zero or one character (e.g. colo#r)' },
        { code: '""', desc: 'Exact phrase (e.g. "machine learning")' },
        { code: '{}', desc: 'Exact string match' },
      ]},
      { group: 'Content', mode: 'wrap', fields: [
        { code: 'TITLE-ABS-KEY',      desc: 'Title, abstract & keywords (most common)' },
        { code: 'TITLE-ABS-KEY-AUTH', desc: 'Title, abstract, keywords & author' },
        { code: 'TITLE-ABS',          desc: 'Title and abstract' },
        { code: 'TITLE',              desc: 'Article title' },
        { code: 'ABS',                desc: 'Abstract' },
        { code: 'KEY',                desc: 'Author keywords' },
        { code: 'AUTHKEY',            desc: 'Author-assigned keywords' },
        { code: 'INDEXTERMS',         desc: 'Index terms' },
        { code: 'ALL',                desc: 'All fields' },
      ]},
      { group: 'Author', mode: 'wrap', fields: [
        { code: 'AUTH',          desc: 'Author name' },
        { code: 'AUTHCOLLAB',    desc: 'Collaborative author' },
        { code: 'AUTHFIRST',     desc: 'First author' },
        { code: 'AUTHLASTNAME',  desc: 'Author last name' },
        { code: 'AUTHOR-NAME',   desc: 'Author full name' },
        { code: 'FIRSTAUTH',     desc: 'First author (alt)' },
        { code: 'AU-ID',         desc: 'Author Scopus ID' },
        { code: 'ORCID',         desc: 'Author ORCID' },
        { code: 'EDITOR',        desc: 'Editor name' },
        { code: 'EDFIRST',       desc: 'First editor' },
        { code: 'EDLASTNAME',    desc: 'Editor last name' },
      ]},
      { group: 'Affiliation', mode: 'wrap', fields: [
        { code: 'AFFIL',         desc: 'Affiliation name' },
        { code: 'AFFILCITY',     desc: 'Affiliation city' },
        { code: 'AFFILCOUNTRY',  desc: 'Affiliation country' },
        { code: 'AF-ID',         desc: 'Affiliation Scopus ID' },
        { code: 'AFFILORG',      desc: 'Affiliation organization' },
      ]},
      { group: 'Source', mode: 'wrap', fields: [
        { code: 'SRCTITLE',      desc: 'Journal / source title' },
        { code: 'EXACTSRCTITLE', desc: 'Exact source title match' },
        { code: 'ISSN',          desc: 'ISSN (print)' },
        { code: 'ISSNP',         desc: 'ISSN (print, alt)' },
        { code: 'EISSN',         desc: 'ISSN (electronic)' },
        { code: 'ISBN',          desc: 'ISBN' },
        { code: 'SRCTYPE',       desc: 'Source type (j, b, p, ...)' },
        { code: 'SRCID',         desc: 'Source Scopus ID' },
        { code: 'PUBYEAR',       desc: 'Publication year' },
        { code: 'PUBDATETXT',    desc: 'Publication date text' },
        { code: 'VOLUME',        desc: 'Volume' },
        { code: 'ISSUE',         desc: 'Issue' },
        { code: 'CODEN',         desc: 'CODEN' },
        { code: 'BOOKPUB',       desc: 'Book publisher' },
        { code: 'WEBSITE',       desc: 'Website' },
        { code: 'PMID',          desc: 'PubMed ID' },
      ]},
      { group: 'Document', mode: 'wrap', fields: [
        { code: 'DOCTYPE',       desc: 'Document type (ar, re, ch, ...)' },
        { code: 'DOI',           desc: 'DOI' },
        { code: 'EID',           desc: 'Scopus EID' },
        { code: 'ARTNUM',        desc: 'Article number' },
        { code: 'PAGEFIRST',     desc: 'First page' },
        { code: 'PAGELAST',      desc: 'Last page' },
        { code: 'PAGES',         desc: 'Page range' },
        { code: 'LANGUAGE',      desc: 'Language' },
        { code: 'OA',            desc: 'Open access (all, gold, ...)' },
        { code: 'INDEX',         desc: 'Indexed in (Medline, ...)' },
        { code: 'LOAD-DATE',     desc: 'Load date (Scopus)' },
      ]},
      { group: 'Funding', mode: 'wrap', fields: [
        { code: 'FUND-ALL',      desc: 'Any funding field' },
        { code: 'FUND-SPONSOR',  desc: 'Funding sponsor name' },
        { code: 'FUND-NO',       desc: 'Funding grant number' },
        { code: 'FUND-ACR',      desc: 'Funding acronym' },
      ]},
      { group: 'Conference', mode: 'wrap', fields: [
        { code: 'CONF',          desc: 'Conference name or location' },
        { code: 'CONFNAME',      desc: 'Conference name' },
        { code: 'CONFLOC',       desc: 'Conference location' },
        { code: 'CONFSPONSORS',  desc: 'Conference sponsors' },
      ]},
      { group: 'Chemical', mode: 'wrap', fields: [
        { code: 'CHEM',          desc: 'Chemical name' },
        { code: 'CHEMNAME',      desc: 'Chemical substance name' },
        { code: 'CASREGNUMBER',  desc: 'CAS registry number' },
        { code: 'MANUFACTURER',  desc: 'Manufacturer' },
        { code: 'TRADENAME',     desc: 'Trade name' },
        { code: 'SEQBANK',       desc: 'Sequence bank' },
        { code: 'SEQNUMBER',     desc: 'Sequence number' },
      ]},
      { group: 'References', mode: 'wrap', fields: [
        { code: 'REF',           desc: 'Reference (title, author, ...)' },
        { code: 'REFTITLE',      desc: 'Referenced article title' },
        { code: 'REFAUTH',       desc: 'Referenced author' },
        { code: 'REFSRCTITLE',   desc: 'Referenced source title' },
        { code: 'REFPUBYEAR',    desc: 'Referenced publication year' },
        { code: 'REFPAGE',       desc: 'Referenced page' },
        { code: 'REFPAGEFIRST',  desc: 'Referenced first page' },
        { code: 'REFARTNUM',     desc: 'Referenced article number' },
      ]},
      { group: 'Subject Area', mode: 'wrap', fields: [
        { code: 'SUBJAREA',  desc: 'Subject area code' },
        { code: 'MULT',      desc: 'Multidisciplinary' },
        { code: 'MEDI',      desc: 'Medicine' },
        { code: 'NURS',      desc: 'Nursing' },
        { code: 'DENT',      desc: 'Dentistry' },
        { code: 'VETE',      desc: 'Veterinary' },
        { code: 'HEAL',      desc: 'Health professions' },
        { code: 'BIOC',      desc: 'Biochemistry' },
        { code: 'IMMU',      desc: 'Immunology' },
        { code: 'NEUR',      desc: 'Neuroscience' },
        { code: 'PHAR',      desc: 'Pharmacology' },
        { code: 'AGRI',      desc: 'Agricultural & biological sciences' },
        { code: 'COMP',      desc: 'Computer science' },
        { code: 'ENGI',      desc: 'Engineering' },
        { code: 'CENG',      desc: 'Chemical engineering' },
        { code: 'ENVI',      desc: 'Environmental science' },
        { code: 'EART',      desc: 'Earth & planetary sciences' },
        { code: 'ENER',      desc: 'Energy' },
        { code: 'MATE',      desc: 'Materials science' },
        { code: 'PHYS',      desc: 'Physics & astronomy' },
        { code: 'MATH',      desc: 'Mathematics' },
        { code: 'ARTS',      desc: 'Arts & humanities' },
        { code: 'SOCI',      desc: 'Social sciences' },
        { code: 'PSYC',      desc: 'Psychology' },
        { code: 'ECON',      desc: 'Economics & finance' },
        { code: 'BUSI',      desc: 'Business & management' },
        { code: 'DECI',      desc: 'Decision sciences' },
      ]},
      { group: 'Limits', mode: 'insert', fields: [
        { code: 'BEF',  desc: 'Before date (e.g. BEF 2020)' },
        { code: 'AFT',  desc: 'After date (e.g. AFT 2015)' },
        { code: 'IS',   desc: 'Exact match operator' },
      ]},
    ],

    //  PubMed 
    // Syntax: term[FIELD]  field tag appended after the search term
    pubmed: [
      { group: 'Operators', mode: 'insert', fields: [
        { code: 'AND',   desc: 'Boolean AND  both terms required' },
        { code: 'OR',    desc: 'Boolean OR  either term' },
        { code: 'NOT',   desc: 'Boolean NOT  exclude term' },
        { code: '(',     desc: 'Open grouping parenthesis' },
        { code: ')',     desc: 'Close grouping parenthesis' },
      ]},
      { group: 'Wildcards', mode: 'insert', fields: [
        { code: '*',  desc: 'Truncation  zero or more chars (min 3 chars before *, e.g. learn*)' },
        { code: '""', desc: 'Exact phrase (e.g. "machine learning")' },
      ]},
      { group: 'Content', mode: 'append', fields: [
        { code: '[TIAB]', desc: 'Title + Abstract  most common field tag' },
        { code: '[TI]',   desc: 'Title only' },
        { code: '[AB]',   desc: 'Abstract only' },
        { code: '[tw]',   desc: 'Text Word  all searchable words in record' },
        { code: '[all]',  desc: 'All fields  broadest search' },
      ]},
      { group: 'MeSH', mode: 'append', fields: [
        { code: '[MeSH]',  desc: 'MeSH controlled vocabulary term (exact match)' },
        { code: '[MAJR]',  desc: 'MeSH major topic  primary focus of article' },
        { code: '[SH]',    desc: 'MeSH subheading qualifier' },
      ]},
      { group: 'Keywords', mode: 'append', fields: [
        { code: '[kw]', desc: 'Author-supplied keywords' },
      ]},
      { group: 'Author', mode: 'append', fields: [
        { code: '[au]',     desc: 'Author name (surname initials, e.g. smith j[au])' },
        { code: '[1au]',    desc: 'First (senior) author' },
        { code: '[lastau]', desc: 'Last author' },
        { code: '[auid]',   desc: 'Author identifier (ORCID, etc.)' },
        { code: '[ir]',     desc: 'Investigator / collaborator name' },
      ]},
      { group: 'Affiliation', mode: 'append', fields: [
        { code: '[ad]', desc: 'Author affiliation / institution name' },
      ]},
      { group: 'Source', mode: 'append', fields: [
        { code: '[ta]',  desc: 'Journal title or NLM abbreviation' },
        { code: '[is]',  desc: 'ISSN  print or electronic' },
        { code: '[vi]',  desc: 'Volume number' },
        { code: '[ip]',  desc: 'Issue / part number' },
      ]},
      { group: 'Document', mode: 'append', fields: [
        { code: '[pt]',  desc: 'Publication type (e.g. review[pt], clinical trial[pt])' },
        { code: '[la]',  desc: 'Language (e.g. english[la], french[la])' },
        { code: '[sb]',  desc: 'Subset filter (e.g. medline[sb])' },
        { code: '[uid]', desc: 'PubMed ID (PMID)' },
      ]},
      { group: 'Date', mode: 'append', fields: [
        { code: '[dp]',   desc: 'Publication date  range: 2019:2024[dp]' },
        { code: '[PDAT]', desc: 'Print publication date (alternative to [dp])' },
        { code: '[edat]', desc: 'Entrez date  when record was added to database' },
      ]},
    ],

    //  OpenAlex 
    // Plain search: keyword query (search= param). Filter mode: use filter-style
    // syntax (comma-separated conditions) which the app auto-detects.
    openalex: [
      { group: 'Operators', mode: 'insert', fields: [
        { code: 'AND',  desc: 'Boolean AND  both terms required' },
        { code: 'OR',   desc: 'Boolean OR  either term' },
        { code: 'NOT',  desc: 'Boolean NOT  exclude term' },
        { code: '(',    desc: 'Group terms' },
        { code: ')',    desc: 'Close group' },
      ]},
      { group: 'Wildcards', mode: 'insert', fields: [
        { code: '""', desc: 'Exact phrase (e.g. "machine learning")' },
      ]},
      { group: 'Filters', mode: 'insert', fields: [
        { code: 'title.search:',                            desc: 'Title contains keyword  e.g. title.search:deep learning' },
        { code: 'abstract.search:',                         desc: 'Abstract contains keyword' },
        { code: 'publication_year:>',                       desc: 'Published after year  e.g. publication_year:>2019' },
        { code: 'publication_year:<',                       desc: 'Published before year' },
        { code: 'type:journal-article',                     desc: 'Journal articles only' },
        { code: 'type:book-chapter',                        desc: 'Book chapters only' },
        { code: 'open_access.is_oa:true',                   desc: 'Open access only' },
        { code: 'language:en',                              desc: 'English language only' },
        { code: 'primary_topic.field.display_name.search:', desc: 'Research field / topic' },
        { code: 'authorships.author.display_name.search:',  desc: 'Author name search' },
      ]},
    ],

  };

  // Database tab definitions  only working databases. color/abbr match
  // DB_GROUPS' "Integrated" entries (Databases view) exactly, so the
  // search-database selector reads as the same card design, just compact.
  const DB_TABS = [
    { key: 'scopus',    label: 'Scopus',    abbr: 'Sc', color: '#E47025', note: null },
    { key: 'pubmed',    label: 'PubMed',    abbr: 'PM', color: '#326599', note: 'Free  No key required' },
    { key: 'openalex',  label: 'OpenAlex',  abbr: 'OA', color: '#3ab09e', note: 'Free  No key required' },
  ];

  // Hints per database (shown below the query textarea)
  const DB_HINTS = {
    scopus:   'Use Scopus Boolean syntax: TITLE-ABS-KEY("machine learning") AND PUBYEAR > 2019',
    pubmed:   'Use PubMed query syntax, e.g.: machine learning[Title] AND 2019:2024[PDAT]',
    openalex: 'Keyword search across title, abstract & full text. Use filter syntax for precision: title.search:"deep learning",publication_year:>2019 (comma = AND).',
  };

  // Placeholders per database
  const DB_PLACEHOLDERS = {
    scopus:   'TITLE-ABS-KEY("machine learning") AND PUBYEAR > 2019',
    pubmed:   'machine learning[Title] AND 2019:2024[PDAT]',
    openalex: 'machine learning education systematic review',
  };

  function renderSearch(container, projectData, settings, search) {
    const db       = (search && search.db) || 'scopus';
    const query    = (search && search.query) || '';
    const maxRes   = (search && search.maxResults) || 500;
    const isSearch = !!(search && search.isSearching);
    const progress = (search && search.progress) || 0;
    const progMsg  = (search && search.progressMsg) || '';
    const errMsg   = (search && search.error) || '';
    const lastCnt  = search && search.lastCount != null ? search.lastCount : null;

    // Scopus requires API key
    const noKey = db === 'scopus' && !(settings && settings.apiKey);

    // Field-code panel  db-specific
    const fcCodes = FIELD_CODES_BY_DB[db] || FIELD_CODES_BY_DB.scopus;
    const fcPanelHTML = fcCodes.map(g => {
      const gMode = g.mode || 'wrap';
      return `
      <div class="fc-group">
        <div class="fc-group-header">${esc(g.group)}</div>
        <div class="fc-chips">
          ${g.fields.map(f => `<button class="fc-chip" data-fc="${esc(f.code)}" data-fc-mode="${esc(f.mode || gMode)}" title="${esc(f.desc)}">${esc(f.code)}</button>`).join('')}
        </div>
      </div>`;
    }).join('');

    // Past query terms  deduplicated, sorted alphabetically
    const pastTerms = (projectData && projectData.queryHistory && projectData.queryHistory.terms) || [];
    const sortedTerms = [...new Set(pastTerms)].sort((a, b) => a.localeCompare(b));
    const termsHTML = sortedTerms.length > 0
      ? sortedTerms.map(t =>
          `<div class="search-term-row">
             <button class="search-term-item" data-term="${esc(t)}" title="Use this term in the query editor">${esc(t)}</button>
             <button class="search-term-delete" data-delete-term="${esc(t)}" title="Delete this saved term" aria-label="Delete saved term">${SLRIcons.trash}</button>
           </div>`
        ).join('')
      : `<p class="search-terms-empty">Previous search terms from this project will appear here.</p>`;

    // DB tabs  styled like a compact .db-card (Databases view): colored
    // left border + abbreviation badge, same --db-color custom property.
    const tabsHTML = DB_TABS.map(t => `
      <button type="button" class="search-db-card${db === t.key ? ' active' : ''}" data-db="${esc(t.key)}"
              style="--db-color:${esc(t.color)}" title="${esc(t.label)}${t.note ? ' — ' + esc(t.note) : ''}">
        <span class="search-db-card-badge">${esc(t.abbr)}</span>
        <span class="search-db-card-name">${esc(t.label)}</span>
      </button>`
    ).join('');

    // Hint box
    const hint = DB_HINTS[db] || '';
    const hintHTML = hint
      ? `<div class="search-db-hint">${SLRIcons.info}<span>${esc(hint)}</span></div>`
      : '';

    // Scopus key warning
    const keyWarnHTML = (db === 'scopus' && noKey)
      ? `<div class="search-notice search-notice-warn">${SLRIcons.warning}
           <span>No Scopus API key configured.
           <button class="link-btn" id="search-go-settings">Open Settings</button> to add one.</span>
         </div>`
      : '';

    // Progress / status
    let statusHTML = '';
    if (isSearch) {
      statusHTML = `
        <div class="search-progress-wrap">
          <div class="search-progress-track"><div class="search-progress-bar" style="width:${progress}%"></div></div>
          <div class="search-progress-msg">${esc(progMsg)}</div>
        </div>`;
    } else if (errMsg) {
      statusHTML = `<div class="search-notice search-notice-error">${SLRIcons.warning}<span>${esc(errMsg)}</span></div>`;
    } else if (lastCnt !== null) {
      statusHTML = `<div class="search-notice search-notice-success">${SLRIcons.check}
        <span>Search complete  <strong>${lastCnt}</strong> result${lastCnt !== 1 ? 's' : ''} saved to project.</span></div>`;
    }

    const placeholder = DB_PLACEHOLDERS[db] || '';
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    if (search && !search.mobilePanelsInitialized) {
      search.mobilePanelsInitialized = true;
      search.showFieldCodes = !isMobile;
      search.showPastTerms = !isMobile;
    }

    const mobileTogglesHTML = isMobile
      ? `<div class="search-mobile-toggles">
          <button class="search-mobile-toggle${search.showFieldCodes ? ' active' : ''}" data-toggle-panel="field-codes">
            ${SLRIcons.filter}<span>Field Codes</span>
          </button>
          <button class="search-mobile-toggle${search.showPastTerms ? ' active' : ''}" data-toggle-panel="past-terms">
            ${SLRIcons.history}<span>Past Terms</span>
          </button>
        </div>`
      : '';

    container.innerHTML = `
      <div class="search-view${isMobile ? ' search-view-mobile' : ''}">

        <!-- Query editor — first in DOM (and, on mobile, visually first via
             CSS order too) so it — and everything above it, i.e. nothing —
             never moves when Field Codes/Past Terms expand below it. On
             desktop, CSS order puts field-codes back on the left and
             past-terms on the right, same 3-column layout as before. -->
        <div class="search-editor-panel">
          <div class="search-editor-toolbar">
            ${mobileTogglesHTML}
            <div class="search-db-tabs" id="search-db-tabs">${tabsHTML}</div>
          </div>

          ${hintHTML}
          ${keyWarnHTML}

          <textarea class="search-textarea" id="search-query" rows="8"
            placeholder="${esc(placeholder)}"
            ${isSearch ? 'disabled' : ''}>${esc(query)}</textarea>

          <div class="search-actions">
            ${isSearch
              ? `<button class="btn-primary" id="search-cancel-btn">Cancel</button>`
              : `<button class="btn-primary" id="search-run-btn" ${noKey ? 'disabled' : ''}>
                   ${SLRIcons.search} Search
                 </button>`
            }
            <div class="search-max-wrap">
              <label for="search-max">Max results:</label>
              <input class="form-input" id="search-max" type="number"
                min="1" max="10000" style="width:80px"
                value="${esc(String(maxRes))}"
                ${isSearch ? 'disabled' : ''}>
            </div>
          </div>

          ${statusHTML}
        </div>

        <!-- Field codes -->
        <div class="search-panel${isMobile && !search.showFieldCodes ? ' is-collapsed' : ''}" data-panel="field-codes">
          <div class="search-panel-header">
            ${SLRIcons.filter}
            <span class="search-panel-title">Field Codes</span>
          </div>
          <div class="search-panel-body">
            <div class="fc-list">${fcPanelHTML}</div>
          </div>
        </div>

        <!-- Past terms -->
        <div class="search-panel search-terms-panel${isMobile && !search.showPastTerms ? ' is-collapsed' : ''}" data-panel="past-terms">
          <div class="search-panel-header">
            ${SLRIcons.history}
            <span class="search-panel-title">Past Terms</span>
          </div>
          <div class="search-panel-body">
            <div class="search-terms-list">${termsHTML}</div>
          </div>
        </div>

      </div>`;

    // Wire: DB tabs
    container.querySelectorAll('.search-db-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const newDb = btn.dataset.db;
        if (SLRApp.state.search.db !== newDb) {
          SLRApp.state.search.db = newDb;
          renderSearch(container, SLRApp.state.projectData, SLRApp.state.settings, SLRApp.state.search);
        }
      });
    });

    container.querySelectorAll('[data-toggle-panel]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.togglePanel;
        if (target === 'field-codes') {
          SLRApp.state.search.showFieldCodes = !SLRApp.state.search.showFieldCodes;
        } else if (target === 'past-terms') {
          SLRApp.state.search.showPastTerms = !SLRApp.state.search.showPastTerms;
        }
        renderSearch(container, SLRApp.state.projectData, SLRApp.state.settings, SLRApp.state.search);
      });
    });

    // Wire: Field code chips  mode-aware insertion
    container.querySelectorAll('.fc-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const ta = container.querySelector('#search-query');
        if (!ta) return;
        const fc   = chip.dataset.fc;
        const mode = chip.dataset.fcMode || 'wrap';
        let ins, cur;
        if (mode === 'wrap') {
          ins = fc + '()'; cur = ins.length - 1;   // cursor inside parens
        } else if (mode === 'append') {
          ins = fc; cur = ins.length;               // tag appended after term
        } else {
          ins = fc + ' '; cur = ins.length;         // insert operator/filter
        }
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + cur;
        ta.focus();
      });
    });

    // Wire: past term clicks
    container.querySelectorAll('.search-term-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const ta = container.querySelector('#search-query');
        if (ta) { ta.value = btn.dataset.term; ta.focus(); }
      });
    });

    container.querySelectorAll('.search-term-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const term = btn.dataset.deleteTerm || '';
        if (!term) return;
        if (!window.confirm(`Delete saved term "${term}"?`)) return;
        void SLRApp.deleteQueryTerm(term);
      });
    });

    // Wire: settings link
    const goSettings = container.querySelector('#search-go-settings');
    if (goSettings) goSettings.addEventListener('click', () => SLRApp.navigate('settings'));

    // Wire: Run
    const runBtn = container.querySelector('#search-run-btn');
    if (runBtn) {
      runBtn.addEventListener('click', () => {
        const ta  = container.querySelector('#search-query');
        const max = container.querySelector('#search-max');
        const q   = ta ? ta.value.trim() : '';
        if (!q) return;
        SLRApp.executeSearch(q, max ? parseInt(max.value) || 500 : 500, SLRApp.state.search.db);
      });
    }

    // Wire: Cancel
    const cancelBtn = container.querySelector('#search-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => SLRApp.cancelSearch());
  }

  //  Settings view 

  function formatScopusTestResult(result) {
    if (!result || !result.hasKey) {
      return 'No Scopus API key configured. Enter one above and click Save first.';
    }
    const lines = [];
    if (result.std && result.std.ok) {
      lines.push(`<div>&#10003; API key is valid  STANDARD view works (key ${esc(result.keyPreview || '')}).</div>`);
      if (result.complete) {
        lines.push(result.complete.ok
          ? '<div>&#10003; COMPLETE view is authorized for this key.</div>'
          : `<div>&#10007; COMPLETE view is <strong>not</strong> authorized for this key (HTTP ${esc(String(result.complete.status))}${result.complete.detail ? `: ${esc(result.complete.detail)}` : ''}). Searches automatically fall back to STANDARD view, so this only limits full author lists/abstracts.</div>`);
      }
    } else {
      const status = result.std ? result.std.status : 0;
      const detail = result.std ? result.std.detail : '';
      lines.push(`<div>&#10007; API key rejected${status ? ` (HTTP ${esc(String(status))})` : ''}${detail ? `: ${esc(detail)}` : ''}.</div>`);
      lines.push('<div>Check the key in Settings, or generate/renew one at <a href="https://dev.elsevier.com/" target="_blank" rel="noopener">dev.elsevier.com</a>  keys can be revoked if unused or if the associated subscription lapsed.</div>');
    }
    return lines.join('');
  }

  // Supabase's own error messages, translated into what to actually do about
  // them. "Invalid login credentials" covers three different real causes —
  // wrong password, no account with this email yet, AND an account that
  // exists but was never confirmed — current Supabase versions deliberately
  // no longer distinguish the unconfirmed case in the message (to avoid
  // leaking account existence), so this can't pattern-match its way to a
  // more specific answer; all three possibilities have to be spelled out.
  // Shared by the Settings Cloud Sync form and the Welcome-screen modal.
  function describeAuthError(err, action) {
    const msg = err && err.message ? err.message : String(err);
    if (/invalid login credentials/i.test(msg) && action === 'signin') {
      return 'Invalid login credentials. This covers three different things: wrong '
        + 'password, no account with this email in this project yet (use Sign Up), '
        + 'or — very common — an account that was created but never confirmed. For '
        + 'the last one, click Sign Up again with the same email/password (Supabase '
        + 'resends the confirmation instead of erroring) or use "Resend confirmation '
        + 'email" below, then check Authentication → Users in your Supabase '
        + 'dashboard to see whether that account shows as confirmed.';
    }
    if (/email not confirmed/i.test(msg)) {
      return 'This account’s email hasn’t been confirmed yet — check your inbox for the confirmation link, or resend it below.';
    }
    return msg;
  }

  // Shown wherever the Supabase email/password fields themselves appear
  // (currently just the Home modal) — sign-in is the part that's currently
  // unreliable, not Cloud Sync as a whole.
  function renderSupabaseDevNotice() {
    return `
      <div class="scopus-api-notice scopus-api-notice-caution" style="margin-bottom:14px">
        <span class="scopus-api-notice-icon">${SLRIcons.warning}</span>
        <div><strong>Cloud Sync sign-in is still being implemented</strong> and currently
          doesn't work reliably, or only works partially. <strong>Local Folder</strong> is
          the dependable option for now.</div>
      </div>`;
  }

  // Deliberately minimal: Project URL/key/Save Connection/the full auth form
  // used to live here too, for pointing Cloud Sync at a different Supabase
  // project (self-hosting). That's a repo-fork-and-edit-the-constant
  // scenario now (see DEFAULT_URL/DEFAULT_KEY in data-supabase.js), not a
  // Settings-UI one — this section is what an ordinary user actually needs:
  // which backend is active, and sign-out once signed in.
  function renderCloudSyncSection() {
    const backend = SLRData.getBackend();
    const cloudUser = SLRDataCloud.currentUser();

    return `
      <div class="settings-section">
        <h3>Cloud Sync (Supabase)</h3>
        <p class="field-hint" style="margin-top:2px">
          Sign Up/Log In from the Home screen to sync your projects through the
          cloud instead of a local folder — works on any browser or device,
          including mobile, where the File System Access API isn't available.
        </p>

        <div class="form-field" style="margin-top:14px">
          <label>Active workspace</label>
          <div class="backend-switch-row">
            <label class="backend-switch-option">
              <input type="radio" name="backend-switch" value="local" ${backend === 'local' ? 'checked' : ''}>
              Local Folder
            </label>
            <label class="backend-switch-option">
              <input type="radio" name="backend-switch" value="cloud" ${backend === 'cloud' ? 'checked' : ''}>
              Cloud Sync
            </label>
          </div>
          <p class="field-hint">Local Folder reads/writes a folder on this device via the
            File System Access API. Cloud Sync stores the same data in Supabase instead,
            under your account, so it follows you across browsers and devices.</p>
        </div>

        ${cloudUser ? `
          <div class="cloud-auth-status">
            ${SLRIcons.check}
            <span>Signed in as <strong>${esc(cloudUser.email)}</strong></span>
            <button class="btn-secondary" id="settings-supabase-signout-btn">Sign Out</button>
          </div>
        ` : `
          ${renderSupabaseDevNotice()}
        `}
      </div>`;
  }

  function wireCloudSyncSection(container) {
    container.querySelectorAll('input[name="backend-switch"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) SLRApp.switchBackend(radio.value);
      });
    });

    const signOutBtn = container.querySelector('#settings-supabase-signout-btn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', () => SLRApp.cloudSignOut());
    }
  }

  function renderSettings(container, { apiKey, instToken, openAlexKey, openAlexEmail, autoFetchEnabled, fetchMode, autoTagEnabled, autoRunScope, autoTagCategories, allTagCategories, folderName }) {
    const categories = Array.isArray(allTagCategories) ? allTagCategories : [];
    const enabledCategorySet = new Set(Array.isArray(autoTagCategories) && autoTagCategories.length ? autoTagCategories : categories);
    container.innerHTML = `
      <div class="settings-view">
        <p class="settings-subtitle">Configure your API credentials and workspace.
          <button type="button" class="link-btn" id="settings-privacy-link">See what's stored and why (Privacy &amp; Cookies)</button>
        </p>

        <div class="settings-section">
          <h3>Scopus API</h3>

          <div class="scopus-api-notice">
              <span class="scopus-api-notice-icon">${SLRIcons.info}</span>
            <div>
              The <strong>Scopus Search API</strong> requires an institutional API key.
              Free API keys for academic institutions are available at
              <a href="https://dev.elsevier.com/" target="_blank" rel="noopener">dev.elsevier.com</a>.
              Your key is stored only in your browser's <code>localStorage</code>  never sent to any server.
            </div>
          </div>

          <div class="form-field" style="margin-top:14px">
            <label for="settings-apikey">API Key</label>
            <div class="secret-input-row">
              <input class="form-input monospace" id="settings-apikey" type="password"
                placeholder="Enter your Scopus API key"
                value="${esc(apiKey || '')}">
              <button class="btn-secondary secret-toggle-btn" type="button" data-target="settings-apikey" aria-label="Show API key" aria-pressed="false">
                <span class="secret-toggle-icon">${SLRIcons.eye}</span>
                <span class="secret-toggle-label">Show</span>
              </button>
            </div>
            <p class="field-hint">Required for Scopus searches. Leave blank to use PubMed / OpenAlex only.</p>
          </div>

          <div class="form-field">
            <label for="settings-insttoken">Institutional Token (optional)</label>
            <div class="secret-input-row">
              <input class="form-input monospace" id="settings-insttoken" type="password"
                placeholder="X-ELS-Insttoken  only required on some networks"
                value="${esc(instToken || '')}">
              <button class="btn-secondary secret-toggle-btn" type="button" data-target="settings-insttoken" aria-label="Show institutional token" aria-pressed="false">
                <span class="secret-toggle-icon">${SLRIcons.eye}</span>
                <span class="secret-toggle-label">Show</span>
              </button>
            </div>
            <p class="field-hint">Needed only when accessing Scopus from outside your institution's IP range.</p>
          </div>

          <div class="settings-save-row">
            <button class="btn-primary" id="settings-save-btn">Save Scopus Settings</button>
            <span class="settings-saved-msg" id="settings-saved-msg">Saved!</span>
            <button class="btn-secondary" type="button" id="settings-scopus-test-btn">Test API Key</button>
          </div>
          <div id="settings-scopus-test-result" class="scopus-test-result" hidden></div>
        </div>

          <div class="settings-section">
          <h3>OpenAlex</h3>

          <div class="scopus-api-notice">
            <span class="scopus-api-notice-icon">${SLRIcons.info}</span>
            <div>
            OpenAlex currently rate-limits anonymous search under heavy load. Adding a free API key or contact email moves requests out of the anonymous path when available.
            </div>
          </div>

          <div class="form-field" style="margin-top:14px">
            <label for="settings-openalex-key">API Key (optional)</label>
            <div class="secret-input-row">
            <input class="form-input monospace" id="settings-openalex-key" type="password"
              placeholder="Enter your OpenAlex API key"
              value="${esc(openAlexKey || '')}">
            <button class="btn-secondary secret-toggle-btn" type="button" data-target="settings-openalex-key" aria-label="Show OpenAlex API key" aria-pressed="false">
              <span class="secret-toggle-icon">${SLRIcons.eye}</span>
              <span class="secret-toggle-label">Show</span>
            </button>
            </div>
          </div>

          <div class="form-field">
            <label for="settings-openalex-email">Contact Email (optional)</label>
            <input class="form-input monospace" id="settings-openalex-email" type="email"
            placeholder="name@example.com"
            value="${esc(openAlexEmail || '')}">
            <p class="field-hint">Used as the OpenAlex <strong>mailto</strong> parameter for polite-pool requests.</p>
          </div>

          <div class="settings-save-row">
            <button class="btn-primary" id="settings-openalex-save-btn">Save OpenAlex Settings</button>
            <span class="settings-saved-msg" id="settings-openalex-saved-msg">Saved!</span>
          </div>
          </div>

        <div class="settings-section">
          <h3>Fetch Automation</h3>
          <p class="field-hint" style="margin-top:2px">Configure how metadata enrichment runs by default in the Articles view and after new searches.</p>

          <div class="form-field" style="margin-top:14px">
            <label for="settings-auto-fetch-enabled">Auto-fetch metadata (Crossref) after search</label>
            <select class="form-input" id="settings-auto-fetch-enabled">
              <option value="off" ${autoFetchEnabled ? '' : 'selected'}>Disabled</option>
              <option value="on" ${autoFetchEnabled ? 'selected' : ''}>Enabled</option>
            </select>
            <p class="field-hint">When enabled, abstracts/authors/types/affiliation fetching starts automatically after each successful search run.</p>
          </div>

          <div class="form-field">
            <label for="settings-auto-tag-enabled">Auto-tag after search</label>
            <select class="form-input" id="settings-auto-tag-enabled">
              <option value="off" ${autoTagEnabled ? '' : 'selected'}>Disabled</option>
              <option value="on" ${autoTagEnabled ? 'selected' : ''}>Enabled</option>
            </select>
            <p class="field-hint">When enabled, journal-keyword auto-tagging runs automatically after each successful search run, same as the Articles-view button.</p>
          </div>

          <div class="form-field">
            <label for="settings-auto-run-scope">Apply automatic actions to</label>
            <select class="form-input" id="settings-auto-run-scope">
              <option value="all" ${autoRunScope === 'new' ? '' : 'selected'}>All eligible articles in the project</option>
              <option value="new" ${autoRunScope === 'new' ? 'selected' : ''}>Only articles newly added by that search</option>
            </select>
            <p class="field-hint">Controls the scope of the two automatic actions above. Manual Fetch/Auto-tag buttons in Articles are unaffected and always cover the whole project.</p>
          </div>

          <div class="form-field">
            <label for="settings-fetch-mode">Default fetch mode</label>
            <select class="form-input" id="settings-fetch-mode">
              <option value="missing" ${fetchMode === 'all' ? '' : 'selected'}>Missing only</option>
              <option value="all" ${fetchMode === 'all' ? 'selected' : ''}>Re-fetch all eligible</option>
            </select>
            <p class="field-hint">Applies to Fetch actions and the Fetch All button.</p>
          </div>

          <div class="form-field">
            <label>Auto-tag disciplines</label>
            <p class="field-hint" style="margin-top:2px">
              Deselect disciplines that don't apply to this project to remove them as
              auto-tag candidates entirely — sharpens results among the ones that remain
              instead of competing against irrelevant categories. All enabled by default.
            </p>
            <div class="settings-category-grid" id="settings-autotag-categories">
              ${categories.map(cat => `
                <label class="settings-category-item">
                  <input type="checkbox" value="${esc(cat)}" ${enabledCategorySet.has(cat) ? 'checked' : ''}>
                  <span>${esc(cat)}</span>
                </label>`).join('')}
            </div>
            <div class="settings-category-actions">
              <button type="button" class="link-btn" id="settings-autotag-categories-all">Select all</button>
              <button type="button" class="link-btn" id="settings-autotag-categories-none">Select none</button>
            </div>
          </div>

          <div class="settings-save-row">
            <button class="btn-primary" id="settings-fetch-save-btn">Save Fetch Settings</button>
            <span class="settings-saved-msg" id="settings-fetch-saved-msg">Saved!</span>
          </div>
        </div>

        <div class="settings-section">
          <h3>Workspace</h3>
          <div class="form-field">
            <label>Open Folder</label>
            <p class="field-hint" style="margin-top:2px">
              ${folderName
                ? `Currently using: <strong>${esc(folderName)}</strong>`
                : 'No folder is currently open.'
              }
            </p>
            <button class="btn-secondary" id="settings-open-folder" style="margin-top:8px">
              ${SLRIcons.folderOpen} Open different folder&hellip;
            </button>
          </div>
        </div>

        ${renderCloudSyncSection()}
      </div>`;

    function collectSettingsFromForm() {
      const categoryBoxes = [...container.querySelectorAll('#settings-autotag-categories input[type="checkbox"]')];
      const checkedCategories = categoryBoxes.filter(cb => cb.checked).map(cb => cb.value);
      // Empty selection means "restrict to nothing", which would silently
      // disable auto-tagging entirely — treat "none checked" as "all enabled"
      // instead, since that's almost certainly not what a user intends.
      const autoTagCategoriesValue = checkedCategories.length ? checkedCategories : categories;
      return {
        apiKey: container.querySelector('#settings-apikey').value.trim(),
        instToken: container.querySelector('#settings-insttoken').value.trim(),
        openAlexKey: container.querySelector('#settings-openalex-key').value.trim(),
        openAlexEmail: container.querySelector('#settings-openalex-email').value.trim(),
        autoFetchEnabled: container.querySelector('#settings-auto-fetch-enabled').value === 'on',
        autoTagEnabled: container.querySelector('#settings-auto-tag-enabled').value === 'on',
        autoRunScope: container.querySelector('#settings-auto-run-scope').value === 'new' ? 'new' : 'all',
        autoTagCategories: autoTagCategoriesValue,
        fetchMode: container.querySelector('#settings-fetch-mode').value === 'all' ? 'all' : 'missing',
      };
    }

    function flashSavedMsg(id) {
      const msg = container.querySelector(id);
      if (msg) {
        msg.classList.add('visible');
        setTimeout(() => msg.classList.remove('visible'), 2000);
      }
    }

    container.querySelector('#settings-save-btn').addEventListener('click', async () => {
      await SLRApp.saveSettings(collectSettingsFromForm());
      flashSavedMsg('#settings-saved-msg');
    });

    container.querySelector('#settings-openalex-save-btn').addEventListener('click', async () => {
      await SLRApp.saveSettings(collectSettingsFromForm());
      flashSavedMsg('#settings-openalex-saved-msg');
    });

    container.querySelector('#settings-fetch-save-btn').addEventListener('click', async () => {
      await SLRApp.saveSettings(collectSettingsFromForm());
      flashSavedMsg('#settings-fetch-saved-msg');
    });

    container.querySelector('#settings-autotag-categories-all')?.addEventListener('click', () => {
      container.querySelectorAll('#settings-autotag-categories input[type="checkbox"]').forEach(cb => { cb.checked = true; });
    });
    container.querySelector('#settings-autotag-categories-none')?.addEventListener('click', () => {
      container.querySelectorAll('#settings-autotag-categories input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    });

    container.querySelector('#settings-scopus-test-btn').addEventListener('click', async () => {
      const btn = container.querySelector('#settings-scopus-test-btn');
      const resultEl = container.querySelector('#settings-scopus-test-result');
      if (!btn || !resultEl) return;
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = 'Testing…';
      resultEl.hidden = false;
      resultEl.className = 'scopus-test-result';
      resultEl.textContent = 'Contacting api.elsevier.com…';
      try {
        const keyInput = container.querySelector('#settings-apikey').value.trim();
        const tokenInput = container.querySelector('#settings-insttoken').value.trim();
        const result = await SLRApp.testScopusApiKey(keyInput, tokenInput);
        resultEl.innerHTML = formatScopusTestResult(result);
        resultEl.classList.add(result.hasKey && result.std && result.std.ok ? 'scopus-test-ok' : 'scopus-test-fail');
      } catch (err) {
        resultEl.textContent = `Test failed: ${err && err.message ? err.message : String(err)}`;
        resultEl.classList.add('scopus-test-fail');
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });

    container.querySelector('#settings-open-folder').addEventListener('click', () => {
      SLRApp.openFolder();
    });

    container.querySelector('#settings-privacy-link')?.addEventListener('click', () => {
      SLRApp.navigate('privacy');
    });

    wireCloudSyncSection(container);

    container.querySelectorAll('.secret-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = container.querySelector(`#${btn.dataset.target}`);
        if (!input) return;
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        btn.setAttribute('aria-pressed', visible ? 'false' : 'true');
        btn.setAttribute('aria-label', visible ? 'Show secret' : 'Hide secret');
        const icon = btn.querySelector('.secret-toggle-icon');
        const label = btn.querySelector('.secret-toggle-label');
        if (icon) icon.innerHTML = visible ? SLRIcons.eye : SLRIcons.eyeOff;
        if (label) label.textContent = visible ? 'Show' : 'Hide';
      });
    });
  }

  //  Privacy view
  // Everything below is drawn directly from what the code actually does —
  // every localStorage/IndexedDB key and every external endpoint named here
  // was verified by reading js/app.js, js/app-ui.js, js/data.js,
  // js/data-local.js, js/data-supabase.js, and supabase/schema.sql. Nothing
  // here is boilerplate — if a mechanism changes, this page has to change
  // with it.

  function renderPrivacy(container) {
    container.innerHTML = `
      <div class="settings-view">
        <h2>Privacy &amp; Cookies</h2>
        <p class="settings-subtitle">What this app stores, why, and how to remove it — based on what the code actually does, not a template.</p>

        <div class="scopus-api-notice" style="margin-top:2px">
          <span class="scopus-api-notice-icon">${SLRIcons.info}</span>
          <div><strong>No cookies.</strong> This app never sets a single cookie. It's a static
            site with no server-side session of any kind — what it does store, it stores directly
            in your browser (<code>localStorage</code> and, for one specific thing, <code>IndexedDB</code>),
            which is a different mechanism with different rules (never sent to a server automatically,
            unlike cookies). The distinction matters, so this page is precise about which is which
            instead of calling everything "cookies."</div>
        </div>

        <div class="settings-section">
          <h3>Stored in this browser (<code>localStorage</code>)</h3>
          <p class="field-hint" style="margin-top:2px">Scoped to this browser profile and this
            site's origin only — no other site can read it, and it's never transmitted anywhere
            on its own (only whatever you explicitly search/save is sent, covered further down).</p>
          <ul class="about-feature-list">
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.sun}</span><span><strong>Theme</strong> (<code>slr-theme</code>) &mdash; remembers dark/light mode. Optional; resets to dark if cleared.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.projects}</span><span><strong>Layout preferences</strong> (<code>slr-sidebar-collapsed</code>, <code>slr-actions-visible</code>, <code>slr-projects-sort</code>, <code>slr-pinned-projects</code>) &mdash; sidebar collapsed state, toolbar visibility, project sort order, pinned projects. Optional convenience only.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.check}</span><span><strong>Onboarding progress</strong> (<code>slr-onboarding-done</code>) &mdash; which first-time hints you've already seen, so they don't repeat. Optional.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.folder}</span><span><strong>Active workspace backend</strong> (<code>slr-backend</code>) &mdash; whether Local Folder or Cloud Sync is currently selected. Needed so the app knows which one to reconnect to on your next visit.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.refresh}</span><span><strong>Automation preferences</strong> (<code>slr-auto-fetch-enabled</code>, <code>slr-auto-tag-enabled</code>, <code>slr-auto-run-scope</code>, <code>slr-auto-tag-categories</code>, <code>slr-fetch-mode</code>) &mdash; your chosen auto-enrichment/auto-tagging settings. Optional.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.settings}</span><span><strong>API credentials you enter</strong> (<code>slr-apikey</code>, <code>slr-insttoken</code>, <code>slr-openalex-key</code>, <code>slr-openalex-email</code>) &mdash; only stored if you type them into Settings, so you don't have to retype them. Optional &mdash; the app works without them, just with lower rate limits on Scopus/OpenAlex. In Local Folder mode, the same values are also written into that folder's own <code>slr_config.json</code> on your device (nowhere else), so the desktop app version can share them.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.supabaseLogo}</span><span><strong>Cloud Sync connection override</strong> (<code>slr-supabase-url</code>, <code>slr-supabase-anon-key</code>) &mdash; only present if you've pointed Cloud Sync at a different Supabase project than the one built into the app (e.g. self-hosting). Not used otherwise.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.check}</span><span><strong>Cloud Sync sign-in session</strong> (Cloud Sync mode only) &mdash; Supabase's own client library stores your access/refresh tokens in <code>localStorage</code> under a key it manages itself (prefixed <code>sb-</code>) so you stay signed in between visits. The access token expires automatically (about an hour) and refreshes quietly while you use the app; after a long absence you'll simply be asked to sign in again.</span></li>
          </ul>
        </div>

        <div class="settings-section">
          <h3>Stored in this browser (<code>IndexedDB</code>)</h3>
          <ul class="about-feature-list">
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.folderOpen}</span><span><strong>Local folder connection</strong> (Local Folder mode only; database <code>slr-harvester-web</code>, store <code>handles</code>) &mdash; the browser's own reference/permission handle to the folder you picked, so the app can reconnect without re-prompting the picker every visit. This holds a permission token, not file contents &mdash; your actual project files (search results, tags, etc.) live only inside the folder you chose on your own device, read and written live through the File System Access API. Nothing about them is copied into browser storage.</span></li>
          </ul>
        </div>

        <div class="settings-section">
          <h3>Sent to external services</h3>
          <p class="field-hint" style="margin-top:2px">Only when you actively search or enrich
            articles &mdash; each request goes directly from your browser to that service, not
            through any server this app runs (there isn't one). Each is an independent third
            party with its own privacy policy; this app has no visibility into what they log.</p>
          <ul class="about-feature-list">
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.databases}</span><span><strong>Scopus</strong> (api.elsevier.com) &mdash; your search query, and your API key / institutional token as request headers if you've configured one.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.databases}</span><span><strong>PubMed</strong> (eutils.ncbi.nlm.nih.gov) &mdash; your search query. No key required or sent.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.databases}</span><span><strong>OpenAlex</strong> (api.openalex.org) &mdash; your search query, and your OpenAlex key/contact email as a parameter, only if you've set them in Settings.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.refresh}</span><span><strong>Crossref</strong> (api.crossref.org) &mdash; DOI-based lookups when you use Fetch Abstracts/Authors/Types. A fixed placeholder contact address is sent as Crossref's polite-pool parameter, never your own email.</span></li>
          </ul>
        </div>

        <div class="settings-section">
          <h3>Cloud Sync (Supabase) — if you Sign Up / Log In</h3>
          <ul class="about-feature-list">
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.user}</span><span><strong>Account</strong> &mdash; your email and password go to Supabase's Auth service, which stores the password using standard industry hashing; this app itself never stores or sees your password.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.project}</span><span><strong>Project data</strong> &mdash; search results, tags, corpus/selected status, saved search terms, and the Scopus/OpenAlex credentials you entered are stored in this app's Supabase database, in rows tied to your account.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.check}</span><span><strong>Who can access it</strong> &mdash; Row Level Security policies restrict every row to your own account at the application layer, so no other signed-in user can read or write your data through the app. Worth stating plainly: this app currently uses one shared Supabase project (not one per user), so its administrator has the same underlying database access any hosted-service operator has via the Supabase dashboard — the same as for any backend service you sign up for, just not left unsaid here.</span></li>
          </ul>
        </div>

        <div class="settings-section">
          <h3>What isn't here</h3>
          <ul class="about-feature-list">
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.check}</span><span>No cookies of any kind &mdash; no session cookies, no tracking cookies, no third-party ad cookies.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.check}</span><span>No analytics, tracking, or fingerprinting scripts. The app currently loads zero third-party scripts at startup at all &mdash; even the Supabase SDK is vendored into this app's own files rather than pulled from a CDN.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.check}</span><span>No ad networks, no session-replay tools, no data brokers.</span></li>
          </ul>
        </div>

        <div class="settings-section">
          <h3>Deleting or resetting your data</h3>
          <p style="font-size:13px;color:var(--text-muted);line-height:1.7">
            Everything this app stores in your browser (all <code>localStorage</code> keys and the
            IndexedDB entry above) is scoped to this browser profile and this site's origin only.
            Your browser's own <strong>"Clear site data" / "Clear browsing data"</strong> feature
            removes all of it in one step and resets the app to a first-visit state (in Chrome/Edge:
            the padlock icon next to the address bar → Site settings → Clear data; or Settings →
            Privacy → Clear browsing data, scoped to this site).
          </p>
          <p style="font-size:13px;color:var(--text-muted);margin-top:8px;line-height:1.7">
            <strong>Local Folder</strong>: your research data was never copied anywhere else — it's
            the files in the folder you chose, fully under your own control.
          </p>
          <p style="font-size:13px;color:var(--text-muted);margin-top:8px;line-height:1.7">
            <strong>Cloud Sync</strong>: Sign Out (Home screen, account menu) clears your local
            session immediately. The app doesn't yet offer self-service full account/data deletion
            from the UI — reach out via <a href="https://github.com/socresearcher/slr-harvester/issues" target="_blank" rel="noopener">GitHub</a>
            to request deletion of your Cloud Sync account and its stored data.
          </p>
        </div>
      </div>`;
  }

  //  About view

  function renderAbout(container) {
    container.innerHTML = `
      <div class="settings-view">
        <h2>About SLR Harvester <span class="title-web">Web</span></h2>
        <p class="settings-subtitle">A project-based workflow tool for conducting Systematic Literature Reviews.</p>

        <div class="about-links-row">
          <a class="about-link-btn" href="https://github.com/socresearcher" target="_blank" rel="noopener">
            ${SLRIcons.externalLink || ''}
            <span>GitHub</span>
          </a>
          <a class="about-link-btn" href="https://github.com/socresearcher/slr-harvester/issues" target="_blank" rel="noopener">
            ${SLRIcons.externalLink || ''}
            <span>Report an Issue</span>
          </a>
          <a class="about-link-btn about-link-btn--license" href="https://github.com/socresearcher/slr-harvester/blob/main/LICENSE.md" target="_blank" rel="noopener">
            ${SLRIcons.externalLink || ''}
            <span>License</span>
          </a>
          <button type="button" class="about-link-btn" id="about-privacy-btn">
            ${SLRIcons.info}
            <span>Privacy &amp; Cookies</span>
          </button>
        </div>

        <div class="settings-section" id="about-first-time">
          <h3>First time here?</h3>
          <p style="font-size:13px;color:var(--text-muted);line-height:1.7">
            <strong>On mobile, or Firefox/Safari?</strong> Local Folder needs the
            File System Access API, which isn't available there — use
            <strong>Sign Up</strong> or <strong>Log In</strong> on the Home screen
            instead: it syncs your projects through the cloud and works in any
            browser.
          </p>
          <p style="font-size:13px;color:var(--text-muted);margin-top:10px;line-height:1.7">
            <strong>First time with Local Folder?</strong> Click <strong>Continue
            with Local Folder</strong> on the Home screen, then create a new, empty
            folder in the picker dialog (any name works, e.g.
            <code>SLR-Harvester-Data</code>) and select it. The app sets everything
            up the moment you create your first project — nothing is written until
            then.
          </p>
          <p style="font-size:13px;color:var(--text-muted);margin-top:10px;line-height:1.7">
            <strong>Already have local data?</strong> Select the folder that
            contains <code>projects.json</code> and the <code>projects/</code>
            directory - your existing SLR Harvester workspace. Works with local
            folders and cloud-synced drives (OneDrive, Google Drive) alike.
          </p>
        </div>

        <div class="about-v2-banner">
          <div class="about-v2-header">
            <span class="about-v2-badge">V2</span>
            <strong>What&rsquo;s New in Version 2 &mdash; Web App</strong>
          </div>
          <ul class="about-feature-list">
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.folderOpen}</span><span><strong>Browser-based</strong> &mdash; no installation, runs from <code>index.html</code> or a local server</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.githubLogo}</span><span><strong>Hosted on GitHub Pages</strong> &mdash; open <a href="https://socresearcher.github.io/slr-harvester/" target="_blank" rel="noopener">socresearcher.github.io/slr-harvester</a> directly, no download required; your project data still never leaves your device</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.supabaseLogo}</span><span><strong>Cloud Sync (Supabase)</strong> &mdash; optional: sync projects through your own Supabase project instead of a local folder, so any browser or device works, including mobile.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.databases}</span><span><strong>Multi-database search</strong> &mdash; Scopus, PubMed and OpenAlex integrated directly in the Search view</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.refresh}</span><span><strong>Data enrichment via Crossref</strong> &mdash; fetch missing abstracts, full author lists, document types, and affiliations (institution names and countries) by DOI</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.search}</span><span><strong>Advanced article-list search</strong> &mdash; use semicolon-separated terms for AND logic (e.g., <code>companion; ethnography</code>) across title, abstract and journal fields</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.palette}</span><span><strong>Colour scheme engine</strong> &mdash; 17 built-in palettes plus cycling monochrome; applied directly to your project's tag colours</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.tag}</span><span><strong>Tag aliasing</strong> &mdash; map multiple tag names to one canonical label for unified filtering</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.corpus}</span><span><strong>Corpus &amp; Selected screening</strong> &mdash; two-stage inclusion workflow, identical to the desktop app</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.chart}</span><span><strong>Visualisations</strong> &mdash; year distribution, tag distribution and selection funnel charts (Canvas, no libraries)</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.history}</span><span><strong>Query history panel</strong> &mdash; browse past searches with full result counts and article previews</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.check}</span><span><strong>Zero-dependency</strong> &mdash; no frameworks, no build step, no CDN. Opens as a plain HTML file.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.sun}</span><span><strong>Dark &amp; light theme</strong> &mdash; persisted in <code>localStorage</code>, full CSS custom property design system</span></li>
          </ul>
        </div>

        <div class="about-v1-banner">
          <div class="about-v1-header">
            <span class="about-v1-badge">V1</span>
            <strong>Original Desktop App (Python / customtkinter)</strong>
          </div>
          <ul class="about-feature-list about-feature-list--muted">
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.project}</span><span>Native desktop GUI built with <strong>customtkinter</strong></span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.search}</span><span>Scopus search with full field-code query builder</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.folder}</span><span>Project-based storage (JSON files, identical format)</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.selected}</span><span>Two-stage inclusion: Selected &rarr; Corpus, with per-article comments</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.tag}</span><span>Tag management and colour assignment</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.externalLink}</span><span>Export to <code>.bib</code>, <code>.ris</code>, <code>.csv</code></span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.chart}</span><span>Charts as <code>.png</code> via Matplotlib</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.warning}</span><span>Requires Python 3.10+ and institutional Scopus API key</span></li>
          </ul>
        </div>

        <div class="settings-section">
          <h3>Integrated Databases</h3>
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
            The following databases are fully integrated and searchable directly from the Search view:
          </p>
          <ul style="font-size:13px;color:var(--text-muted);line-height:1.9;padding-left:18px">
            <li><strong>Scopus</strong> &mdash; requires institutional API key (elsevier.com)</li>
            <li><strong>PubMed</strong> &mdash; free, no key required (NCBI E-utilities)</li>
            <li><strong>OpenAlex</strong> &mdash; free, open, no key required</li>
          </ul>
        </div>

        <div class="settings-section">
          <h3>Data Enrichment</h3>
          <p style="font-size:13px;color:var(--text-muted);line-height:1.7">
            The Articles view provides four enrichment buttons (plus a
            "Fetch Everything" that runs all of them in one pass), all free
            and requiring no key:
          </p>
          <ul style="font-size:13px;color:var(--text-muted);line-height:1.9;padding-left:18px">
            <li><strong>Fetch Abstracts</strong> &mdash; fills in missing abstracts (Crossref, via DOI)</li>
            <li><strong>Fetch Authors</strong> &mdash; retrieves the complete author list (Crossref, via DOI) &mdash; Scopus truncates to first author</li>
            <li><strong>Fetch Types</strong> &mdash; determines the document type (Article, Chapter, Preprint, &hellip;) (Crossref, via DOI)</li>
            <li><strong>Fetch Affiliations</strong> &mdash; institution names and countries (via DOI / OpenAlex / PMID)</li>
          </ul>
        </div>

        <div class="settings-section">
          <h3>Scopus API Notes</h3>
          <div class="scopus-api-notice">
            <div class="scopus-api-notice-icon">${SLRIcons.search}</div>
            <div style="font-size:13px">
              <strong>Scopus Search API</strong> &mdash; requires an active <strong>API key</strong> from Elsevier.
              Configure it in <button class="link-btn" id="about-goto-settings">Settings</button>.
            </div>
          </div>
          <div class="scopus-api-notice scopus-api-notice-warn" style="margin-top:8px">
            <div class="scopus-api-notice-icon">${SLRIcons.warning}</div>
            <div style="font-size:13px">
              <strong>Abstract Retrieval API</strong> &mdash; full abstracts require an <strong>institutional subscription</strong>
              and access from a subscribed network (campus VPN or on-site). An <strong>InstToken</strong>
              may also be required. Without this access, returned abstracts can be empty even with a personal API key.
              Use <strong>Fetch Abstracts</strong> in the Articles view as a workaround to retrieve missing abstracts via Crossref (free, DOI-based).
            </div>
          </div>
          <div class="scopus-api-notice scopus-api-notice-warn" style="margin-top:8px">
            <div class="scopus-api-notice-icon">${SLRIcons.user}</div>
            <div style="font-size:13px">
              <strong>Author Retrieval API</strong> &mdash; the Scopus Search API returns only the <strong>first author</strong> by default;
              co-authors are truncated. Use <strong>Fetch Authors</strong> in the Articles view to retrieve full author lists via Crossref.
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Compatibility</h3>
          <p style="font-size:13px;color:var(--text-muted);line-height:1.7">
            <strong>Local Folder</strong> mode requires <strong>Chrome 86+</strong> or
            <strong>Edge 86+</strong> on <strong>desktop</strong> for the File System
            Access API (<code>showDirectoryPicker</code>). Desktop Firefox and Safari
            don't support it, and neither does any mobile browser (Chrome, Edge, or
            Safari on phone/tablet) &mdash; this API isn't implemented on mobile at all
            regardless of vendor. <strong>Cloud Sync</strong> (Sign Up / Log In from the
            Home screen) works in any modern browser, including mobile, as an alternative.
          </p>
          <p style="font-size:13px;color:var(--text-muted);margin-top:8px;line-height:1.7">
            In <strong>Local Folder</strong> mode the app works entirely offline &mdash;
            no project data is sent to any server, only direct API requests from your
            browser to the respective academic databases. In <strong>Cloud Sync</strong>
            mode, project data is stored in this app's Supabase project instead (see
            <button type="button" class="link-btn" id="databases-privacy-link">Privacy &amp; Cookies</button>
            for the full breakdown of what's stored and where).
          </p>
        </div>

        <div class="settings-section">
          <h3>Version &amp; License</h3>
          <p style="font-size:13px;color:var(--text-muted)">SLR Harvester Web &mdash; 2026</p>
          <p style="font-size:12px;color:var(--text-muted);margin-top:4px">&copy; 2026 Gregor Hobersdorfer &mdash; All rights reserved. Non-commercial use permitted with attribution.</p>
        </div>
      </div>`;
    const gotoBtn = container.querySelector('#about-goto-settings');
    if (gotoBtn) gotoBtn.addEventListener('click', () => SLRApp.navigate('settings'));
    container.querySelector('#about-privacy-btn')?.addEventListener('click', () => SLRApp.navigate('privacy'));
    container.querySelector('#databases-privacy-link')?.addEventListener('click', () => SLRApp.navigate('privacy'));
  }

  //  Tags view 

  // Pre-defined color scheme metadata for the scheme panel
  const COLOR_SCHEMES = [
    { key: 'slr',       name: 'SLR Harvester', desc: 'Turquoise brand shades, light to deep teal' },
    { key: 'vivid',     name: 'Vivid',     desc: 'Saturated, evenly spread hues' },
    { key: 'pastel',    name: 'Pastel',     desc: 'Soft, light tones' },
    { key: 'warm',      name: 'Warm',       desc: 'Reds, oranges, warm yellows' },
    { key: 'cool',      name: 'Cool',       desc: 'Teals, blues, violets' },
    { key: 'mono',      name: 'Monochrome', desc: 'Single hue, light to dark' },
    { key: 'scaled',    name: 'Scaled',     desc: 'Most-used tags are darkest' },
    { key: 'earth',     name: 'Earth',      desc: 'Browns, ochres, forest greens' },
    { key: 'neon',      name: 'Neon',       desc: 'Full-spectrum high-saturation' },
    { key: 'sunset',    name: 'Sunset',     desc: 'Red  coral  magenta  purple' },
    { key: 'forest',    name: 'Forest',     desc: 'Deep to light green' },
    { key: 'midnight',  name: 'Midnight',   desc: 'Deep navy to pale sky' },
    { key: 'rose',      name: 'Rose',       desc: 'Deep rose to blush' },
    { key: 'grayscale', name: 'Grayscale',  desc: 'Black to white' },
    { key: 'ocean',     name: 'Ocean',      desc: 'Deep ocean to aqua foam' },
    { key: 'autumn',    name: 'Autumn',     desc: 'Amber, rust, burgundy' },
    { key: 'candy',     name: 'Candy',      desc: 'Hot-pink, violet, sky blue' },
    { key: 'citrus',    name: 'Citrus',     desc: 'Lime, yellow, orange' },
    { key: 'slate',     name: 'Slate',      desc: 'Cool blue-gray, light to dark' },
    { key: 'berry',     name: 'Berry',      desc: 'Magenta, plum, deep wine' },
    { key: 'meadow',    name: 'Meadow',     desc: 'Yellow-green to deep green' },
  ];

  function renderTags(container, articles, projectData, autoTagRules, isAutoTagCustomized, folderName) {
    if (!projectData) {
      container.innerHTML = `<div class="tags-view" style="padding:0">${renderNoProjectNotice()}</div>`;
      return;
    }

    const tagsConfig = projectData.tagsConfig || {};
    const aliases    = projectData.tagAliases  || {};

    // Count articles per color key
    const countMap = {};
    for (const a of (articles || [])) {
      if (a.color && a.color !== 'None') {
        countMap[a.color] = (countMap[a.color] || 0) + 1;
      }
    }

    // All color keys from tagsConfig, excluding 'None'
    const tagKeys = Object.keys(tagsConfig).filter(k => k !== 'None' && tagsConfig[k]);

    const tagCardsHTML = tagKeys.map(colorKey => {
      const hex   = tagsConfig[colorKey] || '#888';
      const alias = aliases[colorKey] || colorKey;
      const count = countMap[colorKey] || 0;
      return `
        <div class="tag-card" data-colorkey="${esc(colorKey)}">
          <div class="tag-card-swatch-wrap" title="Click to change colour">
            <div class="tag-card-swatch" style="background:${esc(hex)}"></div>
            <input type="color" class="tag-swatch-picker" value="${esc(hex)}" data-colorkey="${esc(colorKey)}">
          </div>
          <div class="tag-card-body">
            <div class="tag-card-name" id="tag-name-${esc(colorKey)}">${esc(alias)}</div>
            <div class="tag-card-count">${count} article${count !== 1 ? 's' : ''}</div>
          </div>
          <div class="tag-card-actions">
            <button class="tag-card-btn" data-rename="${esc(colorKey)}" title="Rename tag">${SLRIcons.pencil}</button>
            <button class="tag-card-btn tag-card-delete-btn" data-delete="${esc(colorKey)}" title="Delete tag">${SLRIcons.trash}</button>
          </div>
        </div>`;
    }).join('');

    const totalTagged   = (articles || []).filter(a => a.color && a.color !== 'None').length;
    const totalArticles = (articles || []).length;

    // Scheme preview: generate 5 evenly-spaced HSL dots for each scheme
    function schemeDots(scheme) {
      const n = 5;
      // For mono, read the current hue from app state so the preview matches the upcoming apply
      const monoH = (typeof SLRApp !== 'undefined' && SLRApp.state && SLRApp.state.monoHue != null)
        ? SLRApp.state.monoHue
        : 220;
      return Array.from({ length: n }, (_, i) => {
        const t = n > 1 ? i / (n - 1) : 0;
        let h, s, l;
        switch (scheme) {
          case 'vivid':     h = Math.round((i/n)*360); s=68; l=52; break;
          case 'pastel':    h = Math.round((i/n)*360); s=55; l=80; break;
          case 'warm':      h = Math.round(t*72);      s=72; l=50; break;
          case 'cool':      h = Math.round(180+t*105); s=62; l=52; break;
          case 'mono':      h = monoH; s=65; l=Math.round(70-t*38); break;
          case 'scaled':    h = Math.round((i/n)*360); s=Math.round(80-t*42); l=Math.round(42+t*24); break;
          case 'earth':     h = Math.round(20+(i/n)*120); s=55; l=38; break;
          case 'neon':      h = Math.round((i/n)*360); s=100; l=52; break;
          case 'sunset':    h = Math.round(((340-t*110)+360)%360); s=72; l=48; break;
          case 'forest':    h = Math.round(130+t*20); s=58; l=Math.round(22+t*38); break;
          case 'midnight':  h = Math.round(220+t*10); s=62; l=Math.round(18+t*52); break;
          case 'rose':      h = Math.round(330+t*20); s=68; l=Math.round(38+t*40); break;
          case 'grayscale': h=0; s=0; l=Math.round(10+t*80); break;
          case 'ocean':     h = Math.round(195-t*20); s=Math.round(75-t*30); l=Math.round(22+t*52); break;
          case 'autumn':    h = Math.round(40-t*40); s=75; l=Math.round(52-t*20); break;
          case 'candy':     h = Math.round(310-t*110); s=85; l=62; break;
          case 'citrus':    h = Math.round(80-t*55); s=82; l=48; break;
          case 'slr':       h = Math.round(169+t*10); s=Math.round(70+t*10); l=Math.round(60-t*38); break;
          case 'slate':     h = 212; s=Math.round(12+t*14); l=Math.round(74-t*42); break;
          case 'berry':     h = Math.round(300+t*40); s=Math.round(55+t*12); l=Math.round(52-t*20); break;
          case 'meadow':    h = Math.round(72+t*66); s=Math.round(58+t*10); l=Math.round(52-t*16); break;
          default:          h = Math.round((i/n)*360); s=60; l=55;
        }
        const hsl = `hsl(${h},${s}%,${l}%)`;
        return `<span style="background:${hsl}"></span>`;
      }).join('');
    }

    const schemeBtnsHTML = COLOR_SCHEMES.map(sc => `
      <button class="scheme-btn" data-scheme="${esc(sc.key)}" title="${esc(sc.desc)}">
        <div class="scheme-dots">${schemeDots(sc.key)}</div>
        <span class="scheme-name">${esc(sc.name)}</span>
        <span class="scheme-desc">${esc(sc.desc)}</span>
      </button>`).join('');

    container.innerHTML = `
      <div class="tags-view">
        <div class="tags-header">
          <div class="tags-summary">
            ${SLRIcons.tag}
            <span>${tagKeys.length} tag${tagKeys.length !== 1 ? 's' : ''} defined &mdash;
            ${totalTagged} of ${totalArticles} articles tagged</span>
          </div>
          <button class="btn-secondary projects-add-btn tag-add-btn" id="tag-add-open">${SLRIcons.plus} Add Tag</button>
        </div>

        <div class="tags-auto-note">
          ${SLRIcons.info}
          <span><strong>Auto-tag</strong> in Articles assigns tags to untagged records based on journal-title keywords and can be re-run anytime after you refine rules.</span>
        </div>

        <div class="tags-section">
          <h3>Colour Schemes</h3>
          <div class="scheme-panel">
            <p class="scheme-panel-intro">Apply a preset colour scheme to all existing tags at once.</p>
            <div class="scheme-grid">${schemeBtnsHTML}</div>
          </div>
        </div>

        <div class="tags-section">
          <div class="tags-section-header">
            <h3>Tags</h3>
          </div>

          <div class="scheme-panel">
            <div class="tag-add-form" id="tag-add-form" style="display:none">
              <div class="tag-add-form-inner">
                <input type="color" class="tag-color-input" id="tag-new-color" value="#64A8FF">
                <input type="text"  class="tag-name-input"  id="tag-new-name" placeholder="Tag name" maxlength="40">
                <button class="btn-primary btn-sm" id="tag-add-confirm">Add</button>
                <button class="btn-secondary btn-sm" id="tag-add-cancel">Cancel</button>
              </div>
            </div>

            ${tagKeys.length > 0
              ? `<div class="tags-grid">${tagCardsHTML}</div>`
              : `<p class="scheme-panel-intro" style="margin-bottom:0">No tags defined yet. Use Auto-tag in the Articles view or add tags manually.</p>`
            }
          </div>
        </div>

        <div class="tags-section">
          <h3>Auto-Tag Rules</h3>
          <div id="autotag-rules-mount"></div>
        </div>
      </div>`;

    // Wire: show/hide add form
    container.querySelector('#tag-add-open').addEventListener('click', () => {
      const f = container.querySelector('#tag-add-form');
      f.style.display = f.style.display === 'none' ? '' : 'none';
    });
    container.querySelector('#tag-add-cancel').addEventListener('click', () => {
      container.querySelector('#tag-add-form').style.display = 'none';
    });
    container.querySelector('#tag-add-confirm').addEventListener('click', () => {
      const hex  = container.querySelector('#tag-new-color').value;
      const name = container.querySelector('#tag-new-name').value.trim();
      if (!name) return;
      // Derive a safe color key from name
      const key = name.charAt(0).toUpperCase() + name.slice(1);
      SLRApp.addTag(key, hex, name);
    });

    // Wire: color picker (recolor)
    container.querySelectorAll('.tag-swatch-picker').forEach(picker => {
      picker.addEventListener('input', () => {
        const colorKey = picker.dataset.colorkey;
        const hex = picker.value;
        // Live-update the visible swatch
        const swatch = picker.previousElementSibling;
        if (swatch) swatch.style.background = hex;
      });
      picker.addEventListener('change', () => {
        SLRApp.recolorTag(picker.dataset.colorkey, picker.value);
      });
    });

    // Wire: rename buttons
    container.querySelectorAll('[data-rename]').forEach(btn => {
      btn.addEventListener('click', () => {
        const colorKey = btn.dataset.rename;
        const nameEl   = container.querySelector(`#tag-name-${CSS.escape(colorKey)}`);
        if (!nameEl) return;
        const current = nameEl.textContent;
        nameEl.innerHTML = `<input class="tag-inline-input" value="${esc(current)}" maxlength="40">`;
        const input = nameEl.querySelector('input');
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim();
          if (newName && newName !== current) SLRApp.renameTag(colorKey, newName);
          else renderTags(container, articles, projectData);
        };
        input.addEventListener('blur',    commit);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { commit(); }
          if (e.key === 'Escape') { renderTags(container, articles, projectData); }
        });
      });
    });

    // Wire: delete buttons
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const colorKey = btn.dataset.delete;
        const alias    = (projectData.tagAliases || {})[colorKey] || colorKey;
        const count    = countMap[colorKey] || 0;
        const msg = count > 0
          ? `Delete tag "${alias}"? This will remove the tag from ${count} article${count !== 1 ? 's' : ''}.`
          : `Delete tag "${alias}"?`;
        if (window.confirm(msg)) SLRApp.deleteTag(colorKey);
      });
    });

    // Wire: color scheme buttons
    container.querySelectorAll('.scheme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const scheme = btn.dataset.scheme;
        SLRApp.applyColorScheme(scheme);
      });
    });

    // Auto-Tag Rules lives in its own fully self-contained render function
    // (own markup + own event wiring) — mounted into a sub-container here
    // rather than merged line-by-line into this one, so it keeps working
    // exactly as before with zero risk of the two colliding.
    const autotagMount = container.querySelector('#autotag-rules-mount');
    if (autotagMount) renderAutoTagRules(autotagMount, autoTagRules || [], !!isAutoTagCustomized, folderName);
  }

  //  Auto-Tag Rules view

  // User-level (not per-project) editor for the keyword rules Auto-tag (in
  // Articles) matches journal names/titles/abstracts against. Every
  // category — built-in or user-created — is fully editable: rename,
  // recolor, delete, and add/remove individual keywords, mirroring the
  // Tags view's own card interactions. "Reset to Defaults" discards the
  // whole edited copy and goes back to the shipped rule set.
  function renderAutoTagRules(container, rules, isCustomized, folderName) {
    if (!folderName) {
      container.innerHTML = `
        <div class="autotag-view">
          <div class="no-project-notice">
            <p>Connect a workspace (open a local folder, or sign in to Cloud Sync) to manage Auto-Tag Rules — these categories and keywords apply across every project in your workspace/account, not just one.</p>
            <button class="btn-secondary" data-action="goto-projects">${SLRIcons.projects} Go to Projects</button>
          </div>
        </div>`;
      return;
    }

    // Cross-category duplicates are worth flagging (an article can only end
    // up in one category, so the same phrase pulling for two is a real
    // ambiguity) but not worth blocking — the user may want the overlap.
    const normKw = s => String(s || '').trim().toLowerCase();
    const keywordOwners = new Map(); // normalized keyword -> Set<tag>
    for (const rule of rules) {
      for (const kw of rule.keywords) {
        const key = normKw(kw);
        if (!key) continue;
        if (!keywordOwners.has(key)) keywordOwners.set(key, new Set());
        keywordOwners.get(key).add(rule.tag);
      }
    }

    const totalKeywords = rules.reduce((sum, r) => sum + r.keywords.length, 0);

    const cardsHTML = rules.map(rule => {
      const chipsHTML = rule.keywords.map(kw => {
        const owners = keywordOwners.get(normKw(kw));
        const otherTags = owners ? [...owners].filter(t => t !== rule.tag) : [];
        const conflictCls = otherTags.length ? ' autotag-kw-chip--conflict' : '';
        const conflictTitle = otherTags.length
          ? `Also used by: ${otherTags.join(', ')} — the same phrase pulling toward two categories can make matches ambiguous`
          : 'Remove this keyword';
        return `
          <span class="autotag-kw-chip${conflictCls}">
            ${otherTags.length ? SLRIcons.warning : ''}
            ${esc(kw)}
            <button type="button" class="autotag-kw-remove" data-color="${esc(rule.color)}" data-kw="${esc(kw)}" title="${esc(conflictTitle)}" aria-label="Remove keyword ${esc(kw)}">${SLRIcons.close}</button>
          </span>`;
      }).join('');

      const expanded = expandedAutoTagCards.has(rule.color);

      return `
        <div class="autotag-card${expanded ? ' is-expanded' : ''}" data-color="${esc(rule.color)}">
          <div class="autotag-card-header">
            <button type="button" class="autotag-card-expand-toggle" data-toggle-expand="${esc(rule.color)}"
                    aria-expanded="${expanded ? 'true' : 'false'}" title="${expanded ? 'Collapse' : 'Expand'} category">
              ${SLRIcons.chevronRight}
            </button>
            <div class="autotag-card-swatch-wrap" title="Click to change colour">
              <span class="autotag-card-swatch" style="background:${esc(rule.hex)}"></span>
              <input type="color" class="autotag-swatch-picker" value="${esc(rule.hex)}" data-color="${esc(rule.color)}">
            </div>
            <span class="autotag-card-name" id="autotag-name-${esc(rule.color)}">${esc(rule.tag)}</span>
            <span class="autotag-card-count">${rule.keywords.length} keyword${rule.keywords.length !== 1 ? 's' : ''}</span>
            <button type="button" class="tag-card-btn" data-rename="${esc(rule.color)}" title="Rename category">${SLRIcons.pencil}</button>
            <button type="button" class="tag-card-btn tag-card-delete-btn" data-delete="${esc(rule.color)}" title="Delete category">${SLRIcons.trash}</button>
          </div>
          ${expanded ? `
            <div class="autotag-kw-list">${chipsHTML || `<span class="autotag-kw-empty">No keywords yet.</span>`}</div>
            <div class="autotag-add-row">
              <input type="text" class="autotag-add-input" data-color="${esc(rule.color)}" placeholder="Add a keyword or phrase…" maxlength="60">
              <button type="button" class="btn-secondary btn-sm autotag-add-btn" data-color="${esc(rule.color)}">${SLRIcons.plus} Add</button>
            </div>
          ` : ''}
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="autotag-view">
        <div class="tags-header">
          <div class="tags-summary">
            ${SLRIcons.wand}
            <span>${rules.length} categor${rules.length !== 1 ? 'ies' : 'y'} &mdash; ${totalKeywords} keyword${totalKeywords !== 1 ? 's' : ''} total</span>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn-secondary projects-add-btn tag-add-btn" id="autotag-add-category-open">${SLRIcons.plus} Add Category</button>
            <button class="btn-secondary" id="autotag-reset-btn" ${isCustomized ? '' : 'disabled'}>${SLRIcons.refresh} Reset to Defaults</button>
          </div>
        </div>

        <div class="tags-auto-note">
          ${SLRIcons.info}
          <span>Auto-tag (in Articles) scores each article's journal name, title, and abstract against these keyword rules and assigns the highest-scoring category. Rename, recolour, delete, or add categories and keywords freely — changes apply across every project. Turn whole categories on/off per project from Settings &rarr; Auto-tag disciplines.</span>
        </div>

        <div class="scheme-panel">
          <div class="tag-add-form" id="autotag-add-category-form" style="display:none">
            <div class="tag-add-form-inner">
              <input type="color" class="tag-color-input" id="autotag-new-color" value="#64A8FF">
              <input type="text"  class="tag-name-input"  id="autotag-new-name" placeholder="Category name" maxlength="40">
              <button class="btn-primary btn-sm" id="autotag-add-category-confirm">Add</button>
              <button class="btn-secondary btn-sm" id="autotag-add-category-cancel">Cancel</button>
            </div>
          </div>

          <div class="autotag-grid">${cardsHTML}</div>
        </div>
      </div>`;

    container.querySelector('#autotag-reset-btn')?.addEventListener('click', () => {
      SLRApp.resetAutoTagRules();
    });

    // Add category
    container.querySelector('#autotag-add-category-open').addEventListener('click', () => {
      const f = container.querySelector('#autotag-add-category-form');
      f.style.display = f.style.display === 'none' ? '' : 'none';
    });
    container.querySelector('#autotag-add-category-cancel').addEventListener('click', () => {
      container.querySelector('#autotag-add-category-form').style.display = 'none';
    });
    container.querySelector('#autotag-add-category-confirm').addEventListener('click', () => {
      const hex  = container.querySelector('#autotag-new-color').value;
      const name = container.querySelector('#autotag-new-name').value.trim();
      if (!name) return;
      SLRApp.addAutoTagCategory(name, hex);
    });

    // Expand/collapse
    container.querySelectorAll('[data-toggle-expand]').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.toggleExpand;
        if (expandedAutoTagCards.has(color)) expandedAutoTagCards.delete(color);
        else expandedAutoTagCards.add(color);
        renderAutoTagRules(container, rules, isCustomized, folderName);
      });
    });

    // Recolor
    container.querySelectorAll('.autotag-swatch-picker').forEach(picker => {
      picker.addEventListener('input', () => {
        const swatch = picker.previousElementSibling;
        if (swatch) swatch.style.background = picker.value;
      });
      picker.addEventListener('change', () => {
        SLRApp.recolorAutoTagCategory(picker.dataset.color, picker.value);
      });
    });

    // Rename
    container.querySelectorAll('[data-rename]').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.rename;
        const nameEl = container.querySelector(`#autotag-name-${CSS.escape(color)}`);
        if (!nameEl) return;
        const current = nameEl.textContent;
        nameEl.innerHTML = `<input class="tag-inline-input" value="${esc(current)}" maxlength="40">`;
        const input = nameEl.querySelector('input');
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim();
          if (newName && newName !== current) SLRApp.renameAutoTagCategory(color, newName);
          else renderAutoTagRules(container, rules, isCustomized, folderName);
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') renderAutoTagRules(container, rules, isCustomized, folderName);
        });
      });
    });

    // Delete category
    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        SLRApp.deleteAutoTagCategory(btn.dataset.delete);
      });
    });

    // Add/remove keywords
    const submitKeyword = color => {
      const input = container.querySelector(`.autotag-add-input[data-color="${CSS.escape(color)}"]`);
      const val = input ? input.value.trim() : '';
      if (!val) return;
      SLRApp.addAutoTagKeyword(color, val);
    };
    container.querySelectorAll('.autotag-add-btn').forEach(btn => {
      btn.addEventListener('click', () => submitKeyword(btn.dataset.color));
    });
    container.querySelectorAll('.autotag-add-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        submitKeyword(input.dataset.color);
      });
    });
    container.querySelectorAll('.autotag-kw-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        SLRApp.removeAutoTagKeyword(btn.dataset.color, btn.dataset.kw);
      });
    });
  }

  // DOI/OpenAlex/PMID link for a node the user clicked that isn't in this
  // project — mirrors the eid-based link logic in articleItemHTML.
  function externalArticleHref(a) {
    if (a.doi) return `https://doi.org/${a.doi}`;
    const eid = a.eid || a._id || '';
    if (eid.startsWith('openalex:')) return `https://openalex.org/${eid.slice(9)}`;
    if (eid.startsWith('pmid:')) return `https://pubmed.ncbi.nlm.nih.gov/${eid.slice(5)}/`;
    return null;
  }

  const truncateLabel = (s, n) => {
    s = String(s || '').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  // Node label: first author's surname (2 authors: both; 3+: first + "et al."),
  // falling back to a truncated title when no author data is present at all.
  function formatAuthorLabel(a) {
    const raw = String((a && a.authors) || '').trim();
    if (!raw) return truncateLabel((a && a.title) || '(no title)', 18);
    const names = raw.split(',').map(s => s.trim()).filter(Boolean);
    const surname = full => {
      const parts = full.split(/\s+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : full;
    };
    const label = names.length <= 1 ? surname(names[0] || raw)
      : names.length === 2 ? `${surname(names[0])} & ${surname(names[1])}`
      : `${surname(names[0])} et al.`;
    return truncateLabel(label, 24);
  }


  // ── Network PNG export — same clone+resolve-CSS-vars+canvas approach as
  // exportVizAsPNG above. Exports the FULL diagram (worldBBox, computed from
  // every node's current position including drags) regardless of the
  // current pan/zoom — "download" should always capture everything, not
  // just whatever's presently scrolled into view.
  async function exportNetworkAsPNG(svgEl, worldBBox, title) {
    const gv = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const bgC = gv('--bg') || '#0d1117', txtC = gv('--text') || '#e6edf3', mutC = gv('--text-muted') || '#8b949e';
    const FONT = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    const SCALE = 2, PAD = 30, HDR = 44;
    const sw = worldBBox.width, sh = worldBBox.height;
    const W = sw + PAD * 2, H = sh + HDR + PAD * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(W * SCALE);
    canvas.height = Math.ceil(H * SCALE);
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = bgC; ctx.fillRect(0, 0, W, H);
    ctx.font = `600 15px ${FONT}`; ctx.fillStyle = txtC;
    ctx.fillText(title, PAD, PAD + 6);
    ctx.font = `400 11px ${FONT}`; ctx.fillStyle = mutC;
    ctx.fillText(`SLR Harvester Web · ${new Date().toLocaleDateString()}`, PAD, PAD + 24);

    const resolveVarStr = s => s.replace(/var\(\s*([^,)]+)(?:,\s*([^)]*))?\s*\)/g, (_, k, fb) => gv(k.trim()) || fb || '#888');
    const origEls  = [svgEl, ...svgEl.querySelectorAll('*')];
    const clone    = svgEl.cloneNode(true);
    // Export the world bbox at 1:1, ignoring whatever pan/zoom the user is
    // currently looking at — reset the inner viewport group's transform and
    // point the clone's own viewBox at the full content instead.
    clone.setAttribute('viewBox', `${worldBBox.x} ${worldBBox.y} ${sw} ${sh}`);
    clone.setAttribute('width', sw); clone.setAttribute('height', sh);
    const innerGClone = clone.querySelector('.network-viewport');
    if (innerGClone) innerGClone.removeAttribute('transform');
    const cloneEls = [clone, ...clone.querySelectorAll('*')];
    origEls.forEach((orig, i) => {
      const cl = cloneEls[i]; if (!cl) return;
      cl.removeAttribute('class');
      ['fill', 'stroke'].forEach(attr => {
        const v = orig.getAttribute(attr);
        if (v !== null) { cl.setAttribute(attr, v.includes('var(') ? resolveVarStr(v) : v); return; }
        if (['text', 'circle', 'line', 'path'].includes(orig.tagName)) {
          const cs = getComputedStyle(orig)[attr];
          if (cs && cs !== 'none') cl.setAttribute(attr, cs);
        }
      });
    });
    const xml = new XMLSerializer().serializeToString(clone);
    const uri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload  = () => { ctx.drawImage(img, PAD, PAD + HDR, sw, sh); res(); };
      img.onerror = () => rej(new Error('SVG render failed'));
      img.src = uri;
    });
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Canvas export failed')); return; }
        const a = document.createElement('a'), u = URL.createObjectURL(blob);
        a.href = u;
        a.download = `slr-network-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}-${new Date().toISOString().slice(0, 10)}.png`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(u); }, 1000);
        resolve();
      }, 'image/png');
    });
  }

  //  Citation network modal — one article's direct citation neighbours,
  //  built on demand only for whichever article was clicked (never
  //  precomputed for the whole list). Two layers:
  //   1. In-project links — free, from buildCitationNetworkIndex (local
  //      data already on disk, no request).
  //   2. External links — fetched only when the user explicitly clicks
  //      "Load external references/citations", capped per click
  //      (SLRApp.loadExternalReferences/loadExternalCitations enforce the
  //      limits) with its own "load more" for the next capped batch.
  //  Clicking an in-project node re-centers the same modal on it; clicking
  //  an external node (no local data to recurse into) opens its DOI/
  //  OpenAlex page instead.
  function renderArticleNetworkModal(overlay, article, articles, projectData) {
    const networkIndex = buildCitationNetworkIndex(articles);
    const citing  = networkIndex.citesMap.get(article.eid) || [];
    const citedBy = networkIndex.citedByMap.get(article.eid) || [];

    const isOpenAlex = article.source === 'openalex' && !!article.eid;
    const canLoadRefs = isOpenAlex && Array.isArray(article.referencedWorks) && article.referencedWorks.length > 0;
    const canLoadCites = isOpenAlex && (parseInt(article.citedby, 10) || 0) > citedBy.length;

    // Mutable across re-draws of THIS modal instance only — reset whenever
    // the user navigates to a different article (fresh renderArticleNetworkModal call).
    let extCiting = [], extCitedBy = [];
    let extRefsOffset = 0, extCitesPage = 1;
    let extRefsDone = !canLoadRefs, extCitesDone = !canLoadCites;
    let loadingRefs = false, loadingCites = false;
    let loadError = '';

    // Manual node positions (world coords) the user has dragged into place —
    // survive across re-draws (e.g. loading more external data) so
    // rearranging never gets undone by something unrelated; edges are
    // always recomputed from current positions on every draw, so a
    // relationship never breaks just because a node moved.
    const nodePositions = new Map();
    let pan = { x: 0, y: 0 };
    let zoomLevel = 1;
    let viewFitted = false; // true after the first auto-fit; later draws keep the user's own pan/zoom

    // Node geometry. GAP is deliberately generous — measured against real
    // rendered text bounding boxes, a font's ascent above its baseline runs
    // noticeably taller than font-size alone suggests, so a tight gap here
    // let the nearest label line's glyphs clip into the circle.
    const R = 13, CENTER_R = 20, GAP = 14, LINE_H = 13;
    const REF_W = 880, REF_H = 480; // fixed viewport (viewBox) — independent of world/content size
    const MIN_ZOOM = 0.2, MAX_ZOOM = 4;

    const keyOf = (a, fallback) => (a && (a.eid || a._id || a.doi)) || fallback;

    const tooltipAttrs = (a, roleText) => {
      const metaParts = [];
      if (a.authors) metaParts.push(a.authors);
      if (a.publicationName) metaParts.push(a.publicationName);
      const year = a.date ? a.date.slice(0, 4) : '';
      if (year) metaParts.push(year);
      const cb = parseInt(a.citedby, 10);
      if (!isNaN(cb)) metaParts.push(`${cb} citation${cb !== 1 ? 's' : ''}`);
      return `data-tt-title="${esc(a.title || '(untitled)')}" data-tt-meta="${esc(metaParts.join(' · '))}" data-tt-role="${esc(roleText)}"`;
    };

    const draw = () => {
      const MAX_IN_PROJECT_ROW = 10;
      const citingShown  = citing.slice(0, MAX_IN_PROJECT_ROW);
      const citedByShown = citedBy.slice(0, MAX_IN_PROJECT_ROW);

      const hasExtCiting  = extCiting.length > 0;
      const hasExtCitedBy = extCitedBy.length > 0;
      const ROW_EXTRA = 120;
      const topExtra    = hasExtCiting  ? ROW_EXTRA : 0;
      const bottomExtra = hasExtCitedBy ? ROW_EXTRA : 0;

      const maxRowCount = Math.max(citingShown.length, citedByShown.length, extCiting.length, extCitedBy.length, 1);
      const W = Math.max(860, maxRowCount * 110);
      const H = 560 + topExtra + bottomExtra;
      const centerDefX = W / 2, centerDefY = topExtra + 280;
      const rowYExtTop    = 56;
      const rowYInTop     = topExtra + 110;
      const rowYInBottom  = H - bottomExtra - 110;
      const rowYExtBottom = H - 56;

      // Resolve a node's actual position: a dragged override if the user
      // moved it, otherwise the auto-layout default.
      const resolvePos = (a, key, defX, defY) => {
        const p = nodePositions.get(key);
        return { article: a, key, x: p ? p.x : defX, y: p ? p.y : defY };
      };

      const layoutRow = (items, y, keyPrefix) => {
        const n = items.length;
        if (!n) return [];
        const margin = 110;
        const usable = W - margin * 2;
        return items.map((it, i) => {
          const defX = n === 1 ? W / 2 : margin + (usable * i) / (n - 1);
          return resolvePos(it, keyOf(it, `${keyPrefix}:${i}`), defX, y);
        });
      };

      const citingPos      = layoutRow(citingShown, rowYInTop, 'in-citing');
      const citedByPos      = layoutRow(citedByShown, rowYInBottom, 'in-citedby');
      const extCitingPos   = hasExtCiting  ? layoutRow(extCiting, rowYExtTop, 'ext-citing')     : [];
      const extCitedByPos  = hasExtCitedBy ? layoutRow(extCitedBy, rowYExtBottom, 'ext-citedby') : [];
      const centerPos = (() => {
        const p = nodePositions.get('center');
        return { x: p ? p.x : centerDefX, y: p ? p.y : centerDefY };
      })();

      const nodeHTML = (pos, roleClass, isTop, external) => {
        const a = pos.article;
        const hex = external ? 'var(--text-faint)' : (tagColor(projectData, a.color) || 'var(--text-faint)');
        const label = formatAuthorLabel(a);
        const year = a.date ? a.date.slice(0, 4) : '';
        const allLines = year ? [label, year] : [label];
        const n = allLines.length;
        const href = external ? externalArticleHref(a) : null;
        const roleText = external
          ? (roleClass === 'network-citing' ? 'External — the central article cites this work' : 'External — this work cites the central article')
          : (roleClass === 'network-citing' ? 'The central article cites this work' : 'This work cites the central article');

        // rank 0 = nearest the circle. For top nodes that's the LAST line
        // (the year) so reading top-to-bottom still hits the name before
        // the year; for bottom nodes it's the FIRST line, since the block
        // grows downward away from the circle.
        const textEls = allLines.map((line, i) => {
          const rank = isTop ? (n - 1 - i) : i;
          const yMag = (R + GAP) + rank * LINE_H;
          const y = isTop ? -yMag : yMag;
          const isYearLine = !!year && i === n - 1;
          const arrow = (!isYearLine && external) ? ' ↗' : '';
          return `<text class="${isYearLine ? 'network-node-year' : 'network-node-label'}" y="${y}" text-anchor="middle">${esc(line)}${arrow}</text>`;
        }).join('');

        return `
          <g class="network-node ${roleClass}${external ? ' network-external' : ''}" data-key="${esc(pos.key)}"
             ${external ? '' : `data-eid="${esc(a.eid || a._id || '')}"`}
             ${external && href ? `data-href="${esc(href)}"` : ''}
             ${tooltipAttrs(a, roleText)}
             transform="translate(${pos.x},${pos.y})">
            <circle class="network-node-hit" r="${R + 9}" fill="transparent"></circle>
            <circle r="${R}" fill="${esc(hex)}" stroke="var(--surface)" stroke-width="2"></circle>
            ${textEls}
          </g>`;
      };

      const edgeHTML = (fromKey, toKey, x1, y1, x2, y2, kind, external) =>
        `<line class="network-edge network-edge-${kind}${external ? ' network-edge-external' : ''}" data-from="${esc(fromKey)}" data-to="${esc(toKey)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#network-arrow-${kind})"></line>`;

      const edgesHTML = [
        ...citingPos.map(pos => edgeHTML('center', pos.key, centerPos.x, centerPos.y, pos.x, pos.y, 'cites', false)),
        ...citedByPos.map(pos => edgeHTML(pos.key, 'center', pos.x, pos.y, centerPos.x, centerPos.y, 'citedby', false)),
        ...extCitingPos.map(pos => edgeHTML('center', pos.key, centerPos.x, centerPos.y, pos.x, pos.y, 'cites', true)),
        ...extCitedByPos.map(pos => edgeHTML(pos.key, 'center', pos.x, pos.y, centerPos.x, centerPos.y, 'citedby', true)),
      ].join('');

      const centerHex = tagColor(projectData, article.color) || 'var(--accent)';
      const centerLabel = formatAuthorLabel(article);
      const centerYear = article.date ? article.date.slice(0, 4) : '';
      const centerLines = centerYear ? [centerLabel, centerYear] : [centerLabel];
      const centerTextEls = centerLines.map((line, i) => {
        const y = (CENTER_R + GAP + 3) + i * (LINE_H + 3);
        const cls = (centerYear && i === centerLines.length - 1) ? 'network-node-year' : 'network-node-label network-center-label';
        return `<text class="${cls}" y="${y}" text-anchor="middle">${esc(line)}</text>`;
      }).join('');

      // Auto-fit once (first draw, or right after navigating to a
      // different article) so everything starts visible; afterward the
      // user's own pan/zoom/drag state is left alone by re-draws (loading
      // external data, etc.) — nothing snaps back underneath them.
      if (!viewFitted) {
        const PAD = 90;
        const allPos = [centerPos, ...citingPos, ...citedByPos, ...extCitingPos, ...extCitedByPos];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of allPos) {
          minX = Math.min(minX, p.x - PAD); maxX = Math.max(maxX, p.x + PAD);
          minY = Math.min(minY, p.y - PAD); maxY = Math.max(maxY, p.y + PAD);
        }
        const worldW = Math.max(1, maxX - minX), worldH = Math.max(1, maxY - minY);
        zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(REF_W / worldW, REF_H / worldH, 1.2)));
        pan = { x: REF_W / 2 - ((minX + maxX) / 2) * zoomLevel, y: REF_H / 2 - ((minY + maxY) / 2) * zoomLevel };
        viewFitted = true;
      }

      const svg = `
        <svg viewBox="0 0 ${REF_W} ${REF_H}" class="network-svg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <marker id="network-arrow-cites" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" class="network-arrowhead-cites"></path>
            </marker>
            <marker id="network-arrow-citedby" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" class="network-arrowhead-citedby"></path>
            </marker>
          </defs>
          <g class="network-viewport" transform="translate(${pan.x},${pan.y}) scale(${zoomLevel})">
            ${edgesHTML}
            ${citingPos.map(pos => nodeHTML(pos, 'network-citing', true, false)).join('')}
            ${citedByPos.map(pos => nodeHTML(pos, 'network-citedby', false, false)).join('')}
            ${extCitingPos.map(pos => nodeHTML(pos, 'network-citing', true, true)).join('')}
            ${extCitedByPos.map(pos => nodeHTML(pos, 'network-citedby', false, true)).join('')}
            <g class="network-node network-center" data-key="center"
               ${tooltipAttrs(article, 'The central article')}
               transform="translate(${centerPos.x},${centerPos.y})">
              <circle class="network-node-hit" r="${CENTER_R + 9}" fill="transparent"></circle>
              <circle r="${CENTER_R}" fill="${esc(centerHex)}" stroke="var(--accent)" stroke-width="3"></circle>
              ${centerTextEls}
            </g>
          </g>
        </svg>`;

      // Always spelled out as "shown of total" — ambiguous bare counts were
      // the #1 point of confusion (no way to tell if e.g. "Cites (3)" was
      // everything or just the first page of a longer list).
      const citingLabel  = citingShown.length < citing.length  ? `${citingShown.length} of ${citing.length}`  : `${citing.length}`;
      const citedByLabel = citedByShown.length < citedBy.length ? `${citedByShown.length} of ${citedBy.length}` : `${citedBy.length}`;
      const legendHTML = `
        <div class="network-legend">
          <span class="network-legend-item"><span class="network-legend-dot network-legend-dot-citing"></span>Cites: ${citingLabel} in this project${hasExtCiting ? ` + ${extCiting.length} external` : ''}</span>
          <span class="network-legend-item"><span class="network-legend-dot network-legend-dot-citedby"></span>Cited by: ${citedByLabel} in this project${hasExtCitedBy ? ` + ${extCitedBy.length} external` : ''}</span>
        </div>`;

      const emptyNote = (!citing.length && !citedBy.length && !hasExtCiting && !hasExtCitedBy)
        ? `<p class="network-empty-note">No citation links to other articles in this project were found for this article.</p>`
        : '';

      const loadButtonsHTML = isOpenAlex ? `
        <div class="network-load-row">
          ${canLoadRefs ? `<button type="button" class="btn-secondary network-load-btn" id="network-load-refs" ${extRefsDone ? 'disabled' : ''}>${loadingRefs ? 'Loading…' : extRefsDone ? 'No more external references' : (hasExtCiting ? 'Load more external references' : 'Load external references')}</button>` : ''}
          ${canLoadCites ? `<button type="button" class="btn-secondary network-load-btn" id="network-load-cites" ${extCitesDone ? 'disabled' : ''}>${loadingCites ? 'Loading…' : extCitesDone ? 'No more external citations' : (hasExtCitedBy ? 'Load more external citations' : 'Load external citations')}</button>` : ''}
        </div>` : '';

      overlay.classList.remove('hidden');
      overlay.innerHTML = `
        <div class="modal modal-network" role="dialog" aria-modal="true" aria-labelledby="network-modal-title">
          <div class="modal-header">
            <div>
              <h3 id="network-modal-title">Citation Network</h3>
              <p class="modal-subtitle">${esc(truncateLabel(article.title, 80))}</p>
            </div>
            <div class="network-header-actions">
              <button class="icon-btn" id="network-fit-btn" title="Reset pan/zoom" aria-label="Reset pan/zoom">${SLRIcons.refresh}</button>
              <button class="icon-btn" id="network-download-btn" title="Download as PNG" aria-label="Download as PNG">${SLRIcons.download}</button>
              <button class="icon-btn" id="network-modal-close" aria-label="Close">${SLRIcons.close}</button>
            </div>
          </div>
          <div class="modal-body">
            ${legendHTML}
            <div class="network-canvas">${svg}</div>
            ${emptyNote}
            ${loadButtonsHTML}
            ${loadError ? `<p class="network-error-note">${esc(loadError)}</p>` : ''}
            ${!emptyNote ? `<p class="network-hint">Drag the background to pan, scroll/pinch to zoom, drag a node to rearrange it. Click a solid node to explore its network — dashed nodes are external, click to open. Hover (or tap and hold) a node for details.</p>` : ''}
          </div>
          <div class="network-tooltip hidden" id="network-tooltip"></div>
        </div>`;

      const closeModal = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
      overlay.querySelector('#network-modal-close').addEventListener('click', closeModal);
      overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

      const svgEl = overlay.querySelector('.network-svg');
      const viewportG = overlay.querySelector('.network-viewport');

      overlay.querySelector('#network-fit-btn')?.addEventListener('click', () => {
        viewFitted = false; // next draw() recomputes the fit from current (possibly dragged) positions
        draw();
      });

      overlay.querySelector('#network-download-btn')?.addEventListener('click', async () => {
        if (!svgEl) return;
        try {
          const PAD = 90;
          const allNodes = svgEl.querySelectorAll('.network-node');
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          allNodes.forEach(g => {
            const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
            if (!m) return;
            const x = parseFloat(m[1]), y = parseFloat(m[2]);
            minX = Math.min(minX, x - PAD); maxX = Math.max(maxX, x + PAD);
            minY = Math.min(minY, y - PAD); maxY = Math.max(maxY, y + PAD);
          });
          const worldBBox = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
          await exportNetworkAsPNG(svgEl, worldBBox, article.title || 'citation-network');
        } catch (_) { SLRApp.showToast('Could not export network as PNG.', true); }
      });

      // ── Pan / zoom / node-drag — a single unified pointer-event pipeline.
      // A node click still navigates/opens a link, but only if the pointer
      // never moved past a small threshold; past that it's a drag instead,
      // which repositions the node (edges follow live) without touching
      // which nodes are connected to which — that never changes from this.
      if (svgEl && viewportG) {
        const screenToWorld = (clientX, clientY) => {
          const ctm = viewportG.getScreenCTM();
          if (!ctm) return { x: 0, y: 0 };
          const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
          return { x: p.x, y: p.y };
        };
        const applyViewportTransform = () => {
          viewportG.setAttribute('transform', `translate(${pan.x},${pan.y}) scale(${zoomLevel})`);
        };

        let nodeDrag = null;     // { key, el, startClientX, startClientY, moved, lastWorld }
        let panDrag = null;      // { startClientX, startClientY, startPan }
        const activePointers = new Map();
        let pinchStart = null;   // { dist, zoom, worldMid }
        const DRAG_THRESHOLD = 4;

        svgEl.addEventListener('pointerdown', e => {
          activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (activePointers.size === 2) {
            panDrag = null; nodeDrag = null;
            const pts = [...activePointers.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
            pinchStart = { dist: Math.max(1, dist), zoom: zoomLevel, worldMid: screenToWorld(midX, midY) };
            return;
          }
          const nodeEl = e.target.closest('.network-node');
          if (nodeEl) {
            nodeDrag = { key: nodeEl.dataset.key, el: nodeEl, startClientX: e.clientX, startClientY: e.clientY, moved: false, lastWorld: null };
          } else {
            panDrag = { startClientX: e.clientX, startClientY: e.clientY, startPan: { ...pan } };
            svgEl.classList.add('is-panning');
          }
          try { svgEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        });

        svgEl.addEventListener('pointermove', e => {
          if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

          if (activePointers.size === 2 && pinchStart) {
            const pts = [...activePointers.values()];
            const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
            const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStart.zoom * (dist / pinchStart.dist)));
            pan.x += pinchStart.worldMid.x * zoomLevel - pinchStart.worldMid.x * newZoom;
            pan.y += pinchStart.worldMid.y * zoomLevel - pinchStart.worldMid.y * newZoom;
            zoomLevel = newZoom;
            applyViewportTransform();
            return;
          }

          if (nodeDrag) {
            const dx = e.clientX - nodeDrag.startClientX, dy = e.clientY - nodeDrag.startClientY;
            if (!nodeDrag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) nodeDrag.moved = true;
            if (nodeDrag.moved) {
              const worldPt = screenToWorld(e.clientX, e.clientY);
              nodeDrag.el.setAttribute('transform', `translate(${worldPt.x},${worldPt.y})`);
              const k = CSS.escape(nodeDrag.key);
              svgEl.querySelectorAll(`[data-from="${k}"]`).forEach(edge => { edge.setAttribute('x1', worldPt.x); edge.setAttribute('y1', worldPt.y); });
              svgEl.querySelectorAll(`[data-to="${k}"]`).forEach(edge => { edge.setAttribute('x2', worldPt.x); edge.setAttribute('y2', worldPt.y); });
              nodeDrag.lastWorld = worldPt;
            }
            return;
          }

          if (panDrag) {
            pan.x = panDrag.startPan.x + (e.clientX - panDrag.startClientX);
            pan.y = panDrag.startPan.y + (e.clientY - panDrag.startClientY);
            applyViewportTransform();
          }
        });

        const endInteraction = e => {
          activePointers.delete(e.pointerId);
          if (activePointers.size < 2) pinchStart = null;

          if (nodeDrag) {
            if (nodeDrag.moved && nodeDrag.lastWorld) {
              nodePositions.set(nodeDrag.key, nodeDrag.lastWorld);
            } else {
              const eid = nodeDrag.el.dataset.eid;
              const href = nodeDrag.el.dataset.href;
              if (eid) {
                const next = articles.find(a => (a.eid || a._id) === eid);
                if (next) { try { svgEl.releasePointerCapture(e.pointerId); } catch (_) {} renderArticleNetworkModal(overlay, next, articles, projectData); return; }
              } else if (href) {
                window.open(href, '_blank', 'noopener');
              }
            }
            nodeDrag = null;
          }
          if (panDrag) { panDrag = null; svgEl.classList.remove('is-panning'); }
          try { svgEl.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        };
        svgEl.addEventListener('pointerup', endInteraction);
        svgEl.addEventListener('pointercancel', endInteraction);

        svgEl.addEventListener('wheel', e => {
          e.preventDefault();
          const worldPt = screenToWorld(e.clientX, e.clientY);
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomLevel * factor));
          pan.x += worldPt.x * zoomLevel - worldPt.x * newZoom;
          pan.y += worldPt.y * zoomLevel - worldPt.y * newZoom;
          zoomLevel = newZoom;
          applyViewportTransform();
        }, { passive: false });
      }

      // Hover card — desktop mouse only (mouseenter/mouseleave don't fire
      // usefully for touch, and clicking/dragging a touch node already
      // navigates, opens its link, or repositions it, so touch users rely
      // on the always-visible author+year labels instead of a hover card).
      const tooltip = overlay.querySelector('#network-tooltip');
      if (tooltip && svgEl) {
        svgEl.querySelectorAll('.network-node').forEach(node => {
          node.addEventListener('mouseenter', () => {
            tooltip.innerHTML = `
              <div class="network-tooltip-title">${esc(node.dataset.ttTitle || '')}</div>
              ${node.dataset.ttMeta ? `<div class="network-tooltip-meta">${esc(node.dataset.ttMeta)}</div>` : ''}
              <div class="network-tooltip-role">${esc(node.dataset.ttRole || '')}</div>`;
            tooltip.classList.remove('hidden');
          });
          node.addEventListener('mousemove', e => {
            const modalRect = overlay.querySelector('.modal-network').getBoundingClientRect();
            const ttRect = tooltip.getBoundingClientRect();
            let left = e.clientX - modalRect.left + 16;
            let top  = e.clientY - modalRect.top + 16;
            if (left + ttRect.width > modalRect.width)  left = e.clientX - modalRect.left - ttRect.width - 16;
            if (top + ttRect.height > modalRect.height) top  = e.clientY - modalRect.top - ttRect.height - 16;
            tooltip.style.left = `${Math.max(4, left)}px`;
            tooltip.style.top  = `${Math.max(4, top)}px`;
          });
          node.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
        });
      }

      const refsBtn = overlay.querySelector('#network-load-refs');
      if (refsBtn) refsBtn.addEventListener('click', async () => {
        if (loadingRefs || extRefsDone) return;
        loadingRefs = true; loadError = ''; draw();
        try {
          const res = await SLRApp.loadExternalReferences(article.eid, extRefsOffset);
          extCiting = extCiting.concat(res.items);
          extRefsOffset = res.nextOffset;
          extRefsDone = res.nextOffset === null;
        } catch (_) {
          loadError = 'Could not load external references — please try again.';
        } finally {
          loadingRefs = false; draw();
        }
      });

      const citesBtn = overlay.querySelector('#network-load-cites');
      if (citesBtn) citesBtn.addEventListener('click', async () => {
        if (loadingCites || extCitesDone) return;
        loadingCites = true; loadError = ''; draw();
        try {
          const res = await SLRApp.loadExternalCitations(article.eid, extCitesPage);
          extCitedBy = extCitedBy.concat(res.items);
          extCitesPage += 1;
          extCitesDone = !res.hasMore;
        } catch (_) {
          loadError = 'Could not load external citations — please try again.';
        } finally {
          loadingCites = false; draw();
        }
      });
    };

    draw();
  }

  //  Generic read-only list modal — used by the PRISMA diagram to show which
  //  records sit behind a given box/connector (duplicates, excluded records,
  //  search queries) without needing a dedicated view for each.
  function renderPrismaDetailModal(overlay, { title, subtitle, bodyHTML }) {
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="modal modal-prisma-detail" role="dialog" aria-modal="true" aria-labelledby="prisma-modal-title">
        <div class="modal-header">
          <div>
            <h3 id="prisma-modal-title">${esc(title)}</h3>
            ${subtitle ? `<p class="modal-subtitle">${esc(subtitle)}</p>` : ''}
          </div>
          <button class="icon-btn" id="prisma-modal-close" aria-label="Close">${SLRIcons.close}</button>
        </div>
        <div class="modal-body modal-body-scroll">${bodyHTML}</div>
      </div>`;
    const closeModal = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
    overlay.querySelector('#prisma-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  }

  //  New Project modal

  function renderNewProjectModal(overlay) {
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header">
          <h3 id="modal-title">New Project</h3>
          <button class="icon-btn" id="modal-close" aria-label="Close">${SLRIcons.close}</button>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label for="new-proj-name">Project Name</label>
            <input class="form-input" id="new-proj-name" type="text" placeholder="My SLR" maxlength="80" autofocus>
          </div>
          <div class="form-field">
            <label for="new-proj-desc">Description (optional)</label>
            <input class="form-input" id="new-proj-desc" type="text" placeholder="Short description" maxlength="200">
          </div>
        </div>
        <div class="modal-error" id="modal-error"></div>
        <div class="modal-footer">
          <button class="btn-secondary" id="modal-cancel">Cancel</button>
          <button class="btn-primary"   id="modal-create">Create Project</button>
        </div>
      </div>`;

    const closeModal = () => {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    };

    overlay.querySelector('#modal-close').addEventListener('click',  closeModal);
    overlay.querySelector('#modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    overlay.querySelector('#modal-create').addEventListener('click', async () => {
      const name = overlay.querySelector('#new-proj-name').value.trim();
      const desc = overlay.querySelector('#new-proj-desc').value.trim();
      const err  = overlay.querySelector('#modal-error');
      if (!name) {
        err.textContent = 'Project name is required.';
        err.classList.add('visible');
        return;
      }
      err.classList.remove('visible');
      overlay.querySelector('#modal-create').disabled = true;
      try {
        await SLRApp.createProject(name, desc);
        closeModal();
      } catch (e) {
        err.textContent = e.message || String(e);
        err.classList.add('visible');
        overlay.querySelector('#modal-create').disabled = false;
      }
    });

    overlay.querySelector('#new-proj-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') overlay.querySelector('#modal-create').click();
    });
  }

  //  Supabase sign-in modal

  // Reachable directly from the Welcome screen's Sign Up / Log In buttons,
  // so account creation and every later login happen on Home instead of
  // requiring a trip to Settings. Project URL/key are no longer entered
  // here — this app's own Supabase project is the default (see
  // data-supabase.js); Settings → Cloud Sync remains where that can be
  // overridden for anyone self-hosting against their own project instead.
  function renderSupabaseAuthModal(overlay, initialMode) {
    let mode = initialMode === 'signup' ? 'signup' : 'signin';
    const labelFor = m => m === 'signup' ? 'Sign Up' : 'Log In';

    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="supabase-modal-title">
        <div class="modal-header">
          <h3 id="supabase-modal-title">${labelFor(mode)}</h3>
          <button class="icon-btn" id="supabase-modal-close" aria-label="Close">${SLRIcons.close}</button>
        </div>
        <div class="modal-body">
          ${renderSupabaseDevNotice()}
          <form id="supabase-modal-form" autocomplete="on">
            <div class="form-field">
              <label for="supabase-modal-email">Email</label>
              <input class="form-input" id="supabase-modal-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" autofocus>
            </div>
            <div class="form-field">
              <label for="supabase-modal-password">Password</label>
              <div class="secret-input-row">
                <input class="form-input" id="supabase-modal-password" name="password" type="password"
                  placeholder="Password" autocomplete="current-password">
                <button class="btn-secondary secret-toggle-btn" type="button" data-target="supabase-modal-password" aria-label="Show password" aria-pressed="false">
                  <span class="secret-toggle-icon">${SLRIcons.eye}</span>
                  <span class="secret-toggle-label">Show</span>
                </button>
              </div>
            </div>
          </form>
          <button type="button" class="link-btn" id="supabase-modal-switch-mode"></button>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
            <button type="button" class="link-btn" id="supabase-modal-magiclink-btn">Email me a magic link instead</button>
            <button type="button" class="link-btn" id="supabase-modal-resend-btn">Resend confirmation email</button>
          </div>
          <div id="supabase-modal-result" class="scopus-test-result" hidden></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" type="button" id="supabase-modal-cancel">Cancel</button>
          <button class="btn-primary" type="submit" form="supabase-modal-form" id="supabase-modal-submit">${labelFor(mode)}</button>
        </div>
      </div>`;

    const closeModal = () => {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    };

    overlay.querySelector('#supabase-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('#supabase-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    overlay.querySelectorAll('.secret-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = overlay.querySelector(`#${btn.dataset.target}`);
        if (!input) return;
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        btn.setAttribute('aria-pressed', visible ? 'false' : 'true');
        btn.setAttribute('aria-label', visible ? 'Show' : 'Hide');
        const icon = btn.querySelector('.secret-toggle-icon');
        const label = btn.querySelector('.secret-toggle-label');
        if (icon) icon.innerHTML = visible ? SLRIcons.eye : SLRIcons.eyeOff;
        if (label) label.textContent = visible ? 'Show' : 'Hide';
      });
    });

    const resultEl  = overlay.querySelector('#supabase-modal-result');
    const resendBtn = overlay.querySelector('#supabase-modal-resend-btn');
    function showResult(message, isError) {
      resultEl.hidden = false;
      resultEl.textContent = message;
      resultEl.classList.toggle('scopus-test-fail', !!isError);
      resultEl.classList.toggle('scopus-test-ok', !isError);
    }

    const titleEl  = overlay.querySelector('#supabase-modal-title');
    const submitEl = overlay.querySelector('#supabase-modal-submit');
    const switchEl = overlay.querySelector('#supabase-modal-switch-mode');
    function updateModeUI() {
      titleEl.textContent  = labelFor(mode);
      submitEl.textContent = labelFor(mode);
      switchEl.textContent = mode === 'signup' ? 'Already have an account? Log In' : "Don't have an account? Sign Up";
    }
    updateModeUI();
    switchEl.addEventListener('click', () => {
      mode = mode === 'signup' ? 'signin' : 'signup';
      updateModeUI();
      resultEl.hidden = true;
    });

    const allButtons = () => overlay.querySelectorAll('.modal-footer button, #supabase-modal-magiclink-btn, #supabase-modal-resend-btn');

    async function handleAuth(action) {
      const email = overlay.querySelector('#supabase-modal-email').value.trim();
      const password = overlay.querySelector('#supabase-modal-password').value;

      if (!email) { showResult('Enter an email.', true); return; }
      if (action !== 'magiclink' && !password) { showResult('Enter a password.', true); return; }

      const buttons = [...allButtons()];
      buttons.forEach(b => b.disabled = true);
      try {
        if (action === 'magiclink') {
          await SLRDataCloud.signInWithMagicLink(email);
          showResult('Magic link sent — check your email.', false);
        } else if (action === 'signup') {
          const result = await SLRApp.cloudAuth('signup', email, password);
          if (result && result.confirmed === false) {
            showResult('Account created — check your email to confirm it, then log in.', false);
          } else {
            closeModal();
            return;
          }
        } else {
          await SLRApp.cloudAuth('signin', email, password);
          closeModal();
          return;
        }
      } catch (err) {
        showResult(describeAuthError(err, action === 'signup' ? 'signup' : 'signin'), true);
      } finally {
        buttons.forEach(b => b.disabled = false);
      }
    }

    // Submit is type="submit" (associated via form="supabase-modal-form"),
    // so both a click and pressing Enter in the email/password fields route
    // through this one submit handler — which is also the signal password
    // managers watch for to offer saving the credentials just entered.
    overlay.querySelector('#supabase-modal-form').addEventListener('submit', e => {
      e.preventDefault();
      handleAuth(mode);
    });
    overlay.querySelector('#supabase-modal-magiclink-btn').addEventListener('click', () => handleAuth('magiclink'));

    resendBtn.addEventListener('click', async () => {
      const email = overlay.querySelector('#supabase-modal-email').value.trim();
      if (!email) { showResult('Enter an email first.', true); return; }
      resendBtn.disabled = true;
      try {
        await SLRDataCloud.resendConfirmation(email);
        showResult('Confirmation email resent — check your inbox.', false);
      } catch (err) {
        showResult(err.message || String(err), true);
      } finally {
        resendBtn.disabled = false;
      }
    });

  }

  //  Module export

  return {
    renderWelcome,
    renderProjects,
    renderArticles,
    renderHistory,
    renderLoading,
    renderError,
    renderCorpus,
    renderSelected,
    renderVisualizations,
    renderDatabases,
    renderSearch,
    renderSettings,
    renderAbout,
    renderPrivacy,
    renderTags,
    renderAutoTagRules,
    renderNewProjectModal,
    renderSupabaseAuthModal,
    renderArticleNetworkModal,
  };

})();
