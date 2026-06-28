// ─── Sun Graph view ──────────────────────────────────────────────────────────
// Annual sun / twilight chart (à la timeanddate.com), in SOLAR TIME.
// - Year chart: twilight bands (night / astro / nautical / civil / daylight) at 75% opacity.
// - Bottom strip: the band sequence for ONE selected day at 100% opacity, with a centered label.
//   Source day = the day under the cursor when hovering the plot (orange marker → "SELECTED DATE"),
//   otherwise the Custom Path date (green marker → "CUSTOM DATE").
// - Sun-on-paper overlay: green = image lands on the paper, red (suppressed) = ray enters the can
//   but misses. Depends on calibration (kept editable); reuses sunRayState() from render-3d.js.
//
// Sub-mode of Analyzer (analogous to theater): takes over the canvas area, keeps the
// calibration controls live, disables the Display section (not meaningful here).

let sunGraphActive = false;
let sgHoverDay = null;      // day-of-year under cursor while over the plot, else null → custom date
let _sgLayout  = null;      // {px0,py0,pw,ph,laneY,recapH} for cursor hit-testing

// Shows / hides + sizes the 3D MODEL and SUN GRAPH sub-toggles (visible only in Analyzer),
// matching their widths to the GALLERY / ANALYZER buttons above, and reflecting the active view.
function updateViewButtons() {
  const sub = document.querySelector('.mode-subrow');
  const bT  = document.getElementById('btnModeTheater');
  const bS  = document.getElementById('btnModeSunGraph');
  if (!sub || !bT || !bS) return;
  if (currentMode === 'analyzer') {
    sub.style.display = 'flex';
    const bG = document.getElementById('btnModeGallery');
    const bA = document.getElementById('btnModeAnalyzer');
    if (bG) bT.style.width = bG.offsetWidth + 'px';   // 3D MODEL ↔ GALLERY width
    if (bA) bS.style.width = bA.offsetWidth + 'px';   // SUN GRAPH ↔ ANALYZER width
  } else {
    sub.style.display = 'none';
  }
  bT.classList.toggle('active', typeof theaterMode3D !== 'undefined' && theaterMode3D);
  bS.classList.toggle('active', sunGraphActive);
}

function enterSunGraph() {
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D) exitTheater3D();  // mutually exclusive takeovers

  const container  = document.getElementById('canvasContainer');
  const uploadZone = document.getElementById('uploadZone');
  // The chart is independent of any loaded scan → reveal the canvas area, hide upload zone.
  container.classList.remove('hidden');
  if (uploadZone) uploadZone.classList.add('hidden');

  document.getElementById('sunGraphCanvas').style.display = 'block';
  document.getElementById('mainCanvas').style.pointerEvents = 'none';
  document.getElementById('statusWrap').style.display = 'none';   // analyzer info panel hidden here
  document.getElementById('sgStatusWrap').style.display = 'flex'; // sun graph info panel (top-right)
  setDisplaySectionEnabled(false);                               // Display off; Calibration stays live

  sunGraphActive = true;
  if (typeof updateViewButtons === 'function') updateViewButtons();   // sync sub-toggle active states
  resizeSunGraph();
}

function exitSunGraph() {
  document.getElementById('sunGraphCanvas').style.display = 'none';
  document.getElementById('sgStatusWrap').style.display = 'none';
  document.getElementById('mainCanvas').style.pointerEvents = '';
  sunGraphActive = false;
  if (typeof updateViewButtons === 'function') updateViewButtons();

  if (currentMode === 'analyzer') {
    setDisplaySectionEnabled(true);
    document.getElementById('statusWrap').style.display = 'flex';
    // Restore the empty-state upload zone if no scan is loaded.
    if (!imgBitmap) {
      document.getElementById('uploadZone').classList.remove('hidden');
      document.getElementById('canvasContainer').classList.add('hidden');
    }
  }
}

function resizeSunGraph() {
  if (!sunGraphActive) return;
  const container = document.getElementById('canvasContainer');
  const cv = document.getElementById('sunGraphCanvas');
  const RES = Math.max(2, Math.ceil(window.devicePixelRatio || 1));   // crisp on HiDPI (see 25_1)
  const cw = container.clientWidth, ch = container.clientHeight;
  cv._res = RES;
  cv.width  = Math.round(cw * RES);
  cv.height = Math.round(ch * RES);
  // Canvas is a replaced element: position:absolute + inset:0 does NOT shrink it to the
  // container (it keeps its attribute size). Pin the CSS box explicitly so the supersampled
  // backing maps 1:1 to the container instead of overflowing (showing only the top-left).
  cv.style.width  = cw + 'px';
  cv.style.height = ch + 'px';
  drawSunGraph();
}

// Cumulative day-of-year for the first day of each month (index 0 = Jan 1 = doy 1).
function _monthStartDoy() {
  const starts = [];
  let acc = 1;
  for (let m = 0; m < 12; m++) { starts.push(acc); acc += DAYS_IN_MONTH[m]; }
  return starts;  // [1, 32, 60, ...]
}
const _DAYS_IN_YEAR = 365;

// Twilight altitude thresholds [deg]. Daylight edge includes refraction + semidiameter (−0.833°).
const _SG_THRESH = { day: -0.833, civil: -6, naut: -12, astro: -18 };
// Band colours (meaning-bearing → same in both themes; approx. timeanddate palette).
const _SG_BANDS = { night: '#1c2a35', astro: '#39505f', naut: '#5a7588', civil: '#9cbdd2', day: '#cfe8f6' };

// Half-width in hours (from solar noon) during which the sun is above altitude h [rad].
// 12 → sun never drops below h that day (band reaches midnight); 0 → sun never rises above h.
function _sgHalfWidth(hRad, sphi, cphi, sdelta, cdelta) {
  const X = (Math.sin(hRad) - sphi * sdelta) / (cphi * cdelta);
  if (X <= -1) return 12;
  if (X >=  1) return 0;
  return Math.acos(X) * (12 / Math.PI);   // hour-angle/15 = acos·(12/π)
}

// All four twilight half-widths (hours from solar noon) for a given day-of-year.
function _sgDayWidths(doy, sphi, cphi) {
  const dl = sunDeclination(doy), sd = Math.sin(dl), cd = Math.cos(dl), D2R = Math.PI / 180;
  return {
    day:   _sgHalfWidth(_SG_THRESH.day   * D2R, sphi, cphi, sd, cd),
    civ:   _sgHalfWidth(_SG_THRESH.civil * D2R, sphi, cphi, sd, cd),
    naut:  _sgHalfWidth(_SG_THRESH.naut  * D2R, sphi, cphi, sd, cd),
    astro: _sgHalfWidth(_SG_THRESH.astro * D2R, sphi, cphi, sd, cd),
  };
}

// Day-of-year → "Jul 15".
function _sgDoyMD(doy) {
  let d = Math.max(1, Math.min(_DAYS_IN_YEAR, Math.round(doy)));
  for (let m = 0; m < 12; m++) {
    if (d <= DAYS_IN_MONTH[m]) return MONTH_NAMES[m] + ' ' + d;
    d -= DAYS_IN_MONTH[m];
  }
  return MONTH_NAMES[11] + ' 31';
}
function _sgDoyLabel(doy) { return _sgDoyMD(doy).toUpperCase(); }   // "JUL 15" for the strip

// Hours (0–24) → "HH:MM".
function _sgHM(t) {
  let h = Math.floor(t), m = Math.round((t - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

// Fills the top-right info panel (DATE / SUNRISE-SUNSET / DAYLENGTH) for the active day.
// Solar time, signed-φ with real dates → matches the graph's daylight band exactly.
function updateSunGraphStatus() {
  const dEl = document.getElementById('sgDate');
  if (!dEl) return;
  const phi = effectiveLat() * hemisphere;
  const activeDay = (sgHoverDay !== null) ? sgHoverDay : dayOfYear(customMonth, customDay);
  const w = _sgDayWidths(activeDay, Math.sin(phi), Math.cos(phi)).day;   // daylight half-width [h]
  dEl.textContent = _sgDoyMD(activeDay);
  const rs = document.getElementById('sgRiseSet'), dl = document.getElementById('sgDayLen');
  if (w <= 0)       { rs.textContent = '—';  dl.textContent = '00:00'; }   // polar night
  else if (w >= 12) { rs.textContent = '—';  dl.textContent = '24:00'; }   // polar day
  else { rs.textContent = _sgHM(12 - w) + ' / ' + _sgHM(12 + w); dl.textContent = _sgHM(2 * w); }
  const op = document.getElementById('sgOnPaper');   // interval the image is on the paper (set by drawSunGraph)
  if (op) op.textContent = _sgFmtRange(_sgActiveOnPaper);
}

// ── Sun-on-paper overlay (green = image on paper, red = ray enters but misses) ──
// Reuses sunRayState(t, ctx) from render-3d.js (the same classifier the time-slider uses),
// generalised from the custom date to any day-of-year. State 2 = green, 1 = red, 0 = none.
const _SG_D2R   = Math.PI / 180;
const _SG_GREEN = 'rgba(80,220,120,0.45)';   // on paper – normal
const _SG_RED   = 'rgba(224,64,64,0.16)';    // enters but misses – suppressed
const _SG_GREEN_HI = 'rgba(80,220,120,0.80)';   // on paper, within the exposure interval – prominent
const _SG_RED_HI   = 'rgba(224,64,64,0.42)';    // enters but misses, within exposure – prominent
let _sgActiveOnPaper = null;                  // on-paper interval [t0,t1] for the active day (panel)

// sunRayState ctx for a real calendar day (signed-φ + real date; path branch uses the ±182-day
// SH shift, mirroring customArcDate). halfHmm / halfGap are calibration-only.
function _sgRayCtx(doy) {
  const pathDoy = (hemisphere >= 0) ? doy : (((doy - 1 + 182) % 365) + 1);
  return {
    delta:   sunDeclination(pathDoy),
    phi:     effectiveLat(),
    deltaS:  sunDeclination(doy),
    phiS:    effectiveLat() * hemisphere,
    // With a scan loaded use its real aspect; without one fall back to nominal paper aspect
    // (currentHalfHmm would otherwise use the default 300×150 canvas → wrong paper height).
    halfHmm: imgBitmap ? currentHalfHmm() : (scanWmm * PAPER_H / PAPER_W / 2),
    halfGap: (2 * Math.PI - Math.min(2 * Math.PI - 0.01, scanWmm / radius)) / 2,
  };
}

// Contiguous green (state 2) and red (state 1) intervals [t0,t1] (solar time) for one day.
function _sgDayRuns(doy, N) {
  const ctx  = _sgRayCtx(doy);
  const wDay = _sgHalfWidth(_SG_THRESH.day * _SG_D2R,
                            Math.sin(ctx.phiS), Math.cos(ctx.phiS),
                            Math.sin(ctx.deltaS), Math.cos(ctx.deltaS));
  const green = [], red = [];
  if (wDay <= 0) return { green, red, onPaper: null };      // polar night – nothing enters
  const tA = Math.max(0, 12 - wDay - 0.5), tB = Math.min(24, 12 + wDay + 0.5);
  const push = (st, a, b) => { if (st === 2) green.push([a, b]); else if (st === 1) red.push([a, b]); };
  let prev = sunRayState(tA, ctx), start = tA;
  for (let i = 1; i <= N; i++) {
    const t = tA + (tB - tA) * i / N;
    const st = sunRayState(t, ctx);
    if (st !== prev) { push(prev, start, t); prev = st; start = t; }
  }
  push(prev, start, tB);
  const onPaper = green.length ? [green[0][0], green[green.length - 1][1]] : null;
  return { green, red, onPaper };
}

// Year-wide green/red runs, cached — depend only on calibration + latitude (not hover / date).
let _sgYearRuns = null, _sgYearKey = '';
function _sgEnsureYearRuns() {
  const key = [LAT, hemisphere, yawDeg, pitchDeg, rollDeg, horizonMm, radius, scanWmm,
               canvas.width, canvas.height].join(',');
  if (key === _sgYearKey && _sgYearRuns) return _sgYearRuns;
  _sgYearKey  = key;
  _sgYearRuns = new Array(_DAYS_IN_YEAR + 1);
  for (let d = 1; d <= _DAYS_IN_YEAR; d++) _sgYearRuns[d] = _sgDayRuns(d, 120);  // coarser N over the year
  return _sgYearRuns;
}

function _sgFmtRange(iv) { return iv ? (_sgHM(iv[0]) + ' – ' + _sgHM(iv[1])) : '—'; }

function drawSunGraph() {
  const cv = document.getElementById('sunGraphCanvas');
  if (!cv) return;
  // Without a loaded scan, cy is undefined → azElToPixel().py = NaN → the on-paper (green) test
  // always fails. cx/cy/scale cancel out in sunRayState, so any finite cy works; use nominal.
  if (!isFinite(cy)) cy = IMG_H / 2;
  const RES = cv._res || 1;
  const ctx = cv.getContext('2d');
  const W = cv.width  / RES;          // logical size
  const H = cv.height / RES;
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const lt = document.body.classList.contains('light');
  const pal = lt ? {
    bg: '#ffffff', plot: '#eef2f6', grid: 'rgba(0,0,0,0.12)',
    border: 'rgba(0,0,0,0.30)', text: '#445a6e', accent: '#8a4400'
  } : {
    bg: '#07090d', plot: '#0b0f15', grid: 'rgba(255,255,255,0.10)',
    border: 'rgba(255,255,255,0.25)', text: '#9fb2c4', accent: '#e8a020'
  };

  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);

  // Layout — reserve a lane at the bottom for the future selected-day breakdown bar
  const mL = 46, mR = 18, mT = 44;
  const monthLblH = 20;   // month labels under the plot
  const recapGap  = 8;
  const recapH    = 30;   // selected-day strip
  const hourAxisH = 16;   // hour ruler (00–22) under the strip
  const mB  = monthLblH + recapGap + recapH + hourAxisH;
  const px0 = mL, py0 = mT, pw = Math.max(10, W - mL - mR), ph = Math.max(10, H - mT - mB);
  const laneY = py0 + ph + monthLblH + recapGap;   // top of the bottom strip
  _sgLayout = { px0, py0, pw, ph, laneY, recapH };  // for cursor hit-testing in mousemove

  ctx.fillStyle = pal.plot;
  ctx.fillRect(px0, py0, pw, ph);

  // Coordinate helpers — X = day of year (Jan→Dec), Y = hour (0 at bottom, 24 at top)
  const dayToX  = (doy)  => px0 + ((doy - 1) / _DAYS_IN_YEAR) * pw;
  const hourToY = (hour) => py0 + ph - (hour / 24) * ph;

  // ── Twilight bands (solar time, symmetric about solar noon) ──────────────────
  // Drawn as smooth filled "lenses" (one polygon per level) so there are no per-day seams.
  const phi  = effectiveLat() * hemisphere;   // signed latitude → correct annual pattern per hemisphere
  const sphi = Math.sin(phi), cphi = Math.cos(phi);
  const D2R  = Math.PI / 180;
  const NDAYS = _DAYS_IN_YEAR;

  // Precompute the sun's declination (sin/cos) for each day.
  const sdel = new Array(NDAYS + 1), cdel = new Array(NDAYS + 1);
  for (let d = 1; d <= NDAYS; d++) { const dl = sunDeclination(d); sdel[d] = Math.sin(dl); cdel[d] = Math.cos(dl); }

  // Bands at 75% opacity so the gridlines / axes remain visible through them.
  ctx.save();
  ctx.globalAlpha = 0.75;
  // Night fills the whole plot; nested twilight/day lenses overwrite toward noon.
  ctx.fillStyle = _SG_BANDS.night;
  ctx.fillRect(px0, py0, pw, ph);

  const levels = [
    { col: _SG_BANDS.astro, h: _SG_THRESH.astro * D2R },
    { col: _SG_BANDS.naut,  h: _SG_THRESH.naut  * D2R },
    { col: _SG_BANDS.civil, h: _SG_THRESH.civil * D2R },
    { col: _SG_BANDS.day,   h: _SG_THRESH.day   * D2R },
  ];
  for (const lv of levels) {
    const up = new Array(NDAYS + 1), lo = new Array(NDAYS + 1);
    for (let d = 1; d <= NDAYS; d++) {
      const wh = _sgHalfWidth(lv.h, sphi, cphi, sdel[d], cdel[d]);
      up[d] = hourToY(Math.min(24, 12 + wh));   // upper boundary (toward later hours / top)
      lo[d] = hourToY(Math.max(0,  12 - wh));   // lower boundary (toward earlier hours / bottom)
    }
    ctx.beginPath();
    ctx.moveTo(px0, up[1]);
    for (let d = 1; d <= NDAYS; d++) ctx.lineTo(dayToX(d), up[d]);
    ctx.lineTo(px0 + pw, up[NDAYS]);
    ctx.lineTo(px0 + pw, lo[NDAYS]);
    for (let d = NDAYS; d >= 1; d--) ctx.lineTo(dayToX(d), lo[d]);
    ctx.lineTo(px0, lo[1]);
    ctx.closePath();
    ctx.fillStyle = lv.col;
    ctx.fill();
  }
  ctx.restore();

  // ── Sun-on-paper overlay (green hits paper, red enters-but-misses) ────────────
  // Within the current gallery image's exposure interval the areas are drawn more prominently.
  // (No exposure for "load new image" uploads → uniform normal opacity, no boundaries.)
  const exp = (typeof currentExposure !== 'undefined') ? currentExposure : null;
  const inExp = exp
    ? (exp.startDoy <= exp.endDoy
        ? (d) => d >= exp.startDoy && d <= exp.endDoy
        : (d) => d >= exp.startDoy || d <= exp.endDoy)   // exposure wrapping across year-end
    : () => false;
  const yearRuns = _sgEnsureYearRuns();
  for (let d = 1; d <= NDAYS; d++) {
    const r = yearRuns[d]; if (!r) continue;
    const x0 = dayToX(d), w = Math.max(1, dayToX(d + 1) - x0 + 1);
    const hi = inExp(d);
    ctx.fillStyle = hi ? _SG_RED_HI : _SG_RED;
    for (const iv of r.red)   ctx.fillRect(x0, hourToY(Math.min(24, iv[1])), w, hourToY(iv[0]) - hourToY(Math.min(24, iv[1])));
    ctx.fillStyle = hi ? _SG_GREEN_HI : _SG_GREEN;
    for (const iv of r.green) ctx.fillRect(x0, hourToY(Math.min(24, iv[1])), w, hourToY(iv[0]) - hourToY(Math.min(24, iv[1])));
  }

  // ── Gridlines (subtle, on top of bands) + axis labels ────────────────────────
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textBaseline = 'middle';
  for (let h = 0; h <= 24; h += 2) {
    const y = hourToY(h);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px0, y); ctx.lineTo(px0 + pw, y); ctx.stroke();
    if (h < 24) {   // omit the "24" label (coincides with the top border)
      ctx.fillStyle = pal.text; ctx.textAlign = 'right';
      ctx.fillText(String(h).padStart(2, '0'), px0 - 6, y);
    }
  }
  const starts = _monthStartDoy();
  ctx.textBaseline = 'alphabetic';
  for (let m = 0; m < 12; m++) {
    const x = dayToX(starts[m]);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, py0 + ph); ctx.stroke();
    const nextDoy = (m < 11) ? starts[m + 1] : _DAYS_IN_YEAR + 1;
    ctx.fillStyle = pal.text; ctx.textAlign = 'center';
    ctx.fillText(MONTH_NAMES[m], dayToX((starts[m] + nextDoy) / 2), py0 + ph + 15);
  }

  // Solar noon line (flat at 12:00 in solar time)
  const yNoon = hourToY(12);
  ctx.strokeStyle = '#e04040'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px0, yNoon); ctx.lineTo(px0 + pw, yNoon); ctx.stroke();
  ctx.fillStyle = '#e04040'; ctx.font = "9px 'Share Tech Mono', monospace";
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('solar noon 12:00', px0 + pw - 4, yNoon - 2);

  // Plot border
  ctx.strokeStyle = pal.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(px0, py0, pw, ph);

  // ── Exposure interval boundaries: white verticals spanning only the daylight zone ─
  if (exp) {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    for (const doy of [exp.startDoy, exp.endDoy]) {
      const wd = _sgDayWidths(doy, sphi, cphi).day;   // daylight half-width [h]
      if (wd <= 0) continue;
      const x = dayToX(doy);
      ctx.beginPath();
      ctx.moveTo(x, hourToY(Math.min(24, 12 + wd)));
      ctx.lineTo(x, hourToY(Math.max(0, 12 - wd)));
      ctx.stroke();
    }
  }

  // ── Day markers in the plot ──────────────────────────────────────────────────
  const customDoy = dayOfYear(customMonth, customDay);
  // Green vertical line at the Custom Path date (always shown).
  {
    const x = dayToX(customDoy);
    ctx.strokeStyle = '#50dc78'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, py0 + ph); ctx.stroke();
  }
  // Semi-transparent orange line at the cursor-hovered day.
  if (sgHoverDay !== null) {
    const x = dayToX(sgHoverDay);
    ctx.strokeStyle = 'rgba(232,160,32,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, py0 + ph); ctx.stroke();
  }

  // ── Selected-day strip (100% opacity) + centered date label ───────────────────
  const activeDay = (sgHoverDay !== null) ? sgHoverDay : customDoy;
  const sw = _sgDayWidths(activeDay, sphi, cphi);
  const xh = (h) => px0 + (h / 24) * pw;            // strip x-axis = hours 0..24
  ctx.fillStyle = _SG_BANDS.night; ctx.fillRect(px0, laneY, pw, recapH);
  const seg = (col, wh) => {
    if (wh <= 0) return;
    const xl = xh(Math.max(0, 12 - wh)), xr = xh(Math.min(24, 12 + wh));
    ctx.fillStyle = col; ctx.fillRect(xl, laneY, xr - xl, recapH);
  };
  seg(_SG_BANDS.astro, sw.astro); seg(_SG_BANDS.naut, sw.naut);
  seg(_SG_BANDS.civil, sw.civ);   seg(_SG_BANDS.day,  sw.day);
  // Sun-on-paper overlay on the strip (green prominent, red suppressed); also feeds the panel.
  const activeRuns = _sgDayRuns(activeDay, 240);
  _sgActiveOnPaper = activeRuns.onPaper;
  const segGR = (col, ivs) => {
    ctx.fillStyle = col;
    for (const iv of ivs) { const xl = xh(Math.max(0, iv[0])), xr = xh(Math.min(24, iv[1])); ctx.fillRect(xl, laneY, xr - xl, recapH); }
  };
  segGR(_SG_RED, activeRuns.red); segGR(_SG_GREEN, activeRuns.green);
  ctx.strokeStyle = pal.border; ctx.lineWidth = 1; ctx.strokeRect(px0, laneY, pw, recapH);

  // Centered date label — readable on any band (white fill + dark outline).
  const label = (sgHoverDay !== null)
    ? 'SELECTED DATE: ' + _sgDoyLabel(sgHoverDay)
    : 'CUSTOM DATE: ' + (MONTH_NAMES[customMonth - 1] + ' ' + customDay).toUpperCase();
  ctx.font = "bold 11px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff8c00';   // saturated orange, no outline/shadow
  ctx.fillText(label, px0 + pw / 2, laneY + recapH / 2);

  // ── Hour axis under the strip (range 00–24, labels 00–22) ─────────────────────
  const axisY = laneY + recapH;
  ctx.strokeStyle = pal.grid; ctx.fillStyle = pal.text; ctx.lineWidth = 1;
  ctx.font = "9px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let h = 0; h <= 22; h += 2) {
    const x = xh(h);
    ctx.beginPath(); ctx.moveTo(x, axisY); ctx.lineTo(x, axisY + 3); ctx.stroke();
    ctx.fillText(String(h).padStart(2, '0'), x, axisY + 5);
  }

  // Title (uses current calibration latitude / hemisphere)
  const latStr = LAT.toFixed(1) + '° ' + (hemisphere >= 0 ? 'N' : 'S');
  ctx.fillStyle = pal.accent;
  ctx.font = "bold 14px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Sun Graph', mL, 26);
  ctx.fillStyle = pal.text; ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.fillText('solar time · Lat ' + latStr, mL + 96, 26);

  updateSunGraphStatus();   // keep the top-right info panel in sync with the active day
}

// ── Wiring ───────────────────────────────────────────────────────────────────
document.getElementById('btnModeSunGraph').addEventListener('click', () => {
  if (sunGraphActive) exitSunGraph(); else enterSunGraph();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sunGraphActive) exitSunGraph();
});

// Info-panel collapse (click panel or the ▲/▼ arrow) — mirrors the theaterStatus behaviour.
let sgStatusCollapsed = false;
function setSgStatusCollapsed(c) {
  sgStatusCollapsed = c;
  const w = document.getElementById('sgStatusWrap'), t = document.getElementById('sgStatusToggle');
  if (w) w.classList.toggle('collapsed', c);
  if (t) t.textContent = c ? '▼' : '▲';   // up = shown, down = hidden
}
(function () {
  const tog = document.getElementById('sgStatusToggle');
  const panel = document.getElementById('sgStatus');
  if (tog)   tog.addEventListener('click', (e) => { e.stopPropagation(); setSgStatusCollapsed(!sgStatusCollapsed); });
  if (panel) panel.addEventListener('click', () => setSgStatusCollapsed(true));
})();

// Cursor over the plot → that day is "selected" (orange marker + strip); off the plot → custom date.
(function () {
  const cv = document.getElementById('sunGraphCanvas');
  if (!cv) return;
  cv.addEventListener('mousemove', (e) => {
    if (!sunGraphActive || !_sgLayout) return;
    const r = cv.getBoundingClientRect();      // CSS box = logical size (see resizeSunGraph)
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const L = _sgLayout;
    let day = null;
    if (x >= L.px0 && x <= L.px0 + L.pw && y >= L.py0 && y <= L.py0 + L.ph) {
      day = Math.max(1, Math.min(_DAYS_IN_YEAR, Math.round(1 + (x - L.px0) / L.pw * _DAYS_IN_YEAR)));
    }
    if (day !== sgHoverDay) { sgHoverDay = day; drawSunGraph(); }
  });
  cv.addEventListener('mouseleave', () => {
    if (sgHoverDay !== null) { sgHoverDay = null; drawSunGraph(); }
  });
})();

// Redraw the chart when the canvas area resizes (window / panel changes).
(function () {
  const container = document.getElementById('canvasContainer');
  if (container && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (sunGraphActive) resizeSunGraph(); }).observe(container);
  }
})();
