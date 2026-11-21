// ─── Location from the globe (SELECT next to SET HERE) ──────────────────────────────────────────
// SELECT opens #locPickWin over the canvas column, whatever mode is active: the Earth of the Globe
// view (render-nightsky-globe.js: Natural Earth 1:110m land and lakes, its equirectangular
// texture), with no external map service. An orthographic view, centred at first on the current
// Location: drag (one finger) turns it, carrying the place pressed on, the wheel, two fingers or the height slider on the right edge
// zoom (1x-40x; the wheel at the cursor, two fingers between them, the slider at the centre), a click or tap sets
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
// In both, a round button (#btnLocPickZones; in SELECT left of the light pollution's, on the
// Eclipse map in the corner) lays the time zones over the Earth.
const LOC_PICK_ZOOM_MIN = 1, LOC_PICK_ZOOM_MAX = 40;
// The height above the ground shown for a zoom: a camera with a 50° field of view showing the ground
// at the view's centre at the globe's scale there (the Earth's radius 0.44 × the shorter side × zoom):
// 6371 km / (0.88 · tan 25°) / zoom, 15 500 km for the whole Earth, 390 km at the closest
const LOC_PICK_ALT_KM = 6371 / (0.88 * Math.tan(25 * Math.PI / 180));
const LOC_PICK_MAX_PX = 1600000;       // buffer pixels at most at rest (beyond: smoothed up)
const LOC_PICK_MAX_PX_MOVING = 220000; // while dragged or pinched
const LOC_PICK_WAVE_MS = 1300, LOC_PICK_WAVE_RINGS = 3, LOC_PICK_WAVE_GAP_MS = 190;
const LOC_PICK_WAVE_DEG = 14;          // angular radius a ring reaches at zoom 1 (less when zoomed)
const _locPick = {
  open: false, lon0: 0, lat0: 0, zoom: 1,
  ecl: null,           // the event id while the window shows its Eclipse map
  zones: false,        // the time zones over the Earth (#btnLocPickZones), kept while the page is open
  lp: false,           // the light pollution over the Earth (#btnLocPickLightPollution), only in SELECT
  lpHi: { hover: null, pin: null },   // the class shown alone: pointed at in the legend, or picked there
  // the daylight bands over the Earth (render-locpick-daylight.js), only in SELECT: Day length,
  // Sunrise or Sunset, the time base of the last two ('local', 'utc', 'location'), the band shown alone;
  // the layer, mode and base kept while the page is open (#btnLocPickDaylight, #locPickDlLegend)
  dl: false, dlMode: 'length', dlBase: 'local', dlLabels: 'edges', dlHi: { hover: null, pin: null },
  // their parts, each switched in the legend (#locPickZoneLegend); the same date off at first, as
  // it watches the time (_locPickDays)
  zoneParts: { dateLine: true, sameDate: false, hatch: true, labels: true, dst: false },
  // the labels' content and place, kept while the page is open (#locPickZoneText, #locPickZonePlace):
  // 'zone' the offset or 'time' the local time (_locPickZoneTimeAt); 'zones' in the areas or 'cities'
  zoneText: 'zone', zonePlace: 'zones',
  zoneLegendNone: null,   // whether the legend was last synced without a moment (_locPickZoneLegendSync)
  zoneLabels: [],      // the offsets' labels of the cached disc: {x, y, text, h}, none while moving; as
                       // drawn: time (or null) and bg (the Time tag's colour, or null)
  zoneMinute: null,    // the minute of the moment the Time labels were drawn for (null: none shown)
  zoneTimeDrawn: 0,    // when they were drawn [performance.now()]
  daySig: '',          // the same date's signature the cached disc was drawn with (_locPickDays)
  dstSig: '',          // the zones' DST states the signs were last drawn with (_locPickDrawZoneDst)
  dst: null,           // the signs' layers (_locPickDrawZoneDst), freed with the row or the window
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
//  - daylight saving time (off at first): + or 0 signs over the zones that use it, by their clock
//    at the moment (± in Solargraph), a layer of their own over the disc (_locPickDrawZoneDst);
//  - the offsets' values: a label per patch of one offset (land and sea together) large enough on
//    the screen, near its middle but on the patch, clear of the other labels, the pin and the
//    legends (at rest; _locPickZoneLabels). Zone | Time in the legend: the offset, or the local
//    time at the mode's moment (_tzDateInstant; none in Solargraph, where Zone applies) in a tag
//    coloured by its day against the day under the Location's pin (LOC_PICK_ZONE_DAY_RGB). The
//    labels' places do not depend on the time: the time follows the moment by the minute
//    (_locPickWatch) with the same disc and the same layout. Zones | Cities in the legend: in the
//    areas, or as tags next to the places (render-locpick-cities.js, owner 'zones'; the places on for
//    the while), thinned as Daylight's and within one area (the same time) to tags
//    LOC_PICK_ZONE_AREA_GAP_PX apart, then every area of the Zones labels without a tag given one
//    (_locPickZoneCover): at its most important place drawn, else at its label's spot.
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
// Islands +14) at its centroid, the label laid over it (small: true). In CSS px. Also the patch's
// index per pixel (comp; c on each label) and each patch's box in the buffer (i0, i1, j0, j1): the
// areas of Zones | Cities.
function _locPickZoneLabels(ids, hs, sw, sh, q, x0, y0) {
  const comp = new Int32Array(sw * sh).fill(-1), stack = new Int32Array(sw * sh), order = new Int32Array(sw * sh);
  const minArea = LOC_PICK_ZONE_LABEL_AREA * q * q, inset = Math.max(2, Math.round(8 * q)), out = [];
  let nc = 0;
  for (let n0 = 0; n0 < ids.length; n0++) {
    if (ids[n0] < 0 || comp[n0] >= 0) continue;
    const zh = hs[n0];
    let top = 0, len = 0, sx = 0, sy = 0, i0 = sw, i1 = -1, j0 = sh, j1 = -1;
    stack[top++] = n0; comp[n0] = nc;
    while (top) {
      const p = stack[--top], i = p % sw, j = (p - i) / sw;
      order[len++] = p; sx += i; sy += j;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
      for (const m of [i > 0 ? p - 1 : -1, i + 1 < sw ? p + 1 : -1, j > 0 ? p - sw : -1, j + 1 < sh ? p + sw : -1]) {
        if (m < 0 || comp[m] >= 0 || ids[m] < 0 || hs[m] !== zh) continue;
        comp[m] = nc; stack[top++] = m;
      }
    }
    if (len < minArea) {
      out.push({ x: x0 + (sx / len + 0.5) / q, y: y0 + (sy / len + 0.5) / q, text: _locPickOffsetText(zh), area: len, small: true, h: zh, c: nc, i0, i1, j0, j1 });
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
      out.push({ x: x0 + (i + 0.5) / q, y: y0 + (j + 0.5) / q, text: _locPickOffsetText(zh), area: len, h: zh, c: nc, i0, i1, j0, j1 });
    }
    nc++;
  }
  return { labels: out.sort((a, b) => (a.small ? 1 : 0) - (b.small ? 1 : 0) || b.area - a.area), comp };
}
// Time: the local time's tag by its day against the Location's (two days behind, a day behind, the
// same, a day ahead, two days ahead)
const LOC_PICK_ZONE_DAY_RGB = { '-2': '#7a1f17', '-1': '#c0392b', '0': '#101418', '1': '#2e8b3e', '2': '#1b5e27' };
const LOC_PICK_ZONE_TIME_REDRAW_MS = 100;   // a new minute redrawn at most this often while the moment runs
// The offset at (lat, lon) at the mode's moment (offs: _tzModeOffsets): its zone's, at sea (or unknown)
// the nautical one
function _locPickZoneOffsetLL(G, offs, lat, lon) {
  const s = G ? _tzIndexAt(G, lat, lon) : 0;
  return s && offs && offs.off[s] === offs.off[s] ? offs.off[s] : _tzNautical(lon);
}
// The offset under the Location's pin
function _locPickPinOffset(G, offs) {
  return _locPickZoneOffsetLL(G, offs, hemisphere * LAT, lonHemisphere * LONG);
}
// The offset [h] of the disc's pixel under canvas point (x, y), null off the disc or without the index
function _locPickZoneOffsetAt(x, y) {
  const Z = _locPick.veilSrc;
  if (!Z) return null;
  const i = Math.floor((x - Z.x0) * Z.q), j = Math.floor((y - Z.y0) * Z.q);
  if (i < 0 || j < 0 || i >= Z.sw || j >= Z.sh) return null;
  const k = Z.oi[j * Z.sw + i];
  return k === 255 ? null : Z.list[k];
}
// The local time at offset h [h] at the instant ms: its text (H:MM) and its day against the day under
// the Location's pin (-2..2: the offsets -12..+14 are at most two days apart); ph the pin's offset
// (_locPickPinOffset) when known
function _locPickZoneTimeAt(h, ms, ph) {
  if (ph === undefined) {
    const G = typeof _tzGrid !== 'undefined' ? _tzGrid.data : null;
    ph = _locPickPinOffset(G, G ? _tzModeOffsets(G) : null);
  }
  const m = ((Math.floor((ms + h * 3600000) / 60000) % 1440) + 1440) % 1440;
  const day = Math.max(-2, Math.min(2, _tzDayAt(ms, h) - _tzDayAt(ms, ph)));
  return { text: Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'), day };
}
// The moment the labels show the time for, or null when they show the offsets (Zone, or no moment)
function _locPickZoneTimeMs() {
  return _locPick.zoneText === 'time' && _locPick.zoneParts.labels ? _tzDateInstant() : null;
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
  for (const id of ['locPickZoneLegend', 'locPickCredit', 'locPickCreditTop', 'btnLocPickZones', 'btnLocPickLightPollution', 'btnLocPickDaylight', 'btnLocPickZoneSearch',
    'locPickZoneSearchPanel', 'locPickZoneMatch']) {
    const el = document.getElementById(id);
    if (!el || !el.offsetParent) continue;
    const r = el.getBoundingClientRect();
    taken.push({ x0: r.left - cv.left, y0: r.top - cv.top, x1: r.right - cv.left, y1: r.bottom - cv.top });
  }
  const SB = _locPickScaleBar(V, w, h);   // the scale bar with its labels
  if (SB) taken.push({ x0: SB.x0 - 4, y0: SB.y0 - 14, x1: SB.x0 + SB.px + 30, y1: SB.y1 + 2 });
  if (_locPick.ecl && typeof _eclMapGet === 'function') {   // the Eclipse map's legend
    const M = _eclMapGet(_eclipseActiveEvent.id);
    if (M) { const L = _eclMapLegendLayout(ctx, M, _eclipseActiveEvent, h); taken.push({ x0: L.x0, y0: L.y0, x1: L.x0 + L.W, y1: L.y0 + L.H }); }
  }
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const placed = new Set();   // the values labelled
  // Time: every tag as wide as the widest time, so that the places do not change with the minute
  const ms = _locPickZoneTimeMs(), timeW = ms === null ? 0 : ctx.measureText('00:00').width + 8;
  const ph = ms === null ? 0 : _locPickPinOffset(_tzGrid.data, _tzModeOffsets(_tzGrid.data));   // once for all the labels
  for (const l of _locPick.zoneLabels) {
    l.time = l.bg = null;
    if (l.small && (placed.has(l.text) || Math.hypot(l.x - V.cx, l.y - V.cy) > LOC_PICK_ZONE_LABEL_LIMB * V.R)) continue;
    const tw = ms === null ? ctx.measureText(l.text).width + 6 : timeW;
    let b = null, x = l.x, y = l.y;
    for (const [dx, dy] of l.small ? [[0, 0], [0, -12], [0, 12], [-tw / 2 - 6, 0], [tw / 2 + 6, 0]] : [[0, 0]]) {
      const c = { x0: l.x + dx - tw / 2, y0: l.y + dy - 7, x1: l.x + dx + tw / 2, y1: l.y + dy + 7 };
      if (free(c)) { b = c; x = l.x + dx; y = l.y + dy; break; }
    }
    if (!b) continue;
    taken.push(b);
    placed.add(l.text);
    if (ms !== null) {
      const T = _locPickZoneTimeAt(l.h, ms, ph);
      l.time = T.text; l.bg = LOC_PICK_ZONE_DAY_RGB[T.day];
      ctx.fillStyle = l.bg;
      ctx.fillRect(b.x0, b.y0, tw, 14);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(T.text, x, y + 0.5);
      continue;
    }
    ctx.fillStyle = 'rgba(7,9,13,0.72)';
    ctx.fillRect(b.x0, b.y0, tw, 14);
    ctx.fillStyle = '#e8eef4';
    ctx.fillText(l.text, x, y + 0.5);
  }
}
// ─── Zones | Cities ──────────────────────────────────────────────────────────────────────────────
// The labels as tags next to the places (render-locpick-cities.js, owner 'zones'): with the window open
// (SELECT or the Eclipse map, its time the slider's), the labels part on and Cities chosen
// (_locPickZoneCitiesOn); the places off again as before when the window closes. A place's offset is that of the disc's pixel
// under it (_locPickZoneOffsetAt; the lookup where there is none), the Location's that of its pin;
// in Time the local time on its day's colour in white (as the areas' labels), in Zone the offset on
// the zone's colour (_locPickZoneRGB), the text by the places' rule. While the places are off (or
// their data not in) the labels go in the areas as in Zones.
const LOC_PICK_ZONE_WHITE = [255, 255, 255];
const LOC_PICK_ZONE_SPOT_STEP_PX = 8;   // a spot's other tries: the area's pixels on this grid (a small area's all), nearest its label first
const LOC_PICK_ZONE_EDGE_PX = 12;   // a small area's label this close to the canvas's edge (or under a control): cut off, as by the limb
const LOC_PICK_ZONE_AREA_GAP_PX = 260;   // Cities: a place's tag this far from the tags of its area given before it
// The area (the Zones labels' component, _locPick.veilSrc.ci) of the disc's pixel under canvas point
// (x, y), -1 for none. While the globe moves (no components then) the pixel's offset stands in, as
// an id of its own range: all the areas of one offset count as one until the globe rests.
const LOC_PICK_ZONE_AREA_MOVING = 1 << 24;
function _locPickZoneArea(x, y) {
  const S = _locPick.veilSrc;
  if (!S || !(S.ci || S.oi)) return -1;
  const i = Math.floor((x - S.x0) * S.q), j = Math.floor((y - S.y0) * S.q);
  if (i < 0 || j < 0 || i >= S.sw || j >= S.sh) return -1;
  if (S.ci) return S.ci[j * S.sw + i];
  const k = S.oi[j * S.sw + i];
  return k === 255 ? -1 : LOC_PICK_ZONE_AREA_MOVING + k;
}
function _locPickZoneCitiesOn() {
  return _locPick.open && _locPick.zones && _locPick.zoneParts.labels && _locPick.zonePlace === 'cities';
}
function _locPickZoneCitiesSync() {
  _locPickCitySync('zones', _locPickZoneCitiesOn());
}
// The tag of offset h this frame (_locPickZoneCity.frame)
function _locPickZoneTag(h) {
  const T = _locPickZoneCity;
  if (T.ms === null) return { text: _locPickOffsetText(h), rgb: _locPickZoneRGB(h).map(Math.round), textRgb: null };
  const t = _locPickZoneTimeAt(h, T.ms, T.ph), c = LOC_PICK_ZONE_DAY_RGB[t.day];
  return { text: t.text, rgb: [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)), textRgb: LOC_PICK_ZONE_WHITE };
}
const _locPickZoneCity = _locPickCityOwners.zones = {
  G: null, offs: null, ms: null, ph: 0,
  // the frame's offsets, moment (null in Zone) and the pin's offset; none without the zones' data
  frame() {
    const T = _locPickZoneCity, G = typeof _tzGrid !== 'undefined' ? _tzGrid.data : null;
    if (!G || !_locPickZoneCitiesOn()) return false;
    T.G = G; T.offs = _tzModeOffsets(G); T.ms = _locPickZoneTimeMs(); T.ph = _locPickPinOffset(G, T.offs);
    return true;
  },
  // a place's row drawn at (x, y), or the Location's { lat, lon }
  value(p, x, y) {
    const T = _locPickZoneCity;
    if (!Array.isArray(p)) return _locPickZoneTag(T.ph);
    const h = _locPickZoneOffsetAt(x, y);
    return _locPickZoneTag(h === null ? _locPickZoneOffsetLL(T.G, T.offs, p[2], p[3]) : h);
  },
  // the area of a tag at (x, y) and the gap between the tags of one area (the hook's thinning)
  area: _locPickZoneArea, areaGap: LOC_PICK_ZONE_AREA_GAP_PX,
  cover(out, rows, put, claim) { _locPickZoneCover(out, rows, put, claim); },
  // the Cities toggle's title: a hint while the places are off in Cities
  title() {
    const b = document.querySelector('#locPickZonePlace [data-place="cities"]');
    if (!b) return;
    const off = _locPick.zonePlace === 'cities' && typeof _locPlaces !== 'undefined' && !_locPlaces.on;
    const t = off ? 'Next to the places (turn the places on)' : 'Next to the places';
    if (b.title !== t) b.title = t;
  },
};
// The coverage, once the places have their tags (at rest, with the areas of the Zones labels): each
// area that would have a Zones label (a large one; a small one only for an offset no tag shows yet
// and not by the limb, the canvas's edge, under the window's controls or the Eclipse map's legend)
// and holds no tag (a place's or the Location's pin) gets one, at its most important place drawn
// whose tag is clear of the rest (below the gap too), else at its label's spot (_locPickZoneSpot)
// when free. A small area that gets
// none counts its offset as tried (no other small area of it this frame). The areas that got none
// are not tried again while the disc, the controls, the tags placed before them and the
// Location's tag stay as they were (_locPickZoneCoverMiss), so a running moment costs little.
let _locPickZoneCoverMiss = { key: null, c: new Set() };
function _locPickZoneCover(out, rows, put, claim) {
  const S = _locPick.veilSrc, L = _locPick.zoneLabels;
  if (!S || !S.ci || !L.length) return;
  const cv = document.getElementById('locPickCanvas'), ctx = cv.getContext('2d'), w = cv.clientWidth, h = cv.clientHeight, V = _locPickView(w, h);
  const blocked = _locPlacesKeepClear(cv), e = LOC_PICK_ZONE_EDGE_PX;
  const EL = _locPick.ecl && typeof _eclMapLegendBox !== 'undefined' ? _eclMapLegendBox : null;   // drawn just before (render-eclipse-map.js)
  if (EL) blocked.push(EL);
  const cut = (l) => Math.hypot(l.x - V.cx, l.y - V.cy) > LOC_PICK_ZONE_LABEL_LIMB * V.R || l.x < e || l.y < e || l.x > w - e || l.y > h - e
    || blocked.some(b => l.x >= b.x0 && l.x <= b.x1 && l.y >= b.y0 && l.y <= b.y1);
  const area = _locPickZoneArea;
  const byC = new Map(L.map(l => [l.c, l])), done = new Set(), hs = new Set();
  const mark = (c) => { if (c < 0) return; done.add(c); const l = byC.get(c); if (l) hs.add(l.h); };
  const where = out.map(p => area(p.x, p.y));
  out.forEach((p, i) => { if (p.tag) mark(where[i]); });
  const H = _locPickCityHere;
  if (H) mark(area(H.x, H.y));
  const r = (v) => Math.round(v), boxKey = (b) => r(b.x0) + ',' + r(b.y0) + ',' + r(b.x1) + ',' + r(b.y1);
  const key = [S.gen, w, h, blocked.map(boxKey).join(';'), H ? boxKey(H.box) : '',
    out.map(p => p.tag ? p.tag.text.length : '').join(',')].join('|');
  const M = _locPickZoneCoverMiss;
  if (M.key !== key) { M.key = key; M.c = new Set(); }
  for (const l of L) {   // the large first, then the small ones
    if (done.has(l.c) || M.c.has(l.c)) continue;
    if (l.small && (hs.has(l.h) || cut(l))) continue;
    const tag = _locPickZoneTag(l.h);
    let ok = false;
    for (let i = 0; i < out.length && !ok; i++) {
      if (where[i] !== l.c || out[i].tag) continue;
      ok = put(i, Object.assign({}, tag, { x: out[i].x, y: out[i].y, cover: true }));
    }
    if (!ok) ok = _locPickZoneSpot(ctx, S, l, tag, claim);
    if (ok) mark(l.c);
    else { M.c.add(l.c); if (l.small) hs.add(l.h); }
  }
}
// A tag of its own for area l, always anchored inside it: at its label's spot, else just above, below
// or beside it (as the Zones labels) where that is still in the area, else at the area's pixel nearest
// it that is free (the spot under a legend or a name), looked for within the area's box. False when
// nothing inside is free (a sliver too small for the tag, or an area full of names): the area then
// goes without a tag.
function _locPickZoneSpot(ctx, S, l, tag, claim) {
  const pw = _locPlacesWidth(ctx, LOC_PICK_CITY_TAG_FONT, tag.text) + 2 * LOC_PLACES_TAG_PAD;
  const at = [[l.x, l.y], [l.x, l.y - 12], [l.x, l.y + 12], [l.x - pw / 2 - 6, l.y], [l.x + pw / 2 + 6, l.y]];
  const tryAt = (x, y) => {
    const i = Math.floor((x - S.x0) * S.q), j = Math.floor((y - S.y0) * S.q), x0 = x - pw / 2;
    if (i < 0 || j < 0 || i >= S.sw || j >= S.sh || S.ci[j * S.sw + i] !== l.c) return false;
    if (!claim({ x0: x0 - 2, y0: y - 8, x1: x0 + pw + 2, y1: y + 8 })) return false;
    _locPickCitySpots.push({ tag: Object.assign({}, tag, { x, y }), x, y, x0, area: l.c });
    return true;
  };
  for (const [x, y] of at) if (tryAt(x, y)) return true;
  const st = l.small ? 1 : Math.max(1, Math.round(LOC_PICK_ZONE_SPOT_STEP_PX * S.q)), more = [];
  for (let j = l.j0 + (st >> 1); j <= l.j1; j += st) for (let i = l.i0 + (st >> 1); i <= l.i1; i += st) {
    if (S.ci[j * S.sw + i] !== l.c) continue;
    const x = S.x0 + (i + 0.5) / S.q, y = S.y0 + (j + 0.5) / S.q;
    more.push([(x - l.x) * (x - l.x) + (y - l.y) * (y - l.y), x, y]);
  }
  more.sort((a, b) => a[0] - b[0]);
  for (const m of more) if (tryAt(m[1], m[2])) return true;
  return false;
}
// The same date's state: the moment (_tzDateInstant), the day under the Location's pin, and a
// signature of the day of every offset in use (the zones' and the nautical ones) relative to it,
// which changes only when one of them passes midnight. Without the part or the moment, nulls and ''.
function _locPickDays(G) {
  const offs = _tzModeOffsets(G);
  const dateMs = _locPick.zoneParts.sameDate ? _tzDateInstant() : null;
  if (dateMs === null) return { dateMs: null, pinDay: null, sig: '' };
  const pinDay = _tzDayAt(dateMs, _locPickPinOffset(G, offs));
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
// Daylight saving time (the legend's row, off at first): over every zone that uses it, a pattern of
// signs saying what its clock does at the mode's moment (_tzDateInstant): + moved ahead of its
// standard time, 0 on its standard time; in Solargraph (no moment) ± over the zones that use it this
// year. A zone's standard time is its lowest offset over the moment's year (by the clock, not by
// law: Dublin as London, Morocco + but in Ramadan), and it uses DST when its offset is not the same
// all year: sampled on the 1st and the 15th of each month and on 31 Dec at 12:00 UT, each change
// between two samples then found to the minute, once per year (_locPickZoneDstYear, ~55 ms for all
// the zones). The state at a moment is then looked up without Intl, so the watcher (_locPickWatch)
// follows it on every frame (not in Solargraph: no moment). The signs are a layer over the disc as
// the veil is (_locPickDrawZoneDst): per state a layer of signs on a grid steady on the screen (kept
// per canvas size, not per disc), cut by a mask of that state's zones redone per disc and states,
// so a drag (a new coarse disc per frame) redoes only the masks and the cut.
const LOC_PICK_ZONE_DST_CELL = 16;                       // the grid's cell [CSS px], two signs in each
const LOC_PICK_ZONE_DST_AT = [[4, 4], [12, 12]];         // the signs' centres in a cell [CSS px]
const LOC_PICK_ZONE_DST_SCALE = 0.7;                     // the signs' size against the shapes below
// The signs are drawn as shapes, not type: rounded strokes (scaled by LOC_PICK_ZONE_DST_SCALE), each a
// dark outline (a wider stroke) under the coloured one, so they read over the zones and the hatching.
// The + a cross of two bars, the 0 an upright oval, the ± a short cross over a bar.
const LOC_PICK_ZONE_DST_SIGNS = [                        // by state code 1 .. 3
  null,
  { text: '+', stroke: '#FAC775', width: 2.2, outline: 4.4,
    path: (L) => { L.moveTo(0, -4.5); L.lineTo(0, 4.5); L.moveTo(-4.5, 0); L.lineTo(4.5, 0); } },
  { text: '0', stroke: 'rgba(255,255,255,0.9)', width: 2, outline: 4.2,
    path: (L) => { L.moveTo(3, 0); L.ellipse(0, 0, 3, 4.2, 0, 0, Math.PI * 2); } },   // moveTo first: no line from the previous oval
  { text: '±', stroke: 'rgba(255,255,255,0.9)', width: 1.8, outline: 4,
    path: (L) => { L.moveTo(0, -6); L.lineTo(0, 0); L.moveTo(-3.5, -3); L.lineTo(3.5, -3); L.moveTo(-3.5, 4); L.lineTo(3.5, 4); } },
];
const LOC_PICK_ZONE_DST_OUTLINE = { color: '#1a1a1a' };
const _locPickZoneDstYears = new Map();
let _locPickZoneDstLast = { key: null, St: null };
// A zone's year y: null without DST (or unknown to the browser), else { std (its lowest offset),
// seg: [[from ms, offset], ...] } (the first from -Infinity)
function _locPickZoneDstZone(zone, y) {
  const ts = [];
  for (let m = 0; m < 12; m++) ts.push(Date.UTC(y, m, 1, 12), Date.UTC(y, m, 15, 12));
  ts.push(Date.UTC(y, 11, 31, 12));   // a change in the year's last fortnight
  const hs = ts.map(t => _tzOffsetAt(zone, t));
  if (hs[0] === null) return null;
  const lo = Math.min(...hs);
  if (lo === Math.max(...hs)) return null;
  const seg = [[-Infinity, hs[0]]];
  for (let k = 1; k < ts.length; k++) {
    let a = ts[k - 1], ha = hs[k - 1];
    while (ha !== hs[k]) {   // the first minute after a with another offset (more than one change: each)
      let hi = ts[k];
      while (hi - a > 60000) {
        const mid = a + Math.floor((hi - a) / 120000) * 60000;
        if (_tzOffsetAt(zone, mid) === ha) a = mid; else hi = mid;
      }
      ha = _tzOffsetAt(zone, hi); a = hi;
      seg.push([hi, ha]);
    }
  }
  return { std: Math.min(lo, ...seg.map(s => s[1])), seg };
}
// The year y per zone index (as _tzIndexAt, the grid's zones), cached
function _locPickZoneDstYear(y) {
  let T = _locPickZoneDstYears.get(y);
  if (!T) {
    T = [null].concat(_tzGrid.data.zones.map(z => _locPickZoneDstZone(z, y)));
    _locPickZoneDstYears.set(y, T);
  }
  return T;
}
// A zone's sign at the instant ms (null: Solargraph, the current year): code 0 none, 1 +, 2 0, 3 ±
function _locPickZoneDstCode(Z, ms) {
  if (!Z) return 0;
  if (ms === null) return 3;
  let h = Z.seg[0][1];
  for (let k = 1; k < Z.seg.length && Z.seg[k][0] <= ms; k++) h = Z.seg[k][1];
  return h > Z.std ? 1 : 2;
}
// Every zone's state at the instant ms (null: Solargraph, the current year): codes per zone index,
// 0 none, 1 +, 2 0, 3 ±; sig changes only with a state
function _locPickZoneDstStates(ms) {
  const y = ms === null ? new Date().getUTCFullYear() : new Date(ms).getUTCFullYear();
  const key = ms === null ? 'y' + y : ms;
  if (_locPickZoneDstLast.key === key) return _locPickZoneDstLast.St;
  const T = _locPickZoneDstYear(y), codes = new Uint8Array(T.length);
  for (let s = 1; s < T.length; s++) codes[s] = _locPickZoneDstCode(T[s], ms);
  const St = { codes, sig: codes.join('') };
  _locPickZoneDstLast = { key, St };
  return St;
}
// One zone's sign at the instant ms by its name, also a zone the grid has merged into another
// (Europe/Dublin into London): '+', '0', '±' or '' (none, or unknown)
function _locPickZoneDstState(zone, ms) {
  const y = ms === null ? new Date().getUTCFullYear() : new Date(ms).getUTCFullYear(), s = _tzGrid.data.zones.indexOf(zone) + 1;
  const Z = s ? _locPickZoneDstYear(y)[s] : _locPickZoneDstZone(zone, y), c = _locPickZoneDstCode(Z, ms);
  return c ? LOC_PICK_ZONE_DST_SIGNS[c].text : '';
}
// The signs' layer over the disc (after the veil and the search's dim), at the canvas' resolution.
// Kept in _locPick.dst: glyphs[t] the signs of state t over the whole canvas (key gkey), masks[t]
// the zones of state t at the disc's buffer resolution, work the cut, cv the result (key).
function _locPickDrawZoneDst(ctx, V, w, h, res) {
  const S = _locPick.veilSrc;
  if (!_locPick.zoneParts.dst) { _locPick.dstSig = ''; return; }
  const St = _locPickZoneDstStates(_tzDateInstant());
  _locPick.dstSig = St.sig;
  if (!S) return;
  const lt = document.body.classList.contains('light'), W = Math.round(w * res), H = Math.round(h * res);
  const key = [S.gen, St.sig, w, h, res, lt].join('|'), gkey = [w, h, res, lt].join('|');
  const mk = () => document.createElement('canvas');
  const D = _locPick.dst || (_locPick.dst = { cv: mk(), work: mk(), glyphs: [null, null, null, null], masks: [null, null, null, null], key: null, gkey: null, codes: null });
  if (D.key !== key) {
    if (D.gkey !== gkey) { for (let t = 1; t <= 3; t++) if (D.glyphs[t]) D.glyphs[t].width = D.glyphs[t].height = 0; D.glyphs = [null, null, null, null]; D.gkey = gkey; }
    // per pixel of the disc's buffer its zone's state (0 at sea, off the disc, or without DST)
    const n = S.zi.length, seen = [0, 0, 0, 0], imgs = [null, null, null, null];
    for (let i = 0; i < n; i++) {
      if (S.oi[i] === 255) continue;
      const t = St.codes[S.zi[i]];
      if (!t) continue;
      if (!imgs[t]) imgs[t] = new ImageData(S.sw, S.sh);
      imgs[t].data[i * 4 + 3] = 255; seen[t]++;
    }
    if (D.cv.width !== W || D.cv.height !== H) { D.cv.width = W; D.cv.height = H; } else D.cv.getContext('2d').clearRect(0, 0, W, H);
    if (D.work.width !== W || D.work.height !== H) { D.work.width = W; D.work.height = H; }
    const c = D.cv.getContext('2d'), K = D.work.getContext('2d');
    for (let t = 1; t <= 3; t++) {
      if (!seen[t]) continue;
      const M = D.masks[t] || (D.masks[t] = mk());
      if (M.width !== S.sw || M.height !== S.sh) { M.width = S.sw; M.height = S.sh; }
      M.getContext('2d').putImageData(imgs[t], 0, 0);
      // the cut: the mask scaled up (smoothed), the signs kept where it is
      K.setTransform(1, 0, 0, 1, 0, 0); K.globalCompositeOperation = 'source-over'; K.clearRect(0, 0, W, H);
      K.setTransform(res, 0, 0, res, 0, 0); K.imageSmoothingEnabled = true;
      K.drawImage(M, S.x0, S.y0, S.sw / S.q, S.sh / S.q);
      K.setTransform(1, 0, 0, 1, 0, 0); K.globalCompositeOperation = 'source-in';
      K.drawImage(D.glyphs[t] || (D.glyphs[t] = _locPickZoneDstGlyphs(t, w, h, res)), 0, 0);
      K.globalCompositeOperation = 'source-over';
      c.drawImage(D.work, 0, 0);
    }
    D.key = key; D.codes = St.codes;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath(); ctx.arc(V.cx * res, V.cy * res, V.R * res, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(D.cv, 0, 0);
  ctx.restore();
}
// The signs of state t over the whole canvas (w x h CSS px at res), on the grid from its corner
function _locPickZoneDstGlyphs(t, w, h, res) {
  const G = LOC_PICK_ZONE_DST_SIGNS[t], cv = document.createElement('canvas');
  cv.width = Math.round(w * res); cv.height = Math.round(h * res);
  const L = cv.getContext('2d');
  L.setTransform(res, 0, 0, res, 0, 0);
  L.lineCap = 'round'; L.lineJoin = 'round';
  const cs = LOC_PICK_ZONE_DST_CELL;
  for (const [style, width] of [[LOC_PICK_ZONE_DST_OUTLINE.color, G.outline], [G.stroke, G.width]]) {
    L.beginPath();
    for (let y0 = 0; y0 < h + cs; y0 += cs) for (let x0 = 0; x0 < w + cs; x0 += cs)
      for (const [dx, dy] of LOC_PICK_ZONE_DST_AT) {
        L.save(); L.translate(x0 + dx, y0 + dy); L.scale(LOC_PICK_ZONE_DST_SCALE, LOC_PICK_ZONE_DST_SCALE); G.path(L); L.restore();
      }
    L.strokeStyle = style; L.lineWidth = width * LOC_PICK_ZONE_DST_SCALE; L.stroke();
  }
  return cv;
}
// The signs' canvases freed (the row switched off, the window closed)
function _locPickZoneDstRelease() {
  const D = _locPick.dst;
  if (D) for (const cv of [D.cv, D.work, ...D.glyphs, ...D.masks]) if (cv) cv.width = cv.height = 0;
  _locPick.dst = null; _locPick.dstSig = '';
}
// The animations and sliders change the moment without asking the globe to redraw: while the same
// date shows, a look on every frame of the browser whether a zone has passed midnight (or the
// moment has come or gone), and the globe redrawn in that same frame. On the frames, not a timer:
// under a heavy animation (the Planetarium drawn per pixel) the browser holds timers back more and
// more, frames it does not. The look itself is ~0.01 ms; the loop stops when the part is off.
// The Time labels the same way: a new minute of the moment redrawn (the same disc and layout, only
// the tags' texts and colours) at most every LOC_PICK_ZONE_TIME_REDRAW_MS while the moment runs, and
// at once when it has held its minute that long, so the last one always shows.
// The DST signs the same way: a zone's state changed at the moment redrawn in that frame (not in
// Solargraph, which has no moment).
let _locPickWatchRaf = 0, _locPickWatchMinute = null, _locPickWatchMinuteAt = 0;
function _locPickWatchOn() {
  return _locPick.open && _locPick.zones && (_locPick.zoneParts.sameDate || (_locPick.zoneParts.dst && _tzDateInstant() !== null) || _locPickZoneTimeMs() !== null)
    && typeof _tzGrid !== 'undefined' && !!_tzGrid.data;
}
function _locPickWatch() {
  _locPickWatchRaf = 0;
  if (!_locPickWatchOn()) return;
  let draw = _locPick.zoneParts.sameDate && _locPickDays(_tzGrid.data).sig !== _locPick.daySig;
  if (!draw && _locPick.zoneParts.dst && _tzDateInstant() !== null) draw = _locPickZoneDstStates(_tzDateInstant()).sig !== _locPick.dstSig;
  const ms = _locPickZoneTimeMs(), m = ms === null ? null : Math.floor(ms / 60000);
  if (!draw && m !== _locPick.zoneMinute) {
    const now = performance.now();
    if (m !== _locPickWatchMinute) { _locPickWatchMinute = m; _locPickWatchMinuteAt = now; }
    draw = now - _locPick.zoneTimeDrawn >= LOC_PICK_ZONE_TIME_REDRAW_MS || now - _locPickWatchMinuteAt >= LOC_PICK_ZONE_TIME_REDRAW_MS;
  }
  if (draw) _locPickDraw();   // starts the next look itself
  if (!_locPickWatchRaf) _locPickWatchRaf = requestAnimationFrame(_locPickWatch);
}
// The bottom of the window's head (it wraps in a narrow window) on the canvas [CSS px]: the Eclipse
// map's legend goes under it (render-eclipse-map.js)
function _locPickHeadBottom() {
  const head = document.querySelector('.loc-pick-head'), cv = document.getElementById('locPickCanvas');
  return head.getBoundingClientRect().bottom - cv.getBoundingClientRect().top;
}
// The bottom of the head's own text (title and hint, however they wrap), without the labels under
// it, relative to the canvas: the Eclipse map's legend goes right under it
function _locPickHeadTextBottom() {
  const cv = document.getElementById('locPickCanvas').getBoundingClientRect();
  return Math.max(document.getElementById('locPickTitle').getBoundingClientRect().bottom,
    document.getElementById('locPickHint').getBoundingClientRect().bottom) - cv.top;
}
// On the Eclipse map the labels under the head (#locPickInfo: time zone, Bortle) go under the map's
// legend (render-eclipse-map.js, _eclMapLegendBox); elsewhere right under the head's text
function _locPickInfoPlace() {
  const info = document.getElementById('locPickInfo');
  let m = '';
  if (_locPick.ecl && typeof _eclMapLegendBox !== 'undefined' && _eclMapLegendBox) {
    m = Math.max(5, Math.round(_eclMapLegendBox.y1 + 6 - _locPickHeadTextBottom())) + 'px';
  }
  if (info.style.marginTop !== m) info.style.marginTop = m;
}
// The light pollution (#btnLocPickLightPollution, off at first, only in SELECT; it, the time
// zones and Daylight switch each other off): the zenith brightness (lp-lookup.js) as its Bortle class in the
// colours of Display's Bortle scale, laid over land and sea at 0.55 where there are data. The
// coarse grid (0.1°) while a buffer pixel spans 0.1° or more, closer in the tiles (1/40°) that
// have come in (the others asked for, the coarse grid meanwhile).
const LOC_PICK_LP_ALPHA = 0.55;
const LOC_PICK_LP_RGB = [[0, 0, 0], [110, 110, 110], [28, 47, 122], [47, 111, 214], [58, 168, 69],
  [232, 210, 58], [240, 138, 36], [217, 48, 48], [255, 255, 255]];
function _locPickLpColor(sqm) {
  return LOC_PICK_LP_RGB[_nightSkySQMToBortle(sqm) - 1];
}
// The layer is a gradient between the class colours, not steps: each class's colour at the middle of
// its range (NIGHTSKY_BORTLE_EDGE; the open ends 0.1 above class 1's edge and 0.3 below class 9's),
// linear between two middles. A table per stored value (16.0 + 0.05 v, 255 of them) of the colour and
// the class, made once (_locPickLpLut); the globe looks a pixel's value up in it. Zoomed in, where a
// cell of the tiles spans more than LOC_PICK_LP_SMOOTH_PX pixels of the disc, the value is blended
// between the four nearest cells (_lpValueSmooth) before the look-up, so the cells do not show.
const LOC_PICK_LP_SMOOTH_PX = 2;
const LOC_PICK_LP_TILE_PX = 3;   // the tiles once a coarse cell (0.1°) spans more buffer pixels than this
let _locPickLpTable = null;
function _locPickLpGradRaw(sqm) {
  const E = NIGHTSKY_BORTLE_EDGE, C = [E[0] + 0.1];
  for (let i = 0; i + 1 < E.length; i++) C.push((E[i] + E[i + 1]) / 2);
  C.push(E[E.length - 1] - 0.3);
  if (sqm >= C[0]) return LOC_PICK_LP_RGB[0].slice();
  for (let i = 0; i + 1 < C.length; i++) {
    if (sqm <= C[i] && sqm >= C[i + 1]) {
      const f = (C[i] - sqm) / (C[i] - C[i + 1]), a = LOC_PICK_LP_RGB[i], b = LOC_PICK_LP_RGB[i + 1];
      return a.map((v, k) => v + (b[k] - v) * f);
    }
  }
  return LOC_PICK_LP_RGB[8].slice();
}
function _locPickLpLut() {
  if (_locPickLpTable) return _locPickLpTable;
  const rgb = new Float32Array(255 * 3), cls = new Uint8Array(255);
  for (let b = 0; b < 255; b++) {
    const s = LP_Q_MIN + b * LP_Q_STEP, c = _locPickLpGradRaw(s);
    rgb[3 * b] = c[0]; rgb[3 * b + 1] = c[1]; rgb[3 * b + 2] = c[2];
    cls[b] = _nightSkySQMToBortle(s);
  }
  return (_locPickLpTable = { rgb, cls });
}
function _locPickLpIndex(sqm) { return Math.max(0, Math.min(254, Math.round((sqm - LP_Q_MIN) / LP_Q_STEP))); }
function _locPickLpGrad(sqm) { const T = _locPickLpLut(), b = _locPickLpIndex(sqm); return [T.rgb[3 * b], T.rgb[3 * b + 1], T.rgb[3 * b + 2]]; }
function _locPickLpClass(sqm) { return _locPickLpLut().cls[_locPickLpIndex(sqm)]; }
// The class shown alone (the one pointed at, else the one picked), null for all
function _locPickLpHiClass() {
  return _locPick.lpHi.hover ?? _locPick.lpHi.pin;
}
// The other classes (and the Earth off the data) dimmed as the time zones search's (62 % toward
// dark), a layer over the disc from the class it keeps per pixel (_locPick.lpSrc), and the picked
// class hatched (_locPickPickHatchOver, its mask from the same pass): a new class redraws only these
// layers (a few ms), not the disc
function _locPickDrawLpHi(ctx, V) {
  const S = _locPick.lpSrc, c = _locPickLpHiClass();
  if (!S || !c) return;
  const H = _locPick.lpHiVeil || (_locPick.lpHiVeil = { cv: document.createElement('canvas'), mask: document.createElement('canvas'), gen: -1, c: 0 });
  if (H.gen !== S.gen || H.c !== c) {
    H.cv.width = H.mask.width = S.sw; H.cv.height = H.mask.height = S.sh;
    const img = new ImageData(S.sw, S.sh), px = img.data, a = Math.round(LOC_PICK_ZONE_DIM * 255);
    const mi = new ImageData(S.sw, S.sh), mp = mi.data;
    for (let n = 0; n < S.cls.length; n++) {
      const k = S.cls[n];
      if (k === 255) continue;
      if (k === c) { mp[n * 4 + 3] = 255; continue; }
      const o = n * 4; px[o] = 6; px[o + 1] = 8; px[o + 2] = 12; px[o + 3] = a;
    }
    H.cv.getContext('2d').putImageData(img, 0, 0);
    H.mask.getContext('2d').putImageData(mi, 0, 0);
    H.gen = S.gen; H.c = c;
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(H.cv, S.x0, S.y0, S.sw / S.q, S.sh / S.q);
  _locPickPickHatchOver(ctx, H.mask, S.x0, S.y0, S.sw / S.q, S.sh / S.q, 'lp');
  ctx.restore();
}
// ─── The hatching over an area picked in a legend ────────────────────────────────────────────────
// Over the area a picked legend cell keeps (the Daylight bands, a Bortle class; the rest dimmed): thin
// diagonal lines (x + y steady), LOC_PICK_PICK_HATCH_PX apart along a row and 1 CSS px wide, light on
// the dark theme and dark on the light one (LOC_PICK_PICK_HATCH_ALPHA), crisp on the screen's pixels
// and anchored to the canvas, so that they stay as the globe turns or zooms
const LOC_PICK_PICK_HATCH_PX = 7;
const LOC_PICK_PICK_HATCH_ALPHA = { dark: 0.35, light: 0.3 };   // white on the dark theme, black on the light one
let _locPickPickHatchTile = null;   // { key, t }: the pattern's tile in device pixels
const _locPickPickHatchOff = {};    // slot ('dl', 'lp') -> the canvas its mask is hatched on (_locPickPickHatchOver)
// The hatching's canvases let go (0 x 0, dropped): slot's, or all with the tile when none is given
function _locPickPickHatchRelease(slot) {
  for (const k of slot ? [slot] : Object.keys(_locPickPickHatchOff)) {
    const c = _locPickPickHatchOff[k];
    if (c) c.width = c.height = 0;
    delete _locPickPickHatchOff[k];
  }
  if (!slot) _locPickPickHatchTile = null;
}
// The pattern for ctx (its transform the canvas's res scale): the tile's device pixels on the canvas's
// own (anchored at its origin)
function _locPickPickHatch(ctx, res) {
  const lt = document.body.classList.contains('light'), key = res + '|' + lt;
  if (!_locPickPickHatchTile || _locPickPickHatchTile.key !== key) {
    const p = Math.max(3, Math.round(LOC_PICK_PICK_HATCH_PX * res)), lw = Math.max(1, Math.round(res));
    const t = document.createElement('canvas');
    t.width = t.height = p;
    const c = t.getContext('2d'), img = c.createImageData(p, p), px = img.data;
    const v = lt ? 0 : 255, a = Math.round(255 * (lt ? LOC_PICK_PICK_HATCH_ALPHA.light : LOC_PICK_PICK_HATCH_ALPHA.dark));
    for (let j = 0; j < p; j++) for (let i = 0; i < p; i++) {
      if ((i + j) % p >= lw) continue;
      const o = (j * p + i) * 4; px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = a;
    }
    c.putImageData(img, 0, 0);
    _locPickPickHatchTile = { key, t };
  }
  return ctx.createPattern(_locPickPickHatchTile.t, 'repeat');
}
// The hatching over the current clip (ctx in CSS px, its transform the res scale), within the box
function _locPickPickHatchFill(ctx, x0, y0, w, h) {
  const res = ctx.getTransform().a, pat = _locPickPickHatch(ctx, res);
  pat.setTransform(new DOMMatrix().scale(1 / res));
  ctx.save();
  ctx.globalAlpha = 1; ctx.fillStyle = pat;
  ctx.fillRect(x0, y0, w, h);
  ctx.restore();
}
// The hatching where mask (a canvas over the box x0, y0, w, h in CSS px) is opaque: the mask scaled to
// the screen's pixels on slot's own canvas, the pattern kept inside it, laid over ctx
function _locPickPickHatchOver(ctx, mask, x0, y0, w, h, slot) {
  const res = ctx.getTransform().a, cv = ctx.canvas;
  const dx0 = Math.max(0, Math.floor(x0 * res)), dy0 = Math.max(0, Math.floor(y0 * res));
  const dw = Math.min(cv.width, Math.ceil((x0 + w) * res)) - dx0, dh = Math.min(cv.height, Math.ceil((y0 + h) * res)) - dy0;
  if (!(dw > 0 && dh > 0)) return;
  const off = _locPickPickHatchOff[slot] || (_locPickPickHatchOff[slot] = document.createElement('canvas'));
  if (off.width !== dw || off.height !== dh) { off.width = dw; off.height = dh; }
  const o = off.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'copy';
  o.imageSmoothingEnabled = true;
  o.drawImage(mask, x0 * res - dx0, y0 * res - dy0, w * res, h * res);
  o.globalCompositeOperation = 'source-in';
  const pat = _locPickPickHatch(o, res);
  pat.setTransform(new DOMMatrix().translate(-dx0, -dy0));
  o.fillStyle = pat; o.fillRect(0, 0, dw, dh);
  o.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(off, dx0, dy0);
  ctx.restore();
}
// The class's layers let go (the light pollution off, the window closed): 0 x 0 and dropped
function _locPickLpHiRelease() {
  const H = _locPick.lpHiVeil;
  if (H) { H.cv.width = H.cv.height = H.mask.width = H.mask.height = 0; }
  _locPick.lpHiVeil = null;
  _locPickPickHatchRelease('lp');
}
function _locPickLpOn() {
  return _locPick.lp && !_locPick.ecl && typeof _lp !== 'undefined' && !!_lp.coarse;
}
// The disc's buffer: its corner and size on the screen and q buffer pixels per CSS pixel
// (LOC_PICK_MAX_PX at rest, LOC_PICK_MAX_PX_MOVING while moving)
function _locPickBuffer(w, h, res, V) {
  const x0 = Math.max(0, V.cx - V.R), y0 = Math.max(0, V.cy - V.R);
  const bw = Math.min(w, V.cx + V.R) - x0, bh = Math.min(h, V.cy + V.R) - y0;
  const q = bw > 0 && bh > 0 ? Math.min(res, Math.sqrt((_locPick.moving ? LOC_PICK_MAX_PX_MOVING : LOC_PICK_MAX_PX) / (bw * bh))) : res;
  return { x0, y0, bw, bh, q };
}
function _locPickDrawEarth(w, h, res, V) {
  const lt = document.body.classList.contains('light');
  // the per-pixel offsets for the zones' layer, and for Daylight's local base (which paints nothing
  // here but keeps each pixel's latitude and longitude too, render-locpick-daylight.js)
  const dlZ = typeof _locPickDlNeedsZones === 'function' && _locPickDlNeedsZones(), paint = _locPick.zones;
  const G = (paint || dlZ) && typeof _tzGrid !== 'undefined' ? _tzGrid.data : null;   // tz-lookup.js
  const offs = G ? _tzModeOffsets(G) : null, P = _locPick.zoneParts;
  // the same date's veil is not in the disc but laid over it (_locPickDrawVeil): the disc keeps
  // per pixel the index of its offset, the veil is redone from it alone when a zone passes midnight
  const list = G ? _locPickOffsetList(offs) : null;
  const { x0, y0, bw, bh, q } = _locPickBuffer(w, h, res, V);
  // the light pollution: the tiles only where a cell of the coarse grid would span more than
  // LOC_PICK_LP_TILE_PX buffer pixels at the centre (blocky); before that the coarse grid is as sharp
  // as the screen, and asking for the tiles would bring in every one in view (some 300 at the
  // whole Earth on a sharp screen). The disc's key with their count only then.
  const lpOn = _locPickLpOn(), lpFine = lpOn && 180 / (Math.PI * V.R * q) < _lp.coarse.step / LOC_PICK_LP_TILE_PX;
  _locPick.lpFine = lpOn ? lpFine : null;
  const key = [w, h, res, _locPick.lon0, _locPick.lat0, _locPick.zoom, lt, !!_nsGlobeTex, _locPick.moving,
    offs ? offs.sig : '', !!_locPick.ecl, G && paint ? [P.dateLine, P.hatch, P.labels].join(',') : '',
    lpOn ? 'lp' + (lpFine ? Object.keys(_lp.tiles).length : '') : '', dlZ ? 'dl' : ''].join('|');
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
  if (_nsGlobeTex && bw > 0 && bh > 0) {
    const sw = Math.max(1, Math.ceil(bw * q)), sh = Math.max(1, Math.ceil(bh * q));
    const img = new ImageData(sw, sh), px = img.data;
    const { w: TW, h: TH, data: T } = _nsGlobeTex;
    const O = NS_GLOBE_OCEAN, Ld = NS_GLOBE_LAND, span = Ld[0] - O[0];
    const share = (x, y) => (T[(y * TW + x) * 4] - O[0]) / span;   // 0 sea .. 1 land
    const texPerPx = TW / (2 * Math.PI) / (q * V.R);   // texture cells per buffer pixel at the centre
    // the time zones: per pixel the zone (land) or the nautical band (sea), and its offset
    const ids = G && paint ? new Int32Array(sw * sh).fill(-1) : null, hs = G && paint ? new Float32Array(sw * sh) : null;
    const la = G && dlZ ? new Float32Array(sw * sh) : null, lo = G && dlZ ? new Float32Array(sw * sh) : null;
    const oi = G ? new Uint8Array(sw * sh).fill(255) : null;   // the offset's index in list, 255 off the disc
    const zi = G ? new Uint16Array(sw * sh) : null;            // the zone's index, 0 at sea (the search's match)
    let ci = null;                                             // the patch's index (_locPickZoneLabels), at rest with the labels
    const zoneA = LOC_PICK_ZONE_ALPHA, eclA = _locPick.ecl ? zoneA.ecl : 1;
    const pitch = Math.max(3, Math.round(LOC_PICK_ZONE_HATCH_PX * q)), stripe = Math.max(1, Math.round(pitch / 3));
    // the light pollution: the coarse grid, or the tiles in a close view (by their 10° cell)
    const LP = lpOn ? _lp.coarse : null, lpTiles = new Map(), lpWant = new Set();
    const lpCls = LP ? new Uint8Array(sw * sh).fill(255) : null;   // per pixel its class, 0 no data, 255 off the disc
    // a 10° cell's number, its buckets shifted to 0 and up so that west and south survive the round trip
    const lpCell = (la, lo) => (la + 9) * 100 + lo + 18;
    if (lpFine) for (const k in _lp.tiles) { const t = _lp.tiles[k]; lpTiles.set(lpCell(Math.round(t.lat0 / 10), Math.round(t.lon0 / 10)), t); }
    const lpA = LOC_PICK_LP_ALPHA, lpT = LP ? _locPickLpLut() : null;
    // close in, a cell of the tiles (1/40°) over LOC_PICK_LP_SMOOTH_PX pixels at the centre: blended between cells
    const lpSmooth = !!LP && lpFine && 0.025 * D2R_LP * V.R * q > LOC_PICK_LP_SMOOTH_PX;
    _locPick.lpMode = LP ? (lpSmooth ? 'smooth' : 'gradient') : null;
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
          oi[j * sw + i] = list.index.get(zh);
          zi[j * sw + i] = s;
          if (la) { la[j * sw + i] = lat; lo[j * sw + i] = lon; }
          if (paint) {
            ids[j * sw + i] = s || 100000 + Math.round(zh * 4);
            hs[j * sw + i] = zh;
            const c = _locPickZoneRGB(zh), al = (zoneA.sea + (zoneA.land - zoneA.sea) * a) * eclA;
            r += (c[0] - r) * al; g += (c[1] - g) * al; b += (c[2] - b) * al;
            if (P.hatch && Math.abs(zh - Math.round(zh)) > 1e-6 && (i + j) % pitch < stripe) { r *= 0.62; g *= 0.62; b *= 0.62; }
          }
        }
        if (LP) {
          let grid = LP;
          if (lpFine) {
            const tk = lpCell(Math.floor(lat / 10), Math.floor(lon / 10)), t = lpTiles.get(tk);
            if (t) grid = t; else lpWant.add(tk);
          }
          const sqm = lpSmooth && grid !== LP ? _lpValueSmooth(grid, lat, lon) : _lpValueAt(grid, lat, lon);
          lpCls[j * sw + i] = 0;
          if (sqm !== null) {
            const bi = sqm <= LP_Q_MIN ? 0 : sqm >= LP_Q_MIN + 254 * LP_Q_STEP ? 254 : Math.round((sqm - LP_Q_MIN) / LP_Q_STEP), t = 3 * bi;
            lpCls[j * sw + i] = lpT.cls[bi];
            r += (lpT.rgb[t] - r) * lpA; g += (lpT.rgb[t + 1] - g) * lpA; b += (lpT.rgb[t + 2] - b) * lpA;
          }
        }
        px[o] = r * k;
        px[o + 1] = g * k;
        px[o + 2] = b * k;
        px[o + 3] = 255;
      }
    }
    // the lines: towards the right and the lower neighbour; not while dragged or pinched, as the
    // buffer is coarse then and smoothed up, which blurs thin lines far more than the fill
    if (G && paint && !_locPick.moving) {
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
      if (P.labels) { const Z = _locPickZoneLabels(ids, hs, sw, sh, q, x0, y0); _locPick.zoneLabels = Z.labels; ci = Z.comp; }
    }
    _locPick.veilSrc = G ? { gen: C.gen, oi, zi, ci, la, lo, list: list.values, sw, sh, x0, y0, q, moving: _locPick.moving } : null;
    _locPick.lpSrc = LP ? { gen: C.gen, cls: lpCls, sw, sh, x0, y0, q } : null;
    // the tiles of the view not yet in: asked for once each (_lpLoad), a redraw as each comes in
    for (const tk of lpWant) {
      const la = Math.floor(tk / 100) - 9, lo = tk % 100 - 18, key = _lpTileKey(la * 10, lo * 10);
      if (_lp.index && _lp.index.tiles.indexOf(key) >= 0 && !_lp.failed[_lpTileFile(key)])
        _lpLoadTile(key).then((t) => { if (t) _locPickRequest(); });
    }
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
  if (typeof _locGlowSync === 'function') _locGlowSync();   // the towns' glow box (render-locpick-glow.js)
  _locPickLegendHere();
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
  if (_locPick.zones && typeof _tzGrid !== 'undefined' && _tzGrid.data) { _locPickDrawVeil(ctx, V); _locPickDrawMatch(ctx, V); _locPickDrawZoneDst(ctx, V, w, h, res); }
  if (_locPickLpOn()) _locPickDrawLpHi(ctx, V);
  if (_locPick.dl && typeof _locPickDlDraw === 'function') _locPickDlDraw(ctx, V, w, h);   // render-locpick-daylight.js
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  _locPickGraticule(ctx, V);
  ctx.restore();
  if (_locPick.zones) {
    const tms = _locPickZoneTimeMs();   // the minute the Time labels show (_locPickWatch)
    _locPick.zoneMinute = tms === null ? null : Math.floor(tms / 60000);
    _locPick.zoneTimeDrawn = performance.now();
    // Cities: the Location's tag here, the places' with the places (render-locplaces.js); the
    // labels in the areas while the places are off or not in
    if (_locPickCityTags.owner === 'zones' && _locPlaces.on && _locPlaces.rows) _locPickCityPlaceHere(ctx, V, w, h);
    else {
      if (_locPickCityTags.owner === 'zones') { _locPickCityHere = null; _locPickCitySpots = []; }
      if (_locPick.zoneParts.labels && _locPick.zoneLabels.length) _locPickDrawZoneLabels(ctx, V, w, h);
    }
    if ((_tzDateInstant() === null) !== _locPick.zoneLegendNone) _locPickZoneLegendSync();   // the moment came or went (Solargraph)
  }
  if (_locPick.dl && typeof _locPickDlDrawLabels === 'function') _locPickDlDrawLabels(ctx, V, w, h);   // over the graticule
  if (_locPick.ecl && typeof _eclMapDraw === 'function') _eclMapDraw(ctx, V, w, h);
  _locPickInfoPlace();
  if (typeof _locPlacesDraw === 'function') _locPlacesDraw(ctx, V, w, h);   // the places (render-locplaces.js)
  const SB = _locPickScaleBar(V, w, h);
  if (SB) _locPickDrawScale(ctx, SB);
  _locPickDrawPin(ctx, V, hemisphere * LAT, lonHemisphere * LONG, '#e84040');   // the Location
  _locPickCityDrawHere(ctx, V, w, h);   // its tag in Cities (Daylight's or the time zones'), the zones' spots (render-locpick-cities.js)
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
  if (!_locPickWatchRaf && _locPickWatchOn()) _locPickWatchRaf = requestAnimationFrame(_locPickWatch);   // the same date and Time follow the time
}
// The scale bar (SELECT only; the Eclipse map has its legend there): bottom left, above the legend
// that shows (time zones', light pollution's or Daylight's); the longest round length (1, 2 or 5 × 10^k km) that
// fits in LOC_PICK_SCALE_MAX_PX, true at the view's centre (the globe is an orthographic view:
// away from the centre distances shrink toward the limb); 4 segments (5 for a 5), black and white.
const LOC_PICK_SCALE_MAX_PX = 120, LOC_PICK_EARTH_KM = 6371;
function _locPickScaleBar(V, w, h) {
  if (_locPick.ecl) return null;
  const pxKm = V.R / LOC_PICK_EARTH_KM, maxKm = LOC_PICK_SCALE_MAX_PX / pxKm;
  const p = Math.pow(10, Math.floor(Math.log10(maxKm))), m = [5, 2, 1].find(f => f * p <= maxKm);
  const km = Number((m * p).toPrecision(3));
  let y1 = h - 12;
  const cv = document.getElementById('locPickCanvas').getBoundingClientRect();
  for (const id of ['locPickZoneLegend', 'locPickLpLegend', 'locPickDlLegend']) {
    const el = document.getElementById(id);
    if (el && el.offsetParent) y1 = Math.min(y1, el.getBoundingClientRect().top - cv.top - 8);
  }
  return { km, px: km * pxKm, segs: m === 5 ? 5 : 4, x0: 12, y0: y1 - 5, y1,
    label: km >= 1 ? km + ' km' : Math.round(km * 1000) + ' m' };
}
// in both themes light text on a dark halo: the globe is dark in both
function _locPickDrawScale(ctx, L) {
  const seg = L.px / L.segs;
  for (let i = 0; i < L.segs; i++) {
    ctx.fillStyle = i % 2 ? '#f2f2f2' : '#111111';
    ctx.fillRect(L.x0 + i * seg, L.y0, seg, L.y1 - L.y0);
  }
  ctx.strokeStyle = 'rgba(230,236,242,0.75)'; ctx.lineWidth = 1;
  ctx.strokeRect(L.x0 + 0.5, L.y0 + 0.5, L.px - 1, L.y1 - L.y0 - 1);
  ctx.font = "10px 'Share Tech Mono', monospace"; ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
  ctx.fillStyle = '#d6dde5';
  ctx.textAlign = 'left'; ctx.fillText('0', L.x0, L.y0 - 2);
  ctx.textAlign = 'center'; ctx.fillText(L.label, L.x0 + L.px, L.y0 - 2);
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
}
// The Bortle scale's legend (bottom left) outlines the class of the Location's sky (the pin), from the
// light pollution map; none off the map or while its tile comes in
function _locPickLegendHere() {
  const sqm = typeof _lpSQMAt === 'function' ? _lpSQMAt(hemisphere * LAT, lonHemisphere * LONG) : null;
  const cls = typeof sqm === 'number' ? _nightSkySQMToBortle(sqm) : 0;
  for (const b of document.querySelectorAll('#locPickLpLegend [data-cls]')) b.classList.toggle('here', Number(b.dataset.cls) === cls);
}
function _locPickRequest() {
  _locPickAltSync();
  if (!_locPick.raf) _locPick.raf = requestAnimationFrame(_locPickDraw);
}
// The height slider and its label follow the zoom (log scale: 0 the whole Earth, 1000 the closest)
function _locPickAltText(km) {
  const v = km >= 1000 ? Math.round(km / 100) * 100 : Math.round(km / 10) * 10;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' km';
}
function _locPickAltSync() {
  const r = document.getElementById('locPickAltRange');
  if (!r) return;
  const v = Math.round(1000 * Math.log(_locPick.zoom / LOC_PICK_ZOOM_MIN) / Math.log(LOC_PICK_ZOOM_MAX / LOC_PICK_ZOOM_MIN));
  if (Number(r.value) !== v) r.value = v;
  const t = _locPickAltText(LOC_PICK_ALT_KM / _locPick.zoom), l = document.getElementById('locPickAltLabel');
  if (l.textContent !== t) l.textContent = t;
}
// The scale beside it: round heights (km), a tick either side level with the thumb's centre there,
// the number on the right; the thumb (14 px) travels the slider's height less its own size
const LOC_PICK_ALT_TICKS = [10000, 5000, 2000, 1000, 500], LOC_PICK_ALT_THUMB = 14;
function _locPickAltThumbY() {   // the thumb's centre from the slider's top (px) at the current value
  const r = document.getElementById('locPickAltRange'), H = r.offsetHeight || 170;
  return LOC_PICK_ALT_THUMB / 2 + Number(r.value) / 1000 * (H - LOC_PICK_ALT_THUMB);
}
function _locPickAltScale() {
  const box = document.querySelector('#locPickAlt .lp-alt-scale'), H = 170;
  for (const km of LOC_PICK_ALT_TICKS) {
    const t = Math.log(LOC_PICK_ALT_KM / km / LOC_PICK_ZOOM_MIN) / Math.log(LOC_PICK_ZOOM_MAX / LOC_PICK_ZOOM_MIN);
    const y = LOC_PICK_ALT_THUMB / 2 + t * (H - LOC_PICK_ALT_THUMB);
    for (const side of ['l', 'r']) {
      const k = document.createElement('span'); k.className = 'lp-alt-tick ' + side; k.style.top = (y - 0.5) + 'px'; box.appendChild(k);
    }
    const n = document.createElement('span'); n.className = 'lp-alt-num'; n.style.top = y + 'px';
    n.textContent = String(km).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); box.appendChild(n);
  }
}
_locPickAltScale();
(function () {
  const r = document.getElementById('locPickAltRange');
  r.addEventListener('input', () => {
    _locPick.zoom = LOC_PICK_ZOOM_MIN * Math.pow(LOC_PICK_ZOOM_MAX / LOC_PICK_ZOOM_MIN, Number(r.value) / 1000);
    _locPick.moving = true;   // the lower resolution while it is dragged, the full one when let go
    _locPickRequest();
  });
  r.addEventListener('change', () => { _locPick.moving = false; _locPickRequest(); });
  r.addEventListener('dblclick', () => { _locPick.zoom = LOC_PICK_ZOOM_MIN; _locPick.moving = false; _locPickRequest(); });
})();

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
// The readout under the header, whatever layer is shown: the time zone and under it the Bortle class
// (the texts the two layers' views showed) of the point under the mouse, else of the Location (the
// pin), so the header keeps its height; each line on its colour (the zone's, the class's). The two
// grids load as the window opens (_locPickInfoLoad); until then a line says it is coming.
function _locPickZoneHint(p) {
  const q = p || { lat: hemisphere * LAT, lon: lonHemisphere * LONG };
  const tz = document.getElementById('locPickInfoTz'), lp = document.getElementById('locPickInfoLp');
  const rgb = (c) => `rgb(${c.map(Math.round).join(', ')})`;
  const G = typeof _tzGrid !== 'undefined' ? _tzGrid.data : null;
  if (!G) { tz.textContent = 'time zone …'; tz.style.background = 'transparent'; }
  else {
    const s = _tzIndexAt(G, q.lat, q.lon), h = s ? _tzModeOffsets(G).off[s] : NaN;
    const off = h === h ? h : _tzNautical(q.lon);
    tz.textContent = h === h ? `${G.zones[s - 1]} · UTC${_fmtTimeZone(h)}`
      : `${s ? G.zones[s - 1] + ' unknown to this browser, nautical' : 'sea, nautical'} · UTC${_fmtTimeZone(off)}`;
    tz.style.background = rgb(_locPickZoneRGB(off));
  }
  const t = _lp.tiles[_lpTileKey(q.lat, q.lon)];   // a tile already in, never asked for here
  const sqm = (t ? _lpValueAt(t, q.lat, q.lon) : null) ?? (_lp.coarse ? _lpValueAt(_lp.coarse, q.lat, q.lon) : null);
  if (sqm === null) { lp.textContent = _lp.coarse ? 'no light pollution data here' : 'light pollution …'; lp.style.background = 'transparent'; }
  else {
    const cls = _nightSkySQMToBortle(sqm);
    lp.textContent = `Bortle ${cls} · SQM ${sqm.toFixed(2)}`;
    lp.style.background = rgb(LOC_PICK_LP_RGB[cls - 1]);
  }
  if (typeof _locPickDlInfoSync === 'function') _locPickDlInfoSync(p);   // Daylight's line, while it shows (render-locpick-daylight.js)
}
function _locPickInfoLoad() {   // both grids, after the window's first frame (opening is not held up)
  requestAnimationFrame(() => setTimeout(() => {
    const done = () => { if (_locPick.open) _locPickZoneHint(_locPick.hover); };
    if (typeof _tzLoad === 'function') _tzLoad().then(done);
    _lpLoadCoarse().then(done);
    done();
  }, 0));
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
    v(() => nightSkyActive), v(() => nightSkyTopView), v(() => nightSkySubmode),
    v(() => galleryState.genId), v(() => galleryState.imageIndex), v(() => galleryState.layer),
  ].join('|');
}
function _locPickSetOpen(on, ecl) {
  const was = _locPick.open, wasEcl = _locPick.ecl;
  if (on) _locPick.viewKey = _locPickViewKey();
  _locPick.open = on;
  _locPick.ecl = on ? (ecl || null) : null;
  if (!on && typeof _locPickDlRelease === 'function') _locPickDlRelease();   // render-locpick-daylight.js
  if (!on) { _locPickLpHiRelease(); _locPickPickHatchRelease(); _locPickZoneDstRelease(); }
  if (typeof _locPickDlCitiesSync === 'function') _locPickDlCitiesSync();   // Cities' places: not on the Eclipse map
  _locPickZoneCitiesSync();
  document.getElementById('locPickWin').classList.toggle('open', on);
  document.getElementById('locPickWin').classList.toggle('ecl', !!_locPick.ecl);
  _locPickInfoPlace();   // the labels under the head: under the Eclipse map's legend only there
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
    _locPickInfoLoad();
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
// Sets the Location to a point picked on the globe (a click, or the search's place):
// the hemispheres and fields, the Time zone following, the info line and the wave. name: the
// place's, for the info line, or null.
function _locPickApplyHere(lat, lon, name) {
  _locHereApply(lat, lon);   // controls.js: hemispheres + applyLat/applyLong, every view redraws
  const text = name ? `Set to ${name} (${_locHereShown()}) from the globe.` : `Set to ${_locHereShown()} from the globe.`;
  _locHereInfo(text);
  _tzFollowLocation(lat, lon, text);   // tz-lookup.js: the Time zone follows
  document.getElementById('inpLat').classList.add('loc-preview');
  document.getElementById('inpLong').classList.add('loc-preview');
  _locPick.wave = { lat, lon, t0: performance.now(), zoom: _locPick.zoom };
  _locPickRequest();
}
// Turns the globe so that the place p ({lat, lon}) lies under the canvas point (x, y) (CSS px): the
// wheel's and the pinch's zoom keep the place under the cursor or between the fingers, a drag
// carries the place it was pressed on. The view's centre (lon0, lat0) is solved by Newton steps on
// where the place lands; a point off the disc puts the place on the limb towards it. Near a pole
// (lat0 held at ±89°, as always) it lands as close as it can.
function _locPickPlaceAt(p, x, y) {
  const cv = document.getElementById('locPickCanvas'), V0 = _locPickView(cv.clientWidth, cv.clientHeight);
  let tu = (x - V0.cx) / V0.R, tv = -(y - V0.cy) / V0.R;
  const r = Math.hypot(tu, tv);
  if (r > 0.995) { tu *= 0.995 / r; tv *= 0.995 / r; }
  const P = _locPickVec(p.lon, p.lat);
  const at = (lon0, lat0) => {   // the place's (u, v) for a view centre
    const l = lon0 * D2R_LP, b = lat0 * D2R_LP;
    return [-Math.sin(l) * P[0] + Math.cos(l) * P[1],
      -Math.sin(b) * Math.cos(l) * P[0] - Math.sin(b) * Math.sin(l) * P[1] + Math.cos(b) * P[2]];
  };
  let lon0 = _locPick.lon0, lat0 = _locPick.lat0;
  const H = 1e-4;
  for (let i = 0; i < 10; i++) {
    const f = at(lon0, lat0), fu = f[0] - tu, fv = f[1] - tv;
    if (Math.abs(fu) < 1e-9 && Math.abs(fv) < 1e-9) break;
    const a1 = at(lon0 + H, lat0), a2 = at(lon0, lat0 + H);
    const j11 = (a1[0] - f[0]) / H, j21 = (a1[1] - f[1]) / H, j12 = (a2[0] - f[0]) / H, j22 = (a2[1] - f[1]) / H;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-12) break;
    let dLon = -(j22 * fu - j12 * fv) / det, dLat = -(-j21 * fu + j11 * fv) / det;
    const big = Math.max(Math.abs(dLon), Math.abs(dLat));
    if (big > 20) { dLon *= 20 / big; dLat *= 20 / big; }   // no wild steps far from the answer
    lon0 = ((lon0 + dLon + 540) % 360) - 180;
    lat0 = Math.max(-89, Math.min(89, lat0 + dLat));
  }
  // kept only if the place is on the near side there (a far-side solution mirrors it)
  const l = lon0 * D2R_LP, b = lat0 * D2R_LP;
  if (Math.cos(b) * Math.cos(l) * P[0] + Math.cos(b) * Math.sin(l) * P[1] + Math.sin(b) * P[2] > 0) {
    _locPick.lon0 = lon0; _locPick.lat0 = lat0;
  }
}
function _locPickZoomAt(zoom, x, y) {
  const cv = document.getElementById('locPickCanvas');
  const p = _locPickUnproject(_locPickView(cv.clientWidth, cv.clientHeight), x, y);
  _locPick.zoom = Math.max(LOC_PICK_ZOOM_MIN, Math.min(LOC_PICK_ZOOM_MAX, zoom));
  if (p) _locPickPlaceAt(p, x, y);
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
    // grab: the place pressed on, which the drag then carries (null off the Earth: the old turn)
    _locPick.drag = { x: e.clientX, y: e.clientY, lon0: _locPick.lon0, lat0: _locPick.lat0, moved: false, grab: _locPickPoint(e).p };
    if (e.pointerType !== 'mouse') { _locPick.hover = _locPickPoint(e).p; _locPickPreview(_locPick.hover); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], r = cv.getBoundingClientRect();
        _locPickZoomAt(pinch.zoom * spread() / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        _locPickRequest();
      }
      return;
    }
    const D = _locPick.drag;
    if (D) {
      const dx = e.clientX - D.x, dy = e.clientY - D.y;
      if (!D.moved && Math.hypot(dx, dy) > 4) { D.moved = true; _locPick.moving = true; cv.classList.add('dragging'); _locPick.hover = null; _locPickPreview(null); }
      if (D.moved && D.grab) {
        const r = cv.getBoundingClientRect();
        _locPickPlaceAt(D.grab, e.clientX - r.left, e.clientY - r.top);
        _locPickRequest();
        return;
      }
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
    _locPickApplyHere(p.lat, p.lon, null);   // the point clicked, a place's dot or label included
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
    const r = cv.getBoundingClientRect();
    _locPickZoomAt(_locPick.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    _locPick.moving = true;   // a run of wheel ticks at the lower resolution, the full one after it
    clearTimeout(wheelRest);
    wheelRest = setTimeout(() => { if (!_locPick.drag && !pinch) { _locPick.moving = false; _locPickRequest(); } }, 180);
    _locPick.hover = _locPickPoint(e).p;
    _locPickPreview(_locPick.hover);
    cv.classList.toggle('off-earth', !_locPick.hover);   // off the Earth the disc grows or shrinks under the cursor
    _locPickRequest();
  }, { passive: false });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (_locPick.open) _locPickRequest(); }).observe(cv);
})();
document.getElementById('btnLocSelect').addEventListener('click', () => _locPickSetOpen(!_locPick.open));
document.getElementById('btnLocPickClose').addEventListener('click', () => _locPickSetOpen(false));
// The time zones' legend: Zone | Time and Zones | Cities, then a row per part, a click switches it
// (the colours' row only explains). The same date and Time need a moment (_tzDateInstant): in
// Solargraph there is none, the row is off and Time disabled there, Zone pressed (the choices
// themselves are kept for Eclipse and Night Sky). Called on the choices' changes, and by the draw
// when the moment comes or goes.
function _locPickZoneLegendSync() {
  const none = _tzDateInstant() === null, text = none ? 'zone' : _locPick.zoneText;
  _locPick.zoneLegendNone = none;
  for (const b of document.querySelectorAll('#locPickZoneText [data-text]')) {
    const p = String(b.dataset.text === text);
    if (b.getAttribute('aria-pressed') !== p) b.setAttribute('aria-pressed', p);
    if (b.dataset.text === 'time' && b.disabled !== none) {
      b.disabled = none;
      b.title = none ? 'Not in Solargraph: no time of day' : 'The local time, green a day ahead of the Location, red a day behind';
    }
  }
  for (const b of document.querySelectorAll('#locPickZonePlace [data-place]')) {
    const p = String(b.dataset.place === _locPick.zonePlace);
    if (b.getAttribute('aria-pressed') !== p) b.setAttribute('aria-pressed', p);
  }
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
// The labels' content: 'zone' (the offset) or 'time' (the local time at the mode's moment)
function _locPickZoneSetText(which) {
  _locPick.zoneText = which === 'time' ? 'time' : 'zone';
  _locPickZoneLegendSync();
  _locPickRequest();
}
// The labels' place: 'zones' (in the areas) or 'cities' (tags at the places, which come on for the while)
function _locPickZoneSetPlace(which) {
  _locPick.zonePlace = which === 'cities' ? 'cities' : 'zones';
  _locPickZoneCitiesSync();
  _locPickZoneLegendSync();
  _locPickRequest();
}
for (const b of document.querySelectorAll('#locPickZoneText [data-text]')) b.addEventListener('click', () => _locPickZoneSetText(b.dataset.text));
for (const b of document.querySelectorAll('#locPickZonePlace [data-place]')) b.addEventListener('click', () => _locPickZoneSetPlace(b.dataset.place));
for (const b of document.querySelectorAll('#locPickZoneLegend button[data-part]')) {
  b.addEventListener('click', () => {
    _locPick.zoneParts[b.dataset.part] = !_locPick.zoneParts[b.dataset.part];
    if (b.dataset.part === 'dst' && !_locPick.zoneParts.dst) _locPickZoneDstRelease();
    _locPickZoneCitiesSync();   // the labels part: Cities with it
    _locPickZoneLegendSync();
    _locPickRequest();
  });
}
// The light pollution on or off: the time zones and Daylight off as it comes on; the coarse grid the first time
function _locPickSetLp(on) {
  _locPick.lp = on;
  const btn = document.getElementById('btnLocPickLightPollution');
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Hide the light pollution' : 'Show the light pollution';
  document.getElementById('locPickWin').classList.toggle('lp', on);
  if (on && _locPick.zones) document.getElementById('btnLocPickZones').click();
  if (on && _locPick.dl && typeof _locPickDlSet === 'function') _locPickDlSet(false);
  if (on) _lpLoadCoarse().then(() => { _locPickZoneHint(_locPick.hover); _locPickRequest(); });
  if (!on) { _locPick.lpHi.hover = _locPick.lpHi.pin = null; _locPickLpHiRelease(); for (const b of document.querySelectorAll('#locPickLpLegend [data-cls]')) b.setAttribute('aria-pressed', 'false'); }
  _locPickZoneHint(_locPick.hover);
  _locPickRequest();
}
document.getElementById('btnLocPickLightPollution').addEventListener('click', () => _locPickSetLp(!_locPick.lp));
// The legend's classes: the mouse over one shows it alone while there; a click or tap picks it
// (again lets go), the pick shown whenever the mouse is not over another
function _locPickLpHiSync() {
  for (const b of document.querySelectorAll('#locPickLpLegend [data-cls]'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.cls) === _locPick.lpHi.pin));
  _locPickRequest();
}
for (const b of document.querySelectorAll('#locPickLpLegend [data-cls]')) {
  const c = Number(b.dataset.cls);
  b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { _locPick.lpHi.hover = c; _locPickRequest(); } });
  b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { _locPick.lpHi.hover = null; _locPickRequest(); } });
  b.addEventListener('click', () => { _locPick.lpHi.pin = _locPick.lpHi.pin === c ? null : c; _locPickLpHiSync(); });
}
document.getElementById('btnLocPickZones').addEventListener('click', (e) => {
  _locPick.zones = !_locPick.zones;
  e.currentTarget.setAttribute('aria-pressed', String(_locPick.zones));
  e.currentTarget.title = _locPick.zones ? 'Hide the time zones' : 'Show the time zones';
  if (_locPick.zones && _locPick.lp) _locPickSetLp(false);
  if (_locPick.zones && _locPick.dl && typeof _locPickDlSet === 'function') _locPickDlSet(false);
  _locPickZoneCitiesSync();   // after Daylight has given the places back
  document.getElementById('locPickWin').classList.toggle('zones', _locPick.zones);   // their source (.loc-pick-credit) shows
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
