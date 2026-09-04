// ─── Eclipse prototype (2026-08-12 total solar eclipse) ────────────────────────────────────────
// Experimental, standalone, single-event canvas - NOT wired into the Gallery/Analyzer mode
// machinery. Computes real local circumstances (when/how much the Moon covers the Sun) from the
// Besselian elements NASA publishes for this specific eclipse, for whatever LAT/LONG the
// Calibration panel is currently set to - i.e. reuses the app's own location, not a hardcoded one.
//
// Besselian elements: https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html
// t0 = 2026 Aug 12, 18:00:00.0 TDT. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0,
// valid for -3 <= t <= +3 (15.00-21.00 TDT). Algorithm: standard Besselian-element local-circumstances
// method (Meeus, "Astronomical Algorithms" ch.54 / Explanatory Supplement to the Astronomical
// Almanac §11.3) - validated numerically against NASA's own published "Greatest Eclipse" reference
// point (65°13.5'N, 025°13.7'W, 17:45:53.8 UT): this implementation puts the observer's distance
// from the shadow axis (m) at ~0.0012 (Earth-radii units, i.e. essentially exactly on-axis) at that
// exact time/place, and independently reproduces the page's own quoted Sun altitude/azimuth there
// (25.8°/248.4°) to within 0.05° using the app's own sunPosition()/declination machinery - both
// signs (longitude convention, hemisphere) match, so this is trusted as correct within a small
// margin. The (u,v) sign convention for which side the Moon enters/exits from was NOT independently
// re-derived from first principles (time didn't allow re-deriving Meeus's fundamental-plane axis
// orientation from scratch) - only checked by eye against the rendered result once built; flip
// ECLIPSE_UV_SIGN below if a future observer location shows the Moon crossing backwards.
const ECLIPSE_T0_UTC_HOURS = 17 + 58 / 60 + 48.6 / 3600;   // 18:00:00.0 TDT - deltaT(71.4s) -> UT
const ECLIPSE_DAY_MONTH = 8, ECLIPSE_DAY_DAY = 12;          // 2026 Aug 12 (real calendar day, for EoT/declination)
const ECLIPSE_BE = {
  x:  [0.475593, 0.5189288, -0.0000773, -0.0000088],
  y:  [0.771161, -0.2301664, -0.0001245, 0.0000037],
  d:  [14.79667, -0.012065, -0.000003],
  l1: [0.537954, 0.0000940, -0.0000121],
  l2: [-0.008142, 0.0000935, -0.0000121],
  mu: [88.74776, 15.003093],
};
const ECLIPSE_TANF1 = 0.0046141, ECLIPSE_TANF2 = 0.0045911;
// Geocentric semi-diameters of Sun/Moon AT t0 (from the page's "Geocentric Coordinates... at
// Greatest Eclipse" block) - used only to calibrate how many degrees one Besselian fundamental-
// plane unit represents (see _eclipseScaleDegPerUnit), and as the drawn disc radii themselves
// (both change negligibly over the ~2h the elements are valid for, so treated as constant).
const ECLIPSE_SUN_SEMIDIAM_DEG  = (15 + 47.0 / 60) / 60;   // 15'47.0"
const ECLIPSE_MOON_SEMIDIAM_DEG = (16 + 16.9 / 60) / 60;   // 16'16.9"
const ECLIPSE_UV_SIGN = 1;   // flip to -1 if a rendered case shows the Moon crossing the wrong side

function _eclipsePoly(coeffs, t) { let s = 0, tp = 1; for (const c of coeffs) { s += c * tp; tp *= t; } return s; }
function _eclipseElementsAt(t) {
  return {
    x: _eclipsePoly(ECLIPSE_BE.x, t), y: _eclipsePoly(ECLIPSE_BE.y, t), d: _eclipsePoly(ECLIPSE_BE.d, t),
    l1: _eclipsePoly(ECLIPSE_BE.l1, t), l2: _eclipsePoly(ECLIPSE_BE.l2, t), mu: _eclipsePoly(ECLIPSE_BE.mu, t),
  };
}
// Local circumstances for the app's OWN current Calibration location (LAT/lonHemisphere/LONG,
// core.js) at Besselian time t (hours since t0). WGS84 flattening for the geocentric-latitude
// reduction; observer height taken as sea level (0) - both refinements below the precision this
// prototype needs. Longitude: Besselian elements use the classical convention (positive WEST of
// Greenwich) - the app's LONG is positive-magnitude with lonHemisphere (+1 E / -1 W), so negate.
function _eclipseLocalCirc(t) {
  const el = _eclipseElementsAt(t);
  const D2R = Math.PI / 180;
  const dRad = el.d * D2R;
  const f = 1 / 298.257;
  const uGeo = Math.atan((1 - f) * Math.tan(LAT * hemisphere * D2R));
  const rhoSinPhi = (1 - f) * Math.sin(uGeo);
  const rhoCosPhi = Math.cos(uGeo);
  const lonWestDeg = -lonHemisphere * LONG;
  const H = (el.mu - lonWestDeg) * D2R;
  const xi = rhoCosPhi * Math.sin(H);
  const eta = rhoSinPhi * Math.cos(dRad) - rhoCosPhi * Math.cos(H) * Math.sin(dRad);
  const zeta = rhoSinPhi * Math.sin(dRad) + rhoCosPhi * Math.cos(H) * Math.cos(dRad);
  const u = el.x - xi, v = el.y - eta;
  const L1 = el.l1 - zeta * ECLIPSE_TANF1, L2 = el.l2 - zeta * ECLIPSE_TANF2;
  return { u, v, L1, L2, m: Math.hypot(u, v) };
}
function _eclipseScaleDegPerUnit() {
  return (ECLIPSE_SUN_SEMIDIAM_DEG + ECLIPSE_MOON_SEMIDIAM_DEG) / ECLIPSE_BE.l1[0];
}
// Parallactic angle (Sun): angle at the Sun between the direction to the North Celestial Pole and
// the direction to the observer's zenith - the standard rotation from an equatorial (RA/Dec,
// "north-up") frame to a local horizon (zenith-up) frame. Used to spin the compass overlay so it
// keeps showing true N/S/E/W on the ground while the Sun/Moon diagram itself (drawn from (u,v),
// which lives in that same fixed equatorial frame) stays put - see drawEclipse().
function _eclipseParallacticAngle(H_rad, deltaRad) {
  const phi = LAT * hemisphere * Math.PI / 180;
  return Math.atan2(Math.sin(H_rad), Math.tan(phi) * Math.cos(deltaRad) - Math.sin(deltaRad) * Math.cos(H_rad));
}
// Sun's true-solar hour angle + declination at Besselian time t (hours since t0), reusing the
// app's own EoT/declination machinery (core.js) rather than re-deriving the Sun's position from
// the eclipse elements - t0 is 18:00 TDT on the real calendar day 2026-08-12, so this is just the
// app's ordinary sunPosition() pipeline fed the right day/hour.
function _eclipseSunGeom(t) {
  const doy = dayOfYear(ECLIPSE_DAY_MONTH, ECLIPSE_DAY_DAY);
  const utcHour = ECLIPSE_T0_UTC_HOURS + t;
  const lonEastDeg = lonHemisphere * LONG;
  const meanSolarHour = utcHour + lonEastDeg / 15;
  const trueSolarHour = trueFromMean(meanSolarHour, doy);
  const H = (trueSolarHour - 12) * 15 * Math.PI / 180;
  const deltaRad = sunDeclination(doy);
  return { H, deltaRad };
}
// Sun's topocentric altitude alone (degrees) at Besselian time t - used to find sunset within the
// event window (see _eclipseRecompute's defaultT below).
function _eclipseSunAltAt(t) {
  const { H, deltaRad } = _eclipseSunGeom(t);
  const phi = LAT * hemisphere * Math.PI / 180;
  return sunPosition(H, deltaRad, phi).el;
}

// ── Contact times (C1/C4 = partial begins/ends, C2/C3 = totality begins/ends if in the path) ──
// Root-finds m(t)-L1(t)=0 (C1,C4) and m(t)-L2(t)=0 (C2,C3) by scanning the whole valid window for
// sign changes then bisecting - cheap (a few thousand cheap polynomial evals, once per location),
// robust against the function's shape without needing derivatives.
function _eclipseScanRoots(fn, lo, hi, steps) {
  const roots = [];
  let prev = fn(lo), prevT = lo;
  for (let i = 1; i <= steps; i++) {
    const t = lo + (hi - lo) * i / steps;
    const v = fn(t);
    if ((prev < 0) !== (v < 0)) {
      let a = prevT, b = t, fa = prev;
      for (let k = 0; k < 40; k++) {
        const mid = (a + b) / 2, fm = fn(mid);
        if ((fa < 0) === (fm < 0)) { a = mid; fa = fm; } else { b = mid; }
      }
      roots.push((a + b) / 2);
    }
    prev = v; prevT = t;
  }
  return roots;
}
let _eclipseCircumstances = null;   // {c1,c4,c2,c3,tMax,visible,defaultT} for the CURRENT LAT/LONG - see _eclipseRecompute()
function _eclipseRecompute() {
  const roots1 = _eclipseScanRoots((t) => { const r = _eclipseLocalCirc(t); return r.m - r.L1; }, -3, 3, 3000);
  // L2 is negative for a total eclipse (the umbral cone has already converged past the observer)
  // and positive for an annular one (antumbral cone, hasn't converged yet) - visibility in either
  // case is m < |L2|, not m < L2 (which would never cross zero at all while L2 stays negative).
  const roots2 = _eclipseScanRoots((t) => { const r = _eclipseLocalCirc(t); return r.m - Math.abs(r.L2); }, -3, 3, 3000);
  let tMax = -3, mMin = Infinity;
  for (let t = -3; t <= 3; t += 0.002) { const r = _eclipseLocalCirc(t); if (r.m < mMin) { mMin = r.m; tMax = t; } }
  const visible = roots1.length >= 2;
  const c1 = visible ? roots1[0] : null, c4 = visible ? roots1[roots1.length - 1] : null;
  const c2 = roots2.length >= 1 ? roots2[0] : null, c3 = roots2.length >= 2 ? roots2[1] : null;

  // Default moment to land on - also what "Move to maximum phase" (btnEclipseMaxPhase) jumps back
  // to: normally the true greatest-eclipse instant (tMax), but for a PARTIAL-only event (no
  // totality) whose tMax happens to fall after the Sun has already set, that "peak" isn't actually
  // observable - default to sunset instead, the last moment the partial eclipse could really be
  // seen, rather than a below-horizon instant the user would just have to scrub away from
  // immediately. tMax itself stays available for the Stats panel's "at max" figures (an objective
  // property of the eclipse, not of what's visible from here) - just not as a slider destination.
  let defaultT = tMax;
  if (visible && c2 === null && _eclipseSunAltAt(tMax) < 0) {
    const sunsetRoots = _eclipseScanRoots((t) => _eclipseSunAltAt(t), c1, c4, 1000);
    for (const r of sunsetRoots) {
      if (_eclipseSunAltAt(r - 0.001) > 0) { defaultT = r; break; }   // + -> - crossing = sunset, not sunrise
    }
  }

  _eclipseCircumstances = { visible, c1, c4, c2, c3, tMax, mMin, defaultT };
  return _eclipseCircumstances;
}

// Slider track fill: yellow (no eclipse) -> black (totality), by how much of the Sun is actually
// covered at each point along the track - not just a straight-line ease between the contact times,
// so the black band's width on screen reflects how long totality actually lasts here, same idea as
// #rngSunTime's own --sun-fill (render-3d.js) built from real per-instant state rather than guessed
// endpoints. White tick lines mark C1/C2/C3/C4 (partial/totality begin+end) on top, using that same
// gradient-layering trick (a second, mostly-transparent gradient stacked above the colour one).
const ECLIPSE_FILL_YELLOW = [245, 197, 24];   // #f5c518 - matches the Sun disc / no-eclipse state
const ECLIPSE_FILL_BLACK  = [18, 16, 10];     // matches the Moon disc / totality - not pure #000, so it still reads as a colour, not "empty"
function _eclipseBuildSliderFill(circ) {
  const slider = document.getElementById('rngEclipseTime');
  if (!slider) return;
  const min = parseFloat(slider.min), max = parseFloat(slider.max);
  const span = Math.max(0.0001, max - min);
  const lerp = (a, b, f) => Math.round(a + (b - a) * f);
  const colorAt = (t) => {
    let f = 0;   // 0 = no eclipse (yellow), 1 = totality (black)
    if (circ.visible && t > circ.c1 && t < circ.c4) {
      if (circ.c2 !== null && circ.c3 !== null && t >= circ.c2 && t <= circ.c3) {
        f = 1;   // inside totality itself - fully black regardless of exactly how deep m dips
      } else {
        const r = _eclipseLocalCirc(t);
        f = Math.max(0, Math.min(1, 1 - r.m / r.L1));   // partial phase - how much of the Sun is covered
      }
    }
    return 'rgb(' + lerp(ECLIPSE_FILL_YELLOW[0], ECLIPSE_FILL_BLACK[0], f) + ',' +
                     lerp(ECLIPSE_FILL_YELLOW[1], ECLIPSE_FILL_BLACK[1], f) + ',' +
                     lerp(ECLIPSE_FILL_YELLOW[2], ECLIPSE_FILL_BLACK[2], f) + ')';
  };
  const N = 100, stops = [];
  for (let i = 0; i <= N; i++) {
    const t = min + span * i / N;
    stops.push(colorAt(t) + ' ' + (i / N * 100).toFixed(2) + '%');
  }
  const colorGrad = 'linear-gradient(to right, ' + stops.join(',') + ')';
  let markGrad = '';
  if (circ.visible) {
    const marks = [circ.c1, circ.c2, circ.c3, circ.c4].filter((v) => v !== null);
    const segs = marks.map((t) => {
      const p = ((t - min) / span * 100).toFixed(2);
      return `transparent calc(${p}% - 1px), #fff calc(${p}% - 1px), #fff calc(${p}% + 1px), transparent calc(${p}% + 1px)`;
    });
    markGrad = 'linear-gradient(90deg, ' + segs.join(', ') + '), ';
  }
  slider.style.setProperty('--eclipse-fill', markGrad + colorGrad);
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────
// "17:20 UTC+1", not a bare UT reading: paired with a variable, user-adjustable offset (the
// Calibration panel's own Time zone selector), UTC is the right label - "UTC+1" is the standard,
// universally understood way to write a civil time together with its zone, the way "UT+1" isn't.
// The displayed digits are the actual shifted civil time (UT + that offset), not raw UT with the
// offset just tacked on as a side note - so both halves of "UTC+1" stay true of the same number:
// it really is that many hours ahead of UTC. (TDT->UT here goes through ΔT, 71.4 s for this
// eclipse, technically TT minus UT1 rather than TT minus UTC - but UT1/UTC track each other to
// within 0.9 s, well under this feature's own precision, so that distinction doesn't survive the
// UTC relabelling and isn't worth carrying as a second caveat on top of it.)
function _eclipseFmtUTC(t) {
  const shiftedHours = ECLIPSE_T0_UTC_HOURS + t + timeZoneHours;
  const totalSec = Math.round(shiftedHours * 3600);
  const secOfDay = ((totalSec % 86400) + 86400) % 86400;
  const h = Math.floor(secOfDay / 3600);
  const m = Math.floor(secOfDay / 60) % 60;
  const s = secOfDay % 60;
  const sign = timeZoneHours >= 0 ? '+' : '-';
  const mag = Math.abs(timeZoneHours);
  const magStr = Number.isInteger(mag) ? String(mag) : mag.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ' UTC' + sign + magStr;
}
// Sun's own az/alt at Besselian time t, for the shared top readout bar (valAz/valAlt/valDay/
// valTime/valDir) - same world-azimuth/hemisphere-flip convention the readout already uses
// everywhere else (see controls.js's mousemove handler), computed from the app's own sunPosition()
// rather than anything Besselian-element-specific (the Sun's position doesn't depend on the Moon).
function _eclipseUpdateReadout(t) {
  const valAz = document.getElementById('valAz'), valAlt = document.getElementById('valAlt');
  const valDay = document.getElementById('valDay'), valTime = document.getElementById('valTime');
  const valDir = document.getElementById('valDir');
  if (!valAz) return;
  const { H: hAngle, deltaRad } = _eclipseSunGeom(t);
  const phi = LAT * hemisphere * Math.PI / 180;
  const s = sunPosition(hAngle, deltaRad, phi);
  const azWorld = (s.beta + 180 + 360) % 360;
  const displayAz = hemisphere >= 0 ? azWorld : (azWorld + 180) % 360;
  valAz.textContent = displayAz.toFixed(1) + '°';
  valAlt.textContent = (s.el >= 0 ? '+' : '') + s.el.toFixed(1) + '°';
  valDay.textContent = MONTH_NAMES[ECLIPSE_DAY_MONTH - 1] + ' ' + ECLIPSE_DAY_DAY;
  valTime.textContent = _eclipseFmtUTC(t);
  valDir.textContent = azimutToDir(displayAz);

  // Live magnitude/obscuration - AT THIS INSTANT (t), unlike the Stats panel's "at max" figures.
  // Same two group+separator pairs SSV10M/T use above (hidden unless relevant) - shown for the
  // whole time Eclipse is active rather than gated on anything further, since they're meaningful
  // (if zero) even before/after the local event.
  const magSep = document.getElementById('eclMagSep'), magGroup = document.getElementById('eclMagGroup');
  const obscSep = document.getElementById('eclObscSep'), obscGroup = document.getElementById('eclObscGroup');
  if (magSep && magGroup && obscSep && obscGroup) {
    magSep.style.display = ''; magGroup.style.display = '';
    obscSep.style.display = ''; obscGroup.style.display = '';
    const valMag = document.getElementById('valEclMag'), valObsc = document.getElementById('valEclObsc');
    if (_eclipseCircumstances && _eclipseCircumstances.visible) {
      const r1 = ECLIPSE_SUN_SEMIDIAM_DEG, r2 = ECLIPSE_MOON_SEMIDIAM_DEG;
      const mDeg = _eclipseLocalCirc(t).m * _eclipseScaleDegPerUnit();
      const magnitude = Math.max(0, (r1 + r2 - mDeg) / (2 * r1));
      valMag.textContent = magnitude.toFixed(3);
      valObsc.textContent = (_eclipseObscuration(t) * 100).toFixed(1) + '%';
    } else {
      valMag.textContent = '—';
      valObsc.textContent = '—';
    }
  }
}

// Small translucent background box behind an axis label, so it stays legible over the twilight-
// gradient sky below (no longer a flat, predictable colour) - reads the CURRENT ctx.textAlign to
// anchor the box the same way fillText itself will place the text (assumes textBaseline='middle').
// bgStyle lets a dark-text label (the black horizon line/label) use a LIGHT box instead of the
// default dark one, so the text never ends up dark-on-dark.
function _eclipseLabelBg(ctx, text, x, y, bgStyle) {
  const w = ctx.measureText(text).width;
  const padX = 3, padY = 2, lineH = 12;
  const bx = ctx.textAlign === 'center' ? x - w / 2 - padX : ctx.textAlign === 'right' ? x - w - padX : x - padX;
  const by = y - lineH / 2 - padY;
  ctx.fillStyle = bgStyle || 'rgba(0,0,0,0.5)';
  ctx.fillRect(bx, by, w + padX * 2, lineH + padY * 2);
}

// Twilight sky background colour model - ported from Sky Map 3D's ambient sky colour
// (_skyPlanetAmbientColorAt, render-skydome.js), which itself depends only on elevation (never
// azimuth): blue by day, fading to near-black night, with a warm dusk/dawn band right at the
// horizon. Kept as plain, canvas-free functions here (not shared with render-skydome.js) so this
// file doesn't take on a load-order dependency on it - the palette/thresholds are copied verbatim.
// Deliberately excludes the dome's separate sun-halo glow - only the sky colour itself is reused.
function _eclipseLerp3(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
// Blue-by-elevation base colour: pale/hazy near the horizon, deeper blue toward the zenith.
function _eclipseShellColorAt(elDeg) {
  const t = Math.max(0, Math.min(1, elDeg / 90));
  return [Math.round(200 - 130 * t), Math.round(222 - 130 * t), Math.round(240 - 60 * t)];
}
const ECLIPSE_ASTRO_TWILIGHT_DEG = -18;   // matches _SG_THRESH.astro (render-sungraph.js)
// 0 once the sun is in astronomical twilight or below, 1 once it's comfortably risen (+10°).
function _eclipseDaylightFactor(sunElDeg) {
  return Math.max(0, Math.min(1, (sunElDeg - ECLIPSE_ASTRO_TWILIGHT_DEG) / (10 - ECLIPSE_ASTRO_TWILIGHT_DEG)));
}
// Peaks (1) with the sun sitting right on the horizon, fades to 0 by +-18 deg either way.
function _eclipseDuskFactor(sunElDeg) {
  return Math.max(0, Math.min(1, 1 - Math.abs(sunElDeg) / 18));
}
// The field of view here is only ~1deg across (the Sun is deliberately huge), so there's no
// meaningful "elevation of the sky point" to grade across the frame the way the dome's mesh does -
// the whole background is coloured at the Sun's own current altitude, once per frame.
function _eclipseAmbientColorAt(sunElDeg) {
  const dayCol = _eclipseShellColorAt(sunElDeg);
  const nightCol = [6, 10, 24];
  let col = _eclipseLerp3(nightCol, dayCol, _eclipseDaylightFactor(sunElDeg));
  const horizonBand = Math.max(0, Math.min(1, 1 - sunElDeg / 22));
  const glowStrength = _eclipseDuskFactor(sunElDeg) * horizonBand * 0.55;
  return _eclipseLerp3(col, [235, 140, 70], glowStrength);
}

// Eclipse-phase sky darkening, blended on top of the twilight-by-altitude colour above - a real,
// dramatic part of totality (the whole sky dims, not just the Sun/Moon disc). O = fraction of the
// Sun's disc AREA actually covered (proper circle-circle overlap, not the linear 1-m/L1 proxy the
// slider fill uses - that one only needs to be roughly phase-shaped, this one drives an actual
// colour so the real covered area matters). V = perceived relative brightness, following the eye's
// non-linear response to dimming light: V=(1-O)^0.4 - brightness barely drops until the last ~10%
// of the disc is covered, then falls away fast, matching how a 90%-covered Sun still looks almost
// like a normal day.
function _eclipseObscuration(t) {
  const r1 = ECLIPSE_SUN_SEMIDIAM_DEG, r2 = ECLIPSE_MOON_SEMIDIAM_DEG;
  const d = _eclipseLocalCirc(t).m * _eclipseScaleDegPerUnit();
  if (d >= r1 + r2) return 0;                                     // no overlap at all
  if (d <= Math.abs(r1 - r2)) return Math.min(1, (Math.min(r1, r2) ** 2) / (r1 * r1));   // one disc wholly inside the other
  const d1 = (d * d - r2 * r2 + r1 * r1) / (2 * d), d2 = d - d1;   // standard two-circle lens intersection
  const a1 = Math.max(-1, Math.min(1, d1 / r1)), a2 = Math.max(-1, Math.min(1, d2 / r2));
  const area = r1 * r1 * Math.acos(a1) - d1 * Math.sqrt(Math.max(0, r1 * r1 - d1 * d1))
             + r2 * r2 * Math.acos(a2) - d2 * Math.sqrt(Math.max(0, r2 * r2 - d2 * d2));
  return Math.max(0, Math.min(1, area / (Math.PI * r1 * r1)));
}
function _eclipseBrightnessFactor(t) { return Math.pow(1 - _eclipseObscuration(t), 0.4); }
// Deliberately lighter than the Moon disc itself (#3a3a3e / rgb(58,58,62)) so the disc still reads
// as a distinct, darker shape against the dimmed sky rather than disappearing into it.
const ECLIPSE_TOTALITY_GREY = [92, 92, 100];

function drawEclipse(t) {
  const cv = document.getElementById('eclipseCanvas');
  if (!cv) return;
  const RES = cv._res || 1;
  const ctx = cv.getContext('2d');
  const W = cv.width / RES, H = cv.height / RES;
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Sun geometry at this instant, needed up front now for the twilight background below, and
  // shared by the compass labels, the Moon's own position, the horizon overlay and the top
  // readout (_eclipseUpdateReadout, called separately) - computed once rather than several times.
  const { H: hAngle, deltaRad } = _eclipseSunGeom(t);
  const phi = LAT * hemisphere * Math.PI / 180;
  const sunGeom = sunPosition(hAngle, deltaRad, phi);

  // Twilight sky background - same palette/thresholds as Sky Map 3D's ambient sky colour
  // (_eclipseAmbientColorAt below, ported from _skyPlanetAmbientColorAt in render-skydome.js).
  // Blue stays blue through the day and only tunes into the dusk palette near the horizon - the
  // Sun's own glow/halo is deliberately NOT reproduced here, just the sky colour itself. On top of
  // that, the eclipse's own phase dims the sky further (_eclipseBrightnessFactor, V=(1-O)^0.4),
  // blending toward a neutral totality grey as coverage approaches 100%.
  const bgCol = _eclipseAmbientColorAt(sunGeom.el);
  const bgFinal = _eclipseLerp3(ECLIPSE_TOTALITY_GREY, bgCol, _eclipseBrightnessFactor(t));
  ctx.fillStyle = `rgb(${Math.round(bgFinal[0])},${Math.round(bgFinal[1])},${Math.round(bgFinal[2])})`;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const size = Math.min(W, H);
  const scaleDeg = _eclipseScaleDegPerUnit();
  const sunRadiusPx = size * 0.24;
  const pxPerDeg = sunRadiusPx / ECLIPSE_SUN_SEMIDIAM_DEG;

  const chkGrid = document.getElementById('chkEclipseGrid');
  const chkLabels = document.getElementById('chkEclipseLabels');
  const chkEquatorial = document.getElementById('chkEclipseEquatorial');
  const chkHorizon = document.getElementById('chkEclipseHorizon');
  const showGrid = chkGrid ? chkGrid.checked : true;
  const showLabels = chkLabels ? chkLabels.checked : false;
  const showEquatorial = chkEquatorial ? chkEquatorial.checked : true;
  const showHorizon = chkHorizon ? chkHorizon.checked : false;

  const q = _eclipseParallacticAngle(hAngle, deltaRad);
  // Same world-azimuth/hemisphere-flip convention the top readout uses (_eclipseUpdateReadout) -
  // the Az/Alt grid's own azimuth values (below) are labelled in this same convention, so a line
  // reading e.g. "293.5°" here always means the same thing the AZ field up top does.
  const sunAzWorld = (sunGeom.beta + 180 + 360) % 360;
  const sunAz = hemisphere >= 0 ? sunAzWorld : (sunAzWorld + 180) % 360;
  // Calibrates the WHOLE model (not just an overlay) so the horizon is always horizontal on
  // screen (the local horizon-tangent direction, E-W-ish) and "up" is always toward the zenith -
  // matching a real photograph taken with a level camera, rather than the raw equatorial (u,v)
  // frame the Besselian elements themselves use (which "up" would instead be celestial North -
  // correct for a star chart, but tilts the horizon to an arbitrary diagonal as the Sun/Moon
  // drift across the real sky, since the parallactic angle keeps changing through the event).
  // Same rotation matrix ctx.rotate(-q) would apply, just done on the raw numbers instead of the
  // drawing context - because the horizon overlay below needs to stay a single, robust, always-
  // full-width horizontal band, not a shape that has to be rotated (and re-bounded) along with it.
  const cosQ = Math.cos(q), sinQ = Math.sin(q);
  const rot = (x, y) => ({ x: x * cosQ + y * sinQ, y: -x * sinQ + y * cosQ });

  // Az/Alt grid - same idea and colours as the app's own main grid (Azimuth = gold #E8A020,
  // Altitude = blue #20A0E8, see index.html's legend). Stepped every 0.5° - the field of view here
  // is only about a degree across (the Sun's real ~0.26° radius is deliberately stretched to fill
  // a quarter of the canvas, so the "bite" stays legible), so even this coarser step still shows
  // several lines; kept at this zoom rather than shrinking the Sun/Moon to fit a coarser grid
  // (user's call - the dramatic close-up matters more here).
  //
  // Lines sit at ABSOLUTE, real alt/az values (round multiples of the 0.5° step), not at a fixed
  // offset from the Sun's own screen position - so as the Sun's true altitude/azimuth drifts over
  // the ~90 minutes of the event, the whole grid slides underneath it exactly the way the Horizon
  // overlay already does (same sunGeom.el/sunAz this frame's Horizon line and top readout use) -
  // rather than always trivially reading "the Sun is at its own position". The altitude line that
  // lands exactly on 0° - true horizon - is drawn black (see Horizon overlay below), since that's
  // the one row of the grid that's independently meaningful; every label sits on its own small
  // translucent backing box (_eclipseLabelBg) so it stays legible over the twilight-gradient sky.
  // Fixed, NOT rotated by rot(): the whole model is already calibrated zenith-up/horizon-flat (see
  // above), so a plain horizontal/vertical grid IS an azimuth/altitude grid here, directly - no
  // further transform needed, unlike the equatorial cross (a genuinely different, rotating frame).
  const gridStepDeg = 0.5;
  if (showGrid) {
    const viewSpanDeg = Math.hypot(W, H) / 2 / pxPerDeg + gridStepDeg;
    ctx.font = "10px 'Share Tech Mono', monospace";
    ctx.textBaseline = 'middle';

    const altLoI = Math.ceil((sunGeom.el - viewSpanDeg) / gridStepDeg);
    const altHiI = Math.floor((sunGeom.el + viewSpanDeg) / gridStepDeg);
    for (let i = altLoI; i <= altHiI; i++) {
      const altVal = i * gridStepDeg;
      const y = cy + (sunGeom.el - altVal) * pxPerDeg;
      const isHorizon = i === 0;
      ctx.lineWidth = isHorizon ? 1.5 : 1;
      ctx.strokeStyle = isHorizon ? '#000' : 'rgba(32,160,232,0.65)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      if (showLabels) {
        ctx.textAlign = 'left';
        const label = isHorizon ? 'horizon' : altVal.toFixed(1) + '°';
        _eclipseLabelBg(ctx, label, 4, y - 6, isHorizon ? 'rgba(255,255,255,0.6)' : undefined);
        ctx.fillStyle = isHorizon ? '#000' : 'rgba(140,205,245,0.95)';
        ctx.fillText(label, 4, y - 6);
      }
    }

    const azLoI = Math.ceil((sunAz - viewSpanDeg) / gridStepDeg);
    const azHiI = Math.floor((sunAz + viewSpanDeg) / gridStepDeg);
    for (let i = azLoI; i <= azHiI; i++) {
      const azVal = i * gridStepDeg;
      const x = cx + (azVal - sunAz) * pxPerDeg;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(232,160,32,0.65)';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (showLabels) {
        ctx.textAlign = 'center';
        const label = azVal.toFixed(1) + '°';
        _eclipseLabelBg(ctx, label, x, 12);
        ctx.fillStyle = 'rgba(255,210,90,0.95)';
        ctx.fillText(label, x, 12);
      }
    }
  }

  const gridR = size * 0.46;
  if (showEquatorial) {
    // N-S and E-W are always mutually perpendicular (true for any observer, at any time) - so the
    // cross itself rotates as one rigid unit with its labels, exactly like the ORIGINAL ctx.rotate
    // version did. What "floats with time" is this whole cross's angle relative to the model's now-
    // fixed zenith-up/horizon-flat calibration (rot(), the same transform the Moon's position and
    // the horizon overlay's "down" direction are built from) - NOT the labels drifting away from
    // their own cross while it stays put, which doesn't correspond to anything real (a lesson from
    // the previous version: the compass bearings and "toward zenith" are two independent axes that
    // only coincide when the parallactic angle happens to be 0). Renamed from "Compass grid" - it's
    // built on the equatorial (RA/Dec-like) frame the Besselian elements themselves use, converted
    // to true horizon bearings only via this rotation - "equatorial grid" names what it actually is.
    const axisN = rot(0, -gridR), axisS = rot(0, gridR), axisE = rot(gridR, 0), axisW = rot(-gridR, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx + axisW.x, cy + axisW.y); ctx.lineTo(cx + axisE.x, cy + axisE.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + axisN.x, cy + axisN.y); ctx.lineTo(cx + axisS.x, cy + axisS.y); ctx.stroke();
    if (showLabels) {
      ctx.font = "bold 13px 'Share Tech Mono', monospace";
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // Sit just PAST the line's own end (gridR), not a few px short of it (which used to land
      // the label right on top of the line itself) - so the label and the cross read as two
      // separate things instead of overlapping.
      const labelR = gridR + 14;
      const compass = [['N', 0, -labelR], ['S', 0, labelR], ['E', labelR, 0], ['W', -labelR, 0]];
      for (const [label, x, y] of compass) { const p = rot(x, y); ctx.fillText(label, cx + p.x, cy + p.y); }
    }
  }

  // Sun - locked at centre for the whole event.
  ctx.beginPath(); ctx.arc(cx, cy, sunRadiusPx, 0, Math.PI * 2);
  ctx.fillStyle = '#f5c518';
  ctx.fill();

  // Moon - the only thing that moves. Its Besselian (u,v) offset is East+/North+ and already
  // topocentric (parallax-corrected via xi/eta in _eclipseLocalCirc), so it converts directly into
  // a real RA/Dec offset from the Sun (u = dRA*cosDec, v = dDec - the standard tangent-plane/
  // "standard coordinates" relation) - which then goes through the app's OWN sunPosition(), the
  // same function computing the Sun's own alt/az just above, to get the Moon's real altitude and
  // azimuth. Placed on screen via the exact same grid-relative mapping the Az/Alt grid and Horizon
  // overlay already use (dx=(az-sunAz)*px, dy=-(el-sunEl)*px) - NOT the rot()/parallactic-angle
  // shortcut the compass cross uses, which put the Moon's bite on the wrong side (a real observer
  // at 49.5N/16E on 2026-08-12 reported first contact from the Sun's upper-right, not upper-left,
  // and confirmed the times match exactly - only the orientation was off). This route reuses only
  // already-validated code (sunPosition, the grid's own trusted offset formula) rather than a
  // second, separate rotation - and its magnitude cross-checks against L1 almost exactly at C1.
  const circ = _eclipseLocalCirc(t);
  const moonRadiusPx = ECLIPSE_MOON_SEMIDIAM_DEG * pxPerDeg;
  const dRA = (ECLIPSE_UV_SIGN * circ.u * scaleDeg * Math.PI / 180) / Math.cos(deltaRad);
  const decMoon = deltaRad + ECLIPSE_UV_SIGN * circ.v * scaleDeg * Math.PI / 180;
  const moonGeom = sunPosition(hAngle - dRA, decMoon, phi);
  const moonAzWorld = (moonGeom.beta + 180 + 360) % 360;
  const moonAz = hemisphere >= 0 ? moonAzWorld : (moonAzWorld + 180) % 360;
  const mx = cx + (moonAz - sunAz) * pxPerDeg, my = cy - (moonGeom.el - sunGeom.el) * pxPerDeg;
  ctx.beginPath(); ctx.arc(mx, my, moonRadiusPx, 0, Math.PI * 2);
  ctx.fillStyle = '#3a3a3e';
  ctx.fill();

  // Horizon - a black half-plane at 90% opacity (10% "propustnost"/see-through, same dimming
  // convention as Sky Map 3D's cladding-off far side elsewhere in this app - dim, don't hide),
  // covering every point below the Sun's own current altitude. Drawn ON TOP of the Sun/Moon so it
  // visibly darkens them once the Sun's real altitude drops below 0° - the Sun/Moon diagram itself
  // always stays exactly where it is (locked at centre, moved only by the rotated (u,v)), so
  // without this there'd be no visual sign at all that the Sun has actually set for this observer.
  // Because the whole model (not just this overlay) is already calibrated zenith-up/horizon-flat,
  // this is now just a plain, always-full-width horizontal band - not a shape that needs its own
  // rotation or a finite "how far past the edge is far enough" guess (§ the earlier bug: a
  // fixed-height band shifted with the horizon line and could clear the canvas's bottom edge
  // entirely once the Sun was more than a few degrees below the horizon).
  if (showHorizon) {
    const horizonY = cy + sunGeom.el * pxPerDeg;   // below the Sun icon when Sun is above horizon, above it when below
    // A genuinely huge, fixed span - NOT scaled from the canvas size or from how far horizonY
    // itself has shifted (that was the earlier bug: a band sized off `size`/`H` looks "big enough"
    // near el=0°, but pxPerDeg is deliberately large - the Sun's real ~0.26° radius is stretched to
    // ~24% of the canvas - so even a modest-looking altitude like -3° moves horizonY by several
    // canvas-heights, sliding the far edge of any size-relative band clean past the visible area.
    // 1e6 px comfortably dwarfs |horizonY| for any altitude this event actually reaches.
    const BIG = 1e6;
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(-BIG, horizonY, BIG * 2, BIG);
  }

  // Date/time + Sun coordinates go to the shared top readout bar (valAz/valAlt/valDay/valTime/
  // valDir), not a canvas-local label - see _eclipseUpdateReadout. Phase stays in the left panel
  // (there's no field for it in the top bar's fixed Az/Alt/Day/Time/Dir layout).
  _eclipseUpdateReadout(t);
  const phaseLbl = document.getElementById('eclipsePhaseLabel');
  if (phaseLbl) {
    if (_eclipseCircumstances) {
      const c = _eclipseCircumstances;
      let phase = 'no eclipse here';
      if (c.visible) {
        if (c.c2 !== null && c.c3 !== null && t >= c.c2 && t <= c.c3) phase = 'totality';
        else if (t >= c.c1 && t <= c.c4) phase = 'partial';
      }
      phaseLbl.textContent = phase;
    }
  }
}
function _eclipseUpdateCircTable() {
  const table = document.getElementById('eclipseCircTable');
  if (!table || !_eclipseCircumstances) return;
  const c = _eclipseCircumstances;
  const row = (label, val) => `<div class="ecl-row"><span>${label}</span><span>${val}</span></div>`;
  const rows = [];
  if (!c.visible) {
    rows.push(row('Status', 'not visible here'));
  } else {
    rows.push(row('C1 begins', _eclipseFmtUTC(c.c1)));
    if (c.c2 !== null) rows.push(row('C2 totality', _eclipseFmtUTC(c.c2)));
    rows.push(row('Max', _eclipseFmtUTC(c.tMax)));
    if (c.c3 !== null) rows.push(row('C3 ends', _eclipseFmtUTC(c.c3)));
    rows.push(row('C4 ends', _eclipseFmtUTC(c.c4)));
  }
  table.innerHTML = rows.join('');
}
// H:MM:SS for an hour-or-more span (the whole penumbral event), M:SS for anything shorter
// (totality itself) - both durations share this one formatter rather than needing separate cases.
function _eclipseFmtDuration(hours) {
  const totalSec = Math.round(hours * 3600);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return (h > 0 ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
// Whole-event numbers (as opposed to _eclipseUpdateCircTable's per-contact clock times) - magnitude
// and obscuration are two different, both-standard ways of quantifying "how much of the Sun is
// covered": magnitude is diameter-fraction based (Espenak's usual (r1+r2-m)/(2*r1)), obscuration is
// the actual covered-area fraction (_eclipseObscuration, also driving the sky-darkening above) -
// showing both since they're genuinely different numbers or a total eclipse would just be redundant.
function _eclipseUpdateStatsTable() {
  const table = document.getElementById('eclipseStatsTable');
  if (!table || !_eclipseCircumstances) return;
  const c = _eclipseCircumstances;
  const row = (label, val) => `<div class="ecl-row"><span>${label}</span><span>${val}</span></div>`;
  if (!c.visible) { table.innerHTML = ''; return; }
  const r1 = ECLIPSE_SUN_SEMIDIAM_DEG, r2 = ECLIPSE_MOON_SEMIDIAM_DEG;
  const mDegAtMax = c.mMin * _eclipseScaleDegPerUnit();
  const magnitude = (r1 + r2 - mDegAtMax) / (2 * r1);
  const rows = [
    row('Magnitude at max', magnitude.toFixed(3)),
    row('Moon/Sun size ratio', (r2 / r1).toFixed(4)),
    row('Obscuration', (_eclipseObscuration(c.tMax) * 100).toFixed(1) + '%'),
    row('Duration (penumbral)', _eclipseFmtDuration(c.c4 - c.c1)),
    row('Duration (totality)', (c.c2 !== null && c.c3 !== null) ? _eclipseFmtDuration(c.c3 - c.c2) : '—'),
  ];
  table.innerHTML = rows.join('');
}

// ── UI wiring - same canvas-takeover pattern as Theater3D/Sun Graph/Sky Dome (see enterSkyDome/
// exitSkyDome in render-skydome.js), so it sits in #canvasContainer alongside them rather than a
// standalone overlay. Left panel (#eclipsePanel) replaces #can3dPanel, its own Display section
// (#eclipseDisplaySection) replaces #displaySection, and Calibration collapses to just Location
// (#calibNonLocationGroup + btnCalibReset hidden) - none of the pinhole/photo calibration applies
// here, only the observer's location does. ─────────────────────────────────────────────────────
let eclipseActive = false;
function enterEclipse() {
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D && typeof exitTheater3D === 'function') exitTheater3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive && typeof exitSunGraph === 'function') exitSunGraph();
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive && typeof exitSkyDome === 'function') exitSkyDome();

  const container = document.getElementById('canvasContainer');
  const uploadZone = document.getElementById('uploadZone');
  container.classList.remove('hidden');
  if (uploadZone) uploadZone.classList.add('hidden');

  document.getElementById('eclipseCanvas').style.display = 'block';
  document.getElementById('eclipseSliderRow').style.display = 'block';
  document.getElementById('mainCanvas').style.pointerEvents = 'none';
  document.getElementById('statusWrap').style.display = 'none';

  document.getElementById('can3dPanel').classList.remove('visible');
  document.getElementById('eclipsePanel').classList.add('visible');
  document.getElementById('displaySection').style.display = 'none';
  document.getElementById('eclipseDisplaySection').style.display = 'flex';
  document.getElementById('calibNonLocationGroup').classList.add('hidden');
  document.getElementById('btnCalibReset').classList.add('hidden');
  document.getElementById('btnEclipseMaxPhase').style.display = '';
  // Eclipse is a peer of Gallery/Analyzer, not a sub-state of Analyzer - only ITS button should
  // read as active while it's showing, even though currentMode technically stays 'analyzer'
  // underneath (see the click handler below). Analyzer's own striped look comes back in
  // exitEclipse().
  document.getElementById('btnModeAnalyzer').className = 'mode-btn';
  document.getElementById('btnModeEclipse').classList.add('active-eclipse');

  eclipseActive = true;
  const circ = _eclipseRecompute();
  _eclipseUpdateCircTable();
  _eclipseUpdateStatsTable();
  const slider = document.getElementById('rngEclipseTime');
  if (circ.visible) {
    slider.min = (circ.c1 - 0.05).toString();
    slider.max = (circ.c4 + 0.05).toString();
    slider.value = circ.defaultT.toString();
  } else {
    slider.min = '-3'; slider.max = '3'; slider.value = circ.defaultT.toString();
  }
  _eclipseBuildSliderFill(circ);
  if (typeof updateViewButtons === 'function') updateViewButtons();
  resizeEclipse();
}
function exitEclipse() {
  document.getElementById('eclipseCanvas').style.display = 'none';
  document.getElementById('eclipseSliderRow').style.display = 'none';
  document.getElementById('mainCanvas').style.pointerEvents = '';
  eclipseActive = false;

  document.getElementById('can3dPanel').classList.add('visible');
  document.getElementById('eclipsePanel').classList.remove('visible');
  document.getElementById('displaySection').style.display = '';
  document.getElementById('eclipseDisplaySection').style.display = 'none';
  document.getElementById('calibNonLocationGroup').classList.remove('hidden');
  document.getElementById('btnCalibReset').classList.remove('hidden');
  document.getElementById('btnEclipseMaxPhase').style.display = 'none';
  document.getElementById('btnModeEclipse').classList.remove('active-eclipse');
  document.getElementById('eclMagSep').style.display = 'none';
  document.getElementById('eclMagGroup').style.display = 'none';
  document.getElementById('eclObscSep').style.display = 'none';
  document.getElementById('eclObscGroup').style.display = 'none';
  // Restore Analyzer's own active look, since it was suppressed above while Eclipse had the
  // spotlight - only when we're actually staying in Analyzer (leaving for Gallery instead means
  // setMode('gallery') is about to set both buttons' classes itself, right after this returns).
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
function resizeEclipse() {
  if (!eclipseActive) return;
  const container = document.getElementById('canvasContainer');
  const cv = document.getElementById('eclipseCanvas');
  const RES = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  const cw = container.clientWidth, ch = container.clientHeight;
  cv._res = RES;
  cv.width = Math.round(cw * RES);
  cv.height = Math.round(ch * RES);
  cv.style.width = cw + 'px';
  cv.style.height = ch + 'px';
  drawEclipse(parseFloat(document.getElementById('rngEclipseTime').value));
}
// Lighter than enterEclipse(): re-renders the canvas and the circumstance table with whatever's
// current, without recomputing contact times or resetting the slider - for changes that affect
// only how times are DISPLAYED (the Time zone offset baked into every "UTC+N" reading, see
// applyTimeZone() in controls.js) rather than the eclipse geometry itself.
function _eclipseRefreshDisplay() {
  if (!eclipseActive) return;
  _eclipseUpdateCircTable();
  drawEclipse(parseFloat(document.getElementById('rngEclipseTime').value));
}
document.getElementById('rngEclipseTime').addEventListener('input', (e) => {
  drawEclipse(parseFloat(e.target.value));
});
document.getElementById('btnEclipseMaxPhase').addEventListener('click', () => {
  if (!_eclipseCircumstances) return;
  const slider = document.getElementById('rngEclipseTime');
  slider.value = _eclipseCircumstances.defaultT;
  drawEclipse(_eclipseCircumstances.defaultT);
});
document.getElementById('chkEclipseGrid').addEventListener('change', () => {
  drawEclipse(parseFloat(document.getElementById('rngEclipseTime').value));
});
document.getElementById('chkEclipseLabels').addEventListener('change', () => {
  drawEclipse(parseFloat(document.getElementById('rngEclipseTime').value));
});
document.getElementById('chkEclipseEquatorial').addEventListener('change', () => {
  drawEclipse(parseFloat(document.getElementById('rngEclipseTime').value));
});
document.getElementById('chkEclipseHorizon').addEventListener('change', () => {
  drawEclipse(parseFloat(document.getElementById('rngEclipseTime').value));
});
window.addEventListener('resize', () => { if (eclipseActive) resizeEclipse(); });

// Top-level mode button, a peer of Gallery/Analyzer rather than an Analyzer sub-view - it still
// piggybacks on Analyzer's canvas-container/panel/calibration scaffolding (see enterEclipse()
// above), so entering just means "be in Analyzer, then take over the canvas". Toggles off back to
// the plain Image sub-view rather than leaving Analyzer entirely.
document.getElementById('btnModeEclipse').addEventListener('click', () => {
  if (eclipseActive) {
    if (typeof enterImageView === 'function') enterImageView();
    return;
  }
  if (currentMode !== 'analyzer') setMode('analyzer');
  enterEclipse();
});
