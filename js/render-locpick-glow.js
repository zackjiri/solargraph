// ─── The towns' glow in the globe window (SELECT) ─────────────────────────────────────────────
// A box top left under the header, seen as the window opens (with or without Atmosphere and its
// switch Glow toward towns), folded by the arrow under it (remembered): for the Location (the pin),
// left a map of the towns within LP_DIR_RMAX_KM (lp-dir.js _lpDirCells), each 1/20° cell coloured
// either by its share of the glow at the altitude chosen (Share: its light × the scattering toward
// it, over the strongest's, on a log scale of LOC_GLOW_DEX decades) or by its own light on the
// absolute scale (Light: log10 of radiance × km² from LOC_GLOW_ABS0, country 0, villages 1, town 2,
// city 3 as measured round Brno: the median cell 1.0, a town 1.7 to 1.9, city centres 2.8 to 3.0);
// right, in Share, the direction rose: the sky's glow at that altitude by azimuth on the sky's fixed
// scale (22 mag/arcsec² at the centre to 16 at the edge), on bands of the Bortle classes' skies in
// the scale's colours, so a dark place's rose stays small and a city's fills the frame; in Light the
// whole sky from above in the scale's colours (_locGlowDome). The altitude (2, 4, 10, 30°) and the
// mode are switches in the box (remembered); under the map its scale (the share's or the light's),
// and under it the sky's own glow at that altitude here: the night sky (22.0) plus the map's
// artificial light at the zenith × D, in mag/arcsec², on a scale blue to red from 22 to 16 with the
// Bortle classes' skies (pristine 1-2, rural 3-4, suburban 5, town 6-7, city 8-9; the ticks from
// rural on) and a bar from the darkest direction to the brightest. Only while the light pollution
// is shown (_locPick.lp); not in the Eclipse map. Redrawn with the window (_locPickDraw) when the Location, the table, its tiles
// or a switch change.
const LOC_GLOW_DEX = 4.5, LOC_GLOW_W = 150, LOC_GLOW_ABS0 = -1;   // the colour range (decades), each half's size (px), the light scale's start
const LOC_GLOW_HS = [2, 4, 10, 30];
const LOC_GLOW_RAMP = ['#3a2a0e', '#633806', '#854f0b', '#ba7517', '#ef9f27', '#fac775', '#fff1d6'];
const LOC_GLOW_KEY = 'locGlowCollapsed';
const _locGlow = { key: null, state: null, cells: null, cellsH: null, rose: null, ringLabels: null, collapsed: false, h: 4, mode: 'share' };
try {
  _locGlow.collapsed = localStorage.getItem(LOC_GLOW_KEY) === '1';
  const h = Number(localStorage.getItem('locGlowAlt')); if (LOC_GLOW_HS.indexOf(h) >= 0) _locGlow.h = h;
  if (localStorage.getItem('locGlowMode') === 'light') _locGlow.mode = 'light';
} catch (e) { /* blocked: the defaults */ }
// The colour position 0..1 of a cell (above 0 drawn): by its share or by its own light
function _locGlowT(c) {
  return _locGlow.mode === 'light' ? (Math.log10(Math.max(1e-12, c.light)) - LOC_GLOW_ABS0) / LOC_GLOW_DEX
    : 1 + Math.log10(Math.max(1e-12, c.share)) / LOC_GLOW_DEX;
}
function _locGlowSetH(h) {
  _locGlow.h = h; try { localStorage.setItem('locGlowAlt', String(h)); } catch (e) { /* blocked */ }
  _locGlowSyncCtl(); _locGlow.key = null; if (_locPick.open) _locPickRequest();
}
function _locGlowSetMode(m) {
  _locGlow.mode = m; try { localStorage.setItem('locGlowMode', m); } catch (e) { /* blocked */ }
  _locGlowSyncCtl(); _locGlow.key = null; if (_locPick.open) _locPickRequest();
}
// The map's scale follows the mode: the share at the altitude, or each source's own light
const LOC_GLOW_LIGHT_TICKS = ['country', 'villages', 'town', 'city'];   // at 0, 1, 2, 3 on the light's log scale
function _locGlowSyncCtl() {
  for (const b of document.querySelectorAll('#locGlowAlt button')) b.classList.toggle('on', Number(b.dataset.h) === _locGlow.h);
  for (const b of document.querySelectorAll('#locGlowMode button')) b.classList.toggle('on', b.dataset.m === _locGlow.mode);
  const leg = document.getElementById('locGlowLegShare'), share = _locGlow.mode === 'share';
  leg.querySelector('.lg-name').textContent = share ? `Share of the glow at ${_locGlow.h}°` : 'Light emitted, each source';
  leg.querySelector('.lg-ends').innerHTML = share ? '<span>1/30 000</span><span>strongest</span>' : '';
  leg.querySelector('.lg-ticks').innerHTML = share ? '' : LOC_GLOW_LIGHT_TICKS
    .map((t, i) => `<span style="left:${((i - LOC_GLOW_ABS0) / LOC_GLOW_DEX * 100).toFixed(1)}%">${t}</span>`).join('');
  leg.querySelector('.lg-ticks').style.display = share ? 'none' : '';
}
for (const b of document.querySelectorAll('#locGlowAlt button')) b.addEventListener('click', () => _locGlowSetH(Number(b.dataset.h)));
for (const b of document.querySelectorAll('#locGlowMode button')) b.addEventListener('click', () => _locGlowSetMode(b.dataset.m));
// The map's scale: its 7 colours. The sky's: 22 to 17 mag/arcsec², the Bortle classes' skies named
// at the middle of their bands (classes' edges NIGHTSKY_BORTLE_EDGE, render-nightsky.js)
const LOC_GLOW_SKY0 = 22, LOC_GLOW_SKY_SPAN = 6;   // 22 to 16: a city sky low down reaches 16
const LOC_GLOW_SKY_WORDS = [[21.69, 'pristine', 21.85], [20.49, 'rural', 21.1], [19.5, 'suburban', 20.0], [18.38, 'town', 18.95], [-Infinity, 'city', 17.2]];
function _locGlowSkyWord(b) { return LOC_GLOW_SKY_WORDS.find(w => b >= w[0])[1]; }
function _locGlowSkyX(b) { return Math.max(0, Math.min(1, (LOC_GLOW_SKY0 - b) / LOC_GLOW_SKY_SPAN)); }
(function () {
  document.querySelector('#locGlowLegShare .lg-ramp').innerHTML = LOC_GLOW_RAMP.map(c => `<span style="background:${c}"></span>`).join('');
  // the ticks from rural on (pristine, at the scale's very start, ran into rural; its word stays in the name)
  document.querySelector('#locGlowLegSky .lg-ticks').innerHTML = LOC_GLOW_SKY_WORDS.slice(1)
    .map(w => `<span style="left:${(_locGlowSkyX(w[2]) * 100).toFixed(1)}%">${w[1]}</span>`).join('');
})();
_locGlowSyncCtl();

function _locGlowSetCollapsed(on) {
  _locGlow.collapsed = !!on;
  try { localStorage.setItem(LOC_GLOW_KEY, on ? '1' : '0'); } catch (e) { /* blocked: this page only */ }
  document.getElementById('locGlowWrap').classList.toggle('collapsed', _locGlow.collapsed);
  const t = document.getElementById('locGlowToggle');
  t.textContent = _locGlow.collapsed ? '▼' : '▲';
  t.title = _locGlow.collapsed ? 'Show the towns\' glow' : 'Hide the towns\' glow';
  _locGlow.key = null;
  if (typeof _locPickRequest === 'function' && _locPick.open) _locPickRequest();
}
document.getElementById('locGlowToggle').addEventListener('click', () => _locGlowSetCollapsed(!_locGlow.collapsed));

// N, E, S and W round a circle of radius r at (x, y), just outside it (tag: which picture, for the tests)
function _locGlowCompass(ctx, x, y, r, tag) {
  ctx.font = "9px 'Share Tech Mono', monospace"; ctx.fillStyle = '#cfd9e6';
  for (const [t, dx, dy, al, bl] of [['N', 0, -1, 'center', 'bottom'], ['S', 0, 1, 'center', 'top'], ['E', 1, 0, 'left', 'middle'], ['W', -1, 0, 'right', 'middle']]) {
    ctx.textAlign = al; ctx.textBaseline = bl;
    ctx.fillText(t, x + dx * (r + 1), y + dy * (r + 1) + (dy < 0 ? 3 : dy > 0 ? -3 : 0));
    (_locGlow.compass = _locGlow.compass || []).push(tag + ':' + t);
  }
}
function _locGlowDir(az) { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8]; }
function _locGlowSync() {
  const wrap = document.getElementById('locGlowWrap');
  wrap.style.top = (_locPickHeadBottom() + 8) + 'px';
  if (_locGlow.collapsed || _locPick.ecl || !_locPick.lp) return;
  const lat = hemisphere * LAT, lon = lonHemisphere * LONG;
  const key = [lat, lon, _lpDir.ver, Object.keys(_lpDir.src).length, !!(_lp.index && _lp.index.src), _locGlow.h, _locGlow.mode, _lpSQMAt(lat, lon)].join('|');
  if (_locGlow.key === key && _locGlow.state !== 'loading') return;
  _locGlow.key = key;
  if (!_lp.index) { _locGlow.state = 'loading'; }
  else if (!_lp.index.src) { _locGlow.state = 'nodata'; }
  else {
    const cells = _lpDirCells(lat, lon, _locGlow.h);
    if (!cells) _locGlow.state = 'loading';
    else if (!cells.length) { _locGlow.state = 'none'; _locGlow.cells = []; _locGlow.rose = null; }
    else {
      const D = _lpDirSite();
      _locGlow.cells = cells; _locGlow.cellsH = _locGlow.h;
      _locGlow.rose = D ? Array.from({ length: 72 }, (_, i) => D[i * LP_DIR_NH + _locGlow.h / LP_DIR_H_STEP]) : null;
      _locGlow.state = D ? 'ok' : 'none';
    }
  }
  _locGlowDraw();
}
function _locGlowDraw() {
  _locGlowSky();
  const cv = document.getElementById('locGlowCanvas'), dpr = window.devicePixelRatio || 1, W = 2 * LOC_GLOW_W, H = LOC_GLOW_W;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1520'; ctx.fillRect(0, 0, W, H);
  const note = document.getElementById('locGlowNote'), st = _locGlow.state;
  // the map: the towns' cells, rings at 50 and 100 km (dashed) and the reach, north up, the pin
  const cx = LOC_GLOW_W / 2, cy = H / 2, R = LOC_GLOW_W / 2 - 12, k = R / LP_DIR_RMAX_KM;   // room round each circle for N, E, S, W, so the map's E and the rose's W stay apart
  if (st === 'ok' || st === 'none') {
    const cells = (_locGlow.cells || []).slice().sort((a, b) => a.share - b.share), w = 3.63 * k + 0.6, h = 5.56 * k + 0.6;
    if (_locGlow.mode === 'light') cells.sort((a, b) => a.light - b.light);
    for (const c of cells) {
      const t = Math.min(1, _locGlowT(c));
      if (t <= 0) continue;
      ctx.fillStyle = LOC_GLOW_RAMP[Math.min(LOC_GLOW_RAMP.length - 1, Math.floor(t * LOC_GLOW_RAMP.length))];
      ctx.fillRect(cx + c.x * k - w / 2, cy - c.y * k - h / 2, w, h);
    }
  }
  ctx.strokeStyle = 'rgba(159,179,204,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
  for (const r of [50, 100]) { ctx.beginPath(); ctx.arc(cx, cy, r * k, 0, 2 * Math.PI); ctx.stroke(); }
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(159,179,204,0.8)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
  _locGlow.compass = [];
  _locGlowCompass(ctx, cx, cy, R, 'map');
  ctx.font = "9px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#9fb3cc'; ctx.fillText('150 km', 3, H - 11);
  ctx.fillStyle = '#ff5050'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  // the rose: the sky's glow at the altitude in each direction (_locGlowSkyBs) on the sky's scale,
  // 22 mag/arcsec² at the centre to 16 at the edge, the same for every place, so a dark place's rose
  // stays small; the bands between the Bortle classes' edges in the scale's colours, the edges marked
  const rx = LOC_GLOW_W + LOC_GLOW_W / 2, ry = cy, RR = R - 2, rad = (b) => _locGlowSkyX(b) * RR;
  _locGlow.geo = { cx, cy, R, rx, ry, RR };   // where the pictures are (the tests read it)
  if (_locGlow.mode === 'light') { _locGlowDome(ctx, rx, ry, RR, dpr); _locGlowNote(st, note); return; }
  const edges = [LOC_GLOW_SKY0].concat(LOC_GLOW_SKY_WORDS.slice(0, 4).map(w => w[0]), [LOC_GLOW_SKY0 - LOC_GLOW_SKY_SPAN]);
  for (let k = edges.length - 1; k >= 1; k--) {   // outermost first, each band over the one outside it
    const mid = (edges[k - 1] + edges[k]) / 2, c = _locGlowSkyRGB(_locGlowSkyX(mid));
    ctx.beginPath(); ctx.arc(rx, ry, rad(edges[k]), 0, 2 * Math.PI);
    if (k > 1) ctx.arc(rx, ry, rad(edges[k - 1]), 0, 2 * Math.PI, true);
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.42)`; ctx.fill('evenodd');
  }
  ctx.strokeStyle = 'rgba(207,217,230,0.35)'; ctx.lineWidth = 1;
  for (const e of edges.slice(1)) { ctx.beginPath(); ctx.arc(rx, ry, rad(e), 0, 2 * Math.PI); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(rx, ry - RR); ctx.lineTo(rx, ry + RR); ctx.moveTo(rx - RR, ry); ctx.lineTo(rx + RR, ry); ctx.stroke();
  _locGlow.ringLabels = edges.slice(2);   // the edges with room for their value (the pristine one sits at the centre)
  ctx.fillStyle = '#cfd9e6'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const e of _locGlow.ringLabels) ctx.fillText(e.toFixed(e % 1 ? 1 : 0), rx + 2, ry - rad(e) + 5);
  _locGlowCompass(ctx, rx, ry, R, 'sky');
  const bs = _locGlowSkyBs();
  _locGlow.roseB = bs; _locGlow.roseH = _locGlow.h;
  if (bs) {
    ctx.beginPath();
    bs.forEach((b, i) => { const a = i * 5 * Math.PI / 180, r = rad(b), x = rx + r * Math.sin(a), y = ry - r * Math.cos(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  _locGlowNote(st, note);
}
function _locGlowNote(st, note) {
  const rose = _locGlow.rose;
  if (st === 'ok' && rose) {
    let b = 0; rose.forEach((v, i) => { if (v > rose[b]) b = i; });
    note.textContent = `${_locGlow.h}° up: ×${rose[b] < 10 ? rose[b].toFixed(1) : Math.round(rose[b])} the zenith toward ${b * 5}° (${_locGlowDir(b * 5)})`;
  } else note.textContent = st === 'none' ? 'No towns within 150 km' : st === 'nodata' ? 'No light data here' : 'Loading the towns\' light…';
}
// The site's D at any azimuth and altitude (°), bilinear in the table (az every 5°, cyclic; h every 2°)
function _locGlowD(D, az, el) {
  const x = ((az % 360) + 360) % 360 / 5, y = Math.max(0, Math.min(90, el)) / LP_DIR_H_STEP;
  const i = Math.floor(x) % LP_DIR_NAZ, i2 = (i + 1) % LP_DIR_NAZ, fx = x - Math.floor(x), j = Math.min(LP_DIR_NH - 2, Math.floor(y)), fy = y - j;
  return (D[i * LP_DIR_NH + j] * (1 - fx) + D[i2 * LP_DIR_NH + j] * fx) * (1 - fy) + (D[i * LP_DIR_NH + j + 1] * (1 - fx) + D[i2 * LP_DIR_NH + j + 1] * fx) * fy;
}
// Light: the whole sky from above instead of the rose: the zenith at the centre, the horizon at the
// edge (radius ∝ 90° - altitude), north up and east right as the map beside it (not mirrored as a
// star chart), each point in the sky scale's colour of its brightness (22.0 + the map's artificial
// zenith light × D); the altitude chosen as a white circle. The natural sky's own brightening toward
// the horizon is left out, as in the scale.
function _locGlowDome(ctx, rx, ry, RR, dpr) {
  const sqm = _lpSQMAt(hemisphere * LAT, lonHemisphere * LONG), st = _locGlow.state;
  _locGlow.domeOn = false;
  if (typeof sqm === 'number' && (st === 'ok' || st === 'none')) {
    const D = st === 'ok' ? _lpDirSite() : null, n22 = _nsNLFromB(LOC_GLOW_SKY0), art = _nsNLFromB(Math.min(sqm, LOC_GLOW_SKY0)) - n22;
    const x0 = Math.floor((rx - RR) * dpr), y0 = Math.floor((ry - RR) * dpr), n = Math.ceil(2 * RR * dpr) + 1;
    const img = ctx.getImageData(x0, y0, n, n), d = img.data;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const dx = (x0 + i + 0.5) / dpr - rx, dy = (y0 + j + 0.5) / dpr - ry, r = Math.hypot(dx, dy) / RR;
      if (r > 1) continue;
      const el = 90 * (1 - r), az = Math.atan2(dx, -dy) * 180 / Math.PI;
      const c = _locGlowSkyRGB(_locGlowSkyX(_nsBFromNL(n22 + art * (D ? _locGlowD(D, az, el) : 1)))), o = (j * n + i) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    ctx.putImageData(img, x0, y0);
    _locGlow.domeOn = true;
  }
  ctx.strokeStyle = 'rgba(207,217,230,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(rx, ry, RR, 0, 2 * Math.PI); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2;   // the altitude chosen
  ctx.beginPath(); ctx.arc(rx, ry, (1 - _locGlow.h / 90) * RR, 0, 2 * Math.PI); ctx.stroke();
  _locGlowCompass(ctx, rx, ry, RR + 2, 'sky');
  ctx.font = "9px 'Share Tech Mono', monospace"; ctx.fillStyle = '#cfd9e6'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('zenith', rx + 3, ry);
}
// The sky's glow at the altitude chosen in each of 72 directions (mag/arcsec²): the night sky (22.0)
// plus the map's artificial light at the zenith × D (with no towns within reach, D = 1); null
// without the map's value
function _locGlowSkyBs() {
  const sqm = _lpSQMAt(hemisphere * LAT, lonHemisphere * LONG), h = _locGlow.h;
  if (typeof sqm !== 'number' || !(_locGlow.state === 'ok' || _locGlow.state === 'none')) return null;
  const n22 = _nsNLFromB(LOC_GLOW_SKY0), art = _nsNLFromB(Math.min(sqm, LOC_GLOW_SKY0)) - n22, D = _locGlow.state === 'ok' ? _lpDirSite() : null;
  return Array.from({ length: 72 }, (_, i) => _nsBFromNL(n22 + art * (D ? D[i * LP_DIR_NH + h / LP_DIR_H_STEP] : 1)));
}
// The sky scale's colour at t (0..1): blue, green, yellow, red, as its CSS gradient
const LOC_GLOW_SKY_RGB = [[47, 111, 214], [58, 168, 69], [232, 210, 58], [217, 48, 48]];
function _locGlowSkyRGB(t) {
  const x = Math.max(0, Math.min(1, t)) * (LOC_GLOW_SKY_RGB.length - 1), i = Math.min(LOC_GLOW_SKY_RGB.length - 2, Math.floor(x)), f = x - i;
  return LOC_GLOW_SKY_RGB[i].map((c, k) => Math.round(c + f * (LOC_GLOW_SKY_RGB[i + 1][k] - c)));
}
// The sky's scale: the glow at the altitude chosen, from the darkest direction to the brightest
// (the map's artificial light at the zenith × D; with no towns within reach, D = 1)
function _locGlowSky() {
  const leg = document.getElementById('locGlowLegSky'), name = leg.querySelector('.lg-name');
  const rg = document.getElementById('locGlowRange');
  const h = _locGlow.h, bs = _locGlowSkyBs();
  if (!bs) {
    rg.style.display = 'none'; _locGlow.skyWord = null;
    name.textContent = `Sky at ${h}°: ` + (_locGlow.state === 'nodata' ? 'no light data here' : '…');
    return;
  }
  const lo = Math.max(...bs), hi = Math.min(...bs);   // the darkest (largest mag) and the brightest
  const wl = _locGlowSkyWord(lo), wh = _locGlowSkyWord(hi);
  _locGlow.skyWord = wl === wh ? wl : wl + ' to ' + wh;
  name.textContent = `Sky at ${h}°: ${lo.toFixed(1)} to ${hi.toFixed(1)} mag/arcsec² (${_locGlow.skyWord})`;
  rg.style.display = 'block';
  rg.style.left = (_locGlowSkyX(lo) * 100).toFixed(2) + '%';
  rg.style.width = Math.max(0.5, (_locGlowSkyX(hi) - _locGlowSkyX(lo)) * 100).toFixed(2) + '%';
}
_locGlowSetCollapsed(_locGlow.collapsed);
