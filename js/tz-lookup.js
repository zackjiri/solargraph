// ─── Time zone from the Location ────────────────────────────────────────────────────────────────
// SET HERE and a click on the globe (SELECT, the Eclipse map) set the Time zone too: the IANA zone
// of the point from data/timezones/tz-grid.js (made by tools/tz-grid.js from timezone-boundary-
// builder; boundaries © OpenStreetMap contributors, ODbL), its offset from the browser's own copy
// of the IANA tz database (Intl). The grid is loaded on the first use, not with the page.
// The offset is the one in force at the moment the active mode shows:
//  - Eclipse: the active event's Greatest Eclipse (its t0);
//  - Night Sky: the date and time of its calendar;
//  - elsewhere: the zone's standard time this year (the smaller of the January and July offsets),
//    as the Sun Graph keeps one offset all year.
// Before 1970 the tz database's history is not reliable (and before ~1900 it is local mean time):
// there, too, the standard time of this year.
// At sea (no zone) the nautical zone from the longitude; a zone the browser does not know (a tz
// database older than the grid's) gets the same. The info line under the Location names the zone
// and the data's source, as ODbL asks. The globe's time zones layer (render-locpick.js) reads the
// same grid and offsets (_tzIndexAt, _tzModeOffsets).
const _tzGrid = { data: null, loading: null, offsets: null };

function _tzDecode(b64, Type) {
  const s = atob(b64), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Type(bytes.buffer);
}
// The grid, decoded; null if it cannot be loaded
function _tzLoad() {
  if (_tzGrid.data) return Promise.resolve(_tzGrid.data);
  if (!_tzGrid.loading) {
    _tzGrid.loading = new Promise((resolve) => {
      const sc = document.createElement('script');
      const own = document.querySelector('script[src*="tz-lookup.js"]');
      sc.src = 'data/timezones/tz-grid.js' + (own && own.src.indexOf('?') >= 0 ? own.src.slice(own.src.indexOf('?')) : '');
      sc.onload = () => {
        const g = window.TZ_GRID;
        _tzGrid.data = g ? Object.assign({}, g, {
          base: _tzDecode(g.base, Uint16Array), starts: _tzDecode(g.starts, Uint32Array), tree: _tzDecode(g.tree, Uint16Array),
        }) : null;
        resolve(_tzGrid.data);
      };
      sc.onerror = () => { _tzGrid.loading = null; resolve(null); };
      document.head.appendChild(sc);
    });
  }
  return _tzGrid.loading;
}
// The zone's index at a point (signed degrees): 1-based into g.zones, 0 at sea. Slots below 0x8000
// are leaves (that index), from 0x8000 on pointers: in base to a subtree's start, in a subtree to
// a block of 4 children (SW, SE, NW, NE) within it.
function _tzIndexAt(g, lat, lon) {
  const PTR = 0x8000;
  const ix = Math.max(0, Math.min(g.nx - 1, Math.floor(lon - g.lonMin)));
  const iy = Math.max(0, Math.min(g.ny - 1, Math.floor(lat - g.latMin)));
  let s = g.base[iy * g.nx + ix];
  if (s >= PTR) {
    const off = g.starts[s - PTR];
    let fx = lon - g.lonMin - ix, fy = lat - g.latMin - iy, b = 0;
    for (;;) {
      fx *= 2; fy *= 2;
      const cx = fx >= 1 ? 1 : 0, cy = fy >= 1 ? 1 : 0;
      fx -= cx; fy -= cy;
      s = g.tree[off + 4 * b + cy * 2 + cx];
      if (s < PTR) break;
      b = s - PTR;
    }
  }
  return s;
}
// The IANA zone at a point, or null at sea
function _tzZoneAt(g, lat, lon) {
  const s = _tzIndexAt(g, lat, lon);
  return s ? g.zones[s - 1] : null;
}
// The nautical zone's offset [h] at a longitude
function _tzNautical(lon) {
  return Math.max(-12, Math.min(12, Math.round(lon / 15)));
}
// The zone's offset from UTC [h] at the instant ms, or null if the browser does not know the zone
function _tzOffsetAt(zone, ms) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric',
      day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms));
  } catch (e) { return null; }
  const p = {};
  for (const x of parts) p[x.type] = +x.value;
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (local - Math.floor(ms / 1000) * 1000) / 3600000;
}
function _tzStandardOffset(zone) {
  const y = new Date().getUTCFullYear();
  const a = _tzOffsetAt(zone, Date.UTC(y, 0, 1)), b = _tzOffsetAt(zone, Date.UTC(y, 6, 1));
  return a === null || b === null ? null : Math.min(a, b);
}
// The instant the active mode shows, or null for the standard time
function _tzModeInstant() {
  let ms = null;
  if (typeof eclipseActive !== 'undefined' && eclipseActive && _eclipseActiveEvent) {
    const ev = _eclipseActiveEvent;
    ms = Date.UTC(ev.year, ev.dayMonth - 1, ev.dayDay) + ev.t0UtcHours * 3600000;
  } else if (typeof nightSkyActive !== 'undefined' && nightSkyActive) {
    ms = Date.UTC(nightSkyYear, nightSkyMonth - 1, nightSkyDay) + nightSkyHourUT * 3600000;
  }
  return ms !== null && ms >= Date.UTC(1970, 0, 1) ? ms : null;
}
// The moment whose date the globe's time zones compare (same date as the Location), or null; it
// follows the animations and sliders: Eclipse the time slider (hours from t0), Night Sky its
// calendar (any year). Solargraph has none: its offsets are the standard time, which would put
// the date an hour off round midnight wherever summer time runs.
function _tzDateInstant() {
  if (typeof eclipseActive !== 'undefined' && eclipseActive && _eclipseActiveEvent) {
    const ev = _eclipseActiveEvent, sl = document.getElementById('rngEclipseTime');
    const t = sl ? parseFloat(sl.value) || 0 : 0;
    return Date.UTC(ev.year, ev.dayMonth - 1, ev.dayDay) + (ev.t0UtcHours + t) * 3600000;
  }
  if (typeof nightSkyActive !== 'undefined' && nightSkyActive) {
    return Date.UTC(nightSkyYear, nightSkyMonth - 1, nightSkyDay) + nightSkyHourUT * 3600000;
  }
  return null;
}
// The day number (days since 1970) at an offset [h] at the instant ms
function _tzDayAt(ms, h) {
  return Math.floor((ms + h * 3600000) / 86400000);
}
// The offset of one zone at the mode's moment (_tzModeInstant), or null if the browser does not
// know the zone
function _tzModeOffset(zone) {
  const ms = _tzModeInstant();
  return ms === null ? _tzStandardOffset(zone) : _tzOffsetAt(zone, ms);
}
// Every zone's offset at the mode's moment, indexed as _tzIndexAt (NaN: unknown to the browser).
// The moment is taken down to its quarter hour of UTC: the offsets change only on those (every
// summer time switch falls on a whole or half hour of UTC), and Night Sky's moment moves with
// its playback, where a table per frame (301 zones through Intl, ~12 ms) would weigh on it. key
// changes with that quarter, sig only with the offsets themselves (what the globe's disc keys on).
const TZ_OFFSETS_STEP_MS = 15 * 60000;
function _tzModeOffsets(g) {
  let ms = _tzModeInstant();
  if (ms !== null) ms = Math.floor(ms / TZ_OFFSETS_STEP_MS) * TZ_OFFSETS_STEP_MS;
  const key = ms === null ? 'std' + new Date().getUTCFullYear() : String(ms);
  if (_tzGrid.offsets && _tzGrid.offsets.key === key) return _tzGrid.offsets;
  const off = new Float64Array(g.zones.length + 1);
  g.zones.forEach((z, i) => {
    const h = ms === null ? _tzStandardOffset(z) : _tzOffsetAt(z, ms);
    off[i + 1] = h === null ? NaN : h;
  });
  return (_tzGrid.offsets = { key, off, sig: off.join(',') });
}
// Sets the Time zone for a point (signed degrees); resolves to the info line's sentence about it,
// or '' if the grid could not be loaded (the Time zone then stays).
async function _tzApplyForLocation(lat, lon) {
  const g = await _tzLoad();
  if (!g) return '';
  const zone = _tzZoneAt(g, lat, lon);
  let h = zone ? _tzModeOffset(zone) : null;
  const nautical = h === null;
  if (nautical) h = _tzNautical(lon);
  applyTimeZone(h);
  // the standard time (Solargraph, or a date before 1970) said so: summer time is left out
  const what = !zone ? 'nautical time at sea' : nautical ? `nautical time, ${zone} unknown to this browser`
    : _tzModeInstant() === null ? `${zone}, standard time` : zone;
  return `Time zone UTC${_fmtTimeZone(timeZoneHours)} (${what}) from OpenStreetMap data.`;
}
// After SET HERE or a click on the globe has put text in the info line: sets the Time zone and adds
// its sentence, unless the info line has changed meanwhile (another Location).
function _tzFollowLocation(lat, lon, text) {
  _tzApplyForLocation(lat, lon).then((s) => {
    const el = document.getElementById('locHereInfo');
    if (s && !el.hidden && el.textContent === text) _locHereInfo(text + ' ' + s);
  });
}
