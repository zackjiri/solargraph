# Solargraphy Viewer

*Where captured light becomes science.*

A solargraph is a photograph of the sky exposed for months at a time. The camera is a can with a pinhole instead of a lens and a sheet of photographic paper curved around the inside; day after day, the Sun burns its own arc into the paper.

**Solargraphy Viewer reads that image back as data.** It reconstructs the coordinate system hidden in the scan and assigns azimuth, elevation, day of year and solar time to every pixel - then lets you explore the same scene as a 3D model of the can, a year-long sun chart, a sky dome, or a comparison against measured sunshine data. A separate mode simulates real solar eclipses from published astronomical elements, and another shows the real night sky with the author's own astrophotographs placed on it.

**See it live! Check out Solargraphy Viewer at [zackjiri.github.io/solargraph](https://zackjiri.github.io/solargraph/).**

---

## ☀️ Reading a solargraph

Every arc on the paper is one day of exposure.

- **Height** - how high the Sun climbed. The top arc is the summer solstice, the bottom one the winter solstice.
- **Breaks and gaps** - clouds. A solid trace is a clear day; a dotted one is a day of passing weather.
- **Horizontal position** - the direction the Sun was in, wrapped around the inside of the can.

An exposure usually runs from one solstice to the next, so a finished solargraph holds half a year of sky and weather in a single frame.

---

## 🔬 How it works

Everything below runs in the browser, in plain JavaScript - no server, no build step, no dependencies.

### The projection: from sky to paper

The paper lies against the inside wall of a cylinder, so the geometry can be derived exactly instead of fitted. With the pinhole sitting *on* a circle of radius `R`, a ray arriving at azimuth `β` and elevation `θ` lands at:

```
x = 2R · β                  (β in radians)
y = 2R · cos β · tan θ
```

> The horizontal axis is **linear** in azimuth: a ray entering at angle β strikes the far wall at central angle 2β. The vertical axis is ordinary perspective - the wall is closer to the pinhole off to the sides, hence the `cos β` factor. That cosine is exactly what makes the sun arcs on a real scan sag towards the middle of the frame.

### Calibration: how the can actually stood

No can is perfectly aimed, level and upright, so six parameters describe the real setup: **Scan width**, **Radius**, **Horizon** (the pinhole's height on the paper) and **Yaw / Pitch / Roll**.

Yaw, pitch and roll are applied as full 3D rotation matrices in world coordinates, not small-angle approximations - which matters, because each deforms the horizon in its own recognisable way:

- **Pitch** bends the horizon into a `−cos β` curve: it dips most towards the centre of the frame, least to the east and west.
- **Roll** warps it sinusoidally, `≈ R · sin(2β) · ρ`: no change due south or north, maximum to the east and west.

That signature is what makes hand calibration tractable. You drag the sliders until the projected grid sits on the arcs in the photo, and the shape of the mismatch tells you which axis is still off.

### Where the Sun was

Arc geometry comes from standard spherical astronomy - latitude φ, declination δ, hour angle H:

```
sin(el) = sin φ · sin δ + cos φ · cos δ · cos H
cos(az) = (sin δ − sin φ · sin el) / (cos φ · cos el)
```

Declination is where most simple sun calculators cut a corner. The textbook formula `δ = 23.45° · sin(360/365 · (d − 81))` assumes Earth travels a circle at constant speed. It doesn't: the orbit is an ellipse (e ≈ 0.0167), and by Kepler's second law Earth moves faster near perihelion in early January and slower near aphelion in July.

Solargraphy Viewer takes the Sun from the solar series in Meeus's *Astronomical Algorithms* (ch. 25) for the real calendar date, accurate to about 0.01°. It is the same Sun in every part of the app: sunrise, sunset and every twilight boundary come from one shared computation, so the Analyzer, the Sun Graph and Night Sky agree to the second for the same day and place. The year comes from the exposure dates of a Gallery image, or from the Year field under the custom date in the Analyzer. Dates before 15 October 1582 are in the Julian calendar, and ΔT (the drift of Earth's rotation) follows NASA's Espenak-Meeus polynomials, so historical events such as the total eclipse over Bohemia on 7 June 1415 land where they belong.

Southern-hemisphere paths are mirrored by flipping the **sign of the declination**, rather than by the common shortcut of shifting the date half a year. It is an exact identity - `sunPosition(H, δ, φ) ≡ sunPosition(H, −δ, −φ)` - so the southern sky is reconstructed as accurately as the northern one.

### Solar time vs. the time on your watch

The model natively runs in **apparent solar time**, where noon is by definition the moment the Sun crosses the meridian. Two corrections turn that into a civil reading, and you can display either:

- **Equation of time** - up to ±16 minutes over the year, from the same orbital eccentricity and axial tilt as above (Meeus 28.3, from the same solar series).
- **Longitude offset** - 4 minutes for every degree between your location and its time zone's reference meridian.

Both affect labels only, never the geometry - with one deliberate exception. In the Sun Graph the whole chart is re-projected into the chosen convention, which is why solar noon there becomes a wavy line rather than a flat one at 12:00. Same physical event, different clock.

### Refraction, sunrise and sunset

The pinhole records the Sun where it *appears*, lifted by the atmosphere, so the model draws apparent positions too: atmospheric refraction (Saemundsson's formula) raises the Sun by ~0.57° at the horizon, ~0.1° at 10° and next to nothing above 15°.

Sunrise and sunset follow the almanac standard: the upper limb touching the horizon, with refraction. The Sun's centre is then 0.84° below the geometric horizon, so the day is a few minutes longer than a geometric one, and polar day begins a little south of the Arctic Circle (65.7°) while polar night begins a little north of it (67.4°). The times agree with USNO to within the minute they are published in.

### What the model includes and leaves out

| Effect | Modeled | Magnitude |
|---|---|---|
| Atmospheric refraction | yes | ~0.57° at the horizon, ~0.1° at 10°, ~0 above 15° |
| Declination and equation of time (Meeus) | yes | ~0.01°, ~1 s |
| Finite solar disc | no (in the arcs) | ~0.5° - traces are bands, not lines |
| Sun's motion within a day | no (in the arcs) | ±0.1° morning and evening near the equinoxes |
| Parallax, nutation | no | < 0.01° |

The two *in the arcs* entries come from drawing each day as one line at the day's noon declination; sunrise and sunset themselves are computed for the moment they happen. In practice all of these are smaller than the calibration error itself: the paper never lies perfectly against the wall, and the can's radius and orientation are only known so well.

---

## ✨ What's in the app

🖼 **Gallery** - an archive of solargraph series with stored calibrations, grouped by Generation (one exposure cycle, solstice to solstice) and Image, in Raw scan / Enhanced / Split screen views.

🎛 **Analyzer** - load any scan and calibrate it by hand. Overlays include the Az/Alt grid, horizon, solstice and equinox paths, a movable custom-date path, and the analemma: the slender figure-eight the Sun draws over a year if you mark where it stands at the same clock time every day. Its width is the equation of time, its height the changing declination - the same two quantities the model computes everywhere else, drawn as one curve.

🥫 **3D Model** - the can and its orientation in space, with a full-screen theater mode and a sunlight animation that walks the Sun across a chosen day, showing when its image actually falls on the paper and when it misses.

📈 **Sun Graph** - the whole year in one chart: daylight and the civil, nautical and astronomical twilight (−6 / −12 / −18°), either as the times each phase starts and ends or as their lengths stacked into a 100 % chart of the day. Overlaid with the exposure interval and the days the Sun actually reached the paper; 29 February appears only when the exposure contains it.

🌌 **Sky Dome** - the same sun paths in true compass projections: a Sky Map, an azimuth-elevation planetarium chart, an orbiting 3D view, and an experimental warp of the calibrated photo onto the dome itself. While the photo is shown on the dome, **Show flat** opens it straightened into a cylindrical panorama with the current calibration: azimuth across, the horizon level and vertical edges upright.

🌦 **CHMI weather data** - measured sunshine duration or air temperature from the nearest Czech Hydrometeorological Institute station, in 10-minute resolution. It colours the sun path directly on the photo, or covers the whole exposure period at once, and appears in the Sun Graph too - so the modelled clear-sky day can be held against what the weather actually did.

🌑 **Eclipse mode** - a solar eclipse simulator for a handful of recent and upcoming events, picked by the author, computed from NASA/eclipsewise **Besselian elements**. Each element (x, y, d, l1, l2, μ) is a polynomial in time; local circumstances for any observer follow the standard reduction (Meeus ch. 54), including WGS84 flattening, ΔT applied to Earth's rotation, and topocentric parallax for the Moon's apparent size. Contact times C1–C4 come from root-finding on `m(t) − L1(t)` and `m(t) − |L2(t)|`. Validated against NASA's published Greatest Eclipse points to within ~100 m, and against the author's own eclipse photographs for five of the events. Magnitude for total and annular events differs from published figures by ~0.02–0.03 - a known limitation in the degree-scaling of the underlying elements. Unlike the rest of the app, Eclipse mode is geometric, without atmospheric refraction, because published contact times and magnitudes are geometric too; near the horizon it therefore shows the Sun up to ~0.5° lower than it is actually seen.

🌠 **Night Sky mode** - the real sky for any place, date and time: 5,044 stars down to magnitude 6 and the 88 IAU constellations, as a flat or 3D Sky Map, an all-sky Planetarium, a Sun Graph of the whole year or a Globe of the Earth seen from space, all on one timeline that keeps animating across them. It needs the actual calendar year, because local sidereal time at a fixed date and clock time drifts by about 6 hours from one year to the next; star positions follow from right ascension and declination through Greenwich sidereal time (Meeus ch. 12). An info panel gives rise and set times and azimuths of the Sun and Moon, their distances from the observer, the day length and the Moon's phase and age.

- **Moon** - from the full lunar series in Meeus ch. 47, up to 5.1° off the ecliptic like the real one and corrected for topocentric parallax (up to ~1° near the horizon). The Sun and the Moon reach their true angular size when zoomed in; the phase faces the Sun and carries earthshine. During a lunar eclipse Earth's shadow crosses the disc, sized by Danjon's rule as in NASA's predictions: shadow radii and magnitudes agree with NASA to the fourth decimal, contact times to within a minute.

- **Planets** - Mercury to Saturn from JPL's approximate Keplerian elements (Standish), corrected for light time; within a few arcseconds of JPL Horizons for Mercury and Venus, under 1′ for Mars and Jupiter, about 5′ for Saturn. Dot size follows brightness (Schlyter, including Saturn's rings), and Mercury and Venus show as silhouettes when they transit the Sun.

- **Sun Graph** - the year in standard time at the chosen time zone, with the Moon's hours above the horizon shaded by its illumination and the stretches of moonless astronomical night, the darkest sky the place gets. A lunar calendar marks every new moon, quarter and full moon of the year: full moons carry Earth's shadow, and a new moon that eclipses the Sun from the chosen place shows the eclipse on the solar disc, computed from the topocentric Moon and optionally moved to its local maximum while the Sun is up.

- **Globe** - the Earth from space at the chosen moment, with day, twilight and night worked out for every pixel, seasonal snow and sea ice from a climatological model (latitude, season, continentality, mountain ranges), the Moon at its true distance and the stars and planets behind. Both eclipses come from the real geometry: the Moon's shadow darkens the day and the twilight on the Earth, and the Earth's shadow on the Moon deepens without a step, the copper light of the umbra coming through only as the Moon sinks into it. `EARTH | MOON` puts the camera in orbit around either body. The Moon wears NASA's LRO colour map, turned by the IAU rotation model including libration. `EQU | ECL | HOR` levels the view on the body's equator, the ecliptic, or its surface, which then stays still while the sky turns, like the view from a geostationary satellite.

- **Catalog** - the author's astrophotographs of landscapes, Solar System objects and deep-sky targets. A photo restores the date, time and place it was taken and marks its field on the sky through an exact gnomonic projection, so even a 100° wide-angle frame lands where it belongs.

📍 **Set here** - fills in Location from the device's position (the browser asks for permission). If that is refused or unavailable, it falls back to an approximate, city-level position looked up from the IP address via ipapi.co or geojs.io, which then receive the visitor's IP address. Only on click, never automatically.

💾 **Presets** - export a full calibration as JSON and reload it later.

🪡 **[Warp tool](https://zackjiri.github.io/solargraph/warp_tool.html)** - a companion page that prepares the real-scene layer for Split screen. A camera panorama is bent onto the can's projection: numbered pin pairs mark the same points on the scan and on the photo, a thin-plate spline carries the rest of the image along, and an edge comparison shows where the two still disagree. `Prepare L2` in the Analyzer opens it with the current scan already loaded, together with the camera panorama (`GEN-X_Y_pano`) and saved pins (`GEN-X_Y_warp.json`) when they are in the `img` folder.

---

## 📖 How to use

1. **Pick a mode** - `Gallery`, `Analyzer`, `Eclipse` or `Night Sky`.
2. **Gallery** - choose a Generation and an Image, then a view: Raw scan, Enhanced, or Split screen (drag the divider, swap sides with the corner button).
3. **Analyzer** - load a scan, then switch sub-views with the wheel picker: `3D Model` / `Image` / `Sun Graph` / `Sky Dome`.
   - Adjust the Calibration sliders until the projected grid lines up with the arcs in the photo.
   - Set Location and time zone, toggle overlays under Display.
   - The clock icon (top left) switches between apparent, mean and standard solar time.
   - Save your work with `Export` under Preset, and reload it later with `Import`.
4. **Eclipse** - pick an event in the Catalog, then scrub the time slider or press play; click the speed label to change the rate. `Load gallery` marks the moments of real photographs, `Find the greatest point` moves you to where the eclipse was deepest.
5. **Night Sky** - opens in the Planetarium at the current moment; drag to look around, switch to `Sky Map`, `Sun Graph` or `Globe` with the wheel picker. In the Globe, drag to orbit, use the wheel for distance or field of view and switch between the Earth and the Moon at the top. In the Sun Graph a click sets the date and time. The `Catalog` above lists the astrophotographs. The crosshair button picks a point by RA/Dec and locks the view on it.

---

## 🛠 Troubleshooting

- **Blank canvas** - make sure a Generation and Image are selected in Gallery, or that a scan is loaded in Analyzer (`↩ Load new image`).
- **Calibration looks wrong** - hit `Reset calibration`, then work in order: Yaw, Pitch and Roll first, Horizon and Radius last.
- **`CHMI data` is greyed out** - measured data exists only for images with a matching station extract; not every solargraph has one.
- **`Split screen` is disabled** - it compares the Enhanced scan with a real scene photo, and not every image has one.
- **A section disappeared** - click the ▼ / ▶ triangle by its heading; sections collapse their contents, never themselves.
- **Date, location or time won't change in Night Sky** - they are locked while a Catalog photo is shown, so the frame stays true to it. Switch to another view or go back to the Catalog to unlock them.
- **On a phone** - the layout stacks below ~640 px, but fine calibration is much easier on a tablet or desktop.
- **Changes don't show up** - this is static HTML and JavaScript with no build step; a hard refresh clears most stale state.

---

## 📄 License

Solargraphy Viewer is released under a non-commercial, attribution-required license.

You're free to use, copy, modify and share it, as long as it's not for commercial advantage or monetary gain, and you credit Jiri Zach as the original author in any copy or derivative you distribute.

Modified or redistributed versions stay under these same terms - no relicensing, no dropping the non-commercial restriction. Commercial use requires separate written permission from [the author](mailto:zach.jiri@email.cz).

The software is provided as-is, with no warranty of any kind. Breaking these terms ends your rights under the license automatically.

All photographs published with the app - the solargraphs in the Gallery, the eclipse images in the Eclipse photo galleries and the astrophotographs and videos in the Night Sky Catalog - are the author's own work and are **not** covered by the license above. They may not be redistributed, republished, reused or modified, in whole or in part and in any medium, without prior written permission from the author.

Sunshine duration and air temperature measurements shown in the app come from the **open data** of the Czech Hydrometeorological Institute, licensed separately under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.cs).

Star and constellation data in the Night Sky mode are vendored from [D3-Celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn, licensed separately under **BSD-3-Clause** - see [`data/celestial/NOTICE.md`](data/celestial/NOTICE.md) for the full license text and original catalog sources.

Land outlines in the Globe (`data/earth/land-110m.json`) come from the [world-atlas](https://github.com/topojson/world-atlas) package by Mike Bostock, licensed under **ISC**, with geometry from [Natural Earth](https://www.naturalearthdata.com/), which is in the **public domain** - see [`data/earth/NOTICE.md`](data/earth/NOTICE.md).

The Moon's surface map (`data/moon/lroc_color_2k.jpg`) is from the [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) by **NASA's Scientific Visualization Studio**, built from Lunar Reconnaissance Orbiter Camera data (NASA / GSFC / Arizona State University). NASA imagery is generally not subject to copyright in the United States; it is credited here as NASA asks, and its use implies no endorsement by NASA - see [`data/moon/NOTICE.md`](data/moon/NOTICE.md).

---

© 2026 [Jiri Zach](mailto:zach.jiri@email.cz)
