// ─── Eclipse map (Eclipse Visualization) ────────────────────────────────────────────────────────
// Round globe button in the bottom right corner of Eclipse Visualization (#btnEclipseMap). It opens
// the globe window of SELECT (render-locpick.js) with the active event's map over the Earth, turned
// to its Greatest Eclipse point; the globe turns, zooms and sets the Location as in SELECT, and the
// Eclipse view behind it follows the new Location. Drawn over the Earth, in this order:
//  - the zones between the lines of magnitude, each a dark veil over the one outside it, so the
//    shade darkens step by step as the magnitude grows toward the path (to ~56 % over 0.8);
//  - the path of totality (annularity): the band between its northern and southern limits and its
//    central line;
//  - the lines of equal greatest magnitude 0.2, 0.4, 0.6 and 0.8, labelled, and the line of
//    magnitude 0, the edge of the area where the eclipse is seen at all;
//  - the Greatest Eclipse point;
//  - a legend in the bottom left corner, with the path's width and the central duration at the
//    Greatest Eclipse point.
// The lines are not computed here: tools/eclipse-map.js computes them once from the event's
// Besselian elements and writes js/eclipse-data/<id>.map.js (window.ECLIPSE_MAPS), loaded on the
// first opening of the event's map. Greatest magnitude means while the Sun is up, so near the
// edge of the day side the lines bend to where the eclipse is seen at sunrise or sunset.
// The window closes as the globe of SELECT does (render-locpick.js).
const ECLIPSE_MAP_PATH_FILL = 'rgba(96,42,196,0.46)';   // the slider's totality colour (render-eclipse.js)
const ECLIPSE_MAP_PATH_EDGE = '#b49bff';
const ECLIPSE_MAP_MAG = 'rgba(245,197,24,0.8)';         // the Sun's yellow
const ECLIPSE_MAP_ZONE = 'rgba(6,8,12,0.15)';           // one zone's dark veil, laid on per level
const _eclMap = { data: {}, loading: {} };   // per event id: the lines as unit vectors, or loading

function _eclMapCacheBust() {
  const s = document.querySelector('script[src*="render-eclipse-map.js"]');
  return s && s.src.indexOf('?') >= 0 ? s.src.slice(s.src.indexOf('?')) : '';
}
// The event's map, or null while it loads (then the globe is redrawn when it is in)
function _eclMapGet(id) {
  if (_eclMap.data[id]) return _eclMap.data[id];
  const raw = window.ECLIPSE_MAPS && window.ECLIPSE_MAPS[id];
  if (raw) {
    // steps of at most half a degree: on the canvas a step is a straight line, and a long one of
    // the simplified data (several degrees by the poles) would cut its great-circle arc short
    const vec = (flat) => {
      const out = [];
      for (let i = 0; i < flat.length; i += 2) {
        const v = _locPickVec(flat[i + 1], flat[i]);
        const u = out[out.length - 1];
        if (u) {
          const d = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) / D2R_LP;
          for (let k = 1, n = Math.ceil(d / 0.5); k < n; k++) {
            const f = k / n, w = [u[0] + (v[0] - u[0]) * f, u[1] + (v[1] - u[1]) * f, u[2] + (v[2] - u[2]) * f];
            const l = Math.hypot(w[0], w[1], w[2]);
            out.push([w[0] / l, w[1] / l, w[2] / l]);
          }
        }
        out.push(v);
      }
      return out;
    };
    const mag = {};
    for (const k in raw.mag) mag[k] = raw.mag[k].map(vec);
    _eclMap.data[id] = {
      mag,
      central: raw.central ? vec(raw.central) : null,
      north: raw.north ? vec(raw.north) : null,
      south: raw.south ? vec(raw.south) : null,
      ge: raw.ge || null,
    };
    return _eclMap.data[id];
  }
  if (!_eclMap.loading[id]) {
    _eclMap.loading[id] = true;
    const sc = document.createElement('script');
    sc.src = 'js/eclipse-data/' + id + '.map.js' + _eclMapCacheBust();
    sc.onload = () => _locPickRequest();
    sc.onerror = () => { _eclMap.loading[id] = 'missing'; _locPickRequest(); };
    document.head.appendChild(sc);
  }
  return null;
}

// A closed outline on the sphere (unit vectors) added to a Path2D as its visible part: clipped
// where it passes behind the Earth at the exact point it meets the horizon, and joined there to
// where it comes back by an arc of the limb, turned the way and as far as its hidden part goes
// round the view (the sum of its signed angle steps). A part hidden whole adds the full limb if
// it goes once round the view, else nothing.
function _eclMapRingPath(path, V, ring) {
  const n = ring.length;
  const S = ring.map(p => _locPickProject(V, p));
  const ang = (s) => Math.atan2(s.y - V.cy, s.x - V.cx);
  const step = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const horizon = (i, j) => {   // where the edge i-j meets the horizon (z = 0), on the canvas
    const a = ring[i], b = ring[j], f = S[i].z / (S[i].z - S[j].z);
    return _locPickProject(V, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  };
  const k0 = S.findIndex(s => s.z >= 0);
  if (k0 < 0) {
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += step(ang(S[i - 1]), ang(S[i % n]));
    if (Math.abs(sum) > Math.PI) { path.moveTo(V.cx + V.R, V.cy); path.arc(V.cx, V.cy, V.R, 0, Math.PI * 2, sum < 0); path.closePath(); }
    return;
  }
  path.moveTo(S[k0].x, S[k0].y);
  let a0 = 0, sum = 0, prevAng = 0;
  for (let t = 1; t <= n; t++) {
    const i = (k0 + t - 1) % n, j = (k0 + t) % n;
    const vi = S[i].z >= 0, vj = S[j].z >= 0;
    if (vi && vj) { path.lineTo(S[j].x, S[j].y); continue; }
    if (vi && !vj) {   // goes behind: to the horizon, then count the turn of the hidden part
      const h = horizon(i, j);
      path.lineTo(h.x, h.y);
      a0 = prevAng = ang(h); sum = 0;
      sum += step(prevAng, ang(S[j])); prevAng = ang(S[j]);
      continue;
    }
    if (!vi && !vj) { sum += step(prevAng, ang(S[j])); prevAng = ang(S[j]); continue; }
    const h = horizon(i, j);   // comes back: along the limb to the horizon point, then on
    sum += step(prevAng, ang(h));
    path.arc(V.cx, V.cy, V.R, a0, a0 + sum, sum < 0);
    path.lineTo(S[j].x, S[j].y);
  }
  path.closePath();
}
function _eclMapFillBand(ctx, V, north, south) {
  const path = new Path2D();
  const ring = north.concat(south.slice().reverse());
  ring.push(ring[0]);
  _eclMapRingPath(path, V, ring);
  ctx.fillStyle = ECLIPSE_MAP_PATH_FILL;
  ctx.fill(path);
}
// Whether the great-circle arcs a-b and c-d cross (unit vectors)
function _eclMapArcsCross(a, b, c, d) {
  const X = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const D = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const n1 = X(a, b), n2 = X(c, d), t = X(n1, n2);
  for (const s of [1, -1]) {
    const p = [t[0] * s, t[1] * s, t[2] * s];
    if (D(X(a, p), n1) >= 0 && D(X(p, b), n1) >= 0 && D(X(c, p), n2) >= 0 && D(X(p, d), n2) >= 0) return true;
  }
  return false;
}
// The zone of one level: the rings bound the area where the greatest magnitude exceeds the level,
// which holds the Greatest Eclipse point G. On the canvas the rings, clipped at the horizon and
// closed along the limb (_eclMapRingPath), split the disc into an inside and an outside; the side to fill is the one the view's centre falls
// on if the centre and G lie on the same side on the sphere (an even number of crossings of the
// arc from G to the centre with the rings), else the other.
function _eclMapFillZone(ctx, V, rings, G) {
  const path = new Path2D();
  for (const ring of rings) _eclMapRingPath(path, V, ring);
  // the map opens turned to G: with the centre on it there is no arc (and no crossing) to count
  let crossings = 0;
  const gc = G[0] * V.c[0] + G[1] * V.c[1] + G[2] * V.c[2];
  if (gc < 1 - 1e-10) {
    for (const ring of rings) for (let i = 1; i < ring.length; i++) if (_eclMapArcsCross(G, V.c, ring[i - 1], ring[i])) crossings++;
  }
  const centreIn = crossings % 2 === 0;
  if (ctx.isPointInPath(path, V.cx, V.cy, 'evenodd') === centreIn) {
    ctx.fillStyle = ECLIPSE_MAP_ZONE; ctx.fill(path, 'evenodd');
  } else {   // the disc but the rings' inside
    const rest = new Path2D();
    rest.arc(V.cx, V.cy, V.R, 0, Math.PI * 2);
    rest.addPath(path);
    ctx.fillStyle = ECLIPSE_MAP_ZONE; ctx.fill(rest, 'evenodd');
  }
}
function _eclMapLabel(ctx, text, x, y, col) {
  ctx.font = "10px 'Share Tech Mono', monospace";
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 6;
  ctx.fillStyle = 'rgba(7,9,13,0.72)';
  ctx.fillRect(x - w / 2, y - 7, w, 14);
  ctx.fillStyle = col;
  ctx.fillText(text, x, y + 0.5);
}

// A label per magnitude line, at its point nearest the view's centre that leaves the label clear
// of those already placed (with a gap), of the Greatest Eclipse mark and of the legend: where
// lines crowd, by the limb or zoomed out, the labels spread along their lines instead of piling
// up, and a line with no free point left goes without one. Only points well inside the disc
// (z > 0.35) take a label.
const ECLIPSE_MAP_LABEL_GAP = 6;
function _eclMapLabels(ctx, V, M, G, ev, h) {
  ctx.font = "10px 'Share Tech Mono', monospace";
  const taken = [];
  const free = (b) => taken.every(t => b.x1 + ECLIPSE_MAP_LABEL_GAP <= t.x0 || t.x1 + ECLIPSE_MAP_LABEL_GAP <= b.x0
    || b.y1 + ECLIPSE_MAP_LABEL_GAP <= t.y0 || t.y1 + ECLIPSE_MAP_LABEL_GAP <= b.y0);
  const g = _locPickProject(V, G);
  if (g.z > 0) taken.push({ x0: g.x - 8, y0: g.y - 8, x1: g.x + 8, y1: g.y + 8 });
  const L = _eclMapLegendLayout(ctx, M, ev, h);
  taken.push({ x0: L.x0, y0: L.y0, x1: L.x0 + L.W, y1: L.y0 + L.H });
  for (const k in M.mag) {
    if (k === '0.0') continue;
    const w = ctx.measureText(k).width + 6;
    for (const line of M.mag[k]) {
      const cand = [];
      for (let i = 0; i < line.length; i++) {
        const s = _locPickProject(V, line[i]);
        if (s.z > 0.35) cand.push(s);
      }
      cand.sort((a, b) => b.z - a.z);
      for (const s of cand) {
        const b = { x0: s.x - w / 2, y0: s.y - 7, x1: s.x + w / 2, y1: s.y + 7 };
        if (!free(b)) continue;
        taken.push(b);
        _eclMapLabel(ctx, k, s.x, s.y, '#f5c518');
        break;
      }
    }
  }
}

// Called by _locPickDraw (render-locpick.js) over the Earth, clipped to the disc, while the window
// shows an event's map.
function _eclMapDraw(ctx, V, w, h) {
  const ev = _eclipseActiveEvent;
  const M = _eclMapGet(ev.id);
  if (!M) {
    ctx.fillStyle = '#8899aa'; ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(_eclMap.loading[ev.id] === 'missing' ? 'No map for this eclipse' : 'Loading the eclipse map…', w / 2, h - 40);
    return;
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R, 0, Math.PI * 2); ctx.clip();
  const g = ev.greatestEclipse;
  const G = _locPickVec(g.lonHemisphere * g.lon, g.hemisphere * g.lat);
  // isPointInPath works in the canvas's own pixels: the zones under an identity transform
  const res = ctx.getTransform().a;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const Vp = Object.assign({}, V, { cx: V.cx * res, cy: V.cy * res, R: V.R * res });
  for (const k in M.mag) if (M.mag[k].length) _eclMapFillZone(ctx, Vp, M.mag[k], G);
  ctx.restore();
  if (M.north && M.south && M.north.length > 1 && M.south.length > 1) _eclMapFillBand(ctx, V, M.north, M.south);
  // magnitude lines, the edge of visibility stronger
  ctx.lineJoin = 'round';
  for (const k in M.mag) {
    ctx.lineWidth = k === '0.0' ? 1.6 : 1;
    ctx.strokeStyle = ECLIPSE_MAP_MAG;
    ctx.setLineDash(k === '0.0' ? [] : [5, 3]);
    _locPickStrokeLines(ctx, V, M.mag[k]);
  }
  ctx.setLineDash([]);
  if (M.north) {
    ctx.lineWidth = 1.2; ctx.strokeStyle = ECLIPSE_MAP_PATH_EDGE;
    _locPickStrokeLines(ctx, V, [M.north, M.south]);
    ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(235,228,255,0.9)';
    _locPickStrokeLines(ctx, V, [M.central]);
  }
  _eclMapLabels(ctx, V, M, G, ev, h);
  // the Greatest Eclipse point: a ringed dot
  const s = _locPickProject(V, G);
  if (s.z > 0) {
    ctx.beginPath(); ctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
  }
  ctx.restore();
  _eclMapLegend(ctx, M, ev, h);
}
// The legend's rows and box (bottom left), also kept free of the line labels
function _eclMapLegendLayout(ctx, M, ev, h) {
  const central = ev.type === 'annular' ? 'annularity' : 'totality';
  const rows = [];
  if (M.north) {
    let sub = '';
    if (M.ge) {
      const d = M.ge.duration;
      sub = M.ge.width + ' km wide'
        + (d !== null ? ', ' + Math.floor(d / 60) + 'm ' + String(d % 60).padStart(2, '0') + 's' : '')
        + ' at greatest eclipse';
    }
    rows.push({ kind: 'band', text: 'Path of ' + central, sub });
  }
  rows.push({ kind: 'dash', text: 'Greatest magnitude 0.2 to 0.8' });
  rows.push({ kind: 'line', text: 'Edge of visibility' });
  rows.push({ kind: 'ge', text: 'Greatest eclipse' });
  const lineH = 15, pad = 8;
  const H = pad * 2 + rows.reduce((s, r) => s + lineH + (r.sub ? 12 : 0), 0) - 3;
  const x0 = 12, y0 = h - 12 - H;
  ctx.font = "10px 'Share Tech Mono', monospace";
  const W = pad * 2 + 22 + Math.max(...rows.map(r => Math.max(ctx.measureText(r.text).width, r.sub ? ctx.measureText(r.sub).width * 0.9 : 0)));
  return { rows, x0, y0, W, H, lineH, pad };
}
function _eclMapLegend(ctx, M, ev, h) {
  const { rows, x0, y0, W, H, lineH, pad } = _eclMapLegendLayout(ctx, M, ev, h);
  ctx.fillStyle = 'rgba(7,9,13,0.72)';
  ctx.fillRect(x0, y0, W, H);
  ctx.strokeStyle = 'rgba(160,200,240,0.25)'; ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, H - 1);
  let y = y0 + pad + 5;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const r of rows) {
    const sx = x0 + pad, sw = 16;
    if (r.kind === 'band') {
      ctx.fillStyle = ECLIPSE_MAP_PATH_FILL; ctx.fillRect(sx, y - 4, sw, 8);
      ctx.strokeStyle = ECLIPSE_MAP_PATH_EDGE; ctx.lineWidth = 1; ctx.strokeRect(sx + 0.5, y - 3.5, sw - 1, 7);
    } else if (r.kind === 'ge') {
      ctx.beginPath(); ctx.arc(sx + sw / 2, y, 4.5, 0, Math.PI * 2);
      ctx.lineWidth = 1.3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(sx + sw / 2, y, 1.6, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    } else {
      ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + sw, y);
      ctx.strokeStyle = ECLIPSE_MAP_MAG; ctx.lineWidth = r.kind === 'line' ? 1.6 : 1;
      ctx.setLineDash(r.kind === 'dash' ? [5, 3] : []); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = '#d6dde5'; ctx.font = "10px 'Share Tech Mono', monospace";
    ctx.fillText(r.text, sx + sw + 6, y);
    y += lineH;
    if (r.sub) {
      ctx.fillStyle = '#8899aa'; ctx.font = "9px 'Share Tech Mono', monospace";
      ctx.fillText(r.sub, sx + sw + 6, y - 3);
      y += 12;
    }
  }
}

// ── The button ──────────────────────────────────────────────────────────────────────────────────
function _eclMapOpen() {
  _locPickSetOpen(true, _eclipseActiveEvent.id);
}
document.getElementById('btnEclipseMap').addEventListener('click', (e) => { e.stopPropagation(); _eclMapOpen(); });
