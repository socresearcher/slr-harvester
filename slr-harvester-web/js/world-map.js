/*
 * SLR Harvester Web — World map helper
 * Aggregates affiliation country data and renders a compact SVG world map.
 *
 * Global: window.SLRWorldMap
 */

window.SLRWorldMap = (() => {
  const worldData = Array.isArray(window.SLRWorldMapData) ? window.SLRWorldMapData : [];
  const outlineData = Array.isArray(window.SLRWorldMapOutlineData) ? window.SLRWorldMapOutlineData : [];

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
      land: themeColor('--surface', '#161b22'),
      landStroke: themeColor('--border', '#30363d'),
      grid: themeColor('--border', '#30363d'),
      outline: themeColor('--text-faint', '#8b949e'),
      accent: themeColor('--accent', '#1f6feb'),
      accentHover: themeColor('--accent-hover', '#388bfd'),
      text: themeColor('--text', '#e6edf3'),
      muted: themeColor('--text-muted', '#8b949e'),
      bg: themeColor('--bg', '#0d1117'),
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

  function buildGraticule(width, height, pad, colors) {
    const lonLines = [-120, -60, 0, 60, 120];
    const latLines = [-60, -30, 0, 30, 60];
    const parts = [];

    for (const lon of lonLines) {
      const top = projectPoint(lon, 84, width, height, pad);
      const bottom = projectPoint(lon, -84, width, height, pad);
      parts.push(`<line class="viz-world-grid" x1="${top.x.toFixed(2)}" y1="${top.y.toFixed(2)}" x2="${bottom.x.toFixed(2)}" y2="${bottom.y.toFixed(2)}" stroke="${colors.grid}" stroke-opacity="0.45" stroke-width="1"/>`);
    }

    for (const lat of latLines) {
      const left = projectPoint(-180, lat, width, height, pad);
      const right = projectPoint(180, lat, width, height, pad);
      parts.push(`<line class="viz-world-grid" x1="${left.x.toFixed(2)}" y1="${left.y.toFixed(2)}" x2="${right.x.toFixed(2)}" y2="${right.y.toFixed(2)}" stroke="${colors.grid}" stroke-opacity="0.45" stroke-width="1"/>`);
    }

    return parts.join('');
  }

  function buildOutlines(colors) {
    if (!outlineData.length) return '';
    return outlineData.map(path => `
      <path class="viz-world-outline" d="${path}"
            fill="${colors.land}"
            fill-opacity="0.9"
            stroke="${colors.landStroke}"
            stroke-opacity="0.9"
            stroke-width="0.7"
            vector-effect="non-scaling-stroke"/>`).join('');
  }

  function renderWorldMap(articles, showLegend) {
    const colors = getThemeColors();
    const { items, mappedArticles, missingArticles } = aggregateCountryCounts(articles);
    const width = 1000;
    const height = 520;
    const antarcticaCrop = 98;
    const visibleHeight = height - antarcticaCrop;
    const pad = 22;
    const totalAssignments = items.reduce((sum, item) => sum + item.count, 0);

    const circles = items.map((item) => {
      const point = projectPoint(item.lon, item.lat, width, height, pad);
      const radius = Math.max(3.5, Math.min(13, 3.5 + Math.sqrt(item.count) * 1.35));
          const ringRadius = Math.max(2.3, radius - 1.2);
          const pulseRadius = radius + 1.8;
      return `
        <g class="viz-world-bubble-group" data-country-key="${item.iso2}" role="button" tabindex="0" aria-label="${item.name}: ${item.count} article${item.count !== 1 ? 's' : ''}">
        <circle class="viz-world-bubble-pulse"
          cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${pulseRadius.toFixed(2)}"
          fill="none"
          stroke="${colors.accent}"
          stroke-opacity="0.28"
          stroke-width="0.8"
          stroke-dasharray="2 2"/>
          <circle class="viz-world-bubble"
                  cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${radius.toFixed(2)}"
                  fill="url(#viz-world-bubble-fill)"
          fill-opacity="0.78"
                  stroke="${colors.bg}"
          stroke-opacity="0.15"
          stroke-width="0.7"
                  title="${item.name}: ${item.count} article${item.count !== 1 ? 's' : ''}">
            <title>${item.name}: ${item.count} article${item.count !== 1 ? 's' : ''}</title>
          </circle>
        <circle class="viz-world-bubble-ring"
          cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${ringRadius.toFixed(2)}"
          fill="none"
          stroke="${colors.accentHover}"
          stroke-opacity="0.9"
          stroke-width="1.15"/>
        </g>`;
    }).join('');

    const legendItems = items.map(item => {
      const pct = totalAssignments > 0 ? (item.count / totalAssignments * 100).toFixed(1) : '0.0';
      return `
        <div class="viz-world-legend-item viz-legend-item" data-country-key="${item.iso2}" role="button" tabindex="0" aria-label="${item.name}: ${item.count} article${item.count !== 1 ? 's' : ''}">
          <span class="viz-legend-dot" style="background:${colors.accent}"></span>
          <span class="viz-legend-label" title="${item.name}">${item.name}</span>
          <span class="viz-legend-count">${item.count}</span>
          <span class="viz-bar-pct">${pct}%</span>
        </div>`;
    }).join('');

    const labels = [
      { text: 'North America', x: 155, y: 120 },
      { text: 'South America', x: 235, y: 360 },
      { text: 'Europe', x: 500, y: 140 },
      { text: 'Africa', x: 490, y: 300 },
      { text: 'Asia', x: 720, y: 175 },
      { text: 'Oceania', x: 840, y: 365 },
    ].map(item => `<text class="viz-world-region" x="${item.x}" y="${item.y}" fill="${colors.muted}" fill-opacity="0.75">${item.text}</text>`).join('');

    return `
      <div class="viz-world-wrap${showLegend ? '' : ' legend-hidden'}">
        <div class="viz-world-stage">
          <svg class="viz-world-svg" viewBox="0 0 ${width} ${visibleHeight}" role="img" aria-label="World map showing article counts by affiliation country">
            <defs>
              <radialGradient id="viz-world-glow" cx="50%" cy="40%" r="70%">
                <stop offset="0%" stop-color="${colors.accentHover}" stop-opacity="0.22"/>
                <stop offset="100%" stop-color="${colors.accent}" stop-opacity="0"/>
              </radialGradient>
              <radialGradient id="viz-world-bubble-fill" cx="35%" cy="30%" r="80%">
                <stop offset="0%" stop-color="${colors.accentHover}" stop-opacity="0.82"/>
                <stop offset="65%" stop-color="${colors.accent}" stop-opacity="0.7"/>
                <stop offset="100%" stop-color="${colors.accent}" stop-opacity="0.45"/>
              </radialGradient>
            </defs>
            <rect class="viz-world-ocean" x="0" y="0" width="${width}" height="${height}" rx="18" fill="${colors.ocean}" stroke="${colors.oceanStroke}" stroke-width="1.2"/>
            <rect class="viz-world-glow" x="0" y="0" width="${width}" height="${height}" rx="18" fill="url(#viz-world-glow)"/>
            <g class="viz-world-outline-layer">${buildOutlines(colors)}</g>
            <g class="viz-world-graticule">
              ${buildGraticule(width, height, pad, colors)}
            </g>
            <g class="viz-world-region-layer">${labels}</g>
            <g class="viz-world-bubbles">${circles}</g>
          </svg>
          <div class="viz-world-note">
            ${items.length > 0
              ? `${mappedArticles} article${mappedArticles !== 1 ? 's' : ''} have at least one country assignment. ${missingArticles} article${missingArticles !== 1 ? 's' : ''} do not expose usable country metadata yet.`
              : 'No affiliation country data available yet. Use Fetch Affiliations to enrich records from DOI, OpenAlex, or PMID sources.'}
          </div>
        </div>
        ${showLegend && legendItems ? `<div class="viz-world-legend">${legendItems}</div>` : ''}
      </div>`;
  }

  return {
    worldData,
    normalizeCountryCode,
    extractCountryCodesFromText,
    extractCountries,
    aggregateCountryCounts,
    renderWorldMap,
  };
})();
