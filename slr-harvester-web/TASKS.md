# SLR Harvester Web — Task List

Tasks are tracked here and marked as done once implemented.
Copilot checks this file at the start of every session.

## Prompt Inbox (Session Start)

Neue oder geparkte Prompts kommen zuerst hier hinein.
Diese Liste wird zu Beginn jeder Session gelesen; bei offenen Punkten wird immer nachgefragt, ob der Task jetzt umgesetzt werden soll.

### Open Prompts

- [ ] **Continuous auto-tagging improvement** — Improve tagging precision over time via iterative rule refinements. Only the user may confirm this task as done. If nothing more urgent is in Inbox or Open Prompts, ask whether another refinement pass should be done.

---

## Deployment (GitHub)

Beratschlagt am 2026-08-13. Noch nichts davon ausgeführt — alles unten ist Planung/Checkliste,
kein Ergebnis. Root-Dateien (`LICENSE.md`, `README.md`, `.gitignore`, `projects.json`, `.github/`)
liegen außerhalb von `slr-harvester-web/` und werden hier nur referenziert, nicht bearbeitet.

### Entscheidung: bestehendes Repo, kein neues
`slr-harvester-web/` bleibt Unterordner im bestehenden Repo `github.com/socresearcher/slr-harvester`
(Remote `origin` ist bereits konfiguriert, Branch `main`). Kein separates Repo — die Web-App ist
laut ABOUT.md explizit "v2.0" desselben Projekts, teilt Projektdatenformat, LICENSE und Zielgruppe
mit der Desktop-App. Ein zweites Repo würde nur doppelte Pflege (Issues, README, LICENSE)
bedeuten, ohne echten Nutzen.

### Vor dem ersten Push zu prüfen (Root-Ebene, nicht von mir verändert)
- [ ] `projects.json` (Root) ist **nicht** in `.gitignore` gelistet — enthält echte Projekttitel/
      -beschreibungen. Vor `git add .` entweder in `.gitignore` ergänzen oder bewusst freigeben.
- [ ] `LICENSE.md` (Root) ist lokal bereits auf "Non-Commercial Source-Available License"
      umgestellt, aber noch nicht committet (auf GitHub liegt noch MIT). Empfehlung: bei der
      bereits vorbereiteten Non-Commercial-Lizenz bleiben (passt zu dem, was `ABOUT.md` in
      `slr-harvester-web/` bereits über die Lizenz aussagt) — nicht zurück zu MIT wechseln, sonst
      Widerspruch zwischen Repo-Lizenz und App-eigener Aussage.
- [ ] `slr_config.json`, `search_log.json`, `tags_config.json`, `query_history.json`,
      `tag_aliases.json`, `projects/`, `results/` sind bereits korrekt in `.gitignore` — verifiziert,
      keine Aktion nötig.
- [ ] `.github/copilot-instructions.md` ist aktuell untracked — bewusst mit committen oder in
      `.gitignore` aufnehmen, je nachdem ob es geteilt werden soll.
- [ ] Kurzer Blick in `slr-harvester-web/backups/` vor dem Commit: das sind lokale
      Sicherungskopien (siehe `backup-file.ps1`), vermutlich nicht für das öffentliche Repo gedacht
      — ggf. `slr-harvester-web/backups/` in `.gitignore` aufnehmen, statt sie mitzupushen.

### Ablauf (reines Git, kein Zusatz-Skript nötig)
Normales Hochladen braucht keine Befehlsdatei — Standard-Git reicht (oder identisch über die
VS Code Source-Control-Seitenleiste):
```bash
git add slr-harvester-web .github/copilot-instructions.md LICENSE.md
git status   # vor dem Commit prüfen, was wirklich staged ist
git commit -m "Add SLR Harvester Web (v2.0)"
git push
```
Bewusst kein `git add .` / `git add -A`, um `projects.json` nicht versehentlich mitzunehmen,
solange der Punkt oben nicht geklärt ist.

### Optional: GitHub Pages (separate Entscheidung, nicht Teil des reinen Uploads)
Nur relevant, falls eine öffentlich erreichbare URL gewünscht ist (z. B.
`https://socresearcher.github.io/slr-harvester/` o. Ä.). Da die Pages-Einstellung im
GitHub-UI nur Root oder `/docs` des Quell-Branches unterstützt, nicht beliebige Unterordner,
bräuchte es dafür einen kleinen GitHub-Actions-Workflow, der `slr-harvester-web/` bei jedem
Push auf `main` nach GitHub Pages deployt. Noch nicht erstellt — erst auf Wunsch umsetzen.

### Prompt Archive (Completed)

- [x] Keep focus in the search field after live filtering in Articles, Selected, and Corpus views
- [x] Keep the current list position when toggling Selected/Corpus on article cards
- [x] OpenAlex "Journal Issue" now renders as a proper outlined type bubble; all document types are always shown as pills
- [x] Added the ability to delete saved search terms from the Search-term history panel
- [x] Removed the unintended top spacer bar in Search and Articles-family tabs while keeping aligned header-to-content spacing
- [x] Added a Settings option to enable/disable automatic post-search metadata fetching
- [x] Added a Fetch All button to run abstracts, authors, types, and affiliation/country enrichment in one action
- [x] Added fetch mode configuration in Settings (Missing only vs Re-fetch all eligible)
- [x] Cropped Antarctica from the world map and expanded the map to fill the tab width
- [x] OpenAlex field/subfield metadata is now fetched and used as the primary signal for auto-tag categorization
- [x] Fixed header offset regression: Search/Articles/Selected/Corpus now start directly under the topbar (no extra spacer)
- [x] Databases card descriptions were rewritten shorter to fit two lines without ellipsis truncation
- [x] Tag filters in Articles, Selected, and Corpus now support None to show untagged articles
- [x] Removed fetch mode selector from the Articles toolbar; fetch mode is now changed only in Settings
- [x] Article-list search supports semicolon-separated AND terms across title, abstract, and journal, with a new About note in What’s New
- [x] Added export menu in Articles, Selected, and Corpus with downloads for .bib, .ris, and .csv
- [x] World map in Visualizations is cropped further at the bottom while preserving rounded corners on both lower edges
- [x] Fixed Scopus search API Error 400 in the web app (parity with desktop dashboard)
- [x] Added ability to delete query runs from History in the web app
- [x] Continuous auto-tagging refinement pass: expanded psychology/social/health/law keyword coverage and added context penalties to reduce Natural Sciences false positives
- [x] Unified top spacing from header to view content across tabs
- [x] Added Tags note explaining Auto-tag behavior
- [x] Databases cards standardized in size and switched badge initials to SVG logos
- [x] Auto-tagging adds categories Spirituality & Religion and Psychology & Psychotherapy
- [x] Retagged existential paper to Spirituality & Religion and psychodynamic psychotherapy paper to Psychology & Psychotherapy in a test project
- [x] Auto-tag rules refined to prevent care/bereavement articles from being misclassified as Natural Sciences
- [x] Reviewed a test project's article list and corrected 10 misclassified items
- [x] Visualizations: None can be shown/hidden (default: shown)
- [x] Visualizations All/Selected/Corpus tabs styled as one connected 3-button row
- [x] Compressed/window mode: Articles filter controls keep equal height
- [x] Add Tag button moved one row up and made subtler like New Project
- [x] Sidebar order updated: Tags and Visualizations moved under Project Info
- [x] Articles toolbar button horizontal padding aligned with filter fields
- [x] Articles toolbar buttons and filter fields use the same control height
- [x] Visualization legend/export controls styled to read clearly as buttons
- [x] Removed redundant in-view Settings heading
- [x] Add description to reference managers section
- [x] Move API limitation notices to About view
- [x] Add semantic icons in About lists
- [x] Reduce oversized About symbols
- [x] Verify Force Auto-tag behavior
- [x] Projects header spacing/visibility
- [x] Add fullscreen toggle next to theme switch
- [x] Move web task tracker
- [x] Add lightweight backup flow
- [x] Mobile baseline hardening (iOS-first checks)
- [x] Prepare deploy-friendly file structure
- [x] Year chart defaults to newest years in view
- [x] Mobile Search side panels can be hidden
- [x] Compact topbar toggles keep stable height
- [x] Fullscreen control matches theme toggle height/style
- [x] Fullscreen toggle knob aligns fully right when active
- [x] Settings info symbol size normalized
- [x] Scopus API key auto-imported from legacy config
- [x] Projects New Project button made subtler
- [x] Visualizations legend can be toggled and chart expands
- [x] Export visualizations as PNG (theme-aware, standard download folder)
- [x] Settings API key show/hide toggle

---

## Bug Fixes

- [x] **Deleting a query from History didn't visibly update until the tab was reloaded** — `deleteHistoryQuery` in `js/app.js` deleted the query from `search_log.json` and re-hydrated project state correctly, but — unlike its sibling `deleteQueryTerm` right below it — never called `renderCurrentView()` afterward, so the DOM kept showing the stale list until something else (switching tabs) triggered a re-render. Added the missing `renderCurrentView()` call. Checked all other `hydrateProject` call sites in the file; every other one already re-renders, so this was an isolated omission.
- [x] **Regression: Scopus searches broke with "500 GENERAL_SYSTEM_ERROR / Unable to authenticate"** — Introduced by the COMPLETE-view fix above, in the same session. Elsevier reports "not authorized for the requested view" *inconsistently*: usually HTTP 401/403 `AUTHORIZATION_ERROR`, but in this case HTTP **500** `GENERAL_SYSTEM_ERROR` with "Unable to authenticate" in the body — same underlying cause (this key isn't entitled to COMPLETE view), different status code. The fallback-to-STANDARD logic only checked for status 400/401/403, so it treated the 500 as a generic transient error and retried the same failing COMPLETE-view request 5 times before giving up. Fixed to detect the auth failure from the response **body** (`/authenticat|authoriz/i`) regardless of status code, and to only burn all retry attempts when STANDARD view itself fails that way (a genuine key problem, not a view problem). Verified live: the user's key is valid and not expired — confirmed 200 OK with real results (`TITLE-ABS-KEY(bereavement)` → 21,327 total) on STANDARD view; COMPLETE view returns 401 `AUTHORIZATION_ERROR` (this key's subscription doesn't include the COMPLETE view), and the search now falls back to STANDARD automatically and completes successfully instead of erroring out.
- [x] **Added a "Test API Key" button in Settings → Scopus API** — Runs a lightweight, read-only probe (no project writes) against the live Scopus API using whatever key/token is currently typed in the form (even if unsaved), reporting: whether the key authenticates at all (STANDARD view), and — only if that succeeds — whether COMPLETE view is authorized. Surfaces the exact HTTP status and Elsevier error message inline, with guidance to check/renew the key at dev.elsevier.com if it's rejected. Verified end-to-end in the browser against the live API.
- [x] **Auto-tag-after-search + scope toggle** — Added two new Settings → Fetch Automation options: "Auto-tag after search" (runs the same journal-keyword auto-tag pass as the Articles-view button, automatically after each successful search, independent of the existing metadata auto-fetch toggle) and "Apply automatic actions to" (`all` eligible articles project-wide — the prior, unconditional behavior — or `new`: only the articles the triggering search run just added). The scope setting applies to both the metadata auto-fetch and the new auto-tag pass; manual buttons in the Articles view are unaffected and always cover the whole project as before.
- [x] **Scopus searches always used STANDARD view, ignoring the desktop app's configured COMPLETE view** — The Python desktop app (`src/api/client.py`, `src/utils/config.py`) persists a `View` setting (`STANDARD`/`COMPLETE`) in `slr_config.json`; the web app's `runScopusSearch` in `js/app.js` hardcoded `view=STANDARD` and never read it. This user's own `slr_config.json` has `"View": "COMPLETE"`, meaning the web app was silently discarding an entitlement the desktop app used — COMPLETE view also returns the full `author` array (not just first-author `dc:creator`) and fuller abstracts. Fixed to read `config.View` (defaulting to STANDARD when absent) and use it, with `mapScopusResult` now preferring the full `author` array when present. Added a same-batch fallback to STANDARD if the configured view comes back 400/401/403 (not authorized for that key), so this can't turn into a new failure mode for keys without COMPLETE access.
- [x] **RIS/BibTeX export garbled every multi-author article** — `formatBibAuthors`/`splitAuthorsForRis` in `js/views.js` only split author strings on `;` or `" and "`, but every author-list producer in the app (`mapPubmedResult`, `mapOpenAlexResult`, `mapCrossrefSearchResult`, and the Crossref-backed `fetchAuthorsViaDOI` enrichment, all in `js/app.js`) joins authors with `", "`. Since PubMed and OpenAlex are two of the three search backends, and Crossref enrichment is the main way Scopus gets full author lists, most multi-author exports produced a single garbled `AU  -`/`author = {...}` field containing all authors run together instead of one entry per author. Fixed by splitting on `,` as well (after `;`, before the `" and "` fallback) — safe because no author-name producer in this codebase stores "Last, First" with an embedded comma.
- [x] **OpenAlex fallback search let cross-source duplicates through** — `dedupeByIdentity` in `js/app.js` keyed rows by `eid` first, but `runOpenAlexFallbackSearch` mixes OpenAlex rows (`eid: openalex:...`) and Crossref rows (`eid: crossref:...`) that can describe the same work with different synthetic eids but the same DOI. Fixed by preferring a normalized DOI as the identity key when present, so same-DOI rows from different sources now collapse correctly. (Note: this fix is intentionally scoped to the pre-save `dedupeByIdentity` helper only — see [SUGGESTIONS.md](SUGGESTIONS.md) for why the similar-looking identity logic in `getArticles`/`data.js` was *not* touched.)
- [x] **PubMed search silently capped at 500 results and risked oversized export URLs** — `runPubmedSearch` hardcoded `retmax = Math.min(maxResults, 500)` regardless of the UI's 10,000 max-results setting, and joined all PMIDs into one long `esummary.fcgi` GET URL. Verified against the live NCBI API that a single `esearch` call accepts `retmax` up to at least 9999. Fixed to honor the requested `maxResults` (up to 10,000) and to fetch summaries in batches of 200 IDs via POST (avoids multi-thousand-character URLs) with a small delay between batches to respect NCBI's unauthenticated rate limit.
- [x] **OpenAlex search only ever returned ~200 results (cursor-pagination bug)** — Root cause: `runOpenAlexSearch`/`fetchOpenAlexPage` in `js/app.js` translated the initial cursor value `'*'` into an empty string before the first request, so OpenAlex never received `cursor=*` and its response never contained `meta.next_cursor`. Every subsequent "page" therefore silently refetched page 1 forever; the ~200 unique results the user saw were just the first page surviving later dedup. Verified live against the real OpenAlex API (`meta.next_cursor` is present only when `cursor` is explicitly sent) and confirmed the fix retrieves 600+ unique results across multiple pages for a query where the old code capped at ~200. Fixed by always sending the cursor (starting at `'*'`) and reading `meta.next_cursor` correctly; falls back to classic `page=`-based pagination only after repeated 429/500/503 errors, and to the narrow keyword/topic fallback search only if that also fails with zero results collected.
- [x] **OpenAlex search silently skipped the real search endpoint for anonymous users** — `runOpenAlexSearch` used to preemptively route *every* plain-text query through the weak `runOpenAlexFallbackSearch` (keyword/topic/autocomplete matching, much narrower and less complete than full-text search) whenever no OpenAlex API key/email was configured in Settings — regardless of whether the real endpoint would have worked. Since most users never set an OpenAlex key/email, most anonymous searches were never actually hitting `/works?search=` at all. Fixed so the real search is always attempted first; the narrow fallback is now only used as a last resort after the real endpoint fails repeatedly with 429/500/503 and zero results were collected.
- [x] **Scopus search had no retry/backoff for transient errors** — `runScopusSearch` threw immediately on any non-2xx response or network error, including rate limiting (429) and transient 5xx errors, making searches feel "unreliable" under normal Elsevier quota throttling. Added retry with backoff (up to 5 attempts, 0/800/2000/4000/8000 ms) for 429/500/502/503/504 and network failures, matching the resilience already present in the OpenAlex path; if some results were already collected before a batch ultimately fails, those are still returned instead of the whole search erroring out.
- [x] **`serve.py` crashed on startup on Windows (`UnicodeEncodeError`)** — The dev server's startup banner used a `→` arrow character in a `print()` call; Windows consoles default to the `cp1252` codec, which cannot encode it, so `python serve.py` crashed immediately with a traceback and never served the app. Reproduced and fixed by using plain ASCII `->` and forcing UTF-8 on stdout/stderr via `sys.stdout.reconfigure(encoding='utf-8')` so future non-ASCII output can't cause the same crash.
- [x] **OpenAlex search restored under anonymous API throttling** — Added a resilient fallback path so OpenAlex searches still return results when the upstream anonymous `/works?search=` endpoint responds with temporary 503 rate-limit errors.
- [x] **Database badge logos reverted to abbreviations** — Removed inline SVG badge logos and switched cards back to text abbreviations (e.g., aX, PM, OA).
- [x] **Blank/empty views (Databases/Projects/others) after map changes** — Fixed broken `wireChartInteractivity` branching in `js/views.js` (year/world blocks were mixed). Recovery note: if UI appears empty, do a hard reload (`Ctrl+F5`) to clear stale `file://` script cache.
- [x] **World map now theme-compatible and fully bidirectional interactive** — Improved dark/light readability with clearer land/outline contrast and upgraded interactions so legend↔map highlighting works in both directions (hover, click lock, keyboard focus).
- [x] **Fetch runs now expose mode and full counts** — Added a toolbar fetch-mode switch (Missing only vs Re-fetch all eligible) plus detailed post-run summaries with total/eligible/attempted/updated/unchanged/failed and skipped-reason breakdowns.
- [x] **World map legend now lists all mapped countries** — Removed the 12-item legend cap so every country with a visible map data point appears in the legend.
- [x] **World map legend no longer shrinks the map** — Legend now stacks below the SVG map so toggling it does not change the map width.
- [x] **Article cards show affiliation status** — Added a globe badge per card to indicate whether affiliation/country data is available, fetchable, or unavailable.
- [x] **Affiliation globe shows country names** — Globe tooltip and expanded article cards now display the actual country names instead of only a country count.
- [x] **World map markers stay interactive and theme-aware** — Restored hover dimming/highlighting on map markers and made the map recolor on dark/light theme changes.
- [x] **Affiliation cards show country flags** — Expanded article cards now prefix each country name with its flag emoji.
- [x] **World map contrast and marker style polish** — Increased country-outline contrast and replaced white-core bubbles with cleaner digital ring markers.
- [x] **Fetch progress now shows visible loader circle** — Fetch operations now show a visible progress overlay with circular percentage indicator for better feedback.
- [x] **Context-free views** — "Databases" and "Open Repo" (sidebar nav items) must be reachable even when no project is loaded. Currently they break or show an error because the app requires a loaded project for all views.
- [x] **Field codes list incomplete** — Search view now has all 11 groups (~70+ codes) from the original desktop app.
- [x] **Filter/clock icons too big** — Added `.search-panel-header svg { width: 14px; height: 14px; }` to constrain icon size.
- [x] **Past search terms not listing** — Fixed bug: `projectData.queryHistory` is `{terms:[]}`, not an array; now reads `.terms` correctly.
- [x] **Past terms not alphabetically sorted / only few listed** — Past terms now deduplicated, sorted alphabetically, and all shown (no 30-item cap).
- [x] **Operators missing from field codes** — Added "Operators" (AND, OR, NOT, (, ), W/n, PRE/n) and "Wildcards" (*, ?, #, "", {}) groups at top of FIELD_CODES list.
- [x] **`Â·` garbled symbols in article metadata** — Fixed by replacing corrupted UTF-8 bytes with `&middot;` HTML entity.
- [x] **Garbled symbols and spinner in fetch progress toasts** — Replaced all three `progressToast` text-overlay blocks in `fetchAbstractsViaDOI`, `fetchAuthorsViaDOI`, `fetchTypesViaDOI` with `showFetchProgress` / `hideFetchProgress` helpers.
- [x] **Progress bar for fetch operations** — Added `showFetchProgress`/`hideFetchProgress` helpers (create a fixed bottom overlay with label, count, and animated 4px progress bar). CSS added for `.fetch-progress-overlay`, `.fpo-header`, `.fpo-track`, `.fpo-fill`.
- [x] **Monochrome cycling broken** — Added `state.monoHue` (random init, +67° per click); `schemeDots` reads live hue for preview; `renderCurrentView()` updates dots after apply.
- [x] **Fetch Types returns 0** — Removed `?select=type` (unreliable), added `?mailto=` polite-pool param; removed forbidden `User-Agent` header.
- [x] **History count bubble not centered** — Changed `.history-count` from `justify-content: flex-end` to `justify-content: center`.
- [x] **About view V1/V2 sections missing** — Restored blue V2 banner, V1 legacy section, and GitHub / Issues / License link buttons.
- [x] **Database cards description cut off** — Fixed `.db-card-desc`: removed `white-space: nowrap` / `text-overflow: ellipsis`; descriptions now wrap normally.
- [x] **arXiv and Semantic Scholar listed as integrated** — Moved to new "Not available — API restrictions" group in Databases view.

---

## UI / Navigation

- [x] **Rename "Contact Developer" → "Open Repo"** — The sidebar item should open `https://github.com/socresearcher` (matching the behaviour of `dashboard.py`). Choose the clearest label (e.g. "Open Repo" or "GitHub").
- [x] **"About" view** — Replaced "Open Repo" with a proper "About" nav view (info icon). Contains: developer info, GitHub buttons, SLR Harvester v2 overview, what's new list.
- [x] **Restyle toolbar action buttons** — Auto-tag and Fetch Abstracts buttons now use consistent `articles-action-btn` style matching the app design system.
- [x] **Restyle +Add Tag button** — Uses same `articles-action-btn` style for visual consistency.
- [x] **Tag legend in Project view uses aliases** — Tag names now resolved via `tagAliases` instead of showing raw color keys. Count shown for every tag (including 0).
- [x] **Consistent header banners** — Articles view now has a `corpus-banner` matching the style of Selected and Corpus views. Selected banner now also shows tag count. All three banners show: total/selected/corpus/tags-used counts.
- [x] **History tag bar** — Each query card in the History view now shows a thin (4px) horizontal stacked bar below the query preview, proportionally colored by tag distribution of that run's articles (untagged shown as surface-3).

---

## Visualizations

- [x] **Fix bar spacing in tag distribution** — The horizontal spacing between bars must be uniform. Tag names must fit on a single line; there is enough horizontal space to widen the label column so names never wrap to two lines.

- [x] **Year chart: vertical stacked column chart** — The year-distribution tab should render *vertical* bars (one column per year), each column's height proportional to the absolute number of articles in that year. Bars are stacked by tag color. Replace the current horizontal stacked-bar implementation with this column chart.

- [x] **World map visualization** — Add a world-map tab that aggregates affiliation countries, stays readable in dark/light mode, and exports to PNG.

---

## New Features

- [x] **Auto-tag by journal name** — Add a button (in the Articles view toolbar) that runs a heuristic pass over all untagged articles and assigns a tag based on keywords in `publicationName`. Example rules: "Engineering" → Engineering tag, "Computer" → Computer Science tag, "Behaviour" / "Social" → Behavioural Sciences tag. Rules should be easy to extend.

- [x] **Fetch affiliations / country data** — Add a DOI/OpenAlex/PMID-backed toolbar action that pulls affiliation names and country codes for the world-map visualization.

- [x] **Fetch missing abstracts via DOI** — Add a button in the Articles view that attempts to enrich articles that have a DOI but an empty abstract by querying a free metadata API (e.g. Crossref `api.crossref.org/works/{DOI}`). Results are written back to `search_log.json` via the File System Access API (needs `{ mode: 'readwrite' }`). Show progress and a summary when done.

- [x] **Fix About nav icon** — `data-icon="info"` in index.html was not matched by `about:` key in iconMap. Added `info:` key.

- [x] **PRISMA 2020 Screening Flow chart** — New 4th tab in Visualizations view. Shows the full SLR screening funnel: Identification (raw query results) → Screening (after deduplication) → Eligibility (selected) → Included (corpus). Each stage shows absolute count, % of total identified, and a proportional bar. Side exclusion boxes show removed/excluded counts per step. Mode selector hidden when PRISMA tab is active.

---

## Completed

<!-- Move items here (with [x]) once implemented -->
- [x] Saturate / update color palette in `tags_config.json` and `DEFAULT_TAGS_CONFIG` in `data.js`
- [x] Add pencil icon to `icons.js`
- [x] Add `saveTagAliases` and `saveTagsConfig` to `data.js`
- [x] Add `renameTag` and `addTag` to `app.js`
- [x] Implement Tags view (`renderTags`) with rename inline input and Add-Tag form
- [x] Add year-distribution chart tab to Visualizations view (horizontal stacked bars — to be replaced by vertical column chart, see above)
- [x] Fix `renderYearBars` HTML structure (stacked bar as nested div inside full-width track)
- [x] Add CSS classes for year chart (`.viz-year-label`, `.viz-bar-track-stacked`, `.viz-stacked-seg`) → replaced with vertical column chart CSS (`.viz-col-chart`, `.viz-col-item`, `.viz-col-bar`, `.viz-col-seg`)
- [x] Add `.hist-copy-btn` CSS
- [x] Sidebar: swap Search and Articles order
- [x] Sidebar: swap History and Articles order (final: Search -> History -> Articles)
- [x] About view: use full horizontal space
- [x] Auto-tag: 3-pass matching + expanded keyword rules
- [x] Auto-tag: fix grey colors (auto-populate tagsConfig)
- [x] Auto-tag: fix tags lost on project switch (sync globalTags cache)
- [x] PRISMA diagram title to `PRISMA 2020`
- [x] About `What's New` PRISMA label to `PRISMA 2020`
- [x] Project: edit name and description inline
- [x] Tags: native color picker swatch per tag
- [x] Tags: color scheme panel (Vivid / Pastel / Warm / Cool / Mono / Size-scaled)
- [x] Force Auto-tag orange button with confirmation modal
- [x] Databases page: add Author Retrieval API notice (Fetch Authors workaround)
- [x] Auto-tag rules: add Philosophy, Futures and Foresight, Social Sciences, Religion, Cultural Studies, Socio-Economics categories
- [x] Auto-tag rules: fix `sociolog` stem, add politics/accountability to Law and Policy
- [x] Auto-tag rules: fix Society and Anthropology mapping to Social Sciences
- [x] Auto-tag persistence fix: use `bulkUpdateAnnotations` return value with full re-derive
- [x] Auto-tag fix: write `tagAliases` after auto-tag so Tags view shows semantic names
- [x] Tag color/name bug: group by color key not tag label; `openFolder` uses readwrite
- [x] Fix duplicate `const aliases` crash in `renderTags` (blank screen)
- [x] Visualizations: stacked bars use more vertical space
- [x] Visualizations: PRISMA tab heading reflects active chart type
- [x] Visualizations: swap position of mode tabs and chart-type tabs
- [x] Visualizations: add query count to header stats
- [x] Project tab: use full horizontal space
- [x] About tab: keep `PRISMA 2020` label on one line
- [x] About tab: logo icon scaled to span header/version/description block
