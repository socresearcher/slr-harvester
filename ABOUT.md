# SLR Harvester Web — About

**SLR Harvester Web** is the browser-based rewrite of SLR Harvester, a desktop tool for conducting and managing systematic literature reviews (SLRs). Version 2.0 runs entirely in Chrome or Edge as a local `index.html` file — no server, no Python runtime, no installation. Just open the file and pick your project folder.

---

## What it does

SLR Harvester Web lets you search multiple academic databases, collect and annotate results, and produce outputs — all without leaving the browser.

- **Search** Scopus, PubMed, and OpenAlex directly from the app
- **Annotate** articles with tags, colors, comments, Selected and Corpus flags
- **Visualize** your corpus with tag distribution charts, a year timeline, and a PRISMA 2020 screening flow diagram
- **Auto-tag** articles by discipline using journal keyword heuristics
- **Fetch** missing abstracts and full author lists via the Crossref API
- **Manage tags** with inline renaming, one-click color schemes, and per-tag color editing
- **Query History** — full log of all searches with timestamps and result counts
- Open **any number of projects** stored in the same root folder

All data stays local — no network requests are made except to the APIs you explicitly trigger.

---

## Supported databases

| Database | API | Key required | Notes |
|---|---|---|---|
| **Scopus** | Elsevier Search API | Yes (free via Elsevier Developer Portal) | Institutional subscription required for full abstracts/author lists (COMPLETE view); falls back to STANDARD view + Crossref enrichment otherwise |
| **PubMed** | NCBI E-utilities | No | Free, open; abstracts via Crossref |
| **OpenAlex** | OpenAlex Works API | No (optional key/email for higher rate limits) | Free, open; full-text search across a large open index of scholarly works |

### Why arXiv and Semantic Scholar are not included

Both were tested but their APIs don't allow direct browser-side (CORS) requests, or return CORS-less error responses under normal use — the browser blocks the request before this app ever sees a response. Without a server-side proxy (which would break the "no server, all data local" design), they can't be integrated reliably. Use them directly via their own websites instead.

### Why Google Scholar is not included

Google Scholar has no official public API. Any programmatic access to Scholar requires scraping its web interface, which is explicitly prohibited by Google's Terms of Service. Scraping Scholar in an automated way would expose users to account bans and potential legal risk. Several third-party libraries exist that attempt to scrape Scholar, but they are unreliable (frequently break when Google changes its HTML), rate-limited by IP blocks, and legally questionable. For these reasons, Google Scholar is not and will not be integrated.

### Why Web of Science, ProQuest, JSTOR, and others are not included

These databases provide APIs only under institutional subscription agreements. There is no free, open tier available to individual researchers or open-source projects. Access would require a valid institutional license, which cannot be assumed.

---

## Architecture

- **Zero dependencies** — plain HTML, CSS, JavaScript. No React, Vue, webpack, or any other framework or build tool.
- **Works as `file://` or hosted `https://`** — can be opened directly from the filesystem, or run from the live GitHub Pages deployment at [socresearcher.github.io/slr-harvester](https://socresearcher.github.io/slr-harvester/); no web server of your own required either way. Your project data always stays on your device — Pages only serves the app's own code.
- **No external CDN** — no fonts, icon libraries, or scripts loaded from the internet.
- **File System Access API** — uses the browser's `showDirectoryPicker()` to read (and optionally write) your project folder. Requires **Chrome 86+ or Edge 86+ on desktop**. Desktop Firefox and Safari don't support it, and as of now **no mobile browser does either** (Chrome, Edge, or Safari on phone/tablet) — this is a platform limitation, not something this app can work around; a clear in-app message explains this when detected.
- **IndexedDB** — the folder handle is persisted between sessions so you don't need to pick it every time.
- **Dark mode by default** — theme persisted in `localStorage`, togglable at any time.

---

## Data format

SLR Harvester Web reads the same project folder structure produced by SLR Harvester v1 (the Python desktop app). Projects are stored as JSON files inside timestamped subfolders:

```
<root>/
  projects.json
  projects/
    20260416_193649/
      search_log.json        ← array of query runs with results
      slr_global_tags.json   ← annotation index keyed by EID
      tags_config.json       ← tag name → hex color
      query_history.json
      query_favorites.json
      tag_aliases.json
```

This means projects created in the Python desktop app are fully readable in the browser app and vice versa (with write support enabled).

---

## Browser compatibility

| Browser | Support |
|---|---|
| Chrome 86+ (desktop) | ✅ Full support |
| Edge 86+ (desktop) | ✅ Full support |
| Firefox (desktop) | ❌ No File System Access API — error message shown |
| Safari (desktop) | ❌ No File System Access API — error message shown |
| Any mobile browser (Chrome, Edge, Safari on phone/tablet) | ❌ No File System Access API on any mobile platform yet — error message shown |

---

## Troubleshooting

### App UI appears empty (Databases/Projects/other views blank)

Cause (known issue fixed): a JavaScript branch mix-up in `js/views.js` inside `wireChartInteractivity` can break rendering after map-related changes if a stale script is still cached.

How to fix quickly:

1. Hard reload the page with `Ctrl+F5`.
2. If needed, close and reopen `index.html`.
3. Verify that `js/views.js` contains separate `if (chartType === 'year')` and `if (chartType === 'world')` blocks (not nested/mixed).

Note: Under `file://`, browsers can occasionally keep stale script versions longer than expected.

---

## What's new in v2 (vs. the Python desktop app)

- **Interactive visualizations** — hovering a legend entry or chart segment cross-highlights the entire chart
- **PRISMA 2020 diagram** — auto-generated screening flow diagram for use directly in your methods section
- **Fetch Abstracts & Authors** — Crossref integration to fill gaps Scopus leaves (first-author-only, missing abstracts)
- **Auto-tag by journal** — heuristic discipline tagging with one click
- **Tag color themes** — 17 built-in schemes (Vivid, Pastel, Monochrome, Earth, Neon, …) plus individual per-tag color editing
- **Multi-database search** — PubMed and OpenAlex alongside Scopus
- **Browser-based, zero-install** — no Python, no dependencies, works offline
- **Hosted on GitHub Pages** — usable directly from a URL, no download required, alongside the original local `file://` mode

---

## Development

Both the original SLR Harvester desktop application and this browser-based Web version — including its bug fixes, new features, and the GitHub Pages deployment setup — were built with the assistance of AI coding agents (including GitHub Copilot and Claude/Claude Code by Anthropic) working alongside the author.

---

## License

Non-Commercial Source-Available License.  
© 2025–2026 Gregor Hobersdorfer. All rights reserved.

See [LICENSE.md](LICENSE.md) for the full text.
