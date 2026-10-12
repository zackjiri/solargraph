// ─── Planets (Night Sky) ────────────────────────────────────────────────────────────────────────
// Mercury, Venus, Mars, Jupiter and Saturn for Night Sky, both sub-modes (Sky Map, Planetarium).
// The draw entry points are called from render-nightsky.js next to the Sun's and the Moon's.
//
// Position: JPL "Keplerian Elements for Approximate Positions of the Major Planets" (E. M. Standish,
// ssd.jpl.nasa.gov/planets/approx_pos.html), Table 1, valid 1800-2050: six mean elements at J2000
// and their linear rates per Julian century, referred to the J2000 ecliptic. Errors stay within
// ~1' for the inner planets and a few ' for Jupiter and Saturn - the Moon's own accuracy class here.
// For each planet: elements at the instant -> Kepler's equation -> heliocentric ecliptic J2000 ->
// minus the Earth-Moon barycentre (same table) -> geocentric, corrected for light time -> J2000
// equatorial (obliquity 23.43928 deg, as on the JPL page) -> _skyStarAzEl(), i.e. the very same
// precession and refraction as every catalog star. Aberration and parallax (both under ~30") are
// left out, as they are for the stars.
//
// Brightness: Paul Schlyter's formulas ("How to compute planetary positions", stjarnhimlen.se,
// section 15) from the heliocentric and geocentric distances and the phase angle, with Saturn's
// ring term from the ring tilt B. Good to ~0.1-0.2 mag, which only sets the dot size here.
//
// Time: the elements run in TT; Night Sky's clock is UT, so _moonJDE() (core.js, UT + deltaT).

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
};
// Display: name, dot colour (each planet's familiar naked-eye tint), magnitude law
const PLANETS = [
  { key: 'mercury', name: 'Mercury', color: '#cbbba6', mag: (r, R, fv) => -0.36 + 5 * Math.log10(r * R) + 0.027 * fv + 2.2e-13 * fv ** 6 },
  { key: 'venus',   name: 'Venus',   color: '#fff6dc', mag: (r, R, fv) => -4.34 + 5 * Math.log10(r * R) + 0.013 * fv + 4.2e-7 * fv ** 3 },
  { key: 'mars',    name: 'Mars',    color: '#ff8a5c', mag: (r, R, fv) => -1.51 + 5 * Math.log10(r * R) + 0.016 * fv },
  { key: 'jupiter', name: 'Jupiter', color: '#f3dfb8', mag: (r, R, fv) => -9.25 + 5 * Math.log10(r * R) + 0.014 * fv },
  { key: 'saturn',  name: 'Saturn',  color: '#e9cf86', mag: (r, R, fv, ring) => -9.0 + 5 * Math.log10(r * R) + 0.044 * fv + ring },
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

// Geocentric J2000 RA/Dec (deg), distances and magnitude of every planet at one UT instant.
// Cached per instant: a redraw asks both the dots and the labels.
let _planetCache = { key: null, list: null };
function _planetPositions(year, month, day, hourUT) {
  const jde = _moonJDE(year, month, day, hourUT);
  if (_planetCache.key === jde) return _planetCache.list;
  const earth = _planetHelio('earth', jde);
  const s = Math.hypot(...earth);
  const list = PLANETS.map(p => {
    let helio = _planetHelio(p.key, jde), geo, R = 0;
    for (let k = 0; k < 3; k++) {   // light time: where the planet was when its light left
      geo = [helio[0] - earth[0], helio[1] - earth[1], helio[2] - earth[2]];
      R = Math.hypot(...geo);
      helio = _planetHelio(p.key, jde - R * PLANET_LIGHT_DAYS_PER_AU);
    }
    geo = [helio[0] - earth[0], helio[1] - earth[1], helio[2] - earth[2]];
    R = Math.hypot(...geo);
    const r = Math.hypot(...helio);
    const fv = Math.acos(Math.max(-1, Math.min(1, (r * r + R * R - s * s) / (2 * r * R)))) * 180 / Math.PI;
    let ring = 0;
    if (p.key === 'saturn') {   // ring tilt to the line of sight, from the geocentric ecliptic lon/lat
      const los = Math.atan2(geo[1], geo[0]), las = Math.asin(geo[2] / R);
      const ir = 28.06 * Math.PI / 180, Nr = (169.51 + 3.82e-5 * (jde - 2451543.5)) * Math.PI / 180;
      const B = Math.asin(Math.sin(las) * Math.cos(ir) - Math.cos(las) * Math.sin(ir) * Math.sin(los - Nr));
      ring = -2.6 * Math.sin(Math.abs(B)) + 1.2 * Math.sin(B) ** 2;
    }
    const ce = Math.cos(PLANET_OBLIQUITY_J2000), se = Math.sin(PLANET_OBLIQUITY_J2000);
    const x = geo[0], y = ce * geo[1] - se * geo[2], z = se * geo[1] + ce * geo[2];
    return {
      ...p,
      raDeg: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360,
      decDeg: Math.asin(z / R) * 180 / Math.PI,
      r, R, phaseDeg: fv,
      magnitude: p.mag(r, R, fv, ring),
    };
  });
  _planetCache = { key: jde, list };
  return list;
}

// Dot radius in px from the magnitude: a bit larger than a star of the same brightness
// (_nightSkyStarSize), so the planets read as such; Venus tops out at 5.5 px.
function _planetDotRadius(mag) {
  return Math.max(2.2, Math.min(5.5, 3.6 - 0.45 * mag));
}
function _planetsWanted() {
  const c = document.getElementById('chkNightSkyPlanets');
  return !c || c.checked;
}
// Each planet's {planet, az, el} at the current Night Sky instant, above the horizon only.
function _planetsAboveHorizon() {
  return _planetPositions(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)
    .map(p => ({ p, ...(_skyStarAzEl(p.raDeg, p.decDeg, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)) }))
    .filter(q => q.el >= 0);
}
function _planetDrawDot(ctx, x, y, planet, alpha) {
  const r = _planetDotRadius(planet.magnitude);
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = planet.color; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;
  return r;
}
// Labels follow Display "Labels" like the Sun's and the Moon's, to the right of the dot, in the
// planet's own tint on the dark sky and a neutral dark grey on the white light-theme sky.
function _planetDrawLabel(ctx, x, y, r, planet, alpha) {
  if (!_nightSkyLabelsWanted()) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '10px Helvetica, Arial, sans-serif';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = document.body.classList.contains('light') ? '#4a4a4a' : planet.color;
  ctx.fillText(planet.name, x + r + NIGHTSKY_LABEL_GAP, y);
  ctx.restore();
}
function _nightSkyDrawSkyMapPlanets(ctx, layout) {
  if (!_planetsWanted()) return;
  ctx.save();
  _nightSkyClipToSky(ctx, layout);
  for (const q of _planetsAboveHorizon()) {
    const pt = _skyDomePoint(layout.cx, layout.cy, layout.R, q.az, q.el);
    const r = _planetDrawDot(ctx, pt.x, pt.y, q.p, 1);
    _planetDrawLabel(ctx, pt.x, pt.y, r, q.p, 1);
  }
  ctx.restore();
}
function _nightSkyDrawPlanetPlanets(ctx, layout) {
  if (!_planetsWanted()) return;
  for (const q of _planetsAboveHorizon()) {
    const proj = _nightSkyPlanetProject(layout, q.az, q.el);
    if (!proj.visible) continue;
    const r = _planetDrawDot(ctx, proj.x, proj.y, q.p, proj.alpha);
    _planetDrawLabel(ctx, proj.x, proj.y, r, q.p, proj.alpha);
  }
}
