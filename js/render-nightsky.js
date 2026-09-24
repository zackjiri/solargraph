// ─── Night Sky engine (Phase 1: local sidereal time) ───────────────────────────────────────────
// New mode, alongside Gallery/Analyzer/Eclipse: a real star map (constellations from public
// GeoJSON catalogs, see project notes) plus clickable markers for the user's own night-sky photos.
// (Named "Night Sky", not "Sky Map", to avoid colliding with the existing Sky Dome projection
// already called "Sky Map" internally - see render-skydome.js's own file header.)
//
// Unlike the rest of the app (Analyzer/Sky Dome/Sun Graph), which deliberately works in
// day-of-year with NO absolute year - a solargraph repeats every year, so the Sun's position only
// ever needs day-of-year + hour (see pathDeclination()/sunPosition() in core.js) - star positions
// on the sky need a genuine calendar year. Local Sidereal Time (LST) does NOT return to the same
// value each year at a fixed calendar date/UT time: calendar years advance by an integer number of
// days (365 or 366), short of the 365.2422-day tropical year by ~0.2422 day, so GMST at a fixed
// date/time drifts by roughly 0.2422 sidereal days (~87 degrees) per common year, reset by about a
// full day at each leap year - a ~6 hour swing across the leap-year cycle, nowhere near negligible
// for "which stars are up". So this engine takes a real (year, month, day, hourUT), like Eclipse
// mode's per-event dates, not the app's usual day-of-year-only convention.
//
// Algorithm: Julian Date (Meeus, "Astronomical Algorithms" ch.7) + Greenwich/Local Mean Sidereal
// Time (Meeus ch.12, the IAU 1982 GMST-at-UT1 polynomial - UT1/UTC difference (<1s) ignored, well
// below what matters for a naked-eye star map).

// Julian Date (UT) for a Gregorian calendar civil date/time. hourUT may include minutes/seconds as
// a fraction (e.g. 13.5 = 13:30 UT). Valid for the Gregorian calendar (after 1582-10-15).
function _skyToJulianDateUT(year, month, day, hourUT) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + hourUT / 24 + b - 1524.5;
}

// Inverse of _skyToJulianDateUT (Meeus ch.7's own inverse algorithm) - Julian Date (UT) back to a
// Gregorian civil {year, month, day, hourUT}. Used by the time strip's continuous drag/animation
// (below): dragging is done entirely in JD-space (a single continuous number), then converted back
// to calendar fields only to update the UI/state - this is what makes crossing a UTC midnight "just
// work" as a date rollover, with no separate day-boundary special-casing needed in the drag math.
function _skyFromJulianDateUT(jd) {
  const jdShift = jd + 0.5;
  const Z = Math.floor(jdShift);
  const F = jdShift - Z;
  let A = Z;
  if (Z >= 2299161) {
    const alpha = Math.floor((Z - 1867216.25) / 36524.25);
    A = Z + 1 + alpha - Math.floor(alpha / 4);
  }
  const B = A + 1524;
  const C = Math.floor((B - 122.1) / 365.25);
  const D = Math.floor(365.25 * C);
  const E = Math.floor((B - D) / 30.6001);
  const dayFrac = B - D - Math.floor(30.6001 * E) + F;
  const day = Math.floor(dayFrac);
  const hourUT = (dayFrac - day) * 24;
  const month = E < 14 ? E - 1 : E - 13;
  const year = month > 2 ? C - 4716 : C - 4715;
  return { year, month, day, hourUT };
}

// Greenwich Mean Sidereal Time, in degrees [0, 360), for Julian Date jd (UT-based).
function _skyGMSTDeg(jd) {
  const d = jd - 2451545.0;
  const t = d / 36525;
  let theta = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  theta = theta % 360;
  return theta < 0 ? theta + 360 : theta;
}

// Local Sidereal Time, in hours [0, 24), for a real civil UT date/time and observer longitude
// (degrees, EAST-positive - matches lonHemisphere*LONG's sign convention used elsewhere, e.g.
// _eclipseLocalCirc's own note on the app's LONG/lonHemisphere fields).
function _skySiderealTimeHours(year, month, day, hourUT, lonDegEast) {
  const jd = _skyToJulianDateUT(year, month, day, hourUT);
  const gmstDeg = _skyGMSTDeg(jd);
  let lstHours = (gmstDeg / 15) + (lonDegEast / 15);
  lstHours = lstHours % 24;
  return lstHours < 0 ? lstHours + 24 : lstHours;
}

// ─── Phase 2: equatorial (RA/Dec) -> horizontal (Az/El) ────────────────────────────────────────
// Reuses sunPosition(H, delta, phi) from core.js UNCHANGED - despite the name it's already a
// generic hour-angle/declination/latitude -> az/el transform (standard spherical astronomy), not
// Sun-specific. The only thing star positions need that the Sun's own call sites don't derive the
// same way is the hour angle H itself: for the Sun the app computes H from apparent solar time
// (sunTimeHours), but a star's fixed RA needs H = LST - RA (LST from Phase 1 above).
//
// raDeg/decDeg: star's equatorial coordinates in degrees (as given by the GeoJSON catalogs, J2000).
// lstHours: local sidereal time (Phase 1). latDegSigned: real signed latitude, i.e. LAT*hemisphere
// (see core.js's LAT/hemisphere convention, same as _eclipseLocalCirc's LAT*hemisphere usage).
function _skyRaDecToAzEl(raDeg, decDeg, lstHours, latDegSigned) {
  const D2R = Math.PI / 180;
  let hDeg = lstHours * 15 - raDeg;
  hDeg = ((hDeg + 180) % 360 + 360) % 360 - 180;   // normalize to (-180, 180]
  return sunPosition(hDeg * D2R, decDeg * D2R, latDegSigned * D2R);
}

// Convenience wrapper: star Az/El for a real civil UT date/time, using the app's OWN current
// Location (LAT/hemisphere/LONG/lonHemisphere, core.js) - same "reuse the app's own location"
// pattern as _eclipseLocalCirc().
//
// LAT===90 exactly (true pole) was found to break the whole map: sunPosition()'s own azimuth
// formula divides by cos(phi), which floating-point cos(90°) doesn't quite reach zero for but gets
// close enough to make azimuth numerically unstable/arbitrary per star - every star's ELEVATION
// still comes out correct (= its own declination, a real identity at the pole), but azimuth becomes
// essentially noise, so constellation lines connect points at wildly different, near-random
// directions instead of forming their real shape. core.js's own effectiveLat() already exists for
// exactly this singularity (its own comment: "clamp poles and equator to avoid singularities") but
// only clamps the MAGNITUDE, not the sign - reusing its exact same clamp values here (0.1/89.9)
// rather than inventing a new one.
function _skyStarAzEl(raDeg, decDeg, year, month, day, hourUT) {
  const latMagClamped = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;
  const lonDegEast = lonHemisphere * LONG;
  const latDegSigned = hemisphere * latMagClamped;
  const lstHours = _skySiderealTimeHours(year, month, day, hourUT, lonDegEast);
  return _skyRaDecToAzEl(raDeg, decDeg, lstHours, latDegSigned);
}

// ─── Astro Catalog frame geometry (build 40_1) ─────────────────────────────────────────────────
// Local East/North unit tangent vectors at a given point on the celestial sphere (RA/Dec, degrees)
// - "East" is the direction of increasing RA, "North" the direction of increasing Dec, at that
// exact point. Standard orthonormal basis for the gnomonic (tangent-plane) construction below.
function _skyRaDecTangentBasis(raDeg, decDeg) {
  const ra = raDeg * Math.PI / 180, dec = decDeg * Math.PI / 180;
  const v0 = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const east = [-Math.sin(ra), Math.cos(ra), 0];
  const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
  return { v0, east, north };
}
// Offsets a field centre (raDeg, decDeg) by (uRad, vRad) - u along local East, v along local
// North, both RADIANS - via an EXACT gnomonic (tangent-plane) construction: build the 3D point
// v0 + u*east + v*north (a point on the plane tangent to the sphere at v0) and re-normalize it
// back onto the unit sphere - a central projection from the sphere's own centre, exact for any
// offset (not a small-angle approximation), the standard technique for framing a telescope/camera
// field. Same family of spherical-astronomy math as the rest of this section (sidereal time,
// RA/Dec->Az/El above) - not a flat-plane shortcut. Returns {raDeg, decDeg}.
function _skyOffsetRaDec(raDeg, decDeg, uRad, vRad) {
  const { v0, east, north } = _skyRaDecTangentBasis(raDeg, decDeg);
  const px = v0[0] + uRad * east[0] + vRad * north[0];
  const py = v0[1] + uRad * east[1] + vRad * north[1];
  const pz = v0[2] + uRad * east[2] + vRad * north[2];
  const len = Math.hypot(px, py, pz) || 1;
  const decOut = Math.asin(Math.max(-1, Math.min(1, pz / len)));
  let raOut = Math.atan2(py / len, px / len);
  if (raOut < 0) raOut += 2 * Math.PI;
  return { raDeg: raOut * 180 / Math.PI, decDeg: decOut * 180 / Math.PI };
}
// The 4 corners (order: TL, TR, BR, BL) of a rectangular photo frame - centre RA/Dec + field of
// view width/height (degrees, full extent) + rotation (Position Angle, degrees, standard
// astronomical convention: 0 = frame's "up" points North, positive rotates that "up" direction
// toward East) - plus, for each corner, its two short "L" bracket-arm endpoints (toward its two
// neighbouring corners, NIGHTSKY_FRAME_L_FRAC of the way there) for _nightSkyDrawCatalogFrame
// below. Built entirely in the same local (east, north) tangent-plane offsets as
// _skyOffsetRaDec above - not a naive RA/Dec lerp, which would distort badly near the poles.
const NIGHTSKY_FRAME_L_FRAC = 0.22;
function _nightSkyFrameCorners(raDeg, decDeg, fovWDeg, fovHDeg, rotationDeg) {
  const D2R = Math.PI / 180;
  // _skyOffsetRaDec's (u, v) are TANGENT-PLANE distances (the gnomonic/rectilinear mapping a real
  // camera lens follows: a point at field angle theta from the optical axis lands tan(theta) from
  // centre on the sensor/tangent plane, not theta itself) - halfW/halfH must be tan(half-FOV), not
  // the half-FOV angle in radians. Using the angle directly (an earlier version of this function
  // did) is only the small-angle approximation tan(x)~=x, invisible for a narrow FOV (a few degrees
  // - where the two are equal to several decimal places) but a large, real undersizing for a wide
  // one: found via the user's own wide-angle aurora shot (A2024-05-11_AUR06, 104x63.2 deg) - the
  // frame's true corner-to-centre angular distance came out ~46.7 deg instead of the correct
  // ~54.8 deg (verified via proper spherical angular separation, not a flat Pythagorean estimate,
  // which itself isn't exactly right either at this FOV - only the full tan()-then-atan() round
  // trip is).
  const halfW = Math.tan(fovWDeg / 2 * D2R), halfH = Math.tan(fovHDeg / 2 * D2R);
  const rot = rotationDeg * D2R;
  // "up"/"right" as (east, north) components - pre-rotation up=North/right=East; PA rotates "up"
  // toward East by `rot`, "right" turns the same way (stays perpendicular to "up").
  const upE = Math.sin(rot), upN = Math.cos(rot);
  const rightE = Math.cos(rot), rightN = -Math.sin(rot);
  const toOffset = ([rx, ry]) => _skyOffsetRaDec(raDeg, decDeg, rx * rightE + ry * upE, rx * rightN + ry * upN);

  const cornersLocal = [[-halfW, halfH], [halfW, halfH], [halfW, -halfH], [-halfW, -halfH]];   // TL,TR,BR,BL
  const corners = cornersLocal.map(toOffset);
  const arms = cornersLocal.map(([rx, ry], i) => {
    const prev = cornersLocal[(i + 3) % 4], next = cornersLocal[(i + 1) % 4];
    const toPrev = [rx + (prev[0] - rx) * NIGHTSKY_FRAME_L_FRAC, ry + (prev[1] - ry) * NIGHTSKY_FRAME_L_FRAC];
    const toNext = [rx + (next[0] - rx) * NIGHTSKY_FRAME_L_FRAC, ry + (next[1] - ry) * NIGHTSKY_FRAME_L_FRAC];
    return [toOffset(toPrev), toOffset(toNext)];
  });
  return { corners, arms };
}

// The Sun's own real Az/El for a real civil UT date/time - unlike a catalog star, the Sun has no
// fixed RA/Dec to look up, so this goes through the app's own existing Hour-Angle route instead
// (core.js's sunPosition(H,delta,phi), the same "for the Sun the app computes H from apparent solar
// time" path _skyRaDecToAzEl's own comment already calls out, just fed from Night Sky's real UT
// clock rather than the app's sunTimeHours slider). Mean solar time at this LONGITUDE = UT +
// longitude/15h; apparent (true) solar time = that + the equation of time (core.js's own
// trueFromMean, already used everywhere else time-display-mode conversion is needed) - then H =
// (apparent solar hour - 12) x 15 deg, normalized to (-180,180] the same way _skyRaDecToAzEl
// normalizes its own hour angle. REAL signed latitude/declination throughout (LAT*hemisphere,
// sunDeclination) - NOT the flat 2D scan's "path" convention (pathDeclination/effectiveLat, always
// positive latitude to keep pinhole framing fixed regardless of hemisphere), since Night Sky wants
// the Sun's true position in the real sky, exactly like every star here. Same LAT===0/90 pole/
// equator clamp as _skyStarAzEl, for the same reason (sunPosition's own azimuth formula divides by
// cos(latitude)).
function _nightSkySunAzEl(year, month, day, hourUT) {
  const doy = dayOfYear(month, day);
  const lonDegEast = lonHemisphere * LONG;
  const meanSolarHour = hourUT + lonDegEast / 15;
  const trueSolarHour = trueFromMean(meanSolarHour, doy);
  let hDeg = (trueSolarHour - 12) * 15;
  hDeg = ((hDeg + 180) % 360 + 360) % 360 - 180;
  const latMagClamped = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;
  const phi = hemisphere * latMagClamped * Math.PI / 180;
  const delta = sunDeclination(doy);
  return sunPosition(hDeg * Math.PI / 180, delta, phi);
}

// ─── Phase 3: load the vendored catalog data ───────────────────────────────────────────────────
// data/celestial/*.json are vendored, unmodified copies from the D3-Celestial project (BSD-3-
// Clause, Olaf Frohn) - see data/celestial/NOTICE.md for the full license text and original
// catalog sources (XHIP/Hipparcos for stars, IAU for constellation lines). Fetched at runtime as
// plain JSON, same pattern as filelist_eclipse.json - NOT loaded as <script> tags.
//
// Coordinates in both files are [RA, Dec] in degrees, J2000, RA pre-converted by D3-Celestial to
// -180..180 (its own GeoJSON convention) - kept as-is here rather than re-normalized to 0..360,
// since _skyRaDecToAzEl's H = LST*15 - RA works correctly for any RA representation (it normalizes
// H itself afterwards).
let _skyStars = [];            // [{id, mag, bv, raDeg, decDeg}, ...]
let _skyConstellations = [];   // [{id, rank, lines: [[[ra,dec], [ra,dec], ...], ...]}, ...] (MultiLineString)
let _skyDataLoaded = false;

function _skyLoadData() {
  return Promise.all([
    fetch('data/celestial/stars.6.json').then(r => r.json()),
    fetch('data/celestial/constellations.lines.json').then(r => r.json()),
  ]).then(([starsGeo, constGeo]) => {
    _skyStars = starsGeo.features.map(f => ({
      id: f.id,
      mag: f.properties.mag,
      bv: f.properties.bv,
      raDeg: f.geometry.coordinates[0],
      decDeg: f.geometry.coordinates[1],
    }));
    _skyConstellations = constGeo.features.map(f => ({
      id: f.id,
      rank: f.properties.rank,
      lines: f.geometry.coordinates,
    }));
    _skyDataLoaded = true;
    return { starCount: _skyStars.length, constellationCount: _skyConstellations.length };
  });
}

// ─── Phase 4: Night Sky mode - top-level mode toggle + canvas skeleton ─────────────────────────
// Peer of Gallery/Analyzer/Eclipse (NOT an Analyzer sub-view like Sky Dome/Sun Graph/3D Model,
// which live on the mode wheel) - same "piggyback on Analyzer's canvas-container/panel
// scaffolding" pattern as Eclipse (enterEclipse(), render-eclipse.js): entering just means "be in
// Analyzer, then take over the canvas". Toggles back off to the plain Image sub-view, not out of
// Analyzer entirely. This mirrors enterEclipse()/exitEclipse() call-for-call; see that function's
// own comments for why each line is there.
//
// Build 40_1 gave Night Sky a second-level split of its own, Catalog | Visualization, mirroring
// Eclipse's identical split (eclipseSubView/enterEclipseCatalog/enterEclipseVisualization,
// js/render-eclipse.js) - Catalog (a tile grid of astrophotography shots, filelist_astro.json) is
// the landing sub-view every time Night Sky is entered; Visualization is everything this whole
// section used to do directly, unchanged underneath (the actual Sky Map/Planetarium star-map
// canvas, still switched via its own separate, lower-level wheel, NIGHTSKY_SUBMODE_VALUES below -
// that split was NOT replaced, just nested one level deeper).
let nightSkyActive = false;
let nightSkyTopView = 'catalog';   // 'catalog' | 'visualization'

function enterNightSky() {
  // Mutually exclusive canvas takeovers: 3D Model, Sun Graph, Sky Dome, Eclipse, Night Sky.
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D && typeof exitTheater3D === 'function') exitTheater3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive && typeof exitSunGraph === 'function') exitSunGraph();
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive && typeof exitSkyDome === 'function') exitSkyDome();
  if (typeof eclipseActive !== 'undefined' && eclipseActive && typeof exitEclipse === 'function') exitEclipse();

  const container = document.getElementById('canvasContainer');
  const uploadZone = document.getElementById('uploadZone');
  container.classList.remove('hidden');
  if (uploadZone) uploadZone.classList.add('hidden');

  document.getElementById('mainCanvas').style.pointerEvents = 'none';
  document.getElementById('statusWrap').style.display = 'none';
  document.getElementById('can3dPanel').classList.remove('visible');
  document.getElementById('displaySection').style.display = 'none';
  document.getElementById('eclipseDisplaySection').style.display = 'none';
  // Shown for BOTH sub-views (not just Visualization) - same reasoning as Eclipse's own
  // eclipseDisplaySection: Az/Alt/Labels/Equatorial/Horizon apply to Catalog too in principle
  // (harmless to leave visible even though Catalog's own tiles are static thumbnails, not live
  // renders that would actually respect them).
  document.getElementById('nightSkyDisplaySection').style.display = 'flex';
  // Calibration panel: same "Location/Time zone stay, pinhole sliders don't apply" split as
  // Eclipse (_eclipseLocalCirc's own comment) - the Date block's own show/hide moved to
  // enterNightSkyVisualization()/exitNightSkyVisualization() below, since Catalog doesn't drive a
  // single current date/time the way Visualization does.
  document.getElementById('calibNonLocationGroup').classList.add('hidden');
  document.getElementById('btnCalibReset').classList.add('hidden');
  // The header formula ("pinhole projection definition...") is Solargraph/Analyzer-specific and has
  // no meaning for a real star map - hidden the same way Eclipse already hides it for its own
  // duration (enterEclipse/exitEclipse, render-eclipse.js), restored on exit below.
  document.getElementById('headerFormula').style.display = 'none';

  document.getElementById('btnModeAnalyzer').className = 'mode-btn';
  document.getElementById('btnModeNightSky').classList.add('active-night-sky');

  nightSkyActive = true;
  document.getElementById('nightSkyTopRow').style.display = 'flex';
  _nightSkyTopWheel.render();   // just became visible/measurable - re-measure its own width

  // Every entry from the main menu (this function only ever runs from the #btnModeNightSky click
  // handler - see below) re-syncs date/time/time zone to the real current moment, the same effect
  // as the SET NOW button (§13.3, build 39_1) - Night Sky is a live star map, so landing back on
  // "now" on every visit is the expected baseline; also a sane Catalog-browsing default even
  // before any tile is picked, and Visualization's own baseline if entered without picking one.
  _nightSkySetNow();

  // Always land on Catalog first, regardless of which sub-view was showing last time Night Sky was
  // active - same convention as Eclipse's own enterEclipse()/_eclipseSubIndex.
  _nightSkyTopIndex = 0;
  _nightSkyTopWheel.render();
  enterNightSkyCatalog();

  if (typeof updateViewButtons === 'function') updateViewButtons();
}

function exitNightSky() {
  if (nightSkyTopView === 'visualization') exitNightSkyVisualization(); else exitNightSkyCatalog();
  document.getElementById('nightSkyTopRow').style.display = 'none';
  document.getElementById('mainCanvas').style.pointerEvents = '';
  document.getElementById('headerFormula').style.display = '';
  nightSkyActive = false;

  document.getElementById('can3dPanel').classList.add('visible');
  document.getElementById('displaySection').style.display = '';
  document.getElementById('nightSkyDisplaySection').style.display = 'none';
  document.getElementById('calibNonLocationGroup').classList.remove('hidden');
  document.getElementById('btnCalibReset').classList.remove('hidden');
  document.getElementById('btnModeNightSky').classList.remove('active-night-sky');
  // Restore Analyzer's own active look, since it was suppressed above while Night Sky had the
  // spotlight - only when actually staying in Analyzer (leaving for Gallery sets both buttons'
  // classes itself right after this returns) - same reasoning as exitEclipse().
  if (currentMode === 'analyzer') document.getElementById('btnModeAnalyzer').className = 'mode-btn active-analyzer';

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

// ── Catalog / Visualization second-level split (build 40_1) - same wheel-picker widget as the
// Analyzer sub-view switcher, Sky Dome's projection switch, and Eclipse's own identical split
// (makeWheelPicker(), js/controls.js). ────────────────────────────────────────────────────────────
const NIGHTSKY_TOP_VALUES = ['catalog', 'visualization'];
const NIGHTSKY_TOP_LABELS = ['CATALOG', 'VISUALIZATION'];
const NIGHTSKY_TOP_N = NIGHTSKY_TOP_VALUES.length;
let _nightSkyTopIndex = 0;
function _nightSkyStepTop(dir) {
  _nightSkyTopIndex = ((_nightSkyTopIndex + dir) % NIGHTSKY_TOP_N + NIGHTSKY_TOP_N) % NIGHTSKY_TOP_N;
}
function _nightSkyCommitTop() {
  const target = NIGHTSKY_TOP_VALUES[_nightSkyTopIndex];
  if (target === 'catalog') enterNightSkyCatalog(); else enterNightSkyVisualization();
  _nightSkyTopWheel.render();
}
const _nightSkyTopWheel = makeWheelPicker(document.getElementById('nightSkyTopWheelTrack'), {
  labelAt: (off) => NIGHTSKY_TOP_LABELS[((_nightSkyTopIndex + off) % NIGHTSKY_TOP_N + NIGHTSKY_TOP_N) % NIGHTSKY_TOP_N],
  step: _nightSkyStepTop,
  itemW: 104,
  onCommit: _nightSkyCommitTop,
});
document.getElementById('btnNightSkyTopDec').addEventListener('click', () => { _nightSkyStepTop(-1); _nightSkyCommitTop(); });
document.getElementById('btnNightSkyTopInc').addEventListener('click', () => { _nightSkyStepTop(1);  _nightSkyCommitTop(); });

function enterNightSkyCatalog() {
  nightSkyTopView = 'catalog';
  exitNightSkyVisualization();
  document.getElementById('nightSkyCatalogPanel').style.display = 'flex';
  // The top Az/Alt/Day/Time/Dir readout describes one instant of one view - meaningless while just
  // browsing the grid (there's no single "current" position/time here). visibility (not display)
  // so the row's own space stays reserved - same as Eclipse's own enterEclipseCatalog().
  document.getElementById('readout').style.visibility = 'hidden';
  _nightSkyRenderCatalogGrid();
}
function exitNightSkyCatalog() {
  document.getElementById('nightSkyCatalogPanel').style.display = 'none';
  document.getElementById('readout').style.visibility = '';
}

function enterNightSkyVisualization() {
  nightSkyTopView = 'visualization';
  exitNightSkyCatalog();

  document.getElementById('nightSkyCanvas').style.display = 'block';
  document.getElementById('nightSkyDateGroup').style.display = 'flex';
  document.getElementById('nightSkyTimeWrap').style.display = 'flex';
  document.getElementById('nightSkySubmodeRow').style.display = 'flex';
  _nightSkySubmodeWheel.render();   // just became visible/measurable - re-measure its own width
  // The top Az/Alt/Dir readout now tracks the cursor over the sky (see the pointermove listener
  // further down this file) - stays visible, just reset to placeholders (no hover yet) instead of
  // left showing stale values from whatever view was active before. Day/Time show the currently
  // SELECTED date/time instead (same "driven by the current view, not the cursor" pattern as
  // Eclipse's own _eclipseUpdateReadout) - _nightSkySyncControls() below populates those for real,
  // so they're not blanked here.
  _nightSkyClearReadout();
  _nightSkyUpdatePlanetControlsVisibility();
  _nightSkyUpdatePresentationLock();

  // Date/time controls only just became visible/measurable - sync their displayed values and
  // re-measure the wheel widths (same reasoning as _eclipseSubWheel.render() on Eclipse entry).
  _nightSkySyncControls();

  resizeNightSky();
  // Data only needs fetching once - the promise re-fires drawNightSky() when it resolves, so a
  // second entry into Night Sky (already loaded) draws immediately instead of waiting again.
  if (!_skyDataLoaded) {
    _skyLoadData().then(() => { if (nightSkyActive && nightSkyTopView === 'visualization') drawNightSky(); })
      .catch(err => console.warn('Night Sky: failed to load celestial data', err));
  } else {
    drawNightSky();
  }
}
function exitNightSkyVisualization() {
  // A catalog photo's frame is only ever loadable via the Catalog tile that set it (user's own
  // requirement) - it never persists across leaving Visualization, whether to Catalog, to Sky Map
  // (see _nightSkyCommitSubmode's own clear, the other half of this), or out of Night Sky entirely
  // (exitNightSky() calls this same function while in Visualization). Returning to Planetarium
  // later always starts from a clean slate, not a stale photo from a previous visit.
  _nightSkyActiveFrame = null;
  // Stop the animation loop, if running - it has no reason to keep advancing time (and burning a
  // rAF callback) once the canvas showing it is hidden.
  if (typeof _nightSkyAnimActive !== 'undefined' && _nightSkyAnimActive && typeof _nightSkyStopAnim === 'function') _nightSkyStopAnim();
  document.getElementById('nightSkyCanvas').style.display = 'none';
  document.getElementById('nightSkyDateGroup').style.display = 'none';
  document.getElementById('nightSkyTimeWrap').style.display = 'none';
  document.getElementById('nightSkySubmodeRow').style.display = 'none';
  // Hidden directly, not via _nightSkyUpdatePlanetControlsVisibility(): exitNightSky() calls this
  // while nightSkyTopView is still 'visualization' and nightSkyActive still true, so that
  // function's own condition would keep the slider on screen.
  document.getElementById('nightSkyPlanetZoomCtl').style.display = 'none';
  _nightSkyUpdatePresentationLock();
  // Own readout contributions (Az/Alt/Dir from the cursor listener, Day/Time from
  // _nightSkyUpdateReadout via _nightSkySyncControls) don't belong to whatever view comes next -
  // clear them here rather than leaving them to whatever the next mode's own trigger happens to be.
  _nightSkyClearReadout();
  document.getElementById('valDay').textContent = '—';
  document.getElementById('valTime').textContent = '—';
  document.getElementById('nightSkyFrameThumb').style.display = 'none';
}

// ─── Astro Catalog (build 40_1) - tile grid of astrophotography shots (filelist_astro.json),
// mirroring Eclipse's own Catalog/photo-gallery pattern (js/render-eclipse.js). Clicking a tile
// applies its EXIF date/time/location, centers the Planetarium camera on the shot's own target
// RA/Dec, and draws a 4-corner "L" bracket frame there (_nightSkyDrawCatalogFrame, near the other
// Planetarium draw functions further down) - purely an orientation aid, not warped/scaled to the
// photo itself. The floating square thumbnail and fullscreen photo modal live there too, next to
// where the frame itself gets drawn/positioned on every redraw.

// Parses "10h41m00s" -> hours (decimal), "+41°16'00\"" -> degrees (decimal, sign-aware) - the
// traditional sexagesimal notation any planetarium tool displays, easiest to hand-transcribe into
// filelist_astro.json (same "author by hand" workflow as filelist_eclipse.json's own timeUtc
// strings - no live EXIF parsing in the browser).
function _nightSkyParseRaHours(str) {
  const m = /(-?\d+)h\s*(\d+)m\s*([\d.]+)s/.exec(str || '');
  if (!m) return 0;
  return parseFloat(m[1]) + parseFloat(m[2]) / 60 + parseFloat(m[3]) / 3600;
}
function _nightSkyParseDecDeg(str) {
  const m = /([+-]?)(\d+)°\s*(\d+)'\s*([\d.]+)"/.exec(str || '');
  if (!m) return 0;
  const mag = parseFloat(m[2]) + parseFloat(m[3]) / 60 + parseFloat(m[4]) / 3600;
  return m[1] === '-' ? -mag : mag;
}

let _nightSkyAstroCatalog = [];   // filelist_astro.json, fetched once at module load
let _nightSkyCatalogTypeFilter = 'all';   // 'all' | 'landscape' | 'solar_system' | 'deep_sky'
async function _nightSkyLoadAstroCatalog() {
  try {
    const res = await fetch('filelist_astro.json');
    _nightSkyAstroCatalog = await res.json();
  } catch (e) { console.warn('Night Sky: failed to load astro catalog', e); }
  if (nightSkyActive && nightSkyTopView === 'catalog') _nightSkyRenderCatalogGrid();
}
_nightSkyLoadAstroCatalog();

function _nightSkyRenderCatalogGrid() {
  const grid = document.getElementById('nightSkyCatalogGrid');
  if (!grid) return;
  // Newest first (top-left), same reasoning as Eclipse's own catalog sort (registration/array
  // order doesn't imply chronological order) - date_utc is "YYYY-MM-DD", so a plain string compare
  // already sorts chronologically.
  const entries = (_nightSkyAstroCatalog || []).slice()
    .sort((a, b) => (b.date_utc || '').localeCompare(a.date_utc || ''));
  grid.innerHTML = '';
  for (const entry of entries) {
    if (_nightSkyCatalogTypeFilter !== 'all' && entry.category !== _nightSkyCatalogTypeFilter) continue;

    const tile = document.createElement('div');
    tile.className = 'catalog-tile clickable';
    tile.title = 'Open ' + (entry.object_name || entry.id);

    const thumb = document.createElement('img');
    thumb.className = 'catalog-tile-thumb';
    thumb.src = entry.thumbnail;
    thumb.alt = entry.object_name || entry.id;
    tile.appendChild(thumb);

    const dateLbl = document.createElement('div');
    dateLbl.className = 'catalog-tile-date';
    dateLbl.textContent = entry.date_utc || '';
    tile.appendChild(dateLbl);

    const captionLbl = document.createElement('div');
    captionLbl.className = 'catalog-tile-caption';
    captionLbl.textContent = entry.object_name || entry.id;
    tile.appendChild(captionLbl);

    tile.addEventListener('click', () => {
      _nightSkyApplyCatalogTile(entry);
      _nightSkyTopIndex = 1;
      _nightSkyTopWheel.render();
      enterNightSkyVisualization();
    });
    grid.appendChild(tile);
  }
}
document.getElementById('nightSkyCatalogTypeFilter').addEventListener('click', (e) => {
  const filterEl = document.getElementById('nightSkyCatalogTypeFilter');
  const btn = e.target.closest('.ns-btn');
  if (!btn || !filterEl.contains(btn)) return;
  _nightSkyCatalogTypeFilter = btn.dataset.type;
  filterEl.querySelectorAll('.ns-btn').forEach((b) => b.classList.toggle('active', b === btn));
  _nightSkyRenderCatalogGrid();
});

// Applies one catalog tile's date/time/location (mirrors _nightSkySetNow()'s own shape - state
// assignment + applyLat/Long/TimeZone + _nightSkySyncControls, just sourced from the tile instead
// of Date.now()), stores its frame definition for _nightSkyDrawCatalogFrame, and centers the
// Planetarium camera on the frame's own target Az/El - the only "center camera on Az/El" logic
// anywhere in this file (the existing camera is otherwise only ever moved by the drag handler).
// Chooses a zoom (up to the 2x max, see setNightSkyPlanetZoom's own clamp) that frames the photo's
// own boundary with a comfortable reserve, rather than leaving zoom at whatever it was before this
// tile was picked - the user's own spec: "přiblížení bude až 2x, pokud se hranice obrazu vejdou do
// záběru i s rezervou" (zoom in up to 2x, as long as the frame's own boundary still fits in view
// with margin to spare). The equidistant fisheye's screen radius from the view direction is
// exactly proportional to zoom * (angle from that direction) - see _nightSkyPlanetProjectRaw's own
// r = FOCAL*theta identity - so the zoom that lands the frame's farthest corner at a given fraction
// of layout.scale (empirically, the shorter canvas dimension's half-width, reached at theta~54° at
// the default zoom=1x/FOCAL=1.15 calibration) can be solved directly, no trial-and-error/binary
// search needed - and layout.scale itself cancels out of the formula entirely, so this doesn't
// even need to know the canvas's current on-screen size.
const NIGHTSKY_FRAME_ZOOM_MARGIN = 0.85;   // corners land 85% of the way to the visible edge - reserve, not flush against it
function _nightSkyFitZoomForFrame(fovWDeg, fovHDeg) {
  const D2R = Math.PI / 180;
  const halfW = Math.tan(fovWDeg / 2 * D2R), halfH = Math.tan(fovHDeg / 2 * D2R);
  // Corner-to-centre angle - all 4 corners are equidistant from centre by construction (see
  // _nightSkyFrameCorners/the gnomonic tangent-plane build), so any one of them gives thetaMax.
  const thetaMax = Math.atan(Math.hypot(halfW, halfH));
  return NIGHTSKY_FRAME_ZOOM_MARGIN / (_NIGHTSKY_PLANET_BASE_FOCAL * thetaMax);   // setNightSkyPlanetZoom clamps to [0.5, 2] itself
}
let _nightSkyActiveFrame = null;   // {raDeg, decDeg, fovWDeg, fovHDeg, rotationDeg, thumbnail, full} | null
function _nightSkyApplyCatalogTile(entry) {
  const [y, mo, d] = (entry.date_utc || '1970-01-01').split('-').map(Number);
  const [hh, mm, ss] = (entry.time_utc || '00:00:00').split(':').map(Number);
  nightSkyYear = y; nightSkyMonth = mo; nightSkyDay = d;
  nightSkyHourUT = hh + mm / 60 + (ss || 0) / 3600;

  // Hemisphere flags are separate globals from LAT/LONG's own magnitude (core.js) - set directly,
  // same as the N/S/E/W button handlers (js/controls.js), which also sync these button classes.
  hemisphere = entry.lat_hemisphere === 'S' ? -1 : 1;
  document.getElementById('btnN').className = hemisphere >= 0 ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnS').className = hemisphere < 0 ? 'ns-btn active-s' : 'ns-btn';
  lonHemisphere = entry.lon_hemisphere === 'W' ? -1 : 1;
  document.getElementById('btnE').className = lonHemisphere >= 0 ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnW').className = lonHemisphere < 0 ? 'ns-btn active-s' : 'ns-btn';
  applyLat(entry.lat);
  applyLong(entry.lon);
  applyTimeZone(entry.timezone);

  const raDeg = _nightSkyParseRaHours(entry.ra) * 15;
  const decDeg = _nightSkyParseDecDeg(entry.dec);
  _nightSkyActiveFrame = {
    raDeg, decDeg,
    fovWDeg: entry.fov_w_deg, fovHDeg: entry.fov_h_deg, rotationDeg: entry.rotation_deg || 0,
    thumbnail: entry.thumbnail, full: entry.full,
  };

  nightSkySubmode = 'planetarium'; _nightSkySubmodeIndex = 1;
  _nightSkySubmodeWheel.render();
  _nightSkyUpdatePlanetControlsVisibility();
  _nightSkyUpdatePresentationLock();

  const target = _skyStarAzEl(raDeg, decDeg, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  _nightSkyPlanet3D.camAz = target.az * Math.PI / 180;
  _nightSkyPlanet3D.camEl = Math.max(0, Math.min(Math.PI / 2 - 0.02, target.el * Math.PI / 180));   // same clamp as the drag handler below
  setNightSkyPlanetZoom(_nightSkyFitZoomForFrame(entry.fov_w_deg, entry.fov_h_deg));
  _nightSkyUpdatePlanetCamera();

  _nightSkySyncControls();
}

// Canvas backing-store setup - was CLAIMED to mirror resizeSkyDome()/resizeEclipse() but actually
// diverged from them in two ways that matter on iPad specifically: it never set the canvas's own
// CSS box size (cv.style.width/height), relying entirely on the #nightSkyCanvas CSS rule
// (position:absolute; inset:0) to happen to compute the SAME size as the clientWidth/clientHeight
// read here - normally true, but iPadOS Safari is known to briefly report a stale/wrong
// clientWidth right after a display:none -> block flip (enterNightSky() does exactly that just
// before calling this), and a backing store sized from that stale reading then gets non-uniformly
// STRETCHED by the browser to fill the canvas's real (correct, CSS-driven) on-screen box - exactly
// the reported symptom (content shifted right, Sky Map's centre pulled down: a smaller-than-actual
// backing store stretched to a bigger box, non-uniformly since width/height are rarely off by the
// same ratio). It also recomputed window.devicePixelRatio independently at draw/hover time instead
// of reusing the exact scale factor the backing store was actually built at, a second, smaller
// desync risk. Both fixed by copying resizeSkyDome()/resizeEclipse()'s own pattern exactly: measure
// #canvasContainer (not cv.parentElement - the same element in practice, but named explicitly to
// match the reference implementation with nothing left implicit), force the CSS box to that exact
// same measurement instead of trusting inset:0 to agree with it independently, and stash the actual
// scale factor used (cv._res) so drawNightSky()/the cursor-readout handler read that back instead
// of re-deriving devicePixelRatio themselves.
function resizeNightSky() {
  const container = document.getElementById('canvasContainer');
  const cv = document.getElementById('nightSkyCanvas');
  if (!cv) return;
  const RES = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  const cw = container.clientWidth || 600, ch = container.clientHeight || cw;
  cv._res = RES;
  cv.width = Math.round(cw * RES);
  cv.height = Math.round(ch * RES);
  cv.style.width = cw + 'px';
  cv.style.height = ch + 'px';
  if (nightSkyActive) drawNightSky();
}
window.addEventListener('resize', () => { if (nightSkyActive) resizeNightSky(); });

// ─── Phase 5: date/time state (feeds the Calibration "Date" block + the bottom-left time box) ──
// Night Sky's OWN year/month/day/hourUT - deliberately separate from customYear/customMonth/
// customDay (controls.js) used everywhere else in the app, since only Night Sky needs a real
// calendar year (see this file's own header comment on why). Defaults to the real current UTC
// date/time on load, same "start from Now" convenience as the app's other "Now"-flavoured entry
// points, rather than an arbitrary fixed date.
const _nightSkyNow = new Date();
let nightSkyYear = _nightSkyNow.getUTCFullYear();
let nightSkyMonth = _nightSkyNow.getUTCMonth() + 1;   // 1-based
let nightSkyDay = _nightSkyNow.getUTCDate();
let nightSkyHourUT = _nightSkyNow.getUTCHours() + _nightSkyNow.getUTCMinutes() / 60;
// Whenever the calendar defaults to "now" (this module-load init, and SET NOW below), the shared
// Time zone field (timeZoneHours, controls.js - defaults to a hardcoded +1 otherwise) should default
// to the SYSTEM's own current UTC offset too, not stay on that hardcoded value regardless of where
// the browser actually is. getTimezoneOffset() returns MINUTES to ADD to local time to reach UTC
// (so it's the OPPOSITE sign of the UTC offset itself) - e.g. a browser in UTC+2 (CEST) reports
// -120, so the offset itself is -(-120)/60 = +2. Takes the same Date instance the caller already
// built the rest of "now" from, rather than a fresh one, so every field describes the exact same
// instant.
function _nightSkySystemTzHours(date) {
  return -date.getTimezoneOffset() / 60;
}
applyTimeZone(_nightSkySystemTzHours(_nightSkyNow));

function _nightSkyDaysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}
function _nightSkyStepMonth(dir) {
  nightSkyMonth = dir > 0 ? (nightSkyMonth < 12 ? nightSkyMonth + 1 : 1) : (nightSkyMonth > 1 ? nightSkyMonth - 1 : 12);
  nightSkyDay = Math.min(nightSkyDay, _nightSkyDaysInMonth(nightSkyYear, nightSkyMonth));
}
function _nightSkyStepDay(dir) {
  if (dir > 0) {
    if (nightSkyDay < _nightSkyDaysInMonth(nightSkyYear, nightSkyMonth)) nightSkyDay++;
    else { nightSkyMonth = nightSkyMonth < 12 ? nightSkyMonth + 1 : 1; nightSkyDay = 1; }
  } else {
    if (nightSkyDay > 1) nightSkyDay--;
    else { nightSkyMonth = nightSkyMonth > 1 ? nightSkyMonth - 1 : 12; nightSkyDay = _nightSkyDaysInMonth(nightSkyYear, nightSkyMonth); }
  }
}
// Day value `off` steps away from the current date, without mutating state - same shape as
// controls.js's own customDayAt(), just leap-year-aware via _nightSkyDaysInMonth(nightSkyYear, m).
function _nightSkyDayAt(off) {
  let m = nightSkyMonth, d = nightSkyDay;
  while (off > 0) { if (d < _nightSkyDaysInMonth(nightSkyYear, m)) d++; else { m = m < 12 ? m + 1 : 1; d = 1; } off--; }
  while (off < 0) { if (d > 1) d--; else { m = m > 1 ? m - 1 : 12; d = _nightSkyDaysInMonth(nightSkyYear, m); } off++; }
  return d;
}
function _nightSkyRenderDateWheels() {
  if (typeof _nightSkyMonthWheel !== 'undefined' && _nightSkyMonthWheel) _nightSkyMonthWheel.render();
  if (typeof _nightSkyDayWheel !== 'undefined' && _nightSkyDayWheel) _nightSkyDayWheel.render();
}
// Single chokepoint for "state changed, refresh everything that shows it" - the Calibration date
// wheels/year input, the time strip's label/gradient, and the canvas itself. Called from every
// place nightSkyYear/Month/Day/HourUT changes: the date wheels/year field, dragging or
// mouse-wheeling the time strip, and the Play animation loop.
function _nightSkySyncControls() {
  document.getElementById('inpNightSkyYear').value = nightSkyYear;
  _nightSkyRenderDateWheels();
  _nightSkyUpdateTimeLabel();
  _nightSkyUpdateReadout();
  _nightSkyBuildTimeStripFill();
  _nightSkyBuildTwilightBand();
  _nightSkyBuildTimeScale();
  if (nightSkyActive) drawNightSky();
}
function _nightSkyCommitDate() {
  _nightSkySyncControls();
}
function _nightSkyApplyYear(val) {
  nightSkyYear = Math.max(1, Math.min(9999, Math.round(val) || nightSkyYear));
  // Clamp Feb 29 -> Feb 28 when moving off a leap year, same reasoning as stepCustomMonth's own
  // month-length clamp in controls.js.
  nightSkyDay = Math.min(nightSkyDay, _nightSkyDaysInMonth(nightSkyYear, nightSkyMonth));
  _nightSkySyncControls();
}

const _nightSkyMonthWheel = makeWheelPicker(document.getElementById('wheelNightSkyMonth'), {
  labelAt: (off) => MONTHS[((nightSkyMonth - 1 + off) % 12 + 12) % 12],
  step: _nightSkyStepMonth,
  itemW: 38,
  onCommit: _nightSkyCommitDate,
});
const _nightSkyDayWheel = makeWheelPicker(document.getElementById('wheelNightSkyDay'), {
  labelAt: _nightSkyDayAt,
  step: _nightSkyStepDay,
  itemW: 38,
  onCommit: _nightSkyCommitDate,
});
window.addEventListener('resize', _nightSkyRenderDateWheels);

document.getElementById('btnNightSkyMonDec').addEventListener('click', () => { _nightSkyStepMonth(-1); _nightSkyCommitDate(); });
document.getElementById('btnNightSkyMonInc').addEventListener('click', () => { _nightSkyStepMonth(1); _nightSkyCommitDate(); });
document.getElementById('btnNightSkyDayDec').addEventListener('click', () => { _nightSkyStepDay(-1); _nightSkyCommitDate(); });
document.getElementById('btnNightSkyDayInc').addEventListener('click', () => { _nightSkyStepDay(1); _nightSkyCommitDate(); });

document.getElementById('inpNightSkyYear').addEventListener('change', (e) => _nightSkyApplyYear(parseFloat(e.target.value)));
document.getElementById('inpNightSkyYear').addEventListener('blur', (e) => _nightSkyApplyYear(parseFloat(e.target.value)));
document.getElementById('inpNightSkyYear').addEventListener('keydown', (e) => { if (e.key === 'Enter') _nightSkyApplyYear(parseFloat(e.target.value)); });
document.getElementById('btnNightSkyYearDec').addEventListener('click', () => _nightSkyApplyYear(nightSkyYear - 1));
document.getElementById('btnNightSkyYearInc').addEventListener('click', () => _nightSkyApplyYear(nightSkyYear + 1));

// SET NOW - resets to the real current moment, i.e. re-runs the exact same computation the
// nightSkyYear/Month/Day/HourUT module-level init already does on page load (that init IS "now" at
// the time this file first ran) - so this button just reproduces the default state on demand. Also
// resets the Time zone field to the system's own current offset (_nightSkySystemTzHours, same
// reasoning as the module-load init above) - a real "now" isn't just today's date, the whole point
// is landing back on the browser's own actual current date/time/zone together.
function _nightSkySetNow() {
  const now = new Date();
  nightSkyYear = now.getUTCFullYear();
  nightSkyMonth = now.getUTCMonth() + 1;
  nightSkyDay = now.getUTCDate();
  nightSkyHourUT = now.getUTCHours() + now.getUTCMinutes() / 60;
  applyTimeZone(_nightSkySystemTzHours(now));
  _nightSkySyncControls();
}
document.getElementById('btnNightSkySetToday').addEventListener('click', _nightSkySetNow);

// Local civil hour (0..24) for a UT hour, using the app's own shared Time zone offset
// (timeZoneHours, core.js/controls.js) - the ONE place Night Sky's own state connects to it. Only
// ever used for DISPLAY (this label + the hour scale below) - the actual astronomy (Phase 1-2) stays
// strictly UT-based throughout, untouched.
function _nightSkyLocalHour(hourUT) {
  const tz = typeof timeZoneHours !== 'undefined' ? timeZoneHours : 0;
  return ((hourUT + tz) % 24 + 24) % 24;
}
// Integer local hour for tick labels - a plain Math.round(_nightSkyLocalHour(...)) can land on 24
// instead of wrapping to 0 (a value like 23.9997, from floating-point residue in the tick's own
// exact-hour-boundary math, rounds UP to 24 before the final %24 ever gets a chance to fire) - shows
// up as ticks reading "...,22,23,24,1,2,..." instead of "...,22,23,0,1,2,...". The extra %24 here
// catches that one case cheaply, applied after rounding rather than before (rounding an already-
// wrapped-to-0 value would be safe too, but this is the one spot that actually needs it).
function _nightSkyLocalHourRounded(hourUT) {
  return Math.round(_nightSkyLocalHour(hourUT)) % 24;
}
// Shared JD phase shift so "every local hour boundary" (including local midnight) can be found with
// one formula: local hour is 0 exactly when hourUT == -tz (mod 24); from _skyToJulianDateUT, that
// lands at JD mod 1 == (0.5 - tz/24) mod 1 (tz=0 gives back the plain UTC-midnight 0.5). Shared by
// _nightSkyBuildTimeStripFill()'s day-end + hour ticks and _nightSkyBuildTimeScale() - the whole
// strip is local-time-anchored, not just the day-end milestone.
function _nightSkyTzPhaseDays() {
  const tz = typeof timeZoneHours !== 'undefined' ? timeZoneHours : 0;
  return 0.5 - tz / 24;
}
// Rounds the WHOLE fractional-hour value to the nearest minute as one quantity, THEN splits into
// hh/mm - not hour and minute rounded separately, which is what the previous version did
// (`Math.floor(h)` for hh, `Math.round(fractional part * 60) % 60` for mm) and which had a real,
// user-reported bug: near the top of an hour (e.g. h=12.9917, 12:59:30) the fractional part rounds
// UP to 60 minutes, and `% 60` wraps that back to 0 WITHOUT carrying the extra hour - showing
// "12:00" for a few seconds before the underlying value actually reaches 13.0 and the label
// correctly flips to "13:00". Rounding the total minute count first (780, not 779.5) and deriving
// hh/mm from THAT avoids the carry entirely - there's only one rounding step, so there's nothing
// left to desync. The extra double-mod also keeps a negative or >=24h input wrapping correctly,
// though callers shouldn't normally pass one.
function _nightSkyFmtHM(h) {
  const totalMin = ((Math.round(h * 60) % 1440) + 1440) % 1440;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
// The date/time this label used to carry now lives on the shared top info bar instead
// (_nightSkyUpdateReadout below, same "driven by the currently selected instant" pattern as
// Eclipse's own _eclipseUpdateReadout) - this label is "lightened" to just the current twilight
// phase name instead, per the user's own request. Reuses the exact same classification the
// discrete twilight band already computes (NIGHTSKY_TWILIGHT_THRESHOLDS/_nightSkyTwilightBandIndex,
// defined further down with the band itself) rather than re-deriving separate thresholds, so the
// label and the band it sits above always agree.
const NIGHTSKY_TWILIGHT_NAMES = ['Daylight', 'Civil twilight', 'Nautical twilight', 'Astronomical twilight', 'Night'];
function _nightSkyUpdateTimeLabel() {
  const el = document.getElementById('lblNightSkyHour');
  if (!el) return;
  const alt = _nightSkySunAlt(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  el.textContent = NIGHTSKY_TWILIGHT_NAMES[_nightSkyTwilightBandIndex(alt)];
}
// Shared top info bar (Az/Alt/Dir from the cursor listener further down this file; Day/Time here) -
// same "driven by the currently selected instant, not the cursor" pattern as Eclipse's own
// _eclipseUpdateReadout (render-eclipse.js), called from _nightSkySyncControls() below on every
// date/time change (drag, wheel pickers, SET NOW, animation, ...) rather than a dedicated new
// trigger. Local time (what the user's own clock would show), not UTC - Night Sky's whole time
// strip/scale already reads local-first (_nightSkyLocalHour), and the compact top bar has no room
// left over to show both.
function _nightSkyUpdateReadout() {
  const valDay = document.getElementById('valDay'), valTime = document.getElementById('valTime');
  if (!valDay || !valTime) return;
  // Local DATE, not just local hour - a local offset can push the displayed time across a UTC day
  // boundary (user's own report: "pokud se čas v UTC a místním čase láme přes půlnoc, je potřeba
  // korigovat i to datum"). _nightSkyLocalHour's plain %24 wrap alone paired with the raw UTC
  // nightSkyMonth/Day/Year was correct only when the local offset didn't actually cross midnight -
  // e.g. 23:30 UTC at +2:00 correctly reads "01:30 local" but on the WRONG (previous) calendar day
  // if nightSkyDay is shown as-is. Fixed the same way _nightSkyBuildTimeScale() already handles
  // this exact case (its own comment: "a drag that crosses midnight rolls the date automatically")
  // - apply the tz offset in Julian-Date space, where calendar rollover (including month/year
  // boundaries and leap years) is handled once, correctly, by _skyFromJulianDateUT itself, not
  // re-derived here.
  const tz = typeof timeZoneHours !== 'undefined' ? timeZoneHours : 0;
  const jd = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const local = _skyFromJulianDateUT(jd + tz / 24);
  valDay.textContent = MONTHS[local.month - 1] + ' ' + local.day + ', ' + local.year;
  valTime.textContent = _nightSkyFmtHM(local.hourUT) + ' local';
}

// ─── Time strip: infinite drag-the-belt scrubber ────────────────────────────────────────────────
// Deliberately NOT an <input type=range> - the user asked for the BELT to move under a fixed
// centre marker (same interaction idiom as the month/day wheel-pickers above, just continuous
// instead of discrete-item snapping), not a thumb dragged along a fixed track. Dragging is done
// entirely in Julian-Date space (a single continuous number, via _skyToJulianDateUT/
// _skyFromJulianDateUT above) so crossing a UTC midnight rolls the calendar date over for free,
// with no separate day-boundary special-casing in the drag math itself.
const NIGHTSKY_STRIP_HOURS_SPAN = 6;   // total visible window width, in hours (centre ± 3h)
// Sun altitude for the time strip (gradient, discrete twilight band, phase label). Same model as the
// Sun disc itself (_nightSkySunAzEl, including the equation of time), so the strip never disagrees
// with the disc drawn on the sky: near the horizon the equation of time alone (up to ~16 min) shifts
// the altitude by up to ~2 deg, enough to put a Sun still visibly above the horizon into
// "Civil twilight".
function _nightSkySunAlt(year, month, day, hourUT) {
  return _nightSkySunAzEl(year, month, day, hourUT).el;
}
// Day (Sun above horizon) -> dusk -> night. The dusk band originally spanned the FULL
// astronomical twilight range (civil+nautical+astronomical lumped together, DUSK peak at the -9°
// midpoint, NIGHT reached at -18°) - astronomically complete, but at this project's default
// latitude that's a ~1.5-2h span, and the colour change in the first several degrees past 0° is
// subtle enough (rgb(58,123,213) -> a barely-different rgb(50,102,181) by -2°) that the moment the
// strip visibly LOOKS like it's darkening lagged the Sun's own real sunset (the disc added two
// rounds ago, _nightSkySunAzEl) by close to an hour - confirmed precisely: at the default
// location/date, alt reaches the old -9° DUSK peak 55 minutes after the disc actually sets, and
// symmetrically 56 minutes BEFORE it rises the next morning. Narrowed to civil twilight (0° to
// -6°, DUSK peak at -3°; NIGHT now reached at -12° instead of -18°) per the user's own choice, so
// the visibly-darkening moment lands close to the Sun's own actual rise/set instead of nautical
// twilight's midpoint - civil twilight is also the range most associated with a visibly
// "darkening sky" to the naked eye in the first place, not an arbitrary narrower cut.
const NIGHTSKY_COLOR_DAY   = [58, 123, 213];   // #3a7bd5
const NIGHTSKY_COLOR_DUSK  = [20, 30, 70];     // #141e46
const NIGHTSKY_COLOR_NIGHT = [0, 21, 56];      // #001538, matches the sky circle's own fill in
                                                // _nightSkyDrawSkyMap() - was the canvas's outer
                                                // background (#05070d) instead, per the user's own
                                                // request to match the actual sky colour, not the
                                                // canvas margin around it
const NIGHTSKY_DUSK_ALT  = -6;    // DUSK peak (civil twilight's own boundary)
const NIGHTSKY_NIGHT_ALT = -12;   // NIGHT reached
function _nightSkyColorAt(alt) {
  const lerp = (a, b, f) => Math.round(a + (b - a) * f);
  let c0, c1, f;
  if (alt >= 0) return `rgb(${NIGHTSKY_COLOR_DAY.join(',')})`;
  if (alt <= NIGHTSKY_NIGHT_ALT) return `rgb(${NIGHTSKY_COLOR_NIGHT.join(',')})`;
  if (alt >= NIGHTSKY_DUSK_ALT) {
    c0 = NIGHTSKY_COLOR_DAY; c1 = NIGHTSKY_COLOR_DUSK;
    f = alt / NIGHTSKY_DUSK_ALT;
  } else {
    c0 = NIGHTSKY_COLOR_DUSK; c1 = NIGHTSKY_COLOR_NIGHT;
    f = (NIGHTSKY_DUSK_ALT - alt) / (NIGHTSKY_DUSK_ALT - NIGHTSKY_NIGHT_ALT);
  }
  return `rgb(${lerp(c0[0], c1[0], f)},${lerp(c0[1], c1[1], f)},${lerp(c0[2], c1[2], f)})`;
}
// Rebuilds #nightSkyTimeStrip's background: a smooth day/dusk/night gradient across the currently
// visible window (centred on the current nightSkyYear/Month/Day/HourUT) plus thin white tick marks
// at every UTC midnight the window spans ("day-end" marks, same multi-layer-gradient compositing
// technique as Eclipse's --eclipse-fill/_eclipseBuildSliderFill). UTC-midnight instants land at
// exactly JD mod 1 == 0.5 (see _skyToJulianDateUT: at hourUT=0 the fractional part is always
// exactly -0.5 before the +b term, which is itself a whole number).
function _nightSkyBuildTimeStripFill() {
  const strip = document.getElementById('nightSkyTimeStrip');
  if (!strip) return;
  const jdCenter = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const halfSpanDays = (NIGHTSKY_STRIP_HOURS_SPAN / 2) / 24;
  const jdMin = jdCenter - halfSpanDays, jdMax = jdCenter + halfSpanDays;
  const span = jdMax - jdMin;
  const N = 60, stops = [];
  for (let i = 0; i <= N; i++) {
    const jd = jdMin + span * i / N;
    const r = _skyFromJulianDateUT(jd);
    const alt = _nightSkySunAlt(r.year, r.month, r.day, r.hourUT);
    stops.push(_nightSkyColorAt(alt) + ' ' + (i / N * 100).toFixed(2) + '%');
  }
  const colorGrad = 'linear-gradient(to right, ' + stops.join(',') + ')';
  // Every tick on this strip (day-end marks, hour ticks) and the hour scale below it are all
  // anchored to LOCAL time, not UTC - the whole strip "loads" local time, not just the day-end
  // milestone. Local hour is 0 when hourUT == -tz (mod 24), which lands at JD mod 1 == (0.5 - tz/24)
  // mod 1 instead of the UTC-only case's plain 0.5 - _nightSkyTzPhaseDays() is that one shared
  // phase shift (tz=0 reduces every formula below to its original UTC-only form exactly). Using a
  // fractional tz (e.g. a real-world :30/:45-offset zone) still lands exactly on true local hour
  // boundaries, not just whole UTC ones re-labelled.
  const phase = _nightSkyTzPhaseDays();
  const marks = [];
  for (let n = Math.floor(jdMin - phase); n <= Math.ceil(jdMax - phase); n++) {
    const t = n + phase;
    if (t >= jdMin && t <= jdMax) marks.push(t);
  }
  let markGrad = '';
  if (marks.length) {
    const segs = marks.map((t) => {
      const p = ((t - jdMin) / span * 100).toFixed(2);
      return `transparent calc(${p}% - 1px), rgba(255,255,255,0.75) calc(${p}% - 1px), rgba(255,255,255,0.75) calc(${p}% + 1px), transparent calc(${p}% + 1px)`;
    });
    markGrad = 'linear-gradient(90deg, ' + segs.join(', ') + '), ';
  }
  // The hour-scale's own ruler ticks (_nightSkyBuildTimeScale, below) extended UP onto the strip
  // itself, per the user's own request - every LOCAL hour boundary the window spans, dim (matching
  // the scale's minor ticks) except hours that are multiples of 6 (0/6/12/18), a bit brighter
  // (matching the scale's own major ticks). Local midnight is ALSO one of these hour boundaries, but
  // stays visually dominated by markGrad above (drawn on top, since CSS background layers stack
  // with the first-listed on top) - the two never fight over which one "wins".
  const hourStartN = Math.floor((jdMin - phase) * 24), hourEndN = Math.ceil((jdMax - phase) * 24);
  const hourSegs = [];
  for (let n = hourStartN; n <= hourEndN; n++) {
    const t = n / 24 + phase;
    if (t < jdMin || t > jdMax) continue;
    const r = _skyFromJulianDateUT(t);
    const localH = _nightSkyLocalHourRounded(r.hourUT);
    const major = localH % 6 === 0;
    const alpha = major ? 0.35 : 0.14;
    const p = ((t - jdMin) / span * 100).toFixed(2);
    hourSegs.push(`transparent calc(${p}% - 1px), rgba(255,255,255,${alpha}) calc(${p}% - 1px), rgba(255,255,255,${alpha}) calc(${p}% + 1px), transparent calc(${p}% + 1px)`);
  }
  const hourGrad = hourSegs.length ? 'linear-gradient(90deg, ' + hourSegs.join(', ') + '), ' : '';
  strip.style.background = markGrad + hourGrad + colorGrad;
}

// ─── Discrete twilight-phase band ───────────────────────────────────────────────────────────────
// A thin, HARD-edged band along the strip's own bottom edge - day (yellow, reusing the Sun disc's
// own #e8a020) / civil / nautical / astronomical twilight / night, using the exact same thresholds
// and colours as the Sun Graph's own annual chart (_SG_THRESH/_SG_BANDS, render-sungraph.js), not
// approximated or re-picked here. Complements rather than replaces the strip's own smooth 3-stage
// day/dusk/night gradient above it (twenty-second round's own civil-twilight narrowing) - that one
// reads well at a glance but doesn't commit to exact phase boundaries; this band does, in the same
// vocabulary the rest of the app already uses for "which kind of twilight is this".
const NIGHTSKY_TWILIGHT_THRESHOLDS = [0, -6, -12, -18];   // day | civil | nautical | astronomical | night
const NIGHTSKY_TWILIGHT_COLORS = ['#e8a020', '#9cbdd2', '#5a7588', '#39505f', '#1c2a35'];
function _nightSkyTwilightBandIndex(alt) {
  for (let i = 0; i < NIGHTSKY_TWILIGHT_THRESHOLDS.length; i++) {
    if (alt >= NIGHTSKY_TWILIGHT_THRESHOLDS[i]) return i;
  }
  return NIGHTSKY_TWILIGHT_THRESHOLDS.length;
}
// Bisects for the exact JD where the Sun altitude (_nightSkySunAlt) crosses a given threshold
// between two already-sampled points straddling it - same idea as _nightSkyBisectHorizon
// (Planetarium's own horizon-crossing interpolation) but against an arbitrary threshold instead of
// a fixed 0.
function _nightSkyAltCrossingJD(jd0, jd1, alt0, alt1, threshold) {
  let lo = jd0, hi = jd1, aLo = alt0, aHi = alt1;
  for (let i = 0; i < 24; i++) {
    const mid = lo + (hi - lo) * ((aLo - threshold) / (aLo - aHi));
    const r = _skyFromJulianDateUT(mid);
    const a = _nightSkySunAlt(r.year, r.month, r.day, r.hourUT);
    if (Math.abs(a - threshold) < 0.001) return mid;
    if ((a >= threshold) === (aLo >= threshold)) { lo = mid; aLo = a; } else { hi = mid; aHi = a; }
  }
  return lo + (hi - lo) * ((aLo - threshold) / (aLo - aHi));
}
function _nightSkyBuildTwilightBand() {
  const band = document.getElementById('nightSkyTwilightBand');
  if (!band) return;
  const jdCenter = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const halfSpanDays = (NIGHTSKY_STRIP_HOURS_SPAN / 2) / 24;
  const jdMin = jdCenter - halfSpanDays, jdMax = jdCenter + halfSpanDays;
  const span = jdMax - jdMin;
  const altAt = (jd) => {
    const r = _skyFromJulianDateUT(jd);
    return _nightSkySunAlt(r.year, r.month, r.day, r.hourUT);
  };

  // Coarse sweep (~3-min steps - fine enough to catch every crossing in a 6h window) to find every
  // band change, each then refined to its EXACT crossing JD via bisection, so edges land precisely
  // on the real threshold instead of being smeared across a coarse sample step.
  const COARSE_N = 120;
  let prevJd = jdMin, prevAlt = altAt(jdMin), prevIdx = _nightSkyTwilightBandIndex(prevAlt);
  const startIdx = prevIdx;
  const edges = [];   // {jd, idx}: idx is the band starting AT this jd
  for (let i = 1; i <= COARSE_N; i++) {
    const jd = jdMin + span * i / COARSE_N;
    const alt = altAt(jd);
    const idx = _nightSkyTwilightBandIndex(alt);
    if (idx !== prevIdx) {
      const step = idx > prevIdx ? 1 : -1;
      let curIdx = prevIdx, curJd = prevJd, curAlt = prevAlt;
      while (curIdx !== idx) {
        const nextIdx = curIdx + step;
        const threshold = NIGHTSKY_TWILIGHT_THRESHOLDS[step > 0 ? curIdx : curIdx - 1];
        const cjd = _nightSkyAltCrossingJD(curJd, jd, curAlt, alt, threshold);
        edges.push({ jd: cjd, idx: nextIdx });
        curIdx = nextIdx; curJd = cjd; curAlt = threshold;
      }
    }
    prevJd = jd; prevAlt = alt; prevIdx = idx;
  }

  const stops = [];
  let curColor = NIGHTSKY_TWILIGHT_COLORS[startIdx];
  stops.push(`${curColor} 0%`);
  for (const e of edges) {
    const p = ((e.jd - jdMin) / span * 100).toFixed(3);
    stops.push(`${curColor} ${p}%`);
    curColor = NIGHTSKY_TWILIGHT_COLORS[e.idx];
    stops.push(`${curColor} ${p}%`);
  }
  stops.push(`${curColor} 100%`);
  band.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
}

// Hour scale under the strip - a ruler: one tick line + its own local-time number per LOCAL hour
// boundary the visible window spans (_nightSkyLocalHour/_nightSkyTzPhaseDays - the Time-zone link -
// both the printed numbers AND their screen positions are local-time-anchored now, not just the
// labels over a UTC grid). Local hours that are multiples of 6 (0/6/12/18) get a taller/brighter
// tick + bold number, per the user's own request. Position math mirrors the day-boundary tick marks
// in _nightSkyBuildTimeStripFill just above - same "t = n/24 + phase lands on an exact local hour"
// identity, just for every hour (n) instead of only local midnight (n multiple of 24).
function _nightSkyBuildTimeScale() {
  const scaleEl = document.getElementById('nightSkyTimeScale');
  if (!scaleEl) return;
  const jdCenter = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const halfSpanDays = (NIGHTSKY_STRIP_HOURS_SPAN / 2) / 24;
  const jdMin = jdCenter - halfSpanDays, jdMax = jdCenter + halfSpanDays;
  const span = jdMax - jdMin;
  const phase = _nightSkyTzPhaseDays();
  const startN = Math.floor((jdMin - phase) * 24);
  const endN = Math.ceil((jdMax - phase) * 24);
  let html = '';
  for (let n = startN; n <= endN; n++) {
    const t = n / 24 + phase;
    if (t < jdMin || t > jdMax) continue;
    const r = _skyFromJulianDateUT(t);
    const localH = _nightSkyLocalHourRounded(r.hourUT);
    const p = ((t - jdMin) / span * 100).toFixed(2);
    const major = localH % 6 === 0;
    html += `<span class="nightsky-scale-mark${major ? ' major' : ''}" style="left:${p}%">`
      + `<span class="nightsky-scale-tick"></span><span class="nightsky-scale-num">${localH}</span></span>`;
  }
  scaleEl.innerHTML = html;
}

// Drag: pointer delta (px) -> hours, converted through JD-space so a drag that crosses midnight
// rolls the date automatically (same sign convention as makeWheelPicker's own drag - dragging LEFT
// brings LATER times in from the right, i.e. time moves forward).
let _nightSkyDragging = false, _nightSkyDragPid = null, _nightSkyDragX0 = 0, _nightSkyDragStartJD = 0;
const _nightSkyStripEl = document.getElementById('nightSkyTimeStrip');
_nightSkyStripEl.addEventListener('pointerdown', (e) => {
  if (typeof _nightSkyAnimActive !== 'undefined' && _nightSkyAnimActive) _nightSkyStopAnim();
  _nightSkyDragging = true;
  _nightSkyDragPid = e.pointerId;
  _nightSkyDragX0 = e.clientX;
  _nightSkyDragStartJD = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  try { _nightSkyStripEl.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer session (e.g. synthetic event) - drag still works via document-level move/up */ }
  _nightSkyStripEl.classList.add('dragging');
});
_nightSkyStripEl.addEventListener('pointermove', (e) => {
  if (!_nightSkyDragging || e.pointerId !== _nightSkyDragPid) return;
  const dx = e.clientX - _nightSkyDragX0;
  const w = _nightSkyStripEl.clientWidth || 220;
  const hoursPerPx = NIGHTSKY_STRIP_HOURS_SPAN / w;
  const jd = _nightSkyDragStartJD - (dx * hoursPerPx) / 24;
  const r = _skyFromJulianDateUT(jd);
  nightSkyYear = r.year; nightSkyMonth = r.month; nightSkyDay = r.day; nightSkyHourUT = r.hourUT;
  _nightSkySyncControls();
});
const _nightSkyEndDrag = (e) => {
  if (!_nightSkyDragging || e.pointerId !== _nightSkyDragPid) return;
  _nightSkyDragging = false; _nightSkyDragPid = null;
  _nightSkyStripEl.classList.remove('dragging');
};
_nightSkyStripEl.addEventListener('pointerup', _nightSkyEndDrag);
_nightSkyStripEl.addEventListener('pointercancel', _nightSkyEndDrag);
_nightSkyStripEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (typeof _nightSkyAnimActive !== 'undefined' && _nightSkyAnimActive) _nightSkyStopAnim();
  const jd = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)
    + (e.deltaY > 0 ? 1 : -1) * (0.25 / 24);   // 15 min per wheel tick
  const r = _skyFromJulianDateUT(jd);
  nightSkyYear = r.year; nightSkyMonth = r.month; nightSkyDay = r.day; nightSkyHourUT = r.hourUT;
  _nightSkySyncControls();
}, { passive: false });

// ─── Play/animate - same look and speed-tier idiom as Eclipse's #btnEclipsePlay/#eclipseSpeedBox
// (render-eclipse.js), just unbounded (no fixed visible window to loop within - a real sky has no
// "end", unlike one eclipse event's own C1-C4 span) - Play just advances time forward forever at
// the chosen rate until Stop. The speed chip is visible in BOTH static and playing states (unlike
// Eclipse's ORIGINAL behaviour, since fixed alongside this - see _eclipseSetPlayIcon's own updated
// comment), so the rate can be set before the first Play too.
const NIGHTSKY_ANIM_SPEED_TIERS = [1, 10, 60, 300];
let _nightSkyAnimSpeedIdx = NIGHTSKY_ANIM_SPEED_TIERS.length - 1;   // starts on 300x
function _nightSkyAnimRateHps() {
  return NIGHTSKY_ANIM_SPEED_TIERS[_nightSkyAnimSpeedIdx] / 3600;   // hours of sim time per real second
}
function _nightSkyUpdateSpeedBoxLabel() {
  const box = document.getElementById('nightSkySpeedBox');
  if (box) box.textContent = NIGHTSKY_ANIM_SPEED_TIERS[_nightSkyAnimSpeedIdx] + 'x';
}
function _nightSkyCycleAnimSpeed() {
  _nightSkyAnimSpeedIdx = (_nightSkyAnimSpeedIdx + 1) % NIGHTSKY_ANIM_SPEED_TIERS.length;
  if (_nightSkyAnimActive) {
    // Re-anchor the running loop's own start JD/timestamp to the CURRENT instant under the NEW
    // rate, so the visible motion continues from here instead of jumping - same "resume from
    // current position" idea as _eclipseCycleAnimSpeed's own re-basing.
    _nightSkyAnimStartJD = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    _nightSkyAnimStart = null;
  }
  _nightSkyUpdateSpeedBoxLabel();
}
document.getElementById('nightSkySpeedBox').addEventListener('click', (e) => {
  e.stopPropagation();
  _nightSkyCycleAnimSpeed();
});
let _nightSkyAnimActive = false;
let _nightSkyAnimStart = null;      // ms timestamp captured on the first frame after Play
let _nightSkyAnimStartJD = 0;       // JD at the moment Play was pressed (or last re-anchored)
let _nightSkyAnimRAF = null;
function _nightSkySetPlayIcon(playing) {
  const btn = document.getElementById('btnNightSkyPlay');
  if (!btn) return;
  btn.classList.toggle('playing', playing);
  const ic = btn.querySelector('svg');
  if (ic) ic.innerHTML = playing
    ? '<rect x="2" y="2" width="8" height="8" rx="1"/>'
    : '<polygon points="2,1 11,6 2,11"/>';
  _nightSkyUpdateSpeedBoxLabel();
}
function _nightSkyAdvanceAnim(ts) {
  if (_nightSkyAnimStart === null) _nightSkyAnimStart = ts;
  const elapsed = (ts - _nightSkyAnimStart) / 1000;
  const jd = _nightSkyAnimStartJD + (_nightSkyAnimRateHps() * elapsed) / 24;
  const r = _skyFromJulianDateUT(jd);
  nightSkyYear = r.year; nightSkyMonth = r.month; nightSkyDay = r.day; nightSkyHourUT = r.hourUT;
  _nightSkySyncControls();
}
function _nightSkyAnimFrame(ts) {
  if (!_nightSkyAnimActive) { _nightSkyAnimRAF = null; return; }
  _nightSkyAdvanceAnim(ts);
  _nightSkyAnimRAF = requestAnimationFrame(_nightSkyAnimFrame);
}
function _nightSkyStartAnim() {
  if (_nightSkyAnimActive) return;
  _nightSkyAnimActive = true;
  _nightSkyAnimStart = null;
  _nightSkyAnimStartJD = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  _nightSkySetPlayIcon(true);
  if (_nightSkyAnimRAF === null) _nightSkyAnimRAF = requestAnimationFrame(_nightSkyAnimFrame);
}
function _nightSkyStopAnim() {
  _nightSkyAnimActive = false;
  _nightSkySetPlayIcon(false);
  if (_nightSkyAnimRAF !== null) { cancelAnimationFrame(_nightSkyAnimRAF); _nightSkyAnimRAF = null; }
}
document.getElementById('btnNightSkyPlay').addEventListener('click', () => {
  if (_nightSkyAnimActive) _nightSkyStopAnim(); else _nightSkyStartAnim();
});

// Collapsible time box - bottom-left, same collapse idiom as #imgLegendWrap/#sgLegendWrap
// (setImgLegendCollapsed in controls.js), just a local copy since those two are tied to their own
// specific wrap/toggle ids.
let _nightSkyTimeCollapsed = false;
function _nightSkySetTimeCollapsed(c) {
  _nightSkyTimeCollapsed = c;
  const w = document.getElementById('nightSkyTimeWrap'), t = document.getElementById('nightSkyTimeToggle');
  if (w) w.classList.toggle('collapsed', c);
  if (t) t.textContent = c ? '▲' : '▼';
}
document.getElementById('nightSkyTimeToggle').addEventListener('click', (e) => {
  e.stopPropagation();
  _nightSkySetTimeCollapsed(!_nightSkyTimeCollapsed);
});

// ─── Phase 5: rendering ─────────────────────────────────────────────────────────────────────────
// Polar "planisphere" projection - zenith (el=90) at centre, horizon (el=0) at the rim, azimuth as
// the compass angle around it. Deliberately the SAME math as Sky Dome's own Sky Map projection
// (_skyDomePoint, render-skydome.js) - reused directly rather than duplicated, so the two views of
// "looking straight up" agree pixel-for-pixel. Stars/lines below the horizon (el<0) are never
// drawn - a real sky map doesn't show what's below your feet, independent of the Horizon checkbox
// (which only controls the rim/compass overlay, not visibility of content).
function _nightSkyLayout(w, h) {
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 * 0.92;
  return { cx, cy, R };
}

function _nightSkyDrawGrid(ctx, layout) {
  const { cx, cy, R } = layout;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  // Altitude rings every 30° (the outer rim itself already reads as the el=0 ring).
  for (const el of [30, 60]) {
    const r = R * (90 - el) / 90;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
  }
  // Azimuth spokes every 30°.
  for (let az = 0; az < 360; az += 30) {
    const p = _skyDomePoint(cx, cy, R, az, 0);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

// Strokes one polyline given as a list of {az, el} points, TRUE-projected (never skipped/clamped
// for el<0 - "compute the scene beyond the horizon too, just don't display it"), relying on the
// CALLER already having a horizon-circle clip region active so anything outside it is invisible.
//
// The ONE thing this refuses to connect directly: two CONSECUTIVE points that are BOTH below the
// horizon. Reasoning, found via direct instrumentation (not a hypothetical) after the user reported
// a real, visible "line across the whole sky" artifact matching constellation-line colour: near the
// horizon this all works fine (a line from a visible point out to an invisible one, clipped, simply
// gets truncated right at the crossing - exactly the desired behaviour). But deep BELOW the horizon,
// _skyStarAzEl()/sunPosition()'s own azimuth formula divides by cos(elevation) - the SAME kind of
// division-by-near-zero instability already fixed once for LAT===90 (_skyStarAzEl's own comment),
// just triggered here by the POINT's elevation approaching ±90° instead of the observer's latitude.
// Near the NADIR (el→-90, not just the already-handled zenith el→+90) this makes azimuth swing
// wildly between angularly-close catalog points while their projected radius stays large-but-finite
// (up to 2R at el=-90, `_skyDomePoint`'s own r=R·(90-el)/90 formula - never shrinks toward 0 the way
// it does near the zenith, which is exactly why the zenith case never caused this problem but the
// nadir case does). Two points, BOTH sitting outside the visible circle (r>R) at very different
// azimuths, connected by a straight line: the middle of the SAME chord can cut back inside r<=R with
// no relationship to anything real, and the clip lets that spurious middle segment right through as
// if it were legitimate. Confirmed empirically: swept every constellation-line segment at the
// project's own default location - found 19 real segments doing exactly this, ALL of them between
// two points 45-84° below the horizon (Carina/Cetus/Eridanus/Fornax - deep-southern constellations,
// permanently invisible from this mid-northern latitude), not a single one involving a point
// actually near the horizon. A segment with AT LEAST ONE visible (el>=0) endpoint is always safe -
// the clip correctly truncates it at the real horizon crossing regardless of how the invisible end
// is computed.
function _nightSkyStrokePartlyVisibleRun(ctx, layout, azElPoints) {
  let started = false, prevP = null;
  for (const p of azElPoints) {
    const bothInvisible = prevP && prevP.el < 0 && p.el < 0;
    if (bothInvisible && started) { ctx.stroke(); started = false; }
    const pt = _skyDomePoint(layout.cx, layout.cy, layout.R, p.az, p.el);
    if (!started) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y); started = true; }
    else ctx.lineTo(pt.x, pt.y);
    prevP = p;
  }
  if (started) ctx.stroke();
}

// Off by default (see index.html's #chkNightSkyEquatorial) - a genuine second coordinate frame
// (right ascension / declination) drawn through the exact same _skyStarAzEl()/_skyDomePoint()
// pipeline as everything else (stars, constellation lines, the Az/Alt grid), just fed RA/Dec grid
// points instead of catalog objects - so it's pixel-consistent with them for free, not a separate
// projection. Declination circles (parallels) every 30°, right ascension lines (meridians) every
// 2h/30° - distinct reddish tint so it doesn't get confused with the Az/Alt grid (white) or
// constellation lines (blue). Clipped to the horizon circle - same reasoning/technique as
// _nightSkyDrawConstellations' own fix, so these lines also now reach all the way to the rim
// instead of stopping short at the last sampled point still above the horizon.
function _nightSkyDrawEquatorialGrid(ctx, layout) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, layout.R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.strokeStyle = 'rgba(224,120,120,0.45)';
  ctx.lineWidth = 1;
  for (const dec of [-60, -30, 0, 30, 60]) {
    const pts = [];
    for (let ra = 0; ra <= 360; ra += 5) pts.push(_skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
    _nightSkyStrokePartlyVisibleRun(ctx, layout, pts);
  }
  for (let ra = 0; ra < 360; ra += 30) {
    const pts = [];
    for (let dec = -90; dec <= 90; dec += 5) pts.push(_skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
    _nightSkyStrokePartlyVisibleRun(ctx, layout, pts);
  }
  ctx.restore();
}

// Ecliptic - the Sun's own apparent path against the stars over the year (Earth's orbital plane
// projected onto the sky), off by default like the Equatorial grid it sits under. A single great
// circle, NOT a small-circle grid like the declination rings above - parametrized by ecliptic
// longitude lambda (0-360deg) at ecliptic latitude beta=0 (the plane of the ecliptic itself), then
// converted to RA/Dec via the standard obliquity rotation, which at beta=0 simplifies to:
//   dec = asin(sin(epsilon)*sin(lambda))
//   RA  = atan2(cos(epsilon)*sin(lambda), cos(lambda))
// Uses the EXACT SAME obliquity (23.45deg) as core.js's own sunDeclination() - not a separately
// re-tuned "more precise" value - so this curve stays geometrically consistent with the Sun's own
// real position (the twentieth round's Sun feature): with Sun's path also on, the green path should
// visibly trace right along this red line, not a slightly-off parallel curve.
const NIGHTSKY_OBLIQUITY_DEG = 23.45;
function _nightSkyEclipticPoints(stepDeg) {
  const epsRad = NIGHTSKY_OBLIQUITY_DEG * Math.PI / 180;
  const pts = [];
  for (let lambda = 0; lambda <= 360; lambda += stepDeg) {
    const lamRad = lambda * Math.PI / 180;
    const dec = Math.asin(Math.sin(epsRad) * Math.sin(lamRad)) * 180 / Math.PI;
    const ra = (Math.atan2(Math.cos(epsRad) * Math.sin(lamRad), Math.cos(lamRad)) * 180 / Math.PI + 360) % 360;
    pts.push([ra, dec]);
  }
  return pts;
}
// Fainter/thinner than the Equatorial grid's own reddish tint (rgba(224,120,120,...)) and more
// saturated, so the two stay visually distinguishable rather than reading as the same red - per the
// user's own request ("vykreslena slabší, červenou čarou"); line width bumped from an initial 0.75
// to 1.25 ("trochu silnější"), then to 2 (own follow-up round, new v39_1 copy).
const NIGHTSKY_ECLIPTIC_COLOR = 'rgba(214,64,64,0.5)';
const NIGHTSKY_ECLIPTIC_WIDTH = 2;
function _nightSkyDrawEcliptic(ctx, layout) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, layout.R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.strokeStyle = NIGHTSKY_ECLIPTIC_COLOR;
  ctx.lineWidth = NIGHTSKY_ECLIPTIC_WIDTH;
  const pts = _nightSkyEclipticPoints(2).map(([ra, dec]) => _skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
  _nightSkyStrokePartlyVisibleRun(ctx, layout, pts);
  ctx.restore();
}

function _nightSkyDrawHorizon(ctx, layout) {
  const { cx, cy, R } = layout;
  // The N/E/S/W labels sit just OUTSIDE the sky circle (R*1.06 below), in the canvas's own outer
  // margin - which now follows the theme (#nightSkyCanvas's light-mode white override) even though
  // the sky circle itself never does. White line/text read fine against the dark margin, but vanish
  // against a light one - swap to black in light mode, matching the margin's own black-on-white vs
  // white-on-black logic everywhere else in the app.
  const isLight = document.body.classList.contains('light');
  ctx.save();
  ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = isLight ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.65)';
  ctx.font = '12px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labels = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']];
  for (const [az, txt] of labels) {
    const p = _skyDomePoint(cx, cy, R * 1.06, az, 0);
    ctx.fillText(txt, p.x, p.y);
  }
  ctx.restore();
}

function _nightSkyStarSize(mag) {
  return Math.max(0.6, Math.min(4, 3.2 - mag * 0.5));
}

function _nightSkyDrawStars(ctx, layout) {
  ctx.fillStyle = _nightSkyStarColor();
  for (const s of _skyStars) {
    const p = _skyStarAzEl(s.raDeg, s.decDeg, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (p.el < 0) continue;
    const pt = _skyDomePoint(layout.cx, layout.cy, layout.R, p.az, p.el);
    const r = _nightSkyStarSize(s.mag);
    ctx.globalAlpha = Math.max(0.35, Math.min(1, 1 - s.mag / 7));
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// A first attempt at "don't break constellation lines at the horizon" clamped each below-horizon
// point's ELEVATION to 0 while keeping its own raw azimuth, then drew straight to that point - this
// was wrong: a below-horizon point's own azimuth has nothing to do with where the actual line
// between it and its (possibly far-away-in-azimuth) visible neighbour crosses the horizon, so the
// clamped point could land anywhere around the rim, producing lines that visibly went to "random"
// places instead of a sensible truncation of the real shape (confirmed by the user's own report).
//
// Second attempt: TRUE unclamped projection + a horizon-circle canvas clip (_skyDomePoint's own
// radius formula happily extends past R for negative elevation - nothing stops it) - correct for
// segments near the horizon, but STILL produced a real, visible "line across the whole sky" artifact
// (same colour as constellation lines, confirmed by the user directly on this exact build) for
// constellations deep in the southern sky, invisible from this project's default mid-northern
// latitude - see _nightSkyStrokePartlyVisibleRun's own comment for the root cause (azimuth
// instability near the NADIR, the same class of singularity as the already-fixed LAT===90 case, just
// triggered by a POINT's elevation instead of the observer's latitude) and how connecting two
// BOTH-invisible points is what actually causes the spurious chord. Now uses that shared helper -
// same technique as the Equatorial grid's own fix just above, so the two stay consistent.
function _nightSkyDrawConstellations(ctx, layout, drawLines, drawNames) {
  ctx.strokeStyle = 'rgba(120,160,220,0.55)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(160,190,230,0.85)';
  ctx.font = '10px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (drawLines) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(layout.cx, layout.cy, layout.R, 0, 2 * Math.PI);
    ctx.clip();
    for (const c of _skyConstellations) {
      for (const line of c.lines) {
        const pts = line.map(([ra, dec]) => _skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
        _nightSkyStrokePartlyVisibleRun(ctx, layout, pts);
      }
    }
    ctx.restore();
  }

  if (drawNames) {
    for (const c of _skyConstellations) {
      let sumX = 0, sumY = 0, nVisible = 0;
      for (const line of c.lines) {
        for (const [ra, dec] of line) {
          const p = _skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
          if (p.el < 0) continue;   // name centroid only from genuinely-visible points
          const pt = _skyDomePoint(layout.cx, layout.cy, layout.R, p.az, p.el);
          sumX += pt.x; sumY += pt.y; nVisible++;
        }
      }
      if (nVisible > 0) ctx.fillText(c.id, sumX / nVisible, sumY / nVisible);
    }
  }
}

// ─── The Sun ────────────────────────────────────────────────────────────────────────────────────
// Off by default (like the Equatorial grid) - "Sun" (#chkNightSkySun) shows the Sun's own real
// position, same disc styling as the Analyzer's own animated Sun marker (render-2d.js: glow +
// solid #e8a020 dot with a thin black outline) so it reads as "the same Sun" across the app rather
// than a new symbol. "Sun's path" (#btnNightSkySunPath) is a sub-option of that, same show/hide-by-
// parent-state pattern as the main Display section's own Analemma switch (chkSunArc/btnAnalemma) -
// draws the Sun's track across the currently-selected Night Sky date, black outline + green fill,
// same exact style/colours as the Analyzer's own "Custom date" path (render-2d.js) so this reads as
// the same kind of curve, not a new convention.
let showNightSkySunPath = false;
function _nightSkyUpdateSunSubrow() {
  const row = document.getElementById('nightSkySunSubrow');
  if (row) row.style.display = document.getElementById('chkNightSkySun').checked ? 'flex' : 'none';
}
_nightSkyUpdateSunSubrow();
document.getElementById('chkNightSkySun').addEventListener('change', () => {
  _nightSkyUpdateSunSubrow();
  if (nightSkyActive) drawNightSky();
});
document.getElementById('btnNightSkySunPath').addEventListener('click', () => {
  showNightSkySunPath = !showNightSkySunPath;
  const btn = document.getElementById('btnNightSkySunPath');
  btn.classList.toggle('on', showNightSkySunPath);
  btn.setAttribute('aria-checked', String(showNightSkySunPath));
  if (nightSkyActive) drawNightSky();
});

const NIGHTSKY_SUN_PATH_COLOR_OUTLINE = 'rgba(0,0,0,0.85)';
const NIGHTSKY_SUN_PATH_COLOR_FILL = 'rgba(80,220,120,0.9)';
// One sample every 0.05h (~3 min) across the real UT day - plenty smooth for a canvas curve while
// staying cheap enough to rebuild on every redraw (drag/time-scrub), same order of sampling density
// as the Analyzer's own drawSunArc (0.25 deg in hour-angle terms, ~1 min).
const NIGHTSKY_SUN_PATH_STEP_H = 0.05;

// Sky Map (polar) sub-mode - {az,el} points feed straight into the EXISTING
// _nightSkyStrokePartlyVisibleRun (its below-horizon handling doesn't care where a point's az/el
// came from), so no new stroke plumbing is needed here at all, unlike the Planetarium sub-mode
// below (which needs the horizon-CROSSING interpolation _nightSkyBisectHorizon provides).
function _nightSkyDrawSunPath(ctx, layout) {
  const pts = [];
  for (let hourUT = 0; hourUT <= 24; hourUT += NIGHTSKY_SUN_PATH_STEP_H) {
    pts.push(_nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, hourUT));
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, layout.R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.strokeStyle = NIGHTSKY_SUN_PATH_COLOR_OUTLINE; ctx.lineWidth = 3.5;
  _nightSkyStrokePartlyVisibleRun(ctx, layout, pts);
  ctx.strokeStyle = NIGHTSKY_SUN_PATH_COLOR_FILL; ctx.lineWidth = 1.5;
  _nightSkyStrokePartlyVisibleRun(ctx, layout, pts);
  ctx.restore();
}

function _nightSkyDrawSunDisc(ctx, layout) {
  const s = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  if (s.el < 0) return;
  const pt = _skyDomePoint(layout.cx, layout.cy, layout.R, s.az, s.el);
  const glR = 14;
  const glow = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, glR);
  glow.addColorStop(0, 'rgba(232,160,32,0.60)'); glow.addColorStop(1, 'rgba(232,160,32,0)');
  ctx.fillStyle = glow; ctx.fillRect(pt.x - glR, pt.y - glR, glR * 2, glR * 2);
  ctx.beginPath(); ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#e8a020'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
}

// ─── Sub-modes ──────────────────────────────────────────────────────────────────────────────────
// Night Sky gets its own family of sub-modes, same pattern as Sky Dome's own projection switch
// (SKY_DOME_PROJ_VALUES/_skyDomeProjWheel, render-skydome.js) - a top-right wheel-picker, shown/
// hidden alongside the rest of this mode's own UI in enterNightSky()/exitNightSky(). "Sky Map" is
// the flat polar planisphere built in Phases 1-5 above; "Planetarium" reuses Sky Dome's own
// fisheye/equidistant "observer at the sphere's centre" geometry (its own Planetarium projection,
// render-skydome.js) to project this same star/constellation data as a look-around dome view
// instead - see the dedicated section below _nightSkyDrawSkyMap(). The dispatch in drawNightSky()
// further down is written to make adding a further sub-mode a matter of extending these two arrays
// plus one new branch, not restructuring anything.
const NIGHTSKY_SUBMODE_VALUES = ['skymap', 'planetarium'];
const NIGHTSKY_SUBMODE_LABELS = ['SKY MAP', 'PLANETARIUM'];
const NIGHTSKY_SUBMODE_N = NIGHTSKY_SUBMODE_VALUES.length;
let nightSkySubmode = NIGHTSKY_SUBMODE_VALUES[0];
let _nightSkySubmodeIndex = 0;
function _nightSkyStepSubmode(dir) {
  _nightSkySubmodeIndex = ((_nightSkySubmodeIndex + dir) % NIGHTSKY_SUBMODE_N + NIGHTSKY_SUBMODE_N) % NIGHTSKY_SUBMODE_N;
}
function _nightSkyCommitSubmode() {
  nightSkySubmode = NIGHTSKY_SUBMODE_VALUES[_nightSkySubmodeIndex];
  // Same "only loadable via Catalog" rule as exitNightSkyVisualization()'s own clear - switching
  // AWAY from Planetarium to Sky Map, while staying in Visualization, is still "leaving" the
  // photo's presentation (user's own "kamkoliv" - anywhere), so it clears here too, not just on a
  // full Visualization exit.
  if (nightSkySubmode !== 'planetarium') _nightSkyActiveFrame = null;
  _nightSkySubmodeWheel.render();
  _nightSkyUpdatePlanetControlsVisibility();
  _nightSkyUpdatePresentationLock();
  if (nightSkyActive) drawNightSky();
}
const _nightSkySubmodeWheel = makeWheelPicker(document.getElementById('nightSkySubmodeWheelTrack'), {
  labelAt: (off) => NIGHTSKY_SUBMODE_LABELS[((_nightSkySubmodeIndex + off) % NIGHTSKY_SUBMODE_N + NIGHTSKY_SUBMODE_N) % NIGHTSKY_SUBMODE_N],
  step: _nightSkyStepSubmode,
  itemW: 96,
  onCommit: _nightSkyCommitSubmode,
});
document.getElementById('btnNightSkySubmodeDec').addEventListener('click', () => { _nightSkyStepSubmode(-1); _nightSkyCommitSubmode(); });
document.getElementById('btnNightSkySubmodeInc').addEventListener('click', () => { _nightSkyStepSubmode(1); _nightSkyCommitSubmode(); });
_nightSkySubmodeWheel.render();

// The sky's own base colour - navy at night (dark theme), matching the real night sky regardless
// of the UI theme up until now; now follows the theme instead, white in light mode, per the user's
// own request for a "daytime" light-mode look. Stars invert along with it (_nightSkyStarColor,
// just below) rather than keeping one fixed colour, so they stay legible against either sky instead
// of vanishing into a same-colour background. Shared by the Sky Map sub-mode's own circle fill
// below and the Planetarium's own sky region (_nightSkyDrawPlanetSkyGround) so the two always agree.
function _nightSkySkyColor() {
  return document.body.classList.contains('light') ? '#ffffff' : '#001538';
}
// Stars invert with the sky rather than staying fixed white throughout - white on the dark sky,
// black on the light one (the user's own correction after seeing white-on-white read as simply
// invisible: not the point - they should still be legible, just with light/dark swapped, the same
// "black ink on white paper vs. white ink on black paper" inversion the horizon line/N-E-S-W labels
// already use, see _nightSkyDrawHorizon's own theme check).
function _nightSkyStarColor() {
  return document.body.classList.contains('light') ? '#000000' : '#ffffff';
}

// The "Sky Map" sub-mode's own renderer - this IS the whole of drawNightSky() from Phase 5, just
// renamed and no longer the sole thing drawNightSky() can do (see the dispatcher just below it).
function _nightSkyDrawSkyMap(ctx, w, h) {
  if (!_skyDataLoaded) {
    ctx.fillStyle = '#8899aa';
    ctx.font = '14px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Night Sky – loading data…', w / 2, h / 2);
    return;
  }

  const layout = _nightSkyLayout(w, h);
  // Sky background fill, just for the visible-sky circle, leaving the canvas's own CSS background
  // (#nightSkyCanvas, css/style.css) showing outside it - the circle reads as "the sky", the
  // surrounding margin as neutral canvas margin, not the same flat fill as before.
  ctx.fillStyle = _nightSkySkyColor();
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, layout.R, 0, 2 * Math.PI);
  ctx.fill();

  const showGrid = document.getElementById('chkNightSkyGrid').checked;
  const showEquatorial = document.getElementById('chkNightSkyEquatorial').checked;
  const showEcliptic = document.getElementById('chkNightSkyEcliptic').checked;
  const showHorizon = document.getElementById('chkNightSkyHorizon').checked;
  const showLines = document.getElementById('chkNightSkyLines').checked;
  const showNames = document.getElementById('chkNightSkyNames').checked;
  const showStars = document.getElementById('chkNightSkyStars').checked;
  const showSun = document.getElementById('chkNightSkySun').checked;

  if (showGrid) _nightSkyDrawGrid(ctx, layout);
  if (showEquatorial) _nightSkyDrawEquatorialGrid(ctx, layout);
  if (showEcliptic) _nightSkyDrawEcliptic(ctx, layout);
  if (showLines || showNames) _nightSkyDrawConstellations(ctx, layout, showLines, showNames);
  if (showStars) _nightSkyDrawStars(ctx, layout);
  if (showSun && showNightSkySunPath) _nightSkyDrawSunPath(ctx, layout);
  if (showSun) _nightSkyDrawSunDisc(ctx, layout);
  if (showHorizon) _nightSkyDrawHorizon(ctx, layout);
}

// ─── Planetarium sub-mode ──────────────────────────────────────────────────────────────────────
// Same fisheye/equidistant "observer standing at the sphere's own centre, looking around" geometry
// as Sky Dome's own Planetarium projection (js/render-skydome.js, _skyDomePlanet3D and its
// updateSkyDomePlanetCamera/_skyDomePlanet3DProject*/_skyDomePlanet3DStrokePolyline family) - but
// as Night Sky's OWN independent camera/state, not the same mutable object, so panning or zooming
// one view never moves the other, and projecting Night Sky's own content (stars, constellation
// lines, both grids, the horizon ring) instead of Sky Dome's sun path/compass. Only the genuinely
// generic, state-free vector helpers are reused directly from render-skydome.js (which loads
// first, see index.html): _skyDomeUnitVec (az/el → 3D unit vector), _sd3Cross/_sd3Dot (3-vector
// ops), _sd3AlphaOf/_sd3WithAlpha (rgba-string alpha get/set) - everything that actually holds
// camera state or draws is its own copy here, for the same self-containment reason the rest of
// this file doesn't reach into render-skydome.js's internals (see this file's own header).
const _NIGHTSKY_PLANET_BASE_FOCAL = 1.15;   // focal length at zoom=1x - tunes the default field of view
// camAz/camEl are the VIEWING DIRECTION (drag pans/tilts it); camEl clamped to [0, ~90°) - looking
// below the horizon shows nothing (Night Sky has no below-horizon content to show anyway, same
// choice as the Sky Map sub-mode), so the opposite horizon is reached by panning camAz 180°, not by
// tilting past the zenith. zoom narrows/widens the field of view via FOCAL, same as Sky Dome's own.
const _nightSkyPlanet3D = { camAz: Math.PI, camEl: 0.5, zoom: 1.0 };
function _nightSkyUpdatePlanetCamera() {
  const az = _nightSkyPlanet3D.camAz, el = _nightSkyPlanet3D.camEl;
  const fwd = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
  const worldUp = [0, 0, 1];
  let right = _sd3Cross(fwd, worldUp);
  const rlen = Math.hypot(right[0], right[1], right[2]) || 1;
  right = [right[0] / rlen, right[1] / rlen, right[2] / rlen];
  const up = _sd3Cross(right, fwd);
  _nightSkyPlanet3D.RIGHT = right; _nightSkyPlanet3D.UP = up; _nightSkyPlanet3D.FWD = fwd;
  _nightSkyPlanet3D.FOCAL = _NIGHTSKY_PLANET_BASE_FOCAL * _nightSkyPlanet3D.zoom;
}
_nightSkyUpdatePlanetCamera();

// Vertical zoom slider (#nightSkyPlanetZoomCtl/#nightSkyPlanetZoom/#nightSkyPlanetZoomVal,
// index.html+css/style.css) - same control/range/step as Sky Dome's own Planetarium zoom
// (#skyMap3DZoom, render-skydome.js's setSkyDomePlanet3DZoom), shown only while this sub-mode is
// selected. One shared setter for both the slider's own 'input' event and the canvas wheel handler
// below, so the two stay in lockstep exactly like Sky Dome's own zoom does.
function setNightSkyPlanetZoom(z) {
  _nightSkyPlanet3D.zoom = Math.max(0.5, Math.min(2, z));
  _nightSkyUpdatePlanetCamera();
  const rng = document.getElementById('nightSkyPlanetZoom');
  if (rng && parseFloat(rng.value) !== _nightSkyPlanet3D.zoom) rng.value = _nightSkyPlanet3D.zoom;
  const val = document.getElementById('nightSkyPlanetZoomVal');
  if (val) val.textContent = _nightSkyPlanet3D.zoom.toFixed(1) + '×';
  if (nightSkyActive) drawNightSky();
}
const _nightSkyPlanetZoomEl = document.getElementById('nightSkyPlanetZoom');
if (_nightSkyPlanetZoomEl) {
  _nightSkyPlanetZoomEl.addEventListener('input', (e) => setNightSkyPlanetZoom(parseFloat(e.target.value)));
}
// Shown/hidden alongside the rest of this sub-mode's own state - see _nightSkyCommitSubmode() and
// enterNightSky()/exitNightSky() below.
function _nightSkyUpdatePlanetControlsVisibility() {
  const ctl = document.getElementById('nightSkyPlanetZoomCtl');
  if (ctl) ctl.style.display = (nightSkyActive && nightSkyTopView === 'visualization'
    && nightSkySubmode === 'planetarium') ? 'flex' : 'none';
}

// Locks the time-shift controls (drag-the-belt strip + animate Play) and the whole Calibration
// panel (Date/Location/Time zone, including SET NOW) while a catalog photo's frame is actually
// being presented in Planetarium (build 40_1, user's own request) - changing any of them out from
// under a displayed photo would silently invalidate the very calibration the frame is shown
// against. Unlocked the instant the presentation ends (switching to Sky Map, back to Catalog, or
// leaving Night Sky) - called from the same 4 sites as _nightSkyUpdatePlanetControlsVisibility()
// just above, since "is the frame actually on screen" is exactly the condition that function's own
// visibility already depends on. Reuses the app's existing `.calibration-locked` class/CSS
// (already used by Gallery mode for the same "don't edit the calibration a displayed thing is
// shown against" reasoning) rather than inventing a new one for the sidebar half of this.
function _nightSkyUpdatePresentationLock() {
  const presenting = nightSkyActive && nightSkyTopView === 'visualization'
    && nightSkySubmode === 'planetarium' && !!_nightSkyActiveFrame;
  document.getElementById('calibrationSection').classList.toggle('calibration-locked', presenting);
  document.getElementById('nightSkyTimeWrap').classList.toggle('nightsky-time-locked', presenting);
}

// Fisheye (equidistant) projection - screen radius proportional to the angle theta from the view
// direction, not tan(theta) - the same mapping Sky Dome's own Planetarium uses (see its own, much
// longer comment on why: real fisheye/planetarium-dome optics, not plain perspective/gnomonic,
// which can't even reach a 180° field of view). Renders out to FADE_OUTER (170° from the view
// direction) fading smoothly from FADE_INNER (130°) rather than snapping off, since theta→180° is a
// genuine mapping singularity (sin(180°)=0), not an arbitrary cutoff.
const NIGHTSKY_PLANET_FADE_INNER = 130 * Math.PI / 180;
const NIGHTSKY_PLANET_FADE_OUTER = 170 * Math.PI / 180;
function _nightSkyPlanetProjectRaw(layout, v) {
  const cosTheta = _sd3Dot(v, _nightSkyPlanet3D.FWD);
  const theta = Math.acos(Math.max(-1, Math.min(1, cosTheta)));
  if (theta >= NIGHTSKY_PLANET_FADE_OUTER) return { x: layout.cx, y: layout.cy, visible: false, alpha: 0 };
  const alpha = theta <= NIGHTSKY_PLANET_FADE_INNER ? 1
    : 1 - (theta - NIGHTSKY_PLANET_FADE_INNER) / (NIGHTSKY_PLANET_FADE_OUTER - NIGHTSKY_PLANET_FADE_INNER);
  const lx = _sd3Dot(v, _nightSkyPlanet3D.RIGHT), ly = _sd3Dot(v, _nightSkyPlanet3D.UP);
  const rho = Math.hypot(lx, ly);   // = sin(theta), stays away from 0 until theta→180°
  const k = rho > 1e-6 ? theta / rho : 1;
  const sx = _nightSkyPlanet3D.FOCAL * lx * k, sy = _nightSkyPlanet3D.FOCAL * ly * k;
  return { x: layout.cx + sx * layout.scale, y: layout.cy - sy * layout.scale, visible: true, alpha };
}
function _nightSkyPlanetProject(layout, az, el) {
  return _nightSkyPlanetProjectRaw(layout, _skyDomeUnitVec(az, el));
}
function _nightSkyPlanetLayout(w, h) {
  return { cx: w / 2, cy: h / 2, scale: Math.max(10, Math.min(w, h) / 2 * 0.92) };
}

// Fills the frame: the "ground" a real planetarium dome's audience sits under (not sky) everywhere,
// then the sky's own colour (_nightSkySkyColor - shared with the Sky Map sub-mode's own circle) over
// the region actually above the horizon. Dark neutral grey in dark theme, light grey in light theme
// (`#e2e7ec`, distinct from the sky's own pure white in light mode, per the user's own choice).
//
// The sky region is the el=0 ring traced as one closed vector path and filled directly, so the fill
// edge matches the horizon STROKE (_nightSkyDrawPlanetHorizon) pixel for pixel. Ring points more
// than NIGHTSKY_PLANET_FADE_OUTER (170 deg) from the view direction lie behind the observer, where
// nothing else is drawn; they are pulled in to that radius with their bearing kept, and consecutive
// such points are joined by an ARC of that circle, not a chord. That arc is what keeps the path
// valid at every camera elevation down to exactly 0: as camEl -> 0 the visible part of the ring
// flattens into a straight line through the centre and the rest of it collapses into the far back,
// where the bearing sweeps across the whole top half of the screen within a few degrees of azimuth.
// Chords there cut across the sky; the arc follows it. Clamped points always sit on the upper half
// of the screen (theta > 170 deg needs cos(az offset) < 0, so the camera-space "up" component
// -sin(camEl)*cos(offset) is >= 0), so each arc is drawn inside canvas angles [-pi, 0] and can only
// pass over the top, never the bottom - which also settles the one ambiguous case, camEl exactly 0,
// where two neighbouring clamped points sit on opposite sides of the centre line.
// The sky therefore never extends past the fisheye disc's own 170 deg radius; outside it the frame
// stays ground-coloured at every elevation (at zoom 0.5x that disc is smaller than the canvas).
function _nightSkyPlanetGroundColor() {
  return document.body.classList.contains('light') ? '#e2e7ec' : '#1c1c20';
}
function _nightSkyDrawPlanetSkyGround(ctx, layout, w, h) {
  ctx.fillStyle = _nightSkyPlanetGroundColor();
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = _nightSkySkyColor();

  const C = _nightSkyPlanet3D;
  const rClamp = C.FOCAL * NIGHTSKY_PLANET_FADE_OUTER * layout.scale;
  ctx.beginPath();
  let prevAngle = null;   // canvas angle of the previous point, only while it was clamped
  // Starts at the view direction, so the clamped stretch behind the observer is always one run in
  // the middle of the loop rather than split between its start and end (closePath would then join
  // those two halves with a straight chord instead of the arc over the top).
  const az0 = C.camAz * 180 / Math.PI;
  for (let i = 0; i <= 360; i++) {
    const az = az0 + i;
    const v = _skyDomeUnitVec(az, 0);
    const theta = Math.acos(Math.max(-1, Math.min(1, _sd3Dot(v, C.FWD))));
    const lx = _sd3Dot(v, C.RIGHT), ly = _sd3Dot(v, C.UP);
    if (theta > NIGHTSKY_PLANET_FADE_OUTER) {
      let angle = Math.atan2(-ly, lx);   // canvas y points down
      // True angles lie in [-pi, 0] (upper half of the screen); a positive value is only roundoff
      // in ly around 0 (camEl ~ 0), so snap it to whichever end of the range it sits next to.
      if (angle > 0) angle = angle < Math.PI / 2 ? 0 : -Math.PI;
      if (prevAngle === null) {
        const x = layout.cx + rClamp * Math.cos(angle), y = layout.cy + rClamp * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      } else {
        ctx.arc(layout.cx, layout.cy, rClamp, prevAngle, angle, angle < prevAngle);
      }
      prevAngle = angle;
    } else {
      const rho = Math.hypot(lx, ly);
      const k = rho > 1e-6 ? theta / rho : 1;
      const x = layout.cx + C.FOCAL * lx * k * layout.scale, y = layout.cy - C.FOCAL * ly * k * layout.scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      prevAngle = null;
    }
  }
  ctx.closePath();
  ctx.fill();
}

// Generic bisection: given a way to evaluate a point (returning at least {az,el}) at any fraction t
// in [0,1] along some parametrization, plus the two ENDPOINTS' own already-computed elevations
// (opposite sign), finds the point where elevation crosses 0. Shared by _nightSkyHorizonCrossing
// below (parametrized by RA/Dec, for constellation lines/the Equatorial grid) and the Sun's own
// path (parametrized by hourUT instead) - only what "evaluate at t" means differs between callers,
// the bisection itself doesn't care. Re-evaluates the real position at each step rather than
// lerping az/el directly - lerping az/el was tried once already, for the flat Sky Map's horizon
// clamp (Phase 5, eleventh round - see _nightSkyStrokePartlyVisibleRun's own comment on why that
// was wrong: a point's own az/el has no reliable relationship to a NEIGHBOURING point's). Safe from
// the fourteenth round's nadir-singularity bug class (unstable azimuth near el=+-90 deg) because
// el=0 is nowhere near either pole.
function _nightSkyBisectHorizon(sampleAt, el0, el1) {
  let tLo = 0, tHi = 1, eLo = el0, eHi = el1, p = null;
  for (let i = 0; i < 8; i++) {
    const t = tLo + (tHi - tLo) * (eLo / (eLo - eHi));
    p = sampleAt(t);
    if (Math.abs(p.el) < 0.005) break;
    if (p.el > 0) { tLo = t; eLo = p.el; } else { tHi = t; eHi = p.el; }
  }
  return p;
}

// Finds where a segment between two RA/Dec points crosses the horizon (el=0), given the two
// points' own already-computed elevations have opposite signs - the shortest way around the 0/360
// RA wrap. See _nightSkyBisectHorizon just above for the actual bisection.
function _nightSkyHorizonCrossing(ra0, dec0, el0, ra1, dec1, el1) {
  let dra = ra1 - ra0;
  if (dra > 180) dra -= 360; else if (dra < -180) dra += 360;
  return _nightSkyBisectHorizon((t) => {
    const ra = (ra0 + dra * t + 360) % 360;
    const dec = dec0 + (dec1 - dec0) * t;
    return _skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  }, el0, el1);
}

// Strokes a polyline given as RAW RA/Dec vertices (constellation lines, the Equatorial grid) rather
// than pre-computed Az/El - unlike _nightSkyPlanetStrokeRun below, a below-horizon vertex here isn't
// just dropped: when two CONSECUTIVE vertices straddle the horizon (opposite-sign elevation), the
// run is extended to their real _nightSkyHorizonCrossing() point first, so the line reaches all the
// way to the horizon ring itself instead of stopping at the last whole sampled vertex still above
// it (a gap of up to one sample step, visibly short of the rim - the user's own report). Delegates
// the actual az/el plotting (rim-fade alpha bucketing, .breakBefore-forced subpath starts) to
// _nightSkyPlanetStrokeRun once the raw vertex list has been expanded with those crossing points.
function _nightSkyPlanetStrokeRaDecRun(ctx, layout, raDecPoints, color) {
  const plotPts = [];
  let prev = null;   // {ra, dec, el}
  for (const [ra, dec] of raDecPoints) {
    const el = _skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT).el;
    if (prev && (prev.el >= 0) !== (el >= 0)) {
      const cross = _nightSkyHorizonCrossing(prev.ra, prev.dec, prev.el, ra, dec, el);
      plotPts.push({ az: cross.az, el: Math.max(0, cross.el), breakBefore: prev.el < 0 });
    }
    if (el >= 0) {
      const p = _skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
      plotPts.push({ az: p.az, el: p.el, breakBefore: false });
    }
    prev = { ra, dec, el };
  }
  _nightSkyPlanetStrokeRun(ctx, layout, plotPts, color);
}

// Strokes one polyline of {az,el[,breakBefore]} points through the fisheye projection above.
// Below-horizon points (el<0) are dropped outright, same choice _nightSkyDrawStars already makes
// for individual stars - unlike the flat Sky Map there's no cheap circular clip to truncate a
// below-horizon segment exactly at its horizon crossing here, and re-deriving that crossing isn't
// worth it when the sky above the horizon already fills most of the frame - so a line simply ends
// at the last above-horizon point rather than being extended to it (callers that DO need the exact
// crossing, e.g. RA/Dec content, insert it themselves as a real el>=0 point via
// _nightSkyPlanetStrokeRaDecRun above, marking it .breakBefore so this function knows to start a
// fresh subpath there rather than connecting it to whatever the previous run was). This also
// sidesteps the exact bug class fixed in _nightSkyStrokePartlyVisibleRun's own long comment above
// (spurious chords between two far-apart below-horizon points) by construction, since below-horizon
// points are never connected to anything here at all. Above the horizon, each point's own .alpha
// (rim/behind-observer fade) is honoured with the same alpha-bucketed stroke technique as Sky
// Dome's own _skyDomePlanet3DStrokePolyline: stroke up to a bucket boundary at the OLD alpha, then
// start a fresh subpath from that same point at the NEW one, so the fade reads continuously rather
// than in visible flat-shaded steps.
const NIGHTSKY_PLANET_ALPHA_BUCKET = 0.12;
function _nightSkyPlanetStrokeRun(ctx, layout, azElPoints, color) {
  const baseAlpha = _sd3AlphaOf(color);
  let started = false, curBucket = null, lastAlpha = 1;
  const strokeSeg = (a) => { ctx.strokeStyle = _sd3WithAlpha(color, baseAlpha * a); ctx.stroke(); };
  ctx.beginPath();
  for (const p of azElPoints) {
    if (p.el < 0 || p.breakBefore) {
      if (started) { strokeSeg(lastAlpha); ctx.beginPath(); started = false; curBucket = null; }
      if (p.el < 0) continue;
    }
    const proj = _nightSkyPlanetProject(layout, p.az, p.el);
    if (!proj.visible) {
      if (started) { strokeSeg(lastAlpha); ctx.beginPath(); started = false; curBucket = null; }
      continue;
    }
    const bucket = Math.round(proj.alpha / NIGHTSKY_PLANET_ALPHA_BUCKET);
    if (started && bucket !== curBucket) {
      ctx.lineTo(proj.x, proj.y);
      strokeSeg(lastAlpha);
      ctx.beginPath();
      ctx.moveTo(proj.x, proj.y);
    } else if (!started) {
      ctx.moveTo(proj.x, proj.y);
      started = true;
    } else {
      ctx.lineTo(proj.x, proj.y);
    }
    curBucket = bucket; lastAlpha = proj.alpha;
  }
  if (started) strokeSeg(lastAlpha);
}

function _nightSkyDrawPlanetGrid(ctx, layout) {
  ctx.save();
  ctx.lineWidth = 1;
  for (const el of [30, 60]) {
    const pts = [];
    for (let az = 0; az <= 360; az += 4) pts.push({ az, el });
    _nightSkyPlanetStrokeRun(ctx, layout, pts, 'rgba(255,255,255,0.14)');
  }
  for (let az = 0; az < 360; az += 30) {
    const pts = [];
    for (let el = 0; el <= 90; el += 4) pts.push({ az, el });
    _nightSkyPlanetStrokeRun(ctx, layout, pts, 'rgba(255,255,255,0.14)');
  }
  ctx.restore();
}

function _nightSkyDrawPlanetEquatorialGrid(ctx, layout) {
  for (const dec of [-60, -30, 0, 30, 60]) {
    const pts = [];
    for (let ra = 0; ra <= 360; ra += 4) pts.push([ra, dec]);
    _nightSkyPlanetStrokeRaDecRun(ctx, layout, pts, 'rgba(224,120,120,0.45)');
  }
  for (let ra = 0; ra < 360; ra += 30) {
    const pts = [];
    for (let dec = -90; dec <= 90; dec += 4) pts.push([ra, dec]);
    _nightSkyPlanetStrokeRaDecRun(ctx, layout, pts, 'rgba(224,120,120,0.45)');
  }
}

function _nightSkyDrawPlanetEcliptic(ctx, layout) {
  ctx.save();
  ctx.lineWidth = NIGHTSKY_ECLIPTIC_WIDTH;
  _nightSkyPlanetStrokeRaDecRun(ctx, layout, _nightSkyEclipticPoints(2), NIGHTSKY_ECLIPTIC_COLOR);
  ctx.restore();
}

// The horizon has no simple circular boundary here the way it does on the flat Sky Map (it's just
// the el=0 ring, which becomes a general curve through the frame once the camera isn't looking
// straight up) - drawn the same way as the other grid rings above, plus N/E/S/W labels nudged a few
// pixels outward along the direction from screen centre (a cheap, camera-orientation-independent
// approximation of "just outside the ring", rather than a fixed offset that would look right in
// only one gaze direction).
function _nightSkyDrawPlanetHorizon(ctx, layout) {
  const isLight = document.body.classList.contains('light');
  ctx.save();
  ctx.lineWidth = 1.6;
  const pts = [];
  for (let az = 0; az <= 360; az += 3) pts.push({ az, el: 0 });
  _nightSkyPlanetStrokeRun(ctx, layout, pts, isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)');
  ctx.fillStyle = isLight ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.65)';
  ctx.font = '12px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [az, txt] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const proj = _nightSkyPlanetProject(layout, az, 0);
    if (!proj.visible) continue;
    const dx = proj.x - layout.cx, dy = proj.y - layout.cy;
    const dist = Math.hypot(dx, dy) || 1;
    ctx.fillText(txt, proj.x + (dx / dist) * 14, proj.y + (dy / dist) * 14);
  }
  ctx.restore();
}

function _nightSkyDrawPlanetStars(ctx, layout) {
  ctx.fillStyle = _nightSkyStarColor();
  for (const s of _skyStars) {
    const p = _skyStarAzEl(s.raDeg, s.decDeg, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (p.el < 0) continue;
    const proj = _nightSkyPlanetProject(layout, p.az, p.el);
    if (!proj.visible) continue;
    const r = _nightSkyStarSize(s.mag);
    ctx.globalAlpha = Math.max(0.35, Math.min(1, 1 - s.mag / 7)) * proj.alpha;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, r, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function _nightSkyDrawPlanetConstellations(ctx, layout, drawLines, drawNames) {
  if (drawLines) {
    for (const c of _skyConstellations) {
      for (const line of c.lines) {
        _nightSkyPlanetStrokeRaDecRun(ctx, layout, line, 'rgba(120,160,220,0.55)');
      }
    }
  }
  if (drawNames) {
    ctx.fillStyle = 'rgba(160,190,230,0.85)';
    ctx.font = '10px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of _skyConstellations) {
      let sumX = 0, sumY = 0, nVisible = 0;
      for (const line of c.lines) {
        for (const [ra, dec] of line) {
          const p = _skyStarAzEl(ra, dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
          if (p.el < 0) continue;
          const proj = _nightSkyPlanetProject(layout, p.az, p.el);
          if (!proj.visible) continue;
          sumX += proj.x; sumY += proj.y; nVisible++;
        }
      }
      if (nVisible > 0) ctx.fillText(c.id, sumX / nVisible, sumY / nVisible);
    }
  }
}

// The Sun - Planetarium sub-mode's own equivalent of _nightSkyDrawSunPath/_nightSkyDrawSunDisc
// above (Sky Map sub-mode). The path needs its own horizon-crossing handling (parametrized by
// hourUT via the same _nightSkyBisectHorizon the RA/Dec content already uses - see
// _nightSkyPlanetStrokeRaDecRun's own comment) rather than reusing that function directly, since
// its parametrization is time, not RA/Dec; the point list is built once and stroked twice (outline,
// then fill) rather than rebuilt per pass, since each sample re-derives a real sun position.
function _nightSkyPlanetBuildSunPathPts() {
  const plotPts = [];
  let prev = null;   // {hourUT, el}
  for (let hourUT = 0; hourUT <= 24; hourUT += NIGHTSKY_SUN_PATH_STEP_H) {
    const s = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, hourUT);
    if (prev && (prev.el >= 0) !== (s.el >= 0)) {
      const h0 = prev.hourUT, h1 = hourUT;
      const cross = _nightSkyBisectHorizon(
        (t) => _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, h0 + (h1 - h0) * t),
        prev.el, s.el
      );
      plotPts.push({ az: cross.az, el: Math.max(0, cross.el), breakBefore: prev.el < 0 });
    }
    if (s.el >= 0) plotPts.push({ az: s.az, el: s.el, breakBefore: false });
    prev = { hourUT, el: s.el };
  }
  return plotPts;
}
function _nightSkyDrawPlanetSunPath(ctx, layout) {
  const pts = _nightSkyPlanetBuildSunPathPts();
  ctx.save();
  ctx.lineWidth = 3.5;
  _nightSkyPlanetStrokeRun(ctx, layout, pts, NIGHTSKY_SUN_PATH_COLOR_OUTLINE);
  ctx.lineWidth = 1.5;
  _nightSkyPlanetStrokeRun(ctx, layout, pts, NIGHTSKY_SUN_PATH_COLOR_FILL);
  ctx.restore();
}

function _nightSkyDrawPlanetSun(ctx, layout) {
  const s = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  if (s.el < 0) return;
  const proj = _nightSkyPlanetProject(layout, s.az, s.el);
  if (!proj.visible) return;
  ctx.save();
  ctx.globalAlpha = proj.alpha;
  const glR = 14;
  const glow = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, glR);
  glow.addColorStop(0, 'rgba(232,160,32,0.60)'); glow.addColorStop(1, 'rgba(232,160,32,0)');
  ctx.fillStyle = glow; ctx.fillRect(proj.x - glR, proj.y - glR, glR * 2, glR * 2);
  ctx.beginPath(); ctx.arc(proj.x, proj.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#e8a020'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

// Astro-catalog "L" corner-bracket frame (build 40_1) - purely an orientation aid marking a
// catalog photo's true field on the sky (see _nightSkyFrameCorners above for the geometry), NOT
// warped/scaled to the photo itself. Reuses _nightSkyPlanetStrokeRaDecRun (same RA/Dec-in,
// rim-fade/horizon-aware stroking already used for the Equatorial grid/ecliptic/constellation
// lines) for each of the 8 short bracket-arm segments, so the frame fades at the dome's own rim
// and clips at the horizon exactly like everything else drawn here.
const NIGHTSKY_FRAME_COLOR = 'rgba(255,80,80,0.9)';   // matches #nightSkyFrameThumb's own red border (#ff5050)
// Strokes one short frame-bracket segment (two RA/Dec endpoints). Unlike
// _nightSkyPlanetStrokeRaDecRun (used for stars/constellation lines, which are genuinely not
// visible below the real horizon, and clips accordingly) - the astro-catalog frame is an
// orientation aid that should stay visible even where part of the photographed field dips below
// the horizon (the user's own request: "chci, aby byly vidět hranice snímku i pod horizontem" - a
// wide-angle/landscape shot often does dip below it). So this only respects the camera's own
// behind-view/rim-fade cutoff (proj.visible/proj.alpha, from the SAME projection everything else
// uses), never the horizon - the equidistant fisheye projection is continuous across el=0 anyway
// (drawn over the existing ground fill, _nightSkyDrawPlanetSkyGround, so it reads as "on the
// ground" there, not floating in empty space).
function _nightSkyDrawFrameSegment(ctx, layout, ra0, dec0, ra1, dec1, color) {
  const azel0 = _skyStarAzEl(ra0, dec0, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const azel1 = _skyStarAzEl(ra1, dec1, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const p0 = _nightSkyPlanetProject(layout, azel0.az, azel0.el);
  const p1 = _nightSkyPlanetProject(layout, azel1.az, azel1.el);
  if (!p0.visible || !p1.visible) return;
  const baseAlpha = _sd3AlphaOf(color);
  ctx.strokeStyle = _sd3WithAlpha(color, baseAlpha * Math.min(p0.alpha, p1.alpha));
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}
function _nightSkyDrawCatalogFrame(ctx, layout) {
  if (!_nightSkyActiveFrame) return;
  const f = _nightSkyActiveFrame;
  const { corners, arms } = _nightSkyFrameCorners(f.raDeg, f.decDeg, f.fovWDeg, f.fovHDeg, f.rotationDeg);
  ctx.save();
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const c = corners[i], [aPrev, aNext] = arms[i];
    _nightSkyDrawFrameSegment(ctx, layout, c.raDeg, c.decDeg, aPrev.raDeg, aPrev.decDeg, NIGHTSKY_FRAME_COLOR);
    _nightSkyDrawFrameSegment(ctx, layout, c.raDeg, c.decDeg, aNext.raDeg, aNext.decDeg, NIGHTSKY_FRAME_COLOR);
  }
  ctx.restore();
}

// Floating square thumbnail (#nightSkyFrameThumb, index.html/css/style.css) next to the frame -
// shown at its own native size (250px - the user's own thumbnail files are generated at that
// size, not scaled down), positioned every redraw so it NEVER overlaps the frame's own "L"
// bracket rectangle (the user's own explicit requirement) - not just a simple quadrant-flip
// around the centre point (fine at the old 64px size, but a 250px box needs to actually reason
// about the frame's on-screen extent, which can itself span most of the canvas for a wide-FOV
// shot like AUR06). Tries each of the 4 sides (right/left/below/above the frame's own projected
// bounding box) in order of how much on-screen room each one actually has, picks the first that
// fits the thumbnail fully on-screen; if none do (an extremely wide/tall frame leaves no side with
// enough room), falls back to whichever side has the most room - still placed OUTSIDE the frame's
// bounding box either way, just possibly clipped by the canvas edge in that rare case, which is
// the lesser of the two problems here. proj.x/proj.y are already in the same logical/CSS-pixel
// space #nightSkyFrameThumb's own left/top need (drawNightSky()'s w/h, both canvas and this
// element share #canvasContainer's top-left origin - see #nightSkyCanvas/#nightSkyFrameThumb,
// both position:absolute;inset-anchored there).
const NIGHTSKY_FRAME_THUMB_SIZE = 250, NIGHTSKY_FRAME_THUMB_GAP = 14;
// Liang-Barsky line-clipping test, reused here just for its "does this segment touch this box"
// boolean - standard, exact (not an approximation) for whether a finite segment intersects an
// axis-aligned box, including the segment ending up fully inside it.
function _segIntersectsBox(x0, y0, x1, y1, bx0, by0, bx1, by1) {
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy], q = [x0 - bx0, bx1 - x0, y0 - by0, by1 - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > tmax) return false; if (r > tmin) tmin = r; }
      else { if (r < tmin) return false; if (r < tmax) tmax = r; }
    }
  }
  return true;
}
function _nightSkyUpdateFrameThumb(layout, w, h) {
  const el = document.getElementById('nightSkyFrameThumb');
  const f = _nightSkyActiveFrame;
  if (!f) { el.style.display = 'none'; return; }
  // No horizon check here either (see _nightSkyDrawFrameSegment's own comment) - the thumbnail
  // should stay put next to the frame even while its centre is below the horizon, only actually
  // disappearing once the camera itself can't see that direction at all (proj.visible).
  const centerAzEl = _skyStarAzEl(f.raDeg, f.decDeg, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const centerProj = _nightSkyPlanetProject(layout, centerAzEl.az, centerAzEl.el);
  if (!centerProj.visible) { el.style.display = 'none'; return; }

  // The frame's own on-screen bounding box, from whichever of its 4 corners are actually visible
  // (a corner can legitimately fall behind the camera for a very wide FOV even while the centre
  // itself is visible) - falls back to just the centre point if none are (degenerate, shouldn't
  // normally happen). Also the 8 short "L" bracket segments themselves, in screen space - the
  // frame's REAL boundary (only near its 4 corners, not a full outline - see
  // _nightSkyFrameCorners/NIGHTSKY_FRAME_L_FRAC), needed for the inside-the-frame placement below.
  const { corners, arms } = _nightSkyFrameCorners(f.raDeg, f.decDeg, f.fovWDeg, f.fovHDeg, f.rotationDeg);
  const projOf = (pt) => {
    const azel = _skyStarAzEl(pt.raDeg, pt.decDeg, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    return _nightSkyPlanetProject(layout, azel.az, azel.el);
  };
  const cornerProjs = corners.map(projOf);
  const bracketSegments = [];
  const footprintPts = [];   // every point that can actually appear as part of a drawn bracket -
                              // corners AND arm endpoints, needed below for a bbox that genuinely
                              // contains the whole frame (see the comment on that bbox use)
  for (let i = 0; i < 4; i++) {
    if (!cornerProjs[i].visible) continue;
    footprintPts.push(cornerProjs[i]);
    for (const armPt of arms[i]) {
      const ap = projOf(armPt);
      if (ap.visible) { bracketSegments.push([cornerProjs[i].x, cornerProjs[i].y, ap.x, ap.y]); footprintPts.push(ap); }
    }
  }
  // The frame's own on-screen bounding box - deliberately built from EVERY footprint point (corners
  // AND arm endpoints), not just the 4 corners: the arms are their own independent RA/Dec->Az/El->
  // screen projection, not a screen-space interpolation between corners, so under extreme rotation/
  // near-pole geometry an arm point CAN land outside the convex hull of the 4 corners alone - a
  // corners-only bbox found this way (a real "outside" placement that turned out to still clip a
  // bracket segment, caught via a multi-camera-angle stress test) understates the frame's true
  // extent in exactly that case.
  const pts = footprintPts.length ? footprintPts : [centerProj];
  const bx0 = Math.min(...pts.map((p) => p.x)), bx1 = Math.max(...pts.map((p) => p.x));
  const by0 = Math.min(...pts.map((p) => p.y)), by1 = Math.max(...pts.map((p) => p.y));

  if (el.src.indexOf(f.thumbnail) === -1) el.src = f.thumbnail;   // avoid re-decoding on every redraw

  const S = NIGHTSKY_FRAME_THUMB_SIZE, G = NIGHTSKY_FRAME_THUMB_GAP;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const vCenter = clamp((by0 + by1) / 2 - S / 2, 0, h - S);   // kept on-screen; never moved past the frame's own edge
  const hCenter = clamp((bx0 + bx1) / 2 - S / 2, 0, w - S);
  const outsideSides = [
    { left: bx1 + G,     top: vCenter,     room: w - bx1, fits: bx1 + G + S <= w },
    { left: bx0 - G - S, top: vCenter,     room: bx0,     fits: bx0 - G - S >= 0 },
    { left: hCenter,     top: by1 + G,     room: h - by1, fits: by1 + G + S <= h },
    { left: hCenter,     top: by0 - G - S, room: by0,     fits: by0 - G - S >= 0 },
  ];
  let chosen = outsideSides.find((s) => s.fits);
  if (!chosen) {
    // No side has room OUTSIDE the frame (a wide-FOV shot's bbox can span most of the canvas) -
    // the user's own explicit allowance: "u širokoúhlých fotek může být náhled i uvnitř rámu, jen
    // nesmí překrývat hranice" (may sit INSIDE the frame there, as long as it doesn't overlap the
    // boundary itself). Centred on the frame's own true centre point - maximally far from all 4
    // corner brackets for a reasonably-proportioned wide frame - kept on-screen, then checked
    // against every bracket segment via exact line-vs-box intersection, not just assumed clear.
    const insideLeft = clamp(centerProj.x - S / 2, 0, w - S);
    const insideTop = clamp(centerProj.y - S / 2, 0, h - S);
    const insideRight = insideLeft + S, insideBottom = insideTop + S;
    const hitsABracket = bracketSegments.some(([x0, y0, x1, y1]) =>
      _segIntersectsBox(x0, y0, x1, y1, insideLeft, insideTop, insideRight, insideBottom));
    if (!hitsABracket) chosen = { left: insideLeft, top: insideTop };
  }
  if (!chosen) {
    // Last resort - neither an outside side nor the centred-inside placement worked (frame too
    // small/narrow even for that, or an odd enough shape that the centre still clips a bracket) -
    // still placed outside the bbox on whichever side has the most room, just possibly clipped by
    // the canvas edge in this rare case - the same trade-off this whole fallback chain has always
    // made: never re-overlap the frame's own boundary to force an on-screen fit.
    chosen = outsideSides.reduce((a, b) => (b.room > a.room ? b : a));
  }
  el.style.left = chosen.left + 'px';
  el.style.top = chosen.top + 'px';
  el.style.display = 'block';
}
document.getElementById('nightSkyFrameThumb').addEventListener('click', () => {
  if (_nightSkyActiveFrame) _nightSkyOpenPhotoModal(_nightSkyActiveFrame.full);
});

// Fullscreen photo modal - same pattern/CSS as Eclipse's own gallery modal
// (_eclipseOpenGalleryModal/_eclipseCloseGalleryModal, js/render-eclipse.js), sharing the
// .photo-modal/.photo-modal-body/.photo-modal-img/.photo-modal-close CSS classes but with its own
// #nightSkyGalleryModal id/DOM (index.html) for this file's own JS to target independently.
function _nightSkyOpenPhotoModal(src) {
  document.getElementById('nightSkyGalleryModalImg').src = src;
  document.getElementById('nightSkyGalleryModal').classList.add('visible');
}
function _nightSkyClosePhotoModal() {
  document.getElementById('nightSkyGalleryModal').classList.remove('visible');
  document.getElementById('nightSkyGalleryModalImg').src = '';   // release the (possibly large) image once closed
}
document.getElementById('btnNightSkyGalleryModalClose').addEventListener('click', _nightSkyClosePhotoModal);
document.getElementById('nightSkyGalleryModal').addEventListener('click', (e) => {
  if (e.target.id === 'nightSkyGalleryModal') _nightSkyClosePhotoModal();   // backdrop click only
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('nightSkyGalleryModal').classList.contains('visible')) _nightSkyClosePhotoModal();
});

function _nightSkyDrawPlanetarium(ctx, w, h) {
  if (!_skyDataLoaded) {
    ctx.fillStyle = '#8899aa';
    ctx.font = '14px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Night Sky – loading data…', w / 2, h / 2);
    document.getElementById('nightSkyFrameThumb').style.display = 'none';
    return;
  }

  _nightSkyUpdatePlanetCamera();
  const layout = _nightSkyPlanetLayout(w, h);
  _nightSkyDrawPlanetSkyGround(ctx, layout, w, h);

  const showGrid = document.getElementById('chkNightSkyGrid').checked;
  const showEquatorial = document.getElementById('chkNightSkyEquatorial').checked;
  const showEcliptic = document.getElementById('chkNightSkyEcliptic').checked;
  const showHorizon = document.getElementById('chkNightSkyHorizon').checked;
  const showLines = document.getElementById('chkNightSkyLines').checked;
  const showNames = document.getElementById('chkNightSkyNames').checked;
  const showStars = document.getElementById('chkNightSkyStars').checked;
  const showSun = document.getElementById('chkNightSkySun').checked;

  if (showGrid) _nightSkyDrawPlanetGrid(ctx, layout);
  if (showEquatorial) _nightSkyDrawPlanetEquatorialGrid(ctx, layout);
  if (showEcliptic) _nightSkyDrawPlanetEcliptic(ctx, layout);
  if (showLines || showNames) _nightSkyDrawPlanetConstellations(ctx, layout, showLines, showNames);
  if (showStars) _nightSkyDrawPlanetStars(ctx, layout);
  if (showSun && showNightSkySunPath) _nightSkyDrawPlanetSunPath(ctx, layout);
  if (showSun) _nightSkyDrawPlanetSun(ctx, layout);
  if (showHorizon) _nightSkyDrawPlanetHorizon(ctx, layout);
  _nightSkyDrawCatalogFrame(ctx, layout);
  _nightSkyUpdateFrameThumb(layout, w, h);
}

// Drag-to-look-around (mouse + touch, via Pointer Events - same setPointerCapture pattern as the
// time strip's own drag handling above) + mouse-wheel-to-zoom, both active only while Night Sky is
// showing and Planetarium is the selected sub-mode. Axis sense/constants match Sky Dome's own
// Planetarium drag block (render-skydome.js) exactly, so the two views feel identical to use.
(function () {
  const cv = document.getElementById('nightSkyCanvas');
  let dragging = false, lastX = 0, lastY = 0;

  function dragStart(x, y) {
    dragging = true;
    lastX = x; lastY = y;
    cv.style.cursor = 'grabbing';
  }
  function dragMove(x, y) {
    if (!dragging) return;
    const dx = x - lastX, dy = y - lastY;
    lastX = x; lastY = y;
    _nightSkyPlanet3D.camAz -= dx * 0.005;
    _nightSkyPlanet3D.camEl = Math.max(0, Math.min(Math.PI / 2 - 0.02, _nightSkyPlanet3D.camEl + dy * 0.004));
    _nightSkyUpdatePlanetCamera();
    drawNightSky();
  }
  function dragEnd() {
    if (!dragging) return;
    dragging = false;
    cv.style.cursor = 'default';
  }

  cv.addEventListener('pointerdown', (e) => {
    if (!nightSkyActive || nightSkySubmode !== 'planetarium') return;
    dragStart(e.clientX, e.clientY);
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic/test events lack a real pointer session */ }
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => dragMove(e.clientX, e.clientY));
  cv.addEventListener('pointerup', dragEnd);
  cv.addEventListener('pointercancel', dragEnd);

  // One tick = one 0.1 zoom step, additive, rounded to avoid float drift - same convention as Sky
  // Dome's own canvas wheel handler.
  cv.addEventListener('wheel', (e) => {
    if (!nightSkyActive || nightSkySubmode !== 'planetarium') return;
    e.preventDefault();
    const step = -Math.sign(e.deltaY) * 0.1;
    setNightSkyPlanetZoom(Math.round((_nightSkyPlanet3D.zoom + step) * 10) / 10);
  }, { passive: false });
})();

// ─── Cursor readout (top info bar: Az/Alt/Dir) ────────────────────────────────────────────────
// Mirrors Sky Dome's own hover readout (handleSkyDomeMouseMove/_skyDomePixelToAzEl,
// render-skydome.js) - same shared #valAz/#valAlt/#valDir elements, populated from the pixel under
// the cursor via each sub-mode's own inverse projection - but WITHOUT that one's Day/Time fields,
// which exist there to solve an "inverse solar calibration" problem (what real date/time would put
// the pinhole's own sun path through this pixel) that has no meaning for Night Sky (a real star
// map, not a calibration tool) - left at their default '—' placeholder instead of repurposed.
function _nightSkyPixelToAzEl(layout, px, py) {
  const dx = px - layout.cx, dy = py - layout.cy;
  const r = Math.hypot(dx, dy);
  if (r > layout.R) return null;
  const el = 90 - 90 * r / layout.R;
  // Same mirrored-x inverse as _skyDomePixelToAzEl's own flat-dome branch - _skyDomePoint (shared
  // by both) draws with dx = -r*sin(az), so recovering az needs atan2(-dx,-dy), not atan2(dx,-dy).
  const az = r < 0.5 ? null : ((Math.atan2(-dx, -dy) * 180 / Math.PI) + 360) % 360;
  return { az, el };
}
// Inverse of _nightSkyPlanetProject - a near-identical version briefly existed for the sky/ground
// shading (eighteenth round), removed once that switched to a vector-path fill; re-added here since
// the cursor readout genuinely needs it: canvas pixel -> world ray direction -> {az,el}. Unlike
// Sky Dome's own _skyDomePlanet3DPixelToAzEl, this does NOT clamp el to >=0 or return null for a
// below-horizon result - Night Sky's own Planetarium deliberately shows the below-horizon "ground"
// (eighteenth round), so hovering over it should report a real negative altitude, not nothing.
function _nightSkyPlanetPixelToAzEl(layout, px, py) {
  const sx = (px - layout.cx) / layout.scale / _nightSkyPlanet3D.FOCAL;
  const sy = -(py - layout.cy) / layout.scale / _nightSkyPlanet3D.FOCAL;
  const theta = Math.hypot(sx, sy);
  if (theta > NIGHTSKY_PLANET_FADE_OUTER) return null;
  const rho = Math.sin(theta), lz = Math.cos(theta);
  const k = theta > 1e-6 ? rho / theta : 1;
  const lx = sx * k, ly = sy * k;
  const R = _nightSkyPlanet3D.RIGHT, U = _nightSkyPlanet3D.UP, F = _nightSkyPlanet3D.FWD;
  const v = [
    lx * R[0] + ly * U[0] + lz * F[0],
    lx * R[1] + ly * U[1] + lz * F[1],
    lx * R[2] + ly * U[2] + lz * F[2],
  ];
  const el = Math.asin(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI;
  const az = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
  return { az, el };
}
function _nightSkyClearReadout() {
  document.getElementById('valAz').textContent = '—';
  document.getElementById('valAlt').textContent = '—';
  document.getElementById('valDir').textContent = '—';
}
(function () {
  const cv = document.getElementById('nightSkyCanvas');
  cv.addEventListener('pointermove', (e) => {
    if (!nightSkyActive) return;
    const dpr = cv._res || 1;
    const rect = cv.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const w = cv.width / dpr, h = cv.height / dpr;
    const layout = nightSkySubmode === 'planetarium' ? _nightSkyPlanetLayout(w, h) : _nightSkyLayout(w, h);
    const hit = nightSkySubmode === 'planetarium'
      ? _nightSkyPlanetPixelToAzEl(layout, px, py)
      : _nightSkyPixelToAzEl(layout, px, py);
    if (!hit) { _nightSkyClearReadout(); return; }
    document.getElementById('valAz').textContent = hit.az !== null ? hit.az.toFixed(1) + '°' : '—';
    document.getElementById('valAlt').textContent = (hit.el >= 0 ? '+' : '') + hit.el.toFixed(1) + '°';
    document.getElementById('valDir').textContent = hit.az !== null ? azimutToDir(hit.az) : '—';
  });
  cv.addEventListener('pointerleave', () => {
    if (!nightSkyActive) return;
    _nightSkyClearReadout();
  });
})();

function drawNightSky() {
  const cv = document.getElementById('nightSkyCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const dpr = cv._res || 1;
  const w = cv.width / dpr, h = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (nightSkySubmode === 'skymap') {
    // The catalog frame/thumbnail are Planetarium-only (Sky Map has no equivalent "camera looking
    // in one direction" concept to center on) - hide the thumbnail rather than leave it stuck
    // showing a stale position from the last Planetarium draw.
    document.getElementById('nightSkyFrameThumb').style.display = 'none';
    _nightSkyDrawSkyMap(ctx, w, h);
  } else if (nightSkySubmode === 'planetarium') {
    _nightSkyDrawPlanetarium(ctx, w, h);
  }
}

// Top-level mode button, a peer of Gallery/Analyzer/Eclipse rather than an Analyzer sub-view -
// same wiring pattern as #btnModeEclipse (render-eclipse.js).
document.getElementById('btnModeNightSky').addEventListener('click', () => {
  if (nightSkyActive) {
    if (typeof enterImageView === 'function') enterImageView();
    return;
  }
  if (currentMode !== 'analyzer') setMode('analyzer');
  enterNightSky();
});

// Display checkboxes just redraw - no state beyond their own checked value (read directly in
// drawNightSky() each time), same "read the checkbox live" approach as Eclipse's Display section.
['chkNightSkyStars', 'chkNightSkyLines', 'chkNightSkyNames', 'chkNightSkyGrid', 'chkNightSkyEquatorial', 'chkNightSkyEcliptic', 'chkNightSkyHorizon']
  .forEach(id => document.getElementById(id).addEventListener('change', () => { if (nightSkyActive) drawNightSky(); }));
