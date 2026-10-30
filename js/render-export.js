// ─── Image export (Sky Map, Sun Graph) ──────────────────────────────────────────────────────────
// Round button at the right of the round buttons in the bottom right corner (#btnNightSkyExport),
// in the Sky Map (flat and 3D) and the Sun Graph. It opens #nightSkyExportPanel above the buttons:
// a standard 16:9 resolution, a format and DOWNLOAD.
// The view is drawn again into its own canvas at the chosen size and copied out before the canvas
// gets its screen size back, all in one task, so the screen never shows the export frame. The
// layout is that of a 1080 px tall screen (1280×720 that of a 720 px one): lines, dots and labels
// keep the same share of the picture at every resolution, the larger ones only add sharpness.
// The sky glow and the Milky Way are computed on their own grid (a point per 3×3 layout px) and
// smoothed up, as on the screen. Only the canvas is exported, not the panels and switches over it.
const NS_EXPORT_RES = [
  { w: 1280, h: 720, name: 'HD' },
  { w: 1920, h: 1080, name: 'Full HD' },
  { w: 2560, h: 1440, name: 'QHD' },
  { w: 3840, h: 2160, name: '4K UHD' },
  { w: 7680, h: 4320, name: '8K UHD' },
];
const NS_EXPORT_FMT = [
  { mime: 'image/png', ext: 'png', name: 'PNG' },
  { mime: 'image/jpeg', ext: 'jpg', name: 'JPEG', q: 0.92 },
  { mime: 'image/webp', ext: 'webp', name: 'WebP', q: 0.92 },
];
const _nsExport = { open: false, res: 3, fmt: 0 };
let _nsExportBusy = false;   // read by the Sun Graph source: no room kept for the time strip

function _nsExportShown() {
  return nightSkyActive && nightSkyTopView === 'visualization'
    && (nightSkySubmode === 'skymap' || nightSkySubmode === 'sungraph');
}
// Called from _nightSkyUpdatePlanetControlsVisibility (render-nightsky.js) on every view change.
function _nsExportSyncUI() {
  const shown = _nsExportShown();
  document.getElementById('btnNightSkyExport').style.display = shown ? 'flex' : 'none';
  if (!shown) _nsExportSetOpen(false);
}
function _nsExportSetOpen(on) {
  _nsExport.open = on;
  document.getElementById('nightSkyExportPanel').classList.toggle('open', on);
  const btn = document.getElementById('btnNightSkyExport');
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', String(on));
  if (on) {
    if (typeof _nsSearchSetOpen === 'function' && _nsSearch.open) _nsSearchSetOpen(false);
    _nsExportNote('');
  }
}
function _nsExportNote(text) {
  document.getElementById('nightSkyExportNote').textContent = text || '';
}

// The browser's own encoders: WebP is offered only where toBlob can write it (not in Safari).
function _nsExportCanEncode(mime) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c.toDataURL(mime).startsWith('data:' + mime);
}
function _nsExportBuildPanel() {
  const resBox = document.getElementById('nightSkyExportRes');
  NS_EXPORT_RES.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ns-exp-opt'; b.dataset.i = i;
    b.innerHTML = '<span class="ns-exp-name">' + r.name + '</span><span class="ns-exp-sub">' + r.w + '×' + r.h + '</span>';
    b.addEventListener('click', () => { _nsExport.res = i; _nsExportMarkActive(); });
    resBox.appendChild(b);
  });
  const fmtBox = document.getElementById('nightSkyExportFmt');
  NS_EXPORT_FMT.forEach((f, i) => {
    if (f.mime !== 'image/png' && !_nsExportCanEncode(f.mime)) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ns-exp-opt'; b.dataset.i = i;
    b.textContent = f.name;
    b.addEventListener('click', () => { _nsExport.fmt = i; _nsExportMarkActive(); });
    fmtBox.appendChild(b);
  });
  _nsExportMarkActive();
}
function _nsExportMarkActive() {
  document.querySelectorAll('#nightSkyExportRes .ns-exp-opt').forEach(b =>
    b.classList.toggle('active', +b.dataset.i === _nsExport.res));
  document.querySelectorAll('#nightSkyExportFmt .ns-exp-opt').forEach(b =>
    b.classList.toggle('active', +b.dataset.i === _nsExport.fmt));
}

// Draws the current view into a new canvas of W×H px and returns it. The view's canvas takes the
// export size for the one draw and its own size back right after, redrawn.
function _nsExportRender(W, H, fmt) {
  const sg = nightSkySubmode === 'sungraph';
  const cv = document.getElementById(sg ? 'sunGraphCanvas' : 'nightSkyCanvas');
  const k = Math.max(1, H / 1080);   // export px per layout px
  const keep = { w: cv.width, h: cv.height, res: cv._res };
  const hover = sg ? _nsSgHoverDay : null, emph = sg ? _sgEmphBand : null;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  // the canvas's own background (CSS, by theme) under the drawing, which leaves the margins clear
  octx.fillStyle = getComputedStyle(cv).backgroundColor;
  octx.fillRect(0, 0, W, H);
  _nsExportBusy = true;
  try {
    if (sg) { _nsSgHoverDay = null; _sgEmphBand = null; }
    cv._res = k; cv.width = W; cv.height = H;
    drawNightSky();
    octx.drawImage(cv, 0, 0);
  } finally {
    _nsExportBusy = false;
    if (sg) { _nsSgHoverDay = hover; _sgEmphBand = emph; }
    cv._res = keep.res; cv.width = keep.w; cv.height = keep.h;
    drawNightSky();
  }
  return out;
}
// solargraphy-skymap-2026-10-30-2125-3840x2160.png: the view, the local date and time shown, the size
function _nsExportFileName(r, f) {
  const L = _nightSkyLocalDate();
  const p2 = (n) => String(n).padStart(2, '0');
  const t = Math.floor(L.hour * 60);
  const view = nightSkySubmode === 'sungraph' ? 'sungraph' : nightSkyMap3DOn ? 'skymap3d' : 'skymap';
  return 'solargraphy-' + view + '-' + L.year + '-' + p2(L.month) + '-' + p2(L.day) + '-'
    + p2(Math.floor(t / 60)) + p2(t % 60) + '-' + r.w + 'x' + r.h + '.' + f.ext;
}
function _nsExportDownload() {
  const r = NS_EXPORT_RES[_nsExport.res], f = NS_EXPORT_FMT[_nsExport.fmt];
  const btn = document.getElementById('btnNightSkyExportGo');
  btn.disabled = true;
  _nsExportNote('Rendering ' + r.w + '×' + r.h + '…');
  // a frame for the note to show before the (for 8K, long) draw
  requestAnimationFrame(() => setTimeout(() => {
    let out;
    try { out = _nsExportRender(r.w, r.h, f); }
    catch (err) { btn.disabled = false; _nsExportNote('Rendering failed: ' + err.message); return; }
    out.toBlob((blob) => {
      btn.disabled = false;
      if (!blob) { _nsExportNote('This browser cannot write an image this large.'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = _nsExportFileName(r, f);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      _nsExportNote('Saved ' + a.download + ' (' + (blob.size / 1048576).toFixed(1) + ' MB)');
    }, f.mime, f.q);
  }, 0));
}

_nsExportBuildPanel();
document.getElementById('btnNightSkyExport').addEventListener('click', (e) => {
  e.stopPropagation();
  _nsExportSetOpen(!_nsExport.open);
});
document.getElementById('btnNightSkyExportGo').addEventListener('click', _nsExportDownload);
document.getElementById('nightSkyExportPanel').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { _nsExportSetOpen(false); e.stopPropagation(); }
});
_nsExportSyncUI();
