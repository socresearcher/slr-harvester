/**
 * SLR Harvester Web — SVG Icon Library
 * All icons are inline SVG strings.
 * Access via: SLRIcons.logo, SLRIcons.folder, etc.
 *
 * Stroke icons use: viewBox="0 0 24 24", fill="none",
 *   stroke="currentColor", stroke-width="1.8",
 *   stroke-linecap="round", stroke-linejoin="round"
 */

window.SLRIcons = (() => {

  const base = (path, extra) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${path}</svg>`;

  return {

    // App logo — six curved "petal" facets in a woven checkerboard of gold
    // and teal. Gold is a fixed brand color (matches the favicon exactly);
    // teal uses currentColor so it still tracks whatever accent shade the
    // container sets, same as the old book logo and every other icon here.
    logo: `<svg viewBox="0 0 216 298" xmlns="http://www.w3.org/2000/svg">
      <path d="M 44.44 30.03 Q 40.00 26.00 40.00 32.00 L 40.00 80.00 L 99.50 134.00 L 99.50 88.00 Q 99.50 80.00 93.58 74.62 L 44.44 30.03 Z" fill="#e8a317"/>
      <path d="M 171.56 30.03 Q 176.00 26.00 176.00 32.00 L 176.00 80.00 L 116.50 134.00 L 116.50 88.00 Q 116.50 80.00 122.42 74.62 L 171.56 30.03 Z" fill="currentColor"/>
      <path d="M 44.44 101.03 Q 40.00 97.00 40.00 103.00 L 40.00 151.00 L 99.50 205.00 L 99.50 159.00 Q 99.50 151.00 93.58 145.62 L 44.44 101.03 Z" fill="currentColor"/>
      <path d="M 171.56 101.03 Q 176.00 97.00 176.00 103.00 L 176.00 151.00 L 116.50 205.00 L 116.50 159.00 Q 116.50 151.00 122.42 145.62 L 171.56 101.03 Z" fill="#e8a317"/>
      <path d="M 44.44 172.03 Q 40.00 168.00 40.00 174.00 L 40.00 222.00 Q 40.00 276.00 99.50 276.00 L 99.50 230.00 Q 99.50 222.00 93.58 216.62 L 44.44 172.03 Z" fill="#e8a317"/>
      <path d="M 171.56 172.03 Q 176.00 168.00 176.00 174.00 L 176.00 222.00 Q 176.00 276.00 116.50 276.00 L 116.50 230.00 Q 116.50 222.00 122.42 216.62 L 171.56 172.03 Z" fill="currentColor"/>
    </svg>`,

    // Home — house
    home: base(
      `<path d="M3 11.5L12 4l9 7.5"/>
       <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>`
    ),

    // Projects — grid of squares
    projects: base(
      `<rect x="3" y="3" width="7" height="7" rx="1"/>
       <rect x="14" y="3" width="7" height="7" rx="1"/>
       <rect x="3" y="14" width="7" height="7" rx="1"/>
       <rect x="14" y="14" width="7" height="7" rx="1"/>`
    ),

    // Articles — list with lines
    articles: base(
      `<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
       <rect x="9" y="3" width="6" height="4" rx="1"/>
       <path d="M9 12h6M9 16h4"/>`
    ),

    // History — clock
    history: base(
      `<circle cx="12" cy="12" r="9"/>
       <path d="M12 7v5l3.5 2"/>`
    ),

    // Project — info / clipboard
    project: base(
      `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
       <path d="M14 2v6h6M12 12v5M9.5 14.5h5"/>`
    ),

    // Folder — closed
    folder: base(
      `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`
    ),

    // Folder open
    folderOpen: base(
      `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
       <path d="M2 10h20"/>`
    ),

    // Sun — light mode
    sun: base(
      `<circle cx="12" cy="12" r="4"/>
       <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41
                M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>`
    ),

    // Moon — dark mode
    moon: base(
      `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`
    ),

    // Fullscreen enter
    fullscreen: base(
      `<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/>`
    ),

    // Fullscreen exit
    fullscreenExit: base(
      `<path d="M9 3v5H4M15 3v5h5M9 21v-5H4M20 16v5h-5"/>`
    ),

    // Menu / hamburger (3 lines)
    menu: base(
      `<path d="M3 12h18M3 6h18M3 18h18"/>`
    ),

    // Chevron left
    chevronLeft: base(
      `<path d="M15 18l-6-6 6-6"/>`
    ),

    // Chevron right
    chevronRight: base(
      `<path d="M9 18l6-6-6-6"/>`
    ),

    // Chevron down
    chevronDown: base(
      `<path d="M6 9l6 6 6-6"/>`
    ),

    // Chevron up
    chevronUp: base(
      `<path d="M18 15l-6-6-6 6"/>`
    ),

    // Selected — bookmark
    selected: base(
      `<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>`
    ),

    // Corpus — check circle
    corpus: base(
      `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
       <path d="M22 4L12 14.01l-3-3"/>`
    ),

    // Filter / funnel
    filter: base(
      `<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>`
    ),

    // Wand — Auto-Tag Rules nav item
    wand: base(
      `<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/>
       <path d="m14 7 3 3"/>
       <path d="M5 6v4"/>
       <path d="M19 14v4"/>
       <path d="M10 2v2"/>
       <path d="M7 8H3"/>
       <path d="M21 16h-4"/>
       <path d="M11 3H9"/>`
    ),

    // Sort / arrows up-down
    sort: base(
      `<path d="M3 6h18M7 12h10M11 18h2"/>`
    ),

    // Search / magnifying glass
    search: base(
      `<circle cx="11" cy="11" r="8"/>
       <path d="M21 21l-4.35-4.35"/>`
    ),

    // Close / X
    close: base(
      `<path d="M18 6L6 18M6 6l12 12"/>`
    ),

    // External link
    externalLink: base(
      `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
       <path d="M15 3h6v6M10 14L21 3"/>`
    ),

    // DOI / link
    link: base(
      `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
       <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`
    ),

    // Copy to clipboard
    copy: base(
      `<rect x="9" y="9" width="13" height="13" rx="2"/>
       <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`
    ),

    check: base(
      `<polyline points="20 6 9 17 4 12"/>`
    ),

    // Tag label
    tag: base(
      `<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
       <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none"/>`
    ),

    // Calendar
    calendar: base(
      `<rect x="3" y="4" width="18" height="18" rx="2"/>
       <path d="M16 2v4M8 2v4M3 10h18"/>`
    ),

    // Cited by / citations
    cited: base(
      `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
       <circle cx="9" cy="7" r="4"/>
       <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>`
    ),

    // Warning / alert triangle
    warning: base(
      `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
       <path d="M12 9v4M12 17h.01"/>`
    ),

    // Layers / dedup
    layers: base(
      `<polygon points="12 2 2 7 12 12 22 7 12 2"/>
       <polyline points="2 17 12 22 22 17"/>
       <polyline points="2 12 12 17 22 12"/>`
    ),

    // Refresh
    refresh: base(
      `<polyline points="1 4 1 10 7 10"/>
       <path d="M3.51 15a9 9 0 1 0 .49-4.5"/>`
    ),

    // Settings / gear
    settings: base(
      `<circle cx="12" cy="12" r="3"/>
       <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
                a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
                A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83
                l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
                A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83
                l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
                a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83
                l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
                a1.65 1.65 0 0 0-1.51 1z"/>`
    ),

    // Plus / add
    plus: base(
      `<line x1="12" y1="5" x2="12" y2="19"/>
       <line x1="5" y1="12" x2="19" y2="12"/>`
    ),

    // Star
    star: base(
      `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`
    ),

    // Chart / bar chart — Visualizations
    chart: base(
      `<rect x="18" y="3" width="4" height="18"/>
       <rect x="10" y="8" width="4" height="13"/>
       <rect x="2" y="13" width="4" height="8"/>`
    ),

    // Globe / world map
    globe: base(
      `<circle cx="12" cy="12" r="9"/>
       <path d="M3 12h18"/>
       <path d="M12 3a15 15 0 0 1 0 18"/>
       <path d="M12 3a15 15 0 0 0 0 18"/>`
    ),

    // Citation network — three connected nodes
    network: base(
      `<circle cx="12" cy="5" r="2.5"/>
       <circle cx="5" cy="18" r="2.5"/>
       <circle cx="19" cy="18" r="2.5"/>
       <path d="M10.3 6.8 6.7 15.7"/>
       <path d="M13.7 6.8 17.3 15.7"/>
       <path d="M7.5 18h9"/>`
    ),

    // Supabase mark — a bolt/flash glyph, used on the "Continue with
    // Supabase" button and the About page's Cloud Sync note. Not the
    // literal trademarked asset (original geometry, not traced from
    // Supabase's brand SVG), just evocative of it via shape — filled with
    // currentColor like the rest of this set (unlike Supabase's own asset,
    // which is always brand green) so it reads correctly in every context:
    // ink-colored for contrast on the turquoise button, accent-turquoise
    // inline with the rest of the About page's icon list.
    supabaseLogo:
      `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
         <path d="M13.4 21.6c-.5.7-1.7.3-1.6-.6l.4-9.5h6.9c1.3 0 2.1 1.5 1.3 2.6l-7 7.5z"/>
         <path d="M10.6 2.4c.5-.7 1.7-.3 1.6.6l-.4 9.5H4.9c-1.3 0-2.1-1.5-1.3-2.6l7-7.5z"/>
       </svg>`,

    // GitHub octicon "mark-github" — GitHub's own MIT-licensed icon mark
    // (github.com/primer/octicons), used on the "Hosted on GitHub Pages"
    // About bullet. Filled, currentColor.
    githubLogo:
      `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
         <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
       </svg>`,

    // Databases — cylinder stack
    databases: base(
      `<ellipse cx="12" cy="5" rx="9" ry="3"/>
       <path d="M21 5v4c0 1.66-4.03 3-9 3S3 10.66 3 9V5"/>
       <path d="M21 9v4c0 1.66-4.03 3-9 3S3 14.66 3 13V9"/>
       <path d="M21 13v4c0 1.66-4.03 3-9 3S3 18.66 3 17v-4"/>`
    ),

    // Mail / contact
    mail: base(
      `<rect x="2" y="4" width="20" height="16" rx="2"/>
       <path d="m2 7 10 7 10-7"/>`
    ),

    // Pencil / rename
    pencil: base(
      `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
       <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>`
    ),

    // Trash / delete
    trash: base(
      `<polyline points="3 6 5 6 21 6"/>
       <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
       <path d="M10 11v6M14 11v6"/>
       <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`
    ),

    // Archive box — Query History archive tab / archive action
    archive: base(
      `<rect x="2" y="3" width="20" height="5" rx="1"/>
       <path d="M4 8v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
       <path d="M10 12h4"/>`
    ),

    // Restore / undo — move an archived or trashed query back to active
    restore: base(
      `<polyline points="1 4 1 10 7 10"/>
       <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`
    ),

    // PRISMA flow chart icon (3 decreasing bars = screening funnel)
    prisma: base(
      `<rect x="3" y="3" width="18" height="3.5" rx="1.5"/>
       <rect x="6" y="9.5" width="12" height="3.5" rx="1.5"/>
       <rect x="9" y="16" width="6" height="3.5" rx="1.5"/>`
    ),

    // User / authors icon
    user: base(
      `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
       <circle cx="12" cy="7" r="4"/>`
    ),

    // Info circle — About view
    info: base(
      `<circle cx="12" cy="12" r="10"/>
       <path d="M12 16v-4M12 8h.01"/>`
    ),

    // Eye — abstract available
    eye: base(
      `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
       <circle cx="12" cy="12" r="3"/>`
    ),

    // Eye-off — no abstract
    eyeOff: base(
      `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
       <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
       <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
       <line x1="1" y1="1" x2="23" y2="23"/>`
    ),

    // Download / export
    download: base(
      `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
       <polyline points="7 10 12 15 17 10"/>
       <line x1="12" y1="15" x2="12" y2="3"/>`
    ),

    // Palette — color schemes
    palette: base(
      `<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
       <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
       <circle cx="8.5"  cy="7.5"  r=".5" fill="currentColor"/>
       <circle cx="6.5"  cy="12.5" r=".5" fill="currentColor"/>
       <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2v-.5c0-.55-.22-1.05-.59-1.41a.996.996 0 0 1 .01-1.42c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2h-2c-2.76 0-5-2.24-5-5 0-3.87 3.13-7 7-7s7 3.13 7 7v1.5c0 .83-.67 1.5-1.5 1.5S16 13.33 16 12.5V12c0-2.21-1.79-4-4-4z"/>`
    ),

  };

})();
