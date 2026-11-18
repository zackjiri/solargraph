// ─── Daylight layer on the SELECT globe ─────────────────────────────────────────────────────────
// The bands of daylight-model.js (_dlShapes) over the Earth in SELECT (_locPick.dl): Day length,
// Sunrise or Sunset (_locPick.dlMode) in the base _locPick.dlBase ('utc', 'location', 'local'; the
// local base per pixel, see _locPickDlDrawLocal). Drawn by _locPickDraw over the disc and the light
// pollution, under the graticule, the pin and the wave; nothing while the time zones' data (which
// the date and the Location base need) is still loading, as the date would be a guess.
//
// The controls (the second half of the file): the button (_locPickDlSet), the legend's mode, base and
// labels toggles and its cells (_locPickDlLegendSync), the head's line (_locPickDlHint); the layer, its
// mode, base and labels kept in _locPick while the page is open. A change of the date or of the
// Location's offset redraws: outside Solargraph a look on every frame while the layer shows (_locPickDlWatch, as the
// time zones' _locPickWatch), in Solargraph (the Custom date, the Location's fields) after the input.
//
// Fill: on a canvas the size of the disc's buffer (_locPickBuffer) the whole disc in the lowest
// band's colour, then each level's region (v >= level) in the colour of the band above it, the
// levels ascending, each as one 'evenodd' path of its rings; in Sunrise and Sunset the polar day and
// night in the palette's end colours with a light hatching; the canvas laid over the disc once at
// LOC_PICK_DL_ALPHA. The bands picked in the legend (_locPick.dlHi: a band, a range of bands from an
// end cell, or a polar area) keep that alpha, the rest drop to LOC_PICK_DL_DIM_ALPHA. Lines: every
// level's rings at 1 px; border edges of the grid (lon +-180, lat +-90) are not lines. Labels over
// the graticule (_locPickDlDrawLabels): where the lines cross meridians (Day length) or parallels
// (Sunrise, Sunset) through and beside the view's centre (_locPickDlLabels). The view's paths and labels are kept until the view or the shapes change.
// The labels' kind (_locPick.dlLabels): 'edges' those, 'cities' instead a tag with the value after the
// names of the places layer and under the Location's pin (see 'Cities' below).
//
// Clipping to the visible hemisphere (_locPickDlRingInto): a ring's region is on its LEFT (seen
// from outside the Earth, which the orthographic view keeps). A ring that crosses the limb is cut
// into its visible runs, each from an entry to an exit point on the limb; from each exit the path
// follows the limb counter-clockwise (seen from outside: the disc and the region both on the left)
// to the first entry of the same ring, then that entry's run, until it closes. The result is the
// ring's left side within the disc. A ring wholly in view is its own polygon, plus the whole disc
// when its left side is the outside (a hole). A ring wholly hidden is the whole disc when its left
// side holds the view centre (the planar winding number in lon/lat, which is exact for these
// rings), else nothing. 'evenodd' over a level's rings then gives the level's region XOR the parity
// of its clockwise rings in the lon/lat plane (the left sides of the clockwise ones are their
// outsides), so the whole disc is added once more when that count is odd.
const LOC_PICK_DL_ALPHA = 0.55;         // as the light pollution (LOC_PICK_LP_ALPHA)
const LOC_PICK_DL_DIM_ALPHA = 0.15;     // the other bands while one is picked in the legend
const LOC_PICK_DL_LABEL_Z = 0.15;       // a label only where the line is this far in front of the limb
const LOC_PICK_DL_HALF_GAP_PX = 40;     // a half-hour label only with the next line this far
// a point this close to the limb counts as in front: the poles and the date line's seam lie on the
// limb exactly in some views, and rounding would scatter them to both sides
const LOC_PICK_DL_Z_EPS = 1e-9;
function _locPickDlZ(X, k, c) {
  const z = X[3 * k] * c[0] + X[3 * k + 1] * c[1] + X[3 * k + 2] * c[2];
  return z > -LOC_PICK_DL_Z_EPS && z < LOC_PICK_DL_Z_EPS ? LOC_PICK_DL_Z_EPS : z;
}
const LOC_PICK_DL_POLAR = { day: [245, 214, 58], night: [11, 31, 77] };   // the palette's ends
let _locPickDlCache = null;   // { key, mode, off, levels: [{ level, rings, band }], below, none }
let _locPickDlLoading = false;
let _locPickDlMeasure = null; // a context to measure the labels with
let _locPickDlOff = null;     // the fill's canvas
let _locPickDlGeomC = null;   // the view's paths: { key, regs, paths, polar, lines }
let _locPickDlLabelC = null;  // the view's labels: { key, out }
const LOC_PICK_DL_THROTTLE_MS = 150;   // the shapes made at most this often while the date keeps changing
let _locPickDlMadeAt = -Infinity;      // when the shapes were last made (performance.now)
let _locPickDlTimer = 0;               // the redraw asked for when a held-back date's time is up
let _locPickDlDrawnDate = null;        // the date of the shapes drawn last ({ year, month, day, label }), null for none
let _locPickDlShownKey = null;         // the key (_locPickDlWant) of what the last draw showed
const LOC_PICK_DL_PARALLEL_STEP = 30;   // rise and set: the labels' parallels, the centre's and this far either side
const LOC_PICK_DL_PARALLEL_MAX = 60;    // ... kept within this latitude, clear of the polar day and night

// What the layer should show now: the mode, the base's offset, the date and their key; local: the
// base drawn per pixel with reps, an offset of each remainder (_locPickDlLocalReps); mb: the mode and
// base (a change of them is never held back)
function _locPickDlWant() {
  const mode = _locPick.dlMode, base = mode === 'length' ? '' : _locPick.dlBase;
  const info = _dlLocationOffsetInfo(), off = base === 'location' ? info.h : 0, D = _dlDate(info);
  const reps = base === 'local' && _tzGrid.data ? _locPickDlLocalReps() : null;
  return { mode, off, D, local: base === 'local', reps, mb: mode + '|' + base, key: [mode, base, off, D.year, D.month, D.day, reps].join('|') };
}
// The layer's shapes for the current date, mode and base, or null when it draws nothing. While the
// date (or the Location's offset) keeps changing, the shapes are made at most every
// LOC_PICK_DL_THROTTLE_MS and the last ones kept meanwhile; a redraw is asked for when the time is up
// (the frame watcher, _locPickDlWatch, asks too), so the last date is drawn as soon as it is let be
function _locPickDlState() {
  if (!_locPick.dl || _locPick.ecl) return null;
  if (!_locPickDlLoadZones()) return null;   // the date and the Location's offset wait for the zones
  const W = _locPickDlWant();
  const reps = W.reps, C = _locPickDlCache;
  if (C && C.key === W.key) return C;
  const wait = LOC_PICK_DL_THROTTLE_MS - (performance.now() - _locPickDlMadeAt);
  if (C && C.mb === W.mb && wait > 0) { _locPickDlLater(wait); return C; }
  const { mode, off, D } = W;
  if (reps) {   // the local base: the levels of every offset in use
    const levels = [];
    for (const o of reps) for (const L of _dlShapes(mode, D, o).levels) levels.push({ level: L.level, rings: L.rings.map(_locPickDlRing), band: null });
    levels.sort((a, b) => a.level - b.level);
    _locPickDlMadeAt = performance.now();
    return (_locPickDlCache = { key: W.key, mb: W.mb, mode, off: 0, D, step: DL_MODES[mode].step, levels, below: null, none: null, local: true });
  }
  const S = _dlShapes(mode, D, off), step = DL_MODES[mode].step;
  const band = (vUT) => _dlBand(mode, mode === 'length' ? vUT : _dlClock(vUT, off));
  const prep = (rings) => rings.map(_locPickDlRing);
  const levels = S.levels.map(L => ({ level: L.level, rings: prep(L.rings), band: band(L.level + step / 2) }));
  const below = levels.length ? band(levels[0].level - step / 2) : band(_dlGrid(mode, D).min);
  const none = mode === 'length' ? null : { day: prep(S.none.day), night: prep(S.none.night) };
  _locPickDlMadeAt = performance.now();
  return (_locPickDlCache = { key: W.key, mb: W.mb, mode, off, D, step, levels, below, none });
}
// Whether the zones' data is in; asks for it once while not (a failed load is asked again later)
function _locPickDlLoadZones() {
  if (_tzGrid.data) return true;
  if (!_locPickDlLoading) {
    _locPickDlLoading = true;
    _tzLoad().then((g) => { _locPickDlLoading = false; if (g) _locPickRequest(); }).catch(() => { _locPickDlLoading = false; });
  }
  return false;
}
// Whether the disc should keep the offset, latitude and longitude of each pixel (_locPickDrawEarth):
// the layer shows Sunrise or Sunset in the local base
function _locPickDlNeedsZones() {
  if (!_locPick.dl || _locPick.ecl || _locPick.dlMode === 'length' || _locPick.dlBase !== 'local') return false;
  _locPickDlLoadZones();
  return true;
}
// One offset of each remainder modulo half an hour among the offsets in use (the zones' and the
// nautical ones, _locPickOffsetList): the UT levels k * 0.5 - o of every offset o in use
function _locPickDlLocalReps() {
  const vals = _locPickOffsetList(_tzModeOffsets(_tzGrid.data)).values, seen = new Map();
  for (const o of vals) {
    const r = Math.round((((-o % 0.5) + 0.5) % 0.5) * 3600);
    if (!seen.has(r)) seen.set(r, o);
  }
  return [...seen.values()].sort((a, b) => a - b);
}
function _locPickDlLater(ms) {
  if (_locPickDlTimer) return;
  _locPickDlTimer = setTimeout(() => { _locPickDlTimer = 0; if (_locPick.open && _locPick.dl) _locPickRequest(); }, Math.ceil(ms) + 1);
}
// A ring ready to draw: unit vectors, its border edges (edge k from point k to k + 1) and whether it
// runs clockwise in the lon/lat plane (for the lines); for the fill fx, the same curve on the sphere
// without the steps that go nowhere there: the pole rows (one point) and a walk up the date line's
// seam that comes back down its other side (both sides are one line), else a cap round a pole would
// leave the limb and come back at the same point, and which way round the limb to go would be down
// to rounding. Fewer than 3 points left: the ring has no extent on the sphere (fx null).
function _locPickDlRing(ring) {
  const n = ring.length, xyz = new Float64Array(3 * n), border = new Uint8Array(n);
  let area = 0;
  for (let k = 0; k < n; k++) {
    const p = ring[k], q = ring[(k + 1) % n], v = _locPickVec(p[0], p[1]);
    xyz[3 * k] = v[0]; xyz[3 * k + 1] = v[1]; xyz[3 * k + 2] = v[2];
    area += p[0] * q[1] - q[0] * p[1];
    if ((Math.abs(p[0]) === 180 && p[0] === q[0]) || (Math.abs(p[1]) === 90 && p[1] === q[1])) border[k] = 1;
  }
  const st = [], same = (a, b) => Math.abs(xyz[3 * a] - xyz[3 * b]) < 1e-12 && Math.abs(xyz[3 * a + 1] - xyz[3 * b + 1]) < 1e-12 && Math.abs(xyz[3 * a + 2] - xyz[3 * b + 2]) < 1e-12;
  for (let k = 0; k < n; k++) {
    if (st.length && same(st[st.length - 1], k)) continue;
    if (st.length > 1 && same(st[st.length - 2], k)) { st.pop(); continue; }
    st.push(k);
  }
  // round the ring's start: the same steps across the join
  let a = 0, b = st.length;
  for (;;) {
    if (b - a > 1 && same(st[a], st[b - 1])) { b--; continue; }
    if (b - a > 2 && same(st[a + 1], st[b - 1])) { a++; b--; continue; }
    if (b - a > 2 && same(st[a], st[b - 2])) { a++; b--; continue; }
    break;
  }
  let fx = null;
  if (b - a >= 3) {
    fx = new Float64Array(3 * (b - a));
    for (let k = a; k < b; k++) fx.set(xyz.subarray(3 * st[k], 3 * st[k] + 3), 3 * (k - a));
  }
  return { ll: ring, xyz, border, fx, cw: area < 0 };
}
// The planar winding number of ring R round (lon, lat)
function _locPickDlWinding(R, lon, lat) {
  const r = R.ll, n = r.length;
  let w = 0;
  for (let k = 0; k < n; k++) {
    const a = r[k], b = r[(k + 1) % n];
    if (a[1] <= lat) { if (b[1] > lat && (b[0] - a[0]) * (lat - a[1]) - (lon - a[0]) * (b[1] - a[1]) > 0) w++; }
    else if (b[1] <= lat && (b[0] - a[0]) * (lat - a[1]) - (lon - a[0]) * (b[1] - a[1]) < 0) w--;
  }
  return w;
}
// Whether the view centre lies on the left of ring R (its region)
function _locPickDlLeftOfCentre(R) {
  const lon = Math.max(-179.9999, Math.min(179.9999, _locPick.lon0)), lat = Math.max(-89.9999, Math.min(89.9999, _locPick.lat0));
  return _locPickDlWinding(R, lon, lat) + (R.cw ? 1 : 0) === 1;
}
function _locPickDlDisc(P, V) {
  P.moveTo(V.cx + V.R, V.cy);
  P.arc(V.cx, V.cy, V.R, 0, Math.PI * 2);
  P.closePath();
}
// The point where the edge a -> b (unit vectors, z[a] and z[b] of opposite sign) meets the limb,
// on the screen: [x, y, angle]
function _locPickDlLimbPoint(V, X, a, b, za, zb) {
  const t = za / (za - zb), c = V.c;
  let p0 = X[3 * a] + t * (X[3 * b] - X[3 * a]), p1 = X[3 * a + 1] + t * (X[3 * b + 1] - X[3 * a + 1]), p2 = X[3 * a + 2] + t * (X[3 * b + 2] - X[3 * a + 2]);
  const d = p0 * c[0] + p1 * c[1] + p2 * c[2];
  p0 -= d * c[0]; p1 -= d * c[1]; p2 -= d * c[2];
  const u = p0 * V.e[0] + p1 * V.e[1] + p2 * V.e[2], v = p0 * V.n[0] + p1 * V.n[1] + p2 * V.n[2], l = Math.hypot(u, v) || 1;
  const x = V.cx + V.R * u / l, y = V.cy - V.R * v / l;
  return [x, y, Math.atan2(y - V.cy, x - V.cx)];
}
// Ring R's left side within the visible disc, appended to path P (see the head of the file):
// 0 nothing, 1 the whole disc, 2 a shape
function _locPickDlRingInto(P, V, R) {
  if (!R.fx) { if (!_locPickDlLeftOfCentre(R)) return 0; _locPickDlDisc(P, V); return 1; }
  const X = R.fx, n = X.length / 3, c = V.c, e = V.e, nn = V.n;
  const z = new Float64Array(n), sx = new Float64Array(n), sy = new Float64Array(n);
  let vis = 0, hid = -1;
  for (let k = 0; k < n; k++) {
    const p0 = X[3 * k], p1 = X[3 * k + 1], p2 = X[3 * k + 2];
    z[k] = _locPickDlZ(X, k, c);
    sx[k] = V.cx + V.R * (p0 * e[0] + p1 * e[1] + p2 * e[2]);
    sy[k] = V.cy - V.R * (p0 * nn[0] + p1 * nn[1] + p2 * nn[2]);
    if (z[k] >= 0) vis++; else if (hid < 0) hid = k;
  }
  if (!vis) { if (!_locPickDlLeftOfCentre(R)) return 0; _locPickDlDisc(P, V); return 1; }
  if (vis === n) {
    let area = 0;
    P.moveTo(sx[0], sy[0]);
    for (let k = 1; k < n; k++) P.lineTo(sx[k], sy[k]);
    P.closePath();
    for (let k = 0, j = n - 1; k < n; j = k++) area += (sx[j] - V.cx) * (V.cy - sy[k]) - (sx[k] - V.cx) * (V.cy - sy[j]);
    if (area < 0) _locPickDlDisc(P, V);   // clockwise seen from outside: its left side is the outside
    return 2;
  }
  // the visible runs, from a hidden point round to it
  const runs = [];
  let cur = null;
  for (let s = 1; s <= n; s++) {
    const a = (hid + s - 1) % n, b = (hid + s) % n;
    if (z[a] < 0 && z[b] >= 0) {
      const E = _locPickDlLimbPoint(V, X, a, b, z[a], z[b]);
      cur = { xs: [E[0], sx[b]], ys: [E[1], sy[b]], a0: E[2], a1: 0 };
    } else if (z[a] >= 0 && z[b] >= 0) { cur.xs.push(sx[b]); cur.ys.push(sy[b]); }
    else if (z[a] >= 0 && z[b] < 0) {
      const Q = _locPickDlLimbPoint(V, X, a, b, z[a], z[b]);
      cur.xs.push(Q[0]); cur.ys.push(Q[1]); cur.a1 = Q[2];
      runs.push(cur); cur = null;
    }
  }
  // from each exit counter-clockwise (seen from outside; the canvas angle decreasing) to the first entry
  const TAU = Math.PI * 2;
  for (const r of runs) {
    let best = -1, bd = Infinity;
    for (let m = 0; m < runs.length; m++) {
      let d = (r.a1 - runs[m].a0) % TAU; if (d < 0) d += TAU;
      if (d < bd) { bd = d; best = m; }
    }
    r.next = best; r.sweep = bd;
  }
  const used = new Uint8Array(runs.length);
  for (let m0 = 0; m0 < runs.length; m0++) {
    if (used[m0]) continue;
    let m = m0;
    P.moveTo(runs[m].xs[0], runs[m].ys[0]);
    while (!used[m]) {
      used[m] = 1;
      const r = runs[m];
      for (let k = 1; k < r.xs.length; k++) P.lineTo(r.xs[k], r.ys[k]);
      P.arc(V.cx, V.cy, V.R, r.a1, r.a1 - r.sweep, true);
      m = r.next;
    }
    P.closePath();
  }
  return 2;
}
// Ring as a Path2D clipped to the visible disc, or null when nothing of its region is in view
function _locPickDlRingPath(V, ring) {
  const P = new Path2D(), R = ring.xyz ? ring : _locPickDlRing(ring);
  const X = R.fx, n = X ? X.length / 3 : 0;
  let vis = false;
  for (let k = 0; k < n && !vis; k++) vis = _locPickDlZ(X, k, V.c) >= 0;
  if (!vis && !_locPickDlLeftOfCentre(R)) return null;
  _locPickDlRingInto(P, V, R);
  return P;
}
// A region (a level's rings, or the polar day's or night's) as one 'evenodd' path P within the disc;
// full or empty when no ring shows a shape in the view and the discs add up to the whole or none
function _locPickDlRegion(V, rings) {
  const P = new Path2D();
  let odd = 0, shape = false;
  for (const R of rings) {
    const r = _locPickDlRingInto(P, V, R);
    if (r === 1) odd ^= 1; else if (r === 2) shape = true;
    if (R.cw) odd ^= 1;
  }
  if (odd) _locPickDlDisc(P, V);
  return { P, full: !shape && !!odd, empty: !shape && !odd };
}
// The bands picked in the legend (_locPick.dlHi's hover, else its pin): a band's number, a range of
// bands { from, to } (inclusive; the legend's end cells), 'day' or 'night' (polar), or null
function _locPickDlHiBand() {
  const H = _locPick.dlHi, h = H ? H.hover ?? H.pin : null;
  return h === undefined ? null : h;
}
// Whether band b (a number, 'day' or 'night') is among the picked hi (not null)
function _locPickDlHiHas(hi, b) {
  if (typeof hi === 'string' || typeof b === 'string') return hi === b;
  return typeof hi === 'number' ? b === hi : b >= hi.from && b <= hi.to;
}
// A pick as text, to compare two picks: '' for none, '7', '0-3', 'day'
function _locPickDlHiKey(h) {
  return h === null || h === undefined ? '' : typeof h === 'object' ? h.from + '-' + h.to : String(h);
}
function _locPickDlRgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
// The light hatching over the polar areas, its pitch steady on the screen (LOC_PICK_ZONE_HATCH_PX)
let _locPickDlHatchTile = null;   // { q, t }
function _locPickDlHatch(ctx, q) {
  const p = Math.max(3, Math.round(LOC_PICK_ZONE_HATCH_PX * q));
  if (_locPickDlHatchTile && _locPickDlHatchTile.q === q) return _locPickDlPattern(ctx, _locPickDlHatchTile.t, q);
  const t = document.createElement('canvas');
  t.width = t.height = p;
  const c = t.getContext('2d');
  c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = Math.max(1, q);
  c.beginPath();
  for (const o of [-p, 0, p]) { c.moveTo(o, p); c.lineTo(o + p, 0); }
  c.stroke();
  _locPickDlHatchTile = { q, t };
  return _locPickDlPattern(ctx, t, q);
}
function _locPickDlPattern(ctx, t, q) {
  const pat = ctx.createPattern(t, 'repeat');
  pat.setTransform(new DOMMatrix().scale(1 / q));
  return pat;
}
function _locPickDlDraw(ctx, V, w, h) {
  const S = _locPickDlState();
  _locPickDlDrawnDate = S ? S.D : null;
  _locPickDlShown(S);
  if (!S) return;
  if (S.local) { _locPickDlDrawLocal(ctx, V, S); return; }
  const res = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  const { x0, y0, bw, bh, q } = _locPickBuffer(w, h, res, V);
  if (!(bw > 0 && bh > 0)) return;
  const sw = Math.max(1, Math.ceil(bw * q)), sh = Math.max(1, Math.ceil(bh * q));
  const off = _locPickDlOff || (_locPickDlOff = document.createElement('canvas'));
  if (off.width !== sw || off.height !== sh) { off.width = sw; off.height = sh; }
  const o = off.getContext('2d');
  o.setTransform(q, 0, 0, q, -x0 * q, -y0 * q);
  // the levels from the highest whose region is the whole view up, without the empty ones
  const G = _locPickDlGeom(V, w, h, S), regs = G.regs, paths = G.paths, polar = G.polar;
  let k0 = -1;
  regs.forEach((r, k) => { if (r.full) k0 = k; });
  o.fillStyle = _locPickDlRgb(_dlColor(S.mode, k0 < 0 ? S.below : S.levels[k0].band));
  o.fillRect(x0, y0, bw, bh);
  for (let k = k0 + 1; k < regs.length; k++) {
    if (regs[k].empty) continue;
    o.fillStyle = _locPickDlRgb(_dlColor(S.mode, S.levels[k].band)); o.fill(paths[k], 'evenodd');
  }
  if (polar) {
    o.fillStyle = _locPickDlRgb(LOC_PICK_DL_POLAR.day); o.fill(polar.day, 'evenodd');
    o.fillStyle = _locPickDlRgb(LOC_PICK_DL_POLAR.night); o.fill(polar.night, 'evenodd');
    o.fillStyle = _locPickDlHatch(o, q);
    o.fill(polar.day, 'evenodd'); o.fill(polar.night, 'evenodd');
  }
  // over the disc: all at the layer's alpha, or the rest dimmed and the picked band brought up to
  // it (1 - (1 - 0.15)(1 - a) = 0.55) within its region
  const hi = _locPickDlHiBand();
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = hi === null ? LOC_PICK_DL_ALPHA : LOC_PICK_DL_DIM_ALPHA;
  ctx.drawImage(off, x0, y0, sw / q, sh / q);
  if (hi !== null) {   // the picked bands' regions: each a level's region less the next one's, 'evenodd'
    // (two neighbours share a level's path, which then drops out: their union)
    const H = new Path2D();
    if (hi === 'day' || hi === 'night') { if (polar) H.addPath(polar[hi]); }
    else {
      for (let k = 0; k <= S.levels.length; k++) {
        if (!_locPickDlHiHas(hi, k ? S.levels[k - 1].band : S.below)) continue;
        if (k) H.addPath(paths[k - 1]); else _locPickDlDisc(H, V);
        if (k < S.levels.length) H.addPath(paths[k]);
      }
    }
    ctx.save();
    ctx.clip(H, 'evenodd');
    if (polar && hi !== 'day' && hi !== 'night') {   // a time's band: not where the polar day or night lies over it
      const C = new Path2D(); _locPickDlDisc(C, V); C.addPath(polar.day); C.addPath(polar.night);
      ctx.clip(C, 'evenodd');
    }
    ctx.globalAlpha = 1 - (1 - LOC_PICK_DL_ALPHA) / (1 - LOC_PICK_DL_DIM_ALPHA);
    ctx.drawImage(off, x0, y0, sw / q, sh / q);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // the lines
  const lt = document.body.classList.contains('light');
  ctx.lineWidth = 1; ctx.strokeStyle = lt ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)';
  ctx.stroke(G.lines);
  ctx.restore();
}
// The view's paths for shapes S: the levels' regions, the polar day's and night's, the lines; kept
// while the view and the shapes stay (a redraw for another layer or the wave reuses them)
function _locPickDlGeom(V, w, h, S) {
  const key = [S.key, _locPick.lon0, _locPick.lat0, _locPick.zoom, w, h].join('|');
  if (_locPickDlGeomC && _locPickDlGeomC.key === key) return _locPickDlGeomC;
  const regs = S.levels.map(L => _locPickDlRegion(V, L.rings));
  const polar = S.none ? { day: _locPickDlRegion(V, S.none.day).P, night: _locPickDlRegion(V, S.none.night).P } : null;
  const lines = new Path2D();
  for (const L of S.levels) for (const R of L.rings) _locPickDlLineInto(lines, V, R);
  if (S.none) for (const R of S.none.day.concat(S.none.night)) _locPickDlLineInto(lines, V, R);
  return (_locPickDlGeomC = { key, regs, paths: regs.map(r => r.P), polar, lines });
}
// ─── The local base, per pixel ───────────────────────────────────────────────────────────────────
// Sunrise and Sunset in each place's own time: the band jumps at the zones' borders, which the app
// has only as a raster, so the layer is an image over the disc's buffer, like the zones' veil
// (_locPickDrawVeil). The disc keeps per pixel its offset's index, latitude and longitude
// (_locPick.veilSrc, built while _locPickDlNeedsZones); each pixel's band is its UT value bilinear
// from the grid (_dlLocalSrc) plus its offset on the dial, the model itself where the value lies
// closer to a band edge than the cell's error bound or where the cell touches the polar day or
// night. Band codes: 0..47 the half hours, 48 polar day, 49 polar night, 255 off the disc.
// Fill: the band's colour, the polar areas in the palette's ends with the hatching's stripes
// lightened (LOC_PICK_ZONE_HATCH_PX); lines: both pixels where the band differs from the right or
// the lower neighbour, the band's colour toward white (toward black in the light theme), not while
// moving (the buffer is coarse then, as the zones' lines); the image laid over the disc at
// LOC_PICK_DL_ALPHA, the picked bands' pixels (and the lines) at full alpha in the image and the rest
// at LOC_PICK_DL_DIM_ALPHA / LOC_PICK_DL_ALPHA. Made again when the disc (its gen), the shapes' key
// (date, mode and so the palette, offsets) or the theme change; a pick rewrites the alpha alone.
let _locPickDlLocalC = null;   // { key, band, ln, img, cv, hi (_locPickDlHiKey), lines, hatched, fallback, ms, msBands }
const LOC_PICK_DL_LINE_MIX = 0.5;   // a line pixel: this far from the band's colour toward white or black
function _locPickDlDrawLocal(ctx, V, S) {
  const Z = _locPick.veilSrc;
  if (!Z || !Z.la) return;
  const lt = document.body.classList.contains('light'), key = [S.key, Z.gen, lt].join('|');
  const hi = _locPickDlHiBand();
  let B = _locPickDlLocalC;
  if (!B || B.key !== key) B = _locPickDlLocalC = _locPickDlLocalMake(S, Z, lt, key, hi);
  else if (B.hi !== _locPickDlHiKey(hi)) _locPickDlLocalAlpha(B, hi);
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = LOC_PICK_DL_ALPHA;
  ctx.drawImage(B.cv, Z.x0, Z.y0, Z.sw / Z.q, Z.sh / Z.q);
  ctx.restore();
}
// The band codes picked by hi (_locPickDlHiBand): 1 for each picked of 0..49, null with none
function _locPickDlLocalPicked(hi) {
  if (hi === null) return null;
  const m = new Uint8Array(50);
  for (let b = 0; b < 50; b++) m[b] = _locPickDlHiHas(hi, b < 48 ? b : b === 48 ? 'day' : 'night') ? 1 : 0;
  return m;
}
// The image's alpha for the pick hi: the picked bands and the lines whole, the rest dimmed
function _locPickDlLocalAlpha(B, hi) {
  const px = B.img.data, band = B.band, ln = B.ln, dim = Math.round(255 * LOC_PICK_DL_DIM_ALPHA / LOC_PICK_DL_ALPHA);
  const m = _locPickDlLocalPicked(hi);
  for (let k = 0, o = 3; k < band.length; k++, o += 4) {
    const b = band[k];
    px[o] = b === 255 ? 0 : !m || m[b] || ln[k] ? 255 : dim;
  }
  B.cv.getContext('2d').putImageData(B.img, 0, 0);
  B.hi = _locPickDlHiKey(hi);
}
function _locPickDlLocalMake(S, Z, lt, key, hi) {
  const t0 = performance.now(), src = _dlLocalSrc(S.mode, S.D);
  const { sw, sh, oi, la, lo, list, q } = Z, n = sw * sh, nx = src.nx, v = src.v, err = src.err, flag = src.flag, at = src.at;
  const offs = Float64Array.from(list, (o) => o * 2), band = new Uint8Array(n).fill(255), out = { v: 0, none: 0 };
  let fallback = 0;
  // per pixel t = (UT + offset) * 2 on the 0..48 dial: the band its integer part, a band edge
  // (fr * 0.5 h away) its fractional part
  for (let k = 0; k < n; k++) {
    const oc = oi[k];
    if (oc === 255) continue;
    const lat = la[k], lon = lo[k], fx = lon + 180, fy = (lat + 90) * 2;
    let i = fx | 0, j = fy | 0;
    if (i > nx - 2) i = nx - 2; if (j > nx - 2) j = nx - 2;   // the grid is square (nx = ny)
    const c = j * (nx - 1) + i, f = flag[c];
    if (f === 1 || f === 2) { band[k] = 47 + f; continue; }
    let t, exact = f === 3;
    if (!exact) {
      const ax = fx - i, ay = fy - j, g = j * nx + i, a = v[g], b = v[g + 1], d = v[g + nx];
      t = (a + (b - a) * ax + (d - a + (a - b - d + v[g + nx + 1]) * ax) * ay) * 2 + offs[oc];
      while (t < 0) t += 48;
      while (t >= 48) t -= 48;
      const fr = t - (t | 0);
      exact = (fr < 0.5 ? fr : 1 - fr) * 0.5 < err[c];
    }
    if (exact) {
      at(lat, lon, out); fallback++;
      if (out.none) { band[k] = 47 + out.none; continue; }
      t = out.v * 2 + offs[oc];
      while (t < 0) t += 48;
      while (t >= 48) t -= 48;
    }
    const b = t | 0;
    band[k] = b > 47 ? 47 : b;
  }
  const t1 = performance.now();
  // the image in one pass: the lines (both pixels of a change toward the right or the lower
  // neighbour, marked ahead), the hatching's stripes, the colours as packed RGBA
  const pal = new Uint32Array(50 * 4), toward = lt ? 0 : 255, mix = LOC_PICK_DL_LINE_MIX;
  const dim = Math.round(255 * LOC_PICK_DL_DIM_ALPHA / LOC_PICK_DL_ALPHA), picked = _locPickDlLocalPicked(hi);
  for (let b = 0; b < 50; b++) {
    const c = b < 48 ? _dlColor(S.mode, b) : LOC_PICK_DL_POLAR[b === 48 ? 'day' : 'night'];
    const al = !picked || picked[b] ? 255 : dim;
    for (let m = 0; m < 4; m++) {   // plain, hatched, line, hatched line
      let r = c[0], g = c[1], bl = c[2];
      if (m & 1) { r += (255 - r) * 0.7; g += (255 - g) * 0.7; bl += (255 - bl) * 0.7; }
      if (m & 2) { r += (toward - r) * mix; g += (toward - g) * mix; bl += (toward - bl) * mix; }
      pal[4 * b + m] = (Math.round(r) | Math.round(g) << 8 | Math.round(bl) << 16 | (m & 2 ? 255 : al) << 24) >>> 0;
    }
  }
  const ln = new Uint8Array(n), img = new ImageData(sw, sh), px32 = new Uint32Array(img.data.buffer), lines0 = !Z.moving;
  const pitch = Math.max(3, Math.round(LOC_PICK_ZONE_HATCH_PX * q)), lw = Math.max(1, Math.round(q));
  let lines = 0, hatched = 0;
  for (let j = 0, k = 0; j < sh; j++) for (let i = 0; i < sw; i++, k++) {
    const b = band[k];
    if (b === 255) continue;
    if (lines0) {
      if (i + 1 < sw) { const r = band[k + 1]; if (r !== 255 && r !== b) ln[k] = ln[k + 1] = 1; }
      if (j + 1 < sh) { const r = band[k + sw]; if (r !== 255 && r !== b) ln[k] = ln[k + sw] = 1; }
    }
    let m = 0;
    if (b > 47 && (i + j) % pitch < lw) { m = 1; hatched++; }
    if (ln[k]) { m |= 2; lines++; }
    px32[k] = pal[4 * b + m];
  }
  const cv = (_locPickDlLocalC && _locPickDlLocalC.cv) || document.createElement('canvas');
  if (cv.width !== sw || cv.height !== sh) { cv.width = sw; cv.height = sh; }
  cv.getContext('2d').putImageData(img, 0, 0);
  return { key, band, ln, img, cv, hi: _locPickDlHiKey(hi), lines, hatched, fallback, ms: performance.now() - t0, msBands: t1 - t0 };
}
// The offset [h] of the disc's pixel under canvas point (x, y), null off the disc or without the index
function _locPickDlOffsetAt(x, y) {
  const Z = _locPick.veilSrc;
  if (!Z) return null;
  const i = Math.floor((x - Z.x0) * Z.q), j = Math.floor((y - Z.y0) * Z.q);
  if (i < 0 || j < 0 || i >= Z.sw || j >= Z.sh) return null;
  const k = Z.oi[j * Z.sw + i];
  return k === 255 ? null : Z.list[k];
}
// The labels over the graticule (called by _locPickDraw after it, where the zones' labels go)
function _locPickDlDrawLabels(ctx, V, w, h) {
  if (_locPick.dlLabels === 'cities') { _locPickDlPlaceHere(ctx, V, w, h); return; }
  _locPickDlHereDrawn = null;
  const labels = _locPickDlLabels(V, w, h);
  if (!labels.length) return;
  ctx.save();
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of labels) {
    ctx.fillStyle = 'rgba(7,9,13,0.72)';
    ctx.fillRect(l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0);
    ctx.fillStyle = '#e8eef4';
    ctx.fillText(l.text, l.x, l.y + 0.5);
  }
  ctx.restore();
}
// ─── Cities: the values at the places ────────────────────────────────────────────────────────────
// The places layer (render-locplaces.js) asks the hook (_locPlacesTagHook) for a tag per place, in
// its order of importance; a place gets one only LOC_PICK_DL_TAG_GAP_PX * (1 - ln zoom / ln 40) px
// (none at the closest zoom) from every tag given before it, the Location's first. The value from the
// exact model on the drawn date at the place, in the base (local: the place's own zone), cut to the
// minute as the head's; in its band's colour, the polar day and night as such in the palette's ends.
// None without the zones' data (no guessed times). Cities turns the places on for the while
// (_locPickDlCitiesSync) and gives back the state before.
const LOC_PICK_DL_TAG_GAP_PX = 90;
const LOC_PICK_DL_TAG_FONT = "bold 10px 'Share Tech Mono', monospace";   // the Location's tag
const LOC_PICK_DL_HERE_DY = 15;   // the Location's tag's centre this far under (or over) the pin
const LOC_PICK_DL_HERE_DX = 8;    // ... or its left edge this far right of the pin
let _locPickDlPlacesWas = null;   // the places shown before Cities turned them on; null while not in Cities
let _locPickDlHereDrawn = null;   // the Location's tag drawn last: { text, rgb, x, y, box }, null for none
let _locPickDlTagC = null;        // the places' values: { key, map: row -> { text, rgb } }
// The tag at (lat, lon) on date D for mode, the clock offset off (rise and set)
function _locPickDlTagValue(lat, lon, D, mode, off) {
  const e = _solarEventsAt(lat, lon, D.year, D.month, D.day), cut = (v) => Math.floor(v * 60 + 1e-9) / 60;
  if (e.polarDay || e.polarNight) { const k = e.polarDay ? 'day' : 'night'; return { text: 'polar ' + k, rgb: LOC_PICK_DL_POLAR[k] }; }
  if (mode === 'length') return { text: _dlFmt(mode, cut(e.lenH)).replace(/ (\d+) min$/, (m, n) => ' ' + n.padStart(2, '0')), rgb: _dlColor(mode, _dlBand(mode, e.lenH)) };
  const c = _dlClock(mode === 'rise' ? e.riseUT : e.setUT, off);
  return { text: _dlFmt(mode, cut(c)), rgb: _dlColor(mode, _dlBand(mode, c)) };
}
const _locPickDlTagHook = {
  D: null, at: [], gap: 0, mode: 'length', base: '', off: 0,
  // the frame's date, mode and base; the Location's tag placed clear of the names (names, blocked:
  // the boxes of the places' names and of the window's controls), first among the given and kept clear of
  begin(V, names, blocked) {
    const T = _locPickDlTagHook, D = _locPickDlDrawnDate, H = _locPickDlHereDrawn;
    T.D = null; T.at = [];
    if (!_locPick.dl || _locPick.ecl || !D || !_tzGrid.data) return null;
    T.D = D; T.mode = _locPick.dlMode; T.base = T.mode === 'length' ? '' : _locPick.dlBase;
    T.off = T.base === 'location' ? _locPickDlBaseOffset() : 0;
    T.gap = LOC_PICK_DL_TAG_GAP_PX * Math.max(0, 1 - Math.log(_locPick.zoom) / Math.log(LOC_PICK_ZOOM_MAX));
    const ms = T.base === 'local' ? _tzModeInstant() : null;   // the zones' offsets (DST) at the mode's moment
    const key = [D.year, D.month, D.day, T.mode, T.base, T.off, ms === null ? '' : Math.floor(ms / 3600000)].join('|');
    if (!_locPickDlTagC || _locPickDlTagC.key !== key) _locPickDlTagC = { key, map: new Map() };
    if (!H) return null;
    _locPickDlHereFit(H, blocked.concat(names));
    T.at.push([H.x, H.y]);
    return [H.box];
  },
  tag(r, x, y) {
    const T = _locPickDlTagHook, g2 = T.gap * T.gap;
    if (!T.D) return null;
    for (const a of T.at) if ((a[0] - x) * (a[0] - x) + (a[1] - y) * (a[1] - y) < g2) return null;
    let v = _locPickDlTagC.map.get(r);
    if (!v) {
      v = _locPickDlTagValue(r[2], r[3], T.D, T.mode, T.base === 'local' ? _dlOffsetInfoAt(r[2], r[3]).h : T.off);
      _locPickDlTagC.map.set(r, v);
    }
    return { text: v.text, rgb: v.rgb, x, y };
  },
  took(t) { _locPickDlTagHook.at.push([t.x, t.y]); },
};
// The Location's tag by its pin (Cities): its value and a first place clear of the window's controls
// and the canvas's edges (_locPickDlHereFit); placed again clear of the places' names once they are
// laid out (the hook's begin), before their tags; drawn after them and the pin (_locPickDlDrawHere),
// on top
function _locPickDlPlaceHere(ctx, V, w, h) {
  _locPickDlHereDrawn = null;
  const D = _locPickDlDrawnDate;
  if (!D || !_tzGrid.data || _locPick.ecl) return;
  const [la, lo] = _dlLocation(), s = _locPickProject(V, _locPickVec(lo, la));
  if (s.z < 0) return;
  const mode = _locPick.dlMode, base = _locPick.dlBase;
  const off = mode === 'length' || base === 'utc' ? 0 : base === 'location' ? _locPickDlBaseOffset() : _dlOffsetInfoAt(la, lo).h;
  const t = _locPickDlTagValue(la, lo, D, mode, off), f = LOC_PICK_DL_TAG_FONT;
  const pw = _locPlacesWidth(ctx, f, t.text) + 2 * LOC_PLACES_TAG_PAD;
  _locPickDlHereFit(_locPickDlHereDrawn = { text: t.text, rgb: t.rgb, x: s.x, y: s.y, pw, w, h }, _locPlacesKeepClear(ctx.canvas));
}
// The Location's tag H: below its pin, else above, else right of it, the first whose box is within
// the canvas and clear of the boxes; below when none is (H.fit 'below', 'above', 'right', 'none')
function _locPickDlHereFit(H, boxes) {
  const dy = LOC_PICK_DL_HERE_DY, c = H.x - H.pw / 2;
  const tries = [['below', c, H.y + dy], ['above', c, H.y - dy], ['right', H.x + LOC_PICK_DL_HERE_DX, H.y]];
  const at = (x0, yc) => ({ x0: x0 - 2, y0: yc - 8, x1: x0 + H.pw + 2, y1: yc + 8 });
  const clear = (b) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= H.w && b.y1 <= H.h && !boxes.some(o => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
  let pick = tries.find(([, x0, yc]) => clear(at(x0, yc)));
  H.fit = pick ? pick[0] : 'none';
  if (!pick) pick = tries[0];
  H.x0 = pick[1]; H.yc = pick[2]; H.box = at(pick[1], pick[2]);
}
function _locPickDlDrawHere(ctx) {
  const H = _locPickDlHereDrawn;
  if (!H || !_locPick.dl || _locPick.dlLabels !== 'cities') return;
  ctx.save();
  ctx.textBaseline = 'middle';
  _locPlacesDrawTag(ctx, H, LOC_PICK_DL_TAG_FONT, H.x0, H.yc, 1);
  ctx.restore();
}
// The hook and the places with the layer and the labels' kind: in Cities (not on the Eclipse map) the
// places on for the while (not remembered), out of it the state before again (remembered), or the
// one the user chose meanwhile (_locPickDlPlacesChosen). Called on the layer's, the labels' and the
// window's changes (_locPickSetOpen)
function _locPickDlCitiesSync() {
  const on = _locPick.dl && !_locPick.ecl && _locPick.dlLabels === 'cities';
  _locPlacesTagHook = on ? _locPickDlTagHook : null;
  if (on && _locPickDlPlacesWas === null) {
    _locPickDlPlacesWas = _locPlaces.on;
    if (!_locPlaces.on) _locPlacesSetOn(true, true);
  } else if (!on && _locPickDlPlacesWas !== null) {
    const was = _locPickDlPlacesWas;
    _locPickDlPlacesWas = null;
    if (!was && _locPlaces.on) _locPlacesSetOn(false, true);   // the remembered value is still the user's
  }
  _locPickDlLabelsTitle();
  if (!on) _locPickDlHereDrawn = null;
}
// The user turned the places on or off (_locPlacesSetOn): during Cities that is the state it gives back
function _locPickDlPlacesChosen(on) {
  if (_locPickDlPlacesWas !== null) _locPickDlPlacesWas = on;
  _locPickDlLabelsTitle();
}
// The Cities toggle's title: a hint while the places (which show the times) are off in Cities
function _locPickDlLabelsTitle() {
  const b = document.querySelector('#locPickDlLabels [data-labels="cities"]');
  if (!b) return;
  const off = _locPick.dlLabels === 'cities' && typeof _locPlaces !== 'undefined' && !_locPlaces.on;
  const t = off ? 'Times next to the places (turn the places on)' : 'Times next to the places';
  if (b.title !== t) b.title = t;
}
// Ring R's visible line into path P: broken behind the limb (cut at it), no border edges
function _locPickDlLineInto(P, V, R) {
  const X = R.xyz, n = X.length / 3, c = V.c;
  const zAt = (k) => _locPickDlZ(X, k, c);
  const scr = (k) => [V.cx + V.R * (X[3 * k] * V.e[0] + X[3 * k + 1] * V.e[1] + X[3 * k + 2] * V.e[2]),
    V.cy - V.R * (X[3 * k] * V.n[0] + X[3 * k + 1] * V.n[1] + X[3 * k + 2] * V.n[2])];
  let pen = false, za = zAt(0);
  for (let k = 0; k < n; k++) {
    const b = (k + 1) % n, zb = zAt(b);
    if (R.border[k] || (za < 0 && zb < 0)) { pen = false; za = zb; continue; }
    if (za >= 0 && zb >= 0) {
      if (!pen) { const A = scr(k); P.moveTo(A[0], A[1]); pen = true; }
      const B = scr(b); P.lineTo(B[0], B[1]);
    } else if (za >= 0) {
      if (!pen) { const A = scr(k); P.moveTo(A[0], A[1]); }
      const Q = _locPickDlLimbPoint(V, X, k, b, za, zb); P.lineTo(Q[0], Q[1]); pen = false;
    } else {
      const Q = _locPickDlLimbPoint(V, X, k, b, za, zb), B = scr(b);
      P.moveTo(Q[0], Q[1]); P.lineTo(B[0], B[1]); pen = true;
    }
    za = zb;
  }
}
// The labels: where each line crosses a guide, at most one per line and guide (the crossing nearest
// the view's centre), well in front of the limb. Day length's lines run east to west: the guides
// are the view centre's meridian and the meridians 90 deg either side. Sunrise's and Sunset's run
// roughly north to south: the parallel through the view's centre and those
// LOC_PICK_DL_PARALLEL_STEP either side, kept within LOC_PICK_DL_PARALLEL_MAX (clear of the polar
// day and night; one parallel for two that come too close there). The centre's guide first and
// whole hours before half hours; a half hour only with the nearest other line on that guide
// LOC_PICK_DL_HALF_GAP_PX away; each label clear of those placed, the Location's pin and the
// time zones' labels. [{ x, y, text, level, x0, y0, x1, y1 }] in CSS px.
function _locPickDlLabels(V, w, h) {
  const S = _locPickDlState();
  if (!S) return [];
  const pinLL = [lonHemisphere * LONG, hemisphere * LAT];
  const zl = _locPick.zones ? _locPick.zoneLabels : null;
  const key = [S.key, _locPick.lon0, _locPick.lat0, _locPick.zoom, w, h, pinLL, S.local && _locPick.veilSrc ? _locPick.veilSrc.gen : ''].join('|');
  if (_locPickDlLabelC && _locPickDlLabelC.key === key && _locPickDlLabelC.zl === zl) return _locPickDlLabelC.out;
  const byLon = S.mode === 'length', G = [];   // the guides: the coordinate that is fixed along each
  if (byLon) G.push(_locPick.lon0, _locPick.lon0 + 90, _locPick.lon0 - 90);
  else {
    const lim = LOC_PICK_DL_PARALLEL_MAX, st = LOC_PICK_DL_PARALLEL_STEP;
    for (const d of [0, st, -st]) {
      const g = Math.max(-lim, Math.min(lim, _locPick.lat0 + d));
      if (G.every(o => Math.abs(o - g) >= st / 2)) G.push(g);
    }
  }
  const wrap = (d) => { d = (d + 180) % 360; return (d < 0 ? d + 360 : d) - 180; };
  const all = G.map(() => []), cand = [];
  S.levels.forEach((L) => {
    G.forEach((g, gi) => {
      const best = new Map();   // the crossing nearest the centre per offset (the local base's lines are a level and an offset)
      for (const R of L.rings) {
        const r = R.ll, n = r.length;
        for (let k = 0; k < n; k++) {
          if (R.border[k]) continue;
          const a = r[k], b = r[(k + 1) % n];
          let p;
          if (byLon) {
            const da = wrap(a[0] - g), db = wrap(b[0] - g);
            if ((da < 0) === (db < 0) || Math.abs(da - db) > 90) continue;
            p = _locPickProject(V, _locPickVec(g, a[1] + da / (da - db) * (b[1] - a[1])));
          } else {
            const da = a[1] - g, db = b[1] - g;
            if ((da < 0) === (db < 0) || Math.abs(a[0] - b[0]) > 90) continue;
            p = _locPickProject(V, _locPickVec(a[0] + da / (da - db) * (b[0] - a[0]), g));
          }
          if (p.z < LOC_PICK_DL_LABEL_Z) continue;
          let o = S.off;
          if (S.local) {   // a band edge only where the pixel's zone makes the UT level a half hour
            o = _locPickDlOffsetAt(p.x, p.y);
            if (o === null) continue;
            const c = (L.level + o) / S.step;
            if (Math.abs(c - Math.round(c)) > 1e-6) continue;
          }
          all[gi].push(p);
          const was = best.get(o);
          if (!was || p.z > was.z) best.set(o, p);
        }
      }
      for (const [o, p] of best) {
        const clock = byLon ? L.level : Math.round(_dlClock(L.level, o) * 2) / 2 % 24;
        cand.push({ x: p.x, y: p.y, text: byLon ? L.level + ' h' : _dlFmt(S.mode, clock), level: L.level, gi, whole: Number.isInteger(clock) });
      }
    });
  });
  cand.sort((a, b) => a.gi - b.gi || (b.whole ? 1 : 0) - (a.whole ? 1 : 0));
  const M = _locPickDlMeasure || (_locPickDlMeasure = document.createElement('canvas').getContext('2d'));
  M.font = "10px 'Share Tech Mono', monospace";
  const taken = [], out = [], gap = 2;
  const pin = _locPickProject(V, _locPickVec(pinLL[0], pinLL[1]));
  if (pin.z > 0) taken.push({ x0: pin.x - 8, y0: pin.y - 8, x1: pin.x + 8, y1: pin.y + 8 });
  if (zl) for (const l of zl) { const tw = M.measureText(l.text).width + 6; taken.push({ x0: l.x - tw / 2, y0: l.y - 7, x1: l.x + tw / 2, y1: l.y + 7 }); }
  for (const c of cand) {
    if (!c.whole) {
      let dmin = Infinity;
      for (const p of all[c.gi]) { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d > 0.5 && d < dmin) dmin = d; }
      if (dmin < LOC_PICK_DL_HALF_GAP_PX) continue;
    }
    if (c.x < 0 || c.y < 0 || c.x > w || c.y > h) continue;
    const tw = M.measureText(c.text).width + 6;
    const b = { x0: c.x - tw / 2, y0: c.y - 7, x1: c.x + tw / 2, y1: c.y + 7 };
    if (taken.some(t => b.x0 < t.x1 + gap && t.x0 < b.x1 + gap && b.y0 < t.y1 + gap && t.y0 < b.y1 + gap)) continue;
    taken.push(b);
    out.push(Object.assign({ x: c.x, y: c.y, text: c.text, level: c.level }, b));
  }
  _locPickDlLabelC = { key, zl, out };
  return out;
}

// ─── The controls: the button, the legend, the head's line, the redraws ─────────────────────────
// After each draw with the layer on: the legend and, when what is shown changed, the head's line
function _locPickDlShown(S) {
  _locPickDlLegendSync();
  const k = S ? S.key : _locPick.dl && !_locPick.ecl && _tzGrid.data ? _locPickDlWant().key : null;
  if (k !== _locPickDlShownKey) { _locPickDlShownKey = k; _locPickDlInfoSync(_locPick.hover); }
  if (!_locPickDlWatchRaf && _locPickDlWatchOn()) _locPickDlWatchRaf = requestAnimationFrame(_locPickDlWatch);
}
// The frame watcher (outside Solargraph, where the animations and sliders move the date without
// asking the globe to redraw): a redraw when the date or the Location's offset is not the one shown
// and the shapes may be made again (LOC_PICK_DL_THROTTLE_MS); stops when the layer is off
let _locPickDlWatchRaf = 0;
function _locPickDlWatchOn() {
  return _locPick.open && _locPick.dl && !_locPick.ecl && !!_tzGrid.data && _tzDateInstant() !== null;
}
function _locPickDlWatch() {
  _locPickDlWatchRaf = 0;
  if (!_locPickDlWatchOn()) return;
  if (_locPickDlWantChanged() && performance.now() - _locPickDlMadeAt >= LOC_PICK_DL_THROTTLE_MS) _locPickDraw();   // starts the next look itself
  if (!_locPickDlWatchRaf) _locPickDlWatchRaf = requestAnimationFrame(_locPickDlWatch);
}
function _locPickDlWantChanged() {
  return _locPickDlWant().key !== _locPickDlShownKey;
}
// Solargraph: the Custom date (its buttons, wheels and drags) and the Location's fields change the
// date or the offset by an input; looked at after the event's handlers (bubbling, the document last).
// Not with a moment (Night Sky, Eclipse), where the frame watcher looks.
for (const type of ['input', 'change', 'click', 'pointerup', 'keyup', 'wheel']) document.addEventListener(type, () => {
  if (_locPick.open && _locPick.dl && !_locPick.ecl && _tzGrid.data && _tzDateInstant() === null && _locPickDlWantChanged()) _locPickRequest();
}, { passive: true });
// The layer's caches let go (turned off, SELECT closed): the shapes, the view's paths and labels, the
// images; made again on the next draw with the layer on
function _locPickDlRelease() {
  _dlShapesReset();
  if (_locPickDlLocalC) { _locPickDlLocalC.cv.width = _locPickDlLocalC.cv.height = 0; }
  if (_locPickDlOff) { _locPickDlOff.width = _locPickDlOff.height = 0; }
  _locPickDlCache = _locPickDlLocalC = _locPickDlGeomC = _locPickDlLabelC = _locPickDlOff = _locPickDlTagC = null;
  _locPickDlShownKey = null; _locPickDlMadeAt = -Infinity;
}

// The layer on or off: the time zones and the light pollution off as it comes on
function _locPickDlSet(on) {
  _locPick.dl = on;
  const btn = document.getElementById('btnLocPickDaylight');
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Hide daylight' : 'Show daylight';
  document.getElementById('locPickWin').classList.toggle('dl', on);
  if (on && _locPick.zones) document.getElementById('btnLocPickZones').click();
  if (on && _locPick.lp) _locPickSetLp(false);
  if (!on) { _locPick.dlHi.hover = _locPick.dlHi.pin = null; _locPickDlRelease(); }
  _locPickDlCitiesSync();
  _locPickDlLegendSync();
  _locPickZoneHint(_locPick.hover);
  _locPickRequest();
}
function _locPickDlSetMode(mode) {
  if (!DL_MODES[mode] || mode === _locPick.dlMode) return;
  _locPick.dlMode = mode;
  _locPick.dlHi.hover = _locPick.dlHi.pin = null;   // the bands are another kind
  _locPickDlLegendSync();
  _locPickZoneHint(_locPick.hover);
  _locPickRequest();
}
function _locPickDlSetBase(base) {
  if (!['local', 'utc', 'location'].includes(base) || base === _locPick.dlBase) return;
  _locPick.dlBase = base;   // a picked time keeps its place on the clock
  _locPickDlLegendSync();
  _locPickZoneHint(_locPick.hover);
  _locPickRequest();
}
// The labels: 'edges' (the bands' edges) or 'cities' (the places' values)
function _locPickDlSetLabels(which) {
  if (!['edges', 'cities'].includes(which) || which === _locPick.dlLabels) return;
  _locPick.dlLabels = which;
  _locPickDlCitiesSync();
  _locPickDlLegendSync();
  _locPickRequest();
}
// A time of day h [hours] as 'H:MM', 24:00 kept
function _locPickDlClockText(h) {
  const t = Math.round(h * 60);
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}
// The legend's cells for the mode: Day length 24 (0 h to 24 h); Sunrise and Sunset the half hours of
// the palette's range (_dlRangeBands) and an end cell either side for the bands before and after it
// (data-band 'from-to', picked as a range { from, to }); each in its (first) band's colour, its time
// in its title; pointed at or picked as the Bortle scale's
function _locPickDlLegendBuild(mode) {
  const sc = document.getElementById('locPickDlScale'), ends = document.getElementById('locPickDlEnds');
  const step = DL_MODES[mode].step, cells = [];
  sc.textContent = ''; ends.textContent = '';
  if (mode === 'length') for (let b = 0; b < 24; b++) cells.push([b, b, b + ' h to ' + (b + 1) + ' h']);
  else {
    const { lo, hi } = _dlRangeBands(mode), t = (b) => _locPickDlClockText(b * step);
    cells.push([0, lo - 1, '< ' + t(lo)]);
    for (let b = lo; b <= hi; b++) cells.push([b, b, t(b) + ' to ' + t(b + 1)]);
    cells.push([hi + 1, 47, '> ' + t(hi + 1)]);
  }
  for (const [from, to, title] of cells) {
    const c = document.createElement('button');
    c.dataset.band = from === to ? String(from) : from + '-' + to;
    c.setAttribute('aria-pressed', 'false');
    c.style.background = _locPickDlRgb(_dlColor(mode, from));
    c.title = title;
    _locPickDlCellEvents(c);
    sc.appendChild(c);
  }
  // the marks: length its ends; rise and set the range's ends and every 3 h between, on the cells' edges
  let marks;
  if (mode === 'length') marks = [[0, '0 h'], [1, '24 h']];
  else {
    const [r0, r1] = DL_RANGES[mode], lo = _dlRangeBands(mode).lo;
    marks = [];
    for (let h = r0; h <= r1; h += 3) marks.push([(1 + h / step - lo) / cells.length, h + ':00']);
  }
  ends.classList.toggle('dl-ends-c', mode !== 'length');
  for (const [f, t] of marks) {
    const sp = document.createElement('span');
    sp.style.left = (f * 100) + '%';
    sp.textContent = t;
    ends.appendChild(sp);
  }
}
// A cell's bands: a number, { from, to }, 'day' or 'night'
function _locPickDlCellBand(c) {
  const v = c.dataset.band;
  if (v === 'day' || v === 'night') return v;
  const r = v.split('-');
  return r.length === 2 ? { from: Number(r[0]), to: Number(r[1]) } : Number(v);
}
function _locPickDlCellEvents(c) {
  c.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { _locPick.dlHi.hover = _locPickDlCellBand(c); _locPickRequest(); } });
  c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { _locPick.dlHi.hover = null; _locPickRequest(); } });
  c.addEventListener('click', () => {
    const b = _locPickDlCellBand(c);
    _locPick.dlHi.pin = _locPickDlHiKey(_locPick.dlHi.pin) === _locPickDlHiKey(b) ? null : b;
    _locPickDlLegendSync();
    _locPickRequest();
  });
}
// The Location's band on date D: a number, 'day' or 'night'
function _locPickDlHereBand(D) {
  const [lat, lon] = _dlLocation(), mode = _locPick.dlMode, r = _dlValueUT(mode, lat, lon, D);
  if (mode === 'length') return _dlBand(mode, r.v);
  if (r.none) return r.none;
  return _dlBand(mode, _dlClock(r.v, _locPick.dlBase === 'utc' ? 0 : _locPickDlBaseOffset()));
}
// The Location base's offset: the drawn shapes' while they are the Location base's
function _locPickDlBaseOffset() {
  const C = _locPickDlCache;
  return C && _locPickDlDrawnDate === C.D && C.mb === _locPick.dlMode + '|location' ? C.off : _dlLocationOffsetH();
}
// The legend after a change: its cells for the mode, the toggles, the drawn date, the Location's
// cell (.here, an end cell when its band is one of the cell's) and the picked one
function _locPickDlLegendSync() {
  const L = document.getElementById('locPickDlLegend');
  if (!L) return;
  const mode = _locPick.dlMode;
  if (L.dataset.mode !== mode) { _locPickDlLegendBuild(mode); L.dataset.mode = mode; }
  for (const b of document.querySelectorAll('#locPickDlMode [data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  for (const b of document.querySelectorAll('#locPickDlBase [data-base]')) b.setAttribute('aria-pressed', String(b.dataset.base === _locPick.dlBase));
  for (const b of document.querySelectorAll('#locPickDlLabels [data-labels]')) b.setAttribute('aria-pressed', String(b.dataset.labels === _locPick.dlLabels));
  _locPickDlLabelsTitle();
  if (!_locPick.dl) return;
  const D = _tzGrid.data ? _locPickDlDrawnDate || _dlDate() : null, t = document.getElementById('locPickDlTitle');
  const label = D ? D.label : '';   // no date while the zones load: it would be a guess
  if (t.textContent !== label) t.textContent = label;
  const here = D ? _locPickDlHereBand(D) : null, pin = _locPickDlHiKey(_locPick.dlHi.pin);
  for (const c of L.querySelectorAll('[data-band]')) {
    if (c.classList.contains('here') !== (here !== null && _locPickDlHiHas(_locPickDlCellBand(c), here))) c.classList.toggle('here');
    const pr = String(c.dataset.band === pin);
    if (c.getAttribute('aria-pressed') !== pr) c.setAttribute('aria-pressed', pr);
  }
}
// The head's line for point p (the Location when null): { text, rgb } from the exact model on the
// drawn date (the shapes'), the value cut to the minute (as the bands are cut), on its band's
// colour; null while the layer is off. The local base's offset is the point's own zone's.
function _locPickDlHint(p) {
  if (!_locPick.dl || _locPick.ecl) return null;
  if (!_tzGrid.data) return { text: 'Daylight: loading time zones', rgb: null };
  const H = _locPickDlHintOn(p), D = _locPickDlDrawnDate || _dlDate();
  if (!D.exact) H.text += ' (nautical)';   // the Location's zone unknown to the browser: the date may be a day off
  return H;
}
function _locPickDlHintOn(p) {
  const [la, lo] = _dlLocation(), q = p || { lat: la, lon: lo };
  const D = _locPickDlDrawnDate || _dlDate(), mode = _locPick.dlMode;
  const e = _solarEventsAt(q.lat, q.lon, D.year, D.month, D.day), cut = (v) => Math.floor(v * 60 + 1e-9) / 60;
  const polar = e.polarDay ? 'day' : e.polarNight ? 'night' : null;
  if (mode === 'length') {
    if (polar) return { text: polar === 'day' ? 'Polar day · 24 h' : 'Polar night · 0 h', rgb: LOC_PICK_DL_POLAR[polar] };
    return { text: 'Day ' + _dlFmt(mode, cut(e.lenH)), rgb: _dlColor(mode, _dlBand(mode, e.lenH)) };
  }
  if (polar) return { text: 'No ' + (mode === 'rise' ? 'sunrise' : 'sunset') + ' · polar ' + polar, rgb: LOC_PICK_DL_POLAR[polar] };
  const base = _locPick.dlBase;
  const off = base === 'utc' ? 0 : base === 'location' ? _locPickDlBaseOffset() : _dlOffsetInfoAt(q.lat, q.lon).h;
  const c = _dlClock(mode === 'rise' ? e.riseUT : e.setUT, off);
  return { text: (mode === 'rise' ? 'Sunrise ' : 'Sunset ') + _dlFmt(mode, cut(c)) + ' · UTC' + (off === 0 ? '+0' : _locPickOffsetText(off)),
    rgb: _dlColor(mode, _dlBand(mode, c)) };
}
// #locPickInfoDl, the head's third line (called by _locPickZoneHint and after a draw shows another date)
function _locPickDlInfoSync(p) {
  const el = document.getElementById('locPickInfoDl');
  if (!el) return;
  const H = _locPickDlHint(p);
  if (!H) { if (!el.hidden) el.hidden = true; return; }
  el.hidden = false;
  if (el.textContent !== H.text) el.textContent = H.text;
  el.style.background = H.rgb ? _locPickDlRgb(H.rgb) : 'transparent';
}
document.getElementById('btnLocPickDaylight').addEventListener('click', () => _locPickDlSet(!_locPick.dl));
for (const b of document.querySelectorAll('#locPickDlMode [data-mode]')) b.addEventListener('click', () => _locPickDlSetMode(b.dataset.mode));
for (const b of document.querySelectorAll('#locPickDlBase [data-base]')) b.addEventListener('click', () => _locPickDlSetBase(b.dataset.base));
for (const b of document.querySelectorAll('#locPickDlLabels [data-labels]')) b.addEventListener('click', () => _locPickDlSetLabels(b.dataset.labels));
for (const c of document.querySelectorAll('#locPickDlPolar [data-band]')) _locPickDlCellEvents(c);
_locPickDlLegendSync();
