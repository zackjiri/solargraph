// ─── Eclipse data: 2021-06-10 annular solar eclipse ─────────────────────────────────────────────
// Besselian elements: https://www.eclipsewise.com/solar/SEprime/2001-2100/SE2021Jun10Aprime.html
// t0 = 2021 Jun 10, 11:00:00.0 TD. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0.
//
// Validated numerically against NASA's own published Greatest Eclipse point (80°48.9'N,
// 066°46.1'W): plugging that point/time into the standard Besselian local-circumstances formulas
// (_eclipseLocalCirc, render-eclipse.js) gives m ~ 0.0003 (Earth-radii units, essentially exactly
// on-axis) - matches. The magnitude the app itself computes there reads somewhat higher than
// NASA's quoted 0.94350 (same simplified-formula gap discussed in 2015-03-20.js/2011-01-04.js -
// a pre-existing app characteristic, also present in the already-shipped 2026-08-12 event, not a
// data error here). l2's coefficients are positive (antumbral cone, hasn't converged yet at the
// fundamental plane) - correctly annular, mirroring the app's own m<|L2| visibility convention.
window.ECLIPSE_EVENTS = window.ECLIPSE_EVENTS || [];
window.ECLIPSE_EVENTS.push({
  id: '2021-06-10',
  label: '2021 Annular Solar Eclipse',
  type: 'annular',   // global type of the event's path on Earth, independent of what's visible from any one location
  year: 2021, dayMonth: 6, dayDay: 10,   // 2021 Jun 10 (real calendar day, for EoT/declination)
  t0UtcHours: 11 - 70.4 / 3600,   // 11:00:00.0 TD - deltaT(70.4s) -> UT
  deltaTSec: 70.4,   // also feeds mu's own UT-vs-TDT correction (_eclipseElementsAt, render-eclipse.js)
  be: {
    x:  [-0.01871, 0.50123, 0.00003, -0.00001],
    y:  [0.92610, 0.08878, -0.00018, -0.00000],
    d:  [23.0423, 0.0028, -0.0000],
    l1: [0.56440, -0.00006, -0.00001],
    l2: [0.01815, -0.00005, -0.00001],
    mu: [345.1269, 14.9992, -0.0000],
  },
  tanf1: 0.0046060, tanf2: 0.0045830,
  // Geocentric semi-diameters of Sun/Moon at greatest eclipse - used only to calibrate how many
  // degrees one Besselian fundamental-plane unit represents (see _eclipseScaleDegPerUnit), and as
  // the drawn disc radii themselves.
  sunSemidiamDeg:  (15 + 45.2 / 60) / 60,   // 15'45.2"
  moonSemidiamDeg: (14 + 46.8 / 60) / 60,   // 14'46.8"
  uvSign: 1,   // NOT independently verified for this event (no rendered/eyeballed cross-check yet) -
               // flip to -1 if a rendered location shows the Moon crossing backwards.
  // NASA's "Greatest Eclipse" point, in the app's own LAT/hemisphere/LONG/lonHemisphere convention
  // (positive magnitude + separate ±1 hemisphere flag - see applyLat/applyLong, controls.js).
  greatestEclipse: { lat: 80 + 48.9 / 60, hemisphere: 1, lon: 66 + 46.1 / 60, lonHemisphere: -1 },
});
