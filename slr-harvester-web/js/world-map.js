/*
 * SLR Harvester Web — World map helper
 * Aggregates affiliation country data and renders a zoomable SVG choropleth
 * (country shapes filled by publication count, not point markers).
 * Country boundary data: Natural Earth (public domain), via world-atlas —
 * see js/world-map-paths-data.js for full attribution.
 *
 * Global: window.SLRWorldMap
 */

window.SLRWorldMap = (() => {
  const worldData = Array.isArray(window.SLRWorldMapData) ? window.SLRWorldMapData : [];
  const outlineData = Array.isArray(window.SLRWorldMapOutlineData) ? window.SLRWorldMapOutlineData : [];
  const countryPaths = (window.SLRWorldMapPaths && typeof window.SLRWorldMapPaths === 'object') ? window.SLRWorldMapPaths : {};

  const normalizeKey = (value) => String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

  const byIso2 = new Map();
  const byIso3 = new Map();
  const byName = new Map();

  for (const entry of worldData) {
    if (entry.iso2) byIso2.set(entry.iso2.toUpperCase(), entry);
    if (entry.iso3) byIso3.set(entry.iso3.toUpperCase(), entry);
    if (entry.name) byName.set(normalizeKey(entry.name), entry);
  }

  function getThemeColors() {
    const theme = typeof getComputedStyle === 'function' && typeof document !== 'undefined' && document.documentElement
      ? getComputedStyle(document.documentElement)
      : null;

    const themeColor = (token, fallback) => theme ? (theme.getPropertyValue(token).trim() || fallback) : fallback;

    return {
      ocean: themeColor('--surface-2', '#21262d'),
      oceanStroke: themeColor('--border', '#30363d'),
      land: themeColor('--surface-3', '#2d333b'),
      landStroke: themeColor('--border', '#30363d'),
      outline: themeColor('--text-faint', '#8b949e'),
      accent: themeColor('--accent', '#31e6d3'),
      accentHover: themeColor('--accent-hover', '#5ff0e0'),
      text: themeColor('--text', '#e6edf3'),
      muted: themeColor('--text-muted', '#8b949e'),
      bg: themeColor('--bg', '#0d1117'),
      heatLow: themeColor('--heat-low', '#17322e'),
      heatHigh: themeColor('--heat-high', '#5ff0e0'),
    };
  }

  const aliases = new Map([
    ['UNITEDSTATES', 'US'],
    ['UNITEDSTATESOFAMERICA', 'US'],
    ['USA', 'US'],
    ['GREATBRITAIN', 'GB'],
    ['BRITAIN', 'GB'],
    ['UNITEDKINGDOM', 'GB'],
    ['UK', 'GB'],
    ['ENGLAND', 'GB'],
    ['SCOTLAND', 'GB'],
    ['WALES', 'GB'],
    ['NORTHERNIRELAND', 'GB'],
    ['RUSSIA', 'RU'],
    ['RUSSIANFEDERATION', 'RU'],
    ['SOUTHKOREA', 'KR'],
    ['REPUBLICOFKOREA', 'KR'],
    ['KOREA,REPUBLICOF', 'KR'],
    ['NORTHKOREA', 'KP'],
    ['DEMOCRATICPEOPLESREPUBLICOFKOREA', 'KP'],
    ['VIETNAM', 'VN'],
    ['VIETNAM,SOCIALISTREPUBLICOF', 'VN'],
    ['VIETNAMSOCIALISTREPUBLICOF', 'VN'],
    ['LAOS', 'LA'],
    ['LAOPEOPLESDEMOCRATICREPUBLIC', 'LA'],
    ['CZECHREPUBLIC', 'CZ'],
    ['CZECHIA', 'CZ'],
    ['BOLIVIA', 'BO'],
    ['BOLIVIAPLURINATIONALSTATEOF', 'BO'],
    ['TANZANIA', 'TZ'],
    ['UNITEDREPUBLICOFTANZANIA', 'TZ'],
    ['IRAN', 'IR'],
    ['ISLAMICREPUBLICOFIRAN', 'IR'],
    ['SYRIA', 'SY'],
    ['SYRIANARABREPUBLIC', 'SY'],
    ['MOLDOVA', 'MD'],
    ['REPUBLICOFMOLDOVA', 'MD'],
    ['PALESTINE', 'PS'],
    ['STATEOFPALESTINE', 'PS'],
    ['PALESTINIANTERRITORY', 'PS'],
    ['KOSOVO', 'XK'],
    ['COTEDIVOIRE', 'CI'],
    ['CTEDIVOIRE', 'CI'],
    ['IVORYCOAST', 'CI'],
    ['DEMOCRATICREPUBLICOFTHECONGO', 'CD'],
    ['DRCONGO', 'CD'],
    ['REPUBLICOFTHECONGO', 'CG'],
    ['CONGOBRAZZAVILLE', 'CG'],
    ['SOMALILAND', 'SO'],
    ['TIMORLESTE', 'TL'],
    ['EASTTIMOR', 'TL'],
    ['MACEDONIA', 'MK'],
    ['NORTHMACEDONIA', 'MK'],
    ['ESWATINI', 'SZ'],
    ['SWAZILAND', 'SZ'],
    ['BRUNEI', 'BN'],
    ['MYANMAR', 'MM'],
    ['BURMA', 'MM'],
    ['HONGKONG', 'HK'],
    ['MACAU', 'MO'],
    ['TAIWAN', 'TW'],
    ['REPUBLICOFCHINA', 'TW'],
    ['CHINA', 'CN'],
    ['PEOPLESREPUBLICOFCHINA', 'CN'],
    ['SLOVAKIA', 'SK'],
    ['SERBIA', 'RS'],
    ['MONTENEGRO', 'ME'],
    ['BOSNIAANDHERZEGOVINA', 'BA'],
    ['HERZEGOVINA', 'BA'],
    ['GEORGIA', 'GE'],
    ['MALAYSIA', 'MY'],
    ['SLOVENIA', 'SI'],
    ['SAUDIARABIA', 'SA'],
    ['SOUTHAFRICA', 'ZA'],
    ['UAE', 'AE'],
    ['UNITEDARABEMIRATES', 'AE'],
    ['DOMINICANREPUBLIC', 'DO'],
    ['COSTARICA', 'CR'],
    ['PUERTORICO', 'PR'],
  ]);

  function normalizeCountryCode(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';

    const upper = raw.toUpperCase();
    if (upper === 'NONE' || upper === 'N/A' || upper === 'NA' || upper === '-99') return '';

    if (upper.length === 2 && byIso2.has(upper)) return upper;
    if (upper.length === 3 && byIso3.has(upper)) return byIso3.get(upper).iso2;

    const cleaned = normalizeKey(raw);
    if (cleaned.length === 2 && byIso2.has(cleaned)) return cleaned;
    if (cleaned.length === 3 && byIso3.has(cleaned)) return byIso3.get(cleaned).iso2;

    const alias = aliases.get(cleaned);
    if (alias && byIso2.has(alias)) return alias;

    const nameMatch = byName.get(cleaned);
    if (nameMatch) return nameMatch.iso2;

    return '';
  }

  function extractCountryCodesFromText(text) {
    if (!text) return [];

    const seen = new Set();
    const codes = [];
    const pushCode = (code) => {
      const normalized = normalizeCountryCode(code);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      codes.push(normalized);
    };

    String(text)
      .split(/[;,|/()\n]+/)
      .forEach(part => pushCode(part));

    const compact = normalizeKey(text);
    for (const [key, entry] of byName.entries()) {
      if (key.length > 3 && compact.includes(key)) pushCode(entry.iso2);
    }
    for (const [aliasKey, code] of aliases.entries()) {
      if (aliasKey.length > 3 && compact.includes(aliasKey)) pushCode(code);
    }

    return codes;
  }

  function extractCountries(article) {
    const values = [];
    const seen = new Set();

    const pushValue = (value) => {
      const code = normalizeCountryCode(value);
      if (!code || seen.has(code)) return;
      seen.add(code);
      values.push(code);
    };

    const fields = [
      article && article.affiliationCountries,
      article && article.countryCodes,
      article && article.countryCode,
      article && article.affiliationCountry,
      article && article.country,
    ];

    for (const field of fields) {
      if (!field) continue;
      if (Array.isArray(field)) {
        field.forEach(pushValue);
        continue;
      }
      if (typeof field === 'string' && /[;,|/]/.test(field)) {
        field.split(/[;,|/]/).forEach(pushValue);
        continue;
      }
      pushValue(field);
    }

    // Fallback: derive country codes from free-text affiliations when no explicit
    // country fields are present. This improves map coverage without re-fetching.
    if (values.length === 0) {
      const textChunks = [];
      if (article && Array.isArray(article.affiliations)) {
        textChunks.push(...article.affiliations.filter(Boolean));
      } else if (article && typeof article.affiliations === 'string') {
        textChunks.push(article.affiliations);
      }
      if (article && typeof article.affiliation === 'string') textChunks.push(article.affiliation);
      if (article && typeof article.authorAffiliation === 'string') textChunks.push(article.authorAffiliation);

      for (const chunk of textChunks) {
        const inferredCodes = extractCountryCodesFromText(chunk);
        for (const code of inferredCodes) pushValue(code);
      }
    }

    return values;
  }

  function aggregateCountryCounts(articles) {
    const counts = new Map();
    let mappedArticles = 0;

    for (const article of articles || []) {
      const codes = extractCountries(article);
      if (codes.length === 0) continue;
      mappedArticles++;
      for (const code of codes) {
        const meta = byIso2.get(code);
        if (!meta) continue;
        if (!counts.has(code)) {
          counts.set(code, {
            iso2: meta.iso2,
            iso3: meta.iso3,
            name: meta.name,
            continent: meta.continent || '',
            lon: meta.lon,
            lat: meta.lat,
            count: 0,
          });
        }
        counts.get(code).count += 1;
      }
    }

    const items = [...counts.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    return {
      items,
      mappedArticles,
      missingArticles: Math.max(0, (articles || []).length - mappedArticles),
    };
  }

  function projectPoint(lon, lat, width, height, pad) {
    const x = pad + ((lon + 180) / 360) * (width - pad * 2);
    const y = pad + ((90 - lat) / 180) * (height - pad * 2);
    return { x, y };
  }

  // --- Heat scale -----------------------------------------------------------

  function hexToRgb(hex) {
    const clean = String(hex || '').trim().replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const n = parseInt(full, 16);
    if (Number.isNaN(n) || full.length !== 6) return { r: 128, g: 128, b: 128 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function heatColor(t, colors) {
    const low = hexToRgb(colors.heatLow);
    const high = hexToRgb(colors.heatHigh);
    const clamped = Math.max(0, Math.min(1, t));
    const r = Math.round(low.r + (high.r - low.r) * clamped);
    const g = Math.round(low.g + (high.g - low.g) * clamped);
    const b = Math.round(low.b + (high.b - low.b) * clamped);
    return `rgb(${r},${g},${b})`;
  }

  // sqrt-scaled min-max normalization: keeps a handful of high-count outliers
  // from washing out all the low-count countries into a single pale shade.
  function buildHeatScale(items) {
    if (!items.length) return () => 0;
    const counts = items.map(i => Math.sqrt(i.count));
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (max === min) return () => 1;
    return (count) => (Math.sqrt(count) - min) / (max - min);
  }

  function buildCountryLayer(items, colors) {
    const scale = buildHeatScale(items);
    const byIso2Count = new Map(items.map(i => [i.iso2, i]));
    const parts = [];
    for (const entry of worldData) {
      const d = countryPaths[entry.iso2];
      if (!d) continue;
      const item = byIso2Count.get(entry.iso2);
      const fill = item ? heatColor(scale(item.count), colors) : colors.land;
      const label = item
        ? `${entry.name}: ${item.count} article${item.count !== 1 ? 's' : ''}`
        : entry.name;
      parts.push(
        `<path class="viz-world-country${item ? ' viz-world-country-has-data' : ''}"
               d="${d}" fill="${fill}" stroke="${colors.landStroke}" stroke-width="0.6"
               vector-effect="non-scaling-stroke"
               data-country-key="${entry.iso2}"
               role="${item ? 'button' : 'img'}" ${item ? 'tabindex="0"' : ''}
               aria-label="${label}">
          <title>${label}</title>
        </path>`
      );
    }
    // Fallback: any legacy anonymous outlines for shapes we have no ISO match for yet.
    for (const path of outlineData) {
      parts.push(`<path class="viz-world-outline-fallback" d="${path}" fill="${colors.land}" fill-opacity="0.35" stroke="none"/>`);
    }
    return parts.join('');
  }

  function renderLegend(items, colors, totalAssignments) {
    const scale = buildHeatScale(items);
    return items.map(item => {
      const pct = totalAssignments > 0 ? (item.count / totalAssignments * 100).toFixed(1) : '0.0';
      const color = heatColor(scale(item.count), colors);
      return `
        <div class="viz-world-legend-item viz-legend-item" data-country-key="${item.iso2}" role="button" tabindex="0" aria-label="${item.name}: ${item.count} article${item.count !== 1 ? 's' : ''}">
          <span class="viz-legend-dot" style="background:${color}"></span>
          <span class="viz-legend-label" title="${item.name}">${item.name}</span>
          <span class="viz-legend-count">${item.count}</span>
          <span class="viz-bar-pct">${pct}%</span>
        </div>`;
    }).join('');
  }

  function renderScaleBar(items, colors) {
    if (!items.length) return '';
    const max = items[0].count;
    const min = items[items.length - 1].count;
    const stops = 6;
    const swatches = Array.from({ length: stops }, (_, i) => {
      const t = i / (stops - 1);
      return `<span class="viz-world-scale-swatch" style="background:${heatColor(t, colors)}"></span>`;
    }).join('');
    return `
      <div class="viz-world-scale" aria-hidden="true">
        <span class="viz-world-scale-label">${min}</span>
        <div class="viz-world-scale-bar">${swatches}</div>
        <span class="viz-world-scale-label">${max}</span>
      </div>`;
  }

  function renderWorldMap(articles, showLegend) {
    const colors = getThemeColors();
    const { items, mappedArticles, missingArticles } = aggregateCountryCounts(articles);
    const width = 1000;
    // Full height, uncropped — Antarctica's own polygon (world-map-paths-
    // data.js) is capped correctly down to this bottom edge; there's no
    // reason left to hide part of the viewBox to avoid a broken-looking
    // south edge.
    const height = 520;
    const totalAssignments = items.reduce((sum, item) => sum + item.count, 0);

    const countryLayer = buildCountryLayer(items, colors);
    const legendItems = renderLegend(items, colors, totalAssignments);
    const scaleBar = renderScaleBar(items, colors);

    // Source credit and the data-coverage note used to float as overlays on
    // top of the map itself (position:absolute inside .viz-world-stage) —
    // moved into their own row between the map and the legend instead, so
    // the map surface only ever shows the map. Map -> status -> legend.
    const statusNote = items.length > 0
      ? `${mappedArticles} article${mappedArticles !== 1 ? 's' : ''} have at least one country assignment. ${missingArticles} article${missingArticles !== 1 ? 's' : ''} do not expose usable country metadata yet. Scroll/pinch to zoom, drag to pan.`
      : 'No affiliation country data available yet. Use Fetch Affiliations to enrich records from DOI, OpenAlex, or PMID sources.';

    return `
      <div class="viz-world-wrap${showLegend ? '' : ' legend-hidden'}">
        <div class="viz-world-stage">
          <svg class="viz-world-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="World map showing article counts by affiliation country, shaded by count">
            <rect class="viz-world-ocean" x="0" y="0" width="${width}" height="${height}" rx="18" fill="${colors.ocean}" stroke="${colors.oceanStroke}" stroke-width="1.2"/>
            <g class="viz-world-country-layer">${countryLayer}</g>
          </svg>
          <div class="viz-world-zoom-controls" role="group" aria-label="Map zoom controls">
            <button type="button" class="viz-world-zoom-btn" data-zoom="in" aria-label="Zoom in">+</button>
            <button type="button" class="viz-world-zoom-btn" data-zoom="out" aria-label="Zoom out">&minus;</button>
            <button type="button" class="viz-world-zoom-btn viz-world-zoom-reset" data-zoom="reset" aria-label="Reset zoom">&#8634;</button>
          </div>
        </div>
        <div class="viz-world-status">
          <div class="viz-world-note">${statusNote}</div>
          ${scaleBar}
          <div class="viz-world-credit">Map: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a></div>
        </div>
        ${showLegend && legendItems ? `<div class="viz-world-legend">${legendItems}</div>` : ''}
      </div>`;
  }

  // --- Zoom & pan -------------------------------------------------------------

  function wireZoomPan(stageEl) {
    if (!stageEl) return;
    const svg = stageEl.querySelector('svg.viz-world-svg');
    if (!svg) return;

    const baseBox = svg.viewBox.baseVal;
    const base = { x: baseBox.x, y: baseBox.y, w: baseBox.width, h: baseBox.height };
    let view = { ...base };
    const minW = base.w * 0.12;
    const maxW = base.w;

    const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);

    const clientToSvg = (clientX, clientY) => {
      const rect = svg.getBoundingClientRect();
      const sx = view.x + ((clientX - rect.left) / rect.width) * view.w;
      const sy = view.y + ((clientY - rect.top) / rect.height) * view.h;
      return { sx, sy };
    };

    const zoomAt = (clientX, clientY, factor) => {
      const { sx, sy } = clientToSvg(clientX, clientY);
      let newW = Math.max(minW, Math.min(maxW, view.w * factor));
      const ratio = newW / view.w;
      const newH = view.h * ratio;
      view = {
        x: sx - (sx - view.x) * ratio,
        y: sy - (sy - view.y) * ratio,
        w: newW,
        h: newH,
      };
      clampPan();
      apply();
    };

    const clampPan = () => {
      view.x = Math.max(base.x - view.w * 0.5, Math.min(base.x + base.w - view.w * 0.5, view.x));
      view.y = Math.max(base.y - view.h * 0.5, Math.min(base.y + base.h - view.h * 0.5, view.y));
    };

    stageEl.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const factor = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
      zoomAt(ev.clientX, ev.clientY, factor);
    }, { passive: false });

    let dragging = false;
    let lastX = 0, lastY = 0;
    stageEl.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      dragging = true;
      lastX = ev.clientX; lastY = ev.clientY;
      stageEl.classList.add('is-panning');
      stageEl.setPointerCapture(ev.pointerId);
    });
    stageEl.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const rect = svg.getBoundingClientRect();
      const dx = (ev.clientX - lastX) / rect.width * view.w;
      const dy = (ev.clientY - lastY) / rect.height * view.h;
      view.x -= dx;
      view.y -= dy;
      lastX = ev.clientX; lastY = ev.clientY;
      clampPan();
      apply();
    });
    const endDrag = (ev) => {
      dragging = false;
      stageEl.classList.remove('is-panning');
      if (ev && stageEl.releasePointerCapture && ev.pointerId != null) {
        try { stageEl.releasePointerCapture(ev.pointerId); } catch (_) { /* noop */ }
      }
    };
    stageEl.addEventListener('pointerup', endDrag);
    stageEl.addEventListener('pointercancel', endDrag);

    stageEl.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      zoomAt(ev.clientX, ev.clientY, 0.5);
    });

    stageEl.querySelectorAll('.viz-world-zoom-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.zoom;
        const rect = svg.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        if (action === 'in') zoomAt(cx, cy, 0.7);
        else if (action === 'out') zoomAt(cx, cy, 1 / 0.7);
        else { view = { ...base }; apply(); }
      });
    });
  }

  return {
    worldData,
    normalizeCountryCode,
    extractCountryCodesFromText,
    extractCountries,
    aggregateCountryCounts,
    renderWorldMap,
    wireZoomPan,
  };
})();
