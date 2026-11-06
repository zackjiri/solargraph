// ─── Night Sky: Orbit, the SUN view (the solar system) ──────────────────────────────────────────
// The third body of Orbit's EARTH | MOON | SUN: the solar system at the moment on screen, where the
// planets are on their orbits. Spec: specs/2026-11-06-orbit-sun-view-design.md (outside the
// version folders).
//
// The scene (_nsSolarScene) is heliocentric ecliptic J2000 in au, x toward the March equinox of
// J2000, z toward the ecliptic's north pole, as _planetHelio (render-planets.js): the planets from
// their elements at the moment's JDE, without light time (a view from above, not from the Earth);
// the Earth the same way; the Moon from its geocentric position (_nsGlobeMoonPosAt, equator of date,
// Earth radii) taken back to the J2000 equator (the precession matrix turned round), turned to the
// J2000 ecliptic and added to the Earth, so far from 2000 it keeps its true side of the Earth.
// Each planet's orbit (_nsSolarOrbit) is the ellipse of its elements at that moment, true 3D with
// its inclination, NS_SOLAR_ORBIT_N points 2° of mean anomaly apart starting at the planet itself;
// orbits are worked out again only when the moment moves by more than a day.

const NS_SOLAR_AU_KM = 149597870.7;
const NS_SOLAR_ORBIT_N = 181;   // points of an orbit, 2° of mean anomaly apart, the first and the last the planet
const _nsSolar = { orbitCache: { jde: null, orbits: null }, hover: null, focus: null, line: null };

// The elements of a planet at JDE (as _planetHelio): a, e, inclination, Ω, ω (radians) and the mean
// anomaly M (radians)
function _nsSolarElements(key, jde) {
  const [e0, e1] = PLANET_ELEMENTS[key], T = (jde - 2451545.0) / 36525;
  const el = e0.map((v, i) => v + e1[i] * T), d2r = Math.PI / 180;
  return { a: el[0], e: el[1], I: el[2] * d2r, Om: el[5] * d2r, w: (el[4] - el[5]) * d2r, M: (el[3] - el[4]) * d2r };
}
// The heliocentric point of an orbit at mean anomaly M (radians)
function _nsSolarOrbitPoint(o, M) {
  const { a, e } = o;
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 15; k++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(o.w), sw = Math.sin(o.w), cO = Math.cos(o.Om), sO = Math.sin(o.Om), cI = Math.cos(o.I), sI = Math.sin(o.I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    (sw * sI) * xp + (cw * sI) * yp,
  ];
}
function _nsSolarOrbit(key, jde) {
  const o = _nsSolarElements(key, jde), pts = [];
  for (let k = 0; k < NS_SOLAR_ORBIT_N; k++) pts.push(_nsSolarOrbitPoint(o, o.M + k * 2 * Math.PI / (NS_SOLAR_ORBIT_N - 1)));
  return pts;
}
function _nsSolarScene(jde) {
  const planets = PLANETS.map(p => ({ key: p.key, name: p.name, color: p.color, radiusKm: p.radiusKm, pos: _planetHelio(p.key, jde), shown: _planetShown(p) }));
  const earth = _planetHelio('earth', jde);
  // _nsGlobeMoonPosAt takes UT: the JDE less ΔT (tens of minutes far from 2000, the Moon's width an hour)
  const r = _skyFromJulianDateUT(jde), jdUT = jde - (_moonJDE(r.year, r.month, r.day, r.hourUT) - _skyToJulianDateUT(r.year, r.month, r.day, r.hourUT));
  const gd = _nsGlobeMoonPosAt(jdUT), P = _skyPrecessionMatrix(jde), k = NS_GLOBE_RE_KM / NS_SOLAR_AU_KM;
  const g = [0, 1, 2].map(j => P[0][j] * gd[0] + P[1][j] * gd[1] + P[2][j] * gd[2]);   // equator of J2000
  const ce = Math.cos(NS_SOLAR_OBLIQ_J2000), se = Math.sin(NS_SOLAR_OBLIQ_J2000);
  const moon = [earth[0] + g[0] * k, earth[1] + (g[1] * ce + g[2] * se) * k, earth[2] + (-g[1] * se + g[2] * ce) * k];
  const c = _nsSolar.orbitCache;
  if (c.jde === null || Math.abs(jde - c.jde) > 1) {
    const orbits = {};
    for (const p of PLANETS) orbits[p.key] = _nsSolarOrbit(p.key, jde);
    orbits.earth = _nsSolarOrbit('earth', jde);
    _nsSolar.orbitCache = { jde, orbits };
  }
  return { jde, sun: [0, 0, 0], earth, moon, planets, orbits: _nsSolar.orbitCache.orbits };
}
// The angle Sun - Earth - planet (degrees)
function _nsSolarElongation(key, scene) {
  const p = scene.planets.find(q => q.key === key), E = scene.earth;
  const a = [-E[0], -E[1], -E[2]], b = [p.pos[0] - E[0], p.pos[1] - E[1], p.pos[2] - E[2]];
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
}
// The planet's geocentric ecliptic longitude less the Sun's (degrees, 0..360): opposition at 180,
// conjunction at 0 - the astronomical definitions, by longitude; the elongation above is the true
// angle and stays a few degrees off 180 at an opposition when the planet is off the ecliptic.
function _nsSolarLongDiff(key, scene) {
  const p = scene.planets.find(q => q.key === key), E = scene.earth;
  const lon = (v) => Math.atan2(v[1], v[0]) * 180 / Math.PI;
  return ((lon([p.pos[0] - E[0], p.pos[1] - E[1], p.pos[2] - E[2]]) - lon([-E[0], -E[1], -E[2]])) % 360 + 360) % 360;
}

// ── The camera ───────────────────────────────────────────────────────────────────────────────────
// Orbit's camera (_nsGlobe: camAz, camEl, dist, fov) round the Sun: camAz / camEl the ecliptic
// longitude / latitude of the camera's place seen from the Sun, dist in au (NS_SOLAR_DIST_MIN..MAX).
// Home (the first visit, a double click): 3 au out, 40° above the ecliptic over the Earth, so the
// Earth is in front and the Sun in the middle.
// The home view sets the field of view too (shared with EARTH and MOON), so the Earth's whole orbit is in it.
const NS_SOLAR_DIST_MIN = 0.05, NS_SOLAR_DIST_MAX = 100, NS_SOLAR_HOME_DIST = 3, NS_SOLAR_HOME_EL = 40 * Math.PI / 180, NS_SOLAR_HOME_FOV = 50;
function _nsSolarHome() {
  const E = _planetHelio('earth', _moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
  Object.assign(_nsGlobe, { camAz: Math.atan2(E[1], E[0]), camEl: NS_SOLAR_HOME_EL, dist: NS_SOLAR_HOME_DIST, frame: 'ecliptic', fov: NS_SOLAR_HOME_FOV });
  if (typeof _nsGlobeSyncCamCtl === 'function') _nsGlobeSyncCamCtl();
}
function _nsSolarCamera() {
  const a = _nsGlobe.camAz, e = _nsGlobe.camEl, d = _nsGlobe.dist;
  const o = [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  const fwd = [-o[0], -o[1], -o[2]];
  let right = _sd3Cross(fwd, [0, 0, 1]);
  const rl = Math.hypot(right[0], right[1], right[2]) || 1;
  right = right.map(v => v / rl);
  return { pos: o.map(v => v * d), fwd, right, up: _sd3Cross(right, fwd), F: 1 / Math.tan(_nsGlobe.fov / 2 * Math.PI / 180) };
}
function _nsSolarProject(cam, L, v) {
  const rel = [v[0] - cam.pos[0], v[1] - cam.pos[1], v[2] - cam.pos[2]], z = _sd3Dot(rel, cam.fwd);
  return { x: L.cx + cam.F * _sd3Dot(rel, cam.right) / z * L.scale, y: L.cy - cam.F * _sd3Dot(rel, cam.up) / z * L.scale, z, ahead: z > 1e-6 };
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────────────
// Over the sky (stars, the Milky Way, deep sky objects and Display's overlays at infinity, through
// _nsGlobeDrawSky with the camera turned from the ecliptic to the equator of date; no planets or Sun
// there): the orbits (the planets' with Display Planets, the
// Earth's always; broken where they pass behind the camera), the Earth - Sun line (dashed), then the
// bodies far to near: the Sun with its glow, the planets (plain discs in their colour, no phase;
// Saturn with its ring), the Earth, and the
// Moon once more than NS_SOLAR_MOON_PX from the Earth on screen. A disc is its true size or, if
// that is smaller, NS_SOLAR_MIN_PX · (R / R_Jupiter)^0.35 (the Sun at least NS_SOLAR_SUN_MIN_PX), so
// the sizes keep their order. Labels with Display Labels. _nsSolar.drawn lists what was drawn
// ({key, x, y, r}) for the hover and the tests.
const NS_SOLAR_MIN_PX = 6, NS_SOLAR_SIZE_EXP = 0.35, NS_SOLAR_SUN_MIN_PX = 11, NS_SOLAR_MOON_PX = 8;
const NS_SOLAR_JUPITER_KM = 69911, NS_SOLAR_SUN_KM = 696000;
const NS_SOLAR_OBLIQ_J2000 = 23.43928 * Math.PI / 180;
// A body's colour for the theme: as it is on the dark sky, at NS_SOLAR_LIGHT_INK of its brightness on
// the light theme's white canvas, where the pale tints (Venus, Jupiter, the Sun, the Moon) would vanish
const NS_SOLAR_LIGHT_INK = 0.45;
function _nsSolarInk(hex) {
  if (!document.body.classList.contains('light')) return hex;
  const n = parseInt(hex.slice(1), 16), k = NS_SOLAR_LIGHT_INK;
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(c * k).toString(16).padStart(2, '0')).join('');
}
function _nsSolarDiscPx(radiusKm, cam, L, pos) {
  const z = _nsSolarProject(cam, L, pos).z, truePx = cam.F * radiusKm / NS_SOLAR_AU_KM / z * L.scale;
  const min = radiusKm === NS_SOLAR_SUN_KM ? NS_SOLAR_SUN_MIN_PX : NS_SOLAR_MIN_PX * Math.pow(radiusKm / NS_SOLAR_JUPITER_KM, NS_SOLAR_SIZE_EXP);
  return Math.max(truePx, min);
}
// The camera for the sky behind: its axes from the ecliptic J2000 to the equator J2000, then precessed
// to the date as _nsGlobeDrawSky's stars are
function _nsSolarSkyCam(cam) {
  const m = _skyPrecessionMatrix(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)), c = Math.cos(NS_SOLAR_OBLIQ_J2000), s = Math.sin(NS_SOLAR_OBLIQ_J2000);
  const eq = (v) => { const u = [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; return [0, 1, 2].map(i => m[i][0] * u[0] + m[i][1] * u[1] + m[i][2] * u[2]); };
  return { pos: [0, 0, 0], fwd: eq(cam.fwd), right: eq(cam.right), up: eq(cam.up), F: cam.F, dist0: 1e9 };
}
// A 3D polyline cut at the near plane, NS_SOLAR_NEAR of the camera's distance in front of it: a
// segment wholly behind is left out, one crossing the plane drawn up to it (counted in
// _nsSolar.skippedBehind), so close to the Sun the orbits and the Earth - Sun line still
// show their part in front
const NS_SOLAR_NEAR = 0.01;
function _nsSolarPath(ctx, cam, L, pts, closed) {
  const list = closed ? pts.concat([pts[0]]) : pts, near = Math.max(1e-9, NS_SOLAR_NEAR * _nsGlobe.dist);
  const depth = (v) => (v[0] - cam.pos[0]) * cam.fwd[0] + (v[1] - cam.pos[1]) * cam.fwd[1] + (v[2] - cam.pos[2]) * cam.fwd[2];
  const at = (a, b, za, zb) => { const t = (near - za) / (zb - za); return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]; };
  const mt = (v) => { const p = _nsSolarProject(cam, L, v); ctx.moveTo(p.x, p.y); };
  const lt = (v) => { const p = _nsSolarProject(cam, L, v); ctx.lineTo(p.x, p.y); };
  ctx.beginPath();
  let prev = null, pz = 0, open = false;
  for (const v of list) {
    const z = depth(v);
    if (prev) {
      if (pz >= near && z >= near) { if (!open) { mt(prev); open = true; } lt(v); }
      else if (pz >= near) { if (!open) mt(prev); lt(at(prev, v, pz, z)); open = false; _nsSolar.skippedBehind++; }
      else if (z >= near) { mt(at(prev, v, pz, z)); lt(v); open = true; _nsSolar.skippedBehind++; }
      else { open = false; _nsSolar.skippedBehind++; }
    } else if (z < near) _nsSolar.skippedBehind++;
    prev = v; pz = z;
  }
  ctx.stroke();
}
function _nsSolarDraw(ctx, w, h) {
  const L = { cx: w / 2, cy: h / 2, scale: Math.min(w, h) / 2 * 0.9 }, cam = _nsSolarCamera();
  const lt = document.body.classList.contains('light'), chk = (id) => document.getElementById(id).checked;
  const s = _nsSolarScene(_moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT));
  const rose = document.getElementById('nsGlobeRose'); if (rose) rose.style.display = 'none';   // the rose is the Earth's
  _nsSolar.drawn = []; _nsSolar.skippedBehind = 0; _nsSolar.orbitsDrawn = 0; _nsSolar.cam = cam; _nsSolar.L = L; _nsSolar.scene = s;
  _nsGlobeDrawSky(ctx, L, _nsSolarSkyCam(cam), null, { bodies: false });
  ctx.save();
  // the orbits
  const planetsOn = chk('chkNightSkyPlanets'), shown = s.planets.filter(p => planetsOn && p.shown);
  ctx.lineWidth = 1.2;
  for (const p of shown) {
    ctx.strokeStyle = _nsSolarInk(p.color); ctx.globalAlpha = 0.45;
    _nsSolarPath(ctx, cam, L, s.orbits[p.key]); _nsSolar.orbitsDrawn++;
  }
  ctx.strokeStyle = lt ? '#2b6cb0' : '#5aa0ff'; ctx.globalAlpha = 0.6;
  _nsSolarPath(ctx, cam, L, s.orbits.earth);
  // the Earth - Sun line
  ctx.globalAlpha = 0.5; ctx.setLineDash([4, 4]); ctx.strokeStyle = lt ? '#8a6a10' : '#e8c060';
  _nsSolarPath(ctx, cam, L, [s.earth, s.sun]);
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  // the bodies, far to near
  const bodies = [{ key: 'sun', name: 'Sun', color: '#ffd36b', radiusKm: NS_SOLAR_SUN_KM, pos: s.sun },
    ...shown.map(p => ({ key: p.key, name: p.name, color: p.color, radiusKm: p.radiusKm, pos: p.pos })),
    { key: 'earth', name: 'Earth', color: '#6aa8ff', radiusKm: NS_GLOBE_RE_KM, pos: s.earth }];
  const ep = _nsSolarProject(cam, L, s.earth), mp = _nsSolarProject(cam, L, s.moon);
  if (ep.ahead && mp.ahead && Math.hypot(ep.x - mp.x, ep.y - mp.y) > NS_SOLAR_MOON_PX) bodies.push({ key: 'moon', name: 'Moon', color: '#cfcfcf', radiusKm: 1737.4, pos: s.moon });
  const items = bodies.map(b => ({ b, p: _nsSolarProject(cam, L, b.pos) })).filter(q => q.p.ahead).sort((a, b) => b.p.z - a.p.z);
  ctx.font = "10px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const { b, p } of items) {
    const r = _nsSolarDiscPx(b.radiusKm, cam, L, b.pos);
    if (b.key === 'sun') {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
      g.addColorStop(0, 'rgba(255,214,120,0.7)'); g.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = _nsSolarInk('#fff1c4'); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    } else {
      // Saturn's ring (a flat ellipse): its far half before the disc, its near half after it
      const ring = (a0, a1) => {
        ctx.strokeStyle = _nsSolarInk('#e9cf86'); ctx.globalAlpha = 0.8; ctx.lineWidth = Math.max(1, r * 0.25);
        ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 2.3, r * 2.3 * Math.sin(26.7 * Math.PI / 180), 0, a0, a1); ctx.stroke(); ctx.globalAlpha = 1;
      };
      if (b.key === 'saturn') ring(Math.PI, 2 * Math.PI);
      ctx.fillStyle = _nsSolarInk(b.color); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();   // no phase: a plain disc
      if (b.key === 'saturn') ring(0, Math.PI);
    }
    const lx = p.x + (b.key === 'saturn' ? 2.3 * r : r) + 4;   // Saturn's label clear of its ring
    _nsSolar.drawn.push({ key: b.key, x: p.x, y: p.y, r, lx });
    if (chk('chkNightSkyNames')) { ctx.fillStyle = b.key === 'sun' ? '#e8a020' : _nsSolarInk(b.color); ctx.fillText(b.name, lx, p.y); }
  }
  _nsSolarDrawHover(ctx, cam, L, s);
  ctx.restore();
}

// ── Hover and search ────────────────────────────────────────────────────────────────────────────
// The planet under the mouse (_nsSolar.hover) or found by the search (_nsSolar.focus, the hover
// first) gets a ring and the line from the Earth to it, labelled with its elongation in degrees
// (the angle Sun - Earth - planet) and, within 2° of the longitude of opposition or conjunction
// (_nsSolarLongDiff), the word for it (_nsSolar.line: {key, elong, text}). Only planets drawn
// count: one hidden by Planets is neither hit nor focused (Orbit shows every planet, "Only naked eye" aside).
const NS_SOLAR_HIT_PX = 6, NS_SOLAR_EVENT_DEG = 2;
function _nsSolarHit(x, y) {
  let best = null, bd = Infinity;
  for (const q of _nsSolar.drawn || []) {
    if (q.key === 'sun' || q.key === 'earth' || q.key === 'moon') continue;
    const d = Math.hypot(q.x - x, q.y - y);
    if (d <= Math.max(q.r, NS_SOLAR_HIT_PX) && d < bd) { bd = d; best = q.key; }
  }
  return best;
}
// The search's planet: the camera goes round over it (its heliocentric longitude), far enough to
// have it in front, and it is ringed until the next search or the view is left
function _nsSolarFocus(key) {
  const p = PLANETS.find(q => q.key === key);
  if (!p || !_planetShown(p) || !document.getElementById('chkNightSkyPlanets').checked) { _nsSolar.focus = null; return; }
  const P = _planetHelio(key, _moonJDE(nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT)), r = Math.hypot(...P);
  _nsSolar.focus = key;
  _nsGlobe.camAz = Math.atan2(P[1], P[0]);
  if (_nsGlobe.dist < r * 1.5) _nsGlobeSetCam('dist', Math.min(NS_SOLAR_DIST_MAX, r * 1.5));
  else _nsGlobeSyncCamCtl();
}
function _nsSolarDrawHover(ctx, cam, L, s) {
  _nsSolar.line = null;
  const key = _nsSolar.hover || _nsSolar.focus, d = key && (_nsSolar.drawn || []).find(q => q.key === key);
  const box = document.getElementById('nsSolarInfoBox');
  if (!d) { box.style.display = 'none'; return; }
  const P = s.planets.find(q => q.key === key), E = _nsSolarProject(cam, L, s.earth);
  const elong = _nsSolarElongation(key, s), ld = _nsSolarLongDiff(key, s);
  const word = Math.abs(ld - 180) < NS_SOLAR_EVENT_DEG ? ' · opposition' : (ld < NS_SOLAR_EVENT_DEG || ld > 360 - NS_SOLAR_EVENT_DEG) ? ' · conjunction' : '';
  const text = `${Math.round(elong)}° from the Sun${word}`;
  ctx.save();
  ctx.strokeStyle = _nsSolarInk(P.color); ctx.lineWidth = 1.2; ctx.globalAlpha = 0.85;
  if (E.ahead) { ctx.beginPath(); ctx.moveTo(E.x, E.y); ctx.lineTo(d.x, d.y); ctx.stroke(); }
  ctx.globalAlpha = 1; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(d.x, d.y, d.r + 5, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  _nsSolar.line = { key, elong, text };
  const sun = Math.hypot(...P.pos), earth = Math.hypot(...P.pos.map((v, i) => v - s.earth[i]));
  box.innerHTML = `<span class="ns-solar-name" style="color:${_nsSolarInk(P.color)}">${P.name}</span>`
    + `<br>Sun&nbsp;&nbsp; ${sun.toFixed(3)} au<br>Earth ${earth.toFixed(3)} au<br><span class="ns-solar-dim">${text}</span>`;
  box.style.borderColor = _nsSolarInk(P.color);
  _nsSolarPlaceInfo(box, d);
}
// The box beside the planet, never over it or the cursor: the cursor's tip is anywhere within the
// hit radius (the disc, at least NS_SOLAR_HIT_PX) and its arrow hangs down and to the right of the tip, so the
// box goes above and to the right, above and to the left near the right edge, or below and to the
// left near the top - never below and to the right.
const NS_SOLAR_INFO_GAP = 10;
function _nsSolarPlaceInfo(box, d) {
  const cv = document.getElementById('nightSkyCanvas'), W = cv.clientWidth, R = Math.max(d.r, NS_SOLAR_HIT_PX) + NS_SOLAR_INFO_GAP;
  box.style.display = 'block';
  const w = box.offsetWidth, h = box.offsetHeight;
  let x = d.x + R, y = d.y - R - h;
  if (x + w > W - 4) x = d.x - R - w;
  if (y < 4) { x = d.x - R - w; y = d.y + R; }
  box.style.left = (cv.offsetLeft + Math.max(4, x)) + 'px';
  box.style.top = (cv.offsetTop + y) + 'px';
}
function _nsSolarHideInfo() { const b = document.getElementById('nsSolarInfoBox'); if (b) b.style.display = 'none'; }
// the mouse off the canvas (onto the switch, the panels, away): no hover left behind
document.getElementById('nightSkyCanvas').addEventListener('pointerleave', () => {
  if (_nsSolar.hover === null) return;
  _nsSolar.hover = null;
  if (typeof _nsGlobeActive === 'function' && _nsGlobeActive() && _nsGlobe.body === 'sun') drawNightSky();
});
document.getElementById('nightSkyCanvas').addEventListener('pointermove', (e) => {
  if (typeof _nsGlobeActive !== 'function' || !_nsGlobeActive() || _nsGlobe.body !== 'sun') return;
  const rc = e.currentTarget.getBoundingClientRect(), k = _nsSolarHit(e.clientX - rc.left, e.clientY - rc.top);
  if (k !== _nsSolar.hover) { _nsSolar.hover = k; drawNightSky(); }
});
