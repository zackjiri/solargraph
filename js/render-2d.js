// ─── Rendering ─────────────────────────────────────────────────────────────
function draw() {
  const W = canvasLW;
  const H = canvasLH;

  // Map logical coordinates → backing store (super-resolution). Everything below draws in
  // logical px (W×H); the transform scales it up so text and thin lines stay crisp.
  ctx.setTransform(canvasRES, 0, 0, canvasRES, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Background image (L1)
  if (imgBitmap) {
    ctx.drawImage(imgBitmap, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#080a0e';
    ctx.fillRect(0, 0, W, H);
  }

  // Split overlay (L2) – drawn before display elements
  if (splitActive) drawSplitOverlay(W, H);

  // Vignetting isolines (α = 70°, 80°, 90°)
  if (showHeatmap) drawVignetteIsolines(W, H);

  // Grid
  if (showGrid) drawGrid(W, H);

  // Horizon
  if (showHorizon) drawHorizon(W, H);

  // Sun arcs – full annual set
  if (showSunArc) drawAllSunArcs(W, H);

  // Whole-period CHMI mosaic tiles the entire exposure interval - unlike the single-day gradient
  // below, it isn't really "about" the Custom Path date, so it stays visible even with "Custom
  // date" unchecked. Only its thin highlight outline around the selected day is tied to that
  // checkbox (drawChmiMosaic checks showCustomArc itself before drawing it).
  const chmiOn = typeof showImgChmi !== 'undefined' && showImgChmi && timeDisplayMode !== 'true';
  if (chmiOn && chmiDisplayMode === 'whole') drawChmiMosaic(W, H);

  // Custom date arc – black outline + green fill, with label at south axis. When CHMI data is on
  // (Display section) and not in Apparent solar time, the gradient replaces it: either the single
  // Custom Path day (a halo under the green line wasn't legible - same curve, coloured by measured
  // sunshine) or the whole-exposure mosaic (drawn above already, so there's nothing further to do
  // here for it besides the label/sun marker below).
  if (showCustomArc) {
    const op = dispOpacity;
    if (chmiOn && chmiDisplayMode === 'whole') {
      // Mosaic (+ its own highlight) already drawn above - nothing more needed for the arc itself.
    } else if (chmiOn) {
      const chmiW = 9;   // matches the Sun symbol dot drawn elsewhere (radius 4.5) - canvas size, not a physical disc
      const chmiByDoy  = _imgChmiEnsureByDoy();
      const dayCovered = !!(chmiByDoy && chmiByDoy.get(dayOfYear(customMonth, customDay)));
      if (dayCovered) {
        // Thin dark-grey border above/below the band - same "wider line underneath" trick as
        // the black outline used for the green path, just narrower peek since this one is thin.
        drawSunArc(W, H, customMonth, customDay, {
          color: `rgba(60,60,60,${Math.min(1, op * 0.85)})`, lineWidth: chmiW + 2,
          showHourDots: false, showHourLabels: false, edgeLabel: null
        });
        drawChmiArc(W, H, chmiW);
      } else {
        // This image has CHMI data, but not for the currently selected Custom Path day - a
        // flat, translucent grey (no gradient, no border): we genuinely have no information for
        // this day, distinct from the gradient's own dark "confirmed no sun" colour.
        drawSunArc(W, H, customMonth, customDay, {
          color: `rgba(160,160,160,${Math.min(1, op * 0.5)})`, lineWidth: chmiW,
          showHourDots: false, showHourLabels: false, edgeLabel: null
        });
      }
    } else {
      drawSunArc(W, H, customMonth, customDay, {
        color: `rgba(0,0,0,${Math.min(1, op * 0.85)})`, lineWidth: 3.5,
        showHourDots: false, showHourLabels: false, edgeLabel: null
      });
      drawSunArc(W, H, customMonth, customDay, {
        color: `rgba(80, 220, 120, ${Math.min(1, op * 0.9)})`, lineWidth: 1.5,
        showHourDots: false, showHourLabels: false, edgeLabel: null
      });
    }

    // Label anchored to south axis, offset 8px right, above the arc at that point
    // Find arc y-position at south axis (β=0, i.e. pixel x = cx adjusted for yawDeg).
    // pathDeclination() applies the same hemisphere sign the arc itself was drawn with
    // (drawSunArc()), so this always finds the transit point of the actual plotted curve.
    const doy   = dayOfYear(customMonth, customDay);
    const delta = pathDeclination(doy);
    const phi   = effectiveLat();
    // Hour angle at exactly south transit (H=0)
    const { el: elSouth, beta: betaSouth } = sunPosition(0, delta, phi);
    const southPos = elSouth > 0 ? azElToPixel(betaSouth - yawDeg, elSouth) : null;

    if (southPos && southPos.px >= 0 && southPos.px <= W && southPos.py >= 0 && southPos.py <= H && showLabels) {
        const dateLabel = MONTH_NAMES[customMonth - 1] + ' ' + customDay;
      const lx = southPos.px + 8;
      const ly = southPos.py - 6;
      ctx.font = "10px 'Share Tech Mono'";
      ctx.fillStyle = 'rgba(80, 220, 120, 1)';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 2.5;
      ctx.textAlign = 'left';
      ctx.strokeText(dateLabel, lx, ly);
      ctx.fillText(dateLabel,   lx, ly);
    }

    // Animated Sun marker on the path (Analyzer): yellow dot in the theater pinhole style
    if (show3DCulmination) {
      maybeUpdateSunFill();                          // keep slider regions in sync (analyzer)
      const dDelta = delta;   // same path-convention declination the arc/label above already used
      const hDeg = (sunTimeHours - 12) * 15 * hemisphere;
      const s = sunPosition(hDeg * Math.PI / 180, dDelta, phi);
      if (s.el >= 0) {
        const sp = azElToPixel(s.beta - yawDeg, s.el);
        if (sp && sp.px >= 0 && sp.px <= W && sp.py >= 0 && sp.py <= H) {
          const glR = 14;
          const glow = ctx.createRadialGradient(sp.px, sp.py, 0, sp.px, sp.py, glR);
          glow.addColorStop(0, 'rgba(232,160,32,0.60)'); glow.addColorStop(1, 'rgba(232,160,32,0)');
          ctx.fillStyle = glow; ctx.fillRect(sp.px - glR, sp.py - glR, glR * 2, glR * 2);
          ctx.beginPath(); ctx.arc(sp.px, sp.py, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = '#e8a020'; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        }
      }
    }
  }

  // Cursor crosshair – hide in split mode
  if (mouseX >= 0 && !splitActive) drawCrosshair(W, H);

  // Sky Dome shares almost all of this state (custom date, sun time, Display toggles, opacity,
  // lat/lon) - piggyback its redraw on every main-canvas redraw rather than duplicating a redraw
  // call at every one of the many triggers that already call draw() (calibration-only sliders just
  // harmlessly redraw a hidden dome when Sky Dome isn't the active view).
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive && typeof drawSkyDome === 'function') drawSkyDome();
}

// CHMI measured-sunshine trace along the Custom Path curve - replaces the black+green line
// when the legend toggle is on. Same point sequence as drawSunArc (sunPosition + azElToPixel),
// sampled at 2.5° steps (= 10 min, matching the data's own resolution) and stroked segment-by-
// segment so each 10-min bucket gets its own flat colour (hard edges, no blending - consistent
// with the Sun Graph cells). Wherever the curve exists (sun above horizon) but there is no
// measurement (no dataset for the day, or a missing/QUALITY=4 sample), the segment defaults to
// the gradient's darkest "not shining" colour instead of leaving a gap - same always-painted
// default as the Sun Graph's night band, just applied along the arc instead of a rectangle.
function drawChmiArc(W, H, lineWidth) {
  const realDoy    = dayOfYear(customMonth, customDay);
  const chmiByDoy  = _imgChmiEnsureByDoy();
  const daySamples = chmiByDoy ? chmiByDoy.get(realDoy) : null;
  const bySlot = new Map();   // slot 0..143 (10-min index into the day, standard time) → value
  if (daySamples) for (const [hour, sec] of daySamples) bySlot.set(Math.round(hour * 6), sec);

  const delta = pathDeclination(realDoy);   // weather is tied to the real calendar day either way
  const phi   = effectiveLat();
  const op    = dispOpacity;
  const alpha = Math.min(1, op * 0.9);
  const missingIsZero = _imgChmiMissingIsZeroSafe();

  let prevPos = null, prevSec = 0, prevHasVal = true;   // 0 = "not shining" default for the very first segment (SSV10M only)
  for (let hDeg = -180; hDeg <= 180; hDeg += 2.5) {
    const Hrad = hDeg * Math.PI / 180;
    const { el, beta } = sunPosition(Hrad, delta, phi);
    let pos = null;
    if (el >= 0) {
      pos = azElToPixel(beta - yawDeg, el);
      if (pos && (pos.px < -20 || pos.px > W + 20)) pos = null;
    }

    if (pos && prevPos) {
      ctx.beginPath();
      ctx.moveTo(prevPos.px, prevPos.py);
      ctx.lineTo(pos.px, pos.py);
      ctx.strokeStyle = prevHasVal ? _chmiActiveColor(prevSec, alpha) : `rgba(160,160,160,${alpha * 0.6})`;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // The curve is walked in true solar hour angle; CHMI buckets are keyed in standard time
    // (see _sgEnsureChmiByDoy in core.js), so the lookup hour must go through that conversion.
    const trueHour = 12 + (hemisphere >= 0 ? hDeg : -hDeg) / 15;
    const standardHour = standardFromTrue(trueHour, realDoy);
    const slot = ((Math.round(standardHour * 6) % 144) + 144) % 144;
    const sec = pos ? bySlot.get(slot) : undefined;
    if (sec !== undefined && sec !== null) { prevSec = sec; prevHasVal = true; }
    else if (missingIsZero) { prevSec = 0; prevHasVal = true; }
    else { prevHasVal = false; }
    prevPos = pos;
  }
}

// ─── CHMI mosaic ("whole period") ───────────────────────────────────────────
// Alternative to drawChmiArc(): instead of one gradient trace for the Custom Path day, tiles
// the entire exposure interval. Built as a day-of-year × hour-angle quad mesh, each quad's cross
// (day-axis) edge sitting at the midpoint between its own day's arc and the neighbouring day's arc
// at the same true hour angle - so a tile's thickness is exactly half the geometric gap to each
// neighbour. That gap is what physically varies across the year (declination barely changes
// day-to-day near a solstice, changes fastest near an equinox, see §6.5 in the project notes) - so
// this reproduces the dense/loose banding seen on real scans for free, without any special-casing.
// A day at the true start/end of the exposure range has no neighbour on the missing side, so its
// tile is only half as thick there ("thinner edges") - again just a consequence of the same rule,
// not a separate branch. Declination (hence tile shape) is evaluated for every calendar day in
// range regardless of whether that specific day has a CHMI sample, so the mesh stays geometrically
// continuous across data gaps; only the fill colour drops to flat grey for a day with no sample at
// all (same convention as the single-day "no data for this day" case in drawChmiArc's caller).
const _CHMI_MOSAIC_NDAYS = 365;
const _CHMI_MOSAIC_HSTEP = 2.5;   // degrees of true hour angle - matches drawChmiArc's cadence

// Ordered list of real calendar days covered by the current exposure interval - INCLUSIVE of both
// exposure_start and exposure_end (endDoy is the last day the paper was actually exposed, i.e.
// the day it was retrieved, not the day after - the CHMI extract for that day is real, full data,
// not a timezone-rollover artifact; see project notes on this boundary). Handles the interval
// wrapping over year-end.
function _imgChmiDayList() {
  const exp = (typeof currentExposure !== 'undefined') ? currentExposure : null;
  if (!exp) return [];
  const days = [];
  if (exp.startDoy <= exp.endDoy) {
    for (let d = exp.startDoy; d <= exp.endDoy; d++) days.push(d);
  } else {
    for (let d = exp.startDoy; d <= _CHMI_MOSAIC_NDAYS; d++) days.push(d);
    for (let d = 1; d <= exp.endDoy; d++) days.push(d);
  }
  return days;
}

// Projected pixel position of the sun for a given declination at true hour angle Hdeg, or null
// below the horizon / off-canvas - same filter drawSunArc/drawChmiArc use.
function _imgChmiPoint(Hdeg, delta, phi, W) {
  const { el, beta } = sunPosition(Hdeg * Math.PI / 180, delta, phi);
  if (el < 0) return null;
  const pos = azElToPixel(beta - yawDeg, el);
  if (!pos || pos.px < -20 || pos.px > W + 20) return null;
  return pos;
}

function _imgChmiSlotsFor(chmiByDoy, d) {
  const samples = chmiByDoy ? chmiByDoy.get(d) : null;
  if (!samples) return null;
  const m = new Map();
  for (const [hour, sec] of samples) m.set(Math.round(hour * 6), sec);
  return m;
}

// Missing samples inside an otherwise-covered day default to 0 only for the base SSV10M dataset,
// where 0 is itself a real, meaningful value ("confirmed no sunshine this 10 min", same colour as
// genuinely-measured 0 - see drawChmiArc's own comment). For anything else (e.g. temperature) 0 is
// just another plausible reading, so a missing sample there must fall back to the neutral "no data"
// grey instead of silently fabricating a value.
function _imgChmiMissingIsZeroSafe() { return !chmiActiveElement; }

// Bucket-by-day-of-year cache for whichever dataset is active, mirroring _sgEnsureChmiByDoy()'s
// own caching (calibration-independent, just data identity + time zone) but scoped to the canvas
// element switch instead of always the base dataset.
let _imgChmiByDoy = null, _imgChmiByDoySrc = null, _imgChmiByDoyZone = null;
function _imgChmiEnsureByDoy() {
  const src = _chmiActiveDataset();
  if (!src) { _imgChmiByDoySrc = null; _imgChmiByDoy = null; return null; }
  if (_imgChmiByDoySrc === src && _imgChmiByDoyZone === timeZoneHours) return _imgChmiByDoy;
  _imgChmiByDoySrc = src;
  _imgChmiByDoyZone = timeZoneHours;
  _imgChmiByDoy = _chmiBucketByDoy(src.values, timeZoneHours);
  return _imgChmiByDoy;
}

// Cached offscreen bitmap - rebuilt only when calibration, the exposure range, the CHMI dataset,
// the time zone or the display-time mode change, never on a plain redraw (mousemove/crosshair
// would otherwise recompute several thousand quads every frame).
let _imgChmiBitmap = null, _imgChmiKeyStr = null, _imgChmiSrcRef = null;
function _imgChmiEnsureMosaic(W, H) {
  const exp = (typeof currentExposure !== 'undefined') ? currentExposure : null;
  const srcRef = _chmiActiveDataset();
  const keyStr = [yawDeg, pitchDeg, rollDeg, horizonMm, radius, scanWmm, LAT, hemisphere,
                  exp ? exp.startDoy : 'x', exp ? exp.endDoy : 'x',
                  timeZoneHours, timeDisplayMode, W, H, canvasRES, chmiActiveElement].join(',');
  if (keyStr === _imgChmiKeyStr && srcRef === _imgChmiSrcRef) return _imgChmiBitmap;
  _imgChmiKeyStr = keyStr;
  _imgChmiSrcRef = srcRef;

  const days = _imgChmiDayList();
  const chmiByDoy = _imgChmiEnsureByDoy();
  if (!days.length || !chmiByDoy) { _imgChmiBitmap = null; return null; }

  const phi = effectiveLat();
  const Hsteps = [];
  for (let Hdeg = -180; Hdeg <= 180; Hdeg += _CHMI_MOSAIC_HSTEP) Hsteps.push(Hdeg);
  const nH = Hsteps.length;

  // Project every (day, hour-step) pair exactly once; neighbouring days/quads reuse these
  // instead of recomputing (each day's own row also serves as its neighbours' pPrev/pNext).
  const posGrid = new Array(days.length);
  for (let i = 0; i < days.length; i++) {
    const delta = pathDeclination(days[i]);
    const row = new Array(nH);
    for (let j = 0; j < nH; j++) row[j] = _imgChmiPoint(Hsteps[j], delta, phi, W);
    posGrid[i] = row;
  }

  const off = document.createElement('canvas');
  off.width  = Math.max(1, Math.round(W * canvasRES));
  off.height = Math.max(1, Math.round(H * canvasRES));
  const octx = off.getContext('2d');
  octx.setTransform(canvasRES, 0, 0, canvasRES, 0, 0);

  const missingIsZero = _imgChmiMissingIsZeroSafe();
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const bySlot = _imgChmiSlotsFor(chmiByDoy, d);
    const hasDay = bySlot !== null;
    const rowMid  = posGrid[i];
    const rowPrev = i > 0 ? posGrid[i - 1] : null;
    const rowNext = i < days.length - 1 ? posGrid[i + 1] : null;

    let prevTop = null, prevBot = null, prevSec = 0, prevHasVal = true;
    for (let j = 0; j < nH; j++) {
      const pMid = rowMid[j];
      let top = null, bot = null;
      if (pMid) {
        const pPrev = rowPrev ? rowPrev[j] : null;
        const pNext = rowNext ? rowNext[j] : null;
        top = pPrev ? { px: (pMid.px + pPrev.px) / 2, py: (pMid.py + pPrev.py) / 2 } : pMid;
        bot = pNext ? { px: (pMid.px + pNext.px) / 2, py: (pMid.py + pNext.py) / 2 } : pMid;
      }

      if (top && prevTop) {
        const col = (hasDay && prevHasVal) ? _chmiActiveColor(prevSec, 1) : 'rgba(160,160,160,0.55)';
        octx.beginPath();
        octx.moveTo(prevTop.px, prevTop.py);
        octx.lineTo(top.px, top.py);
        octx.lineTo(bot.px, bot.py);
        octx.lineTo(prevBot.px, prevBot.py);
        octx.closePath();
        octx.fillStyle = col;
        octx.fill();
        // Matching-colour hairline stroke over the fill's own edge - papers over the antialiasing
        // seam canvas otherwise leaves between two separately-filled, exactly-adjacent polygons.
        octx.strokeStyle = col;
        octx.lineWidth = 1;
        octx.stroke();
      }

      const trueHour = 12 + (hemisphere >= 0 ? Hsteps[j] : -Hsteps[j]) / 15;
      const standardHour = standardFromTrue(trueHour, d);
      const slot = ((Math.round(standardHour * 6) % 144) + 144) % 144;
      const sec = (hasDay && top) ? bySlot.get(slot) : undefined;
      if (sec !== undefined && sec !== null) { prevSec = sec; prevHasVal = true; }
      else if (missingIsZero) { prevSec = 0; prevHasVal = true; }
      else { prevHasVal = false; }
      prevTop = top; prevBot = bot;
    }
  }

  _imgChmiBitmap = off;
  return off;
}

// Thin outline around the currently-selected Custom Path day's own tile, so it stays findable
// inside the mosaic - reuses the Custom Path's own green. Computed live (not cached): unlike the
// mosaic itself this depends on customMonth/customDay, which can be scrubbed without touching any
// of the mosaic's own cache keys. Cost is the same order as drawChmiArc (one day, ~145 samples).
function _imgChmiHighlightCustomDay(W, H) {
  const exp = (typeof currentExposure !== 'undefined') ? currentExposure : null;
  if (!exp) return;
  const realDoy = dayOfYear(customMonth, customDay);
  const inRange = exp.startDoy <= exp.endDoy
    ? (realDoy >= exp.startDoy && realDoy <= exp.endDoy)
    : (realDoy >= exp.startDoy || realDoy <= exp.endDoy);
  if (!inRange) return;

  const N = _CHMI_MOSAIC_NDAYS;
  const lastDay = exp.endDoy;   // endDoy is inclusive - see _imgChmiDayList
  const atStart = realDoy === exp.startDoy;
  const atEnd   = realDoy === lastDay;
  const dPrev = atStart ? null : ((realDoy - 2 + N) % N) + 1;
  const dNext = atEnd   ? null : (realDoy % N) + 1;

  const phi = effectiveLat();
  const delta     = pathDeclination(realDoy);
  const deltaPrev = dPrev !== null ? pathDeclination(dPrev) : null;
  const deltaNext = dNext !== null ? pathDeclination(dNext) : null;

  const top = [], bot = [];
  for (let Hdeg = -180; Hdeg <= 180; Hdeg += _CHMI_MOSAIC_HSTEP) {
    const pMid  = _imgChmiPoint(Hdeg, delta, phi, W);
    if (!pMid) continue;
    const pPrev = deltaPrev !== null ? _imgChmiPoint(Hdeg, deltaPrev, phi, W) : null;
    const pNext = deltaNext !== null ? _imgChmiPoint(Hdeg, deltaNext, phi, W) : null;
    top.push(pPrev ? { px: (pMid.px + pPrev.px) / 2, py: (pMid.py + pPrev.py) / 2 } : pMid);
    bot.push(pNext ? { px: (pMid.px + pNext.px) / 2, py: (pMid.py + pNext.py) / 2 } : pMid);
  }
  if (top.length < 2) return;

  const alpha = Math.min(1, dispOpacity * 1.1);
  ctx.strokeStyle = `rgba(80,220,120,${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(top[0].px, top[0].py);
  for (let i = 1; i < top.length; i++) ctx.lineTo(top[i].px, top[i].py);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bot[0].px, bot[0].py);
  for (let i = 1; i < bot.length; i++) ctx.lineTo(bot[i].px, bot[i].py);
  ctx.stroke();
}

// Entry point called from draw() for chmiDisplayMode === 'whole'. Blits the cached bitmap 1:1 in
// physical pixels (no extra resample on top of it - the bitmap is already at canvasRES) then
// restores draw()'s own logical-pixel transform for whatever comes after.
function drawChmiMosaic(W, H) {
  const bmp = _imgChmiEnsureMosaic(W, H);
  if (bmp) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.min(1, dispOpacity * 0.9);
    ctx.drawImage(bmp, 0, 0);
    ctx.restore();
    ctx.setTransform(canvasRES, 0, 0, canvasRES, 0, 0);
  }
  if (showCustomArc) _imgChmiHighlightCustomDay(W, H);
}

function drawGrid(W, H) {
  const op = dispOpacity;

  // Azimuth isolines every 15° – full 360°, hemisphere-aware styling
  const NH_AZ_LABELS = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  const SH_AZ_LABELS = { 0: 'S', 90: 'W', 180: 'N', 270: 'E' };
  const azLabelMap = hemisphere >= 0 ? NH_AZ_LABELS : SH_AZ_LABELS;
  // Sun-facing direction: S in NH (az=180), N in SH (az=0)
  const importantAz = hemisphere >= 0 ? 180 : 0;

  for (let az = 0; az < 360; az += 15) {
    const beta = az - 180 - yawDeg;
    const isCardinal  = (az % 90 === 0);
    const isImportant = (az === importantAz);
    const isNorthAz   = (az === (hemisphere >= 0 ? 0 : 180));  // pole-facing direction
    const is30        = (az % 30 === 0);

    // Segment handling like the elevation isolines below (and the crosshair's own azimuth
    // isoline, §7.6): with pitch/roll the sweep can fold past the camera pole (local elevation
    // → ±90°), where the local azimuth flips by ~180°. Such a folded point can land far away
    // horizontally yet still pass a per-point px/py filter - a single unbroken polyline through
    // all surviving points then draws a spurious streak connecting the fold to the real branch.
    // Breaking on out-of-bounds AND on a big px jump between consecutive valid points (same 60 px
    // threshold as the crosshair) keeps each visible branch on its own path.
    //
    // Separately - not a fold at all - at extreme pitch/roll the meridian can legitimately (and
    // continuously) swing from far above the frame to far past its side/bottom edge, clipping
    // through a corner for a couple of samples before leaving again (confirmed by walking the
    // el sweep for GEN-1_5: el −70° lands at px −27 (just outside), −69.5°..−68.5° land inside by
    // a few px, −68° is back outside - three genuine, continuous, non-folded points). Mathematically
    // correct, but a 2-4-point sliver is meaningless as a coordinate reference and reads as a
    // stray mark - MIN_SEG_LEN drops any segment too short to be a real, followable line.
    const MIN_SEG_LEN = 10;   // 10 samples @ 0.5° = 5° of continuous arc
    const segments = [];
    let seg = [], prev = null;
    for (let el = -85; el <= 85; el += 0.5) {
      const pos = azElToPixel(beta, el);
      const valid = pos && pos.py >= -20 && pos.py <= H + 20 && pos.px >= -20 && pos.px <= W + 20;
      if (valid) {
        if (prev && Math.abs(pos.px - prev.px) > 60) {
          if (seg.length >= MIN_SEG_LEN) segments.push(seg);
          seg = [];
        }
        seg.push(pos); prev = pos;
      } else {
        if (seg.length >= MIN_SEG_LEN) segments.push(seg);
        seg = []; prev = null;
      }
    }
    if (seg.length >= MIN_SEG_LEN) segments.push(seg);
    if (segments.length === 0) continue;
    const points = segments.flat();   // only used below to anchor the N/S edge labels

    ctx.beginPath();
    for (const s of segments) {
      ctx.moveTo(s[0].px, s[0].py);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].px, s[i].py);
    }

    if (isImportant) {
      ctx.strokeStyle = `rgba(232,160,32,${Math.min(1, op * 1.1)})`;
      ctx.lineWidth = 2; ctx.setLineDash([]);
    } else if (isNorthAz) {
      ctx.strokeStyle = `rgba(32,160,232,${Math.min(1, op * 1.1)})`;
      ctx.lineWidth = 2; ctx.setLineDash([]);
    } else if (isCardinal) {
      ctx.strokeStyle = `rgba(32,160,232,${Math.min(1, op * 0.95)})`;
      ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    } else if (is30) {
      ctx.strokeStyle = `rgba(232,160,32,${Math.min(1, op * 0.65)})`;
      ctx.lineWidth = 1.1; ctx.setLineDash([5, 5]);
    } else {
      ctx.strokeStyle = `rgba(232,160,32,${Math.min(1, op * 0.42)})`;
      ctx.lineWidth = 0.9; ctx.setLineDash([3, 5]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (showLabels && points.length > 0) {
      const fontSize = (isImportant || isNorthAz || isCardinal) ? 12 : 10;
      ctx.font = `${(isImportant || isNorthAz) ? 'bold ' : ''}${fontSize}px 'Share Tech Mono'`;
      ctx.fillStyle = isImportant ? 'rgba(232,160,32,1)'
        : isNorthAz ? 'rgba(32,160,232,1)'
        : isCardinal ? 'rgba(32,160,232,1)'
        : is30 ? 'rgba(200,180,120,1)' : 'rgba(180,160,100,1)';
      const displayAz = hemisphere >= 0 ? az : (az + 180) % 360;
      const label = isCardinal ? azLabelMap[az] : displayAz + '°';
      const top = points[0], bot = points[points.length - 1];
      ctx.textAlign = 'center';
      ctx.fillText(label, top.px, top.py + 12);
      ctx.fillText(label, bot.px, bot.py - 4);
    }
  }

  // Elevation isolines every 10° – full 360° with segment handling. Same MIN_SEG_LEN reasoning
  // as the azimuth isolines above: at extreme pitch/roll a couple of samples can clip a corner of
  // the frame on an otherwise off-canvas stretch of the curve - mathematically real, but a 2-point
  // sliver reads as a stray mark rather than a followable reference line.
  const MIN_EL_SEG_LEN = 10;   // 10 samples @ 1° = 10° of continuous arc
  for (let el = -80; el <= 80; el += 10) {
    if (el === 0) continue; // horizon drawn separately

    const segments = [];
    let seg = [];
    for (let az = 0; az <= 360; az += 1) {
      const beta = az - 180 - yawDeg;
      const pos  = azElToPixel(beta, el);
      if (pos && pos.px >= -20 && pos.px <= W + 20
              && pos.py >= -20 && pos.py <= H + 20) {
        seg.push(pos);
      } else {
        if (seg.length >= MIN_EL_SEG_LEN) segments.push(seg);
        seg = [];
      }
    }
    if (seg.length >= MIN_EL_SEG_LEN) segments.push(seg);
    if (segments.length === 0) continue;

    ctx.strokeStyle = `rgba(32,160,232,${Math.min(1, op * 0.65)})`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 4]);
    for (const s of segments) {
      ctx.beginPath();
      ctx.moveTo(s[0].px, s[0].py);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].px, s[i].py);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (showLabels) {
      ctx.font = "10px 'Share Tech Mono'";
      ctx.fillStyle = 'rgba(32,160,232,1)';
      let best = null;
      for (const s of segments) {
        for (const p of s) {
          if (p.px >= cx && (!best || p.px < best.px)) best = p;
        }
      }
      if (best) {
        ctx.textAlign = 'left';
        ctx.fillText((el > 0 ? '+' : '') + el + '°', best.px + 4, best.py - 3);
      }
    }
  }
}

function drawHorizon(W, H) {
  if (!showHorizon) return;
  const op = dispOpacity;

  // Horizon = el 0° sampled over full 360° – breaks at null (behind camera)
  const segments = [];
  let current = [];
  for (let az = 0; az <= 361; az += 1) {
    const beta = az - 180 - yawDeg;
    const pos = azElToPixel(beta, 0);
    if (pos && pos.px >= -40 && pos.px <= W + 40) {
      current.push({ ...pos, az: az % 360 });
    } else {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
  }
  if (current.length >= 2) segments.push(current);
  if (segments.length === 0) return;

  // Draw horizon line – white dashed
  ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, op * 0.85)})`;
  ctx.lineWidth = 1.8;
  ctx.setLineDash([8, 4]);
  for (const seg of segments) {
    ctx.beginPath();
    ctx.moveTo(seg[0].px, seg[0].py);
    for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].px, seg[i].py);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Azimuth tick marks every 20° – full 360°
  const tickAzimuths = [];
  for (let az = 0; az < 360; az += 20) tickAzimuths.push(az);
  const horizImportantAz = hemisphere >= 0 ? 180 : 0; // sun-facing direction

  for (const az of tickAzimuths) {
    const beta = az - 180;
    const pos = azElToPixel(beta - yawDeg, 0);
    if (!pos) continue;
    if (pos.px < 0 || pos.px > W) continue;

    const isCentre = (az === horizImportantAz);
    const tickH = isCentre ? 10 : 6;
    const col = isCentre
      ? `rgba(232,160,32,${Math.min(1, op * 1.1)})`
      : `rgba(255,255,255,${Math.min(1, op * 0.85)})`;

    ctx.beginPath();
    ctx.moveTo(pos.px, pos.py);
    ctx.lineTo(pos.px, pos.py - tickH);
    ctx.strokeStyle = col;
    ctx.lineWidth = isCentre ? 1.5 : 1;
    ctx.setLineDash([]);
    ctx.stroke();

    if (showLabels) {
      ctx.font = `${isCentre ? 'bold ' : ''}10px 'Share Tech Mono'`;
      ctx.fillStyle = isCentre ? 'rgba(232,160,32,1)' : 'rgba(255,255,255,1)';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 2;
      ctx.textAlign = 'center';
      const displayAz = hemisphere >= 0 ? az : (az + 180) % 360;
      const labelStr = displayAz + '°';
      ctx.strokeText(labelStr, pos.px, pos.py - tickH - 3);
      ctx.fillText(labelStr,   pos.px, pos.py - tickH - 3);
    }
  }

  // Horizon label: under showLabels, anchored to camera south axis (β=0), 8px right
  if (showLabels) {
    const axisPos = azElToPixel(-yawDeg, 0);  // β=0 = south, always the axis
    if (axisPos && axisPos.px >= 0 && axisPos.px <= W) {
      const lx = axisPos.px + 8;
      const ly = axisPos.py - 6;
      ctx.font = "bold 10px 'Share Tech Mono'";
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 2.5;
      ctx.textAlign = 'left';
      ctx.strokeText('horizon', lx, ly);
      ctx.fillText('horizon',   lx, ly);
    }
  }
}

function drawCrosshair(W, H) {
  const mx = mouseX;
  const my = mouseY;

  const { beta_deg, theta_deg } = pixelToAzEl(mx, my);
  const inRange = Math.abs(beta_deg) < 180;

  if (inRange) {
    // ── Elevation isoline (horizontal part) – constant θ, varying β ──
    // Full 360°, with segment handling; note: yawDeg applied (fixes prior bug)
    const elSegs = [];
    let elSeg = [];
    // MIN_SEG_LEN (see drawGrid): drops degenerate 2-4-point corner clips that are mathematically
    // real but read as a stray mark rather than a followable isoline.
    const MIN_SEG_LEN = 10;
    for (let az = 0; az < 360; az += 0.5) {
      const b   = az - 180 - yawDeg;
      const pos = azElToPixel(b, theta_deg);
      if (pos && pos.px >= -20 && pos.px <= W + 20 && pos.py >= -20 && pos.py <= H + 20) {
        elSeg.push(pos);
      } else {
        if (elSeg.length >= MIN_SEG_LEN) elSegs.push(elSeg);
        elSeg = [];
      }
    }
    if (elSeg.length >= MIN_SEG_LEN) elSegs.push(elSeg);
    if (elSegs.length > 0) {
      ctx.strokeStyle = 'rgba(80,80,80,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      for (const s of elSegs) {
        ctx.beginPath();
        ctx.moveTo(s[0].px, s[0].py);
        for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].px, s[i].py);
        ctx.stroke();
      }
    }

    // ── Azimuth isoline (vertical part) – constant β, varying θ ──
    // Segment handling like the elevation isoline: with pitch/roll the sweep can
    // fold past the camera pole (local elevation → ±90°), where the local azimuth
    // flips by ~180°. Such points land far away horizontally yet may pass a
    // py-only filter – a single unbroken polyline then connects the fold to the
    // real branch as a spurious near-horizontal streak across the image.
    const azSegs = [];
    let azSeg = [], azPrev = null;
    for (let el = -85; el <= 85; el += 0.5) {
      const pos = azElToPixel(beta_deg, el);
      if (pos && pos.px >= -20 && pos.px <= W + 20 && pos.py >= -20 && pos.py <= H + 20) {
        // fold can also jump directly between two on-canvas points – break on big px gaps
        if (azPrev && Math.abs(pos.px - azPrev.px) > 60) {
          if (azSeg.length >= MIN_SEG_LEN) azSegs.push(azSeg);
          azSeg = [];
        }
        azSeg.push(pos); azPrev = pos;
      } else {
        if (azSeg.length >= MIN_SEG_LEN) azSegs.push(azSeg);
        azSeg = []; azPrev = null;
      }
    }
    if (azSeg.length >= MIN_SEG_LEN) azSegs.push(azSeg);
    if (azSegs.length > 0) {
      ctx.strokeStyle = 'rgba(80,80,80,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      for (const s of azSegs) {
        ctx.beginPath();
        ctx.moveTo(s[0].px, s[0].py);
        for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].px, s[i].py);
        ctx.stroke();
      }
    }
  } else {
    // Out of range – plain straight lines as fallback
    ctx.beginPath();
    ctx.moveTo(0, my); ctx.lineTo(W, my);
    ctx.moveTo(mx, 0); ctx.lineTo(mx, H);
    ctx.strokeStyle = 'rgba(80,80,80,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Crosshair centre circle
  ctx.beginPath();
  ctx.arc(mx, my, 5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(80,80,80,0.9)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.stroke();

  // Small filled centre dot
  ctx.beginPath();
  ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(80,80,80,0.9)';
  ctx.fill();
}

