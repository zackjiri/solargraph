// ─── Sky Dome view ────────────────────────────────────────────────────────────
// Polar azimuth/elevation sky-dome diagram (à la SunEarthTools.com's sun-path chart): zenith
// (elevation 90°) at the centre, horizon (elevation 0°) at the rim, azimuth as the compass angle
// around it. Unlike the main 2D canvas (§7 in the project notes), this is a fixed geographic
// compass view - north is always straight up, independent of the calibration's YAW/PITCH/ROLL
// (those describe how the physical pinhole can was oriented, not a property of the sky itself).
//
// Sub-mode of Analyzer, sibling to 3D Model / Sun Graph (mutually exclusive canvas takeovers -
// see enterSkyDome()/exitSkyDome() and their counterparts in render-3d.js/render-sungraph.js).
// This first pass only draws the coordinate grid itself; sun paths/readout are layered on later.

let skyDomeActive = false;
let _skyDomeLayout = null;   // {cx, cy, R} in logical px - for future hit-testing / overlays

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
  document.getElementById('mainCanvas').style.pointerEvents = '';
  skyDomeActive = false;
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

// Elevation → radius (linear: 90° at centre, 0° at rim) and (az, el) → canvas point, sharing one
// origin/scale for the whole draw pass. az is world-standard (0=N, 90=E, 180=S, 270=W, clockwise);
// screen angle follows the same clockwise-from-up convention (compass, not math angle).
function _skyDomePoint(cx0, cy0, R, az, el) {
  const r = R * (90 - el) / 90;
  const a = az * Math.PI / 180;
  return { x: cx0 + r * Math.sin(a), y: cy0 - r * Math.cos(a) };
}

// ── Sun-path curves ────────────────────────────────────────────────────────────
// Mirrors the main canvas's "Sun's paths" / "Custom date" overlays (drawAllSunArcs / drawSunArc
// in core.js), reusing the same sunPosition()/sunDeclination() math, but projected straight
// through the compass-fixed dome via _skyDomePoint(az, el) - no "- yawDeg" correction, since the
// dome deliberately ignores calibration (see file header). First layer pass: the same curve set
// as the main canvas (4 thin intermediate months + both solstices + equinox, with hour dots on
// the equinox curve), plus the green Custom Path date with its south-transit label and animated
// sun marker.
function _skyDomeArcPoints(cx0, cy0, R, month, day) {
  const delta = sunDeclination(dayOfYear(month, day));
  const phi   = effectiveLat();
  const pts = [];
  for (let hDeg = -180; hDeg <= 180; hDeg += 0.5) {
    const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
    if (s.el < 0) continue;
    pts.push(_skyDomePoint(cx0, cy0, R, s.az, s.el));
  }
  return pts;
}

function _skyDomeStrokeArc(ctx, pts, color, lineWidth) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.setLineDash([]);
  ctx.stroke();
}

// Hour dots (15° = 1h steps) along one date's curve, with optional "H:MM" solar-time labels
// (display-mode aware, same as the main canvas's equinox curve).
function _skyDomeHourDots(ctx, cx0, cy0, R, month, day, color, withLabels) {
  const doy   = dayOfYear(month, day);
  const delta = sunDeclination(doy);
  const phi   = effectiveLat();
  for (let hDeg = -180; hDeg <= 180; hDeg += 15) {
    const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
    if (s.el < 0) continue;
    const p = _skyDomePoint(cx0, cy0, R, s.az, s.el);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
    if (withLabels) {
      const trueHour  = 12 + (hemisphere >= 0 ? hDeg : -hDeg) / 15;
      const shownHour = displayHour(trueHour, doy);
      const hh = Math.floor(shownHour), mm = Math.round((shownHour - hh) * 60);
      const label = hh + ':' + String(mm).padStart(2, '0');
      ctx.font = "bold 10px 'Share Tech Mono'";
      ctx.fillStyle = color.replace(/rgba\(([^,]+,[^,]+,[^,]+),[^)]+\)/, 'rgba($1,1)');
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2.5;
      ctx.textAlign = p.x < cx0 ? 'right' : 'left';
      const ox = p.x < cx0 ? -7 : 7;
      ctx.strokeText(label, p.x + ox, p.y - 4);
      ctx.fillText(label, p.x + ox, p.y - 4);
    }
  }
}

function drawSkyDomeSunPaths(ctx, cx0, cy0, R) {
  const op = dispOpacity;

  if (typeof showSunArc === 'undefined' || showSunArc) {
    const thinCol = `rgba(255, 220, 60, ${Math.min(1, op * 0.40)})`;
    [[1, 21], [2, 21], [4, 21], [5, 21]].forEach(([m, d]) => {
      _skyDomeStrokeArc(ctx, _skyDomeArcPoints(cx0, cy0, R, m, d), thinCol, 0.8);
    });

    const winterMonth = hemisphere >= 0 ? 12 : 6;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(cx0, cy0, R, winterMonth, 21),
      `rgba(60, 180, 255, ${Math.min(1, op * 0.85)})`, 1.5);

    const equinoxCol = `rgba(255, 220, 60, ${Math.min(1, op * 0.85)})`;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(cx0, cy0, R, 3, 21), equinoxCol, 1.5);
    if (typeof showLabels === 'undefined' || showLabels) {
      _skyDomeHourDots(ctx, cx0, cy0, R, 3, 21, equinoxCol, true);
    }

    const summerMonth = hemisphere >= 0 ? 6 : 12;
    _skyDomeStrokeArc(ctx, _skyDomeArcPoints(cx0, cy0, R, summerMonth, 21),
      `rgba(255, 100, 60, ${Math.min(1, op * 0.85)})`, 1.5);
  }

  if (typeof showCustomArc === 'undefined' || showCustomArc) {
    const { month: cm, day: cd } = customArcDate();
    const pts = _skyDomeArcPoints(cx0, cy0, R, cm, cd);
    _skyDomeStrokeArc(ctx, pts, `rgba(0,0,0,${Math.min(1, op * 0.85)})`, 3.5);
    _skyDomeStrokeArc(ctx, pts, `rgba(80, 220, 120, ${Math.min(1, op * 0.9)})`, 1.5);

    const delta = sunDeclination(dayOfYear(cm, cd));
    const phi   = effectiveLat();

    // Label at the south-transit point (H=0), same anchoring as the main canvas's custom arc.
    const south = sunPosition(0, delta, phi);
    if (south.el > 0 && (typeof showLabels === 'undefined' || showLabels)) {
      const sp = _skyDomePoint(cx0, cy0, R, south.az, south.el);
      const dateLabel = MONTH_NAMES[customMonth - 1] + ' ' + customDay;
      ctx.font = "10px 'Share Tech Mono'";
      ctx.fillStyle = 'rgba(80, 220, 120, 1)';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2.5;
      ctx.textAlign = 'left';
      ctx.strokeText(dateLabel, sp.x + 8, sp.y - 6);
      ctx.fillText(dateLabel, sp.x + 8, sp.y - 6);
    }

    // Animated sun marker at the current solar time, matching the theater/2D styling.
    if (typeof show3DCulmination === 'undefined' || show3DCulmination) {
      const hDeg = (sunTimeHours - 12) * 15 * hemisphere;
      const s = sunPosition(hDeg * Math.PI / 180, delta, phi);
      if (s.el >= 0) {
        const sp = _skyDomePoint(cx0, cy0, R, s.az, s.el);
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
    accent: '#8a4400'
  } : {
    bg: '#07090d', plot: '#0b0f15', ring: 'rgba(255,255,255,0.20)', az10: 'rgba(255,255,255,0.12)',
    az30: 'rgba(255,255,255,0.30)', rim: 'rgba(255,255,255,0.6)', text: '#9fb2c4', north: '#20a0e8',
    accent: '#e8a020'
  };

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // Layout: centred circular dome, margin around it for the azimuth ring of degree labels.
  const mTop = 40, mSide = 34, mBottom = 26;
  const availW = W - 2 * mSide, availH = H - mTop - mBottom;
  const R = Math.max(10, Math.min(availW, availH) / 2);
  const cx0 = W / 2;
  const cy0 = mTop + availH / 2;
  _skyDomeLayout = { cx: cx0, cy: cy0, R };

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

  // ── Sun-path curves, drawn on top of the grid (same layering as the main canvas: grid, then
  //    the sun arcs) ─────────────────────────────────────────────────────────────────────────────
  drawSkyDomeSunPaths(ctx, cx0, cy0, R);

  // ── Title (mirrors Sun Graph's, §17.9) ────────────────────────────────────────────────────────
  const latStr = LAT.toFixed(1) + '° ' + (hemisphere >= 0 ? 'N' : 'S');
  ctx.fillStyle = pal.accent;
  ctx.font = "bold 14px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Sky Dome', mSide, 26);
  ctx.fillStyle = pal.text; ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.fillText('Lat ' + latStr, mSide + 90, 26);
}

// ── Wiring ───────────────────────────────────────────────────────────────────
// (Top sub-view switcher is now the wheel in .mode-subrow, wired in controls.js.)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && skyDomeActive) exitSkyDome();
});

// Redraw when the canvas area resizes (window / panel changes) - mirrors Sun Graph's own observer.
(function () {
  const container = document.getElementById('canvasContainer');
  if (container && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (skyDomeActive) resizeSkyDome(); }).observe(container);
  }
})();
