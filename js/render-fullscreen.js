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
// Text boxes (the Night Sky search, render-search.js): WebKit (Safari, iPad) lets the keyboard work
// in its fullscreen only when asked with Element.ALLOW_KEYBOARD_INPUT (webkitRequestFullscreen),
// so it is asked that way where the flag exists (other browsers: requestFullscreen as such). Should
// the browser still leave its fullscreen on a touch device within APP_FS_KEYBOARD_MS of a text box
// taking the focus (or of the visual viewport resizing, the keyboard, while one has it), the app's
// layout stays on (_appFsDocLost) and the next tap outside a text box asks once for the browser's
// fullscreen again, inside that tap. Any other end of the browser's fullscreen (the user's own
// exit) ends the app's too.
const APP_FS_KEYBOARD_MS = 1000;
let _appFsOn = false, _appFsDocLost = false, _appFsTextAt = -Infinity;

function _appFsAllowed() {
  const cc = document.getElementById('canvasContainer');
  if (!cc || cc.classList.contains('hidden') || !cc.getClientRects().length) return false;
  if (typeof eclipseActive !== 'undefined' && eclipseActive && eclipseSubView !== 'visualization') return false;
  if (typeof nightSkyActive !== 'undefined' && nightSkyActive && nightSkyTopView !== 'visualization') return false;
  return true;
}
function _appFsDocElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
// A touch device (iPad, phones): the on-screen keyboard comes with a focused text box
function _appFsTouch() { return (navigator.maxTouchPoints || 0) > 1; }
function _appFsTextFocused() { return _appFsIsText(document.activeElement); }
function _appFsIsText(el) {
  return !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && /^(text|search|number|email|url|tel|password)$/i.test(el.type || 'text')));
}
// The browser's fullscreen of the page, keyboard input allowed where WebKit has the flag
function _appFsRequestDoc() {
  const root = document.documentElement;
  try {
    const kb = typeof Element !== 'undefined' ? Element.ALLOW_KEYBOARD_INPUT : undefined;
    let p;
    if (kb !== undefined && root.webkitRequestFullscreen) p = root.webkitRequestFullscreen(kb);
    else { const req = root.requestFullscreen || root.webkitRequestFullscreen; p = req && req.call(root); }
    if (p && p.catch) p.catch(() => {});   // refused: the layout alone fills the window
  } catch (e) { /* no Fullscreen API */ }
}

// Every view resizes on window resize or on its container's ResizeObserver; the event covers the
// views that only listen to the window (Night Sky, Eclipse).
function _appFsRelayout() { window.dispatchEvent(new Event('resize')); }

function _appFsSet(on) {
  on = !!on && _appFsAllowed();
  if (on === _appFsOn) return;
  _appFsOn = on;
  _appFsDocLost = false;
  document.body.classList.toggle('app-fullscreen', on);
  const btn = document.getElementById('btnFullscreen');
  btn.classList.toggle('active', on);
  btn.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen';
  try {
    if (on) _appFsRequestDoc();
    else if (_appFsDocElement()) {
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
  document.addEventListener(ev, () => {
    if (!_appFsDocElement() && _appFsOn) {
      const keyboard = _appFsTouch() && _appFsTextFocused() && performance.now() - _appFsTextAt <= APP_FS_KEYBOARD_MS;
      if (keyboard) { _appFsDocLost = true; _appFsRelayout(); }   // the keyboard: the layout stays
      else _appFsSet(false);
    } else _appFsRelayout();
  });
}
// After the keyboard: the next tap outside a text box brings the browser's fullscreen back (not a
// tap on the exit buttons, which end it)
document.addEventListener('focusin', (e) => { if (_appFsIsText(e.target)) _appFsTextAt = performance.now(); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (_appFsTextFocused()) _appFsTextAt = performance.now(); });
document.addEventListener('pointerup', (e) => {
  if (!_appFsOn || !_appFsDocLost || _appFsDocElement() || _appFsTextFocused()) return;
  if (_appFsIsText(e.target) || (e.target && e.target.closest && e.target.closest('#btnFullscreen, #btnTheaterExit'))) return;
  _appFsDocLost = false;
  _appFsRequestDoc();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _appFsOn) _appFsSet(false); });
// After the page's own handlers have switched the view
for (const ev of ['click', 'change', 'keyup', 'pointerup']) document.addEventListener(ev, () => setTimeout(_appFsSync, 0));
_appFsSync();
setTimeout(_appFsSync, 500);   // the first image arrives after load
