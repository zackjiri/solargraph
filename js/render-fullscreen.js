// ─── Fullscreen for every canvas view ───────────────────────────────────────────────────────────
// A small square at the right end of the readout (#btnFullscreen), shown whenever a view with a
// canvas is on screen: Gallery, Analyzer (3D Model, Image, Sun Graph, Sky Dome), Eclipse
// Visualization, Night Sky Visualization. Not in the Catalogs or without an image.
// On: the body class app-fullscreen hides the header, the sidebar, the footer and the side panels
// (css/style.css); the readout stays as the top strip and the canvas fills the rest. The browser's
// own fullscreen is asked for too where it is allowed (not on iPhone); without it the layout fills
// the window. Switching inside the canvas (Sky Dome projection, Night Sky sub-mode) keeps it on.
// Off: the button again, Escape (the browser's own exit included), the 3D Model's exit button, or
// any change that leaves no canvas view (_appFsSync after every click, key and change).
let _appFsOn = false;

function _appFsAllowed() {
  const cc = document.getElementById('canvasContainer');
  if (!cc || cc.classList.contains('hidden') || !cc.getClientRects().length) return false;
  if (typeof eclipseActive !== 'undefined' && eclipseActive && eclipseSubView !== 'visualization') return false;
  if (typeof nightSkyActive !== 'undefined' && nightSkyActive && nightSkyTopView !== 'visualization') return false;
  return true;
}
function _appFsDocElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }

// Every view resizes on window resize or on its container's ResizeObserver; the event covers the
// views that only listen to the window (Night Sky, Eclipse).
function _appFsRelayout() { window.dispatchEvent(new Event('resize')); }

function _appFsSet(on) {
  on = !!on && _appFsAllowed();
  if (on === _appFsOn) return;
  _appFsOn = on;
  document.body.classList.toggle('app-fullscreen', on);
  const btn = document.getElementById('btnFullscreen');
  btn.classList.toggle('active', on);
  btn.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen';
  const root = document.documentElement;
  try {
    if (on) {
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      const p = req && req.call(root);
      if (p && p.catch) p.catch(() => {});   // refused: the layout alone fills the window
    } else if (_appFsDocElement()) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      const p = ex && ex.call(document);
      if (p && p.catch) p.catch(() => {});
    }
  } catch (e) { /* no Fullscreen API */ }
  _appFsRelayout();
}

// The button only with a canvas view on screen; fullscreen ends where there is none.
function _appFsSync() {
  const ok = _appFsAllowed();
  document.getElementById('btnFullscreen').style.display = ok ? 'flex' : 'none';
  if (!ok && _appFsOn) _appFsSet(false);
}

document.getElementById('btnFullscreen').addEventListener('click', () => _appFsSet(!_appFsOn));
document.getElementById('btnTheaterExit').addEventListener('click', () => _appFsSet(false));
for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(ev, () => { if (!_appFsDocElement() && _appFsOn) _appFsSet(false); else _appFsRelayout(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _appFsOn) _appFsSet(false); });
// After the page's own handlers have switched the view
for (const ev of ['click', 'change', 'keyup', 'pointerup']) document.addEventListener(ev, () => setTimeout(_appFsSync, 0));
_appFsSync();
setTimeout(_appFsSync, 500);   // the first image arrives after load
