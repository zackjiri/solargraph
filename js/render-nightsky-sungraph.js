// ─── Night Sky: Sun Graph (third Visualization sub-mode, next to Sky Map and Planetarium) ───────
// The Analyzer's Sun Graph chart (_sgDraw, render-sungraph.js) drawn from a Night Sky source: the
// real calendar year of the selected local date, the Sun events of each date (core.js
// solarEventsOnDate, the same computation as the Visualization's info panel), and standard clock
// time at the Time zone offset all year (no summer time). Sunlight-on-paper and CHMI are Solargraph
// layers and are not drawn. Added here: the Moon's hours above the horizon per local day, shaded by
// its illuminated fraction. The chart shares #sunGraphCanvas and #sgLegendWrap with the Analyzer's
// Sun Graph (never on screen at the same time); the info panel is Night Sky's own.

let _nsSgHoverDay = null;

// Days of a calendar year: d = 1..N <-> {year, month, day}, counted through the Julian Date, so the
// historical calendar works too (365/366, and 355 in 1582, which lost 5-14 October).
function _nsSgYearDays(year) {
  return Math.round(_skyToJulianDateUT(year + 1, 1, 1, 12) - _skyToJulianDateUT(year, 1, 1, 12));
}
function _nsSgDate(year, d) {
  const r = _skyFromJulianDateUT(_skyToJulianDateUT(year, 1, 1, 12) + d - 1);
  return { year: r.year, month: r.month, day: r.day };
}
function _nsSgDayIndex(year, month, day) {
  return Math.round(_skyToJulianDateUT(year, month, day, 12) - _skyToJulianDateUT(year, 1, 1, 12)) + 1;
}
function _nsSgMonthStarts(year) {
  const starts = [];
  for (let m = 1; m <= 12; m++) starts.push(_nsSgDayIndex(year, m, 1));
  return starts;
}

// True solar hour -> standard clock hour at the Time zone offset. eotMin: the equation of time at
// the event itself when the caller has it, otherwise the day's value at local solar noon.
function _nsSgEotNoon(year, d) {
  const c = _nsSgDate(year, d);
  return _solarSunAtJDE(_moonJDE(c.year, c.month, c.day, _solarNoonUT())).eotMin;
}
function _nsSgClock(trueH, year, d, eotMin) {
  const eot = eotMin !== undefined ? eotMin : _nsSgEotNoon(year, d);
  return trueH - eot / 60 - (lonHemisphere * LONG - _nightSkyTzHours() * 15) / 15;
}

// The Moon above the horizon (upper limb, refracted - the same rule as its rise/set) on each local
// day of a year: [[fromHour, toHour, k], ...] in clock hours 0..24, k = illuminated fraction at the
// middle of the interval. Altitude sampled every 15 min, crossings interpolated linearly (within a
// minute or two of the exact rise/set, plenty at one pixel per few minutes). Cached per year,
// place and Time zone.
const NS_SG_MOON_STEP_H = 0.25;
let _nsSgMoonCache = { key: null, days: null };
function _nsSgMoonDays(year) {
  const tz = _nightSkyTzHours();
  const key = [year, LAT, hemisphere, LONG, lonHemisphere, tz].join('|');
  if (_nsSgMoonCache.key === key) return _nsSgMoonCache.days;
  const N = _nsSgYearDays(year), n = Math.round(24 / NS_SG_MOON_STEP_H);
  const days = new Array(N + 1);
  const jan1 = _skyToJulianDateUT(year, 1, 1, 0) - tz / 24;   // local midnight, as UT
  let prev = _moonElevAtJD(jan1).el;
  for (let d = 1; d <= N; d++) {
    const start = jan1 + d - 1, ivs = [];
    let from = prev >= 0 ? 0 : null;
    for (let s = 1; s <= n; s++) {
      const h = s * NS_SG_MOON_STEP_H, el = _moonElevAtJD(start + h / 24).el;
      if ((prev >= 0) !== (el >= 0)) {
        const hx = h - NS_SG_MOON_STEP_H * el / (el - prev);
        if (el >= 0) from = hx; else { ivs.push([from, hx]); from = null; }
      }
      prev = el;
    }
    if (from !== null) ivs.push([from, 24]);
    for (const iv of ivs) {
      const r = _skyFromJulianDateUT(start + (iv[0] + iv[1]) / 48);
      iv.push(_moonPhase(_moonJDE(r.year, r.month, r.day, r.hourUT)).k);
    }
    days[d] = ivs;
  }
  _nsSgMoonCache = { key, days };
  return days;
}
// The same for one SOLAR day (true solar 0-24 h of date d), for the day strip, which is in true
// solar time: [[fromTrueHour, toTrueHour, k], ...]. Only the active day, cached by the last one.
let _nsSgMoonSolarCache = { key: null, ivs: null };
function _nsSgMoonSolarDay(year, d) {
  const key = [year, d, LAT, hemisphere, LONG, lonHemisphere].join('|');
  if (_nsSgMoonSolarCache.key === key) return _nsSgMoonSolarCache.ivs;
  const c = _nsSgDate(year, d), n = Math.round(24 / NS_SG_MOON_STEP_H);
  // UT of true solar 0h on that date (equation of time at local solar noon, as on the axis).
  const start = _skyToJulianDateUT(c.year, c.month, c.day, -_nsSgEotNoon(year, d) / 60 - lonHemisphere * LONG / 15);
  const ivs = [];
  let prev = _moonElevAtJD(start).el, from = prev >= 0 ? 0 : null;
  for (let s = 1; s <= n; s++) {
    const h = s * NS_SG_MOON_STEP_H, el = _moonElevAtJD(start + h / 24).el;
    if ((prev >= 0) !== (el >= 0)) {
      const hx = h - NS_SG_MOON_STEP_H * el / (el - prev);
      if (el >= 0) from = hx; else { ivs.push([from, hx]); from = null; }
    }
    prev = el;
  }
  if (from !== null) ivs.push([from, 24]);
  for (const iv of ivs) {
    const r = _skyFromJulianDateUT(start + (iv[0] + iv[1]) / 48);
    iv.push(_moonPhase(_moonJDE(r.year, r.month, r.day, r.hourUT)).k);
  }
  _nsSgMoonSolarCache = { key, ivs };
  return ivs;
}
// Moonless night: the parts of each local day when the Sun is below -18 deg (astronomical night,
// on its true altitude, the same threshold as the bands) AND the Moon is below the horizon (the
// Moon-up intervals of _nsSgMoonDays) - the darkest sky the place gets. [[from, to], ...] in clock
// hours 0..24 per day. The Sun is sampled every 15 min with linear interpolation of the crossings,
// like the Moon. Cached per year, place and Time zone.
const NS_SG_MOONLESS_FILL = 'rgba(126,92,232,0.62)';
let showNightSkyMoonless = false;
let _nsSgMoonlessCache = { key: null, days: null };
function _nsSgMoonlessDays(year) {
  const tz = _nightSkyTzHours();
  const key = [year, LAT, hemisphere, LONG, lonHemisphere, tz].join('|');
  if (_nsSgMoonlessCache.key === key) return _nsSgMoonlessCache.days;
  const N = _nsSgYearDays(year), n = Math.round(24 / NS_SG_MOON_STEP_H), moon = _nsSgMoonDays(year);
  const jan1 = _skyToJulianDateUT(year, 1, 1, 0) - tz / 24;
  const depth = (jd) => {   // > 0 while the Sun is deeper than -18 deg
    const r = _skyFromJulianDateUT(jd);
    return -18 - _nightSkySunAzElTrue(r.year, r.month, r.day, r.hourUT).el;
  };
  const days = new Array(N + 1);
  let prev = depth(jan1);
  for (let d = 1; d <= N; d++) {
    const start = jan1 + d - 1, night = [];
    let from = prev > 0 ? 0 : null;
    for (let s = 1; s <= n; s++) {
      const h = s * NS_SG_MOON_STEP_H, v = depth(start + h / 24);
      if ((prev > 0) !== (v > 0)) {
        const hx = h - NS_SG_MOON_STEP_H * v / (v - prev);
        if (v > 0) from = hx; else { night.push([from, hx]); from = null; }
      }
      prev = v;
    }
    if (from !== null) night.push([from, 24]);
    days[d] = _nsSgSubtract(night, moon[d]);   // night minus the Moon above the horizon
  }
  _nsSgMoonlessCache = { key, days };
  return days;
}
// Intervals [[a, b], ...] minus intervals cut (only their first two fields are read).
function _nsSgSubtract(ivs, cut) {
  let free = ivs;
  for (const m of cut) {
    const next = [];
    for (const [a, b] of free) {
      if (m[1] <= a || m[0] >= b) { next.push([a, b]); continue; }
      if (m[0] > a) next.push([a, m[0]]);
      if (m[1] < b) next.push([m[1], b]);
    }
    free = next;
  }
  return free.filter(([a, b]) => b - a > 1e-6);
}
// The same for one SOLAR day (true solar 0-24 h of date d), for the day strip - as
// _nsSgMoonSolarDay. Only the active day, cached by the last one.
let _nsSgMoonlessSolarCache = { key: null, ivs: null };
function _nsSgMoonlessSolarDay(year, d) {
  const key = [year, d, LAT, hemisphere, LONG, lonHemisphere].join('|');
  if (_nsSgMoonlessSolarCache.key === key) return _nsSgMoonlessSolarCache.ivs;
  const c = _nsSgDate(year, d), n = Math.round(24 / NS_SG_MOON_STEP_H);
  const start = _skyToJulianDateUT(c.year, c.month, c.day, -_nsSgEotNoon(year, d) / 60 - lonHemisphere * LONG / 15);
  const depth = (jd) => { const r = _skyFromJulianDateUT(jd); return -18 - _nightSkySunAzElTrue(r.year, r.month, r.day, r.hourUT).el; };
  const night = [];
  let prev = depth(start), from = prev > 0 ? 0 : null;
  for (let s = 1; s <= n; s++) {
    const h = s * NS_SG_MOON_STEP_H, v = depth(start + h / 24);
    if ((prev > 0) !== (v > 0)) {
      const hx = h - NS_SG_MOON_STEP_H * v / (v - prev);
      if (v > 0) from = hx; else { night.push([from, hx]); from = null; }
    }
    prev = v;
  }
  if (from !== null) night.push([from, 24]);
  const ivs = _nsSgSubtract(night, _nsSgMoonSolarDay(year, d));
  _nsSgMoonlessSolarCache = { key, ivs };
  return ivs;
}
// Light yellow, the Moon's own disc colour; denser the fuller it is, and stronger when the Sun is
// off (strong) and its bands fade back.
function _nsSgMoonFill(k, emph, strong) {
  const a = strong ? (emph ? 0.40 : 0.15) + 0.70 * k : (emph ? 0.25 : 0.06) + 0.45 * k;
  return 'rgba(244,234,184,' + Math.min(1, a).toFixed(3) + ')';
}

// The Sun and the Moon at the selected instant, drawn as in the Planetarium at its minimum size
// (_nightSkyBodyMinR, no zoom). The two share the point (the Y axis is the time), so with both on
// only one disc shows, chosen by the Sun's horizon (the Planetarium's rule, _nightSkyDiscAboveHorizon):
//   Sun up   (day)   -> the Sun (with the Moon over it during a solar eclipse from this place)
//   Sun down (night) -> the Moon (greyed when it is down too)
// A single body on its own is greyed when it is below the horizon; the Sun alone still shows an
// eclipse. The Moon is turned as the
// observer sees it in the sky - its lit side towards the Sun and, at a lunar eclipse, Earth's
// shadow on it - from a small projection of the sky around the Moon (_nsSgMoonProject).
const NS_SG_BELOW_HORIZON_GREY = 'rgba(120,120,120,0.6)';
function _nsSgDrawBodies(ctx, x, y, sunOn, moonOn) {
  const r = _nightSkyBodyMinR();
  const Y = nightSkyYear, M = nightSkyMonth, D = nightSkyDay, H = nightSkyHourUT;
  const sun = _nightSkySunAzEl(Y, M, D, H), moon = _moonAzEl(Y, M, D, H);
  const sunUp = _nightSkyDiscAboveHorizon(sun.el, _skySunSemiDiamDeg(Y, M, D, H));
  const moonUp = _nightSkyDiscAboveHorizon(moon.el, _moonSemiDiamDeg(moon));
  // A solar eclipse from this place: the Sun's disc with the Moon over it (_nsSgSolarEclipse).
  const ecl = sunOn ? _nsSgSolarEclipse({ year: Y, month: M, day: D, hourUT: H }, r, x, y) : null;
  let drawSun = sunOn, drawMoon = moonOn;
  if (sunOn && moonOn) {
    if (sunUp) drawMoon = false; else drawSun = false;
  }
  if (drawSun) _nsSgDrawSunDisc(ctx, x, y, r, sunUp, ecl);
  if (drawMoon) {
    const project = _nsSgMoonProject(moon, x, y);
    const k = _moonPhase(_moonJDE(Y, M, D, H)).k;
    _moonDrawDisc(ctx, x, y, r, k, _moonBrightLimbAngle(moon, sun, project), _moonShadowOnDisc(moon, r, project));
    if (!moonUp) _nsSgGrey(ctx, x, y, r);
  }
}
function _nsSgGrey(ctx, x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = NS_SG_BELOW_HORIZON_GREY; ctx.fill();
}
function _nsSgSunGlow(ctx, x, y, r) {
  const glR = r * NIGHTSKY_SUN_GLOW_RATIO;
  const g = ctx.createRadialGradient(x, y, 0, x, y, glR);
  g.addColorStop(0, 'rgba(232,160,32,0.60)'); g.addColorStop(1, 'rgba(232,160,32,0)');
  ctx.fillStyle = g; ctx.fillRect(x - glR, y - glR, glR * 2, glR * 2);
}
// The Sun's disc as in the Planetarium (glow only above the horizon, grey below it). ecl: the Moon
// over it - a dark disc clipped to the Sun, so a partial, annular or total eclipse reads directly.
function _nsSgDrawSunDisc(ctx, x, y, r, up, ecl) {
  if (up) _nsSgSunGlow(ctx, x, y, r);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#e8a020'; ctx.fill();
  if (ecl) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.arc(x + ecl.dx, y + ecl.dy, ecl.rM, 0, Math.PI * 2);
    ctx.fillStyle = _moonColors().dark; ctx.fill();
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
  if (!up) _nsSgGrey(ctx, x, y, r);
}
// A solar eclipse as seen from this place at instant at ({year, month, day, hourUT}): the Moon's
// topocentric disc against the Sun's, from their separation and semi-diameters, scaled to a Sun
// drawn with radius rPx at (x, y) and turned as in the sky (_nsSgMoonProject around the Sun).
// {dx, dy, rM, sunUp}, or null when the discs don't touch.
function _nsSgSolarEclipse(at, rPx, x, y) {
  const sun = _nightSkySunAzEl(at.year, at.month, at.day, at.hourUT);
  const moon = _moonAzEl(at.year, at.month, at.day, at.hourUT);
  const sS = _skySunSemiDiamDeg(at.year, at.month, at.day, at.hourUT), sM = _moonSemiDiamDeg(moon);
  const a = _skyDomeUnitVec(sun.az, sun.el), b = _skyDomeUnitVec(moon.az, moon.el);
  const sep = Math.acos(Math.max(-1, Math.min(1, _sd3Dot(a, b)))) / _MOON_D2R;
  if (sep >= sS + sM) return null;
  const project = _nsSgMoonProject(sun, x, y), p = project(moon.az, moon.el);
  let ux = 0, uy = 0;
  if (p) { const L = Math.hypot(p.x - x, p.y - y); if (L > 1e-9) { ux = (p.x - x) / L; uy = (p.y - y) / L; } }
  const k = rPx / sS;
  return { dx: ux * sep * k, dy: uy * sep * k, rM: sM * k, sunUp: _nightSkyDiscAboveHorizon(sun.el, sS) };
}

// Lunar calendar: the instants of the four principal phases (new Moon, first quarter, full Moon,
// last quarter) whose local date falls in the year, [{jd, q, d, hour}] - q = 0..3, d = day of the
// year and hour = clock hour at the Time zone. Each is where the Sun-Moon elongation in ecliptic
// longitude (_moonLongitudeElongation, 0-360 deg here) passes q*90 deg: a daily scan finds the
// crossing, bisection pins it to ~0.1 s. Cached per year and Time zone.
let _nsSgQuarterCache = { key: null, list: null };
function _nsSgQuarters(year) {
  const tz = _nightSkyTzHours();
  const key = year + '|' + tz;
  if (_nsSgQuarterCache.key === key) return _nsSgQuarterCache.list;
  const elong = (jd) => {
    const r = _skyFromJulianDateUT(jd);
    const e = _moonLongitudeElongation(_moonJDE(r.year, r.month, r.day, r.hourUT));
    return e < 0 ? e + 360 : e;
  };
  // Angle past the target, (-180, 180]: crosses 0 upwards at the event.
  const past = (e, target) => ((e - target + 540) % 360) - 180;
  const start = _skyToJulianDateUT(year, 1, 1, 0) - tz / 24 - 1, end = start + _nsSgYearDays(year) + 2;
  const list = [];
  let jdPrev = start, ePrev = elong(start);
  for (let jd = start + 1; jd <= end; jd += 1) {
    const e = elong(jd);
    for (let q = 0; q < 4; q++) {
      if (!(past(ePrev, q * 90) < 0 && past(e, q * 90) >= 0)) continue;
      let lo = jdPrev, hi = jd;
      for (let i = 0; i < 40 && hi - lo > 1e-6; i++) {
        const mid = (lo + hi) / 2;
        if (past(elong(mid), q * 90) < 0) lo = mid; else hi = mid;
      }
      const t = (lo + hi) / 2, loc = _skyFromJulianDateUT(t + tz / 24);
      if (loc.year === year) list.push({ jd: t, q, d: _nsSgDayIndex(loc.year, loc.month, loc.day), hour: loc.hourUT });
    }
    jdPrev = jd; ePrev = e;
  }
  _nsSgQuarterCache = { key, list };
  return list;
}
// The phase symbols at those points, the Planetarium's phase disc (_moonDrawDisc) at its minimum
// size: dark at new Moon, half lit at the quarters, full at full Moon - waxing lit on the right and
// waning on the left as seen from the northern hemisphere (mirrored for the southern). A new Moon
// that eclipses the Sun from this place shows as the eclipsed Sun (greyed when the Sun is down).
// A full Moon
// also carries Earth's shadow as it is at that instant (_moonShadowOnDisc), so a full Moon in
// eclipse shows it - penumbral, partial or total - turned as the observer would see it in the sky
// (_nsSgMoonProject). The full-Moon instant is opposition in longitude, a few minutes from the
// greatest eclipse (3-9 min for the eclipses of 2025-2026), so lunar eclipses need no calibration.
let showNightSkyLunarCalendar = false;
function _nsSgDrawQuarters(ctx, g, year) {
  const r = _nightSkyBodyMinR(), south = hemisphere < 0;
  for (const ev of _nsSgQuarters(year)) {
    const k = ev.q === 0 ? 0 : ev.q === 2 ? 1 : 0.5;
    const waxing = ev.q === 1;
    const angle = ev.q === 0 || ev.q === 2 ? 0 : ((waxing !== south) ? 0 : Math.PI);
    const x = g.dayCenter(ev.d), y = g.hourToY(ev.hour);
    let shadow = null;
    if (ev.q === 0) {
      // A solar eclipse from this place is drawn as the eclipsed Sun. At the new Moon: when the
      // discs overlap at that instant. With the calibration switch: at the eclipse's local maximum
      // with the Sun up (_nsSgEclipseMax), found anywhere within +-4 h - the eclipse may be over
      // here before the new Moon (2135 Oct 7 from Brno: maximum 07:35 UT, new Moon 08:51 UT);
      // with no visible part, an overlap at the new Moon still shows there, greyed.
      const at = _skyFromJulianDateUT(ev.jd);
      const jdMax = nightSkySolarEclipseAtMax ? _nsSgEclipseMax(ev.jd) : null;
      if (jdMax !== null) {
        const loc = _skyFromJulianDateUT(jdMax + _nightSkyTzHours() / 24);
        if (loc.year !== year) continue;
        const ex = g.dayCenter(_nsSgDayIndex(loc.year, loc.month, loc.day)), ey = g.hourToY(loc.hourUT);
        const ecl = _nsSgSolarEclipse(_skyFromJulianDateUT(jdMax), r, ex, ey);
        _nsSgDrawSunDisc(ctx, ex, ey, r, ecl.sunUp, ecl);
        continue;
      }
      const ecl = _nsSgSolarEclipse(at, r, x, y);
      if (ecl) { _nsSgDrawSunDisc(ctx, x, y, r, ecl.sunUp, ecl); continue; }
    }
    if (ev.q === 2) {
      const at = _skyFromJulianDateUT(ev.jd);
      const moon = _moonAzEl(at.year, at.month, at.day, at.hourUT);
      shadow = _moonShadowOnDisc(moon, r, _nsSgMoonProject(moon, x, y), at);
    }
    _moonDrawDisc(ctx, x, y, r, k, angle, shadow);
  }
}
// The instant (JD UT) of a solar eclipse's maximum seen from this place, near the new Moon jdNM,
// with the Sun above the horizon (the Planetarium's rule, _nightSkyDiscAboveHorizon): the greatest
// magnitude of the topocentric Moon against the Sun, searched over +-4 h in 1-min steps, then
// refined to ~1 s - by a golden-section search when the maximum lies inside the visible part, by
// bisection of sunrise/sunset when the eclipse is deepest at the horizon. null when no part of the
// eclipse happens with the Sun up (the calendar then keeps it at the new Moon, greyed).
let nightSkySolarEclipseAtMax = false;
let _nsSgEclipseMaxCache = { key: null, map: new Map() };
function _nsSgEclipseMax(jdNM) {
  const key = [LAT, hemisphere, LONG, lonHemisphere].join('|');
  if (_nsSgEclipseMaxCache.key !== key) _nsSgEclipseMaxCache = { key, map: new Map() };
  const hit = _nsSgEclipseMaxCache.map.get(jdNM);
  if (hit !== undefined) return hit;
  const res = _nsSgEclipseMaxSearch(jdNM);
  _nsSgEclipseMaxCache.map.set(jdNM, res);
  return res;
}
function _nsSgEclipseMaxSearch(jdNM) {
  // No solar eclipse anywhere on Earth with the Moon over ~1.6 deg from the ecliptic at new Moon.
  const r0 = _skyFromJulianDateUT(jdNM);
  if (Math.abs(_moonEclipticOfDate(_moonJDE(r0.year, r0.month, r0.day, r0.hourUT)).beta) > 1.6) return null;
  const at = (jd) => {
    const r = _skyFromJulianDateUT(jd);
    const sun = _nightSkySunAzEl(r.year, r.month, r.day, r.hourUT), moon = _moonAzEl(r.year, r.month, r.day, r.hourUT);
    const sS = _skySunSemiDiamDeg(r.year, r.month, r.day, r.hourUT), sM = _moonSemiDiamDeg(moon);
    const sep = Math.acos(Math.max(-1, Math.min(1, _sd3Dot(_skyDomeUnitVec(sun.az, sun.el), _skyDomeUnitVec(moon.az, moon.el))))) / _MOON_D2R;
    return { mag: (sS + sM - sep) / (2 * sS), up: _nightSkyDiscAboveHorizon(sun.el, sS) };
  };
  const mag = (jd) => { const a = at(jd); return a.up ? a.mag : -Infinity; };
  const step = 1 / 1440;
  let best = null, bestM = 0;   // only an actual overlap (magnitude > 0) counts
  for (let jd = jdNM - 4 / 24; jd <= jdNM + 4 / 24; jd += step) {
    const m = mag(jd);
    if (m > bestM) { bestM = m; best = jd; }
  }
  if (best === null) return null;
  // Deepest right at sunrise or sunset: the horizon crossing next to it, by bisection.
  for (const side of [-1, 1]) {
    if (mag(best + side * step) !== -Infinity) continue;
    let up = best, down = best + side * step;
    while (Math.abs(down - up) > 1 / 86400) {
      const mid = (up + down) / 2;
      if (at(mid).up) up = mid; else down = mid;
    }
    if (at(up).mag >= at(best + -side * step).mag) return up;
  }
  let lo = best - step, hi = best + step;   // golden-section search on the bracket
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = hi - gr * (hi - lo), d = lo + gr * (hi - lo), fc = mag(c), fd = mag(d);
  while (hi - lo > 1 / 86400) {
    if (fc > fd) { hi = d; d = c; fd = fc; c = hi - gr * (hi - lo); fc = mag(c); }
    else { lo = c; c = d; fc = fd; d = lo + gr * (hi - lo); fd = mag(d); }
  }
  return (lo + hi) / 2;
}

// A small projection of the sky around a body ({az, el}), centred on (x, y): right = growing
// azimuth, up = towards the zenith - the body as the observer sees it in the sky.
function _nsSgMoonProject(moon, x, y) {
  const m = _skyDomeUnitVec(moon.az, moon.el), a = moon.az * _MOON_D2R;
  const right = [Math.cos(a), -Math.sin(a), 0];
  let up = [-m[2] * m[0], -m[2] * m[1], 1 - m[2] * m[2]];
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  up = up.map(v => v / ul);
  return (az, el) => {
    const p = _skyDomeUnitVec(az, el), d = _sd3Dot(p, m);
    if (d <= 0) return null;
    return { x: x + 1000 * _sd3Dot(p, right) / d, y: y - 1000 * _sd3Dot(p, up) / d };
  };
}

function _nsSgActive() {
  return nightSkyActive && nightSkyTopView === 'visualization' && nightSkySubmode === 'sungraph';
}

function _nsSgSource() {
  const L = _nightSkyLocalDate();
  const year = L.year, N = _nsSgYearDays(year);
  const today = _nsSgDayIndex(L.year, L.month, L.day);
  const sunOn = document.getElementById('chkNightSkySun').checked;
  const moonOn = document.getElementById('chkNightSkyMoon').checked;
  const moonOnly = moonOn && !sunOn;   // Sun off: the Moon takes over the chart and the strip
  // Custom date marks the selected instant: its line, the Sun/Moon at it and its tick on the strip.
  const customOn = document.getElementById('chkNightSkyCustomDate').checked;
  const moonDays = moonOn ? _nsSgMoonDays(year) : null;
  const moonless = moonOn && showNightSkyMoonless ? _nsSgMoonlessDays(year) : null;
  const eotNoon = new Array(N + 2);
  const clock = (trueH, d, eot) => {
    if (eot === undefined) eot = eotNoon[d] !== undefined ? eotNoon[d] : (eotNoon[d] = _nsSgEotNoon(year, d));
    return _nsSgClock(trueH, year, d, eot);
  };
  const dayLabel = (d) => { const c = _nsSgDate(year, d); return MONTH_NAMES[c.month - 1].toUpperCase() + ' ' + c.day; };
  return {
    solar: false, legendId: 'sgLegendWrap',
    nDays: N,
    monthStarts: () => _nsSgMonthStarts(year),
    events: (d) => {
      const c = _nsSgDate(year, d);
      return {
        day: solarEventsOnDate(c.year, c.month, c.day, 'day'), civ: solarEventsOnDate(c.year, c.month, c.day, 'civil'),
        naut: solarEventsOnDate(c.year, c.month, c.day, 'nautical'), astro: solarEventsOnDate(c.year, c.month, c.day, 'astro'),
      };
    },
    disp: clock,
    flatNoon: false, showNoon: sunOn,
    customDay: today,
    showCustom: customOn,
    hoverDay: _nsSgHoverDay,
    sunMarker: null,   // drawn by drawMarkers, as in the Planetarium
    dimBands: moonOnly && sgViewMode !== 'length',   // the length view has no Moon layer to give way to
    stripBands: !moonOnly,
    drawMarkers: (sunOn || moonOn) ? (ctx, g) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(g.px0, g.py0, g.pw, g.ph); ctx.clip();
      if (moonOn && showNightSkyLunarCalendar) _nsSgDrawQuarters(ctx, g, year);
      if (customOn) _nsSgDrawBodies(ctx, g.dayCenter(today), g.hourToY(L.hour), sunOn, moonOn);
      ctx.restore();
    } : null,
    dayLabel,
    showLabels: document.getElementById('chkNightSkyNames').checked,
    // The time strip (#nightSkyTimeWrap) sits over the bottom-left corner: keep the chart above it.
    bottomPad: document.getElementById('nightSkyTimeWrap').offsetHeight + 8,
    lengthCaption: () => 'lengths · ' + year + ' · ' + LAT.toFixed(1) + '° ' + (hemisphere >= 0 ? 'N' : 'S'),
    caption: () => {
      const latStr = LAT.toFixed(1) + '° ' + (hemisphere >= 0 ? 'N' : 'S');
      // Short: the sub-mode wheel sits at the top right of the same row.
      return year + ' · ' + latStr
           + ' · ' + LONG.toFixed(1) + '° ' + (lonHemisphere >= 0 ? 'E' : 'W')
           + ' · UTC' + _fmtTimeZone(_nightSkyTzHours());
    },
    drawExtra: moonDays ? (ctx, g) => {
      const emph = _sgEmphBand === 'moon';
      ctx.save();
      ctx.beginPath(); ctx.rect(g.px0, g.py0, g.pw, g.ph); ctx.clip();
      for (let d = 1; d <= g.NDAYS; d++) {
        const x0 = Math.round(g.dayToX(d)), x1 = Math.round(g.dayToX(d + 1));
        if (x1 <= x0) continue;
        for (const iv of moonDays[d]) {
          const yTop = g.hourToY(iv[1]), yBot = g.hourToY(iv[0]);
          ctx.fillStyle = _nsSgMoonFill(iv[2], emph, moonOnly);
          ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
        }
        if (moonless) {   // never overlaps the Moon's bands: the Moon is down there by definition
          ctx.fillStyle = _sgEmphBand === 'moonless' ? 'rgba(126,92,232,0.9)' : NS_SG_MOONLESS_FILL;
          for (const iv of moonless[d]) {
            const yTop = g.hourToY(iv[1]), yBot = g.hourToY(iv[0]);
            ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
          }
        }
      }
      ctx.restore();
    } : null,
    // Length view: the Moon's hours above the horizon on each local day, a light-yellow column from
    // the bottom over the Sun's bands (denser the fuller the Moon, as its bands in the times view),
    // its top traced by a line so the curve reads over any band.
    // With Moonless night on, its hours hang from the top (24 h) down into the Night band, of
    // which they are a part.
    drawLengthExtra: moonDays ? (ctx, g) => {
      const emph = _sgEmphBand === 'moon';
      const hours = (d) => moonDays[d].reduce((a, iv) => a + iv[1] - iv[0], 0);
      ctx.save();
      ctx.beginPath(); ctx.rect(g.px0, g.py0, g.pw, g.ph); ctx.clip();
      if (moonless) {
        ctx.fillStyle = _sgEmphBand === 'moonless' ? 'rgba(126,92,232,0.9)' : NS_SG_MOONLESS_FILL;
        for (let d = 1; d <= g.NDAYS; d++) {
          const x0 = Math.round(g.dayToX(d)), x1 = Math.round(g.dayToX(d + 1));
          const h = moonless[d].reduce((a, iv) => a + iv[1] - iv[0], 0);
          if (x1 > x0 && h > 0) ctx.fillRect(x0, g.hourToY(24), x1 - x0, g.hourToY(24 - h) - g.hourToY(24));
        }
      }
      for (let d = 1; d <= g.NDAYS; d++) {
        const x0 = Math.round(g.dayToX(d)), x1 = Math.round(g.dayToX(d + 1));
        if (x1 <= x0) continue;
        const ivs = moonDays[d], h = hours(d);
        if (h <= 0) continue;
        const k = ivs.reduce((a, iv) => a + iv[2] * (iv[1] - iv[0]), 0) / h;   // time-weighted
        ctx.fillStyle = _nsSgMoonFill(k, emph, false);
        ctx.fillRect(x0, g.hourToY(h), x1 - x0, g.hourToY(0) - g.hourToY(h));
      }
      ctx.strokeStyle = '#f4eab8'; ctx.lineWidth = emph ? 2 : 1.25;
      ctx.beginPath();
      for (let d = 1; d <= g.NDAYS; d++) {
        const x = (g.dayToX(d) + g.dayToX(d + 1)) / 2, y = g.hourToY(hours(d));
        if (d === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    } : null,
    // Legend Moon row for the active day: rise / set (times), or hours above the horizon (length).
    legendExtra: moonDays ? (d, lengthMode) => {
      const ml = moonless ? { moonless: _sgHM(moonless[d].reduce((a, iv) => a + iv[1] - iv[0], 0)) } : {};   // hours that day
      if (lengthMode) return Object.assign({ moon: _sgHM(moonDays[d].reduce((a, iv) => a + iv[1] - iv[0], 0)) }, ml);
      const c = _nsSgDate(year, d);
      const rs = _moonRiseSetCached(_skyToJulianDateUT(c.year, c.month, c.day, 12) - _nightSkyTzHours() / 24).moon;
      return Object.assign({ moon: _moonFmtLocalTime(rs.rise) + ' / ' + _moonFmtLocalTime(rs.set) }, ml);
    } : null,
    drawStripExtra: (ctx, g) => {
      // The Moon on the day strip: on the strip itself when it is alone (Sun off), otherwise on
      // its own thin lane above the strip, which keeps the Sun's bands alone and readable.
      if (moonDays) {
        const emph = _sgEmphBand === 'moon';
        const y0 = moonOnly ? g.laneY : g.thinY, h = moonOnly ? g.recapH : g.thinH;
        if (!moonOnly) {
          ctx.fillStyle = _sgShade(_SG_BANDS.night, _sgEmphBand === 'night');
          ctx.fillRect(g.px0, y0, g.pw, h);
        }
        for (const iv of _nsSgMoonSolarDay(year, g.activeDay)) {
          ctx.fillStyle = _nsSgMoonFill(iv[2], emph, true);
          ctx.fillRect(g.xh(iv[0]), y0, g.xh(iv[1]) - g.xh(iv[0]), h);
        }
        if (!moonOnly) { ctx.strokeStyle = g.border; ctx.lineWidth = 1; ctx.strokeRect(g.px0, y0, g.pw, h); }
      }
      // Moonless night on the strip itself (in its night part), in the strip's true solar time.
      if (moonless) {
        ctx.fillStyle = _sgEmphBand === 'moonless' ? 'rgba(126,92,232,0.9)' : NS_SG_MOONLESS_FILL;
        for (const iv of _nsSgMoonlessSolarDay(year, g.activeDay)) {
          ctx.fillRect(g.xh(iv[0]), g.laneY, g.xh(iv[1]) - g.xh(iv[0]), g.recapH);
        }
      }
      // The selected instant on the strip (true solar time), when the strip shows the selected day.
      const tSun = L.hour - clock(0, today);
      if (customOn && (sunOn || moonOn) && g.activeDay === today && tSun >= 0 && tSun <= 24) {
        const x = g.xh(tSun), top = (moonDays && !moonOnly) ? g.thinY : g.laneY;
        ctx.strokeStyle = sunOn ? '#e8a020' : '#f4eab8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, g.laneY + g.recapH); ctx.stroke();
      }
    },
    afterDraw: (activeDay) => {
      if (_nsSgCursorPt) _nsSgReadout(_nsSgCursorPt);   // keep the cursor's date/time on the readout
      // Info panel and legend transit for the active day, at the selected clock time.
      const c = _nsSgDate(year, activeDay);
      _nightSkyUpdateStatusPanel(_skyToJulianDateUT(c.year, c.month, c.day, L.hour) - _nightSkyTzHours() / 24);
      const trEl = document.getElementById('sgLegendTransit');
      if (trEl) {
        const noon = clock(12, activeDay);   // true solar noon on the clock
        const sun = _solarSunAtJDE(_moonJDE(c.year, c.month, c.day, noon - _nightSkyTzHours()));
        const phi = effectiveLat() * hemisphere;
        const el = Math.asin(Math.sin(phi) * Math.sin(sun.dec) + Math.cos(phi) * Math.cos(sun.dec)) * 180 / Math.PI;
        trEl.textContent = _sgHM(noon) + ' / ' + el.toFixed(1) + '°';
      }
    },
    redraw: () => _nsSgDraw(),
    setHover: (d) => { _nsSgHoverDay = d; },
    isActive: _nsSgActive,
  };
}
function _nsSgDraw() {
  _sgDraw(document.getElementById('sunGraphCanvas'), _nsSgSource());
}

// ── Entering / leaving the sub-mode ─────────────────────────────────────────────────────────────
// Called by Visualization (enterNightSkyVisualization, _nightSkyCommitSubmode, and on leaving,
// exitNightSkyVisualization), which already shows the date/time controls, the info panel and the
// sub-mode wheel. Here: the chart replaces the sky canvas, the Display section keeps Labels, Custom
// date, Sun and Moon (CSS: .ns-sungraph), the legend drops the sunlight and CHMI rows and gains
// Moon, and the info panel moves below the sub-mode wheel on the right (the plot starts top-left).
// The time strip with Play is the same for all three sub-modes: a running animation keeps going
// across the switch and moves the Sun/Moon markers here. The top readout keeps Day and Time: the
// date and clock time under the cursor in the plot, otherwise the selected ones (_nsSgReadout);
// Az/Alt/Dir stay empty.
function enterNightSkySunGraph() {
  _nsSgHoverDay = null;
  _nsSgCursorPt = null;
  document.getElementById('nightSkyCanvas').style.display = 'none';
  document.getElementById('nightSkyFrameThumb').style.display = 'none';
  document.getElementById('sunGraphCanvas').style.display = 'block';
  document.getElementById('sgLegendWrap').style.display = 'flex';
  document.getElementById('sgViewSwitch').style.display = 'flex';
  ['sgLegendWrap', 'nightSkyDisplaySection', 'nightSkyStatusWrap', 'nightSkyTimeWrap']
    .forEach(id => document.getElementById(id).classList.add('ns-sungraph'));
  _nightSkyClearReadout();
  _nightSkyUpdateReadout();
  _sgFitCanvas();
}
function exitNightSkySunGraph() {
  if (!document.getElementById('sgLegendWrap').classList.contains('ns-sungraph')) return;
  document.getElementById('sunGraphCanvas').style.display = 'none';
  document.getElementById('sgLegendWrap').style.display = 'none';
  document.getElementById('sgViewSwitch').style.display = 'none';
  ['sgLegendWrap', 'nightSkyDisplaySection', 'nightSkyStatusWrap', 'nightSkyTimeWrap']
    .forEach(id => document.getElementById(id).classList.remove('ns-sungraph'));
  document.getElementById('nightSkyCanvas').style.display = 'block';
  _nsSgHoverDay = null;
}

// The plot point under the cursor: {d, hour} (day of the year, clock hour at the Time zone), or
// null outside the plot.
function _nsSgPointAt(src, clientX, clientY) {
  const cv = document.getElementById('sunGraphCanvas');
  const r = cv.getBoundingClientRect(), L = src.layout;
  const x = clientX - r.left, y = clientY - r.top;
  if (x < L.px0 || x > L.px0 + L.pw || y < L.py0 || y > L.py0 + L.ph) return null;
  return {
    d: _sgDayAtX(L, src.nDays, x),   // the column under the cursor
    hour: Math.max(0, Math.min(24 - 1 / 3600, (L.py0 + L.ph - y) / L.ph * 24)),
  };
}
// Top readout Day/Time for a plot point (minutes: one pixel is a few minutes), or the selected
// date and time when p is null. _nsSgCursorPt keeps the point under the cursor, so a redraw that
// rewrote the readout with the selected time (every animation frame, via _nightSkySyncControls)
// puts the cursor's back (afterDraw).
let _nsSgCursorPt = null;
function _nsSgReadout(p) {
  if (!p) { _nightSkyUpdateReadout(); return; }
  const c = _nsSgDate(_nightSkyLocalDate().year, p.d);
  const t = Math.floor(p.hour * 60);
  document.getElementById('valDay').textContent = MONTHS[c.month - 1] + ' ' + c.day + ', ' + c.year;
  if (sgViewMode === 'length') { _nightSkyTimeReadout().text.nodeValue = '—'; return; }   // rows are durations
  _nightSkyTimeReadout().text.nodeValue = String(Math.floor(t / 60)).padStart(2, '0') + ':'
    + String(t % 60).padStart(2, '0') + ' ' + _nightSkyUtcLabel(_nightSkyTzHours());
}

// A click in the plot sets the Night Sky date (column) and clock time (row).
(function () {
  const cv = document.getElementById('sunGraphCanvas');
  cv.addEventListener('click', (e) => {
    const src = _sgActiveSrc;
    if (!_nsSgActive() || !src || !src.layout || src.isActive !== _nsSgActive) return;
    const p = _nsSgPointAt(src, e.clientX, e.clientY);
    if (!p) return;
    const c = _nsSgDate(_nightSkyLocalDate().year, p.d);
    // The length view's rows are durations: there the click sets the date only.
    _nightSkySetLocal(c.year, c.month, c.day, sgViewMode === 'length' ? _nightSkyLocalDate().hour : p.hour);
    _nightSkySyncControls();
    _nsSgReadout(p);   // the cursor is still on that point
  });
  cv.addEventListener('mousemove', (e) => {
    const src = _sgActiveSrc;
    if (!_nsSgActive() || !src || !src.layout || src.isActive !== _nsSgActive) return;
    _nsSgCursorPt = _nsSgPointAt(src, e.clientX, e.clientY);
    _nsSgReadout(_nsSgCursorPt);
  });
  cv.addEventListener('mouseleave', () => { if (_nsSgActive()) { _nsSgCursorPt = null; _nsSgReadout(null); } });
  const container = document.getElementById('canvasContainer');
  if (container && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (_nsSgActive()) { _sgFitCanvas(); _nsSgDraw(); } }).observe(container);
    // Collapsing/expanding the time strip changes the room it takes.
    new ResizeObserver(() => { if (_nsSgActive()) _nsSgDraw(); }).observe(document.getElementById('nightSkyTimeWrap'));
  }
})();
document.getElementById('chkNightSkyCustomDate').addEventListener('change', () => { if (_nsSgActive()) _nsSgDraw(); });
// "Lunar calendar" switch under Moon (Sun Graph only, shown while Moon is on - the same sub-option
// pattern as Moon's path in Sky Map / Planetarium).
function _nsSgUpdateLunarCalSubrow() {
  const moonOn = document.getElementById('chkNightSkyMoon').checked;
  document.getElementById('nightSkyLunarCalSubrow').style.display = moonOn ? '' : 'none';
  document.getElementById('nightSkyEclipseCalRow').style.display = moonOn && showNightSkyLunarCalendar ? '' : 'none';
  document.getElementById('nightSkyMoonlessSubrow').style.display = moonOn ? '' : 'none';
  document.body.classList.toggle('ns-moonless', moonOn && showNightSkyMoonless);   // legend row
}
_nsSgUpdateLunarCalSubrow();
document.getElementById('chkNightSkyMoon').addEventListener('change', _nsSgUpdateLunarCalSubrow);
document.getElementById('btnNightSkyLunarCal').addEventListener('click', () => {
  showNightSkyLunarCalendar = !showNightSkyLunarCalendar;
  const btn = document.getElementById('btnNightSkyLunarCal');
  btn.classList.toggle('on', showNightSkyLunarCalendar);
  btn.setAttribute('aria-checked', String(showNightSkyLunarCalendar));
  _nsSgUpdateLunarCalSubrow();
  if (_nsSgActive()) _nsSgDraw();
});
// "Moonless night" switch under Moon (Sun Graph, both views, and the day strip): violet areas.
document.getElementById('btnNightSkyMoonless').addEventListener('click', () => {
  showNightSkyMoonless = !showNightSkyMoonless;
  const btn = document.getElementById('btnNightSkyMoonless');
  btn.classList.toggle('on', showNightSkyMoonless);
  btn.setAttribute('aria-checked', String(showNightSkyMoonless));
  _nsSgUpdateLunarCalSubrow();
  if (_nsSgActive()) _nsSgDraw();
});
document.getElementById('btnNightSkyEclipseCal').addEventListener('click', () => {
  nightSkySolarEclipseAtMax = !nightSkySolarEclipseAtMax;
  const btn = document.getElementById('btnNightSkyEclipseCal');
  btn.classList.toggle('at-max', nightSkySolarEclipseAtMax);
  btn.textContent = nightSkySolarEclipseAtMax ? 'NEW MOON' : 'ECLIPSE MAX';
  btn.title = nightSkySolarEclipseAtMax
    ? 'Place each solar eclipse of the lunar calendar at the new Moon again'
    : 'Place each solar eclipse of the lunar calendar at its maximum phase seen from this place with the Sun above the horizon, instead of at the new Moon';
  if (_nsSgActive()) _nsSgDraw();
});
