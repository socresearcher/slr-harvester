# SLR Harvester Web — About

**SLR Harvester Web** is the browser-based rewrite of SLR Harvester, a desktop tool for conducting and managing systematic literature reviews (SLRs). Version 2.0 runs entirely in Chrome or Edge as a local `index.html` file — no server, no Python runtime, no installation. Just open the file and pick your project folder.

---

## What it does

SLR Harvester Web lets you search multiple academic databases, collect and annotate results, and produce outputs — all without leaving the browser.

- **Search** Scopus, arXiv, PubMed, and Semantic Scholar directly from the app
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
| **Scopus** | Elsevier Search API | Yes (free via Elsevier Developer Portal) | Institutional subscription required for full abstracts |
| **arXiv** | arXiv Atom API | No | Free, open; max 500 results per query |
| **PubMed** | NCBI E-utilities | No | Free, open; max 2,000 results; abstracts via Crossref |
| **Semantic Scholar** | Academic Graph API | No | Free, open; max 1,000 results; includes abstracts and citation counts |

### Why Google Scholar is not included

Google Scholar has no official public API. Any programmatic access to Scholar requires scraping its web interface, which is explicitly prohibited by Google's Terms of Service. Scraping Scholar in an automated way would expose users to account bans and potential legal risk. Several third-party libraries exist that attempt to scrape Scholar, but they are unreliable (frequently break when Google changes its HTML), rate-limited by IP blocks, and legally questionable. For these reasons, Google Scholar is not and will not be integrated.

### Why Web of Science, ProQuest, JSTOR, and others are not included

These databases provide APIs only under institutional subscription agreements. There is no free, open tier available to individual researchers or open-source projects. Access would require a valid institutional license, which cannot be assumed.

---

## Architecture

- **Zero dependencies** — plain HTML, CSS, JavaScript. No React, Vue, webpack, or any other framework or build tool.
- **Works as `file://`** — can be opened directly from the filesystem; no web server required.
- **No external CDN** — no fonts, icon libraries, or scripts loaded from the internet.
- **File System Access API** — uses the browser's `showDirectoryPicker()` to read (and optionally write) your project folder. Requires Chrome 86+ or Edge 86+. Firefox and Safari do not support this API and will receive a clear error message.
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
| Chrome 86+ | ✅ Full support |
| Edge 86+ | ✅ Full support |
| Firefox | ❌ No File System Access API — error message shown |
| Safari | ❌ No File System Access API — error message shown |

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
- **Multi-database search** — arXiv, PubMed, Semantic Scholar alongside Scopus
- **Browser-based, zero-install** — no Python, no dependencies, works offline

---

## License

Non-Commercial Source-Available License.  
© 2025–2026 Gregor Hobersdorfer. All rights reserved.

See [LICENSE.md](../LICENSE.md) for the full text.
