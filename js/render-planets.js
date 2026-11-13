// ─── Planets (Night Sky) ────────────────────────────────────────────────────────────────────────
// Mercury, Venus, Mars, Jupiter and Saturn for Night Sky, both sub-modes (Sky Map, Planetarium);
// Uranus and Neptune too, only with Display "Only naked eye" (under Planets, on by default) off:
// Uranus at ~5.7 mag is at the naked-eye limit, Neptune at ~7.8 beyond it - faint: true.
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
// Time: the elements run in TT; Night Sky's clock is UT, so _moonJDE() (js/sky-astro.js, UT + deltaT).

// PLANET_ELEMENTS and PLANETS: moved to js/sky-astro.js
// Uranus and Neptune shown: Display "Only naked eye" (#btnNightSkyFaintPlanets, under Planets) off,
// or always in Orbit (nightSkySubmode 'globe', render-nightsky.js), where that row is not shown.
let showNightSkyFaintPlanets = false;
function _planetShown(p) { return !p.faint || showNightSkyFaintPlanets || (typeof nightSkySubmode !== 'undefined' && nightSkySubmode === 'globe'); }
// PLANET_LIGHT_DAYS_PER_AU, PLANET_OBLIQUITY_J2000, _planetHelio: moved to js/sky-astro.js

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
// (_nightSkyStarSize), so the planets read as such; Venus tops out at PLANET_DOT_MAX_R. The Sun and
// the Moon never draw smaller than a fixed multiple of it (_nightSkyBodyMinR, render-moon.js).
const PLANET_DOT_MAX_R = 5.5;
function _planetDotRadius(mag) {
  // Display star size and the Planetarium zoom (render-nightsky.js) scale the planets like the stars,
  // kept under the Sun's and the Moon's minimum disc so they never outgrow them.
  const r = Math.max(2.2, Math.min(PLANET_DOT_MAX_R, 3.6 - 0.45 * mag)) * _nightSkyStarScaleNow().f * _nightSkyStarZoomGain();
  return Math.min(r, 0.95 * _nightSkyBodyMinR());
}
function _planetsWanted() {
  const c = document.getElementById('chkNightSkyPlanets');
  return !c || c.checked;
}
// Each planet's {planet, az, el} at the current Night Sky instant, above the horizon only.
function _planetsAboveHorizon() {
  return _planetPositions(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)
    .filter(_planetShown)
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
// ─── Depth order and transits ───────────────────────────────────────────────────────────────────
// The Sun, the Moon and the planets are drawn farthest first, so whatever is nearer covers what is
// behind it: planets farther than the Sun before its disc ('behind'), nearer ones after it
// ('front'), the Moon last of all (render-nightsky.js). Only Mercury and Venus can ever be nearer
// than the Sun. One in front whose centre falls on the Sun's disc is in transit and is drawn as it
// is seen, a black silhouette of its true angular size relative to the Sun's disc as drawn (Venus
// in 2012: 29" against the Sun's 15.8', ~1/32 of the diameter), at least PLANET_SILHOUETTE_MIN_R px
// so it stays visible on the small Sky Map symbol and at low zoom.
const PLANET_SILHOUETTE_MIN_R = 1;
function _planetSunDistAU() {
  return _skySunEclipticOfDate(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)).dist / 149597870.7;
}
// The Sun's disc as drawn: {x, y, r, semiDeg}, or null when the Sun isn't shown.
function _planetSunDisc(project, radiusPx) {
  if (!document.getElementById('chkNightSkySun').checked) return null;
  const s = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const semi = _skySunSemiDiamDeg(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  if (!_nightSkyDiscAboveHorizon(s.el, semi)) return null;
  const p = project(s.az, s.el);
  return p ? { x: p.x, y: p.y, r: radiusPx(semi), semiDeg: semi } : null;
}
function _planetDrawSilhouette(ctx, x, y, planet, sun, alpha) {
  const semiDeg = Math.asin(planet.radiusKm / (planet.R * 149597870.7)) * 180 / Math.PI;
  const r = Math.max(PLANET_SILHOUETTE_MIN_R, sun.r * semiDeg / sun.semiDeg);
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0b0b'; ctx.fill();
  ctx.globalAlpha = 1;
  return r;
}
// part: 'behind' (farther than the Sun) or 'front' (nearer). project(az, el) -> {x, y, alpha} | null.
function _planetDrawPart(ctx, part, project, sunRadiusPx) {
  const sunAU = _planetSunDistAU();
  const list = _planetsAboveHorizon().filter(q => (q.p.R < sunAU) === (part === 'front'));
  if (!list.length) return;
  const sun = part === 'front' ? _planetSunDisc(project, sunRadiusPx) : null;
  for (const q of list) {
    const pt = project(q.az, q.el);
    if (!pt) continue;
    const onSun = sun && Math.hypot(pt.x - sun.x, pt.y - sun.y) < sun.r;
    if (!onSun && !_nightSkyMagVisible(q.p.magnitude)) continue;   // Display "Mag ≤"; a transit always shows
    // Atmosphere: twilight, moonlight and the dimming near the horizon (render-nightsky.js)
    const em = q.p.magnitude + _nightSkyExtinctionMag(q.el);
    const vis = onSun ? 1 : _nightSkyVisFactor(em, q.az, q.el);
    if (!vis) continue;
    const a = pt.alpha * vis;
    const r = onSun ? _planetDrawSilhouette(ctx, pt.x, pt.y, q.p, sun, a) : _planetDrawDot(ctx, pt.x, pt.y, em === q.p.magnitude ? q.p : { ...q.p, magnitude: em }, a);
    _planetDrawLabel(ctx, pt.x, pt.y, r, q.p, a);
  }
}
function _nightSkyDrawSkyMapPlanets(ctx, layout, part) {
  if (!_planetsWanted()) return;
  ctx.save();
  _nightSkyClipToSky(ctx, layout);
  _planetDrawPart(ctx, part, (az, el) => ({ ..._skyDomePoint(layout.cx, layout.cy, layout.R, az, el), alpha: 1 }),
    () => _nightSkyBodyMinR());
  ctx.restore();
}
function _nightSkyDrawPlanetPlanets(ctx, layout, part) {
  if (!_planetsWanted()) return;
  _planetDrawPart(ctx, part, (az, el) => { const p = _nightSkyPlanetProject(layout, az, el); return p.visible ? p : null; },
    semi => _nightSkyPlanetDiscRadiusPx(layout, semi));
}
