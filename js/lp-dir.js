// ─── Directional sky glow of light pollution (Night Sky with Atmosphere) ──────────────────────
// The light pollution map (lp-lookup.js) gives the night sky's zenith brightness; this file spreads
// that artificial light over the sky by where the towns round the observer are. Spec:
// specs/2026-11-06-directional-skyglow-design.md (outside the version folders).
//
// T(d, h, Δaz): the sky brightness from a town of unit light at distance d (km), seen at altitude h
// above the horizon and Δaz to the side of the town's direction, by a simplified single-scattering
// model after Garstang (1986, PASP 98, 364; 1989, PASP 101, 306), one atmosphere for the whole world:
//  - the light leaves the town upward as Garstang's emission, I(ψ) = 2(1 − F) cos ψ + 0.554 F ψ⁴
//    (ψ from the vertical, rad; F the share sent out almost horizontally);
//  - it is scattered once by the air (Rayleigh, scale height 8 km, vertical optical depth
//    _lpDir.p.tauM) and by haze (scale height 1.5 km, _lpDir.p.tauA, Henyey-Greenstein g = 0.7), and
//    dimmed on its way up (straight path from the town: the vertical optical depth to the point's
//    height × ρ / z) and on its way down to the observer (along the line of sight);
//  - the line of sight is followed from the observer to 30 km of height or 200 km, its height with
//    the Earth's curve.
// Built once (_lpDirScatter), the per-ray quantities that do not depend on the town (heights,
// densities, the extinction toward the observer) first, then the towns' distances and offsets.
const LP_DIR_D_KM = (() => { const a = new Float64Array(30); for (let i = 0; i < 30; i++) a[i] = 0.5 * Math.pow(300, i / 29); return a; })();   // 0.5 to 150 km
const LP_DIR_H_STEP = 2, LP_DIR_DAZ_STEP = 5, LP_DIR_NH = 46, LP_DIR_NDAZ = 37, LP_DIR_RMAX_KM = 150;
const LP_DIR_HM = 8, LP_DIR_HA = 1.5, LP_DIR_G = 0.7;
const LP_DIR_ZMAX = 30, LP_DIR_SMAX = 200, LP_DIR_S0 = 0.02, LP_DIR_STEPS = 200, LP_DIR_RHO_MIN = 0.5, LP_DIR_RE = 6371;
const _lpDir = { T: null, p: { F: 0.15, tauM: 0.1, tauA: 0.11 } };   // p: F and the vertical optical depths (V)

function _lpDirScatter() {
  if (_lpDir.T) return _lpDir.T;
  const ND = LP_DIR_D_KM.length, v = new Float64Array(ND * LP_DIR_NH * LP_DIR_NDAZ);
  const P = _lpDir.p, km = P.tauM / LP_DIR_HM, ka = P.tauA / LP_DIR_HA, g = LP_DIR_G, F = P.F;
  const pm0 = 3 / (16 * Math.PI), pa0 = (1 - g * g) / (4 * Math.PI);
  const cosDaz = new Float64Array(LP_DIR_NDAZ);
  for (let j = 0; j < LP_DIR_NDAZ; j++) cosDaz[j] = Math.cos(j * LP_DIR_DAZ_STEP * Math.PI / 180);
  const ratio = Math.pow(LP_DIR_SMAX / LP_DIR_S0, 1 / LP_DIR_STEPS);
  const S = new Float64Array(LP_DIR_STEPS), Z = new Float64Array(LP_DIR_STEPS), DS = new Float64Array(LP_DIR_STEPS);
  const KM = new Float64Array(LP_DIR_STEPS), KA = new Float64Array(LP_DIR_STEPS), TV = new Float64Array(LP_DIR_STEPS), EO = new Float64Array(LP_DIR_STEPS);
  const B2 = new Float64Array(LP_DIR_STEPS), A1 = new Float64Array(LP_DIR_STEPS), WM = new Float64Array(LP_DIR_STEPS), WA = new Float64Array(LP_DIR_STEPS);
  for (let ih = 0; ih < LP_DIR_NH; ih++) {
    const h = ih * LP_DIR_H_STEP * Math.PI / 180, ch = Math.cos(h), sh = Math.sin(h);
    // the line of sight's points (midpoints of log steps), their air and the extinction to the observer
    let n = 0, tauObs = 0, s0 = LP_DIR_S0;
    for (let k = 0; k < LP_DIR_STEPS; k++) {
      const s1 = s0 * ratio, s = (s0 + s1) / 2, z = s * sh + s * s / (2 * LP_DIR_RE);
      if (z > LP_DIR_ZMAX) break;
      const ds = s1 - s0, em = Math.exp(-z / LP_DIR_HM), ea = Math.exp(-z / LP_DIR_HA);
      S[n] = s; Z[n] = z; DS[n] = ds; KM[n] = km * em; KA[n] = ka * ea;
      TV[n] = z > 1e-6 ? (P.tauM * (1 - em) + P.tauA * (1 - ea)) / z : km + ka;   // vertical optical depth per km of height
      EO[n] = Math.exp(-(tauObs + (KM[n] + KA[n]) * ds / 2));
      tauObs += (KM[n] + KA[n]) * ds; n++; s0 = s1;
    }
    // per point, what does not depend on the town: s²cos²h + z² and s·cos²h + z·sin h
    for (let k = 0; k < n; k++) {
      const s = S[k]; B2[k] = s * s * ch * ch + Z[k] * Z[k]; A1[k] = s * ch * ch + Z[k] * sh;
      WM[k] = KM[k] * pm0 * EO[k] * DS[k]; WA[k] = KA[k] * pa0 * EO[k] * DS[k];   // the air's share, dimmed toward the observer, per step
    }
    for (let id = 0; id < ND; id++) {
      const d = LP_DIR_D_KM[id];
      for (let j = 0; j < LP_DIR_NDAZ; j++) {
        const ux = ch * cosDaz[j], dux = d * ux, dd = d * d;
        let b = 0;
        for (let k = 0; k < n; k++) {
          // the point P = s·u from the town (d, 0, 0): ρ² = |P|² − 2 s d ux + d²
          const rho = Math.max(LP_DIR_RHO_MIN, Math.sqrt(Math.max(0, B2[k] - 2 * S[k] * dux + dd)));
          const tau = TV[k] * rho;
          if (tau > 40) continue;   // nothing left of it
          const cpsi = Math.min(1, Z[k] / rho);
          // acos by Abramowitz & Stegun 4.4.45 (error under 7e-5 rad), for the near-horizontal emission
          const psi = Math.sqrt(1 - cpsi) * (1.5707288 + cpsi * (-0.2121144 + cpsi * (0.0742610 - 0.0187293 * cpsi)));
          const p2 = psi * psi, I = 2 * (1 - F) * cpsi + 0.554 * F * p2 * p2;
          // scattering angle: from the town to the point, then back toward the observer (−u)
          const ct = (dux - A1[k]) / rho, hg = 1 + g * g - 2 * g * ct;
          b += (WM[k] * (1 + ct * ct) + WA[k] / (hg * Math.sqrt(hg))) * I / (rho * rho) * Math.exp(-tau);
        }
        v[(id * LP_DIR_NH + ih) * LP_DIR_NDAZ + j] = b;
      }
    }
  }
  return (_lpDir.T = { v });
}
// T at the distance node i_d, altitude h (°) and offset daz (°, either side), linearly between nodes
function _lpDirT(id, h, daz) {
  const T = _lpDirScatter().v;
  let a = Math.abs(daz) % 360; if (a > 180) a = 360 - a;
  const x = Math.max(0, Math.min(90, h)) / LP_DIR_H_STEP, y = a / LP_DIR_DAZ_STEP;
  const i = Math.min(LP_DIR_NH - 2, Math.floor(x)), j = Math.min(LP_DIR_NDAZ - 2, Math.floor(y)), fx = x - i, fy = y - j;
  const o = id * LP_DIR_NH * LP_DIR_NDAZ, q = (ii, jj) => T[o + ii * LP_DIR_NDAZ + jj];
  return (q(i, j) * (1 - fy) + q(i, j + 1) * fy) * (1 - fx) + (q(i + 1, j) * (1 - fy) + q(i + 1, j + 1) * fy) * fx;
}
// T at any distance d (km), log-linearly between the distance nodes (0 past the last)
function _lpDirTAt(d, h, daz) {
  const D = LP_DIR_D_KM, n = D.length;
  if (d > D[n - 1]) return 0;
  const x = Math.log(Math.max(d, D[0]) / D[0]) / Math.log(D[1] / D[0]), i = Math.min(n - 2, Math.floor(x)), f = x - i;
  const a = _lpDirT(i, h, daz), b = _lpDirT(i + 1, h, daz);
  return a > 0 && b > 0 ? Math.exp(Math.log(a) * (1 - f) + Math.log(b) * f) : a * (1 - f) + b * f;
}

// ── The site's table D(az, h) ───────────────────────────────────────────────────────────────────
// The towns within LP_DIR_RMAX_KM, from the emitted light's tiles (lp-src-<lat>-<lon>.js from
// tools/lp-grid.py, listed in the light pollution index under src), summed into 30 rings (the
// distance nodes of T, the nearest on a log scale; under 0.5 km as 0.5 km; a cell nearer than
// LP_DIR_SUB_KM spread over its area as LP_DIR_SUB² points) × 36 sectors of 10°
// centred on 0°, 10°, ... (so a town due south is symmetric about 180°), by distance and azimuth
// along the great circle. D(az, h) = Σ W(ring, sector) · T(ring, h, az − sector) over the zenith's
// value, for az every 5° (72) and h every 2° (46); the offsets are whole multiples of 5°, so T is
// read without interpolation. A site waits for all its tiles (or their failure) before it gets a
// table; no light within reach: no table (null), and the sky keeps the even factor.
const LP_DIR_NAZ = 72, LP_DIR_NSEC = 36, LP_DIR_SUB_KM = 12, LP_DIR_SUB = 5;   // cells nearer than 12 km as 5 × 5 points
Object.assign(_lpDir, { src: {}, site: null, ver: 0, off: false });   // off: a test switch, no table
function _lpDirSrcFile(key) { return 'lp-src-' + key.slice(0, 3) + '-' + key.slice(3) + '.js'; }
function _lpDirLoadTile(key) {
  if (_lpDir.src[key]) return Promise.resolve(_lpDir.src[key]);
  return _lpLoad(_lpDirSrcFile(key)).then((ok) => {
    const t = ok && window.LP_SRC_TILES && window.LP_SRC_TILES[key];
    if (t && !_lpDir.src[key]) _lpDir.src[key] = { lat0: t.lat0, lon0: t.lon0, n: t.n, step: t.step, top: t.top, dex: t.dex, v: _lpDecode(t.rle, t.n * t.n) };
    if (window.LP_SRC_TILES) delete window.LP_SRC_TILES[key];   // the decoded grid is kept, its source let go
    if (!_lpDir.src[key]) _lp.failed[_lpDirSrcFile(key)] = true;   // a file without its tile counts as failed
    return _lpDir.src[key] || null;
  });
}
// Bins (Float64Array, ring × 36 + sector) of the light round (lat, lon), or null while a tile it
// needs is still coming in (its loading started; _lpOnLoad redraws when it is in)
function _lpDirBins(lat, lon) {
  const idx = _lp.index && _lp.index.src;
  if (!idx) return null;
  const dLat = LP_DIR_RMAX_KM / 111.2, dLon = dLat / Math.max(0.05, Math.cos(lat * Math.PI / 180));
  const keys = [];
  for (let la = Math.floor((lat - dLat) / 10) * 10; la <= lat + dLat; la += 10)
    for (let lo = Math.floor((lon - dLon) / 10) * 10; lo <= lon + dLon; lo += 10) {
      const key = _lpTileKey(la, ((lo + 180) % 360 + 360) % 360 - 180);
      if (idx.tiles.indexOf(key) >= 0 && keys.indexOf(key) < 0) keys.push(key);
    }
  let waiting = false;
  for (const key of keys) {
    if (_lpDir.src[key] || _lp.failed[_lpDirSrcFile(key)]) continue;
    waiting = true;
    if (!_lp.loading[_lpDirSrcFile(key)]) _lpDirLoadTile(key).then((t) => { if (t && typeof _lpOnLoad === 'function') _lpOnLoad(); });
  }
  if (waiting) return null;
  const R = 6371, rad = Math.PI / 180, f1 = lat * rad, s1 = Math.sin(f1), c1 = Math.cos(f1);
  const lnD0 = Math.log(LP_DIR_D_KM[0]), lnStep = Math.log(LP_DIR_D_KM[1] / LP_DIR_D_KM[0]), ND = LP_DIR_D_KM.length;
  const bins = new Float64Array(ND * LP_DIR_NSEC);
  for (const key of keys) {
    const t = _lpDir.src[key];
    if (!t) continue;
    const top = t.lat0 + t.n * t.step;
    const r0 = Math.max(0, Math.floor((top - (lat + dLat)) / t.step)), r1 = Math.min(t.n, Math.ceil((top - (lat - dLat)) / t.step));
    for (let r = r0; r < r1; r++) {
      const la = top - (r + 0.5) * t.step, f2 = la * rad, s2 = Math.sin(f2), c2 = Math.cos(f2);
      for (let c = 0; c < t.n; c++) {
        const q = t.v[r * t.n + c];
        if (q === 0 || q === 255) continue;
        let dl = t.lon0 + (c + 0.5) * t.step - lon;
        dl = ((dl + 540) % 360) - 180;
        if (Math.abs(dl) > dLon) continue;
        const cdl = Math.cos(dl * rad), cosd = Math.min(1, s1 * s2 + c1 * c2 * cdl), d = R * Math.acos(cosd);
        if (d > LP_DIR_RMAX_KM + 5) continue;
        const w = Math.pow(10, t.top + (q - 254) * t.dex);
        // a near cell (a town round the observer) spread over its area as LP_DIR_SUB² points, so the
        // low sky does not hang on where the nearest cell's centre falls; farther ones as one point
        const n = d < LP_DIR_SUB_KM ? LP_DIR_SUB : 1;
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
          const la2 = la + ((a + 0.5) / n - 0.5) * t.step, dl2 = dl + ((b + 0.5) / n - 0.5) * t.step;
          const f3 = la2 * rad, s3 = Math.sin(f3), c3 = Math.cos(f3), cd2 = Math.cos(dl2 * rad);
          const dd = R * Math.acos(Math.min(1, s1 * s3 + c1 * c3 * cd2));
          if (dd > LP_DIR_RMAX_KM) continue;
          const az = (Math.atan2(Math.sin(dl2 * rad) * c3, c1 * s3 - s1 * c3 * cd2) / rad + 360) % 360;
          const ring = Math.max(0, Math.min(ND - 1, Math.round((Math.log(Math.max(dd, LP_DIR_D_KM[0])) - lnD0) / lnStep)));
          bins[ring * LP_DIR_NSEC + Math.round(az / 10) % LP_DIR_NSEC] += w / (n * n);
        }
      }
    }
  }
  return bins;
}
// D (Float32Array, az × 46 + h) from bins, or null when the zenith gets no light
function _lpDirBuild(bins) {
  const T = _lpDirScatter().v, ND = LP_DIR_D_KM.length, out = new Float32Array(LP_DIR_NAZ * LP_DIR_NH), acc = new Float64Array(LP_DIR_NAZ * LP_DIR_NH);
  for (let ring = 0; ring < ND; ring++)
    for (let sec = 0; sec < LP_DIR_NSEC; sec++) {
      const w = bins[ring * LP_DIR_NSEC + sec];
      if (!w) continue;
      for (let ia = 0; ia < LP_DIR_NAZ; ia++) {
        let j = Math.abs(ia - 2 * sec) % LP_DIR_NAZ; if (j > 36) j = LP_DIR_NAZ - j;   // the offset, in steps of 5°
        const o = ring * LP_DIR_NH * LP_DIR_NDAZ + j, a = ia * LP_DIR_NH;
        for (let ih = 0; ih < LP_DIR_NH; ih++) acc[a + ih] += w * T[o + ih * LP_DIR_NDAZ];
      }
    }
  let zen = 0; for (let ia = 0; ia < LP_DIR_NAZ; ia++) zen += acc[ia * LP_DIR_NH + LP_DIR_NH - 1];
  zen /= LP_DIR_NAZ;
  if (!(zen > 0)) return null;
  for (let i = 0; i < out.length; i++) out[i] = acc[i] / zen;
  for (let ia = 0; ia < LP_DIR_NAZ; ia++) out[ia * LP_DIR_NH + LP_DIR_NH - 1] = 1;   // the zenith is one point
  return out;
}
function _lpDirSiteKey() { return [LAT, hemisphere, LONG, lonHemisphere].join('|'); }
// The table of the Location, kept until the Location changes; null without one (yet)
function _lpDirSite() {
  if (_lpDir.off) return null;
  const S = _lpDir.site;   // the same Location: compared by its numbers (called per direction in the sky's colour)
  if (S && S.LAT === LAT && S.LONG === LONG && S.h === hemisphere && S.lh === lonHemisphere) return S.D;
  const bins = _lpDirBins(hemisphere * LAT, lonHemisphere * LONG);
  if (!bins) return null;   // its tiles coming in (or no source data at all)
  _lpDir.site = { key: _lpDirSiteKey(), LAT, LONG, h: hemisphere, lh: lonHemisphere, D: _lpDirBuild(bins) };
  _lpDir.ver++;
  return _lpDir.site.D;
}
// The artificial light in direction (az, el) over the zenith's, bilinear in the table; null without one
function _lpDirFactor(az, el) {
  const D = _lpDirSite();
  if (!D) return null;
  const x = ((az % 360) + 360) % 360 / 5, y = Math.max(0, Math.min(90, el)) / LP_DIR_H_STEP;
  const i = Math.floor(x) % LP_DIR_NAZ, i2 = (i + 1) % LP_DIR_NAZ, fx = x - Math.floor(x);
  const j = Math.min(LP_DIR_NH - 2, Math.floor(y)), fy = y - j;
  return (D[i * LP_DIR_NH + j] * (1 - fx) + D[i2 * LP_DIR_NH + j] * fx) * (1 - fy)
    + (D[i * LP_DIR_NH + j + 1] * (1 - fx) + D[i2 * LP_DIR_NH + j + 1] * fx) * fy;
}
// The site's factor on the limit table's grid (az every 5°, 72; el every 0.5°, 182), kept with the
// site's table: the sky's state changes with every moment (Play), the towns do not
function _lpDirGrid() {
  const D = _lpDirSite();
  if (!D) return null;
  if (_lpDir.grid && _lpDir.grid.ver === _lpDir.ver) return _lpDir.grid.g;
  const g = new Float32Array(72 * 182);
  for (let a = 0; a < 72; a++) for (let i = 0; i < 182; i++) g[a * 182 + i] = _lpDirFactor(a * 5, Math.min(90, i * 0.5));
  _lpDir.grid = { ver: _lpDir.ver, g };
  return g;
}
