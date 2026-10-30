// ─── Location from the globe (SELECT next to SET HERE) ──────────────────────────────────────────
// SELECT opens #locPickWin over the canvas column, whatever mode is active: the Earth of the Globe
// view (render-nightsky-globe.js: Natural Earth 1:110m land and lakes, its equirectangular
// texture), with no external map service. An orthographic view, centred at first on the current
// Location: drag (one finger) turns it, the wheel or two fingers zoom (1x-20x), a click or tap sets
// the Location. Over the Earth the cursor is a pin with its tip on the point, off it the arrow.
// Over the Earth the point under the tip shows in the Latitude / Longitude fields in grey and the
// N|S and E|W switches follow it; off the Earth the fields return to the Location. A click sets
// the Location there (_locHereApply, controls.js, the same path as SET HERE) and a pressure wave
// spreads from the point over the globe: three rings growing along the surface; when it ends the
// fields turn from grey to their normal colour. Any other change of the Location (fields, arrows,
// N|S and E|W, SET HERE) moves the pin too (_locHereStale, controls.js). The window closes with its
// × or another click on SELECT (light blue while the window is open), Escape, or when the view
// under it changes: another mode, sub-view, sub-mode, 3D switch, event, or Gallery image
// (_locPickViewKey, checked after every click, change, key and pointer release).
// Drawn here, not through the Globe renderer: no Sun, Moon or sky, the texture without snow, the
// limb a little darker, a graticule (30°, 10° and 5° as the zoom grows) and the Location's pin.
// The same window shows the Eclipse map (render-eclipse-map.js, opened from Eclipse
// Visualization): the event's path and lines over the Earth, picking the same way.
const LOC_PICK_ZOOM_MIN = 1, LOC_PICK_ZOOM_MAX = 20;
const LOC_PICK_MAX_PX = 1600000;       // buffer pixels at most at rest (beyond: smoothed up)
const LOC_PICK_MAX_PX_MOVING = 220000; // while dragged or pinched
const LOC_PICK_WAVE_MS = 1300, LOC_PICK_WAVE_RINGS = 3, LOC_PICK_WAVE_GAP_MS = 190;
const LOC_PICK_WAVE_DEG = 14;          // angular radius a ring reaches at zoom 1 (less when zoomed)
const _locPick = {
  open: false, lon0: 0, lat0: 0, zoom: 1,
  ecl: null,           // the event id while the window shows its Eclipse map
  drag: null,          // {x, y, lon0, lat0, moved}
  hover: null,         // {lat, lon} under the pin, or null
  wave: null,          // {lat, lon, t0, zoom}
  cache: { key: null, cv: null },
  moving: false,       // dragged or pinched: the disc at a lower resolution
  raf: 0,
};
const D2R_LP = Math.PI / 180;

function _locPickVec(lon, lat) {
  const l = lon * D2R_LP, b = lat * D2R_LP;
  return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}
// The view: centre direction c, east e and north n at the centre; the disc's centre and radius.
function _locPickView(w, h) {
  const l = _locPick.lon0 * D2R_LP, b = _locPick.lat0 * D2R_LP;
  return {
    c: [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)],
    e: [-Math.sin(l), Math.cos(l), 0],
    n: [-Math.sin(b) * Math.cos(l), -Math.sin(b) * Math.sin(l), Math.cos(b)],
    cx: w / 2, cy: h / 2, R: 0.44 * Math.min(w, h) * _locPick.zoom,
  };
}
function _locPickProject(V, p) {   // a unit vector -> {x, y, z}; z < 0 on the far side
  return {
    x: V.cx + V.R * (p[0] * V.e[0] + p[1] * V.e[1] + p[2] * V.e[2]),
    y: V.cy - V.R * (p[0] * V.n[0] + p[1] * V.n[1] + p[2] * V.n[2]),
    z: p[0] * V.c[0] + p[1] * V.c[1] + p[2] * V.c[2],
  };
}
function _locPickUnproject(V, x, y) {   // a canvas point -> {lat, lon}, or null off the Earth
  const u = (x - V.cx) / V.R, v = -(y - V.cy) / V.R, rr = u * u + v * v;
  if (rr > 1) return null;
  const z = Math.sqrt(1 - rr);
  const px = u * V.e[0] + v * V.n[0] + z * V.c[0];
  const py = u * V.e[1] + v * V.n[1] + z * V.c[1];
  const pz = u * V.e[2] + v * V.n[2] + z * V.c[2];
  return { lat: Math.asin(Math.max(-1, Math.min(1, pz))) / D2R_LP, lon: Math.atan2(py, px) / D2R_LP };
}

// ── Drawing ─────────────────────────────────────────────────────────────────────────────────────
// The disc (texture per pixel, limb-darkened) is cached per view; the graticule, the pin and the
// wave are drawn over it on every frame. No coastline is drawn: the fill's edge is the coast, and
// it follows the coast rather than the texture's cells (2048 x 1024, ~0.18° each): the land share
// is interpolated between the four nearest cells (the texture's edge cells hold their antialiased
// share) and cut at a half over about one screen pixel, so zoomed in the edge stays sharp instead
// of showing blurred steps.
function _locPickDrawEarth(w, h, res, V) {
  const lt = document.body.classList.contains('light');
  const key = [w, h, res, _locPick.lon0, _locPick.lat0, _locPick.zoom, lt, !!_nsGlobeTex, _locPick.moving].join('|');
  const C = _locPick.cache;
  if (C.key === key) return C.cv;
  const cv = C.cv || (C.cv = document.createElement('canvas'));
  cv.width = Math.round(w * res); cv.height = Math.round(h * res);
  const ctx = cv.getContext('2d');
  ctx.setTransform(res, 0, 0, res, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const x0 = Math.max(0, V.cx - V.R), y0 = Math.max(0, V.cy - V.R);
  const bw = Math.min(w, V.cx + V.R) - x0, bh = Math.min(h, V.cy + V.R) - y0;
  if (_nsGlobeTex && bw > 0 && bh > 0) {
    const q = Math.min(res, Math.sqrt((_locPick.moving ? LOC_PICK_MAX_PX_MOVING : LOC_PICK_MAX_PX) / (bw * bh)));
    const sw = Math.max(1, Math.ceil(bw * q)), sh = Math.max(1, Math.ceil(bh * q));
    const img = new ImageData(sw, sh), px = img.data;
    const { w: TW, h: TH, data: T } = _nsGlobeTex;
    const O = NS_GLOBE_OCEAN, Ld = NS_GLOBE_LAND, span = Ld[0] - O[0];
    const share = (x, y) => (T[(y * TW + x) * 4] - O[0]) / span;   // 0 sea .. 1 land
    const texPerPx = TW / (2 * Math.PI) / (q * V.R);   // texture cells per buffer pixel at the centre
    for (let j = 0; j < sh; j++) {
      const v = -((y0 + (j + 0.5) / q) - V.cy) / V.R;
      for (let i = 0; i < sw; i++) {
        const u = ((x0 + (i + 0.5) / q) - V.cx) / V.R, rr = u * u + v * v;
        if (rr > 1) continue;
        const z = Math.sqrt(1 - rr);
        const X = u * V.e[0] + v * V.n[0] + z * V.c[0];
        const Y = u * V.e[1] + v * V.n[1] + z * V.c[1];
        const Z = u * V.e[2] + v * V.n[2] + z * V.c[2];
        const lat = Math.asin(Math.max(-1, Math.min(1, Z))) / D2R_LP;
        const lon = Math.atan2(Y, X) / D2R_LP;
        // the four cells round the point (centres at +0.5), longitude wrapping
        const fx = (lon + 180) / 360 * TW - 0.5, fy = Math.max(0, Math.min(TH - 1.001, (90 - lat) / 180 * TH - 0.5));
        const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
        const x1 = ((ix % TW) + TW) % TW, x2 = (x1 + 1) % TW, y2 = Math.min(TH - 1, iy + 1);
        const f = (share(x1, iy) * (1 - ax) + share(x2, iy) * ax) * (1 - ay)
                + (share(x1, y2) * (1 - ax) + share(x2, y2) * ax) * ay;
        const hw = Math.min(0.5, Math.max(0.03, 0.5 * texPerPx / Math.max(z, 0.15)));
        let a = (f - 0.5 + hw) / (2 * hw); a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
        const k = 0.62 + 0.38 * z;   // limb darkening: reads as a sphere
        const o = (j * sw + i) * 4;
        px[o] = (O[0] + (Ld[0] - O[0]) * a) * k;
        px[o + 1] = (O[1] + (Ld[1] - O[1]) * a) * k;
        px[o + 2] = (O[2] + (Ld[2] - O[2]) * a) * k;
        px[o + 3] = 255;
      }
    }
    const off = document.createElement('canvas'); off.width = sw; off.height = sh;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, x0, y0, sw / q, sh / q);
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2);
  ctx.strokeStyle = lt ? 'rgba(0,0,0,0.45)' : 'rgba(160,200,240,0.45)'; ctx.lineWidth = 1; ctx.stroke();
  C.key = key;
  return cv;
}
// Polylines of unit vectors, broken where they pass to the far side.
function _locPickStrokeLines(ctx, V, lines) {
  ctx.beginPath();
  for (const line of lines) {
    let pen = false;
    for (const p of line) {
      const s = _locPickProject(V, p);
      if (s.z < 0) { pen = false; continue; }
      if (pen) ctx.lineTo(s.x, s.y); else { ctx.moveTo(s.x, s.y); pen = true; }
    }
  }
  ctx.stroke();
}
function _locPickGraticule(ctx, V) {
  const step = _locPick.zoom >= 6 ? 5 : _locPick.zoom >= 2.5 ? 10 : 30;
  const minor = [], major = [];
  for (let lat = -90 + step; lat < 90; lat += step) {
    const line = [];
    for (let lon = -180; lon <= 180; lon += 2) line.push(_locPickVec(lon, lat));
    (lat === 0 ? major : minor).push(line);
  }
  for (let lon = -180; lon < 180; lon += step) {
    const line = [];
    for (let lat = -90; lat <= 90; lat += 2) line.push(_locPickVec(lon, lat));
    (lon === 0 ? major : minor).push(line);
  }
  ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(200,220,240,0.16)';
  _locPickStrokeLines(ctx, V, minor);
  ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(200,220,240,0.34)';
  _locPickStrokeLines(ctx, V, major);
}
// A circle on the sphere: angular radius a (deg) round the unit vector C.
function _locPickCircle(C, a) {
  const ref = Math.abs(C[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1 = [C[1] * ref[2] - C[2] * ref[1], C[2] * ref[0] - C[0] * ref[2], C[0] * ref[1] - C[1] * ref[0]];
  const l = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map(v => v / l);
  const e2 = [C[1] * e1[2] - C[2] * e1[1], C[2] * e1[0] - C[0] * e1[2], C[0] * e1[1] - C[1] * e1[0]];
  const ca = Math.cos(a * D2R_LP), sa = Math.sin(a * D2R_LP), pts = [];
  for (let k = 0; k <= 96; k++) {
    const f = k / 96 * Math.PI * 2, cf = Math.cos(f), sf = Math.sin(f);
    pts.push([0, 1, 2].map(i => ca * C[i] + sa * (cf * e1[i] + sf * e2[i])));
  }
  return pts;
}
function _locPickDrawPin(ctx, V, lat, lon, col) {
  const s = _locPickProject(V, _locPickVec(lon, lat));
  if (s.z < 0) return;
  ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
}
function _locPickDraw() {
  _locPick.raf = 0;
  if (!_locPick.open) return;
  const cv = document.getElementById('locPickCanvas');
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const res = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  if (cv.width !== Math.round(w * res) || cv.height !== Math.round(h * res)) {
    cv.width = Math.round(w * res); cv.height = Math.round(h * res);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  const V = _locPickView(w, h);
  ctx.drawImage(_locPickDrawEarth(w, h, res, V), 0, 0);
  ctx.setTransform(res, 0, 0, res, 0, 0);
  if (!_nsGlobeTex) {
    ctx.fillStyle = '#8899aa'; ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Loading the Earth…', w / 2, h / 2);
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  _locPickGraticule(ctx, V);
  ctx.restore();
  if (_locPick.ecl && typeof _eclMapDraw === 'function') _eclMapDraw(ctx, V, w, h);
  _locPickDrawPin(ctx, V, hemisphere * LAT, lonHemisphere * LONG, '#e84040');   // the Location
  const W = _locPick.wave;
  if (W) {   // the pressure wave: rings growing along the surface, fading as they go
    const t = performance.now() - W.t0, C = _locPickVec(W.lon, W.lat);
    const reach = LOC_PICK_WAVE_DEG / Math.sqrt(W.zoom);
    for (let k = 0; k < LOC_PICK_WAVE_RINGS; k++) {
      const f = (t - k * LOC_PICK_WAVE_GAP_MS) / (LOC_PICK_WAVE_MS - (LOC_PICK_WAVE_RINGS - 1) * LOC_PICK_WAVE_GAP_MS);
      if (f <= 0 || f >= 1) continue;
      const ease = 1 - Math.pow(1 - f, 3);
      ctx.lineWidth = 2.2 * (1 - f) + 0.6;
      ctx.strokeStyle = `rgba(140,210,255,${(0.85 * (1 - f) * (1 - f)).toFixed(3)})`;
      _locPickStrokeLines(ctx, V, [_locPickCircle(C, Math.max(0.05, reach * ease))]);
    }
    if (t < LOC_PICK_WAVE_MS) _locPickRequest();
    else { _locPick.wave = null; _locPickSettled(); }
  }
  if (!_nsGlobeTex) _locPickRequest();   // until the land data is in
}
function _locPickRequest() {
  if (!_locPick.raf) _locPick.raf = requestAnimationFrame(_locPickDraw);
}

// ── The fields: grey preview of the point under the pin ─────────────────────────────────────────
function _locPickShowHemi(latSigned, lonSigned) {
  const n = latSigned >= 0, e = lonSigned >= 0;
  document.getElementById('btnN').className = n ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnS').className = n ? 'ns-btn' : 'ns-btn active-s';
  document.getElementById('btnE').className = e ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnW').className = e ? 'ns-btn' : 'ns-btn active-s';
}
function _locPickPreview(p) {
  if (_locPick.wave) return;   // the picked values stay until the wave ends
  const lat = document.getElementById('inpLat'), lon = document.getElementById('inpLong');
  if (p) {
    _locFormatInput('inpLat', Math.abs(p.lat));
    _locFormatInput('inpLong', Math.abs(p.lon));
    lat.classList.add('loc-preview'); lon.classList.add('loc-preview');
    _locPickShowHemi(p.lat, p.lon);
  } else _locPickRestoreFields();
}
function _locPickRestoreFields() {
  const lat = document.getElementById('inpLat'), lon = document.getElementById('inpLong');
  lat.classList.remove('loc-preview'); lon.classList.remove('loc-preview');
  _locFormatInput('inpLat', LAT);
  _locFormatInput('inpLong', LONG);
  _locPickShowHemi(hemisphere, lonHemisphere);
}
function _locPickSettled() {   // the wave is over: the fields to their normal colour
  _locPickRestoreFields();
  if (_locPick.hover) _locPickPreview(_locPick.hover);
}

// ── Opening, closing, input ─────────────────────────────────────────────────────────────────────
// ecl: an event id for its Eclipse map, else the plain globe of SELECT. Opened again while open,
// the window only changes what it shows, the view stays; the Eclipse map, newly shown, turns to
// the Greatest Eclipse point.
// What the canvas column shows, as a string: the window closes when it changes.
function _locPickViewKey() {
  const v = (f) => { try { return f(); } catch (e) { return null; } };
  return [
    v(() => currentMode), v(() => _modeWheelIndex), v(() => theaterMode3D), v(() => sunGraphActive),
    v(() => skyDomeActive), v(() => skyDomeProjection), v(() => skyMap3DOn),
    v(() => eclipseActive), v(() => eclipseSubView), v(() => _eclipseActiveEvent && _eclipseActiveEvent.id),
    v(() => nightSkyActive), v(() => nightSkyTopView), v(() => nightSkySubmode), v(() => nightSkyMap3DOn),
    v(() => galleryState.genId), v(() => galleryState.imageIndex), v(() => galleryState.layer),
  ].join('|');
}
function _locPickSetOpen(on, ecl) {
  const was = _locPick.open, wasEcl = _locPick.ecl;
  if (on) _locPick.viewKey = _locPickViewKey();
  _locPick.open = on;
  _locPick.ecl = on ? (ecl || null) : null;
  document.getElementById('locPickWin').classList.toggle('open', on);
  document.getElementById('locPickWin').classList.toggle('ecl', !!_locPick.ecl);
  const plain = on && !_locPick.ecl;
  const btn = document.getElementById('btnLocSelect');
  btn.classList.toggle('open', plain);
  btn.setAttribute('aria-pressed', String(plain));
  // the Eclipse map picks the Location itself: SELECT is off while it is open
  btn.disabled = on && !!_locPick.ecl;
  btn.title = plain ? 'Close the globe' : btn.disabled ? 'The eclipse map sets the Location: click on it'
    : 'Select the Location on a globe of the Earth';
  const head = document.getElementById('locPickTitle');
  if (_locPick.ecl && typeof _eclipseActiveEvent !== 'undefined') {
    const ev = _eclipseActiveEvent;
    head.textContent = 'ECLIPSE MAP ' + ev.year + ' ' + MONTH_NAMES[ev.dayMonth - 1] + ' ' + ev.dayDay;
  } else head.textContent = 'SELECT LOCATION';
  if (on) {
    if (!was) {
      _locPick.lon0 = lonHemisphere * LONG;
      _locPick.lat0 = hemisphere * LAT;
    }
    if (_locPick.ecl && _locPick.ecl !== wasEcl) {
      const g = _eclipseActiveEvent.greatestEclipse;
      _locPick.lon0 = g.lonHemisphere * g.lon;
      _locPick.lat0 = Math.max(-89, Math.min(89, g.hemisphere * g.lat));
      _locPick.zoom = 1;
    }
    _locPick.hover = null;
    _nsGlobeLoad();
    _locPickRequest();
  } else {
    _locPick.drag = null; _locPick.hover = null;
    if (_locPick.wave) _locPick.wave = null;
    _locPickRestoreFields();
  }
}
function _locPickPoint(e) {
  const cv = document.getElementById('locPickCanvas'), r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  return { x, y, p: _locPickUnproject(_locPickView(cv.clientWidth, cv.clientHeight), x, y) };
}
(function () {
  const cv = document.getElementById('locPickCanvas');
  // Pointers down (Pointer Events: mouse, pen, fingers). One drags or, without moving, picks;
  // two pinch-zoom (zoom at their first spread times the change of their distance), and a
  // finger left after a pinch neither turns nor picks. A touch has no hover, so the point under a
  // finger shows in grey while it is down, and the release sets it.
  const pts = new Map();
  let pinch = null, wheelRest = 0;
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const endDrag = () => {
    _locPick.drag = null; cv.classList.remove('dragging');
    if (_locPick.moving && !pinch) { _locPick.moving = false; _locPickRequest(); }   // full resolution again
  };
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    if (pts.size >= 2) {
      endDrag();
      if (pts.size === 2) { pinch = { d: spread(), zoom: _locPick.zoom }; _locPick.moving = true; }
      _locPick.hover = null; _locPickPreview(null);
      return;
    }
    _locPick.drag = { x: e.clientX, y: e.clientY, lon0: _locPick.lon0, lat0: _locPick.lat0, moved: false };
    if (e.pointerType !== 'mouse') { _locPick.hover = _locPickPoint(e).p; _locPickPreview(_locPick.hover); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pts.size === 2) {
        _locPick.zoom = Math.max(LOC_PICK_ZOOM_MIN, Math.min(LOC_PICK_ZOOM_MAX, pinch.zoom * spread() / pinch.d));
        _locPickRequest();
      }
      return;
    }
    const D = _locPick.drag;
    if (D) {
      const dx = e.clientX - D.x, dy = e.clientY - D.y;
      if (!D.moved && Math.hypot(dx, dy) > 4) { D.moved = true; _locPick.moving = true; cv.classList.add('dragging'); _locPick.hover = null; _locPickPreview(null); }
      if (D.moved) {
        const R = _locPickView(cv.clientWidth, cv.clientHeight).R;
        _locPick.lon0 = ((D.lon0 - dx / R / D2R_LP + 540) % 360) - 180;
        _locPick.lat0 = Math.max(-89, Math.min(89, D.lat0 + dy / R / D2R_LP));
        _locPickRequest();
        return;
      }
    }
    if (e.pointerType === 'mouse' || D) { _locPick.hover = _locPickPoint(e).p; _locPickPreview(_locPick.hover); }
    cv.classList.toggle('off-earth', !_locPickPoint(e).p);
  });
  cv.addEventListener('pointerup', (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    const D = _locPick.drag;
    endDrag();
    if (e.pointerType !== 'mouse') { _locPick.hover = null; }
    if (!D || D.moved) { if (e.pointerType !== 'mouse') _locPickPreview(null); return; }
    const p = _locPickPoint(e).p;
    if (!p) { _locPickPreview(null); return; }
    _locHereApply(p.lat, p.lon);   // controls.js: hemispheres + applyLat/applyLong, every view redraws
    _locHereInfo(`Set to ${_locHereShown()} from the globe.`);
    document.getElementById('inpLat').classList.add('loc-preview');
    document.getElementById('inpLong').classList.add('loc-preview');
    _locPick.wave = { lat: p.lat, lon: p.lon, t0: performance.now(), zoom: _locPick.zoom };
    _locPickRequest();
  });
  cv.addEventListener('pointercancel', (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    endDrag();
  });
  cv.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !_locPick.drag) { _locPick.hover = null; _locPickPreview(null); }
  });
  // Safari's own pinch (page zoom) would fight the one above
  cv.addEventListener('gesturestart', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    _locPick.zoom = Math.max(LOC_PICK_ZOOM_MIN, Math.min(LOC_PICK_ZOOM_MAX, _locPick.zoom * Math.exp(-e.deltaY * 0.0015)));
    _locPick.moving = true;   // a run of wheel ticks at the lower resolution, the full one after it
    clearTimeout(wheelRest);
    wheelRest = setTimeout(() => { if (!_locPick.drag && !pinch) { _locPick.moving = false; _locPickRequest(); } }, 180);
    _locPick.hover = _locPickPoint(e).p;
    _locPickPreview(_locPick.hover);
    cv.classList.toggle('off-earth', !_locPick.hover);   // the disc grows or shrinks under the cursor
    _locPickRequest();
  }, { passive: false });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (_locPick.open) _locPickRequest(); }).observe(cv);
})();
document.getElementById('btnLocSelect').addEventListener('click', () => _locPickSetOpen(!_locPick.open));
document.getElementById('btnLocPickClose').addEventListener('click', () => _locPickSetOpen(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _locPick.open && !e.defaultPrevented) _locPickSetOpen(false);
});
// after the handlers of the event that may have switched the view (bubbling, the document last)
['click', 'change', 'keyup', 'pointerup'].forEach((type) => document.addEventListener(type, () => {
  if (_locPick.open && _locPickViewKey() !== _locPick.viewKey) _locPickSetOpen(false);
}));
