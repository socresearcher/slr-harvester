/**
 * SLR Harvester Web - Main Application
 * State management, navigation, rendering, search and enrichment actions.
 *
 * Global: window.SLRApp
 */

window.SLRApp = (() => {

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

		filter: {
			mode: 'all',
			tag: null,
			yearFrom: '',
			yearTo: '',
			sort: 'newest',
			search: '',
		},

		corpusFilter: {
			tag: null,
			sort: 'newest',
			search: '',
		},

		selectedFilter: {
			tag: null,
			sort: 'newest',
			search: '',
		},

		monoHue: Math.floor(Math.random() * 360),

		settings: {
			apiKey: localStorage.getItem('slr-apikey') || '',
			instToken: localStorage.getItem('slr-insttoken') || '',
			openAlexKey: localStorage.getItem('slr-openalex-key') || '',
			openAlexEmail: localStorage.getItem('slr-openalex-email') || '',
			autoFetchEnabled: localStorage.getItem('slr-auto-fetch-enabled') === '1',
			autoTagEnabled: localStorage.getItem('slr-auto-tag-enabled') === '1',
			autoRunScope: localStorage.getItem('slr-auto-run-scope') === 'new' ? 'new' : 'all',
		},

		fetchMode: localStorage.getItem('slr-fetch-mode') === 'all' ? 'all' : 'missing',

		search: {
			query: '',
			maxResults: 100,
			isSearching: false,
			abortController: null,
			progress: 0,
			progressMsg: '',
			error: null,
			lastCount: null,
			db: 'scopus',
		},
	};

	const $ = id => document.getElementById(id);

	let _container;
	let _sidebar;
	let _viewTitle;
	let _projectBadge;
	let _folderPath;

	const VIEW_UI_STATE_MAP = {
		articles: { searchInputId: 'article-search', listId: 'article-list' },
		selected: { searchInputId: 'selected-search', listId: 'selected-list' },
		corpus: { searchInputId: 'corpus-search', listId: 'corpus-list' },
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
		overlay.classList.add('visible');
	}

	function hideFetchProgress() {
		document.querySelector('.fetch-progress-overlay')?.remove();
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

	function requireProjectForView(view) {
		return !['welcome', 'projects', 'settings', 'about', 'databases'].includes(view);
	}

	function renderCurrentView() {
		if (!_container) return;
		const uiStateSnapshot = captureViewUiState();
		SLRAppUI.updateTopbar(state, {
			viewTitle: _viewTitle,
			projectBadge: _projectBadge,
			folderPath: _folderPath,
		});

		if (requireProjectForView(state.view) && !state.projectData) {
			SLRViews.renderError(_container, 'No project loaded. Open a project from Projects first.');
			return;
		}

		switch (state.view) {
			case 'welcome':
				SLRViews.renderWelcome(_container);
				break;
			case 'projects':
				SLRViews.renderProjects(_container, state.projects, state.currentFolder, state.allProjectData);
				break;
			case 'articles':
				SLRViews.renderArticles(_container, state.articles, state.filter, state.projectData);
				break;
			case 'history':
				SLRViews.renderHistory(_container, state.projectData.searchLog || [], state.projectData);
				break;
			case 'project':
				SLRViews.renderProjectInfo(_container, state.currentProject, state.projectData);
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
					fetchMode: state.fetchMode,
					folderName: state.folderName,
				});
				break;
			case 'about':
				SLRViews.renderAbout(_container);
				break;
			case 'tags':
				SLRViews.renderTags(_container, state.articles, state.projectData);
				break;
			default:
				SLRViews.renderError(_container, `Unknown view: ${state.view}`);
				break;
		}

		restoreViewUiState(uiStateSnapshot);
	}

	function navigate(view) {
		state.view = view;
		renderCurrentView();
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

	async function openProject(folderName) {
		try {
			SLRViews.renderLoading(_container, 'Loading project...');
			await hydrateProject(folderName);
			if (['welcome', 'projects', 'settings', 'about', 'databases'].includes(state.view)) {
				state.view = 'articles';
			}
			renderCurrentView();
		} catch (err) {
			SLRViews.renderError(_container, err.message || String(err));
		}
	}

	async function loadProjectsAndStats() {
		state.projects = await SLRData.loadProjects();
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
	}

	async function openFolder() {
		try {
			SLRViews.renderLoading(_container, 'Opening folder...');
			const handle = await SLRData.openFolder();
			state.folderName = handle && handle.name ? handle.name : '';

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

	async function restoreFolderAtStartup() {
		const handle = await SLRData.restoreFolder();
		if (!handle) {
			state.view = 'welcome';
			renderCurrentView();
			return;
		}

		state.folderName = handle.name || '';
		await hydrateSettingsFromConfig();
		await loadProjectsAndStats();
		state.view = 'projects';
		renderCurrentView();
	}

	function setFilter(patch) {
		state.filter = { ...state.filter, ...patch };
		renderCurrentView();
	}

	function setFetchMode(mode) {
		const normalized = mode === 'all' ? 'all' : 'missing';
		state.fetchMode = normalized;
		localStorage.setItem('slr-fetch-mode', normalized);
		renderCurrentView();
	}

	function setCorpusFilter(patch) {
		state.corpusFilter = { ...state.corpusFilter, ...patch };
		renderCurrentView();
	}

	function setSelectedFilter(patch) {
		state.selectedFilter = { ...state.selectedFilter, ...patch };
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

	async function updateProjectMeta(name, description) {
		if (!state.currentFolder) return;
		try {
			const updated = await SLRData.saveProjectMeta(state.currentFolder, name, description);
			state.currentProject = updated;
			const idx = state.projects.findIndex(p => p.workspace_folder === state.currentFolder);
			if (idx >= 0) state.projects[idx] = { ...state.projects[idx], ...updated };
			showToast('Project updated.', false);
			renderCurrentView();
		} catch (err) {
			showToast('Could not update project: ' + (err.message || String(err)), true);
		}
	}

	async function saveSettings({ apiKey, instToken, openAlexKey, openAlexEmail, autoFetchEnabled, fetchMode, autoTagEnabled, autoRunScope }) {
		state.settings.apiKey = normalizePrimaryCredential(apiKey);
		state.settings.instToken = normalizeToken(instToken);
		state.settings.openAlexKey = normalizeToken(openAlexKey);
		state.settings.openAlexEmail = normalizeEmail(openAlexEmail);
		state.settings.autoFetchEnabled = !!autoFetchEnabled;
		state.settings.autoTagEnabled = !!autoTagEnabled;
		state.settings.autoRunScope = autoRunScope === 'new' ? 'new' : 'all';
		state.fetchMode = fetchMode === 'all' ? 'all' : 'missing';
		localStorage.setItem('slr-apikey', state.settings.apiKey);
		localStorage.setItem('slr-insttoken', state.settings.instToken);
		localStorage.setItem('slr-openalex-key', state.settings.openAlexKey);
		localStorage.setItem('slr-openalex-email', state.settings.openAlexEmail);
		localStorage.setItem('slr-auto-fetch-enabled', state.settings.autoFetchEnabled ? '1' : '0');
		localStorage.setItem('slr-auto-tag-enabled', state.settings.autoTagEnabled ? '1' : '0');
		localStorage.setItem('slr-auto-run-scope', state.settings.autoRunScope);
		localStorage.setItem('slr-fetch-mode', state.fetchMode);

		// Persist credentials into THIS folder's own slr_config.json (creating it
		// if missing) so they're tied to the folder, not just this browser —
		// critical for correctness (a different folder must never see them) and
		// for parity with the desktop app's config file.
		if (SLRData.rootHandle) {
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

	async function executeSearch(query, maxResults, db) {
		if (!state.currentFolder) {
			showToast('Open a project first.', true);
			return;
		}

		state.search.query = query;
		state.search.maxResults = Math.max(1, maxResults || 100);
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
			await SLRData.saveQueryTerms(state.currentFolder, [query]);

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

	async function deleteHistoryQuery(index) {
		if (!state.currentFolder) {
			showToast('No project loaded.', true);
			return;
		}
		try {
			await SLRData.deleteSearchResult(state.currentFolder, index);
			await hydrateProject(state.currentFolder);
			showToast('Query deleted.', false);
			renderCurrentView();
		} catch (err) {
			showToast(err.message || String(err), true);
		}
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

	// Journal to tag heuristics.
	const JOURNAL_TAG_RULES = [
		{ color: 'Blue', tag: 'Computer Science', keywords: ['computer', 'computing', 'software', 'informatics', 'information system', 'machine learning', 'artificial intelligence', 'data science', 'human computer interaction', 'digital'] },
		{ color: 'Green', tag: 'Engineering', keywords: ['engineering', 'engineer', 'mechanic', 'electrical', 'industrial', 'manufacturing', 'automation', 'robotics', 'systems engineering'] },
		{ color: 'Magenta', tag: 'Psychology & Psychotherapy', keywords: ['psycholog', 'psychotherap', 'psychodynamic', 'psychoanal', 'counsel', 'counselling', 'cognitive behavioral', 'cognitive behavioural', 'mental distress', 'trauma therapy', 'coping', 'resilience', 'depression', 'anxiety', 'mourning', 'attachment'] },
		{ color: 'Orange', tag: 'Social Sciences', keywords: ['social', 'sociolog', 'anthropolog', 'humanities', 'society', 'education', 'cultural', 'behavior', 'behaviour', 'ethnograph', 'qualitative', 'interview study', 'lived experience', 'sociocultural', 'social work'] },
		{ color: 'Red', tag: 'Medicine & Health', keywords: ['medical', 'medicine', 'clinical', 'health', 'biomed', 'nursing', 'public health', 'patient', 'hospital', 'therapy', 'care', 'caring', 'palliative', 'obstetric', 'gynaecolog', 'gynecolog', 'midwif', 'perinatal', 'neonatal', 'bereave', 'grief', 'hospice', 'psychiatr', 'healthcare', 'oncolog', 'epidemiolog', 'pediatr'] },
		{ color: 'Indigo', tag: 'Spirituality & Religion', keywords: ['spiritual', 'spirituality', 'religion', 'religious', 'faith', 'theolog', 'chaplain', 'chaplaincy', 'pastoral care', 'existential', 'meaning making', 'ritual', 'pastoral', 'meaning centered'] },
		{ color: 'Violet', tag: 'Law & Policy', keywords: ['law', 'policy', 'governance', 'regulation', 'jurisprudence', 'legal', 'public policy', 'ethics', 'accountability', 'legislation', 'rights based', 'compliance', 'guideline'] },
		{ color: 'Turquoise', tag: 'Business & Economics', keywords: ['econom', 'finance', 'management', 'business', 'marketing', 'innovation management', 'organization', 'organisation', 'entrepreneur'] },
		{ color: 'Pink', tag: 'Design & Arts', keywords: ['design', 'arts', 'media', 'language', 'communication', 'creative', 'aesthetic', 'visual', 'interaction design'] },
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
		'law', 'legal', 'policy', 'regulation', 'governance', 'legislation', 'rights', 'compliance', 'guideline'
	];

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

	function inferTagFromOpenAlexCategories(article) {
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

		const scoped = scopedArticles(scopeIds);
		const toProcess = force
			? scoped
			: scoped.filter(a => !a.tag || a.tag === 'None');

		if (!force && toProcess.length === 0) {
			showToast('All articles already have a tag assigned.', false);
			return;
		}

		function matchRules(article) {
			const openAlexCategoryMatch = inferTagFromOpenAlexCategories(article);
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
			let best = null;
			for (const rule of JOURNAL_TAG_RULES) {
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
					score += lawContextHits * 4;
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
				if (score <= 0) continue;
				if (!best || score > best.score) best = { color: rule.color, tag: rule.tag, score };
			}
			return best ? { color: best.color, tag: best.tag } : null;
		}

		const updates = {};
		let matched = 0;

		for (const article of toProcess) {
			const result = matchRules(article);
			if (result) {
				const articleId = article.eid || article._id || article.doi;
				if (articleId) {
					updates[articleId] = result;
					matched++;
				}
			}
		}

		if (!matched) {
			showToast('No auto-tag matches found.', false);
			return;
		}

		try {
			const allTags = await SLRData.bulkUpdateAnnotations(state.currentFolder, updates);
			state.projectData.globalTags = allTags;

			// Keep aliases in sync for all assigned colors.
			const aliases = { ...(state.projectData.tagAliases || {}) };
			for (const v of Object.values(updates)) {
				if (v && v.color && v.tag) aliases[v.color] = v.tag;
			}
			await SLRData.saveTagAliases(state.currentFolder, aliases);
			state.projectData.tagAliases = aliases;

			state.articles = SLRData.getArticles(state.projectData);
			renderCurrentView();
			showToast(`Auto-tagged ${matched} article${matched !== 1 ? 's' : ''}.`, false);
		} catch (err) {
			showToast('Auto-tag failed: ' + (err.message || String(err)), true);
		}
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
				default: break;
			}
		});

		await SLRData.saveTagsConfig(state.currentFolder, next);
		state.projectData.tagsConfig = next;
		state.articles = SLRData.getArticles(state.projectData);
		renderCurrentView();
		showToast(`Color scheme "${scheme}" applied.`, false);
	}

	async function createProject(name, description) {
		if (!SLRData.rootHandle) {
			await openFolder();
			if (!SLRData.rootHandle) return;
		}
		const folder = await SLRData.createProject(name, description);
		await loadProjectsAndStats();
		await openProject(folder);
		state.view = 'project';
		renderCurrentView();
	}

	function showNewProjectModal() {
		const overlay = $('modal-overlay');
		if (!overlay) return;
		SLRViews.renderNewProjectModal(overlay);
	}

	function bindEvents() {
		$('theme-toggle')?.addEventListener('click', () => SLRAppUI.toggleTheme(state, $));
		$('fullscreen-toggle')?.addEventListener('click', () => SLRAppUI.toggleFullscreen(showToast, $));
		$('sidebar-toggle')?.addEventListener('click', () => SLRAppUI.toggleSidebar(state, _sidebar, $));
		$('open-folder-btn')?.addEventListener('click', openFolder);
		document.addEventListener('fullscreenchange', () => SLRAppUI.updateFullscreenButton($));

		document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
			btn.addEventListener('click', () => navigate(btn.dataset.view));
		});
	}

	async function init() {
		_container = $('view-container');
		_sidebar = $('sidebar');
		_viewTitle = $('view-title');
		_projectBadge = $('project-badge');
		_folderPath = $('folder-path');

		SLRAppUI.injectIcons(state, $);
		SLRAppUI.applyTheme(state, $);
		SLRAppUI.setSidebarCollapsed(state, _sidebar, $);
		SLRAppUI.updateFullscreenButton($);
		bindEvents();

		SLRViews.renderLoading(_container, 'Initializing...');
		try {
			await restoreFolderAtStartup();
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
		openFolder,
		openProject,
		setFilter,
		setFetchMode,
		setCorpusFilter,
		setSelectedFilter,
		updateAnnotation,
		updateProjectMeta,
		showNewProjectModal,
		createProject,
		saveSettings,
		testScopusApiKey,
		executeSearch,
		cancelSearch,
		deleteHistoryQuery,
		deleteQueryTerm,
		autoTagByJournal,
		fetchAbstractsViaDOI,
		fetchAuthorsViaDOI,
		fetchTypesViaDOI,
		fetchAffiliationsViaIdentifier,
		fetchAllMetadata,
		renameTag,
		addTag,
		deleteTag,
		recolorTag,
		applyColorScheme,
		showToast,
	};

})();
