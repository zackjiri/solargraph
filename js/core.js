// ─── Projection constants ────────────────────────────────────────────────────
const R = 33;          // cylinder radius [mm]
const PAPER_W = 178;   // paper width [mm]
const PAPER_H = 127;   // paper height [mm]
const IMG_W = 1280;    // pixels for longer side (scan normalised to this)

let IMG_H = Math.round(IMG_W * PAPER_H / PAPER_W); // ~913
let scale = IMG_W / PAPER_W; // px/mm

// Image centre in pixels
let cx = IMG_W / 2;
let cy;  // set after image load

// Logical drawing size (px), decoupled from the canvas backing store. All projection
// maths and overlays use these; the backing store is logical × canvasRES so the canvas
// renders at (super-)device resolution and text / thin lines stay crisp on HiDPI displays.
let canvasLW  = IMG_W;
let canvasLH  = IMG_H;
let canvasRES = 1;     // supersample factor – set in setupCanvas() from devicePixelRatio

// ─── Pitch rotation: world (β,θ) → local camera coordinates ───────────────
// Pitch p (rad): positive = pinhole tilted toward zenith (can tilted forward/south)
// Rotation Ry(p) around east–west axis (Y-axis):
//   coordinate system: x = south, y = west, z = up
//   Ry(p) rotates in the x–z plane (south–up):
//     x' =  x·cos p + z·sin p
//     y' =  y
//     z' = −x·sin p + z·cos p
function applyPitch(beta_rad, theta_rad, p) {
  if (p === 0) return { b: beta_rad, t: theta_rad };
  const dx =  Math.cos(theta_rad) * Math.cos(beta_rad);  // south
  const dy =  Math.cos(theta_rad) * Math.sin(beta_rad);  // west
  const dz =  Math.sin(theta_rad);                        // up

  // Rotation Ry(p): in south–up plane
  const dx2 = dx * Math.cos(p) + dz * Math.sin(p);
  const dy2 = dy;
  const dz2 = -dx * Math.sin(p) + dz * Math.cos(p);

  const t2 = Math.asin(Math.max(-1, Math.min(1, dz2)));
  const b2 = Math.atan2(dy2, dx2);
  return { b: b2, t: t2 };
}

// Inverse pitch: local → world (used in pixelToAzEl)
function applyPitchInverse(beta_rad, theta_rad, p) {
  return applyPitch(beta_rad, theta_rad, -p);
}

// Roll: rotation around south axis (x), in west–up plane
// rho > 0: top of cylinder leans west (pushed from east); rho < 0: leans east
// Models lateral lean of cylinder axis – horizon becomes sinusoidal, not a straight tilt
function applyRoll(beta_rad, theta_rad, rho) {
  if (rho === 0) return { b: beta_rad, t: theta_rad };
  const dx =  Math.cos(theta_rad) * Math.cos(beta_rad);  // south
  const dy =  Math.cos(theta_rad) * Math.sin(beta_rad);  // west
  const dz =  Math.sin(theta_rad);                        // up

  // Rx(rho): keeps south fixed, rotates west–up plane
  const dy2 =  dy * Math.cos(rho) - dz * Math.sin(rho);
  const dz2 =  dy * Math.sin(rho) + dz * Math.cos(rho);

  const t2 = Math.asin(Math.max(-1, Math.min(1, dz2)));
  const b2 = Math.atan2(dy2, dx);
  return { b: b2, t: t2 };
}

function applyRollInverse(beta_rad, theta_rad, rho) {
  return applyRoll(beta_rad, theta_rad, -rho);
}

// ─── Inverse projection: pixel → (azimuth, elevation) ────────────────────
function pixelToAzEl(px, py) {
  const eCy = getEffectiveCy();
  const sx = (px - cx) / scale;
  const sy = (eCy - py) / scale;

  // Inverse linear horizontal: β = sx / (2·R·hScale)
  // Inverse vertical with cos(β) correction: tan(θ) = sy / (2·R·hScale·cos(β))
  const beta_local  = sx / (2 * R * hScale);
  const theta_local = Math.atan(sy / (2 * R * hScale * Math.cos(beta_local)));

  // Back to world coordinates: inverse pitch then inverse roll
  const p = pitchDeg * Math.PI / 180;
  const { b: b1, t: t1 } = applyPitchInverse(beta_local, theta_local, p);
  const rho = rollDeg * Math.PI / 180;
  const { b: beta_world, t: theta_world } = applyRollInverse(b1, t1, rho);

  const beta_deg  = beta_world  * 180 / Math.PI;
  const theta_deg = theta_world * 180 / Math.PI;

  const azimut_world = ((180 + beta_deg + yawDeg) + 360) % 360;

  return { beta_deg, theta_deg, azimut_world };
}

// ─── Forward projection: world (β, θ) → pixel ─────────────────────────────
// beta_deg: from south, positive = west; theta_deg: elevation
function azElToPixel(beta_deg, theta_deg) {
  const beta_rad  = beta_deg  * Math.PI / 180;
  const theta_rad = theta_deg * Math.PI / 180;

  // Transform world → camera frame: roll first, then pitch
  const rho = rollDeg * Math.PI / 180;
  const { b: b1, t: t1 } = applyRoll(beta_rad, theta_rad, rho);
  const p = pitchDeg * Math.PI / 180;
  let { b: bl, t: tl } = applyPitch(b1, t1, p);

  // Normalize bl to (−π, π] – applyRoll/Pitch early-return when rho/p=0
  // bypasses atan2, so bl may be outside (−π, π) for large yaw offsets.
  if (bl >  Math.PI) bl -= 2 * Math.PI;
  if (bl < -Math.PI) bl += 2 * Math.PI;

  // Guard against ±90° local elevation (tan overflow); full azimuth range is valid
  if (Math.abs(tl) >= Math.PI / 2 - 0.001) return null;

  // Linear horizontal: sx = 2·R·hScale·β
  // Perspective vertical with cos(β) correction: sy = 2·R·hScale·cos(β)·tan(θ)
  const sx = 2 * R * hScale * bl;
  const sy = 2 * R * hScale * Math.cos(bl) * Math.tan(tl);
  const px = cx + sx * scale;
  const py = getEffectiveCy() - sy * scale;

  return { px, py };
}

// ─── Inverse solar calculations ───────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_DAYS  = [31,28,31,30,31,30,31,31,30,31,30,31];

// Convert day-of-year to month/day string e.g. "Mar 15"
function doyToString(doy) {
  doy = ((Math.round(doy) - 1 + 365) % 365) + 1;
  let m = 0, d = doy;
  while (d > MONTH_DAYS[m]) { d -= MONTH_DAYS[m]; m++; }
  return MONTH_NAMES[m] + ' ' + d;
}

// Invert sunDeclination(d) = target (rad) for day-of-year, starting from a closed-form seed based
// on the old plain-sine model (fast, always within ~2-3 days) and polishing with Newton's method
// against the real Kepler-based sunDeclination(). Two iterations are enough - the residual is
// bounded by the near-zero derivative of declination at the solstices (many days share almost the
// same declination there), not by iteration count; more iterations don't shrink it further.
function refineDayFromDeclination(seed, target) {
  let d = seed;
  const h = 0.5;
  for (let i = 0; i < 2; i++) {
    const f  = sunDeclination(d) - target;
    const fp = (sunDeclination(d + h) - sunDeclination(d - h)) / (2 * h);
    if (Math.abs(fp) < 1e-9) break;
    d = d - f / fp;
  }
  return d;
}

// From (azimut_world °, elevation °, lat rad) → { day1, day2, time }
// Returns null if outside valid range
// el_deg is the APPARENT elevation (a pixel of the scan, a point of the Sky Dome) - refraction is
// taken out first, the solving below is geometric.
function inverseSolar(az_world_deg, el_deg, phi_rad) {
  if (el_deg < 0) return null;

  const el  = _skyTrueFromApparentEl(el_deg) * Math.PI / 180;
  // az_south: azimuth measured from south (β), positive = west
  // az_world → az_south = az_world - 180
  const az_south = (az_world_deg - 180) * Math.PI / 180;

  // Declination from spherical trigonometry:
  // sin(δ) = sin(el)·sin(φ) - cos(el)·cos(φ)·cos(az_south)
  // (az_south=0 = south: sun on meridian → δ = el - φ or φ - el)
  const sinDelta = Math.sin(el) * Math.sin(phi_rad)
                 - Math.cos(el) * Math.cos(phi_rad) * Math.cos(az_south);
  if (Math.abs(sinDelta) > 1) return null;
  const delta = Math.asin(sinDelta);

  // Day of year from declination (two solutions: spring and autumn side). Southern hemisphere:
  // sign-flip the target declination (same exact identity as pathDeclination()), not a date shift
  // - solves directly for the real, unshifted day. Seeded via the old closed-form linear-time
  // formula, then refined against the real Kepler-based sunDeclination() (see
  // refineDayFromDeclination() above) since that formula has no closed-form inverse.
  const maxDecl = 23.44 * Math.PI / 180;   // seed range only (obliquity of date, 2026: 23.436 deg)
  const target = hemisphere >= 0 ? delta : -delta;
  if (Math.abs(target) > maxDecl) return null;
  const sinArg = target / maxDecl;
  const angle  = Math.asin(sinArg); // −π/2 .. π/2, seed only

  // Two seed solutions in [1,365]:
  // d1 = 81 + angle·365/(2π)        (spring side)
  // d2 = 81 + (π − angle)·365/(2π)  (autumn side)
  const d1 = refineDayFromDeclination(81 + angle * 365 / (2 * Math.PI), target);
  const d2 = refineDayFromDeclination(81 + (Math.PI - angle) * 365 / (2 * Math.PI), target);

  // Hour angle H from el/phi/delta:
  // cos(H) = (sin(el) - sin(φ)·sin(δ)) / (cos(φ)·cos(δ))
  const cosH = (Math.sin(el) - Math.sin(phi_rad) * sinDelta)
             / (Math.cos(phi_rad) * Math.cos(delta));
  if (Math.abs(cosH) > 1) return null;
  let H = Math.acos(cosH); // 0..π
  // Afternoon: sun west of south on N, east of north on S
  // az_south > 0 means west of south (afternoon on N, morning on S)
  const westOfSouth = az_south > 0;
  if (hemisphere >= 0) {
    if (westOfSouth) H = -H;  // N: west = afternoon
  } else {
    if (!westOfSouth) H = -H; // S: east = afternoon (opposite)
  }

  // Solar time: H=0 → noon
  const solarHour = 12 - H * 180 / Math.PI / 15;
  if (solarHour < 0 || solarHour > 24) return null;

  // Raw day-of-year integers (same wrap-to-[1,365] rule doyToString applies internally).
  const doy1 = ((Math.round(d1) - 1 + 365) % 365) + 1;
  const doy2 = ((Math.round(d2) - 1 + 365) % 365) + 1;

  // Reproject through the selected time-display convention (True/Mean/Standard), same as every
  // other printed clock reading in the project (syncSunTimeUI's slider label, drawSunArc's hourly
  // dots, Sky Dome's own hour labels) - solarHour itself is the true-solar hour angle and doesn't
  // depend on which day-solution is picked (H is identical for d1/d2 by construction), but the EoT
  // correction displayHour() applies does vary by real calendar day. day1 (spring side) is used as
  // the reference here, same default the H1/H2 CHMI rule falls back to when nothing else resolves
  // the ambiguity (_chmiReadoutPreferredDoy) - day1/day2 can very rarely differ by a minute or two
  // in Mean/Standard mode as a result, same inherent ambiguity the Day field already shows openly.
  // fmtSolarTime (render-3d.js) rounds to the nearest minute (with 59→60 carry) - same formatter
  // the slider label/rise-set labels use, so this always matches them exactly instead of drifting
  // by a minute from an independent floor().
  const shownHour = displayHour(solarHour, doy1);
  const timeStr = fmtSolarTime(shownHour);

  return {
    day1: doyToString(d1),
    day2: doyToString(d2),
    time: timeStr,
    // doy1/doy2 and the unrounded true-solar hour, for callers that need to look something up by
    // day/hour (e.g. the SSV10M/T readout, §Info panel) rather than just display day1/day2/time.
    doy1: doy1,
    doy2: doy2,
    hourTrue: solarHour,
  };
}
function azimutToDir(az) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const idx = Math.round(az / 22.5) % 16;
  return dirs[idx];
}

// ─── Solar position calculations ──────────────────────────────────────────
let LAT = 50.0;        // latitude °N, precision 0.5°
let hemisphere = 1;    // +1 = northern, -1 = southern
let LONG = 15.0;         // longitude magnitude 0-180°, precision 0.1° (mirrors LAT/hemisphere)
let lonHemisphere = 1;   // +1 = East, -1 = West
let timeZoneHours = 1;   // UTC offset [h], decimal (step 0.25 = 15 min), range -12..+14

// Effective latitude: clamp poles and equator to avoid singularities
function effectiveLat() {
  const lat = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;
  return lat * Math.PI / 180;
}

// ─── Shared astronomy (Julian Date, Meeus Sun, refraction) ──────────────────────────────────────
// Used by BOTH halves of the app - the Solargraph views (sunDeclination/equationOfTimeMin/
// sunPosition below) and Night Sky (render-nightsky.js, render-moon.js) - so a given date, time and
// place gives the same Sun everywhere. Lives here because core.js loads first and the Solargraph
// views draw on load. (Names keep the _sky/_moon prefixes of the files they came from.)

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

const _MOON_D2R = Math.PI / 180;

function _moonNorm360(x) { return ((x % 360) + 360) % 360; }

// deltaT = TT - UT in seconds (Espenak & Meeus polynomial, valid 2005-2050).
function _moonDeltaTSec(year) {
  const t = year - 2000;
  return 62.92 + 0.32217 * t + 0.005589 * t * t;
}

// Julian Ephemeris Day (TT) for a UT instant.
function _moonJDE(year, month, day, hourUT) {
  return _skyToJulianDateUT(year, month, day, hourUT) + _moonDeltaTSec(year) / 86400;
}

// Mean obliquity of the ecliptic of date, degrees (Meeus 22.2).
function _moonMeanObliquityDeg(jde) {
  const T = (jde - 2451545.0) / 36525;
  return 23.439291111 - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
}

// Ecliptic (lambda, beta) -> equatorial (ra, dec), all degrees, for obliquity eps (Meeus 13.3/13.4).
function _moonEclToEq(lambda, beta, epsDeg) {
  const l = lambda * _MOON_D2R, b = beta * _MOON_D2R, e = epsDeg * _MOON_D2R;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra: _moonNorm360(ra / _MOON_D2R), dec: dec / _MOON_D2R };
}

// Geocentric Sun, low-precision (Meeus ch. 25, ~0.01 deg): apparent ecliptic longitude referred to
// the mean equinox of date (aberration applied, nutation left out - ~17", and in the Moon's phase and
// age it would be added to both bodies and cancel), the mean longitude L0 (for the equation of time)
// and the distance in km. The ONE Sun of the whole app: Night Sky (_nightSkySunAzEl), the Moon's
// phase/age (render-moon.js) and the Solargraph views (sunDeclination/equationOfTimeMin below).
function _skySunEclipticOfDate(jde) {
  const T = (jde - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * _MOON_D2R;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const nu = M + C * _MOON_D2R;
  const rAU = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(nu));
  return { lambda: _moonNorm360(L0 + C - 0.00569), L0: _moonNorm360(L0), dist: rAU * 149597870.7 };
}

// Atmospheric refraction, degrees, for a TRUE altitude hTrue (degrees): Saemundsson's formula (Meeus
// 16.4, standard 1010 hPa / 10 degC), R = 1.02' / tan(h + 10.3/(h + 5.11)). ~0.57 deg at the horizon,
// 0.09 deg at 10 deg, under 0.02 deg above 45 deg, 0 at the zenith. The formula holds down to about
// -1 deg; below that (what is still drawn under the horizon - Night Sky's Planetarium ground and the
// frame of a low photo, a Solargraph path's run-out) refraction is faded linearly to 0 at -3 deg,
// which keeps true -> apparent monotonic (slope >= 0.68) and so exactly invertible.
const SKY_REFR_FADE_TOP = -1, SKY_REFR_FADE_BOTTOM = -3;

function _skySaemundssonDeg(h) {
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * Math.PI / 180) / 60;
}

function _skyRefractionDeg(hTrue) {
  if (hTrue >= 90) return 0;
  if (hTrue >= SKY_REFR_FADE_TOP) return Math.max(0, _skySaemundssonDeg(hTrue));
  if (hTrue <= SKY_REFR_FADE_BOTTOM) return 0;
  return _skySaemundssonDeg(SKY_REFR_FADE_TOP) * (hTrue - SKY_REFR_FADE_BOTTOM) / (SKY_REFR_FADE_TOP - SKY_REFR_FADE_BOTTOM);
}

// Apparent altitude -> true altitude: the exact inverse of hTrue + _skyRefractionDeg(hTrue), by
// Newton steps on that same function (not Bennett's separate formula, which would disagree with it
// by up to ~4" and make a picked point drift off centre).
function _skyTrueFromApparentEl(hApp) {
  let h = hApp - _skyRefractionDeg(hApp);
  for (let i = 0; i < 6; i++) {
    const f = h + _skyRefractionDeg(h) - hApp;
    if (Math.abs(f) < 1e-9) break;
    const d = 1e-4, fp = 1 + (_skyRefractionDeg(h + d) - _skyRefractionDeg(h - d)) / (2 * d);
    h -= f / fp;
  }
  return h;
}

// Semi-diameter of the Sun, degrees: 959.63" at 1 AU (Meeus ch. 55).
function _skySunSemiDiamDeg(year, month, day, hourUT) {
  const rAU = _skySunEclipticOfDate(_moonJDE(year, month, day, hourUT)).dist / 149597870.7;
  return 959.63 / 3600 / rAU;
}
// Rise and set, the standard (almanac) rule for the whole app: a body is up while its UPPER LIMB,
// refracted, is above the horizon. The refraction is taken at the limb itself (the limb sits on the
// apparent horizon at true altitude SKY_HORIZON_TRUE_ALT = -0.575 deg, 34.4'), so the centre's true
// altitude at rise/set is -0.575 deg minus the semi-diameter: -0.841 deg for the Sun, within 0.008
// deg (~3 s) of USNO's -0.8333 deg (their fixed 34' + 16'). Night Sky's disc visibility and rise/set
// search and the Solargraph views' sunrise/sunset/day length (solarRiseSet) all use it.
const SKY_HORIZON_TRUE_ALT = _skyTrueFromApparentEl(0);
function skyUpperLimbApparentEl(elTrueCentre, semiDeg) {
  const limb = elTrueCentre + semiDeg;
  return limb + _skyRefractionDeg(limb);
}
// The Sun's centre true altitude at sunrise/sunset for its mean semi-diameter (16.0') - the fixed
// threshold the Sun Graph's day band and Night Sky's twilight band use (solarRiseSet's own times
// take each day's real semi-diameter, 15.7'-16.3', a difference of at most ~2 s).
const SUN_HORIZON_ALT_DEG = SKY_HORIZON_TRUE_ALT - 959.63 / 3600;

// ─── True / Mean / Standard solar time ─────────────────────────────────────
// Three time conventions, display-only (never fed back into geometry - hDeg/pixel positions
// always stay driven by TRUE solar hour angle, per the project's own photographic-fidelity rule):
//   true solar time    - H=0 is noon, by definition; what the app has always computed natively.
//   mean solar time    - true solar time corrected by the equation of time (day-of-year only).
//   standard time       - mean solar time corrected by longitude vs. the timezone's own reference
//                         meridian (chosenZone × 15°) plus the chosen whole/quarter-hour zone.
let timeDisplayMode = 'standard';   // 'true' | 'mean' | 'standard' - default per product decision

// ─── Calendar year of the Solargraph views ─────────────────────────────────────────────────────
// The Solargraph views work in day-of-year (365-day table, dayOfYear()); the Sun itself comes from
// the same Meeus series as Night Sky (_skySunEclipticOfDate), which needs a real calendar date. The
// year for a day-of-year: a Gallery image's own exposure dates (currentExposure, controls.js - an
// exposure crossing New Year gives its days from the start day on the start year, the rest the end
// year), otherwise the Analyzer's Year field (solarYear, default the current year). Feb 29 of a
// leap year has no day-of-year of its own in the 365-day table and is simply skipped.
let solarYear = new Date().getFullYear();
// The shown Gallery image's exposure {startDoy, endDoy, startYear, endYear} | null - set by
// controls.js (setCurrentExposureFromGallery, loadImage). Declared here, before anything can draw.
let currentExposure = null;
function solarYearForDoy(doy) {
  const exp = typeof currentExposure !== 'undefined' ? currentExposure : null;
  if (exp && exp.startYear) {
    if (exp.startYear === exp.endYear) return exp.startYear;
    return doy >= exp.startDoy ? exp.startYear : exp.endYear;
  }
  return solarYear;
}
// Julian Ephemeris Day for a (possibly fractional) day-of-year at a UT hour, in its solar year.
function _solarJDE(doy, hourUT, year) {
  const n = Math.floor(doy), frac = doy - n;
  const w = ((n - 1) % 365 + 365) % 365 + 1;   // wrap into 1..365 (refineDayFromDeclination probes past the ends)
  let m = 0, d = w;
  while (d > MONTH_DAYS[m]) { d -= MONTH_DAYS[m]; m++; }
  const y = year !== undefined ? year : solarYearForDoy(w);
  return _moonJDE(y, m + 1, d, hourUT) + frac;
}
// UT of local mean noon (12:00 mean solar time at this longitude) - the instant the per-day Sun
// values below are taken at, the middle of the day's path.
function _solarNoonUT() {
  return 12 - (lonHemisphere * LONG) / 15;
}
// Sun at local noon of a day-of-year: {dec (rad), eotMin}. Declination from Meeus ch. 25 of date
// (same as Night Sky); equation of time (Meeus 28.3) E = L0 - 0.0057183 deg - RA, the true minus
// the mean solar time, nutation left out (<~1 s). Cached per day, year and longitude - the Sun
// Graph asks for all 365 days on every redraw.
const _solarNoonCache = new Map();
// The Sun at one instant: {dec (rad), eotMin, semiDeg}.
function _solarSunAtJDE(jde) {
  const sun = _skySunEclipticOfDate(jde);
  const eq = _moonEclToEq(sun.lambda, 0, _moonMeanObliquityDeg(jde));
  let e = sun.L0 - 0.0057183 - eq.ra;
  e = ((e + 180) % 360 + 360) % 360 - 180;
  return { dec: eq.dec * Math.PI / 180, eotMin: e * 4, semiDeg: 959.63 / 3600 / (sun.dist / 149597870.7) };
}
function _solarNoonSun(doy, year) {
  const y = year !== undefined ? year : solarYearForDoy(Math.round(doy));
  const key = doy + '|' + y + '|' + (lonHemisphere * LONG);
  let v = _solarNoonCache.get(key);
  if (v) return v;
  v = _solarSunAtJDE(_solarJDE(doy, _solarNoonUT(), y));
  if (_solarNoonCache.size > 5000) _solarNoonCache.clear();
  _solarNoonCache.set(key, v);
  return v;
}

// Equation of time [minutes]: true (apparent) solar time minus mean solar time, for the day's own
// solar year (Meeus, _solarNoonSun). Day-of-year only - constant across one calendar day, the real
// drift is under ~30 s a day. year: optional override (the Eclipse module passes its event's).
function equationOfTimeMin(doy, year) {
  return _solarNoonSun(doy, year).eotMin;
}

function meanFromTrue(trueHour, doy, eotMin) { return trueHour - (eotMin !== undefined ? eotMin : equationOfTimeMin(doy)) / 60; }
function trueFromMean(meanHour, doy) { return meanHour + equationOfTimeMin(doy) / 60; }

function standardFromMean(meanHour) {
  const longSigned = lonHemisphere * LONG;
  return meanHour - (longSigned - timeZoneHours * 15) / 15;
}
function meanFromStandard(standardHour) {
  const longSigned = lonHemisphere * LONG;
  return standardHour + (longSigned - timeZoneHours * 15) / 15;
}

function standardFromTrue(trueHour, doy, eotMin) { return standardFromMean(meanFromTrue(trueHour, doy, eotMin)); }
function trueFromStandard(standardHour, doy) { return trueFromMean(meanFromStandard(standardHour), doy); }

// Dispatcher for anything that DISPLAYS a time number (labels, readouts, axis ticks) - picks the
// conversion per the current mode. Never call this to compute a pixel position or hour angle;
// geometry stays in true solar time always (the Sun Graph's yearly view is the one exception -
// see render-sungraph.js, which reprojects its own geometry rather than just relabeling).
// eotMin: optional equation of time for the exact instant (solarRiseSet's eotRise/eotSet), instead
// of the day's noon value.
function displayHour(trueHour, doy, eotMin) {
  if (timeDisplayMode === 'mean') return meanFromTrue(trueHour, doy, eotMin);
  if (timeDisplayMode === 'standard') return standardFromTrue(trueHour, doy, eotMin);
  return trueHour;
}

// Same dispatcher, but for values natively in STANDARD time (e.g. CHMI's own hour field, see
// _sgEnsureChmiByDoy) - used only in Mean/Standard display mode, since CHMI is hidden entirely
// in True solar time mode (see render-sungraph.js / render-2d.js CHMI gating).
function displayHourFromStandard(standardHour, doy) {
  if (timeDisplayMode === 'true') return trueFromStandard(standardHour, doy);
  if (timeDisplayMode === 'mean') return meanFromStandard(standardHour);
  return standardHour;
}

// Solar declination (rad) for day-of-year d (1 = Jan 1) at local noon: Meeus ch. 25 of date for the
// day's solar year (solarYearForDoy) - the same Sun Night Sky draws, ~0.01 deg. Replaces the app's
// earlier year-less model (equation of centre on a 365-day circle, obliquity 23.45 deg, 0.1-0.3 deg
// off), under which the same day and place gave sunrise/sunset times 1-2 min apart from Night Sky's.
// year: optional override (the Eclipse module passes its event's).
function sunDeclination(dayOfYear, year) {
  return _solarNoonSun(dayOfYear, year).dec;
}

// Sunrise/sunset of a day-of-year for the current Location, in TRUE solar hours: {rise, set,
// polarDay, polarNight}. Standard rule (upper limb, refracted - see SKY_HORIZON_TRUE_ALT). The
// declination and semi-diameter are taken at the event itself, not at noon - near the equinoxes
// the declination moves 0.4 deg a day, which at noon alone would put the times ~20 s off; two
// refinement steps bring them to under a second of Night Sky's own search.
function solarRiseSet(doy) {
  const phi = effectiveLat() * hemisphere;
  const sphi = Math.sin(phi), cphi = Math.cos(phi);
  const lonE = lonHemisphere * LONG;
  const eot = equationOfTimeMin(doy);
  const at = (trueHour) => {
    const v = _solarSunAtJDE(_solarJDE(doy, trueHour - eot / 60 - lonE / 15));
    return { dec: v.dec, h0: (SKY_HORIZON_TRUE_ALT - v.semiDeg) * Math.PI / 180, eotMin: v.eotMin };
  };
  const halfWidth = ({ dec, h0 }) => {
    const X = (Math.sin(h0) - sphi * Math.sin(dec)) / (cphi * Math.cos(dec));
    if (X <= -1) return 12;
    if (X >= 1) return 0;
    return Math.acos(X) * 12 / Math.PI;
  };
  const w0 = halfWidth(at(12));
  if (w0 >= 12) return { rise: 0, set: 24, polarDay: true, polarNight: false, eotRise: eot, eotSet: eot };
  if (w0 <= 0) return { rise: 12, set: 12, polarDay: false, polarNight: true, eotRise: eot, eotSet: eot };
  let rise = 12 - w0, set = 12 + w0;
  for (let i = 0; i < 2; i++) {
    rise = 12 - Math.min(12, halfWidth(at(rise)));
    set = 12 + Math.min(12, halfWidth(at(set)));
  }
  // The equation of time AT each event (it drifts up to ~30 s a day), for displayHour's clock
  // conversion - with the day's noon value the clock times would be up to ~5 s off.
  return { rise, set, polarDay: false, polarNight: false, eotRise: at(rise).eotMin, eotSet: at(set).eotMin };
}

// "Path" convention (2D canvas Sun's-paths/Custom-date arcs - see drawSunArc() below - plus the
// Sun Graph's year-wide on-paper overlay and the 3D panel's paper-surface sun path): these always
// use a POSITIVE latitude, so the pinhole's culmination side stays fixed at the image centre
// regardless of true hemisphere. sunPosition(H,δ,φ) ≡ sunPosition(H,−δ,−φ) exactly (flipping the
// sign of both leaves elevation and azimuth unchanged), so negating the REAL day's declination
// reproduces a real southern-hemisphere sky exactly through that always-positive latitude, with
// no error beyond sunDeclination()'s own. This replaces the old "shift the calendar date by ~182
// days and look up ITS declination" trick (customArcDate(), now removed) - which only
// approximated the negation, since Earth's elliptical orbit means the date with truly opposite
// declination isn't exactly half a year away (see the sunDeclination() note above). It also fixes
// a real, separate bug that shift was masking: the southern-hemisphere winter/summer solstice
// swap in drawAllSunArcs() picks the right real month, but without also negating its declination
// the "winter" curve came out as the near-zenith (summer-shaped) one and vice versa - confirmed
// empirically (noon elevation ~83° for "winter" vs. ~37° for "summer" at 30°S).
function pathDeclination(dayOfYear) {
  const d = sunDeclination(dayOfYear);
  return hemisphere >= 0 ? d : -d;
}

// Day of year for given month/day
function dayOfYear(month, day) {
  const daysInMonth = [0,31,28,31,30,31,30,31,31,30,31,30,31];
  let d = day;
  for (let m = 1; m < month; m++) d += daysInMonth[m];
  return d;
}

// ── CHMI measured sunshine (SSV10M, seconds of sunshine per 10-min sample) ────────────────────
// Shared by the Sun Graph (render-sungraph.js) and the 2D Custom Path overlay (render-2d.js).
// Black→yellow gradient (see project notes): dark = little/no measured sun, gold = full 10 min.
const _SG_CHMI_STOPS = [
  [0,   [0x11, 0x0F, 0x08]],
  [150, [0x4F, 0x41, 0x17]],
  [300, [0xA5, 0x83, 0x1D]],
  [450, [0xE8, 0xA0, 0x20]],
  [600, [0xFF, 0xD2, 0x4D]],
];
function _sgChmiColor(sec, alpha) {
  const s = Math.max(0, Math.min(600, sec));
  let i = 0;
  while (i < _SG_CHMI_STOPS.length - 2 && s > _SG_CHMI_STOPS[i + 1][0]) i++;
  const [s0, c0] = _SG_CHMI_STOPS[i], [s1, c1] = _SG_CHMI_STOPS[i + 1];
  const t = (s1 === s0) ? 0 : (s - s0) / (s1 - s0);
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ── CHMI element switch (Display section - controls.js) ───────────────────────────────────────
// null/'' = base SSV10M (sunshine) is active. Any other value names the extra per-image dataset
// (chmi/GEN-X_Y_<code>.json, declared via the image's filelist.json "chmi_extra") shown instead -
// on the 2D canvas AND the Sun Graph (both main diagram and custom-date strip), which both resolve
// the actual data through _chmiActiveDataset() below and the colour through _chmiActiveColor().
let chmiActiveElement = null;

// Whichever dataset the Display element switch has active right now - the extra one (e.g.
// temperature) if chmiActiveElement names it and it loaded successfully for the current image,
// else always the base SSV10M dataset. Shared by the 2D canvas (render-2d.js) and the Sun Graph
// (_sgEnsureChmiByDoy() below) - same switch, same resolved dataset, wherever it's rendered.
function _chmiActiveDataset() {
  if (chmiActiveElement && typeof currentChmiExtra !== 'undefined' && currentChmiExtra
      && currentChmiExtra.element === chmiActiveElement) {
    return currentChmiExtra;
  }
  return (typeof currentChmi !== 'undefined') ? currentChmi : null;
}

// Official ČHMÚ "Aktuální teplota" map legend (namerena-data/data-z-mericich-stanic/aktualni-
// teplota) - 45 discrete 2 °C bands (wider at both ends), NOT interpolated, reproduced verbatim
// rather than smoothed into a gradient like _sgChmiColor's 5 stops. Ascending by upper bound;
// a value picks the first band whose upper bound it doesn't exceed, clamped to [-50, 60].
const _CHMI_TEMP_BANDS = [
  [-40, '#FFFFFF'], [-38, '#F4F7F7'], [-36, '#DAE5E5'], [-34, '#C1D3D3'], [-32, '#A7C1C1'],
  [-30, '#8EAEAE'], [-28, '#A69AAE'], [-26, '#8E8094'], [-24, '#76657A'], [-22, '#5D4A5F'],
  [-20, '#453045'], [-18, '#320057'], [-16, '#3F0B81'], [-14, '#4C16AB'], [-12, '#5A22D5'],
  [-10, '#672DFF'], [-8,  '#0051FF'], [-6,  '#007CFF'], [-4,  '#00A7FF'], [-2,  '#00D1FF'],
  [0,   '#00FCFF'], [2,   '#66BF20'], [4,   '#86CD20'], [6,   '#A5DA20'], [8,   '#C4E820'],
  [10,  '#E4F520'], [12,  '#FFFF80'], [14,  '#FFE660'], [16,  '#FFCD40'], [18,  '#FFB320'],
  [20,  '#FF9A00'], [22,  '#FF6E00'], [24,  '#EE5200'], [26,  '#DD3700'], [28,  '#CD1C00'],
  [30,  '#BC0000'], [32,  '#950021'], [34,  '#AF004A'], [36,  '#CA0074'], [38,  '#E4009D'],
  [40,  '#FF00C7'], [42,  '#FF6AE2'], [44,  '#FF8BE2'], [46,  '#FFABE2'], [60,  '#FFCCE2'],
];
function _hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}
function _chmiTempColor(tempC, alpha) {
  const t = Math.max(-50, Math.min(60, tempC));
  for (const [upper, hex] of _CHMI_TEMP_BANDS) {
    if (t <= upper) return _hexToRgba(hex, alpha);
  }
  return _hexToRgba(_CHMI_TEMP_BANDS[_CHMI_TEMP_BANDS.length - 1][1], alpha);
}

// Dispatches to the right gradient for whichever element the Display switch has active - shared
// by the 2D canvas (render-2d.js) and the Sun Graph (render-sungraph.js); _sgChmiColor() itself
// is still called directly wherever a drawing is hardcoded to the base sunshine gradient only.
function _chmiActiveColor(value, alpha) {
  if (chmiActiveElement === 'T') return _chmiTempColor(value, alpha);
  return _sgChmiColor(value, alpha);
}

// Shared bucketing core: raw UTC [iso, value|null] pairs -> STANDARD-TIME day-of-year ->
// [[hourFloat, value], ...] (UTC -> standard time is a pure whole/quarter-hour shift via
// timeZoneHours - no longitude involved; that only enters later, converting standard time to
// true/mean solar time for alignment against the model - see standardFromTrue() etc.). Used by
// both _sgEnsureChmiByDoy() below (always the base SSV10M dataset) and render-2d.js's own
// image-switch-aware equivalent - same shift logic works for any measured quantity.
function _chmiBucketByDoy(values, tzHours) {
  const byDoy = new Map();
  const offMs = tzHours * 3600000;
  for (const [iso, val] of values) {
    const local = new Date(Date.parse(iso) + offMs);
    // Reading UTC getters off the shifted instant yields the local wall-clock date/time fields.
    const doy  = dayOfYear(local.getUTCMonth() + 1, local.getUTCDate());
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    if (!byDoy.has(doy)) byDoy.set(doy, []);
    byDoy.get(doy).push([hour, val]);
  }
  return byDoy;
}

// Buckets whichever dataset the Display element switch has active (_chmiActiveDataset() - base
// SSV10M, or the extra per-image dataset once switched to it) for the Sun Graph - cached on
// (dataset identity, timeZoneHours), since the zone control can change live without the data
// itself changing, and the identity check alone already invalidates on an element-switch flip.
let _sgChmiByDoy = null, _sgChmiSrc = null, _sgChmiZone = null;
function _sgEnsureChmiByDoy() {
  const src = _chmiActiveDataset();
  if (!src) { _sgChmiSrc = null; _sgChmiByDoy = null; return null; }
  if (_sgChmiSrc === src && _sgChmiZone === timeZoneHours) return _sgChmiByDoy;
  _sgChmiSrc = src;
  _sgChmiZone = timeZoneHours;
  _sgChmiByDoy = _chmiBucketByDoy(src.values, timeZoneHours);
  return _sgChmiByDoy;
}

// ── SSV10M/T readout (top info bar, §Info panel) ──────────────────────────────────────────────
// Unlike _sgEnsureChmiByDoy() above (always whichever ONE dataset the element switch has active),
// the readout wants SSV10M and the extra element (T, when this image has one) at the same time
// regardless of the switch state - so each dataset gets its own independent bucket cache, mirroring
// the same (dataset identity, timeZoneHours) invalidation rule.
let _roChmiByDoy = null, _roChmiByDoySrc = null, _roChmiByDoyZone = null;
function _roChmiEnsureByDoy() {
  if (typeof currentChmi === 'undefined' || !currentChmi) { _roChmiByDoySrc = null; _roChmiByDoy = null; return null; }
  if (_roChmiByDoySrc === currentChmi && _roChmiByDoyZone === timeZoneHours) return _roChmiByDoy;
  _roChmiByDoySrc = currentChmi;
  _roChmiByDoyZone = timeZoneHours;
  _roChmiByDoy = _chmiBucketByDoy(currentChmi.values, timeZoneHours);
  return _roChmiByDoy;
}
let _roChmiExtraByDoy = null, _roChmiExtraByDoySrc = null, _roChmiExtraByDoyZone = null;
function _roChmiExtraEnsureByDoy() {
  if (typeof currentChmiExtra === 'undefined' || !currentChmiExtra) { _roChmiExtraByDoySrc = null; _roChmiExtraByDoy = null; return null; }
  if (_roChmiExtraByDoySrc === currentChmiExtra && _roChmiExtraByDoyZone === timeZoneHours) return _roChmiExtraByDoy;
  _roChmiExtraByDoySrc = currentChmiExtra;
  _roChmiExtraByDoyZone = timeZoneHours;
  _roChmiExtraByDoy = _chmiBucketByDoy(currentChmiExtra.values, timeZoneHours);
  return _roChmiExtraByDoy;
}

// Whether the currently-selected gallery generation's own label names it as an 'H2' (second-half-
// of-year) shoot - the exposure actually happened on the autumn-side day of any day1/day2 pair, not
// the spring-side default. Not derivable from the CHMI data itself, a rule tied purely to the
// generation label (user-specified convention, see filelist.json's generation labels, e.g.
// "2025_H2_GEN-I"). False (spring side, doy1) if the label names neither half or nothing is loaded.
function _chmiReadoutPrefersDay2() {
  const gen = (typeof FILELIST !== 'undefined' && FILELIST && typeof galleryState !== 'undefined' && galleryState)
    ? FILELIST.generations.find(g => g.id === galleryState.genId) : null;
  const label = gen ? gen.label : '';
  return label.includes('H2');
}
// Which of inverseSolar()'s two day solutions (doy1 = spring side, doy2 = autumn side - a given
// Az/Alt matches the sun's position on two calendar days symmetric around a solstice) is the real
// exposure day for THIS image, per _chmiReadoutPrefersDay2() above.
function _chmiReadoutPreferredDoy(doy1, doy2) {
  return _chmiReadoutPrefersDay2() ? doy2 : doy1;
}

// ── Hover readout: colour-code the day1/day2 (and, in Mean/Standard mode, time1/time2) split ──
// §20.35 found that inverseSolar()'s two day solutions share the exact same TRUE solar hour angle
// (by construction - sunPosition(H,δ,φ) only depends on declination/latitude, not which calendar
// day produced that declination) but generally do NOT share the same Mean/Standard clock reading,
// since the equation-of-time correction displayHour() applies is not symmetric about a solstice the
// way declination is - at the equinoxes (day1/day2 six months apart) the two readings can differ by
// upward of 15 minutes, not "a minute or two" as originally assumed. Rather than silently picking
// one, both fields show BOTH values - day1/time1 first, day2/time2 second (H1/H2 order) - and colour
// whichever one actually matches this image's own H1/H2 generation label green (the real exposure
// day), the other dim/grey - same "which one is actually true right now" language the HIT/MISS pill
// (render-3d.js) already uses. Time collapses to a single plain value in True solar time mode, where
// the two readings are identical (nothing to disambiguate) - and does the same in Mean/Standard mode
// on the rare occasion both round to the same printed minute.
const _READOUT_DAY2_GREEN = '#50dc78';   // same green as the HIT pill / Custom Path line
function _readoutDayTimeHtml(sol) {
  if (!sol) return { dayHtml: '—', timeHtml: '—' };
  const prefersDay2 = _chmiReadoutPrefersDay2();
  const col1 = prefersDay2 ? 'var(--dim)' : _READOUT_DAY2_GREEN;
  const col2 = prefersDay2 ? _READOUT_DAY2_GREEN : 'var(--dim)';
  const dayHtml = `<span style="color:${col1}">${sol.day1}</span>`
                + ` / <span style="color:${col2}">${sol.day2}</span>`;

  const t1 = fmtSolarTime(displayHour(sol.hourTrue, sol.doy1));
  const t2 = fmtSolarTime(displayHour(sol.hourTrue, sol.doy2));
  const timeHtml = (t1 === t2)
    ? t1
    : `<span style="color:${col1}">${t1}</span> / <span style="color:${col2}">${t2}</span>`;
  return { dayHtml, timeHtml };
}

// SSV10M is stored as raw seconds of sunshine within the 10-minute sample window (0-600, NOT
// already a fraction or percent - see chmi/*.json's own "unit": "seconds_per_10min" and
// extract-chmi_V2.ps1's unit table) - convert to the percent the readout label promises.
function _chmiReadoutFormatSSV(sec) {
  if (sec === undefined || sec === null) return '—';
  return Math.round(sec / 600 * 100) + '%';
}
function _chmiReadoutFormatT(tempC) {
  if (tempC === undefined || tempC === null) return '—';
  return (tempC >= 0 ? '+' : '') + tempC.toFixed(1) + '°C';
}

// Core SSV10M/T lookup for the readout: true-solar hour + a single resolved real day-of-year ->
// formatted display strings for both fields. Reuses _imgChmiSlotsFor() (render-2d.js, loads after
// this file but only ever CALLED later, at interaction time) for the same hour->10-min-slot mapping
// the 2D canvas's own CHMI overlay already uses, rather than re-deriving it here. A slot present in
// the map but holding `null` (station gap) and a slot simply absent from the map (day outside this
// image's exposure coverage) both correctly fall through to '—' via the formatters above - neither
// needs distinguishing here, matching drawChmiArc's own "both render as no-data" treatment.
function _chmiReadoutValuesAt(trueHour, doy) {
  const standardHour = standardFromTrue(trueHour, doy);
  const slot = ((Math.round(standardHour * 6) % 144) + 144) % 144;

  const ssvByDoy = _roChmiEnsureByDoy();
  const ssvSlots = ssvByDoy ? _imgChmiSlotsFor(ssvByDoy, doy) : null;
  const ssvVal = ssvSlots ? ssvSlots.get(slot) : undefined;

  const extraByDoy = _roChmiExtraEnsureByDoy();
  const extraSlots = extraByDoy ? _imgChmiSlotsFor(extraByDoy, doy) : null;
  const extraVal = extraSlots ? extraSlots.get(slot) : undefined;
  // Only meaningful as "T" if this image's extra dataset actually IS temperature - filelist.json
  // currently only ever declares one extra code per image (see setCurrentChmiFromGallery()), and
  // it's always 'T' today, but this stays correct if that ever changes.
  const tVal = (typeof currentChmiExtra !== 'undefined' && currentChmiExtra && currentChmiExtra.element === 'T') ? extraVal : undefined;

  // Font colour for the T value matches the same temperature gradient the CHMI overlay itself uses
  // on the image (_chmiTempColor, the 45-band ČHMÚ scale above) - null (caller's default colour)
  // when there's no real value to colour.
  const tColor = (tVal !== undefined && tVal !== null) ? _chmiTempColor(tVal, 1) : null;

  return { ssv: _chmiReadoutFormatSSV(ssvVal), t: _chmiReadoutFormatT(tVal), tColor };
}

// Forward sun position (Custom date + sunTimeHours -> {az, el}, world compass, same shape/units
// sunPosition() always returns) for the top readout's fallback path (§Info panel, updateInfoReadout
// in controls.js): while hovering, Az/Alt/Day/Time/Dir are read backward from the cursor via
// pixelToAzEl()+inverseSolar(); while NOT hovering but "Custom date" is on, they instead read
// forward from the selected date/time - this is that other direction, reusing the exact same
// declination/latitude/hour-angle inputs render-3d.js's own Custom-date status readout
// (tsAzAlt) already computes the same way.
function _readoutFallbackSunPos() {
  const doy = dayOfYear(customMonth, customDay);
  const delta = sunDeclination(doy);
  const phi = effectiveLat() * hemisphere;
  const H = (sunTimeHours - 12) * 15 * Math.PI / 180;
  return sunPosition(H, delta, phi);
}

// GEOMETRIC (airless) azimuth and elevation for hour angle H (rad), declination δ (rad), latitude φ
// (rad). Returns { az, el } in degrees; az = world azimuth 0=N, 90=E, 180=S, 270=W. Used where the
// true position is wanted: Night Sky's own transform (which adds refraction itself), the Eclipse
// module (contact times and magnitudes are published geometric), and sunPosition below.
function sunPositionTrue(H, delta, phi) {
  const sinEl = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));

  const cosAz = (Math.sin(delta) - Math.sin(phi) * sinEl) / (Math.cos(phi) * Math.cos(el));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  // Afternoon correction (H > 0 → west side)
  if (Math.sin(H) > 0) az = 2 * Math.PI - az;

  return {
    az: az * 180 / Math.PI,          // world azimuth
    el: el * 180 / Math.PI,          // elevation
    beta: az * 180 / Math.PI - 180   // β from south (camera centre = south always)
  };
}
// APPARENT position - what the pinhole records and every Solargraph view draws: the geometric one
// with atmospheric refraction added to the elevation (_skyRefractionDeg, Saemundsson - ~0.57 deg at
// the horizon, 0.09 deg at 10 deg). elTrue carries the geometric elevation along.
function sunPosition(H, delta, phi) {
  const p = sunPositionTrue(H, delta, phi);
  return { az: p.az, el: p.el + _skyRefractionDeg(p.el), elTrue: p.el, beta: p.beta };
}

// Draw a single solar arc
// style: { color, lineWidth, showHourDots, showHourLabels, edgeLabel }
function drawSunArc(W, H, month, day, style) {
  const doy   = dayOfYear(month, day);
  const delta = pathDeclination(doy);
  const phi   = effectiveLat();

  // Sample at 0.25° steps for smooth curve. Points are grouped into contiguous segments, not one
  // flat list: when the can faces away from the sun's daily path (e.g. a north-facing YAW on the
  // northern hemisphere), the visible/on-paper part of the arc is only near BOTH edges of the
  // frame, with a real gap through the middle where the sun is behind the pinhole wall or off the
  // exposed paper - not a continuous curve. Any skipped sample (below horizon, off the projected
  // paper, or outside the canvas) ends the current segment so that gap is never bridged by a
  // spurious straight line across the middle.
  const segments = [];
  let seg = null;
  for (let hDeg = -180; hDeg <= 180; hDeg += 0.25) {
    const Hrad = hDeg * Math.PI / 180;
    const { el, beta } = sunPosition(Hrad, delta, phi);
    let pos = null;
    if (el >= 0) {
      pos = azElToPixel(beta - yawDeg, el);
      if (pos && (pos.px < -20 || pos.px > W + 20)) pos = null;
    }
    if (!pos) { seg = null; continue; }
    if (!seg) { seg = []; segments.push(seg); }
    seg.push(pos);
  }

  const curvePoints = segments.flat();
  if (curvePoints.length < 2) return;

  // Draw arc curve - one subpath per contiguous segment
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash([]);
  for (const s of segments) {
    if (s.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(s[0].px, s[0].py);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].px, s[i].py);
    ctx.stroke();
  }

  // Edge label – clamped inside canvas
  if (showLabels && style.edgeLabel) {
    ctx.font = `${style.lineWidth >= 1.4 ? 'bold ' : ''}10px 'Share Tech Mono'`;
    // Labels always at full opacity – extract RGB from style.color and force alpha=1
    ctx.fillStyle = style.color.replace(/rgba\(([^,]+,[^,]+,[^,]+),[^)]+\)/, 'rgba($1,1)');
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 2.5;

    const left  = curvePoints[0];
    const right = curvePoints[curvePoints.length - 1];
    const pad = 2;

    ctx.textAlign = 'left';
    const lx = Math.max(pad, left.px + 4);
    ctx.strokeText(style.edgeLabel, lx, left.py - 4);
    ctx.fillText(style.edgeLabel,   lx, left.py - 4);

    ctx.textAlign = 'right';
    const rx = Math.min(W - pad, right.px - 4);
    ctx.strokeText(style.edgeLabel, rx, right.py - 4);
    ctx.fillText(style.edgeLabel,   rx, right.py - 4);
  }

  // Hourly dots and labels (equinox only)
  if (style.showHourDots) {
    // hDeg spans a full circle of hour angle (-180..+180 = -12h..+12h); -180 and +180 are the
    // SAME hour angle modulo 360 (sunPosition() gives identical el/beta for both), so the loop
    // must stop short of +180 - otherwise the 0h/24h point is plotted and labeled twice, right on
    // top of itself (most visible at extreme latitudes like the poles, where the whole circle sits
    // above the horizon and every hour dot is drawn).
    for (let hDeg = -12 * 15; hDeg < 12 * 15; hDeg += 15) {
      const Hrad = hDeg * Math.PI / 180;
      const { el, beta } = sunPosition(Hrad, delta, phi);
      if (el < 0) continue;
      const pos = azElToPixel(beta - yawDeg, el);
      if (!pos) continue;
      if (pos.px < 0 || pos.px > W || pos.py < 0 || pos.py > H) continue;

      // Solar hour label: mirror for southern hemisphere, then convert to the selected display mode.
      // displayHour() is a pure additive shift (timezone + equation of time) with no day-rollover
      // awareness, so shownHour routinely lands outside [0,24) - wrap AFTER rounding to the minute
      // (not before - a value like 23.9999999 is validly <24 going in but rounds to a literal 24),
      // same fix and same reasoning as fmtSolarTime()/_sgHM() (render-3d.js/render-sungraph.js).
      const trueHour = 12 + (hemisphere >= 0 ? hDeg : -hDeg) / 15;
      const shownHour = displayHour(trueHour, doy);
      let hh = Math.floor(shownHour), mm = Math.round((shownHour - hh) * 60);
      if (mm === 60) { hh += 1; mm = 0; }
      hh = ((hh % 24) + 24) % 24;
      const label = hh + ':' + String(mm).padStart(2, '0');

      ctx.beginPath();
      ctx.arc(pos.px, pos.py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      if (showLabels && style.showHourLabels) {
        ctx.font = "bold 10px 'Share Tech Mono'";
        ctx.fillStyle = style.color.replace(/rgba\(([^,]+,[^,]+,[^,]+),[^)]+\)/, 'rgba($1,1)');
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 2.5;
        ctx.textAlign = pos.px < W / 2 ? 'left' : 'right';
        const ox = pos.px < W / 2 ? 7 : -7;
        ctx.strokeText(label, pos.px + ox, pos.py - 4);
        ctx.fillText(label,   pos.px + ox, pos.py - 4);
      }
    }
  }
}

// Draw full set of solar arcs
function drawAllSunArcs(W, H) {
  const op = dispOpacity;
  // Intermediate arcs – thin yellow, no labels
  const thin = `rgba(255, 220, 60, ${Math.min(1, op * 0.40)})`;
  [[1,21],[2,21],[4,21],[5,21]].forEach(([m,d]) => {
    drawSunArc(W, H, m, d, { color: thin, lineWidth: 0.8,
      showHourDots: false, showHourLabels: false, edgeLabel: null });
  });

  // Local winter solstice – blue. The month swap below and drawSunArc()'s own hemisphere negation
  // (pathDeclination) are two different corrections that both stay necessary together: this picks
  // the REAL month whose real declination has the right magnitude for "winter" here (Jun for the
  // south), and pathDeclination() then negates that real declination so it actually renders as a
  // low-sun shape through the convention's always-positive latitude - drop either one and the
  // southern curves render backwards (see the note on pathDeclination() in core.js).
  const winterMonth = hemisphere >= 0 ? 12 : 6;
  drawSunArc(W, H, winterMonth, 21, {
    color: `rgba(60, 180, 255, ${Math.min(1, op * 0.85)})`, lineWidth: 1.5,
    showHourDots: false, showHourLabels: false, edgeLabel: 'solstice'
  });

  // Equinox – yellow (with hour dots + labels)
  drawSunArc(W, H, 3, 21, {
    color: `rgba(255, 220, 60, ${Math.min(1, op * 0.85)})`, lineWidth: 1.5,
    showHourDots: true, showHourLabels: true, edgeLabel: 'equinox'
  });

  // Local summer solstice – red
  const summerMonth = hemisphere >= 0 ? 6 : 12;
  drawSunArc(W, H, summerMonth, 21, {
    color: `rgba(255, 100, 60, ${Math.min(1, op * 0.85)})`, lineWidth: 1.5,
    showHourDots: false, showHourLabels: false, edgeLabel: 'solstice'
  });
}

// The analemma - the sun's position at one FIXED CLOCK reading (Mean or Standard time - see
// _analemmaTrueHourFor below) sampled across the year, the classic figure-8 loop you get
// photographing the sun at the same clock time every few days. The "same clock time" is exactly
// what makes it an 8: the equation of time shifts the TRUE solar hour angle that produces that
// clock reading by a different amount on each calendar day, so the sun drifts east/west across the
// months on top of its north/south declination drift - the two together trace the loop. In True
// solar time mode there's no such shift (true solar time and true hour angle are the same thing by
// definition), so every month lands on the exact same hour angle and the "loop" degenerates to a
// vertical line - that's correct behaviour, not a bug (see _analemmaTrueHourFor).
//
// The fixed clock reading itself is whatever's currently showing: the CURRENT day (customMonth/Day)
// and CURRENT sunTimeHours, reprojected through the active display mode - i.e. exactly what the
// Time readout/slider label already print. Kept simple per spec: one point per month, always the
// 21st (not the real solstice/equinox dates elsewhere in this function), connected as a dotted
// closed loop back to January. Sub-option of "Sun's paths" (showSunArc) - gated by the caller, not
// in here - independent of Custom date/showCustomArc, since it isn't "the" custom day, just
// whatever hour the slider currently sits at.
function drawAnalemma(W, H) {
  const op = dispOpacity;
  const phi = effectiveLat();
  const shownHour = displayHour(sunTimeHours, dayOfYear(customMonth, customDay));
  const sampleAt = (day) => {
    const trueHour = _analemmaTrueHourFor(shownHour, day);
    const hDeg = (trueHour - 12) * 15 * hemisphere;   // same convention as the animated sun marker (render-2d.js)
    const delta = pathDeclination(day);
    const { el, beta } = sunPosition(hDeg * Math.PI / 180, delta, phi);
    const pos = azElToPixel(beta - yawDeg, el);   // valid for ANY el, not just el>=0 - see drawHorizon's own el=0 call
    return { el, point: pos ? { x: pos.px, y: pos.py } : null };
  };
  ctx.strokeStyle = `rgba(175, 82, 222, ${Math.min(1, op * 0.9)})`;   // same purple as the Analemma switch (#af52de)
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.setLineDash([1, 6]);   // dotted, not dashed - short round caps read as dots
  for (const run of _analemmaRuns(_analemmaBuildPoints(sampleAt))) _analemmaStrokeRun(ctx, run.points, run.closed);
  ctx.setLineDash([]);
}
// Builds the analemma's point/gap sequence from the 12 monthly samples (day=21 each month) plus,
// wherever two ADJACENT months disagree on visibility, one extra point exactly at the horizon
// (el=0) - found by bisecting the real fractional day between them, not by sampling extra whole
// days. Fixes the earlier version simply stopping a run at the last/first whole visible month: the
// true curve keeps going right up to the horizon, and now the drawn one does too. sampleAt(day) ->
// {el, point} is the ONLY thing that differs between the flat scan and Sky Dome (different
// declination/projection conventions - see drawAnalemma / _skyDomeAnalemmaPoints); everything else,
// including this function and the run-splitting/spline drawing below it, is shared as-is. `point`
// must be valid for ANY el, not just el>=0 - every projection in this app already handles negative
// elevation fine (nothing physically stops the sun from having a computable position below the
// horizon, it's just not visible there), so sampleAt should never gate on sign itself.
function _analemmaBuildPoints(sampleAt) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const day = dayOfYear(m, 21);
    const s = sampleAt(day);
    months.push({ day, el: s.el, point: s.point });
  }
  // Bisects the real day between two adjacent months that disagree on visibility, narrowing in on
  // exactly where el crosses zero. b.day is a's own day plus up to 365 (not wrapped into [1,365])
  // while bisecting, so the interval stays a single ordered range even across the Dec->Jan
  // boundary - only wrapped back into a real calendar day right before each sampleAt() call.
  const horizonEdge = (a, b) => {
    const aVisible = a.el >= 0;
    let d0 = a.day, d1 = b.day > a.day ? b.day : b.day + 365;
    for (let i = 0; i < 18; i++) {
      const dm = (d0 + d1) / 2;
      const s = sampleAt(dm > 365 ? dm - 365 : dm);
      if ((s.el >= 0) === aVisible) d0 = dm; else d1 = dm;
    }
    const dm = (d0 + d1) / 2;
    return sampleAt(dm > 365 ? dm - 365 : dm).point;
  };
  const raw = [];
  for (let i = 0; i < 12; i++) {
    const cur = months[i], next = months[(i + 1) % 12];
    raw.push(cur.el >= 0 ? cur.point : null);
    if ((cur.el >= 0) !== (next.el >= 0)) raw.push(horizonEdge(cur, next));
  }
  return raw;
}
// Splits a circular array of 12 monthly points (or null where that month is below the horizon at
// the fixed hour - see drawAnalemma/_skyDomeAnalemmaPoints) into runs of consecutive visible
// months. A curve should never bridge straight across a month that isn't actually there - that
// silently implies the sun was visible in between, which it wasn't. All 12 present (the common
// case) is one CLOSED run (the loop back to January); any gap breaks it into one or more OPEN runs,
// each ending where visibility does. Handles wraparound (e.g. Nov/Dec/Jan all invisible splits the
// remaining Feb-Oct into one run; a gap elsewhere can still wrap an open run across the Dec->Jan
// boundary).
function _analemmaRuns(arr) {
  const n = arr.length;
  if (arr.every(p => p !== null)) return [{ points: arr.slice(), closed: true }];
  const firstGap = arr.findIndex(p => p === null);
  const runs = [];
  let current = [];
  for (let k = 0; k < n; k++) {
    const p = arr[(firstGap + 1 + k) % n];
    if (p === null) { if (current.length) runs.push({ points: current, closed: false }); current = []; }
    else current.push(p);
  }
  if (current.length) runs.push({ points: current, closed: false });
  return runs;
}
// Strokes one run through a Catmull-Rom spline (converted to per-segment cubic Beziers) instead of
// straight segments between the 12 sparse points - visibly smoother without sampling any extra
// days. Closed runs (loop) wrap their neighbour lookups; open runs (broken by a horizon gap) clamp
// at both ends instead, since there's no real neighbour to borrow a tangent from past the gap.
// pts.length < 2 draws nothing (a single visible month has no segment to connect).
function _analemmaStrokeRun(ctx, pts, closed) {
  const n = pts.length;
  if (n < 2) { return; }
  if (n === 2) {   // two points define no curvature - a straight segment is the honest result
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
    return;
  }
  const at = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
  ctx.stroke();
}
// Inverse of displayHour(): given a clock reading already in the CURRENT display mode and the real
// calendar day it should apply to, returns the TRUE solar hour angle that produces that reading on
// that specific day. Mean/Standard already have a direct inverse (equation of time - and, for
// Standard, the longitude offset - are day-of-year functions only, not hour-of-day ones, so this
// is an exact closed form, no iteration needed); True solar time has no conversion to invert at all
// (trueHour === the clock reading itself, on every day alike) - which is exactly why the analemma
// collapses to a vertical line there instead of forming the usual figure-8 (see drawAnalemma above).
function _analemmaTrueHourFor(shownHour, doy) {
  if (timeDisplayMode === 'mean') return trueFromMean(shownHour, doy);
  if (timeDisplayMode === 'standard') return trueFromStandard(shownHour, doy);
  return shownHour;
}

let showSunArc = true;   // Sun's paths on by default (Gallery + Analyzer)
let showAnalemma = false;   // Sun's paths sub-option, off by default even when Sun's paths is on
let showHeatmap = false;
let showImgChmi = false;   // 2D-canvas CHMI overlay master switch (Display section), off by default
let chmiDisplayMode = 'whole';   // 'custom' = single-day halo on the Custom Path (legacy behaviour)
                                   // 'whole'  = mosaic across the whole exposure/data range (see drawChmiMosaic)

const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvasContainer');
let imgBitmap = null;
let mouseX = -1, mouseY = -1;
let showGrid = true, showLabels = true, showHorizon = true;
let dispOpacity = 0.75;  // master opacity for all display overlays
let yawDeg   = 0;   // degrees, rotation from south (positive = west)
let pitchDeg   = 0;   // degrees, pitch – bends horizon via Ry rotation
let rollDeg = 0;   // degrees, roll around optical axis (±90°, step 0.1°)
let hScale     = 1.0; // derived: radius / R (updated when radius changes)
let radius     = 33;  // effective cylinder radius [mm]
let horizonMm = 0;   // mm, vertical offset of pinhole from paper centre (positive = above centre)
let scanWmm   = 178;  // mm represented by the full scan width (set by user)

// Effective cy corrected for pinhole vertical offset
function getEffectiveCy() {
  return cy + horizonMm * scale;
}

function setupCanvas(w, h) {
  canvasLW  = w;
  canvasLH  = h;
  // Backing store = logical size × supersample factor (≥2, bumped on HiDPI screens) so the
  // canvas bitmap is denser than its on-screen size and overlay text / lines render sharp.
  canvasRES = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  canvas.width  = Math.round(w * canvasRES);
  canvas.height = Math.round(h * canvasRES);
  IMG_H = h;
  cy = h / 2;
  cx = w / 2;
  scale = w / scanWmm;
  updateScanH();
  refreshCalibLimits();   // aspect ratio affects the horizon range
}

function updateScanH() {
  const el = document.getElementById('inpScanH');
  if (!el) return;
  el.value = canvas.width > 0
    ? Math.round(scanWmm * canvas.height / canvas.width)
    : '—';
}

// ─── Split screen ─────────────────────────────────────────────────────────
const splitHandle    = document.getElementById('splitHandle');
const btnSplitInvert = document.getElementById('btnSplitInvert');

let splitActive     = false;
let splitInverted   = false;
let splitBitmap     = null;   // L2 image bitmap
let splitX          = 0.5;    // relative 0–1 within image bounds
let isDraggingSplit = false;
let splitOpacity    = 1.0;    // L2 layer opacity (0.1–1.0)

// Returns the actual image bounds inside the canvas-container
// (canvas is CSS width/height 100% but image has a natural aspect ratio)
function getImageBounds() {
  const rect = container.getBoundingClientRect();
  const cw = canvas.width;
  const ch = canvas.height;
  const cr = rect.width / rect.height;
  const ir = cw / ch;
  let iw, ih, ox, oy;
  if (ir > cr) {
    iw = rect.width;
    ih = rect.width / ir;
    ox = 0;
    oy = (rect.height - ih) / 2;
  } else {
    ih = rect.height;
    iw = rect.height * ir;
    ox = (rect.width - iw) / 2;
    oy = 0;
  }
  return { iw, ih, ox, oy };
}

function setSplitMode(active) {
  stopL2Loop();                 // cancel auto-loop on any split state change
  splitActive = active;
  splitHandle.style.display    = active ? 'block' : 'none';
  btnSplitInvert.style.display = active ? 'flex'  : 'none';
  // Off-state cursor depends on mode: Analyzer draws its own crosshair (needs the OS cursor
  // hidden, 'none'), Gallery doesn't (needs the plain default cursor) - see setMode().
  container.style.cursor = active ? 'col-resize' : (typeof currentMode !== 'undefined' && currentMode === 'analyzer' ? 'none' : 'default');
  document.getElementById('l2OpacityRow').style.display = active ? 'block' : 'none';
  draw();
}

// Called from draw() – draws L2 with opacity blend onto mainCanvas
function drawSplitOverlay(W, H) {
  if (!splitActive || !splitBitmap) return;
  const splitPx = Math.round(splitX * W);

  ctx.save();
  ctx.beginPath();
  if (!splitInverted) {
    ctx.rect(0, 0, splitPx, H);             // L2 on left (default)
  } else {
    ctx.rect(splitPx, 0, W - splitPx, H);   // L2 on right (swapped)
  }
  ctx.clip();

  // Inside L2 clip only:
  // 1. Draw L2 at 100% — covers the L1 that was drawn beneath
  ctx.drawImage(splitBitmap, 0, 0, W, H);
  // 2. Draw L1 back at (1 − splitOpacity) — blends L1 into L2
  //    Result: L2 * splitOpacity + L1 * (1 − splitOpacity)
  if (imgBitmap && splitOpacity < 1.0) {
    ctx.globalAlpha = 1.0 - splitOpacity;
    ctx.drawImage(imgBitmap, 0, 0, W, H);
    ctx.globalAlpha = 1.0;
  }

  ctx.restore();   // removes clip, restores globalAlpha — L1 side untouched

  // Update handle position – map canvas px → container px
  updateHandlePosition(splitPx, W);
}

function updateHandlePosition(splitPx, canvasW) {
  const bounds = getImageBounds();
  const handleX = bounds.ox + (splitPx / canvasW) * bounds.iw;
  splitHandle.style.left = handleX + 'px';
}

// Load L2 bitmap for split
function loadSplitImage(genId, imageIndex) {
  const path = `img/GEN-${genId}_${imageIndex}_L2.jpg`;
  const imgEl = new Image();
  imgEl.onload = () => {
    createImageBitmap(imgEl).then(bm => {
      splitBitmap = bm;
      if (splitActive) draw();
    });
  };
  imgEl.onerror = () => { splitBitmap = null; };
  imgEl.src = path;
}

// Drag – move split position
container.addEventListener('mousedown', (e) => {
  if (!splitActive) return;
  if (e.target === btnSplitInvert) return; // click on the button is not part of the split drag
  isDraggingSplit = true;
  moveSplit(e.clientX);
});

window.addEventListener('mousemove', (e) => {
  if (!splitActive || !isDraggingSplit) return;
  moveSplit(e.clientX);
});

window.addEventListener('mouseup', () => { isDraggingSplit = false; });

container.addEventListener('touchstart', (e) => {
  if (!splitActive) return;
  if (e.target.closest('#btnSplitInvert')) return; // tap on rotate button – don't move split
  isDraggingSplit = true;
  moveSplit(e.touches[0].clientX);
}, { passive: true });

container.addEventListener('touchmove', (e) => {
  if (!splitActive || !isDraggingSplit) return;
  moveSplit(e.touches[0].clientX);
}, { passive: true });

container.addEventListener('touchend', () => { isDraggingSplit = false; });

function moveSplit(clientX) {
  const bounds = getImageBounds();
  const rect   = container.getBoundingClientRect();
  // Clamp to image bounds only (not letterbox area)
  const relX = (clientX - rect.left - bounds.ox) / bounds.iw;
  splitX = Math.max(0, Math.min(1, relX));
  draw();
}

btnSplitInvert.addEventListener('click', () => {
  splitInverted = !splitInverted;
  btnSplitInvert.classList.toggle('active', splitInverted);
  draw();
});

// ─── Vignetting isolines: constant α = angle from optical axis ───────────
// cos(α) = cos(β_local) · cos(θ_local)
// Isolines for α = 70–80° step 2°, white dotted, opacity scales with dispOpacity.
// Labels (showLabels) only for 70° and 80°, at all four corners of canvas.

function drawVignetteIsolines(W, H) {
  const op = dispOpacity;
  const alphas = [60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80];
  const eCy = getEffectiveCy();

  // Track extreme visible points per isoline per side for label placement
  const bottomL = new Array(alphas.length).fill(null);
  const bottomR = new Array(alphas.length).fill(null);
  const topL    = new Array(alphas.length).fill(null);
  const topR    = new Array(alphas.length).fill(null);

  for (let i = 0; i < alphas.length; i++) {
    const alpha = alphas[i];
    const baseOpacity = 0.20 + i * (0.80 / (alphas.length - 1));
    const finalOpacity = Math.min(1, baseOpacity * op);
    const color = `rgba(255,255,255,${finalOpacity.toFixed(3)})`;
    const cosA = Math.cos(alpha * Math.PI / 180);

    for (const sign of [+1, -1]) {
      const points = [];
      for (let bDeg = -89; bDeg <= 89; bDeg += 0.5) {
        const beta_local = bDeg * Math.PI / 180;
        const cosB = Math.cos(beta_local);
        if (Math.abs(cosB) < 1e-6) continue;
        const cosTheta = cosA / cosB;
        if (Math.abs(cosTheta) > 1) continue;
        const theta_local = sign * Math.acos(cosTheta);
        const sx = 2 * R * hScale * beta_local;
        const sy = 2 * R * hScale * Math.cos(beta_local) * Math.tan(theta_local);
        const px = cx + sx * scale;
        const py = eCy - sy * scale;
        if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
        points.push({ px, py });

        if (px >= 0 && px <= W && py >= 0 && py <= H) {
          if (bDeg <= 0) {
            if (!bottomL[i] || py > bottomL[i].py) bottomL[i] = { px, py };
            if (!topL[i]    || py < topL[i].py)    topL[i]    = { px, py };
          }
          if (bDeg >= 0) {
            if (!bottomR[i] || py > bottomR[i].py) bottomR[i] = { px, py };
            if (!topR[i]    || py < topR[i].py)    topR[i]    = { px, py };
          }
        }
      }
      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(points[0].px, points[0].py);
      for (let j = 1; j < points.length; j++) ctx.lineTo(points[j].px, points[j].py);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Labels: only 70° and 80°, at all four corners (top/bottom × left/right)
  if (!showLabels) return;

  ctx.font = "9px 'Share Tech Mono'";
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.textAlign = 'center';

  for (const i of [0, 5, alphas.length - 1]) {
    const t = alphas[i] + '°';
    if (bottomL[i]) { ctx.strokeText(t, bottomL[i].px, H - 6);  ctx.fillText(t, bottomL[i].px, H - 6); }
    if (bottomR[i]) { ctx.strokeText(t, bottomR[i].px, H - 6);  ctx.fillText(t, bottomR[i].px, H - 6); }
    if (topL[i])    { ctx.strokeText(t, topL[i].px,    10);      ctx.fillText(t, topL[i].px,    10); }
    if (topR[i])    { ctx.strokeText(t, topR[i].px,    10);      ctx.fillText(t, topR[i].px,    10); }
  }
}

