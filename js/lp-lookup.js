// ─── Light pollution grid (data/lightpollution/, from tools/lp-grid.py) ─────────────────────────
// The night sky's zenith brightness round the Earth from 65°S to 75°N (as far as VIIRS reaches)
// from VIIRS nighttime lights (EOG VNL v2.2, CC BY 4.0), light spread by the air and calibrated
// against measured sky brightness: tiles of 10° at 1/40° (lp-<lat>-<lon>.js, window.LP_TILES), a
// coarse grid at 0.1° for the globe (named by the index, lp-coarse.js, window.LP_COARSE) and the
// index (lp-index.js, window.LP_INDEX). A cell is a byte v -> 16.0 +
// 0.05 v mag/arcsec², 255 no data, stored as run-length pairs (length, value) by rows from the
// north, west to east, in base64. Each file comes in once, by a <script> as the time zones' grid
// (tz-lookup.js), so the app works from file:// too; a file that fails is not asked for again.
// _lpSQMAt is the brightness at a point, null off the data or while its tile is coming in (then
// _lpOnLoad redraws, render-nightsky.js).
const LP_DIR = 'data/lightpollution/';
const LP_Q_MIN = 16.0, LP_Q_STEP = 0.05, LP_NODATA = 255;
const _lp = { index: null, coarse: null, tiles: {}, loading: {}, failed: {} };

function _lpLoad(file) {
  if (_lp.failed[file]) return Promise.resolve(null);
  if (!_lp.loading[file]) {
    _lp.loading[file] = new Promise((resolve) => {
      const sc = document.createElement('script');
      const own = document.querySelector('script[src*="lp-lookup.js"]');
      sc.src = LP_DIR + file + (own && own.src.indexOf('?') >= 0 ? own.src.slice(own.src.indexOf('?')) : '');
      sc.onload = () => resolve(true);
      sc.onerror = () => { _lp.failed[file] = true; resolve(null); };
      document.head.appendChild(sc);
    });
  }
  return _lp.loading[file];
}
function _lpDecode(rle, size) {
  const bin = atob(rle), out = new Uint8Array(size);
  let k = 0;
  for (let i = 0; i + 1 < bin.length; i += 2) {
    const n = bin.charCodeAt(i), v = bin.charCodeAt(i + 1);
    out.fill(v, k, Math.min(size, k + n));
    k += n;
  }
  return out;
}
function _lpLoadIndex() {
  if (_lp.index) return Promise.resolve(_lp.index);
  return _lpLoad('lp-index.js').then((ok) => (_lp.index = ok && window.LP_INDEX ? window.LP_INDEX : null));
}
function _lpLoadCoarse() {
  if (_lp.coarse) return Promise.resolve(_lp.coarse);
  return _lpLoadIndex().then((i) => _lpLoad(i && i.coarse ? i.coarse : 'lp-coarse.js')).then((ok) => {
    const g = ok && window.LP_COARSE;   // decoded once, then its source let go
    if (g && !_lp.coarse) _lp.coarse = { lat0: g.lat0, lon0: g.lon0, nx: g.nx, ny: g.ny, step: g.step, v: _lpDecode(g.rle, g.nx * g.ny) };
    window.LP_COARSE = null;
    return _lp.coarse;
  });
}
// A tile's key from its south-west corner (as tools/lp-grid.py tile_key)
function _lpTileKey(lat, lon) {
  const la = Math.floor(lat / 10) * 10, lo = Math.floor(lon / 10) * 10;
  return (la >= 0 ? 'n' : 's') + String(Math.abs(la)).padStart(2, '0') + (lo >= 0 ? 'e' : 'w') + String(Math.abs(lo)).padStart(3, '0');
}
function _lpTileFile(key) {
  return 'lp-' + key.slice(0, 3) + '-' + key.slice(3) + '.js';
}
function _lpLoadTile(key) {
  if (_lp.tiles[key]) return Promise.resolve(_lp.tiles[key]);
  return _lpLoad(_lpTileFile(key)).then((ok) => {
    const t = ok && window.LP_TILES && window.LP_TILES[key];
    if (t && !_lp.tiles[key]) _lp.tiles[key] = { lat0: t.lat0, lon0: t.lon0, nx: t.n, ny: t.n, step: t.step, v: _lpDecode(t.rle, t.n * t.n) };
    if (window.LP_TILES) delete window.LP_TILES[key];   // the decoded grid is kept, its source let go
    return _lp.tiles[key] || null;
  });
}
// The brightness (mag/arcsec²) of the cell a point falls in; its edges count as inside
function _lpValueAt(g, lat, lon) {
  if (!g) return null;
  const top = g.lat0 + g.ny * g.step, right = g.lon0 + g.nx * g.step;
  if (lat < g.lat0 || lat > top || lon < g.lon0 || lon > right) return null;
  const r = Math.min(g.ny - 1, Math.floor((top - lat) / g.step)), c = Math.min(g.nx - 1, Math.floor((lon - g.lon0) / g.step));
  const v = g.v[r * g.nx + c];
  return v === LP_NODATA ? null : LP_Q_MIN + v * LP_Q_STEP;
}
// The brightness between the four nearest cell centres (bilinear). At a tile's edge the cells
// beyond it come from the neighbouring tile if it is in memory (tiles share one 1/40° grid), so the
// blend runs on across the edge without a seam; a cell with no data, or beyond the grid with no tile
// there, gives the nearest cell's value (_lpValueAt). For the globe's smooth close view (render-locpick.js).
function _lpCellAcross(g, r, c) {   // the stored value of g's cell (r, c), r and c possibly outside g
  if (r >= 0 && c >= 0 && r < g.ny && c < g.nx) return g.v[r * g.nx + c];
  if (g === _lp.coarse) return LP_NODATA;
  const lat = g.lat0 + (g.ny - r - 0.5) * g.step, lon = ((g.lon0 + (c + 0.5) * g.step + 540) % 360) - 180;
  const t = _lp.tiles[_lpTileKey(lat, lon)];
  if (!t) return LP_NODATA;
  const rr = Math.floor((t.lat0 + t.ny * t.step - lat) / t.step), cc = Math.floor((lon - t.lon0) / t.step);
  return rr >= 0 && cc >= 0 && rr < t.ny && cc < t.nx ? t.v[rr * t.nx + cc] : LP_NODATA;
}
function _lpValueSmooth(g, lat, lon) {
  if (!g) return null;
  const top = g.lat0 + g.ny * g.step;
  const fy = (top - lat) / g.step - 0.5, fx = (lon - g.lon0) / g.step - 0.5;
  const r = Math.floor(fy), c = Math.floor(fx);
  let a, b, d, e;
  if (r >= 0 && c >= 0 && r + 1 < g.ny && c + 1 < g.nx) {
    a = g.v[r * g.nx + c]; b = g.v[r * g.nx + c + 1]; d = g.v[(r + 1) * g.nx + c]; e = g.v[(r + 1) * g.nx + c + 1];
  } else {
    a = _lpCellAcross(g, r, c); b = _lpCellAcross(g, r, c + 1); d = _lpCellAcross(g, r + 1, c); e = _lpCellAcross(g, r + 1, c + 1);
  }
  if (a === LP_NODATA || b === LP_NODATA || d === LP_NODATA || e === LP_NODATA) return _lpValueAt(g, lat, lon);
  const ty = fy - r, tx = fx - c;
  return LP_Q_MIN + LP_Q_STEP * ((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
}
function _lpSQMAt(lat, lon) {
  if (!_lp.index || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = _lpTileKey(lat, lon), t = _lp.tiles[key];
  if (t) return _lpValueAt(t, lat, lon);
  const file = _lpTileFile(key);   // asked for once: one redraw when it comes in, however often looked up meanwhile
  if (_lp.index.tiles.indexOf(key) >= 0 && !_lp.failed[file] && !_lp.loading[file])
    _lpLoadTile(key).then((g) => { if (g && typeof _lpOnLoad === 'function') _lpOnLoad(); });
  return null;
}
// A tile or the index came in: the sky's light pollution and the Bortle scale row follow, the
// globe redraws (render-nightsky.js, render-locpick.js)
function _lpOnLoad() {
  if (typeof _nsAtmCache !== 'undefined') _nsAtmCache.key = null;
  if (typeof _nightSkyBortleSyncUI === 'function') _nightSkyBortleSyncUI();
  if (typeof nightSkyActive !== 'undefined' && nightSkyActive) drawNightSky();
  if (typeof _locPick !== 'undefined' && _locPick.open && typeof _locPickRequest === 'function') _locPickRequest();
}
_lpLoadIndex().then((i) => { if (i) _lpOnLoad(); });
