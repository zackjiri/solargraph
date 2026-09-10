// ─── Eclipse data: 2027-08-02 total solar eclipse ──────────────────────────────────────────────
// Besselian elements: https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2027Aug02Tbeselm.html
// t0 = 2027 Aug 02, 10:00:00.0 TDT. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0,
// valid for 7.00 <= t0 <= 13.00 TDT.
//
// NOT independently numerically validated (no on-axis/altitude cross-check performed for this event
// yet, unlike 2026-08-12) - transcribed directly from the page's own polynomial table. The (u,v) sign
// convention for which side the Moon enters/exits from was NOT independently re-derived from first
// principles either - only ever eyeballed for other events, defaulted to +1 here too; flip uvSign
// below if a future observer location shows the Moon crossing backwards.
window.ECLIPSE_EVENTS = window.ECLIPSE_EVENTS || [];
window.ECLIPSE_EVENTS.push({
  id: '2027-08-02',
  label: '2027 Total Solar Eclipse',
  type: 'total',   // global type of the event's path on Earth, independent of what's visible from any one location
  year: 2027, dayMonth: 8, dayDay: 2,   // 2027 Aug 02 (real calendar day, for EoT/declination)
  t0UtcHours: 9 + 58 / 60 + 48.3 / 3600,   // 10:00:00.0 TDT - deltaT(71.7s) -> UT
  deltaTSec: 71.7,   // also feeds mu's own UT-vs-TDT correction (_eclipseElementsAt, render-eclipse.js)
  be: {
    x:  [-0.019645, 0.5447105, -0.0000444, -0.0000091],
    y:  [0.160063, -0.2111569, -0.0001217, 0.0000037],
    d:  [17.76247, -0.010181, -0.000004],
    l1: [0.530596, 0.0000138, -0.0000128],
    l2: [-0.015464, 0.0000137, -0.0000128],
    mu: [328.42249, 15.002093],
  },
  tanf1: 0.0046064, tanf2: 0.0045834,
  // Geocentric semi-diameters of Sun/Moon AT t0 (from the page's "Geocentric Coordinates... at
  // Greatest Eclipse" block) - used only to calibrate how many degrees one Besselian fundamental-
  // plane unit represents (see _eclipseScaleDegPerUnit), and as the drawn disc radii themselves
  // (both change negligibly over the ~6h the elements are valid for, so treated as constant).
  sunSemidiamDeg:  (15 + 45.5 / 60) / 60,   // 15'45.5"
  moonSemidiamDeg: (16 + 43.1 / 60) / 60,   // 16'43.1"
  uvSign: 1,   // NOT independently verified for this event (no rendered/eyeballed cross-check yet) -
               // default guess, matches every other registered event so far.
  // NASA's "Greatest Eclipse" point, in the app's own LAT/hemisphere/LONG/lonHemisphere convention
  // (positive magnitude + separate ±1 hemisphere flag - see applyLat/applyLong, controls.js).
  greatestEclipse: { lat: 25 + 30.3 / 60, hemisphere: 1, lon: 33 + 11.0 / 60, lonHemisphere: 1 },
});
