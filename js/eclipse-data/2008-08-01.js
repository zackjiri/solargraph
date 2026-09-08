// ─── Eclipse data: 2008-08-01 total solar eclipse ──────────────────────────────────────────────
// Besselian elements: https://www.eclipsewise.com/solar/SEprime/2001-2100/SE2008Aug01Tprime.html
// t0 = 2008 Aug 01, 10:00:00.0 TD. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0.
//
// Not yet cross-checked against a rendered location/photo (no numeric or visual validation done for
// this event yet, unlike 2011/2015/2021/2022/2026) - l2's coefficients are negative (umbral cone,
// already converged past the fundamental plane), correctly total, mirroring the app's own m<|L2|
// visibility convention. uvSign below is a default guess, not independently verified.
window.ECLIPSE_EVENTS = window.ECLIPSE_EVENTS || [];
window.ECLIPSE_EVENTS.push({
  id: '2008-08-01',
  label: '2008 Total Solar Eclipse',
  type: 'total',   // global type of the event's path on Earth, independent of what's visible from any one location
  year: 2008, dayMonth: 8, dayDay: 1,   // 2008 Aug 01 (real calendar day, for EoT/declination)
  t0UtcHours: 10 - 65.6 / 3600,   // 10:00:00.0 TD - deltaT(65.6s) -> UT (10:22:12.3 TD / 10:21:06.7 UT1 at Greatest Eclipse)
  be: {
    x:  [0.10176, 0.52858, -0.00006, -0.00001],
    y:  [0.85063, -0.20252, -0.00015, 0.00000],
    d:  [17.8675, -0.0101, -0.0000],
    l1: [0.53825, 0.00011, -0.00001],
    l2: [-0.00787, 0.00011, -0.00001],
    mu: [328.4258, 15.0020, 0.0000],
  },
  tanf1: 0.0046065, tanf2: 0.0045836,
  // Geocentric semi-diameters of Sun/Moon at greatest eclipse - used only to calibrate how many
  // degrees one Besselian fundamental-plane unit represents (see _eclipseScaleDegPerUnit), and as
  // the drawn disc radii themselves.
  sunSemidiamDeg:  (15 + 45.5 / 60) / 60,   // 15'45.5"
  moonSemidiamDeg: (16 + 14.1 / 60) / 60,   // 16'14.1"
  uvSign: 1,   // NOT independently verified for this event (no rendered/eyeballed cross-check yet) -
               // flip to -1 if a rendered location shows the Moon crossing backwards.
  // eclipsewise's "Greatest Eclipse" point, in the app's own LAT/hemisphere/LONG/lonHemisphere
  // convention (positive magnitude + separate ±1 hemisphere flag - see applyLat/applyLong, controls.js).
  greatestEclipse: { lat: 65 + 39.2 / 60, hemisphere: 1, lon: 72 + 17.8 / 60, lonHemisphere: 1 },
});
