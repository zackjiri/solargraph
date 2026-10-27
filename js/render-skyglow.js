// ─── Sky colour under Atmosphere (Night Sky: Sky Map, Planetarium; dark theme) ─────────────────
// With Atmosphere on the sky's fill follows the sky brightness instead of the fixed night blue:
// light blue by day, deep blue in twilight with a warm glow low over the Sun, the night blue after
// dark, greyer under the Moon. The colour changes slowly across the sky, so it is worked out only
// on a grid every GLOW_GRID_PX canvas px (~600 nodes in a Planetarium view), written one node per
// pixel into a tiny canvas and stretched over the view with one drawImage - the browser's bilinear
// scaling does the interpolation on the GPU. Well under 1 ms a frame; the tiny canvas is reused
// while time, place, view and theme stay the same. The light theme keeps its white "paper" sky.
//
// Brightness of a direction v (horizon frame): the twilight sky (render-nightsky.js, from the
// Sun's altitude, turned into nL) times a direction factor - brighter towards the Sun and towards
// the horizon, normalised to 1 at the zenith so the zenith keeps the twilight curve's value - plus
// the moonlight (_nightSkyMoonNLAt, Krisciunas & Schaefer). The factor shapes only the colour; the
// limiting magnitude (stars, Milky Way) keeps the even twilight sky.
//
// The moonlight peaks steeply towards the Moon (1/ρ² within 10°), too sharp for the grid: sampled
// at nodes that move with the view, the glow changed shape while the view was dragged. So the grid
// takes the Moon's light as at least GLOW_MOON_CORE_DEG away, flat inside that circle, and the core
// is added over it ('lighter' compositing) as a radial gradient centred on the Moon: at each stop
// the full model's colour minus the capped one, along a ray up from the Moon. That difference is
// exactly 0 at the core's edge, so the grid's own colour (with its airmass and twilight in every
// direction) shows through unchanged there and the edge can never come out darker than the sky
// beyond it. It follows the Moon exactly, whatever the view does.
const GLOW_GRID_PX = 24;
// Brightness (mag/arcsec²) -> colour: night blue at 21.5 and darker, light day blue at 9 and brighter.
const GLOW_RAMP = [
  [21.5, [0, 21, 56]], [19.5, [6, 30, 78]], [17.5, [16, 48, 110]],
  [15, [38, 82, 150]], [12, [70, 120, 190]], [9, [110, 165, 225]],
];
const GLOW_WARM = [235, 140, 70];   // the warm twilight glow low over the Sun
const GLOW_SUN_A = 2.5, GLOW_SUN_DEG = 30, GLOW_HOR_A = 0.6;   // direction factor: Sun side, horizon
const GLOW_MOON_CORE_DEG = 15;
const GLOW_MOON_STOPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14, 15];   // °

function _glowShown() {
  return _nightSkyAtmOn() && !document.body.classList.contains('light');   // render-nightsky.js
}
function _glowRamp(b) {
  const R = GLOW_RAMP;
  if (b >= R[0][0]) return R[0][1];
  for (let i = 1; i < R.length; i++) {
    if (b >= R[i][0]) {
      const t = (R[i - 1][0] - b) / (R[i - 1][0] - R[i][0]);
      return R[i - 1][1].map((c, k) => c + t * (R[i][1][k] - c));
    }
  }
  return R[R.length - 1][1];
}
// Direction factor (unnormalised): psi the angle from the Sun (°), el the altitude (°).
function _glowDirFactor(psi, el) {
  return (1 + GLOW_SUN_A * Math.exp(-psi / GLOW_SUN_DEG)) * (1 + GLOW_HOR_A * Math.pow(1 - el / 90, 3));
}
// RGB of direction v (horizon frame, unit, z >= 0).
function _glowColorAt(v, s, gZen, rhoMin) {
  const el = Math.asin(Math.max(0, Math.min(1, v[2]))) * 180 / Math.PI;
  const psi = Math.acos(Math.max(-1, Math.min(1, v[0] * s.sun.v[0] + v[1] * s.sun.v[1] + v[2] * s.sun.v[2]))) * 180 / Math.PI;
  const nl = s.twiNL * _glowDirFactor(psi, el) / gZen + _nightSkyMoonNLAt(v, s, rhoMin);
  const c = _glowRamp(_nsBFromNL(nl));
  // The glow: strongest with the Sun just below the horizon (-3°), gone above +6° and below -12°.
  const tw = Math.max(0, 1 - Math.abs(s.sun.el + 3) / 9);
  const g = 0.6 * tw * Math.exp(-psi / 35) * Math.pow(1 - el / 90, 4);
  return g > 0 ? c.map((x, k) => x + g * (GLOW_WARM[k] - x)) : c;
}

let _glowCache = { key: null, canvas: null };
// Fills the sky region with the colour field. dirAt(px, py, out) writes the horizon-frame direction
// of a canvas point (any point, pushed onto the sky when off it). clip() clips to the sky region.
// moonAt() gives the Moon's {x, y} on the canvas and the px per degree there, or null.
function _glowDraw(ctx, w, h, dirAt, clip, viewKey, moonAt) {
  const s = _nightSkyAtmState();
  if (!s) return;
  const gw = Math.ceil(w / GLOW_GRID_PX) + 1, gh = Math.ceil(h / GLOW_GRID_PX) + 1;
  const key = [nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT, LAT, hemisphere, LONG, lonHemisphere, w, h, viewKey].join('|');
  if (_glowCache.key !== key) {
    const cv = _glowCache.canvas || document.createElement('canvas');
    cv.width = gw; cv.height = gh;
    const c = cv.getContext('2d'), img = c.createImageData(gw, gh), d = img.data, out = [0, 0, 0];
    const gZen = _glowDirFactor(Math.acos(Math.max(-1, Math.min(1, s.sun.v[2]))) * 180 / Math.PI, 90);
    for (let j = 0, p = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++, p += 4) {
        dirAt(i * GLOW_GRID_PX, j * GLOW_GRID_PX, out);
        if (out[2] < 0) {   // below the horizon: onto it, for a clean edge
          out[2] = 0;
          const n = Math.hypot(out[0], out[1]) || 1;
          out[0] /= n; out[1] /= n;
        }
        const col = _glowColorAt(out, s, gZen, GLOW_MOON_CORE_DEG);
        d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; d[p + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    _glowCache = { key, canvas: cv };
  }
  ctx.save();
  clip();
  ctx.imageSmoothingEnabled = true;
  // Node i sits at canvas x = i·GLOW_GRID_PX: each tiny pixel spans half a cell either side of it.
  ctx.drawImage(_glowCache.canvas, -GLOW_GRID_PX / 2, -GLOW_GRID_PX / 2, gw * GLOW_GRID_PX, gh * GLOW_GRID_PX);
  const m = s.moon && moonAt();
  if (m) {
    const gZen = _glowDirFactor(Math.acos(Math.max(-1, Math.min(1, s.sun.v[2]))) * 180 / Math.PI, 90);
    const mv = s.moon.v;
    let up = [-mv[2] * mv[0], -mv[2] * mv[1], 1 - mv[2] * mv[2]];   // towards the zenith, across mv
    const ul = Math.hypot(up[0], up[1], up[2]);
    up = ul > 1e-6 ? up.map(x => x / ul) : [1, 0, 0];
    const R = GLOW_MOON_CORE_DEG * m.pxPerDeg;
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, R);
    for (const rho of GLOW_MOON_STOPS) {
      const r = rho * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
      const dir = [mv[0] * cr + up[0] * sr, mv[1] * cr + up[1] * sr, mv[2] * cr + up[2] * sr];
      const full = _glowColorAt(dir, s, gZen), cap = _glowColorAt(dir, s, gZen, GLOW_MOON_CORE_DEG);
      const d = full.map((x, k) => Math.max(0, Math.round(x - cap[k])));
      g.addColorStop(rho / GLOW_MOON_CORE_DEG, `rgb(${d[0]},${d[1]},${d[2]})`);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, R, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.restore();
}

// Sky Map: the polar planisphere (_skyDomePoint), points past the rim taken at the horizon.
function _glowDrawSkyMap(ctx, w, h, layout) {
  const { cx, cy, R } = layout;
  _glowDraw(ctx, w, h, (px, py, out) => {
    const dx = px - cx, dy = py - cy, r = Math.hypot(dx, dy);
    const el = Math.max(0, 1 - r / R) * Math.PI / 2, ce = Math.cos(el);
    const sa = r > 1e-9 ? -dx / r : 0, ca = r > 1e-9 ? -dy / r : 1;
    out[0] = ce * sa; out[1] = ce * ca; out[2] = Math.sin(el);
  }, () => _nightSkyClipToSky(ctx, layout), 'map', () => {
    const mo = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (mo.el < 0) return null;
    const p = _skyDomePoint(cx, cy, R, mo.az, mo.el);
    return { x: p.x, y: p.y, pxPerDeg: R / 90 };
  });
}
// Planetarium: the inverse fisheye (as _nightSkyPlanetPixelToAzEl), held at its 170° rim.
function _glowDrawPlanetarium(ctx, w, h, layout) {
  const C = _nightSkyPlanet3D, Rt = C.RIGHT, U = C.UP, F = C.FWD;
  const kInv = 1 / (layout.scale * C.FOCAL);
  _glowDraw(ctx, w, h, (px, py, out) => {
    const sx = (px - layout.cx) * kInv, sy = -(py - layout.cy) * kInv;
    const theta = Math.min(NIGHTSKY_PLANET_FADE_OUTER, Math.hypot(sx, sy));
    const rr = Math.hypot(sx, sy) || 1;
    const k = Math.sin(theta) / rr, lz = Math.cos(theta);
    const lx = sx * k, ly = sy * k;
    for (let i = 0; i < 3; i++) out[i] = lx * Rt[i] + ly * U[i] + lz * F[i];
  }, () => _nightSkyClipToSky(ctx, layout), ['pl', C.camAz, C.camEl, C.zoom, C.roll].join(','), () => {
    const mo = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (mo.el < 0) return null;
    const p = _nightSkyPlanetProject(layout, mo.az, mo.el);
    return p.visible ? { x: p.x, y: p.y, pxPerDeg: C.FOCAL * layout.scale * Math.PI / 180 } : null;
  });
}
