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
function inverseSolar(az_world_deg, el_deg, phi_rad) {
  if (el_deg < 0) return null;

  const el  = el_deg  * Math.PI / 180;
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
  const maxDecl = 23.45 * Math.PI / 180;
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

  const hh = Math.floor(solarHour);
  const mm = Math.floor((solarHour - hh) * 60);
  const timeStr = hh + ':' + String(mm).padStart(2, '0');

  return {
    day1: doyToString(d1),
    day2: doyToString(d2),
    time: timeStr
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

// ─── True / Mean / Standard solar time ─────────────────────────────────────
// Three time conventions, display-only (never fed back into geometry - hDeg/pixel positions
// always stay driven by TRUE solar hour angle, per the project's own photographic-fidelity rule):
//   true solar time    - H=0 is noon, by definition; what the app has always computed natively.
//   mean solar time    - true solar time corrected by the equation of time (day-of-year only).
//   standard time       - mean solar time corrected by longitude vs. the timezone's own reference
//                         meridian (chosenZone × 15°) plus the chosen whole/quarter-hour zone.
let timeDisplayMode = 'standard';   // 'true' | 'mean' | 'standard' - default per product decision

// Equation of time [minutes]: true solar time minus mean solar time. Low-order approximation,
// reuses the same "day − 81" phase reference as sunDeclination() for consistency. Day-of-year
// only (no time-of-day dependence - valid to treat as constant across one calendar day, the
// actual drift is on the order of seconds, far below the app's 10-min data resolution).
function equationOfTimeMin(doy) {
  const B = 2 * Math.PI / 365 * (doy - 81);
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

function meanFromTrue(trueHour, doy) { return trueHour - equationOfTimeMin(doy) / 60; }
function trueFromMean(meanHour, doy) { return meanHour + equationOfTimeMin(doy) / 60; }

function standardFromMean(meanHour) {
  const longSigned = lonHemisphere * LONG;
  return meanHour - (longSigned - timeZoneHours * 15) / 15;
}
function meanFromStandard(standardHour) {
  const longSigned = lonHemisphere * LONG;
  return standardHour + (longSigned - timeZoneHours * 15) / 15;
}

function standardFromTrue(trueHour, doy) { return standardFromMean(meanFromTrue(trueHour, doy)); }
function trueFromStandard(standardHour, doy) { return trueFromMean(meanFromStandard(standardHour), doy); }

// Dispatcher for anything that DISPLAYS a time number (labels, readouts, axis ticks) - picks the
// conversion per the current mode. Never call this to compute a pixel position or hour angle;
// geometry stays in true solar time always (the Sun Graph's yearly view is the one exception -
// see render-sungraph.js, which reprojects its own geometry rather than just relabeling).
function displayHour(trueHour, doy) {
  if (timeDisplayMode === 'mean') return meanFromTrue(trueHour, doy);
  if (timeDisplayMode === 'standard') return standardFromTrue(trueHour, doy);
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

// Earth's orbit is an ellipse (eccentricity ~0.0167), not a circle - by Kepler's 2nd law it sweeps
// ecliptic longitude fastest near perihelion (~3 Jan) and slowest near aphelion (~4 Jul). Feeds
// the equation-of-center correction in sunDeclination() below.
const PERIHELION_DOY = 3;
const EARTH_ECCENTRICITY = 0.0167;

// Solar declination for day-of-year d (1 = Jan 1), via the equation of center (Kepler) rather
// than a plain sine of calendar time. A plain `23.45°·sin(2π/365·(d−81))` implicitly assumes
// ecliptic longitude is linear in time, which the elliptical orbit above makes wrong in two
// compounding ways: (1) for any single date, by up to ~1.5-2° (worst near the equinoxes) - the
// declination formula's own long-known imprecision; (2) that error's SIGN flips between the
// first and second half of the year (faster near perihelion/Jan, slower near aphelion/Jul) - a
// real asymmetry between how fast the sun's path actually progresses in, say, February vs.
// August, which a symmetric sine can never reproduce no matter how it's tuned, only by computing
// the true (not mean) ecliptic longitude directly. See project notes for the full derivation and
// a worked numeric example (~186 vs ~179 days for the two halves of the year). Reduces the error
// to <0.1-0.3° (equivalent to the commonly-cited "Spencer" level of precision).
function sunDeclination(dayOfYear) {
  const meanAnomaly = 2 * Math.PI / 365 * (dayOfYear - PERIHELION_DOY);
  const e = EARTH_ECCENTRICITY;
  // Equation of center - how far the true position runs ahead of (perihelion side) or behind
  // (aphelion side) the mean position. First two terms of the standard series; the e³ term is
  // <0.001° here and not worth carrying.
  const eqOfCenter = (2 * e - e * e * e / 4) * Math.sin(meanAnomaly)
                    + (5 * e * e / 4) * Math.sin(2 * meanAnomaly);
  const meanLongitude = 2 * Math.PI / 365 * (dayOfYear - 81);   // 81 = spring equinox reference
  const trueLongitude = meanLongitude + eqOfCenter;
  const obliquity = 23.45 * Math.PI / 180;
  return Math.asin(Math.sin(obliquity) * Math.sin(trueLongitude));
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

// Azimuth and elevation of sun for hour angle H (rad), declination δ (rad), latitude φ (rad)
// Returns { az, el } in degrees; az = world azimuth 0=N, 90=E, 180=S, 270=W
function sunPosition(H, delta, phi) {
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

// Draw a single solar arc
// style: { color, lineWidth, showHourDots, showHourLabels, edgeLabel }
function drawSunArc(W, H, month, day, style) {
  const doy   = dayOfYear(month, day);
  const delta = pathDeclination(doy);
  const phi   = effectiveLat();

  // Sample at 0.25° steps for smooth curve
  const curvePoints = [];
  for (let hDeg = -180; hDeg <= 180; hDeg += 0.25) {
    const Hrad = hDeg * Math.PI / 180;
    const { el, beta } = sunPosition(Hrad, delta, phi);
    if (el < 0) continue;
    const pos = azElToPixel(beta - yawDeg, el);
    if (!pos) continue;
    if (pos.px < -20 || pos.px > W + 20) continue;
    curvePoints.push(pos);
  }

  if (curvePoints.length < 2) return;

  // Draw arc curve
  ctx.beginPath();
  ctx.moveTo(curvePoints[0].px, curvePoints[0].py);
  for (let i = 1; i < curvePoints.length; i++) ctx.lineTo(curvePoints[i].px, curvePoints[i].py);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash([]);
  ctx.stroke();

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
    for (let hDeg = -12 * 15; hDeg <= 12 * 15; hDeg += 15) {
      const Hrad = hDeg * Math.PI / 180;
      const { el, beta } = sunPosition(Hrad, delta, phi);
      if (el < 0) continue;
      const pos = azElToPixel(beta - yawDeg, el);
      if (!pos) continue;
      if (pos.px < 0 || pos.px > W || pos.py < 0 || pos.py > H) continue;

      // Solar hour label: mirror for southern hemisphere, then convert to the selected display mode
      const trueHour = 12 + (hemisphere >= 0 ? hDeg : -hDeg) / 15;
      const shownHour = displayHour(trueHour, doy);
      const hh = Math.floor(shownHour), mm = Math.round((shownHour - hh) * 60);
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

let showSunArc = true;   // Sun's paths on by default (Gallery + Analyzer)
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
  container.style.cursor = active ? 'col-resize' : 'none';
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

