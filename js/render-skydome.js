// ─── Sky Dome view ────────────────────────────────────────────────────────────
// Azimuth/elevation sun-path diagram (à la SunEarthTools.com), in two alternate projections that
// share the same underlying data and the same info-bar readout:
//   Dome   - polar: zenith (elevation 90°) at the centre, horizon (elevation 0°) at the rim,
//            azimuth as the compass angle around it.
//   Matrix - flat: azimuth 0°-360° left-to-right, elevation 0°-90° bottom-to-top (a plain XY chart).
// Both are a fixed geographic compass view - true north is always at az=0 (Dome: fixed at the
// top; Matrix: see the shift note on _skyDomeMatrixPoint), independent of the calibration's
// YAW/PITCH/ROLL (those describe how the physical pinhole can was oriented, not a property of the
// sky itself). Switched via the top-right "DOME/MATRIX" pill (see updateSkyDomeProjSwitch());
// everything below (sun-path data, cursor readout) is projection-agnostic and goes through
// _skyDomeProject()/_skyDomePixelToAzEl() to reach either one.
//
// Because this is a *true*-compass view (not the flat scan's own hemisphere-agnostic pixel
// convention - see core.js's drawSunArc), all sun-position math here uses signed latitude
// (effectiveLat() * hemisphere) and unsigned hour angle, so the culmination side and the day's
// rotation sense come out on the correct side of the compass for either hemisphere automatically
// - see _skyDomeArcPoints/_skyDomeHourDots. inverseSolar() is the one exception: it has its own
// bespoke "culmination is always 180°" + unsigned-latitude convention, so its azimuth argument is
// converted first - see handleSkyDomeMouseMove().
//
// Handedness: Dome is deliberately mirrored left-right from a bird's-eye ground map (see
// _skyDomePoint) to match what an observer lying on the ground looking up at the zenith actually
// sees - the standard star-chart/planisphere convention. Matrix is NOT mirrored - it already
// reads left-to-right in increasing azimuth to match the SunEarthTools-style reference chart it
// was built from (which happens to put east on the left for the northern hemisphere too, just via
// a plain left-to-right numeric axis rather than a deliberate "view from inside the sphere" flip).
// The two projections' east/west placement is therefore not driven by the same reasoning even
// where it happens to agree - don't "fix" one by copying the other's formula.
//
// Sub-mode of Analyzer, sibling to 3D Model / Sun Graph (mutually exclusive canvas takeovers -
// see enterSkyDome()/exitSkyDome() and their counterparts in render-3d.js/render-sungraph.js).

let skyDomeActive = false;
let skyDomeProjection = 'dome';   // 'dome' | 'matrix' - toggled by the top-right switch
let _skyDomeLayout = null;        // {mode, ...} - see _skyDomeProject/_skyDomePixelToAzEl

function enterSkyDome() {
  // All three canvas takeovers (3D Model, Sun Graph, Sky Dome) are mutually exclusive.
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D && typeof exitTheater3D === 'function') exitTheater3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive && typeof exitSunGraph === 'function') exitSunGraph();

  const container  = document.getElementById('canvasContainer');
  const uploadZone = document.getElementById('uploadZone');
  // The dome is independent of any loaded scan → reveal the canvas area, hide upload zone
  // (mirrors enterSunGraph/enterTheater3D).
  container.classList.remove('hidden');
  if (uploadZone) uploadZone.classList.add('hidden');

  document.getElementById('skyDomeCanvas').style.display = 'block';
  document.getElementById('skyDomeProjRow').style.display = 'flex';
  document.getElementById('mainCanvas').style.pointerEvents = 'none';
  document.getElementById('statusWrap').style.display = 'none';
  // Display off except Labels + Custom date - same two the Sun Graph keeps live, since the sun
  // paths layered on here later will use the same custom-date state.
  setDisplaySectionEnabled(false, ['chkLabels', 'chkCustomArc']);

  skyDomeActive = true;
  if (typeof updateViewButtons === 'function') updateViewButtons();
  resizeSkyDome();
}

function exitSkyDome() {
  document.getElementById('skyDomeCanvas').style.display = 'none';
  document.getElementById('skyDomeProjRow').style.display = 'none';
  document.getElementById('mainCanvas').style.pointerEvents = '';
  skyDomeActive = false;
  _skyDomeHoverAz = null; _skyDomeHoverEl = null;   // don't leave a stale readout for the next view
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

function resizeSkyDome() {
  if (!skyDomeActive) return;
  const container = document.getElementById('canvasContainer');
  const cv = document.getElementById('skyDomeCanvas');
  const RES = Math.max(2, Math.ceil(window.devicePixelRatio || 1));   // crisp on HiDPI (see 25_1)
  const cw = container.clientWidth, ch = container.clientHeight;
  cv._res = RES;
  cv.width  = Math.round(cw * RES);
  cv.height = Math.round(ch * RES);
  cv.style.width  = cw + 'px';
  cv.style.height = ch + 'px';
  drawSkyDome();
}

// ── Projection dispatch (Dome = polar, Matrix = flat azimuth/elevation chart) ─────────────────
// Elevation → radius (linear: 90° at centre, 0° at rim) and (az, el) → canvas point, sharing one
// origin/scale for the whole draw pass. az is world-standard (0=N, 90=E, 180=S, 270=W); N is
// fixed at the top, but the x-axis is mirrored (x = cx0 - r·sin(az), not +) so the dome reads as
// an observer lying on the ground looking straight up at the zenith would actually see it, not as
// a cartographer's bird's-eye view of the ground looking down. For the classic example: lying
// down with feet to the south (head to the north) under a northern-hemisphere sky, east is over
// your LEFT shoulder and west over your right - the standard star-chart/planisphere convention,
// mirrored left-right from an ordinary ground map for the same reason a planisphere is always
// mirrored relative to a terrestrial map (you're viewing the same fixed compass rose from the
// inside of the sphere looking out, instead of from outside looking in).
function _skyDomePoint(cx0, cy0, R, az, el) {
  const r = R * (90 - el) / 90;
  const a = az * Math.PI / 180;
  return { x: cx0 - r * Math.sin(a), y: cy0 - r * Math.cos(a) };
}

// Matrix: plain XY chart - azimuth 0..360° left-to-right, elevation 0..90° bottom-to-top.
// The chart is deliberately kept "culmination-centred" regardless of hemisphere: true north sits
// at az=0/360 (the two edges) for the northern hemisphere, but at az=180 (the true south) for the
// southern hemisphere the sun's culmination is at *true* az=0 (north) - plotting raw true azimuth
// straight across a 0-360 axis would then put the daily arc's peak at the edges and split it into
// two pieces there. Instead we shift by 180° for the southern hemisphere so the culmination side
// always lands at the centre and the chart keeps the same one-piece "hump" shape either way - see
// drawSkyDomeMatrixAxes(), which relabels the axis (numbers + E/S/W) to match this shift instead
// of moving the gridlines.
function _skyDomeMatrixAzShift() { return hemisphere >= 0 ? 0 : 180; }

function _skyDomeMatrixPoint(x0, y0, plotW, plotH, az, el) {
  const azS = (az + _skyDomeMatrixAzShift() + 360) % 360;
  return { x: x0 + (azS / 360) * plotW, y: y0 + plotH * (1 - el / 90) };
}

function _skyDomeProject(layout, az, el) {
  return layout.mode === 'matrix'
    ? _skyDomeMatrixPoint(layout.x0, layout.y0, layout.plotW, layout.plotH, az, el)
    : _skyDomePoint(layout.cx, layout.cy, layout.R, az, el);
}

// ── Cursor readout (shared Az/Alt/Day/Time/Dir bar, #readout in index.html) ──────────────────
// Recalibrated for each projection's own geometry: unlike the flat scan's pixelToAzEl (which
// inverts the pinhole/cylinder projection and depends on yaw/pitch/roll/scale), a Dome or Matrix
// pixel maps to az/el with plain arithmetic and no calibration at all - and, being a real compass
// view (see file header), no southern-hemisphere display shift either: neither projection's own
// axis labels (N/S/E/W) are shifted, so the readout shouldn't be either.
let _skyDomeHoverAz = null, _skyDomeHoverEl = null;   // world az/el under the cursor, or null

// Inverse of _skyDomeProject: canvas pixel → {az, el}, or null outside the plotted area (below
// horizon in Dome, outside the axes box in Matrix). az is null exactly at the Dome's centre
// (zenith), where azimuth is undefined - Matrix has no such ambiguity.
function _skyDomePixelToAzEl(px, py) {
  if (!_skyDomeLayout) return null;
  const L = _skyDomeLayout;
  if (L.mode === 'matrix') {
    if (px < L.x0 || px > L.x0 + L.plotW || py < L.y0 || py > L.y0 + L.plotH) return null;
    const azS = ((px - L.x0) / L.plotW) * 360;
    const az = (azS - _skyDomeMatrixAzShift() + 360) % 360;   // undo the culmination-centring shift
    const el = (1 - (py - L.y0) / L.plotH) * 90;
    return { az, el };
  }
  const dx = px - L.cx, dy = py - L.cy;
  const r = Math.hypot(dx, dy);
  if (r > L.R) return null;
  const el = 90 - 90 * r / L.R;
  // Inverse of _skyDomePoint's mirrored x (dx = -r·sin(az)) - atan2(-dx, -dy), not atan2(dx, -dy),
  // so the readout reports the true azimuth of wherever the mirrored dome is actually drawing it.
  const az = r < 0.5 ? null : ((Math.atan2(-dx, -dy) * 180 / Math.PI) + 360) % 360;
  return { az, el };
}

function _skyDomeClearReadout() {
  document.getElementById('valAz').textContent   = '—';
  document.getElementById('valAlt').textContent  = '—';
  document.getElementById('valDay').textContent  = '—';
  document.getElementById('valTime').textContent = '—';
  document.getElementById('valDir').textContent  = '—';
}

function handleSkyDomeMouseMove(e) {
  const container = document.getElementById('canvasContainer');
  const rect = container.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const hit = _skyDomePixelToAzEl(px, py);

  if (!hit) {
    container.style.cursor = 'default';
    if (_skyDomeHoverEl !== null) {
      _skyDomeHoverAz = null; _skyDomeHoverEl = null;
      _skyDomeClearReadout();
      drawSkyDome();
    }
    return;
  }
  container.style.cursor = 'none';
  _skyDomeHoverAz = hit.az; _skyDomeHoverEl = hit.el;

  // inverseSolar() expects its azimuth in the app-wide "culmination-relative" convention (south
  // is always 180°, regardless of hemisphere - see core.js) paired with unsigned latitude; it
  // applies its own internal hemisphere corrections (H sign, day-of-year shift) from there. Our
  // az is a *true* compass bearing (0=true north always), so convert before calling it - true
  // culmination is at true-az 0 for the southern hemisphere, which must map to 180 in that frame.
  const azForSolar = hit.az !== null ? (hemisphere >= 0 ? hit.az : (hit.az + 180) % 360) : null;
  const sol = azForSolar !== null ? inverseSolar(azForSolar, hit.el, effectiveLat()) : null;
  document.getElementById('valAz').textContent   = hit.az !== null ? hit.az.toFixed(1) + '°' : '—';
  document.getElementById('valAlt').textContent  = '+' + hit.el.toFixed(1) + '°';
  document.getElementById('valDay').textContent  = sol ? sol.day1 + ' / ' + sol.day2 : '—';
  document.getElementById('valTime').textContent = sol ? sol.time : '—';
  document.getElementById('valDir').textContent  = hit.az !== null ? azimutToDir(hit.az) : '—';

  drawSkyDome();
}

function handleSkyDomeMouseLeave() {
  _skyDomeHoverAz = null; _skyDomeHoverEl = null;
  _skyDomeClearReadout();
  if (skyDomeActive) drawSkyDome();
}

// ── Sun-path curves ────────────────────────────────────────────────────────────
// Mirrors the main canvas's "Sun's paths" / "Custom date" overlays (drawAllSunArcs / drawSunArc
// in core.js), reusing the same sunPosition()/sunDeclination() math, but projected straight
// through the compass-fixed Dome/Matrix via _skyDomeProject(layout, az, el) - no "- yawDeg"
// correction, since this view deliberately ignores calibration (see file header). Same curve set
// as the main canvas (4 thin intermediate months + both solstices + equinox, with hour dots on
// the equinox curve), plus the green Custom Path date with its south-transit label and animated
// sun marker - identical in both projections, just re-projected.
function _skyDomeArcPoints(layout, month, day) {
  const delta = sunDeclination(dayOfYear(month, day));
  // Signed latitude - this is a true-compass calculation (see file header), unlike the flat
  // scan's own sun-arc drawing (core.js's drawSunArc), which stays hemisphere-agnostic by using
  // unsigned latitude paired with a "culmination is always at the image centre" pixel convention.
  // Here there's no such convention to lean on: true south is always down and true north is
  // always up, so the sign has to come from the real latitude for the culmination side (and the
  // whole day's rotation sense) to land on the correct side of the compass.
  const phi = effectiveLat() * hemisphere;
  const pts = [];
  let prevAz = null;
  for (let hDeg = -180; hDeg <= 180; hDeg += 0.5) {
    const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
    if (s.el < 0) { prevAz = null; continue; }
    // Azimuth can in principle wrap through 0°/360° (e.g. a midnight-sun latitude, where the path
    // crosses due north while still above the horizon) - break the polyline there instead of
    // drawing a spurious line straight across the Matrix chart (harmless in Dome, which has no
    // seam). Never fires for an ordinary sunrise-to-sunset day (azimuth only crosses due north, if
    // at all, exactly at the ±180h array boundary - see project notes).
    if (prevAz !== null && Math.abs(s.az - prevAz) > 180) pts.push(null);
    prevAz = s.az;
    pts.push(_skyDomeProject(layout, s.az, s.el));
  }
  return pts;
}

// pts may contain null entries marking a break in the polyline (see _skyDomeArcPoints above).
function _skyDomeStrokeArc(ctx, pts, color, lineWidth) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.setLineDash([]);
  ctx.beginPath();
  let first = true;
  for (const p of pts) {
    if (!p) { first = true; continue; }
    if (first) { ctx.moveTo(p.x, p.y); first = false; } else { ctx.lineTo(p.x, p.y); }
  }
  ctx.stroke();
}

// Hour dots (15° = 1h steps) along one date's curve, with optional "H:MM" solar-time labels
// (display-mode aware, same as the main canvas's equinox curve). Label side follows morning/
// afternoon (hDeg sign) rather than screen position, so it reads the same in both projections.
function _skyDomeHourDots(ctx, layout, month, day, color, withLabels) {
  const doy   = dayOfYear(month, day);
  const delta = sunDeclination(doy);
  const phi   = effectiveLat() * hemisphere;   // true-compass calculation - see _skyDomeArcPoints
  for (let hDeg = -180; hDeg <= 180; hDeg += 15) {
    const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
    if (s.el < 0) continue;
    const p = _skyDomeProject(layout, s.az, s.el);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
    if (withLabels) {
      // Hour angle → clock hour is a universal relationship (H=0 is always noon, H grows linearly
      // with elapsed time) - no hemisphere mirroring needed here, unlike the flat scan's equinox
      // curve (core.js's drawAllSunArcs), which mirrors hDeg to compensate for its own southern-
      // hemisphere image convention (not applicable to this true-compass view).
      const trueHour  = 12 + hDeg / 15;
      const shownHour = displayHour(trueHour, doy);
      const hh = Math.floor(shownHour), mm = Math.round((shownHour - hh) * 60);
      const label = hh + ':' + String(mm).padStart(2, '0');
      ctx.font = "bold 10px 'Share Tech Mono'";
      ctx.fillStyle = color.replace(/rgba\(([^,]+,[^,]+,[^,]+),[^)]+\)/, 'rgba($1,1)');
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2.5;
      ctx.textAlign = hDeg < 0 ? 'right' : 'left';
      const ox = hDeg < 0 ? -7 : 7;
      ctx.strokeText(label, p.x + ox, p.y - 4);
      ctx.fillText(label, p.x + ox, p.y - 4);
    }
  }
}

function drawSkyDomeSunPaths(ctx, layout) {
  const op = dispOpacity;

  if (typeof showSunArc === 'undefined' || showSunArc) {
    const thinCol = `rgba(255, 220, 60, ${Math.min(1, op * 0.40)})`;
    [[1, 21], [2, 21], [4, 21], [5, 21]].forEach(([m, d]) => {
      _skyDomeStrokeArc(ctx, _skyDomeArcPoints(layout, m, d), thinCol, 0.8);
    });

    const winterMonth = hemisphere >= 0 ? 12 : 6;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(layout, winterMonth, 21),
      `rgba(60, 180, 255, ${Math.min(1, op * 0.85)})`, 1.5);

    const equinoxCol = `rgba(255, 220, 60, ${Math.min(1, op * 0.85)})`;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(layout, 3, 21), equinoxCol, 1.5);
    if (typeof showLabels === 'undefined' || showLabels) {
      _skyDomeHourDots(ctx, layout, 3, 21, equinoxCol, true);
    }

    const summerMonth = hemisphere >= 0 ? 6 : 12;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(layout, summerMonth, 21),
      `rgba(255, 100, 60, ${Math.min(1, op * 0.85)})`, 1.5);
  }

  if (typeof showCustomArc === 'undefined' || showCustomArc) {
    // The *real* calendar date, unlike the flat scan's customArcDate() (which shifts the date by
    // 182 days for the southern hemisphere specifically to compensate for that view's unsigned-
    // latitude convention - see core.js). Paired with signed latitude below, the real date already
    // gives the correct true-compass path with no shifting needed.
    const cm = customMonth, cd = customDay;
    const pts = _skyDomeArcPoints(layout, cm, cd);
    _skyDomeStrokeArc(ctx, pts, `rgba(0,0,0,${Math.min(1, op * 0.85)})`, 3.5);
    _skyDomeStrokeArc(ctx, pts, `rgba(80, 220, 120, ${Math.min(1, op * 0.9)})`, 1.5);

    const delta = sunDeclination(dayOfYear(cm, cd));
    const phi   = effectiveLat() * hemisphere;   // true-compass calculation - see _skyDomeArcPoints

    // Label at the culmination point (H=0 is always solar noon/transit, wherever that compass
    // direction actually is - true south for the northern hemisphere, true north for the southern).
    const culmination = sunPosition(0, delta, phi);
    if (culmination.el > 0 && (typeof showLabels === 'undefined' || showLabels)) {
      const sp = _skyDomeProject(layout, culmination.az, culmination.el);
      const dateLabel = MONTH_NAMES[customMonth - 1] + ' ' + customDay;
      ctx.font = "10px 'Share Tech Mono'";
      ctx.fillStyle = 'rgba(80, 220, 120, 1)';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2.5;
      ctx.textAlign = 'left';
      ctx.strokeText(dateLabel, sp.x + 8, sp.y - 6);
      ctx.fillText(dateLabel, sp.x + 8, sp.y - 6);
    }

    // Animated sun marker at the current solar time, matching the theater/2D styling. hDeg is
    // unsigned - hour angle → clock hour is universal (see _skyDomeHourDots), unlike the flat
    // scan/theater's own sunTimeHours→hDeg conversion, which mirrors by hemisphere for its own
    // pixel convention (render-3d.js's surfMap/hitH).
    if (typeof show3DCulmination === 'undefined' || show3DCulmination) {
      const hDeg = (sunTimeHours - 12) * 15;
      const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
      if (s.el >= 0) {
        const sp = _skyDomeProject(layout, s.az, s.el);
        const glR = 14;
        const glow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, glR);
        glow.addColorStop(0, 'rgba(232,160,32,0.60)'); glow.addColorStop(1, 'rgba(232,160,32,0)');
        ctx.fillStyle = glow; ctx.fillRect(sp.x - glR, sp.y - glR, glR * 2, glR * 2);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#e8a020'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
}

// ── Dome axes (polar) ──────────────────────────────────────────────────────────────────────────
function drawSkyDomePolarAxes(ctx, W, H, pal) {
  const mTop = 40, mSide = 34, mBottom = 26;
  const availW = W - 2 * mSide, availH = H - mTop - mBottom;
  const R = Math.max(10, Math.min(availW, availH) / 2);
  const cx0 = W / 2;
  const cy0 = mTop + availH / 2;
  const layout = { mode: 'dome', cx: cx0, cy: cy0, R };
  const pt = (az, el) => _skyDomePoint(cx0, cy0, R, az, el);

  // Dome background disc.
  ctx.beginPath(); ctx.arc(cx0, cy0, R, 0, Math.PI * 2);
  ctx.fillStyle = pal.plot; ctx.fill();

  // ── Azimuth radials (every 10°, cardinals bold, every 30° medium, rest fine dashed) ──────────
  for (let az = 0; az < 360; az += 10) {
    const isCardinal = (az % 90 === 0);
    const is30 = (az % 30 === 0);
    const p1 = pt(az, 0);
    ctx.beginPath();
    ctx.moveTo(cx0, cy0);
    ctx.lineTo(p1.x, p1.y);
    if (isCardinal) {
      ctx.strokeStyle = az === 0 ? pal.north : pal.rim;
      ctx.lineWidth = 1.5; ctx.setLineDash([]);
    } else if (is30) {
      ctx.strokeStyle = pal.az30; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    } else {
      ctx.strokeStyle = pal.az10; ctx.lineWidth = 0.8; ctx.setLineDash([2, 4]);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Elevation rings (every 10°; 0° = horizon = rim, drawn solid+bold) ─────────────────────────
  for (let el = 0; el <= 90; el += 10) {
    const r = R * (90 - el) / 90;
    if (r <= 0) continue;
    ctx.beginPath(); ctx.arc(cx0, cy0, r, 0, Math.PI * 2);
    if (el === 0) { ctx.strokeStyle = pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else { ctx.strokeStyle = pal.ring; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Azimuth labels just outside the rim: cardinals as letters, others as "10°" every 10° ─────
  const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 10) {
    const p = _skyDomePoint(cx0, cy0, R + 14, az, 0);
    const isCardinal = az in CARD;
    ctx.font = isCardinal ? "bold 13px 'Share Tech Mono', monospace" : "10px 'Share Tech Mono', monospace";
    ctx.fillStyle = isCardinal ? (az === 0 ? pal.north : pal.text) : pal.text;
    ctx.fillText(isCardinal ? CARD[az] : String(az), p.x, p.y);
  }

  // ── Elevation labels along the north radius, offset slightly right of the line ────────────────
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = pal.text;
  for (let el = 10; el <= 90; el += 10) {
    const r = R * (90 - el) / 90;
    ctx.fillText(el + '°', cx0 + 5, cy0 - r);
  }

  return layout;
}

// ── Matrix axes (flat azimuth/elevation chart, à la SunEarthTools.com) ───────────────────────────
// Gridline *positions* are always the same 0/20/…/360 evenly-spaced columns regardless of
// hemisphere (see _skyDomeMatrixPoint for why) - only the printed numbers and the E/S/W letters
// move, via trueAzAt(), to keep telling the truth about which compass direction is where.
function drawSkyDomeMatrixAxes(ctx, W, H, pal) {
  const mLeft = 42, mRight = 16, mTop = 40, mBottom = 40;
  const plotW = Math.max(10, W - mLeft - mRight);
  const plotH = Math.max(10, H - mTop - mBottom);
  const x0 = mLeft, y0 = mTop;
  const layout = { mode: 'matrix', x0, y0, plotW, plotH };
  const azShift = _skyDomeMatrixAzShift();
  const px = (azShifted) => x0 + (azShifted / 360) * plotW;   // azShifted: gridline-space position
  const trueAzAt = (azShifted) => (azShifted - azShift + 360) % 360;   // → real compass bearing
  const py = (el) => y0 + plotH * (1 - el / 90);

  // Plot background.
  ctx.fillStyle = pal.plot;
  ctx.fillRect(x0, y0, plotW, plotH);

  // ── Vertical gridlines every 20° (cardinals bold, true north gets its own colour) ──────────────
  for (let a = 0; a <= 360; a += 20) {
    const trueAz = trueAzAt(a);
    const isCardinal = (trueAz % 90 === 0);
    const x = px(a);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + plotH);
    if (isCardinal) { ctx.strokeStyle = (trueAz === 0) ? pal.north : pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else            { ctx.strokeStyle = pal.az10; ctx.lineWidth = 0.8; ctx.setLineDash([2, 4]); }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Horizontal gridlines every 10° elevation (0° = horizon, drawn solid+bold) ─────────────────
  for (let el = 0; el <= 90; el += 10) {
    const y = py(el);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + plotW, y);
    if (el === 0) { ctx.strokeStyle = pal.rim; ctx.lineWidth = 1.5; ctx.setLineDash([]); }
    else { ctx.strokeStyle = pal.ring; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Plot border.
  ctx.strokeStyle = pal.rim; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.strokeRect(x0, y0, plotW, plotH);

  // ── Azimuth ticks: true compass bearing at each gridline (numeric, every 20°) ──────────────────
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.fillStyle = pal.text;
  for (let a = 0; a <= 360; a += 20) {
    ctx.fillText(String(Math.round(trueAzAt(a))), px(a), y0 + plotH + 4);
  }
  // E/S/W compass letters - skip whichever cardinal falls on the split edges (north for the
  // northern hemisphere, south for the southern - see _skyDomeMatrixPoint), same as the reference
  // chart never labelling "N" either.
  const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  const edgeCardinal = azShift;   // 0 or 180 - the true bearing split across both edges
  ctx.font = "bold 12px 'Share Tech Mono', monospace";
  ctx.fillStyle = pal.north;
  for (const trueAzCard of [0, 90, 180, 270]) {
    if (trueAzCard === edgeCardinal) continue;
    const a = (trueAzCard + azShift) % 360;
    ctx.fillText(CARD[trueAzCard], px(a), y0 + plotH + 16);
  }
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.fillStyle = pal.text;
  ctx.fillText('Azimuth', x0 + plotW / 2, y0 + plotH + 30);

  // ── Elevation ticks (numeric, every 10°) + rotated "Elevation" axis label ─────────────────────
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let el = 0; el <= 90; el += 10) {
    ctx.fillText(el + '°', x0 - 6, py(el));
  }
  ctx.save();
  ctx.translate(11, y0 + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Elevation', 0, 0);
  ctx.restore();

  return layout;
}

function drawSkyDome() {
  const cv = document.getElementById('skyDomeCanvas');
  if (!cv) return;
  const RES = cv._res || 1;
  const ctx = cv.getContext('2d');
  const W = cv.width  / RES;
  const H = cv.height / RES;
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const lt = document.body.classList.contains('light');
  const pal = lt ? {
    bg: '#ffffff', plot: '#eef2f6', ring: 'rgba(0,0,0,0.16)', az10: 'rgba(0,0,0,0.10)',
    az30: 'rgba(0,0,0,0.22)', rim: 'rgba(0,0,0,0.55)', text: '#445a6e', north: '#0a4e8c',
    accent: '#8a4400', cross: 'rgba(20,40,60,0.60)'
  } : {
    bg: '#07090d', plot: '#0b0f15', ring: 'rgba(255,255,255,0.20)', az10: 'rgba(255,255,255,0.12)',
    az30: 'rgba(255,255,255,0.30)', rim: 'rgba(255,255,255,0.6)', text: '#9fb2c4', north: '#20a0e8',
    accent: '#e8a020', cross: 'rgba(210,222,235,0.70)'
  };

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // ── Axes: dispatch to whichever projection is active, each returns its own layout shape ───────
  const layout = skyDomeProjection === 'matrix'
    ? drawSkyDomeMatrixAxes(ctx, W, H, pal)
    : drawSkyDomePolarAxes(ctx, W, H, pal);
  _skyDomeLayout = layout;

  // ── Sun-path curves, drawn on top of the grid (same layering as the main canvas: grid, then
  //    the sun arcs) ─────────────────────────────────────────────────────────────────────────────
  drawSkyDomeSunPaths(ctx, layout);

  // ── Cursor crosshair: full elevation isoline + azimuth isoline through the hovered point ───────
  // Trivial in both projections - unlike the flat scan's isoline crosshair (drawCrosshair in
  // render-2d.js), which must inverse-project through the pinhole/cylinder math and handle folding,
  // an elevation isoline here is already a concentric ring (Dome) or a horizontal line (Matrix),
  // and an azimuth isoline is already a straight radial (Dome) or a vertical line (Matrix) - no
  // segmentation needed in either case.
  if (_skyDomeHoverEl !== null) {
    if (layout.mode === 'matrix') {
      // Go through _skyDomeProject (az=0 is arbitrary here - it doesn't affect y) so the line
      // lands exactly where the curves/grid do, including the culmination-centring shift.
      const y = _skyDomeProject(layout, 0, _skyDomeHoverEl).y;
      ctx.beginPath(); ctx.moveTo(layout.x0, y); ctx.lineTo(layout.x0 + layout.plotW, y);
      ctx.strokeStyle = pal.cross; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.stroke();

      if (_skyDomeHoverAz !== null) {
        const hp = _skyDomeProject(layout, _skyDomeHoverAz, _skyDomeHoverEl);
        ctx.beginPath(); ctx.moveTo(hp.x, layout.y0); ctx.lineTo(hp.x, layout.y0 + layout.plotH);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.stroke();

        ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.cross; ctx.fill();
      }
    } else {
      const { cx, cy, R } = layout;
      const rHover = R * (90 - _skyDomeHoverEl) / 90;
      ctx.beginPath(); ctx.arc(cx, cy, rHover, 0, Math.PI * 2);
      ctx.strokeStyle = pal.cross; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.stroke();

      if (_skyDomeHoverAz !== null) {
        const rim = _skyDomePoint(cx, cy, R, _skyDomeHoverAz, 0);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(rim.x, rim.y);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.stroke();

        const hp = _skyDomePoint(cx, cy, R, _skyDomeHoverAz, _skyDomeHoverEl);
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = pal.cross; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.cross; ctx.fill();
      }
    }
  }

  // ── Title (mirrors Sun Graph's, §17.9) ────────────────────────────────────────────────────────
  const latStr = LAT.toFixed(1) + '° ' + (hemisphere >= 0 ? 'N' : 'S');
  ctx.fillStyle = pal.accent;
  ctx.font = "bold 14px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Sky Dome', 34, 26);
  ctx.fillStyle = pal.text; ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.fillText('Lat ' + latStr, 34 + 90, 26);
}

// ── Wiring ───────────────────────────────────────────────────────────────────
// (Top sub-view switcher is now the wheel in .mode-subrow, wired in controls.js.)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && skyDomeActive) exitSkyDome();
});

// Dome/Matrix projection switch (top-right of the canvas, Sky Dome only) - same iOS-switch
// mechanic as the CHMI element switch (controls.js), single dynamic label opposite the thumb.
function updateSkyDomeProjSwitch() {
  const isDome = skyDomeProjection === 'dome';
  const btn = document.getElementById('btnSkyDomeProj');
  btn.classList.toggle('on', isDome);
  btn.setAttribute('aria-checked', String(isDome));
  document.getElementById('skyDomeProjLabelLeft').textContent  = isDome ? 'DOME' : '';
  document.getElementById('skyDomeProjLabelRight').textContent = isDome ? '' : 'MATRIX';
}
document.getElementById('btnSkyDomeProj').addEventListener('click', () => {
  skyDomeProjection = (skyDomeProjection === 'dome') ? 'matrix' : 'dome';
  updateSkyDomeProjSwitch();
  drawSkyDome();
});
updateSkyDomeProjSwitch();

// Redraw when the canvas area resizes (window / panel changes) - mirrors Sun Graph's own observer.
(function () {
  const container = document.getElementById('canvasContainer');
  if (container && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (skyDomeActive) resizeSkyDome(); }).observe(container);
  }
})();
