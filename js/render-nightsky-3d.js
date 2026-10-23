// ─── Night Sky: Sky Map "3D" ────────────────────────────────────────────────────────────────────
// The Analyzer Sky Dome's orbiting 3D Sky Map (render-skydome.js: _skyMap3D camera, floor pedestal
// and compass rose, perspective projection, far-side "permeability" dimming), adopted for Night
// Sky's Sky Map behind its own 3D switch (#nightSkyMap3DToggleRow). The sky hemisphere is one
// flat, semi-transparent fill in the Sky Map's own sky colour; no stars or constellations (their
// Display checkboxes are disabled meanwhile). The Sun and the Moon (each with its Display
// checkbox): an axis from the centre (the observer) to the body on the sphere, the disc there, and
// with "Sun's path" / "Moon's path" on, the arc of the current pass on the sphere. The planets
// (Display "Planets"): their dots only, no axis, depth-ordered against the Sun as in the Sky Map. The Az/Alt grid, Horizon, Equatorial grid and
// Ecliptic checkboxes keep working; with the Equatorial grid on, the Earth's axis is drawn through
// the centre to the celestial poles. The camera (orbit angle and zoom) is the same object as the
// Analyzer's Sky Map 3D - the two views are never on screen together.

let nightSkyMap3DOn = false;
let _nightSky3DLayout = null;   // last drawn layout (cursor readout)

function _nightSky3DActive() {
  return nightSkyMap3DOn && nightSkyActive && nightSkyTopView === 'visualization' && nightSkySubmode === 'skymap';
}

// The 3D switch is offered in Sky Map only; the zoom slider (#skyMap3DZoomCtl, shared with the
// Analyzer's Sky Map 3D) while 3D is on.
function _nightSkyUpdateMap3DControls() {
  const inSkyMap = nightSkyActive && nightSkyTopView === 'visualization' && nightSkySubmode === 'skymap';
  // Stars and constellations aren't drawn in 3D: their Display rows are disabled (greyed) there.
  const off3D = inSkyMap && nightSkyMap3DOn;
  for (const id of ['chkNightSkyStars', 'chkNightSkyLines']) {
    const c = document.getElementById(id);
    c.disabled = off3D;
    c.parentElement.style.opacity = off3D ? '0.35' : '';
    c.parentElement.style.pointerEvents = off3D ? 'none' : '';
  }
  document.getElementById('nightSkyMap3DToggleRow').style.display = inSkyMap ? 'flex' : 'none';
  if (!(typeof skyDomeActive !== 'undefined' && skyDomeActive)) {
    document.getElementById('skyMap3DZoomCtl').style.display = inSkyMap && nightSkyMap3DOn ? 'flex' : 'none';
  }
  if (inSkyMap && nightSkyMap3DOn) {
    const rng = document.getElementById('skyMap3DZoom');
    rng.value = _skyMap3D.zoom;
    document.getElementById('skyMap3DZoomVal').textContent = _skyMap3D.zoom.toFixed(1) + '×';
  }
}

// The visible hemisphere's front side as one path of small patches, filled once (a single fill
// keeps the translucent colour even, where separately filled patches would darken their shared
// edges).
function _nightSky3DDrawShell(ctx, layout, color) {
  const STEP = 6;
  ctx.beginPath();
  for (let az = 0; az < 360; az += STEP) {
    for (let el = 0; el < 90; el += STEP) {
      const el2 = Math.min(90, el + STEP);
      const mid = _skyDomeUnitVec(az + STEP / 2, (el + el2) / 2);
      if (_sd3Dot(mid, _skyMap3D.camDirUnit) < 1 / _skyMap3D.camDist) continue;   // far side
      const c = [[az, el], [az + STEP, el], [az + STEP, el2], [az, el2]]
        .map(([a, e]) => _skyMap3DProjectRaw(layout, _skyDomeUnitVec(a, e)));
      if (!c.every(Boolean)) continue;
      ctx.moveTo(c[0][0], c[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]);
      ctx.closePath();
    }
  }
  ctx.fillStyle = color;
  ctx.fill('nonzero');
}

// Projected points of an {az, el} list, cut at the horizon - the 3D sky is the upper hemisphere,
// like the flat Sky Map. Where two neighbouring samples lie on opposite sides of the horizon, the
// crossing itself is added (linear interpolation of the two unit vectors, then put back on the
// sphere at el = 0), so a line runs right down to the horizon instead of stopping at its last
// sample above it, a few degrees up in the air; below the horizon the run breaks (null).
function _nightSky3DAbove(layout, pts) {
  const out = [];
  let prev = null;
  for (const p of pts) {
    if (prev && (prev.el >= 0) !== (p.el >= 0)) {
      const t = prev.el / (prev.el - p.el);
      const a = _skyDomeUnitVec(prev.az, 0), b = _skyDomeUnitVec(p.az, 0);   // both on the horizon circle
      const v = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const az = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
      out.push(_skyMap3DProject(layout, az, 0));
    }
    out.push(p.el < 0 ? null : _skyMap3DProject(layout, p.az, p.el));
    prev = p;
  }
  return out;
}

// Az/El of the equatorial grid, the celestial pole and the ecliptic depend only on the instant and
// the place, not on the camera - kept for the last instant, so orbiting and zooming reproject
// cached points instead of converting ~1 000 RA/Dec points on every frame.
let _nightSky3DSkyCache = { key: null };
function _nightSky3DSkyPoints(Y, M, D, H) {
  const key = [Y, M, D, H, LAT, hemisphere, LONG, lonHemisphere].join('|');
  if (_nightSky3DSkyCache.key === key) return _nightSky3DSkyCache;
  const parallels = NIGHTSKY_DEC_PARALLELS.map(dec => {
    const pts = []; for (let ra = 0; ra <= 360; ra += 5) pts.push(_skyOfDateAzEl(ra, dec, Y, M, D, H)); return pts;
  });
  const meridians = [];
  for (let ra = 0; ra < 360; ra += 30) {
    const pts = []; for (let dec = -90; dec <= 90; dec += 5) pts.push(_skyOfDateAzEl(ra, dec, Y, M, D, H)); meridians.push(pts);
  }
  const eps = _moonMeanObliquityDeg(_moonJDE(Y, M, D, H));
  const ecliptic = [];
  for (let lam = 0; lam <= 360; lam += 4) { const q = _moonEclToEq(lam, 0, eps); ecliptic.push(_skyOfDateAzEl(q.ra, q.dec, Y, M, D, H)); }
  // The pole above the horizon: the north celestial pole in the northern hemisphere, the south one
  // in the southern (its altitude is the latitude).
  const pole = _skyOfDateAzEl(0, hemisphere >= 0 ? 90 : -90, Y, M, D, H);
  _nightSky3DSkyCache = { key, parallels, meridians, ecliptic, pole };
  return _nightSky3DSkyCache;
}

function _nightSkyDrawSkyMap3D(ctx, w, h) {
  updateSkyMap3DCamera();
  const lt = document.body.classList.contains('light');
  const pal = lt
    ? { ring: 'rgba(0,0,0,0.16)', rim: 'rgba(0,0,0,0.55)', text: '#445a6e', shell: 'rgba(190,204,222,0.45)' }
    : { ring: 'rgba(255,255,255,0.20)', rim: 'rgba(255,255,255,0.6)', text: '#9fb2c4', shell: 'rgba(0,21,56,0.62)' };
  const mTop = 40, mSide = 34, mBottom = 26;
  const scale = Math.max(10, Math.min(w - 2 * mSide, h - mTop - mBottom) / 2);
  const layout = { mode: 'skymap3d', cx: w / 2, cy: mTop + (h - mTop - mBottom) / 2, scale };
  _nightSky3DLayout = layout;
  const chk = (id) => document.getElementById(id).checked;
  const Y = nightSkyYear, M = nightSkyMonth, D = nightSkyDay, H = nightSkyHourUT;
  const showNames = chk('chkNightSkyNames');

  _skyMap3DDrawFloorAndCompass(ctx, layout, pal, lt);
  _nightSky3DDrawShell(ctx, layout, pal.shell);

  if (chk('chkNightSkyHorizon')) {
    const pts = []; for (let az = 0; az <= 360; az += 5) pts.push(_skyMap3DProject(layout, az, 0));
    ctx.lineWidth = 1.5; ctx.setLineDash([]);
    _skyMap3DStrokePolyline(ctx, pts, pal.rim);
  }

  // Az/Alt grid: the flat Sky Map's spokes every 30° and altitude rings at 30° and 60°.
  if (chk('chkNightSkyGrid')) {
    const col = _nightSkyGridLineColor();
    ctx.lineWidth = 1; ctx.setLineDash([]);
    for (let az = 0; az < 360; az += 30) {
      const pts = []; for (let el = 0; el <= 90; el += 3) pts.push(_skyMap3DProject(layout, az, el));
      _skyMap3DStrokePolyline(ctx, pts, col);
    }
    for (const el of NIGHTSKY_ALT_RINGS) {
      const pts = []; for (let az = 0; az <= 360; az += 5) pts.push(_skyMap3DProject(layout, az, el));
      _skyMap3DStrokePolyline(ctx, pts, col);
    }
    if (showNames) {
      ctx.font = "10px 'Share Tech Mono', monospace"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = _nightSkyGridLabelColors().azAlt;
      for (let az = 0; az < 360; az += 30) {
        if (az % 90 === 0) continue;   // the compass rose names the cardinals
        const p = _skyMap3DProject(layout, az, 0);
        if (p.visible === false) continue;
        const dx = p.x - layout.cx, dy = p.y - layout.cy, len = Math.hypot(dx, dy) || 1;
        ctx.fillText(az + '°', p.x + dx / len * 12, p.y + dy / len * 12);
      }
      ctx.textAlign = 'left';
      for (const el of NIGHTSKY_ALT_RINGS) {
        const p = _skyMap3DProject(layout, 0, el);
        if (p.visible !== false) ctx.fillText(el + '°', p.x + 4, p.y);
      }
    }
  }

  // Equatorial grid (parallels every 30°, meridians every 2 h) and the Earth's axis through the
  // centre, pointing at the celestial poles (true altitude = the latitude; below the floor dimmed).
  if (chk('chkNightSkyEquatorial')) {
    const col = 'rgba(224,120,120,0.55)';
    ctx.lineWidth = 1; ctx.setLineDash([]);
    const sky = _nightSky3DSkyPoints(Y, M, D, H);
    for (const pts of sky.parallels) _skyMap3DStrokePolyline(ctx, _nightSky3DAbove(layout, pts), col);
    for (const pts of sky.meridians) _skyMap3DStrokePolyline(ctx, _nightSky3DAbove(layout, pts), col);
    const pole = sky.pole;
    const P = _skyDomeUnitVec(pole.az, pole.elTrue !== undefined ? pole.elTrue : pole.el);
    const at = (k) => _skyMap3DProjectRaw(layout, [P[0] * k, P[1] * k, P[2] * k]);
    const c0 = at(0), up = at(1.3), down = at(-1.3);
    const axisCol = lt ? 'rgba(160,40,40,0.95)' : 'rgba(240,150,150,0.95)';
    if (c0 && up && down) {
      ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeStyle = axisCol;
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(up[0], up[1]); ctx.stroke();
      ctx.strokeStyle = _sd3WithAlpha(axisCol, 0.95 * _skyMap3DDimMult());
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(down[0], down[1]); ctx.stroke();
      ctx.setLineDash([]);
      if (showNames) {
        ctx.font = "10px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = axisCol;
        ctx.fillText(hemisphere >= 0 ? 'NCP' : 'SCP', up[0] + 5, up[1]);
      }
    }
  }

  if (chk('chkNightSkyEcliptic')) {
    ctx.lineWidth = NIGHTSKY_ECLIPTIC_WIDTH; ctx.setLineDash([]);
    _skyMap3DStrokePolyline(ctx, _nightSky3DAbove(layout, _nightSky3DSkyPoints(Y, M, D, H).ecliptic), NIGHTSKY_ECLIPTIC_COLOR);
  }

  // The Sun and the Moon: path arcs first, then the axes from the centre and the discs.
  const showSun = chk('chkNightSkySun'), showMoon = chk('chkNightSkyMoon');
  const stroke2 = (pts) => {
    ctx.setLineDash([]);
    ctx.lineWidth = 3.5; _skyMap3DStrokePolyline(ctx, pts, NIGHTSKY_SUN_PATH_COLOR_OUTLINE);
  };
  if (showSun && showNightSkySunPath) {
    const pts = _nightSky3DAbove(layout, _nightSkySunPassHours().map(hh => _nightSkySunAzEl(Y, M, D, hh)));
    stroke2(pts); ctx.lineWidth = 1.5; _skyMap3DStrokePolyline(ctx, pts, NIGHTSKY_SUN_PATH_COLOR_FILL);
  }
  if (showMoon && showNightSkyMoonPath) {
    const pts = _nightSky3DAbove(layout, _nightSkyMoonPassHours().map(hh => _moonAzEl(Y, M, D, hh)));
    stroke2(pts); ctx.lineWidth = 1.5; _skyMap3DStrokePolyline(ctx, pts, MOON_PATH_COLOR_FILL);
  }

  const r = _nightSkyBodyMinR();
  const sun = _nightSkySunAzEl(Y, M, D, H), moon = _moonAzEl(Y, M, D, H);
  const cols = _nightSkyBodyLabelColors();
  const axisTo = (b, color) => {   // centre -> body on the sphere; returns the disc point and its dimming
    const p = _skyMap3DProject(layout, b.az, b.el), c0 = _skyMap3DProjectRaw(layout, [0, 0, 0]);
    const dim = p.visible === false ? _skyMap3DDimMult() : 1;
    if (c0) {
      ctx.setLineDash([]); ctx.lineWidth = 1.5;
      ctx.strokeStyle = _sd3WithAlpha(color, dim);
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    return { p, dim };
  };
  const label = (p, text, color, dim) => {
    if (!showNames) return;
    ctx.globalAlpha = dim;
    ctx.font = "11px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color; ctx.fillText(text, p.x + r + 5, p.y - r - 2);
    ctx.globalAlpha = 1;
  };
  // Planets as in the Sky Map (render-planets.js): dots on the sphere, dimmed on the far side,
  // those farther than the Sun before its disc and the nearer ones (a transit) after it.
  const planetAt = (az, el) => { const q = _skyMap3DProject(layout, az, el); return { x: q.x, y: q.y, alpha: q.visible === false ? _skyMap3DDimMult() : 1 }; };
  const drawPlanets = (part) => { if (_planetsWanted()) _planetDrawPart(ctx, part, planetAt, () => r); };
  drawPlanets('behind');
  if (showSun && _nightSkyDiscAboveHorizon(sun.el, _skySunSemiDiamDeg(Y, M, D, H))) {
    const { p, dim } = axisTo(sun, 'rgba(232,160,32,1)');
    ctx.globalAlpha = dim;
    const glR = r * NIGHTSKY_SUN_GLOW_RATIO;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glR);
    g.addColorStop(0, 'rgba(232,160,32,0.60)'); g.addColorStop(1, 'rgba(232,160,32,0)');
    ctx.fillStyle = g; ctx.fillRect(p.x - glR, p.y - glR, glR * 2, glR * 2);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8a020'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;
    label(p, 'Sun', cols.sun, dim);
  }
  drawPlanets('front');
  if (showMoon && _nightSkyDiscAboveHorizon(moon.el, _moonSemiDiamDeg(moon))) {
    const { p, dim } = axisTo(moon, 'rgba(244,234,184,1)');
    // Lit side and Earth's shadow turned as they look in this view (the projection itself).
    const project = (az, el) => { const q = _skyMap3DProject(layout, az, el); return q.visible === false ? null : q; };
    const k = _moonPhase(_moonJDE(Y, M, D, H)).k;
    ctx.save(); ctx.globalAlpha = dim;
    _moonDrawDisc(ctx, p.x, p.y, r, k, _moonBrightLimbAngle(moon, sun, project), _moonShadowOnDisc(moon, r, project));
    ctx.restore();
    label(p, 'Moon', cols.moon, dim);
  }
}

// ── Switch, zoom, orbit drag (mouse, touch, wheel) ──────────────────────────────────────────────
document.getElementById('btnNightSkyMap3D').addEventListener('click', () => {
  nightSkyMap3DOn = !nightSkyMap3DOn;
  const btn = document.getElementById('btnNightSkyMap3D');
  btn.classList.toggle('on', nightSkyMap3DOn);
  btn.setAttribute('aria-checked', String(nightSkyMap3DOn));
  _nightSkyUpdateMap3DControls();
  if (nightSkyActive) drawNightSky();
});
(function () {
  const cv = document.getElementById('nightSkyCanvas');
  let dragging = false, lastX = 0, lastY = 0, pinch = null;
  const redraw = () => { updateSkyMap3DCamera(); drawNightSky(); };
  const start = (x, y) => { dragging = true; lastX = x; lastY = y; cv.style.cursor = 'grabbing'; };
  const move = (x, y) => {
    if (!dragging) return;
    _skyMap3D.camAz += (x - lastX) * 0.005;
    _skyMap3D.camEl = Math.max(0.06, Math.min(Math.PI / 2 - 0.04, _skyMap3D.camEl + (y - lastY) * 0.004));
    lastX = x; lastY = y;
    redraw();
  };
  const end = () => { if (dragging) { dragging = false; cv.style.cursor = ''; } };
  cv.addEventListener('mousedown', (e) => { if (_nightSky3DActive()) { start(e.clientX, e.clientY); e.preventDefault(); } });
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('mouseup', end);
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  cv.addEventListener('touchstart', (e) => {
    if (!_nightSky3DActive()) return;
    if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY);
    else if (e.touches.length === 2) { dragging = false; pinch = { d: dist(e.touches), z: _skyMap3D.zoom }; }
  }, { passive: true });
  cv.addEventListener('touchmove', (e) => {
    if (!_nightSky3DActive()) return;
    if (pinch && e.touches.length === 2) setSkyMap3DZoom(pinch.z * dist(e.touches) / pinch.d);
    else if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  cv.addEventListener('touchend', (e) => { if (e.touches.length === 0) { end(); pinch = null; } });
  cv.addEventListener('wheel', (e) => {
    if (!_nightSky3DActive()) return;
    e.preventDefault();
    setSkyMap3DZoom(_skyMap3D.zoom * Math.pow(1.1, -Math.sign(e.deltaY)));
  }, { passive: false });
})();
_nightSkyUpdateMap3DControls();
