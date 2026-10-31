// ─── Location from the globe (SELECT next to SET HERE) ──────────────────────────────────────────
// SELECT opens #locPickWin over the canvas column, whatever mode is active: the Earth of the Globe
// view (render-nightsky-globe.js: Natural Earth 1:110m land and lakes, its equirectangular
// texture), with no external map service. An orthographic view, centred at first on the current
// Location: drag (one finger) turns it, the wheel or two fingers zoom (1x-20x), a click or tap sets
// the Location. Over the Earth the cursor is a pin with its tip on the point, off it the arrow.
// Over the Earth the point under the tip shows in the Latitude / Longitude fields in grey and the
// N|S and E|W switches follow it; off the Earth the fields return to the Location. A click sets
// the Location there (_locHereApply, controls.js, the same path as SET HERE) and a pressure wave
// spreads from the point over the globe: three rings growing along the surface; when it ends the
// fields turn from grey to their normal colour. Any other change of the Location (fields, arrows,
// N|S and E|W, SET HERE, the calibration reset) moves the pin too (_locHereStale, controls.js). The window closes with its
// × or another click on SELECT (light blue while the window is open), Escape, or when the view
// under it changes: another mode, sub-view, sub-mode, 3D switch, event, or Gallery image
// (_locPickViewKey, checked after every click, change, key and pointer release).
// Drawn here, not through the Globe renderer: no Sun, Moon or sky, the texture without snow, the
// limb a little darker, a graticule (30°, 10° and 5° as the zoom grows) and the Location's pin.
// The same window shows the Eclipse map (render-eclipse-map.js, opened from Eclipse
// Visualization): the event's path and lines over the Earth, picking the same way.
// In both, the round button in the corner (#btnLocPickZones) lays the time zones over the Earth.
const LOC_PICK_ZOOM_MIN = 1, LOC_PICK_ZOOM_MAX = 20;
const LOC_PICK_MAX_PX = 1600000;       // buffer pixels at most at rest (beyond: smoothed up)
const LOC_PICK_MAX_PX_MOVING = 220000; // while dragged or pinched
const LOC_PICK_WAVE_MS = 1300, LOC_PICK_WAVE_RINGS = 3, LOC_PICK_WAVE_GAP_MS = 190;
const LOC_PICK_WAVE_DEG = 14;          // angular radius a ring reaches at zoom 1 (less when zoomed)
const _locPick = {
  open: false, lon0: 0, lat0: 0, zoom: 1,
  ecl: null,           // the event id while the window shows its Eclipse map
  zones: false,        // the time zones over the Earth (#btnLocPickZones), kept while the page is open
  // their parts, each switched in the legend (#locPickZoneLegend); the same date off at first, as
  // it watches the time (_locPickDays)
  zoneParts: { dateLine: true, sameDate: false, hatch: true, labels: true },
  zoneLabels: [],      // the offsets' labels of the cached disc: {x, y, text}, none while moving
  daySig: '',          // the same date's signature the cached disc was drawn with (_locPickDays)
  drag: null,          // {x, y, lon0, lat0, moved}
  hover: null,         // {lat, lon} under the pin, or null
  wave: null,          // {lat, lon, t0, zoom}
  cache: { key: null, cv: null },
  moving: false,       // dragged or pinched: the disc at a lower resolution
  raf: 0,
};
const D2R_LP = Math.PI / 180;

function _locPickVec(lon, lat) {
  const l = lon * D2R_LP, b = lat * D2R_LP;
  return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}
// The view: centre direction c, east e and north n at the centre; the disc's centre and radius.
function _locPickView(w, h) {
  const l = _locPick.lon0 * D2R_LP, b = _locPick.lat0 * D2R_LP;
  return {
    c: [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)],
    e: [-Math.sin(l), Math.cos(l), 0],
    n: [-Math.sin(b) * Math.cos(l), -Math.sin(b) * Math.sin(l), Math.cos(b)],
    cx: w / 2, cy: h / 2, R: 0.44 * Math.min(w, h) * _locPick.zoom,
  };
}
function _locPickProject(V, p) {   // a unit vector -> {x, y, z}; z < 0 on the far side
  return {
    x: V.cx + V.R * (p[0] * V.e[0] + p[1] * V.e[1] + p[2] * V.e[2]),
    y: V.cy - V.R * (p[0] * V.n[0] + p[1] * V.n[1] + p[2] * V.n[2]),
    z: p[0] * V.c[0] + p[1] * V.c[1] + p[2] * V.c[2],
  };
}
function _locPickUnproject(V, x, y) {   // a canvas point -> {lat, lon}, or null off the Earth
  const u = (x - V.cx) / V.R, v = -(y - V.cy) / V.R, rr = u * u + v * v;
  if (rr > 1) return null;
  const z = Math.sqrt(1 - rr);
  const px = u * V.e[0] + v * V.n[0] + z * V.c[0];
  const py = u * V.e[1] + v * V.n[1] + z * V.c[1];
  const pz = u * V.e[2] + v * V.n[2] + z * V.c[2];
  return { lat: Math.asin(Math.max(-1, Math.min(1, pz))) / D2R_LP, lon: Math.atan2(py, px) / D2R_LP };
}

// ── Drawing ─────────────────────────────────────────────────────────────────────────────────────
// The disc (texture per pixel, limb-darkened) is cached per view; the graticule, the pin and the
// wave are drawn over it on every frame. No coastline is drawn: the fill's edge is the coast, and
// it follows the coast rather than the texture's cells (2048 x 1024, ~0.18° each): the land share
// is interpolated between the four nearest cells (the texture's edge cells hold their antialiased
// share) and cut at a half over about one screen pixel, so zoomed in the edge stays sharp instead
// of showing blurred steps.
// The time zones (#btnLocPickZones, off at first): each point's zone (tz-lookup.js) at its offset
// at the mode's moment (_tzModeOffsets, the offset a click would set), at sea the nautical zone.
// A colour per offset on a wheel that goes once round in 24 h, so the zones run round the Earth
// as a spectrum, whole hours alternately lighter and darker so that neighbours part; laid over
// land more strongly than over the sea, and fainter under the Eclipse map. A dark line where the
// offset changes, a fainter one between two zones of the same offset on land; the lines only at
// rest. The parts the legend switches (_locPick.zoneParts):
//  - the date line: where the offsets of two neighbours part by more than 12 h, a black line two
//    pixels wide (at rest);
//  - the same date (off at first): at the moment _tzDateInstant gives, the zones on another date
//    than the zone under the Location's pin go under a dark veil, a layer of its own over the
//    disc (_locPickDrawVeil) so that following the time costs little;
//  - an offset off the whole hour (+5:30, +5:45, -3:30 ...): diagonal hatching, its pitch steady
//    on the screen;
//  - the offsets' values: a label per patch of one offset (land and sea together) large enough on
//    the screen, near its middle but on the patch, clear of the other labels, the pin and the
//    legends (at rest; _locPickZoneLabels).
const LOC_PICK_ZONE_ALPHA = { land: 0.66, sea: 0.3, ecl: 0.55 };
const LOC_PICK_ZONE_VEIL = 0.55;          // the other date: this much of the way to the dark
const LOC_PICK_ZONE_HATCH_PX = 6;         // the hatching's pitch on the screen [CSS px]
const LOC_PICK_ZONE_LABEL_AREA = 1600;    // the least patch a label goes on [CSS px²]
const _locPickZoneRGBs = new Map();
function _locPickZoneRGB(h) {
  let c = _locPickZoneRGBs.get(h);
  if (c) return c;
  const hue = (((h + 12) / 24) % 1 + 1) % 1 * 6, s = 0.8, l = (Math.floor(h) & 1) ? 0.66 : 0.4;
  const ch = (1 - Math.abs(2 * l - 1)) * s, x = ch * (1 - Math.abs(hue % 2 - 1)), m = l - ch / 2;
  const rgb = [[ch, x, 0], [x, ch, 0], [0, ch, x], [0, x, ch], [x, 0, ch], [ch, 0, x]][Math.floor(hue) % 6];
  c = rgb.map(v => (v + m) * 255);
  _locPickZoneRGBs.set(h, c);
  return c;
}
// An offset as its label: +1, −3:30, +5:45, 0
function _locPickOffsetText(h) {
  if (h === 0) return '0';
  const a = Math.abs(h), hh = Math.floor(a + 1e-9), mm = Math.round((a - hh) * 60);
  return (h < 0 ? '−' : '+') + hh + (mm ? ':' + String(mm).padStart(2, '0') : '');
}
// The offsets' labels from the disc's buffer (ids: the zone or band per pixel, -1 off the disc;
// hs: its offset): the patches of one offset (4-connected), largest first. One large enough on
// the screen is labelled at its pixel nearest its centroid that has the patch round it a little
// way in all four directions (else just the nearest); a smaller one (an island's waters, Line
// Islands +14) at its centroid, the label laid over it (small: true). In CSS px.
function _locPickZoneLabels(ids, hs, sw, sh, q, x0, y0) {
  const comp = new Int32Array(sw * sh).fill(-1), stack = new Int32Array(sw * sh), order = new Int32Array(sw * sh);
  const minArea = LOC_PICK_ZONE_LABEL_AREA * q * q, inset = Math.max(2, Math.round(8 * q)), out = [];
  let nc = 0;
  for (let n0 = 0; n0 < ids.length; n0++) {
    if (ids[n0] < 0 || comp[n0] >= 0) continue;
    const zh = hs[n0];
    let top = 0, len = 0, sx = 0, sy = 0;
    stack[top++] = n0; comp[n0] = nc;
    while (top) {
      const p = stack[--top], i = p % sw, j = (p - i) / sw;
      order[len++] = p; sx += i; sy += j;
      for (const m of [i > 0 ? p - 1 : -1, i + 1 < sw ? p + 1 : -1, j > 0 ? p - sw : -1, j + 1 < sh ? p + sw : -1]) {
        if (m < 0 || comp[m] >= 0 || ids[m] < 0 || hs[m] !== zh) continue;
        comp[m] = nc; stack[top++] = m;
      }
    }
    if (len < minArea) {
      out.push({ x: x0 + (sx / len + 0.5) / q, y: y0 + (sy / len + 0.5) / q, text: _locPickOffsetText(zh), area: len, small: true });
    } else {
      const cx = sx / len, cy = sy / len;
      const inside = (i, j) => i >= 0 && j >= 0 && i < sw && j < sh && comp[j * sw + i] === nc;
      let best = -1, bestD = Infinity, any = -1, anyD = Infinity;
      for (let k = 0; k < len; k++) {
        const p = order[k], i = p % sw, j = (p - i) / sw, d = (i - cx) * (i - cx) + (j - cy) * (j - cy);
        if (d < anyD) { anyD = d; any = p; }
        if (d < bestD && inside(i - inset, j) && inside(i + inset, j) && inside(i, j - inset) && inside(i, j + inset)) { bestD = d; best = p; }
      }
      const p = best >= 0 ? best : any, i = p % sw, j = (p - i) / sw;
      out.push({ x: x0 + (i + 0.5) / q, y: y0 + (j + 0.5) / q, text: _locPickOffsetText(zh), area: len });
    }
    nc++;
  }
  return out.sort((a, b) => (a.small ? 1 : 0) - (b.small ? 1 : 0) || b.area - a.area);
}
// The labels on the canvas: each clear of those placed, the pin and the legends (with a gap); the
// large patches' first. A small patch gets a label only for a value no label in the view has yet
// (one for an island group, as +14 on the Line Islands; none for the slivers the grid's cells
// leave at a boundary, which share the value of the patch next to them) and not by the limb,
// where the bands narrow into slivers; laid over the patch, or just above, below or beside it.
const LOC_PICK_ZONE_LABEL_LIMB = 0.85;   // a small patch's label within this share of the radius
function _locPickDrawZoneLabels(ctx, V, w, h) {
  const gap = 4, taken = [];
  const free = (b) => taken.every(t => b.x1 + gap <= t.x0 || t.x1 + gap <= b.x0 || b.y1 + gap <= t.y0 || t.y1 + gap <= b.y0);
  const pin = _locPickProject(V, _locPickVec(lonHemisphere * LONG, hemisphere * LAT));
  if (pin.z > 0) taken.push({ x0: pin.x - 8, y0: pin.y - 8, x1: pin.x + 8, y1: pin.y + 8 });
  const cv = document.getElementById('locPickCanvas').getBoundingClientRect();
  for (const id of ['locPickZoneLegend', 'locPickCredit', 'locPickCreditTop', 'btnLocPickZones', 'btnLocPickZoneSearch',
    'locPickZoneSearchPanel', 'locPickZoneMatch']) {
    const el = document.getElementById(id);
    if (!el || !el.offsetParent) continue;
    const r = el.getBoundingClientRect();
    taken.push({ x0: r.left - cv.left, y0: r.top - cv.top, x1: r.right - cv.left, y1: r.bottom - cv.top });
  }
  if (_locPick.ecl && typeof _eclMapGet === 'function') {   // the Eclipse map's legend
    const M = _eclMapGet(_eclipseActiveEvent.id);
    if (M) { const L = _eclMapLegendLayout(ctx, M, _eclipseActiveEvent, h); taken.push({ x0: L.x0, y0: L.y0, x1: L.x0 + L.W, y1: L.y0 + L.H }); }
  }
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const placed = new Set();   // the values labelled
  for (const l of _locPick.zoneLabels) {
    if (l.small && (placed.has(l.text) || Math.hypot(l.x - V.cx, l.y - V.cy) > LOC_PICK_ZONE_LABEL_LIMB * V.R)) continue;
    const tw = ctx.measureText(l.text).width + 6;
    let b = null, x = l.x, y = l.y;
    for (const [dx, dy] of l.small ? [[0, 0], [0, -12], [0, 12], [-tw / 2 - 6, 0], [tw / 2 + 6, 0]] : [[0, 0]]) {
      const c = { x0: l.x + dx - tw / 2, y0: l.y + dy - 7, x1: l.x + dx + tw / 2, y1: l.y + dy + 7 };
      if (free(c)) { b = c; x = l.x + dx; y = l.y + dy; break; }
    }
    if (!b) continue;
    taken.push(b);
    placed.add(l.text);
    ctx.fillStyle = 'rgba(7,9,13,0.72)';
    ctx.fillRect(b.x0, b.y0, tw, 14);
    ctx.fillStyle = '#e8eef4';
    ctx.fillText(l.text, x, y + 0.5);
  }
}
// The same date's state: the moment (_tzDateInstant), the day under the Location's pin, and a
// signature of the day of every offset in use (the zones' and the nautical ones) relative to it,
// which changes only when one of them passes midnight. Without the part or the moment, nulls and ''.
function _locPickDays(G) {
  const offs = _tzModeOffsets(G);
  const dateMs = _locPick.zoneParts.sameDate ? _tzDateInstant() : null;
  if (dateMs === null) return { dateMs: null, pinDay: null, sig: '' };
  const pinLon = lonHemisphere * LONG, s = _tzIndexAt(G, hemisphere * LAT, pinLon);
  const ph = s && offs.off[s] === offs.off[s] ? offs.off[s] : _tzNautical(pinLon);
  const pinDay = _tzDayAt(dateMs, ph);
  return { dateMs, pinDay, sig: _locPickOffsetList(offs).values.map(h => _tzDayAt(dateMs, h) - pinDay).join(',') };
}
// The offsets in use (the zones' and the nautical ones), sorted, with each one's index; once per
// table of offsets
function _locPickOffsetList(offs) {
  if (!offs.list) {
    const set = new Set();
    for (let s = 1; s < offs.off.length; s++) if (offs.off[s] === offs.off[s]) set.add(offs.off[s]);
    for (let n = -12; n <= 12; n++) set.add(n);
    const values = [...set].sort((a, b) => a - b);
    offs.list = { values, index: new Map(values.map((h, i) => [h, i])) };
  }
  return offs.list;
}
// The same date's veil over the cached disc: the pixels whose offset is on another day than the
// pin's darkened, from the disc's offset indices (_locPick.veilSrc). Redone only when the disc or
// the days change (a zone passing midnight), a few ms, so an animation running meanwhile does
// not stall as it would for the disc.
function _locPickDrawVeil(ctx, V) {
  const S = _locPick.veilSrc, G = _tzGrid.data;
  const D = _locPickDays(G);
  _locPick.daySig = D.sig;
  if (!S || D.dateMs === null) return;
  const VC = _locPick.veil || (_locPick.veil = { cv: document.createElement('canvas'), gen: -1, sig: null });
  if (VC.gen !== S.gen || VC.sig !== D.sig) {
    const other = S.list.map(h => _tzDayAt(D.dateMs, h) !== D.pinDay);
    VC.cv.width = S.sw; VC.cv.height = S.sh;
    const img = new ImageData(S.sw, S.sh), px = img.data, a = Math.round(LOC_PICK_ZONE_VEIL * 255);
    for (let n = 0; n < S.oi.length; n++) {
      const k = S.oi[n];
      if (k === 255 || !other[k]) continue;
      const o = n * 4; px[o] = 6; px[o + 1] = 8; px[o + 2] = 12; px[o + 3] = a;
    }
    VC.cv.getContext('2d').putImageData(img, 0, 0);
    VC.gen = S.gen; VC.sig = D.sig;
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(VC.cv, S.x0, S.y0, S.sw / S.q, S.sh / S.q);
  ctx.restore();
}
// The search's match (render-tzsearch.js) over the disc as the veil is: the pixels outside it
// dimmed. A match of zones keeps their pixels; one of an offset all of that offset at the moment,
// the nautical bands at sea too. Redone when the disc, the match or (for an offset) the offsets
// change.
const LOC_PICK_ZONE_DIM = 0.62;   // outside the match: this much of the way to the dark
function _locPickDrawMatch(ctx, V) {
  const S = _locPick.veilSrc, M = typeof _tzs !== 'undefined' ? _tzs.match : null;
  if (!S || !M) return;
  const MC = _locPick.matchVeil || (_locPick.matchVeil = { cv: document.createElement('canvas'), gen: -1, m: null, list: null });
  if (MC.gen !== S.gen || MC.m !== M || MC.list !== S.list) {
    const keep = M.kind === 'offset' ? S.list.map(h => h === M.value) : null;
    MC.cv.width = S.sw; MC.cv.height = S.sh;
    const img = new ImageData(S.sw, S.sh), px = img.data, a = Math.round(LOC_PICK_ZONE_DIM * 255);
    for (let n = 0; n < S.oi.length; n++) {
      const k = S.oi[n];
      if (k === 255) continue;
      if (keep ? keep[k] : M.zones.has(S.zi[n])) continue;
      const o = n * 4; px[o] = 6; px[o + 1] = 8; px[o + 2] = 12; px[o + 3] = a;
    }
    MC.cv.getContext('2d').putImageData(img, 0, 0);
    MC.gen = S.gen; MC.m = M; MC.list = S.list;
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(MC.cv, S.x0, S.y0, S.sw / S.q, S.sh / S.q);
  ctx.restore();
}
// The animations and sliders change the moment without asking the globe to redraw: while the same
// date shows, a look five times a second whether a zone has passed midnight (or the moment has
// come or gone), and a redraw then.
setInterval(() => {
  if (!_locPick.open || !_locPick.zones || !_locPick.zoneParts.sameDate || typeof _tzGrid === 'undefined' || !_tzGrid.data) return;
  if (_locPickDays(_tzGrid.data).sig !== _locPick.daySig) _locPickRequest();
}, 200);
// The bottom of the window's head (it wraps in a narrow window) on the canvas [CSS px]: the Eclipse
// map's legend goes under it (render-eclipse-map.js)
function _locPickHeadBottom() {
  const head = document.querySelector('.loc-pick-head'), cv = document.getElementById('locPickCanvas');
  return head.getBoundingClientRect().bottom - cv.getBoundingClientRect().top;
}
function _locPickDrawEarth(w, h, res, V) {
  const lt = document.body.classList.contains('light');
  const G = _locPick.zones && typeof _tzGrid !== 'undefined' ? _tzGrid.data : null;   // tz-lookup.js
  const offs = G ? _tzModeOffsets(G) : null, P = _locPick.zoneParts;
  // the same date's veil is not in the disc but laid over it (_locPickDrawVeil): the disc keeps
  // per pixel the index of its offset, the veil is redone from it alone when a zone passes midnight
  const list = G ? _locPickOffsetList(offs) : null;
  const key = [w, h, res, _locPick.lon0, _locPick.lat0, _locPick.zoom, lt, !!_nsGlobeTex, _locPick.moving,
    offs ? offs.sig : '', !!_locPick.ecl, G ? [P.dateLine, P.hatch, P.labels].join(',') : ''].join('|');
  const C = _locPick.cache;
  if (C.key === key) return C.cv;
  _locPick.zoneLabels = [];
  _locPick.veilSrc = null;
  C.gen = (C.gen || 0) + 1;
  const cv = C.cv || (C.cv = document.createElement('canvas'));
  cv.width = Math.round(w * res); cv.height = Math.round(h * res);
  const ctx = cv.getContext('2d');
  ctx.setTransform(res, 0, 0, res, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const x0 = Math.max(0, V.cx - V.R), y0 = Math.max(0, V.cy - V.R);
  const bw = Math.min(w, V.cx + V.R) - x0, bh = Math.min(h, V.cy + V.R) - y0;
  if (_nsGlobeTex && bw > 0 && bh > 0) {
    const q = Math.min(res, Math.sqrt((_locPick.moving ? LOC_PICK_MAX_PX_MOVING : LOC_PICK_MAX_PX) / (bw * bh)));
    const sw = Math.max(1, Math.ceil(bw * q)), sh = Math.max(1, Math.ceil(bh * q));
    const img = new ImageData(sw, sh), px = img.data;
    const { w: TW, h: TH, data: T } = _nsGlobeTex;
    const O = NS_GLOBE_OCEAN, Ld = NS_GLOBE_LAND, span = Ld[0] - O[0];
    const share = (x, y) => (T[(y * TW + x) * 4] - O[0]) / span;   // 0 sea .. 1 land
    const texPerPx = TW / (2 * Math.PI) / (q * V.R);   // texture cells per buffer pixel at the centre
    // the time zones: per pixel the zone (land) or the nautical band (sea), and its offset
    const ids = G ? new Int32Array(sw * sh).fill(-1) : null, hs = G ? new Float32Array(sw * sh) : null;
    const oi = G ? new Uint8Array(sw * sh).fill(255) : null;   // the offset's index in list, 255 off the disc
    const zi = G ? new Uint16Array(sw * sh) : null;            // the zone's index, 0 at sea (the search's match)
    const zoneA = LOC_PICK_ZONE_ALPHA, eclA = _locPick.ecl ? zoneA.ecl : 1;
    const pitch = Math.max(3, Math.round(LOC_PICK_ZONE_HATCH_PX * q)), stripe = Math.max(1, Math.round(pitch / 3));
    for (let j = 0; j < sh; j++) {
      const v = -((y0 + (j + 0.5) / q) - V.cy) / V.R;
      for (let i = 0; i < sw; i++) {
        const u = ((x0 + (i + 0.5) / q) - V.cx) / V.R, rr = u * u + v * v;
        if (rr > 1) continue;
        const z = Math.sqrt(1 - rr);
        const X = u * V.e[0] + v * V.n[0] + z * V.c[0];
        const Y = u * V.e[1] + v * V.n[1] + z * V.c[1];
        const Z = u * V.e[2] + v * V.n[2] + z * V.c[2];
        const lat = Math.asin(Math.max(-1, Math.min(1, Z))) / D2R_LP;
        const lon = Math.atan2(Y, X) / D2R_LP;
        // the four cells round the point (centres at +0.5), longitude wrapping
        const fx = (lon + 180) / 360 * TW - 0.5, fy = Math.max(0, Math.min(TH - 1.001, (90 - lat) / 180 * TH - 0.5));
        const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
        const x1 = ((ix % TW) + TW) % TW, x2 = (x1 + 1) % TW, y2 = Math.min(TH - 1, iy + 1);
        const f = (share(x1, iy) * (1 - ax) + share(x2, iy) * ax) * (1 - ay)
                + (share(x1, y2) * (1 - ax) + share(x2, y2) * ax) * ay;
        const hw = Math.min(0.5, Math.max(0.03, 0.5 * texPerPx / Math.max(z, 0.15)));
        let a = (f - 0.5 + hw) / (2 * hw); a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
        const k = 0.62 + 0.38 * z;   // limb darkening: reads as a sphere
        const o = (j * sw + i) * 4;
        let r = O[0] + (Ld[0] - O[0]) * a, g = O[1] + (Ld[1] - O[1]) * a, b = O[2] + (Ld[2] - O[2]) * a;
        if (G) {
          let s = _tzIndexAt(G, lat, lon), zh = s ? offs.off[s] : NaN;
          if (zh !== zh) { s = 0; zh = _tzNautical(lon); }   // at sea, or a zone the browser does not know
          ids[j * sw + i] = s || 100000 + Math.round(zh * 4);
          hs[j * sw + i] = zh;
          oi[j * sw + i] = list.index.get(zh);
          zi[j * sw + i] = s;
          const c = _locPickZoneRGB(zh), al = (zoneA.sea + (zoneA.land - zoneA.sea) * a) * eclA;
          r += (c[0] - r) * al; g += (c[1] - g) * al; b += (c[2] - b) * al;
          if (P.hatch && Math.abs(zh - Math.round(zh)) > 1e-6 && (i + j) % pitch < stripe) { r *= 0.62; g *= 0.62; b *= 0.62; }
        }
        px[o] = r * k;
        px[o + 1] = g * k;
        px[o + 2] = b * k;
        px[o + 3] = 255;
      }
    }
    // the lines: towards the right and the lower neighbour; not while dragged or pinched, as the
    // buffer is coarse then and smoothed up, which blurs thin lines far more than the fill
    if (G && !_locPick.moving) {
      const dark = new Uint8Array(sw * sh);   // the date line, set on both its sides: 2 px wide
      for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
        const n = j * sw + i, id = ids[n];
        if (id < 0) continue;
        let f = 1;
        for (const m of [i + 1 < sw ? n + 1 : -1, j + 1 < sh ? n + sw : -1]) {
          if (m < 0 || ids[m] < 0 || ids[m] === id) continue;
          if (P.dateLine && Math.abs(hs[m] - hs[n]) > 12) { dark[n] = dark[m] = 1; continue; }
          if (hs[m] !== hs[n]) f = Math.min(f, 0.45);
          else if (id < 100000 && ids[m] < 100000) f = Math.min(f, 0.8);
        }
        if (f < 1) { const o = n * 4; px[o] *= f; px[o + 1] *= f; px[o + 2] *= f; }
      }
      const thick = Math.max(1, Math.round(q));   // 2 CSS px in all: a pixel on each side
      for (let n = 0; n < dark.length; n++) {
        if (!dark[n]) continue;
        const i = n % sw, j = (n - i) / sw;
        for (let dj = 0; dj < thick; dj++) for (let di = 0; di < thick; di++) {
          const ii = i + di - (thick >> 1), jj = j + dj - (thick >> 1);
          if (ii < 0 || jj < 0 || ii >= sw || jj >= sh || ids[jj * sw + ii] < 0) continue;
          const o = (jj * sw + ii) * 4; px[o] = px[o + 1] = px[o + 2] = 0;
        }
      }
      if (P.labels) _locPick.zoneLabels = _locPickZoneLabels(ids, hs, sw, sh, q, x0, y0);
    }
    if (G) _locPick.veilSrc = { gen: C.gen, oi, zi, list: list.values, sw, sh, x0, y0, q };
    const off = document.createElement('canvas'); off.width = sw; off.height = sh;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, x0, y0, sw / q, sh / q);
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2);
  ctx.strokeStyle = lt ? 'rgba(0,0,0,0.45)' : 'rgba(160,200,240,0.45)'; ctx.lineWidth = 1; ctx.stroke();
  C.key = key;
  return cv;
}
// Polylines of unit vectors, broken where they pass to the far side.
function _locPickStrokeLines(ctx, V, lines) {
  ctx.beginPath();
  for (const line of lines) {
    let pen = false;
    for (const p of line) {
      const s = _locPickProject(V, p);
      if (s.z < 0) { pen = false; continue; }
      if (pen) ctx.lineTo(s.x, s.y); else { ctx.moveTo(s.x, s.y); pen = true; }
    }
  }
  ctx.stroke();
}
function _locPickGraticule(ctx, V) {
  const step = _locPick.zoom >= 6 ? 5 : _locPick.zoom >= 2.5 ? 10 : 30;
  const minor = [], major = [];
  for (let lat = -90 + step; lat < 90; lat += step) {
    const line = [];
    for (let lon = -180; lon <= 180; lon += 2) line.push(_locPickVec(lon, lat));
    (lat === 0 ? major : minor).push(line);
  }
  for (let lon = -180; lon < 180; lon += step) {
    const line = [];
    for (let lat = -90; lat <= 90; lat += 2) line.push(_locPickVec(lon, lat));
    (lon === 0 ? major : minor).push(line);
  }
  ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(200,220,240,0.16)';
  _locPickStrokeLines(ctx, V, minor);
  ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(200,220,240,0.34)';
  _locPickStrokeLines(ctx, V, major);
}
// A circle on the sphere: angular radius a (deg) round the unit vector C.
function _locPickCircle(C, a) {
  const ref = Math.abs(C[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1 = [C[1] * ref[2] - C[2] * ref[1], C[2] * ref[0] - C[0] * ref[2], C[0] * ref[1] - C[1] * ref[0]];
  const l = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map(v => v / l);
  const e2 = [C[1] * e1[2] - C[2] * e1[1], C[2] * e1[0] - C[0] * e1[2], C[0] * e1[1] - C[1] * e1[0]];
  const ca = Math.cos(a * D2R_LP), sa = Math.sin(a * D2R_LP), pts = [];
  for (let k = 0; k <= 96; k++) {
    const f = k / 96 * Math.PI * 2, cf = Math.cos(f), sf = Math.sin(f);
    pts.push([0, 1, 2].map(i => ca * C[i] + sa * (cf * e1[i] + sf * e2[i])));
  }
  return pts;
}
function _locPickDrawPin(ctx, V, lat, lon, col) {
  const s = _locPickProject(V, _locPickVec(lon, lat));
  if (s.z < 0) return;
  ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
}
function _locPickDraw() {
  _locPick.raf = 0;
  if (!_locPick.open) return;
  const cv = document.getElementById('locPickCanvas');
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const res = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  if (cv.width !== Math.round(w * res) || cv.height !== Math.round(h * res)) {
    cv.width = Math.round(w * res); cv.height = Math.round(h * res);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  const V = _locPickView(w, h);
  ctx.drawImage(_locPickDrawEarth(w, h, res, V), 0, 0);
  ctx.setTransform(res, 0, 0, res, 0, 0);
  if (!_nsGlobeTex) {
    ctx.fillStyle = '#8899aa'; ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Loading the Earth…', w / 2, h / 2);
  }
  if (_locPick.zones && typeof _tzGrid !== 'undefined' && _tzGrid.data) { _locPickDrawVeil(ctx, V); _locPickDrawMatch(ctx, V); }
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  _locPickGraticule(ctx, V);
  ctx.restore();
  if (_locPick.zones) {
    if (_locPick.zoneParts.labels && _locPick.zoneLabels.length) _locPickDrawZoneLabels(ctx, V, w, h);
    _locPickZoneLegendSync();
  }
  if (_locPick.ecl && typeof _eclMapDraw === 'function') _eclMapDraw(ctx, V, w, h);
  _locPickDrawPin(ctx, V, hemisphere * LAT, lonHemisphere * LONG, '#e84040');   // the Location
  const W = _locPick.wave;
  if (W) {   // the pressure wave: rings growing along the surface, fading as they go
    const t = performance.now() - W.t0, C = _locPickVec(W.lon, W.lat);
    const reach = LOC_PICK_WAVE_DEG / Math.sqrt(W.zoom);
    for (let k = 0; k < LOC_PICK_WAVE_RINGS; k++) {
      const f = (t - k * LOC_PICK_WAVE_GAP_MS) / (LOC_PICK_WAVE_MS - (LOC_PICK_WAVE_RINGS - 1) * LOC_PICK_WAVE_GAP_MS);
      if (f <= 0 || f >= 1) continue;
      const ease = 1 - Math.pow(1 - f, 3);
      ctx.lineWidth = 2.2 * (1 - f) + 0.6;
      ctx.strokeStyle = `rgba(140,210,255,${(0.85 * (1 - f) * (1 - f)).toFixed(3)})`;
      _locPickStrokeLines(ctx, V, [_locPickCircle(C, Math.max(0.05, reach * ease))]);
    }
    if (t < LOC_PICK_WAVE_MS) _locPickRequest();
    else { _locPick.wave = null; _locPickSettled(); }
  }
  if (!_nsGlobeTex) _locPickRequest();   // until the land data is in
}
function _locPickRequest() {
  if (!_locPick.raf) _locPick.raf = requestAnimationFrame(_locPickDraw);
}

// ── The fields: grey preview of the point under the pin ─────────────────────────────────────────
function _locPickShowHemi(latSigned, lonSigned) {
  const n = latSigned >= 0, e = lonSigned >= 0;
  document.getElementById('btnN').className = n ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnS').className = n ? 'ns-btn' : 'ns-btn active-s';
  document.getElementById('btnE').className = e ? 'ns-btn active' : 'ns-btn';
  document.getElementById('btnW').className = e ? 'ns-btn' : 'ns-btn active-s';
}
// With the time zones on, the head's hint gives the zone and offset of the point under the pin
// (at sea the nautical zone); off the Earth, or with them off, the hint again.
function _locPickZoneHint(p) {
  const span = document.getElementById('locPickHint');
  if (span.dataset.hint === undefined) span.dataset.hint = span.textContent;
  const G = _locPick.zones && typeof _tzGrid !== 'undefined' ? _tzGrid.data : null;
  if (!G || !p) { span.textContent = span.dataset.hint; return; }
  const s = _tzIndexAt(G, p.lat, p.lon), h = s ? _tzModeOffsets(G).off[s] : NaN;
  span.textContent = h === h ? `${G.zones[s - 1]} · UTC${_fmtTimeZone(h)}`
    : `${s ? G.zones[s - 1] + ' unknown to this browser, nautical' : 'sea, nautical'} · UTC${_fmtTimeZone(_tzNautical(p.lon))}`;
}
function _locPickPreview(p) {
  _locPickZoneHint(p);
  if (_locPick.wave) return;   // the picked values stay until the wave ends
  const lat = document.getElementById('inpLat'), lon = document.getElementById('inpLong');
  if (p) {
    _locFormatInput('inpLat', Math.abs(p.lat));
    _locFormatInput('inpLong', Math.abs(p.lon));
    lat.classList.add('loc-preview'); lon.classList.add('loc-preview');
    _locPickShowHemi(p.lat, p.lon);
  } else _locPickRestoreFields();
}
function _locPickRestoreFields() {
  const lat = document.getElementById('inpLat'), lon = document.getElementById('inpLong');
  lat.classList.remove('loc-preview'); lon.classList.remove('loc-preview');
  _locFormatInput('inpLat', LAT);
  _locFormatInput('inpLong', LONG);
  _locPickShowHemi(hemisphere, lonHemisphere);
}
function _locPickSettled() {   // the wave is over: the fields to their normal colour
  _locPickRestoreFields();
  if (_locPick.hover) _locPickPreview(_locPick.hover);
}

// ── Opening, closing, input ─────────────────────────────────────────────────────────────────────
// ecl: an event id for its Eclipse map, else the plain globe of SELECT. Opened again while open,
// the window only changes what it shows, the view stays; the Eclipse map, newly shown, turns to
// the Greatest Eclipse point.
// What the canvas column shows, as a string: the window closes when it changes.
function _locPickViewKey() {
  const v = (f) => { try { return f(); } catch (e) { return null; } };
  return [
    v(() => currentMode), v(() => _modeWheelIndex), v(() => theaterMode3D), v(() => sunGraphActive),
    v(() => skyDomeActive), v(() => skyDomeProjection), v(() => skyMap3DOn),
    v(() => eclipseActive), v(() => eclipseSubView), v(() => _eclipseActiveEvent && _eclipseActiveEvent.id),
    v(() => nightSkyActive), v(() => nightSkyTopView), v(() => nightSkySubmode), v(() => nightSkyMap3DOn),
    v(() => galleryState.genId), v(() => galleryState.imageIndex), v(() => galleryState.layer),
  ].join('|');
}
function _locPickSetOpen(on, ecl) {
  const was = _locPick.open, wasEcl = _locPick.ecl;
  if (on) _locPick.viewKey = _locPickViewKey();
  _locPick.open = on;
  _locPick.ecl = on ? (ecl || null) : null;
  document.getElementById('locPickWin').classList.toggle('open', on);
  document.getElementById('locPickWin').classList.toggle('ecl', !!_locPick.ecl);
  const plain = on && !_locPick.ecl;
  const btn = document.getElementById('btnLocSelect');
  btn.classList.toggle('open', plain);
  btn.setAttribute('aria-pressed', String(plain));
  // the Eclipse map picks the Location itself: SELECT is off while it is open
  btn.disabled = on && !!_locPick.ecl;
  btn.title = plain ? 'Close the globe' : btn.disabled ? 'The eclipse map sets the Location: click on it'
    : 'Select the Location on a globe of the Earth';
  const head = document.getElementById('locPickTitle');
  if (_locPick.ecl && typeof _eclipseActiveEvent !== 'undefined') {
    const ev = _eclipseActiveEvent;
    head.textContent = 'ECLIPSE MAP ' + ev.year + ' ' + MONTH_NAMES[ev.dayMonth - 1] + ' ' + ev.dayDay;
  } else head.textContent = 'SELECT LOCATION';
  if (on) {
    if (!was) {
      _locPick.lon0 = lonHemisphere * LONG;
      _locPick.lat0 = hemisphere * LAT;
    }
    if (_locPick.ecl && _locPick.ecl !== wasEcl) {
      const g = _eclipseActiveEvent.greatestEclipse;
      _locPick.lon0 = g.lonHemisphere * g.lon;
      _locPick.lat0 = Math.max(-89, Math.min(89, g.hemisphere * g.lat));
      _locPick.zoom = 1;
    }
    _locPick.hover = null;
    _locPickZoneHint(null);
    _nsGlobeLoad();
    _locPickRequest();
  } else {
    _locPick.drag = null; _locPick.hover = null;
    _locPickZoneHint(null);
    if (typeof _tzs !== 'undefined' && _tzs.open) _tzsSetOpen(false);   // render-tzsearch.js
    if (_locPick.wave) _locPick.wave = null;
    _locPickRestoreFields();
  }
}
function _locPickPoint(e) {
  const cv = document.getElementById('locPickCanvas'), r = cv.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  return { x, y, p: _locPickUnproject(_locPickView(cv.clientWidth, cv.clientHeight), x, y) };
}
(function () {
  const cv = document.getElementById('locPickCanvas');
  // Pointers down (Pointer Events: mouse, pen, fingers). One drags or, without moving, picks;
  // two pinch-zoom (zoom at their first spread times the change of their distance), and a
  // finger left after a pinch neither turns nor picks. A touch has no hover, so the point under a
  // finger shows in grey while it is down, and the release sets it.
  const pts = new Map();
  let pinch = null, wheelRest = 0;
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  const endDrag = () => {
    _locPick.drag = null; cv.classList.remove('dragging');
    if (_locPick.moving && !pinch) { _locPick.moving = false; _locPickRequest(); }   // full resolution again
  };
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    if (pts.size >= 2) {
      endDrag();
      if (pts.size === 2) { pinch = { d: spread(), zoom: _locPick.zoom }; _locPick.moving = true; }
      _locPick.hover = null; _locPickPreview(null);
      return;
    }
    _locPick.drag = { x: e.clientX, y: e.clientY, lon0: _locPick.lon0, lat0: _locPick.lat0, moved: false };
    if (e.pointerType !== 'mouse') { _locPick.hover = _locPickPoint(e).p; _locPickPreview(_locPick.hover); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pts.size === 2) {
        _locPick.zoom = Math.max(LOC_PICK_ZOOM_MIN, Math.min(LOC_PICK_ZOOM_MAX, pinch.zoom * spread() / pinch.d));
        _locPickRequest();
      }
      return;
    }
    const D = _locPick.drag;
    if (D) {
      const dx = e.clientX - D.x, dy = e.clientY - D.y;
      if (!D.moved && Math.hypot(dx, dy) > 4) { D.moved = true; _locPick.moving = true; cv.classList.add('dragging'); _locPick.hover = null; _locPickPreview(null); }
      if (D.moved) {
        const R = _locPickView(cv.clientWidth, cv.clientHeight).R;
        _locPick.lon0 = ((D.lon0 - dx / R / D2R_LP + 540) % 360) - 180;
        _locPick.lat0 = Math.max(-89, Math.min(89, D.lat0 + dy / R / D2R_LP));
        _locPickRequest();
        return;
      }
    }
    if (e.pointerType === 'mouse' || D) { _locPick.hover = _locPickPoint(e).p; _locPickPreview(_locPick.hover); }
    cv.classList.toggle('off-earth', !_locPickPoint(e).p);
  });
  cv.addEventListener('pointerup', (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    const D = _locPick.drag;
    endDrag();
    if (e.pointerType !== 'mouse') { _locPick.hover = null; }
    if (!D || D.moved) { if (e.pointerType !== 'mouse') _locPickPreview(null); return; }
    const p = _locPickPoint(e).p;
    if (!p) { _locPickPreview(null); return; }
    _locHereApply(p.lat, p.lon);   // controls.js: hemispheres + applyLat/applyLong, every view redraws
    const text = `Set to ${_locHereShown()} from the globe.`;
    _locHereInfo(text);
    _tzFollowLocation(p.lat, p.lon, text);   // tz-lookup.js: the Time zone follows
    document.getElementById('inpLat').classList.add('loc-preview');
    document.getElementById('inpLong').classList.add('loc-preview');
    _locPick.wave = { lat: p.lat, lon: p.lon, t0: performance.now(), zoom: _locPick.zoom };
    _locPickRequest();
  });
  cv.addEventListener('pointercancel', (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    endDrag();
  });
  cv.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !_locPick.drag) { _locPick.hover = null; _locPickPreview(null); }
  });
  // Safari's own pinch (page zoom) would fight the one above
  cv.addEventListener('gesturestart', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    _locPick.zoom = Math.max(LOC_PICK_ZOOM_MIN, Math.min(LOC_PICK_ZOOM_MAX, _locPick.zoom * Math.exp(-e.deltaY * 0.0015)));
    _locPick.moving = true;   // a run of wheel ticks at the lower resolution, the full one after it
    clearTimeout(wheelRest);
    wheelRest = setTimeout(() => { if (!_locPick.drag && !pinch) { _locPick.moving = false; _locPickRequest(); } }, 180);
    _locPick.hover = _locPickPoint(e).p;
    _locPickPreview(_locPick.hover);
    cv.classList.toggle('off-earth', !_locPick.hover);   // the disc grows or shrinks under the cursor
    _locPickRequest();
  }, { passive: false });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (_locPick.open) _locPickRequest(); }).observe(cv);
})();
document.getElementById('btnLocSelect').addEventListener('click', () => _locPickSetOpen(!_locPick.open));
document.getElementById('btnLocPickClose').addEventListener('click', () => _locPickSetOpen(false));
// The time zones' legend: a row per part, a click switches it (the colours' row only explains).
// The same date needs a moment (_tzDateInstant): in Solargraph there is none, its row is off and
// disabled there (the part's own setting is kept for Eclipse and Night Sky).
function _locPickZoneLegendSync() {
  for (const b of document.querySelectorAll('#locPickZoneLegend button[data-part]')) {
    const part = b.dataset.part;
    const none = part === 'sameDate' && _tzDateInstant() === null;
    b.setAttribute('aria-pressed', String(_locPick.zoneParts[part] && !none));
    if (b.disabled !== none) {
      b.disabled = none;
      b.title = none ? 'Not in Solargraph: its time zones are the standard time' : 'Show or hide';
    }
  }
}
for (const b of document.querySelectorAll('#locPickZoneLegend button[data-part]')) {
  b.addEventListener('click', () => {
    _locPick.zoneParts[b.dataset.part] = !_locPick.zoneParts[b.dataset.part];
    _locPickZoneLegendSync();
    _locPickRequest();
  });
}
document.getElementById('btnLocPickZones').addEventListener('click', (e) => {
  _locPick.zones = !_locPick.zones;
  e.currentTarget.setAttribute('aria-pressed', String(_locPick.zones));
  e.currentTarget.title = _locPick.zones ? 'Hide the time zones' : 'Show the time zones';
  document.getElementById('locPickWin').classList.toggle('zones', _locPick.zones);   // their source (.loc-pick-credit) shows
  if (!_locPick.zones && typeof _tzs !== 'undefined' && _tzs.open) _tzsSetOpen(false);   // the search's button goes with them
  if (_locPick.zones) _tzLoad().then((g) => {   // the first time: the grid comes in
    // the credit (both its places) names the data's release, read from the grid so it follows a
    // regeneration
    for (const ver of document.querySelectorAll('.loc-pick-credit-ver')) {
      if (!g || !g.release || ver.firstChild) continue;
      const a = document.createElement('a');
      a.href = 'https://github.com/evansiroky/timezone-boundary-builder/releases/tag/' + encodeURIComponent(g.release);
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = 'timezone-boundary-builder ' + g.release;
      ver.append(' · ', a);
    }
    _locPickRequest();
  });
  _locPickZoneHint(_locPick.hover);
  _locPickRequest();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _locPick.open && !e.defaultPrevented) _locPickSetOpen(false);
});
// after the handlers of the event that may have switched the view (bubbling, the document last)
['click', 'change', 'keyup', 'pointerup'].forEach((type) => document.addEventListener(type, () => {
  if (_locPick.open && _locPickViewKey() !== _locPick.viewKey) _locPickSetOpen(false);
}));
