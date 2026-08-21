/**
 * SLR Harvester Web - Main Application
 * State management, navigation, rendering, search and enrichment actions.
 *
 * Global: window.SLRApp
 */

window.SLRApp = (() => {

	// How many article cards a single render puts into the DOM at once —
	// large projects (thousands of articles) were visibly slow to render
	// and scroll with every one of them mounted at once. filter.renderLimit/
	// corpusFilter.renderLimit/selectedFilter.renderLimit (below) each start
	// at this and grow by another page when the user scrolls near the
	// bottom (see bumpArticlesRenderLimit and its siblings); any real filter
	// change resets back to this via setFilter et al.
	const ARTICLE_PAGE_SIZE = 200;

	const state = {
		view: 'welcome',
		theme: localStorage.getItem('slr-theme') || 'dark',
		sidebarCollapsed: localStorage.getItem('slr-sidebar-collapsed') === '1',
		folderName: '',

		projects: [],
		currentFolder: null,
		currentProject: null,
		projectData: null,
		articles: [],
		allProjectData: {},
		// Which project's info panel is open inline within the Projects tab
		// (null = showing the card grid instead). Replaces the old standalone
		// "Project Info" nav item/view.
		projectsDetailFolder: null,

		// searchFields mirrors views.js's DEFAULT_SEARCH_FIELDS (the "Fields"
		// multi-select next to each list's search box) — duplicated as a plain
		// literal like ARTICLE_PAGE_SIZE above since this app has no shared
		// module system between app.js and views.js.
		filter: {
			mode: 'all',
			tags: [],
			yearFrom: '',
			yearTo: '',
			sort: 'newest',
			search: '',
			searchFields: ['title', 'abstract', 'journal'],
			renderLimit: ARTICLE_PAGE_SIZE,
		},

		corpusFilter: {
			tags: [],
			yearFrom: '',
			yearTo: '',
			sort: 'newest',
			search: '',
			searchFields: ['title', 'abstract', 'journal'],
			renderLimit: ARTICLE_PAGE_SIZE,
		},

		selectedFilter: {
			tags: [],
			yearFrom: '',
			yearTo: '',
			sort: 'newest',
			search: '',
			searchFields: ['title', 'abstract', 'journal'],
			renderLimit: ARTICLE_PAGE_SIZE,
		},

		// Shared across Articles/Selected/Corpus (one preference, not per-view)
		// so the tag-breakdown show/hide toggle behaves identically everywhere.
		tagBreakdownVisible: localStorage.getItem('slr-tag-breakdown-visible') !== '0',

		monoHue: Math.floor(Math.random() * 360),

		settings: {
			apiKey: localStorage.getItem('slr-apikey') || '',
			instToken: localStorage.getItem('slr-insttoken') || '',
			openAlexKey: localStorage.getItem('slr-openalex-key') || '',
			openAlexEmail: localStorage.getItem('slr-openalex-email') || '',
			// Default ON for first-time users (localStorage key absent); once a user
			// explicitly saves a choice via Settings, that choice is respected as-is.
			autoFetchEnabled: localStorage.getItem('slr-auto-fetch-enabled') === null ? true : localStorage.getItem('slr-auto-fetch-enabled') === '1',
			autoTagEnabled: localStorage.getItem('slr-auto-tag-enabled') === null ? true : localStorage.getItem('slr-auto-tag-enabled') === '1',
			autoRunScope: localStorage.getItem('slr-auto-run-scope') === null ? 'new' : (localStorage.getItem('slr-auto-run-scope') === 'new' ? 'new' : 'all'),
			// Which disciplines auto-tag is allowed to assign. Empty/absent means
			// "all" (unrestricted, matches prior behavior); deselecting categories
			// that don't apply to a given project removes them as candidates
			// entirely, sharpening results among the categories that remain.
			autoTagCategories: (() => {
				try {
					const raw = localStorage.getItem('slr-auto-tag-categories');
					const parsed = raw ? JSON.parse(raw) : null;
					return Array.isArray(parsed) ? parsed : [];
				} catch (_) { return []; }
			})(),
		},

		// User-editable override of the built-in JOURNAL_TAG_RULES: null means
		// "use the shipped defaults verbatim, untouched"; once the user adds/
		// renames/recolors/deletes a category or a keyword, this becomes a full
		// array of { id, tag, color, hex, keywords } that entirely REPLACES
		// JOURNAL_TAG_RULES for matching (see getEffectiveAutoTagRules) — a
		// materialized copy the user can freely edit, not a diff on top of the
		// defaults, so renaming/deleting a formerly-built-in category is just
		// normal array editing. Persisted through SLRData.saveConfig alongside
		// API keys (slr_config.json locally, user_settings.auto_tag_rules on
		// cloud), so it's shared across every project in the workspace/account,
		// not per-project like tagsConfig/tagAliases. Hydrated (and migrated
		// from the older AutoTagCustomKeywords shape if needed) in
		// hydrateSettingsFromConfig.
		autoTagRules: null,

		fetchMode: localStorage.getItem('slr-fetch-mode') === 'all' ? 'all' : 'missing',
		projectsSort: localStorage.getItem('slr-projects-sort') || 'newest',
		pinnedProjects: (() => {
			try {
				const raw = JSON.parse(localStorage.getItem('slr-pinned-projects') || '[]');
				return new Set(Array.isArray(raw) ? raw : []);
			} catch (_) { return new Set(); }
		})(),
		// folder -> ISO timestamp, updated whenever a project is opened. Powers
		// the "Recently used" sort option; per-browser like pinnedProjects
		// above, not synced to the workspace itself.
		projectLastOpened: (() => {
			try {
				const raw = JSON.parse(localStorage.getItem('slr-project-last-opened') || '{}');
				return (raw && typeof raw === 'object') ? raw : {};
			} catch (_) { return {}; }
		})(),

		search: {
			query: '',
			maxResults: 500,
			isSearching: false,
			abortController: null,
			progress: 0,
			progressMsg: '',
			error: null,
			lastCount: null,
			db: 'scopus',
		},

		// Query History view: which status tab is showing, and date sort order.
		// Not persisted — resets to the defaults each session.
		history: {
			statusFilter: 'active', // 'active' | 'archived' | 'trashed'
			sortDir: 'desc',        // 'desc' = newest first, 'asc' = oldest first
		},
	};

	const $ = id => document.getElementById(id);

	let _container;
	let _sidebar;
	let _viewTitle;
	let _projectBadge;

	const VIEW_UI_STATE_MAP = {
		articles: { searchInputId: 'list-search', listId: 'article-list' },
		selected: { searchInputId: 'list-search', listId: 'selected-list' },
		corpus: { searchInputId: 'list-search', listId: 'corpus-list' },
	};

	function getViewUiStateConfig(view) {
		return VIEW_UI_STATE_MAP[view] || null;
	}

	function captureViewUiState() {
		const config = getViewUiStateConfig(state.view);
		if (!config) return null;

		const listEl = config.listId ? document.getElementById(config.listId) : null;
		const activeEl = document.activeElement;
		const hasFocusedSearch = !!(activeEl && config.searchInputId && activeEl.id === config.searchInputId);

		const snapshot = {
			view: state.view,
			listScrollTop: listEl ? listEl.scrollTop : 0,
			pageScrollY: typeof window.scrollY === 'number' ? window.scrollY : 0,
			hasFocusedSearch,
		};

		if (hasFocusedSearch) {
			snapshot.selectionStart = activeEl.selectionStart;
			snapshot.selectionEnd = activeEl.selectionEnd;
			snapshot.selectionDirection = activeEl.selectionDirection;
		}

		return snapshot;
	}

	function restoreViewUiState(snapshot) {
		if (!snapshot || snapshot.view !== state.view) return;
		const config = getViewUiStateConfig(state.view);
		if (!config) return;

		if (config.listId) {
			const listEl = document.getElementById(config.listId);
			if (listEl && typeof snapshot.listScrollTop === 'number') {
				listEl.scrollTop = snapshot.listScrollTop;
			}
		}

		if (typeof snapshot.pageScrollY === 'number' && Math.abs((window.scrollY || 0) - snapshot.pageScrollY) > 1) {
			window.scrollTo({ top: snapshot.pageScrollY });
		}

		if (!snapshot.hasFocusedSearch || !config.searchInputId) return;
		const input = document.getElementById(config.searchInputId);
		if (!input) return;

		input.focus({ preventScroll: true });
		if (typeof snapshot.selectionStart === 'number' && typeof snapshot.selectionEnd === 'number') {
			try {
				input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection || 'none');
			} catch (_) {
				// Ignore selection restoration failures for unsupported input types.
			}
		}
	}

	function esc(str) {
		if (str == null) return '';
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}
	
	function normalizePrimaryCredential(value) {
		const raw = value == null ? '' : String(value);
		const parts = raw.replace(/\r/g, '\n').replace(/\n/g, ',').split(',');
		for (const part of parts) {
			const normalized = String(part || '').trim();
			if (normalized) return normalized;
		}
		return '';
	}
	
	function normalizeToken(value) {
		return value == null ? '' : String(value).trim();
	}

	function normalizeEmail(value) {
		return value == null ? '' : String(value).trim();
	}
	
	async function delay(ms, signal) {
		if (!ms) return;
		await new Promise((resolve, reject) => {
			const timer = setTimeout(resolve, ms);
			if (!signal) return;
			const abort = () => {
				clearTimeout(timer);
				reject(new DOMException('Aborted', 'AbortError'));
			};
			if (signal.aborted) {
				abort();
				return;
			}
			signal.addEventListener('abort', abort, { once: true });
		});
	}

	function showToast(message, isError) {
		let el = document.querySelector('.slr-toast');
		if (!el) {
			el = document.createElement('div');
			el.className = 'slr-toast';
			document.body.appendChild(el);
		}
		el.textContent = message;
		el.style.position = 'fixed';
		el.style.right = '16px';
		el.style.bottom = '16px';
		el.style.maxWidth = '520px';
		el.style.padding = '10px 14px';
		el.style.borderRadius = '10px';
		el.style.fontSize = '13px';
		el.style.lineHeight = '1.4';
		el.style.zIndex = '9999';
		el.style.color = 'var(--text)';
		el.style.background = isError ? 'var(--danger)' : 'var(--surface-2)';
		el.style.border = '1px solid var(--border)';
		clearTimeout(showToast._timer);
		showToast._timer = setTimeout(() => {
			el.remove();
		}, isError ? 3600 : 2200);
	}

	function setSearchProgress(percent, message) {
		state.search.progress = Math.max(0, Math.min(100, percent || 0));
		state.search.progressMsg = message || '';
		if (state.view === 'search') renderCurrentView();
	}

	function showFetchProgress(label, done, total) {
		let overlay = document.querySelector('.fetch-progress-overlay');
		if (!overlay) {
			overlay = document.createElement('div');
			overlay.className = 'fetch-progress-overlay';
			overlay.innerHTML = `
				<div class="fpo-main">
					<div class="fpo-circle" aria-hidden="true">
						<svg viewBox="0 0 44 44" class="fpo-circle-svg">
							<circle class="fpo-ring-track" cx="22" cy="22" r="16"></circle>
							<circle class="fpo-ring-progress" cx="22" cy="22" r="16"></circle>
						</svg>
						<span class="fpo-circle-text"></span>
					</div>
					<div class="fpo-text">
						<div class="fpo-header">
							<span class="fpo-label"></span>
							<span class="fpo-count"></span>
						</div>
						<div class="fpo-track"><div class="fpo-bar"></div></div>
					</div>
				</div>`;
			document.body.appendChild(overlay);
		}
		const pct = total > 0 ? Math.round((done / total) * 100) : 0;
		const circle = overlay.querySelector('.fpo-ring-progress');
		const circleText = overlay.querySelector('.fpo-circle-text');
		const radius = 16;
		const circumference = 2 * Math.PI * radius;
		if (circle) {
			circle.style.strokeDasharray = `${circumference}`;
			circle.style.strokeDashoffset = `${circumference * (1 - pct / 100)}`;
		}
		if (circleText) circleText.textContent = `${pct}%`;
		overlay.querySelector('.fpo-label').textContent = label;
		overlay.querySelector('.fpo-count').textContent = `${done}/${total} (${pct}%)`;
		const bar = overlay.querySelector('.fpo-bar');
		if (bar) bar.style.width = `${pct}%`;
		overlay.classList.add('visible');
	}

	function hideFetchProgress() {
		document.querySelector('.fetch-progress-overlay')?.remove();
	}

	// ── First-run onboarding hints ──────────────────────────────────────────
	// Guides a new user through the sidebar in the logical order things
	// unlock: once a step is reached, whichever nav item(s) make sense next
	// flash turquoise twice. Some steps fan out to more than one next step
	// (e.g. after running a Search, History/Articles/Tags are all sensible
	// next stops). Progress is remembered per-browser so a step is only ever
	// hinted once, lifetime.
	const ONBOARDING_NEXT = {
		welcome: ['databases'],
		databases: ['projects'],
		projects: ['search'],
		search: ['history', 'articles', 'tags'],
		history: [],
		articles: ['selected'],
		selected: ['corpus'],
		corpus: [],
		tags: ['visualizations'],
		visualizations: [],
	};
	let onboardingDone;
	try {
		onboardingDone = new Set(JSON.parse(localStorage.getItem('slr-onboarding-done') || '[]'));
	} catch (_) {
		onboardingDone = new Set();
	}

	function pulseNavHint(view) {
		const btn = document.querySelector(`.nav-item[data-view="${view}"]`);
		if (!btn) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		btn.classList.remove('nav-hint-pulse');
		void btn.offsetWidth; // restart the animation if it's already mid-pulse
		btn.classList.add('nav-hint-pulse');
		btn.addEventListener('animationend', () => btn.classList.remove('nav-hint-pulse'), { once: true });
	}

	function markOnboardingStep(step) {
		if (!(step in ONBOARDING_NEXT) || onboardingDone.has(step)) return;
		onboardingDone.add(step);
		localStorage.setItem('slr-onboarding-done', JSON.stringify([...onboardingDone]));
		ONBOARDING_NEXT[step].forEach(pulseNavHint);
	}

	function stableStringList(values) {
		if (!Array.isArray(values)) return [];
		return [...new Set(values
			.map(v => String(v || '').trim())
			.filter(Boolean))];
	}

	function setsEqual(a, b) {
		if (a.size !== b.size) return false;
		for (const value of a) {
			if (!b.has(value)) return false;
		}
		return true;
	}

	// When scopeIds is a Set, restrict enrichment/auto-tag passes to just those
	// articles (used for "only newly added" automatic post-search runs);
	// null/undefined means the full project, preserving existing manual-button behavior.
	function scopedArticles(scopeIds) {
		if (!scopeIds) return state.articles;
		return state.articles.filter(a => scopeIds.has(a.eid || a._id || a.doi));
	}

	function hasCompleteAuthorList(article) {
		const names = String(article && article.authors || '')
			.split(',')
			.map(s => s.trim())
			.filter(Boolean);
		return names.length > 1;
	}

	function hasAffiliationMetadata(article) {
		const hasCountries = Array.isArray(article && article.affiliationCountries) && article.affiliationCountries.length > 0;
		const hasAffiliations = Array.isArray(article && article.affiliations) && article.affiliations.length > 0;
		return hasCountries && hasAffiliations;
	}

	function applyAffiliationUpdateIfChanged(article, map, meta) {
		if (!article || !meta) return false;
		const key = article.eid || article._id;
		if (!key) return false;

		const nextAffiliations = stableStringList(meta.affiliations);
		const nextCountries = stableStringList(meta.affiliationCountries).map(v => v.toUpperCase());
		const nextSources = stableStringList(meta.affiliationSources);

		if (!nextAffiliations.length && !nextCountries.length) return false;

		const currentAffiliations = stableStringList(article.affiliations);
		const currentCountries = stableStringList(article.affiliationCountries).map(v => v.toUpperCase());
		const currentSources = stableStringList(article.affiliationSources);

		const sameAffiliations = setsEqual(new Set(nextAffiliations), new Set(currentAffiliations));
		const sameCountries = setsEqual(new Set(nextCountries), new Set(currentCountries));
		const sameSources = setsEqual(new Set(nextSources), new Set(currentSources));

		if (sameAffiliations && sameCountries && sameSources) return false;

		map[key] = {
			affiliations: nextAffiliations,
			affiliationCountries: nextCountries,
			affiliationSources: nextSources,
		};
		return true;
	}

	function showFetchReport(title, stats) {
		const skippedParts = Object.entries(stats.skipped || {})
			.filter(([, count]) => count > 0)
			.map(([reason, count]) => `${reason}: ${count}`);

		const summary = [
			`${title}`,
			`mode=${stats.mode}`,
			`total=${stats.total}`,
			`eligible=${stats.eligible}`,
			`attempted=${stats.attempted}`,
			`updated=${stats.updated}`,
			`unchanged=${stats.unchanged}`,
			`failed=${stats.failed}`,
		].join(' | ');

		const skippedText = skippedParts.length ? ` | skipped -> ${skippedParts.join(', ')}` : '';
		showToast(`${summary}${skippedText}`, false);
	}

	function renderCurrentView() {
		if (!_container) return;
		const uiStateSnapshot = captureViewUiState();
		SLRAppUI.updateTopbar(state, {
			viewTitle: _viewTitle,
			projectBadge: _projectBadge,
		});

		// Every case below renders its own chrome (toolbar/header/menu structure)
		// and substitutes a "No project loaded" placeholder for just the data
		// portion when state.projectData is null — this keeps the app's layout
		// visible on browsers that can never load a project (e.g. mobile, which
		// lacks the File System Access API) instead of blanking the whole view.
		switch (state.view) {
			case 'welcome':
				SLRViews.renderWelcome(_container);
				markOnboardingStep('welcome');
				break;
			case 'projects':
				SLRViews.renderProjects(_container, state.projects, state.currentFolder, state.allProjectData, state.projectsSort, state.projectsDetailFolder);
				break;
			case 'articles':
				SLRViews.renderArticles(_container, state.articles, state.filter, state.projectData);
				break;
			case 'history':
				SLRViews.renderHistory(_container, (state.projectData && state.projectData.searchLog) || [], state.projectData, state.history);
				break;
			case 'corpus':
				SLRViews.renderCorpus(_container, state.articles, state.corpusFilter, state.projectData);
				break;
			case 'selected':
				SLRViews.renderSelected(_container, state.articles, state.selectedFilter, state.projectData);
				break;
			case 'visualizations':
				SLRViews.renderVisualizations(_container, state.articles, state.projectData);
				break;
			case 'databases':
				SLRViews.renderDatabases(_container);
				break;
			case 'search':
				SLRViews.renderSearch(_container, state.projectData, state.settings, state.search);
				break;
			case 'settings':
				SLRViews.renderSettings(_container, {
					apiKey: state.settings.apiKey,
					instToken: state.settings.instToken,
					openAlexKey: state.settings.openAlexKey,
					openAlexEmail: state.settings.openAlexEmail,
					autoFetchEnabled: state.settings.autoFetchEnabled,
					autoTagEnabled: state.settings.autoTagEnabled,
					autoRunScope: state.settings.autoRunScope,
					autoTagCategories: state.settings.autoTagCategories,
					allTagCategories: getEffectiveAutoTagRules().map(r => r.tag),
					fetchMode: state.fetchMode,
					folderName: state.folderName,
				});
				break;
			case 'about':
				SLRViews.renderAbout(_container);
				break;
			case 'privacy':
				SLRViews.renderPrivacy(_container);
				break;
			case 'tags':
			case 'autotag-rules': // legacy nav target — Auto-Tag Rules now lives inside Tags
				SLRViews.renderTags(_container, state.articles, state.projectData, getAutoTagRules(), Array.isArray(state.autoTagRules), state.folderName);
				break;
			default:
				SLRViews.renderError(_container, `Unknown view: ${state.view}`);
				break;
		}

		restoreViewUiState(uiStateSnapshot);
	}

	function navigate(view) {
		// A nav-item click always means "go to this section's top level" —
		// without this, clicking Projects while a card's inline info panel is
		// open would silently do nothing, stuck showing the same panel.
		// openProjectDetail() is the only intentional way into that panel.
		if (view === 'projects') state.projectsDetailFolder = null;
		state.view = view;
		renderCurrentView();
		persistActiveProjectView();
		// 'projects' and 'search' complete on a meaningful action (opening a
		// project / running a search), not merely on visiting the tab.
		if (view !== 'projects' && view !== 'search') markOnboardingStep(view);
	}

	// Opens a project's info panel inline within the Projects tab (replaces
	// the card grid there until closed) — works for any project in
	// state.allProjectData, not just the currently open one, since
	// loadProjectsAndStats() hydrates every project's data up front.
	function openProjectDetail(folder) {
		if (!folder) return;
		state.projectsDetailFolder = folder;
		state.view = 'projects';
		renderCurrentView();
	}

	function closeProjectDetail() {
		state.projectsDetailFolder = null;
		renderCurrentView();
	}

	// Entry point for Home's "First time here?" hint: jumps to About and
	// scrolls/flashes the section that used to be static text on Home itself.
	function gotoAboutFirstTime() {
		navigate('about');
		pulseNavHint('about');
		// renderCurrentView() above already ran synchronously, so the section
		// is live in the DOM here — no need to defer to a frame callback.
		const section = document.getElementById('about-first-time');
		if (!section) return;
		section.scrollIntoView({ behavior: 'smooth', block: 'start' });
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		section.classList.remove('section-hint-pulse');
		void section.offsetWidth;
		section.classList.add('section-hint-pulse');
		section.addEventListener('animationend', () => section.classList.remove('section-hint-pulse'), { once: true });
	}

	// Remembers which project (and which view within it) was open, purely so
	// a page reload can resume there instead of always landing back on the
	// Projects list — reconnecting the workspace/session (restoreFolder /
	// restoreSession) only restores the folder handle or auth session, not
	// which project the user was actually working in.
	const LAST_ACTIVE_FOLDER_KEY = 'slr-last-active-folder';
	const LAST_ACTIVE_VIEW_KEY   = 'slr-last-active-view';

	function persistActiveProjectView() {
		if (!state.currentFolder) return;
		localStorage.setItem(LAST_ACTIVE_FOLDER_KEY, state.currentFolder);
		localStorage.setItem(LAST_ACTIVE_VIEW_KEY, state.view);
	}

	function clearActiveProjectView() {
		localStorage.removeItem(LAST_ACTIVE_FOLDER_KEY);
		localStorage.removeItem(LAST_ACTIVE_VIEW_KEY);
	}

	async function hydrateProject(folderName) {
		const project = state.projects.find(p => p.workspace_folder === folderName) || null;
		if (!project) throw new Error('Project not found');

		const pd = await SLRData.loadProjectData(folderName);
		state.currentFolder = folderName;
		state.currentProject = project;
		state.projectData = pd;
		state.articles = SLRData.getArticles(pd);
		state.allProjectData[folderName] = pd;
	}

	// Projects created before tags stopped being pre-seeded (see createProject)
	// still carry all 19 legacy default color keys in tags_config.json
	// whether they're used or not. Rather than making the user hunt down
	// and manually delete the ones that never got used — their exact
	// complaint — silently drop any that are still (a) one of those exact
	// legacy keys, (b) unreferenced by any article, and (c) never claimed
	// by an alias (via auto-tag or a manual rename). Anything actually in
	// use, or renamed to mean something, is left untouched. Runs once per
	// project open, not on every background refresh.
	async function pruneUnusedLegacyTags(folderName) {
		const pd = state.projectData;
		if (!pd || !pd.tagsConfig) return;
		const legacyKeys = new Set(Object.keys(SLRData.DEFAULT_TAGS_CONFIG || {}).filter(k => k !== 'None'));
		if (!legacyKeys.size) return;
		const usedColors = new Set();
		for (const ann of Object.values(pd.globalTags || {})) {
			if (ann && ann.color && ann.color !== 'None') usedColors.add(ann.color);
		}
		const aliases = pd.tagAliases || {};
		const next = { ...pd.tagsConfig };
		let changed = false;
		for (const key of Object.keys(next)) {
			if (key === 'None' || !legacyKeys.has(key) || usedColors.has(key) || aliases[key]) continue;
			delete next[key];
			changed = true;
		}
		if (!changed) return;
		try {
			await SLRData.saveTagsConfig(folderName, next);
			pd.tagsConfig = next;
		} catch (_) {
			// Best-effort cleanup — no write access, or a transient error.
			// Not worth surfacing to the user; it'll simply retry next open.
		}
	}

	async function openProject(folderName) {
		try {
			SLRViews.renderLoading(_container, 'Loading project...');
			await hydrateProject(folderName);
			await pruneUnusedLegacyTags(folderName);
			state.projectLastOpened[folderName] = new Date().toISOString();
			localStorage.setItem('slr-project-last-opened', JSON.stringify(state.projectLastOpened));
			if (['welcome', 'projects', 'settings', 'about', 'databases'].includes(state.view)) {
				state.view = 'articles';
			}
			renderCurrentView();
			persistActiveProjectView();
			markOnboardingStep('projects');
		} catch (err) {
			SLRViews.renderError(_container, err.message || String(err));
		}
	}

	async function loadProjectsAndStats() {
		state.projects = await SLRData.loadProjects();

		// Fill in icons for projects that don't already carry one from the
		// backend — covers projects saved before this device last synced, and
		// cloud projects whose Supabase `projects` table predates the `icon`
		// column migration in supabase/schema.sql.
		let iconMap;
		try {
			iconMap = JSON.parse(localStorage.getItem('slr-project-icons') || '{}');
		} catch (_) {
			iconMap = {};
		}
		state.projects = state.projects.map(p =>
			(!p.icon && iconMap[p.workspace_folder]) ? { ...p, icon: iconMap[p.workspace_folder] } : p
		);

		const cache = {};
		await Promise.all(state.projects.map(async p => {
			try {
				cache[p.workspace_folder] = await SLRData.loadProjectData(p.workspace_folder);
			} catch (_) {
				cache[p.workspace_folder] = null;
			}
		}));
		state.allProjectData = cache;
	}

	// Credentials must be strictly per-folder: this always overwrites (not
	// merges-if-empty) state.settings from the CURRENTLY open folder's own
	// slr_config.json, clearing fields the file doesn't have. Without this,
	// a key picked up from one folder (or typed in manually) would silently
	// keep being used after switching to a different, keyless folder — the
	// exact cross-folder credential leak this must prevent. localStorage is
	// kept only as a same-folder-session mirror, not a cross-folder fallback.
	async function hydrateSettingsFromConfig() {
		const config = await SLRData.loadConfig();
		state.settings.apiKey = normalizePrimaryCredential((config && config.APIKey) || '');
		state.settings.instToken = normalizeToken((config && config.InstToken) || '');
		state.settings.openAlexKey = normalizeToken((config && config.OpenAlexKey) || '');
		state.settings.openAlexEmail = normalizeEmail((config && (config.OpenAlexEmail || config.OpenAlexMailto)) || '');
		localStorage.setItem('slr-apikey', state.settings.apiKey);
		localStorage.setItem('slr-insttoken', state.settings.instToken);
		localStorage.setItem('slr-openalex-key', state.settings.openAlexKey);
		localStorage.setItem('slr-openalex-email', state.settings.openAlexEmail);

		const rawRules = config && config.AutoTagRules;
		if (Array.isArray(rawRules)) {
			state.autoTagRules = rawRules;
		} else {
			// One-time migration from the older per-tag keyword-overlay shape
			// (AutoTagCustomKeywords: { [tag]: string[] } — no renamed/added/
			// deleted categories could exist under it) into the current full
			// rule-array shape, then persist so future loads read it directly.
			const legacyKeywords = config && config.AutoTagCustomKeywords;
			if (legacyKeywords && typeof legacyKeywords === 'object' && !Array.isArray(legacyKeywords) && Object.keys(legacyKeywords).length) {
				const materialized = materializeDefaultAutoTagRules();
				for (const rule of materialized) {
					const extra = legacyKeywords[rule.tag];
					if (Array.isArray(extra) && extra.length) rule.keywords = rule.keywords.concat(extra);
				}
				state.autoTagRules = materialized;
				persistAutoTagRules();
			} else {
				state.autoTagRules = null;
			}
		}
	}

	async function openFolder() {
		try {
			SLRViews.renderLoading(_container, 'Opening folder...');
			await SLRData.openFolder();
			state.folderName = SLRData.workspaceLabel || '';

			await hydrateSettingsFromConfig();
			await loadProjectsAndStats();
			state.currentFolder = null;
			state.currentProject = null;
			state.projectData = null;
			state.articles = [];

			// A folder was successfully opened — always go to the Projects view,
			// even with zero projects. Its empty state guides the user to create
			// a first project; routing back to Welcome here made a successful,
			// brand-new-folder pick look like nothing happened.
			state.view = 'projects';
			renderCurrentView();
		} catch (err) {
			SLRViews.renderError(_container, err.message || String(err));
		}
	}

	async function restoreWorkspaceAtStartup() {
		// The two backends restore fundamentally different things (an FSA
		// directory handle vs. a signed-in Supabase session), so this branches
		// explicitly rather than forcing both through one abstract call.
		const connected = SLRData.getBackend() === 'cloud'
			? await SLRData.restoreSession()
			: await SLRData.restoreFolder();
		if (!connected) {
			state.view = 'welcome';
			renderCurrentView();
			return;
		}

		state.folderName = SLRData.workspaceLabel || '';
		await hydrateSettingsFromConfig();
		await loadProjectsAndStats();

		// Reconnecting the workspace above only restores the folder handle /
		// auth session — resume the specific project (and view within it) the
		// user actually had open, so a reload doesn't drop them back on the
		// Projects list. hydrateProject (not openProject) here since it just
		// loads data without forcing state.view to 'articles'.
		const lastFolder = localStorage.getItem(LAST_ACTIVE_FOLDER_KEY);
		const lastView   = localStorage.getItem(LAST_ACTIVE_VIEW_KEY);
		if (lastFolder && state.projects.some(p => p.workspace_folder === lastFolder)) {
			try {
				await hydrateProject(lastFolder);
				state.view = (lastView && lastView !== 'welcome') ? lastView : 'articles';
				renderCurrentView();
				return;
			} catch (_) {
				// Fall through to the plain Projects list below.
			}
		} else if (lastFolder) {
			clearActiveProjectView(); // stale — e.g. the project was deleted/renamed since
		}

		state.view = 'projects';
		renderCurrentView();
	}

	function resetWorkspaceState() {
		state.currentFolder = null;
		state.currentProject = null;
		state.projectData = null;
		state.articles = [];
		state.projects = [];
		state.folderName = '';
		// Switching backend/signing out means the next restore is a different
		// workspace entirely — a folder name persisted from the old one could
		// coincidentally collide with a project in the new one.
		clearActiveProjectView();
	}

	function switchBackend(name) {
		SLRData.setBackend(name);
		resetWorkspaceState();
		state.view = 'settings';
		renderCurrentView();
	}

	// action: 'signin' | 'signup' | 'magiclink'. Throws on failure — the
	// Settings/Welcome forms display the error inline; on success this loads
	// the cloud workspace the same way openFolder() does locally. Returns
	// { confirmed: false } for a signup that needs email confirmation before
	// it can do anything else — the caller is expected to tell the user to
	// check their inbox instead of treating them as signed in.
	async function cloudAuth(action, email, password) {
		if (action === 'signin') {
			await SLRDataCloud.signIn(email, password);
		} else if (action === 'signup') {
			const { confirmed } = await SLRDataCloud.signUp(email, password);
			if (!confirmed) return { confirmed: false };
		} else if (action === 'magiclink') {
			await SLRDataCloud.signInWithMagicLink(email);
			return;
		} else {
			return;
		}

		// Reachable directly from Home now (Sign Up/Log In), which never
		// passes through Settings' "Active workspace" radio button — the only
		// other place this used to get set. Without this, a successful
		// Supabase sign-in silently kept routing every subsequent SLRData.*
		// call at the local-folder backend instead ("No folder open").
		SLRData.setBackend('cloud');
		state.folderName = SLRData.workspaceLabel || '';
		await hydrateSettingsFromConfig();
		await loadProjectsAndStats();
		state.view = 'projects';
		renderCurrentView();
	}

	async function cloudSignOut() {
		await SLRDataCloud.signOut();
		resetWorkspaceState();
		renderCurrentView();
	}

	function setFilter(patch) {
		// Any real filter change restarts pagination at the top — see
		// bumpArticlesRenderLimit, the only place that's allowed to grow it.
		state.filter = { ...state.filter, ...patch, renderLimit: ARTICLE_PAGE_SIZE };
		renderCurrentView();
	}

	function bumpArticlesRenderLimit() {
		state.filter = { ...state.filter, renderLimit: (state.filter.renderLimit || ARTICLE_PAGE_SIZE) + ARTICLE_PAGE_SIZE };
		renderCurrentView();
	}

	function setFetchMode(mode) {
		const normalized = mode === 'all' ? 'all' : 'missing';
		state.fetchMode = normalized;
		localStorage.setItem('slr-fetch-mode', normalized);
		renderCurrentView();
	}

	function setProjectsSort(sort) {
		const valid = ['newest', 'oldest', 'az', 'za', 'recent'];
		state.projectsSort = valid.includes(sort) ? sort : 'newest';
		localStorage.setItem('slr-projects-sort', state.projectsSort);
		renderCurrentView();
	}

	function toggleProjectPin(folder) {
		if (!folder) return;
		if (state.pinnedProjects.has(folder)) {
			state.pinnedProjects.delete(folder);
		} else {
			state.pinnedProjects.add(folder);
		}
		localStorage.setItem('slr-pinned-projects', JSON.stringify([...state.pinnedProjects]));
		renderCurrentView();
	}

	// Project card icons: { type: 'emoji'|'svg'|'text', value }. Always
	// cached client-side in localStorage first (instant, and a fallback for
	// projects saved before either backend could persist icons), then
	// persisted through the active backend — projects.json on local,
	// the `projects.icon` column on cloud (see supabase/schema.sql; older
	// Supabase projects need that column's migration run once).
	async function setProjectIcon(folder, icon) {
		if (!folder) return;
		let iconMap;
		try {
			iconMap = JSON.parse(localStorage.getItem('slr-project-icons') || '{}');
		} catch (_) {
			iconMap = {};
		}
		if (icon) iconMap[folder] = icon; else delete iconMap[folder];
		localStorage.setItem('slr-project-icons', JSON.stringify(iconMap));

		const idx = state.projects.findIndex(p => p.workspace_folder === folder);
		if (idx >= 0) state.projects[idx] = { ...state.projects[idx], icon: icon || undefined };
		renderCurrentView();

		try { await SLRData.saveProjectIcon(folder, icon); } catch (_) { /* best-effort */ }
	}

	function setCorpusFilter(patch) {
		state.corpusFilter = { ...state.corpusFilter, ...patch, renderLimit: ARTICLE_PAGE_SIZE };
		renderCurrentView();
	}

	function bumpCorpusRenderLimit() {
		state.corpusFilter = { ...state.corpusFilter, renderLimit: (state.corpusFilter.renderLimit || ARTICLE_PAGE_SIZE) + ARTICLE_PAGE_SIZE };
		renderCurrentView();
	}

	function setSelectedFilter(patch) {
		state.selectedFilter = { ...state.selectedFilter, ...patch, renderLimit: ARTICLE_PAGE_SIZE };
		renderCurrentView();
	}

	function bumpSelectedRenderLimit() {
		state.selectedFilter = { ...state.selectedFilter, renderLimit: (state.selectedFilter.renderLimit || ARTICLE_PAGE_SIZE) + ARTICLE_PAGE_SIZE };
		renderCurrentView();
	}

	function toggleTagBreakdown() {
		state.tagBreakdownVisible = !state.tagBreakdownVisible;
		localStorage.setItem('slr-tag-breakdown-visible', state.tagBreakdownVisible ? '1' : '0');
		renderCurrentView();
	}

	async function updateAnnotation(eid, fields) {
		if (!state.currentFolder || !eid) return;
		try {
			const saved = await SLRData.updateArticleAnnotation(state.currentFolder, eid, fields);
			if (!state.projectData.globalTags) state.projectData.globalTags = {};
			state.projectData.globalTags[eid] = {
				...(state.projectData.globalTags[eid] || {}),
				...saved,
			};
			state.articles = SLRData.getArticles(state.projectData);
			renderCurrentView();
		} catch (err) {
			showToast('Could not save annotation: ' + (err.message || String(err)), true);
		}
	}

	// Targets an explicit folder (not just state.currentFolder) so the inline
	// info panel on any project card can be edited, not only the one that
	// happens to be currently open.
	async function updateProjectMeta(folder, name, description) {
		if (!folder) return;
		try {
			const updated = await SLRData.saveProjectMeta(folder, name, description);
			if (folder === state.currentFolder) state.currentProject = updated;
			const idx = state.projects.findIndex(p => p.workspace_folder === folder);
			if (idx >= 0) state.projects[idx] = { ...state.projects[idx], ...updated };
			showToast('Project updated.', false);
			renderCurrentView();
		} catch (err) {
			showToast('Could not update project: ' + (err.message || String(err)), true);
		}
	}

	async function saveSettings({ apiKey, instToken, openAlexKey, openAlexEmail, autoFetchEnabled, fetchMode, autoTagEnabled, autoRunScope, autoTagCategories }) {
		state.settings.apiKey = normalizePrimaryCredential(apiKey);
		state.settings.instToken = normalizeToken(instToken);
		state.settings.openAlexKey = normalizeToken(openAlexKey);
		state.settings.openAlexEmail = normalizeEmail(openAlexEmail);
		state.settings.autoFetchEnabled = !!autoFetchEnabled;
		state.settings.autoTagEnabled = !!autoTagEnabled;
		state.settings.autoRunScope = autoRunScope === 'new' ? 'new' : 'all';
		state.settings.autoTagCategories = Array.isArray(autoTagCategories) ? autoTagCategories : [];
		state.fetchMode = fetchMode === 'all' ? 'all' : 'missing';
		localStorage.setItem('slr-apikey', state.settings.apiKey);
		localStorage.setItem('slr-insttoken', state.settings.instToken);
		localStorage.setItem('slr-openalex-key', state.settings.openAlexKey);
		localStorage.setItem('slr-openalex-email', state.settings.openAlexEmail);
		localStorage.setItem('slr-auto-fetch-enabled', state.settings.autoFetchEnabled ? '1' : '0');
		localStorage.setItem('slr-auto-tag-enabled', state.settings.autoTagEnabled ? '1' : '0');
		localStorage.setItem('slr-auto-run-scope', state.settings.autoRunScope);
		localStorage.setItem('slr-auto-tag-categories', JSON.stringify(state.settings.autoTagCategories));
		localStorage.setItem('slr-fetch-mode', state.fetchMode);

		// Persist credentials into THIS folder's own slr_config.json (creating it
		// if missing) so they're tied to the folder, not just this browser —
		// critical for correctness (a different folder must never see them) and
		// for parity with the desktop app's config file.
		if (SLRData.hasWorkspace()) {
			try {
				await SLRData.saveConfig({
					APIKey: state.settings.apiKey,
					InstToken: state.settings.instToken,
					OpenAlexKey: state.settings.openAlexKey,
					OpenAlexEmail: state.settings.openAlexEmail,
				});
			} catch (_) {
				// Non-fatal: settings still work for this session via localStorage/state.
			}
		}
	}

	function mapScopusResult(r) {
		// The COMPLETE view (see "View" in slr_config.json) returns a full `author`
		// array; STANDARD only returns `dc:creator` (first author). Prefer the full
		// list when present, joined with ', ' to match every other source mapper.
		const fullAuthors = Array.isArray(r.author)
			? r.author
				.map(a => [a && a['given-name'], a && a.surname].filter(Boolean).join(' ').trim() || (a && a.authname) || '')
				.filter(Boolean)
				.join(', ')
			: '';
		return {
			source: 'scopus',
			eid: r.eid || '',
			title: r['dc:title'] || r.title || '',
			authors: fullAuthors || r['dc:creator'] || r.authors || '',
			date: r['prism:coverDate'] || r.coverDate || '',
			citedby: String(r['citedby-count'] || r.citedby || '0'),
			doi: r['prism:doi'] || r.doi || '',
			publicationName: r['prism:publicationName'] || r.publicationName || '',
			abstract: r['dc:description'] || r.description || '',
			affiliationCountries: [],
			affiliations: [],
			openAlexFields: [],
			openAlexSubfields: [],
			docType: null,
		};
	}

	function mapPubmedResult(r) {
		const pmid = r.uid || r.pmid || r.id || '';
		const pubDate = r.pubdate || r.sortpubdate || '';
		return {
			source: 'pubmed',
			eid: pmid ? `pmid:${pmid}` : '',
			title: r.title || '',
			authors: Array.isArray(r.authors)
				? r.authors.map(a => a.name).filter(Boolean).join(', ')
				: '',
			date: pubDate,
			citedby: '0',
			doi: Array.isArray(r.articleids)
				? ((r.articleids.find(x => x.idtype === 'doi') || {}).value || '')
				: '',
			publicationName: r.fulljournalname || r.source || '',
			abstract: '',
			affiliationCountries: [],
			affiliations: [],
			openAlexFields: [],
			openAlexSubfields: [],
			docType: null,
		};
	}

	function mapOpenAlexResult(r) {
		const doi = r.doi ? String(r.doi).replace(/^https?:\/\/doi.org\//i, '') : '';
		const affiliationCountries = new Set();
		const affiliations = new Set();
		const openAlexFields = new Set();
		const openAlexSubfields = new Set();
		if (Array.isArray(r.authorships)) {
			for (const authorship of r.authorships) {
				if (!Array.isArray(authorship.institutions)) continue;
				for (const institution of authorship.institutions) {
					if (institution && institution.display_name) affiliations.add(String(institution.display_name).trim());
					const code = institution && (institution.country_code || institution.countryCode || institution.country);
					if (code) affiliationCountries.add(String(code).trim().toUpperCase());
				}
			}
		}
		if (r.primary_topic) {
			const fieldName = r.primary_topic.field && r.primary_topic.field.display_name;
			const subfieldName = r.primary_topic.subfield && r.primary_topic.subfield.display_name;
			if (fieldName) openAlexFields.add(String(fieldName).trim());
			if (subfieldName) openAlexSubfields.add(String(subfieldName).trim());
		}
		if (Array.isArray(r.topics)) {
			for (const topic of r.topics) {
				const fieldName = topic && topic.field && topic.field.display_name;
				const subfieldName = topic && topic.subfield && topic.subfield.display_name;
				if (fieldName) openAlexFields.add(String(fieldName).trim());
				if (subfieldName) openAlexSubfields.add(String(subfieldName).trim());
			}
		}
		// OpenAlex includes each work's outgoing references in every normal
		// /works response (no extra API call) as full URLs like
		// "https://openalex.org/W123..." — stripped down to the bare ID here
		// so the citation-network builder can match them against other
		// articles' `openalex:W123...` eids directly.
		const referencedWorks = Array.isArray(r.referenced_works)
			? r.referenced_works.map(u => String(u).split('/').pop()).filter(Boolean)
			: [];
		return {
			source: 'openalex',
			eid: r.id ? `openalex:${String(r.id).split('/').pop()}` : '',
			title: r.display_name || '',
			authors: Array.isArray(r.authorships)
				? r.authorships.map(a => a.author && a.author.display_name).filter(Boolean).join(', ')
				: '',
			date: r.publication_date || (r.publication_year ? `${r.publication_year}-01-01` : ''),
			citedby: String(r.cited_by_count || 0),
			doi,
			publicationName: r.primary_location && r.primary_location.source ? (r.primary_location.source.display_name || '') : '',
			abstract: '',
			affiliationCountries: [...affiliationCountries],
			affiliations: [...affiliations],
			openAlexFields: [...openAlexFields],
			openAlexSubfields: [...openAlexSubfields],
			docType: mapOpenAlexType(r.type),
			referencedWorks,
		};
	}

	function mapCrossrefSearchResult(item) {
		const authors = Array.isArray(item && item.author)
			? item.author.map(a => [a.given, a.family].filter(Boolean).join(' ').trim()).filter(Boolean).join(', ')
			: '';
		const dateParts = (item && item.issued && Array.isArray(item.issued['date-parts']) && item.issued['date-parts'][0]) || [];
		const year = dateParts[0] || '';
		const month = String(dateParts[1] || 1).padStart(2, '0');
		const day = String(dateParts[2] || 1).padStart(2, '0');
		const date = year ? `${year}-${month}-${day}` : '';
		const doi = item && item.DOI ? String(item.DOI).replace(/^https?:\/\/doi.org\//i, '') : '';
		return {
			source: 'openalex',
			eid: doi ? `crossref:${doi}` : '',
			title: (Array.isArray(item && item.title) ? item.title[0] : '') || item.display_name || '',
			authors,
			date,
			citedby: String((item && item['is-referenced-by-count']) || 0),
			doi,
			publicationName: (Array.isArray(item && item['container-title']) ? item['container-title'][0] : '') || '',
			abstract: item && item.abstract ? String(item.abstract) : '',
			affiliationCountries: [],
			affiliations: [],
			openAlexFields: [],
			openAlexSubfields: [],
			docType: mapCrossrefType(item && item.type ? String(item.type) : null),
		};
	}

	function dedupeByIdentity(rows) {
		const out = [];
		const seen = new Set();
		for (const row of rows || []) {
			if (!row) continue;
			// Prefer DOI (case-normalized) as the identity key: the OpenAlex fallback
			// path mixes rows from OpenAlex (eid `openalex:...`) and Crossref
			// (eid `crossref:...`) that can describe the same work with different
			// synthetic eids but the same DOI — keying on eid alone let those survive
			// as duplicates.
			const doiKey = row.doi ? `doi:${String(row.doi).trim().toLowerCase()}` : '';
			const key = doiKey || row.eid || row.title;
			if (!key || seen.has(key)) continue;
			seen.add(key);
			out.push(row);
		}
		return out;
	}

	function extractOpenAlexFallbackTerms(query) {
		const raw = String(query || '').trim();
		if (!raw) return [];
		const terms = [];
		const pushTerm = value => {
			const normalized = String(value || '').replace(/\s+/g, ' ').trim();
			if (!normalized) return;
			if (/^(and|or|not)$/i.test(normalized)) return;
			if (!terms.some(existing => existing.toLowerCase() === normalized.toLowerCase())) terms.push(normalized);
		};

		for (const match of raw.matchAll(/"([^"]+)"/g)) pushTerm(match[1]);

		const stripped = raw
			.replace(/\b[TA-Z-]+\s*\(/g, ' ')
			.replace(/[()]/g, ' ')
			.replace(/\b(AND|OR|NOT|TITLE-ABS-KEY|TITLE|ABS|AUTHKEY|PUBYEAR|DOCTYPE|LANGUAGE)\b/gi, ' ')
			.replace(/[,*?#[\]{}]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		if (stripped && stripped.length <= 120) pushTerm(stripped);
		for (const chunk of stripped.split(/\b(?:and|or|not)\b/gi)) {
			const normalized = chunk.trim();
			if (normalized.length >= 3) pushTerm(normalized);
		}
		return terms.slice(0, 8);
	}

	function parseScopusServiceError(body) {
		if (!body) return '';
		try {
			const parsed = JSON.parse(body);
			const status = parsed && parsed['service-error'] && parsed['service-error'].status;
			if (status) return [status.statusCode, status.statusText].filter(Boolean).join(': ');
		} catch (_) { /* not JSON */ }
		return body.slice(0, 200);
	}

	// Lightweight connectivity probe for the Settings view's "Test API Key" button
	// and for diagnosing "unable to authenticate"-style errors without running a
	// full search. Checks STANDARD view (basic key validity) and, only if that
	// succeeds, COMPLETE view (the view configured via slr_config.json's "View").
	async function testScopusApiKey(overrideApiKey, overrideInstToken) {
		const config = await SLRData.loadConfig();
		// Prefer whatever is currently typed in the Settings form (even if unsaved)
		// so a key can be verified before committing it.
		const apiKey = normalizePrimaryCredential(overrideApiKey || (config && config.APIKey) || state.settings.apiKey);
		const instToken = normalizeToken(
			overrideInstToken != null && overrideInstToken !== '' ? overrideInstToken : ((config && config.InstToken) || state.settings.instToken)
		);
		if (!apiKey) return { hasKey: false };

		const headers = {
			'Accept': 'application/json',
			'X-ELS-APIKey': apiKey,
			...(instToken ? { 'X-ELS-Insttoken': instToken } : {}),
		};

		const probe = async view => {
			const url = new URL('https://api.elsevier.com/content/search/scopus');
			url.searchParams.set('query', 'TITLE-ABS-KEY(test)');
			url.searchParams.set('count', '1');
			url.searchParams.set('view', view);
			try {
				const res = await fetch(url.toString(), { headers });
				const body = await res.text().catch(() => '');
				return { ok: res.ok, status: res.status, detail: res.ok ? '' : parseScopusServiceError(body) };
			} catch (err) {
				return { ok: false, status: 0, detail: err && err.message ? err.message : 'Network error' };
			}
		};

		const std = await probe('STANDARD');
		const complete = std.ok ? await probe('COMPLETE') : null;
		return { hasKey: true, keyPreview: apiKey.slice(0, 6) + '…', std, complete };
	}

	async function runScopusSearch(query, maxResults, signal) {
		const config = await SLRData.loadConfig();
		const apiKey = normalizePrimaryCredential((config && config.APIKey) || state.settings.apiKey);
		const instToken = normalizeToken((config && config.InstToken) || state.settings.instToken);
		if (!apiKey) throw new Error('Scopus API key missing. Configure it in Settings.');
		state.settings.apiKey = apiKey;
		state.settings.instToken = instToken;
		localStorage.setItem('slr-apikey', apiKey);
		localStorage.setItem('slr-insttoken', instToken);
		// Honor the "View" mode (STANDARD/COMPLETE) from the legacy desktop config,
		// same as src/api/client.py — the web app previously always forced STANDARD,
		// silently discarding COMPLETE-view entitlements some API keys have.
		let scopusView = (config && config.View ? String(config.View).trim().toUpperCase() : '') || 'STANDARD';

		const headers = {
			'Accept': 'application/json',
			'X-ELS-APIKey': apiKey,
			...(instToken ? { 'X-ELS-Insttoken': instToken } : {}),
		};
		const batchSize = 25;
		const allResults = [];
		let start = 0;
		let totalResults = null;
		const retryDelays = [0, 800, 2000, 4000, 8000];

		while (allResults.length < maxResults) {
			if (allResults.length > 0) await delay(200, signal);

			const buildUrl = view => {
				const url = new URL('https://api.elsevier.com/content/search/scopus');
				url.searchParams.set('query', query);
				url.searchParams.set('count', String(Math.min(batchSize, maxResults - allResults.length)));
				url.searchParams.set('start', String(start));
				url.searchParams.set('view', view);
				return url;
			};

			let data = null;
			let lastError = null;
			for (let attempt = 0; attempt < retryDelays.length; attempt++) {
				if (retryDelays[attempt] > 0) await delay(retryDelays[attempt], signal);
				let res;
				try {
					res = await fetch(buildUrl(scopusView).toString(), { headers, signal });
				} catch (err) {
					if (err && err.name === 'AbortError') throw err;
					lastError = new Error(`Scopus API request failed: ${err && err.message ? err.message : 'network error'}`);
					continue;
				}
				if (res.ok) {
					data = await res.json();
					lastError = null;
					break;
				}
				const body = await res.text().catch(() => '');
				lastError = new Error(`Scopus API error ${res.status}${body ? `: ${body.slice(0, 240)}` : ''}`);
				lastError.status = res.status;
				// Elsevier reports "not authorized for this view" inconsistently — usually
				// 401/403 AUTHORIZATION_ERROR, but sometimes HTTP 500 GENERAL_SYSTEM_ERROR
				// with "Unable to authenticate" in the body for the exact same underlying
				// cause. Detect by body content, not just status code, so a COMPLETE-view
				// entitlement failure doesn't get treated as a retryable transient error.
				const looksLikeAuthIssue = /authenticat|authoriz/i.test(body);
				if (looksLikeAuthIssue) {
					if (scopusView !== 'STANDARD') {
						scopusView = 'STANDARD';
						continue;
					}
					// STANDARD view itself failed to authenticate — this is a genuine key
					// problem (invalid/revoked/no entitlement), not a transient error, so
					// don't burn all retry attempts on an error that won't self-resolve.
					lastError = new Error(`Scopus API key rejected (${res.status}): ${body ? body.slice(0, 240) : 'authentication failed'}. Check the key in Settings.`);
					lastError.status = res.status;
					break;
				}
				// Only retry on transient errors (rate limiting / server-side issues).
				if (![429, 500, 502, 503, 504].includes(res.status)) break;
			}
			if (!data) {
				if (allResults.length) break;
				throw lastError || new Error('Scopus API error');
			}

			const searchResults = (data || {})['search-results'] || {};
			const entries = searchResults.entry || [];
			if (totalResults == null) {
				const parsedTotal = parseInt(searchResults['opensearch:totalResults'], 10);
				totalResults = Number.isFinite(parsedTotal) ? parsedTotal : 0;
			}
			if (!entries.length) break;
			allResults.push(...entries.map(mapScopusResult).filter(x => x.eid || x.doi));
			start += batchSize;
			if (totalResults != null && start >= totalResults) break;
		}

		return allResults.slice(0, maxResults);
	}

	async function runPubmedSearch(query, maxResults, signal) {
		// NCBI accepts large retmax values in a single eSearch call (verified up to
		// 9999); no artificial cap needed below the UI's own 10,000 max-results limit.
		const esearch = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi');
		esearch.searchParams.set('db', 'pubmed');
		esearch.searchParams.set('retmode', 'json');
		esearch.searchParams.set('retmax', String(Math.min(maxResults, 10000)));
		esearch.searchParams.set('term', query);
		const r1 = await fetch(esearch.toString(), { signal });
		if (!r1.ok) throw new Error(`PubMed eSearch error ${r1.status}`);
		const d1 = await r1.json();
		const ids = (((d1 || {}).esearchresult || {}).idlist) || [];
		if (!ids.length) return [];

		// Batch eSummary lookups (POST, to avoid multi-thousand-character GET URLs)
		// and respect NCBI's ~3 req/s unauthenticated rate limit between batches.
		const batchSize = 200;
		const out = [];
		for (let i = 0; i < ids.length; i += batchSize) {
			if (i > 0) await delay(350, signal);
			const batch = ids.slice(i, i + batchSize);
			const body = new URLSearchParams({ db: 'pubmed', retmode: 'json', id: batch.join(',') });
			const r2 = await fetch('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
				signal,
			});
			if (!r2.ok) throw new Error(`PubMed eSummary error ${r2.status}`);
			const d2 = await r2.json();
			for (const id of batch) {
				const row = d2.result && d2.result[id];
				if (row) out.push(mapPubmedResult(row));
			}
		}
		return out;
	}

	async function fetchOpenAlexPage(query, signal, options) {
		const config = await SLRData.loadConfig();
		const openAlexKey = normalizeToken((config && config.OpenAlexKey) || state.settings.openAlexKey);
		const openAlexEmail = normalizeEmail((config && (config.OpenAlexEmail || config.OpenAlexMailto)) || state.settings.openAlexEmail);
		state.settings.openAlexKey = openAlexKey;
		state.settings.openAlexEmail = openAlexEmail;
		localStorage.setItem('slr-openalex-key', openAlexKey);
		localStorage.setItem('slr-openalex-email', openAlexEmail);
		const url = new URL('https://api.openalex.org/works');
		if (query.includes(':') && query.includes(',')) {
			url.searchParams.set('filter', query);
		} else {
			url.searchParams.set('search', query);
		}
		url.searchParams.set('per-page', String(options.perPage || 200));
		if (options.cursor) url.searchParams.set('cursor', options.cursor);
		if (options.page) url.searchParams.set('page', String(options.page));
		if (openAlexKey) url.searchParams.set('api_key', openAlexKey);
		if (openAlexEmail) url.searchParams.set('mailto', openAlexEmail);
		const res = await fetch(url.toString(), { signal });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			let detail = '';
			if (body) {
				try {
					const parsed = JSON.parse(body);
					detail = parsed.message || parsed.error || body;
				} catch (_) {
					detail = body;
				}
				detail = String(detail || '').replace(/\s+/g, ' ').trim();
			}
			if (res.status === 503 && !openAlexKey && !openAlexEmail) {
				detail = `${detail ? `${detail} ` : ''}Add an OpenAlex API key or contact email in Settings to avoid anonymous-search rate limits.`.trim();
			}
			const error = new Error(`OpenAlex API error ${res.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`);
			error.status = res.status;
			throw error;
		}
		return await res.json();
	}

	async function fetchOpenAlexPageWithRetry(query, signal, options) {
		const delays = [0, 700, 1500, 3000];
		let lastError = null;
		for (let attempt = 0; attempt < delays.length; attempt++) {
			if (delays[attempt] > 0) await delay(delays[attempt], signal);
			try {
				return await fetchOpenAlexPage(query, signal, options);
			} catch (err) {
				if (err && err.name === 'AbortError') throw err;
				lastError = err;
				if (!err || (err.status !== 429 && err.status !== 500 && err.status !== 503)) {
					throw err;
				}
			}
		}
		throw lastError || new Error('OpenAlex API error');
	}

	async function fetchOpenAlexAuxList(entity, term, limit, signal) {
		const url = new URL(`https://api.openalex.org/${entity}`);
		url.searchParams.set('search', term);
		url.searchParams.set('per-page', String(limit));
		const res = await fetch(url.toString(), { signal });
		if (!res.ok) return [];
		const data = await res.json();
		return Array.isArray(data && data.results) ? data.results : [];
	}

	async function fetchOpenAlexAutocompleteWorks(term, signal) {
		const url = new URL('https://api.openalex.org/autocomplete/works');
		url.searchParams.set('q', term);
		const res = await fetch(url.toString(), { signal });
		if (!res.ok) return [];
		const data = await res.json();
		const results = Array.isArray(data && data.results) ? data.results : [];
		const out = [];
		for (const row of results) {
			const shortId = row && row.short_id ? String(row.short_id).replace(/^works\//i, '') : '';
			if (!shortId) continue;
			out.push({
				source: 'openalex',
				eid: `openalex:${shortId}`,
				title: row.display_name || '',
				authors: '',
				date: '',
				citedby: '0',
				doi: '',
				publicationName: '',
				abstract: '',
				affiliationCountries: [],
				affiliations: [],
				docType: null,
			});
		}
		return out;
	}

	async function fetchOpenAlexWorksByFilter(filter, maxResults, signal) {
		const rows = [];
		let page = 1;
		while (rows.length < maxResults) {
			if (rows.length > 0) await delay(120, signal);
			const url = new URL('https://api.openalex.org/works');
			url.searchParams.set('filter', filter);
			url.searchParams.set('sort', 'cited_by_count:desc');
			url.searchParams.set('per-page', String(Math.min(100, maxResults - rows.length)));
			url.searchParams.set('page', String(page));
			const res = await fetch(url.toString(), { signal });
			if (!res.ok) break;
			const data = await res.json();
			const batch = Array.isArray(data && data.results) ? data.results : [];
			if (!batch.length) break;
			rows.push(...batch.map(mapOpenAlexResult).filter(x => x.eid || x.doi));
			if (batch.length < 100) break;
			page += 1;
		}
		return rows;
	}

	// Two dedicated, narrow-purpose fetchers for the citation-network modal's
	// "load external references / citations" buttons — kept separate from
	// fetchOpenAlexWorksByFilter above (used by the search fallback path)
	// rather than generalizing it, so this feature can't regress that
	// unrelated, already-working code path.
	async function fetchExternalReferencedWorks(ids, signal) {
		if (!ids.length) return [];
		const config = await SLRData.loadConfig();
		const openAlexKey = normalizeToken((config && config.OpenAlexKey) || state.settings.openAlexKey);
		const openAlexEmail = normalizeEmail((config && (config.OpenAlexEmail || config.OpenAlexMailto)) || state.settings.openAlexEmail);
		const url = new URL('https://api.openalex.org/works');
		url.searchParams.set('filter', `openalex_id:${ids.join('|')}`);
		url.searchParams.set('per-page', String(ids.length));
		if (openAlexKey) url.searchParams.set('api_key', openAlexKey);
		if (openAlexEmail) url.searchParams.set('mailto', openAlexEmail);
		const res = await fetch(url.toString(), { signal });
		if (!res.ok) throw new Error(`OpenAlex API error ${res.status}`);
		const data = await res.json();
		const results = Array.isArray(data && data.results) ? data.results : [];
		return results.map(mapOpenAlexResult);
	}

	async function fetchExternalCitingWorks(openAlexId, page, signal) {
		const config = await SLRData.loadConfig();
		const openAlexKey = normalizeToken((config && config.OpenAlexKey) || state.settings.openAlexKey);
		const openAlexEmail = normalizeEmail((config && (config.OpenAlexEmail || config.OpenAlexMailto)) || state.settings.openAlexEmail);
		const PER_PAGE = 20;
		const url = new URL('https://api.openalex.org/works');
		url.searchParams.set('filter', `cites:${openAlexId}`);
		url.searchParams.set('sort', 'cited_by_count:desc');
		url.searchParams.set('per-page', String(PER_PAGE));
		url.searchParams.set('page', String(page));
		if (openAlexKey) url.searchParams.set('api_key', openAlexKey);
		if (openAlexEmail) url.searchParams.set('mailto', openAlexEmail);
		const res = await fetch(url.toString(), { signal });
		if (!res.ok) throw new Error(`OpenAlex API error ${res.status}`);
		const data = await res.json();
		const results = Array.isArray(data && data.results) ? data.results : [];
		const totalCount = (data && data.meta && data.meta.count) || 0;
		return { items: results.map(mapOpenAlexResult), hasMore: page * PER_PAGE < totalCount };
	}

	async function fetchCrossrefQueryFallback(query, maxResults, signal) {
		const url = new URL('https://api.crossref.org/works');
		url.searchParams.set('query.bibliographic', query);
		url.searchParams.set('rows', String(Math.min(maxResults, 200)));
		url.searchParams.set('mailto', 'slr-harvester-web@example.invalid');
		const res = await fetch(url.toString(), { signal });
		if (!res.ok) return [];
		const data = await res.json();
		const items = (data && data.message && Array.isArray(data.message.items)) ? data.message.items : [];
		return items.map(mapCrossrefSearchResult).filter(x => x.eid || x.doi || x.title);
	}

	async function runOpenAlexFallbackSearch(query, maxResults, signal) {
		const terms = extractOpenAlexFallbackTerms(query);
		let rows = [];
		for (const term of terms) {
			if (rows.length >= maxResults) break;
			const [keywords, topics, autocompleteRows] = await Promise.all([
				fetchOpenAlexAuxList('keywords', term, 4, signal),
				fetchOpenAlexAuxList('topics', term, 3, signal),
				fetchOpenAlexAutocompleteWorks(term, signal),
			]);

			rows.push(...autocompleteRows);

			const keywordIds = keywords
				.map(item => item && item.id ? String(item.id).split('/').pop() : '')
				.filter(Boolean)
				.slice(0, 3);
			if (keywordIds.length && rows.length < maxResults) {
				rows.push(...await fetchOpenAlexWorksByFilter(`keywords.id:${keywordIds.join('|')}`, Math.min(100, maxResults - rows.length), signal));
			}

			const topicIds = topics
				.map(item => item && item.id ? String(item.id).split('/').pop() : '')
				.filter(Boolean)
				.slice(0, 2);
			if (topicIds.length && rows.length < maxResults) {
				rows.push(...await fetchOpenAlexWorksByFilter(`topics.id:${topicIds.join('|')}`, Math.min(100, maxResults - rows.length), signal));
			}
			rows = dedupeByIdentity(rows);
		}

		if (rows.length < Math.min(25, maxResults)) {
			rows.push(...await fetchCrossrefQueryFallback(extractOpenAlexFallbackTerms(query)[0] || query, maxResults - rows.length, signal));
		}
		return dedupeByIdentity(rows).slice(0, maxResults);
	}

	async function runOpenAlexSearch(query, maxResults, signal) {
		const allResults = [];
		let cursor = '*';
		let page = 1;
		const perPage = 200;
		let usedPageFallback = false;

		while (allResults.length < maxResults) {
			if (allResults.length > 0) await delay(150, signal);
			let data;
			try {
				data = await fetchOpenAlexPageWithRetry(query, signal,
					usedPageFallback ? { perPage, page } : { perPage, cursor });
			} catch (err) {
				if (err && err.name === 'AbortError') throw err;
				if (err && (err.status === 429 || err.status === 500 || err.status === 503)) {
					if (!usedPageFallback) {
						// Cursor-based pagination failed repeatedly; retry this same page with
						// classic offset pagination before giving up on the real search entirely.
						usedPageFallback = true;
						try {
							data = await fetchOpenAlexPageWithRetry(query, signal, { perPage, page });
						} catch (fallbackErr) {
							if (fallbackErr && fallbackErr.name === 'AbortError') throw fallbackErr;
							if (allResults.length) return allResults.slice(0, maxResults);
							const fallbackRows = await runOpenAlexFallbackSearch(query, maxResults, signal);
							if (fallbackRows.length) return fallbackRows;
							throw fallbackErr;
						}
					} else if (allResults.length) {
						return allResults.slice(0, maxResults);
					} else {
						const fallbackRows = await runOpenAlexFallbackSearch(query, maxResults, signal);
						if (fallbackRows.length) return fallbackRows;
						throw err;
					}
				} else {
					throw err;
				}
			}

			const rows = (data && data.results) || [];
			if (!rows.length) break;
			allResults.push(...rows.map(mapOpenAlexResult).filter(x => x.eid || x.doi));
			if (allResults.length >= maxResults) break;
			if (usedPageFallback) {
				page += 1;
				if (rows.length < perPage) break;
			} else {
				cursor = data && data.meta && data.meta.next_cursor;
				if (!cursor) break;
			}
		}

		return allResults.slice(0, maxResults);
	}

	// Past Terms should hold reusable search terms, not the raw query string
	// verbatim. Rules: a quoted phrase is one term; a wildcard (algorithm*)
	// survives untouched since nothing here strips "*"; field codes and
	// boolean operators are never saved; everything else between AND/OR/NOT
	// (Scopus's W/n and PRE/n proximity operators count too) is one term,
	// same as a quoted phrase would be.
	function extractQueryTerms(query) {
		const terms = [];
		const seen = new Set();
		const addTerm = (text) => {
			const cleaned = String(text).replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
			if (!cleaned || !/[a-zA-Z]/.test(cleaned)) return; // skip empty/pure-number-or-punctuation leftovers
			const key = cleaned.toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			terms.push(cleaned);
		};

		// 1. Quoted phrases are their own terms — pulled out (and blanked)
		// before any further processing so a word like "and" inside a phrase
		// is never mistaken for the boolean operator.
		let rest = String(query || '').replace(/"([^"]+)"/g, (_, phrase) => {
			addTerm(phrase);
			return ' ';
		});

		// 2. Field-code wrappers (TITLE-ABS-KEY(...), AUTH(...), ...): the
		// ALL-CAPS code right before "(" is dropped, its parenthesised
		// content stays for the later steps.
		rest = rest.replace(/\b[A-Z][A-Z0-9-]*\s*\(/g, ' ');

		// 3. Bare numeric-field comparisons (PUBYEAR > 2019) — neither the
		// field name nor the lone number is a meaningful term.
		rest = rest.replace(/\b[A-Z][A-Z0-9-]*\s*(?:>=|<=|>|<|=)\s*\d+/g, ' ');

		// 4. OpenAlex-style "key:" / "key.sub:" filter prefixes.
		rest = rest.replace(/\b[a-zA-Z_][a-zA-Z0-9_.]*:(?:>|<)?/g, ' ');

		// 5. PubMed-style bracket field tags: term[TIAB], 2019:2024[PDAT].
		rest = rest.replace(/\[[^\]]*\]/g, ' ');

		// 6. Everything remaining, split on boolean/proximity operators —
		// each span between them is one word sequence, treated the same as
		// a quoted phrase.
		rest.split(/\b(?:AND\s+NOT|OR\s+NOT|AND|OR|NOT|W\/\d+|PRE\/\d+)\b/gi).forEach(addTerm);

		return terms;
	}

	async function executeSearch(query, maxResults, db) {
		if (!state.currentFolder) {
			showToast('Open a project first.', true);
			return;
		}

		state.search.query = query;
		state.search.maxResults = Math.max(1, maxResults || 500);
		state.search.db = db || state.search.db || 'scopus';
		state.search.error = null;
		state.search.lastCount = null;
		state.search.isSearching = true;
		state.search.abortController = new AbortController();
		setSearchProgress(2, 'Preparing query...');
		renderCurrentView();

		try {
			let results = [];
			if (state.search.db === 'scopus') {
				setSearchProgress(15, 'Querying Scopus...');
				results = await runScopusSearch(query, state.search.maxResults, state.search.abortController.signal);
			} else if (state.search.db === 'pubmed') {
				setSearchProgress(15, 'Querying PubMed...');
				results = await runPubmedSearch(query, state.search.maxResults, state.search.abortController.signal);
			} else {
				setSearchProgress(15, 'Querying OpenAlex...');
				results = await runOpenAlexSearch(query, state.search.maxResults, state.search.abortController.signal);
			}

			setSearchProgress(75, 'Saving results...');
			const runEntry = {
				timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
				query,
				view: state.search.db,
				count: results.length,
				results,
			};
			await SLRData.appendSearchResult(state.currentFolder, runEntry);
			const extractedTerms = extractQueryTerms(query);
			if (extractedTerms.length) await SLRData.saveQueryTerms(state.currentFolder, extractedTerms);

			await hydrateProject(state.currentFolder);

			// "New only" scope restricts automatic post-search enrichment/tagging to
			// the articles this run just returned, identified by the same eid/doi key
			// getArticles() uses; "all" (default, matches prior behavior) covers the
			// whole project.
			const newIds = new Set(results.map(r => r.eid || r.doi).filter(Boolean));
			const autoScopeIds = state.settings.autoRunScope === 'new' && newIds.size ? newIds : null;

			if (state.settings.autoFetchEnabled && results.length > 0) {
				setSearchProgress(85, 'Auto-fetching metadata...');
				await fetchAllMetadata({ mode: state.fetchMode, fromAutoFetch: true, scopeIds: autoScopeIds });
			}

			if (state.settings.autoTagEnabled && results.length > 0) {
				setSearchProgress(95, 'Auto-tagging...');
				await autoTagByJournal(false, autoScopeIds);
			}

			setSearchProgress(100, 'Done.');
			state.search.lastCount = results.length;
			showToast(`Search saved: ${results.length} result${results.length !== 1 ? 's' : ''}.`, false);
			markOnboardingStep('search');
		} catch (err) {
			if (err && err.name === 'AbortError') {
				state.search.error = 'Search cancelled.';
			} else {
				state.search.error = err.message || String(err);
				showToast(state.search.error, true);
			}
		} finally {
			state.search.isSearching = false;
			state.search.abortController = null;
			state.search.progress = 0;
			state.search.progressMsg = '';
			renderCurrentView();
		}
	}

	function cancelSearch() {
		if (state.search.abortController) {
			state.search.abortController.abort();
		}
	}

	// index is always the entry's position in the raw (unreversed, newest-first)
	// searchLog array as persisted on disk/cloud — NOT its position in whatever
	// sorted/filtered order the History view is currently displaying.
	async function setHistoryQueryStatus(index, status, toastMsg) {
		if (!state.currentFolder) {
			showToast('No project loaded.', true);
			return;
		}
		try {
			await SLRData.setSearchResultStatus(state.currentFolder, index, status);
			await hydrateProject(state.currentFolder);
			showToast(toastMsg, false);
			renderCurrentView();
		} catch (err) {
			showToast(err.message || String(err), true);
		}
	}

	function trashHistoryQuery(index) {
		return setHistoryQueryStatus(index, 'trashed', 'Query moved to trash.');
	}

	function archiveHistoryQuery(index) {
		return setHistoryQueryStatus(index, 'archived', 'Query archived.');
	}

	function restoreHistoryQuery(index) {
		return setHistoryQueryStatus(index, 'active', 'Query restored.');
	}

	async function permanentlyDeleteHistoryQuery(index) {
		if (!state.currentFolder) {
			showToast('No project loaded.', true);
			return;
		}
		try {
			await SLRData.deleteSearchResult(state.currentFolder, index);
			await hydrateProject(state.currentFolder);
			showToast('Query permanently deleted.', false);
			renderCurrentView();
		} catch (err) {
			showToast(err.message || String(err), true);
		}
	}

	function setHistoryStatusFilter(tab) {
		const valid = ['active', 'archived', 'trashed'];
		state.history.statusFilter = valid.includes(tab) ? tab : 'active';
		renderCurrentView();
	}

	function setHistorySortDir(dir) {
		state.history.sortDir = dir === 'asc' ? 'asc' : 'desc';
		renderCurrentView();
	}

	async function deleteQueryTerm(term) {
		if (!state.currentFolder) {
			showToast('No project loaded.', true);
			return;
		}
		const normalized = String(term || '').trim();
		if (!normalized) return;
		try {
			await SLRData.deleteQueryTerm(state.currentFolder, normalized);
			await hydrateProject(state.currentFolder);
			showToast('Search term deleted.', false);
			renderCurrentView();
		} catch (err) {
			showToast(err.message || String(err), true);
		}
	}

	function mapCrossrefType(type) {
		const t = (type || '').toLowerCase();
		if (!t) return null;
		if (t.includes('journal-article')) return 'article';
		if (t.includes('proceedings-article')) return 'article';
		if (t.includes('book-chapter')) return 'chapter';
		if (t.includes('book')) return 'book';
		if (t.includes('dataset')) return 'dataset';
		if (t.includes('dissertation')) return 'dissertation';
		if (t.includes('report')) return 'report';
		if (t.includes('posted-content') || t.includes('preprint')) return 'preprint';
		if (t.includes('review')) return 'review';
		return 'article';
	}

	function mapOpenAlexType(type) {
		const t = (type || '').toLowerCase();
		if (!t) return null;
		if (t.includes('article')) return 'article';
		if (t.includes('book-chapter') || t.includes('chapter')) return 'chapter';
		if (t.includes('book')) return 'book';
		if (t.includes('dataset')) return 'dataset';
		if (t.includes('dissertation') || t.includes('thesis')) return 'dissertation';
		if (t.includes('report')) return 'report';
		if (t.includes('posted-content') || t.includes('preprint')) return 'preprint';
		if (t.includes('review')) return 'review';
		return 'article';
	}

	async function fetchCrossrefByDOI(doi) {
		const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=slr-harvester-web@example.invalid`;
		const res = await fetch(url);
		if (!res.ok) return null;
		const data = await res.json();
		return data && data.message ? data.message : null;
	}

	async function fetchOpenAlexByIdentifier(identifier) {
		if (!identifier) return null;
		let url = '';
		if (/^https?:\/\/doi\.org\//i.test(identifier)) {
			const doi = String(identifier).replace(/^https?:\/\/doi\.org\//i, '');
			url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`;
		} else if (/^https?:\/\/openalex\.org\//i.test(identifier)) {
			url = `https://api.openalex.org/works/${String(identifier).trim()}`;
		} else if (/^pmid:/i.test(identifier)) {
			url = `https://api.openalex.org/works/${String(identifier).trim()}`;
		} else {
			url = `https://api.openalex.org/works/${encodeURIComponent(identifier)}`;
		}
		const res = await fetch(url);
		if (!res.ok) return null;
		return await res.json();
	}

	async function fetchPubMedByPMID(pmid) {
		if (!pmid) return null;
		const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=xml`;
		const res = await fetch(url);
		if (!res.ok) return null;
		const xmlText = await res.text();
		const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
		if (doc.querySelector('parsererror')) return null;
		return doc;
	}

	function normalizeIdentifierDoi(doi) {
		return doi ? String(doi).trim().replace(/^https?:\/\/doi.org\//i, '') : '';
	}

	async function runWithFetchMode(mode, action) {
		const previousMode = state.fetchMode;
		if (mode === 'all' || mode === 'missing') state.fetchMode = mode;
		try {
			return await action();
		} finally {
			state.fetchMode = previousMode;
		}
	}

	function getArticleFetchIdentifier(article) {
		const doi = normalizeIdentifierDoi(article && article.doi);
		if (doi) return { kind: 'doi', value: doi };
		const eid = String((article && (article.eid || article._id)) || '');
		if (eid.startsWith('openalex:')) return { kind: 'openalex', value: `https://openalex.org/${eid.slice(9)}` };
		if (eid.startsWith('pmid:')) return { kind: 'pmid', value: eid.slice(5) };
		return null;
	}

	function collectAffiliationMetadata(article, crossrefMsg, openAlexMsg, pubMedDoc) {
		const affiliations = new Set();
		const countries = new Set();
		const sources = new Set();

		const pushAffiliation = (value, source) => {
			const text = String(value || '').trim();
			if (!text) return;
			affiliations.add(text);
			const codes = window.SLRWorldMap && typeof SLRWorldMap.extractCountryCodesFromText === 'function'
				? SLRWorldMap.extractCountryCodesFromText(text)
				: [];
			for (const code of codes) countries.add(code);
			if (source) sources.add(source);
		};

		if (crossrefMsg && Array.isArray(crossrefMsg.author)) {
			for (const author of crossrefMsg.author) {
				if (!Array.isArray(author.affiliation)) continue;
				for (const affiliation of author.affiliation) {
					pushAffiliation(affiliation && affiliation.name, 'crossref');
				}
			}
		}

		if (openAlexMsg && Array.isArray(openAlexMsg.authorships)) {
			for (const authorship of openAlexMsg.authorships) {
				if (!Array.isArray(authorship.institutions)) continue;
				for (const institution of authorship.institutions) {
					if (institution && institution.display_name) pushAffiliation(institution.display_name, 'openalex');
					const code = institution && (institution.country_code || institution.countryCode || institution.country);
					if (code) countries.add(String(code).trim().toUpperCase());
				}
			}
		}

		if (pubMedDoc) {
			pubMedDoc.querySelectorAll('Affiliation').forEach(node => pushAffiliation(node.textContent, 'pubmed'));
		}

		return {
			affiliations: [...affiliations],
			affiliationCountries: [...countries],
			affiliationSources: [...sources],
		};
	}

	async function fetchAbstractsViaDOI(scopeIds) {
		if (!state.currentFolder || !state.projectData) return;
		const mode = state.fetchMode === 'all' ? 'all' : 'missing';
		const targets = scopedArticles(scopeIds).filter(a => {
			if (!a.doi) return false;
			if (mode === 'all') return true;
			return !a.abstract;
		});
		if (!targets.length) {
			showToast(mode === 'all' ? 'No DOI records found for abstract fetch.' : 'No missing abstracts found.', false);
			return;
		}

		const abstractMap = {};
		let done = 0;
		for (const a of targets) {
			showFetchProgress('Fetching abstracts via Crossref', done, targets.length);
			try {
				const msg = await fetchCrossrefByDOI(a.doi);
				const abs = msg && msg.abstract ? String(msg.abstract) : '';
				if (abs) abstractMap[a.eid || a._id] = abs.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
			} catch (_) {
				// ignore per-item failures
			}
			done += 1;
		}

		hideFetchProgress();
		const changed = Object.keys(abstractMap).length;
		if (!changed) {
			showToast('No abstracts retrieved.', false);
			return;
		}

		await SLRData.patchSearchLogAbstracts(state.currentFolder, abstractMap, { overwrite: mode === 'all' });
		await hydrateProject(state.currentFolder);
		renderCurrentView();
		showToast(`Fetched ${changed} abstract${changed !== 1 ? 's' : ''}.`, false);
	}

	async function fetchAuthorsViaDOI(scopeIds) {
		if (!state.currentFolder || !state.projectData) return;

		const scoped = scopedArticles(scopeIds);
		const stats = {
			mode: state.fetchMode,
			total: scoped.length,
			eligible: 0,
			attempted: 0,
			updated: 0,
			unchanged: 0,
			failed: 0,
			skipped: {
				noDoi: 0,
				alreadyComplete: 0,
			},
		};

		const targets = [];
		for (const article of scoped) {
			const doi = normalizeIdentifierDoi(article && article.doi);
			if (!doi) {
				stats.skipped.noDoi += 1;
				continue;
			}

			if (state.fetchMode === 'missing' && hasCompleteAuthorList(article)) {
				stats.skipped.alreadyComplete += 1;
				continue;
			}

			targets.push({ article, doi });
		}

		stats.eligible = targets.length;
		if (!targets.length) {
			showToast('No eligible author targets found.', false);
			showFetchReport('Fetch Authors report', stats);
			return;
		}

		const authorsMap = {};
		let done = 0;
		for (const { article, doi } of targets) {
			showFetchProgress('Fetching author lists via Crossref', done, targets.length);
			stats.attempted += 1;
			try {
				const msg = await fetchCrossrefByDOI(doi);
				const names = Array.isArray(msg && msg.author)
					? msg.author.map(x => {
							const g = x.given || '';
							const f = x.family || '';
							return `${g} ${f}`.trim();
						}).filter(Boolean)
					: [];
				if (names.length > 1) {
					const joined = names.join(', ');
					if (String(article.authors || '').trim() !== joined) {
						authorsMap[article.eid || article._id] = joined;
						stats.updated += 1;
					} else {
						stats.unchanged += 1;
					}
				} else {
					stats.unchanged += 1;
				}
			} catch (_) {
				stats.failed += 1;
			}
			done += 1;
		}

		hideFetchProgress();
		const changed = Object.keys(authorsMap).length;
		if (changed) {
			await SLRData.patchSearchLogAuthors(state.currentFolder, authorsMap);
			await hydrateProject(state.currentFolder);
			renderCurrentView();
		}

		showFetchReport('Fetch Authors report', stats);
	}

	async function fetchTypesViaDOI(scopeIds) {
		if (!state.currentFolder || !state.projectData) return;
		const mode = state.fetchMode === 'all' ? 'all' : 'missing';
		const targets = scopedArticles(scopeIds).filter(a => {
			if (!normalizeIdentifierDoi(a && a.doi)) return false;
			if (mode === 'all') return true;
			return !a.docType;
		});
		if (!targets.length) {
			showToast(mode === 'all' ? 'No DOI records found for type fetch.' : 'No missing document types found.', false);
			return;
		}

		const docTypeMap = {};
		let done = 0;
		for (const a of targets) {
			showFetchProgress('Fetching document types via Crossref', done, targets.length);
			try {
				const doi = normalizeIdentifierDoi(a.doi);
				const msg = await fetchCrossrefByDOI(doi);
				let dt = mapCrossrefType(msg && msg.type);
				if (!dt && doi) {
					const oa = await fetchOpenAlexByIdentifier(`https://doi.org/${doi}`);
					dt = mapOpenAlexType(oa && oa.type);
				}
				if (!dt && String(a.source || '').toLowerCase() === 'arxiv') {
					dt = 'preprint';
				}
				if (dt) docTypeMap[a.eid || a._id] = dt;
			} catch (_) {
				// ignore per-item failures
			}
			done += 1;
		}

		hideFetchProgress();
		const changed = Object.keys(docTypeMap).length;
		if (!changed) {
			showToast('No document types determined.', false);
			return;
		}

		await SLRData.patchSearchLogDocTypes(state.currentFolder, docTypeMap);
		await hydrateProject(state.currentFolder);
		renderCurrentView();
		showToast(`Updated document types for ${changed} article${changed !== 1 ? 's' : ''}.`, false);
	}

	async function fetchAllMetadata(options = {}) {
		if (!state.currentFolder || !state.projectData) return;
		const mode = options.mode === 'all' ? 'all' : 'missing';
		if (!options.fromAutoFetch) {
			showToast(`Fetch All started (mode=${mode}).`, false);
		}
		await runWithFetchMode(mode, async () => {
			await fetchAbstractsViaDOI(options.scopeIds);
			await fetchAuthorsViaDOI(options.scopeIds);
			await fetchTypesViaDOI(options.scopeIds);
			await fetchAffiliationsViaIdentifier(options.scopeIds);
			await fetchCitationNetworkData(options.scopeIds);
		});
		if (!options.fromAutoFetch) {
			showToast('Fetch All completed.', false);
		}
	}

	async function fetchAffiliationsViaIdentifier(scopeIds) {
		if (!state.currentFolder || !state.projectData) return;

		const scoped = scopedArticles(scopeIds);
		const stats = {
			mode: state.fetchMode,
			total: scoped.length,
			eligible: 0,
			attempted: 0,
			updated: 0,
			unchanged: 0,
			failed: 0,
			skipped: {
				alreadyComplete: 0,
				noIdentifier: 0,
				inferenceOnlyResolved: 0,
			},
		};

		const localInferenceTargets = [];
		const networkTargets = [];

		for (const article of scoped) {
			const hasCountries = Array.isArray(article.affiliationCountries) && article.affiliationCountries.length > 0;
			const hasAffiliations = Array.isArray(article.affiliations) && article.affiliations.length > 0;
			const identifier = getArticleFetchIdentifier(article);

			if (hasAffiliations && !hasCountries) {
				localInferenceTargets.push(article);
			}

			if (state.fetchMode === 'missing' && hasAffiliationMetadata(article)) {
				stats.skipped.alreadyComplete += 1;
				continue;
			}

			if (!identifier) {
				stats.skipped.noIdentifier += 1;
				continue;
			}

			networkTargets.push(article);
		}

		stats.eligible = networkTargets.length;
		if (!localInferenceTargets.length && !networkTargets.length) {
			showToast('No eligible affiliation targets found.', false);
			showFetchReport('Fetch Affiliations report', stats);
			return;
		}

		const affiliationMap = {};
		const resolvedByInference = new Set();

		if (localInferenceTargets.length) {
			let inferredDone = 0;
			for (const article of localInferenceTargets) {
				showFetchProgress('Inferring countries from existing affiliations', inferredDone + 1, localInferenceTargets.length);
				const inferredCountries = new Set();
				for (const affiliation of article.affiliations || []) {
					if (!affiliation) continue;
					const codes = window.SLRWorldMap && typeof SLRWorldMap.extractCountryCodesFromText === 'function'
						? SLRWorldMap.extractCountryCodesFromText(String(affiliation))
						: [];
					for (const code of codes) inferredCountries.add(code);
				}
				if (inferredCountries.size) {
					const changed = applyAffiliationUpdateIfChanged(article, affiliationMap, {
						affiliations: Array.isArray(article.affiliations) ? article.affiliations : [],
						affiliationCountries: [...inferredCountries],
						affiliationSources: ['local-affiliation-text'],
					});
					if (changed) {
						stats.updated += 1;
						resolvedByInference.add(article.eid || article._id);
					}
				}
				inferredDone += 1;
			}
		}

		let done = 0;
		for (const article of networkTargets) {
			if (state.fetchMode === 'missing' && resolvedByInference.has(article.eid || article._id)) {
				stats.skipped.inferenceOnlyResolved += 1;
				continue;
			}

			showFetchProgress('Fetching affiliations and countries', done + 1, networkTargets.length);
			stats.attempted += 1;
			try {
				const fetchInfo = getArticleFetchIdentifier(article);
				let crossrefMsg = null;
				let openAlexMsg = null;
				let pubMedDoc = null;

				if (fetchInfo.kind === 'doi') {
					const doiUrl = `https://doi.org/${fetchInfo.value}`;
					[crossrefMsg, openAlexMsg] = await Promise.all([
						fetchCrossrefByDOI(fetchInfo.value),
						fetchOpenAlexByIdentifier(doiUrl),
					]);
					if (!openAlexMsg) {
						openAlexMsg = await fetchOpenAlexByIdentifier(fetchInfo.value);
					}
				} else if (fetchInfo.kind === 'openalex') {
					openAlexMsg = await fetchOpenAlexByIdentifier(fetchInfo.value);
				} else if (fetchInfo.kind === 'pmid') {
					pubMedDoc = await fetchPubMedByPMID(fetchInfo.value);
					// PMID records can still sometimes be resolved in OpenAlex.
					openAlexMsg = await fetchOpenAlexByIdentifier(`pmid:${fetchInfo.value}`);
				}

				const meta = collectAffiliationMetadata(article, crossrefMsg, openAlexMsg, pubMedDoc);
				if (!meta.affiliations.length && crossrefMsg && Array.isArray(crossrefMsg.author)) {
					for (const author of crossrefMsg.author) {
						if (!Array.isArray(author.affiliation)) continue;
						for (const affiliation of author.affiliation) {
							if (affiliation && affiliation.name) meta.affiliations.push(String(affiliation.name).trim());
						}
					}
				}
				if (meta.affiliations.length || meta.affiliationCountries.length) {
					const key = article.eid || article._id;
					const existing = affiliationMap[key] || {
						affiliations: Array.isArray(article.affiliations) ? article.affiliations : [],
						affiliationCountries: Array.isArray(article.affiliationCountries) ? article.affiliationCountries : [],
						affiliationSources: Array.isArray(article.affiliationSources) ? article.affiliationSources : [],
					};

					const mergedMeta = {
						affiliations: [...new Set([...(existing.affiliations || []), ...meta.affiliations])],
						affiliationCountries: [...new Set([...(existing.affiliationCountries || []), ...meta.affiliationCountries])],
						affiliationSources: [...new Set([...(existing.affiliationSources || []), ...meta.affiliationSources])],
					};

					if (applyAffiliationUpdateIfChanged(article, affiliationMap, mergedMeta)) {
						stats.updated += 1;
					} else {
						stats.unchanged += 1;
					}
				} else {
					stats.unchanged += 1;
				}
			} catch (_) {
				stats.failed += 1;
			}
			done += 1;
		}

		hideFetchProgress();
		const changed = Object.keys(affiliationMap).length;
		if (changed) {
			await SLRData.patchSearchLogAffiliations(state.currentFolder, affiliationMap);
			await hydrateProject(state.currentFolder);
			renderCurrentView();
		}

		showFetchReport('Fetch Affiliations report', stats);
	}

	// Backfills `referencedWorks` (see mapOpenAlexResult) for OpenAlex-sourced
	// articles that were searched before the citation-network feature shipped
	// — those records simply never had the field at all, which is why the
	// network indicator showed unavailable on every article in an older
	// project even though many of them are OpenAlex-sourced. Batches lookups
	// 50 IDs at a time (fetchExternalReferencedWorks' OR-filter cap), so a
	// project with ~2000 OpenAlex articles costs ~40 requests, not ~2000.
	async function fetchCitationNetworkData(scopeIds) {
		if (!state.currentFolder || !state.projectData) return;

		const scoped = scopedArticles(scopeIds);
		const stats = {
			mode: state.fetchMode,
			total: scoped.length,
			eligible: 0,
			attempted: 0,
			updated: 0,
			unchanged: 0,
			failed: 0,
			skipped: { notOpenAlex: 0, alreadyComplete: 0 },
		};

		const targets = [];
		for (const article of scoped) {
			if (article.source !== 'openalex' || !article.eid || !article.eid.startsWith('openalex:')) {
				stats.skipped.notOpenAlex += 1;
				continue;
			}
			if (state.fetchMode === 'missing' && Array.isArray(article.referencedWorks)) {
				stats.skipped.alreadyComplete += 1;
				continue;
			}
			targets.push(article);
		}
		stats.eligible = targets.length;
		if (!targets.length) {
			showFetchReport('Fetch Citation Network report', stats);
			return;
		}

		const BATCH = 50;
		const refsMap = {};
		let done = 0;
		for (let i = 0; i < targets.length; i += BATCH) {
			const batch = targets.slice(i, i + BATCH);
			showFetchProgress('Fetching citation network data', done + 1, targets.length);
			try {
				const ids = batch.map(a => a.eid.slice(9));
				const results = await fetchExternalReferencedWorks(ids, null);
				const byEid = new Map(results.map(r => [r.eid, r]));
				for (const article of batch) {
					stats.attempted += 1;
					const match = byEid.get(article.eid);
					if (match) {
						refsMap[article.eid] = Array.isArray(match.referencedWorks) ? match.referencedWorks : [];
						stats.updated += 1;
					} else {
						stats.failed += 1;
					}
				}
			} catch (_) {
				stats.failed += batch.length;
			}
			done += batch.length;
			if (i + BATCH < targets.length) await delay(150);
		}

		hideFetchProgress();
		const changed = Object.keys(refsMap).length;
		if (changed) {
			await SLRData.patchSearchLogReferencedWorks(state.currentFolder, refsMap);
			await hydrateProject(state.currentFolder);
			renderCurrentView();
		}

		showFetchReport('Fetch Citation Network report', stats);
	}

	// Journal to tag heuristics.
	// Keyword rules for the journal/title/abstract keyword-scoring fallback used
	// when an article has no OpenAlex field/subfield data (see
	// inferTagFromOpenAlexCategories, checked first). Keep every keyword either
	// (a) a genuine word-stem intentionally left unterminated to catch multiple
	// suffixes (e.g. 'psycholog' -> psychology/psychological/psychologist), or
	// (b) specific enough not to appear as an incidental substring/mention in
	// otherwise-unrelated academic writing. Bare single words like the old
	// 'design'/'communication'/'language'/'visual'/'arts' under Design & Arts
	// caused real misclassifications (e.g. "IFIP Advances in Information and
	// Communication Technology" - a computing conference series - matched
	// 'communication' and outscored the weaker "software" signal elsewhere;
	// "Visualization" substring-matched bare 'visual') — verified via a 20-case
	// adversarial test suite plus real project data before landing this list.
	const JOURNAL_TAG_RULES = [
		{ color: 'Blue', tag: 'Computer Science', keywords: ['computer', 'computing', 'software', 'informatics', 'information system', 'information and communication technology', 'information technology', 'ict', 'machine learning', 'artificial intelligence', 'data science', 'human computer interaction', 'programming language', 'natural language processing', 'algorithm', 'cybersecurity', 'computer network', 'network protocol', 'telecommunications', 'telecommunication', 'wireless network', 'wireless', 'internet of things', 'cloud computing'] },
		{ color: 'Green', tag: 'Engineering', keywords: ['engineering', 'engineer', 'mechanic', 'electrical', 'industrial', 'manufacturing', 'automation', 'robotics', 'systems engineering'] },
		{ color: 'Magenta', tag: 'Psychology & Psychotherapy', keywords: ['psycholog', 'psychotherap', 'psychodynamic', 'psychoanal', 'counsel', 'counselling', 'cognitive behavioral', 'cognitive behavioural', 'mental distress', 'trauma therapy', 'coping', 'resilience', 'depression', 'anxiety', 'mourning', 'attachment'] },
		{ color: 'Orange', tag: 'Social Sciences', keywords: ['social', 'sociolog', 'anthropolog', 'humanities', 'society', 'education', 'cultural', 'behavior', 'behaviour', 'ethnograph', 'qualitative', 'interview study', 'lived experience', 'sociocultural', 'social work'] },
		{ color: 'Red', tag: 'Medicine & Health', keywords: ['medical', 'medicine', 'clinical', 'health', 'biomed', 'nursing', 'public health', 'patient', 'hospital', 'therapy', 'care', 'caring', 'palliative', 'obstetric', 'gynaecolog', 'gynecolog', 'midwif', 'perinatal', 'neonatal', 'bereave', 'grief', 'hospice', 'psychiatr', 'healthcare', 'oncolog', 'epidemiolog', 'pediatr'] },
		{ color: 'Indigo', tag: 'Spirituality & Religion', keywords: ['spiritual', 'spirituality', 'religion', 'religious', 'faith', 'theolog', 'chaplain', 'chaplaincy', 'pastoral care', 'existential', 'meaning making', 'ritual', 'pastoral', 'meaning centered'] },
		{ color: 'Violet', tag: 'Law & Policy', keywords: ['law', 'policy', 'governance', 'regulation', 'regulatory', 'jurisprudence', 'legal', 'public policy', 'ethics', 'accountability', 'legislation', 'rights based', 'compliance'] },
		{ color: 'Turquoise', tag: 'Business & Economics', keywords: ['econom', 'finance', 'management', 'business', 'marketing', 'innovation management', 'entrepreneur'] },
		{ color: 'Pink', tag: 'Design & Arts', keywords: ['graphic design', 'industrial design', 'product design', 'fashion design', 'visual arts', 'fine arts', 'performing arts', 'creative arts', 'media arts', 'art history', 'design studies', 'design practice', 'communication design', 'visual communication', 'aesthetic', 'interaction design', 'user experience design', 'typography', 'illustration', 'curatorial'] },
		{ color: 'Lavender', tag: 'Philosophy', keywords: ['philosoph', 'epistemolog', 'ontolog', 'metaphysic', 'ethic', 'phenomenolog', 'hermeneutic'] },
		{ color: 'Gold', tag: 'Futures & Foresight', keywords: ['futures studies', 'foresight', 'scenario', 'horizon scanning', 'forecast', 'future studies', 'anticipation', 'strategic foresight'] },
		{ color: 'Steel Blue', tag: 'Natural Sciences', keywords: ['physics', 'chemistry', 'biolog', 'mathematics', 'geology', 'geoscience', 'earth science', 'ecology', 'biochemistry', 'molecular', 'cell biology', 'astrophysics', 'environmental science'] },
	];

	const OPENALEX_CATEGORY_RULES = [
		{ color: 'Blue', tag: 'Computer Science', keywords: ['computer science', 'artificial intelligence', 'machine learning', 'human computer interaction', 'information systems', 'software engineering'] },
		{ color: 'Green', tag: 'Engineering', keywords: ['engineering', 'electrical engineering', 'mechanical engineering', 'civil engineering', 'materials engineering', 'industrial engineering'] },
		{ color: 'Magenta', tag: 'Psychology & Psychotherapy', keywords: ['psychology', 'clinical psychology', 'psychotherapy', 'behavioral neuroscience', 'cognitive psychology'] },
		{ color: 'Orange', tag: 'Social Sciences', keywords: ['sociology', 'anthropology', 'education', 'social sciences', 'communication', 'cultural studies', 'human geography'] },
		{ color: 'Red', tag: 'Medicine & Health', keywords: ['medicine', 'health sciences', 'public health', 'clinical medicine', 'nursing', 'epidemiology'] },
		{ color: 'Indigo', tag: 'Spirituality & Religion', keywords: ['religion', 'religious studies', 'theology', 'spirituality'] },
		{ color: 'Violet', tag: 'Law & Policy', keywords: ['law', 'legal studies', 'public policy', 'governance', 'political science'] },
		{ color: 'Turquoise', tag: 'Business & Economics', keywords: ['economics', 'business', 'management', 'finance', 'marketing'] },
		{ color: 'Lavender', tag: 'Philosophy', keywords: ['philosophy', 'ethics', 'epistemology', 'metaphysics'] },
		{ color: 'Gold', tag: 'Futures & Foresight', keywords: ['futures studies', 'foresight', 'scenario planning'] },
		{ color: 'Steel Blue', tag: 'Natural Sciences', keywords: ['physics', 'chemistry', 'biology', 'earth sciences', 'environmental science', 'mathematics', 'astronomy'] },
	];

	const HEALTH_CONTEXT_KEYWORDS = [
		'care', 'caring', 'nursing', 'palliative', 'obstetric', 'gynaecolog', 'gynecolog', 'midwif',
		'bereave', 'grief', 'patient', 'clinical', 'hospital', 'mental health', 'psychiatr', 'neonatal', 'perinatal'
	];

	const PSYCH_CONTEXT_KEYWORDS = [
		'psycholog', 'psychotherap', 'psychodynamic', 'psychoanal', 'counsel', 'counselling',
		'mental health', 'mental distress', 'grief therapy'
	];

	const SPIRITUAL_CONTEXT_KEYWORDS = [
		'spiritual', 'spirituality', 'religion', 'religious', 'faith', 'theolog',
		'chaplain', 'chaplaincy', 'pastoral', 'existential', 'meaning making'
	];

	const SOCIAL_CONTEXT_KEYWORDS = [
		'social', 'sociolog', 'anthropolog', 'qualitative', 'interview', 'ethnograph',
		'public discourse', 'lived experience', 'community'
	];

	const LAW_CONTEXT_KEYWORDS = [
		'law', 'legal', 'policy', 'regulation', 'regulatory', 'governance', 'legislation', 'rights', 'compliance'
	];

	// Mirrors Computer Science's own keyword list; used to suppress Design & Arts
	// when strong technical/CS signals are present (defense in depth alongside
	// the narrower Design & Arts keyword list itself — see JOURNAL_TAG_RULES).
	const TECH_CONTEXT_KEYWORDS = JOURNAL_TAG_RULES.find(r => r.tag === 'Computer Science').keywords;

	function normalizeRuleText(text) {
		return String(text || '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	function keywordMatches(text, keyword) {
		if (!text || !keyword) return false;
		const pattern = normalizeRuleText(keyword);
		if (!pattern) return false;
		if (pattern.length <= 3) {
			return new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
		}
		return text.includes(pattern);
	}

	function scoreRuleMatch(text, rule, weight) {
		if (!text) return 0;
		let score = 0;
		for (const keyword of rule.keywords) {
			if (!keywordMatches(text, keyword)) continue;
			score += keyword.includes(' ') ? 3 * weight : 2 * weight;
		}
		return score;
	}

	function inferTagFromOpenAlexCategories(article, enabledCategories) {
		const categoryText = [
			...(Array.isArray(article && article.openAlexFields) ? article.openAlexFields : []),
			...(Array.isArray(article && article.openAlexSubfields) ? article.openAlexSubfields : []),
		]
			.map(value => normalizeRuleText(value))
			.filter(Boolean)
			.join(' ');

		if (!categoryText) return null;

		let best = null;
		for (const rule of OPENALEX_CATEGORY_RULES) {
			if (enabledCategories && !enabledCategories.has(rule.tag)) continue;
			let score = 0;
			for (const keyword of rule.keywords) {
				if (keywordMatches(categoryText, keyword)) {
					score += keyword.includes(' ') ? 5 : 3;
				}
			}
			if (score <= 0) continue;
			if (!best || score > best.score) {
				best = { color: rule.color, tag: rule.tag, score };
			}
		}

		return best ? { color: best.color, tag: best.tag } : null;
	}

	async function autoTagByJournal(force = false, scopeIds) {
		if (!state.currentFolder || !state.projectData) return;
		const tagsConfig = state.projectData.tagsConfig || {};
		const effectiveRules = getEffectiveAutoTagRules();

		const scoped = scopedArticles(scopeIds);
		const toProcess = force
			? scoped
			: scoped.filter(a => !a.tag || a.tag === 'None');

		if (!force && toProcess.length === 0) {
			showToast('All articles already have a tag assigned.', false);
			return;
		}

		// Settings' "Auto-tag disciplines" checkboxes only ever knew about the
		// 12 shipped categories — a category added/renamed via Auto-Tag Rules
		// since then can't be in that saved selection yet, so it stays enabled
		// by default instead of silently never matching until the user also
		// revisits Settings. Only a *known* built-in tag the user explicitly
		// unchecked is actually excluded.
		const knownDefaultTags = new Set(JOURNAL_TAG_RULES.map(r => r.tag));
		const explicitSelection = Array.isArray(state.settings.autoTagCategories) && state.settings.autoTagCategories.length
			? new Set(state.settings.autoTagCategories) : null;
		const isCategoryEnabled = tag => !explicitSelection || explicitSelection.has(tag) || !knownDefaultTags.has(tag);

		function matchRules(article) {
			// OPENALEX_CATEGORY_RULES is a separate, much narrower table (only
			// used when OpenAlex classification data is present on the article)
			// that Auto-Tag Rules doesn't expose for editing — deliberately out
			// of scope, since unifying it with the freely-editable keyword rules
			// below would mean guessing which edits should carry over to it too.
			const openAlexCategoryMatch = inferTagFromOpenAlexCategories(article, { has: isCategoryEnabled });
			if (openAlexCategoryMatch) return openAlexCategoryMatch;

			const fields = [
				{ text: normalizeRuleText(article.publicationName), weight: 4 },
				{ text: normalizeRuleText(article.title), weight: 2 },
				{ text: normalizeRuleText(article.abstract), weight: 1 },
			];
			const fullText = normalizeRuleText([
				article.publicationName,
				article.title,
				article.abstract,
			].join(' '));
			const healthContextHits = HEALTH_CONTEXT_KEYWORDS.reduce((sum, kw) => {
				return sum + (keywordMatches(fullText, kw) ? 1 : 0);
			}, 0);
			const psychContextHits = PSYCH_CONTEXT_KEYWORDS.reduce((sum, kw) => {
				return sum + (keywordMatches(fullText, kw) ? 1 : 0);
			}, 0);
			const spiritualContextHits = SPIRITUAL_CONTEXT_KEYWORDS.reduce((sum, kw) => {
				return sum + (keywordMatches(fullText, kw) ? 1 : 0);
			}, 0);
			const socialContextHits = SOCIAL_CONTEXT_KEYWORDS.reduce((sum, kw) => {
				return sum + (keywordMatches(fullText, kw) ? 1 : 0);
			}, 0);
			const lawContextHits = LAW_CONTEXT_KEYWORDS.reduce((sum, kw) => {
				return sum + (keywordMatches(fullText, kw) ? 1 : 0);
			}, 0);
			const techContextHits = TECH_CONTEXT_KEYWORDS.reduce((sum, kw) => {
				return sum + (keywordMatches(fullText, kw) ? 1 : 0);
			}, 0);
			let best = null;
			for (const rule of effectiveRules) {
				if (!isCategoryEnabled(rule.tag)) continue;
				if (!tagsConfig[rule.color] && tagsConfig[rule.color] !== undefined) continue;
				let score = fields.reduce((sum, field) => sum + scoreRuleMatch(field.text, rule, field.weight), 0);
				if (rule.tag === 'Psychology & Psychotherapy' && psychContextHits > 0) {
					score += psychContextHits * 4;
				}
				if ((rule.tag === 'Social Sciences' || rule.tag === 'Medicine & Health') && psychContextHits > 0) {
					score -= psychContextHits * 2;
				}
				if (rule.tag === 'Spirituality & Religion' && spiritualContextHits > 0) {
					score += spiritualContextHits * 5;
				}
				if (rule.tag === 'Medicine & Health' && spiritualContextHits > 0) {
					score -= spiritualContextHits * 2;
				}
				if (rule.tag === 'Social Sciences' && socialContextHits > 0) {
					score += socialContextHits * 3;
				}
				if (rule.tag === 'Law & Policy' && lawContextHits > 0) {
					// Lower than the other boosts (was *4): this one previously let
					// tangential law/policy word co-occurrence (e.g. a "Law" in a
					// journal title) tip close races against a clearly-dominant rival
					// signal elsewhere (verified: an "Artificial Intelligence and Law"
					// venue outscored a strong Computer Science match on an NLP paper).
					score += lawContextHits * 2;
				}
				if (rule.tag === 'Natural Sciences' && healthContextHits > 0) {
					score -= healthContextHits * 6;
				}
				if (rule.tag === 'Natural Sciences' && (socialContextHits > 0 || lawContextHits > 0 || spiritualContextHits > 0)) {
					score -= (socialContextHits * 5) + (lawContextHits * 5) + (spiritualContextHits * 4);
				}
				if (rule.tag === 'Medicine & Health' && healthContextHits > 0) {
					score += healthContextHits * 2;
				}
				if (rule.tag === 'Design & Arts' && techContextHits > 0) {
					// Defense in depth alongside the narrowed Design & Arts keyword
					// list itself: technical/computing content should not read as arts.
					score -= techContextHits * 4;
				}
				if (score <= 0) continue;
				if (!best || score > best.score) best = { color: rule.color, tag: rule.tag, score };
			}
			return best ? { color: best.color, tag: best.tag } : null;
		}

		const updates = {};
		let matched = 0;

		// Matching is pure local computation (no network I/O), so we chunk it
		// and yield periodically purely to let the progress overlay paint —
		// without a yield the whole loop runs in one uninterrupted frame.
		const CHUNK = 25;
		for (let i = 0; i < toProcess.length; i++) {
			const article = toProcess[i];
			const result = matchRules(article);
			if (result) {
				const articleId = article.eid || article._id || article.doi;
				if (articleId) {
					updates[articleId] = result;
					matched++;
				}
			}
			if (i % CHUNK === 0 || i === toProcess.length - 1) {
				showFetchProgress('Auto-tagging articles', i + 1, toProcess.length);
				await new Promise(resolve => setTimeout(resolve, 0));
			}
		}

		if (!matched) {
			hideFetchProgress();
			showToast('No auto-tag matches found.', false);
			return;
		}

		try {
			showFetchProgress('Saving tags', toProcess.length, toProcess.length);
			const allTags = await SLRData.bulkUpdateAnnotations(state.currentFolder, updates);
			state.projectData.globalTags = allTags;

			// Keep aliases in sync for all assigned colors.
			const aliases = { ...(state.projectData.tagAliases || {}) };
			for (const v of Object.values(updates)) {
				if (v && v.color && v.tag) aliases[v.color] = v.tag;
			}
			await SLRData.saveTagAliases(state.currentFolder, aliases);
			state.projectData.tagAliases = aliases;

			// A category added via Auto-Tag Rules is user/account-level, so this
			// project's own tagsConfig has never heard of its color — register it
			// now (same merge addTag itself does) so the tag renders with its
			// real color instead of the '#888' fallback in the Tags view. Rules
			// still on the shipped defaults (state.autoTagRules === null) carry no
			// `hex` of their own (that's only added once materialized), so fall
			// back to the same curated palette materializeDefaultAutoTagRules
			// itself pulls from before finally giving up on '#888888'.
			const tagsConfigPatch = { ...(state.projectData.tagsConfig || {}) };
			let tagsConfigChanged = false;
			for (const v of Object.values(updates)) {
				if (v && v.color && !tagsConfigPatch[v.color]) {
					const rule = effectiveRules.find(r => r.color === v.color);
					const fallbackHex = (window.SLRData && SLRData.DEFAULT_TAGS_CONFIG && SLRData.DEFAULT_TAGS_CONFIG[v.color]) || '#888888';
					tagsConfigPatch[v.color] = (rule && rule.hex) || fallbackHex;
					tagsConfigChanged = true;
				}
			}
			if (tagsConfigChanged) {
				await SLRData.saveTagsConfig(state.currentFolder, tagsConfigPatch);
				state.projectData.tagsConfig = tagsConfigPatch;
			}

			state.articles = SLRData.getArticles(state.projectData);
			hideFetchProgress();
			renderCurrentView();
			showToast(`Auto-tagged ${matched} article${matched !== 1 ? 's' : ''}.`, false);
		} catch (err) {
			hideFetchProgress();
			showToast('Auto-tag failed: ' + (err.message || String(err)), true);
		}
	}

	// ── Auto-Tag Rules editor (js/views.js renderAutoTagRules) ────────────────
	// Full CRUD over the matching rule set: add/rename/recolor/delete whole
	// categories (built-in or user-created) and add/remove individual
	// keywords, all cross-project — persisted via SLRData.saveConfig, the
	// same place API keys live, not per-project tagsConfig/tagAliases. Every
	// rule's `color` field doubles as its stable identifier, exactly like a
	// tagsConfig color key — there's no separate id to keep in sync.

	function materializeDefaultAutoTagRules() {
		return JOURNAL_TAG_RULES.map(r => ({
			tag: r.tag,
			color: r.color,
			hex: (window.SLRData && SLRData.DEFAULT_TAGS_CONFIG && SLRData.DEFAULT_TAGS_CONFIG[r.color]) || '#888888',
			keywords: [...r.keywords],
		}));
	}

	// What matching (autoTagByJournal) and the editor both actually read:
	// the user's full override once they've touched anything, else the
	// shipped defaults verbatim.
	function getEffectiveAutoTagRules() {
		return Array.isArray(state.autoTagRules) ? state.autoTagRules : JOURNAL_TAG_RULES;
	}

	// Display-only variant of the above that always carries a `hex`, so the
	// editor can render a color swatch whether or not the user has ever
	// materialized their own copy yet.
	function getAutoTagRules() {
		return getEffectiveAutoTagRules().map(r => ({
			tag: r.tag,
			color: r.color,
			hex: r.hex || (window.SLRData && SLRData.DEFAULT_TAGS_CONFIG && SLRData.DEFAULT_TAGS_CONFIG[r.color]) || '#888888',
			keywords: r.keywords,
		}));
	}

	// First edit of any kind snapshots the shipped defaults into a mutable
	// per-user copy; every action below calls this before touching anything.
	function ensureAutoTagRulesMaterialized() {
		if (!Array.isArray(state.autoTagRules)) {
			state.autoTagRules = materializeDefaultAutoTagRules();
		}
		return state.autoTagRules;
	}

	async function persistAutoTagRules() {
		try {
			await SLRData.saveConfig({ AutoTagRules: state.autoTagRules });
		} catch (err) {
			showToast('Could not save auto-tag rules: ' + (err.message || String(err)), true);
		}
	}

	// Mirrors the Tags view's own "Add Tag" convention (colorKey = capitalized
	// name) so a category created here looks/behaves the same as one created
	// there if it's ever registered into a project's tagsConfig.
	function deriveAutoTagColorKey(name) {
		const trimmed = (name || '').trim();
		return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : '';
	}

	async function addAutoTagCategory(tagName, hex) {
		const tag = (tagName || '').trim();
		if (!tag) return;
		const color = deriveAutoTagColorKey(tag);
		const rules = ensureAutoTagRulesMaterialized();
		if (rules.some(r => r.color === color)) {
			showToast('A category with that name already exists.', true);
			return;
		}
		state.autoTagRules = [...rules, { tag, color, hex: hex || '#64A8FF', keywords: [] }];
		renderCurrentView();
		await persistAutoTagRules();
	}

	async function renameAutoTagCategory(color, newTag) {
		const tag = (newTag || '').trim();
		if (!tag) return;
		const rules = ensureAutoTagRulesMaterialized();
		const rule = rules.find(r => r.color === color);
		if (!rule || rule.tag === tag) return;
		rule.tag = tag;
		state.autoTagRules = [...rules];
		renderCurrentView();
		await persistAutoTagRules();
	}

	async function recolorAutoTagCategory(color, hex) {
		const rules = ensureAutoTagRulesMaterialized();
		const rule = rules.find(r => r.color === color);
		if (!rule) return;
		rule.hex = hex;
		state.autoTagRules = [...rules];
		renderCurrentView();
		await persistAutoTagRules();
	}

	async function deleteAutoTagCategory(color) {
		const rules = ensureAutoTagRulesMaterialized();
		const rule = rules.find(r => r.color === color);
		if (!rule) return;
		const n = rule.keywords.length;
		if (!confirm(`Delete the "${rule.tag}" auto-tag category${n ? ` and its ${n} keyword${n !== 1 ? 's' : ''}` : ''}? Auto-tag will never assign this category again until you re-add it. This cannot be undone.`)) return;
		state.autoTagRules = rules.filter(r => r.color !== color);
		renderCurrentView();
		await persistAutoTagRules();
	}

	async function addAutoTagKeyword(color, keyword) {
		const rules = ensureAutoTagRulesMaterialized();
		const rule = rules.find(r => r.color === color);
		if (!rule) return;
		const normalized = normalizeRuleText(keyword);
		if (!normalized) return;
		if (rule.keywords.some(k => normalizeRuleText(k) === normalized)) {
			showToast('That keyword is already part of this category.', true);
			return;
		}
		rule.keywords = [...rule.keywords, keyword.trim()];
		state.autoTagRules = [...rules];
		renderCurrentView();
		await persistAutoTagRules();
	}

	async function removeAutoTagKeyword(color, keyword) {
		const rules = ensureAutoTagRulesMaterialized();
		const rule = rules.find(r => r.color === color);
		if (!rule) return;
		rule.keywords = rule.keywords.filter(k => k !== keyword);
		state.autoTagRules = [...rules];
		renderCurrentView();
		await persistAutoTagRules();
	}

	async function resetAutoTagRules() {
		if (!Array.isArray(state.autoTagRules)) {
			showToast('Auto-tag rules are already at their defaults.', false);
			return;
		}
		if (!confirm('Reset every auto-tag category and keyword to the built-in defaults? Everything you added, renamed, recolored, or deleted here will be lost. This cannot be undone.')) return;
		state.autoTagRules = null;
		renderCurrentView();
		await persistAutoTagRules();
		showToast('Auto-tag rules reset to defaults.', false);
	}

	async function addTag(colorKey, hex, aliasLabel) {
		if (!state.currentFolder || !state.projectData) return;
		const key = (colorKey || '').trim();
		if (!key) return;
		const config = { ...(state.projectData.tagsConfig || {}) };
		const aliases = { ...(state.projectData.tagAliases || {}) };
		if (config[key]) {
			showToast('Tag key already exists.', true);
			return;
		}
		config[key] = hex || '#64A8FF';
		aliases[key] = aliasLabel || key;

		await SLRData.saveTagsConfig(state.currentFolder, config);
		await SLRData.saveTagAliases(state.currentFolder, aliases);
		state.projectData.tagsConfig = config;
		state.projectData.tagAliases = aliases;
		renderCurrentView();
	}

	async function renameTag(colorKey, newLabel) {
		if (!state.currentFolder || !state.projectData) return;
		const aliases = { ...(state.projectData.tagAliases || {}) };
		aliases[colorKey] = newLabel;
		await SLRData.saveTagAliases(state.currentFolder, aliases);
		state.projectData.tagAliases = aliases;
		state.articles = SLRData.getArticles(state.projectData);
		renderCurrentView();
	}

	async function recolorTag(colorKey, newHex) {
		if (!state.currentFolder || !state.projectData) return;
		const config = { ...(state.projectData.tagsConfig || {}) };
		config[colorKey] = newHex;
		await SLRData.saveTagsConfig(state.currentFolder, config);
		state.projectData.tagsConfig = config;
		state.articles = SLRData.getArticles(state.projectData);
		renderCurrentView();
	}

	async function deleteTag(colorKey) {
		if (!state.currentFolder || !state.projectData) return;

		const config = { ...(state.projectData.tagsConfig || {}) };
		const aliases = { ...(state.projectData.tagAliases || {}) };
		delete config[colorKey];
		delete aliases[colorKey];

		const updates = {};
		for (const a of state.articles) {
			if (a.color === colorKey) {
				const id = a.eid || a._id || a.doi;
				if (id) updates[id] = { color: 'None', tag: 'None' };
			}
		}

		await SLRData.saveTagsConfig(state.currentFolder, config);
		await SLRData.saveTagAliases(state.currentFolder, aliases);
		if (Object.keys(updates).length) {
			state.projectData.globalTags = await SLRData.bulkUpdateAnnotations(state.currentFolder, updates);
		}

		state.projectData.tagsConfig = config;
		state.projectData.tagAliases = aliases;
		state.articles = SLRData.getArticles(state.projectData);
		renderCurrentView();
	}

	function _hslHex(h, s, l) {
		const hh = ((h % 360) + 360) % 360 / 360;
		const ss = Math.max(0, Math.min(100, s)) / 100;
		const ll = Math.max(0, Math.min(100, l)) / 100;

		let r, g, b;
		if (ss === 0) {
			r = g = b = ll;
		} else {
			const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
			const p = 2 * ll - q;
			const hue2rgb = (p0, q0, t0) => {
				let t = t0;
				if (t < 0) t += 1;
				if (t > 1) t -= 1;
				if (t < 1 / 6) return p0 + (q0 - p0) * 6 * t;
				if (t < 1 / 2) return q0;
				if (t < 2 / 3) return p0 + (q0 - p0) * (2 / 3 - t) * 6;
				return p0;
			};
			r = hue2rgb(p, q, hh + 1 / 3);
			g = hue2rgb(p, q, hh);
			b = hue2rgb(p, q, hh - 1 / 3);
		}

		const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
		return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	}

	async function applyColorScheme(scheme) {
		if (!state.currentFolder || !state.projectData) return;
		const config = state.projectData.tagsConfig || {};
		const keys = Object.keys(config).filter(k => k !== 'None');
		if (!keys.length) {
			showToast('No tags to recolor.', false);
			return;
		}

		const countMap = {};
		for (const a of state.articles) {
			if (a.color && a.color !== 'None') countMap[a.color] = (countMap[a.color] || 0) + 1;
		}

		let ordered = keys;
		if (scheme === 'scaled') {
			ordered = [...keys].sort((a, b) => (countMap[b] || 0) - (countMap[a] || 0));
		}

		const n = ordered.length;
		const next = { ...config };
		const baseHue = state.monoHue;
		state.monoHue = (state.monoHue + 67) % 360;

		ordered.forEach((key, i) => {
			const t = n > 1 ? i / (n - 1) : 0;
			const hStep = Math.round((i / n) * 360);
			switch (scheme) {
				case 'vivid': next[key] = _hslHex(hStep, 68, 52); break;
				case 'pastel': next[key] = _hslHex(hStep, 55, 80); break;
				case 'warm': next[key] = _hslHex(Math.round(t * 72), 72, 50); break;
				case 'cool': next[key] = _hslHex(Math.round(180 + t * 105), 62, 52); break;
				case 'mono': next[key] = _hslHex(baseHue, 65, Math.round(70 - t * 38)); break;
				case 'scaled': next[key] = _hslHex(hStep, Math.round(80 - t * 42), Math.round(42 + t * 24)); break;
				case 'earth': next[key] = _hslHex(Math.round(20 + t * 120), 55, 38); break;
				case 'neon': next[key] = _hslHex(hStep, 100, 52); break;
				case 'sunset': next[key] = _hslHex(Math.round(((340 - t * 110) + 360) % 360), 72, 48); break;
				case 'forest': next[key] = _hslHex(Math.round(130 + t * 20), 58, Math.round(22 + t * 38)); break;
				case 'midnight': next[key] = _hslHex(Math.round(220 + t * 10), 62, Math.round(18 + t * 52)); break;
				case 'rose': next[key] = _hslHex(Math.round(330 + t * 20), 68, Math.round(38 + t * 40)); break;
				case 'grayscale': next[key] = _hslHex(0, 0, Math.round(10 + t * 80)); break;
				case 'ocean': next[key] = _hslHex(Math.round(195 - t * 20), Math.round(75 - t * 30), Math.round(22 + t * 52)); break;
				case 'autumn': next[key] = _hslHex(Math.round(40 - t * 40), 75, Math.round(52 - t * 20)); break;
				case 'candy': next[key] = _hslHex(Math.round(310 - t * 110), 85, 62); break;
				case 'citrus': next[key] = _hslHex(Math.round(80 - t * 55), 82, 48); break;
				case 'slr': next[key] = _hslHex(Math.round(169 + t * 10), Math.round(70 + t * 10), Math.round(60 - t * 38)); break;
				case 'slate': next[key] = _hslHex(212, Math.round(12 + t * 14), Math.round(74 - t * 42)); break;
				case 'berry': next[key] = _hslHex(Math.round(300 + t * 40), Math.round(55 + t * 12), Math.round(52 - t * 20)); break;
				case 'meadow': next[key] = _hslHex(Math.round(72 + t * 66), Math.round(58 + t * 10), Math.round(52 - t * 16)); break;
				default: break;
			}
		});

		await SLRData.saveTagsConfig(state.currentFolder, next);
		state.projectData.tagsConfig = next;
		state.articles = SLRData.getArticles(state.projectData);
		renderCurrentView();
		showToast(`Color scheme "${scheme}" applied.`, false);
	}

	// Lazily connects a workspace when an action needs one but none is open yet:
	// the local backend's folder picker, or the cloud backend's sign-in modal.
	async function connectWorkspace() {
		if (SLRData.getBackend() === 'cloud') {
			showSupabaseAuthModal('signin');
		} else {
			await openFolder();
		}
	}

	async function createProject(name, description) {
		if (!SLRData.hasWorkspace()) {
			await connectWorkspace();
			if (!SLRData.hasWorkspace()) return;
		}
		const folder = await SLRData.createProject(name, description);
		await loadProjectsAndStats();
		await openProject(folder);
		// Land on the new project's info panel (name/description are freshly
		// set from the New Project modal) rather than jumping straight into
		// an empty article list.
		openProjectDetail(folder);
	}

	function showNewProjectModal() {
		const overlay = $('modal-overlay');
		if (!overlay) return;
		SLRViews.renderNewProjectModal(overlay);
	}

	function showSupabaseAuthModal(mode) {
		const overlay = $('modal-overlay');
		if (!overlay) return;
		SLRViews.renderSupabaseAuthModal(overlay, mode);
	}

	// The citation network is built on demand, only for the one article the
	// user clicked into — never precomputed/loaded for the whole list. The
	// index itself (see SLRViews.buildCitationNetworkIndex) is a cheap O(n)
	// scan over already-local data (no API calls), but running it here,
	// only on click, still keeps it off the hot render path entirely.
	function showArticleNetwork(eid) {
		const overlay = $('modal-overlay');
		if (!overlay || !state.articles) return;
		const article = state.articles.find(a => (a.eid || a._id) === eid);
		if (!article) return;
		SLRViews.renderArticleNetworkModal(overlay, article, state.articles, state.projectData);
	}

	// Outgoing external references: the focal article's own referencedWorks
	// already lists every work it cites (in-project or not) — this only
	// fetches TITLE/metadata for the ones not already sitting locally, in
	// capped batches of EXTERNAL_REF_LIMIT so one click never pulls a
	// paper's entire (sometimes 80+ item) reference list at once.
	const EXTERNAL_REF_LIMIT = 40;
	async function loadExternalReferences(eid, offset) {
		const article = state.articles.find(a => (a.eid || a._id) === eid);
		if (!article || !Array.isArray(article.referencedWorks) || !article.referencedWorks.length) {
			return { items: [], totalExternal: 0, nextOffset: null };
		}
		const inProjectIds = new Set(
			state.articles.filter(a => a.source === 'openalex' && a.eid).map(a => a.eid.slice(9))
		);
		const externalIds = article.referencedWorks.filter(id => !inProjectIds.has(id));
		const off = offset || 0;
		const batch = externalIds.slice(off, off + EXTERNAL_REF_LIMIT);
		if (!batch.length) return { items: [], totalExternal: externalIds.length, nextOffset: null };
		const items = await fetchExternalReferencedWorks(batch, null);
		const nextOffset = off + batch.length < externalIds.length ? off + batch.length : null;
		return { items, totalExternal: externalIds.length, nextOffset };
	}

	// Incoming external citations: works OUTSIDE this project that cite the
	// focal article, fetched one capped page (20) at a time via OpenAlex's
	// cites: filter — the "load more" button in the modal just requests the
	// next page rather than everything a highly-cited article accumulates.
	async function loadExternalCitations(eid, page) {
		const article = state.articles.find(a => (a.eid || a._id) === eid);
		if (!article || article.source !== 'openalex' || !article.eid) return { items: [], hasMore: false };
		const openAlexId = article.eid.slice(9);
		const inProjectEids = new Set(state.articles.map(a => a.eid || a._id));
		const { items, hasMore } = await fetchExternalCitingWorks(openAlexId, page || 1, null);
		return { items: items.filter(it => !inProjectEids.has(it.eid)), hasMore };
	}

	function bindEvents() {
		$('theme-toggle')?.addEventListener('click', () => SLRAppUI.toggleTheme(state, $));
		$('fullscreen-toggle')?.addEventListener('click', () => SLRAppUI.toggleFullscreen(showToast, $));
		$('project-badge')?.addEventListener('click', () => openProjectDetail(state.currentFolder));
		$('sidebar-toggle')?.addEventListener('click', () => SLRAppUI.toggleSidebar(state, _sidebar, $));
		document.addEventListener('fullscreenchange', () => SLRAppUI.updateFullscreenButton($));
		document.addEventListener('webkitfullscreenchange', () => SLRAppUI.updateFullscreenButton($));

		document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
			btn.addEventListener('click', () => navigate(btn.dataset.view));
		});

		// Delegated once, here — every view's "no project open" notice
		// (SLRViews.renderNoProjectNotice) reuses this same button/handler
		// instead of each view wiring its own click listener.
		$('view-container')?.addEventListener('click', e => {
			if (e.target.closest('[data-action="goto-projects"]')) navigate('projects');
		});
	}

	async function init() {
		_container = $('view-container');
		_sidebar = $('sidebar');
		_viewTitle = $('view-title');
		_projectBadge = $('project-badge');

		SLRAppUI.injectIcons(state, $);
		SLRAppUI.applyTheme(state, $);
		SLRAppUI.setSidebarCollapsed(state, _sidebar, $);
		SLRAppUI.updateFullscreenButton($);
		bindEvents();

		SLRViews.renderLoading(_container, 'Initializing...');
		try {
			await restoreWorkspaceAtStartup();
		} catch (err) {
			SLRViews.renderError(_container, err.message || String(err));
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	return {
		state,
		navigate,
		gotoAboutFirstTime,
		openProjectDetail,
		closeProjectDetail,
		openFolder,
		switchBackend,
		cloudAuth,
		cloudSignOut,
		openProject,
		setFilter,
		bumpArticlesRenderLimit,
		setFetchMode,
		setProjectsSort,
		toggleProjectPin,
		setProjectIcon,
		setCorpusFilter,
		bumpCorpusRenderLimit,
		setSelectedFilter,
		bumpSelectedRenderLimit,
		toggleTagBreakdown,
		updateAnnotation,
		updateProjectMeta,
		showNewProjectModal,
		showSupabaseAuthModal,
		showArticleNetwork,
		loadExternalReferences,
		loadExternalCitations,
		createProject,
		saveSettings,
		testScopusApiKey,
		executeSearch,
		cancelSearch,
		trashHistoryQuery,
		archiveHistoryQuery,
		restoreHistoryQuery,
		permanentlyDeleteHistoryQuery,
		setHistoryStatusFilter,
		setHistorySortDir,
		deleteQueryTerm,
		autoTagByJournal,
		getAutoTagRules,
		addAutoTagCategory,
		renameAutoTagCategory,
		recolorAutoTagCategory,
		deleteAutoTagCategory,
		addAutoTagKeyword,
		removeAutoTagKeyword,
		resetAutoTagRules,
		fetchAbstractsViaDOI,
		fetchAuthorsViaDOI,
		fetchTypesViaDOI,
		fetchAffiliationsViaIdentifier,
		fetchCitationNetworkData,
		pruneUnusedLegacyTags,
		fetchAllMetadata,
		renameTag,
		addTag,
		deleteTag,
		recolorTag,
		applyColorScheme,
		showToast,
	};

})();
