// ─── Eclipse data: 2011-01-04 partial solar eclipse ────────────────────────────────────────────
// Besselian elements: https://www.eclipsewise.com/solar/SEprime/2001-2100/SE2011Jan04Pprime.html
// t0 = 2011 Jan 04, 09:00:00.0 TD. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0.
//
// A deep partial eclipse (gamma = 1.06265, i.e. the shadow axis's closest approach to Earth's
// centre exceeds one Earth radius) - the umbra/antumbra never touches Earth anywhere, so this
// event has no C2/C3 (totality/annularity) at any location, only C1/C4 (partial begin/end); NASA's
// own page likewise only classifies it "Partial", not total or annular.
//
// Because the shadow axis misses Earth entirely, eclipsewise.com's page for this event does NOT
// tabulate geographic coordinates for "Greatest Eclipse" (unlike a central eclipse, there's no
// point where an observer sits exactly on-axis) - only the time (08:51:42.4 TD / 08:50:36.1 UT1)
// and the resulting magnitude (0.85759) and gamma (1.06265) are given directly. The greatestEclipse
// point below (64.68°N, 20.61°E, near Umeå, Sweden) was independently computed by numerically
// minimizing m(t) over a lat/lon grid at that exact instant (the standard definition: greatest
// eclipse's location is wherever Earth's surface passes closest to the shadow axis at the moment
// the axis itself is closest to Earth's centre) - see the standard Besselian local-circumstances
// formulas (_eclipseLocalCirc, render-eclipse.js). Validated: plugging that point's own m/L1/L2
// back into the standard Besselian magnitude formula, magnitude = (L1-m)/(L1+L2), reproduces
// 0.857588 - matching NASA's quoted 0.85759 to 5 decimal places - so both the transcribed elements
// and this computed point are trusted correct within a small margin.
window.ECLIPSE_EVENTS = window.ECLIPSE_EVENTS || [];
window.ECLIPSE_EVENTS.push({
  id: '2011-01-04',
  label: '2011 Partial Solar Eclipse',
  type: 'partial',   // global type of the event's path on Earth, independent of what's visible from any one location
  year: 2011, dayMonth: 1, dayDay: 4,   // 2011 Jan 4 (real calendar day, for EoT/declination)
  t0UtcHours: 9 - 66.3 / 3600,   // 09:00:00.0 TD - deltaT(66.3s) -> UT
  deltaTSec: 66.3,   // also feeds mu's own UT-vs-TDT correction (_eclipseElementsAt, render-eclipse.js)
  be: {
    x:  [-0.14063, 0.51627, -0.00004, -0.00001],
    y:  [1.05582, 0.10514, 0.00011, -0.00000],
    d:  [-22.7412, 0.0041, 0.0000],
    l1: [0.56361, 0.00011, -0.00001],
    l2: [0.01737, 0.00011, -0.00001],
    mu: [313.8112, 14.9966, 0.0000],
  },
  tanf1: 0.0047557, tanf2: 0.0047320,
  // Geocentric semi-diameters of Sun/Moon at greatest eclipse - used only to calibrate how many
  // degrees one Besselian fundamental-plane unit represents (see _eclipseScaleDegPerUnit), and as
  // the drawn disc radii themselves.
  sunSemidiamDeg:  (16 + 15.9 / 60) / 60,   // 16'15.9"
  moonSemidiamDeg: (15 + 18.1 / 60) / 60,   // 15'18.1"
  uvSign: 1,   // NOT independently verified for this event (no rendered/eyeballed cross-check yet,
               // unlike 2026-08-12) - flip to -1 if a rendered location shows the Moon crossing backwards.
  // Computed Greatest Eclipse point (see header comment above) - the app's own LAT/hemisphere/
  // LONG/lonHemisphere convention (positive magnitude + separate ±1 hemisphere flag).
  greatestEclipse: { lat: 64.68, hemisphere: 1, lon: 20.61, lonHemisphere: 1 },
});
