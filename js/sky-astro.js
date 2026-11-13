// Shared astronomy: the pure functions (no app state, no DOM) that turn a date, a time and a place
// into Sun/star positions - Julian Date, deltaT, Meeus Sun, refraction, sidereal time, precession,
// RA/Dec <-> Az/El. Used by BOTH halves of the app (the Solargraph views in core.js and Night Sky),
// so a given date, time and place gives the same Sun everywhere, and by standalone pages that load
// this file without core.js. Loaded first in index.html; nothing here reads LAT/LONG or other state
// (the Location is always a parameter). Function names use the _sky and _moon prefixes (_moonJDE, _moonDeltaTSec and so on).

// Julian Date (UT) for a civil date/time. hourUT may include minutes/seconds as a fraction (e.g.
// 13.5 = 13:30 UT). The calendar is the historical one, as in Meeus ch. 7, NASA's eclipse catalogues
// and Stellarium: Gregorian from 1582-10-15, Julian before it (4 Oct 1582 Julian is followed by
// 15 Oct Gregorian). _skyFromJulianDateUT below uses the same switch, so the two round-trip.
function _skyToJulianDateUT(year, month, day, hourUT) {
  let y = year, m = month;
  const gregorian = year * 10000 + month * 100 + day >= 15821015;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = gregorian ? 2 - a + Math.floor(a / 4) : 0;
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + hourUT / 24 + b - 1524.5;
}

// Inverse of _skyToJulianDateUT (Meeus ch.7's own inverse algorithm) - Julian Date (UT) back to a
// civil {year, month, day, hourUT}, Julian calendar before JD 2299161 (1582-10-15), Gregorian after. Used by the time strip's continuous drag/animation
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

// deltaT = TT - UT in seconds: the Espenak & Meeus polynomials used by NASA's eclipse catalogues
// (eclipse.gsfc.nasa.gov/SEhelp/deltatpoly2004.html), piecewise from -500 to 2150, and the long-term
// parabola -20 + 32u^2 outside that. y is the decimal year (year + (month - 0.5)/12). Historical
// values are uncertain (+-~5 min around 1400, ~20 min around 500), future ones are an extrapolation.
// Before build 46_1 only the 2005-2050 piece was used for every year: fine in 1900-2100, but ~25 min
// off in 1415 (1786 s instead of ~300 s), which moves the Moon ~0.2 deg and an eclipse path by
// hundreds of km.
function _moonDeltaTSec(y) {
  let t, u;
  if (y < -500 || y >= 2150) { u = (y - 1820) / 100; return -20 + 32 * u * u; }
  if (y < 500) {
    u = y / 100;
    return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3 - 0.1798452 * u ** 4
      + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6;
  }
  if (y < 1600) {
    u = (y - 1000) / 100;
    return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3 - 0.8503463 * u ** 4
      - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6;
  }
  if (y < 1700) { t = y - 1600; return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129; }
  if (y < 1800) { t = y - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000; }
  if (y < 1860) {
    t = y - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4
      + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7;
  }
  if (y < 1900) { t = y - 1860; return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174; }
  if (y < 1920) { t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { t = y - 1920; return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3; }
  if (y < 1961) { t = y - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (y < 1986) { t = y - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (y < 2005) {
    t = y - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (y < 2050) { t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t ** 2; }
  u = (y - 1820) / 100;
  return -20 + 32 * u * u - 0.5628 * (2150 - y);
}

// Julian Ephemeris Day (TT) for a UT instant.
function _moonJDE(year, month, day, hourUT) {
  return _skyToJulianDateUT(year, month, day, hourUT) + _moonDeltaTSec(year + (month - 0.5) / 12) / 86400;
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

// Precession angles zeta, z, theta (degrees) from J2000 to the epoch jde (Meeus 21.3, J2000 start).
function _moonPrecessionAngles(jde) {
  const T = (jde - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T;
  return {
    zeta:  (2306.2181 * T + 0.30188 * T2 + 0.017998 * T3) / 3600,
    z:     (2306.2181 * T + 1.09468 * T2 + 0.018203 * T3) / 3600,
    theta: (2004.3109 * T - 0.42665 * T2 - 0.041833 * T3) / 3600,
  };
}
// J2000 -> mean equinox of jde (Meeus 21.4). Night Sky's precession matrix is built from it
// (_skyPrecessionMatrix, render-nightsky.js).
function _moonPrecessFromJ2000(ra0, dec0, jde) {
  const { zeta, z, theta } = _moonPrecessionAngles(jde);
  const a = (ra0 + zeta) * _MOON_D2R, d = dec0 * _MOON_D2R, th = theta * _MOON_D2R;
  const A = Math.cos(d) * Math.sin(a);
  const B = Math.cos(th) * Math.cos(d) * Math.cos(a) - Math.sin(th) * Math.sin(d);
  const C = Math.sin(th) * Math.cos(d) * Math.cos(a) + Math.cos(th) * Math.sin(d);
  return { ra: _moonNorm360(Math.atan2(A, B) / _MOON_D2R + z), dec: Math.asin(C) / _MOON_D2R };
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
// GEOMETRIC (true, airless) position. Everything Night Sky draws goes through _skyRaDecToAzEl
// below instead, which adds atmospheric refraction; this one is kept for the few things defined on
// the true altitude (the twilight phases: the Sun's centre at -6/-12/-18 deg).
function _skyRaDecToAzElTrue(raDeg, decDeg, lstHours, latDegSigned) {
  const D2R = Math.PI / 180;
  let hDeg = lstHours * 15 - raDeg;
  hDeg = ((hDeg + 180) % 360 + 360) % 360 - 180;   // normalize to (-180, 180]
  return sunPositionTrue(hDeg * D2R, decDeg * D2R, latDegSigned * D2R);
}
// APPARENT position - what an observer sees and what Night Sky draws: true position plus refraction.
// Returns sunPosition's own shape, el replaced by the apparent altitude, plus elTrue.
function _skyRaDecToAzEl(raDeg, decDeg, lstHours, latDegSigned) {
  const p = _skyRaDecToAzElTrue(raDeg, decDeg, lstHours, latDegSigned);
  return Object.assign({}, p, { el: p.el + _skyRefractionDeg(p.el), elTrue: p.el });
}
// Inverse of _skyRaDecToAzEl: APPARENT {az, el} (degrees, az from north through east, the app's own
// convention - e.g. the point under the cursor) -> {ra, dec} for the same local sidereal time and
// signed latitude: refraction removed first, then the standard horizontal -> equatorial
// transformation (Meeus 13.5/13.6 turned round).
function _skyAzElToRaDec(azDeg, elDeg, lstHours, latDegSigned) {
  const D2R = Math.PI / 180;
  const A = azDeg * D2R, h = _skyTrueFromApparentEl(elDeg) * D2R, phi = latDegSigned * D2R;
  const sinDec = Math.sin(phi) * Math.sin(h) + Math.cos(phi) * Math.cos(h) * Math.cos(A);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const H = Math.atan2(-Math.sin(A) * Math.cos(h), Math.cos(phi) * Math.sin(h) - Math.sin(phi) * Math.cos(h) * Math.cos(A));
  const ra = ((lstHours * 15 - H / D2R) % 360 + 360) % 360;
  return { ra, dec: dec / D2R };
}
// J2000 -> mean equinox of date as one 3x3 rotation (Meeus ch. 21, the same precession as
// _moonPrecessFromJ2000 - its three columns ARE that formula applied to the x/y/z axes), cached per
// ~1.4 min of JDE: precession moves the sky ~50"/year, so reusing one matrix per redraw is exact to
// well under 0.001". Thousands of stars and line vertices per frame then cost 9 multiplications each.
let _skyPrecCache = { key: null, m: null };
function _skyPrecessionMatrix(jde) {
  const key = Math.round(jde * 1000);
  if (_skyPrecCache.key === key) return _skyPrecCache.m;
  const col = (ra, dec) => _skyDomeUnitVecRaDec(_moonPrecessFromJ2000(ra, dec, jde));
  const x = col(0, 0), y = col(90, 0), z = col(0, 90);
  _skyPrecCache = { key, m: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]] };
  return _skyPrecCache.m;
}
function _skyDomeUnitVecRaDec(q) {
  const a = q.ra * Math.PI / 180, d = q.dec * Math.PI / 180;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}
function _skyJ2000ToDate(raDeg, decDeg, jde) {
  const m = _skyPrecessionMatrix(jde);
  const v = _skyDomeUnitVecRaDec({ ra: raDeg, dec: decDeg });
  const x = m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2];
  const y = m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2];
  const z = m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2];
  return { ra: ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI };
}


// ─── Moon, planets, Sun size (moved verbatim from render-moon.js, render-planets.js, core.js) ───
// Table 47.A: [D, M, M', F, sigma_l (1e-6 deg), sigma_r (1e-3 km)]
const _MOON_TERMS_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258], [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354], [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0], [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739], [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421], [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0], [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0], [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
// Table 47.B: [D, M, M', F, sigma_b (1e-6 deg)]
const _MOON_TERMS_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833], [0, 0, 1, -3, 777], [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607], [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421], [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351], [4, 0, 0, 1, 331], [2, -1, 1, 1, 315], [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283], [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185], [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177], [4, 0, -2, -1, 176], [4, -1, -1, -1, 166], [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132], [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];



// Geocentric ecliptic coordinates of the Moon, mean equinox of date (Meeus ch. 47).
// Returns {lambda, beta} in degrees and {dist} in km.
function _moonEclipticOfDate(jde) {
  const T = (jde - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = _moonNorm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D  = _moonNorm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M  = _moonNorm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp = _moonNorm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
  const F  = _moonNorm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
  const A1 = _moonNorm360(119.75 + 131.849 * T);
  const A2 = _moonNorm360(53.09 + 479264.290 * T);
  const A3 = _moonNorm360(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const E2 = E * E;
  const r = _MOON_D2R;

  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, cl, cr] of _MOON_TERMS_LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * r;
    const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E2);
    sl += cl * e * Math.sin(arg);
    sr += cr * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, cb] of _MOON_TERMS_B) {
    const arg = (d * D + m * M + mp * Mp + f * F) * r;
    const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E2);
    sb += cb * e * Math.sin(arg);
  }
  sl += 3958 * Math.sin(A1 * r) + 1962 * Math.sin((Lp - F) * r) + 318 * Math.sin(A2 * r);
  sb += -2235 * Math.sin(Lp * r) + 382 * Math.sin(A3 * r) + 175 * Math.sin((A1 - F) * r)
      + 175 * Math.sin((A1 + F) * r) + 127 * Math.sin((Lp - Mp) * r) - 115 * Math.sin((Lp + Mp) * r);

  return { lambda: _moonNorm360(Lp + sl / 1e6), beta: sb / 1e6, dist: 385000.56 + sr / 1000 };
}



// Topocentric correction of a geocentric RA/Dec (degrees) for the observer at signed geodetic
// latitude latDeg (sea level) and local sidereal time lstHours (Meeus 40.2/40.3, WGS84 axis ratio).
function _moonTopocentric(ra, dec, distKm, latDeg, lstHours) {
  const phi = latDeg * _MOON_D2R;
  const u = Math.atan(0.99664719 * Math.tan(phi));
  const rhoSin = 0.99664719 * Math.sin(u), rhoCos = Math.cos(u);
  const sinPi = 6378.14 / distKm;
  const H = (lstHours * 15 - ra) * _MOON_D2R, d = dec * _MOON_D2R;
  const dA = Math.atan2(-rhoCos * sinPi * Math.sin(H), Math.cos(d) - rhoCos * sinPi * Math.cos(H));
  const decT = Math.atan2((Math.sin(d) - rhoSin * sinPi) * Math.cos(dA), Math.cos(d) - rhoCos * sinPi * Math.cos(H));
  return { ra: _moonNorm360(ra + dA / _MOON_D2R), dec: decT / _MOON_D2R };
}

// Geocentric Moon, RA/Dec of date (degrees) + distance (km), plus the ecliptic longitude/latitude
// of date the phase and age below work from.
function _moonGeocentric(year, month, day, hourUT) {
  const jde = _moonJDE(year, month, day, hourUT);
  const ecl = _moonEclipticOfDate(jde);
  const eq = _moonEclToEq(ecl.lambda, ecl.beta, _moonMeanObliquityDeg(jde));
  return { ra: eq.ra, dec: eq.dec, dist: ecl.dist, lambda: ecl.lambda, beta: ecl.beta, jde };
}

// Topocentric semi-diameter of the Moon, degrees: its distance from the observer is shorter than
// from the Earth's centre by ~R*sin(altitude) (Meeus ch. 55, first-order form), up to ~1.7% at the
// zenith.
function _moonSemiDiamDeg(moon) {
  const sinPi = 6378.14 / moon.dist;
  const distTopo = moon.dist * (1 - sinPi * Math.sin((moon.elTrue !== undefined ? moon.elTrue : moon.el) * _MOON_D2R));
  return Math.asin(1737.4 / distTopo) / _MOON_D2R;
}
// [a (au), e, I, L, long.peri, long.node] at J2000 and per Julian century, degrees for angles
const PLANET_ELEMENTS = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
            [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
            [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
            [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
            [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
            [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
            [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
            [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};
// Display: name, dot colour (each planet's familiar naked-eye tint), magnitude law, radius (km,
// for its silhouette in a transit)
const PLANETS = [
  { key: 'mercury', name: 'Mercury', radiusKm: 2439.7, color: '#cbbba6', mag: (r, R, fv) => -0.36 + 5 * Math.log10(r * R) + 0.027 * fv + 2.2e-13 * fv ** 6 },
  { key: 'venus',   name: 'Venus',   radiusKm: 6051.8,   color: '#fff6dc', mag: (r, R, fv) => -4.34 + 5 * Math.log10(r * R) + 0.013 * fv + 4.2e-7 * fv ** 3 },
  { key: 'mars',    name: 'Mars',    radiusKm: 3389.5,    color: '#ff8a5c', mag: (r, R, fv) => -1.51 + 5 * Math.log10(r * R) + 0.016 * fv },
  { key: 'jupiter', name: 'Jupiter', radiusKm: 69911, color: '#f3dfb8', mag: (r, R, fv) => -9.25 + 5 * Math.log10(r * R) + 0.014 * fv },
  { key: 'saturn',  name: 'Saturn',  radiusKm: 58232,  color: '#e9cf86', mag: (r, R, fv, ring) => -9.0 + 5 * Math.log10(r * R) + 0.044 * fv + ring },
  { key: 'uranus',  name: 'Uranus',  radiusKm: 25362,  color: '#b8e6ea', faint: true, mag: (r, R, fv) => -7.15 + 5 * Math.log10(r * R) + 0.001 * fv },
  { key: 'neptune', name: 'Neptune', radiusKm: 24622,  color: '#93b4ff', faint: true, mag: (r, R, fv) => -6.90 + 5 * Math.log10(r * R) + 0.001 * fv },
];
const PLANET_LIGHT_DAYS_PER_AU = 0.0057755183;
const PLANET_OBLIQUITY_J2000 = 23.43928 * Math.PI / 180;

// Heliocentric ecliptic J2000 position [x, y, z] in au at JDE (TT).
function _planetHelio(key, jde) {
  const [e0, e1] = PLANET_ELEMENTS[key], T = (jde - 2451545.0) / 36525;
  const el = e0.map((v, i) => v + e1[i] * T);
  const [a, e] = el, d2r = Math.PI / 180;
  const I = el[2] * d2r, Om = el[5] * d2r, w = (el[4] - el[5]) * d2r;
  let M = ((el[3] - el[4]) % 360 + 540) % 360 - 180;   // -180..180
  M *= d2r;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 15; k++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    (sw * sI) * xp + (cw * sI) * yp,
  ];
}

// Semi-diameter of the Sun, degrees: 959.63" at 1 AU (Meeus ch. 55).
function _skySunSemiDiamDeg(year, month, day, hourUT) {
  const rAU = _skySunEclipticOfDate(_moonJDE(year, month, day, hourUT)).dist / 149597870.7;
  return 959.63 / 3600 / rAU;
}

// ─── Apparent position of any body for an observer given as a parameter ─────────────────────────
// body: 'sun' | 'moon' | a PLANET_ELEMENTS key ('mercury', 'venus', 'mars', 'jupiter', 'saturn',
// 'uranus', 'neptune'). latDeg is signed (north positive), lonDegEast signed (east positive).
// Returns the apparent (refracted) {az, el} in degrees (az from north through east), the equatorial
// {raDeg, decDeg} it came from (of date; the Moon topocentric) and semiDeg, the angular
// semi-diameter for the Sun and the Moon, 0 for a planet. Same results as the app's own
// state-reading functions (_moonAzEl, _nightSkySunAzEl, _planetPositions + _skyStarAzEl), including
// their clamp of a latitude of exactly 0 or 90 to 0.1 or 89.9 degrees in magnitude.
function _skyBodyAzEl(body, year, month, day, hourUT, latDeg, lonDegEast) {
  const latMag = Math.abs(latDeg) === 0 ? 0.1 : Math.abs(latDeg) === 90 ? 89.9 : Math.abs(latDeg);
  const latSigned = (latDeg < 0 ? -1 : 1) * latMag;
  const lst = _skySiderealTimeHours(year, month, day, hourUT, lonDegEast);
  const jde = _moonJDE(year, month, day, hourUT);
  let ra, dec, semiDeg = 0, g = null;
  if (body === 'sun') {
    const eq = _moonEclToEq(_skySunEclipticOfDate(jde).lambda, 0, _moonMeanObliquityDeg(jde));
    ra = eq.ra; dec = eq.dec;
    semiDeg = _skySunSemiDiamDeg(year, month, day, hourUT);
  } else if (body === 'moon') {
    g = _moonGeocentric(year, month, day, hourUT);
    const topo = _moonTopocentric(g.ra, g.dec, g.dist, latSigned, lst);
    ra = topo.ra; dec = topo.dec;
  } else {
    if (!PLANET_ELEMENTS[body] || body === 'earth') throw new Error('_skyBodyAzEl: unknown body ' + body);
    // Geocentric J2000 RA/Dec with light time, as _planetPositions, then precessed to the date.
    const earth = _planetHelio('earth', jde);
    let helio = _planetHelio(body, jde), geo, R = 0;
    for (let k = 0; k < 3; k++) {
      geo = [helio[0] - earth[0], helio[1] - earth[1], helio[2] - earth[2]];
      R = Math.hypot(...geo);
      helio = _planetHelio(body, jde - R * PLANET_LIGHT_DAYS_PER_AU);
    }
    geo = [helio[0] - earth[0], helio[1] - earth[1], helio[2] - earth[2]];
    R = Math.hypot(...geo);
    const ce = Math.cos(PLANET_OBLIQUITY_J2000), se = Math.sin(PLANET_OBLIQUITY_J2000);
    const x = geo[0], y = ce * geo[1] - se * geo[2], z = se * geo[1] + ce * geo[2];
    const q = _skyJ2000ToDate((Math.atan2(y, x) * 180 / Math.PI + 360) % 360, Math.asin(z / R) * 180 / Math.PI, jde);
    ra = q.ra; dec = q.dec;
  }
  const p = _skyRaDecToAzEl(ra, dec, lst, latSigned);
  if (g) {
    semiDeg = _moonSemiDiamDeg({ dist: g.dist, el: p.el, elTrue: p.elTrue });
  }
  return { az: p.az, el: p.el, raDeg: ra, decDeg: dec, semiDeg };
}
