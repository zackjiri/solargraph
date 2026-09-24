// ─── The Moon (Night Sky) ───────────────────────────────────────────────────────────────────────
// Ephemeris, phase, age and rise/set for Night Sky's own Moon. Drawing entry points used by both
// Night Sky sub-modes (Sky Map, Planetarium) live at the bottom of this file; which sub-mode calls
// them, and the Display toggles, stay in render-nightsky.js next to the Sun's own equivalents.
//
// Position: Meeus, Astronomical Algorithms (2nd ed.) ch. 47 - the full truncated ELP-2000/82 series
// (tables 47.A/47.B), ~10" in longitude and ~4" in latitude. Latitude beta is what puts the Moon up
// to 5.1 deg off the ecliptic. The series gives geocentric ecliptic coordinates referred to the MEAN
// equinox of date; they are rotated to equatorial with the mean obliquity of date (Meeus 22.2) and
// then precessed back to J2000 (Meeus ch. 21), the frame the star catalog (data/celestial) is in -
// the app applies no precession to the stars, so a Moon left in "of date" coordinates would sit
// ~0.36 deg (2026) off the stars it is drawn among. Topocentric parallax (Meeus ch. 40, WGS84) is
// applied last: the Moon's horizontal parallax is ~1 deg, i.e. two of its own diameters near the
// horizon. The result goes through the same _skyRaDecToAzEl() as every star.
//
// Time: the series runs in dynamical time (TT). Night Sky's clock is UT, so TT = UT + deltaT, with
// deltaT from the Espenak-Meeus polynomial for 2005-2050 (~69 s in 2026 - the Moon moves ~0.01 deg
// in that time; outside 2005-2050 the polynomial still gives a usable few-minute estimate).

const _MOON_D2R = Math.PI / 180;

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

function _moonNorm360(x) { return ((x % 360) + 360) % 360; }

// deltaT = TT - UT in seconds (Espenak & Meeus polynomial, valid 2005-2050).
function _moonDeltaTSec(year) {
  const t = year - 2000;
  return 62.92 + 0.32217 * t + 0.005589 * t * t;
}
// Julian Ephemeris Day (TT) for a Night Sky UT instant.
function _moonJDE(year, month, day, hourUT) {
  return _skyToJulianDateUT(year, month, day, hourUT) + _moonDeltaTSec(year) / 86400;
}

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
// J2000 -> mean equinox of jde (Meeus 21.4). Used only to verify the inverse below.
function _moonPrecessFromJ2000(ra0, dec0, jde) {
  const { zeta, z, theta } = _moonPrecessionAngles(jde);
  const a = (ra0 + zeta) * _MOON_D2R, d = dec0 * _MOON_D2R, th = theta * _MOON_D2R;
  const A = Math.cos(d) * Math.sin(a);
  const B = Math.cos(th) * Math.cos(d) * Math.cos(a) - Math.sin(th) * Math.sin(d);
  const C = Math.sin(th) * Math.cos(d) * Math.cos(a) + Math.cos(th) * Math.sin(d);
  return { ra: _moonNorm360(Math.atan2(A, B) / _MOON_D2R + z), dec: Math.asin(C) / _MOON_D2R };
}
// Mean equinox of jde -> J2000: the exact inverse rotation of _moonPrecessFromJ2000.
function _moonPrecessToJ2000(ra, dec, jde) {
  const { zeta, z, theta } = _moonPrecessionAngles(jde);
  const a = (ra - z) * _MOON_D2R, d = dec * _MOON_D2R, th = theta * _MOON_D2R;
  const A = Math.cos(d) * Math.sin(a);
  const B = Math.cos(th) * Math.cos(d) * Math.cos(a) + Math.sin(th) * Math.sin(d);
  const C = -Math.sin(th) * Math.cos(d) * Math.cos(a) + Math.cos(th) * Math.sin(d);
  return { ra: _moonNorm360(Math.atan2(A, B) / _MOON_D2R - zeta), dec: Math.asin(C) / _MOON_D2R };
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

// Geocentric Moon, J2000 RA/Dec (degrees) + distance (km), plus the of-date ecliptic longitude/
// latitude the phase and age below work from.
function _moonGeocentric(year, month, day, hourUT) {
  const jde = _moonJDE(year, month, day, hourUT);
  const ecl = _moonEclipticOfDate(jde);
  const eqDate = _moonEclToEq(ecl.lambda, ecl.beta, _moonMeanObliquityDeg(jde));
  const eq = _moonPrecessToJ2000(eqDate.ra, eqDate.dec, jde);
  return { ra: eq.ra, dec: eq.dec, dist: ecl.dist, lambda: ecl.lambda, beta: ecl.beta, jde };
}

// Topocentric Moon for Night Sky's own current Location: {az, el} (degrees, same convention as
// _skyStarAzEl) plus the J2000 RA/Dec it came from. Same LAT===0/90 clamp as _skyStarAzEl.
function _moonAzEl(year, month, day, hourUT) {
  const g = _moonGeocentric(year, month, day, hourUT);
  const latMag = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;
  const latSigned = hemisphere * latMag;
  const lst = _skySiderealTimeHours(year, month, day, hourUT, lonHemisphere * LONG);
  const topo = _moonTopocentric(g.ra, g.dec, g.dist, latSigned, lst);
  const p = _skyRaDecToAzEl(topo.ra, topo.dec, lst, latSigned);
  return { az: p.az, el: p.el, ra: topo.ra, dec: topo.dec, dist: g.dist };
}

// ─── Phase and age ──────────────────────────────────────────────────────────────────────────────
// Geocentric Sun, low-precision (Meeus ch. 25, ~0.01 deg): ecliptic longitude referred to the same
// mean equinox of date as _moonEclipticOfDate (aberration applied, nutation left out - in the
// Moon's phase and age it would be added to both bodies and cancel; for the Sun's own position it
// is ~17") and distance in km. Shared by the Moon's phase/age below and by the Sun Night Sky draws
// (_nightSkySunAzEl, render-nightsky.js), so both work from one and the same Sun.
function _skySunEclipticOfDate(jde) {
  const T = (jde - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * _MOON_D2R;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const nu = M + C * _MOON_D2R;
  const rAU = 1.000001018 * (1 - e * e) / (1 + e * Math.cos(nu));
  return { lambda: _moonNorm360(L0 + C - 0.00569), dist: rAU * 149597870.7 };
}

// Illuminated fraction k (0..1) and phase angle i (degrees) of the geocentric Moon (Meeus 48.2/
// 48.3, ecliptic form: the Sun's own latitude is taken as 0).
function _moonPhase(jde) {
  const m = _moonEclipticOfDate(jde), s = _skySunEclipticOfDate(jde);
  const cosPsi = Math.cos(m.beta * _MOON_D2R) * Math.cos((m.lambda - s.lambda) * _MOON_D2R);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const i = Math.atan2(s.dist * Math.sin(psi), m.dist - s.dist * Math.cos(psi));
  return { k: (1 + Math.cos(i)) / 2, i: i / _MOON_D2R };
}

// Sun-Moon elongation in ecliptic longitude, normalised to (-180, 180] deg: 0 at new moon,
// growing ~12.19 deg/day.
function _moonLongitudeElongation(jde) {
  const d = _moonEclipticOfDate(jde).lambda - _skySunEclipticOfDate(jde).lambda;
  return ((d + 180) % 360 + 360) % 360 - 180;
}
// Age of the Moon in days: time since the most recent new moon (Sun and Moon at equal ecliptic
// longitude). Starts from the elongation divided by the mean synodic rate and refines with the same
// step against the real elongation; converges to well under a minute in 3-4 steps.
const _MOON_SYNODIC_RATE = 360 / 29.530589;   // deg/day
function _moonAgeDays(jde) {
  let e = _moonLongitudeElongation(jde);
  if (e < 0) e += 360;   // waning half: the last new moon is still behind us
  let t = jde - e / _MOON_SYNODIC_RATE;
  for (let n = 0; n < 6; n++) {
    const de = _moonLongitudeElongation(t);
    t -= de / _MOON_SYNODIC_RATE;
    if (Math.abs(de) < 1e-5) break;
  }
  return jde - t;
}

// ─── Rise and set ───────────────────────────────────────────────────────────────────────────────
// Geometric definition, as everywhere else in the app: the CENTRE of the body at elevation 0 (for
// the Moon the topocentric centre), no refraction, no semi-diameter. Searched over the LOCAL
// calendar day (00:00-24:00 at the shared Time zone) containing the given UT instant: a coarse
// 10-minute sweep finds each sign change of the elevation, bisection refines it to ~0.1 s.
// elevAt(jd) returns {az, el} for a Julian Date (UT). Returns {rise, set} as {jd, az} or null
// (the Moon misses a rise or a set on about one day a month; the Sun at polar latitudes), plus
// alwaysUp/alwaysDown for a day with no crossing at all.
const _MOON_RISESET_STEP_DAYS = 10 / 1440;
function _moonLocalDayStartJD(jdUT) {
  const tz = typeof timeZoneHours !== 'undefined' ? timeZoneHours : 0;
  const localJD = jdUT + tz / 24;
  return Math.floor(localJD - 0.5) + 0.5 - tz / 24;
}
function _moonRiseSetOnLocalDay(jdUT, elevAt) {
  const start = _moonLocalDayStartJD(jdUT);
  let rise = null, set = null, anyUp = false;
  let jdPrev = start, pPrev = elevAt(start);
  if (pPrev.el >= 0) anyUp = true;
  const n = Math.round(1 / _MOON_RISESET_STEP_DAYS);
  for (let s = 1; s <= n; s++) {
    const jd = start + s / n;
    const p = elevAt(jd);
    if (p.el >= 0) anyUp = true;
    if ((pPrev.el >= 0) !== (p.el >= 0)) {
      let lo = jdPrev, hi = jd, eLo = pPrev.el, hit = p;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        hit = elevAt(mid);
        if ((hit.el >= 0) === (eLo >= 0)) { lo = mid; eLo = hit.el; } else { hi = mid; }
        if (hi - lo < 1e-6) break;
      }
      const ev = { jd: (lo + hi) / 2, az: hit.az };
      if (pPrev.el < 0) { if (!rise) rise = ev; } else { if (!set) set = ev; }
    }
    jdPrev = jd; pPrev = p;
  }
  return { rise, set, alwaysUp: !rise && !set && anyUp, alwaysDown: !rise && !set && !anyUp };
}
function _moonElevAtJD(jd) {
  const r = _skyFromJulianDateUT(jd);
  return _moonAzEl(r.year, r.month, r.day, r.hourUT);
}
function _moonSunElevAtJD(jd) {
  const r = _skyFromJulianDateUT(jd);
  return _nightSkySunAzEl(r.year, r.month, r.day, r.hourUT);
}

// ─── Drawing ────────────────────────────────────────────────────────────────────────────────────
// Disc sizes. Planetarium draws the Sun and the Moon at their TRUE angular size (the zoom goes up to
// 8x so the phase reads - at 8x a semi-diameter of ~0.27 deg is 12-18 px on a typical canvas), with
// a floor of NIGHTSKY_DISC_MIN_R so a disc never shrinks into a flickering sub-pixel dot when zoomed
// out; the floor only applies where the phase could not be seen anyway. Sky Map has no zoom and
// shows the whole hemisphere at ~3 px/deg, where the true disc would be under a pixel - it keeps a
// small fixed symbol (NIGHTSKY_SKYMAP_DISC_R). Labels (Display "Labels") keep both findable.
const NIGHTSKY_DISC_MIN_R = 2;
const NIGHTSKY_SKYMAP_DISC_R = 3;
// Topocentric semi-diameter of the Moon, degrees: its distance from the observer is shorter than
// from the Earth's centre by ~R*sin(altitude) (Meeus ch. 55, first-order form), up to ~1.7% at the
// zenith.
function _moonSemiDiamDeg(moon) {
  const sinPi = 6378.14 / moon.dist;
  const distTopo = moon.dist * (1 - sinPi * Math.sin(moon.el * _MOON_D2R));
  return Math.asin(1737.4 / distTopo) / _MOON_D2R;
}
// Semi-diameter of the Sun, degrees: 959.63" at 1 AU (Meeus ch. 55).
function _skySunSemiDiamDeg(year, month, day, hourUT) {
  const rAU = _skySunEclipticOfDate(_moonJDE(year, month, day, hourUT)).dist / 149597870.7;
  return 959.63 / 3600 / rAU;
}
// A disc stays on screen until its UPPER limb has gone below the horizon, not just its centre - so
// an eclipse near the horizon doesn't end abruptly the moment the Moon's centre dips under it. The
// part already below is hidden by clipping to the sky (_nightSkyClipToSky, render-nightsky.js).
// Rise/set times in the info panel stay the centre's (the app's geometric convention).
function _nightSkyDiscAboveHorizon(el, semiDeg) {
  return el >= -semiDeg;
}
// Screen radius in Planetarium for a semi-diameter in degrees: the equidistant projection's own
// radial scale, FOCAL*scale px per radian (exact at the view centre; towards the rim the tangential
// scale grows, which a circle cannot show - negligible at the zooms where the disc is big enough to
// matter, since the field there is narrow).
function _nightSkyPlanetDiscRadiusPx(layout, semiDeg) {
  return Math.max(NIGHTSKY_DISC_MIN_R, _nightSkyPlanet3D.FOCAL * layout.scale * semiDeg * _MOON_D2R);
}
const MOON_PATH_COLOR_OUTLINE = 'rgba(0,0,0,0.85)';
const MOON_PATH_COLOR_FILL = 'rgba(190,205,235,0.9)';   // silver-blue, apart from the Sun path's green
const MOON_PATH_STEP_H = 0.05;                          // same sampling as the Sun's path

function _moonHexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function _moonMix(a, b, t) {
  const A = _moonHexToRgb(a), B = _moonHexToRgb(b);
  return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')';
}
// Theme colours. The outline keeps the disc findable even at new moon, when the unlit side is all
// there is; on the white light-theme sky the lit side needs the dark outline to read at all.
function _moonColors() {
  return document.body.classList.contains('light')
    ? { lit: '#f4eed6', dark: '#6e7680', shine: '#aab1ba', outline: 'rgba(0,0,0,0.6)' }
    : { lit: '#ecebe4', dark: '#1c2029', shine: '#5a6272', outline: 'rgba(200,210,225,0.45)' };
}

// Canvas angle (radians, canvas y down) from the Moon's screen position towards the Sun: a point
// 0.5 deg from the Moon along the great circle to the Sun, projected with the same projection as the
// disc. Works unchanged for the mirrored Sky Map and for any Planetarium camera, and makes the lit
// side point at the Sun disc Night Sky actually draws.
function _moonBrightLimbAngle(moon, sun, project) {
  const m = _skyDomeUnitVec(moon.az, moon.el), s = _skyDomeUnitVec(sun.az, sun.el);
  const dot = _sd3Dot(m, s);
  let t = [s[0] - dot * m[0], s[1] - dot * m[1], s[2] - dot * m[2]];
  const tl = Math.hypot(t[0], t[1], t[2]);
  if (tl < 1e-9) return null;   // exactly at conjunction/opposition: no defined bright limb
  t = t.map((v) => v / tl);
  const d = 0.5 * _MOON_D2R;
  const p = [m[0] * Math.cos(d) + t[0] * Math.sin(d), m[1] * Math.cos(d) + t[1] * Math.sin(d), m[2] * Math.cos(d) + t[2] * Math.sin(d)];
  const pAz = _moonNorm360(Math.atan2(p[0], p[1]) / _MOON_D2R), pEl = Math.asin(Math.max(-1, Math.min(1, p[2]))) / _MOON_D2R;
  const a = project(moon.az, moon.el), b = project(pAz, pEl);
  if (!a || !b) return null;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Phase disc at (x, y): the bright half-disc towards brightAngle, closed by the terminator - a
// half-ellipse with semi-axis r*(2k-1) along the Sun direction (Meeus 48.1: k = (1 + cos i)/2, the
// terminator is the disc's limb foreshortened by cos i). The unlit part carries earthshine, whose
// strength follows the Earth's own phase as seen from the Moon (~1 - k): strongest at a thin
// crescent, gone at full moon.
function _moonDrawDisc(ctx, x, y, r, k, brightAngle) {
  const c = _moonColors();
  const shine = Math.pow(1 - k, 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = _moonMix(c.dark, c.shine, shine);
  ctx.fill();
  if (brightAngle !== null && k > 0.001) {
    ctx.rotate(brightAngle);
    const e = r * (2 * k - 1);
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);   // bright limb, through +x (towards the Sun)
    // Terminator back from bottom to top: through -x for a gibbous Moon (e > 0), through +x for a
    // crescent (e < 0).
    ctx.ellipse(0, 0, Math.max(Math.abs(e), 1e-3), r, 0, Math.PI / 2, 3 * Math.PI / 2, e < 0);
    ctx.closePath();
    ctx.fillStyle = c.lit;
    ctx.fill();
    ctx.rotate(-brightAngle);
  } else if (brightAngle === null && k > 0.5) {
    ctx.fillStyle = c.lit;   // opposition: fully lit, no direction needed
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = c.outline; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

// Sky Map (flat polar) sub-mode.
function _nightSkyDrawMoonDisc(ctx, layout) {
  const moon = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  if (!_nightSkyDiscAboveHorizon(moon.el, _moonSemiDiamDeg(moon))) return;
  const sun = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const project = (az, el) => _skyDomePoint(layout.cx, layout.cy, layout.R, az, el);
  const pt = project(moon.az, moon.el);
  const k = _moonPhase(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)).k;
  ctx.save();
  _nightSkyClipToSky(ctx, layout);
  _moonDrawDisc(ctx, pt.x, pt.y, NIGHTSKY_SKYMAP_DISC_R, k, _moonBrightLimbAngle(moon, sun, project));
  ctx.restore();
}
function _nightSkyDrawMoonPath(ctx, layout) {
  const pts = [];
  for (const hourUT of _nightSkyMoonPassHours()) {
    pts.push(_moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, hourUT));
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, layout.R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.strokeStyle = MOON_PATH_COLOR_OUTLINE; ctx.lineWidth = 3.5;
  _nightSkyStrokePartlyVisibleRun(ctx, layout, pts);
  ctx.strokeStyle = MOON_PATH_COLOR_FILL; ctx.lineWidth = 1.5;
  _nightSkyStrokePartlyVisibleRun(ctx, layout, pts);
  ctx.restore();
}

// Planetarium sub-mode.
function _nightSkyDrawPlanetMoon(ctx, layout) {
  const moon = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const semi = _moonSemiDiamDeg(moon);
  if (!_nightSkyDiscAboveHorizon(moon.el, semi)) return;
  const proj = _nightSkyPlanetProject(layout, moon.az, moon.el);
  if (!proj.visible) return;
  const sun = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const project = (az, el) => { const p = _nightSkyPlanetProject(layout, az, el); return p.visible ? p : null; };
  const k = _moonPhase(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)).k;
  ctx.save();
  _nightSkyClipToSky(ctx, layout);
  ctx.globalAlpha = proj.alpha;
  const r = _nightSkyPlanetDiscRadiusPx(layout, semi);
  _moonDrawDisc(ctx, proj.x, proj.y, r, k, _moonBrightLimbAngle(moon, sun, project));
  ctx.restore();
}
// Same horizon-crossing construction as _nightSkyPlanetBuildSunPathPts, with the Moon's position,
// over the Moon's current pass (_nightSkyMoonPassHours).
function _nightSkyPlanetBuildMoonPathPts() {
  const plotPts = [];
  let prev = null;   // {hourUT, el}
  for (const hourUT of _nightSkyMoonPassHours()) {
    const m = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, hourUT);
    if (prev && (prev.el >= 0) !== (m.el >= 0)) {
      const h0 = prev.hourUT, h1 = hourUT;
      const cross = _nightSkyBisectHorizon(
        (t) => _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, h0 + (h1 - h0) * t),
        prev.el, m.el
      );
      plotPts.push({ az: cross.az, el: Math.max(0, cross.el), breakBefore: prev.el < 0 });
    }
    if (m.el >= 0) plotPts.push({ az: m.az, el: m.el, breakBefore: false });
    prev = { hourUT, el: m.el };
  }
  return plotPts;
}
function _nightSkyDrawPlanetMoonPath(ctx, layout) {
  const pts = _nightSkyPlanetBuildMoonPathPts();
  ctx.save();
  ctx.lineWidth = 3.5;
  _nightSkyPlanetStrokeRun(ctx, layout, pts, MOON_PATH_COLOR_OUTLINE);
  ctx.lineWidth = 1.5;
  _nightSkyPlanetStrokeRun(ctx, layout, pts, MOON_PATH_COLOR_FILL);
  ctx.restore();
}

// ─── Sun's and Moon's path: the current pass ────────────────────────────────────────────────────
// Both paths show the pass across the sky that belongs to the scene being watched, not a fixed UT
// day (which made the Moon's path jump at 00:00 UTC while it stood high in the sky): from the rise
// to the set of the pass the body is on now, or - while it is below the horizon - of the next one.
// The path therefore stays put the whole time the body is up and changes only at its set, when the
// disc disappears too. Rise/set here are the centre at 0 deg, the same geometric definition as the
// info panel. A body that doesn't set within NIGHTSKY_PASS_SEARCH_DAYS either way (circumpolar)
// gets a +-12 h window around now; one that doesn't rise within it gets no path.
const NIGHTSKY_PASS_STEP_DAYS = 10 / 1440;
const NIGHTSKY_PASS_SEARCH_DAYS = 1.5;
// From jd, steps in direction dir (+1/-1) until the body's up/down state becomes wantUp; returns the
// bisected crossing JD, or null if none within the search span.
function _nightSkyPassScan(elevAt, jd, dir, wantUp) {
  let jPrev = jd, upPrev = elevAt(jd).el >= 0;
  const n = Math.round(NIGHTSKY_PASS_SEARCH_DAYS / NIGHTSKY_PASS_STEP_DAYS);
  for (let i = 1; i <= n; i++) {
    const j = jd + dir * i * NIGHTSKY_PASS_STEP_DAYS;
    const up = elevAt(j).el >= 0;
    if (up === wantUp && upPrev !== wantUp) {
      let a = jPrev, b = j;   // state at a is !wantUp, at b wantUp
      for (let k = 0; k < 30 && Math.abs(b - a) > 1e-6; k++) {
        const m = (a + b) / 2;
        if ((elevAt(m).el >= 0) === wantUp) b = m; else a = m;
      }
      return (a + b) / 2;
    }
    jPrev = j; upPrev = up;
  }
  return null;
}
// Cached per body: a pass stays valid for every "now" in [validFrom, validTo) at the same location,
// so dragging/animating time re-scans only when the watched moment leaves that span.
const _nightSkyPassCache = {};
function _nightSkyCurrentPass(key, elevAt, jdNow) {
  const loc = [LAT, hemisphere, LONG, lonHemisphere].join('|');
  const c = _nightSkyPassCache[key];
  if (c && c.loc === loc && jdNow >= c.validFrom && jdNow < c.validTo) return c.pass;

  let pass, validFrom = jdNow, validTo = jdNow;   // empty span = don't reuse
  if (elevAt(jdNow).el >= 0) {
    const rise = _nightSkyPassScan(elevAt, jdNow, -1, false);
    const set = _nightSkyPassScan(elevAt, jdNow, +1, false);
    if (rise !== null && set !== null) {
      pass = { jd0: rise, jd1: set };
      validFrom = rise; validTo = set;
    } else {
      pass = { jd0: rise !== null ? rise : jdNow - 0.5, jd1: set !== null ? set : jdNow + 0.5 };
    }
  } else {
    const rise = _nightSkyPassScan(elevAt, jdNow, +1, true);
    if (rise === null) {
      pass = null;
    } else {
      const set = _nightSkyPassScan(elevAt, rise + 1e-5, +1, false);
      pass = { jd0: rise, jd1: set !== null ? set : rise + 0.5 };
      const prevSet = _nightSkyPassScan(elevAt, jdNow, -1, true);
      if (prevSet !== null) { validFrom = prevSet; validTo = rise; }
    }
  }
  _nightSkyPassCache[key] = { loc, validFrom, validTo, pass };
  return pass;
}
// Sample hours for a body's path, as hourUT relative to 00:00 UT of the selected Night Sky date
// (may run below 0 or past 24 - every position function goes through the Julian Date). One step of
// margin on both ends, so the path reaches the horizon: both sub-modes already cut it exactly there.
function _nightSkyPassHours(key, elevAt, stepH) {
  const jdNow = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const pass = _nightSkyCurrentPass(key, elevAt, jdNow);
  if (!pass) return [];
  const jdDay0 = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, 0);
  const h0 = (pass.jd0 - jdDay0) * 24 - stepH, h1 = (pass.jd1 - jdDay0) * 24 + stepH;
  const hours = [];
  for (let h = h0; h < h1; h += stepH) hours.push(h);
  hours.push(h1);
  return hours;
}
function _nightSkySunPassHours() { return _nightSkyPassHours('sun', _moonSunElevAtJD, NIGHTSKY_SUN_PATH_STEP_H); }
function _nightSkyMoonPassHours() { return _nightSkyPassHours('moon', _moonElevAtJD, MOON_PATH_STEP_H); }

// ─── Sun and Moon labels ────────────────────────────────────────────────────────────────────────
// Shown with Display "Labels" (#chkNightSkyNames, shared with the constellation names), each only
// while its own body is shown and its disc not yet wholly below the horizon. Same font as the
// constellation names; Sun in the disc's own amber (#e8a020, a darker shade of it on the white
// light-theme sky, where the disc colour itself reads poorly), Moon in olive brown (#8a6a00 on the
// white sky, lightened to #b89a50 on the dark one, where #8a6a00 has too little contrast).
// Each label sits just outside its disc, to the right; when the other body is close on screen (an
// eclipse, a conjunction) it moves to the side facing away from it, so the two never overlap.
const NIGHTSKY_LABEL_GAP = 4;          // px between the disc edge and the label
const NIGHTSKY_LABEL_NEAR = 60;        // px: closer than this (plus both radii) and labels part ways
function _nightSkyBodyLabelColors() {
  return document.body.classList.contains('light')
    ? { sun: '#b87a10', moon: '#8a6a00' }
    : { sun: '#e8a020', moon: '#b89a50' };
}
// bodies: [{x, y, r, text, color, alpha}] - only the ones actually drawn.
function _nightSkyDrawBodyLabels(ctx, bodies) {
  ctx.save();
  ctx.font = '10px Helvetica, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  bodies.forEach((b, i) => {
    let dx = 1, dy = 0;
    const other = bodies[1 - i];
    if (other) {
      const ox = b.x - other.x, oy = b.y - other.y, d = Math.hypot(ox, oy);
      if (d < b.r + other.r + NIGHTSKY_LABEL_NEAR) {
        if (d > 1e-6) { dx = ox / d; dy = oy / d; } else { dx = 0; dy = i === 0 ? -1 : 1; }
      }
    }
    const halfW = ctx.measureText(b.text).width / 2;
    // Centre of the text box pushed out along (dx, dy) until the box clears the disc.
    const push = b.r + NIGHTSKY_LABEL_GAP + Math.abs(dx) * halfW + Math.abs(dy) * 6;
    ctx.globalAlpha = b.alpha;
    ctx.fillStyle = b.color;
    ctx.textAlign = 'center';
    ctx.fillText(b.text, b.x + dx * push, b.y + dy * push);
  });
  ctx.restore();
}
function _nightSkyLabelsWanted() {
  return document.getElementById('chkNightSkyNames').checked;
}
// Sky Map: positions from the same projection as the discs.
function _nightSkyDrawSkyMapBodyLabels(ctx, layout) {
  if (!_nightSkyLabelsWanted()) return;
  const cols = _nightSkyBodyLabelColors(), bodies = [];
  const at = (az, el) => _skyDomePoint(layout.cx, layout.cy, layout.R, az, el);
  if (document.getElementById('chkNightSkySun').checked) {
    const s = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (_nightSkyDiscAboveHorizon(s.el, _skySunSemiDiamDeg(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT))) { const p = at(s.az, s.el); bodies.push({ x: p.x, y: p.y, r: NIGHTSKY_SKYMAP_DISC_R, text: 'Sun', color: cols.sun, alpha: 1 }); }
  }
  if (document.getElementById('chkNightSkyMoon').checked) {
    const m = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (_nightSkyDiscAboveHorizon(m.el, _moonSemiDiamDeg(m))) { const p = at(m.az, m.el); bodies.push({ x: p.x, y: p.y, r: NIGHTSKY_SKYMAP_DISC_R, text: 'Moon', color: cols.moon, alpha: 1 }); }
  }
  _nightSkyDrawBodyLabels(ctx, bodies);
}
// Planetarium: true-size radii and the rim fade, same as the discs.
function _nightSkyDrawPlanetBodyLabels(ctx, layout) {
  if (!_nightSkyLabelsWanted()) return;
  const cols = _nightSkyBodyLabelColors(), bodies = [];
  if (document.getElementById('chkNightSkySun').checked) {
    const s = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    const semi = _skySunSemiDiamDeg(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    const p = _nightSkyDiscAboveHorizon(s.el, semi) ? _nightSkyPlanetProject(layout, s.az, s.el) : null;
    if (p && p.visible) {
      const r = _nightSkyPlanetDiscRadiusPx(layout, semi);
      bodies.push({ x: p.x, y: p.y, r, text: 'Sun', color: cols.sun, alpha: p.alpha });
    }
  }
  if (document.getElementById('chkNightSkyMoon').checked) {
    const m = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    const p = _nightSkyDiscAboveHorizon(m.el, _moonSemiDiamDeg(m)) ? _nightSkyPlanetProject(layout, m.az, m.el) : null;
    if (p && p.visible) bodies.push({ x: p.x, y: p.y, r: _nightSkyPlanetDiscRadiusPx(layout, _moonSemiDiamDeg(m)), text: 'Moon', color: cols.moon, alpha: p.alpha });
  }
  _nightSkyDrawBodyLabels(ctx, bodies);
}

// ─── Info panel (top-left, Visualization only) ──────────────────────────────────────────────────
// Same look and collapse arrow as the Sun Graph's own panel (#sgStatusWrap). Rise/set searches are
// cached per local day and location, since the panel refreshes on every redraw (drag, animation).
let _moonRiseSetCache = { key: null, sun: null, moon: null };
function _moonRiseSetCached(jdUT) {
  const tz = typeof timeZoneHours !== 'undefined' ? timeZoneHours : 0;
  const key = [_moonLocalDayStartJD(jdUT).toFixed(5), LAT, hemisphere, LONG, lonHemisphere, tz].join('|');
  if (_moonRiseSetCache.key !== key) {
    _moonRiseSetCache = {
      key,
      sun: _moonRiseSetOnLocalDay(jdUT, _moonSunElevAtJD),
      moon: _moonRiseSetOnLocalDay(jdUT, _moonElevAtJD),
    };
  }
  return _moonRiseSetCache;
}
function _moonFmtLocalTime(ev) {
  if (!ev) return '—';
  const tz = typeof timeZoneHours !== 'undefined' ? timeZoneHours : 0;
  const r = _skyFromJulianDateUT(ev.jd);
  return _nightSkyFmtHM(r.hourUT + tz);
}
function _moonFmtAz(ev) {
  return ev ? Math.round(_moonNorm360(ev.az)) + '° ' + azimutToDir(ev.az) : '—';
}
function _nightSkyUpdateStatusPanel() {
  const el = (id) => document.getElementById(id);
  if (!el('nightSkyStatus')) return;
  const jd = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const rs = _moonRiseSetCached(jd);
  const sun = rs.sun, moon = rs.moon;

  if (sun.alwaysUp || sun.alwaysDown) {
    el('nsDayLen').textContent = sun.alwaysUp ? '24:00' : '00:00';
  } else if (sun.rise && sun.set && sun.set.jd > sun.rise.jd) {
    el('nsDayLen').textContent = _nightSkyFmtHM((sun.set.jd - sun.rise.jd) * 24);
  } else {
    el('nsDayLen').textContent = '—';   // only one of the two falls on this local day
  }
  el('nsSunRiseSet').textContent = _moonFmtLocalTime(sun.rise) + ' / ' + _moonFmtLocalTime(sun.set);
  el('nsSunRiseSetAz').textContent = _moonFmtAz(sun.rise) + ' / ' + _moonFmtAz(sun.set);
  el('nsMoonRiseSet').textContent = _moonFmtLocalTime(moon.rise) + ' / ' + _moonFmtLocalTime(moon.set);
  el('nsMoonRiseSetAz').textContent = _moonFmtAz(moon.rise) + ' / ' + _moonFmtAz(moon.set);

  const jde = _moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  el('nsMoonIllum').textContent = (_moonPhase(jde).k * 100).toFixed(1) + ' %';
  el('nsMoonAge').textContent = _moonAgeDays(jde).toFixed(1) + ' days';
}
let _nightSkyStatusCollapsed = false;
function _nightSkySetStatusCollapsed(c) {
  _nightSkyStatusCollapsed = c;
  const w = document.getElementById('nightSkyStatusWrap'), t = document.getElementById('nightSkyStatusToggle');
  if (w) w.classList.toggle('collapsed', c);
  if (t) t.textContent = c ? '▼' : '▲';   // up = shown, down = hidden
}
(function () {
  const tog = document.getElementById('nightSkyStatusToggle');
  if (tog) tog.addEventListener('click', (e) => { e.stopPropagation(); _nightSkySetStatusCollapsed(!_nightSkyStatusCollapsed); });
})();
