// ─── City tags on the SELECT globe: a layer's values next to the places ─────────────────────────
// Shared by the Daylight layer's Cities labels (render-locpick-daylight.js) and the time zones'
// Zones | Cities (render-locpick.js). The layer that shows them is the owner (_locPickCityTags.owner,
// 'daylight' or 'zones'; the two layers switch each other off, so one at a time) and gives the values
// (_locPickCityOwners[owner]):
//  - frame() -> whether there are values this frame (the layer's data in, its date known);
//  - value(p, x, y) -> { text, rgb, textRgb } | null for a place's row p (or { lat, lon }: the
//    Location) drawn at (x, y); textRgb null for the places' rule (dark text on a light pill);
//  - cover(out, rows, put, claim), optional: more tags once the places have theirs (the time zones'
//    coverage), put(i, tag) on place i (clear of the rest), claim(box) a free box for a tag of its
//    own (_locPickCitySpots);
//  - area(x, y) and areaGap, optional: the area of a tag at (x, y) (-1 for none) and the gap between
//    the tags of one area (the time zones': one time per area, a few tags enough);
//  - title(), optional: its toggle's title as the places go on or off.
// The places layer (render-locplaces.js) asks the hook (_locPlacesTagHook = _locPickCityHook) for a
// tag per place in its order of importance; a place gets one only LOC_PICK_CITY_GAP_PX *
// (1 - ln zoom / ln 40) px (none at the closest zoom) from every tag given before it, the Location's
// first, and with an owner's areas also areaGap px from the places' tags of its own area (not the
// Location's). The Location's tag by its pin (_locPickCityPlaceHere): below it, else above, else right
// of it (_locPickCityHereFit), drawn on top after the pin (_locPickCityDrawHere). The owner turns the places
// on for the while (_locPickCitySync, not remembered) and gets back the state before, or the one the
// user chose meanwhile (_locPickCityPlacesChosen).
const LOC_PICK_CITY_GAP_PX = 90;
const LOC_PICK_CITY_TAG_FONT = "bold 10px 'Share Tech Mono', monospace";   // the Location's tag and the spots'
const LOC_PICK_CITY_HERE_DY = 15;   // the Location's tag's centre this far under (or over) the pin
const LOC_PICK_CITY_HERE_DX = 8;    // ... or its left edge this far right of the pin
const _locPickCityOwners = {};      // owner -> its values (above)
const _locPickCityTags = {
  owner: null,
  value(p, x, y) { const O = _locPickCityOwners[_locPickCityTags.owner]; return O ? O.value(p, x, y) : null; },
};
let _locPickCityPlacesWas = null;   // the places shown before an owner turned them on; null while none has
let _locPickCityHere = null;        // the Location's tag drawn last: { text, rgb, textRgb, x, y, pw, x0, yc, box, fit }, null for none
let _locPickCitySpots = [];         // the owner's tags at a spot of their own this frame: { tag, x, y, x0, area }

const _locPickCityHook = {
  live: false, fresh: false, at: [], gap: 0,   // live: the owner's frame(), fresh: computed this frame by _locPickCityPlaceHere
  O: null,                                      // the owner's values this frame; at: [x, y, area] of the tags given
  // the frame's gap; the Location's tag placed clear of the names (names, blocked: the boxes of the
  // places' names and of the window's controls), first among the given and kept clear of
  begin(V, names, blocked) {
    const T = _locPickCityHook, O = _locPickCityOwners[_locPickCityTags.owner], H = _locPickCityHere;
    T.at = []; _locPickCitySpots = [];
    if (!T.fresh) T.live = !!O && O.frame();   // once per frame: _locPickCityPlaceHere has run it before
    T.fresh = false;
    T.O = T.live ? O : null;
    if (!T.live) return null;
    T.gap = LOC_PICK_CITY_GAP_PX * Math.max(0, 1 - Math.log(_locPick.zoom) / Math.log(LOC_PICK_ZOOM_MAX));
    if (!H) return null;
    _locPickCityHereFit(H, blocked.concat(names));
    T.at.push([H.x, H.y, -1]);   // the general gap only: the largest places of its area keep their tags
    return [H.box];
  },
  tag(r, x, y) {
    const T = _locPickCityHook, g2 = T.gap * T.gap;
    if (!T.live) return null;
    for (const a of T.at) if ((a[0] - x) * (a[0] - x) + (a[1] - y) * (a[1] - y) < g2) return null;
    const c = _locPickCityArea(x, y);
    if (c >= 0) {
      const a2 = T.O.areaGap * T.O.areaGap;
      for (const a of T.at) if (a[2] === c && (a[0] - x) * (a[0] - x) + (a[1] - y) * (a[1] - y) < a2) return null;
    }
    const v = _locPickCityTags.value(r, x, y);
    return v ? { text: v.text, rgb: v.rgb, textRgb: v.textRgb || null, x, y } : null;
  },
  took(t) { _locPickCityHook.at.push([t.x, t.y, _locPickCityArea(t.x, t.y)]); },
  cover(out, rows, put, claim) {
    const O = _locPickCityOwners[_locPickCityTags.owner];
    if (_locPickCityHook.live && O && O.cover) O.cover(out, rows, put, claim);
  },
};
// The area of a tag at (x, y) for the owner's per-area gap (its area()), -1 without one
function _locPickCityArea(x, y) {
  const O = _locPickCityHook.O;
  return O && O.area && O.areaGap > 0 ? O.area(x, y) : -1;
}
// The Location's tag by its pin: its value and a first place clear of the window's controls and the
// canvas's edges; placed again clear of the places' names once they are laid out (the hook's begin),
// before their tags. Called by the owner each frame where its labels go, before the places; its
// frame() is kept for the hook's begin.
function _locPickCityPlaceHere(ctx, V, w, h) {
  _locPickCityHere = null;
  const O = _locPickCityOwners[_locPickCityTags.owner], T = _locPickCityHook;
  T.live = !!O && O.frame(); T.fresh = true;
  if (!T.live) return;
  const lat = hemisphere * LAT, lon = lonHemisphere * LONG, s = _locPickProject(V, _locPickVec(lon, lat));
  if (s.z < 0) return;
  const t = O.value({ lat, lon }, s.x, s.y);
  if (!t) return;
  const pw = _locPlacesWidth(ctx, LOC_PICK_CITY_TAG_FONT, t.text) + 2 * LOC_PLACES_TAG_PAD;
  _locPickCityHereFit(_locPickCityHere = { text: t.text, rgb: t.rgb, textRgb: t.textRgb || null, x: s.x, y: s.y, pw, w, h }, _locPlacesKeepClear(ctx.canvas));
}
// The Location's tag H: below its pin, else above, else right of it, the first whose box is within
// the canvas and clear of the boxes; below when none is (H.fit 'below', 'above', 'right', 'none')
function _locPickCityHereFit(H, boxes) {
  const dy = LOC_PICK_CITY_HERE_DY, c = H.x - H.pw / 2;
  const tries = [['below', c, H.y + dy], ['above', c, H.y - dy], ['right', H.x + LOC_PICK_CITY_HERE_DX, H.y]];
  const at = (x0, yc) => ({ x0: x0 - 2, y0: yc - 8, x1: x0 + H.pw + 2, y1: yc + 8 });
  const clear = (b) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= H.w && b.y1 <= H.h && !boxes.some(o => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
  let pick = tries.find(([, x0, yc]) => clear(at(x0, yc)));
  H.fit = pick ? pick[0] : 'none';
  if (!pick) pick = tries[0];
  H.x0 = pick[1]; H.yc = pick[2]; H.box = at(pick[1], pick[2]);
}
// The owner's own tags (the spots) and the Location's, after the places and the pin, on top
function _locPickCityDrawHere(ctx, V, w, h) {
  if (!_locPickCityTags.owner) return;
  const H = _locPickCityHere;
  if (!H && !_locPickCitySpots.length) return;
  ctx.save();
  ctx.textBaseline = 'middle';
  for (const s of _locPickCitySpots) _locPlacesDrawTag(ctx, s.tag, LOC_PICK_CITY_TAG_FONT, s.x0, s.y, 1);
  if (H) _locPlacesDrawTag(ctx, H, LOC_PICK_CITY_TAG_FONT, H.x0, H.yc, 1);
  ctx.restore();
}
// The hook and the places for an owner: on, the hook its and the places on for the while (not
// remembered); off (when it is the owner), the state before again, or the one the user chose
// meanwhile. An owner taking over from another keeps the state before the first.
function _locPickCitySync(owner, on) {
  const T = _locPickCityTags;
  if (on) {
    T.owner = owner;
    _locPlacesTagHook = _locPickCityHook;
    if (_locPickCityPlacesWas === null) {
      _locPickCityPlacesWas = _locPlaces.on;
      if (!_locPlaces.on) _locPlacesSetOn(true, true);
    }
  } else if (T.owner === owner) {
    T.owner = null;
    _locPlacesTagHook = null;
    _locPickCityHere = null; _locPickCitySpots = [];
    if (_locPickCityPlacesWas !== null) {
      const was = _locPickCityPlacesWas;
      _locPickCityPlacesWas = null;
      if (!was && _locPlaces.on) _locPlacesSetOn(false, true);   // the remembered value is still the user's
    }
  }
  _locPickCityTitles();
}
// The user turned the places on or off (_locPlacesSetOn): while an owner has them, the state it gives back
function _locPickCityPlacesChosen(on) {
  if (_locPickCityPlacesWas !== null) _locPickCityPlacesWas = on;
  _locPickCityTitles();
}
function _locPickCityTitles() {
  for (const k in _locPickCityOwners) if (_locPickCityOwners[k].title) _locPickCityOwners[k].title();
}
