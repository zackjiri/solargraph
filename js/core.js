// ─── Projection constants ────────────────────────────────────────────────────
const R = 33;          // cylinder radius [mm]
const PAPER_W = 178;   // paper width [mm]
const PAPER_H = 127;   // paper height [mm]
const IMG_W = 1280;    // pixels for longer side (scan normalised to this)

let IMG_H = Math.round(IMG_W * PAPER_H / PAPER_W); // ~913
let scale = IMG_W / PAPER_W; // px/mm

// Image centre in pixels
let cx = IMG_W / 2;
let cy;  // set after image load

// ─── Pitch rotation: world (β,θ) → local camera coordinates ───────────────
// Pitch p (rad): positive = pinhole tilted toward zenith (can tilted forward/south)
// Rotation Ry(p) around east–west axis (Y-axis):
//   coordinate system: x = south, y = west, z = up
//   Ry(p) rotates in the x–z plane (south–up):
//     x' =  x·cos p + z·sin p
//     y' =  y
//     z' = −x·sin p + z·cos p
function applyPitch(beta_rad, theta_rad, p) {
  if (p === 0) return { b: beta_rad, t: theta_rad };
  const dx =  Math.cos(theta_rad) * Math.cos(beta_rad);  // south
  const dy =  Math.cos(theta_rad) * Math.sin(beta_rad);  // west
  const dz =  Math.sin(theta_rad);                        // up

  // Rotation Ry(p): in south–up plane
  const dx2 = dx * Math.cos(p) + dz * Math.sin(p);
  const dy2 = dy;
  const dz2 = -dx * Math.sin(p) + dz * Math.cos(p);

  const t2 = Math.asin(Math.max(-1, Math.min(1, dz2)));
  const b2 = Math.atan2(dy2, dx2);
  return { b: b2, t: t2 };
}

// Inverse pitch: local → world (used in pixelToAzEl)
function applyPitchInverse(beta_rad, theta_rad, p) {
  return applyPitch(beta_rad, theta_rad, -p);
}

// Roll: rotation around south axis (x), in west–up plane
// rho > 0: top of cylinder leans west (pushed from east); rho < 0: leans east
// Models lateral lean of cylinder axis – horizon becomes sinusoidal, not a straight tilt
function applyRoll(beta_rad, theta_rad, rho) {
  if (rho === 0) return { b: beta_rad, t: theta_rad };
  const dx =  Math.cos(theta_rad) * Math.cos(beta_rad);  // south
  const dy =  Math.cos(theta_rad) * Math.sin(beta_rad);  // west
  const dz =  Math.sin(theta_rad);                        // up

  // Rx(rho): keeps south fixed, rotates west–up plane
  const dy2 =  dy * Math.cos(rho) - dz * Math.sin(rho);
  const dz2 =  dy * Math.sin(rho) + dz * Math.cos(rho);

  const t2 = Math.asin(Math.max(-1, Math.min(1, dz2)));
  const b2 = Math.atan2(dy2, dx);
  return { b: b2, t: t2 };
}

function applyRollInverse(beta_rad, theta_rad, rho) {
  return applyRoll(beta_rad, theta_rad, -rho);
}

// ─── Inverse projection: pixel → (azimuth, elevation) ────────────────────
function pixelToAzEl(px, py) {
  const eCy = getEffectiveCy();
  const sx = (px - cx) / scale;
  const sy = (eCy - py) / scale;

  // Inverse linear horizontal: β = sx / (2·R·hScale)
  // Inverse vertical with cos(β) correction: tan(θ) = sy / (2·R·hScale·cos(β))
  const beta_local  = sx / (2 * R * hScale);
  const theta_local = Math.atan(sy / (2 * R * hScale * Math.cos(beta_local)));

  // Back to world coordinates: inverse pitch then inverse roll
  const p = pitchDeg * Math.PI / 180;
  const { b: b1, t: t1 } = applyPitchInverse(beta_local, theta_local, p);
  const rho = rollDeg * Math.PI / 180;
  const { b: beta_world, t: theta_world } = applyRollInverse(b1, t1, rho);

  const beta_deg  = beta_world  * 180 / Math.PI;
  const theta_deg = theta_world * 180 / Math.PI;

  const azimut_world = ((180 + beta_deg + yawDeg) + 360) % 360;

  return { beta_deg, theta_deg, azimut_world };
}

// ─── Forward projection: world (β, θ) → pixel ─────────────────────────────
// beta_deg: from south, positive = west; theta_deg: elevation
function azElToPixel(beta_deg, theta_deg) {
  const beta_rad  = beta_deg  * Math.PI / 180;
  const theta_rad = theta_deg * Math.PI / 180;

  // Transform world → camera frame: roll first, then pitch
  const rho = rollDeg * Math.PI / 180;
  const { b: b1, t: t1 } = applyRoll(beta_rad, theta_rad, rho);
  const p = pitchDeg * Math.PI / 180;
  let { b: bl, t: tl } = applyPitch(b1, t1, p);

  // Normalize bl to (−π, π] – applyRoll/Pitch early-return when rho/p=0
  // bypasses atan2, so bl may be outside (−π, π) for large yaw offsets.
  if (bl >  Math.PI) bl -= 2 * Math.PI;
  if (bl < -Math.PI) bl += 2 * Math.PI;

  // Guard against ±90° local elevation (tan overflow); full azimuth range is valid
  if (Math.abs(tl) >= Math.PI / 2 - 0.001) return null;

  // Linear horizontal: sx = 2·R·hScale·β
  // Perspective vertical with cos(β) correction: sy = 2·R·hScale·cos(β)·tan(θ)
  const sx = 2 * R * hScale * bl;
  const sy = 2 * R * hScale * Math.cos(bl) * Math.tan(tl);
  const px = cx + sx * scale;
  const py = getEffectiveCy() - sy * scale;

  return { px, py };
}

// ─── Inverse solar calculations ───────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_DAYS  = [31,28,31,30,31,30,31,31,30,31,30,31];

// Convert day-of-year to month/day string e.g. "Mar 15"
function doyToString(doy) {
  doy = ((Math.round(doy) - 1 + 365) % 365) + 1;
  let m = 0, d = doy;
  while (d > MONTH_DAYS[m]) { d -= MONTH_DAYS[m]; m++; }
  return MONTH_NAMES[m] + ' ' + d;
}

// From (azimut_world °, elevation °, lat rad) → { day1, day2, time }
// Returns null if outside valid range
function inverseSolar(az_world_deg, el_deg, phi_rad) {
  if (el_deg < 0) return null;

  const el  = el_deg  * Math.PI / 180;
  // az_south: azimuth measured from south (β), positive = west
  // az_world → az_south = az_world - 180
  const az_south = (az_world_deg - 180) * Math.PI / 180;

  // Declination from spherical trigonometry:
  // sin(δ) = sin(el)·sin(φ) - cos(el)·cos(φ)·cos(az_south)
  // (az_south=0 = south: sun on meridian → δ = el - φ or φ - el)
  const sinDelta = Math.sin(el) * Math.sin(phi_rad)
                 - Math.cos(el) * Math.cos(phi_rad) * Math.cos(az_south);
  if (Math.abs(sinDelta) > 1) return null;
  const delta = Math.asin(sinDelta);

  // Day of year from declination (two solutions: spring and autumn)
  // δ = 23.45° · sin(2π/365 · (d - 81))
  // sin⁻¹(δ / 23.45°) = 2π/365 · (d - 81)
  const maxDecl = 23.45 * Math.PI / 180;
  if (Math.abs(delta) > maxDecl) return null;
  const sinArg = delta / maxDecl;
  const angle  = Math.asin(sinArg); // −π/2 .. π/2

  // Two solutions in [1,365]:
  // d1 = 81 + angle·365/(2π)        (spring side)
  // d2 = 81 + (π − angle)·365/(2π)  (autumn side)
  const d1 = 81 + angle * 365 / (2 * Math.PI);
  const d2 = 81 + (Math.PI - angle) * 365 / (2 * Math.PI);

  // Hour angle H from el/phi/delta:
  // cos(H) = (sin(el) - sin(φ)·sin(δ)) / (cos(φ)·cos(δ))
  const cosH = (Math.sin(el) - Math.sin(phi_rad) * sinDelta)
             / (Math.cos(phi_rad) * Math.cos(delta));
  if (Math.abs(cosH) > 1) return null;
  let H = Math.acos(cosH); // 0..π
  // Afternoon: sun west of south on N, east of north on S
  // az_south > 0 means west of south (afternoon on N, morning on S)
  const westOfSouth = az_south > 0;
  if (hemisphere >= 0) {
    if (westOfSouth) H = -H;  // N: west = afternoon
  } else {
    if (!westOfSouth) H = -H; // S: east = afternoon (opposite)
  }

  // Solar time: H=0 → noon
  const solarHour = 12 - H * 180 / Math.PI / 15;
  if (solarHour < 0 || solarHour > 24) return null;

  const hh = Math.floor(solarHour);
  const mm = Math.floor((solarHour - hh) * 60);
  const timeStr = hh + ':' + String(mm).padStart(2, '0');

  // Southern hemisphere: shift dates by 182 days (local season correction)
  const shift = hemisphere >= 0 ? 0 : 182;
  return {
    day1: doyToString(d1 + shift),
    day2: doyToString(d2 + shift),
    time: timeStr
  };
}
function azimutToDir(az) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const idx = Math.round(az / 22.5) % 16;
  return dirs[idx];
}

// ─── Solar position calculations ──────────────────────────────────────────
let LAT = 50.0;        // latitude °N, precision 0.5°
let hemisphere = 1;    // +1 = northern, -1 = southern
const LON = 15.0;      // longitude °E (unused in solar time mode)

// Effective latitude: clamp poles and equator to avoid singularities
function effectiveLat() {
  const lat = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;
  return lat * Math.PI / 180;
}

// Solar declination for day-of-year d (1 = Jan 1)
function sunDeclination(dayOfYear) {
  return 23.45 * Math.PI / 180 * Math.sin(2 * Math.PI / 365 * (dayOfYear - 81));
}

// Day of year for given month/day
function dayOfYear(month, day) {
  const daysInMonth = [0,31,28,31,30,31,30,31,31,30,31,30,31];
  let d = day;
  for (let m = 1; m < month; m++) d += daysInMonth[m];
  return d;
}

// Azimuth and elevation of sun for hour angle H (rad), declination δ (rad), latitude φ (rad)
// Returns { az, el } in degrees; az = world azimuth 0=N, 90=E, 180=S, 270=W
function sunPosition(H, delta, phi) {
  const sinEl = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));

  const cosAz = (Math.sin(delta) - Math.sin(phi) * sinEl) / (Math.cos(phi) * Math.cos(el));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  // Afternoon correction (H > 0 → west side)
  if (Math.sin(H) > 0) az = 2 * Math.PI - az;

  return {
    az: az * 180 / Math.PI,          // world azimuth
    el: el * 180 / Math.PI,          // elevation
    beta: az * 180 / Math.PI - 180   // β from south (camera centre = south always)
  };
}

// Draw a single solar arc
// style: { color, lineWidth, showHourDots, showHourLabels, edgeLabel }
function drawSunArc(W, H, month, day, style) {
  const doy   = dayOfYear(month, day);
  const delta = sunDeclination(doy);
  const phi   = effectiveLat();

  // Sample at 0.25° steps for smooth curve
  const curvePoints = [];
  for (let hDeg = -180; hDeg <= 180; hDeg += 0.25) {
    const Hrad = hDeg * Math.PI / 180;
    const { el, beta } = sunPosition(Hrad, delta, phi);
    if (el < 0) continue;
    const pos = azElToPixel(beta - yawDeg, el);
    if (!pos) continue;
    if (pos.px < -20 || pos.px > W + 20) continue;
    curvePoints.push(pos);
  }

  if (curvePoints.length < 2) return;

  // Draw arc curve
  ctx.beginPath();
  ctx.moveTo(curvePoints[0].px, curvePoints[0].py);
  for (let i = 1; i < curvePoints.length; i++) ctx.lineTo(curvePoints[i].px, curvePoints[i].py);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash([]);
  ctx.stroke();

  // Edge label – clamped inside canvas
  if (showLabels && style.edgeLabel) {
    ctx.font = `${style.lineWidth >= 1.4 ? 'bold ' : ''}10px 'Share Tech Mono'`;
    // Labels always at full opacity – extract RGB from style.color and force alpha=1
    ctx.fillStyle = style.color.replace(/rgba\(([^,]+,[^,]+,[^,]+),[^)]+\)/, 'rgba($1,1)');
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 2.5;

    const left  = curvePoints[0];
    const right = curvePoints[curvePoints.length - 1];
    const pad = 2;

    ctx.textAlign = 'left';
    const lx = Math.max(pad, left.px + 4);
    ctx.strokeText(style.edgeLabel, lx, left.py - 4);
    ctx.fillText(style.edgeLabel,   lx, left.py - 4);

    ctx.textAlign = 'right';
    const rx = Math.min(W - pad, right.px - 4);
    ctx.strokeText(style.edgeLabel, rx, right.py - 4);
    ctx.fillText(style.edgeLabel,   rx, right.py - 4);
  }

  // Hourly dots and labels (equinox only)
  if (style.showHourDots) {
    for (let hDeg = -12 * 15; hDeg <= 12 * 15; hDeg += 15) {
      const Hrad = hDeg * Math.PI / 180;
      const { el, beta } = sunPosition(Hrad, delta, phi);
      if (el < 0) continue;
      const pos = azElToPixel(beta - yawDeg, el);
      if (!pos) continue;
      if (pos.px < 0 || pos.px > W || pos.py < 0 || pos.py > H) continue;

      // Solar hour label: mirror for southern hemisphere
      const solarHour = 12 + (hemisphere >= 0 ? hDeg : -hDeg) / 15;
      const label = Math.floor(solarHour) + ':00';

      ctx.beginPath();
      ctx.arc(pos.px, pos.py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = style.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      if (showLabels && style.showHourLabels) {
        ctx.font = "bold 10px 'Share Tech Mono'";
        ctx.fillStyle = style.color.replace(/rgba\(([^,]+,[^,]+,[^,]+),[^)]+\)/, 'rgba($1,1)');
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 2.5;
        ctx.textAlign = pos.px < W / 2 ? 'left' : 'right';
        const ox = pos.px < W / 2 ? 7 : -7;
        ctx.strokeText(label, pos.px + ox, pos.py - 4);
        ctx.fillText(label,   pos.px + ox, pos.py - 4);
      }
    }
  }
}

// Draw full set of solar arcs
function drawAllSunArcs(W, H) {
  const op = dispOpacity;
  // Intermediate arcs – thin yellow, no labels
  const thin = `rgba(255, 220, 60, ${Math.min(1, op * 0.40)})`;
  [[1,21],[2,21],[4,21],[5,21]].forEach(([m,d]) => {
    drawSunArc(W, H, m, d, { color: thin, lineWidth: 0.8,
      showHourDots: false, showHourLabels: false, edgeLabel: null });
  });

  // Local winter solstice – blue
  const winterMonth = hemisphere >= 0 ? 12 : 6;
  drawSunArc(W, H, winterMonth, 21, {
    color: `rgba(60, 180, 255, ${Math.min(1, op * 0.85)})`, lineWidth: 1.5,
    showHourDots: false, showHourLabels: false, edgeLabel: 'solstice'
  });

  // Equinox – yellow (with hour dots + labels)
  drawSunArc(W, H, 3, 21, {
    color: `rgba(255, 220, 60, ${Math.min(1, op * 0.85)})`, lineWidth: 1.5,
    showHourDots: true, showHourLabels: true, edgeLabel: 'equinox'
  });

  // Local summer solstice – red
  const summerMonth = hemisphere >= 0 ? 6 : 12;
  drawSunArc(W, H, summerMonth, 21, {
    color: `rgba(255, 100, 60, ${Math.min(1, op * 0.85)})`, lineWidth: 1.5,
    showHourDots: false, showHourLabels: false, edgeLabel: 'solstice'
  });
}

let showSunArc = false;
let showHeatmap = false;

const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvasContainer');
let imgBitmap = null;
let mouseX = -1, mouseY = -1;
let showGrid = true, showLabels = true, showHorizon = true;
let dispOpacity = 0.75;  // master opacity for all display overlays
let yawDeg   = 0;   // degrees, rotation from south (positive = west)
let pitchDeg   = 0;   // degrees, pitch – bends horizon via Ry rotation
let rollDeg = 0;   // degrees, roll around optical axis (±5°, step 0.1°)
let hScale     = 1.0; // derived: radius / R (updated when radius changes)
let radius     = 33;  // effective cylinder radius [mm]
let horizonMm = 0;   // mm, vertical offset of pinhole from paper centre (positive = above centre)
let scanWmm   = 178;  // mm represented by the full scan width (set by user)

// Effective cy corrected for pinhole vertical offset
function getEffectiveCy() {
  return cy + horizonMm * scale;
}

function setupCanvas(w, h) {
  canvas.width = w;
  canvas.height = h;
  IMG_H = h;
  cy = h / 2;
  cx = w / 2;
  scale = w / scanWmm;
  updateScanH();
  refreshCalibLimits();   // aspect ratio affects the horizon range
}

function updateScanH() {
  const el = document.getElementById('inpScanH');
  if (!el) return;
  el.value = canvas.width > 0
    ? Math.round(scanWmm * canvas.height / canvas.width)
    : '—';
}

// ─── Split screen ─────────────────────────────────────────────────────────
const splitHandle    = document.getElementById('splitHandle');
const btnSplitInvert = document.getElementById('btnSplitInvert');

let splitActive     = false;
let splitInverted   = false;
let splitBitmap     = null;   // L2 image bitmap
let splitX          = 0.5;    // relative 0–1 within image bounds
let isDraggingSplit = false;
let splitOpacity    = 1.0;    // L2 layer opacity (0.1–1.0)

// Returns the actual image bounds inside the canvas-container
// (canvas is CSS width/height 100% but image has a natural aspect ratio)
function getImageBounds() {
  const rect = container.getBoundingClientRect();
  const cw = canvas.width;
  const ch = canvas.height;
  const cr = rect.width / rect.height;
  const ir = cw / ch;
  let iw, ih, ox, oy;
  if (ir > cr) {
    iw = rect.width;
    ih = rect.width / ir;
    ox = 0;
    oy = (rect.height - ih) / 2;
  } else {
    ih = rect.height;
    iw = rect.height * ir;
    ox = (rect.width - iw) / 2;
    oy = 0;
  }
  return { iw, ih, ox, oy };
}

function setSplitMode(active) {
  stopL2Loop();                 // cancel auto-loop on any split state change
  splitActive = active;
  splitHandle.style.display    = active ? 'block' : 'none';
  btnSplitInvert.style.display = active ? 'flex'  : 'none';
  container.style.cursor = active ? 'col-resize' : 'none';
  document.getElementById('l2OpacityRow').style.display = active ? 'block' : 'none';
  draw();
}

// Called from draw() – draws L2 with opacity blend onto mainCanvas
function drawSplitOverlay(W, H) {
  if (!splitActive || !splitBitmap) return;
  const splitPx = Math.round(splitX * W);

  ctx.save();
  ctx.beginPath();
  if (!splitInverted) {
    ctx.rect(0, 0, splitPx, H);             // L2 on left (default)
  } else {
    ctx.rect(splitPx, 0, W - splitPx, H);   // L2 on right (swapped)
  }
  ctx.clip();

  // Inside L2 clip only:
  // 1. Draw L2 at 100% — covers the L1 that was drawn beneath
  ctx.drawImage(splitBitmap, 0, 0, W, H);
  // 2. Draw L1 back at (1 − splitOpacity) — blends L1 into L2
  //    Result: L2 * splitOpacity + L1 * (1 − splitOpacity)
  if (imgBitmap && splitOpacity < 1.0) {
    ctx.globalAlpha = 1.0 - splitOpacity;
    ctx.drawImage(imgBitmap, 0, 0, W, H);
    ctx.globalAlpha = 1.0;
  }

  ctx.restore();   // removes clip, restores globalAlpha — L1 side untouched

  // Update handle position – map canvas px → container px
  updateHandlePosition(splitPx, W);
}

function updateHandlePosition(splitPx, canvasW) {
  const bounds = getImageBounds();
  const handleX = bounds.ox + (splitPx / canvasW) * bounds.iw;
  splitHandle.style.left = handleX + 'px';
}

// Load L2 bitmap for split
function loadSplitImage(genId, imageIndex) {
  const path = `img/GEN-${genId}_${imageIndex}_L2.jpg`;
  const imgEl = new Image();
  imgEl.onload = () => {
    createImageBitmap(imgEl).then(bm => {
      splitBitmap = bm;
      if (splitActive) draw();
    });
  };
  imgEl.onerror = () => { splitBitmap = null; };
  imgEl.src = path;
}

// Drag – move split position
container.addEventListener('mousedown', (e) => {
  if (!splitActive) return;
  if (e.target === btnSplitInvert) return; // click on the button is not part of the split drag
  isDraggingSplit = true;
  moveSplit(e.clientX);
});

window.addEventListener('mousemove', (e) => {
  if (!splitActive || !isDraggingSplit) return;
  moveSplit(e.clientX);
});

window.addEventListener('mouseup', () => { isDraggingSplit = false; });

container.addEventListener('touchstart', (e) => {
  if (!splitActive) return;
  if (e.target.closest('#btnSplitInvert')) return; // tap on rotate button – don't move split
  isDraggingSplit = true;
  moveSplit(e.touches[0].clientX);
}, { passive: true });

container.addEventListener('touchmove', (e) => {
  if (!splitActive || !isDraggingSplit) return;
  moveSplit(e.touches[0].clientX);
}, { passive: true });

container.addEventListener('touchend', () => { isDraggingSplit = false; });

function moveSplit(clientX) {
  const bounds = getImageBounds();
  const rect   = container.getBoundingClientRect();
  // Clamp to image bounds only (not letterbox area)
  const relX = (clientX - rect.left - bounds.ox) / bounds.iw;
  splitX = Math.max(0, Math.min(1, relX));
  draw();
}

btnSplitInvert.addEventListener('click', () => {
  splitInverted = !splitInverted;
  btnSplitInvert.classList.toggle('active', splitInverted);
  draw();
});

// ─── Vignetting isolines: constant α = angle from optical axis ───────────
// cos(α) = cos(β_local) · cos(θ_local)
// Isolines for α = 70–80° step 2°, white dotted, opacity scales with dispOpacity.
// Labels (showLabels) only for 70° and 80°, at all four corners of canvas.

function drawVignetteIsolines(W, H) {
  const op = dispOpacity;
  const alphas = [60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80];
  const eCy = getEffectiveCy();

  // Track extreme visible points per isoline per side for label placement
  const bottomL = new Array(alphas.length).fill(null);
  const bottomR = new Array(alphas.length).fill(null);
  const topL    = new Array(alphas.length).fill(null);
  const topR    = new Array(alphas.length).fill(null);

  for (let i = 0; i < alphas.length; i++) {
    const alpha = alphas[i];
    const baseOpacity = 0.20 + i * (0.80 / (alphas.length - 1));
    const finalOpacity = Math.min(1, baseOpacity * op);
    const color = `rgba(255,255,255,${finalOpacity.toFixed(3)})`;
    const cosA = Math.cos(alpha * Math.PI / 180);

    for (const sign of [+1, -1]) {
      const points = [];
      for (let bDeg = -89; bDeg <= 89; bDeg += 0.5) {
        const beta_local = bDeg * Math.PI / 180;
        const cosB = Math.cos(beta_local);
        if (Math.abs(cosB) < 1e-6) continue;
        const cosTheta = cosA / cosB;
        if (Math.abs(cosTheta) > 1) continue;
        const theta_local = sign * Math.acos(cosTheta);
        const sx = 2 * R * hScale * beta_local;
        const sy = 2 * R * hScale * Math.cos(beta_local) * Math.tan(theta_local);
        const px = cx + sx * scale;
        const py = eCy - sy * scale;
        if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
        points.push({ px, py });

        if (px >= 0 && px <= W && py >= 0 && py <= H) {
          if (bDeg <= 0) {
            if (!bottomL[i] || py > bottomL[i].py) bottomL[i] = { px, py };
            if (!topL[i]    || py < topL[i].py)    topL[i]    = { px, py };
          }
          if (bDeg >= 0) {
            if (!bottomR[i] || py > bottomR[i].py) bottomR[i] = { px, py };
            if (!topR[i]    || py < topR[i].py)    topR[i]    = { px, py };
          }
        }
      }
      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(points[0].px, points[0].py);
      for (let j = 1; j < points.length; j++) ctx.lineTo(points[j].px, points[j].py);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Labels: only 70° and 80°, at all four corners (top/bottom × left/right)
  if (!showLabels) return;

  ctx.font = "9px 'Share Tech Mono'";
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.textAlign = 'center';

  for (const i of [0, 5, alphas.length - 1]) {
    const t = alphas[i] + '°';
    if (bottomL[i]) { ctx.strokeText(t, bottomL[i].px, H - 6);  ctx.fillText(t, bottomL[i].px, H - 6); }
    if (bottomR[i]) { ctx.strokeText(t, bottomR[i].px, H - 6);  ctx.fillText(t, bottomR[i].px, H - 6); }
    if (topL[i])    { ctx.strokeText(t, topL[i].px,    10);      ctx.fillText(t, topL[i].px,    10); }
    if (topR[i])    { ctx.strokeText(t, topR[i].px,    10);      ctx.fillText(t, topR[i].px,    10); }
  }
}

