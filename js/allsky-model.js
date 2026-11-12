// All-sky photo model: the mapping between the sky (apparent azimuth/altitude) and the pixels of a
// stitched all-sky photo described by a catalog record's `allsky` block, and the least-squares fit
// that finds that block from star pins. Needs only js/sky-astro.js (refraction), so the calibration
// page can load the two files on their own.
//
// Pixel geometry: a sky point at zenith distance theta and azimuth A (from north through east) lies
// r(theta) pixels from zenith_px, in the direction north_deg - A (east "left") or north_deg + A (east
// "right"), measured clockwise from image-up (image pixels, y down). r(theta) per projection:
// equidistant f*theta, stereographic 2f*tan(theta/2), equisolid 2f*sin(theta/2).
//
// Time: the panorama's frames were shot over span_min minutes around time_utc, so every star sits on
// the photo where it was at time_utc + dt_min of its own frame. A time shift turns the sky about the
// celestial pole at the sidereal rate; it is applied to the TRUE position (refraction removed and
// re-added), so stars near the horizon move correctly.

const ALLSKY_PROJECTIONS = ['equidistant', 'stereographic', 'equisolid'];
const ALLSKY_SIDEREAL_DEG_PER_MIN = 15.0411 / 60;
const _ALLSKY_D2R = Math.PI / 180;

function _allskyR(projection, f, thetaRad) {
  if (projection === 'equidistant') return f * thetaRad;
  if (projection === 'stereographic') return 2 * f * Math.tan(thetaRad / 2);
  if (projection === 'equisolid') return 2 * f * Math.sin(thetaRad / 2);
  return NaN;
}

// Inverse of _allskyR; null when r is outside the projection's range (beyond the nadir) or f <= 0.
function _allskyTheta(projection, f, r) {
  if (!(f > 0) || !(r >= 0)) return null;
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

// Apparent sky position -> photo pixel, ignoring the per-frame time shift.
function _allskyForward(cal, azDeg, elDeg) {
  return _allskyFwdRaw(cal.projection, cal.east, cal.zenith_px[0], cal.zenith_px[1], cal.f_px, cal.north_deg, azDeg, elDeg);
}

// Photo pixel -> apparent { az, el } (az in [0, 360)); null outside the projection's range.
function _allskyInverse(cal, x, y) {
  const dx = x - cal.zenith_px[0], dy = y - cal.zenith_px[1];
  const theta = _allskyTheta(cal.projection, cal.f_px, Math.hypot(dx, dy));
  if (theta === null) return null;
  const psi = Math.atan2(dx, -dy) / _ALLSKY_D2R;
  const az = cal.east === 'right' ? psi - cal.north_deg : cal.north_deg - psi;
  return { az: ((az % 360) + 360) % 360, el: 90 - theta / _ALLSKY_D2R };
}

// Unit vector of a TRUE altitude/azimuth in the horizontal frame (x east, y north, z zenith).
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
// circle_px or outside the projection.
function _allskySkyToPhoto(cal, azDeg, elDeg, latDeg) {
  let p = _allskyForward(cal, azDeg, elDeg);
  if ((cal.pins || []).length && cal.span_min > 0) {
    const v = _allskyTrueVec(azDeg, _skyTrueFromApparentEl(elDeg));
    for (let i = 0; i < 2; i++) {
      const dt = _allskyDtAt(cal, p[0], p[1]);
      const q = _allskyRotVec(v, latDeg, dt);
      p = _allskyForward(cal, q.az, q.el);
    }
  }
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  const c = cal.circle_px;
  if (c && Math.hypot(p[0] - c[0], p[1] - c[1]) > c[2]) return null;
  return p;
}

// The same calibration for the image resized to w x h (aspect ratio kept, so the x scale also
// scales f_px, the circle radius and rms_px).
function _allskyScaled(cal, w, h) {
  const sx = w / cal.image_size[0], sy = h / cal.image_size[1];
  const out = Object.assign({}, cal, {
    image_size: [w, h],
    zenith_px: [cal.zenith_px[0] * sx, cal.zenith_px[1] * sy],
    f_px: cal.f_px * sx,
  });
  if (cal.circle_px) out.circle_px = [cal.circle_px[0] * sx, cal.circle_px[1] * sy, cal.circle_px[2] * sx];
  if (Number.isFinite(cal.rms_px)) out.rms_px = cal.rms_px * sx;
  if (cal.pins) out.pins = cal.pins.map(p => Object.assign({}, p, { px: [p.px[0] * sx, p.px[1] * sy] }));
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

// Levenberg-Marquardt over p = [zx, zy, f, north, dt_1..dt_m] for one projection and east value.
// pv: true unit vectors of the pins at time_utc; dt (m = pins when dtMax > 0) is clamped to
// +-dtMax. Returns { p, cost } (cost = sum of squared pixel residuals).
function _allskyLM(projection, east, pins, pv, latDeg, dtMax, p0) {
  const n = pins.length, useDt = dtMax > 0, np = p0.length;
  const rot = (i, dt) => useDt ? _allskyRotVec(pv[i], latDeg, dt) : pins[i];
  const resid = (p, pos) => {
    const r = new Array(2 * n);
    for (let i = 0; i < n; i++) {
      const xy = _allskyFwdRaw(projection, east, p[0], p[1], p[2], p[3], pos[i].az, pos[i].el);
      r[2 * i] = xy[0] - pins[i].px[0]; r[2 * i + 1] = xy[1] - pins[i].px[1];
    }
    return r;
  };
  const costOf = r => { let c = 0; for (const v of r) c += v * v; return Number.isFinite(c) ? c : Infinity; };
  const positions = p => pins.map((_, i) => rot(i, useDt ? p[4 + i] : 0));
  let p = p0.slice(), pos = positions(p), r = resid(p, pos), cost = costOf(r), lambda = 1e-3;
  const H = [1e-3, 1e-3, 1e-3, 1e-5];
  let done = false;
  for (let it = 0; it < 200 && !done && cost > 1e-20; it++) {
    // Jacobian (central differences): 4 shared columns over all rows, and per pin one dt column
    // that only touches its own two rows (jd[i] = [dx/ddt, dy/ddt]).
    const J = [];
    for (let j = 0; j < 4; j++) {
      const a = p.slice(), b = p.slice(); a[j] += H[j]; b[j] -= H[j];
      const ra = resid(a, pos), rb = resid(b, pos);
      J.push(ra.map((v, k) => (v - rb[k]) / (2 * H[j])));
    }
    const jd = [];
    for (let i = 0; i < np - 4; i++) {
      const h = 1e-3, qa = rot(i, p[4 + i] + h), qb = rot(i, p[4 + i] - h);
      const xa = _allskyFwdRaw(projection, east, p[0], p[1], p[2], p[3], qa.az, qa.el);
      const xb = _allskyFwdRaw(projection, east, p[0], p[1], p[2], p[3], qb.az, qb.el);
      jd.push([(xa[0] - xb[0]) / (2 * h), (xa[1] - xb[1]) / (2 * h)]);
    }
    // Normal equations in blocks: U (shared x shared), W[i] (shared x dt_i), V[i] (dt_i x dt_i,
    // a scalar), gradients gA and gD. The dt block is diagonal, so the shared step comes from the
    // 4 x 4 Schur complement and each dt step from its own pin: linear in the pin count instead of
    // cubic in all unknowns, with the same result as solving the full system.
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
        for (let a = 0; a < 4; a++) {
          rhs[a] -= w[a] * gD[i] * inv;
          for (let b = 0; b < 4; b++) S[a][b] -= w[a] * w[b] * inv;
        }
      }
      const dA = _allskySolve(S, rhs, 0);
      if (!dA) return null;
      const d = dA.concat(V.map((_, i) => (gD[i] - (W[i][0] * dA[0] + W[i][1] * dA[1] + W[i][2] * dA[2] + W[i][3] * dA[3])) / Vd[i]));
      return d.every(Number.isFinite) ? d : null;
    };
    let accepted = false;
    while (lambda < 1e12) {
      const d = step(lambda);
      if (d) {
        const q = p.map((v, k) => v + d[k]);
        for (let k = 4; k < np; k++) q[k] = Math.max(-dtMax, Math.min(dtMax, q[k]));
        if (q[2] > 0) {
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

function _allskyFitFail(reason) {
  return { ok: false, reason, cal: null, byProjection: {}, perPin: [] };
}

// Least-squares calibration from star pins. pins: [{ hip, px: [x, y], az, el }] with the APPARENT
// position at time_utc; opts: { latDeg, spanMin, circle: [cx, cy, r], imageSize: [w, h] }.
// Unknowns: zenith_px (2), f_px, north_deg, east (discrete) and, when spanMin > 0, one dt_min per pin
// (within +-spanMin/2). Every projection is fitted from 8 north starts x both east values; the
// smallest rms_px wins. On bad input returns ok: false with a reason and cal: null.
function _allskyFit(pins, opts) {
  opts = opts || {};
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
      image_size: size ? [size[0], size[1]] : [circle[0] * 2, circle[1] * 2],
      zenith_px: [p[0], p[1]], projection, f_px: p[2], north_deg: ((p[3] % 360) + 360) % 360, east,
      circle_px: circle.slice(), alt_edge: 0, span_min: span, rms_px: Math.sqrt(cost / pins.length),
      pins: pins.map((pin, i) => ({ hip: pin.hip, px: [pin.px[0], pin.px[1]], dt_min: dtCount ? p[4 + i] : 0 })),
    };
    cal.alt_edge = _allskyEdgeMinAlt(cal);
    return cal;
  };

  const byProjection = {};
  let best = null;
  for (const projection of ALLSKY_PROJECTIONS) {
    const f0 = circle[2] / _allskyR(projection, 1, Math.PI / 2);
    let pb = null;
    for (const east of ['left', 'right']) for (let k = 0; k < 8; k++) {
      const p0 = [circle[0], circle[1], f0, k * 45].concat(new Array(dtCount).fill(0));
      const res = _allskyLM(projection, east, pins, pv, latDeg, dtMax, p0);
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
