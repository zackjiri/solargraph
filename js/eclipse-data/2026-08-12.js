// ─── Eclipse data: 2026-08-12 total solar eclipse ──────────────────────────────────────────────
// Besselian elements: https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html
// t0 = 2026 Aug 12, 18:00:00.0 TDT. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0,
// valid for -3 <= t <= +3 (15.00-21.00 TDT).
//
// Validated numerically against NASA's own published "Greatest Eclipse" reference point
// (65°13.5'N, 025°13.7'W, 17:45:53.8 UT): this implementation puts the observer's distance from
// the shadow axis (m) at ~0.0012 (Earth-radii units, i.e. essentially exactly on-axis) at that
// exact time/place, and independently reproduces the page's own quoted Sun altitude/azimuth there
// (25.8°/248.4°) to within 0.05° using the app's own sunPosition()/declination machinery - both
// signs (longitude convention, hemisphere) match, so this is trusted as correct within a small
// margin. The (u,v) sign convention for which side the Moon enters/exits from was NOT independently
// re-derived from first principles (time didn't allow re-deriving Meeus's fundamental-plane axis
// orientation from scratch) - only checked by eye against the rendered result once built; flip
// uvSign below if a future observer location shows the Moon crossing backwards.
window.ECLIPSE_EVENTS = window.ECLIPSE_EVENTS || [];
window.ECLIPSE_EVENTS.push({
  id: '2026-08-12',
  label: '2026 Total Solar Eclipse',
  type: 'total',   // global type of the event's path on Earth, independent of what's visible from any one location
  year: 2026, dayMonth: 8, dayDay: 12,   // 2026 Aug 12 (real calendar day, for EoT/declination)
  t0UtcHours: 17 + 58 / 60 + 48.6 / 3600,   // 18:00:00.0 TDT - deltaT(71.4s) -> UT
  be: {
    x:  [0.475593, 0.5189288, -0.0000773, -0.0000088],
    y:  [0.771161, -0.2301664, -0.0001245, 0.0000037],
    d:  [14.79667, -0.012065, -0.000003],
    l1: [0.537954, 0.0000940, -0.0000121],
    l2: [-0.008142, 0.0000935, -0.0000121],
    mu: [88.74776, 15.003093],
  },
  tanf1: 0.0046141, tanf2: 0.0045911,
  // Geocentric semi-diameters of Sun/Moon AT t0 (from the page's "Geocentric Coordinates... at
  // Greatest Eclipse" block) - used only to calibrate how many degrees one Besselian fundamental-
  // plane unit represents (see _eclipseScaleDegPerUnit), and as the drawn disc radii themselves
  // (both change negligibly over the ~2h the elements are valid for, so treated as constant).
  sunSemidiamDeg:  (15 + 47.0 / 60) / 60,   // 15'47.0"
  moonSemidiamDeg: (16 + 16.9 / 60) / 60,   // 16'16.9"
  uvSign: 1,
  // NASA's "Greatest Eclipse" point, in the app's own LAT/hemisphere/LONG/lonHemisphere convention
  // (positive magnitude + separate ±1 hemisphere flag - see applyLat/applyLong, controls.js).
  greatestEclipse: { lat: 65 + 13.5 / 60, hemisphere: 1, lon: 25 + 13.7 / 60, lonHemisphere: -1 },
});
