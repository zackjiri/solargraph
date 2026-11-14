// Overlay of a presented calibrated photo over the Planetarium sky (Catalog entries with a `calib`
// block: an all-sky photo, or a framed one of kind 'frame', resolved when presented). A round
// button in the Planetarium's button row (#btnNightSkyAllskyOverlay), shown only while such a photo
// is presented, turns it on; the opacity slider beside it (#nightSkyAllskyOpacity, 0 to 1) shows
// while it is on. Both values stay for as long as the page
// is open, across presentations.
//
// Drawing (_nsAllskyDraw, called by _nightSkyDrawPlanetarium above the sky background and below
// the stars, lines and labels): the photo (`full`) is loaded once and kept as pixels, its longer
// side at most NS_ALLSKY_PHOTO_MAX. Every screen pixel gives a direction (_nightSkyPlanetPixelToAzEl)
// at the photo's time_utc, and _allskySkyToPhoto turns it into a photo pixel with the time shift of
// the frame that point was shot in, so the stars line up and the landscape may move by up to ~1°.
// That mapping is computed on a grid of nodes NS_ALLSKY_GRID output pixels apart and interpolated
// between them (it changes slowly); the photo is sampled bilinearly. Outside circle_px (all-sky)
// or the usable rectangle (framed: crop_px, else the whole image; _allskyFrameRect) the overlay is
// transparent, with a one-pixel soft edge. The result goes to an offscreen canvas at the canvas's own resolution at rest,
// NS_ALLSKY_MOVING_RES of it while the view is dragged, pinched or zoomed (_nsAllskyMove, called by
// the Planetarium's interaction), and is kept until the view changes, so the opacity slider and
// other redraws only blit it.

const NS_ALLSKY_PHOTO_MAX = 2048;   // px, the longer side of the kept copy of the photo
const NS_ALLSKY_GRID = 8;           // output px between the mapping's grid nodes
const NS_ALLSKY_REST_RES = 1;       // of the canvas's own resolution, at rest
const NS_ALLSKY_MOVING_RES = 1 / 3; // while the view moves
const NS_ALLSKY_REST_MS = 180;      // full resolution this long after the last move
const _nsAllsky = { on: false, opacity: 0.7, moving: false };
const _nsAllskyStats = { blits: 0, renders: 0 };   // counts, read by the tests
let _nsAllskyPhoto = null;   // { src, ready, w, h, data (RGBA), promise, cal, calFor }
let _nsAllskyOut = null;     // { key, canvas }: the last rendered overlay
let _nsAllskyRestTimer = 0;
let _nsAllskyFailedFrame = null;   // the presented frame whose photo could not be loaded (a new presentation clears it)

// The presented frame when it has a calibration (all-sky or framed), else null.
function _nsAllskyFrame() {
  const f = _nightSkyActiveFrame;
  return _nightSkyFrameCalibrated(f) ? f : null;
}
function _nsAllskyShown() {
  return nightSkyActive && nightSkyTopView === 'visualization' && nightSkySubmode === 'planetarium' && !!_nsAllskyFrame();
}

// Loads the photo once per source into a reduced copy whose pixels are kept; redraws when it is in.
function _nsAllskyLoad(src) {
  if (_nsAllskyPhoto && _nsAllskyPhoto.src === src) return _nsAllskyPhoto;
  const ph = { src, ready: false, failed: false, w: 0, h: 0, data: null, cal: null, calFor: null };
  ph.promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (_nsAllskyPhoto !== ph) { resolve(false); return; }
      const k = Math.min(1, NS_ALLSKY_PHOTO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(2, Math.round(img.naturalWidth * k)), h = Math.max(2, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      ph.data = g.getImageData(0, 0, w, h).data;
      ph.w = w; ph.h = h; ph.ready = true;
      _nsAllskyOut = null;
      if (_nsAllsky.on && _nsAllskyShown()) drawNightSky();
      resolve(true);
    };
    img.onerror = () => {
      ph.failed = true;
      if (_nsAllskyPhoto === ph) _nsAllskyPhoto = null;   // not cached: presenting the tile again retries
      const f = _nsAllskyFrame();
      if (f && _nsAllskySrc(f) === src) {
        _nsAllskyFailedFrame = f;
        _nsAllsky.on = false; _nsAllsky.moving = false; clearTimeout(_nsAllskyRestTimer);
        _nsAllskySyncUI();
      }
      resolve(false);
    };
    img.src = src;
  });
  _nsAllskyPhoto = ph;
  return ph;
}
// The image the overlay is drawn from: the calibration's own `image` (the photo the pins were set
// on, e.g. a crop without the print frame) or, without it, the entry's `full`.
function _nsAllskySrc(f) { return (f.calib && f.calib.image) || f.full; }
// Resolves (true) when the presented photo's pixels are in; false without a calibrated photo.
function _nsAllskyPhotoReady() {
  const f = _nsAllskyFrame();
  return f ? _nsAllskyLoad(_nsAllskySrc(f)).promise : Promise.resolve(false);
}

// The view moves (drag, pinch, wheel, zoom slider): the lower resolution until NS_ALLSKY_REST_MS
// after the last move, then one redraw at full resolution.
function _nsAllskyMove() {
  if (!_nsAllsky.on) return;
  _nsAllsky.moving = true;
  clearTimeout(_nsAllskyRestTimer);
  _nsAllskyRestTimer = setTimeout(() => {
    _nsAllsky.moving = false;
    if (_nsAllskyShown()) drawNightSky();
  }, NS_ALLSKY_REST_MS);
}

// Renders the overlay for a w x h (CSS px) canvas into an offscreen canvas of W x H pixels.
function _nsAllskyRender(f, ph, w, h, W, H) {
  if (ph.calFor !== f.calib) { ph.cal = _allskyScaled(f.calib, ph.w, ph.h); ph.calFor = f.calib; }
  const cal = ph.cal, rect = cal.kind === 'frame';
  const [rx0, ry0, rx1, ry1] = rect ? _allskyFrameRect(cal) : [0, 0, ph.w, ph.h];
  const circle = cal.circle_px || [ph.w / 2, ph.h / 2, Math.min(ph.w, ph.h) / 2];
  const lat = f.latDeg, layout = _nightSkyPlanetLayout(w, h);
  const minEl = (Number.isFinite(cal.alt_edge) ? cal.alt_edge : -90) - 15;
  // the circle or the rectangle is tested per pixel; a framed photo's nodes farther than one image
  // size off it are dropped (near 90 deg from the axis a rectilinear image runs off to infinity)
  const far = (p) => rect && (p[0] < -ph.w || p[0] > 2 * ph.w || p[1] < -ph.h || p[1] > 2 * ph.h);
  const S = NS_ALLSKY_GRID, sx = w / W, sy = h / H;
  const GW = Math.ceil((W - 1) / S) + 1, GH = Math.ceil((H - 1) / S) + 1;
  const GX = new Float64Array(GW * GH), GY = new Float64Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const n = j * GW + i;
    const hit = _nightSkyPlanetPixelToAzEl(layout, (i * S + 0.5) * sx, (j * S + 0.5) * sy);
    let p = hit && hit.el >= minEl ? _allskySkyToPhoto(cal, hit.az, hit.el, lat, true) : null;
    if (p && far(p)) p = null;
    GX[n] = p ? p[0] : NaN; GY[n] = p ? p[1] : NaN;
  }

  const img = new ImageData(W, H), buf = new Uint32Array(img.data.buffer);
  const src = ph.data, pw = ph.w, rowB = pw * 4;
  const ccx = circle[0], ccy = circle[1], cr = circle[2];
  const rOut2 = (cr + 0.5) * (cr + 0.5), rIn2 = Math.max(0, cr - 0.5) * Math.max(0, cr - 0.5);
  const ph2 = ph.h, uMax = pw - 1 - 1e-6, vMax = ph2 - 1 - 1e-6;
  for (let j = 0; j < H; j++) {
    const gj = Math.min(GH - 2, (j / S) | 0), fy = (j - gj * S) / S, row = j * W;
    for (let gi = 0; gi < GW - 1; gi++) {
      const a = gj * GW + gi, c = a + GW;
      const xa = GX[a], xb = GX[a + 1], xc = GX[c], xd = GX[c + 1];
      if (xa !== xa || xb !== xb || xc !== xc || xd !== xd) continue;   // NaN: off the projection
      const ya = GY[a], yb = GY[a + 1], yc = GY[c], yd = GY[c + 1];
      const u0 = xa + (xc - xa) * fy, v0 = ya + (yc - ya) * fy;
      const du = (xb + (xd - xb) * fy - u0) / S, dv = (yb + (yd - yb) * fy - v0) / S;
      const i0 = gi * S, i1 = gi === GW - 2 ? W : Math.min(W, i0 + S);
      let u = u0, v = v0;
      for (let i = i0; i < i1; i++, u += du, v += dv) {
        let al;
        if (rect) {   // distance inside the nearest edge of the usable rectangle
          const e = Math.min(u - rx0, rx1 - u, v - ry0, ry1 - v);
          if (e <= -0.5) continue;
          al = e >= 0.5 ? 255 : Math.round((e + 0.5) * 255);
        } else {
          const dx = u - ccx, dy = v - ccy, d2 = dx * dx + dy * dy;
          if (d2 >= rOut2) continue;
          al = d2 <= rIn2 ? 255 : Math.round((cr + 0.5 - Math.sqrt(d2)) * 255);
        }
        let x = u - 0.5, y = v - 0.5;   // pixel centres sit at half-integer coordinates
        x = x < 0 ? 0 : x > uMax ? uMax : x;
        y = y < 0 ? 0 : y > vMax ? vMax : y;
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fz = y - y0;
        const k = (y0 * pw + x0) * 4, k2 = k + rowB;
        const w00 = (1 - fx) * (1 - fz), w10 = fx * (1 - fz), w01 = (1 - fx) * fz, w11 = fx * fz;
        const r = src[k] * w00 + src[k + 4] * w10 + src[k2] * w01 + src[k2 + 4] * w11;
        const g = src[k + 1] * w00 + src[k + 5] * w10 + src[k2 + 1] * w01 + src[k2 + 5] * w11;
        const b = src[k + 2] * w00 + src[k + 6] * w10 + src[k2 + 2] * w01 + src[k2 + 6] * w11;
        buf[row + i] = ((al << 24) | ((b + 0.5) << 16) | ((g + 0.5) << 8) | (r + 0.5)) >>> 0;
      }
    }
  }
  const out = (_nsAllskyOut && _nsAllskyOut.canvas) || document.createElement('canvas');
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  out.getContext('2d').putImageData(img, 0, 0);
  _nsAllskyStats.renders++;
  return out;
}

// Draws the overlay on the Planetarium canvas (ctx in CSS px, w x h) when it is on and the
// presented calibrated photo is loaded; moving: the lower resolution.
function _nsAllskyDraw(ctx, w, h, moving) {
  const f = _nsAllskyFrame();
  if (!_nsAllsky.on || !f || f === _nsAllskyFailedFrame) return;
  const ph = _nsAllskyLoad(_nsAllskySrc(f));
  if (!ph.ready) return;
  const dpr = Math.abs(ctx.getTransform().a) || 1;
  const res = dpr * (moving ? NS_ALLSKY_MOVING_RES : NS_ALLSKY_REST_RES);
  const W = Math.max(2, Math.round(w * res)), H = Math.max(2, Math.round(h * res));
  const P = _nightSkyPlanet3D;
  const key = [_nsAllskySrc(f), f.id, f.latDeg, ph.w, ph.h, w, h, W, H, P.FOCAL, P.FWD, P.UP, P.RIGHT].join('|');
  if (!_nsAllskyOut || _nsAllskyOut.key !== key || f.calib !== _nsAllskyOut.cal) {
    const canvas = _nsAllskyRender(f, ph, w, h, W, H);
    _nsAllskyOut = { key, canvas, cal: f.calib };
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, _nsAllsky.opacity));
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(_nsAllskyOut.canvas, 0, 0, w, h);
  ctx.restore();
  _nsAllskyStats.blits++;
}

// The button and the slider: the button while a calibrated photo is presented in the Planetarium
// (one place left of the search), the slider beside it while the overlay is on.
function _nsAllskySyncUI() {
  const shown = _nsAllskyShown();
  const btn = document.getElementById('btnNightSkyAllskyOverlay');
  btn.style.display = shown ? 'flex' : 'none';
  btn.classList.toggle('active', _nsAllsky.on);
  btn.setAttribute('aria-pressed', String(_nsAllsky.on));
  const failed = !!_nsAllskyFrame() && _nsAllskyFrame() === _nsAllskyFailedFrame;
  btn.disabled = failed;
  btn.title = failed ? 'Photo could not be loaded' : _nsAllsky.on ? 'Hide the photo over the sky' : 'Lay the photo over the sky';
  document.getElementById('nightSkyAllskyOpacityCtl').style.display = shown && _nsAllsky.on ? 'flex' : 'none';
  const rng = document.getElementById('nightSkyAllskyOpacity');
  if (Math.abs(parseFloat(rng.value) - _nsAllsky.opacity) > 1e-9) rng.value = _nsAllsky.opacity;
  document.getElementById('nightSkyAllskyOpacityVal').textContent = Math.round(_nsAllsky.opacity * 100) + '%';
}
document.getElementById('btnNightSkyAllskyOverlay').addEventListener('click', (e) => {
  e.stopPropagation();
  _nsAllsky.on = !_nsAllsky.on;
  if (!_nsAllsky.on) { _nsAllsky.moving = false; clearTimeout(_nsAllskyRestTimer); }
  _nsAllskySyncUI();
  if (nightSkyActive) drawNightSky();
});
document.getElementById('nightSkyAllskyOpacity').addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  if (!Number.isFinite(v)) return;
  _nsAllsky.opacity = Math.max(0, Math.min(1, v));
  _nsAllskySyncUI();
  if (nightSkyActive) drawNightSky();
});
