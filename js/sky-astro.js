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
