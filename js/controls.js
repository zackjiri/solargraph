// ─── Event listeners ───────────────────────────────────────────────────────
container.addEventListener('mousemove', (e) => {
  if (splitActive) return;
  if (theaterMode3D) return;  // theater mode: no readout, no crosshair

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvasLW / rect.width;   // map to logical px (not the super-res backing store)
  const scaleY = canvasLH / rect.height;
  mouseX = (e.clientX - rect.left) * scaleX;
  mouseY = (e.clientY - rect.top) * scaleY;

  const { beta_deg, theta_deg, azimut_world } = pixelToAzEl(mouseX, mouseY);

  // Valid for any canvas pixel (full-sphere projection)
  const inRange = Math.abs(beta_deg) < 180;

  // Southern hemisphere: shift azimuth reference from south (180°) to north (0°)
  const displayAz = hemisphere >= 0
    ? azimut_world
    : (azimut_world + 180) % 360;

  // Inverse solar: use raw world azimuth (before hemisphere display shift)
  const sol = inRange && theta_deg >= 0
    ? inverseSolar(azimut_world, theta_deg, effectiveLat())
    : null;

  document.getElementById('valAz').textContent  = inRange ? displayAz.toFixed(1) + '°' : '—';
  document.getElementById('valAlt').textContent  = inRange ? (theta_deg >= 0 ? '+' : '') + theta_deg.toFixed(1) + '°' : '—';
  document.getElementById('valDay').textContent  = sol ? sol.day1 + ' / ' + sol.day2 : '—';
  document.getElementById('valTime').textContent = sol ? sol.time : '—';
  document.getElementById('valDir').textContent  = inRange ? azimutToDir(displayAz) : '—';

  draw();
});

container.addEventListener('mouseleave', () => {
  if (splitActive) return;
  mouseX = -1; mouseY = -1;
  document.getElementById('valAz').textContent  = '—';
  document.getElementById('valAlt').textContent  = '—';
  document.getElementById('valDay').textContent  = '—';
  document.getElementById('valTime').textContent = '—';
  document.getElementById('valDir').textContent  = '—';
  draw();
});

document.getElementById('chkSunArc').addEventListener('change', (e) => {
  showSunArc = e.target.checked; draw();
});

document.getElementById('btnHeatmap').addEventListener('click', () => {
  showHeatmap = !showHeatmap;
  const btn = document.getElementById('btnHeatmap');
  if (showHeatmap) {
    btn.textContent = 'Hide Isolines';
    btn.classList.add('active');
  } else {
    btn.textContent = 'Show Isolines';
    btn.classList.remove('active');
  }
  draw();
});

document.getElementById('chkGrid').addEventListener('change', (e) => {
  showGrid = e.target.checked; draw();
});
document.getElementById('chkLabels').addEventListener('change', (e) => {
  showLabels = e.target.checked; draw();
});
document.getElementById('chkHorizon').addEventListener('change', (e) => {
  showHorizon = e.target.checked; draw();
});

document.getElementById('rngYaw').addEventListener('input', (e) => {
  yawDeg = parseFloat(e.target.value);
  document.getElementById('lblYaw').textContent = (yawDeg >= 0 ? '+' : '') + yawDeg.toFixed(1) + '°';
  draw(); draw3D();
});

document.getElementById('rngPitch').addEventListener('input', (e) => {
  pitchDeg = parseFloat(e.target.value);
  document.getElementById('lblPitch').textContent = (pitchDeg >= 0 ? '+' : '') + pitchDeg.toFixed(1) + '°';
  draw(); draw3D();
});

document.getElementById('rngRoll').addEventListener('input', (e) => {
  rollDeg = parseFloat(e.target.value);
  document.getElementById('lblRoll').textContent = (rollDeg >= 0 ? '+' : '') + rollDeg.toFixed(1) + '°';
  draw(); draw3D();
});

document.getElementById('rngHScale').addEventListener('input', (e) => {
  radius = parseFloat(e.target.value);
  hScale = radius / R;
  document.getElementById('lblHScale').textContent = radius.toFixed(1) + ' mm';
  refreshCalibLimits();   // radius must not drop below scanWmm/(2π); also syncs horizon
  draw(); draw3D();
});

document.getElementById('rngHorizon').addEventListener('input', (e) => {
  const hLim = currentHalfHmm();   // pinhole must stay inside the can
  horizonMm = Math.max(-hLim, Math.min(hLim, parseFloat(e.target.value)));
  document.getElementById('rngHorizon').value = horizonMm;
  document.getElementById('lblHorizon').textContent = (horizonMm >= 0 ? '+' : '') + horizonMm.toFixed(1) + ' mm';
  draw(); draw3D();
});

function doCalibReset() {
  // 1. Reset ALL global state first – no draw call until everything is in final state
  yawDeg = 0; pitchDeg = 0; rollDeg = 0; radius = 33; hScale = 1.0; horizonMm = 0;
  scanWmm = 178;
  if (canvasLW > 0) scale = canvasLW / scanWmm;
  LAT = 50.0;
  hemisphere = 1;

  // 2. Update ALL UI elements in one pass (sliders, labels, lat input, N/S buttons)
  document.getElementById('inpScanW').value = 178;
  document.getElementById('rngYaw').value      = 0;
  document.getElementById('rngPitch').value    = 0;
  document.getElementById('rngRoll').value     = 0;
  document.getElementById('rngHScale').value   = 33;
  document.getElementById('rngHorizon').value  = 0;
  document.getElementById('lblYaw').textContent     = '+0.0°';
  document.getElementById('lblPitch').textContent   = '+0.0°';
  document.getElementById('lblRoll').textContent    = '+0.0°';
  document.getElementById('lblHScale').textContent  = '33.0 mm';
  document.getElementById('lblHorizon').textContent = '+0.0 mm';
  document.getElementById('inpLat').value       = '50.0';
  document.getElementById('btnN').disabled = false;
  document.getElementById('btnS').disabled = false;
  document.getElementById('btnN').className = 'ns-btn active';
  document.getElementById('btnS').className = 'ns-btn';

  // 3. Single draw with ALL values in their final state
  updateScanH();
  refreshCalibLimits();
  draw(); draw3D();
}
document.getElementById('btnCalibReset').addEventListener('click', doCalibReset);

// ─── Preset import / export ───────────────────────────────────────────────
function setPresetButtonsEnabled(enabled) {
  const btnImp = document.getElementById('btnImportPreset');
  const btnExp = document.getElementById('btnExportPreset');
  btnImp.disabled = !enabled;
  btnExp.disabled = !enabled;
  btnImp.style.opacity = enabled ? '1' : '0.35';
  btnExp.style.opacity = enabled ? '1' : '0.35';
}

function exportPreset() {
  const preset = {
    yaw_deg:    yawDeg,
    pitch_deg:  pitchDeg,
    roll_deg:   rollDeg,
    horizon_mm: horizonMm,
    radius_mm:  radius,
    scan_w_mm:  scanWmm,
    latitude:   LAT,
    hemisphere: hemisphere >= 0 ? 'N' : 'S'
  };
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'preset.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importPreset(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let preset;
    try {
      preset = JSON.parse(e.target.result);
    } catch {
      alert('Invalid preset file – could not parse JSON.');
      return;
    }

    // Validate required fields and value ranges
    const checks = [
      typeof preset.yaw_deg    === 'number' && preset.yaw_deg    >= -120 && preset.yaw_deg    <= 120,
      typeof preset.pitch_deg  === 'number' && preset.pitch_deg  >= -45  && preset.pitch_deg  <= 45,
      typeof preset.roll_deg   === 'number' && preset.roll_deg   >= -10  && preset.roll_deg   <= 10,
      typeof preset.horizon_mm === 'number' && preset.horizon_mm >= -50  && preset.horizon_mm <= 50,
      typeof preset.radius_mm  === 'number' && preset.radius_mm  >= 10  && preset.radius_mm  <= 80,
      typeof preset.latitude   === 'number' && preset.latitude   >= 0   && preset.latitude   <= 90,
      preset.hemisphere === 'N' || preset.hemisphere === 'S'
    ];
    if (checks.some(c => !c)) {
      alert('Invalid preset file – values out of range or missing fields.');
      return;
    }

    // Apply calibration
    yawDeg    = preset.yaw_deg;
    pitchDeg  = preset.pitch_deg;
    rollDeg   = preset.roll_deg;
    horizonMm = preset.horizon_mm;
    radius     = preset.radius_mm;
    hScale     = radius / R;
    applyScanW(preset.scan_w_mm ?? 178);
    document.getElementById('rngYaw').value   = yawDeg;
    document.getElementById('rngPitch').value   = pitchDeg;
    document.getElementById('rngRoll').value = rollDeg;
    document.getElementById('rngHorizon').value = horizonMm;
    document.getElementById('rngHScale').value     = radius;
    document.getElementById('lblYaw').textContent   = (yawDeg   >= 0 ? '+' : '') + yawDeg.toFixed(1)   + '°';
    document.getElementById('lblPitch').textContent   = (pitchDeg   >= 0 ? '+' : '') + pitchDeg.toFixed(1)   + '°';
    document.getElementById('lblRoll').textContent = (rollDeg >= 0 ? '+' : '') + rollDeg.toFixed(1) + '°';
    document.getElementById('lblHorizon').textContent = (horizonMm >= 0 ? '+' : '') + horizonMm.toFixed(1) + ' mm';
    document.getElementById('lblHScale').textContent     = radius.toFixed(1) + ' mm';

    // Apply location
    applyLat(preset.latitude);
    hemisphere = preset.hemisphere === 'S' ? -1 : 1;
    document.getElementById('btnN').className = hemisphere >= 0 ? 'ns-btn active'   : 'ns-btn';
    document.getElementById('btnS').className = hemisphere <  0 ? 'ns-btn active-s' : 'ns-btn';

    refreshCalibLimits();
    draw(); draw3D();
  };
  reader.readAsText(file);
}

document.getElementById('btnExportPreset').addEventListener('click', exportPreset);

document.getElementById('btnImportPreset').addEventListener('click', () => {
  document.getElementById('presetFileInput').click();
});

document.getElementById('presetFileInput').addEventListener('change', (e) => {
  if (e.target.files[0]) importPreset(e.target.files[0]);
  e.target.value = ''; // reset so same file can be re-imported
});

// ─── Latitude control ──────────────────────────────────────────────────────
function applyLat(val) {
  // Round to 1 decimal place, clamp 0–90
  LAT = Math.round(Math.max(0, Math.min(90, val)) * 10) / 10;
  document.getElementById('inpLat').value = LAT.toFixed(1);

  const atEquator = LAT === 0;
  document.getElementById('btnN').disabled = atEquator;
  document.getElementById('btnS').disabled = atEquator;
  if (atEquator) {
    hemisphere = 1;
    document.getElementById('btnN').className = 'ns-btn active';
    document.getElementById('btnS').className = 'ns-btn';
  }
  draw(); draw3D();
}

document.getElementById('inpLat').addEventListener('change', (e) => {
  applyLat(parseFloat(e.target.value) || 0);
});
document.getElementById('inpLat').addEventListener('blur', (e) => {
  applyLat(parseFloat(e.target.value) || 0);
});
document.getElementById('inpLat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyLat(parseFloat(e.target.value) || 0);
});
document.getElementById('btnLatDec').addEventListener('click', () => {
  applyLat(LAT - 0.1);
});
document.getElementById('btnLatInc').addEventListener('click', () => {
  applyLat(LAT + 0.1);
});
document.getElementById('btnN').addEventListener('click', () => {
  if (LAT === 0) return;
  hemisphere = 1;
  document.getElementById('btnN').className = 'ns-btn active';
  document.getElementById('btnS').className = 'ns-btn';
  draw(); draw3D();
});
document.getElementById('btnS').addEventListener('click', () => {
  if (LAT === 0) return;
  hemisphere = -1;
  document.getElementById('btnN').className = 'ns-btn';
  document.getElementById('btnS').className = 'ns-btn active-s';
  draw(); draw3D();
});

// ─── Dimension limits (validation: scan width ⇄ radius ⇄ horizon) ───────────
const TWO_PI = 2 * Math.PI;

// Half paper height [mm] from the current scan aspect ratio (same as draw3D)
function currentHalfHmm() {
  return canvas.width > 0
    ? scanWmm * canvas.height / canvas.width / 2
    : scanWmm * PAPER_H / PAPER_W / 2;
}

// Syncs the limits of all three calibration controls and clamps the current values.
//  • scan width ≤ circumference (2π·r)  → paper wrap does not exceed 360°
//  • radius     ≥ scanWmm/(2π)          → the same constraint from the other side
//  • |horizon|  ≤ half-height           → pinhole stays inside the can
function refreshCalibLimits() {
  const inpW = document.getElementById('inpScanW');
  const rngR = document.getElementById('rngHScale');
  const rngH = document.getElementById('rngHorizon');

  // 1) radius vs. scan width (handled first – this prevents unwanted paper shortening
  //    when shrinking the radius; the radius stops at its minimum instead)
  const rMin = Math.max(15, Math.ceil(scanWmm / TWO_PI * 2) / 2);
  if (rngR) rngR.min = rMin;
  if (radius < rMin) {
    radius = rMin; hScale = radius / R;
    if (rngR) rngR.value = radius;
    const l = document.getElementById('lblHScale');
    if (l) l.textContent = radius.toFixed(1) + ' mm';
  }

  // 2) scan width vs. circumference (after the radius step wMax ≥ scanWmm, so the
  //    scan width is shortened only if it was directly raised above the circumference in applyScanW)
  const wMax = Math.min(300, Math.floor(TWO_PI * radius));
  if (inpW) inpW.max = wMax;
  if (scanWmm > wMax) {
    scanWmm = wMax;
    if (inpW) inpW.value = scanWmm;
    if (canvasLW > 0) scale = canvasLW / scanWmm;
    updateScanH();
  }

  // 3) horizon vs. half paper height
  const hLim = Math.max(0, Math.floor(currentHalfHmm() * 2) / 2);
  if (rngH) { rngH.min = -hLim; rngH.max = hLim; }
  if (horizonMm >  hLim) horizonMm =  hLim;
  if (horizonMm < -hLim) horizonMm = -hLim;
  if (rngH) rngH.value = horizonMm;
  const lh = document.getElementById('lblHorizon');
  if (lh) lh.textContent = (horizonMm >= 0 ? '+' : '') + horizonMm.toFixed(1) + ' mm';
}

// ─── Scan width control ───────────────────────────────────────────────────
function applyScanW(val) {
  scanWmm = Math.round(Math.max(80, Math.min(300, val)));
  // limit: paper does not exceed the can circumference (max 360° wrap)
  scanWmm = Math.min(scanWmm, Math.floor(TWO_PI * radius));
  document.getElementById('inpScanW').value = scanWmm;
  updateScanH();
  refreshCalibLimits();   // recomputes the radius minimum and the horizon range
  if (canvasLW > 0) {
    scale = canvasLW / scanWmm;
    draw(); draw3D();
  }
}
document.getElementById('inpScanW').addEventListener('change', (e) => {
  applyScanW(parseInt(e.target.value) || 178);
});
document.getElementById('inpScanW').addEventListener('blur', (e) => {
  applyScanW(parseInt(e.target.value) || 178);
});
document.getElementById('inpScanW').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyScanW(parseInt(e.target.value) || 178);
});
document.getElementById('btnScanWDec').addEventListener('click', () => applyScanW(scanWmm - 1));
document.getElementById('btnScanWInc').addEventListener('click', () => applyScanW(scanWmm + 1));

function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // Normalise: longer side = 1280 px
    let w, h;
    if (img.width >= img.height) {
      w = IMG_W;
      h = Math.round(img.height * IMG_W / img.width);
    } else {
      h = IMG_W;
      w = Math.round(img.width * IMG_W / img.height);
    }

    createImageBitmap(img, { resizeWidth: w, resizeHeight: h })
      .then(bm => {
        imgBitmap = bm;
        document.getElementById('uploadZone').classList.add('hidden');
        document.getElementById('canvasContainer').classList.remove('hidden');
        setPresetButtonsEnabled(true);
        // Let layout settle then resize
        requestAnimationFrame(() => resizeCanvas());
        URL.revokeObjectURL(url);
      });
  };
  img.src = url;
}

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadImage(e.target.files[0]);
});
uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.style.borderColor = 'var(--accent)'; });
uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = 'var(--border)'; });
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.style.borderColor = 'var(--border)';
  if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
});

document.getElementById('btnReset').addEventListener('click', () => {
  imgBitmap = null;
  mouseX = -1; mouseY = -1;
  document.getElementById('uploadZone').classList.remove('hidden');
  document.getElementById('canvasContainer').classList.add('hidden');
  setPresetButtonsEnabled(false);
  fileInput.value = '';
  doCalibReset();
});

// Custom arc date – shift by 182 days for southern hemisphere
function customArcDate() {
  if (hemisphere >= 0) return { month: customMonth, day: customDay };
  const doy = dayOfYear(customMonth, customDay);
  const shifted = ((doy - 1 + 182) % 365) + 1;
  const months = [31,28,31,30,31,30,31,31,30,31,30,31];
  let m = 0, d = shifted;
  while (d > months[m]) { d -= months[m]; m++; }
  return { month: m + 1, day: d };
}
function resizeCanvas() {
  if (!imgBitmap) return;
  const container = document.getElementById('canvasContainer');
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const imgRatio = imgBitmap.width / imgBitmap.height;
  const conRatio = cw / ch;
  let w, h;
  if (imgRatio > conRatio) { w = cw; h = Math.round(cw / imgRatio); }
  else { h = ch; w = Math.round(ch * imgRatio); }
  setupCanvas(w, h);
  draw();
}

new ResizeObserver(() => { if (imgBitmap) resizeCanvas(); })
  .observe(document.getElementById('canvasContainer'));

// ─── Custom arc ────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS_IN_MONTH = [31,28,31,30,31,30,31,31,30,31,30,31];
let customMonth = 7; // 1-based, default July
let customDay = 20;
let showCustomArc = false;
let show3DCulmination = false;
let show3DCladding    = true;  // cylinder cladding – on by default
let _wavePhase        = 0;     // ms timestamp driving the hourly-arrow "Mexican wave"
let sunWaveRAF        = null;  // requestAnimationFrame handle for the wave loop
let sunTimeHours      = 12;    // current solar time of the animated sun ray (default = noon)
let sunAnimActive     = false; // day animation playing?
let sunAnimStart      = null;  // ms timestamp captured on the first frame after Play
let sunAnimOffset     = 0;     // seconds into the cycle to resume from (Play continues from Stop)
let _sunEnterT0       = 12;    // solar time when the ray starts entering the can (slider boundary)
let _sunEnterT1       = 12;    // solar time when the ray stops entering the can
const SUN_RATE_HPS    = 0.5;   // animation speed: hours of solar time per real second

function updateDateLabels() {
  document.getElementById('lblMonth').textContent = MONTHS[customMonth - 1];
  document.getElementById('lblDay').textContent = customDay;
}

document.getElementById('btnMonDec').addEventListener('click', () => {
  customMonth = customMonth > 1 ? customMonth - 1 : 12;
  customDay = Math.min(customDay, DAYS_IN_MONTH[customMonth - 1]);
  updateDateLabels(); if (show3DCulmination) refreshSunTimeRange(); draw(); if (show3DCulmination) draw3D();
});
document.getElementById('btnMonInc').addEventListener('click', () => {
  customMonth = customMonth < 12 ? customMonth + 1 : 1;
  customDay = Math.min(customDay, DAYS_IN_MONTH[customMonth - 1]);
  updateDateLabels(); if (show3DCulmination) refreshSunTimeRange(); draw(); if (show3DCulmination) draw3D();
});
document.getElementById('btnDayDec').addEventListener('click', () => {
  if (customDay > 1) {
    customDay--;
  } else {
    // move to the previous month (wrapping)
    customMonth = customMonth > 1 ? customMonth - 1 : 12;
    customDay   = DAYS_IN_MONTH[customMonth - 1];
  }
  updateDateLabels(); if (show3DCulmination) refreshSunTimeRange(); draw(); if (show3DCulmination) draw3D();
});
document.getElementById('btnDayInc').addEventListener('click', () => {
  if (customDay < DAYS_IN_MONTH[customMonth - 1]) {
    customDay++;
  } else {
    // move to the next month (wrapping)
    customMonth = customMonth < 12 ? customMonth + 1 : 1;
    customDay   = 1;
  }
  updateDateLabels(); if (show3DCulmination) refreshSunTimeRange(); draw(); if (show3DCulmination) draw3D();
});
document.getElementById('chkCustomArc').addEventListener('change', (e) => {
  showCustomArc = e.target.checked; updateSunAnimCtl(); draw(); updateSunWave();
});
function updateAxisLegend() {
  const sym = document.getElementById('legAxisSym');
  const lbl = document.getElementById('legAxisLbl');
  if (!sym || !lbl) return;
  const _isLight = document.body.classList.contains('light');
  if (show3DCulmination) {
    sym.style.color = '#e8a020';   // semantic color, same in both themes
    lbl.textContent = 'optical axis (Sun)';
  } else {
    sym.style.color = _isLight ? '#111111' : '#d8e8f8';
    lbl.textContent = 'optical axis';
  }
  // sync noon button visual state
  const noonBtn  = document.getElementById('btnNoon');
  const noonIcon = document.getElementById('noonChkIcon');
  const noonChk  = document.getElementById('chk3DCulmination');
  if (noonBtn)  noonBtn.classList.toggle('active', show3DCulmination);
  if (noonIcon) noonIcon.textContent = show3DCulmination ? '☑' : '☐';
  if (noonChk)  noonChk.checked = show3DCulmination;
}
// Noon button click – toggles show3DCulmination directly (checkbox is visual-only)
document.getElementById('btnNoon').addEventListener('click', () => {
  show3DCulmination = !show3DCulmination;
  if (show3DCulmination) sunTimeHours = 12;   // fresh start at noon when turning Sun path on
  updateAxisLegend(); updateSunAnimCtl(); draw3D(); updateSunWave();
});

// Day-animation controls: play/stop button + solar-time slider
document.getElementById('btnSunPlay').addEventListener('click', () => {
  if (sunAnimActive) stopSunAnim(); else startSunAnim();
});
document.getElementById('rngSunTime').addEventListener('input', (e) => {
  if (sunAnimActive) stopSunAnim();            // manual scrub stops the loop
  // Only the entering interval (green + red, between the white lines) is clickable
  sunTimeHours = Math.max(_sunEnterT0, Math.min(_sunEnterT1, parseFloat(e.target.value)));
  syncSunTimeUI();
  draw(); draw3D();                            // 2D sun dot + 3D ray
});

// ─── Opacity label ──────────────────────────────────────────────────────────
document.getElementById('rngOpacity').addEventListener('input', (e) => {
  dispOpacity = e.target.value / 100;
  document.getElementById('lblOpacity').textContent = e.target.value + '%';
  draw();
});

// ─── L2 split opacity ───────────────────────────────────────────────────────
document.getElementById('rngL2Opacity').addEventListener('input', (e) => {
  if (l2LoopActive) return;            // ignore manual input while looping
  splitOpacity = e.target.value / 100;
  document.getElementById('lblL2Opacity').textContent = e.target.value + '%';
  draw();
});

// ─── L2 opacity auto-loop (Play / Stop) ──────────────────────────────────────
const L2_PLAY_SVG = '<svg width="11" height="11" viewBox="0 0 14 14" fill="currentColor"><polygon points="3,2 12,7 3,12"/></svg>';
const L2_STOP_SVG = '<svg width="11" height="11" viewBox="0 0 14 14" fill="currentColor"><rect x="3" y="3" width="8" height="8"/></svg>';
const L2_LOOP_MS  = 10000;             // one full 100→0→100 cycle

let l2LoopActive  = false;
let l2LoopRAF     = null;
let l2LoopStart   = 0;
let l2PhaseOffset = 0;          // entry phase on the descending leg

function setL2PlayIcon(playing) {
  document.getElementById('l2PlayIcon').innerHTML = playing ? L2_STOP_SVG : L2_PLAY_SVG;
  document.getElementById('btnL2Play').classList.toggle('playing', playing);
}

function l2LoopFrame(ts) {
  if (!l2LoopActive) return;
  if (!l2LoopStart) l2LoopStart = ts;
  // Constant speed: full 100→0→100 loop always takes L2_LOOP_MS.
  // Start phase is offset so the loop begins at the current opacity, descending.
  const phase = (l2PhaseOffset + (ts - l2LoopStart) / L2_LOOP_MS) % 1;   // 0..1
  const v = phase < 0.5 ? (1 - phase * 2) : (phase * 2 - 1);             // 1→0→1
  splitOpacity = v;
  const pct = Math.round(v * 100);
  document.getElementById('rngL2Opacity').value     = pct;
  document.getElementById('lblL2Opacity').textContent = pct + '%';
  draw();
  l2LoopRAF = requestAnimationFrame(l2LoopFrame);
}

function startL2Loop() {
  if (l2LoopActive || !splitActive) return;
  l2LoopActive = true;
  l2LoopStart  = 0;
  // Map current opacity onto the descending leg: v = 1 − 2·phase  →  phase = (1 − v)/2
  l2PhaseOffset = (1 - splitOpacity) / 2;
  document.getElementById('rngL2Opacity').disabled = true;
  setL2PlayIcon(true);
  l2LoopRAF = requestAnimationFrame(l2LoopFrame);
}

function stopL2Loop() {
  if (!l2LoopActive) return;
  l2LoopActive = false;
  if (l2LoopRAF) cancelAnimationFrame(l2LoopRAF);
  l2LoopRAF = null;
  document.getElementById('rngL2Opacity').disabled = false;
  setL2PlayIcon(false);
  // splitOpacity is left at its current value
}

setL2PlayIcon(false);   // initial icon
document.getElementById('btnL2Play').addEventListener('click', () => {
  l2LoopActive ? stopL2Loop() : startL2Loop();
});

// ─── Gallery management ──────────────────────────────────────────────────────
let FILELIST = null;
let PRESETS  = null;
let galleryState = { genId: null, imageIndex: null, layer: 0 };

async function loadFilelist() {
  try {
    const [flRes, prRes] = await Promise.all([
      fetch('filelist.json'),
      fetch('presets.json')
    ]);
    FILELIST = await flRes.json();
    PRESETS  = await prRes.json();
    buildGenGroup();
  } catch (e) {
    console.warn('Error loading gallery data:', e);
  }
}

function applyGalleryPreset(genId, imageIndex) {
  const key = `GEN-${genId}_${imageIndex}`;
  const preset = PRESETS ? PRESETS[key] : null;
  if (!preset) return;

  yawDeg    = preset.yaw_deg    ?? 0;
  pitchDeg  = preset.pitch_deg  ?? 0;
  rollDeg   = preset.roll_deg   ?? 0;
  horizonMm = preset.horizon_mm ?? 0;
  radius     = preset.radius_mm ?? 33;
  hScale     = radius / R;
  applyScanW(preset.scan_w_mm ?? 178);

  document.getElementById('rngYaw').value   = yawDeg;
  document.getElementById('rngPitch').value   = pitchDeg;
  document.getElementById('rngRoll').value = rollDeg;
  document.getElementById('rngHorizon').value = horizonMm;
  document.getElementById('rngHScale').value     = radius;
  document.getElementById('lblYaw').textContent   = (yawDeg   >= 0 ? '+' : '') + yawDeg.toFixed(1)   + '°';
  document.getElementById('lblPitch').textContent   = (pitchDeg   >= 0 ? '+' : '') + pitchDeg.toFixed(1)   + '°';
  document.getElementById('lblRoll').textContent = (rollDeg >= 0 ? '+' : '') + rollDeg.toFixed(1) + '°';
  document.getElementById('lblHorizon').textContent = (horizonMm >= 0 ? '+' : '') + horizonMm.toFixed(1) + ' mm';
  document.getElementById('lblHScale').textContent     = radius.toFixed(1) + ' mm';

  if (preset.latitude !== undefined) applyLat(preset.latitude);
  if (preset.hemisphere) {
    hemisphere = preset.hemisphere === 'S' ? -1 : 1;
    document.getElementById('btnN').className = hemisphere >= 0 ? 'ns-btn active'   : 'ns-btn';
    document.getElementById('btnS').className = hemisphere <  0 ? 'ns-btn active-s' : 'ns-btn';
  }
  refreshCalibLimits();
}

// Build generation radio buttons
function buildGenGroup() {
  const group = document.getElementById('genGroup');
  group.innerHTML = '';
  const lastIdx = FILELIST.generations.length - 1;
  FILELIST.generations.forEach((gen, i) => {
    const label = document.createElement('label');
    label.className = 'radio-row' + (i === lastIdx ? ' active' : '');
    label.innerHTML = `<input type="radio" name="generation" value="${gen.id}"${i === lastIdx ? ' checked' : ''}> ${gen.label}`;
    label.querySelector('input').addEventListener('change', () => {
      group.querySelectorAll('.radio-row').forEach(r => r.classList.remove('active'));
      label.classList.add('active');
      galleryState.genId = gen.id;
      buildImageGroup(gen.id);
    });
    group.appendChild(label);
  });
  // Init last generation
  galleryState.genId = FILELIST.generations[lastIdx].id;
  buildImageGroup(galleryState.genId);
}

// Build image radio buttons for selected generation
function buildImageGroup(genId) {
  const gen = FILELIST.generations.find(g => g.id === genId);
  const group = document.getElementById('imageGroup');
  group.innerHTML = '';
  if (!gen) return;

  gen.images.forEach((img, i) => {
    const label = document.createElement('label');
    label.className = 'radio-row' + (i === 0 ? ' active' : '');
    label.innerHTML = `<input type="radio" name="image" value="${img.index}"${i === 0 ? ' checked' : ''}> #${img.index}`;
    label.querySelector('input').addEventListener('change', () => {
      group.querySelectorAll('.radio-row').forEach(r => r.classList.remove('active'));
      label.classList.add('active');
      galleryState.imageIndex = img.index;
      setSplitMode(false);
      splitBitmap = null;
      splitInverted = false;
      btnSplitInvert.classList.remove('active');
      // Reset view radio to Enhanced
      document.querySelector('.radio-row.view-enh input').checked = true;
      document.querySelectorAll('#viewGroup .radio-row').forEach(r => r.classList.remove('active'));
      document.querySelector('.radio-row.view-enh').classList.add('active');
      galleryState.layer = 1;
      updateViewGroup(img.layers);
      loadGalleryImage();
    });
    group.appendChild(label);
  });

  // Init first image
  galleryState.imageIndex = gen.images[0].index;
  galleryState.layer = 1;  // default Enhanced
  if (splitActive) setSplitMode(false);
  // Reset view radio to Enhanced
  document.querySelector('.radio-row.view-enh input').checked = true;
  document.querySelectorAll('#viewGroup .radio-row').forEach(r => r.classList.remove('active'));
  document.querySelector('.radio-row.view-enh').classList.add('active');
  updateViewGroup(gen.images[0].layers);
  loadGalleryImage();
}

// Update view radio buttons based on available layers
function updateViewGroup(layers) {
  const hasL2 = layers.includes(2);
  const splitRow = document.querySelector('.radio-row.view-split');
  const splitInput = splitRow.querySelector('input');

  if (hasL2) {
    splitRow.classList.remove('disabled');
    splitInput.disabled = false;
  } else {
    splitRow.classList.add('disabled');
    splitInput.disabled = true;
    // If split was selected, fall back to L0
    if (galleryState.layer === 2) {
      galleryState.layer = 0;
      document.querySelector('.radio-row.view-raw input').checked = true;
      document.querySelectorAll('#viewGroup .radio-row').forEach(r => r.classList.remove('active'));
      document.querySelector('.radio-row.view-raw').classList.add('active');
    }
  }
}

// Load image file for current gallery selection
function loadGalleryImage() {
  if (galleryState.genId === null || galleryState.imageIndex === null) return;

  // Aplikuj kalibraci z presets.json
  applyGalleryPreset(galleryState.genId, galleryState.imageIndex);

  const path = `img/GEN-${galleryState.genId}_${galleryState.imageIndex}_L${galleryState.layer}.jpg`;
  const imgEl = new Image();
  imgEl.onload = () => {
    let w, h;
    if (imgEl.width >= imgEl.height) {
      w = IMG_W; h = Math.round(imgEl.height * IMG_W / imgEl.width);
    } else {
      h = IMG_W; w = Math.round(imgEl.width * IMG_W / imgEl.height);
    }
    createImageBitmap(imgEl, { resizeWidth: w, resizeHeight: h }).then(bm => {
      imgBitmap = bm;
      document.getElementById('canvasContainer').classList.remove('hidden');
      requestAnimationFrame(() => resizeCanvas());
    });
  };
  imgEl.onerror = () => console.warn('Image not found:', path);
  imgEl.src = path;
}

// View layer change
document.getElementById('viewGroup').querySelectorAll('input[type=radio]').forEach(input => {
  input.addEventListener('change', () => {
    document.querySelectorAll('#viewGroup .radio-row').forEach(r => r.classList.remove('active'));
    input.closest('.radio-row').classList.add('active');
    const newLayer = parseInt(input.value);

    if (newLayer === 2) {
      // Split mode: L1 as base, L2 as overlay
      galleryState.layer = 1;
      setSplitMode(true);
      loadGalleryImage();
      loadSplitImage(galleryState.genId, galleryState.imageIndex);
    } else {
      // Deactivate split – turn off first, clear the bitmap, then load the new image
      setSplitMode(false);
      splitBitmap = null;
      splitInverted = false;
      btnSplitInvert.classList.remove('active');
      galleryState.layer = newLayer;
      loadGalleryImage();
    }
  });
});

// ─── Mode toggle: Analyzer / Gallery ────────────────────────────────────────
let currentMode = 'gallery'; // 'analyzer' | 'gallery'

function setMode(mode) {
  stopL2Loop();                 // cancel auto-loop when switching modes
  currentMode = mode;
  const btnA = document.getElementById('btnModeAnalyzer');
  const btnG = document.getElementById('btnModeGallery');
  const galleryPanel = document.getElementById('galleryPanel');
  const can3dPanel   = document.getElementById('can3dPanel');
  const sidebar = document.getElementById('sidebar');
  const uploadZoneEl = document.getElementById('uploadZone');

  const calibSection = document.getElementById('calibrationSection');

  if (mode === 'analyzer') {
    btnA.className = 'mode-btn active-analyzer';
    btnG.className = 'mode-btn';
    galleryPanel.classList.remove('visible');
    can3dPanel.classList.add('visible');
    sidebar.style.display = '';
    calibSection.classList.remove('calibration-locked');
    if (!imgBitmap) uploadZoneEl.classList.remove('hidden');
    setPresetButtonsEnabled(imgBitmap !== null);
    document.getElementById('statusWrap').style.display = 'flex';   // info panel in Analyzer
    draw3D();
    if (typeof updateSunGraphButton === 'function') updateSunGraphButton();  // reveal SUN GRAPH sub-toggle
  } else {
    if (typeof sunGraphActive !== 'undefined' && sunGraphActive) exitSunGraph();  // leaving Analyzer closes Sun Graph
    if (typeof updateSunGraphButton === 'function') updateSunGraphButton();        // hide the sub-toggle
    stopSunAnim();                // leaving Analyzer for Gallery stops the day animation
    document.getElementById('statusWrap').style.display = 'none';   // hidden in Gallery
    btnA.className = 'mode-btn';
    btnG.className = 'mode-btn active-gallery';
    galleryPanel.classList.add('visible');
    can3dPanel.classList.remove('visible');
    sidebar.style.display = '';
    calibSection.classList.add('calibration-locked');
    uploadZoneEl.classList.add('hidden');
    if (imgBitmap) document.getElementById('canvasContainer').classList.remove('hidden');
    if (!FILELIST) {
      loadFilelist();
    } else if (galleryState.genId !== null && galleryState.imageIndex !== null) {
      loadGalleryImage(); // loads correct bitmap, applies preset, redraws
    }
  }
}

document.getElementById('btnModeAnalyzer').addEventListener('click', () => setMode('analyzer'));
document.getElementById('btnModeGallery').addEventListener('click', () => {
  if (theaterMode3D) exitTheater3D();
  setMode('gallery');
});

// ─── Theme toggle ─────────────────────────────────────────────────────────────
(function() {
  const btn = document.getElementById('btnTheme');
  const LIGHT_KEY = 'solargraphyTheme';
  function applyTheme(light) {
    document.body.classList.toggle('light', light);
    btn.textContent = light ? '🌙' : '☀️';
    btn.title = light ? 'Switch to dark theme' : 'Switch to light theme';
    try { localStorage.setItem(LIGHT_KEY, light ? 'light' : 'dark'); } catch(e) {}
  }
  // Restore saved preference
  let saved = 'dark';
  try { saved = localStorage.getItem(LIGHT_KEY) || 'dark'; } catch(e) {}
  applyTheme(saved === 'light');
  btn.addEventListener('click', () => {
    applyTheme(!document.body.classList.contains('light'));
    // Redraw 3D vis with new palette + refresh axis legend swatch colours
    if (typeof draw3D === 'function') { updateAxisLegend(); draw3D(); }
  });
})();

// ─── Metadata popup ──────────────────────────────────────────────────────────
function formatMetaDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return MONTH_NAMES[m - 1] + ' ' + d + ' ' + y;
}

function exposureDays(start, end) {
  const ms = new Date(end) - new Date(start);
  return Math.round(ms / 86400000) + ' days';
}

function updateMetaPopup() {
  if (!FILELIST || galleryState.genId === null || galleryState.imageIndex === null) return;
  const gen = FILELIST.generations.find(g => g.id === galleryState.genId);
  if (!gen) return;
  const img = gen.images.find(i => i.index === galleryState.imageIndex);
  if (!img || !img.metadata) return;
  const m = img.metadata;
  document.getElementById('metaTitle').textContent    = `GEN-${galleryState.genId}_${galleryState.imageIndex}`;
  document.getElementById('metaLocation').textContent = m.location      || '—';
  document.getElementById('metaStart').textContent    = m.exposure_start ? formatMetaDate(m.exposure_start) : '—';
  document.getElementById('metaEnd').textContent      = m.exposure_end   ? formatMetaDate(m.exposure_end)   : '—';
  document.getElementById('metaDuration').textContent = (m.exposure_start && m.exposure_end)
    ? exposureDays(m.exposure_start, m.exposure_end) : '—';
}

function openMetaPopup() {
  updateMetaPopup();
  const btn  = document.getElementById('btnMeta');
  const popup = document.getElementById('metaPopup');
  const rect  = btn.getBoundingClientRect();
  // Position below-right of the button, nudge inside viewport
  let top  = rect.bottom + 6;
  let left = rect.right  + 6;
  const pw = 214; // approx popup width
  if (left + pw > window.innerWidth - 8) left = rect.left - pw - 6;
  popup.style.top  = top  + 'px';
  popup.style.left = left + 'px';
  popup.classList.add('visible');
  btn.classList.add('active');
}

function closeMetaPopup() {
  document.getElementById('metaPopup').classList.remove('visible');
  document.getElementById('btnMeta').classList.remove('active');
}

document.getElementById('btnMeta').addEventListener('click', (e) => {
  e.stopPropagation();
  const popup = document.getElementById('metaPopup');
  popup.classList.contains('visible') ? closeMetaPopup() : openMetaPopup();
});

document.addEventListener('click', (e) => {
  const popup = document.getElementById('metaPopup');
  if (popup.classList.contains('visible') &&
      !popup.contains(e.target) &&
      e.target.id !== 'btnMeta') {
    closeMetaPopup();
  }
});

