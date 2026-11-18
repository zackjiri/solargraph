// ─── Daylight layer: date, modes, value at a point, palette ─────────────────────────────────────
// The model behind the globe's Daylight layer (design: specs/2026-11-18-daylight-layer-design.md).
// Modes are Day length, Sunrise and Sunset. The date is the calendar day in the Location's zone:
// Night Sky and Eclipse take their moment (_tzDateInstant), Solargraph the Custom date or today.
// Values are in hours; a sunrise or sunset is the UT hour of the event on D at the point's local
// midday (_solarEventsAt, unwrapped), shifted to a time base by the caller with _dlClock.
const DL_MODES = {
  length: { step: 1, unit: 'h' },
  rise: { step: 0.5, unit: 'clock' },
  set: { step: 0.5, unit: 'clock' },
};
// Palette anchors [position 0..24, rgb], spread over the mode's range (DL_RANGES, hours): a time
// before the range takes the first anchor, after it the last; Day length spans the whole dial
const DL_ANCHORS = [[0, [11, 31, 77]], [6, [74, 159, 224]], [12, [58, 168, 69]], [18, [240, 138, 36]], [24, [245, 214, 58]]];
const DL_RANGES = { length: [0, 24], rise: [2, 11], set: [13, 22] };
const DL_ALT_LIGHTEN = 0.12;   // every odd band this far toward white, so neighbours always differ
const DL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The Location (signed degrees)
function _dlLocation() {
  return [hemisphere * LAT, lonHemisphere * LONG];
}
// The Location zone's offset [h] at the mode's moment (the standard offset in Solargraph) and
// whether it is exact: { h, exact }. Nautical at sea is exact; nautical while the grid is not
// loaded (call _tzLoad first) or for a zone the browser does not know is not.
function _dlLocationOffsetInfo() {
  const [lat, lon] = _dlLocation();
  return _dlOffsetInfoAt(lat, lon);
}
// The same for any point (signed degrees): its zone's offset, the local base's
function _dlOffsetInfoAt(lat, lon) {
  const g = _tzGrid.data;
  if (!g) return { h: _tzNautical(lon), exact: false };
  const ix = _tzIndexAt(g, lat, lon);
  if (!ix) return { h: _tzNautical(lon), exact: true };
  const ms = _tzModeInstant();
  const h = ms === null ? _tzStandardOffset(g.zones[ix - 1]) : _tzOffsetAt(g.zones[ix - 1], ms);
  return h === null ? { h: _tzNautical(lon), exact: false } : { h, exact: true };
}
function _dlLocationOffsetH() {
  return _dlLocationOffsetInfo().h;
}
// The calendar date D in the Location's zone: { year, month, day, label, exact }; exact is false
// while the offset is a fallback (see _dlLocationOffsetInfo), then D may be a day off. info: the
// Location's offset info when the caller has it already. A Custom date of 29 Feb in a common year
// (the year of today in the Location's zone) is 28 Feb.
function _dlDate(info = _dlLocationOffsetInfo()) {
  const off = info.h;
  let y, m, d;
  const inst = _tzDateInstant();
  const chk = document.getElementById('chkCustomArc');
  if (inst !== null) {
    const t = new Date(inst + off * 3600000);
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
  } else if (chk && chk.checked) {
    y = new Date(Date.now() + off * 3600000).getUTCFullYear(); m = customMonth; d = customDay;
    if (m === 2 && d === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) d = 28;
  } else {
    const t = new Date(Date.now() + off * 3600000);
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
  }
  return { year: y, month: m, day: d, label: d + ' ' + DL_MONTHS[m - 1] + ' ' + y, exact: info.exact };
}
// The mode's value at a point on date D: { v, none }. v [h]: day length, or the event's UT hour
// (unwrapped); none: 'day' or 'night' where a sunrise or sunset does not occur
function _dlValueUT(mode, lat, lon, D) {
  const e = _solarEventsAt(lat, lon, D.year, D.month, D.day);
  if (mode === 'length') return { v: e.lenH, none: null };
  return { v: mode === 'rise' ? e.riseUT : e.setUT, none: e.polarDay ? 'day' : e.polarNight ? 'night' : null };
}
// A UT hour shifted by offsetH onto the 0..24 dial
function _dlClock(vUT, offsetH) {
  const c = (vUT + offsetH) % 24;
  return c < 0 ? c + 24 : c;
}
// The band: length floor(h) in 0..23, a time of day floor(clock / 0.5) in 0..47; 0 for a
// non-finite value (callers skip when none is set)
function _dlBand(mode, value) {
  if (!Number.isFinite(value)) return 0;
  if (mode === 'length') return Math.max(0, Math.min(23, Math.floor(value)));
  return Math.max(0, Math.min(47, Math.floor(value / DL_MODES[mode].step)));
}
function _dlPalette(h) {
  const i = Math.max(0, Math.min(3, Math.floor(h / 6))), t = (h - DL_ANCHORS[i][0]) / 6;
  return DL_ANCHORS[i][1].map((c, k) => Math.round(c + (DL_ANCHORS[i + 1][1][k] - c) * t));
}
// The band's colour [r, g, b]: the palette at the band's middle placed on the mode's range (the
// ends beyond it); length's end bands take the anchors; an odd band DL_ALT_LIGHTEN toward white
function _dlColor(mode, band) {
  let c;
  if (mode === 'length' && band <= 0) c = DL_ANCHORS[0][1].slice();
  else if (mode === 'length' && band >= 23) c = DL_ANCHORS[4][1].slice();
  else {
    const [r0, r1] = DL_RANGES[mode], mid = (band + 0.5) * DL_MODES[mode].step;
    c = _dlPalette(Math.max(0, Math.min(1, (mid - r0) / (r1 - r0))) * 24);
  }
  return band % 2 ? c.map(x => Math.round(x + (255 - x) * DL_ALT_LIGHTEN)) : c;
}
// The first and last band wholly inside the mode's range: { lo, hi }
function _dlRangeBands(mode) {
  const [r0, r1] = DL_RANGES[mode], step = DL_MODES[mode].step;
  return { lo: Math.ceil(r0 / step - 1e-9), hi: Math.floor(r1 / step + 1e-9) - 1 };
}
// The value as text: '14 h 32 min' for a length, '6:42' for a time of day
function _dlFmt(mode, value) {
  if (mode === 'length') {
    const t = Math.round(value * 60);
    return Math.floor(t / 60) + ' h ' + (t % 60) + ' min';
  }
  const t = Math.round(value * 60) % 1440;
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

// ─── Grid, refined isolines and band rings ──────────────────────────────────────────────────────
// Grid: lon -180..180 step 1 deg (361 columns; -180 and +180 kept apart, the date-line seam is
// real), lat -90..90 step 0.5 deg (361 rows), nodes row-major by latitude (index j * nx + i).
// Values follow _solarEventsAt (core.js) step by step: the Sun's declination, semi-diameter and
// equation of time come from an hourly table of _solarSunAtJDE over the UT hours the date D can
// reach (-13..37), interpolated linearly, which keeps every event within about a second of the
// exact model at a fraction of its cost (_solarEventsAt is ~4 us a call, the grid has 130k nodes).
// Isolines: marching squares on the grid padded with one ring of nodes below every level (so all
// contours close along the border), saddles by the cell-centre average; each crossing on an inner
// edge is refined along that edge (Illinois false position, then bisection) until
// |v - level| < 1/1200 h. The model steps at the polar-day / polar-night edge (an event's own
// declination against the clamped continuation; minutes at the solstices, hours near the poles at
// the equinoxes): a level inside such a step follows the edge, its vertices land on the step.
// _dlGrid's object also carries min and max of v; its none array is shared by the modes.
// Rings are arrays of [lon, lat] in degrees, not repeating the first point, and enclose the region
// v >= level with that region on the LEFT walking the ring in the lon/lat plane (lon to the right,
// lat up): outer boundaries run counter-clockwise, holes clockwise. Along the border the ring walks
// the grid nodes on lon +-180 and lat +-90 (the pole rows are single points on the sphere, those
// edges have zero length there). The planar winding number in lon/lat is the region's indicator;
// on the sphere the summed signed angle the edges subtend at p, over 2 pi, is in(p) - in(-p).
const DL_GRID = { lon0: -180, lat0: -90, dLon: 1, dLat: 0.5, nx: 361, ny: 361 };
const DL_TAB_H0 = -13, DL_TAB_N = 51;
const DL_REFINE_TOL = 1 / 1200;
const _dlCache = new Map(); // 'y-m-d' -> per-date entry, the last few dates

// Drops the per-date caches and the contour scratch (~2 MB), e.g. when the layer is turned off
function _dlShapesReset() {
  _dlCache.clear();
  _dlScratch = null;
}
function _dlEntry(D) {
  const key = D.year + '-' + D.month + '-' + D.day;
  let e = _dlCache.get(key);
  if (e) return e;
  if (_dlCache.size >= 3) _dlCache.delete(_dlCache.keys().next().value);
  e = { D: { year: D.year, month: D.month, day: D.day }, tab: null, core: null, grids: {}, buckets: {}, contours: new Map(), none: null };
  _dlCache.set(key, e);
  return e;
}
// Hourly Sun table for date D: sin/cos of declination, sin of the horizon altitude (refracted,
// upper limb), equation of time [min]; index = hourUT - DL_TAB_H0
function _dlSunTable(e) {
  if (e.tab) return e.tab;
  const n = DL_TAB_N, sd = new Float64Array(n), cd = new Float64Array(n), sh = new Float64Array(n), eot = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = _solarSunAtJDE(_moonJDE(e.D.year, e.D.month, e.D.day, DL_TAB_H0 + i));
    sd[i] = Math.sin(v.dec); cd[i] = Math.cos(v.dec);
    sh[i] = Math.sin((SKY_HORIZON_TRUE_ALT - v.semiDeg) * Math.PI / 180); eot[i] = v.eotMin;
  }
  return (e.tab = { sd, cd, sh, eot });
}
// Half the day [h] around true hour th with the Sun of that instant (base = eot / 60 + lon / 15
// at true noon, lh = lon / 15)
function _dlHalf(T, sphi, cphi, base, th) {
  const x = th - base - DL_TAB_H0;
  let i = Math.floor(x);
  if (i < 0) i = 0; else if (i > DL_TAB_N - 2) i = DL_TAB_N - 2;
  const f = x - i, sd = T.sd, cd = T.cd, sh = T.sh;
  const X = (sh[i] + (sh[i + 1] - sh[i]) * f - sphi * (sd[i] + (sd[i + 1] - sd[i]) * f)) / (cphi * (cd[i] + (cd[i + 1] - cd[i]) * f));
  return X <= -1 ? 12 : X >= 1 ? 0 : Math.acos(X) * 3.819718634205488;
}
function _dlTabAt(a, h) {
  const x = h - DL_TAB_H0;
  let i = Math.floor(x);
  if (i < 0) i = 0; else if (i > DL_TAB_N - 2) i = DL_TAB_N - 2;
  return a[i] + (a[i + 1] - a[i]) * (x - i);
}
// The hour-angle cosine at true noon (polar day X <= -1, polar night X >= 1)
function _dlNoonX(T, sphi, cphi, base) {
  const h = 12 - base;
  return (_dlTabAt(T.sh, h) - sphi * _dlTabAt(T.sd, h)) / (cphi * _dlTabAt(T.cd, h));
}
// One event [h, UT, unwrapped] step by step as _solarEventsCore: sg -1 sunrise, +1 sunset; X the
// noon cosine; polar day and night as the clamped continuation (true noon -+12, true noon)
function _dlEventOne(T, sphi, cphi, base, lh, X, sg) {
  if (X <= -1) return 12 + 12 * sg - base;
  if (X >= 1) return 12 - base;
  let t = 12 + sg * Math.acos(X) * 3.819718634205488;
  t = 12 + sg * Math.min(12, _dlHalf(T, sphi, cphi, base, t));
  t = 12 + sg * Math.min(12, _dlHalf(T, sphi, cphi, base, t));
  return t - _dlTabAt(T.eot, t - base) / 60 - lh;
}
// The latitude as _solarEventsAt takes it (0 and +-90 clamped to 0.1 and +-89.9) [rad]
function _dlPhi(latDeg) {
  const a = Math.abs(latDeg);
  return (a === 0 ? 0.1 : a === 90 ? 89.9 : a) * (latDeg < 0 ? -1 : 1) * Math.PI / 180;
}
// The events at any point from the table: out.X, and with which 1 / 2 / 3 out.rise / out.set / both
function _dlFastAt(T, latDeg, lonE, out, which = 3) {
  const phi = _dlPhi(latDeg), sphi = Math.sin(phi), cphi = Math.cos(phi);
  const lh = lonE / 15, base = _dlTabAt(T.eot, 12 - lh) / 60 + lh, X = _dlNoonX(T, sphi, cphi, base);
  out.X = X;
  if (which & 1) out.rise = _dlEventOne(T, sphi, cphi, base, lh, X, -1);
  if (which & 2) out.set = _dlEventOne(T, sphi, cphi, base, lh, X, 1);
  return out;
}
// Per-date node values: X (Float64Array), the none flags (0, 1 polar day, 2 polar night) and the
// per-row and per-column terms the event fields reuse
function _dlCore(e) {
  if (e.core) return e.core;
  const T = _dlSunTable(e), { nx, ny } = DL_GRID, n = nx * ny;
  const X = new Float64Array(n), none = new Uint8Array(n);
  const sphi = new Float64Array(ny), cphi = new Float64Array(ny), base = new Float64Array(nx), lh = new Float64Array(nx);
  const s12 = new Float64Array(nx), c12 = new Float64Array(nx), h12 = new Float64Array(nx);
  for (let j = 0; j < ny; j++) { const p = _dlPhi(DL_GRID.lat0 + j * DL_GRID.dLat); sphi[j] = Math.sin(p); cphi[j] = Math.cos(p); }
  for (let i = 0; i < nx; i++) {
    lh[i] = (DL_GRID.lon0 + i * DL_GRID.dLon) / 15; base[i] = _dlTabAt(T.eot, 12 - lh[i]) / 60 + lh[i];
    s12[i] = _dlTabAt(T.sd, 12 - base[i]); c12[i] = _dlTabAt(T.cd, 12 - base[i]); h12[i] = _dlTabAt(T.sh, 12 - base[i]);
  }
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    const x = (h12[i] - sphi[j] * s12[i]) / (cphi[j] * c12[i]);
    X[k] = x; none[k] = x <= -1 ? 1 : x >= 1 ? 2 : 0;
  }
  return (e.core = { X, none, sphi, cphi, base, lh });
}
// The mode's node field [h, UT] as Float64Array (length = set - rise)
function _dlField(e, mode) {
  const c = _dlCore(e);
  if (c[mode]) return c[mode];
  if (mode === 'length') {
    const r = _dlField(e, 'rise'), s = _dlField(e, 'set'), f = new Float64Array(r.length);
    for (let k = 0; k < f.length; k++) f[k] = s[k] - r[k];
    return (c.length = f);
  }
  const T = _dlSunTable(e), { nx, ny } = DL_GRID, f = new Float64Array(nx * ny), sg = mode === 'rise' ? -1 : 1;
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    f[k] = _dlEventOne(T, c.sphi[j], c.cphi[j], c.base[i], c.lh[i], c.X[k], sg);
  }
  return (c[mode] = f);
}
// The grid for mode and date D: { lon0, lat0, dLon, dLat, nx, ny, v, none }; v [h] in UT (length
// in hours) with polar day and night as the clamped continuation, none 0, 1 polar day, 2 polar night
function _dlGrid(mode, D) {
  const e = _dlEntry(D);
  if (e.grids[mode]) return e.grids[mode];
  const f = _dlField(e, mode);
  const g = Object.assign({}, DL_GRID, { v: Float32Array.from(f), none: _dlCore(e).none });
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < f.length; k++) { if (f[k] < lo) lo = f[k]; if (f[k] > hi) hi = f[k]; }
  e.grids[mode] = g; g.min = lo; g.max = hi;
  return g;
}
// The UT levels of the band edges for mode, date D and base offset [h] (length ignores it), over
// the grid's value range: k * step - offsetH with min < level <= max; length 1..23
function _dlLevelsFor(mode, D, offsetH = 0) {
  const g = _dlGrid(mode, D), step = DL_MODES[mode].step, off = mode === 'length' ? 0 : offsetH;
  const out = [];
  for (let k = Math.floor((g.min + off) / step) + 1; k * step - off <= g.max; k++) {
    const L = k * step - off;
    if (mode === 'length' && (L < 1 || L > 23)) continue;
    out.push(L);
  }
  return out;
}
// Inner cells of field F bucketed by value: bucket b holds the cells whose [min, max] meets
// [lo + b * w, lo + (b + 1) * w); cell index c = j * nx + i (lower-left node)
function _dlBuckets(F, w) {
  const { nx, ny } = DL_GRID, nc = (nx - 1) * (ny - 1);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < F.length; k++) { if (F[k] < lo) lo = F[k]; if (F[k] > hi) hi = F[k]; }
  lo = Math.floor(lo / w) * w;
  const nb = Math.floor((hi - lo) / w) + 1, b0 = new Int32Array(nc), b1 = new Int32Array(nc), cnt = new Int32Array(nb + 1);
  for (let j = 0, c = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++, c++) {
    const k = j * nx + i, a = F[k], b = F[k + 1], d = F[k + nx], q = F[k + nx + 1];
    b0[c] = Math.floor((Math.min(a, b, d, q) - lo) / w); b1[c] = Math.floor((Math.max(a, b, d, q) - lo) / w);
    for (let t = b0[c]; t <= b1[c]; t++) cnt[t + 1]++;
  }
  for (let t = 0; t < nb; t++) cnt[t + 1] += cnt[t];
  const pos = cnt.slice(0, nb), cells = new Int32Array(cnt[nb]);
  for (let c = 0; c < nc; c++) {
    const k = ((c / (nx - 1)) | 0) * nx + c % (nx - 1);
    for (let t = b0[c]; t <= b1[c]; t++) cells[pos[t]++] = k;
  }
  return { lo, w, nb, start: cnt, cells };
}
// Inner cells (lower-left node index) whose corners are not all flag or all not flag
function _dlFlagCells(none, flag) {
  const { nx, ny } = DL_GRID, out = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k = j * nx + i, n = (none[k] === flag) + (none[k + 1] === flag) + (none[k + nx] === flag) + (none[k + nx + 1] === flag);
    if (n && n < 4) out.push(k);
  }
  return out;
}
// Marching-squares segments by corner case (bit k set: corner k >= level; corners 0..3 counter-
// clockwise from (i, j), edge k runs corner k -> k + 1). A segment starts on an edge that leaves
// the region and ends on one that enters it, which keeps the region on its left. Each case holds
// its variants of [start edge, end edge] pairs: the saddles 5 and 10 [centre below, centre above].
const DL_MS = (() => {
  const t = [];
  for (let c = 0; c < 16; c++) {
    const ab = (k) => (c >> (k & 3)) & 1, st = [], en = [];
    for (let k = 0; k < 4; k++) { if (ab(k) && !ab(k + 1)) st.push(k); if (!ab(k) && ab(k + 1)) en.push(k); }
    t.push(st.length === 2 ? [st.map((s) => [s, (s + 3) & 3]), st.map((s) => [s, (s + 1) & 3])] : [st.map((s, n) => [s, en[n]])]);
  }
  return t;
})();
let _dlOpenChains = 0; // chains that did not close back to their start, counted per _dlShapes call
let _dlScratch = null; // { next, mark, gen } over the padded grid's edges
// Rings of the region F >= level. F: node field; cells: inner cells to visit by lower-left node
// index (null: all); evalAt(lat, lon): the field's value anywhere, for refining crossings on inner
// edges; tol: stop when |evalAt - level| < tol
function _dlContour(F, level, cells, evalAt, tol) {
  const { nx, ny, lon0, lat0, dLon, dLat } = DL_GRID, PX = nx + 2, nE = 2 * PX * (ny + 2);
  if (!_dlScratch || _dlScratch.next.length !== nE) _dlScratch = { next: new Int32Array(nE), mark: new Int32Array(nE), gen: 0 };
  const S = _dlScratch, next = S.next, mark = S.mark;
  if (S.gen > 2e9) { mark.fill(0); S.gen = 0; }
  const gSet = ++S.gen, gSeen = ++S.gen, starts = [];
  const val = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny) ? -Infinity : F[j * nx + i];
  // edge ids: horizontal (i,j)-(i+1,j) = 2p, vertical (i,j)-(i,j+1) = 2p + 1, p the padded node index
  const es = [0, 0, 0, 0];
  const emit = (i, j, a, b, c, d) => {
    const cs = (a >= level) | ((b >= level) << 1) | ((c >= level) << 2) | ((d >= level) << 3);
    if (cs === 0 || cs === 15) return;
    const v = DL_MS[cs], segs = v.length > 1 && (a + b + c + d) / 4 >= level ? v[1] : v[0];
    const p = (j + 1) * PX + i + 1;
    es[0] = 2 * p; es[1] = 2 * (p + 1) + 1; es[2] = 2 * (p + PX); es[3] = 2 * p + 1;
    for (let n = 0; n < segs.length; n++) {
      const s = es[segs[n][0]];
      next[s] = es[segs[n][1]]; mark[s] = gSet; starts.push(s);
    }
  };
  const lastI = nx - 1, lastJ = ny - 1;
  // border cells: below the bottom row, above the top row, left of lon -180, right of +180
  const N = -Infinity, top = lastJ * nx;
  emit(-1, -1, N, N, F[0], N); emit(lastI, -1, N, N, N, F[lastI]);
  emit(-1, lastJ, N, F[top], N, N); emit(lastI, lastJ, F[top + lastI], N, N, N);
  for (let i = 0; i < lastI; i++) { emit(i, -1, N, N, F[i + 1], F[i]); emit(i, lastJ, F[top + i], F[top + i + 1], N, N); }
  for (let j = 0, k = 0; j < lastJ; j++, k += nx) { emit(-1, j, N, F[k], F[k + nx], N); emit(lastI, j, F[k + lastI], N, N, F[k + nx + lastI]); }
  const inner = (k) => emit(k % nx, (k / nx) | 0, F[k], F[k + 1], F[k + nx + 1], F[k + nx]);
  if (cells) for (let t = 0; t < cells.length; t++) inner(cells[t]);
  else for (let j = 0; j < lastJ; j++) for (let i = 0; i < lastI; i++) inner(j * nx + i);
  // the crossing on an edge: a border node, or refined along an inner edge
  const point = (id) => {
    const v = id & 1, p = id >> 1, i = (p % PX) - 1, j = ((p / PX) | 0) - 1;
    const i2 = v ? i : i + 1, j2 = v ? j + 1 : j;
    const va = val(i, j), vb = val(i2, j2);
    if (va === -Infinity) return [lon0 + i2 * dLon, lat0 + j2 * dLat];
    if (vb === -Infinity) return [lon0 + i * dLon, lat0 + j * dLat];
    const lonA = lon0 + i * dLon, latA = lat0 + j * dLat, dx = (i2 - i) * dLon, dy = (j2 - j) * dLat;
    let t0 = 0, g0 = va - level, t1 = 1, g1 = vb - level, side = 0;
    // Illinois false position, then plain bisection: across the step the exact model takes at
    // the polar-day / polar-night edge false position stalls, bisection lands on the step
    let t = g0 / (g0 - g1);
    for (let it = 0; it < 60; it++) {
      const g = evalAt(latA + t * dy, lonA + t * dx) - level;
      if (Math.abs(g) < tol || t1 - t0 < 1e-9) break;
      if ((g < 0) === (g1 < 0)) { t1 = t; g1 = g; if (side === -1) g0 /= 2; side = -1; }
      else { t0 = t; g0 = g; if (side === 1) g1 /= 2; side = 1; }
      t = it < 8 ? (t0 * g1 - t1 * g0) / (g1 - g0) : (t0 + t1) / 2;
      if (!(t > t0 && t < t1)) t = (t0 + t1) / 2;
    }
    return [lonA + t * dx, latA + t * dy];
  };
  const rings = [];
  for (const s of starts) {
    if (mark[s] === gSeen) continue;
    const r = [];
    let e = s;
    do {
      mark[e] = gSeen;
      const q = point(e), l = r[r.length - 1];
      if (!l || l[0] !== q[0] || l[1] !== q[1]) r.push(q);
      e = next[e];
    } while (e !== s && mark[e] === gSet);
    if (e !== s) _dlOpenChains++;
    while (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    if (r.length >= 3) rings.push(r);
  }
  return rings;
}
// The grid's replica of _solarEventsCore against the exact model at one node (40 N, 15 E, never
// polar): a warning when they differ by more than 1 s, e.g. after a change to core.js
function _dlCheckReplica(mode, D, F) {
  const i = 195, j = 260, ex = _solarEventsAt(DL_GRID.lat0 + j * DL_GRID.dLat, DL_GRID.lon0 + i * DL_GRID.dLon, D.year, D.month, D.day);
  const want = mode === 'rise' ? ex.riseUT : mode === 'set' ? ex.setUT : ex.lenH, d = Math.abs(F[j * DL_GRID.nx + i] - want) * 3600;
  if (!(d <= 1)) console.warn('Daylight: the grid differs from _solarEventsAt by ' + d.toFixed(1) + ' s (' + mode + '); update _dlEventOne to match core.js');
}
// Shapes for mode, date D and base offset [h] (UTC 0, Location its offset; length ignores it):
// { levels: [{ level, rings }], none: { day, night }, ms }. levels: the band edges in UT, each
// with the rings of v >= level; none: rings of polar day (X <= -1) and polar night (X >= 1), the
// hour-angle cosine at true noon, refined to the flag's boundary. The grid is cached by date and
// mode, contours by date, mode and level, so UTC and Location share them; ms: this call's time.
function _dlShapes(mode, D, offsetH = 0) {
  const t0 = performance.now(), e = _dlEntry(D), cold = !(e.core && e.core[mode]);
  const T = _dlSunTable(e), F = _dlField(e, mode), o = { rise: 0, set: 0, X: 0 };
  if (cold) _dlCheckReplica(mode, D, F);
  _dlOpenChains = 0;
  const evalAt = mode === 'length' ? (la, lo) => { _dlFastAt(T, la, lo, o, 3); return o.set - o.rise; }
    : mode === 'rise' ? (la, lo) => _dlFastAt(T, la, lo, o, 1).rise : (la, lo) => _dlFastAt(T, la, lo, o, 2).set;
  const levels = [];
  for (const L of _dlLevelsFor(mode, D, offsetH)) {
    const key = mode + '|' + L;
    let rings = e.contours.get(key);
    if (!rings) {
      const B = e.buckets[mode] || (e.buckets[mode] = _dlBuckets(F, DL_MODES[mode].step));
      const b = Math.min(B.nb - 1, Math.max(0, Math.floor((L - B.lo) / B.w)));
      rings = _dlContour(F, L, B.cells.subarray(B.start[b], B.start[b + 1]), evalAt, DL_REFINE_TOL);
      e.contours.set(key, rings);
    }
    levels.push({ level: L, rings });
  }
  if (!e.none) {
    const c = _dlCore(e), negX = c.X.map((x) => -x);
    e.none = {
      day: _dlContour(negX, 1, _dlFlagCells(c.none, 1), (la, lo) => -_dlFastAt(T, la, lo, o, 0).X, 1e-12),
      night: _dlContour(c.X, 1, _dlFlagCells(c.none, 2), (la, lo) => _dlFastAt(T, la, lo, o, 0).X, 1e-12),
    };
  }
  if (_dlOpenChains) console.warn('Daylight: ' + _dlOpenChains + ' contour chain(s) did not close (' + mode + ', ' + e.D.year + '-' + e.D.month + '-' + e.D.day + ')');
  return { levels, none: e.none, ms: performance.now() - t0 };
}

// ─── The local base per pixel ───────────────────────────────────────────────────────────────────
// For the globe's local base (render-locpick-daylight.js), where each pixel takes its zone's offset:
// the grid of mode on date D, interpolated bilinearly, with per cell (index j * (nx - 1) + i, the
// lower-left node) a flag and a bound of the interpolation's error [h]:
// - flag 0: no corner polar; err = (the largest second difference along lon at its corners + the
//   largest along lat) / 8, doubled, plus 2 s (bilinear interpolation errs by at most
//   (|f_xx| dx^2 + |f_yy| dy^2) / 8); Infinity where a corner's neighbour is polar, as the model steps
//   at the polar edge (the clamped continuation against the event's own declination);
// - flag 1 or 2: every corner polar day or polar night, the cell taken as that;
// - flag 3: the corners differ, each pixel from the model.
// at(lat, lon, out) is the model there (out.v the UT hour, out.none 0, 1 polar day, 2 polar night),
// the grid's replica _dlFastAt (within ~1 s of _dlValueUT, at a tenth of its cost): a pixel whose
// interpolated value lies closer to a band edge than its cell's err takes it, so the edges hold to
// the exact model's within seconds.
function _dlLocalSrc(mode, D) {
  const e = _dlEntry(D), L = e.local || (e.local = {});
  if (L[mode]) return L[mode];
  const g = _dlGrid(mode, D), { nx, ny } = g, v = g.v, none = g.none, T = _dlSunTable(e);
  const sd = new Float32Array(nx * ny);
  for (let j = 0, k = 0; j < ny; j++) for (let i = 0; i < nx; i++, k++) {
    const ic = i < 1 ? 1 : i > nx - 2 ? nx - 2 : i, jc = j < 1 ? 1 : j > ny - 2 ? ny - 2 : j;
    const b = j * nx + ic, c = jc * nx + i;   // the differences along lon at (ic, j), along lat at (i, jc)
    let s = Math.abs(v[b - 1] - 2 * v[b] + v[b + 1]) + Math.abs(v[c - nx] - 2 * v[c] + v[c + nx]);
    if (none[k] || (i > 0 && none[k - 1]) || (i < nx - 1 && none[k + 1]) || (j > 0 && none[k - nx]) || (j < ny - 1 && none[k + nx])) s = Infinity;
    sd[k] = s;
  }
  const mx = nx - 1, my = ny - 1, err = new Float32Array(mx * my), flag = new Uint8Array(mx * my);
  for (let j = 0, c = 0; j < my; j++) for (let i = 0; i < mx; i++, c++) {
    const k = j * nx + i, n0 = none[k], n1 = none[k + 1], n2 = none[k + nx], n3 = none[k + nx + 1];
    flag[c] = n0 === n1 && n0 === n2 && n0 === n3 ? n0 : 3;
    err[c] = Math.max(sd[k], sd[k + 1], sd[k + nx], sd[k + nx + 1]) / 4 + 2 / 3600;
  }
  const o = { rise: 0, set: 0, X: 0 }, which = mode === 'rise' ? 1 : 2;
  const at = (lat, lon, out) => {
    _dlFastAt(T, lat, lon, o, which);
    out.none = o.X <= -1 ? 1 : o.X >= 1 ? 2 : 0;
    out.v = which === 1 ? o.rise : o.set;
    return out;
  };
  return (L[mode] = { nx, ny, v, err, flag, at });
}
