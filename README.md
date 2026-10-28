# SLR Harvester

> **Development notice.** Further development of SLR Harvester Web now takes place in a separate application, not in this repository. The new functions will be brought back here later, in one step or gradually, by hand, and this repository will then be updated. Until then there will be few or no commits here, and the commit history has a gap; that does not mean the project has been abandoned. The hosted web app keeps working as it is. The original desktop version is no longer developed and is kept for reference only.

**SLR Harvester** helps you conduct structured, reproducible Systematic Literature Reviews (SLRs) — searching academic databases, screening and tagging results, and producing exports for your methods section. Two versions are available, reading and writing the same project folder format:

- **[SLR Harvester Web](#slr-harvester-web)** — browser-based, zero-install. Recommended for most users, **in beta** (see below).
- **[SLR Harvester Desktop](#slr-harvester-desktop-original)** — the original Python desktop application.

> **Beta — a test project, not a finished product.** The web version is a research prototype under trial. So far it has been used productively only by its author, and shown in person to a few others; there has been no field test and no feedback survey. **There are no automatic backups** — export your lists and keep your own copies. Availability is not guaranteed and stored formats may change between versions. Found something wrong? [Report an issue](https://github.com/socresearcher/slr-harvester/issues).

---

## SLR Harvester Web

Runs entirely in the browser — no installation, no Python. Two ways to use it:

- **Hosted**: open **[socresearcher.github.io/slr-harvester](https://socresearcher.github.io/slr-harvester/)** directly, or
- **Local**: open [`slr-harvester_web/index.html`](slr-harvester_web/index.html) in Chrome or Edge.

Either way, your project data never leaves your device — the app only ever reads and writes the local (or cloud-synced) folder you explicitly select.

### Getting started

1. **Open the app** at the link above (or locally).
2. Click **Open SLR Harvester Folder**.
   - **First time?** Create a new, empty folder (any name, e.g. `SLR-Harvester-Data`) in the picker dialog and select it. Nothing is written until you create your first project.
   - **Already have data** (e.g. from the desktop app)? Select that folder instead — it's read and used as-is.
3. Click **New Project**, give it a name and description.
4. Go to **Search**, pick a database (Scopus, PubMed, OpenAlex, Crossref or DOAJ), enter a query, and run it.
   - Scopus needs a free API key from the [Elsevier Developer Portal](https://dev.elsevier.com/) — add it under **Settings**. The other four need no key.
   - Crossref ranks by relevance and has no Boolean logic; DOAJ returns at most 1,000 records per query.
   - Use **Settings → Test API Key** to verify a Scopus key before relying on it.
5. Review results in **Articles** — tag them, mark **Selected** (candidates) and **Corpus** (final inclusion) as you screen.
   - **Auto-tag** applies discipline tags from journal-name keywords in one click.
   - **Fetch All** enriches missing abstracts, full author lists, document types, and affiliation/country data via Crossref/OpenAlex.
6. Check **Visualizations** for tag distribution, a year timeline, a world map of affiliations, and an auto-generated **PRISMA 2020** screening-flow diagram for your methods section.
7. Export your **Selected** or **Corpus** list as `.bib`, `.ris`, or `.csv` from the export menu in those views, or export any chart as `.png`.

Full feature list, architecture, and browser compatibility: see [ABOUT.md](ABOUT.md).

### Notes

- Requires Chrome or Edge on **desktop** — the File System Access API this app relies on isn't available on any mobile browser yet (Android or iOS, any vendor), nor on desktop Firefox/Safari. A clear in-app message explains this if detected.
- API keys and settings are stored per-folder (in `slr_config.json`, created automatically the first time you save one), never uploaded anywhere.

---

## SLR Harvester Desktop (original)

SLR Harvester Desktop is a Python desktop application for conducting structured, reproducible SLRs on **Scopus** within a persistent, dashboard‑based workflow environment.

### Documentation

Follow instructions in the documents below:

[![Install](https://img.shields.io/badge/Install-Guide-2ea44f?style=for-the-badge)](slr-harvester/docs/INSTALL.md)
[![Usage](https://img.shields.io/badge/Usage-Guide-0366d6?style=for-the-badge)](slr-harvester/docs/USAGE_GUIDE.md)
[![API Limitations](https://img.shields.io/badge/API-Limitations-ff9800?style=for-the-badge)](slr-harvester/docs/API_LIMITATIONS.md)
[![Workflow Logic](https://img.shields.io/badge/Workflow-Logic-795548?style=for-the-badge)](slr-harvester/docs/WORKFLOW_LOGIC.md)

Alternatively, use the direct links:

- Installation and setup: slr-harvester/docs/INSTALL.md
- Usage guide with screenshots: slr-harvester/docs/USAGE_GUIDE.md
- API limitations and access levels: slr-harvester/docs/API_LIMITATIONS.md
- Workflow logic and methodology: slr-harvester/docs/WORKFLOW_LOGIC.md

### Highlights

- Project‑based storage (queries, results, tags, screening states, corpus)
- Query builder with field codes and boolean operators
- Two‑stage inclusion (Selected → Corpus), reversible
- Exports: `.bib`, `.ris`, `.csv`; charts as `.png`

### Notes

- Data is stored locally in the projects/ folder.
- First run creates local configuration files if missing.
