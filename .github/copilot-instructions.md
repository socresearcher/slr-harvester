# SLR Harvester — Copilot Instructions

This file is read automatically by GitHub Copilot before every session.
It documents both the original desktop app and the new browser-based rewrite.

---

## Session Checklist

**At the start of every session, read [`TASKS.md`](../slr-harvester-web/TASKS.md)** (web app folder).
- Cross-check open tasks against any changes already present in the codebase.
- If a task appears to be implemented, mark it as done (`[x]`) in `TASKS.md`.
- When the user asks for new work, check whether it is already listed; if not, add it before implementing.
- After completing any task during a session, immediately mark it `[x]` in `TASKS.md`.
- Exception: the recurring task for continuous auto-tagging improvement may only be marked done by the user; keep it open until the user explicitly confirms the tagging quality is precise enough.
- Also check the top section **"Prompt Inbox (Session Start)"** in `TASKS.md`.
- If there are open prompt items, ask the user whether each item should be implemented in the current session.
- Keep parked prompts only in `TASKS.md` (do not use separate outstanding prompt files).

---

## Repository Layout

```
SLR Harvester/              ← workspace root
  src/                      ← Python desktop app (customtkinter)
  projects/                 ← live project data (JSON)
  projects.json             ← project registry
  slr-harvester-web/        ← NEW: browser-based rewrite (primary work target)
    index.html
    css/style.css
    js/icons.js
    js/data.js
    js/views.js
    js/app.js
```

---

## SLR Harvester Web — Architecture

The browser app is a **zero-dependency, vanilla HTML/CSS/JS** single-page app.

### Absolute rules
- **No frameworks** — no React, Vue, Angular, Svelte, etc.
- **No build tools** — no webpack, vite, rollup, parcel. Must open as `index.html`.
- **No external CDN** — no fonts, icon libraries, or scripts from the internet.
- **No PNG icons** — every icon is an inline SVG string defined in `js/icons.js`.
- **No ES modules** — use `window.SLRIcons`, `window.SLRData`, `window.SLRViews`,
  `window.SLRApp` as global namespaces. ES modules break under `file://` in Chrome.
- **CSS custom properties only** — never hardcode colors outside `:root { }` blocks.
- **Dark mode by default** — theme stored in `localStorage`, toggled via `data-theme`
  attribute on `<html>`.

### Script load order in index.html
`icons.js` → `data.js` → `views.js` → `app.js`

Each file defines one global: `window.SLRIcons`, `window.SLRData`,
`window.SLRViews`, `window.SLRApp`.

### Browser compatibility
- **Primary target:** Chrome 86+, Edge 86+ — full File System Access API support.
- **Firefox:** `showDirectoryPicker()` is not supported; show a clear error message.
- **Safari:** no File System Access API; show error message.
- Always guard with `if (!window.showDirectoryPicker)` and surface a helpful notice.

---

## Data Format

The app reads from an **SLR Harvester root folder** picked via `showDirectoryPicker()`.
Always use `{ mode: 'read' }`. Persist the directory handle in **IndexedDB**
(database: `slr-harvester-web`, store: `handles`, key: `'root'`).

### Folder structure
```
<root>/
  projects.json
  projects/
    <timestamp_folder>/        e.g. 20260416_193649
      search_log.json
      slr_global_tags.json
      tags_config.json
      query_history.json
      query_favorites.json     (optional)
      query_names.json         (optional)
      tag_aliases.json         (optional)
```

### projects.json
```json
{
  "projects": [
    {
      "name": "Bachelorarbeit",
      "description": "No description",
      "created": "2026-04-16",
      "workspace_folder": "20260416_193649"
    }
  ]
}
```

### search_log.json  ← array of query runs
```json
[
  {
    "timestamp": "2026-02-13 18:22:35",
    "query": "TITLE-ABS-KEY(...)",
    "view": "STANDARD",
    "count": 149,
    "results": [
      {
        "eid": "2-s2.0-105021928799",
        "title": "...",
        "authors": "Liggieri K.",
        "date": "2025-09-01",
        "citedby": "1",
        "doi": "10.xxx/yyy",
        "publicationName": "Technology and Language",
        "abstract": ""
      }
    ]
  }
]
```

### slr_global_tags.json  ← annotation index keyed by EID
```json
{
  "2-s2.0-105010832053": {
    "color": "Red",
    "tag": "Social sciences (sociology, STS, ...)",
    "comment": "",
    "last_modified": "2026-02-03T18:15:59",
    "selected": true,
    "corpus": true
  }
}
```

### tags_config.json  ← tag name → hex color
```json
{
  "None": "",
  "Red": "#E57373",
  "Orange": "#F4A261",
  "Yellow": "#F6D06F",
  "Green": "#81C995",
  "Turquoise": "#7BD3D3",
  "Blue": "#64A8FF",
  "Violet": "#B494F7",
  "Pink": "#F79AC1",
  "Magenta": "#D38AD8",
  "Brown": "#B08A6A",
  "Gray": "#A5ACB8",
  "Olive": "#B7BF5E",
  "Lavender": "#C7B8EA",
  "Steel Blue": "#7AA6D9",
  "Coral": "#F59F8B",
  "Gold": "#DCB770",
  "Teal": "#00aa55",
  "Indigo": "#7F8AD4"
}
```

### Article deduplication
Articles appear in multiple query results. Always deduplicate by `eid` (or `doi`
if no eid). When merging: prefer non-empty `abstract`; keep latest `citedby`.
Merge with `slr_global_tags.json` to attach `color`, `tag`, `comment`,
`selected`, `corpus` per article.

---

## Views

| View | Route key | Purpose |
|------|-----------|---------|
| Welcome | `welcome` | First launch; folder picker + compatibility check |
| Projects | `projects` | Grid of all projects with stats |
| Articles | `articles` | Article list for current project (main view) |
| History | `history` | Query history for current project |
| Project | `project` | Project metadata and tasks |

### Articles view filter state
```js
{
  mode: 'all',      // 'all' | 'selected' | 'corpus'
  tag: null,        // tag name string or null
  yearFrom: '',
  yearTo: '',
  sort: 'newest',   // 'newest' | 'oldest' | 'cited' | 'title'
  search: '',       // full-text search in title/authors/journal
}
```

---

## Design System

### Color tokens (CSS custom properties)
Always defined on `[data-theme="dark"]` and `[data-theme="light"]` selectors.

Key tokens:
```
--bg            main page background
--surface       card / sidebar background
--surface-2     elevated surface, hover states
--border        subtle dividers
--text          primary text
--text-muted    secondary / metadata text
--accent        interactive blue
--accent-hover  darker accent on hover
--danger        red for errors
```

### Typography
Use only the system font stack: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

### Article list item layout
```
[3px TAG-COLOR border-left]  Title                       [S badge] [C badge]
                             Authors · Journal · Year · Cited N
                             [tag name pill]
```
- Selected badge: styled `S` pill in accent color
- Corpus badge: styled `C` pill in green
- Tag color applied as `style="--tag-color:#E57373"` on the item element,
  used as `border-left-color: var(--tag-color, transparent)`.

### Animations
- Sidebar collapse/expand: CSS `width` transition, 200ms ease
- Article expand: CSS `max-height` transition, 200ms ease
- Always wrap in `@media (prefers-reduced-motion: no-preference)`

---

## Feature Roadmap

- [x] Folder picker with IndexedDB persistence
- [x] Theme toggle (dark/light)
- [x] Projects view
- [x] Articles view with filter/sort/search
- [x] Query History view
- [ ] Export (BIB / RIS / CSV) — client-side file generation
- [ ] Write support (edit annotations, selected/corpus status)
- [ ] Tag management (rename, recolor, merge tags)
- [ ] Charts (year distribution, tag distribution) — native Canvas, no chart library
- [ ] Project tasks/milestones view

---

## Security Notes

- Always open the folder in `{ mode: 'read' }` until write support is explicitly added.
- No network requests are made by the app — all data is local.
- No eval(), no innerHTML with unescaped user data — always use `textContent` or
  sanitize before setting `innerHTML`.
