// ─── Sun Graph view ──────────────────────────────────────────────────────────
// Annual sun / twilight chart (à la timeanddate.com), in SOLAR TIME.
// - Year chart: twilight bands (night / astro / nautical / civil / daylight) at 75% opacity.
// - Bottom strip: the band sequence for ONE selected day at 100% opacity, with a centered label.
//   Source day = the day under the cursor when hovering the plot (orange marker → "SELECTED DATE"),
//   otherwise the Custom Path date (green marker → "CUSTOM DATE").
// The "sun hits paper" green areas come in a later phase; calibration stays editable for it.
//
// Sub-mode of Analyzer (analogous to theater): takes over the canvas area, keeps the
// calibration controls live, disables the Display section (not meaningful here).

let sunGraphActive = false;
let sgHoverDay = null;      // day-of-year under cursor while over the plot, else null → custom date
let _sgLayout  = null;      // {px0,py0,pw,ph,laneY,recapH} for cursor hit-testing

// Shows / hides + sizes the SUN GRAPH sub-toggle. Visible only in Analyzer; its width is
// matched to the ANALYZER button so it sits flush underneath.
function updateSunGraphButton() {
  const btn = document.getElementById('btnModeSunGraph');
  if (!btn) return;
  if (currentMode === 'analyzer') {
    btn.style.display = 'block';
    const btnA = document.getElementById('btnModeAnalyzer');
    if (btnA) btn.style.width = btnA.offsetWidth + 'px';
  } else {
    btn.style.display = 'none';
  }
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
  document.getElementById('statusWrap').style.display = 'none';   // info panel not relevant here
  setDisplaySectionEnabled(false);                               // Display off; Calibration stays live
  document.getElementById('btnModeSunGraph').classList.add('active');

  sunGraphActive = true;
  resizeSunGraph();
}

function exitSunGraph() {
  document.getElementById('sunGraphCanvas').style.display = 'none';
  document.getElementById('mainCanvas').style.pointerEvents = '';
  const btn = document.getElementById('btnModeSunGraph');
  if (btn) btn.classList.remove('active');
  sunGraphActive = false;

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

// Day-of-year → "JUL 15" (uppercase).
function _sgDoyLabel(doy) {
  let d = Math.max(1, Math.min(_DAYS_IN_YEAR, Math.round(doy)));
  for (let m = 0; m < 12; m++) {
    if (d <= DAYS_IN_MONTH[m]) return (MONTH_NAMES[m] + ' ' + d).toUpperCase();
    d -= DAYS_IN_MONTH[m];
  }
  return (MONTH_NAMES[11] + ' 31').toUpperCase();
}

function drawSunGraph() {
  const cv = document.getElementById('sunGraphCanvas');
  if (!cv) return;
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
  const recapH    = 30;   // reserved: per-day band strip + recap (cursor / custom date) — next phase
  const mB  = monthLblH + recapGap + recapH;
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

  // ── Gridlines (subtle, on top of bands) + axis labels ────────────────────────
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textBaseline = 'middle';
  for (let h = 0; h <= 24; h += 2) {
    const y = hourToY(h);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px0, y); ctx.lineTo(px0 + pw, y); ctx.stroke();
    ctx.fillStyle = pal.text; ctx.textAlign = 'right';
    ctx.fillText(String(h).padStart(2, '0'), px0 - 6, y);
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
  ctx.strokeStyle = pal.border; ctx.lineWidth = 1; ctx.strokeRect(px0, laneY, pw, recapH);

  // Centered date label — readable on any band (white fill + dark outline).
  const label = (sgHoverDay !== null)
    ? 'SELECTED DATE: ' + _sgDoyLabel(sgHoverDay)
    : 'CUSTOM DATE: ' + (MONTH_NAMES[customMonth - 1] + ' ' + customDay).toUpperCase();
  ctx.font = "bold 11px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(label, px0 + pw / 2, laneY + recapH / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, px0 + pw / 2, laneY + recapH / 2);

  // Title (uses current calibration latitude / hemisphere)
  const latStr = LAT.toFixed(1) + '° ' + (hemisphere >= 0 ? 'N' : 'S');
  ctx.fillStyle = pal.accent;
  ctx.font = "bold 14px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Sun Graph', mL, 26);
  ctx.fillStyle = pal.text; ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.fillText('solar time · Lat ' + latStr, mL + 96, 26);
}

// ── Wiring ───────────────────────────────────────────────────────────────────
document.getElementById('btnModeSunGraph').addEventListener('click', () => {
  if (sunGraphActive) exitSunGraph(); else enterSunGraph();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sunGraphActive) exitSunGraph();
});

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
