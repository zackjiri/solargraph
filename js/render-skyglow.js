// ─── Sky colour under Atmosphere (Night Sky: Sky Map, Planetarium; dark theme) ─────────────────
// With Atmosphere on the sky's fill follows the sky brightness instead of the fixed night blue:
// light blue by day, deep blue in twilight with a warm glow low over the Sun, the night blue after
// dark, greyer under the Moon. Drawn from a colour table fixed to the sky and a small per-pixel
// buffer (see _glowDraw below); the buffer is reused while time, place and view stay the same. The
// light theme keeps its white "paper" sky.
//
// Brightness of a direction v (horizon frame): the twilight sky (render-nightsky.js, from the
// Sun's altitude, turned into nL) times a direction factor - brighter towards the Sun and towards
// the horizon, normalised to 1 at the zenith so the zenith keeps the twilight curve's value - plus
// the moonlight (_nightSkyMoonNLAt, Krisciunas & Schaefer). The factor shapes only the colour; the
// limiting magnitude (stars, Milky Way) keeps the even twilight sky.
//
// The moonlight peaks steeply towards the Moon (1/ρ² within 10°), too sharp for the grid: sampled
// at nodes that move with the view, the glow changed shape while the view was dragged. So the grid
// takes the Moon's light as at least GLOW_MOON_CORE_DEG away, flat inside that circle, and the core
// is added over it ('lighter' compositing) as a radial gradient centred on the Moon: at each stop
// the full model's colour minus the capped one, along a ray up from the Moon. That difference is
// exactly 0 at the core's edge, so the grid's own colour (with its airmass and twilight in every
// direction) shows through unchanged there and the edge can never come out darker than the sky
// beyond it. It follows the Moon exactly, whatever the view does.
//
// The Moon's share (grid and core alike) takes the colour of the moonlight, not the ramp's blue:
// its luminance is kept and laid on in the Moon's own tint by altitude (_moonRealTint, render-moon.js,
// as its disc), a neutral silvery white high up turning yellow to orange towards the horizon.
const GLOW_GRID_PX = 24;
// Brightness (mag/arcsec²) -> colour: night blue (#000c22, the sky's fill without Atmosphere) at 21.5
// and darker, light day blue at 9 and brighter.
// Brighter than 9 is daylight with the Sun up (_glowDayNL): the sky at sunset level 9, noon ~5.
const GLOW_RAMP = [
  [21.5, [0, 12, 34]], [19.5, [6, 30, 78]], [17.5, [16, 48, 110]],
  [15, [38, 82, 150]], [12, [70, 120, 190]], [9, [100, 150, 212]],
  [7.5, [106, 162, 230]], [5.5, [110, 170, 238]],
];
// The twilight glow, warm colours round the Sun from before sunset to nautical twilight: a band low
// along the horizon, wide in azimuth (as the evening and morning sky shows, ±60-90° either side of
// the Sun), narrowing and sinking as the Sun goes down; and, with the Sun still up or just set, a
// warm white aureole round the Sun itself. Band orange at the horizon, golden higher up and while
// the Sun is above the horizon.
const GLOW_ORANGE = [235, 140, 70], GLOW_GOLD = [245, 190, 110], GLOW_AUREOLE = [255, 232, 185];
// Opposite the Sun, from sunset to the end of civil twilight (and the same before sunrise): the
// Earth's shadow, a blue-grey band rising from the horizon, and above it the Belt of Venus, the
// pink of the last reddened sunlight scattered back from the air. Both wide in azimuth round the
// antisolar point; the shadow's top climbs as the Sun sinks (about 1.1° per degree of depression)
// and both fade by -7°. From the horizon up, as on a clear evening: the shadow's blue, violet where
// it meets the belt, the belt's pink turning peach above, then the pale sky; fine-resolved near the
// horizon by the colour table (_glowBuildLut).
// The colours deepen as the Sun sinks: just after sunset a light blue shadow under a peach-pink
// belt, from -1° to -5° turning into a dark indigo shadow under a deep magenta-pink belt.
const GLOW_SHADOW = [95, 130, 192], GLOW_BELT = [238, 160, 178], GLOW_PEACH = [245, 196, 168];
const GLOW_SHADOW_LATE = [55, 48, 108], GLOW_BELT_LATE = [205, 95, 140], GLOW_PEACH_LATE = [200, 130, 160];
const GLOW_SUN_A = 2.5, GLOW_SUN_DEG = 30, GLOW_HOR_A = 0.6;   // direction factor: Sun side, horizon
const GLOW_MOON_CORE_DEG = 15;
const GLOW_MOON_STOPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14, 15];   // °

function _glowShown() {
  return _nightSkyAtmOn() && !document.body.classList.contains('light');   // render-nightsky.js
}
function _glowRamp(b) {
  const R = GLOW_RAMP;
  if (b >= R[0][0]) return R[0][1];
  for (let i = 1; i < R.length; i++) {
    if (b >= R[i][0]) {
      const t = (R[i - 1][0] - b) / (R[i - 1][0] - R[i][0]);
      return R[i - 1][1].map((c, k) => c + t * (R[i][1][k] - c));
    }
  }
  return R[R.length - 1][1];
}
// Direction factor (unnormalised): psi the angle from the Sun (°), el the altitude (°).
function _glowDirFactor(psi, el) {
  return (1 + GLOW_SUN_A * Math.exp(-psi / GLOW_SUN_DEG)) * (1 + GLOW_HOR_A * Math.pow(1 - el / 90, 3));
}
// RGB of direction v (horizon frame, unit, z >= 0).
function _glowColorAt(v, s, gZen, rhoMin) {
  const el = Math.asin(Math.max(0, Math.min(1, v[2]))) * 180 / Math.PI;
  const psi = Math.acos(Math.max(-1, Math.min(1, v[0] * s.sun.v[0] + v[1] * s.sun.v[1] + v[2] * s.sun.v[2]))) * 180 / Math.PI;
  const nl = _glowDayNL(s) * _glowDirFactor(psi, el) / gZen * _nightSkyEclRatioAt(s.ecl, v) + _nightSkyMoonNLAt(v, s, rhoMin);
  const c = _glowDayHaze(_glowPale(_glowRamp(_nsBFromNL(nl)), s.ecl && s.ecl.T > 0 ? s.sun.el - 90 * s.ecl.T : s.sun.el), s, el);
  const t = _glowTwilight(c, v, s, psi, el);
  return s.ecl && s.ecl.T > 0 ? _glowTotalityHorizon(t, s.ecl, v, el) : t;
}
// By day the sky is a deep blue overhead and turns pale, whitish, towards the horizon, where the
// line of sight runs through many times more air and the light is scattered over and over: the
// colour is pulled towards white by GLOW_DAY_HAZE·e^(−el/GLOW_DAY_HAZE_DEG) (0.45 at the horizon,
// a third of it at 15°, gone by ~50°), fully with the Sun from +10° up, fading out by −2° (the
// twilight glow and the pale sky take over), and in a solar eclipse with the totality factor T.
// Overhead the blue deepens by GLOW_DAY_DEEP·sin el per channel (red most, blue least), so noon's
// zenith is a saturated blue over the whitish horizon.
const GLOW_DAY_HAZE = 0.45, GLOW_DAY_HAZE_DEG = 15, GLOW_DAY_DEEP = [0.3, 0.2, 0.08];
function _glowDayHaze(c, s, el) {
  const day = Math.max(0, Math.min(1, (s.sun.el + 2) / 12)) * (s.ecl ? 1 - s.ecl.T : 1);
  if (day <= 0) return c;
  const a = day * GLOW_DAY_HAZE * Math.exp(-el / GLOW_DAY_HAZE_DEG), se = day * Math.sin(el * Math.PI / 180);
  return c.map((x, k) => x * (1 - GLOW_DAY_DEEP[k] * se) + a * (255 - x));
}
// In totality the sky is dark overhead but beyond the Moon's shadow, tens to hundreds of kilometres
// away, the air is still sunlit: a sunset glow low along the horizon, yellow-orange and fading
// upwards over ~6°, coming on with the totality factor T. Strongest where the shadow's edge is
// nearest: by the horizon's eclipse factor in that azimuth (_nightSkyEclSkyAt), full from
// GLOW_TOTALITY_FULL times the floor, a third of it where the horizon is no brighter than the floor.
const GLOW_TOTALITY_HORIZON = [232, 168, 104], GLOW_TOTALITY_FULL = 100;
function _glowTotalityHorizon(c, e, v, el) {
  const sh = _nightSkyEclSkyAt(e, [v[0], v[1], 0]) / NIGHTSKY_ECL_SKY_FLOOR;
  const near = Math.max(0, Math.min(1, Math.log10(sh) / Math.log10(GLOW_TOTALITY_FULL)));
  const g = 0.6 * e.T * (1 + 2 * near) / 3 * Math.exp(-el / 6);
  return c.map((x, k) => x + g * (GLOW_TOTALITY_HORIZON[k] - x));
}
// The twilight curve holds the sky at one daylight level whenever the Sun is up; for the colour the
// sky keeps brightening with the Sun's altitude (×(1 + h/2): 2.5 mag at 10°, 3.7 at 60°), so noon
// is the brightest, deepest blue and the sky dims towards sunset, continuous at the horizon.
// In a total solar eclipse the boost goes with the totality factor T: the sky in the Moon's shadow is
// lit from beyond it, not by the Sun's altitude, and with the Sun high the boost alone (×14 at 26°)
// would keep totality's sky a daytime blue. Colour only: the limiting magnitude (stars, planets) is
// _nightSkyAtmLimit's, unchanged.
function _glowDayNL(s) {
  const T = s.ecl ? s.ecl.T : 0;
  return s.sun.el > 0 ? s.twiNL * (1 + s.sun.el / 2 * (1 - T)) : s.twiNL;
}
// Around sunset and sunrise the sky is pale, a washed-out grey-blue rather than the day's deep blue:
// the colour is pulled towards a slightly bluish grey of its own brightness, fully with the Sun from
// the horizon to -2°, fading in from +10° and out by -5°, when the sky above the belt turns a deep,
// saturated blue again. With the Sun up it only takes the colour out (the grey keeps its brightness);
// the lift to a light grey comes in over the last 3° above the horizon and stays through the pale
// phase after sunset, but never past GLOW_PALE_MAX_LUM, below noon's sky (luminance ~159), so the
// sky only ever dims from noon to night.
const GLOW_PALE_MAX_LUM = 148;
function _glowPale(c, h) {
  const f = h >= 10 || h <= -5 ? 0 : h > 0 ? (10 - h) / 10 : h >= -2 ? 1 : (h + 5) / 3;
  if (f <= 0) return c;
  const lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const lift = Math.min(62 * Math.max(0, Math.min(1, 1 - h / 3)), Math.max(0, GLOW_PALE_MAX_LUM - lum));
  const grey = [lum + lift, lum + lift + 4, lum + lift + 12];
  const a = 0.65 * f;
  return c.map((x, k) => x + a * (Math.min(255, grey[k]) - x));
}
// Strength of the glow by the Sun's altitude: from +12° (the golden hour) up to full at +3°, full
// to -4°, gone at -12° (the end of nautical twilight).
function _glowPhase(h) {
  if (h >= 12 || h <= -12) return 0;
  if (h > 3) return (12 - h) / 9;
  if (h >= -4) return 1;
  return (h + 12) / 8;
}
// Strength of the Earth's shadow and the Belt of Venus by the Sun's altitude: from +1° up to full
// at -1°, full to -4°, then fading quickly (quadratically) to nothing at -7°, so it stays subtle on
// the still dark sky at the start of dawn and the end of dusk.
function _glowVenusPhase(h) {
  if (h >= 1 || h <= -7) return 0;
  if (h > -1) return (1 - h) / 2;
  if (h >= -4) return 1;
  const t = (h + 7) / 3;
  return t * t;
}
// dAnti: azimuth from the antisolar point (°), el the altitude (°).
function _glowVenusBelt(c, vb, h, dAnti, el) {
  const az = Math.exp(-(dAnti / 100) * (dAnti / 100));   // wide along the horizon
  const top = Math.max(0.5, Math.min(10, 0.5 - 1.1 * h));   // the shadow's upper edge, °
  const late = Math.max(0, Math.min(1, (-h - 1) / 4));   // 0 just after sunset, 1 from -5°
  const mix = (a, b) => a.map((x, k) => x + late * (b[k] - x));
  const shCol = mix(GLOW_SHADOW, GLOW_SHADOW_LATE), beltCol = mix(GLOW_BELT, GLOW_BELT_LATE), peachCol = mix(GLOW_PEACH, GLOW_PEACH_LATE);
  const se = (el - top) / 2.5;   // the shadow's soft upper edge
  const shadow = 0.385 * vb * az * (se <= 0 ? 1 : Math.exp(-se * se));
  // the belt: a quick rise from the shadow's edge to its peak ~3° above it, then a slow fade
  // upwards (gone by ~20° above the edge), pink at the peak turning peach above it
  const bd = el - top - 3, bz = bd / (bd > 0 ? 8 : 2.5);
  const belt = 0.42 * vb * az * Math.exp(-bz * bz);
  const pc = Math.max(0, Math.min(1, bd / 7));
  let col = [0, 1, 2].map(k => beltCol[k] + pc * (peachCol[k] - beltCol[k]));
  // with the Sun deep (the first light of dawn, the last of dusk) the belt has no pink yet: from -4°
  // its colour greys out to a cool grey of the same brightness, fully grey from -6.5°
  const grey = Math.max(0, Math.min(1, (-h - 4) / 2.5));
  if (grey > 0) {
    const lum = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
    const g = [lum * 0.92, lum * 0.97, lum * 1.12];
    col = col.map((x, k) => x + grey * (g[k] - x));
  }
  let out = c.map((x, k) => x + shadow * (shCol[k] - x));
  out = out.map((x, k) => x + belt * (col[k] - x));
  return out;
}
function _glowTwilight(c, v, s, psi, el) {
  const h = s.sun.el, tw = _glowPhase(h);
  const vb = _glowVenusPhase(h);
  if (tw <= 0 && vb <= 0) return c;
  // the band: width in azimuth 80° with the Sun up, 40° at -10°; height 25° with the Sun at +3° and
  // above, 8° at -10°
  const W = h >= 0 ? 80 : Math.max(40, 80 + 4 * h);
  const H = h >= 3 ? 25 : Math.max(8, 25 + (h - 3) * 17 / 13);
  let daz = Math.abs(Math.atan2(v[0], v[1]) - Math.atan2(s.sun.v[0], s.sun.v[1])) * 180 / Math.PI;
  if (daz > 180) daz = 360 - daz;
  if (vb > 0) c = _glowVenusBelt(c, vb, h, 180 - daz, el);
  if (tw <= 0) return c;
  const band = 0.65 * tw * Math.exp(-(daz / W) * (daz / W)) * Math.exp(-el / H);
  const low = Math.exp(-el / 6);   // orange right at the horizon, golden above
  const gold = Math.max(0, Math.min(1, h / 8));   // and golden overall with the Sun well up
  const warm = [0, 1, 2].map(k => GLOW_GOLD[k] + (1 - gold) * low * (GLOW_ORANGE[k] - GLOW_GOLD[k]));
  let out = c.map((x, k) => x + band * (warm[k] - x));
  // the aureole round the Sun, with it up or just set
  const aur = 0.5 * tw * Math.max(0, Math.min(1, (h + 2) / 4)) * Math.exp(-psi / 12);
  if (aur > 0) out = out.map((x, k) => x + aur * (GLOW_AUREOLE[k] - x));
  return out;
}

// The colour field is fixed to the sky, not to the screen: the twilight part (twilight sky, glow,
// Earth's shadow, Belt of Venus) depends only on the altitude and the azimuth from the Sun, so it is
// worked out once per moment into a table (GLOW_LUT_NE altitudes by sin, GLOW_LUT_NA azimuths of 3°)
// and every pixel of a small buffer (GLOW_BUF_PX canvas px each) reads its own direction's colour
// from it by bilinear interpolation. A screen-fixed grid sampled the narrow bands differently at
// every camera position, so they shimmered while the view was dragged; this way they stay put on
// the sky. The table is rebuilt only when the time or place changes (dragging reuses it). The
// moonlight is smooth away from the Moon, so its share (the colour with it minus without, the core
// capped as above) stays on the coarse screen grid and is added per pixel; the core is the
// gradient drawn after.
const GLOW_BUF_PX = 3, GLOW_LUT_NE = 96, GLOW_LUT_NA = 61, GLOW_LUT_DAZ = 3;
const GLOW_LUT_NA_FULL = 121;   // 0..360° from the Sun, for a solar eclipse
// Each view keeps its own table and buffer ('ns' Night Sky, 'sd' Sky Dome), so switching between
// them never forces a rebuild.
const _glowSlots = {};
function _glowSlot(name) {
  return _glowSlots[name] || (_glowSlots[name] = { lut: { key: null, d: null }, buf: { canvas: null, ctx: null, img: null, key: null } });
}
function _glowZenFactor(s) {
  return _glowDirFactor(Math.acos(Math.max(-1, Math.min(1, s.sun.v[2]))) * 180 / Math.PI, 90);
}
function _glowBuildLut(s, key, slot) {
  const T = slot.lut;
  if (T.key === key) return T.d;
  const s0 = Object.assign({}, s, { moon: null }), gZen = _glowZenFactor(s);
  const sunAz = Math.atan2(s.sun.v[0], s.sun.v[1]);
  // symmetric about the Sun's vertical, but the Moon's shadow in a solar eclipse is not: all round
  const NA = s.ecl ? GLOW_LUT_NA_FULL : GLOW_LUT_NA;
  const d = T.d && T.d.length === GLOW_LUT_NE * NA * 3 ? T.d : new Float32Array(GLOW_LUT_NE * NA * 3);
  for (let ie = 0; ie < GLOW_LUT_NE; ie++) {
    const se = ie / (GLOW_LUT_NE - 1), ce = Math.sqrt(1 - se * se);
    for (let ia = 0; ia < NA; ia++) {
      const az = sunAz + ia * GLOW_LUT_DAZ * Math.PI / 180;
      const col = _glowColorAt([ce * Math.sin(az), ce * Math.cos(az), se], s0, gZen);
      const o = (ie * NA + ia) * 3;
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2];
    }
  }
  T.key = key; T.d = d; T.na = NA;
  return d;
}
// The Moon's share d = RGB (with − without) recoloured in tint (normalised to luminance 1), d's
// luminance kept.
function _glowMoonTint(s) {
  const t = _moonRealTint(Math.asin(Math.max(-1, Math.min(1, s.moon.v[2]))) * 180 / Math.PI);
  const l = 0.3 * t[0] + 0.59 * t[1] + 0.11 * t[2];
  return t.map(c => c / l);
}
function _glowMoonTinted(d, tint) {
  const l = Math.max(0, 0.3 * d[0] + 0.59 * d[1] + 0.11 * d[2]);
  return tint.map(c => c * l);
}
// The Moon's share on the coarse screen grid: RGB (with − without) in the moonlight's tint, or null
// with the Moon down.
function _glowMoonGrid(s, w, h, dirAt) {
  if (!s.moon) return null;
  const tint = _glowMoonTint(s);
  const gw = Math.ceil(w / GLOW_GRID_PX) + 1, gh = Math.ceil(h / GLOW_GRID_PX) + 1;
  const s0 = Object.assign({}, s, { moon: null }), gZen = _glowZenFactor(s);
  const g = new Float32Array(gw * gh * 3), out = [0, 0, 0];
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      dirAt(i * GLOW_GRID_PX, j * GLOW_GRID_PX, out);
      _glowOntoSky(out);
      const a = _glowColorAt(out, s, gZen, GLOW_MOON_CORE_DEG), b = _glowColorAt(out, s0, gZen);
      const c = _glowMoonTinted([a[0] - b[0], a[1] - b[1], a[2] - b[2]], tint);
      const o = (j * gw + i) * 3;
      g[o] = c[0]; g[o + 1] = c[1]; g[o + 2] = c[2];
    }
  }
  return { gw, gh, g };
}
function _glowOntoSky(out) {   // below the horizon: onto it, for a clean edge under the clip
  if (out[2] >= 0) return;
  out[2] = 0;
  const n = Math.hypot(out[0], out[1]) || 1;
  out[0] /= n; out[1] /= n;
}
// Night Sky: the state from the Atmosphere model (twilight, moonlight) at the Night Sky moment.
function _glowDraw(ctx, w, h, dirAt, clip, viewKey, moonAt, sunAt) {
  const s = _nightSkyAtmState();
  if (!s) return;
  const tkey = [nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT, LAT, hemisphere, LONG, lonHemisphere].join('|');
  _glowRender(ctx, w, h, s, tkey, dirAt, clip, viewKey, moonAt, 'ns', GLOW_BUF_PX, sunAt);
}
// Fills the sky region with the colour field. s: {twiLM, twiNL, sun: {v, el}, moon} (as
// _nightSkyAtmState); tkey identifies the moment and place for the table. dirAt(px, py, out) writes
// the horizon-frame direction of a canvas point (any point, pushed onto the sky when off it) and may
// return an opacity 0..1 for it (a rim fade; none = opaque). clip() clips to the sky region.
// moonAt() and sunAt() give the Moon's and the Sun's {x, y} on the canvas and the px per degree
// there, or null. slotName picks the view's caches, bufPx the canvas px per buffer px.
function _glowRender(ctx, w, h, s, tkey, dirAt, clip, viewKey, moonAt, slotName, bufPx, sunAt) {
  const slot = _glowSlot(slotName);
  const key = [tkey, w, h, viewKey, bufPx].join('|');
  const bw = Math.ceil(w / bufPx), bh = Math.ceil(h / bufPx);
  const B = slot.buf;
  if (!B.canvas) { B.canvas = document.createElement('canvas'); B.ctx = B.canvas.getContext('2d'); }
  if (B.key !== key) {
    if (B.canvas.width !== bw || B.canvas.height !== bh || !B.img) {
      B.canvas.width = bw; B.canvas.height = bh;
      B.img = B.ctx.createImageData(bw, bh);
    }
    const lut = _glowBuildLut(s, tkey, slot), mg = _glowMoonGrid(s, w, h, dirAt);
    const shx = s.sun.v[0], shy = s.sun.v[1], shl = Math.hypot(shx, shy) || 1;
    const NA = slot.lut.na, full = NA === GLOW_LUT_NA_FULL, d = B.img.data, out = [0, 0, 0];
    const eMax = GLOW_LUT_NE - 1, aMax = NA - 1, aScale = 180 / Math.PI / GLOW_LUT_DAZ;
    for (let j = 0, p = 0; j < bh; j++) {
      const py = (j + 0.5) * bufPx;
      for (let i = 0; i < bw; i++, p += 4) {
        const px = (i + 0.5) * bufPx;
        const wgt = dirAt(px, py, out);
        if (wgt === 0) { d[p + 3] = 0; continue; }
        _glowOntoSky(out);
        const hl = Math.hypot(out[0], out[1]) || 1;
        const cd = Math.max(-1, Math.min(1, (out[0] * shx + out[1] * shy) / (hl * shl)));
        let fa;
        if (full) {   // the azimuth from the Sun's, 0..360° eastwards
          const da = Math.atan2(out[0] * shy - out[1] * shx, out[0] * shx + out[1] * shy);
          fa = (da < 0 ? da + 2 * Math.PI : da) * aScale;
        } else fa = Math.acos(cd) * aScale;
        const fe = Math.min(1, out[2]) * eMax;
        const e0 = Math.min(eMax - 1, fe | 0), a0 = Math.min(aMax - 1, fa | 0), te = fe - e0, ta = fa - a0;
        const o00 = (e0 * NA + a0) * 3, o01 = o00 + 3, o10 = o00 + NA * 3, o11 = o10 + 3;
        const w00 = (1 - te) * (1 - ta), w01 = (1 - te) * ta, w10 = te * (1 - ta), w11 = te * ta;
        let r = lut[o00] * w00 + lut[o01] * w01 + lut[o10] * w10 + lut[o11] * w11;
        let g = lut[o00 + 1] * w00 + lut[o01 + 1] * w01 + lut[o10 + 1] * w10 + lut[o11 + 1] * w11;
        let b = lut[o00 + 2] * w00 + lut[o01 + 2] * w01 + lut[o10 + 2] * w10 + lut[o11 + 2] * w11;
        if (mg) {
          const gx = px / GLOW_GRID_PX, gy = py / GLOW_GRID_PX;
          const gi = Math.min(mg.gw - 2, gx | 0), gj = Math.min(mg.gh - 2, gy | 0), tx = gx - gi, ty = gy - gj;
          const q00 = (gj * mg.gw + gi) * 3, q01 = q00 + 3, q10 = q00 + mg.gw * 3, q11 = q10 + 3;
          const v00 = (1 - tx) * (1 - ty), v01 = tx * (1 - ty), v10 = (1 - tx) * ty, v11 = tx * ty, G = mg.g;
          r += G[q00] * v00 + G[q01] * v01 + G[q10] * v10 + G[q11] * v11;
          g += G[q00 + 1] * v00 + G[q01 + 1] * v01 + G[q10 + 1] * v10 + G[q11 + 1] * v11;
          b += G[q00 + 2] * v00 + G[q01 + 2] * v01 + G[q10 + 2] * v10 + G[q11 + 2] * v11;
        }
        d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = wgt === undefined ? 255 : 255 * wgt;
      }
    }
    B.ctx.putImageData(B.img, 0, 0);
    B.key = key;
  }
  ctx.save();
  clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(B.canvas, 0, 0, bw * bufPx, bh * bufPx);
  const m = s.moon && moonAt && moonAt();
  if (m) {
    const gZen = _glowZenFactor(s), tint = _glowMoonTint(s);
    const mv = s.moon.v;
    let up = [-mv[2] * mv[0], -mv[2] * mv[1], 1 - mv[2] * mv[2]];   // towards the zenith, across mv
    const ul = Math.hypot(up[0], up[1], up[2]);
    up = ul > 1e-6 ? up.map(x => x / ul) : [1, 0, 0];
    const R = GLOW_MOON_CORE_DEG * m.pxPerDeg;
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, R);
    for (const rho of GLOW_MOON_STOPS) {
      const r = rho * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
      const dir = [mv[0] * cr + up[0] * sr, mv[1] * cr + up[1] * sr, mv[2] * cr + up[2] * sr];
      const full = _glowColorAt(dir, s, gZen), cap = _glowColorAt(dir, s, gZen, GLOW_MOON_CORE_DEG);
      const d = _glowMoonTinted(full.map((x, k) => x - cap[k]), tint).map(x => Math.max(0, Math.round(x)));
      g.addColorStop(rho / GLOW_MOON_CORE_DEG, `rgb(${d[0]},${d[1]},${d[2]})`);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, R, 0, 2 * Math.PI); ctx.fill();
  }
  const sp = sunAt && s.sun.el > -1 && sunAt();
  if (sp) _glowSunAureole(ctx, sp, s.sun.el, s.ecl ? s.ecl.U : 1);
  ctx.restore();
}

// The aureole round the Sun: sunlight scattered forward by the air, the sky's brightness climbing
// steeply towards the Sun (about as 1/ρ² inside a few degrees, flattening beyond), added to the sky
// as a radial gradient centred on the Sun, like the Moon's core: intensity ρc²/(ρ² + ρc²), ρc =
// GLOW_AUREOLE_RC, tapered to exactly 0 at GLOW_AUREOLE_R. Warm white with the Sun high, turning
// golden as it gets low (its light crossing more air); it comes in from -1° to +3°, after which the
// twilight glow takes over. Additive, so near the Sun it saturates to white and its edge can never
// darken the sky beyond.
const GLOW_AUREOLE_RC = 2.5, GLOW_AUREOLE_R = 35, GLOW_AUREOLE_MAX = 0.9;
const GLOW_AUREOLE_STOPS = [0, 0.3, 0.6, 1, 1.5, 2, 3, 4, 6, 8, 11, 15, 20, 26, 35];   // °
const GLOW_SUN_WHITE = [255, 246, 228], GLOW_SUN_GOLD = [255, 200, 135];
function _glowSunTint(h) {   // the Sun's light: warm white high up, golden low
  const t = Math.max(0, Math.min(1, h / 15));
  return GLOW_SUN_GOLD.map((c, k) => c + t * (GLOW_SUN_WHITE[k] - c));
}
function _glowSunAureole(ctx, sp, h, uncovered) {
  // in a solar eclipse the aureole holds as much light as is left of the Sun (uncovered share)
  const a = GLOW_AUREOLE_MAX * Math.max(0, Math.min(1, (h + 1) / 4)) * (uncovered === undefined ? 1 : Math.sqrt(uncovered));
  if (a <= 0) return;
  const col = _glowSunTint(h), R = GLOW_AUREOLE_R * sp.pxPerDeg;
  const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, R);
  for (const rho of GLOW_AUREOLE_STOPS) {
    const taper = 1 - (rho / GLOW_AUREOLE_R) * (rho / GLOW_AUREOLE_R);
    const i = a * GLOW_AUREOLE_RC * GLOW_AUREOLE_RC / (rho * rho + GLOW_AUREOLE_RC * GLOW_AUREOLE_RC) * taper * taper;
    g.addColorStop(rho / GLOW_AUREOLE_R, `rgb(${Math.round(col[0] * i)},${Math.round(col[1] * i)},${Math.round(col[2] * i)})`);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(sp.x, sp.y, R, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
}

// Sky Map: the polar planisphere (_skyDomePoint), points past the rim taken at the horizon.
function _glowDrawSkyMap(ctx, w, h, layout) {
  const { cx, cy, R } = layout;
  _glowDraw(ctx, w, h, (px, py, out) => {
    const dx = px - cx, dy = py - cy, r = Math.hypot(dx, dy);
    const el = Math.max(0, 1 - r / R) * Math.PI / 2, ce = Math.cos(el);
    const [sa, ca] = _nightSkyMapRotDir(r > 1e-9 ? -dx / r : 0, r > 1e-9 ? -dy / r : 1);   // the map's rotation undone
    out[0] = ce * sa; out[1] = ce * ca; out[2] = Math.sin(el);
  }, () => _nightSkyClipToSky(ctx, layout), 'map' + nightSkyMapRot, () => {
    const mo = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (mo.el < 0) return null;
    const p = _skyDomePoint(cx, cy, R, mo.az, mo.el);
    return { x: p.x, y: p.y, pxPerDeg: R / 90 };
  }, () => {
    const su = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    const p = _skyDomePoint(cx, cy, R, su.az, su.el);
    return { x: p.x, y: p.y, pxPerDeg: R / 90 };
  });
}
// Planetarium: the inverse fisheye (as _nightSkyPlanetPixelToAzEl), held at its 170° rim.
function _glowDrawPlanetarium(ctx, w, h, layout) {
  const C = _nightSkyPlanet3D, Rt = C.RIGHT, U = C.UP, F = C.FWD;
  const kInv = 1 / (layout.scale * C.FOCAL);
  _glowDraw(ctx, w, h, (px, py, out) => {
    const sx = (px - layout.cx) * kInv, sy = -(py - layout.cy) * kInv;
    const theta = Math.min(NIGHTSKY_PLANET_FADE_OUTER, Math.hypot(sx, sy));
    const rr = Math.hypot(sx, sy) || 1;
    const k = Math.sin(theta) / rr, lz = Math.cos(theta);
    const lx = sx * k, ly = sy * k;
    for (let i = 0; i < 3; i++) out[i] = lx * Rt[i] + ly * U[i] + lz * F[i];
  }, () => _nightSkyClipToSky(ctx, layout), ['pl', C.camAz, C.camEl, C.zoom, C.roll].join(','), () => {
    const mo = _moonAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    if (mo.el < 0) return null;
    const p = _nightSkyPlanetProject(layout, mo.az, mo.el);
    return p.visible ? { x: p.x, y: p.y, pxPerDeg: C.FOCAL * layout.scale * Math.PI / 180 } : null;
  }, () => {
    const su = _nightSkySunAzEl(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
    const p = _nightSkyPlanetProject(layout, su.az, su.el);
    return p.visible ? { x: p.x, y: p.y, pxPerDeg: C.FOCAL * layout.scale * Math.PI / 180 } : null;
  });
}

// ── Sky Dome Planetarium (render-skydome.js) ──────────────────────────────────────────────────
// The same sky as Night Sky's, for the solargraph's own Sun (the custom date and solar time): the
// twilight curve from the Sun's altitude (_nightSkyTwilightLM, render-nightsky.js), no Moon. Drawn
// in both themes (the dome is a picture of the real sky, not a chart), faded towards the fisheye's
// rim like everything else on the dome, coarser while the view is dragged.
function _glowSkyDomeState(sunAz, sunEl) {
  const twiLM = _nightSkyTwilightLM(sunEl);
  return { twiLM, twiNL: _nsNLFromB(_nsBFromLM(Math.min(twiLM, NIGHTSKY_MAG_LIMIT_OFF))),
    sun: { v: _skyDomeUnitVec(sunAz, sunEl), el: sunEl }, moon: null };
}
function _glowDrawSkyDomePlanet(ctx, layout, sunAz, sunEl, W, H) {
  const C = _skyDomePlanet3D, Rt = C.RIGHT, U = C.UP, F = C.FWD;
  const kInv = 1 / (layout.scale * C.FOCAL), fadeSpan = PLANET3D_FADE_OUTER - PLANET3D_FADE_INNER;
  const tkey = ['sd', sunAz.toFixed(4), sunEl.toFixed(4)].join('|');
  _glowRender(ctx, W, H, _glowSkyDomeState(sunAz, sunEl), tkey, (px, py, out) => {
    const sx = (px - layout.cx) * kInv, sy = -(py - layout.cy) * kInv;
    const th = Math.hypot(sx, sy);
    if (th >= PLANET3D_FADE_OUTER) return 0;
    const k = th > 1e-6 ? Math.sin(th) / th : 1, lz = Math.cos(th);
    const lx = sx * k, ly = sy * k;
    for (let i = 0; i < 3; i++) out[i] = lx * Rt[i] + ly * U[i] + lz * F[i];
    return th <= PLANET3D_FADE_INNER ? 1 : 1 - (th - PLANET3D_FADE_INNER) / fadeSpan;
  }, () => _skyDomePlanet3DClipAboveHorizon(ctx, layout),
  ['sdp', C.camAz, C.camEl, C.zoom].join(','), null, 'sd',
  _skyDomePlanet3DInteracting ? 4 : GLOW_BUF_PX, () => {
    const p = _skyDomePlanet3DProject(layout, sunAz, sunEl);
    return p.visible === false ? null : { x: p.x, y: p.y, pxPerDeg: C.FOCAL * layout.scale * Math.PI / 180 };
  });
}

// The sky's colour in direction v (horizon frame) at the Night Sky moment, for the Moon's silhouette
// in a solar eclipse (render-moon.js).
function _glowSkyColorAt(v) {
  const s = _nightSkyAtmState();
  return s ? _glowColorAt(v, s, _glowZenFactor(s)) : [0, 12, 34];
}

