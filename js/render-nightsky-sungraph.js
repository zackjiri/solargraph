// ─── Night Sky: Sun Graph (third Visualization sub-mode, next to Sky Map and Planetarium) ───────
// The Analyzer's Sun Graph chart (_sgDraw, render-sungraph.js) drawn from a Night Sky source: the
// real calendar year of the selected local date, the Sun events of each date (core.js
// solarEventsOnDate, the same computation as the Visualization's info panel), and standard clock
// time at the Time zone offset all year (no summer time). Sunlight-on-paper and CHMI are Solargraph
// layers and are not drawn. Added here: the Moon's hours above the horizon per local day, shaded by
// its illuminated fraction. The chart shares #sunGraphCanvas and #sgLegendWrap with the Analyzer's
// Sun Graph (never on screen at the same time); the info panel is Night Sky's own.

let _nsSgHoverDay = null;

// Days of a calendar year: d = 1..365/366 <-> {year, month, day}.
function _nsSgYearDays(year) {
  return _nightSkyDaysInMonth(year, 2) === 29 ? 366 : 365;
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
  let acc = 1;
  for (let m = 1; m <= 12; m++) { starts.push(acc); acc += _nightSkyDaysInMonth(year, m); }
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
// Light yellow, the Moon's own disc colour; denser the fuller it is, and stronger when the Sun is
// off (strong) and its bands fade back.
function _nsSgMoonFill(k, emph, strong) {
  const a = strong ? (emph ? 0.40 : 0.15) + 0.70 * k : (emph ? 0.25 : 0.06) + 0.45 * k;
  return 'rgba(244,234,184,' + Math.min(1, a).toFixed(3) + ')';
}

// The Sun and the Moon at the selected instant, drawn as in the Planetarium at its minimum size
// (_nightSkyBodyMinR, no zoom). The two share the point (the Y axis is the time), so with both on
// only one disc shows, chosen by the horizon (the Planetarium's rule, _nightSkyDiscAboveHorizon):
//   Sun up,   Moon up    -> the Moon, with the Sun's glow around it
//   Sun up,   Moon down  -> the Sun
//   Sun down             -> the Moon (greyed when it is down too)
// A single body on its own is greyed when it is below the horizon. The Moon is turned as the
// observer sees it in the sky - its lit side towards the Sun and, at a lunar eclipse, Earth's
// shadow on it - from a small projection of the sky around the Moon (right = growing azimuth,
// up = towards the zenith).
const NS_SG_BELOW_HORIZON_GREY = 'rgba(120,120,120,0.6)';
function _nsSgDrawBodies(ctx, x, y, sunOn, moonOn) {
  const r = _nightSkyBodyMinR();
  const Y = nightSkyYear, M = nightSkyMonth, D = nightSkyDay, H = nightSkyHourUT;
  const sun = _nightSkySunAzEl(Y, M, D, H), moon = _moonAzEl(Y, M, D, H);
  const sunUp = _nightSkyDiscAboveHorizon(sun.el, _skySunSemiDiamDeg(Y, M, D, H));
  const moonUp = _nightSkyDiscAboveHorizon(moon.el, _moonSemiDiamDeg(moon));
  let drawSun = sunOn, drawMoon = moonOn, glow = sunOn && sunUp;
  if (sunOn && moonOn) {
    if (sunUp && !moonUp) drawMoon = false;
    else drawSun = false;   // the Moon shows; the glow stays only by day
  }
  const grey = () => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = NS_SG_BELOW_HORIZON_GREY; ctx.fill();
  };
  if (glow) {
    const glR = r * NIGHTSKY_SUN_GLOW_RATIO;
    const g = ctx.createRadialGradient(x, y, 0, x, y, glR);
    g.addColorStop(0, 'rgba(232,160,32,0.60)'); g.addColorStop(1, 'rgba(232,160,32,0)');
    ctx.fillStyle = g; ctx.fillRect(x - glR, y - glR, glR * 2, glR * 2);
  }
  if (drawSun) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8a020'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    if (!sunUp) grey();
  }
  if (drawMoon) {
    const m = _skyDomeUnitVec(moon.az, moon.el), a = moon.az * _MOON_D2R;
    const right = [Math.cos(a), -Math.sin(a), 0];
    let up = [-m[2] * m[0], -m[2] * m[1], 1 - m[2] * m[2]];
    const ul = Math.hypot(up[0], up[1], up[2]) || 1;
    up = up.map(v => v / ul);
    const project = (az, el) => {
      const p = _skyDomeUnitVec(az, el), d = _sd3Dot(p, m);
      if (d <= 0) return null;
      return { x: x + 1000 * _sd3Dot(p, right) / d, y: y - 1000 * _sd3Dot(p, up) / d };
    };
    const k = _moonPhase(_moonJDE(Y, M, D, H)).k;
    _moonDrawDisc(ctx, x, y, r, k, _moonBrightLimbAngle(moon, sun, project), _moonShadowOnDisc(moon, r, project));
    if (!moonUp) grey();
  }
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
  const moonDays = moonOn ? _nsSgMoonDays(year) : null;
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
    showCustom: document.getElementById('chkNightSkyCustomDate').checked,
    hoverDay: _nsSgHoverDay,
    // The marker sits at the selected instant: its clock hour taken back to true solar time, which
    // disp() then maps onto the axis again.
    sunMarker: null,   // drawn by drawMarkers, as in the Planetarium
    dimBands: moonOnly,
    stripBands: !moonOnly,
    drawMarkers: (sunOn || moonOn) ? (ctx, g) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(g.px0, g.py0, g.pw, g.ph); ctx.clip();
      _nsSgDrawBodies(ctx, g.dayCenter(today), g.hourToY(L.hour), sunOn, moonOn);
      ctx.restore();
    } : null,
    dayLabel,
    showLabels: document.getElementById('chkNightSkyNames').checked,
    // The time strip (#nightSkyTimeWrap) sits over the bottom-left corner: keep the chart above it.
    bottomPad: document.getElementById('nightSkyTimeWrap').offsetHeight + 8,
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
      }
      ctx.restore();
    } : null,
    drawStripExtra: (ctx, g) => {
      if (moonDays) {
        const emph = _sgEmphBand === 'moon';
        for (const iv of _nsSgMoonSolarDay(year, g.activeDay)) {
          ctx.fillStyle = _nsSgMoonFill(iv[2], emph, moonOnly);
          ctx.fillRect(g.xh(iv[0]), g.laneY, g.xh(iv[1]) - g.xh(iv[0]), g.recapH);
        }
      }
      // The selected instant on the strip (true solar time), when the strip shows the selected day.
      const tSun = L.hour - clock(0, today);
      if ((sunOn || moonOn) && g.activeDay === today && tSun >= 0 && tSun <= 24) {
        const x = g.xh(tSun);
        ctx.strokeStyle = sunOn ? '#e8a020' : '#f4eab8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, g.laneY); ctx.lineTo(x, g.laneY + g.recapH); ctx.stroke();
      }
    },
    afterDraw: (activeDay) => {
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
// Moon, the info panel moves below the sub-mode wheel on the right (the plot starts top-left) and
// the time strip loses Play (a running animation stops). The top readout keeps Day and Time: the
// date and clock time under the cursor in the plot, otherwise the selected ones (_nsSgReadout);
// Az/Alt/Dir stay empty.
function enterNightSkySunGraph() {
  if (typeof _nightSkyAnimActive !== 'undefined' && _nightSkyAnimActive) _nightSkyStopAnim();
  _nsSgHoverDay = null;
  document.getElementById('nightSkyCanvas').style.display = 'none';
  document.getElementById('nightSkyFrameThumb').style.display = 'none';
  document.getElementById('sunGraphCanvas').style.display = 'block';
  document.getElementById('sgLegendWrap').style.display = 'flex';
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
// date and time when p is null.
function _nsSgReadout(p) {
  if (!p) { _nightSkyUpdateReadout(); return; }
  const c = _nsSgDate(_nightSkyLocalDate().year, p.d);
  const t = Math.floor(p.hour * 60);
  document.getElementById('valDay').textContent = MONTHS[c.month - 1] + ' ' + c.day + ', ' + c.year;
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
    _nightSkySetLocal(c.year, c.month, c.day, p.hour);
    _nightSkySyncControls();
    _nsSgReadout(p);   // the cursor is still on that point
  });
  cv.addEventListener('mousemove', (e) => {
    const src = _sgActiveSrc;
    if (!_nsSgActive() || !src || !src.layout || src.isActive !== _nsSgActive) return;
    _nsSgReadout(_nsSgPointAt(src, e.clientX, e.clientY));
  });
  cv.addEventListener('mouseleave', () => { if (_nsSgActive()) _nsSgReadout(null); });
  const container = document.getElementById('canvasContainer');
  if (container && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (_nsSgActive()) { _sgFitCanvas(); _nsSgDraw(); } }).observe(container);
    // Collapsing/expanding the time strip changes the room it takes.
    new ResizeObserver(() => { if (_nsSgActive()) _nsSgDraw(); }).observe(document.getElementById('nightSkyTimeWrap'));
  }
})();
document.getElementById('chkNightSkyCustomDate').addEventListener('change', () => { if (_nsSgActive()) _nsSgDraw(); });
