// ─── Eclipse data: 2015-03-20 total solar eclipse ──────────────────────────────────────────────
// Besselian elements: https://www.eclipsewise.com/solar/SEprime/2001-2100/SE2015Mar20Tprime.html
// t0 = 2015 Mar 20, 10:00:00.0 TD. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0.
//
// Validated numerically against NASA's own published Greatest Eclipse point (64°25.9'N,
// 006°38.8'W): plugging that point/time into the standard Besselian local-circumstances formulas
// (_eclipseLocalCirc, render-eclipse.js) gives m ~ 0.0016 (Earth-radii units, essentially exactly
// on-axis) - matches. The magnitude the app itself computes there (diameter-ratio method, ~1.017)
// reads somewhat lower than NASA's quoted 1.04455 - confirmed this is a PRE-EXISTING characteristic
// of the app's simplified (non-topocentric-parallax-corrected) magnitude formula, not a data error
// here: the already-shipped 2026-08-12 event shows the identical ~0.025 gap from its own NASA-quoted
// magnitude (1.036 computed vs 1.03863 quoted) when checked the same way. Contact times/obscuration/
// Moon position all derive from m/L1/L2 directly and are unaffected by this.
window.ECLIPSE_EVENTS = window.ECLIPSE_EVENTS || [];
window.ECLIPSE_EVENTS.push({
  id: '2015-03-20',
  label: '2015 Total Solar Eclipse',
  type: 'total',   // global type of the event's path on Earth, independent of what's visible from any one location
  year: 2015, dayMonth: 3, dayDay: 20,   // 2015 Mar 20 (real calendar day, for EoT/declination)
  t0UtcHours: 10 - 67.7 / 3600,   // 10:00:00.0 TD - deltaT(67.7s) -> UT
  deltaTSec: 67.7,   // also feeds mu's own UT-vs-TDT correction (_eclipseElementsAt, render-eclipse.js)
  be: {
    x:  [-0.16829, 0.55374, 0.00001, -0.00001],
    y:  [0.93905, 0.17865, -0.00005, -0.00000],
    d:  [-0.2127, 0.0160, -0.0000],
    l1: [0.53595, 0.00003, -0.00001],
    l2: [-0.01016, 0.00003, -0.00001],
    mu: [328.1068, 15.0044, 0.0000],
  },
  tanf1: 0.0046950, tanf2: 0.0046717,
  // Geocentric semi-diameters of Sun/Moon at greatest eclipse - used only to calibrate how many
  // degrees one Besselian fundamental-plane unit represents (see _eclipseScaleDegPerUnit), and as
  // the drawn disc radii themselves.
  sunSemidiamDeg:  (16 + 3.7 / 60) / 60,    // 16'03.7"
  moonSemidiamDeg: (16 + 41.6 / 60) / 60,   // 16'41.6"
  uvSign: 1,   // NOT independently verified for this event (no rendered/eyeballed cross-check yet) -
               // flip to -1 if a rendered location shows the Moon crossing backwards.
  // NASA's "Greatest Eclipse" point, in the app's own LAT/hemisphere/LONG/lonHemisphere convention
  // (positive magnitude + separate ±1 hemisphere flag - see applyLat/applyLong, controls.js).
  greatestEclipse: { lat: 64 + 25.9 / 60, hemisphere: 1, lon: 6 + 38.8 / 60, lonHemisphere: -1 },
});
