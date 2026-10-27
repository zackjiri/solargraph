// ─── Night Sky: Globe (fourth Visualization sub-mode) ───────────────────────────────────────────
// The Earth seen from space at the selected instant, in the same kind of orbiting 3D view as the
// Sky Map 3D: land from Natural Earth 1:110m (data/earth/land-110m.json, TopoJSON decoded here),
// a graticule, the place from Location, and the real day and night - the
// Sun's altitude worked out for every pixel of the globe, from full daylight through the
// civil/nautical/astronomical twilight to night, with an orange tint (hue only) just past the
// terminator and the Sun's glint on the oceans. The land carries seasonal snow and the polar seas
// their sea ice (_nsGlobeSeasonTex), always.
// Behind it the sky at infinity: the stars (Display "Stars", the
// catalog of the Sky Map, precessed to the date), the planets and the Sun in their geocentric
// directions. The Moon at its true geocentric position and size (Meeus ch. 47,
// ~60 Earth radii away - in a view that frames the Earth it is usually outside the picture or
// small), its surface from NASA's LRO colour map (data/moon/) turned by the IAU rotation model,
// lit by the Sun pixel by pixel, with a faint line of its orbit over a month. Everything
// sits at its real distance, so the shadows are real too: the Earth's umbra and penumbra on the
// Moon at a lunar eclipse, the Moon's on the Earth at a solar eclipse. Distances are in Earth
// radii throughout.
//
// Frame: the camera lives in the equatorial (inertial) frame - x towards the March equinox, z the
// Earth's axis - and the Earth turns inside it by the Greenwich sidereal time, so as time runs the
// globe rotates under a fixed Sun while the day/night boundary stays put relative to it. Drag
// orbits the camera; two sliders (#nsGlobeCamCtl) set its distance from the Earth and its field of
// view, and the wheel or two fingers drive whichever of the two was used last; a double click
// turns the view back to the place. The camera starts aimed at the place at the time Globe is first opened.

let _nsGlobeLand = null;          // { rings: [[ [lon, lat], ... ], ...], polys: [[ring, ...], ...] }
let _nsGlobeTex = null;           // { w, h, data } equirectangular land/ocean colours
let _nsGlobeLoading = false;
// The camera: dist = its distance from the Earth's centre (Earth radii), fov = the full field of
// view across the shorter side of the view (degrees), each on its own slider, log scale. active =
// the slider the wheel / pinch drives (the last one used). Inside the Moon's orbit (< ~60) the
// Moon can be behind the camera; then it isn't drawn.
// subsolar: Display "Subsolar point" (under Sun). moonFixed: the canvas switch that draws the Moon
// at the Sun's radius whatever the camera, with its magnification shown beside it.
// body: what the camera orbits and looks at (the canvas switch EARTH | MOON) - 'earth', or 'moon':
// the camera then circles the Moon's centre and dist counts Moon radii; each body keeps its own
// camAz / camEl / dist (saved), the field of view is shared.
// frame (default 'ecliptic'): what the camera's orbit is levelled on (the canvas switch EQU | ECL | HOR) - 'equator':
// the Earth's axis is up and camAz/camEl are right ascension / declination of the camera's
// direction, the Earth turning under it with time; 'ecliptic': the ecliptic's north pole is up
// and camAz/camEl are ecliptic longitude / latitude (also fixed in space - the Earth's axis shows
// tilted by the obliquity, the Sun and nearly the Moon move along the level); 'horizon': the
// place's zenith is up and camAz/camEl are azimuth / altitude in the place's horizon frame, which
// turns with the Earth - the globe then stays put and the sky turns.
// orbit: Display "Moon's orbit" (Globe only, under Moon).
const _nsGlobe = { camAz: 0, camEl: 0.85, dist: 5, fov: 50, active: 'dist', aimed: false, interacting: false, subsolar: false, moonFixed: false, frame: 'ecliptic', orbit: true, body: 'earth', saved: {} };
function _nsGlobeSunR() { return _nightSkyBodyMinR() * 1.4; }   // the Sun's disc in the background, px
// The camera's elevation stops just short of the up axis (89.7°), where its sideways direction would
// be undefined - near enough that a held picked point (_nsGlobePickerApplyLock) can follow the sky
// over the place's zenith.
const NS_GLOBE_EL_MAX = 1.565;
const NS_GLOBE_DIST_MIN = 1.2, NS_GLOBE_DIST_MAX = 2000, NS_GLOBE_FOV_MIN = 0.2, NS_GLOBE_FOV_MAX = 120;
const NS_GLOBE_RE_KM = 6378.14, NS_GLOBE_MOON_RADIUS = 1737.4 / 6378.14, NS_GLOBE_SUN_RADIUS = 696000 / 6378.14;
const NS_GLOBE_OCEAN = [24, 64, 108], NS_GLOBE_LAND = [98, 128, 82];

function _nsGlobeActive() {
  return nightSkyActive && nightSkyTopView === 'visualization' && nightSkySubmode === 'globe';
}

// ── Data: TopoJSON -> rings -> equirectangular texture ──────────────────────────────────────────
// Arcs are quantized and delta-encoded (transform scale/translate); a polygon lists arc indices,
// ~i meaning arc i reversed, and consecutive arcs share their joining point.
function _nsGlobeDecode(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  });
  const ring = (ids) => {
    const pts = [];
    for (const i of ids) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      a.forEach((p, k) => { if (k > 0 || !pts.length) pts.push(p); });
    }
    return pts;
  };
  const polys = [];
  for (const g of topo.objects.land.geometries) {
    const list = g.type === 'Polygon' ? [g.arcs] : g.arcs;
    for (const poly of list) polys.push(poly.map(ring));
  }
  return { polys, rings: polys.flat() };
}
// world-atlas rings are spherical: a ring may cross the 180° meridian (Russia, Fiji) or go right
// round a pole (Antarctica). Drawn as they are on the flat map, such a ring spans the whole width
// and its fill comes out inverted. So each ring is unwrapped - consecutive longitudes kept within
// 180° of each other, the ring may then run past ±180° - and one that ends a full turn from where
// it began (it circles a pole) is closed over that pole; every polygon is drawn three times, 360°
// apart, so whatever lies past ±180° lands on the map's other edge.
function _nsGlobeUnwrapRing(ring) {
  const out = [];
  let prev = null, shift = 0;
  for (const [lon, lat] of ring) {
    if (prev !== null) {
      const d = lon + shift - prev;
      if (d > 180) shift -= 360; else if (d < -180) shift += 360;
    }
    prev = lon + shift;
    out.push([prev, lat]);
  }
  const turn = out[out.length - 1][0] - out[0][0];
  if (Math.abs(turn) > 180) {   // circles a pole: close the ring over it
    const pole = out.reduce((a, p) => a + p[1], 0) < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], pole], [out[0][0], pole]);
  }
  return out;
}
function _nsGlobeBuildTexture(land) {
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = `rgb(${NS_GLOBE_OCEAN})`; c.fillRect(0, 0, W, H);
  c.fillStyle = `rgb(${NS_GLOBE_LAND})`;
  for (const poly of land.polys) {
    const rings = poly.map(_nsGlobeUnwrapRing);
    for (const off of [-360, 0, 360]) {
      c.beginPath();
      for (const r of rings) r.forEach(([lon, lat], k) => {
        const x = (lon + off + 180) / 360 * W, y = (90 - lat) / 180 * H;
        if (k) c.lineTo(x, y); else c.moveTo(x, y);
      });
      c.fill('evenodd');
    }
  }
  return { w: W, h: H, data: c.getImageData(0, 0, W, H).data };
}
// ── Snow and sea ice ───────────────────────────────────────────────────────────────────────────
// A climatological model, not the snow of a given year: the season comes from the Sun's ecliptic
// longitude (lam, so it holds in any year and calendar), today's climate for every year.
// A land point is snowy when its effective latitude |lat| + mountain boost - longitude shift
// + noise lies poleward of the season's snow line of its hemisphere; the same for a sea point and
// the sea ice line. Each line follows the season along a cosine lagging behind the Sun:
//   north snow 45° (early Feb, lam 315°) .. 74° (Aug),  south snow 46° (Aug) .. 64° (Feb),
//   north ice 62° (mid Mar, lam 355°) .. 80° (Sep),     south ice 58° (Sep) .. 70° (Feb).
// The longitude shift (continentality, positive = milder) moves the line poleward over western
// Europe and the North Pacific coast and equatorward over Siberia and eastern North America
// (for the ice: the Atlantic's warm water open far north, Hudson Bay, the Sea of Okhotsk and the
// Bering Sea frozen further south); it counts fully in winter and 40 % (snow) / 50 % (ice) in
// summer. Mountain ranges add to the effective latitude (Gaussian blobs, no elevation data).
// Antarctica south of 60° and Greenland are ice all year. Snow fades in over 4° of effective
// latitude, broken up by value noise (±3°), so the edge is patchy, not ruled.
const NS_GLOBE_SNOW = [232, 238, 244], NS_GLOBE_SEAICE = [200, 214, 228];
const _nsGlobeSnowShift = [[5, 18, 9], [-125, 6, 6], [100, 30, -4], [-90, 15, -4]];   // lon, sigma, shift°
const _nsGlobeIceShift = [[5, 22, 12], [-85, 12, -10], [145, 12, -8], [-175, 12, -4]];
const _nsGlobeMountains = [   // lon, lat, sigma lon, sigma lat, boost°
  [86, 32, 12, 4.5, 24], [84, 29, 9, 1.5, 18],   // Tibet, the Himalaya on top of it
  [76, 40, 8, 3, 20], [90, 48, 6, 3, 8],         // Pamir / Tian Shan, Altai
  [10, 46.3, 4, 1.2, 22], [44, 42.8, 4, 1.2, 22], [14, 64, 5, 6, 6],   // Alps, Caucasus, Scandes
  [52, 34, 6, 3, 14], [35, 39, 6, 2, 10],        // Iranian ranges, Anatolia
  [-108, 39, 4, 6, 14], [-116, 50, 5, 7, 12], [-140, 61, 9, 3, 12],    // Rockies, Alaska / Coast Mts.
  [-71, -40, 2, 10, 12], [-68, -18, 3, 8, 28], [170, -43.5, 2, 2.5, 14]   // Andes, Altiplano, NZ Alps
];
let _nsGlobeSeason = null;   // { base, extra, landF, shSnow, shIce, tex, key }
function _nsGlobeSeasonPrep() {
  const { w: W, h: H, data: B } = _nsGlobeTex;
  const hash = (x, y, o) => { let n = (x * 374761393 + y * 668265263 + o * 2147483647) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (u, v, nx, o) => {   // value noise on an nx-wide lattice, wrapping in longitude
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(x0 % nx, y0, o), b = hash((x0 + 1) % nx, y0, o), c = hash(x0 % nx, y0 + 1, o), d = hash((x0 + 1) % nx, y0 + 1, o);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  const octaves = [[8, 1.8, 1], [3, 0.9, 2], [1, 0.45, 3]];   // cell (degrees), amplitude, seed
  const extra = new Float32Array(W * H), landF = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    for (let x = 0; x < W; x++) {
      const lon = (x + 0.5) / W * 360 - 180, i = y * W + x;
      landF[i] = Math.max(0, Math.min(1, (B[i * 4] - NS_GLOBE_OCEAN[0]) / (NS_GLOBE_LAND[0] - NS_GLOBE_OCEAN[0])));
      let e = 0, fine = 0;
      for (const [cell, amp, o] of octaves) {
        const n = vnoise((lon + 180) / cell, (lat + 90) / cell, 360 / cell, o);
        e += amp * (2 * n - 1);
        if (cell === 1) fine = n;
      }
      // A range's boost varies by +-40 % with the fine noise, so its snow comes out ragged, not
      // as a smooth ellipse.
      if (landF[i] > 0) for (const [mlon, mlat, sx, sy, b] of _nsGlobeMountains) {
        const dx = (lon - mlon) / sx, dy = (lat - mlat) / sy;
        if (dx * dx + dy * dy < 16) e += b * (0.6 + 0.8 * fine) * Math.exp(-0.5 * (dx * dx + dy * dy));
      }
      extra[i] = e;
    }
  }
  const shift = (list) => Float32Array.from({ length: W }, (_, x) => {
    const lon = (x + 0.5) / W * 360 - 180;
    return list.reduce((a, [c, s, d]) => { const dl = ((lon - c + 540) % 360) - 180; return a + d * Math.exp(-0.5 * (dl / s) ** 2); }, 0);
  });
  _nsGlobeSeason = { extra, landF, shSnow: shift(_nsGlobeSnowShift), shIce: shift(_nsGlobeIceShift), tex: null, key: null };
}
// The texture with snow and ice for the Sun's ecliptic longitude lam (degrees), rebuilt per degree
// of lam (about a day).
function _nsGlobeSeasonTex(lam) {
  if (!_nsGlobeSeason) _nsGlobeSeasonPrep();
  const S = _nsGlobeSeason, key = Math.round(lam) % 360;
  if (S.key === key) return S.tex;
  const { w: W, h: H, data: B } = _nsGlobeTex;
  const out = S.tex ? S.tex.data : new Uint8ClampedArray(B.length);
  const D2R = Math.PI / 180, c = (p) => Math.cos((key - p) * D2R);
  const sN = c(315), iN = c(355);   // +1 at the north's coldest, -1 at its mildest
  const snowN = 59.5 - 14.5 * sN, snowS = 55 + 9 * sN, iceN = 71 - 9 * iN, iceS = 64 + 6 * iN;   // the south's ice peaks half a year after the north's
  const wSnowN = 0.7 + 0.3 * sN, wIceN = 0.75 + 0.25 * iN;
  const ramp = (v) => { const u = Math.max(0, Math.min(1, (v + 2) / 4)); return u * u * (3 - 2 * u); };
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180, north = lat >= 0, alat = Math.abs(lat);
    const lineSnow = north ? snowN : snowS, lineIce = north ? iceN : iceS;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4, f = S.landF[i], e = S.extra[i];
      const lon = (x + 0.5) / W * 360 - 180;
      let snow = 0, ice = 0;
      if (f > 0) {
        if (lat < -60 || (lon > -73 && lon < -12 && lat > 59.5 && (lon < -26 || lat > 68))) snow = 1;   // Antarctica, Greenland (not Iceland)
        else snow = ramp(alat + e - (north ? S.shSnow[x] * wSnowN : 0) - lineSnow);
      }
      if (f < 1) ice = ramp(alat + e * 0.7 - (north ? S.shIce[x] * wIceN : 0) - lineIce);
      if (snow === 0 && ice === 0) { out[o] = B[o]; out[o + 1] = B[o + 1]; out[o + 2] = B[o + 2]; out[o + 3] = 255; continue; }
      for (let k = 0; k < 3; k++) {
        const land = NS_GLOBE_LAND[k] + (NS_GLOBE_SNOW[k] - NS_GLOBE_LAND[k]) * snow;
        const sea = NS_GLOBE_OCEAN[k] + (NS_GLOBE_SEAICE[k] - NS_GLOBE_OCEAN[k]) * ice;
        out[o + k] = land * f + sea * (1 - f);
      }
      out[o + 3] = 255;
    }
  }
  S.tex = { w: W, h: H, data: out }; S.key = key;
  return S.tex;
}
function _nsGlobeLoad() {
  if (_nsGlobeLand || _nsGlobeLoading) return;
  _nsGlobeLoading = true;
  fetch('data/earth/land-110m.json').then(r => r.json()).then(topo => {
    _nsGlobeLand = _nsGlobeDecode(topo);
    _nsGlobeTex = _nsGlobeBuildTexture(_nsGlobeLand);
    if (_nsGlobeActive()) drawNightSky();
  }).catch(err => console.warn('Globe: failed to load land data', err))
    .finally(() => { _nsGlobeLoading = false; });
}

// ── Frame and camera ────────────────────────────────────────────────────────────────────────────
function _nsGlobeTheta() {   // Greenwich sidereal angle, radians
  return _skyGMSTDeg(_skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)) * Math.PI / 180;
}
// Geographic lon/lat (deg, east positive) -> equatorial unit vector at sidereal angle theta.
function _nsGlobeVec(lon, lat, theta) {
  const l = lon * Math.PI / 180 + theta, b = lat * Math.PI / 180;
  return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}
function _nsGlobePlaceLonLat() {
  return { lon: lonHemisphere * LONG, lat: hemisphere * LAT };
}
function _nsGlobeAimAtPlace() {
  const p = _nsGlobePlaceLonLat();
  if (_nsGlobe.body === 'moon') {   // from the Earth's side: the near side, as the place sees it
    const M = _nsGlobeMoonNow(), m = Math.hypot(M[0], M[1], M[2]);
    _nsGlobeSetDir(M.map(v => -v / m));
  } else if (_nsGlobe.frame === 'horizon') {   // high above the place, from its south (north in the south)
    _nsGlobe.camAz = p.lat >= 0 ? Math.PI : 0;
    _nsGlobe.camEl = 1.25;
  } else {   // straight above the place: its direction, as angles of the frame
    const f = _nsGlobe.frame;
    _nsGlobe.frame = 'equator';
    _nsGlobe.camAz = p.lon * Math.PI / 180 + _nsGlobeTheta();
    _nsGlobe.camEl = Math.max(-1.45, Math.min(1.45, p.lat * Math.PI / 180));
    _nsGlobeSetFrame(f);
  }
  _nsGlobe.aimed = true;
}
// The ecliptic frame in equatorial coordinates (x towards the equinox): X, Y in the ecliptic plane,
// Z its north pole, tilted by the obliquity of date.
function _nsGlobeEclFrame() {
  const e = _moonMeanObliquityDeg(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)) * Math.PI / 180;
  return { X: [1, 0, 0], Y: [0, Math.cos(e), Math.sin(e)], Z: [0, -Math.sin(e), Math.cos(e)] };
}
// The axes the camera is levelled on, for the frame and the body orbited (unit vectors in the
// equatorial frame of date): camAz is measured from X towards Y, camEl from that plane towards Z,
// which is up. EQU: the orbited body's own axis up, fixed in space - the Earth's (X the equinox),
// or the Moon's (X the ascending node of its equator on the Earth's, _nsGlobeMoonFrame's N), so
// either turns under the camera, once a day or once a month. ECL: the ecliptic, for both. HOR:
// turning with the body - the place's horizon on the Earth (X north, Y east), the Moon's own body
// frame on the Moon (camAz / camEl the selenographic longitude / latitude), so the body stays put.
function _nsGlobeFrameAxes() {
  const f = _nsGlobe.frame, moon = _nsGlobe.body === 'moon';
  if (f === 'ecliptic') return _nsGlobeEclFrame();
  if (moon) {
    const F = _nsGlobeMoonFrame();
    return f === 'horizon' ? F : { X: F.N, Y: _sd3Cross(F.Z, F.N), Z: F.Z };
  }
  if (f === 'horizon') {
    const { Z, N, E } = _nsGlobeLocalFrame(_nsGlobeTheta());
    return { X: N, Y: E, Z };
  }
  return { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
}
// The camera's direction from the centre it orbits and the up it is levelled on.
function _nsGlobeCamDir() {
  const a = _nsGlobe.camAz, e = _nsGlobe.camEl, { X, Y, Z } = _nsGlobeFrameAxes();
  return { o: [0, 1, 2].map(i => Math.cos(e) * (Math.cos(a) * X[i] + Math.sin(a) * Y[i]) + Math.sin(e) * Z[i]), up: Z };
}
// Point the camera along the direction o (unit), as angles of the current frame.
function _nsGlobeSetDir(o) {
  const { X, Y, Z } = _nsGlobeFrameAxes();
  _nsGlobe.camEl = Math.max(-NS_GLOBE_EL_MAX, Math.min(NS_GLOBE_EL_MAX, Math.asin(Math.max(-1, Math.min(1, _sd3Dot(o, Z))))));
  _nsGlobe.camAz = Math.atan2(_sd3Dot(o, Y), _sd3Dot(o, X));
}
// Switch the frame keeping the view: the same direction, re-expressed as the new frame's angles.
function _nsGlobeSetFrame(frame) {
  if (frame === _nsGlobe.frame) return;
  const { o } = _nsGlobeCamDir();
  _nsGlobe.frame = frame;
  _nsGlobeSetDir(o);
}
// The camera orbits the Earth's centre, or in the Moon view the Moon's (dist in Moon radii); the
// scene stays Earth-centred either way, so dist0 (the camera's distance from the Earth's centre)
// still sizes the globe.
function _nsGlobeCamera() {
  const moonView = _nsGlobe.body === 'moon';
  const d = _nsGlobe.dist * (moonView ? NS_GLOBE_MOON_RADIUS : 1);
  const C = moonView ? _nsGlobeMoonNow() : [0, 0, 0];
  const { o, up: worldUp } = _nsGlobeCamDir();
  const pos = [C[0] + d * o[0], C[1] + d * o[1], C[2] + d * o[2]];
  const fwd = [-o[0], -o[1], -o[2]];
  let right = _sd3Cross(fwd, worldUp);
  const rl = Math.hypot(right[0], right[1], right[2]) || 1;
  right = right.map(v => v / rl);
  return { d, pos, fwd, right, up: _sd3Cross(right, fwd), F: 1 / Math.tan(_nsGlobe.fov / 2 * Math.PI / 180), dist0: Math.hypot(pos[0], pos[1], pos[2]) };
}
// Farther from the camera than the Earth's centre (the far half of the Moon's orbit, a Moon behind).
function _nsGlobeBeyondEarth(cam, v) {
  return Math.hypot(v[0] - cam.pos[0], v[1] - cam.pos[1], v[2] - cam.pos[2]) > cam.dist0;
}
function _nsGlobeProject(cam, L, v) {
  const rel = [v[0] - cam.pos[0], v[1] - cam.pos[1], v[2] - cam.pos[2]];
  const lz = _sd3Dot(rel, cam.fwd);
  return {
    x: L.cx + cam.F * _sd3Dot(rel, cam.right) / lz * L.scale,
    y: L.cy - cam.F * _sd3Dot(rel, cam.up) / lz * L.scale,
    ahead: lz > 1e-6,   // in front of the camera (from the Moon the Earth can be behind it)
    visible: lz > 1e-6 && _sd3Dot(v, cam.pos) >= 1,   // on the Earth's half that faces the camera
  };
}
// Polyline on the sphere, broken where it passes to the far side.
function _nsGlobeStroke(ctx, cam, L, vecs) {
  let open = false;
  ctx.beginPath();
  for (const v of vecs) {
    const p = _nsGlobeProject(cam, L, v);
    if (!p.visible) { open = false; continue; }
    if (open) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); open = true; }
  }
  ctx.stroke();
}

// ── Drawing ─────────────────────────────────────────────────────────────────────────────────────
function _nightSkyDrawGlobe(ctx, w, h) {
  _nsGlobeLoad();
  _nsGlobeLoadMoonTex();
  _nsGlobeSyncUI();   // keeps EARTH | MOON centred when the view is resized
  if (!_nsGlobe.aimed) _nsGlobeAimAtPlace();
  _nsGlobePickerApplyLock();
  const lt = document.body.classList.contains('light');
  const L = { cx: w / 2, cy: h / 2, scale: Math.min(w, h) / 2 * 0.9 };
  const cam = _nsGlobeCamera();
  const theta = _nsGlobeTheta();
  const ec = _nsGlobeProject(cam, L, [0, 0, 0]);   // the Earth's centre on screen
  const rs = cam.F / Math.sqrt(cam.dist0 * cam.dist0 - 1) * L.scale;   // the globe's radius on screen
  const EL = { cx: ec.x, cy: ec.y, scale: L.scale };
  const sunEq = _nightSkySunRaDec(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const sunDir = _skyDomeUnitVec(90 - sunEq.ra, sunEq.dec);   // (cos δ cos α, cos δ sin α, sin δ)

  // Globe always shows the Sun and the Moon (Display keeps only their paths and Subsolar point).
  const moon = _nsGlobeMoon(cam);
  _nsGlobeDrawSky(ctx, L, cam, sunDir);
  if (moon) { if (_nsGlobe.orbit) _nsGlobeDrawMoonOrbit(ctx, L, cam, moon, false); if (moon.behind) _nsGlobeDrawMoon(ctx, L, cam, moon, sunDir, w, h); }

  // From the Moon the Earth can be behind the camera: then no globe at all (its edge strokes and
  // marks drop out by themselves, _nsGlobeProject's visible).
  const earthAhead = -_sd3Dot(cam.pos, cam.fwd) > 1;
  if (earthAhead) {
    // Atmosphere: a thin blue halo just outside the limb.
    const halo = ctx.createRadialGradient(EL.cx, EL.cy, rs * 0.98, EL.cx, EL.cy, rs * 1.07);
    halo.addColorStop(0, lt ? 'rgba(90,150,230,0.55)' : 'rgba(110,170,255,0.45)');
    halo.addColorStop(1, 'rgba(110,170,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(EL.cx, EL.cy, rs * 1.07, 0, Math.PI * 2); ctx.fill();

    if (!_nsGlobeTex) {
      ctx.fillStyle = `rgb(${NS_GLOBE_OCEAN})`;
      ctx.beginPath(); ctx.arc(EL.cx, EL.cy, rs, 0, Math.PI * 2); ctx.fill();
    } else {
      // The season for the snow: the Sun's ecliptic longitude from its direction of date.
      const eps = 23.44 * Math.PI / 180;
      const lam = Math.atan2(sunDir[1] * Math.cos(eps) + sunDir[2] * Math.sin(eps), sunDir[0]) * 180 / Math.PI;
      _nsGlobeDrawSurface(ctx, L, EL, cam, rs, theta, sunDir, w, h, moon, _nsGlobeSeasonTex((lam + 360) % 360));
    }
  }

  // Graticule every 30°, the equator a little stronger; coastlines on top.
  ctx.lineWidth = 0.8; ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  for (let lon = -180; lon < 180; lon += 30) {
    const vs = []; for (let lat = -90; lat <= 90; lat += 3) vs.push(_nsGlobeVec(lon, lat, theta));
    _nsGlobeStroke(ctx, cam, L, vs);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.strokeStyle = lat === 0 ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.16)';
    const vs = []; for (let lon = -180; lon <= 180; lon += 3) vs.push(_nsGlobeVec(lon, lat, theta));
    _nsGlobeStroke(ctx, cam, L, vs);
  }
  if (_nsGlobeLand) {
    ctx.strokeStyle = 'rgba(225,235,220,0.45)'; ctx.lineWidth = 0.8;
    for (const r of _nsGlobeLand.rings) _nsGlobeStroke(ctx, cam, L, r.map(([lon, lat]) => _nsGlobeVec(lon, lat, theta)));
  }

  const showNames = document.getElementById('chkNightSkyNames').checked;
  if (moon && _nsGlobe.orbit) _nsGlobeDrawMoonOrbit(ctx, L, cam, moon, true);
  ctx.font = "11px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  // The subsolar point (Display "Subsolar point" under Sun): where the Sun stands at the zenith - a
  // small, plain mark.
  if (_nsGlobe.subsolar) {
    const p = _nsGlobeProject(cam, L, sunDir);
    if (p.visible) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(232,160,32,0.85)'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
      if (showNames) {
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.fillStyle = 'rgba(232,160,32,0.85)'; ctx.fillText('subsolar point', p.x + 6, p.y);
        ctx.font = "11px 'Share Tech Mono', monospace";
      }
    }
  }
  _nsGlobeDrawSurfaceOverlays(ctx, L, cam, theta);
  _nsGlobeDrawPlace(ctx, L, cam, theta, showNames, lt);
  // A Moon nearer than the Earth's centre goes over the globe and everything marked on it.
  if (moon && !moon.behind) _nsGlobeDrawMoon(ctx, L, cam, moon, sunDir, w, h);
  _nsGlobePickerDrawMarker(ctx, L, cam);
}
// The place from Location.
function _nsGlobeDrawPlace(ctx, L, cam, theta, showNames, lt) {
  const pl = _nsGlobePlaceLonLat();
  const pp = _nsGlobeProject(cam, L, _nsGlobeVec(pl.lon, pl.lat, theta));
  if (pp.visible) {
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3b30'; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    if (showNames) {
      ctx.fillStyle = lt ? '#2a2a2a' : '#ffffff';
      ctx.fillText(Math.abs(pl.lat).toFixed(2) + '° ' + (pl.lat >= 0 ? 'N' : 'S') + '  '
        + Math.abs(pl.lon).toFixed(2) + '° ' + (pl.lon >= 0 ? 'E' : 'W'), pp.x + 9, pp.y);
    }
  }
}

// ── The sky around the globe ────────────────────────────────────────────────────────────────────
// A direction at infinity projected through the camera (null behind it).
function _nsGlobeProjectDir(cam, L, v) {
  const lz = _sd3Dot(v, cam.fwd);
  if (lz <= 0.02) return null;
  return { x: L.cx + cam.F * _sd3Dot(v, cam.right) / lz * L.scale, y: L.cy - cam.F * _sd3Dot(v, cam.up) / lz * L.scale };
}
// Stars, planets and the Sun as the background; the globe is drawn over them, so whatever it hides
// needs no test. Stars and planets come in J2000 and are precessed to the date (one matrix).
let _nsGlobeStarVecs = null;
function _nsGlobeDrawSky(ctx, L, cam, sunDir) {
  const chk = (id) => document.getElementById(id).checked;
  const jde = _moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const m = _skyPrecessionMatrix(jde);
  const toDate = (v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
  const showNames = chk('chkNightSkyNames');
  ctx.font = "10px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  _nsGlobeDrawSkyOverlays(ctx, L, cam, toDate);
  if (chk('chkNightSkyStars') && _skyDataLoaded) {
    if (!_nsGlobeStarVecs || _nsGlobeStarVecs.n !== _skyStars.length) {
      _nsGlobeStarVecs = { n: _skyStars.length, list: _skyStars.map(st => ({ v: _skyDomeUnitVecRaDec({ ra: st.raDeg, dec: st.decDeg }), r: _nightSkyStarSize(st.mag) })) };
    }
    ctx.fillStyle = _nightSkyStarColor();
    for (const st of _nsGlobeStarVecs.list) {
      const p = _nsGlobeProjectDir(cam, L, toDate(st.v));
      if (!p) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, st.r * 0.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (chk('chkNightSkyPlanets')) {
    for (const pl of _planetPositions(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)) {
      const p = _nsGlobeProjectDir(cam, L, toDate(_skyDomeUnitVecRaDec({ ra: pl.raDeg, dec: pl.decDeg })));
      if (!p) continue;
      const r = _planetDrawDot(ctx, p.x, p.y, pl, 1);
      if (showNames) { ctx.fillStyle = pl.color; ctx.fillText(pl.name, p.x + r + 4, p.y); }
    }
  }
  if (sunDir) {
    const p = _nsGlobeProjectDir(cam, L, sunDir);
    if (p) {
      const r = _nsGlobeSunR();
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
      g.addColorStop(0, 'rgba(255,214,120,0.75)'); g.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = g; ctx.fillRect(p.x - r * 5, p.y - r * 5, r * 10, r * 10);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = '#ffd36b'; ctx.fill();
      if (showNames) { ctx.fillStyle = '#e8a020'; ctx.fillText('Sun', p.x + r + 5, p.y); }
    }
  }
}

// The Sky Map's Display overlays (the same checkboxes as the other views), on the sky around the
// globe: Constellation lines; Equatorial grid (parallels every 30°, meridians every 2 h);
// Ecliptic; and, from the place in Location, its Az/Alt grid (altitude circles at 30° and 60°,
// azimuth every 30°) with its horizon - the directions it sees, drawn at infinity.
function _nsGlobeStrokeDirs(ctx, cam, L, dirs) {
  let open = false;
  ctx.beginPath();
  for (const v of dirs) {
    const p = _nsGlobeProjectDir(cam, L, v);
    if (!p) { open = false; continue; }
    if (open) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); open = true; }
  }
  ctx.stroke();
}
function _nsGlobeLocalFrame(theta) {   // zenith, north, east of the place, equatorial frame
  const pl = _nsGlobePlaceLonLat();
  const Z = _nsGlobeVec(pl.lon, pl.lat, theta);
  let N = [-Z[2] * Z[0], -Z[2] * Z[1], 1 - Z[2] * Z[2]];
  const nl = Math.hypot(N[0], N[1], N[2]) || 1;
  N = N.map(v => v / nl);
  return { Z, N, E: _sd3Cross(N, Z) };
}
function _nsGlobeDrawSkyOverlays(ctx, L, cam, toDate) {
  const chk = (id) => document.getElementById(id).checked;
  const Y = nightSkyYear, Mo = nightSkyMonth, D = nightSkyDay, H = nightSkyHourUT;
  ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([]);
  if (chk('chkNightSkyLines') && _skyDataLoaded) {
    ctx.strokeStyle = 'rgba(120,160,220,0.5)';
    for (const c of _skyConstellations) for (const line of c.lines) {
      _nsGlobeStrokeDirs(ctx, cam, L, line.map(([ra, dec]) => toDate(_skyDomeUnitVecRaDec({ ra: (ra + 360) % 360, dec }))));
    }
  }
  if (chk('chkNightSkyEquatorial')) {
    ctx.strokeStyle = 'rgba(224,120,120,0.45)';
    for (let dec = -60; dec <= 60; dec += 30) {
      const vs = []; for (let ra = 0; ra <= 360; ra += 5) vs.push(_skyDomeUnitVecRaDec({ ra, dec }));
      _nsGlobeStrokeDirs(ctx, cam, L, vs);
    }
    for (let ra = 0; ra < 360; ra += 30) {
      const vs = []; for (let dec = -90; dec <= 90; dec += 5) vs.push(_skyDomeUnitVecRaDec({ ra, dec }));
      _nsGlobeStrokeDirs(ctx, cam, L, vs);
    }
  }
  if (chk('chkNightSkyEcliptic')) {
    const eps = _moonMeanObliquityDeg(_moonJDE(Y, Mo, D, H));
    const vs = []; for (let lam = 0; lam <= 360; lam += 4) vs.push(_skyDomeUnitVecRaDec(_moonEclToEq(lam, 0, eps)));
    ctx.strokeStyle = NIGHTSKY_ECLIPTIC_COLOR; ctx.lineWidth = NIGHTSKY_ECLIPTIC_WIDTH;
    _nsGlobeStrokeDirs(ctx, cam, L, vs);
    ctx.lineWidth = 1;
  }
  if (chk('chkNightSkyGrid')) {   // the place's Az/Alt grid, its horizon with it
    const { Z, N, E } = _nsGlobeLocalFrame(_nsGlobeTheta());
    const dir = (az, alt) => {
      const a = az * Math.PI / 180, h = alt * Math.PI / 180;
      return [0, 1, 2].map(i => Math.cos(h) * (Math.cos(a) * N[i] + Math.sin(a) * E[i]) + Math.sin(h) * Z[i]);
    };
    const circle = (alt) => { const vs = []; for (let az = 0; az <= 360; az += 4) vs.push(dir(az, alt)); return vs; };
    ctx.strokeStyle = _nightSkyGridLineColor();
    for (const alt of [30, 60]) _nsGlobeStrokeDirs(ctx, cam, L, circle(alt));
    for (let az = 0; az < 360; az += 30) { const vs = []; for (let alt = 0; alt <= 90; alt += 3) vs.push(dir(az, alt)); _nsGlobeStrokeDirs(ctx, cam, L, vs); }
    {
      ctx.strokeStyle = document.body.classList.contains('light') ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      _nsGlobeStrokeDirs(ctx, cam, L, circle(0));
    }
  }
  ctx.restore();
}

// After the globe: the Earth's axis beyond the poles (Equatorial grid; hidden where the Earth is in
// front of it) and, on the surface, the ground tracks of the Sun and the Moon over ±12 h (Sun's
// path / Moon's path): the subsolar and sublunar points, each taken back into the Earth's own
// frame at its time (longitude = right ascension − Greenwich sidereal time) and drawn on the globe
// as it is turned now.
function _nsGlobeOccluded(cam, P) {
  const d = [P[0] - cam.pos[0], P[1] - cam.pos[1], P[2] - cam.pos[2]];
  const a = _sd3Dot(d, d), b = 2 * _sd3Dot(cam.pos, d), c = _sd3Dot(cam.pos, cam.pos) - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1;
}
let _nsGlobeTrackCache = { key: null };
function _nsGlobeTracks() {
  const jd = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const key = [jd.toFixed(5)].join();
  if (_nsGlobeTrackCache.key === key) return _nsGlobeTrackCache;
  const sun = [], moon = [];
  for (let h = -12; h <= 12; h += 1 / 6) {
    const t = jd + h / 24, r = _skyFromJulianDateUT(t);
    const gmst = _skyGMSTDeg(t);
    const se = _nightSkySunRaDec(r.year, r.month, r.day, r.hourUT);
    sun.push([se.ra - gmst, se.dec]);
    const jde = _moonJDE(r.year, r.month, r.day, r.hourUT), me = _moonEclipticOfDate(jde);
    const mq = _moonEclToEq(me.lambda, me.beta, _moonMeanObliquityDeg(jde));
    moon.push([mq.ra - gmst, mq.dec]);
  }
  _nsGlobeTrackCache = { key, sun, moon };
  return _nsGlobeTrackCache;
}
function _nsGlobeDrawSurfaceOverlays(ctx, L, cam, theta) {
  const chk = (id) => document.getElementById(id).checked;
  ctx.save(); ctx.setLineDash([]);
  if (chk('chkNightSkyEquatorial')) {
    const axisCol = document.body.classList.contains('light') ? 'rgba(160,40,40,0.95)' : 'rgba(240,150,150,0.95)';
    ctx.strokeStyle = axisCol; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    for (const sgn of [1, -1]) {
      ctx.beginPath();
      let open = false;
      for (let k = 1; k <= 1.6; k += 0.02) {
        const P = [0, 0, sgn * k];
        const p = _nsGlobeProject(cam, L, P);
        if (_nsGlobeOccluded(cam, P) || !p.ahead) { open = false; continue; }
        if (open) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); open = true; }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (chk('chkNightSkyNames')) {
      ctx.font = "10px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = axisCol;
      for (const [sgn, txt] of [[1, 'NCP'], [-1, 'SCP']]) {
        const P = [0, 0, sgn * 1.6];
        if (!_nsGlobeOccluded(cam, P)) { const p = _nsGlobeProject(cam, L, P); ctx.fillText(txt, p.x + 5, p.y); }
      }
    }
  }
  const tr = showNightSkySunPath || showNightSkyMoonPath ? _nsGlobeTracks() : null;
  const track = (pts, fill) => {
    const vs = pts.map(([lon, lat]) => _nsGlobeVec(lon, lat, theta));
    ctx.lineWidth = 3.5; ctx.strokeStyle = NIGHTSKY_SUN_PATH_COLOR_OUTLINE; _nsGlobeStroke(ctx, cam, L, vs);
    ctx.lineWidth = 1.5; ctx.strokeStyle = fill; _nsGlobeStroke(ctx, cam, L, vs);
  };
  if (tr && showNightSkySunPath) track(tr.sun, NIGHTSKY_SUN_PATH_COLOR_FILL);
  if (tr && showNightSkyMoonPath) track(tr.moon, MOON_PATH_COLOR_FILL);
  ctx.restore();
}

// ── The Moon ────────────────────────────────────────────────────────────────────────────────────
// Its geocentric position of date (Meeus ch. 47, the same series as everywhere in Night Sky), in
// Earth radii (c; t is the same point, kept for the shadow code). behind: farther from the camera
// than the Earth's centre, so drawn before the globe (which may then cover it).
function _nsGlobeMoonPosAt(jdUT) {
  const r = _skyFromJulianDateUT(jdUT);
  const jde = _moonJDE(r.year, r.month, r.day, r.hourUT);
  const e = _moonEclipticOfDate(jde);
  const k = e.dist / NS_GLOBE_RE_KM;
  return _skyDomeUnitVecRaDec(_moonEclToEq(e.lambda, e.beta, _moonMeanObliquityDeg(jde))).map(v => v * k);
}
// ── The Moon's surface: NASA SVS CGI Moon Kit colour map (LRO LROC WAC, data/moon/, NOTICE.md) ──
// Equirectangular, centred on 0° selenographic longitude, east to the right. At load it is recast
// in the globe's flat, muted manner: its brightness is stretched between the 2nd and 98th
// percentile and mapped from mare grey to highland grey (NS_GLOBE_MARE .. NS_GLOBE_HIGHLAND, as
// muted as the Earth's land and sea), with a third of the map's own tint kept (the bluish and
// brownish maria).
const NS_GLOBE_MARE = [92, 94, 100], NS_GLOBE_HIGHLAND = [208, 203, 190];
// The Moon's night side: the map at this fraction (earthshine). The Earth's umbra: refracted light
// at most this fraction of full light, in this copper tint (red kept, blue nearly gone).
const NS_GLOBE_MOON_NIGHT = 0.08, NS_GLOBE_UMBRA_LIGHT = 0.32, NS_GLOBE_UMBRA_TINT = [1.15, 0.42, 0.17];
let _nsGlobeMoonTex = null, _nsGlobeMoonTexLoading = false;
function _nsGlobeLoadMoonTex() {
  if (_nsGlobeMoonTex || _nsGlobeMoonTexLoading) return;
  _nsGlobeMoonTexLoading = true;
  const img = new Image();
  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'); c.drawImage(img, 0, 0);
    const src = c.getImageData(0, 0, W, H).data, n = W * H;
    const lum = new Float32Array(n), hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2];
      lum[i] = l; hist[Math.min(255, l | 0)]++;
    }
    const pct = (q) => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= q * n) return v; } return 255; };
    const lo = pct(0.02), hi = Math.max(lo + 1, pct(0.98));
    const data = new Uint8ClampedArray(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.max(0, Math.min(1, (lum[i] - lo) / (hi - lo)));
      for (let k = 0; k < 3; k++)
        data[i * 3 + k] = NS_GLOBE_MARE[k] + (NS_GLOBE_HIGHLAND[k] - NS_GLOBE_MARE[k]) * u + (src[i * 4 + k] - lum[i]) / 3;
    }
    _nsGlobeMoonTex = { w: W, h: H, data };
    if (_nsGlobeActive()) drawNightSky();
  };
  img.onerror = () => console.warn('Globe: failed to load the Moon map');
  img.src = 'data/moon/lroc_color_2k.jpg';
}
// The Moon's body frame (X towards 0° selenographic longitude on its equator, Z its north pole) in
// the equatorial frame of date, from the IAU WGCCRE 2009 rotation model (pole and prime meridian
// in ICRF with the periodic terms E1..E13, i.e. the physical libration; the geometric one follows
// from the Moon's position), precessed to the date; N: the ascending node of its equator on the
// ICRF equator (fixed in space but for the slow precession), for EQU in the Moon view. Cached by
// instant.
let _nsGlobeMoonFrameCache = { jde: null, f: null };
function _nsGlobeMoonFrame() {
  const jde = _moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  if (_nsGlobeMoonFrameCache.jde === jde) return _nsGlobeMoonFrameCache.f;
  const d = jde - 2451545.0, T = d / 36525, R = Math.PI / 180;
  const E = [125.045 - 0.0529921 * d, 250.089 - 0.1059842 * d, 260.008 + 13.0120009 * d, 176.625 + 13.3407154 * d,
    357.529 + 0.9856003 * d, 311.589 + 26.4057084 * d, 134.963 + 13.0649930 * d, 276.617 + 0.3287146 * d,
    34.226 + 1.7484877 * d, 15.134 - 0.1589763 * d, 119.743 + 0.0036096 * d, 239.961 + 0.1643573 * d,
    25.053 + 12.9590088 * d].map(v => v * R);
  const sn = E.map(Math.sin), cs = E.map(Math.cos);
  const a0 = (269.9949 + 0.0031 * T - 3.8787 * sn[0] - 0.1204 * sn[1] + 0.0700 * sn[2] - 0.0172 * sn[3]
    + 0.0072 * sn[5] - 0.0052 * sn[9] + 0.0043 * sn[12]) * R;
  const d0 = (66.5392 + 0.0130 * T + 1.5419 * cs[0] + 0.0239 * cs[1] - 0.0278 * cs[2] + 0.0068 * cs[3]
    - 0.0029 * cs[5] + 0.0009 * cs[6] + 0.0008 * cs[9] - 0.0009 * cs[12]) * R;
  const W = (38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.5610 * sn[0] + 0.1208 * sn[1] - 0.0642 * sn[2]
    + 0.0158 * sn[3] + 0.0252 * sn[4] - 0.0066 * sn[5] - 0.0047 * sn[6] - 0.0046 * sn[7] + 0.0028 * sn[8]
    + 0.0052 * sn[9] + 0.0040 * sn[10] + 0.0019 * sn[11] - 0.0044 * sn[12]) * R;
  const Z = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const N = [-Math.sin(a0), Math.cos(a0), 0];   // the ascending node of the Moon's equator on the ICRF equator
  const ZN = _sd3Cross(Z, N);
  const X = [0, 1, 2].map(i => Math.cos(W) * N[i] + Math.sin(W) * ZN[i]);
  const m = _skyPrecessionMatrix(jde);
  const toDate = (v) => [0, 1, 2].map(i => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
  const Xd = toDate(X), Zd = toDate(Z);
  const f = { X: Xd, Y: _sd3Cross(Zd, Xd), Z: Zd, N: toDate(N) };
  _nsGlobeMoonFrameCache = { jde, f };
  return f;
}
// The Moon's position at the selected instant, cached by instant (the camera asks for it often).
let _nsGlobeMoonNowCache = { jd: null, c: null };
function _nsGlobeMoonNow() {
  const jd = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  if (_nsGlobeMoonNowCache.jd !== jd) _nsGlobeMoonNowCache = { jd, c: _nsGlobeMoonPosAt(jd) };
  return _nsGlobeMoonNowCache.c;
}
let _nsGlobeOrbitCache = { key: null, pts: null };
function _nsGlobeMoon(cam) {
  const jd = _skyToJulianDateUT(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
  const c = _nsGlobeMoonNow(), t = c;
  // The orbit over one sidereal month around now, in 6-hour steps; recomputed once per day.
  const key = Math.floor(jd);
  if (_nsGlobeOrbitCache.key !== key) {
    const pts = [];
    for (let dt = -13.7; dt <= 13.7; dt += 0.25) pts.push(_nsGlobeMoonPosAt(key + 0.5 + dt));
    _nsGlobeOrbitCache = { key, pts };
  }
  return { c, t, behind: _nsGlobeBeyondEarth(cam, c), orbit: _nsGlobeOrbitCache.pts };
}
// The Sun's distance (Earth radii) at the selected instant - sets the shadow cones' angles.
function _nsGlobeSunDist() {
  return _skySunEclipticOfDate(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)).dist / NS_GLOBE_RE_KM;
}
// The orbit line in two passes: the part beyond the plane through the Earth's centre facing the
// camera before the globe, the near part after it.
function _nsGlobeDrawMoonOrbit(ctx, L, cam, moon, near) {
  ctx.save();
  ctx.strokeStyle = 'rgba(190,205,235,0.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  ctx.beginPath();
  let open = false;
  for (const v of moon.orbit) {
    const isNear = !_nsGlobeBeyondEarth(cam, v);
    const lz = (v[0] - cam.pos[0]) * cam.fwd[0] + (v[1] - cam.pos[1]) * cam.fwd[1] + (v[2] - cam.pos[2]) * cam.fwd[2];
    if (isNear !== near || lz < 0.5) { open = false; continue; }   // also not behind the camera
    const p = _nsGlobeProject(cam, L, v);
    if (open) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); open = true; }
  }
  ctx.stroke();
  ctx.restore();
}
// The Moon pixel by pixel, like the globe: a ray from the camera meets the Moon's sphere; the
// point's selenographic longitude / latitude (_nsGlobeMoonFrame) picks its colour from the map
// (plain cream until the map has loaded). The surface is lit where it faces the Sun (nearly flat
// brightness, as the real Moon looks, with a softened terminator); the night side keeps the map,
// dimmed to NS_GLOBE_MOON_NIGHT of it (faint earthshine, the structure still visible). Then the
// Earth's shadow from the real geometry: behind the Earth, along the anti-Sun axis, a point at
// distance t past the Earth's centre and rho from the axis is in the umbra when
// rho < ru = Re' - t (Rs - Re') / Ds and in the penumbra when rho < rp = Re' + t (Rs + Re') / Ds
// (Re' = 1.01 Re, the atmosphere's enlargement as in NASA's predictions, §22.28). Two lights add
// up, so the shadow has no step anywhere: the direct sunlight is the part of the Sun's disc still
// showing past the Earth's limb - a circular segment whose height runs from 0 at the umbra's edge
// to the full disc at the penumbra's, so the penumbra darkens slowly at first and steeply near the
// umbra, as it does; and the sunlight bent into the shadow by the Earth's atmosphere, coloured
// NS_GLOBE_UMBRA_TINT, at most NS_GLOBE_UMBRA_LIGHT of full light at the umbra's edge, falling
// to 35 % of that at its centre and fading out a little past the edge (the edge's real blur).
// The umbra is so never brighter than the penumbra next to it. The refracted light comes up with
// the eclipse's depth (tintVis below): dim and grey in the partial phase, full copper in totality. Without the Sun: a full, evenly
// lit disc. With the canvas switch moonFixed the disc is drawn at the Sun's radius whatever
// the camera: each buffer pixel samples the true-size Moon at its offset from the centre divided
// by the magnification, which is then shown beside the Moon (×n).
function _nsGlobeDrawMoon(ctx, L, cam, moon, sun, w, h) {
  const M = moon.c, Rm = NS_GLOBE_MOON_RADIUS;
  const rel = M.map((v, i) => v - cam.pos[i]);
  const moonView = _nsGlobe.body === 'moon';
  if (_sd3Dot(rel, cam.fwd) < (moonView ? 0 : 2 * Rm)) return;   // behind the camera
  const pc = _nsGlobeProject(cam, L, M);
  const dist = Math.hypot(rel[0], rel[1], rel[2]);
  const rTrue = cam.F * Rm / Math.sqrt(Math.max(1e-9, dist * dist - Rm * Rm)) * L.scale;
  const fixed = _nsGlobe.moonFixed && !moonView;   // MOON = SUN only from the Earth's side
  const rpx = fixed ? _nsGlobeSunR() : rTrue, mag = rpx / rTrue;   // drawn radius, magnification
  const showNames = document.getElementById('chkNightSkyNames').checked;
  const Mt = moon.t;
  if (!fixed && rpx < 1.5) {   // a dot when far zoomed out
    ctx.beginPath(); ctx.arc(pc.x, pc.y, 1.5, 0, Math.PI * 2); ctx.fillStyle = '#f4eab8'; ctx.fill();
  } else {
    const x0 = Math.max(0, Math.floor(pc.x - rpx)), y0 = Math.max(0, Math.floor(pc.y - rpx));
    const bw = Math.min(w, Math.ceil(pc.x + rpx)) - x0, bh = Math.min(h, Math.ceil(pc.y + rpx)) - y0;
    if (bw > 0 && bh > 0) {
      const q = Math.min(1, Math.sqrt(NS_GLOBE_MAX_PX / (bw * bh)));
      const sw = Math.max(1, Math.ceil(bw * q)), shh = Math.max(1, Math.ceil(bh * q));
      const buf = new ImageData(sw, shh), px = buf.data;
      const F = cam.F, P = cam.pos, R = cam.right, U = cam.up, Fw = cam.fwd;
      const O = [P[0] - M[0], P[1] - M[1], P[2] - M[2]], cc = _sd3Dot(O, O) - Rm * Rm;
      const Ds = _nsGlobeSunDist(), Rs = NS_GLOBE_SUN_RADIUS, Re = 1.01;
      const MT = _nsGlobeMoonTex, MF = MT ? _nsGlobeMoonFrame() : null, D2R = Math.PI / 180;
      // How far the eclipse has got: the share of the Moon's diameter inside the umbra (0..1, 1 =
      // total). The copper light shows only as the Moon goes deep in - while much of the disc is
      // still in sunlight the eye (or a camera) is set for that, and the umbra looks dark grey.
      // tintVis = depth^3 sets both how strong the refracted light is (25 % .. 100 %) and how
      // much of its colour shows (grey .. full tint): ~1/8 at half way, ~1/2 at 80 %, full in totality.
      let tintVis = 0;
      if (sun) {
        const tc = -_sd3Dot(Mt, sun);
        if (tc > 0) {
          const rc = Math.hypot(Mt[0] + tc * sun[0], Mt[1] + tc * sun[1], Mt[2] + tc * sun[2]);
          const ruc = Re - tc * (Rs - Re) / Ds;
          tintVis = Math.max(0, Math.min(1, (ruc - (rc - Rm)) / (2 * Rm))) ** 3;
        }
      }
      const tintGrey = 0.2126 * NS_GLOBE_UMBRA_TINT[0] + 0.7152 * NS_GLOBE_UMBRA_TINT[1] + 0.0722 * NS_GLOBE_UMBRA_TINT[2];
      const tint = NS_GLOBE_UMBRA_TINT.map(c => (0.25 + 0.75 * tintVis) * (tintGrey + (c - tintGrey) * tintVis));
      for (let j = 0; j < shh; j++) {
        const sy = -((pc.y + ((y0 + (j + 0.5) / q) - pc.y) / mag) - L.cy) / L.scale;
        for (let i = 0; i < sw; i++) {
          const sx = ((pc.x + ((x0 + (i + 0.5) / q) - pc.x) / mag) - L.cx) / L.scale;
          let dx = F * Fw[0] + sx * R[0] + sy * U[0], dy = F * Fw[1] + sx * R[1] + sy * U[1], dz = F * Fw[2] + sx * R[2] + sy * U[2];
          const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
          const b = O[0] * dx + O[1] * dy + O[2] * dz, disc = b * b - cc;
          if (disc < 0) continue;
          const t = -b - Math.sqrt(disc);
          const hx = P[0] + t * dx, hy = P[1] + t * dy, hz = P[2] + t * dz;
          const nx = (hx - M[0]) / Rm, ny = (hy - M[1]) / Rm, nz = (hz - M[2]) / Rm;
          let r = 244, g = 234, bl = 184;
          if (MT) {   // the map, by selenographic longitude / latitude of the point
            const sl = Math.atan2(nx * MF.Y[0] + ny * MF.Y[1] + nz * MF.Y[2], nx * MF.X[0] + ny * MF.X[1] + nz * MF.X[2]) / D2R;
            const sb = Math.asin(Math.max(-1, Math.min(1, nx * MF.Z[0] + ny * MF.Z[1] + nz * MF.Z[2]))) / D2R;
            const ti = Math.min(MT.h - 1, Math.floor((90 - sb) / 180 * MT.h)) * MT.w + Math.min(MT.w - 1, Math.floor((sl + 180) / 360 * MT.w));
            r = MT.data[ti * 3]; g = MT.data[ti * 3 + 1]; bl = MT.data[ti * 3 + 2];
          }
          if (sun) {
            const X = [Mt[0] + nx * Rm, Mt[1] + ny * Rm, Mt[2] + nz * Rm];   // the same point on the true Moon
            const lit = nx * sun[0] + ny * sun[1] + nz * sun[2];
            let a = Math.max(0, Math.min(1, (lit + 0.04) / 0.08));   // soft terminator
            a *= 0.8 + 0.2 * Math.max(0, lit);
            // The Earth's shadow, continuous across both its edges (see the comment above).
            const ts = -(X[0] * sun[0] + X[1] * sun[1] + X[2] * sun[2]);
            let direct = 1, refr = 0;
            if (ts > 0) {
              const ax = X[0] + ts * sun[0], ay = X[1] + ts * sun[1], az = X[2] + ts * sun[2];
              const rho = Math.hypot(ax, ay, az);
              const ru = Re - ts * (Rs - Re) / Ds, rp = Re + ts * (Rs + Re) / Ds;
              if (rho < rp) {
                const hh = 2 * Math.max(0, (rho - ru) / (rp - ru));   // the Sun's visible height, 0..2 radii
                direct = (Math.acos(1 - hh) - (1 - hh) * Math.sqrt(Math.max(0, hh * (2 - hh)))) / Math.PI;
                const q = rho / ru;
                refr = NS_GLOBE_UMBRA_LIGHT * (q <= 1 ? 0.35 + 0.65 * q * q : Math.exp(-(((q - 1) / 0.08) ** 2)));
              }
            }
            const kd = a * direct, kr = a * refr, kn = 1 - a;
            r = r * (kd + kr * tint[0]) + (r * NS_GLOBE_MOON_NIGHT + 3) * kn;
            g = g * (kd + kr * tint[1]) + (g * NS_GLOBE_MOON_NIGHT + 4) * kn;
            bl = bl * (kd + kr * tint[2]) + (bl * NS_GLOBE_MOON_NIGHT + 7) * kn;
          }
          const o = (j * sw + i) * 4;
          px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = 255;
        }
      }
      const off = _nsGlobeDrawMoon.cv || (_nsGlobeDrawMoon.cv = document.createElement('canvas'));
      off.width = sw; off.height = shh;
      off.getContext('2d').putImageData(buf, 0, 0);
      ctx.save();
      ctx.beginPath(); ctx.arc(pc.x, pc.y, rpx, 0, Math.PI * 2); ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, x0, y0, sw / q, shh / q);
      ctx.restore();
    }
  }
  if (showNames || fixed) {   // with the Moon fixed, its magnification is always shown
    const magTxt = '×' + (mag >= 10 ? Math.round(mag) : mag.toFixed(1));
    ctx.font = "11px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = _nightSkyBodyLabelColors().moon;
    ctx.fillText((showNames ? 'Moon' : '') + (fixed ? (showNames ? ' ' : '') + magTxt : ''), pc.x + Math.max(rpx, 1.5) + 5, pc.y);
  }
}

// The lit globe, pixel by pixel into a small buffer scaled onto the canvas: a ray from the camera
// through each pixel meets the sphere; the hit point gives the land/ocean colour (tex: the texture
// with the season's snow and ice, by longitude/latitude, the Earth turned by theta) and the Sun's
// altitude there, sin h = p·s.
// One smooth light curve over day and twilight (ell, logistic around -2°, no kink at the horizon,
// the daylight climbing gently with the Sun); just past the terminator the hue turns orange (a
// tint, never adding light); the oceans show the Sun's glint
// (specular reflection towards the camera). With the Moon shown, its shadow from the real geometry
// (a solar eclipse): a point is in the Moon's umbra or penumbra when the Moon lies sunward of it
// (t > 0 along the Sun's direction) and the point is within ru = Rm - t (Rs - Rm) / Ds or
// rp = Rm + t (Rs + Rm) / Ds of the shadow axis; a negative ru is the antumbra (annular), where
// 1 - (Moon's / Sun's angular radius)^2 of the light remains. In the penumbra the remaining light
// rises linearly to the edge. While dragging the buffer runs at half resolution.
// Only the part of the globe inside the canvas is computed (zoomed in, the disc overflows it), and
// at most NS_GLOBE_MAX_PX buffer pixels (~20 ms): beyond that the buffer resolution drops and the
// browser's smoothing scales it up.
const NS_GLOBE_MAX_PX = 160000;
// L: the view (rays through its centre); EL: the Earth's disc on screen (centre), for the box/clip.
function _nsGlobeDrawSurface(ctx, L, EL, cam, rs, theta, sun, w, h, moon, tex) {
  const M = sun && moon ? moon.t : null, Rm = NS_GLOBE_MOON_RADIUS;   // the TRUE Moon casts the shadow
  const Ds = _nsGlobeSunDist(), Rs = NS_GLOBE_SUN_RADIUS;
  const x0 = Math.max(0, EL.cx - rs), y0 = Math.max(0, EL.cy - rs);
  const bw = Math.min(w, EL.cx + rs) - x0, bh = Math.min(h, EL.cy + rs) - y0;
  if (bw <= 0 || bh <= 0) return;
  const q = Math.min(_nsGlobe.interacting ? 0.5 : 1, Math.sqrt(NS_GLOBE_MAX_PX / (bw * bh)));
  const sw = Math.max(1, Math.ceil(bw * q)), sh0 = Math.max(1, Math.ceil(bh * q));
  const buf = new ImageData(sw, sh0), px = buf.data;
  const TW = tex.w, TH = tex.h, T = tex.data;
  const F = cam.F, P = cam.pos, R = cam.right, U = cam.up, Fw = cam.fwd;
  const cc = _sd3Dot(P, P) - 1;
  const D2R = Math.PI / 180;
  for (let j = 0; j < sh0; j++) {
    const sy = -((y0 + (j + 0.5) / q) - L.cy) / L.scale;
    for (let i = 0; i < sw; i++) {
      const sx = ((x0 + (i + 0.5) / q) - L.cx) / L.scale;
      let dx = F * Fw[0] + sx * R[0] + sy * U[0], dy = F * Fw[1] + sx * R[1] + sy * U[1], dz = F * Fw[2] + sx * R[2] + sy * U[2];
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      const b = P[0] * dx + P[1] * dy + P[2] * dz, disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      const hx = P[0] + t * dx, hy = P[1] + t * dy, hz = P[2] + t * dz;
      let lon = (Math.atan2(hy, hx) - theta) / D2R;
      lon = ((lon + 180) % 360 + 360) % 360;
      const lat = Math.asin(Math.max(-1, Math.min(1, hz))) / D2R;
      const ti = (Math.min(TH - 1, Math.floor((90 - lat) / 180 * TH)) * TW + Math.min(TW - 1, Math.floor(lon / 360 * TW))) * 4;
      let r = T[ti], g = T[ti + 1], bl = T[ti + 2];
      if (sun) {
        const sh = hx * sun[0] + hy * sun[1] + hz * sun[2];   // sine of the Sun's altitude here
        const hDeg = Math.asin(Math.max(-1, Math.min(1, sh))) / D2R;
        // One smooth light curve over day and twilight (no kink at the horizon): ell rises from
        // night to day along a logistic step centred at -2° (half the light), ~0.01 by -12°;
        // the daylight itself climbs gently with the Sun, 0.75 at the horizon to 1 high up.
        const ell = 1 / (1 + Math.exp(-(hDeg + 2) / 2.2));
        let k = ell * (hDeg > 0 ? 0.75 + 0.25 * (1 - Math.exp(-hDeg / 15)) : 0.75);
        // The Moon's shadow dims the twilight too, not only the daylight: twilight is sunlight
        // scattered by the air above, and the eclipse cuts that sunlight off the same way.
        if (M && ell > 0.002) {
          const t = (M[0] - hx) * sun[0] + (M[1] - hy) * sun[1] + (M[2] - hz) * sun[2];
          if (t > 0) {
            const rho = Math.hypot(hx - M[0] + t * sun[0], hy - M[1] + t * sun[1], hz - M[2] + t * sun[2]);
            const ru = Rm - t * (Rs - Rm) / Ds, rp = Rm + t * (Rs + Rm) / Ds, au = Math.abs(ru);
            if (rho < rp) {
              const inner = ru > 0 ? 0 : Math.max(0, 1 - ((Rm / t) / (Rs / Ds)) ** 2);
              const light = rho <= au ? inner : inner + (1 - inner) * (rho - au) / (rp - au);
              k *= 0.06 + 0.94 * light;
            }
          }
        }
        const night = 1 - ell;
        r = r * k + 6 * night; g = g * k + 10 * night; bl = bl * k + 24 * night;
        // Sunset/sunrise tint, only past the terminator (centred at -3°, practically gone by the
        // horizon): shifts the hue towards orange without adding light.
        const warm = Math.exp(-((hDeg + 3) / 2) * ((hDeg + 3) / 2)) * 0.4;
        r *= 1 + 0.35 * warm; g *= 1 + 0.05 * warm; bl *= 1 - 0.45 * warm;
        if (sh > 0 && T[ti] === NS_GLOBE_OCEAN[0] && T[ti + 1] === NS_GLOBE_OCEAN[1]) {   // ocean glint
          const rd = 2 * sh;   // reflect the Sun about the surface normal, compare with the view
          const rx = rd * hx - sun[0], ry = rd * hy - sun[1], rz = rd * hz - sun[2];
          const spec = Math.pow(Math.max(0, -(rx * dx + ry * dy + rz * dz)), 160) * 0.45;
          r += (255 - r) * spec; g += (245 - g) * spec; bl += (220 - bl) * spec;
        }
      }
      const o = (j * sw + i) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = bl; px[o + 3] = 255;
    }
  }
  const off = _nsGlobeDrawSurface.cv || (_nsGlobeDrawSurface.cv = document.createElement('canvas'));
  off.width = sw; off.height = sh0;
  off.getContext('2d').putImageData(buf, 0, 0);
  ctx.save();
  ctx.beginPath(); ctx.arc(EL.cx, EL.cy, rs, 0, Math.PI * 2); ctx.clip();   // a clean limb
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, x0, y0, sw / q, sh0 / q);
  ctx.restore();
}

// ── RA/Dec picker (the Planetarium's #btnNightSkyPicker, render-nightsky.js) ───────────────────
// A pixel on the sky (not on the Earth) gives a direction at infinity -> RA/Dec of date -> J2000,
// like the Planetarium's. A pick locks that sky point where it was clicked: the camera's direction
// in camera space is stored (_nsGlobePicker.tx/ty), and before every draw camAz/camEl are solved
// (Newton, 2x2) so the point projects there again - in HOR, where the sky turns, the view turns
// with it; in EQU the sky already stands still. A drag moves the held position with it.
const _nsGlobePicker = { tx: 0, ty: 0 };
function _nsGlobeLockDir() {
  const Lk = _nightSkyPicker.lock;
  const q = _skyJ2000ToDate(Lk.ra, Lk.dec, _moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
  return _skyDomeUnitVecRaDec(q);
}
function _nsGlobeCamXY(cam, D) {   // a direction's camera-space position (tangent plane)
  const f = _sd3Dot(D, cam.fwd);
  return [_sd3Dot(D, cam.right) / f, _sd3Dot(D, cam.up) / f, f];
}
function _nsGlobePickerHit(e) {
  const cv = document.getElementById('nightSkyCanvas');
  const dpr = cv._res || 1, rect = cv.getBoundingClientRect();
  const w = cv.width / dpr, h = cv.height / dpr, L = { cx: w / 2, cy: h / 2, scale: Math.min(w, h) / 2 * 0.9 };
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const cam = _nsGlobeCamera();
  const sx = (px - L.cx) / L.scale, sy = -(py - L.cy) / L.scale;
  let d = [0, 1, 2].map(i => cam.F * cam.fwd[i] + sx * cam.right[i] + sy * cam.up[i]);
  const dl = Math.hypot(d[0], d[1], d[2]); d = d.map(v => v / dl);
  const b = _sd3Dot(cam.pos, d), disc = b * b - (_sd3Dot(cam.pos, cam.pos) - 1);
  if (disc >= 0 && -b - Math.sqrt(disc) > 0) return null;   // on the Earth, not the sky
  if (_nsGlobe.body === 'moon') {   // nor on the Moon the view orbits
    const M = _nsGlobeMoonNow(), O = [0, 1, 2].map(i => cam.pos[i] - M[i]);
    const bm = _sd3Dot(O, d), dm = bm * bm - (_sd3Dot(O, O) - NS_GLOBE_MOON_RADIUS ** 2);
    if (dm >= 0 && -bm - Math.sqrt(dm) > 0) return null;
  }
  const ra = (Math.atan2(d[1], d[0]) * 180 / Math.PI + 360) % 360, dec = Math.asin(d[2]) * 180 / Math.PI;
  const j = _moonPrecessToJ2000(ra, dec, _moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
  return { az: 0, el: 90, ra: j.ra, dec: j.dec, px, py };
}
function _nsGlobePickerRetarget() {
  if (!_nightSkyPicker.lock) return;
  const c = _nsGlobeCamXY(_nsGlobeCamera(), _nsGlobeLockDir());
  _nsGlobePicker.tx = c[0]; _nsGlobePicker.ty = c[1];
}
function _nsGlobePickerApplyLock() {
  if (!_nightSkyPicker.lock) return;
  const D = _nsGlobeLockDir();
  const err = () => { const c = _nsGlobeCamXY(_nsGlobeCamera(), D); return [c[0] - _nsGlobePicker.tx, c[1] - _nsGlobePicker.ty]; };
  for (let it = 0; it < 8; it++) {
    const e0 = err();
    if (Math.hypot(e0[0], e0[1]) < 1e-7) break;
    const hh = 1e-4, a0 = _nsGlobe.camAz, el0 = _nsGlobe.camEl;
    _nsGlobe.camAz = a0 + hh; const ea = err(); _nsGlobe.camAz = a0;
    _nsGlobe.camEl = el0 + hh; const ee = err(); _nsGlobe.camEl = el0;
    const J = [[(ea[0] - e0[0]) / hh, (ee[0] - e0[0]) / hh], [(ea[1] - e0[1]) / hh, (ee[1] - e0[1]) / hh]];
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (Math.abs(det) < 1e-12) break;
    _nsGlobe.camAz = a0 - (J[1][1] * e0[0] - J[0][1] * e0[1]) / det;
    _nsGlobe.camEl = Math.max(-NS_GLOBE_EL_MAX, Math.min(NS_GLOBE_EL_MAX, el0 - (-J[1][0] * e0[0] + J[0][0] * e0[1]) / det));
  }
}
function _nsGlobePickerDrawMarker(ctx, L, cam) {
  if (!_nightSkyPicker.lock) return;
  const p = _nsGlobeProjectDir(cam, L, _nsGlobeLockDir());
  if (!p) return;
  ctx.save();
  ctx.strokeStyle = '#ff5050'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(p.x + dx * 3, p.y + dy * 3); ctx.lineTo(p.x + dx * 11, p.y + dy * 11); }
  ctx.stroke();
  ctx.restore();
}

// ── Camera sliders (#nsGlobeCamCtl): distance and field of view, log scale (slider 0..1) ───────
const _nsGlobeCamRange = { dist: [NS_GLOBE_DIST_MIN, NS_GLOBE_DIST_MAX], fov: [NS_GLOBE_FOV_MIN, NS_GLOBE_FOV_MAX] };
function _nsGlobeToSlider(k, v) { const [a, b] = _nsGlobeCamRange[k]; return Math.log(v / a) / Math.log(b / a); }
function _nsGlobeFromSlider(k, t) { const [a, b] = _nsGlobeCamRange[k]; return a * Math.pow(b / a, t); }
function _nsGlobeSetCam(k, v) {
  const [a, b] = _nsGlobeCamRange[k];
  _nsGlobe[k] = Math.max(a, Math.min(b, v));
  _nsGlobeSyncCamCtl();
  if (_nsGlobeActive()) drawNightSky();
}
function _nsGlobeSetActive(k) {
  _nsGlobe.active = k;
  document.querySelectorAll('#nsGlobeCamCtl .nsg-row').forEach(r => r.classList.toggle('active', r.dataset.k === k));
}
function _nsGlobeSyncCamCtl() {
  document.getElementById('nsGlobeDist').value = _nsGlobeToSlider('dist', _nsGlobe.dist);
  document.getElementById('nsGlobeFov').value = _nsGlobeToSlider('fov', _nsGlobe.fov);
  const d = _nsGlobe.dist;
  const moonView = _nsGlobe.body === 'moon';
  document.getElementById('nsGlobeDistVal').textContent = (d < 10 ? d.toFixed(2) : d < 100 ? d.toFixed(1) : Math.round(d)) + (moonView ? ' R☾' : ' R⊕');
  document.getElementById('nsGlobeDistVal').title = Math.round(d * (moonView ? 1737.4 : NS_GLOBE_RE_KM)).toLocaleString('en-US') + (moonView ? ' km from the Moon\'s centre' : ' km from the Earth\'s centre');
  const f = _nsGlobe.fov;
  document.getElementById('nsGlobeFovVal').textContent = (f < 10 ? f.toFixed(2) : f.toFixed(1)) + '°';
}
document.getElementById('btnNsGlobeSubsolar').addEventListener('click', () => {
  _nsGlobe.subsolar = !_nsGlobe.subsolar;
  const b = document.getElementById('btnNsGlobeSubsolar');
  b.classList.toggle('on', _nsGlobe.subsolar); b.setAttribute('aria-checked', String(_nsGlobe.subsolar));
  if (_nsGlobeActive()) drawNightSky();
});
document.getElementById('btnNsGlobeMoonOrbit').addEventListener('click', () => {
  _nsGlobe.orbit = !_nsGlobe.orbit;
  const b = document.getElementById('btnNsGlobeMoonOrbit');
  b.classList.toggle('on', _nsGlobe.orbit); b.setAttribute('aria-checked', String(_nsGlobe.orbit));
  if (_nsGlobeActive()) drawNightSky();
});
// EQU | ECL | HOR: three buttons side by side, only the active one coloured.
document.querySelectorAll('#nsGlobeFrameToggle .ns-btn').forEach(btn => btn.addEventListener('click', () => {
  _nsGlobeSetFrame(btn.dataset.v);
  _nsGlobePickerRetarget();   // a held picked point stays where it is
  document.querySelectorAll('#nsGlobeFrameToggle .ns-btn').forEach(b => b.classList.toggle('active', b.dataset.v === _nsGlobe.frame));
  if (_nsGlobeActive()) drawNightSky();
}));
// EARTH | MOON: what the camera orbits. Each body keeps its own camera (direction and distance);
// the first visit to the Moon starts 5 Moon radii out on its near side. MOON = SUN only applies
// from the Earth's side, so its row hides in the Moon view.
function _nsGlobeSetBody(body) {
  if (body === _nsGlobe.body) return;
  _nsGlobe.saved[_nsGlobe.body] = { camAz: _nsGlobe.camAz, camEl: _nsGlobe.camEl, dist: _nsGlobe.dist, frame: _nsGlobe.frame };
  _nsGlobe.body = body;
  const sv = _nsGlobe.saved[body];
  if (sv) {
    const f = _nsGlobe.frame;
    Object.assign(_nsGlobe, { camAz: sv.camAz, camEl: sv.camEl, dist: sv.dist, frame: sv.frame });
    _nsGlobeSetFrame(f);   // in the frame now chosen
  } else { _nsGlobe.dist = 5; _nsGlobeAimAtPlace(); }
  _nsGlobePickerRetarget();
  const moon = body === 'moon';
  const b = document.getElementById('btnNsGlobeBody');
  b.classList.toggle('on', moon); b.setAttribute('aria-checked', String(moon));
  document.querySelectorAll('#nsGlobeBodySwitch .sg-view-lbl').forEach(el => el.classList.toggle('dim', el.dataset.v !== body));
  document.querySelector('#nsGlobeCamCtl .nsg-moonfix').style.display = moon ? 'none' : '';
  document.querySelector('#nsGlobeFrameToggle .ns-btn[data-v="equator"]').title = moon
    ? 'Level on the Moon\'s equator - the Moon turns under a fixed sky, once a month'
    : 'Level on the Earth\'s equator - the Earth turns under a fixed sky';
  document.querySelector('#nsGlobeFrameToggle .ns-btn[data-v="horizon"]').title = moon
    ? 'Level on the Moon\'s own axes - the camera turns with the Moon, the Moon stays put, the sky turns'
    : 'Level on the place\'s horizon - the globe stays put, the sky turns';
  document.querySelector('#nsGlobeCamCtl .nsg-row[data-k="dist"]').title = 'Camera distance from the ' + (moon ? 'Moon' : 'Earth')
    + '\'s centre, in ' + (moon ? 'Moon' : 'Earth') + ' radii (log scale) - click to put the mouse wheel on it';
  _nsGlobeSyncCamCtl();
  if (_nsGlobeActive()) drawNightSky();
}
document.getElementById('btnNsGlobeBody').addEventListener('click', () => _nsGlobeSetBody(_nsGlobe.body === 'earth' ? 'moon' : 'earth'));
document.querySelectorAll('#nsGlobeBodySwitch .sg-view-lbl').forEach(el => el.addEventListener('click', () => _nsGlobeSetBody(el.dataset.v)));
document.getElementById('btnNsGlobeMoonFix').addEventListener('click', () => {
  _nsGlobe.moonFixed = !_nsGlobe.moonFixed;
  const b = document.getElementById('btnNsGlobeMoonFix');
  b.classList.toggle('on', _nsGlobe.moonFixed); b.setAttribute('aria-checked', String(_nsGlobe.moonFixed));
  if (_nsGlobeActive()) drawNightSky();
});
for (const k of ['dist', 'fov']) {
  const id = k === 'dist' ? 'nsGlobeDist' : 'nsGlobeFov';
  const el = document.getElementById(id);
  el.addEventListener('input', () => { _nsGlobeSetActive(k); _nsGlobeSetCam(k, _nsGlobeFromSlider(k, parseFloat(el.value))); });
  el.addEventListener('pointerdown', () => _nsGlobeSetActive(k));
}
document.querySelectorAll('#nsGlobeCamCtl .nsg-row').forEach(r => r.addEventListener('click', () => _nsGlobeSetActive(r.dataset.k)));
_nsGlobeSyncCamCtl();
_nsGlobeSetActive(_nsGlobe.active);

// ── Interaction: orbit drag, wheel / pinch on the active slider, double click back to the place ──
(function () {
  const cv = document.getElementById('nightSkyCanvas');
  let dragging = false, lastX = 0, lastY = 0, pinch = null;
  // Wheel / pinch step for the active slider: closer / narrower = "zoom in".
  const nudge = (factor) => _nsGlobeSetCam(_nsGlobe.active, _nsGlobe[_nsGlobe.active] / factor);
  const start = (x, y) => { dragging = true; _nsGlobe.interacting = true; lastX = x; lastY = y; cv.style.cursor = 'grabbing'; };
  const move = (x, y) => {
    if (!dragging) return;
    // Slower for a narrow field, so a drag across the view turns the Earth by about as much.
    const k = 0.006 * Math.min(4, _nsGlobe.fov / 14.25);
    // Azimuth runs clockwise seen from above, right ascension and selenographic longitude the
    // other way: the same drag turns the scene the same way in every frame.
    _nsGlobe.camAz -= (_nsGlobe.frame === 'horizon' && _nsGlobe.body === 'earth' ? -1 : 1) * (x - lastX) * k;
    _nsGlobe.camEl = Math.max(-NS_GLOBE_EL_MAX, Math.min(NS_GLOBE_EL_MAX, _nsGlobe.camEl + (y - lastY) * k));
    lastX = x; lastY = y;
    _nsGlobePickerRetarget();   // a drag moves where a picked point is held
    drawNightSky();
  };
  const end = () => { if (!dragging) return; dragging = false; _nsGlobe.interacting = false; cv.style.cursor = _nightSkyPicker.active ? 'crosshair' : ''; if (_nsGlobeActive()) drawNightSky(); };
  cv.addEventListener('mousedown', (e) => {
    if (!_nsGlobeActive()) return;
    if (_nightSkyPicker.active) { _nightSkyPickerPick(e); e.preventDefault(); return; }
    start(e.clientX, e.clientY); e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('mouseup', end);
  cv.addEventListener('dblclick', () => { if (_nsGlobeActive()) { _nsGlobeAimAtPlace(); drawNightSky(); } });
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  cv.addEventListener('touchstart', (e) => {
    if (!_nsGlobeActive()) return;
    if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY);
    else if (e.touches.length === 2) { dragging = false; _nsGlobe.interacting = true; pinch = { d: dist(e.touches), v: _nsGlobe[_nsGlobe.active] }; }
  }, { passive: true });
  cv.addEventListener('touchmove', (e) => {
    if (!_nsGlobeActive()) return;
    if (pinch && e.touches.length === 2) _nsGlobeSetCam(_nsGlobe.active, pinch.v * pinch.d / dist(e.touches));
    else if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  cv.addEventListener('touchend', (e) => { if (e.touches.length === 0) { pinch = null; end(); _nsGlobe.interacting = false; if (_nsGlobeActive()) drawNightSky(); } });
  cv.addEventListener('wheel', (e) => {
    if (!_nsGlobeActive()) return;
    e.preventDefault();
    nudge(Math.pow(1.1, -Math.sign(e.deltaY)));
  }, { passive: false });
})();

// Display while Globe shows: the Sky Map's rows (shared with the other views) plus Globe's own
// Subsolar point (CSS: #nightSkyDisplaySection.ns-globe); the camera panel.
// Sun and Moon are always on in Globe: their checkboxes show ticked and disabled while it shows,
// and get back the state the other views had (kept in _nsGlobeSyncUI.kept) when it is left.
function _nsGlobeSyncUI() {
  const on = _nsGlobeActive();
  const sec = document.getElementById('nightSkyDisplaySection');
  if (on !== sec.classList.contains('ns-globe')) {
    const boxes = ['chkNightSkySun', 'chkNightSkyMoon'].map(id => document.getElementById(id));
    if (on) {
      _nsGlobeSyncUI.kept = boxes.map(b => b.checked);
      boxes.forEach(b => { b.checked = true; b.disabled = true; });
    } else {
      boxes.forEach((b, i) => { b.disabled = false; if (_nsGlobeSyncUI.kept) b.checked = _nsGlobeSyncUI.kept[i]; });
      _nightSkyUpdateSunSubrow(); _nightSkyUpdateMoonSubrow();
    }
  }
  sec.classList.toggle('ns-globe', on);
  document.getElementById('nsGlobeCamCtl').style.display = on ? 'flex' : 'none';
  // EARTH | MOON where Sun Graph has TIMES | LENGTH: centred over the view, on the title row.
  const bs = document.getElementById('nsGlobeBodySwitch');
  bs.style.display = on ? 'flex' : 'none';
  if (on) {
    bs.style.left = (document.getElementById('nightSkyCanvas').clientWidth / 2) + 'px';
    bs.style.top = Math.round(21 - (bs.offsetHeight || 27) / 2) + 'px';
  }
}
