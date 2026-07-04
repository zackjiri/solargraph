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

  // Custom date arc – black outline + green fill, with label at south axis. When the CHMI
  // legend toggle is on, the gradient trace replaces both (a halo under the green line wasn't
  // legible) - same curve, coloured by measured sunshine instead of a flat green.
  if (showCustomArc) {
    const op = dispOpacity;
    const { month: cm, day: cd } = customArcDate();
    if (typeof showImgChmi !== 'undefined' && showImgChmi) {
      const chmiW = 9;   // matches the Sun symbol dot drawn elsewhere (radius 4.5) - canvas size, not a physical disc
      const chmiByDoy  = _sgEnsureChmiByDoy();
      const dayCovered = !!(chmiByDoy && chmiByDoy.get(dayOfYear(customMonth, customDay)));
      if (dayCovered) {
        // Thin dark-grey border above/below the band - same "wider line underneath" trick as
        // the black outline used for the green path, just narrower peek since this one is thin.
        drawSunArc(W, H, cm, cd, {
          color: `rgba(60,60,60,${Math.min(1, op * 0.85)})`, lineWidth: chmiW + 2,
          showHourDots: false, showHourLabels: false, edgeLabel: null
        });
        drawChmiArc(W, H, cm, cd, chmiW);
      } else {
        // This image has CHMI data, but not for the currently selected Custom Path day - a
        // flat, translucent grey (no gradient, no border): we genuinely have no information for
        // this day, distinct from the gradient's own dark "confirmed no sun" colour.
        drawSunArc(W, H, cm, cd, {
          color: `rgba(160,160,160,${Math.min(1, op * 0.5)})`, lineWidth: chmiW,
          showHourDots: false, showHourLabels: false, edgeLabel: null
        });
      }
    } else {
      drawSunArc(W, H, cm, cd, {
        color: `rgba(0,0,0,${Math.min(1, op * 0.85)})`, lineWidth: 3.5,
        showHourDots: false, showHourLabels: false, edgeLabel: null
      });
      drawSunArc(W, H, cm, cd, {
        color: `rgba(80, 220, 120, ${Math.min(1, op * 0.9)})`, lineWidth: 1.5,
        showHourDots: false, showHourLabels: false, edgeLabel: null
      });
    }

    // Label anchored to south axis, offset 8px right, above the arc at that point
    // Find arc y-position at south axis (β=0, i.e. pixel x = cx adjusted for yawDeg)
    const doy   = dayOfYear(customMonth, customDay);
    const delta = sunDeclination(doy);
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
      const dDelta = sunDeclination(dayOfYear(cm, cd));
      const hDeg = (sunTimeHours - noonHour()) * 15 * hemisphere;
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
}

// CHMI measured-sunshine trace along the Custom Path curve - replaces the black+green line
// when the legend toggle is on. Same point sequence as drawSunArc (sunPosition + azElToPixel),
// sampled at 2.5° steps (= 10 min, matching the data's own resolution) and stroked segment-by-
// segment so each 10-min bucket gets its own flat colour (hard edges, no blending - consistent
// with the Sun Graph cells). Wherever the curve exists (sun above horizon) but there is no
// measurement (no dataset for the day, or a missing/QUALITY=4 sample), the segment defaults to
// the gradient's darkest "not shining" colour instead of leaving a gap - same always-painted
// default as the Sun Graph's night band, just applied along the arc instead of a rectangle.
// cm/cd = the (possibly SH-shifted) path-convention date the curve itself is plotted with;
// the CHMI lookup uses the real, unshifted custom date since weather is tied to a real calendar day.
function drawChmiArc(W, H, cm, cd, lineWidth) {
  const chmiByDoy  = _sgEnsureChmiByDoy();
  const daySamples = chmiByDoy ? chmiByDoy.get(dayOfYear(customMonth, customDay)) : null;
  const bySlot = new Map();   // slot 0..143 (10-min index into the day) → seconds
  if (daySamples) for (const [hour, sec] of daySamples) bySlot.set(Math.round(hour * 6), sec);

  const delta = sunDeclination(dayOfYear(cm, cd));
  const phi   = effectiveLat();
  const op    = dispOpacity;
  const alpha = Math.min(1, op * 0.9);

  let prevPos = null, prevSec = 0;   // 0 = "not shining" default for the very first segment
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
      ctx.strokeStyle = _sgChmiColor(prevSec, alpha);
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    const solarHour = noonHour() + (hemisphere >= 0 ? hDeg : -hDeg) / 15;
    const slot = ((Math.round(solarHour * 6) % 144) + 144) % 144;
    const sec = pos ? bySlot.get(slot) : undefined;
    prevSec = (sec !== undefined && sec !== null) ? sec : 0;
    prevPos = pos;
  }
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

    const points = [];
    for (let el = -85; el <= 85; el += 0.5) {
      const pos = azElToPixel(beta, el);
      if (!pos) continue;
      if (pos.py < -20 || pos.py > H + 20) continue;
      if (pos.px < -20 || pos.px > W + 20) continue;
      points.push(pos);
    }
    if (points.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(points[0].px, points[0].py);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].px, points[i].py);

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

  // Elevation isolines every 10° – full 360° with segment handling
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
        if (seg.length >= 2) segments.push(seg);
        seg = [];
      }
    }
    if (seg.length >= 2) segments.push(seg);
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
    for (let az = 0; az < 360; az += 0.5) {
      const b   = az - 180 - yawDeg;
      const pos = azElToPixel(b, theta_deg);
      if (pos && pos.px >= -20 && pos.px <= W + 20 && pos.py >= -20 && pos.py <= H + 20) {
        elSeg.push(pos);
      } else {
        if (elSeg.length >= 2) elSegs.push(elSeg);
        elSeg = [];
      }
    }
    if (elSeg.length >= 2) elSegs.push(elSeg);
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
    const azPoints = [];
    for (let el = -85; el <= 85; el += 0.5) {
      const pos = azElToPixel(beta_deg, el);
      if (!pos) continue;
      if (pos.py < -20 || pos.py > H + 20) continue;
      azPoints.push(pos);
    }
    if (azPoints.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(azPoints[0].px, azPoints[0].py);
      for (let i = 1; i < azPoints.length; i++) ctx.lineTo(azPoints[i].px, azPoints[i].py);
      ctx.strokeStyle = 'rgba(80,80,80,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.stroke();
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

