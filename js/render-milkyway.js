// ─── Milky Way (Night Sky: Sky Map, Planetarium, Globe) ────────────────────────────────────────
// Source: data/celestial/mw.json from D3-Celestial (see data/celestial/NOTICE.md), five nested
// brightness outlines ol1 (faint outer edge) .. ol5 (bright core), each one MultiPolygon of [RA, Dec]
// J2000 rings, RA in -180..180. The smaller rings of a level are its holes (the Great Rift, the Coal
// Sack); the two largest rings of ol1 are the band's north and south edges and each runs once round
// the whole sky.
//
// Drawn as a texture, not as polygons: at load each of the five levels is filled into its own
// equirectangular RA/Dec map and softened by a blur of ~1°; the levels within Display "Mag ≤" are
// summed into _mwTex, each adding a fifth. Each view then colours a small offscreen buffer per
// pixel - pixel -> view direction -> J2000 RA/Dec -> texture - and draws it scaled up, the same way
// Planetarium colours its sky (render-skydome.js).
// The band is then cut at the horizon and the edge of the view by the projection itself, with no
// clipping of its rings per view. Atmospheric refraction is left out: the band is diffuse and ~1°
// soft, refraction at most 0.6° at the horizon.
const MW_TEX_W = 1440, MW_TEX_H = 720;   // 0.25° per texel
const MW_BLUR_R = 4;                      // box radius in texels, three passes: sigma ~1.1°
const MW_BUF_PX = 3;                      // canvas px per buffer px
let _mwLevels = null;                     // 5 x Uint8Array MW_TEX_W x MW_TEX_H: each level, blurred
let _mwTex = null;                        // Float32Array, the levels summed by weight, 0..1, row 0 = Dec +90
let _mwTexKey = '';                       // the weights _mwTex was summed with
let _mwPerPixel = false;                  // this redraw: level weights per pixel (moonlight), not _mwTex

// Display "Mag ≤" (render-nightsky.js) takes the levels away from the faint edge in, the way a
// brighter sky washes the band out. Thresholds from Bortle's scale (naked-eye limit 6.1-6.5: the
// Milky Way evident; 5.6-6.0: washed out; 5.1-5.5: seen only high up; 4.6-5.0: nearly invisible;
// 4.5 and below: invisible) set against the levels' extent in the data, each nested wholly inside
// the one before: ol1 covers 17 % of the sky, ol2 4 %, ol3 1.4 % (Cygnus, Sagittarius, Carina),
// ol4 0.3 % (Sagittarius-Scutum, Carina-Crux), ol5 0.1 % (the Sagittarius star cloud). Level k
// shows fully while the limit is at least MW_LEVEL_MAG[k] and fades out over the MW_LEVEL_FADE below
// it: at the slider's steps all five at 6+, ol2-ol5 at 6.0, ol3-ol5 at 5.5, ol4-ol5 at 5.0, none at
// 4.5 and below; with Atmosphere the levels come and go smoothly with the twilight, and with the
// Moon up the limit (and so the weights) is taken per pixel.
const MW_LEVEL_MAG = [6.5, 6.0, 5.5, 5.0, 5.0];
const MW_LEVEL_FADE = 0.5;
function _mwLevelWeights(L, w) {
  for (let k = 0; k < MW_LEVEL_MAG.length; k++) {
    w[k] = L === Infinity ? 1 : Math.max(0, Math.min(1, 1 + (L - MW_LEVEL_MAG[k]) / MW_LEVEL_FADE));
  }
  return w;
}

// Fills each level into its own map and blurs it. A ring is unwrapped across RA ±180 first; a ring
// that then spans the full 360° (a band edge) is closed over the north pole, so with the even-odd
// rule the two band edges leave exactly the band between them. Each ring is drawn at shifts of 360°
// so the part past either edge of the map comes in from the other side.
function _mwBuild(geo) {
  const cv = document.createElement('canvas');
  cv.width = MW_TEX_W; cv.height = MW_TEX_H;
  const c = cv.getContext('2d', { willReadFrequently: true });
  const X = (ra) => ra / 360 * MW_TEX_W, Y = (dec) => (90 - dec) / 180 * MW_TEX_H;
  _mwLevels = geo.features.map(f => {
    c.fillStyle = '#000'; c.fillRect(0, 0, MW_TEX_W, MW_TEX_H);
    c.fillStyle = '#fff';
    c.beginPath();
    for (const poly of f.geometry.coordinates) for (const ring of poly) {
      const ras = [], decs = [];
      let off = 0, prev = null;
      for (const [lon, lat] of ring) {
        let ra = lon + off;
        if (prev !== null) {
          while (ra - prev > 180) { off -= 360; ra -= 360; }
          while (ra - prev < -180) { off += 360; ra += 360; }
        }
        ras.push(ra); decs.push(lat); prev = ra;
      }
      const wraps = Math.abs(ras[ras.length - 1] - ras[0]) > 180;
      for (const k of [-720, -360, 0, 360, 720]) {
        c.moveTo(X(ras[0] + k), Y(decs[0]));
        for (let i = 1; i < ras.length; i++) c.lineTo(X(ras[i] + k), Y(decs[i]));
        if (wraps) { c.lineTo(X(ras[ras.length - 1] + k), Y(90)); c.lineTo(X(ras[0] + k), Y(90)); }
        c.closePath();
      }
    }
    c.fill('evenodd');
    const px = c.getImageData(0, 0, MW_TEX_W, MW_TEX_H).data;
    const a = new Float32Array(MW_TEX_W * MW_TEX_H);
    for (let i = 0; i < a.length; i++) a[i] = px[i * 4];
    _mwBlur(a);
    return Uint8Array.from(a, v => Math.round(v));
  });
  _mwTex = new Float32Array(MW_TEX_W * MW_TEX_H);
  _mwTexKey = '';
}
// Three passes of a box blur, along RA wrapping round and along Dec held at the poles.
function _mwBlur(a) {
  const b = new Float32Array(a.length), n = 2 * MW_BLUR_R + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < MW_TEX_H; y++) {
      const row = y * MW_TEX_W;
      let s = 0;
      for (let k = -MW_BLUR_R; k <= MW_BLUR_R; k++) s += a[row + (k + MW_TEX_W) % MW_TEX_W];
      for (let x = 0; x < MW_TEX_W; x++) {
        b[row + x] = s / n;
        s += a[row + (x + MW_BLUR_R + 1) % MW_TEX_W] - a[row + (x - MW_BLUR_R + MW_TEX_W) % MW_TEX_W];
      }
    }
    for (let x = 0; x < MW_TEX_W; x++) {
      let s = 0;
      for (let k = -MW_BLUR_R; k <= MW_BLUR_R; k++) s += b[Math.max(0, Math.min(MW_TEX_H - 1, k)) * MW_TEX_W + x];
      for (let y = 0; y < MW_TEX_H; y++) {
        a[y * MW_TEX_W + x] = s / n;
        s += b[Math.min(MW_TEX_H - 1, y + MW_BLUR_R + 1) * MW_TEX_W + x] - b[Math.max(0, y - MW_BLUR_R) * MW_TEX_W + x];
      }
    }
  }
}
// _mwTex as the levels summed by weight, each adding up to a fifth; rebuilt (~10 ms) only when the
// weights change by more than 0.02.
function _mwUpdateTex(w) {
  const key = w.map(v => Math.round(v * 50)).join(',');
  if (key === _mwTexKey) return;
  _mwTex.fill(0);
  for (let k = 0; k < _mwLevels.length; k++) {
    if (w[k] <= 0) continue;
    const l = _mwLevels[k], f = w[k] / (255 * 5);
    for (let i = 0; i < l.length; i++) _mwTex[i] += l[i] * f;
  }
  _mwTexKey = key;
}
function _mwLoad() {
  return fetch('data/celestial/mw.json').then(r => r.json()).then(_mwBuild)
    .catch(err => console.warn('Milky Way data not loaded:', err));
}

// Brightness 0..1 for a J2000 unit vector, bilinear between texels.
function _mwSample(x, y, z) {
  let u = Math.atan2(y, x) / (2 * Math.PI);
  if (u < 0) u += 1;
  const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, z))) / Math.PI;
  const fx = u * MW_TEX_W - 0.5, fy = Math.max(0, Math.min(MW_TEX_H - 1.001, v * MW_TEX_H - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const xa = (x0 + MW_TEX_W) % MW_TEX_W, xb = (x0 + 1) % MW_TEX_W;
  const r0 = y0 * MW_TEX_W, r1 = r0 + MW_TEX_W;
  const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
  if (!_mwPerPixel) {
    const t = _mwTex;
    return t[r0 + xa] * w00 + t[r0 + xb] * w01 + t[r1 + xa] * w10 + t[r1 + xb] * w11;
  }
  let sum = 0;   // per pixel: the levels by the weights in _mwPixW
  for (let k = 0; k < _mwLevels.length; k++) {
    const wk = _mwPixW[k];
    if (wk <= 0) continue;
    const t = _mwLevels[k];
    sum += wk * (t[r0 + xa] * w00 + t[r0 + xb] * w01 + t[r1 + xa] * w10 + t[r1 + xb] * w11);
  }
  return sum / (255 * 5);
}
const _mwPixW = [0, 0, 0, 0, 0], _mwW = [0, 0, 0, 0, 0];

// Whether to draw: the Display switch is on, the data is loaded and some level is within the limit
// (the slider and the twilight; the Moon can only lower it). Without the Moon up _mwTex is brought
// up to date with the weights; with it (Atmosphere on) they are taken per pixel in _mwDraw.
function _mwShown() {
  if (!_mwLevels || !document.getElementById('chkNightSkyMilkyWay').checked) return false;
  _mwLevelWeights(_nightSkySkyLimit(), _mwW);   // render-nightsky.js
  if (!_mwW.some(v => v > 0)) return false;
  const atm = _nightSkyAtmState();
  _mwPerPixel = !!(atm && atm.moon);
  if (!_mwPerPixel) _mwUpdateTex(_mwW);
  return true;
}
// Display star size (render-nightsky.js) sets the band's strength with the stars': medium is the
// reference, small 0.7x, large 1.35x. Where the star controls do not apply (Globe, Sky Map 3D) it
// stays at medium.
const MW_SCALE_GAIN = [0.7, 1, 1.35];
function _mwGain() {
  return _nightSkyMagControlsOn() ? MW_SCALE_GAIN[nightSkyStarScale] : 1;
}

// Colours a buffer of MW_BUF_PX canvas px per pixel and draws it over the canvas (w x h, CSS px).
// dirAt(px, py, out) writes the view direction of a canvas point into out (any frame) and returns a
// weight 0..1 (0 = nothing there); M turns that frame into J2000. In the per-pixel mode (the Moon up,
// Sky Map and Planetarium) out is in the horizon frame and the sky's limit comes from _mwLimitGrid.
// horizon: out is in the horizon frame (Sky Map, Planetarium); with Atmosphere on the band then dims
// towards the horizon by the same extinction as the stars (_nightSkyExtinctionMag), through a
// table of the transmission by sin(altitude).
const _mwBuf = { canvas: null, ctx: null, img: null };
const MW_EXT_N = 512;
let _mwExtLUT = null, _mwExtK = null;
function _mwExtinctionLUT() {
  if (_mwExtK !== NIGHTSKY_EXTINCTION_K) {
    _mwExtLUT = new Float32Array(MW_EXT_N + 1);
    for (let n = 0; n <= MW_EXT_N; n++) {
      const el = Math.asin(n / MW_EXT_N) * 180 / Math.PI;
      _mwExtLUT[n] = Math.pow(10, -0.4 * NIGHTSKY_EXTINCTION_K * (_nightSkyAirmass(el) - 1));
    }
    _mwExtK = NIGHTSKY_EXTINCTION_K;
  }
  return _mwExtLUT;
}
function _mwDraw(ctx, w, h, M, dirAt, horizon) {
  const bw = Math.ceil(w / MW_BUF_PX), bh = Math.ceil(h / MW_BUF_PX);
  if (!_mwBuf.canvas) { _mwBuf.canvas = document.createElement('canvas'); _mwBuf.ctx = _mwBuf.canvas.getContext('2d'); }
  if (_mwBuf.canvas.width !== bw || _mwBuf.canvas.height !== bh || !_mwBuf.img) {
    _mwBuf.canvas.width = bw; _mwBuf.canvas.height = bh;
    _mwBuf.img = _mwBuf.ctx.createImageData(bw, bh);
  }
  const lt = document.body.classList.contains('light');
  const [cr, cg, cb] = lt ? [40, 55, 80] : [190, 205, 240];
  const strength = (lt ? 0.16 : 0.34) * _mwGain() * 255;
  const d = _mwBuf.img.data, out = [0, 0, 0];
  const grid = _mwPerPixel ? _mwLimitGrid(bw, bh, dirAt) : null;
  const ext = horizon && _nightSkyAtmOn() ? _mwExtinctionLUT() : null;
  for (let j = 0, p = 0; j < bh; j++) {
    const py = (j + 0.5) * MW_BUF_PX;
    for (let i = 0; i < bw; i++, p += 4) {
      const wgt = dirAt((i + 0.5) * MW_BUF_PX, py, out);
      let a = 0;
      if (wgt > 0 && grid) _mwLevelWeights(_mwGridAt(grid, i, j), _mwPixW);
      if (wgt > 0 && (!_mwPerPixel || _mwPixW[_mwPixW.length - 1] > 0)) {
        const x = M[0][0] * out[0] + M[0][1] * out[1] + M[0][2] * out[2];
        const y = M[1][0] * out[0] + M[1][1] * out[1] + M[1][2] * out[2];
        const z = M[2][0] * out[0] + M[2][1] * out[1] + M[2][2] * out[2];
        const r = Math.hypot(x, y, z) || 1;
        a = _mwSample(x / r, y / r, z / r) * wgt * strength;
        if (ext) a *= ext[Math.round(Math.max(0, Math.min(1, out[2])) * MW_EXT_N)];
      }
      d[p] = cr; d[p + 1] = cg; d[p + 2] = cb; d[p + 3] = a;
    }
  }
  _mwBuf.ctx.putImageData(_mwBuf.img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(_mwBuf.canvas, 0, 0, bw * MW_BUF_PX, bh * MW_BUF_PX);
  ctx.restore();
}

// The sky's limit for the per-pixel mode changes slowly across the sky (moonlight varies over tens of
// degrees), so it is worked out only on a grid every MW_GRID_PX buffer pixels (24 canvas px, ~2-3°
// in a whole-sky Planetarium) and interpolated between its nodes. A node off the sky (below the
// horizon, outside Sky Map's circle) is left out of the interpolation. "No limit" counts as 6.5,
// where every level shows fully.
const MW_GRID_PX = 8;
function _mwLimitGrid(bw, bh, dirAt) {
  const gw = Math.ceil(bw / MW_GRID_PX) + 1, gh = Math.ceil(bh / MW_GRID_PX) + 1;
  const L = new Float64Array(gw * gh), ok = new Uint8Array(gw * gh), out = [0, 0, 0];
  const slider = _nightSkySliderLimit();
  for (let gj = 0; gj < gh; gj++) {
    for (let gi = 0; gi < gw; gi++) {
      const k = gj * gw + gi;
      if (dirAt((gi * MW_GRID_PX + 0.5) * MW_BUF_PX, (gj * MW_GRID_PX + 0.5) * MW_BUF_PX, out) > 0) {
        L[k] = Math.min(slider, _nightSkyAtmLimitAt(out), NIGHTSKY_MAG_LIMIT_OFF);
        ok[k] = 1;
      }
    }
  }
  return { gw, gh, L, ok };
}
function _mwGridAt(g, i, j) {
  const fx = i / MW_GRID_PX, fy = j / MW_GRID_PX;
  const gi = Math.min(g.gw - 2, Math.floor(fx)), gj = Math.min(g.gh - 2, Math.floor(fy));
  const tx = fx - gi, ty = fy - gj, k = gj * g.gw + gi;
  const ws = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty], ks = [k, k + 1, k + g.gw, k + g.gw + 1];
  let sum = 0, wsum = 0;
  for (let c = 0; c < 4; c++) if (g.ok[ks[c]]) { sum += ws[c] * g.L[ks[c]]; wsum += ws[c]; }
  return wsum > 0 ? sum / wsum : _nightSkySliderLimit();
}

// Equator of date -> J2000: the transpose of the precession matrix (a rotation).
function _mwDateToJ2000() {
  const m = _skyPrecessionMatrix(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
  return [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
}
// Horizon (x east, y north, z up; _skyDomeUnitVec) -> J2000, for the place in Location now. The
// columns are the east point, the north point and the zenith in the equator of date.
function _mwHorizonToJ2000() {
  const D2R = Math.PI / 180;
  const latMag = LAT === 0 ? 0.1 : LAT === 90 ? 89.9 : LAT;   // the same clamp as _skyOfDateAzEl
  const phi = hemisphere * latMag * D2R;
  const th = _skySiderealTimeHours(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT, lonHemisphere * LONG) * 15 * D2R;
  const sp = Math.sin(phi), cp = Math.cos(phi), st = Math.sin(th), ct = Math.cos(th);
  const cols = [[-st, ct, 0], [-sp * ct, -sp * st, cp], [cp * ct, cp * st, sp]];   // E, N, Z
  const P = _mwDateToJ2000();
  return [0, 1, 2].map(r => cols.map(c => P[r][0] * c[0] + P[r][1] * c[1] + P[r][2] * c[2]));
}

// Sky Map: the polar planisphere of _skyDomePoint (zenith at the centre, horizon at R).
function _mwDrawSkyMap(ctx, w, h, layout) {
  const { cx, cy, R } = layout;
  _mwDraw(ctx, w, h, _mwHorizonToJ2000(), (px, py, out) => {
    const dx = px - cx, dy = py - cy, r = Math.hypot(dx, dy);
    if (r > R) return 0;
    const el = (1 - r / R) * Math.PI / 2, ce = Math.cos(el);
    const sa = r > 1e-9 ? -dx / r : 0, ca = r > 1e-9 ? -dy / r : 1;
    out[0] = ce * sa; out[1] = ce * ca; out[2] = Math.sin(el);
    return 1;
  }, true);
}
// Planetarium: the inverse fisheye of _nightSkyPlanetPixelToAzEl, above the horizon only, fading
// towards the rim as the stars do (_nightSkyPlanetProjectRaw).
function _mwDrawPlanetarium(ctx, w, h, layout) {
  const C = _nightSkyPlanet3D, Rt = C.RIGHT, U = C.UP, F = C.FWD;
  const kInv = 1 / (layout.scale * C.FOCAL);
  _mwDraw(ctx, w, h, _mwHorizonToJ2000(), (px, py, out) => {
    const sx = (px - layout.cx) * kInv, sy = -(py - layout.cy) * kInv;
    const theta = Math.hypot(sx, sy);
    if (theta >= NIGHTSKY_PLANET_FADE_OUTER) return 0;
    const k = theta > 1e-6 ? Math.sin(theta) / theta : 1, lz = Math.cos(theta);
    const lx = sx * k, ly = sy * k;
    out[2] = lx * Rt[2] + ly * U[2] + lz * F[2];
    if (out[2] < 0) return 0;
    out[0] = lx * Rt[0] + ly * U[0] + lz * F[0];
    out[1] = lx * Rt[1] + ly * U[1] + lz * F[1];
    return theta <= NIGHTSKY_PLANET_FADE_INNER ? 1
      : 1 - (theta - NIGHTSKY_PLANET_FADE_INNER) / (NIGHTSKY_PLANET_FADE_OUTER - NIGHTSKY_PLANET_FADE_INNER);
  }, true);
}
// Globe: the sky behind the Earth, the inverse of _nsGlobeProjectDir (camera frame = equator of
// date); the globe is drawn over it afterwards.
function _mwDrawGlobe(ctx, w, h, L, cam) {
  const kInv = 1 / (cam.F * L.scale);
  _mwDraw(ctx, w, h, _mwDateToJ2000(), (px, py, out) => {
    const sx = (px - L.cx) * kInv, sy = -(py - L.cy) * kInv;
    for (let i = 0; i < 3; i++) out[i] = cam.fwd[i] + sx * cam.right[i] + sy * cam.up[i];
    return 1;
  });
}
