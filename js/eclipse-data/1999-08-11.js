// ─── Eclipse data: 1999-08-11 total solar eclipse ──────────────────────────────────────────────
// Besselian elements: https://www.eclipsewise.com/solar/SEprime/1901-2000/SE1999Aug11Tprime.html
// t0 = 1999 Aug 11, 11:00:00.0 TD. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0.
//
// Not yet cross-checked against a rendered location/photo (no numeric or visual validation done for
// this event yet, unlike 2011/2015/2021/2022/2026) - l2's coefficients are negative (umbral cone,
// already converged past the fundamental plane), correctly total, mirroring the app's own m<|L2|
// visibility convention. uvSign below is a default guess, not independently verified.
window.ECLIPSE_EVENTS = window.ECLIPSE_EVENTS || [];
window.ECLIPSE_EVENTS.push({
  id: '1999-08-11',
  label: '1999 Total Solar Eclipse',
  type: 'total',   // global type of the event's path on Earth, independent of what's visible from any one location
  year: 1999, dayMonth: 8, dayDay: 11,   // 1999 Aug 11 (real calendar day, for EoT/declination)
  t0UtcHours: 11 - 63.7 / 3600,   // 11:00:00.0 TD - deltaT(63.7s) -> UT (11:04:09.1 TD / 11:03:05.4 UT1 at Greatest Eclipse)
  be: {
    x:  [0.07004, 0.54430, -0.00004, -0.00001],
    y:  [0.50284, -0.11849, -0.00012, 0.00000],
    d:  [15.3273, -0.0120, -0.0000],
    l1: [0.54249, 0.00012, -0.00001],
    l2: [-0.00365, 0.00012, -0.00001],
    mu: [343.6874, 15.0030, 0.0000],
  },
  tanf1: 0.0046129, tanf2: 0.0045900,
  // Geocentric semi-diameters of Sun/Moon at greatest eclipse - used only to calibrate how many
  // degrees one Besselian fundamental-plane unit represents (see _eclipseScaleDegPerUnit), and as
  // the drawn disc radii themselves.
  sunSemidiamDeg:  (15 + 46.8 / 60) / 60,   // 15'46.8"
  moonSemidiamDeg: (16 + 0.3 / 60) / 60,    // 16'00.3"
  uvSign: 1,   // NOT independently verified for this event (no rendered/eyeballed cross-check yet) -
               // flip to -1 if a rendered location shows the Moon crossing backwards.
  // eclipsewise's "Greatest Eclipse" point, in the app's own LAT/hemisphere/LONG/lonHemisphere
  // convention (positive magnitude + separate ±1 hemisphere flag - see applyLat/applyLong, controls.js).
  greatestEclipse: { lat: 45 + 4.6 / 60, hemisphere: 1, lon: 24 + 17.9 / 60, lonHemisphere: 1 },
});
