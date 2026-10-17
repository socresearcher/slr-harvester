/**
 * SLR Harvester Web - early theme bootstrap
 * Runs from <head>, before the first paint, so a saved colour scheme and
 * visual theme are applied without a flash of the default look.
 * Keep in sync with app-ui.js (STYLES list, storage keys).
 */
(function () {
  try {
    var m = localStorage.getItem('slr-theme');
    var dark = m === 'light' ? false : m === 'auto' ? !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) : true;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var s = localStorage.getItem('slr-style');
    if (/^(glass|aurora|sunset|gloss|soft|paper|neon|mono|contour)$/.test(s)) document.documentElement.setAttribute('data-style', s);
  } catch (e) { /* storage blocked: defaults apply */ }
})();
