// ─── The current view in the address ────────────────────────────────────────────────────────────
// The part after # names the view on screen, lowercase segments split by /:
//   #gallery/gen-<generation id>/<image>
//   #analyzer/3d-model | image | sun-graph | sky-dome/(sky-map | az-el-chart | planetarium)
//   #eclipse/catalog | eclipse/visualization/<event id>[/map]
//   #night-sky/catalog | night-sky/visualization/(planetarium[/<Catalog photo id>] | sky-map |
//     orbit/(earth | moon | sun) | sun-graph)
// and after any of them, while the globe of the Location's SELECT is open over it:
//   …/select[/time-zones | /light-pollution]   (the layer shown on the globe; the two never together)
// Writing (_routeSync): after every click, key, change and pointer release on the page (after their
// own handlers), every second, and after applying an address, with history.replaceState: the address
// follows the view without being a step in the history (Back leaves the app as before) and without
// touching the query (the cache-bust).
// Reading (_routeApply): on opening the page (once the app is ready) and on a change of the address
// by hand (hashchange; replaceState does not fire it), the view is switched with the same functions
// a click uses, as far as the address is understood from the left; the address is then rewritten
// from the view actually reached, so a wrong or partial one is corrected. Date, time, Location,
// camera and display settings are not in the address.
const ROUTE_ANALYZER = ['3d-model', 'image', 'sun-graph', 'sky-dome'];   // _modeWheelIndex order (controls.js)
const ROUTE_SKYDOME = { dome: 'sky-map', matrix: 'az-el-chart', planet3d: 'planetarium' };
const ROUTE_NIGHTSKY = { planetarium: 'planetarium', skymap: 'sky-map', globe: 'orbit', sungraph: 'sun-graph' };
let _routeBusy = false;   // while an address is being applied, nothing is written
let _routeLast = null;    // the address last written here: another one is a change from outside, not yet applied

// The address of the view on screen, as its segments: the view's, then SELECT's globe if it is open
function _routeParts() {
  const p = _routeViewParts();
  if (typeof _locPick !== 'undefined' && _locPick.open && !_locPick.ecl) {
    p.push('select');
    if (_locPick.zones) p.push('time-zones'); else if (_locPick.lp) p.push('light-pollution');
  }
  return p;
}
function _routeViewParts() {
  if (typeof nightSkyActive !== 'undefined' && nightSkyActive) {
    if (nightSkyTopView !== 'visualization') return ['night-sky', 'catalog'];
    const p = ['night-sky', 'visualization', ROUTE_NIGHTSKY[nightSkySubmode] || 'planetarium'];
    if (nightSkySubmode === 'globe' && typeof _nsGlobe !== 'undefined') p.push(_nsGlobe.body);
    if (nightSkySubmode === 'planetarium' && _nightSkyActiveFrame && _nightSkyActiveFrame.id) p.push(_nightSkyActiveFrame.id);
    return p;
  }
  if (typeof eclipseActive !== 'undefined' && eclipseActive) {
    if (eclipseSubView !== 'visualization' || !_eclipseActiveEvent) return ['eclipse', 'catalog'];
    const p = ['eclipse', 'visualization', _eclipseActiveEvent.id];
    if (_locPick.open && _locPick.ecl === _eclipseActiveEvent.id) p.push('map');
    return p;
  }
  if (currentMode === 'gallery') {
    const p = ['gallery'];
    if (galleryState.genId !== null) { p.push('gen-' + galleryState.genId); if (galleryState.imageIndex !== null) p.push(String(galleryState.imageIndex)); }
    return p;
  }
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D) return ['analyzer', '3d-model'];
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) return ['analyzer', 'sun-graph'];
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive) return ['analyzer', 'sky-dome', ROUTE_SKYDOME[skyDomeProjection] || 'sky-map'];
  return ['analyzer', 'image'];
}
function _routeSync() {
  // an address changed from outside (typed, a link in the same tab) waits for its hashchange,
  // so it is not written over with the old view before it is applied
  if (_routeBusy || (_routeLast !== null && location.hash !== _routeLast)) return;
  const want = '#' + _routeParts().map(encodeURIComponent).join('/');
  if (location.hash !== want) history.replaceState(history.state, '', location.pathname + location.search + want);
  _routeLast = location.hash;
}

const _routeWait = (ms) => new Promise(r => setTimeout(r, ms));
// Waits (up to ms) until test() is true
async function _routeUntil(test, ms) {
  for (let t = 0; t < ms && !test(); t += 50) await _routeWait(50);
  return test();
}
function _routeClick(id) { const b = document.getElementById(id); if (b) b.click(); }

// Switches to the view an address names, as far as it is understood
async function _routeApply(hash) {
  const all = String(hash || '').replace(/^#/, '').split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  if (!all.length) return;
  // SELECT's globe and its layer, after the view's segments
  const si = all.indexOf('select'), p = si >= 0 ? all.slice(0, si) : all, layer = si >= 0 ? all[si + 1] : null;
  _routeBusy = true;
  _routeLast = location.hash;   // taken up: written over from the view reached at the end
  try {
    if (p[0] === 'gallery') {
      if (currentMode !== 'gallery') _routeClick('btnModeGallery');
      if (!await _routeUntil(() => FILELIST, 5000)) return;
      const gen = /^gen-(\d+)$/.exec(p[1] || '');
      if (gen) {
        const g = document.querySelector('input[name="generation"][value="' + gen[1] + '"]');
        if (g && !g.checked) { g.checked = true; g.dispatchEvent(new Event('change')); }
        const img = p[2] && document.querySelector('input[name="image"][value="' + CSS.escape(p[2]) + '"]');
        if (img && !img.checked) { img.checked = true; img.dispatchEvent(new Event('change')); }
      }
    } else if (p[0] === 'analyzer') {
      const off = currentMode !== 'analyzer' || (typeof eclipseActive !== 'undefined' && eclipseActive) || (typeof nightSkyActive !== 'undefined' && nightSkyActive);
      if (off) _routeClick('btnModeAnalyzer');
      if (currentMode === 'analyzer' && ((typeof eclipseActive !== 'undefined' && eclipseActive) || (typeof nightSkyActive !== 'undefined' && nightSkyActive))) _routeClick('btnModeAnalyzer');
      const i = ROUTE_ANALYZER.indexOf(p[1]);
      if (i >= 0 && _routeParts()[1] !== p[1]) { _modeWheelIndex = i; _modeWheel.render(); commitModeWheel(); }
      if (p[1] === 'sky-dome' && typeof skyDomeActive !== 'undefined' && skyDomeActive) {
        const v = Object.keys(ROUTE_SKYDOME).find(k => ROUTE_SKYDOME[k] === p[2]);
        if (v && v !== skyDomeProjection) { _skyDomeProjIndex = SKY_DOME_PROJ_VALUES.indexOf(v); commitSkyDomeProjWheel(); }
      }
    } else if (p[0] === 'eclipse') {
      if (!eclipseActive) _routeClick('btnModeEclipse');
      if (p[1] === 'catalog') {
        if (_locPick.open && _locPick.ecl) _locPickSetOpen(false);
        if (eclipseSubView !== 'catalog') _eclipseExitVisualizationToCatalog();
      } else if (p[1] === 'visualization') {
        const ev = (window.ECLIPSE_EVENTS || []).find(e => e.id === p[2] && e.be);
        if (ev && (ev !== _eclipseActiveEvent || eclipseSubView !== 'visualization')) {
          if (_locPick.open && _locPick.ecl) _locPickSetOpen(false);
          _eclipseSetActiveEvent(ev); _eclipseSubIndex = 1; _eclipseSubWheel.render(); enterEclipseVisualization();
        } else if (!ev && eclipseSubView !== 'visualization' && _eclipseActiveEvent) {
          _eclipseSubIndex = 1; _eclipseSubWheel.render(); enterEclipseVisualization();
        }
        const mapOpen = _locPick.open && _locPick.ecl === (_eclipseActiveEvent && _eclipseActiveEvent.id);
        if (p[3] === 'map' && !mapOpen && eclipseSubView === 'visualization') _eclMapOpen();
        else if (p[3] !== 'map' && mapOpen) _locPickSetOpen(false);
      }
    } else if (p[0] === 'night-sky') {
      if (!nightSkyActive) _routeClick('btnModeNightSky');
      if (p[1] === 'catalog') {
        if (nightSkyTopView !== 'catalog') { _nightSkyTopIndex = 0; _nightSkyCommitTop(); }
      } else {
        if (nightSkyTopView !== 'visualization') { _nightSkyTopIndex = 1; _nightSkyCommitTop(); }
        const sub = Object.keys(ROUTE_NIGHTSKY).find(k => ROUTE_NIGHTSKY[k] === p[2]);
        if (sub && sub !== nightSkySubmode) { _nightSkySubmodeIndex = NIGHTSKY_SUBMODE_VALUES.indexOf(sub); _nightSkyCommitSubmode(); }
        if (sub === 'globe' && ['earth', 'moon', 'sun'].includes(p[3]) && _nsGlobe.body !== p[3]) _nsGlobeSetBody(p[3]);
        if (sub === 'planetarium' && p[3] && (!_nightSkyActiveFrame || _nightSkyActiveFrame.id !== p[3])) {
          await _routeUntil(() => _nightSkyAstroCatalog && _nightSkyAstroCatalog.length, 5000);
          const entry = (_nightSkyAstroCatalog || []).find(e => e.id === p[3]);
          if (entry) _nightSkyApplyCatalogTile(entry);
        }
      }
    }
    // SELECT's globe over the view (not over the Eclipse map, which is the same window)
    const selOpen = _locPick.open && !_locPick.ecl;
    if (si >= 0 && !_locPick.open) _locPickSetOpen(true);
    else if (si < 0 && selOpen) _locPickSetOpen(false);
    if (si >= 0 && _locPick.open && !_locPick.ecl) {
      if (layer === 'time-zones' && !_locPick.zones) _routeClick('btnLocPickZones');
      else if (layer === 'light-pollution' && !_locPick.lp) _locPickSetLp(true);
      else if (!layer) { if (_locPick.zones) _routeClick('btnLocPickZones'); if (_locPick.lp) _locPickSetLp(false); }
    }
  } finally {
    _routeBusy = false;
    _routeSync();
  }
}

// after the handlers of the event that may have switched the view (bubbling, the document last)
['click', 'change', 'keyup', 'pointerup'].forEach((type) => document.addEventListener(type, () => setTimeout(_routeSync, 0)));
setInterval(_routeSync, 1000);   // views switched by code (a photo, Play reaching an end) follow within a second
window.addEventListener('hashchange', (e) => _routeApply(new URL(e.newURL).hash));   // the address it changed to
// on opening: the address's view once the app has started (the Gallery's list and the first image in)
window.addEventListener('load', () => setTimeout(() => {
  if (location.hash.length > 1) _routeApply(location.hash); else _routeSync();
}, 300));
