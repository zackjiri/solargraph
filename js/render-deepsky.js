// ─── Deep sky objects (Night Sky: Sky Map, Planetarium, Globe) ─────────────────────────────────
// Sources, all from D3-Celestial (see data/celestial/NOTICE.md): messier.json (the 110 Messier
// objects, each with its NGC designation and, for some, a common name), dsos.bright.json (32
// showpieces of the whole sky picked by Olaf Frohn) and dsonames.json (common names by NGC/IC and
// catalogue designation). Messier never saw south of Dec −35°, so the bright list adds the southern
// sky (the Magellanic Clouds, ω Centauri, 47 Tucanae, η Carinae) and the naked-eye clusters Messier
// skipped (the Hyades, the Double Cluster, the Coathanger, Mel 111, α Persei). A bright object that
// is also a Messier object (M45 as "M 45", M31 as "NGC 224") is left out, the Messier entry kept:
// 132 objects in all.
//
// Symbols follow the usual star-atlas conventions, sized by the object's real angular size (`dim`,
// arcminutes) with a floor, so a zoomed Planetarium shows M31 or the Magellanic Clouds at true size.
// The data has no position angle, so a galaxy's ellipse keeps its axis ratio but lies level on
// screen. Labels (Display "Labels"): "M31" for a Messier object, otherwise its common name, else its
// designation.
let _dsoList = [];   // [{ra, dec, kind, semiDeg, ratio, mag, label}]

const DSO_KIND = {
  g: 'galaxy', gg: 'galaxy', s: 'galaxy', s0: 'galaxy', sd: 'galaxy', i: 'galaxy', e: 'galaxy',
  oc: 'open', gc: 'globular', pn: 'planetary',
  bn: 'nebula', sfr: 'nebula', rn: 'nebula', en: 'nebula', snr: 'nebula', dn: 'nebula',
};
const DSO_MIN_R = 3.5;   // px, the smallest symbol radius

// "190x60" -> [190, 60]; "13" -> [13, 13]; "" -> [0, 0] (arcminutes).
function _dsoDim(s) {
  const p = String(s || '').split('x').map(parseFloat);
  const a = p[0] > 0 ? p[0] : 0, b = p[1] > 0 ? p[1] : a;
  return [a, b];
}
function _dsoEntry(f, label) {
  const [a, b] = _dsoDim(f.properties.dim);
  return {
    ra: f.geometry.coordinates[0], dec: f.geometry.coordinates[1],
    kind: DSO_KIND[f.properties.type] || 'other',
    semiDeg: a / 120, ratio: a > 0 ? Math.max(0.35, b / a) : 1,
    mag: parseFloat(f.properties.mag),
    label,
  };
}
function _dsoLoad() {
  const get = (name) => fetch('data/celestial/' + name).then(r => r.json());
  return Promise.all([get('messier.json'), get('dsos.bright.json'), get('dsonames.json')])
    .then(([messier, bright, names]) => {
      const key = (s) => String(s || '').replace(/\s+/g, '');
      const taken = new Set();
      const list = messier.features.map(f => {
        taken.add(key(f.id)); if (f.properties.desig) taken.add(key(f.properties.desig));
        return _dsoEntry(f, f.properties.name || f.id);
      });
      for (const f of bright.features) {
        if (taken.has(key(f.id))) continue;
        const n = names[f.id];
        list.push(_dsoEntry(f, (n && n.name) || f.properties.desig || f.id));
      }
      _dsoList = list;
    })
    .catch(err => console.warn('Deep sky data not loaded:', err));
}

function _dsoShown() {
  return _dsoList.length > 0 && document.getElementById('chkNightSkyDeepSky').checked;
}
// Galaxies red, clusters yellow, nebulae green, as in printed atlases; darker on the light theme.
function _dsoColor(kind) {
  const lt = document.body.classList.contains('light');
  if (kind === 'galaxy') return lt ? '#b3261e' : '#ff8a80';
  if (kind === 'open' || kind === 'globular') return lt ? '#9a6b00' : '#ffd54f';
  if (kind === 'nebula' || kind === 'planetary') return lt ? '#2e7d32' : '#7fdc9a';
  return lt ? '#5a6470' : '#b8c4d0';
}

// One symbol at (x, y), radius r px.
function _dsoSymbol(ctx, o, x, y, r) {
  ctx.beginPath();
  switch (o.kind) {
    case 'galaxy':
      ctx.ellipse(x, y, r, Math.max(DSO_MIN_R * 0.6, r * o.ratio), 0, 0, 2 * Math.PI);
      ctx.stroke();
      break;
    case 'open':
      ctx.setLineDash([2.5, 2]);
      ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'globular':
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
      ctx.stroke();
      break;
    case 'planetary': {
      const q = r * 0.6;
      ctx.arc(x, y, q, 0, 2 * Math.PI);
      ctx.moveTo(x - r, y); ctx.lineTo(x - q, y); ctx.moveTo(x + q, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r); ctx.lineTo(x, y - q); ctx.moveTo(x, y + q); ctx.lineTo(x, y + r);
      ctx.stroke();
      break;
    }
    case 'nebula':
      ctx.rect(x - r, y - r, 2 * r, 2 * r); ctx.stroke();
      break;
    default:
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
      ctx.closePath(); ctx.stroke();
  }
}

// Draws every object place(o) returns a screen position for ({x, y, r, alpha} or null).
function _dsoDraw(ctx, place) {
  const labels = document.getElementById('chkNightSkyNames').checked;
  ctx.save();
  ctx.lineWidth = 1.1;
  ctx.font = "10px 'Share Tech Mono', monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const limit = _nightSkyMagLimit();   // Display "Mag ≤" (render-nightsky.js)
  for (const o of _dsoList) {
    if (o.mag > limit) continue;
    const p = place(o);
    if (!p) continue;
    const col = _dsoColor(o.kind);
    ctx.globalAlpha = p.alpha;
    ctx.strokeStyle = col;
    _dsoSymbol(ctx, o, p.x, p.y, p.r);
    if (labels) { ctx.fillStyle = col; ctx.fillText(o.label, p.x + p.r + 3, p.y); }
  }
  ctx.restore();
}

function _dsoAzEl(o) {
  return _skyStarAzEl(o.ra, o.dec, nightSkyYear, nightSkyMonth, nightSkyDay, nightSkyHourUT);
}
// Sky Map: the polar planisphere, R px for 90°.
function _dsoDrawSkyMap(ctx, layout) {
  const pxPerDeg = layout.R / 90;
  _dsoDraw(ctx, (o) => {
    const p = _dsoAzEl(o);
    if (p.el < 0) return null;
    const vis = _nightSkyVisFactor(o.mag + _nightSkyExtinctionMag(p.el), p.az, p.el, o.mag);   // Mag ≤, Atmosphere
    if (!vis) return null;
    const pt = _skyDomePoint(layout.cx, layout.cy, layout.R, p.az, p.el);
    return { x: pt.x, y: pt.y, r: Math.max(DSO_MIN_R, o.semiDeg * pxPerDeg), alpha: vis };
  });
}
// Planetarium: the fisheye, fading towards the rim as the stars do.
function _dsoDrawPlanetarium(ctx, layout) {
  const pxPerDeg = _nightSkyPlanet3D.FOCAL * layout.scale * Math.PI / 180;
  _dsoDraw(ctx, (o) => {
    const p = _dsoAzEl(o);
    if (p.el < 0) return null;
    const pr = _nightSkyPlanetProject(layout, p.az, p.el);
    if (!pr.visible) return null;
    const vis = _nightSkyVisFactor(o.mag + _nightSkyExtinctionMag(p.el), p.az, p.el, o.mag);   // Mag ≤, Atmosphere
    if (!vis) return null;
    return { x: pr.x, y: pr.y, r: Math.max(DSO_MIN_R, o.semiDeg * pxPerDeg), alpha: pr.alpha * vis };
  });
}
// Globe: directions at infinity on the sky behind the Earth (toDate: J2000 -> equator of date);
// the globe is drawn over them afterwards.
function _dsoDrawGlobe(ctx, L, cam, toDate) {
  const pxPerDeg = cam.F * L.scale * Math.PI / 180;
  _dsoDraw(ctx, (o) => {
    const p = _nsGlobeProjectDir(cam, L, toDate(_skyDomeUnitVecRaDec({ ra: o.ra, dec: o.dec })));
    return p ? { x: p.x, y: p.y, r: Math.max(DSO_MIN_R, o.semiDeg * pxPerDeg), alpha: 1 } : null;
  });
}
