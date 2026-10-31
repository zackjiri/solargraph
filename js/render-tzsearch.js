// ─── Time zones search ──────────────────────────────────────────────────────────────────────────
// Round magnifier button left of the time zones' button (#btnLocPickZoneSearch), in the globe's
// window while the time zones show (SELECT and the Eclipse map). It opens #locPickZoneSearchPanel
// over the corner: a text box and the matches below it (five rows visible, a scrollbar for the
// rest), filtered again on every change of the text, the keys as in Night Sky's search
// (render-search.js): ArrowUp/ArrowDown move the highlight, Enter or a click picks, Escape closes.
// Searched:
//  - an offset: "+1", "UTC+1", "5:30", "-3" (without a sign both), its zones at the mode's moment
//    (_tzModeOffsets, so summer time in Night Sky and Eclipse);
//  - a region, the first part of the zones' names (Europe, America, Pacific ...);
//  - a zone of the grid by its name or its city (Prague, New York, Buenos Aires);
//  - a city whose zone the grid's 1970 variant merged into another (Oslo in Europe/Berlin): its
//    place in zone.tab, looked up in the grid;
//  - an old name or link of the tz database (Kiev, Calcutta), through the zone it names;
//  - a country by the tz database's name (iso3166.tab) or the browser's in English, Czech and the
//    browser's own languages (Intl.DisplayNames: Czechia, Česko, Chequia), its zones those of
//    zone.tab.
// Ranked as in Night Sky: an exact match first, then a name starting with the text, then a later
// word starting with it, then the text anywhere. Picking one turns the globe to it (a city or zone
// to its place, a group to the middle of its zones) and keeps its zones bright, the rest dimmed
// (_locPickDrawMatch, render-locpick.js), with a chip under the window's head whose × lets go.
// zone.tab, iso3166.tab and backward (IANA, public domain) are in data/timezones/tzdata/, copied
// there by tools/tz-grid.js with the grid they belong to; loaded on the first opening.
const _tzs = {
  open: false,
  data: null,          // {entries, places}, once loaded
  loading: false,
  rows: [], sel: 0,
  match: null,         // the picked one: {label, kind: 'offset', value} or {label, kind: 'zones', zones: Set}
};
const TZS_MAX_ROWS = 200;

function _tzsNorm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// An offset's text as typed, "+5:30" / "utc-3" / "530", or null if it is not one: the sign
// ('' when none), and the digits of hours and minutes
function _tzsOffsetQuery(s) {
  const m = /^(?:utc|gmt)?\s*([+\-−]?)\s*(\d{1,2})(?:[:.]?(\d{2}))?$/i.exec(String(s).trim());
  return m ? { sign: m[1] === '−' ? '-' : m[1], digits: String(+m[2]) + (m[3] && m[3] !== '00' ? m[3] : '') } : null;
}
function _tzsOffsetDigits(h) {
  const a = Math.abs(h), hh = Math.floor(a + 1e-9), mm = Math.round((a - hh) * 60);
  return String(hh) + (mm ? String(mm).padStart(2, '0') : '');
}
// The words of a name as keys: "America/Argentina/Buenos_Aires" -> its parts, spaced
function _tzsNameKeys(name) {
  const parts = name.split('/').map(p => p.replace(/_/g, ' '));
  return [name.replace(/_/g, ' '), ...parts.slice(1)];
}

// ── The data ─────────────────────────────────────────────────────────────────────────────────────
function _tzsLoad() {
  if (_tzs.data || _tzs.loading) return;
  _tzs.loading = true;
  const own = document.querySelector('script[src*="render-tzsearch.js"]');
  const bust = own && own.src.indexOf('?') >= 0 ? own.src.slice(own.src.indexOf('?')) : '';
  const get = (f) => fetch('data/timezones/tzdata/' + f + bust).then(r => (r.ok ? r.text() : ''))
    .catch(err => { console.warn('Time zones search data not loaded (' + f + '):', err); return ''; });
  Promise.all([_tzLoad(), get('zone.tab'), get('iso3166.tab'), get('backward')]).then(([G, zoneTab, isoTab, backward]) => {
    _tzs.loading = false;
    if (!G) return;
    _tzs.data = _tzsBuild(G, zoneTab, isoTab, backward);
    if (_tzs.open) _tzsUpdate();
  });
}
function _tzsBuild(G, zoneTab, isoTab, backward) {
  const lines = (t) => t.split('\n').filter(l => l && l[0] !== '#').map(l => l.split('\t'));
  const iso6709 = (s) => {
    const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(s);
    if (!m) return null;
    const v = (sg, d, mi, se) => (sg === '-' ? -1 : 1) * (+d + mi / 60 + (se ? se / 3600 : 0));
    return [v(m[1], m[2], m[3], m[4]), v(m[5], m[6], m[7], m[8])];
  };
  const gridIx = new Map(G.zones.map((z, i) => [z, i + 1]));
  const countryName = new Map(lines(isoTab).map(([c, n]) => [c, n]));
  // the places of zone.tab: name -> {lat, lon, country, s (the grid's zone there)}
  const places = new Map();
  for (const [code, coord, name] of lines(zoneTab)) {
    const p = iso6709(coord || '');
    if (!p || !name) continue;
    places.set(name, { lat: p[0], lon: p[1], country: code, s: _tzIndexAt(G, p[0], p[1]) });
  }
  // the grid's zones without a place of zone.tab: the middle of their cells
  const sum = new Map();
  for (let lat = -89.5; lat < 90; lat += 1) for (let lon = -179.5; lon < 180; lon += 1) {
    const s = _tzIndexAt(G, lat, lon);
    if (!s) continue;
    const v = _locPickVec(lon, lat), a = sum.get(s) || [0, 0, 0];
    a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; sum.set(s, a);
  }
  const middle = (vs) => {   // the mean direction of unit vectors -> [lat, lon]
    let x = 0, y = 0, z = 0;
    for (const v of vs) { x += v[0]; y += v[1]; z += v[2]; }
    const l = Math.hypot(x, y, z) || 1;
    return [Math.asin(z / l) / D2R_LP, Math.atan2(y, x) / D2R_LP];
  };
  const zonePlace = (s) => {
    const p = places.get(G.zones[s - 1]);
    if (p) return [p.lat, p.lon];
    const a = sum.get(s);
    return a ? middle([a]) : [0, 0];
  };
  const entries = [];
  // regions
  const regions = new Map();
  G.zones.forEach((z, i) => { const r = z.split('/')[0]; if (!regions.has(r)) regions.set(r, []); regions.get(r).push(i + 1); });
  for (const [r, zs] of regions) {
    entries.push({ keys: [r], label: r, sub: zs.length + (zs.length === 1 ? ' zone' : ' zones'), kind: 'zones',
      zones: new Set(zs), at: middle(zs.map(s => _locPickVec(zonePlace(s)[1], zonePlace(s)[0]))), order: 1 });
  }
  // the grid's zones
  G.zones.forEach((z, i) => {
    entries.push({ keys: _tzsNameKeys(z), label: z, sub: '', zone: i + 1, kind: 'zones', zones: new Set([i + 1]),
      at: zonePlace(i + 1), order: 2 });
  });
  // the cities of zone.tab merged into another zone of the grid
  for (const [name, p] of places) {
    if (gridIx.has(name) || !p.s) continue;
    const city = name.split('/').pop().replace(/_/g, ' ');
    entries.push({ keys: _tzsNameKeys(name), label: city, sub: (countryName.get(p.country) || p.country) + ' → ' + G.zones[p.s - 1],
      zone: p.s, kind: 'zones', zones: new Set([p.s]), at: [p.lat, p.lon], order: 3 });
  }
  // old names and links, through the zone they name
  for (const l of backward.split('\n')) {
    const m = /^Link\s+(\S+)\s+(\S+)/.exec(l);
    if (!m) continue;
    const [, target, link] = m;
    if (gridIx.has(link) || places.has(link) || /^Etc\//.test(link)) continue;
    const s = gridIx.get(target) || (places.get(target) && places.get(target).s);
    if (!s) continue;
    const at = places.get(target) ? [places.get(target).lat, places.get(target).lon] : zonePlace(s);
    entries.push({ keys: _tzsNameKeys(link), label: link.replace(/_/g, ' '), sub: '→ ' + G.zones[s - 1], zone: s,
      kind: 'zones', zones: new Set([s]), at, order: 4 });
  }
  // countries: the tz database's name and the browser's, in English, Czech and the languages the
  // viewer's browser asks for (navigator.languages, as a rule the system's)
  const byCountry = new Map();
  for (const p of places.values()) { if (!p.s) continue; if (!byCountry.has(p.country)) byCountry.set(p.country, []); byCountry.get(p.country).push(p); }
  const langs = [...new Set(['en', 'cs', ...(navigator.languages || [navigator.language]).filter(Boolean)])];
  const names = langs.map((lang) => { try { return new Intl.DisplayNames([lang], { type: 'region' }); } catch (e) { return null; } }).filter(Boolean);
  for (const [code, ps] of byCountry) {
    const zones = new Set(ps.map(p => p.s));
    const name = countryName.get(code) || code;
    const keys = [name, code];
    for (const d of names) { try { const n = d.of(code); if (n && keys.indexOf(n) < 0) keys.push(n); } catch (e) { /* unknown code */ } }
    entries.push({ keys, label: name, sub: zones.size === 1 ? G.zones[[...zones][0] - 1] : zones.size + ' zones', kind: 'zones', zones,
      at: ps.length === 1 ? [ps[0].lat, ps[0].lon] : middle(ps.map(p => _locPickVec(p.lon, p.lat))), order: 5 });
  }
  for (const e of entries) e.norm = e.keys.map(k => [_tzsNorm(k), ...String(k).split(/[\s\-_/.,()']+/).filter(Boolean).slice(1).map(_tzsNorm)]);
  return { entries };
}

// ── Matching ─────────────────────────────────────────────────────────────────────────────────────
// The rank of an entry for the text (0 exact, 1 start, 2 a later word's start, 3 anywhere), or -1
function _tzsRank(e, q) {
  let best = -1;
  for (const forms of e.norm) {
    const [whole, ...words] = forms;
    const r = whole === q ? 0 : whole.startsWith(q) ? 1 : words.some(w => w.startsWith(q)) ? 2 : whole.includes(q) ? 3 : -1;
    if (r >= 0 && (best < 0 || r < best)) best = r;
  }
  return best;
}
// The offsets at the mode's moment as entries (their counts change with it)
function _tzsOffsetEntries(G) {
  const offs = _tzModeOffsets(G), count = new Map();
  for (let s = 1; s < offs.off.length; s++) { const h = offs.off[s]; if (h === h) count.set(h, (count.get(h) || 0) + 1); }
  return [...count].sort((a, b) => a[0] - b[0]).map(([h, n]) => ({
    label: 'UTC' + _fmtTimeZone(h), sub: n + (n === 1 ? ' zone' : ' zones'), kind: 'offset', value: h,
    sign: h < 0 ? '-' : '+', digits: _tzsOffsetDigits(h), at: null,
  }));
}
function _tzsUpdate() {
  const input = document.getElementById('locPickZoneSearchInput'), list = document.getElementById('locPickZoneSearchList');
  const note = document.getElementById('locPickZoneSearchNote');
  const text = input.value.trim(), q = _tzsNorm(text);
  list.innerHTML = '';
  _tzs.rows = []; _tzs.sel = 0;
  if (!_tzs.data) { note.textContent = text ? 'Loading…' : ''; return; }
  if (!text) { note.textContent = 'An offset (+1, 5:30), a region (Europe), a zone, city or country'; return; }
  const found = [];
  const oq = _tzsOffsetQuery(text);
  if (oq) {
    for (const e of _tzsOffsetEntries(_tzGrid.data)) {
      if (oq.sign && oq.sign !== e.sign) continue;
      const r = e.digits === oq.digits ? 0 : e.digits.startsWith(oq.digits) ? 1 : -1;
      if (r >= 0) found.push({ e, r, o: 0 });
    }
  }
  if (q) for (const e of _tzs.data.entries) { const r = _tzsRank(e, q); if (r >= 0) found.push({ e, r, o: e.order }); }
  found.sort((a, b) => a.r - b.r || a.o - b.o || a.e.label.localeCompare(b.e.label));
  _tzs.rows = found.slice(0, TZS_MAX_ROWS).map(f => f.e);
  const offs = _tzModeOffsets(_tzGrid.data);
  _tzs.rows.forEach((e, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const name = document.createElement('span'); name.className = 'tzs-name'; name.textContent = e.label;
    const sub = document.createElement('span'); sub.className = 'tzs-sub';
    // a zone's offset at the mode's moment
    const h = e.zone ? offs.off[e.zone] : NaN;
    sub.textContent = e.sub || (h === h ? 'UTC' + _fmtTimeZone(h) : '');
    li.append(name, sub);
    li.addEventListener('mousedown', (ev) => { ev.preventDefault(); _tzsPick(e); });
    li.addEventListener('mousemove', () => { if (_tzs.sel !== i) { _tzs.sel = i; _tzsMarkSel(); } });
    list.appendChild(li);
  });
  note.textContent = _tzs.rows.length ? (found.length > TZS_MAX_ROWS ? TZS_MAX_ROWS + ' of ' + found.length + ' shown' : '') : 'Nothing found';
  _tzsMarkSel();
}
function _tzsMarkSel() {
  const items = document.getElementById('locPickZoneSearchList').children;
  for (let i = 0; i < items.length; i++) items[i].classList.toggle('sel', i === _tzs.sel);
  if (items[_tzs.sel]) items[_tzs.sel].scrollIntoView({ block: 'nearest' });
}

// ── Picking ──────────────────────────────────────────────────────────────────────────────────────
// Turns the globe to the entry (an offset: to the middle of its zones at the moment) and keeps it
// bright; the chip under the head names it
function _tzsPick(e) {
  const G = _tzGrid.data;
  let at = e.at;
  if (e.kind === 'offset') {
    const offs = _tzModeOffsets(G), vs = [];
    for (let s = 1; s < offs.off.length; s++) if (offs.off[s] === e.value) { const v = _tzsZoneVec(s); if (v) vs.push(v); }
    if (vs.length) {
      let x = 0, y = 0, z = 0;
      for (const v of vs) { x += v[0]; y += v[1]; z += v[2]; }
      const l = Math.hypot(x, y, z) || 1;
      at = [Math.asin(z / l) / D2R_LP, Math.atan2(y, x) / D2R_LP];
    }
  }
  _tzs.match = e.kind === 'offset' ? { label: e.label, kind: 'offset', value: e.value }
    : { label: e.label, kind: 'zones', zones: e.zones };
  if (at) { _locPick.lat0 = Math.max(-89, Math.min(89, at[0])); _locPick.lon0 = at[1]; }
  _tzsSetOpen(false);
  _tzsChip();
  _locPickRequest();
}
// A zone's place as a unit vector, from the zone's own entry, or null
function _tzsZoneVec(s) {
  const e = _tzs.data && _tzs.data.entries.find(x => x.zone === s && x.order === 2);
  return e ? _locPickVec(e.at[1], e.at[0]) : null;
}
function _tzsClear() {
  _tzs.match = null;
  _tzsChip();
  _locPickRequest();
}
// The chip under the head: the picked one and its ×, while the time zones show
function _tzsChip() {
  const chip = document.getElementById('locPickZoneMatch');
  chip.hidden = !_tzs.match;
  if (_tzs.match) document.getElementById('locPickZoneMatchText').textContent = _tzs.match.label;
}

// ── The panel ────────────────────────────────────────────────────────────────────────────────────
function _tzsSetOpen(on) {
  _tzs.open = on;
  document.getElementById('locPickZoneSearchPanel').classList.toggle('open', on);
  document.getElementById('btnLocPickZoneSearch').setAttribute('aria-pressed', String(on));
  if (on) {
    _tzsLoad();
    const input = document.getElementById('locPickZoneSearchInput');
    input.value = '';
    _tzsUpdate();
    input.focus();
  }
}
document.getElementById('btnLocPickZoneSearch').addEventListener('click', () => _tzsSetOpen(!_tzs.open));
document.getElementById('locPickZoneMatchClear').addEventListener('click', _tzsClear);
document.getElementById('locPickZoneSearchInput').addEventListener('input', _tzsUpdate);
document.getElementById('locPickZoneSearchInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!_tzs.rows.length) return;
    _tzs.sel = (_tzs.sel + (e.key === 'ArrowDown' ? 1 : -1) + _tzs.rows.length) % _tzs.rows.length;
    _tzsMarkSel();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (_tzs.rows[_tzs.sel]) _tzsPick(_tzs.rows[_tzs.sel]);
  } else if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();   // the panel closes, not the globe's window
    _tzsSetOpen(false);
  }
});
