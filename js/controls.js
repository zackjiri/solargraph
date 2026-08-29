// ─── Event listeners ───────────────────────────────────────────────────────
container.addEventListener('mousemove', (e) => {
  if (splitActive) return;
  if (theaterMode3D) return;  // theater mode: no readout, no crosshair
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) return;  // sun graph: same as theater
  // Sky Dome: same shared readout, recalibrated for the dome's own polar geometry (see
  // handleSkyDomeMouseMove in render-skydome.js) instead of the flat scan's pixelToAzEl.
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive) { handleSkyDomeMouseMove(e); return; }

  // Canvas is CSS 100% × 100% with object-fit: contain, so the bitmap is
  // letterboxed inside the element – map through the real image bounds.
  const rect = container.getBoundingClientRect();
  const b = getImageBounds();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  if (px < b.ox || px > b.ox + b.iw || py < b.oy || py > b.oy + b.ih) {
    // Over the letterbox bars – no image here: restore the OS cursor and
    // clear the crosshair + readout (crosshair would otherwise be displaced)
    container.style.cursor = 'default';
    if (mouseX >= 0) {
      mouseX = -1; mouseY = -1;
      document.getElementById('valAz').textContent  = '—';
      document.getElementById('valAlt').textContent  = '—';
      document.getElementById('valDay').textContent  = '—';
      document.getElementById('valTime').textContent = '—';
      document.getElementById('valDir').textContent  = '—';
      draw();
    }
    return;
  }
  container.style.cursor = 'none';

  mouseX = (px - b.ox) * canvasLW / b.iw;   // map to logical px (not the super-res backing store)
  mouseY = (py - b.oy) * canvasLH / b.ih;

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
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive) { handleSkyDomeMouseLeave(); return; }
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
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();   // line labels in the graph
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
  LONG = 15.0;
  lonHemisphere = 1;
  timeZoneHours = 1;

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
  document.getElementById('inpLong').value = '15.0';
  document.getElementById('btnE').className = 'ns-btn active';
  document.getElementById('btnW').className = 'ns-btn';
  document.getElementById('inpTimeZone').value = 1;
  document.getElementById('lblTimeZone').textContent = _fmtTimeZone(1);

  // 3. Single draw with ALL values in their final state
  updateScanH();
  refreshCalibLimits();
  draw(); draw3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
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
    hemisphere: hemisphere >= 0 ? 'N' : 'S',
    longitude:  lonHemisphere * LONG,
    time_zone:  timeZoneHours
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
      typeof preset.yaw_deg    === 'number' && preset.yaw_deg    >= -180 && preset.yaw_deg    <= 180,
      typeof preset.pitch_deg  === 'number' && preset.pitch_deg  >= -90  && preset.pitch_deg  <= 90,
      typeof preset.roll_deg   === 'number' && preset.roll_deg   >= -90  && preset.roll_deg   <= 90,
      typeof preset.horizon_mm === 'number' && preset.horizon_mm >= -50  && preset.horizon_mm <= 50,
      typeof preset.radius_mm  === 'number' && preset.radius_mm  >= 10  && preset.radius_mm  <= 80,
      typeof preset.latitude   === 'number' && preset.latitude   >= 0   && preset.latitude   <= 90,
      preset.hemisphere === 'N' || preset.hemisphere === 'S',
      // longitude / time_zone are optional (older presets predate them) - only range-checked if present
      preset.longitude  === undefined || (typeof preset.longitude === 'number' && preset.longitude >= -180 && preset.longitude <= 180),
      preset.time_zone  === undefined || (typeof preset.time_zone === 'number' && preset.time_zone >= -12  && preset.time_zone <= 14)
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

    const lon = preset.longitude ?? 15;
    lonHemisphere = lon < 0 ? -1 : 1;
    applyLong(Math.abs(lon));
    document.getElementById('btnE').className = lonHemisphere >= 0 ? 'ns-btn active'   : 'ns-btn';
    document.getElementById('btnW').className = lonHemisphere <  0 ? 'ns-btn active-s' : 'ns-btn';
    applyTimeZone(preset.time_zone ?? 1);

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

// ─── Longitude control ──────────────────────────────────────────────────────
// Mirrors latitude exactly: UI edits a 0-180 magnitude + E/W state (lonHemisphere); only the
// signed combination (lonHemisphere * LONG) ever gets serialized to presets.json.
function applyLong(val) {
  LONG = Math.round(Math.max(0, Math.min(180, val)) * 10) / 10;
  document.getElementById('inpLong').value = LONG.toFixed(1);
  draw(); draw3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
}

document.getElementById('inpLong').addEventListener('change', (e) => {
  applyLong(parseFloat(e.target.value) || 0);
});
document.getElementById('inpLong').addEventListener('blur', (e) => {
  applyLong(parseFloat(e.target.value) || 0);
});
document.getElementById('inpLong').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyLong(parseFloat(e.target.value) || 0);
});
document.getElementById('btnLongDec').addEventListener('click', () => {
  applyLong(LONG - 0.1);
});
document.getElementById('btnLongInc').addEventListener('click', () => {
  applyLong(LONG + 0.1);
});
document.getElementById('btnE').addEventListener('click', () => {
  lonHemisphere = 1;
  document.getElementById('btnE').className = 'ns-btn active';
  document.getElementById('btnW').className = 'ns-btn';
  draw(); draw3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
});
document.getElementById('btnW').addEventListener('click', () => {
  lonHemisphere = -1;
  document.getElementById('btnE').className = 'ns-btn';
  document.getElementById('btnW').className = 'ns-btn active-s';
  draw(); draw3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
});

// ─── Time zone offset control ───────────────────────────────────────────────
function _fmtTimeZone(h) {
  const sign = h < 0 ? '−' : '+';
  const abs = Math.abs(h);
  const hh = Math.floor(abs), mm = Math.round((abs - hh) * 60);
  return sign + hh + ':' + String(mm).padStart(2, '0');
}
function applyTimeZone(val) {
  timeZoneHours = Math.round(Math.max(-12, Math.min(14, val)) * 4) / 4;   // snap to 15-min steps
  document.getElementById('inpTimeZone').value = timeZoneHours;
  document.getElementById('lblTimeZone').textContent = _fmtTimeZone(timeZoneHours);
  draw(); draw3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
}

document.getElementById('inpTimeZone').addEventListener('change', (e) => {
  applyTimeZone(parseFloat(e.target.value) || 0);
});
document.getElementById('inpTimeZone').addEventListener('blur', (e) => {
  applyTimeZone(parseFloat(e.target.value) || 0);
});
document.getElementById('inpTimeZone').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyTimeZone(parseFloat(e.target.value) || 0);
});
document.getElementById('btnTimeZoneDec').addEventListener('click', () => {
  applyTimeZone(timeZoneHours - 0.25);
});
document.getElementById('btnTimeZoneInc').addEventListener('click', () => {
  applyTimeZone(timeZoneHours + 0.25);
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
  currentExposure    = null;   // uploaded image has no filelist metadata → no exposure overlay
  currentChmi        = null;   // ditto for the CHMI sunshine overlay
  currentChmiExtra   = null;   // ditto for any per-image extra dataset (chmi_extra)
  chmiActiveElement  = null;   // back to SSV10M - the extra-element switch has nothing to show now
  currentHalf        = null;   // ditto for the Sun Graph legend corner
  updateChmiLegendAvailability();
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
let showCustomArc = true;        // Custom date on by default (Gallery + Analyzer)
let show3DCulmination = true;    // Sun path (custom date) on by default (Analyzer)
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
  renderDateWheels();
}

// Step helpers – same wrapping behaviour as the old ◀/▶ buttons
function stepCustomMonth(dir) {
  customMonth = dir > 0 ? (customMonth < 12 ? customMonth + 1 : 1)
                        : (customMonth > 1  ? customMonth - 1 : 12);
  customDay = Math.min(customDay, DAYS_IN_MONTH[customMonth - 1]);
}
function stepCustomDay(dir) {
  if (dir > 0) {
    if (customDay < DAYS_IN_MONTH[customMonth - 1]) customDay++;
    else { customMonth = customMonth < 12 ? customMonth + 1 : 1; customDay = 1; }
  } else {
    if (customDay > 1) customDay--;
    else { customMonth = customMonth > 1 ? customMonth - 1 : 12; customDay = DAYS_IN_MONTH[customMonth - 1]; }
  }
}
function commitCustomDate() {
  updateDateLabels(); if (show3DCulmination) refreshSunTimeRange(); draw(); if (show3DCulmination) draw3D(); if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
}

// Day value `off` steps away from the current date, without mutating state
// (month-boundary wrapping matches stepCustomDay)
function customDayAt(off) {
  let m = customMonth, d = customDay;
  while (off > 0) { if (d < DAYS_IN_MONTH[m - 1]) d++; else { m = m < 12 ? m + 1 : 1; d = 1; } off--; }
  while (off < 0) { if (d > 1) d--; else { m = m > 1 ? m - 1 : 12; d = DAYS_IN_MONTH[m - 1]; } off++; }
  return d;
}

// iOS-style horizontal picker: current value centred, grey neighbours on both
// sides. Drag (touch or mouse) scrolls with live snapping; tapping a side
// value jumps to it; mouse wheel steps by one. Generic (not date-specific) -
// also drives the Analyzer sub-view switcher (3D Model / Image / Sun Graph / Sky Dome) below.
function makeWheelPicker(el, { labelAt, step, itemW, onCommit }) {
  let frac = 0;   // fractional item offset while dragging → strip shift

  function render() {
    const cx = (el.clientWidth || 200) / 2;
    let html = '';
    for (let off = -3; off <= 3; off++) {
      const x = cx + (off - frac) * itemW - itemW / 2;
      const isCenter = off === 0 && Math.abs(frac) < 0.25;
      html += `<span class="wheel-item${isCenter ? ' center' : ''}" style="left:${x.toFixed(1)}px;width:${itemW}px">${labelAt(off)}</span>`;
    }
    el.innerHTML = html;
  }

  let pid = null, x0 = 0, applied = 0, movedPx = 0;

  el.addEventListener('pointerdown', (e) => {
    pid = e.pointerId; x0 = e.clientX; applied = 0; movedPx = 0;
    el.setPointerCapture(pid);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (pid === null || e.pointerId !== pid) return;
    const dx = e.clientX - x0;
    movedPx = Math.max(movedPx, Math.abs(dx));
    const t = -dx / itemW;             // drag left → next values arrive from the right
    const target = Math.round(t);
    if (target !== applied) {
      const d = target > applied ? 1 : -1;
      while (applied !== target) { step(d); applied += d; }
      onCommit();                      // live redraw at each snap point
    }
    frac = t - applied;
    render();
  });
  const endDrag = (e) => {
    if (pid === null || e.pointerId !== pid) return;
    pid = null; frac = 0;
    el.classList.remove('dragging');
    render();
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  el.addEventListener('click', (e) => {
    if (movedPx > 5) return;           // it was a drag, not a tap
    const r = el.getBoundingClientRect();
    let off = Math.round((e.clientX - r.left - r.width / 2) / itemW);
    if (off === 0) return;
    const d = off > 0 ? 1 : -1;
    while (off !== 0) { step(d); off -= d; }
    onCommit();
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    step(e.deltaY > 0 ? 1 : -1);
    onCommit();
  }, { passive: false });

  return { render };
}

const _monthWheel = makeWheelPicker(document.getElementById('wheelMonth'), {
  labelAt: (off) => MONTHS[((customMonth - 1 + off) % 12 + 12) % 12],
  step: stepCustomMonth,
  itemW: 38,
  onCommit: commitCustomDate,
});
const _dayWheel = makeWheelPicker(document.getElementById('wheelDay'), {
  labelAt: customDayAt,
  step: stepCustomDay,
  itemW: 30,
  onCommit: commitCustomDate,
});

function renderDateWheels() { _monthWheel.render(); _dayWheel.render(); }
renderDateWheels();
window.addEventListener('resize', renderDateWheels);

// Custom date's month/day wheels are sub-controls of the "Custom date" checkbox (Display) - same
// show/hide-with-master pattern as the CHMI sub-rows (updateChmiElemSwitch/syncChmiModeGroupState
// below): no space taken and not interactive while the overlay itself is off.
function updateCustomDateSubrow() {
  const row = document.getElementById('customDateSubrow');
  if (!row) return;
  const visible = document.getElementById('chkCustomArc').checked;
  row.style.display = visible ? 'flex' : 'none';
  // The wheels' render() centres the active item using el.clientWidth, which is 0 while this row
  // is display:none - any render that happens before the row is first shown (the page-load call
  // above, or a later reveal after being hidden) lays the strip out for a 0px-wide track, landing
  // the active item off to the right instead of centred. It then looks "fixed" the moment the
  // user drags/steps the wheel, since that always re-renders with the real (by-then-visible)
  // width - but it should be centred from the moment it appears, not just after the first
  // interaction. Re-render once more right after actually becoming visible.
  if (visible) renderDateWheels();
}
updateCustomDateSubrow();

// ─── Analyzer sub-view switcher (3D Model / Image / Sun Graph / Sky Dome) ────────────────────
// Same wheel widget as Custom Path above, styled identically (.wheel-row/.wheel-btn/.wheel-track) -
// side arrows or drag/tap/mouse-wheel step through the four mutually exclusive canvas views,
// wrapping infinitely in both directions. Position stays where the old button row sat, flush
// under the Gallery/Analyzer toggle (.mode-subrow, unchanged).
// "Image" (index 1) is the neutral base view - the flat 2D scan with its usual overlays, i.e.
// whatever is on screen when none of the other three takeovers is active. It's the default on
// entering Analyzer; see enterImageView() below and updateViewButtons() in render-sungraph.js,
// which is what actually keeps _modeWheelIndex in sync with reality (this file only drives the
// wheel widget itself).
const MODE_VIEW_LABELS = ['3D Model', 'Image', 'Sun Graph', 'Sky Dome'];
let _modeWheelIndex = 1;   // which of the 4 the wheel is currently centred on - starts on Image

function stepModeWheel(dir) {
  _modeWheelIndex = ((_modeWheelIndex + dir) % 4 + 4) % 4;
}
// Actually switches the canvas to the wheel's current selection - the enter* functions
// (render-3d.js / render-sungraph.js / render-skydome.js) already exit whichever of the other
// takeovers was active, so this only ever needs to enter the newly selected one.
function commitModeWheel() {
  if (_modeWheelIndex === 0 && typeof enterTheater3D === 'function') enterTheater3D();
  else if (_modeWheelIndex === 1 && typeof enterImageView === 'function') enterImageView();
  else if (_modeWheelIndex === 2 && typeof enterSunGraph === 'function') enterSunGraph();
  else if (_modeWheelIndex === 3 && typeof enterSkyDome === 'function') enterSkyDome();
}

const _modeWheel = makeWheelPicker(document.getElementById('modeWheelTrack'), {
  labelAt: (off) => MODE_VIEW_LABELS[((_modeWheelIndex + off) % 4 + 4) % 4],
  step: stepModeWheel,
  itemW: 76,
  onCommit: commitModeWheel,
});
document.getElementById('btnModeDec').addEventListener('click', () => { stepModeWheel(-1); commitModeWheel(); });
document.getElementById('btnModeInc').addEventListener('click', () => { stepModeWheel(1);  commitModeWheel(); });
_modeWheel.render();
window.addEventListener('resize', () => _modeWheel.render());

document.getElementById('btnMonDec').addEventListener('click', () => { stepCustomMonth(-1); commitCustomDate(); });
document.getElementById('btnMonInc').addEventListener('click', () => { stepCustomMonth(1);  commitCustomDate(); });
document.getElementById('btnDayDec').addEventListener('click', () => { stepCustomDay(-1);  commitCustomDate(); });
document.getElementById('btnDayInc').addEventListener('click', () => { stepCustomDay(1);   commitCustomDate(); });
// Custom date (Display checkbox) and Sun path (custom date) (3D panel button) are the same on/off
// switch shown in two places, now mirrored absolutely: whichever one changes - a direct click on
// either, or CHMI turning Custom date on automatically via forceCustomArcOn() below - the other
// follows immediately, so checkbox state, the month/day wheel sub-row, and the button's own ☑/☐
// icon (updateAxisLegend()) never disagree.
function setCustomDateActive(active) {
  showCustomArc = active;
  show3DCulmination = active;
  document.getElementById('chkCustomArc').checked = active;
  if (active) sunTimeHours = 12;   // fresh start at noon when turning it on
  updateCustomDateSubrow();
  updateAxisLegend();
  updateSunAnimCtl();
  draw();
  draw3D();
  updateSunWave();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
}

document.getElementById('chkCustomArc').addEventListener('change', (e) => {
  setCustomDateActive(e.target.checked);
});

// Forces it on if it isn't already - shared by the two CHMI actions whose effect otherwise
// depends on it being on: turning the CHMI master switch on, and picking the custom-date CHMI
// submode (its single-day gradient is drawn entirely inside the showCustomArc block in draw() and
// would otherwise silently show nothing if the user had unchecked it earlier).
function forceCustomArcOn() {
  if (!showCustomArc || !show3DCulmination) setCustomDateActive(true);
}

// CHMI data (Display section): master switch + Custom date / Whole period sub-mode. Display is
// the primary control everywhere, since it's the only place to pick SSV vs. the extra element -
// works in Gallery too (Display is unlocked there). The Sun Graph's own legend entry offers a
// quick on/off shortcut (render-sungraph.js's legend click handler) but always goes through this
// same function, so the checkbox and the legend item never drift out of sync with each other.
function setShowImgChmi(val) {
  showImgChmi = val;
  document.getElementById('chkImgChmi').checked = val;
  const legendItem = document.querySelector('[data-band="chmi"]');
  if (legendItem) legendItem.classList.toggle('off', !val);
  if (showImgChmi) forceCustomArcOn();
  syncChmiModeGroupState();
  updateChmiElemSwitch();
  draw();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
}
document.getElementById('chkImgChmi').addEventListener('change', (e) => {
  setShowImgChmi(e.target.checked);
});
document.querySelectorAll('.chmi-mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    chmiDisplayMode = e.currentTarget.dataset.mode;
    document.querySelectorAll('.chmi-mode-btn').forEach(b => b.classList.toggle('active', b === e.currentTarget));
    if (chmiDisplayMode === 'custom') forceCustomArcOn();
    draw();
  });
});
let imgLegendCollapsed = false;
function setImgLegendCollapsed(c) {
  imgLegendCollapsed = c;
  const w = document.getElementById('imgLegendWrap'), t = document.getElementById('imgLegendToggle');
  if (w) w.classList.toggle('collapsed', c);
  if (t) t.textContent = c ? '▲' : '▼';   // down = shown, up = hidden (same convention as sgLegendToggle)
}
(function () {
  const tog = document.getElementById('imgLegendToggle');
  if (tog) tog.addEventListener('click', (e) => { e.stopPropagation(); setImgLegendCollapsed(!imgLegendCollapsed); });
})();

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
// Noon button click – mirrors "Custom date" absolutely, see setCustomDateActive() above.
document.getElementById('btnNoon').addEventListener('click', () => {
  setCustomDateActive(!show3DCulmination);
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
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();   // move the sun marker in the graph
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

// Exposure interval (day-of-year) of the current GALLERY image from filelist; null for images
// loaded via "load new image" (no metadata). Used by the Sun Graph exposure overlay.
let currentExposure = null;
function setCurrentExposureFromGallery() {
  currentExposure = null;
  if (!FILELIST || galleryState.genId === null || galleryState.imageIndex === null) return;
  const gen = FILELIST.generations.find(g => g.id === galleryState.genId);
  const img = gen && gen.images.find(i => i.index === galleryState.imageIndex);
  const m = img && img.metadata;
  if (m && m.exposure_start && m.exposure_end) {
    const doy = (s) => { const [, mo, d] = s.split('-').map(Number); return dayOfYear(mo, d); };
    currentExposure = { startDoy: doy(m.exposure_start), endDoy: doy(m.exposure_end) };
  }
}

// Which half of the year the current generation covers ('H1'|'H2'), from its label
// (convention YYYY_Hn_GEN-ROMAN, see filelist.json). Used by the Sun Graph legend to pick a
// corner that stays clear of the data (H1 → Jan-Jun busy on the left → legend goes right).
let currentHalf = null;
function setCurrentHalfFromGallery() {
  currentHalf = null;
  if (!FILELIST || galleryState.genId === null) return;
  const gen = FILELIST.generations.find(g => g.id === galleryState.genId);
  const m = gen && gen.label && gen.label.match(/_H([12])_/);
  if (m) currentHalf = 'H' + m[1];
}

// Measured sunshine data (CHMI, SSV10M) for the current GALLERY image, keyed off filelist
// metadata (chmi_wsi_station only - no offset field, see core.js's Time zone offset control);
// null for images with no station assigned or that fail to load. Timestamps in `values` stay
// UTC (see chmi_10min/extract-chmi.ps1) - the UTC → standard time shift is applied at render
// time (_sgEnsureChmiByDoy in core.js), not baked in here.
let currentChmi = null;

// Extra per-image dataset (e.g. temperature), declared via filelist.json metadata's "chmi_extra"
// array (chmi/GEN-X_Y_<code>.json alongside the base chmi/GEN-X_Y.json) - null if the image
// doesn't declare one or it failed to load. Only ever consumed by the 2D canvas element switch
// (render-2d.js) - the Sun Graph's own CHMI overlay always stays on the base SSV10M dataset.
let currentChmiExtra = null;

// True in any view where CHMI data actually renders something - Gallery/Image (the plain 2D scan,
// mosaic or single-day gradient) and now Sun Graph (main diagram + custom-date strip). False in
// the 3D Model theater and Sky Dome, which never draw CHMI at all regardless of the Display
// checkbox. Used to grey the whole CHMI Display block out in those views instead of leaving it
// looking active just because the checkbox happens to be checked and the data available - see
// updateChmiLegendAvailability()/updateChmiElemSwitch()/syncChmiModeGroupState() below.
function _chmiControlsRelevantHere() {
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D) return false;
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive) return false;
  return true;
}

// Reflects data availability on the Sun Graph CHMI legend entry and the Display-section CHMI
// controls: greys out and disables when the current image has no CHMI data at all, when the
// active time mode is True solar time (CHMI is standard-time-native and hidden in that mode - see
// core.js's displayHour/trueFromStandard), or when the active view doesn't render CHMI at all
// (3D Model / Sky Dome - see _chmiControlsRelevantHere()) - leaving the normal on/off look
// untouched only when data IS available AND the view supports it. The image-mode overlay itself
// used to have its own legend entry (data-band="imgchmi"); it's now driven entirely from here,
// since Display's "CHMI data" checkbox replaced that legend row. Called both on data/mode changes
// and, via setDisplaySectionEnabled(), on every view switch.
function updateChmiLegendAvailability() {
  const unavailable = currentChmi === null || timeDisplayMode === 'true';
  document.querySelectorAll('[data-band="chmi"]').forEach(el => {
    el.classList.toggle('unavailable', unavailable);
    el.classList.toggle('off', !showImgChmi);   // keep the legend's own on/off look in sync too
  });

  const relevant = _chmiControlsRelevantHere();
  const active = !unavailable && relevant;
  const chk = document.getElementById('chkImgChmi');
  const row = document.getElementById('chkImgChmiRow');
  if (chk) chk.disabled = !active;
  if (row) { row.style.opacity = active ? '' : '0.35'; row.style.pointerEvents = active ? '' : 'none'; }
  syncChmiModeGroupState();
  updateChmiElemSwitch();
}

// Hint text for an extra CHMI element's label, shown as its title attribute (updateChmiElemSwitch
// below). Falls back to the raw code itself for any future element this doesn't know a plain-
// language description for yet.
function _chmiElementHint(code) {
  if (code === 'T') return 'Air temperature';
  return code;
}

// CHMI element switch (Display, between the "CHMI data" checkbox and the custom date / whole
// period toggle): only offered when the current image's filelist metadata declares an extra
// dataset (chmi_extra) AND it loaded successfully - independent of chmiDisplayMode, which the
// switch doesn't touch, it only decides which dataset/gradient that mode/the Sun Graph renders
// with. iOS-style switch: both labels always shown ("SSV" left, the extra element's code right),
// the active one at full contrast and the other dimmed (.dim), thumb next to whichever is active -
// left/yellow fill for SSV (ON), right/red fill for the extra element (OFF). Each label carries a
// plain-language hint as its title attribute (e.g. "Sunshine duration" / "Air temperature").
// Hidden entirely (display:none) when there's nothing to switch between (master off, no extra
// dataset for this image); once it WOULD show, it's greyed out instead - not hidden - in a view
// that doesn't render CHMI at all (_chmiControlsRelevantHere()), so a choice made in Image/Sun
// Graph stays visible but inert there rather than disappearing or misleadingly looking live.
function updateChmiElemSwitch() {
  const row = document.getElementById('chmiElemRow');
  if (!row) return;
  const unavailable = currentChmi === null || timeDisplayMode === 'true';
  const wouldShow = showImgChmi && !unavailable && !!currentChmiExtra;
  row.style.display = wouldShow ? 'flex' : 'none';
  if (!wouldShow) return;

  const relevant = _chmiControlsRelevantHere();
  const btn = document.getElementById('btnChmiElemSwitch');
  btn.disabled = !relevant;
  row.style.opacity = relevant ? '' : '0.35';
  row.style.pointerEvents = relevant ? '' : 'none';

  const isExtra = chmiActiveElement === currentChmiExtra.element;
  const lblLeft  = document.getElementById('chmiElemLabelLeft');
  const lblRight = document.getElementById('chmiElemLabelRight');
  lblLeft.textContent  = 'SSV';
  lblLeft.title        = 'Sunshine duration';
  lblRight.textContent = currentChmiExtra.element;
  lblRight.title       = _chmiElementHint(currentChmiExtra.element);
  lblLeft.classList.toggle('dim', isExtra);
  lblRight.classList.toggle('dim', !isExtra);
  btn.classList.toggle('on', !isExtra);
  btn.setAttribute('aria-checked', String(!isExtra));
}
document.getElementById('btnChmiElemSwitch').addEventListener('click', () => {
  if (!currentChmiExtra) return;
  chmiActiveElement = (chmiActiveElement === currentChmiExtra.element) ? null : currentChmiExtra.element;
  updateChmiElemSwitch();
  draw();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
});

// Custom date / Whole period sub-toggle: hidden entirely while the master switch above is off
// (nothing to choose between yet), shown but dimmed/inert if the master is on and checked but the
// data has since become unavailable (image switch, time-mode change), the active view doesn't
// render CHMI at all (3D Model / Sky Dome), OR the Sun Graph is active - it only ever shows the
// whole-year overlay there, no custom-date/whole-period choice to make (unlike Image, which has
// both a single-day gradient and a whole-exposure mosaic) - see enterSunGraph()'s own keepIds,
// which deliberately leaves the master switch + element switch active but not this group.
function syncChmiModeGroupState() {
  const group = document.getElementById('chmiModeGroup');
  if (!group) return;
  group.style.display = showImgChmi ? 'flex' : 'none';
  const unavailable = currentChmi === null || timeDisplayMode === 'true';
  const inSunGraph = typeof sunGraphActive !== 'undefined' && sunGraphActive;
  const active = showImgChmi && !unavailable && _chmiControlsRelevantHere() && !inSunGraph;
  group.style.opacity = active ? '' : '0.35';
  group.style.pointerEvents = active ? '' : 'none';
  group.querySelectorAll('.chmi-mode-btn').forEach(el => { el.disabled = !active; });
}

async function setCurrentChmiFromGallery() {
  // Remembered so the element switch's choice can carry over to the next image below - reset to
  // null (back to SSV) up front since that's the correct outcome for every early-return case
  // (no image, no station, fetch failure); restored only if the new image turns out to declare
  // the same extra element too.
  const prevActiveElement = chmiActiveElement;
  currentChmi = null;
  currentChmiExtra = null;
  chmiActiveElement = null;
  const finish = () => {
    updateChmiLegendAvailability();
    if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
    draw();
  };

  if (!FILELIST || galleryState.genId === null || galleryState.imageIndex === null) { finish(); return; }
  const gen = FILELIST.generations.find(g => g.id === galleryState.genId);
  const img = gen && gen.images.find(i => i.index === galleryState.imageIndex);
  const m = img && img.metadata;
  if (!m || !m.chmi_wsi_station) { finish(); return; }

  const genId = galleryState.genId, imageIndex = galleryState.imageIndex;
  const isStale = () => galleryState.genId !== genId || galleryState.imageIndex !== imageIndex;
  const baseName = `GEN-${genId}_${imageIndex}`;

  try {
    const res = await fetch(`chmi/${baseName}.json`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (isStale()) return;   // gallery selection moved on while this fetch was in flight
    // No offset stored here - UTC → standard time uses timeZoneHours (calibration, presets.json),
    // read live by _sgEnsureChmiByDoy() so tweaking the Time zone offset control updates it.
    currentChmi = { values: data.values };
  } catch (e) {
    if (isStale()) return;
    console.warn('CHMI data not found for ' + baseName + ':', e);
  }

  // Extra per-image dataset (e.g. temperature), only if this image's filelist metadata declares
  // one - only the first code is used for now, since the Display switch is a plain binary
  // SSV10M/other toggle (see project notes; more than one extra element is a later step).
  const extraCode = Array.isArray(m.chmi_extra) && m.chmi_extra.length ? m.chmi_extra[0] : null;
  if (extraCode) {
    try {
      const res = await fetch(`chmi/${baseName}_${extraCode}.json`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (isStale()) return;
      currentChmiExtra = { element: extraCode, values: data.values };
      // Carry the element switch's choice over to this image if it declares the same extra
      // element (e.g. stays on T when browsing between images that all have temperature data) -
      // still defaults back to SSV whenever the new image's extra element differs or is missing.
      if (prevActiveElement === extraCode) chmiActiveElement = extraCode;
    } catch (e) {
      if (isStale()) return;
      console.warn('CHMI extra (' + extraCode + ') not found for ' + baseName + ':', e);
    }
  }

  finish();
}

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
  // Longitude is stored as one signed field (no separate hemisphere key) - decompose into the
  // magnitude (LONG) + E/W state the UI actually edits, mirroring latitude's own split.
  if (typeof preset.longitude === 'number') {
    lonHemisphere = preset.longitude < 0 ? -1 : 1;
    applyLong(Math.abs(preset.longitude));
    document.getElementById('btnE').className = lonHemisphere >= 0 ? 'ns-btn active'   : 'ns-btn';
    document.getElementById('btnW').className = lonHemisphere <  0 ? 'ns-btn active-s' : 'ns-btn';
  }
  if (typeof preset.time_zone === 'number') applyTimeZone(preset.time_zone);
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

  setCurrentExposureFromGallery();   // exposure interval for the Sun Graph (from filelist metadata)
  setCurrentChmiFromGallery();       // measured sunshine overlay for the Sun Graph (async, redraws when ready)
  setCurrentHalfFromGallery();       // H1/H2 → which corner the Sun Graph legend should use

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
    if (typeof setDisplaySectionEnabled === 'function') setDisplaySectionEnabled(true);  // normal Analyzer: Display active
    // Analyzer is for calibration work on the Enhanced image - Raw/Split are Gallery-only
    // comparison views. Force back to Enhanced every time Analyzer is entered, even if Raw or
    // Split was left active in Gallery, rather than carrying it over.
    if (galleryState.layer !== 1 || splitActive) {
      if (splitActive) setSplitMode(false);
      splitBitmap = null;
      splitInverted = false;
      btnSplitInvert.classList.remove('active');
      galleryState.layer = 1;
      document.querySelector('.radio-row.view-enh input').checked = true;
      document.querySelectorAll('#viewGroup .radio-row').forEach(r => r.classList.remove('active'));
      document.querySelector('.radio-row.view-enh').classList.add('active');
      if (galleryState.genId !== null && galleryState.imageIndex !== null) loadGalleryImage();
    }
    if (!imgBitmap) uploadZoneEl.classList.remove('hidden');
    setPresetButtonsEnabled(imgBitmap !== null);
    document.getElementById('statusWrap').style.display = 'flex';   // info panel in Analyzer
    draw3D();
    if (typeof updateViewButtons === 'function') updateViewButtons();  // reveal the sub-view wheel, defaulting to Image
    if (typeof updateSunAnimCtl === 'function') updateSunAnimCtl();     // reflect default Sun-path state
  } else {
    if (typeof theaterMode3D !== 'undefined' && theaterMode3D && typeof exitTheater3D === 'function') exitTheater3D();  // leaving Analyzer closes 3D model
    if (typeof sunGraphActive !== 'undefined' && sunGraphActive) exitSunGraph();   // ...and Sun Graph
    if (typeof skyDomeActive !== 'undefined' && skyDomeActive && typeof exitSkyDome === 'function') exitSkyDome();   // ...and Sky Dome
    if (typeof updateViewButtons === 'function') updateViewButtons();              // hide the sub-toggles
    stopSunAnim();                // leaving Analyzer for Gallery stops the day animation
    document.getElementById('statusWrap').style.display = 'none';   // hidden in Gallery
    btnA.className = 'mode-btn';
    btnG.className = 'mode-btn active-gallery';
    galleryPanel.classList.add('visible');
    can3dPanel.classList.remove('visible');
    sidebar.style.display = '';
    calibSection.classList.add('calibration-locked');
    if (typeof setDisplaySectionEnabled === 'function') setDisplaySectionEnabled(true);  // Gallery: Display always unlocked
    uploadZoneEl.classList.add('hidden');
    if (imgBitmap) document.getElementById('canvasContainer').classList.remove('hidden');
    if (!FILELIST) {
      loadFilelist();
    } else if (galleryState.genId !== null && galleryState.imageIndex !== null) {
      loadGalleryImage(); // loads correct bitmap, applies preset, redraws
    }
  }
}

// ─── Image sub-view (the default/base Analyzer view) ──────────────────────────
// Not a canvas takeover of its own - it's just the state where none of the other three
// (3D Model theater / Sun Graph / Sky Dome) is active, i.e. the flat 2D scan with its usual
// Display overlays. Exposed as its own enter function so the mode wheel can name and select it
// like the other three, and so updateViewButtons() (render-sungraph.js) always has a real state
// to point the wheel at instead of an implicit "none of the above".
function enterImageView() {
  if (typeof theaterMode3D !== 'undefined' && theaterMode3D && typeof exitTheater3D === 'function') exitTheater3D();
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive && typeof exitSunGraph === 'function') exitSunGraph();
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive && typeof exitSkyDome === 'function') exitSkyDome();
  if (typeof updateViewButtons === 'function') updateViewButtons();
}

// Already in Analyzer (incl. Sun Graph / 3D Model sub-views) → no-op; the graph is part of Analyzer.
document.getElementById('btnModeAnalyzer').addEventListener('click', () => {
  if (currentMode !== 'analyzer') setMode('analyzer');
});
document.getElementById('btnModeGallery').addEventListener('click', () => {
  if (currentMode === 'gallery') return;
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
    // Sky Dome picks its palette at draw time too - force a repaint if it's the active view
    // (other views happen to get redrawn via other interactions; this one otherwise wouldn't
    // until something else - e.g. a calibration slider - triggered its own redraw).
    if (typeof skyDomeActive !== 'undefined' && skyDomeActive && typeof drawSkyDome === 'function') drawSkyDome();
  });
})();

// ─── Time display mode (True / Mean / Standard solar time) ───────────────────
// Label-only switch - never touches geometry (hDeg/pixel positions stay true-solar-native
// everywhere except the Sun Graph's yearly view, which reprojects its own geometry instead).
(function() {
  const btn = document.getElementById('btnTimeMode');
  const menu = document.getElementById('timeModeMenu');
  const MODE_KEY = 'solargraphyTimeMode';

  function applyTimeMode(mode) {
    timeDisplayMode = mode;
    menu.querySelectorAll('.time-mode-item').forEach(el => {
      el.classList.toggle('active', el.dataset.mode === mode);
    });
    try { localStorage.setItem(MODE_KEY, mode); } catch(e) {}
    updateChmiLegendAvailability();
    if (typeof syncSunTimeUI === 'function') syncSunTimeUI();
    draw();
    if (typeof draw3D === 'function') draw3D();
    if (typeof sunGraphActive !== 'undefined' && sunGraphActive) drawSunGraph();
  }

  let saved = 'standard';
  try { saved = localStorage.getItem(MODE_KEY) || 'standard'; } catch(e) {}
  timeDisplayMode = saved;
  menu.querySelectorAll('.time-mode-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === saved);
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  menu.querySelectorAll('.time-mode-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.remove('open');
      applyTimeMode(el.dataset.mode);
    });
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
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

// Position an anchored popup (metadata "i", CHMI license "i") below-right of its trigger button,
// clamped to both viewport axes. The page runs with `overflow:hidden` on html/body (no scrolling
// to chase an off-screen element), so without a vertical clamp a popup opened near the bottom of
// the sidebar can render with its lower portion (e.g. the license link) past the visible area -
// visible per its CSS class, but physically unreachable/unclickable. Called after the popup is
// already `.visible` so offsetWidth/offsetHeight reflect its real rendered size.
function positionAnchoredPopup(btn, popup) {
  const rect = btn.getBoundingClientRect();
  const margin = 8;
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  let left = rect.right + 6;
  if (left + pw > window.innerWidth - margin) left = rect.left - pw - 6;
  left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
  let top = rect.bottom + 6;
  if (top + ph > window.innerHeight - margin) top = rect.top - ph - 6;
  top = Math.max(margin, Math.min(top, window.innerHeight - ph - margin));
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
}

function openMetaPopup() {
  updateMetaPopup();
  const btn  = document.getElementById('btnMeta');
  const popup = document.getElementById('metaPopup');
  popup.classList.add('visible');
  positionAnchoredPopup(btn, popup);
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

// ─── CHMI data license popup (Display → "CHMI data" ⓘ) ────────────────────────
// Same anchored-popup mechanic as the metadata "i" above (openMetaPopup/closeMetaPopup) - reused
// rather than a full-screen modal, since the app has no other modal chrome and the license text
// is short enough to sit in the same lightweight popover.
function openChmiInfoPopup() {
  const btn   = document.getElementById('btnChmiInfo');
  const popup = document.getElementById('chmiInfoPopup');
  popup.classList.add('visible');
  positionAnchoredPopup(btn, popup);
  btn.classList.add('active');
}

function closeChmiInfoPopup() {
  document.getElementById('chmiInfoPopup').classList.remove('visible');
  document.getElementById('btnChmiInfo').classList.remove('active');
}

document.getElementById('btnChmiInfo').addEventListener('click', (e) => {
  e.preventDefault();       // the button sits inside .chk-row-wrap next to the checkbox's <label> -
  e.stopPropagation();      // stop the click from also toggling "CHMI data"
  const popup = document.getElementById('chmiInfoPopup');
  popup.classList.contains('visible') ? closeChmiInfoPopup() : openChmiInfoPopup();
});

document.addEventListener('click', (e) => {
  const popup = document.getElementById('chmiInfoPopup');
  if (popup.classList.contains('visible') &&
      !popup.contains(e.target) &&
      e.target.id !== 'btnChmiInfo') {
    closeChmiInfoPopup();
  }
});

