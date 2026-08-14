/**
 * SLR Harvester Web  View Renderers
 * All functions that build HTML and attach events for each view.
 * Reads from SLRApp.state, SLRData, SLRIcons.
 *
 * Global: window.SLRViews
 */

window.SLRViews = (() => {

  const TAG_FILTER_NONE = '__none__';

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

  //  Welcome view

  function renderWelcome(container) {
    const supported = typeof window.showDirectoryPicker === 'function';

    // Same message everywhere the File System Access API is missing — mobile
    // browsers included, since none of them implement it either. Local
    // Folder specifically; Supabase works regardless.
    const compatMessage = `<strong>Local Folder isn't supported in this browser.</strong>
         It requires <strong>Chrome 86+ or Edge 86+ on desktop</strong> for the File
         System Access API — Firefox and Safari (desktop) don't support it, and
         neither does any mobile browser. Use <strong>Continue with Supabase</strong>
         below instead.`;

    container.innerHTML = `
      <div class="welcome-view" id="home">
        <canvas id="heroParticles" class="hero-particles-canvas" aria-hidden="true"></canvas>
        <div class="welcome-hero">
          <div class="welcome-logo">${SLRIcons.logo}</div>
          <h1>SLR Harvester <span class="title-web">Web</span></h1>
          <p>A browser tool for managing
             <span style="white-space:nowrap">Systematic Literature Reviews</span>.<br>
             Connect a workspace below to get started.</p>
        </div>

        <div class="welcome-actions">
          <button id="welcome-cloud-btn" class="btn-primary">
            ${SLRIcons.supabaseLogo}
            Continue with Supabase
          </button>
          <button id="welcome-open-btn" class="btn-secondary">
            ${SLRIcons.folderOpen}
            Continue with Local Folder
          </button>
        </div>

        <div class="welcome-tips">
          <p><strong>On mobile, or Firefox/Safari?</strong> Local Folder needs the
          File System Access API, which isn't available there — use
          <strong>Supabase</strong> instead: it syncs your projects through your own
          Supabase project and works in any browser.</p>
          <p><strong>First time with Local Folder?</strong> Click the button above,
          then create a new, empty folder in the picker dialog (any name works, e.g.
          <code>SLR-Harvester-Data</code>) and select it. The app sets everything up
          the moment you create your first project — nothing is written until then.</p>
          <p><strong>Already have local data?</strong> Select the folder that contains
          <code>projects.json</code> and the <code>projects/</code> directory - your existing
          SLR Harvester workspace. Works with local folders and cloud-synced drives
          (OneDrive, Google Drive) alike.</p>
          <div class="welcome-compat-notice" id="welcome-compat-notice" hidden>
            ${SLRIcons.warning}
            <span>${compatMessage}</span>
          </div>
        </div>
      </div>`;

    container.querySelector('#welcome-open-btn').addEventListener('click', () => {
      if (supported) {
        SLRApp.openFolder();
      } else {
        const notice = container.querySelector('#welcome-compat-notice');
        if (notice) notice.hidden = false;
      }
    });

    container.querySelector('#welcome-cloud-btn').addEventListener('click', () => {
      SLRApp.showSupabaseAuthModal();
    });

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
      case 'newest':
      default:       return list.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    }
  }

  function renderProjects(container, projectsIn, currentFolder, allProjectData, sort) {
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

      return `
        <div class="project-card ${active ? 'active' : ''}"
             data-folder="${esc(p.workspace_folder)}">
          <div class="project-card-header">
            <div>
              <div class="project-card-name">${esc(p.name)}</div>
              <div class="project-card-date">Created ${esc(p.created)}</div>
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
                <strong>${nQueries}</strong> quer${nQueries !== 1 ? 'ies' : 'y'}
              </span>
              <span class="stat-chip">
                ${SLRIcons.search}
                <strong>${nTerms}</strong> term${nTerms !== 1 ? 's' : ''}
              </span>
              <span class="stat-chip">
                ${SLRIcons.articles}
                <strong>${stats.total}</strong> articles
              </span>
              <span class="stat-chip">
                ${SLRIcons.tag}
                <strong>${nTags}</strong> tag${nTags !== 1 ? 's' : ''} in use
              </span>
              <span class="stat-chip selected">
                ${SLRIcons.selected}
                <strong>${stats.selected}</strong> selected
              </span>
              <span class="stat-chip corpus">
                ${SLRIcons.corpus}
                <strong>${stats.corpus}</strong> corpus
              </span>
            </div>` : `
            <div class="project-card-stats">
              <span class="stat-chip">${SLRIcons.refresh} Loading...</span>
            </div>`}

          <button class="open-project-btn" data-folder="${esc(p.workspace_folder)}">
            ${SLRIcons.chevronRight}
            ${active ? 'Current project' : 'Open project'}
          </button>
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
    const actionsVisible = !!SLRApp.state.actionsBarVisible;

    const tagBreakdownHTML = buildTagBreakdownHTML(articles, projectData, filter.tag);

    // Build article HTML
    const listHTML = !projectData
      ? renderNoProjectNotice()
      : filtered.length === 0
      ? `<div class="article-list-empty">
           ${SLRIcons.articles}
           <p>No articles match the current filters.</p>
         </div>`
      : filtered.map(a => articleItemHTML(a, projectData)).join('');

    container.innerHTML = `
      <div class="articles-view">

        <div class="corpus-banner">
          <span class="corpus-banner-stat">
            ${SLRIcons.articles}
            <strong>${totalAll}</strong> article${totalAll !== 1 ? 's' : ''} total
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.selected}
            <strong>${totalSelected}</strong> selected
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.corpus}
            <strong>${totalCorpus}</strong> in corpus
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.tag}
            <strong>${totalTagged}</strong> tag${totalTagged !== 1 ? 's' : ''} used
          </span>
        </div>

        ${tagBreakdownHTML ? `<div class="corpus-tag-breakdown">${tagBreakdownHTML}</div>` : ''}

        ${buildListToolbarHTML({
          searchId: 'list-search', searchValue: filter.search,
          sortId: 'list-sort', sortValue: filter.sort,
          yearFromId: 'list-year-from', yearFromValue: filter.yearFrom,
          yearToId: 'list-year-to', yearToValue: filter.yearTo,
          tagFilterId: 'list-tag-filter', tagFilterValue: filter.tag,
          tagOptionsHTML: buildTagOptions(articles, projectData, filter.tag),
          actionsVisible,
          exportTitle: 'Download current list as .bib, .ris, or .csv',
        })}

        <div class="articles-stats">
          <span>Showing <strong>${filtered.length}</strong> of <strong>${totalAll}</strong></span>
          <span class="stats-sep">|</span>
          <span><strong>${totalSelected}</strong> selected</span>
          <span class="stats-sep">|</span>
          <span><strong>${totalCorpus}</strong> in corpus</span>
        </div>

        <div class="article-list" id="article-list">
          ${listHTML}
        </div>
      </div>`;

    // Tag chip filter
    container.querySelectorAll('.corpus-tag-breakdown .corpus-tag-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tag;
        SLRApp.setFilter({ tag: filter.tag === t ? null : t });
      });
    });

    wireListToolbar(container, {
      onFilter: patch => SLRApp.setFilter(patch),
      onExport: () => {
        const exportBtn = container.querySelector('#export-list-btn');
        openExportMenu(exportBtn, filtered, 'articles');
      },
    });

    // Expand/collapse articles
    container.querySelector('#article-list').addEventListener('click', e => {
      const item = e.target.closest('.article-item');
      if (!item) return;
      if (e.target.tagName === 'A') return;
      if (e.target.closest('[data-action]')) return;
      if (e.target.closest('.article-id-copy')) return;
      item.classList.toggle('expanded');
    });
    wireArticleActions(container.querySelector('#article-list'), projectData);
  }

  function articleItemHTML(a, projectData) {
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

    const affiliationCountries = getAffiliationCountries(a);
    const affiliationCountryDetail = affiliationCountries.length
      ? `<div class="article-detail-meta article-affiliation-countries"><span class="article-detail-label">Affiliation countries:</span><span class="article-detail-value">${affiliationCountries.map(country => `<span class="article-country-item"><span class="article-country-flag" aria-hidden="true">${esc(country.flag)}</span><span>${esc(country.name)}</span></span>`).join('<span class="article-country-sep">,</span> ')}</span></div>`
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

    return `
      <div class="article-item" ${styleAttr}
           data-eid="${esc(a.eid || a._id || '')}"
           data-selected="${a.selected ? 'true' : 'false'}"
           data-corpus="${a.corpus ? 'true' : 'false'}">
        <div class="article-item-header">
          <div class="article-main">
            <div class="article-title">${esc(a.title)}</div>
            <div class="article-meta">
              ${a.authors ? `<span>${esc(a.authors)}</span><span class="meta-sep">&middot;</span>` : ''}
              ${a.publicationName ? `<span>${esc(a.publicationName)}</span><span class="meta-sep">&middot;</span>` : ''}
              ${year ? `<span>${esc(year)}</span><span class="meta-sep">&middot;</span>` : ''}
              <span>${a.citedby || 0} cited</span>
            </div>
            <div class="article-tag-row">
              <span class="article-tag-row-indicators">
                <span class="abstract-indicator ${a.abstract ? 'has-abstract' : 'no-abstract'}"
                      title="${a.abstract ? 'Abstract available' : 'No abstract'}">
                  ${a.abstract ? SLRIcons.eye : SLRIcons.eyeOff}
                </span>
                ${affiliationBadge}
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
          </div>
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
        </div>

        <div class="article-detail">
          ${abstract}
          ${affiliationCountryDetail}
          ${idRow}
          ${comment}
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
      const item = btn.closest('.article-item');
      const eid  = item ? item.dataset.eid : null;
      if (!eid) return;
      const action = btn.dataset.action;
      if (action === 'toggle-selected') {
        SLRApp.updateAnnotation(eid, { selected: item.dataset.selected !== 'true' });
      } else if (action === 'toggle-corpus') {
        SLRApp.updateAnnotation(eid, { corpus: item.dataset.corpus !== 'true' });
      } else if (action === 'open-tag-picker') {
        openTagPickerPopup(btn, eid, projectData);
      }
    });
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

  function openExportMenu(triggerEl, articles, scopeLabel) {
    document.querySelector('.export-menu-popup')?.remove();
    const popup = document.createElement('div');
    popup.className = 'export-menu-popup';
    popup.innerHTML = `
      <button class="export-menu-item" data-format="bib">${SLRIcons.download}<span>Download .bib</span></button>
      <button class="export-menu-item" data-format="ris">${SLRIcons.download}<span>Download .ris</span></button>
      <button class="export-menu-item" data-format="csv">${SLRIcons.download}<span>Download .csv</span></button>`;
    document.body.appendChild(popup);

    const rect = triggerEl.getBoundingClientRect();
    const estimatedH = 34 * 3 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < estimatedH && rect.top > estimatedH) {
      popup.style.top = (rect.top - estimatedH - 4) + 'px';
    } else {
      popup.style.top = (rect.bottom + 4) + 'px';
    }
    popup.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';

    popup.addEventListener('click', ev => {
      const item = ev.target.closest('.export-menu-item');
      if (!item) return;
      exportArticleList(articles, item.dataset.format, scopeLabel);
      popup.remove();
    });

    const closeHandler = ev => {
      if (!popup.contains(ev.target) && ev.target !== triggerEl) {
        popup.remove();
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
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

  function buildTagOptions(articles, projectData, activeTag) {
    const tagSet = new Set();
    let hasUntagged = false;
    for (const a of articles) {
      if (a.tag && a.tag !== 'None') {
        tagSet.add(a.tag);
      } else {
        hasUntagged = true;
      }
    }
    const options = [];
    if (hasUntagged || activeTag === TAG_FILTER_NONE) {
      options.push(`<option value="${TAG_FILTER_NONE}" ${activeTag === TAG_FILTER_NONE ? 'selected' : ''}>None (untagged)</option>`);
    }
    options.push(...Array.from(tagSet).sort().map(t => {
      const sel = t === activeTag ? 'selected' : '';
      return `<option value="${esc(t)}" ${sel}>${esc(t)}</option>`;
    }));
    return options.join('');
  }

  function applyFilter(articles, filter, projectData) {
    let list = articles;

    // Mode
    if (filter.mode === 'selected') list = list.filter(a => a.selected);
    if (filter.mode === 'corpus')   list = list.filter(a => a.corpus);

    // Tag
    if (filter.tag === TAG_FILTER_NONE) {
      list = list.filter(a => !a.tag || a.tag === 'None');
    } else if (filter.tag) {
      list = list.filter(a => a.tag === filter.tag);
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

    // Search
    if (filter.search) {
      const terms = String(filter.search)
        .split(';')
        .map(term => term.trim().toLowerCase())
        .filter(Boolean);
      if (terms.length > 0) {
        list = list.filter(a => {
          const searchableText = [a.title || '', a.abstract || '', a.publicationName || '']
            .join(' ')
            .toLowerCase();
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

  // Tag chips-with-counts row, shared by Articles / Selected / Corpus
  function buildTagBreakdownHTML(list, projectData, activeTag) {
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
        const active = activeTag === t ? 'active' : '';
        return `<button class="corpus-tag-chip ${active}" data-tag="${esc(t)}"
                        ${hexVal ? `style="--tag-color:${esc(hexVal)}"` : ''}>
                  <span class="tag-dot" ${hexVal ? `style="background:${esc(hexVal)}"` : ''}></span>
                  ${esc(t)}
                  <span class="chip-count">${n}</span>
                </button>`;
      }).join('');

    const untaggedCount = list.filter(a => !a.tag || a.tag === 'None').length;
    const noneChip = untaggedCount > 0
      ? `<button class="corpus-tag-chip ${activeTag === TAG_FILTER_NONE ? 'active' : ''}" data-tag="${TAG_FILTER_NONE}">
           <span class="tag-dot tag-dot-empty"></span>
           None
           <span class="chip-count">${untaggedCount}</span>
         </button>`
      : '';

    return [noneChip, chips].filter(Boolean).join('');
  }

  // Toolbar markup shared by Articles / Selected / Corpus: a search row, a
  // sort/year/tag-filter row, and a hideable row of bulk-action buttons.
  function buildListToolbarHTML(opts) {
    const {
      searchId, searchValue,
      sortId, sortValue,
      yearFromId, yearFromValue, yearToId, yearToValue,
      tagFilterId, tagFilterValue, tagOptionsHTML,
      actionsVisible, exportTitle,
    } = opts;

    return `
      <div class="list-toolbar">
        <div class="list-toolbar-row">
          <div class="search-input-wrap">
            ${SLRIcons.search}
            <input class="search-input" id="${searchId}"
                   type="text" placeholder="Search title, abstract, journal (use ; for AND)"
                   value="${esc(searchValue)}" autocomplete="off">
          </div>
          <button class="list-toolbar-toggle ${actionsVisible ? 'active' : ''}" id="list-actions-toggle"
                  title="Show/hide action buttons" aria-label="Toggle action buttons" aria-expanded="${actionsVisible ? 'true' : 'false'}">
            ${SLRIcons.menu}
          </button>
        </div>

        <div class="list-toolbar-row">
          <select class="filter-select" id="${sortId}" title="Sort order">
            <option value="newest" ${sortValue==='newest'?'selected':''}>Newest first</option>
            <option value="oldest" ${sortValue==='oldest'?'selected':''}>Oldest first</option>
            <option value="cited"  ${sortValue==='cited' ?'selected':''}>Most cited</option>
            <option value="title"  ${sortValue==='title' ?'selected':''}>Title A-Z</option>
          </select>

          <div class="filter-year-wrap">
            <input class="year-input" id="${yearFromId}" type="number"
                   placeholder="From" min="1900" max="2100" value="${esc(yearFromValue)}">
                 <span>-</span>
            <input class="year-input" id="${yearToId}" type="number"
                   placeholder="To" min="1900" max="2100" value="${esc(yearToValue)}">
          </div>

          <select class="filter-select" id="${tagFilterId}" title="Filter by tag">
            <option value="">All tags</option>
            ${tagOptionsHTML}
          </select>
        </div>

        <div class="list-toolbar-actions${actionsVisible ? '' : ' hidden'}" id="list-actions-panel">
          <button class="articles-action-btn" id="autotag-btn"
                  title="Auto-tag untagged articles by journal name">
            ${SLRIcons.tag} Auto-tag
          </button>
          <button class="articles-action-btn articles-action-btn--warn" id="force-autotag-btn"
                  title="Reset all tags and re-run auto-tag on every article">
            ${SLRIcons.tag} Force Auto-tag
          </button>
          <button class="articles-action-btn" id="fetch-abstracts-btn"
                  title="Fetch missing abstracts via DOI (Crossref)">
            ${SLRIcons.eye} Fetch Abstracts
          </button>
          <button class="articles-action-btn" id="fetch-authors-btn"
              title="Fetch full author lists via DOI (Crossref) - Scopus only delivers the first author by default">
            ${SLRIcons.user} Fetch Authors
          </button>
          <button class="articles-action-btn" id="fetch-types-btn"
              title="Fetch missing document types via DOI (Crossref) - e.g. Article, Chapter, Dataset, Preprint">
            ${SLRIcons.tag} Fetch Types
          </button>
          <button class="articles-action-btn" id="fetch-affiliations-btn"
              title="Fetch affiliation names and country data via DOI / OpenAlex / PMID">
            ${SLRIcons.globe} Fetch Affiliations
          </button>
          <button class="articles-action-btn" id="fetch-all-btn"
              title="Fetch abstracts, authors, document types, and affiliations in one run">
            ${SLRIcons.refresh} Fetch All
          </button>
          <button class="articles-action-btn" id="export-list-btn"
              title="${esc(exportTitle || 'Download current list as .bib, .ris, or .csv')}">
            ${SLRIcons.download} Export
          </button>
        </div>
      </div>`;
  }

  // Wires the shared toolbar's controls. `onFilter` receives a state patch
  // for the view's own setXFilter; `onExport` receives no args (the caller
  // closes over the current filtered list).
  function wireListToolbar(container, { onFilter, onExport }) {
    const toggleBtn = container.querySelector('#list-actions-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', () => SLRApp.toggleActionsBar());

    const searchInput = container.querySelector('#list-search');
    if (searchInput) {
      let searchTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => onFilter({ search: searchInput.value }), 220);
      });
    }

    const sortSelect = container.querySelector('#list-sort');
    if (sortSelect) sortSelect.addEventListener('change', e => onFilter({ sort: e.target.value }));

    const tagSelect = container.querySelector('#list-tag-filter');
    if (tagSelect) tagSelect.addEventListener('change', e => onFilter({ tag: e.target.value || null }));

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
    bind('autotag-btn', () => {
      void SLRApp.autoTagByJournal(false).catch(err => {
        SLRApp.showToast('Auto-tag failed: ' + (err?.message || String(err)), true);
      });
    });
    bind('force-autotag-btn', () => {
      void SLRApp.autoTagByJournal(true).catch(err => {
        SLRApp.showToast('Auto-tag failed: ' + (err?.message || String(err)), true);
      });
    });
    bind('fetch-abstracts-btn', () => {
      void SLRApp.fetchAbstractsViaDOI().catch(err => {
        SLRApp.showToast('Fetch abstracts failed: ' + (err?.message || String(err)), true);
      });
    });
    bind('fetch-authors-btn', () => {
      void SLRApp.fetchAuthorsViaDOI().catch(err => {
        SLRApp.showToast('Fetch authors failed: ' + (err?.message || String(err)), true);
      });
    });
    bind('fetch-types-btn', () => {
      void SLRApp.fetchTypesViaDOI().catch(err => {
        SLRApp.showToast('Fetch types failed: ' + (err?.message || String(err)), true);
      });
    });
    bind('fetch-affiliations-btn', () => {
      void SLRApp.fetchAffiliationsViaIdentifier().catch(err => {
        SLRApp.showToast('Fetch affiliations failed: ' + (err?.message || String(err)), true);
      });
    });
    bind('fetch-all-btn', () => {
      void SLRApp.fetchAllMetadata({ mode: SLRApp.state.fetchMode }).catch(err => {
        SLRApp.showToast('Fetch all metadata failed: ' + (err?.message || String(err)), true);
      });
    });
    bind('export-list-btn', ev => {
      ev.stopPropagation();
      onExport(ev);
    });
  }

  //  History view

  function renderHistory(container, searchLog, projectData) {
    if (!projectData) {
      container.innerHTML = `<div class="history-view" style="padding:0">${renderNoProjectNotice()}</div>`;
      return;
    }
    if (!searchLog || searchLog.length === 0) {
      container.innerHTML = `
        <div class="history-view">
          <p style="color:var(--text-faint)">No query history found for this project.</p>
        </div>`;
      return;
    }

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

    const items = [...searchLog].reverse().map((run, i) => {
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

      return `
        <div class="history-item" id="hist-${i}">
          <div class="history-item-header" data-hist="${i}">
            <span class="history-chevron">${SLRIcons.chevronRight}</span>
            <div class="history-meta">
              <div class="history-timestamp">${esc(run.timestamp)}</div>
              <div class="history-query-preview">${esc(queryPreview)}${run.query && run.query.length > 120 ? '\u2026' : ''}</div>
              ${tagBar}
            </div>
            <button class="hist-delete-btn" data-index="${i}" title="Delete this query">${SLRIcons.trash}</button>
            <button class="hist-copy-btn" data-query="${esc(run.query || '')}" title="Copy query to clipboard">${SLRIcons.copy}</button>
            ${dbBadge}
            <span class="history-count">${count} result${count !== 1 ? 's' : ''}</span>
          </div>
          <div class="history-query-full">
            <pre>${esc(run.query)}</pre>
          </div>
          <div class="history-results-list">
            ${resultsHTML}
            ${moreCount > 0 ? `<div style="padding:8px 16px;font-size:12px;color:var(--text-faint)"> and ${moreCount} more</div>` : ''}
          </div>
        </div>`;
    }).join('');

    container.innerHTML = `<div class="history-view">${items}</div>`;

    container.querySelector('.history-view').addEventListener('click', e => {
      const deleteBtn = e.target.closest('.hist-delete-btn');
      if (deleteBtn) {
        e.stopPropagation();
        const idx = parseInt(deleteBtn.dataset.index, 10);
        if (confirm('Delete this query? This will permanently remove it from the history.')) {
          SLRApp.deleteHistoryQuery(idx);
        }
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
      const item = header.closest('.history-item');
      item.classList.toggle('expanded');
    });
  }

  //  Project info view 

  function renderProjectInfo(container, project, projectData) {
    if (!project) {
      container.innerHTML = `<div class="project-info-view" style="padding:0">${renderNoProjectNotice()}</div>`;
      return;
    }

    const articles = projectData ? SLRData.getArticles(projectData) : [];
    const stats    = SLRData.getStats(articles);

    // Tag legend  count by color name (tagsConfig key), resolve via aliases
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

    container.innerHTML = `
      <div class="project-info-view">
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
        </div>
      </div>`;

    // Wire up save button
    const saveBtn   = container.querySelector('#save-meta-btn');
    const nameInput = container.querySelector('#proj-name-input');
    const descInput = container.querySelector('#proj-desc-input');
    if (saveBtn) {
      saveBtn.addEventListener('click', () =>
        SLRApp.updateProjectMeta(nameInput.value, descInput.value));
    }
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
    const actionsVisible = !!SLRApp.state.actionsBarVisible;

    const tagBreakdownHTML = buildTagBreakdownHTML(corpusArticles, projectData, filter.tag);

    const filtered = applyFilter(corpusArticles, Object.assign({}, filter, { mode: 'corpus' }), projectData);
    const listHTML = !projectData
      ? renderNoProjectNotice()
      : filtered.length === 0
      ? `<div class="article-list-empty">${SLRIcons.corpus}<p>No corpus articles match the current filters.</p></div>`
      : filtered.map(a => articleItemHTML(a, projectData)).join('');

    container.innerHTML = `
      <div class="articles-view">

        <div class="corpus-banner">
          <span class="corpus-banner-stat">
            ${SLRIcons.corpus}
            <strong>${stats.corpus}</strong> article${stats.corpus !== 1 ? 's' : ''} in corpus
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.articles}
            from ${articles.length} total
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.tag}
            <strong>${Object.keys(stats.byTag).filter(t => t !== 'None').length}</strong> tag${Object.keys(stats.byTag).filter(t => t !== 'None').length !== 1 ? 's' : ''} used
          </span>
        </div>

        ${tagBreakdownHTML ? `<div class="corpus-tag-breakdown">${tagBreakdownHTML}</div>` : ''}

        ${buildListToolbarHTML({
          searchId: 'list-search', searchValue: filter.search,
          sortId: 'list-sort', sortValue: filter.sort,
          yearFromId: 'list-year-from', yearFromValue: filter.yearFrom,
          yearToId: 'list-year-to', yearToValue: filter.yearTo,
          tagFilterId: 'list-tag-filter', tagFilterValue: filter.tag,
          tagOptionsHTML: buildTagOptions(corpusArticles, projectData, filter.tag),
          actionsVisible,
          exportTitle: 'Download current list as .bib, .ris, or .csv',
        })}

        <div class="articles-stats">
          <span>Showing <strong>${filtered.length}</strong> of <strong>${stats.corpus}</strong> corpus articles</span>
          ${filter.tag ? `<span class="stats-sep">|</span><span>Tag: ${esc(filter.tag === TAG_FILTER_NONE ? 'None' : filter.tag)}</span>` : ''}
          ${filter.search ? `<span class="stats-sep">|</span><span>Search: "${esc(filter.search)}"</span>` : ''}
        </div>

        <div class="article-list" id="corpus-list">
          ${listHTML}
        </div>
      </div>`;

    // Tag chip filter
    container.querySelectorAll('.corpus-tag-breakdown .corpus-tag-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tag;
        SLRApp.setCorpusFilter({ tag: filter.tag === t ? null : t });
      });
    });

    wireListToolbar(container, {
      onFilter: patch => SLRApp.setCorpusFilter(patch),
      onExport: () => {
        const exportBtn = container.querySelector('#export-list-btn');
        openExportMenu(exportBtn, filtered, 'corpus');
      },
    });

    container.querySelector('#corpus-list').addEventListener('click', e => {
      const item = e.target.closest('.article-item');
      if (!item || e.target.tagName === 'A') return;
      if (e.target.closest('[data-action]')) return;
      if (e.target.closest('.article-id-copy')) return;
      item.classList.toggle('expanded');
    });
    wireArticleActions(container.querySelector('#corpus-list'), projectData);
  }

  //  Selected view 

  function renderSelected(container, articles, filter, projectData) {
    const selectedArticles = articles.filter(a => a.selected);
    const stats = SLRData.getStats(selectedArticles);
    const actionsVisible = !!SLRApp.state.actionsBarVisible;

    const selectedTagBreakdownHTML = buildTagBreakdownHTML(selectedArticles, projectData, filter.tag);

    const filtered = applyFilter(selectedArticles, Object.assign({}, filter, { mode: 'selected' }), projectData);
    const listHTML = !projectData
      ? renderNoProjectNotice()
      : filtered.length === 0
      ? `<div class="article-list-empty">${SLRIcons.selected}<p>No selected articles match the current filters.</p></div>`
      : filtered.map(a => articleItemHTML(a, projectData)).join('');

    container.innerHTML = `
      <div class="articles-view">
        <div class="corpus-banner" style="border-left-color:var(--accent)">
          <span class="corpus-banner-stat">
            ${SLRIcons.selected}
            <strong>${selectedArticles.length}</strong> article${selectedArticles.length !== 1 ? 's' : ''} selected
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.articles}
            from ${articles.length} total
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.corpus}
            <strong>${stats.corpus}</strong> in corpus
          </span>
          <span class="corpus-banner-stat" style="color:var(--text-muted)">
            ${SLRIcons.tag}
            <strong>${Object.keys(stats.byTag).filter(t => t !== 'None').length}</strong> tag${Object.keys(stats.byTag).filter(t => t !== 'None').length !== 1 ? 's' : ''} used
          </span>
        </div>

        ${selectedTagBreakdownHTML ? `<div class="corpus-tag-breakdown">${selectedTagBreakdownHTML}</div>` : ''}

        ${buildListToolbarHTML({
          searchId: 'list-search', searchValue: filter.search,
          sortId: 'list-sort', sortValue: filter.sort,
          yearFromId: 'list-year-from', yearFromValue: filter.yearFrom,
          yearToId: 'list-year-to', yearToValue: filter.yearTo,
          tagFilterId: 'list-tag-filter', tagFilterValue: filter.tag,
          tagOptionsHTML: buildTagOptions(selectedArticles, projectData, filter.tag),
          actionsVisible,
          exportTitle: 'Download current list as .bib, .ris, or .csv',
        })}

        <div class="articles-stats">
          <span>Showing <strong>${filtered.length}</strong> of <strong>${selectedArticles.length}</strong> selected articles</span>
          ${filter.tag    ? `<span class="stats-sep">|</span><span>Tag: ${esc(filter.tag === TAG_FILTER_NONE ? 'None' : filter.tag)}</span>` : ''}
          ${filter.search ? `<span class="stats-sep">|</span><span>Search: "${esc(filter.search)}"</span>` : ''}
        </div>

        <div class="article-list" id="selected-list">${listHTML}</div>
      </div>`;

    container.querySelectorAll('.corpus-tag-breakdown .corpus-tag-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tag;
        SLRApp.setSelectedFilter({ tag: filter.tag === t ? null : t });
      });
    });

    wireListToolbar(container, {
      onFilter: patch => SLRApp.setSelectedFilter(patch),
      onExport: () => {
        const exportBtn = container.querySelector('#export-list-btn');
        openExportMenu(exportBtn, filtered, 'selected');
      },
    });

    container.querySelector('#selected-list').addEventListener('click', e => {
      const item = e.target.closest('.article-item');
      if (!item || e.target.tagName === 'A') return;
      if (e.target.closest('[data-action]')) return;
      if (e.target.closest('.article-id-copy')) return;
      item.classList.toggle('expanded');
    });
    wireArticleActions(container.querySelector('#selected-list'), projectData);
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
      const cols = [...chartEl.querySelectorAll('.viz-col-item')];
      const chartH = cH - 56, cw2 = cols.length ? Math.min(50, Math.floor((cW - 8) / cols.length)) : 40;
      let x = ox; ctx.textAlign = 'center';
      cols.forEach(col => {
        const bEl = col.querySelector('.viz-col-bar'), lEl = col.querySelector('.viz-col-label'),
              kEl = col.querySelector('.viz-col-count');
        if (!bEl || !lEl) return;
        const barH = chartH * (parseFloat(bEl.style.height) || 0) / 100;
        const barTop = oy + (chartH - barH);
        const segs  = [...col.querySelectorAll('.viz-col-seg')];
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

    // Build tag data from articles (label  { count, hex })  same approach as Tags view
    const computeTagData = (subset, includeNone = true) => {
      const labelMap = new Map();
      for (const a of subset) {
        const hasNamedTag = a.tag && a.tag !== 'None';
        const label = hasNamedTag ? a.tag : 'None';
        if (!hasNamedTag && !includeNone) continue;
        if (!labelMap.has(label)) {
          const hex = hasNamedTag ? (tagColor(projectData, a.color) || '#888') : 'var(--surface-3)';
          labelMap.set(label, { count: 0, hex });
        }
        labelMap.get(label).count++;
      }
      const bars = [...labelMap.entries()]
        .map(([name, { count, hex }]) => ({ name, hex, count }))
        .sort((a, b) => b.count - a.count);
      return { total: subset.length, bars };
    };

    const getSubset = (mode) =>
      mode === 'selected' ? articles.filter(a => a.selected)
    : mode === 'corpus'   ? articles.filter(a => a.corpus)
    : articles;

      const renderBars = (mode, includeNone) => {
      const { total, bars } = computeTagData(getSubset(mode), includeNone);
      if (bars.length === 0) return `<div class="viz-empty-bars">No tag data in this selection.</div>`;
      const maxCount = bars[0].count;
      return bars.map(d => {
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
    };

      const renderDoughnut = (mode, showLegend, includeNone) => {
      const { bars: rawBars } = computeTagData(getSubset(mode), includeNone);
      if (rawBars.length === 0) return `<div class="viz-empty-bars">No tag data in this selection.</div>`;
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
        return `<div class="viz-doughnut-wrap${showLegend ? '' : ' legend-hidden'}">
        <svg class="viz-doughnut-svg" viewBox="0 0 340 340" aria-hidden="true">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
                  stroke="var(--surface-2)" stroke-width="58"/>
          ${segments}
          <text x="${cx}" y="${cy - 12}" text-anchor="middle"
                class="viz-doughnut-num">${sum}</text>
          <text x="${cx}" y="${cy + 20}" text-anchor="middle"
                class="viz-doughnut-sub">tagged</text>
        </svg>
          ${showLegend ? `<div class="viz-legend">${legend}</div>` : ''}
      </div>`;
    };

    //  Year distribution (stacked by tag) 
    const computeYearData = (subset, includeNone = true) => {
      const yearMap = new Map(); // year  Map<label, {count, hex}>
      for (const a of subset) {
        const yr = a.yearNum;
        if (!yr || yr < 1900 || yr > 2100) continue;
        if (!yearMap.has(yr)) yearMap.set(yr, new Map());
        const hasNamedTag = a.tag && a.tag !== 'None';
        if (!hasNamedTag && !includeNone) continue;
        const label = hasNamedTag ? a.tag : 'None';
        const hex   = hasNamedTag ? (tagColor(projectData, a.color) || '#888') : 'var(--surface-3)';
        const key   = hasNamedTag ? label : '__none__';
        const tm    = yearMap.get(yr);
        if (!tm.has(key)) tm.set(key, { count: 0, hex, label });
        tm.get(key).count++;
      }
      const years = [...yearMap.entries()].sort((a, b) => a[0] - b[0]);
      const maxTotal = years.reduce((m, [, tm]) => {
        const t = [...tm.values()].reduce((s, v) => s + v.count, 0);
        return Math.max(m, t);
      }, 0);
      return { years, maxTotal };
    };

      const renderYearBars = (mode, showLegend, includeNone) => {
      const { years, maxTotal } = computeYearData(getSubset(mode), includeNone);
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

      const cols = years.map(([yr, tagMap]) => {
        const total = [...tagMap.values()].reduce((s, v) => s + v.count, 0);
        const heightPct = maxTotal > 0 ? (total / maxTotal * 100).toFixed(1) : '0';
        const tagged   = [...tagMap.entries()].filter(([k]) => k !== '__none__').sort((a, b) => b[1].count - a[1].count);
        const none     = tagMap.get('__none__');
        const allSegs  = none ? [...tagged, ['__none__', none]] : tagged;
        const segs = allSegs.map(([key, v]) => {
          return `<div class="viz-col-seg" data-tag-key="${esc(key)}" style="flex:${v.count};background:${v.hex}" title="${esc(v.label)}: ${v.count}"></div>`;
        }).join('');
        return `
          <div class="viz-col-item">
            <div class="viz-col-count">${total}</div>
            <div class="viz-col-bar-wrap">
              <div class="viz-col-bar" style="height:${heightPct}%">${segs}</div>
            </div>
            <div class="viz-col-label">${yr}</div>
          </div>`;
      }).join('');

      const legendHTML = allTagEntries.map(([key, { label, hex }]) =>
        `<div class="viz-year-legend-item viz-legend-item" data-tag-key="${esc(key)}">
          <span class="viz-legend-dot" style="background:${esc(hex)}"></span>
          <span class="viz-legend-label">${esc(label)}</span>
        </div>`
      ).join('');

        return `<div class="viz-col-chart-wrap${showLegend ? '' : ' legend-hidden'}"><div class="viz-col-chart">${cols}</div></div>${showLegend && legendHTML ? `<div class="viz-year-legend">${legendHTML}</div>` : ''}`;
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

      const mkBox = (stage, n, desc, meta, color, bw) => `
        <div class="prisma-box" style="border-left-color:${color}">
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

      const mkConn = (n, label, reason) => `
        <div class="prisma-step-connector">
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

      return `
        <div class="prisma-wrap">
          <div class="prisma-steps">
            ${mkBox('Identification', nRaw,
              'Records identified from database searches',
              `${nQueries} search quer${nQueries===1?'y':'ies'} \u00b7 starting point`,
              '#64A8FF', 100)}
            ${mkConn(nDups,  'Records removed before screening', 'Duplicates removed (same EID or DOI across queries)')}
            ${mkBox('Screening', nDedup,
              'Records screened after deduplication',
              `${relPct(nDedup, nRaw)}% of identified \u00b7 ${nDedup.toLocaleString()} unique articles`,
              '#7BD3D3', +relPct(nDedup, nRaw))}
            ${mkConn(nExcl, 'Records excluded', 'Not marked as selected in title / abstract screening')}
            ${mkBox('Eligibility', stats.selected,
              'Records assessed for eligibility',
              `${relPct(stats.selected, nDedup)}% of screening \u00b7 selected for full-text review`,
              '#81C995', +relPct(stats.selected, nDedup))}
            ${mkConn(nDrop, 'Records excluded', 'Selected but not included in corpus after full-text review')}
            ${mkBox('Included', stats.corpus,
              'Studies included in review corpus',
              `${relPct(stats.corpus, stats.selected)}% of eligibility \u00b7 final corpus`,
              '#00aa55', +relPct(stats.corpus, stats.selected))}
          </div>
        </div>`;
    };

    const nQueries  = (projectData.searchLog || []).length;

    container.innerHTML = `
      <div class="viz-view">

        <div class="viz-section">
          <div class="viz-section-controls">
            <div class="viz-chart-tabs">
              <button class="viz-chart-tab active" data-chart="doughnut" title="Doughnut chart">${SLRIcons.corpus}</button>
              <button class="viz-chart-tab" data-chart="bars" title="Bar chart">${SLRIcons.chart}</button>
              <button class="viz-chart-tab" data-chart="year" title="Year distribution">${SLRIcons.calendar}</button>
              <button class="viz-chart-tab" data-chart="world" title="World map">${SLRIcons.globe}</button>
              <button class="viz-chart-tab" data-chart="prisma" title="Screening Flow">${SLRIcons.prisma}</button>
            </div>
            <div class="viz-mode-tabs">
              <button class="viz-mode-tab active" data-mode="all">All&nbsp;(${stats.total})</button>
              <button class="viz-mode-tab" data-mode="selected">Selected&nbsp;(${stats.selected})</button>
              <button class="viz-mode-tab" data-mode="corpus">Corpus&nbsp;(${stats.corpus})</button>
            </div>
              <button class="viz-legend-toggle" id="viz-none-toggle">Hide None</button>
              <button class="viz-legend-toggle" id="viz-legend-toggle">Hide Legend</button>
              <button class="viz-legend-toggle viz-export-btn" id="viz-export-btn" title="Export current chart as PNG">${SLRIcons.download}&nbsp;Export&nbsp;PNG</button>
          </div>
          <h3 id="viz-chart-title" class="viz-chart-heading">Tag Distribution</h3>
          <div id="viz-chart" class="viz-bars"></div>
        </div>

      </div>`;

    // State
      let currentMode  = 'all';
      let currentChart = 'doughnut';
      let showLegend   = true;
      let showNone     = true;

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
      const el        = container.querySelector('#viz-chart');
      const titleEl   = container.querySelector('#viz-chart-title');
        const modeTabs  = container.querySelector('.viz-mode-tabs');
        const legendBtn = container.querySelector('#viz-legend-toggle');
        const noneBtn   = container.querySelector('#viz-none-toggle');
      const legendSupported = currentChart === 'doughnut' || currentChart === 'year' || currentChart === 'world';
      const noneSupported = currentChart === 'doughnut' || currentChart === 'year' || currentChart === 'bars';
      // Update heading to reflect active chart
      if (titleEl) titleEl.textContent = CHART_TITLES[currentChart] || 'Visualizations';
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
      el.className = currentChart === 'bars' ? 'viz-bars' : currentChart === 'world' ? 'viz-world' : '';
        el.innerHTML = currentChart === 'doughnut'
          ? renderDoughnut(currentMode, showLegend, showNone)
        : currentChart === 'year'
            ? renderYearBars(currentMode, showLegend, showNone)
          : currentChart === 'world'
            ? SLRWorldMap.renderWorldMap(getSubset(currentMode), showLegend)
          : currentChart === 'prisma'
            ? renderPrisma()
            : renderBars(currentMode, showNone);
      wireChartInteractivity(el, currentChart);
      if (currentChart === 'year') {
        const chartWrap = el.querySelector('.viz-col-chart-wrap');
        if (chartWrap) chartWrap.scrollLeft = chartWrap.scrollWidth;
      }
    };
    updateChart();

    container.querySelectorAll('[data-chart]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentChart = btn.dataset.chart;
        container.querySelectorAll('[data-chart]').forEach(b => b.classList.toggle('active', b === btn));
        updateChart();
      });
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
        await exportVizAsPNG(el, CHART_TITLES[currentChart] || 'visualization', currentChart);
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
        { label: 'Litmaps',          abbr: 'Lm', color: '#00897B', url: 'https://www.litmaps.com',              desc: 'Citation-network visualization tool' },
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

  // Database tab definitions  only working databases
  const DB_TABS = [
    { key: 'scopus',    label: 'Scopus',    note: null },
    { key: 'pubmed',    label: 'PubMed',    note: 'Free  No key required' },
    { key: 'openalex',  label: 'OpenAlex',  note: 'Free  No key required' },
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
    const maxRes   = (search && search.maxResults) || 100;
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

    // DB tabs
    const tabsHTML = DB_TABS.map(t =>
      `<button class="search-db-tab${db === t.key ? ' active' : ''}" data-db="${esc(t.key)}">${esc(t.label)}</button>`
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

        <!-- Left panel: field codes -->
        <div class="search-panel${isMobile && !search.showFieldCodes ? ' is-collapsed' : ''}" data-panel="field-codes">
          <div class="search-panel-header">
            ${SLRIcons.filter}
            <span class="search-panel-title">Field Codes</span>
          </div>
          <div class="search-panel-body">
            <div class="fc-list">${fcPanelHTML}</div>
          </div>
        </div>

        <!-- Center: query editor -->
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

        <!-- Right panel: past terms -->
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
    container.querySelectorAll('.search-db-tab').forEach(btn => {
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
        SLRApp.executeSearch(q, max ? parseInt(max.value) || 100 : 100, SLRApp.state.search.db);
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

  // The exact URL Supabase must be told to redirect confirmation/magic-link
  // emails back to. Supabase ignores emailRedirectTo for any URL not on the
  // project's own Authentication → URL Configuration allow-list and falls
  // back to its placeholder http://localhost:3000 instead — silently, with
  // no client-visible error — which is the #1 cause of "the confirmation/
  // magic-link email goes nowhere". This can only be fixed in the Supabase
  // dashboard itself, so the app's job is to make the exact value to paste
  // there impossible to miss.
  function currentAppUrl() {
    return window.location.origin + window.location.pathname;
  }

  // Shown wherever the Supabase email/password fields themselves appear —
  // the modal and Settings' "not signed in" state — since sign-in is the
  // part that's currently unreliable, not Cloud Sync as a whole.
  function renderSupabaseDevNotice() {
    return `
      <div class="scopus-api-notice scopus-api-notice-caution" style="margin-bottom:14px">
        <span class="scopus-api-notice-icon">${SLRIcons.warning}</span>
        <div><strong>Cloud Sync sign-in is still being implemented</strong> and currently
          doesn't work reliably, or only works partially. <strong>Local Folder</strong> is
          the dependable option for now.</div>
      </div>`;
  }

  function renderRedirectUrlNotice(idPrefix) {
    return `
      <div class="scopus-api-notice" style="margin-bottom:14px">
        <span class="scopus-api-notice-icon">${SLRIcons.info}</span>
        <div>
          <strong>Confirmation or magic-link email not arriving / leads nowhere?</strong>
          In your Supabase project, go to <strong>Authentication → URL Configuration</strong>
          and add this exact URL as both the <strong>Site URL</strong> and a
          <strong>Redirect URL</strong>:
          <div style="display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap">
            <code id="${idPrefix}-redirect-url" style="word-break:break-all">${esc(currentAppUrl())}</code>
            <button type="button" class="btn-secondary" id="${idPrefix}-copy-url-btn" style="flex-shrink:0">Copy</button>
          </div>
          Without this, those emails point at Supabase's placeholder
          <code>localhost:3000</code> instead, which is why the link "can't be reached".
          Fastest fix to test right now: turn <strong>Confirm email</strong> off in
          <strong>Authentication → Settings</strong> — Sign Up then works instantly, no email needed.
        </div>
      </div>`;
  }

  function wireRedirectUrlCopyButton(container, idPrefix) {
    const copyBtn = container.querySelector(`#${idPrefix}-copy-url-btn`);
    if (!copyBtn) return;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(currentAppUrl());
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = original; }, 1500);
      } catch (_) { /* Clipboard API unavailable/denied — the URL is still selectable text. */ }
    });
  }

  function renderCloudSyncSection() {
    const backend = SLRData.getBackend();
    const { url: supabaseUrl, key: supabaseKey } = SLRDataCloud.getCredentials();
    const cloudUser = SLRDataCloud.currentUser();

    return `
      <div class="settings-section">
        <h3>Cloud Sync (Supabase)</h3>
        <p class="field-hint" style="margin-top:2px">
          Optional: sync your projects through your own Supabase project instead
          of a local folder — works on any browser or device, including mobile,
          where the File System Access API isn't available.
        </p>

        <div style="margin-top:14px">${renderRedirectUrlNotice('settings-supabase')}</div>

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
        </div>

        <div class="form-field">
          <label for="settings-supabase-url">Supabase Project URL</label>
          <input class="form-input monospace" id="settings-supabase-url" type="text"
            placeholder="https://xxxxxxxx.supabase.co" value="${esc(supabaseUrl)}">
        </div>
        <div class="form-field">
          <label for="settings-supabase-key">Supabase anon / publishable key</label>
          <div class="secret-input-row">
            <input class="form-input monospace" id="settings-supabase-key" type="password"
              placeholder="anon public key or sb_publishable_..." value="${esc(supabaseKey)}">
            <button class="btn-secondary secret-toggle-btn" type="button" data-target="settings-supabase-key" aria-label="Show key" aria-pressed="false">
              <span class="secret-toggle-icon">${SLRIcons.eye}</span>
              <span class="secret-toggle-label">Show</span>
            </button>
          </div>
          <p class="field-hint">From Project Settings → API in your Supabase dashboard. Both the
            legacy "anon public" key and the newer <code>sb_publishable_...</code> key work here.
            Safe to use client-side — Row Level Security is the real access gate. Run
            <code>supabase/schema.sql</code> (in this app's repo) once in your project's SQL
            editor before connecting.</p>
        </div>
        <div class="settings-save-row">
          <button class="btn-secondary" id="settings-supabase-save-creds-btn">Save Connection</button>
          <span class="settings-saved-msg" id="settings-supabase-creds-saved-msg">Saved!</span>
        </div>

        ${cloudUser ? `
          <div class="cloud-auth-status">
            ${SLRIcons.check}
            <span>Signed in as <strong>${esc(cloudUser.email)}</strong></span>
            <button class="btn-secondary" id="settings-supabase-signout-btn">Sign Out</button>
          </div>
        ` : `
          ${renderSupabaseDevNotice()}
          <form id="settings-supabase-form" autocomplete="on">
            <div class="form-field" style="margin-top:10px">
              <label for="settings-supabase-email">Email</label>
              <input class="form-input" id="settings-supabase-email" name="email" type="email" placeholder="you@example.com" autocomplete="email">
            </div>
            <div class="form-field">
              <label for="settings-supabase-password">Password</label>
              <div class="secret-input-row">
                <input class="form-input" id="settings-supabase-password" name="password" type="password"
                  placeholder="Password" autocomplete="current-password">
                <button class="btn-secondary secret-toggle-btn" type="button" data-target="settings-supabase-password" aria-label="Show password" aria-pressed="false">
                  <span class="secret-toggle-icon">${SLRIcons.eye}</span>
                  <span class="secret-toggle-label">Show</span>
                </button>
              </div>
            </div>
          </form>
          <div class="settings-save-row">
            <button class="btn-primary" type="submit" form="settings-supabase-form" id="settings-supabase-signin-btn">Sign In</button>
            <button class="btn-secondary" type="button" id="settings-supabase-signup-btn">Sign Up</button>
            <button class="btn-secondary" type="button" id="settings-supabase-magiclink-btn">Email me a magic link</button>
            <button type="button" class="link-btn" id="settings-supabase-resend-btn">Resend confirmation email</button>
          </div>
          <div id="settings-supabase-auth-result" class="scopus-test-result" hidden></div>
        `}
      </div>`;
  }

  function wireCloudSyncSection(container) {
    wireRedirectUrlCopyButton(container, 'settings-supabase');

    container.querySelectorAll('input[name="backend-switch"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) SLRApp.switchBackend(radio.value);
      });
    });

    const saveCredsBtn = container.querySelector('#settings-supabase-save-creds-btn');
    if (saveCredsBtn) {
      saveCredsBtn.addEventListener('click', () => {
        const url = container.querySelector('#settings-supabase-url').value.trim();
        const key = container.querySelector('#settings-supabase-key').value.trim();
        SLRApp.saveCloudCredentials(url, key);
        const msg = container.querySelector('#settings-supabase-creds-saved-msg');
        if (msg) {
          msg.classList.add('visible');
          setTimeout(() => msg.classList.remove('visible'), 2000);
        }
      });
    }

    const signOutBtn = container.querySelector('#settings-supabase-signout-btn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', () => SLRApp.cloudSignOut());
    }

    const resultEl  = container.querySelector('#settings-supabase-auth-result');
    const resendBtn = container.querySelector('#settings-supabase-resend-btn');
    function showAuthResult(message, isError) {
      if (!resultEl) return;
      resultEl.hidden = false;
      resultEl.textContent = message;
      resultEl.classList.toggle('scopus-test-fail', !!isError);
    }

    function readEmailPassword() {
      return {
        email: (container.querySelector('#settings-supabase-email')?.value || '').trim(),
        password: container.querySelector('#settings-supabase-password')?.value || '',
      };
    }

    // Every auth action re-applies whatever is currently typed in the
    // Project URL/key fields first — previously only the separate "Save
    // Connection" button did this, so typing new/updated credentials and
    // going straight to Sign In (the natural flow) silently authenticated
    // against whatever was last saved (or nothing), not what was just
    // typed. This is very likely the actual cause behind "the credentials
    // are definitely correct but sign-in still fails."
    function applyCurrentCredentials() {
      const url = container.querySelector('#settings-supabase-url')?.value.trim() || '';
      const key = container.querySelector('#settings-supabase-key')?.value.trim() || '';
      if (url && key) SLRDataCloud.configure(url, key);
    }

    // Sign In is type="submit" (associated via form="settings-supabase-form"),
    // so both a click and pressing Enter in either field route through this
    // one submit handler — also the signal password managers watch for to
    // offer saving the credentials just entered.
    const signInForm = container.querySelector('#settings-supabase-form');
    if (signInForm) {
      signInForm.addEventListener('submit', async e => {
        e.preventDefault();
        const { email, password } = readEmailPassword();
        if (!email || !password) { showAuthResult('Enter an email and password.', true); return; }
        applyCurrentCredentials();
        try {
          await SLRApp.cloudAuth('signin', email, password);
        } catch (err) {
          showAuthResult(describeAuthError(err, 'signin'), true);
        }
      });
    }

    const signUpBtn = container.querySelector('#settings-supabase-signup-btn');
    if (signUpBtn) {
      signUpBtn.addEventListener('click', async () => {
        const { email, password } = readEmailPassword();
        if (!email || !password) { showAuthResult('Enter an email and password.', true); return; }
        applyCurrentCredentials();
        try {
          const result = await SLRApp.cloudAuth('signup', email, password);
          if (result && result.confirmed === false) {
            showAuthResult('Account created — check your email to confirm it, then sign in above.', false);
          }
        } catch (err) {
          showAuthResult(describeAuthError(err, 'signup'), true);
        }
      });
    }

    const magicLinkBtn = container.querySelector('#settings-supabase-magiclink-btn');
    if (magicLinkBtn) {
      magicLinkBtn.addEventListener('click', async () => {
        const { email } = readEmailPassword();
        if (!email) { showAuthResult('Enter an email first.', true); return; }
        applyCurrentCredentials();
        try {
          await SLRApp.cloudAuth('magiclink', email);
          showAuthResult('Magic link sent — check your email.', false);
        } catch (err) {
          showAuthResult(err.message || String(err), true);
        }
      });
    }

    if (resendBtn) {
      resendBtn.addEventListener('click', async () => {
        const { email } = readEmailPassword();
        if (!email) { showAuthResult('Enter an email first.', true); return; }
        applyCurrentCredentials();
        resendBtn.disabled = true;
        try {
          await SLRDataCloud.resendConfirmation(email);
          showAuthResult('Confirmation email resent — check your inbox.', false);
        } catch (err) {
          showAuthResult(err.message || String(err), true);
        } finally {
          resendBtn.disabled = false;
        }
      });
    }
  }

  function renderSettings(container, { apiKey, instToken, openAlexKey, openAlexEmail, autoFetchEnabled, fetchMode, autoTagEnabled, autoRunScope, autoTagCategories, allTagCategories, folderName }) {
    const categories = Array.isArray(allTagCategories) ? allTagCategories : [];
    const enabledCategorySet = new Set(Array.isArray(autoTagCategories) && autoTagCategories.length ? autoTagCategories : categories);
    container.innerHTML = `
      <div class="settings-view">
        <p class="settings-subtitle">Configure your API credentials and workspace.</p>

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
            <button class="btn-primary" id="settings-save-btn">Save</button>
            <span class="settings-saved-msg" id="settings-saved-msg">Saved!</span>
            <button class="btn-secondary" type="button" id="settings-scopus-test-btn" style="margin-left:8px">Test API Key</button>
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
        </div>

        <div class="about-v2-banner">
          <div class="about-v2-header">
            <span class="about-v2-badge">V2</span>
            <strong>What&rsquo;s New in Version 2 &mdash; Web App</strong>
          </div>
          <ul class="about-feature-list">
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.folderOpen}</span><span><strong>Browser-based</strong> &mdash; no installation, runs from <code>index.html</code> or a local server</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.githubLogo}</span><span><strong>Hosted on GitHub Pages</strong> &mdash; open <a href="https://socresearcher.github.io/slr-harvester/" target="_blank" rel="noopener">socresearcher.github.io/slr-harvester</a> directly, no download required; your project data still never leaves your device</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.supabaseLogo}</span><span><strong>Cloud Sync (Supabase)</strong> &mdash; optional: sync projects through your own Supabase project instead of a local folder, so any browser or device works, including mobile. <strong>Still being implemented</strong> &mdash; sign-in currently has known issues and is actively being worked on.</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.databases}</span><span><strong>Multi-database search</strong> &mdash; Scopus, PubMed and OpenAlex integrated directly in the Search view</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.refresh}</span><span><strong>Data enrichment via Crossref</strong> &mdash; fetch missing abstracts, full author lists and document types by DOI</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.search}</span><span><strong>Advanced article-list search</strong> &mdash; use semicolon-separated terms for AND logic (e.g., <code>companion; ethnography</code>) across title, abstract and journal fields</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.palette}</span><span><strong>Color scheme engine</strong> &mdash; 17 built-in palettes plus cycling monochrome; applied directly to your project's tag colors</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.tag}</span><span><strong>Tag aliasing</strong> &mdash; map multiple tag names to one canonical label for unified filtering</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.corpus}</span><span><strong>Corpus &amp; Selected screening</strong> &mdash; two-stage inclusion workflow, identical to the desktop app</span></li>
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.chart}</span><span><strong>Visualizations</strong> &mdash; year distribution, tag distribution and selection funnel charts (Canvas, no libraries)</span></li>
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
            <li><span class="about-li-icon" aria-hidden="true">${SLRIcons.tag}</span><span>Tag management and color assignment</span></li>
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
            The Articles view provides three enrichment buttons that use the
            <strong>Crossref</strong> API (free, no key required) via DOI lookups:
          </p>
          <ul style="font-size:13px;color:var(--text-muted);line-height:1.9;padding-left:18px">
            <li><strong>Fetch Abstracts</strong> &mdash; fills in missing abstracts</li>
            <li><strong>Fetch Authors</strong> &mdash; retrieves the complete author list (Scopus truncates to first author)</li>
            <li><strong>Fetch Types</strong> &mdash; determines the document type (Article, Chapter, Preprint, &hellip;)</li>
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
            regardless of vendor. <strong>Cloud Sync</strong> (Settings &rarr; Cloud Sync)
            works in any modern browser, including mobile, as an alternative.
          </p>
          <p style="font-size:13px;color:var(--text-muted);margin-top:8px;line-height:1.7">
            In <strong>Local Folder</strong> mode the app works entirely offline &mdash;
            no project data is sent to any server, only direct API requests from your
            browser to the respective academic databases. In <strong>Cloud Sync</strong>
            mode, project data is stored in the Supabase project you connect in Settings.
          </p>
        </div>

        <div class="settings-section">
          <h3>Version &amp; License</h3>
          <p style="font-size:13px;color:var(--text-muted)">SLR Harvester Web &mdash; 2026</p>
          <p style="font-size:12px;color:var(--text-faint);margin-top:4px">&copy; 2026 Gregor Hobersdorfer &mdash; All rights reserved. Non-commercial use permitted with attribution.</p>
        </div>
      </div>`;
    const gotoBtn = container.querySelector('#about-goto-settings');
    if (gotoBtn) gotoBtn.addEventListener('click', () => SLRApp.navigate('settings'));
  }

  //  Tags view 

  // Pre-defined color scheme metadata for the scheme panel
  const COLOR_SCHEMES = [
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
  ];

  function renderTags(container, articles, projectData) {
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
          <div class="tag-card-swatch-wrap" title="Click to change color">
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
          <div class="tags-section-header">
            <h3>Tags</h3>
          </div>

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
            : `<p style="font-size:13px;color:var(--text-faint)">No tags defined yet. Use Auto-tag in the Articles view or add tags manually.</p>`
          }
        </div>

        <div class="tags-section">
          <h3>Color Schemes</h3>
          <div class="scheme-panel">
            <p class="scheme-panel-intro">Apply a preset color scheme to all existing tags at once.</p>
            <div class="scheme-grid">${schemeBtnsHTML}</div>
          </div>
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

  // Reachable directly from the Welcome screen's "Continue with Supabase"
  // button, so first-time setup and every later sign-in happen on Home
  // instead of requiring a trip to the bottom of Settings.
  function renderSupabaseAuthModal(overlay) {
    const { url, key } = SLRDataCloud.getCredentials();
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="supabase-modal-title">
        <div class="modal-header">
          <h3 id="supabase-modal-title">Continue with Supabase</h3>
          <button class="icon-btn" id="supabase-modal-close" aria-label="Close">${SLRIcons.close}</button>
        </div>
        <div class="modal-body">
          ${renderSupabaseDevNotice()}
          <p class="field-hint" style="margin:0 0 12px">
            First time? Run <code>supabase/schema.sql</code> (in this app's repo) in your
            Supabase project's SQL editor once, then enter its Project URL and key below.
            Full steps in <button type="button" class="link-btn" id="supabase-modal-settings-link">Settings → Cloud Sync</button>.
          </p>
          ${renderRedirectUrlNotice('supabase-modal')}
          <div class="form-field">
            <label for="supabase-modal-url">Supabase Project URL</label>
            <input class="form-input monospace" id="supabase-modal-url" type="text"
              placeholder="https://xxxxxxxx.supabase.co" value="${esc(url)}" autofocus>
          </div>
          <div class="form-field">
            <label for="supabase-modal-key">Supabase anon / publishable key</label>
            <div class="secret-input-row">
              <input class="form-input monospace" id="supabase-modal-key" type="password"
                placeholder="anon public key or sb_publishable_..." value="${esc(key)}">
              <button class="btn-secondary secret-toggle-btn" type="button" data-target="supabase-modal-key" aria-label="Show key" aria-pressed="false">
                <span class="secret-toggle-icon">${SLRIcons.eye}</span>
                <span class="secret-toggle-label">Show</span>
              </button>
            </div>
            <p class="field-hint">From Project Settings → API. Both the legacy "anon public" key
              and the newer <code>sb_publishable_...</code> key work here.</p>
          </div>
          <form id="supabase-modal-form" autocomplete="on">
            <div class="form-field">
              <label for="supabase-modal-email">Email</label>
              <input class="form-input" id="supabase-modal-email" name="email" type="email" placeholder="you@example.com" autocomplete="email">
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
            <div style="display:flex;gap:16px;flex-wrap:wrap">
              <button type="button" class="link-btn" id="supabase-modal-magiclink-btn">Email me a magic link instead</button>
              <button type="button" class="link-btn" id="supabase-modal-resend-btn">Resend confirmation email</button>
            </div>
          </form>
          <div id="supabase-modal-result" class="scopus-test-result" hidden></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" type="button" id="supabase-modal-cancel">Cancel</button>
          <button class="btn-secondary" type="button" id="supabase-modal-signup">Sign Up</button>
          <button class="btn-primary" type="submit" form="supabase-modal-form" id="supabase-modal-signin">Sign In</button>
        </div>
      </div>`;

    const closeModal = () => {
      overlay.classList.add('hidden');
      overlay.innerHTML = '';
    };

    overlay.querySelector('#supabase-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('#supabase-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    overlay.querySelector('#supabase-modal-settings-link').addEventListener('click', () => {
      closeModal();
      SLRApp.navigate('settings');
    });

    wireRedirectUrlCopyButton(overlay, 'supabase-modal');

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

    const allButtons = () => overlay.querySelectorAll('.modal-footer button, #supabase-modal-magiclink-btn, #supabase-modal-resend-btn');

    async function handleAuth(action) {
      const urlVal = overlay.querySelector('#supabase-modal-url').value.trim();
      const keyVal = overlay.querySelector('#supabase-modal-key').value.trim();
      const email  = overlay.querySelector('#supabase-modal-email').value.trim();
      const password = overlay.querySelector('#supabase-modal-password').value;

      if (!urlVal || !keyVal) { showResult('Enter your Supabase Project URL and anon/publishable key.', true); return; }
      if (!email) { showResult('Enter an email.', true); return; }
      if (action !== 'magiclink' && !password) { showResult('Enter a password.', true); return; }

      SLRDataCloud.configure(urlVal, keyVal);

      const buttons = [...allButtons()];
      buttons.forEach(b => b.disabled = true);
      try {
        if (action === 'magiclink') {
          await SLRDataCloud.signInWithMagicLink(email);
          showResult('Magic link sent — check your email.', false);
        } else if (action === 'signup') {
          const result = await SLRApp.cloudAuth(action, email, password);
          if (result && result.confirmed === false) {
            showResult('Account created — check your email to confirm it, then sign in above.', false);
          } else {
            closeModal();
            return;
          }
        } else {
          await SLRApp.cloudAuth(action, email, password);
          closeModal();
          return;
        }
      } catch (err) {
        showResult(describeAuthError(err, action), true);
      } finally {
        buttons.forEach(b => b.disabled = false);
      }
    }

    // Sign In is type="submit" (associated via form="supabase-modal-form"),
    // so both a click and pressing Enter in the email/password fields route
    // through this one submit handler — which is also the signal password
    // managers watch for to offer saving the credentials just entered.
    overlay.querySelector('#supabase-modal-form').addEventListener('submit', e => {
      e.preventDefault();
      handleAuth('signin');
    });
    overlay.querySelector('#supabase-modal-signup').addEventListener('click', () => handleAuth('signup'));
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
    renderProjectInfo,
    renderLoading,
    renderError,
    renderCorpus,
    renderSelected,
    renderVisualizations,
    renderDatabases,
    renderSearch,
    renderSettings,
    renderAbout,
    renderTags,
    renderNewProjectModal,
    renderSupabaseAuthModal,
  };

})();
