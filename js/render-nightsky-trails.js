// ─── Star trails: the exposure (Night Sky, Planetarium, Equipment Imaging) ──────────────────────
// A single camera frame (one Imaging setup shown) on an alt-az mount (EQ lock off) can expose star
// trails. The button at the frame's bottom-right corner (#btnNightSkyTrails, placed by
// _nsTrPlace from _nsEqDraw) starts the exposure at the time on screen: a red ring on the button,
// the frame's outline pulsing (#nightSkyTrailPulse), on the time strip a green line at the start
// (#nightSkyTrailStart) and the exposure filled red from it to now (#nightSkyTrailFill), and its
// length above the strip at the right (#nightSkyTrailCounter, mm:ss, h:mm:ss from an hour). While it
// runs time goes only from the start on (_nightSkyClampTimeJD: the strip, its wheel, Play at any
// speed); back toward the start trims the trails to the time on screen. The date, the place, the
// frame and its mount, the setups, the view's direction, the sub-view, the Catalog and the mode
// are locked (body.ns-trail-exposing, .calibration-locked through _nightSkyUpdatePresentationLock,
// and guards in their functions); zoom stays free. The next click ends it and the screen is as
// before: no line, fill, length, ring, pulse or trails. A change of the frame ends it too (_nsTrSync).
// The line and the fill follow the strip's window (NIGHTSKY_STRIP_HOURS_SPAN round the time on
// screen); outside it the line stays at its edge with an arrow.
const _nsTr = { state: 'idle', startJD: null, sig: null };   // state: idle | exposing
const NS_TR_BTN_GAP = 6;   // the button's distance from the frame's corner [CSS px]

function _nsTrExposing() { return _nsTr.state === 'exposing'; }
function _nsTrNowJD() { return _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT); }
// The one camera frame the exposure belongs to, as a signature of its setup and mount; null when
// there is no single camera frame
function _nsTrFrameSig() {
  if (_nsEq.shown.length !== 1 || !_nsEqIsImaging(_nsEq.shown[0].setup)) return null;
  const s = _nsEq.shown[0].setup;
  return JSON.stringify([NS_EQ_IMG_FIELDS.map(k => s[k]), _nsEqMount.eqLock, _nsEqMount.angle]);
}
// The button can be used: the Planetarium drawn, a single camera frame, EQ lock off, no Catalog photo
function _nsTrAvailable() {
  return _nsEqViewOn() && _skyDataLoaded && nightSkySubmode === 'planetarium' && !_nightSkyActiveFrame
    && !_nsEqMount.eqLock && _nsTrFrameSig() !== null;
}
function _nsTrFmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60, p = (v) => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function _nsTrStart() {
  _nsTr.state = 'exposing'; _nsTr.startJD = _nsTrNowJD(); _nsTr.sig = _nsTrFrameSig();
  _nsTrData = null;   // the trails start again (_nsTrAdvance)
  _nsTrChanged();
}
function _nsTrReset() {
  _nsTr.state = 'idle'; _nsTr.startJD = _nsTr.sig = null;
  _nsTrData = null;
  _nsTrChanged();
}
function _nsTrToggle() {
  if (_nsTrExposing()) _nsTrReset();   // the second click ends it: the screen as before
  else if (_nsTrAvailable()) _nsTrStart();
}
// After a start or an end: the locks, then the strip, the counter and the button
function _nsTrChanged() {
  document.body.classList.toggle('ns-trail-exposing', _nsTrExposing());
  if (typeof _nightSkyUpdatePresentationLock === 'function') _nightSkyUpdatePresentationLock();
  if (typeof _nsEqRefreshPanel === 'function' && _nsEq.open) _nsEqRefreshPanel();
  _nsTrSync();
  if (nightSkyActive) drawNightSky();   // the trails and the pulse come and go at once
}
// On every change of the time or of the setups shown: ends an exposure whose frame changed, then
// lays the line and the fill on the strip, writes the length and sets the button's ring
function _nsTrSync() {
  if (_nsTr.state !== 'idle' && _nsTrFrameSig() !== _nsTr.sig) {   // the frame changed or went
    _nsTr.state = 'idle'; _nsTr.startJD = _nsTr.sig = null; _nsTrData = null;
    document.body.classList.remove('ns-trail-exposing');
    if (typeof _nightSkyUpdatePresentationLock === 'function') _nightSkyUpdatePresentationLock();
  }
  const now = _nsTrNowJD(), span = NIGHTSKY_STRIP_HOURS_SPAN / 24;
  const mark = (id, jd) => {
    const el = document.getElementById(id);
    if (jd === null) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    const f = 50 + (jd - now) / span * 100, side = f < 0 ? 'left' : f > 100 ? 'right' : '';
    el.style.display = 'block';
    el.style.left = Math.max(0, Math.min(100, f)) + '%';
    el.classList.toggle('pinned', !!side);
    el.classList.toggle('left', side === 'left');
    el.classList.toggle('right', side === 'right');
  };
  const on = _nsTrExposing();
  mark('nightSkyTrailStart', on ? _nsTr.startJD : null);
  const fill = document.getElementById('nightSkyTrailFill');
  if (on) {
    const f0 = Math.max(0, 50 + (_nsTr.startJD - now) / span * 100);
    fill.style.display = 'block';
    fill.style.left = f0 + '%';
    fill.style.width = Math.max(0, 50 - f0) + '%';
  } else if (fill.style.display !== 'none') fill.style.display = 'none';
  const c = document.getElementById('nightSkyTrailCounter');
  c.style.display = on ? '' : 'none';
  if (on) c.textContent = _nsTrFmt((now - _nsTr.startJD) * 86400);
  c.classList.toggle('exposing', on);
  if (!on) { const pu = document.getElementById('nightSkyTrailPulse'); if (pu.style.display !== 'none') pu.style.display = 'none'; }
  const b = document.getElementById('btnNightSkyTrails');
  if (!_nsTrAvailable() && !_nsTrExposing() && b.style.display !== 'none') b.style.display = 'none';   // another sub-view, mode or setup
  b.classList.toggle('exposing', _nsTrExposing());
  b.setAttribute('aria-pressed', String(_nsTrExposing()));
  b.title = _nsTrExposing() ? 'Star trails: stop the exposure' : 'Star trails: start the exposure';
}
// The button at the frame's bottom-right corner, a little out along the line from the frame's
// centre (the view's) to that corner; hidden where it cannot be used. L: the Planetarium's layout,
// or null when nothing is drawn.
function _nsTrPlace(L) {
  const b = document.getElementById('btnNightSkyTrails'), pu = document.getElementById('nightSkyTrailPulse');
  if (!L || !(_nsTrAvailable() || _nsTrExposing())) {
    if (b.style.display !== 'none') b.style.display = 'none';
    if (pu.style.display !== 'none') pu.style.display = 'none';
    return;
  }
  const segs = 16, pts = _nsEqFramePath(_nsEq.shown[0].setup, L, segs), br = pts[2 * segs];
  const dx = br.x - L.cx, dy = br.y - L.cy, d = Math.hypot(dx, dy) || 1;
  b.style.display = 'flex';
  const cv = document.getElementById('nightSkyCanvas'), par = b.offsetParent;
  if (!par) return;
  const off = cv.getBoundingClientRect(), pr = par.getBoundingClientRect(), r = b.offsetWidth / 2;
  const x = br.x + dx / d * (NS_TR_BTN_GAP + r * Math.SQRT2), y = br.y + dy / d * (NS_TR_BTN_GAP + r * Math.SQRT2);
  b.style.left = Math.round(off.left - pr.left + x - r) + 'px';
  b.style.top = Math.round(off.top - pr.top + y - r) + 'px';
  // the frame's outline over it, pulsing while the exposure runs, in the setup's colour
  if (!_nsTrExposing()) { if (pu.style.display !== 'none') pu.style.display = 'none'; return; }
  const ox = off.left - pr.left, oy = off.top - pr.top;
  pu.style.display = 'block';
  pu.style.left = ox + 'px'; pu.style.top = oy + 'px';
  pu.setAttribute('width', Math.ceil(off.width)); pu.setAttribute('height', Math.ceil(off.height));
  const poly = pu.querySelector('polygon');
  poly.setAttribute('points', pts.map(q => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join(' '));
  poly.style.stroke = _nsEq.shown[0].color;
}
document.getElementById('btnNightSkyTrails').addEventListener('click', (e) => { e.stopPropagation(); _nsTrToggle(); });

// ── The trails ───────────────────────────────────────────────────────────────────────────────────
// What the exposure records inside the frame: every star to mag 6 (NS_TR_MAG_MAX, the base catalogue;
// fainter ones would crowd the frame with circles), planet and the Moon, as positions in the horizon frame (az, el) at times from the start to the time on screen
// (_nsTrData.jds); time going back toward the start trims them to it (_nsTrTrim).
//  - The frame is fixed to the horizon, so on the sky it only turns about the pole: its declinations
//    stay the same, and the candidates are the stars in that band (_nsTrBegin, from the frame's
//    outline at the start; the whole cap when a pole is in the frame).
//  - The step: the sky turns by NS_TR_STEP_SHARE of the frame's shorter side, at least NS_TR_MIN_STEP_S;
//    past NS_TR_MAX_SAMPLES every other time is dropped and the step doubles. Only the new times
//    are worked out on each drawing (_nsTrAdvance), each with the sky's state of that moment
//    (_nsTrAtTime: the time set to it, then put back).
//  - At each time an object counts only inside the frame's circle (half its diagonal + 0.5°), above
//    the horizon, and as visible as the camera sees it then: the eye's limit there (twilight, Moon,
//    light pollution, at most the dark night's 6.5) plus the aperture's gain (_nsEqApertureGain),
//    with the dimming near the horizon; no limit with Atmosphere off. Point: [az, el, visibility 0..1].
// Drawn by _nsTrDrawTrails inside the frame's outline at the start (_nsTrOutlinePx): stars in their
// colour from B-V (_nsTrBvColor), as wide and bright as their dot, planets wider and the Moon a band
// as wide as its disc; in the dark theme the light adds up ('lighter'), as on a photograph.
const NS_TR_STEP_SHARE = 1 / 200, NS_TR_MIN_STEP_S = 5, NS_TR_MAX_SAMPLES = 600, NS_TR_MAG_MAX = 6;
const NS_TR_SIDEREAL_DEG_PER_DAY = 360.9856;
let _nsTrData = null;
// B-V -> RGB, the usual run of star colours from blue-white to orange-red; none: white
const NS_TR_BV = [[-0.4, [155, 176, 255]], [0, [202, 216, 255]], [0.4, [248, 247, 255]], [0.6, [255, 244, 234]],
  [0.8, [255, 229, 207]], [1.2, [255, 205, 150]], [1.6, [255, 180, 110]], [2, [255, 160, 85]]];
function _nsTrBvColor(bv) {
  const b = Number.isFinite(bv) ? bv : (typeof bv === 'string' && bv !== '' ? parseFloat(bv) : NaN);
  if (!Number.isFinite(b)) return [255, 255, 255];
  const T = NS_TR_BV;
  if (b <= T[0][0]) return T[0][1].slice();
  for (let i = 1; i < T.length; i++) if (b <= T[i][0]) {
    const f = (b - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
    return T[i - 1][1].map((c, k) => Math.round(c + f * (T[i][1][k] - c)));
  }
  return T[T.length - 1][1].slice();
}
// Runs fn with Night Sky's time set to jd (the sky's state, matrices and limits follow it), then
// puts the time back
function _nsTrAtTime(jd, fn) {
  const keep = [nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT], r = _skyFromJulianDateUT(jd);
  nightSkyYear = r.year; nightSkyMonth = r.month; nightSkyDay = r.day; nightSkyHourUT = r.hourUT;
  try { return fn(); } finally { [nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT] = keep; }
}
// The frame at the start, in the horizon frame: centre F, axes up/right, half sizes as tangents,
// its outline (unit vectors) and the cosine of the circle round it
function _nsTrGeometry() {
  const s = _nsEq.shown[0].setup, c = _nsEqComputeImaging(s), D2R = Math.PI / 180;
  const hw = Math.tan(c.fovW / 2 * D2R), hh = Math.tan(c.fovH / 2 * D2R), { F, up, right } = _nsEqFrameBasis();
  const outline = [], corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]], segs = 16;
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i], [x1, y1] = corners[(i + 1) % 4];
    for (let j = 0; j < segs; j++) {
      const t = j / segs, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const v = [F[0] + x * right[0] + y * up[0], F[1] + x * right[1] + y * up[1], F[2] + x * right[2] + y * up[2]], n = Math.hypot(...v);
      outline.push([v[0] / n, v[1] / n, v[2] / n]);
    }
  }
  const radius = Math.atan(Math.hypot(hw, hh)) + 0.5 * D2R;
  return { F: F.slice(), up: up.slice(), right: right.slice(), hw, hh, outline, cosR: Math.cos(radius), radiusDeg: radius / D2R };
}
// The frame's outline on the canvas now (the view may have moved since the stop)
function _nsTrOutlinePx(L) {
  return _nsTrData ? _nsTrData.g.outline.map(v => _nightSkyPlanetProjectRaw(L, v)) : [];
}
// The band of declination the frame sweeps (J2000, 0.6° margin for precession and refraction)
function _nsTrDecBand(g) {
  const lst = _nightSkyLstNow(), lat = _nightSkyLatSigned();
  let lo = 90, hi = -90;
  for (const v of g.outline.concat([g.F])) {
    const el = Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI, az = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
    const d = _skyAzElToRaDec(az, el, lst, lat).dec;
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  const inFrame = (p) => {   // a pole (horizon vector) inside the frame
    const d = p[0] * g.F[0] + p[1] * g.F[1] + p[2] * g.F[2];
    if (d <= 0) return false;
    const x = (p[0] * g.right[0] + p[1] * g.right[1] + p[2] * g.right[2]) / d, y = (p[0] * g.up[0] + p[1] * g.up[1] + p[2] * g.up[2]) / d;
    return Math.abs(x) <= g.hw && Math.abs(y) <= g.hh;
  };
  const np = _skyDomeUnitVec(0, lat), sp = [-np[0], -np[1], -np[2]];
  if (inFrame(lat >= 0 ? np : sp)) { if (lat >= 0) hi = 90; else lo = -90; }
  return [lo - 0.6, hi + 0.6];
}
function _nsTrBegin() {
  const g = _nsTrGeometry(), [lo, hi] = _nsTrDecBand(g), rows = [];
  const add = (mag, bv, ra, dec) => rows.push({ mag, dec, col: _nsTrBvColor(bv), v: _skyDomeUnitVecRaDec({ ra, dec }), pts: [] });
  for (const s of _skyStars) if (s.decDeg >= lo && s.decDeg <= hi && !(s.mag > NS_TR_MAG_MAX)) add(s.mag, s.bv, s.raDeg, s.decDeg);
  const span = 2 * Math.min(Math.atan(g.hw), Math.atan(g.hh)) * 180 / Math.PI;
  const step = Math.max(NS_TR_MIN_STEP_S / 86400, span * NS_TR_STEP_SHARE / NS_TR_SIDEREAL_DEG_PER_DAY);
  _nsTrData = { key: _nsTr.startJD, g, rows, planets: {}, moon: { pts: [], r: [] }, jds: [], step };
}
// One time: every object's point (or null) appended
function _nsTrSample(jd) {
  const d = _nsTrData, g = d.g, i = d.jds.length;
  d.jds.push(jd);
  _nsTrAtTime(jd, () => {
    const m = _skyJ2000HorizonMatrix(), q = _nightSkyVisPrep(), atm = !!q.s;
    const gain = _nsEqApertureGain(_nsEq.shown[0].setup);
    const inside = (u) => u[0] * g.F[0] + u[1] * g.F[1] + u[2] * g.F[2] >= g.cosR;
    const vis = (mag, az, el) => {
      if (!atm) return 1;
      const em = mag + _nightSkyExtinctionMag(el);
      const L = Math.min(NIGHTSKY_MAG_LIMIT_OFF, q.byEl ? _nightSkyAtmLimitByDir(q.s, az, el) : _nightSkyAtmLimitAt(_skyDomeUnitVec(az, el))) + gain;
      return em <= L ? 1 : Math.max(0, 1 - (em - L) / NIGHTSKY_ATM_FADE);
    };
    for (const o of d.rows) {
      const v = o.v, u = [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
      if (!inside(u)) { o.pts[i] = null; continue; }
      const p = _skyHorizonAzEl(m, v[0], v[1], v[2]);
      o.pts[i] = p.el < 0 ? null : [p.az, p.el, vis(o.mag, p.az, p.el)];
    }
    for (const pl of _planetPositions(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)) {
      if (!_planetShown(pl)) continue;
      const t = d.planets[pl.key] || (d.planets[pl.key] = { mag: pl.magnitude, pts: [] });
      const p = _skyStarAzEl(pl.raDeg, pl.decDeg, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
      t.pts[i] = p.el >= 0 && inside(_skyDomeUnitVec(p.az, p.el)) ? [p.az, p.el, vis(pl.magnitude, p.az, p.el)] : null;
    }
    const mo = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT), mr = _moonSemiDiamDeg(mo);
    const mu = _skyDomeUnitVec(mo.az, mo.el);
    const near = mu[0] * g.F[0] + mu[1] * g.F[1] + mu[2] * g.F[2] >= Math.cos((g.radiusDeg + mr) * Math.PI / 180);
    d.moon.pts[i] = mo.el >= -mr && near ? [mo.az, mo.el, 1] : null;
    d.moon.r[i] = mr;
  });
}
// Halves the times kept (every other one) and doubles the step, past NS_TR_MAX_SAMPLES
function _nsTrThin() {
  const d = _nsTrData, keep = (arr) => arr.filter((_, k) => k % 2 === 0 || k === arr.length - 1);
  d.jds = keep(d.jds);
  for (const o of d.rows) o.pts = keep(o.pts);
  for (const k in d.planets) d.planets[k].pts = keep(d.planets[k].pts);
  d.moon.pts = keep(d.moon.pts); d.moon.r = keep(d.moon.r);
  d.step *= 2;
}
// Drops the times past jd (time went back)
function _nsTrTrim(jd) {
  const d = _nsTrData;
  let n = d.jds.length;
  while (n > 1 && d.jds[n - 1] > jd + 1e-12) n--;
  if (n === d.jds.length) return;
  d.jds.length = n;
  for (const o of d.rows) if (o.pts.length > n) o.pts.length = n;
  for (const k in d.planets) if (d.planets[k].pts.length > n) d.planets[k].pts.length = n;
  if (d.moon.pts.length > n) { d.moon.pts.length = n; d.moon.r.length = n; }
}
// Brings the trails to the time on screen: new times added, or those past it dropped
function _nsTrAdvance() {
  if (_nsTr.state === 'idle') { _nsTrData = null; return; }
  if (!_nsTrData || _nsTrData.key !== _nsTr.startJD) _nsTrBegin();
  const d = _nsTrData, target = Math.max(_nsTr.startJD, _nsTrNowJD());
  if (!d.jds.length) _nsTrSample(_nsTr.startJD);
  _nsTrTrim(target);
  let guard = 0;
  while (d.jds[d.jds.length - 1] + d.step <= target + 1e-12 && guard++ < 400) {
    _nsTrSample(d.jds[d.jds.length - 1] + d.step);
    if (d.jds.length > NS_TR_MAX_SAMPLES) _nsTrThin();
  }
}
function _nsTrMoonWidthPx(L, moon) {
  const r = moon.r.filter(Number.isFinite);
  return r.length ? 2 * r[r.length - 1] * Math.PI / 180 * L.scale * _nightSkyPlanet3D.FOCAL : 0;
}
// One object's trail from point `from` on: runs of points inside, cut where it leaves the frame or
// the sky; the opacity in steps of 1/8, so a run of even visibility is one stroke. With from > 0 the
// run starts at point from - 1 (the layer already holds what came before).
function _nsTrStroke(ctx, L, pts, rgb, width, alpha0, from = 0) {
  ctx.lineWidth = width;
  let level = -1, open = false, prev = null;
  const flush = () => { if (open) { ctx.stroke(); open = false; } };
  for (let i = Math.max(0, from - 1); i < pts.length; i++) {
    const p = pts[i], lv = p ? Math.round(p[2] * 8) : 0;
    const q = p && lv > 0 ? _nightSkyPlanetProject(L, p[0], p[1]) : null;
    if (!q || !q.visible) { flush(); level = -1; prev = null; continue; }
    if (i < from) { prev = q; continue; }   // the anchor of the new stretch
    if (lv !== level) {
      flush();
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(alpha0 * lv / 8).toFixed(3)})`;
      ctx.moveTo((prev || q).x, (prev || q).y);
      level = lv;
    }
    ctx.lineTo(q.x, q.y);
    open = true;
    prev = q;
  }
  flush();
}
// The trails are drawn into a layer of the canvas's size (_nsTrLayer) and laid over the sky inside
// the frame: each drawing adds only the times new since the last one, and the whole layer is drawn
// again only when the view, its size, the zoom, the star size, the theme or the kept times change.
// Segments end square (butt caps), so the light of a trail does not double where they meet.
const _nsTrLayer = { canvas: null, key: null, n: 0, data: null };
function _nsTrLayerKey(ctx, L) {
  const C = _nightSkyPlanet3D, cv = ctx.canvas;
  return [cv.width, cv.height, L.cx, L.cy, L.scale, C.camAz, C.camEl, C.roll, C.zoom, C.FOCAL, nightSkyStarScale,
    document.body.classList.contains('light'), _nsTrData.step].join('|');
}
function _nsTrPaint(c, L, from) {
  const d = _nsTrData, light = document.body.classList.contains('light');
  c.globalCompositeOperation = light ? 'source-over' : 'lighter';
  c.lineCap = 'butt'; c.lineJoin = 'round';
  const tint = (rgb) => light ? rgb.map(x => Math.round(x * 0.35)) : rgb;
  for (const o of d.rows) {
    if (!o.lit) { for (let i = from; i < o.pts.length && !o.lit; i++) if (o.pts[i]) o.lit = true; if (!o.lit) continue; }
    _nsTrStroke(c, L, o.pts, tint(o.col), Math.max(0.6, 1.2 * _nightSkyStarSize(o.mag)), _nightSkyStarAlpha(o.mag) * _nightSkyDeepDim(o.mag), from);
  }
  for (const k in d.planets) {
    const t = d.planets[k];
    if (t.pts.some(Boolean)) _nsTrStroke(c, L, t.pts, tint([255, 244, 220]), 1.6 * _planetDotRadius(t.mag), 1, from);
  }
  if (d.moon.pts.some(Boolean)) _nsTrStroke(c, L, d.moon.pts, tint([255, 251, 232]), _nsTrMoonWidthPx(L, d.moon), 0.9, from);
}
function _nsTrDrawTrails(ctx, L) {
  if (_nsTr.state === 'idle') { _nsTrData = null; _nsTrLayer.data = null; return; }
  _nsTrAdvance();
  const d = _nsTrData;
  if (!d || d.jds.length < 1) return;
  const cv = ctx.canvas, lay = _nsTrLayer;
  if (!lay.canvas) lay.canvas = document.createElement('canvas');
  const key = _nsTrLayerKey(ctx, L), c = lay.canvas.getContext('2d');
  if (lay.canvas.width !== cv.width || lay.canvas.height !== cv.height) { lay.canvas.width = cv.width; lay.canvas.height = cv.height; lay.key = null; }
  if (lay.key !== key || lay.data !== d || lay.n > d.jds.length) {   // everything again
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, lay.canvas.width, lay.canvas.height);
    c.setTransform(ctx.getTransform());
    for (const o of d.rows) o.lit = false;
    _nsTrPaint(c, L, 0);
    lay.key = key; lay.data = d; lay.n = d.jds.length;
  } else if (d.jds.length > lay.n) {   // only the new times
    c.setTransform(ctx.getTransform());
    _nsTrPaint(c, L, lay.n);
    lay.n = d.jds.length;
  }
  const outline = _nsTrOutlinePx(L);
  ctx.save();
  ctx.beginPath();
  outline.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y));
  ctx.closePath();
  ctx.clip();
  ctx.globalCompositeOperation = document.body.classList.contains('light') ? 'source-over' : 'lighter';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(lay.canvas, 0, 0);
  ctx.restore();
}
