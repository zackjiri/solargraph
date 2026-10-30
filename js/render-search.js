// ─── Planetarium object search ──────────────────────────────────────────────────────────────────
// Round magnifier button left of the RA/Dec picker (#btnNightSkySearch), in Planetarium, the flat
// Sky Map and Globe (in the Sky Map, which has no picker, left of the map's rotate button). It opens
// #nightSkySearchPanel over the canvas: a text box and the matches below it (five rows visible, a
// scrollbar for the rest), filtered again on every change of the text. Searched:
//  - deep sky objects (_dsoList, render-deepsky.js): Messier number (M31), designation (NGC 224,
//    Cr 140) and common name (Andromeda Galaxy);
//  - the named stars of data/celestial/starnames.json by name or HIP number, positions from the
//    star catalogue;
//  - the 88 constellations by name (Latin, English, Czech) or abbreviation, at their label's point;
//  - the Sun, the Moon and the planets, which move, so they bring their own position;
//  - in Globe's MOON view only, the Earth, also as "Home" or "my location" (moonView).
// Matching ignores case, accents, spaces and punctuation ("ngc224" finds NGC 224), and ranks an exact
// match first, then a name starting with the text, then a later word starting with it ("galaxy"),
// then the text anywhere; brighter first within each. A row is dimmed while its object is below the
// horizon (not in Globe, which shows the whole sky). Picking one (click, or Enter on the highlighted
// row) turns Deep sky on for a deep sky object (Planets on and "Only naked eye" off for Uranus and
// Neptune), closes the panel and, by the view:
//  - Planetarium: locks the view on it through the picker (_nightSkyPicker, render-nightsky.js),
//    its name beside the crosshair; an object below the horizon only says so;
//  - Sky Map (the whole sky above the horizon at once, nothing to aim): marks it with the red
//    crosshair and its name (_nsSearch.mark, _nsSearchDrawSkyMapMark) until another pick, a new
//    opening of the panel or leaving the Sky Map; below the horizon it only says so;
//  - Globe: locks the view through the Globe's picker (render-nightsky-globe.js) with the object in
//    the upper part of the view, beside the Earth rather than behind it (_nsSearchGlobeTarget);
//    the Sun and the planets by their direction of date, the Moon (and from the MOON view the
//    Earth) by its direction from the camera, as it is a body near enough to shift with it.
// ArrowUp/ArrowDown move the highlight, Escape closes.

// Loaded on the first opening of the panel:
//  - named stars, data/celestial/starnames.json: {HIP: {name}} in the format of D3-Celestial's own
//    starnames.json (so that file could replace it as it is), written for this project: see the
//    folder's NOTICE.md;
//  - constellations, data/celestial/constellations.json (D3-Celestial): per constellation its
//    abbreviation (id), name, Latin name (la), English (en) and Czech (cz) names, all searched, and
//    the point its label sits at, where the view is locked. Serpens comes as its two parts, Serpens
//    Caput and Serpens Cauda, each at its own point.
let _nsSearchStarNames = null, _nsSearchConstellations = null, _nsSearchDataLoading = false;
function _nsSearchLoadData() {
  if (_nsSearchDataLoading) return;
  _nsSearchDataLoading = true;
  const get = (name, empty) => fetch('data/celestial/' + name).then(r => r.json())
    .catch(err => { console.warn('Search data not loaded (' + name + '):', err); return empty; });
  Promise.all([get('starnames.json', {}), get('constellations.json', { features: [] })]).then(([stars, cons]) => {
    _nsSearchStarNames = stars; _nsSearchConstellations = cons.features;
    if (_nsSearch.open) _nsSearchUpdate();
  });
}

const NS_SEARCH_MAX_ROWS = 200;   // matches listed at most (five visible, the rest by scrolling)
const NS_SEARCH_DSO_KIND = { galaxy: 'galaxy', open: 'open cluster', globular: 'globular cluster',
  planetary: 'planetary nebula', nebula: 'nebula', other: 'deep sky' };

// "NGC 224" -> "ngc224"; accents, case, spaces and punctuation dropped.
function _nsSearchNorm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// The forms of one key the text can start: the whole key, then from each later word on.
function _nsSearchForms(key) {
  const words = String(key).split(/[\s\-_.,'´’]+/).filter(Boolean);
  return words.map((_, i) => _nsSearchNorm(words.slice(i).join('')));
}

let _nsSearchIndex = null;   // [{name, sub, kind, mag, forms: [[...], ...], azEl(), lock}]
// lock: the Planetarium's picker lock; globeLock: the Globe's ({ra, dec} J2000, or gdir() the
// direction of date, or moon; a moving body keeps at() too, for the Az/Alt readout of the lock).
// info: { type() the panel's kind/magnitude/size text, magNow() the magnitude now or null }.
function _nsSearchFixed(name, sub, kind, mag, keys, ra, dec, info) {
  return { name, sub, kind, mag, forms: keys.filter(Boolean).map(_nsSearchForms), info,
    azEl: (Y, M, D, H) => _skyStarAzEl(ra, dec, Y, M, D, H), lock: { ra, dec, label: name }, globeLock: { ra, dec, label: name } };
}
function _nsSearchMoving(name, sub, mag, keys, at, globeLock, info) {
  return { name, sub, kind: 'body', mag, forms: keys.map(_nsSearchForms), azEl: at, info,
    lock: { at, label: name }, globeLock: { ...globeLock, at, label: name } };
}
const _nsSearchNow = () => [nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT];
const _nsSearchMag = (m) => (m < 0 && Math.abs(m) >= 0.05 ? '−' : '') + Math.abs(m).toFixed(1) + ' mag';   // a true minus sign
function _nsSearchBuild() {
  if (_nsSearchIndex || !_skyDataLoaded || !_nsSearchStarNames) return _nsSearchIndex;
  const list = [];
  list.push(_nsSearchMoving('Sun', 'star', -26.7, ['Sun'], (Y, M, D, H) => _nightSkySunAzEl(Y, M, D, H), {
    gdir: () => { const q = _nightSkySunRaDec(..._nsSearchNow()); return _skyDomeUnitVec(90 - q.ra, q.dec); } },
    { body: 'sun', type: () => 'star · ' + _nsSearchMag(-26.7), magNow: () => -26.7 }));
  list.push(_nsSearchMoving('Moon', 'moon', -12.7, ['Moon'], (Y, M, D, H) => _moonAzEl(Y, M, D, H), { moon: true },
    { body: 'moon', type: () => 'moon · ' + Math.round(_moonPhase(_moonJDE(..._nsSearchNow())).k * 100) + ' % lit', magNow: () => -12.7 }));
  list.push({ name: 'Earth', sub: 'planet · home', kind: 'body', mag: -30, moonView: true, info: { noSky: true, type: () => 'planet · home' },
    forms: ['Earth', 'Home', 'my location'].map(_nsSearchForms),
    azEl: () => ({ az: 0, el: 90 }), lock: null, globeLock: { earth: true, label: 'Earth' } });
  const planetMag = { mercury: 0, venus: -4.2, mars: 0.5, jupiter: -2.3, saturn: 0.7, uranus: 5.7, neptune: 7.8 };   // typical, for the order only
  for (const p of PLANETS) {
    list.push(_nsSearchMoving(p.name, 'planet', planetMag[p.key], [p.name], (Y, M, D, H) => {
      const q = _planetPositions(Y, M, D, H).find(x => x.key === p.key);
      return _skyStarAzEl(q.raDeg, q.decDeg, Y, M, D, H);
    }, { gdir: () => {
      const now = _nsSearchNow(), q = _planetPositions(...now).find(x => x.key === p.key);
      return _skyDomeUnitVecRaDec(_skyJ2000ToDate(q.raDeg, q.decDeg, _moonJDE(...now)));
    } }, (() => {
      const q = () => _planetPositions(..._nsSearchNow()).find(x => x.key === p.key);
      return { type: () => { const x = q(); return `planet · ${_nsSearchMag(x.magnitude)} · ${x.R.toFixed(2)} AU`; }, magNow: () => q().magnitude };
    })()));
    list[list.length - 1].faintPlanet = !!p.faint;
  }
  const stars = new Map(_skyStars.map(s => [s.id, s]));
  for (const [hipKey, v] of Object.entries(_nsSearchStarNames)) {
    const hip = Number(hipKey), name = v.name, s = stars.get(hip);
    if (s) list.push(_nsSearchFixed(name, `star · HIP ${hip} · ${_nsSearchMag(s.mag)}`, 'star', s.mag, [name, 'HIP ' + hip], s.raDeg, s.decDeg,
      { type: () => { const bv = parseFloat(s.bv), t = Math.abs(bv).toFixed(2);
        return `star · ${_nsSearchMag(s.mag)}` + (isFinite(bv) ? ` · B−V ${bv < 0 && t !== '0.00' ? '−' : ''}${t}` : ''); }, magNow: () => s.mag }));
  }
  for (const o of _dsoList) {
    const title = o.name || o.id;
    const codes = [o.name ? o.id : '', o.desig !== o.id ? o.desig : ''].filter(Boolean);
    const sub = [...codes, NS_SEARCH_DSO_KIND[o.kind] || 'deep sky', isFinite(o.mag) ? _nsSearchMag(o.mag) : ''].filter(Boolean).join(' · ');
    const size = o.dim[0] > 0 ? (o.dim[1] !== o.dim[0] ? `${o.dim[0]}′×${o.dim[1]}′` : `${o.dim[0]}′`) : '';
    const dsoType = [NS_SEARCH_DSO_KIND[o.kind] || 'deep sky', isFinite(o.mag) ? _nsSearchMag(o.mag) : '', size].filter(Boolean).join(' · ');
    list.push(_nsSearchFixed(title, sub, 'dso', isFinite(o.mag) ? o.mag : 99, [o.id, o.desig, o.name, o.label], o.ra, o.dec,
      { type: () => dsoType, magNow: () => (isFinite(o.mag) ? o.mag : null) }));
  }
  for (const f of _nsSearchConstellations) {
    const p = f.properties, name = String(p.name).replace(/\s+/g, ' ');
    const [ra, dec] = f.geometry.coordinates;
    list.push(_nsSearchFixed(name, 'constellation · ' + f.id, 'constellation', 50, [p.name, p.la, p.en, p.cz, f.id], ra, dec,
      { type: () => 'constellation · ' + f.id, magNow: () => null }));
  }
  if (_dsoList.length) _nsSearchIndex = list;   // the deep sky data in too: keep it
  return list;
}
// 0 exact, 1 the name starts with it, 2 a later word does, 3 anywhere; -1 no match.
function _nsSearchScore(e, q) {
  let best = -1;
  for (const f of e.forms) {
    const s = f[0] === q ? 0 : f[0].startsWith(q) ? 1 : f.some(x => x.startsWith(q)) ? 2 : f[0].includes(q) ? 3 : -1;
    if (s >= 0 && (best < 0 || s < best)) best = s;
  }
  return best;
}

// mark: the Sky Map's marked entry; picked: the entry picked last (its info in the info panel while
// it is still locked on or marked, _nsSearchTarget); info: one picked below the horizon, {e, sub, lock,
// mark}, in the info panel only, until the next pick, a new opening of the panel, a change of view
// or of the picker's lock or the Sky Map's mark
const _nsSearch = { open: false, rows: [], sel: 0, mark: null, picked: null, info: null };
function _nsSearchSetOpen(on) {
  _nsSearch.open = on;
  document.getElementById('nightSkySearchPanel').classList.toggle('open', on);
  const btn = document.getElementById('btnNightSkySearch');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  if (on) {
    if (typeof _nsExportSetOpen === 'function' && _nsExport.open) _nsExportSetOpen(false);   // render-export.js
    if (_nsSearch.mark || _nsSearch.info) { _nsSearch.mark = _nsSearch.info = null; if (nightSkyActive) drawNightSky(); }   // a new search
    _nsSearchLoadData();
    const inp = document.getElementById('nightSkySearchInput');
    _nsSearchUpdate();
    inp.focus(); inp.select();
  }
}
function _nsSearchNote(text) {
  document.getElementById('nightSkySearchNote').textContent = text || '';
}
function _nsSearchUpdate() {
  const q = _nsSearchNorm(document.getElementById('nightSkySearchInput').value);
  const ul = document.getElementById('nightSkySearchList');
  ul.textContent = '';
  _nsSearch.rows = []; _nsSearch.sel = 0;
  _nsSearchNote('');
  if (!q) return;
  const index = _nsSearchBuild();
  if (!index) { _nsSearchNote('Loading the sky data…'); return; }
  const hits = [];
  const moonView = nightSkySubmode === 'globe' && _nsGlobe.body === 'moon';
  for (const e of index) {
    if (e.moonView && !moonView) continue;
    const s = _nsSearchScore(e, q);
    if (s >= 0) hits.push({ e, s });
  }
  hits.sort((a, b) => a.s - b.s || a.e.mag - b.e.mag || a.e.name.localeCompare(b.e.name));
  if (!hits.length) { _nsSearchNote('Nothing found'); return; }
  const rows = hits.slice(0, NS_SEARCH_MAX_ROWS).map(h => h.e);
  rows.forEach((e, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const below = nightSkySubmode !== 'globe' && e.azEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT).el < 0;
    li.classList.toggle('below', below);
    li.title = below ? e.name + ' - below the horizon now' : e.name;
    const n = document.createElement('span'); n.className = 'ns-search-name'; n.textContent = e.name;
    const sub = document.createElement('span'); sub.className = 'ns-search-sub'; sub.textContent = e.sub;
    li.append(n, sub);
    li.addEventListener('mousedown', (ev) => ev.preventDefault());   // keep the focus in the text box
    li.addEventListener('click', () => _nsSearchPick(i));
    ul.appendChild(li);
  });
  _nsSearch.rows = rows;
  if (hits.length > rows.length) _nsSearchNote(`First ${rows.length} of ${hits.length} - type more to narrow it down`);
  _nsSearchHighlight(0);
}
function _nsSearchHighlight(i) {
  const items = document.getElementById('nightSkySearchList').children;
  if (!items.length) return;
  _nsSearch.sel = Math.max(0, Math.min(items.length - 1, i));
  for (let k = 0; k < items.length; k++) items[k].classList.toggle('sel', k === _nsSearch.sel);
  items[_nsSearch.sel].scrollIntoView({ block: 'nearest' });
}
function _nsSearchPick(i) {
  const e = _nsSearch.rows[i];
  if (!e) return;
  const globe = nightSkySubmode === 'globe';
  // below the horizon (Planetarium, Sky Map): nothing to aim at or mark, but its details - when it
  // rises, or that it never does here - go to the info panel (_nsSearch.info)
  const below = !globe && e.azEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT).el < 0;
  if (e.kind === 'dso') {
    const chk = document.getElementById('chkNightSkyDeepSky');
    if (!chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  if (e.faintPlanet) {   // Uranus or Neptune: Planets on and "Only naked eye" off, so its dot shows
    const chk = document.getElementById('chkNightSkyPlanets');
    if (!chk.checked) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
    if (!showNightSkyFaintPlanets) _nightSkySetFaintPlanets(true);
  }
  _nsSearchSetOpen(false);
  _nsSearch.picked = e;
  // the info panel shows it while the view, the lock and the mark stay as they are now
  _nsSearch.info = below ? { e, sub: nightSkySubmode, lock: _nightSkyPicker.lock, mark: _nsSearch.mark } : null;
  if (below) { drawNightSky(); return; }
  if (nightSkySubmode === 'skymap') { _nsSearch.mark = e; drawNightSky(); return; }
  if (globe && e.globeLock.moon && _nsGlobe.body === 'moon') {   // the view already orbits it
    _nsSearchSetOpen(true);
    _nsSearchNote('The view already orbits the Moon');
    return;
  }
  _nightSkyPicker.lock = globe ? e.globeLock : e.lock;
  if (globe) _nsSearchGlobeTarget();
  if (_nightSkyPicker.active) drawNightSky(); else _nightSkyPickerSetActive(true);
}
// Where the Globe holds a found object (the picker's target, camera tangent-plane units): straight
// above the centre of the body the camera orbits, at 55-85 % of the way to the top of the view and
// at least a quarter beyond its limb, so the object shows beside the globe rather than behind it. The camera
// first goes to the far side of the Earth from the object, looking towards it: the lock's few
// Newton steps (_nsGlobePickerApplyLock) then only tilt it, and cannot settle on the mirror
// solution with the object behind the camera.
function _nsSearchGlobeTarget() {
  _nsGlobeSetDir(_nsGlobeLockDir().map(v => -v));
  const cv = document.getElementById('nightSkyCanvas'), dpr = cv._res || 1;
  const w = cv.width / dpr, h = cv.height / dpr, scale = Math.min(w, h) / 2 * 0.9;
  const cam = _nsGlobeCamera(), top = h / 2 / (cam.F * scale);
  // the angular radius (tangent) of the body the camera orbits: the Earth, or in the MOON view the Moon
  const rb = _nsGlobe.body === 'moon' ? NS_GLOBE_MOON_RADIUS : 1, d = _nsGlobe.body === 'moon' ? cam.d : cam.dist0;
  const limb = rb / Math.sqrt(Math.max(1e-9, d * d - rb * rb));
  _nsGlobePicker.tx = 0;
  _nsGlobePicker.ty = Math.min(0.85 * top, Math.max(0.55 * top, 1.25 * limb));
}
// Sky Map: the red crosshair and the name on the object marked by the search, above the horizon.
function _nsSearchDrawSkyMapMark(ctx, layout) {
  const e = _nsSearch.mark;
  if (!e) return;
  const p = e.azEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  if (p.el < 0) return;
  const q = _skyDomePoint(layout.cx, layout.cy, layout.R, p.az, p.el);
  ctx.save();
  ctx.strokeStyle = '#ff5050'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(q.x, q.y, 6, 0, 2 * Math.PI);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(q.x + dx * 3, q.y + dy * 3);
    ctx.lineTo(q.x + dx * 11, q.y + dy * 11);
  }
  ctx.stroke();
  ctx.fillStyle = '#ff5050';
  ctx.font = "11px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(e.name, q.x + 15, q.y - 11);
  ctx.restore();
}

document.getElementById('btnNightSkySearch').addEventListener('click', (e) => {
  e.stopPropagation();
  _nsSearchSetOpen(!_nsSearch.open);
});
document.getElementById('nightSkySearchInput').addEventListener('input', _nsSearchUpdate);
document.getElementById('nightSkySearchInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { _nsSearchHighlight(_nsSearch.sel + 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { _nsSearchHighlight(_nsSearch.sel - 1); e.preventDefault(); }
  else if (e.key === 'Enter') { _nsSearchPick(_nsSearch.sel); e.preventDefault(); }
  else if (e.key === 'Escape') { _nsSearchSetOpen(false); e.stopPropagation(); }
});

// ── The found object in the info panel ─────────────────────────────────────────────────────────
// Rows under the Moon's in #nightSkyStatus (#nsTgtBlock) while the object picked last
// (_nsSearch.picked) is still locked on (Planetarium, Globe) or marked (Sky Map), or for one picked
// below the horizon, which is shown here only (_nsSearch.info); hidden otherwise and in Sun Graph:
//  - object: its name;
//  - now: azimuth with its compass point and altitude (refraction included), or "below horizon";
//  - rise/set on this local day: the centre on the horizon (the Sun and the Moon by the upper limb,
//    from _moonRiseSetCached as in the rows above), or "circumpolar"; a fixed object below the
//    horizon all day "never rises here" (its declination too far south / north for the place) and
//    the whole section is framed red; a moving one only "not up today";
//  - transit: the time and altitude of its highest point on this local day;
//  - visible: its magnitude dimmed near the horizon (_nightSkyExtinctionMag) against the sky's
//    limit in its direction (_nightSkyAtmLimitAt: twilight, moonlight), only with Atmosphere on
//    where it works (Planetarium, flat Sky Map) and for an object with a magnitude;
//  - type: kind, magnitude and size (info.type()).
// The day's curve (rise, set, transit) is sampled every 6 minutes, crossings bisected to
// seconds, and kept per object, local day and place, so a redraw or the animation only redoes "now"
// and "visible". The Earth (from the MOON view) gets its name and type only.
const NS_SEARCH_DAY_STEP = 0.1 / 24;   // days
let _nsSearchDayCache = { key: null, d: null };
function _nsSearchTarget() {
  if (!nightSkyActive || nightSkyTopView !== 'visualization') return null;
  const I = _nsSearch.info;
  if (I && I.sub === nightSkySubmode && !nightSkyMap3DOn && I.lock === _nightSkyPicker.lock && I.mark === _nsSearch.mark) return I.e;
  if (nightSkySubmode === 'skymap') return nightSkyMap3DOn ? null : _nsSearch.mark;
  const e = _nsSearch.picked, L = _nightSkyPicker.lock;
  if (!e || !L || (nightSkySubmode !== 'planetarium' && nightSkySubmode !== 'globe')) return null;
  return L === e.lock || L === e.globeLock ? e : null;
}
function _nsSearchElAt(e, jd) {
  const r = _skyFromJulianDateUT(jd);
  return e.azEl(r.year, r.month, r.day, r.hourUT).el;
}
// Rise, set and transit for the local day of jd (UT), cached.
function _nsSearchDay(e, jd) {
  const tz = _nightSkyTzHours();
  const day0 = _moonLocalDayStartJD(jd);
  const key = [e.name, day0.toFixed(5), LAT, hemisphere, LONG, lonHemisphere, tz].join('|');
  if (_nsSearchDayCache.key === key) return _nsSearchDayCache.d;
  const el = (t) => _nsSearchElAt(e, t);
  const cross = (a, b) => {   // el(a) and el(b) on either side of 0: bisected to ~1 s
    const ua = el(a) >= 0;
    for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if ((el(m) >= 0) === ua) a = m; else b = m; }
    return (a + b) / 2;
  };
  const top = (a, b) => {   // the highest point between a and b (golden-section search)
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a);
    for (let i = 0; i < 24; i++) { if (el(c) > el(d)) b = d; else a = c; c = b - g * (b - a); d = a + g * (b - a); }
    const t = (a + b) / 2;
    return { jd: t, el: el(t) };
  };
  const n = Math.round(1 / NS_SEARCH_DAY_STEP), s = [];
  for (let i = 0; i <= n; i++) s.push(el(day0 + i * NS_SEARCH_DAY_STEP));
  let rise = null, set = null, hi = 0;
  for (let i = 1; i <= n; i++) {
    const a = day0 + (i - 1) * NS_SEARCH_DAY_STEP, b = a + NS_SEARCH_DAY_STEP;
    if (s[i - 1] < 0 && s[i] >= 0 && !rise) rise = cross(a, b);
    if (s[i - 1] >= 0 && s[i] < 0 && !set) set = cross(a, b);
    if (s[i] > s[hi]) hi = i;
  }
  const lo = Math.max(0, hi - 1) , up = Math.min(n, hi + 1);
  const transit = top(day0 + lo * NS_SEARCH_DAY_STEP, day0 + up * NS_SEARCH_DAY_STEP);
  const always = s.every(v => v >= 0), never = s.every(v => v < 0);
  const d = { rise, set, transit, always, never };
  _nsSearchDayCache = { key, d };
  return d;
}
function _nsSearchFillStatus() {
  const ids = ['Name', 'Now', 'Rise', 'Transit', 'Vis', 'Type'];
  const row = (k, on) => document.getElementById('nsTgt' + k + 'Row').classList.toggle('on', on);
  const val = (k, t) => { document.getElementById('nsTgt' + k).textContent = t; };
  const block = document.getElementById('nsTgtBlock');
  const e = nightSkySubmode === 'sungraph' ? null : _nsSearchTarget();
  block.style.display = e ? '' : 'none';
  block.classList.remove('never');
  if (!e) { ids.forEach(k => row(k, false)); return; }
  const info = e.info || {};
  val('Name', e.name); row('Name', true);
  val('Type', info.type ? info.type() : e.sub); row('Type', true);
  const sky = !info.noSky;
  ['Now', 'Rise', 'Transit', 'Vis'].forEach(k => row(k, sky));
  if (!sky) return;
  const fmtT = (jd) => { const r = _skyFromJulianDateUT(jd); return _nightSkyFmtHM(r.hourUT + _nightSkyTzHours()); };
  const fmtEl = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '°';
  const p = e.azEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  val('Now', p.el >= 0 ? `${Math.round(p.az)}° ${azimutToDir(p.az)} ${fmtEl(p.el)}` : `below horizon (${fmtEl(p.el)})`);
  const jd = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const day = _nsSearchDay(e, jd);
  if (info.body === 'sun' || info.body === 'moon') {   // the upper limb, as the Sun's and the Moon's rows
    const rs = _moonRiseSetCached(jd)[info.body];
    val('Rise', rs.alwaysUp ? 'circumpolar' : rs.alwaysDown ? 'never rises' : _moonFmtLocalTime(rs.rise) + ' / ' + _moonFmtLocalTime(rs.set));
  } else {
    // a fixed object below the horizon all day never rises here at all (its declination too far
    // from the place's latitude): said so and the section framed red; a moving one is only not up today
    const fixed = e.lock && e.lock.ra !== undefined, never = day.never && fixed;
    block.classList.toggle('never', never);
    val('Rise', day.always ? 'circumpolar' : never ? 'never rises here' : day.never ? 'not up today'
      : (day.rise ? fmtT(day.rise) : '—') + ' / ' + (day.set ? fmtT(day.set) : '—'));
  }
  val('Transit', `${fmtT(day.transit.jd)} ${fmtEl(day.transit.el)}`);
  // visible now: only where the Atmosphere model runs, and with a magnitude to compare
  const mag = info.magNow ? info.magNow() : null;
  const atm = typeof _nightSkyAtmState === 'function' ? _nightSkyAtmState() : null;
  if (p.el < 0) { row('Vis', false); return; }   // "now" says it is below the horizon
  if (!atm || mag === null || mag === undefined) { row('Vis', false); return; }
  const em = mag + _nightSkyExtinctionMag(p.el), lim = _nightSkyAtmLimitAt(_skyDomeUnitVec(p.az, p.el));
  val('Vis', !isFinite(lim) ? `yes (${_nsSearchMag(em)}, dark sky)`
    : `${em <= lim ? 'yes' : 'no'} (${_nsSearchMag(em)}, limit ${_nsSearchMag(lim)})`);
}
