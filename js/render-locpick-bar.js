// ─── The SELECT window's bar: a twilight row per place, and the comparison ──────────────────────
// Under the head (#locPickInfo, the former time zone and Bortle labels), a grid of rows (#locPickBar),
// one per place: its colour dot, its name, sunrise, the day's twilight strip, sunset, its time zone
// and its Bortle class, each value in the cells' old style (.lpi). The strip spans 0 to 24 h of the
// place's own local time (its zone's offset at the mode's moment, the standard one in Solargraph),
// the same width in every row, so the rows line up under each other: night, astronomical, nautical
// and civil twilight and day in the Sun Graph's colours, a red line at the moment there (none in
// Solargraph). The day is the place's own date at the moment (in Solargraph Daylight's date,
// _dlDate). Sunrise and sunset on Daylight's colours in the Local base, the polar day and night as
// Daylight's.
// Rows: the Location (red, as its pin) first, then up to LOC_PICK_BAR_MAX - 1 places added for
// comparison (the + before the head: the next click on the globe, or a place picked in the search,
// adds one in the next free colour; the cursor's pin takes that colour meanwhile; Esc or + again
// lets it be; × at a row's end takes the place away), each drawn on the globe as a pin in its colour;
// last, while the pointer is over the Earth, a faint row for the point under it. A name: the
// search's for a place picked there, else the nearest town of the same time zone (Natural Earth's
// places, render-locplaces.js) in italic as 'near …', at sea or with no town in the zone the
// coordinates in italic. On the Eclipse map no comparison: the Location's row (and the pointer's).
// A clock button after each name makes that place the reference (one at a time, again to let go):
// every row's times and strip then run on the reference's local time, so the moments line up under
// each other. The bar sits in a light frame that takes the pointer: no Location is set through it.
const LOC_PICK_BAR_MAX = 5;
const LOC_PICK_BAR_COLORS = ['#3b8cf0', '#3cc46a', '#b46ae8', '#f0a030'];   // the added places' colours
const LOC_PICK_BAR_HERE = '#e84040';                                         // the Location's (its pin)
const LOC_PICK_BAR_STRIP_W = 200;   // the strip's width [CSS px]
const LOC_PICK_BAR_BANDS = { night: '#1c2a35', astro: '#39505f', naut: '#5a7588', civil: '#9cbdd2', day: '#cfe8f6' };   // the Sun Graph's
const _locPickBar = {
  places: [],        // the added: { lat, lon, name, color }
  adding: null,      // the colour the next pick takes, or null
  hereName: null,    // { lat, lon, name }: the Location's name from the search while it is still there
  key: '',           // what the bar shows (rebuilt only when it changes)
  zoneOf: null,      // the places' rows' time zone indices (the grid's), once both are in
  timer: 0,          // the minute's check while the window is open (the moment may run)
  ref: null,         // the reference clock's row ('here' or a place's colour), or null: each place's own time
};

// The time zone's cell, the offset and the zone index at q
function _locPickBarZone(q) {
  const G = typeof _tzGrid !== 'undefined' ? _tzGrid.data : null;
  if (!G) return { text: 'time zone …', rgb: null, off: _tzNautical(q.lon), s: 0, G: null };
  const s = _tzIndexAt(G, q.lat, q.lon), h = s ? _tzModeOffsets(G).off[s] : NaN;
  const off = h === h ? h : _tzNautical(q.lon);
  const text = h === h ? `${G.zones[s - 1]} · UTC${_fmtTimeZone(h)}`
    : `${s ? G.zones[s - 1] + ' unknown to this browser, nautical' : 'sea, nautical'} · UTC${_fmtTimeZone(off)}`;
  return { text, rgb: _locPickZoneRGB(off), off, s, G };
}
// The Bortle class's cell at q (a tile already in, never asked for here)
function _locPickBarLp(q) {
  const t = _lp.tiles[_lpTileKey(q.lat, q.lon)];
  const sqm = (t ? _lpValueAt(t, q.lat, q.lon) : null) ?? (_lp.coarse ? _lpValueAt(_lp.coarse, q.lat, q.lon) : null);
  if (sqm === null) return { text: _lp.coarse ? 'no light pollution data' : 'light pollution …', rgb: null };
  const cls = _nightSkySQMToBortle(sqm);
  return { text: `Bortle ${cls} · SQM ${sqm.toFixed(2)}`, rgb: LOC_PICK_LP_RGB[cls - 1] };
}
// The twilight at q in its local hours (shift: hours added, to put them on another place's clock):
// { rise, set, now, polar, bands: [[kind, from, to] ...] }
function _locPickBarTwilight(q, off, shift) {
  const ms = _tzDateInstant();
  let Y, M, D;
  if (ms !== null) { const t = new Date(ms + off * 3600000); Y = t.getUTCFullYear(); M = t.getUTCMonth() + 1; D = t.getUTCDate(); }
  else { const d = _dlDate(); Y = d.year; M = d.month; D = d.day; }
  const a = Math.abs(q.lat), phi = (a === 0 ? 0.1 : a >= 90 ? 89.9 : a) * (q.lat < 0 ? -1 : 1) * Math.PI / 180;
  const jdeAt = (h) => _moonJDE(Y, M, D, h);
  const local = (trueH, eot) => trueH - eot / 60 - q.lon / 15 + off + shift;
  const bands = [];
  let rise = null, set = null, polar = null;
  for (const [kind, name] of [['astro', 'astro'], ['nautical', 'naut'], ['civil', 'civil'], ['day', 'day']]) {
    const r = _solarEventsCore(jdeAt, kind, phi, q.lon);
    if (r.polarNight) { if (kind === 'day') polar = 'night'; continue; }
    if (r.polarDay) { bands.push([name, 0, 24]); if (kind === 'day') polar = 'day'; continue; }
    const r0 = local(r.rise, r.eotRise), r1 = local(r.set, r.eotSet);
    bands.push([name, r0, r1]);
    if (kind === 'day') { rise = r0; set = r1; }
  }
  const now = ms === null ? null : (((ms / 3600000 + off + shift) % 24) + 24) % 24;
  return { rise, set, now, polar, bands };
}
// A clock hour onto 0..24 as 'H:MM'
function _locPickBarClock(h) {
  const t = ((Math.round(h * 60) % 1440) + 1440) % 1440;
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}
// The places' rows' zone indices, once the places and the grid are in
function _locPickBarZones() {
  const G = typeof _tzGrid !== 'undefined' ? _tzGrid.data : null;
  if (_locPickBar.zoneOf || !G || !_locPlaces.rows) return _locPickBar.zoneOf;
  const rows = _locPlaces.rows, z = new Uint16Array(rows.length);
  for (let i = 0; i < rows.length; i++) z[i] = _tzIndexAt(G, rows[i][2], rows[i][3]) || 0;
  return (_locPickBar.zoneOf = z);
}
// The name for q: { text, near }; zone s (0 at sea)
function _locPickBarNear(q, s) {
  const coords = () => ({ text: Math.abs(q.lat).toFixed(1) + '° ' + (q.lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(q.lon).toFixed(1) + '° ' + (q.lon >= 0 ? 'E' : 'W'), near: true });
  if (!s) return coords();
  if (!_locPlaces.rows) {   // asked for once; a failed load leaves the coordinates
    if (!_locPickBar.placesAsked) {
      _locPickBar.placesAsked = true;
      _locPlacesLoad().then((ok) => { if (!ok) _locPickBar.placesFailed = true; _locPickBar.key = ''; _locPickBar.hkey = ''; _locPickBarSync(); });
    }
    return _locPickBar.placesFailed ? coords() : { text: '…', near: true };
  }
  const Z = _locPickBarZones();
  if (!Z) return { text: '…', near: true };
  const v = _locPickVec(q.lon, q.lat), rows = _locPlaces.rows;
  let best = -2, bi = -1;
  for (let i = 0; i < rows.length; i++) {
    if (Z[i] !== s) continue;
    const r = rows[i], b = r[2] * D2R_LP, l = r[3] * D2R_LP, cb = Math.cos(b);
    const d = v[0] * cb * Math.cos(l) + v[1] * cb * Math.sin(l) + v[2] * Math.sin(b);
    if (d > best) { best = d; bi = i; }
  }
  return bi < 0 ? coords() : { text: 'near ' + rows[bi][0], near: true };
}
// One row's data
// (cache: an object that keeps a fixed place's 'near …' name once known, the scan done once; id: the
// row's for the reference clock, 'here' or a place's colour; refOff: the reference's offset or null)
function _locPickBarRowData(q, name, color, kind, cache, id, refOff) {
  const Zc = _locPickBarZone(q), L = _locPickBarLp(q);
  const T = _locPickBarTwilight(q, Zc.off, refOff === null ? 0 : refOff - Zc.off);
  let nm;
  if (name) nm = { text: name, near: false };
  else if (cache && cache.nm) nm = cache.nm;
  else {
    nm = _locPickBarNear(q, Zc.s);
    if (cache && nm.text !== '…') cache.nm = nm;
  }
  let rise, set;
  if (T.polar) {
    const c = LOC_PICK_DL_POLAR[T.polar], t = 'polar ' + T.polar;
    rise = { text: t, rgb: c }; set = { text: t, rgb: c };
  } else {
    rise = { text: '↑ ' + _locPickBarClock(T.rise), rgb: _dlColor('rise', _dlBand('rise', _dlClock(T.rise, 0)), 'local') };
    set = { text: '↓ ' + _locPickBarClock(T.set), rgb: _dlColor('set', _dlBand('set', _dlClock(T.set, 0)), 'local') };
  }
  return { q, kind, color, nm, rise, set, zone: Zc, lp: L, T, id, ref: id !== null && id === _locPickBar.ref };
}
// The strip on a canvas: night, then each level's interval (wrapped onto the dial), the moment
function _locPickBarStrip(T) {
  const cv = document.createElement('canvas'), dpr = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
  const w = LOC_PICK_BAR_STRIP_W, h = 11;
  cv.width = w * dpr; cv.height = h * dpr; cv.className = 'lpb-strip';   // drawn at the widest, shown at the column's width
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = LOC_PICK_BAR_BANDS.night; c.fillRect(0, 0, w, h);
  for (const [name, a, b] of T.bands) {
    c.fillStyle = LOC_PICK_BAR_BANDS[name];
    if (b - a >= 24) { c.fillRect(0, 0, w, h); continue; }
    let s = ((a % 24) + 24) % 24, e = s + (b - a);
    c.fillRect(s / 24 * w, 0, (Math.min(e, 24) - s) / 24 * w, h);
    if (e > 24) c.fillRect(0, 0, (e - 24) / 24 * w, h);
  }
  if (T.now !== null) { c.fillStyle = '#ff3b30'; c.fillRect(T.now / 24 * w - 1, 0, 2, h); }
  return cv;
}
// The bar after a change: the rows from the Location, the added places and the point under the
// pointer (hover, or null). The fixed rows are rebuilt only when what they show changes (their key),
// the pointer's row on its own (its key), so a move of the pointer rebuilds that row alone.
function _locPickBarSync(hover) {
  const bar = document.getElementById('locPickBar');
  if (!bar || !_locPick.open) return;
  if (hover !== undefined) _locPickBar.hover = hover;
  if (_locPick.ecl && _locPickBar.adding !== null) _locPickBarSetAdding(false);   // the Eclipse map compares nothing
  const here = { lat: hemisphere * LAT, lon: lonHemisphere * LONG }, H = _locPickBar.hereName;
  const hereNm = H && Math.abs(H.lat - here.lat) < 1e-6 && Math.abs(H.lon - here.lon) < 1e-6 ? H.name : null;
  let hc = _locPickBar.hereCache;
  if (!hc || hc.lat !== here.lat || hc.lon !== here.lon) hc = _locPickBar.hereCache = { lat: here.lat, lon: here.lon };
  // the reference clock (a row's clock button): every row on that place's time, the strips aligned
  let ref = _locPickBar.ref, refQ = null;
  if (ref === 'here') refQ = here;
  else if (ref !== null) { refQ = _locPick.ecl ? null : _locPickBar.places.find(p => p.color === ref) || null; if (!refQ && !_locPick.ecl) ref = _locPickBar.ref = null; }
  const refOff = refQ ? _locPickBarZone(refQ).off : null;
  const rows = [_locPickBarRowData(here, hereNm, LOC_PICK_BAR_HERE, 'here', hc, 'here', refOff)];
  if (!_locPick.ecl) for (const P of _locPickBar.places) rows.push(_locPickBarRowData(P, P.name, P.color, 'added', P, P.color, refOff));
  const hv = _locPickBar.hover, hr = hv ? _locPickBarRowData(hv, null, 'rgba(255,255,255,0.55)', 'hover', null, null, refOff) : null;
  const keyOf = (r) => [r.kind, r.color, r.ref, r.nm, r.rise, r.set, r.zone.text, r.lp.text,
    r.T.bands.map(b => b.map(v => typeof v === 'number' ? Math.round(v * 120) : v)), r.T.now === null ? null : Math.round(r.T.now * 120)];
  const key = JSON.stringify(rows.map(keyOf)), hkey = hr ? JSON.stringify(keyOf(hr)) : '';
  if (key !== _locPickBar.key) {
    _locPickBar.key = key; _locPickBar.hkey = hkey;
    bar.textContent = '';
    for (const r of rows) _locPickBarRowNodes(r).forEach(n => bar.appendChild(n));
    if (hr) _locPickBarRowNodes(hr).forEach(n => bar.appendChild(n));
    // the axis under the strips
    const sp = (cls) => { const e = document.createElement('span'); if (cls) e.className = cls; return e; };
    bar.appendChild(sp('lpb-axis-start')); bar.appendChild(sp()); bar.appendChild(sp()); bar.appendChild(sp());
    const ax = document.createElement('div'); ax.className = 'lpb-axis';
    for (const t of ['0', '6', '12', '18', '24']) { const s = document.createElement('span'); s.textContent = t; ax.appendChild(s); }
    bar.appendChild(ax);
    for (let i = 0; i < 4; i++) bar.appendChild(sp());
    _locPickBarAddSync();
  } else if (hkey !== _locPickBar.hkey) {   // the pointer's row alone
    _locPickBar.hkey = hkey;
    for (const n of bar.querySelectorAll('.lpb-h')) n.remove();
    if (hr) {
      const at = bar.querySelector('.lpb-axis-start');
      for (const n of _locPickBarRowNodes(hr)) bar.insertBefore(n, at);
    }
  }
}
// A row's nodes, in the grid's order (the pointer's row's marked .lpb-h)
function _locPickBarRowNodes(r) {
  const hov = r.kind === 'hover', faint = hov ? ' lpb-faint lpb-h' : '', out = [];
  const cell = (cls, text, rgb) => {
    const e = document.createElement('span');
    e.className = cls; e.textContent = text; e.title = text;   // the whole text where the cell cuts it
    if (rgb) e.style.background = `rgb(${rgb.map(Math.round).join(', ')})`;
    return e;
  };
  const dot = document.createElement('i'); dot.className = 'lpb-dot' + faint; dot.style.background = r.color; out.push(dot);
  out.push(cell('lpb-name' + (r.nm.near ? ' near' : '') + faint, r.nm.text));
  if (r.id !== null) {   // the reference clock: this place's time for every row (one at a time)
    const c = document.createElement('button');
    c.className = 'lpb-clock' + (r.ref ? ' on' : '');
    c.title = r.ref ? 'Back to each place\'s own time' : 'Show every row on this place\'s time, the strips aligned';
    c.setAttribute('aria-pressed', String(r.ref));
    c.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.5"/></svg>';
    c.addEventListener('click', () => { _locPickBar.ref = _locPickBar.ref === r.id ? null : r.id; _locPickBar.key = ''; _locPickBarSync(); });
    out.push(c);
  } else { const e = document.createElement('span'); if (hov) e.className = 'lpb-h'; out.push(e); }
  out.push(cell('lpi lpb-cell' + faint, r.rise.text, r.rise.rgb));
  const st = _locPickBarStrip(r.T); if (hov) st.classList.add('lpb-faint', 'lpb-h'); out.push(st);
  out.push(cell('lpi lpb-cell' + faint, r.set.text, r.set.rgb));
  out.push(cell('lpi lpb-cell' + faint, r.zone.text, r.zone.rgb));
  out.push(cell('lpi lpb-cell' + faint, r.lp.text, r.lp.rgb));
  if (r.kind === 'added') {
    const x = document.createElement('button'); x.className = 'lpb-x'; x.textContent = '×';
    x.title = 'Remove this place'; x.setAttribute('aria-label', 'Remove this place');
    const P = _locPickBar.places.find(p => p.color === r.color);
    x.addEventListener('click', () => _locPickBarRemove(P));
    out.push(x);
  } else { const e = document.createElement('span'); if (hov) e.className = 'lpb-h'; out.push(e); }
  return out;
}
// The + button's state
function _locPickBarAddSync() {
  const b = document.getElementById('locPickAdd');
  if (!b) return;
  const full = 1 + _locPickBar.places.length >= LOC_PICK_BAR_MAX;
  b.hidden = !!_locPick.ecl;
  b.disabled = full;
  b.classList.toggle('adding', _locPickBar.adding !== null);
  b.style.color = _locPickBar.adding || '';
  b.title = full ? 'At most ' + LOC_PICK_BAR_MAX + ' places' : _locPickBar.adding ? 'Click on the globe or pick a place in the search (Esc: stop)' : 'Add a place to compare';
  const cv = document.getElementById('locPickCanvas');
  cv.style.cursor = _locPickBar.adding ? _locPickBarCursor(_locPickBar.adding) : '';
}
// The pin cursor in a colour (as #locPickCanvas's own red one)
function _locPickBarCursor(col) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='34' viewBox='0 0 24 34'><path d='M12 33 C12 33 2.5 19.5 2.5 12 A9.5 9.5 0 0 1 21.5 12 C21.5 19.5 12 33 12 33 Z' fill='${col}' stroke='#ffffff' stroke-width='1.6'/><circle cx='12' cy='12' r='3.6' fill='#ffffff'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 33, crosshair`;
}
function _locPickBarSetAdding(on) {
  if (on) {
    const used = new Set(_locPickBar.places.map(p => p.color));
    const free = LOC_PICK_BAR_COLORS.find(c => !used.has(c));
    _locPickBar.adding = free && 1 + _locPickBar.places.length < LOC_PICK_BAR_MAX ? free : null;
  } else _locPickBar.adding = null;
  _locPickBarAddSync();
}
// A pick while adding (a click on the globe, or the search's place with its name): true when taken
function _locPickBarTake(p, name) {
  if (_locPickBar.adding === null || _locPick.ecl) return false;
  _locPickBar.places.push({ lat: p.lat, lon: p.lon, name: name || null, color: _locPickBar.adding });
  _locPickBarSetAdding(false);
  _locPickBar.key = '';
  _locPickBarSync();
  _locPickRequest();
  return true;
}
function _locPickBarRemove(P) {
  _locPickBar.places = _locPickBar.places.filter(p => p !== P);
  _locPickBar.key = '';
  _locPickBarSync();
  _locPickRequest();
}
// The added places' pins on the globe (after the Location's), not on the Eclipse map
function _locPickBarDrawPins(ctx, V) {
  if (_locPick.ecl) return;
  for (const P of _locPickBar.places) _locPickDrawPin(ctx, V, P.lat, P.lon, P.color);
}
// While the window is open the moment may run (playback, the Eclipse slider): the red lines follow
// by the minute, without a redraw of the globe
function _locPickBarWatch(open) {
  clearInterval(_locPickBar.timer); _locPickBar.timer = 0;
  if (!open) { _locPickBar.hover = null; _locPickBarSetAdding(false); return; }
  _locPickBar.timer = setInterval(() => { if (_locPick.open && _tzDateInstant() !== null) _locPickBarSync(); }, 500);
}
document.getElementById('locPickAdd').addEventListener('click', () => _locPickBarSetAdding(_locPickBar.adding === null));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _locPickBar.adding !== null) { _locPickBarSetAdding(false); e.stopPropagation(); } }, true);
