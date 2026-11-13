// Photo model: the mapping between the sky (apparent azimuth/altitude) and the pixels of a photo
// described by a catalog record's `calib` block, and the least-squares fit that finds that block from
// pins. Two kinds: "allsky" (a stitched all-sky photo, axis at the zenith) and "frame" (any other
// photo: axis anywhere on the sky, see "Framed photos" below). Needs only js/sky-astro.js
// (astronomy, refraction), so the calibration page can load the two files on their own.
//
// All-sky:
// Pixel geometry: a sky point at zenith distance theta and azimuth A (from north through east) lies
// r(theta) pixels from center_px, in the direction north_deg - A (east "left") or north_deg + A (east
// "right"), measured clockwise from image-up (image pixels, y down). r(theta) per projection:
// equidistant f*theta, stereographic 2f*tan(theta/2), equisolid 2f*sin(theta/2).
//
// Time: the panorama's frames were shot over span_min minutes around time_utc, so every star sits on
// the photo where it was at time_utc + dt_min of its own frame. A time shift turns the sky about the
// celestial pole at the sidereal rate; it is applied to the TRUE position (refraction removed and
// re-added), so stars near the horizon move correctly.

const ALLSKY_PROJECTIONS = ['equidistant', 'stereographic', 'equisolid'];
const ALLSKY_FRAME_PROJECTIONS = ['rectilinear', 'equidistant', 'stereographic', 'equisolid'];
const ALLSKY_SIDEREAL_DEG_PER_MIN = 15.0411 / 60;
const _ALLSKY_D2R = Math.PI / 180;

function _allskyR(projection, f, thetaRad) {
  if (projection === 'rectilinear') return thetaRad < Math.PI / 2 ? f * Math.tan(thetaRad) : NaN;
  if (projection === 'equidistant') return f * thetaRad;
  if (projection === 'stereographic') return 2 * f * Math.tan(thetaRad / 2);
  if (projection === 'equisolid') return 2 * f * Math.sin(thetaRad / 2);
  return NaN;
}

// Inverse of _allskyR; null when r is outside the projection's range (beyond the nadir) or f <= 0.
function _allskyTheta(projection, f, r) {
  if (!(f > 0) || !(r >= 0)) return null;
  if (projection === 'rectilinear') return Number.isFinite(r) ? Math.atan(r / f) : null;
  if (projection === 'equidistant') { const t = r / f; return t <= Math.PI ? t : null; }
  if (projection === 'stereographic') return 2 * Math.atan(r / (2 * f));
  if (projection === 'equisolid') { const s = r / (2 * f); return s <= 1 ? 2 * Math.asin(s) : null; }
  return null;
}

function _allskyFwdRaw(projection, east, zx, zy, f, northDeg, azDeg, elDeg) {
  const r = _allskyR(projection, f, (90 - elDeg) * _ALLSKY_D2R);
  const psi = (east === 'right' ? northDeg + azDeg : northDeg - azDeg) * _ALLSKY_D2R;
  return [zx + r * Math.sin(psi), zy - r * Math.cos(psi)];
}

// Apparent sky position -> photo pixel, ignoring the per-frame time shift. A frame cal must be
// resolved (_allskyResolve); for it the result is null where the projection has no image.
function _allskyForward(cal, azDeg, elDeg) {
  if (cal.kind === 'frame') {
    const B = _allskyFrameBasisOf(cal);
    return _allskyFrameFwdRaw(B, cal.projection, cal.center_px[0], cal.center_px[1], cal.f_px, cal.k1 || 0, _allskyTrueVec(azDeg, elDeg));
  }
  return _allskyFwdRaw(cal.projection, cal.east, cal.center_px[0], cal.center_px[1], cal.f_px, cal.north_deg, azDeg, elDeg);
}

// Photo pixel -> apparent { az, el } (az in [0, 360)); null outside the projection's range.
function _allskyInverse(cal, x, y) {
  if (cal.kind === 'frame') return _allskyFrameInv(cal, x, y);
  const dx = x - cal.center_px[0], dy = y - cal.center_px[1];
  const theta = _allskyTheta(cal.projection, cal.f_px, Math.hypot(dx, dy));
  if (theta === null) return null;
  const psi = Math.atan2(dx, -dy) / _ALLSKY_D2R;
  const az = cal.east === 'right' ? psi - cal.north_deg : cal.north_deg - psi;
  return { az: ((az % 360) + 360) % 360, el: 90 - theta / _ALLSKY_D2R };
}

// Unit vector of a TRUE altitude/azimuth in the horizontal frame (x east, y north, z zenith). The
// same formula gives the unit vector of an apparent position (the frame model uses it so).
function _allskyTrueVec(azDeg, elTrueDeg) {
  const a = azDeg * _ALLSKY_D2R, h = elTrueDeg * _ALLSKY_D2R;
  return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];
}

// Turns a true unit vector by the sky's motion over dtMin minutes (about the celestial pole axis
// (0, cos lat, sin lat), westward for positive dt) and returns the APPARENT { az, el }.
function _allskyRotVec(v, latDeg, dtMin) {
  const phi = latDeg * _ALLSKY_D2R, k = [0, Math.cos(phi), Math.sin(phi)];
  const al = -dtMin * ALLSKY_SIDEREAL_DEG_PER_MIN * _ALLSKY_D2R, c = Math.cos(al), s = Math.sin(al);
  const kv = k[1] * v[1] + k[2] * v[2];
  const kx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0], -k[1] * v[0]];
  const w = [0, 1, 2].map(i => v[i] * c + kx[i] * s + k[i] * kv * (1 - c));
  const elTrue = Math.asin(Math.max(-1, Math.min(1, w[2]))) / _ALLSKY_D2R;
  const az = Math.atan2(w[0], w[1]) / _ALLSKY_D2R;
  return { az: ((az % 360) + 360) % 360, el: elTrue + _skyRefractionDeg(elTrue) };
}

// Apparent position now -> apparent position dtMin minutes later (negative = earlier).
function _allskyRotateDt(azDeg, elDeg, latDeg, dtMin) {
  return _allskyRotVec(_allskyTrueVec(azDeg, _skyTrueFromApparentEl(elDeg)), latDeg, dtMin);
}

// Time shift at a photo pixel: inverse-distance (power 2) average of the pins' dt_min, exact at a
// pin; 0 without pins.
function _allskyDtAt(cal, x, y) {
  const pins = cal.pins || [];
  let sw = 0, sd = 0;
  for (const p of pins) {
    if (!p.px || !Number.isFinite(p.dt_min)) continue;
    const d2 = (p.px[0] - x) * (p.px[0] - x) + (p.px[1] - y) * (p.px[1] - y);
    if (d2 < 1e-12) return p.dt_min;
    sw += 1 / d2; sd += p.dt_min / d2;
  }
  return sw > 0 ? sd / sw : 0;
}

// Sky point (apparent, at time_utc) -> photo pixel, with the time shift of the frame it falls in:
// dt from the pin field at the unshifted pixel, then once more at the shifted one. null outside
// circle_px (all-sky), outside the image rectangle (frame) or outside the projection; open: no
// circle or rectangle test (null only outside the projection; the caller clips per pixel).
function _allskySkyToPhoto(cal, azDeg, elDeg, latDeg, open) {
  let p = _allskyForward(cal, azDeg, elDeg);
  if (p && (cal.pins || []).length && cal.span_min > 0) {
    const v = _allskyTrueVec(azDeg, _skyTrueFromApparentEl(elDeg));
    for (let i = 0; i < 2 && p; i++) {
      const dt = _allskyDtAt(cal, p[0], p[1]);
      const q = _allskyRotVec(v, latDeg, dt);
      p = _allskyForward(cal, q.az, q.el);
    }
  }
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  if (open) return p;
  if (cal.kind === 'frame') {
    const [w, h] = cal.image_size;
    return p[0] >= 0 && p[0] <= w && p[1] >= 0 && p[1] <= h ? p : null;
  }
  const c = cal.circle_px;
  if (c && Math.hypot(p[0] - c[0], p[1] - c[1]) > c[2]) return null;
  return p;
}

// The same calibration for the image resized to w x h (aspect ratio kept, so the x scale also
// scales f_px, the circle radius, the disc pins' r_px and rms_px; k1 is relative to f and stays).
function _allskyScaled(cal, w, h) {
  const sx = w / cal.image_size[0], sy = h / cal.image_size[1];
  const out = Object.assign({}, cal, {
    image_size: [w, h],
    center_px: [cal.center_px[0] * sx, cal.center_px[1] * sy],
    f_px: cal.f_px * sx,
  });
  if (cal.circle_px) out.circle_px = [cal.circle_px[0] * sx, cal.circle_px[1] * sy, cal.circle_px[2] * sx];
  if (Number.isFinite(cal.rms_px)) out.rms_px = cal.rms_px * sx;
  if (cal.pins) out.pins = cal.pins.map(p => Object.assign({}, p, { px: [p.px[0] * sx, p.px[1] * sy] }, Number.isFinite(p.r_px) ? { r_px: p.r_px * sx } : {}));
  return out;
}

// The photo's circle [cx, cy, r]: circle_px, or without it the circle inscribed in image_size.
function _allskyCircle(cal) {
  if (Array.isArray(cal.circle_px) && cal.circle_px.length >= 3) return cal.circle_px;
  const [w, h] = cal.image_size;
  return [w / 2, h / 2, Math.min(w, h) / 2];
}

// Lowest apparent altitude along the circle (360 samples; _allskyCircle); a sample beyond the
// projection's range counts as the nadir (-90).
function _allskyEdgeMinAlt(cal) {
  const c = _allskyCircle(cal);
  let min = 90;
  for (let k = 0; k < 360; k++) {
    const a = k * _ALLSKY_D2R;
    const q = _allskyInverse(cal, c[0] + c[2] * Math.sin(a), c[1] - c[2] * Math.cos(a));
    min = Math.min(min, q ? q.el : -90);
  }
  return min;
}

// ─── Framed photos (kind "frame") ───────────────────────────────────────────────────────────────
// Public block: axis_radec [RA, Dec] (J2000, degrees), roll_deg (position angle of image-up,
// measured from north through east in the tangent plane of the axis, the meaning of the catalog's
// rotation_deg and _nightSkyFrameCorners), east ("left" = an ordinary photo, "right" = mirrored),
// projection, f_px, k1, center_px (the image centre, not fitted), span_min, rms_px, pins.
//
// _allskyResolve turns axis_radec/roll_deg into the apparent horizontal frame of the photo's moment:
// _axis_az, _axis_el (apparent axis) and _roll_up (image-up turned from the vertical through the
// axis, in the same sense as the position angle). Every other frame function takes the resolved cal;
// the `_` fields are internal and never written to the catalog.
//
// Camera: F = axis unit vector; U0 = dF/del (toward the zenith along the vertical through the axis,
// defined even at the zenith); U = U0 cos(roll_up) + (U0 x F) sin(roll_up) (U0 x F is U0 turned by
// +90 deg of position angle, as north x F is east); R = F x U for east "left", -(F x U) for "right".
// For a sky vector v: theta = angle(F, v), psi = atan2(v.R, v.U), r = _allskyR(theta) (rectilinear
// f tan theta, defined below 90 deg), r_d = r (1 + k1 (r / f)^2), pixel = center_px +
// r_d (sin psi, -cos psi). With k1 < 0 r_d peaks at r / f = sqrt(-1 / (3 k1)); beyond that the
// projection has no image (null).
//
// roll_deg <-> roll_up: roll_deg = roll_up + Z, where Z is the position angle of the zenith
// direction at the axis (the parallactic angle, here including precession and refraction:
// _allskyZenithPA). The outline therefore includes refraction, while the uncalibrated catalog
// brackets (_nightSkyFrameCorners) are purely gnomonic in J2000 RA/Dec and ignore it.

function _allskyCross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function _allskyDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// Camera basis { F, U, R } for an apparent axis, roll_up (degrees) and east.
function _allskyFrameBasis(azDeg, elDeg, rollUpDeg, east) {
  const a = azDeg * _ALLSKY_D2R, e = elDeg * _ALLSKY_D2R, ce = Math.cos(e), se = Math.sin(e);
  const F = [ce * Math.sin(a), ce * Math.cos(a), se];
  const U0 = [-se * Math.sin(a), -se * Math.cos(a), ce];
  const W = _allskyCross(U0, F), c = Math.cos(rollUpDeg * _ALLSKY_D2R), s = Math.sin(rollUpDeg * _ALLSKY_D2R);
  const U = [0, 1, 2].map(i => U0[i] * c + W[i] * s);
  let R = _allskyCross(F, U);
  if (east === 'right') R = R.map(x => -x);
  return { F, U, R };
}
function _allskyFrameBasisOf(cal) {
  if (!Number.isFinite(cal._axis_az) || !Number.isFinite(cal._axis_el) || !Number.isFinite(cal._roll_up)) {
    throw new Error('frame calib is not resolved (_allskyResolve)');
  }
  return _allskyFrameBasis(cal._axis_az, cal._axis_el, cal._roll_up, cal.east);
}

// r -> r_d and back; null when r_d is beyond the peak of a negative k1 or not finite.
function _allskyDistort(r, f, k1) {
  if (!k1) return r;
  const u = r / f;
  if (k1 < 0 && u * u > -1 / (3 * k1)) return NaN;
  return r * (1 + k1 * u * u);
}
function _allskyUndistort(rd, f, k1) {
  if (!Number.isFinite(rd)) return null;
  if (!k1) return rd;
  if (k1 < 0) {
    const rMax = f * Math.sqrt(-1 / (3 * k1));
    if (rd > rMax * 2 / 3) return null;
  }
  // Newton from r = r_d converges monotonically (r_d(r) is concave for k1 < 0, convex for k1 > 0).
  let r = rd;
  for (let i = 0; i < 60; i++) {
    const u = r / f, g = r * (1 + k1 * u * u) - rd, d = g / (1 + 3 * k1 * u * u);
    r -= d;
    if (Math.abs(d) <= 1e-13 * Math.max(1, rd)) break;
  }
  return r;
}

// Unit sky vector -> pixel for a basis; null where there is no image.
function _allskyFrameFwdRaw(B, projection, cx, cy, f, k1, v) {
  const x = _allskyDot(v, B.R), y = _allskyDot(v, B.U), sinT = Math.hypot(x, y);
  const theta = Math.atan2(sinT, _allskyDot(v, B.F));
  const rd = _allskyDistort(_allskyR(projection, f, theta), f, k1);
  if (!Number.isFinite(rd)) return null;
  if (sinT === 0) return [cx, cy];
  return [cx + rd * x / sinT, cy - rd * y / sinT];
}

// Expected pixel radius of a disc of angular radius semiDeg centred on unit vector v, for a basis:
// the mean pixel distance from the projected centre to the 4 projected limb points at semiDeg along
// the radial (away from the axis) and tangential directions. Off-axis a disc projects larger than
// on the axis (rectilinear: sec^2 theta radially, sec theta tangentially), so this follows the disc's
// actual place on the photo, for every projection and k1. NaN where a point has no image.
function _allskyDiscRadiusPx(B, projection, cx, cy, f, k1, v, semiDeg) {
  const c = _allskyFrameFwdRaw(B, projection, cx, cy, f, k1, v);
  if (!c) return NaN;
  const fv = _allskyDot(B.F, v);
  let tr = [0, 1, 2].map(i => fv * v[i] - B.F[i]);   // away from the axis, tangent at v
  let n = Math.hypot(tr[0], tr[1], tr[2]);
  if (n < 1e-12) { tr = B.U.slice(); const u = _allskyDot(tr, v); tr = tr.map((x, i) => x - u * v[i]); n = Math.hypot(tr[0], tr[1], tr[2]); }
  tr = tr.map(x => x / n);
  const tt = _allskyCross(v, tr), s = Math.sin(semiDeg * _ALLSKY_D2R), co = Math.cos(semiDeg * _ALLSKY_D2R);
  let sum = 0;
  for (const [t, sg] of [[tr, 1], [tr, -1], [tt, 1], [tt, -1]]) {
    const q = _allskyFrameFwdRaw(B, projection, cx, cy, f, k1, [0, 1, 2].map(i => v[i] * co + sg * t[i] * s));
    if (!q) return NaN;
    sum += Math.hypot(q[0] - c[0], q[1] - c[1]);
  }
  return sum / 4;
}

// Pixel -> apparent { az, el } of a resolved frame cal; null outside the projection.
function _allskyFrameInv(cal, x, y) {
  const B = _allskyFrameBasisOf(cal);
  const dx = x - cal.center_px[0], dy = y - cal.center_px[1], rd = Math.hypot(dx, dy);
  const r = _allskyUndistort(rd, cal.f_px, cal.k1 || 0);
  if (r === null) return null;
  const theta = _allskyTheta(cal.projection, cal.f_px, r);
  if (theta === null) return null;
  const sp = rd > 0 ? dx / rd : 0, cp = rd > 0 ? -dy / rd : 1, ct = Math.cos(theta), st = Math.sin(theta);
  const v = [0, 1, 2].map(i => B.F[i] * ct + st * (B.R[i] * sp + B.U[i] * cp));
  const az = Math.atan2(v[0], v[1]) / _ALLSKY_D2R;
  return { az: ((az % 360) + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, v[2]))) / _ALLSKY_D2R };
}

// Site = { year, month, day, hourUT, latDeg, lonDegEast } -> { lst, jde, lat } with the app's clamp
// of a latitude of exactly 0 or 90 (as _skyBodyAzEl).
function _allskySite(site) {
  const latMag = Math.abs(site.latDeg) === 0 ? 0.1 : Math.abs(site.latDeg) === 90 ? 89.9 : Math.abs(site.latDeg);
  return {
    lat: (site.latDeg < 0 ? -1 : 1) * latMag,
    jde: _moonJDE(site.year, site.month, site.day, site.hourUT),
    lst: _skySiderealTimeHours(site.year, site.month, site.day, site.hourUT, site.lonDegEast),
  };
}
// J2000 RA/Dec -> apparent { az, el } (precession, horizon, refraction: the path of every star the app draws).
function _allskyRadecToApp(raDeg, decDeg, site) {
  const S = _allskySite(site), q = _skyJ2000ToDate(raDeg, decDeg, S.jde), p = _skyRaDecToAzEl(q.ra, q.dec, S.lst, S.lat);
  return { az: ((p.az % 360) + 360) % 360, el: p.el };
}
// Apparent { az, el } -> J2000 { ra, dec } (inverse of _allskyRadecToApp; the precession matrix is a
// rotation, so its transpose takes the date back to J2000).
function _allskyAppToRadec(azDeg, elDeg, site) {
  const S = _allskySite(site), d = _skyAzElToRaDec(azDeg, elDeg, S.lst, S.lat);
  const m = _skyPrecessionMatrix(S.jde), v = _skyDomeUnitVecRaDec(d);
  const x = m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2];
  const y = m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2];
  const z = m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2];
  return { ra: ((Math.atan2(y, x) / _ALLSKY_D2R) + 360) % 360, dec: Math.asin(Math.max(-1, Math.min(1, z))) / _ALLSKY_D2R };
}
// Position angle (degrees, from J2000 north through east) of the zenith direction at an apparent
// point: north is the apparent image of a J2000 meridian step (central difference of +-0.001 deg in
// Dec), so precession and refraction are both in it.
function _allskyZenithPA(site, azDeg, elDeg) {
  const c = _allskyAppToRadec(azDeg, elDeg, site), eps = 1e-3;
  const pa = _allskyRadecToApp(c.ra, c.dec + eps, site), pb = _allskyRadecToApp(c.ra, c.dec - eps, site);
  const F = _allskyTrueVec(azDeg, elDeg), va = _allskyTrueVec(pa.az, pa.el), vb = _allskyTrueVec(pb.az, pb.el);
  let N = [0, 1, 2].map(i => va[i] - vb[i]);
  const nf = _allskyDot(N, F);
  N = N.map((x, i) => x - nf * F[i]);
  const E = _allskyCross(N, F), a = azDeg * _ALLSKY_D2R, e = elDeg * _ALLSKY_D2R;
  const U0 = [-Math.sin(e) * Math.sin(a), -Math.sin(e) * Math.cos(a), Math.cos(e)];
  return Math.atan2(_allskyDot(U0, E), _allskyDot(U0, N)) / _ALLSKY_D2R;
}
function _allskyAngle180(a) { return ((a % 360) + 540) % 360 - 180; }

// A cal for its photo's moment: a frame cal gets _axis_az, _axis_el and _roll_up; an all-sky cal
// comes back unchanged. Always a new object (the catalog block is not touched).
function _allskyResolve(cal, site) {
  const out = Object.assign({}, cal);
  if (cal.kind !== 'frame') return out;
  const ax = _allskyRadecToApp(cal.axis_radec[0], cal.axis_radec[1], site);
  out._axis_az = ax.az; out._axis_el = ax.el;
  out._roll_up = _allskyAngle180(cal.roll_deg - _allskyZenithPA(site, ax.az, ax.el));
  return out;
}
// A resolved frame cal -> { axis_radec, roll_deg } (the public fields, after a fit).
function _allskyFrameToRadec(cal, site) {
  const c = _allskyAppToRadec(cal._axis_az, cal._axis_el, site);
  return { axis_radec: [c.ra, c.dec], roll_deg: _allskyAngle180(cal._roll_up + _allskyZenithPA(site, cal._axis_az, cal._axis_el)) };
}
// Outline of the image of a resolved frame cal: n points evenly along the edge of the rectangle
// [0, w] x [0, h], clockwise from the top-left corner, each _allskyInverse ({ az, el } or null).
function _allskyFrameOutline(cal, n) {
  const [w, h] = cal.image_size, per = 2 * (w + h), out = [];
  for (let k = 0; k < n; k++) {
    let s = k * per / n, x, y;
    if (s < w) { x = s; y = 0; } else if ((s -= w) < h) { x = w; y = s; } else if ((s -= h) < w) { x = w - s; y = h; } else { s -= w; x = 0; y = h - s; }
    out.push(_allskyInverse(cal, x, y));
  }
  return out;
}

// Solves (A + lambda * diag(A)) x = b by Gaussian elimination with partial pivoting; null if singular.
function _allskySolve(A, b, lambda) {
  const n = b.length, maxD = Math.max(...A.map((r, i) => r[i]), 1e-300);
  const M = A.map((r, i) => { const row = r.slice(); row[i] += lambda * Math.max(r[i], 1e-12 * maxD); row.push(b[i]); return row; });
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

// Levenberg-Marquardt over p = [shared_1..shared_ns, dt_1..dt_m]. model: { ns (shared count),
// H (their difference steps), prep(p) -> ctx (whatever fwd needs from the shared values),
// fwd(ctx, az, el) -> [x, y] (NaN where there is no image), extra(ctx) -> residuals after the pin
// rows (disc radii; optional), valid(p) }. All-sky: shared = [zx, zy, f, north]
// (_allskyModelAllsky); frame: [axis_az, axis_el, (roll_up), f, (k1)] (_allskyModelFrame).
// pv: true unit vectors of the pins at time_utc; dt (m = pins when dtMax > 0) is clamped to
// +-dtMax. Returns { p, cost } (cost = sum of squared pixel residuals).
function _allskyLM(model, pins, pv, latDeg, dtMax, p0) {
  const n = pins.length, useDt = dtMax > 0, np = p0.length, ns = model.ns;
  const rot = (i, dt) => useDt ? _allskyRotVec(pv[i], latDeg, dt) : pins[i];
  const resid = (p, pos) => {
    const ctx = model.prep(p), ex = model.extra ? model.extra(ctx) : [];
    const r = new Array(2 * n + ex.length);
    for (let i = 0; i < n; i++) {
      const xy = model.fwd(ctx, pos[i].az, pos[i].el);
      r[2 * i] = xy[0] - pins[i].px[0]; r[2 * i + 1] = xy[1] - pins[i].px[1];
    }
    for (let j = 0; j < ex.length; j++) r[2 * n + j] = ex[j];
    return r;
  };
  const costOf = r => { let c = 0; for (const v of r) c += v * v; return Number.isFinite(c) ? c : Infinity; };
  const positions = p => pins.map((_, i) => rot(i, useDt ? p[ns + i] : 0));
  let p = p0.slice(), pos = positions(p), r = resid(p, pos), cost = costOf(r), lambda = 1e-3;
  const H = model.H;
  let done = false;
  for (let it = 0; it < 200 && !done && cost > 1e-20; it++) {
    // Jacobian (central differences): ns shared columns over all rows, and per pin one dt column
    // that only touches its own two rows (jd[i] = [dx/ddt, dy/ddt]).
    const J = [];
    for (let j = 0; j < ns; j++) {
      const a = p.slice(), b = p.slice(); a[j] += H[j]; b[j] -= H[j];
      const ra = resid(a, pos), rb = resid(b, pos);
      J.push(ra.map((v, k) => (v - rb[k]) / (2 * H[j])));
    }
    const jd = [];
    if (np > ns) {
      const ctx = model.prep(p);
      for (let i = 0; i < np - ns; i++) {
        const h = 1e-3, qa = rot(i, p[ns + i] + h), qb = rot(i, p[ns + i] - h);
        const xa = model.fwd(ctx, qa.az, qa.el), xb = model.fwd(ctx, qb.az, qb.el);
        jd.push([(xa[0] - xb[0]) / (2 * h), (xa[1] - xb[1]) / (2 * h)]);
      }
    }
    // Normal equations in blocks: U (shared x shared), W[i] (shared x dt_i), V[i] (dt_i x dt_i,
    // a scalar), gradients gA and gD. The dt block is diagonal, so the shared step comes from the
    // ns x ns Schur complement and each dt step from its own pin: linear in the pin count instead
    // of cubic in all unknowns, with the same result as solving the full system.
    const U = J.map(cj => J.map(ck => { let s = 0; for (let k = 0; k < cj.length; k++) s += cj[k] * ck[k]; return s; }));
    const gA = J.map(cj => { let s = 0; for (let k = 0; k < cj.length; k++) s -= cj[k] * r[k]; return s; });
    const W = jd.map((c, i) => J.map(cj => cj[2 * i] * c[0] + cj[2 * i + 1] * c[1]));
    const V = jd.map(c => c[0] * c[0] + c[1] * c[1]);
    const gD = jd.map((c, i) => -(c[0] * r[2 * i] + c[1] * r[2 * i + 1]));
    const maxD = Math.max(1e-300, ...U.map((row, k) => row[k]), ...V);
    const step = lam => {
      const damp = v => v + lam * Math.max(v, 1e-12 * maxD);
      const S = U.map((row, a) => row.map((v, b) => a === b ? damp(v) : v)), rhs = gA.slice(), Vd = V.map(damp);
      for (let i = 0; i < V.length; i++) {
        const w = W[i], inv = 1 / Vd[i];
        for (let a = 0; a < ns; a++) {
          rhs[a] -= w[a] * gD[i] * inv;
          for (let b = 0; b < ns; b++) S[a][b] -= w[a] * w[b] * inv;
        }
      }
      const dA = _allskySolve(S, rhs, 0);
      if (!dA) return null;
      const d = dA.concat(V.map((_, i) => { let s = 0; for (let a = 0; a < ns; a++) s += W[i][a] * dA[a]; return (gD[i] - s) / Vd[i]; }));
      return d.every(Number.isFinite) ? d : null;
    };
    let accepted = false;
    while (lambda < 1e12) {
      const d = step(lambda);
      if (d) {
        const q = p.map((v, k) => v + d[k]);
        for (let k = ns; k < np; k++) q[k] = Math.max(-dtMax, Math.min(dtMax, q[k]));
        if (model.valid(q)) {
          const qpos = positions(q), qr = resid(q, qpos), qc = costOf(qr);
          if (qc < cost) {
            const gain = cost - qc;
            p = q; pos = qpos; r = qr; cost = qc; lambda = Math.max(lambda / 3, 1e-12); accepted = true;
            done = gain <= 1e-15 * cost;
            break;
          }
        }
      }
      lambda *= 4;
    }
    if (!accepted) break;
  }
  return { p, cost };
}

// All-sky model for _allskyLM: shared [zx, zy, f, north].
function _allskyModelAllsky(projection, east) {
  return {
    ns: 4, H: [1e-3, 1e-3, 1e-3, 1e-5], prep: p => p, valid: q => q[2] > 0,
    fwd: (p, az, el) => _allskyFwdRaw(projection, east, p[0], p[1], p[2], p[3], az, el),
  };
}
// Frame model for _allskyLM: shared [axis_az, axis_el, roll_up (absent when rollFixed), f, k1 (when
// fitK1)]. rollFixed is a roll_deg; roll_up then follows the axis (roll_deg - _allskyZenithPA).
// Disc pins (r_px with semiDeg) add one radius row each: _allskyDiscRadiusPx at the disc's own
// (time_utc) position - r_px.
function _allskyModelFrame(projection, east, center, rollFixed, fitK1, k1Fixed, site, discs) {
  const iF = rollFixed === null ? 3 : 2, ns = iF + 1 + (fitK1 ? 1 : 0);
  return {
    ns, iF,
    H: [1e-5, 1e-5].concat(rollFixed === null ? [1e-5] : [], [1e-3], fitK1 ? [1e-6] : []),
    prep: p => {
      const roll = rollFixed === null ? p[2] : rollFixed - _allskyZenithPA(site, p[0], p[1]);
      return { B: _allskyFrameBasis(p[0], p[1], roll, east), f: p[iF], k1: fitK1 ? p[iF + 1] : k1Fixed, roll };
    },
    fwd: (c, az, el) => _allskyFrameFwdRaw(c.B, projection, center[0], center[1], c.f, c.k1, _allskyTrueVec(az, el)) || [NaN, NaN],
    extra: c => discs.map(d => _allskyDiscRadiusPx(c.B, projection, center[0], center[1], c.f, c.k1, d.v, d.semiDeg) - d.r_px),
    valid: q => q[iF] > 0 && q[1] > -90 && q[1] < 90,
  };
}

function _allskyFitFail(reason) {
  return { ok: false, reason, cal: null, byProjection: {}, perPin: [] };
}

// Least-squares calibration from star pins. opts.kind 'frame' fits a framed photo
// (_allskyFitFrame); otherwise (all-sky) pins: [{ hip, px: [x, y], az, el }] with the APPARENT
// position at time_utc; opts: { latDeg, spanMin, circle: [cx, cy, r], imageSize: [w, h] }.
// Unknowns: center_px (2), f_px, north_deg, east (discrete) and, when spanMin > 0, one dt_min per pin
// (within +-spanMin/2). Every projection is fitted from 8 north starts x both east values; the
// smallest rms_px wins. Optional opts.projections, opts.east and opts.northStart narrow that to the
// listed projections, one east value and one north start (a quick refit near a known solution). On
// bad input returns ok: false with a reason and cal: null.
function _allskyFit(pins, opts) {
  opts = opts || {};
  if (opts.kind === 'frame') return _allskyFitFrame(pins, opts);
  const latDeg = opts.latDeg, span = Math.max(0, opts.spanMin || 0), dtMax = span / 2;
  if (!Number.isFinite(latDeg)) return _allskyFitFail('Latitude is missing.');
  pins = pins || [];
  const need = span > 0 ? 6 : 4;
  if (pins.length < need) {
    return _allskyFitFail(`Need at least ${need} pins (have ${pins.length})` + (span > 0 ? ': 4 shared values (zenith x, y, scale, north) plus one time shift per pin.' : '.'));
  }
  if (!pins.every(p => p.px && Number.isFinite(p.px[0]) && Number.isFinite(p.px[1]) && Number.isFinite(p.az) && Number.isFinite(p.el))) {
    return _allskyFitFail('A pin has no valid pixel or sky position.');
  }
  const els = pins.map(p => p.el), lo = Math.min(...els), hi = Math.max(...els);
  if (lo > 60) return _allskyFitFail('All pins are above 60° altitude; add stars lower in the sky so the lens projection can be determined.');
  if (hi - lo < 20) return _allskyFitFail('Pins span less than 20° of altitude; spread them between the horizon and the zenith.');

  const size = opts.imageSize;
  const circle = opts.circle || (size ? [size[0] / 2, size[1] / 2, Math.min(size[0], size[1]) / 2] : null);
  if (!circle || !(circle[2] > 0)) return _allskyFitFail('The image circle is missing.');
  const pv = pins.map(p => _allskyTrueVec(p.az, _skyTrueFromApparentEl(p.el)));
  const dtCount = span > 0 ? pins.length : 0;

  const makeCal = (projection, east, p, cost) => {
    const cal = {
      kind: 'allsky',
      image_size: size ? [size[0], size[1]] : [circle[0] * 2, circle[1] * 2],
      center_px: [p[0], p[1]], projection, f_px: p[2], north_deg: ((p[3] % 360) + 360) % 360, east,
      circle_px: circle.slice(), alt_edge: 0, span_min: span, rms_px: Math.sqrt(cost / pins.length),
      pins: pins.map((pin, i) => ({ hip: pin.hip, px: [pin.px[0], pin.px[1]], dt_min: dtCount ? p[4 + i] : 0 })),
    };
    cal.alt_edge = _allskyEdgeMinAlt(cal);
    return cal;
  };

  const projections = Array.isArray(opts.projections) ? ALLSKY_PROJECTIONS.filter(pr => opts.projections.includes(pr)) : ALLSKY_PROJECTIONS;
  const easts = opts.east === 'left' || opts.east === 'right' ? [opts.east] : ['left', 'right'];
  const norths = Number.isFinite(opts.northStart) ? [opts.northStart] : [0, 45, 90, 135, 180, 225, 270, 315];
  const byProjection = {};
  let best = null;
  for (const projection of projections) {
    const f0 = circle[2] / _allskyR(projection, 1, Math.PI / 2);
    let pb = null;
    for (const east of easts) for (const north0 of norths) {
      const p0 = [circle[0], circle[1], f0, north0].concat(new Array(dtCount).fill(0));
      const res = _allskyLM(_allskyModelAllsky(projection, east), pins, pv, latDeg, dtMax, p0);
      if (Number.isFinite(res.cost) && res.p.every(Number.isFinite) && (!pb || res.cost < pb.cost)) pb = Object.assign(res, { east });
    }
    if (!pb) continue;
    const cal = makeCal(projection, pb.east, pb.p, pb.cost);
    byProjection[projection] = { rms: cal.rms_px, cal };
    if (!best || cal.rms_px < best.cal.rms_px) best = { cal, p: pb.p };
  }
  if (!best || !Number.isFinite(best.cal.alt_edge)) return _allskyFitFail('The fit did not converge; check the pins.');

  const cal = best.cal;
  const perPin = pins.map((pin, i) => {
    const pos = dtCount ? _allskyRotVec(pv[i], latDeg, cal.pins[i].dt_min) : pin;
    const xy = _allskyForward(cal, pos.az, pos.el);
    return { hip: pin.hip, residPx: Math.hypot(xy[0] - pin.px[0], xy[1] - pin.px[1]), dtMin: cal.pins[i].dt_min };
  });
  return { ok: true, reason: '', cal, byProjection, perPin };
}

// Diagonal field (degrees) above which a rectilinear fit also fits k1, and the pins it needs.
const ALLSKY_K1_MIN_DIAG_DEG = 30, ALLSKY_K1_MIN_PINS = 8;

// Least-squares calibration of a framed photo. pins: [{ hip | obj, px: [x, y], az, el, r_px?,
// semiDeg? }] with the APPARENT position at time_utc; a disc pin (Sun, Moon) also has r_px and the
// disc's angular radius semiDeg. opts: { kind: 'frame', site, start (a resolved frame cal: axis,
// roll, f_px, projection, east, image_size, center_px), rollFixed (a roll_deg or null), projections
// (default ['rectilinear']), spanMin (0), latDeg (site.latDeg), image }.
// Unknowns: axis_az, axis_el, roll_up (unless rollFixed), f_px, k1 (rectilinear with a diagonal
// field over 30 deg and at least 8 pins; else 0) and, when spanMin > 0, one dt_min per pin. Roll
// starts at the start's roll, or at 8 values when the start has none; with 3 or more distinct sky
// points and a free roll both east values are tried (fewer points cannot tell a mirror image).
function _allskyFitFrame(pins, opts) {
  const site = opts.site, start = opts.start;
  if (!site || !Number.isFinite(site.latDeg)) return _allskyFitFail('The site (time and place) is missing.');
  if (!start || !Number.isFinite(start._axis_az) || !Number.isFinite(start._axis_el) || !(start.f_px > 0) || !start.image_size) {
    return _allskyFitFail('The starting frame (axis, scale, image size) is missing.');
  }
  const latDeg = Number.isFinite(opts.latDeg) ? opts.latDeg : site.latDeg;
  const span = Math.max(0, opts.spanMin || 0), dtMax = span / 2;
  const rollFixed = Number.isFinite(opts.rollFixed) ? opts.rollFixed : null;
  pins = pins || [];
  if (!pins.length) return _allskyFitFail('No pins.');
  if (!pins.every(p => p.px && Number.isFinite(p.px[0]) && Number.isFinite(p.px[1]) && Number.isFinite(p.az) && Number.isFinite(p.el))) {
    return _allskyFitFail('A pin has no valid pixel or sky position.');
  }
  const discs = [];
  for (const p of pins) {
    if (p.r_px === undefined || p.r_px === null) continue;
    if (!(p.r_px > 0) || !(p.semiDeg > 0)) return _allskyFitFail('A disc pin needs its radius in pixels and its angular radius.');
    discs.push({ r_px: p.r_px, semiDeg: p.semiDeg, v: _allskyTrueVec(p.az, p.el) });
  }
  const pv = pins.map(p => _allskyTrueVec(p.az, _skyTrueFromApparentEl(p.el)));
  const sky = pins.map(p => _allskyTrueVec(p.az, p.el)), distinctPts = [];
  for (const v of sky) if (!distinctPts.some(u => _allskyDot(u, v) > Math.cos(1e-4 * _ALLSKY_D2R))) distinctPts.push(v);
  const distinct = distinctPts.length;
  if (rollFixed === null && distinct < 2) {
    return _allskyFitFail('One sky point cannot fix the rotation; add a second point (a star, or the Moon next to the Sun) or set the rotation by hand.');
  }
  const dtCount = span > 0 ? pins.length : 0;
  const eqs = 2 * pins.length + discs.length, minUnknowns = (rollFixed === null ? 4 : 3) + dtCount;
  if (eqs < minUnknowns) {
    return _allskyFitFail(`Not enough pins: ${minUnknowns} unknowns (axis 2, ${rollFixed === null ? 'rotation, ' : ''}scale${dtCount ? ', one time shift per pin' : ''}) need as many equations; each pin gives 2, a disc radius 1 more (have ${eqs}).`);
  }

  const size = start.image_size, center = start.center_px || [size[0] / 2, size[1] / 2];
  const diagDeg = 2 * Math.atan(Math.hypot(size[0], size[1]) / 2 / start.f_px) / _ALLSKY_D2R;
  const rollStarts = rollFixed !== null ? [null] : Number.isFinite(start._roll_up) ? [start._roll_up] : [0, 45, 90, 135, 180, 225, 270, 315];
  const east0 = start.east === 'right' ? 'right' : 'left';
  const easts = rollFixed === null && distinct >= 3 ? [east0, east0 === 'left' ? 'right' : 'left'] : [east0];
  const projections = (opts.projections || ['rectilinear']).filter(pr => ALLSKY_FRAME_PROJECTIONS.includes(pr));
  if (!projections.length) return _allskyFitFail('No known projection.');

  const byProjection = {};
  let best = null;
  for (const projection of projections) {
    const fitK1 = projection === 'rectilinear' && diagDeg > ALLSKY_K1_MIN_DIAG_DEG && pins.length >= ALLSKY_K1_MIN_PINS &&
      eqs >= minUnknowns + 1;
    let pb = null;
    for (const east of easts) for (const roll0 of rollStarts) {
      const model = _allskyModelFrame(projection, east, center, rollFixed, fitK1, 0, site, discs);
      const shared = [start._axis_az, start._axis_el].concat(rollFixed === null ? [roll0] : [], [start.f_px], fitK1 ? [0] : []);
      const res = _allskyLM(model, pins, pv, latDeg, dtMax, shared.concat(new Array(dtCount).fill(0)));
      if (Number.isFinite(res.cost) && res.p.every(Number.isFinite) && (!pb || res.cost < pb.cost)) pb = Object.assign(res, { east, model });
    }
    if (!pb) continue;
    const ctx = pb.model.prep(pb.p), iF = pb.model.iF, ns = pb.model.ns;
    const cal = {
      kind: 'frame', image: opts.image || start.image, image_size: [size[0], size[1]],
      axis_radec: null, roll_deg: null, east: pb.east, projection, f_px: pb.p[iF], k1: ctx.k1,
      center_px: [center[0], center[1]], span_min: span, rms_px: Math.sqrt(pb.cost / pins.length),
      pins: pins.map((pin, i) => {
        const o = pin.hip !== undefined && pin.hip !== null ? { hip: pin.hip } : { obj: pin.obj };
        o.px = [pin.px[0], pin.px[1]];
        if (o.hip !== undefined) o.dt_min = dtCount ? pb.p[ns + i] : 0;
        else if (dtCount) o.dt_min = pb.p[ns + i];
        if (Number.isFinite(pin.r_px)) o.r_px = pin.r_px;
        return o;
      }),
      _axis_az: ((pb.p[0] % 360) + 360) % 360, _axis_el: pb.p[1], _roll_up: _allskyAngle180(ctx.roll),
    };
    if (!cal.image) delete cal.image;
    const pub = _allskyFrameToRadec(cal, site);
    cal.axis_radec = pub.axis_radec;
    cal.roll_deg = rollFixed !== null ? rollFixed : pub.roll_deg;
    byProjection[projection] = { rms: cal.rms_px, cal };
    if (!best || cal.rms_px < best.cal.rms_px) best = { cal, p: pb.p, ns };
  }
  if (!best) return _allskyFitFail('The fit did not converge; check the pins.');

  const cal = best.cal;
  const perPin = pins.map((pin, i) => {
    const dt = dtCount ? best.p[best.ns + i] : 0;
    const pos = dtCount ? _allskyRotVec(pv[i], latDeg, dt) : pin;
    const xy = _allskyForward(cal, pos.az, pos.el) || [NaN, NaN];
    const o = { hip: pin.hip, obj: pin.obj, residPx: Math.hypot(xy[0] - pin.px[0], xy[1] - pin.px[1]), dtMin: dt };
    if (Number.isFinite(pin.r_px)) {
      o.residRPx = _allskyDiscRadiusPx(_allskyFrameBasisOf(cal), cal.projection, cal.center_px[0], cal.center_px[1], cal.f_px, cal.k1, _allskyTrueVec(pin.az, pin.el), pin.semiDeg) - pin.r_px;
    }
    return o;
  });
  return { ok: true, reason: '', cal, byProjection, perPin };
}
