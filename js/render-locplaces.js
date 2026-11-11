// ─── Places on the Location globe ───────────────────────────────────────────────────────────────
// Towns and cities from Natural Earth (data/earth/places-10m.js, window.NE_PLACES, made by
// tools/ne-places.py; public domain) over the globe's window, SELECT and the Eclipse map alike,
// switched by a round button (#btnLocPickPlaces, remembered: localStorage solargraphyLocPlaces).
//  - Which show: Natural Earth's own min_zoom says from which web map zoom a place is labelled. The
//    globe's scale at the view's centre (V.R px per radian) is turned into that zoom
//    (_locPlacesZoom: a web map has 256 · 2^z px round the equator), LOC_PLACES_ZOOM_GAIN earlier,
//    so at the whole Earth the capitals and largest cities show, at the closest zoom the regional
//    seats and towns of tens of thousands.
//  - Laid out in the data's order (by importance: min_zoom, then capitals, regional seats, the rest,
//    then population), each with its label right of the dot, else left of it; a place whose label
//    would touch one already placed, or the window's own controls (LOC_PLACES_KEEP_CLEAR), is left
//    out with its dot, so labels never overlap and never hide under a button or a legend.
//  - Look: five tiers by importance (LOC_PLACES_TIERS, _locPlacesTier): a country's capital, a
//    city of a million, a large city (250 000, or a regional seat of 100 000), a regional seat or
//    town of 50 000, the rest. Each tier a smaller dot and a dimmer grey; the top three share 11 px,
//    told apart by weight (capitals and million cities bold) and case (capitals in capitals, with a
//    ring round the dot), then 10 and 9 px. The name in English, with a dark outline.
//  - Only for orientation: drawn on the canvas, a click on a dot or a label sets the point clicked,
//    as anywhere else on the globe.
// The search (render-tzsearch.js) finds the places too (_locPlaces.entries) and picking one flies
// there, sets the Location and turns the places on.
const LOC_PLACES_KEY = 'solargraphyLocPlaces';
const LOC_PLACES_ZOOM_GAIN = 1.2;   // web map zooms earlier than Natural Earth's own min_zoom
// the window's controls the labels keep clear of (the head's lines, the slider, the buttons, the
// legends, the credits, the towns' glow box)
const LOC_PLACES_KEEP_CLEAR = '#locPickTitle, #locPickHint, #locPickInfo .lpi, #locPickZoneMatch, .loc-pick-credit, #btnLocPickClose, '
  + '#locPickAlt, #locGlowWrap, #locPickZoneLegend, #locPickLpLegend, #btnLocPickZones, #btnLocPickLightPollution, #btnLocPickPlaces, '
  + '#btnLocPickZoneSearch, #locPickZoneSearchPanel';
// The label tiers, most important first: font, text colour, dot radius, a ring round it (capitals),
// the name in capitals, the outline's width
const LOC_PLACES_TIERS = [
  { name: 'capital',   font: "bold 11px 'Share Tech Mono', monospace",   color: '#ffffff', dot: 4.6, ring: true,  upper: true,  halo: 3 },
  { name: 'million',   font: "bold 11px 'Share Tech Mono', monospace",   color: '#f6f8fa', dot: 3.3, ring: false, upper: false, halo: 3 },
  { name: 'city',      font: "11px 'Share Tech Mono', monospace",      color: '#e8edf2', dot: 3.0, ring: false, upper: false, halo: 3 },
  { name: 'town',      font: "10px 'Share Tech Mono', monospace",      color: '#d2dae2', dot: 2.4, ring: false, upper: false, halo: 2.6 },
  { name: 'small',     font: "9px 'Share Tech Mono', monospace",       color: '#b9c3cd', dot: 1.9, ring: false, upper: false, halo: 2.4 },
];
// A row's tier: 0 a country's capital, 1 a million people, 2 250 000 or a regional seat of 100 000,
// 3 a regional seat or 50 000, 4 the rest
function _locPlacesTier(r) {
  const kind = r[5], pop = r[6] || 0;
  if (kind === 2) return 0;
  if (pop >= 1e6) return 1;
  if (pop >= 250000 || (kind === 1 && pop >= 100000)) return 2;
  if (kind === 1 || pop >= 50000) return 3;
  return 4;
}
const _locPlaces = {
  on: false,
  rows: null,        // NE_PLACES.rows once loaded
  entries: null,     // the search's entries, once loaded
  loading: null,     // the load's promise
  drawn: [],         // the last frame's places: {name, lat, lon, x, y, z, box}
  widths: new Map(), // label widths per font and name
};
try { _locPlaces.on = localStorage.getItem(LOC_PLACES_KEY) === '1'; } catch (e) { /* storage blocked */ }

// The data: its script once, then the rows and the search's entries
function _locPlacesLoad() {
  if (_locPlaces.rows) return Promise.resolve(true);
  if (_locPlaces.loading) return _locPlaces.loading;
  const own = document.querySelector('script[src*="render-locplaces.js"]');
  const bust = own && own.src.indexOf('?') >= 0 ? own.src.slice(own.src.indexOf('?')) : '';
  _locPlaces.loading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'data/earth/places-10m.js' + bust;
    s.onload = () => {
      const d = window.NE_PLACES;
      if (!d || !d.rows) { console.warn('Places: data/earth/places-10m.js has no rows'); resolve(false); return; }
      _locPlaces.rows = d.rows;
      _locPlaces.entries = d.rows.map((r, i) => ({ keys: [r[0]], label: r[0], sub: r[1], kind: 'place', at: [r[2], r[3]],
        order: 0, rank: i, minZoom: r[4], tier: _locPlacesTier(r) }));
      for (const e of _locPlaces.entries) e.norm = e.keys.map(k => [_tzsNorm(k), ...String(k).split(/[\s\-_/.,()']+/).filter(Boolean).slice(1).map(_tzsNorm)]);
      resolve(true);
      if (_locPick.open) _locPickRequest();
      if (typeof _tzs !== 'undefined' && _tzs.open) _tzsUpdate();
    };
    s.onerror = () => { console.warn('Places: data/earth/places-10m.js not loaded'); _locPlaces.loading = null; resolve(false); };
    document.head.appendChild(s);
  });
  return _locPlaces.loading;
}

function _locPlacesSetOn(on) {
  _locPlaces.on = on;
  try { localStorage.setItem(LOC_PLACES_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
  const b = document.getElementById('btnLocPickPlaces');
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Hide the places' : 'Show the places';
  if (!on) _locPlaces.drawn = [];
  if (on) _locPlacesLoad();
  _locPickRequest();
}
document.getElementById('btnLocPickPlaces').addEventListener('click', () => _locPlacesSetOn(!_locPlaces.on));
_locPlacesSetOn(_locPlaces.on);   // the button's state as remembered (the data loads only when shown)

// The web map zoom matching the globe's scale at the view's centre
function _locPlacesZoom(V) {
  return Math.log2(V.R * 2 * Math.PI / 256) + Math.log2(LOC_PLACES_ZOOM_GAIN);
}
function _locPlacesWidth(ctx, font, name) {
  const k = font + '|' + name;
  let w = _locPlaces.widths.get(k);
  if (w === undefined) { ctx.font = font; w = ctx.measureText(name).width; _locPlaces.widths.set(k, w); }
  return w;
}
// Lays out and draws the places (from _locPickDraw, CSS px)
function _locPlacesDraw(ctx, V, w, h) {
  _locPlaces.drawn = [];
  if (!_locPlaces.on) return;
  if (!_locPlaces.rows) { _locPlacesLoad(); return; }
  const z = _locPlacesZoom(V), boxes = [], out = [];
  const CELL = 64, grid = new Map();
  // the window's own controls over the canvas: no label under them
  const cv = ctx.canvas, cr = cv.getBoundingClientRect(), blocked = [];
  for (const el of document.querySelectorAll(LOC_PLACES_KEEP_CLEAR)) {
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) blocked.push({ x0: r.left - cr.left - 2, y0: r.top - cr.top - 2, x1: r.right - cr.left + 2, y1: r.bottom - cr.top + 2 });
  }
  // the Eclipse map's legend, drawn on the canvas just before (render-eclipse-map.js)
  const EL = _locPick.ecl && typeof _eclMapLegendBox !== 'undefined' ? _eclMapLegendBox : null;
  if (EL) blocked.push({ x0: EL.x0 - 2, y0: EL.y0 - 2, x1: EL.x1 + 2, y1: EL.y1 + 2 });
  const cellsOf = (b) => { const r = []; for (let gx = Math.floor(b.x0 / CELL); gx <= Math.floor(b.x1 / CELL); gx++) for (let gy = Math.floor(b.y0 / CELL); gy <= Math.floor(b.y1 / CELL); gy++) r.push(gx + ',' + gy); return r; };
  const free = (b) => {
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > w || b.y1 > h) return false;
    for (const o of blocked) if (b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1) return false;
    for (const c of cellsOf(b)) for (const o of grid.get(c) || []) if (b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1) return false;
    return true;
  };
  const take = (b) => { boxes.push(b); for (const c of cellsOf(b)) { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(b); } };
  for (const r of _locPlaces.rows) {
    if (r[4] > z) break;   // the rows are in min_zoom order
    const s = _locPickProject(V, _locPickVec(r[3], r[2]));
    if (s.z < 0.08) continue;   // the far side and the limb
    const dx = s.x - V.cx, dy = s.y - V.cy;
    if (dx * dx + dy * dy > V.R * V.R) continue;
    const tier = _locPlacesTier(r), T = LOC_PLACES_TIERS[tier], font = T.font, text = T.upper ? r[0].toUpperCase() : r[0];
    const tw = _locPlacesWidth(ctx, font, text), th = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)[1]) + 1, dot = T.dot;
    const right = { x0: s.x - dot - 1, y0: s.y - th / 2 - 1, x1: s.x + dot + 4 + tw + 2, y1: s.y + th / 2 + 1, side: 1 };
    const left = { x0: s.x - dot - 4 - tw - 2, y0: right.y0, x1: s.x + dot + 1, y1: right.y1, side: -1 };
    const box = free(right) ? right : free(left) ? left : null;
    if (!box) continue;
    take(box);
    out.push({ name: r[0], text, lat: r[2], lon: r[3], kind: r[5], tier, x: s.x, y: s.y, z: s.z, box, font, dot });
  }
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (let i = out.length - 1; i >= 0; i--) {   // the most important last, on top
    const p = out[i], T = LOC_PLACES_TIERS[p.tier];
    if (T.ring) {   // a capital: a ring round the dot
      ctx.beginPath(); ctx.arc(p.x, p.y, p.dot, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      ctx.lineWidth = 1.4; ctx.strokeStyle = T.color; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, T.ring ? 2.4 : p.dot, 0, Math.PI * 2);
    ctx.fillStyle = T.color; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
    ctx.font = p.font;
    ctx.textAlign = p.box.side > 0 ? 'left' : 'right';
    const tx = p.x + p.box.side * (p.dot + 4);
    ctx.lineWidth = T.halo; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(p.text, tx, p.y);
    ctx.fillStyle = T.color; ctx.fillText(p.text, tx, p.y);
  }
  ctx.restore();
  _locPlaces.drawn = out;
}
// The globe's zoom at which a place of this min_zoom shows (a little closer, so it is not at the edge)
function _locPlacesZoomFor(minZoom, V) {
  const R = 256 * Math.pow(2, minZoom + 0.3) / LOC_PLACES_ZOOM_GAIN / (2 * Math.PI);
  return R / (V.R / _locPick.zoom);
}
// The search's pick: the globe flies to the place, close enough for it to show, the places on, the
// Location set there
function _locPlacesPick(e) {
  const cv = document.getElementById('locPickCanvas'), V = _locPickView(cv.clientWidth || 600, cv.clientHeight || 400);
  _locPick.lat0 = Math.max(-89, Math.min(89, e.at[0]));
  _locPick.lon0 = e.at[1];
  _locPick.zoom = Math.max(_locPick.zoom, Math.min(LOC_PICK_ZOOM_MAX, _locPlacesZoomFor(e.minZoom, V)));
  if (!_locPlaces.on) _locPlacesSetOn(true);
  _locPickApplyHere(e.at[0], e.at[1], e.label + ', ' + e.sub);
  _locPick.hover = null;
  _locPickZoneHint(null);   // the labels under the head: the time zone and the Bortle class of the new Location
}

// The search's icon of a place (render-tzsearch.js): its tier's map symbol, as an SVG
function _locPlacesIconSVG(tier) {
  const T = LOC_PLACES_TIERS[tier] || LOC_PLACES_TIERS[4], r = Math.min(5.6, T.dot) * 1.15;
  const dot = T.ring ? '<circle cx="8" cy="8" r="2.7" fill="' + T.color + '" stroke="rgba(0,0,0,0.75)" stroke-width="1"/>'
    + '<circle cx="8" cy="8" r="6" fill="none" stroke="' + T.color + '" stroke-width="1.5"/>'
    : '<circle cx="8" cy="8" r="' + r.toFixed(1) + '" fill="' + T.color + '" stroke="rgba(0,0,0,0.75)" stroke-width="1"/>';
  return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' + dot + '</svg>';
}
