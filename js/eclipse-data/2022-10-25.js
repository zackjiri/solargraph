// ─── Eclipse data: 2022-10-25 partial solar eclipse ─────────────────────────────────────────────
// Besselian elements: https://www.eclipsewise.com/solar/SEprime/2001-2100/SE2022Oct25Pprime.html
// t0 = 2022 Oct 25, 11:00:00.0 TD. Each element is a0 + a1*t + a2*t^2 + a3*t^3, t = hours since t0.
//
// A deep partial eclipse (gamma = 1.07014, i.e. the shadow axis's closest approach to Earth's
// centre exceeds one Earth radius) - the umbra/antumbra never touches Earth anywhere, so this
// event has no C2/C3 (totality/annularity) at any location, only C1/C4 (partial begin/end);
// eclipsewise.com's own page likewise only classifies it "Partial", not total or annular.
//
// Same situation as 2011-01-04.js: no Greatest Eclipse coordinates are tabulated on the source page
// (there's no on-axis point to name). Independently computed by numerically minimizing m(t) over a
// lat/lon grid at the quoted greatest-eclipse instant (11:01:20.0 TD) - landed at 61.77°N, 77.0°E
// (central Siberia, Russia). Validated: plugging that point's own m/L1/L2 back into the standard
// Besselian magnitude formula, magnitude = (L1-m)/(L1+L2), reproduces 0.861904 - matching NASA's
// quoted 0.86189 to 5 decimal places (same formula that worked cleanly for 2011-01-04's own
// partial-type cross-check) - so both the transcribed elements and this computed point are trusted
// correct within a small margin.
window.ECLIPSE_EVENTS = window.ECLIPSE_EVENTS || [];
window.ECLIPSE_EVENTS.push({
  id: '2022-10-25',
  label: '2022 Partial Solar Eclipse',
  type: 'partial',   // global type of the event's path on Earth, independent of what's visible from any one location
  year: 2022, dayMonth: 10, dayDay: 25,   // 2022 Oct 25 (real calendar day, for EoT/declination)
  t0UtcHours: 11 - 70.9 / 3600,   // 11:00:00.0 TD - deltaT(70.9s) -> UT
  be: {
    x:  [0.45479, 0.49555, 0.00003, -0.00001],
    y:  [0.96877, -0.23959, 0.00002, 0.00000],
    d:  [-12.1735, -0.0137, 0.0000],
    l1: [0.54990, -0.00012, -0.00001],
    l2: [0.00372, -0.00011, -0.00001],
    mu: [348.9823, 15.0024, -0.0000],
  },
  tanf1: 0.0047019, tanf2: 0.0046785,
  // Geocentric semi-diameters of Sun/Moon at greatest eclipse - used only to calibrate how many
  // degrees one Besselian fundamental-plane unit represents (see _eclipseScaleDegPerUnit), and as
  // the drawn disc radii themselves.
  sunSemidiamDeg:  (16 + 5.0 / 60) / 60,    // 16'05.0"
  moonSemidiamDeg: (15 + 52.6 / 60) / 60,   // 15'52.6"
  uvSign: 1,   // NOT independently verified for this event (no rendered/eyeballed cross-check yet) -
               // flip to -1 if a rendered location shows the Moon crossing backwards.
  // Computed Greatest Eclipse point (see header comment above) - the app's own LAT/hemisphere/
  // LONG/lonHemisphere convention (positive magnitude + separate ±1 hemisphere flag).
  greatestEclipse: { lat: 61.77, hemisphere: 1, lon: 77.0, lonHemisphere: 1 },
});
