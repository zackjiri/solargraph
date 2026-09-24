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

Solargraphy Viewer uses the **equation of the center** instead - mean anomaly → true anomaly → ecliptic longitude → declination. Its worst-case error over a year stays below 0.1–0.3°, against up to ~0.9° for the simple sine, and it reproduces the real asymmetry between the two halves of the year, which a sine wave cannot.

Southern-hemisphere paths are mirrored by flipping the **sign of the declination**, rather than by the common shortcut of shifting the date half a year. It is an exact identity - `sunPosition(H, δ, φ) ≡ sunPosition(H, −δ, −φ)` - so the southern sky is reconstructed as accurately as the northern one.

### Solar time vs. the time on your watch

The model natively runs in **apparent solar time**, where noon is by definition the moment the Sun crosses the meridian. Two corrections turn that into a civil reading, and you can display either:

- **Equation of time** - up to ±16 minutes over the year, from the same orbital eccentricity and axial tilt as above.
- **Longitude offset** - 4 minutes for every degree between your location and its time zone's reference meridian.

Both affect labels only, never the geometry - with one deliberate exception. In the Sun Graph the whole chart is re-projected into the chosen convention, which is why solar noon there becomes a wavy line rather than a flat one at 12:00. Same physical event, different clock.

### What the model does not include

It is an analytic, geometric, airless model, and it is explicit about its limits:

| Effect | Modeled | Magnitude |
|---|---|---|
| Atmospheric refraction | no | ~0.57° at the horizon, ~0.1° at 10°, ~0 above 15° |
| Declination (equation of the center) | yes | < 0.1–0.3° |
| Finite solar disc | no | ~0.5° - traces are bands, not lines |
| Parallax, nutation, aberration | no | < 0.01° |

Near the horizon, real traces therefore sit slightly *above* the prediction, and the day runs a few minutes longer than the geometric sunrise/sunset. In practice these residuals are often smaller than the calibration error itself: the paper never lies perfectly against the wall, and the can's radius and orientation are only known so well.

---

## ✨ What's in the app

🖼 **Gallery** - an archive of solargraph series with stored calibrations, grouped by Generation (one exposure cycle, solstice to solstice) and Image, in Raw scan / Enhanced / Split screen views.

🎛 **Analyzer** - load any scan and calibrate it by hand. Overlays include the Az/Alt grid, horizon, solstice and equinox paths, a movable custom-date path, and the analemma: the slender figure-eight the Sun draws over a year if you mark where it stands at the same clock time every day. Its width is the equation of time, its height the changing declination - the same two quantities the model computes everywhere else, drawn as one curve.

🥫 **3D Model** - the can and its orientation in space, with a full-screen theater mode and a sunlight animation that walks the Sun across a chosen day, showing when its image actually falls on the paper and when it misses.

📈 **Sun Graph** - a year-long chart of sunrise, sunset and the civil/nautical/astronomical twilight bands, computed from the elevation thresholds 0 / −6 / −12 / −18°, overlaid with exposure intervals and with the days the Sun actually reached the paper.

🌌 **Sky Dome** - the same sun paths in true compass projections: a Sky Map, an azimuth-elevation planetarium chart, an orbiting 3D view, and an experimental warp of the calibrated photo onto the dome itself.

🌦 **CHMI weather data** - measured sunshine duration or air temperature from the nearest Czech Hydrometeorological Institute station, in 10-minute resolution. It colours the sun path directly on the photo, or covers the whole exposure period at once, and appears in the Sun Graph too - so the modelled clear-sky day can be held against what the weather actually did.

🌑 **Eclipse mode** *(experimental)* - a solar eclipse simulator for a handful of recent and upcoming events, picked by the author, computed from NASA/eclipsewise **Besselian elements**. Each element (x, y, d, l1, l2, μ) is a polynomial in time; local circumstances for any observer follow the standard reduction (Meeus ch. 54), including WGS84 flattening, ΔT applied to Earth's rotation, and topocentric parallax for the Moon's apparent size. Contact times C1–C4 come from root-finding on `m(t) − L1(t)` and `m(t) − |L2(t)|`. Validated against NASA's published Greatest Eclipse points to within ~100 m, and against the author's own eclipse photographs for five of the events. Magnitude for total and annular events differs from published figures by ~0.02–0.03 - a known limitation in the degree-scaling of the underlying elements.

🌠 **Night Sky mode** *(experimental)* - the real starry sky for the chosen location, date and time: 5,044 stars down to magnitude 6 and the 88 IAU constellations, as a flat polar Sky Map or an all-sky Planetarium you can look around in. Unlike the rest of the app it needs the actual calendar year, because local sidereal time at a fixed date and clock time drifts by about 6 hours from one year to the next. Star positions follow from right ascension and declination through Greenwich sidereal time (Meeus ch. 12). Optional overlays add an equatorial grid, the ecliptic, and the Sun and Moon with their daily paths. An info panel gives the day length, sunrise and sunset, moonrise and moonset with their azimuths, and the Moon's illuminated fraction and age.

- **Moon** - positioned from the full lunar series in Meeus ch. 47, so it sits up to 5.1° off the ecliptic just as the real one does, corrected for topocentric parallax (up to ~1° near the horizon, two of its own diameters). In the Planetarium the Sun and the Moon are drawn at their true angular size, with the zoom reaching 8× so the phase can be read; labels keep both easy to find when zoomed out. The phase is drawn with the lit side turned towards the Sun, and the dark side carries earthshine that is strongest at a thin crescent and fades out towards full moon. Checked against Meeus's worked examples, the 2026 new and full moons, USNO rise and set times, and the eclipse of 12 August 2026, where its overlap with the Sun matches the Eclipse mode's magnitude to within 0.004. Rise and set times are geometric, like the rest of the app: the centre of the disc on the horizon, without refraction, a few minutes off published almanac times.

- **Catalog** - the author's own astrophotography gallery of landscapes, Solar System objects and deep-sky targets, filterable by category. Clicking a photo restores the date, time and place it was taken, turns the Planetarium towards the target and marks the photographed field on the sky with red corner brackets, next to a thumbnail that opens the full-size image. The field is placed from the photo's centre (RA/Dec), field of view and position angle through an exact gnomonic projection, so even a 100° wide-angle frame lands where it belongs, including the part below the horizon.

💾 **Presets** - export a full calibration as JSON and reload it later.

Plus: light / dark theme, collapsible panel sections, tablet-friendly layout.

---

## 📖 How to use

1. **Pick a mode** - `Gallery`, `Analyzer`, `Eclipse` or `Night Sky`.
2. **Gallery** - choose a Generation and an Image, then a view: Raw scan, Enhanced, or Split screen (drag the divider, swap sides with the corner button).
3. **Analyzer** - load a scan, then switch sub-views with the wheel picker: `3D Model` / `Image` / `Sun Graph` / `Sky Dome`.
   - Adjust the Calibration sliders until the projected grid lines up with the arcs in the photo.
   - Set Location and time zone, toggle overlays under Display.
   - The clock icon (top left) switches between apparent, mean and standard solar time.
4. **Eclipse** - the Catalog grid opens first; click a tile for the Visualization, then scrub the time slider or press play.
   - While the animation runs, a small label above the play button shows its speed. Click the label to cycle 1x, 10x, 60x and 300x real time - playback keeps running as the rate changes.
   - `Load gallery` marks the exact moments of real photographs on the slider; `Find the greatest point` jumps your location to where the eclipse was deepest.
5. **Night Sky** - the Catalog opens first; narrow it with `ALL` / `LANDSCAPE` / `SOLAR SYSTEM` / `DEEP SKY` and click a photo to see where on the sky it was taken. Click the thumbnail beside the frame for the full-size photo.
   - `Visualization` shows the star map on its own; switch between `Sky Map` and `Planetarium` with the wheel picker, and drag to look around in Planetarium.
   - `SET NOW` jumps to the current date and time; the play button animates time forward.
6. **Save your work** with `Export` under Preset, and reload it later with `Import`.

---

## 🛠 Troubleshooting

- **Blank canvas** - make sure a Generation and Image are selected in Gallery, or that a scan is loaded in Analyzer (`↩ Load new image`).
- **Calibration looks wrong** - hit `Reset calibration`, then work in order: Yaw, Pitch and Roll first, Horizon and Radius last.
- **`CHMI data` is greyed out** - measured data exists only for images with a matching station extract; not every solargraph has one.
- **`Split screen` is disabled** - it needs both a Raw and an Enhanced layer for the selected image.
- **A section disappeared** - click the ▼ / ▶ triangle by its heading; sections collapse their contents, never themselves.
- **Date, location or time won't change in Night Sky** - they are locked while a Catalog photo is shown, so the frame stays true to it. Switch to `Sky Map` or go back to the Catalog to unlock them.
- **On a phone** - the layout stacks below ~640 px, but fine calibration is much easier on a tablet or desktop.
- **Changes don't show up** - this is static HTML and JavaScript with no build step; a hard refresh clears most stale state.

---

## 📄 License

Solargraphy Viewer is released under a non-commercial, attribution-required license.

You're free to use, copy, modify and share it, as long as it's not for commercial advantage or monetary gain, and you credit Jiri Zach as the original author in any copy or derivative you distribute.

Modified or redistributed versions stay under these same terms - no relicensing, no dropping the non-commercial restriction. Commercial use requires separate written permission from [the author](mailto:zach.jiri@email.cz).

The software is provided as-is, with no warranty of any kind. Breaking these terms ends your rights under the license automatically.

All photographs published with the app - the solargraphs in the Gallery, the eclipse images in the Eclipse photo galleries and the astrophotographs in the Night Sky Catalog - are the author's own work and are **not** covered by the license above. They may not be redistributed, republished, reused or modified, in whole or in part and in any medium, without prior written permission from the author.

Sunshine duration and air temperature measurements shown in the app come from the **open data** of the Czech Hydrometeorological Institute, licensed separately under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.cs).

Star and constellation data in the Night Sky mode are vendored from [D3-Celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn, licensed separately under **BSD-3-Clause** - see [`data/celestial/NOTICE.md`](data/celestial/NOTICE.md) for the full license text and original catalog sources.

---

© 2026 [Jiri Zach](mailto:zach.jiri@email.cz)
