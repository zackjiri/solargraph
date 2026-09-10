// ─── Eclipse engine ─────────────────────────────────────────────────────────────────────────
// Universal Besselian-element-driven local-circumstances engine + renderer - NOT specific to any
// one eclipse. Per-event data (Besselian coefficients, semi-diameters, calendar day, greatest-
// eclipse reference point, source/validation notes) lives in js/eclipse-data/*.js, each file
// pushing one entry into window.ECLIPSE_EVENTS (loaded before this file); this engine always
// operates on whichever entry is currently active (_eclipseActiveEvent). Computes real local
// circumstances (when/how much the Moon covers the Sun) for whatever LAT/LONG the Calibration
// panel is currently set to - i.e. reuses the app's own location, not a hardcoded one.
//
// Algorithm: standard Besselian-element local-circumstances method (Meeus, "Astronomical
// Algorithms" ch.54 / Explanatory Supplement to the Astronomical Almanac §11.3).
let _eclipseActiveEvent = (window.ECLIPSE_EVENTS && window.ECLIPSE_EVENTS[0]) || null;
// Switches the engine to a different registered event (e.g. a Catalog tile click, once that UI
// exists) - recomputes local circumstances for the new event and redraws if Eclipse is on screen;
// leaves the slider's own min/max/position alone here (the caller decides whether to reset those).
function _eclipseSetActiveEvent(event) {
  _eclipseActiveEvent = event;
  _eclipseRecompute();
  if (typeof eclipseActive !== 'undefined' && eclipseActive) {
    const slider = document.getElementById('rngEclipseTime');
    if (slider) drawEclipse(parseFloat(slider.value));
  }
}

function _eclipsePoly(coeffs, t) { let s = 0, tp = 1; for (const c of coeffs) { s += c * tp; tp *= t; } return s; }
// mu (Greenwich Hour Angle of the shadow axis) tracks Earth's own physical rotation, which runs on
// UT - unlike x/y/d/l1/l2, which describe smooth ephemeris geometry and are correctly evaluated at
// the polynomial's own TDT-based t (hours since t0, t0 itself given in TDT). Evaluating mu at that
// same TDT-based t (instead of the corresponding UT-elapsed time, t - deltaTSec/3600) leaves one
// whole deltaT's worth of Earth's rotation (~60-70s, ~15-20km on the ground) missing from H, shifting
// every computed ground point/longitude west by that amount - confirmed empirically for all three
// events independently cross-checked against NASA's own published Greatest Eclipse point (residual
// dropped from 15-21km to under 100m using this shift for 1999-08-11/2008-08-01/2026-08-12).
function _eclipseElementsAt(t) {
  return {
    x: _eclipsePoly(_eclipseActiveEvent.be.x, t), y: _eclipsePoly(_eclipseActiveEvent.be.y, t), d: _eclipsePoly(_eclipseActiveEvent.be.d, t),
    l1: _eclipsePoly(_eclipseActiveEvent.be.l1, t), l2: _eclipsePoly(_eclipseActiveEvent.be.l2, t),
    mu: _eclipsePoly(_eclipseActiveEvent.be.mu, t - _eclipseActiveEvent.deltaTSec / 3600),
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
  const L1 = el.l1 - zeta * _eclipseActiveEvent.tanf1, L2 = el.l2 - zeta * _eclipseActiveEvent.tanf2;
  return { u, v, L1, L2, m: Math.hypot(u, v) };
}
// Earth's equatorial radius / Moon's own physical radius - sin(parallax)/sin(semidiam) both subtend
// the same distance, so their ratio is this fixed physical constant.
const ECLIPSE_EARTH_MOON_RADIUS_RATIO = 6378.14 / 1737.4;
// Topocentric correction for the Moon's own apparent semi-diameter at Besselian time t, for the
// app's current Location - the Moon looks measurably bigger near the zenith (the observer is
// physically up to ~1 Earth radius closer to it there) and smaller near the horizon, a real effect
// (~1-1.5% at lunar distances) the app previously ignored entirely: moonSemidiamDeg was always the
// single geocentric value published "at greatest eclipse", used everywhere regardless of time or
// observer location - part of the long-documented magnitude/obscuration gap vs NASA (§21.21/§26).
// Confirmed empirically against an independent reference source (1999-08-11 at 50N/15E: geocentric
// ratio 1.0143 vs that source's 1.02803 - this correction lands at 1.02844, ~97% of the gap closed).
// The Sun's own parallax (~8.8 arcsec) is ~100x smaller and left uncorrected. Uses the Sun's own
// already-computed altitude as a stand-in for the Moon's - during an eclipse they sit within about
// the eclipse's own small angular separation of each other in the sky, far below this correction's
// own size.
function _eclipseMoonSemidiamTopoAt(t) {
  const r2 = _eclipseActiveEvent.moonSemidiamDeg;
  const D2R = Math.PI / 180;
  const parallax = Math.asin(ECLIPSE_EARTH_MOON_RADIUS_RATIO * Math.sin(r2 * D2R));
  const zenithRad = (90 - _eclipseSunAltAt(t)) * D2R;
  return r2 * (1 + Math.cos(zenithRad) * Math.sin(parallax));
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
  const doy = dayOfYear(_eclipseActiveEvent.dayMonth, _eclipseActiveEvent.dayDay);
  const utcHour = _eclipseActiveEvent.t0UtcHours + t;
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
  // to: normally the true greatest-eclipse instant (tMax), but whenever that instant falls after
  // the Sun has already set (partial OR total - a total event can have its tMax below the horizon
  // just as easily as a partial one, e.g. 37N/13E for this eclipse), that "peak" isn't actually
  // observable - default to sunset instead, the last moment the event could really be seen, rather
  // than a below-horizon instant the user would just have to scrub away from immediately. tMax
  // itself stays available for the Stats panel's "at max" figures (an objective property of the
  // eclipse, not of what's visible from here) - just not as a slider destination.
  let defaultT = tMax;
  if (visible && _eclipseSunAltAt(tMax) < 0) {
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
// endpoints. White tick lines mark C1/C2/C3/C4 (partial/totality begin+end) on top of that, and a
// thin horizon-visibility strip (white=above horizon, red=below) along the very bottom edge, on
// top of everything - three background LAYERS on the one track element (each given its own
// position/size via the background shorthand's "pos / size" syntax) rather than a separate bar
// underneath, so the thumb (taller than the track, css/style.css) visibly reaches into the strip.
const ECLIPSE_FILL_YELLOW   = [245, 197, 24];   // #f5c518 - matches the Sun disc / no-eclipse state
const ECLIPSE_FILL_BLACK    = [18, 16, 10];     // matches the Moon disc / deepest PARTIAL phase - not pure #000, so it still reads as a colour, not "empty"
const ECLIPSE_FILL_TOTALITY = [96, 42, 196];    // saturated blue-violet - totality (C2-C3) gets its own distinct colour rather than blending into the same black a deep partial phase already reaches, so the two are never visually ambiguous on the track
function _eclipseBuildSliderFill(circ) {
  const slider = document.getElementById('rngEclipseTime');
  if (!slider) return;
  const min = parseFloat(slider.min), max = parseFloat(slider.max);
  const span = Math.max(0.0001, max - min);
  const lerp = (a, b, f) => Math.round(a + (b - a) * f);
  const colorAt = (t) => {
    // Totality itself (C2-C3) - a flat, distinct colour regardless of exactly how deep m dips,
    // checked before the partial-phase gradient below rather than folded into it (unlike the
    // deepest partial phase, which DOES still grade smoothly into black via f).
    if (circ.visible && circ.c2 !== null && circ.c3 !== null && t >= circ.c2 && t <= circ.c3) {
      return `rgb(${ECLIPSE_FILL_TOTALITY[0]},${ECLIPSE_FILL_TOTALITY[1]},${ECLIPSE_FILL_TOTALITY[2]})`;
    }
    let f = 0;   // 0 = no eclipse (yellow), 1 = deepest partial phase (black)
    if (circ.visible && t > circ.c1 && t < circ.c4) {
      const r = _eclipseLocalCirc(t);
      f = Math.max(0, Math.min(1, 1 - r.m / r.L1));   // partial phase - how much of the Sun is covered
    }
    return 'rgb(' + lerp(ECLIPSE_FILL_YELLOW[0], ECLIPSE_FILL_BLACK[0], f) + ',' +
                     lerp(ECLIPSE_FILL_YELLOW[1], ECLIPSE_FILL_BLACK[1], f) + ',' +
                     lerp(ECLIPSE_FILL_YELLOW[2], ECLIPSE_FILL_BLACK[2], f) + ')';
  };
  const N = 100, stops = [], horizonStops = [];
  for (let i = 0; i <= N; i++) {
    const t = min + span * i / N;
    const pct = (i / N * 100).toFixed(2);
    stops.push(colorAt(t) + ' ' + pct + '%');
    horizonStops.push((_eclipseSunAltAt(t) >= 0 ? '#fff' : '#e84040') + ' ' + pct + '%');
  }
  const colorGrad = 'linear-gradient(to right, ' + stops.join(',') + ') top / 100% 100% no-repeat';
  const horizonGrad = 'linear-gradient(to right, ' + horizonStops.join(',') + ') bottom / 100% 4px no-repeat';
  let markGrad = '';
  if (circ.visible) {
    const marks = [circ.c1, circ.c2, circ.c3, circ.c4].filter((v) => v !== null);
    const segs = marks.map((t) => {
      const p = ((t - min) / span * 100).toFixed(2);
      return `transparent calc(${p}% - 1px), #fff calc(${p}% - 1px), #fff calc(${p}% + 1px), transparent calc(${p}% + 1px)`;
    });
    markGrad = 'linear-gradient(90deg, ' + segs.join(', ') + ') top / 100% 100% no-repeat, ';
  }
  slider.style.setProperty('--eclipse-fill', horizonGrad + ', ' + markGrad + colorGrad);
}
// Whether the Sun is ever above the horizon anywhere within [lo, hi] - checked directly at both
// endpoints first (cheap, covers the overwhelmingly common case), only falling back to a full
// crossing scan for the rarer case where the Sun dips below and back up (or vice versa) entirely
// within the window while both endpoints happen to read the same sign.
function _eclipseAnyVisibleIn(lo, hi) {
  if (_eclipseSunAltAt(lo) >= 0 || _eclipseSunAltAt(hi) >= 0) return true;
  return _eclipseScanRoots(_eclipseSunAltAt, lo, hi, 1000).length > 0;
}
// Whether the Besselian penumbra reaching this location (circ.visible) ever actually coincides
// with the Sun being above the horizon - a location can have real C1..C4 contact times and still
// never show anything, if the whole partial window happens to fall while the Sun is down (e.g.
// 35N/20E for this eclipse: C1 itself is already past sunset).
function _eclipseAnyVisible(circ) {
  return circ.visible && _eclipseAnyVisibleIn(circ.c1, circ.c4);
}
// The portion of [lo, hi] actually observable from here: its ends clamped inward to sunrise/sunset
// when the real endpoint itself falls below the horizon (mirrors defaultT's own sunset clamp,
// §21.14, but bidirectional - also covers a start clamped forward past sunrise). Used both for the
// whole penumbral event (c1,c4) and, separately, for totality alone (c2,c3) - a location can see
// only PART of totality above the horizon even while seeing all of the surrounding partial phase.
function _eclipseVisibleWindow(lo, hi) {
  let start = lo, end = hi;
  if (_eclipseSunAltAt(lo) < 0) {
    const roots = _eclipseScanRoots(_eclipseSunAltAt, lo, hi, 1000);
    for (const r of roots) { if (_eclipseSunAltAt(r + 0.001) > 0) { start = r; break; } }   // - -> + = sunrise
  }
  if (_eclipseSunAltAt(hi) < 0) {
    const roots = _eclipseScanRoots(_eclipseSunAltAt, lo, hi, 1000);
    for (let i = roots.length - 1; i >= 0; i--) {
      if (_eclipseSunAltAt(roots[i] - 0.001) > 0) { end = roots[i]; break; }   // + -> - = sunset, last one before hi
    }
  }
  return { start, end };
}
function _eclipseVisibleRange(circ) { return _eclipseVisibleWindow(circ.c1, circ.c4); }
// Plain "14:30" - no seconds, no "UTC+N" suffix (both shown elsewhere already) - for the compact
// start/end row under the slider, same shifted-civil-time convention as _eclipseFmtUTC.
function _eclipseFmtHM(t) {
  const shiftedHours = _eclipseActiveEvent.t0UtcHours + t + timeZoneHours;
  const minOfDay = (((Math.round(shiftedHours * 60)) % 1440) + 1440) % 1440;
  return String(Math.floor(minOfDay / 60)).padStart(2, '0') + ':' + String(minOfDay % 60).padStart(2, '0');
}
// Each label sits centred (left:X%, translateX(-50%) in CSS) directly over the real time it
// names, matching wherever that falls on the track below - NOT always the track's own 0%/100%
// edges, since a below-horizon C1/C4 gets clamped inward to sunrise/sunset (_eclipseVisibleRange).
function _eclipseUpdateStartEndLabels(circ) {
  const elS = document.getElementById('lblEclipseStart'), elE = document.getElementById('lblEclipseEnd');
  const slider = document.getElementById('rngEclipseTime');
  if (!elS || !elE || !slider) return;
  // No placeholder dashes here (unlike the circumstances table) - if there's nothing to see from
  // this location at all, "start"/"end" naming a time is itself misleading, so the row is just
  // empty rather than showing a "—" that implies a visible-but-unknown window.
  if (!circ.visible || !_eclipseAnyVisible(circ)) {
    elS.style.display = 'none'; elE.style.display = 'none';
    return;
  }
  elS.style.display = ''; elE.style.display = '';
  const min = parseFloat(slider.min), max = parseFloat(slider.max);
  const span = Math.max(0.0001, max - min);
  const { start, end } = _eclipseVisibleRange(circ);
  elS.textContent = 'start ' + _eclipseFmtHM(start);
  elE.textContent = 'end ' + _eclipseFmtHM(end);
  const startPct = (start - min) / span * 100, endPct = (end - min) / span * 100;
  elS.style.left = startPct.toFixed(2) + '%';
  elE.style.left = endPct.toFixed(2) + '%';
  // A short visible window (start/end close together, e.g. a quick sunset right after C1) can
  // centre the two labels close enough to overlap - getBoundingClientRect forces a layout, so this
  // reads real post-position widths rather than guessing from character counts. Nudge both apart
  // symmetrically just enough to clear each other, rather than abandoning the "each centred on its
  // real time" placement entirely.
  const row = elS.parentElement;
  const rowWidth = row ? row.getBoundingClientRect().width : 0;
  const overlapPx = elS.getBoundingClientRect().right - elE.getBoundingClientRect().left;
  if (overlapPx > 0 && rowWidth > 0) {
    const shiftPct = (overlapPx / 2 / rowWidth) * 100 + 1;   // +1% breathing room
    elS.style.left = `calc(${startPct.toFixed(2)}% - ${shiftPct.toFixed(2)}%)`;
    elE.style.left = `calc(${endPct.toFixed(2)}% + ${shiftPct.toFixed(2)}%)`;
  }
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
  const shiftedHours = _eclipseActiveEvent.t0UtcHours + t + timeZoneHours;
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
  valDay.textContent = MONTH_NAMES[_eclipseActiveEvent.dayMonth - 1] + ' ' + _eclipseActiveEvent.dayDay;
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
      const magnitude = Math.max(0, _eclipseMagnitude(t));
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
// Eclipse magnitude (fraction of the Sun's DIAMETER covered along the line of centers) - the
// standard (r1+r2-d)/(2*r1) formula in degrees. A from-Besselian-units-only shortcut was tried
// (using L1/L2/m directly, no degree conversion) but abandoned: it gave a magnitude >1 for a
// confirmed ANNULAR event (physically impossible - the Moon can never appear bigger than the
// Sun there), because L1 and L2 are scaled by DIFFERENT cone half-angles (tanf1 vs tanf2) - a bare
// L1/L2 ratio doesn't actually cancel that mismatch the way it first appeared to. The known gap
// against NASA's published magnitude (§21.21/§26) remains unresolved; this restores the
// pre-`34_1` degree-based formula (still the least-wrong option found so far), but derives its own
// Besselian-unit-to-degree scale FRESH from L1(t) each call, rather than reusing the shared
// _eclipseScaleDegPerUnit() (frozen at t0, geocentric moonSemidiamDeg) - that frozen version,
// compared here against the topocentric r2(t) used in (r1+r2), meant magnitude could read
// non-zero a few seconds before/after the table's own exact m(t)=L1(t) root for C1/C4 (found via
// real-world comparison, 2026-08-12 at 49.5N/16.2E). Anchoring the scale to L1(t) itself makes
// magnitude hit exactly 0 at the same instant the Circumstances table does, by construction: at
// t=C1, m(t)=L1(t) so mDeg=r1+r2 and magnitude=0 - continuously, with no separate clamp needed.
function _eclipseMagnitude(t) {
  const circ = _eclipseLocalCirc(t);
  const r1 = _eclipseActiveEvent.sunSemidiamDeg, r2 = _eclipseMoonSemidiamTopoAt(t);
  const mDeg = circ.m * (r1 + r2) / circ.L1;
  return (r1 + r2 - mDeg) / (2 * r1);
}
function _eclipseObscuration(t) {
  const circ = _eclipseLocalCirc(t);
  // Same authoritative test as C2/C3 (§21.2) - check it first so Obscuration never contradicts the
  // Circumstances table/slider fill it's supposed to describe, regardless of the area formula below.
  // ONLY for total (L2 < 0, umbral cone) - the Sun really is 100% covered there. Annular (L2 > 0,
  // antumbral cone) never reaches 100% even at dead-centre - a ring of Sun stays visible, capped at
  // (moon/sun)^2 - so it must fall through to the area formula below instead of being forced to 1
  // here (that's exactly what the "d <= |r1-r2|" branch already computes correctly on its own).
  if (circ.L2 < 0 && circ.m <= Math.abs(circ.L2)) return 1;
  const r1 = _eclipseActiveEvent.sunSemidiamDeg, r2 = _eclipseMoonSemidiamTopoAt(t);
  // Live-anchored to circ.L1, same fix and same reason as _eclipseMagnitude() (§21.40) and
  // drawEclipse()'s own scaleDeg (§21.41) - the frozen, geocentric _eclipseScaleDegPerUnit() here
  // meant Obscuration could read a few tenths of a percent before the table's own exact C1 (found
  // via real-world report: 0.2% showing before a 10:23:53 first-contact time). At d=r1+r2 (the "no
  // overlap" boundary just below) this now coincides exactly with m=L1, i.e. the table's own C1/C4
  // root, by the same algebraic construction as Magnitude - continuous, no separate clamp needed.
  const d = circ.m * (r1 + r2) / circ.L1;
  if (d >= r1 + r2) return 0;                                     // no overlap at all
  if (d <= Math.abs(r1 - r2)) return Math.min(1, (Math.min(r1, r2) ** 2) / (r1 * r1));   // one disc wholly inside the other
  const d1 = (d * d - r2 * r2 + r1 * r1) / (2 * d), d2 = d - d1;   // standard two-circle lens intersection
  const a1 = Math.max(-1, Math.min(1, d1 / r1)), a2 = Math.max(-1, Math.min(1, d2 / r2));
  const area = r1 * r1 * Math.acos(a1) - d1 * Math.sqrt(Math.max(0, r1 * r1 - d1 * d1))
             + r2 * r2 * Math.acos(a2) - d2 * Math.sqrt(Math.max(0, r2 * r2 - d2 * d2));
  return Math.max(0, Math.min(1, area / (Math.PI * r1 * r1)));
}
// Last 1% of coverage (O=0,99->1,00) darkens faster than the base curve's own local slope would
// give - the base V=(1-O)^0.4 already falls quickly there, but the very final approach to totality
// gets an extra, deliberate push toward black, landing exactly on V=0 at O=1 (full totality grey,
// see ECLIPSE_TOTALITY_GREY below).
function _eclipseBrightnessFactor(t) {
  const O = _eclipseObscuration(t);
  if (O < 0.99) return Math.pow(1 - O, 0.4);
  const vAt99 = Math.pow(0.01, 0.4);
  const localT = (O - 0.99) / 0.01;
  return vAt99 * (1 - localT) ** 2;
}
// Deliberately just a little lighter than the Moon disc itself (#3a3a3e / rgb(58,58,62)) so the
// disc still reads as a distinct, darker shape against the dimmed sky rather than disappearing
// into it - darker than the original [92,92,100] (kept the same faint cool tint).
const ECLIPSE_TOTALITY_GREY = [70, 70, 76];
// Deeper still - an extra push beyond ECLIPSE_TOTALITY_GREY specifically around the moment
// Obscuration reaches 100% (see _eclipseTotalityBoostFactor below), TOTAL events only. Deliberately
// subtle/cosmetic, not a dramatic further dimming - the corona fade-in (below) carries most of the
// visible effect here.
const ECLIPSE_TOTALITY_GREY_DEEP = [58, 58, 63];
// Extra darkening + corona fade-in, ramping in around C2 and back out around C3 - TOTAL events only
// (annular's own C2/C3 mark the start/end of its central/ring phase too, via the same m<=|L2|
// root-find, but Obscuration there never reaches 100% - §21's annular obscuration fix - so this is
// gated on event type, not just c2/c3 existing). Deliberately ASYMMETRIC around each contact, not
// centred on it - most of each transition happens while ALREADY inside totality (astronomically
// real/visible there), with only a brief anticipatory/lingering nudge on the outside: ramps 0->1
// starting PRE_SEC before C2, finishing IN_SEC after C2 (i.e. mostly during totality, not before
// it), holds at 1 through the steady middle, ramps 1->0 starting IN_SEC before C3 (mirrored - most
// of the down-ramp is still inside totality) and finishing PRE_SEC after C3. min(upRamp, downRamp) -
// rather than special-casing - naturally caps below 1 for a very short totality where the two ramps
// would otherwise overlap before either finishes, instead of overshooting or double-counting.
const ECLIPSE_TOTALITY_BOOST_PRE_SEC = 2, ECLIPSE_TOTALITY_BOOST_IN_SEC = 10;
function _eclipseTotalityBoostFactor(t) {
  const c = _eclipseCircumstances;
  if (!c || c.c2 === null || c.c3 === null || _eclipseActiveEvent.type !== 'total') return 0;
  const preT = ECLIPSE_TOTALITY_BOOST_PRE_SEC / 3600, inT = ECLIPSE_TOTALITY_BOOST_IN_SEC / 3600;
  const span = preT + inT;
  const up = Math.max(0, Math.min(1, (t - (c.c2 - preT)) / span));
  const down = Math.max(0, Math.min(1, ((c.c3 + preT) - t) / span));
  return Math.min(up, down);
}
// Preloaded once at module load - drawEclipse() only draws it once .complete is true, so the very
// first few frames (before the network fetch resolves) simply skip the corona rather than drawing
// a broken image; same idiom as any other one-shot asset preload in the project.
const _eclipseCoronaImg = new Image();
_eclipseCoronaImg.src = 'img/eclipse/corona.png';
// Calibration baked into the asset itself (600x600px, centred) - 135px from centre is where the
// Sun's own disc edge belongs, everything beyond that is the corona rendering itself.
const ECLIPSE_CORONA_IMG_PX = 600, ECLIPSE_CORONA_REF_RADIUS_PX = 135;
// Radial reveal (on top of the plain opacity fade, §21.33) - at low totalityBoost only a thin ring
// just outside the Sun/Moon disc is visible, growing outward to the asset's own full extent as
// totalityBoost approaches 1. REVEAL_MIN_FRAC is a fraction of the corona canvas's own half-width
// (300px) - the disc itself already covers out to 135/300 = 0.45 of that, so this starts just past
// it (a faint trace right at the edge), not from the centre (which the disc hides anyway).
const ECLIPSE_CORONA_REVEAL_MIN_FRAC = 0.47, ECLIPSE_CORONA_REVEAL_FEATHER_FRAC = 0.12;
// Reused every frame (native 600x600 asset resolution, independent of on-screen zoom/sunRadiusPx -
// that only scales the FINAL drawImage() of this onto the main canvas) rather than recreated, so
// masking the reveal radius each frame is just one drawImage + one gradient fill, not a fresh
// canvas allocation.
let _eclipseCoronaMaskCanvas = null;
function _eclipseCoronaMasked(totalityBoost) {
  if (!_eclipseCoronaMaskCanvas) {
    _eclipseCoronaMaskCanvas = document.createElement('canvas');
    _eclipseCoronaMaskCanvas.width = ECLIPSE_CORONA_IMG_PX;
    _eclipseCoronaMaskCanvas.height = ECLIPSE_CORONA_IMG_PX;
  }
  const off = _eclipseCoronaMaskCanvas;
  const offCtx = off.getContext('2d');
  const half = ECLIPSE_CORONA_IMG_PX / 2;
  offCtx.globalCompositeOperation = 'source-over';
  offCtx.globalAlpha = 1;
  offCtx.clearRect(0, 0, ECLIPSE_CORONA_IMG_PX, ECLIPSE_CORONA_IMG_PX);
  offCtx.drawImage(_eclipseCoronaImg, 0, 0, ECLIPSE_CORONA_IMG_PX, ECLIPSE_CORONA_IMG_PX);
  const revealFrac = ECLIPSE_CORONA_REVEAL_MIN_FRAC + (1 - ECLIPSE_CORONA_REVEAL_MIN_FRAC) * totalityBoost;
  const stop1 = Math.max(0, Math.min(1, revealFrac));
  const stop2 = Math.max(stop1, Math.min(1, revealFrac + ECLIPSE_CORONA_REVEAL_FEATHER_FRAC));
  const grad = offCtx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(stop1, 'rgba(255,255,255,1)');
  grad.addColorStop(stop2, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  offCtx.globalCompositeOperation = 'destination-in';
  offCtx.fillStyle = grad;
  offCtx.fillRect(0, 0, ECLIPSE_CORONA_IMG_PX, ECLIPSE_CORONA_IMG_PX);
  offCtx.globalCompositeOperation = 'source-over';
  return off;
}

// canvasEl/updateReadout let this same renderer draw a live Catalog-tile thumbnail for some OTHER
// event (js/render-eclipse.js's enterEclipseCatalog()) without touching the real Visualization's
// own canvas or clobbering the shared top readout bar/phase label with that other event's numbers -
// both default to the normal Visualization behaviour, so every existing call site (just drawEclipse(t))
// is unaffected.
function drawEclipse(t, canvasEl, updateReadout = true) {
  const cv = canvasEl || document.getElementById('eclipseCanvas');
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
  // Moved up from just above the Moon section below (§21.40's own follow-up) - needed here now for
  // scaleDeg's own live L1(t) anchoring, but otherwise unchanged/still just used by the Moon's own
  // position and by the code below it.
  const circ = _eclipseLocalCirc(t);

  // Twilight sky background - same palette/thresholds as Sky Map 3D's ambient sky colour
  // (_eclipseAmbientColorAt below, ported from _skyPlanetAmbientColorAt in render-skydome.js).
  // Blue stays blue through the day and only tunes into the dusk palette near the horizon - the
  // Sun's own glow/halo is deliberately NOT reproduced here, just the sky colour itself. On top of
  // that, the eclipse's own phase dims the sky further (_eclipseBrightnessFactor, V=(1-O)^0.4),
  // blending toward a neutral totality grey as coverage approaches 100%.
  const bgCol = _eclipseAmbientColorAt(sunGeom.el);
  const bgBase = _eclipseLerp3(ECLIPSE_TOTALITY_GREY, bgCol, _eclipseBrightnessFactor(t));
  // Extra push toward an even deeper grey right around the moment Obscuration reaches 100%
  // (_eclipseTotalityBoostFactor above) - 0 outside that window, so bgFinal === bgBase everywhere
  // else, unchanged from before this feature existed. Display > Corona checkbox gates the WHOLE
  // effect (both this extra darkening and the corona image below), not just the image - the two
  // are one combined feature sharing the same trigger window, not independent toggles.
  const chkCorona = document.getElementById('chkEclipseCorona');
  const totalityBoost = (chkCorona && !chkCorona.checked) ? 0 : _eclipseTotalityBoostFactor(t);
  const bgFinal = _eclipseLerp3(bgBase, ECLIPSE_TOTALITY_GREY_DEEP, totalityBoost);
  ctx.fillStyle = `rgb(${Math.round(bgFinal[0])},${Math.round(bgFinal[1])},${Math.round(bgFinal[2])})`;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H / 2;
  const size = Math.min(W, H);
  const sunRadiusPx = size * 0.24;
  const pxPerDeg = sunRadiusPx / _eclipseActiveEvent.sunSemidiamDeg;
  // Moon's screen POSITION scale (Besselian units -> degrees), §21.40's own follow-up - used to be
  // the shared _eclipseScaleDegPerUnit() (frozen at t0, geocentric moonSemidiamDeg; since removed -
  // by §21.40's own follow-up in _eclipseObscuration() this was its last caller). That frozen scale,
  // compared against the topocentric moonRadiusPx below (§21.32), made the drawn discs visually
  // touch/part several seconds to a full minute-plus off the table's own exact C1/C4 (found via
  // real-world comparison, 1999-08-11 at 49.5N/16.2E: discs already overlapping a full ~57s before
  // the table's C1, and still overlapping ~65s after C4). Anchored live to circ.L1 instead - same
  // fix already applied to _eclipseMagnitude()/_eclipseObscuration() for the identical reason - so
  // the rendered gap hits exactly 0 at the same instant the table's C1/C4 root does, continuously.
  const scaleDeg = (_eclipseActiveEvent.sunSemidiamDeg + _eclipseMoonSemidiamTopoAt(t)) / circ.L1;

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
  // Only used by the Equatorial grid below (the Moon's own position goes through real topocentric
  // az/el instead, see the comment above the Moon disc). The extra x-negation corrects a left/right
  // mirror confirmed by an independent check: a point offset slightly toward increasing declination
  // (i.e. really "toward the north celestial pole"), converted to its own real az/el and placed via
  // the same trusted (az,el)->screen mapping the Az/Alt grid uses, lands at +x when this raw
  // rot(0,-r) math (without the negation) placed the "N" tip at -x - the y/altitude component was
  // already correct, only the x/azimuthal one was flipped. Confirmed for all four arms (N/S/E/W),
  // not just N.
  const cosQ = Math.cos(q), sinQ = Math.sin(q);
  const rot = (x, y) => ({ x: -(x * cosQ + y * sinQ), y: -x * sinQ + y * cosQ });

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

    // Azimuth is a bearing around the vertical axis, so a degree of azimuth covers less real sky
    // the higher the Sun sits - dx needs the same cos(sunEl) correction as the Moon's own position
    // below (found via a rendered-vs-Besselian mismatch at 42.8N/8.0W's C1). viewSpanDeg itself is
    // widened by the same factor so enough lines are still generated to cover the visible width
    // (each degree of azimuth now covers fewer pixels, so more of them fit on screen).
    const cosSunEl = Math.cos(sunGeom.el * Math.PI / 180);
    const azViewSpanDeg = viewSpanDeg / Math.max(0.05, cosSunEl);
    const azLoI = Math.ceil((sunAz - azViewSpanDeg) / gridStepDeg);
    const azHiI = Math.floor((sunAz + azViewSpanDeg) / gridStepDeg);
    for (let i = azLoI; i <= azHiI; i++) {
      const azVal = i * gridStepDeg;
      const x = cx + (azVal - sunAz) * cosSunEl * pxPerDeg;
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
      // separate things instead of overlapping. Only "N" labelled (not S/E/W too) - one anchor
      // point is enough to read the cross's orientation, and it sidesteps having to spell out
      // "not the same as horizon N/S/E/W" (see the checkbox's own tooltip) four times over.
      const labelR = gridR + 14;
      const nTip = rot(0, -labelR);
      ctx.fillText('N', cx + nTip.x, cy + nTip.y);
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
  // azimuth. Placed on screen via the same grid-relative mapping the Az/Alt grid and Horizon
  // overlay use (dy=-(el-sunEl)*px) - NOT the rot()/parallactic-angle shortcut the compass cross
  // uses, which put the Moon's bite on the wrong side (a real observer at 49.5N/16E on 2026-08-12
  // reported first contact from the Sun's upper-right, not upper-left).
  //
  // Bug found afterwards (a different observer at 42.8N/8.0W: "start" read 18:32 - the exact
  // Besselian C1 - but the rendered discs were still visibly, not just imperceptibly, apart at
  // that time): dx used the raw azimuth DIFFERENCE (moonAz-sunAz)*px with no cos(altitude) factor.
  // Azimuth is a bearing swept around the *vertical* axis, so the same 1° of azimuth covers less
  // real sky the higher the Sun sits - dx must be scaled by cos(sunEl) to stay a true angular
  // separation (the exact dRA*cosDec logic above, just for Az/Alt instead of RA/Dec). Verified
  // directly against the canvas's own drawn arc() calls at 42.8N/8.0W's C1 (sun at +21.8°, so
  // cos(el)=0.928, nowhere near 1): the old formula drew the discs 9.8px apart where they should
  // exactly touch; with cos(el) included the gap was under a pixel at the time.
  // NOTE (§21.40 follow-up): that "under a pixel" match didn't survive moonRadiusPx's later switch
  // to the topocentric radius (§21.32, a few paragraphs below) - a bigger live moon radius against
  // this section's own scaleDeg (frozen at t0 until this same follow-up) reopened the same gap,
  // up to ~a full minute early/late at some locations (1999-08-11 at 49.5N/16.2E). scaleDeg is now
  // itself anchored live to circ.L1 (computed above, moved up from here) for the same reason -
  // this cos(el) fix and that one are complementary, not redundant: this one keeps the DIRECTION of
  // the offset correct at any altitude, that one keeps its MAGNITUDE correct at any instant.
  // Topocentric (parallax-corrected, §21.30), not the flat geocentric moonSemidiamDeg - without it
  // the drawn Moon disc can end up too small (relative to the exact m<=|L2| test) to ever visually
  // cover the Sun during genuine totality, leaving a persistent sliver even at m=0 (found the hard
  // way: 49N/5E for 1999-08-11 is inside the path by the exact test - obscuration correctly reads
  // 100% - but the rendered gap implied by the geocentric ratio, 0.0143, converts to a bigger m-degree
  // margin than the true |L2| boundary allows; the topocentric ratio there, 0.0280, matches |L2|'s
  // own boundary almost exactly instead).
  const moonRadiusPx = _eclipseMoonSemidiamTopoAt(t) * pxPerDeg;
  const dRA = (_eclipseActiveEvent.uvSign * circ.u * scaleDeg * Math.PI / 180) / Math.cos(deltaRad);
  const decMoon = deltaRad + _eclipseActiveEvent.uvSign * circ.v * scaleDeg * Math.PI / 180;
  const moonGeom = sunPosition(hAngle - dRA, decMoon, phi);
  const moonAzWorld = (moonGeom.beta + 180 + 360) % 360;
  const moonAz = hemisphere >= 0 ? moonAzWorld : (moonAzWorld + 180) % 360;
  const mx = cx + (moonAz - sunAz) * Math.cos(sunGeom.el * Math.PI / 180) * pxPerDeg,
        my = cy - (moonGeom.el - sunGeom.el) * pxPerDeg;

  // Corona - drawn BEFORE the Moon disc below, so the disc's own solid fill sits on top of it (a
  // layer behind the Moon, not overlaid above it) - fades in/out with the same totalityBoost factor
  // driving the extra sky darkening above (0 outside the ±10s windows around C2/C3, so no draw call
  // at all most of the time). Centred on the Sun's own fixed screen position (cx,cy), not the Moon's
  // slightly-offset one - the corona is a solar feature, not something that tracks the Moon's
  // silhouette (the two positions are within a fraction of a pixel of each other this deep into
  // totality anyway). Scaled so the asset's own baked-in 135px reference radius
  // (ECLIPSE_CORONA_REF_RADIUS_PX, out of its 600px full size) lands exactly on the Sun's own drawn
  // disc edge (sunRadiusPx).
  //
  // Locked to the Sun's own equatorial (celestial North-up) orientation, not the screen/zenith-up
  // frame everything else here is calibrated to - the asset's own default artwork already assumes
  // "north up", so it needs the SAME rotation the Equatorial grid's own axes get (rot(), same q/
  // cosQ/sinQ above), not just a static, unrotated stamp. rot()'s matrix works out to "mirror the
  // x-axis, then rotate by q" (determinant -1, confirmed via the same left/right check noted at
  // rot()'s own definition) - ctx.scale(-1,1) then ctx.rotate(q), in that call order, composes onto
  // drawImage() the same way (canvas applies the LAST-called transform to the drawn content first).
  if (totalityBoost > 0 && _eclipseCoronaImg.complete && _eclipseCoronaImg.naturalWidth > 0) {
    const coronaSizePx = ECLIPSE_CORONA_IMG_PX * (sunRadiusPx / ECLIPSE_CORONA_REF_RADIUS_PX);
    // Radial reveal (§21's corona-reveal addition) masked in first, at native resolution - see
    // _eclipseCoronaMasked() above. Opacity (globalAlpha) still separately fades with the same
    // totalityBoost, on top of the growing reveal radius - the two effects compound, not replace
    // one another.
    const coronaMasked = _eclipseCoronaMasked(totalityBoost);
    ctx.save();
    ctx.globalAlpha = totalityBoost;
    ctx.translate(cx, cy);
    ctx.rotate(q);
    ctx.scale(-1, 1);
    ctx.drawImage(coronaMasked, -coronaSizePx / 2, -coronaSizePx / 2, coronaSizePx, coronaSizePx);
    ctx.restore();
  }

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
  // (there's no field for it in the top bar's fixed Az/Alt/Day/Time/Dir layout). Skipped entirely
  // for a Catalog-tile thumbnail render (updateReadout=false) - that readout/label belong to
  // whichever event Visualization actually has active, not to whatever tile happens to be rendering.
  if (!updateReadout) return;
  _eclipseUpdateReadout(t);
  const phaseLbl = document.getElementById('eclipsePhaseLabel');
  if (phaseLbl) {
    if (_eclipseCircumstances) {
      const c = _eclipseCircumstances;
      let phase = 'no eclipse here';
      // A location can have real C1..C4 contact times and still never once have the Sun above the
      // horizon during them (e.g. 35N/20E for this eclipse - C1 itself is already past sunset) -
      // that's "no eclipse here" in every practical sense, regardless of where the slider sits.
      if (c.visible && _eclipseAnyVisible(c)) {
        if (c.c2 !== null && c.c3 !== null && t >= c.c2 && t <= c.c3) phase = _eclipseCentralPhaseWord();
        else if (t >= c.c1 && t <= c.c4) phase = 'partial';
      }
      phaseLbl.textContent = phase;
    }
  }
}
// "totality" for total events, "annular" for annular events - user-facing wording only; internal
// physics/variable names (m < |L2|, ECLIPSE_TOTALITY_GREY, etc.) stay generic "totality" since
// they describe the same central-phase geometry regardless of which type it actually is.
function _eclipseCentralPhaseWord() {
  return (_eclipseActiveEvent && _eclipseActiveEvent.type === 'annular') ? 'annular' : 'totality';
}
function _eclipseUpdateCircTable() {
  const table = document.getElementById('eclipseCircTable');
  if (!table || !_eclipseCircumstances) return;
  const c = _eclipseCircumstances;
  // Contact times that fall while the Sun is already below the horizon aren't actually observable
  // from here (e.g. a total eclipse whose C1 or tMax happens after sunset, §1 above) - flagged red
  // rather than just silently listed the same as any other time.
  const row = (label, t) => {
    const style = _eclipseSunAltAt(t) < 0 ? ' style="color:var(--accent-red)"' : '';
    return `<div class="ecl-row"><span>${label}</span><span${style}>${_eclipseFmtUTC(t)}</span></div>`;
  };
  const rows = [];
  if (!c.visible) {
    rows.push('<div class="ecl-row"><span>Status</span><span>not visible here</span></div>');
  } else {
    rows.push(row('C1 begins', c.c1));
    if (c.c2 !== null) rows.push(row('C2 ' + _eclipseCentralPhaseWord(), c.c2));
    rows.push(row('Max', c.tMax));
    if (c.c3 !== null) rows.push(row('C3 ends', c.c3));
    rows.push(row('C4 ends', c.c4));
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
  // Nothing to report if the location never sees any of this above the horizon (_eclipseAnyVisible)
  // - same "no eclipse here" standard the phase label and start/end row already apply.
  if (!c.visible || !_eclipseAnyVisible(c)) { table.innerHTML = ''; return; }
  const r1 = _eclipseActiveEvent.sunSemidiamDeg;
  // At defaultT (the horizon-clamped landing point, §21.14), NOT the true astronomical tMax/mMin -
  // magnitude and obscuration are "how much of the Sun is covered" numbers, which should describe
  // what's actually observable from here, not a theoretical peak that might never be visible.
  // Moon/Sun size ratio uses the SAME topocentric-corrected Moon semi-diameter as Magnitude/
  // Obscuration below (§ _eclipseMoonSemidiamTopoAt) - varies with time/Location, not the single
  // fixed geocentric value published "at greatest eclipse".
  const r2 = _eclipseMoonSemidiamTopoAt(c.defaultT);
  const magnitude = Math.max(0, _eclipseMagnitude(c.defaultT));
  // Both durations clamped to the horizon-visible portion (_eclipseVisibleWindow) - same principle
  // as magnitude/obscuration above: describe what's actually observable from here, not the full
  // geometric span, some of which may fall while the Sun is down.
  const visSpan = _eclipseVisibleRange(c);
  let totalityDur = '—';
  if (c.c2 !== null && c.c3 !== null && _eclipseAnyVisibleIn(c.c2, c.c3)) {
    const visTot = _eclipseVisibleWindow(c.c2, c.c3);
    totalityDur = _eclipseFmtDuration(visTot.end - visTot.start);
  }
  const rows = [
    row('Magnitude at max', magnitude.toFixed(3)),
    row('Moon/Sun size ratio', (r2 / r1).toFixed(4)),
    row('Obscuration', (_eclipseObscuration(c.defaultT) * 100).toFixed(1) + '%'),
    row('Duration (penumbral)', _eclipseFmtDuration(visSpan.end - visSpan.start)),
    row('Duration (' + _eclipseCentralPhaseWord() + ')', totalityDur),
  ];
  table.innerHTML = rows.join('');
}

// ── UI wiring - same canvas-takeover pattern as Theater3D/Sun Graph/Sky Dome (see enterSkyDome/
// exitSkyDome in render-skydome.js), so it sits in #canvasContainer alongside them rather than a
// standalone overlay. Left panel (#eclipsePanel) replaces #can3dPanel, its own Display section
// (#eclipseDisplaySection) replaces #displaySection, and Calibration collapses to just Location
// (#calibNonLocationGroup + btnCalibReset hidden) - none of the pinhole/photo calibration applies
// here, only the observer's location does.
//
// Eclipse itself has two sub-views, switched via their own wheel picker (#eclipseSubRow, same
// widget as the Analyzer sub-view switcher/Sky Dome's projection switch - makeWheelPicker(),
// controls.js): Catalog (a grid of registered events to choose from - the landing sub-view every
// time Eclipse is entered from Gallery/Analyzer) and Visualization (the single-event animation,
// everything below this point that existed before the Catalog was added). enterEclipse()/
// exitEclipse() now only handle what's true of EITHER sub-view (leaving/entering the takeover
// itself, the top-level mode-button look, Calibration collapsing to Location); everything specific
// to actually animating one event lives in enterEclipseVisualization()/exitEclipseVisualization(),
// entered only once a Catalog tile is picked (or the sub-view wheel is stepped manually).
// ─────────────────────────────────────────────────────────────────────────────────────────────
let eclipseActive = false;
let eclipseSubView = 'catalog';   // 'catalog' | 'visualization' - which Eclipse sub-view is on screen
function enterEclipse() {
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D && typeof exitTheater3D === 'function') exitTheater3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive && typeof exitSunGraph === 'function') exitSunGraph();
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive && typeof exitSkyDome === 'function') exitSkyDome();

  const container = document.getElementById('canvasContainer');
  const uploadZone = document.getElementById('uploadZone');
  container.classList.remove('hidden');
  if (uploadZone) uploadZone.classList.add('hidden');

  document.getElementById('mainCanvas').style.pointerEvents = 'none';
  document.getElementById('statusWrap').style.display = 'none';
  document.getElementById('can3dPanel').classList.remove('visible');
  document.getElementById('displaySection').style.display = 'none';
  // Shown for BOTH sub-views (not just Visualization) - the Catalog's own tile previews are real
  // drawEclipse() renders too, so grid/labels/equatorial/horizon are just as live there.
  document.getElementById('eclipseDisplaySection').style.display = 'flex';
  document.getElementById('calibNonLocationGroup').classList.add('hidden');
  document.getElementById('btnCalibReset').classList.add('hidden');
  // Eclipse is a peer of Gallery/Analyzer, not a sub-state of Analyzer - only ITS button should
  // read as active while it's showing, even though currentMode technically stays 'analyzer'
  // underneath (see the click handler below). Analyzer's own striped look comes back in
  // exitEclipse().
  document.getElementById('btnModeAnalyzer').className = 'mode-btn';
  document.getElementById('btnModeEclipse').classList.add('active-eclipse');

  eclipseActive = true;
  // Switch #inpLat/#inpLong to Eclipse's own format (2 dp text, masked - see _eclipseFormatLocInput)
  // right away, rather than leaving them as Analyzer's plain type="number" until the first +/- click
  // or DEC/DM toggle happens to trigger a reformat.
  _eclipseFormatLocInput('inpLat', LAT);
  _eclipseFormatLocInput('inpLong', LONG);
  document.getElementById('eclipseSubRow').style.display = 'flex';
  document.getElementById('eclipseLocFormatRow').style.display = 'flex';
  // Apparent/Mean/Standard only ever affects the general app's own displayHour()/EoT pipeline -
  // Eclipse's own time formatting (_eclipseFmtUTC/_eclipseFmtHM) is always plain UTC+offset and
  // never consults timeDisplayMode at all, so this switcher would have zero effect here anyway.
  document.getElementById('btnTimeMode').style.display = 'none';
  document.getElementById('timeModeMenu').classList.remove('open');
  // Always land on Catalog first, regardless of which sub-view was showing last time Eclipse was
  // active - Visualization only loads once a specific event tile is picked.
  _eclipseSubIndex = 0;
  _eclipseSubWheel.render();
  enterEclipseCatalog();

  if (typeof updateViewButtons === 'function') updateViewButtons();
}
function exitEclipse() {
  if (eclipseSubView === 'visualization') exitEclipseVisualization(); else exitEclipseCatalog();
  document.getElementById('eclipseSubRow').style.display = 'none';
  document.getElementById('eclipseLocFormatRow').style.display = 'none';
  document.getElementById('btnTimeMode').style.display = '';
  document.getElementById('mainCanvas').style.pointerEvents = '';
  eclipseActive = false;
  _eclipseSetLocFormat('dec');   // Analyzer's own Location fields never inherit DM mode - order
                                  // matters: eclipseActive must already be false so this reformats
                                  // #inpLat/#inpLong back to Analyzer's own plain 0.1deg display.

  document.getElementById('can3dPanel').classList.add('visible');
  document.getElementById('displaySection').style.display = '';
  document.getElementById('eclipseDisplaySection').style.display = 'none';
  document.getElementById('calibNonLocationGroup').classList.remove('hidden');
  document.getElementById('btnCalibReset').classList.remove('hidden');
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

// ── Catalog sub-view - a grid of every registered event (window.ECLIPSE_EVENTS, js/eclipse-data/
// *.js), each tile a LIVE canvas-rendered preview (drawEclipse() itself, not a separate renderer)
// at that event's own horizon-clamped default moment - either for the app's own current
// Calibration Location, or for that event's own "Greatest Eclipse" point, depending on the
// location-mode switch below. Rendering a tile temporarily swaps _eclipseActiveEvent (and
// LAT/LONG in Greatest-Eclipse mode) - _eclipseRenderCatalogGrid() saves/restores them around the
// whole grid so this never disturbs whatever Visualization actually has active.
let _eclipseCatalogTypeFilter = 'all';    // 'all' | 'total' | 'partial' | 'annular' - filters on event.type
let _eclipseCatalogShowUpcoming = false;   // false = past (default), true = upcoming - filters on the
                                            // event's own calendar date vs. today's REAL-WORLD date
                                            // (not the app's Day calibration), see
                                            // _eclipseEventIsUpcoming() below
let _eclipseCatalogUseGreatest = false;   // false = my Location, true = each event's own Greatest Eclipse point
// Compares an event's calendar date (event.year/dayMonth/dayDay) against today's actual date - a
// same-day event still counts as upcoming (hasn't necessarily happened yet today).
function _eclipseEventIsUpcoming(ev) {
  const today = new Date();
  const todayYMD = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const evYMD = ev.year * 10000 + ev.dayMonth * 100 + ev.dayDay;
  return evYMD >= todayYMD;
}
const ECLIPSE_CATALOG_TILE_PX = 300;      // fixed render resolution - CSS scales the tile to fit the
                                           // grid; kept a step ahead of the tile's own ~210px CSS
                                           // display size (see .eclipse-tile min-width) so it stays crisp
function enterEclipseCatalog() {
  eclipseSubView = 'catalog';
  exitEclipseVisualization();
  document.getElementById('eclipseCatalogPanel').style.display = 'flex';
  // The top Az/Alt/Day/Time/Dir/Mag/Obsc readout describes one instant of one event - meaningless
  // while just browsing the grid (there's no single "current" event/time here). visibility (not
  // display) so the row's own space stays reserved - the header shouldn't reflow/jump when Catalog
  // opens, just show a blank readout.
  document.getElementById('readout').style.visibility = 'hidden';
  _eclipseRenderCatalogGrid();
}
function exitEclipseCatalog() {
  document.getElementById('eclipseCatalogPanel').style.display = 'none';
  document.getElementById('readout').style.visibility = '';
}
function _eclipseRenderCatalogGrid() {
  const grid = document.getElementById('eclipseCatalogGrid');
  if (!grid) return;
  // Newest first (top-left, given the grid's normal left-to-right/top-to-bottom flow) - registration
  // order in index.html's <script> tags doesn't imply chronological order, so sort explicitly here
  // rather than relying on it.
  const events = (window.ECLIPSE_EVENTS || []).slice().sort((a, b) =>
    (b.year - a.year) || (b.dayMonth - a.dayMonth) || (b.dayDay - a.dayDay));
  grid.innerHTML = '';
  const savedEvent = _eclipseActiveEvent;
  const savedLat = LAT, savedHemi = hemisphere, savedLon = LONG, savedLonHemi = lonHemisphere;
  for (const ev of events) {
    if (_eclipseCatalogTypeFilter !== 'all' && ev.type !== _eclipseCatalogTypeFilter) continue;
    const isUpcoming = _eclipseEventIsUpcoming(ev);
    if (isUpcoming !== _eclipseCatalogShowUpcoming) continue;
    _eclipseActiveEvent = ev;
    if (_eclipseCatalogUseGreatest) {
      LAT = ev.greatestEclipse.lat; hemisphere = ev.greatestEclipse.hemisphere;
      LONG = ev.greatestEclipse.lon; lonHemisphere = ev.greatestEclipse.lonHemisphere;
    } else {
      LAT = savedLat; hemisphere = savedHemi; LONG = savedLon; lonHemisphere = savedLonHemi;
    }
    const circ = _eclipseRecompute();

    const tile = document.createElement('div');
    tile.className = 'eclipse-tile';
    const dateLbl = document.createElement('div');
    dateLbl.className = 'eclipse-tile-date';
    dateLbl.textContent = MONTH_NAMES[ev.dayMonth - 1] + ' ' + ev.dayDay + ', ' + ev.year;
    dateLbl.classList.toggle('upcoming', isUpcoming);
    tile.appendChild(dateLbl);

    if (_eclipseAnyVisible(circ)) {
      const cv = document.createElement('canvas');
      cv.className = 'eclipse-tile-canvas';
      cv.width = ECLIPSE_CATALOG_TILE_PX; cv.height = ECLIPSE_CATALOG_TILE_PX;
      drawEclipse(circ.defaultT, cv, false);
      tile.appendChild(cv);

      // Global event.type (Total/Annular) only actually applies at a given location if totality/
      // annularity itself is above the horizon here - otherwise this location only ever sees the
      // surrounding partial phase, regardless of what the eclipse does elsewhere on Earth.
      const hasCentral = circ.c2 !== null && circ.c3 !== null && _eclipseAnyVisibleIn(circ.c2, circ.c3);
      const typeLbl = document.createElement('div');
      typeLbl.className = 'eclipse-tile-type';
      typeLbl.textContent = hasCentral ? (ev.type === 'annular' ? 'Annular' : 'Total') : 'Partial';
      tile.appendChild(typeLbl);

      // Gallery badge - same window.ECLIPSE_GALLERY[event.id] the Visualization "Load gallery"
      // button itself checks (§ below). Only on the visible/clickable branch - a greyed-out
      // "NO ECLIPSE" tile isn't something you can open into regardless of whether photos exist.
      if (window.ECLIPSE_GALLERY && window.ECLIPSE_GALLERY[ev.id]) {
        const badge = document.createElement('img');
        badge.className = 'eclipse-tile-gallery-badge';
        badge.src = 'icon_gallery.png';
        badge.alt = 'Photo gallery available';
        tile.appendChild(badge);
      }

      tile.classList.add('clickable');
      tile.title = 'Open ' + ev.label;
      tile.addEventListener('click', () => {
        _eclipseSetActiveEvent(ev);
        _eclipseSubIndex = 1;
        _eclipseSubWheel.render();
        enterEclipseVisualization();
      });
    } else {
      tile.classList.add('no-eclipse');
      const blank = document.createElement('div');
      blank.className = 'eclipse-tile-canvas eclipse-tile-blank';
      tile.appendChild(blank);
      const noneLbl = document.createElement('div');
      noneLbl.className = 'eclipse-tile-none';
      noneLbl.textContent = 'NO ECLIPSE';
      tile.appendChild(noneLbl);
    }
    grid.appendChild(tile);
  }
  _eclipseActiveEvent = savedEvent;
  LAT = savedLat; hemisphere = savedHemi; LONG = savedLon; lonHemisphere = savedLonHemi;
  _eclipseRecompute();   // leave global circumstances consistent with the real active event/location
}
document.getElementById('eclipseCatalogTypeFilter').addEventListener('click', (e) => {
  const btn = e.target.closest('.ns-btn');
  if (!btn || !document.getElementById('eclipseCatalogTypeFilter').contains(btn)) return;
  _eclipseCatalogTypeFilter = btn.dataset.type;
  document.querySelectorAll('#eclipseCatalogTypeFilter .ns-btn').forEach((b) => b.classList.toggle('active', b === btn));
  _eclipseRenderCatalogGrid();
});
document.getElementById('btnEclipseCatalogTimeMode').addEventListener('click', () => {
  _eclipseCatalogShowUpcoming = !_eclipseCatalogShowUpcoming;
  const btn = document.getElementById('btnEclipseCatalogTimeMode');
  btn.classList.toggle('on', _eclipseCatalogShowUpcoming);
  btn.setAttribute('aria-checked', String(_eclipseCatalogShowUpcoming));
  document.getElementById('eclipseCatalogTimeModeLabelA').classList.toggle('active-loc', !_eclipseCatalogShowUpcoming);
  document.getElementById('eclipseCatalogTimeModeLabelB').classList.toggle('active-loc', _eclipseCatalogShowUpcoming);
  _eclipseRenderCatalogGrid();
});
document.getElementById('btnEclipseCatalogLocMode').addEventListener('click', () => {
  _eclipseCatalogUseGreatest = !_eclipseCatalogUseGreatest;
  const btn = document.getElementById('btnEclipseCatalogLocMode');
  btn.classList.toggle('on', _eclipseCatalogUseGreatest);
  btn.setAttribute('aria-checked', String(_eclipseCatalogUseGreatest));
  document.getElementById('eclipseCatalogLocModeLabelA').classList.toggle('active-loc', !_eclipseCatalogUseGreatest);
  document.getElementById('eclipseCatalogLocModeLabelB').classList.toggle('active-loc', _eclipseCatalogUseGreatest);
  _eclipseRenderCatalogGrid();
});
// LAT/hemisphere/LONG/lonHemisphere change hook (controls.js's applyLat/applyLong/btnN/btnS/btnE/
// btnW) - refreshes whichever Eclipse sub-view is actually on screen, rather than unconditionally
// jumping back to Catalog the way calling enterEclipse() itself would (that function is also the
// top-level "just clicked the Eclipse button" entry point, and always lands on Catalog).
function _eclipseRefreshForLocationChange() {
  if (!eclipseActive) return;
  if (eclipseSubView === 'visualization') enterEclipseVisualization();
  else _eclipseRenderCatalogGrid();
}

// ── Visualization sub-view - the single-event animation (everything Eclipse originally was,
// before the Catalog existed).
function enterEclipseVisualization() {
  eclipseSubView = 'visualization';
  exitEclipseCatalog();

  document.getElementById('eclipseCanvas').style.display = 'block';
  document.getElementById('eclipseSliderRow').style.display = 'flex';
  document.getElementById('eclipsePanel').classList.add('visible');
  document.getElementById('btnEclipseVisExit').style.display = 'block';
  document.getElementById('btnEclipseMaxPhase').style.display = '';
  document.getElementById('btnEclipseGreatestPoint').style.display = '';
  // valDay's 110px min-width exists to fit the general app's day1/day2 hover pairs - Eclipse only
  // ever shows one fixed date ("Aug 12"), so that width is wasted space that pushes the readout
  // bar (already carrying the extra Mag/Obsc fields, §21.13) toward wrapping at narrower widths.
  // Reset in exitEclipseVisualization() below.
  document.getElementById('valDay').style.minWidth = '50px';

  eclipseAnimEverPlayed = false;   // re-arm "first Play starts from the beginning" for this (re-)entry
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
  _eclipseUpdateStartEndLabels(circ);
  // No point offering Play where there's nothing to animate - same "no eclipse here" standard as
  // the phase label and start/end row (_eclipseAnyVisible).
  document.getElementById('btnEclipsePlay').style.display = _eclipseAnyVisible(circ) ? '' : 'none';
  _eclipseUpdateGalleryUI();
  _eclipseUpdateDistanceToPath();
  resizeEclipse();
}
function exitEclipseVisualization() {
  _eclipseStopAnim();   // don't keep the rAF loop running once the canvas is hidden
  document.getElementById('eclipseCanvas').style.display = 'none';
  document.getElementById('eclipseSliderRow').style.display = 'none';
  document.getElementById('eclipsePanel').classList.remove('visible');
  document.getElementById('btnEclipseVisExit').style.display = 'none';
  document.getElementById('btnEclipseMaxPhase').style.display = 'none';
  document.getElementById('btnEclipseGreatestPoint').style.display = 'none';
  document.getElementById('eclipseDistToPathRow').style.display = 'none';
  document.getElementById('btnEclipseLoadGallery').style.display = 'none';
  document.getElementById('valDay').style.minWidth = '110px';   // restore the general app's width (day1/day2 pairs)
}

// Catalog/Visualization sub-view switcher - same wheel-picker widget as the Analyzer sub-view
// switcher and Sky Dome's projection switch (makeWheelPicker(), controls.js).
const ECLIPSE_SUB_VALUES = ['catalog', 'visualization'];
const ECLIPSE_SUB_LABELS = ['CATALOG', 'VISUALIZATION'];
const ECLIPSE_SUB_N = ECLIPSE_SUB_VALUES.length;
let _eclipseSubIndex = 0;
function stepEclipseSubWheel(dir) {
  _eclipseSubIndex = ((_eclipseSubIndex + dir) % ECLIPSE_SUB_N + ECLIPSE_SUB_N) % ECLIPSE_SUB_N;
}
function commitEclipseSubWheel() {
  const target = ECLIPSE_SUB_VALUES[_eclipseSubIndex];
  if (target === 'catalog') enterEclipseCatalog(); else enterEclipseVisualization();
  _eclipseSubWheel.render();
}
const _eclipseSubWheel = makeWheelPicker(document.getElementById('eclipseSubWheelTrack'), {
  labelAt: (off) => ECLIPSE_SUB_LABELS[((_eclipseSubIndex + off) % ECLIPSE_SUB_N + ECLIPSE_SUB_N) % ECLIPSE_SUB_N],
  step: stepEclipseSubWheel,
  itemW: 104,
  onCommit: commitEclipseSubWheel,
});
// Shared by the "✕ exit" button and the Escape key below - both just return to Catalog.
function _eclipseExitVisualizationToCatalog() {
  _eclipseSubIndex = 0;
  _eclipseSubWheel.render();
  enterEclipseCatalog();
}
document.getElementById('btnEclipseVisExit').addEventListener('click', _eclipseExitVisualizationToCatalog);
document.getElementById('btnEclipseSubDec').addEventListener('click', () => { stepEclipseSubWheel(-1); commitEclipseSubWheel(); });
document.getElementById('btnEclipseSubInc').addEventListener('click', () => { stepEclipseSubWheel(1);  commitEclipseSubWheel(); });
_eclipseSubWheel.render();
// Escape mirrors #btnEclipseVisExit - same "close the takeover, go back" convention as 3D Model's
// own Escape handler (render-3d.js), scoped to Eclipse Visualization specifically so it never fires
// while just browsing Catalog (which isn't a takeover to "exit" the same way).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && typeof eclipseActive !== 'undefined' && eclipseActive && eclipseSubView === 'visualization') {
    _eclipseExitVisualizationToCatalog();
  }
});

// ── Location format (Eclipse-only): decimal degrees (2 dp, 0.01deg step) vs degrees+arc-minutes
// (1' step). Analyzer's own #inpLat/#inpLong precision (0.1deg, .toFixed(1)) is untouched - these
// only take effect while eclipseActive (see applyLat/applyLong, controls.js), and the format resets
// to 'dec' whenever Eclipse is exited (exitEclipse() below) so Analyzer never inherits DM mode.
let _eclipseLocFormat = 'dec';   // 'dec' | 'dm'
function _eclipseLocStepDeg() {
  if (typeof eclipseActive === 'undefined' || !eclipseActive) return 0.1;   // Analyzer's own precision, unchanged
  return _eclipseLocFormat === 'dm' ? 1 / 60 : 0.01;
}
// The ◀/▶ Location arrow buttons (Eclipse-only) always land on the next whole degree in the
// direction pressed, rather than nudging by _eclipseLocStepDeg()'s own fine display precision -
// same idea as a keyboard's up/down arrow taking one full step at a time. From a fractional value
// this is just "round to the next whole degree that way" (e.g. 42.37 -> 43 going up, -> 42 going
// down); from an already-whole value floor/ceil no-op onto the same number, so the +/-1 below is
// what actually advances it - one formula covers both cases without an explicit "is it whole" check.
function _eclipseLocArrowStep(val, dir) {
  return dir > 0 ? Math.floor(val) + 1 : Math.ceil(val) - 1;
}
// Renders an already-rounded/clamped decimal-degree value (applyLat/applyLong's own job) into the
// given <input> in whichever format is active. DEC keeps the plain <input type="number"> (2 dp);
// DM needs free text ("42°48'") since a number input can't hold degree/minute symbols, so the
// input's own type is switched too.
function _eclipseFormatLocInput(inputId, deg) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const eclipseIsActive = typeof eclipseActive !== 'undefined' && eclipseActive;
  if (eclipseIsActive) {
    // Both formats use a free-text input while Eclipse is active (not just DM) - DEC needs it too so
    // its "." can be made a fixed, non-deletable character the same way DM's "°"/"'" are (see the
    // coordinate-input masking block below); a native type="number" can hold neither.
    el.type = 'text';
    if (_eclipseLocFormat === 'dm') {
      const d = Math.floor(deg);
      let m = Math.round((deg - d) * 60);
      // A rounded 60' carries into the next whole degree (e.g. 42.999...deg -> "43°00'", not "42°60'").
      const carry = m >= 60;
      el.value = (carry ? d + 1 : d) + '°' + String(carry ? 0 : m).padStart(2, '0') + "'";
    } else {
      el.value = deg.toFixed(2);
    }
  } else {
    el.type = 'number';
    el.step = '0.1';
    el.value = deg.toFixed(1);
  }
}

// ── Coordinate input masking (Eclipse-only): the . / ° / ' punctuation is a fixed, non-deletable
// part of the display format above - the user can freely edit the digit runs around it, but typing
// or deleting can never touch the separator itself, which is what keeps free input restricted to
// plain digits. Only meaningful now that #inpLat/#inpLong are type="text" while eclipseActive.
const ECLIPSE_LOC_FIXED_CHARS = ['.', '°', "'"];
function _eclipseLocSelectionHasFixedChar(el) {
  if (el.selectionStart === el.selectionEnd) return false;
  return [...el.value.slice(el.selectionStart, el.selectionEnd)].some((c) => ECLIPSE_LOC_FIXED_CHARS.includes(c));
}
function _eclipseLocInputKeydown(e) {
  if (typeof eclipseActive === 'undefined' || !eclipseActive) return;   // Analyzer's plain number inputs are untouched
  if (e.ctrlKey || e.metaKey) return;   // let copy/select-all/etc. shortcuts through untouched
  const el = e.target;
  const navKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', 'Escape'];
  if (navKeys.includes(e.key)) return;

  // Up/Down steps the field by a whole degree, same _eclipseLocArrowStep() rounding as the ◀/▶
  // Location buttons (controls.js) - one shared stepping convention regardless of which control the
  // user actually reaches for.
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? 1 : -1;
    if (el.id === 'inpLat') applyLat(_eclipseLocArrowStep(LAT, dir));
    else if (el.id === 'inpLong') applyLong(_eclipseLocArrowStep(LONG, dir));
    return;
  }

  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (_eclipseLocSelectionHasFixedChar(el)) { e.preventDefault(); return; }
    const pos = e.key === 'Backspace' ? el.selectionStart - 1 : el.selectionStart;
    if (pos >= 0 && pos < el.value.length && ECLIPSE_LOC_FIXED_CHARS.includes(el.value[pos])) {
      // Skip over the fixed character instead of deleting it - a second press then reaches the digit beyond it.
      e.preventDefault();
      const newPos = e.key === 'Backspace' ? pos : pos + 1;
      el.setSelectionRange(newPos, newPos);
    }
    return;
  }
  if (e.key.length === 1) {   // any single printable character - digits are the only ones let through
    if (_eclipseLocSelectionHasFixedChar(el)) { e.preventDefault(); return; }
    if (!/[0-9]/.test(e.key)) e.preventDefault();
  }
}
document.getElementById('inpLat').addEventListener('keydown', _eclipseLocInputKeydown);
document.getElementById('inpLong').addEventListener('keydown', _eclipseLocInputKeydown);
// Pasted text could freely inject non-digit junk or overwrite a fixed separator - simplest safe
// behaviour is to just block it rather than trying to sanitise+splice arbitrary pasted content.
function _eclipseLocInputPaste(e) {
  if (typeof eclipseActive !== 'undefined' && eclipseActive) e.preventDefault();
}
document.getElementById('inpLat').addEventListener('paste', _eclipseLocInputPaste);
document.getElementById('inpLong').addEventListener('paste', _eclipseLocInputPaste);
// Parses whatever the user actually typed into #inpLat/#inpLong back into plain decimal degrees -
// only meaningful in DM mode (DEC mode's <input type="number"> already only ever holds a plain
// number, so controls.js's _parseLocValue falls back to plain parseFloat there). Lenient about the
// exact separators typed: "42°48'", "42 48", "42:48" and a bare "42.8" are all accepted.
function _eclipseParseLocInput(text) {
  if (typeof eclipseActive === 'undefined' || !eclipseActive || _eclipseLocFormat !== 'dm') return NaN;
  const m = String(text).trim().match(/^(\d+(?:\.\d+)?)\s*[°:\s]?\s*(\d+(?:\.\d+)?)?\s*['′]?\s*$/);
  if (!m) return NaN;
  const deg = parseFloat(m[1]);
  const min = m[2] !== undefined ? parseFloat(m[2]) : 0;
  return deg + min / 60;
}
function _eclipseParseLocValue(raw) {
  const v = _eclipseParseLocInput(raw);
  return isNaN(v) ? (parseFloat(raw) || 0) : v;
}
function _eclipseSetLocFormat(fmt) {
  _eclipseLocFormat = fmt;
  document.getElementById('btnEclipseLocDec').className = 'ns-btn' + (fmt === 'dec' ? ' active' : '');
  document.getElementById('btnEclipseLocDM').className = 'ns-btn' + (fmt === 'dm' ? ' active' : '');
  _eclipseFormatLocInput('inpLat', LAT);
  _eclipseFormatLocInput('inpLong', LONG);
}
document.getElementById('btnEclipseLocDec').addEventListener('click', () => _eclipseSetLocFormat('dec'));
document.getElementById('btnEclipseLocDM').addEventListener('click', () => _eclipseSetLocFormat('dm'));

// ── Distance from the path of totality (Visualization-only, TOTAL events only) ─────────────────
// Shortest great-circle surface distance from the current Location to the umbral path, plus which
// of 8 compass directions gets there fastest. Reuses _eclipseLocalCirc's own m/L2 (§ engine above) -
// "inside the path" at some moment during the event is exactly the same m <= |L2| test already used
// for C2/C3 and the totality-coloured slider band, just asked of an arbitrary candidate point
// instead of the app's own current Location.
const ECLIPSE_EARTH_R_KM = 6371;
// Cheap approximation of "is this point ever inside the path": m(t) is a smooth, single-dip curve
// across the whole event while L2(t) varies slowly, so the tightest test is right at m's own
// minimum (the same tMax/mMin the Stats panel already reports) rather than a full fine-grained
// sweep for m<=|L2| (which would cost ~3000 evals per candidate point - far too slow once that runs
// for dozens of candidate points along all 8 bearings). Coarse pass then a local refine around the
// coarse winner, mirroring _eclipseRecompute's own tMax search but far fewer steps.
function _eclipseFindMinM() {
  let bestT = -3, bestM = Infinity;
  const coarseStep = 0.02;
  for (let t = -3; t <= 3; t += coarseStep) {
    const r = _eclipseLocalCirc(t);
    if (r.m < bestM) { bestM = r.m; bestT = t; }
  }
  const lo = Math.max(-3, bestT - coarseStep), hi = Math.min(3, bestT + coarseStep);
  const fineStep = coarseStep / 40;
  for (let t = lo; t <= hi; t += fineStep) {
    const r = _eclipseLocalCirc(t);
    if (r.m < bestM) { bestM = r.m; bestT = t; }
  }
  return bestT;
}
// Swaps the app's global Location (LAT/hemisphere/LONG/lonHemisphere) to the given signed-degree
// point (positive lat = N, positive lon = E) just long enough to run the existence check, then
// restores it - same save/swap/restore idiom _eclipseRenderCatalogGrid() already uses per tile.
function _eclipseTotalityExistsAt(latDeg, lonDeg) {
  const savedLat = LAT, savedHemi = hemisphere, savedLon = LONG, savedLonHemi = lonHemisphere;
  LAT = Math.abs(latDeg); hemisphere = latDeg < 0 ? -1 : 1;
  LONG = Math.abs(lonDeg); lonHemisphere = lonDeg < 0 ? -1 : 1;
  const t = _eclipseFindMinM();
  const r = _eclipseLocalCirc(t);
  const exists = r.m <= Math.abs(r.L2);
  LAT = savedLat; hemisphere = savedHemi; LONG = savedLon; lonHemisphere = savedLonHemi;
  return exists;
}
// Standard spherical-trig destination-point formula (bearing clockwise from true north, in degrees;
// distKm along Earth's surface) - signed lat/lon degrees in, signed lat/lon degrees out.
function _eclipseDestPoint(latDeg, lonDeg, bearingDeg, distKm) {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const lat1 = latDeg * D2R, lon1 = lonDeg * D2R, brng = bearingDeg * D2R, delta = distKm / ECLIPSE_EARTH_R_KM;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(delta) * Math.cos(lat1),
    Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: lat2 * R2D, lon: ((lon2 * R2D + 540) % 360) - 180 };   // normalise lon to [-180, 180)
}
const ECLIPSE_DIST_BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];   // N, NE, E, SE, S, SW, W, NW
const ECLIPSE_DIST_ARROWS   = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const ECLIPSE_DIST_MAX_KM  = 7500;   // scan range per bearing
// Two-tier scan step: fine near the observer, coarser further out. A single coarse step is only
// safe when it's guaranteed smaller than the path's own width (typically 50-300km) - but the
// "inside" zone measured ALONG AN ARBITRARY RAY (not perpendicular to the path) shrinks toward zero
// as the ray's angle to the path approaches tangent, which happens routinely for an observer just
// outside the path (found the hard way: 56N/0E for 1999-08-11 missed a real crossing only ~700km
// away in 6 of 8 directions, because the true/false flip happened entirely inside one 250km-wide
// sampling gap - both its ends read "outside", hiding the crossing between them). A flat fine step
// over the full 7500km range would be far too expensive, so only the near range (where this failure
// mode actually matters - farther out, a few km of extra slop hardly matters against the distance
// itself) gets it.
const ECLIPSE_DIST_STEP_NEAR_KM = 20, ECLIPSE_DIST_NEAR_RANGE_KM = 1500, ECLIPSE_DIST_STEP_FAR_KM = 100;
// For one bearing: scan outward from the current Location until a candidate point falls inside the
// path (same scan-then-bisect idiom as _eclipseScanRoots), then bisect within that bracket for a
// tighter distance. Returns Infinity if the path isn't reached within ECLIPSE_DIST_MAX_KM along this
// bearing (that bearing is just skipped, not an error).
function _eclipseNearestAlongBearing(latDeg, lonDeg, bearingDeg) {
  let prevInside = false, prevDist = 0;
  for (let d = ECLIPSE_DIST_STEP_NEAR_KM; d <= ECLIPSE_DIST_MAX_KM;
       d += (d < ECLIPSE_DIST_NEAR_RANGE_KM ? ECLIPSE_DIST_STEP_NEAR_KM : ECLIPSE_DIST_STEP_FAR_KM)) {
    const p = _eclipseDestPoint(latDeg, lonDeg, bearingDeg, d);
    const inside = _eclipseTotalityExistsAt(p.lat, p.lon);
    if (inside && !prevInside) {
      let lo = prevDist, hi = d;
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2;
        const pm = _eclipseDestPoint(latDeg, lonDeg, bearingDeg, mid);
        if (_eclipseTotalityExistsAt(pm.lat, pm.lon)) hi = mid; else lo = mid;
      }
      return hi;
    }
    prevInside = inside; prevDist = d;
  }
  return Infinity;
}
// Full result for the current Location: {distKm: 0, arrow: null} if already inside the path (☉ is
// shown instead of an arrow by the caller), {distKm, arrow} for the nearest of the 8 bearings
// otherwise, or {distKm: null} if none of the 8 bearings reach the path within ECLIPSE_DIST_MAX_KM.
function _eclipseDistanceToPath() {
  const curLat = LAT * hemisphere, curLon = LONG * lonHemisphere;
  if (_eclipseTotalityExistsAt(curLat, curLon)) return { distKm: 0, arrow: null };
  let bestDist = Infinity, bestArrow = null;
  for (let i = 0; i < ECLIPSE_DIST_BEARINGS.length; i++) {
    const d = _eclipseNearestAlongBearing(curLat, curLon, ECLIPSE_DIST_BEARINGS[i]);
    if (d < bestDist) { bestDist = d; bestArrow = ECLIPSE_DIST_ARROWS[i]; }
  }
  return bestDist === Infinity ? { distKm: null, arrow: null } : { distKm: bestDist, arrow: bestArrow };
}
function _eclipseUpdateDistanceToPath() {
  const row = document.getElementById('eclipseDistToPathRow');
  const showRow = eclipseSubView === 'visualization' && _eclipseActiveEvent && _eclipseActiveEvent.type === 'total';
  row.style.display = showRow ? 'flex' : 'none';
  if (!showRow) return;
  const lbl = document.getElementById('lblEclipseDistToPath');
  const heading = document.getElementById('eclipseDistToPathLabel');
  const { distKm, arrow } = _eclipseDistanceToPath();
  if (distKm === null) lbl.textContent = '—';
  else if (distKm === 0) lbl.textContent = '0 km ☉';
  else lbl.textContent = Math.round(distKm) + ' km ' + arrow;
  // Green instead of red once the path actually reaches this Location - same "good news" swap as
  // the row's own colour scheme, not just the number.
  const color = distKm === 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  lbl.style.color = color;
  heading.style.color = color;
}

// "FIND THE GREATEST POINT" (Visualization-only) - jumps LAT/hemisphere/LONG/lonHemisphere to the
// active event's own Greatest Eclipse point, through the normal applyLat/applyLong path (so
// clamping/hemisphere-button state/redraws all happen exactly as if the user had typed it in).
document.getElementById('btnEclipseGreatestPoint').addEventListener('click', () => {
  if (!_eclipseActiveEvent) return;
  const g = _eclipseActiveEvent.greatestEclipse;
  hemisphere = g.hemisphere; lonHemisphere = g.lonHemisphere;
  document.getElementById('btnN').className = g.hemisphere > 0 ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnS').className = g.hemisphere > 0 ? 'ns-btn' : 'ns-btn active-s';
  document.getElementById('btnE').className = g.lonHemisphere > 0 ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnW').className = g.lonHemisphere > 0 ? 'ns-btn' : 'ns-btn active-s';
  applyLat(g.lat);
  applyLong(g.lon);
});

// ── Photo gallery (Load/Hide gallery button) - Visualization-only, and only for an event that has
// one registered (window.ECLIPSE_GALLERY[event.id], fetched once from filelist_eclipse.json below
// - a plain JSON file, not a <script>, since it's just data). Calibrates Location to the photos'
// own shared shooting location, then marks each photo's own capture time on the slider as a small
// clickable triangle; clicking one both jumps the slider to that exact moment AND opens the photo
// in a modal (§ no prior modal existed in this project before this feature).
window.ECLIPSE_GALLERY = {};
async function _eclipseLoadGalleryData() {
  try {
    const res = await fetch('filelist_eclipse.json');
    window.ECLIPSE_GALLERY = await res.json();
  } catch (e) {
    console.warn('Error loading eclipse gallery data:', e);
  }
  // Covers the (unlikely on localhost, but possible on a slow connection) case where this fetch
  // resolves AFTER the user has already entered Visualization/Catalog - the "Load gallery" button
  // and the Catalog tiles' own gallery badges would otherwise stay stale until the next unrelated
  // re-render.
  if (typeof eclipseActive !== 'undefined' && eclipseActive) {
    if (eclipseSubView === 'visualization') _eclipseUpdateGalleryUI();
    else if (eclipseSubView === 'catalog') _eclipseRenderCatalogGrid();
  }
}
_eclipseLoadGalleryData();
// "18:08:20" -> 18.1389 (decimal hours) - the format filelist_eclipse.json stores times in.
function _eclipseParseTimeUtc(str) {
  const [h, m, s] = str.split(':').map(Number);
  return h + m / 60 + (s || 0) / 3600;
}

let _eclipseLoadedGallery = null;   // the gallery object currently shown as slider markers, or null
// Single source of truth for the button's label/visibility and the markers themselves - called
// from enterEclipseVisualization() (every entry/re-entry, including after applyLat/applyLong's own
// cascade) and from the fetch callback above, so it's never possible for the two to disagree.
function _eclipseUpdateGalleryUI() {
  const gallery = window.ECLIPSE_GALLERY && window.ECLIPSE_GALLERY[_eclipseActiveEvent.id];
  const btn = document.getElementById('btnEclipseLoadGallery');
  btn.style.display = gallery ? '' : 'none';
  // Switching events (via Catalog) makes `gallery` a different object (or undefined) than whatever
  // _eclipseLoadedGallery still points at - that mismatch is what naturally clears stale markers
  // here, rather than needing an explicit reset call on every path that changes _eclipseActiveEvent.
  if (_eclipseLoadedGallery && _eclipseLoadedGallery === gallery) {
    _eclipseRenderGalleryMarkers(_eclipseLoadedGallery);
    btn.textContent = 'Hide gallery';
    btn.classList.add('loaded');
  } else {
    _eclipseLoadedGallery = null;
    const markersWrap = document.getElementById('eclipseGalleryMarkers');
    markersWrap.innerHTML = '';
    markersWrap.style.display = 'none';
    btn.textContent = 'Load gallery';
    btn.classList.remove('loaded');
  }
}
document.getElementById('btnEclipseLoadGallery').addEventListener('click', () => {
  const gallery = window.ECLIPSE_GALLERY && window.ECLIPSE_GALLERY[_eclipseActiveEvent.id];
  if (!gallery) return;
  if (_eclipseLoadedGallery === gallery) {
    // Already showing - hide again, same toggle idiom as the DEC/DM format buttons. Location
    // itself is left wherever it ended up, same as "Find the greatest point" never reverts it.
    _eclipseLoadedGallery = null;
    _eclipseUpdateGalleryUI();
    return;
  }
  _eclipseLoadedGallery = gallery;   // _eclipseUpdateGalleryUI(), called via enterEclipseVisualization()
                                      // below, (re-)renders markers against the slider bounds
                                      // applyLat/applyLong are about to trigger
  hemisphere = gallery.lat >= 0 ? 1 : -1; lonHemisphere = gallery.lon >= 0 ? 1 : -1;
  document.getElementById('btnN').className = hemisphere > 0 ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnS').className = hemisphere > 0 ? 'ns-btn' : 'ns-btn active-s';
  document.getElementById('btnE').className = lonHemisphere > 0 ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnW').className = lonHemisphere > 0 ? 'ns-btn' : 'ns-btn active-s';
  applyLat(Math.abs(gallery.lat));
  applyLong(Math.abs(gallery.lon));
});
// Builds one marker per photo, positioned at that photo's own UTC capture time - same
// percent-of-[slider.min,slider.max] math the C1-C4 tick marks use (_eclipseBuildSliderFill), just
// against a real clock time instead of a computed contact time. `t` (Besselian hours since t0) is
// plain UTC-to-UTC subtraction - no time-zone shift needed, since both the photo's parsed time and
// t0UtcHours are already real UTC.
//
// Two photos taken close together in time land within a few px of each other on screen - clicking
// the correct one would be impossible once they visually overlap. Fixed by GROUPING markers within
// ECLIPSE_GALLERY_CLUSTER_PX of their neighbour (measured in real on-screen px, via the slider's
// own rendered width) into one `.eclipse-gallery-marker-group`: at rest every marker in a group
// sits exactly on top of the group's own centre (harmless for a singleton "group" of one), and
// only fans out sideways - via each marker's own `--spread-x` - while the GROUP is hovered
// (`.eclipse-gallery-marker-group:hover`, see css/style.css), so a lone marker never moves at all.
const ECLIPSE_GALLERY_CLUSTER_PX = 24;
function _eclipseRenderGalleryMarkers(gallery) {
  const wrap = document.getElementById('eclipseGalleryMarkers');
  const slider = document.getElementById('rngEclipseTime');
  const min = parseFloat(slider.min), max = parseFloat(slider.max);
  const span = Math.max(0.0001, max - min);
  const trackPx = Math.max(1, slider.getBoundingClientRect().width);
  wrap.innerHTML = '';

  const items = gallery.photos.map((photo) => {
    const t = _eclipseParseTimeUtc(photo.timeUtc) - _eclipseActiveEvent.t0UtcHours;
    const pct = Math.max(0, Math.min(100, (t - min) / span * 100));
    return { photo, t, pct };
  }).sort((a, b) => a.pct - b.pct);

  const clusterThresholdPct = ECLIPSE_GALLERY_CLUSTER_PX / trackPx * 100;
  const groups = [];
  items.forEach((item) => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && item.pct - lastGroup[lastGroup.length - 1].pct < clusterThresholdPct) {
      lastGroup.push(item);
    } else {
      groups.push([item]);
    }
  });

  groups.forEach((group) => {
    const centerPct = group.reduce((s, it) => s + it.pct, 0) / group.length;
    const groupEl = document.createElement('div');
    groupEl.className = 'eclipse-gallery-marker-group';
    groupEl.style.left = centerPct.toFixed(3) + '%';
    group.forEach((item, i) => {
      const spreadX = (i - (group.length - 1) / 2) * (ECLIPSE_GALLERY_CLUSTER_PX + 4);
      const btn = document.createElement('button');
      btn.className = 'eclipse-gallery-marker';
      btn.style.setProperty('--spread-x', spreadX.toFixed(1) + 'px');
      btn.title = item.photo.file.split('/').pop() + ' — ' + _eclipseFmtHM(item.t);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (eclipseAnimActive) _eclipseStopAnim();   // manual jump, same convention as scrubbing/other jump buttons
        slider.value = item.t;
        drawEclipse(item.t);
        _eclipseOpenGalleryModal(item.photo.file);
      });
      groupEl.appendChild(btn);
    });
    wrap.appendChild(groupEl);
  });
  wrap.style.display = items.length ? 'block' : 'none';
}
function _eclipseOpenGalleryModal(src) {
  document.getElementById('eclipseGalleryModalImg').src = src;
  document.getElementById('eclipseGalleryModal').classList.add('visible');
}
function _eclipseCloseGalleryModal() {
  document.getElementById('eclipseGalleryModal').classList.remove('visible');
  document.getElementById('eclipseGalleryModalImg').src = '';   // release the (possibly large) image once closed
}
document.getElementById('btnEclipseGalleryModalClose').addEventListener('click', _eclipseCloseGalleryModal);
document.getElementById('eclipseGalleryModal').addEventListener('click', (e) => {
  if (e.target.id === 'eclipseGalleryModal') _eclipseCloseGalleryModal();   // click on the backdrop itself, not the photo
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('eclipseGalleryModal').classList.contains('visible')) _eclipseCloseGalleryModal();
});

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
  _eclipseUpdateStartEndLabels(_eclipseCircumstances);   // also timezone-shifted (_eclipseFmtHM) - was missing here, so start/end stayed stale on a Time zone change
  drawEclipse(parseFloat(document.getElementById('rngEclipseTime').value));
}
// Play/loop animation - same setup as the Analyzer's day animation (startSunAnim/advanceSunAnim,
// render-3d.js): resumes from wherever the slider currently sits, sweeps to the end, holds there
// for a 2 s pause, then loops back to the start - just its own independent rAF loop (Eclipse has
// no other reason to keep one running, unlike render-3d.js's shared wave/theater loop) and its own,
// selectable rate (1x = real time, i.e. simulated seconds pass at the same rate as real ones) via
// the #eclipseSpeedBox chip - 300x (5 simulated minutes per real second) is the original, and still
// default, speed.
const ECLIPSE_ANIM_SPEED_TIERS = [1, 10, 60, 300];
let _eclipseAnimSpeedIdx = ECLIPSE_ANIM_SPEED_TIERS.length - 1;   // starts on 300x, the original default
function _eclipseAnimRateHps() {
  return ECLIPSE_ANIM_SPEED_TIERS[_eclipseAnimSpeedIdx] / 3600;   // hours of Besselian t per real second
}
function _eclipseUpdateSpeedBoxLabel() {
  const box = document.getElementById('eclipseSpeedBox');
  if (box) box.textContent = ECLIPSE_ANIM_SPEED_TIERS[_eclipseAnimSpeedIdx] + 'x';
}
// Cycles to the next speed tier (wrapping) - if the animation is currently running, re-bases the
// running loop's own offset/start-time from the CURRENT slider position first, so the visible motion
// continues smoothly from right where it was instead of jumping (same "resume from current position"
// math _eclipseStartAnim already uses when resuming after a manual Stop).
function _eclipseCycleAnimSpeed() {
  _eclipseAnimSpeedIdx = (_eclipseAnimSpeedIdx + 1) % ECLIPSE_ANIM_SPEED_TIERS.length;
  if (eclipseAnimActive) {
    // Re-express "where we are" as an offset under the NEW rate (computed after switching above),
    // so the visible motion continues from the current instant rather than jumping.
    const slider = document.getElementById('rngEclipseTime');
    const vis = _eclipseVisibleRange(_eclipseCircumstances);
    const newRate = _eclipseAnimRateHps();
    eclipseAnimOffset = Math.min(
      Math.max(0.001, vis.end - vis.start) / newRate,
      Math.max(0, (parseFloat(slider.value) - vis.start) / newRate)
    );
    eclipseAnimStart = null;   // re-captured on the next frame
  }
  _eclipseUpdateSpeedBoxLabel();
}
document.getElementById('eclipseSpeedBox').addEventListener('click', (e) => {
  e.stopPropagation();   // independent of #btnEclipsePlay's own click (play/stop toggle)
  _eclipseCycleAnimSpeed();
});
let eclipseAnimActive = false;
let eclipseAnimStart  = null;   // ms timestamp captured on the first frame after Play
let eclipseAnimOffset = 0;      // seconds into the cycle to resume from (Play continues from Stop)
let eclipseAnimRAF    = null;
// The very first Play after landing on a location always starts from the beginning of the visible
// window, ignoring wherever the slider happens to sit - the DEFAULT landing spot is often itself
// already at/near the end of that window (a location whose max falls right at sunset, §21.14), so
// "resume from current position" on that very first press would begin the loop already at the end,
// sitting through the 2s end-of-loop pause before anything visibly moves. Reset (to re-arm this)
// in enterEclipse() - every subsequent Play, after a Stop or a manual scrub, DOES resume from the
// current position as normal.
let eclipseAnimEverPlayed = false;
function _eclipseSetPlayIcon(playing) {
  const btn = document.getElementById('btnEclipsePlay');
  if (!btn) return;
  btn.classList.toggle('playing', playing);
  const ic = btn.querySelector('svg');
  if (ic) ic.innerHTML = playing
    ? '<rect x="2" y="2" width="8" height="8" rx="1"/>'                 // stop (square)
    : '<polygon points="2,1 11,6 2,11"/>';                              // play (triangle)
  const speedBox = document.getElementById('eclipseSpeedBox');
  if (speedBox) speedBox.style.display = playing ? 'block' : 'none';
  _eclipseUpdateSpeedBoxLabel();
}
// Swept range is the horizon-VISIBLE window (_eclipseVisibleRange), not the slider's own full
// min/max - looping through a stretch that's below the horizon the whole time (still manually
// scrubbable, just not part of the animated loop) wouldn't show anything moving on screen anyway.
function _eclipseAdvanceAnim(ts) {
  const slider = document.getElementById('rngEclipseTime');
  const vis = _eclipseVisibleRange(_eclipseCircumstances);
  const min = vis.start, max = vis.end;
  const spanH = Math.max(0.001, max - min);
  const rate = _eclipseAnimRateHps();
  const motion = spanH / rate;      // seconds to sweep the visible range
  if (eclipseAnimStart === null) eclipseAnimStart = ts;
  const elapsed = (ts - eclipseAnimStart) / 1000;    // seconds since Play
  const local = (eclipseAnimOffset + elapsed) % (motion + 2);   // +2 s pause before each new loop
  const t = local <= motion ? min + local * rate : max;   // hold at end during pause
  slider.value = t;
  drawEclipse(t);
}
function _eclipseAnimFrame(ts) {
  if (!eclipseAnimActive) { eclipseAnimRAF = null; return; }
  _eclipseAdvanceAnim(ts);
  eclipseAnimRAF = requestAnimationFrame(_eclipseAnimFrame);
}
function _eclipseStartAnim() {
  if (eclipseAnimActive || !eclipseActive || !_eclipseCircumstances || !_eclipseAnyVisible(_eclipseCircumstances)) return;
  eclipseAnimActive = true;
  eclipseAnimStart = null;             // captured on first frame
  const slider = document.getElementById('rngEclipseTime');
  const vis = _eclipseVisibleRange(_eclipseCircumstances);
  const motion = Math.max(0.001, vis.end - vis.start) / _eclipseAnimRateHps();
  if (!eclipseAnimEverPlayed) {
    // First Play ever for this location: always the beginning, see the flag's own comment above.
    eclipseAnimEverPlayed = true;
    eclipseAnimOffset = 0;
    slider.value = vis.start;
    drawEclipse(vis.start);
  } else {
    // Resume from the current slider position, not always the start - clamped into the visible
    // window in case the slider currently sits outside it (a below-horizon stretch was manually
    // scrubbed to before Play was pressed).
    eclipseAnimOffset = Math.min(motion, Math.max(0, (parseFloat(slider.value) - vis.start) / _eclipseAnimRateHps()));
  }
  _eclipseSetPlayIcon(true);
  if (eclipseAnimRAF === null) eclipseAnimRAF = requestAnimationFrame(_eclipseAnimFrame);
}
function _eclipseStopAnim() {
  eclipseAnimActive = false;
  _eclipseSetPlayIcon(false);
  if (eclipseAnimRAF !== null) { cancelAnimationFrame(eclipseAnimRAF); eclipseAnimRAF = null; }
}
document.getElementById('btnEclipsePlay').addEventListener('click', () => {
  if (eclipseAnimActive) _eclipseStopAnim(); else _eclipseStartAnim();
});
document.getElementById('rngEclipseTime').addEventListener('input', (e) => {
  if (eclipseAnimActive) _eclipseStopAnim();   // manual scrub stops the loop, same as the Analyzer's Time slider
  drawEclipse(parseFloat(e.target.value));
});
document.getElementById('btnEclipseMaxPhase').addEventListener('click', () => {
  if (!_eclipseCircumstances) return;
  if (eclipseAnimActive) _eclipseStopAnim();   // a manual jump, same as scrubbing
  const slider = document.getElementById('rngEclipseTime');
  slider.value = _eclipseCircumstances.defaultT;
  drawEclipse(_eclipseCircumstances.defaultT);
});
// Display checkboxes (grid/labels/equatorial/horizon) are read directly off the DOM by drawEclipse()
// itself (see chkGrid/chkLabels/... near the top of that function) - live for BOTH sub-views, since
// the Catalog tiles are real drawEclipse() renders too, not a separate preview renderer. So a change
// here needs to refresh whichever sub-view is actually on screen, not just Visualization's canvas.
function _eclipseRefreshCurrentView() {
  if (eclipseSubView === 'visualization') drawEclipse(parseFloat(document.getElementById('rngEclipseTime').value));
  else _eclipseRenderCatalogGrid();
}
document.getElementById('chkEclipseGrid').addEventListener('change', _eclipseRefreshCurrentView);
document.getElementById('chkEclipseLabels').addEventListener('change', _eclipseRefreshCurrentView);
document.getElementById('chkEclipseEquatorial').addEventListener('change', _eclipseRefreshCurrentView);
document.getElementById('chkEclipseHorizon').addEventListener('change', _eclipseRefreshCurrentView);
document.getElementById('chkEclipseCorona').addEventListener('change', _eclipseRefreshCurrentView);
window.addEventListener('resize', () => { if (eclipseActive && eclipseSubView === 'visualization') resizeEclipse(); });

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
