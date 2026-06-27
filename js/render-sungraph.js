// ─── Sun Graph view ──────────────────────────────────────────────────────────
// Annual sun / twilight chart (à la timeanddate.com), in SOLAR TIME.
// Phase 1 (26_1): skeleton only — frame, month axis, hour axis, gridlines, title.
// The twilight bands and the "sun hits paper" green areas come in later phases;
// calibration stays editable because those areas depend on it.
//
// Sub-mode of Analyzer (analogous to theater): takes over the canvas area, keeps the
// calibration controls live, disables the Display section (not meaningful here).

let sunGraphActive = false;

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

  // Plot area
  const mL = 46, mR = 18, mT = 44, mB = 30;
  const px0 = mL, py0 = mT, pw = Math.max(10, W - mL - mR), ph = Math.max(10, H - mT - mB);

  ctx.fillStyle = pal.plot;
  ctx.fillRect(px0, py0, pw, ph);

  // Coordinate helpers — X = day of year (Jan→Dec), Y = hour (0 at bottom, 24 at top)
  const dayToX  = (doy)  => px0 + ((doy - 1) / _DAYS_IN_YEAR) * pw;
  const hourToY = (hour) => py0 + ph - (hour / 24) * ph;

  // Horizontal gridlines + hour labels every 2 h
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textBaseline = 'middle';
  for (let h = 0; h <= 24; h += 2) {
    const y = hourToY(h);
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px0, y); ctx.lineTo(px0 + pw, y); ctx.stroke();
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'right';
    ctx.fillText(String(h).padStart(2, '0'), px0 - 6, y);
  }

  // Vertical gridlines at month starts + centered month labels
  const starts = _monthStartDoy();
  ctx.textBaseline = 'alphabetic';
  for (let m = 0; m < 12; m++) {
    const x = dayToX(starts[m]);
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, py0 + ph); ctx.stroke();
    // label centered in the month band
    const nextDoy = (m < 11) ? starts[m + 1] : _DAYS_IN_YEAR + 1;
    const xMid = dayToX((starts[m] + nextDoy) / 2);
    ctx.fillStyle = pal.text;
    ctx.textAlign = 'center';
    ctx.fillText(MONTH_NAMES[m], xMid, py0 + ph + 18);
  }

  // Plot border
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px0, py0, pw, ph);

  // Title (uses current calibration latitude / hemisphere)
  const latStr = LAT.toFixed(1) + '° ' + (hemisphere >= 0 ? 'N' : 'S');
  ctx.fillStyle = pal.accent;
  ctx.font = "bold 14px 'Share Tech Mono', monospace";
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Sun Graph', mL, 26);
  ctx.fillStyle = pal.text;
  ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.fillText('solar time · Lat ' + latStr, mL + 96, 26);

  // Skeleton placeholder note (removed once bands are implemented)
  ctx.fillStyle = pal.text;
  ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.5;
  ctx.fillText('— twilight bands & sun-on-paper areas: next phase —', px0 + pw / 2, py0 + ph / 2);
  ctx.globalAlpha = 1;
}

// ── Wiring ───────────────────────────────────────────────────────────────────
document.getElementById('btnModeSunGraph').addEventListener('click', () => {
  if (sunGraphActive) exitSunGraph(); else enterSunGraph();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sunGraphActive) exitSunGraph();
});

// Redraw the chart when the canvas area resizes (window / panel changes).
(function () {
  const container = document.getElementById('canvasContainer');
  if (container && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (sunGraphActive) resizeSunGraph(); }).observe(container);
  }
})();
