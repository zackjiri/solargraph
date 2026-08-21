// ─── 3D Can Orientation Visualizer ─────────────────────────────────────────
// Camera: SW + above (south=+X, west=+Y, up=+Z in world coords)
// CAM = (2.32, 2.32, 2.29) → camera is south-west-above, looking at origin
// From SW: south appears RIGHT, west appears LEFT — intuitive axis layout.
// Camera basis (verified: origin projects to screen center):
// Camera for 3D projection (world: x=south, y=west, z=up)
// Parameterised by azimuth (angle from +x axis toward +y) and elevation above horizon.
const _3D = {
  camAz:    Math.PI / 4,       // 45° — camera sits SW of origin (x=south+, y=west+)
  camEl:    0.35,              // ~20° above horizon (was ~35°)
  camDist:  4.0,
  FOCAL:    3.0,
  BASE_SCL: 85,
  BASE_MIN: 164,
  zoom:     1.0,              // theater zoom factor (0.5–2×, applied only in theater)
  // derived vectors – computed by updateCamera():
  CAM:   [0, 0, 0],
  FWD:   [0, 0, 0],
  RIGHT: [0, 0, 0],
  CAMUP: [0, 0, 0],
};

function updateCamera() {
  const { camAz, camEl, camDist } = _3D;
  const cx = camDist * Math.cos(camEl) * Math.cos(camAz);
  const cy = camDist * Math.cos(camEl) * Math.sin(camAz);
  const cz = camDist * Math.sin(camEl);
  _3D.CAM = [cx, cy, cz];
  _3D.FWD = [-cx / camDist, -cy / camDist, -cz / camDist];
  // RIGHT = world_up × FWD, normalised in XY plane
  const rlen = Math.sqrt(_3D.FWD[0] ** 2 + _3D.FWD[1] ** 2) || 1e-9;
  _3D.RIGHT = [-_3D.FWD[1] / rlen, _3D.FWD[0] / rlen, 0];  // world_up × FWD, normalised
  // CAMUP = FWD × RIGHT  (points sky-ward)
  _3D.CAMUP = [
    _3D.FWD[1] * _3D.RIGHT[2] - _3D.FWD[2] * _3D.RIGHT[1],
    _3D.FWD[2] * _3D.RIGHT[0] - _3D.FWD[0] * _3D.RIGHT[2],
    _3D.FWD[0] * _3D.RIGHT[1] - _3D.FWD[1] * _3D.RIGHT[0],
  ];
}
updateCamera();  // initialise vectors from default angles

let theaterMode3D = false;

function draw3D() {
  const cv = theaterMode3D
    ? document.getElementById('can3dTheater')
    : document.getElementById('can3d');
  const c  = cv.getContext('2d');
  const CW = cv.width, CH = cv.height;
  // Preview panel is CSS-zoomed 1.25× (UI magnification); counter the model by 1/1.25 so the
  // cylinder is not magnified, while the canvas element stays as wide as the other panel items.
  const SCL = _3D.BASE_SCL * Math.min(CW, CH) / _3D.BASE_MIN * (theaterMode3D ? _3D.zoom : 0.8);
  const OX  = CW / 2, OY = CH * 0.50;
  function proj([x, y, z]) {
    const dx = x - _3D.CAM[0], dy = y - _3D.CAM[1], dz = z - _3D.CAM[2];
    const d  = _3D.FWD[0]*dx + _3D.FWD[1]*dy + _3D.FWD[2]*dz;
    if (d < 0.05) return null;
    const f  = _3D.FOCAL / d;
    const sx = _3D.RIGHT[0]*dx + _3D.RIGHT[1]*dy;
    const sy = _3D.CAMUP[0]*dx + _3D.CAMUP[1]*dy + _3D.CAMUP[2]*dz;
    return [OX + sx * f * SCL, OY - sy * f * SCL];
  }
  c.clearRect(0, 0, CW, CH);

  // ── Theme-aware colour palette ────────────────────────────────────────────
  const _lt = document.body.classList.contains('light');
  const pal = _lt ? {
    bg:          '#ffffff',
    grid:        'rgba(25,60,120,0.38)',
    compassS:    '#b81212',
    compassN:    '#1245a0',
    compassW:    '#0c5828',
    compassE:    '#186e20',
    zAxis:       '#0c38b8',
    gapBack:     'rgba(85,48,0,0.30)',
    gapFront:    'rgba(115,62,0,0.82)',
    paperBack:   'rgba(18,52,100,0.35)',
    paperFront:  'rgba(20,85,165,0.88)',
    paperArc:    'rgba(20,85,165,0.62)',
    gapArc:      'rgba(115,62,0,0.62)',
    axisOut:     '#111111',            // light mode: black when noon is inactive
    axisHit:     '#e8a020',            // semantic color – kept in both themes
    axisMiss:    '#e04040',            // semantic color – kept in both themes
    pinhole:     '#e8a020',            // semantic color – kept in both themes
    pinholeRing: 'rgba(0,0,0,0.28)',
    horizon:     'rgba(12,72,40,0.50)',
    label:       'rgba(15,35,60,0.78)',
    legAxis:     '#111111',            // sidebar legend – optical axis (black when noon is inactive)
    legHorizon:  '#1a7050',            // sidebar legend – pinhole level line
    legPaper:    '#1660a0',            // sidebar legend – photopaper line
    legN:        '#1245a0',
  } : {
    bg:          '#07090d',
    grid:        'rgba(50,100,155,0.85)',
    compassS:    '#e84040',
    compassN:    '#7090c0',
    compassW:    '#50dc78',
    compassE:    '#78c878',
    zAxis:       '#4080e8',
    gapBack:     'rgba(200,140,30,0.55)',
    gapFront:    'rgba(232,160,32,0.75)',
    paperBack:   'rgba(80,140,210,0.60)',
    paperFront:  'rgba(90,170,208,0.8)',
    paperArc:    'rgba(90,170,208,0.65)',
    gapArc:      'rgba(232,160,32,0.65)',
    axisOut:     '#d8e8f8',
    axisHit:     '#e8a020',
    axisMiss:    '#e04040',
    pinhole:     '#e8a020',
    pinholeRing: 'rgba(0,0,0,0.60)',
    horizon:     'rgba(136,204,170,0.55)',
    label:       'rgba(74,90,106,0.85)',
    legAxis:     '#d8e8f8',
    legHorizon:  '#88ccaa',
    legPaper:    '#5aaad0',
    legN:        '#7090c0',
  };

  c.fillStyle = pal.bg;
  c.fillRect(0, 0, CW, CH);

  // Legend: fixed world-space labels + sidebar swatch colours (theme-aware)
  { const ls = document.getElementById('legS');
    const ln = document.getElementById('legN');
    if (ls) { ls.style.color = _lt ? pal.compassS : '#e84040'; ls.textContent = 'S'; }
    if (ln) { ln.style.color = pal.legN; ln.textContent = 'N'; }
    // Sidebar swatches that have hardcoded light colours
    const legHorizLine = document.querySelector('#can3dLegend .leg-line:not(.dashed)');
    const legPaperLine = document.querySelectorAll('#can3dLegend .leg-line')[1];
    if (legHorizLine) legHorizLine.style.borderColor = pal.legHorizon;
    if (legPaperLine) legPaperLine.style.borderColor = pal.legPaper;
  }

  // SH: add 180° so the can faces north (world −x), matching real-world placement.
  // All subsequent hemisphere-aware calculations still work correctly with this flip.
  const yr = (yawDeg + (hemisphere < 0 ? 180 : 0)) * Math.PI / 180;
  const pr = pitchDeg * Math.PI / 180;
  const rr = rollDeg  * Math.PI / 180;
  // Half-height in mm derived from current scan aspect ratio
  const halfHmm = canvas.width > 0
    ? scanWmm * canvas.height / canvas.width / 2
    : scanWmm * PAPER_H / PAPER_W / 2;
  const RN = radius / halfHmm;      // normalized radius
  const hO = horizonMm / halfHmm;   // normalized pinhole vertical offset
  const N  = 12;                // vertical edge count: 2 gap segments + 10 paper segments
  // Label font size + line weight: scale proportionally in theater mode
  const fs    = theaterMode3D ? Math.min(14, Math.max(9, Math.round(CW / 65))) : 8;
  const lwMul = fs / 8;
  const HH = 1.0;               // normalized half-height

  // ── Dynamic paper arc: actual scan width wrapped around cylinder ──────────
  // Arc length = scan_w_mm = radius * paper_angle  →  paper_angle = scan_w_mm / radius
  const paperAngle = Math.min(2 * Math.PI - 0.01, scanWmm / radius);
  const halfGap    = (2 * Math.PI - paperAngle) / 2;   // half-angle of pinhole zone

  // Update legend label with computed degrees
  { const sp = document.getElementById('legPaperSpan');
    if (sp) sp.textContent = 'photopaper (' + Math.round(paperAngle * 180 / Math.PI) + '°)'; }

  // 12 edge angles: edge 0 at pinhole (south=0), edges 1–10 in paper zone, edge 11 at -halfGap
  function edgeAngle(i) {
    if (i === 0)  return 0;
    if (i === 11) return 2 * Math.PI - halfGap;
    return halfGap + (i - 1) * paperAngle / 10;
  }

  // Pinhole gap: dynamic half-angle (replaces fixed GAP = 30°)
  function inGap(a) {
    let n = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (n > Math.PI) n = 2 * Math.PI - n;
    return n <= halfGap + 1e-9;
  }

  // Rotate can geometry: inverse of camera transforms (negate pitch & roll).
  // applyRoll/applyPitch transform world rays → camera space.
  // To show can in world space we apply the inverse: Ry(-pitch) ∘ Rx(-roll) ∘ Rz(yaw).
  function rotCan(x, y, z) {
    // 1. Ry(-pitch): inverse camera pitch — in can-local frame before yaw
    let x0 = x*Math.cos(pr) - z*Math.sin(pr);
    let y0 = y;
    let z0 = x*Math.sin(pr) + z*Math.cos(pr);
    // 2. Rx(-roll): inverse camera roll — in can-local frame after pitch correction
    let x1 = x0;
    let y1 = y0*Math.cos(rr) + z0*Math.sin(rr);
    let z1 = -y0*Math.sin(rr) + z0*Math.cos(rr);
    // 3. Rz(yaw): rotate whole can to correct world azimuth
    let x2 = x1*Math.cos(yr) - y1*Math.sin(yr);
    let y2 = x1*Math.sin(yr) + y1*Math.cos(yr);
    let z2 = z1;
    return [x2, y2, z2];
  }
  const R = rotCan;

  // Inverse of rotCan: transforms world-space vector back to can-local frame.
  // rotCan = Ry(−pitch) → Rx(−roll) → Rz(yaw)
  // inverse = Rz(−yaw) → Rx(+roll) → Ry(+pitch)
  function rotCanInv(x, y, z) {
    let x0 =  x*Math.cos(yr) + y*Math.sin(yr);   // Rz(-yaw)
    let y0 = -x*Math.sin(yr) + y*Math.cos(yr);
    let z0 = z;
    let x1 = x0;                                   // Rx(+roll)
    let y1 =  y0*Math.cos(rr) - z0*Math.sin(rr);
    let z1 =  y0*Math.sin(rr) + z0*Math.cos(rr);
    let x2 =  x1*Math.cos(pr) + z1*Math.sin(pr);  // Ry(+pitch)
    let y2 = y1;
    let z2 = -x1*Math.sin(pr) + z1*Math.cos(pr);
    return [x2, y2, z2];
  }

  // ── Custom-day sun geometry, shared by the path, the hourly arrows and the
  //    animated sun ray. Maps a sun hour-angle (deg) onto the paper surface.
  //    Because the projection is x = 2·r·α, the flat-scan pixel IS the arc length,
  //    so a 2D path point (px,py) maps onto the cylinder with no extra optics:
  //      a = π + (px − cx)/(scale·radius)   central angle from the back-wall centre
  //      z = (py − cy)/(scale·halfHmm)      height (canvas-down → paper-up)
  //    Returns { pt:[x,y], a, z } or null (below horizon / off paper / behind camera).
  const _cArc   = customArcDate();
  const _cDelta = sunDeclination(dayOfYear(_cArc.month, _cArc.day));
  const _cPhi   = effectiveLat();
  const _aMin = halfGap, _aMax = 2 * Math.PI - halfGap;
  function surfMap(hDeg) {
    const s = sunPosition(hDeg * Math.PI / 180, _cDelta, _cPhi);
    if (s.el < 0) return null;
    const pos = azElToPixel(s.beta - yawDeg, s.el);
    if (!pos) return null;
    const a = Math.PI + (pos.px - cx) / (scale * radius);
    const z = (pos.py - cy) / (scale * halfHmm);
    if (a < _aMin || a > _aMax || z < -HH || z > HH) return null;   // off paper
    const pt = proj(R(RN * Math.cos(a), RN * Math.sin(a), z));
    return pt ? { pt, a, z } : null;
  }

  // ── Floor gradient fill ──
  { const GS2 = 0.35, gn2 = 3;
    const fc = proj([0, 0, -HH]);
    const fl = [proj([-gn2*GS2,-gn2*GS2,-HH]),proj([gn2*GS2,-gn2*GS2,-HH]),proj([gn2*GS2,gn2*GS2,-HH]),proj([-gn2*GS2,gn2*GS2,-HH])];
    if (fl.every(Boolean) && fc) {
      c.beginPath(); c.moveTo(fl[0][0],fl[0][1]); fl.slice(1).forEach(p=>c.lineTo(p[0],p[1])); c.closePath();
      const gr = c.createRadialGradient(fc[0],fc[1],0, fc[0],fc[1], Math.min(CW,CH)*0.55);
      if (_lt) {
        gr.addColorStop(0,'rgba(175,190,210,0.68)');
        gr.addColorStop(0.65,'rgba(200,210,225,0.38)');
        gr.addColorStop(1,'rgba(220,225,235,0.08)');
      } else {
        gr.addColorStop(0,'rgba(18,36,62,0.78)');
        gr.addColorStop(0.65,'rgba(9,18,36,0.55)');
        gr.addColorStop(1,'rgba(3,7,15,0.18)');
      }
      c.fillStyle = gr; c.fill();
    }
  }

  // ── Floor grid (world-space, does not rotate) ──
  c.lineWidth = 0.8 * lwMul;
  c.setLineDash([2, 4]);
  const GS = 0.35, gn = 3;
  for (let i = -gn; i <= gn; i++) {
    const a = proj([i * GS, -gn * GS, -HH]);
    const b = proj([i * GS,  gn * GS, -HH]);
    const d = proj([-gn * GS, i * GS, -HH]);
    const e = proj([ gn * GS, i * GS, -HH]);
    c.strokeStyle = pal.grid;
    if (a && b) { c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]); c.stroke(); }
    if (d && e) { c.beginPath(); c.moveTo(d[0],d[1]); c.lineTo(e[0],e[1]); c.stroke(); }
  }
  c.setLineDash([]);

  // ── Compass rose at floor level (world-fixed N/S/E/W) ──
  const CR = gn * GS; // arrow length – reaches tile edges (= 1.05)
  const roseCenter = [0, 0, -HH];
  const rc = proj(roseCenter);
  if (rc) {
    // Fixed world-space labels: +x = south, -x = north, regardless of hemisphere.
    // The SH 180° yaw flip already orients the can correctly, so no label swap needed.
    const cardinals = [
      { tip: [ CR,  0, -HH], color: pal.compassS, label: 'S' },
      { tip: [-CR,  0, -HH], color: pal.compassN, label: 'N' },
      { tip: [  0, CR, -HH], color: pal.compassW, label: 'W' },
      { tip: [  0,-CR, -HH], color: pal.compassE, label: 'E' },
    ];
    for (const card of cardinals) {
      const ep = proj(card.tip);
      if (!ep) continue;
      c.beginPath(); c.moveTo(rc[0], rc[1]); c.lineTo(ep[0], ep[1]);
      c.strokeStyle = card.color; c.lineWidth = 1.5 * lwMul; c.setLineDash([]); c.stroke();
      // Arrowhead
      const dx = ep[0]-rc[0], dy = ep[1]-rc[1], len = Math.sqrt(dx*dx+dy*dy);
      if (len > 3) {
        const nx = dx/len, ny = dy/len;
        c.beginPath();
        c.moveTo(ep[0], ep[1]);
        c.lineTo(ep[0]-nx*6-ny*3, ep[1]-ny*6+nx*3);
        c.lineTo(ep[0]-nx*6+ny*3, ep[1]-ny*6-nx*3);
        c.closePath(); c.fillStyle = card.color; c.fill();
      }
      c.font = `bold ${fs}px 'Share Tech Mono'`;
      c.fillStyle = card.color; c.textAlign = 'center';
      c.fillText(card.label, ep[0] + (ep[0]-rc[0])*0.25, ep[1] + (ep[1]-rc[1])*0.25 - 1);
    }
  }

  // ── Z axis: solid up + dashed below floor ──
  const zO = proj([0, 0, -HH]);
  const zUp   = proj([0, 0, -HH + 0.9]);
  const zDown = proj([0, 0, -HH - 0.5]);
  if (zO && zUp) {
    c.beginPath(); c.moveTo(zO[0], zO[1]); c.lineTo(zUp[0], zUp[1]);
    c.strokeStyle = pal.zAxis; c.lineWidth = 1.5 * lwMul; c.setLineDash([]); c.stroke();
    const dx = zUp[0]-zO[0], dy = zUp[1]-zO[1], len = Math.sqrt(dx*dx+dy*dy);
    if (len > 3) {
      const nx = dx/len, ny = dy/len;
      c.beginPath();
      c.moveTo(zUp[0], zUp[1]);
      c.lineTo(zUp[0]-nx*6-ny*3, zUp[1]-ny*6+nx*3);
      c.lineTo(zUp[0]-nx*6+ny*3, zUp[1]-ny*6-nx*3);
      c.closePath(); c.fillStyle = pal.zAxis; c.fill();
    }
    c.font = `bold ${fs}px 'Share Tech Mono'`;
    c.fillStyle = pal.zAxis; c.textAlign = 'center';
    c.fillText('Z', zUp[0], zUp[1] - 4);
  }
  if (zO && zDown) {
    c.beginPath(); c.moveTo(zO[0], zO[1]); c.lineTo(zDown[0], zDown[1]);
    c.strokeStyle = pal.zAxis; c.lineWidth = 1.0 * lwMul; c.setLineDash([3, 3]); c.stroke();
    c.setLineDash([]);
  }

  // ── Shading helpers ──────────────────────────────────────────────────────────
  function _dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function _nor3(v){const l=Math.sqrt(v[0]**2+v[1]**2+v[2]**2);return l<1e-10?v:[v[0]/l,v[1]/l,v[2]/l];}
  function _dep3(p){return _3D.FWD[0]*(p[0]-_3D.CAM[0])+_3D.FWD[1]*(p[1]-_3D.CAM[1])+_3D.FWD[2]*(p[2]-_3D.CAM[2]);}
  const _LMAIN = _nor3([0.58,-0.10,0.80]);   // main light (sun-ish, south-upper)
  const _LFILL = _nor3([-0.32,0.22,0.14]);   // soft fill from opposite
  const _LCAM  = _nor3([_3D.CAM[0],_3D.CAM[1],_3D.CAM[2]]); // camera direction (for specular)
  function _shd(norm) {
    const d1 = Math.max(0,_dot3(norm,_LMAIN));
    const d2 = Math.max(0,_dot3(norm,_LFILL))*0.11;
    const H2 = _nor3([_LMAIN[0]+_LCAM[0],_LMAIN[1]+_LCAM[1],_LMAIN[2]+_LCAM[2]]);
    const sp = Math.pow(Math.max(0,_dot3(norm,H2)),28)*0.20;
    return {b:Math.min(1.1,0.16+0.74*d1+d2), sp:Math.min(0.28,sp)};
  }
  function _pCol(b,sp,front) { // paper zone
    if (_lt) {
      const r=Math.round(Math.min(255,70+100*b+sp*175)),g=Math.round(Math.min(255,105+108*b+sp*180)),bl=Math.round(Math.min(255,140+98*b+sp*195));
      return `rgba(${r},${g},${bl},${front?0.88:0.46})`;
    }
    const r=Math.round(Math.min(255,22+110*b+sp*210)),g=Math.round(Math.min(255,48+125*b+sp*215)),bl=Math.round(Math.min(255,78+140*b+sp*235));
    return `rgba(${r},${g},${bl},${front?0.91:0.52})`;
  }
  function _gCol(b,sp,front) { // gap zone
    if (_lt) {
      const r=Math.round(Math.min(255,110+105*b+sp*155)),g=Math.round(Math.min(255,68+72*b+sp*115)),bl=Math.round(Math.min(255,14+18*b+sp*50));
      return `rgba(${r},${g},${bl},${front?0.80:0.38})`;
    }
    const r=Math.round(Math.min(255,50+155*b+sp*175)),g=Math.round(Math.min(255,28+75*b+sp*130)),bl=Math.round(Math.min(255,3+16*b+sp*55));
    return `rgba(${r},${g},${bl},${front?0.84:0.40})`;
  }

  // ── Shaded cylinder surface (360 strips, painter-sorted) ────────────────────
  { const NSTR = 360;
    const strips = [];
    for (let i = 0; i < NSTR; i++) {
      const a1 = i*2*Math.PI/NSTR, a2 = (i+1)*2*Math.PI/NSTR, aMid = (a1+a2)/2;
      const norm = R(Math.cos(aMid), Math.sin(aMid), 0);
      const pts3d = [
        R(RN*Math.cos(a1),RN*Math.sin(a1), HH), R(RN*Math.cos(a2),RN*Math.sin(a2), HH),
        R(RN*Math.cos(a2),RN*Math.sin(a2),-HH), R(RN*Math.cos(a1),RN*Math.sin(a1),-HH),
      ];
      const depth = (pts3d.reduce((s,p)=>s+_dep3(p),0))/4;
      const toCam = _nor3([_3D.CAM[0]-pts3d[0][0],_3D.CAM[1]-pts3d[0][1],_3D.CAM[2]-pts3d[0][2]]);
      strips.push({pts3d, depth, front:_dot3(norm,toCam)>0, gap:inGap(aMid), sh:_shd(norm)});
    }
    strips.sort((a,b)=>a.depth-b.depth);
    if (show3DCladding) {
      for (const s of strips) {
        const pts = s.pts3d.map(p=>proj(p));
        if (!pts.every(Boolean)) continue;
        c.beginPath(); c.moveTo(pts[0][0],pts[0][1]);
        for (let j=1;j<4;j++) c.lineTo(pts[j][0],pts[j][1]);
        c.closePath();
        c.fillStyle = s.gap ? _gCol(s.sh.b,s.sh.sp,s.front) : _pCol(s.sh.b,s.sh.sp,s.front);
        c.fill();
      }
    }
  }

  // ── Cap: bottom only (semi-transparent filled arcs) ────────────────────────
  { const CSTEP = Math.PI/180; // 1° steps – exact halfGap boundary, no rounding
    for (const zz of [-HH]) {
      const ctr3d = R(0,0,zz), cPt = proj(ctr3d);
      const capNorm = R(0,0,zz>0?1:-1);
      const toCam2 = _nor3([_3D.CAM[0]-ctr3d[0],_3D.CAM[1]-ctr3d[1],_3D.CAM[2]-ctr3d[2]]);
      const facing = _dot3(capNorm,toCam2) > 0;
      // Paper cap: fan from halfGap → 2π-halfGap (exact endpoints added explicitly)
      const _fanArc = (aStart, aEnd) => {
        const pts = [];
        pts.push(proj(R(RN*Math.cos(aStart),RN*Math.sin(aStart),zz)));
        for (let a = aStart + CSTEP; a < aEnd - CSTEP*0.5; a += CSTEP)
          pts.push(proj(R(RN*Math.cos(a),RN*Math.sin(a),zz)));
        pts.push(proj(R(RN*Math.cos(aEnd),RN*Math.sin(aEnd),zz)));
        return pts;
      };
      const fanP = _fanArc(halfGap, 2*Math.PI - halfGap);
      if (cPt && fanP.some(Boolean)) {
        if (show3DCladding) {
          c.beginPath(); let fs2=true;
          for (const p of fanP){if(!p){fs2=true;continue;} fs2?c.moveTo(p[0],p[1]):c.lineTo(p[0],p[1]);fs2=false;}
          c.lineTo(cPt[0],cPt[1]); c.closePath();
          c.fillStyle = _lt ? `rgba(55,95,155,${facing?0.30:0.14})` : `rgba(48,84,138,${facing?0.38:0.18})`;
          c.fill();
        }
        c.beginPath(); let fs2=true;
        for (const p of fanP){if(!p){fs2=true;continue;} fs2?c.moveTo(p[0],p[1]):c.lineTo(p[0],p[1]);fs2=false;}
        c.strokeStyle = `rgba(${_lt?'55,130,215':'85,148,218'},${facing?0.55:0.26})`; c.lineWidth=(facing?1.0:0.6)*lwMul; c.stroke();
      }
      // Gap cap: fan from -halfGap → +halfGap (exact endpoints)
      const fanG = _fanArc(-halfGap, halfGap);
      if (cPt && fanG.some(Boolean)) {
        if (show3DCladding) {
          c.beginPath(); let fs2=true;
          for (const p of fanG){if(!p){fs2=true;continue;} fs2?c.moveTo(p[0],p[1]):c.lineTo(p[0],p[1]);fs2=false;}
          c.lineTo(cPt[0],cPt[1]); c.closePath();
          c.fillStyle = `rgba(88,50,5,${facing?0.30:0.14})`; c.fill();
        }
        c.beginPath(); let fs2=true;
        for (const p of fanG){if(!p){fs2=true;continue;} fs2?c.moveTo(p[0],p[1]):c.lineTo(p[0],p[1]);fs2=false;}
        c.strokeStyle=`rgba(220,148,28,${facing?0.44:0.20})`; c.lineWidth=0.8*lwMul; c.setLineDash([2,3]); c.stroke(); c.setLineDash([]);
      }
    }
  }

  // ── Generate cylinder points (non-uniform spacing: 2 gap + 10 paper segments) ──
  const topPts = [], botPts = [];
  for (let i = 0; i < N; i++) {
    const a = edgeAngle(i);
    const x = RN * Math.cos(a), y = RN * Math.sin(a);
    topPts.push(R(x, y,  HH));
    botPts.push(R(x, y, -HH));
  }
  const topP = topPts.map(p => proj(p));
  const botP = botPts.map(p => proj(p));

  // Sort edges back-to-front: project world midpoint onto camera FWD vector
  // (painter's algorithm – edges furthest from camera drawn first)
  const edgeIdx = Array.from({length: N}, (_, i) => i)
    .sort((a, b) => {
      const da = _3D.FWD[0]*(topPts[a][0]+botPts[a][0]) + _3D.FWD[1]*(topPts[a][1]+botPts[a][1]) + _3D.FWD[2]*(topPts[a][2]+botPts[a][2]);
      const db = _3D.FWD[0]*(topPts[b][0]+botPts[b][0]) + _3D.FWD[1]*(topPts[b][1]+botPts[b][1]) + _3D.FWD[2]*(topPts[b][2]+botPts[b][2]);
      return da - db; // most negative FWD-projection = furthest away = drawn first
    });

  // ── Vertical edges – drawn back-to-front, differentiated ──
  for (const i of edgeIdx) {
    const t = topP[i], b = botP[i];
    if (!t || !b) continue;
    const ang = edgeAngle(i);
    // True visibility: outward normal of cylinder at angle `ang`, rotated to world space,
    // dotted with camera direction from origin.  Positive → face toward camera → visible.
    const nx = Math.cos(ang), ny = Math.sin(ang);
    const [wx, wy] = [R(nx, ny, 0)[0], R(nx, ny, 0)[1]];
    // Perspective-correct test: an edge is on the outside if (CAM-edgePos)·n > 0
    // = dot - RN > 0.  Without RN it fails for top-down views.
    const dot_nCam = wx * _3D.CAM[0] + wy * _3D.CAM[1];
    const isBack = dot_nCam <= RN;
    // Back (interior) edges are always dashed – needed especially when cladding is off
    // Front edges: paper zone solid, gap zone dashed
    const gap  = inGap(ang);
    if (isBack) {
      c.strokeStyle = gap ? pal.gapBack : pal.paperBack;
      c.lineWidth   = (gap ? 0.6 : 0.7) * lwMul;
      c.setLineDash([3, 3]);
    } else if (gap) {
      c.strokeStyle = pal.gapFront;
      c.lineWidth   = 1.0 * lwMul;
      c.setLineDash([3, 3]);
    } else {
      c.strokeStyle = pal.paperFront;
      c.lineWidth   = 1.2 * lwMul;
      c.setLineDash([]);
    }
    c.beginPath(); c.moveTo(t[0], t[1]); c.lineTo(b[0], b[1]);
    c.stroke(); c.setLineDash([]);
  }

  // ── Top + bottom rings: paper arc (dynamic) and pinhole gap arc ──
  const STEP = Math.PI / 60; // 3° steps (smooth curve)
  for (const zz of [HH, -HH]) {
    // Paper arc: from +halfGap to 2π–halfGap
    const paperPts = [];
    for (let a = halfGap; a <= 2*Math.PI - halfGap + 0.01; a += STEP)
      paperPts.push(proj(R(RN*Math.cos(a), RN*Math.sin(a), zz)));
    c.beginPath();
    let first = true;
    for (const p of paperPts) {
      if (!p) { first = true; continue; }
      first ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]);
      first = false;
    }
    c.strokeStyle = pal.paperArc; c.lineWidth = 1.0 * lwMul; c.setLineDash([]);
    c.stroke();

    // Pinhole gap arc: from –halfGap to +halfGap
    const gapPts = [];
    for (let a = -halfGap; a <= halfGap + 0.01; a += STEP)
      gapPts.push(proj(R(RN*Math.cos(a), RN*Math.sin(a), zz)));
    c.beginPath();
    first = true;
    for (const p of gapPts) {
      if (!p) { first = true; continue; }
      first ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]);
      first = false;
    }
    c.strokeStyle = pal.gapArc; c.lineWidth = 0.8 * lwMul;
    c.setLineDash([2, 2]); c.stroke(); c.setLineDash([]);
  }

  // ── Pinhole dot + optical axis arrow ──
  const pinholePt = R(RN, 0, hO);   // pinhole in world space
  const pp = proj(pinholePt);

  // ── Noon mode: ray fixed in world space, only hit-point moves with can ──
  let pa, noonLabel = null;
  let noonHitsPaper = true;   // false → ray hits cap/bottom or gap, inner dashed line turns red
  let noonIncidenceDeg = null; // angle between incoming ray and cylinder-wall normal at hit point

  if (show3DCulmination) {
    // ── Animated sun ray: position for the current solar time (sunTimeHours) ──
    // Hour angle in the path convention (SH solar hour is mirrored: solarHour = 12 − hDeg/15).
    const hitH = (sunTimeHours - 12) * 15 * hemisphere;
    const hit  = surfMap(hitH);                                  // {pt,a,z} or null (miss)
    const sInf = sunPosition(hitH * Math.PI / 180, _cDelta, _cPhi);
    noonLabel = MONTH_NAMES[customMonth - 1] + ' ' + customDay
              + ' · ' + fmtSolarTime(displayHour(sunTimeHours, dayOfYear(customMonth, customDay)))
              + ' · Alt ' + Math.round(Math.max(0, sInf.el)) + '°';
    if (hit) {
      pa = hit.pt;
      noonHitsPaper = true;
      // Incidence: angle between the incoming ray (pinhole→hit) and the outward wall normal.
      let rx = RN * Math.cos(hit.a) - RN, ry = RN * Math.sin(hit.a), rz = hit.z - hO;
      const rl = Math.sqrt(rx*rx + ry*ry + rz*rz) || 1;
      const cosInc = (rx / rl) * Math.cos(hit.a) + (ry / rl) * Math.sin(hit.a);
      noonIncidenceDeg = Math.round(Math.acos(Math.max(-1, Math.min(1, cosInc))) * 180 / Math.PI);
    } else {
      // MISS: the sun's image doesn't fall on the paper — still draw the optical axis to
      // where the ray actually goes (cap / back wall), as before 24_1. Exact ray-trace,
      // signed-latitude convention so the world azimuth is correct in both hemispheres.
      noonHitsPaper = false; noonIncidenceDeg = null; pa = null;
      const Hs   = (sunTimeHours - 12) * 15 * Math.PI / 180;
      const phiS = effectiveLat() * hemisphere;
      const dS   = sunDeclination(dayOfYear(customMonth, customDay));
      const sp   = sunPosition(Hs, dS, phiS);
      if (sp.el > 0) {
        const elR = sp.el * Math.PI / 180, azR = sp.az * Math.PI / 180;
        // incoming ray dir (into can), world frame +x=S +y=W +z=up
        const inW = [Math.cos(azR)*Math.cos(elR), Math.sin(azR)*Math.cos(elR), -Math.sin(elR)];
        const pn = R(1, 0, 0);   // pinhole outward normal (world)
        if ((-inW[0])*pn[0] + (-inW[1])*pn[1] + (-inW[2])*pn[2] > 1e-9) {   // sun faces the pinhole
          const dw = rotCanInv(inW[0], inW[1], inW[2]);
          const dx = dw[0], dy = dw[1], dz = dw[2];
          const dxy2 = dx*dx + dy*dy;
          const t_wall = dxy2 > 1e-6 ? -2*RN*dx / dxy2 : Infinity;
          const z_wall = hO + t_wall*dz;
          const t_wallValid = (t_wall > 1e-4 && z_wall >= -HH && z_wall <= HH) ? t_wall : Infinity;
          let t_cap = Infinity;
          if (Math.abs(dz) > 1e-6) {
            for (const capZ of [-HH, HH]) {
              const tc = (capZ - hO) / dz;
              if (tc > 1e-4) { const xc = RN + tc*dx, yc = tc*dy; if (xc*xc + yc*yc <= RN*RN + 1e-4) t_cap = Math.min(t_cap, tc); }
            }
          }
          const t_hit = Math.min(t_wallValid, t_cap);
          const tip = t_hit < Infinity ? [RN + t_hit*dx, t_hit*dy, hO + t_hit*dz] : [-RN, 0, hO];
          pa = proj(R(tip[0], tip[1], tip[2]));
        }
      }
    }

    // Outward line toward the sun (collinear pa→pp→canvas edge), colored by hit/miss
    if (pa && pp) {
      const odx = pp[0]-pa[0], ody = pp[1]-pa[1], olen = Math.sqrt(odx*odx+ody*ody);
      if (olen > 0.5) {
        const nx = odx/olen, ny = ody/olen;
        let t = Infinity;
        if (nx > 0) t = Math.min(t, (CW-pp[0])/nx);
        else if (nx < 0) t = Math.min(t, -pp[0]/nx);
        if (ny > 0) t = Math.min(t, (CH-pp[1])/ny);
        else if (ny < 0) t = Math.min(t, -pp[1]/ny);
        if (t > 0 && t < Infinity) {
          c.beginPath(); c.moveTo(pp[0], pp[1]); c.lineTo(pp[0]+nx*t, pp[1]+ny*t);
          c.strokeStyle = noonHitsPaper ? pal.axisHit : pal.axisMiss;
          c.lineWidth = 2.0 * lwMul; c.setLineDash([]); c.stroke();
        }
      }
    }

  } else {
    // ── Default mode: el = 0, ray horizontal through can to back wall ──
    pa = proj(R(-RN, 0, hO));

    // Outward extension: screen-space trick (direction from pa through pp, extended)
    if (pp && pa) {
      const dx = pp[0]-pa[0], dy = pp[1]-pa[1];
      const len = Math.sqrt(dx*dx+dy*dy);
      if (len > 0.5) {
        const nx = dx/len, ny = dy/len;
        let t = Infinity;
        if (nx > 0) t = Math.min(t, (CW-pp[0])/nx);
        else if (nx < 0) t = Math.min(t, -pp[0]/nx);
        if (ny > 0) t = Math.min(t, (CH-pp[1])/ny);
        else if (ny < 0) t = Math.min(t, -pp[1]/ny);
        if (t > 0 && t < Infinity) {
          c.beginPath(); c.moveTo(pp[0], pp[1]); c.lineTo(pp[0]+nx*t, pp[1]+ny*t);
          c.strokeStyle = pal.axisOut; c.lineWidth = 2.0 * lwMul; c.setLineDash([]); c.stroke();
        }
      }
    }
  }

  // ── Status panel: update values (Analyzer preview + Theater) ──
  if (currentMode === 'analyzer') {
    const circ    = Math.round(2 * Math.PI * radius);   // whole mm
    const fillPct = (paperAngle / (2 * Math.PI) * 100).toFixed(1);
    const covDeg  = Math.round(paperAngle / 2 * 180 / Math.PI);
    // Date + current solar time; the time is styled like a value (paper-filling style)
    const noonLbl = '<span style="color:var(--text);font-weight:bold">'
      + MONTH_NAMES[customMonth - 1] + ' ' + customDay + '</span>'
      + ' <span class="ts-val" style="display:inline">(' + fmtSolarTime(displayHour(sunTimeHours, dayOfYear(customMonth, customDay))) + ')</span>';

    const tsCirc         = document.getElementById('tsCirc');
    const tsFill         = document.getElementById('tsFill');
    const tsCoverage     = document.getElementById('tsCoverage');
    const tsNoonLbl      = document.getElementById('tsNoonLbl');
    const tsHit          = document.getElementById('tsHit');
    const tsMiss         = document.getElementById('tsMiss');
    const tsIncidenceRow = document.getElementById('tsIncidenceRow');
    const tsIncidence    = document.getElementById('tsIncidence');

    if (tsCirc)     tsCirc.textContent     = circ;
    if (tsFill)     tsFill.textContent     = fillPct;
    if (tsCoverage) tsCoverage.textContent = covDeg + '°';
    if (tsNoonLbl)  tsNoonLbl.innerHTML    = noonLbl;

    // Noon row: visible only when noon mode is active
    const tsNoonRow = document.getElementById('tsNoonRow');
    if (tsNoonRow) tsNoonRow.style.display = show3DCulmination ? '' : 'none';

    if (tsHit && tsMiss && show3DCulmination) {
      tsHit.classList.toggle('active',  noonHitsPaper);
      tsMiss.classList.toggle('active', !noonHitsPaper);
    }
    // Az / Alt of the Sun at the current solar time (custom date) – above incidence
    const tsAzAltRow = document.getElementById('tsAzAltRow');
    const tsAzAlt    = document.getElementById('tsAzAlt');
    if (tsAzAltRow && tsAzAlt) {
      if (show3DCulmination) {
        const Hs = (sunTimeHours - 12) * 15 * Math.PI / 180;
        const sp = sunPosition(Hs, sunDeclination(dayOfYear(customMonth, customDay)), effectiveLat() * hemisphere);
        tsAzAltRow.style.display = '';
        tsAzAlt.textContent = sp.el >= 0
          ? Math.round(sp.az) + '° / ' + Math.round(sp.el) + '°'
          : '—';
      } else {
        tsAzAltRow.style.display = 'none';
      }
    }
    // Incidence angle: row always visible; "—" when not relevant (no hit)
    if (tsIncidenceRow && tsIncidence) {
      const showInc = show3DCulmination && noonHitsPaper && noonIncidenceDeg !== null;
      tsIncidenceRow.style.display = '';
      tsIncidence.textContent = showInc ? noonIncidenceDeg + '°' : '—';
    }
  }

  // ── Custom-day sun path mapped onto the curved paper surface (theater + noon) ──
  // The flat scan is the unrolled photo paper. Because the projection is x = 2·r·α
  // (inscribed-angle relation: the pinhole sits ON the circle, so a ray at azimuth α
  // from the optical axis lands at central angle 2α), the scan's horizontal pixel IS
  // the arc length along the cylinder. So a 2D path point (px,py) maps onto the paper
  // surface with no extra optics:
  //   a = π + (px − cx)/(scale·radius)   central angle measured from the back-wall centre
  //   z = (py − cy)/(scale·halfHmm)      height (canvas-down → paper-up; pinhole inversion)
  // Anchored to the noon ray: the H=0 point lands on the back-wall centre at the noon height.
  if (theaterMode3D && show3DCulmination) {
    maybeUpdateSunFill();   // keep the slider's on-paper regions in sync with geometry
    const surfProj = (hDeg) => { const m = surfMap(hDeg); return m ? m.pt : null; };

    // Smooth curve (0.5° steps); null = break in the polyline
    const surfPath = [];
    for (let hDeg = -180; hDeg <= 180; hDeg += 0.5) surfPath.push(surfProj(hDeg));
    const noonSurf = surfProj(0);

    // Black outline under, green path over – matches the 2D custom-path styling
    for (const pass of [{ col: 'rgba(0,0,0,0.85)', w: 3.4 }, { col: 'rgba(80,220,120,0.95)', w: 1.6 }]) {
      c.strokeStyle = pass.col; c.lineWidth = pass.w * lwMul; c.setLineDash([]);
      c.beginPath(); let first = true;
      for (const p of surfPath) {
        if (!p) { first = true; continue; }
        first ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]);
        first = false;
      }
      c.stroke();
    }

    // Hourly direction arrows (step 15° = 1 h), reusing the equinox hour-dot sampling.
    // Each arrow points along the sun's daily motion (toward increasing hour angle) and
    // pulses in sequence → a travelling "Mexican wave" of arrows.
    // Direction of time flow: NH later = increasing hour angle, SH later = decreasing
    // (SH solar hour is mirrored: solarHour = 12 − hDeg/15) → flip the step in SH.
    const step = 3 * (hemisphere >= 0 ? 1 : -1);
    const arrows = [];
    for (let hDeg = -180; hDeg <= 180; hDeg += 15) {
      const p0 = surfProj(hDeg);
      if (!p0) continue;
      const ahead = surfProj(hDeg + step), behind = surfProj(hDeg - step);
      let dx, dy;
      if (ahead)       { dx = ahead[0]  - p0[0];   dy = ahead[1]  - p0[1]; }
      else if (behind) { dx = p0[0] - behind[0];   dy = p0[1] - behind[1]; }
      else continue;
      const L = Math.hypot(dx, dy) || 1;
      arrows.push({ x: p0[0], y: p0[1], dx: dx / L, dy: dy / L });
    }

    arrows.forEach((arw, i) => {
      // Travelling wave: phase advances with time and lags by index along the chain
      const pulse = 0.5 + 0.5 * Math.sin(_wavePhase * (Math.PI / 2000) - i * 0.55);
      const len   = (5 + 3.2 * pulse) * lwMul * (2 / 3);   // 2/3 of previous size
      const wid   = len * 0.6;
      const tx = arw.x + arw.dx * len,       ty = arw.y + arw.dy * len;
      const bx = arw.x - arw.dx * len * 0.4, by = arw.y - arw.dy * len * 0.4;
      const nx = -arw.dy, ny = arw.dx;       // perpendicular
      c.beginPath();
      c.moveTo(tx, ty);
      c.lineTo(bx + nx * wid, by + ny * wid);
      c.lineTo(bx - nx * wid, by - ny * wid);
      c.closePath();
      c.fillStyle = `rgba(80,220,120,${(0.45 + 0.55 * pulse).toFixed(3)})`;
      c.fill();   // no outline (23_3)
    });

    // Marker at the solar-noon position on the paper
    if (noonSurf) {
      c.beginPath(); c.arc(noonSurf[0], noonSurf[1], 3.2 * lwMul, 0, Math.PI * 2);
      c.fillStyle = 'rgba(80,220,120,1)'; c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineWidth = 1 * lwMul; c.stroke();
    }
  }

  // ── Inward ray: pinhole → back wall (dashed, arrowhead at hit point) ──
  // In noon mode: orange = hits paper wall, red = hits cap/bottom (sun misses paper)
  const axisColor = show3DCulmination
    ? (noonHitsPaper ? pal.axisHit : pal.axisMiss)
    : pal.axisOut;
  if (pp && pa) {
    c.beginPath(); c.moveTo(pp[0], pp[1]); c.lineTo(pa[0], pa[1]);
    c.strokeStyle = axisColor; c.lineWidth = 1.5 * lwMul; c.setLineDash([3, 3]); c.stroke();
    c.setLineDash([]);
    const dx = pa[0]-pp[0], dy = pa[1]-pp[1], len = Math.sqrt(dx*dx+dy*dy);
    if (len > 4) {
      const nx = dx/len, ny = dy/len;
      c.beginPath();
      c.moveTo(pa[0], pa[1]);
      c.lineTo(pa[0]-nx*9-ny*4, pa[1]-ny*9+nx*4);
      c.lineTo(pa[0]-nx*9+ny*4, pa[1]-ny*9-nx*4);
      c.closePath(); c.fillStyle = axisColor; c.fill();
    }
    if (noonLabel) {
      c.font = `${Math.max(7, Math.round(fs * 0.85))}px 'Share Tech Mono'`;
      c.fillStyle = pal.axisHit; c.textAlign = 'center';
      c.fillText(noonLabel, pa[0], pa[1] + Math.round(fs * 1.4));
    }
  }

  // ── Pinhole dot – always visible ──
  if (pp) {
    const glR = 14 * lwMul;
    const glow = c.createRadialGradient(pp[0],pp[1],0, pp[0],pp[1],glR);
    glow.addColorStop(0,'rgba(232,160,32,0.60)'); glow.addColorStop(1,'rgba(232,160,32,0)');
    c.fillStyle = glow; c.fillRect(pp[0]-glR,pp[1]-glR,glR*2,glR*2);
    c.beginPath(); c.arc(pp[0], pp[1], 4.5 * lwMul, 0, Math.PI*2);
    c.fillStyle = pal.pinhole; c.fill();
    c.strokeStyle = pal.pinholeRing; c.lineWidth = 1 * lwMul; c.stroke();
  }

  // ── Pinhole level ring on can surface (smooth circle) ──
  const horizonPts = [];
  for (let a = 0; a <= 2 * Math.PI + 0.01; a += STEP)
    horizonPts.push(proj(R(RN * Math.cos(a), RN * Math.sin(a), hO)));
  c.beginPath();
  let hfirst = true;
  for (const p of horizonPts) {
    if (!p) { hfirst = true; continue; }
    hfirst ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]);
    hfirst = false;
  }
  c.strokeStyle = pal.horizon; c.lineWidth = 0.8 * lwMul;
  c.setLineDash([2, 3]); c.stroke(); c.setLineDash([]);

  // ── Label ──
  c.font = `${fs}px 'Share Tech Mono'`;
  c.fillStyle = pal.label;
  c.textAlign = 'center';

  // ── Scale ruler (theater only): 0 → radius, 5 mm segments, alternating filled/empty ──
  if (theaterMode3D) {
    const pxPerMm = (_3D.FOCAL / _3D.camDist) * SCL / halfHmm; // scale at the depth of the can centre
    const UNIT  = 5;                       // mm per segment
    const segPx = UNIT * pxPerMm;
    if (isFinite(segPx) && segPx > 1.5) {  // draw only when a segment is legible
      const nFull   = Math.floor(radius / UNIT);
      const remMm   = radius - nFull * UNIT;
      const totalPx = radius * pxPerMm;
      const barH    = Math.max(5, Math.round(fs * 0.7));
      const pad     = Math.round(fs * 1.6);
      const lblH    = Math.round(fs * 1.2);
      const x0      = pad;
      const y0      = CH - pad - barH;
      const inkCol  = _lt ? '#0c1820' : '#dce8f5';
      const fillCol = _lt ? 'rgba(12,24,32,0.88)' : 'rgba(220,232,245,0.90)';
      // subtle backdrop for legibility over the floor grid
      c.fillStyle = _lt ? 'rgba(255,255,255,0.60)' : 'rgba(8,12,18,0.55)';
      c.fillRect(x0 - 6, y0 - lblH - 4, totalPx + 12, barH + lblH + 10);
      // full 5mm segments – even filled, odd empty
      c.lineWidth = Math.max(1, lwMul);
      c.strokeStyle = inkCol;
      for (let i = 0; i < nFull; i++) {
        const sx = x0 + i * segPx;
        if (i % 2 === 0) { c.fillStyle = fillCol; c.fillRect(sx, y0, segPx, barH); }
        c.strokeRect(sx, y0, segPx, barH);
      }
      // remainder segment after the last 5 mm (up to the full radius value)
      if (remMm > 0.01) {
        const sx = x0 + nFull * segPx, w = remMm * pxPerMm;
        if (nFull % 2 === 0) { c.fillStyle = fillCol; c.fillRect(sx, y0, w, barH); }
        c.strokeRect(sx, y0, w, barH);
      }
      // labels: 0 on the left, radius on the right
      c.fillStyle = inkCol;
      c.font = `${Math.max(8, Math.round(fs * 0.85))}px 'Share Tech Mono'`;
      c.textBaseline = 'alphabetic';
      c.textAlign = 'left';
      c.fillText('0', x0, y0 - 4);
      c.textAlign = 'right';
      c.fillText((radius % 1 === 0 ? radius.toFixed(0) : radius.toFixed(1)) + ' mm', x0 + totalPx, y0 - 4);
      c.textAlign = 'center';
    }
  }

  // Sun Graph view shares the calibration state → keep it in sync when calibration changes
  // (every calibration slider calls draw3D). Guarded: function lives in render-sungraph.js.
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive
      && typeof drawSunGraph === 'function') drawSunGraph();
}

// ─── Hourly-arrow "Mexican wave" animation ───────────────────────────────────
// Runs only while the day-path is visible (theater + noon). Re-renders the 3D view
// at ~30 fps so the per-arrow pulse (driven by _wavePhase) travels along the chain.
let _waveLast = 0;
function sunWaveFrame(ts) {
  _wavePhase = ts;
  if (sunAnimActive) advanceSunAnim(ts);                   // advance the day animation
  if (ts - _waveLast > 33) {                               // throttle to ~30 fps
    _waveLast = ts;
    if (theaterMode3D) draw3D();                           // theater: 3D ray + arrow wave
    else { draw(); draw3D(); }                             // analyzer: 2D sun dot (+ preview)
    if (typeof sunGraphActive !== 'undefined' && sunGraphActive
        && typeof drawSunGraph === 'function') drawSunGraph();   // animate the sun marker in the graph

  }
  sunWaveRAF = requestAnimationFrame(sunWaveFrame);
}
function updateSunWave() {
  // Loop drives the arrow wave (theater) and/or the day animation (when playing)
  const shouldRun = show3DCulmination && (theaterMode3D || sunAnimActive);
  if (shouldRun && sunWaveRAF === null) {
    sunWaveRAF = requestAnimationFrame(sunWaveFrame);
  } else if (!shouldRun && sunWaveRAF !== null) {
    cancelAnimationFrame(sunWaveRAF);
    sunWaveRAF = null;
  }
}

// ─── Day animation: sun ray sweeping sunrise → sunset (custom date) ───────────
// Solar time string "H:MM"
function fmtSolarTime(t) {
  let h = Math.floor(t), m = Math.round((t - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return h + ':' + String(m).padStart(2, '0');
}
// Sunrise/sunset solar times for the current custom date (symmetric around noon).
// cos(H0) = −tan(φ)·tan(δ); polar day → full 24 h, polar night → empty (rise=set=12).
function sunDayRange() {
  const arc   = customArcDate();
  const delta = sunDeclination(dayOfYear(arc.month, arc.day));
  const phi   = effectiveLat();
  const cosH0 = -Math.tan(phi) * Math.tan(delta);
  let H0h;                                  // half-day length in hours
  if (cosH0 <= -1)      H0h = 12;           // polar day (sun always up)
  else if (cosH0 >= 1)  H0h = 0;            // polar night (sun never rises)
  else                  H0h = Math.acos(cosH0) * 12 / Math.PI;
  return { tRise: 12 - H0h, tSet: 12 + H0h };
}
// Advance the animation clock: SUN_RATE_HPS hours of solar time per real second, +2 s pause.
// The loop sweeps only the interval where the ray enters the can (green + red on the slider).
// Starts from sunAnimOffset (seconds into the cycle) so Play resumes where Stop left off.
function advanceSunAnim(ts) {
  const { tEnter, tExit } = sunEnterRange();
  const spanH  = Math.max(0.001, tExit - tEnter);   // hours the ray enters the can
  const motion = spanH / SUN_RATE_HPS;              // seconds to sweep that interval
  if (sunAnimStart === null) sunAnimStart = ts;
  const elapsed = (ts - sunAnimStart) / 1000;       // seconds since Play
  const local   = (sunAnimOffset + elapsed) % (motion + 2);   // +2 s pause before each new loop
  sunTimeHours  = local <= motion ? tEnter + local * SUN_RATE_HPS : tExit;  // hold at end during pause
  syncSunTimeUI();
}
// Reflect sunTimeHours in the slider + label. The slider's VALUE and its min/max (rise/set,
// set by refreshSunTimeRange) always stay true solar time (drive the actual geometry / axis
// range); only the printed labels - current time and the rise/set boundary labels below the
// slider - are converted to the selected display mode.
function syncSunTimeUI() {
  const rng = document.getElementById('rngSunTime');
  const lbl = document.getElementById('lblSunTime');
  const doy = dayOfYear(customMonth, customDay);
  if (rng && parseFloat(rng.value) !== sunTimeHours) rng.value = sunTimeHours;
  if (lbl) lbl.textContent = fmtSolarTime(displayHour(sunTimeHours, doy));
  const { tRise, tSet } = sunDayRange();
  const riseLbl = document.getElementById('lblSunRise');
  const setLbl  = document.getElementById('lblSunSet');
  if (riseLbl) riseLbl.textContent = fmtSolarTime(displayHour(tRise, doy));
  if (setLbl)  setLbl.textContent  = fmtSolarTime(displayHour(tSet, doy));
}
// Slider spans the full day (sunrise..sunset) visually, but only the entering interval
// (green + red) is clickable → clamp the value there.
function refreshSunTimeRange() {
  maybeUpdateSunFill();                          // refresh fill + cached enter range first
  const { tRise, tSet } = sunDayRange();
  const rng = document.getElementById('rngSunTime');
  if (rng) {
    rng.min = tRise.toFixed(3);
    rng.max = tSet.toFixed(3);
  }
  sunTimeHours = Math.max(_sunEnterT0, Math.min(_sunEnterT1, sunTimeHours));
  syncSunTimeUI();
}
function setSunPlayIcon(playing) {
  const btn = document.getElementById('btnSunPlay');
  if (!btn) return;
  btn.classList.toggle('playing', playing);
  const ic = btn.querySelector('svg');
  if (ic) ic.innerHTML = playing
    ? '<rect x="2" y="2" width="8" height="8" rx="1"/>'                 // stop (square)
    : '<polygon points="2,1 11,6 2,11"/>';                              // play (triangle)
  const lbl = btn.querySelector('span');
  if (lbl) lbl.textContent = playing ? 'STOP' : 'ANIMATE SUNLIGHT';
}
function startSunAnim() {
  if (sunAnimActive) return;
  sunAnimActive = true;
  sunAnimStart  = null;            // captured on first frame
  // Resume from the current solar time (where Stop / the slider left off)
  const { tEnter, tExit } = sunEnterRange();
  const motion = Math.max(0.001, tExit - tEnter) / SUN_RATE_HPS;
  sunAnimOffset = Math.min(motion, Math.max(0, (sunTimeHours - tEnter) / SUN_RATE_HPS));
  setSunPlayIcon(true);
  updateSunWave();                 // ensure the rAF loop is running
}
function stopSunAnim() {
  sunAnimActive = false;
  setSunPlayIcon(false);
  updateSunWave();   // cancel the loop in analyzer (kept running in theater for the wave)
}

// Inverse can rotation in world space (global twin of draw3D's rotCanInv) – pure function
// of the calibration angles. Used to test whether the sun faces the pinhole wall.
function _rotCanInvWorld(x, y, z) {
  const yr = (yawDeg + (hemisphere < 0 ? 180 : 0)) * Math.PI / 180;
  const pr = pitchDeg * Math.PI / 180, rr = rollDeg * Math.PI / 180;
  const x0 =  x * Math.cos(yr) + y * Math.sin(yr);
  const y0 = -x * Math.sin(yr) + y * Math.cos(yr);
  const z0 = z;
  const x1 = x0;
  const y1 =  y0 * Math.cos(rr) - z0 * Math.sin(rr);
  const z1 =  y0 * Math.sin(rr) + z0 * Math.cos(rr);
  const x2 =  x1 * Math.cos(pr) + z1 * Math.sin(pr);
  const y2 =  y1;
  const z2 = -x1 * Math.sin(pr) + z1 * Math.cos(pr);
  return [x2, y2, z2];
}
// Classify the sun ray at solar time t for the slider track:
//   2 = image lands on paper (green)
//   1 = ray enters the can but misses the paper – cap/gap (red, like the MISS optical axis)
//   0 = ray does not enter the can (sun below horizon / behind the pinhole wall) (grey)
function sunRayState(t, ctx) {
  // On paper? (path convention – matches the green curve / surfMap)
  const hDeg = (t - 12) * 15 * hemisphere;
  const s = sunPosition(hDeg * Math.PI / 180, ctx.delta, ctx.phi);
  if (s.el > 0) {
    const pos = azElToPixel(s.beta - yawDeg, s.el);
    if (pos) {
      const a = Math.PI + (pos.px - cx) / (scale * radius);
      const z = (pos.py - cy) / (scale * ctx.halfHmm);
      if (a >= ctx.halfGap && a <= 2 * Math.PI - ctx.halfGap && z >= -1 && z <= 1) return 2;
    }
  }
  // Enters the can but misses paper? (signed-φ world; sun above horizon AND faces pinhole)
  const sp = sunPosition((t - 12) * 15 * Math.PI / 180, ctx.deltaS, ctx.phiS);
  if (sp.el > 0) {
    const elR = sp.el * Math.PI / 180, azR = sp.az * Math.PI / 180;
    const sunDirW = [-Math.cos(azR) * Math.cos(elR), -Math.sin(azR) * Math.cos(elR), Math.sin(elR)];
    if (_rotCanInvWorld(sunDirW[0], sunDirW[1], sunDirW[2])[0] > 1e-9) return 1;
  }
  return 0;
}
// Build the slider track gradient: green = on paper, red = enters but misses, grey = no entry.
// Any of these may be several disjoint regions across the day.
function updateSunFill() {
  const rng = document.getElementById('rngSunTime');
  if (!rng) return;
  const arc = customArcDate();
  const ctx = {
    delta:  sunDeclination(dayOfYear(arc.month, arc.day)),       // path convention (positive φ)
    phi:    effectiveLat(),
    deltaS: sunDeclination(dayOfYear(customMonth, customDay)),   // signed-φ convention
    phiS:   effectiveLat() * hemisphere,
    halfHmm: currentHalfHmm(),
    halfGap: (2 * Math.PI - Math.min(2 * Math.PI - 0.01, scanWmm / radius)) / 2,
  };
  const { tRise, tSet } = sunDayRange();
  const span = Math.max(0.001, tSet - tRise);
  const COL = ['rgba(120,140,160,0.18)', 'rgba(224,64,64,0.45)', 'rgba(80,220,120,0.62)']; // 0,1,2
  const N = 200, parts = [];
  let prev = sunRayState(tRise, ctx);
  let t0 = null, t1 = null;                       // first / last time the ray enters (state ≥ 1)
  if (prev >= 1) { t0 = tRise; t1 = tRise; }
  parts.push(COL[prev] + ' 0%');
  for (let i = 1; i <= N; i++) {
    const t = tRise + span * i / N;
    const st = sunRayState(t, ctx);
    if (st >= 1) { if (t0 === null) t0 = t; t1 = t; }
    if (st !== prev) {
      const pct = (i / N * 100).toFixed(2);
      parts.push(COL[prev] + ' ' + pct + '%', COL[st] + ' ' + pct + '%');
      prev = st;
    }
  }
  parts.push(COL[prev] + ' 100%');
  if (t0 === null) { t0 = t1 = 12; }              // ray never enters – degenerate
  _sunEnterT0 = t0; _sunEnterT1 = t1;             // cache for the loop / clamp / boundary lines

  // White vertical boundary lines at the entering interval (the clickable / animated part)
  const colorGrad = 'linear-gradient(to right, ' + parts.join(',') + ')';
  let lineGrad = '';
  if (t1 > t0) {
    const pE = ((t0 - tRise) / span * 100).toFixed(2);
    const pX = ((t1 - tRise) / span * 100).toFixed(2);
    lineGrad =
      'linear-gradient(90deg,' +
      ` transparent calc(${pE}% - 1px), #fff calc(${pE}% - 1px), #fff calc(${pE}% + 1px),` +
      ` transparent calc(${pE}% + 1px), transparent calc(${pX}% - 1px), #fff calc(${pX}% - 1px),` +
      ` #fff calc(${pX}% + 1px), transparent calc(${pX}% + 1px)), `;
  }
  rng.style.setProperty('--sun-fill', lineGrad + colorGrad);
}
// Cached interval (solar hours) where the ray enters the can – set by updateSunFill()
function sunEnterRange() { return { tEnter: _sunEnterT0, tExit: _sunEnterT1 }; }
// Rebuild the gradient only when a relevant parameter changed (cheap key check)
let _sunFillKey = '';
function maybeUpdateSunFill() {
  const key = [customMonth, customDay, LAT, hemisphere, yawDeg, pitchDeg, rollDeg,
               horizonMm, radius, scanWmm, canvas.width, canvas.height].join(',');
  if (key !== _sunFillKey) { _sunFillKey = key; updateSunFill(); }
}
// Show/hide the day-animation controls and refresh their range + fill.
// Visible in theater (with Sun path on) OR in Analyzer with Custom date + Sun path on.
function updateSunAnimCtl() {
  const show = show3DCulmination && (theaterMode3D || showCustomArc);
  const ctl = document.getElementById('sunAnimCtl');
  if (ctl) ctl.style.display = show ? 'block' : 'none';
  if (show) {
    refreshSunTimeRange();   // keeps current time (clamped); theater transitions preserve it
    maybeUpdateSunFill();
  } else stopSunAnim();
}

// ─── Status panel collapse (▲/▼ arrow only) ──────────────────────────────────
let statusCollapsed = false;
function setStatusCollapsed(c) {
  statusCollapsed = c;
  const wrap = document.getElementById('statusWrap');
  const tog  = document.getElementById('statusToggle');
  if (wrap) wrap.classList.toggle('collapsed', c);
  if (tog)  tog.textContent = c ? '▼' : '▲';   // up = shown, down = hidden
}
document.getElementById('statusToggle').addEventListener('click', (e) => {
  e.stopPropagation();
  setStatusCollapsed(!statusCollapsed);
});

// ─── Theater mode ────────────────────────────────────────────────────────────
const SVG_EXPAND  = `<polyline points="1,4 1,1 4,1"/><line x1="1" y1="1" x2="4.5" y2="4.5"/><polyline points="11,8 11,11 8,11"/><line x1="11" y1="11" x2="7.5" y2="7.5"/>`;
const SVG_COLLAPSE = `<polyline points="1,4.5 4.5,4.5 4.5,1"/><line x1="4.5" y1="4.5" x2="1" y2="1"/><polyline points="11,7.5 7.5,7.5 7.5,11"/><line x1="7.5" y1="7.5" x2="11" y2="11"/>`;

function setTheaterIcon(theater) {
  const icon = document.getElementById('theaterIcon');
  icon.innerHTML = theater ? SVG_COLLAPSE : SVG_EXPAND;
}

// enabled=true → whole section active. enabled=false → section disabled, EXCEPT controls whose id
// is in keepIds (their rows stay active). Dimming is per-row so kept rows can remain bright
// (parent opacity can't be undone by a child).
function setDisplaySectionEnabled(enabled, keepIds) {
  const section = document.getElementById('displaySection');
  if (!section) return;
  const keep = keepIds || [];
  section.style.opacity = ''; section.style.pointerEvents = '';   // control per-row now
  section.querySelectorAll('input, button').forEach(el => {
    el.disabled = !(enabled || keep.includes(el.id));
  });
  section.querySelectorAll('.chk-row, .slider-row, #btnHeatmap').forEach(row => {
    const active = enabled || keep.some(id => row.id === id || row.querySelector('#' + id));
    row.style.opacity = active ? '' : '0.35';
    row.style.pointerEvents = active ? '' : 'none';
  });
}

function enterTheater3D() {
  // Sun Graph, Sky Dome and 3D theater are mutually exclusive canvas takeovers.
  if (typeof sunGraphActive !== 'undefined' && sunGraphActive && typeof exitSunGraph === 'function') exitSunGraph();
  if (typeof skyDomeActive !== 'undefined' && skyDomeActive && typeof exitSkyDome === 'function') exitSkyDome();
  const container = document.getElementById('canvasContainer');
  // The 3D model needs no scan → ensure the canvas area is visible (mirrors enterSunGraph).
  container.classList.remove('hidden');
  const _uz = document.getElementById('uploadZone'); if (_uz) _uz.classList.add('hidden');
  const theaterCv = document.getElementById('can3dTheater');
  theaterCv.width  = container.clientWidth;
  theaterCv.height = container.clientHeight;
  // Show theater canvas over main image, hide readout cursor
  theaterCv.style.display = 'block';
  document.getElementById('btnTheaterExit').style.display = 'block';
  document.getElementById('mainCanvas').style.pointerEvents = 'none';
  // In the panel: hide the 3D canvas, show placeholder (legenda + noon stay visible)
  document.getElementById('can3d').style.visibility = 'hidden';
  const ph = document.getElementById('theaterPlaceholder');
  ph.style.display = 'flex';
  setTheaterIcon(true);
  document.getElementById('btn3DTheater').classList.add('theater-active');
  setDisplaySectionEnabled(false);
  // Hide split-screen divider + swap button — they would overlay the 3D view
  splitHandle.style.display    = 'none';
  btnSplitInvert.style.display = 'none';
  document.getElementById('theaterZoomCtl').style.display = 'flex';
  theaterMode3D = true;
  updateSunAnimCtl();   // reveal the day-animation controls (theater + noon)
  draw3D();
  updateSunWave();   // start the arrow wave if noon mode is on
  if (typeof updateViewButtons === 'function') updateViewButtons();   // sync 3D MODEL / SUN GRAPH toggles
}

function exitTheater3D() {
  document.getElementById('can3dTheater').style.display   = 'none';
  document.getElementById('btnTheaterExit').style.display = 'none';
  document.getElementById('mainCanvas').style.pointerEvents = '';
  document.getElementById('can3d').style.visibility = '';
  document.getElementById('theaterPlaceholder').style.display = 'none';
  setTheaterIcon(false);
  document.getElementById('btn3DTheater').classList.remove('theater-active');
  setDisplaySectionEnabled(true);
  document.getElementById('theaterZoomCtl').style.display = 'none';
  // Restore split-screen divider + swap button if split is still active
  if (splitActive) {
    splitHandle.style.display    = 'block';
    btnSplitInvert.style.display = 'flex';
  }
  theaterMode3D = false;
  updateSunAnimCtl();   // controls follow Analyzer rules; animation keeps running across theater
  updateSunWave();   // stop the arrow wave when leaving theater (keeps loop if still animating)
  draw3D();
  // Restore the empty-state upload zone if no scan and not switching to another canvas view.
  if (currentMode === 'analyzer' && !imgBitmap
      && !(typeof sunGraphActive !== 'undefined' && sunGraphActive)
      && !(typeof skyDomeActive !== 'undefined' && skyDomeActive)) {
    document.getElementById('uploadZone').classList.remove('hidden');
    document.getElementById('canvasContainer').classList.add('hidden');
  }
  if (typeof updateViewButtons === 'function') updateViewButtons();
}

document.getElementById('btn3DTheater').addEventListener('click', () => {
  if (!theaterMode3D) enterTheater3D(); else exitTheater3D();
});
// (Top sub-view switcher is now the wheel in .mode-subrow, wired in controls.js - it calls
// enterTheater3D()/enterSunGraph()/enterSkyDome() directly, no per-button listener needed here.)
// Click on the 3D preview canvas: enter theater
document.getElementById('can3d').addEventListener('click', () => {
  if (!theaterMode3D) enterTheater3D();
});
// Click on the theater placeholder (shown when theater is active): exit theater
document.getElementById('theaterPlaceholder').addEventListener('click', () => {
  if (theaterMode3D) exitTheater3D();
});
document.getElementById('btnTheaterExit').addEventListener('click', exitTheater3D);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && theaterMode3D) exitTheater3D();
});

// ── Theater zoom (vertical slider + pinch) ───────────────────────────────────
function setTheaterZoom(z) {
  _3D.zoom = Math.max(0.5, Math.min(2, z));
  const rng = document.getElementById('theaterZoom');
  if (rng && parseFloat(rng.value) !== _3D.zoom) rng.value = _3D.zoom;
  document.getElementById('theaterZoomVal').textContent = _3D.zoom.toFixed(1) + '×';
  draw3D();
}
document.getElementById('theaterZoom').addEventListener('input', (e) => {
  setTheaterZoom(parseFloat(e.target.value));
});

// ── Cladding toggle ──────────────────────────────────────────────────────────
document.getElementById('chkCladding').addEventListener('change', (e) => {
  show3DCladding = e.target.checked;
  draw3D();
});

// ── Theater drag-orbit (mouse + one-finger touch) ────────────────────────────
{
  const theaterCv = document.getElementById('can3dTheater');
  let orbitDrag = false;
  let orbitLastX = 0, orbitLastY = 0;

  function orbitStart(x, y) {
    orbitDrag = true;
    orbitLastX = x;
    orbitLastY = y;
    theaterCv.style.cursor = 'grabbing';
  }

  function orbitMove(x, y) {
    if (!orbitDrag) return;
    const dx = x - orbitLastX;
    const dy = y - orbitLastY;
    orbitLastX = x;
    orbitLastY = y;
    _3D.camAz += dx * 0.005;           // horizontal drag → rotate azimuth
    _3D.camEl  = Math.max(0.06, Math.min(Math.PI / 2 - 0.04,
                    _3D.camEl + dy * 0.004));  // vertical drag → change elevation
    updateCamera();
    draw3D();
  }

  function orbitEnd() {
    if (!orbitDrag) return;
    orbitDrag = false;
    theaterCv.style.cursor = 'default';
  }

  // Mouse
  theaterCv.addEventListener('mousedown', (e) => {
    if (!theaterMode3D) return;
    orbitStart(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => orbitMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', orbitEnd);

  // Touch: one finger = orbit, two fingers = pinch-zoom
  let pinching = false, pinchStartDist = 0, pinchStartZoom = 1;
  function touchDist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  theaterCv.addEventListener('touchstart', (e) => {
    if (!theaterMode3D) return;
    if (e.touches.length === 2) {
      pinching = true; orbitDrag = false;
      pinchStartDist = touchDist(e.touches) || 1;
      pinchStartZoom = _3D.zoom;
    } else if (e.touches.length === 1) {
      orbitStart(e.touches[0].clientX, e.touches[0].clientY);
    }
    e.preventDefault();
  }, { passive: false });

  theaterCv.addEventListener('touchmove', (e) => {
    if (pinching && e.touches.length === 2) {
      setTheaterZoom(pinchStartZoom * (touchDist(e.touches) / pinchStartDist));
      e.preventDefault();
    } else if (orbitDrag && e.touches.length === 1) {
      orbitMove(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }
  }, { passive: false });

  function touchEnd(e) {
    if (e.touches.length === 0) { orbitEnd(); pinching = false; }
    else if (e.touches.length === 1) { pinching = false; }  // dropped to one finger
  }
  theaterCv.addEventListener('touchend', touchEnd);
  theaterCv.addEventListener('touchcancel', touchEnd);
}

// Resize theater canvas when container changes size
new ResizeObserver(() => {
  if (!theaterMode3D) return;
  const container = document.getElementById('canvasContainer');
  const theaterCv = document.getElementById('can3dTheater');
  theaterCv.width  = container.clientWidth;
  theaterCv.height = container.clientHeight;
  draw3D();
}).observe(document.getElementById('canvasContainer'));

// Init: start in gallery mode
setMode('gallery');
updateAxisLegend();
refreshCalibLimits();   // set initial slider limits (scan width / radius / horizon)

// ─── Force a clean reflow so side panels become scrollable on first paint ─────
// Chrome (Blink) sometimes fails to compute the scroll-container height until a
// resize occurs (typically after async Google Fonts settle). Emulate that resize
// once on load and after fonts are ready — no visible flash (reverted same frame).
function forcePanelReflow() {
  const b = document.body;
  const prev = b.style.display;
  b.style.display = 'none';
  void b.offsetHeight;          // read to flush the display:none reflow
  b.style.display = prev || '';
}
window.addEventListener('load', () => requestAnimationFrame(forcePanelReflow));
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => requestAnimationFrame(forcePanelReflow));
}

