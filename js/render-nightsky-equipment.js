// ─── Equipment (Night Sky, Planetarium) ────────────────────────────────────────────────────────
// A telescope with an eyepiece (Visual) or a camera (Imaging) for planning a session: what fits in
// the eyepiece's field or on the sensor and how large an object is; the camera's mount and frame
// in render-nightsky-equipment-mount.js. Round button right of the RA/Dec picker (#btnNightSkyEquipment), the
// Planetarium only. Spec: specs/2026-11-01-planetarium-equipment-design.md (outside the version
// folders).
//
// The figures (_nsEqCompute), the standard ones of visual astronomy:
//  - effective focal length = telescope focal length × Barlow / reducer (one factor: above 1 a
//    Barlow, below 1 a reducer, 1 none);
//  - magnification = effective focal length / eyepiece focal length;
//  - true field = the eyepiece's apparent field / magnification;
//  - exit pupil = aperture / magnification;
//  - f-ratio = effective focal length / aperture; highest useful magnification = 2 × aperture (mm);
//    limiting magnitude ≈ 7.5 + 5 log10(aperture in cm).
// Warned: an exit pupil over 7 mm (wider than the eye's), a magnification over the useful highest.
// Inside the field the stars go on to the instrument's limit, as far as the catalogues reach (mag 8;
// _nsEqFieldStars below), so beyond 8 the limiting magnitude only tells how much more it will show.

const NS_EQ_DEFAULT = { name: '', mode: 'visual', telescopeFocal: 420, aperture: 72, eyepieceFocal: 25, eyepieceFov: 65, accessory: 1 };
const NS_EQ_FIELDS = ['telescopeFocal', 'aperture', 'eyepieceFocal', 'eyepieceFov', 'accessory'];
// Imaging: a camera's sensor instead of the eyepiece; telescope and Barlow / reducer shared
const NS_EQ_IMG_DEFAULT = { name: '', mode: 'imaging', telescopeFocal: 420, aperture: 72, accessory: 1, sensorW: 5472, sensorH: 3648, crop: 1 };
const NS_EQ_IMG_FIELDS = ['telescopeFocal', 'aperture', 'sensorW', 'sensorH', 'crop', 'accessory'];
const NS_EQ_FF_DIAG_MM = 43.27;   // full frame 36 x 24 mm
function _nsEqIsImaging(s) { return s.mode === 'imaging'; }
function _nsEqFields(s) { return _nsEqIsImaging(s) ? NS_EQ_IMG_FIELDS : NS_EQ_FIELDS; }

// A field's text as a number: a decimal comma counts as a point ("0,63"); empty or not a number: NaN
function _nsEqNum(text) {
  const t = String(text).trim().replace(',', '.');
  return t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? NaN : parseFloat(t);
}
// The mode's values finite and above zero, the sensor's pixels whole numbers
function _nsEqValid(s) {
  return _nsEqFields(s).every(k => Number.isFinite(s[k]) && s[k] > 0)
    && (!_nsEqIsImaging(s) || (Number.isInteger(s.sensorW) && Number.isInteger(s.sensorH)));
}
function _nsEqCompute(s) {
  const effFocal = s.telescopeFocal * s.accessory, mag = effFocal / s.eyepieceFocal;
  const pupil = s.aperture / mag, maxMag = 2 * s.aperture;
  return {
    effFocal, mag, tfov: s.eyepieceFov / mag, pupil,
    fRatio: effFocal / s.aperture, maxMag, limMag: 7.5 + 5 * Math.log10(s.aperture / 10),
    pupilWarn: pupil > 7, magWarn: mag > maxMag,
  };
}
// A camera's figures: the sensor's diagonal from the crop factor (full frame 43.27 mm), its sides in
// the pixels' ratio; the fields through a real (gnomonic) lens, 2·atan(side / 2f) [°]; the image
// scale 206.265 · pixel [µm] / focal length [mm] [″/px]
function _nsEqComputeImaging(s) {
  const effFocal = s.telescopeFocal * s.accessory, diag = NS_EQ_FF_DIAG_MM / s.crop;
  const k = diag / Math.hypot(s.sensorW, s.sensorH), sensorWmm = s.sensorW * k, sensorHmm = s.sensorH * k;
  const fov = mm => 2 * Math.atan(mm / (2 * effFocal)) * 180 / Math.PI;
  const pixelUm = sensorWmm / s.sensorW * 1000;
  return {
    effFocal, sensorWmm, sensorHmm, pixelUm, fovW: fov(sensorWmm), fovH: fov(sensorHmm), fovDiag: fov(diag),
    scale: 206.265 * pixelUm / effFocal, fRatio: effFocal / s.aperture,
  };
}
// The angle across a setup's shape [°]: the eyepiece's true field, the frame's diagonal
function _nsEqSpanDeg(s) {
  return _nsEqIsImaging(s) ? _nsEqComputeImaging(s).fovDiag : _nsEqCompute(s).tfov;
}

// ── Saved setups ────────────────────────────────────────────────────────────────────────────────
// Named setups in localStorage (NS_EQ_STORE_KEY, a JSON list of {name, mode, the five values}),
// the last one used under NS_EQ_LAST_KEY, preselected when the panel opens. New names are
// setup_N, the lowest N free from 1. Every access is guarded: where the browser blocks the
// storage, or it holds something unreadable, the setups live in memory until the page closes;
// once a write fails (readable but full storage), reads come from memory too, or a stale stored
// copy would hide what was saved since. Stored entries this version cannot use (another mode,
// such as a later Imaging one, or values it does not know) are left out of the list and written
// back untouched with every save.
const NS_EQ_STORE_KEY = 'solargraphyEquipmentSetups', NS_EQ_LAST_KEY = 'solargraphyEquipmentLast';
let _nsEqMemSetups = [], _nsEqMemLast = '', _nsEqStoreBroken = false;
function _nsEqStoredRaw() {
  let list = _nsEqMemSetups;
  if (!_nsEqStoreBroken) try {
    const raw = localStorage.getItem(NS_EQ_STORE_KEY);
    if (raw !== null) list = JSON.parse(raw);
  } catch (e) { list = _nsEqMemSetups; }
  return Array.isArray(list) ? list.filter(s => s && typeof s === 'object') : [];
}
function _nsEqUsable(s) {
  return typeof s.name === 'string' && s.name && (s.mode === undefined || s.mode === 'visual' || s.mode === 'imaging') && _nsEqValid(s);
}
function _nsEqSetups() {
  return _nsEqStoredRaw().filter(_nsEqUsable)
    .map(s => _nsEqIsImaging(s) ? Object.assign({}, NS_EQ_IMG_DEFAULT, s) : Object.assign({}, NS_EQ_DEFAULT, s, { mode: 'visual' }));
}
function _nsEqStoreSetups(list) {
  const others = _nsEqStoredRaw().filter(s => !_nsEqUsable(s));
  _nsEqMemSetups = list.map(s => Object.assign({}, s)).concat(others);
  try { localStorage.setItem(NS_EQ_STORE_KEY, JSON.stringify(_nsEqMemSetups)); return true; } catch (e) { _nsEqStoreBroken = true; return false; }
}
function _nsEqNextName(list) {
  const used = new Set(list.map(s => s.name));
  let n = 1;
  while (used.has('setup_' + n)) n++;
  return 'setup_' + n;
}
function _nsEqLast() {
  if (!_nsEqStoreBroken) try { const v = localStorage.getItem(NS_EQ_LAST_KEY); if (v !== null) return v; } catch (e) { /* blocked */ }
  return _nsEqMemLast;
}
function _nsEqSetLast(name) {
  _nsEqMemLast = name || '';
  try { localStorage.setItem(NS_EQ_LAST_KEY, _nsEqMemLast); } catch (e) { _nsEqStoreBroken = true; }
}

// ── The setups shown ────────────────────────────────────────────────────────────────────────────
// Up to NS_EQ_MAX setups in the eyepiece view at once (comparison), each its own colour: the
// first of NS_EQ_COLORS no shown setup has (one removed frees its colour). Apply shows the
// panel's setup alone, Add to comparison adds it (not a sixth, not one with the same five values),
// Turn off clears them. The list lives with the page only. Apply and Add set the zoom so that the
// largest circle is a third of the canvas's shorter side across, up to the Planetarium's highest
// (20x: below ~5° the stars to mag 6 leave the view mostly empty); removing one leaves the zoom.
const NS_EQ_COLORS = ['#f5c518', '#3fd0d4', '#e06ad0', '#6cd46a', '#ff8a3d'], NS_EQ_MAX = 5;
const NS_EQ_FIT = 1 / 3;   // the largest circle's diameter, a share of the canvas's shorter side
const _nsEq = { shown: [], open: false, loaded: false, ver: 0, mode: 'visual', sel: { visual: '', imaging: '' } };   // shown: {setup, color}; open: the panel; loaded: a setup put in it; ver: counts changes of shown
function _nsEqSame(a, b) {
  return _nsEqIsImaging(a) === _nsEqIsImaging(b) && _nsEqFields(a).every(k => a[k] === b[k]);
}
// A circle's radius on the canvas [CSS px] for a true field [°]: the Planetarium's equidistant
// projection, radius = angle × scale × focal (render-nightsky.js, _nightSkyPlanetLayout)
function _nsEqRadiusPx(tfovDeg, layout) {
  return tfovDeg / 2 * Math.PI / 180 * layout.scale * _nightSkyPlanet3D.FOCAL;
}
function _nsEqFitZoom() {
  if (!_nsEq.shown.length) return;
  const cv = document.getElementById('nightSkyCanvas'), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const tfov = Math.max(..._nsEq.shown.map(e => _nsEqSpanDeg(e.setup))) * Math.PI / 180;   // the largest shape
  const focal = Math.min(w, h) * NS_EQ_FIT / (tfov * _nightSkyPlanetLayout(w, h).scale);
  setNightSkyPlanetZoom(focal / _NIGHTSKY_PLANET_BASE_FOCAL);   // clamped to 0.5x-20x there
}
// After any change of the setups shown: the button, the chips (when their parts exist) and the sky
function _nsEqChanged() {
  _nsEq.ver++;
  if (typeof _nsTrSync === 'function') _nsTrSync();   // star trails: a changed frame clears its exposure
  if (typeof _nsEqMountSync === 'function') _nsEqMountSync();   // render-nightsky-equipment-mount.js
  if (typeof _nsEqSyncButton === 'function') _nsEqSyncButton();
  if (typeof _nsEqChips === 'function') _nsEqChips();
  if (nightSkyActive) drawNightSky();
}
// During a star-trail exposure the setups stay as they are (render-nightsky-trails.js)
function _nsEqLocked() { return typeof _nsTrExposing === 'function' && _nsTrExposing(); }
function _nsEqApply(setup) {
  if (_nsEqLocked()) return;
  _nsEq.shown = [{ setup: Object.assign({}, setup), color: NS_EQ_COLORS[0] }];
  _nsEqFitZoom();
  _nsEqChanged();
}
function _nsEqAdd(setup) {
  if (_nsEqLocked()) return false;
  if (_nsEq.shown.length >= NS_EQ_MAX || _nsEq.shown.some(e => _nsEqSame(e.setup, setup))) return false;
  const color = NS_EQ_COLORS.find(c => !_nsEq.shown.some(e => e.color === c));
  _nsEq.shown.push({ setup: Object.assign({}, setup), color });
  _nsEqFitZoom();
  _nsEqChanged();
  return true;
}
function _nsEqRemove(i) {
  if (_nsEqLocked()) return;
  _nsEq.shown.splice(i, 1);
  _nsEqChanged();
}
function _nsEqOff() {
  if (_nsEqLocked()) return;
  _nsEq.shown = [];
  _nsEqMaskCanvas = null;   // the spare canvas goes with the view
  _nsEqChanged();
}

// ── The eyepiece view ───────────────────────────────────────────────────────────────────────────
// The Planetarium's last layer (drawNightSky): black at 50 % over the whole canvas with a hole in the
// shape of every setup shown, the eyepieces' circles and the cameras' frames together (their union),
// centred on the view, so the sky outside stays readable and a drag reaches objects beyond the
// field; every shape's edge in its setup's colour. With a camera's frame the mask is drawn on a
// spare canvas the size of the sky's (the shapes cut out of it there, 'destination-out'), then laid
// over the sky; eyepieces alone (centred circles, their union the largest) cut it straight on the
// sky canvas.
// Nothing while a Catalog photo is presented (_nightSkyActiveFrame), as for the RA/Dec picker.
const NS_EQ_MASK_ALPHA = 0.5, NS_EQ_RING_PX = 1.5;
let _nsEqMaskCanvas = null;
function _nsEqShapePath(c, sh) {
  c.beginPath();
  if (sh.r !== undefined) c.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2);
  else { sh.pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath(); }
}
// The shapes of the setups shown on the canvas: eyepieces' circles {cx, cy, r}, frames' outlines {pts}
function _nsEqShapes(L) {
  return _nsEq.shown.map(e => _nsEqIsImaging(e.setup)
    ? { pts: _nsEqFramePath(e.setup, L), color: e.color }
    : { cx: L.cx, cy: L.cy, r: _nsEqRadiusPx(_nsEqCompute(e.setup).tfov, L), color: e.color });
}
function _nsEqInShape(sh, x, y) {
  if (sh.r !== undefined) return Math.hypot(x - sh.cx, y - sh.cy) <= sh.r;
  let inside = false;
  for (let i = 0, j = sh.pts.length - 1; i < sh.pts.length; j = i++) {
    const a = sh.pts[i], b = sh.pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ── Fainter stars in the field ──────────────────────────────────────────────────────────────────
// What the telescope shows beyond the eye, inside the shapes of the setups shown (their union, the
// mask's hole): the stars down to the instrument's limit from the base catalogue (those the eye
// misses there) and from data/celestial/stars.6-8.json (36,367 stars of mag 6.01 to 8.0, sorted by
// Dec; tools/stars-deep.py), fetched the first time a setup is shown (_nsEqDeepLoad), redrawn on
// arrival. The instrument's limit in a direction is the eye's there (Atmosphere: twilight, Moon,
// light pollution, at most the dark night's NIGHTSKY_MAG_LIMIT_OFF) plus the aperture's gain over
// the eye, the panel's limiting magnitude 7.5 + 5·log10(D / 10 mm) less the eye's 6.5 (72 mm: +5.3),
// the largest aperture shown counting; with Atmosphere off there is no limit. The Mag ≤ slider is the
// naked eye's and does not apply in the field. A star the sky drew already at opacity a_eye (a base
// one, or a deep one where the sky shows them at 6+, _nightSkyDeepForSky) gets only the rest,
// (a − a_eye) / (1 − a_eye) laid over it, so it ends at a. Stars fainter than 6 are drawn fainter
// still (_nightSkyDeepDim), as the base catalogue's sizes end at 6.
// Found by the view's centre in J2000 (the base catalogue's frame; precession undone) and a band of
// Dec half the widest shape plus 1° wide (the frame's turn, the projection), then each star's own
// place on the canvas against the shapes.
const _nsEqDeep = { state: 'idle', data: null, p: null };   // state: idle | loading | ready | failed
const NS_EQ_DEEP_FILE = 'data/celestial/stars.6-8.json';
function _nsEqDeepLoad() {
  if (_nsEqDeep.p) return _nsEqDeep.p;
  _nsEqDeep.state = 'loading';
  return (_nsEqDeep.p = fetch(NS_EQ_DEEP_FILE).then(r => r.json()).then((j) => {
    _nsEqDeep.data = j.stars; _nsEqDeep.state = 'ready';
    if (nightSkyActive) drawNightSky();
  }).catch(() => { _nsEqDeep.state = 'failed'; }));
}
function _nsEqApertureGain(s) {
  return 7.5 + 5 * Math.log10(s.aperture / 10) - NIGHTSKY_MAG_LIMIT_OFF;
}
// The view's centre in J2000 RA (-180..180, the catalogues') and Dec [°]
function _nsEqCentreJ2000() {
  const C = _nightSkyPlanet3D, eq = _skyAzElToRaDec(C.camAz * 180 / Math.PI, C.camEl * 180 / Math.PI, _nightSkyLstNow(), _nightSkyLatSigned());
  const m = _skyPrecessionMatrix(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)), v = _skyDomeUnitVecRaDec(eq);
  const x = m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2], y = m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2], z = m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2];
  return { ra: Math.atan2(y, x) * 180 / Math.PI, dec: Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI };
}
// The stars to lay over the field: [{x, y, r, alpha, mag}], alpha the share still to add
function _nsEqFieldStars(L, w, h, shapes) {
  if (!_nsEq.shown.length || !_skyDataLoaded) return [];
  shapes = shapes || _nsEqShapes(L);
  const atm = !!_nightSkyAtmState(), gain = Math.max(..._nsEq.shown.map(e => _nsEqApertureGain(e.setup)));
  const half = Math.max(..._nsEq.shown.map(e => _nsEqSpanDeg(e.setup))) / 2 + 1, c = _nsEqCentreJ2000();
  const polar = Math.abs(c.dec) + half >= 89, dRa = polar ? 180 : half / Math.cos((Math.abs(c.dec) + half) * Math.PI / 180);
  const near = (ra, dec) => Math.abs(dec - c.dec) <= half && (polar || Math.abs(((ra - c.ra) % 360 + 540) % 360 - 180) <= dRa);
  const out = [], skyLimit = _nightSkyDeepForSky().length ? _nightSkyMagLimit() : 6;   // what the sky pass drew
  const add = (mag, ra, dec, base) => {
    const p = _skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (p.el < 0) return;
    const pr = _nightSkyPlanetProject(L, p.az, p.el);
    if (!pr.visible || !shapes.some(sh => _nsEqInShape(sh, pr.x, pr.y))) return;
    const em = mag + _nightSkyExtinctionMag(p.el);
    let a = 1;
    if (atm) {
      const lim = Math.min(NIGHTSKY_MAG_LIMIT_OFF, _nightSkyAtmLimitAt(_skyDomeUnitVec(p.az, p.el))) + gain;
      a = em <= lim ? 1 : Math.max(0, 1 - (em - lim) / NIGHTSKY_ATM_FADE);
    }
    if (a <= 0) return;
    const look = _nightSkyStarAlpha(em) * _nightSkyDeepDim(mag) * pr.alpha;
    const total = look * a, eye = base || mag <= skyLimit ? look * _nightSkyVisFactor(em, p.az, p.el) : 0;
    if (total <= eye + 1e-3) return;
    out.push({ x: pr.x, y: pr.y, r: _nightSkyStarSize(em), alpha: eye >= 1 ? 0 : (total - eye) / (1 - eye), mag });
  };
  for (const s of _skyStars) if (near(s.raDeg, s.decDeg)) add(s.mag, s.raDeg, s.decDeg, true);
  const D = _nsEqDeep.data;
  if (D) {
    let lo = 0, hi = D.length;   // the first star at or above the band's south edge
    while (lo < hi) { const mid = (lo + hi) >> 1; if (D[mid][4] < c.dec - half) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < D.length && D[i][4] <= c.dec + half; i++) if (near(D[i][3], D[i][4])) add(D[i][1], D[i][3], D[i][4], false);
  }
  return out;
}
function _nsEqDrawFieldStars(ctx, L, w, h, shapes) {
  if (_nsEqDeep.state === 'idle') _nsEqDeepLoad();
  const stars = _nsEqFieldStars(L, w, h, shapes);
  if (!stars.length) return;
  ctx.save();
  ctx.beginPath();
  for (const sh of shapes) {
    if (sh.r !== undefined) { ctx.moveTo(sh.cx + sh.r, sh.cy); ctx.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2); }
    else { sh.pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath(); }
  }
  ctx.clip();
  ctx.fillStyle = _nightSkyStarColor();
  for (const s of stars) {
    if (!(s.alpha > 0)) continue;
    ctx.globalAlpha = s.alpha;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}
function _nsEqDraw(ctx, w, h) {
  _nsEqChips();   // they follow the canvas's size
  if (typeof _nsEqMountSync === 'function') _nsEqMountSync();   // hidden while the data loads
  if (!_nsEq.shown.length || _nightSkyActiveFrame || !_skyDataLoaded) { if (typeof _nsTrPlace === 'function') _nsTrPlace(null); return; }   // not over "loading data…"
  const L = _nightSkyPlanetLayout(w, h);
  if (typeof _nsTrPlace === 'function') _nsTrPlace(L);   // star trails' button at the frame's corner
  const shapes = _nsEqShapes(L);
  _nsEqDrawFieldStars(ctx, L, w, h, shapes);   // the telescope's stars, under the mask's edge
  if (typeof _nsTrDrawTrails === 'function') _nsTrDrawTrails(ctx, L);   // star trails (render-nightsky-trails.js)
  if (shapes.every(sh => sh.r !== undefined)) {
    // eyepieces only: all centred, their union is the largest circle, cut straight on the sky canvas
    const rMax = Math.max(...shapes.map(sh => sh.r));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(L.cx, L.cy, rMax, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${NS_EQ_MASK_ALPHA})`;
    ctx.fill('evenodd');
    ctx.restore();
  } else _nsEqDrawMaskUnion(ctx, w, h, shapes);
  ctx.save();
  ctx.lineWidth = NS_EQ_RING_PX;
  ctx.lineJoin = 'round';
  for (const sh of shapes) { _nsEqShapePath(ctx, sh); ctx.strokeStyle = sh.color; ctx.stroke(); }
  ctx.restore();
}
function _nsEqDrawMaskUnion(ctx, w, h, shapes) {
  const cv = ctx.canvas;
  if (!_nsEqMaskCanvas) _nsEqMaskCanvas = document.createElement('canvas');
  const m = _nsEqMaskCanvas;
  if (m.width !== cv.width || m.height !== cv.height) { m.width = cv.width; m.height = cv.height; }
  const mc = m.getContext('2d');
  mc.setTransform(1, 0, 0, 1, 0, 0);
  mc.clearRect(0, 0, m.width, m.height);
  mc.setTransform(ctx.getTransform());
  mc.globalCompositeOperation = 'source-over';
  mc.fillStyle = `rgba(0,0,0,${NS_EQ_MASK_ALPHA})`;
  mc.fillRect(0, 0, w, h);
  mc.globalCompositeOperation = 'destination-out';
  mc.fillStyle = '#000';
  for (const sh of shapes) { _nsEqShapePath(mc, sh); mc.fill(); }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(m, 0, 0);
  ctx.restore();
}

// ── The button and the panel ────────────────────────────────────────────────────────────────────
// #btnNightSkyEquipment in the Planetarium's corner (render-nightsky.js,
// _nightSkyUpdatePlanetControlsVisibility): yellow ring while the eyepiece view is on, filled while
// the panel is open, disabled while a Catalog photo is presented. The panel and the search's close
// each other. Its first opening puts in the setup used last (_nsEqLast) or the default; later
// openings keep what the panel holds, so an edit survives closing it. The setup list's name stays
// on the panel's setup only while its values match the saved ones; an edited one is unsaved.
// Visual / Imaging (_nsEq.mode) shows the Eyepiece or the Sensor group; Telescope and Barlow /
// reducer are shared, and each mode's own fields keep their text while hidden, so switching back
// finds them as left. The setup list shows the mode's setups only (_nsEq.sel: each mode's choice).
const NS_EQ_ALL_FIELDS = [...new Set(NS_EQ_FIELDS.concat(NS_EQ_IMG_FIELDS))];
const NS_EQ_BTN_TITLE = 'Equipment: a telescope with an eyepiece or a camera on the sky';
function _nsEqPanelEl() { return document.getElementById('nightSkyEquipmentPanel'); }
function _nsEqSetOpen(on) {
  if (on && document.getElementById('btnNightSkyEquipment').disabled) on = false;
  _nsEq.open = on;
  _nsEqPanelEl().classList.toggle('open', on);
  const btn = document.getElementById('btnNightSkyEquipment');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  if (on) {
    if (typeof _nsSearchSetOpen === 'function' && _nsSearch.open) _nsSearchSetOpen(false);   // render-search.js
    if (!_nsEq.loaded) {
      const last = _nsEqSetups().find(x => x.name === _nsEqLast());
      _nsEqPutFields(NS_EQ_IMG_DEFAULT);   // both modes' fields filled, the last setup over them
      _nsEqPutFields(NS_EQ_DEFAULT);
      _nsEqLoadIntoPanel(last || NS_EQ_DEFAULT);
    } else _nsEqRefreshPanel();
    _nsEqNote('');
    _nsEqPanelEl().focus({ preventScroll: true });   // Escape works at once (no keyboard pops up on touch)
  }
}
function _nsEqNote(text) {
  document.getElementById('nightSkyEquipmentNote').textContent = text || '';
}
// The setup list: "(unsaved)" and the saved names, the given one selected
function _nsEqFillList(name) {
  const sel = document.getElementById('nightSkyEquipmentSetup');
  sel.textContent = '';
  const opts = [['', '(unsaved)']].concat(_nsEqSetups().filter(x => x.mode === _nsEq.mode).map(x => [x.name, x.name]));
  for (const [v, t] of opts) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = opts.some(o => o[0] === name) ? name : '';
}
function _nsEqPutFields(setup) {
  const p = _nsEqPanelEl();
  for (const k of _nsEqFields(setup)) p.querySelector(`[data-eq=${k}]`).value = String(setup[k]);
}
function _nsEqShowMode(mode) {
  if (mode !== _nsEq.mode) _nsEq.sel[_nsEq.mode] = document.getElementById('nightSkyEquipmentSetup').value;   // the list's choice
  _nsEq.mode = mode;
  const p = _nsEqPanelEl();
  for (const g of p.querySelectorAll('[data-eq-group]')) g.hidden = g.dataset.eqGroup !== mode;
  for (const b of p.querySelectorAll('[data-eq-mode]')) {
    b.classList.toggle('active', b.dataset.eqMode === mode);
    b.setAttribute('aria-pressed', String(b.dataset.eqMode === mode));
  }
}
function _nsEqSetMode(mode) {
  if (mode === _nsEq.mode) return;
  _nsEqShowMode(mode);
  _nsEqFillList(_nsEq.sel[mode]);
  _nsEqRefreshPanel();
}
function _nsEqLoadIntoPanel(setup) {
  _nsEq.loaded = true;
  _nsEqShowMode(setup.mode === 'imaging' ? 'imaging' : 'visual');
  _nsEqPutFields(setup);
  _nsEqFillList(setup.name || '');
  _nsEqRefreshPanel();
}
// The panel's setup; a field that is not a positive number stays NaN (_nsEqValid fails)
function _nsEqReadPanel() {
  const p = _nsEqPanelEl(), s = { name: '', mode: _nsEq.mode };
  for (const k of _nsEqFields(s)) s[k] = _nsEqNum(p.querySelector(`[data-eq=${k}]`).value);
  const name = document.getElementById('nightSkyEquipmentSetup').value;
  const saved = name && _nsEqSetups().find(x => x.name === name);
  if (saved && _nsEqSame(saved, s)) s.name = name;
  return s;
}
const _nsEqFmt = (v, d) => v.toFixed(d);
// Fields marked, figures, buttons: on every keystroke and every change of the setups shown
// The stars in the field end where the catalogues do (mag 8, NS_EQ_CATALOGUE_MAG); a setup reaching
// further (its limiting magnitude 7.5 + 5·log10(D / 10 mm), a camera's by the same aperture) is told so
const NS_EQ_CATALOGUE_MAG = 8;
function _nsEqCatalogueNote(s, note) {
  const lim = _nsEqApertureGain(s) + NIGHTSKY_MAG_LIMIT_OFF;
  if (lim > NS_EQ_CATALOGUE_MAG) note(`stars to mag ${NS_EQ_CATALOGUE_MAG} shown (the catalogue's end); this setup reaches about ${_nsEqFmt(lim, 1)}${_nsEqIsImaging(s) ? ' by eye, a camera fainter' : ''}`);
}
function _nsEqRefreshPanel() {
  const p = _nsEqPanelEl(), s = _nsEqReadPanel(), ok = _nsEqValid(s);
  for (const k of _nsEqFields(s)) {
    const bad = !(s[k] > 0) || ((k === 'sensorW' || k === 'sensorH') && !Number.isInteger(s[k]));
    p.querySelector(`[data-eq=${k}]`).classList.toggle('invalid', bad);
  }
  const out = document.getElementById('nightSkyEquipmentOut');
  out.textContent = '';
  const row = (k, v, warn) => {
    const a = document.createElement('span'), b = document.createElement('span');
    a.className = 'ns-eq-k'; a.textContent = k;
    b.className = 'ns-eq-v' + (warn ? ' ns-eq-warn' : ''); b.textContent = v;
    out.append(a, b);
  };
  const note = (t) => { const w = document.createElement('span'); w.className = 'ns-eq-w'; w.textContent = t; out.append(w); };
  if (ok && _nsEqIsImaging(s)) {
    const c = _nsEqComputeImaging(s), am = v => _nsEqFmt(v * 60, 1) + '′';
    row('Sensor', `${_nsEqFmt(c.sensorWmm, 1)} × ${_nsEqFmt(c.sensorHmm, 1)} mm`);
    row('Pixel', _nsEqFmt(c.pixelUm, 2) + ' µm');
    row('Field', `${_nsEqFmt(c.fovW, 2)}° × ${_nsEqFmt(c.fovH, 2)}°`);
    if (c.fovW < 1) row('', `${am(c.fovW)} × ${am(c.fovH)}`);
    row('Scale', _nsEqFmt(c.scale, 2) + '″/px');
    row('Focal ratio', 'f/' + _nsEqFmt(c.fRatio, 1));
    _nsEqCatalogueNote(s, note);
  } else if (ok) {
    const c = _nsEqCompute(s);
    row('Magnification', _nsEqFmt(c.mag, 1) + '×', c.magWarn);
    if (c.magWarn) note('above the highest useful ' + _nsEqFmt(c.maxMag, 0) + '×');
    row('True field', _nsEqFmt(c.tfov, 2) + '°');
    row('Exit pupil', _nsEqFmt(c.pupil, 1) + ' mm', c.pupilWarn);
    if (c.pupilWarn) note('wider than the eye\'s pupil (7 mm)');
    row('Focal ratio', 'f/' + _nsEqFmt(c.fRatio, 1));
    row('Highest useful', _nsEqFmt(c.maxMag, 0) + '×');
    row('Limiting mag', _nsEqFmt(c.limMag, 1));
    _nsEqCatalogueNote(s, note);
  } else row(_nsEqIsImaging(s) ? 'Enter positive numbers, whole pixels' : 'Enter positive numbers', '');
  const full = _nsEq.shown.length >= NS_EQ_MAX, dup = ok && _nsEq.shown.some(e => _nsEqSame(e.setup, s));
  const apply = p.querySelector('[data-eq-act=apply]'), add = p.querySelector('[data-eq-act=add]');
  apply.disabled = !ok;
  add.disabled = !ok || full || dup;
  add.title = full ? `The comparison is full (${NS_EQ_MAX} setups)` : dup ? 'This setup is already shown' : 'Show it together with the setups shown';
  p.querySelector('[data-eq-act=off]').disabled = !_nsEq.shown.length;
  p.querySelector('[data-eq-act=save]').disabled = !ok;
  p.querySelector('[data-eq-act=saveas]').disabled = !ok;
  p.querySelector('[data-eq-act=delete]').disabled = !document.getElementById('nightSkyEquipmentSetup').value;
}
function _nsEqSyncButton() {
  const btn = document.getElementById('btnNightSkyEquipment');
  const blocked = !!_nightSkyActiveFrame;
  btn.disabled = blocked;
  btn.title = blocked ? 'Equipment unavailable while a Catalog photo is shown' : NS_EQ_BTN_TITLE;
  btn.classList.toggle('on', _nsEq.shown.length > 0);
  _nsEqChips();
  if (typeof _nsEqMountSync === 'function') _nsEqMountSync();
  if (blocked && _nsEq.open) _nsEqSetOpen(false);
  if (_nsEq.open) _nsEqRefreshPanel();
}
function _nsEqStoredNote(ok) {
  _nsEqNote(ok ? '' : 'The browser blocks storage: setups are kept until the page closes.');
}
function _nsEqSave(name) {
  const s = _nsEqReadPanel();
  if (!_nsEqValid(s) || !name) return;
  const list = _nsEqSetups().filter(x => x.name !== name);
  const entry = Object.assign({}, s, { name });
  const old = _nsEqSetups().findIndex(x => x.name === name);
  if (old >= 0) list.splice(old, 0, entry); else list.push(entry);   // an overwrite keeps its place
  const ok = _nsEqStoreSetups(list);
  _nsEqSetLast(name);
  // a shown setup with these values takes the name (its chip)
  const named = _nsEq.shown.filter(e => _nsEqSame(e.setup, entry) && e.setup.name !== name);
  named.forEach(e => { e.setup.name = name; });
  if (named.length) _nsEqChanged();
  _nsEqFillList(name);
  _nsEqRefreshPanel();
  _nsEqStoredNote(ok);
}
function _nsEqAct(act) {
  const s = _nsEqReadPanel(), sel = document.getElementById('nightSkyEquipmentSetup');
  if (act === 'apply' && _nsEqValid(s)) {
    _nsEqApply(s);
    if (s.name) _nsEqSetLast(s.name);
    _nsEqSetOpen(false);
  } else if (act === 'add' && _nsEqValid(s)) {
    if (_nsEqAdd(s) && s.name) _nsEqSetLast(s.name);
  } else if (act === 'off') {
    _nsEqOff();
  } else if (act === 'save') {
    if (sel.value) _nsEqSave(sel.value); else _nsEqAct('saveas');
  } else if (act === 'saveas') {
    const list = _nsEqSetups();
    const name = (prompt('Setup name', _nsEqNextName(list)) || '').trim();
    if (!name) return;
    const other = list.find(x => x.name === name && x.mode !== _nsEq.mode);   // not in this mode's list
    if (other) { _nsEqNote(`"${name}" is a ${other.mode === 'imaging' ? 'Imaging' : 'Visual'} setup. Choose another name.`); return; }
    if (list.some(x => x.name === name) && !confirm(`Replace the setup "${name}"?`)) return;
    _nsEqSave(name);
  } else if (act === 'delete') {
    const name = sel.value;
    if (!name || !confirm(`Delete the setup "${name}"?`)) return;
    const ok = _nsEqStoreSetups(_nsEqSetups().filter(x => x.name !== name || x.mode !== _nsEq.mode));
    if (_nsEqLast() === name) _nsEqSetLast('');
    _nsEqFillList('');
    _nsEqRefreshPanel();
    _nsEqStoredNote(ok);
  }
}

// ── The chips of the setups shown ───────────────────────────────────────────────────────────────
// #nightSkyEquipmentChips, bottom centre, while the eyepiece view is on in the Planetarium (as
// the mask: not under a Catalog photo). Text: the setup's name, or its eyepiece's focal length
// when unsaved, then magnification, true field and exit pupil. Normally 12 px above the canvas's
// bottom between the time box and the round buttons; when the chips would meet either (a narrow
// window, the Atmosphere hint), above the time box. _nsEqChips() runs on every change of the
// setups shown, of the view's controls (_nsEqSyncButton) and on every Planetarium frame
// (_nsEqDraw), but rebuilds only when the setups changed (_nsEq.ver) or the chips come back, with
// no layout read otherwise; a ResizeObserver on the canvas and the time box places them again.
// Above them, the object the view is locked on (_nsEqPickLock), also in Orbit EARTH / MOON and
// with no setup shown; its x releases the lock (the picker stays on).
let _nsEqChipsVer = -1;
function _nsEqChipText(s) {
  if (_nsEqIsImaging(s)) {
    const c = _nsEqComputeImaging(s), angle = typeof _nsEqMountLabel === 'function' ? ' · ' + _nsEqMountLabel() : '';
    return `${s.name || s.sensorW + '×' + s.sensorH} · ${_nsEqFmt(c.fovW, 2)}° × ${_nsEqFmt(c.fovH, 2)}° · ${_nsEqFmt(c.scale, 2)}″/px${angle}`;
  }
  const c = _nsEqCompute(s);
  return `${s.name || s.eyepieceFocal + ' mm'} · ${_nsEqFmt(c.mag, 1)}× · ${_nsEqFmt(c.tfov, 2)}° · pupil ${_nsEqFmt(c.pupil, 1)} mm`;
}
// The eyepiece view is on screen: setups shown, the Planetarium drawn (the canvas's own display
// too: exitNightSky() hides it while nightSkyActive is still true), no Catalog photo
function _nsEqViewOn() {
  return _nsEq.shown.length > 0 && nightSkyActive && nightSkyTopView === 'visualization'
    && nightSkySubmode === 'planetarium' && !_nightSkyActiveFrame
    && document.getElementById('nightSkyCanvas').style.display !== 'none';
}
// The object the picker or the search locked on (render-search.js), its chip above the setups':
// Planetarium and Orbit EARTH / MOON, the view on screen (no uncalibrated framed Catalog photo; an
// all-sky photo or a calibrated framed one keeps it); a plain point has none
function _nsEqPickLock() {
  const L = _nightSkyPicker.lock, cv = document.getElementById('nightSkyCanvas');
  const sub = nightSkySubmode === 'planetarium' || (nightSkySubmode === 'globe' && _nsGlobe.body !== 'sun');
  const f = _nightSkyActiveFrame;
  return L && L.label && _nightSkyPicker.active && nightSkyActive && nightSkyTopView === 'visualization' && sub
    && (!f || _nightSkyFramePickable(f)) && cv.style.display !== 'none' ? L : null;
}
// Its text: the name and the search's type (a planet's magnitude and distance move with the time)
function _nsEqPickText(L) {
  const list = typeof _nsSnapList === 'function' ? _nsSnapList() : null;
  const e = list && list.find(q => q.lock === L || q.globeLock === L);
  return e ? `${L.label} · ${e.info.type()}` : L.label;
}
let _nsEqPickTextEl = null, _nsEqPickShown = null;   // the object chip's text, its lock
function _nsEqChips() {
  const box = document.getElementById('nightSkyEquipmentChips');
  const on = _nsEqViewOn(), pick = _nsEqPickLock();
  if (!on && !pick) {
    if (_nsEqChipsVer !== -1) { box.style.display = 'none'; _nsEqChipsVer = -1; _nsEqPickShown = null; }
    return;
  }
  const ver = on ? _nsEq.ver : 'none';
  if (_nsEqChipsVer === ver && _nsEqPickShown === pick) {   // the same chips: only the object's text follows the time
    if (pick && _nsEqPickTextEl) { const t = _nsEqPickText(pick); if (_nsEqPickTextEl.textContent !== t) _nsEqPickTextEl.textContent = t; }
    return;
  }
  _nsEqChipsVer = ver; _nsEqPickShown = pick;
  box.style.display = 'flex';
  box.textContent = '';
  if (on) _nsEq.shown.forEach((e, i) => {
    const chip = document.createElement('div'), dot = document.createElement('span');
    const text = document.createElement('span'), x = document.createElement('button');
    chip.className = 'ns-eq-chip';
    chip.style.setProperty('--eq', e.color);
    dot.className = 'ns-eq-dot';
    text.className = 'ns-eq-chip-text';
    text.textContent = _nsEqChipText(e.setup);
    text.title = 'Open this setup in the panel';
    text.addEventListener('click', () => { _nsEqLoadIntoPanel(e.setup); _nsEqSetOpen(true); });
    x.type = 'button'; x.textContent = '×'; x.title = 'Remove from the view'; x.setAttribute('aria-label', 'Remove');
    x.addEventListener('click', () => _nsEqRemove(i));
    chip.append(dot, text, x);
    box.appendChild(chip);
  });
  _nsEqPickTextEl = null;
  if (pick) {   // last, so above the setups (the box stacks upward)
    const chip = document.createElement('div'), mark = document.createElement('span');
    const text = document.createElement('span'), x = document.createElement('button');
    chip.className = 'ns-eq-chip ns-pick-chip';
    chip.style.setProperty('--eq', '#ff5050');
    mark.className = 'ns-pick-mark'; mark.setAttribute('aria-hidden', 'true');
    text.className = 'ns-pick-chip-text';
    text.textContent = _nsEqPickText(pick);
    x.type = 'button'; x.textContent = '×'; x.title = 'Release the view from this object'; x.setAttribute('aria-label', 'Release');
    x.addEventListener('click', () => { _nightSkyPicker.lock = null; drawNightSky(); });
    chip.append(mark, text, x);
    box.appendChild(chip);
    _nsEqPickTextEl = text;
  }
  _nsEqPlaceChips();
}
function _nsEqPlaceChips() {
  const box = document.getElementById('nightSkyEquipmentChips');
  if (box.style.display === 'none' || !box.firstChild) return;
  box.style.bottom = '12px';
  const r = box.getBoundingClientRect();
  const meets = (el) => {
    if (!el.offsetWidth) return false;   // hidden
    const q = el.getBoundingClientRect();
    return !(r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom);
  };
  if (['nightSkyTimeWrap', 'btnNightSkySearch', 'btnNightSkyPicker', 'btnNightSkyEquipment'].some(id => meets(document.getElementById(id))))
    box.style.bottom = (document.getElementById('nightSkyTimeWrap').offsetHeight + 12 + 6) + 'px';
}
if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(_nsEqPlaceChips);
  ro.observe(document.getElementById('nightSkyCanvas'));
  ro.observe(document.getElementById('nightSkyTimeWrap'));
}

document.getElementById('btnNightSkyEquipment').addEventListener('click', (e) => {
  e.stopPropagation();
  _nsEqSetOpen(!_nsEq.open);
});
for (const k of NS_EQ_ALL_FIELDS) _nsEqPanelEl().querySelector(`[data-eq=${k}]`).addEventListener('input', _nsEqRefreshPanel);
for (const b of _nsEqPanelEl().querySelectorAll('[data-eq-mode]')) b.addEventListener('click', () => _nsEqSetMode(b.dataset.eqMode));
_nsEqPanelEl().addEventListener('click', (e) => {
  const b = e.target.closest('[data-eq-act]');
  if (b && !b.disabled) _nsEqAct(b.dataset.eqAct);
});
_nsEqPanelEl().addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { _nsEqSetOpen(false); e.stopPropagation(); }
  else if (e.key === 'Enter' && e.target.dataset.eq) { _nsEqAct('apply'); e.preventDefault(); }
});
document.getElementById('nightSkyEquipmentSetup').addEventListener('change', (e) => {
  const saved = _nsEqSetups().find(x => x.name === e.target.value);
  if (saved) { _nsEqLoadIntoPanel(saved); _nsEqSetLast(saved.name); } else _nsEqRefreshPanel();
});
_nsEqSyncButton();
