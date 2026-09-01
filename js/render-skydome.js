// ─── Sky Dome view ────────────────────────────────────────────────────────────
// Azimuth/elevation sun-path diagram (à la SunEarthTools.com), in three alternate projections
// that share the same underlying data and the same info-bar readout:
//   Sky Map     - polar: zenith (elevation 90°) at the centre, horizon (elevation 0°) at the rim,
//                 azimuth as the compass angle around it. (Internal id/functions still say "dome"
//                 - only the UI label changed when the projection wheel was introduced.) Has its
//                 own "3D" ON/OFF toggle (see skyMap3DOn below) that swaps the flat polar grid for
//                 an orbiting 3D perspective view of the same unit sphere, as if viewed from
//                 outside like a globe - drag to orbit (same mechanic as the 3D Model theater's
//                 orbitStart/Move/End), zoom slider like #theaterZoom. Points/lines on the far
//                 side of the sphere from the camera are not drawn - see the "visible" flag on
//                 _skyMap3DProject() and the break-on-invisible handling in
//                 _skyDomeArcPoints()/drawSkyMap3DAxes(), the same null-breaks-the-polyline
//                 convention already used for azimuth wraparound.
//   Az-El Chart - flat: azimuth 0°-360° left-to-right, elevation 0°-90° bottom-to-top (a plain XY
//                 chart). (Internal id/functions still say "matrix".)
//   Planetarium - true 3D, but from *inside* the sphere: the observer stands at its own centre
//                 and looks around (drag pans/tilts the gaze - see the dedicated section near the
//                 end of this file, _skyDomePlanet3D and friends), unlike Sky Map's 3D toggle
//                 which orbits the sphere from outside. Projected with an equidistant (fisheye)
//                 mapping, not plain perspective - see _skyDomePlanet3DProject()'s own comment for
//                 why a straight-line/gnomonic mapping looks wrong here even though it sounds more
//                 "correct".
// All three are a fixed geographic compass view - true north is always at az=0 (Sky Map: fixed at
// the top, or wherever the 3D orbit currently puts it; Az-El Chart: see the shift note on
// _skyDomeMatrixPoint; Planetarium: wherever the current gaze direction puts it), independent of
// the calibration's YAW/PITCH/ROLL (those describe how the physical pinhole can was oriented, not
// a property of the sky itself). Switched via the top-right wheel picker (see the projection-wheel
// wiring near the bottom of this file); everything below (sun-path data, cursor readout) is
// projection-agnostic and goes through _skyDomeProject()/_skyDomePixelToAzEl() to reach any of the
// three.
//
// Because this is a *true*-compass view (not the flat scan's own hemisphere-agnostic pixel
// convention - see core.js's drawSunArc), all sun-position math here uses signed latitude
// (effectiveLat() * hemisphere) and unsigned hour angle, so the culmination side and the day's
// rotation sense come out on the correct side of the compass for either hemisphere automatically
// - see _skyDomeArcPoints/_skyDomeHourDots. inverseSolar() is the one exception: it has its own
// bespoke "culmination is always 180°" + unsigned-latitude convention, so its azimuth argument is
// converted first - see handleSkyDomeMouseMove().
//
// Handedness: Dome is deliberately mirrored left-right from a bird's-eye ground map (see
// _skyDomePoint) to match what an observer lying on the ground looking up at the zenith actually
// sees - the standard star-chart/planisphere convention. Matrix is NOT mirrored - it already
// reads left-to-right in increasing azimuth to match the SunEarthTools-style reference chart it
// was built from (which happens to put east on the left for the northern hemisphere too, just via
// a plain left-to-right numeric axis rather than a deliberate "view from inside the sphere" flip).
// The two projections' east/west placement is therefore not driven by the same reasoning even
// where it happens to agree - don't "fix" one by copying the other's formula.
//
// Sub-mode of Analyzer, sibling to 3D Model / Sun Graph (mutually exclusive canvas takeovers -
// see enterSkyDome()/exitSkyDome() and their counterparts in render-3d.js/render-sungraph.js).

let skyDomeActive = false;
let skyDomeProjection = 'dome';   // 'dome' | 'matrix' - set by the top-right wheel picker
let skyMap3DOn = false;           // Sky Map's own 3D ON/OFF toggle - only relevant when 'dome'
let skyDomePlanetImageOn = false; // Planetarium's "render image" toggle (pilot) - see _skyDomePlanet3DDrawImage
let _skyDomeLayout = null;        // {mode, ...} - see _skyDomeProject/_skyDomePixelToAzEl

function enterSkyDome() {
  // All three canvas takeovers (3D Model, Sun Graph, Sky Dome) are mutually exclusive.
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D && typeof exitTheater3D === 'function') exitTheater3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive && typeof exitSunGraph === 'function') exitSunGraph();

  const container  = document.getElementById('canvasContainer');
  const uploadZone = document.getElementById('uploadZone');
  // The dome is independent of any loaded scan → reveal the canvas area, hide upload zone
  // (mirrors enterSunGraph/enterTheater3D).
  container.classList.remove('hidden');
  if (uploadZone) uploadZone.classList.add('hidden');

  document.getElementById('skyDomeCanvas').style.display = 'block';
  document.getElementById('skyDomeProjRow').style.display = 'flex';
  document.getElementById('mainCanvas').style.pointerEvents = 'none';
  document.getElementById('statusWrap').style.display = 'none';

  // Set before setDisplaySectionEnabled() below, which refreshes the CHMI Display controls' grey
  // state via updateChmiLegendAvailability() → _chmiControlsRelevantHere() - that reads
  // skyDomeActive to decide whether CHMI is relevant here (it isn't), so it needs to already be
  // current.
  skyDomeActive = true;
  // Display off except Labels + Custom date - same two the Sun Graph keeps live, since the sun
  // paths layered on here later will use the same custom-date state.
  setDisplaySectionEnabled(false, ['chkLabels', ...CUSTOM_DATE_KEEP_IDS]);
  if (typeof updateViewButtons === 'function') updateViewButtons();
  if (typeof updateSkyMap3DControlsVisibility === 'function') updateSkyMap3DControlsVisibility();
  resizeSkyDome();
}

function exitSkyDome() {
  document.getElementById('skyDomeCanvas').style.display = 'none';
  document.getElementById('skyDomeProjRow').style.display = 'none';
  document.getElementById('skyMap3DToggleRow').style.display = 'none';
  document.getElementById('skyMap3DZoomCtl').style.display = 'none';
  document.getElementById('skyDomePlanetImgToggleRow').style.display = 'none';
  document.getElementById('mainCanvas').style.pointerEvents = '';
  skyDomeActive = false;
  // Safety: exiting mid-drag (e.g. Escape) shouldn't leave either drag flag stuck.
  _skyMap3DDragging = false;
  _skyDomePlanet3DDragging = false;
  _skyDomeHoverAz = null; _skyDomeHoverEl = null;   // don't leave a stale readout for the next view
  if (typeof updateViewButtons === 'function') updateViewButtons();

  if (currentMode === 'analyzer') {
    setDisplaySectionEnabled(true);
    document.getElementById('statusWrap').style.display = 'flex';
    if (!imgBitmap) {
      document.getElementById('uploadZone').classList.remove('hidden');
      document.getElementById('canvasContainer').classList.add('hidden');
    }
  }
}

function resizeSkyDome() {
  if (!skyDomeActive) return;
  const container = document.getElementById('canvasContainer');
  const cv = document.getElementById('skyDomeCanvas');
  const RES = Math.max(2, Math.ceil(window.devicePixelRatio || 1));   // crisp on HiDPI (see 25_1)
  const cw = container.clientWidth, ch = container.clientHeight;
  cv._res = RES;
  cv.width  = Math.round(cw * RES);
  cv.height = Math.round(ch * RES);
  cv.style.width  = cw + 'px';
  cv.style.height = ch + 'px';
  drawSkyDome();
}

// ── Projection dispatch (Dome = polar, Matrix = flat azimuth/elevation chart) ─────────────────
// Elevation → radius (linear: 90° at centre, 0° at rim) and (az, el) → canvas point, sharing one
// origin/scale for the whole draw pass. az is world-standard (0=N, 90=E, 180=S, 270=W); N is
// fixed at the top, but the x-axis is mirrored (x = cx0 - r·sin(az), not +) so the dome reads as
// an observer lying on the ground looking straight up at the zenith would actually see it, not as
// a cartographer's bird's-eye view of the ground looking down. For the classic example: lying
// down with feet to the south (head to the north) under a northern-hemisphere sky, east is over
// your LEFT shoulder and west over your right - the standard star-chart/planisphere convention,
// mirrored left-right from an ordinary ground map for the same reason a planisphere is always
// mirrored relative to a terrestrial map (you're viewing the same fixed compass rose from the
// inside of the sphere looking out, instead of from outside looking in).
function _skyDomePoint(cx0, cy0, R, az, el) {
  const r = R * (90 - el) / 90;
  const a = az * Math.PI / 180;
  return { x: cx0 - r * Math.sin(a), y: cy0 - r * Math.cos(a) };
}

// Matrix: plain XY chart - azimuth 0..360° left-to-right, elevation 0..90° bottom-to-top.
// The chart is deliberately kept "culmination-centred" regardless of hemisphere: true north sits
// at az=0/360 (the two edges) for the northern hemisphere, but at az=180 (the true south) for the
// southern hemisphere the sun's culmination is at *true* az=0 (north) - plotting raw true azimuth
// straight across a 0-360 axis would then put the daily arc's peak at the edges and split it into
// two pieces there. Instead we shift by 180° for the southern hemisphere so the culmination side
// always lands at the centre and the chart keeps the same one-piece "hump" shape either way - see
// drawSkyDomeMatrixAxes(), which relabels the axis (numbers + E/S/W) to match this shift instead
// of moving the gridlines.
function _skyDomeMatrixAzShift() { return hemisphere >= 0 ? 0 : 180; }

function _skyDomeMatrixPoint(x0, y0, plotW, plotH, az, el) {
  const azS = (az + _skyDomeMatrixAzShift() + 360) % 360;
  return { x: x0 + (azS / 360) * plotW, y: y0 + plotH * (1 - el / 90) };
}

// az/el → 3D unit vector on the sphere, standard horizontal-coordinate convention: x=east,
// y=north, z=up (az measured clockwise from north, matching the app's world-azimuth convention).
// Shared by both the active Sky Map 3D orbit view and the parked planetarium view below.
function _skyDomeUnitVec(az, el) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}
function _sd3Cross(a, b) { return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]; }
function _sd3Dot(a, b)   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

// Sky Map 3D "permeability": how much of their normal opacity things keep when they're on the far
// side of - or occluded by - the translucent sky shell (sun-path curves/dots/markers beyond the
// visible hemisphere, compass rose passing "under" the globe), instead of being hard-cut/hidden.
// Mirrors the 3D Model panel's own front/back opacity split on its cladding (_pCol/_gCol in
// render-3d.js), just as a single shared constant here since everything dimming here sits on or
// under one shell rather than needing per-material front/back tuning.
const SKY_MAP3D_DIM_ALPHA_MULT = 0.28;
function _sd3AlphaOf(rgba) {
  const m = rgba.match(/rgba?\([^,]+,[^,]+,[^,]+(?:,([^)]+))?\)/);
  return m && m[1] !== undefined ? parseFloat(m[1]) : 1;
}
function _sd3WithAlpha(rgba, alpha) {
  const m = rgba.match(/rgba?\(([^,]+),([^,]+),([^,]+)(?:,[^)]+)?\)/);
  if (!m) return rgba;
  return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
}
// Ray-sphere occlusion test: does the unit sphere block the line of sight from the Sky Map 3D
// camera to world point p? Used to dim the compass rose where it passes "under" the globe.
function _skyMap3DOccluded(p) {
  const o = _skyMap3D.camPos;
  const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const dist = Math.hypot(d[0], d[1], d[2]) || 1;
  const dn = [d[0] / dist, d[1] / dist, d[2] / dist];
  const b = 2 * _sd3Dot(o, dn);
  const c = _sd3Dot(o, o) - 1;
  const disc = b * b - 4 * c;
  if (disc < 0) return false;   // ray never touches the sphere at all
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2, t2 = (-b + sq) / 2;
  const tHit = t1 > 1e-4 ? t1 : (t2 > 1e-4 ? t2 : null);
  return tHit !== null && tHit < dist - 1e-4;   // sphere sits strictly between camera and p
}

// ── Sky Map's "3D" toggle: orbiting perspective camera around a unit sphere ──────────────────
// Same drag/zoom mechanic as the 3D Model theater's _3D (render-3d.js): camAz/camEl driven by
// drag (orbitStart/Move/End near the bottom of this file), zoom by a dedicated slider (mirrors
// #theaterZoom). The camera orbits the sphere from outside it, unlike the parked planetarium view.
const _SKY_MAP3D_BASE_DIST = 2.4;   // camera distance at zoom=1×
const _SKY_MAP3D_FOCAL     = 1.4;
const _skyMap3D = { camAz: Math.PI / 4, camEl: 0.35, zoom: 1.0 };
let _skyMap3DDragging = false;   // true while orbit-dragging - see the drag block near the bottom

// Recompute the camera's position and RIGHT/UP/FWD basis from camAz/camEl/zoom - call after
// mutating any of the three, mirrors render-3d.js's updateCamera().
function updateSkyMap3DCamera() {
  const d = _SKY_MAP3D_BASE_DIST / _skyMap3D.zoom;
  const cx = d * Math.cos(_skyMap3D.camEl) * Math.sin(_skyMap3D.camAz);
  const cy = d * Math.cos(_skyMap3D.camEl) * Math.cos(_skyMap3D.camAz);
  const cz = d * Math.sin(_skyMap3D.camEl);
  const fwd = [-cx / d, -cy / d, -cz / d];   // camera → sphere centre
  const worldUp = [0, 0, 1];
  let right = _sd3Cross(fwd, worldUp);
  const rlen = Math.hypot(right[0], right[1], right[2]) || 1;
  right = [right[0] / rlen, right[1] / rlen, right[2] / rlen];
  const up = _sd3Cross(right, fwd);
  _skyMap3D.camPos = [cx, cy, cz];
  _skyMap3D.camDist = d;
  _skyMap3D.camDirUnit = [cx / d, cy / d, cz / d];
  _skyMap3D.RIGHT = right; _skyMap3D.UP = up; _skyMap3D.FWD = fwd;
}
updateSkyMap3DCamera();

// Perspective-project one sphere point into the Sky Map 3D canvas. Returns {x, y, visible} -
// visible is false when the point sits on the far side of the sphere from the camera (exact
// horizon-of-view test for a sphere seen from finite distance d: dot(v, camDir) >= 1/d) or
// technically behind the camera (lz<=0, only possible pathologically close up). Callers that
// connect points into a polyline (sun-path curves, grid lines) must treat visible:false as a
// break, same as the existing azimuth-wraparound null-breaks - see _skyDomeArcPoints.
function _skyMap3DProject(layout, az, el) {
  const v = _skyDomeUnitVec(az, el);
  const visible = _sd3Dot(v, _skyMap3D.camDirUnit) >= 1 / _skyMap3D.camDist;
  const p = _skyMap3D.camPos;
  const rel = [v[0] - p[0], v[1] - p[1], v[2] - p[2]];
  const lz = _sd3Dot(rel, _skyMap3D.FWD);
  if (lz <= 0.001) return { x: layout.cx, y: layout.cy, visible: false };
  const lx = _sd3Dot(rel, _skyMap3D.RIGHT), ly = _sd3Dot(rel, _skyMap3D.UP);
  const sx = _SKY_MAP3D_FOCAL * lx / lz, sy = _SKY_MAP3D_FOCAL * ly / lz;
  return { x: layout.cx + sx * layout.scale, y: layout.cy - sy * layout.scale, visible };
}

function _skyDomeProject(layout, az, el) {
  if (layout.mode === 'skymap3d') return _skyMap3DProject(layout, az, el);
  if (layout.mode === 'planet3d') return _skyDomePlanet3DProject(layout, az, el);
  return layout.mode === 'matrix'
    ? _skyDomeMatrixPoint(layout.x0, layout.y0, layout.plotW, layout.plotH, az, el)
    : _skyDomePoint(layout.cx, layout.cy, layout.R, az, el);
}

// ── Cursor readout (shared Az/Alt/Day/Time/Dir bar, #readout in index.html) ──────────────────
// Recalibrated for each projection's own geometry: unlike the flat scan's pixelToAzEl (which
// inverts the pinhole/cylinder projection and depends on yaw/pitch/roll/scale), a Dome or Matrix
// pixel maps to az/el with plain arithmetic and no calibration at all - and, being a real compass
// view (see file header), no southern-hemisphere display shift either: neither projection's own
// axis labels (N/S/E/W) are shifted, so the readout shouldn't be either.
let _skyDomeHoverAz = null, _skyDomeHoverEl = null;   // world az/el under the cursor, or null

// Sky Map 3D inverse: canvas pixel → world ray → nearest intersection with the unit sphere (the
// camera sits outside it, so of the ray's two roots the smaller positive one is the near/visible
// surface) → {az, el}. No intersection at all means the ray misses the sphere - mouse is over
// background outside the dome's silhouette, same "no hit" semantics as Sky Map's r>R / Az-El
// Chart's out-of-bounds check.
function _skyMap3DPixelToAzEl(layout, px, py) {
  const sx = (px - layout.cx) / layout.scale, sy = -(py - layout.cy) / layout.scale;
  const R = _skyMap3D.RIGHT, U = _skyMap3D.UP, F = _skyMap3D.FWD;
  const dir = [
    sx * R[0] + sy * U[0] + _SKY_MAP3D_FOCAL * F[0],
    sx * R[1] + sy * U[1] + _SKY_MAP3D_FOCAL * F[1],
    sx * R[2] + sy * U[2] + _SKY_MAP3D_FOCAL * F[2],
  ];
  const dlen = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / dlen, dir[1] / dlen, dir[2] / dlen];
  const o = _skyMap3D.camPos;
  const b = 2 * _sd3Dot(o, d);
  const c = _sd3Dot(o, o) - 1;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2, t2 = (-b + sq) / 2;
  const t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  if (t <= 0) return null;
  const hit = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
  const el = Math.max(0, Math.asin(Math.max(-1, Math.min(1, hit[2]))) * 180 / Math.PI);
  const az = (Math.atan2(hit[0], hit[1]) * 180 / Math.PI + 360) % 360;
  return { az, el };
}

// Inverse of _skyDomeProject: canvas pixel → {az, el}, or null outside the plotted area (below
// horizon in Sky Map, outside the axes box in Az-El Chart, missing the sphere in Sky Map 3D). az
// is null exactly at the Sky Map's centre (zenith), where azimuth is undefined - the others have
// no such ambiguity.
function _skyDomePixelToAzEl(px, py) {
  if (!_skyDomeLayout) return null;
  const L = _skyDomeLayout;
  if (L.mode === 'skymap3d') return _skyMap3DPixelToAzEl(L, px, py);
  if (L.mode === 'planet3d') return _skyDomePlanet3DPixelToAzEl(L, px, py);
  if (L.mode === 'matrix') {
    if (px < L.x0 || px > L.x0 + L.plotW || py < L.y0 || py > L.y0 + L.plotH) return null;
    const azS = ((px - L.x0) / L.plotW) * 360;
    const az = (azS - _skyDomeMatrixAzShift() + 360) % 360;   // undo the culmination-centring shift
    const el = (1 - (py - L.y0) / L.plotH) * 90;
    return { az, el };
  }
  const dx = px - L.cx, dy = py - L.cy;
  const r = Math.hypot(dx, dy);
  if (r > L.R) return null;
  const el = 90 - 90 * r / L.R;
  // Inverse of _skyDomePoint's mirrored x (dx = -r·sin(az)) - atan2(-dx, -dy), not atan2(dx, -dy),
  // so the readout reports the true azimuth of wherever the mirrored dome is actually drawing it.
  const az = r < 0.5 ? null : ((Math.atan2(-dx, -dy) * 180 / Math.PI) + 360) % 360;
  return { az, el };
}

function _skyDomeClearReadout() {
  document.getElementById('valAz').textContent   = '—';
  document.getElementById('valAlt').textContent  = '—';
  document.getElementById('valDay').textContent  = '—';
  document.getElementById('valTime').textContent = '—';
  document.getElementById('valDir').textContent  = '—';
}

function handleSkyDomeMouseMove(e) {
  if (_skyMap3DDragging || _skyDomePlanet3DDragging) return;   // drag owns the cursor/readout while active
  const container = document.getElementById('canvasContainer');
  const rect = container.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const hit = _skyDomePixelToAzEl(px, py);

  if (!hit) {
    container.style.cursor = 'default';
    if (_skyDomeHoverEl !== null) {
      _skyDomeHoverAz = null; _skyDomeHoverEl = null;
      _skyDomeClearReadout();
      drawSkyDome();
    }
    return;
  }
  container.style.cursor = 'none';
  _skyDomeHoverAz = hit.az; _skyDomeHoverEl = hit.el;

  // inverseSolar() expects its azimuth in the app-wide "culmination-relative" convention (south
  // is always 180°, regardless of hemisphere - see core.js) paired with unsigned latitude; it
  // applies its own internal hemisphere corrections (H sign, day-of-year shift) from there. Our
  // az is a *true* compass bearing (0=true north always), so convert before calling it - true
  // culmination is at true-az 0 for the southern hemisphere, which must map to 180 in that frame.
  const azForSolar = hit.az !== null ? (hemisphere >= 0 ? hit.az : (hit.az + 180) % 360) : null;
  const sol = azForSolar !== null ? inverseSolar(azForSolar, hit.el, effectiveLat()) : null;
  document.getElementById('valAz').textContent   = hit.az !== null ? hit.az.toFixed(1) + '°' : '—';
  document.getElementById('valAlt').textContent  = '+' + hit.el.toFixed(1) + '°';
  document.getElementById('valDay').textContent  = sol ? sol.day1 + ' / ' + sol.day2 : '—';
  document.getElementById('valTime').textContent = sol ? sol.time : '—';
  document.getElementById('valDir').textContent  = hit.az !== null ? azimutToDir(hit.az) : '—';

  drawSkyDome();
}

function handleSkyDomeMouseLeave() {
  _skyDomeHoverAz = null; _skyDomeHoverEl = null;
  _skyDomeClearReadout();
  if (skyDomeActive) drawSkyDome();
}

// ── Sun-path curves ────────────────────────────────────────────────────────────
// Mirrors the main canvas's "Sun's paths" / "Custom date" overlays (drawAllSunArcs / drawSunArc
// in core.js), reusing the same sunPosition()/sunDeclination() math, but projected straight
// through the compass-fixed Dome/Matrix via _skyDomeProject(layout, az, el) - no "- yawDeg"
// correction, since this view deliberately ignores calibration (see file header). Same curve set
// as the main canvas (4 thin intermediate months + both solstices + equinox, with hour dots on
// the equinox curve), plus the green Custom Path date with its south-transit label and animated
// sun marker - identical in both projections, just re-projected.
function _skyDomeArcPoints(layout, month, day) {
  const delta = sunDeclination(dayOfYear(month, day));
  // Signed latitude - this is a true-compass calculation (see file header), unlike the flat
  // scan's own sun-arc drawing (core.js's drawSunArc), which stays hemisphere-agnostic by using
  // unsigned latitude paired with a "culmination is always at the image centre" pixel convention.
  // Here there's no such convention to lean on: true south is always down and true north is
  // always up, so the sign has to come from the real latitude for the culmination side (and the
  // whole day's rotation sense) to land on the correct side of the compass.
  const phi = effectiveLat() * hemisphere;
  // The break-heuristic below has to look for a jump in whichever azimuth value actually
  // determines the drawn seam - for Matrix that's the *shifted* (culmination-centred) azimuth
  // (_skyDomeMatrixAzShift), not the raw compass one. For the northern hemisphere the shift is
  // 0, so this is a no-op and matches the original behaviour exactly. For the southern
  // hemisphere the shift is 180, which moves the seam to true south - away from true north,
  // where the SH sun actually culminates. Checking the raw azimuth instead (as this used to)
  // put the "never fires for an ordinary day" assumption exactly at the SH culmination: every
  // southern-hemisphere day legitimately sweeps through true north at solar noon, and at
  // subtropical latitudes (roughly 5-30°, where the sun passes close to the zenith at some
  // point in the year) that sweep is fast enough per 0.5°-hour-angle sample to look like a
  // >180° wraparound - inserting a spurious break, and hence a visible gap in the Matrix chart,
  // right at culmination on an otherwise perfectly continuous arc. Dome is unaffected either
  // way (no seam - see _skyDomePoint), so reusing one shift-aware check for both is safe.
  const shift = layout.mode === 'matrix' ? _skyDomeMatrixAzShift() : 0;
  const pts = [];
  let prevAzS = null;
  for (let hDeg = -180; hDeg <= 180; hDeg += 0.5) {
    const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
    if (s.el < 0) { prevAzS = null; continue; }
    const azS = (s.az + shift + 360) % 360;
    if (prevAzS !== null && Math.abs(azS - prevAzS) > 180) pts.push(null);
    prevAzS = azS;
    // Kept even when p.visible===false - _skyDomeStrokeArc turns that into a fade rather than a
    // cut: a fixed dim (Sky Map 3D, seen through the translucent shell) or the point's own
    // continuous .alpha (Planetarium, fading smoothly toward the rim - see
    // _skyDomePlanet3DProject). null still marks the hard breaks above (below horizon, wraparound).
    pts.push(_skyDomeProject(layout, s.az, s.el));
  }
  return pts;
}

// pts may contain null entries marking a hard break in the polyline (below horizon, azimuth
// wraparound - see _skyDomeArcPoints above). Otherwise the effective alpha for each point is:
// p.alpha if the projection set one (Planetarium: a continuous fade toward the rim - see
// _skyDomePlanet3DProject), else SKY_MAP3D_DIM_ALPHA_MULT if p.visible===false (Sky Map 3D: a
// fixed dim for the far side of the sphere, seen through the translucent shell), else fully
// opaque (Dome/Matrix, or any point already known visible). Drawn as separate segments per
// rounded alpha "bucket", continuous across bucket boundaries - not one flat colour - so
// Planetarium's fade reads as smooth rather than a handful of visible bands.
const _SKY_ARC_ALPHA_BUCKET = 0.12;
// Shared by every sun-path/hour-dot/label draw below: a point's effective alpha is its own
// continuous .alpha if the projection set one (Planetarium's rim fade), else the fixed
// SKY_MAP3D_DIM_ALPHA_MULT dim for a far-side-of-the-sphere point (Sky Map 3D), else opaque.
function _skyDomeAlphaOf(p) {
  return p.alpha !== undefined ? p.alpha : (p.visible === false ? SKY_MAP3D_DIM_ALPHA_MULT : 1);
}
function _skyDomeStrokeArc(ctx, pts, color, lineWidth) {
  if (pts.length < 2) return;
  const baseAlpha = _sd3AlphaOf(color);
  const alphaOf = _skyDomeAlphaOf;
  ctx.lineWidth = lineWidth; ctx.setLineDash([]);
  let curBucket = null, curAlpha = 1, first = true;
  const strokeSeg = () => { ctx.strokeStyle = _sd3WithAlpha(color, baseAlpha * curAlpha); ctx.stroke(); };
  ctx.beginPath();
  for (const p of pts) {
    if (!p || (p.alpha !== undefined && p.alpha <= 0.02)) {
      if (!first) strokeSeg();
      ctx.beginPath(); first = true; curBucket = null;
      continue;
    }
    const alpha = alphaOf(p);
    const bucket = Math.round(alpha / _SKY_ARC_ALPHA_BUCKET);
    if (curBucket !== null && bucket !== curBucket) {
      ctx.lineTo(p.x, p.y);       // extend the outgoing segment to the exact transition point...
      strokeSeg();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);       // ...then continue from that same point, no visual gap
      first = false;
    } else if (first) {
      ctx.moveTo(p.x, p.y); first = false;
    } else {
      ctx.lineTo(p.x, p.y);
    }
    curBucket = bucket; curAlpha = alpha;
  }
  if (!first) strokeSeg();
}

// Hour dots (15° = 1h steps) along one date's curve, with optional "H:MM" solar-time labels
// (display-mode aware, same as the main canvas's equinox curve). Label side follows morning/
// afternoon (hDeg sign) rather than screen position, so it reads the same in both projections.
function _skyDomeHourDots(ctx, layout, month, day, color, withLabels) {
  const doy   = dayOfYear(month, day);
  const delta = sunDeclination(doy);
  const phi   = effectiveLat() * hemisphere;   // true-compass calculation - see _skyDomeArcPoints
  for (let hDeg = -180; hDeg <= 180; hDeg += 15) {
    const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
    if (s.el < 0) continue;
    const p = _skyDomeProject(layout, s.az, s.el);
    // Sky Map 3D: dim through the shell when on the far side. Planetarium: p.alpha fades
    // continuously toward the rim (see _skyDomePlanet3DProject) - skip only once it's essentially 0.
    if (p.alpha !== undefined && p.alpha <= 0.02) continue;
    const dim = _skyDomeAlphaOf(p);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = dim === 1 ? color : _sd3WithAlpha(color, _sd3AlphaOf(color) * dim);
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,${0.6 * dim})`; ctx.lineWidth = 0.8; ctx.stroke();
    if (withLabels) {
      // Hour angle → clock hour is a universal relationship (H=0 is always noon, H grows linearly
      // with elapsed time) - no hemisphere mirroring needed here, unlike the flat scan's equinox
      // curve (core.js's drawAllSunArcs), which mirrors hDeg to compensate for its own southern-
      // hemisphere image convention (not applicable to this true-compass view).
      const trueHour  = 12 + hDeg / 15;
      const shownHour = displayHour(trueHour, doy);
      const hh = Math.floor(shownHour), mm = Math.round((shownHour - hh) * 60);
      const label = hh + ':' + String(mm).padStart(2, '0');
      ctx.font = "bold 10px 'Share Tech Mono'";
      ctx.fillStyle = _sd3WithAlpha(color.replace(/rgba\(([^,]+,[^,]+,[^,]+),[^)]+\)/, 'rgba($1,1)'), dim);
      ctx.strokeStyle = `rgba(0,0,0,${0.8 * dim})`; ctx.lineWidth = 2.5;
      ctx.textAlign = hDeg < 0 ? 'right' : 'left';
      const ox = hDeg < 0 ? -7 : 7;
      ctx.strokeText(label, p.x + ox, p.y - 4);
      ctx.fillText(label, p.x + ox, p.y - 4);
    }
  }
}

function drawSkyDomeSunPaths(ctx, layout) {
  // The Opacity slider is disabled while Sky Dome is active (see setDisplaySectionEnabled() in
  // enterSkyDome() - it's greyed out and inert, not just hidden), but dispOpacity itself is a
  // shared global that keeps whatever value Image/Sun Graph last left it at. Without pinning this
  // to 1, the curves and hour dots would silently inherit that stale, inaccessible-here setting -
  // e.g. rendering nearly invisible if the user had turned opacity down in Image mode earlier.
  const op = 1;

  if (typeof showSunArc === 'undefined' || showSunArc) {
    const thinCol = `rgba(255, 220, 60, ${Math.min(1, op * 0.40)})`;
    [[1, 21], [2, 21], [4, 21], [5, 21]].forEach(([m, d]) => {
      _skyDomeStrokeArc(ctx, _skyDomeArcPoints(layout, m, d), thinCol, 0.8);
    });

    const winterMonth = hemisphere >= 0 ? 12 : 6;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(layout, winterMonth, 21),
      `rgba(60, 180, 255, ${Math.min(1, op * 0.85)})`, 1.5);

    const equinoxCol = `rgba(255, 220, 60, ${Math.min(1, op * 0.85)})`;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(layout, 3, 21), equinoxCol, 1.5);
    if (typeof showLabels === 'undefined' || showLabels) {
      _skyDomeHourDots(ctx, layout, 3, 21, equinoxCol, true);
    }

    const summerMonth = hemisphere >= 0 ? 6 : 12;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(layout, summerMonth, 21),
      `rgba(255, 100, 60, ${Math.min(1, op * 0.85)})`, 1.5);
  }

  if (typeof showCustomArc === 'undefined' || showCustomArc) {
    // The *real* calendar date, unlike the flat scan's path convention (core.js's drawSunArc /
    // pathDeclination()), which negates the declination for the southern hemisphere to compensate
    // for that view's unsigned-latitude convention. Paired with signed latitude below, the real
    // date already gives the correct true-compass path with no sign-flip needed.
    const cm = customMonth, cd = customDay;
    const pts = _skyDomeArcPoints(layout, cm, cd);
    _skyDomeStrokeArc(ctx, pts, `rgba(0,0,0,${Math.min(1, op * 0.85)})`, 3.5);
    _skyDomeStrokeArc(ctx, pts, `rgba(80, 220, 120, ${Math.min(1, op * 0.9)})`, 1.5);

    const delta = sunDeclination(dayOfYear(cm, cd));
    const phi   = effectiveLat() * hemisphere;   // true-compass calculation - see _skyDomeArcPoints

    // Label at the culmination point (H=0 is always solar noon/transit, wherever that compass
    // direction actually is - true south for the northern hemisphere, true north for the southern).
    const culmination = sunPosition(0, delta, phi);
    const culminationPt = culmination.el > 0 ? _skyDomeProject(layout, culmination.az, culmination.el) : null;
    // Planetarium: p.alpha fades continuously toward the rim - skip only once it's essentially 0.
    const culminationHidden = culminationPt && culminationPt.alpha !== undefined && culminationPt.alpha <= 0.02;
    if (culminationPt && !culminationHidden && (typeof showLabels === 'undefined' || showLabels)) {
      // Sky Map 3D: dim through the shell when on the far side. Planetarium: use its own alpha.
      const dim = _skyDomeAlphaOf(culminationPt);
      const sp = culminationPt;
      const dateLabel = MONTH_NAMES[customMonth - 1] + ' ' + customDay;
      ctx.font = "10px 'Share Tech Mono'";
      ctx.fillStyle = `rgba(80,220,120,${dim})`;
      ctx.strokeStyle = `rgba(0,0,0,${0.8 * dim})`; ctx.lineWidth = 2.5;
      ctx.textAlign = 'left';
      ctx.strokeText(dateLabel, sp.x + 8, sp.y - 6);
      ctx.fillText(dateLabel, sp.x + 8, sp.y - 6);
    }

    // Animated sun marker at the current solar time, matching the theater/2D styling. hDeg is
    // unsigned - hour angle → clock hour is universal (see _skyDomeHourDots), unlike the flat
    // scan/theater's own sunTimeHours→hDeg conversion, which mirrors by hemisphere for its own
    // pixel convention (render-3d.js's surfMap/hitH).
    if (typeof show3DCulmination === 'undefined' || show3DCulmination) {
      const hDeg = (sunTimeHours - 12) * 15;
      const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
      const sp = s.el >= 0 ? _skyDomeProject(layout, s.az, s.el) : null;
      // Planetarium: p.alpha fades continuously toward the rim - skip only once it's essentially 0.
      if (sp && !(sp.alpha !== undefined && sp.alpha <= 0.02)) {
        // Sky Map 3D: dim through the shell when on the far side. Planetarium: use its own alpha.
        const dim = _skyDomeAlphaOf(sp);
        const glR = 14;
        const glow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, glR);
        glow.addColorStop(0, `rgba(232,160,32,${0.60 * dim})`); glow.addColorStop(1, 'rgba(232,160,32,0)');
        ctx.fillStyle = glow; ctx.fillRect(sp.x - glR, sp.y - glR, glR * 2, glR * 2);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232,160,32,${dim})`; ctx.fill();
        ctx.strokeStyle = `rgba(0,0,0,${0.6 * dim})`; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
}

// Sample [az,el] pairs through _skyDomeProject - the shared building block for every Sky Map 3D
// grid line/isoline below. Points on the sphere's far side keep their .visible:false flag rather
// than becoming a hard break (see _skyMap3DStrokePolyline) - the horizon ring and the cardinal
// meridians (and every other grid line, for consistency) should fade through the far side of the
// shell like the sun-path curves do, not vanish there.
function _skyMap3DPolyline(layout, points) {
  return points.map(([az, el]) => _skyDomeProject(layout, az, el));
}
// Strokes a polyline with the given colour, dimming to SKY_MAP3D_DIM_ALPHA_MULT wherever a point's
// .visible is false (same permeability convention as _skyDomeStrokeArc) - continuous across the
// visibility transition, no gap. Caller sets ctx.lineWidth/setLineDash beforehand (unlike
// _skyDomeStrokeArc, which resets the dash itself - grid lines need their own dash pattern per
// az/el band); this function only manages colour and the path itself.
function _skyMap3DStrokePolyline(ctx, pts, color) {
  if (pts.length < 2) return;
  const dimColor = _sd3WithAlpha(color, _sd3AlphaOf(color) * SKY_MAP3D_DIM_ALPHA_MULT);
  const strokeSeg = (vis) => { ctx.strokeStyle = vis === false ? dimColor : color; ctx.stroke(); };
  let curVis = null, first = true;
  ctx.beginPath();
  for (const p of pts) {
    if (!p) {
      if (!first) strokeSeg(curVis);
      ctx.beginPath(); first = true; curVis = null;
      continue;
    }
    const vis = p.visible !== false;
    if (curVis !== null && vis !== curVis) {
      ctx.lineTo(p.x, p.y);
      strokeSeg(curVis);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      first = false;
    } else if (first) {
      ctx.moveTo(p.x, p.y); first = false;
    } else {
      ctx.lineTo(p.x, p.y);
    }
    curVis = vis;
  }
  if (!first) strokeSeg(curVis);
}

// Projects an arbitrary 3D world point (not necessarily on the unit sphere) through the Sky Map
// 3D camera - used for the floor/compass pedestal and the translucent sky shell below, neither of
// which lives on the unit sphere. Returns null if the point is behind the camera.
function _skyMap3DProjectRaw(layout, v) {
  const p = _skyMap3D.camPos;
  const rel = [v[0] - p[0], v[1] - p[1], v[2] - p[2]];
  const lz = _sd3Dot(rel, _skyMap3D.FWD);
  if (lz <= 0.001) return null;
  const lx = _sd3Dot(rel, _skyMap3D.RIGHT), ly = _sd3Dot(rel, _skyMap3D.UP);
  const sx = _SKY_MAP3D_FOCAL * lx / lz, sy = _SKY_MAP3D_FOCAL * ly / lz;
  return [layout.cx + sx * layout.scale, layout.cy - sy * layout.scale];
}

// ── Floor pedestal + compass rose (mirrors the 3D Model panel's ground plane, render-3d.js) ──
// The sky sphere "sits" on a flat pedestal lying in its own equatorial plane (z=0 - the same
// plane the horizon ring already occupies), extending a bit past the sphere's own radius (1),
// same visual language as the 3D Model's floor grid + compass rose under the pinhole can.
function _skyMap3DDrawFloorAndCompass(ctx, layout, pal, lt) {
  const FR = 1.35;   // pedestal half-extent, just beyond the sphere's own radius
  const proj = (v) => _skyMap3DProjectRaw(layout, v);
  const fc = proj([0, 0, 0]);

  const flCorners = [[-FR, -FR, 0], [FR, -FR, 0], [FR, FR, 0], [-FR, FR, 0]].map(proj);
  if (fc && flCorners.every(Boolean)) {
    ctx.beginPath(); ctx.moveTo(flCorners[0][0], flCorners[0][1]);
    flCorners.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath();
    const gr = ctx.createRadialGradient(fc[0], fc[1], 0, fc[0], fc[1], Math.min(layout.scale * 2.4, 400));
    if (lt) { gr.addColorStop(0, 'rgba(175,190,210,0.55)'); gr.addColorStop(0.65, 'rgba(200,210,225,0.30)'); gr.addColorStop(1, 'rgba(220,225,235,0.06)'); }
    else    { gr.addColorStop(0, 'rgba(18,36,62,0.62)');    gr.addColorStop(0.65, 'rgba(9,18,36,0.42)');    gr.addColorStop(1, 'rgba(3,7,15,0.12)'); }
    ctx.fillStyle = gr; ctx.fill();
  }

  ctx.lineWidth = 0.8; ctx.setLineDash([2, 4]); ctx.strokeStyle = pal.ring;
  const GN = 4, GS = FR / GN;
  for (let i = -GN; i <= GN; i++) {
    const a = proj([i * GS, -FR, 0]), b = proj([i * GS, FR, 0]);
    const d = proj([-FR, i * GS, 0]), e = proj([FR, i * GS, 0]);
    if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    if (d && e) { ctx.beginPath(); ctx.moveTo(d[0], d[1]); ctx.lineTo(e[0], e[1]); ctx.stroke(); }
  }
  ctx.setLineDash([]);

  // Compass rose - N/S/E/W arrows radiating from the pedestal centre, world-fixed true bearings
  // (matches _skyDomeUnitVec's convention: az=0/N is +y, az=90/E is +x). Same colour scheme as
  // the 3D Model panel's own compass rose for visual consistency (N=blue, S=red, E/W=green).
  // Each arrow is drawn in short segments rather than one line, so the part that passes "under"
  // the globe (occluded per _skyMap3DOccluded) dims to SKY_MAP3D_DIM_ALPHA_MULT instead of
  // staying at full opacity regardless of what's in front of it.
  if (fc) {
    const cardinals = [
      { tip: [0, FR, 0],  color: lt ? 'rgba(10,78,140,1)' : 'rgba(32,160,232,1)', label: 'N' },
      { tip: [0, -FR, 0], color: lt ? 'rgba(184,18,18,1)' : 'rgba(232,64,64,1)',  label: 'S' },
      { tip: [FR, 0, 0],  color: lt ? 'rgba(24,110,32,1)' : 'rgba(120,200,120,1)', label: 'E' },
      { tip: [-FR, 0, 0], color: lt ? 'rgba(12,88,40,1)'  : 'rgba(80,220,120,1)',  label: 'W' },
    ];
    const N_SEG = 16;
    for (const card of cardinals) {
      const dimColor = _sd3WithAlpha(card.color, SKY_MAP3D_DIM_ALPHA_MULT);
      ctx.lineWidth = 1.5; ctx.setLineDash([]);
      let prevPt = fc, prevOcc = _skyMap3DOccluded([0, 0, 0]);
      for (let i = 1; i <= N_SEG; i++) {
        const t = i / N_SEG;
        const wp = [card.tip[0] * t, card.tip[1] * t, card.tip[2] * t];
        const sp = proj(wp);
        if (!sp) break;
        const occ = _skyMap3DOccluded(wp);
        ctx.beginPath(); ctx.moveTo(prevPt[0], prevPt[1]); ctx.lineTo(sp[0], sp[1]);
        ctx.strokeStyle = (occ && prevOcc) ? dimColor : card.color;
        ctx.stroke();
        prevPt = sp; prevOcc = occ;
      }
      const ep = prevPt;
      const dx = ep[0] - fc[0], dy = ep[1] - fc[1], len = Math.hypot(dx, dy);
      const tipColor = prevOcc ? dimColor : card.color;
      if (len > 3) {
        const nx = dx / len, ny = dy / len;
        ctx.beginPath();
        ctx.moveTo(ep[0], ep[1]);
        ctx.lineTo(ep[0] - nx * 6 - ny * 3, ep[1] - ny * 6 + nx * 3);
        ctx.lineTo(ep[0] - nx * 6 + ny * 3, ep[1] - ny * 6 - nx * 3);
        ctx.closePath(); ctx.fillStyle = tipColor; ctx.fill();
      }
      ctx.font = "bold 11px 'Share Tech Mono', monospace";
      ctx.fillStyle = tipColor; ctx.textAlign = 'center';
      ctx.fillText(card.label, ep[0] + dx * 0.15, ep[1] + dy * 0.15 - 1);
    }
  }
}

// Sky colour at a given elevation for the shell below - pale/hazy near the horizon (atmospheric
// haze), deeper blue toward the zenith, the same "near horizon = haze" cue real skies show.
function _skyMap3DShellColorAt(elDeg) {
  const t = Math.max(0, Math.min(1, elDeg / 90));
  return [Math.round(200 - 130 * t), Math.round(222 - 130 * t), Math.round(240 - 60 * t)];
}

// ── Translucent sky shell (mirrors the 3D Model panel's semi-transparent "cladding") ─────────
// A lat/long mesh of small quad patches over the visible hemisphere, painter-sorted by depth.
// Each patch is filled with a linear gradient between its own el/el2 sky colours (not one flat
// colour) so adjacent patches match exactly at their shared edge - the gradient reads as one
// smooth blend from horizon to zenith no matter how coarse the mesh is - while the mesh itself is
// fine enough (8° steps) that the silhouette edge and curve don't look faceted either. Drawn
// before the wireframe grid/curves so those stay legible on top.
function _skyMap3DDrawShell(ctx, layout) {
  // 1° was measured at ~20ms/frame just for this fill (11-12k visible patches) - too slow to stay
  // smooth while dragging. 2° cuts that to ~3k patches / ~5-6ms, and since colour is already exact
  // at every patch edge (the linear gradient above), the extra geometric resolution beyond 2° buys
  // essentially no visible smoothness for a real cost - see the measurement this traded off against.
  const AZ_STEP = 2, EL_STEP = 2;
  const patches = [];
  for (let az = 0; az < 360; az += AZ_STEP) {
    for (let el = 0; el < 90; el += EL_STEP) {
      const az2 = az + AZ_STEP, el2 = Math.min(90, el + EL_STEP);
      const azMid = az + AZ_STEP / 2, elMid = (el + el2) / 2;
      const centerVec = _skyDomeUnitVec(azMid, elMid);
      const visible = _sd3Dot(centerVec, _skyMap3D.camDirUnit) >= 1 / _skyMap3D.camDist;
      if (!visible) continue;
      const corners = [[az, el], [az2, el], [az2, el2], [az, el2]]
        .map(([a, e]) => _skyMap3DProjectRaw(layout, _skyDomeUnitVec(a, e)));
      if (!corners.every(Boolean)) continue;
      const rel = [centerVec[0] - _skyMap3D.camPos[0], centerVec[1] - _skyMap3D.camPos[1], centerVec[2] - _skyMap3D.camPos[2]];
      const depth = _sd3Dot(rel, _skyMap3D.FWD);
      patches.push({ corners, depth, el, el2 });
    }
  }
  patches.sort((a, b) => b.depth - a.depth);   // farthest first, nearest painted last (on top)
  for (const p of patches) {
    const c0 = _skyMap3DShellColorAt(p.el), c1 = _skyMap3DShellColorAt(p.el2);
    const midLow  = [(p.corners[0][0] + p.corners[1][0]) / 2, (p.corners[0][1] + p.corners[1][1]) / 2];
    const midHigh = [(p.corners[2][0] + p.corners[3][0]) / 2, (p.corners[2][1] + p.corners[3][1]) / 2];
    ctx.beginPath(); ctx.moveTo(p.corners[0][0], p.corners[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(p.corners[i][0], p.corners[i][1]);
    ctx.closePath();
    const grad = ctx.createLinearGradient(midLow[0], midLow[1], midHigh[0], midHigh[1]);
    grad.addColorStop(0, `rgba(${c0[0]},${c0[1]},${c0[2]},0.32)`);
    grad.addColorStop(1, `rgba(${c1[0]},${c1[1]},${c1[2]},0.32)`);
    ctx.fillStyle = grad; ctx.fill();
  }
}

// ── Sky Map 3D axes (orbiting perspective camera around the unit sphere) ─────────────────────
// Same content as the flat polar grid (drawSkyDomePolarAxes) - azimuth radials, elevation rings,
// cardinal/degree labels - but each line is sampled every few degrees and projected through
// _skyMap3DProject rather than drawn as a canvas arc()/lineTo() primitive, because a circle on
// the sphere becomes a general perspective curve once the camera isn't looking straight down the
// polar axis, and part of it may be on the far side (see _skyMap3DPolyline). Also draws a floor
// pedestal + compass rose beneath the sphere and a translucent daylight-blue shell over it,
// mirroring the 3D Model panel's ground plane and cylinder cladding respectively.
function drawSkyMap3DAxes(ctx, W, H, pal) {
  updateSkyMap3DCamera();
  const mTop = 40, mSide = 34, mBottom = 26;
  const availW = W - 2 * mSide, availH = H - mTop - mBottom;
  const scale = Math.max(10, Math.min(availW, availH) / 2);
  const cx0 = W / 2, cy0 = mTop + availH / 2;
  const layout = { mode: 'skymap3d', cx: cx0, cy: cy0, scale };
  const lt = document.body.classList.contains('light');

  _skyMap3DDrawFloorAndCompass(ctx, layout, pal, lt);
  _skyMap3DDrawShell(ctx, layout);

  // ── Azimuth meridians (every 10°, cardinals bold, every 30° medium, rest fine dashed) ────────
  for (let az = 0; az < 360; az += 10) {
    const isCardinal = (az % 90 === 0);
    const is30 = (az % 30 === 0);
    const pts = []; for (let el = 0; el <= 90; el += 3) pts.push([az, el]);
    let color;
    if (isCardinal) { color = az === 0 ? pal.north : pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else if (is30)  { color = pal.az30; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); }
    else            { color = pal.az10; ctx.lineWidth = 0.8; ctx.setLineDash([2, 4]); }
    _skyMap3DStrokePolyline(ctx, _skyMap3DPolyline(layout, pts), color);
  }
  ctx.setLineDash([]);

  // ── Elevation rings (every 10°; 0° = horizon, drawn solid+bold) ───────────────────────────────
  for (let el = 0; el <= 90; el += 10) {
    const pts = []; for (let az = 0; az <= 360; az += 5) pts.push([az, el]);
    let color;
    if (el === 0) { color = pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else { color = pal.ring; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); }
    _skyMap3DStrokePolyline(ctx, _skyMap3DPolyline(layout, pts), color);
  }
  ctx.setLineDash([]);

  // ── Azimuth labels at the horizon, nudged outward along the screen-space radial direction ────
  const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 10) {
    const p = _skyDomeProject(layout, az, 0);
    if (p.visible === false) continue;
    const dx = p.x - cx0, dy = p.y - cy0, len = Math.hypot(dx, dy) || 1;
    const lx = p.x + dx / len * 14, ly = p.y + dy / len * 14;
    const isCardinal = az in CARD;
    ctx.font = isCardinal ? "bold 13px 'Share Tech Mono', monospace" : "10px 'Share Tech Mono', monospace";
    ctx.fillStyle = isCardinal ? (az === 0 ? pal.north : pal.text) : pal.text;
    ctx.fillText(isCardinal ? CARD[az] : String(az), lx, ly);
  }

  // ── Elevation labels along the north meridian ─────────────────────────────────────────────────
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = pal.text;
  for (let el = 10; el <= 90; el += 10) {
    const p = _skyDomeProject(layout, 0, el);
    if (p.visible === false) continue;
    ctx.fillText(el + '°', p.x + 5, p.y);
  }

  return layout;
}

// ── Dome axes (polar) ──────────────────────────────────────────────────────────────────────────
function drawSkyDomePolarAxes(ctx, W, H, pal) {
  const mTop = 40, mSide = 34, mBottom = 26;
  const availW = W - 2 * mSide, availH = H - mTop - mBottom;
  const R = Math.max(10, Math.min(availW, availH) / 2);
  const cx0 = W / 2;
  const cy0 = mTop + availH / 2;
  const layout = { mode: 'dome', cx: cx0, cy: cy0, R };
  const pt = (az, el) => _skyDomePoint(cx0, cy0, R, az, el);

  // Dome background disc.
  ctx.beginPath(); ctx.arc(cx0, cy0, R, 0, Math.PI * 2);
  ctx.fillStyle = pal.plot; ctx.fill();

  // ── Azimuth radials (every 10°, cardinals bold, every 30° medium, rest fine dashed) ──────────
  for (let az = 0; az < 360; az += 10) {
    const isCardinal = (az % 90 === 0);
    const is30 = (az % 30 === 0);
    const p1 = pt(az, 0);
    ctx.beginPath();
    ctx.moveTo(cx0, cy0);
    ctx.lineTo(p1.x, p1.y);
    if (isCardinal) {
      ctx.strokeStyle = az === 0 ? pal.north : pal.rim;
      ctx.lineWidth = 1.5; ctx.setLineDash([]);
    } else if (is30) {
      ctx.strokeStyle = pal.az30; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    } else {
      ctx.strokeStyle = pal.az10; ctx.lineWidth = 0.8; ctx.setLineDash([2, 4]);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Elevation rings (every 10°; 0° = horizon = rim, drawn solid+bold) ─────────────────────────
  for (let el = 0; el <= 90; el += 10) {
    const r = R * (90 - el) / 90;
    if (r <= 0) continue;
    ctx.beginPath(); ctx.arc(cx0, cy0, r, 0, Math.PI * 2);
    if (el === 0) { ctx.strokeStyle = pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else { ctx.strokeStyle = pal.ring; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Azimuth labels just outside the rim: cardinals as letters, others as "10°" every 10° ─────
  const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 10) {
    const p = _skyDomePoint(cx0, cy0, R + 14, az, 0);
    const isCardinal = az in CARD;
    ctx.font = isCardinal ? "bold 13px 'Share Tech Mono', monospace" : "10px 'Share Tech Mono', monospace";
    ctx.fillStyle = isCardinal ? (az === 0 ? pal.north : pal.text) : pal.text;
    ctx.fillText(isCardinal ? CARD[az] : String(az), p.x, p.y);
  }

  // ── Elevation labels along the north radius, offset slightly right of the line ────────────────
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = pal.text;
  for (let el = 10; el <= 90; el += 10) {
    const r = R * (90 - el) / 90;
    ctx.fillText(el + '°', cx0 + 5, cy0 - r);
  }

  return layout;
}

// ── Matrix axes (flat azimuth/elevation chart, à la SunEarthTools.com) ───────────────────────────
// Gridline *positions* are always the same 0/20/…/360 evenly-spaced columns regardless of
// hemisphere (see _skyDomeMatrixPoint for why) - only the printed numbers and the E/S/W letters
// move, via trueAzAt(), to keep telling the truth about which compass direction is where.
function drawSkyDomeMatrixAxes(ctx, W, H, pal) {
  const mLeft = 42, mRight = 16, mTop = 40, mBottom = 40;
  const plotW = Math.max(10, W - mLeft - mRight);
  const plotH = Math.max(10, H - mTop - mBottom);
  const x0 = mLeft, y0 = mTop;
  const layout = { mode: 'matrix', x0, y0, plotW, plotH };
  const azShift = _skyDomeMatrixAzShift();
  const px = (azShifted) => x0 + (azShifted / 360) * plotW;   // azShifted: gridline-space position
  const trueAzAt = (azShifted) => (azShifted - azShift + 360) % 360;   // → real compass bearing
  const py = (el) => y0 + plotH * (1 - el / 90);

  // Plot background.
  ctx.fillStyle = pal.plot;
  ctx.fillRect(x0, y0, plotW, plotH);

  // ── Vertical gridlines every 20° (cardinals bold, true north gets its own colour) ──────────────
  for (let a = 0; a <= 360; a += 20) {
    const trueAz = trueAzAt(a);
    const isCardinal = (trueAz % 90 === 0);
    const x = px(a);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + plotH);
    if (isCardinal) { ctx.strokeStyle = (trueAz === 0) ? pal.north : pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else            { ctx.strokeStyle = pal.az10; ctx.lineWidth = 0.8; ctx.setLineDash([2, 4]); }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Horizontal gridlines every 10° elevation (0° = horizon, drawn solid+bold) ─────────────────
  for (let el = 0; el <= 90; el += 10) {
    const y = py(el);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + plotW, y);
    if (el === 0) { ctx.strokeStyle = pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else { ctx.strokeStyle = pal.ring; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Plot border.
  ctx.strokeStyle = pal.rim; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.strokeRect(x0, y0, plotW, plotH);

  // ── Azimuth ticks: true compass bearing at each gridline (numeric, every 20°) ──────────────────
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.fillStyle = pal.text;
  for (let a = 0; a <= 360; a += 20) {
    ctx.fillText(String(Math.round(trueAzAt(a))), px(a), y0 + plotH + 4);
  }
  // E/S/W compass letters - skip whichever cardinal falls on the split edges (north for the
  // northern hemisphere, south for the southern - see _skyDomeMatrixPoint), same as the reference
  // chart never labelling "N" either.
  const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  const edgeCardinal = azShift;   // 0 or 180 - the true bearing split across both edges
  ctx.font = "bold 12px 'Share Tech Mono', monospace";
  ctx.fillStyle = pal.north;
  for (const trueAzCard of [0, 90, 180, 270]) {
    if (trueAzCard === edgeCardinal) continue;
    const a = (trueAzCard + azShift) % 360;
    ctx.fillText(CARD[trueAzCard], px(a), y0 + plotH + 16);
  }
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.fillStyle = pal.text;
  ctx.fillText('Azimuth', x0 + plotW / 2, y0 + plotH + 30);

  // ── Elevation ticks (numeric, every 10°) + rotated "Elevation" axis label ─────────────────────
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let el = 0; el <= 90; el += 10) {
    ctx.fillText(el + '°', x0 - 6, py(el));
  }
  ctx.save();
  ctx.translate(11, y0 + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Elevation', 0, 0);
  ctx.restore();

  return layout;
}

function drawSkyDome() {
  const cv = document.getElementById('skyDomeCanvas');
  if (!cv) return;
  const RES = cv._res || 1;
  const ctx = cv.getContext('2d');
  const W = cv.width  / RES;
  const H = cv.height / RES;
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const lt = document.body.classList.contains('light');
  const pal = lt ? {
    bg: '#ffffff', plot: '#eef2f6', ring: 'rgba(0,0,0,0.16)', az10: 'rgba(0,0,0,0.10)',
    az30: 'rgba(0,0,0,0.22)', rim: 'rgba(0,0,0,0.55)', text: '#445a6e', north: 'rgba(10,78,140,1)',
    accent: '#8a4400', cross: 'rgba(20,40,60,0.60)'
  } : {
    bg: '#07090d', plot: '#0b0f15', ring: 'rgba(255,255,255,0.20)', az10: 'rgba(255,255,255,0.12)',
    az30: 'rgba(255,255,255,0.30)', rim: 'rgba(255,255,255,0.6)', text: '#9fb2c4', north: 'rgba(32,160,232,1)',
    accent: '#e8a020', cross: 'rgba(210,222,235,0.70)'
  };

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // ── Axes: dispatch to whichever projection is active, each returns its own layout shape ───────
  const layout = skyDomeProjection === 'matrix' ? drawSkyDomeMatrixAxes(ctx, W, H, pal)
    : skyDomeProjection === 'planet3d' ? drawSkyDomePlanet3DAxes(ctx, W, H, pal)
    : (skyDomeProjection === 'dome' && skyMap3DOn) ? drawSkyMap3DAxes(ctx, W, H, pal)
    : drawSkyDomePolarAxes(ctx, W, H, pal);
  _skyDomeLayout = layout;

  // ── Sun-path curves, drawn on top of the grid (same layering as the main canvas: grid, then
  //    the sun arcs) ─────────────────────────────────────────────────────────────────────────────
  drawSkyDomeSunPaths(ctx, layout);

  // ── Cursor crosshair: full elevation isoline + azimuth isoline through the hovered point ───────
  // Trivial in all projections - unlike the flat scan's isoline crosshair (drawCrosshair in
  // render-2d.js), which must inverse-project through the pinhole/cylinder math and handle folding,
  // an elevation isoline here is already a concentric ring (Dome/Sky Map 3D) or a horizontal line
  // (Matrix), and an azimuth isoline is already a straight radial/meridian (Dome/Sky Map 3D) or a
  // vertical line (Matrix) - no segmentation needed except Sky Map 3D's own far-side breaks.
  if (_skyDomeHoverEl !== null) {
    if (layout.mode === 'skymap3d') {
      // Elevation isoline (a ring at the hovered elevation) + azimuth isoline (a meridian at the
      // hovered azimuth), sampled/projected/broken exactly like the grid (drawSkyMap3DAxes) - the
      // hovered point itself is always visible by construction (it's the ray-sphere hit that
      // produced it in _skyMap3DPixelToAzEl).
      const ringPts = []; for (let az = 0; az <= 360; az += 5) ringPts.push([az, _skyDomeHoverEl]);
      ctx.lineWidth = 1; ctx.setLineDash([]);
      _skyMap3DStrokePolyline(ctx, _skyMap3DPolyline(layout, ringPts), pal.cross);

      if (_skyDomeHoverAz !== null) {
        const meridianPts = []; for (let el = 0; el <= 90; el += 3) meridianPts.push([_skyDomeHoverAz, el]);
        _skyMap3DStrokePolyline(ctx, _skyMap3DPolyline(layout, meridianPts), pal.cross);

        const hp = _skyDomeProject(layout, _skyDomeHoverAz, _skyDomeHoverEl);
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.cross; ctx.fill();
      }
    } else if (layout.mode === 'planet3d') {
      // Same isoline construction as Sky Map 3D, just through the planetarium's own
      // fisheye projection/polyline helpers.
      const ringPts = []; for (let az = 0; az <= 360; az += 5) ringPts.push([az, _skyDomeHoverEl]);
      ctx.lineWidth = 1; ctx.setLineDash([]);
      _skyDomePlanet3DStrokePolyline(ctx, _skyDomePlanet3DPolyline(layout, ringPts), pal.cross);

      if (_skyDomeHoverAz !== null) {
        const meridianPts = []; for (let el = 0; el <= 90; el += 3) meridianPts.push([_skyDomeHoverAz, el]);
        _skyDomePlanet3DStrokePolyline(ctx, _skyDomePlanet3DPolyline(layout, meridianPts), pal.cross);

        const hp = _skyDomeProject(layout, _skyDomeHoverAz, _skyDomeHoverEl);
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.cross; ctx.fill();
      }
    } else if (layout.mode === 'matrix') {
      // Go through _skyDomeProject (az=0 is arbitrary here - it doesn't affect y) so the line
      // lands exactly where the curves/grid do, including the culmination-centring shift.
      const y = _skyDomeProject(layout, 0, _skyDomeHoverEl).y;
      ctx.beginPath(); ctx.moveTo(layout.x0, y); ctx.lineTo(layout.x0 + layout.plotW, y);
      ctx.strokeStyle = pal.cross; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.stroke();

      if (_skyDomeHoverAz !== null) {
        const hp = _skyDomeProject(layout, _skyDomeHoverAz, _skyDomeHoverEl);
        ctx.beginPath(); ctx.moveTo(hp.x, layout.y0); ctx.lineTo(hp.x, layout.y0 + layout.plotH);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.stroke();

        ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.cross; ctx.fill();
      }
    } else {
      const { cx, cy, R } = layout;
      const rHover = R * (90 - _skyDomeHoverEl) / 90;
      ctx.beginPath(); ctx.arc(cx, cy, rHover, 0, Math.PI * 2);
      ctx.strokeStyle = pal.cross; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.stroke();

      if (_skyDomeHoverAz !== null) {
        const rim = _skyDomePoint(cx, cy, R, _skyDomeHoverAz, 0);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(rim.x, rim.y);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.stroke();

        const hp = _skyDomePoint(cx, cy, R, _skyDomeHoverAz, _skyDomeHoverEl);
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.cross; ctx.fill();
      }
    }
  }

  // ── Title (mirrors Sun Graph's, §17.9) ────────────────────────────────────────────────────────
  const latStr = LAT.toFixed(1) + '° ' + (hemisphere >= 0 ? 'N' : 'S');
  ctx.fillStyle = pal.accent;
  ctx.font = "bold 14px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Sky Dome', 34, 26);
  ctx.fillStyle = pal.text; ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.fillText('Lat ' + latStr, 34 + 90, 26);
}

// ── Wiring ───────────────────────────────────────────────────────────────────
// (Top sub-view switcher is now the wheel in .mode-subrow, wired in controls.js.)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && skyDomeActive) exitSkyDome();
});

// Projection switch (top-right of the canvas, Sky Dome only): Sky Map / Az-El Chart / Planetarium.
// Same wheel-picker widget as the Custom date month/day pickers and the main Analyzer sub-view
// switcher (makeWheelPicker(), controls.js). Internal value stays 'dome' (only the displayed
// label changed to "Sky Map") to avoid touching every existing `layout.mode === 'dome'`-adjacent
// branch in this file.
const SKY_DOME_PROJ_VALUES = ['dome', 'matrix', 'planet3d'];
const SKY_DOME_PROJ_LABELS = ['SKY MAP', 'AZ-EL CHART', 'PLANETARIUM'];
const SKY_DOME_PROJ_N = SKY_DOME_PROJ_VALUES.length;
let _skyDomeProjIndex = Math.max(0, SKY_DOME_PROJ_VALUES.indexOf(skyDomeProjection));

// Sky Map's "3D" toggle is only relevant while Sky Map itself is selected (Az-El Chart and
// Planetarium have no such sub-toggle - Planetarium's zoom slider is unconditional, see below).
// The zoom slider is shared between Sky Map's 3D toggle and Planetarium - only one of the two can
// ever be showing at once (skyDomeProjection is a single value), so one physical slider covers
// both; see the input handler below for which camera it actually drives.
function updateSkyMap3DControlsVisibility() {
  const toggleRow = document.getElementById('skyMap3DToggleRow');
  if (toggleRow) toggleRow.style.display = (skyDomeActive && skyDomeProjection === 'dome') ? 'flex' : 'none';
  const zoomCtl = document.getElementById('skyMap3DZoomCtl');
  const showZoom = skyDomeActive && ((skyDomeProjection === 'dome' && skyMap3DOn) || skyDomeProjection === 'planet3d');
  if (zoomCtl) zoomCtl.style.display = showZoom ? 'flex' : 'none';
  const imgRow = document.getElementById('skyDomePlanetImgToggleRow');
  if (imgRow) imgRow.style.display = (skyDomeActive && skyDomeProjection === 'planet3d') ? 'flex' : 'none';
}
function stepSkyDomeProjWheel(dir) {
  _skyDomeProjIndex = ((_skyDomeProjIndex + dir) % SKY_DOME_PROJ_N + SKY_DOME_PROJ_N) % SKY_DOME_PROJ_N;
}
function commitSkyDomeProjWheel() {
  skyDomeProjection = SKY_DOME_PROJ_VALUES[_skyDomeProjIndex];
  updateSkyMap3DControlsVisibility();
  _skyDomeProjWheel.render();
  drawSkyDome();
}
const _skyDomeProjWheel = makeWheelPicker(document.getElementById('skyDomeProjWheelTrack'), {
  labelAt: (off) => SKY_DOME_PROJ_LABELS[((_skyDomeProjIndex + off) % SKY_DOME_PROJ_N + SKY_DOME_PROJ_N) % SKY_DOME_PROJ_N],
  step: stepSkyDomeProjWheel,
  itemW: 96,
  onCommit: commitSkyDomeProjWheel,
});
document.getElementById('btnSkyDomeProjDec').addEventListener('click', () => { stepSkyDomeProjWheel(-1); commitSkyDomeProjWheel(); });
document.getElementById('btnSkyDomeProjInc').addEventListener('click', () => { stepSkyDomeProjWheel(1);  commitSkyDomeProjWheel(); });
_skyDomeProjWheel.render();
updateSkyMap3DControlsVisibility();

// ── Sky Map "3D" ON/OFF toggle ─────────────────────────────────────────────────────────────────
document.getElementById('btnSkyMap3DToggle').addEventListener('click', () => {
  skyMap3DOn = !skyMap3DOn;
  const btn = document.getElementById('btnSkyMap3DToggle');
  btn.classList.toggle('on', skyMap3DOn);
  btn.setAttribute('aria-checked', String(skyMap3DOn));
  updateSkyMap3DControlsVisibility();
  drawSkyDome();
});

// ── Planetarium "render image" toggle (pilot) ─────────────────────────────────────────────────
document.getElementById('btnSkyDomePlanetImgToggle').addEventListener('click', () => {
  skyDomePlanetImageOn = !skyDomePlanetImageOn;
  const btn = document.getElementById('btnSkyDomePlanetImgToggle');
  btn.classList.toggle('on', skyDomePlanetImageOn);
  btn.querySelector('span').textContent = skyDomePlanetImageOn ? 'HIDE IMAGE' : 'RENDER IMAGE';
  drawSkyDome();
});

// ── Sky Map 3D zoom slider ─────────────────────────────────────────────────────────────────────
function setSkyMap3DZoom(z) {
  _skyMap3D.zoom = Math.max(0.5, Math.min(2, z));
  updateSkyMap3DCamera();
  const rng = document.getElementById('skyMap3DZoom');
  if (rng && parseFloat(rng.value) !== _skyMap3D.zoom) rng.value = _skyMap3D.zoom;
  const val = document.getElementById('skyMap3DZoomVal');
  if (val) val.textContent = _skyMap3D.zoom.toFixed(1) + '×';
  drawSkyDome();
}
function setSkyDomePlanet3DZoom(z) {
  _skyDomePlanet3D.zoom = Math.max(0.5, Math.min(2, z));
  updateSkyDomePlanetCamera();
  const rng = document.getElementById('skyMap3DZoom');
  if (rng && parseFloat(rng.value) !== _skyDomePlanet3D.zoom) rng.value = _skyDomePlanet3D.zoom;
  const val = document.getElementById('skyMap3DZoomVal');
  if (val) val.textContent = _skyDomePlanet3D.zoom.toFixed(1) + '×';
  drawSkyDome();
}
// One physical slider, dispatched to whichever 3D view is actually showing (see
// updateSkyMap3DControlsVisibility - the two are never visible at the same time).
document.getElementById('skyMap3DZoom').addEventListener('input', (e) => {
  const z = parseFloat(e.target.value);
  if (skyDomeProjection === 'planet3d') setSkyDomePlanet3DZoom(z);
  else setSkyMap3DZoom(z);
});

// ── Sky Map 3D orbit drag + pinch-zoom (mouse + touch) ────────────────────────────────────────
// Mirrors render-3d.js's "Theater drag-orbit" block: mousedown/touchstart on the canvas starts
// the drag, mousemove/mouseup on window so it keeps tracking even if the cursor leaves the canvas
// mid-drag. While _skyMap3DDragging is true, handleSkyDomeMouseMove() (the hover/crosshair
// readout) steps aside - see its early return. Only active while Sky Map's "3D" toggle is on.
(function () {
  const cv = document.getElementById('skyDomeCanvas');
  let lastX = 0, lastY = 0;

  function orbitStart(x, y) {
    _skyMap3DDragging = true;
    lastX = x; lastY = y;
    cv.style.cursor = 'grabbing';
  }
  function orbitMove(x, y) {
    if (!_skyMap3DDragging) return;
    const dx = x - lastX, dy = y - lastY;
    lastX = x; lastY = y;
    _skyMap3D.camAz += dx * 0.005;
    _skyMap3D.camEl  = Math.max(0.06, Math.min(Math.PI / 2 - 0.04, _skyMap3D.camEl + dy * 0.004));
    updateSkyMap3DCamera();
    drawSkyDome();
  }
  function orbitEnd() {
    if (!_skyMap3DDragging) return;
    _skyMap3DDragging = false;
    cv.style.cursor = 'default';
  }

  cv.addEventListener('mousedown', (e) => {
    if (!skyDomeActive || skyDomeProjection !== 'dome' || !skyMap3DOn) return;
    orbitStart(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => orbitMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', orbitEnd);

  // Touch: one finger = orbit, two fingers = pinch-zoom.
  let pinching = false, pinchStartDist = 0, pinchStartZoom = 1;
  function touchDist(t) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  }
  cv.addEventListener('touchstart', (e) => {
    if (!skyDomeActive || skyDomeProjection !== 'dome' || !skyMap3DOn) return;
    if (e.touches.length === 1) {
      orbitStart(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      pinching = true;
      pinchStartDist = touchDist(e.touches);
      pinchStartZoom = _skyMap3D.zoom;
      _skyMap3DDragging = false;
    }
  }, { passive: true });
  cv.addEventListener('touchmove', (e) => {
    if (pinching && e.touches.length === 2) {
      setSkyMap3DZoom(pinchStartZoom * (touchDist(e.touches) / pinchStartDist));
    } else if (e.touches.length === 1) {
      orbitMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });
  cv.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) { orbitEnd(); pinching = false; }
  });
})();

// ── Planetarium look-around drag + pinch-zoom (mouse + touch) ─────────────────────────────────
// Same structure as Sky Map 3D's drag block above, but with BOTH axes reversed - dragging left/
// right or up/down moves the *sky* under the cursor in that direction (as if you were dragging
// the dome itself), rather than panning the gaze to follow the cursor the way the Sky Map 3D
// orbit-camera and a typical FPS mouse-look do. Only active while Planetarium is selected.
let _skyDomePlanet3DDragging = false;
(function () {
  const cv = document.getElementById('skyDomeCanvas');
  let lastX = 0, lastY = 0;

  function dragStart(x, y) {
    _skyDomePlanet3DDragging = true;
    lastX = x; lastY = y;
    cv.style.cursor = 'grabbing';
  }
  function dragMove(x, y) {
    if (!_skyDomePlanet3DDragging) return;
    const dx = x - lastX, dy = y - lastY;
    lastX = x; lastY = y;
    _skyDomePlanet3D.camAz -= dx * 0.005;
    _skyDomePlanet3D.camEl  = Math.max(0, Math.min(Math.PI / 2 - 0.02, _skyDomePlanet3D.camEl + dy * 0.004));
    updateSkyDomePlanetCamera();
    drawSkyDome();
  }
  function dragEnd() {
    if (!_skyDomePlanet3DDragging) return;
    _skyDomePlanet3DDragging = false;
    cv.style.cursor = 'default';
  }

  cv.addEventListener('mousedown', (e) => {
    if (!skyDomeActive || skyDomeProjection !== 'planet3d') return;
    dragStart(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => dragMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', dragEnd);

  let pinching = false, pinchStartDist = 0, pinchStartZoom = 1;
  function touchDist(t) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  }
  cv.addEventListener('touchstart', (e) => {
    if (!skyDomeActive || skyDomeProjection !== 'planet3d') return;
    if (e.touches.length === 1) {
      dragStart(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      pinching = true;
      pinchStartDist = touchDist(e.touches);
      pinchStartZoom = _skyDomePlanet3D.zoom;
      _skyDomePlanet3DDragging = false;
    }
  }, { passive: true });
  cv.addEventListener('touchmove', (e) => {
    if (pinching && e.touches.length === 2) {
      setSkyDomePlanet3DZoom(pinchStartZoom * (touchDist(e.touches) / pinchStartDist));
    } else if (e.touches.length === 1) {
      dragMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });
  cv.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) { dragEnd(); pinching = false; }
  });
})();

// ── Mouse wheel = zoom, for whichever 3D view is currently showing ────────────────────────────
// One listener on the shared canvas, dispatched the same way as the #skyMap3DZoom slider above.
(function () {
  const cv = document.getElementById('skyDomeCanvas');
  cv.addEventListener('wheel', (e) => {
    if (!skyDomeActive) return;
    const in3D = skyDomeProjection === 'planet3d' || (skyDomeProjection === 'dome' && skyMap3DOn);
    if (!in3D) return;
    e.preventDefault();
    const factor = 1 - Math.sign(e.deltaY) * 0.1;
    if (skyDomeProjection === 'planet3d') setSkyDomePlanet3DZoom(_skyDomePlanet3D.zoom * factor);
    else setSkyMap3DZoom(_skyMap3D.zoom * factor);
  }, { passive: false });
})();

// Redraw when the canvas area resizes (window / panel changes) - mirrors Sun Graph's own observer.
(function () {
  const container = document.getElementById('canvasContainer');
  if (container && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (skyDomeActive) resizeSkyDome(); }).observe(container);
  }
})();

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Planetarium - the third projection (see the file header): the observer stands at the sphere's
// own centre and looks around (drag pans/tilts the gaze, zoom narrows/widens the field of view)
// instead of orbiting the sphere from outside like the active Sky Map "3D" toggle above. Wired
// into the projection wheel (SKY_DOME_PROJ_VALUES/LABELS) and dispatched from _skyDomeProject(),
// _skyDomePixelToAzEl() and drawSkyDome()'s axes/crosshair sections above; its own drag/zoom
// controls live further up too (right after Sky Map 3D's, sharing the same zoom slider since only
// one of the two is ever visible at once).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const _SKY_PLANET3D_BASE_FOCAL = 1.15;   // focal length at zoom=1x - tunes the default field of view
// camAz/camEl are the VIEWING DIRECTION (drag pans/tilts it, like a first-person look-around
// camera), zoom narrows/widens the field of view (bigger FOCAL = more magnified/narrower FOV)
// instead of moving the camera closer. camEl is clamped to [0, ~90°) - looking below the horizon
// shows nothing (the sky model has no data there anyway), so the opposite horizon is reached by
// panning camAz 180°, not by tilting past the zenith.
const _skyDomePlanet3D = { camAz: Math.PI, camEl: 0.7, zoom: 1.0 };

// Recompute the viewing-direction basis (RIGHT/UP/FWD) and focal length from camAz/camEl/zoom -
// call after mutating any of the three. FWD is simply the direction the observer faces (there's
// no camera position to derive it from - the observer never leaves the centre).
function updateSkyDomePlanetCamera() {
  const az = _skyDomePlanet3D.camAz, el = _skyDomePlanet3D.camEl;
  const fwd = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
  const worldUp = [0, 0, 1];
  let right = _sd3Cross(fwd, worldUp);
  const rlen = Math.hypot(right[0], right[1], right[2]) || 1;
  right = [right[0] / rlen, right[1] / rlen, right[2] / rlen];
  const up = _sd3Cross(right, fwd);
  _skyDomePlanet3D.RIGHT = right; _skyDomePlanet3D.UP = up; _skyDomePlanet3D.FWD = fwd;
  _skyDomePlanet3D.FOCAL = _SKY_PLANET3D_BASE_FOCAL * _skyDomePlanet3D.zoom;
}
updateSkyDomePlanetCamera();

// Fisheye (equidistant) projection of one sphere point as seen by an observer standing at the
// sphere's centre. Returns {x, y, visible, alpha}. Real planetarium/fisheye optics comfortably
// cover well over a hemisphere (many exceed 180°), so this renders out to PLANET3D_FADE_OUTER
// (170° from the view direction, i.e. everything except a narrow ~10°-wide patch directly behind
// the observer's head), not just the 90° a plain "front hemisphere" cutoff would give - fading
// smoothly (alpha 1→0) from PLANET3D_FADE_INNER to that limit rather than snapping off, since the
// close vicinity of the true opposite-of-view-direction point (θ=180°) is a genuine, unavoidable
// singularity for this mapping (sin(180°)=0 - the point's screen position isn't just extreme
// there, it's undefined), not merely an arbitrary cutoff choice.
//
// This is deliberately NOT the plain-perspective/gnomonic mapping (sx=FOCAL·lx/lz) the first
// version used: gnomonic projection keeps every great circle - including every azimuth meridian -
// perfectly straight, which sounds right but looks wrong at any real field of view, because the
// straight lines radiate from the centre like the ribs of a pyramid, splaying out faster and
// faster toward the rim (and blowing up entirely as a meridian approaches 90° from the view
// direction, tan(90°)=∞ - gnomonic can never exceed a 180° FOV at all, let alone the wider range
// used here). Equidistant projection instead makes screen radius proportional to the angle θ from
// the view direction (θ, not tan θ) - the same mapping a real fisheye lens or a planetarium
// dome-master projector uses. Under it, the one meridian running straight through the view
// direction is still a straight vertical line (by symmetry), but every other meridian bows outward
// (convex) toward the rim instead of radiating - the barrel-distortion look anyone who's shot a
// fisheye photo will recognise, and the shape actually expected of a "standing inside a dome" view.
const PLANET3D_FADE_INNER = 130 * Math.PI / 180;   // full opacity out to here
const PLANET3D_FADE_OUTER = 170 * Math.PI / 180;   // faded to fully transparent by here
function _skyDomePlanet3DProject(layout, az, el) {
  const v = _skyDomeUnitVec(az, el);
  const cosTheta = _sd3Dot(v, _skyDomePlanet3D.FWD);
  const theta = Math.acos(Math.max(-1, Math.min(1, cosTheta)));
  if (theta >= PLANET3D_FADE_OUTER) return { x: layout.cx, y: layout.cy, visible: false, alpha: 0 };
  const alpha = theta <= PLANET3D_FADE_INNER ? 1
    : 1 - (theta - PLANET3D_FADE_INNER) / (PLANET3D_FADE_OUTER - PLANET3D_FADE_INNER);
  const lx = _sd3Dot(v, _skyDomePlanet3D.RIGHT), ly = _sd3Dot(v, _skyDomePlanet3D.UP);
  const rho = Math.hypot(lx, ly);   // = sin(theta), stays comfortably away from 0 until θ→180°
  const k = rho > 1e-6 ? theta / rho : 1;   // → 1 as theta→0, matching plain perspective at centre
  const sx = _skyDomePlanet3D.FOCAL * lx * k, sy = _skyDomePlanet3D.FOCAL * ly * k;
  return { x: layout.cx + sx * layout.scale, y: layout.cy - sy * layout.scale, visible: true, alpha };
}

// Inverse of the equidistant mapping above: canvas pixel → angle+direction-in-image-plane →
// world ray direction (the observer stands at the sphere's own centre, so the ray direction
// itself IS the point on the unit sphere - no ray-sphere intersection needed) → {az, el}. Capped
// at the same PLANET3D_FADE_OUTER as the forward projection - the cursor readout shouldn't report
// a position for the faded-to-nothing rim the eye can no longer really see either.
function _skyDomePlanet3DPixelToAzEl(layout, px, py) {
  const sx = (px - layout.cx) / layout.scale / _skyDomePlanet3D.FOCAL;
  const sy = -(py - layout.cy) / layout.scale / _skyDomePlanet3D.FOCAL;
  const theta = Math.hypot(sx, sy);
  if (theta > PLANET3D_FADE_OUTER) return null;
  const rho = Math.sin(theta), lz = Math.cos(theta);
  const k = theta > 1e-6 ? rho / theta : 1;
  const lx = sx * k, ly = sy * k;
  const R = _skyDomePlanet3D.RIGHT, U = _skyDomePlanet3D.UP, F = _skyDomePlanet3D.FWD;
  const v = [
    lx * R[0] + ly * U[0] + lz * F[0],
    lx * R[1] + ly * U[1] + lz * F[1],
    lx * R[2] + ly * U[2] + lz * F[2],
  ];
  const el = Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI;
  if (el < -0.5) return null;
  const az = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
  return { az, el: Math.max(0, el) };
}

// pts may contain null entries (hard breaks - below horizon, wraparound). Otherwise each point's
// own .alpha (see _skyDomePlanet3DProject) fades the stroke smoothly toward the rim - drawn as
// separate segments per alpha "bucket" (rounded to the nearest ALPHA_BUCKET) rather than one flat
// colour, continuous across bucket boundaries, the same technique _skyDomeStrokeArc uses.
const PLANET3D_ALPHA_BUCKET = 0.12;
function _skyDomePlanet3DPolyline(layout, points) {
  return points.map(([az, el]) => _skyDomePlanet3DProject(layout, az, el));
}
function _skyDomePlanet3DStrokePolyline(ctx, pts, color) {
  if (pts.length < 2) return;
  const baseAlpha = _sd3AlphaOf(color);
  let curBucket = null, curAlpha = 1, first = true;
  const strokeSeg = () => { ctx.strokeStyle = _sd3WithAlpha(color, baseAlpha * curAlpha); ctx.stroke(); };
  ctx.beginPath();
  for (const p of pts) {
    if (!p || p.alpha <= 0.02) {
      if (!first) strokeSeg();
      ctx.beginPath(); first = true; curBucket = null;
      continue;
    }
    const bucket = Math.round(p.alpha / PLANET3D_ALPHA_BUCKET);
    if (curBucket !== null && bucket !== curBucket) {
      ctx.lineTo(p.x, p.y);
      strokeSeg();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      first = false;
    } else if (first) {
      ctx.moveTo(p.x, p.y); first = false;
    } else {
      ctx.lineTo(p.x, p.y);
    }
    curBucket = bucket; curAlpha = p.alpha;
  }
  if (!first) strokeSeg();
}

// ── Planetarium sky shell: sun halo + time-of-day ambient (mirrors Sky Map 3D's cladding, but
// driven by the sun's actual current position instead of a fixed daytime gradient) ──────────────
// Two independent effects, layered:
//  1. A halo around the sun itself - a soft white glow right at the sun, fading over ~10° to the
//     ambient sky colour (both requirements from the brief: "bílá záře kolem Slunce" + "gradient
//     do 10 stupňů do polední modré"). Drawn as its own canvas radial gradient centred on the
//     sun's projected position, NOT baked into the shell mesh below - the mesh patches are ~2-4°
//     wide, too coarse to approximate a falloff that's centred on an arbitrary point and changes
//     over the same ~10° span without visible banding, whereas a radial gradient is perfectly
//     smooth at any resolution.
//  2. The ambient sky itself, which depends only on elevation (not azimuth - see
//     _skyPlanetAmbientColorAt) and on how high the sun currently is: normal daytime blue
//     (_skyMap3DShellColorAt, reused as-is) fades down through a warm dusk/dawn tint - hugging the
//     horizon, per the brief's "gradient u nízkých elevací, kdy působí vliv atmosféry" - into a
//     dark night sky as the sun crosses into astronomical twilight (reusing render-sungraph.js's
//     own _SG_THRESH.astro=-18° for the same "fully dark" cutoff the rest of the app already uses).
//     Because this stays azimuth-independent, the existing per-patch linear-gradient trick (exact
//     colour match at every patch's shared edge, see _skyMap3DDrawShell) still applies unchanged.
function _lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
// 0 once the sun is in astronomical twilight or below, 1 once it's comfortably risen (+10°).
function _skyDaylightFactor(sunElDeg) {
  return Math.max(0, Math.min(1, (sunElDeg - _SG_THRESH.astro) / (10 - _SG_THRESH.astro)));
}
// Peaks (1) with the sun sitting right on the horizon, fades to 0 by ±18° either way - the window
// a real sunrise/sunset's warm colours actually show.
function _skyDuskFactor(sunElDeg) {
  return Math.max(0, Math.min(1, 1 - Math.abs(sunElDeg) / 18));
}
function _skyPlanetAmbientColorAt(elDeg, sunElDeg) {
  const dayCol = _skyMap3DShellColorAt(elDeg);
  const nightCol = [6, 10, 24];
  let col = _lerp3(nightCol, dayCol, _skyDaylightFactor(sunElDeg));
  const horizonBand = Math.max(0, Math.min(1, 1 - elDeg / 22));
  const glowStrength = _skyDuskFactor(sunElDeg) * horizonBand * 0.55;
  return _lerp3(col, [235, 140, 70], glowStrength);
}

function _skyDomePlanet3DDrawShell(ctx, layout, sunAz, sunEl) {
  const AZ_STEP = 4, EL_STEP = 4;   // Planetarium's field of view is narrower than Sky Map 3D's
  const patches = [];               // near-hemisphere, so a coarser mesh is already plenty smooth.
  for (let az = 0; az < 360; az += AZ_STEP) {
    for (let el = 0; el < 90; el += EL_STEP) {
      const az2 = az + AZ_STEP, el2 = Math.min(90, el + EL_STEP);
      const azMid = az + AZ_STEP / 2, elMid = (el + el2) / 2;
      const centerP = _skyDomePlanet3DProject(layout, azMid, elMid);
      if (centerP.visible === false || centerP.alpha <= 0.02) continue;   // behind observer / faded out
      const corners = [[az, el], [az2, el], [az2, el2], [az, el2]].map(([a, e]) => {
        const p = _skyDomePlanet3DProject(layout, a, e);
        return p.visible === false ? null : [p.x, p.y];
      });
      if (!corners.every(Boolean)) continue;
      patches.push({ corners, el, el2, alpha: centerP.alpha });
    }
  }
  for (const p of patches) {
    const c0 = _skyPlanetAmbientColorAt(p.el, sunEl), c1 = _skyPlanetAmbientColorAt(p.el2, sunEl);
    const midLow  = [(p.corners[0][0] + p.corners[1][0]) / 2, (p.corners[0][1] + p.corners[1][1]) / 2];
    const midHigh = [(p.corners[2][0] + p.corners[3][0]) / 2, (p.corners[2][1] + p.corners[3][1]) / 2];
    ctx.beginPath(); ctx.moveTo(p.corners[0][0], p.corners[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(p.corners[i][0], p.corners[i][1]);
    ctx.closePath();
    const grad = ctx.createLinearGradient(midLow[0], midLow[1], midHigh[0], midHigh[1]);
    grad.addColorStop(0, `rgba(${c0[0] | 0},${c0[1] | 0},${c0[2] | 0},1)`);
    grad.addColorStop(1, `rgba(${c1[0] | 0},${c1[1] | 0},${c1[2] | 0},1)`);
    ctx.fillStyle = grad;
    ctx.globalAlpha = p.alpha;   // fades the whole patch smoothly toward the rim (see _skyDomePlanet3DProject)
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Sun halo overlay - only while the sun is above (or just below) the horizon; a sun deep in
  // astronomical twilight isn't lighting the sky enough to show one.
  if (sunEl > -20) {
    const sunPt = _skyDomePlanet3DProject(layout, sunAz, sunEl);
    if (sunPt.visible !== false) {
      // Radius of the ~10° falloff in *screen* pixels at the sun's current position - measured
      // directly (project a point 10° away and take the on-screen distance) rather than assumed
      // constant, since the fisheye mapping's pixels-per-degree isn't uniform across the frame.
      const abovePt = _skyDomePlanet3DProject(layout, sunAz, Math.min(90, sunEl + 10));
      const radiusPx = Math.max(8, abovePt.visible !== false
        ? Math.hypot(abovePt.x - sunPt.x, abovePt.y - sunPt.y)
        : layout.scale * 0.3);
      const haloCore = _lerp3([255, 150, 60], [255, 255, 255], _skyDaylightFactor(sunEl));
      const haloStrength = Math.max(0, Math.min(1, (sunEl + 20) / 20));
      const grad = ctx.createRadialGradient(sunPt.x, sunPt.y, 0, sunPt.x, sunPt.y, radiusPx);
      grad.addColorStop(0,    `rgba(${haloCore[0] | 0},${haloCore[1] | 0},${haloCore[2] | 0},${(0.95 * haloStrength).toFixed(3)})`);
      grad.addColorStop(0.35, `rgba(${haloCore[0] | 0},${haloCore[1] | 0},${haloCore[2] | 0},${(0.55 * haloStrength).toFixed(3)})`);
      grad.addColorStop(1,    `rgba(${haloCore[0] | 0},${haloCore[1] | 0},${haloCore[2] | 0},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(sunPt.x, sunPt.y, radiusPx, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ── Planetarium "render image" (pilot): warp the calibrated photo onto the sky dome ────────────
// The photo (imgBitmap) lives in its own calibrated pixel space, defined by azElToPixel/
// pixelToAzEl (core.js) - a "path" convention that mirrors az/H for the southern hemisphere so
// the yaw/pitch/roll sliders always mean the same thing regardless of hemisphere (world axes
// south/west/up - see applyPitch's comment there). Planetarium's own (az,el) is true-compass
// (east/north/up, no mirroring - see _skyDomeUnitVec above). The two don't agree on what a given
// (az,el) number means for the southern hemisphere, so bridging them naively would risk a
// left-right flip. The bridge used here is _rotCanInvWorld() (render-3d.js) - the same
// yaw+hemisphere-flip/roll/pitch rotation already used to test whether a sun ray enters the can -
// verified numerically (both hemispheres, nonzero yaw/pitch/roll) to reproduce azElToPixel's own
// pixel exactly.
//
// World (az,el) [true-compass] → flat-scan pixel, or null if that direction falls outside the
// calibrated photo's own canvas (canvasLW×canvasLH - already sized to exactly the paper's real
// exposed extent via scanWmm/radius/horizonMm, so no separate paper-bounds formula is needed).
function _skyDomePlanetImagePixel(az, el) {
  const v = _skyDomeUnitVec(az, el);                          // (E,N,U), true-compass
  const [lx, ly, lz] = _rotCanInvWorld(-v[1], -v[0], v[2]);   // (E,N,U)→(S,W,Up)→can-local frame
  const bl = Math.atan2(ly, lx);
  const tl = Math.asin(Math.max(-1, Math.min(1, lz)));
  if (Math.abs(tl) >= Math.PI / 2 - 0.001) return null;       // same guard as azElToPixel
  const sx = 2 * R * hScale * bl;
  const sy = 2 * R * hScale * Math.cos(bl) * Math.tan(tl);
  const px = cx + sx * scale;
  const py = getEffectiveCy() - sy * scale;
  if (px < 0 || px >= canvasLW || py < 0 || py >= canvasLH) return null;
  return { px, py };
}

// The photo is drawn at (0,0,canvasLW,canvasLH) in Image mode (render-2d.js's draw()), stretching
// imgBitmap's own native pixel size to fill the calibrated canvas exactly - so a canvas-space
// (px,py) from _skyDomePlanetImagePixel above needs that same stretch to sample the right spot.
// Cheapest way to get that: pre-render it once into an offscreen canvas at canvasLW×canvasLH and
// texture-map FROM that (native-pixel-space maths would otherwise need a second rescale per
// sample). Cached and only rebuilt when the photo or the calibrated canvas size actually changes.
let _skyDomePlanetImgTexCanvas = null, _skyDomePlanetImgTexSrc = null, _skyDomePlanetImgTexDims = '';
function _skyDomePlanetImageTexture() {
  if (!imgBitmap) return null;
  const dims = canvasLW + 'x' + canvasLH;
  if (_skyDomePlanetImgTexCanvas && _skyDomePlanetImgTexSrc === imgBitmap && _skyDomePlanetImgTexDims === dims) {
    return _skyDomePlanetImgTexCanvas;
  }
  const c = document.createElement('canvas');
  c.width = canvasLW; c.height = canvasLH;
  c.getContext('2d').drawImage(imgBitmap, 0, 0, canvasLW, canvasLH);
  _skyDomePlanetImgTexCanvas = c; _skyDomePlanetImgTexSrc = imgBitmap; _skyDomePlanetImgTexDims = dims;
  return c;
}

// Affine coefficients [a,b,c,d,e,f] (for ctx.transform) mapping source triangle s0,s1,s2 onto
// destination triangle d0,d1,d2 - the standard 2D-canvas texture-mapped-triangle technique (no
// WebGL needed: clip to the destination triangle, transform, then drawImage the whole source
// through it - only the clipped area ends up visible).
function _sdPlanetImgAffine(s0, s1, s2, d0, d1, d2) {
  const denom = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(denom) < 1e-9) return null;   // degenerate (near-zero-area) source triangle
  const a = (d0[0]*(s1[1]-s2[1]) + d1[0]*(s2[1]-s0[1]) + d2[0]*(s0[1]-s1[1])) / denom;
  const b = (d0[1]*(s1[1]-s2[1]) + d1[1]*(s2[1]-s0[1]) + d2[1]*(s0[1]-s1[1])) / denom;
  const c = (d0[0]*(s2[0]-s1[0]) + d1[0]*(s0[0]-s2[0]) + d2[0]*(s1[0]-s0[0])) / denom;
  const d = (d0[1]*(s2[0]-s1[0]) + d1[1]*(s0[0]-s2[0]) + d2[1]*(s1[0]-s0[0])) / denom;
  const e = (d0[0]*(s1[0]*s2[1]-s2[0]*s1[1]) + d1[0]*(s2[0]*s0[1]-s0[0]*s2[1]) + d2[0]*(s0[0]*s1[1]-s1[0]*s0[1])) / denom;
  const f = (d0[1]*(s1[0]*s2[1]-s2[0]*s1[1]) + d1[1]*(s2[0]*s0[1]-s0[0]*s2[1]) + d2[1]*(s0[0]*s1[1]-s1[0]*s0[1])) / denom;
  return [a, b, c, d, e, f];
}
function _sdPlanetImgDrawTriangle(ctx, img, s0, s1, s2, d0, d1, d2, alpha) {
  const m = _sdPlanetImgAffine(s0, s1, s2, d0, d1, d2);
  if (!m) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

const SD_PLANET_IMG_AZ_STEP = 4, SD_PLANET_IMG_EL_STEP = 4;   // same mesh density as the shell
const SD_PLANET_IMG_FEATHER_FRAC = 0.06;   // feather width, as a fraction of the canvas' short side

// Paints the photo warp onto ctx, patch by patch (two triangles each), same mesh shape as
// _skyDomePlanet3DDrawShell above - except it covers the FULL sphere (el -90..90), not just the
// sky (el 0..90): the paper usually catches some of the ground/landscape below the horizon too,
// unlike the ambient shell (a sky-only colour model with nothing to show there). Feathers to
// transparent near the photo's own edge (the paper's real exposed extent - see
// _skyDomePlanetImagePixel) instead of a hard cut, and respects the dome's own outer rim fade
// (centerP.alpha) for consistency with everything else. Factored out from
// _skyDomePlanet3DDrawImage below so it can target either the live canvas or the offscreen cache.
function _skyDomePlanet3DPaintImage(ctx, layout, tex) {
  const featherPx = SD_PLANET_IMG_FEATHER_FRAC * Math.min(canvasLW, canvasLH);
  const AZ_STEP = SD_PLANET_IMG_AZ_STEP, EL_STEP = SD_PLANET_IMG_EL_STEP;

  for (let az = 0; az < 360; az += AZ_STEP) {
    for (let el = -90; el < 90; el += EL_STEP) {
      const az2 = az + AZ_STEP, el2 = Math.min(90, el + EL_STEP);
      const azMid = az + AZ_STEP / 2, elMid = (el + el2) / 2;

      const pTL = _skyDomePlanet3DProject(layout, az,  el2);
      const pTR = _skyDomePlanet3DProject(layout, az2, el2);
      const pBL = _skyDomePlanet3DProject(layout, az,  el);
      const pBR = _skyDomePlanet3DProject(layout, az2, el);
      const pMid = _skyDomePlanet3DProject(layout, azMid, elMid);
      if ([pTL, pTR, pBL, pBR, pMid].some(p => p.visible === false || p.alpha <= 0.02)) continue;

      const sTL = _skyDomePlanetImagePixel(az,  el2);
      const sTR = _skyDomePlanetImagePixel(az2, el2);
      const sBL = _skyDomePlanetImagePixel(az,  el);
      const sBR = _skyDomePlanetImagePixel(az2, el);
      const sMid = _skyDomePlanetImagePixel(azMid, elMid);
      if (!sTL || !sTR || !sBL || !sBR || !sMid) continue;   // some corner off the exposed paper

      const edgeDist = Math.min(sMid.px, canvasLW - sMid.px, sMid.py, canvasLH - sMid.py);
      const featherAlpha = Math.max(0, Math.min(1, edgeDist / featherPx));
      if (featherAlpha <= 0.02) continue;
      const alpha = featherAlpha * pMid.alpha;

      _sdPlanetImgDrawTriangle(ctx, tex, [sTL.px,sTL.py], [sTR.px,sTR.py], [sBL.px,sBL.py],
                                          [pTL.x,pTL.y],   [pTR.x,pTR.y],   [pBL.x,pBL.y], alpha);
      _sdPlanetImgDrawTriangle(ctx, tex, [sTR.px,sTR.py], [sBR.px,sBR.py], [sBL.px,sBL.py],
                                          [pTR.x,pTR.y],   [pBR.x,pBR.y],   [pBL.x,pBL.y], alpha);
    }
  }
}

// Memoized: rebuilding the mesh above (a few thousand clipped/transformed drawImage calls,
// ~8ms measured - the dominant cost of a Planetarium redraw) only actually changes the resulting
// PIXELS when the camera, calibration, canvas size, or the photo itself change - not on every
// drawSkyDome() call. Sun-time animation, Display checkboxes, cursor moves etc. all trigger a full
// redraw without touching any of those, so most calls can just re-blit the previous result.
// Rendered once into an offscreen canvas, cached until the key below actually differs; a live
// camera drag/zoom still invalidates every frame (its own inputs genuinely change every frame),
// same cost as before - this only removes the wasted repaints in between.
let _skyDomePlanetImgCache = { canvas: null, cctx: null, key: '', W: 0, H: 0, RES: 0, tex: null };

function _skyDomePlanetImgCacheKey(layout) {
  const p = _skyDomePlanet3D;
  return [
    p.camAz.toFixed(4), p.camEl.toFixed(4), p.zoom.toFixed(3),
    yawDeg, pitchDeg, rollDeg, radius, horizonMm, scanWmm, hemisphere,
    layout.cx.toFixed(2), layout.cy.toFixed(2), layout.scale.toFixed(2),
    canvasLW, canvasLH,
  ].join('|');
}

function _skyDomePlanet3DDrawImage(ctx, layout) {
  if (!skyDomePlanetImageOn) return;
  const tex = _skyDomePlanetImageTexture();
  if (!tex) return;

  const cv = document.getElementById('skyDomeCanvas');
  const RES = cv._res || 1;
  const W = cv.width / RES, H = cv.height / RES;
  const cache = _skyDomePlanetImgCache;
  const sizeChanged = cache.W !== W || cache.H !== H || cache.RES !== RES;

  if (!cache.canvas || sizeChanged) {
    cache.canvas = document.createElement('canvas');
    cache.canvas.width = Math.round(W * RES);
    cache.canvas.height = Math.round(H * RES);
    cache.cctx = cache.canvas.getContext('2d');
    cache.W = W; cache.H = H; cache.RES = RES;
    cache.key = '';   // force a repaint below
  }

  const key = _skyDomePlanetImgCacheKey(layout);
  if (cache.key !== key || cache.tex !== tex) {
    cache.cctx.setTransform(RES, 0, 0, RES, 0, 0);
    cache.cctx.clearRect(0, 0, W, H);
    _skyDomePlanet3DPaintImage(cache.cctx, layout, tex);
    cache.key = key;
    cache.tex = tex;
  }

  ctx.drawImage(cache.canvas, 0, 0, W, H);
}

// Same content as the flat polar grid - azimuth meridians, elevation rings, cardinal/degree
// labels - but each line is sampled every few degrees and projected through
// _skyDomePlanet3DProject rather than drawn as a canvas arc()/lineTo() primitive, because a
// circle on the sphere becomes a general perspective curve once the view isn't looking straight
// down the polar axis, and part of it may fall behind the observer.
function drawSkyDomePlanet3DAxes(ctx, W, H, pal) {
  updateSkyDomePlanetCamera();
  const mTop = 40, mSide = 34, mBottom = 26;
  const availW = W - 2 * mSide, availH = H - mTop - mBottom;
  const scale = Math.max(10, Math.min(availW, availH) / 2);
  const cx0 = W / 2, cy0 = mTop + availH / 2;
  const layout = { mode: 'planet3d', cx: cx0, cy: cy0, scale };

  // Real-time sun position for the shell below - same convention/inputs as the animated sun
  // marker in drawSkyDomeSunPaths (true-compass signed latitude, real unshifted custom date).
  const _sunDelta = sunDeclination(dayOfYear(customMonth, customDay));
  const _sunPhi   = effectiveLat() * hemisphere;
  const _sunNow   = sunPosition((sunTimeHours - 12) * 15 * Math.PI / 180, _sunDelta, _sunPhi);
  _skyDomePlanet3DDrawShell(ctx, layout, _sunNow.az, _sunNow.el);
  _skyDomePlanet3DDrawImage(ctx, layout);

  for (let az = 0; az < 360; az += 10) {
    const isCardinal = (az % 90 === 0);
    const is30 = (az % 30 === 0);
    const pts = []; for (let el = 0; el <= 90; el += 3) pts.push([az, el]);
    let color;
    if (isCardinal) { color = az === 0 ? pal.north : pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else if (is30)  { color = pal.az30; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); }
    else            { color = pal.az10; ctx.lineWidth = 0.8; ctx.setLineDash([2, 4]); }
    _skyDomePlanet3DStrokePolyline(ctx, _skyDomePlanet3DPolyline(layout, pts), color);
  }
  ctx.setLineDash([]);

  for (let el = 0; el <= 90; el += 10) {
    const pts = []; for (let az = 0; az <= 360; az += 5) pts.push([az, el]);
    let color;
    if (el === 0) { color = pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else { color = pal.ring; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); }
    _skyDomePlanet3DStrokePolyline(ctx, _skyDomePlanet3DPolyline(layout, pts), color);
  }
  ctx.setLineDash([]);

  const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 10) {
    const p = _skyDomePlanet3DProject(layout, az, 0);
    if (p.visible === false) continue;
    const dx = p.x - cx0, dy = p.y - cy0, len = Math.hypot(dx, dy) || 1;
    const lx = p.x + dx / len * 14, ly = p.y + dy / len * 14;
    const isCardinal = az in CARD;
    ctx.font = isCardinal ? "bold 13px 'Share Tech Mono', monospace" : "10px 'Share Tech Mono', monospace";
    ctx.fillStyle = isCardinal ? (az === 0 ? pal.north : pal.text) : pal.text;
    ctx.fillText(isCardinal ? CARD[az] : String(az), lx, ly);
  }

  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = pal.text;
  for (let el = 10; el <= 90; el += 10) {
    const p = _skyDomePlanet3DProject(layout, 0, el);
    if (p.visible === false) continue;
    ctx.fillText(el + '°', p.x + 5, p.y);
  }

  return layout;
}
// ═══════════════════════════════ end of parked planetarium code ═══════════════════════════════
