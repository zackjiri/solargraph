// ─── The Moon (Night Sky) ───────────────────────────────────────────────────────────────────────
// Ephemeris, phase, age and rise/set for Night Sky's own Moon. Drawing entry points used by both
// Night Sky sub-modes (Sky Map, Planetarium) live at the bottom of this file; which sub-mode calls
// them, and the Display toggles, stay in render-nightsky.js next to the Sun's own equivalents.
//
// Position: Meeus, Astronomical Algorithms (2nd ed.) ch. 47 - the full truncated ELP-2000/82 series
// (tables 47.A/47.B), ~10" in longitude and ~4" in latitude. Latitude beta is what puts the Moon up
// to 5.1 deg off the ecliptic. The series gives geocentric ecliptic coordinates referred to the MEAN
// equinox of date; they are rotated to equatorial with the mean obliquity of date (Meeus 22.2) and
// stay in the equinox of date - the frame Night Sky works in, the J2000 star catalog being
// precessed to it instead (_skyStarAzEl, render-nightsky.js). Topocentric parallax (Meeus ch. 40, WGS84) is
// applied last: the Moon's horizontal parallax is ~1 deg, i.e. two of its own diameters near the
// horizon. The result goes through the same _skyRaDecToAzEl() as every star.
//
// Time: the series runs in dynamical time (TT). Night Sky's clock is UT, so TT = UT + deltaT, with
// deltaT from NASA's Espenak-Meeus polynomials (core.js _moonDeltaTSec; ~69 s in 2026, ~5 min in
// 1415 - the Moon moves ~0.5 deg an hour, so deltaT matters for historical eclipses).


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

// Geocentric Moon, RA/Dec of date (degrees) + distance (km), plus the ecliptic longitude/latitude
// of date the phase and age below work from.
function _moonGeocentric(year, month, day, hourUT) {
  const jde = _moonJDE(year, month, day, hourUT);
  const ecl = _moonEclipticOfDate(jde);
  const eq = _moonEclToEq(ecl.lambda, ecl.beta, _moonMeanObliquityDeg(jde));
  return { ra: eq.ra, dec: eq.dec, dist: ecl.dist, lambda: ecl.lambda, beta: ecl.beta, jde };
}

// Topocentric Moon for Night Sky's own current Location: {az, el} (degrees, same convention as
// _skyStarAzEl) plus the topocentric RA/Dec of date it came from. Same LAT===0/90 clamp as _skyStarAzEl.
function _moonAzEl(year, month, day, hourUT) {
  const g = _moonGeocentric(year, month, day, hourUT);
  const latMag = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;
  const latSigned = hemisphere * latMag;
  const lst = _skySiderealTimeHours(year, month, day, hourUT, lonHemisphere * LONG);
  const topo = _moonTopocentric(g.ra, g.dec, g.dist, latSigned, lst);
  const p = _skyRaDecToAzEl(topo.ra, topo.dec, lst, latSigned);
  return { az: p.az, el: p.el, elTrue: p.elTrue, ra: topo.ra, dec: topo.dec, dist: g.dist };
}

// ─── Earth's shadow (lunar eclipses) ────────────────────────────────────────────────────────────
// Centre: the point opposite the Sun's apparent position (ecliptic longitude + 180 deg, latitude 0),
// taken at the Moon's own distance - the shadow is a real cone out there, so the observer sees it
// shifted by the same topocentric parallax as the Moon (up to ~1 deg), then the same refraction.
// Radii, geocentric: Danjon's rule as in NASA's lunar eclipse predictions (F. Espenak):
//   umbra = 1.01 pi_M - s_S + pi_S,  penumbra = 1.01 pi_M + s_S + pi_S
// (pi_M the Moon's horizontal parallax, s_S and pi_S the Sun's semi-diameter and parallax; the 1.01
// enlarges the Earth for its atmosphere). Against NASA for 2025 Sep 07, 2026 Mar 03 and 2017 Aug 07
// both radii and the magnitudes agree to the 4th decimal; contact times come out 16-50 s off, the
// same for every contact of one eclipse - the Sun model's ~20" (core.js _skySunEclipticOfDate,
// Meeus' low-accuracy series), not the shadow geometry; the Moon itself was within 4".
// Returned radii are scaled to the Moon's topocentric size, like the disc they are drawn over.
function _moonShadow(year, month, day, hourUT, moon) {
  const jde = _moonJDE(year, month, day, hourUT);
  const sun = _skySunEclipticOfDate(jde), moonEcl = _moonEclipticOfDate(jde);
  const eq = _moonEclToEq(_moonNorm360(sun.lambda + 180), 0, _moonMeanObliquityDeg(jde));
  const latMag = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;
  const latSigned = hemisphere * latMag;
  const lst = _skySiderealTimeHours(year, month, day, hourUT, lonHemisphere * LONG);
  const topo = _moonTopocentric(eq.ra, eq.dec, moonEcl.dist, latSigned, lst);
  const p = _skyRaDecToAzEl(topo.ra, topo.dec, lst, latSigned);
  const rAU = sun.dist / 149597870.7;
  const piM = Math.asin(6378.14 / moonEcl.dist) / _MOON_D2R;
  const sS = 959.63 / 3600 / rAU, piS = 8.794 / 3600 / rAU;
  const scale = _moonSemiDiamDeg(moon) / (Math.asin(1737.4 / moonEcl.dist) / _MOON_D2R);   // geocentric -> topocentric size
  return { az: p.az, el: p.el, umbraDeg: (1.01 * piM - sS + piS) * scale, penumbraDeg: (1.01 * piM + sS + piS) * scale };
}
// The shadow over a Moon disc drawn with radius rPx at screen point a: {dx, dy, rU, rP} in px, or
// null when even the penumbra misses the Moon. The offset keeps its true angular size relative to
// the disc (so it also works for the Sky Map's fixed-size symbol), in the on-screen direction of
// the projected shadow centre. at: {year, month, day, hourUT} of the instant, default the selected
// one (the Sun Graph's lunar calendar passes each full Moon's).
function _moonShadowOnDisc(moon, rPx, project, at) {
  const t = at || { year: nightSkyYear, month: nightSkyMonth, day: nightSkyDay, hourUT: nightSkyHourUT };
  const sh = _moonShadow(t.year, t.month, t.day, t.hourUT, moon);
  const semi = _moonSemiDiamDeg(moon);
  const m = _skyDomeUnitVec(moon.az, moon.el), c = _skyDomeUnitVec(sh.az, sh.el);
  const sep = Math.acos(Math.max(-1, Math.min(1, _sd3Dot(m, c)))) / _MOON_D2R;
  if (sep >= sh.penumbraDeg + semi) return null;
  const pxPerDeg = rPx / semi;
  let ux = 0, uy = 0;
  const a = project(moon.az, moon.el), b = project(sh.az, sh.el);
  if (a && b) { const L = Math.hypot(b.x - a.x, b.y - a.y); if (L > 1e-9) { ux = (b.x - a.x) / L; uy = (b.y - a.y) / L; } }
  return { dx: ux * sep * pxPerDeg, dy: uy * sep * pxPerDeg, rU: sh.umbraDeg * pxPerDeg, rP: sh.penumbraDeg * pxPerDeg };
}


// ─── Phase and age ──────────────────────────────────────────────────────────────────────────────
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
// Age of the Moon in days, the way planetarium software and moon calculators state it (Stellarium
// included): the Moon's phase in the cycle expressed in days - the Sun-Moon elongation in ecliptic
// longitude (0-360 deg from new moon, i.e. the waning half continues past 180) as a fraction of the
// mean synodic month (29.530589 d, Meeus ch. 49). It is 0 at new moon and 14.77 at full moon,
// whatever this particular lunation's pace. It is NOT the time elapsed since new moon: the Moon's
// speed varies (a lunation lasts ~29.3-29.8 d), so near apogee the phase lags the elapsed time and
// near perigee it runs ahead - on 2026-09-25 17:00 UT the phase gives 13.76 d while 14.56 d had
// passed since the new moon of 11 Sep 03:26:40 UT.
const MOON_SYNODIC_MONTH_DAYS = 29.530589;
function _moonAgeDays(jde) {
  let e = _moonLongitudeElongation(jde);
  if (e < 0) e += 360;   // waning half: 180-360 deg
  return e / 360 * MOON_SYNODIC_MONTH_DAYS;
}

// ─── Rise and set ───────────────────────────────────────────────────────────────────────────────
// Standard (almanac) definition: the body's UPPER LIMB on the horizon, refraction included (elevAt
// returns the upper limb's apparent altitude - _moonElevAtJD/_moonSunElevAtJD below; for the Moon
// the topocentric position). Matches USNO/Stellarium, and the drawn disc appears/disappears at the
// same moment. Searched over the LOCAL
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
// Apparent elevation of the UPPER LIMB (refraction taken at the limb, skyUpperLimbApparentEl):
// rise and set are when it touches the horizon, the standard almanac rule shared with the Solargraph
// views (core.js). It is also exactly when the drawn disc appears/disappears
// (_nightSkyDiscAboveHorizon).
function _moonElevAtJD(jd) {
  const r = _skyFromJulianDateUT(jd);
  const m = _moonAzEl(r.year, r.month, r.day, r.hourUT);
  return { az: m.az, el: skyUpperLimbApparentEl(m.elTrue, _moonSemiDiamDeg(m)) };
}
// The Sun's rise and set on the LOCAL calendar day containing jdUT, in the same {rise, set,
// alwaysUp, alwaysDown} form as _moonRiseSetOnLocalDay, but from the app's one shared Sun event
// computation (core.js solarEventsOnDate, the same as the Sun Graph) instead of a search. Those
// events belong to solar days (around local solar noon); the solar days of the date before, of and
// after the local date are taken, and whichever events fall inside the local day are used.
function _nightSkySunRiseSetOnLocalDay(jdUT) {
  const start = _moonLocalDayStartJD(jdUT), end = start + 1;
  const tz = typeof timeZoneHours !== 'undefined' ? timeZoneHours : 0;
  const lonE = lonHemisphere * LONG;
  const mid = _skyFromJulianDateUT(start + 0.5 + tz / 24);   // the local date, as a calendar date
  const rises = [], sets = [];
  let anyPolarDay = false;
  for (const off of [-1, 0, 1]) {
    const c = _skyFromJulianDateUT(_skyToJulianDateUT(mid.year, mid.month, mid.day, 12) + off);
    const ev = solarEventsOnDate(c.year, c.month, c.day, 'day');
    if (ev.polarDay) { if (off === 0) anyPolarDay = true; continue; }
    if (ev.polarNight) continue;
    const jdOf = (trueH, eot) => _skyToJulianDateUT(c.year, c.month, c.day, trueH - eot / 60 - lonE / 15);
    rises.push(jdOf(ev.rise, ev.eotRise)); sets.push(jdOf(ev.set, ev.eotSet));
  }
  const pick = (list) => {
    const jd = list.filter(j => j >= start && j < end).sort((a, b) => a - b)[0];
    if (jd === undefined) return null;
    const r = _skyFromJulianDateUT(jd);
    return { jd, az: _nightSkySunAzEl(r.year, r.month, r.day, r.hourUT).az };
  };
  const rise = pick(rises), set = pick(sets);
  const up = _moonSunElevAtJD(start + 0.5).el >= 0;
  return { rise, set, alwaysUp: !rise && !set && (anyPolarDay || up), alwaysDown: !rise && !set && !(anyPolarDay || up) };
}
function _moonSunElevAtJD(jd) {
  const r = _skyFromJulianDateUT(jd);
  const s = _nightSkySunAzEl(r.year, r.month, r.day, r.hourUT);
  return { az: s.az, el: skyUpperLimbApparentEl(s.elTrue, _skySunSemiDiamDeg(r.year, r.month, r.day, r.hourUT)) };
}

// ─── Drawing ────────────────────────────────────────────────────────────────────────────────────
// Disc sizes. Planetarium draws the Sun and the Moon at their TRUE angular size (the zoom goes up to
// 12x so the phase reads - at 12x a semi-diameter of ~0.27 deg is 18-27 px on a typical canvas),
// but never smaller than _nightSkyBodyMinR(): the same artificial factor for both bodies times the
// largest planet dot (Venus's, PLANET_DOT_MAX_R in render-planets.js), so the two always look a
// little bigger than the brightest planet. Sky Map has no zoom and shows the whole hemisphere at
// ~3 px/deg, where the true disc would be under a pixel - it draws both at that minimum. In the
// Planetarium the minimum grows with the zoom like the stars and planets (_nightSkyStarZoomGain,
// render-nightsky.js; 1 everywhere else), so the Sun and the Moon stay larger than any of them.
const NIGHTSKY_BODY_SIZE_K = 1.2;
function _nightSkyBodyMinR() {
  return NIGHTSKY_BODY_SIZE_K * PLANET_DOT_MAX_R * _nightSkyStarZoomGain();
}
// Topocentric semi-diameter of the Moon, degrees: its distance from the observer is shorter than
// from the Earth's centre by ~R*sin(altitude) (Meeus ch. 55, first-order form), up to ~1.7% at the
// zenith.
function _moonSemiDiamDeg(moon) {
  const sinPi = 6378.14 / moon.dist;
  const distTopo = moon.dist * (1 - sinPi * Math.sin((moon.elTrue !== undefined ? moon.elTrue : moon.el) * _MOON_D2R));
  return Math.asin(1737.4 / distTopo) / _MOON_D2R;
}
// A disc stays on screen until its UPPER limb, refracted, has gone below the horizon - the same
// standard rule as rise/set (skyUpperLimbApparentEl, core.js) - not just its centre, so an eclipse
// near the horizon doesn't end abruptly the moment the Moon's centre dips under it. The part
// already below is hidden by clipping to the sky (_nightSkyClipToSky, render-nightsky.js). el is
// the APPARENT centre elevation the drawing works with.
function _nightSkyDiscAboveHorizon(el, semiDeg) {
  return skyUpperLimbApparentEl(_skyTrueFromApparentEl(el), semiDeg) >= 0;
}
// Screen radius in Planetarium for a semi-diameter in degrees: the equidistant projection's own
// radial scale, FOCAL*scale px per radian (exact at the view centre; towards the rim the tangential
// scale grows, which a circle cannot show - negligible at the zooms where the disc is big enough to
// matter, since the field there is narrow).
function _nightSkyPlanetDiscRadiusPx(layout, semiDeg) {
  return Math.max(_nightSkyBodyMinR(), _nightSkyPlanet3D.FOCAL * layout.scale * semiDeg * _MOON_D2R);
}
const MOON_PATH_COLOR_OUTLINE = 'rgba(0,0,0,0.85)';
const MOON_PATH_COLOR_FILL = 'rgba(190,205,235,0.9)';   // silver-blue, apart from the Sun path's green
const MOON_PATH_STEP_H = 0.05;                          // same sampling as the Sun's path

function _moonHexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function _moonMix(a, b, t) {
  const A = _moonHexToRgb(a), B = _moonHexToRgb(b);
  return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')';
}
// Theme colours: the lit side in a pale moonlight yellow. The outline keeps the disc findable even
// at new moon, when the unlit side is all there is; on the white light-theme sky the lit side needs
// the dark outline to read at all.
function _moonColors() {
  return document.body.classList.contains('light')
    ? { lit: '#f0e2a2', dark: '#6e7680', shine: '#aab1ba', outline: 'rgba(0,0,0,0.6)' }
    : { lit: '#f4eab8', dark: '#1c2029', shine: '#5a6272', outline: 'rgba(200,210,225,0.45)' };
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
function _moonDrawDisc(ctx, x, y, r, k, brightAngle, shadow) {
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
  if (shadow) _moonDrawShadow(ctx, r, shadow);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = c.outline; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}
// ── The Moon as it looks (Atmosphere on, dark theme: render-skyglow.js _glowShown) ─────────────
// Instead of the chart disc, every pixel of the disc is worked out from the real geometry: the
// point of the Moon's sphere it shows (normal N, from the screen offset and the line of sight m),
// lit from the Sun's actual direction. So the terminator, the tilt of the phase and its mirror image
// in the flat Sky Map all come out by themselves.
//  - Brightness by the Lommel-Seeliger law the Moon follows, 2·μ0/(μ0 + μ) (μ0 = N·sun, μ = N
//    towards the observer): a nearly flat disc that only darkens near the terminator, not a shaded
//    ball; a soft terminator over a few degrees of μ0.
//  - Albedo from NASA's map in a 256 × 128 thumbnail of the Globe's (data/moon/lroc_color_256.jpg,
//    13.7 KB; the disc is at most ~38 px across, ~4.7° of longitude a pixel, the thumbnail 1.4° a
//    texel), oriented by the Globe's IAU rotation model with libration (_nsGlobeMoonFrame), the maria
//    ~55 % darker than the highlands (MOON_REAL_ALBEDO_LO); a plain disc until it has loaded.
//  - The unlit part is left out (the sky shows through) but for earthshine, sunlight sent back by
//    the Earth: uniform over the dark side, MOON_REAL_EARTHSHINE·(1 − k)³ of the lit side's
//    brightness, so plain on a thin crescent, barely there by first quarter (next to the bright
//    half the eye does not see it) and gone by full moon.
//  - Colour of the moonlight by altitude: silvery white high up, yellow to orange low (light through
//    more air), as the Sun's (_glowSunTint) but paler.
//  - Laid on the sky as light ('screen' blending, which on a dark sky is nearly adding, but keeps a
//    low Moon's colour instead of burning it out to white on a twilight sky): bright at night, pale
//    in daylight; the earthshine shows only on a dark enough sky.
//  - Flattened by refraction near the horizon like the Sun (_nightSkyRefrFlattening), squashed along
//    the screen's vertical.
//  - In a lunar eclipse the direct light is the part of the Sun's disc left past the Earth's limb
//    (a circular segment from 0 at the umbra's edge to the full disc at the penumbra's, as in
//    _nightSkyMoonEclipseLight); in the umbra the light bent by the Earth's air, copper, coming up
//    with the eclipse's depth (grey and faint while most of the disc is still lit, full copper in
//    totality, as the Globe shows it).
const MOON_REAL_ALBEDO_LO = 0.45, MOON_REAL_EARTHSHINE = 0.13;
const MOON_REAL_HIGH = [236, 236, 228], MOON_REAL_LOW = [255, 205, 140], MOON_REAL_COPPER = [205, 78, 34];
const _moonRealBuf = { canvas: null, ctx: null };
// The thumbnail map, loaded once on first use: per texel an albedo 0..255, the luminance stretched
// between its 2nd and 98th percentile (maria to highlands).
let _moonMiniTex = null, _moonMiniLoading = false;
function _moonLoadMini() {
  if (_moonMiniTex || _moonMiniLoading) return;
  _moonMiniLoading = true;
  const img = new Image();
  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
    const src = c.getImageData(0, 0, W, H).data, n = W * H;
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = 0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2];
    const sorted = Float32Array.from(lum).sort();
    const lo = sorted[Math.floor(0.02 * n)], hi = Math.max(lo + 1, sorted[Math.floor(0.98 * n)]);
    const u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = Math.round(255 * Math.max(0, Math.min(1, (lum[i] - lo) / (hi - lo))));
    _moonMiniTex = { w: W, h: H, u };
    if (nightSkyActive) drawNightSky();
  };
  img.onerror = () => console.warn('Night Sky: failed to load the Moon thumbnail map');
  img.src = 'data/moon/lroc_color_256.jpg';
}
function _moonRealTint(el) {
  const t = Math.max(0, Math.min(1, el / 20));
  return MOON_REAL_LOW.map((c, k) => c + t * (MOON_REAL_HIGH[k] - c));
}
// Horizon frame (x east, y north, z up) -> equator of date, for the place in Location now.
function _moonHorizonToDate() {
  const D2R = Math.PI / 180;
  const latMag = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;
  const phi = hemisphere * latMag * D2R;
  const th = _skySiderealTimeHours(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT, lonHemisphere * LONG) * 15 * D2R;
  const sp = Math.sin(phi), cp = Math.cos(phi), st = Math.sin(th), ct = Math.cos(th);
  const E = [-st, ct, 0], N = [-sp * ct, -sp * st, cp], Z = [cp * ct, cp * st, sp];
  return (v) => [0, 1, 2].map(i => v[0] * E[i] + v[1] * N[i] + v[2] * Z[i]);
}
// Draws the Moon at screen point (x, y), radius r px. moon/sun: {az, el}; project(az, el) -> {x, y}
// with the view's own projection; shadow: _moonShadowOnDisc's {dx, dy, rU, rP} or null.
function _moonDrawReal(ctx, x, y, r, moon, sun, project, shadow) {
  // refraction flattening near the horizon (render-nightsky.js), along the screen's vertical
  const flat = _nightSkyRefrFlattening(moon.el, _moonSemiDiamDeg(moon)), up = _nightSkyUpAngle(project, moon.az, moon.el);
  _moonLoadMini();
  const D2R = Math.PI / 180;
  const m = _skyDomeUnitVec(moon.az, moon.el), S = _skyDomeUnitVec(sun.az, sun.el);
  // screen offsets of small steps in azimuth and altitude -> the sky tangent for a screen offset
  const d = 0.2, c0 = project(moon.az, moon.el);
  const pa = project(moon.az + d / Math.max(0.05, Math.cos(moon.el * D2R)), moon.el), pe = project(moon.az, moon.el + d);
  if (!c0 || !pa || !pe) return;
  const ea = [Math.cos(moon.az * D2R), -Math.sin(moon.az * D2R), 0];   // east-ward tangent (horizon frame)
  const ee = _sd3Cross(ea, m);                                         // up-ward tangent (d m / d el)
  const a11 = pa.x - c0.x, a21 = pa.y - c0.y, a12 = pe.x - c0.x, a22 = pe.y - c0.y, det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-9) return;
  const toDate = _moonHorizonToDate();
  const MT = _moonMiniTex, MF = MT ? _nsGlobeMoonFrame() : null;
  const k = _moonPhase(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)).k;
  const shine = MOON_REAL_EARTHSHINE * Math.pow(1 - k, 3);
  const tint = _moonRealTint(moon.el);
  // eclipse depth: the share of the Moon's diameter inside the umbra
  let tintVis = 0;
  if (shadow) {
    const dc = Math.hypot(shadow.dx, shadow.dy);
    tintVis = Math.pow(Math.max(0, Math.min(1, (shadow.rU - (dc - r)) / (2 * r))), 3);
  }
  const copperI = 0.05 + 0.25 * tintVis;
  const copper = [0, 1, 2].map(i => 150 + tintVis * (MOON_REAL_COPPER[i] - 150));
  const R = Math.ceil(r) + 1, n = 2 * R;
  const B = _moonRealBuf;
  if (!B.canvas) { B.canvas = document.createElement('canvas'); B.ctx = B.canvas.getContext('2d'); }
  if (B.canvas.width !== n || B.canvas.height !== n) { B.canvas.width = n; B.canvas.height = n; }
  const img = B.ctx.createImageData(n, n), px = img.data;
  for (let j = 0; j < n; j++) {
    const oy = j + 0.5 - R;
    for (let i = 0; i < n; i++) {
      const ox = i + 0.5 - R, q = Math.hypot(ox, oy) / r;
      const cover = Math.max(0, Math.min(1, (1 - q) * r + 0.5));   // anti-aliased limb
      if (cover <= 0) continue;
      const s = Math.min(1, q);
      // sky tangent for this offset: solve [a11 a12; a21 a22]·[p q] = [ox oy]
      const pp = (a22 * ox - a12 * oy) / det, qq = (a11 * oy - a21 * ox) / det;
      let u = [pp * ea[0] + qq * ee[0], pp * ea[1] + qq * ee[1], pp * ea[2] + qq * ee[2]];
      const ul = Math.hypot(u[0], u[1], u[2]);
      u = ul > 1e-12 ? u.map(v => v / ul) : [0, 0, 0];
      const cz = Math.sqrt(Math.max(0, 1 - s * s));
      const N = [s * u[0] - cz * m[0], s * u[1] - cz * m[1], s * u[2] - cz * m[2]];
      const mu = cz, mu0 = N[0] * S[0] + N[1] * S[1] + N[2] * S[2];
      let alb = 1;
      if (MT) {
        const Nd = toDate(N);
        const sl = Math.atan2(Nd[0] * MF.Y[0] + Nd[1] * MF.Y[1] + Nd[2] * MF.Y[2], Nd[0] * MF.X[0] + Nd[1] * MF.X[1] + Nd[2] * MF.X[2]) / D2R;
        const sb = Math.asin(Math.max(-1, Math.min(1, Nd[0] * MF.Z[0] + Nd[1] * MF.Z[1] + Nd[2] * MF.Z[2]))) / D2R;
        // bilinear between texels (the thumbnail is coarse enough for it to matter at full zoom)
        const fx = ((sl + 180) / 360) * MT.w - 0.5, fy = Math.max(0, Math.min(MT.h - 1.001, ((90 - sb) / 180) * MT.h - 0.5));
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const xa = (x0 + MT.w) % MT.w, xb = (x0 + 1) % MT.w, r0 = y0 * MT.w, r1 = r0 + MT.w;
        const u2 = ((MT.u[r0 + xa] * (1 - tx) + MT.u[r0 + xb] * tx) * (1 - ty) + (MT.u[r1 + xa] * (1 - tx) + MT.u[r1 + xb] * tx) * ty) / 255;
        alb = MOON_REAL_ALBEDO_LO + (1 - MOON_REAL_ALBEDO_LO) * u2;
      }
      // sunlit: Lommel-Seeliger with a soft terminator
      const term = Math.max(0, Math.min(1, (mu0 + 0.03) / 0.06));
      let lit = mu0 > -0.03 ? term * Math.min(1.25, 2 * Math.max(0.02, mu0) / (Math.max(0.02, mu0) + Math.max(0.05, mu))) : 0;
      let direct = 1, refr = 0;
      if (shadow && lit > 0) {
        const ds = Math.hypot(ox - shadow.dx, oy - shadow.dy);
        if (ds < shadow.rP) {
          if (ds <= shadow.rU) { direct = 0; refr = 1; }
          else {
            const hh = 2 * (ds - shadow.rU) / (shadow.rP - shadow.rU);
            direct = (Math.acos(1 - hh) - (1 - hh) * Math.sqrt(Math.max(0, 2 * hh - hh * hh))) / Math.PI;
            refr = Math.max(0, 1 - (ds - shadow.rU) / (0.08 * (shadow.rP - shadow.rU)));
          }
        }
      }
      const a = 0.92 * alb;
      const L = lit * direct, Lr = lit * refr * copperI, Le = (1 - term) * shine;
      for (let c = 0; c < 3; c++) {
        px[(j * n + i) * 4 + c] = Math.min(255, a * (tint[c] * (L + Le) + copper[c] * Lr));
      }
      px[(j * n + i) * 4 + 3] = 255 * cover;
    }
  }
  B.ctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  _nightSkySquash(ctx, x, y, flat, up);
  ctx.drawImage(B.canvas, -R, -R);
  ctx.restore();
}

// ── A solar eclipse with the Moon drawn as it looks (Atmosphere) ──────────────────────────────
// _nightSkySolarEclipse (render-nightsky.js) gives the overlap from Night Sky's own positions. The
// Sun and the Moon share one degrees-to-pixels scale while they overlap (the Sun's drawn radius over
// its semi-diameter), so a whole-sky view, where both are blown up to the minimum disc size, still
// shows the true overlap: the Moon is drawn at the Sun plus its true offset times that scale, with
// the radius it has on it. Then, in this order:
//  - the corona (img/eclipse/corona.png, the Eclipse mode's, the Sun's limb at 135 of its 600 px)
//    round the Sun, coming on with T^MOON_ECL_CORONA_POW: T starts about a minute before second
//    contact (the sky's ramp), and with T itself the corona's bright inner edge would ring the
//    Moon while the crescent still shines, like an annular eclipse. With T³ it is a trace 30 s before
//    (T ~0.5: 0.13) and comes up over the last ~15 s with the diamond ring, as in the real sky;
//  - in the partial and annular phases no Moon at all: the Sun is painted with the Moon's disc cut
//    out of it (_moonEclipseClipSun, called before the Sun is drawn), so the sky behind, aureole,
//    grid and all, shows where the Moon covers the Sun, as it does in the real sky;
//  - towards totality the Moon as a silhouette, filled with the sky's own colour behind it
//    (_glowSkyColorAt) darkened, coming in with the totality factor T over the corona;
//  - the diamond ring: the last bead of photosphere on the Sun's limb opposite the Moon's offset,
//    a glare growing over the last 3 % of the Sun's radius of crescent (~40 s) and gone at second
//    contact (the same in reverse at third);
//  - the chromosphere: a thin pink arc on the Moon's limb on that side for the first and last few
//    seconds of totality.
// The disc is squashed by refraction like the Sun's (_nightSkySquash).
const MOON_ECL_DIAMOND = 0.03, MOON_ECL_CHROMO = 0.012, MOON_ECL_CORONA_POW = 3;
const _moonCoronaImg = new Image();
let _moonCoronaLoaded = false;
function _moonEclipseDraw(ctx, e, sunX, sunY, rSun, x, y, r, flat, up) {
  if (!_moonCoronaLoaded && !_moonCoronaImg.src) {
    _moonCoronaImg.onload = () => { _moonCoronaLoaded = true; if (nightSkyActive) drawNightSky(); };
    _moonCoronaImg.src = 'img/eclipse/corona.png';
  }
  if (e.T > 0 && _moonCoronaLoaded) {
    const size = 600 * rSun / 135;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.pow(e.T, MOON_ECL_CORONA_POW);
    _nightSkySquash(ctx, sunX, sunY, flat, up);
    ctx.drawImage(_moonCoronaImg, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  // the silhouette, only towards totality (before that the Moon is the hole cut out of the Sun)
  if (e.T > 0) {
    const col = _glowSkyColorAt(_skyDomeUnitVec(e.moon.az, e.moon.el)).map(c => Math.round(c * (1 - 0.6 * e.T)));
    ctx.save();
    ctx.globalAlpha *= e.T;
    _nightSkySquash(ctx, x, y, flat, up);
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.beginPath(); ctx.arc(0, 0, r + 0.6, 0, Math.PI * 2); ctx.fill();   // +0.6 px: no anti-aliased seam of Sun
    ctx.restore();
  }
  if (!(e.rm >= e.rs)) return;   // annular or partial: the ring or crescent is the Sun showing past the Moon
  let dx = sunX - x, dy = sunY - y;
  const dl = Math.hypot(dx, dy);
  if (dl < 1e-6) { dx = 0; dy = -1; } else { dx /= dl; dy /= dl; }
  const tint = _glowSunTint(e.sun.el);
  // the diamond ring
  const fD = e.w > 0 ? Math.max(0, 1 - e.w / (MOON_ECL_DIAMOND * e.rs)) : 0;
  if (fD > 0) {
    const bx = sunX + dx * rSun, by = sunY + dy * rSun, gr = rSun * (0.4 + 1.6 * fD);
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, gr);
    g.addColorStop(0, `rgba(255,255,255,${(0.95 * fD).toFixed(3)})`);
    g.addColorStop(0.12, `rgba(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0},${(0.75 * fD).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(bx, by, gr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // the chromosphere
  const c = MOON_ECL_CHROMO * e.rs, fC = Math.max(0, 1 - Math.abs(e.w + 0.3 * c) / c);
  if (fC > 0) {
    const a = Math.atan2(dy, dx);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    _nightSkySquash(ctx, x, y, flat, up);
    ctx.strokeStyle = `rgba(255,70,120,${(0.85 * fC).toFixed(3)})`;
    ctx.lineWidth = Math.max(1.2, 0.05 * rSun);
    ctx.beginPath(); ctx.arc(0, 0, r, a - 0.9, a + 0.9); ctx.stroke();
    ctx.restore();
  }
}
// Where and how large to draw the Moon in an eclipse: the shared scale above (sunPx, rSun as drawn,
// pxPerDeg the view's true scale). Returns {x, y, r}.
function _moonEclipsePlace(e, sunPx, rSun, moonPx, pxPerDeg) {
  const S = rSun / e.rs, k = S / pxPerDeg;
  return { x: sunPx.x + (moonPx.x - sunPx.x) * k, y: sunPx.y + (moonPx.y - sunPx.y) * k, r: e.rm * S };
}

// Before the Sun is painted in a solar eclipse (Atmosphere on): clips everything but the Moon's
// disc, placed as _moonEclipsePlace and squashed as the Moon is drawn, so the Sun shows only past
// it. project(az, el) is the view's projection ({x, y} or null), rSun the Sun's drawn radius and
// pxPerDeg the view's true scale. With the Moon the larger (a total eclipse) the hole is 0.6 px
// wider, as its silhouette, so no anti-aliased seam of Sun is left round it in totality. Call
// inside the caller's save()/restore().
function _moonEclipseClipSun(ctx, project, rSun, pxPerDeg) {
  const e = typeof _glowShown === 'function' && _glowShown() ? _nightSkySolarEclipse() : null;
  if (!e) return;
  const sp = project(e.sun.az, e.sun.el), mp = project(e.moon.az, e.moon.el);
  if (!sp || !mp) return;
  const pl = _moonEclipsePlace(e, sp, rSun, mp, pxPerDeg);
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 2e5);
  ctx.save();   // the path is not part of the saved state: the squash only shapes the Moon's ellipse
  _nightSkySquash(ctx, pl.x, pl.y, _nightSkyRefrFlattening(e.moon.el, _moonSemiDiamDeg(e.moon)), _nightSkyUpAngle(project, e.moon.az, e.moon.el));
  ctx.arc(0, 0, pl.r + (e.rm >= e.rs ? 0.6 : 0), 0, Math.PI * 2);
  ctx.restore();
  ctx.clip('evenodd');
}

// Earth's shadow over the disc (_moonShadowOnDisc), clipped to it: one radial gradient from the
// shadow centre - deep blood-brown in the middle, blood-orange towards the umbra's edge, grey at the
// edge itself, then the penumbra's faint grey fading out - semi-transparent, so it blends with the
// lit disc underneath. Called with the context already translated to the disc centre.
const MOON_SHADOW_STOPS = [   // [fraction of the umbra radius, colour]
  [0.00, 'rgba(92,26,10,0.94)'],
  [0.55, 'rgba(150,50,20,0.90)'],
  [0.90, 'rgba(178,88,42,0.84)'],
  [1.00, 'rgba(118,112,106,0.82)'],
];
function _moonDrawShadow(ctx, r, sh) {
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createRadialGradient(sh.dx, sh.dy, 0, sh.dx, sh.dy, sh.rP);
  const u = sh.rU / sh.rP;
  for (const [f, col] of MOON_SHADOW_STOPS) g.addColorStop(f * u, col);
  g.addColorStop(Math.min(1, u + 0.015), 'rgba(135,135,135,0.48)');   // just outside the umbra
  g.addColorStop(1, 'rgba(135,135,135,0)');                            // penumbra's outer edge
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
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
  const r = _nightSkyBodyMinR();
  const e = typeof _glowShown === 'function' && _glowShown() ? _nightSkySolarEclipse() : null;
  if (e) {   // a solar eclipse: the Moon in the Sun's scale, its silhouette and totality's effects
    const sp = project(sun.az, sun.el), pl = _moonEclipsePlace(e, sp, _nightSkyBodyMinR(), pt, layout.R / 90);
    _moonEclipseDraw(ctx, e, sp.x, sp.y, _nightSkyBodyMinR(), pl.x, pl.y, pl.r,
      _nightSkyRefrFlattening(moon.el, _moonSemiDiamDeg(moon)), _nightSkyUpAngle(project, moon.az, moon.el));
  } else if (typeof _glowShown === 'function' && _glowShown()) _moonDrawReal(ctx, pt.x, pt.y, r, moon, sun, project, _moonShadowOnDisc(moon, r, project));
  else _moonDrawDisc(ctx, pt.x, pt.y, r, k, _moonBrightLimbAngle(moon, sun, project), _moonShadowOnDisc(moon, r, project));
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
  const e = typeof _glowShown === 'function' && _glowShown() ? _nightSkySolarEclipse() : null;
  const sp = e ? project(sun.az, sun.el) : null;
  if (e && sp) {   // a solar eclipse: the Moon in the Sun's scale, its silhouette and totality's effects
    const rSun = _nightSkyPlanetDiscRadiusPx(layout, e.rs);
    const pl = _moonEclipsePlace(e, sp, rSun, proj, _nightSkyPlanet3D.FOCAL * layout.scale * Math.PI / 180);
    _moonEclipseDraw(ctx, e, sp.x, sp.y, rSun, pl.x, pl.y, pl.r,
      _nightSkyRefrFlattening(moon.el, semi), _nightSkyUpAngle(project, moon.az, moon.el));
  } else if (typeof _glowShown === 'function' && _glowShown()) _moonDrawReal(ctx, proj.x, proj.y, r, moon, sun, project, _moonShadowOnDisc(moon, r, project));
  else _moonDrawDisc(ctx, proj.x, proj.y, r, k, _moonBrightLimbAngle(moon, sun, project), _moonShadowOnDisc(moon, r, project));
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
// disc disappears too. Rise/set here are the same standard ones as in the info panel (upper limb,
// refraction included). A body that doesn't set within NIGHTSKY_PASS_SEARCH_DAYS either way (circumpolar)
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
    if (_nightSkyDiscAboveHorizon(s.el, _skySunSemiDiamDeg(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT))) { const p = at(s.az, s.el); bodies.push({ x: p.x, y: p.y, r: _nightSkyBodyMinR(), text: 'Sun', color: cols.sun, alpha: 1 }); }
  }
  if (document.getElementById('chkNightSkyMoon').checked) {
    const m = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (_nightSkyDiscAboveHorizon(m.el, _moonSemiDiamDeg(m))) { const p = at(m.az, m.el); bodies.push({ x: p.x, y: p.y, r: _nightSkyBodyMinR(), text: 'Moon', color: cols.moon, alpha: 1 }); }
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
      sun: _nightSkySunRiseSetOnLocalDay(jdUT),
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
// jdAt: the instant to describe (Night Sky's Sun Graph passes the hovered day); default the
// selected one.
function _nightSkyUpdateStatusPanel(jdAt) {
  const el = (id) => document.getElementById(id);
  if (!el('nightSkyStatus')) return;
  const jd = jdAt !== undefined ? jdAt : _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
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

  const at = _skyFromJulianDateUT(jd);
  const jde = _moonJDE(at.year, at.month, at.day, at.hourUT);
  el('nsMoonIllum').textContent = (_moonPhase(jde).k * 100).toFixed(1) + ' %';
  el('nsMoonAge').textContent = _moonAgeDays(jde).toFixed(1) + ' days';

  // Distances from this place, km: the geocentric distance less the observer's offset towards the
  // body, R_earth * sin(true altitude) - up to ~6 400 km for the Moon, irrelevant for the Sun but
  // computed the same way.
  const fmtKm = (km) => Math.round(km).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') + ' km';
  const moonPos = _moonAzEl(at.year, at.month, at.day, at.hourUT);
  el('nsMoonDist').textContent = fmtKm(moonPos.dist - 6378.14 * Math.sin(moonPos.elTrue * _MOON_D2R));
  const sunElTrue = _nightSkySunAzElTrue(at.year, at.month, at.day, at.hourUT).el;
  el('nsSunDist').textContent = fmtKm(_skySunEclipticOfDate(jde).dist - 6378.14 * Math.sin(sunElTrue * _MOON_D2R));
  if (typeof _nsSearchFillStatus === 'function') _nsSearchFillStatus();   // the found object (render-search.js)
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
