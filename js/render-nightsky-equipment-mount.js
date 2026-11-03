// ─── Equipment: the camera's mount and frame (Night Sky, Planetarium) ─────────────────────────────
// Imaging setups (render-nightsky-equipment.js) show the sensor as a frame in the centre of the
// view. One mount for all of them (_nsEqMount, page only):
//  - EQ lock off (alt-az mount): angle 0 = the long side level with the horizon, the angle counted
//    from the vertical toward the zenith;
//  - EQ lock on (equatorial mount): the angle is the position angle (PA), 0 = the frame's top toward
//    the north celestial pole, positive toward the east, as the Catalog photos (_nightSkyFrameCorners).
// The arrows turn it by 5° (0° to 355°); switching EQ lock sets it back to 0. With EQ lock the frame
// turns with the sky as time runs, without it stays level (field rotation, as a real alt-az mount).
// Spec: specs/2026-11-03-planetarium-equipment-imaging-design.md (outside the version folders).

const NS_EQ_MOUNT_STEP = 5;
const _nsEqMount = { eqLock: false, angle: 0 };
function _nsEqMountRotate(stepDeg) {
  _nsEqMount.angle = ((_nsEqMount.angle + stepDeg) % 360 + 360) % 360;
  _nsEqChanged();
}
function _nsEqMountSetLock(on) {
  _nsEqMount.eqLock = !!on;
  _nsEqMount.angle = 0;
  _nsEqChanged();
}
function _nsEqMountLabel() {
  return (_nsEqMount.eqLock ? 'PA ' : '') + _nsEqMount.angle + '°';
}

// The frame's axes on the sky around the view direction F (horizontal coordinates: x east, y north,
// z zenith): N, the reference "up" in the tangent plane (toward the zenith, or with EQ lock toward
// the north celestial pole); when that is the view direction itself (looking at the pole or the
// zenith), the camera's own up. E = N × F points east. The mount's angle turns "up" from N toward E;
// "right" is F × up, the screen's right at angle 0.
function _nsEqFrameBasis() {
  const F = _nightSkyPlanet3D.FWD;
  const R = _nsEqMount.eqLock ? _skyDomeUnitVec(0, _nightSkyLatSigned()) : [0, 0, 1];
  const d = _sd3Dot(R, F);
  let N = [R[0] - d * F[0], R[1] - d * F[1], R[2] - d * F[2]];
  const len = Math.hypot(N[0], N[1], N[2]);
  N = len < 1e-6 ? _nightSkyPlanet3D.UP : [N[0] / len, N[1] / len, N[2] / len];
  const E = _sd3Cross(N, F), a = _nsEqMount.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const up = [c * N[0] + s * E[0], c * N[1] + s * E[1], c * N[2] + s * E[2]];
  return { F, up, right: _sd3Cross(F, up) };
}
// The frame's outline on the canvas: corners TL, TR, BR, BL at tan(half field) in the tangent plane
// (a real, gnomonic lens), each side cut into `segs` pieces, every point projected by the
// Planetarium, so a wide frame bends as it should. 4 · segs points, top side first.
function _nsEqFramePath(setup, layout, segs = 16) {
  const c = _nsEqComputeImaging(setup), D2R = Math.PI / 180;
  const hw = Math.tan(c.fovW / 2 * D2R), hh = Math.tan(c.fovH / 2 * D2R);
  const { F, up, right } = _nsEqFrameBasis();
  const corners = [[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i], [x1, y1] = corners[(i + 1) % 4];
    for (let j = 0; j < segs; j++) {
      const t = j / segs, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const v = [F[0] + x * right[0] + y * up[0], F[1] + x * right[1] + y * up[1], F[2] + x * right[2] + y * up[2]];
      const n = Math.hypot(v[0], v[1], v[2]);
      const q = _nightSkyPlanetProjectRaw(layout, [v[0] / n, v[1] / n, v[2] / n]);
      pts.push({ x: q.x, y: q.y });
    }
  }
  return pts;
}

// The control at the top centre (#nightSkyEquipmentMount): while a camera's frame is in the view
// (_nsEqViewOn and an Imaging setup shown); EQ lock highlighted when on, the angle under the arrows.
// The left arrow turns the frame anticlockwise on screen, +5° (toward the east), the right one -5°,
// each the way it is drawn. Placed clear of the info panel, the view picker and the zoom slider
// (_nsEqPlaceMount, again on every change of their size or the canvas's).
// Called on every change and every Planetarium frame (_nsEqDraw; hidden while the star data loads,
// as the frame), so it writes the page only when something differs (_nsEqMountShown).
let _nsEqMountShown = '';
function _nsEqMountSync() {
  const box = document.getElementById('nightSkyEquipmentMount');
  const on = _nsEqViewOn() && _skyDataLoaded && _nsEq.shown.some(e => _nsEqIsImaging(e.setup));
  const key = on ? (_nsEqMount.eqLock ? 'L' : 'U') + _nsEqMount.angle : '';
  if (key === _nsEqMountShown && box.style.display === (on ? 'block' : 'none')) return;
  const was = box.style.display;
  _nsEqMountShown = key;
  box.style.display = on ? 'block' : 'none';
  if (!on) return;
  if (was !== 'block') _nsEqPlaceMount();
  const btn = document.getElementById('btnNightSkyEquipmentEQ');
  btn.classList.toggle('active', _nsEqMount.eqLock);
  btn.setAttribute('aria-pressed', String(_nsEqMount.eqLock));
  document.getElementById('nightSkyEquipmentMountAngle').textContent = _nsEqMountLabel();
}
const NS_EQ_MOUNT_TOP = 12, NS_EQ_MOUNT_GAP = 8;
// Where the control goes, the first place that meets none of the info panel, the view picker and
// the zoom slider: 1. top centre; 2. the gap right of the info panel, below the view picker,
// centred in it; 3. centred below the lower of the info panel and the view picker, moved left of
// the zoom slider if it meets it, and kept inside the canvas.
function _nsEqPlaceMount() {
  const box = document.getElementById('nightSkyEquipmentMount');
  if (box.style.display !== 'block' || !box.offsetParent) return;   // hidden, or an ancestor is
  const parent = box.offsetParent.getBoundingClientRect();
  const rectOf = id => { const el = document.getElementById(id); return el && el.offsetWidth ? el.getBoundingClientRect() : null; };
  const status = rectOf('nightSkyStatusWrap'), picker = rectOf('nightSkySubmodeRow'), zoom = rectOf('nightSkyPlanetZoomCtl');
  const obstacles = [status, picker, zoom].filter(Boolean);
  const place = (cx, top) => { box.style.left = Math.round(cx - parent.left) + 'px'; box.style.top = Math.round(top - parent.top) + 'px'; };
  const clear = () => { const r = box.getBoundingClientRect(); return obstacles.every(q => r.right <= q.left || r.left >= q.right || r.bottom <= q.top || r.top >= q.bottom); };
  const cv = document.getElementById('nightSkyCanvas').getBoundingClientRect(), w = box.offsetWidth;
  place((cv.left + cv.right) / 2, parent.top + NS_EQ_MOUNT_TOP);
  if (clear()) return;
  if (status) {
    const right = zoom ? zoom.left : cv.right;
    if (right - status.right >= w + 2 * NS_EQ_MOUNT_GAP) {
      place((status.right + right) / 2, picker ? picker.bottom + NS_EQ_MOUNT_GAP : parent.top + NS_EQ_MOUNT_TOP);
      if (clear()) return;
    }
  }
  const h = box.offsetHeight;
  let cx = (cv.left + cv.right) / 2;
  let top = Math.max(status ? status.bottom : 0, picker ? picker.bottom : 0) + NS_EQ_MOUNT_GAP;
  top = Math.min(top, cv.bottom - h - NS_EQ_MOUNT_GAP);
  if (zoom && cx + w / 2 > zoom.left - NS_EQ_MOUNT_GAP && top < zoom.bottom && top + h > zoom.top)
    cx = zoom.left - NS_EQ_MOUNT_GAP - w / 2;
  cx = Math.max(cx, cv.left + w / 2 + NS_EQ_MOUNT_GAP);
  place(cx, top);
}
if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(_nsEqPlaceMount);
  for (const id of ['nightSkyCanvas', 'nightSkyStatusWrap', 'nightSkySubmodeRow', 'nightSkyPlanetZoomCtl']) { const el = document.getElementById(id); if (el) ro.observe(el); }
}
document.getElementById('btnNightSkyEquipmentEQ').addEventListener('click', () => _nsEqMountSetLock(!_nsEqMount.eqLock));
document.getElementById('btnNightSkyEquipmentRotL').addEventListener('click', () => _nsEqMountRotate(NS_EQ_MOUNT_STEP));
document.getElementById('btnNightSkyEquipmentRotR').addEventListener('click', () => _nsEqMountRotate(-NS_EQ_MOUNT_STEP));
_nsEqMountSync();
